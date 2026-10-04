import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Cockpit, Past, Repo } from '../types'
import {
  ago,
  bar,
  dur,
  heat,
  modelLabel,
  modeLabel,
  shortPath,
  shortText,
  titleOf,
  toPosix,
  until,
} from './lib/format'
import { parseNumstat, parseStatus, withCounts } from './lib/git'

const PANE = 'cockpit'

/** `$.store` key holding the session history, which outlives the session. */
const HISTORY = 'cockpit.history'
const HISTORY_KEPT = 20

const EMPTY: Cockpit = {
  model: null,
  effort: null,
  mode: null,
  history: [],
  context: null,
  fiveHour: null,
  sevenDay: null,
  costUsd: null,
  startedAt: null,
  repo: null,
  activity: [],
  agents: [],
}

const state = atom({ plugin: 'cockpit', key: 'state' } as const, EMPTY)

/** Tools whose calls change files, so the path is worth marking as this session's. */
const WRITERS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

/** Paths this session wrote to. Rebuilt on reload, which only dims the dots. */
const mine = new Set<string>()

const ACTIVITY_KEPT = 40

/** What a call is about, in one short string: the subject column of the activity list. */
export const subjectOf = (tool: string, input: Record<string, unknown>): string => {
  const first = (...keys: string[]): string => {
    for (const key of keys) {
      const value = input[key]
      if (typeof value === 'string' && value !== '') return value
    }

    return ''
  }

  if (tool === 'Bash') return first('command')
  if (tool === 'Agent') return first('description', 'prompt')
  if (tool === 'WebFetch' || tool === 'WebSearch') return first('url', 'query')

  return first('file_path', 'path', 'pattern', 'notebook_path')
}

