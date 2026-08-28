/**
 * Profile Studio — cast your agents like people, not YAML files.
 *
 * A roster of persona cards (each with the app's real profileColor hue), an
 * identity sheet on click, a Persona-to-SOUL generator (deterministic instant
 * template + AI-written in a throwaway session), a Simple/Advanced Brain
 * picker, and an honest CLI-command escape hatch for config keys the plugin
 * can't reach. Pure plugin: hot-reloads, no rebuild.
 *
 * Save as: ~/.hermes/desktop-plugins/profile-studio/plugin.js
 * Plain ESM, loaded uncompiled — jsx() calls, not JSX syntax.
 */

import {
  Button,
  Input,
  Badge,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  PALETTE_AREA,
  SIDEBAR_NAV_AREA,
  ScrollArea,
  SearchField,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  StatusDot,
  Switch,
  Textarea,
  cn,
  haptic,
  host,
  icons,
  profileColor,
  profileColorSoft,
  useValue,
  atom
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Fragment, useEffect, useRef, useState } from 'react'

// ── reactive state (module-level, survives pane unmount) ────────────────────

const $pstudioProfiles = atom([])           // ProfileInfo[]
const $pstudioActive = atom(null)           // name of open profile (sheet) | null
const $pstudioLoading = atom(true)
const $pstudioError = atom(null)            // string | null
const $pstudioView = atom('grid')           // 'grid' | 'list'
const $pstudioSearch = atom('')
const $pstudioSoulDraft = atom(null)        // in-flight SOUL text (guided/raw/generated)
const $pstudioSoulPreview = atom(false)     // show live persona preview
const $pstudioMode = atom({ personality: 'guided', brain: 'simple' })
const $pstudioGenerating = atom(false)
const $pstudioTesting = atom(false)
const $pstudioTestResult = atom(null)       // { ok, msg } | null
const $pstudioRefreshing = atom(false)

const $pstudioViewKey = 'profile-studio-view'
const $pstudioModeKey = 'profile-studio-mode'

// friendly default accent for `default`/null profiles (profileColor → null)
const PSTUDIO_DEFAULT_ACCENT = 'hsl(208 72% 56%)'

// Verified-working model manifest (live-tested end-to-end). DO NOT list the
// full provider catalog — an invalid model = a vanished agent.
const PSTUDIO_MODEL_MANIFEST = [
  { group: 'Fast', entries: [
    { model: 'qwen3.8-max-preview', provider: 'custom:qwen-token-plan', label: 'qwen3.8-max' },
    { model: 'deepseek-v4-flash', provider: 'deepseek', label: 'deepseek-v4-flash' }
  ]},
  { group: 'Smart', entries: [
    { model: 'claude-sonnet-4', provider: 'anthropic', label: 'claude-sonnet-4' },
    { model: 'gpt-4o', provider: 'openai', label: 'gpt-4o' }
  ]},
  { group: 'Local / Free', entries: [
    { model: 'Qwen3.8-27B-FP8', provider: 'custom:local', label: 'Qwen3.8-27B · local' },
    { model: 'MiniMax-M2.7', provider: 'minimax', label: 'MiniMax-M2.7' }
  ]}
]

// ── helpers ────────────────────────────────────────────────────────────────

function pstudioProfileAccent(name) {
  const c = profileColor(name)
  return c || PSTUDIO_DEFAULT_ACCENT
}

