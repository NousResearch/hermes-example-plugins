/**
 * Session Pulse — Hermes Desktop Plugin
 *
 * Ambient session awareness pane + statusbar chip.
 * Shows: agent state (idle/processing/streaming), model, profile,
 * active skills, recent tool calls, and session metrics.
 *
 * Surface: Desktop (desktop-plugins/)
 * Save as: ~/.hermes/desktop-plugins/pulse/plugin.js
 * Verify: ⌘K → "Reload desktop plugins"
 * ──
 * Plain ESM, loaded uncompiled — no JSX, only @hermes/plugin-sdk + react.
 */

import { cn, haptic, host, Tip, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs, jsxDEV } from 'react/jsx-runtime'
import { useState, useEffect, useCallback } from 'react'

const ID = 'pulse'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Compact elapsed time since a timestamp. */
function timeAgo(ms) {
  const sec = Math.floor((Date.now() - ms) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  return `${Math.floor(hr / 24)}d`
}

/** Truncate a tool argument for display. */
function truncateArg(val, maxLen = 60) {
  if (typeof val === 'string') {
    return val.length > maxLen ? val.slice(0, maxLen) + '…' : val
  }
  const s = JSON.stringify(val)
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
}

/** Color for agent state indicator. */
function stateColor(busy, awaiting) {
  if (!busy && !awaiting) return 'var(--ui-text-tertiary)'   // idle — grey
  if (awaiting) return 'var(--ui-accent)'                     // thinking — accent
  return 'var(--success, #2ea043)'                             // streaming — green
}

/** Label for agent state. */
function stateLabel(busy, awaiting) {
  if (!busy && !awaiting) return 'Idle'
  if (awaiting) return 'Thinking…'
  return 'Generating'
}

// ─── Pane Component ─────────────────────────────────────────────────────────

function PulsePane() {
  const t = usePluginI18n(ID)

  // Live atoms from host.state
  const model        = useValue(host.state.model)
  const profile      = useValue(host.state.profile)
  const busy         = useValue(host.state.busy)
  const awaiting     = useValue(host.state.awaitingResponse)
  const focusedProf  = useValue(host.state.focusedSessionProfile)
  const usage        = useValue(host.state.focusedUsage)
  const sessionId    = useValue(host.state.focusedStoredSessionId)

  // Local state for tool log and skills
  const [toolLog, setToolLog] = useState([])
  const [skills, setSkills]   = useState([])
  const [sessionStart]        = useState(Date.now)

  // Subscribe to gateway events for tool call tracking
  useEffect(() => {
    const unsub = host.onEvent('*', (event) => {
      if (event?.type === 'agent:step' && event?.data?.tool_calls) {
        for (const tc of event.data.tool_calls) {
          setToolLog(prev => {
            const entry = {
              name: tc.name || tc.tool || 'unknown',
              args: tc.arguments ? truncateArg(tc.arguments) : '',
              status: tc.error ? 'err' : 'ok',
              time: Date.now()
            }
            return [entry, ...prev].slice(0, 20)
          })
        }
      }
    })
    return () => unsub()
  }, [])

  // Fetch skills on mount via gateway RPC
  useEffect(() => {
    host.request('skills.list', {}).then(resp => {
      if (resp?.skills) {
        const names = resp.skills
          .filter(s => s.enabled !== false)
          .map(s => s.name || s.id)
        setSkills(names.slice(0, 30))
      }
    }).catch(() => {
      // Gateway may not support this; show limited state.
      setSkills(['(gateway unavailable)'])
    })
  }, [])

  return jsx('div', {
    className: 'flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm',
    children: [
      // ── Header ──
      jsx('div', {
        className: 'flex items-center gap-2 pb-1',
        children: [
          jsx('div', {
            className: 'h-2 w-2 shrink-0 rounded-full',
            style: { backgroundColor: stateColor(busy, awaiting) }
          }),
          jsx('div', {
            className: 'font-semibold text-[0.6875rem] uppercase tracking-wider text-(--ui-text-tertiary)',
            children: t('header', stateLabel(busy, awaiting))
          }),
          jsx('div', {
            className: 'ml-auto text-[0.625rem] text-(--ui-text-quaternary)',
            children: timeAgo(sessionStart)
          })
        ]
      }),

      // ── Session Card ──
      jsx('div', {
        className: 'rounded-md border border-(--ui-stroke-secondary) bg-(--ui-editor-background) p-2',
        children: [
          jsx('div', { className: 'grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.6875rem]', children: [
            jsx('span', { className: 'text-(--ui-text-quaternary)', children: t('modelLabel') }),
            jsx('span', { className: 'truncate font-mono', children: model || '—' }),
            jsx('span', { className: 'text-(--ui-text-quaternary)', children: t('profileLabel') }),
            jsx('span', { className: 'truncate font-mono', children: focusedProf || profile || '—' }),
            jsx('span', { className: 'text-(--ui-text-quaternary)', children: t('sessionLabel') }),
            jsx('span', {
              className: 'truncate font-mono text-(--ui-text-tertiary)',
              children: sessionId ? sessionId.slice(0, 12) + '…' : '—'
            })
          ]})
        ]
      }),

      // ── Usage / Tokens (if available) ──
      usage && usage.context_percent != null ? jsx('div', {
        className: 'rounded-md border border-(--ui-stroke-secondary) bg-(--ui-editor-background) p-2',
        children: [
          jsx('div', { className: 'mb-1 text-[0.625rem] font-medium text-(--ui-text-tertiary) uppercase tracking-wider', children: t('usageSection') }),
          jsx('div', { className: 'mb-1 h-1.5 w-full overflow-hidden rounded-full bg-(--ui-stroke-secondary)', children:
            jsx('div', {
              className: 'h-full rounded-full transition-all',
              style: {
                width: `${Math.min(usage.context_percent, 100)}%`,
                backgroundColor: usage.context_percent > 85
                  ? 'var(--error, #da3633)'
                  : usage.context_percent > 70
                    ? 'var(--warning, #d29922)'
                    : 'var(--ui-accent)'
              }
            })
          }),
          jsxs('div', {
            className: 'grid grid-cols-2 gap-1 text-[0.625rem] text-(--ui-text-tertiary)',
            children: [
              jsxs('span', { children: [t('tokensUsed'), ' ', jsx('span', { className: 'font-mono text-(--ui-text-secondary)', children: String(usage.context_used || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') })] }),
              jsxs('span', { className: 'text-right', children: [String(usage.context_percent), '%'] })
            ]
          }),
          usage.cost_usd != null ? jsx('div', {
            className: 'mt-1 text-[0.625rem] text-(--ui-text-quaternary)',
            children: `${t('costLabel')} $${usage.cost_usd.toFixed(5)}`
          }) : null
        ]
      }) : null,

      // ── Skills ──
      skills.length > 0 ? jsx('div', {
        className: 'rounded-md border border-(--ui-stroke-secondary) bg-(--ui-editor-background) p-2',
        children: [
          jsxs('div', {
            className: 'mb-1 flex items-center gap-1.5',
            children: [
              jsx('span', { className: 'text-[0.625rem] font-medium text-(--ui-text-tertiary) uppercase tracking-wider', children: t('skillsSection') }),
              jsx('span', {
                className: 'rounded-sm bg-(--ui-stroke-secondary) px-1 py-0.5 text-[0.5625rem] text-(--ui-text-tertiary)',
                children: String(skills.length)
              })
            ]
          }),
          jsx('div', {
            className: 'flex flex-wrap gap-1',
            children: skills.map(skill =>
              jsx('span', {
                className: 'rounded-sm bg-(--ui-stroke-secondary) px-1.5 py-0.5 text-[0.625rem] font-mono text-(--ui-text-secondary)',
                children: skill
              }, skill)
            )
          })
        ]
      }) : null,

      // ── Tool Activity ──
      toolLog.length > 0 ? jsx('div', {
        className: 'rounded-md border border-(--ui-stroke-secondary) bg-(--ui-editor-background) p-2',
        children: [
          jsxs('div', {
            className: 'mb-1 flex items-center gap-1.5',
            children: [
              jsx('span', { className: 'text-[0.625rem] font-medium text-(--ui-text-tertiary) uppercase tracking-wider', children: t('toolsSection') }),
              jsx('span', {
                className: 'rounded-sm bg-(--ui-stroke-secondary) px-1 py-0.5 text-[0.5625rem] text-(--ui-text-tertiary)',
                children: String(toolLog.length)
              })
            ]
          }),
          jsx('div', {
            className: 'flex flex-col gap-0.5',
            children: toolLog.slice(0, 10).map((entry, i) =>
              jsx('div', {
                className: 'flex items-start gap-1.5 text-[0.625rem] leading-[1.3]',
                children: [
                  jsx('span', {
                    className: entry.status === 'err'
                      ? 'mt-0.5 shrink-0 text-(--error, #da3633)'
                      : 'mt-0.5 shrink-0 text-(--success, #2ea043)',
                    children: entry.status === 'err' ? '✕' : '✓'
                  }),
                  jsxs('span', {
                    className: 'min-w-0 flex-1',
                    children: [
                      jsx('span', { className: 'font-medium font-mono text-(--ui-text-secondary)', children: entry.name }),
                      entry.args ? jsx('span', { className: 'ml-1 text-(--ui-text-quaternary)', children: entry.args }) : null
                    ]
                  }),
                  jsx('span', { className: 'shrink-0 text-(--ui-text-quaternary)', children: timeAgo(entry.time) })
                ]
              }, `${entry.name}-${i}`)
            )
          })
        ]
      }) : null,

      // ── Empty state ──
      !toolLog.length && skills.length === 0 ? jsx('div', {
        className: 'flex flex-1 items-center justify-center text-[0.6875rem] text-(--ui-text-quaternary)',
        children: 'Awaiting session activity…'
      }) : null
    ]
  })
}

// ─── Statusbar Chip ────────────────────────────────────────────────────────

function PulseChip() {
  const t = usePluginI18n(ID)
  const busy     = useValue(host.state.busy)
  const awaiting = useValue(host.state.awaitingResponse)
  const model    = useValue(host.state.model)

  const stateLabel_str = stateLabel(busy, awaiting)
  const modelShort = model ? model.split('/').pop().split(':')[0].replace(/-?\d+.*/, '').slice(0, 12) : '—'

  return jsx(Tip, {
    label: `Pulse: ${stateLabel_str}`,
    children: jsx('button', {
      className: cn(
        'inline-flex h-full items-center gap-1.5 px-1.5 text-[0.6875rem] transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      ),
      type: 'button',
      onClick: () => {
        haptic('tap')
        host.navigate('/pulse')
      },
      children: [
        jsx('div', {
          className: 'h-1.5 w-1.5 shrink-0 rounded-full',
          style: { backgroundColor: stateColor(busy, awaiting) }
        }),
        modelShort
      ]
    })
  })
}

// ─── Plugin Registration ────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Session Pulse',
  defaultEnabled: true,

  register(ctx) {
    // Locale bundles
    ctx.i18n.register({
      en: {
        header: state => `${state}`,
        modelLabel: 'Model',
        profileLabel: 'Profile',
        sessionLabel: 'Session',
        usageSection: 'Context Usage',
        tokensUsed: 'Used',
        costLabel: 'Cost',
        skillsSection: 'Skills',
        toolsSection: 'Tools'
      }
    })

    // Right-side pane showing session intelligence
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Pulse',
      data: { placement: 'right', width: '280px' },
      render: () => jsx(PulsePane, {})
    })

    // Statusbar chip showing agent state
    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 110,
      render: () => jsx(PulseChip, {})
    })
  }
}
