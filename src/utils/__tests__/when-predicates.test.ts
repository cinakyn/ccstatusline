import { execSync } from 'child_process';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { SettingsSchema } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { clearGitCache } from '../git';
import { evaluatePredicate } from '../when-predicates';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
    execFileSync: vi.fn()
}));

const mockExecSync = execSync as unknown as {
    mockImplementation: (impl: (command: string) => string) => void;
    mockReset: () => void;
};

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

const ctx: RenderContext = {};
const settings = SettingsSchema.parse({});
const item: WidgetItem = { id: 'x', type: 'git-branch' };

beforeEach(() => {
    clearGitCache();
    mockExecSync.mockReset();
});

describe('evaluatePredicate (catalog dispatch)', () => {
    describe('git.no-git', () => {
        it('true when not inside git work tree', () => {
            setGitResponses(() => new Error('not a git repo'));
            expect(evaluatePredicate('git.no-git', item, ctx, settings, '')).toBe(true);
        });
        it('false when inside git work tree', () => {
            setGitResponses(cmd => cmd === 'rev-parse --is-inside-work-tree' ? 'true\n' : '');
            expect(evaluatePredicate('git.no-git', item, ctx, settings, '')).toBe(false);
        });
    });

    describe('git.no-remote', () => {
        it('true when no upstream remote exists', () => {
            setGitResponses(() => new Error('no upstream'));
            expect(evaluatePredicate('git.no-remote', item, ctx, settings, '')).toBe(true);
        });
        it('false when upstream remote info present', () => {
            setGitResponses((cmd) => {
                if (cmd === 'remote get-url upstream') {
                    return 'git@github.com:owner/repo.git\n';
                }
                return '';
            });
            expect(evaluatePredicate('git.no-remote', item, ctx, settings, '')).toBe(false);
        });
    });

    describe('git.not-fork', () => {
        it('true when only one remote is configured', () => {
            setGitResponses((cmd) => {
                if (cmd === 'remote get-url origin') {
                    return 'git@github.com:owner/repo.git\n';
                }
                return new Error('no such remote');
            });
            expect(evaluatePredicate('git.not-fork', item, ctx, settings, '')).toBe(true);
        });
        it('false when origin and upstream point to different repos', () => {
            setGitResponses((cmd) => {
                if (cmd === 'remote get-url origin') {
                    return 'git@github.com:forker/repo.git\n';
                }
                if (cmd === 'remote get-url upstream') {
                    return 'git@github.com:upstream/repo.git\n';
                }
                return '';
            });
            expect(evaluatePredicate('git.not-fork', item, ctx, settings, '')).toBe(false);
        });
    });

    describe('core.empty', () => {
        it('true when rendered text length is 0', () => {
            expect(evaluatePredicate('core.empty', item, ctx, settings, '')).toBe(true);
        });
        it('false when rendered text has content', () => {
            expect(evaluatePredicate('core.empty', item, ctx, settings, 'x')).toBe(false);
        });
    });

    describe('git.clean', () => {
        it('true when not inside git work tree (no repo is trivially clean)', () => {
            setGitResponses(() => new Error('not a git repo'));
            expect(evaluatePredicate('git.clean', item, ctx, settings, '')).toBe(true);
        });
        it('true when status --porcelain output is empty', () => {
            setGitResponses((cmd) => {
                if (cmd === 'rev-parse --is-inside-work-tree')
                    return 'true\n';
                if (cmd.startsWith('--no-optional-locks status'))
                    return '';
                return '';
            });
            expect(evaluatePredicate('git.clean', item, ctx, settings, '')).toBe(true);
        });
        it('false when there are unstaged changes', () => {
            setGitResponses((cmd) => {
                if (cmd === 'rev-parse --is-inside-work-tree')
                    return 'true\n';
                if (cmd.startsWith('--no-optional-locks status'))
                    return ' M src/foo.ts\0';
                return '';
            });
            expect(evaluatePredicate('git.clean', item, ctx, settings, '')).toBe(false);
        });
        it('false when there are untracked files', () => {
            setGitResponses((cmd) => {
                if (cmd === 'rev-parse --is-inside-work-tree')
                    return 'true\n';
                if (cmd.startsWith('--no-optional-locks status'))
                    return '?? newfile.ts\0';
                return '';
            });
            expect(evaluatePredicate('git.clean', item, ctx, settings, '')).toBe(false);
        });
    });

    describe('text.match', () => {
        it('true when pattern matches rendered text', () => {
            expect(evaluatePredicate('text.match', item, ctx, settings, 'hello world', { pattern: 'wor' })).toBe(true);
        });
        it('true for regex metacharacters', () => {
            expect(evaluatePredicate('text.match', item, ctx, settings, '42%', { pattern: '^\\d+%$' })).toBe(true);
        });
        it('false when pattern does not match', () => {
            expect(evaluatePredicate('text.match', item, ctx, settings, 'hello', { pattern: 'xyz' })).toBe(false);
        });
        it('false when pattern arg is missing (guard against silent match-all)', () => {
            expect(evaluatePredicate('text.match', item, ctx, settings, 'anything')).toBe(false);
        });
        it('false when pattern arg is empty string', () => {
            expect(evaluatePredicate('text.match', item, ctx, settings, 'anything', { pattern: '' })).toBe(false);
        });
        it('false when pattern is invalid regex (does not throw)', () => {
            expect(evaluatePredicate('text.match', item, ctx, settings, 'anything', { pattern: '[unterminated' })).toBe(false);
        });
    });

    describe('category-namespaced widget states', () => {
        it('vim-mode.insert matches when widget state is insert', () => {
            const vimItem: WidgetItem = { id: 'v', type: 'vim-mode' };
            const vimCtx: RenderContext = { data: { vim: { mode: 'INSERT' } } };
            expect(evaluatePredicate('vim-mode.insert', vimItem, vimCtx, settings, '')).toBe(true);
            expect(evaluatePredicate('vim-mode.visual', vimItem, vimCtx, settings, '')).toBe(false);
        });

        it('model.opus matches when model id contains opus', () => {
            const modelItem: WidgetItem = { id: 'm', type: 'model' };
            const modelCtx: RenderContext = { data: { model: { id: 'claude-opus-4-7' } } };
            expect(evaluatePredicate('model.opus', modelItem, modelCtx, settings, '')).toBe(true);
            expect(evaluatePredicate('model.sonnet', modelItem, modelCtx, settings, '')).toBe(false);
        });

        it('state predicate does not match non-applicable widget type', () => {
            // Applying vim-mode.insert to a git-branch item never matches.
            expect(evaluatePredicate('vim-mode.insert', item, ctx, settings, '')).toBe(false);
        });
    });

    describe('unknown predicates', () => {
        it('returns false for unknown predicate keys', () => {
            expect(evaluatePredicate('bogus.key', item, ctx, settings, '')).toBe(false);
        });
    });
});