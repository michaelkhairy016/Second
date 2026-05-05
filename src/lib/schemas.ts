import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const signupSchema = loginSchema.extend({
  name: z.string().min(1, "Enter your display name"),
});

export const lotSchema = z.object({
  lotCode: z.string().min(1, "Lot code is required"),
  model: z.string().min(1, "Model is required"),
  units: z.coerce.number().int().min(1, "At least 1 unit"),
});

export const jobOrderSchema = z.object({
  lotId: z.string().min(1, "Select a lot"),
  jobCode: z.string().min(1, "Job code is required"),
  units: z.coerce.number().int().min(1, "At least 1 unit"),
  colorPlan: z.string().min(1, "Color plan is required"),
  vins: z.string().min(17, "Paste VINs (17 chars each)"),
});

export const shortageSchema = z.object({
  parts: z.string().min(1, "List at least one part"),
  notes: z.string().optional(),
});

export const vinSuffixSchema = z.string().min(3, "Enter at least 3 characters").max(17).regex(/^[A-Z0-9]+$/, "Only letters and numbers");
