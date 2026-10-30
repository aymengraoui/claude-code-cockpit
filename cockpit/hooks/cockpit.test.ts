import { expect, test } from 'claude-code/testing'

import { isWindowsPath, launchCommands } from './lib/launch'
import { effortLabel, withDefaults } from './register'
import { heatOf, TOKYO } from './lib/palette'
import { aboutCall, activityOfTool } from './lib/mascot'
import { emphasizeQuestions, errorLines } from './lib/attention'
import { subjectOf, todosOf } from './lib/tools'
import { bar, kilo, footerMode, modelLabel, shimmer, SHIMMER, spoken, shortText, until } from './lib/format'
import { cacheView } from './lib/usage'

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

test('a long command keeps its verb', () => {
  expect(shortText('npm run build --silent', 12)).toBe('npm run bui…')
})

test('a known model id reads as its name, an unknown one is still legible', () => {
  expect(modelLabel('claude-opus-5')).toBe('Opus 5')
  expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('claude-newmodel-9-2')).toBe('Newmodel 9.2')
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

/** The state as v0.15 stored it: no contextRows, armed or notes, and fields since removed. */
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

  expect(it.contextRows).toBe(null)
  expect(it.armed).toBe(null)
  expect(it.respondedAt).toBe(null)
  expect(it.notes).toBe('')
  // What the old version did have is kept.
  expect(it.model).toBe('Opus 5.5')
  expect(withDefaults(null).notes).toBe('')
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

  // Blank before: the drawing threw on a field the older version never stored.
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

  const [content, progress, actions] = childrenOf(root)
  expect(JSON.stringify(progress)).toContain('"key":"progress"')
  expect((content as { props?: { flexGrow?: number } }).props?.flexGrow).toBe(1)
  expect(JSON.stringify(content)).toContain('"key":"model"')
  expect(JSON.stringify(content)).toContain('"key":"effort"')
  expect(JSON.stringify(actions)).toContain('"key":"action-new"')
  expect(JSON.stringify(actions)).toContain('"key":"action-compact"')
  expect(JSON.stringify(actions)).toContain('"key":"action-clear"')
  expect(JSON.stringify(content)).not.toContain('"key":"action-')
})

test('compact warns once the context is nearly full', async ($, on) => {
  const full = { ...USAGE, context: { ...USAGE.context, percent: 91 } }
  const { ui } = await startOutsideRepo($, on, { usage: full })

  expect((await ui.find({ key: 'action-compact' }))?.text).toBe('compact ⚠')
})

test('the content keeps a gutter from the edge that resizes the pane', async ($, on) => {
  const ui = await startPane($, on)
  const root = (await ui.drawn()) as { props?: { paddingLeft?: number } }

  expect(root.props?.paddingLeft).toBe(2)

  // The gutter is taken out of the width, so every block still fits on one line.
  const bottoms = JSON.stringify(root).match(/"╰─*╯"/g) ?? []
  expect(bottoms.length).toBeGreaterThan(3)
  for (const bottom of bottoms) expect(bottom.length - 2).toBe(PANE_PROPS.bodyColumns - 2)
})

test('every block is framed, its title set into the top edge, each in its own colour', async ($, on) => {
  const ui = await startPane($, on)
  const drawn = JSON.stringify(await ui.drawn())

  const tops = drawn.match(/"╭─ "/g) ?? []
  const bottoms = drawn.match(/"╰─*╯"/g) ?? []
  expect(tops.length).toBe(bottoms.length)
  for (const title of ['SESSION', 'USAGE', 'CONTEXT ROLLOVER', 'NOTES', 'ACTIONS']) {
    expect(await ui.find({ text: title })).toBeDefined()
  }
  for (const gone of ['WORKING TREE', 'SESSIONS', 'MASCOTS']) expect(await ui.find({ text: gone })).toBeUndefined()
  expect(drawn).toContain('#7aa2f7')
  expect(drawn).toContain('#9ece6a')
})