function pstudioInitials(name) {
  return (name || '').replace(/-|_|\s/g, ' ').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

function pstudioRoleOf(soul) {
  // First non-empty, meaningful line of the SOUL → role tag (heuristic).
  if (!soul) return 'agent'
  const lines = soul.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const stripped = line.replace(/^#+\s*/, '').replace(/^[*-]\s*/, '').trim()
    if (stripped && stripped.length <= 80 && /[A-Za-z]/.test(stripped) && !/^(who|what|you|##)/i.test(stripped.split(' ')[0] === stripped.split(' ')[0] ? stripped : stripped)) {
      // skip heading-like first lines, keep a descriptive sentence
      return stripped
    }
  }
  return 'agent'
}

// ── REST bridge (profiles / model) — `window.hermesDesktop.api` ─────────────

function pstudioApiBare(request) {
  // /api/profiles walks the skill tree per profile — the app's own caller
  // uses STARTUP_REQUEST_TIMEOUT_MS (60s) for this exact endpoint. Without
  // it, a profile-heavy install silently times out and returns a partial list.
  const timeoutMs = request.path === '/api/profiles' ? 60_000 : 15_000
  return window.hermesDesktop.api({ ...request, timeoutMs })
}

async function pstudioListProfiles() {
  const res = await pstudioApiBare({ path: '/api/profiles' })
  const list = (res && res.profiles) || []
  $pstudioProfiles.set(list)
  return list
}

async function pstudioCreateProfile(name, opts = {}) {
  const body = { name, ...opts }
  return pstudioApiBare({ path: '/api/profiles', method: 'POST', body })
}

async function pstudioRenameProfile(name, newName) {
  return pstudioApiBare({ path: `/api/profiles/${encodeURIComponent(name)}`, method: 'PATCH', body: { new_name: newName } })
}

async function pstudioDeleteProfile(name) {
  return pstudioApiBare({ path: `/api/profiles/${encodeURIComponent(name)}`, method: 'DELETE' })
}

async function pstudioGetSoul(name) {
  return pstudioApiBare({ path: `/api/profiles/${encodeURIComponent(name)}/soul` })
}

async function pstudioSetSoul(name, content) {
  return pstudioApiBare({ path: `/api/profiles/${encodeURIComponent(name)}/soul`, method: 'PUT', body: { content } })
}

async function pstudioSetModel(name, body) {
  return pstudioApiBare({ path: '/api/model/set', method: 'POST', body: { ...body, profile: name } })
}

function pstudioRefresh() {
  $pstudioRefreshing.set(true)
  return pstudioListProfiles()
    .catch(err => { $pstudioError.set(err && err.message ? err.message : 'Failed to load profiles') })
    .finally(() => { $pstudioRefreshing.set(false); $pstudioLoading.set(false) })
}

// ── Persona-to-SOUL generator (Tier A — deterministic instant template) ─────

const PSTUDIO_SOUL_SIGNALS = [
  { re: /blunt|direct|no filler|straight|frank|honest/i, label: 'Direct, no filler', voice: 'Be direct, candid, and to the point. Avoid filler and hedging.' },
  { re: /witty|funny|humor|dry|sarcastic|banter/i, label: 'Wit & dry humor', voice: 'Use natural, dry wit and humor. Never force jokes.' },
  { re: /no emoji|without emoji|never emoji/i, label: 'No emoji', rule: 'Never use emoji in any output.' },
  { re: /warm|friendly|genial|approachable/i, label: 'Warm & approachable', voice: 'Be warm, friendly, and approachable.' },
  { re: /concise|brief|short|to the point|tldr|tight/i, label: 'Concise & brief', rule: 'Be concise. Lead with the answer; add detail only on request.' },
  { re: /evidence|data|proof|cite|source|numbers/i, label: 'Evidence-driven', rule: 'Support every claim with evidence, data, or a concrete example. Never guess.' },
  { re: /professional|expert|senior|seasoned|veteran/i, label: 'Senior & professional', voice: 'Speak with senior, professional authority. Rely on deep domain expertise.' },
  { re: /creative|imaginative|bold|visionary|original/i, label: 'Creative & bold', voice: 'Think creatively. Offer bold, original, well-reasoned ideas.' },
  { re: /ask first|ask before|confirm|permission|don't act/i, label: 'Ask before acting', rule: 'Ask before triggering external actions (publishing, sending, installing).' },
  { re: /private|secret|confidential|don't share/i, label: 'Guard privacy', rule: 'Treat private information as strictly confidential. Never share it.' },
  { re: /copywrite|copy|write|words|marketing|ad|content/i, label: 'Copywriter', voice: 'Write in a crafted, persuasive, high-quality voice.' },
  { re: /code|dev|engineer|program|build|technical/i, label: 'Technical', voice: 'Write in precise, technical language. Lead with working code and mechanisms.' }
]

function pstudioParseSignals(desc) {
  const hits = PSTUDIO_SOUL_SIGNALS.filter(s => s.re.test(desc)).map(s => ({ label: s.label, voice: s.voice, rule: s.rule }))
  return hits
}

function pstudioBuildSoul(name, desc, signals) {
  const role = (signals.find(s => s.label === 'Copywriter') && 'writer') ||
               (signals.find(s => s.label === 'Technical') && 'engineer') || 'agent'
  const voice = signals.map(s => s.voice).filter(Boolean).join('\n')
  const rules = signals.map(s => s.rule).filter(Boolean).join('\n')
  const persona = desc && desc.trim() ? desc.trim() : `${name} — a Hermes agent.`

  return `# SOUL.md - Who I am.

## You are ${name}
${persona}

## Voice
${voice || 'Speak with clarity and authority. Be genuinely helpful, not performatively helpful.'}
${role === 'writer' ? 'Write like a craftsman, not a copy machine.' : ''}
${role === 'engineer' ? 'Lead with working code and mechanism, not abstract descriptions.' : ''}

## Rules
${rules || 'Be direct. Support claims with evidence. Stay on task.'}

## Boundaries
Ask before external actions (publishing, sending, installing). Keep private things private. Never guess — read the file, check the source.`
}

// ── AI SOUL generator (Tier B — throwaway session) ─────────────────────────

const $pstudioGenSession = atom(null)       // { session_id, profile } for the AI write

const pstudioPersonaPrompt = (name, desc) =>
  `Write a complete SOUL.md for this Hermes agent persona.\n\n` +
  `Profile name: ${name}\nDescription: ${desc || 'a versatile, sharp Hermes agent'}\n\n` +
  `Return ONLY the raw markdown. Use these sections: # SOUL.md, ## Voice, ## Rules, ## Boundaries. ` +
  `Match the tone of the description. Make it specific and vivid, not generic.`

async function pstudioGenerateAi(name, desc) {
  // Use a scratch session on the SAME profile so it has the right credentials,
  // but it is a fresh session — never the live conversation.
  const created = await host.request('session.create', { profile: name, cols: 96, source: 'desktop' })
  const session_id = created.session_id || created.stored_session_id
  $pstudioGenSession.set({ session_id, profile: name })
  $pstudioGenerating.set(true)

  // Subscribe to that session's stream BEFORE sending.
  const off = host.onEvent('message.delta', ev => {
    if (ev.session_id !== session_id && ev.sessionId !== session_id) return
    const chunk = ev.payload && ev.payload.text
    if (typeof chunk !== 'string') return
    $pstudioSoulDraft.set(($pstudioSoulDraft.get() || '') + chunk)
  })

  await host.request('prompt.submit', { session_id, text: pstudioPersonaPrompt(name, desc) })

  // Turn end is message.complete on the desktop WS surface (NOT assistant.completed).
  await new Promise(resolve => {
    const done = ev => {
      if (ev.session_id !== session_id && ev.sessionId !== session_id) return
      off()
      resolve()
    }
    host.onEvent('message.complete', done)
    // safety timeout if the stream never completes
    setTimeout(() => { off(); resolve() }, 90000)
  })

  $pstudioGenerating.set(false)
  $pstudioSoulPreview.set(true)
}

// ── model live-test ────────────────────────────────────────────────────────

async function pstudioLiveTest(baseUrl) {
  $pstudioTesting.set(true)
  $pstudioTestResult.set(null)
  try {
    const url = (baseUrl || '').replace(/\/$/, '')
    const target = url ? `${url}/v1/models` : null
    if (!target) {
      $pstudioTestResult.set({ ok: false, msg: 'Enter a base URL to test.' })
      return
    }
    // Can't set a custom Authorization header cross-origin here; probe
    // reachability + shape. A 200/401 both prove the endpoint is alive.
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 6000)
    const res = await fetch(target, { signal: ctl.signal })
    clearTimeout(t)
    if (res.ok) $pstudioTestResult.set({ ok: true, msg: `Online · HTTP ${res.status}` })
    else if (res.status === 401) $pstudioTestResult.set({ ok: false, msg: `Alive · needs a key (${res.status})` })
    else $pstudioTestResult.set({ ok: false, msg: `HTTP ${res.status}` })
  } catch (e) {
    $pstudioTestResult.set({ ok: false, msg: `Unreachable (${e && e.message ? e.message : 'network error'})` })
  } finally {
    $pstudioTesting.set(false)
  }
}

// ── CLI-command escape hatch (config keys beyond the plugin's reach) ────────

function pstudioCliCommands(name) {
  return [
    `hermes --profile ${name} config set agent.max_turns 90`,
    `hermes --profile ${name} config set terminal.timeout 180`,
    `hermes --profile ${name} config set memory.memory_enabled true`
  ].join('\n')
}

// ── React components ───────────────────────────────────────────────────────

function PstudioPane() {
  useValue($pstudioProfiles)
  useValue($pstudioLoading)
  useValue($pstudioError)
  useValue($pstudioView)
  useValue($pstudioSearch)
  useValue($pstudioActive)
  useValue($pstudioRefreshing)

  useEffect(() => {
    $pstudioView.set(pstudioNormalizeView(pstudioViewKeyStored()))
  }, [])

  if ($pstudioLoading.get()) {
    return jsx('div', { className: 'pstudio-center', style: { display: 'grid', placeItems: 'center', height: '100%', color: 'var(--ui-text-secondary)' }, children: 'Loading profiles…' })
  }
  if ($pstudioError.get()) {
    return jsxs(ErrorState, { title: 'Could not load profiles', description: $pstudioError.get(), children: [jsx(Button, { variant: 'secondary', onClick: () => { $pstudioError.set(null); pstudioRefresh() }, children: 'Retry' })] })
  }

  const list = pstudioFilterProfiles($pstudioProfiles.get(), $pstudioSearch.get())

  return jsxs('div', {
    className: 'pstudio-root',
    style: { display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, background: 'var(--ui-background)' },
    children: [
      jsx(PstudioTopbar, {}),
      jsxs('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden' }, children: [
        jsxs(ScrollArea, { className: cn('pstudio-scroll'), style: { height: '100%' }, children: [
          $pstudioView.get() === 'grid'
            ? jsx(PstudioGrid, { profiles: list })
            : jsx(PstudioList, { profiles: list })
        ]})
      ]}),
      $pstudioActive.get() ? jsx(PstudioSheet, { name: $pstudioActive.get() }) : null
    ]
  })
}

function PstudioTopbar() {
  useValue($pstudioView)
  useValue($pstudioSearch)
  const v = $pstudioView.get()
  return jsxs('div', {
    className: 'pstudio-topbar',
    style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--ui-stroke-secondary)' },
    children: [
      jsx('div', { style: { fontSize: 13, fontWeight: 640, letterSpacing: '-0.01em', marginRight: 'auto' }, children: 'Profile Studio' }),
      jsxs(SearchField, {
        value: $pstudioSearch.get(),
        onChange: ev => $pstudioSearch.set(ev.target.value),
        placeholder: 'Search profiles…',
        style: { width: 150 }
      }),
      jsxs(SegmentedControl, {
        value: v,
        onChange: sel => { $pstudioView.set(sel); pstudioViewKeyStore(sel) },
        options: [{ id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' }]
      }),
      jsx(Button, { size: 'sm', variant: 'default', onClick: () => pstudioNewFlow(), children: jsxs('span', { children: [jsx(icons.Plus, { size: 14 }), ' New'] }) })
    ]
  })
}

function PstudioGrid({ profiles }) {
  if (!profiles.length) return jsx(PstudioEmpty, {})
  return jsxs('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, padding: 14 },
    children: [
      ...profiles.map(p => jsx(PstudioCard, { p, key: p.name })),
      jsx(PstudioNewCard, { key: '__new' })
    ]
  })
}

function PstudioList({ profiles }) {
  if (!profiles.length) return jsx(PstudioEmpty, {})
  return jsxs('div', { style: { padding: 8 }, children: [
    ...profiles.map(p => jsx(PstudioListRow, { p, key: p.name })),
    jsx(PstudioNewCard, { key: '__new', row: true })
  ]})
}

function PstudioCard({ p }) {
  const accent = pstudioProfileAccent(p.name)
  const isDefault = p.is_default
  const soulPreview = pstudioSoulHint(p)
  return jsxs('div', {
    className: cn('pstudio-card', $pstudioActive.get() === p.name && 'pstudio-card-active'),
    onClick: () => $pstudioActive.set(p.name),
    style: { position: 'relative', borderRadius: 12, border: '1px solid var(--ui-stroke-secondary)', background: 'var(--ui-surface-1)', padding: 14, cursor: 'pointer', transition: 'transform .1s ease, border-color .1s ease, box-shadow .1s ease' },
    children: [
      jsx('div', { style: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '12px 12px 0 0', background: accent } }),
      jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }, children: [
        jsx('div', { style: { width: 38, height: 38, borderRadius: 10, background: accent, color: '#0a0a0e', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }, children: pstudioInitials(p.display_name || p.name) }),
        jsxs('div', { style: { minWidth: 0 }, children: [
          jsx('div', { style: { fontWeight: 640, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: p.display_name || p.name }),
          jsx('div', { style: { fontSize: 11, color: 'var(--ui-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }, children: pstudioRoleOf(soulPreview) })
        ]}),
        jsxs('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }, children: [
          jsx(StatusDot, { tone: isDefault ? 'muted' : 'good', title: isDefault ? 'default' : 'active' }),
          jsx('span', { style: { fontSize: 10, color: 'var(--ui-text-tertiary)' }, children: isDefault ? 'default' : 'local' })
        ]})
      ]}),
      jsxs('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }, children: [
        jsx(Badge, { variant: 'subtle', style: { color: accent }, children: jsxs('span', { children: [jsx('span', { children: '◆' }), ' ', p.model || 'no model'] }) }),
        jsx(Badge, { variant: 'subtle', children: `${p.skill_count || 0} skills` }),
        p.provider ? jsx(Badge, { variant: 'subtle', children: p.provider }) : null
      ]}),
      jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--ui-stroke-secondary)', paddingTop: 10, fontSize: 11, color: 'var(--ui-text-tertiary)' }, children: [
        jsx('span', { children: isDefault ? 'system profile' : 'profile' }),
        jsxs('div', { style: { display: 'flex', gap: 4 }, children: [
          jsx(PstudioIconBtn, { title: 'Duplicate', onClick: e => { e.stopPropagation(); pstudioDuplicate(p.name) }, icon: jsx(icons.Copy, { size: 13 }) }),
          isDefault ? null : jsx(PstudioIconBtn, { title: 'Delete', danger: true, onClick: e => { e.stopPropagation(); pstudioDeleteFlow(p.name) }, icon: jsx(icons.Trash2, { size: 13 }) })
        ]})
      ]})
    ]
  })
}

