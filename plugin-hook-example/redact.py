"""Pure-function redaction helpers for ``plugin-hook-example``.

The patterns are deliberately conservative: each one targets a shape
that has near-zero false-positive risk in normal prose. The cost of a
miss (a real SSN leaking) is much higher than the cost of a false
negative (a near-miss the regex didn't catch), so the patterns favour
high precision over high recall.

Callers receive the redacted text plus an audit list naming each match
(kind + offset), so the hook can emit a structured log entry without
re-scanning the text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Redaction:
    kind: str
    start: int
    end: int


# US SSN (digit-only, ###-##-####). Refuses the well-known invalid blocks
# (000, 666, 9##) per SSA convention to cut false positives.
_SSN = re.compile(
    r"\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b"
)

# 13-19 digit numbers with optional spaces or single hyphens. We Luhn-check
# in the second pass; the regex's job is to narrow the candidate set.
_CC_CANDIDATE = re.compile(r"\b(?:\d[ \-]?){12,18}\d\b")

# Common API-key shapes. Each prefix is well-defined enough that a match
# is overwhelmingly an actual key, not a coincidental string.
_API_KEYS: list[tuple[str, re.Pattern[str]]] = [
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
    ("openai_project_key", re.compile(r"\bsk-proj-[A-Za-z0-9_-]{20,}\b")),
    ("anthropic_key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b")),
]


def _luhn_valid(digits: str) -> bool:
    total = 0
    parity = len(digits) % 2
    for index, ch in enumerate(digits):
        d = ord(ch) - 48
        if index % 2 == parity:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def redact(text: str) -> tuple[str, list[Redaction]]:
    """Return ``(redacted_text, audit_entries)``.

    The audit list records each match in left-to-right order. The
    returned text replaces each match with ``[REDACTED:<kind>]``.
    """

    if not text:
        return text, []

    matches: list[tuple[int, int, str]] = []

    for match in _SSN.finditer(text):
        matches.append((match.start(), match.end(), "ssn"))

    for match in _CC_CANDIDATE.finditer(text):
        candidate = match.group(0)
        digits_only = re.sub(r"[ \-]", "", candidate)
        if 13 <= len(digits_only) <= 19 and _luhn_valid(digits_only):
            matches.append((match.start(), match.end(), "credit_card"))

    for kind, pattern in _API_KEYS:
        for match in pattern.finditer(text):
            matches.append((match.start(), match.end(), kind))

    if not matches:
        return text, []

    # Resolve overlaps: prefer the earlier match, then the longer one.
    matches.sort(key=lambda item: (item[0], -(item[1] - item[0])))
    resolved: list[tuple[int, int, str]] = []
    cursor = 0
    for start, end, kind in matches:
        if start < cursor:
            continue
        resolved.append((start, end, kind))
        cursor = end

    pieces: list[str] = []
    audit: list[Redaction] = []
    last = 0
    for start, end, kind in resolved:
        pieces.append(text[last:start])
        pieces.append(f"[REDACTED:{kind}]")
        audit.append(Redaction(kind=kind, start=start, end=end))
        last = end
    pieces.append(text[last:])
    return "".join(pieces), audit
