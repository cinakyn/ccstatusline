import {
    describe,
    expect,
    it
} from 'vitest';

import type { Line } from '../../types/Group';
import type { RenderContext } from '../../types/RenderContext';
import {
    DEFAULT_SETTINGS,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { stripSgrCodes } from '../ansi';
import { calculateGroupedMaxWidths } from '../grouped-max-widths';
import { lineWidgets } from '../groups';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

const TEXT = (id: string, customText: string, color = 'white'): WidgetItem => ({
    id,
    type: 'custom-text',
    customText,
    color
});

const FLEX = (id: string): WidgetItem => ({ id, type: 'flex-separator' });

// Two groups per line so that renderGroupedPowerlineStatusLine is invoked.
// Group 0 has two widgets (produces a '|' widget separator between them).
// Group 1 is a single dummy widget.
function mkLine(g0: WidgetItem[], g1: WidgetItem[]): Line {
    return {
        groups: [
            { continuousColor: true, widgets: g0 },
            { continuousColor: true, widgets: g1 }
        ]
    };
}

function renderAll(settings: Settings, terminalWidth = 200): string[] {
    const context: RenderContext = { isPreview: false, terminalWidth, minimalist: false };
    const preRendered = preRenderAllWidgets(settings.lines, settings, context);
    const flatMax = calculateMaxWidthsFromPreRendered(preRendered, settings);
    const cfg = settings.powerline as Record<string, unknown> | undefined;
    const grouped = (settings.groupsEnabled && Boolean(cfg?.autoAlign))
        ? calculateGroupedMaxWidths(settings.lines, preRendered, settings)
        : undefined;
    return settings.lines.map((line, idx) => renderStatusLine(
        lineWidgets(line),
        settings,
        { ...context, lineIndex: idx },
        preRendered[idx] ?? [],
        flatMax,
        line,
        grouped
    ));
}

function mkSettings(lines: Line[]): Settings {
    return {
        ...DEFAULT_SETTINGS,
        flexMode: 'full',
        groupsEnabled: true,
        lines,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            autoAlign: true,
            widgetSeparator: ['|'],
            groupStartCap: [],
            groupEndCap: [],
            groupGap: '  ',
            lineStartCap: [],
            lineEndCap: [],
            separatorInvertBackground: [false]
        }
    };
}

describe('powerline grouped auto-align — widget-level', () => {
    it('pads shorter widgets in the same (group, wPos) across lines', () => {
        // line 1 group0: vim(3) | model(5)   — '|' at column 3 without alignment
        // line 2 group0: tmux(4) | opus(4)   — '|' at column 4 without alignment
        // After alignment: wPos=0 max=4, so vim gets +1 pad → '|' at column 4 on both lines.
        const l1 = mkLine(
            [TEXT('a', 'vim'), TEXT('b', 'model')],
            [TEXT('c', 'x')]
        );
        const l2 = mkLine(
            [TEXT('a', 'tmux'), TEXT('b', 'opus')],
            [TEXT('c', 'x')]
        );
        const rendered = renderAll(mkSettings([l1, l2]));
        const r1 = rendered[0] ?? '';
        const r2 = rendered[1] ?? '';
        const plain1 = stripSgrCodes(r1);
        const plain2 = stripSgrCodes(r2);
        // When aligned, the widget separator '|' must appear at the same column
        // on both lines (wPos=0 column), and the overall rendered visible width
        // must be equal.
        expect(plain1.indexOf('|')).toBe(plain2.indexOf('|'));
        expect(plain1.length).toBe(plain2.length);
    });
});

describe('powerline grouped auto-align — group-total', () => {
    it('pads short groups so group g+1 starts at the same column across lines', () => {
        // Line 1 group 0 has 2 widgets, line 2 group 0 has 1 wide widget;
        // group 1 must start at the same column.
        const l1 = mkLine(
            [TEXT('a', 'A'), TEXT('b', 'B')],
            [TEXT('c', 'C')]
        );
        const l2 = mkLine(
            [TEXT('a', 'LOOOONG')],
            [TEXT('c', 'D')]
        );
        const rendered = renderAll(mkSettings([l1, l2]));
        const r1 = rendered[0] ?? '';
        const r2 = rendered[1] ?? '';
        const p1 = stripSgrCodes(r1);
        const p2 = stripSgrCodes(r2);
        // The 'C' / 'D' widget is at the start of group 1. After the two-space
        // groupGap, its column should be identical on both lines.
        const gapAndC = p1.indexOf('C'); // column where group 1 starts on line 1
        const gapAndD = p2.indexOf('D'); // column where group 1 starts on line 2
        expect(gapAndC).toBe(gapAndD);
        expect(gapAndC).toBeGreaterThan(0);
    });
});

