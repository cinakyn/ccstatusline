# PR #3 — Widget Groups (schema v4 + powerline redesign): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Introduce a `line → group → widget` hierarchy so a single status line can contain multiple visually distinct pills separated by plain-space gaps. Powerline renderer is redesigned with a split symbol vocabulary so group boundaries become first-class citizens.

**Architecture:** Schema v4 with automatic v3→v4 migration. New `Group` entity between `Line` and `Widget`. `groupsEnabled` feature flag preserves v3 flat behavior when off. Powerline symbol vocabulary split into `widgetSeparator`, `groupStartCap`/`groupEndCap`, `groupGap`, `lineStartCap`/`lineEndCap`.

**Invariants:**
- `groupsEnabled: false` + v3 config → byte-identical rendered output compared to current `main`.
- `groupsEnabled: true` + single group per line → byte-identical to `groupsEnabled: false`.
- `continuousColor: true` on the only group in a line → theme cycles identically to v3.

**Spec:** `.tmp/pr3-widget-groups.md` (copied to `docs/widget-groups/spec.md`)

---

## Scope decision: 3-stage landing

Given PR #3 is ~3× the scope of PR #1, split into three landable substages on the same branch, each its own mergeable commit series. The upstream PR can be either a single big one or broken out if maintainer prefers.

### Stage A — Schema + Migration + `groupsEnabled=false` invariant
The foundation. v4 schema, v3→v4 load-time migration, version bump, `.v3.bak` automatic backup. When `groupsEnabled: false`, renderer uses the v4 shape internally but treats each line as one group — byte-identical to current main. No visible behavior change yet.

### Stage B — Plain + powerline group rendering
`groupsEnabled: true` actually does something. Plain mode emits gaps between groups. Powerline mode emits the split symbol vocabulary. `continuousColor` controls theme cycling. `flex-separator` scope + `merge` scope fixed to group boundaries.

### Stage C — TUI group editor + integration tests
Items editor gets the group layer. Navigation breadcrumb shows `line → group → widget`. `groupsEnabled` toggle in global settings.

---

## File structure

| File | Responsibility | Stage |
|---|---|---|
| `src/types/Group.ts` | `GroupSchema`, `Group` type | A |
| `src/types/Settings.ts` | Bump `CURRENT_VERSION` to 4, replace line type, add `groupsEnabled` + `defaultGroupGap`, v4 powerline symbols | A |
| `src/utils/migrations.ts` | Add v3→v4 migration, `settings.json.v3.bak` write, keep existing chain | A |
| `src/utils/config.ts` | Migration dispatch, backup timing | A |
| `src/utils/groups.ts` | Helpers: `flattenGroups(line): WidgetItem[]`, `linesToGroups(lines): GroupedLine[]` | A |
| `src/utils/renderer.ts` | Plain render: outer group loop + gap, powerline: group boundary caps + widget separator + group gap | B |
| `src/tui/components/ItemsEditor.tsx` | Show groups in tree; add group, delete group, reorder | C |
| `src/types/PowerlineConfig.ts` | Add `groupStartCap`, `groupEndCap`, `groupGap`, `widgetSeparator`, `lineStartCap`, `lineEndCap` | B |
| `src/utils/__tests__/migrations-v4.test.ts` | v3→v4 round-trip byte-identity | A |
| `src/utils/__tests__/groups.test.ts` | Helper tests | A |
| `src/widgets/__tests__/GroupsIntegration.test.ts` | End-to-end render assertions | B |

---

## Stage A — Foundation (schema + migration + invariant)

### Task A1: Define `Group` schema, extend Settings

**Files:**
- Create `src/types/Group.ts`
- Modify `src/types/Settings.ts`
- Test: `src/types/__tests__/Group.test.ts`

- [ ] **Step 1: Write failing schema tests** — parse valid group with widgets, parse with optional gap / continuousColor, reject invalid widget list.

