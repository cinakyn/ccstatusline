import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import type {
    WhenPredicate,
    WhenRule
} from '../../types/When';
import { WhenRuleSchema } from '../../types/When';
import { evaluateWhen } from '../when';

describe('WhenRuleSchema', () => {
    it('accepts valid no-git hide rule', () => {
        const rule = { on: 'no-git', do: 'hide' };
        expect(WhenRuleSchema.parse(rule)).toEqual(rule);
    });

    it('accepts color rule with value', () => {
        const rule = { on: 'no-remote', do: 'color', value: 'red' };
        expect(WhenRuleSchema.parse(rule)).toEqual(rule);
    });

    it('accepts bold rule with boolean value', () => {
        const rule = { on: 'not-fork', do: 'bold', value: true };
        expect(WhenRuleSchema.parse(rule)).toEqual(rule);
    });

    it('rejects unknown predicate', () => {
        expect(() => WhenRuleSchema.parse({ on: 'bogus', do: 'hide' })).toThrow();
    });

    it('rejects unknown action', () => {
        expect(() => WhenRuleSchema.parse({ on: 'no-git', do: 'invalid' })).toThrow();
    });

    it('rejects {on: empty, do: color} combo', () => {
        expect(() => WhenRuleSchema.parse({ on: 'empty', do: 'color', value: 'red' }))
            .toThrow(/empty.*hide/i);
    });

    it('accepts {on: empty, do: hide}', () => {
        const rule = { on: 'empty', do: 'hide' };
        expect(WhenRuleSchema.parse(rule)).toEqual(rule);
    });
});

const ctx: RenderContext = {};

/**
 * Injects a fake predicate evaluator so tests can control match results
 * directly without going through git/FS side effects. Matches the signature
 * of the real `evaluatePredicate` exported from `when-predicates.ts`.
 */
type PredicateFn = (
    predicate: WhenPredicate,
    context: RenderContext,
    renderedText: string
) => boolean;

describe('evaluateWhen', () => {
    let evaluator: ReturnType<typeof vi.fn<PredicateFn>>;

    beforeEach(() => {
        evaluator = vi.fn<PredicateFn>();
    });

    it('returns no overrides for empty rule list', () => {
        expect(evaluateWhen([], ctx, 'text', { evaluator })).toEqual({ hide: false });
    });

    it('returns no overrides for undefined rule list', () => {
        expect(evaluateWhen(undefined, ctx, 'text', { evaluator })).toEqual({ hide: false });
    });

    it('hides when any hide rule matches (union-OR)', () => {
        evaluator
            .mockReturnValueOnce(false) // no-git: false
            .mockReturnValueOnce(true); // no-remote: true
        const rules: WhenRule[] = [
            { on: 'no-git', do: 'hide' },
            { on: 'no-remote', do: 'hide' }
        ];
        const result = evaluateWhen(rules, ctx, 'text', { evaluator });
        expect(result.hide).toBe(true);
    });

    it('does not short-circuit: evaluates all rules', () => {
        evaluator.mockReturnValue(true);
        const rules: WhenRule[] = [
            { on: 'no-git', do: 'hide' },
            { on: 'no-remote', do: 'color', value: 'red' }
        ];
        evaluateWhen(rules, ctx, 'text', { evaluator });
        expect(evaluator).toHaveBeenCalledTimes(2);
    });

    it('applies color overrides last-wins', () => {
        evaluator.mockReturnValue(true);
        const rules: WhenRule[] = [
            { on: 'no-git', do: 'color', value: 'red' },
            { on: 'no-remote', do: 'color', value: 'blue' }
        ];
        const result = evaluateWhen(rules, ctx, 'text', { evaluator });
        expect(result.colorOverride).toBe('blue');
    });

    it('bg and bold overrides applied independently', () => {
        evaluator.mockReturnValue(true);
        const rules: WhenRule[] = [
            { on: 'no-git', do: 'bg', value: 'yellow' },
            { on: 'no-remote', do: 'bold', value: true }
        ];
        const result = evaluateWhen(rules, ctx, 'text', { evaluator });
        expect(result.bgOverride).toBe('yellow');
        expect(result.boldOverride).toBe(true);
    });

    it('non-matching rules do not override', () => {
        evaluator.mockReturnValue(false);
        const rules: WhenRule[] = [{ on: 'no-git', do: 'color', value: 'red' }];
        const result = evaluateWhen(rules, ctx, 'text', { evaluator });
        expect(result.colorOverride).toBeUndefined();
    });

    it('when skipEmpty=true, empty-predicate rules are ignored', () => {
        evaluator.mockReturnValue(true);
        const rules: WhenRule[] = [{ on: 'empty', do: 'hide' }];
        const result = evaluateWhen(rules, ctx, '', { skipEmpty: true, evaluator });
        expect(result.hide).toBe(false);
        expect(evaluator).not.toHaveBeenCalled();
    });

    it('when onlyEmpty=true, non-empty-predicate rules are ignored', () => {
        evaluator.mockReturnValue(true);
        const rules: WhenRule[] = [
            { on: 'no-git', do: 'hide' },
            { on: 'empty', do: 'hide' }
        ];
        const result = evaluateWhen(rules, ctx, '', { onlyEmpty: true, evaluator });
        expect(result.hide).toBe(true);
        expect(evaluator).toHaveBeenCalledTimes(1);
        expect(evaluator).toHaveBeenCalledWith('empty', ctx, '');
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

        evaluateWhen([{ on: 'no-git', do: 'hide' }], ctx, 'x', { evaluator });

        expect(errSpy).toHaveBeenCalled();
        const payload = errSpy.mock.calls.map(c => String(c[0])).join('');
        expect(payload).toMatch(/no-git/);
        expect(payload).toMatch(/hide/);
        expect(payload).toMatch(/match=true/);

        errSpy.mockRestore();
    });

    it('does not log when CCSTATUSLINE_DEBUG unset', () => {
        const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        delete process.env.CCSTATUSLINE_DEBUG;
        evaluator.mockReturnValue(true);

        evaluateWhen([{ on: 'no-git', do: 'hide' }], ctx, 'x', { evaluator });

        expect(errSpy).not.toHaveBeenCalled();
        errSpy.mockRestore();
    });
});