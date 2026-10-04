import { expect, test } from 'claude-code/testing'

import {
  dirOf,
  idOf,
  pickRecent,
  resumeCommand,
  titleFromTranscript,
  toPast,
} from './lib/sessions'
import { isWindowsPath, launchCommands } from './lib/launch'
import { effortLabel, modeInHint } from './register'
import { heatOf, TOKYO } from './lib/palette'
import { subjectOf, todosOf } from './lib/tools'
import {
  bar,
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

const MODEL_ROW = [
  {
    key: 'model',
    label: 'Model',
    kind: 'choice',
    value: 'Opus 5',
    options: ['default', 'opus', 'sonnet', 'haiku'],
    provider: { kind: 'core', tier: 'core' },
    isLocked: false,
  },
]

const LOCKED_MODEL_ROW = [{ ...MODEL_ROW[0], isLocked: true }]

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
  expect(heatOf(10)).toBe(TOKYO.green)
  expect(heatOf(60)).toBe(TOKYO.yellow)
  expect(heatOf(80)).toBe(TOKYO.orange)
  expect(heatOf(95)).toBe(TOKYO.red)
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
})

test('the pane draws the branch and the working tree it read from git', async ($, on) => {
  on('command.register', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('config.list', () => ({ value: MODEL_ROW }))
  on('ui.panes', () => ({ value: [] }))
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
  on('clock.sleep', () => ({ value: undefined }))
  on('config.list', () => ({ value: MODEL_ROW }))
  on('ui.panes', () => ({ value: [] }))
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
  expect(await ui.find({ text: 'not a git repository' })).toBeDefined()
  expect(await ui.find({ text: 'no transcripts found' })).toBeDefined()
})

const TRANSCRIPT = [
  JSON.stringify({ type: 'mode', sessionId: 'older' }),
  JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'older' }),
  JSON.stringify({ type: 'user', isMeta: true, message: { content: 'ignore me' } }),
  JSON.stringify({ type: 'user', message: { content: '<command-name>/cockpit</command-name>' } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'fix the parser' }] } }),
  JSON.stringify({ type: 'assistant', message: { content: 'on it' } }),
  '',
].join(String.fromCharCode(10))

test('a transcript is titled by the first prompt the person actually typed', () => {
  expect(titleFromTranscript(TRANSCRIPT)).toBe('fix the parser')
  expect(titleFromTranscript('{"type":"user","message":{"content":"hi"}}')).toBe('hi')
  expect(titleFromTranscript('not json at all')).toBe(null)
  expect(titleFromTranscript('')).toBe(null)
})

test('the transcript directory and session id come off the path the engine gives', () => {
  const sep = String.fromCharCode(92)
  expect(dirOf(`C:${sep}Users${sep}me${sep}.claude${sep}projects${sep}p${sep}abc.jsonl`)).toBe(
    'C:/Users/me/.claude/projects/p',
  )
  expect(dirOf('/home/me/.claude/projects/p/abc.jsonl')).toBe('/home/me/.claude/projects/p')
  expect(idOf('abc-123.jsonl')).toBe('abc-123')
})

test('only transcripts are listed, newest first, empty ones left out', () => {
  const entries = [
    { name: 'old.jsonl', kind: 'file' as const, size: 10, mtimeMs: 1000 },
    { name: 'new.jsonl', kind: 'file' as const, size: 10, mtimeMs: 3000 },
    { name: 'empty.jsonl', kind: 'file' as const, size: 0, mtimeMs: 4000 },
    { name: 'notes.md', kind: 'file' as const, size: 10, mtimeMs: 5000 },
    { name: 'sub', kind: 'dir' as const, size: 0, mtimeMs: 6000 },
  ]

  expect(pickRecent(entries, 8).map(one => one.name)).toEqual(['new.jsonl', 'old.jsonl'])
  expect(pickRecent(entries, 1).map(one => one.name)).toEqual(['new.jsonl'])
})