- [ ] **Step 2: Create `src/types/Group.ts`**:
```typescript
import { z } from 'zod';
import { WidgetItemSchema } from './Widget';

export const GroupSchema = z.object({
    gap: z.string().optional(),
    continuousColor: z.boolean().optional().default(true),
    widgets: z.array(WidgetItemSchema)
});

export const LineSchema = z.object({
    groups: z.array(GroupSchema)
});

export type Group = z.infer<typeof GroupSchema>;
export type Line = z.infer<typeof LineSchema>;
```

- [ ] **Step 3: Modify `src/types/Settings.ts`**:
  - Import `LineSchema`.
  - Bump `CURRENT_VERSION = 4`.
  - Replace `lines: z.array(z.array(WidgetItemSchema)).min(1).default(...)` with `lines: z.array(LineSchema).min(1).default(...)`. Default value: one line with one group containing the current default widgets.
  - Add `groupsEnabled: z.boolean().default(false)`.
  - Add `defaultGroupGap: z.string().default('  ')`.
  - Retain `SettingsSchema_v1` and `SettingsSchema_v2` if they exist (for migration chain). Add `SettingsSchema_v3` capturing the v3 shape (array of widget arrays).

- [ ] **Step 4: Run tests, lint, commit** `feat(groups): schema v4 with Group type`.

### Task A2: v3→v4 migration

**Files:**
- Modify `src/utils/migrations.ts`
- Test: `src/utils/__tests__/migrations-v4.test.ts`

- [ ] **Step 1: Write failing migration tests**:
  - v3 config with N lines, each containing K widgets → v4 config with N lines, each with 1 group containing K widgets.
  - `continuousColor: true` default preserved.
  - `gap` uses `defaultGroupGap`.
  - `version: 3` becomes `version: 4`.
  - Fixtures covering 10 realistic v3 shapes (simple, with merge, with flex-separator, with powerline custom caps).

- [ ] **Step 2: Add migration to `migrations.ts`**:
```typescript
{
    fromVersion: 3,
    toVersion: 4,
    description: 'Migrate from v3 to v4: wrap each line in a single group',
    migrate: (data) => {
        const migrated = { ...data };
        const lines = (data.lines as unknown[][] | undefined) ?? [];
        migrated.lines = lines.map(widgets => ({
            groups: [{ continuousColor: true, widgets }]
        }));
        migrated.version = 4;
        return migrated;
    }
}
```

- [ ] **Step 3: `src/utils/config.ts` backup before first v4 save**:
  - Before `writeSettingsJson` with v4 data, if no `settings.json.v3.bak` exists AND the on-disk file is v3, copy it to `.v3.bak`.

- [ ] **Step 4: Commit** `feat(groups): v3→v4 config migration + automatic backup`.

### Task A3: Groups helpers + byte-identical invariant

**Files:**
- Create `src/utils/groups.ts`
- Modify `src/utils/renderer.ts` — minimal: `preRenderAllWidgets` accepts `LineSchema` shape, flattens to `WidgetItem[]` when `groupsEnabled: false`.

