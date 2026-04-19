# PR #3 — Widget Groups (schema v4 + powerline redesign)

## Summary
Introduce a `line → group → widget` hierarchy so a single status line can contain multiple visually distinct pills separated by plain-space gaps. The powerline renderer is redesigned with a split symbol vocabulary so group boundaries become first-class citizens instead of being squeezed through a single continuous chain.

## Motivation
Current powerline mode supports **one pill per line** (one `startCap` + N `separators` + one `endCap`). Users who want multiple visual clusters on one line must either:
- Disable powerline and hand-construct caps as `custom-text` widgets (fragile, verbose, breaks auto-align), or
- Spread clusters across multiple lines (wastes vertical terminal space).

A first-class group concept removes this entire category of workaround and enables layouts like `[vim]  [model → cost → context%]  [git root → sha → branch]` on one line.

## Scope
Schema v4 with `groupsEnabled` opt-in toggle.

### Schema

Before (v3):
```json
"lines": [ [ w1, w2, ... ] ]
```
After (v4):
```json
"lines": [
  {
    "groups": [
      { "gap": "  ", "continuousColor": true, "widgets": [w1, ...] },
      { "widgets": [w3, ...] }
    ]
  }
]
```

### New global options
- `groupsEnabled: boolean` (default `false` — TUI hides the group layer; v3 flat semantics preserved internally).
- `defaultGroupGap: string` (default `"  "`).

### Render pipeline

