from __future__ import annotations
import json
import sys
from typing import Any, Dict

from reversal_engine import reverse


def normalize_for_hermes(source: str, anthropic_api_key: str | None = None) -> Dict[str, Any]:
    """
    Convertit une source brute (URL, PDF, Excel, image, texte) en JSON propre
    avant de la passer a Hermes.
    """
    result = reverse(source, api_key=anthropic_api_key)

    if result.get("status") != "ok":
        return {
            "status": "error",
            "source": source,
            "error": result.get("data", {}).get("error", "Normalization failed"),
        }

    data = result.get("data", {})
    return {
        "status": "ok",
        "content_type": result.get("content_type"),
        "source": result.get("source"),
        "processed_in_ms": result.get("processed_in_ms"),
        "title": data.get("title", ""),
        "summary_hint": data.get("summary_hint", ""),
        "payload": data,
    }


def build_hermes_input(normalized: Dict[str, Any]) -> str:
    """
    Format pret a injecter dans le prompt / tool-call Hermes.
    """
    if normalized.get("status") != "ok":
        return f"Normalization error: {normalized.get('error', 'unknown error')}"

    return (
        "You are Hermes.\n"
        "Use ONLY the normalized JSON below as source of truth.\n\n"
        + json.dumps(normalized, ensure_ascii=False, indent=2)
    )


if __name__ == "__main__":
    source_arg = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"
    normalized = normalize_for_hermes(source_arg)
    print(build_hermes_input(normalized))
