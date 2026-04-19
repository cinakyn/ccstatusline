import type { WidgetItem } from '../types/Widget';

/**
 * Pick a (fg, bg) slot from the active powerline theme at `widgetColorIndex`.
 * The renderer and `applyCustomPowerlineTheme` must agree on this mapping so
 * that copying a theme to a "custom" config produces the same visual output.
 */
export function pickPowerlineColors(
    themeColors: { fg: string[]; bg: string[] },
    widgetColorIndex: number
): { fg: string | undefined; bg: string | undefined } {
    return {
        fg: themeColors.fg[widgetColorIndex % themeColors.fg.length],
        bg: themeColors.bg[widgetColorIndex % themeColors.bg.length]
    };
}

/**
 * Return the next `widgetColorIndex` after consuming `widget`.
 *
 * Rules (shared by the renderer's flat + grouped paths and the theme-selector
 * `applyCustomPowerlineTheme` helper):
 *   1. Merge chains share one color slot — an explicit `merge` / `'no-padding'`
 *      does NOT advance the index, so the next widget re-uses the current slot.
 *   2. At a group boundary the first widget never treats the prior-group's
 *      merge flag as active (R4 merge termination), so we must advance even
 *      when `widget.merge` would otherwise suppress it.
 *
 * Note: the renderer additionally skips over `hidden` / empty widgets via an
 * outer `continue` before calling this helper — the theme-selector does not
 * have render-context, so a `when`-hidden widget copied into a "custom" theme
 * may land in the color slot the renderer actually skipped. That off-by-one
 * is inherent to previewing themes without a live render and is documented
 * here rather than fixed (a fix would require threading render context into
 * the TUI preview code path).
 */
export function advanceColorIndex(
    current: number,
    widget: Pick<WidgetItem, 'merge'>,
    isGroupBoundaryFirst: boolean
): number {
    if (widget.merge && !isGroupBoundaryFirst)
        return current;
    return current + 1;
}