- [ ] **Step 1: Helper functions**:
  - `flattenLineGroups(line: Line): WidgetItem[]` — concat all widgets with synthetic `separator` widgets between groups.
  - `lineWidgets(line: Line): WidgetItem[]` — just concat (for code that doesn't care about separators).

- [ ] **Step 2: Update `preRenderAllWidgets` signature**:
  - Input: `Line[]` (not `WidgetItem[][]`).
  - When `!settings.groupsEnabled`, call `flattenLineGroups(line)` to get widget list identical to v3.
  - When `groupsEnabled: true` but `groups.length === 1`, same result.

- [ ] **Step 3: Update all callers** — `renderAllLines` / `renderStatusLine` / etc.

- [ ] **Step 4: Run full existing test suite** — 785 tests must still pass unchanged when configs are migrated v3→v4 automatically and `groupsEnabled: false` by default.

- [ ] **Step 5: Add one explicit byte-identity test** — take a v3 fixture, migrate, render, compare to a baseline snapshot taken from pre-PR render of the same fixture.

- [ ] **Step 6: Commit** `feat(groups): preserve byte-identical v3 render under groupsEnabled=false`.

---

## Stage B — Group-aware rendering

### Task B1: Plain mode group rendering

**Files:**
- Modify `src/utils/renderer.ts`

- [ ] Extend `renderStatusLine` to accept a grouped line when `groupsEnabled: true`. Outer loop: groups. Between groups: emit `group.gap ?? settings.defaultGroupGap` (no color).
- [ ] Preserve existing `inheritSeparatorColors` behavior inside a group.
- [ ] Test: multi-group plain render emits gaps. Single-group plain render identical to v3.
- [ ] Commit `feat(groups): plain-mode group rendering`.

### Task B2: Powerline symbol vocabulary split

**Files:**
- Modify `src/types/PowerlineConfig.ts` — add `widgetSeparator: string[]`, `groupStartCap: string[]`, `groupEndCap: string[]`, `groupGap: string`. Migration: old `separators` → `widgetSeparator`, old `startCaps`/`endCaps` → `groupStartCap`/`groupEndCap` AND `lineStartCap`/`lineEndCap`.

- [ ] Migrate in v3→v4 step.
- [ ] Test migration preserves v3 render byte-identically.
- [ ] Commit `feat(groups): powerline symbol vocabulary split`.

### Task B3: Powerline group rendering

**Files:**
- Modify `src/utils/renderer.ts` — `renderPowerlineStatusLine` becomes group-aware.

- [ ] Render sequence: `[lineStartCap] (groupStartCap W₁ sep ... Wₙ groupEndCap) groupGap ... [lineEndCap]`.
- [ ] `continuousColor`: when false, `widgetColorIndex` resets at group start.
- [ ] `flex-separator` scope: only inside a group; free space divided equally among groups containing flex; groups without flex don't expand.
- [ ] `merge` scope: terminates at group boundaries.
- [ ] Test: 2-group, 3-group, 5-group layouts; flex in one group; flex in two groups; merge across group boundary (must terminate).
- [ ] Commit `feat(groups): powerline multi-group rendering`.

### Task B4: Group hide propagation (optional — depends on PR #1)

**Files:**
- Modify `src/utils/renderer.ts`

- [ ] If every widget in a group is `hidden`, drop the group including its preceding gap and caps. (Applies in both plain and powerline modes.)
- [ ] Skip this task if PR #1 (`when`) hasn't merged yet; note as follow-up in spec.

---

## Stage C — TUI

### Task C1: Items editor group layer

**Files:**
- Modify `src/tui/components/ItemsEditor.tsx` + sibling files.

- [ ] Expose group-level navigation when `groupsEnabled: true`. Default flat when off.
- [ ] Add-group / delete-group / rename-gap actions.
- [ ] Per-group toggle for `continuousColor`.

### Task C2: Global settings

- [ ] `groupsEnabled` toggle in global settings menu.
- [ ] `defaultGroupGap` editable.
- [ ] Commit.

### Task C3: Integration tests + final verification

- [ ] End-to-end: config with 2 groups → renderStatusLine → assert gap appears and groups render in powerline with correct caps.
- [ ] Group with `continuousColor: false` → assert theme palette resets.
- [ ] TUI navigation breadcrumb test.
- [ ] Full `bun test`, `bun run lint`, smoke.
- [ ] Commit and open PR.

---

## Risks + mitigations

1. **Migration breaks existing configs.** Mitigation: automatic `.v3.bak` backup; integration tests over 10 real-world v3 fixtures with byte-identical render assertion.
2. **Powerline color transitions across groups are tricky.** Mitigation: `continuousColor` default `true` preserves existing behavior; false is an opt-in.
3. **TUI complexity may bloat PR.** Mitigation: Stage C can be a follow-up PR if scope creeps — ship A+B first and users hand-edit `settings.json` for groups, same pattern as PR #2 deferred its TUI.
4. **Depends on PR #1 for hide propagation.** Mitigation: B4 is optional; if PR #1 isn't merged, groups render regardless of widget visibility (same as current behavior).

## Self-review

- [x] Every spec section mapped to a task.
- [x] Invariants explicit.
- [x] Stage split allows incremental landing.
- [x] Non-goals documented (auto-align — PR #4, wrapping — PR #4, group-level `when` — deferred, nested groups — not planned).
