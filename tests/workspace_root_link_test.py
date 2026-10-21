"""Deployment root links must not disable agent file isolation."""

import os
import tempfile
from pathlib import Path
from unittest import TestCase
from uuid import uuid4

from fastapi.testclient import TestClient

from tests.user_auth_test import ADMIN_PASSWORD, ORIGIN, make_app


def directory_link(link, target):
    """Use Windows junctions, which need no symlink privilege."""
    if os.name == "nt":
        import _winapi

        _winapi.CreateJunction(str(target), str(link))
    else:
        link.symlink_to(target, target_is_directory=True)


def remove_directory_link(link):
    """Remove only the link, never the directory it points at."""
    if os.name == "nt":
        link.rmdir()
    else:
        link.unlink()


class WorkspaceRootLinkTest(TestCase):
    def setUp(self):
        self.root = Path(
            self.enterContext(tempfile.TemporaryDirectory())
        ).resolve()
        self.data = self.root / "data"
        self.data.mkdir()
        self.link = self.root / "workspaces"
        directory_link(self.link, self.data)
        self.addCleanup(remove_directory_link, self.link)
        self.app, _ = make_app(str(self.link))
        self.client = self.enterContext(TestClient(self.app))
        response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": ADMIN_PASSWORD},
            headers=ORIGIN,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.headers = {
            **ORIGIN,
            "X-CSRF-Token": response.json()["csrf_token"],
        }

    def request(self, method, path, body=None, status=200):
        response = self.client.request(
            method, path, json=body, headers=self.headers
        )
        self.assertEqual(response.status_code, status, response.text)
        return response.json() if response.content else None

    def create(self):
        return self.request(
            "POST", "/agent-management", {"name": "Root link test"}, 201
        )

    def test_memory_and_file_copy_through_deployment_link(self):
        agent = self.create()
        url = f"/agent-management/{agent['id']}"
        self.request(
            "PUT",
            url + "/memory",
            {"path": "Memory/MEMORY.md", "content": "original"},
        )
        source = self.data / agent["id"]
        (source / "result.txt").write_text("result", encoding="utf-8")
        preview = self.request("GET", url + "/copy-preview")
        self.assertEqual(
            [p["path"] for p in preview["memory"]], ["Memory/MEMORY.md"]
        )
        self.assertEqual([p["path"] for p in preview["files"]], ["result.txt"])
        memory = self.request("GET", url + "/memory?path=Memory/MEMORY.md")
        self.assertEqual(memory["content"], "original")
        copied = self.request(
            "POST",
            url + "/copy",
            {
                "name": "Copy",
                "request_id": uuid4().hex,
                "revision": agent["revision"],
                "memory": True,
                "files": ["result.txt"],
            },
            201,
        )
        target = self.data / copied["id"]
        self.assertEqual((target / "result.txt").read_text(), "result")
        self.assertEqual((target / "Memory/MEMORY.md").read_text(), "original")
        self.request(
            "PUT",
            f"/agent-management/{copied['id']}/memory",
            {
                "path": "Memory/MEMORY.md",
                "content": "copy only",
                "revision": memory["revision"],
            },
        )
        self.assertEqual((source / "Memory/MEMORY.md").read_text(), "original")
        self.request(
            "PUT",
            url + "/memory",
            {"path": "Memory/../../outside.md", "content": "no"},
            422,
        )

    def test_internal_directory_links_still_rejected(self):
        agent, other = self.create(), self.create()
        url = f"/agent-management/{agent['id']}"
        self.request(
            "PUT",
            url + "/memory",
            {"path": "Memory/MEMORY.md", "content": "original"},
        )
        memory = self.data / agent["id"] / "Memory"
        targets = [
            memory / "actual",
            self.data / other["id"],
            self.root / "outside",
        ]
        for target in targets:
            with self.subTest(target=target.name):
                target.mkdir(exist_ok=True)
                (target / "note.md").write_text("protected", encoding="utf-8")
                alias = memory / "alias"
                directory_link(alias, target)
                try:
                    self.request(
                        "GET",
                        url + "/memory?path=Memory/alias/note.md",
                        status=403,
                    )
                    self.request(
                        "PUT",
                        url + "/memory",
                        {"path": "Memory/alias/note.md", "content": "no"},
                        403,
                    )
                    preview = self.request("GET", url + "/copy-preview")
                    self.assertTrue(preview["file_error"])
                    self.assertEqual(preview["memory"], [])
                    self.request(
                        "POST",
                        url + "/copy",
                        {
                            "name": "Rejected copy",
                            "request_id": uuid4().hex,
                            "revision": agent["revision"],
                            "memory": True,
                        },
                        403,
                    )
                    self.assertEqual(
                        (target / "note.md").read_text(), "protected"
                    )
                finally:
                    remove_directory_link(alias)

    def test_linked_agent_directory_still_rejected(self):
        agent = self.create()
        root = self.data / agent["id"]
        # Provision the alias before the workspace is first opened.
        self.assertFalse(root.exists())
        target = self.root / "agent-data"
        (target / "Memory").mkdir(parents=True)
        (target / "Memory/MEMORY.md").write_text("protected", encoding="utf-8")
        directory_link(root, target)
        try:
            self.request(
                "GET",
                f"/agent-management/{agent['id']}/memory?path=Memory/MEMORY.md",
                status=403,
            )
            self.request(
                "PUT",
                f"/agent-management/{agent['id']}/memory",
                {"path": "Memory/MEMORY.md", "content": "no"},
                403,
            )
            self.assertEqual(
                (target / "Memory/MEMORY.md").read_text(), "protected"
            )
        finally:
            remove_directory_link(root)

    def test_file_symlink_still_rejected(self):
        if os.name == "nt":
            self.skipTest(
                "File symlink test runs on Unix; junctions are tested on Windows"
            )
        agent = self.create()
        url = f"/agent-management/{agent['id']}"
        self.request(
            "PUT",
            url + "/memory",
            {"path": "Memory/MEMORY.md", "content": "original"},
        )
        memory = self.data / agent["id"] / "Memory"
        (memory / "alias.md").symlink_to(memory / "MEMORY.md")
        self.request("GET", url + "/memory?path=Memory/alias.md", status=403)
        self.request(
            "PUT",
            url + "/memory",
            {"path": "Memory/alias.md", "content": "no"},
            403,
        )
        self.assertEqual((memory / "MEMORY.md").read_text(), "original")
