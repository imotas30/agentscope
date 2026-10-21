"""Small account store; atomic mutations also enforce username uniqueness."""

import hashlib
import json
from collections.abc import Callable
from typing import Any, Self

from redis.asyncio import Redis
from redis.exceptions import WatchError


class RedisAuthStore:
    """Authentication records never inherit business-record TTL settings."""

    def __init__(self, **redis_settings: Any) -> None:
        self.settings = redis_settings
        self.client: Redis | None = None
        self.prefix = "agentscope:auth:"

    @property
    def connection(self) -> Redis:
        """Return the open connection after entering the store lifespan."""
        if self.client is None:
            raise RuntimeError("Authentication store has not been opened.")
        return self.client

    async def __aenter__(self) -> Self:
        self.client = Redis(**self.settings, decode_responses=True)
        try:
            await self.client.ping()
        except BaseException:
            await self.client.aclose()
            self.client = None
            raise
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self.client is not None:
            await self.client.aclose()
            self.client = None

    async def users(self) -> dict[str, dict[str, Any]]:
        return {
            key: json.loads(value)
            for key, value in (
                await self.connection.hgetall(self.prefix + "users")
            ).items()
        }

    async def user(self, user_id: str) -> dict[str, Any] | None:
        value = await self.connection.hget(self.prefix + "users", user_id)
        return json.loads(value) if value else None

    async def mutate(
        self, mutation: Callable[[dict[str, dict[str, Any]]], dict[str, Any]]
    ) -> dict[str, Any]:
        """Serialize account edits across processes, including bootstrap."""
        key = self.prefix + "users"
        for _ in range(20):
            async with self.connection.pipeline(transaction=True) as pipe:
                try:
                    await pipe.watch(key)
                    users = {
                        uid: json.loads(value)
                        for uid, value in (await pipe.hgetall(key)).items()
                    }
                    user = mutation(users)
                    pipe.multi()
                    pipe.hset(key, user["id"], json.dumps(user))
                    await pipe.execute()
                    return user
                except WatchError:
                    continue
        raise RuntimeError(
            "Account was modified concurrently; retry the operation."
        )

    def session_key(self, token: str) -> str:
        return (
            self.prefix
            + "session:"
            + hashlib.sha256(token.encode()).hexdigest()
        )

    async def save_session(
        self, token: str, session: dict[str, Any], ttl: int
    ) -> None:
        await self.connection.set(
            self.session_key(token), json.dumps(session), ex=ttl
        )

    async def session(self, token: str) -> dict[str, Any] | None:
        value = await self.connection.get(self.session_key(token))
        return json.loads(value) if value else None

    async def delete_session(self, token: str) -> None:
        await self.connection.delete(self.session_key(token))

    async def branding(self) -> dict[str, Any]:
        """Read global display settings without exposing account records."""
        value = await self.connection.get(self.prefix + "branding")
        return json.loads(value) if value else {}

    async def save_branding(self, settings: dict[str, Any]) -> None:
        """Replace the shared configuration atomically, without a TTL."""
        await self.connection.set(
            self.prefix + "branding", json.dumps(settings)
        )

    async def allow_login(self, username: str, address: str) -> bool:
        """Bound password work before hashing, per account and client IP."""
        allowed = True
        for category, value, limit in (
            ("name", username.casefold(), 10),
            ("ip", address, 40),
        ):
            digest = hashlib.sha256(value.encode()).hexdigest()
            key = self.prefix + "attempt:" + category + ":" + digest
            async with self.connection.pipeline(transaction=True) as pipe:
                pipe.incr(key)
                pipe.expire(key, 300, nx=True)
                count, _ = await pipe.execute()
                allowed = allowed and count <= limit
        return allowed