function PstudioListRow({ p }) {
  const accent = pstudioProfileAccent(p.name)
  return jsxs('div', {
    onClick: () => $pstudioActive.set(p.name),
    style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid transparent', cursor: 'pointer', background: 'transparent' },
    className: 'pstudio-row',
    children: [
      jsx('div', { style: { width: 26, height: 26, borderRadius: 7, background: accent, color: '#0a0a0e', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 11, flexShrink: 0 }, children: pstudioInitials(p.display_name || p.name) }),
      jsx('div', { style: { fontWeight: 600, fontSize: 13, width: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: p.display_name || p.name }),
      jsx('span', { style: { fontSize: 11, color: 'var(--ui-text-secondary)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: p.model || '—' }),
      jsx(Badge, { variant: 'subtle', children: `${p.skill_count || 0} skills` }),
      jsx(StatusDot, { tone: p.is_default ? 'muted' : 'good' })
    ]
  })
}

function PstudioNewCard({ row }) {
  if (row) {
    return jsxs('div', { onClick: () => pstudioNewFlow(), style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px dashed var(--ui-stroke-secondary)', cursor: 'pointer' }, children: [
      jsx('span', { children: '+' }), jsx('span', { style: { fontSize: 12, color: 'var(--ui-text-secondary)' }, children: 'New profile' })
    ]})
  }
  return jsxs('div', { onClick: () => pstudioNewFlow(), style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, border: '1px dashed var(--ui-stroke-secondary)', minHeight: 150, cursor: 'pointer', color: 'var(--ui-text-secondary)' }, children: [
    jsx('div', { style: { width: 36, height: 36, borderRadius: '50%', background: 'var(--ui-surface-2)', display: 'grid', placeItems: 'center', fontSize: 18 }, children: '+' }),
    jsx('div', { style: { fontSize: 12 }, children: 'New profile' })
  ]})
}

function PstudioEmpty() {
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 10, textAlign: 'center' }, children: [
    jsx('div', { style: { fontSize: 15, fontWeight: 640 }, children: 'No profiles yet' }),
    jsx('div', { style: { fontSize: 12, color: 'var(--ui-text-secondary)' }, children: 'Create your first agent persona.' }),
    jsx(Button, { onClick: () => pstudioNewFlow(), children: 'New profile' })
  ]})
}