test('a transcript with no prompt is listed by its id instead', () => {
  const entry = { name: 'abcdef1234.jsonl', kind: 'file' as const, size: 10, mtimeMs: 2000 }

  expect(toPast(entry, 'fix the parser')).toEqual({
    id: 'abcdef1234',
    at: 2000,
    title: 'fix the parser',
  })
  expect(toPast(entry, null).title).toBe('abcdef12')
})

test("the pane lists Claude Code's own sessions, read from its transcripts", async ($, on) => {
  const sep = String.fromCharCode(92)
  const path = `C:${sep}Users${sep}me${sep}.claude${sep}projects${sep}p${sep}current.jsonl`

  on('store.get', () => ({ value: {} }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: [
      { name: 'current.jsonl', kind: 'file', size: 200, mtimeMs: Date.now() },
      { name: 'older.jsonl', kind: 'file', size: 200, mtimeMs: Date.now() - 7200000 },
    ],
  }))
  on('fs.read', () => ({ value: TRANSCRIPT }))
  on('classic.SessionStart', () => ({}))

  await $.classic.SessionStart({ source: 'startup', transcript_path: path })

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })

  expect(await ui.find({ text: 'SESSIONS' })).toBeDefined()
  expect(await ui.find({ text: 'fix the parser' })).toBeDefined()
})

test('a session names the command that returns to it', () => {
  expect(resumeCommand('abc-123')).toBe('claude --resume abc-123')
})

test('a press with no terminal to be had still leaves the command on the clipboard', async ($, on) => {
  const sep = String.fromCharCode(92)
  const path = `C:${sep}Users${sep}me${sep}.claude${sep}projects${sep}p${sep}current.jsonl`
  let copied: string | undefined
  let toasted: string | undefined

  on('store.get', () => ({ value: {} }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: [{ name: 'older.jsonl', kind: 'file', size: 200, mtimeMs: Date.now() - 7200000 }],
  }))
  on('fs.read', () => ({ value: TRANSCRIPT }))
  on('classic.SessionStart', () => ({}))
  on('ui.copy', (_$, e) => {
    copied = e.text

    return { value: { isCopied: true } }
  })
  on('ui.toast', (_$, e) => {
    toasted = e.text

    return { value: undefined }
  })

  await $.classic.SessionStart({ source: 'startup', transcript_path: path })

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })

  await ui.press({ key: 'past-older' })

  expect(copied).toBe('claude --resume older')
  expect(toasted).toContain('claude --resume older')
})

test('a terminal is tried per platform, the window before a console', () => {
  const windows = launchCommands('abc', 'C:/repo', true)
  expect(windows[0]?.[0]).toBe('wt.exe')
  expect(windows[0]).toContain('claude --resume abc')
  expect(windows[1]?.[0]).toBe('cmd.exe')

  const posix = launchCommands('abc', '/repo', false)
  expect(posix[0]?.[0]).toBe('osascript')
  expect(posix.map(one => one[0])).toContain('gnome-terminal')
})

test('pressing a session opens it in a new terminal', async ($, on) => {
  const sep = String.fromCharCode(92)
  const path = `C:${sep}Users${sep}me${sep}.claude${sep}projects${sep}p${sep}current.jsonl`
  let launched: readonly string[] | undefined
  let copied = false

  on('store.get', () => ({ value: {} }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: [{ name: 'older.jsonl', kind: 'file', size: 200, mtimeMs: Date.now() - 7200000 }],
  }))
  on('fs.read', () => ({ value: TRANSCRIPT }))
  on('classic.SessionStart', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', () => {
    copied = true

    return { value: { isCopied: true } }
  })
  on('process.run', (_$, e) => {
    launched = e.argv

    return {
      value: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  await $.classic.SessionStart({ source: 'startup', transcript_path: path })

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })

  await ui.press({ key: 'past-older' })

  expect(launched?.[0]).toBe('wt.exe')
  expect(launched).toContain('claude --resume older')
  expect(copied).toBe(false)
})

