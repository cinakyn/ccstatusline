import {
    describe,
    expect,
    it
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import { cloneSettings } from '../clone-settings';
import { lineWidgets } from '../groups';

describe('cloneSettings', () => {
    it('creates a deep clone that is independent from source', () => {
        const original = {
            ...DEFAULT_SETTINGS,
            lines: [
                {
                    groups: [{
                        continuousColor: true,
                        widgets: [
                            { id: '1', type: 'model', metadata: { key: 'value' } }
                        ]
                    }]
                }
            ]
        };

        const cloned = cloneSettings(original);
        const originalLine = original.lines[0];
        const clonedLine = cloned.lines[0];

        expect(originalLine).toBeDefined();
        expect(clonedLine).toBeDefined();

        if (!originalLine || !clonedLine) {
            throw new Error('Expected cloned settings to include a line entry');
        }

        const originalWidget = lineWidgets(originalLine)[0];
        const clonedWidget = lineWidgets(clonedLine)[0];

        expect(originalWidget).toBeDefined();
        expect(clonedWidget).toBeDefined();

        if (!originalWidget || !clonedWidget) {
            throw new Error('Expected cloned settings to include widget entries');
        }

        const originalMetadata = originalWidget.metadata;
        if (!originalMetadata) {
            throw new Error('Expected original widget to have metadata');
        }
        const clonedMetadata = (clonedWidget.metadata ?? {});
        clonedWidget.metadata = clonedMetadata;
        clonedMetadata.key = 'changed';

        expect(originalMetadata.key).toBe('value');
        expect(clonedMetadata.key).toBe('changed');
    });
});