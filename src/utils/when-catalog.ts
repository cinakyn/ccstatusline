import type { Line } from '../types/Group';
import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { WhenArgs } from '../types/When';
import type { WidgetItem } from '../types/Widget';
import { isStatefulWidget } from '../types/Widget';

import {
    getGitStatus,
    isInsideGitWorkTree
} from './git';
import {
    getForkStatus,
    getUpstreamRemoteInfo
} from './git-remote';
import { lineWidgets } from './groups';
import { WIDGET_MANIFEST } from './widget-manifest';
import { getWidget } from './widgets';

/**
 * One entry in the when-predicate catalog. Each predicate is identified by a
 * dotted key (`{category}.{value}`) and reports a human label, whether it
 * applies to a given widget, and how to evaluate it at render time.
 *
 * The catalog is the single source of truth consumed by:
 *   - settings load-time validation (`isValidForItem`)
 *   - predicate dispatch (`when-predicates.ts`)
 *   - TUI pickers (category + predicate lists)
 *
 * Static builtins cover `core.*` (post-render) and `git.*` (pre-render).
 * Dynamic entries are derived from the widget registry: any widget
 * implementing `StatefulWidget` contributes `{widgetType}.{state}` keys built
 * from its `getAllStates()` list.
 */
export interface WhenPredicateEntry {
    key: string;
    category: string;
    label: string;
    /** True if this predicate's evaluation only makes sense after render. */
    needsRenderedText: boolean;
    /**
     * Names of required `args` keys (all strings). Load-time validation rejects
     * rules that omit any listed arg. Omit / return [] for predicates that
     * need no arguments (the common case).
     */
    requiredArgs?: readonly string[];
    /** True if this predicate may be attached to `item`. */
    appliesTo(item: WidgetItem): boolean;
    /** Evaluate the predicate against render context / rendered text. */
    evaluate(
        item: WidgetItem,
        context: RenderContext,
        settings: Settings,
        renderedText: string,
        args?: WhenArgs
    ): boolean;
}

// ---------------------------------------------------------------------------
// Static (non-widget-specific) predicates
// ---------------------------------------------------------------------------

const CORE_EMPTY: WhenPredicateEntry = {
    key: 'core.empty',
    category: 'Core',
    label: 'Rendered output is empty',
    needsRenderedText: true,
    appliesTo: () => true,
    evaluate: (_item, _ctx, _settings, renderedText) => renderedText.length === 0
};

const GIT_NO_GIT: WhenPredicateEntry = {
    key: 'git.no-git',
    category: 'Git',
    label: 'Current directory is not a Git repository',
    needsRenderedText: false,
    appliesTo: () => true,
    evaluate: (_item, ctx) => !isInsideGitWorkTree(ctx)
};

const GIT_NO_REMOTE: WhenPredicateEntry = {
    key: 'git.no-remote',
    category: 'Git',
    label: 'Current branch has no upstream remote',
    needsRenderedText: false,
    appliesTo: () => true,
    evaluate: (_item, ctx) => getUpstreamRemoteInfo(ctx) === null
};

const GIT_NOT_FORK: WhenPredicateEntry = {
    key: 'git.not-fork',
    category: 'Git',
    label: 'Repository is not a fork of another repo',
    needsRenderedText: false,
    appliesTo: () => true,
    evaluate: (_item, ctx) => !getForkStatus(ctx).isFork
};

/**
 * Clean repo: either not inside a git work tree at all (no repo), or inside
 * one whose `git status --porcelain` is empty. Using the working-tree check
 * first avoids an unnecessary second git invocation when the cwd is not a
 * repo (the cache already has the answer).
 */
const GIT_CLEAN: WhenPredicateEntry = {
    key: 'git.clean',
    category: 'Git',
    label: 'Working tree is clean (no changes, or not a Git repo)',
    needsRenderedText: false,
    appliesTo: () => true,
    evaluate: (_item, ctx) => {
        if (!isInsideGitWorkTree(ctx))
            return true;
        const status = getGitStatus(ctx);
        return !status.staged && !status.unstaged && !status.untracked && !status.conflicts;
    }
};

