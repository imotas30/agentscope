"""Bounded, workspace-relative file operations for agent management."""

import asyncio
import hashlib
import os
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import HTTPException

from ...tool._builtin._backend import LocalBackend
from ..message_bus import MessageBusKeys

MAX_FILE = 20 * 1024 * 1024
MAX_TOTAL = 50 * 1024 * 1024
EXCLUDED = {"node_modules", "__pycache__", "cache", "logs", "venv"}
RESERVED = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"{prefix}{i}" for prefix in ("com", "lpt") for i in range(1, 10)),
}


def relative_path(path):
    """Reject aliases, traversal and generated directories."""
    parts = path.split("/")
    if (
        not path
        or len(parts) > 16
        or any(c in path for c in "\\:\0")
        or any(ord(c) < 32 for c in path)
        or any(
            not p
            or p.startswith(".")
            or p.endswith((".", " "))
            or p.casefold() in EXCLUDED
            or p.split(".")[0].casefold() in RESERVED
            for p in parts
        )
    ):
        raise HTTPException(
            422, "请使用工作空间内的相对路径，不能包含隐藏目录或缓存目录。"
        )
    return parts


async def safe_path(workspace, path):
    parts = relative_path(path)
    backend = workspace.get_backend()
    target = backend.join_path(workspace.workdir, *parts)
    if isinstance(backend, LocalBackend):
        root, resolved = await asyncio.to_thread(
            lambda: (
                os.path.realpath(workspace.workdir),
                os.path.realpath(target),
            ),
        )
        module = os.path
    else:
        root_result = await backend.exec_shell(
            ["realpath", "-m", "--", workspace.workdir]
        )
        path_result = await backend.exec_shell(
            ["realpath", "-m", "--", target]
        )
        if not root_result.ok() or not path_result.ok():
            raise HTTPException(503, "当前工作空间不支持安全文件路径校验。")
        root = root_result.stdout.decode().strip()
        resolved = path_result.stdout.decode().strip()
        import posixpath

        module = posixpath
    try:
        inside = (
            module.commonpath([root, resolved]) == root and resolved != root
        )
    except ValueError:
        inside = False
    if not inside:
        raise HTTPException(403, "文件路径超出工作空间。")
    # Reject aliases too: a second path to the same file must not bypass memory
    # selection, optimistic writes, or the generated-directory exclusion.
    if module.normcase(module.normpath(target)) != module.normcase(resolved):
        raise HTTPException(403, "智能体管理不操作符号链接或目录链接。")
    return target


async def read_bytes(workspace, path, limit=MAX_FILE):
    backend = workspace.get_backend()
    target = await safe_path(workspace, path)
    info = await backend.stat(target)
    if info is None or info.is_dir:
        raise HTTPException(404, "文件不存在。")
    if info.size_bytes is None or info.size_bytes > limit:
        raise HTTPException(413, "文件超过大小限制。")
    chunks, size = [], 0
    async for chunk in backend.read_stream(target):
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, "文件超过大小限制。")
        chunks.append(chunk)
    return b"".join(chunks)


async def list_files(workspace, *, memory=False):
    backend = workspace.get_backend()
    rows = []

    async def visit(prefix, depth):
        if depth > 12:
            raise HTTPException(413, "工作空间目录层级过深，请缩小复制范围。")
        directory = (
            await safe_path(workspace, prefix) if prefix else workspace.workdir
        )
        if not await backend.is_dir(directory):
            return
        for item in await backend.scandir(directory):
            if item.name.startswith(".") or item.name.casefold() in EXCLUDED:
                continue
            path = f"{prefix}/{item.name}" if prefix else item.name
            if not memory and path.split("/")[0].casefold() in {
                "memory",
                "skills",
            }:
                continue
            await safe_path(workspace, path)
            if item.is_dir:
                await visit(path, depth + 1)
            elif not memory or path.lower().endswith(".md"):
                rows.append(
                    {
                        "path": path,
                        "size": item.size_bytes or 0,
                        "mtime": item.mtime,
                    }
                )
                if len(rows) > 1000:
                    raise HTTPException(
                        413, "文件数量超过 1000，请先整理工作空间。"
                    )

    await visit("Memory" if memory else "", 0)
    return sorted(rows, key=lambda row: row["path"])


def digest(data):
    return hashlib.sha256(data).hexdigest()


@asynccontextmanager
async def idle_workspace(storage, bus, owner, workspace_id):
    """Pause existing sessions while taking a consistent snapshot."""
    sessions = []
    for agent in await storage.list_agents(owner, include_team=True):
        sessions.extend(
            s
            for s in await storage.list_sessions(owner, agent.id)
            if s.config.workspace_id == workspace_id
        )
    async with AsyncExitStack() as stack:
        for session in sorted(sessions, key=lambda s: s.id):
            key = MessageBusKeys.session_lock(session.id)
            if await bus.is_locked(key):
                raise HTTPException(
                    409, "工作空间中有正在执行的会话，请执行结束后重试。"
                )
            try:
                await asyncio.wait_for(
                    stack.enter_async_context(
                        bus.acquire_lock(key, ttl_secs=120)
                    ),
                    timeout=1,
                )
            except TimeoutError as exc:
                raise HTTPException(
                    409, "工作空间正在使用，请稍后重试。"
                ) from exc
        yield
