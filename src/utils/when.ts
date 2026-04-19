import type { RenderContext } from '../types/RenderContext';
import type {
    WhenPredicate,
    WhenRule
} from '../types/When';

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

export type PredicateEvaluator = (
    predicate: WhenPredicate,
    context: RenderContext,
    renderedText: string
) => boolean;

export interface EvaluateWhenOptions {
    /**
     * When true, any rule whose predicate needs rendered text (currently
     * only `empty`) is skipped. Used during the pre-render pass to defer
     * empty evaluation until after widgets have produced output.
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
 * Semantics (from docs/when-triggers/spec.md — "Evaluation semantics"):
 *   1. `hide` is union-OR across all matching rules — every rule is
 *      evaluated, no short-circuit.
 *   2. `color`/`bg`/`bold` overrides are last-wins.
 *   3. `options.skipEmpty = true` skips any rule whose predicate is `empty`
 *      (used for the pre-render pass before widget text exists).
 */
export function evaluateWhen(
    rules: WhenRule[] | undefined,
    context: RenderContext,
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

        const matches = evaluator(rule.on, context, renderedText);
        if (debug) {
            process.stderr.write(
                `[when] on=${rule.on} do=${rule.do} match=${String(matches)}\n`
            );
        }
        if (!matches)
            continue;

        switch (rule.do) {
            case 'hide':
                result.hide = true;
                break;
            case 'color':
                if (typeof rule.value === 'string')
                    result.colorOverride = rule.value;
                break;
            case 'bg':
                if (typeof rule.value === 'string')
                    result.bgOverride = rule.value;
                break;
            case 'bold':
                if (typeof rule.value === 'boolean')
                    result.boldOverride = rule.value;
                break;
        }
    }

    return result;
}

/**
 * True if any rule in the list uses a predicate that requires rendered text
 * (currently only `empty`). Callers use this to decide whether a post-render
 * evaluation pass is needed after the pre-render `skipEmpty` pass.
 */
export function hasEmptyPredicate(rules: WhenRule[] | undefined): boolean {
    return rules?.some(rule => predicateNeedsRenderedText(rule.on)) ?? false;
}