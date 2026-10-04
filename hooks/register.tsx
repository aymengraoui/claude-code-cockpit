import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Cockpit, Past, Repo, Todo } from '../types'
import {
  bar,
  kilo,
  modelLabel,
  modeLabel,
  shortPath,
  shortText,
  toPosix,
  until,
} from './lib/format'
import { parseNumstat, parseStatus, withCounts } from './lib/git'
import { subjectOf, todosOf } from './lib/tools'
import {
  dirOf,
  MAX_READ_BYTES,
  pickRecent,
  resumeCommand,
  titleFromTranscript,
  toPast,
} from './lib/sessions'
import { isWindowsPath, launchCommands } from './lib/launch'
import { heatOf, TOKYO } from './lib/palette'
import { fromUsage } from './lib/usage'

const PANE = 'cockpit'

/** `$.store` key holding transcript titles, which never change once written. */
const TITLES = 'cockpit.titles'
/** `$.store` key holding the transcript directory, so a reload knows it before any prompt. */
const DIR = 'cockpit.transcriptDir'
const SESSIONS_LISTED = 8
/** How often the pane's clocks and figures are refreshed while it is open. */
const TICK_MS = 2000

const EMPTY: Cockpit = {
  model: null,
  effort: null,
  models: [],
  isPickerOpen: false,
  mode: null,
  project: null,
  cwd: null,
  sessionId: null,
  turns: null,
  context: null,
  tokens: null,
  window: null,
  fiveHour: null,
  sevenDay: null,
  repo: null,
  isRepoChecked: false,
  todos: [],
  agents: [],
  history: [],
  tickedAt: null,
}

const state = atom({ plugin: 'cockpit', key: 'state' } as const, EMPTY)

/** Tools whose calls change files, so the path is worth marking as this session's. */
const WRITERS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

/** Paths this session wrote to. Rebuilt on reload, which only dims the dots. */
const mine = new Set<string>()

const AGENTS_KEPT = 12