#### Plain mode (`renderStatusLine`)
Outer loop over groups, inner loop over widgets. Emit `gap` between groups (no background). If *every* widget in a group evaluates to hidden (via PR #1's `when`), drop the whole group including its preceding gap.

#### Powerline mode (`renderPowerlineStatusLine`) — redesign
Symbol vocabulary split four ways:

| Symbol | Position | Replaces |
|---|---|---|
| `widgetSeparator` | Between widgets inside a group | v3 `separators` |
| `groupStartCap` / `groupEndCap` | Each group's boundary | v3 `startCaps` / `endCaps` reinterpreted per-group |
| `groupGap` | Between groups | new — no bg, literal |
| `lineStartCap` / `lineEndCap` | Only at line head/tail | kept for the existing use case |

Render sequence for a line:
```
[lineStartCap]
  groupStartCap W₁ sep W₂ ... Wₙ groupEndCap
  groupGap
  groupStartCap W₁ ... groupEndCap
[lineEndCap]
```

### `continuousColor` (resolves QA P0-4)
**Default `true`** to preserve v3 flat-mode byte-for-byte behavior after auto-migration. When `false` on a group, `widgetColorIndex` resets at the group's start so the theme palette cycles fresh for that group.

### flex-separator (resolves QA P0-3)
`flex-separator` is valid **inside a group only**. At layout time:
- Free terminal space is divided equally among groups that contain at least one flex-separator.
- Within each such group, the existing flex-distribution logic applies.
- Groups without any flex-separator do not expand.

For v3-migrated configs (one-group-per-line), this is indistinguishable from v3 flex behavior — a line has exactly one group, so the flex-group absorbs all slack.

### `merge`
Valid only inside a group; group boundaries always terminate a merge chain. Migration wraps entire v3 lines into single groups, so no v3 merge chain is ever broken by migration.

## Group hide propagation (depends on PR #1)
The framework integrates with `when` rules (PR #1). If every widget in a group evaluates to hidden, drop:
- the group's `groupStartCap` and `groupEndCap`
- the `groupGap` preceding the group
- any `widgetSeparator` inside (trivially, since no widgets remain)

## Non-goals
- **Group-aware auto-align** — PR #4.
- **Per-group overflow wrapping** — PR #4.
- **Group-level `when` settings** (e.g., hide an entire group on one predicate). Deferred; auto-propagation from widgets covers realistic cases.
- Nested groups (groups within groups). Not planned; flat group list per line.

## Alternatives considered
- **"Group boundary" marker widget** (insert a sentinel). Rejected: no place to attach per-group settings (`gap`, `continuousColor`); renderer re-derives boundaries every render; TUI navigation gets awkward.
- **Flat list + `groupId` tag per widget.** Rejected: order-independence is a lie — groups are inherently ordered and contiguous. Explicit hierarchy is more honest and simpler to edit.
- **Render each group as its own internal `line`, auto-concatenate.** Rejected: breaks terminal-width math; per-line truncation produces asymmetric results; incompatible with auto-align.

## Migration (v3 → v4)

Each v3 line becomes one v4 `line` with a single group containing all widgets (`continuousColor: true`, `gap: defaultGroupGap`). Load-time migration is in-memory; the config file is rewritten on first save.

- **Automatic backup**: before the first v4 save, copy `settings.json` to `settings.json.v3.bak`.
- `flexMode`, `compactThreshold`, `colorLevel`, etc. carry over unchanged.
- v3 `startCaps` / `endCaps` become `lineStartCap` / `lineEndCap`.
- v3 `separators` becomes `widgetSeparator`.

## Rollback

- Older binaries reading a v4 config fail fast: `"config version 4 is newer than supported (3); restore from settings.json.v3.bak"`. Exit non-zero.
- Users restore the backup; no data loss for layouts fully expressible in v3.
- If the user had manually created grouped layouts in v4, the backup reflects only v3-expressible content; group structure is lost on rollback by design.
- **Manual restore path**: to downgrade from v4 → v3 after migration, copy `~/.config/ccstatusline/settings.json.v3.bak` back over `settings.json`. The `.v3.bak` is written once, at the first v4 save.

## Invariants (must hold)
- **`groupsEnabled: false` + v3 config** → byte-identical rendered output compared to current `main` on the same input JSON.
- **`groupsEnabled: true` + single group per line** → byte-identical to `groupsEnabled: false`.
- **`continuousColor: true` on the only group in a line** → theme cycles identically to v3.

## Test plan

### Migration round-trip
- 10 fixed v3 fixtures (flat; merge chain; flex-separator; powerline with custom caps; all four legacy hide flags) → migrated → rendered → **byte-identical** to current `main` rendering the same input.
- Fuzz: 100 random valid v3 configs → migrated → same byte-identity requirement.

### Powerline snapshots (ANSI)
- Multi-group layouts (2, 3, 5 groups).
- First group entirely hidden (no leading gap).
- Last group entirely hidden (no trailing gap).
- Middle group hidden (gaps around it collapse correctly).
- All groups hidden (line reduces to `lineStartCap + lineEndCap`, or empty if none).
- `continuousColor: false` on a group resets the palette; `true` cycles.

### flex-separator
- One group has flex in a multi-group line → that group absorbs all slack.
- Two groups each have flex → slack split equally.

### TUI
- `groupsEnabled: false → true → false` round-trip preserves group structure (no destructive flatten on off).
- Breadcrumb visible during 3-depth navigation (`line 2 › group 1 › widget 3`).

### Observability
- `CCSTATUSLINE_DEBUG=1` logs group boundaries, hide-propagation decisions, and per-group palette state.

## Open questions
- Should `lineStartCap` / `lineEndCap` **inherit colors** from the first/last group's `bgColor`, or be independently configurable? Current default: inherit, matching v3 `startCaps`/`endCaps` behavior.
- Should a **group with zero widgets** be auto-pruned on load, or preserved? Recommend auto-prune with an editor warning on save.
- Final naming: should we call it `group` or `segment` / `cluster` to avoid collision with other ccstatusline concepts? Open for maintainer taste-check.

## Dependencies
**Requires PR #1 (`when`) to land first** for group hide propagation. If PR #1 is delayed, PR #3 can ship without auto-hide (groups always render regardless of widget visibility), with a follow-up enabling it.
