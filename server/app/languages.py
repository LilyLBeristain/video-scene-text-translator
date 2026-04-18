"""Curated list of supported source/target languages for the MVP (plan.md D12).

Single source of truth for the language dropdown. The server exposes this list
via `GET /api/languages` so the frontend never duplicates it. Adding a language
for the demo is a one-line edit here.
"""

from __future__ import annotations

from pydantic import BaseModel


class Language(BaseModel):
    """A selectable source/target language."""

    code: str  # language code understood by the translator backend
    label: str  # human-readable label for the UI dropdown


SUPPORTED_LANGUAGES: list[Language] = [
    Language(code="en", label="English"),
    Language(code="es", label="Spanish"),
    Language(code="zh-cn", label="Chinese (Simplified)"),
    Language(code="fr", label="French"),
    Language(code="de", label="German"),
    Language(code="ja", label="Japanese"),
    Language(code="ko", label="Korean"),
]

SUPPORTED_CODES: frozenset[str] = frozenset(lang.code for lang in SUPPORTED_LANGUAGES)


def is_supported(code: str) -> bool:
    """Return True if `code` is in the curated list."""
    return code in SUPPORTED_CODES
