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
import { stripSgrCodes } from '../ansi';
import { getColorAnsiCode } from '../colors';
import { clearGitCache } from '../git';
import { lineWidgets } from '../groups';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

vi.mock('child_process', () => ({ execSync: vi.fn() }));

const mockExecSync = execSync as unknown as {
    mockImplementation: (impl: (command: string) => string) => void;
    mockReset: () => void;
};

type GitResponder = (command: string) => string | Error;

function setGitResponses(responder: GitResponder): void {
    mockExecSync.mockImplementation((cmd) => {
        const gitCmd = cmd.startsWith('git ') ? cmd.slice(4) : cmd;
        const result = responder(gitCmd);
        if (result instanceof Error)
            throw result;
        return result;
    });
}

beforeEach(() => {
    clearGitCache();
    mockExecSync.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SettingsInput = Omit<Partial<Settings>, 'powerline'> & { powerline?: Partial<PowerlineConfig> };

function createPowerlineSettings(overrides: SettingsInput = {}): Settings {
    const { powerline: plOverrides, ...rest } = overrides;
    return {
        ...DEFAULT_SETTINGS,
        flexMode: 'full',
        groupsEnabled: true,
        ...rest,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            // Use B2 new-vocabulary fields (empty separators / caps → no caps by
            // default; tests opt in explicitly)
            widgetSeparator: ['\uE0B0'],
            groupStartCap: [],
            groupEndCap: [],
            groupGap: '  ',
            lineStartCap: [],
            lineEndCap: [],
            separatorInvertBackground: [false],
            theme: undefined,
            ...(plOverrides ?? {})
        }
    };
}

function renderLineEntry(
    lineEntry: Line,
    options: {
        settings?: SettingsInput;
        terminalWidth?: number;
        lineIndex?: number;
        globalPowerlineThemeIndex?: number;
    } = {}
): string {
    const settings = createPowerlineSettings(options.settings);
    const context: RenderContext = {
        isPreview: false,
        terminalWidth: options.terminalWidth ?? 200,
        lineIndex: options.lineIndex ?? 0,
        globalPowerlineThemeIndex: options.globalPowerlineThemeIndex ?? 0
    };

    const preRenderedLines = preRenderAllWidgets([lineEntry], settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);
    const preRenderedWidgets = preRenderedLines[0] ?? [];
    const widgets = lineWidgets(lineEntry);

    return renderStatusLine(widgets, settings, context, preRenderedWidgets, preCalculatedMaxWidths, lineEntry);
}

// Widgets with explicit background colors so powerline separators/caps produce
// coloured ANSI output (observable in tests).
function makeWidget(id: string, text: string, bg = 'bgBlue'): WidgetItem {
    return {
        id,
        type: 'custom-text',
        customText: text,
        color: 'white',
        backgroundColor: bg
    };
}

// ---------------------------------------------------------------------------
// Test suite — requires chalk.level = 2 for ANSI output
// ---------------------------------------------------------------------------

let savedChalkLevel: ColorSupportLevel;

beforeAll(() => {
    savedChalkLevel = chalk.level;
    chalk.level = 2;
});

afterAll(() => {
    chalk.level = savedChalkLevel;
});

// ---------------------------------------------------------------------------
// 1. 2-group layout byte correctness
// ---------------------------------------------------------------------------

describe('groups powerline render: 2-group layout', () => {
    it('output contains both group contents with gap in between', () => {
        const gap = ' GAP ';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [makeWidget('w1', 'Alpha', 'bgBlue')] },
                { continuousColor: true, gap, widgets: [makeWidget('w2', 'Beta', 'bgGreen')] }
            ]
        };

        const result = renderLineEntry(line);
        const plain = stripSgrCodes(result);

        expect(plain).toContain('Alpha');
        expect(plain).toContain('Beta');
        expect(plain).toContain(gap);

        // Alpha must appear before the gap, Beta after
        const gapIdx = plain.indexOf(gap);
        expect(plain.indexOf('Alpha')).toBeLessThan(gapIdx);
        expect(plain.indexOf('Beta')).toBeGreaterThan(gapIdx);
    });

    it('groupStartCap and groupEndCap appear around each group', () => {
        const GSC = '>>';
        const GEC = '<<';
        const gap = '|';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [makeWidget('w1', 'A', 'bgBlue')] },
                { continuousColor: true, gap, widgets: [makeWidget('w2', 'B', 'bgRed')] }
            ]
        };

        const result = renderLineEntry(line, {
            settings: {
                powerline: {
                    groupStartCap: [GSC],
                    groupEndCap: [GEC]
                }
            }
        });
        const plain = stripSgrCodes(result);

        // Both groups should be bookended by caps
        // Order: GSC A GEC | GSC B GEC
        const idxGSC1 = plain.indexOf(GSC);
        const idxA    = plain.indexOf('A');
        const idxGEC1 = plain.indexOf(GEC);
        const idxGap  = plain.indexOf(gap);
        const idxGSC2 = plain.lastIndexOf(GSC);
        const idxB    = plain.indexOf('B');
        const idxGEC2 = plain.lastIndexOf(GEC);

        expect(idxGSC1).toBeLessThan(idxA);
        expect(idxA).toBeLessThan(idxGEC1);
        expect(idxGEC1).toBeLessThan(idxGap);
        expect(idxGap).toBeLessThan(idxGSC2);
        expect(idxGSC2).toBeLessThan(idxB);
        expect(idxB).toBeLessThan(idxGEC2);
    });
});

