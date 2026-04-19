import { execSync } from 'child_process';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { clearGitCache } from '../../utils/git';
import {
    buildIdeFileUrl,
    renderOsc8Link
} from '../../utils/hyperlink';
import { GitMainWorktreeRootDirWidget } from '../GitMainWorktreeRootDir';

vi.mock('child_process', () => ({ execSync: vi.fn() }));

const mockExecSync = execSync as unknown as {
    mockImplementation: (impl: () => never) => void;
    mockReturnValue: (value: string) => void;
    mockImplementationOnce: (impl: () => string) => void;
};

function render(options: { hideNoGit?: boolean; isPreview?: boolean; ideLink?: 'vscode' | 'cursor' } = {}) {
    const widget = new GitMainWorktreeRootDirWidget();
    const context: RenderContext = { isPreview: options.isPreview };
    const metadata: Record<string, string> = {};
    if (options.hideNoGit)
        metadata.hideNoGit = 'true';
    if (options.ideLink)
        metadata.linkToIDE = options.ideLink;
    const item: WidgetItem = {
        id: 'git-main-worktree-root-dir',
        type: 'git-main-worktree-root-dir',
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined
    };
    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('GitMainWorktreeRootDirWidget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearGitCache();
    });

    it('renders the preview placeholder', () => {
        expect(render({ isPreview: true })).toBe('my-repo');
    });

    it('strips trailing /.git from common-dir (main repo case)', () => {
        mockExecSync.mockImplementationOnce(() => 'true\n');
        mockExecSync.mockImplementationOnce(() => '/some/path/my-repo/.git\n');

        expect(render()).toBe('my-repo');
    });

    it('strips /.git when inside a linked worktree (common-dir still points at main)', () => {
        // When running from a linked worktree, --git-common-dir returns the
        // main repo's .git path, so the widget shows the main repo's name —
        // that is the whole point of this widget.
        mockExecSync.mockImplementationOnce(() => 'true\n');
        mockExecSync.mockImplementationOnce(() => '/repos/parent/.git\n');

        expect(render()).toBe('parent');
    });

    it('falls back to the raw common-dir when it does not end in /.git', () => {
        mockExecSync.mockImplementationOnce(() => 'true\n');
        mockExecSync.mockImplementationOnce(() => '/repos/bare.git\n');

        expect(render()).toBe('bare.git');
    });

    it('renders "no git" when not inside a git work tree', () => {
        mockExecSync.mockReturnValue('false\n');
        expect(render()).toBe('no git');
    });

    it('renders "no git" when git probes throw', () => {
        mockExecSync.mockImplementation(() => { throw new Error('No git'); });
        expect(render()).toBe('no git');
    });

    it('hides when hideNoGit metadata is true and git is unavailable', () => {
        mockExecSync.mockImplementation(() => { throw new Error('No git'); });
        expect(render({ hideNoGit: true })).toBeNull();
    });

    it('renders an OSC-8 IDE link when configured', () => {
        const widget = new GitMainWorktreeRootDirWidget();
        mockExecSync.mockImplementationOnce(() => 'true\n');
        mockExecSync.mockImplementationOnce(() => '/repos/parent/.git\n');

        const out = widget.render(
            {
                id: 'x',
                type: 'git-main-worktree-root-dir',
                metadata: { linkToIDE: 'vscode' }
            },
            {},
            DEFAULT_SETTINGS
        );

        expect(out).toBe(renderOsc8Link(buildIdeFileUrl('/repos/parent', 'vscode'), 'parent'));
    });

    it('exposes (l)ink to IDE keybind alongside hide-no-git keybinds', () => {
        const widget = new GitMainWorktreeRootDirWidget();
        const keybinds = widget.getCustomKeybinds();
        expect(keybinds).toContainEqual({ key: 'l', label: '(l)ink to IDE', action: 'toggle-link' });
    });

    it('advertises Git category and disables raw value', () => {
        const widget = new GitMainWorktreeRootDirWidget();
        expect(widget.getCategory()).toBe('Git');
        expect(widget.supportsRawValue()).toBe(false);
    });
});