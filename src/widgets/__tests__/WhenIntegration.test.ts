import { execSync } from 'child_process';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { Line } from '../../types/Group';
import type { RenderContext } from '../../types/RenderContext';
import { SettingsSchema } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { stripSgrCodes } from '../../utils/ansi';
import { clearGitCache } from '../../utils/git';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../../utils/renderer';

function wrapAsLines(widgetLines: WidgetItem[][]): Line[] {
    return widgetLines.map(widgets => ({ groups: [{ continuousColor: true, widgets }] }));
}

vi.mock('child_process', () => ({ execSync: vi.fn() }));

const mockExecSync = execSync as unknown as { mockImplementation: (impl: (command: string) => string) => void; mockReset: () => void };

type GitResponder = (command: string) => string | Error;

function setGitResponses(responder: GitResponder): void {
    mockExecSync.mockImplementation((cmd) => {
        const gitCmd = cmd.startsWith('git ') ? cmd.slice(4) : cmd;
        const result = responder(gitCmd);
        if (result instanceof Error) {
            throw result;
        }
        return result;
    });
}

const settings = SettingsSchema.parse({});
const ctx: RenderContext = {};

beforeEach(() => {
    clearGitCache();
    mockExecSync.mockReset();
});

describe('when integration', () => {
    it('custom-text with when:[no-git,hide] is hidden when not in git', () => {
        // Outside a git work tree: all git commands fail
        setGitResponses(() => new Error('not a git repo'));

        const widget: WidgetItem = {
            id: '1',
            type: 'custom-text',
            customText: 'hello',
            when: [{ on: 'no-git', do: 'hide' }]
        };

        const result = preRenderAllWidgets(wrapAsLines([[widget]]), settings, ctx);

        expect(result[0]?.[0]?.hidden).toBe(true);
        expect(result[0]?.[0]?.content).toBe('');
    });

    it('custom-text with when:[no-git,hide] renders when inside git', () => {
        // Inside a git work tree: rev-parse --is-inside-work-tree returns 'true'
        setGitResponses((cmd) => {
            if (cmd === 'rev-parse --is-inside-work-tree') {
                return 'true\n';
            }
            return '';
        });

        const widget: WidgetItem = {
            id: '1',
            type: 'custom-text',
            customText: 'hello',
            when: [{ on: 'no-git', do: 'hide' }]
        };

        const result = preRenderAllWidgets(wrapAsLines([[widget]]), settings, ctx);

        expect(result[0]?.[0]?.hidden).toBeUndefined();
        expect(result[0]?.[0]?.content).toBe('hello');
    });

    it('hidden widget is excluded from renderStatusLine output', () => {
        setGitResponses(() => new Error('not a git repo'));

        // Line: [hiddenA, separator, visibleB]
        const widgets: WidgetItem[] = [
            {
                id: 'a',
                type: 'custom-text',
                customText: 'HIDE_ME',
                when: [{ on: 'no-git', do: 'hide' }]
            },
            { id: 'sep', type: 'separator' },
            { id: 'b', type: 'custom-text', customText: 'VISIBLE_B' }
        ];

        const preRendered = preRenderAllWidgets(wrapAsLines([widgets]), settings, ctx);
        const maxWidths = calculateMaxWidthsFromPreRendered(preRendered, settings);
        const line = renderStatusLine(widgets, settings, ctx, preRendered[0] ?? [], maxWidths);
        const plain = stripSgrCodes(line);

        expect(plain).toContain('VISIBLE_B');
        expect(plain).not.toContain('HIDE_ME');
    });

    it('hidden widget breaks its merge chain cleanly', () => {
        setGitResponses(() => new Error('not a git repo'));

        // A(merge=true, hidden) → B(merge=true) → C
        // A being hidden should drop out; B and C still render.
        const widgets: WidgetItem[] = [
            {
                id: 'a',
                type: 'custom-text',
                customText: 'A_TEXT',
                merge: true,
                when: [{ on: 'no-git', do: 'hide' }]
            },
            { id: 'b', type: 'custom-text', customText: 'B_TEXT', merge: true },
            { id: 'c', type: 'custom-text', customText: 'C_TEXT' }
        ];

        const preRendered = preRenderAllWidgets(wrapAsLines([widgets]), settings, ctx);
        const maxWidths = calculateMaxWidthsFromPreRendered(preRendered, settings);
        const line = renderStatusLine(widgets, settings, ctx, preRendered[0] ?? [], maxWidths);
        const plain = stripSgrCodes(line);

        expect(plain).not.toContain('A_TEXT');
        expect(plain).toContain('B_TEXT');
        expect(plain).toContain('C_TEXT');
    });

    it('git-branch with when:[no-remote,color,red] applies color override', () => {
        // Inside git with a branch, but no upstream remote:
        //   - rev-parse --is-inside-work-tree -> 'true'
        //   - branch --show-current -> 'main'
        //   - remote get-url upstream -> fails (no literal upstream remote)
        //   - rev-parse --abbrev-ref --symbolic-full-name @{upstream} -> fails
        //     (no tracking remote for current branch)
        setGitResponses((cmd) => {
            if (cmd === 'rev-parse --is-inside-work-tree') {
                return 'true\n';
            }
            if (cmd === 'branch --show-current') {
                return 'main\n';
            }
            if (cmd === 'remote get-url upstream') {
                return new Error('no such remote');
            }
            if (cmd === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') {
                return new Error('no upstream configured');
            }
            return '';
        });

        const widget: WidgetItem = {
            id: '1',
            type: 'git-branch',
            when: [{ on: 'no-remote', do: 'color', value: 'red' }]
        };

        const result = preRenderAllWidgets(wrapAsLines([[widget]]), settings, ctx);

        expect(result[0]?.[0]?.hidden).toBeUndefined();
        expect(result[0]?.[0]?.content).toContain('main');
        expect(result[0]?.[0]?.colorOverride).toBe('red');
    });
});