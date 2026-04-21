import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    StatefulWidget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import {
    DEFAULT_CONTEXT_WINDOW_SIZE,
    getContextConfig,
    getModelContextIdentifier
} from '../utils/model-context';

function formatContextMarker(maxTokens: number): string {
    if (maxTokens >= 1_000_000) {
        const m = maxTokens / 1_000_000;
        return `${Number.isInteger(m) ? m.toString() : m.toFixed(1)}M`;
    }
    return `${Math.round(maxTokens / 1_000)}K`;
}

export class ModelWidget implements StatefulWidget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Displays the Claude model name (e.g., Claude 3.5 Sonnet)'; }
    getDisplayName(): string { return 'Model'; }
    getCategory(): string { return 'Core'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? 'Claude' : 'Model: Claude';
        }

        const model = context.data?.model;
        const modelDisplayName = typeof model === 'string'
            ? model
            : (model?.display_name ?? model?.id);

        if (modelDisplayName) {
            const baseName = modelDisplayName
                .replace(/\s*\([^)]*\)\s*$/, '')
                .replace(/\s*\[\s*\d+(?:[,_]\d+)*(?:\.\d+)?\s*[km]\s*\]\s*$/i, '')
                .trim();

            const identifier = getModelContextIdentifier(model);
            const { maxTokens } = getContextConfig(identifier);
            const shortName = maxTokens === DEFAULT_CONTEXT_WINDOW_SIZE
                ? baseName
                : `${baseName} (${formatContextMarker(maxTokens)})`;

            return item.rawValue ? shortName : `Model: ${shortName}`;
        }
        return null;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }

    getStateKey(_item: WidgetItem, context: RenderContext): string | null {
        const model = context.data?.model;
        const name = typeof model === 'string' ? model : (model?.id ?? model?.display_name);
        if (!name)
            return null;
        const lower = name.toLowerCase();
        if (lower.includes('opus'))
            return 'opus';
        if (lower.includes('sonnet'))
            return 'sonnet';
        if (lower.includes('haiku'))
            return 'haiku';
        return null;
    }

    getAllStates(): string[] {
        return ['opus', 'sonnet', 'haiku'];
    }
}