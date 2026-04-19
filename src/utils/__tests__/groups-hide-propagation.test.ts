/**
 * B4: Group hide propagation tests.
 *
 * When every widget in a group evaluates to hidden (via `when` rules producing
 * preRendered.hidden === true), the entire group — including its preceding gap
 * and caps — is dropped from the rendered output.  Applies to both plain and
 * powerline modes.
 *
 * Design decisions tested:
 *   - Line caps suppressed when ALL groups hidden (Option B).
 *   - Flex budget recomputed over visible groups only.
 *   - Color index does NOT advance past hidden groups (continuity).
 *   - Empty-widget group (`widgets: []`) is treated as hidden.
 *   - Partial hide (≥1 widget visible) does NOT drop the group.
 */

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

/** A widget whose `when: git.no-git → hide` rule fires when git throws. */
function hiddenWidget(id: string, text: string): {
    id: string;
    type: 'custom-text';
    customText: string;
    when: [{ on: 'git.no-git'; do: 'hide' }];
} {
    return {
        id,
        type: 'custom-text',
        customText: text,
        when: [{ on: 'git.no-git', do: 'hide' }]
    };
}

function plainSettings(overrides: Partial<Settings> = {}): Settings {
    return {
        ...DEFAULT_SETTINGS,
        flexMode: 'full',
        groupsEnabled: true,
        ...overrides,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            enabled: false
        }
    };
}

function powerlineSettings(overrides: SettingsInput = {}): Settings {
    const { powerline: plOverrides, ...rest } = overrides;
    return {
        ...DEFAULT_SETTINGS,
        flexMode: 'full',
        groupsEnabled: true,
        ...rest,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            separators: ['\uE0B0'],
            startCaps: [],
            endCaps: [],
            separatorInvertBackground: [false],
            theme: undefined,
            ...(plOverrides ?? {})
        }
    };
}

function renderLine(
    lineEntry: Line,
    settings: Settings,
    opts: { terminalWidth?: number; lineIndex?: number; globalPowerlineThemeIndex?: number } = {}
): string {
    const context: RenderContext = {
        isPreview: false,
        terminalWidth: opts.terminalWidth ?? 200,
        lineIndex: opts.lineIndex ?? 0,
        globalPowerlineThemeIndex: opts.globalPowerlineThemeIndex ?? 0
    };
    const preRenderedLines = preRenderAllWidgets([lineEntry], settings, context);
    const preRenderedWidgets = preRenderedLines[0] ?? [];
    const maxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);
    const widgets = lineWidgets(lineEntry);
    return renderStatusLine(widgets, settings, context, preRenderedWidgets, maxWidths, lineEntry);
}

function makeWidget(id: string, text: string, bg = 'bgBlue'): {
    id: string;
    type: 'custom-text';
    customText: string;
    color: string;
    backgroundColor: string;
} {
    return { id, type: 'custom-text', customText: text, color: 'white', backgroundColor: bg };
}

// ---------------------------------------------------------------------------
// Require chalk.level = 2 so ANSI codes are emitted for powerline tests
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
// PLAIN MODE TESTS
// ---------------------------------------------------------------------------

// 1. Middle group hidden
describe('B4 plain: middle group hidden', () => {
    it('output has groups[0] and groups[2] with exactly one gap between them', () => {
        setGitResponses(() => new Error('not a git repo'));

        const gap = ' | ';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'a', type: 'custom-text', customText: 'Alpha' }] },
                { continuousColor: true, gap, widgets: [hiddenWidget('hidden1', 'GONE'), hiddenWidget('hidden2', 'ALSO_GONE')] },
                { continuousColor: true, gap, widgets: [{ id: 'c', type: 'custom-text', customText: 'Gamma' }] }
            ]
        };

        const result = stripSgrCodes(renderLine(line, plainSettings({ defaultGroupGap: gap })));

        expect(result).toContain('Alpha');
        expect(result).toContain('Gamma');
        expect(result).not.toContain('GONE');
        expect(result).not.toContain('ALSO_GONE');

        // Exactly one gap between Alpha and Gamma, not two
        const parts = result.split(gap);
        expect(parts.length).toBe(2);
        expect(parts[0]).toContain('Alpha');
        expect(parts[1]).toContain('Gamma');
    });
});

// 2. First group hidden
describe('B4 plain: first group hidden', () => {
    it('output starts with groups[1] content; no leading gap', () => {
        setGitResponses(() => new Error('not a git repo'));

        const gap = '::';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [hiddenWidget('h', 'HIDDEN')] },
                { continuousColor: true, gap, widgets: [{ id: 'b', type: 'custom-text', customText: 'Beta' }] }
            ]
        };

        const result = stripSgrCodes(renderLine(line, plainSettings({ defaultGroupGap: gap })));

        expect(result).not.toContain('HIDDEN');
        expect(result).toContain('Beta');
        // No leading gap — gap is only before the second VISIBLE group
        expect(result).not.toContain(gap);
    });
});

