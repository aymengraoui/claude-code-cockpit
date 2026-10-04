import { expect, test } from 'claude-code/testing'

import { bar, dur, heat, modelLabel, shortPath, shortText, until } from './lib/format'
import { parseNumstat, parseStatus, withCounts } from './lib/git'

const STATUS = [
  '# branch.oid 0bd1c4f',
  '# branch.head feat/parser',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 0bd1 0bd1 src/parse.ts',
  '1 M. N... 100644 100644 100644 0bd1 0bd1 src/tokens.ts',
  '? notes.md',
  '',
].join('\n')

const NUMSTAT = ['48\t12\tsrc/parse.ts', '90\t0\tsrc/tokens.ts', '-\t-\tlogo.png', ''].join('\n')

const PANE_PROPS = {
  title: 'cockpit',
  isFocused: false,
  bodyColumns: 34,
  maxRows: 24,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 24 },
  view: {},
}

test('a bar fills in proportion and never overflows its width', () => {
  expect(bar(0)).toBe('▱▱▱▱▱')
  expect(bar(40)).toBe('▰▰▱▱▱')
  expect(bar(50)).toBe('▰▰▰▱▱')
  expect(bar(100)).toBe('▰▰▰▰▰')
  expect(bar(1000)).toBe('▰▰▰▰▰')
  expect(bar(Number.NaN)).toBe('▱▱▱▱▱')
})

test('heat stays calm until a figure is worth noticing', () => {
  expect(heat(10)).toBe('success')
  expect(heat(60)).toBe('claude')
  expect(heat(80)).toBe('warning')
  expect(heat(95)).toBe('error')
})

test('a reset reads in the largest unit that still says something', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0)
  const at = (ms: number) => new Date(now + ms).toISOString()

  expect(until(at(18 * 60000), now)).toBe('18m')
  expect(until(at(134 * 60000), now)).toBe('2h14')
  expect(until(at(4 * 86400000), now)).toBe('4d')
  expect(until(at(-60000), now)).toBe(null)
  expect(until(null, now)).toBe(null)
  expect(until('not a date', now)).toBe(null)
})

test('durations read in the unit that fits', () => {
  expect(dur(120)).toBe('120ms')
  expect(dur(3100)).toBe('3.1s')
  expect(dur(75000)).toBe('1m15')
})

test('a long path keeps its filename, a long command keeps its verb', () => {
  expect(shortPath('src/engine/parse.ts', 40)).toBe('src/engine/parse.ts')
  expect(shortPath('src/engine/parse.ts', 14)).toBe('…gine/parse.ts')
  expect(shortPath(`src${String.fromCharCode(92)}a.ts`, 40)).toBe('src/a.ts')
  expect(shortText('npm run build --silent', 12)).toBe('npm run bui…')
})

test('a known model id reads as its name, an unknown one is still legible', () => {
  expect(modelLabel('claude-opus-5')).toBe('Opus 5')
  expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('claude-newmodel-9-2')).toBe('Newmodel 9.2')
})

test('git status gives the branch, its divergence and every changed path', () => {
  const repo = parseStatus(STATUS)

  expect(repo.branch).toBe('feat/parser')
  expect(repo.ahead).toBe(2)
  expect(repo.behind).toBe(1)
  expect(repo.changes.map(one => one.path)).toEqual([
    'src/parse.ts',
    'src/tokens.ts',
    'notes.md',
  ])
  expect(repo.changes[2]?.status).toBe('?')
})

test('a detached head and unparsable output both degrade instead of throwing', () => {
  expect(parseStatus('# branch.head (detached)').branch).toBe(null)
  expect(parseStatus('').branch).toBe(null)
  expect(parseStatus('garbage').changes).toEqual([])
})

test('numstat counts attach to paths, a binary file counting as zero', () => {
  const counts = parseNumstat(NUMSTAT)

  expect(counts.get('src/parse.ts')).toEqual({ added: 48, removed: 12 })
  expect(counts.get('logo.png')).toEqual({ added: 0, removed: 0 })
})

test("this session's files sort above the rest, then the largest diffs", () => {
  const repo = withCounts(
    parseStatus(STATUS),
    parseNumstat(NUMSTAT),
    new Set(['src/parse.ts']),
  )

  expect(repo.changes.map(one => one.path)).toEqual([
    'src/parse.ts',
    'src/tokens.ts',
    'notes.md',
  ])
  expect(repo.changes[0]?.isMine).toBe(true)
  expect(repo.changes[1]?.isMine).toBe(false)
  expect(repo.changes[1]?.added).toBe(90)
})

test('the pane draws the usage meters it has figures for', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200000, tokens: 74000, percent: 37 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(Date.now() + 8040000).toISOString() },
      { kind: 'seven_day', percentUsed: 81 },
    ],
    cost: { usd: 1.24 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })

  expect((await ui.find({ text: '37%' }))?.text).toContain('37%')
  expect((await ui.find({ text: '12%' }))?.text).toContain('12%')
  expect((await ui.find({ text: '81%' }))?.text).toContain('81%')
  expect(await ui.find({ text: '$1.24' })).toBeDefined()
})

test('the pane draws the branch and the working tree it read from git', async ($, on) => {
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { id: 'cockpit' } }))
  on('process.run', (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('status') ? STATUS : NUMSTAT,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('clock.now', () => ({ value: Date.now() }))
  on('session.start', () => ({ sessionId: 'test', cwd: '/repo' }))

  await $.session.start({ source: 'startup', cwd: '/repo' })

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })

  expect(await ui.find({ text: 'feat/parser' })).toBeDefined()
  expect(await ui.find({ text: 'WORKING TREE' })).toBeDefined()
  expect(await ui.find({ text: '+48' })).toBeDefined()
})
