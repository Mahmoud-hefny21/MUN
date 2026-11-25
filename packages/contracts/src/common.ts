import { z } from 'zod';

export const profileUpdate = z.strictObject({
  name: z.string().trim().min(1).max(60),
  photo: z.string().trim().max(500)
});

export const healthStatus = z.strictObject({
  data: z.strictObject({ status: z.enum(['ok', 'ready']) })
});

export type ProfileUpdate = z.infer<typeof profileUpdate>;
export type HealthStatus = z.infer<typeof healthStatus>;
