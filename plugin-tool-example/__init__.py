"""
plugin-tool-example - minimal reference plugin for ``ctx.register_tool()``.

Demonstrates the smallest production-shaped general-tool plugin:

* one JSON Schema that tells the model what the tool accepts,
* one deterministic handler with argument validation,
* structured JSON responses via ``tool_result`` / ``tool_error``,
* one ``ctx.register_tool`` call in ``register(ctx)``.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Any

from tools.registry import tool_error, tool_result

logger = logging.getLogger(__name__)

_MAX_TEXT_CHARS = 20_000
_WORD_RE = re.compile(r"[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?")


TEXT_STATS_SCHEMA = {
    "description": (
        "Count lines, words, unique words, and common tokens in a text snippet. "
        "Use this when the user asks for lightweight text statistics rather than "
        "semantic analysis."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "Text to analyze, up to 20,000 characters.",
            },
            "top_n": {
                "type": "integer",
                "description": "How many common words to return (1-10). Defaults to 5.",
                "minimum": 1,
                "maximum": 10,
            },
        },
        "required": ["text"],
        "additionalProperties": False,
    },
}


def _coerce_top_n(raw: Any) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 5
    return max(1, min(10, value))


def _handle_text_stats(args: dict, **kwargs: Any) -> str:
    """Return deterministic text metrics for a caller-provided snippet."""
    del kwargs

    text = args.get("text")
    if not isinstance(text, str) or not text.strip():
        return tool_error("text must be a non-empty string")
    if len(text) > _MAX_TEXT_CHARS:
        return tool_error(
            "text exceeds the 20,000 character limit",
            max_chars=_MAX_TEXT_CHARS,
        )

    top_n = _coerce_top_n(args.get("top_n", 5))
    words = [match.group(0).casefold() for match in _WORD_RE.finditer(text)]
    counts = Counter(words)
    top_words = [
        {"word": word, "count": count}
        for word, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[
            :top_n
        ]
    ]

    return tool_result({
        "success": True,
        "characters": len(text),
        "lines": len(text.splitlines()) or 1,
        "words": len(words),
        "unique_words": len(counts),
        "top_words": top_words,
    })


def register(ctx: Any) -> None:
    """Plugin entry point - expose one model-callable tool."""
    ctx.register_tool(
        name="text_stats",
        toolset="tool_example",
        schema=TEXT_STATS_SCHEMA,
        handler=_handle_text_stats,
        description="Count lines, words, and common tokens in a text snippet.",
    )
    logger.debug("plugin-tool-example: registered text_stats")
