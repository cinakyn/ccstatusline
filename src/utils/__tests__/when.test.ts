import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import type { Settings } from '../../types/Settings';
import { SettingsSchema } from '../../types/Settings';
import type {
    WhenPredicate,
    WhenRule
} from '../../types/When';
import { WhenRuleSchema } from '../../types/When';
import type { WidgetItem } from '../../types/Widget';
import { evaluateWhen } from '../when';

describe('WhenRuleSchema', () => {
    it('accepts valid git.no-git hide rule', () => {
        const rule = { on: 'git.no-git', do: 'hide' };
        expect(WhenRuleSchema.parse(rule)).toEqual(rule);
    });

    it('accepts setTag rule with tag name', () => {
        const rule = { on: 'git.no-remote', do: 'setTag', tag: 'alert' };
        expect(WhenRuleSchema.parse(rule)).toEqual(rule);
    });

    it('rejects setTag rule without tag field', () => {
        expect(() => WhenRuleSchema.parse({ on: 'git.no-remote', do: 'setTag' })).toThrow();
    });

    it('rejects setTag rule with empty tag name', () => {
        expect(() => WhenRuleSchema.parse({ on: 'git.no-remote', do: 'setTag', tag: '' })).toThrow();
    });

    it('rejects unknown action', () => {
        expect(() => WhenRuleSchema.parse({ on: 'git.no-git', do: 'invalid' })).toThrow();
    });

    it('rejects removed color/bg/bold actions', () => {
        expect(() => WhenRuleSchema.parse({ on: 'git.no-git', do: 'color', value: 'red' })).toThrow();
        expect(() => WhenRuleSchema.parse({ on: 'git.no-git', do: 'bg', value: 'red' })).toThrow();
        expect(() => WhenRuleSchema.parse({ on: 'git.no-git', do: 'bold', value: true })).toThrow();
    });

    it('rejects {on: core.empty, do: setTag} combo', () => {
        expect(() => WhenRuleSchema.parse({ on: 'core.empty', do: 'setTag', tag: 'x' }))
            .toThrow(/core\.empty.*hide/i);
    });

    it('accepts {on: core.empty, do: hide}', () => {
        const rule = { on: 'core.empty', do: 'hide' };
        expect(WhenRuleSchema.parse(rule)).toEqual(rule);
    });
});

const ctx: RenderContext = {};
const settings = SettingsSchema.parse({});
const item: WidgetItem = { id: '1', type: 'git-branch' };

/**
 * Injects a fake predicate evaluator so tests can control match results
 * directly without going through git/FS side effects. Matches the signature
 * of the real `evaluatePredicate` exported from `when-predicates.ts`.
 */
type PredicateFn = (
    predicate: WhenPredicate,
    item: WidgetItem,
    context: RenderContext,
    settings: Settings,
    renderedText: string
) => boolean;

