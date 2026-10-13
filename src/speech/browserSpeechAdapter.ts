import type { SpeechAdapter, SpeechOptions } from "./speechAdapter";

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const lang = (navigator.language || "en-US").toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === lang && /natural|neural|google|samantha|aria|jenny/i.test(v.name)) ??
    voices.find((v) => v.lang.toLowerCase() === lang) ??
    voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
    null
  );
}

export class BrowserSpeechAdapter implements SpeechAdapter {
  readonly name = "Browser speech";
  // Chrome can garbage-collect an utterance mid-speech; keep a reference.
  private utterance: SpeechSynthesisUtterance | null = null;
  private pending = 0;

  speak(text: string, options: SpeechOptions = {}): void {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      options.onError?.("Speech synthesis is not supported in this browser.");
      return;
    }

    this.stop();
    const ticket = ++this.pending;
    // Speaking immediately after cancel() is dropped by some Chrome/Safari builds.
    window.setTimeout(() => {
      if (ticket !== this.pending) return;
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      utterance.rate = 0.98;
      utterance.pitch = 1.05;
      utterance.onstart = () => options.onStart?.();
      utterance.onboundary = (event) => options.onBoundary?.(event.charIndex);
      utterance.onend = () => { this.utterance = null; options.onEnd?.(); };
      utterance.onerror = (event) => {
        this.utterance = null;
        if (event.error !== "canceled" && event.error !== "interrupted") {
          options.onError?.(`Speech failed: ${event.error}`);
        }
      };
      this.utterance = utterance;
      window.speechSynthesis.speak(utterance);
    }, 60);
  }

  stop(): void {
    this.pending += 1;
    if (this.utterance) {
      this.utterance.onend = null;
      this.utterance.onerror = null;
      this.utterance = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }
}
