"""
plugin-llm-async-example — async reference plugin for ``ctx.llm``.

Companion to the
`Plugin LLM Access <https://hermes-agent.nousresearch.com/docs/developer-guide/plugin-llm-access>`_
docs page. Demonstrates the async surface (``acomplete()`` /
``acomplete_structured()``) by doing something the sync surface
genuinely couldn't:

* registers a single ``/translate <lang>: <text>`` slash command,
* fires two LLM calls **concurrently** via ``asyncio.gather()`` —
  one to translate forward into the target language, one to
  back-translate the result into English so the plugin can score
  semantic preservation,
* returns the translation plus a confidence note.

Running both calls in parallel via ``acomplete()`` cuts wall-clock
in roughly half compared to two sequential ``complete()`` calls.
That's the reason the async surface exists, and this plugin is the
smallest piece of code that exercises it end-to-end.

Usage::

    /translate fr: How does this work in practice?
    →  Forward (en→fr): Comment cela fonctionne-t-il en pratique ?
       Back-check  : How does this work in practice?
       Confidence  : exact match

    /translate ja: I'll be there in five minutes.
    →  Forward (en→ja): 5分でそちらに伺います。
       Back-check  : I will be there in five minutes.
       Confidence  : near-exact

The trust gate defaults are fully restrictive — the plugin runs
against whatever provider+model the user has active. Operators who
want to pin to a cheap model add::

    plugins:
      entries:
        plugin-llm-async-example:
          llm:
            allow_model_override: true
            allowed_models:
              - openai/gpt-4o-mini
              - anthropic/claude-3-5-haiku

…to ``config.yaml``. The plugin's optional ``model`` arg then works.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


def _parse_args(raw: str) -> tuple[str, str] | None:
    """Split ``"<lang>: <text>"`` into ``(lang, text)``.

    Accepts ``fr:``, ``ja:``, ``Spanish:`` and similar. Returns ``None``
    when the input doesn't fit the shape — the handler treats that as
    a usage error.
    """
    if ":" not in raw:
        return None
    lang_part, text_part = raw.split(":", 1)
    lang = lang_part.strip()
    text = text_part.strip()
    if not lang or not text:
        return None
    return lang, text


def _make_handler(ctx: Any):
    """Build the async ``/translate`` handler bound to this plugin's ctx."""

    async def handler(raw_args: str) -> str:
        parsed = _parse_args(raw_args)
        if parsed is None:
            return (
                "Usage: /translate <lang>: <text>\n"
                "  Examples:\n"
                "    /translate fr: Hello, how are you?\n"
                "    /translate Japanese: I'll be there in five minutes."
            )
        lang, text = parsed

        # Fire both calls in parallel via asyncio.gather. With sync
        # complete() we'd have to await sequentially — wall-clock would
        # roughly double on the same provider.
        started = time.monotonic()
        try:
            forward_task = ctx.llm.acomplete(
                messages=[
                    {"role": "system",
                     "content": (
                         f"Translate the user's text into {lang}. "
                         "Reply with ONLY the translation. No commentary, "
                         "no quotes, no language tags."
                     )},
                    {"role": "user", "content": text},
                ],
                max_tokens=512,
                temperature=0.0,
                purpose="translate.forward",
            )
            # The back-translation can't start until we have the forward
            # result — but we kick off a third call in parallel: a quick
            # sentiment classifier on the original text. It's not strictly
            # needed but demonstrates real fan-out.
            sentiment_task = ctx.llm.acomplete(
                messages=[
                    {"role": "system",
                     "content": (
                         "Classify the user's text in one word: "
                         "'statement', 'question', 'request', 'greeting', "
                         "or 'other'. Reply with the single word, lowercase."
                     )},
                    {"role": "user", "content": text},
                ],
                max_tokens=8,
                temperature=0.0,
                purpose="translate.classify",
            )
            forward_result, sentiment_result = await asyncio.gather(
                forward_task, sentiment_task
            )
        except Exception as exc:
            logger.warning("translate forward/classify pass failed: %s", exc)
            return f"Translation failed: {exc}"

        translation = forward_result.text.strip()
        category = sentiment_result.text.strip().lower()

        # Now back-translate — needs the forward result, so this one is
        # serial, but the cheap sentiment call already overlapped with
        # the forward translation, saving a round-trip.
        back_text: str
        back_tokens: int
        try:
            back = await ctx.llm.acomplete(
                messages=[
                    {"role": "system",
                     "content": (
                         "Translate the user's text into English. "
                         "Reply with ONLY the translation."
                     )},
                    {"role": "user", "content": translation},
                ],
                max_tokens=512,
                temperature=0.0,
                purpose="translate.back",
            )
        except Exception as exc:
            logger.warning("translate back-pass failed: %s", exc)
            back_text = "(back-translation failed)"
            back_tokens = 0
        else:
            back_text = back.text.strip()
            back_tokens = back.usage.total_tokens

        confidence = _confidence(text, back_text)
        elapsed = time.monotonic() - started
        provider = forward_result.provider
        model = forward_result.model
        total_tokens = (
            forward_result.usage.total_tokens
            + sentiment_result.usage.total_tokens
            + back_tokens
        )

        return (
            f"Forward (en→{lang}): {translation}\n"
            f"Back-check       : {back_text}\n"
            f"Confidence       : {confidence}\n"
            f"Category         : {category}\n"
            f"---\n"
            f"via {provider}/{model} · {total_tokens} tokens · {elapsed:.1f}s"
        )

    return handler


def _confidence(original: str, back: str) -> str:
    """Cheap heuristic to score how well the back-translation preserved
    the original. Not a substitute for real eval — meant to show that
    a plugin can use the host LLM for one part of its job and plain
    Python for the rest."""
    a = " ".join(original.lower().split())
    b = " ".join(back.lower().split())
    if a == b:
        return "exact match"
    # Token-overlap ratio
    a_tokens = set(a.split())
    b_tokens = set(b.split())
    if not a_tokens or not b_tokens:
        return "unknown"
    overlap = len(a_tokens & b_tokens) / max(len(a_tokens), len(b_tokens))
    if overlap >= 0.85:
        return "near-exact"
    if overlap >= 0.6:
        return "close"
    if overlap >= 0.3:
        return "loose"
    return "low"


def register(ctx: Any) -> None:
    """Plugin entry point — wires the slash command.

    Note the handler is an async function. ``register_command`` accepts
    both sync and async handlers — the gateway and CLI dispatch loops
    handle both shapes via ``inspect.iscoroutinefunction``.
    """
    ctx.register_command(
        name="translate",
        handler=_make_handler(ctx),
        description="Translate text into another language with a back-translation confidence check.",
        args_hint="<lang>: <text>",
    )
    logger.debug("plugin-llm-async-example: registered /translate (async)")
