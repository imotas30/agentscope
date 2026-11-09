# -*- coding: utf-8 -*-
"""Configurable Nuwa identity resolution for URL-App embed / SSO."""

from __future__ import annotations

from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator


class NvwaUser(BaseModel):
    """Identity returned after a successful ticket/token exchange."""

    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    display_name: str = ""
    user_id: str | None = None


class NvwaTicketSettings(BaseModel):
    """HTTP settings for resolving a Nuwa URL-App ticket / session token."""

    model_config = ConfigDict(extra="forbid")
    base_url: str = Field(min_length=1)
    # auto: session token → bearer；短期 ticket → ticket_post，失败再试 bearer
    auth_mode: Literal["auto", "bearer", "ticket_post"] = "auto"
    validate_path: str = "/nvwa-certification/v1/ticket/resolve"
    user_info_path: str = "/nvwa-user/v1/user/current"
    timeout_seconds: float = Field(default=10.0, gt=0, le=120)

    @field_validator("base_url")
    @classmethod
    def strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("validate_path", "user_info_path")
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


def _unwrap(payload: dict[str, Any]) -> dict[str, Any]:
    """Nuwa APIs often wrap the body as {code, datas|data, message}."""
    for key in ("datas", "data", "result"):
        inner = payload.get(key)
        if isinstance(inner, dict):
            return inner
    return payload


def _map_user(payload: dict[str, Any]) -> NvwaUser:
    body = _unwrap(payload)
    # Nested contextUser is common on Nuwa user payloads.
    context = body.get("contextUser")
    if isinstance(context, dict):
        username = _pick(context, "username", "userName", "name") or _pick(
            body, "username", "userName", "name", "loginName"
        )
        display = _pick(context, "displayName", "display_name", "name") or _pick(
            body, "displayName", "display_name", "name"
        )
        user_id = _pick(context, "id", "userId", "user_id") or _pick(
            body, "id", "userId", "user_id"
        )
    else:
        username = _pick(body, "username", "userName", "name", "loginName")
        display = _pick(body, "displayName", "display_name", "name")
        user_id = _pick(body, "id", "userId", "user_id")
    if not isinstance(username, str) or not username.strip():
        raise ValueError("换票响应缺少 username。")
    return NvwaUser(
        username=username.strip(),
        display_name=str(display).strip() if display is not None else "",
        user_id=str(user_id) if user_id is not None else None,
    )


def _error_detail(response: httpx.Response) -> str:
    snippet = (response.text or "").strip().replace("\n", " ")
    if len(snippet) > 180:
        snippet = snippet[:180] + "…"
    if snippet:
        return f"验票失败（HTTP {response.status_code}）：{snippet}"
    return f"验票失败（HTTP {response.status_code}）。"


def _user_from_jwt(token: str) -> NvwaUser | None:
    """Best-effort identity from Nuwa session JWT when user-info API is unavailable."""
    import base64
    import json

    raw = token.strip()
    if raw.lower().startswith("bearer "):
        raw = raw[7:].strip()
    parts = raw.split(".")
    if len(parts) != 3:
        return None
    try:
        padded = parts[1] + ("=" * (-len(parts[1]) % 4))
        claims = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, json.JSONDecodeError, UnicodeError):
        return None
    if not isinstance(claims, dict):
        return None
    username = _pick(
        claims, "username", "userName", "loginName", "preferred_username", "sub"
    )
    if not isinstance(username, str) or not username.strip():
        return None
    display = _pick(claims, "displayName", "display_name", "name", "nickName")
    user_id = _pick(claims, "id", "userId", "user_id", "uid")
    return NvwaUser(
        username=username.strip()[:64],
        display_name=str(display).strip() if display is not None else "",
        user_id=str(user_id) if user_id is not None else None,
    )


async def _bearer_user_info(
    http: httpx.AsyncClient,
    settings: NvwaTicketSettings,
    token: str,
) -> httpx.Response:
    response = await http.get(
        f"{settings.base_url}{settings.user_info_path}",
        headers={"Authorization": token},
    )
    if response.status_code in {401, 403}:
        response = await http.get(
            f"{settings.base_url}{settings.user_info_path}",
            headers={"Authorization": f"Bearer {token}"},
        )
    return response


async def _ticket_post(
    http: httpx.AsyncClient,
    settings: NvwaTicketSettings,
    ticket: str,
) -> httpx.Response:
    return await http.post(
        f"{settings.base_url}{settings.validate_path}",
        json={"ticket": ticket},
    )


def _parse_user_payload(payload: dict[str, Any]) -> NvwaUser:
    code = payload.get("code")
    if code is not None and str(code) not in {"0", "0000", "200", "OK", "ok"}:
        msg = payload.get("message") or payload.get("msg") or str(code)
        raise ValueError(f"验票失败（业务码 {code}）：{msg}")
    return _map_user(payload)


async def resolve_ticket(
    settings: NvwaTicketSettings,
    ticket: str,
    *,
    client: httpx.AsyncClient | None = None,
    prefer: Literal["auto", "bearer", "ticket_post"] | None = None,
) -> NvwaUser:
    """Resolve URL-App ticket / session token into a Nuwa user."""
    if not isinstance(ticket, str) or not ticket.strip():
        raise ValueError("ticket 不能为空。")
    token = ticket.strip()
    mode = prefer or settings.auth_mode

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=settings.timeout_seconds)
    try:
        if mode == "bearer":
            response = await _bearer_user_info(http, settings, token)
        elif mode == "ticket_post":
            response = await _ticket_post(http, settings, token)
        else:
            # auto: 会话 token 走 bearer；短票先 ticket_post，网关 401 再试 bearer
            response = await _ticket_post(http, settings, token)
            if response.status_code >= 400:
                response = await _bearer_user_info(http, settings, token)
    finally:
        if owns_client:
            await http.aclose()

    if response.status_code >= 400:
        # Local BudServer often has gateway auth but no nvwa-user service → 404.
        jwt_user = _user_from_jwt(token)
        if jwt_user is not None and response.status_code in {404, 502, 503}:
            return jwt_user
        raise ValueError(_error_detail(response))

    try:
        payload = response.json()
    except ValueError as exc:
        jwt_user = _user_from_jwt(token)
        if jwt_user is not None:
            return jwt_user
        raise ValueError("验票响应不是合法 JSON。") from exc
    if not isinstance(payload, dict):
        raise ValueError("验票响应必须是 JSON 对象。")
    try:
        return _parse_user_payload(payload)
    except ValueError:
        jwt_user = _user_from_jwt(token)
        if jwt_user is not None:
            return jwt_user
        raise

