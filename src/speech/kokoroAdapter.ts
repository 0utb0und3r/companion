import type { SpeechAdapter, SpeechOptions } from "./speechAdapter";

type WorkerOut =
  | { type: "chunk"; id: number; samples: Float32Array; rate: number }
  | { type: "done"; id: number }
  | { type: "error"; id: number; message: string };

/** Local text-to-speech with kokoro-js. Lips follow the loudness of the audio being played. */
export class KokoroAdapter implements SpeechAdapter {
  readonly name = "Kokoro";
  private readonly voice: string;
  private worker: Worker | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private runId = 0;
  private nextTime = 0;
  private frame = 0;

  constructor(voice = "af_heart") {
    this.voice = voice;
  }

  speak(text: string, options: SpeechOptions = {}): void {
    this.stop();
    const id = this.runId;
    const ctx = this.getContext();
    const analyser = this.analyser!;
    void ctx.resume();

    let started = false;
    let done = false;
    let active = 0;

    const end = () => {
      if (id !== this.runId) return;
      cancelAnimationFrame(this.frame);
      options.onViseme?.("sil", 0, 0);
      options.onEnd?.();
    };

    this.getWorker().onmessage = (event: MessageEvent<WorkerOut>) => {
      const msg = event.data;
      if (msg.id !== id || id !== this.runId) return;

      if (msg.type === "error") {
        this.stop();
        options.onError?.(msg.message);
        return;
      }
      if (msg.type === "done") {
        done = true;
        if (active === 0) end();
        return;
      }

      const buffer = ctx.createBuffer(1, msg.samples.length, msg.rate);
      buffer.copyToChannel(msg.samples as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      const startAt = Math.max(ctx.currentTime + 0.03, this.nextTime);
      this.nextTime = startAt + buffer.duration;
      active += 1;
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        active -= 1;
        if (done && active === 0) end();
      };
      source.start(startAt);

      if (!started) {
        started = true;
        options.onStart?.();
        this.meter(analyser, options, id);
      }
    };

    this.getWorker().postMessage({ type: "speak", id, text: text.slice(0, 600), voice: this.voice });
  }

  stop(): void {
    this.runId += 1;
    cancelAnimationFrame(this.frame);
    this.worker?.postMessage({ type: "cancel" });
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  /** Turns audio loudness into mouth shapes (names match what useCompanionSpeech maps). */
  private meter(analyser: AnalyserNode, options: SpeechOptions, id: number): void {
    const data = new Uint8Array(analyser.fftSize);
    let last = "";
    const tick = () => {
      if (id !== this.runId) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
      const level = Math.sqrt(sum / data.length);
      const flip = Math.floor(performance.now() / 140) % 2 === 0;
      const viseme =
        level < 0.02 ? "sil" :
        level < 0.06 ? (flip ? "E" : "nn") :
        level < 0.14 ? (flip ? "aa" : "O") : "aa";
      if (viseme !== last) { last = viseme; options.onViseme?.(viseme, 0, 0); }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.3;
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private getWorker(): Worker {
    this.worker ??= new Worker(new URL("./kokoroWorker.ts", import.meta.url), { type: "module" });
    return this.worker;
  }
}