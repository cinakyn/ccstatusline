import type {
    WhenPredicate,
    WhenRule
} from '../types/When';
import type {
    TagStyle,
    WidgetItem
} from '../types/Widget';

import { generateGuid } from './guid';

// Type for migration functions
interface Migration {
    fromVersion: number;
    toVersion: number;
    description: string;
    migrate: (data: Record<string, unknown>) => Record<string, unknown>;
}

type V1MigratedField
    = | 'flexMode'
        | 'compactThreshold'
        | 'colorLevel'
        | 'defaultSeparator'
        | 'defaultPadding'
        | 'inheritSeparatorColors'
        | 'overrideBackgroundColor'
        | 'overrideForegroundColor'
        | 'globalBold';

interface V1FieldRule {
    key: V1MigratedField;
    isValid: (value: unknown) => boolean;
}

// Type guards for checking data structure
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const V1_FIELD_RULES: V1FieldRule[] = [
    {
        key: 'flexMode',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'compactThreshold',
        isValid: value => typeof value === 'number'
    },
    {
        key: 'colorLevel',
        isValid: value => typeof value === 'number'
    },
    {
        key: 'defaultSeparator',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'defaultPadding',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'inheritSeparatorColors',
        isValid: value => typeof value === 'boolean'
    },
    {
        key: 'overrideBackgroundColor',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'overrideForegroundColor',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'globalBold',
        isValid: value => typeof value === 'boolean'
    }
];

function toWidgetLine(line: unknown[], stripSeparators: boolean): WidgetItem[] {
    const lineToProcess = stripSeparators
        ? line.filter((item) => {
            if (isRecord(item)) {
                return item.type !== 'separator';
            }
            return true;
        })
        : line;

    const typedLine: WidgetItem[] = [];
    for (const item of lineToProcess) {
        if (isRecord(item) && typeof item.type === 'string') {
            typedLine.push({
                ...item,
                id: generateGuid(),
                type: item.type
            } as WidgetItem);
        }
    }

    return typedLine;
}

function migrateV1Lines(data: Record<string, unknown>): WidgetItem[][] | undefined {
    if (!Array.isArray(data.lines)) {
        return undefined;
    }

    const stripSeparators = Boolean(data.defaultSeparator);
    const processedLines: WidgetItem[][] = [];

    for (const line of data.lines) {
        if (Array.isArray(line)) {
            processedLines.push(toWidgetLine(line, stripSeparators));
        }
    }

    return processedLines;
}

function copyV1Fields(data: Record<string, unknown>, target: Record<string, unknown>): void {
    for (const rule of V1_FIELD_RULES) {
        const value = data[rule.key];
        if (rule.isValid(value)) {
            target[rule.key] = value;
        }
    }
}

// Define all migrations here
export const migrations: Migration[] = [
    {
        fromVersion: 1,
        toVersion: 2,
        description: 'Migrate from v1 to v2',
        migrate: (data) => {
            // Build a new v2 config from v1 data, only copying known fields
            const migrated: Record<string, unknown> = {};

            // Process lines: strip separators if needed and assign GUIDs
            const processedLines = migrateV1Lines(data);
            if (processedLines) {
                migrated.lines = processedLines;
            }

            // Copy all v1 fields that exist
            copyV1Fields(data, migrated);

            // Add version field for v2
            migrated.version = 2;

            // Add update message for v2 migration
            migrated.updatemessage = {
                message: 'ccstatusline updated to v2.0.0, launch tui to use new settings',
                remaining: 12
            };

            return migrated;
        }
    },
    {
        fromVersion: 2,
        toVersion: 3,
        description: 'Migrate from v2 to v3',
        migrate: (data) => {
            // Copy all existing data to v3
            const migrated: Record<string, unknown> = { ...data };

            // Update version to 3
            migrated.version = 3;

            // Add update message for v3 migration
            migrated.updatemessage = {
                message: 'ccstatusline updated to v2.0.2, 5hr block timer widget added',
                remaining: 12
            };

            return migrated;
        }
    },
    {
        fromVersion: 3,
        toVersion: 4,
        description: 'Migrate v3 flat widgets → v4 groups; fold `alternateColors` + legacy {color,bg,bold} when-rules into `tags` + `setTag`. New powerline per-group / per-line fields default to empty — they are used only when `groupsEnabled` is set; the legacy `separators` / `startCaps` / `endCaps` remain authoritative for the flat path.',
        migrate: (data) => {
            const migrated: Record<string, unknown> = { ...data };

            // Shape transform first: wrap v3 flat `WidgetItem[]` lines in a single
            // `{groups:[{widgets:[...]}]}` line, then run per-widget tag migration
            // inside the new structure.
            const v3Lines = Array.isArray(data.lines) ? data.lines : [];
            migrated.lines = v3Lines.map((line) => {
                const widgets = Array.isArray(line) ? line : [];
                const migratedWidgets = widgets.map((raw: unknown) => {
                    if (!isRecord(raw))
                        return raw;
                    return migrateAlternateColorsToTags(raw);
                });
                return { groups: [{ continuousColor: true, widgets: migratedWidgets }] };
            });

            // Ensure groupGap default exists; leave the new cap / separator
            // fields empty so v3 configs land in legacy-field territory until
            // the user explicitly configures group mode.
            if (isRecord(data.powerline))
                migrated.powerline = ensurePowerlineVocabulary(data.powerline);

            migrated.version = 4;
            return migrated;
        }
    }
];

