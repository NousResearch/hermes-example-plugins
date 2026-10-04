"""plugin-hook-example — reference plugin for ``ctx.register_hook()``.

Companion to the Event Hooks reference
(https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks#transform_llm_output).
Demonstrates the lifecycle-hook surface with one transform hook:

* declares ``transform_llm_output`` in ``plugin.yaml``,
* registers one callback with ``ctx.register_hook(name, callback)``,
* masks US Social Security numbers and Luhn-valid card numbers in the
  turn's final assistant text,
* returns ``None`` when nothing matched, so the text passes through and
  other plugins' transforms still get their turn,
* logs one line per rewrite (counts only, never the matched values).

API keys and tokens are deliberately NOT handled here: core already
redacts those, and a plugin that needs extra secret shapes should use
``ctx.register_redaction_patterns()`` instead of a hook.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

# US SSN (###-##-####), skipping the blocks the SSA never issues
# (000, 666, 9xx area; 00 group; 0000 serial) to cut false positives.
_SSN = re.compile(r"\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b")

# Card numbers as people write them: 4-4-4-4 (Visa/Mastercard/Discover),
# 4-6-5 (Amex) with one space or hyphen between groups, or 15-16 digits run
# together. Fixed group shapes keep a trailing expiry/CVV ("... 1111 12/25")
# out of the match; Luhn-checked below. Bare 13-digit timestamps and 17-19
# digit snowflake IDs never match.
_CARD = re.compile(r"(?<![\d-])(?:\d{4}([ -])\d{4}\1\d{4}\1\d{4}|\d{4}([ -])\d{6}\2\d{5}|\d{15,16})(?![\d-])")


def _luhn_valid(digits: str) -> bool:
    total = 0
    parity = len(digits) % 2
    for index, ch in enumerate(digits):
        d = int(ch)
        if index % 2 == parity:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


def redact(text: str) -> tuple[str, dict[str, int]]:
    """Return ``(masked_text, {kind: count})``. Pure function, no ctx needed."""
    counts: dict[str, int] = {}

    def _mask_ssn(match: re.Match[str]) -> str:
        counts["ssn"] = counts.get("ssn", 0) + 1
        return "[REDACTED:ssn]"

    def _mask_card(match: re.Match[str]) -> str:
        digits = re.sub(r"[ -]", "", match.group(0))
        if not _luhn_valid(digits):
            return match.group(0)
        counts["card"] = counts.get("card", 0) + 1
        return "[REDACTED:card]"

    text = _SSN.sub(_mask_ssn, text)
    text = _CARD.sub(_mask_card, text)
    return text, counts


def _on_llm_output(response_text: str = "", session_id: str = "", platform: str = "",
                   **_: Any) -> Optional[str]:
    """``transform_llm_output`` callback.

    Hermes passes everything as keyword arguments; accept ``**_`` so new
    fields never break the plugin. Return a non-empty string to replace the
    final text, or ``None`` to leave it unchanged (the first non-empty string
    across all plugins wins, so returning the original text would needlessly
    claim the turn).
    """
    masked, counts = redact(response_text or "")
    if not counts:
        return None
    logger.info(
        "plugin-hook-example: masked %s in session %s (%s)",
        ", ".join(f"{kind}={n}" for kind, n in sorted(counts.items())),
        session_id or "-",
        platform or "-",
    )
    return masked


def register(ctx: Any) -> None:
    """Plugin entry point."""
    ctx.register_hook("transform_llm_output", _on_llm_output)
