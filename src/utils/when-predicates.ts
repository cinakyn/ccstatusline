import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    WhenArgs,
    WhenPredicate
} from '../types/When';
import type { WidgetItem } from '../types/Widget';

import {
    getEntry,
    predicateNeedsRenderedTextByKey
} from './when-catalog';

/**
 * Evaluate a single `WhenPredicate` (dotted key) against the current render
 * context, widget item, and rendered text. Dispatches through the catalog —
 * no switch per predicate here; new predicates are added by registering new
 * catalog entries (static `core.*`/`git.*` or dynamic `{widgetType}.{state}`).
 *
 * `args` carries any rule-level arguments (currently only `text.match`'s
 * `pattern`). Predicates that don't need args simply ignore it.
 *
 * Unknown keys evaluate to `false` (they can't match anything). Load-time
 * validation in `config.ts` rejects configs with unknown keys before they
 * reach this code path.
 */
export function evaluatePredicate(
    predicate: WhenPredicate,
    item: WidgetItem,
    context: RenderContext,
    settings: Settings,
    renderedText: string,
    args?: WhenArgs
): boolean {
    const entry = getEntry(predicate);
    if (!entry)
        return false;
    return entry.evaluate(item, context, settings, renderedText, args);
}

/**
 * True if `predicate` requires the widget's rendered text to evaluate
 * (currently only `core.empty`). Callers use this to decide whether to
 * skip the rule during the pre-render pass and re-evaluate after rendering.
 */
export function predicateNeedsRenderedText(predicate: WhenPredicate): boolean {
    return predicateNeedsRenderedTextByKey(predicate);
}