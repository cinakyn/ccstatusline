import chalk, { type ColorSupportLevel } from 'chalk';
import { execSync } from 'child_process';
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { Line } from '../../types/Group';
import type { PowerlineConfig } from '../../types/PowerlineConfig';
import type { RenderContext } from '../../types/RenderContext';
import {
    DEFAULT_SETTINGS,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { clearGitCache } from '../git';
import { lineWidgets } from '../groups';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

vi.mock('child_process', () => ({ execSync: vi.fn() }));

beforeEach(() => {
    clearGitCache();
    (execSync as unknown as { mockReset: () => void }).mockReset();
});

type SettingsInput = Omit<Partial<Settings>, 'powerline'> & { powerline?: Partial<PowerlineConfig> };

function createPowerlineSettings(overrides: SettingsInput = {}): Settings {
    const { powerline: pl, ...rest } = overrides;
    return {
        ...DEFAULT_SETTINGS,
        flexMode: 'full',
        groupsEnabled: true,
        ...rest,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            separators: ['\uE0B0'],
            startCaps: ['\uE0B6'],
            endCaps: ['\uE0B4'],
            separatorInvertBackground: [false],
            theme: undefined,
            ...(pl ?? {})
        }
    };
}

function render(line: Line, overrides: SettingsInput = {}): string {
    const settings = createPowerlineSettings(overrides);
    const ctx: RenderContext = { isPreview: false, terminalWidth: 200, lineIndex: 0, globalPowerlineThemeIndex: 0 };
    const pre = preRenderAllWidgets([line], settings, ctx);
    const maxw = calculateMaxWidthsFromPreRendered(pre, settings);
    return renderStatusLine(lineWidgets(line), settings, ctx, pre[0] ?? [], maxw, line);
}

function mkW(id: string, text: string, bg: string | undefined, bold?: boolean): WidgetItem {
    return { id, type: 'custom-text', customText: text, color: 'white', backgroundColor: bg, bold } as WidgetItem;
}

let saved: ColorSupportLevel;
beforeAll(() => {
    saved = chalk.level;
    chalk.level = 1;
});
afterAll(() => { chalk.level = saved; });

function lastBoldStateBefore(out: string, upto: number): 'on' | 'off' | 'none' {
    const slice = out.slice(0, upto);
    const on = slice.lastIndexOf('\x1b[1m');
    const off = slice.lastIndexOf('\x1b[22m');
    if (on < 0 && off < 0)
        return 'none';
    return on > off ? 'on' : 'off';
}

describe('Bug 1: bold must not be active when separator or cap is drawn', () => {
    it('bold is reset before the separator character', () => {
        const line: Line = {
            groups: [{
                continuousColor: true, widgets: [
                    mkW('a', 'A', 'bgRed', true),
                    mkW('b', 'B', 'bgGreen', true)
                ]
            }]
        };
        const out = render(line);
        const sepIdx = out.indexOf('\uE0B0');
        expect(sepIdx).toBeGreaterThan(-1);
        expect(lastBoldStateBefore(out, sepIdx)).toBe('off');
    });

    it('bold is reset before the group end cap', () => {
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [mkW('a', 'A', 'bgRed', true)] },
                { continuousColor: true, widgets: [mkW('b', 'B', 'bgGreen', true)] }
            ]
        };
        const out = render(line);
        const capIdx = out.indexOf('\uE0B4');
        expect(capIdx).toBeGreaterThan(-1);
        expect(lastBoldStateBefore(out, capIdx)).toBe('off');
    });
});

describe('Bug 2: widget with default (no) bg — trailing separator must also be uncolored', () => {
    it('no leading fg SGR immediately before separator when widget bg is undefined', () => {
        const line: Line = {
            groups: [{
                continuousColor: true, widgets: [
                    mkW('a', 'A', undefined, false),
                    mkW('b', 'B', 'bgGreen', false)
                ]
            }]
        };
        const out = render(line);
        const sepIdx = out.indexOf('\uE0B0');
        expect(sepIdx).toBeGreaterThan(-1);
        const before = out.slice(Math.max(0, sepIdx - 20), sepIdx);
        expect(/\x1b\[38(?:;\d+)*m$|\x1b\[3[0-7]m$/.test(before)).toBe(false);
    });
});

describe('Same-bg separator: fg tracks widget bg, not fg (seamless pill)', () => {
    it('adjacent widgets with same bg render separator with fg=widget.bg (invisible triangle)', () => {
        // Two widgets share bg=bgBrightWhite. Widget A has a red fg+bold.
        // The separator between them must use bgToFg(bg) — NOT widget.fgColor —
        // otherwise a bold-red spike appears inside the otherwise-white pill.
        const line: Line = {
            groups: [{
                continuousColor: true, widgets: [
                    { id: 'a', type: 'custom-text', customText: 'A', color: 'red', backgroundColor: 'bgBrightWhite', bold: true } as WidgetItem,
                    { id: 'b', type: 'custom-text', customText: 'B', color: 'magenta', backgroundColor: 'bgBrightWhite' } as WidgetItem
                ]
            }]
        };
        const out = render(line);
        const sepIdx = out.indexOf('\uE0B0');
        expect(sepIdx).toBeGreaterThan(-1);
        // The SGR sequence immediately preceding the separator should open
        // with fg = brightWhite code (ansi16 `\x1b[97m`), not red (`\x1b[31m`).
        const before = out.slice(Math.max(0, sepIdx - 30), sepIdx);
        // No explicit red fg (\x1b[31m or \x1b[38;5;160m) should be active
        // immediately before the separator.
        expect(/\x1b\[31m[^\x1b]*$/.test(before)).toBe(false);
        expect(/\x1b\[38;5;160m[^\x1b]*$/.test(before)).toBe(false);
        // The separator's fg and bg should be the same (invisible triangle).
        // Match the last fg+bg pair right before the separator.
        const m = /\x1b\[(\d+(?:;\d+)*)m\x1b\[(\d+(?:;\d+)*)m$/.exec(before);
        expect(m).not.toBeNull();
        if (m) {
            // fg 38;5;N ↔ bg 48;5;N should reference the same palette index.
            const fgIdx = m[1]?.replace(/^38;5;/, '');
            const bgIdx = m[2]?.replace(/^48;5;/, '');
            expect(fgIdx).toBe(bgIdx);
        }
    });
});