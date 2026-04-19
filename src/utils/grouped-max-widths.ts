import type { Line } from '../types/Group';
import type { Settings } from '../types/Settings';

import type { PreRenderedWidget } from './renderer';

/**
 * Nested alignment tables computed once across all lines, consumed by the
 * grouped powerline renderer when `autoAlign && groupsEnabled` is on.
 *
 * Left-anchor zone (indexed by original groupIndex, visible widget position):
 *   widgetMaxWidths[g][wPos]  — max element width (content incl. padding,
 *                               merge chains summed into one slot) at coord
 *   groupTotalMax[g]          — max total inner width of group g
 *
 * Right-anchor zone (indexed from the RIGHT, rG=0 is the rightmost group):
 *   rightWidgetMaxWidths[rG][rWPos] — same semantic, reverse indexing
 *   rightGroupTotalMax[rG]          — same, reverse indexing
 *
 * Per-line zone boundaries:
 *   leftAnchorGroupCount[l]   — number of groups in the left-anchor zone
 *   rightAnchorGroupCount[l]  — number of groups in the right-anchor zone
 * Groups in [leftAnchorGroupCount, groups.length - rightAnchorGroupCount) are
 * excluded from alignment (they span the flex region).
 */
export interface GroupedMaxWidths {
    widgetMaxWidths: number[][];
    groupTotalMax: number[];
    rightWidgetMaxWidths: number[][];
    rightGroupTotalMax: number[];
    leftAnchorGroupCount: number[];
    rightAnchorGroupCount: number[];
}

/**
 * Given the visible, non-hidden, non-separator pre-rendered widgets of a single
 * group on a single line, return one slot width per alignment position
 * (merge chains collapse into a single slot). `paddingLength` comes from
 * `settings.defaultPadding.length`.
 */
function slotWidthsForGroup(
    groupPreRendered: PreRenderedWidget[],
    paddingLength: number
): number[] {
    const visible = groupPreRendered.filter(
        w => w.widget.type !== 'separator'
            && w.widget.type !== 'flex-separator'
            && w.content
            && !w.hidden
    );
    const slots: number[] = [];
    for (let i = 0; i < visible.length; i++) {
        const w = visible[i];
        if (!w)
            continue;
        let slot = w.plainLength + paddingLength * 2;
        let j = i;
        while (j < visible.length - 1 && visible[j]?.widget.merge) {
            j++;
            const next = visible[j];
            if (!next)
                continue;
            if (visible[j - 1]?.widget.merge === 'no-padding')
                slot += next.plainLength;
            else
                slot += next.plainLength + paddingLength * 2;
        }
        slots.push(slot);
        i = j; // skip the merged chain
    }
    return slots;
}

export function calculateGroupedMaxWidths(
    lines: Line[],
    preRenderedLines: PreRenderedWidget[][],
    settings: Settings
): GroupedMaxWidths {
    const paddingLength = (settings.defaultPadding ?? '').length;
    const leftAnchorGroupCount: number[] = [];
    const rightAnchorGroupCount: number[] = [];
    const widgetMaxWidths: number[][] = [];
    const groupTotalMax: number[] = [];
    const rightWidgetMaxWidths: number[][] = [];
    const rightGroupTotalMax: number[] = [];

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (!line)
            continue;

        // Anchor zones
        const flexGroupIndices: number[] = [];
        for (let gi = 0; gi < line.groups.length; gi++) {
            const g = line.groups[gi];
            if (!g)
                continue;
            if (g.widgets.some(w => w.type === 'flex-separator'))
                flexGroupIndices.push(gi);
        }
        let leftCount: number;
        let rightCount: number;
        if (flexGroupIndices.length === 0) {
            leftCount = line.groups.length;
            rightCount = 0;
        } else {
            const flexStart = flexGroupIndices[0] ?? 0;
            const flexEnd = flexGroupIndices[flexGroupIndices.length - 1] ?? 0;
            leftCount = flexStart;
            rightCount = line.groups.length - flexEnd - 1;
        }
        leftAnchorGroupCount.push(leftCount);
        rightAnchorGroupCount.push(rightCount);

        // Left-anchor widget-level max
        const preRenderedLine = preRenderedLines[li] ?? [];
        let widgetOffset = 0;
        for (let gi = 0; gi < line.groups.length; gi++) {
            const group = line.groups[gi];
            if (!group)
                continue;
            const count = group.widgets.length;
            const slice = preRenderedLine.slice(widgetOffset, widgetOffset + count);
            widgetOffset += count;

            if (gi >= leftCount)
                continue; // skip flex + right zones here

            const slots = slotWidthsForGroup(slice, paddingLength);
            const rowForGroup = widgetMaxWidths[gi] ?? [];
            for (let wp = 0; wp < slots.length; wp++) {
                const slotWidth = slots[wp] ?? 0;
                const prev = rowForGroup[wp];
                rowForGroup[wp] = prev === undefined ? slotWidth : Math.max(prev, slotWidth);
            }
            widgetMaxWidths[gi] = rowForGroup;

            const total = slots.reduce((s, n) => s + n, 0);
            const prevTotal = groupTotalMax[gi];
            groupTotalMax[gi] = prevTotal === undefined ? total : Math.max(prevTotal, total);
        }

        // Right-anchor: only groups at source index > flexEnd (i.e. within the
        // last `rightCount` groups). rG = 0 is the rightmost.
        const rightZoneStart = line.groups.length - rightCount;
        let rightPassOffset = 0;
        for (let gi = 0; gi < line.groups.length; gi++) {
            const group = line.groups[gi];
            if (!group)
                continue;
            const count = group.widgets.length;
            const slice = preRenderedLine.slice(rightPassOffset, rightPassOffset + count);
            rightPassOffset += count;
            if (gi < rightZoneStart)
                continue;

            const rG = line.groups.length - 1 - gi;
            const slots = slotWidthsForGroup(slice, paddingLength);
            // Right-anchor reverses slot order so rWPos=0 is rightmost
            const reversed = slots.slice().reverse();
            const row = rightWidgetMaxWidths[rG] ?? [];
            for (let rp = 0; rp < reversed.length; rp++) {
                const w = reversed[rp] ?? 0;
                const prev = row[rp];
                row[rp] = prev === undefined ? w : Math.max(prev, w);
            }
            rightWidgetMaxWidths[rG] = row;

            const total = slots.reduce((s, n) => s + n, 0);
            const prevTotal = rightGroupTotalMax[rG];
            rightGroupTotalMax[rG] = prevTotal === undefined ? total : Math.max(prevTotal, total);
        }
    }

    return {
        widgetMaxWidths,
        groupTotalMax,
        rightWidgetMaxWidths,
        rightGroupTotalMax,
        leftAnchorGroupCount,
        rightAnchorGroupCount
    };
}