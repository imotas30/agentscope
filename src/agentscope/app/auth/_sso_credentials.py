# -*- coding: utf-8 -*-
"""Backward-compatible re-export for SSO credential seeding."""

from ._sso_bootstrap import seed_admin_credentials_if_empty

__all__ = ["seed_admin_credentials_if_empty"]
