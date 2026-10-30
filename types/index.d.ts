/** One running or finished subagent, newest last. */
export type Activity = {
  id: string
  /** Tool name as the engine calls it (`Edit`, `Bash`, `Agent`, ...). */
  tool: string
  /** The call's subject: a path, a command, an agent's description. */
  subject: string
  /** Wall-clock duration, once the call has returned. */
  ms: number | null
  /** null while the call runs. */
  isError: boolean | null
}

/** A rate-limit window as the engine reports it. */
export type Window = { percent: number; resetsAt: string | null }

/** One row of the context breakdown, as /context counts it. */
export type ContextRow = { name: string; tokens: number }

/** One item of the plan, as the `TodoWrite` tool last wrote it. */
export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Everything the pane draws, as the hooks accumulate it. */
export type Cockpit = {
  model: string | null
  effort: string | null
  /** The permission mode exactly as the engine reports it: `auto`, `plan`, `default`, ... */
  mode: string | null
  /** The directory the session runs in, by its last segment. */
  project: string | null
  /** That directory in full: what a resumed session should open in. */
  cwd: string | null
  /** This session's id, so the history can mark which entry is live. */
  sessionId: string | null
  /** Prompts answered so far. */
  turns: number | null
  context: number | null
  /** Input tokens the last response was answered over, and the window they sit in. */
  tokens: number | null
  window: number | null
  fiveHour: Window | null
  sevenDay: Window | null
  todos: Todo[]
  agents: Activity[]
  /** When the live ticker last looked; a redraw of the clocks hangs off it. */
  tickedAt: number | null
  /** The context breakdown, when it is open; null while closed. */
  contextRows: ContextRow[] | null
  /** An action pressed once that wants a second press, and when: /clear. */
  armed: { action: string; at: number } | null
  /** When the main loop last had a response: the prompt cache is warm for a TTL after. */
  respondedAt: number | null
  /** This project's notes, as typed. */
  notes: string
}

/** What the mascot acts out. */
export type MascotActivity =
  | 'idle'
  | 'thinking'
  | 'writing'
  | 'running'
  | 'reading'
  | 'planning'
  | 'done'
  | 'alert'
  | 'waiting'

/** What the session is doing: drives the chime, the toasts and the progress shimmer. */
export type MascotState = {
  activity: MascotActivity
  /** The file, the command, or the message the activity is about. */
  detail: string | null
  /** The shimmer's frame; the pane redraws on each. */
  frame: number
  /** Tools that failed this turn, by what they were doing. */
  failures: string[]
  /** When the running turn began, to tell a long turn from a short one. */
  turnStartedAt: number | null
  /** Subagents still at work, as the engine reports them: the shimmer runs while any do. */
  agents: { id: string; label: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { state: Cockpit; mascot: MascotState }
  }
}
