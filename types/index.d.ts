/** One finished or running tool call, newest last. */
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

/** One path in the working tree, as `git status`/`git diff --numstat` report it. */
export type Change = {
  path: string
  /** Index status letter: M, A, D, R, ? for untracked. */
  status: string
  added: number
  removed: number
  /** True when a tool call in this session wrote to it. */
  isMine: boolean
}

/** What `git status --porcelain=v2 --branch` says about where HEAD is. */
export type Repo = {
  branch: string | null
  ahead: number
  behind: number
  changes: Change[]
}

/** A rate-limit window as the engine reports it. */
export type Window = { percent: number; resetsAt: string | null }

/** One earlier session, as the mod recorded it in `$.store`. */
export type Past = {
  id: string
  /** Epoch ms of that session's first prompt. */
  startedAt: number
  /** That first prompt, in one short line. */
  title: string
  costUsd: number | null
}

/** Everything the pane draws, as the hooks accumulate it. */
export type Cockpit = {
  model: string | null
  effort: string | null
  /** Permission mode, as the classic hook inputs report it. */
  mode: string | null
  /** Earlier sessions, newest first; the current one is not in it. */
  history: Past[]
  context: number | null
  fiveHour: Window | null
  sevenDay: Window | null
  costUsd: number | null
  startedAt: number | null
  repo: Repo | null
  activity: Activity[]
  agents: Activity[]
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { state: Cockpit }
  }
}
