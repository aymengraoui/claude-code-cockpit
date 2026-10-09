import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { RolloverStatus } from '../types/rollover'
import { agoShort, labelOf, nextOf, rolloverBar, rolloverProblem, rolloverProgress, rolloverView } from './lib/rollover'
import type { RolloverRow } from './lib/rollover'

const NOW = 1_760_000_000_000

const status = (overrides: Partial<RolloverStatus> = {}): RolloverStatus => ({
  schemaVersion: 1,
  sessionId: 'sessA000',
  generation: 0,
  phase: 'monitoring',
  enabled: true,
  context: { tokens: 142000, window: 1000000, measuredAt: NOW - 1000, source: 'turn.step' },
  thresholds: { soft: 180000, prepare: 190000, hard: 200000 },
  continuation: { status: 'none', path: null, rolloverId: null, bytes: null, approxTokens: null, updatedAt: null },
  agents: { active: 3, idle: 2, pending: 0, completed: 0, failed: 0, total: 5 },
  tasks: null,
  last: null,
  operation: 'Monitoring context usage',
  error: null,
  restart: { mode: 'clear', isAutomatic: true },
  heartbeatAt: NOW - 2000,
  updatedAt: NOW - 2000,
  ...overrides,
})

const rowsOf = (value: unknown, columns = 40): Record<string, RolloverRow> => {
  const view = rolloverView(value, NOW, columns)
  if (view.kind === 'unavailable') throw new Error(view.reason)

  return Object.fromEntries(view.rows.map(row => [row.label, row]))
}

test('rollover: monitoring reads as the sidebar example', () => {
  const rows = rowsOf(status())
  expect(rows.Status?.value).toBe('MONITORING')
  expect(rows.Context?.value).toBe('142k / 200k')
  expect(rows.Progress?.value).toBe('71%')
  expect(rows.Next?.value).toBe('180k · 38k remaining')
  expect(rows.Handoff?.value).toBe('Not started')
  expect(rows.Agents?.value).toBe('3 active · 2 idle')
  expect(rows.Last?.value).toBe('Never')
  expect(rows['Next action']?.value).toBe('Monitoring context usage')
})

test('rollover: progress is tokens over the configured hard limit, clamped', () => {
  expect(rolloverProgress(142000, 200000)).toBe(71)
  expect(rolloverProgress(300000, 200000)).toBe(100)
  expect(rolloverProgress(null, 200000)).toBeNull()
  expect(rowsOf(status({ thresholds: { soft: 50000, prepare: 60000, hard: 100000 } })).Progress?.value).toBe('100%')
  expect(rolloverBar(71)).toBe('▰▰▰▰▰▰▰▱▱▱')
})

test('rollover: the next threshold follows the reading and the configuration', () => {
  const t = { soft: 180000, prepare: 190000, hard: 200000 }
  expect(nextOf(184000, t)).toEqual({ at: 190000, remaining: 6000 })
  expect(nextOf(201000, t)).toBeNull()
  expect(rowsOf(status({ phase: 'preparing', context: { tokens: 184000, window: null, measuredAt: NOW, source: 'turn.step' } })).Next?.value).toBe('190k · 6k remaining')
  expect(rowsOf(status({ phase: 'draining', context: { tokens: 204000, window: null, measuredAt: NOW, source: 'turn.step' } })).Next?.value).toBe('hard limit reached')
})

test('rollover: preparing, restarting, resuming, completed and failed each say so', () => {
  const preparing = rowsOf(status({ phase: 'preparing', continuation: { ...status().continuation, status: 'in-progress' }, operation: 'Persisting continuation state' }))
  expect(preparing.Status?.value).toBe('PREPARING')
  expect(preparing.Handoff?.value).toBe('In progress')
  expect(preparing['Next action']?.value).toBe('Persisting continuation state')

  expect(rowsOf(status({ phase: 'restarting', operation: 'Starting a fresh session' })).Status?.value).toBe('RESTARTING')

  const resuming = rowsOf(
    status({
      phase: 'resuming',
      context: { tokens: 12000, window: null, measuredAt: NOW, source: 'turn.step' },
      continuation: { ...status().continuation, status: 'restored', rolloverId: 'g1-x' },
      last: { outcome: 'success', rolloverId: 'g1-x', at: NOW - 180000, fromSessionId: 'sessA', toSessionId: 'sessB', finalTokens: 193000, detail: null },
      operation: 'Resuming unfinished tasks',
    }),
  )
  expect(resuming.Status?.value).toBe('RESUMING')
  expect(resuming.Context?.value).toBe('12k / 200k')
  expect(resuming.Progress?.value).toBe('6%')
  expect(resuming.Handoff?.value).toBe('Restored')
  expect(resuming.Last?.value).toBe('Success · 3m ago')

  expect(rowsOf(status({ phase: 'completed' })).Status?.value).toBe('COMPLETED')

  const failed = rowsOf(status({ phase: 'failed', error: { message: 'command clear refused', at: NOW, isRetriable: true }, last: { outcome: 'failed', rolloverId: 'g1', at: NOW - 5000, fromSessionId: 'a', toSessionId: null, finalTokens: null, detail: null } }))
  expect(failed.Status?.value).toBe('FAILED')
  expect(failed.Error?.value).toBe('command clear refused')
  expect(failed.Last?.value).toBe('Failed · 5s ago')
})

