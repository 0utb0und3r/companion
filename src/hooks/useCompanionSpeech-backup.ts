import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LipSync, MouthPose } from "../components/faceModel";
import { BrowserSpeechAdapter } from "../speech/browserSpeechAdapter";
import type { SpeechAdapter } from "../speech/speechAdapter";

export type VoiceEngine = "browser" | "headtts";

export function visemeToMouthPose(viseme: string): MouthPose {
  switch (viseme) {
    case "PP": case "nn": case "sil": return "closed";
    case "O": case "U": return "round";
    case "E": case "I": case "SS": case "CH": return "wide";
    case "TH": return "teeth";
    case "FF": return "lower-lip";
    default: return "open";
  }
}

/** Owns speech playback, engine fallback, and the mouth state the face renders. */
export function useCompanionSpeech(engine: VoiceEngine, headTtsUrl?: string) {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mouthPose, setMouthPose] = useState<MouthPose>("rest");
  const [lipSync, setLipSync] = useState<LipSync>("auto");
  const [notice, setNotice] = useState("");
  const run = useRef(0);

  const browser = useMemo(() => new BrowserSpeechAdapter(), []);
  const headTts = useMemo<SpeechAdapter>(
    () => (headTtsUrl ? new HeadTtsRestAdapter(headTtsUrl) : new HeadTtsCdnAdapter()),
    [headTtsUrl],
  );

  const reset = useCallback(() => {
    setSpeaking(false);
    setLoading(false);
    setMouthPose("rest");
  }, []);

  const stop = useCallback(() => {
    run.current += 1;
    browser.stop();
    headTts.stop();
    reset();
  }, [browser, headTts, reset]);

  useEffect(() => stop, [stop]);

  const speak = useCallback((text: string) => {
    stop();
    const id = run.current;
    setNotice("");
    const live = () => id === run.current;

    const speakWithBrowser = () => {
      setLipSync("auto");
      setLoading(false);
      browser.speak(text, {
        onStart: () => live() && setSpeaking(true),
        onEnd: () => live() && reset(),
        onError: (message) => { if (live()) { reset(); setNotice(message); } },
      });
    };

    if (engine === "browser") { speakWithBrowser(); return; }

    setLoading(true);
    setLipSync("viseme");
    headTts.speak(text, {
      onStart: () => { if (live()) { setLoading(false); setSpeaking(true); } },
      onViseme: (viseme) => { if (live()) setMouthPose(visemeToMouthPose(viseme)); },
      onEnd: () => live() && reset(),
      onError: (message) => {
        if (!live()) return;
        headTts.stop();
        run.current += 1; // retire the HeadTTS run, then continue with the browser voice
        const fallbackId = run.current;
        setNotice(`HeadTTS unavailable, using the browser voice instead. ${message}`);
        setLipSync("auto");
        setLoading(false);
        browser.speak(text, {
          onStart: () => fallbackId === run.current && setSpeaking(true),
          onEnd: () => fallbackId === run.current && reset(),
          onError: (m) => { if (fallbackId === run.current) { reset(); setNotice(m); } },
        });
      },
    });
  }, [engine, browser, headTts, stop, reset]);

  return { speak, stop, speaking, loading, mouthPose, lipSync, notice, clearNotice: () => setNotice("") };
}
