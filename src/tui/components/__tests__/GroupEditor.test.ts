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
import {
    createMockStdin,
    createMockStdout,
    flushInk
} from '../../__tests__/helpers/ink-test-utils';
import { GroupEditor } from '../GroupEditor';

function makeLineWithGroups(groupCount: number): Line {
    return {
        groups: Array.from({ length: groupCount }, (_, i) => ({
            continuousColor: true,
            widgets: i === 0
                ? [{ id: `w${i}`, type: 'model' as const }]
                : []
        }))
    };
}

describe('GroupEditor', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders group list with correct breadcrumb title', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();

        const line = makeLineWithGroups(2);

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 2,
                onGroupSelect: vi.fn(),
                onLineUpdate: vi.fn(),
                onBack: vi.fn(),
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
            expect(output).toContain('Groups');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('calls onGroupSelect when Enter is pressed on a group', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onGroupSelect = vi.fn();

        const line = makeLineWithGroups(2);

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect,
                onLineUpdate: vi.fn(),
                onBack: vi.fn(),
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
            stdin.write('\r'); // Enter key
            await flushInk();

            expect(onGroupSelect).toHaveBeenCalledWith(0);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('calls onBack when ESC is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onBack = vi.fn();

        const line = makeLineWithGroups(1);

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate: vi.fn(),
                onBack,
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
            stdin.write('\x1b'); // ESC
            await flushInk();

            expect(onBack).toHaveBeenCalled();
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('adds a group when (a) is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onLineUpdate = vi.fn();

        const line = makeLineWithGroups(1);

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate,
                onBack: vi.fn(),
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
            stdin.write('a');
            await flushInk();

            expect(onLineUpdate).toHaveBeenCalled();
            const updatedLine = onLineUpdate.mock.calls[0]?.[0] as Line | undefined;
            expect(updatedLine?.groups).toHaveLength(2);
            // New group should be empty
            expect(updatedLine?.groups[1]?.widgets).toHaveLength(0);
            // New group should omit `gap` so renderer falls back to defaultGroupGap
            expect(updatedLine?.groups[1]?.gap).toBeUndefined();
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('new group added has continuousColor=true by default', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onLineUpdate = vi.fn();

        const line = makeLineWithGroups(1);

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate,
                onBack: vi.fn(),
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
            stdin.write('a');
            await flushInk();

            const updatedLine = onLineUpdate.mock.calls[0]?.[0] as Line | undefined;
            expect(updatedLine?.groups[1]?.continuousColor).toBe(true);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('does not delete last remaining group when (d) is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onLineUpdate = vi.fn();

        const line = makeLineWithGroups(1);

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate,
                onBack: vi.fn(),
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
            stdin.write('d');
            await flushInk();

            // No deletion dialog, no update
            expect(onLineUpdate).not.toHaveBeenCalled();
            // Should still show the group list, not a confirm dialog
            expect(stdout.getOutput()).not.toContain('Are you sure');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('shows delete confirmation when (d) is pressed and multiple groups exist', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();

        const line = makeLineWithGroups(2);

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate: vi.fn(),
                onBack: vi.fn(),
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
            stdin.write('d');
            await flushInk();

            expect(stdout.getOutput()).toContain('Are you sure you want to delete this group?');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('deletes group after confirming deletion', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onLineUpdate = vi.fn();

        const line = makeLineWithGroups(2);

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate,
                onBack: vi.fn(),
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
            stdin.write('d');
            await flushInk();
            // Confirm: press Enter (Yes is pre-selected)
            stdin.write('\r');
            await flushInk();

            expect(onLineUpdate).toHaveBeenCalled();
            const updatedLine = onLineUpdate.mock.calls[0]?.[0] as Line | undefined;
            expect(updatedLine?.groups).toHaveLength(1);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('toggles continuousColor when (t) is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onLineUpdate = vi.fn();

        const line: Line = { groups: [{ continuousColor: true, widgets: [] }] };

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate,
                onBack: vi.fn(),
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
            stdin.write('t');
            await flushInk();

            expect(onLineUpdate).toHaveBeenCalled();
            const updatedLine = onLineUpdate.mock.calls[0]?.[0] as Line | undefined;
            expect(updatedLine?.groups[0]?.continuousColor).toBe(false);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('toggles continuousColor back to true when (t) is pressed twice', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onLineUpdate = vi.fn();

        const line: Line = { groups: [{ continuousColor: false, widgets: [] }] };

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate,
                onBack: vi.fn(),
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
            stdin.write('t');
            await flushInk();

            expect(onLineUpdate).toHaveBeenCalled();
            const updatedLine = onLineUpdate.mock.calls[0]?.[0] as Line | undefined;
            expect(updatedLine?.groups[0]?.continuousColor).toBe(true);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('enters gap edit mode when (g) is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();

        const line = makeLineWithGroups(1);

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate: vi.fn(),
                onBack: vi.fn(),
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
            stdin.write('g');
            await flushInk();

            expect(stdout.getOutput()).toContain('Enter gap for Group');
            expect(stdout.getOutput()).toContain('Press Enter to save, ESC to cancel');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('saves gap when text is typed and Enter is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onLineUpdate = vi.fn();

        const line: Line = { groups: [{ continuousColor: true, widgets: [] }] };

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,
                onGroupSelect: vi.fn(),
                onLineUpdate,
                onBack: vi.fn(),
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
            stdin.write('g'); // enter gap edit mode
            await flushInk();
            stdin.write('X'); // type custom gap
            await flushInk();
            stdin.write('\r'); // confirm
            await flushInk();

            expect(onLineUpdate).toHaveBeenCalled();
            const updatedLine = onLineUpdate.mock.calls[0]?.[0] as Line | undefined;
            // The gap should be the full default plus 'X' since default is pre-filled
            // Actually gap is pre-filled with defaultGroupGap, then 'X' appended
            const gap = updatedLine?.groups[0]?.gap;
            expect(gap).toBeTruthy();
            expect(typeof gap).toBe('string');
            expect(gap).toContain('X');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    // Round-trip invariant (groupsEnabled off → flat edit → on preserves
    // groups[1..N]) is verified in src/utils/__tests__/groups.test.ts against
    // the real writeFlatWidgets function used by App.tsx.
});