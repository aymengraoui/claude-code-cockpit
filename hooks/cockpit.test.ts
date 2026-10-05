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
import { effortLabel, withDefaults } from './register'
import { heatOf, TOKYO } from './lib/palette'
import { activityOfTool, describe as describeActivity, spriteFor } from './lib/mascot'
import type { MascotActivity } from './lib/mascot'
import { subjectOf, todosOf } from './lib/tools'
import {
  bar,
  kilo,
  footerMode,
  modelLabel,
  spoken,
  shortPath,
  shortText,
  titleOf,
  until,
} from './lib/format'
import { capDiff, parseNumstat, parseStatus, relativeTo, withCounts } from './lib/git'

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
      stdout: e.argv.includes('rev-parse') ? '/repo' : e.argv.includes('status') ? STATUS : NUMSTAT,
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
  const windows = launchCommands('claude --resume abc', 'C:/repo', true)
  expect(windows[0]?.[0]).toBe('wt.exe')
  expect(windows[0]).toContain('claude --resume abc')
  expect(windows[1]?.[0]).toBe('cmd.exe')

  const posix = launchCommands('claude', '/repo', false)
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

const startPane = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('clock.now', () => ({ value: Date.now() }))
  // Time does not pass here: the tick and the mascot's loop end at their first sleep.
  on('clock.sleep', () => {
    throw new Error('no time passes in this test')
  })
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

test("a mode reads as the footer words it, from the engine's exact value", () => {
  expect(footerMode('auto')).toBe('auto mode on')
  expect(footerMode('plan')).toBe('plan mode on')
  expect(footerMode('acceptEdits')).toBe('accept edits on')
  expect(footerMode('default')).toBe('manual mode')
  expect(footerMode('bypassPermissions')).toBe('bypass permissions on')
  expect(footerMode('somethingNew')).toBe('somethingNew')
})

test('the mode a prompt reports is the mode the pane shows', async ($, on) => {
  on('classic.UserPromptSubmit', () => ({}))

  const ui = await startPane($, on)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'auto' })

  expect(await ui.find({ text: 'auto mode on' })).toBeDefined()
})

test('a later report replaces an earlier one, whichever input brings it', async ($, on) => {
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Stop', () => ({}))

  const ui = await startPane($, on)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'plan' })
  await $.classic.Stop({ permission_mode: 'auto', stop_hook_active: false })

  expect(await ui.find({ text: 'auto mode on' })).toBeDefined()
  expect(await ui.find({ text: 'plan mode on' })).toBeUndefined()
})

test('a written path is matched to git by its place in the repository', () => {
  const inside = relativeTo('C:/code/proj', [
    'C:/code/proj/src/parse.ts',
    'c:/code/proj/README.md',
    'C:/code/other/x.ts',
    'C:/code/project-two/y.ts',
  ])

  expect([...inside].sort()).toEqual(['README.md', 'src/parse.ts'])
})

test('a long diff is cut, and says how much was left out', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `+line ${i}`).join(String.fromCharCode(10))
  const cut = capDiff(lines, 4).split(String.fromCharCode(10))

  expect(cut.length).toBe(5)
  expect(cut[4]).toBe('… 6 more lines')
  expect(capDiff('short', 4)).toBe('short')
})

/** A session launched outside any repository, whose work happens in C:/code/proj. */
const startOutsideRepo = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  extra: { usage?: unknown } = {},
) => {
  const ran: string[][] = []
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.sleep', () => {
    throw new Error('no time passes in this test')
  })
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: MODEL_ROW }))
  on('ui.open', () => ({ value: { id: 'cockpit' } }))
  on('store.get', () => ({ value: null }))
  on('store.set', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: 'C:/Users/me' }))
  on('session.id', () => ({ value: 'current' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: extra.usage ?? USAGE }))
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    const dir = e.argv[2] ?? ''
    const isProj = dir.toLowerCase().startsWith('c:/code/proj')
    const out = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (!isProj) return out('', 128)
    if (e.argv.includes('rev-parse')) return out('C:/code/proj')
    if (e.argv.includes('status')) return out(STATUS)
    if (e.argv.includes('--numstat')) return out(NUMSTAT)

    return out('@@ -1 +1 @@' + String.fromCharCode(10) + '-old' + String.fromCharCode(10) + '+new')
  })
  on('session.start', () => ({ sessionId: 'current', cwd: 'C:/Users/me' }))
  on('tool.call', () => ({ result: {}, text: 'ok', isError: false }))

  await $.session.start({ source: 'startup', cwd: 'C:/Users/me' })

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })

  return { ui, ran }
}