// 3. Last group hidden
describe('B4 plain: last group hidden', () => {
    it('output ends with groups[N-2] content; no trailing gap', () => {
        setGitResponses(() => new Error('not a git repo'));

        const gap = '---';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'a', type: 'custom-text', customText: 'Alpha' }] },
                { continuousColor: true, gap, widgets: [hiddenWidget('h', 'HIDDEN')] }
            ]
        };

        const result = stripSgrCodes(renderLine(line, plainSettings({ defaultGroupGap: gap })));

        expect(result).toContain('Alpha');
        expect(result).not.toContain('HIDDEN');
        // No gap emitted because the second group (which carries the gap) is hidden
        expect(result).not.toContain(gap);
    });
});

// 4. All groups hidden → empty string
describe('B4 plain: all groups hidden', () => {
    it('returns empty string when every group is fully hidden', () => {
        setGitResponses(() => new Error('not a git repo'));

        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [hiddenWidget('h1', 'A')] },
                { continuousColor: true, widgets: [hiddenWidget('h2', 'B')] },
                { continuousColor: true, widgets: [hiddenWidget('h3', 'C')] }
            ]
        };

        const result = stripSgrCodes(renderLine(line, plainSettings()));
        expect(result).toBe('');
    });
});

// 5. Empty widgets array → treated as hidden
describe('B4 plain: empty widgets array', () => {
    it('group with widgets:[] is dropped; no gap emitted', () => {
        const gap = '  ';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'a', type: 'custom-text', customText: 'Alpha' }] },
                { continuousColor: true, gap, widgets: [] }
            ]
        };

        const result = stripSgrCodes(renderLine(line, plainSettings({ defaultGroupGap: gap })));

        expect(result).toContain('Alpha');
        // Empty group is dropped; no gap follows Alpha
        expect(result).not.toContain(gap);
    });

    it('first group empty, second group renders without leading gap', () => {
        const gap = '  ';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [] },
                { continuousColor: true, gap, widgets: [{ id: 'b', type: 'custom-text', customText: 'Beta' }] }
            ]
        };

        const result = stripSgrCodes(renderLine(line, plainSettings({ defaultGroupGap: gap })));

        expect(result).toContain('Beta');
        expect(result).not.toContain(gap);
    });
});

// 6. Partial hide — group with ≥1 visible widget is NOT dropped
describe('B4 plain: partial hide does NOT drop the group', () => {
    it('group with one hidden and one visible widget still renders (only visible widget)', () => {
        setGitResponses(() => new Error('not a git repo'));

        const gap = ' ';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'a', type: 'custom-text', customText: 'Alpha' }] },
                {
                    continuousColor: true,
                    gap,
                    widgets: [
                        hiddenWidget('hid', 'HIDDEN'),
                        { id: 'vis', type: 'custom-text', customText: 'Visible' }
                    ]
                }
            ]
        };

        const result = stripSgrCodes(renderLine(line, plainSettings({ defaultGroupGap: gap })));

        // Group 2 is NOT dropped (one widget visible)
        expect(result).toContain('Alpha');
        expect(result).toContain('Visible');
        expect(result).not.toContain('HIDDEN');
        // Gap IS emitted (group was kept)
        expect(result).toContain(gap);
    });
});

// ---------------------------------------------------------------------------
// POWERLINE MODE TESTS
// ---------------------------------------------------------------------------

// 7. Middle group hidden (powerline) — no caps for middle group
describe('B4 powerline: middle group hidden', () => {
    it('output has groups[0] and groups[2] content; only one gap between them', () => {
        setGitResponses(() => new Error('not a git repo'));

        const GSC = '>>';
        const gap = '::';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [makeWidget('a', 'Alpha', 'bgBlue')] },
                { continuousColor: true, gap, widgets: [hiddenWidget('h1', 'GONE')] },
                { continuousColor: true, gap, widgets: [makeWidget('c', 'Gamma', 'bgGreen')] }
            ]
        };

        const settings = powerlineSettings({ powerline: { startCaps: [GSC] } });
        const result = stripSgrCodes(renderLine(line, settings));

        expect(result).toContain('Alpha');
        expect(result).toContain('Gamma');
        expect(result).not.toContain('GONE');

        // Exactly one gap — as if the middle group never existed
        const parts = result.split(gap);
        expect(parts.length).toBe(2);
        expect(parts[0]).toContain('Alpha');
        expect(parts[1]).toContain('Gamma');
    });
});

