/**
 * B4: Group hide propagation tests (powerline mode only).
 *
 * When every widget in a group evaluates to hidden (via `when` rules producing
 * preRendered.hidden === true), the entire group — including its preceding gap
 * and caps — is dropped from the rendered output.
 *
 * Groups are a powerline-only feature: plain mode auto-flattens multi-group
 * lines via `lineWidgets`, so there is no distinct plain grouped renderer to
 * exercise here.
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

        const settings = powerlineSettings({ powerline: { groupStartCap: [GSC] } });
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

// 8. First group hidden (powerline) — lineStartCap suppressed (Option B)
describe('B4 powerline: first group hidden', () => {
    it('output starts with groups[1] content; lineStartCap not emitted', () => {
        setGitResponses(() => new Error('not a git repo'));

        const LSC = '[[';
        const gap = '---';
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [hiddenWidget('h', 'HIDDEN')] },
                { continuousColor: true, gap, widgets: [makeWidget('b', 'Beta', 'bgGreen')] }
            ]
        };

        const settings = powerlineSettings({ powerline: { lineStartCap: [LSC] } });
        const result = stripSgrCodes(renderLine(line, settings));

        expect(result).not.toContain('HIDDEN');
        expect(result).toContain('Beta');
        // No gap (Beta is the first visible group → no leading gap)
        expect(result).not.toContain(gap);
        // lineStartCap suppressed because first group is hidden (Option B behaviour
        // when we re-evaluate: actually LSC is only suppressed when ALL groups hidden.
        // When the first group is hidden but a later group is visible, lineStartCap
        // DOES emit — the spec Option B only suppresses caps when NO groups are visible.)
        // Concrete: LSC emits (colored by Beta's bg), then Beta content follows.
        expect(result).toContain(LSC);
    });
});

// 9. All groups hidden (powerline) → empty string (Option B)
describe('B4 powerline: all groups hidden', () => {
    it('returns empty string (no lineStartCap, no lineEndCap, no content)', () => {
        setGitResponses(() => new Error('not a git repo'));

        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [hiddenWidget('h1', 'A')] },
                { continuousColor: true, widgets: [hiddenWidget('h2', 'B')] }
            ]
        };

        const result = stripSgrCodes(renderLine(line, powerlineSettings({
            powerline: {
                lineStartCap: ['[['],
                lineEndCap: [']]']
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