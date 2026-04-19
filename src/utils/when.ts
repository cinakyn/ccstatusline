import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    WhenArgs,
    WhenPredicate,
    WhenRule
} from '../types/When';
import type { WidgetItem } from '../types/Widget';

import {
    evaluatePredicate,
    predicateNeedsRenderedText
} from './when-predicates';

export interface WhenResult {
    hide: boolean;
    colorOverride?: string;
    bgOverride?: string;
    boldOverride?: boolean;
}

type PredicateEvaluator = (
    predicate: WhenPredicate,
    item: WidgetItem,
    context: RenderContext,
    settings: Settings,
    renderedText: string,
    args?: WhenArgs
) => boolean;

export interface EvaluateWhenOptions {
    /**
     * When true, any rule whose predicate needs rendered text (currently
     * only `core.empty`) is skipped. Used during the pre-render pass to
     * defer empty evaluation until after widgets have produced output.
     */
    skipEmpty?: boolean;
    /**
     * When true, ONLY rules whose predicate needs rendered text are evaluated;
     * all others are skipped. Used during the post-render pass to avoid
     * re-evaluating (and re-logging) non-empty rules that already ran in the
     * pre-render pass.
     */
    onlyEmpty?: boolean;
    /**
     * Optional injection seam for tests. Defaults to the real
     * `evaluatePredicate` exported from `./when-predicates`.
     */
    evaluator?: PredicateEvaluator;
}

/**
 * Apply a list of `WhenRule`s against the current render context and widget
 * text, collecting the resulting hide decision and style overrides.
 *
 * Semantics:
 *   1. `hide` is union-OR across all matching rules — every rule is
 *      evaluated, no short-circuit.
 *   2. `setTag` overrides are FIRST-wins per field (rule-list order). Rule 1
 *      has highest priority: once a field (color / backgroundColor / bold)
 *      has been set, later matching `setTag` rules leave it alone. Fields not
 *      yet set can still be filled by later rules.
 *   3. `options.skipEmpty = true` skips any rule whose predicate needs
 *      rendered text (used for the pre-render pass before widget text
 *      exists).
 */
export function evaluateWhen(
    rules: WhenRule[] | undefined,
    item: WidgetItem,
    context: RenderContext,
    settings: Settings,
    renderedText: string,
    options: EvaluateWhenOptions = {}
): WhenResult {
    const result: WhenResult = { hide: false };
    if (!rules || rules.length === 0) {
        return result;
    }

    const evaluator = options.evaluator ?? evaluatePredicate;
    const debug = process.env.CCSTATUSLINE_DEBUG === '1';

    for (const rule of rules) {
        const needsText = predicateNeedsRenderedText(rule.on);
        if (options.skipEmpty && needsText) {
            continue;
        }
        if (options.onlyEmpty && !needsText) {
            continue;
        }

        const matches = evaluator(rule.on, item, context, settings, renderedText, rule.args);
        if (debug) {
            const extra = rule.do === 'setTag' ? ` tag=${rule.tag}` : '';
            process.stderr.write(
                `[when] on=${rule.on} do=${rule.do}${extra} match=${String(matches)}\n`
            );
        }
        if (!matches)
            continue;

        if (rule.do === 'hide') {
            result.hide = true;
            continue;
        }

        // rule.do === 'setTag'
        const tagStyle = item.tags?.[rule.tag];
        if (!tagStyle) {
            // Reference integrity is enforced at load time; if we get here
            // the config was mutated at runtime past validation. Silently
            // skip rather than crash the render.
            continue;
        }
        if (tagStyle.color !== undefined && result.colorOverride === undefined)
            result.colorOverride = tagStyle.color;
        if (tagStyle.backgroundColor !== undefined && result.bgOverride === undefined)
            result.bgOverride = tagStyle.backgroundColor;
        if (tagStyle.bold !== undefined && result.boldOverride === undefined)
            result.boldOverride = tagStyle.bold;
    }

    return result;
}

/**
 * True if any rule in the list uses a predicate that requires rendered text
 * (currently only `core.empty`). Callers use this to decide whether a
 * post-render evaluation pass is needed after the pre-render `skipEmpty` pass.
 */
export function hasEmptyPredicate(rules: WhenRule[] | undefined): boolean {
    return rules?.some(rule => predicateNeedsRenderedText(rule.on)) ?? false;
}