import {
    describe,
    expect,
    it
} from 'vitest';

import type { WidgetItem } from '../../types/Widget';
import { rewriteLegacyHideFlags } from '../migrations';

const item = (over: Partial<WidgetItem>): WidgetItem => ({ id: '1', type: 'git-branch', ...over });

describe('rewriteLegacyHideFlags', () => {
    it('returns item unchanged when no legacy flags present', () => {
        const i = item({ metadata: { other: 'keep' } });
        expect(rewriteLegacyHideFlags(i)).toEqual(i);
    });

    it('rewrites hideNoGit="true" to when[git.no-git, hide]', () => {
        const i = item({ metadata: { hideNoGit: 'true' } });
        const r = rewriteLegacyHideFlags(i);
        expect(r.when).toEqual([{ on: 'git.no-git', do: 'hide' }]);
        expect(r.metadata?.hideNoGit).toBeUndefined();
    });

    it('rewrites hideNoRemote, hideWhenNotFork, hideWhenEmpty', () => {
        const i = item({
            type: 'skills',
            metadata: { hideNoRemote: 'true', hideWhenNotFork: 'true', hideWhenEmpty: 'true' }
        });
        const r = rewriteLegacyHideFlags(i);
        expect(r.when).toEqual([
            { on: 'git.no-remote', do: 'hide' },
            { on: 'git.not-fork', do: 'hide' },
            { on: 'core.empty', do: 'hide' }
        ]);
    });

    it('ignores flags set to "false" or missing', () => {
        const i = item({ metadata: { hideNoGit: 'false' } });
        const r = rewriteLegacyHideFlags(i);
        expect(r.when).toBeUndefined();
    });

    it('dedupes when legacy flag and equivalent when rule both present', () => {
        const i = item({
            metadata: { hideNoGit: 'true' },
            when: [{ on: 'git.no-git', do: 'hide' }]
        });
        const r = rewriteLegacyHideFlags(i);
        expect(r.when).toEqual([{ on: 'git.no-git', do: 'hide' }]);
    });

    it('appends to existing when array without clobbering', () => {
        const i = item({
            metadata: { hideNoGit: 'true' },
            when: [{ on: 'git.no-remote', do: 'setTag', tag: 'alert' }],
            tags: { alert: { color: 'red' } }
        });
        const r = rewriteLegacyHideFlags(i);
        expect(r.when).toEqual([
            { on: 'git.no-remote', do: 'setTag', tag: 'alert' },
            { on: 'git.no-git', do: 'hide' }
        ]);
    });

    it('leaves non-legacy metadata keys intact', () => {
        const i = item({ metadata: { hideNoGit: 'true', linkToGitHub: 'true' } });
        const r = rewriteLegacyHideFlags(i);
        expect(r.metadata).toEqual({ linkToGitHub: 'true' });
    });

    it('drops metadata entirely if it becomes empty', () => {
        const i = item({ metadata: { hideNoGit: 'true' } });
        const r = rewriteLegacyHideFlags(i);
        expect(r.metadata).toBeUndefined();
    });
});