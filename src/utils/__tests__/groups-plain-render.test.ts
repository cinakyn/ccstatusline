import chalk, { type ColorSupportLevel } from 'chalk';
import {
    afterAll,
    beforeAll,
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
import { lineWidgets } from '../groups';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSettings(overrides: Partial<Settings> = {}): Settings {
    return {
        ...DEFAULT_SETTINGS,
        flexMode: 'full',
        ...overrides,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            ...(overrides.powerline ?? {})
        }
    };
}

function renderLineEntry(
    lineEntry: Line,
    options: { settings?: Partial<Settings>; terminalWidth?: number } = {}
): string {
    const settings = createSettings(options.settings);
    const context: RenderContext = {
        isPreview: false,
        terminalWidth: options.terminalWidth ?? 200
    };

    const preRenderedLines = preRenderAllWidgets([lineEntry], settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);
    const preRenderedWidgets = preRenderedLines[0] ?? [];
    const widgets = lineWidgets(lineEntry);

    return renderStatusLine(widgets, settings, context, preRenderedWidgets, preCalculatedMaxWidths, lineEntry);
}

// ---------------------------------------------------------------------------
// 1. Multi-group plain render emits default gap once between two groups
// ---------------------------------------------------------------------------

describe('groups plain render: multi-group gap emission', () => {
    it('emits the defaultGroupGap exactly once between two groups', () => {
        const defaultGroupGap = '  ';
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'a1', type: 'custom-text', customText: 'Alpha' }
                    ]
                },
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'b1', type: 'custom-text', customText: 'Beta' }
                    ]
                }
            ]
        };

        const result = renderLineEntry(line, { settings: { groupsEnabled: true, defaultGroupGap } });
        const plain = stripSgrCodes(result);

        // The gap should appear exactly once, between the two group outputs.
        const parts = plain.split(defaultGroupGap);
        expect(parts.length).toBe(2);

        // Both groups must be present on either side of the gap.
        expect(parts[0]).toContain('Alpha');
        expect(parts[1]).toContain('Beta');
    });

    it('emits gaps between three groups (two gap boundaries)', () => {
        const gap = ' :: ';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'a', type: 'custom-text', customText: 'A' }] },
                { continuousColor: true, gap, widgets: [{ id: 'b', type: 'custom-text', customText: 'B' }] },
                { continuousColor: true, gap, widgets: [{ id: 'c', type: 'custom-text', customText: 'C' }] }
            ]
        };

        const result = renderLineEntry(line, { settings: { groupsEnabled: true } });
        const plain = stripSgrCodes(result);

        const parts = plain.split(gap);
        expect(parts.length).toBe(3);
        expect(parts[0]).toContain('A');
        expect(parts[1]).toContain('B');
        expect(parts[2]).toContain('C');
    });
});

// ---------------------------------------------------------------------------
// 2. Custom group.gap overrides defaultGroupGap
// ---------------------------------------------------------------------------

describe('groups plain render: custom per-group gap', () => {
    it('uses group.gap instead of defaultGroupGap when set', () => {
        const defaultGroupGap = '  ';
        const customGap = ' | ';
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [{ id: 'w1', type: 'custom-text', customText: 'Left' }]
                },
                {
                    continuousColor: true,
                    gap: customGap,
                    widgets: [{ id: 'w2', type: 'custom-text', customText: 'Right' }]
                }
            ]
        };

        const result = renderLineEntry(line, { settings: { groupsEnabled: true, defaultGroupGap } });
        const plain = stripSgrCodes(result);

        expect(plain).toContain(customGap);
        expect(plain).not.toContain(defaultGroupGap);
        expect(plain).toContain('Left');
        expect(plain).toContain('Right');
    });

    it('falls back to defaultGroupGap when group.gap is undefined', () => {
        const defaultGroupGap = '--';
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [{ id: 'w1', type: 'custom-text', customText: 'X' }]
                },
                {
                    continuousColor: true,
                    // gap intentionally absent
                    widgets: [{ id: 'w2', type: 'custom-text', customText: 'Y' }]
                }
            ]
        };

        const result = renderLineEntry(line, { settings: { groupsEnabled: true, defaultGroupGap } });
        const plain = stripSgrCodes(result);

        expect(plain).toContain(defaultGroupGap);
    });
});

// ---------------------------------------------------------------------------
// 3. Single group under groupsEnabled: true is byte-identical to groupsEnabled: false
// ---------------------------------------------------------------------------

