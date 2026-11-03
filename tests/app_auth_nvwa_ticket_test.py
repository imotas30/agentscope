# -*- coding: utf-8 -*-
"""Nuwa ticket resolve client tests."""

from __future__ import annotations

import httpx
import pytest

from agentscope.app.auth._nvwa_ticket import NvwaTicketSettings, resolve_ticket


@pytest.mark.asyncio
async def test_resolve_ticket_maps_username() -> None:
    settings = NvwaTicketSettings(base_url="http://nvwa.test")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/nvwa-certification/v1/ticket/resolve"
        assert request.read()  # body present
        return httpx.Response(
            200,
            json={
                "username": "zhangsan",
                "displayName": "张三",
                "id": "u-1",
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        user = await resolve_ticket(settings, "ticket-abc", client=client)

    assert user.username == "zhangsan"
    assert user.display_name == "张三"
    assert user.user_id == "u-1"


@pytest.mark.asyncio
async def test_resolve_ticket_rejects_missing_username() -> None:
    settings = NvwaTicketSettings(base_url="http://nvwa.test")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(ValueError, match="username"):
            await resolve_ticket(settings, "bad", client=client)


@pytest.mark.asyncio
async def test_resolve_ticket_rejects_http_error() -> None:
    settings = NvwaTicketSettings(base_url="http://nvwa.test")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": "invalid ticket"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(ValueError, match="验票失败"):
            await resolve_ticket(settings, "expired", client=client)