test('launched outside a repository, the pane follows the repository the work is in', async ($, on) => {
  const { ui } = await startOutsideRepo($, on)
  expect(await ui.find({ text: 'not a git repository' })).toBeDefined()

  await $.tool.call({
    tool: 'Write',
    tool_use_id: 'w1',
    input: { file_path: 'C:/code/proj/src/parse.ts', content: 'x' },
  })

  expect(await ui.find({ text: 'proj' })).toBeDefined()
  expect(await ui.find({ text: 'feat/parser' })).toBeDefined()
  // Written this session, and now recognised as such: the dot never lit before.
  expect(await ui.find({ text: '●' })).toBeDefined()
})

test('pressing a changed file opens its diff, and back returns', async ($, on) => {
  const { ui } = await startOutsideRepo($, on)
  await $.tool.call({
    tool: 'Write',
    tool_use_id: 'w1',
    input: { file_path: 'C:/code/proj/src/parse.ts', content: 'x' },
  })

  await ui.press({ key: 'diff-src/parse.ts' })
  expect((await ui.find({ type: 'Code' }))?.text).toContain('+new')
  expect(await ui.find({ key: 'diff-close' })).toBeDefined()

  await ui.press({ key: 'diff-close' })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect(await ui.find({ text: 'WORKING TREE' })).toBeDefined()
})

test('the context line opens what fills it, largest first', async ($, on) => {
  const usage = {
    ...USAGE,
    context: {
      ...USAGE.context,
      breakdown: {
        categories: [
          { name: 'Messages', tokens: 9000, color: 'claude', isDeferred: false },
          { name: 'System tools', tokens: 14000, color: 'claude', isDeferred: false },
          { name: 'MCP tools', tokens: 30000, color: 'claude', isDeferred: true },
        ],
        totalTokens: 23000,
        maxTokens: 200000,
        rawMaxTokens: 200000,
        percentage: 12,
      },
    },
  }
  const ran: string[] = []
  on('command.run', (_$, e) => {
    ran.push(e.command)

    return { text: '' }
  })
  const { ui } = await startOutsideRepo($, on, { usage })

  await ui.press({ key: 'ctx' })

  expect(await ui.find({ text: 'System tools' })).toBeDefined()
  expect(await ui.find({ text: 'Messages' })).toBeDefined()
  // Deferred tools cost nothing until loaded, so they are not counted.
  expect(await ui.find({ text: 'MCP tools' })).toBeUndefined()

  // Compacting lives in the toolbar now, one press away from the breakdown.
  await ui.press({ key: 'action-compact' })
  expect(ran).toEqual(['compact'])
})

test('quick actions run the real commands, and clear asks twice', async ($, on) => {
  const ran: string[] = []
  const toasts: string[] = []
  on('command.run', (_$, e) => {
    ran.push(e.command)

    return { text: '' }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  const { ui } = await startOutsideRepo($, on)

  await ui.press({ key: 'action-rewind' })
  expect(ran).toEqual(['rewind'])

  await ui.press({ key: 'action-clear' })
  expect(ran).toEqual(['rewind'])
  expect(toasts.join(' ')).toContain('again')
  expect((await ui.find({ key: 'action-clear' }))?.text).toBe('clear?')

  await ui.press({ key: 'action-clear' })
  expect(ran).toEqual(['rewind', 'clear'])
})

/** The state as v0.15 stored it: no diff, contextRows or armed, and a repo with no root. */
const OLD_STATE = {
  model: 'Opus 5.5',
  effort: 'high',
  mode: 'auto',
  project: 'UltraPc',
  cwd: 'C:/Users/UltraPc',
  sessionId: 'current',
  turns: 4,
  context: 12,
  tokens: 24000,
  window: 200000,
  fiveHour: { percent: 6, resetsAt: null },
  sevenDay: null,
  repo: { branch: 'main', ahead: 0, behind: 0, changes: [] },
  isRepoChecked: true,
  todos: [],
  agents: [],
  history: [],
  tickedAt: null,
}

test('state stored by an older version is filled in, never drawn half-shaped', () => {
  const it = withDefaults(OLD_STATE as never)

  expect(it.diff).toBe(null)
  expect(it.contextRows).toBe(null)
  expect(it.armed).toBe(null)
  expect(it.repo?.root).toBe('')
  // What the old version did have is kept.
  expect(it.model).toBe('Opus 5.5')
  expect(withDefaults(null).diff).toBe(null)
})

test('a pane reloaded over an older version state still draws', async ($, on) => {
  // What the host hands back after a reload: the value an older version stored.
  on('state.get', () => ({ value: { value: OLD_STATE, version: 7 } }))

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: PANE_PROPS,
  })

  // Blank before: the drawing threw on the missing diff field.
  expect((await ui.find({ key: 'model' }))?.text).toContain('Opus 5.5')
  expect(await ui.find({ text: 'auto mode on' })).toBeDefined()
})

