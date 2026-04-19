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
});