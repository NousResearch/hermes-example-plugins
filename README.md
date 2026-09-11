# hermes-example-plugins

Reference plugins for [hermes-agent](https://github.com/NousResearch/hermes-agent) — small, focused examples that show how a single plugin surface works, end to end.

These are **not bundled with `hermes-agent`**. The core repo ships only the plugins users actually run (memory providers, the disk-cleanup hook, platform adapters). Reference plugins live here so plugin authors can read them, copy them, install them as user plugins, and ignore them otherwise.

## Index

| Plugin | Surface | Demonstrates |
|---|---|---|
| [`plugin-tool-example`](./plugin-tool-example) | `ctx.register_tool()` | A model-callable tool — JSON Schema, argument validation, structured `tool_result()` / `tool_error()` responses |
| [`plugin-llm-example`](./plugin-llm-example) | `ctx.llm.complete_structured()` | Host-owned structured LLM calls — typed text/image input, JSON Schema validation, trust-gate config |
| [`plugin-llm-async-example`](./plugin-llm-async-example) | `ctx.llm.acomplete()` + `asyncio.gather()` | Async LLM lane — concurrent forward + sentiment + back-translation pass for `/translate` |
| [`example-dashboard`](./example-dashboard) | `dashboard/manifest.json` | Bare-minimum dashboard plugin — a tab, a slot injection, a backend route |
| [`strike-freedom-cockpit`](./strike-freedom-cockpit) | dashboard theme + slot plugin | Complete custom-skin reskin — palette, layout variant, asset slots, sidebar HUD |
| [`plugin-hook-example`](./plugin-hook-example) | `ctx.register_hook()` | A `transform_llm_output` hook — keyword-only callback, `None` to pass through, masking SSNs/card numbers in the final text |
| [`example-desktop-statusbar`](./example-desktop-statusbar) | `STATUSBAR_AREAS.right` + `render` | Desktop status-bar chip — a stateful React component in one slot, the app's tooltip, theme variables, no build step |

## Installing an example as a user plugin

Each directory is a self-contained plugin. To run one in your own Hermes Agent setup:

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git

# pick whichever you want
cp -r hermes-example-plugins/plugin-tool-example      ~/.hermes/plugins/
cp -r hermes-example-plugins/plugin-llm-example       ~/.hermes/plugins/
cp -r hermes-example-plugins/plugin-llm-async-example ~/.hermes/plugins/
cp -r hermes-example-plugins/example-dashboard        ~/.hermes/plugins/
cp -r hermes-example-plugins/strike-freedom-cockpit   ~/.hermes/plugins/
cp -r hermes-example-plugins/plugin-hook-example      ~/.hermes/plugins/

# desktop examples go in the desktop root instead
cp -r hermes-example-plugins/example-desktop-statusbar ~/.hermes/desktop-plugins/

# enable whichever examples you copied
hermes plugins enable plugin-tool-example
hermes plugins enable plugin-llm-example
hermes plugins enable plugin-llm-async-example
hermes plugins enable plugin-hook-example
```

For dashboard plugins, restart the web UI (or `GET /api/dashboard/plugins/rescan`) to pick up the new tab. To uninstall, `rm -rf ~/.hermes/plugins/<name>` and the corresponding rescan / `hermes plugins disable`.

`example-desktop-statusbar` is a **desktop** plugin: it lives in `~/.hermes/desktop-plugins/<id>/plugin.js` rather than `~/.hermes/plugins/`, and the folder name has to match the plugin `id`. Hermes Desktop watches that root and hot-reloads on save — if the chip does not appear, run **⌘K → Reload desktop plugins**.

## Reading order for plugin authors

The plugins here are deliberately minimal — each one shows **one** plugin surface in the smallest amount of code that demonstrates it. Companion docs for each surface live in the main hermes-agent docs site under [Developer Guide → Extending](https://hermes-agent.nousresearch.com/docs/developer-guide/contributing).

Pair each plugin in this repo with its docs page:

| Plugin here | Docs page |
|---|---|
| `plugin-tool-example` | [Build a Hermes Plugin](https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin) |
| `plugin-llm-example` | [Plugin LLM Access](https://hermes-agent.nousresearch.com/docs/developer-guide/plugin-llm-access) |
| `plugin-llm-async-example` | [Plugin LLM Access](https://hermes-agent.nousresearch.com/docs/developer-guide/plugin-llm-access) |
| `example-dashboard` | [Extending the Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard) |
| `strike-freedom-cockpit` | [Extending the Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard) |
| `plugin-hook-example` | [Event Hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks#transform_llm_output) |
| `example-desktop-statusbar` | [Desktop Plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk) |

## Contributing a new example

Reference plugins should be:

- **Self-contained.** No deps beyond `hermes-agent` itself unless absolutely required.
- **Single-surface.** One plugin, one `ctx.*` API. If your example needs three `ctx.register_*` calls to make sense, it's probably not a reference example — it's a real plugin.
- **Under ~200 LOC of plugin code.** Reference plugins compete for attention with reading the docs page. Keep them small.
- **Production-shaped.** Use real types, real error handling, real audit logging — show plugin authors what we'd want them to write, not a stripped-down demo.

PRs welcome. Open an issue first if the surface you want to demonstrate isn't already covered in the hermes-agent developer-guide docs — we may want to write the docs page first, then add a companion reference plugin here.

## License

MIT, same as hermes-agent.
