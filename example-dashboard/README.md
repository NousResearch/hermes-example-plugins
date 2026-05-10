# example-dashboard

Reference plugin for the Hermes Agent dashboard plugin SDK. Demonstrates the bare-minimum shape of a dashboard plugin:

- a `dashboard/manifest.json` that declares a tab + a slot injection,
- a `dashboard/dist/index.js` (compiled) that mounts a React component into the tab,
- a `dashboard/plugin_api.py` that exposes a backend route at `/api/plugins/example/`.

This is the smallest end-to-end dashboard plugin that exercises every part of the SDK — tabs, slots, backend API routes, and the manifest schema. Read it alongside [Extending the Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard).

## What it does

Adds an `Example` tab in the dashboard nav (after `Skills`) with a simple "Hello from the example plugin" page, and injects a banner into the `sessions:top` slot so you can see slot injection in action without building a full reskin.

The backend exposes one route:

```
GET /api/plugins/example/hello
→ {"message": "Hello from the example plugin!", "plugin": "example", "version": "1.0.0"}
```

## Install

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git
cp -r hermes-example-plugins/example-dashboard ~/.hermes/plugins/
```

Then either restart the web UI or hit `GET /api/dashboard/plugins/rescan`. The new tab appears immediately.

To uninstall: `rm -rf ~/.hermes/plugins/example-dashboard` and rescan.

## Files

| File | Purpose |
|---|---|
| `dashboard/manifest.json` | Tab + slot declarations, icon, version |
| `dashboard/dist/index.js` | Compiled React bundle — what the dashboard loads |
| `dashboard/plugin_api.py` | FastAPI router mounted at `/api/plugins/example/` |

To build your own from this template: copy the directory, edit `manifest.json` (rename the `name`, `label`, `path`), replace the React bundle, and add your own routes to `plugin_api.py`. The dashboard auto-discovers anything that matches `~/.hermes/plugins/*/dashboard/manifest.json`.

For the full plugin SDK reference — slots, tabs, themes, icons, route overrides — see the [Extending the Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard) docs page.
