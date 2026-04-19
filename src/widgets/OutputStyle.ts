import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    StatefulWidget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

export class OutputStyleWidget implements StatefulWidget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows the current Claude Code output style'; }
    getDisplayName(): string { return 'Output Style'; }
    getCategory(): string { return 'Core'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? 'default' : 'Style: default';
        } else if (context.data?.output_style?.name) {
            return item.rawValue ? context.data.output_style.name : `Style: ${context.data.output_style.name}`;
        }
        return null;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }

    getStateKey(_item: WidgetItem, context: RenderContext): string | null {
        const name = context.data?.output_style?.name;
        return name ? name.toLowerCase() : null;
    }

    getAllStates(): string[] {
        return ['default'];
    }
}