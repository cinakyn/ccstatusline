import {
    describe,
    expect,
    it
} from 'vitest';

import type {
    Group,
    Line
} from '../../types/Group';
import type { RenderContext } from '../../types/RenderContext';
import {
    DEFAULT_SETTINGS,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { lineWidgets } from '../groups';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

/**
 * Powerline is a dedicated feature; in plain mode the renderer auto-flattens
 * multi-group lines via `lineWidgets`. This test pins the byte-identity
 * invariant:
 *
 *   With `groupsEnabled = true` and `powerline.enabled = false`,
 *   `renderStatusLine(flatWidgets, settings, ctx, preRendered, maxWidths, line)`
 *   must produce output byte-identical to a single-group wrapper over
 *   `lineWidgets(line)`.
 *
 * This guarantees the grouped plain-mode path no longer exists: the guard
 * degrades to the flat path regardless of how many groups the line has.
 */
function renderLine(line: Line, settings: Settings, terminalWidth: number): string {
    const context: RenderContext = {
        isPreview: false,
        terminalWidth,
        minimalist: false,
        lineIndex: 0
    };
    const preRenderedLines = preRenderAllWidgets([line], settings, context);
    const preRenderedWidgets = preRenderedLines[0] ?? [];
    const maxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);
    const widgets = lineWidgets(line);
    return renderStatusLine(widgets, settings, context, preRenderedWidgets, maxWidths, line);
}

function flatSettings(overrides: Partial<Settings> = {}): Settings {
    return {
        ...DEFAULT_SETTINGS,
        groupsEnabled: true,
        ...overrides,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            enabled: false
        }
    };
}

describe('groups byte-identity: powerline-off flatten invariant', () => {
    const TERMINAL_WIDTH = 120;

    it('multi-group line renders byte-identical to a single-group wrapper of the flat widgets', () => {
        const groupA: Group = {
            continuousColor: true,
            widgets: [
                { id: '1', type: 'custom-text', customText: 'Alpha' },
                { id: '2', type: 'separator' },
                { id: '3', type: 'custom-text', customText: 'Bravo' }
            ]
        };
        const groupB: Group = {
            continuousColor: true,
            gap: ' | ',
            widgets: [
                { id: '4', type: 'custom-text', customText: 'Charlie' },
                { id: '5', type: 'custom-text', customText: 'Delta' }
            ]
        };
        const multiGroup: Line = { groups: [groupA, groupB] };
        const flatWidgets: WidgetItem[] = lineWidgets(multiGroup);
        const singleGroup: Line = { groups: [{ continuousColor: true, widgets: flatWidgets }] };

        const settings = flatSettings({ defaultGroupGap: ' | ' });

        const multiRender = renderLine(multiGroup, settings, TERMINAL_WIDTH);
        const flatRender = renderLine(singleGroup, settings, TERMINAL_WIDTH);

        expect(multiRender).toBe(flatRender);
    });

    it('colored widgets across multiple groups still flatten byte-identically', () => {
        const multiGroup: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: '1', type: 'custom-text', customText: 'left', color: 'cyan' },
                        { id: '2', type: 'separator', character: '|' },
                        { id: '3', type: 'custom-text', customText: 'mid', color: 'green' }
                    ]
                },
                {
                    continuousColor: true,
                    gap: '::',
                    widgets: [
                        { id: '4', type: 'custom-text', customText: 'right', color: 'magenta' }
                    ]
                }
            ]
        };
        const flatWidgets = lineWidgets(multiGroup);
        const singleGroup: Line = { groups: [{ continuousColor: true, widgets: flatWidgets }] };

        const settings = flatSettings();
        expect(renderLine(multiGroup, settings, TERMINAL_WIDTH))
            .toBe(renderLine(singleGroup, settings, TERMINAL_WIDTH));
    });

    it('flex-separator budget is identical whether the flex lives in one group or spans two', () => {
        const multiGroup: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: '1', type: 'custom-text', customText: 'LEFT' },
                        { id: '2', type: 'flex-separator' }
                    ]
                },
                {
                    continuousColor: true,
                    widgets: [
                        { id: '3', type: 'custom-text', customText: 'RIGHT' }
                    ]
                }
            ]
        };
        const flatWidgets = lineWidgets(multiGroup);
        const singleGroup: Line = { groups: [{ continuousColor: true, widgets: flatWidgets }] };

        const settings = flatSettings({ flexMode: 'full' });
        expect(renderLine(multiGroup, settings, TERMINAL_WIDTH))
            .toBe(renderLine(singleGroup, settings, TERMINAL_WIDTH));
    });

    it('empty groups are a no-op: multi-group with an empty group matches the flat rendering', () => {
        const multiGroup: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: '1', type: 'custom-text', customText: 'only' }
                    ]
                },
                { continuousColor: true, gap: '   ', widgets: [] }
            ]
        };
        const flatWidgets = lineWidgets(multiGroup);
        const singleGroup: Line = { groups: [{ continuousColor: true, widgets: flatWidgets }] };

        const settings = flatSettings();
        expect(renderLine(multiGroup, settings, TERMINAL_WIDTH))
            .toBe(renderLine(singleGroup, settings, TERMINAL_WIDTH));
    });
});