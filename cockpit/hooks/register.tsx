import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Activity, Cockpit, ContextRow, MascotState } from '../types'
import { bar, kilo, footerMode, modelLabel, shimmer, SHIMMER, spoken, shortText, toPosix, until } from './lib/format'
import { subjectOf, todosOf } from './lib/tools'
import { isWindowsPath, launchCommands } from './lib/launch'
import { heatOf, TOKYO } from './lib/palette'
import { aboutCall, activityOfTool, CHIME_AFTER_MS } from './lib/mascot'
import type { MascotActivity } from './lib/mascot'
import { emphasizeQuestions, errorLines } from './lib/attention'
import { cacheView, fromUsage } from './lib/usage'
import { labelOf, rolloverBar, rolloverView } from './lib/rollover'

const PANE = 'cockpit'

/** `$.store` key prefix for each project's notes, the project's directory after it. */
const NOTES = 'cockpit.notes.'
/** Open plan items the pane lists; the rest wait their turn. */
const PLAN_SHOWN = 5
/** How long a press that wants confirming stays armed. */
const ARM_MS = 4000
/** Columns of space between the pane's edge — the line that resizes it — and the content. */
const GUTTER = 2
/** Columns a block's border and padding take from its width: one of each, either side. */
const BLOCK_INSET = 4
/** The quick actions, each the engine's own command; the one that discards comes last. */
const QUICK_ACTIONS = ['new', 'compact', 'rewind', 'resume', 'clear'] as const
/** How fast the shimmer moves: a frame every this many milliseconds. */
const FRAME_MS = 280
/** Frames the shimmer keeps moving after work finishes, fails or waits: about ten seconds. */
const SETTLE_FRAMES = 36
/** A safety for one long step: past this many frames with nothing changing, the shimmer rests. */
const MAX_FRAMES = 2000
/** The chime, a file of the plugin's own. */
const CHIME = 'sounds/chime.wav'
/** Context fill at which compacting is offered as the thing to do next. */
const COMPACT_AT = 85
/** Colours the context breakdown's rows take in turn. */
const ROW_COLOURS = [TOKYO.blue, TOKYO.accent, TOKYO.cyan, TOKYO.green, TOKYO.yellow, TOKYO.orange]
/** Each block's colour, so the pane reads as distinct parts at a glance. */
const BLOCK = {
  session: TOKYO.accent,
  usage: TOKYO.blue,
  rollover: TOKYO.cyan,
  plan: TOKYO.yellow,
  agents: TOKYO.orange,
  notes: TOKYO.green,
  progress: TOKYO.accent,
  actions: TOKYO.dim,
} as const
/** How often the pane's clocks and figures are refreshed while it is open. */
const TICK_MS = 2000

const EMPTY: Cockpit = {
  model: null,
  effort: null,
  mode: null,
  project: null,
  cwd: null,
  turns: null,
  context: null,
  tokens: null,
  window: null,
  fiveHour: null,
  sevenDay: null,
  todos: [],
  agents: [],
  tickedAt: null,
  contextRows: null,
  armed: null,
  respondedAt: null,
  notes: '',
}

const state = atom({ plugin: 'cockpit', key: 'state' } as const, EMPTY)

const MASCOT_IDLE: MascotState = {
  activity: 'idle',
  frame: 0,
  failures: [],
  turnStartedAt: null,
  agents: [],
}

/** What the session is doing, in its own slot so its frames are written apart from the pane's
 * other state. Still keyed `mascot`, so state stored by older versions keeps loading. */
const mascot = atom({ plugin: 'cockpit', key: 'mascot' } as const, MASCOT_IDLE)

/** That state with every field present, as `withDefaults` is for the pane's. */
export const mascotDefaults = (stored: Partial<MascotState> | null | undefined): MascotState => ({
  ...MASCOT_IDLE,
  ...(stored ?? {}),
  failures: Array.isArray(stored?.failures) ? stored.failures : [],
  agents: Array.isArray(stored?.agents) ? stored.agents : [],
})

/**
 * The state with every field present, whatever version wrote it.
 *
 * `$.state` outlives a reload, so a new version reads what an older one stored — without
 * the fields it added. Drawn as stored, the first of them (a field read as undefined, not
 * null) threw and left the pane blank. Every read goes through this, and the start of a
 * session writes it back once.
 */
