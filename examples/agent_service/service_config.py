"""Example-service connection settings; environment overrides local config."""
from __future__ import annotations

import json
import os
from pathlib import Path


def read_settings(path: str | Path) -> dict:
    path = Path(path)
    document = json.loads(path.read_text("utf-8")) if path.exists() else {}
    if not isinstance(document, dict) or set(document) - {"redis", "auth"}:
        raise ValueError("Service configuration supports redis and auth objects.")
    return document


def redis_settings(path: str | Path, environ=None) -> dict:
    env = os.environ if environ is None else environ
    document = read_settings(path)
    configured = document.get("redis", {})
    defaults = {"host": "localhost", "port": 6379, "db": 0, "password": None}
    if not isinstance(configured, dict) or set(configured) - defaults.keys():
        raise ValueError("Unsupported Redis configuration fields.")
    values = {**defaults, **configured}
    for key in defaults:
        name = "AGENTSCOPE_REDIS_" + key.upper()
        if name in env:
            values[key] = env[name]
    if not isinstance(values["host"], str) or not values["host"].strip():
        raise ValueError("Redis host must be a nonempty string.")
    for key, lower, upper in (("port", 1, 65535), ("db", 0, 2147483647)):
        value = values[key]
        if type(value) is not int and not (isinstance(value, str) and value.isascii() and value.isdecimal()):
            raise ValueError(f"Redis {key} must be an integer.")
        values[key] = int(value)
        if not lower <= values[key] <= upper:
            raise ValueError(f"Redis {key} is outside its supported range.")
    if values["password"] is not None and not isinstance(values["password"], str):
        raise ValueError("Redis password must be a string or null.")
    values["password"] = values["password"] or None
    return values


def auth_settings(path: str | Path, environ=None):
    """Load required administrator credentials without echoing invalid secrets."""
    from agentscope.app.auth import AuthSettings
    env = os.environ if environ is None else environ
    configured = read_settings(path).get("auth", {})
    if not isinstance(configured, dict):
        raise ValueError("Auth configuration must be an object.")
    values = dict(configured)
    for field, name in (("admin_password", "AGENTSCOPE_ADMIN_PASSWORD"),
                        ("session_ttl_seconds", "AGENTSCOPE_SESSION_TTL_SECONDS"),
                        ("cookie_secure", "AGENTSCOPE_COOKIE_SECURE")):
        if name in env:
            values[field] = env[name]
    try:
        settings = AuthSettings.model_validate(values)
        settings.validate_password()
    except ValueError:
        raise ValueError("Invalid auth configuration. Set admin_password (8–128 characters), "
                         "session_ttl_seconds (60–604800), cookie_secure, and optional allowed_origins.") from None
    return settings