function PstudioIconBtn({ children, title, onClick, danger }) {
  return jsx('button', {
    title, onClick,
    className: 'pstudio-iconbtn',
    style: { width: 26, height: 26, borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: danger ? 'var(--ui-destructive)' : 'var(--ui-text-secondary)', cursor: 'pointer', display: 'grid', placeItems: 'center', fontSize: 13 },
    children
  })
}

// ── Identity Sheet ─────────────────────────────────────────────────────────

function PstudioSheet({ name }) {
  useValue($pstudioSoulDraft)
  useValue($pstudioSoulPreview)
  useValue($pstudioMode)
  useValue($pstudioTesting)
  useValue($pstudioTestResult)
  useValue($pstudioGenerating)
  const p = $pstudioProfiles.get().find(x => x.name === name)
  const accent = pstudioProfileAccent(name)

  useEffect(() => {
    // load existing SOUL when the sheet opens
    pstudioGetSoul(name).then(s => {
      const content = (s && s.content) || ''
      $pstudioSoulDraft.set(content)
      $pstudioSoulPreview.set(false)
    }).catch(() => { $pstudioSoulDraft.set(''); $pstudioSoulPreview.set(false) })
    return () => { $pstudioSoulDraft.set(null); $pstudioSoulPreview.set(false) }
  }, [name])

  return jsxs(Fragment, { children: [
    // opaque backdrop — blocks the card grid from bleeding through the glass
    jsx('div', { key: 'pstudio-backdrop', onClick: () => $pstudioActive.set(null), style: { position: 'fixed', inset: 0, zIndex: 59, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' } }),
    jsxs('div', { key: 'pstudio-sheet', style: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 92vw)', zIndex: 60, background: 'var(--ui-background)', backgroundClip: 'padding-box', borderLeft: '1px solid var(--ui-stroke-secondary)', boxShadow: '-20px 0 60px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column' }, children: [
    // header
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--ui-stroke-secondary)' }, children: [
      jsx('div', { style: { width: 40, height: 40, borderRadius: 10, background: accent, color: '#0a0a0e', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 15 }, children: pstudioInitials(name) }),
      jsxs('div', { style: { minWidth: 0 }, children: [
        jsx('div', { style: { fontWeight: 660, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: p ? (p.display_name || name) : name }),
        jsx('div', { style: { fontSize: 11, color: 'var(--ui-text-secondary)' }, children: `${p ? (p.provider || '—') : '—'} · ${p ? (p.model || 'no model') : ''}` })
      ]}),
      jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => $pstudioActive.set(null), style: { marginLeft: 'auto' }, children: '✕' })
    ]}),
    // body
    jsxs(ScrollArea, { style: { flex: 1, minHeight: 0 }, children: [
      jsxs('div', { style: { padding: '18px 20px 40px', display: 'flex', flexDirection: 'column', gap: 26 }, children: [
        jsx(PstudioSheetSection, { title: 'Identity', desc: 'What this agent is called', children: [
          jsxs('div', { children: [
            PstudioField({ label: 'Profile name', children: jsx(Input, { defaultValue: name, value: name, readOnly: true, className: 'pstudio-mono', style: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }) }),
            jsx(Button, { variant: 'outline', size: 'sm', style: { marginTop: 6 }, children: 'This is created — rename lives in CLI (Phase 2)' })
          ]})
        ]}),
        jsx(PstudioSheetSection, { title: 'Personality', desc: 'The SOUL — who they are', mode: true, modeKey: 'personality', children: [
          $pstudioMode.get().personality === 'guided'
            ? jsx(PstudioPersonaGuided, { name, accent })
            : jsx(PstudioPersonaRaw, { name })
        ]}),
        jsx(PstudioSheetSection, { title: 'Brain', desc: 'The model that thinks for them', mode: true, modeKey: 'brain', children: [
          $pstudioMode.get().brain === 'simple' ? jsx(PstudioBrainSimple, { name }) : jsx(PstudioBrainAdvanced, { name })
        ]}),
        jsx(PstudioSheetSection, { title: 'Skills & Capabilities', desc: `${p ? p.skill_count : 0} skills loaded`, children: [
          jsx('div', { style: { fontSize: 12, color: 'var(--ui-text-secondary)' }, children: 'Toolset wiring is managed in Settings → Capabilities (Phase 2).' })
        ]}),
        jsx(PstudioSheetSection, { title: 'Advanced config', desc: 'Deep settings beyond the plugin’s reach — one click away', children: [
          jsx(PstudioConfigCliBlock, { name })
        ]}),
        jsx(PstudioSheetSection, { title: 'Danger zone', desc: '', children: [
          jsx(PstudioDangerZone, { name, isDefault: !!(p && p.is_default) })
        ]})
      ]})
    ]})
    ]})
  ]})
}

