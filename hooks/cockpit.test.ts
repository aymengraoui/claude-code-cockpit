import { expect, test } from 'claude-code/testing'

import { subjectOf, todosOf } from './lib/tools'
import {
  ago,
  bar,
  dur,
  heat,
  kilo,
  modelLabel,
  modeLabel,
  shortPath,
  shortText,
  titleOf,
  until,
} from './lib/format'
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

const USAGE = {
  startedAt: Date.now() - 600000,
  context: { window: 200000, tokens: 24000, percent: 12 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 6 }],
  cost: { usd: 0.12 },
}

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
  on('store.get', () => ({ value: [] }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'current' }))
  on('session.turns', () => ({ value: 3 }))
  on('session.model', () => ({ value: 'claude-opus-5' }))
  on('session.usage', () => ({ value: USAGE }))
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

test('a past timestamp reads in the largest unit that still says something', () => {
  const now = Date.UTC(2026, 0, 8, 12, 0, 0)

  expect(ago(now - 20000, now)).toBe('just now')
  expect(ago(now - 18 * 60000, now)).toBe('18m ago')
  expect(ago(now - 2 * 3600000, now)).toBe('2h ago')
  expect(ago(now - 4 * 86400000, now)).toBe('4d ago')
})

test('a permission mode reads in the words the footer uses', () => {
  expect(modeLabel('default')).toBe('manual')
  expect(modeLabel('acceptEdits')).toBe('accept edits')
  expect(modeLabel('plan')).toBe('plan')
  expect(modeLabel('bypassPermissions')).toBe('bypass')
  expect(modeLabel('somethingNew')).toBe('somethingNew')
})

test('a prompt becomes a one-line title', () => {
  expect(titleOf('  fix   the\nparser  ')).toBe('fix the parser')
  expect(titleOf('', 10)).toBe('untitled')
  expect(titleOf('a'.repeat(80), 10)).toBe(`${'a'.repeat(9)}…`)
})

test('the pane names the permission mode and lists earlier sessions', async ($, on) => {
  const startedAt = Date.now() - 2 * 3600000
  const past = { id: 'older', startedAt, title: 'fix the parser', costUsd: 0.4 }

  on('clock.now', () => ({ value: Date.now() }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { id: 'cockpit' } }))
  on('store.get', () => ({ value: [past] }))
  on('session.turns', () => ({ value: 1 }))
  on('session.model', () => ({ value: 'claude-opus-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('process.run', () => ({
    value: {
      exitCode: 1,
      stdout: '',
      stderr: 'not a repository',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', () => ({ sessionId: 'current', cwd: '/repo' }))
  on('classic.UserPromptSubmit', () => ({}))

  await $.session.start({ source: 'startup', cwd: '/repo' })
  await $.classic.UserPromptSubmit({ prompt: 'hello', permission_mode: 'plan' })

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })

  expect(await ui.find({ text: 'plan' })).toBeDefined()
  expect(await ui.find({ text: 'SESSIONS' })).toBeDefined()
  expect(await ui.find({ text: 'fix the parser' })).toBeDefined()
  expect(await ui.find({ text: '2h ago' })).toBeDefined()
})

test('token counts read at a glance', () => {
  expect(kilo(980)).toBe('980')
  expect(kilo(74000)).toBe('74k')
  expect(kilo(1200000)).toBe('1.2M')
})

test('a TodoWrite payload is taken only in the shape this build documents', () => {
  const todos = [
    { content: 'parse the status', status: 'completed', activeForm: 'parsing' },
    { content: 'draw the pane', status: 'in_progress', activeForm: 'drawing' },
  ]

  expect(todosOf({ todos })?.length).toBe(2)
  expect(todosOf({})).toBe(null)
  expect(todosOf({ todos: [{ content: 'no status' }] })).toBe(null)
})

test('the subject column says what a call is about, per tool', () => {
  expect(subjectOf('Bash', { command: 'npm test' })).toBe('npm test')
  expect(subjectOf('Edit', { file_path: 'src/a.ts' })).toBe('src/a.ts')
  expect(subjectOf('Agent', { description: 'find callers', prompt: 'x' })).toBe('find callers')
  expect(subjectOf('TodoWrite', { todos: [] })).toBe('plan updated')
  expect(subjectOf('Unknown', {})).toBe('')
})

test('the pane is primed at launch, and says so where a section is empty', async ($, on) => {
  on('clock.now', () => ({ value: Date.now() }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { id: 'cockpit' } }))
  on('store.get', () => ({ value: [] }))
  on('session.cwd', () => ({ value: '/home/me/notes' }))
  on('session.id', () => ({ value: 'current' }))
  on('session.turns', () => ({ value: 0 }))
  on('session.model', () => ({ value: 'claude-opus-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('process.run', () => ({
    value: {
      exitCode: 128,
      stdout: '',
      stderr: 'not a git repository',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', () => ({ sessionId: 'current', cwd: '/home/me/notes' }))

  await $.session.start({ source: 'startup', cwd: '/home/me/notes' })

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })

  expect(await ui.find({ text: 'notes' })).toBeDefined()
  // Primed at launch: no session.measure and no turn.step has fired in this test.
  expect(await ui.find({ text: 'Opus 5' })).toBeDefined()
  expect(await ui.find({ text: '12%' })).toBeDefined()
  expect(await ui.find({ text: '24k/200k' })).toBeDefined()
  expect(await ui.find({ text: '$0.12' })).toBeDefined()
  expect(await ui.find({ text: 'not a git repository' })).toBeDefined()
  expect(await ui.find({ text: 'nothing yet' })).toBeDefined()
  expect(await ui.find({ text: 'this is the first one recorded' })).toBeDefined()
})
