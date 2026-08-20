/**
 * Bot Sessions: a unified, per-bot conversation browser for Hermes Desktop.
 *
 * Public SDK only — no core patches, no direct state.db access. Demonstrates,
 * in one real-world plugin: routes + sidebar nav + palette contributions,
 * profile-routed RPC (host.profileRoutes / host.requestProfile) across every
 * registered connection, live refresh via the gateway event stream
 * (host.onEvent), plugin-scoped persistence (ctx.storage), and reactive host
 * state (host.state.focusedSessionProfile) to follow the bot the user is
 * actually chatting with.
 *
 * The folder name must equal the plugin `id`.
 */
import * as sdk from '@hermes/plugin-sdk'
import { useValue, atom } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const host = sdk.host
// Owner profile of the focused chat (the bot the user just clicked). Falls
// back for older desktop builds without focusedSessionProfile.
const activeProfileAtom = host.state?.focusedSessionProfile || host.state?.profile || atom('default')
const botColor = typeof sdk.profileColor === 'function' ? sdk.profileColor : () => 'var(--ui-accent)'
const PLUGIN_ID = 'bot-sessions'
const PLUGIN_NAME = 'Bot Sessions'
const ROUTE = '/bot-sessions'
const LIMIT = 500

const colors = {
  text: 'var(--ui-text-primary)',
  muted: 'var(--ui-text-secondary)',
  faint: 'var(--ui-text-tertiary)',
  border: 'var(--ui-stroke-secondary)',
  accent: 'var(--ui-accent)',
  surface: 'var(--ui-bg-secondary, transparent)'
}

function asArray(value, keys = []) {
  if (Array.isArray(value)) return value
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key]
  return []
}

function text(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value)
}

function timeOf(row) {
  const value = row?.last_active ?? row?.started_at ?? row?.created_at ?? row?.next_run_at
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

// Bot Mode mints plumbing sessions with exact titles ("Bot Chat",
// "Agent Inbox") and group-chat member sessions use the "Group: " prefix.
// Everything else is categorized by its `source` (telegram, cli, desktop…).
const BOT_PLUMBING_TITLES = new Set(['Bot Chat', 'Agent Inbox'])

function rowCategory(row) {
  const title = text(row.title).trim()
  if (BOT_PLUMBING_TITLES.has(title)) return 'bots'
  if (/^group:\s/i.test(title)) return 'groups'
  return (text(row.source).trim() || 'local').toLowerCase()
}

// Cron jobs are namespaced "[bot:<name>] task" (same convention as the
// bundled Bots plugin). Newer gateways accept `profile` on cron.manage and
// return `scoped`; on older ones we fall back to filtering by the tag.
const BOT_TAG_RE = /^\[bot:([a-z0-9][a-z0-9_-]*)\]\s*/i

function cronOwner(job) {
  const match = BOT_TAG_RE.exec(text(job?.name))
  return match ? match[1].toLowerCase() : null
}

function sessionRow(row, route) {
  return {
    kind: 'session',
    id: text(row.id),
    title: text(row.title, text(row.preview, 'Untitled')),
    preview: text(row.preview),
    profile: text(row.profile, route.targetProfile || route.profile || 'default'),
    connectionId: row.connection_id || route.connectionId,
    source: text(row.source),
    at: timeOf(row),
    raw: row
  }
}

function cronRow(job, route) {
  const id = text(job.id || job.job_id)
  return {
    kind: 'cron',
    id: `cron:${route.connectionId || 'local'}:${route.targetProfile || route.profile || 'default'}:${id}`,
    jobId: id,
    title: text(text(job.name || job.title).replace(BOT_TAG_RE, ''), id || 'Cron job'),
    preview: text(job.prompt || job.prompt_preview || job.description || job.command),
    profile: route.targetProfile || route.profile || 'default',
    connectionId: route.connectionId,
    source: 'cron',
    at: timeOf(job),
    raw: job
  }
}

async function readRoute(route) {
  const profile = route.targetProfile || route.profile || 'default'
  // `profile` ALWAYS goes in the params: on shared-socket topologies the
  // gateway needs it to open the right profile's state.db; on dedicated
  // per-profile backends it is redundant but harmless. Without it,
  // session.list returns the launch profile's sessions for every route.
  const [sessionsResult, cronResult] = await Promise.allSettled([
    host.requestProfile(route, 'session.list', { limit: LIMIT, offset: 0, profile }),
    host.requestProfile(route, 'cron.manage', { action: 'list', include_disabled: true, profile })
  ])
  const sessions = sessionsResult.status === 'fulfilled'
    ? asArray(sessionsResult.value, ['sessions', 'rows']).map(row => sessionRow({ ...row, profile }, route)).filter(row => row.id)
    : []
  // session.list comes ordered by last activity but only carries started_at.
  // Lower bound for each row's real activity: the max started_at of the rows
  // below it — so an old-but-active conversation sorts above anything
  // created before it.
  let floor = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].at > floor) floor = sessions[i].at
    else sessions[i].at = floor
  }
  let jobs = []
  if (cronResult.status === 'fulfilled') {
    const scoped = text(cronResult.value?.scoped).toLowerCase() === profile.toLowerCase()
    jobs = asArray(cronResult.value, ['jobs', 'cron_jobs', 'rows'])
      .filter(job => scoped || (cronOwner(job) || 'default') === profile.toLowerCase())
      .map(row => cronRow(row, route))
      .filter(row => row.jobId)
  }
  const errors = []
  if (sessionsResult.status === 'rejected') errors.push({ kind: 'sessions', profile, message: text(sessionsResult.reason?.message, 'error') })
  if (cronResult.status === 'rejected') errors.push({ kind: 'cron', profile, message: text(cronResult.reason?.message, 'unavailable') })
  return { rows: [...sessions, ...jobs], errors }
}

