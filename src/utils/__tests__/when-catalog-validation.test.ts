import {
    describe,
    expect,
    it
} from 'vitest';

import type { Line } from '../../types/Group';
import type { WidgetItem } from '../../types/Widget';
import {
    listCategories,
    listPredicates,
    validateWhenRulesInSettings
} from '../when-catalog';

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

describe('when-catalog Core category is uniform across widgets', () => {
    const item = (type: string): WidgetItem => ({ id: 'x', type });

    // Stateful widgets previously bucketed their dynamic `{widget}.{state}`
    // predicates under the same `"Core"` category as the static `core.empty`,
    // making the Core picker look different for Model vs Thinking Effort vs
    // Vim Mode. After the fix, Core should contain exactly `core.empty` for
    // every widget type.
    const widgets = [
        'model',
        'thinking-effort',
        'vim-mode',
        'output-style',
        'git-branch',
        'custom-text'
    ];

    for (const type of widgets) {
        it(`Core category for '${type}' contains exactly [core.empty]`, () => {
            const keys = listPredicates(item(type), 'Core').map(e => e.key);
            expect(keys).toEqual(['core.empty']);
        });
    }

    it('Core category content is identical across every widget type', () => {
        const [head, ...rest] = widgets;
        if (!head)
            throw new Error('test requires at least one widget type');
        const first = listPredicates(item(head), 'Core').map(e => e.key);
        for (const type of rest) {
            const keys = listPredicates(item(type), 'Core').map(e => e.key);
            expect(keys).toEqual(first);
        }
    });

    it('stateful widgets expose their dynamic states under their own display-name category, not Core', () => {
        const modelCats = listCategories(item('model'));
        expect(modelCats).toContain('Core');
        expect(modelCats).toContain('Model');
        const modelOwn = listPredicates(item('model'), 'Model').map(e => e.key);
        expect(modelOwn).toContain('model.opus');

        const effortCats = listCategories(item('thinking-effort'));
        expect(effortCats).toContain('Thinking Effort');
        const effortOwn = listPredicates(item('thinking-effort'), 'Thinking Effort').map(e => e.key);
        expect(effortOwn).toEqual(expect.arrayContaining([
            'thinking-effort.none',
            'thinking-effort.low',
            'thinking-effort.high',
            'thinking-effort.max'
        ]));
    });
});