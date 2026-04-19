import { z } from 'zod';

/**
 * Dotted-key predicate string (e.g. `core.empty`, `git.no-git`,
 * `vim-mode.insert`, `model.opus`). Format: `{category}.{value}`.
 *
 * The schema accepts any non-empty string here so `When.ts` stays free of
 * imports on the widget/catalog layer. Deeper validation (key exists in
 * catalog + is valid for a given `WidgetItem`) happens at settings-load time
 * via `validateWhenForItem` in `utils/when-catalog.ts`.
 */
export const WhenPredicateSchema = z.string().min(1);
export const WhenActionSchema = z.enum(['hide', 'setTag']);

/**
 * A `WhenRule` is a discriminated union on `do`:
 *   - `{ on, do: 'hide' }` — unconditional hide when `on` matches
 *   - `{ on, do: 'setTag', tag }` — apply `item.tags[tag]` overrides
 *
 * The old `color`/`bg`/`bold` variants are gone; those styles are now
 * expressed as `tags` entries referenced via `setTag`.
 *
 * Constraint: `core.empty` may only pair with `do: 'hide'`. Attaching
 * `setTag` to `core.empty` is rejected because the post-render pass exists
 * only to make a hide decision based on widget output.
 */
/**
 * Some predicates (e.g. `text.match`) need extra data carried by the rule
 * beyond the dotted key. `args` is an optional string-keyed bag; each
 * predicate documents the keys it expects. Keeping the type loose here lets
 * new predicates opt into new args without widening the schema each time.
 */
export const WhenArgsSchema = z.record(z.string(), z.string());

export const WhenRuleSchema = z.discriminatedUnion('do', [
    z.object({
        on: WhenPredicateSchema,
        do: z.literal('hide'),
        args: WhenArgsSchema.optional()
    }),
    z.object({
        on: WhenPredicateSchema,
        do: z.literal('setTag'),
        tag: z.string().min(1),
        args: WhenArgsSchema.optional()
    })
]).refine(
    rule => !(rule.on === 'core.empty' && rule.do !== 'hide'),
    { message: 'Predicate \'core.empty\' may only pair with action \'hide\'' }
);

export type WhenPredicate = z.infer<typeof WhenPredicateSchema>;
export type WhenAction = z.infer<typeof WhenActionSchema>;
export type WhenArgs = z.infer<typeof WhenArgsSchema>;
export type WhenRule = z.infer<typeof WhenRuleSchema>;