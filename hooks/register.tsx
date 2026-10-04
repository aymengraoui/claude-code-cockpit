import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Cockpit, ContextRow, OpenDiff, Past, Repo, Todo } from '../types'
import {
  bar,
  kilo,
  footerMode,
  modelLabel,
  shortPath,
  shortText,
  toPosix,
  until,
} from './lib/format'
import { capDiff, parseNumstat, parseStatus, relativeTo, withCounts } from './lib/git'
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
/** `$.store` key holding the repository last worked in, for a launch outside any repo. */
const REPO = 'cockpit.repoDir'
/** How long a press that wants confirming stays armed. */
const ARM_MS = 4000
/** The quick actions, each the engine's own command; the one that discards comes last. */
const QUICK_ACTIONS = ['compact', 'rewind', 'resume', 'clear'] as const
/** Context fill at which compacting is offered as the thing to do next. */
const COMPACT_AT = 85
/** Colours the context breakdown's rows take in turn. */
const ROW_COLOURS = [TOKYO.blue, TOKYO.accent, TOKYO.cyan, TOKYO.green, TOKYO.yellow, TOKYO.orange]
/** How often the pane's clocks and figures are refreshed while it is open. */
const TICK_MS = 2000

const EMPTY: Cockpit = {
  model: null,
  effort: null,
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
  diff: null,
  contextRows: null,
  armed: null,
}

const state = atom({ plugin: 'cockpit', key: 'state' } as const, EMPTY)

/**
 * The state with every field present, whatever version wrote it.
 *
 * `$.state` outlives a reload, so a new version reads what an older one stored — without
 * the fields it added. Drawn as stored, the first of them (`diff`, read as undefined, not
 * null) threw and left the pane blank. Every read goes through this, and the start of a
 * session writes it back once.
 */
export const withDefaults = (stored: Partial<Cockpit> | null | undefined): Cockpit => {
  const value = { ...EMPTY, ...(stored ?? {}) }

  for (const key of Object.keys(EMPTY) as (keyof Cockpit)[]) {
    if (value[key] === undefined) (value as Record<string, unknown>)[key] = EMPTY[key]
  }
  if (value.repo !== null && typeof value.repo.root !== 'string') {
    value.repo = { ...value.repo, root: '' }
  }

  return value
}

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

/** Runs git, answering its output on success and '' on anything else. */
const runGit = async ($: EngineInterface, argv: readonly string[], ok = [0]): Promise<string> => {
  try {
    const result = await $.process.run(['git', ...argv])

    return ok.includes(result.exitCode) ? result.stdout : ''
  } catch {
    return ''
  }
}

/** The repository a directory sits in, POSIX-spelled; '' outside one. */
const rootOf = async ($: EngineInterface, dir: string): Promise<string> =>
  dir === '' ? '' : toPosix((await runGit($, ['-C', dir, 'rev-parse', '--show-toplevel'])).trim())

/**
 * The repository the pane shows. The session's directory when it is one; otherwise the
 * one the session last wrote a file in — a session started in a home directory still
 * works in a repository, and that is the one worth showing.
 */
let repoDir = ''

/** Re-read the working tree: two read-only git calls, or null with no repository. */
const readRepo = async ($: EngineInterface): Promise<Repo | null> => {
  if (repoDir === '') return null

  const status = await runGit($, ['-C', repoDir, 'status', '--porcelain=v2', '--branch'])
  if (status === '') return null
  const numstat = await runGit($, ['-C', repoDir, 'diff', 'HEAD', '--numstat'])

  return {
    ...withCounts(parseStatus(status), parseNumstat(numstat), relativeTo(repoDir, mine)),
    root: repoDir,
  }
}

/**
 * Point the pane at the repository a written file sits in, when it is a different one.
 * Remembered, so the next launch outside any repository opens on it.
 */
const followRepo = async ($: EngineInterface, file: string): Promise<void> => {
  const root = await rootOf($, file.split('/').slice(0, -1).join('/'))
  if (root === '' || root === repoDir) return

  repoDir = root
  await $.store.set(REPO, root).catch(() => undefined)
  const repo = await readRepo($)
  await update($, state, prev => ({ ...prev, repo, isRepoChecked: true }))
}