test('a tool reads as what the session is doing', () => {
  expect(activityOfTool('Edit')).toBe('writing')
  expect(activityOfTool('Bash')).toBe('running')
  expect(activityOfTool('Grep')).toBe('reading')
  expect(activityOfTool('TodoWrite')).toBe('planning')
  expect(activityOfTool('SomethingElse')).toBe('thinking')
})

test('a turn length reads the way people say it', () => {
  expect(spoken(45000)).toBe('45s')
  expect(spoken(192000)).toBe('3m 12s')
  expect(spoken(3840000)).toBe('1h 04m')
})

/** A pane wide enough for every block. */
const WIDE_PANE_PROPS = { ...PANE_PROPS, bodyColumns: 80 }

/** A session with a clock the test moves, and the pane mounted over it. */
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
    component: 'Pane',
    requestId: 'cockpit',
    props: WIDE_PANE_PROPS,
  })

  return { band, sounds, toasts }
}

test('a long turn with a failed step says so when it ends', async ($, on) => {
  const clock = { now: 1_000_000 }
  const { toasts } = await startBand($, on, clock)

  await $.classic.UserPromptSubmit({ prompt: 'test it', permission_mode: 'auto' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', input: { command: 'npm test' } })
  clock.now += 95_000
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)

  expect(toasts.join(' ')).toContain('1 failed')
})

test('a wait on the person is the loudest thing there is', async ($, on) => {
  const { sounds } = await startBand($, on, { now: 1_000_000 })

  await $.classic.Notification({
    message: 'Claude needs your permission to use Bash',
    notification_type: 'permission_prompt',
  })

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

test('subagents at work get a row each above the prompt, with how long they have run', async ($, on) => {
  const agents = [{ id: 'a1', label: 'Explore auth flow', at: Date.now() - 64000 }]
  on('state.get', (_$, e, next) =>
    e.key === 'mascot' ? ({ value: { value: { agents }, version: 1 } } as never) : next(e),
  )

  const band = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 10 } as never,
  })

  expect(await band.find({ text: 'Explore auth flow' })).toBeDefined()
  expect(await band.find({ text: '1m 04s' })).toBeDefined()
})

test('with no subagents the band above the prompt is left to the engine', async ($, on) => {
  on('state.get', (_$, e, next) =>
    e.key === 'mascot' ? ({ value: { value: { agents: [] }, version: 1 } } as never) : next(e),
  )
  // The engine's own band, which the hook should hand the drawing back to.
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }) as never)

  const band = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 10 } as never,
  })

  expect(await band.find({ text: 'engine band' })).toBeDefined()
  expect(await band.find({ text: '⟳' })).toBeUndefined()
})

test('a call is described by what it is: a file by its name, a command by itself', () => {
  expect(aboutCall('Edit', 'C:/code/proj/src/parse.ts')).toBe('parse.ts')
  expect(aboutCall('Bash', 'git show v99')).toBe('git show v99')
  // Found in a live demo: the path-style shortening turned this into
  // "claude-code-cockpit && git show v99".
  expect(aboutCall('Bash', 'cd ~/Desktop/Code/claude-code-cockpit && git show v99')).toBe('git show v99')
  expect(aboutCall('Bash', 'cd "C:/My Code/app"; npm test')).toBe('npm test')
  expect(aboutCall('Bash', 'npm run build -- --out ./dist/app')).toBe('npm run build -- --out ./dist/app')
})

test('a question put to you is marked; code, headings and plain lines are not', () => {
  const reply = [
    'Pushed to GitHub.',
    'Want me to delete the demo file?',
    '- Should it open a new window?',
    '## Is this a heading?',
    '```',
    'echo "is this code?"',
    '```',
    'Do you want **bold** kept?',
  ].join(String.fromCharCode(10))

  expect(emphasizeQuestions(reply).split(String.fromCharCode(10))).toEqual([
    'Pushed to GitHub.',
    '👉 **Want me to delete the demo file?**',
    '- 👉 **Should it open a new window?**',
    '## Is this a heading?',
    '```',
    'echo "is this code?"',
    '```',
    '👉 Do you want **bold** kept?',
  ])
  expect(emphasizeQuestions('No questions here.')).toBe('No questions here.')
})

