import type { Line } from '../types/Group';
import type { WidgetItem } from '../types/Widget';

/**
 * Flatten a Line's groups into a single array of widgets.
 *
 * Stage A uses this everywhere a caller previously treated a line as
 * `WidgetItem[]`. Downstream rendering/iteration semantics stay identical
 * because groups preserve widget order and this helper concatenates them
 * left-to-right.
 */
export function lineWidgets(line: Line): WidgetItem[] {
    return line.groups.flatMap(g => g.widgets);
}

/**
 * Write a flat-mode widget array back into a Line, preserving any additional
 * groups beyond the first. Only groups[0].widgets is rewritten; groups[1..N]
 * are passed through untouched so the round-trip invariant holds when
 * groupsEnabled is toggled off, edited, then toggled back on.
 *
 * If the existing line has no groups (unusual), a single group is created.
 * Preserves existing groups[0].gap and groups[0].continuousColor when present,
 * defaulting continuousColor to true.
 */
/**
 * Write an all-groups-flattened widget array back into a Line, preserving the
 * original group structure by matching widgets by id. Unlike `writeFlatWidgets`
 * (which targets groups[0] only), this preserves every group's widget count —
 * use it when the caller flattened ALL groups via `lineWidgets()` and the
 * updates are in-place edits (no insertions / deletions), e.g. color changes.
 *
 * Widgets whose id is not in the incoming map are left as-is.
 */
export function writeAllGroupsWidgets(existing: Line | undefined, widgets: WidgetItem[]): Line {
    const byId = new Map(widgets.map(w => [w.id, w]));
    const existingGroups = existing?.groups ?? [];
    if (existingGroups.length === 0) {
        return { groups: [{ continuousColor: true, widgets }] };
    }
    return {
        groups: existingGroups.map(g => ({
            ...g,
            widgets: g.widgets.map(w => byId.get(w.id) ?? w)
        }))
    };
}

export function writeFlatWidgets(existing: Line | undefined, widgets: WidgetItem[]): Line {
    const existingGroups = existing?.groups ?? [];
    const priorGroup = existingGroups[0];
    const continuousColor = priorGroup?.continuousColor ?? true;
    const firstGroup = {
        ...(priorGroup?.gap !== undefined ? { gap: priorGroup.gap } : {}),
        continuousColor,
        widgets
    };
    return { groups: [firstGroup, ...existingGroups.slice(1)] };
}