// ---------------------------------------------------------------------------
// 2. 3-group layout
// ---------------------------------------------------------------------------

describe('groups powerline render: 3-group layout', () => {
    it('emits three groups separated by two gaps', () => {
        const gap = '::';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [makeWidget('w1', 'One', 'bgBlue')] },
                { continuousColor: true, gap, widgets: [makeWidget('w2', 'Two', 'bgGreen')] },
                { continuousColor: true, gap, widgets: [makeWidget('w3', 'Three', 'bgRed')] }
            ]
        };

        const result = renderLineEntry(line);
        const plain = stripSgrCodes(result);

        expect(plain).toContain('One');
        expect(plain).toContain('Two');
        expect(plain).toContain('Three');

        // Split on gap — should produce exactly 3 parts
        const parts = plain.split(gap);
        expect(parts.length).toBe(3);
        expect(parts[0]).toContain('One');
        expect(parts[1]).toContain('Two');
        expect(parts[2]).toContain('Three');
    });
});

// ---------------------------------------------------------------------------
// 3. 5-group layout stress
// ---------------------------------------------------------------------------

describe('groups powerline render: 5-group layout', () => {
    it('renders 5 groups in correct order with 4 gaps', () => {
        const gap = '~';
        const labels = ['One', 'Two', 'Three', 'Four', 'Five'];
        const bgs = ['bgBlue', 'bgGreen', 'bgRed', 'bgYellow', 'bgMagenta'] as const;
        const line: Line = {
            groups: labels.map((text, i) => ({
                continuousColor: true,
                gap: i > 0 ? gap : undefined,
                widgets: [makeWidget(`w${i}`, text, bgs[i] ?? 'bgBlue')]
            }))
        };

        const result = renderLineEntry(line);
        const plain = stripSgrCodes(result);

        const parts = plain.split(gap);
        expect(parts.length).toBe(5);
        for (let i = 0; i < labels.length; i++) {
            const label = labels[i];
            if (label)
                expect(parts[i]).toContain(label);
        }
    });
});

// ---------------------------------------------------------------------------
// 4. Flex in one group
// ---------------------------------------------------------------------------

describe('groups powerline render: flex in one group', () => {
    it('group with flex-separator expands; group without flex stays at natural width', () => {
        // terminalWidth = 80. Group A: "L" + flex + "R" (flex separates them).
        // Group B: "Fixed" (no flex).
        // Group A should be wider than its natural (L + R) content.
        // Group B stays at natural width.
        // Use a distinctive non-space gap so splitting works reliably.
        const gap = '|GAP|';
        const terminalWidth = 80;

        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'l', type: 'custom-text', customText: 'L', backgroundColor: 'bgBlue' },
                        { id: 'fs', type: 'flex-separator' },
                        { id: 'r', type: 'custom-text', customText: 'R', backgroundColor: 'bgBlue' }
                    ]
                },
                {
                    continuousColor: true,
                    gap,
                    widgets: [
                        { id: 'f', type: 'custom-text', customText: 'Fixed', backgroundColor: 'bgGreen' }
                    ]
                }
            ]
        };

        const result = renderLineEntry(line, {
            settings: { defaultPadding: '' },
            terminalWidth
        });
        const plain = stripSgrCodes(result);

        expect(plain).toContain('L');
        expect(plain).toContain('R');
        expect(plain).toContain('Fixed');
        expect(plain).toContain(gap);

        // Group A (with flex) should be wider than just "LR" (2 chars).
        // Split on the distinctive gap to isolate each group's plain content.
        const parts = plain.split(gap);
        expect(parts.length).toBeGreaterThanOrEqual(2);
        const groupAPart = parts[0] ?? '';
        // Natural "LR" is 2 chars; with flex expansion it should be much wider
        expect(groupAPart.length).toBeGreaterThan(3);

        // Group B should contain "Fixed" (5 chars) and nothing extra
        const groupBPart = parts[parts.length - 1] ?? '';
        expect(groupBPart).toContain('Fixed');
        // Group B shouldn't have grown with extra spaces (no flex in it)
        expect(groupBPart.length).toBeLessThanOrEqual(7); // "Fixed" + tiny tolerance
    });
});

