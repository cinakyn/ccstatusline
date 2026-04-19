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

    it('rewrites hideNoGit="true" to when[git.no-git, hide] and preserves the metadata flag', () => {
        const i = item({ metadata: { hideNoGit: 'true' } });
        const r = rewriteLegacyHideFlags(i);
        expect(r.when).toEqual([{ on: 'git.no-git', do: 'hide' }]);
        // Metadata must survive so the widget-level `!branch` fallback (detached
        // HEAD, empty-repo) keeps hiding — the predicate only covers
        // `!isInsideGitWorkTree`.
        expect(r.metadata?.hideNoGit).toBe('true');
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

    it('preserves legacy and non-legacy metadata keys side-by-side with the synthesized when rule', () => {
        const i = item({ metadata: { hideNoGit: 'true', linkToGitHub: 'true' } });
        const r = rewriteLegacyHideFlags(i);
        expect(r.metadata).toEqual({ hideNoGit: 'true', linkToGitHub: 'true' });
        expect(r.when).toEqual([{ on: 'git.no-git', do: 'hide' }]);
    });

    it('keeps the legacy metadata flag so the widget-level `!branch` fallback still hides detached-HEAD / empty-repo', () => {
        const i = item({ metadata: { hideNoGit: 'true' } });
        const r = rewriteLegacyHideFlags(i);
        expect(r.metadata).toEqual({ hideNoGit: 'true' });
    });
});