import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { SettingsSchema } from '../../types/Settings';
import type { WhenRule } from '../../types/When';
import type { WidgetItem } from '../../types/Widget';
import { WidgetItemSchema } from '../../types/Widget';
import {
    migrateAlternateColorsToTags,
    migrateConfig
} from '../migrations';
import { evaluateWhen } from '../when';

const settings = SettingsSchema.parse({});
const ctx: RenderContext = {};

function firstOrFail<T>(arr: T[] | undefined, msg: string): T {
    if (!arr || arr.length === 0)
        throw new Error(msg);
    const head = arr[0];
    if (head === undefined)
        throw new Error(msg);
    return head;
}

/**
 * Manually execute each matching rule's override path so we can compare the
 * resolved style purely from the migration output, without depending on the
 * renderer pipeline.
 */
function resolveOverrides(item: WidgetItem, matchedTags: string[]): {
    color?: string;
    backgroundColor?: string;
    bold?: boolean;
} {
    const rules: WhenRule[] = matchedTags.map(tag => ({
        on: 'core.empty',
        do: 'setTag',
        tag
    }));
    const result = evaluateWhen(
        rules,
        item,
        ctx,
        settings,
        '',
        {
            evaluator: () => true,
            skipEmpty: false
        }
    );
    return {
        color: result.colorOverride,
        backgroundColor: result.bgOverride,
        bold: result.boldOverride
    };
}

describe('migrateAlternateColorsToTags', () => {
    it('moves alternateColors entries into tags and synthesizes setTag rules', () => {
        const migrated = migrateAlternateColorsToTags({
            id: '1',
            type: 'vim-mode',
            color: 'white',
            alternateColors: {
                insert: { color: 'red', bold: true },
                visual: { color: 'orange' }
            }
        });

        expect(migrated.alternateColors).toBeUndefined();
        expect(migrated.tags).toEqual({
            insert: { color: 'red', bold: true },
            visual: { color: 'orange' }
        });
        expect(migrated.when).toEqual([
            { on: 'vim-mode.insert', do: 'setTag', tag: 'insert' },
            { on: 'vim-mode.visual', do: 'setTag', tag: 'visual' }
        ]);
    });

    it('folds legacy {do:color} rules into inline tags and rewrites the rule', () => {
        const migrated = migrateAlternateColorsToTags({
            id: '1',
            type: 'git-branch',
            when: [
                { on: 'no-remote', do: 'color', value: 'red' }
            ]
        });

        const tags = migrated.tags as Record<string, { color?: string }>;
        const tagNames = Object.keys(tags);
        expect(tagNames).toHaveLength(1);
        const tagName = firstOrFail(tagNames, 'expected at least one inline tag');
        expect(tagName.startsWith('__inline-')).toBe(true);
        expect(tags[tagName]).toEqual({ color: 'red' });
        expect(migrated.when).toEqual([
            { on: 'git.no-remote', do: 'setTag', tag: tagName }
        ]);
    });

    it('preserves {do:hide} rules while namespacing the predicate key', () => {
        const migrated = migrateAlternateColorsToTags({
            id: '1',
            type: 'git-branch',
            when: [
                { on: 'no-git', do: 'hide' },
                { on: 'empty', do: 'hide' }
            ]
        });

        expect(migrated.when).toEqual([
            { on: 'git.no-git', do: 'hide' },
            { on: 'core.empty', do: 'hide' }
        ]);
        expect(migrated.tags).toBeUndefined();
    });

    it('is a no-op for items without alternateColors or legacy rules', () => {
        const input = { id: '1', type: 'model' };
        const migrated = migrateAlternateColorsToTags(input);
        expect(migrated).toEqual(input);
    });

    it('folds duplicate legacy {do:color} rules with same payload into the same inline tag', () => {
        const migrated = migrateAlternateColorsToTags({
            id: '1',
            type: 'git-branch',
            when: [
                { on: 'no-git', do: 'color', value: 'red' },
                { on: 'no-remote', do: 'color', value: 'red' }
            ]
        });

        const tags = migrated.tags as Record<string, unknown>;
        expect(Object.keys(tags)).toHaveLength(1);
        const rules = migrated.when as WhenRule[];
        expect(rules).toHaveLength(2);
        const r0 = firstOrFail(rules, 'expected rule 0');
        const r1 = rules[1];
        if (r1 === undefined)
            throw new Error('expected rule 1');
        const tagName0 = r0.do === 'setTag' ? r0.tag : '';
        const tagName1 = r1.do === 'setTag' ? r1.tag : '';
        expect(tagName0).toBe(tagName1);
    });

    it('combines bg + bold legacy rules into separate inline tags', () => {
        const migrated = migrateAlternateColorsToTags({
            id: '1',
            type: 'git-branch',
            when: [
                { on: 'no-git', do: 'bg', value: 'yellow' },
                { on: 'no-remote', do: 'bold', value: true }
            ]
        });

        const tags = migrated.tags as Record<string, {
            backgroundColor?: string;
            bold?: boolean;
        }>;
        expect(Object.keys(tags)).toHaveLength(2);
        const rules = migrated.when as WhenRule[];
        expect(rules).toHaveLength(2);
        expect(rules.every(r => r.do === 'setTag')).toBe(true);

        const r0 = firstOrFail(rules, 'expected rule 0');
        const r1 = rules[1];
        if (r1 === undefined)
            throw new Error('expected rule 1');
        if (r0.do !== 'setTag' || r1.do !== 'setTag')
            throw new Error('expected setTag rules');
        expect(tags[r0.tag]).toEqual({ backgroundColor: 'yellow' });
        expect(tags[r1.tag]).toEqual({ bold: true });
    });
});

