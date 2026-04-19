import { z } from 'zod';

import type { RenderContext } from './RenderContext';
import type { Settings } from './Settings';
import { WhenRuleSchema } from './When';

/**
 * Per-widget style variant. Stored under `WidgetItem.tags[tagName]`. A
 * `when` rule with `do: 'setTag'` points at one of these entries; when the
 * rule matches, its `color`/`backgroundColor`/`bold` overrides are applied
 * on top of the widget's defaults.
 */
export const TagStyleSchema = z.object({
    color: z.string().optional(),
    backgroundColor: z.string().optional(),
    bold: z.boolean().optional()
});

export type TagStyle = z.infer<typeof TagStyleSchema>;

// Widget item schema - accepts any string type for forward compatibility
export const WidgetItemSchema = z.object({
    id: z.string(),
    type: z.string(),
    color: z.string().optional(),
    backgroundColor: z.string().optional(),
    bold: z.boolean().optional(),
    character: z.string().optional(),
    rawValue: z.boolean().optional(),
    customText: z.string().optional(),
    customSymbol: z.string().optional(),
    commandPath: z.string().optional(),
    maxWidth: z.number().optional(),
    preserveColors: z.boolean().optional(),
    timeout: z.number().optional(),
    merge: z.union([z.boolean(), z.literal('no-padding')]).optional(),
    hide: z.boolean().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    when: z.array(WhenRuleSchema).optional(),
    tags: z.record(z.string(), TagStyleSchema).optional()
});

// Inferred types from Zod schemas
export type WidgetItem = z.infer<typeof WidgetItemSchema>;
export type WidgetItemType = string; // Allow any string for forward compatibility

export interface WidgetEditorDisplay {
    displayText: string;
    modifierText?: string;
}

export interface Widget {
    getDefaultColor(): string;
    getDescription(): string;
    getDisplayName(): string;
    getCategory(): string;
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay;
    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null;
    getCustomKeybinds?(item?: WidgetItem): CustomKeybind[];
    renderEditor?(props: WidgetEditorProps): React.ReactElement | null;
    supportsRawValue(): boolean;
    supportsColors(item: WidgetItem): boolean;
    handleEditorAction?(action: string, item: WidgetItem): WidgetItem | null;
    getNumericValue?(context: RenderContext, item: WidgetItem): number | null;
}

/**
 * A widget whose rendered output varies based on an internal state
 * (e.g. vim mode, thinking effort level, model name). Implementing this
 * interface makes the widget eligible for category-namespaced `when`
 * predicates (`{category}.{state}`) and `setTag` overrides.
 */
export interface StatefulWidget extends Widget {
    /**
     * Returns the current state key (e.g. 'insert', 'opus', 'high') based on
     * the render context and the item, or null if no state can be resolved.
     */
    getStateKey(item: WidgetItem, context: RenderContext, settings: Settings): string | null;
    /**
     * Returns all possible state keys. Used by the `when-catalog` to
     * enumerate category-namespaced predicates for this widget.
     */
    getAllStates(): string[];
}

/** Runtime type guard: does `widget` implement `StatefulWidget`? */
export function isStatefulWidget(widget: Widget): widget is StatefulWidget {
    return typeof (widget as Partial<StatefulWidget>).getStateKey === 'function'
        && typeof (widget as Partial<StatefulWidget>).getAllStates === 'function';
}

export interface WidgetEditorProps {
    widget: WidgetItem;
    onComplete: (updatedWidget: WidgetItem) => void;
    onCancel: () => void;
    action?: string;
}

export interface CustomKeybind {
    key: string;
    label: string;
    action: string;
}