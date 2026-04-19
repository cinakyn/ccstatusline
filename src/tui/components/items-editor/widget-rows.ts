import type { WidgetItem } from '../../../types/Widget';

/**
 * One visible row in the ItemsEditor widget list. The list is a flattened
 * view over `widgets`: every widget contributes a `widget` row; widgets with
 * a non-empty `tags` map also contribute one `tag` row per tag plus a
 * trailing `addTag` row. `widgetIndex` always points back to the underlying
 * `WidgetItem` — it is 1:1 with `widgets` for `widget` rows and identifies
 * the parent widget for `tag`/`addTag` rows.
 */
export type WidgetRow
    = | { kind: 'widget'; widgetIndex: number; widget: WidgetItem }
        | { kind: 'tag'; widgetIndex: number; widget: WidgetItem; tagName: string }
        | { kind: 'addTag'; widgetIndex: number; widget: WidgetItem };

/**
 * Expand `widgets` into the flat row list used by ItemsEditor's renderer and
 * keyboard navigation. Each widget contributes exactly one row; tag management
 * lives in the conditional-action editor (WidgetWhenEditor) and is not
 * surfaced on the widget list.
 */
export function buildWidgetRows(widgets: WidgetItem[]): WidgetRow[] {
    const rows: WidgetRow[] = [];
    for (let i = 0; i < widgets.length; i++) {
        const widget = widgets[i];
        if (!widget)
            continue;
        rows.push({ kind: 'widget', widgetIndex: i, widget });
    }
    return rows;
}

/** Separators and flex separators never own tags. */
export function canHaveTags(widget: WidgetItem): boolean {
    return widget.type !== 'separator' && widget.type !== 'flex-separator';
}

/** Index in `rows` of the widget row for `widgetIndex`, or -1 if missing. */
export function findWidgetRowIndex(rows: WidgetRow[], widgetIndex: number): number {
    return rows.findIndex(row => row.kind === 'widget' && row.widgetIndex === widgetIndex);
}