/** The titles read so far, by session id; they never change, so they are cached for good. */
const readTitles = async ($: EngineInterface): Promise<Record<string, string>> => {
  try {
    const stored = await $.store.get(TITLES)
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}

    return Object.fromEntries(
      Object.entries(stored as Record<string, unknown>).filter(
        (pair): pair is [string, string] => typeof pair[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

/**
 * Claude Code's own recent sessions, from the transcripts beside this session's.
 *
 * Each transcript is read at most once ever: its first prompt cannot change, so the
 * title goes into `$.store` and later listings only stat the directory.
 */
const readSessions = async ($: EngineInterface, dir: string): Promise<Past[]> => {
  if (dir === '') return []

  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }

  const recent = pickRecent(entries, SESSIONS_LISTED)
  const titles = await readTitles($)
  let isNew = false

  for (const entry of recent) {
    const id = entry.name.replace(/\.jsonl$/, '')
    if (titles[id] !== undefined || entry.size > MAX_READ_BYTES) continue

    try {
      const title = titleFromTranscript(await $.fs.read(`${dir}/${entry.name}`))
      if (title !== null) {
        titles[id] = title
        isNew = true
      }
    } catch {
      // A transcript being written, or gone: it is listed by its id instead.
    }
  }

  if (isNew) await $.store.set(TITLES, titles).catch(() => undefined)

  return recent.map(entry => toPast(entry, titles[entry.name.replace(/\.jsonl$/, '')] ?? null))
}

/** Re-read the working tree: two read-only git calls, or null outside a repo. */
const readRepo = async ($: EngineInterface): Promise<Repo | null> => {
  const run = async (argv: readonly string[]): Promise<string> => {
    try {
      const result = await $.process.run(argv)

      return result.exitCode === 0 ? result.stdout : ''
    } catch {
      return ''
    }
  }

  const status = await run(['git', 'status', '--porcelain=v2', '--branch'])
  if (status === '') return null
  const numstat = await run(['git', 'diff', 'HEAD', '--numstat'])

  return withCounts(parseStatus(status), parseNumstat(numstat), mine)
}

/** The transcript directory, from the store when a classic hook has not named it yet. */
const rememberedDir = async ($: EngineInterface): Promise<string> => {
  try {
    const stored = await $.store.get(DIR)

    return typeof stored === 'string' ? stored : ''
  } catch {
    return ''
  }
}

/**
 * Open a session in a terminal of its own, falling back to the clipboard.
 *
 * Nothing about the person's setup is assumed: the candidates are tried in order and
 * a click that finds no terminal still leaves them the command.
 */
const openSession = async (
  $: EngineInterface,
  id: string,
  cwd: string,
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile',
): Promise<void> => {
  const command = resumeCommand(id)
  // The transcript's path always says which platform this is; a cwd may not be known yet.
  const isWindows = isWindowsPath(transcriptPath === '' ? cwd : transcriptPath)

  for (const argv of launchCommands(id, cwd, isWindows)) {
    try {
      const ran = await $.process.run(argv)
      if (ran.exitCode === 0) {
        $.ui.toast(`Opening ${id.slice(0, 8)} in a new terminal`)

        return
      }
    } catch {
      // That terminal is not on this machine; the next candidate may be.
    }
  }

  const copied = await $.ui.copy({ text: command, surface }).catch(() => ({ isCopied: false }))
  $.ui.toast(copied.isCopied ? `Copied: ${command}` : `Run it yourself: ${command}`)
}

/** The models the /config menu offers, which is exactly what this account may pick. */
const readModels = async ($: EngineInterface): Promise<string[]> => {
  try {
    const row = (await $.config.list()).find(one => one.key === 'model')
    const options = row?.options

    return options === undefined ? [] : [...options]
  } catch {
    return []
  }
}

/**
 * Switch the session's model, as choosing it in `/config` would.
 *
 * The row is a managed one, so the engine may refuse a plugin's write; a refusal is
 * reported rather than swallowed, with the command that does work by hand.
 */
const chooseModel = async ($: EngineInterface, value: string): Promise<void> => {
  try {
    const result = await $.config.set({ key: 'model', value })
    $.ui.toast(
      'deny' in result && result.deny !== undefined
        ? `Claude Code would not switch it: ${result.deny}. Try /model ${value}`
        : `Model set to ${value}`,
    )
  } catch (error) {
    $.ui.toast(`Could not switch the model — try /model ${value}`)
  }
}

/** This session's transcript, which says which platform this is. */
let transcriptPath = ''

/**
 * The permission mode, as the footer is drawing it this instant.
 *
 * No event fires when the mode is toggled, and the transcript only records it at a turn
 * boundary, so the one live source is the hint line under the prompt: it redraws the moment
 * shift+tab is pressed. A `ui.render` hook may not write `$.state` while drawing, so the
 * mode is kept here and the pane reads it on its next tick.
 */
let liveMode: string | null = null

/** The engine's own words for a mode, as the hint line spells them. */
const MODE_IN_HINT: ReadonlyArray<readonly [RegExp, string]> = [
  [/auto mode on/i, 'auto'],
  [/plan mode on/i, 'plan'],
  [/accept edits on/i, 'acceptEdits'],
  [/bypass(ing)? permissions/i, 'bypassPermissions'],
]

/** The mode a hint line names, or `default` when it names none. */
export const modeInHint = (hint: string): string => {
  for (const [pattern, mode] of MODE_IN_HINT) if (pattern.test(hint)) return mode

  return 'default'
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

        const usage = await $.session.usage().catch(() => null)
        await update($, state, prev => ({
          ...prev,
          ...(usage === null ? {} : fromUsage(prev, usage)),
          mode: liveMode ?? prev.mode,
          tickedAt: Date.now(),
        }))
      }
    } finally {
      isTicking = false
    }
  })()
}