function PstudioSheetSection({ title, desc, mode, modeKey, children }) {
  const m = $pstudioMode.get()
  const val = modeKey ? m[modeKey] : null
  return jsxs('div', { children: [
    jsxs('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }, children: [
      jsxs('div', { children: [
        jsx('div', { style: { fontSize: 13, fontWeight: 640, letterSpacing: '-0.01em' }, children: title }),
        desc ? jsx('div', { style: { fontSize: 11.5, color: 'var(--ui-text-secondary)', marginTop: 1 }, children: desc }) : null
      ]}),
      mode ? jsxs(SegmentedControl, {
        value: val,
        onChange: sel => $pstudioMode.set({ ...m, [modeKey]: sel }),
        options: modeKey === 'personality' ? [{ id: 'guided', label: 'Persona' }, { id: 'raw', label: 'Raw' }] : [{ id: 'simple', label: 'Simple' }, { id: 'advanced', label: 'Advanced' }]
      }) : null
    ]}),
    jsx('div', { style: { fontSize: 13, lineHeight: 1.55 }, children })
  ]})
}

function PstudioField({ label, children }) {
  return jsxs('div', { style: { marginBottom: 12 }, children: [
    jsx('label', { style: { display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--ui-text-secondary)', marginBottom: 5 }, children: label }),
    children
  ]})
}

// ── Persona (SOUL) guided + raw ─────────────────────────────────────────────

function PstudioPersonaGuided({ name, accent }) {
  const [desc, setDesc] = useState('')
  const [generatedSoul, setGeneratedSoul] = useState('')
  const draft = $pstudioSoulDraft.get()
  useValue($pstudioSoulPreview)
  useValue($pstudioGenerating)

  const gen = () => {
    const signals = desc.trim() ? pstudioParseSignals(desc) : []
    const soul = pstudioBuildSoul(name, desc, signals)
    setGeneratedSoul(soul)
    $pstudioSoulDraft.set(soul)
    $pstudioSoulPreview.set(true)
  }

  const genAi = async () => {
    try {
      await pstudioGenerateAi(name, desc)
    } catch (e) {
      host.notifyError(e, 'Generate SOUL')
    }
  }

  const commit = () => {
    const soul = $pstudioSoulDraft.get()
    if (!soul) { host.notify({ kind: 'warning', message: 'Nothing to save yet.' }); return }
    pstudioSetSoul(name, soul).then(() => {
      haptic('tap')
      host.notify({ kind: 'success', message: `Saved ${name}'s personality.` })
      pstudioRefresh()
    }).catch(err => host.notifyError(err, 'Save SOUL'))
  }

  return jsxs('div', { children: [
    jsxs('div', { style: { background: 'var(--ui-surface-1)', border: '1px solid var(--ui-stroke-secondary)', borderRadius: 10, padding: 12 }, children: [
      jsxs('div', { style: { fontSize: 12, fontWeight: 640, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }, children: [jsx('span', { style: { color: 'var(--ui-accent)' }, children: '✦' }), ' Describe this agent in plain English' ]}),
      jsx(Textarea, {
        value: desc,
        onChange: e => setDesc(e.target.value),
        placeholder: 'A blunt, evidence-driven strategic co-founder. No emoji. Pushes back with data. Concise.',
        style: { minHeight: 84 }
      }),
      jsxs('div', { style: { display: 'flex', gap: 8, marginTop: 10 }, children: [
        jsx(Button, { onClick: gen, children: jsxs('span', { children: ['✦', ' Generate SOUL'] }) }),
        jsx(Button, { variant: 'secondary', onClick: genAi, disabled: $pstudioGenerating.get(), children: $pstudioGenerating.get() ? 'Writing…' : 'Generate with AI' }),
        jsx(Button, { variant: 'ghost', onClick: commit, children: 'Commit' })
      ]})
    ]}),
    $pstudioSoulPreview.get() && draft ? jsx(PstudioPersonaPreview, { name, accent, soul: draft }) : null
  ]})
}

function PstudioPersonaPreview({ name, accent, soul }) {
  const persona = pstudioRoleOfPersona(soul)
  return jsxs('div', { style: { marginTop: 12 }, children: [
    jsxs('div', { style: { fontSize: 11, fontWeight: 640, color: 'var(--ui-text-secondary)', marginBottom: 6 }, children: ['Preview — what this agent will be like'] }),
    jsxs('div', { style: { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 10, padding: 12, background: 'var(--ui-surface-1)' }, children: [
      jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }, children: [
        jsx('div', { style: { width: 34, height: 34, borderRadius: 8, background: accent, color: '#0a0a0e', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13 }, children: pstudioInitials(name) }),
        jsxs('div', { children: [
          jsx('div', { style: { fontWeight: 640, fontSize: 13 }, children: name }),
          jsx('div', { style: { fontSize: 11, color: 'var(--ui-text-secondary)' }, children: persona })
        ]})
      ]}),
      jsx('div', { style: { fontSize: 11.5, color: 'var(--ui-text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }, children: soul.slice(0, 900) + (soul.length > 900 ? '…' : '') })
    ]})
  ]})
}

function pstudioPersonaRoleLine(soul) {
  const lines = (soul || '').split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const stripped = line.replace(/^#+\s*/, '').replace(/^[*-]\s*/, '').trim()
    if (stripped && stripped.length <= 80 && /[A-Za-z]/.test(stripped)) return stripped
  }
  return 'agent'
}

function PstudioPersonaRaw({ name }) {
  const draft = $pstudioSoulDraft.get()
  const [text, setText] = useState(draft || '')
  useValue($pstudioSoulDraft)
  // keep local textarea in sync when draft changes externally (AI gen)
  useEffect(() => { if (draft && draft !== text) setText(draft) }, [draft])
  const commit = () => {
    if (!text) { host.notify({ kind: 'warning', message: 'Nothing to save.' }); return }
    pstudioSetSoul(name, text).then(() => { haptic('tap'); host.notify({ kind: 'success', message: 'Saved.' }); pstudioRefresh() }).catch(err => host.notifyError(err, 'Save SOUL'))
  }
  return jsxs('div', { children: [
    jsx(Textarea, { value: text, onChange: e => setText(e.target.value), className: 'pstudio-mono', style: { minHeight: 200, fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.6 }, children: undefined }),
    jsx('div', { style: { fontSize: 11, color: 'var(--ui-text-secondary)', marginTop: 6 }, children: 'Direct editor. Changes commit verbatim.' }),
    jsx(Button, { onClick: commit, style: { marginTop: 10 }, children: 'Save SOUL' })
  ]})
}

// helpers to avoid top-level naming collisions with theme-forge
function pstudioRoleOfPersona(soul) { return pstudioPersonaRoleLine(soul) }
function pstudioSoulHint(p) { return p.model || '' }

// ── Brain (model) simple + advanced ─────────────────────────────────────────

function PstudioBrainSimple({ name }) {
  const selected = { provider: 'custom:qwen-token-plan', model: 'qwen3.8-max-preview' }
  const pick = ent => {
    pstudioSetModel(name, { scope: 'main', provider: ent.provider, model: ent.model })
      .then(() => { haptic('tap'); host.notify({ kind: 'success', message: `Set ${name} to ${ent.label}. Applies to new sessions.` }); pstudioRefresh() })
      .catch(err => host.notifyError(err, 'Set model'))
  }
  return jsxs('div', { children: PSTUDIO_MODEL_MANIFEST.map(group => jsxs('div', { children: [
    jsx('div', { style: { fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary)', margin: '12px 0 7px', fontWeight: 640 }, children: group.group }),
    jsxs('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }, children: group.entries.map(ent => {
      const on = selected.model === ent.model && selected.provider === ent.provider
      return jsxs('div', {
        onClick: () => pick(ent),
        style: { border: on ? '1px solid var(--ui-accent)' : '1px solid var(--ui-stroke-secondary)', background: on ? 'var(--ui-accent-soft)' : 'var(--ui-surface-1)', borderRadius: 10, padding: '11px 12px', cursor: 'pointer', position: 'relative' },
        children: [
          jsx('div', { style: { fontWeight: 620, fontSize: 13 }, children: ent.label }),
          jsx('div', { style: { fontSize: 11, color: 'var(--ui-text-secondary)', marginTop: 2 }, children: ent.provider })
        ]
      })
    })})
  ]}, group.group)) })
}

function PstudioBrainAdvanced({ name }) {
  const [provider, setProvider] = useState('custom:qwen-token-plan')
  const [model, setModel] = useState('qwen3.8-max-preview')
  const [base, setBase] = useState('')
  const [key, setKey] = useState('')
  useValue($pstudioTesting)
  useValue($pstudioTestResult)

  const apply = () => {
    const body = { scope: 'main', provider, model }
    if (provider.startsWith('custom') || provider.startsWith('local')) {
      if (base) body.base_url = base
      if (key) body.api_key = key
    }
    pstudioSetModel(name, body)
      .then(() => { haptic('tap'); host.notify({ kind: 'success', message: `Set ${name} model. Applies to new sessions.` }); pstudioRefresh() })
      .catch(err => host.notifyError(err, 'Set model'))
  }
  const tr = $pstudioTestResult.get()
  return jsxs('div', { children: [
    jsxs('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }, children: [
      PstudioField({ label: 'Provider', children: jsxs(Select, { value: provider, onValueChange: setProvider, children: [
        jsx(SelectTrigger, { children: jsx(SelectValue, {}) }),
        jsxs(SelectContent, { children: [
          jsx(SelectItem, { value: 'custom:qwen-token-plan', children: 'custom:qwen-token-plan' }),
          jsx(SelectItem, { value: 'deepseek', children: 'deepseek' }),
          jsx(SelectItem, { value: 'minimax', children: 'minimax' }),
          jsx(SelectItem, { value: 'anthropic', children: 'anthropic' }),
          jsx(SelectItem, { value: 'openai', children: 'openai' })
        ]})
      ]}) }),
      PstudioField({ label: 'Model', children: jsx(Input, { value: model, onChange: e => setModel(e.target.value), className: 'pstudio-mono', style: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }) })
    ]}),
    PstudioField({ label: 'Base URL (custom/local)', children: jsx(Input, { value: base, onChange: e => setBase(e.target.value), placeholder: 'https://api.example.com/v1', className: 'pstudio-mono', style: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }) }),
    PstudioField({ label: 'API key (custom/local)', children: jsx(Input, { value: key, onChange: e => setKey(e.target.value), type: 'password', placeholder: 'sk-…', className: 'pstudio-mono', style: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }) }),
    jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [
      jsx(Button, { onClick: () => pstudioLiveTest(base), disabled: $pstudioTesting.get(), children: $pstudioTesting.get() ? 'Testing…' : 'Live-test' }),
      tr ? jsx('span', { style: { fontSize: 11, color: tr.ok ? 'var(--ui-success)' : 'var(--ui-destructive)' }, children: tr.msg }) : null,
      jsx(Button, { onClick: apply, variant: 'default', children: 'Apply' })
    ]}),
    jsx('div', { style: { fontSize: 10.5, color: 'var(--ui-text-tertiary)', marginTop: 8 }, children: 'Model changes apply to NEW sessions, not the one already running.' })
  ]})
}