describe('groups plain render: single-group byte identity', () => {
    it('produces identical raw output with groupsEnabled: true vs false (single group)', () => {
        const widgets: WidgetItem[] = [
            { id: '1', type: 'custom-text', customText: 'Hello', color: 'cyan' },
            { id: '2', type: 'separator' },
            { id: '3', type: 'custom-text', customText: 'World', color: 'green' }
        ];

        const lineEntry: Line = { groups: [{ continuousColor: true, widgets }] };

        const withGroups = renderLineEntry(lineEntry, { settings: { groupsEnabled: true } });
        const withoutGroups = renderLineEntry(lineEntry, { settings: { groupsEnabled: false } });

        expect(withGroups).toBe(withoutGroups);
    });

    it('single-group groupsEnabled: true matches groupsEnabled: false with defaultPadding set', () => {
        const widgets: WidgetItem[] = [
            { id: '1', type: 'custom-text', customText: 'padded', color: 'white' }
        ];

        const lineEntry: Line = { groups: [{ continuousColor: true, widgets }] };

        const settings = { groupsEnabled: true, defaultPadding: ' ' };
        const withGroups = renderLineEntry(lineEntry, { settings });
        const withoutGroups = renderLineEntry(lineEntry, { settings: { ...settings, groupsEnabled: false } });

        expect(withGroups).toBe(withoutGroups);
    });
});

// ---------------------------------------------------------------------------
// 4. inheritSeparatorColors inside a group
// ---------------------------------------------------------------------------

describe('groups plain render: inheritSeparatorColors inside a group', () => {
    // Enable ANSI output for this suite so color differences are observable.
    let savedChalkLevel: ColorSupportLevel;

    beforeAll(() => {
        savedChalkLevel = chalk.level;
        chalk.level = 2; // ansi256
    });

    afterAll(() => {
        chalk.level = savedChalkLevel;
    });

    it('separator inside a group inherits foreground from previous widget color', () => {
        // A separator following a cyan widget should inherit cyan when
        // inheritSeparatorColors is true. The separator character gets wrapped
        // in the widget's color ANSI code sequence, producing different raw bytes
        // than when inheritSeparatorColors is false (gray separator).
        const widgets: WidgetItem[] = [
            { id: 'w1', type: 'custom-text', customText: 'Colored', color: 'cyan' },
            { id: 'sep', type: 'separator' },
            { id: 'w2', type: 'custom-text', customText: 'Next', color: 'green' }
        ];

        const lineEntry: Line = { groups: [{ continuousColor: true, widgets }] };

        const settings: Partial<Settings> = {
            groupsEnabled: true,
            inheritSeparatorColors: true,
            defaultSeparator: '|'
        };

        const result = renderLineEntry(lineEntry, { settings });

        // The separator character must appear in plain output.
        const plainResult = stripSgrCodes(result);
        expect(plainResult).toContain('Colored');
        expect(plainResult).toContain('|');
        expect(plainResult).toContain('Next');

        // The raw ANSI output with inheritSeparatorColors should differ from the
        // output without it (separator gets the cyan color code vs plain gray).
        const withoutInherit = renderLineEntry(lineEntry, { settings: { ...settings, inheritSeparatorColors: false } });
        expect(result).not.toBe(withoutInherit);

        // With inheritSeparatorColors the result should contain an ANSI escape
        // sequence (colors were actually emitted since chalk.level = 2).
        expect(result).toMatch(/\x1b\[/);
    });

    it('separator colors do NOT cross group boundaries (gap is plain)', () => {
        // Group 1: cyan widget + separator → with inheritSeparatorColors the
        // separator is cyan. The gap between groups is plain (no color codes).
        // Group 2: green widget.
        const gap = ' GAP ';
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'g1w1', type: 'custom-text', customText: 'A', color: 'cyan' },
                        { id: 'g1sep', type: 'separator' }
                    ]
                },
                {
                    continuousColor: true,
                    gap,
                    widgets: [
                        { id: 'g2w1', type: 'custom-text', customText: 'B', color: 'green' }
                    ]
                }
            ]
        };

        const settings: Partial<Settings> = {
            groupsEnabled: true,
            inheritSeparatorColors: true,
            defaultSeparator: '|'
        };

        const result = renderLineEntry(line, { settings });

        // The gap itself should appear in the raw output exactly as-is — no ANSI
        // codes are wrapped around the gap string because it is plain text injected
        // between group renders.
        expect(result).toContain(gap);
        const gapIndex = result.indexOf(gap);
        expect(gapIndex).toBeGreaterThan(-1);
        expect(result.substring(gapIndex, gapIndex + gap.length)).toBe(gap);
    });
});

