import { z } from 'zod';

export const profileUpdate = z.strictObject({
  name: z.string().trim().min(1).max(60),
  photo: z.string().trim().max(500)
});