// ── Advanced config CLI escape hatch ────────────────────────────────────────

function PstudioConfigCliBlock({ name }) {
  const cmds = pstudioCliCommands(name)
  return jsxs('div', { style: { position: 'relative', background: '#0d0d14', border: '1px solid var(--ui-stroke-secondary)', borderRadius: 9, padding: '12px 14px', overflow: 'hidden' }, children: [
    jsxs('pre', { className: 'pstudio-mono', style: { margin: 0, whiteSpace: 'pre', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, lineHeight: 1.7, color: 'var(--ui-text)', overflowX: 'auto' }, children: [
      jsx('span', { style: { color: 'var(--ui-text-tertiary)' }, children: '# Keys beyond the plugin’s reach — copy-paste:\n' }),
      cmds
    ]}),
    jsxs('div', { style: { position: 'absolute', top: 8, right: 8 }, children: [
      jsx(CopyButton, { value: cmds })
    ]})
  ]})
}

// ── Danger zone ────────────────────────────────────────────────────────────

function PstudioDangerZone({ name, isDefault }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmDup, setConfirmDup] = useState(false)
  return jsxs('div', { style: { border: '1px solid color-mix(in srgb, var(--ui-destructive) 30%, transparent)', borderRadius: 10, padding: 14 }, children: [
    jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }, children: [
      jsxs('div', { children: [ jsx('div', { style: { fontSize: 12.5 }, children: 'Duplicate' }), jsx('div', { style: { fontSize: 11, color: 'var(--ui-text-secondary)' }, children: 'Clone this persona as a starting point' }) ]}),
      jsx(Button, { variant: 'outline', onClick: () => setConfirmDup(true), children: 'Duplicate' })
    ]}),
    jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }, children: [
      jsxs('div', { children: [ jsx('div', { style: { fontSize: 12.5 }, children: 'Delete' }), jsx('div', { style: { fontSize: 11, color: 'var(--ui-text-secondary)' }, children: isDefault ? 'Cannot delete the default profile' : 'Permanent. Cannot be undone.' }) ]}),
      jsx(Button, { variant: 'destructive', disabled: isDefault, onClick: () => setConfirmDel(true), children: 'Delete' })
    ]}),
    jsx(Dialog, { open: confirmDup, onOpenChange: setConfirmDup, children: [
      jsxs(DialogContent, { children: [
        jsxs(DialogHeader, { children: [ jsx(DialogTitle, { children: 'Duplicate profile?' }), jsx(DialogDescription, { children: `Clones ${name} as a new persona you can customize.` }) ]}),
        jsxs(DialogFooter, { children: [
          jsx(Button, { variant: 'ghost', onClick: () => setConfirmDup(false), children: 'Cancel' }),
          jsx(Button, { onClick: () => { pstudioDuplicate(name); setConfirmDup(false) }, children: 'Duplicate' })
        ]})
      ]})
    ]}),
    jsx(Dialog, { open: confirmDel, onOpenChange: setConfirmDel, children: [
      jsxs(DialogContent, { children: [
        jsxs(DialogHeader, { children: [ jsx(DialogTitle, { children: 'Delete profile?' }), jsx(DialogDescription, { children: `This permanently deletes ${name}. This cannot be undone.` }) ]}),
        jsxs(DialogFooter, { children: [
          jsx(Button, { variant: 'ghost', onClick: () => setConfirmDel(false), children: 'Cancel' }),
          jsx(Button, { variant: 'destructive', onClick: () => { pstudioDeleteFlow(name); setConfirmDel(false) }, children: 'Delete' })
        ]})
      ]})
    ]})
  ]})
}

