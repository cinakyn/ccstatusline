import {
    describe,
    expect,
    it
} from 'vitest';

import type { Line } from '../../types/Group';
import type { RenderContext } from '../../types/RenderContext';
import {
    DEFAULT_SETTINGS,
    SettingsSchema,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { lineWidgets } from '../groups';
import { migrateConfig } from '../migrations';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

// ---------------------------------------------------------------------------
// Helpers (mirroring groups-byte-identity.test.ts conventions)
// ---------------------------------------------------------------------------

function renderAllLines(settings: Settings, terminalWidth: number): string[] {
    const context: RenderContext = {
        isPreview: false,
        terminalWidth,
        minimalist: false
    };

    const preRenderedLines = preRenderAllWidgets(settings.lines, settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);

    return settings.lines.map((line, idx) => {
        const widgets = lineWidgets(line);
        const preRenderedWidgets = preRenderedLines[idx] ?? [];
        const lineContext: RenderContext = { ...context, lineIndex: idx };
        return renderStatusLine(widgets, settings, lineContext, preRenderedWidgets, preCalculatedMaxWidths, line);
    });
}

function migrateV3ToSettings(v3Config: Record<string, unknown>): Settings {
    const migrated = migrateConfig(v3Config, 4);
    const parsed = SettingsSchema.safeParse(migrated);
    if (!parsed.success)
        throw new Error(`Migrated v3 config failed schema validation: ${parsed.error.message}`);
    return parsed.data;
}

function buildV4NativeSettings(
    flatLines: WidgetItem[][],
    overrides: Partial<Settings> = {}
): Settings {
    const lines: Line[] = flatLines.map(widgets => ({ groups: [{ continuousColor: true, widgets }] }));

    return {
        ...DEFAULT_SETTINGS,
        ...overrides,
        lines,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            ...(overrides.powerline ?? {})
        }
    };
}

// ---------------------------------------------------------------------------
// Under the mode-split design the legacy v3 fields (`separators` /
// `startCaps` / `endCaps`) are the source of truth for the flat path, and
// the new per-group / per-line fields are the source of truth for the
// grouped path (groupsEnabled=true).  The v3→v4 migration therefore
// intentionally leaves the new vocabulary fields at their schema defaults
// rather than copying legacy caps into them — auto-copy used to cause
// duplicate cap rendering at line boundaries (same glyph emitted as
// `lineStartCap` AND `groupStartCap` of the first group).
// ---------------------------------------------------------------------------

describe('powerline vocabulary: v3→v4 migration leaves new fields at schema defaults', () => {
    it('does not copy legacy separators / startCaps / endCaps into new fields', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[{ id: 'w-1', type: 'model' }]],
            powerline: {
                enabled: true,
                separators: ['A'],
                separatorInvertBackground: [false],
                startCaps: ['<'],
                endCaps: ['>'],
                theme: undefined,
                autoAlign: false,
                continueThemeAcrossLines: false
            }
        }, 4) as Record<string, unknown>;

        const pl = migrated.powerline as Record<string, unknown>;

        // Migration only ensures groupGap default; it must not populate
        // widgetSeparator / groupStartCap / groupEndCap / lineStartCap /
        // lineEndCap from legacy values.
        expect(pl.widgetSeparator).toBeUndefined();
        expect(pl.groupStartCap).toBeUndefined();
        expect(pl.groupEndCap).toBeUndefined();
        expect(pl.lineStartCap).toBeUndefined();
        expect(pl.lineEndCap).toBeUndefined();
        expect(pl.groupGap).toBe('  ');

        // Legacy fields are preserved.
        expect(pl.separators).toEqual(['A']);
        expect(pl.startCaps).toEqual(['<']);
        expect(pl.endCaps).toEqual(['>']);
    });

    it('multi-element legacy cap arrays are preserved but not copied into new fields', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[{ id: 'w-1', type: 'model' }]],
            powerline: {
                enabled: false,
                separators: ['\uE0B0', '\uE0B1'],
                separatorInvertBackground: [false, true],
                startCaps: ['\uE0B2', '\uE0B6'],
                endCaps: ['\uE0B0', '\uE0B4'],
                theme: undefined,
                autoAlign: false,
                continueThemeAcrossLines: false
            }
        }, 4) as Record<string, unknown>;

        const pl = migrated.powerline as Record<string, unknown>;
        expect(pl.separators).toEqual(['\uE0B0', '\uE0B1']);
        expect(pl.startCaps).toEqual(['\uE0B2', '\uE0B6']);
        expect(pl.endCaps).toEqual(['\uE0B0', '\uE0B4']);

        expect(pl.widgetSeparator).toBeUndefined();
        expect(pl.groupStartCap).toBeUndefined();
        expect(pl.groupEndCap).toBeUndefined();
        expect(pl.lineStartCap).toBeUndefined();
        expect(pl.lineEndCap).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Byte-identity: v3 config still renders identically after migration because
// the flat path (default when groupsEnabled=false) continues to read the
// legacy fields.
// ---------------------------------------------------------------------------