test('rollover: nothing is invented — unknown context and unavailable agents say so', () => {
  const rows = rowsOf(status({ context: { tokens: null, window: null, measuredAt: null, source: null }, agents: null }))
  expect(rows.Context?.value).toBe('UNKNOWN / 200k')
  expect(rows.Progress?.value).toBe('UNKNOWN')
  expect(rows.Next).toBeUndefined()
  expect(rows.Agents?.value).toBe('UNAVAILABLE')
})

test('rollover: missing, malformed and newer-schema state is UNAVAILABLE, with why', () => {
  expect(rolloverProblem(undefined)).toBe('rollover mod not loaded')
  expect(rolloverProblem(42)).toBe('malformed state')
  expect(rolloverProblem({ ...status(), schemaVersion: 2 })).toBe('unsupported schema 2')
  expect(rolloverProblem({ ...status(), phase: 'warp' })).toBe('malformed state')
  expect(rolloverProblem({ ...status(), thresholds: { soft: 1, prepare: 2, hard: 0 } })).toBe('malformed state')
  expect(rolloverView(undefined, NOW, 40)).toEqual({ kind: 'unavailable', reason: 'rollover mod not loaded' })
})

test('rollover: a writer that stopped beating is STALE, its figures dimmed', () => {
  const view = rolloverView(status({ heartbeatAt: NOW - 120000 }), NOW, 40)
  expect(view.kind).toBe('stale')
  const rows = rowsOf(status({ heartbeatAt: NOW - 120000 }))
  expect(rows.Status?.value).toBe('STALE · 2m ago')
  expect(rows['Next action']?.value).toBe('Rollover mod not responding')
  expect(rolloverView(status({ heartbeatAt: NOW - 44000 }), NOW, 40).kind).toBe('live')
})

test('rollover: a narrow pane shortens the labels, never the figures', () => {
  expect(labelOf('Next action', 40)).toBe('Next action  ')
  expect(labelOf('Status', 30)).toBe('Status   ')
  expect(rowsOf(status(), 30).Action?.value).toBe('Monitoring context usage')
  expect(agoShort(NOW - 7200000, NOW)).toBe('2h ago')
})

// ─── drawn in the pane ──────────────────────────────────────────────────────

const PANE_PROPS = {
  title: 'cockpit',
  isFocused: false,
  bodyColumns: 40,
  maxRows: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

/** The rollover mod's state as the host would hand it to the cockpit's read. */
const publish = (on: On, value: unknown) => {
  if (value === undefined) return
  on('state.get', (_$, e, next) => (e.plugin === 'context-rollover' ? ({ value: { value, version: 3 } } as never) : next(e)))
}

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit', props: PANE_PROPS })

const CASES: readonly (readonly [string, unknown, readonly (string | RegExp)[]])[] = [
  ['monitoring', status({ heartbeatAt: Date.now() }), ['CONTEXT ROLLOVER', 'MONITORING', '142k / 200k', '71%', '180k · 38k remaining', 'Not started', '3 active · 2 idle', 'Never']],
  ['preparing', status({ phase: 'preparing', heartbeatAt: Date.now(), context: { tokens: 184000, window: null, measuredAt: 0, source: 'turn.step' }, continuation: { ...status().continuation, status: 'in-progress' }, operation: 'Persisting continuation state' }), ['PREPARING', '184k / 200k', '92%', '190k · 6k remaining', 'In progress', 'Persisting continuation state']],
  ['restarting', status({ phase: 'restarting', heartbeatAt: Date.now(), operation: 'Starting a fresh session' }), ['RESTARTING', 'Starting a fresh session']],
  ['resuming', status({ phase: 'resuming', heartbeatAt: Date.now(), context: { tokens: 12000, window: null, measuredAt: 0, source: 'turn.step' }, continuation: { ...status().continuation, status: 'restored' }, last: { outcome: 'success', rolloverId: 'g1', at: Date.now() - 60000, fromSessionId: 'a', toSessionId: 'b', finalTokens: 193000, detail: null }, operation: 'Resuming unfinished tasks' }), ['RESUMING', '12k / 200k', '6%', 'Restored', /Success · \d+[sm] ago/, 'Resuming unfinished tasks']],
  ['completed', status({ phase: 'completed', heartbeatAt: Date.now() }), ['COMPLETED']],
  ['failed', status({ phase: 'failed', heartbeatAt: Date.now(), error: { message: 'command clear refused', at: 0, isRetriable: true } }), ['FAILED', 'command clear refused']],
  ['stale', status({ heartbeatAt: Date.now() - 600000 }), [/STALE · 10m ago/, 'Rollover mod not responding']],
  ['unavailable', undefined, ['CONTEXT ROLLOVER', 'UNAVAILABLE', 'rollover mod not loaded']],
]

for (const [name, value, expected] of CASES) {
  test(`rollover: the pane draws the ${name} state`, async ($, on) => {
    on('clock.now', () => ({ value: Date.now() }))
    publish(on, value)
    const ui = await mountPane($)
    for (const text of expected) {
      const found = await ui.find({ text })
      if (found === undefined) throw new Error(`the ${name} pane does not show ${String(text)}`)
      expect(found.text).toMatch(text)
    }
    // The rest of the pane is still there.
    expect(await ui.find({ text: 'SESSIONS' })).toBeDefined()
  })
}

