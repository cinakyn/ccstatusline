import {
    describe,
    expect,
    it
} from 'vitest';

import type {
    RenderContext,
    WidgetItem
} from '../../types';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import { ModelWidget } from '../Model';

const ITEM: WidgetItem = { id: 'model', type: 'model' };
const RAW_ITEM: WidgetItem = { id: 'model', type: 'model', rawValue: true };

function makeContext(overrides: Partial<RenderContext> = {}): RenderContext {
    return { ...overrides };
}

describe('ModelWidget', () => {
    describe('render()', () => {
        it('keeps compact 1M marker for non-default context window', () => {
            const ctx = makeContext({ data: { model: { id: 'claude-opus-4-6[1m]', display_name: 'Opus 4.6 (1M context)' } } });
            expect(new ModelWidget().render(RAW_ITEM, ctx, DEFAULT_SETTINGS)).toBe('Opus 4.6 (1M)');
        });

        it('strips default-size parenthetical from Sonnet display_name', () => {
            const ctx = makeContext({ data: { model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6 (200K context)' } } });
            expect(new ModelWidget().render(RAW_ITEM, ctx, DEFAULT_SETTINGS)).toBe('Sonnet 4.6');
        });

        it('leaves name unchanged when no parenthetical', () => {
            const ctx = makeContext({ data: { model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' } } });
            expect(new ModelWidget().render(RAW_ITEM, ctx, DEFAULT_SETTINGS)).toBe('Sonnet 4.6');
        });

        it('distinguishes Opus 1M variant from standard Opus', () => {
            const standard = makeContext({ data: { model: { id: 'claude-opus-4-6', display_name: 'Opus 4.6' } } });
            const oneM = makeContext({ data: { model: { id: 'claude-opus-4-6[1m]', display_name: 'Opus 4.6 (1M context)' } } });
            const widget = new ModelWidget();
            expect(widget.render(RAW_ITEM, standard, DEFAULT_SETTINGS)).toBe('Opus 4.6');
            expect(widget.render(RAW_ITEM, oneM, DEFAULT_SETTINGS)).toBe('Opus 4.6 (1M)');
        });

        it('handles model as string (legacy)', () => {
            const ctx = makeContext({ data: { model: 'Claude Opus 4.6 (1M context)' } });
            expect(new ModelWidget().render(RAW_ITEM, ctx, DEFAULT_SETTINGS)).toBe('Claude Opus 4.6 (1M)');
        });

        it('includes Model: prefix when rawValue is false', () => {
            const ctx = makeContext({ data: { model: { id: 'claude-opus-4-6[1m]', display_name: 'Opus 4.6 (1M context)' } } });
            expect(new ModelWidget().render(ITEM, ctx, DEFAULT_SETTINGS)).toBe('Model: Opus 4.6 (1M)');
        });

        it('returns null when model is absent', () => {
            const ctx = makeContext({ data: {} });
            expect(new ModelWidget().render(ITEM, ctx, DEFAULT_SETTINGS)).toBeNull();
        });

        it('returns null when context.data is absent', () => {
            const ctx = makeContext();
            expect(new ModelWidget().render(ITEM, ctx, DEFAULT_SETTINGS)).toBeNull();
        });

        it('returns preview text in preview mode', () => {
            const ctx = makeContext({ isPreview: true });
            expect(new ModelWidget().render(ITEM, ctx, DEFAULT_SETTINGS)).toBe('Model: Claude');
            expect(new ModelWidget().render(RAW_ITEM, ctx, DEFAULT_SETTINGS)).toBe('Claude');
        });

        it('falls back to model id and strips [1m] bracket, appending compact marker', () => {
            const ctx = makeContext({ data: { model: { id: 'claude-opus-4-6[1m]' } } });
            expect(new ModelWidget().render(RAW_ITEM, ctx, DEFAULT_SETTINGS)).toBe('claude-opus-4-6 (1M)');
        });
    });
});