/**
 * Idempotent default-filling step for the B2 powerline vocabulary.
 *
 * Under the mode-split design the legacy v3 fields (`separators` / `startCaps`
 * / `endCaps`) are the source of truth when `groupsEnabled` is false, and the
 * new per-group / per-line fields are the source of truth when `groupsEnabled`
 * is true.  The two sets are intentionally independent — auto-copying legacy
 * caps into the new fields caused duplicate cap rendering at line boundaries
 * (same glyph emitted once as `lineStartCap` and again as `groupStartCap` of
 * the first group).
 *
 * So this helper no longer mirrors legacy values into new fields.  It only
 * guarantees `groupGap` has a string default — the Zod schema handles the rest
 * via per-field defaults.
 *
 * Called from the v3→v4 migration AND from the config loader for every
 * already-v4 config, without a version bump.
 */
export function ensurePowerlineVocabulary(pl: Record<string, unknown>): Record<string, unknown> {
    const repaired: Record<string, unknown> = { ...pl };

    if (typeof pl.groupGap !== 'string')
        repaired.groupGap = '  ';

    return repaired;
}

/**
 * Detect the version of the config data
 */
export function detectVersion(data: unknown): number {
    if (!isRecord(data))
        return 1;

    // If it has a version field, use it
    if (typeof data.version === 'number')
        return data.version;

    // No version field means it's the old v1 format
    return 1;
}

/**
 * Migrate config data from its current version to the target version
 */
export function migrateConfig(data: unknown, targetVersion: number): unknown {
    if (!isRecord(data))
        return data;

    let currentVersion = detectVersion(data);
    let migrated: Record<string, unknown> = { ...data };

    // Apply migrations sequentially
    while (currentVersion < targetVersion) {
        const migration = migrations.find(m => m.fromVersion === currentVersion);

        if (!migration)
            break;

        migrated = migration.migrate(migrated);
        currentVersion = migration.toVersion;
    }

    return migrated;
}

/**
 * Check if a migration is needed
 */
export function needsMigration(data: unknown, targetVersion: number): boolean {
    return detectVersion(data) < targetVersion;
}

/**
 * Stable 32-bit hash → base36 string. Used to mint deterministic `__inline-*`
 * tag names when folding legacy `{do:'color'|'bg'|'bold'}` rules into the
 * `tags` + `setTag` model. Not cryptographic — collision resistance is only
 * required within one widget's rule list.
 */
function hashString(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++)
        h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

interface LegacyWhenRule {
    on: unknown;
    do: unknown;
    value?: unknown;
    tag?: unknown;
}

function isLegacyWhenRule(v: unknown): v is LegacyWhenRule {
    return isRecord(v) && 'on' in v && 'do' in v;
}

/**
 * Translate the old `empty`/`no-git`/`no-remote`/`not-fork` predicate keys
 * (PR#1 shape) into the new `core.empty`/`git.*` namespaced keys.
 */
const LEGACY_PREDICATE_MAP: Readonly<Record<string, WhenPredicate>> = Object.freeze({
    'empty': 'core.empty',
    'no-git': 'git.no-git',
    'no-remote': 'git.no-remote',
    'not-fork': 'git.not-fork'
});

function migratePredicateKey(on: unknown): string | null {
    if (typeof on !== 'string')
        return null;
    return LEGACY_PREDICATE_MAP[on] ?? on;
}

/**
 * Convert one widget item from the v3 shape (`alternateColors` map + possibly
 * `{do:'color'|'bg'|'bold'}` when-rules) to the v4 shape (`tags` map + only
 * `{do:'hide'|'setTag'}` when-rules).
 *
 * Strategy:
 *   1. Copy `alternateColors` entries straight into `tags` (key-preserving)
 *      and synthesize a `{on:'{item.type}.{state}', do:'setTag', tag:state}`
 *      rule per entry. Duplicates against an existing `when` array are
 *      skipped by `ruleEquals`.
 *   2. For each legacy `{on, do:'color'|'bg'|'bold', value}` rule, mint an
 *      `__inline-{hash}` tag built from the rule's payload and replace the
 *      rule with `{on, do:'setTag', tag:'__inline-{hash}'}`. Identical
 *      legacy rules collapse into the same inline tag.
 *   3. Keep `hide` rules as-is (after migrating the predicate key).
 *
 * Exported for tests; production callers hit it indirectly via the v3→v4
 * migration step.
 */