// ---------------------------------------------------------------------------
// 5. Flex in two groups
// ---------------------------------------------------------------------------

describe('groups powerline render: flex in two groups', () => {
    it('free space is split equally (±1) between two flex groups', () => {
        // Use a distinctive non-space gap to allow clean splitting
        const gap = '|SEP|';
        const terminalWidth = 80;

        // Both groups: each has "X" + flex + "Y"
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'a1', type: 'custom-text', customText: 'X', backgroundColor: 'bgBlue' },
                        { id: 'af', type: 'flex-separator' },
                        { id: 'a2', type: 'custom-text', customText: 'Y', backgroundColor: 'bgBlue' }
                    ]
                },
                {
                    continuousColor: true,
                    gap,
                    widgets: [
                        { id: 'b1', type: 'custom-text', customText: 'X', backgroundColor: 'bgGreen' },
                        { id: 'bf', type: 'flex-separator' },
                        { id: 'b2', type: 'custom-text', customText: 'Y', backgroundColor: 'bgGreen' }
                    ]
                }
            ]
        };

        const result = renderLineEntry(line, {
            settings: { defaultPadding: '' },
            terminalWidth
        });
        const plain = stripSgrCodes(result);

        const parts = plain.split(gap);
        expect(parts.length).toBe(2);

        const groupALen = (parts[0] ?? '').length;
        const groupBLen = (parts[1] ?? '').length;

        // Both groups should be non-trivially wide (expanded from 2 chars each)
        expect(groupALen).toBeGreaterThan(3);
        expect(groupBLen).toBeGreaterThan(3);

        // Within ±1 of each other (equal split with floor rounding)
        expect(Math.abs(groupALen - groupBLen)).toBeLessThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// 6. Merge across group boundary terminates
// ---------------------------------------------------------------------------

describe('groups powerline render: merge terminates at group boundary', () => {
    it('first widget of group 2 does not merge into group 1 last widget', () => {
        const GSC = '>>';
        const gap = '  ';
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [makeWidget('w1', 'First', 'bgBlue')]
                },
                {
                    continuousColor: true,
                    gap,
                    widgets: [
                        // merge: true on the first widget of group 2
                        {
                            id: 'w2',
                            type: 'custom-text',
                            customText: 'Second',
                            backgroundColor: 'bgGreen',
                            merge: true
                        }
                    ]
                }
            ]
        };

        const result = renderLineEntry(line, {
            settings: {
                powerline: {
                    groupStartCap: [GSC],
                    groupEndCap: []
                }
            }
        });
        const plain = stripSgrCodes(result);

        // The gap must be present (groups are separate)
        expect(plain).toContain(gap);
        // Group 2 starts with GSC (not merged into group 1's last widget)
        const gapIdx = plain.indexOf(gap);
        const afterGap = plain.substring(gapIdx + gap.length);
        expect(afterGap).toContain(GSC);
        // First occurrence of GSC comes before A content and second after gap
        expect(plain.indexOf(GSC)).toBeLessThan(plain.indexOf('First'));
        const gscAfterGap = afterGap.indexOf(GSC);
        expect(gscAfterGap).toBeGreaterThanOrEqual(0);
    });
});

// ---------------------------------------------------------------------------
// 7. continuousColor: true — theme cycles across groups
// ---------------------------------------------------------------------------