// ── flows ──────────────────────────────────────────────────────────────────

function pstudioNewFlow() {
  // lightweight prompt → name + optional persona → create + open
  const name = window.prompt('New profile name (lowercase, letters/numbers/_-):', 'new-agent')
  if (!name || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) { host.notify({ kind: 'warning', message: 'Names must be lowercase letters, numbers, - and _, max 63.' }); return }
  pstudioCreateProfile(name, { no_skills: false })
    .then(() => { haptic('tap'); host.notify({ kind: 'success', message: `Created ${name}.` }); pstudioRefresh().then(() => $pstudioActive.set(name)) })
    .catch(err => host.notifyError(err, 'Create profile'))
}

function pstudioDuplicate(name) {
  const copy = `${name}-copy`
  pstudioCreateProfile(copy, { clone_from: name, clone_all: false })
    .then(() => { haptic('tap'); host.notify({ kind: 'success', message: `Duplicated as ${copy}.` }); pstudioRefresh() })
    .catch(err => host.notifyError(err, 'Duplicate profile'))
}

function pstudioDeleteFlow(name) {
  pstudioDeleteProfile(name)
    .then(() => { haptic('tap'); host.notify({ kind: 'success', message: `Deleted ${name}.` }); if ($pstudioActive.get() === name) $pstudioActive.set(null); pstudioRefresh() })
    .catch(err => host.notifyError(err, 'Delete profile'))
}

