/**
 * The CONTEXT ROLLOVER block: what the context-rollover mod published, as the rows the
 * pane draws. Pure.
 *
 * The cockpit only observes. The rollover mod is the single source of truth and writes
 * `$.state` `context-rollover.status`; this module validates what it reads (the
 * contract's schema version, the fields drawn) and turns a missing, malformed or
 * stopped writer into UNAVAILABLE or STALE rather than drawing a guess. Nothing here
 * — or anywhere in the cockpit — triggers a rollover.
 */

import type { RolloverStatus } from '../../types/rollover'
import { bar, kilo, shortText } from './format'
import { TOKYO } from './palette'

/** The contract version this block draws. */
export const ROLLOVER_SCHEMA = 1

/** The writer's heartbeat period; three missed beats mean it stopped. */
export const ROLLOVER_HEARTBEAT_MS = 15000

export type RolloverRow = { label: string; value: string; color: string; bar?: { percent: number; color: string } }

export type RolloverView =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'live' | 'stale'; status: RolloverStatus; rows: RolloverRow[] }

const PHASES = new Set([
  'disabled',
  'monitoring',
  'preparing',
  'ready',
  'draining',
  'persisting',
  'restarting',
  'resuming',
  'completed',
  'awaiting-restart',
  'failed',
])

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Why a value read from `$.state` cannot be drawn, or null when it can. */
export const rolloverProblem = (value: unknown): string | null => {
  if (value === undefined || value === null) return 'rollover mod not loaded'
  if (!isObj(value)) return 'malformed state'
  if (value.schemaVersion !== ROLLOVER_SCHEMA) return `unsupported schema ${String(value.schemaVersion)}`
  if (typeof value.phase !== 'string' || !PHASES.has(value.phase)) return 'malformed state'
  const c = value.context
  const t = value.thresholds
  if (!isObj(c) || !(c.tokens === null || isNum(c.tokens))) return 'malformed state'
  if (!isObj(t) || !isNum(t.soft) || !isNum(t.prepare) || !isNum(t.hard) || t.hard <= 0) return 'malformed state'
  if (!isObj(value.continuation) || typeof value.continuation.status !== 'string') return 'malformed state'
  if (!isNum(value.heartbeatAt) || typeof value.operation !== 'string') return 'malformed state'

  return null
}

const STATUS: Record<string, { word: string; color: string }> = {
  disabled: { word: 'DISABLED', color: TOKYO.dim },
  monitoring: { word: 'MONITORING', color: TOKYO.green },
  preparing: { word: 'PREPARING', color: TOKYO.yellow },
  ready: { word: 'READY', color: TOKYO.orange },
  draining: { word: 'DRAINING', color: TOKYO.orange },
  persisting: { word: 'PERSISTING', color: TOKYO.orange },
  restarting: { word: 'RESTARTING', color: TOKYO.accent },
  resuming: { word: 'RESUMING', color: TOKYO.cyan },
  completed: { word: 'COMPLETED', color: TOKYO.green },
  'awaiting-restart': { word: 'AWAITING /clear', color: TOKYO.yellow },
  failed: { word: 'FAILED', color: TOKYO.red },
}

const HANDOFF: Record<string, string> = {
  none: 'Not started',
  'in-progress': 'In progress',
  draft: 'Draft saved',
  persisted: 'Persisted',
  pending: 'Pending',
  restored: 'Restored',
  failed: 'Failed',
}

