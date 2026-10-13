import { useEffect, useId, useRef, useState } from "react";
import {
  DEFAULT_RATE,
  IDLE_GESTURES,
  initialParams,
  MOODS,
  mouthGeometry,
  POSES,
  RATES,
  type FaceParams,
  type LipSync,
  type Mood,
  type MouthPose,
} from "./faceModel";
import "./face-companion.css";

export interface CompanionFaceProps {
  isSpeaking?: boolean;
  mouthPose?: MouthPose;
  /** "viseme" = follow mouthPose from a TTS engine; "auto" = the face flaps its own lips while speaking. */
  lipSync?: LipSync;
  mood?: Mood;
  label?: string;
}

const EYE_X = [118, 282] as const;
const EYE_Y = 230;
const EYE_RX = 56;
const EYE_RY = 60;
const PUPIL_R = 24;
const BROW_Y = 150;
const MOUTH = { x: 200, y: 376 };

const PARAM_KEYS = Object.keys(initialParams("neutral")) as (keyof FaceParams)[];
const TALK_POSES: Exclude<MouthPose, "rest">[] = ["open", "wide", "round", "closed", "open", "teeth", "open", "closed"];

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** An expressive, mood-colored face. Eyes track the pointer, blink, and wander when idle; the mouth lip-syncs. */
export default function CompanionFace({
  isSpeaking = false,
  mouthPose = "rest",
  lipSync = "auto",
  mood = "neutral",
  label = "Face Companion",
}: CompanionFaceProps) {
  const uid = useId().replace(/:/g, "");
  const stageRef = useRef<HTMLDivElement>(null);
  const current = useRef<FaceParams>(initialParams(mood));
  const target = useRef<FaceParams>(initialParams(mood));
  const moodRef = useRef<Mood>(mood);
  const lastPointer = useRef(0);
  const [p, setP] = useState<FaceParams>(() => initialParams(mood));
  const [autoPose, setAutoPose] = useState<Exclude<MouthPose, "rest">>("closed");

  // Effective mouth pose: engine-provided visemes win, otherwise synthesize talking while speaking.
  const talking = isSpeaking && lipSync === "auto" && mouthPose === "rest";
  const pose: MouthPose = talking ? autoPose : mouthPose;

  /* ---- Mood + mouth targets ---- */
  useEffect(() => {
    moodRef.current = mood;
    const preset = MOODS[mood];
    const next: Partial<FaceParams> = { ...preset };
    if (pose !== "rest") {
      const shape = POSES[pose];
      next.mouthW = shape.mouthW;
      next.open = shape.open;
      next.teeth = shape.teeth;
      next.smile = preset.smile * 0.35 + shape.smile;
      next.mouthX = preset.mouthX * 0.25;
    }
    Object.assign(target.current, next);
  }, [mood, pose]);

  /* ---- Automatic lip flap for engines without viseme data ---- */
  useEffect(() => {
    if (!talking) return;
    let last = -1;
    const id = window.setInterval(() => {
      let i = Math.floor(Math.random() * TALK_POSES.length);
      if (i === last) i = (i + 1) % TALK_POSES.length;
      last = i;
      setAutoPose(TALK_POSES[i]);
    }, 125);
    return () => { window.clearInterval(id); setAutoPose("closed"); };
  }, [talking]);

  /* ---- Easing loop ---- */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let changed = false;
      for (const key of PARAM_KEYS) {
        const diff = target.current[key] - current.current[key];
        if (Math.abs(diff) < 0.001) {
          if (diff !== 0) { current.current[key] = target.current[key]; changed = true; }
          continue;
        }
        current.current[key] += diff * (1 - Math.exp(-(RATES[key] ?? DEFAULT_RATE) * dt));
        changed = true;
      }
      if (changed) setP({ ...current.current });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---- Blinking ---- */
  useEffect(() => {
    let timer = 0;
    const blink = (double: boolean) => {
      target.current.blink = 1;
      timer = window.setTimeout(() => {
        target.current.blink = 0;
        if (double) timer = window.setTimeout(() => blink(false), 160);
        else schedule();
      }, 120);
    };
    const schedule = () => {
      const wait = moodRef.current === "alert" ? rand(3500, 7000) : rand(2200, 5200);
      timer = window.setTimeout(() => blink(Math.random() < 0.18), wait);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  const speakingRef = useRef(isSpeaking);
useEffect(() => { speakingRef.current = isSpeaking; }, [isSpeaking]);

useEffect(() => {
  if (prefersReducedMotion()) return;
  let timer = 0;
  let restore = 0;
  const next = () => {
    timer = window.setTimeout(() => {
      const idle = moodRef.current === "neutral" && !speakingRef.current && performance.now() - lastPointer.current > 4000;
      if (idle) {
        const gesture = IDLE_GESTURES[Math.floor(Math.random() * IDLE_GESTURES.length)];
        Object.assign(target.current, gesture.set);
        restore = window.setTimeout(() => {
          target.current.wink = 0;
          if (moodRef.current === "neutral" && !speakingRef.current) Object.assign(target.current, MOODS.neutral);
        }, gesture.ms);
      }
      next();
    }, rand(5000, 9000));
  };
  next();
  return () => { window.clearTimeout(timer); window.clearTimeout(restore); };
}, []);

  /* ---- Gaze: follow the pointer, otherwise wander ---- */
  useEffect(() => {
    const aimAt = (clientX: number, clientY: number) => {
      const box = stageRef.current?.getBoundingClientRect();
      if (!box) return;
      const reach = Math.max(180, Math.min(window.innerWidth, window.innerHeight) * 0.45);
      let x = (clientX - (box.left + box.width / 2)) / reach;
      let y = (clientY - (box.top + box.height * 0.42)) / reach;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      target.current.gx = x;
      target.current.gy = y;
      lastPointer.current = performance.now();
    };
    const onMove = (event: PointerEvent) => aimAt(event.clientX, event.clientY);
    const onLeave = () => { lastPointer.current = 0; };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    const reduced = prefersReducedMotion();
    const wander = window.setInterval(() => {
      if (performance.now() - lastPointer.current < 3500) return;
      const m = moodRef.current;
      if (m === "thinking") {
        target.current.gx = -0.55 + rand(-0.12, 0.12);
        target.current.gy = -0.8 + rand(-0.1, 0.1);
      } else if (m === "alert") {
        target.current.gx = rand(-0.15, 0.15);
        target.current.gy = rand(0, 0.15);
      } else if (m === "concerned") {
        target.current.gx = rand(-0.4, 0.4);
        target.current.gy = rand(0.2, 0.5);
      } else if (!reduced) {
        target.current.gx = rand(-0.55, 0.55);
        target.current.gy = rand(-0.3, 0.3);
      } else {
        target.current.gx = 0;
        target.current.gy = 0;
      }
    }, 1700);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.clearInterval(wander);
    };
  }, []);

  /* ---- Render ---- */
  const mouth = mouthGeometry(p.mouthW, p.smile, p.open);
  const teethHeight = Math.min(p.open, p.open * p.teeth + 1);
  const tongueAlpha = Math.min(1, Math.max(0, (p.open - 14) / 18));
  // const lidTop = p.lidTop + (1 - p.lidTop) * p.blink;
  // const edgeTop = -EYE_RY - 8 + lidTop * (EYE_RY * 2 + 14);
  const lidShut = (side: number) => p.lidTop + (1 - p.lidTop) * (side === 1 ? Math.max(p.blink, p.wink) : p.blink);
const edgeTopFor = (side: number) => -EYE_RY - 8 + lidShut(side) * (EYE_RY * 2 + 14);
  const edgeBottom = EYE_RY + 8 - p.lidBot * (EYE_RY * 2 + 14) * 0.6;
  const pupilR = PUPIL_R * p.pupil;
  const reachX = EYE_RX - pupilR - 5;
  const reachY = EYE_RY - pupilR - 5;
  const px = p.gx * reachX;
  const py = p.gy * reachY;
  const shiftX = p.gx * 7;
  const shiftY = p.gy * 4;

  return (
    <div className="fc-face-stage" data-mood={mood} ref={stageRef}>
      <div className={`fc-face ${isSpeaking ? "fc-is-speaking" : ""}`} role="img" aria-label={`${label}, feeling ${mood}${isSpeaking ? ", speaking" : ""}`}>
        <svg className="fc-face-svg" viewBox="0 0 400 560" aria-hidden="true">
          <defs>
            <filter id={`${uid}-soft`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" /></filter>
            <filter id={`${uid}-soft-sm`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" /></filter>
            <clipPath id={`${uid}-eye`}><ellipse cx="0" cy="0" rx={EYE_RX} ry={EYE_RY} /></clipPath>
            <clipPath id={`${uid}-mouth`}><path d={mouth.d} /></clipPath>
          </defs>

          <g transform={`translate(${shiftX.toFixed(2)} ${shiftY.toFixed(2)})`}>
            {/* Soft embossed sockets, like the 3D reference */}
            {EYE_X.map((cx) => (
              <g key={`socket-${cx}`}>
                <ellipse className="fc-socket-shadow" cx={cx} cy={EYE_Y + 8} rx={EYE_RX + 14} ry={EYE_RY + 12} filter={`url(#${uid}-soft)`} />
                <ellipse className="fc-socket-light" cx={cx} cy={EYE_Y - 6} rx={EYE_RX + 10} ry={EYE_RY + 8} filter={`url(#${uid}-soft-sm)`} />
              </g>
            ))}

            {/* Cheeks */}
            <ellipse className="fc-blush" cx="58" cy="322" rx="30" ry="17" opacity={p.blush} />
            <ellipse className="fc-blush" cx="342" cy="322" rx="30" ry="17" opacity={p.blush} />

            {/* Brows */}
            {EYE_X.map((cx, side) => {
              const sign = side === 0 ? 1 : -1;
              const dy = side === 0 ? p.browL : p.browR;
              return (
                <path
                  key={`brow-${cx}`}
                  className="fc-brow"
                  d="M -30 5 Q 0 -9 30 5"
                  opacity={p.browA}
                  transform={`translate(${cx} ${BROW_Y + dy}) rotate(${(p.browTilt * sign).toFixed(2)})`}
                />
              );
            })}

            {/* Eyes */}
            {EYE_X.map((cx, side) => {
              const sign = side === 0 ? 1 : -1;
              const lidTop = lidShut(side);
              const edgeTop = edgeTopFor(side);
              return (
                <g key={`eye-${cx}`} transform={`translate(${cx} ${EYE_Y}) scale(${p.eyeScale.toFixed(3)})`}>
                  <ellipse className="fc-eye-white" cx="0" cy="0" rx={EYE_RX} ry={EYE_RY} />
                  <g clipPath={`url(#${uid}-eye)`}>
                    <g>
                      <circle className="fc-pupil" cx={px} cy={py} r={pupilR} />
                      <ellipse className="fc-glint" cx={px - pupilR * 0.34} cy={py - pupilR * 0.38} rx={pupilR * 0.3} ry={pupilR * 0.34} />
                      <circle className="fc-glint" cx={px + pupilR * 0.38} cy={py + pupilR * 0.4} r={pupilR * 0.13} />
                    </g>
                    <g transform={`rotate(${(p.tilt * sign).toFixed(2)})`}>
                      <rect className="fc-lid" x="-140" y="-320" width="280" height={edgeTop + 320} />
                      <line className="fc-lid-edge" x1="-140" x2="140" y1={edgeTop} y2={edgeTop} opacity={Math.min(1, lidTop * 14)} />
                    </g>
                    <g>
                      <rect className="fc-lid" x="-140" y={edgeBottom} width="280" height={320 - edgeBottom} />
                      <line className="fc-lid-edge fc-lid-edge-soft" x1="-140" x2="140" y1={edgeBottom} y2={edgeBottom} opacity={Math.min(1, p.lidBot * 14)} />
                    </g>
                  </g>
                  <ellipse className="fc-eye-rim" cx="0" cy="0" rx={EYE_RX} ry={EYE_RY} />
                </g>
              );
            })}

            {/* Mouth */}
            <g transform={`translate(${MOUTH.x + p.mouthX} ${MOUTH.y}) scale(1.25)`}>
              <path className="fc-mouth-inside" d={mouth.d} />
              <g clipPath={`url(#${uid}-mouth)`}>
                <rect className="fc-teeth" x={-mouth.halfWidth - 4} y={mouth.top - 18} width={mouth.halfWidth * 2 + 8} height={teethHeight + 18} />
                <ellipse className="fc-tongue" cx="0" cy={mouth.bottom - 4} rx={Math.max(6, mouth.halfWidth * 0.34)} ry={Math.max(2, p.open * 0.3)} opacity={tongueAlpha} />
              </g>
              <path className="fc-mouth-line" d={mouth.d} />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