async function loadAll() {
  const routes = typeof host.profileRoutes === 'function'
    ? await host.profileRoutes()
    : [{ connectionId: 'local', profile: 'default', targetProfile: 'default' }]
  const unique = new Map()
  for (const route of routes || []) {
    const key = `${route.connectionId || 'local'}:${route.targetProfile || route.profile || 'default'}`
    unique.set(key, route)
  }
  const results = await Promise.all([...unique.values()].map(readRoute))
  const rows = results.flatMap(result => result.rows).sort((a, b) => b.at - a.at)
  // The same failure across N routes renders once, not N times.
  const grouped = new Map()
  for (const error of results.flatMap(result => result.errors)) {
    const key = `${error.kind}: ${error.message}`
    const entry = grouped.get(key) || { ...error, profiles: [] }
    entry.profiles.push(error.profile)
    grouped.set(key, entry)
  }
  const errors = [...grouped.values()].map(entry =>
    `${entry.kind} (${entry.profiles.length > 2 ? `${entry.profiles.length} bots` : entry.profiles.join(', ')}): ${entry.message}`)
  return { rows, errors, loadedAt: Date.now() }
}

function Button({ children, onClick, disabled = false }) {
  return jsx('button', {
    type: 'button', disabled, onClick,
    style: {
      border: `1px solid ${colors.border}`, borderRadius: 6, padding: '5px 9px',
      background: 'transparent', color: colors.text, cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.55 : 1, fontSize: '0.75rem'
    }, children
  })
}

