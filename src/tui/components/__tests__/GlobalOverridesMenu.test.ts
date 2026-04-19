import { render } from 'ink';
import React from 'react';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../../types/Settings';
import {
    createMockStdin,
    createMockStdout,
    flushInk
} from '../../__tests__/helpers/ink-test-utils';
import { GlobalOverridesMenu } from '../GlobalOverridesMenu';

describe('GlobalOverridesMenu', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('displays minimalist mode as disabled by default', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: DEFAULT_SETTINGS,
                onUpdate,
                onBack
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
            expect(stdout.getOutput()).toContain('Minimalist Mode:');
            expect(stdout.getOutput()).toContain('✗ Disabled');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('toggles minimalist mode on when (m) is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: { ...DEFAULT_SETTINGS, minimalistMode: false },
                onUpdate,
                onBack
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
            stdin.write('m');
            await flushInk();

            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ minimalistMode: true }));
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('toggles minimalist mode off when (m) is pressed while enabled', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: { ...DEFAULT_SETTINGS, minimalistMode: true },
                onUpdate,
                onBack
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
            stdin.write('m');
            await flushInk();

            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ minimalistMode: false }));
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('displays groups enabled as disabled by default', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: DEFAULT_SETTINGS,
                onUpdate,
                onBack
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
            expect(stdout.getOutput()).toContain('Groups Enabled:');
            expect(stdout.getOutput()).toContain('✗ Disabled');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('toggles groupsEnabled on when (n) is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: { ...DEFAULT_SETTINGS, groupsEnabled: false },
                onUpdate,
                onBack
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
            stdin.write('n');
            await flushInk();

            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ groupsEnabled: true }));
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('toggles groupsEnabled off when (n) is pressed while enabled', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: { ...DEFAULT_SETTINGS, groupsEnabled: true },
                onUpdate,
                onBack
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
            stdin.write('n');
            await flushInk();

            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ groupsEnabled: false }));
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('displays default group gap row', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: DEFAULT_SETTINGS,
                onUpdate,
                onBack
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
            expect(stdout.getOutput()).toContain('Default Group Gap:');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('enters edit mode for defaultGroupGap when (a) is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: DEFAULT_SETTINGS,
                onUpdate,
                onBack
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

            expect(stdout.getOutput()).toContain('Enter default group gap');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('saves defaultGroupGap when Enter is pressed after typing', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: { ...DEFAULT_SETTINGS, defaultGroupGap: '' },
                onUpdate,
                onBack
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
            stdin.write(' ');
            await flushInk();
            stdin.write('\r');
            await flushInk();

            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ defaultGroupGap: ' ' }));
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('cancels defaultGroupGap edit on Esc and does not call onUpdate', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();

        const instance = render(
            React.createElement(GlobalOverridesMenu, {
                settings: { ...DEFAULT_SETTINGS, defaultGroupGap: 'original' },
                onUpdate,
                onBack
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
            stdin.write('x');
            await flushInk();
            stdin.write('\x1B');
            await flushInk();

            expect(onUpdate).not.toHaveBeenCalled();
            // Returns to main menu view
            expect(stdout.getOutput()).toContain('Default Group Gap:');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });
});