# -*- coding: utf-8 -*-
"""Provision isolated AgentScope resources for Nuwa SSO JIT users."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_AGENT_NAME = "默认智能体"
DEFAULT_SYSTEM_PROMPT = (
    "你是一个有帮助的中文智能助手。回答简洁、准确，不确定时明确说明。"
)


async def seed_admin_credentials_if_empty(
    storage: Any,
    user_id: str,
    *,
    source_user_id: str = "admin",
) -> int:
    """Copy ``source_user_id`` credentials onto ``user_id`` when they have none.

    Keeps the same credential ids so agent default ``chat_model_config`` that
    references those credentials still resolves for the SSO user. Data lives
    under each ``user_id`` key — users do not share storage rows.
    """
    if not user_id or user_id == source_user_id:
        return 0
    existing = await storage.list_credentials(user_id)
    if existing:
        return 0
    try:
        source = await storage.list_credentials(source_user_id)
    except Exception:  # noqa: BLE001 — SSO must not fail login on seed errors
        logger.exception(
            "SSO credential seed skipped: cannot list source user=%s",
            source_user_id,
        )
        return 0
    if not source:
        return 0

    from ...credential import CredentialFactory

    seeded = 0
    for record in source:
        try:
            payload = dict(record.data or {})
            payload["id"] = record.id
            credential = CredentialFactory.from_dict(payload)
            await storage.upsert_credential(user_id, credential)
            seeded += 1
        except Exception:  # noqa: BLE001
            logger.exception(
                "SSO credential seed failed: user=%s credential=%s",
                user_id,
                getattr(record, "id", "?"),
            )
    if seeded:
        logger.info(
            "SSO credential seed: user=%s copied=%s from=%s",
            user_id,
            seeded,
            source_user_id,
        )
    return seeded


def _pick_chat_model_config(credentials: list[Any]) -> Any | None:
    """Build a ``ChatModelConfig`` from the first usable seeded credential."""
    from ...credential import CredentialFactory
    from ..storage._model._session import ChatModelConfig

    for record in credentials:
        try:
            payload = dict(record.data or {})
            payload.setdefault("id", record.id)
            credential = CredentialFactory.from_dict(payload)
            provider_type = getattr(credential, "type", None) or payload.get(
                "type"
            )
            if not provider_type:
                continue
            cards = type(credential).list_models()
            if not cards:
                continue
            # Strongest / newest first — same ranking as the web picker.
            cards = sorted(
                cards,
                key=lambda c: getattr(c, "name", ""),
                reverse=True,
            )
            model_name = cards[0].name
            return ChatModelConfig(
                type=str(provider_type),
                credential_id=record.id,
                model=model_name,
                parameters={},
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "SSO default model pick failed: credential=%s",
                getattr(record, "id", "?"),
            )
    return None


async def ensure_default_agent(
    storage: Any,
    user_id: str,
    *,
    display_name: str = "",
) -> str | None:
    """Create one isolated default agent for the user when they have none.

    Agents are stored under ``user_id`` only — other SSO users cannot see or
    use this agent. Returns the agent id when created, otherwise ``None``.
    """
    if not user_id or user_id == "admin":
        return None

    try:
        agents = await storage.list_agents(user_id)
    except Exception:  # noqa: BLE001
        logger.exception(
            "SSO default agent skipped: cannot list agents user=%s", user_id
        )
        return None

    from ..storage._model._agent import AgentData, AgentRecord
    from ..storage._model._agent_settings import AgentDefaults

    label = (display_name or "").strip() or "助手"
    friendly = f"{label}的默认助手，可随时改模型和设定。"

    own = [
        a
        for a in agents
        if getattr(a, "source", "user") == "user"
    ]
    if own:
        # Rewrite legacy SSO boilerplate on already-created default agents.
        for agent in own:
            data = getattr(agent, "data", None)
            if data is None:
                continue
            name = getattr(data, "name", "") or ""
            desc = getattr(data, "description", "") or ""
            if name != DEFAULT_AGENT_NAME:
                continue
            if "女娲 SSO" not in desc and "隔离默认智能体" not in desc:
                continue
            try:
                updated = data.model_copy(update={"description": friendly})
                record = AgentRecord(
                    user_id=user_id,
                    source=getattr(agent, "source", "user"),
                    data=updated,
                )
                await storage.upsert_agent(user_id, record)
                logger.info(
                    "SSO default agent description refreshed: user=%s agent=%s",
                    user_id,
                    getattr(data, "id", "?"),
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "SSO default agent description refresh failed: user=%s",
                    user_id,
                )
        return None

    credentials = await storage.list_credentials(user_id)
    chat_model = _pick_chat_model_config(credentials)
    data = AgentData(
        name=DEFAULT_AGENT_NAME,
        system_prompt=DEFAULT_SYSTEM_PROMPT,
        description=friendly,
        defaults=AgentDefaults(chat_model_config=chat_model)
        if chat_model is not None
        else AgentDefaults(),
    )
    record = AgentRecord(user_id=user_id, source="user", data=data)
    agent_id = await storage.upsert_agent(user_id, record)
    logger.info(
        "SSO default agent created: user=%s agent=%s model=%s",
        user_id,
        agent_id,
        getattr(chat_model, "model", None),
    )
    return agent_id


async def provision_sso_user(
    storage: Any,
    user: dict[str, Any],
) -> None:
    """Seed credentials + ensure a per-user default agent after Nuwa SSO."""
    user_id = user.get("id")
    if not user_id or user_id == "admin":
        return
    await seed_admin_credentials_if_empty(storage, user_id)
    await ensure_default_agent(
        storage,
        user_id,
        display_name=str(user.get("display_name") or user.get("username") or ""),
    )