describe('evaluateWhen', () => {
    let evaluator: ReturnType<typeof vi.fn<PredicateFn>>;

    beforeEach(() => {
        evaluator = vi.fn<PredicateFn>();
    });

    it('returns no overrides for empty rule list', () => {
        expect(evaluateWhen([], item, ctx, settings, 'text', { evaluator })).toEqual({ hide: false });
    });

    it('returns no overrides for undefined rule list', () => {
        expect(evaluateWhen(undefined, item, ctx, settings, 'text', { evaluator })).toEqual({ hide: false });
    });

    it('hides when any hide rule matches (union-OR)', () => {
        evaluator
            .mockReturnValueOnce(false) // git.no-git: false
            .mockReturnValueOnce(true); // git.no-remote: true
        const rules: WhenRule[] = [
            { on: 'git.no-git', do: 'hide' },
            { on: 'git.no-remote', do: 'hide' }
        ];
        const result = evaluateWhen(rules, item, ctx, settings, 'text', { evaluator });
        expect(result.hide).toBe(true);
    });

    it('does not short-circuit: evaluates all rules', () => {
        evaluator.mockReturnValue(true);
        const taggedItem: WidgetItem = { ...item, tags: { alert: { color: 'red' } } };
        const rules: WhenRule[] = [
            { on: 'git.no-git', do: 'hide' },
            { on: 'git.no-remote', do: 'setTag', tag: 'alert' }
        ];
        evaluateWhen(rules, taggedItem, ctx, settings, 'text', { evaluator });
        expect(evaluator).toHaveBeenCalledTimes(2);
    });

    it('applies setTag color override first-wins (rule 1 has highest priority)', () => {
        evaluator.mockReturnValue(true);
        const taggedItem: WidgetItem = {
            ...item,
            tags: {
                a: { color: 'red' },
                b: { color: 'blue' }
            }
        };
        const rules: WhenRule[] = [
            { on: 'git.no-git', do: 'setTag', tag: 'a' },
            { on: 'git.no-remote', do: 'setTag', tag: 'b' }
        ];
        const result = evaluateWhen(rules, taggedItem, ctx, settings, 'text', { evaluator });
        expect(result.colorOverride).toBe('red');
    });

    it('setTag applies color, backgroundColor, and bold overrides independently', () => {
        evaluator.mockReturnValue(true);
        const taggedItem: WidgetItem = {
            ...item,
            tags: {
                warn: { backgroundColor: 'yellow' },
                strong: { bold: true }
            }
        };
        const rules: WhenRule[] = [
            { on: 'git.no-git', do: 'setTag', tag: 'warn' },
            { on: 'git.no-remote', do: 'setTag', tag: 'strong' }
        ];
        const result = evaluateWhen(rules, taggedItem, ctx, settings, 'text', { evaluator });
        expect(result.bgOverride).toBe('yellow');
        expect(result.boldOverride).toBe(true);
    });

    it('non-matching rules do not override', () => {
        evaluator.mockReturnValue(false);
        const taggedItem: WidgetItem = { ...item, tags: { a: { color: 'red' } } };
        const rules: WhenRule[] = [{ on: 'git.no-git', do: 'setTag', tag: 'a' }];
        const result = evaluateWhen(rules, taggedItem, ctx, settings, 'text', { evaluator });
        expect(result.colorOverride).toBeUndefined();
    });

    it('setTag rule referencing missing tag is silently skipped', () => {
        evaluator.mockReturnValue(true);
        const rules: WhenRule[] = [{ on: 'git.no-git', do: 'setTag', tag: 'missing' }];
        const result = evaluateWhen(rules, item, ctx, settings, 'text', { evaluator });
        expect(result.colorOverride).toBeUndefined();
        expect(result.hide).toBe(false);
    });

    it('when skipEmpty=true, core.empty rules are ignored', () => {
        evaluator.mockReturnValue(true);
        const rules: WhenRule[] = [{ on: 'core.empty', do: 'hide' }];
        const result = evaluateWhen(rules, item, ctx, settings, '', { skipEmpty: true, evaluator });
        expect(result.hide).toBe(false);
        expect(evaluator).not.toHaveBeenCalled();
    });

    it('when onlyEmpty=true, non-empty-predicate rules are ignored', () => {
        evaluator.mockReturnValue(true);
        const rules: WhenRule[] = [
            { on: 'git.no-git', do: 'hide' },
            { on: 'core.empty', do: 'hide' }
        ];
        const result = evaluateWhen(rules, item, ctx, settings, '', { onlyEmpty: true, evaluator });
        expect(result.hide).toBe(true);
        expect(evaluator).toHaveBeenCalledTimes(1);
        expect(evaluator).toHaveBeenCalledWith('core.empty', item, ctx, settings, '', undefined);
    });
});

describe('CCSTATUSLINE_DEBUG logging', () => {
    let evaluator: ReturnType<typeof vi.fn<PredicateFn>>;
    let prevDebug: string | undefined;

    beforeEach(() => {
        evaluator = vi.fn<PredicateFn>();
        prevDebug = process.env.CCSTATUSLINE_DEBUG;
    });

    afterEach(() => {
        if (prevDebug === undefined) {
            delete process.env.CCSTATUSLINE_DEBUG;
        } else {
            process.env.CCSTATUSLINE_DEBUG = prevDebug;
        }
    });

    it('logs rule evaluation to stderr when CCSTATUSLINE_DEBUG=1', () => {
        const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        process.env.CCSTATUSLINE_DEBUG = '1';
        evaluator.mockReturnValue(true);

        evaluateWhen([{ on: 'git.no-git', do: 'hide' }], item, ctx, settings, 'x', { evaluator });

        expect(errSpy).toHaveBeenCalled();
        const payload = errSpy.mock.calls.map(c => String(c[0])).join('');
        expect(payload).toMatch(/git\.no-git/);
        expect(payload).toMatch(/hide/);
        expect(payload).toMatch(/match=true/);

        errSpy.mockRestore();
    });

    it('does not log when CCSTATUSLINE_DEBUG unset', () => {
        const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        delete process.env.CCSTATUSLINE_DEBUG;
        evaluator.mockReturnValue(true);

        evaluateWhen([{ on: 'git.no-git', do: 'hide' }], item, ctx, settings, 'x', { evaluator });

        expect(errSpy).not.toHaveBeenCalled();
        errSpy.mockRestore();
    });
});