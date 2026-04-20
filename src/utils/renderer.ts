import chalk from 'chalk';

import type {
    RenderContext,
    WidgetItem
} from '../types';
import { getColorLevelString } from '../types/ColorLevel';
import type { Line } from '../types/Group';
import type { Settings } from '../types/Settings';

import {
    getVisibleWidth,
    stripSgrCodes,
    truncateStyledText
} from './ansi';
import {
    applyColors,
    bgToFg,
    getColorAnsiCode,
    getPowerlineTheme
} from './colors';
import { calculateContextPercentage } from './context-percentage';
import type { GroupedMaxWidths } from './grouped-max-widths';
import { lineWidgets } from './groups';
import { getTerminalWidth } from './terminal';
import {
    evaluateWhen,
    hasEmptyPredicate
} from './when';
import { getWidget } from './widgets';

// Helper function to format token counts
export function formatTokens(count: number): string {
    if (count >= 1000000)
        return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000)
        return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
}

function resolveEffectiveTerminalWidth(
    detectedWidth: number | null,
    settings: Settings,
    context: RenderContext
): number | null {
    if (!detectedWidth) {
        return null;
    }

    const flexMode = settings.flexMode as string;

    if (context.isPreview) {
        if (flexMode === 'full') {
            return detectedWidth - 6;
        }
        if (flexMode === 'full-minus-40') {
            return detectedWidth - 40;
        }
        if (flexMode === 'full-until-compact') {
            return detectedWidth - 6;
        }
        return null;
    }

    if (flexMode === 'full') {
        return detectedWidth - 6;
    }
    if (flexMode === 'full-minus-40') {
        return detectedWidth - 40;
    }
    if (flexMode === 'full-until-compact') {
        const threshold = settings.compactThreshold;
        const contextPercentage = calculateContextPercentage(context);
        return contextPercentage >= threshold
            ? detectedWidth - 40
            : detectedWidth - 6;
    }

    return null;
}

// ---------------------------------------------------------------------------
// Shared powerline types used by flat and grouped renderers
// ---------------------------------------------------------------------------

interface PowerlineElement {
    content: string;
    bgColor?: string;
    fgColor?: string;
    bold?: boolean;
    widget: WidgetItem;
}

// ---------------------------------------------------------------------------
// Build powerline widget elements for a slice of widgets/preRendered arrays.
// Returns the built elements AND the final widgetColorIndex so the caller can
// pass it to the next group (continuousColor = true).
// ---------------------------------------------------------------------------