describe('v3 → v4 config migration integration', () => {
    it('round-trips alternateColors through migrateConfig and produces valid WidgetItems', () => {
        const v3Config = {
            version: 3,
            lines: [[
                {
                    id: 'vim',
                    type: 'vim-mode',
                    color: 'white',
                    alternateColors: {
                        insert: { color: 'red', bold: true },
                        visual: { color: 'orange' }
                    }
                }
            ]]
        };

        const migrated = migrateConfig(v3Config, 4) as Record<string, unknown>;
        expect(migrated.version).toBe(4);

        const lines = migrated.lines as { groups: { widgets: Record<string, unknown>[] }[] }[];
        const firstLine = firstOrFail(lines, 'expected at least one line');
        const firstGroup = firstOrFail(firstLine.groups, 'expected at least one group');
        const item = firstOrFail(firstGroup.widgets, 'expected at least one item');

        // Parse through the schema to make sure the output is shape-valid v4.
        const parsed = WidgetItemSchema.parse(item);
        expect(parsed.tags).toEqual({
            insert: { color: 'red', bold: true },
            visual: { color: 'orange' }
        });
        expect(parsed.when).toEqual([
            { on: 'vim-mode.insert', do: 'setTag', tag: 'insert' },
            { on: 'vim-mode.visual', do: 'setTag', tag: 'visual' }
        ]);

        // Behavioral round-trip: resolving the `insert` tag via the new
        // setTag pipeline produces the same overrides the old
        // alternateColors.insert entry would have produced.
        const overrides = resolveOverrides(parsed, ['insert']);
        expect(overrides).toEqual({
            color: 'red',
            backgroundColor: undefined,
            bold: true
        });
    });

    it('round-trips legacy {do:color} rules through migrateConfig', () => {
        const v3Config = {
            version: 3,
            lines: [[
                {
                    id: 'gb',
                    type: 'git-branch',
                    when: [
                        { on: 'no-remote', do: 'color', value: 'red' }
                    ]
                }
            ]]
        };

        const migrated = migrateConfig(v3Config, 4) as Record<string, unknown>;
        const lines = migrated.lines as { groups: { widgets: Record<string, unknown>[] }[] }[];
        const firstLine = firstOrFail(lines, 'expected at least one line');
        const firstGroup = firstOrFail(firstLine.groups, 'expected at least one group');
        const item = firstOrFail(firstGroup.widgets, 'expected at least one item');

        const parsed = WidgetItemSchema.parse(item);
        const rules = parsed.when ?? [];
        expect(rules).toHaveLength(1);
        const rule = firstOrFail(rules, 'expected at least one rule');
        if (rule.do !== 'setTag')
            throw new Error('expected migrated rule to use setTag');

        // Resolving the inline tag reproduces the original `red` color.
        const overrides = resolveOverrides(parsed, [rule.tag]);
        expect(overrides.color).toBe('red');
    });
});