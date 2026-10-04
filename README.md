# cockpit

A sidebar for [Claude Code](https://claude.com/claude-code) in the terminal.

The desktop app shows you where a session stands. The terminal makes you guess: how full the
context is, what the session has cost, which files changed, what Claude just ran, whether that
subagent is still going. `cockpit` puts all of it in a pane beside the conversation.

```
╭─ cockpit ──────────────────────────╮
│ Opus 5 · high · plan               │
│ ────────────────────────────────── │
│ ctx  ▰▰▱▱▱  37%                    │
│ 5h   ▰▱▱▱▱  12% ↻ 2h14             │
│ week ▰▰▰▰▱  81% ↻ 4d               │
│ cost $1.24 · 1h15m                 │
│ ────────────────────────────────── │
│ feat/parser ↑2                     │
│ ────────────────────────────────── │
│ WORKING TREE 3                     │
│ ● M src/parse.ts          +48 -12  │
│ ● M src/parse.test.ts     +31  -0  │
│   ? notes.md               +0  -0  │
│ ────────────────────────────────── │
│ AGENTS 1                           │
│ ⟳ find every call site             │
│ ────────────────────────────────── │
│ SESSIONS 4                         │
│ 2h ago   fix the parser rounding   │
│ 1d ago   add the cockpit pane      │
│ 4d ago   warp theme for windows    │
│ ────────────────────────────────── │
│ ACTIVITY                           │
│ ✓ Edit     src/parse.ts     120ms  │
│ ✗ Bash     npm run lint      0.8s  │
│ ✓ Bash     npm test          3.1s  │
╰────────────────────────────────────╯
```

`●` marks a file this session wrote to, so your edits stand out from whatever else is dirty in
the tree. Percentages go green → amber → red as they climb. Every color is a theme key, so the
pane follows whatever theme you run, custom ones included.

## Install

```bash
git clone https://github.com/aymengraoui/claude-code-cockpit
claude --plugin-dir ./claude-code-cockpit
```

To keep it loaded in every session, add the folder to `CLAUDE_CODE_PLUGIN_DIRS`, or install it
as a plugin with `/plugin`.

The pane opens itself at session start on a terminal at least 144 columns wide — the width at
which an unasked pane is allowed to seat itself. Narrower than that, or if you close it, open it
with `/cockpit`.

## What it reads

Everything comes from the session you are already in. Nothing is sent anywhere, and the only
process it ever starts is `git`:

| Shown | Where it comes from |
| --- | --- |
| model, effort | `turn.step`, as each request goes out |
| permission mode | `classic.UserPromptSubmit` and `classic.PostToolUse`, the only inputs that carry it |
| context fill, 5h and weekly windows, cost | `session.measure` |
| branch, divergence, working tree, line counts | `git status --porcelain=v2 --branch` and `git diff HEAD --numstat`, once per turn |
| tool activity, durations, failures | `tool.call`, timed around `next(e)` |
| running agents | `tool.call` on the `Agent` tool |
| earlier sessions | `$.store`, written on each session's first prompt |

The session list is the mod's own record, not Claude Code's: on the first prompt of a session
it stores that prompt as the title, and tops the entry up with the final cost at
`session.end`. It keeps the last 20 and starts empty, so the list fills in as you work rather
than showing anything from before the mod was installed.

Two read-only `git` calls per completed turn, not per edit — the pane costs a few milliseconds
a turn and never writes to your repo.

## How it is built

A Claude Code mod is a plugin of function hooks: every event in the engine runs through a chain,
and a hook can watch it, rewrite what the rest of the chain sees, or answer for it. `cockpit`
only ever watches, except for the one hook that draws:

```ts
on('ui.render', { component: 'Pane', requestId: 'cockpit' }, async ($, e) => {
  const { Box, Text } = $.ui.resolve(e)
  const it = await read($, state)

  return <Box flexDirection="column">{/* ... */}</Box>
})
```

Three files do the work:

- `hooks/register.tsx` — the hooks and the pane's tree
- `hooks/lib/format.ts` — bars, durations, path and model formatting; pure functions
- `hooks/lib/git.ts` — parsers for the two git commands; pure functions

State lives in `$.state` rather than module variables, so a hot reload keeps the pane's
contents, and a write redraws exactly the readers.

## Development

```bash
claude plugin validate .   # manifest, hooks and every $ call the module makes
claude plugin test .       # the suite, against the real engine
```

The suite covers the pure helpers and mounts the pane through the engine on the `terminal`
surface, asserting what it draws from seeded usage figures and seeded `git` output.

Edits hot-reload: with the folder loaded, each change takes effect when the turn that made it
ends.

## Compatibility

Built and tested against Claude Code 2.1.289 on the `terminal` surface. The hook API is young —
if a release moves under it, `claude plugin validate` will say so before anything draws, and a
hook that fails is skipped with the engine drawing its own thing instead.

## License

MIT © Aymen Graoui
