import { z } from "zod";

export const MediaUploadResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  size: z.number(),
  mimeType: z.string(),
  uploader: z.string().optional(),
});

export type MediaUploadResponse = z.infer<typeof MediaUploadResponseSchema>;
