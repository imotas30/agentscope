"""Password authentication integration tests against isolated Redis storage."""

import asyncio
import base64
import tempfile
from types import SimpleNamespace
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

import fakeredis.aioredis
from fastapi import Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from agentscope.app import create_app
from agentscope.app.auth import AuthService, AuthSettings, RedisAuthStore
from agentscope.app.auth._branding import MAX_LOGO_BYTES
from agentscope.app.auth._http import NewUser
from agentscope.app.deps import (
    get_current_user_id,
    get_workspace_service,
    get_knowledge_base_service,
)
from agentscope.app.message_bus import InMemoryMessageBus
from agentscope.app.storage import RedisStorage, AgentData, AgentRecord
from agentscope.app.workspace_manager import LocalWorkspaceManager

ADMIN_PASSWORD = "Admin-test-password-42"
USER_PASSWORD = "User-test-password-42"
ORIGIN = {"Origin": "http://testserver"}
BRANDING_DEFAULTS = {
    "browser_title": "BudgetOntology",
    "logo_data_url": None,
}
# A real 1x1 PNG, independent of the example frontend's bundled assets.
BRANDING_LOGO = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/x8AAwMCAO+aX1sAAAAASUVORK5CYII="
)


class FakeAuthStore(RedisAuthStore):
    def __init__(self, server=None):
        super().__init__()
        self.server = server or fakeredis.FakeServer()

    async def __aenter__(self):
        self.client = fakeredis.aioredis.FakeRedis(
            server=self.server, decode_responses=True
        )
        return self


def make_app(workdir, password=ADMIN_PASSWORD, server=None, secure=False):
    class FakeStorage(RedisStorage):
        async def __aenter__(self):
            self._client = fakeredis.aioredis.FakeRedis(decode_responses=True)
            return self

    service = AuthService(
        FakeAuthStore(server),
        AuthSettings(admin_password=password, cookie_secure=secure),
    )
    app = create_app(
        storage=FakeStorage(),
        message_bus=InMemoryMessageBus(),
        workspace_manager=LocalWorkspaceManager(workdir),
        enable_index_worker=False,
        enable_scheduler=False,
        auth_service=service,
    )

    @app.get("/test/identity")
    async def identity(uid=Depends(get_current_user_id)):
        return {"id": uid}

    @app.post("/test/upload")
    async def upload(
        file: UploadFile = File(), uid=Depends(get_current_user_id)
    ):
        return {"id": uid, "content": (await file.read()).decode()}

    @app.get("/test/events")
    async def events(uid=Depends(get_current_user_id)):
        async def stream():
            yield f"data: {uid}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    return app, service


