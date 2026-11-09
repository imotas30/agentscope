# -*- coding: utf-8 -*-
"""Nuwa ticket / bearer token resolve client tests."""

from __future__ import annotations

import httpx
import pytest

from agentscope.app.auth._nvwa_ticket import NvwaTicketSettings, resolve_ticket


@pytest.mark.asyncio
async def test_resolve_bearer_token_maps_username() -> None:
    settings = NvwaTicketSettings(
        base_url="http://nvwa.test",
        auth_mode="bearer",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/nvwa-user/v1/user/current"
        assert request.headers.get("Authorization") == "tok-abc"
        return httpx.Response(
            200,
            json={
                "code": "200",
                "datas": {
                    "username": "zhangsan",
                    "displayName": "张三",
                    "id": "u-1",
                },
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        user = await resolve_ticket(settings, "tok-abc", client=client)

    assert user.username == "zhangsan"
    assert user.display_name == "张三"
    assert user.user_id == "u-1"


@pytest.mark.asyncio
async def test_resolve_ticket_post_mode() -> None:
    settings = NvwaTicketSettings(
        base_url="http://nvwa.test",
        auth_mode="ticket_post",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/nvwa-certification/v1/ticket/resolve"
        return httpx.Response(
            200,
            json={"username": "lisi", "displayName": "李四", "id": "u-2"},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        user = await resolve_ticket(settings, "ticket-abc", client=client)

    assert user.username == "lisi"


@pytest.mark.asyncio
async def test_resolve_ticket_rejects_http_error() -> None:
    settings = NvwaTicketSettings(base_url="http://nvwa.test", auth_mode="bearer")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Unauthorized"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(ValueError, match="验票失败"):
            await resolve_ticket(settings, "expired", client=client)


@pytest.mark.asyncio
async def test_resolve_bearer_404_falls_back_to_jwt() -> None:
    import base64
    import json

    settings = NvwaTicketSettings(base_url="http://nvwa.test", auth_mode="bearer")
    claims = {"username": "jwtuser", "displayName": "JWT 用户", "userId": "u-9"}
    payload = (
        base64.urlsafe_b64encode(json.dumps(claims).encode("utf-8"))
        .decode("ascii")
        .rstrip("=")
    )
    token = f"aaa.{payload}.sig"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404,
            json={
                "code": "404",
                "datas": {"path": "/nvwa-user/v1/user/current", "error": "Not Found"},
                "message": "Not Found",
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        user = await resolve_ticket(settings, token, client=client)

    assert user.username == "jwtuser"
    assert user.display_name == "JWT 用户"


@pytest.mark.asyncio
async def test_resolve_auto_falls_back_to_bearer() -> None:
    settings = NvwaTicketSettings(base_url="http://nvwa.test", auth_mode="auto")
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(f"{request.method}:{request.url.path}")
        if request.method == "POST":
            return httpx.Response(401, json={"message": "Unauthorized"})
        return httpx.Response(
            200,
            json={"code": "200", "datas": {"username": "wangwu", "displayName": "王五"}},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        user = await resolve_ticket(settings, "session-tok", client=client)

    assert user.username == "wangwu"
    assert calls[0].startswith("POST:")
    assert any(c.startswith("GET:") for c in calls)
