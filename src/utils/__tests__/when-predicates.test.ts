import { execSync } from 'child_process';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { clearGitCache } from '../git';
import { evaluatePredicate } from '../when-predicates';

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
        if (result instanceof Error) {
            throw result;
        }
        return result;
    });
}

const ctx: RenderContext = {};

beforeEach(() => {
    clearGitCache();
    mockExecSync.mockReset();
});

describe('evaluatePredicate', () => {
    describe('no-git', () => {
        it('true when not inside git work tree', () => {
            setGitResponses(() => new Error('not a git repo'));
            expect(evaluatePredicate('no-git', ctx, '')).toBe(true);
        });
        it('false when inside git work tree', () => {
            setGitResponses(cmd => cmd === 'rev-parse --is-inside-work-tree' ? 'true\n' : '');
            expect(evaluatePredicate('no-git', ctx, '')).toBe(false);
        });
    });

    describe('no-remote', () => {
        it('true when no upstream remote exists', () => {
            setGitResponses(() => new Error('no upstream'));
            expect(evaluatePredicate('no-remote', ctx, '')).toBe(true);
        });
        it('false when upstream remote info present', () => {
            setGitResponses((cmd) => {
                if (cmd === 'remote get-url upstream') {
                    return 'git@github.com:owner/repo.git\n';
                }
                return '';
            });
            expect(evaluatePredicate('no-remote', ctx, '')).toBe(false);
        });
    });

    describe('not-fork', () => {
        it('true when only one remote is configured', () => {
            setGitResponses((cmd) => {
                if (cmd === 'remote get-url origin') {
                    return 'git@github.com:owner/repo.git\n';
                }
                return new Error('no such remote');
            });
            expect(evaluatePredicate('not-fork', ctx, '')).toBe(true);
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
            expect(evaluatePredicate('not-fork', ctx, '')).toBe(false);
        });
    });

    describe('empty', () => {
        it('true when rendered text length is 0', () => {
            expect(evaluatePredicate('empty', ctx, '')).toBe(true);
        });
        it('false when rendered text has content', () => {
            expect(evaluatePredicate('empty', ctx, 'x')).toBe(false);
        });
    });
});