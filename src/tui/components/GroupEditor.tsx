import {
    Box,
    Text,
    useInput
} from 'ink';
import pluralize from 'pluralize';
import React, { useState } from 'react';

import type {
    Group,
    Line
} from '../../types/Group';
import type { Settings } from '../../types/Settings';
import { shouldInsertInput } from '../../utils/input-guards';

import { ConfirmDialog } from './ConfirmDialog';

export interface GroupEditorProps {
    line: Line;
    lineNumber: number;
    onGroupSelect: (groupIndex: number) => void;
    onLineUpdate: (line: Line) => void;
    onBack: () => void;
    settings: Settings;
}

type GroupEditorMode = 'list' | 'delete-confirm' | 'edit-gap';

function emptyGroup(): Group {
    // Omit `gap` so the renderer falls back to settings.defaultGroupGap.
    // The gap editor treats `undefined` as "use default" and pre-fills with
    // defaultGroupGap for display.
    return {
        continuousColor: true,
        widgets: []
    };
}

export const GroupEditor: React.FC<GroupEditorProps> = ({
    line,
    lineNumber,
    onGroupSelect,
    onLineUpdate,
    onBack,
    settings
}) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [mode, setMode] = useState<GroupEditorMode>('list');
    const [gapInput, setGapInput] = useState('');

    const groups = line.groups;
    const canDelete = groups.length > 1;
    const selectedGroup = groups[selectedIndex];

    const appendGroup = () => {
        const newGroups = [...groups, emptyGroup()];
        onLineUpdate({ ...line, groups: newGroups });
        setSelectedIndex(newGroups.length - 1);
    };

    const deleteGroup = (index: number) => {
        const newGroups = groups.filter((_, i) => i !== index);
        onLineUpdate({ ...line, groups: newGroups });
        setSelectedIndex(Math.min(index, newGroups.length - 1));
    };

    const toggleContinuousColor = (index: number) => {
        const group = groups[index];
        if (!group) {
            return;
        }

        const newGroups = [...groups];
        newGroups[index] = { ...group, continuousColor: !group.continuousColor };
        onLineUpdate({ ...line, groups: newGroups });
    };

    const applyGap = (index: number, gap: string) => {
        const group = groups[index];
        if (!group) {
            return;
        }

        const newGroups = [...groups];
        if (gap === '') {
            // Remove the gap property so the renderer falls back to
            // settings.defaultGroupGap at render time.
            const groupWithoutGap: Group = { ...group };
            delete groupWithoutGap.gap;
            newGroups[index] = groupWithoutGap;
        } else {
            newGroups[index] = { ...group, gap };
        }

        onLineUpdate({ ...line, groups: newGroups });
    };

    useInput((input, key) => {
        if (mode === 'delete-confirm') {
            return;
        }

        if (mode === 'edit-gap') {
            if (key.return) {
                applyGap(selectedIndex, gapInput);
                setMode('list');
            } else if (key.escape) {
                setMode('list');
            } else if (key.backspace) {
                setGapInput(prev => prev.slice(0, -1));
            } else if (key.delete) {
                // forward delete — no cursor, do nothing
            } else if (shouldInsertInput(input, key)) {
                setGapInput(prev => prev + input);
            }

            return;
        }

        // list mode
        if (key.upArrow && groups.length > 0) {
            setSelectedIndex(prev => Math.max(0, prev - 1));
        } else if (key.downArrow && groups.length > 0) {
            setSelectedIndex(prev => Math.min(groups.length - 1, prev + 1));
        } else if (key.return && groups.length > 0) {
            onGroupSelect(selectedIndex);
        } else if (input === 'a') {
            appendGroup();
        } else if (input === 'd' && canDelete && groups.length > 0) {
            setMode('delete-confirm');
        } else if (input === 'g' && groups.length > 0) {
            const currentGap = selectedGroup?.gap ?? settings.defaultGroupGap;
            setGapInput(currentGap);
            setMode('edit-gap');
        } else if (input === 't' && groups.length > 0) {
            toggleContinuousColor(selectedIndex);
        } else if (key.escape) {
            onBack();
        }
    });

    if (mode === 'delete-confirm' && selectedGroup) {
        const widgetCount = selectedGroup.widgets.length;
        const suffix = widgetCount > 0
            ? pluralize('widget', widgetCount, true)
            : 'empty';

        return (
            <Box flexDirection='column'>
                <Text bold>
                    Edit Line
                    {' '}
                    {lineNumber}
                    {' '}
                    › Groups
                </Text>
                <Box marginTop={1} flexDirection='column' gap={1}>
                    <Text bold>
                        Group
                        {' '}
                        {selectedIndex + 1}
                        {' '}
                        <Text dimColor>
                            (
                            {suffix}
                            )
                        </Text>
                    </Text>
                    <Text bold>Are you sure you want to delete this group?</Text>
                </Box>
                <Box marginTop={1}>
                    <ConfirmDialog
                        inline={true}
                        onConfirm={() => {
                            deleteGroup(selectedIndex);
                            setMode('list');
                        }}
                        onCancel={() => {
                            setMode('list');
                        }}
                    />
                </Box>
            </Box>
        );
    }

    if (mode === 'edit-gap') {
        return (
            <Box flexDirection='column'>
                <Text bold>
                    Edit Line
                    {' '}
                    {lineNumber}
                    {' '}
                    › Groups
                </Text>
                <Box marginTop={1} flexDirection='column'>
                    <Box>
                        <Text>
                            Enter gap for Group
                            {' '}
                            {selectedIndex + 1}
                            {' '}
                            (empty = use default &quot;
                            {settings.defaultGroupGap}
                            &quot;):
                            {' '}
                        </Text>
                        <Text color='cyan'>{gapInput ? `"${gapInput}"` : '(empty)'}</Text>
                    </Box>
                    <Text dimColor>Press Enter to save, ESC to cancel</Text>
                </Box>
            </Box>
        );
    }

    return (
        <Box flexDirection='column'>
            <Box>
                <Text bold>
                    Edit Line
                    {' '}
                    {lineNumber}
                    {' '}
                    › Groups
                    {' '}
                </Text>
            </Box>
            <Box flexDirection='column'>
                <Text dimColor>
                    ↑↓ select, Enter edit widgets, (a)dd group, (d)elete group, (g)ap, (t)oggle continuousColor, ESC back
                </Text>
            </Box>
            <Box marginTop={1} flexDirection='column'>
                {groups.length === 0 ? (
                    <Text dimColor>No groups. Press &apos;a&apos; to add one.</Text>
                ) : (
                    groups.map((group, index) => {
                        const isSelected = index === selectedIndex;
                        const widgetCount = group.widgets.length;
                        const gapDisplay = group.gap !== undefined
                            ? `"${group.gap}"`
                            : `default ("${settings.defaultGroupGap}")`;
                        const ccDisplay = group.continuousColor ? 'cont.color=on' : 'cont.color=off';

                        return (
                            <Box key={index} flexDirection='row' flexWrap='nowrap'>
                                <Box width={3}>
                                    <Text color={isSelected ? 'green' : undefined}>
                                        {isSelected ? '▶ ' : '  '}
                                    </Text>
                                </Box>
                                <Text color={isSelected ? 'green' : undefined}>
                                    {`Group ${index + 1}`}
                                </Text>
                                <Text dimColor>
                                    {` (${widgetCount > 0 ? pluralize('widget', widgetCount, true) : 'empty'}, gap=${gapDisplay}, ${ccDisplay})`}
                                </Text>
                            </Box>
                        );
                    })
                )}
            </Box>
        </Box>
    );
};