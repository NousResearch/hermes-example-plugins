# plugin-llm-async-example

Async reference plugin for `ctx.llm`. The companion to [`plugin-llm-example`](../plugin-llm-example) — same plugin context surface, but built around the async methods (`acomplete()`, `acomplete_structured()`) and `asyncio.gather()` to demonstrate why the async lane exists.

## What it does

Adds a `/translate <lang>: <text>` slash command:

```
/translate fr: How does this work in practice?
→  Forward (en→fr): Comment cela fonctionne-t-il en pratique ?
   Back-check     : How does this work in practice?
   Confidence     : exact match
   Category       : question
   ---
   via openrouter/anthropic/claude-3-5-sonnet · 312 tokens · 1.4s
```

For each translation request the plugin fires three LLM calls:

| Pass | What | Pattern |
|---|---|---|
| Forward translation | `en → <target lang>` | `acomplete()` |
| Sentiment classifier | One-word category | `acomplete()`, **runs in parallel with forward** |
| Back-translation | `<target lang> → en` for QA | `acomplete()`, must run after forward |

The forward and sentiment calls fire **concurrently** via `asyncio.gather()` — that's the whole point of the async lane:

```python
forward_task = ctx.llm.acomplete(messages=[...], purpose="translate.forward")
sentiment_task = ctx.llm.acomplete(messages=[...], purpose="translate.classify")
forward_result, sentiment_result = await asyncio.gather(forward_task, sentiment_task)
```

With sync `complete()` those two would run sequentially — wall-clock roughly doubles on the same provider. The back-translation depends on the forward result so it's serial, but the sentiment pass overlapped with the forward, saving a round-trip.

## Why this matters for plugin authors

`ctx.llm.acomplete()` is identical to `ctx.llm.complete()` in arguments and return type. The only differences:

- you `await` it instead of calling it directly,
- you can fan out with `asyncio.gather()`, `asyncio.wait()`, `asyncio.as_completed()`,
- you can run inside an async slash command handler, gateway adapter, or any plugin code already on an asyncio loop.

This plugin is the smallest piece of code that exercises all three concurrency patterns. Read it alongside the [Plugin LLM Access](https://hermes-agent.nousresearch.com/docs/developer-guide/plugin-llm-access) docs page.

## Try it

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git
cp -r hermes-example-plugins/plugin-llm-async-example ~/.hermes/plugins/
hermes plugins enable plugin-llm-async-example
```

Then in a Hermes session:

```
/translate fr: I'll be there in five minutes.
/translate Japanese: How much does this cost?
/translate de: Could you send me the report by Friday?
```

## Trust-gate config (optional)

Default behaviour: the plugin runs against the user's active model and cannot override anything. To pin to a cheap model (translation doesn't need a frontier model):

```yaml
plugins:
  entries:
    plugin-llm-async-example:
      llm:
        allow_model_override: true
        allowed_models:
          - openai/gpt-4o-mini
          - anthropic/claude-3-5-haiku
```

The plugin doesn't currently surface a model-picking flag, but if you fork it to add one, the trust gate is what unlocks it.

## Files

| File | Lines | Purpose |
|---|---|---|
| `__init__.py` | ~180 | The plugin — `register(ctx)` + async `/translate` handler + `_confidence()` heuristic |
| `plugin.yaml` | 9 | Manifest |
| `README.md` | this file | |

## Pairing with the sync example

If you want the same shape but synchronous, see [`plugin-llm-example`](../plugin-llm-example) — a `/receipt-extract <path>` slash command that takes a text or image file and returns structured JSON.

| | sync | async |
|---|---|---|
| Plugin | [`plugin-llm-example`](../plugin-llm-example) | `plugin-llm-async-example` (this) |
| Method exercised | `complete_structured()` | `acomplete()` × 3 with `gather()` |
| Why this shape | One bounded structured call, no need to await | Multiple LLM calls per request, parallelism saves wall-clock |