export function migrateAlternateColorsToTags(
    raw: Record<string, unknown>
): Record<string, unknown> {
    const result: Record<string, unknown> = { ...raw };
    const itemType = typeof raw.type === 'string' ? raw.type : '';

    const tags: Record<string, TagStyle> = {};
    const existingTags = raw.tags;
    if (isRecord(existingTags)) {
        for (const [k, v] of Object.entries(existingTags)) {
            if (isRecord(v))
                tags[k] = v as TagStyle;
        }
    }

    const synthesizedRules: WhenRule[] = [];

    // Step 1: alternateColors → tags + setTag rules.
    const altColors = raw.alternateColors;
    if (isRecord(altColors)) {
        for (const [stateKey, style] of Object.entries(altColors)) {
            if (!isRecord(style))
                continue;
            // Preserve existing tag of the same name if present; alternateColors
            // migration is additive, never overwrites.
            if (!(stateKey in tags))
                tags[stateKey] = style as TagStyle;
            if (itemType) {
                synthesizedRules.push({
                    on: `${itemType}.${stateKey}`,
                    do: 'setTag',
                    tag: stateKey
                });
            }
        }
        delete result.alternateColors;
    }

    // Step 2 + 3: walk existing when rules, rewrite legacy actions.
    const migratedRules: WhenRule[] = [];
    if (Array.isArray(raw.when)) {
        for (const rawRule of raw.when) {
            if (!isLegacyWhenRule(rawRule))
                continue;
            const on = migratePredicateKey(rawRule.on);
            if (on === null)
                continue;
            const action = rawRule.do;
            if (action === 'hide') {
                migratedRules.push({ on, do: 'hide' });
                continue;
            }
            if (action === 'setTag' && typeof rawRule.tag === 'string') {
                migratedRules.push({ on, do: 'setTag', tag: rawRule.tag });
                continue;
            }
            if (action === 'color' || action === 'bg' || action === 'bold') {
                const style: TagStyle = {};
                if (action === 'color' && typeof rawRule.value === 'string')
                    style.color = rawRule.value;
                else if (action === 'bg' && typeof rawRule.value === 'string')
                    style.backgroundColor = rawRule.value;
                else if (action === 'bold' && typeof rawRule.value === 'boolean')
                    style.bold = rawRule.value;
                else
                    continue; // malformed legacy rule, drop it

                const tagName = `__inline-${hashString(JSON.stringify(style))}`;
                // Merge into existing inline tag if the hash collides on the
                // exact same payload (idempotent re-migration).
                tags[tagName] = { ...tags[tagName], ...style };
                migratedRules.push({ on, do: 'setTag', tag: tagName });
                continue;
            }
            // Unknown action → drop silently.
        }
    }

    // Merge synthesized alternateColors rules after existing rules, deduping.
    const finalRules: WhenRule[] = [...migratedRules];
    for (const rule of synthesizedRules) {
        if (!finalRules.some(r => ruleEquals(r, rule)))
            finalRules.push(rule);
    }

    if (Object.keys(tags).length > 0)
        result.tags = tags;
    else
        delete result.tags;

    if (finalRules.length > 0)
        result.when = finalRules;
    else
        delete result.when;

    return result;
}

const LEGACY_HIDE_FLAG_MAP: Readonly<Record<string, WhenPredicate>> = Object.freeze({
    hideNoGit: 'git.no-git',
    hideNoRemote: 'git.no-remote',
    hideWhenNotFork: 'git.not-fork',
    hideWhenEmpty: 'core.empty'
});

function ruleEquals(a: WhenRule, b: WhenRule): boolean {
    if (a.on !== b.on || a.do !== b.do)
        return false;
    if (a.do === 'setTag' && b.do === 'setTag')
        return a.tag === b.tag;
    return true;
}

/**
 * Rewrite legacy metadata hide flags (hideNoGit, hideNoRemote, hideWhenNotFork,
 * hideWhenEmpty) set to "true" into equivalent top-level `when: [{on, do: "hide"}]`
 * rules. Dedupe against existing `when` entries. Leave non-legacy metadata keys
 * intact; drop `metadata` entirely if it becomes empty.
 *
 * This is a load-time rewrite applied independently of schema version migrations —
 * legacy flags can exist in v3 configs alongside new `when` rules.
 */
export function rewriteLegacyHideFlags(item: WidgetItem): WidgetItem {
    const metadata = item.metadata ?? {};
    const legacyRules: WhenRule[] = [];
    const remainingMeta: Record<string, string> = {};

    for (const [key, value] of Object.entries(metadata)) {
        remainingMeta[key] = value;
        const predicate = LEGACY_HIDE_FLAG_MAP[key];
        if (predicate && value === 'true') {
            legacyRules.push({ on: predicate, do: 'hide' });
        }
    }

    if (legacyRules.length === 0) {
        return item;
    }

    const existing = item.when ?? [];
    const merged = [...existing];
    for (const rule of legacyRules) {
        if (!merged.some(existingRule => ruleEquals(existingRule, rule))) {
            merged.push(rule);
        }
    }

    return {
        ...item,
        metadata: Object.keys(remainingMeta).length > 0 ? remainingMeta : undefined,
        when: merged
    };
}