// 8. First group hidden (powerline) — first visible group still gets its cap
describe('B4 powerline: first group hidden', () => {
    it('output starts with groups[1] content; startCap attaches to first visible group', () => {
        setGitResponses(() => new Error('not a git repo'));

        const LSC = '[[';
        const gap = '---';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [hiddenWidget('h', 'HIDDEN')] },
                { continuousColor: true, gap, widgets: [makeWidget('b', 'Beta', 'bgGreen')] }
            ]
        };

        const settings = powerlineSettings({ powerline: { startCaps: [LSC] } });
        const result = stripSgrCodes(renderLine(line, settings));

        expect(result).not.toContain('HIDDEN');
        expect(result).toContain('Beta');
        // No gap (Beta is the first visible group → no leading gap)
        expect(result).not.toContain(gap);
        // Start cap attaches to the first visible group (Beta).
        expect(result).toContain(LSC);
    });
});

// 9. All groups hidden (powerline) → empty string
describe('B4 powerline: all groups hidden', () => {
    it('returns empty string (no caps, no content)', () => {
        setGitResponses(() => new Error('not a git repo'));

        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [hiddenWidget('h1', 'A')] },
                { continuousColor: true, widgets: [hiddenWidget('h2', 'B')] }
            ]
        };

        const result = stripSgrCodes(renderLine(line, powerlineSettings({
            powerline: {
                startCaps: ['[['],
                endCaps: [']]']
            }
        })));

        // No caps and no content when all groups hidden
        expect(result).toBe('');
    });
});

// 10. Flex budget excludes hidden groups
describe('B4 powerline: flex budget excludes hidden groups', () => {
    it('free space split between two visible flex groups, not three', () => {
        setGitResponses(() => new Error('not a git repo'));

        const gap = '|G|';
        const terminalWidth = 90;

        // 3 groups, middle one hidden; groups 0 and 2 both have flex-separators
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'a1', type: 'custom-text', customText: 'L', backgroundColor: 'bgBlue' },
                        { id: 'af', type: 'flex-separator' },
                        { id: 'a2', type: 'custom-text', customText: 'R', backgroundColor: 'bgBlue' }
                    ]
                },
                {
                    continuousColor: true,
                    gap,
                    widgets: [hiddenWidget('hidden', 'HIDDEN')]
                },
                {
                    continuousColor: true,
                    gap,
                    widgets: [
                        { id: 'c1', type: 'custom-text', customText: 'X', backgroundColor: 'bgGreen' },
                        { id: 'cf', type: 'flex-separator' },
                        { id: 'c2', type: 'custom-text', customText: 'Y', backgroundColor: 'bgGreen' }
                    ]
                }
            ]
        };

        const result = stripSgrCodes(renderLine(line, powerlineSettings({ defaultPadding: '' }), { terminalWidth }));

        expect(result).toContain('L');
        expect(result).toContain('R');
        expect(result).toContain('X');
        expect(result).toContain('Y');
        expect(result).not.toContain('HIDDEN');

        // Only one gap between groups 0 and 2
        const parts = result.split(gap);
        expect(parts.length).toBe(2);

        const groupAPart = parts[0] ?? '';
        const groupCPart = parts[1] ?? '';

        // Both groups should be expanded (wider than their natural 2-char content)
        expect(groupAPart.length).toBeGreaterThan(3);
        expect(groupCPart.length).toBeGreaterThan(3);

        // Equal split (±1): the hidden middle group does NOT steal flex budget
        expect(Math.abs(groupAPart.length - groupCPart.length)).toBeLessThanOrEqual(1);
    });
});

// 11. Color index continuity across hidden groups
describe('B4 powerline: color index skips hidden groups', () => {
    it('group[2] uses color index 1 (not 2) when group[1] is hidden', () => {
        // nord-aurora bg colors: [BF616A(0), EBCB8B(1), 5E81AC(2), ...]
        // group[0]: 1 widget → consumes index 0 (BF616A)
        // group[1]: hidden → does NOT advance color index
        // group[2]: continuousColor:true → should start at index 1 (EBCB8B),
        //           NOT index 2 (5E81AC) which it would be if group[1] advanced it.

        setGitResponses(() => new Error('not a git repo'));

        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'a', type: 'custom-text', customText: 'A' }] },
                { continuousColor: true, widgets: [hiddenWidget('h', 'HIDDEN')] },
                { continuousColor: true, widgets: [{ id: 'c', type: 'custom-text', customText: 'C' }] }
            ]
        };

        const result = renderLine(line, powerlineSettings({
            colorLevel: 3,
            defaultPadding: '',
            powerline: { theme: 'nord-aurora', continueThemeAcrossLines: false }
        }));

        const color0bg = getColorAnsiCode('hex:BF616A', 'truecolor', true); // group[0]
        const color1bg = getColorAnsiCode('hex:EBCB8B', 'truecolor', true); // group[2] (hidden group skipped)
        const color2bg = getColorAnsiCode('hex:5E81AC', 'truecolor', true); // would be group[2] if hidden advanced color

        // group[0] uses BF616A
        expect(result).toContain(color0bg);
        // group[2] uses EBCB8B (index 1, not index 2)
        expect(result).toContain(color1bg);
        // 5E81AC must NOT appear (that would mean hidden group advanced the index)
        expect(result).not.toContain(color2bg);
    });
});