export const withDefaults = (stored: Partial<Cockpit> | null | undefined): Cockpit => {
  const value = { ...EMPTY, ...(stored ?? {}) }

  for (const key of Object.keys(EMPTY) as (keyof Cockpit)[]) {
    if (value[key] === undefined) (value as Record<string, unknown>)[key] = EMPTY[key]
  }

  return value
}

const AGENTS_KEPT = 12

/** Keep a project's notes, on every edit, so nothing typed is lost to a reload. */
const saveNotes = async ($: EngineInterface, cwd: string | null, notes: string): Promise<void> => {
  await update($, state, prev => ({ ...prev, notes }))
  if (cwd !== null) await $.store.set(NOTES + cwd, notes).catch(() => undefined)
}

/** What fills the context, as /context counts it; a deferred row costs nothing yet. */
const readContextRows = async ($: EngineInterface): Promise<ContextRow[]> => {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const categories = usage.context.breakdown?.categories ?? []

    return categories
      .filter(one => !one.isDeferred && one.tokens > 0)
      .map(one => ({ name: one.name, tokens: one.tokens }))
      .sort((a, b) => b.tokens - a.tokens)
  } catch {
    return []
  }
}

/**
 * A press of a quick action. /clear discards the conversation, so it asks twice: the
 * first press arms it and says so, a second within a few seconds runs it.
 */
const pressAction = async ($: EngineInterface, action: string): Promise<void> => {
  if (action === 'new') {
    const it = withDefaults(await read($, state))
    await openSession($, it.cwd ?? '.')

    return
  }
  if (action === 'clear') {
    const { armed } = withDefaults(await read($, state))
    const now = Date.now()
    if (armed === null || armed.action !== 'clear' || now - armed.at > ARM_MS) {
      await update($, state, prev => ({ ...prev, armed: { action: 'clear', at: now } }))
      $.ui.toast('Press clear again to discard this conversation')

      return
    }
  }
  await update($, state, prev => ({ ...prev, armed: null }))
  await runCommand($, action)
}

/**
 * Open a fresh session in a terminal of its own, falling back to the clipboard.
 *
 * Nothing about the person's setup is assumed: the candidates are tried in order and
 * a click that finds no terminal still leaves them the command.
 */
const openSession = async ($: EngineInterface, cwd: string): Promise<void> => {
  const command = 'claude'
  // The transcript's path always says which platform this is; a cwd may not be known yet.
  const isWindows = isWindowsPath(transcriptPath === '' ? cwd : transcriptPath)

  for (const argv of launchCommands(command, cwd, isWindows)) {
    try {
      const ran = await $.process.run(argv)
      if (ran.exitCode === 0) {
        $.ui.toast('Opening a new session')

        return
      }
    } catch {
      // That terminal is not on this machine; the next candidate may be.
    }
  }

  const copied = await $.ui.copy({ text: command, surface: 'terminal' }).catch(() => ({ isCopied: false }))
  $.ui.toast(copied.isCopied ? `Copied: ${command}` : `Run it yourself: ${command}`)
}

/**
 * Run one of the engine's own commands — `/model`, `/effort`, `/compact` — as typed.
 *
 * What they offer depends on the account and the model (plan-gated models, the effort
 * levels a model takes), and none of it is exposed to a plugin, so no copy of a list here
 * could be exact. Running the command is: the same list, the same switching. A run that
 * cannot happen rejects, and the command is left in the prompt box, one Enter away.
 */
const runCommand = async ($: EngineInterface, command: string): Promise<void> => {
  try {
    await $.command.run({ command })
  } catch {
    const filled = await $.prompt.fill({ text: `/${command}` }).catch(() => ({ isFilled: false }))
    $.ui.toast(filled.isFilled ? `Press Enter to run /${command}` : `Run /${command}`)
  }
}

/** An effort level as its name: `high` reads as `High`. */
export const effortLabel = (level: string): string =>
  level === '' ? level : level.charAt(0).toUpperCase() + level.slice(1)

/** This session's transcript, which says which platform this is. */
let transcriptPath = ''

/** Set what the session is doing. */
const act = async ($: EngineInterface, activity: MascotActivity): Promise<void> => {
  await moveMascot($, value => ({ ...value, activity }))
}

/** The chime: once, softly, and never a failure if the sound cannot play. */
const chime = ($: EngineInterface): void => {
  void $.audio.play({ asset: CHIME }).catch(() => undefined)
}

