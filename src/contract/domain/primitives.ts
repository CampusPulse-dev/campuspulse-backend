import { z } from 'zod';

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Verification at launch is scoped to UI-affiliated addresses (PRD §7). */
export const StudentEmail = z.email().refine((v) => v.toLowerCase().endsWith('.ui.edu.ng'), {
  message: 'must be a University of Ibadan address',
});
export type StudentEmail = z.infer<typeof StudentEmail>;

export const Slug = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case');
export type Slug = z.infer<typeof Slug>;

export const Pagination = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
