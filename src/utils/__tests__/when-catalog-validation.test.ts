import {
    describe,
    expect,
    it
} from 'vitest';

import type { Line } from '../../types/Group';
import { validateWhenRulesInSettings } from '../when-catalog';

function oneLine(widgets: Line['groups'][number]['widgets']): Line[] {
    return [{ groups: [{ continuousColor: true, widgets }] }];
}

describe('validateWhenRulesInSettings', () => {
    it('returns no errors for valid rules', () => {
        const lines = oneLine([{
            id: 'w',
            type: 'git-branch',
            when: [{ on: 'git.no-git', do: 'hide' }]
        }]);
        expect(validateWhenRulesInSettings(lines)).toEqual([]);
    });

    it('flags unknown predicate keys', () => {
        const lines = oneLine([{
            id: 'w',
            type: 'git-branch',
            when: [{ on: 'bogus.key', do: 'hide' }]
        }]);
        const errors = validateWhenRulesInSettings(lines);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/unknown predicate 'bogus.key'/);
    });

    it('flags predicates that do not apply to the widget type', () => {
        const lines = oneLine([{
            id: 'w',
            type: 'git-branch',
            when: [{ on: 'vim-mode.insert', do: 'hide' }]
        }]);
        const errors = validateWhenRulesInSettings(lines);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/does not apply to widget type 'git-branch'/);
    });

    it('flags setTag rules pointing at missing tags', () => {
        const lines = oneLine([{
            id: 'w',
            type: 'git-branch',
            when: [{ on: 'git.no-git', do: 'setTag', tag: 'nonexistent' }],
            tags: { other: { color: 'red' } }
        }]);
        const errors = validateWhenRulesInSettings(lines);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/missing tag 'nonexistent'/);
        expect(errors[0]).toMatch(/available: other/);
    });

    it('flags text.match rules missing the required pattern arg', () => {
        const lines = oneLine([{
            id: 'w',
            type: 'git-branch',
            when: [{ on: 'text.match', do: 'hide' }]
        }]);
        const errors = validateWhenRulesInSettings(lines);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/requires argument 'pattern'/);
    });

    it('flags text.match rules with empty pattern arg', () => {
        const lines = oneLine([{
            id: 'w',
            type: 'git-branch',
            when: [{ on: 'text.match', do: 'hide', args: { pattern: '' } }]
        }]);
        const errors = validateWhenRulesInSettings(lines);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/requires argument 'pattern'/);
    });

    it('accepts text.match rules with non-empty pattern', () => {
        const lines = oneLine([{
            id: 'w',
            type: 'git-branch',
            when: [{ on: 'text.match', do: 'hide', args: { pattern: '^main$' } }]
        }]);
        expect(validateWhenRulesInSettings(lines)).toEqual([]);
    });

    it('accumulates multiple errors on the same widget', () => {
        const lines = oneLine([{
            id: 'w',
            type: 'git-branch',
            when: [
                { on: 'bogus', do: 'hide' },
                { on: 'vim-mode.insert', do: 'hide' }
            ]
        }]);
        const errors = validateWhenRulesInSettings(lines);
        expect(errors).toHaveLength(2);
    });
});