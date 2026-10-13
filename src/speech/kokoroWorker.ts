import { KokoroTTS } from "kokoro-js";

type In =
  | { type: "speak"; id: number; text: string; voice: string }
  | { type: "cancel" };

let model: Promise<KokoroTTS> | null = null;
let latest = 0;

function load(): Promise<KokoroTTS> {
  model ??= KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "wasm",
  }).catch((error) => {
    model = null; // allow a retry on the next request
    throw error;
  });
  return model;
}

self.onmessage = async (event: MessageEvent<In>) => {
  const msg = event.data;
  if (msg.type === "cancel") { latest = -1; return; }

  const { id, text, voice } = msg;
  latest = id;
  try {
    const tts = await load();
    for await (const { audio } of tts.stream(text, { voice: voice as "af_heart" })) {
      if (latest !== id) break;
      const samples = audio.audio as Float32Array;
      self.postMessage({ type: "chunk", id, samples, rate: audio.sampling_rate }, { transfer: [samples.buffer] });
    }
    self.postMessage({ type: "done", id });
  } catch (error) {
    self.postMessage({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  }
};