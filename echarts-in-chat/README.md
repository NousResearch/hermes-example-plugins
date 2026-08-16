# echarts-in-chat

Render ```` ```echarts ```` code blocks in the Hermes Desktop conversation stream
as **live, interactive charts** — zoomable, legend-filterable, resize-aware.

A reference desktop plugin for the
[`@hermes/plugin-sdk`](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk).

## What it demonstrates

- **Message-stream DOM injection** — turning a rendered code block into a live
  component inside the chat (the most powerful pure-frontend plugin pattern).
- **Surviving reloads** — a global singleton so repeated ⌘K reloads never stack
  duplicate observers or double-process blocks.
- **Race-free claiming** — `pre.replaceWith(div)` happens synchronously in the
  scan callback, so stale plugin instances can never steal a block mid-await.
- **Shiki quirks** — content sniffing (shiki renders no language label),
  the 120px scroll wrapper trap, and async-highlight observation via
  full-body scans + debounce + interval backstop.
- **Blob-URL reality** — plugins execute from a `blob:file://` URL, so relative
  imports fail; the optional local ECharts file is loaded by absolute path.

## Install

```bash
mkdir -p ~/.hermes/desktop-plugins
cp -r echarts-in-chat ~/.hermes/desktop-plugins/
```

Then ⌘K → **Reload desktop plugins** (or restart the app).

## Usage

In any chat message, include a code block with language `echarts` whose content
is a valid ECharts option JSON:

````markdown
```echarts
{
  "title": { "text": "Weekly sales", "left": "center" },
  "tooltip": {},
  "legend": { "bottom": 0 },
  "xAxis": { "type": "category", "data": ["Mon", "Tue", "Wed", "Thu", "Fri"] },
  "yAxis": { "type": "value" },
  "dataZoom": [{ "type": "slider" }],
  "series": [{ "type": "bar", "data": [120, 200, 150, 80, 70] }]
}
```
````

The block is replaced by a 400px-tall interactive chart (option
`"hermesHeight"` overrides, clamped to 280–560px).

## ECharts loading

The plugin loads ECharts from jsDelivr CDN by default. For offline use or slow
networks, download `echarts.min.js` (v5.5.0, Apache-2.0) into the plugin's
`vendor/` folder and set `ECHARTS_LOCAL_VENDOR` at the top of `plugin.js` to
its absolute `file://` path.

## License

MIT — see [LICENSE](LICENSE).
