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

// Small helper to render every line of a settings object through the same
// pipeline (preRender + calculate widths + renderStatusLine) using a fixed
// RenderContext. Returns a per-line string array so callers can assert
// character-by-character equivalence.
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

// Parse a raw v3-shaped config through the v3→v4 migration and the
// SettingsSchema validator, returning a fully typed Settings object.
function migrateV3ToSettings(v3Config: Record<string, unknown>): Settings {
    const migrated = migrateConfig(v3Config, 4);
    const parsed = SettingsSchema.safeParse(migrated);
    if (!parsed.success)
        throw new Error(`Migrated v3 config failed schema validation: ${parsed.error.message}`);
    return parsed.data;
}

// Build a v4-native Settings object with the provided flat widget arrays
// wrapped into single-group lines. Accepts optional powerline overrides.
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

describe('groups byte-identity: v3 migration vs v4-native render', () => {
    const TERMINAL_WIDTH = 120;

    it('matches for a simple single-line config with 3 widgets and no powerline', () => {
        const flatLine: WidgetItem[] = [
            { id: '1', type: 'custom-text', customText: 'A' },
            { id: '2', type: 'separator' },
            { id: '3', type: 'custom-text', customText: 'B' }
        ];

        const v3Config = {
            version: 3,
            lines: [flatLine]
        };
        const migratedSettings = migrateV3ToSettings(v3Config);
        const v4NativeSettings = buildV4NativeSettings([flatLine]);

        const migratedRender = renderAllLines(migratedSettings, TERMINAL_WIDTH);
        const v4NativeRender = renderAllLines(v4NativeSettings, TERMINAL_WIDTH);

        expect(migratedRender).toHaveLength(1);
        expect(migratedRender[0]).toBe(v4NativeRender[0]);
    });

    it('matches for a multi-line config with mixed widget sequences', () => {
        const line0: WidgetItem[] = [
            { id: '1', type: 'custom-text', customText: 'Hello', color: 'cyan' },
            { id: '2', type: 'separator', character: '|' },
            { id: '3', type: 'custom-text', customText: 'World', color: 'green' }
        ];
        const line1: WidgetItem[] = [
            { id: '4', type: 'custom-text', customText: 'foo' },
            { id: '5', type: 'separator' },
            { id: '6', type: 'custom-text', customText: 'bar' },
            { id: '7', type: 'separator' },
            { id: '8', type: 'custom-text', customText: 'baz' }
        ];

        const v3Config = {
            version: 3,
            lines: [line0, line1]
        };
        const migratedSettings = migrateV3ToSettings(v3Config);
        const v4NativeSettings = buildV4NativeSettings([line0, line1]);

        const migratedRender = renderAllLines(migratedSettings, TERMINAL_WIDTH);
        const v4NativeRender = renderAllLines(v4NativeSettings, TERMINAL_WIDTH);

        expect(migratedRender).toHaveLength(2);
        expect(migratedRender[0]).toBe(v4NativeRender[0]);
        expect(migratedRender[1]).toBe(v4NativeRender[1]);
    });

    it('matches when powerline is enabled with caps and colored widgets', () => {
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

        const powerline = {
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
            powerline
        };
        const migratedSettings = migrateV3ToSettings(v3Config);
        const v4NativeSettings = buildV4NativeSettings([flatLine], { powerline });

        const migratedRender = renderAllLines(migratedSettings, TERMINAL_WIDTH);
        const v4NativeRender = renderAllLines(v4NativeSettings, TERMINAL_WIDTH);

        expect(migratedRender).toHaveLength(1);
        expect(migratedRender[0]).toBe(v4NativeRender[0]);
    });

    it('matches for a line containing a flex-separator', () => {
        const flatLine: WidgetItem[] = [
            { id: '1', type: 'custom-text', customText: 'LEFT' },
            { id: '2', type: 'flex-separator' },
            { id: '3', type: 'custom-text', customText: 'RIGHT' }
        ];

        const v3Config = {
            version: 3,
            lines: [flatLine],
            flexMode: 'full' as const
        };
        const migratedSettings = migrateV3ToSettings(v3Config);
        const v4NativeSettings = buildV4NativeSettings([flatLine], { flexMode: 'full' });

        const migratedRender = renderAllLines(migratedSettings, TERMINAL_WIDTH);
        const v4NativeRender = renderAllLines(v4NativeSettings, TERMINAL_WIDTH);

        expect(migratedRender).toHaveLength(1);
        expect(migratedRender[0]).toBe(v4NativeRender[0]);
    });

    it('matches when widgets use merge: true and merge: no-padding', () => {
        const flatLine: WidgetItem[] = [
            {
                id: '1',
                type: 'custom-text',
                customText: 'pre',
                color: 'cyan',
                merge: true
            },
            {
                id: '2',
                type: 'custom-text',
                customText: 'mid',
                color: 'green',
                merge: 'no-padding'
            },
            {
                id: '3',
                type: 'custom-text',
                customText: 'post',
                color: 'magenta'
            }
        ];

        const v3Config = {
            version: 3,
            lines: [flatLine]
        };
        const migratedSettings = migrateV3ToSettings(v3Config);
        const v4NativeSettings = buildV4NativeSettings([flatLine]);

        const migratedRender = renderAllLines(migratedSettings, TERMINAL_WIDTH);
        const v4NativeRender = renderAllLines(v4NativeSettings, TERMINAL_WIDTH);

        expect(migratedRender).toHaveLength(1);
        expect(migratedRender[0]).toBe(v4NativeRender[0]);
    });
});

describe('groups byte-identity with autoAlign toggled', () => {
    it('a v4-native fixture renders without error under autoAlign:true', () => {
        const settings = buildV4NativeSettings(
            [[
                { id: '1', type: 'custom-text', customText: 'A', color: 'white' },
                { id: '2', type: 'custom-text', customText: 'BB', color: 'white' }
            ]],
            {
                groupsEnabled: true,
                powerline: { ...DEFAULT_SETTINGS.powerline, enabled: true, autoAlign: true }
            }
        );
        expect(() => renderAllLines(settings, 120)).not.toThrow();
    });
});