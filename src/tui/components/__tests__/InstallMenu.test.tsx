import { render } from 'ink';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    createMockStdin,
    createMockStdout,
    flushInk
} from '../../__tests__/helpers/ink-test-utils';
import { InstallMenu } from '../InstallMenu';

describe('InstallMenu', () => {
    it('calls onCancel when escape is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onCancel = vi.fn();
        const instance = render(
            React.createElement(InstallMenu, {
                bunxAvailable: true,
                existingStatusLine: null,
                onSelectNpx: vi.fn(),
                onSelectBunx: vi.fn(),
                onCancel
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

            stdin.write('\u001B');
            await flushInk();

            expect(onCancel).toHaveBeenCalledTimes(1);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('respects the provided initial selection', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const instance = render(
            React.createElement(InstallMenu, {
                bunxAvailable: true,
                existingStatusLine: null,
                onSelectNpx: vi.fn(),
                onSelectBunx: vi.fn(),
                onCancel: vi.fn(),
                initialSelection: 1
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

            expect(stripAnsi(stdout.getOutput())).toContain('▶  bunx - Bun Package Execute');
            expect(stripAnsi(stdout.getOutput())).not.toContain('▶  npx - Node Package Execute');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });
});