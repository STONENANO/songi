import { z } from "zod/v4";

/** Shapes from Kie.ai's Suno endpoints (docs.kie.ai/suno-api). Validated at runtime. */

export const KieTrackSchema = z.object({
  id: z.string().min(1),
  audio_url: z.string().min(1),
  stream_audio_url: z.string().optional(),
  image_url: z.string().optional(),
  title: z.string().optional(),
  duration: z.number().optional(),
  tags: z.string().optional(),
  model_name: z.string().optional(),
});
export type KieTrack = z.infer<typeof KieTrackSchema>;

/** Callback body. Only routing data is trusted from it; results are re-fetched from the API. */
export const KieCallbackSchema = z.object({
  code: z.number(),
  msg: z.string().optional().default(""),
  data: z
    .object({
      callbackType: z.string().optional(),
      task_id: z.string().optional(),
      taskId: z.string().optional(),
    })
    .passthrough(),
});
export type KieCallback = z.infer<typeof KieCallbackSchema>;

export type KieTaskState = "waiting" | "queuing" | "generating" | "success" | "fail";

export type KieTaskStatus = {
  state: KieTaskState;
  tracks: KieTrack[];
  /** Raw track-like records that failed validation (for diagnostics). */
  invalidTracks: number;
  failMsg: string | null;
  creditsConsumed: number | null;
};

export type KieAlignedWord = { word: string; success: boolean; startS: number; endS: number; palign: number };