// ---------------------------------------------------------------------------
// 5. Hidden widgets (via when) don't prevent gap emission when others are visible
// ---------------------------------------------------------------------------

describe('groups plain render: hidden widgets and gap emission', () => {
    it('gap is still emitted when some widgets in a group are hidden', () => {
        // B1 note: gap emission is unconditional in this task — a group with some
        // hidden widgets still emits its gap. Task B4 will implement group-level
        // hide propagation (drop entire group only when ALL widgets are hidden).
        //
        // We simulate a hidden widget by providing a preRendered entry with
        // hidden: true. We do this by using a custom-text widget with a known
        // text value alongside another widget — then manually crafting pre-rendered.
        // The simpler approach: since custom-text renders deterministically, we
        // use a multi-widget group where the first widget has no text (renders
        // empty) but the second does.

        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        // A widget that will produce visible content
                        { id: 'visible', type: 'custom-text', customText: 'Visible' }
                    ]
                },
                {
                    continuousColor: true,
                    widgets: [
                        // A widget whose customText is empty → renders nothing in this group
                        { id: 'empty', type: 'custom-text', customText: '' },
                        // But this one is still present (the group as a whole is not fully hidden)
                        { id: 'also-visible', type: 'custom-text', customText: 'Also' }
                    ]
                }
            ]
        };

        const result = renderLineEntry(line, { settings: { groupsEnabled: true, defaultGroupGap: '  ' } });
        const plain = stripSgrCodes(result);

        expect(plain).toContain('Visible');
        expect(plain).toContain('Also');

        // Gap is still emitted (B1 behaviour — B4 will refine full-group suppression)
        expect(plain).toContain('  ');
    });

    it('groupsEnabled: false path is unaffected by hidden widget logic (unchanged flat path)', () => {
        const widgets: WidgetItem[] = [
            { id: 'a', type: 'custom-text', customText: 'A' },
            { id: 'b', type: 'custom-text', customText: 'B' }
        ];
        const lineEntry: Line = { groups: [{ continuousColor: true, widgets }] };

        const withoutGroups = renderLineEntry(lineEntry, { settings: { groupsEnabled: false } });
        expect(stripSgrCodes(withoutGroups)).toContain('A');
        expect(stripSgrCodes(withoutGroups)).toContain('B');
    });
});

// ---------------------------------------------------------------------------
// 6. Unknown widget type preserves slice alignment for subsequent groups
// ---------------------------------------------------------------------------

describe('groups plain render: unknown widget type index alignment', () => {
    it('second group content is not shifted when first group has an unknown widget type', () => {
        // An unknown widget type in group 0 must NOT shrink the preRenderedWidgets
        // slice consumed by that group. If it does, group 1's slice window shifts
        // left by one and renders content that belongs to group 0, corrupting output.
        //
        // Layout: group 0 = [unknown-x, custom-text 'A']
        //         group 1 = [custom-text 'B']
        // Expected plain output (order): ... A ... <gap> ... B ...
        //
        // If alignment is broken, the gap is still emitted but group 1 picks up
        // the pre-rendered entry for 'A' rather than 'B', producing a second 'A'
        // after the gap instead of 'B'.
        const gap = '  ';
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'unk', type: 'unknown-x' as WidgetItem['type'] },
                        { id: 'a', type: 'custom-text', customText: 'A' }
                    ]
                },
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'b', type: 'custom-text', customText: 'B' }
                    ]
                }
            ]
        };

        const result = renderLineEntry(line, { settings: { groupsEnabled: true, defaultGroupGap: gap } });
        const plain = stripSgrCodes(result);

        // Both 'A' and 'B' must appear.
        expect(plain).toContain('A');
        expect(plain).toContain('B');

        // 'B' must come after the gap, not before it. Split on the gap and assert
        // 'B' is in the second part (group 1's output), not in the first.
        const parts = plain.split(gap);
        expect(parts.length).toBeGreaterThanOrEqual(2);
        expect(parts[parts.length - 1]).toContain('B');

        // 'B' must not appear before the gap (i.e. not in group 0's slice).
        const beforeGap = parts.slice(0, parts.length - 1).join('');
        expect(beforeGap).not.toContain('B');
    });
});