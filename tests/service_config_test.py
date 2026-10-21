"""Configuration precedence and validation without starting Redis or the app."""
import json
from pathlib import Path
import sys
import tempfile
from unittest import TestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'examples' / 'agent_service'))
from service_config import auth_settings, redis_settings


class ServiceConfigTest(TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / 'config.json'

    def test_defaults_need_no_secret(self):
        self.assertEqual(redis_settings(self.path, {}), {'host': 'localhost', 'port': 6379, 'db': 0, 'password': None})

    def test_environment_overrides_local_settings_including_empty_password(self):
        self.path.write_text(json.dumps({'redis': {'host': 'local', 'port': 6380, 'password': 'test-only'}}))
        self.assertEqual(redis_settings(self.path, {'AGENTSCOPE_REDIS_HOST': 'server', 'AGENTSCOPE_REDIS_DB': '2',
                                                    'AGENTSCOPE_REDIS_PASSWORD': ''}),
                         {'host': 'server', 'port': 6380, 'db': 2, 'password': None})

    def test_bad_configuration_fails_without_echoing_values(self):
        for config in ({'redsi': {}}, {'redis': []}, {'redis': {'port': True}}, {'redis': {'port': 70000}},
                       {'redis': {'db': -1}}, {'redis': {'host': ''}}, {'redis': {'password': 123}}):
            with self.subTest(config=config):
                self.path.write_text(json.dumps(config))
                with self.assertRaises(ValueError):
                    redis_settings(self.path, {})

    def test_auth_requires_password_and_environment_overrides_file(self):
        with self.assertRaises(ValueError):
            auth_settings(self.path, {})
        self.path.write_text(json.dumps({'redis': {}, 'auth': {'admin_password': 'local-password-123'}}))
        config = auth_settings(self.path, {'AGENTSCOPE_ADMIN_PASSWORD': 'env-password-123',
                                          'AGENTSCOPE_COOKIE_SECURE': 'true', 'AGENTSCOPE_SESSION_TTL_SECONDS': '600'})
        self.assertEqual(config.admin_password.get_secret_value(), 'env-password-123')
        self.assertTrue(config.cookie_secure)
        self.assertEqual(config.session_ttl_seconds, 600)
        self.assertEqual(redis_settings(self.path, {})['host'], 'localhost')

    def test_invalid_auth_never_echoes_secrets(self):
        for values in ({'admin_password': 'short'}, {'admin_password': 'CHANGE_ME'},
                       {'admin_password': 'secret-example-123', 'session_ttl_seconds': 0},
                       {'admin_password': 'secret-example-123', 'unknown': 'sensitive'}):
            self.path.write_text(json.dumps({'auth': values}))
            with self.assertRaises(ValueError) as raised:
                auth_settings(self.path, {})
            self.assertNotIn(values['admin_password'], str(raised.exception))
