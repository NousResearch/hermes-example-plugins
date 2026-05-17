# plugin-tool-example

Reference plugin showing the smallest production-shaped `ctx.register_tool()`
surface: one deterministic tool, one JSON Schema, one handler.

## What it does

Registers a model-callable `text_stats` tool that summarizes a text snippet:

```json
{
  "success": true,
  "characters": 43,
  "lines": 2,
  "words": 8,
  "unique_words": 7,
  "top_words": [
    {"word": "hermes", "count": 2},
    {"word": "agent", "count": 1}
  ]
}
```

This is intentionally plain Python. The example is about the plugin boundary,
not the analysis itself:

- the tool schema tells the model when and how to call it,
- the handler validates user-supplied arguments,
- `tool_result()` and `tool_error()` keep responses machine-readable,
- `register(ctx)` exposes the tool under its own `tool_example` toolset.

## How it works

```python
ctx.register_tool(
    name="text_stats",
    toolset="tool_example",
    schema=TEXT_STATS_SCHEMA,
    handler=_handle_text_stats,
    description="Count lines, words, and common tokens in a text snippet.",
)
```

The handler accepts the same `args: dict, **kwargs` shape used by bundled
Hermes tools. It rejects empty or oversized payloads, clamps `top_n`, and
returns stable JSON so the model can use the result without reparsing prose.

## Try it

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git
cp -r hermes-example-plugins/plugin-tool-example ~/.hermes/plugins/
hermes plugins enable plugin-tool-example
```

Then start a Hermes session and ask for text statistics. The model can call
`text_stats` when the `tool_example` toolset is available.

## Files

| File | Purpose |
|---|---|
| `__init__.py` | Tool schema, handler, and `register(ctx)` entry point |
| `plugin.yaml` | Plugin manifest |

For a full multi-file tutorial that also covers hooks, CLI commands, and data
files, see [Build a Hermes Plugin](https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin).