/**
 * Regex match against the widget's rendered text. Invalid patterns evaluate
 * to `false` — a mis-typed regex must not silently match everything. The
 * evaluation uses a fresh `RegExp` per call; patterns are expected to be
 * short, so this is acceptable overhead.
 */
const TEXT_MATCH: WhenPredicateEntry = {
    key: 'text.match',
    category: 'Text',
    label: 'Rendered output matches a regex pattern',
    needsRenderedText: true,
    requiredArgs: ['pattern'],
    appliesTo: () => true,
    evaluate: (_item, _ctx, _settings, renderedText, args) => {
        const pattern = args?.pattern;
        if (typeof pattern !== 'string' || pattern.length === 0)
            return false;
        try {
            return new RegExp(pattern).test(renderedText);
        } catch {
            return false;
        }
    }
};

const STATIC_ENTRIES: WhenPredicateEntry[] = [
    CORE_EMPTY,
    GIT_NO_GIT,
    GIT_NO_REMOTE,
    GIT_NOT_FORK,
    GIT_CLEAN,
    TEXT_MATCH
];

// ---------------------------------------------------------------------------
// Dynamic (widget-state) predicates
// ---------------------------------------------------------------------------

/**
 * Build a `{widgetType}.{state}` entry. The predicate applies only when
 * `item.type` matches, and evaluates by comparing the widget's current
 * `getStateKey` against the literal state value (case-insensitive).
 */
function makeStatefulEntry(
    widgetType: string,
    state: string,
    category: string,
    widgetName: string
): WhenPredicateEntry {
    const key = `${widgetType}.${state}`;
    const stateLabel = humanizeState(state);
    return {
        key,
        category,
        label: `${widgetName} is ${stateLabel}`,
        needsRenderedText: false,
        appliesTo: item => item.type === widgetType,
        evaluate: (item, ctx, settings) => {
            if (item.type !== widgetType)
                return false;
            const widget = getWidget(widgetType);
            if (!widget || !isStatefulWidget(widget))
                return false;
            const current = widget.getStateKey(item, ctx, settings);
            if (current === null)
                return false;
            return current.toLowerCase() === state.toLowerCase();
        }
    };
}

/**
 * Convert a raw state key (`insert`, `xhigh`, `no-git`, `claude-3-7-sonnet`)
 * into the user-facing label. Hyphenated segments become space-separated
 * title-cased words; recognised short forms map to friendlier renderings
 * (e.g. `xhigh → X-High`, `max → Max`).
 */
function humanizeState(state: string): string {
    const special: Record<string, string> = {
        'xhigh': 'X-High',
        'no-git': 'No Git',
        'no-remote': 'No Remote',
        'not-fork': 'Not a Fork'
    };
    if (special[state])
        return special[state];
    return state
        .split('-')
        .filter(part => part.length > 0)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

/**
 * Build the dynamic half of the catalog from the widget registry. The
 * registry is populated at module load, so this runs once per process on
 * first call via `getAllEntries()`.
 */
function buildDynamicEntries(): WhenPredicateEntry[] {
    const entries: WhenPredicateEntry[] = [];

    for (const manifestEntry of WIDGET_MANIFEST) {
        const widget = getWidget(manifestEntry.type);
        if (!widget || !isStatefulWidget(widget))
            continue;
        const category = widget.getCategory();
        const widgetName = widget.getDisplayName();
        for (const state of widget.getAllStates()) {
            entries.push(makeStatefulEntry(manifestEntry.type, state, category, widgetName));
        }
    }

    return entries;
}

// ---------------------------------------------------------------------------
// Catalog cache + public API
// ---------------------------------------------------------------------------

interface CatalogCache {
    entries: WhenPredicateEntry[];
    byKey: Map<string, WhenPredicateEntry>;
}

let cache: CatalogCache | null = null;

function getCache(): CatalogCache {
    if (cache === null) {
        const entries = [...STATIC_ENTRIES, ...buildDynamicEntries()];
        const byKey = new Map(entries.map(e => [e.key, e]));
        cache = { entries, byKey };
    }
    return cache;
}

function getAllEntries(): WhenPredicateEntry[] {
    return getCache().entries;
}

function getByKeyMap(): Map<string, WhenPredicateEntry> {
    return getCache().byKey;
}

/**
 * Look up a predicate entry by its dotted key.
 * Returns null for unknown keys.
 */
export function getEntry(key: string): WhenPredicateEntry | null {
    return getByKeyMap().get(key) ?? null;
}

/** True if `key` is a registered predicate (regardless of widget applicability). */
export function isKnownKey(key: string): boolean {
    return getByKeyMap().has(key);
}

/**
 * Load-time validation: `key` must exist AND be applicable to the given
 * widget. Used to reject e.g. `vim-mode.insert` attached to a `git-branch`.
 */
export function isValidForItem(key: string, item: WidgetItem): boolean {
    const entry = getEntry(key);
    if (!entry)
        return false;
    return entry.appliesTo(item);
}

/** List of categories that have at least one predicate applicable to `item`. */
export function listCategories(item: WidgetItem): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const entry of getAllEntries()) {
        if (!entry.appliesTo(item))
            continue;
        if (seen.has(entry.category))
            continue;
        seen.add(entry.category);
        order.push(entry.category);
    }
    return order;
}

