/** Shapes from Kie.ai's Suno endpoints (docs.kie.ai/suno-api). */
export type KieTrack = {
  id: string;
  audio_url: string;
  stream_audio_url?: string;
  image_url?: string;
  title?: string;
  duration?: number;
  tags?: string;
  model_name?: string;
  prompt?: string;
};

export type KieCallback = {
  code: number;
  msg: string;
  data: {
    callbackType: "text" | "first" | "complete";
    task_id: string;
    data?: KieTrack[];
  };
};

export type KieTaskState = "waiting" | "queuing" | "generating" | "success" | "fail";

export type KieTaskStatus = {
  state: KieTaskState;
  tracks: KieTrack[];
  failMsg: string | null;
};

export type KieAlignedWord = { word: string; success: boolean; startS: number; endS: number; palign: number };
