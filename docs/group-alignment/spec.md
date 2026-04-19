# PR #4 — Group-Aware Auto-Align

## Summary
Extend `autoAlign` (powerline-only) to understand the `line → group → widget` hierarchy introduced in PR #3. When `groupsEnabled` is on, `autoAlign` produces **nested** alignment: group start columns align across lines, and widget start columns within matching groups also align. Flex-separator semantics are preserved: groups before the first flex are left-anchored, groups after the last flex are right-anchored, and flex-containing/between groups are excluded from alignment. When `groupsEnabled` is off, `autoAlign` behaves byte-identically to `main`.

## Motivation
PR #3 gave users multi-group pill layouts (`[A] [B → C] [D → E → F]`) but left auto-align flat-widget-indexed. The result on multi-line grouped configs is that the Nth visible widget across lines is padded to a common column — ignoring group membership. For layouts like:

```
Line 1: [vim ] [model → cost → context%] [git-root → sha → branch]
Line 2: [tmux] [opus  → $1.23 → 45%   ] [main      → abc → feat/x]
```

flat indexing happens to work when every line has the same shape but breaks the moment any line differs in group structure or widget count. Group-aware auto-align honours the hierarchy: a pill's start column lines up with the same pill on other lines; widgets within matching pills also line up.

## Scope
- **Powerline mode only.** Plain-mode auto-align is out of scope (plain mode has no auto-align today; adding it belongs to a separate feature proposal).
- **No schema change.** Reuses the existing `powerline.autoAlign: boolean` toggle. Behaviour switches automatically based on `groupsEnabled`.
- **No new TUI toggle.** The existing auto-align entry in `PowerlineSetup` remains; only the underlying algorithm changes when `groupsEnabled` is true.

### Non-goals
- Per-group overflow wrapping (dropped from this PR — no follow-up planned in this branch; can be re-proposed later if demand surfaces).
- Group-level `wrap` or `align` settings.
- Aligning flex-containing groups or groups nested between two flex groups.
- Adding auto-align to plain mode.

## Design

### Alignment rules (nested)

When `autoAlign: true` AND `groupsEnabled: true`:

1. **Per-line anchor zones.** For each line, identify `flexStart` (first group containing any `flex-separator`) and `flexEnd` (last such group). If no flex exists, the entire line is left-anchored.
   - **Left-anchor zone**: groups with index `< flexStart` (or all groups if no flex).
   - **Right-anchor zone**: groups with index `> flexEnd`.
   - **Excluded**: `flexStart..flexEnd` (flex-containing group and any groups between two flex groups).

2. **Left-anchor alignment.** For each line's left-anchor groups:
   - **Widget-level**: at coordinate `(groupIndex g, visibleWidgetPosition wPos)`, merge chains are treated as a single slot. Trailing padding is appended to the last element of each chain to reach `widgetMaxWidths[g][wPos]` — the cross-line max width at that coordinate.
   - **Group-level**: after inner-widget padding, if the line's group `g` total inner width is less than `groupTotalMax[g]`, additional trailing padding is appended to the group's last widget to match. This propagates the "group `g+1` starts at the same column across lines" invariant even when lines have different visible widget counts within group `g`.