class UserAuthTest(TestCase):
    def setUp(self):
        self.workdir = self.enterContext(tempfile.TemporaryDirectory())
        self.app, self.auth = make_app(self.workdir)
        self.client = self.enterContext(TestClient(self.app))

    def login(self, username="admin", password=ADMIN_PASSWORD):
        self.client.cookies.clear()
        response = self.client.post(
            "/auth/login",
            json={"username": username, "password": password},
            headers=ORIGIN,
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.headers = {**ORIGIN, "X-CSRF-Token": data["csrf_token"]}
        return response

    def create(self, username="alice", **kwargs):
        response = self.client.post(
            "/admin/users",
            json={"username": username, "password": USER_PASSWORD, **kwargs},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertNotIn("password_hash", response.text)
        return response.json()

    def test_branding_public_read_does_not_open_other_endpoints(self):
        response = self.client.get("/branding")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), BRANDING_DEFAULTS)
        self.assertEqual(response.headers["cache-control"], "no-store")
        for method, path in (
            ("PUT", "/admin/branding"),
            ("POST", "/branding"),
            ("GET", "/branding/private"),
            ("GET", "/admin/branding"),
        ):
            with self.subTest(method=method, path=path):
                response = self.client.request(
                    method,
                    path,
                    json=BRANDING_DEFAULTS,
                    headers={**ORIGIN, "X-User-ID": "admin"},
                )
                self.assertEqual(response.status_code, 401, response.text)

    def test_admin_branding_save_read_and_reset(self):
        self.login()
        response = self.client.put(
            "/admin/branding",
            json={
                "browser_title": "  Budget Portal  ",
                "logo_data_url": BRANDING_LOGO,
            },
            headers=self.headers,
        )
        expected = {
            "browser_title": "Budget Portal",
            "logo_data_url": BRANDING_LOGO,
        }
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), expected)
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/branding").json(), expected)
        self.login()
        response = self.client.put(
            "/admin/branding",
            json=BRANDING_DEFAULTS,
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/branding").json(), BRANDING_DEFAULTS)

    def test_branding_normal_user_cannot_write_or_spoof_admin(self):
        self.login()
        self.create()
        expected = {
            "browser_title": "Admin configured title",
            "logo_data_url": BRANDING_LOGO,
        }
        self.assertEqual(
            self.client.put(
                "/admin/branding", json=expected, headers=self.headers
            ).status_code,
            200,
        )
        self.login("alice", USER_PASSWORD)
        self.assertEqual(self.client.get("/branding").json(), expected)
        response = self.client.put(
            "/admin/branding",
            json=BRANDING_DEFAULTS,
            headers={**self.headers, "X-User-ID": "admin"},
        )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.client.get("/branding").json(), expected)

    def test_branding_writes_require_csrf_and_origin(self):
        self.login()
        for headers in (
            ORIGIN,
            {"X-CSRF-Token": self.headers["X-CSRF-Token"]},
            {**self.headers, "Origin": "https://untrusted.example"},
        ):
            with self.subTest(headers=list(headers)):
                response = self.client.put(
                    "/admin/branding",
                    json={"browser_title": "Rejected", "logo_data_url": None},
                    headers=headers,
                )
                self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.client.get("/branding").json(), BRANDING_DEFAULTS)

    def test_branding_validation_preserves_previous_config(self):
        self.login()
        oversized_png = (
            b"\x89PNG\r\n\x1a\n" + b"\0" * MAX_LOGO_BYTES
        )
        for patch in (
            {"browser_title": ""},
            {"browser_title": " \t "},
            {"browser_title": "x" * 81},
            {"browser_title": "Invalid\nTitle"},
            {"browser_title": None},
            {"logo_data_url": "https://example.com/logo.png"},
            {"logo_data_url": "javascript:alert(1)"},
            {"logo_data_url": "data:image/svg+xml;base64,PHN2Zy8+"},
            {"logo_data_url": "data:image/png;base64,PGh0bWw+"},
            {"logo_data_url": "data:image/png;base64,invalid"},
            {"logo_data_url": BRANDING_LOGO.replace("image/png", "image/jpeg")},
            {
                "logo_data_url": "data:image/png;base64,"
                + base64.b64encode(oversized_png).decode()
            },
            {"role": "admin"},
        ):
            with self.subTest(fields=list(patch)):
                response = self.client.put(
                    "/admin/branding",
                    json={**BRANDING_DEFAULTS, **patch},
                    headers=self.headers,
                )
                self.assertEqual(response.status_code, 422, response.text[:200])
                self.assertEqual(
                    self.client.get("/branding").json(), BRANDING_DEFAULTS
                )

    def test_branding_is_shared_and_survives_service_restart(self):
        self.login()
        expected = {
            "browser_title": "Shared branding",
            "logo_data_url": BRANDING_LOGO,
        }
        response = self.client.put(
            "/admin/branding", json=expected, headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        server = self.auth.store.server
        with tempfile.TemporaryDirectory() as workdir:
            app, _ = make_app(workdir, server=server)
            with TestClient(app) as replica:
                self.assertEqual(replica.get("/branding").json(), expected)
            # A new application and auth-store instance still reads the record.
            app, service = make_app(workdir, server=server)
            with TestClient(app) as restarted:
                self.assertEqual(restarted.get("/branding").json(), expected)
                self.assertEqual(
                    restarted.portal.call(
                        service.store.connection.ttl,
                        service.store.prefix + "branding",
                    ),
                    -1,
                )

    def test_no_header_or_download_token_bypasses_login(self):
        for url in (
            "/health",
            "/agents/",
            "/admin/users",
            "/docs",
            "/openapi.json",
            "/workspace/files?agent_id=a&session_id=s&path=x&token=forged",
            "/knowledge_bases/k/documents/d?token=forged",
        ):
            with self.subTest(url=url):
                response = self.client.get(url, headers={"X-User-ID": "admin"})
                self.assertEqual(response.status_code, 401, response.text)

    def test_cookie_restore_logout_and_header_spoof(self):
        response = self.login()
        cookie = response.headers["set-cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=lax", cookie)
        self.assertEqual(
            self.client.get("/auth/me").json()["user"]["role"], "admin"
        )
        self.assertEqual(
            self.client.get(
                "/test/identity", headers={"X-User-ID": "someone-else"}
            ).json(),
            {"id": "admin"},
        )
        token = self.client.cookies.get("agentscope_session")
        self.assertEqual(
            self.client.post("/auth/logout", headers=self.headers).status_code,
            204,
        )
        self.client.cookies.set("agentscope_session", token)
        self.assertEqual(self.client.get("/auth/me").status_code, 401)

    def test_crud_search_pagination_and_soft_delete(self):
        self.login()
        alice = self.create(display_name="Alice")
        bob = self.create("bob")
        response = self.client.get("/admin/users?q=ali&limit=1")
        self.assertEqual(response.json()["total"], 1)
        self.assertEqual(response.json()["items"][0]["id"], alice["id"])
        self.assertEqual(
            self.client.get("/admin/users?limit=1&offset=2").json()["items"][
                0
            ]["id"],
            bob["id"],
        )
        edited = self.client.patch(
            f'/admin/users/{alice["id"]}',
            json={"username": "alicia", "display_name": "New name"},
            headers=self.headers,
        )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()["id"], alice["id"])
        self.assertEqual(
            self.client.get(f'/admin/users/{alice["id"]}').json()["username"],
            "alicia",
        )
        self.assertEqual(
            self.client.delete(
                f'/admin/users/{alice["id"]}', headers=self.headers
            ).status_code,
            204,
        )
        replacement = self.create("alicia")
        self.assertNotEqual(alice["id"], replacement["id"])
        self.assertEqual(
            self.client.get("/admin/users?status=deleted").json()["items"][0][
                "id"
            ],
            alice["id"],
        )

    def test_normal_user_cannot_manage_users_or_spoof_admin(self):
        self.login()
        user = self.create()
        self.login("alice", USER_PASSWORD)
        self.assertEqual(
            self.client.get(
                "/test/identity", headers={"X-User-ID": "admin"}
            ).json(),
            {"id": user["id"]},
        )
        for method, url, body in (
            ("GET", "/admin/users", None),
            ("GET", f'/admin/users/{user["id"]}', None),
            (
                "POST",
                "/admin/users",
                {"username": "other", "password": USER_PASSWORD},
            ),
            ("PATCH", f'/admin/users/{user["id"]}', {"status": "disabled"}),
            (
                "POST",
                f'/admin/users/{user["id"]}/reset-password',
                {"password": USER_PASSWORD},
            ),
            ("DELETE", f'/admin/users/{user["id"]}', None),
        ):
            response = self.client.request(
                method,
                url,
                json=body,
                headers={**self.headers, "X-User-ID": "admin"},
            )
            self.assertEqual(response.status_code, 403, response.text)

    def test_admin_is_protected_and_role_cannot_be_assigned(self):
        self.login()
        for method, url, body in (
            ("PATCH", "/admin/users/admin", {"status": "disabled"}),
            ("PATCH", "/admin/users/admin", {"username": "root"}),
            ("DELETE", "/admin/users/admin", None),
            (
                "POST",
                "/admin/users/admin/reset-password",
                {"password": USER_PASSWORD},
            ),
        ):
            response = self.client.request(
                method, url, json=body, headers=self.headers
            )
            self.assertEqual(response.status_code, 403, response.text)
        response = self.client.post(
            "/admin/users",
            json={
                "username": "hacker",
                "password": USER_PASSWORD,
                "role": "admin",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)
        response = self.client.post(
            "/admin/users",
            json={"username": "Admin", "password": USER_PASSWORD},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 409)

    def test_csrf_and_origin_checks_cover_login_and_mutations(self):
        response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": ADMIN_PASSWORD},
            headers={"Origin": "https://evil.example"},
        )
        self.assertEqual(response.status_code, 403)
        self.login()
        for headers in (
            ORIGIN,
            {"X-CSRF-Token": self.headers["X-CSRF-Token"]},
            {**self.headers, "Origin": "https://evil.example"},
        ):
            response = self.client.post(
                "/admin/users",
                json={"username": "alice", "password": USER_PASSWORD},
                headers=headers,
            )
            self.assertEqual(response.status_code, 403)

    def test_reset_disable_enable_and_delete_revoke_sessions(self):
        self.login()
        admin_cookie = self.client.cookies.get("agentscope_session")
        admin_headers = self.headers.copy()
        user = self.create()
        self.login("alice", USER_PASSWORD)
        old_cookie = self.client.cookies.get("agentscope_session")
        self.client.cookies.clear()
        self.client.cookies.set("agentscope_session", admin_cookie)
        self.headers = admin_headers
        response = self.client.post(
            f'/admin/users/{user["id"]}/reset-password',
            json={"password": "Changed-password-43"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(
            self.client.get(
                "/auth/me",
                headers={"Cookie": f"agentscope_session={old_cookie}"},
            ).status_code,
            401,
        )
        self.login("alice", "Changed-password-43")
        cookie = self.client.cookies.get("agentscope_session")
        self.client.cookies.clear()
        self.client.cookies.set("agentscope_session", admin_cookie)
        for status in ("disabled", "active"):
            self.assertEqual(
                self.client.patch(
                    f'/admin/users/{user["id"]}',
                    json={"status": status},
                    headers=admin_headers,
                ).status_code,
                200,
            )
            self.assertEqual(
                self.client.get(
                    "/auth/me",
                    headers={"Cookie": f"agentscope_session={cookie}"},
                ).status_code,
                401,
            )
        self.assertEqual(
            self.client.delete(
                f'/admin/users/{user["id"]}', headers=admin_headers
            ).status_code,
            204,
        )
        self.assertEqual(
            self.client.post(
                "/auth/login",
                json={"username": "alice", "password": "Changed-password-43"},
                headers=ORIGIN,
            ).status_code,
            401,
        )

    def test_change_own_password_requires_current_password(self):
        self.login()
        self.create()
        self.login("alice", USER_PASSWORD)
        response = self.client.post(
            "/auth/password",
            json={
                "current_password": "wrong",
                "password": "Changed-password-43",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            "/auth/password",
            json={
                "current_password": USER_PASSWORD,
                "password": "Changed-password-43",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.client.get("/auth/me").status_code, 401)
        self.login("alice", "Changed-password-43")

    def test_legacy_identity_is_retained_and_cannot_be_rebound(self):
        self.login()
        user = self.create("new-name", legacy_user_id="旧用户")
        self.assertEqual(user["id"], "旧用户")
        admin_cookie = self.client.cookies.get("agentscope_session")
        admin_headers = self.headers.copy()
        self.login("new-name", USER_PASSWORD)
        self.assertEqual(
            self.client.get("/test/identity").json(), {"id": "旧用户"}
        )
        self.client.cookies.clear()
        self.client.cookies.set("agentscope_session", admin_cookie)
        self.client.delete("/admin/users/旧用户", headers=admin_headers)
        response = self.client.post(
            "/admin/users",
            json={
                "username": "another",
                "password": USER_PASSWORD,
                "legacy_user_id": "旧用户",
            },
            headers=admin_headers,
        )
        self.assertEqual(response.status_code, 409)

    def test_legacy_login_restores_existing_agent_configuration(self):
        """Adding authentication must preserve old records and ownership."""
        legacy = AgentRecord(
            user_id="wx",
            data=AgentData(
                name="Existing agent",
                system_prompt="Keep the original instructions.",
                resource_config={
                    "mcps": {
                        "legacy-mcp": {
                            "enabled": False,
                            "binding_id": "original-mcp-binding",
                        }
                    },
                    "skills": {
                        "legacy-skill": {
                            "enabled": True,
                            "binding_id": "original-skill-binding",
                        }
                    },
                },
            ),
        )
        unrelated = AgentRecord(
            user_id="someone-else", data=AgentData(name="Private agent")
        )
        storage = self.app.state.storage
        self.client.portal.call(storage.upsert_agent, "wx", legacy)
        self.client.portal.call(
            storage.upsert_agent, "someone-else", unrelated
        )
        self.login()
        self.assertEqual(self.client.get("/agent/").json()["total"], 0)
        account = self.create("wx", legacy_user_id="wx")
        self.assertEqual(account["role"], "user")

        self.login("wx", USER_PASSWORD)
        response = self.client.get("/agent/")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["total"], 1)
        restored = response.json()["agents"][0]
        self.assertEqual(restored["id"], legacy.id)
        self.assertEqual(restored["user_id"], "wx")
        self.assertEqual(restored["data"], legacy.data.model_dump(mode="json"))
        self.assertTrue(restored["editable"])
        self.assertEqual(self.client.get("/admin/users").status_code, 403)

        # Changing the login name later must not change the storage owner.
        self.login()
        response = self.client.patch(
            "/admin/users/wx",
            json={"username": "wx-renamed"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.login("wx-renamed", USER_PASSWORD)
        self.assertEqual(
            self.client.get("/agent/").json()["agents"][0]["id"], legacy.id
        )
        persisted = self.client.portal.call(storage.get_agent, "wx", legacy.id)
        self.assertEqual(persisted, legacy)

    def test_download_routes_use_logged_in_owner_even_with_forged_token(self):
        self.login()
        alice = self.create()
        self.login("alice", USER_PASSWORD)

        async def resolve(uid, *args, **kwargs):
            raise HTTPException(418, uid)

        workspace = SimpleNamespace(resolve=resolve)
        self.app.dependency_overrides[get_workspace_service] = (
            lambda: workspace
        )
        response = self.client.get(
            "/workspace/files?agent_id=a&session_id=s&path=x&token=forged",
            headers={"X-User-ID": "admin"},
        )
        self.assertEqual(response.status_code, 418, response.text)
        self.assertEqual(response.json()["detail"], alice["id"])

        async def content(user_id, **kwargs):
            raise HTTPException(418, user_id)

        self.app.dependency_overrides[get_knowledge_base_service] = (
            lambda: SimpleNamespace(stream_document_content=content)
        )
        response = self.client.get(
            "/knowledge_bases/k/documents/d?token=forged",
            headers={"X-User-ID": "admin"},
        )
        self.assertEqual(response.status_code, 418, response.text)
        self.assertEqual(response.json()["detail"], alice["id"])

    def test_failed_logins_are_limited(self):
        for _ in range(10):
            response = self.client.post(
                "/auth/login",
                json={"username": "admin", "password": "incorrect"},
                headers=ORIGIN,
            )
            self.assertEqual(response.status_code, 401)
        response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": ADMIN_PASSWORD},
            headers=ORIGIN,
        )
        self.assertEqual(response.status_code, 429)

    def test_cookie_authentication_covers_multipart_and_sse(self):
        self.login()
        user = self.create()
        self.login("alice", USER_PASSWORD)
        response = self.client.post(
            "/test/upload",
            files={"file": ("test.txt", b"hello")},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json(), {"id": user["id"], "content": "hello"}
        )
        denied = self.client.post(
            "/test/upload",
            files={"file": ("test.txt", b"hello")},
            headers=ORIGIN,
        )
        self.assertEqual(denied.status_code, 403)
        response = self.client.get(
            "/test/events", headers={"X-User-ID": "admin"}
        )
        self.assertEqual(response.text, f'data: {user["id"]}\n\n')

    def test_report_download_uses_current_login_instead_of_token_identity(
        self,
    ):
        import sys
        from pathlib import Path

        sys.path.insert(
            0,
            str(
                Path(__file__).resolve().parents[1]
                / "examples"
                / "agent_service"
            ),
        )
        from analysis_extension.router import create_analysis_router

        self.app.include_router(
            create_analysis_router(Path(self.workdir) / "config.json")
        )
        self.login()
        user = self.create()
        self.login("alice", USER_PASSWORD)

        async def access(uid, *_):
            raise HTTPException(418, uid)

        self.app.state.resource_access_service = SimpleNamespace(
            get_resource=access
        )
        response = self.client.get(
            "/workspace/analyses/report",
            params={
                "agent_id": "a",
                "session_id": "s",
                "analysis_ref": "x",
                "export_ref": "r",
                "token": "forged",
            },
            headers={"X-User-ID": "admin"},
        )
        self.assertEqual(response.status_code, 418, response.text)
        self.assertEqual(response.json()["detail"], user["id"])

    def test_api_responses_do_not_cache_identity_or_expose_passwords(self):
        self.login()
        self.assertEqual(
            self.client.get("/auth/me").headers["cache-control"], "no-store"
        )
        self.assertNotIn("password", self.client.get("/admin/users").text)
        response = self.client.post(
            "/admin/users",
            json={"username": "alice", "password": "tiny"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('"tiny"', response.text)


class AuthServiceTest(IsolatedAsyncioTestCase):
    async def test_concurrent_worker_bootstrap_rotates_admin_only_once(self):
        server = fakeredis.FakeServer()
        async with AuthService(
            FakeAuthStore(server), AuthSettings(admin_password=ADMIN_PASSWORD)
        ) as first:
            token, _, _ = await first.login("admin", ADMIN_PASSWORD, "test")
            replicas = [
                AuthService(
                    FakeAuthStore(server),
                    AuthSettings(admin_password="rotated-password-123"),
                )
                for _ in range(2)
            ]
            try:
                await asyncio.gather(
                    *(replica.__aenter__() for replica in replicas)
                )
                self.assertEqual(
                    (await first.store.user("admin"))["auth_version"], 2
                )
                self.assertIsNone(await first.authenticate(token))
                fresh, _, _ = await replicas[0].login(
                    "admin", "rotated-password-123", "test"
                )
                self.assertIsNotNone(await replicas[1].authenticate(fresh))
            finally:
                await asyncio.gather(
                    *(
                        replica.__aexit__(None, None, None)
                        for replica in replicas
                    )
                )

    async def test_disabled_accounts_cannot_trigger_background_work(
        self,
    ):
        from agentscope.app._manager import (
            SchedulerManager,
            WakeupDispatcher,
            ChatRunRegistry,
        )
        from agentscope.app.channel import ChannelGateway

        denied = SimpleNamespace(is_active=AsyncMock(return_value=False))
        storage, bus, workspace = AsyncMock(), AsyncMock(), AsyncMock()
        scheduler = SchedulerManager(
            storage, bus, workspace, enabled=False, auth_service=denied
        )
        record = SimpleNamespace(
            id="schedule",
            user_id="disabled",
            data=SimpleNamespace(name="test", enabled=True),
        )
        await scheduler._build_trigger(record)()
        self.assertFalse(storage.mock_calls)
        self.assertFalse(bus.mock_calls)
        dispatcher = WakeupDispatcher(
            bus, storage, AsyncMock(), ChatRunRegistry(), auth_service=denied
        )
        await dispatcher._dispatch_one(
            "disabled", "session", "agent", "wake", None
        )
        self.assertFalse(storage.mock_calls)
        storage.get_channel.return_value = SimpleNamespace(user_id="disabled")
        gateway = ChannelGateway(storage, bus, workspace, auth_service=denied)
        await gateway.process(SimpleNamespace(channel_id="channel"))
        self.assertFalse(bus.mock_calls)

    async def test_restart_keeps_sessions_unless_password_changes(
        self,
    ):
        server = fakeredis.FakeServer()
        async with AuthService(
            FakeAuthStore(server), AuthSettings(admin_password=ADMIN_PASSWORD)
        ) as auth:
            token, _, _ = await auth.login("admin", ADMIN_PASSWORD, "test")
        async with AuthService(
            FakeAuthStore(server), AuthSettings(admin_password=ADMIN_PASSWORD)
        ) as auth:
            self.assertIsNotNone(await auth.authenticate(token))
        async with AuthService(
            FakeAuthStore(server),
            AuthSettings(admin_password="Rotated-password-44"),
        ) as auth:
            self.assertIsNone(await auth.authenticate(token))
            await auth.login("admin", "Rotated-password-44", "test")

    async def test_duplicate_creation_is_atomic_and_password_is_hashed(
        self,
    ):
        async with AuthService(
            FakeAuthStore(), AuthSettings(admin_password=ADMIN_PASSWORD)
        ) as auth:
            results = await asyncio.gather(
                *(
                    auth.create_user(
                        NewUser(username="alice", password=USER_PASSWORD)
                    )
                    for _ in range(2)
                ),
                return_exceptions=True,
            )
            self.assertEqual(sum(isinstance(r, dict) for r in results), 1)
            user = next(r for r in results if isinstance(r, dict))
            self.assertTrue(user["password_hash"].startswith("$argon2id$"))
            self.assertNotIn(USER_PASSWORD, user["password_hash"])

    async def test_expired_sessions_fail_and_streams_cancel_on_revocation(
        self,
    ):
        async with AuthService(
            FakeAuthStore(), AuthSettings(admin_password=ADMIN_PASSWORD)
        ) as auth:
            user = await auth.create_user(
                NewUser(username="alice", password=USER_PASSWORD)
            )
            token, session, _ = await auth.login(
                "alice", USER_PASSWORD, "test"
            )
            cancelled = asyncio.Event()

            async def stream():
                try:
                    await asyncio.sleep(30)
                finally:
                    cancelled.set()

            guarded = asyncio.create_task(auth.guard_request(token, stream()))
            await auth.edit_user(user["id"], {"status": "disabled"})
            with self.assertRaises(HTTPException):
                await asyncio.wait_for(guarded, 5)
            self.assertTrue(cancelled.is_set())
            session["expires_at"] = 0
            await auth.store.save_session(token, session, 60)
            self.assertIsNone(await auth.authenticate(token))

    async def test_runtime_monitor_cancels_disabled_user_work(self):
        async with AuthService(
            FakeAuthStore(), AuthSettings(admin_password=ADMIN_PASSWORD)
        ) as auth:
            user = await auth.create_user(
                NewUser(username="alice", password=USER_PASSWORD)
            )
            task = asyncio.create_task(asyncio.sleep(30))
            background = asyncio.create_task(asyncio.sleep(30))
            connection = SimpleNamespace(close=AsyncMock())
            app = SimpleNamespace(
                state=SimpleNamespace(
                    chat_run_registry=SimpleNamespace(
                        owners={"s": user["id"]}, get=lambda _: task
                    ),
                    background_task_manager=SimpleNamespace(
                        tasks={
                            "b": SimpleNamespace(
                                user_id=user["id"], asyncio_task=background
                            )
                        }
                    ),
                    realtime_connections={(user["id"], "s"): connection},
                )
            )
            monitor = asyncio.create_task(auth.monitor_runtime(app))
            try:
                await auth.edit_user(user["id"], {"status": "disabled"})
                await asyncio.sleep(1.2)
                self.assertTrue(task.cancelled())
                self.assertTrue(background.cancelled())
                connection.close.assert_awaited()
            finally:
                monitor.cancel()
                task.cancel()
                background.cancel()
                await asyncio.gather(
                    monitor, task, background, return_exceptions=True
                )
