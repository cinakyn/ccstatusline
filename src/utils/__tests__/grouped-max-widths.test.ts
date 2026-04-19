import {
    describe,
    expect,
    it
} from 'vitest';

import type { Line } from '../../types/Group';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { calculateGroupedMaxWidths } from '../grouped-max-widths';

function mkLine(groups: WidgetItem[][]): Line {
    return { groups: groups.map(widgets => ({ continuousColor: true, widgets })) };
}

const TEXT = (id: string, customText: string): WidgetItem => ({ id, type: 'custom-text', customText });
const FLEX = (id: string): WidgetItem => ({ id, type: 'flex-separator' });

describe('calculateGroupedMaxWidths', () => {
    it('returns empty arrays for empty input', () => {
        const lines: Line[] = [];
        const preRendered: never[][] = [];
        const result = calculateGroupedMaxWidths(lines, preRendered, DEFAULT_SETTINGS);
        expect(result).toEqual({
            widgetMaxWidths: [],
            groupTotalMax: [],
            rightWidgetMaxWidths: [],
            rightGroupTotalMax: [],
            leftAnchorGroupCount: [],
            rightAnchorGroupCount: []
        });
    });
});

describe('calculateGroupedMaxWidths anchor zones', () => {
    it('line with no flex → all groups are left-anchor', () => {
        const line = mkLine([[TEXT('a', 'A')], [TEXT('b', 'B')], [TEXT('c', 'C')]]);
        const preRendered = [[
            { content: 'A', plainLength: 1, widget: TEXT('a', 'A') },
            { content: 'B', plainLength: 1, widget: TEXT('b', 'B') },
            { content: 'C', plainLength: 1, widget: TEXT('c', 'C') }
        ]];
        const result = calculateGroupedMaxWidths([line], preRendered, DEFAULT_SETTINGS);
        expect(result.leftAnchorGroupCount).toEqual([3]);
        expect(result.rightAnchorGroupCount).toEqual([0]);
    });

    it('line with single flex in group 1 → group 0 left, groups 2+ right, group 1 excluded', () => {
        const line = mkLine([
            [TEXT('a', 'A')],
            [FLEX('f')],
            [TEXT('b', 'B')],
            [TEXT('c', 'C')]
        ]);
        const preRendered = [[
            { content: 'A', plainLength: 1, widget: TEXT('a', 'A') },
            { content: '', plainLength: 0, widget: FLEX('f') },
            { content: 'B', plainLength: 1, widget: TEXT('b', 'B') },
            { content: 'C', plainLength: 1, widget: TEXT('c', 'C') }
        ]];
        const result = calculateGroupedMaxWidths([line], preRendered, DEFAULT_SETTINGS);
        expect(result.leftAnchorGroupCount).toEqual([1]);
        expect(result.rightAnchorGroupCount).toEqual([2]);
    });

    it('line with multiple flex groups → all groups in [flexStart, flexEnd] excluded', () => {
        const line = mkLine([
            [TEXT('a', 'A')],
            [FLEX('f1')],
            [TEXT('m', 'M')],
            [FLEX('f2')],
            [TEXT('z', 'Z')]
        ]);
        const preRendered = [[
            { content: 'A', plainLength: 1, widget: TEXT('a', 'A') },
            { content: '', plainLength: 0, widget: FLEX('f1') },
            { content: 'M', plainLength: 1, widget: TEXT('m', 'M') },
            { content: '', plainLength: 0, widget: FLEX('f2') },
            { content: 'Z', plainLength: 1, widget: TEXT('z', 'Z') }
        ]];
        const result = calculateGroupedMaxWidths([line], preRendered, DEFAULT_SETTINGS);
        expect(result.leftAnchorGroupCount).toEqual([1]);
        expect(result.rightAnchorGroupCount).toEqual([1]);
    });
});

