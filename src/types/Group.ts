import { z } from 'zod';

import { WidgetItemSchema } from './Widget';

export const GroupSchema = z.object({
    gap: z.string().optional(),
    continuousColor: z.boolean().optional().default(true),
    widgets: z.array(WidgetItemSchema)
});

export const LineSchema = z.object({ groups: z.array(GroupSchema) });

export type Group = z.infer<typeof GroupSchema>;
export type Line = z.infer<typeof LineSchema>;