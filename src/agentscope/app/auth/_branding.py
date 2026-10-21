"""Validated, public browser branding; writes use the admin boundary."""

import base64
import binascii
import re

import filetype
from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_LOGO_BYTES = 512 * 1024
MAX_LOGO_DATA_URL_LENGTH = 4 * ((MAX_LOGO_BYTES + 2) // 3) + 64
LOGO_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/x-icon",
    "image/vnd.microsoft.icon",
}


class BrandingSettings(BaseModel):
    """Only public display values belong in this globally shared record."""

    model_config = ConfigDict(extra="forbid")

    browser_title: str = Field(
        default="BudgetOntology", min_length=1, max_length=80
    )
    logo_data_url: str | None = Field(
        default=None, max_length=MAX_LOGO_DATA_URL_LENGTH
    )

    @field_validator("browser_title", mode="before")
    @classmethod
    def clean_title(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            if any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in value):
                raise ValueError("浏览器标题不能包含控制字符。")
        return value

    @field_validator("logo_data_url")
    @classmethod
    def validate_logo(cls, value: str | None) -> str | None:
        if value is None:
            return None
        match = re.fullmatch(
            r"data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})", value
        )
        if match is None or match[1] not in LOGO_TYPES:
            raise ValueError("请选择 PNG、JPEG、WebP 或 ICO 图标。")
        try:
            image = base64.b64decode(match[2], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("图标内容无效。") from exc
        if not image or len(image) > MAX_LOGO_BYTES:
            raise ValueError("图标大小不能超过 512 KB。")
        detected = filetype.guess(image)
        declared = (
            "image/x-icon"
            if match[1] == "image/vnd.microsoft.icon"
            else match[1]
        )
        if detected is None or detected.mime != declared:
            raise ValueError("图标内容与图片格式不匹配。")
        # Use a canonical MIME type and encoding when sending it to browsers.
        return f"data:{declared};base64,{base64.b64encode(image).decode()}"
