import { z } from "zod";

/** :id route param. */
export const idParam = z.object({ id: z.string().min(1) });
