export type MouthPose = "rest" | "closed" | "open" | "wide" | "round" | "teeth" | "lower-lip";
export type Mood = "neutral" | "happy" | "curious" | "concerned" | "thinking" | "alert";
export type LipSync = "auto" | "viseme";

/** Every animated number on the face. All values are eased toward their targets each frame. */
export interface FaceParams {
  lidTop: number;     // 0 open .. 1 shut (upper lid)
  lidBot: number;     // 0 open .. 1 shut (lower lid, gives the happy squint)
  tilt: number;       // lid slant in degrees; + = angry (inner corner down), - = worried
  pupil: number;      // pupil scale
  eyeScale: number;   // whole-eye scale
  browL: number;      // brow vertical offset (negative = higher)
  browR: number;
  browTilt: number;   // same sign convention as `tilt`
  browA: number;      // brow opacity
  mouthW: number;
  smile: number;      // -1 frown .. 1 grin
  open: number;       // mouth opening height
  teeth: number;      // 0..1 share of the opening filled by teeth
  mouthX: number;
  blush: number;
  gx: number;         // gaze -1..1
  gy: number;
  blink: number;      // 0..1, driven by the blink timer
  wink: number;       // right eye only
}

export type MoodPreset = Omit<FaceParams, "gx" | "gy" | "blink" | "wink">;
export type MouthShape = Pick<FaceParams, "mouthW" | "smile" | "open" | "teeth">;

export const MOODS: Record<Mood, MoodPreset> = {
  neutral:   { lidTop: 0,   lidBot: 0,    tilt: 0,   pupil: 1,    eyeScale: 1,    browL: 0,   browR: 0,  browTilt: 0,   browA: 0.28, mouthW: 46,  smile: 0.2,  open: 0,  teeth: 0,    mouthX: 0,   blush: 0 },
  happy:     { lidTop: 0,   lidBot: 0.32, tilt: 0,   pupil: 1.08, eyeScale: 1,    browL: -12, browR: -12, browTilt: -4, browA: 0.85, mouthW: 128, smile: 1,    open: 44, teeth: 0.5,  mouthX: 0,   blush: 0.4 },
  curious:   { lidTop: 0,   lidBot: 0,    tilt: 0,   pupil: 1.12, eyeScale: 1.06, browL: -24, browR: 0,   browTilt: 0,   browA: 0.9,  mouthW: 30,  smile: -0.1, open: 20, teeth: 0,    mouthX: 18,  blush: 0 },
  concerned: { lidTop: 0.12, lidBot: 0,   tilt: -12, pupil: 0.92, eyeScale: 1,    browL: -8,  browR: -8,  browTilt: -16, browA: 0.95, mouthW: 52,  smile: -0.8, open: 0,  teeth: 0,    mouthX: 0,   blush: 0 },
  thinking:  { lidTop: 0.08, lidBot: 0,   tilt: 0,   pupil: 1,    eyeScale: 1,    browL: -20, browR: 2,   browTilt: 0,   browA: 0.9,  mouthW: 34,  smile: 0,    open: 0,  teeth: 0,    mouthX: -20, blush: 0 },
  alert:     { lidTop: 0.5, lidBot: 0.12, tilt: 15,  pupil: 0.85, eyeScale: 1,    browL: 8,   browR: 8,   browTilt: 14,  browA: 1,    mouthW: 40,  smile: -0.55, open: 0, teeth: 0,    mouthX: 0,   blush: 0 },
};

/** Viseme-style mouth shapes used while speaking. */
export const POSES: Record<Exclude<MouthPose, "rest">, MouthShape> = {
  closed:     { mouthW: 54, smile: 0.05, open: 0,  teeth: 0 },
  open:       { mouthW: 64, smile: 0.1,  open: 46, teeth: 0.28 },
  wide:       { mouthW: 98, smile: 0.35, open: 20, teeth: 0.8 },
  round:      { mouthW: 38, smile: 0,    open: 42, teeth: 0 },
  teeth:      { mouthW: 86, smile: 0.2,  open: 16, teeth: 1 },
  "lower-lip": { mouthW: 72, smile: 0,   open: 12, teeth: 1 },
};

/** Per-parameter easing speed (higher = snappier). */
export const RATES: Partial<Record<keyof FaceParams, number>> = {
  blink: 38, gx: 13, gy: 13,
  mouthW: 20, open: 24, smile: 16, teeth: 20, mouthX: 10,
  lidTop: 12, lidBot: 12, tilt: 9, browL: 11, browR: 11, browTilt: 9,
  wink: 30
};


export const DEFAULT_RATE = 8;

export function initialParams(mood: Mood): FaceParams {
  return { ...MOODS[mood], gx: 0, gy: 0, blink: 0, wink: 0};
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface MouthGeometry {
  d: string;
  top: number;     // y of the upper lip's middle
  bottom: number;  // y of the lower lip's middle
  halfWidth: number;
}

/** Builds a smooth mouth outline: corners lift with `smile`, the lips part with `open`. */
export function mouthGeometry(width: number, smile: number, open: number): MouthGeometry {
  const hw = Math.max(width, 4) / 2;
  const corner = -smile * 16;
  const top = -open * 0.5;
  const bottom = open * 0.5 + Math.max(smile, 0) * open * 0.22;
  const ctrlTop = (top - 0.25 * corner) / 0.75;
  const ctrlBottom = (bottom - 0.25 * corner) / 0.75;
  const k = clamp(0.35 + (open / Math.max(width, 1)) * 1.1, 0.35, 1.15);
  const cx = hw * k;
  const d =
    `M ${-hw} ${corner} C ${-cx} ${ctrlTop} ${cx} ${ctrlTop} ${hw} ${corner} ` +
    `C ${cx} ${ctrlBottom} ${-cx} ${ctrlBottom} ${-hw} ${corner} Z`;
  return { d, top, bottom, halfWidth: hw };
}


export const IDLE_GESTURES: { ms: number; set: Partial<FaceParams> }[] = [
  { ms: 1900, set: { smile: 0.8, mouthW: 90, lidBot: 0.15, browA: 0.7, browL: -8, browR: -8, blush: 0.3 } },                       // content smile
  { ms: 2300, set: { open: 70, mouthW: 52, smile: 0, lidTop: 0.55, browA: 0.6, browL: -10, browR: -10 } },                          // yawn
  { ms: 1100, set: { wink: 1, smile: 0.8, mouthW: 70, blush: 0.3, browR: -14 } },                                                   // wink
  { ms: 2200, set: { mouthW: 24, open: 22, smile: 0, browL: -14, browR: -6, browA: 0.8, gx: -0.3, gy: -0.5 } },                     // whistle
  { ms: 2600, set: { lidTop: 0.65, browL: 6, browR: 6, browA: 0.5, mouthW: 30, gy: 0.4 } },                                         // sleepy
  { ms: 1300, set: { eyeScale: 1.15, pupil: 0.8, browL: -26, browR: -26, browA: 1, open: 38, mouthW: 34, smile: 0 } },              // surprised
  { ms: 1900, set: { mouthX: 12, smile: 0.7, mouthW: 56, browL: -16, browR: 2, browA: 0.8 } },                                      // smirk
];