describe('calculateGroupedMaxWidths widget-level left-anchor', () => {
    it('uniform shape across lines — max equals widest value per slot', () => {
        const wa1 = TEXT('a1', 'AA');
        const wb1 = TEXT('b1', 'BBB');
        const wa2 = TEXT('a2', 'AAAA');
        const wb2 = TEXT('b2', 'B');
        const line1 = mkLine([[wa1, wb1]]);
        const line2 = mkLine([[wa2, wb2]]);
        const pre = [
            [
                { content: 'AA',   plainLength: 2, widget: wa1 },
                { content: 'BBB',  plainLength: 3, widget: wb1 }
            ],
            [
                { content: 'AAAA', plainLength: 4, widget: wa2 },
                { content: 'B',    plainLength: 1, widget: wb2 }
            ]
        ];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: ' ' }; // paddingLength = 1
        const result = calculateGroupedMaxWidths([line1, line2], pre, settings);
        // Slot width = plainLength + 2*1 = plainLength + 2
        // widgetMaxWidths[0][0] = max(2+2, 4+2) = 6
        // widgetMaxWidths[0][1] = max(3+2, 1+2) = 5
        expect(result.widgetMaxWidths).toEqual([[6, 5]]);
    });

    it('hidden widget filtered from alignment position indexing', () => {
        const wa1 = TEXT('a', 'A');
        const wb1 = TEXT('b', 'HIDDEN');
        const wc1 = TEXT('c', 'CCC');
        const wa2 = TEXT('a', 'AA');
        const wb2 = TEXT('b', 'BB');
        const wc2 = TEXT('c', 'C');
        const line1 = mkLine([[wa1, wb1, wc1]]);
        const line2 = mkLine([[wa2, wb2, wc2]]);
        const pre = [
            [
                { content: 'A',   plainLength: 1, widget: wa1 },
                { content: '',    plainLength: 0, widget: wb1, hidden: true },
                { content: 'CCC', plainLength: 3, widget: wc1 }
            ],
            [
                { content: 'AA',  plainLength: 2, widget: wa2 },
                { content: 'BB',  plainLength: 2, widget: wb2 },
                { content: 'C',   plainLength: 1, widget: wc2 }
            ]
        ];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: '' }; // paddingLength = 0
        const result = calculateGroupedMaxWidths([line1, line2], pre, settings);
        // Line1 slots after filter: [1 (A), 3 (CCC)] — CCC is at visible wPos=1
        // Line2 slots: [2 (AA), 2 (BB), 1 (C)]
        // wPos=0 max = max(1, 2) = 2
        // wPos=1 max = max(3, 2) = 3
        // wPos=2 max = max(-, 1) = 1
        expect(result.widgetMaxWidths).toEqual([[2, 3, 1]]);
    });

    it('merge chain sums to a single slot', () => {
        const mergedLeft: WidgetItem = { id: 'l', type: 'custom-text', customText: 'ab', merge: true };
        const chainedRight: WidgetItem = { id: 'r', type: 'custom-text', customText: 'cd' };
        const line = mkLine([[mergedLeft, chainedRight]]);
        const pre = [[
            { content: 'ab', plainLength: 2, widget: mergedLeft },
            { content: 'cd', plainLength: 2, widget: chainedRight }
        ]];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: ' ' }; // paddingLength = 1
        const result = calculateGroupedMaxWidths([line], pre, settings);
        // Regular merge: slot = (2+2) + (2+2) = 8
        expect(result.widgetMaxWidths).toEqual([[8]]);
    });

    it('no-padding merge omits the inner padding pair', () => {
        const mergedLeft: WidgetItem = { id: 'l', type: 'custom-text', customText: 'ab', merge: 'no-padding' };
        const chainedRight: WidgetItem = { id: 'r', type: 'custom-text', customText: 'cd' };
        const line = mkLine([[mergedLeft, chainedRight]]);
        const pre = [[
            { content: 'ab', plainLength: 2, widget: mergedLeft },
            { content: 'cd', plainLength: 2, widget: chainedRight }
        ]];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: ' ' };
        const result = calculateGroupedMaxWidths([line], pre, settings);
        // no-padding merge: (2+2) + 2 = 6
        expect(result.widgetMaxWidths).toEqual([[6]]);
    });
});

