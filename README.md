# cockpit

A sidebar for [Claude Code](https://claude.com/claude-code) in the terminal, and the
[context-rollover](./rollover) mod beside it.

The desktop app shows you where a session stands. The terminal makes you guess: how full the
context is, what the session has cost, whether the prompt cache is still warm, whether that
subagent is still going. `cockpit` puts all of it in a pane beside the conversation, with room
for your own notes.

```
╭─ SESSION 7 turns ──────────────╮
│ my-app                         │
│ Opus 5.5 ▾ · High ▾ · auto     │
╰────────────────────────────────╯
╭─ USAGE ────────────────────────╮
│ ctx  ▰▰▱▱▱  37% 74k/200k ▾     │
│ 5h   ▰▱▱▱▱  12% ↻ 2h14         │
│ week ▰▰▰▰▱  81% ↻ 4d           │
╰────────────────────────────────╯
╭─ CONTEXT ROLLOVER ─────────────╮
│ Status   MONITORING            │
│ Progress ▰▰▰▰▰▰▰▱▱▱ 71%        │
╰────────────────────────────────╯
╭─ NOTES ────────────────────────╮
│ - ask about the rate limiter   │
│ - parser: try the slow path    │
│                                │
╰────────────────────────────────╯
 ▰▰▰▰▰▰▰▱▱▱▱▱▱ 37% · ☕ warm 48m
╭─ ACTIONS ──────────────────────╮
│ new · compact · rewind · resu… │
╰────────────────────────────────╯
```

Each block is framed in its own colour, its title set into the top edge, so the pane reads as
separate parts at a glance. Percentages go green → amber → red as they climb. Every colour is a
theme key, so the pane follows whatever theme you run, custom ones included.

## Notes

**NOTES** takes every row the other blocks leave and scrolls past that. What you type is
saved as you type it, per project, so each repository keeps its own notes across sessions. On
the mobile app, which draws no text field yet, the notes are shown, not edited.

## The progress line

The line above the actions is the session at a glance:

- **Context fill** as a purple shimmer that sweeps while Claude works. It turns to heat colours
  once a rollover (or, without the rollover mod, a compact) is near.
- **The prompt cache**: `☕ warm 48m` counts down from the last response; amber in its last
  five minutes; `🧊 cold · start fresh` once it has expired. A cold cache means the next turn
  pays for the whole context again, so that is a good moment to start a new session instead.

Claude Code does not tell mods the cache TTL, so set it in the plugin's options: `1h` (the
default, a Claude subscription) or `5m` (an API key).

## Subagents

While subagents run, each gets a row **above the prompt**, in the main screen, with a ⟳ in the
same shimmer and how long it has been running:

```
⟳ Explore auth flow          1m 04s
⟳ Write migration tests         38s
```

The band is gone the moment none run, and the prompt area is the engine's own again. The
pane's **AGENTS** block keeps the last few for reference.

A soft chime, with a toast, marks the moments attention has most likely wandered: a
permission prompt, and the end of a turn that ran longer than 30 seconds. Short turns stay
quiet.

## The conversation

The transcript is redrawn, never rewritten — the stored messages are untouched:

- **Questions put to you are marked**: `👉 **Want me to push it?**`, so the decision
  waiting on you is not lost at the end of a long reply. Code, headings and tables are left
  alone. This shows on every surface, Remote Control included.
- **A failed tool call is loud**: `✗ Bash failed · npm test`, in red, with the first lines of
  why, in place of the quiet row. Calls that worked keep the engine's own row.
- **The end of each turn is a line you can find**: `━━━ ✓ done in 3m 12s ━━━`, so the start
  of each answer stands out when scrolling back (terminal only).

## Install

The repository holds two mods, each in its own folder:

```bash
git clone https://github.com/aymengraoui/claude-code-cockpit
claude --plugin-dir ./claude-code-cockpit/cockpit --plugin-dir ./claude-code-cockpit/rollover
```