/** `12s`, `4m`, `2h`, `3d` ago. */
export const agoShort = (at: number, now: number): string => {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`

  return `${Math.floor(s / 86400)}d ago`
}

/** Progress toward the hard limit, clamped to 0–100; null without a reading. */
export const rolloverProgress = (tokens: number | null, hard: number): number | null =>
  tokens === null || hard <= 0 ? null : Math.max(0, Math.min(100, (tokens / hard) * 100))

/** The colour of a share of the hard limit, by the thresholds rather than fixed cut-offs. */
const tokenColor = (tokens: number, t: RolloverStatus['thresholds']): string =>
  tokens >= t.hard ? TOKYO.red : tokens >= t.prepare ? TOKYO.orange : tokens >= t.soft ? TOKYO.yellow : TOKYO.green

/** The next threshold above the reading and how far off it is; null past the hard limit. */
export const nextOf = (tokens: number, t: RolloverStatus['thresholds']): { at: number; remaining: number } | null => {
  for (const at of [t.soft, t.prepare, t.hard]) if (tokens < at) return { at, remaining: at - tokens }

  return null
}

const agentsText = (a: RolloverStatus['agents']): string => {
  if (a === null) return 'UNAVAILABLE'
  if (a.total === 0) return 'none'
  const parts = [`${a.active} active`, `${a.idle} idle`]
  if (a.pending > 0) parts.push(`${a.pending} pending`)
  if (a.completed > 0) parts.push(`${a.completed} done`)
  if (a.failed > 0) parts.push(`${a.failed} failed`)

  return parts.join(' · ')
}

const tasksText = (t: NonNullable<RolloverStatus['tasks']>): string =>
  `${t.inProgress} doing · ${t.pending} todo · ${t.completed} done`

/**
 * The block's rows. `columns` is the width the rows draw into: labels shorten below 36.
 * Every figure is the writer's; one it does not have reads UNKNOWN or UNAVAILABLE.
 */
export const rolloverView = (value: unknown, now: number, columns: number): RolloverView => {
  const problem = rolloverProblem(value)
  if (problem !== null) return { kind: 'unavailable', reason: problem }
  const s = value as RolloverStatus
  const isStale = now - s.heartbeatAt > ROLLOVER_HEARTBEAT_MS * 3
  const wide = columns >= 36
  const t = s.thresholds
  const tokens = s.context.tokens
  const dim = (color: string): string => (isStale ? TOKYO.dim : color)
  const status = STATUS[s.phase] ?? { word: s.phase.toUpperCase(), color: TOKYO.text }
  const rows: RolloverRow[] = []
  const valueRoom = Math.max(8, columns - (wide ? 13 : 9))

  rows.push(isStale ? { label: 'Status', value: `STALE · ${agoShort(s.heartbeatAt, now)}`, color: TOKYO.red } : { label: 'Status', value: status.word, color: status.color })
  rows.push({
    label: 'Context',
    value: `${tokens === null ? 'UNKNOWN' : kilo(tokens)} / ${kilo(t.hard)}`,
    color: dim(tokens === null ? TOKYO.dim : tokenColor(tokens, t)),
  })
  const percent = rolloverProgress(tokens, t.hard)
  rows.push(
    percent === null
      ? { label: 'Progress', value: 'UNKNOWN', color: TOKYO.dim }
      : { label: 'Progress', value: `${Math.round(percent)}%`, color: dim(TOKYO.text), bar: { percent, color: dim(tokenColor(tokens ?? 0, t)) } },
  )
  if (tokens !== null && s.phase !== 'disabled') {
    const next = nextOf(tokens, t)
    rows.push(
      next === null
        ? { label: 'Next', value: 'hard limit reached', color: dim(TOKYO.red) }
        : { label: 'Next', value: `${kilo(next.at)} · ${kilo(next.remaining)} remaining`, color: dim(TOKYO.dim) },
    )
  }
  const handoff = HANDOFF[s.continuation.status] ?? s.continuation.status
  const handoffId = s.continuation.status === 'pending' && s.continuation.rolloverId !== null ? ` · ${s.continuation.rolloverId}` : ''
  rows.push({
    label: 'Handoff',
    value: shortText(`${handoff}${handoffId}`, valueRoom),
    color: dim(s.continuation.status === 'failed' ? TOKYO.red : s.continuation.status === 'pending' ? TOKYO.yellow : s.continuation.status === 'none' ? TOKYO.dim : TOKYO.text),
  })
  rows.push({ label: 'Agents', value: shortText(agentsText(s.agents), valueRoom), color: dim(s.agents === null ? TOKYO.dim : TOKYO.text) })
  if (s.tasks !== null && s.tasks.total > 0) rows.push({ label: 'Tasks', value: shortText(tasksText(s.tasks), valueRoom), color: dim(TOKYO.text) })
  rows.push(
    s.last === null
      ? { label: 'Last', value: 'Never', color: TOKYO.dim }
      : {
          label: 'Last',
          value: shortText(`${s.last.outcome === 'success' ? 'Success' : s.last.outcome === 'failed' ? 'Failed' : 'Interrupted'} · ${agoShort(s.last.at, now)}`, valueRoom),
          color: dim(s.last.outcome === 'success' ? TOKYO.green : s.last.outcome === 'failed' ? TOKYO.red : TOKYO.yellow),
        },
  )
  // What is happening and what went wrong are never cut to the column: they wrap.
  rows.push({ label: wide ? 'Next action' : 'Action', value: shortText(isStale ? 'Rollover mod not responding' : s.operation, 200), color: isStale ? TOKYO.red : TOKYO.text })
  if (s.error !== null && s.error !== undefined && typeof s.error.message === 'string') {
    rows.push({ label: 'Error', value: shortText(s.error.message, 200), color: TOKYO.red })
  }

  return { kind: isStale ? 'stale' : 'live', status: s, rows }
}

/** A row's label, padded to the column the values start at. */
export const labelOf = (label: string, columns: number): string => label.padEnd(columns >= 36 ? 13 : 9)

/** The progress bar: ten cells of the cockpit's own glyphs. */
export const rolloverBar = (percent: number): string => bar(percent, 10)