describe('calculateGroupedMaxWidths group-total left-anchor', () => {
    it('takes the maximum summed inner width per group across lines', () => {
        // Line 1 group 0 = AAA + BB       → widths 3+2 = 5 (no padding)
        // Line 2 group 0 = A   + BBBB     → widths 1+4 = 5
        // Line 1 group 1 = CC              → 2
        // Line 2 group 1 = CCCCC           → 5
        const wa1 = TEXT('a', 'AAA');
        const wb1 = TEXT('b', 'BB');
        const wc1 = TEXT('c', 'CC');
        const wa2 = TEXT('a', 'A');
        const wb2 = TEXT('b', 'BBBB');
        const wc2 = TEXT('c', 'CCCCC');
        const l1 = mkLine([[wa1, wb1], [wc1]]);
        const l2 = mkLine([[wa2, wb2], [wc2]]);
        const pre = [
            [
                { content: 'AAA',  plainLength: 3, widget: wa1 },
                { content: 'BB',   plainLength: 2, widget: wb1 },
                { content: 'CC',   plainLength: 2, widget: wc1 }
            ],
            [
                { content: 'A',    plainLength: 1, widget: wa2 },
                { content: 'BBBB', plainLength: 4, widget: wb2 },
                { content: 'CCCCC', plainLength: 5, widget: wc2 }
            ]
        ];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: '' }; // paddingLength=0
        const result = calculateGroupedMaxWidths([l1, l2], pre, settings);
        expect(result.groupTotalMax).toEqual([5, 5]);
    });

    it('line with fewer groups does not contribute to absent indices', () => {
        const wa1 = TEXT('a', 'A');
        const wb1 = TEXT('b', 'BBBB');
        const wa2 = TEXT('a', 'AAA');
        const l1 = mkLine([[wa1], [wb1]]);
        const l2 = mkLine([[wa2]]);
        const pre = [
            [
                { content: 'A',    plainLength: 1, widget: wa1 },
                { content: 'BBBB', plainLength: 4, widget: wb1 }
            ],
            [
                { content: 'AAA',  plainLength: 3, widget: wa2 }
            ]
        ];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: '' };
        const result = calculateGroupedMaxWidths([l1, l2], pre, settings);
        expect(result.groupTotalMax).toEqual([3, 4]);
    });
});

describe('calculateGroupedMaxWidths edge cases', () => {
    it('entirely-hidden group contributes nothing at that group index', () => {
        const wa1 = TEXT('a', 'AAA');
        const wb1 = TEXT('b', 'HIDDEN');
        const wa2 = TEXT('a', 'A');
        const wb2 = TEXT('b', 'BB');
        const l1 = mkLine([[wa1], [wb1]]);
        const l2 = mkLine([[wa2], [wb2]]);
        const pre = [
            [
                { content: 'AAA', plainLength: 3, widget: wa1 },
                { content: '',    plainLength: 0, widget: wb1, hidden: true }
            ],
            [
                { content: 'A',   plainLength: 1, widget: wa2 },
                { content: 'BB',  plainLength: 2, widget: wb2 }
            ]
        ];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: '' };
        const result = calculateGroupedMaxWidths([l1, l2], pre, settings);
        // Group 1 max comes only from line 2 because line 1 has nothing visible there
        expect(result.widgetMaxWidths).toEqual([[3], [2]]);
        expect(result.groupTotalMax).toEqual([3, 2]);
    });

    it('per-line group count differs — longer lines extend trailing indices', () => {
        const wa1 = TEXT('a', 'A');
        const wa2 = TEXT('a', 'AA');
        const wb2 = TEXT('b', 'BBB');
        const l1 = mkLine([[wa1]]);
        const l2 = mkLine([[wa2], [wb2]]);
        const pre = [
            [{ content: 'A',   plainLength: 1, widget: wa1 }],
            [
                { content: 'AA',  plainLength: 2, widget: wa2 },
                { content: 'BBB', plainLength: 3, widget: wb2 }
            ]
        ];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: '' };
        const result = calculateGroupedMaxWidths([l1, l2], pre, settings);
        expect(result.widgetMaxWidths).toEqual([[2], [3]]);
        expect(result.groupTotalMax).toEqual([2, 3]);
        expect(result.leftAnchorGroupCount).toEqual([1, 2]);
    });

    it('single group per line degenerates to flat behaviour', () => {
        const wa1 = TEXT('a', 'A');
        const wb1 = TEXT('b', 'BBBB');
        const wc1 = TEXT('c', 'C');
        const wa2 = TEXT('a', 'AAAA');
        const wb2 = TEXT('b', 'B');
        const wc2 = TEXT('c', 'CCC');
        const l1 = mkLine([[wa1, wb1, wc1]]);
        const l2 = mkLine([[wa2, wb2, wc2]]);
        const pre = [
            [
                { content: 'A',    plainLength: 1, widget: wa1 },
                { content: 'BBBB', plainLength: 4, widget: wb1 },
                { content: 'C',    plainLength: 1, widget: wc1 }
            ],
            [
                { content: 'AAAA', plainLength: 4, widget: wa2 },
                { content: 'B',    plainLength: 1, widget: wb2 },
                { content: 'CCC',  plainLength: 3, widget: wc2 }
            ]
        ];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: '' };
        const result = calculateGroupedMaxWidths([l1, l2], pre, settings);
        // Every slot aligns to widest — exactly what flat autoAlign does.
        expect(result.widgetMaxWidths).toEqual([[4, 4, 3]]);
    });
});