describe('groups powerline render: continuousColor true', () => {
    it('theme color index advances across group boundary', () => {
        // Use nord-aurora theme (truecolor). Colors: [BF616A, EBCB8B, 5E81AC, ...]
        // Group 1: 1 widget → uses color index 0 (bg=BF616A)
        // Group 2: continuousColor:true → index is 1 (bg=EBCB8B), not 0
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [{ id: 'w1', type: 'custom-text', customText: 'A' }]
                },
                {
                    continuousColor: true,
                    widgets: [{ id: 'w2', type: 'custom-text', customText: 'B' }]
                }
            ]
        };

        const result = renderLineEntry(line, {
            settings: {
                colorLevel: 3,
                defaultPadding: '',
                powerline: { theme: 'nord-aurora', continueThemeAcrossLines: false }
            }
        });

        // Group 1 uses BF616A background; group 2 uses EBCB8B background.
        // Both should appear in the output.
        const color0bg = getColorAnsiCode('hex:BF616A', 'truecolor', true);
        const color1bg = getColorAnsiCode('hex:EBCB8B', 'truecolor', true);

        expect(result).toContain(color0bg);
        expect(result).toContain(color1bg);

        // color0 must appear before color1 (group 1 before group 2)
        expect(result.indexOf(color0bg)).toBeLessThan(result.indexOf(color1bg));
    });
});

// ---------------------------------------------------------------------------
// 8. continuousColor: false — theme resets at group start
// ---------------------------------------------------------------------------

describe('groups powerline render: continuousColor false', () => {
    it('group with continuousColor:false uses color index 0', () => {
        // Group 1: 1 widget → index 0 → bg=BF616A
        // Group 2: continuousColor:false → resets to index 0 → bg=BF616A again
        // (NOT EBCB8B which would be index 1)
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [{ id: 'w1', type: 'custom-text', customText: 'A' }]
                },
                {
                    continuousColor: false,
                    widgets: [{ id: 'w2', type: 'custom-text', customText: 'B' }]
                }
            ]
        };

        const result = renderLineEntry(line, {
            settings: {
                colorLevel: 3,
                defaultPadding: '',
                powerline: { theme: 'nord-aurora', continueThemeAcrossLines: false }
            }
        });

        // color1bg (EBCB8B) should NOT appear because group 2 resets to index 0
        const color0bg = getColorAnsiCode('hex:BF616A', 'truecolor', true);
        const color1bg = getColorAnsiCode('hex:EBCB8B', 'truecolor', true);

        expect(result).toContain(color0bg);
        expect(result).not.toContain(color1bg);
    });
});

// ---------------------------------------------------------------------------
// 9. Single-group groupsEnabled:true byte-identical to groupsEnabled:false
// ---------------------------------------------------------------------------

describe('groups powerline render: single-group byte identity', () => {
    it('single group with groupsEnabled:true matches groupsEnabled:false', () => {
        const widgets: WidgetItem[] = [
            makeWidget('w1', 'Hello', 'bgBlue'),
            makeWidget('w2', 'World', 'bgGreen')
        ];
        const lineEntry: Line = { groups: [{ continuousColor: true, widgets }] };

        const withGroups = renderLineEntry(lineEntry, { settings: { groupsEnabled: true } });
        const withoutGroups = renderLineEntry(lineEntry, { settings: { groupsEnabled: false } });

        expect(withGroups).toBe(withoutGroups);
    });

    it('single-group with custom caps is byte-identical regardless of groupsEnabled', () => {
        const widgets: WidgetItem[] = [
            { id: 'w1', type: 'custom-text', customText: 'cap', backgroundColor: 'bgRed' }
        ];
        const lineEntry: Line = { groups: [{ continuousColor: true, widgets }] };
        const powerlineOverride = {
            startCaps: ['\uE0B2'],
            endCaps: ['\uE0B0']
        };

        const withGroups = renderLineEntry(lineEntry, { settings: { groupsEnabled: true, powerline: powerlineOverride } });
        const withoutGroups = renderLineEntry(lineEntry, { settings: { groupsEnabled: false, powerline: powerlineOverride } });

        expect(withGroups).toBe(withoutGroups);
    });
});

// ---------------------------------------------------------------------------
// 10. groupsEnabled:false path unchanged (sanity)
// ---------------------------------------------------------------------------

