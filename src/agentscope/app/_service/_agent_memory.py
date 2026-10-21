"""Install the memory policy without duplicating legacy middleware."""

from ...middleware import AgenticMemoryMiddleware
from ._model import get_model


async def configure_memory(middlewares, config, workspace, user_id, access):
    """None keeps an embedder's legacy factory; explicit settings take over."""
    if config is None:
        return middlewares
    result = [
        m for m in middlewares if not isinstance(m, AgenticMemoryMiddleware)
    ]
    if config.enabled:
        parameters = config.model_dump(
            exclude={"enabled", "retrieval_model_config"},
            exclude_none=True,
        )
        if config.retrieval_model_config:
            parameters["retrieval_model"] = await get_model(
                user_id,
                config.retrieval_model_config,
                access,
            )
        result.append(
            AgenticMemoryMiddleware(
                workdir=workspace.workdir,
                backend=workspace.get_backend(),
                parameters=AgenticMemoryMiddleware.Parameters(**parameters),
            )
        )
    return result
