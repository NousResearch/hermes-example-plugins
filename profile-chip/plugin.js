// profile-chip — always-visible profile readout in the status bar.
//
// The problem it solves: a brand-new draft (Ctrl+N) shows no profile anywhere
// in the chat pane — core's title-bar profile tag only mounts once the first
// message creates the stored session. This chip reads the FOCUSED chat owner,
// which falls back to the active gateway owner while no session exists, so the
// draft's (connection, profile) is named before the first send.
//
// Surface: one statusBar.left contribution. Identity mark replicates core's
// ProfileGlyph vocabulary: default = home codicon (uncolored by design), named
// profiles = soft-tinted initial tile in the deterministic identity hue.
// Defensive against older shells: missing atoms/APIs degrade to the plain
// active-profile readout instead of throwing.
import * as SDK from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'

const host = SDK.host

// Subscribe to a nanostore atom that may not exist on older builds.
function useAtomSafe(atom, fallback) {
  const [value, setValue] = useState(() =>
    atom && typeof atom.get === 'function' ? atom.get() : fallback
  )
  useEffect(() => {
    if (!atom || typeof atom.subscribe !== 'function') return undefined
    setValue(atom.get())
    return atom.subscribe(setValue)
  }, [atom])
  return value
}

// Core's deterministic identity color (lib/profile-color.ts): default/empty is
// intentionally uncolored; named profiles get hash*31 % 360 at S68% L58%.
// Inlined so older builds without the SDK export still match the palette.
function identityColor(name) {
  const key = String(name || '').trim()
  if (!key || key === 'default') return null
  try {
    if (typeof SDK.profileColor === 'function') {
      const c = SDK.profileColor(key)
      if (c) return c
    }
  } catch {
    // fall through to the inlined algorithm
  }
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return `hsl(${hash % 360} 68% 58%)`
}

// First letter/number/emoji grapheme — same rule as core profileShortLabel.
function shortLabel(name) {
  const label = String(name || '').trim()
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const { segment } of seg.segment(label)) {
      if (/[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(segment)) return segment
    }
  } catch {
    // older engine — fall back to first code point
  }
  return label ? Array.from(label)[0] : '?'
}

// Module-level cache: connection id -> display label (tooltip only).
const labelCache = new Map()

async function refreshLabels() {
  if (!host || typeof host.connections !== 'function') return
  try {
    const rows = await host.connections()
    for (const row of rows) {
      if (row && row.id) labelCache.set(String(row.id), String(row.label || row.id))
    }
  } catch {
    // Registry unavailable — fall back to raw ids.
  }
}

function connectionLabel(connectionId) {
  const id = String(connectionId || '').trim()
  if (!id || id === 'local') return labelCache.get('local') || 'This device'
  return labelCache.get(id) || id
}

function ProfileChip() {
  // Follows the chat the user is LOOKING AT; on a brand-new draft it resolves
  // to the active gateway's (connectionId, profile) — the case core hides.
  const owner = useAtomSafe(host && host.state.focusedSessionOwner, null)
  const activeProfile = useAtomSafe(host && host.state.profile, 'default')
  const activeConnectionId = useAtomSafe(host && host.state.connectionId, null)
  const [, bump] = useState(0)

  const connectionId = (owner && owner.connectionId) || activeConnectionId || ''
  const profile = (owner && owner.profile) || activeProfile || 'default'

  useEffect(() => {
    let alive = true
    refreshLabels().then(() => {
      if (alive) bump(n => n + 1)
    })
    return () => {
      alive = false
    }
  }, [connectionId])

  const gateway = connectionLabel(connectionId)
  const color = identityColor(profile)
  const isDefault = !String(profile || '').trim() || String(profile).trim() === 'default'

  // Core ProfileGlyph replica (components/ui/profile-glyph.tsx): default =
  // home codicon in quaternary text; named profiles = 16px rounded tile with
  // a 22% soft tint of the identity color and the profile initial. The
  // codicon font is loaded app-wide, so the same classes render identically.
  const glyph = isDefault
    ? jsx('span', {
        className: 'grid size-4 shrink-0 place-items-center',
        children: jsx('i', {
          'aria-hidden': true,
          className: 'codicon codicon-home text-(--ui-text-quaternary)',
          style: { fontSize: '0.75rem' }
        })
      })
    : jsx('span', {
        className:
          'grid size-4 shrink-0 place-items-center rounded-[3px] text-[0.5rem] font-semibold uppercase leading-none',
        style: {
          backgroundColor: `color-mix(in srgb, ${color || 'var(--ui-text-quaternary)'} 22%, transparent)`,
          color: color || undefined
        },
        children: shortLabel(profile)
      })

  // Same chrome as core interactive statusbar items (STATUSBAR_ACTION_CLASS):
  // 11px, tertiary text, normal weight, standard hover. One uniform text run.
  return jsx('button', {
    type: 'button',
    title: `Profile: ${profile} · Gateway: ${gateway} (click to refresh)`,
    'aria-label': `Profile: ${profile}`,
    className:
      'inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
    onClick: () => {
      void refreshLabels().then(() => bump(n => n + 1))
    },
    children: jsxs('span', {
      className: 'inline-flex items-center gap-1 whitespace-nowrap',
      children: [glyph, jsx('span', { children: profile })]
    })
  })
}

export default {
  id: 'profile-chip',
  name: 'Profile Chip',
  register(ctx) {
    ctx.register({
      id: 'chip',
      area: 'statusBar.left',
      order: 5,
      render: () => jsx(ProfileChip, {})
    })
  }
}
