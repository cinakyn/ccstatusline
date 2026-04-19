import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import {
    DEFAULT_SETTINGS,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

const SEPARATOR = '\uE0B0';
const END_CAP = '\uE0B4';
const BOLD_RESET = '\x1b[22m';

function createPowerlineSettings(
    powerlineOverrides: Partial<Settings['powerline']> = {}
): Settings {
    return {
        ...DEFAULT_SETTINGS,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            ...powerlineOverrides
        }
    };
}

function renderLine(widgets: WidgetItem[], settings: Settings): string {
    const context: RenderContext = { isPreview: false };
    const preRenderedLines = preRenderAllWidgets([widgets], settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);
    const preRenderedWidgets = preRenderedLines[0] ?? [];

    return renderStatusLine(widgets, settings, context, preRenderedWidgets, preCalculatedMaxWidths);
}

describe('bold reset position around powerline separator/cap glyphs (ANSI16 bold-leak fix)', () => {
    it('emits the bold reset before the separator glyph, not after', () => {
        const widgets: WidgetItem[] = [
            { id: '1', type: 'custom-text', customText: 'A', bold: true, color: 'white', backgroundColor: 'blue' },
            { id: '2', type: 'custom-text', customText: 'B', color: 'white', backgroundColor: 'red' }
        ];
        const settings = createPowerlineSettings();

        const output = renderLine(widgets, settings);
        const separatorIdx = output.indexOf(SEPARATOR);
        const boldResetIdx = output.indexOf(BOLD_RESET);

        expect(separatorIdx).toBeGreaterThanOrEqual(0);
        expect(boldResetIdx).toBeGreaterThanOrEqual(0);
        expect(boldResetIdx).toBeLessThan(separatorIdx);
    });

    it('emits the bold reset before the end cap glyph, not after, when the last widget is bold', () => {
        const widgets: WidgetItem[] = [
            { id: '1', type: 'custom-text', customText: 'A', bold: true, color: 'white', backgroundColor: 'blue' }
        ];
        const settings = createPowerlineSettings({ endCaps: [END_CAP] });

        const output = renderLine(widgets, settings);
        const endCapIdx = output.indexOf(END_CAP);
        const boldResetIdx = output.indexOf(BOLD_RESET);

        expect(endCapIdx).toBeGreaterThanOrEqual(0);
        expect(boldResetIdx).toBeGreaterThanOrEqual(0);
        expect(boldResetIdx).toBeLessThan(endCapIdx);
    });
});