/** The children of a drawn element, as `drawn()` describes them. */
const childrenOf = (node: unknown): unknown[] =>
  (node as { children?: unknown[] }).children ?? []

test('the model and effort lead the pane; the quick actions are pinned to its bottom', async ($, on) => {
  const ui = await startPane($, on)
  const root = (await ui.drawn()) as { props?: { height?: number } }

  // The pane is exactly as tall as its body, so the toolbar is its last rows, not
  // something that scrolls away with the content above it.
  expect(root.props?.height).toBe(PANE_PROPS.scroll.bodyRows)

  const [content, , actions] = childrenOf(root)
  expect((content as { props?: { flexGrow?: number } }).props?.flexGrow).toBe(1)
  expect(JSON.stringify(content)).toContain('"key":"model"')
  expect(JSON.stringify(content)).toContain('"key":"effort"')
  expect(JSON.stringify(actions)).toContain('"key":"action-compact"')
  expect(JSON.stringify(actions)).toContain('"key":"action-clear"')
  expect(JSON.stringify(content)).not.toContain('"key":"action-')
})

test('compact warns once the context is nearly full', async ($, on) => {
  const full = { ...USAGE, context: { ...USAGE.context, percent: 91 } }
  const { ui } = await startOutsideRepo($, on, { usage: full })

  expect((await ui.find({ key: 'action-compact' }))?.text).toBe('compact ⚠')
})

test('the diff view keeps its way back at the bottom too', async ($, on) => {
  const { ui } = await startOutsideRepo($, on)
  await $.tool.call({
    tool: 'Write',
    tool_use_id: 'w1',
    input: { file_path: 'C:/code/proj/src/parse.ts', content: 'x' },
  })
  await ui.press({ key: 'diff-src/parse.ts' })

  const children = childrenOf(await ui.drawn())
  expect(JSON.stringify(children.at(-1))).toContain('"key":"diff-close"')
})

test('the content keeps a gutter from the edge that resizes the pane', async ($, on) => {
  const ui = await startPane($, on)
  const root = (await ui.drawn()) as { props?: { paddingLeft?: number } }

  expect(root.props?.paddingLeft).toBe(2)

  // The gutter is taken out of the width, so a rule still fits on one line.
  const rule = JSON.stringify(root).match(/"(─+)"/)?.[1] ?? ''
  expect(rule.length).toBe(PANE_PROPS.bodyColumns - 2)
})

const ALL_ACTIVITIES: MascotActivity[] = [
  'idle', 'thinking', 'writing', 'running', 'reading', 'planning', 'done', 'alert', 'waiting',
]

test('every frame of every activity is three rows of nine columns', () => {
  for (const activity of ALL_ACTIVITIES) {
    for (let frame = 0; frame < 24; frame += 1) {
      const rows = spriteFor(activity, frame)
      expect(rows.length).toBe(3)
      for (const row of rows) expect([...row].length).toBe(9)
    }
  }
})

test('the mascot moves differently for each kind of moment', () => {
  // Idle blinks now and then; a failure shakes; done throws its arms up.
  expect(spriteFor('idle', 0)[0]).not.toBe(spriteFor('idle', 1)[0])
  expect(spriteFor('alert', 0)).not.toEqual(spriteFor('alert', 1))
  expect(spriteFor('done', 0)[1]).not.toBe(spriteFor('done', 1)[1])
  expect(spriteFor('waiting', 0)[1]).not.toBe(spriteFor('waiting', 1)[1])
})

test('a tool reads as what the mascot is doing, and that reads as plain words', () => {
  expect(activityOfTool('Edit')).toBe('writing')
  expect(activityOfTool('Bash')).toBe('running')
  expect(activityOfTool('Grep')).toBe('reading')
  expect(activityOfTool('TodoWrite')).toBe('planning')
  expect(activityOfTool('SomethingElse')).toBe('thinking')

  expect(describeActivity('running', 'npm test')).toBe('running npm test')
  expect(describeActivity('done', null)).toBe('✓ done — your turn')
  expect(describeActivity('waiting', 'approve Bash')).toBe('⏳ needs you: approve Bash')
  expect(describeActivity('alert', 'npm test')).toBe('⚠ failed npm test')
})