/** The activities that are work in progress: the shimmer moves for as long as they last. */
const WORKING: ReadonlySet<MascotActivity> = new Set(['thinking', 'writing', 'running', 'reading', 'planning'])

/** One animation loop at a time. */
let isAnimating = false

/**
 * The heartbeat that moves the progress shimmer and the subagent band. Motion is information
 * here, not decoration: it moves while work is under way, for a few seconds when something
 * changes — done, failed, needs you — and then stands still. Idle never moves. So the loop ends by itself, and any change
 * of activity starts it again. Like the pane's tick, nothing in it may reject.
 */
const startAnimating = ($: EngineInterface): void => {
  if (isAnimating) return
  isAnimating = true

  void (async () => {
    try {
      let last: MascotActivity | null = null
      let still = 0
      for (;;) {
        const slept = await $.clock
          .sleep(FRAME_MS)
          .then(() => true)
          .catch(() => false)
        if (!slept) break

        const now = mascotDefaults(await read($, mascot).catch(() => null))
        if (now.activity === last) still += 1
        else {
          last = now.activity
          still = 0
        }
        if (now.agents.length > 0 && now.frame % 4 === 0) await syncAgents($)
        const busy = WORKING.has(now.activity) || now.agents.length > 0
        const limit = busy ? MAX_FRAMES : now.activity === 'idle' ? 0 : SETTLE_FRAMES
        if (still >= limit) break

        const isOk = await update($, mascot, prev => {
          const value = mascotDefaults(prev)

          return { ...value, frame: (value.frame + 1) % 1200 }
        })
          .then(() => true)
          .catch(() => false)
        if (!isOk) break
      }
    } finally {
      isAnimating = false
    }
  })()
}

/** The statuses of a subagent still at work. */
const AT_WORK = new Set(['pending', 'running', 'waiting'])

/**
 * The subagents at work, as the engine reports them. An Agent call returns as soon as a
 * background subagent starts, so the call alone would show it for a moment; the
 * engine's own list says it is still running until it is not.
 */
const readAgents = async ($: EngineInterface): Promise<{ id: string; label: string }[] | null> => {
  try {
    return (await $.agent.list())
      .filter(one => AT_WORK.has(one.status))
      .map(one => ({ id: one.id, label: one.description || one.type }))
  } catch {
    return null
  }
}

/** Bring the band in line with the subagents at work, writing only on a change. */
const syncAgents = async ($: EngineInterface): Promise<void> => {
  const agents = await readAgents($)
  if (agents === null) return
  const was = mascotDefaults(await read($, mascot).catch(() => null)).agents
  const same = was.length === agents.length && was.every((one, index) => one.id === agents[index]?.id)
  if (same) return

  // The engine's list carries no start time, so an agent's clock starts when it is first seen.
  const now = await $.clock.now()
  const timed = agents.map(one => ({ ...one, at: was.find(old => old.id === one.id)?.at ?? now }))
  await update($, mascot, prev => ({ ...mascotDefaults(prev), agents: timed }))
  startAnimating($)
}

/** Change what the session is doing, and let the shimmer move to show it. */
const moveMascot = async ($: EngineInterface, change: (value: MascotState) => MascotState): Promise<void> => {
  await update($, mascot, prev => change(mascotDefaults(prev)))
  startAnimating($)
}

/** One ticker at a time, however many times the pane is opened. */
let isTicking = false

/**
 * The pane's clocks move on their own: durations, resets and `ago` are all read at draw
 * time, so a tick that only stamps the state is enough to refresh them. It stops as soon
 * as the pane is closed, and never runs twice.
 */
const startTicking = ($: EngineInterface): void => {
  if (isTicking) return
  isTicking = true

  void (async () => {
    try {
      for (;;) {
        // Nothing here may reject: an unhandled rejection in a detached loop would
        // take the tick with it and say nothing.
        const slept = await $.clock
          .sleep(TICK_MS)
          .then(() => true)
          .catch(() => false)
        if (!slept) break

        const panes = await $.ui.panes().catch(() => [])
        if (!panes.some(one => one.id === PANE)) break

        const [usage, model] = await Promise.all([
          $.session.usage().catch(() => null),
          $.session.model().catch(() => null),
        ])
        await update($, state, prev => ({
          ...prev,
          ...(usage === null ? {} : fromUsage(prev, usage)),
          model: model === null ? prev.model : modelLabel(model),
          tickedAt: Date.now(),
        }))
      }
    } finally {
      isTicking = false
    }
  })()
}