describe('groups powerline render: groupsEnabled:false path unchanged', () => {
    it('multi-widget single-line renders correctly with groupsEnabled:false', () => {
        const widgets: WidgetItem[] = [
            makeWidget('w1', 'Left', 'bgBlue'),
            makeWidget('w2', 'Right', 'bgGreen')
        ];
        const lineEntry: Line = { groups: [{ continuousColor: true, widgets }] };

        const result = renderLineEntry(lineEntry, { settings: { groupsEnabled: false } });
        const plain = stripSgrCodes(result);

        expect(plain).toContain('Left');
        expect(plain).toContain('Right');
        // ANSI codes were emitted (chalk.level = 2)
        expect(result).toMatch(/\x1b\[/);
    });
});

// ---------------------------------------------------------------------------
// 11. groupGap is plain (no ANSI codes wrap it)
// ---------------------------------------------------------------------------

describe('groups powerline render: groupGap is plain text', () => {
    it('the groupGap string appears verbatim in output (no ANSI wrapping)', () => {
        const gap = ' PLAIN_GAP ';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [makeWidget('w1', 'A', 'bgBlue')] },
                { continuousColor: true, gap, widgets: [makeWidget('w2', 'B', 'bgGreen')] }
            ]
        };

        const result = renderLineEntry(line);

        // The raw gap must appear verbatim in the raw (non-stripped) output
        const gapIndex = result.indexOf(gap);
        expect(gapIndex).toBeGreaterThan(-1);

        // The exact substring at that position must be the gap with no ANSI bytes inside
        const extractedGap = result.substring(gapIndex, gapIndex + gap.length);
        expect(extractedGap).toBe(gap);
        // No ANSI code starts with ESC — confirm no ESC byte inside the gap
        expect(extractedGap).not.toMatch(/\x1b/);
    });

    it('groupGap string is also plain when using settings.powerline.groupGap', () => {
        const groupGap = '---';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [makeWidget('w1', 'X', 'bgBlue')] },
                { continuousColor: true, widgets: [makeWidget('w2', 'Y', 'bgGreen')] }
            ]
        };

        const result = renderLineEntry(line, { settings: { powerline: { groupGap } } });

        const gapIndex = result.indexOf(groupGap);
        expect(gapIndex).toBeGreaterThan(-1);
        expect(result.substring(gapIndex, gapIndex + groupGap.length)).toBe(groupGap);
    });
});

// ---------------------------------------------------------------------------
// 12. Merge termination with hidden first widget in non-first group
// ---------------------------------------------------------------------------

describe('groups powerline render: merge termination with hidden first widget', () => {
    it('D has intact leading padding when C (first of group 1) is hidden via when:[git.no-git,hide]', () => {
        // Layout:
        //   group 0: [A, B]
        //   group 1: [C (hidden when no-git), D (merge: 'no-padding')]
        //
        // With the bug: renderedWidgetCount was `i` (raw loop index), so when
        // C is hidden and the loop continues at i=0, D arrives at i=1. Since
        // i !== 0, isGroupBoundaryFirst = false. prevItem = C (hidden), and
        // prevMerge = C.merge = undefined — so D doesn't get no-padding from C.
        // BUT if C had `merge: 'no-padding'`, prevMerge would be 'no-padding' and
        // D would wrongly suppress its leading padding.  We test the variant that
        // definitively catches the boundary guard firing too late: D uses
        // merge: 'no-padding' itself (to suppress the separator between C and D
        // within the same group in a normal run); when C is hidden, D must still
        // act as the first rendered widget of group 1 — no merge leak from group 0.
        //
        // Concrete assertion: the plain-stripped output with C hidden must be
        // byte-identical to a reference render where C is simply absent.

        setGitResponses(() => new Error('not a git repo'));

        const gap = '||';
        const padding = ' ';

        // Reference line: group 1 has only D (C is never present)
        const refLine: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        makeWidget('a', 'A', 'bgBlue'),
                        makeWidget('b', 'B', 'bgBlue')
                    ]
                },
                {
                    continuousColor: true,
                    gap,
                    widgets: [
                        makeWidget('d', 'D', 'bgGreen')
                    ]
                }
            ]
        };

        // Test line: group 1 has C (hidden) then D (merge: 'no-padding')
        const testLine: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        makeWidget('a', 'A', 'bgBlue'),
                        makeWidget('b', 'B', 'bgBlue')
                    ]
                },
                {
                    continuousColor: true,
                    gap,
                    widgets: [
                        {
                            id: 'c',
                            type: 'custom-text',
                            customText: 'C',
                            backgroundColor: 'bgGreen',
                            when: [{ on: 'git.no-git', do: 'hide' }]
                        },
                        {
                            ...makeWidget('d', 'D', 'bgGreen'),
                            merge: 'no-padding' as const
                        }
                    ]
                }
            ]
        };

        const refResult = stripSgrCodes(renderLineEntry(refLine, { settings: { defaultPadding: padding } }));
        const testResult = stripSgrCodes(renderLineEntry(testLine, { settings: { defaultPadding: padding } }));

        // D must appear with its leading padding in the test output (same as reference)
        expect(testResult).toContain('D');
        // The test output must match the reference (C absent = C hidden)
        expect(testResult).toBe(refResult);
    });
});