test('a failed call shows its first lines of output, stderr first', () => {
  expect(errorLines('one\n\ntwo\nthree\nfour')).toEqual(['one', 'two', 'three'])
  expect(errorLines({ stdout: 'out', stderr: 'fatal: bad revision' })).toEqual(['fatal: bad revision'])
  expect(errorLines(null)).toEqual([])
})

test('a reply is drawn with its questions marked, the stored text untouched', async ($, on) => {
  let drawn: string | undefined
  on('ui.render', { component: 'AssistantMessage' }, (_$, e) => {
    drawn = (e.props as { text: string }).text

    return { type: 'Text', props: {}, children: [] }
  })

  await $.ui.render({
    component: 'AssistantMessage',
    surface: 'terminal',
    props: { text: 'Done.\nShould I push it?', isFirstOfReply: true },
  })

  expect(drawn).toBe('Done.\n👉 **Should I push it?**')
})

test('a failed tool call is drawn loud, with why; one that worked keeps its own row', async ($, on) => {
  let engineDrew = 0
  on('ui.render', { component: 'ToolUse' }, () => {
    engineDrew += 1

    return { type: 'Text', props: {}, children: [] }
  })

  const failed = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      tool: 'Bash',
      input: { command: 'cd /repo && git show v99' },
      isRunning: false,
      isErrored: true,
      isInterrupted: false,
      output: { stdout: '', stderr: "fatal: ambiguous argument 'v99'" },
    },
  })
  expect(await failed.find({ text: '✗ Bash failed · git show v99' })).toBeDefined()
  expect(await failed.find({ text: /fatal: ambiguous argument/ })).toBeDefined()
  expect(engineDrew).toBe(0)

  await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
  })
  expect(engineDrew).toBe(1)
})

test('the progress shimmer is purple, in proportion, and moves frame to frame', () => {
  const at0 = shimmer(50, 10, 0)
  const at1 = shimmer(50, 10, 1)

  expect(at0.length).toBe(10)
  expect(at0.filter(cell => cell.char === '▰').length).toBe(5)
  // Empty cells take the frame colour; filled ones a purple of the band.
  expect(at0.slice(5).every(cell => cell.color === null)).toBe(true)
  expect(at0.slice(0, 5).every(cell => cell.color !== null && SHIMMER.includes(cell.color))).toBe(true)
  // The crest sweeps one cell per frame.
  expect(at1[1]?.color).toBe(at0[0]?.color)
  expect(at1.map(cell => cell.color)).not.toEqual(at0.map(cell => cell.color))
})

test('the cache reads warm with the time left, then cold past its TTL', () => {
  const hour = 3_600_000

  expect(cacheView(null, 0, hour)).toBe(null)
  expect(cacheView(0, 18 * 60_000, hour)).toEqual({ isWarm: true, left: '42m', leftMs: 42 * 60_000 })
  expect(cacheView(0, 30_000, 5 * 60_000)?.left).toBe('4m')
  expect(cacheView(0, 4.5 * 60_000, 5 * 60_000)?.left).toBe('<1m')
  expect(cacheView(0, hour + 1, hour)?.isWarm).toBe(false)
})

test('notes take the room the other blocks leave, and every edit is kept per project', async ($, on) => {
  const stored: Record<string, unknown> = {}
  on('store.set', (_$, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  const ui = await startPane($, on)

  expect(await ui.find({ key: 'notes' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toMatch(/"rows":([3-9]|\d\d)/)

  await ui.input({ key: 'notes', text: 'ship the cache line', kind: 'change' })
  expect(stored['cockpit.notes./repo']).toBe('ship the cache line')
})
