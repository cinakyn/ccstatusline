import type {
    WhenPredicate,
    WhenRule
} from '../types/When';
import type { WidgetItem } from '../types/Widget';

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
        description: 'Migrate from v3 to v4: wrap each line\'s widgets in a single group',
        migrate: (data) => {
            const migrated: Record<string, unknown> = { ...data };
            const v3Lines = Array.isArray(data.lines) ? data.lines : [];
            migrated.lines = v3Lines.map((line) => {
                const widgets = Array.isArray(line) ? line : [];
                return { groups: [{ continuousColor: true, widgets }] };
            });

            // B2: populate new powerline symbol vocabulary from old fields
            if (isRecord(data.powerline)) {
                const pl = data.powerline;
                const oldSeparators = Array.isArray(pl.separators)
                    ? pl.separators.filter((s): s is string => typeof s === 'string')
                    : ['\uE0B0'];
                const oldStartCaps = Array.isArray(pl.startCaps)
                    ? pl.startCaps.filter((s): s is string => typeof s === 'string')
                    : [];
                const oldEndCaps = Array.isArray(pl.endCaps)
                    ? pl.endCaps.filter((s): s is string => typeof s === 'string')
                    : [];
                migrated.powerline = {
                    ...pl,
                    widgetSeparator: [...oldSeparators],
                    groupStartCap: [...oldStartCaps],
                    groupEndCap: [...oldEndCaps],
                    lineStartCap: [...oldStartCaps],
                    lineEndCap: [...oldEndCaps],
                    groupGap: '  '
                };
            }

            migrated.version = 4;
            return migrated;
        }
    }
];

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

const LEGACY_HIDE_FLAG_MAP: Readonly<Record<string, WhenPredicate>> = Object.freeze({
    hideNoGit: 'no-git',
    hideNoRemote: 'no-remote',
    hideWhenNotFork: 'not-fork',
    hideWhenEmpty: 'empty'
});

function ruleEquals(a: WhenRule, b: WhenRule): boolean {
    return a.on === b.on && a.do === b.do && a.value === b.value;
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
        const predicate = LEGACY_HIDE_FLAG_MAP[key];
        if (predicate && value === 'true') {
            legacyRules.push({ on: predicate, do: 'hide' });
        } else {
            remainingMeta[key] = value;
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