/** A file's diff against HEAD; an untracked file is shown as it stands. */
const openDiff = async ($: EngineInterface, root: string, path: string, isUntracked: boolean): Promise<void> => {
  let diff: OpenDiff
  if (isUntracked) {
    const text = await $.fs.read(`${root}/${path}`).catch(() => '')
    diff = { path, source: capDiff(text === '' ? '(empty, or unreadable)' : text), format: 'source' }
  } else {
    const text = await runGit($, ['-C', root, 'diff', 'HEAD', '--', path])
    diff = { path, source: capDiff(text === '' ? '(no changes against HEAD)' : text), format: 'diff' }
  }
  await update($, state, prev => ({ ...prev, diff }))
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

export const register: Register = on => {
  /** The transcript directory for this project, once anything has named it. */
  let dir = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cockpit', description: 'Open the cockpit pane' })
    await update($, state, prev => withDefaults(prev))

    // At launch no event has fired yet, so every figure the engine already holds is
    // asked for here rather than waited on. This runs again on each reload.
    const [now, cwd, id, usage, model, turns, storedDir, storedRepo] = await Promise.all([
      $.clock.now(),
      $.session.cwd().catch(() => ''),
      $.session.id().catch(() => ''),
      $.session.usage().catch(() => null),
      $.session.model().catch(() => null),
      $.session.turns().catch(() => null),
      rememberedDir($),
      $.store.get(REPO).catch(() => null),
    ])

    repoDir = (await rootOf($, cwd)) || (typeof storedRepo === 'string' ? storedRepo : '')
    const repo = await readRepo($)

    const segments = toPosix(cwd).split('/').filter(one => one !== '')
    await update($, state, prev => ({
      ...prev,
      ...(usage === null ? {} : fromUsage(prev, usage)),
      project: segments.at(-1) ?? null,
      cwd: cwd === '' ? null : toPosix(cwd),
      sessionId: id === '' ? null : id,
      model: model === null ? prev.model : modelLabel(model),
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
    if (typeof e.permission_mode === 'string') {
      const mode = e.permission_mode
      await update($, state, prev => ({ ...prev, mode }))
    }
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') {
      transcriptPath = e.transcript_path
      const named = dirOf(e.transcript_path)
      if (named !== dir) {
        dir = named
        await $.store.set(DIR, named).catch(() => undefined)
      }
    }

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

    if (WRITERS.has(e.tool) && subject !== '') {
      mine.add(toPosix(subject))
      await followRepo($, toPosix(subject))
    }

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
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const now = Date.now()
    const it = withDefaults(await read($, state))
    const columns = Math.max(24, e.props.bodyColumns ?? 32)
    const rows = Math.max(8, e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24)

    const changes = it.repo?.changes ?? []
    const open = it.todos.filter(one => one.status !== 'completed')
    const doneCount = it.todos.length - open.length

    // The lists share what is left under the fixed rows; each keeps at least two.
    const listRoom = Math.max(3, Math.floor((rows - 18) / 2))
    const rule = '─'.repeat(columns)
    const repoName = shortText(it.repo?.root.split('/').at(-1) ?? '', Math.max(6, Math.floor(columns / 2)))
    const isArmed = (action: string): boolean =>
      it.armed !== null && it.armed.action === action && now - it.armed.at <= ARM_MS
    const actionLabel = (action: string): string => {
      if (isArmed(action)) return `${action}?`
      if (action === 'compact' && (it.context ?? 0) >= COMPACT_AT) return 'compact ⚠'

      return action
    }
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

    if (it.diff !== null) {
      const { path, source, format } = it.diff

      return (
        <Box flexDirection="column" height={rows}>
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            <Text color={TOKYO.text}>{shortPath(path, Math.max(8, columns))}</Text>
            <Text color={TOKYO.line}>{rule}</Text>
            <Code source={source} path={path} format={format} wrap="truncate-end" />
          </Box>
          <Text color={TOKYO.line}>{rule}</Text>
          <Button
            key="diff-close"
            plain
            label="← back"
            onPress={() => update($, state, prev => ({ ...prev, diff: null }))}
          />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" height={rows}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
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
          </Box>

          <Text color={TOKYO.line}>{rule}</Text>

          {it.context === null ? (
            <Text color={TOKYO.dim}>ctx   waiting for the first response</Text>
          ) : (
            <Box flexDirection="column">
              <Box>
                {Meter({
                  label: 'ctx',
                  percent: it.context,
                  note:
                    it.tokens === null || it.window === null
                      ? undefined
                      : `${kilo(it.tokens)}/${kilo(it.window)}`,
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
              </Box>
              {it.contextRows !== null &&
                it.contextRows.slice(0, 8).map((row, index) => (
                  <Box key={`ctx-row-${row.name}`}>
                    <Text color={TOKYO.dim}>{'  '}</Text>
                    <Text color={ROW_COLOURS[index % ROW_COLOURS.length] ?? TOKYO.blue}>
                      {bar(it.window === null ? 0 : (row.tokens / it.window) * 100, 3)}
                    </Text>
                    <Text color={TOKYO.text}> {shortText(row.name, Math.max(6, columns - 14))}</Text>
                    <Text color={TOKYO.dim}> {kilo(row.tokens)}</Text>
                  </Box>
                ))}
            </Box>
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
                <Text color={TOKYO.text}>{repoName}</Text>
                <Text color={TOKYO.dim}> · </Text>
                <Text color={TOKYO.blue}>
                  {shortText(it.repo.branch ?? 'detached', Math.max(8, columns - repoName.length - 8))}
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
                  <Button
                    key={`diff-${change.path}`}
                    plain
                    label={shortPath(change.path, Math.max(6, columns - 14)).padEnd(Math.max(7, columns - 13))}
                    onPress={() => openDiff($, it.repo?.root ?? '', change.path, change.status === '?')}
                  />
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

        <Text color={TOKYO.line}>{rule}</Text>
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
        </Box>
      </Box>
    )
  })
}