describe('calculateGroupedMaxWidths right-anchor', () => {
    it('indexes right groups from the right; slots indexed from the right', () => {
        // Two lines, 3 groups each: [left] [flex] [right-a, right-b]
        // Line 1 right-a = XX  (2),  right-b = Y    (1)
        // Line 2 right-a = X   (1),  right-b = YYYY (4)
        // rG=0 (rightmost source group): slots rWPos=0 = max(1, 4) = 4
        // rG=0 groupTotal = max(1+2, 1+4) = 5
        // There is no rG=1 in this example (right zone count = 1).
        const l1a  = TEXT('a', 'A');
        const l1f  = FLEX('f');
        const l1ra = TEXT('ra', 'XX');
        const l1rb = TEXT('rb', 'Y');
        const l2a  = TEXT('a', 'AAAA');
        const l2f  = FLEX('f');
        const l2ra = TEXT('ra', 'X');
        const l2rb = TEXT('rb', 'YYYY');
        const l1 = mkLine([[l1a], [l1f], [l1ra, l1rb]]);
        const l2 = mkLine([[l2a], [l2f], [l2ra, l2rb]]);
        const pre = [
            [
                { content: 'A',    plainLength: 1, widget: l1a  },
                { content: '',     plainLength: 0, widget: l1f  },
                { content: 'XX',   plainLength: 2, widget: l1ra },
                { content: 'Y',    plainLength: 1, widget: l1rb }
            ],
            [
                { content: 'AAAA', plainLength: 4, widget: l2a  },
                { content: '',     plainLength: 0, widget: l2f  },
                { content: 'X',    plainLength: 1, widget: l2ra },
                { content: 'YYYY', plainLength: 4, widget: l2rb }
            ]
        ];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: '' };
        const result = calculateGroupedMaxWidths([l1, l2], pre, settings);
        // rightWidgetMaxWidths[0] = [rWPos0=max(1,4)=4, rWPos1=max(2,1)=2]
        expect(result.rightWidgetMaxWidths).toEqual([[4, 2]]);
        // rightGroupTotalMax[0] = max(1+2, 1+4) = 5
        expect(result.rightGroupTotalMax).toEqual([5]);
        // Sanity: left-anchor slot uses group 0 only
        expect(result.widgetMaxWidths).toEqual([[4]]);
        expect(result.groupTotalMax).toEqual([4]);
    });

    it('multiple right-anchor groups — rG indexing is reverse of source index', () => {
        const l1f = FLEX('f');
        const l1m = TEXT('m', 'M');    // rG = 1
        const l1r = TEXT('r', 'R');    // rG = 0
        const l2f = FLEX('f');
        const l2m = TEXT('m', 'MMMM');
        const l2r = TEXT('r', 'RR');
        const l1 = mkLine([[l1f], [l1m], [l1r]]);
        const l2 = mkLine([[l2f], [l2m], [l2r]]);
        const pre = [
            [
                { content: '',     plainLength: 0, widget: l1f },
                { content: 'M',    plainLength: 1, widget: l1m },
                { content: 'R',    plainLength: 1, widget: l1r }
            ],
            [
                { content: '',     plainLength: 0, widget: l2f },
                { content: 'MMMM', plainLength: 4, widget: l2m },
                { content: 'RR',   plainLength: 2, widget: l2r }
            ]
        ];
        const settings = { ...DEFAULT_SETTINGS, defaultPadding: '' };
        const result = calculateGroupedMaxWidths([l1, l2], pre, settings);
        expect(result.rightWidgetMaxWidths).toEqual([[2], [4]]); // rG=0 rightmost, rG=1 inner
        expect(result.rightGroupTotalMax).toEqual([2, 4]);
    });
});