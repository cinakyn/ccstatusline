import { z } from 'zod';

// Schema for powerline configuration
export const PowerlineConfigSchema = z.object({
    enabled: z.boolean().default(false),
    separators: z.array(z.string()).default(['\uE0B0']),
    separatorInvertBackground: z.array(z.boolean()).default([false]),
    startCaps: z.array(z.string()).default([]),
    endCaps: z.array(z.string()).default([]),
    theme: z.string().optional(),
    autoAlign: z.boolean().default(false),
    continueThemeAcrossLines: z.boolean().default(false),
    // B2: new per-group / per-line symbol vocabulary (dormant until B3)
    widgetSeparator: z.array(z.string()).default(['\uE0B0']),
    groupStartCap: z.array(z.string()).default([]),
    groupEndCap: z.array(z.string()).default([]),
    groupGap: z.string().default('  '),
    lineStartCap: z.array(z.string()).default([]),
    lineEndCap: z.array(z.string()).default([])
});

// Inferred type from schema
export type PowerlineConfig = z.infer<typeof PowerlineConfigSchema>;