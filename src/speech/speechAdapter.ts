export interface SpeechOptions {
  onStart?: () => void;
  onBoundary?: (charIndex: number) => void;
  onViseme?: (viseme: string, startMs: number, durationMs: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export interface SpeechAdapter {
  readonly name: string;
  speak(text: string, options?: SpeechOptions): void;
  stop(): void;
}
