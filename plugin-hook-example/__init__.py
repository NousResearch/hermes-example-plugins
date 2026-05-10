"""plugin-hook-example - reference plugin for the ``transform_llm_output`` hook.

Companion to the
`Plugin Hooks <https://hermes-agent.nousresearch.com/docs/developer-guide/plugin-hooks>`_
docs page. Demonstrates the lifecycle-hook surface:

* declares ``transform_llm_output`` in ``plugin.yaml``,
* registers a single hook that redacts SSN, Luhn-valid credit cards,
  and common API-key shapes from assistant output,
* emits one ``logger.info`` audit record per scan with the count and
  kinds of redactions so operators can see what was caught without
  re-reading the text.

The plugin is intentionally policy-only: it does not block, retry, or
escalate. The host can chain additional hooks (rate limiting, content
classification, summarisation) downstream of this one.

The trust gate stays at the default: hooks run for every assistant
turn unless the operator disables this plugin in ``config.yaml``.
"""

from __future__ import annotations

import logging
from typing import Any

from .redact import Redaction, redact

logger = logging.getLogger(__name__)


def _make_hook(ctx: Any):
    """Build the ``transform_llm_output`` hook bound to this plugin's ctx."""

    plugin_name = "plugin-hook-example"

    def hook(text: str, **_metadata: Any) -> str:
        redacted, audit = redact(text)
        if not audit:
            return text
        _log_audit(plugin_name, audit, original_len=len(text))
        return redacted

    return hook


def _log_audit(plugin_name: str, audit: list[Redaction], *, original_len: int) -> None:
    """Emit a single structured log line summarising one scan.

    Real audit pipelines would route this through ``ctx.audit.emit`` or
    a dedicated sink; for the reference plugin we keep it on the
    standard logger so it shows up in the host's log stream without
    any extra wiring.
    """

    kinds: dict[str, int] = {}
    for entry in audit:
        kinds[entry.kind] = kinds.get(entry.kind, 0) + 1
    summary = ", ".join(f"{k}={v}" for k, v in sorted(kinds.items()))
    logger.info(
        "%s: redacted %d span(s) from %d-char output [%s]",
        plugin_name,
        len(audit),
        original_len,
        summary,
    )


def register(ctx: Any) -> None:
    """Plugin entry point - wires the lifecycle hook."""
    ctx.register_hook(
        name="transform_llm_output",
        handler=_make_hook(ctx),
        description="Redact SSN, Luhn-valid credit cards, and API-key shapes from assistant output.",
    )
    logger.debug("plugin-hook-example: registered transform_llm_output hook")