function Page({ storage }) {
  const [data, setData] = useState({ rows: [], errors: [], loadedAt: 0 })
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [bot, setBot] = useState('all')
  const [follow, setFollow] = useState(() => (storage ? storage.get('follow', true) !== false : true))
  const activeProfile = useValue(activeProfileAtom) || 'default'
  const loadedAtRef = useRef(0)

  const setFollowPersist = value => {
    setFollow(value)
    if (storage) storage.set('follow', value)
  }

  const loadingRef = useRef(false)
  const knownIdsRef = useRef(null)
  const sigRef = useRef(new Map())
  // Local activity stamps (id → ms): when we last saw each conversation
  // change. Persisted so they survive app restarts.
  const touchRef = useRef(null)
  if (touchRef.current === null) {
    const saved = (storage && storage.get('touched', {})) || {}
    touchRef.current = new Map(Object.entries(saved).map(([id, ts]) => [id, Number(ts) || 0]))
  }
  const [newIds, setNewIds] = useState(() => new Set())

  const refresh = (silent = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (!silent) setLoading(true)
    loadAll().then(result => {
      loadedAtRef.current = result.loadedAt
      const now = Date.now()
      const sessionRows = result.rows.filter(row => row.kind === 'session')
      const ids = new Set(sessionRows.map(row => row.id))
      // Sessions absent from the previous load → marked new until opened.
      // The first load only sets the baseline.
      const freshIds = []
      if (knownIdsRef.current) {
        for (const id of ids) if (!knownIdsRef.current.has(id)) freshIds.push(id)
        if (freshIds.length) setNewIds(prev => new Set([...prev, ...freshIds]))
      }
      knownIdsRef.current = ids
      // If a known session's message count or title changed (or the session
      // is new), that conversation was just updated: stamp = now.
      for (const row of sessionRows) {
        const sig = `${row.raw?.message_count || 0}|${row.title}`
        const prevSig = sigRef.current.get(row.id)
        if (prevSig !== undefined && prevSig !== sig) touchRef.current.set(row.id, now)
        sigRef.current.set(row.id, sig)
      }
      for (const id of freshIds) touchRef.current.set(id, now)
      for (const id of [...touchRef.current.keys()]) if (!ids.has(id)) touchRef.current.delete(id)
      if (storage) storage.set('touched', Object.fromEntries(touchRef.current))
      // Each row's time becomes its last known activity and the list
      // re-sorts: freshly updated conversations rise to the top.
      const rows = result.rows.map(row => {
        const touched = touchRef.current.get(row.id) || 0
        return touched > row.at ? { ...row, at: touched } : row
      }).sort((a, b) => b.at - a.at)
      setData({ ...result, rows })
    }).catch(error => {
      if (!silent) setData({ rows: [], errors: [text(error?.message, 'Could not load history')], loadedAt: Date.now() })
    }).finally(() => {
      loadingRef.current = false
      if (!silent) setLoading(false)
    })
  }

  useEffect(() => {
    refresh()
    // Auto refresh: the gateway emits sessions.changed / cron.changed
    // (already coalesced server-side); we group them 1.5s more in case they
    // arrive in bursts. The 60s interval is the fallback for secondary
    // backends whose events don't travel over the active socket.
    let timer = null
    const schedule = () => {
      if (timer) return
      timer = setTimeout(() => { timer = null; refresh(true) }, 1500)
    }
    const disposers = []
    if (typeof host.onEvent === 'function') {
      for (const type of ['sessions.changed', 'cron.changed']) {
        try { disposers.push(host.onEvent(type, schedule)) } catch (error) { void error }
      }
    }
    const poll = setInterval(() => refresh(true), 60000)
    return () => {
      for (const dispose of disposers) { try { dispose() } catch (error) { void error } }
      if (timer) clearTimeout(timer)
      clearInterval(poll)
    }
  }, [])

  // Follow the active bot: clicking a bot in the roster changes the focused
  // chat's profile and the filter jumps with it (refreshing if data is old).
  useEffect(() => {
    if (!follow) return
    setBot(activeProfile)
    if (loadedAtRef.current && Date.now() - loadedAtRef.current > 5000) refresh(true)
  }, [follow, activeProfile])

  const bots = useMemo(() => [...new Set([...data.rows.map(row => row.profile), activeProfile])].sort(), [data.rows, activeProfile])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.rows.filter(row => (bot === 'all' || row.profile === bot) && (!needle || `${row.title} ${row.preview} ${row.profile}`.toLowerCase().includes(needle)))
  }, [data.rows, bot, query])

  // Category chips: hide/show conversation types in almost no space. The
  // hidden-categories list is persisted, so a new category shows by default.
  const [hiddenCats, setHiddenCats] = useState(() => new Set(storage ? storage.get('hiddenCats', []) : []))
  const setHiddenCatsPersist = next => {
    setHiddenCats(next)
    if (storage) storage.set('hiddenCats', [...next])
  }
  const toggleCat = cat => {
    const next = new Set(hiddenCats)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    setHiddenCatsPersist(next)
  }

  const cats = useMemo(() => {
    const counts = new Map()
    for (const row of visible) {
      if (row.kind === 'cron') continue
      const cat = rowCategory(row)
      counts.set(cat, (counts.get(cat) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [visible])

  const sessions = useMemo(() => visible.filter(row => row.kind !== 'cron' && !hiddenCats.has(rowCategory(row))), [visible, hiddenCats])
  const crons = useMemo(() => visible.filter(row => row.kind === 'cron'), [visible])

  // Cron routines are collapsed by default into their own foldable section.
  const [showCron, setShowCron] = useState(() => (storage ? storage.get('showCron', false) === true : false))
  const setShowCronPersist = value => {
    setShowCron(value)
    if (storage) storage.set('showCron', value)
  }

  const open = async row => {
    if (newIds.has(row.id)) setNewIds(prev => { const next = new Set(prev); next.delete(row.id); return next })
    if (row.kind !== 'session') return
    try {
      if (typeof host.ensureAgent === 'function') await host.ensureAgent(row.connectionId || null, row.profile)
      await host.openSession(row.raw.id, { profile: row.profile, keepAllProfilesScope: true, expectHistory: true })
    } catch (error) {
      host.notify({ kind: 'error', message: text(error?.message, 'Could not open the session') })
    }
  }

  const renderRow = row => {
    const isNew = newIds.has(row.id)
    return jsxs('button', { type: 'button', onClick: () => open(row), disabled: row.kind === 'cron', title: isNew ? 'New conversation' : undefined, style: {
      display: 'flex', width: '100%', textAlign: 'left', gap: 10, padding: '10px 8px',
      border: isNew ? `1px solid ${colors.accent}` : 0,
      borderBottom: `1px solid ${isNew ? colors.accent : colors.border}`,
      borderRadius: isNew ? 8 : 0, margin: isNew ? '4px 0' : 0,
      background: 'transparent', color: colors.text, cursor: row.kind === 'cron' ? 'default' : 'pointer'
    }, children: [
    jsx('span', { style: { width: 48, color: row.kind === 'cron' ? colors.accent : colors.muted, fontSize: '0.7rem', flexShrink: 0 }, children: row.kind === 'cron' ? 'CRON' : 'CHAT' }),
    jsxs('span', { style: { minWidth: 0, flex: 1 }, children: [jsx('strong', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: row.title }), jsx('span', { style: { display: 'block', color: colors.muted, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: row.preview || `${row.profile} · ${row.source || 'local'}` })] }),
    jsxs('span', { style: { color: colors.faint, fontSize: '0.7rem', whiteSpace: 'nowrap' }, children: [row.profile, jsx('br', {}), formatTime(row.at)] })
  ] }, row.id)
  }

  return jsxs('div', { className: 'flex h-full min-h-0 flex-col', children: [
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }, children: [
      jsx('h1', { style: { margin: 0, color: colors.text, fontSize: '1rem', fontWeight: 600 }, children: PLUGIN_NAME }),
      jsx('span', { style: { color: colors.faint, fontSize: '0.75rem' }, children: crons.length ? `${sessions.length} conversations · ${crons.length} routines` : `${sessions.length} conversations` }),
      jsx('div', { style: { marginLeft: 'auto' }, children: jsx(Button, { onClick: refresh, disabled: loading, children: loading ? 'Loading…' : 'Refresh' }) })
    ] }),
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }, children: [
      jsx('input', { value: query, onChange: event => setQuery(event.target.value), placeholder: 'Search conversations…', style: { flex: 1, minWidth: 0, background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, padding: '6px 8px' } }),
      jsx('select', { value: bot, onChange: event => { const value = event.target.value; setBot(value); if (value !== activeProfile) setFollowPersist(false) }, style: { maxWidth: 180, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, padding: '5px' }, children: [jsx('option', { value: 'all', children: 'All bots' }), bots.map(name => jsx('option', { value: name, children: name }, name))] }),
      jsxs('button', {
        type: 'button',
        title: follow ? `Following the active bot (${activeProfile}). Click to pause.` : 'Paused. Click to follow the active bot again.',
        onClick: () => { if (follow) { setFollowPersist(false) } else { setFollowPersist(true); setBot(activeProfile) } },
        style: {
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '5px 9px',
          border: `1px solid ${follow ? botColor(activeProfile) : colors.border}`, borderRadius: 999,
          background: 'transparent', color: follow ? colors.text : colors.faint, cursor: 'pointer', fontSize: '0.72rem'
        },
        children: [
          jsx('span', { style: { width: 8, height: 8, borderRadius: '50%', background: follow ? botColor(activeProfile) : colors.faint, flexShrink: 0 } }),
          follow ? `Following: ${activeProfile}` : 'Follow bot'
        ]
      })
    ] }),
    cats.length > 1 ? jsxs('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: '7px 14px', borderBottom: `1px solid ${colors.border}` }, children: [
      jsx('button', {
        type: 'button',
        title: hiddenCats.size ? 'Show every category' : 'Hide every category',
        onClick: () => setHiddenCatsPersist(hiddenCats.size ? new Set() : new Set(cats.map(([cat]) => cat))),
        style: { border: `1px solid ${colors.border}`, borderRadius: 999, padding: '2px 8px', background: 'transparent', color: colors.muted, cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600 },
        children: hiddenCats.size ? 'All' : 'None'
      }),
      cats.map(([cat, count]) => {
        const active = !hiddenCats.has(cat)
        return jsxs('button', {
          type: 'button',
          onClick: () => toggleCat(cat),
          title: active ? `Hide ${cat}` : `Show ${cat}`,
          style: {
            display: 'flex', alignItems: 'center', gap: 4,
            border: `1px solid ${active ? colors.accent : colors.border}`, borderRadius: 999, padding: '2px 8px',
            background: 'transparent', color: active ? colors.text : colors.faint,
            opacity: active ? 1 : 0.6, cursor: 'pointer', fontSize: '0.68rem'
          },
          children: [cat, jsx('span', { style: { color: active ? colors.muted : colors.faint }, children: String(count) })]
        }, cat)
      })
    ] }) : null,
    data.errors.length ? jsx('div', { style: { padding: '8px 14px', color: colors.faint, fontSize: '0.75rem' }, children: data.errors.join(' · ') }) : null,
    jsxs('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 14px' }, children: [
      crons.length ? jsxs('button', {
        type: 'button',
        onClick: () => setShowCronPersist(!showCron),
        title: showCron ? 'Collapse routines' : 'Expand routines',
        style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px', border: 0, borderBottom: `1px solid ${colors.border}`, background: 'transparent', color: colors.muted, cursor: 'pointer', fontSize: '0.75rem' },
        children: [
          jsx('span', { style: { color: colors.accent, fontSize: '0.65rem', flexShrink: 0 }, children: showCron ? '▾' : '▸' }),
          jsx('span', { style: { fontWeight: 600 }, children: `Scheduled routines (${crons.length})` })
        ]
      }) : null,
      showCron ? crons.map(row => renderRow(row)) : null,
      sessions.length ? sessions.map(row => renderRow(row)) : jsx('div', { style: { padding: 20, color: colors.faint }, children: loading ? 'Loading history…' : 'No conversations match this filter.' })
    ] })
  ] })
}

export default {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: 'Every bot conversation in one live list — follow the active bot, filter by type, fold cron routines.',
  defaultEnabled: true,
  register(ctx) {
    ctx.register({ id: 'page', area: sdk.ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(Page, { storage: ctx.storage }) })
    ctx.register({ id: 'nav', area: sdk.SIDEBAR_NAV_AREA, order: 63, data: { path: ROUTE, label: PLUGIN_NAME, codicon: 'history' } })
    ctx.register({ id: 'open', area: sdk.PALETTE_AREA, data: { id: 'bot-sessions.open', label: 'Bot Sessions: open history', keywords: ['bots', 'sessions', 'conversations', 'cron'], run: () => host.navigate(ROUTE) } })
  }
}