/** Predicates in a given category that are applicable to `item`. */
export function listPredicates(item: WidgetItem, category: string): WhenPredicateEntry[] {
    return getAllEntries().filter(e => e.appliesTo(item) && e.category === category);
}

/** Predicates that need the rendered text to evaluate (currently `core.empty`). */
export function predicateNeedsRenderedTextByKey(key: string): boolean {
    return getEntry(key)?.needsRenderedText ?? false;
}

/**
 * Test-only: clear the cached catalog. Useful when tests swap in fake
 * widgets; production code should never call this.
 */
export function _resetCatalogForTests(): void {
    cache = null;
}

/**
 * Load-time validation of every `when` rule across a settings object. Three
 * failure modes are surfaced (all as descriptive `Error`s):
 *
 *   1. `on` references an unknown predicate key.
 *   2. `on` references a known key that isn't applicable to the item's type
 *      (e.g. `vim-mode.insert` attached to a `git-branch`).
 *   3. `do: 'setTag'` references a `tag` not present in `item.tags`.
 *
 * Returns the list of error messages (empty = valid). Caller decides whether
 * to throw or recover.
 */
export function validateWhenRulesInSettings(
    lines: readonly Line[]
): string[] {
    const errors: string[] = [];
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        if (!line)
            continue;
        for (const item of lineWidgets(line)) {
            if (!item.when)
                continue;
            const prefix = `line ${lineIdx + 1} widget ${item.type} (id=${item.id})`;
            for (const rule of item.when) {
                if (!isKnownKey(rule.on)) {
                    errors.push(`${prefix}: unknown predicate '${rule.on}'`);
                    continue;
                }
                if (!isValidForItem(rule.on, item)) {
                    errors.push(
                        `${prefix}: predicate '${rule.on}' does not apply to widget type '${item.type}'`
                    );
                }
                if (rule.do === 'setTag') {
                    const tagPresent = item.tags !== undefined && rule.tag in item.tags;
                    if (!tagPresent) {
                        errors.push(
                            `${prefix}: setTag rule references missing tag '${rule.tag}' (available: ${
                                item.tags ? Object.keys(item.tags).join(', ') || '<none>' : '<none>'
                            })`
                        );
                    }
                }
                const entry = getEntry(rule.on);
                if (entry?.requiredArgs && entry.requiredArgs.length > 0) {
                    for (const argKey of entry.requiredArgs) {
                        const value = rule.args?.[argKey];
                        if (typeof value !== 'string' || value.length === 0) {
                            errors.push(
                                `${prefix}: predicate '${rule.on}' requires argument '${argKey}'`
                            );
                        }
                    }
                }
            }
        }
    }
    return errors;
}