import { z } from 'zod';

export const WhenPredicateSchema = z.enum(['no-git', 'no-remote', 'not-fork', 'empty']);
export const WhenActionSchema = z.enum(['hide', 'color', 'bg', 'bold']);

export const WhenRuleSchema = z.object({
    on: WhenPredicateSchema,
    do: WhenActionSchema,
    value: z.union([z.string(), z.boolean()]).optional()
}).refine(
    rule => !(rule.on === 'empty' && rule.do !== 'hide'),
    { message: 'Predicate \'empty\' may only pair with action \'hide\'' }
);

export type WhenPredicate = z.infer<typeof WhenPredicateSchema>;
export type WhenAction = z.infer<typeof WhenActionSchema>;
export type WhenRule = z.infer<typeof WhenRuleSchema>;