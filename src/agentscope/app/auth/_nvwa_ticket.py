# -*- coding: utf-8 -*-
"""Configurable Nuwa Location-SSO ticket exchange client."""

from __future__ import annotations

from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator


class NvwaUser(BaseModel):
    """Identity returned after a successful ticket exchange."""

    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    display_name: str = ""
    user_id: str | None = None


class NvwaTicketSettings(BaseModel):
    """HTTP settings for resolving a Nuwa Location SSO ticket."""

    model_config = ConfigDict(extra="forbid")
    base_url: str = Field(min_length=1)
    validate_path: str = "/nvwa-certification/v1/ticket/resolve"
    timeout_seconds: float = Field(default=10.0, gt=0, le=120)

    @field_validator("base_url")
    @classmethod
    def strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("validate_path")
    @classmethod
    def ensure_leading_slash(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith("/"):
            value = "/" + value
        return value


def _pick(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload and payload[key] is not None and payload[key] != "":
            return payload[key]
    return None


def _map_user(payload: dict[str, Any]) -> NvwaUser:
    username = _pick(payload, "username", "userName")
    if not isinstance(username, str) or not username.strip():
        raise ValueError("换票响应缺少 username。")
    display = _pick(payload, "displayName", "display_name")
    user_id = _pick(payload, "id", "userId", "user_id")
    return NvwaUser(
        username=username.strip(),
        display_name=str(display).strip() if display is not None else "",
        user_id=str(user_id) if user_id is not None else None,
    )


async def resolve_ticket(
    settings: NvwaTicketSettings,
    ticket: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> NvwaUser:
    """POST ticket to Nuwa and map the JSON body to ``NvwaUser``."""
    if not isinstance(ticket, str) or not ticket.strip():
        raise ValueError("ticket 不能为空。")

    url = f"{settings.base_url}{settings.validate_path}"
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=settings.timeout_seconds)
    try:
        response = await http.post(url, json={"ticket": ticket.strip()})
    finally:
        if owns_client:
            await http.aclose()

    if response.status_code >= 400:
        raise ValueError(f"验票失败（HTTP {response.status_code}）。")

    try:
        payload = response.json()
    except ValueError as exc:
        raise ValueError("验票响应不是合法 JSON。") from exc
    if not isinstance(payload, dict):
        raise ValueError("验票响应必须是 JSON 对象。")
    return _map_user(payload)