export const register: Register = (on, options) => {
  // Mods cannot read the engine's cache TTL, so the person states it (1h on a subscription).
  const cacheTtlMs = options.cacheTtl === '5m' ? 5 * 60_000 : 60 * 60_000

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cockpit', description: 'Open the cockpit pane' })
    await update($, state, prev => withDefaults(prev))

    // At launch no event has fired yet, so every figure the engine already holds is
    // asked for here rather than waited on. This runs again on each reload.
    const [cwd, usage, model, turns] = await Promise.all([
      $.session.cwd().catch(() => ''),
      $.session.usage().catch(() => null),
      $.session.model().catch(() => null),
      $.session.turns().catch(() => null),
    ])
    const notes = cwd === '' ? null : await $.store.get(NOTES + toPosix(cwd)).catch(() => null)

    const segments = toPosix(cwd).split('/').filter(one => one !== '')
    await update($, state, prev => ({
      ...prev,
      ...(usage === null ? {} : fromUsage(prev, usage)),
      project: segments.at(-1) ?? null,
      cwd: cwd === '' ? null : toPosix(cwd),
      model: model === null ? prev.model : modelLabel(model),
      turns: turns ?? prev.turns,
      notes: typeof notes === 'string' ? notes : '',
    }))

    // Opened unasked, the pane seats itself only once the terminal is wide enough.
    void $.ui.open({ id: PANE, title: 'cockpit' })
    startTicking($)
    // Subagents already at work when this loads — a reload mid-task — keep the shimmer going.
    await syncAgents($)

    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await $.ui.open({ id: PANE, title: 'cockpit' })
    startTicking($)

    return { text: 'Cockpit pane opened.' }
  })

  // The permission mode reaches a mod only through the classic hook inputs, which carry
  // it on every prompt and every tool result — so it is read, never asked for.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await moveMascot($, value => ({
      ...value,
      activity: 'thinking',
      failures: [],
      turnStartedAt: startedAt,
    }))
    if (typeof e.permission_mode === 'string') {
      const mode = e.permission_mode
      await update($, state, prev => ({ ...prev, mode }))
    }
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') transcriptPath = e.transcript_path

    return next(e)
  })

  // A permission prompt or an idle wait: the one moment the session cannot go on without you.
  on('classic.Notification', async ($, e, next) => {
    await act($, 'waiting')
    chime($)

    return next(e)
  })

  on('classic.SubagentStart', async ($, e, next) => {
    await syncAgents($)

    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await syncAgents($)

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    const mode = typeof e.permission_mode === 'string' ? e.permission_mode : null
    const effort = typeof e.effort?.level === 'string' ? e.effort.level : null
    await update($, state, prev => ({ ...prev, mode: mode ?? prev.mode, effort: effort ?? prev.effort }))

    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const mode = typeof e.permission_mode === 'string' ? e.permission_mode : null
    const effort = typeof e.effort?.level === 'string' ? e.effort.level : null
    await update($, state, prev => ({ ...prev, mode: mode ?? prev.mode, effort: effort ?? prev.effort }))

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') transcriptPath = e.transcript_path

    return next(e)
  })

  // turn.step streams: the hook is a generator that passes the chunks through.
  on('turn.step', async function* ($, e, next) {
    await update($, state, prev => ({
      ...prev,
      model: modelLabel(e.model),
      effort: e.effort === undefined ? null : String(e.effort),
    }))

    const result = yield* next(e)
    // The main loop's request just wrote or read the prompt cache: it stays warm a TTL from now.
    if ((e as { agentId?: string }).agentId === undefined) {
      const respondedAt = Date.now()
      await update($, state, prev => ({ ...prev, respondedAt }))
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, state, prev => ({ ...prev, ...fromUsage(prev, e) }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // This build carries a tool's arguments on `e` itself; an older one carried them under `input`.
    const input = ((e as { input?: unknown }).input ?? e) as Record<string, unknown>
    const subject = subjectOf(e.tool, input)
    const entry: Activity = { id: e.tool_use_id, tool: e.tool, subject, ms: null }
    const isAgent = e.tool === 'Agent'

    // The plan is the tool's own payload, so the pane shows it as Claude writes it.
    const todos = e.tool === 'TodoWrite' ? todosOf(input) : null

    await update($, state, prev => ({
      ...prev,
      ...(todos === null ? {} : { todos }),
      ...(isAgent ? { agents: [...prev.agents, entry].slice(-AGENTS_KEPT) } : {}),
    }))

    // Only the main loop's calls set the activity; a subagent's are its own business.
    const isMain = (e as { agentId?: string }).agentId === undefined
    const what = shortText(aboutCall(e.tool, subject), 40)
    if (isMain && !isAgent) await act($, activityOfTool(e.tool))

    const startedAt = await $.clock.now()
    const result = await next(e)
    const ms = (await $.clock.now()) - startedAt

    if (isMain && !isAgent) {
      if (result.isError === true) {
        const failed = what === '' ? e.tool : what
        await moveMascot($, value => ({ ...value, activity: 'alert', failures: [...value.failures, failed] }))
      } else {
        await act($, 'thinking')
      }
    }

    if (isAgent) {
      await syncAgents($)
      await update($, state, prev => ({
        ...prev,
        agents: prev.agents.map(one => (one.id === entry.id ? { ...one, ms } : one)),
      }))
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ending says nothing about the main one.
    if ((e as { agentId?: string }).agentId === undefined) {
      const now = await $.clock.now()
      const was = mascotDefaults(await read($, mascot))
      const isLong = was.turnStartedAt !== null && now - was.turnStartedAt >= CHIME_AFTER_MS
      const failed = was.failures.length

      await moveMascot($, value => ({
        ...value,
        activity: failed > 0 ? 'alert' : 'done',
        turnStartedAt: null,
      }))

      // Attention drifts during a long turn: say it is over, out loud and on screen.
      if (isLong) {
        chime($)
        $.ui.toast(failed > 0 ? `⚠ Finished, ${failed} failed — your turn` : '✓ Done — your turn')
      }
    }

    const turns = await $.session.turns().catch(() => null)
    await update($, state, prev => ({ ...prev, turns }))

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // The mobile app draws no field yet: there the notes are shown, not edited.
    const Input = 'Input' in elements ? elements.Input : null
    const now = Date.now()
    const it = withDefaults(await read($, state))
    // The gutter comes out of the width, so every block still fits on one line.
    const outer = Math.max(24, (e.props.bodyColumns ?? 32) - GUTTER)
    // What a block holds: its border and a column of padding come off each side.
    const columns = outer - BLOCK_INSET
    const rows = Math.max(8, e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24)

    const open = it.todos.filter(one => one.status !== 'completed')
    const doneCount = it.todos.length - open.length

    // The context-rollover mod's shared state. Reading it here subscribes the pane, so
    // each write that mod makes redraws it; the cockpit itself only observes.
    const rolled = await $.state.get({ plugin: 'context-rollover', key: 'status' }).catch(() => undefined)
    const rollover = rolloverView(rolled?.value, now, columns)
    const rolloverRows = rollover.kind === 'unavailable' ? 3 : rollover.rows.length + 2

    // The shimmer's frame. Reading it subscribes the pane, so the bar moves while work does.
    const m = mascotDefaults(await read($, mascot))

    const isArmed = (action: string): boolean =>
      it.armed !== null && it.armed.action === action && now - it.armed.at <= ARM_MS
    const actionLabel = (action: string): string => {
      if (isArmed(action)) return `${action}?`
      if (action === 'compact' && (it.context ?? 0) >= COMPACT_AT) return 'compact ⚠'

      return action
    }

    /**
     * A block: a rounded frame in its own colour, the title set into the top edge,
     * `╭─ TITLE 3 ───╮`. Every line of the frame is text the cockpit draws itself, so it
     * looks the same on any surface. `rows` are one line each (or `body`, one element); `height` pins the body to
     * that many lines (a list padded, a diff cut), and `extra` (a button) follows the
     * title on the top edge, `extraWidth` columns wide.
     */
    const Section = ({
      id,
      title,
      count,
      color,
      rows: lines = [],
      body,
      height,
      extra,
      extraWidth = 0,
    }: {
      id: string
      title: string
      count?: number | string
      color: string
      rows?: RenderChildren[]
      body?: RenderChildren
      height?: number
      extra?: RenderChildren
      extraWidth?: number
    }) => {
      const label = shortText(title, Math.max(4, outer - 8 - extraWidth))
      const tail = count === undefined ? '' : ` ${count}`
      const fill = Math.max(1, outer - 5 - label.length - tail.length - extraWidth)
      const n = Math.max(1, height ?? lines.length)
      const side = (glyph: string) => Array.from({ length: n }, () => glyph).join('\n')

      return (
        <Box key={`block-${id}`} flexDirection="column" width={outer} flexShrink={0}>
          <Box height={1}>
            <Text color={color}>{'╭─ '}</Text>
            <Text color={color} bold>
              {label}
            </Text>
            {tail !== '' && <Text color={TOKYO.dim}>{tail}</Text>}
            {extra}
            <Text color={color}>{` ${'─'.repeat(fill)}╮`}</Text>
          </Box>
          <Box height={n}>
            <Text color={color}>{side('│ ')}</Text>
            <Box flexDirection="column" width={columns} height={n} overflow="hidden">
              {body ??
                lines.map((line, index) => (
                  <Box key={`${id}-${index}`} height={1} overflow="hidden">
                    {line}
                  </Box>
                ))}
            </Box>
            <Text color={color}>{side(' │')}</Text>
          </Box>
          <Text color={color}>{`╰${'─'.repeat(outer - 2)}╯`}</Text>
        </Box>
      )
    }

    /** What a block shows, the rows a condition left out dropped. */
    const only = (...items: RenderChildren[]): RenderChildren[] =>
      items.filter(item => item !== false && item !== null && item !== undefined)

    const Meter = ({
      label,
      percent,
      resetsAt,
      note,
    }: {
      label: string
      percent: number
      resetsAt?: string | null
      note?: string
    }) => {
      const left = until(resetsAt ?? null, now)

      return (
        <Box>
          <Text color={TOKYO.dim}>{label.padEnd(5)}</Text>
          <Text color={heatOf(percent)}>
            {bar(percent)} {`${Math.round(percent)}%`.padStart(4)}
          </Text>
          {note !== undefined && <Text color={TOKYO.dim}> {note}</Text>}
          {left !== null && <Text color={TOKYO.dim}> ↻ {left}</Text>}
        </Box>
      )
    }

    const contextRows: RenderChildren[] =
      it.context === null
        ? [<Text color={TOKYO.dim}>ctx   waiting for the first response</Text>]
        : [
            <Box>
              {Meter({
                label: 'ctx',
                percent: it.context,
                note: it.tokens === null || it.window === null ? undefined : `${kilo(it.tokens)}/${kilo(it.window)}`,
              })}
              <Button
                key="ctx"
                plain
                label={it.contextRows === null ? ' ▸' : ' ▾'}
                onPress={async () => {
                  const isOpen = withDefaults(await read($, state)).contextRows !== null
                  const rows = isOpen ? null : await readContextRows($)
                  await update($, state, prev => ({ ...prev, contextRows: rows }))
                }}
              />
            </Box>,
            ...(it.contextRows ?? []).slice(0, 8).map((row, index) => (
              <Box>
                <Text color={TOKYO.dim}>{'  '}</Text>
                <Text color={ROW_COLOURS[index % ROW_COLOURS.length] ?? TOKYO.blue}>
                  {bar(it.window === null ? 0 : (row.tokens / it.window) * 100, 3)}
                </Text>
                <Text color={TOKYO.text}> {shortText(row.name, Math.max(6, columns - 14))}</Text>
                <Text color={TOKYO.dim}> {kilo(row.tokens)}</Text>
              </Box>
            )),
          ]

    const usageRows = only(
      ...contextRows,
      it.fiveHour !== null && Meter({ label: '5h', percent: it.fiveHour.percent, resetsAt: it.fiveHour.resetsAt }),
      it.sevenDay !== null && Meter({ label: 'week', percent: it.sevenDay.percent, resetsAt: it.sevenDay.resetsAt }),
    )

    // The notes take every row the other blocks leave: each block is its rows and two of frame.
    const planRows = it.todos.length > 0 ? Math.min(open.length, PLAN_SHOWN) + 2 : 0
    const agentRows = it.agents.length > 0 ? Math.min(it.agents.length, 3) + 2 : 0
    const fixed = 4 + (usageRows.length + 2) + rolloverRows + planRows + agentRows + 3 + 3
    const noteRows = Math.max(3, rows - fixed - 2)

    // The progress line: context fill as a purple shimmer, turning to heat once a rollover nears.
    const cache = cacheView(it.respondedAt, now, cacheTtlMs)
    const cacheText =
      cache === null ? '' : cache.isWarm ? `☕ warm ${cache.left}` : '🧊 cold · start fresh'
    const cacheColour =
      cache === null ? TOKYO.dim : !cache.isWarm ? TOKYO.blue : cache.leftMs < 5 * 60_000 ? TOKYO.yellow : TOKYO.green
    const percent = it.context ?? 0
    const isNear =
      rollover.kind !== 'unavailable' && it.tokens !== null
        ? it.tokens >= rollover.status.thresholds.soft
        : percent >= COMPACT_AT
    // The figures take ` 37% · ` beside the cache text; a spare column covers a wide emoji.
    const cells = shimmer(percent, Math.max(6, columns - cacheText.length - 9), m.frame)

    return (
      <Box flexDirection="column" height={rows} paddingLeft={GUTTER}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {Section({
            id: 'session',
            title: 'SESSION',
            count: it.turns === null ? undefined : `${it.turns} turns`,
            color: BLOCK.session,
            rows: [
              <Text color={TOKYO.text} bold>
                {shortText(it.project ?? 'claude', columns)}
              </Text>,
              <Box>
                <Button
                  key="model"
                  plain
                  label={`${it.model ?? 'model'} ▾`}
                  onPress={() => runCommand($, 'model')}
                />
                <Text color={TOKYO.dim}> · </Text>
                <Button
                  key="effort"
                  plain
                  label={`${it.effort === null ? 'effort' : effortLabel(it.effort)} ▾`}
                  onPress={() => runCommand($, 'effort')}
                />
                {it.mode !== null && <Text color={TOKYO.accent}> · {footerMode(it.mode)}</Text>}
              </Box>,
            ],
          })}

          {Section({
            id: 'usage',
            title: 'USAGE',
            color: BLOCK.usage,
            rows: usageRows,
          })}

          {Section({
            id: 'rollover',
            title: 'CONTEXT ROLLOVER',
            color: BLOCK.rollover,
            rows:
              rollover.kind === 'unavailable'
                ? [
                    <Box>
                      <Text color={TOKYO.dim}>{labelOf('Status', columns)}</Text>
                      <Text color={TOKYO.dim}>UNAVAILABLE</Text>
                    </Box>,
                    <Text color={TOKYO.dim}>{shortText(rollover.reason, columns)}</Text>,
                  ]
                : rollover.rows.map(row => (
                    <Box>
                      <Text color={TOKYO.dim}>{labelOf(row.label, columns)}</Text>
                      {row.bar !== undefined && <Text color={row.bar.color}>{rolloverBar(row.bar.percent)} </Text>}
                      <Text color={row.color}>{row.value}</Text>
                    </Box>
                  )),
          })}

          {it.todos.length > 0 &&
            Section({
              id: 'plan',
              title: 'PLAN',
              count: `${doneCount}/${it.todos.length}`,
              color: BLOCK.plan,
              rows: open.slice(0, PLAN_SHOWN).map(todo => (
                <Box>
                  <Text color={todo.status === 'in_progress' ? TOKYO.orange : TOKYO.dim}>
                    {todo.status === 'in_progress' ? '▸ ' : '· '}
                  </Text>
                  <Text color={todo.status === 'in_progress' ? TOKYO.text : TOKYO.dim}>
                    {shortText(todo.content, Math.max(6, columns - 3))}
                  </Text>
                </Box>
              )),
            })}

          {Section({
            id: 'notes',
            title: 'NOTES',
            color: BLOCK.notes,
            height: noteRows,
            body:
              Input === null ? (
                <Text color={TOKYO.text}>{it.notes}</Text>
              ) : (
                <Input
                  key="notes"
                  rows={noteRows}
                  value={it.notes}
                  placeholder="jot anything…"
                  submitLabel="save"
                  onInput={(value: string) => saveNotes($, it.cwd, value)}
                  onSubmit={(value: string) => saveNotes($, it.cwd, value)}
                />
              ),
          })}

          {/* Last before the progress line, so the work under way sits beside the context it uses. */}
          {it.agents.length > 0 &&
            Section({
              id: 'agents',
              title: 'AGENTS',
              count: it.agents.filter(one => one.ms === null).length,
              color: BLOCK.agents,
              rows: it.agents.slice(-3).map(agent => (
                <Box>
                  <Text color={agent.ms === null ? TOKYO.orange : TOKYO.dim}>
                    {agent.ms === null ? '⟳ ' : '· '}
                  </Text>
                  <Text color={TOKYO.text}>{shortText(agent.subject, Math.max(4, columns - 3))}</Text>
                </Box>
              )),
            })}
        </Box>

        {Section({
          id: 'progress',
          title: 'CONTEXT',
          color: BLOCK.progress,
          rows: [
            <Box key="progress" height={1}>
              {cells.map((cell, index) => (
                <Text key={`cell-${index}`} color={cell.color === null ? TOKYO.line : isNear ? heatOf(percent) : cell.color}>
                  {cell.char}
                </Text>
              ))}
              <Text color={isNear ? heatOf(percent) : TOKYO.accent}> {`${Math.round(percent)}%`}</Text>
              {cacheText !== '' && <Text color={TOKYO.dim}> · </Text>}
              {cacheText !== '' && <Text color={cacheColour}>{cacheText}</Text>}
            </Box>,
          ],
        })}

        {Section({
          id: 'actions',
          title: 'ACTIONS',
          color: BLOCK.actions,
          rows: [
            <Box>
              {QUICK_ACTIONS.map((action, index) => (
                <Box key={`action-row-${action}`}>
                  {index > 0 && <Text color={TOKYO.dim}> · </Text>}
                  <Button
                    key={`action-${action}`}
                    plain
                    label={actionLabel(action)}
                    onPress={() => pressAction($, action)}
                  />
                </Box>
              ))}
            </Box>,
          ],
        })}
      </Box>
    )
  })

  // Subagents at work, one row each above the prompt: a ⟳ in the shimmer and how long it
  // has run. Gone once none run. Reading that state subscribes, so the frame moves it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = mascotDefaults(await read($, mascot))
    if (m.agents.length === 0 || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(20, (e.viewport?.columns ?? 80) - 4)
    const now = Date.now()

    return (
      <Box flexDirection="column">
        {m.agents.map((agent, index) => {
          const time = agent.at === undefined ? '' : ` ${spoken(now - agent.at)}`
          return (
            <Box key={agent.id}>
              {/* Each agent sits at its own point of the shimmer, so they pulse out of step. */}
              <Text color={SHIMMER[(m.frame + index * 3) % SHIMMER.length] ?? TOKYO.orange}>⟳ </Text>
              <Text color={TOKYO.text}>{shortText(agent.label, width - time.length)}</Text>
              <Text color={TOKYO.dim}>{time}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })

  // Questions the reply puts to you, marked so they are not lost at the end of a long
  // answer. Only the drawing changes; the stored message is left alone.
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const text = emphasizeQuestions(e.props.text)

    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  // A failed tool call, loud: what failed, and the first lines of why. Calls that worked
  // keep the engine's own row.
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    if (!e.props.isErrored || e.props.isRunning) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const input = (typeof e.props.input === 'object' && e.props.input !== null ? e.props.input : {}) as Record<string, unknown>
    const what = aboutCall(e.props.tool, subjectOf(e.props.tool, input))
    const why = errorLines(e.props.output)
    const width = Math.max(20, (e.viewport?.columns ?? 80) - 6)

    return (
      <Box flexDirection="column">
        <Text color={TOKYO.red} bold>
          ✗ {e.props.tool} failed{what === '' ? '' : ` · ${shortText(what, width - 16)}`}
        </Text>
        {why.map((reason, index) => (
          <Box key={`why-${index}`}>
            <Text color={TOKYO.red}>{`  ${shortText(reason, width)}`}</Text>
          </Box>
        ))}
      </Box>
    )
  })

  // The end of each turn, made easy to find when scrolling back: a loud line in place of
  // the engine's quiet "Baked for 3m 12s".
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color={TOKYO.line}>{'━━━ '}</Text>
        <Text color={TOKYO.green} bold>
          ✓ done in {spoken(e.props.durationMs)}
        </Text>
        <Text color={TOKYO.line}>{' ━━━'}</Text>
      </Box>
    )
  })
}