describe('powerline grouped auto-align — right-anchor', () => {
    it('[left] [flex] [right] layout aligns the rightmost group end column', () => {
        const l1: Line = {
            groups: [
                { continuousColor: true, widgets: [TEXT('a', 'vim')] },
                { continuousColor: true, widgets: [FLEX('f')] },
                { continuousColor: true, widgets: [TEXT('r', 'main')] }
            ]
        };
        const l2: Line = {
            groups: [
                { continuousColor: true, widgets: [TEXT('a', 'tmux')] },
                { continuousColor: true, widgets: [FLEX('f')] },
                { continuousColor: true, widgets: [TEXT('r', 'feat/long-branch')] }
            ]
        };
        const rendered = renderAll(mkSettings([l1, l2]), 80);
        const p1 = stripSgrCodes(rendered[0] ?? '');
        const p2 = stripSgrCodes(rendered[1] ?? '');
        // Flex absorbs slack so both lines fill the terminal width evenly.
        expect(p1.length).toBe(p2.length);
        // Right edge of the visible content (last non-space column) must align.
        expect(p1.trimEnd().length).toBe(p2.trimEnd().length);
    });

    it('multi-widget right-anchor group aligns within the group', () => {
        const l1: Line = {
            groups: [
                { continuousColor: true, widgets: [TEXT('a', 'A')] },
                { continuousColor: true, widgets: [FLEX('f')] },
                { continuousColor: true, widgets: [TEXT('r1', 'root'), TEXT('r2', 'sha'), TEXT('r3', 'main')] }
            ]
        };
        const l2: Line = {
            groups: [
                { continuousColor: true, widgets: [TEXT('a', 'A')] },
                { continuousColor: true, widgets: [FLEX('f')] },
                { continuousColor: true, widgets: [TEXT('r1', 'gh'), TEXT('r2', 'abc123'), TEXT('r3', 'feat/x')] }
            ]
        };
        const rendered = renderAll(mkSettings([l1, l2]), 80);
        const p1 = stripSgrCodes(rendered[0] ?? '');
        const p2 = stripSgrCodes(rendered[1] ?? '');
        expect(p1.length).toBe(p2.length);
        expect(p1.trimEnd().length).toBe(p2.trimEnd().length);
    });
});

describe('powerline grouped auto-align — hidden-widget philosophy', () => {
    it('when-hidden widget keeps the pill tight; column divergence on that line is expected', () => {
        // Fixture: line 1 has a hidden middle widget, line 2 has all three visible.
        // With visible-widget-only indexing, line 1 wPos=0=A, wPos=1=CCC.
        // Line 2 wPos=0=AA, wPos=1=BB, wPos=2=C.
        // widgetMaxWidths[0][0] = max(A, AA) — line 1's A gets padded to match AA.
        // widgetMaxWidths[0][1] = max(CCC, BB) — line 2's BB gets padded.
        // wPos=2 only comes from line 2 (CCC on line 1 is at wPos=1, not wPos=2).
        const hiddenMiddle: WidgetItem = {
            id: 'hide-me',
            type: 'custom-text',
            customText: '', // renders empty → triggers on:empty rule
            when: [{ on: 'empty', do: 'hide' }]
        };
        const l1: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [TEXT('a', 'A'), hiddenMiddle, TEXT('c', 'CCC')]
                },
                { continuousColor: true, widgets: [TEXT('z', 'Z')] }
            ]
        };
        const l2: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [TEXT('a', 'AA'), TEXT('b', 'BB'), TEXT('c', 'C')]
                },
                { continuousColor: true, widgets: [TEXT('z', 'Z')] }
            ]
        };
        const rendered = renderAll(mkSettings([l1, l2]));
        const p1 = stripSgrCodes(rendered[0] ?? '');
        const p2 = stripSgrCodes(rendered[1] ?? '');
        // The first widget's column still aligns across lines (wPos=0 aligns).
        const firstSep1 = p1.indexOf('|');
        const firstSep2 = p2.indexOf('|');
        expect(firstSep1).toBe(firstSep2);
        // No hidden-widget bg gap appears on line 1 (pill stays tight — no extra
        // whitespace between A and CCC). The count of '|' separators on line 1
        // is the visible-widget count minus 1 = 2 - 1 = 1 (inside group 0).
        // Line 2 has 3 visible widgets in group 0 → 2 separators inside group 0.
        const sepCount1 = (p1.match(/\|/g) ?? []).length;
        const sepCount2 = (p2.match(/\|/g) ?? []).length;
        expect(sepCount1).toBeLessThan(sepCount2);
    });
});