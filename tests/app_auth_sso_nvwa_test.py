# -*- coding: utf-8 -*-
"""Nuwa SSO endpoint and JIT user provisioning tests."""

from __future__ import annotations

import tempfile
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis
from fastapi.testclient import TestClient

from agentscope.app import create_app
from agentscope.app.auth import AuthService, AuthSettings, RedisAuthStore
from agentscope.app.auth._http import safe_next_path
from agentscope.app.auth._nvwa_ticket import NvwaTicketSettings, NvwaUser
from agentscope.app.message_bus import InMemoryMessageBus
from agentscope.app.storage import RedisStorage
from agentscope.app.workspace_manager import LocalWorkspaceManager

ADMIN_PASSWORD = "Admin-test-password-42"


class FakeAuthStore(RedisAuthStore):
    def __init__(self, server=None):
        super().__init__()
        self.server = server or fakeredis.FakeServer()

    async def __aenter__(self):
        self.client = fakeredis.aioredis.FakeRedis(
            server=self.server, decode_responses=True
        )
        return self


def make_sso_app(workdir, nvwa=None):
    class FakeStorage(RedisStorage):
        async def __aenter__(self):
            self._client = fakeredis.aioredis.FakeRedis(decode_responses=True)
            return self

    service = AuthService(
        FakeAuthStore(),
        AuthSettings(
            admin_password=ADMIN_PASSWORD,
            cookie_path="/agentscope",
        ),
        nvwa_settings=nvwa,
    )
    return create_app(
        storage=FakeStorage(),
        message_bus=InMemoryMessageBus(),
        workspace_manager=LocalWorkspaceManager(workdir),
        enable_index_worker=False,
        enable_scheduler=False,
        auth_service=service,
    ), service


def test_safe_next_path_rejects_open_redirect():
    assert safe_next_path("https://evil.example/x") == "/chat"
    assert safe_next_path("//evil.example") == "/chat"
    assert safe_next_path("/agents") == "/agents"
    assert safe_next_path(None) == "/chat"


def test_sso_requires_nvwa_config():
    with tempfile.TemporaryDirectory() as workdir:
        app, _service = make_sso_app(workdir, nvwa=None)
        with TestClient(app) as client:
            response = client.get("/sso/nvwa?ticket=abc")
            assert response.status_code == 503


def test_sso_requires_ticket():
    with tempfile.TemporaryDirectory() as workdir:
        app, _service = make_sso_app(
            workdir,
            nvwa=NvwaTicketSettings(base_url="http://nvwa.test"),
        )
        with TestClient(app) as client:
            response = client.get("/sso/nvwa")
            assert response.status_code == 400


def test_sso_jit_creates_user_and_sets_cookie():
    with tempfile.TemporaryDirectory() as workdir:
        app, service = make_sso_app(
            workdir,
            nvwa=NvwaTicketSettings(base_url="http://nvwa.test"),
        )
        fake_user = NvwaUser(
            username="zhangsan", display_name="张三", user_id="u-1"
        )
        with patch(
            "agentscope.app.auth._nvwa_ticket.resolve_ticket",
            new=AsyncMock(return_value=fake_user),
        ):
            with TestClient(app) as client:
                response = client.get(
                    "/sso/nvwa?ticket=good&next=/agents",
                    follow_redirects=False,
                )
                assert response.status_code == 302
                assert response.headers["location"] == "/agents"
                cookie = response.headers.get("set-cookie", "")
                assert "agentscope_session=" in cookie
                assert "Path=/agentscope" in cookie
                import asyncio

                async def lookup():
                    rows = await service.store.users()
                    match = [
                        u
                        for u in rows.values()
                        if u["username"] == "zhangsan"
                    ]
                    assert len(match) == 1
                    assert match[0]["display_name"] == "张三"

                asyncio.get_event_loop().run_until_complete(lookup())


def test_sso_rejects_bad_ticket():
    with tempfile.TemporaryDirectory() as workdir:
        app, _service = make_sso_app(
            workdir,
            nvwa=NvwaTicketSettings(base_url="http://nvwa.test"),
        )
        with patch(
            "agentscope.app.auth._nvwa_ticket.resolve_ticket",
            new=AsyncMock(side_effect=ValueError("验票失败（HTTP 401）。")),
        ):
            with TestClient(app) as client:
                response = client.get("/sso/nvwa?ticket=bad")
                assert response.status_code == 401