test('a turn length reads the way people say it', () => {
  expect(spoken(45000)).toBe('45s')
  expect(spoken(192000)).toBe('3m 12s')
  expect(spoken(3840000)).toBe('1h 04m')
})

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}

/** A session with a clock the test moves, and the band mounted over it. */
const startBand = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  clock: { now: number },
) => {
  const sounds: string[] = []
  const toasts: string[] = []
  on('clock.now', () => ({ value: clock.now }))
  on('clock.sleep', () => {
    throw new Error('no time passes in this test')
  })
  on('audio.play', (_$, e) => {
    sounds.push((e as { clip?: { asset?: string } }).clip?.asset ?? '')

    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Notification', () => ({}))
  on('turn.complete', () => ({ text: 'done', reason: 'end_turn' }))
  on('tool.call', (_$, e) =>
    e.tool === 'Bash' && (e.input as { command?: string }).command === 'npm test'
      ? { result: {}, text: 'tests failed', isError: true }
      : { result: {}, text: 'ok', isError: false },
  )

  const band = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })

  return { band, sounds, toasts }
}

test('the band says what is happening, and whose turn it is', async ($, on) => {
  const clock = { now: 1_000_000 }
  const { band } = await startBand($, on, clock)
  expect(await band.find({ text: 'ready' })).toBeDefined()

  await $.classic.UserPromptSubmit({ prompt: 'fix it', permission_mode: 'auto' })
  expect(await band.find({ text: 'thinking…' })).toBeDefined()

  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)
  expect(await band.find({ text: '✓ done — your turn' })).toBeDefined()
})

test('a failed step is still on show when the turn ends', async ($, on) => {
  const { band } = await startBand($, on, { now: 1_000_000 })

  await $.classic.UserPromptSubmit({ prompt: 'test it', permission_mode: 'auto' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', input: { command: 'npm test' } })
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)

  expect(await band.find({ text: /⚠ failed 1 step: npm test/ })).toBeDefined()
})

test('a wait on the person is the loudest thing there is', async ($, on) => {
  const { band, sounds } = await startBand($, on, { now: 1_000_000 })

  await $.classic.Notification({
    message: 'Claude needs your permission to use Bash',
    notification_type: 'permission_prompt',
  })

  expect(await band.find({ text: /⏳ needs you: Claude needs your permission/ })).toBeDefined()
  expect(sounds).toEqual(['sounds/chime.wav'])
})

test('a long turn ends with a chime and a toast; a short one stays quiet', async ($, on) => {
  const clock = { now: 1_000_000 }
  const { sounds, toasts } = await startBand($, on, clock)

  await $.classic.UserPromptSubmit({ prompt: 'quick', permission_mode: 'auto' })
  clock.now += 5_000
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)
  expect(sounds).toEqual([])

  await $.classic.UserPromptSubmit({ prompt: 'long', permission_mode: 'auto' })
  clock.now += 95_000
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'end_turn' } as never)
  expect(sounds).toEqual(['sounds/chime.wav'])
  expect(toasts.join(' ')).toContain('✓ Done — your turn')
})

test('a subagent at work gets a mascot of its own', async ($, on) => {
  let release: () => void = () => undefined
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.sleep', () => {
    throw new Error('no time passes in this test')
  })
  on('tool.call', async () => {
    await held

    return { result: {}, text: 'ok', isError: false }
  })

  const running = $.tool.call({
    tool: 'Agent',
    tool_use_id: 'a1',
    input: { description: 'find callers', prompt: 'find them' },
  })
  // Let the call get as far as the subagent running: recorded, not yet returned.
  await new Promise(resolve => setTimeout(resolve, 40))

  const band = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  expect(await band.find({ text: '1 agent working' })).toBeDefined()

  release()
  await running
})

test('new opens a fresh claude in a terminal of its own', async ($, on) => {
  const { ui, ran } = await startOutsideRepo($, on)

  await ui.press({ key: 'action-new' })

  const launch = ran.find(argv => argv[0] === 'wt.exe')
  expect(launch).toBeDefined()
  expect(launch).toContain('claude')
  expect(launch?.join(' ')).not.toContain('--resume')
})

test('the end of a turn is a line that is easy to find when scrolling back', async ($, on) => {
  const marker = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 192000 },
  })

  expect(await marker.find({ text: '✓ done in 3m 12s' })).toBeDefined()
})
