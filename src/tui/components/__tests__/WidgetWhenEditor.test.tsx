import { render } from 'ink-testing-library';
import React from 'react';
import {
    describe,
    expect,
    it
} from 'vitest';

import type { WidgetItem } from '../../../types/Widget';
import { WidgetWhenEditor } from '../WidgetWhenEditor';

function makeWidget(overrides: Partial<WidgetItem> & Pick<WidgetItem, 'type'>): WidgetItem {
    return { id: 'w', ...overrides } as WidgetItem;
}

function noop(): void { /* test stub */ }

function frame(widget: WidgetItem): string {
    const r = render(
        <WidgetWhenEditor
            widget={widget}
            onUpdate={noop}
            onBack={noop}
            breadcrumbPrefix='Edit Line 1 › Group 1 › Widget 1'
        />
    );
    const out = r.lastFrame() ?? '';
    r.unmount();
    return out;
}

describe('WidgetWhenEditor list mode', () => {
    it('shows the tag list under the rules block so users can see / manage tags from here', () => {
        const widget = makeWidget({ type: 'model', tags: { 'New Tag (1)': {} } });
        const out = frame(widget);
        expect(out).toContain('Rules');
        expect(out).toContain('Tags');
        expect(out).toContain('· New Tag (1)');
        expect(out).toContain('+ Add tag…');
    });

    it('shows an empty-state row inside Rules when the widget has no `when` entries', () => {
        const widget = makeWidget({ type: 'model' });
        const out = frame(widget);
        expect(out).toContain('No conditional actions. Press \'a\' to add one.');
        expect(out).toContain('+ Add tag…');
    });

    it('renders a rule plus all tags when both exist', () => {
        const widget = makeWidget({
            type: 'model',
            when: [{ on: 'model.opus', do: 'setTag', tag: 'opus' }],
            tags: { opus: {}, sonnet: {} }
        });
        const out = frame(widget);
        expect(out).toMatch(/1\. .+ Model is Opus → Set tag: opus/);
        expect(out).toContain('· opus');
        expect(out).toContain('· sonnet');
    });

    it('advertises the rule-add keybind while focus is on the empty-rules row', () => {
        const widget = makeWidget({ type: 'model', tags: { 'New Tag (1)': {} } });
        const out = frame(widget);
        expect(out).toContain('(a)dd rule');
    });
});