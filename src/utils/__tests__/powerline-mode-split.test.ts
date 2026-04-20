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
import { lineWidgets } from '../groups';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

// ---------------------------------------------------------------------------
// The flat path (`groupsEnabled=false`) and the grouped path
// (`groupsEnabled=true` + `line.groups.length > 1`) read disjoint sets of
// powerline fields:
//
//   flat     → separators / startCaps / endCaps
//   grouped  → widgetSeparator / groupStartCap / groupEndCap + groupGap
//
// These tests pin that independence so that a mis-configured one-sided
// config (common when upgrading from v3) cannot leak legacy cap glyphs into
// the grouped path.
// ---------------------------------------------------------------------------

const TERMINAL_WIDTH = 200;

function renderAllLines(settings: Settings): string[] {
    const context: RenderContext = {
        isPreview: false,
        terminalWidth: TERMINAL_WIDTH,
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

function buildSettings(opts: {
    groupsEnabled: boolean;
    lines: Line[];
    legacySeparators?: string[];
    legacyStartCaps?: string[];
    legacyEndCaps?: string[];
    widgetSeparator?: string[];
    groupStartCap?: string[];
    groupEndCap?: string[];
    groupGap?: string;
}): Settings {
    return {
        ...DEFAULT_SETTINGS,
        lines: opts.lines,
        groupsEnabled: opts.groupsEnabled,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            separators: opts.legacySeparators ?? DEFAULT_SETTINGS.powerline.separators,
            startCaps: opts.legacyStartCaps ?? [],
            endCaps: opts.legacyEndCaps ?? [],
            widgetSeparator: opts.widgetSeparator ?? DEFAULT_SETTINGS.powerline.widgetSeparator,
            groupStartCap: opts.groupStartCap ?? [],
            groupEndCap: opts.groupEndCap ?? [],
            groupGap: opts.groupGap ?? '  '
        }
    };
}

function twoGroupLine(): Line {
    const left: WidgetItem[] = [
        { id: 'L1', type: 'custom-text', customText: 'aa', color: 'white', backgroundColor: 'bgBlue' }
    ];
    const right: WidgetItem[] = [
        { id: 'R1', type: 'custom-text', customText: 'bb', color: 'white', backgroundColor: 'bgRed' }
    ];
    return {
        groups: [
            { continuousColor: true, widgets: left },
            { continuousColor: true, widgets: right }
        ]
    };
}

function oneGroupLine(): Line {
    return {
        groups: [
            {
                continuousColor: true,
                widgets: [
                    { id: 'A', type: 'custom-text', customText: 'xx', color: 'white', backgroundColor: 'bgBlue' },
                    { id: 'B', type: 'custom-text', customText: 'yy', color: 'white', backgroundColor: 'bgRed' }
                ]
            }
        ]
    };
}

describe('powerline mode split: grouped path ignores legacy cap fields', () => {
    it('does NOT render legacy startCaps at group boundaries when groupsEnabled=true', () => {
        const settings = buildSettings({
            groupsEnabled: true,
            lines: [twoGroupLine()],
            legacyStartCaps: ['LEGACY_SC'],
            legacyEndCaps: ['LEGACY_EC']
            // groupStartCap / groupEndCap left empty
        });

        const [rendered] = renderAllLines(settings);
        expect(rendered).not.toContain('LEGACY_SC');
        expect(rendered).not.toContain('LEGACY_EC');
    });

    it('renders groupStartCap / groupEndCap at each group boundary independently of legacy fields', () => {
        const settings = buildSettings({
            groupsEnabled: true,
            lines: [twoGroupLine()],
            legacyStartCaps: ['LEGACY_SC'],
            legacyEndCaps: ['LEGACY_EC'],
            groupStartCap: ['NEW_SC'],
            groupEndCap: ['NEW_EC']
        });

        const [rendered] = renderAllLines(settings);
        expect(rendered).toContain('NEW_SC');
        expect(rendered).toContain('NEW_EC');
        expect(rendered).not.toContain('LEGACY_SC');
        expect(rendered).not.toContain('LEGACY_EC');
    });
});

describe('powerline mode split: groupStartCap renders once per group', () => {
    it('with groupStartCap set, rendered line has exactly one cap at each group boundary', () => {
        const CAP = 'GROUPCAP_XYZ';
        const settings = buildSettings({
            groupsEnabled: true,
            lines: [twoGroupLine()],
            groupStartCap: [CAP]
        });

        const [rendered] = renderAllLines(settings);
        expect(rendered).toBeDefined();

        // With 2 groups the cap appears at each group's start → 2 times.
        const occurrences = (rendered ?? '').split(CAP).length - 1;
        expect(occurrences).toBe(2);
    });
});

describe('powerline mode split: widgetSeparator is the grouped-mode separator field', () => {
    it('grouped path renders widgetSeparator between widgets, ignores legacy separators', () => {
        const left: WidgetItem[] = [
            { id: 'L1', type: 'custom-text', customText: 'xx', color: 'white', backgroundColor: 'bgBlue' },
            { id: 'L2', type: 'custom-text', customText: 'yy', color: 'white', backgroundColor: 'bgGreen' }
        ];
        const right: WidgetItem[] = [
            { id: 'R1', type: 'custom-text', customText: 'zz', color: 'white', backgroundColor: 'bgRed' }
        ];
        const settings = buildSettings({
            groupsEnabled: true,
            lines: [{
                groups: [
                    { continuousColor: true, widgets: left },
                    { continuousColor: true, widgets: right }
                ]
            }],
            legacySeparators: ['LEGACY_SEP'],
            widgetSeparator: ['WSEP']
        });

        const [rendered] = renderAllLines(settings);
        expect(rendered).toBeDefined();
        expect(rendered ?? '').toContain('WSEP');
        expect(rendered ?? '').not.toContain('LEGACY_SEP');
    });
});

describe('powerline mode split: groupGap is used between groups in grouped mode only', () => {
    it('grouped path inserts groupGap between adjacent groups', () => {
        const GAP = '||GAP||';
        const settings = buildSettings({
            groupsEnabled: true,
            lines: [twoGroupLine()],
            groupGap: GAP
        });

        const [rendered] = renderAllLines(settings);
        expect(rendered).toBeDefined();
        expect(rendered ?? '').toContain(GAP);
    });

    it('flat path does not emit groupGap even when set', () => {
        const GAP = '||GAP||';
        const settings = buildSettings({
            groupsEnabled: false,
            lines: [oneGroupLine()],
            groupGap: GAP
        });

        const [rendered] = renderAllLines(settings);
        expect(rendered).toBeDefined();
        expect(rendered ?? '').not.toContain(GAP);
    });
});

describe('powerline mode split: groupStartCap / groupEndCap both render in multi-group mode', () => {
    it('both groupStartCap and groupEndCap render on a multi-group line', () => {
        const settings = buildSettings({
            groupsEnabled: true,
            lines: [twoGroupLine()],
            groupStartCap: ['GSC_A'],
            groupEndCap: ['GEC_B']
        });

        const [rendered] = renderAllLines(settings);
        expect(rendered).toBeDefined();
        const out = rendered ?? '';
        expect(out).toContain('GSC_A');
        expect(out).toContain('GEC_B');
    });
});

describe('powerline mode split: flat path ignores new fields', () => {
    it('flat path reads legacy startCaps / endCaps, ignores groupStartCap / groupEndCap', () => {
        const settings = buildSettings({
            groupsEnabled: false,
            lines: [oneGroupLine()],
            legacyStartCaps: ['FLAT_SC'],
            legacyEndCaps: ['FLAT_EC'],
            groupStartCap: ['GROUP_ONLY_SC'],
            groupEndCap: ['GROUP_ONLY_EC']
        });

        const [rendered] = renderAllLines(settings);
        expect(rendered).toContain('FLAT_SC');
        expect(rendered).toContain('FLAT_EC');
        expect(rendered).not.toContain('GROUP_ONLY_SC');
        expect(rendered).not.toContain('GROUP_ONLY_EC');
    });

    it('flat path with groupsEnabled=true but only one group still uses legacy fields', () => {
        // The grouped renderer only takes over when `line.groups.length > 1`.
        // A single-group line hits the flat renderer even with groupsEnabled=true.
        const settings = buildSettings({
            groupsEnabled: true,
            lines: [oneGroupLine()],
            legacyStartCaps: ['FLAT_SC'],
            legacyEndCaps: ['FLAT_EC'],
            groupStartCap: ['GROUP_ONLY_SC'],
            groupEndCap: ['GROUP_ONLY_EC']
        });

        const [rendered] = renderAllLines(settings);
        expect(rendered).toContain('FLAT_SC');
        expect(rendered).toContain('FLAT_EC');
        expect(rendered).not.toContain('GROUP_ONLY_SC');
        expect(rendered).not.toContain('GROUP_ONLY_EC');
    });
});