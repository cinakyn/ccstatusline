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
import {
    TerminalWidthMenu,
    buildTerminalWidthItems,
    getTerminalWidthSelectionIndex,
    validateCompactThresholdInput
} from '../TerminalWidthMenu';

describe('TerminalWidthMenu helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('validates compact threshold input', () => {
        expect(validateCompactThresholdInput('')).toBe('Please enter a valid number');
        expect(validateCompactThresholdInput('0')).toBe('Value must be between 1 and 99 (you entered 0)');
        expect(validateCompactThresholdInput('100')).toBe('Value must be between 1 and 99 (you entered 100)');
        expect(validateCompactThresholdInput('42')).toBeNull();
    });

    it('builds terminal width menu items with active and threshold sublabels', () => {
        const items = buildTerminalWidthItems('full-until-compact', 60);

        expect(items).toHaveLength(3);
        expect(items[0]).toMatchObject({
            label: 'Full width always',
            value: 'full'
        });
        expect(items[1]).toMatchObject({
            label: 'Full width minus 40',
            sublabel: '(default)',
            value: 'full-minus-40'
        });
        expect(items[2]).toMatchObject({
            label: 'Full width until compact',
            sublabel: '(threshold 60%, active)',
            value: 'full-until-compact'
        });
        expect(items[2]?.description).toContain('60%');
    });

    it('returns the current option index for list selection', () => {
        expect(getTerminalWidthSelectionIndex('full')).toBe(0);
        expect(getTerminalWidthSelectionIndex('full-minus-40')).toBe(1);
        expect(getTerminalWidthSelectionIndex('full-until-compact')).toBe(2);
    });

    it('keeps full-until-compact selected after confirming the threshold prompt', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();
        const instance = render(
            React.createElement(TerminalWidthMenu, {
                settings: {
                    ...DEFAULT_SETTINGS,
                    flexMode: 'full',
                    compactThreshold: 60
                },
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
            stdin.write('\u001B[B');
            await flushInk();
            stdin.write('\u001B[B');
            await flushInk();
            stdin.write('\r');
            await flushInk();

            expect(stdout.getOutput()).toContain('Enter compact threshold (1-99):');

            stdout.clearOutput();

            stdin.write('\r');
            await flushInk();

            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
                flexMode: 'full-until-compact',
                compactThreshold: 60
            }));

            const output = stdout.getOutput();

            expect(output).toContain('▶  Full width until compact');
            expect(output).not.toContain('▶  Full width always');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });
});