export const register: Register = on => {
  /** The transcript directory for this project, once anything has named it. */
  let dir = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cockpit', description: 'Open the cockpit pane' })

    // At launch no event has fired yet, so every figure the engine already holds is
    // asked for here rather than waited on. This runs again on each reload.
    const [now, cwd, id, usage, model, turns, repo, storedDir, models] = await Promise.all([
      $.clock.now(),
      $.session.cwd().catch(() => ''),
      $.session.id().catch(() => ''),
      $.session.usage().catch(() => null),
      $.session.model().catch(() => null),
      $.session.turns().catch(() => null),
      readRepo($),
      rememberedDir($),
      readModels($),
    ])

    const segments = toPosix(cwd).split('/').filter(one => one !== '')
    await update($, state, prev => ({
      ...prev,
      ...(usage === null ? {} : fromUsage(prev, usage)),
      project: segments.at(-1) ?? null,
      cwd: cwd === '' ? null : toPosix(cwd),
      sessionId: id === '' ? null : id,
      model: model === null ? prev.model : modelLabel(model),
      models,
      turns: turns ?? prev.turns,
      repo,
      isRepoChecked: true,
    }))

    // A reload, or a session opened before any prompt, still has a directory to list.
    if (storedDir !== '') {
      dir = storedDir
      const history = await readSessions($, storedDir)
      await update($, state, prev => ({ ...prev, history }))
    }

    // Opened unasked, the pane seats itself only once the terminal is wide enough.
    void $.ui.open({ id: PANE, title: 'cockpit' })
    startTicking($)

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
    const mode = typeof e.permission_mode === 'string' ? e.permission_mode : null
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') {
      transcriptPath = e.transcript_path
      const named = dirOf(e.transcript_path)
      if (named !== dir) {
        dir = named
        await $.store.set(DIR, named).catch(() => undefined)
      }
    }
    await update($, state, prev => ({ ...prev, mode: mode ?? prev.mode }))

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    const mode = typeof e.permission_mode === 'string' ? e.permission_mode : null
    if (mode !== null) await update($, state, prev => ({ ...prev, mode }))

    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const mode = typeof e.permission_mode === 'string' ? e.permission_mode : null
    if (mode !== null) await update($, state, prev => ({ ...prev, mode }))

    return next(e)
  })

  // The classic inputs carry this session's transcript_path, and Claude Code keeps every
  // session's transcript beside it — so the list is its sessions, not the mod's bookkeeping.
  on('classic.SessionStart', async ($, e, next) => {
    const path = typeof e.transcript_path === 'string' ? e.transcript_path : ''
    if (path !== '') transcriptPath = path
    const named = path === '' ? '' : dirOf(path)
    if (named !== '') {
      dir = named
      await $.store.set(DIR, named).catch(() => undefined)
      const history = await readSessions($, named)
      await update($, state, prev => ({ ...prev, history }))
    }

    return next(e)
  })

  // The hint line redraws the instant the mode is toggled: the only live signal there is.
  // Nothing is changed here — the line is read, and the pane picks it up on its next tick.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    liveMode = modeInHint(e.props.hint ?? '')

    return next(e)
  })

  // turn.step streams: the hook is a generator that passes the chunks through.
  on('turn.step', async function* ($, e, next) {
    await update($, state, prev => ({
      ...prev,
      model: modelLabel(e.model),
      effort: e.effort === undefined ? null : String(e.effort),
    }))

    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, state, prev => ({ ...prev, ...fromUsage(prev, e) }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e.input as Record<string, unknown>
    const subject = subjectOf(e.tool, input)
    const entry: Activity = { id: e.tool_use_id, tool: e.tool, subject, ms: null, isError: null }
    const isAgent = e.tool === 'Agent'

    // The plan is the tool's own payload, so the pane shows it as Claude writes it.
    const todos = e.tool === 'TodoWrite' ? todosOf(input) : null

    await update($, state, prev => ({
      ...prev,
      ...(todos === null ? {} : { todos }),
      ...(isAgent ? { agents: [...prev.agents, entry].slice(-AGENTS_KEPT) } : {}),
    }))

    if (WRITERS.has(e.tool) && subject !== '') mine.add(toPosix(subject))

    const startedAt = await $.clock.now()
    const result = await next(e)
    const done = { ms: (await $.clock.now()) - startedAt, isError: result.isError === true }

    if (isAgent) {
      await update($, state, prev => ({
        ...prev,
        agents: prev.agents.map(one => (one.id === entry.id ? { ...one, ...done } : one)),
      }))
    }

    return result
  })

  // The working tree is re-read between turns, not per edit: one pair of git calls a turn.
  on('turn.complete', async ($, e, next) => {
    const [repo, turns, history] = await Promise.all([
      readRepo($),
      $.session.turns().catch(() => null),
      dir === '' ? Promise.resolve(null) : readSessions($, dir),
    ])
    await update($, state, prev => ({
      ...prev,
      repo,
      isRepoChecked: true,
      turns,
      history: history ?? prev.history,
    }))

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = Date.now()
    const it = await read($, state)
    const columns = Math.max(24, e.props.bodyColumns ?? 32)
    const rows = Math.max(8, e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24)

    const changes = it.repo?.changes ?? []
    const open = it.todos.filter(one => one.status !== 'completed')
    const doneCount = it.todos.length - open.length

    // The lists share what is left under the fixed rows; each keeps at least two.
    const listRoom = Math.max(3, Math.floor((rows - 18) / 2))
    const rule = '─'.repeat(columns)
    const added = changes.reduce((sum, one) => sum + one.added, 0)
    const removed = changes.reduce((sum, one) => sum + one.removed, 0)

    const Head = ({ title, count }: { title: string; count?: number | string }) => (
      <Box>
        <Text color={TOKYO.dim} bold>
          {title}
        </Text>
        {count !== undefined && <Text color={TOKYO.dim}> {count}</Text>}
      </Box>
    )

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

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={TOKYO.text} bold>
            {it.project ?? 'claude'}
          </Text>
          {it.turns !== null && <Text color={TOKYO.dim}> · {it.turns} turns</Text>}
        </Box>
        <Box>
          <Button
            key="model"
            plain
            label={`${it.model ?? 'no request yet'}${it.models.length > 0 ? ' ▾' : ''}`}
            onPress={() => update($, state, prev => ({ ...prev, isPickerOpen: !prev.isPickerOpen }))}
          />
          {it.effort !== null && <Text color={TOKYO.blue}> · {it.effort}</Text>}
          {it.mode !== null && <Text color={TOKYO.accent}> · {modeLabel(it.mode)}</Text>}
        </Box>

        {it.isPickerOpen && it.models.length === 0 && (
          <Text color={TOKYO.dim}>no models offered by /config</Text>
        )}
        {it.isPickerOpen &&
          it.models.map(option => (
            <Box key={`model-row-${option}`}>
              <Text color={TOKYO.dim}>{'  '}</Text>
              <Button
                key={`model-${option}`}
                plain
                label={option}
                onPress={async () => {
                  await chooseModel($, option)
                  await update($, state, prev => ({ ...prev, isPickerOpen: false }))
                }}
              />
            </Box>
          ))}

        <Text color={TOKYO.line}>{rule}</Text>

        {it.context === null ? (
          <Text color={TOKYO.dim}>ctx   waiting for the first response</Text>
        ) : (
          Meter({
            label: 'ctx',
            percent: it.context,
            note:
              it.tokens === null || it.window === null
                ? undefined
                : `${kilo(it.tokens)}/${kilo(it.window)}`,
          })
        )}
        {it.fiveHour !== null &&
          Meter({ label: '5h', percent: it.fiveHour.percent, resetsAt: it.fiveHour.resetsAt })}
        {it.sevenDay !== null &&
          Meter({ label: 'week', percent: it.sevenDay.percent, resetsAt: it.sevenDay.resetsAt })}
        <Text color={TOKYO.line}>{rule}</Text>
        {it.repo === null ? (
          <Text color={TOKYO.dim}>{it.isRepoChecked ? 'not a git repository' : 'reading git…'}</Text>
        ) : (
          <Box flexDirection="column">
            <Box>
              <Text color={TOKYO.blue}>
                {shortText(it.repo.branch ?? 'detached', columns - 12)}
              </Text>
              {it.repo.ahead > 0 && <Text color={TOKYO.green}> ↑{it.repo.ahead}</Text>}
              {it.repo.behind > 0 && <Text color={TOKYO.yellow}> ↓{it.repo.behind}</Text>}
            </Box>
            {Head({ title: "WORKING TREE", count: changes.length })}
            <Box>
              <Text color={TOKYO.green}>+{added}</Text>
              <Text color={TOKYO.red}> -{removed}</Text>
              <Text color={TOKYO.dim}>
                {' '}
                in {changes.length} {changes.length === 1 ? 'file' : 'files'}
              </Text>
            </Box>
            {changes.slice(0, listRoom).map(change => (
              <Box key={`change-${change.path}`}>
                <Text color={change.isMine ? TOKYO.orange : TOKYO.dim}>{change.isMine ? '●' : ' '}</Text>
                <Text color={change.status === '?' ? TOKYO.dim : TOKYO.yellow}>{change.status} </Text>
                <Text color={TOKYO.text}>
                  {shortPath(change.path, Math.max(6, columns - 14)).padEnd(
                    Math.max(7, columns - 13),
                  )}
                </Text>
                <Text color={TOKYO.green}>+{change.added}</Text>
                <Text color={TOKYO.red}> -{change.removed}</Text>
              </Box>
            ))}
          </Box>
        )}

        {it.todos.length > 0 && (
          <Box flexDirection="column">
            <Text color={TOKYO.line}>{rule}</Text>
            {Head({ title: "PLAN", count: `${doneCount}/${it.todos.length}` })}
            {open.slice(0, listRoom + 1).map((todo, index) => (
              <Box key={`todo-${index}`}>
                <Text color={todo.status === 'in_progress' ? TOKYO.orange : TOKYO.dim}>
                  {todo.status === 'in_progress' ? '▸ ' : '· '}
                </Text>
                <Text color={todo.status === 'in_progress' ? TOKYO.text : TOKYO.dim}>
                  {shortText(todo.content, Math.max(6, columns - 3))}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {it.agents.length > 0 && (
          <Box flexDirection="column">
            <Text color={TOKYO.line}>{rule}</Text>
            {Head({ title: "AGENTS", count: it.agents.filter(one => one.ms === null).length })}
            {it.agents.slice(-3).map(agent => (
              <Box key={`agent-${agent.id}`}>
                <Text color={agent.ms === null ? TOKYO.orange : TOKYO.dim}>
                  {agent.ms === null ? '⟳ ' : '· '}
                </Text>
                <Text color={TOKYO.text}>{shortText(agent.subject, Math.max(4, columns - 3))}</Text>
              </Box>
            ))}
          </Box>
        )}

        <Text color={TOKYO.line}>{rule}</Text>
        {Head({ title: "SESSIONS", count: it.history.length })}
        {it.history.length === 0 && <Text color={TOKYO.dim}>no transcripts found</Text>}
        {it.history.slice(0, 6).map(past => (
          <Box key={`past-row-${past.id}`}>
            <Text color={past.id === it.sessionId ? TOKYO.orange : TOKYO.dim}>
              {past.id === it.sessionId ? '▸ ' : '  '}
            </Text>
            <Button
              key={`past-${past.id}`}
              plain
              label={shortText(past.title, Math.max(6, columns - 3))}
              onPress={() => openSession($, past.id, it.cwd ?? '.', e.surface)}
            />
          </Box>
        ))}
        {it.history.length > 0 && (
          <Text color={TOKYO.dim}>press a session to open it in a new terminal</Text>
        )}
      </Box>
    )
  })
}