describe('powerline vocabulary: byte-identity after migration', () => {
    const TERMINAL_WIDTH = 120;

    it('v3 config with powerline renders byte-identically after v3→v4 migration', () => {
        const flatLine: WidgetItem[] = [
            {
                id: '1',
                type: 'custom-text',
                customText: 'left',
                color: 'white',
                backgroundColor: 'bgBlue'
            },
            {
                id: '2',
                type: 'custom-text',
                customText: 'mid',
                color: 'cyan',
                backgroundColor: 'bgGreen'
            },
            {
                id: '3',
                type: 'custom-text',
                customText: 'right',
                color: 'white',
                backgroundColor: 'bgRed'
            }
        ];

        const powerlineOverride = {
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            separators: ['\uE0B0'],
            separatorInvertBackground: [false],
            startCaps: ['\uE0B2'],
            endCaps: ['\uE0B0'],
            theme: undefined
        };

        const v3Config = {
            version: 3,
            lines: [flatLine],
            powerline: powerlineOverride
        };

        const v4NativeSettings = buildV4NativeSettings([flatLine], { powerline: powerlineOverride });
        const v4NativeRender = renderAllLines(v4NativeSettings, TERMINAL_WIDTH);

        const migratedSettings = migrateV3ToSettings(v3Config);
        const migratedRender = renderAllLines(migratedSettings, TERMINAL_WIDTH);

        expect(migratedRender).toHaveLength(1);
        expect(migratedRender[0]).toBe(v4NativeRender[0]);
    });

    it('v3 config with powerline theme renders byte-identically after migration', () => {
        const flatLine: WidgetItem[] = [
            { id: '1', type: 'custom-text', customText: 'hello', color: 'cyan' },
            { id: '2', type: 'custom-text', customText: 'world', color: 'green' }
        ];

        const powerlineOverride = {
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            separators: ['\uE0B0'],
            separatorInvertBackground: [false],
            startCaps: [],
            endCaps: [],
            theme: 'nord-aurora'
        };

        const v3Config = {
            version: 3,
            lines: [flatLine],
            powerline: powerlineOverride
        };

        const v4NativeSettings = buildV4NativeSettings([flatLine], { powerline: powerlineOverride });
        const v4NativeRender = renderAllLines(v4NativeSettings, TERMINAL_WIDTH);

        const migratedSettings = migrateV3ToSettings(v3Config);
        const migratedRender = renderAllLines(migratedSettings, TERMINAL_WIDTH);

        expect(migratedRender).toHaveLength(1);
        expect(migratedRender[0]).toBe(v4NativeRender[0]);
    });
});

// ---------------------------------------------------------------------------
// Schema defaults fill in the new fields when the config itself omits them.
// ---------------------------------------------------------------------------

describe('powerline vocabulary: schema defaults for new fields', () => {
    it('no powerline key in v3 → schema defaults fill new vocab fields', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[{ id: 'w-1', type: 'model' }]]
        }, 4) as Record<string, unknown>;

        const parsed = SettingsSchema.safeParse(migrated);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.powerline.widgetSeparator).toEqual(['\uE0B0']);
            expect(parsed.data.powerline.groupStartCap).toEqual([]);
            expect(parsed.data.powerline.groupEndCap).toEqual([]);
            expect(parsed.data.powerline.lineStartCap).toEqual([]);
            expect(parsed.data.powerline.lineEndCap).toEqual([]);
            expect(parsed.data.powerline.groupGap).toBe('  ');
        }
    });

    it('v3 with legacy fields → parsed v4 has empty new caps, default widgetSeparator', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[{ id: 'w-1', type: 'model' }]],
            powerline: {
                enabled: true,
                separators: ['S'],
                separatorInvertBackground: [false],
                startCaps: ['<'],
                endCaps: ['>'],
                theme: undefined,
                autoAlign: false,
                continueThemeAcrossLines: false
            }
        }, 4) as Record<string, unknown>;

        const parsed = SettingsSchema.safeParse(migrated);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            // Legacy fields flow through unchanged.
            expect(parsed.data.powerline.separators).toEqual(['S']);
            expect(parsed.data.powerline.startCaps).toEqual(['<']);
            expect(parsed.data.powerline.endCaps).toEqual(['>']);

            // New fields default to the schema defaults, not to legacy values.
            expect(parsed.data.powerline.widgetSeparator).toEqual(['\uE0B0']);
            expect(parsed.data.powerline.groupStartCap).toEqual([]);
            expect(parsed.data.powerline.groupEndCap).toEqual([]);
            expect(parsed.data.powerline.lineStartCap).toEqual([]);
            expect(parsed.data.powerline.lineEndCap).toEqual([]);
            expect(parsed.data.powerline.groupGap).toBe('  ');
        }
    });
});

// ---------------------------------------------------------------------------
// Idempotency for already-v4 configs: explicit user-set new vocab must not
// be overwritten.
// ---------------------------------------------------------------------------

describe('powerline vocabulary: idempotency on v4 config', () => {
    it('does not re-run v3→v4 migration on a config that is already v4', () => {
        const v4Config = {
            version: 4,
            lines: [{ groups: [{ continuousColor: true, widgets: [{ id: 'w-1', type: 'model' }] }] }],
            powerline: {
                enabled: true,
                separators: ['\uE0B0'],
                separatorInvertBackground: [false],
                startCaps: ['\uE0B2'],
                endCaps: ['\uE0B0'],
                theme: undefined,
                autoAlign: false,
                continueThemeAcrossLines: false,
                widgetSeparator: ['CUSTOM'],
                groupStartCap: ['GSC'],
                groupEndCap: ['GEC'],
                lineStartCap: ['LSC'],
                lineEndCap: ['LEC'],
                groupGap: '---'
            }
        };

        const result = migrateConfig(v4Config, 4) as Record<string, unknown>;

        expect(result.version).toBe(4);

        const pl = result.powerline as Record<string, unknown>;
        expect(pl.widgetSeparator).toEqual(['CUSTOM']);
        expect(pl.groupStartCap).toEqual(['GSC']);
        expect(pl.groupEndCap).toEqual(['GEC']);
        expect(pl.lineStartCap).toEqual(['LSC']);
        expect(pl.lineEndCap).toEqual(['LEC']);
        expect(pl.groupGap).toBe('---');
    });
});