/** The recorded sessions, newest first; anything unexpected in the store reads as none. */
const readHistory = async ($: EngineInterface): Promise<Past[]> => {
  try {
    const stored = await $.store.get(HISTORY)
    if (!Array.isArray(stored)) return []

    return stored.filter(
      (one): one is Past =>
        typeof one === 'object' &&
        one !== null &&
        typeof (one as Past).id === 'string' &&
        typeof (one as Past).startedAt === 'number',
    )
  } catch {
    return []
  }
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

export const register: Register = on => {
  /** This session's id, once a prompt has put it in the history. */
  let recordedId: string | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cockpit', description: 'Open the cockpit pane' })

    const [now, repo, history] = await Promise.all([$.clock.now(), readRepo($), readHistory($)])
    await update($, state, prev => ({ ...prev, startedAt: now, repo, history }))

    // Opened unasked, the pane seats itself only once the terminal is wide enough.
    void $.ui.open({ id: PANE, title: 'cockpit' })

    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await $.ui.open({ id: PANE, title: 'cockpit' })

    return { text: 'Cockpit pane opened.' }
  })

  // The permission mode reaches a mod only through the classic hook inputs, which carry
  // it on every prompt and every tool result — so it is read, never asked for.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const mode = typeof e.permission_mode === 'string' ? e.permission_mode : null
    await update($, state, prev => ({ ...prev, mode: mode ?? prev.mode }))

    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const mode = typeof e.permission_mode === 'string' ? e.permission_mode : null
    if (mode !== null) await update($, state, prev => ({ ...prev, mode }))

    return next(e)
  })

  // The first prompt of a session is what titles it in the history.
  on('prompt.submit', async ($, e, next) => {
    if (recordedId === null) {
      const entry: Past = {
        id: await $.session.id(),
        startedAt: await $.clock.now(),
        title: titleOf(e.text),
        costUsd: null,
      }
      recordedId = entry.id

      const history = [entry, ...(await readHistory($)).filter(one => one.id !== entry.id)].slice(
        0,
        HISTORY_KEPT,
      )
      await $.store.set(HISTORY, history)
      await update($, state, prev => ({ ...prev, history: history.filter(one => one.id !== entry.id) }))
    }

    return next(e)
  })

  // What the session cost is only final at the end, so the entry is topped up there.
  on('session.end', async ($, e, next) => {
    if (recordedId !== null) {
      const costUsd = (await read($, state)).costUsd
      const history = (await readHistory($)).map(one =>
        one.id === recordedId ? { ...one, costUsd } : one,
      )
      await $.store.set(HISTORY, history)
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
    const window = (kind: string) => {
      const found = e.rateLimits.find(one => one.kind === kind)

      return found === undefined
        ? null
        : { percent: found.percentUsed, resetsAt: found.resetsAt ?? null }
    }

    await update($, state, prev => ({
      ...prev,
      context: e.context.percent ?? prev.context,
      fiveHour: window('five_hour') ?? prev.fiveHour,
      sevenDay: window('seven_day') ?? prev.sevenDay,
      costUsd: e.cost?.usd ?? prev.costUsd,
    }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const subject = subjectOf(e.tool, e.input as Record<string, unknown>)
    const entry: Activity = {
      id: e.tool_use_id,
      tool: e.tool,
      subject,
      ms: null,
      isError: null,
    }
    const key = e.tool === 'Agent' ? 'agents' : 'activity'

    await update($, state, prev => ({
      ...prev,
      [key]: [...prev[key], entry].slice(-ACTIVITY_KEPT),
    }))

    if (WRITERS.has(e.tool) && subject !== '') mine.add(toPosix(subject))

    const startedAt = await $.clock.now()
    const result = await next(e)
    const done = { ms: (await $.clock.now()) - startedAt, isError: result.isError === true }

    await update($, state, prev => ({
      ...prev,
      [key]: prev[key].map(one => (one.id === entry.id ? { ...one, ...done } : one)),
    }))

    return result
  })

  // The working tree is re-read between turns, not per edit: one pair of git calls a turn.
  on('turn.complete', async ($, e, next) => {
    const repo = await readRepo($)
    await update($, state, prev => ({ ...prev, repo }))

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = Date.now()
    const it = await read($, state)
    const columns = Math.max(24, e.props.bodyColumns ?? 32)
    const rows = Math.max(8, e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24)

    // Two lists share what is left under the fixed rows; each keeps at least two.
    const listRoom = Math.max(2, Math.floor((rows - 14) / 2))
    const changes = it.repo?.changes ?? []
    const activity = [...it.activity].reverse()
    const rule = '─'.repeat(columns)

    return (
      <Box flexDirection="column">
        <Box>
          <Text color="text" bold>
            {it.model ?? 'no model yet'}
          </Text>
          {it.effort !== null && <Text color="permission"> · {it.effort}</Text>}
          {it.mode !== null && <Text color="autoAccept"> · {modeLabel(it.mode)}</Text>}
        </Box>

        <Text color="subtle">{rule}</Text>

        {it.context !== null && (
          <Box>
            <Text color="inactive">{'ctx'.padEnd(5)}</Text>
            <Text color={heat(it.context)}>
              {bar(it.context)} {`${Math.round(it.context)}%`.padStart(4)}
            </Text>
          </Box>
        )}

        {it.fiveHour !== null && (
          <Box>
            <Text color="inactive">{'5h'.padEnd(5)}</Text>
            <Text color={heat(it.fiveHour.percent)}>
              {bar(it.fiveHour.percent)} {`${Math.round(it.fiveHour.percent)}%`.padStart(4)}
            </Text>
            <Text color="subtle">
              {until(it.fiveHour.resetsAt, now) === null
                ? ''
                : ` ↻ ${until(it.fiveHour.resetsAt, now)}`}
            </Text>
          </Box>
        )}

        {it.sevenDay !== null && (
          <Box>
            <Text color="inactive">{'week'.padEnd(5)}</Text>
            <Text color={heat(it.sevenDay.percent)}>
              {bar(it.sevenDay.percent)} {`${Math.round(it.sevenDay.percent)}%`.padStart(4)}
            </Text>
            <Text color="subtle">
              {until(it.sevenDay.resetsAt, now) === null
                ? ''
                : ` ↻ ${until(it.sevenDay.resetsAt, now)}`}
            </Text>
          </Box>
        )}

        {it.costUsd !== null && (
          <Box>
            <Text color="inactive">{'cost'.padEnd(5)}</Text>
            <Text color="text">${it.costUsd.toFixed(2)}</Text>
            {it.startedAt !== null && <Text color="subtle"> · {dur(now - it.startedAt)}</Text>}
          </Box>
        )}

        {it.repo !== null && (
          <Box flexDirection="column">
            <Text color="subtle">{rule}</Text>
            <Box>
              <Text color="permission">
                {shortText(it.repo.branch ?? 'detached', columns - 10)}
              </Text>
              {it.repo.ahead > 0 && <Text color="success"> ↑{it.repo.ahead}</Text>}
              {it.repo.behind > 0 && <Text color="warning"> ↓{it.repo.behind}</Text>}
            </Box>
          </Box>
        )}

        {changes.length > 0 && (
          <Box flexDirection="column">
            <Text color="subtle">{rule}</Text>
            <Box>
              <Text color="inactive" bold>
                WORKING TREE
              </Text>
              <Text color="subtle"> {changes.length}</Text>
            </Box>
            {changes.slice(0, listRoom).map(change => (
              <Box key={`change-${change.path}`}>
                <Text color={change.isMine ? 'claude' : 'subtle'}>{change.isMine ? '●' : ' '}</Text>
                <Text color={change.status === '?' ? 'subtle' : 'warning'}>{change.status} </Text>
                <Text color="text">
                  {shortPath(change.path, Math.max(6, columns - 14)).padEnd(
                    Math.max(7, columns - 13),
                  )}
                </Text>
                <Text color="success">+{change.added}</Text>
                <Text color="error"> -{change.removed}</Text>
              </Box>
            ))}
          </Box>
        )}

        {it.agents.length > 0 && (
          <Box flexDirection="column">
            <Text color="subtle">{rule}</Text>
            <Box>
              <Text color="inactive" bold>
                AGENTS
              </Text>
              <Text color="subtle"> {it.agents.filter(one => one.ms === null).length}</Text>
            </Box>
            {it.agents.slice(-3).map(agent => (
              <Box key={`agent-${agent.id}`}>
                <Text color={agent.ms === null ? 'claude' : 'subtle'}>
                  {agent.ms === null ? '⟳ ' : '· '}
                </Text>
                <Text color="text">{shortText(agent.subject, Math.max(4, columns - 3))}</Text>
              </Box>
            ))}
          </Box>
        )}

        {it.history.length > 0 && (
          <Box flexDirection="column">
            <Text color="subtle">{rule}</Text>
            <Box>
              <Text color="inactive" bold>
                SESSIONS
              </Text>
              <Text color="subtle"> {it.history.length}</Text>
            </Box>
            {it.history.slice(0, 5).map(past => (
              <Box key={`past-${past.id}`}>
                <Text color="subtle">{ago(past.startedAt, now).padEnd(9)}</Text>
                <Text color="text">{shortText(past.title, Math.max(6, columns - 10))}</Text>
              </Box>
            ))}
          </Box>
        )}

        {activity.length > 0 && (
          <Box flexDirection="column">
            <Text color="subtle">{rule}</Text>
            <Text color="inactive" bold>
              ACTIVITY
            </Text>
            {activity.slice(0, listRoom).map(call => (
              <Box key={`call-${call.id}`}>
                <Text color={call.isError === null ? 'claude' : call.isError ? 'error' : 'success'}>
                  {call.isError === null ? '⟳ ' : call.isError ? '✗ ' : '✓ '}
                </Text>
                <Text color="inactive">{call.tool.slice(0, 8).padEnd(9)}</Text>
                <Text color="text">{shortText(call.subject, Math.max(4, columns - 18))}</Text>
                {call.ms !== null && <Text color="subtle"> {dur(call.ms)}</Text>}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
