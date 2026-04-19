import { render } from 'ink';
import React from 'react';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { Line } from '../../../types/Group';
import { DEFAULT_SETTINGS } from '../../../types/Settings';
import type { WidgetItem } from '../../../types/Widget';
import { writeFlatWidgets } from '../../../utils/groups';
import {
    createMockStdin,
    createMockStdout,
    flushInk
} from '../../__tests__/helpers/ink-test-utils';
import { ItemsEditor } from '../ItemsEditor';

describe('ItemsEditor group breadcrumb', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows "Edit Line N › Widget K" breadcrumb in flat mode (2-depth)', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();

        const widgets: WidgetItem[] = [
            { id: 'w1', type: 'model' }
        ];

        const instance = render(
            React.createElement(ItemsEditor, {
                widgets,
                onUpdate: vi.fn(),
                onBack: vi.fn(),
                lineNumber: 2,
                settings: DEFAULT_SETTINGS
            }),
            {
                stdin,
                stdout,
                stderr,
                debug: true,
                exitOnCtrlC: false,
                patchConsole: false
            }
        );

        try {
            await flushInk();
            const output = stdout.getOutput();
            expect(output).toContain('Edit Line');
            expect(output).toContain('2');
            // Widget depth appears in flat mode too
            expect(output).toContain('Widget');
            expect(output).toContain('1');
            // No group label when groupNumber is undefined
            expect(output).not.toContain('Group');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('shows "Widget -" breadcrumb when widget list is empty', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();

        const instance = render(
            React.createElement(ItemsEditor, {
                widgets: [],
                onUpdate: vi.fn(),
                onBack: vi.fn(),
                lineNumber: 1,
                settings: DEFAULT_SETTINGS
            }),
            {
                stdin,
                stdout,
                stderr,
                debug: true,
                exitOnCtrlC: false,
                patchConsole: false
            }
        );

        try {
            await flushInk();
            const output = stdout.getOutput();
            expect(output).toContain('Widget -');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('shows "Edit Line N › Group M › Widget K" breadcrumb when groupNumber is provided (3-depth)', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();

        const widgets: WidgetItem[] = [
            { id: 'w1', type: 'model' }
        ];

        const instance = render(
            React.createElement(ItemsEditor, {
                widgets,
                onUpdate: vi.fn(),
                onBack: vi.fn(),
                lineNumber: 2,
                groupNumber: 3,
                settings: DEFAULT_SETTINGS
            }),
            {
                stdin,
                stdout,
                stderr,
                debug: true,
                exitOnCtrlC: false,
                patchConsole: false
            }
        );

        try {
            await flushInk();
            const output = stdout.getOutput();
            // Full 3-depth breadcrumb: "Edit Line 2 › Group 3 › Widget 1"
            expect(output).toContain('Edit Line');
            expect(output).toContain('2');
            expect(output).toContain('Group');
            expect(output).toContain('3');
            expect(output).toContain('Widget');
            expect(output).toContain('1');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('flat mode: onUpdate called with full widget list on delete', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();

        const widgets: WidgetItem[] = [
            { id: 'w1', type: 'model' },
            { id: 'w2', type: 'git-branch' }
        ];

        const instance = render(
            React.createElement(ItemsEditor, {
                widgets,
                onUpdate,
                onBack: vi.fn(),
                lineNumber: 1,
                // No groupNumber: flat mode
                settings: DEFAULT_SETTINGS
            }),
            {
                stdin,
                stdout,
                stderr,
                debug: true,
                exitOnCtrlC: false,
                patchConsole: false
            }
        );

        try {
            await flushInk();
            stdin.write('d'); // delete selected (first) widget
            await flushInk();

            expect(onUpdate).toHaveBeenCalled();
            const updated = onUpdate.mock.calls[0]?.[0] as WidgetItem[] | undefined;
            expect(updated).toHaveLength(1);
            expect(updated?.[0]?.type).toBe('git-branch');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('group mode: onUpdate called with group widget list on delete', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();

        // GroupEditor passes only the group's widgets to ItemsEditor
        const groupWidgets: WidgetItem[] = [
            { id: 'w1', type: 'model' },
            { id: 'w2', type: 'git-branch' }
        ];

        const instance = render(
            React.createElement(ItemsEditor, {
                widgets: groupWidgets,
                onUpdate,
                onBack: vi.fn(),
                lineNumber: 1,
                groupNumber: 2, // group mode
                settings: DEFAULT_SETTINGS
            }),
            {
                stdin,
                stdout,
                stderr,
                debug: true,
                exitOnCtrlC: false,
                patchConsole: false
            }
        );

        try {
            await flushInk();
            stdin.write('d'); // delete selected (first) widget
            await flushInk();

            expect(onUpdate).toHaveBeenCalled();
            const updated = onUpdate.mock.calls[0]?.[0] as WidgetItem[] | undefined;
            expect(updated).toHaveLength(1);
            expect(updated?.[0]?.type).toBe('git-branch');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('flat-mode delete on a multi-group line preserves groups[1..N] via writeFlatWidgets', async () => {
        // End-to-end invariant test: replicate App's flat-mode pipeline for the
        // items screen on a line that has 3 groups. Verifies that pressing (d)
        // in ItemsEditor, routed through writeFlatWidgets (as App's updateLine
        // does), keeps groups[1] and groups[2] intact.
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();

        const multiGroupLine: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'g0-a', type: 'model' },
                        { id: 'g0-b', type: 'git-branch' }
                    ]
                },
                {
                    continuousColor: false,
                    gap: '---',
                    widgets: [{ id: 'g1-a', type: 'context-length' }]
                },
                { continuousColor: true, widgets: [{ id: 'g2-a', type: 'git-changes' }] }
            ]
        };

        // Flat-mode feed (same as App when groupsEnabled=false)
        const flatFeed = multiGroupLine.groups[0]?.widgets ?? [];
        let finalLine: Line | null = null;

        // Simulate App.updateLine: writeFlatWidgets on the existing multi-group line
        const onUpdate = (widgets: WidgetItem[]) => {
            finalLine = writeFlatWidgets(multiGroupLine, widgets);
        };

        const instance = render(
            React.createElement(ItemsEditor, {
                widgets: flatFeed,
                onUpdate,
                onBack: vi.fn(),
                lineNumber: 1,
                // No groupNumber: flat mode (simulating groupsEnabled=false)
                settings: DEFAULT_SETTINGS
            }),
            {
                stdin,
                stdout,
                stderr,
                debug: true,
                exitOnCtrlC: false,
                patchConsole: false
            }
        );

        try {
            await flushInk();
            stdin.write('d'); // delete selected (first) widget — g0-a
            await flushInk();

            // finalLine is assigned synchronously inside onUpdate; cast via
            // unknown because TS narrows the let-binding to the `null`
            // initializer when the closure write isn't statically visible.
            const resolved = finalLine as unknown as Line | null;
            expect(resolved).not.toBeNull();
            if (!resolved) {
                return;
            }

            // groups[0] reflects the delete
            expect(resolved.groups).toHaveLength(3);
            expect(resolved.groups[0]?.widgets.map(w => w.id)).toEqual(['g0-b']);
            // groups[1..N] survived untouched
            expect(resolved.groups[1]?.continuousColor).toBe(false);
            expect(resolved.groups[1]?.gap).toBe('---');
            expect(resolved.groups[1]?.widgets.map(w => w.id)).toEqual(['g1-a']);
            expect(resolved.groups[2]?.widgets.map(w => w.id)).toEqual(['g2-a']);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });
});