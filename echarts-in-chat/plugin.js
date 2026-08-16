/**
 * echarts-in-chat — render ```echarts code blocks in the conversation stream
 * as live, interactive charts (zoomable, legend-filterable).
 *
 * How it works:
 *   A MutationObserver scans the message list for <pre> blocks whose text is
 *   a JSON object containing a "series" key (the shiki highlighter does not
 *   render a language label, so content sniffing is the reliable signal).
 *   The <pre> is replaced synchronously with a container div, ECharts is
 *   loaded (CDN first, optional local vendor file), and the option is
 *   hydrated into an interactive chart.
 *
 * Design notes (why things are done this way — read before changing):
 *   - Global singleton: every ⌘K "reload desktop plugins" mounts a NEW plugin
 *     instance while old observers never unmount. The singleton (window.__eic)
 *     shares the processed WeakSet and the ECharts lib across instances so
 *     blocks are never double-processed and the lib is loaded once.
 *   - Synchronous claim: pre.replaceWith(div) happens with NO await in the
 *     scan callback. A racing old instance that is mid-await can no longer
 *     grab the <pre> — its div would never enter the DOM and ECharts would
 *     init with a 0x0 canvas.
 *   - Full-body scans (not m.target filtering) + 300ms debounce: shiki
 *     highlights asynchronously and only mutates text nodes; childList-only
 *     observation misses them. A 3s setInterval backstop covers virtualized
 *     list re-creation and React re-mounts.
 *   - The 120px trap: shiki code blocks sit inside a .scrollbar-overlay
 *     wrapper with max-h-[120px] overflow-y-auto. Replacing the <pre> leaves
 *     the chart trapped in a 120px scroll box. A class marker on that wrapper
 *     plus a stylesheet rule with !important unlocks it (React re-renders may
 *     restore inline styles, so a stylesheet rule is required, not inline CSS).
 *   - Blob execution: the plugin runs from a blob:file:// URL, so relative
 *     imports do not resolve. The optional local ECharts file must be loaded
 *     via an absolute file:// path (see ECHARTS_LOCAL_VENDOR below).
 *   - Layout: grid.bottom is padded to 70px and a dataZoom slider is pinned
 *     to the bottom (bottom:2) with the legend pushed above it, so slider and
 *     legend never overlap.
 */

const G = window.__eic || (window.__eic = {
  processed: new WeakSet(),
  lib: null,
  loading: null
})
const log = (...a) => console.error('[echarts-in-chat]', ...a)

// Chart height: option.hermesHeight overrides (280–560px), default 400px.
const DEFAULT_H = 400
const TARGET_H = opt => Math.min(560, Math.max(280, (opt && opt.hermesHeight) || DEFAULT_H))

/**
 * ECharts loading order:
 *   1. A local vendor file, if ECHARTS_LOCAL_VENDOR is set to an absolute
 *      file:// path (see README — useful offline or behind a slow CDN).
 *   2. jsDelivr CDN.
 * The plugin runs from a blob URL, so relative paths do not work here.
 */
const ECHARTS_LOCAL_VENDOR = '' // e.g. 'file:///Users/you/.hermes/desktop-plugins/echarts-in-chat/vendor/echarts.min.js'
const ECHARTS_CDN = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js'

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => res(window.echarts)
    s.onerror = () => rej(new Error('script load failed: ' + src))
    document.head.appendChild(s)
  })
}

async function ensureEcharts() {
  if (G.lib) return G.lib
  if (G.loading) return G.loading
  G.loading = (async () => {
    const candidates = [ECHARTS_LOCAL_VENDOR, ECHARTS_CDN].filter(Boolean)
    for (const src of candidates) {
      try {
        const lib = await loadScript(src)
        if (lib && lib.init) return lib
      } catch (e) { /* try next source */ }
    }
    throw new Error('ECharts could not be loaded (local vendor + CDN both failed)')
  })().then(m => { G.lib = m; return m })
  return G.loading
}

/** Claim a <pre>: parse JSON, build the container div, replace synchronously. */
function claimBlock(pre) {
  if (G.processed.has(pre)) return null
  G.processed.add(pre)
  const raw = (pre.textContent || '').trim()
  let option
  try { option = JSON.parse(raw) }
  catch (e) { G.processed.delete(pre); return null }
  const div = document.createElement('div')
  div.className = 'echarts-in-chat-container'
  div.style.cssText = 'width:100%;height:' + TARGET_H(option) + 'px;margin:8px 0;' +
    'border-radius:8px;overflow:hidden;display:flex;align-items:center;' +
    'justify-content:center;color:#8a93a5;font-size:12px;'
  div.textContent = '📊 Chart loading…'
  div.dataset.option = raw // keep the option for re-render fallbacks
  markParent(pre)
  pre.replaceWith(div)
  return { div, option }
}

