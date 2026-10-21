"""Serializable defaults and memory policy owned by an agent."""

from pydantic import BaseModel, Field

from ....permission import PermissionMode
from ._session import (
    ChatModelConfig,
    RealtimeModelConfig,
    SessionKnowledgeConfig,
    TTSModelConfig,
)


class AgentDefaults(BaseModel):
    """New sessions inherit these values unless explicitly overridden."""

    chat_model_config: ChatModelConfig | None = None
    fallback_chat_model_config: ChatModelConfig | None = None
    tts_model_config: TTSModelConfig | None = None
    realtime_model_config: RealtimeModelConfig | None = None
    knowledge_config: SessionKnowledgeConfig | None = None
    permission_mode: PermissionMode = PermissionMode.DEFAULT


class AgentMemoryConfig(BaseModel):
    """Markdown memory settings; files always live inside the workspace."""

    enabled: bool = True
    memory_max_tokens: int = Field(default=4000, ge=256, le=64000)
    retrieval_async: bool = True
    retrieval_max_tokens_per_md: int = Field(default=2000, ge=128, le=32000)
    retrieval_max_files: int = Field(default=200, ge=1, le=2000)
    retrieval_max_tokens_per_frontmatter: int = Field(
        default=256, ge=32, le=4096
    )
    memory_instructions: str | None = None
    retrieval_instructions: str | None = None
    retrieval_model_config: ChatModelConfig | None = None