test("the mode is read from the engine's own indicator, not the dialog's wording", () => {
  // The indicators come from the engine's mode table; the footer draws these exactly.
  expect(modeInHint('⏵⏵ auto mode')).toBe('auto')
  expect(modeInHint('auto mode · ? for shortcuts')).toBe('auto')
  expect(modeInHint('⏸ plan mode')).toBe('plan')
  expect(modeInHint('⏵⏵ accept edits')).toBe('acceptEdits')
  expect(modeInHint('manual mode')).toBe('default')
  expect(modeInHint('bypass permissions')).toBe('bypassPermissions')
  expect(modeInHint("don't ask")).toBe('dontAsk')

  // "manual mode" must not be read as "auto mode", whatever the order of the table.
  expect(modeInHint('manual mode · esc to interrupt')).toBe('default')

  // A line that names no mode leaves the last known one standing.
  expect(modeInHint('? for shortcuts')).toBe(null)
  expect(modeInHint('')).toBe(null)
})

test('the hint line is passed through untouched while its mode is read', async ($, on) => {
  let drawn: string | undefined

  on('ui.render', { component: 'PromptHint' }, (_$, e) => {
    drawn = (e.props as { hint?: string }).hint

    return { type: 'Text', props: {}, children: [] }
  })

  await $.ui.render({
    component: 'PromptHint',
    surface: 'terminal',
    props: { hint: '⏸ plan mode on', isDraft: false, isWorking: false },
  })

  expect(drawn).toBe('⏸ plan mode on')
})

const startPane = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: MODEL_ROW }))
  on('ui.open', () => ({ value: { id: 'cockpit' } }))
  on('store.get', () => ({ value: [] }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'current' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('process.run', () => ({
    value: {
      exitCode: 128,
      stdout: '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', () => ({ sessionId: 'current', cwd: '/repo' }))

  await $.session.start({ source: 'startup', cwd: '/repo' })

  return $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })
}

test('the model line names the running model, version and all', async ($, on) => {
  const ui = await startPane($, on)

  // claude-opus-5-5 is what is running; the line says so as /model does.
  expect((await ui.find({ key: 'model' }))?.text).toContain('Opus 5.5')
})

test('pressing the model opens the real /model picker', async ($, on) => {
  const ran: string[] = []
  on('command.run', (_$, e) => {
    ran.push(e.command)

    return { text: '' }
  })

  const ui = await startPane($, on)
  await ui.press({ key: 'model' })

  expect(ran).toEqual(['model'])
})

test('when /model cannot be run from here, it is left in the prompt box', async ($, on) => {
  const filled: string[] = []
  const toasts: string[] = []
  on('command.run', () => {
    throw new Error('the session is busy')
  })
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  const ui = await startPane($, on)
  await ui.press({ key: 'model' })

  expect(filled).toEqual(['/model'])
  expect(toasts.join(' ')).toContain('Enter')
  expect(toasts.join(' ')).toContain('model')
})

test('an effort level reads as its name', () => {
  expect(effortLabel('high')).toBe('High')
  expect(effortLabel('xhigh')).toBe('Xhigh')
  expect(effortLabel('')).toBe('')
})

test('pressing the effort opens the real /effort picker', async ($, on) => {
  const ran: string[] = []
  on('command.run', (_$, e) => {
    ran.push(e.command)

    return { text: '' }
  })

  const ui = await startPane($, on)
  // Before any request the level is not known yet, but the picker is still one press away.
  expect((await ui.find({ key: 'effort' }))?.text).toContain('effort')

  await ui.press({ key: 'effort' })

  expect(ran).toEqual(['effort'])
})

test('a stop reports the effort, which the line then names', async ($, on) => {
  on('classic.Stop', () => ({}))

  const ui = await startPane($, on)
  await $.classic.Stop({ permission_mode: 'auto', effort: { level: 'high' }, stop_hook_active: false })

  expect((await ui.find({ key: 'effort' }))?.text).toContain('High')
})
