import { render } from 'ink';
import React from 'react';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { Line } from '../../types/Group';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    clearInstallMenuSelection,
    getConfirmCancelScreen,
    getLineSelectTransition
} from '../App';
import { GroupEditor } from '../components/GroupEditor';
import { ItemsEditor } from '../components/ItemsEditor';

import {
    createMockStdin,
    createMockStdout,
    flushInk
} from './helpers/ink-test-utils';

describe('App confirm navigation helpers', () => {
    it('defaults confirmation cancel navigation to the main menu', () => {
        expect(getConfirmCancelScreen(null)).toBe('main');
        expect(getConfirmCancelScreen({
            message: 'Confirm install?',
            action: () => Promise.resolve()
        })).toBe('main');
    });

    it('returns to the install menu when the confirm dialog requests it', () => {
        expect(getConfirmCancelScreen({
            message: 'Confirm install?',
            action: () => Promise.resolve(),
            cancelScreen: 'install'
        })).toBe('install');
    });

    it('clears saved install selection when leaving the install menu', () => {
        expect(clearInstallMenuSelection({
            main: 5,
            install: 1
        })).toEqual({ main: 5 });

        const menuSelections = { main: 5 };

        expect(clearInstallMenuSelection(menuSelections)).toBe(menuSelections);
    });
});

describe('getLineSelectTransition', () => {
    it('routes to the groups screen when groupsEnabled and powerline are both enabled', () => {
        const { nextScreen } = getLineSelectTransition(true, true);
        expect(nextScreen).toBe('groups');
    });

    it('routes to the items screen when groupsEnabled is false', () => {
        const { nextScreen } = getLineSelectTransition(false, true);
        expect(nextScreen).toBe('items');
    });

    it('falls back to items when groupsEnabled is true but powerline is off (groups are powerline-only)', () => {
        const { nextScreen } = getLineSelectTransition(true, false);
        expect(nextScreen).toBe('items');
    });

    it('always resets the group cursor to 0 so a stale index does not leak across line changes', () => {
        // Covers the bug where picking Line 1 / Group 3, navigating back, then
        // picking a Line with only 1 group left selectedGroup at 2 — causing
        // groups[2] lookup to be undefined, empty widget feed, and writes into
        // a non-existent slot. The transition helper guarantees reset.
        expect(getLineSelectTransition(true, true).nextSelectedGroup).toBe(0);
        expect(getLineSelectTransition(false, true).nextSelectedGroup).toBe(0);
        expect(getLineSelectTransition(true, false).nextSelectedGroup).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Navigation breadcrumb integration: GroupEditor → ItemsEditor flow
//
// These tests exercise the rendered component at each navigation depth that
// the App routes through when groupsEnabled=true. We verify the correct
// breadcrumb text appears at each depth without requiring full App state
// machine simulation (which is fragile due to async effects and file I/O).
// ---------------------------------------------------------------------------

describe('navigation breadcrumb: GroupEditor depth (Line → Groups)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('GroupEditor renders "Edit Line 1 › Groups" breadcrumb (depth 2)', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();

        // Simulate what App renders at screen='groups', selectedLine=0
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'w1', type: 'custom-text', customText: 'Alpha' }] },
                { continuousColor: true, widgets: [{ id: 'w2', type: 'custom-text', customText: 'Beta' }] }
            ]
        };

        const instance = render(
            React.createElement(GroupEditor, {
                line,
                lineNumber: 1,          // selectedLine (0) + 1
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
            // Depth-2 breadcrumb: "Edit Line 1 › Groups"
            expect(output).toContain('Edit Line 1 \u203a Groups');
            // Group entries are listed
            expect(output).toContain('Group 1');
            expect(output).toContain('Group 2');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('GroupEditor calls onGroupSelect(1) when user picks Group 2 (arrow-down + Enter)', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onGroupSelect = vi.fn();

        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'w1', type: 'model' }] },
                { continuousColor: true, widgets: [{ id: 'w2', type: 'git-branch' }] }
            ]
        };

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
            // Navigate down to Group 2, then press Enter
            stdin.write('\x1b[B'); // down arrow
            await flushInk();
            stdin.write('\r'); // Enter
            await flushInk();

            // App then sets selectedGroup = 1 and navigates to 'items'
            expect(onGroupSelect).toHaveBeenCalledWith(1);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });
});

describe('navigation breadcrumb: ItemsEditor depth (Line → Group → Widget)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('ItemsEditor renders "Edit Line 1 › Group 2 › Widget 1" breadcrumb (depth 3)', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();

        // Simulate App at screen='items', groupsEnabled=true, selectedLine=0, selectedGroup=1
        const groupWidgets: WidgetItem[] = [
            { id: 'w1', type: 'model' }
        ];

        const instance = render(
            React.createElement(ItemsEditor, {
                widgets: groupWidgets,
                onUpdate: vi.fn(),
                onBack: vi.fn(),
                lineNumber: 1,          // selectedLine (0) + 1
                groupNumber: 2,         // selectedGroup (1) + 1
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
            // Depth-3 breadcrumb: "Edit Line 1 › Group 2 › Widget 1"
            expect(output).toContain('Edit Line 1 \u203a Group 2');
            expect(output).toContain('\u203a Widget 1');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('ItemsEditor back navigation goes to groups screen (groupsEnabled=true contract)', async () => {
        // This verifies the App contract: when in group mode and user presses ESC
        // in ItemsEditor, onBack fires (App then sets screen='groups').
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(ItemsEditor, {
                widgets: [{ id: 'w1', type: 'model' }],
                onUpdate: vi.fn(),
                onBack,
                lineNumber: 1,
                groupNumber: 2,
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
            stdin.write('\x1b'); // ESC → onBack fires; App routes back to 'groups'
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
});