function buildPowerlineElements(
    widgets: WidgetItem[],
    preRenderedWidgets: PreRenderedWidget[],
    settings: Settings,
    themeColors: { fg: string[]; bg: string[] } | undefined,
    colorLevel: 'ansi16' | 'ansi256' | 'truecolor',
    widgetColorIndex: number,
    isFirstGroup: boolean  // used for merge-termination at group boundary
): { elements: PowerlineElement[]; finalColorIndex: number } {
    const filteredWidgets = widgets.filter(
        w => w.type !== 'separator' && w.type !== 'flex-separator'
    );

    // Map from filtered index → original widget index (for preRendered lookup)
    const preRenderedIndices: number[] = [];
    for (let i = 0; i < widgets.length; i++) {
        const w = widgets[i];
        if (w && w.type !== 'separator' && w.type !== 'flex-separator') {
            preRenderedIndices.push(i);
        }
    }

    const elements: PowerlineElement[] = [];
    const padding = settings.defaultPadding ?? '';
    // renderedWidgetCount tracks how many widgets have actually contributed an
    // element so far (i.e. were not hidden/empty and did not `continue`).  We
    // gate the group-boundary-first logic on this counter rather than the raw
    // loop index `i`, so that hidden first widgets don't silently leak their
    // merge flag into the next rendered widget's boundary check.
    let renderedWidgetCount = 0;

    for (let i = 0; i < filteredWidgets.length; i++) {
        const widget = filteredWidgets[i];
        if (!widget)
            continue;

        const actualIndex = preRenderedIndices[i];
        const preRendered = actualIndex !== undefined ? preRenderedWidgets[actualIndex] : undefined;
        const widgetImpl = getWidget(widget.type);

        let widgetText = '';
        let defaultColor = 'white';

        if (preRendered?.content && !preRendered.hidden) {
            widgetText = preRendered.content;
            if (widgetImpl)
                defaultColor = widgetImpl.getDefaultColor();
        }

        if (!widgetText)
            continue;

        // Strip ANSI for preserveColors + overrideForegroundColor combo
        if (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none'
            && widget.type === 'custom-command' && widget.preserveColors) {
            widgetText = stripSgrCodes(widgetText);
        }

        // Padding with merge awareness.
        // R4: at group boundary (renderedWidgetCount === 0 AND this is not the
        // first group) we suppress merge-with-previous because there is no
        // previous rendered widget in this group.  Using renderedWidgetCount
        // (not raw `i`) prevents a hidden first widget from leaking its merge
        // flag into the first actually-rendered widget's boundary check.
        const prevItem = i > 0 ? filteredWidgets[i - 1] : null;
        const nextItem = i < filteredWidgets.length - 1 ? filteredWidgets[i + 1] : null;

        // If this is the first rendered widget in a non-first group, ignore any
        // merge flag (merge terminates at group boundaries per R4).
        const isGroupBoundaryFirst = !isFirstGroup && renderedWidgetCount === 0;
        const prevMerge = isGroupBoundaryFirst ? null : prevItem?.merge;

        const omitLeadingPadding = prevMerge === 'no-padding';
        const omitTrailingPadding = widget.merge === 'no-padding' && nextItem;

        const paddedText = `${omitLeadingPadding ? '' : padding}${widgetText}${omitTrailingPadding ? '' : padding}`;

        // Colors
        let fgColor: string | undefined = widget.color ?? defaultColor;
        let bgColor: string | undefined = widget.backgroundColor;

        const skipFgTheme = widget.type === 'custom-command' && widget.preserveColors;

        if (themeColors) {
            if (!skipFgTheme)
                fgColor = themeColors.fg[widgetColorIndex % themeColors.fg.length] ?? fgColor;
            bgColor = themeColors.bg[widgetColorIndex % themeColors.bg.length] ?? bgColor;

            // Merge chains share the same color slot; only advance on non-merged widgets.
            // At a group-boundary first widget we already cleared the prevMerge, so the
            // merge flag on THIS widget (if any) only affects the next one within the group.
            if (!widget.merge || isGroupBoundaryFirst) {
                widgetColorIndex++;
            }
        }

        if (preRendered?.colorOverride !== undefined)
            fgColor = preRendered.colorOverride;
        if (preRendered?.bgOverride !== undefined)
            bgColor = preRendered.bgOverride;
        if (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none')
            fgColor = settings.overrideForegroundColor;

        const effectiveBold = preRendered?.boldOverride ?? widget.bold;

        elements.push({
            content: paddedText,
            bgColor: bgColor ?? undefined,
            fgColor,
            bold: effectiveBold,
            widget
        });
        renderedWidgetCount++;
    }

    return { elements, finalColorIndex: widgetColorIndex };
}

// ---------------------------------------------------------------------------
// Render a slice of powerline elements (already built) to a string.
// `separators` / `invertBgs` come from v3 config (flat path) or widgetSeparator
// (group path).  `separatorOffset` is the global running index so the caller
// can pick the right separator character.
// Bold is always reset before a separator or cap glyph so ANSI16 bright-bold
// cannot leak into those glyphs (visible seam bug).
// ---------------------------------------------------------------------------

function renderPowerlineElements(
    elements: PowerlineElement[],
    separators: string[],
    invertBgs: boolean[],
    separatorOffset: number,
    colorLevel: 'ansi16' | 'ansi256' | 'truecolor',
    settings: Settings
): string {
    let result = '';

    for (let i = 0; i < elements.length; i++) {
        const widget = elements[i];
        const nextWidget = elements[i + 1];

        if (!widget)
            continue;

        const shouldBold = settings.globalBold || widget.bold;
        const needsSeparator = i < elements.length - 1
            && separators.length > 0
            && nextWidget !== undefined
            && !widget.widget.merge;

        const isPreserveColors = widget.widget.type === 'custom-command' && widget.widget.preserveColors;

        let widgetContent = '';
        if (shouldBold && !isPreserveColors)
            widgetContent += '\x1b[1m';
        if (widget.fgColor && !isPreserveColors)
            widgetContent += getColorAnsiCode(widget.fgColor, colorLevel, false);
        if (widget.bgColor)
            widgetContent += getColorAnsiCode(widget.bgColor, colorLevel, true);

        widgetContent += widget.content;

        if (isPreserveColors) {
            widgetContent += '\x1b[0m';
        } else {
            widgetContent += '\x1b[49m\x1b[39m';
            // Always reset bold before a following separator or cap glyph. On
            // ANSI16 terminals, `\x1b[1m` renders the fg color as its bright
            // variant, so drawing a separator/cap while bold is still active
            // makes that glyph render in a different shade than the adjacent
            // pill bg (a visible seam at sector boundaries).
            if (shouldBold)
                widgetContent += '\x1b[22m';
        }

        result += widgetContent;

        if (needsSeparator) {
            const globalIndex = separatorOffset + i;
            const separatorIndex = Math.min(globalIndex, separators.length - 1);
            const separator = separators[separatorIndex] ?? '\uE0B0';
            const shouldInvert = invertBgs[separatorIndex] ?? false;

            const sameBackground = widget.bgColor && nextWidget.bgColor && widget.bgColor === nextWidget.bgColor;
            let separatorOutput: string;

            if (shouldInvert) {
                if (widget.bgColor && nextWidget.bgColor) {
                    if (sameBackground) {
                        const fgCode = getColorAnsiCode(nextWidget.fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(widget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    } else {
                        const fgCode = getColorAnsiCode(bgToFg(nextWidget.bgColor), colorLevel, false);
                        const bgCode = getColorAnsiCode(widget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    }
                } else if (widget.bgColor) {
                    separatorOutput = getColorAnsiCode(bgToFg(widget.bgColor), colorLevel, false) + separator + '\x1b[39m';
                } else if (nextWidget.bgColor) {
                    separatorOutput = getColorAnsiCode(bgToFg(nextWidget.bgColor), colorLevel, false) + separator + '\x1b[39m';
                } else {
                    separatorOutput = separator;
                }
            } else {
                if (widget.bgColor && nextWidget.bgColor) {
                    if (sameBackground) {
                        const fgCode = getColorAnsiCode(widget.fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(nextWidget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    } else {
                        const fgCode = getColorAnsiCode(bgToFg(widget.bgColor), colorLevel, false);
                        const bgCode = getColorAnsiCode(nextWidget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    }
                } else if (widget.bgColor) {
                    separatorOutput = getColorAnsiCode(bgToFg(widget.bgColor), colorLevel, false) + separator + '\x1b[39m';
                } else if (nextWidget.bgColor) {
                    separatorOutput = getColorAnsiCode(bgToFg(nextWidget.bgColor), colorLevel, false) + separator + '\x1b[39m';
                } else {
                    separatorOutput = separator;
                }
            }

            result += separatorOutput;
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Render a powerline cap (start or end) adjacent to `adjacentBgColor`.
// ---------------------------------------------------------------------------

function renderPowerlineCap(
    cap: string,
    adjacentBgColor: string | undefined,
    colorLevel: 'ansi16' | 'ansi256' | 'truecolor'
): string {
    if (!cap)
        return '';
    if (adjacentBgColor) {
        const capFg = bgToFg(adjacentBgColor);
        return getColorAnsiCode(capFg, colorLevel, false) + cap + '\x1b[39m';
    }
    return cap;
}

// ---------------------------------------------------------------------------
// B4: Group-level hide propagation helper
// ---------------------------------------------------------------------------

/**
 * Returns true when every pre-rendered widget in the group slice has
 * `hidden === true`.  An empty slice (0 widgets) also counts as hidden —
 * nothing to render, so the group should be dropped.
 *
 * Note: separator / flex-separator entries produced by preRenderAllWidgets do
 * NOT have `hidden: true` — they have no `hidden` field at all.  Therefore a
 * separator-only group is NOT dropped by this check, which matches the strict
 * "all hidden" interpretation chosen in Task B4.  Users who want to suppress
 * a separator-only group can add a `when: [{on: '...', do: 'hide'}]` rule to
 * the separator widget.
 */
function isGroupHidden(preRenderedSlice: PreRenderedWidget[]): boolean {
    if (preRenderedSlice.length === 0)
        return true;
    return preRenderedSlice.every(pr => pr.hidden === true);
}

// ---------------------------------------------------------------------------
// Multi-group powerline rendering (B3)
// ---------------------------------------------------------------------------

/**
 * Render a multi-group line in powerline mode.
 *
 * Render sequence (spec §R1):
 *   groupStartCap₀ W₁ sep W₂ … groupEndCap₀
 *   groupGap
 *   groupStartCap₁ … groupEndCap₁
 *   groupGap
 *   …
 *
 * Called only when `settings.groupsEnabled === true` AND `line.groups.length > 1`.
 *
 * Flex (R3): flex-separator is scoped per group. Free space (terminalWidth minus
 * all fixed content) is split equally among groups that contain at least one
 * flex-separator. Groups without flex don't expand.
 *
 * merge (R4): merge chains terminate at group boundaries; the first widget of a
 * non-first group never merges with the last widget of the previous group.
 *
 * continuousColor (R2): when `group.continuousColor === false` the widgetColorIndex
 * resets to the line-start offset at that group's boundary.
 */
function renderGroupedPowerlineStatusLine(
    line: Line,
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    preRenderedWidgets: PreRenderedWidget[],
    groupedMaxWidths?: GroupedMaxWidths
): string {
    const lineIndex = context.lineIndex ?? 0;
    const globalSeparatorOffset = context.globalSeparatorIndex ?? 0;
    const globalThemeColorOffset = context.globalPowerlineThemeIndex ?? 0;

    const powerlineConfig = settings.powerline as Record<string, unknown> | undefined;
    const config = powerlineConfig ?? {};
    const continueThemeAcrossLines = Boolean(config.continueThemeAcrossLines);

    // Grouped powerline path: use the new per-group / per-line vocabulary only.
    // The legacy v3 `separators` / `startCaps` / `endCaps` fields are the source
    // of truth for the flat (groupsEnabled=false) path and are not read here —
    // the two modes are independent.
    const widgetSeparator = (config.widgetSeparator as string[] | undefined) ?? ['\uE0B0'];
    const invertBgs = (config.separatorInvertBackground as boolean[] | undefined) ?? widgetSeparator.map(() => false);
    const groupStartCaps = (config.groupStartCap as string[] | undefined) ?? [];
    const groupEndCaps = (config.groupEndCap as string[] | undefined) ?? [];
    const groupGapStr = (config.groupGap as string | undefined) ?? '  ';

    // Per-line index used to cycle through cap arrays (same semantic as v3 startCaps).
    const capLineIndex = context.lineIndex ?? lineIndex;

    // Theme colors
    const themeName = config.theme as string | undefined;
    let themeColors: { fg: string[]; bg: string[] } | undefined;
    if (themeName && themeName !== 'custom') {
        const theme = getPowerlineTheme(themeName);
        if (theme) {
            const colorLevelStr = getColorLevelString((settings.colorLevel as number) as (0 | 1 | 2 | 3));
            const key = colorLevelStr === 'ansi16' ? '1' : colorLevelStr === 'ansi256' ? '2' : '3';
            themeColors = theme[key];
        }
    }

    const colorLevel = getColorLevelString((settings.colorLevel as number) as (0 | 1 | 2 | 3));
    const detectedWidth = context.terminalWidth ?? getTerminalWidth();
    const terminalWidth = resolveEffectiveTerminalWidth(detectedWidth, settings, context);

    // Initial color index respects continueThemeAcrossLines
    const lineStartColorIndex = continueThemeAcrossLines ? globalThemeColorOffset : 0;

    // -----------------------------------------------------------------------
    // Pass 1: Build elements for every group (respecting continuousColor).
    // Also collect flex-separator counts per group (scoped within the group's
    // original widget slice, since flex-separators are filtered in
    // buildPowerlineElements but we need to count them here).
    // -----------------------------------------------------------------------

    interface GroupData {
        elements: PowerlineElement[];
        flexCount: number;         // flex-separators in this group
        groupStartCap: string;     // resolved cap for this group (cycled by line)
        groupEndCap: string;       // resolved cap for this group
        isHidden: boolean;         // B4: true when every widget in the group is hidden
        sourceGroupIndex: number; // index into line.groups (for offset recomputation in Pass 3)
    }

    let runningColorIndex = lineStartColorIndex;
    let widgetOffset = 0;
    const groupData: GroupData[] = [];
    // Tracks whether any prior group in this pass was visible, avoiding an
    // O(k) `.some()` scan of groupData for every iteration.
    let hasSeenVisibleGroup = false;

    for (let gi = 0; gi < line.groups.length; gi++) {
        const group = line.groups[gi];
        if (!group)
            continue;

        const count = group.widgets.length;
        const groupWidgets = widgets.slice(widgetOffset, widgetOffset + count);
        const groupPreRendered = preRenderedWidgets.slice(widgetOffset, widgetOffset + count);
        widgetOffset += count;

        // B4: if every widget in this group is hidden, skip element building and
        // do NOT advance the color index — the hidden group is treated as if it
        // never existed from the renderer's perspective.
        if (isGroupHidden(groupPreRendered)) {
            const gStartCap = groupStartCaps.length > 0
                ? (groupStartCaps[capLineIndex % groupStartCaps.length] ?? '')
                : '';
            const gEndCap = groupEndCaps.length > 0
                ? (groupEndCaps[capLineIndex % groupEndCaps.length] ?? '')
                : '';
            groupData.push({
                elements: [],
                flexCount: 0,
                groupStartCap: gStartCap,
                groupEndCap: gEndCap,
                isHidden: true,
                sourceGroupIndex: gi
            });
            continue;
        }

        // R2: continuousColor = false → reset widgetColorIndex to line start
        if (!group.continuousColor)
            runningColorIndex = lineStartColorIndex;

        // `isFirstGroup` controls whether the first visible element gets a
        // leading separator.  Tracked via `hasSeenVisibleGroup` to avoid
        // re-scanning groupData on each iteration.
        const isFirstVisibleGroup = !hasSeenVisibleGroup;
        hasSeenVisibleGroup = true;
        const { elements, finalColorIndex } = buildPowerlineElements(
            groupWidgets,
            groupPreRendered,
            settings,
            themeColors,
            colorLevel,
            runningColorIndex,
            isFirstVisibleGroup
        );

        runningColorIndex = finalColorIndex;

        // Count flex-separators in the original group widgets
        const flexCount = groupWidgets.filter(w => w.type === 'flex-separator').length;

        // Resolve per-group caps (cycle by line index — same semantic as v3 startCaps)
        const gStartCap = groupStartCaps.length > 0
            ? (groupStartCaps[capLineIndex % groupStartCaps.length] ?? '')
            : '';
        const gEndCap = groupEndCaps.length > 0
            ? (groupEndCaps[capLineIndex % groupEndCaps.length] ?? '')
            : '';

        groupData.push({
            elements,
            flexCount,
            groupStartCap: gStartCap,
            groupEndCap: gEndCap,
            isHidden: false,
            sourceGroupIndex: gi
        });
    }

    // -----------------------------------------------------------------------
    // Pass 1.5: Apply left-anchor widget-level alignment padding.
    // Uses the precomputed GroupedMaxWidths; no-op if not provided.
    // -----------------------------------------------------------------------
    if (groupedMaxWidths) {
        const leftCount = groupedMaxWidths.leftAnchorGroupCount[lineIndex] ?? 0;
        for (const gd of groupData) {
            if (gd.isHidden)
                continue;
            if (gd.sourceGroupIndex >= leftCount)
                continue;
            const slotMaxes = groupedMaxWidths.widgetMaxWidths[gd.sourceGroupIndex] ?? [];
            let wPos = 0;
            for (let i = 0; i < gd.elements.length; i++) {
                const el = gd.elements[i];
                if (!el)
                    continue;
                // Determine the end of this merge chain
                let j = i;
                while (j < gd.elements.length - 1 && gd.elements[j]?.widget.merge)
                    j++;
                // Current chain width
                let chainWidth = 0;
                for (let k = i; k <= j; k++) {
                    const cel = gd.elements[k];
                    if (cel)
                        chainWidth += getVisibleWidth(cel.content);
                }
                const target = slotMaxes[wPos];
                if (target !== undefined && target > chainWidth) {
                    const last = gd.elements[j];
                    if (last)
                        last.content = last.content + ' '.repeat(target - chainWidth);
                }
                i = j;
                wPos++;
            }
        }

        // Group-total padding: after widget-level, pad the group's last element
        // so the group's rendered visual width (element content + intra-group
        // widgetSeparators) matches the target.
        //
        // The target is max(groupTotalMax[g], sum(widgetMaxWidths[g]) + dominant_seps)
        // where dominant_seps = (widgetMaxWidths[g].length - 1) * widgetSeparatorWidth.
        // This covers two scenarios:
        //   1. Single-widget groups on the other line are wider (groupTotalMax wins).
        //   2. Multi-widget groups after widget-level need visual alignment (slot-sum wins).
        for (const gd of groupData) {
            if (gd.isHidden)
                continue;
            if (gd.sourceGroupIndex >= leftCount)
                continue;
            const slotMaxes = groupedMaxWidths.widgetMaxWidths[gd.sourceGroupIndex] ?? [];
            const slotMaxSum = slotMaxes.reduce((s: number, n: number) => s + n, 0);
            const dominantSeps = Math.max(0, slotMaxes.length - 1);
            const sepWidth = getVisibleWidth(widgetSeparator[0] ?? '');
            const targetFromSlots = slotMaxSum + dominantSeps * sepWidth;
            const targetFromGroupTotal = groupedMaxWidths.groupTotalMax[gd.sourceGroupIndex] ?? 0;
            const targetTotal = Math.max(targetFromSlots, targetFromGroupTotal);
            if (targetTotal === 0)
                continue;
            // currentTotal: visual width = element content widths + intra-group separators
            let currentTotal = 0;
            for (const el of gd.elements)
                currentTotal += getVisibleWidth(el.content);
            let currentSepCount = 0;
            for (let i = 0; i < gd.elements.length - 1; i++) {
                const el = gd.elements[i];
                if (el && !el.widget.merge)
                    currentSepCount++;
            }
            currentTotal += currentSepCount * sepWidth;
            if (targetTotal > currentTotal) {
                const last = gd.elements[gd.elements.length - 1];
                if (last)
                    last.content = last.content + ' '.repeat(targetTotal - currentTotal);
            }
        }

        // Right-anchor widget-level padding: prepend to the FIRST element of
        // each merge chain, walking right-to-left so rWPos=0 is rightmost.
        const rightCount = groupedMaxWidths.rightAnchorGroupCount[lineIndex] ?? 0;
        const rightZoneStart = line.groups.length - rightCount;
        for (const gd of groupData) {
            if (gd.isHidden)
                continue;
            if (gd.sourceGroupIndex < rightZoneStart)
                continue;
            const rG = line.groups.length - 1 - gd.sourceGroupIndex;
            const slotMaxes = groupedMaxWidths.rightWidgetMaxWidths[rG] ?? [];
            let rWPos = 0;
            let j = gd.elements.length - 1;
            while (j >= 0) {
                // Find chain start: walk backward while prev element has merge.
                let i = j;
                while (i > 0 && gd.elements[i - 1]?.widget.merge)
                    i--;
                let chainWidth = 0;
                for (let k = i; k <= j; k++) {
                    const cel = gd.elements[k];
                    if (cel)
                        chainWidth += getVisibleWidth(cel.content);
                }
                const target = slotMaxes[rWPos];
                if (target !== undefined && target > chainWidth) {
                    const first = gd.elements[i];
                    if (first)
                        first.content = ' '.repeat(target - chainWidth) + first.content;
                }
                rWPos++;
                j = i - 1;
            }
        }

        // Right-anchor group-total padding: prepend to FIRST element of the
        // group until visual width (content + intra-group separators) matches
        // the greater of (sum of rightWidgetMaxWidths + separators) and
        // rightGroupTotalMax.
        for (const gd of groupData) {
            if (gd.isHidden)
                continue;
            if (gd.sourceGroupIndex < rightZoneStart)
                continue;
            const rG = line.groups.length - 1 - gd.sourceGroupIndex;
            const slotMaxes = groupedMaxWidths.rightWidgetMaxWidths[rG] ?? [];
            const slotMaxSum = slotMaxes.reduce((s: number, n: number) => s + n, 0);
            const dominantSeps = Math.max(0, slotMaxes.length - 1);
            const sepWidth = getVisibleWidth(widgetSeparator[0] ?? '');
            const targetFromSlots = slotMaxSum + dominantSeps * sepWidth;
            const targetFromGroupTotal = groupedMaxWidths.rightGroupTotalMax[rG] ?? 0;
            const targetTotal = Math.max(targetFromSlots, targetFromGroupTotal);
            if (targetTotal === 0)
                continue;
            let currentTotal = 0;
            for (const el of gd.elements)
                currentTotal += getVisibleWidth(el.content);
            let currentSepCount = 0;
            for (let i = 0; i < gd.elements.length - 1; i++) {
                const el = gd.elements[i];
                if (el && !el.widget.merge)
                    currentSepCount++;
            }
            currentTotal += currentSepCount * sepWidth;
            if (targetTotal > currentTotal) {
                const first = gd.elements[0];
                if (first)
                    first.content = ' '.repeat(targetTotal - currentTotal) + first.content;
            }
        }
    }

    // B4: visible groups only — hidden groups are excluded from flex budget,
    // gap emission, and rendering.  They are treated as if never declared.

    // -----------------------------------------------------------------------
    // Pass 2: Compute natural (non-flex) widths for flex budget (R3).
    // Natural width of a group = groupStartCap + all widget content + all intra-
    // group separators (one per gap between adjacent elements, excluding merges)
    // + groupEndCap.  groupGap is counted globally.
    // -----------------------------------------------------------------------

    let flexBudget = 0;

    // B4: only visible groups participate in flex budget calculation.
    const visibleGroupData = groupData.filter(gd => !gd.isHidden);

    if (terminalWidth) {
        let fixedWidth = 0;

        // Gap between adjacent VISIBLE groups: count (visibleGroupData.length - 1) gaps.
        // Use the gap string of the second (and beyond) visible group entry from
        // line.groups, resolved by original group index.
        for (let vi = 1; vi < visibleGroupData.length; vi++) {
            const origIdx = visibleGroupData[vi]?.sourceGroupIndex ?? -1;
            const gapGroup = origIdx >= 0 ? line.groups[origIdx] : undefined;
            const actualGap = gapGroup?.gap ?? groupGapStr;
            fixedWidth += getVisibleWidth(actualGap);
        }

        for (const gd of visibleGroupData) {
            let naturalWidth = getVisibleWidth(gd.groupStartCap) + getVisibleWidth(gd.groupEndCap);
            for (let i = 0; i < gd.elements.length; i++) {
                const el = gd.elements[i];
                if (!el)
                    continue;
                naturalWidth += getVisibleWidth(el.content);
                // Add separator width between non-merged adjacent elements
                const next = gd.elements[i + 1];
                if (next && !el.widget.merge && widgetSeparator.length > 0) {
                    const sep = widgetSeparator[Math.min(i, widgetSeparator.length - 1)] ?? '';
                    naturalWidth += getVisibleWidth(sep);
                }
            }
            fixedWidth += naturalWidth;
        }

        const groupsWithFlex = visibleGroupData.filter(gd => gd.flexCount > 0).length;
        const freeSpace = Math.max(0, terminalWidth - fixedWidth);
        flexBudget = groupsWithFlex > 0 ? Math.floor(freeSpace / groupsWithFlex) : 0;
    }

    // -----------------------------------------------------------------------
    // Pass 3: Render each VISIBLE group to a string.
    // Hidden groups (isHidden:true) are completely skipped.
    // -----------------------------------------------------------------------

    // Parallel arrays: one entry per visible group.
    const renderedGroups: string[] = [];
    const renderedGroupGaps: string[] = []; // gap BEFORE each visible group ('', then actual gap)

    // Prefix sums over line.groups[*].widgets.length. groupWidgetPrefix[i] is
    // the number of widgets in groups [0, i). groupWidgetPrefix[line.groups.length]
    // is the total. Used in Pass 3 to slice the original widget array by group
    // in O(1) rather than O(N) per iteration.
    const groupWidgetPrefix: number[] = [0];
    for (let i = 0; i < line.groups.length; i++) {
        groupWidgetPrefix.push((groupWidgetPrefix[i] ?? 0) + (line.groups[i]?.widgets.length ?? 0));
    }

    let firstVisible = true;
    for (const gd of visibleGroupData) {
        const { elements, flexCount, groupStartCap, groupEndCap, sourceGroupIndex } = gd;

        // Gap before this visible group (empty for the first visible group)
        if (firstVisible) {
            renderedGroupGaps.push('');
            firstVisible = false;
        } else {
            const gapGroup = line.groups[sourceGroupIndex];
            renderedGroupGaps.push(gapGroup?.gap ?? groupGapStr);
        }

        if (elements.length === 0) {
            renderedGroups.push('');
            continue;
        }

        // Flex expansion for this group
        let flexWidth = 0;
        if (flexCount > 0 && flexBudget > 0) {
            // Distribute the group's budget equally among its flex-separators
            flexWidth = Math.floor(flexBudget / flexCount);
        }

        let groupResult = '';

        // groupStartCap
        groupResult += renderPowerlineCap(groupStartCap, elements[0]?.bgColor, colorLevel);

        // Widgets with widgetSeparators between them.
        // Also account for flex-separator positions: we need to interleave the
        // flex-separator spaces among the non-flex elements.
        // Strategy: track original widget order to find where flex-seps were,
        // then insert spaces at those positions.
        //
        // We already have `elements` (filtered, no flex/sep), and the original
        // group slice's widgets.  We walk the original widgets to reconstruct
        // the interleaving.
        //
        // Use sourceGroupIndex (into line.groups) to recompute the widget slice,
        // so that hidden groups (which were skipped in Pass 1) do not shift offsets.
        const groupWidgets = widgets.slice(
            groupWidgetPrefix[sourceGroupIndex] ?? 0,
            groupWidgetPrefix[sourceGroupIndex + 1] ?? 0
        );

        // Build a mixed rendering: walk groupWidgets, emit elements for real
        // widgets, emit spaces for flex-separators.
        let elementIdx = 0;

        // We'll build the intra-group string via a simpler approach:
        // use renderPowerlineElements for the non-flex widgets, then insert
        // flex spaces at the right positions.
        //
        // Positions of flex-separators in groupWidgets (original order):
        const flexPositions: number[] = [];
        let realWidgetCount = 0;
        for (const w of groupWidgets) {
            if (w.type === 'flex-separator') {
                // flex position falls AFTER `realWidgetCount - 1` real widgets
                // (i.e. between element[realWidgetCount-1] and element[realWidgetCount])
                flexPositions.push(realWidgetCount);
            } else if (w.type !== 'separator') {
                realWidgetCount++;
            }
        }

        if (flexPositions.length === 0 || flexWidth === 0) {
            // Simple path: no flex or width unknown — render elements normally
            groupResult += renderPowerlineElements(
                elements,
                widgetSeparator,
                invertBgs,
                globalSeparatorOffset,
                colorLevel,
                settings
            );
        } else {
            // Flex path: insert spaces at flex positions
            // Split elements by flex-separator positions
            // flexPositions[k] = number of real elements before k-th flex sep
            const parts: PowerlineElement[][] = [];
            let prev = 0;
            for (const pos of flexPositions) {
                parts.push(elements.slice(prev, pos));
                prev = pos;
            }
            parts.push(elements.slice(prev));

            for (let pi = 0; pi < parts.length; pi++) {
                const part = parts[pi];
                if (!part)
                    continue;

                if (part.length > 0) {
                    // Determine separator offset for this part
                    const partSepOffset = globalSeparatorOffset + elementIdx;
                    groupResult += renderPowerlineElements(
                        part,
                        widgetSeparator,
                        invertBgs,
                        partSepOffset,
                        colorLevel,
                        settings
                    );
                    elementIdx += part.length;
                }

                if (pi < parts.length - 1) {
                    // Emit flex space
                    groupResult += ' '.repeat(flexWidth);
                }
            }
        }

        // groupEndCap
        if (groupEndCap) {
            const lastEl = elements[elements.length - 1];
            groupResult += renderPowerlineCap(groupEndCap, lastEl?.bgColor, colorLevel);
            // Bold reset after end cap
            const lastBold = settings.globalBold || lastEl?.bold;
            if (lastBold)
                groupResult += '\x1b[22m';
        }

        renderedGroups.push(groupResult);
    }

    // -----------------------------------------------------------------------
    // Assemble final result
    // -----------------------------------------------------------------------
    let result = '';

    // Visible groups joined by their leading gaps.  A line with zero visible
    // content renders as empty string.
    for (let vi = 0; vi < renderedGroups.length; vi++) {
        const gap = renderedGroupGaps[vi] ?? '';
        const groupStr = renderedGroups[vi];
        result += gap;
        if (groupStr !== undefined)
            result += groupStr;
    }

    result += chalk.reset('');

    // Truncate if needed
    if (terminalWidth && terminalWidth > 0) {
        const plainLength = getVisibleWidth(result);
        if (plainLength > terminalWidth)
            result = truncateStyledText(result, terminalWidth, { ellipsis: true });
    }

    return result;
}

// ---------------------------------------------------------------------------
// Original flat powerline renderer (single-group / groupsEnabled:false path)
// ---------------------------------------------------------------------------

function renderPowerlineStatusLine(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    preRenderedWidgets: PreRenderedWidget[],  // Pre-rendered widgets for this line
    preCalculatedMaxWidths: number[],  // Pre-calculated max widths for alignment
    line?: Line,  // Optional line for group-aware rendering
    groupedMaxWidths?: GroupedMaxWidths
): string {
    const lineIndex = context.lineIndex ?? 0;
    const globalSeparatorOffset = context.globalSeparatorIndex ?? 0;
    const globalThemeColorOffset = context.globalPowerlineThemeIndex ?? 0;

    // When groupsEnabled and line has multiple groups, delegate to the group renderer
    if (settings.groupsEnabled && line && line.groups.length > 1) {
        return renderGroupedPowerlineStatusLine(
            line,
            widgets,
            settings,
            context,
            preRenderedWidgets,
            groupedMaxWidths
        );
    }

    const powerlineConfig = settings.powerline as Record<string, unknown> | undefined;
    const config = powerlineConfig ?? {};
    const continueThemeAcrossLines = Boolean(config.continueThemeAcrossLines);

    // Get separator configuration
    const separators = (config.separators as string[] | undefined) ?? ['\uE0B0'];
    const invertBgs = (config.separatorInvertBackground as boolean[] | undefined) ?? separators.map(() => false);

    // Get caps arrays or fallback to empty arrays
    const startCaps = (config.startCaps as string[] | undefined) ?? [];
    const endCaps = (config.endCaps as string[] | undefined) ?? [];

    // Get the cap for this line (cycle through if more lines than caps)
    const capLineIndex = context.lineIndex ?? lineIndex;
    const startCap = startCaps.length > 0 ? (startCaps[capLineIndex % startCaps.length] ?? '') : '';
    const endCap = endCaps.length > 0 ? (endCaps[capLineIndex % endCaps.length] ?? '') : '';

    // Get theme colors if a theme is set and not 'custom'
    const themeName = config.theme as string | undefined;
    let themeColors: { fg: string[]; bg: string[] } | undefined;

    if (themeName && themeName !== 'custom') {
        const theme = getPowerlineTheme(themeName);
        if (theme) {
            const colorLevel = getColorLevelString((settings.colorLevel as number) as (0 | 1 | 2 | 3));
            const colorLevelKey = colorLevel === 'ansi16' ? '1' : colorLevel === 'ansi256' ? '2' : '3';
            themeColors = theme[colorLevelKey];
        }
    }

    // Get color level from settings
    const colorLevel = getColorLevelString((settings.colorLevel as number) as (0 | 1 | 2 | 3));

    const detectedWidth = context.terminalWidth ?? getTerminalWidth();

    // Calculate terminal width based on flex mode settings
    const terminalWidth = resolveEffectiveTerminalWidth(detectedWidth, settings, context);

    // Build widget elements using the shared helper. Flat path is treated as a
    // single implicit group, so `isFirstGroup=true`.
    const initialColorIndex = continueThemeAcrossLines ? globalThemeColorOffset : 0;
    const { elements: widgetElements } = buildPowerlineElements(
        widgets,
        preRenderedWidgets,
        settings,
        themeColors,
        colorLevel,
        initialColorIndex,
        true
    );

    if (widgetElements.length === 0)
        return '';

    // Apply auto-alignment if enabled
    const autoAlign = config.autoAlign as boolean | undefined;
    if (autoAlign) {
        // Apply padding to current line's widgets based on pre-calculated max widths
        let alignmentPos = 0;
        for (let i = 0; i < widgetElements.length; i++) {
            const element = widgetElements[i];
            if (!element)
                continue;

            // Check if previous widget was merged with this one
            const prevWidget = i > 0 ? widgetElements[i - 1] : null;
            const isPreviousMerged = prevWidget?.widget.merge;

            // Only apply alignment to non-merged widgets (widgets that follow a merge are excluded)
            if (!isPreviousMerged) {
                const maxWidth = preCalculatedMaxWidths[alignmentPos];
                if (maxWidth !== undefined) {
                    // Calculate combined width if this widget merges with following ones
                    let combinedLength = getVisibleWidth(element.content);
                    let j = i;
                    while (j < widgetElements.length - 1 && widgetElements[j]?.widget.merge) {
                        j++;
                        const nextElement = widgetElements[j];
                        if (nextElement) {
                            combinedLength += getVisibleWidth(nextElement.content);
                        }
                    }

                    const paddingNeeded = maxWidth - combinedLength;
                    if (paddingNeeded > 0) {
                        // Add padding to the last widget in the merge group
                        const lastElement = widgetElements[j];
                        if (lastElement) {
                            lastElement.content += ' '.repeat(paddingNeeded);
                        }
                    }

                    // Skip over merged widgets
                    i = j;
                }
                alignmentPos++;
            }
        }
    }

    // Build the final powerline string
    let result = '';

    // Start cap (adjacent to first widget's bgColor)
    result += renderPowerlineCap(startCap, widgetElements[0]?.bgColor, colorLevel);

    // Widgets + separators
    result += renderPowerlineElements(
        widgetElements,
        separators,
        invertBgs,
        globalSeparatorOffset,
        colorLevel,
        settings
    );

    // End cap (adjacent to last widget's bgColor) + its trailing bold-reset
    if (endCap) {
        const lastWidget = widgetElements[widgetElements.length - 1];
        result += renderPowerlineCap(endCap, lastWidget?.bgColor, colorLevel);

        const lastWidgetBold = settings.globalBold || lastWidget?.bold;
        if (lastWidgetBold)
            result += '\x1b[22m';
    }

    // Reset colors at the end
    result += chalk.reset('');

    // Handle truncation if terminal width is known
    if (terminalWidth && terminalWidth > 0) {
        const plainLength = getVisibleWidth(result);
        if (plainLength > terminalWidth) {
            result = truncateStyledText(result, terminalWidth, { ellipsis: true });
        }
    }

    return result;
}

// Format separator with appropriate spacing
function formatSeparator(sep: string): string {
    if (sep === '|') {
        return ' | ';
    } else if (sep === ' ') {
        return ' ';
    } else if (sep === ',') {
        return ', ';
    } else if (sep === '-') {
        return ' - ';
    }
    return sep;
}

export interface RenderResult {
    line: string;
    wasTruncated: boolean;
}

export interface PreRenderedWidget {
    content: string;      // The rendered widget text (without padding)
    plainLength: number;  // Length without ANSI codes
    widget: WidgetItem;   // Original widget config
    colorOverride?: string;   // Foreground color override from a matching `when` rule
    bgOverride?: string;      // Background color override from a matching `when` rule
    boldOverride?: boolean;   // Bold override from a matching `when` rule
    hidden?: boolean;         // True when a `when` hide rule matched; renderer treats as absent
}

// Pre-render all widgets once and cache the results
export function preRenderAllWidgets(
    allLines: Line[],
    settings: Settings,
    context: RenderContext
): PreRenderedWidget[][] {
    const preRenderedLines: PreRenderedWidget[][] = [];

    // Process each line
    for (const line of allLines) {
        const preRenderedLine: PreRenderedWidget[] = [];

        for (const widget of lineWidgets(line)) {
            // Skip separators as they're handled differently
            if (widget.type === 'separator' || widget.type === 'flex-separator') {
                preRenderedLine.push({
                    content: '',  // Separators are handled specially
                    plainLength: 0,
                    widget
                });
                continue;
            }

            const widgetImpl = getWidget(widget.type);
            if (!widgetImpl) {
                // Unknown widget type — push a hidden placeholder to preserve 1:1 index
                // alignment between widgets and preRenderedWidgets. Consumers that slice by
                // widget index (e.g. renderGroupedPowerlineStatusLine) rely on this invariant.
                preRenderedLine.push({
                    content: '',
                    plainLength: 0,
                    widget,
                    hidden: true
                });
                continue;
            }

            // Pre-render pass: evaluate non-empty predicates first (they don't need rendered text).
            // If any `hide` rule matches here, we can skip the render call entirely.
            const preRenderEval = evaluateWhen(widget.when, widget, context, settings, '', { skipEmpty: true });
            if (preRenderEval.hide) {
                preRenderedLine.push({
                    content: '',
                    plainLength: 0,
                    widget,
                    hidden: true
                });
                continue;
            }

            const effectiveWidget = context.minimalist ? { ...widget, rawValue: true } : widget;
            const widgetText = widgetImpl.render(effectiveWidget, context, settings) ?? '';

            // Post-render pass: if any rule uses the `empty` predicate, re-evaluate with the
            // widget's rendered text so `empty` can hide / style based on actual output.
            let finalHidden = false;
            let colorOverride = preRenderEval.colorOverride;
            let bgOverride = preRenderEval.bgOverride;
            let boldOverride = preRenderEval.boldOverride;

            if (hasEmptyPredicate(widget.when)) {
                // Pass onlyEmpty so we don't re-evaluate (or re-log) non-empty rules
                // that already ran in the pre-render pass.
                const postEval = evaluateWhen(widget.when, widget, context, settings, widgetText, { onlyEmpty: true });
                if (postEval.hide)
                    finalHidden = true;
                colorOverride = postEval.colorOverride ?? colorOverride;
                bgOverride = postEval.bgOverride ?? bgOverride;
                boldOverride = postEval.boldOverride ?? boldOverride;
            }

            if (finalHidden) {
                preRenderedLine.push({
                    content: '',
                    plainLength: 0,
                    widget,
                    hidden: true
                });
                continue;
            }

            // Store the rendered content without padding (padding is applied later)
            // Use stringWidth to properly calculate Unicode character display width
            const plainLength = getVisibleWidth(widgetText);
            preRenderedLine.push({
                content: widgetText,
                plainLength,
                widget,
                colorOverride,
                bgOverride,
                boldOverride
            });
        }

        preRenderedLines.push(preRenderedLine);
    }

    return preRenderedLines;
}

// Calculate max widths from pre-rendered widgets for alignment
export function calculateMaxWidthsFromPreRendered(
    preRenderedLines: PreRenderedWidget[][],
    settings: Settings
): number[] {
    const maxWidths: number[] = [];
    const defaultPadding = settings.defaultPadding ?? '';
    const paddingLength = defaultPadding.length;

    for (const preRenderedLine of preRenderedLines) {
        const filteredWidgets = preRenderedLine.filter(
            w => w.widget.type !== 'separator' && w.widget.type !== 'flex-separator' && w.content && !w.hidden
        );

        let alignmentPos = 0;
        for (let i = 0; i < filteredWidgets.length; i++) {
            const widget = filteredWidgets[i];
            if (!widget)
                continue;

            // Calculate the total width for this alignment position
            // If this widget is merged with the next, accumulate their widths
            let totalWidth = widget.plainLength + (paddingLength * 2);

            // Check if this widget merges with the next one(s)
            let j = i;
            while (j < filteredWidgets.length - 1 && filteredWidgets[j]?.widget.merge) {
                j++;
                const nextWidget = filteredWidgets[j];
                if (nextWidget) {
                    // For merged widgets, add width but account for padding adjustments
                    // When merging with 'no-padding', don't count padding between widgets
                    if (filteredWidgets[j - 1]?.widget.merge === 'no-padding') {
                        totalWidth += nextWidget.plainLength;
                    } else {
                        totalWidth += nextWidget.plainLength + (paddingLength * 2);
                    }
                }
            }

            const currentMax = maxWidths[alignmentPos];
            if (currentMax === undefined) {
                maxWidths[alignmentPos] = totalWidth;
            } else {
                maxWidths[alignmentPos] = Math.max(currentMax, totalWidth);
            }

            // Skip over merged widgets since we've already processed them
            i = j;
            alignmentPos++;
        }
    }

    return maxWidths;
}

export function renderStatusLineWithInfo(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    preRenderedWidgets: PreRenderedWidget[],
    preCalculatedMaxWidths: number[],
    line?: Line,
    groupedMaxWidths?: GroupedMaxWidths
): RenderResult {
    const renderedLine = renderStatusLine(widgets, settings, context, preRenderedWidgets, preCalculatedMaxWidths, line, groupedMaxWidths);
    // Check if line contains the truncation ellipsis
    const wasTruncated = renderedLine.includes('...');
    return { line: renderedLine, wasTruncated };
}

export function renderStatusLine(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    preRenderedWidgets: PreRenderedWidget[],
    preCalculatedMaxWidths: number[],
    line?: Line,
    groupedMaxWidths?: GroupedMaxWidths
): string {
    // Check powerline mode before dispatching to group renderers so the right
    // multi-group path is used.
    const powerlineSettings = settings.powerline as Record<string, unknown> | undefined;
    const isPowerlineMode = Boolean(powerlineSettings?.enabled);

    // Groups are a powerline-only feature. In plain mode, multi-group lines are
    // auto-flattened: `widgets` is already the flat concatenation produced by
    // `lineWidgets(line)` at the call site, so we simply drop `line` and fall
    // through to the flat path below. This guarantees plain-mode output is
    // byte-identical to a pre-groups flat render.
    if (!isPowerlineMode && line && line.groups.length > 1) {
        line = undefined;
    }

    // In powerline mode, renderPowerlineStatusLine handles the multi-group
    // dispatch internally (renderGroupedPowerlineStatusLine).
    if (settings.groupsEnabled && line && line.groups.length > 1 && isPowerlineMode) {
        return renderPowerlineStatusLine(
            widgets,
            settings,
            context,
            preRenderedWidgets,
            preCalculatedMaxWidths,
            line,
            groupedMaxWidths
        );
    }

    // Force 24-bit color for non-preview statusline rendering
    // Chalk level is now set globally in ccstatusline.ts and tui.tsx
    // No need to override here

    // Get color level from settings
    const colorLevel = getColorLevelString((settings.colorLevel as number) as (0 | 1 | 2 | 3));

    // If powerline mode is enabled, use powerline renderer
    if (isPowerlineMode)
        return renderPowerlineStatusLine(
            widgets,
            settings,
            context,
            preRenderedWidgets,
            preCalculatedMaxWidths,
            line,
            groupedMaxWidths
        );

    // Helper to apply colors with optional background and bold override
    const applyColorsWithOverride = (text: string, foregroundColor?: string, backgroundColor?: string, bold?: boolean): string => {
        // Override foreground color takes precedence over EVERYTHING, including passed foreground color
        let fgColor = foregroundColor;
        if (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none') {
            fgColor = settings.overrideForegroundColor;
        }

        // Override background color takes precedence over EVERYTHING, including passed background color
        let bgColor = backgroundColor;
        if (settings.overrideBackgroundColor && settings.overrideBackgroundColor !== 'none') {
            bgColor = settings.overrideBackgroundColor;
        }

        const shouldBold = (settings.globalBold) || bold;
        return applyColors(text, fgColor, bgColor, shouldBold, colorLevel);
    };

    const detectedWidth = context.terminalWidth ?? getTerminalWidth();

    // Calculate terminal width based on flex mode settings
    const terminalWidth = resolveEffectiveTerminalWidth(detectedWidth, settings, context);

    const elements: { content: string; type: string; widget?: WidgetItem }[] = [];
    let hasFlexSeparator = false;

    // Build elements based on configured widgets
    for (let i = 0; i < widgets.length; i++) {
        const widget = widgets[i];
        if (!widget)
            continue;

        // Handle separators specially (they're not widgets)
        if (widget.type === 'separator') {
            // Check if there's any widget before this separator that actually rendered content
            // Look backwards to find ANY widget that produced content
            let hasContentBefore = false;
            for (let j = i - 1; j >= 0; j--) {
                const prevWidget = widgets[j];
                if (prevWidget && prevWidget.type !== 'separator' && prevWidget.type !== 'flex-separator') {
                    const prevPreRendered = preRenderedWidgets[j];
                    if (prevPreRendered?.content && !prevPreRendered.hidden) {
                        hasContentBefore = true;
                        break;
                    }
                    // Continue looking backwards even if this widget didn't render content
                }
            }
            if (!hasContentBefore)
                continue;

            const sepChar = widget.character ?? (settings.defaultSeparator ?? '|');
            const formattedSep = formatSeparator(sepChar);

            // Check if we should inherit colors from the previous widget
            let separatorColor = widget.color ?? 'gray';
            let separatorBg = widget.backgroundColor;
            let separatorBold = widget.bold;

            if (settings.inheritSeparatorColors && i > 0 && !widget.color && !widget.backgroundColor) {
                // Only inherit if the separator doesn't have explicit colors set.
                // NOTE: `when`-rule overrides are intentionally not threaded here — the
                // separator inherits the widget's static color, not any when-override.
                // See docs/when-triggers/plan.md Task 5 non-goals.
                const prevWidget = widgets[i - 1];
                if (prevWidget && prevWidget.type !== 'separator' && prevWidget.type !== 'flex-separator') {
                    // Get the previous widget's colors
                    let widgetColor = prevWidget.color;
                    if (!widgetColor) {
                        const widgetImpl = getWidget(prevWidget.type);
                        widgetColor = widgetImpl ? widgetImpl.getDefaultColor() : 'white';
                    }
                    separatorColor = widgetColor;
                    separatorBg = prevWidget.backgroundColor;
                    separatorBold = prevWidget.bold;
                }
            }

            elements.push({ content: applyColorsWithOverride(formattedSep, separatorColor, separatorBg, separatorBold), type: 'separator', widget });
            continue;
        }

        if (widget.type === 'flex-separator') {
            elements.push({ content: 'FLEX', type: 'flex-separator', widget });
            hasFlexSeparator = true;
            continue;
        }

        // Use widget registry for regular widgets
        try {
            let widgetText: string | undefined;
            let defaultColor = 'white';

            // Use pre-rendered content. Widgets flagged as `hidden` by a `when`
            // rule are treated as absent — no content, no separator, no color.
            const preRendered = preRenderedWidgets[i];
            if (preRendered?.content && !preRendered.hidden) {
                widgetText = preRendered.content;
                // Get default color from widget impl for consistency
                const widgetImpl = getWidget(widget.type);
                if (widgetImpl) {
                    defaultColor = widgetImpl.getDefaultColor();
                }
            }

            if (widgetText) {
                // Special handling for custom-command with preserveColors.
                // NOTE: `when`-rule color/bg/bold overrides intentionally do not apply on
                // this branch — preserveColors is a narrow special case that keeps raw
                // command ANSI codes. See docs/when-triggers/plan.md Task 5 non-goals.
                if (widget.type === 'custom-command' && widget.preserveColors) {
                    // Handle max width truncation for commands with ANSI codes
                    let finalOutput = widgetText;
                    if (widget.maxWidth && widget.maxWidth > 0) {
                        const plainLength = getVisibleWidth(widgetText);
                        if (plainLength > widget.maxWidth) {
                            finalOutput = truncateStyledText(widgetText, widget.maxWidth, { ellipsis: false });
                        }
                    }
                    // Preserve original colors from command output
                    elements.push({ content: finalOutput, type: widget.type, widget });
                } else {
                    // Normal widget rendering with colors.
                    // `when` rule overrides take precedence over the widget's static
                    // color/backgroundColor/bold; fall back to the static values when
                    // no override matched.
                    const effectiveColor = preRendered?.colorOverride ?? widget.color ?? defaultColor;
                    const effectiveBg = preRendered?.bgOverride ?? widget.backgroundColor;
                    const effectiveBold = preRendered?.boldOverride ?? widget.bold;
                    elements.push({
                        content: applyColorsWithOverride(widgetText, effectiveColor, effectiveBg, effectiveBold),
                        type: widget.type,
                        widget
                    });
                }
            }
        } catch {
            // Unknown widget type - skip
            continue;
        }
    }

    if (elements.length === 0)
        return '';

    // Remove trailing separators
    while (elements.length > 0 && elements[elements.length - 1]?.type === 'separator') {
        elements.pop();
    }

    // Apply default padding and separators
    const finalElements: string[] = [];
    const padding = settings.defaultPadding ?? '';
    const defaultSep = settings.defaultSeparator ? formatSeparator(settings.defaultSeparator) : '';

    elements.forEach((elem, index) => {
        // Add default separator between any two items (but not before first item, and not around flex separators)
        const prevElem = index > 0 ? elements[index - 1] : null;
        const shouldAddSeparator = defaultSep && index > 0
            && elem.type !== 'flex-separator'
            && prevElem?.type !== 'flex-separator'
            && !prevElem?.widget?.merge; // Don't add separator if previous widget is merged with this one

        if (shouldAddSeparator) {
            // Check if we should inherit colors from the previous element
            if (settings.inheritSeparatorColors && index > 0) {
                // NOTE: `when`-rule overrides are intentionally not threaded here — the
                // separator inherits the widget's static color, not any when-override.
                // See docs/when-triggers/plan.md Task 5 non-goals.
                const prevElem = elements[index - 1];
                if (prevElem?.widget) {
                    // Apply the previous element's colors to the separator (already handles override)
                    // Use the widget's color if set, otherwise get the default color for that widget type
                    let widgetColor = prevElem.widget.color;
                    if (!widgetColor && prevElem.widget.type !== 'separator' && prevElem.widget.type !== 'flex-separator') {
                        const widgetImpl = getWidget(prevElem.widget.type);
                        widgetColor = widgetImpl ? widgetImpl.getDefaultColor() : 'white';
                    }
                    const coloredSep = applyColorsWithOverride(defaultSep, widgetColor, prevElem.widget.backgroundColor, prevElem.widget.bold);
                    finalElements.push(coloredSep);
                } else {
                    finalElements.push(defaultSep);
                }
            } else if ((settings.overrideBackgroundColor && settings.overrideBackgroundColor !== 'none')
                || (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none')) {
                // Apply override colors even when not inheriting colors
                const coloredSep = applyColorsWithOverride(defaultSep, undefined, undefined);
                finalElements.push(coloredSep);
            } else {
                finalElements.push(defaultSep);
            }
        }

        // Add element with padding (separators don't get padding)
        if (elem.type === 'separator' || elem.type === 'flex-separator') {
            finalElements.push(elem.content);
        } else {
            // Check if padding should be omitted due to no-padding merge
            const nextElem = index < elements.length - 1 ? elements[index + 1] : null;
            const omitLeadingPadding = prevElem?.widget?.merge === 'no-padding';
            const omitTrailingPadding = elem.widget?.merge === 'no-padding' && nextElem;

            // Apply padding with colors (using overrides if set)
            const hasColorOverride = Boolean(settings.overrideBackgroundColor && settings.overrideBackgroundColor !== 'none')
                || Boolean(settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none');

            if (padding && (elem.widget?.backgroundColor || hasColorOverride)) {
                // Apply colors to padding - applyColorsWithOverride will handle the overrides
                const leadingPadding = omitLeadingPadding ? '' : applyColorsWithOverride(padding, undefined, elem.widget?.backgroundColor);
                const trailingPadding = omitTrailingPadding ? '' : applyColorsWithOverride(padding, undefined, elem.widget?.backgroundColor);
                const paddedContent = leadingPadding + elem.content + trailingPadding;
                finalElements.push(paddedContent);
            } else if (padding) {
                // Wrap padding in ANSI reset codes to prevent trimming
                // This ensures leading spaces aren't trimmed by terminals
                const protectedPadding = chalk.reset(padding);
                const leadingPadding = omitLeadingPadding ? '' : protectedPadding;
                const trailingPadding = omitTrailingPadding ? '' : protectedPadding;
                finalElements.push(leadingPadding + elem.content + trailingPadding);
            } else {
                // No padding
                finalElements.push(elem.content);
            }
        }
    });

    // Build the final status line
    let statusLine: string;

    if (hasFlexSeparator && terminalWidth) {
        // Split elements by flex separators
        const parts: string[][] = [[]];
        let currentPart = 0;

        for (const elem of finalElements) {
            if (elem === 'FLEX') {
                currentPart++;
                parts[currentPart] = [];
            } else {
                parts[currentPart]?.push(elem);
            }
        }

        // Calculate total length of all non-flex content
        const partLengths = parts.map((part) => {
            const joined = part.join('');
            return getVisibleWidth(joined);
        });
        const totalContentLength = partLengths.reduce((sum, len) => sum + len, 0);

        // Calculate space to distribute among flex separators
        const flexCount = parts.length - 1; // Number of flex separators
        const totalSpace = Math.max(0, terminalWidth - totalContentLength);
        const spacePerFlex = flexCount > 0 ? Math.floor(totalSpace / flexCount) : 0;
        const extraSpace = flexCount > 0 ? totalSpace % flexCount : 0;

        // Build the status line with distributed spacing
        statusLine = '';
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part) {
                statusLine += part.join('');
            }
            if (i < parts.length - 1) {
                // Add flex spacing
                const spaces = spacePerFlex + (i < extraSpace ? 1 : 0);
                statusLine += ' '.repeat(spaces);
            }
        }
    } else {
        // No flex separator OR no width detected
        if (hasFlexSeparator && !terminalWidth) {
            // Treat flex separators as normal separators when width detection fails
            statusLine = finalElements.map(e => e === 'FLEX' ? chalk.gray(' | ') : e).join('');
        } else {
            // Just join all elements normally
            statusLine = finalElements.join('');
        }
    }

    // Truncate if the line exceeds the terminal width
    // Use terminalWidth if available (already accounts for flex mode adjustments), otherwise use detectedWidth
    const maxWidth = terminalWidth ?? detectedWidth;
    if (maxWidth && maxWidth > 0) {
        // Remove ANSI escape codes to get actual length
        const plainLength = getVisibleWidth(statusLine);

        if (plainLength > maxWidth) {
            statusLine = truncateStyledText(statusLine, maxWidth, { ellipsis: true });
        }
    }

    return statusLine;
}