"""Management authorization, inheritance, copies and memory isolation."""

import tempfile
from pathlib import Path
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from agentscope.app.resources import LocalSkillStore
from agentscope.app.message_bus import MessageBusKeys
from agentscope.app.storage import AgentData, AgentRecord, SessionConfig
from tests.user_auth_test import (
    make_app,
    ADMIN_PASSWORD,
    USER_PASSWORD,
    ORIGIN,
)


class AgentManagementTest(TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient

        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.app, self.auth = make_app(str(self.root / "workspaces"))
        self.client = self.enterContext(TestClient(self.app))
        self.app.state.resource_service.skill_store = LocalSkillStore(
            str(self.root / "skills")
        )
        self.login("admin", ADMIN_PASSWORD)
        self.alice = self.user("alice")
        self.bob = self.user("bob")

    def login(self, name, password=USER_PASSWORD):
        self.client.cookies.clear()
        response = self.client.post(
            "/auth/login",
            json={"username": name, "password": password},
            headers=ORIGIN,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.headers = {
            **ORIGIN,
            "X-CSRF-Token": response.json()["csrf_token"],
        }

    def user(self, name):
        return self.request(
            "POST",
            "/admin/users",
            {"username": name, "password": USER_PASSWORD},
            status=201,
        )["id"]

    def request(self, method, path, body=None, status=200):
        result = self.client.request(
            method, path, json=body, headers=self.headers
        )
        self.assertEqual(result.status_code, status, result.text)
        return result.json() if result.content else None

    def create(self, owner=None, **data):
        return self.request(
            "POST",
            "/agent-management" + (f"?owner_id={owner}" if owner else ""),
            {"name": "测试助手", **data},
            201,
        )

    def url(self, agent, tail=""):
        return (
            f"/agent-management/{agent['id']}{tail}"
            f"?owner_id={agent['user_id']}"
        )

    def update(self, agent, **data):
        fields = {
            key: agent["data"][key]
            for key in (
                "name",
                "description",
                "system_prompt",
                "chat_config",
                "resource_config",
                "defaults",
                "memory_config",
            )
        }
        fields.update(data)
        return self.request(
            "PATCH", self.url(agent), {**fields, "revision": agent["revision"]}
        )

    def copy(self, agent, **options):
        return self.request(
            "POST",
            self.url(agent, "/copy"),
            {
                "name": "副本",
                "request_id": uuid4().hex,
                "revision": agent["revision"],
                **options,
            },
            201,
        )

    def seed_resources(self, owner):
        credential = self.request(
            "POST",
            f"/agent-management/resources/credential?owner_id={owner}",
            {
                "data": {
                    "type": "openai_credential",
                    "name": "测试 AI",
                    "api_key": "test-resource-key-only",
                }
            },
            201,
        )["id"]
        skill = self.request(
            "POST",
            f"/skill?resource_owner={owner}",
            {
                "files": {
                    "SKILL.md": (
                        "---\nname: test-skill\n"
                        "description: A test skill\n---\nold instructions"
                    ),
                    "scripts/helper.py": "print('test')",
                }
            },
            201,
        )
        mcp = self.request(
            "POST",
            f"/mcp?resource_owner={owner}",
            {
                "client": {
                    "name": "test-mcp",
                    "is_stateful": False,
                    "mcp_config": {
                        "type": "http_mcp",
                        "url": "http://127.0.0.1:65520/mcp",
                        "transport": "streamable_http",
                        "headers": {"Authorization": "test-secret"},
                    },
                }
            },
            201,
        )
        model = {
            "type": "openai_credential",
            "credential_id": credential,
            "model": "test-model",
            "parameters": {"temperature": 0.2},
        }
        return credential, skill, mcp, model

    def test_admin_all_and_user_owner_enforcement(self):
        a = self.create(self.alice)
        b = self.create(self.bob)
        listing = self.request("GET", "/agent-management")
        self.assertEqual(
            {r["id"] for r in listing["agents"]}, {a["id"], b["id"]}
        )
        a = self.update(a, name="管理员已修改")
        self.assertEqual(a["user_id"], self.alice)
        self.login("bob")
        self.assertEqual(
            [
                r["id"]
                for r in self.request("GET", "/agent-management")["agents"]
            ],
            [b["id"]],
        )
        for tail in ("", "/copy-preview", "/files"):
            self.request("GET", self.url(a, tail), status=403)
        self.request(
            "POST",
            self.url(a, "/copy"),
            {
                "name": "偷取",
                "request_id": uuid4().hex,
                "revision": a["revision"],
            },
            403,
        )
        self.request("DELETE", self.url(a), status=403)
        self.request("GET", f"/mcp?resource_owner={self.alice}", status=403)
        self.request(
            "GET",
            f"/agent-management/resources?owner_id={self.alice}",
            status=403,
        )
        self.request("GET", f"/agent-management/{a['id']}", status=404)
        self.request(
            "POST",
            f"/agent-management?owner_id={self.alice}",
            {"name": "x"},
            403,
        )

    def test_defaults_inherit_override_reset_and_legacy_preserved(self):
        _, _, _, model = self.seed_resources(self.alice)
        self.login("alice")
        old = self.request("POST", "/agent/", {"name": "old"}, 201)["agent_id"]
        old_session = self.request(
            "POST", "/sessions/", {"agent_id": old}, 201
        )["session_id"]
        a = self.create(
            defaults={
                "chat_model_config": model,
                "permission_mode": "accept_edits",
            }
        )
        sid = self.request("POST", "/sessions/", {"agent_id": a["id"]}, 201)[
            "session_id"
        ]

        def read():
            return self.client.portal.call(
                self.app.state.storage.get_session, self.alice, a["id"], sid
            )

        self.assertEqual(read().config.chat_model_config.model, "test-model")
        self.assertEqual(
            read().state.permission_context.mode.value, "accept_edits"
        )
        self.request(
            "PATCH",
            f"/sessions/{sid}?agent_id={a['id']}",
            {"chat_model_config": {**model, "model": "override"}},
        )
        a = self.update(
            a, defaults={"chat_model_config": {**model, "model": "changed"}}
        )
        self.assertEqual(read().config.chat_model_config.model, "override")
        self.request(
            "PATCH",
            f"/sessions/{sid}?agent_id={a['id']}",
            {"inherit_defaults": ["chat_model_config"]},
        )
        self.assertEqual(read().config.chat_model_config.model, "changed")
        self.request(
            "PATCH",
            f"/sessions/{sid}?agent_id={a['id']}",
            {"chat_model_config": None},
        )
        self.assertIsNone(read().config.chat_model_config)
        record = self.client.portal.call(
            self.app.state.storage.get_session, self.alice, old, old_session
        )
        self.assertEqual(record.config.inherited_fields, [])
        self.assertIsNone(record.config.chat_model_config)

    def test_copy_links_separate_bindings_pinned_skill_and_select_none(self):
        _, skill, mcp, model = self.seed_resources(self.alice)
        a = self.create(
            self.alice,
            resource_config={
                "skills": {skill["id"]: {"enabled": False}},
                "mcps": {mcp["id"]: {"enabled": True}},
            },
            defaults={"chat_model_config": model},
        )
        old_artifact = a["data"]["resource_config"]["skills"][skill["id"]][
            "artifact_id"
        ]
        self.request(
            "PATCH",
            f"/skill/{skill['id']}/files?resource_owner={self.alice}",
            {
                "files": {
                    "SKILL.md": (
                        "---\nname: test-skill\n"
                        "description: Changed\n---\nnew instructions"
                    )
                }
            },
        )
        linked = self.copy(a)
        binding = linked["data"]["resource_config"]["skills"][skill["id"]]
        self.assertEqual(binding["artifact_id"], old_artifact)
        self.assertFalse(binding["enabled"])
        self.assertNotEqual(
            binding["binding_id"],
            a["data"]["resource_config"]["skills"][skill["id"]]["binding_id"],
        )
        empty = self.copy(
            a, skills=[], mcps=[], ai_fields=[], knowledge_base_ids=[]
        )
        self.assertEqual(
            empty["data"]["resource_config"], {"skills": {}, "mcps": {}}
        )
        self.assertIsNone(empty["data"]["defaults"]["chat_model_config"])

    def test_cross_owner_copy_clones_resources_and_retains_source(self):
        cid, skill, mcp, model = self.seed_resources(self.alice)
        a = self.create(
            self.alice,
            resource_config={
                "skills": {skill["id"]: {}},
                "mcps": {mcp["id"]: {}},
            },
            defaults={
                "chat_model_config": model,
                "fallback_chat_model_config": model,
            },
        )
        b = self.copy(a, target_user_id=self.bob)
        self.assertEqual(b["user_id"], self.bob)
        self.assertNotIn(skill["id"], b["data"]["resource_config"]["skills"])
        self.assertNotIn(mcp["id"], b["data"]["resource_config"]["mcps"])
        copied_model = b["data"]["defaults"]["chat_model_config"]
        self.assertNotEqual(copied_model["credential_id"], cid)
        self.assertEqual(
            copied_model["credential_id"],
            b["data"]["defaults"]["fallback_chat_model_config"][
                "credential_id"
            ],
        )
        catalog = self.request(
            "GET", f"/agent-management/resources?owner_id={self.bob}"
        )
        self.assertNotIn("test-resource-key-only", str(catalog))
        self.assertEqual(len(catalog["credentials"]), 1)
        self.assertEqual(
            self.request("GET", self.url(a))["agent"]["data"], a["data"]
        )

    def test_copy_idempotency_and_stale_source(self):
        a = self.create(self.alice)
        token = uuid4().hex
        b = self.copy(a, request_id=token)
        again = self.copy(a, request_id=token)
        self.assertEqual(b["id"], again["id"])
        self.update(a, name="changed")
        self.request(
            "POST",
            self.url(a, "/copy"),
            {
                "name": "copy",
                "request_id": uuid4().hex,
                "revision": a["revision"],
            },
            409,
        )

    def test_memory_copy_files_and_path_isolation(self):
        a = self.create(self.alice)
        wid = a["data"]["workspace_id"]
        self.request(
            "PUT",
            self.url(a, "/memory"),
            {
                "path": "Memory/MEMORY.md",
                "content": "记住偏好",
                "workspace_id": wid,
            },
        )
        root = self.root / "workspaces" / a["id"]
        (root / "result.txt").write_text("business", encoding="utf-8")
        (root / ".private").write_text("hidden", encoding="utf-8")
        (root / "skills").mkdir(exist_ok=True)
        (root / "skills" / "generated.md").write_text(
            "installed skill", encoding="utf-8"
        )
        preview = self.request("GET", self.url(a, "/copy-preview"))
        self.assertEqual(
            [r["path"] for r in preview["memory"]], ["Memory/MEMORY.md"]
        )
        self.assertEqual([r["path"] for r in preview["files"]], ["result.txt"])
        b = self.copy(a, memory=True, files=["result.txt"], workspace_id=wid)
        target = self.root / "workspaces" / b["id"]
        self.assertEqual(
            (target / "Memory/MEMORY.md").read_text(encoding="utf-8"),
            "记住偏好",
        )
        self.assertEqual((target / "result.txt").read_text(), "business")
        self.assertFalse((target / ".private").exists())
        memory = self.request(
            "GET", self.url(b, "/memory") + "&path=Memory/MEMORY.md"
        )
        self.request(
            "PUT",
            self.url(b, "/memory"),
            {
                "path": "Memory/MEMORY.md",
                "content": "新内容",
                "revision": memory["revision"],
            },
        )
        self.assertEqual(
            (root / "Memory/MEMORY.md").read_text(encoding="utf-8"), "记住偏好"
        )
        self.request(
            "PUT",
            self.url(b, "/memory"),
            {"path": "Memory/../../outside.md", "content": "no"},
            422,
        )
        self.request(
            "GET",
            self.url(b, "/memory")
            + f"&path=Memory/MEMORY.md&workspace_id={wid}",
            status=404,
        )
        empty = self.copy(a)
        empty_files = self.request("GET", self.url(empty, "/files"))
        self.assertEqual(empty_files["files"], [])

    def test_copy_failure_rolls_back_new_resources(self):
        _, skill, mcp, model = self.seed_resources(self.alice)
        a = self.create(
            self.alice,
            resource_config={
                "skills": {skill["id"]: {}},
                "mcps": {mcp["id"]: {}},
            },
            defaults={"chat_model_config": model},
        )
        original = self.app.state.storage.upsert_credential
        with patch.object(
            self.app.state.storage,
            "upsert_credential",
            AsyncMock(side_effect=RuntimeError("injected")),
        ):
            with self.assertRaises(RuntimeError):
                self.copy(a, target_user_id=self.bob)
        self.assertIsNotNone(original)
        catalog = self.request(
            "GET", f"/agent-management/resources?owner_id={self.bob}"
        )
        self.assertEqual(catalog["skills"], [])
        self.assertEqual(catalog["mcps"], [])
        self.assertEqual(catalog["credentials"], [])
        self.assertEqual(
            len(self.request("GET", "/agent-management")["agents"]), 1
        )

    def test_memory_refuses_active_workspace(self):
        a = self.create(self.alice)
        self.login("alice")
        sid = self.request("POST", "/sessions/", {"agent_id": a["id"]}, 201)[
            "session_id"
        ]
        bus = self.app.state.message_bus
        key = MessageBusKeys.session_lock(sid)
        self.assertTrue(self.client.portal.call(bus.try_lock, key))
        self.request(
            "PUT",
            self.url(a, "/memory"),
            {"path": "Memory/MEMORY.md", "content": "busy"},
            409,
        )
        self.client.portal.call(bus.unlock, key)

    def test_masked_credentials_roundtrip_and_resource_edit_isolation(self):
        cid, skill, _, _ = self.seed_resources(self.alice)
        url = (
            f"/agent-management/resources/credential/{cid}"
            f"?owner_id={self.alice}"
        )
        masked = self.request("GET", url)
        self.assertNotIn("test-resource-key-only", str(masked))
        payload = masked["data"] if "data" in masked else masked
        self.assertEqual(payload["api_key"], "**********")
        self.request("PATCH", url, {"data": {**payload, "name": "renamed"}})
        stored = self.client.portal.call(
            self.app.state.storage.get_credential, self.alice, cid
        )
        self.assertEqual(stored.data["api_key"], "test-resource-key-only")
        copied = self.request(
            "POST",
            (
                f"/agent-management/resources/skill/{skill['id']}/copy"
                f"?owner_id={self.alice}"
            ),
            status=201,
        )["id"]
        copy_record = self.client.portal.call(
            self.app.state.storage.get_skill, self.alice, copied
        )
        text = self.client.portal.call(
            self.app.state.resource_service.skill_store.read_file,
            copy_record.artifact_id,
            "scripts/helper.py",
        )
        self.assertEqual(text, "print('test')")
        self.request(
            "PATCH",
            f"/skill/{copied}/files?resource_owner={self.alice}",
            {
                "files": {
                    "SKILL.md": (
                        f"---\nname: {copy_record.name}\n"
                        "description: edited copy\n---\nindependent"
                    ),
                }
            },
        )
        original = self.client.portal.call(
            self.app.state.storage.get_skill, self.alice, skill["id"]
        )
        self.assertIn("old instructions", original.markdown)
        self.login("bob")
        self.request("PATCH", url, {"data": {"name": "forged"}}, 403)
        result = self.client.get(
            url, headers={**self.headers, "X-User-ID": "admin"}
        )
        self.assertEqual(result.status_code, 403)

    def test_team_agents_and_import_session_owner_check(
        self,
    ):
        team_agent = AgentRecord(
            user_id=self.alice, source="team", data=AgentData(name="worker")
        )
        self.client.portal.call(
            self.app.state.storage.upsert_agent, self.alice, team_agent
        )
        self.assertIn(
            team_agent.id,
            [
                r["id"]
                for r in self.request("GET", "/agent-management")["agents"]
            ],
        )
        self.assertNotIn(
            team_agent.id,
            [
                r.id
                for r in self.client.portal.call(
                    self.app.state.storage.list_agents, self.alice
                )
            ],
        )
        a = self.create(self.alice)
        b = self.create(self.alice)
        self.login("alice")
        sid = self.request("POST", "/sessions/", {"agent_id": b["id"]}, 201)[
            "session_id"
        ]
        self.request(
            "GET",
            self.url(a, "/copy-preview") + f"&source_session_id={sid}",
            status=404,
        )
        self.request(
            "POST",
            self.url(a, "/copy"),
            {
                "name": "x",
                "revision": a["revision"],
                "request_id": uuid4().hex,
                "target_user_id": self.bob,
            },
            403,
        )

    def test_memory_conflicts_and_reserved_paths(self):
        a = self.create(self.alice)
        first = self.request(
            "PUT",
            self.url(a, "/memory"),
            {"path": "Memory/MEMORY.md", "content": "first"},
        )
        self.request(
            "PUT",
            self.url(a, "/memory"),
            {
                "path": "Memory/MEMORY.md",
                "content": "second",
                "revision": first["revision"],
            },
        )
        self.request(
            "PUT",
            self.url(a, "/memory"),
            {
                "path": "Memory/MEMORY.md",
                "content": "stale",
                "revision": first["revision"],
            },
            409,
        )
        for path in [
            "Memory/CON.md",
            "Memory/a/../x.md",
            "Memory/a\\x.md",
            "Memory/.private.md",
        ]:
            self.request(
                "PUT",
                self.url(a, "/memory"),
                {"path": path, "content": "no"},
                422,
            )

    def test_knowledge_catalog_and_copy_binding(self):
        from agentscope.app.storage import (
            KnowledgeBaseData,
            KnowledgeBaseRecord,
        )

        kb = KnowledgeBaseRecord(
            user_id=self.alice,
            data=KnowledgeBaseData(
                name="知识库名称",
                collection_name="isolated-test-collection",
                embedding_model_config={
                    "type": "openai_credential",
                    "credential_id": "fixture",
                    "model": "test",
                    "dimensions": 3,
                    "parameters": {},
                },
            ),
        )
        self.client.portal.call(
            self.app.state.storage.upsert_knowledge_base, self.alice, kb
        )
        a = self.create(
            self.alice,
            defaults={"knowledge_config": {"knowledge_base_ids": [kb.id]}},
        )
        catalog = self.request(
            "GET", f"/agent-management/resources?owner_id={self.alice}"
        )
        self.assertEqual(
            catalog["knowledge_bases"], [{"id": kb.id, "name": "知识库名称"}]
        )
        linked = self.copy(a)
        self.assertEqual(
            linked["data"]["defaults"]["knowledge_config"][
                "knowledge_base_ids"
            ],
            [kb.id],
        )
        empty = self.copy(a, target_user_id=self.bob, knowledge_base_ids=[])
        self.assertEqual(
            empty["data"]["defaults"]["knowledge_config"][
                "knowledge_base_ids"
            ],
            [],
        )


class DefaultsAndMemoryRuntimeTest(IsolatedAsyncioTestCase):
    async def test_sql_defaults_and_detached_running_snapshot(self):
        from agentscope.app.storage import AsyncSQLAlchemyStorage
        from agentscope.app.storage._model._agent_settings import AgentDefaults
        from agentscope.permission import PermissionMode

        async with AsyncSQLAlchemyStorage(
            "sqlite+aiosqlite:///:memory:"
        ) as storage:
            a = AgentRecord(
                user_id="alice",
                data=AgentData(
                    name="a",
                    defaults=AgentDefaults(permission_mode="accept_edits"),
                ),
            )
            await storage.upsert_agent("alice", a)
            session = await storage.upsert_session(
                "alice", a.id, SessionConfig(workspace_id="separate")
            )
            snapshot = await storage.get_session("alice", a.id, session.id)
            a.data.defaults.permission_mode = PermissionMode.EXPLORE
            await storage.upsert_agent("alice", a)
            reread = await storage.get_session("alice", "", session.id)
            self.assertEqual(
                reread.state.permission_context.mode.value, "explore"
            )
            self.assertEqual(
                snapshot.state.permission_context.mode.value, "accept_edits"
            )
            self.assertIsNone(
                await storage.get_session("alice", "wrong-agent", session.id)
            )

    async def test_memory_policy_replaces_legacy_only_when_configured(self):
        from agentscope.app._service._agent_memory import configure_memory
        from agentscope.app.storage._model._agent_settings import (
            AgentMemoryConfig,
        )
        from agentscope.middleware import AgenticMemoryMiddleware
        from agentscope.tool._builtin._backend import LocalBackend
        from types import SimpleNamespace

        with tempfile.TemporaryDirectory() as root:
            workspace = SimpleNamespace(
                workdir=root, get_backend=lambda: LocalBackend()
            )
            old = AgenticMemoryMiddleware(workdir=root)
            sentinel = object()
            original = [sentinel, old]
            self.assertIs(
                await configure_memory(
                    original, None, workspace, "alice", None
                ),
                original,
            )
            disabled = await configure_memory(
                original,
                AgentMemoryConfig(enabled=False),
                workspace,
                "alice",
                None,
            )
            self.assertEqual(disabled, [sentinel])
            enabled = await configure_memory(
                original,
                AgentMemoryConfig(memory_max_tokens=8000),
                workspace,
                "alice",
                None,
            )
            self.assertEqual(len(enabled), 2)
            self.assertIsInstance(enabled[1], AgenticMemoryMiddleware)
            self.assertIsNot(enabled[1], old)
