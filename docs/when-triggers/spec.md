# PR #1 — `when` Triggers

## Summary
Introduce a declarative `when` array available on every widget. Each rule evaluates a predicate and applies an action — hide, or override color/bg/bold. Supersedes the four existing per-widget metadata flags (`hideNoGit`, `hideNoRemote`, `hideWhenEmpty`, `hideWhenNotFork`), which become special cases at the loader layer.

## Motivation
- Users cannot currently apply conditional visibility to `custom-text`, `custom-symbol`, or `custom-command`. Every hide flag is re-implemented inside specific git/remote widgets.
- This blocks legitimate layouts — e.g., a custom separator that should disappear outside a git repo together with the git widgets it separates.
- A single extensible API replaces four one-off flags without a schema version change.

## Scope
Schema v3 preserved. New optional top-level field on `WidgetItem`.

```ts
type WhenRule = {
  on: "no-git" | "no-remote" | "not-fork" | "empty";
  do: "hide" | "color" | "bg" | "bold";
  value?: string | boolean;
};

// per widget (top-level field, not inside `metadata`)
WidgetItem.when?: WhenRule[]
```

> **Note:** An earlier draft placed the rule array at `metadata.when`. Implementation moved it to a top-level `when` field because the existing `WidgetItem.metadata` schema is `Record<string, string>` (string-valued only). Putting arrays/objects under `metadata` would have required loosening the whole map to `unknown`, cascading through every existing metadata flag helper. Top-level `when` is cleaner and keeps legacy flag helpers untouched.

### Supported predicates
| `on` | True when |
|---|---|
| `no-git` | `!isInsideGitWorkTree(context)` |
| `no-remote` | no upstream remote configured |
| `not-fork` | origin is not a fork |
| `empty` | the widget's rendered text has length 0 |

### Supported actions
| `do` | Effect | `value` |
|---|---|---|
| `hide` | Widget skipped entirely | — |
| `color` | Override foreground color | ansi name or hex |
| `bg` | Override background color | ansi name or hex |
| `bold` | Override bold | `true` / `false` |

## Evaluation semantics (resolves QA P0-1 & P0-2)

1. **`hide` is union-OR across all matching rules.** Rules are *not* short-circuited; every rule is evaluated. If *any* `{do:"hide"}` rule matches, the widget is hidden.
2. **`color` / `bg` / `bold` are last-wins.** When multiple style-override rules match, the last one in declaration order applies.
3. **`empty` predicate may only pair with `do:"hide"`.** The loader rejects `{on:"empty", do:"color"|"bg"|"bold"}` with a clear error pointing at the offending rule. Rationale: `empty` is evaluated *after* the widget's `render()` returns; by that point ANSI codes for a zero-length string are already resolved, so a style override would have no observable effect. Hide is the only well-defined interaction.
4. **Evaluation timing.** `no-git` / `no-remote` / `not-fork` are evaluated pre-render (they do not need the widget's text). `empty` is evaluated post-render (needs `renderedText`). If no rule uses `empty`, the post-render pass is skipped.

## Examples

```json
// custom-text vanishes outside a git repo
{
  "type": "custom-text",
  "customText": "",
  "when": [{ "on": "no-git", "do": "hide" }]
}

// git-branch turns red when no upstream is configured
{
  "type": "git-branch",
  "when": [{ "on": "no-remote", "do": "color", "value": "red" }]
}
```

## Known limitations

Two color-flow edges intentionally do **not** honor `when` color/bg/bold overrides in the v1 integration:

- **`inheritSeparatorColors`.** When this global setting is enabled, a plain separator inherits the preceding widget's color. That inheritance path reads the widget's static `color` / `backgroundColor`, not any `when`-rule override. If a `when` rule recolors a widget, the separator after it keeps the original color. Rationale: threading `when` into separator inheritance would double the renderer diff; revisit post-PR-#1.
- **`custom-command` widgets with `preserveColors: true`.** These widgets bypass the color pipeline entirely to preserve raw ANSI from the command output. `when` overrides on color / bg / bold won't apply. Consistent with the existing special-case semantics for `preserveColors`.

`when: hide` works on both cases: a `preserveColors` widget can still be hidden, and a hidden widget is removed before the inheritance code runs.

## Non-goals
- State-axis coloring (e.g. vim `insert` vs `normal`) — covered by PR #2's alternate-color feature.
- Shell-based predicates (`cmd:...`) — out of scope; re-evaluate later if demand exists.
- Grouped widgets / multi-pill layouts — PR #3.

## Alternatives considered
- **Extend the existing per-widget flags to custom-text.** Rejected: would add N×M flags (new flag per widget type × condition) and still couldn't express style overrides.
- **Adopt JSONLogic / CEL.** Rejected: overkill for four enums; adds a runtime dependency and unfamiliar surface for config editors. Can evolve into one later if demand appears.
- **Keep `hide` as the only action.** Rejected: users want `color`/`bg` overrides for status signalling (e.g., color-code git-branch by remote state).

## Migration
No schema bump. Legacy metadata flags are transparently rewritten into the top-level `when` array at load:

```ts
// conceptual
if (item.metadata?.hideNoGit === "true") {
  item.when = [
    ...(item.when ?? []),
    { on: "no-git", do: "hide" }
  ];
  delete item.metadata.hideNoGit;
}
```

If the user has both a legacy flag and an equivalent `when` rule, we de-duplicate. No error, no warning.

### Deprecation timeline
- v4.x: legacy flags still loaded silently.
- v5.0: loader emits a console warning on legacy flag use.
- v6.0: loader rejects legacy flags.

## Rollback
No file format change. Reverting the binary yields identical behavior — unless the user hand-edited `when` onto custom-text (older binaries ignore it silently). No data loss.

## Test plan

### Unit (`evaluateWhen`)
- Empty rules → no overrides, no hide.
- Single `hide` rule per predicate — truth table with/without git/remote/fork context.
- Multiple `hide` rules across predicates — union-OR semantics verified.
- Last-wins on overlapping `color`/`bg`/`bold` rules.
- `empty` predicate evaluated only when present in the rule list.
- Loader rejects `{on:"empty", do:"color"}` with clear error.

### Legacy compatibility
- A fixture with `hideNoGit:"true"` produces byte-identical rendered output to a fixture with `when:[{on:"no-git",do:"hide"}]`.
- Fuzz: 50 random legacy configs → migrated → rendered output matches pre-migration byte-for-byte.

### Integration
- Custom-text with `when:[{on:"no-git",do:"hide"}]` disappears outside git, reappears inside.
- Git-branch with `when:[{on:"no-remote",do:"color",value:"red"}]` renders red when no upstream, normal when upstream exists.

### Observability test
- `CCSTATUSLINE_DEBUG=1` emits one line per evaluated rule: widget id, predicate, match result, applied action.

## Observability
New env var `CCSTATUSLINE_DEBUG=1` enables structured stderr logging of `when` rule evaluation. Off by default. Covers QA's observability concern.

## Open questions
- Should the loader *throw* or *silently strip* invalid `{on:"empty", do:"color"}` rules? Current default: throw with line number. Alternative: silently strip with a warning. Leaning toward throw for correctness; revisit if early adopters find it too aggressive.
- Should `on:"empty"` consider the *post-override* text (after other `color`/`bg` — meaningless) or the *raw rendered* text? Current default: raw rendered text.