// ── storage + misc ─────────────────────────────────────────────────────────

let pstudioStorageRef = null
function pstudioNormalizeView(v) { return v === 'list' ? 'list' : 'grid' }
function pstudioViewKeyStored() { return pstudioStorageRef ? pstudioStorageRef.get($pstudioViewKey, 'grid') : 'grid' }
function pstudioViewKeyStore(v) { if (pstudioStorageRef) pstudioStorageRef.set($pstudioViewKey, v) }

// ── register ───────────────────────────────────────────────────────────────

export default {
  id: 'profile-studio',
  name: 'Profile Studio',

  register(ctx) {
    pstudioStorageRef = ctx.storage
    $pstudioView.set(pstudioNormalizeView(ctx.storage.get($pstudioViewKey, 'grid')))
    console.log('[profile-studio] register() fired — pane + palette contributing')

    pstudioRefresh()

    // Auto-focus our pane so the user sees it immediately
    host.request('pane.focus', { id: 'profile-studio:pane' }).catch(() => {})

    // The pane — docked on the right, stays open.
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'profile studio',
      data: {
        placement: 'main',
        uncloseable: false
      },
      render: () => jsx(PstudioPane, {})
    })

    // Palette command.
    ctx.register({
      id: 'palette-open',
      area: PALETTE_AREA,
      data: {
        id: 'profile-studio-open',
        label: 'Profile Studio: cast your agents',
        keywords: ['profile', 'agent', 'persona', 'soul', 'model'],
        run: () => host.notify({ kind: 'info', message: 'Profile Studio is docked on the right. Click a persona card to edit it.' })
      }
    })

    // Sidebar nav — so it shows up in the left nav alongside other plugins.
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: {
        id: 'profile-studio-nav',
        label: 'Studio',
        icon: 'aperture',
        run: () => {
          host.request('pane.focus', { id: 'profile-studio:pane' }).catch(() => {})
        }
      }
    })
  }
}

// ── filter helper (pure, exported for harness) ──────────────────────────────

function pstudioFilterProfiles(list, q) {
  if (!q || !q.trim()) return list
  const needle = q.trim().toLowerCase()
  return list.filter(p => (p.display_name || p.name || '').toLowerCase().includes(needle) || (p.model || '').toLowerCase().includes(needle))
}

// expose pure fns for Node slice-harness testing
window.__pstudioTest = { pstudioFilterProfiles, pstudioBuildSoul, pstudioParseSignals, pstudioCliCommands, pstudioSoulHint }
