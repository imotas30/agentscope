"""One default resolver for HTTP, schedules, channels and team sessions."""

from ._model._agent import AgentRecord
from ._model._session import SessionRecord

MODEL_FIELDS = (
    "chat_model_config",
    "fallback_chat_model_config",
    "tts_model_config",
    "realtime_model_config",
    "knowledge_config",
)
DEFAULT_FIELDS = (*MODEL_FIELDS, "permission_mode")


def initialize_defaults(
    record: SessionRecord,
    agent: AgentRecord | None,
    *,
    inherit_permission: bool = True,
) -> SessionRecord:
    """Opt new sessions into inheritance; never migrate stored records."""
    if agent is None or agent.data.defaults is None:
        return record
    if "inherited_fields" not in record.config.model_fields_set:
        record.config.inherited_fields = [
            key for key in MODEL_FIELDS if getattr(record.config, key) is None
        ]
        if inherit_permission:
            record.config.inherited_fields.append("permission_mode")
    return resolve_defaults(record, agent)


def resolve_defaults(
    record: SessionRecord, agent: AgentRecord | None
) -> SessionRecord:
    """Resolve a detached snapshot, preserving stored overrides and flags."""
    if (
        agent is None
        or agent.data.defaults is None
        or not record.config.inherited_fields
    ):
        return record
    result = record.model_copy(deep=True)
    for key in result.config.inherited_fields:
        value = getattr(agent.data.defaults, key)
        if key == "permission_mode":
            result.state.permission_context.mode = value
        else:
            setattr(
                result.config,
                key,
                value.model_copy(deep=True) if value is not None else None,
            )
    return result