3. **Right-anchor alignment** (symmetric from the right).
   - Right-anchor groups are indexed in reverse: the rightmost group is `rG=0`, the next-leftward is `rG=1`, etc.
   - `rightWidgetMaxWidths[rG][rWPos]` where `rWPos` is the visible-widget position counted from the group's right edge.
   - Leading padding is prepended to the first element of each merge chain (equivalently, trailing padding on the previous chain's last element — whichever is simpler to implement inside a pill without disrupting bg-color boundaries).
   - `rightGroupTotalMax[rG]` similarly pads the right-anchor group's **leading** edge (padding on the previous group's `groupGap` boundary region or on the preceding `groupEndCap`'s adjacent element).

4. **Excluded groups.** Groups inside the `[flexStart, flexEnd]` range receive no alignment padding; their content renders naturally and any free terminal slack is absorbed by the flex-separator per PR #3 semantics.

### Hidden widget handling (follows `main`)

A widget with empty rendered content (either legacy hide flags or PR #1's `when` evaluating to hidden) is **removed from alignment computation**. The pill stays visually tight and column alignment of subsequent widgets within that group may shift on that line — matching `main`'s existing `calculateMaxWidthsFromPreRendered` filter pattern (`&& w.content`). This keeps the feature's behaviour philosophy consistent with the pre-groups world.

### Entirely hidden group

When every widget in a group evaluates to hidden, PR #3 already drops the group and its preceding gap from the render. For alignment: that line contributes nothing at that group's index to `widgetMaxWidths[g]` or `groupTotalMax[g]`. Other lines retain their own max contributions for the same index.

### Interaction with existing features

- **`continueThemeAcrossLines`**: orthogonal. Alignment padding appends trailing spaces whose bg colour is inherited from the last (or first, for right-anchor) element of the chain; no theme-index state is touched.
- **Merge chains**: a merge chain is a single alignment slot (same as `main`). Chains never cross group boundaries (PR #3 invariant).
- **`lineStartCap` / `lineEndCap`**: constant per config, outside the group sequence. Ignored in max-width calc.
- **`groupGap`**: constant. Ignored in max-width calc; emitted at render time per PR #3.
- **Terminal-width truncation**: unchanged. Alignment is applied before truncation; if padded content overflows, the existing truncation path kicks in.

## Architecture

### New function: `calculateGroupedMaxWidths`

Signature (sketch):
```ts
interface GroupedMaxWidths {
    // Left-anchor zone
    widgetMaxWidths: number[][];      // [groupIndex][visibleWidgetAlignPos]
    groupTotalMax: number[];          // [groupIndex]
    // Right-anchor zone (indexed from right, rG=0 is rightmost group)
    rightWidgetMaxWidths: number[][]; // [reverseGroupIndex][reverseWidgetAlignPos]
    rightGroupTotalMax: number[];     // [reverseGroupIndex]
    // Per-line anchor zone boundaries
    leftAnchorGroupCount: number[];   // [lineIndex]
    rightAnchorGroupCount: number[];  // [lineIndex]
}

function calculateGroupedMaxWidths(
    lines: Line[],
    preRenderedLines: PreRenderedWidget[][],
    settings: Settings
): GroupedMaxWidths;
```

Pure function (no DI needed) → testable in isolation.

### Dispatch point

In `renderAllLines` (top-level render entry):
- If `autoAlign && groupsEnabled`: call `calculateGroupedMaxWidths`, attach result to `RenderContext`.
- If `autoAlign && !groupsEnabled`: call existing `calculateMaxWidthsFromPreRendered` (unchanged).
- If `!autoAlign`: skip both.

Per-line renderer consumption:
- `renderGroupedPowerlineStatusLine` gains a new step (applied after element build, before flex-budget calculation) that walks the line's groups, consults anchor-zone counts for this line, and pads chain/group trailing (or leading) edges according to `GroupedMaxWidths`.
- `renderPowerlineStatusLine` (flat path) is **not modified** — guarantees byte-identity with `main` when `groupsEnabled: false`.

### Data flow

```
preRenderAllWidgets(lines)          ← existing
          │
          ▼
if autoAlign && groupsEnabled:
    calculateGroupedMaxWidths(...)   ← new
else if autoAlign:
    calculateMaxWidthsFromPreRendered(...) ← existing
          │
          ▼
RenderContext enriched with max-widths
          │
          ▼
per line: renderGroupedPowerlineStatusLine (with new padding step) or
          renderPowerlineStatusLine (flat, unchanged)
          │
          ▼
buildPowerlineElements → renderPowerlineElements (both unchanged)
```

## Edge cases

| Situation | Behaviour |
|---|---|
| Line with entirely-hidden group | That line contributes nothing at that group's index to cross-line max arrays |
| Line count differs across lines | Shorter lines don't affect absent indices; longer lines extend naturally at trailing positions |
| Flex position differs per line | Anchor-zone partitioning is per-line. A given group index only participates in cross-line alignment with lines that place the same group index in the same zone (left or right). Lines placing it in different zones don't exert cross-line pressure on each other at that group |
| Only some lines have flex | Non-flex line is fully left-anchored; flex line is zone-split. Left-zone intersection aligns; right-zone of flex line only pressures itself |
| Multiple flex groups (center pattern) | Groups in `[flexStart, flexEnd]` excluded from alignment |
| Hidden widget inside merge chain | Chain effectively shortens; still treated as single slot at its remaining alignment position |
| v3-migrated single-group-per-line | Degenerates to flat behaviour (1 outer slot, widgets aligned inside); see invariant 3 |
| Terminal width exceeded after padding | Existing truncation path applies unchanged |

## Invariants (must hold — tested)

1. **Byte-identity vs `main`**: `groupsEnabled: false` + any `autoAlign` value → output identical to `main` on the same input JSON.
2. **Byte-identity vs PR #3**: `autoAlign: false` + `groupsEnabled: true` → output identical to PR #3 (pre-this-feature) on the same input.
3. **Flat↔grouped equivalence**: `groupsEnabled: true` + every line has exactly 1 group + `autoAlign: true` → output byte-identical to `autoAlign: true` with `groupsEnabled: false` on the flat equivalent.
4. **Right-anchor accuracy**: in a `[left] [flex] [right]` layout, every line's `[right]` group ends at the same terminal column.
5. **Hidden-widget philosophy**: a `when`-hidden widget in a group leaves the pill tight (no bg-colour gap) even if this breaks column alignment of subsequent widgets in the same group on that line — matching `main`'s philosophy.

## Test plan

### Byte-identity tests (`groups-autoalign-byte-identity.test.ts`, new)
- Fixture 1: `autoAlign: true` + `groupsEnabled: false` → compare against `main` rendering.
- Fixture 2: `autoAlign: false` + `groupsEnabled: true` → compare against PR #3 (feature/widget-groups) rendering.
- Fixture 3: `autoAlign: true` + `groupsEnabled: true` + single-group-per-line config → compare against Fixture 1 rendering.

### Unit tests (`calculate-grouped-max-widths.test.ts`, new)
- Uniform shape across lines → exact max values per coordinate.
- Per-line group count differs → absent indices unaffected.
- Hidden widgets filtered → alignment-pos indexing uses visible widgets only.
- Merge chain → chain width summed correctly; chain is one slot.
- Single flex group → anchor zones split correctly; excluded group contributes nothing.
- Multiple flex groups → all groups in `[flexStart, flexEnd]` excluded.
- Flex position differs per line → cross-line max only within intersection.
- Single group per line → flat-equivalent numeric output.

### Powerline ANSI snapshot tests (`powerline-grouped-autoalign.test.ts`, new)
- 2 lines × 3 groups, widget counts differ → both widget-level and group-level alignment visible.
- 2 lines, one line has flex → left zone aligned, flex absorbs slack, right zone aligned.
- 2 lines, `[left] [flex] [right]` with differing right-group widths → rightmost column aligned.
- `when`-hidden widget mid-group → pill stays tight, subsequent widget columns diverge from the other line (philosophy snapshot).

### Integration tests (extend existing `widget-groups` suite)
- PR #3's 5 byte-identity cases × `autoAlign: true/false` → 10 cases. Every case must preserve its current output when `autoAlign: false` (invariant 2) and produce correctly-aligned output when `autoAlign: true`.

### TUI tests
- Powerline OFF: the auto-align setting in `PowerlineSetup` remains inaccessible (existing behaviour; no new gating needed since auto-align lives inside PowerlineSetup already).
- Powerline ON + `groupsEnabled: true` + `autoAlign: true`: rendered preview uses grouped path (verified by asserting on rendered string shape).

### Regression safety
- All existing tests (940 on feature/widget-groups at time of writing) must continue passing.
- `bun run lint` clean. No rule disables introduced.

## Dependencies

- **Must rebase on `feature/widget-groups`** (PR #3) — depends on `Line`/`Group` schema and `renderGroupedPowerlineStatusLine`.
- **Does not depend on `feature/when-triggers`** (PR #1) directly, but `feature/widget-groups` is already rebased on PR #1, so the dependency transits. Hidden widgets via `when` are supported as a natural consequence of `main`'s "empty content filter" logic.

## Rollback

No schema change. Rollback = revert the PR. Existing configs unaffected (still work under PR #3 semantics with `autoAlign` behaving as it did pre-this-PR).

## Open questions

- **Right-anchor padding insertion point.** Padding the *leading* edge of a right-anchor group is conceptually clean but complicates pill bg-colour at the `groupGap | groupStartCap` boundary. Likely simpler to pad the *trailing* edge of the **preceding** group (or the flex-separator content itself) by the required offset. To resolve during implementation — both produce visually identical output, but one may be cleaner code-wise.
- **Assertion failure mode.** The invariant `leftAnchorGroupCount[line] + flexGroupCount[line] + rightAnchorGroupCount[line] == line.groups.length` should be a development-time assertion. Decide: `console.error` + proceed, or hard throw. Recommend dev-assertion behind a `CCSTATUSLINE_DEBUG=1` check to avoid user-visible crashes.