To keep both loaded in every session, list the folders in `CLAUDE_CODE_PLUGIN_DIRS` in
`~/.claude/settings.json` (`;` between them on Windows, `:` elsewhere):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-code-cockpit/cockpit:/path/to/claude-code-cockpit/rollover" } }
```

Either mod works alone: without the rollover mod the CONTEXT ROLLOVER block says
`UNAVAILABLE`.

The pane opens itself at session start on a terminal at least 144 columns wide — the width at
which an unasked pane is allowed to seat itself. Narrower than that, or if you close it, open it
with `/cockpit`, or bind a key to it:

```json
// ~/.claude/keybindings.json
{ "bindings": [ { "context": "Global", "bindings": { "alt+c": "command:cockpit" } } ] }
```

## What it reads

Everything comes from the session you are already in. Nothing is sent anywhere, and the only
process it ever starts is the terminal `new` opens:

| Shown | Where it comes from |
| --- | --- |
| project, turn count | `$.session.cwd()` and `$.session.turns()` |
| everything above, at launch | `$.session.usage()`, `$.session.model()` and `$.session.turns()`, asked for in `session.start` |
| model | `$.session.model()`, every tick |
| effort | `turn.step`, and `effort.level` on the classic hook inputs |
| the plan | `tool.call` on `TodoWrite`, read from the payload Claude writes |
| permission mode | `permission_mode` on the prompt, tool-result and stop hook inputs |
| context fill, 5h and weekly windows | `session.measure` |
| what fills the context | `$.session.usage({ breakdown: 'summary' })`, the categories `/context` counts |
| the prompt cache | the time of the last response, plus the TTL you set |
| running subagents | `$.agent.list()`, timed from when each is first seen |
| notes | `$.store`, keyed by project |
| context rollover | `$.state` `context-rollover.status`, published by the [context-rollover](./rollover) mod |

**Press the model or the effort to change it.** Each opens the engine's own picker, `/model`
or `/effort`, through `$.command.run`. The pane keeps no list of its own on purpose: what those
pickers offer depends on the account and the model, and none of it is exposed to a plugin.

**Press the `▸` beside the context bar to see what fills it** — the categories `/context`
counts, largest first — with `compact` waiting in the toolbar below.

**The quick actions sit in a toolbar pinned to the bottom edge** — `new · compact · rewind ·
resume · clear`. Each runs the engine's own command; `compact` shows a `⚠` past 85% context.
`new` opens a fresh `claude` in a terminal of its own, in the same directory. `clear` discards
the conversation, so it asks twice: the first press arms it and shows `clear?`, a second within
four seconds runs it.

## The context rollover block

**CONTEXT ROLLOVER** shows the lifecycle of the [context-rollover](./rollover) mod, which moves
long-running work into a fresh session before the context grows too large. The cockpit only
**observes**: that mod is the single source of truth and writes `$.state`
`context-rollover.status`. The pane reads that value while drawing, so the host redraws it on
every write, with no polling of its own. Nothing in the cockpit can start, stop or change a
rollover.

| Row | Shows |
| --- | --- |
| Status | `MONITORING · PREPARING · READY · DRAINING · PERSISTING · RESTARTING · RESUMING · COMPLETED · AWAITING /clear · FAILED · DISABLED`, or `STALE` |
| Context | the current session's context tokens over the configured hard limit; `UNKNOWN` before its first response |
| Progress | tokens ÷ hard limit, clamped to 0–100%, coloured by the configured thresholds |
| Next | the next threshold above the reading, and how far off it is |
| Handoff | the continuation: not started, in progress, draft saved, persisted, pending, restored |
| Agents · Tasks | counts by status, as the rollover mod reads them; `UNAVAILABLE` when it cannot |
| Last | the previous rollover's outcome and when; after a rollover, Context is the *new* session's |
| Next action | what the rollover mod is doing now, or will do next |
| Error | the last error, when there is one |

Every read is validated against the contract's schema version (`cockpit/hooks/lib/rollover.ts`;
the types are an observer's copy in `cockpit/types/rollover.d.ts`). A missing value (that mod
not installed or not loaded) draws `UNAVAILABLE` and a reason. So does a malformed value or an
unknown schema. A writer whose heartbeat is more than 45 s old draws `STALE`, with its figures
dimmed. The rest of the pane is unaffected either way.

## How it is built

A Claude Code mod is a plugin of function hooks: every event in the engine runs through a chain,
and a hook can watch it, rewrite what the rest of the chain sees, or answer for it. `cockpit`
mostly watches; its drawing is done by `ui.render` hooks:

```ts
on('ui.render', { component: 'Pane', requestId: 'cockpit' }, async ($, e) => {
  const { Box, Text } = $.ui.resolve(e)
  const it = await read($, state)

  return <Box flexDirection="column">{/* ... */}</Box>
})
```

In `cockpit/hooks/`:

- `register.tsx` — the hooks, the pane's tree and the subagent band
- `lib/format.ts` — bars, the shimmer, durations, token counts, path and model formatting
- `lib/usage.ts` — usage figures and the cache countdown
- `lib/tools.ts` — readers for tool-call payloads
- `lib/attention.ts` — marked questions and failed-call lines
- `lib/launch.ts` — the terminal commands to try, per platform
- `lib/rollover.ts` — the rollover mod's state, validated
- `lib/palette.ts` — the colours, by value: swap this file for your own

Everything outside `register.tsx` is pure functions, which is why most of the suite needs no
engine at all.

State lives in `$.state` rather than module variables, so a hot reload keeps the pane's
contents, and a write redraws exactly the readers. The pane is primed in `session.start`, so it
is populated the moment it opens rather than filling in as events arrive.

The permission mode is the awkward one. In a local terminal session no event reaches a plugin
when it changes, so the pane shows `permission_mode` from the classic hook inputs for a prompt,
a tool result and a turn's end. It is never a guess, but a shift+tab made while the session sits
idle shows with your next message.

## Development

Each mod is validated and tested on its own:

```bash
claude plugin validate cockpit && claude plugin test cockpit
claude plugin validate rollover && claude plugin test rollover
```

Edits hot-reload: with the folders loaded, each change takes effect when the turn that made it
ends.

## Compatibility

Built and tested against Claude Code 2.1.314 on the `terminal` surface. The hook API is young —
if a release moves under it, `claude plugin validate` will say so before anything draws, and a
hook that fails is skipped with the engine drawing its own thing instead.

## License

MIT © Aymen Graoui