let cssInjected = false
function injectGlobalCss() {
  if (cssInjected || !document.head) return
  cssInjected = true
  const style = document.createElement('style')
  style.id = 'echarts-in-chat-css'
  style.textContent = `
    .echarts-parent {
      max-height: none !important;
      overflow-y: visible !important;
      overflow: visible !important;
    }
  `
  document.head.appendChild(style)
}

/** Mark the scrollable wrapper that would clip the chart to 120px. */
function markParent(preOrDiv) {
  let el = preOrDiv.parentElement
  for (let i = 0; el && i < 2; i++) {
    if (el.className && String(el.className).includes('scrollbar-overlay')) {
      if (!el.classList.contains('echarts-parent')) el.classList.add('echarts-parent')
      return
    }
    el = el.parentElement
  }
}

/** Pad the layout: bottom grid space, slider pinned bottom, legend above it. */
function padGrid(option) {
  if (!option || typeof option !== 'object') return option
  const g = option.grid
  if (!g || typeof g !== 'object') option.grid = { left: 50, right: 20, top: 45, bottom: 70 }
  else {
    if (g.bottom === undefined) g.bottom = 70
    if (g.top === undefined) g.top = 45
  }
  const dz = option.dataZoom
  if (Array.isArray(dz)) {
    dz.forEach(z => {
      if (!z || z.type !== 'slider') return
      if (z.bottom === undefined) z.bottom = 2
      const need = z.bottom + (z.height || 14) + 10
      const lg = option.legend
      if (lg && typeof lg === 'object' && lg.bottom !== undefined && lg.bottom < need) {
        lg.bottom = need
      }
    })
  }
  return option
}

/** Async hydration: load ECharts → init → setOption → follow container size. */
async function hydrateChart(div, option) {
  try {
    const mod = await ensureEcharts()
    div.textContent = ''
    padGrid(option)
    const chart = mod.init(div)
    chart.setOption(option)
    chart.resize()
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(div)
  } catch (e) {
    log('chart render failed:', e.message)
    div.textContent = '⚠ Chart render failed: ' + e.message
  }
}

/**
 * Repair pass for charts rendered by older instances and for containers whose
 * wrapper class was lost on React re-render. Does NOT re-apply setOption —
 * replaying options every 3s caused the slider position to be recomputed
 * continuously (visual jumping). padGrid runs exactly once, at hydrate time.
 */
function repairContainers() {
  document.querySelectorAll('.echarts-in-chat-container').forEach(div => {
    markParent(div)
    let el = div.parentElement
    for (let i = 0; el && i < 3; i++) {
      const cs = getComputedStyle(el)
      const clipped = (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'hidden') &&
        cs.maxHeight !== 'none'
      if (clipped && el.scrollHeight > el.clientHeight + 10) {
        el.style.maxHeight = 'none'
        el.style.overflowY = 'visible'
      }
      el = el.parentElement
    }
    const h = div.offsetHeight
    let option = null
    try { option = div.dataset.option ? JSON.parse(div.dataset.option) : null } catch (e) { /* ignore */ }
    const want = TARGET_H(option)
    if (h > 0 && Math.abs(h - want) > 40) {
      div.style.height = want + 'px'
      const lib = window.echarts
      const chart = lib && lib.getInstanceByDom ? lib.getInstanceByDom(div) : null
      if (chart) chart.resize()
    }
  })
}

/** Full-body scan: claim new blocks, then repair old containers. */
function scan() {
  document.body.querySelectorAll('pre').forEach(pre => {
    const t = (pre.textContent || '').trim()
    if (t.startsWith('{') && t.includes('"series"')) {
      const c = claimBlock(pre)
      if (c) hydrateChart(c.div, c.option)
    }
  })
  repairContainers()
}

export default {
  id: 'echarts-in-chat',
  name: 'ECharts in Chat',
  register() {
    injectGlobalCss()
    const start = () => {
      scan()
      let debounceTimer = null
      const mo = new MutationObserver(() => {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(scan, 300)
      })
      mo.observe(document.body, { childList: true, subtree: true, characterData: true })
      setInterval(scan, 3000) // backstop for virtualized list re-creation
    }
    if (document.readyState === 'complete') setTimeout(start, 300)
    else window.addEventListener('load', () => setTimeout(start, 300))
  }
}
