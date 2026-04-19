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
        return renderStatusLine(widgets, settings, lineContext, preRenderedWidgets, preCalculatedMaxWidths);
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
// Test 1: v3→v4 migration populates new fields from old fields
// ---------------------------------------------------------------------------

describe('powerline vocabulary: v3→v4 migration field mapping', () => {
    it('populates widgetSeparator, groupStartCap, groupEndCap, lineStartCap, lineEndCap, groupGap from old fields', () => {
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
        expect(pl.widgetSeparator).toEqual(['A']);
        expect(pl.groupStartCap).toEqual(['<']);
        expect(pl.lineStartCap).toEqual(['<']);
        expect(pl.groupEndCap).toEqual(['>']);
        expect(pl.lineEndCap).toEqual(['>']);
        expect(pl.groupGap).toBe('  ');
    });

    it('copies multi-element startCaps and endCaps arrays into all four cap fields', () => {
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
        expect(pl.widgetSeparator).toEqual(['\uE0B0', '\uE0B1']);
        expect(pl.groupStartCap).toEqual(['\uE0B2', '\uE0B6']);
        expect(pl.groupEndCap).toEqual(['\uE0B0', '\uE0B4']);
        expect(pl.lineStartCap).toEqual(['\uE0B2', '\uE0B6']);
        expect(pl.lineEndCap).toEqual(['\uE0B0', '\uE0B4']);
    });
});

// ---------------------------------------------------------------------------
// Test 2: byte-identity — v3 config renders identically after migration
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

        // Render directly from v4-native settings (ground truth)
        const v4NativeSettings = buildV4NativeSettings([flatLine], { powerline: powerlineOverride });
        const v4NativeRender = renderAllLines(v4NativeSettings, TERMINAL_WIDTH);

        // Render from migrated v3 config
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
// Test 3: new fields default correctly when v3 has no powerline key
// ---------------------------------------------------------------------------

describe('powerline vocabulary: no powerline in v3 config', () => {
    it('migration skips powerline vocab population when v3 has no powerline key', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[{ id: 'w-1', type: 'model' }]]
        }, 4) as Record<string, unknown>;

        // No powerline key in v3 → migration does not synthesize one;
        // schema defaults fill in when parsed.
        // The raw migrated object should either lack powerline or have no new vocab fields.
        if (Object.prototype.hasOwnProperty.call(migrated, 'powerline')) {
            const pl = migrated.powerline as Record<string, unknown>;
            // If present, it must not have been wrongly populated from undefined old fields
            expect(Array.isArray(pl.widgetSeparator) || pl.widgetSeparator === undefined).toBe(true);
        }

        // Parsing through schema must succeed and produce schema defaults for vocab fields
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
});

// ---------------------------------------------------------------------------
// Test 4: old fields remain intact (cohabitation invariant)
// ---------------------------------------------------------------------------

describe('powerline vocabulary: old fields cohabitation', () => {
    it('old fields separators, startCaps, endCaps survive migration alongside new fields', () => {
        const v3Powerline = {
            enabled: true,
            separators: ['\uE0B0', '\uE0B1'],
            separatorInvertBackground: [false, true],
            startCaps: ['\uE0B2'],
            endCaps: ['\uE0B0'],
            theme: 'fire',
            autoAlign: true,
            continueThemeAcrossLines: true
        };

        const migrated = migrateConfig({
            version: 3,
            lines: [[{ id: 'w-1', type: 'model' }]],
            powerline: v3Powerline
        }, 4) as Record<string, unknown>;

        const pl = migrated.powerline as Record<string, unknown>;

        // Old fields must be present and unchanged
        expect(pl.separators).toEqual(['\uE0B0', '\uE0B1']);
        expect(pl.separatorInvertBackground).toEqual([false, true]);
        expect(pl.startCaps).toEqual(['\uE0B2']);
        expect(pl.endCaps).toEqual(['\uE0B0']);
        expect(pl.enabled).toBe(true);
        expect(pl.theme).toBe('fire');
        expect(pl.autoAlign).toBe(true);
        expect(pl.continueThemeAcrossLines).toBe(true);

        // New fields must also be present
        expect(pl.widgetSeparator).toEqual(['\uE0B0', '\uE0B1']);
        expect(pl.groupStartCap).toEqual(['\uE0B2']);
        expect(pl.groupEndCap).toEqual(['\uE0B0']);
        expect(pl.lineStartCap).toEqual(['\uE0B2']);
        expect(pl.lineEndCap).toEqual(['\uE0B0']);
        expect(pl.groupGap).toBe('  ');
    });

    it('new cap arrays are independent copies (not shared references with old fields)', () => {
        const startCaps = ['\uE0B2'];
        const endCaps = ['\uE0B0'];

        const migrated = migrateConfig({
            version: 3,
            lines: [],
            powerline: {
                enabled: false,
                separators: ['\uE0B0'],
                separatorInvertBackground: [false],
                startCaps,
                endCaps,
                theme: undefined,
                autoAlign: false,
                continueThemeAcrossLines: false
            }
        }, 4) as Record<string, unknown>;

        const pl = migrated.powerline as Record<string, unknown>;

        // Must be independent arrays, not same reference as old fields
        expect(pl.groupStartCap).not.toBe(pl.startCaps);
        expect(pl.lineStartCap).not.toBe(pl.startCaps);
        expect(pl.groupStartCap).not.toBe(pl.lineStartCap);
        expect(pl.groupEndCap).not.toBe(pl.endCaps);
        expect(pl.lineEndCap).not.toBe(pl.endCaps);
        expect(pl.groupEndCap).not.toBe(pl.lineEndCap);
    });
});

// ---------------------------------------------------------------------------
// Test 5: migration is idempotent on an already-v4 config
// ---------------------------------------------------------------------------

describe('powerline vocabulary: idempotency on v4 config', () => {
    it('does not re-run v3→v4 migration on a config that is already v4', () => {
        // Build a v4 config that already has new vocab fields
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

        // Version check: migration should not have run
        expect(result.version).toBe(4);

        // New vocab fields must be untouched — migration didn't overwrite them
        const pl = result.powerline as Record<string, unknown>;
        expect(pl.widgetSeparator).toEqual(['CUSTOM']);
        expect(pl.groupStartCap).toEqual(['GSC']);
        expect(pl.groupEndCap).toEqual(['GEC']);
        expect(pl.lineStartCap).toEqual(['LSC']);
        expect(pl.lineEndCap).toEqual(['LEC']);
        expect(pl.groupGap).toBe('---');
    });
});