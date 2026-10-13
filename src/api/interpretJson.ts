import type { Mood } from "../components/faceModel";

export interface InterpretedResponse {
  title: string;
  summary: string;      // what the companion says out loud
  details: string[];    // full readout for the task card
  healthy: boolean | null;
  mood?: Mood;          // optional override for the face
}

type Obj = Record<string, unknown>;
type Level = "good" | "bad" | "warn" | "unknown";
interface Part { spoken: string[]; details: string[]; healthy: boolean | null; mood: Mood }
interface Component { name: string; level: Level; word: string; note?: string }
interface ApiError { code?: string; message?: string; fields: { field: string; messages: string[] }[] }
interface Envelope { success: boolean | null; message?: string; error?: ApiError; data: unknown; pagination?: Obj }

/* ================= vocabulary ================= */

const GOOD = new Set(["ok", "okay", "healthy", "up", "running", "online", "active", "available", "ready", "pass", "passed", "passing", "success", "successful", "operational", "alive", "connected", "green", "true", "200", "completed", "complete", "done", "finished"]);
const BAD = new Set(["error", "errored", "fail", "failed", "failing", "unhealthy", "down", "offline", "critical", "unavailable", "dead", "disconnected", "red", "false", "timeout", "fatal", "500", "502", "503", "504", "cancelled", "canceled"]);
const WARN = new Set(["degraded", "warning", "warn", "partial", "slow", "unstable", "limited", "yellow", "maintenance"]);
const BUSY = new Set(["processing", "pending", "queued", "started", "starting", "in_progress", "inprogress", "preparing", "loading", "initializing", "initialising", "waiting", "building"]);

const STATUS_KEYS = ["status", "state", "health", "healthy", "ok", "success", "up", "alive", "ready", "connected"];
const COLLECTION_KEYS = ["checks", "services", "components", "dependencies", "subsystems", "probes", "integrations"];
const ENVELOPE_KEYS = ["data", "result", "results", "payload", "response", "body"];
const LIST_KEYS = ["items", "results", "records", "rows", "entries", "list"];
const LABEL_KEYS = ["name", "title", "username", "displayName", "label", "fullName", "filename", "slug"];
const LONGTEXT_KEYS = ["body", "description", "content", "text", "bio", "summary", "notes"];
const SECRET = /token|secret|password|passwd|apikey|authorization|jwt|cookie|session|credential|private/i;

const ACRONYMS: Record<string, string> = {
  wasm: "WASM", webgl: "WebGL", webgl2: "WebGL2", webgpu: "WebGPU", api: "API", id: "ID", url: "URL", ui: "UI",
  gpu: "GPU", cpu: "CPU", ssl: "SSL", tls: "TLS", db: "DB", sql: "SQL", jwt: "JWT", http: "HTTP", https: "HTTPS",
  ip: "IP", ram: "RAM", os: "OS", gb: "GB", gbc: "GBC", gba: "GBA", nes: "NES", snes: "SNES", n64: "N64",
  nds: "NDS", psx: "PSX", ps1: "PS1", gg: "GG", sms: "SMS", pce: "PCE",
};

/** Likely fixes for well-known error codes. */
const ERROR_HINTS: [RegExp, string][] = [
  [/not.?found|404/, "Check the id or name you asked for."],
  [/unauth|auth.?required|api.?key|credential|token|login|401|expired/, "Sign in again or check the credentials, then retry."],
  [/valid|invalid|unprocessable|422|bad.?request|400/, "Correct the highlighted fields and try again."],
  [/forbid|permission|denied|403/, "This account may not have permission for that."],
  [/rate|throttle|too.?many|429/, "Wait a moment before trying again."],
  [/timeout|timed.?out|504/, "The server was too slow. Try again shortly."],
  [/conflict|duplicate|exists|409/, "Something with that identity already exists."],
  [/unavailable|maintenance|503|internal|server|500/, "This looks like a server-side problem, not your request."],
];

/* ================= small helpers ================= */

const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = (s: string) => { const t = s.trim(); return t ? (/[.!?…]$/.test(t) ? t : `${t}.`) : ""; };
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const clip = (s: string, n: number) => { const w = words(s); return w.length > n ? `${w.slice(0, n).join(" ")}…` : w.join(" "); };

const NUMBER_WORDS = ["zero", "one", "two", "three"];
function pluralNoun(noun: string, n: number): string {
  if (n === 1) return noun;
  return noun.endsWith("y") && !/[aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : noun.endsWith("s") ? noun : `${noun}s`;
}
const count = (n: number, noun: string) => `${n.toLocaleString()} ${pluralNoun(noun, n)}`;

function humanize(key: string): string {
  const parts = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().split(/\s+/);
  return parts.map((w, i) => ACRONYMS[w.toLowerCase()] ?? (i === 0 ? cap(w.toLowerCase()) : w.toLowerCase())).join(" ");
}
const lower = (s: string) => (ACRONYMS[s.toLowerCase()] ? s : s.charAt(0).toLowerCase() + s.slice(1));
const sys = (v: unknown) => { const s = String(v); return ACRONYMS[s.toLowerCase()] ?? s; };
const codeWords = (code: string) => code.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();

function joinList(items: string[], max = 5): string {
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  if (extra > 0) shown.push(`${extra} more`);
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

function pick(obj: Obj, names: string[]): { key: string; value: unknown } | null {
  const wanted = new Set(names.map(norm));
  for (const key of Object.keys(obj)) if (wanted.has(norm(key))) return { key, value: obj[key] };
  return null;
}
function pickDeep(obj: Obj, names: string[]): { key: string; value: unknown } | null {
  const direct = pick(obj, names);
  if (direct) return direct;
  for (const value of Object.values(obj)) if (isObj(value)) { const f = pick(value, names); if (f) return f; }
  return null;
}
const pickStr = (obj: Obj, names: string[]): string | undefined => {
  const f = pick(obj, names);
  return f && typeof f.value === "string" && f.value.trim() ? f.value.trim() : undefined;
};

/* ================= time & units ================= */

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400), hours = Math.floor((total % 86400) / 3600), minutes = Math.floor((total % 3600) / 60);
  if (!days && !hours && !minutes) return count(total, "second");
  const parts: string[] = [];
  if (days) parts.push(count(days, "day"));
  if (hours) parts.push(count(hours, "hour"));
  if (minutes && parts.length < 2) parts.push(count(minutes, "minute"));
  return parts.slice(0, 2).join(" and ");
}
function formatMs(ms: number): string {
  if (ms < 1) return "under a millisecond";
  return ms < 1000 ? `${Math.round(ms)} milliseconds` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} seconds`;
}
const formatBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} gigabytes` : `${Math.round(b / 1024 ** 2)} megabytes`);

function relative(date: Date): string | null {
  const diff = (Date.now() - date.getTime()) / 1000;
  const abs = Math.abs(diff);
  const text = abs < 45 ? "just now" : abs < 3600 ? count(Math.round(abs / 60), "minute") : abs < 86400 ? count(Math.round(abs / 3600), "hour") : count(Math.round(abs / 86400), "day");
  if (text === "just now") return text;
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}
function asDate(v: unknown): Date | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
}

/* ================= status classification ================= */

function levelOf(value: unknown): Level {
  if (typeof value === "boolean") return value ? "good" : "bad";
  if (typeof value === "number") return value >= 200 && value < 300 ? "good" : value >= 400 ? "bad" : "unknown";
  if (typeof value === "string") {
    const s = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return GOOD.has(s) ? "good" : BAD.has(s) ? "bad" : WARN.has(s) ? "warn" : "unknown";
  }
  if (isObj(value)) {
    for (const key of STATUS_KEYS) {
      const f = pick(value, [key]);
      if (f && typeof f.value !== "object") { const l = levelOf(f.value); if (l !== "unknown") return l; }
    }
  }
  return "unknown";
}
const isBusy = (v: unknown) => typeof v === "string" && BUSY.has(v.trim().toLowerCase().replace(/[\s-]+/g, "_"));

function latencyOf(obj: Obj): string | null {
  const f = pick(obj, ["latencyMs", "latency", "responseTimeMs", "responseTime", "durationMs", "duration", "ping", "elapsedMs"]);
  const ms = f ? num(f.value) : null;
  return ms !== null && ms >= 0 ? formatMs(ms) : null;
}
function noteOf(value: unknown): string | undefined {
  if (typeof value === "string") { const s = value.trim(); return s && levelOf(s) === "unknown" && !isBusy(s) ? s : undefined; }
  if (!isObj(value)) return undefined;
  for (const key of ["error", "message", "reason", "detail", "description"]) {
    const f = pick(value, [key]);
    if (f && typeof f.value === "string" && f.value.trim()) return f.value.trim();
    if (f && isObj(f.value)) { const inner = noteOf(f.value); if (inner) return inner; }
  }
  const l = latencyOf(value);
  return l ? `responding in ${l}` : undefined;
}

/* ================= envelope parsing ================= */

function parseFields(source: unknown): ApiError["fields"] {
  const out: ApiError["fields"] = [];
  const toMessages = (v: unknown): string[] =>
    Array.isArray(v) ? v.flatMap(toMessages) : typeof v === "string" ? [v] : isObj(v) ? [noteOf(v) ?? ""].filter(Boolean) : [];
  if (isObj(source)) {
    for (const [field, v] of Object.entries(source)) { const m = toMessages(v); if (m.length) out.push({ field, messages: m }); }
  } else if (Array.isArray(source)) {
    for (const item of source) {
      if (!isObj(item)) continue;
      const field = pickStr(item, ["field", "path", "param", "name", "property"]);
      const m = toMessages(pick(item, ["message", "msg", "error", "reason"])?.value);
      if (field && m.length) out.push({ field, messages: m });
    }
  }
  return out;
}

function parseError(value: unknown, outer: Obj): ApiError | undefined {
  if (typeof value === "string" && value.trim()) return { message: value.trim(), fields: [], code: pickStr(outer, ["code", "errorCode"]) };
  if (Array.isArray(value)) {
    const fields = parseFields(value);
    const first = value.find((v): v is string => typeof v === "string");
    if (fields.length || first) return { message: first ?? pickStr(outer, ["message"]), fields, code: pickStr(outer, ["code"]) };
  }
  if (isObj(value)) {
    const fieldsSource = pick(value, ["fields", "errors", "details", "violations", "issues"])?.value;
    return {
      code: pickStr(value, ["code", "type", "name"]) ?? pickStr(outer, ["code"]),
      message: pickStr(value, ["message", "msg", "detail", "reason", "description"]) ?? pickStr(outer, ["message"]),
      fields: parseFields(fieldsSource),
    };
  }
  return undefined;
}

function parseEnvelope(payload: Obj): Envelope {
  const flag = pick(payload, ["success", "ok"]);
  let success: boolean | null = typeof flag?.value === "boolean" ? flag.value : null;
  const status = pick(payload, ["status"]);
  if (success === null && typeof status?.value === "string") {
    const l = levelOf(status.value);
    if (l === "bad" && /^(error|fail|failed)$/i.test(status.value)) success = false;
  }
  const message = pickStr(payload, ["message", "msg"]);
  const errorField = pick(payload, ["error", "errors"]);
  let error = errorField ? parseError(errorField.value, payload) : undefined;
  if (!error && success === false) error = { message, fields: [], code: pickStr(payload, ["code", "errorCode"]) };

  const found = pick(payload, ENVELOPE_KEYS);
  // "body", "response" and "payload" are often ordinary text fields (a post's body), so only unwrap them for objects/arrays.
  const dataField = found && (typeof found.value === "object" || ["data", "result", "results"].includes(norm(found.key))) ? found : null;
  const pag = pick(payload, ["pagination", "paging", "pageInfo", "page_info"])?.value;
  const meta = pick(payload, ["meta"])?.value;
  const pagination = isObj(pag) ? pag : isObj(meta) && pick(meta, ["total", "page", "totalPages"]) ? meta : undefined;

  if (dataField && dataField.value !== undefined) return { success, message, error, data: dataField.value, pagination };

  // No wrapper: treat the remaining fields as the data (post, health-check, ...).
  const consumed = new Set(["success", "ok", "message", "msg", "error", "errors", "pagination", "paging", "meta"]);
  const hasEnvelope = flag !== null || errorField !== null || (message !== undefined && Object.keys(payload).length <= 3);
  if (hasEnvelope) {
    const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => !consumed.has(k.toLowerCase())));
    return { success, message, error, data: Object.keys(rest).length ? rest : undefined, pagination };
  }
  return { success, message: undefined, error, data: payload, pagination };
}

/* ================= nouns & entities ================= */

function idNoun(id: unknown): string | null {
  const m = typeof id === "string" ? /^([a-z]+)[_-]\w+/i.exec(id) : null;
  return m ? m[1].toLowerCase() : null;
}
function nounFor(obj: Obj): string | null {
  const id = pick(obj, ["id"])?.value;
  const fromId = idNoun(id);
  if (fromId) return fromId;
  for (const key of Object.keys(obj)) { const m = /^([a-z]+)Id$/.exec(key); if (m && !["user", "album", "owner", "author", "parent", "account", "order"].includes(m[1])) return m[1]; }
  const keys = new Set(Object.keys(obj).map(norm));
  if (keys.has("url") && keys.has("thumbnailurl")) return "photo";
  if (keys.has("title") && keys.has("body")) return "post";
  if (keys.has("username") || keys.has("email")) return "user";
  if (keys.has("title") && keys.has("completed")) return "task";
  return null;
}
const isNumericId = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v));
const FK_PREP: Record<string, string> = { user: "by", author: "by", owner: "by", game: "for", order: "for", account: "for", album: "in", post: "on", parent: "under" };

function formatScalar(key: string, value: unknown): string {
  if (typeof value === "number") return /percent|progress|rate/i.test(key) && value <= 100 ? `${value}%` : value.toLocaleString();
  if (typeof value === "boolean") return value ? "yes" : "no";
  const s = String(value);
  const d = asDate(s);
  if (d) return relative(d) ?? d.toLocaleString();
  return /system|platform|console/i.test(key) ? sys(s) : s;
}

/** One short spoken fragment per field, in payload order (status first). */
function phraseFor(key: string, value: unknown): string | null {
  const k = norm(key);
  if (typeof value === "string" && (/^https?:\/\//.test(value) || value.startsWith("/"))) return null;
  if (typeof value === "string" && value.length > 90) return null;
  if (k === "id") return null;
  if (["status", "state"].includes(k)) return typeof value === "string" ? value.replace(/[_-]/g, " ").toLowerCase() : null;
  if (!isScalar(value)) return null;
  if (["system", "platform", "console"].includes(k)) return `on ${sys(value)}`;
  if (["runtime", "engine", "emulator", "core"].includes(k)) return `using ${value}`;
  if (k === "slot") return `slot ${value}`;
  if (["type", "kind", "category", "mode", "role"].includes(k)) return String(value).toLowerCase();
  if (/at$/.test(k) && asDate(value)) {
    const d = asDate(value)!;
    const verb = /^created|^added/.test(k) ? "created" : /^updated|^modified/.test(k) ? "updated" : /^expire/.test(k) ? "expires" : humanize(key.replace(/At$/, "")).toLowerCase();
    const rel = relative(d) ?? d.toLocaleString();
    return `${verb} ${verb === "expires" ? rel : rel}`;
  }
  const fk = /^([a-z]+)Id$/.exec(key);
  if (fk) return `${FK_PREP[fk[1]] ?? "for"} ${fk[1] === "user" || fk[1] === "author" || fk[1] === "owner" || fk[1] === "album" ? `${fk[1]} ` : ""}${value}`;
  if (typeof value === "boolean") return value ? humanize(key).toLowerCase() : `not ${humanize(key).toLowerCase()}`;
  return `${humanize(key).toLowerCase()} ${formatScalar(key, value)}`;
}

function joinPhrases(parts: string[]): string {
  return parts.reduce((acc, p, i) => (i === 0 ? p : /^(for|on|using|by|in|under) /.test(p) ? `${acc} ${p}` : `${acc}, ${p}`), "");
}

function interpretEntity(data: Obj, endpointName: string, ok: boolean | null): Part {
  const details: string[] = [];
  const idF = pick(data, ["id"]);
  const label = pickStr(data, LABEL_KEYS);
  const noun = nounFor(data);
  const numeric = idF ? isNumericId(idF.value) : false;

  const entries = Object.entries(data);
  const phrases: string[] = [];
  const longSpoken: string[] = [];
  const extras: string[] = [];

  // status first
  const statusF = pick(data, ["status", "state"]);
  if (statusF && typeof statusF.value === "string") phrases.push(String(phraseFor(statusF.key, statusF.value)));

  for (const [key, value] of entries) {
    const k = norm(key);
    if (k === "id" || LABEL_KEYS.map(norm).includes(k) && value === label || (statusF && key === statusF.key)) {
      if (k === "id") details.push(`ID: ${String(value)}`);
      else if (value === label) details.push(`${humanize(key)}: ${String(value)}`);
      else if (statusF && key === statusF.key) details.push(`${humanize(key)}: ${String(value)}`);
      continue;
    }
    if (SECRET.test(key)) { details.push(`${humanize(key)}: received (hidden)`); continue; }

    if (typeof value === "string" && LONGTEXT_KEYS.includes(key.toLowerCase())) {
      const w = words(value).length;
      details.push(`${humanize(key)}: ${clip(value, 18)}`);
      if (w > 12) longSpoken.push(`Its ${key.toLowerCase()} runs about ${w} words.`);
      else if (w) longSpoken.push(`${cap(key.toLowerCase())}: ${value.trim()}`);
      continue;
    }
    if (Array.isArray(value)) {
      const strs = value.filter((v): v is string => typeof v === "string");
      details.push(`${humanize(key)} (${value.length}): ${strs.length ? joinList(strs.map((s) => (/system/i.test(key) ? sys(s) : s)), 8) : "…"}`);
      if (value.length) extras.push(`${count(value.length, lower(humanize(key)).replace(/s$/, ""))} listed`);
      continue;
    }
    if (isObj(value)) { details.push(`${humanize(key)}: ${Object.keys(value).slice(0, 6).join(", ")}`); continue; }
    if (!isScalar(value)) continue;

    const shown = typeof value === "string" && (/^https?:\/\//.test(value) || value.startsWith("/")) ? "link available" : formatScalar(key, value);
    details.push(`${humanize(key)}: ${shown}`);
    const p = phraseFor(key, value);
    if (p) phrases.push(p);
  }

  const spokenPhrases = phrases.slice(0, 5);
  let head: string | undefined;
  if (label && numeric && noun) head = `${cap(noun)} ${String(idF?.value)}`;
  else if (label) head = label;
  else if (noun && idF) head = `${cap(noun)} ${String(idF.value)}`;

  let line = "";
  if (head) line = `${head}${spokenPhrases.length ? (/^(for|on|using|by|in|under) /.test(spokenPhrases[0]) ? " " : ", ") + joinPhrases(spokenPhrases) : ""}`;
  else if (spokenPhrases.length) line = cap(joinPhrases(spokenPhrases));
  if (label && numeric && noun && head) line += `: “${clip(label, 8)}”`;

  const spoken: string[] = [];
  if (line) spoken.push(sentence(line));
  spoken.push(...longSpoken.slice(0, 1), ...extras.slice(0, 2).map(sentence));
  if (!spoken.length) spoken.push(`${endpointName} returned ${Object.keys(data).length ? `fields: ${Object.keys(data).slice(0, 6).join(", ")}` : "an empty object"}.`);
  if (!details.length) details.push("The object is empty.");

  const level = statusF ? levelOf(statusF.value) : "unknown";
  const busy = statusF ? isBusy(statusF.value) : false;
  const healthy = busy ? null : level === "bad" ? false : level === "good" ? true : ok === true ? true : null;
  const mood: Mood = busy ? "thinking" : level === "bad" ? "alert" : healthy ? "happy" : "curious";
  return { spoken, details, healthy, mood };
}

/* ================= specialised detectors ================= */

function interpretAuth(data: Obj): Part | null {
  const tokenKey = Object.keys(data).find((k) => /^(access)?_?token$|jwt|accesstoken/i.test(k));
  const user = pick(data, ["user", "account", "profile"])?.value;
  if (!tokenKey) return null;
  const details: string[] = [];
  const spoken: string[] = [];
  const u = isObj(user) ? user : data;
  const username = pickStr(u, ["username", "name", "email", "displayName"]);
  const uid = pick(u, ["id"])?.value;
  if (username) { spoken.push(`Signed in as ${username}.`); details.push(`User: ${username}${uid !== undefined ? ` (${String(uid)})` : ""}`); }
  else spoken.push("Authentication succeeded.");
  details.push("Access token: received (hidden)");
  const refresh = Object.keys(data).some((k) => /refresh/i.test(k));
  if (refresh) details.push("Refresh token: received (hidden)");
  const exp = pick(data, ["expiresIn", "expires_in", "ttl"]);
  const n = exp ? num(exp.value) : null;
  let valid = "";
  if (n !== null) { const secs = n > 10_000_000 ? n / 1000 : n; valid = formatDuration(secs); details.push(`Expires in: ${valid}`); }
  const expAt = pick(data, ["expiresAt", "expires_at"]);
  const d = expAt ? asDate(expAt.value) : null;
  if (d) { valid = relative(d) ?? ""; details.push(`Expires: ${valid}`); }
  spoken.push(`An access token was issued${refresh ? " along with a refresh token" : ""}${n !== null ? `, valid for ${valid}` : ""}.`);
  return { spoken, details, healthy: true, mood: "happy" };
}

function interpretJob(data: Obj): Part | null {
  const idF = pick(data, ["jobId", "taskId", "operationId", "job_id"]);
  const statusF = pick(data, ["status", "state"]);
  if (!idF || !statusF || typeof statusF.value !== "string") return null;
  const status = statusF.value.replace(/[_-]/g, " ").toLowerCase();
  const pf = pick(data, ["progress", "percent", "percentage"]);
  let pct = pf ? num(pf.value) : null;
  if (pct !== null && pct <= 1 && pct > 0) pct *= 100;
  const level = levelOf(statusF.value);
  const busy = isBusy(statusF.value);
  const details = [`Job: ${String(idF.value)}`, `Status: ${status}`];
  if (pct !== null) details.push(`Progress: ${Math.round(pct)}%`);
  const eta = pick(data, ["eta", "remainingSeconds", "estimatedSeconds"]);
  const etaN = eta ? num(eta.value) : null;
  if (etaN !== null) details.push(`Estimated time left: ${formatDuration(etaN)}`);
  const resultUrl = pickStr(data, ["resultUrl", "url", "location"]);
  if (resultUrl) details.push("Result: link available");

  let line = `Job ${String(idF.value)} is ${status}${pct !== null ? `, ${Math.round(pct)}% done` : ""}.`;
  if (busy && (pct === null || pct === 0)) line += " It has only just started, so check again shortly.";
  else if (busy) line += " Check again in a moment for the finished result.";
  else if (level === "good") line = `Job ${String(idF.value)} has finished${resultUrl ? " and its result is ready" : ""}.`;
  else if (level === "bad") line = `Job ${String(idF.value)} ${status}${noteOf(data) ? `: ${noteOf(data)}` : ""}.`;
  return { spoken: [line], details, healthy: busy ? null : level === "bad" ? false : level === "good" ? true : null, mood: busy ? "thinking" : level === "bad" ? "alert" : "happy" };
}

function interpretCapabilities(data: Obj): Part | null {
  const capF = pick(data, ["capabilities", "features", "support"]);
  const supported = pick(data, ["supportedSystems", "supported"]);
  const unsupported = pick(data, ["unsupportedSystems", "unsupported"]);
  const caps = capF && isObj(capF.value) ? Object.entries(capF.value).filter(([, v]) => typeof v === "boolean") as [string, boolean][] : [];
  if (!caps.length && !(supported && Array.isArray(supported.value))) return null;

  const details: string[] = [];
  const spoken: string[] = [];
  const profile = pickStr(data, ["profile", "tier", "level", "class"]);
  if (profile) { details.push(`Device profile: ${profile}`); spoken.push(`Device profile is ${profile.replace(/[-_]/g, " ")}.`); }

  const on = caps.filter(([, v]) => v).map(([k]) => humanize(k));
  const off = caps.filter(([, v]) => !v).map(([k]) => humanize(k));
  if (on.length) details.push(`Available (${on.length}): ${on.join(", ")}`);
  if (off.length) details.push(`Unavailable (${off.length}): ${off.join(", ")}`);

  const sup = Array.isArray(supported?.value) ? (supported!.value as unknown[]).map(sys) : [];
  const uns = Array.isArray(unsupported?.value) ? (unsupported!.value as unknown[]).map(sys) : [];
  if (sup.length) details.push(`Supported systems (${sup.length}): ${sup.join(", ")}`);
  if (uns.length) details.push(`Unsupported systems (${uns.length}): ${uns.join(", ")}`);

  if (sup.length) spoken.push(`It supports ${joinList(sup)}${uns.length ? `, but not ${joinList(uns)}` : ""}.`);
  else if (uns.length) spoken.push(`It does not support ${joinList(uns)}.`);
  if (off.length) spoken.push(`Missing: ${joinList(off)}.`);
  else if (caps.length) spoken.push("Every checked feature is available.");

  const limited = off.length > 0 || uns.length > 0;
  return { spoken, details, healthy: null, mood: limited ? "concerned" : "happy" };
}

/* ================= health / status objects ================= */

function toComponents(source: unknown): Component[] {
  const out: Component[] = [];
  const add = (name: string, value: unknown) => {
    const level = levelOf(value);
    if (level === "unknown") return;
    const raw = isScalar(value) ? value : isObj(value) ? (pick(value, STATUS_KEYS)?.value ?? "") : "";
    out.push({ name: humanize(name), level, word: typeof raw === "string" && raw ? raw.replace(/[_-]/g, " ").toLowerCase() : level === "good" ? "healthy" : "failing", note: noteOf(value) });
  };
  if (Array.isArray(source)) {
    for (const item of source) { if (isObj(item)) { const n = pickStr(item, ["name", "id", "service", "component", "check", "title"]); if (n) add(n, item); } }
  } else if (isObj(source)) {
    for (const [k, v] of Object.entries(source)) add(k, v);
  }
  return out;
}

function findComponents(obj: Obj): { list: Component[]; label: string } {
  for (const key of COLLECTION_KEYS) {
    const f = pick(obj, [key]);
    if (f && typeof f.value === "object" && f.value !== null) { const list = toComponents(f.value); if (list.length) return { list, label: lower(humanize(f.key)) }; }
  }
  const entries = Object.entries(obj).filter(([k]) => !STATUS_KEYS.includes(k.toLowerCase()));
  if (entries.length >= 2) {
    const list = toComponents(Object.fromEntries(entries));
    if (list.length >= 2 && list.length === entries.length) return { list, label: "components" };
  }
  return { list: [], label: "checks" };
}

const HEALTH_VOCAB = new Set(["timestamp", "time", "checkedat", "lastchecked", "updatedat", "generatedat", "version", "uptime", "env", "environment", "stage", "server", "app", "application", "framework", "build", "release", "memory", "cpu", "load", "latency", "latencyms", "responsetime"].concat(STATUS_KEYS));

function looksLikeHealth(data: Obj): boolean {
  if (findComponents(data).list.length > 0 || pickDeep(data, ["uptime", "uptimeSeconds"]) || pickDeep(data, ["memory", "cpu", "latencyMs", "responseTime"])) return true;
  // { status: "ok" } plus only health-ish extras (timestamp, version, ...)
  const hasStatus = STATUS_KEYS.some((k) => { const f = pick(data, [k]); return f && isScalar(f.value) && levelOf(f.value) !== "unknown"; });
  return hasStatus && Object.keys(data).every((k) => HEALTH_VOCAB.has(norm(k)));
}

function interpretHealth(name: string, data: Obj, ok: boolean | null): Part {
  const details: string[] = [];
  const highlights: string[] = [];
  const { list, label } = findComponents(data);
  const bad = list.filter((c) => c.level === "bad"), warn = list.filter((c) => c.level === "warn"), good = list.filter((c) => c.level === "good");

  let overall: Level = "unknown";
  let rawWord = "";
  for (const key of STATUS_KEYS) {
    const f = pick(data, [key]);
    if (f && isScalar(f.value)) { const l = levelOf(f.value); if (l !== "unknown") { overall = l; rawWord = String(f.value).toLowerCase(); break; } }
  }
  if (overall === "unknown" && ok === true) overall = "good";
  let level: Level = overall;
  if (bad.length) level = "bad"; else if (warn.length && level !== "bad") level = "warn";
  else if (level === "unknown" && list.length && good.length === list.length) level = "good";

  if (rawWord) details.push(`Status: ${rawWord}`);
  if (list.length) {
    details.push(`${good.length} of ${list.length} ${label} OK`);
    for (const c of [...bad, ...warn, ...good]) details.push(`${c.name}: ${c.word}${c.note ? ` (${c.note})` : ""}`);
  }

  const server = pickStr(data, ["server", "app", "application", "framework"]);
  const version = pickDeep(data, ["version", "appVersion", "release", "build"]);
  const versionText = version && (typeof version.value === "string" || typeof version.value === "number") ? String(version.value) : "";
  if (server) details.push(`Server: ${server}`);
  if (versionText) details.push(`Version: ${versionText}`);
  if (server || versionText) highlights.push(server ? `Running ${server}${versionText ? ` version ${versionText}` : ""}` : `Version ${versionText}`);

  const up = pickDeep(data, ["uptime", "uptimeSeconds"]);
  if (up) {
    const n = num(up.value);
    if (n !== null && n >= 0) { const s = n > 157_680_000 ? n / 1000 : n; details.push(`Uptime: ${formatDuration(s)}`); highlights.push(`It has been up for ${formatDuration(s)}`); }
    else if (typeof up.value === "string") { details.push(`Uptime: ${up.value}`); highlights.push(`It has been up for ${up.value}`); }
  }
  const lat = latencyOf(data) ?? ((): string | null => { const d = pickDeep(data, ["latencyMs", "latency", "responseTimeMs", "responseTime"]); const ms = d ? num(d.value) : null; return ms !== null ? formatMs(ms) : null; })();
  if (lat) { details.push(`Response time: ${lat}`); highlights.push(`Response time is ${lat}`); }
  const env = pickDeep(data, ["env", "environment", "stage"]);
  if (env && typeof env.value === "string") details.push(`Environment: ${env.value}`);
  const mem = pickDeep(data, ["memory", "mem", "rss", "heapUsed"]);
  if (mem) { const b = num(mem.value) ?? (isObj(mem.value) ? num(pick(mem.value, ["rss", "heapUsed", "used"])?.value) : null); if (b !== null && b > 1_000_000) details.push(`Memory in use: ${formatBytes(b)}`); }
  const cpu = pickDeep(data, ["cpu", "cpuUsage", "cpuPercent", "load"]);
  const cpuN = cpu ? num(cpu.value) : null;
  if (cpuN !== null && cpuN >= 0) { const pct = cpuN <= 1 ? cpuN * 100 : cpuN; if (pct <= 100) { details.push(`CPU usage: ${Math.round(pct)}%`); if (pct >= 90) highlights.unshift(`CPU is running hot at ${Math.round(pct)} percent`); } }
  const stamp = pickDeep(data, ["timestamp", "time", "checkedAt", "lastChecked", "updatedAt", "generatedAt"]);
  const sd = stamp ? asDate(stamp.value) : null;
  if (sd) { const ago = relative(sd); details.push(`Last reported: ${ago ?? sd.toLocaleString()}`); if (ago && Date.now() - sd.getTime() > 3_600_000) highlights.unshift(`The last report was ${ago}, so this may be stale`); }

  const spoken: string[] = [];
  const verdictWord = rawWord && !["ok", "okay", "true", "200", "success"].includes(rawWord) ? rawWord.replace(/[_-]/g, " ") : "healthy";
  if (level === "good") spoken.push(`${name} is ${["running", "ready", "online", "active", "up", "operational", "alive"].includes(verdictWord) ? verdictWord : "healthy"}.`);
  else if (level === "warn") spoken.push(`${name} is degraded.`);
  else if (level === "bad") spoken.push(overall === "good" && bad.length ? `${name} says it is healthy, but something is failing.` : `${name} needs attention.`);
  else spoken.push(`${name} responded.`);

  const problems = [...bad, ...warn];
  if (problems.length) {
    spoken.push(`${problems.slice(0, 2).map((c) => `${c.name} is ${c.level === "warn" ? "degraded" : c.word === "failing" ? "down" : c.word}${c.note ? `: ${c.note}` : ""}`).join(". ")}.`);
    if (problems.length > 2) spoken.push(`${count(problems.length - 2, "other problem")} also reported.`);
    spoken.push(`${good.length} of ${list.length} ${label} are fine.`);
  } else if (list.length > 1) {
    const words = list.length <= 4 ? `: ${list.map((c) => `${lower(c.name)} ${c.word}`).join(", ")}` : "";
    const state = label === "checks" ? "passing" : label === "services" ? "up" : "healthy";
    spoken.push(`All ${list.length} ${label} are ${state}${words}.`);
  }
  for (const h of highlights.slice(0, 2)) spoken.push(`${h}.`);
  if (!details.length) details.push("No health information found.");

  return { spoken, details, healthy: level === "good" ? true : level === "bad" || level === "warn" ? false : null, mood: level === "bad" || level === "warn" ? "alert" : level === "good" ? "happy" : "curious" };
}

/* ================= collections ================= */

function findList(data: Obj): unknown[] | null {
  for (const key of [...LIST_KEYS, ...ENVELOPE_KEYS]) { const f = pick(data, [key]); if (f && Array.isArray(f.value)) return f.value; }
  const arrays = Object.values(data).filter(Array.isArray);
  const others = Object.values(data).filter((v) => isScalar(v) || isObj(v));
  return arrays.length === 1 && others.length <= 3 && (arrays[0] as unknown[]).every(isObj) ? (arrays[0] as unknown[]) : null;
}

function interpretCollection(list: unknown[], pagination: Obj | undefined, ok: boolean | null, hint?: string): Part {
  const details: string[] = [];
  const spoken: string[] = [];
  const items = list.filter(isObj);
  const noun = (items[0] && nounFor(items[0])) ?? hint ?? "item";

  const get = (names: string[]) => { const v = pagination ? num(pick(pagination, names)?.value) : null; return v; };
  const total = get(["total", "totalItems", "totalCount", "count"]);
  const page = get(["page", "currentPage"]);
  const limit = get(["limit", "perPage", "pageSize"]);
  const pages = get(["totalPages", "lastPage", "pages"]);
  const hasNext = pagination ? pick(pagination, ["hasNextPage", "hasNext", "next"])?.value : undefined;
  const hasPrev = pagination ? pick(pagination, ["hasPreviousPage", "hasPrev", "previous"])?.value : undefined;

  if (pagination) {
    if (total !== null) details.push(`Total: ${total.toLocaleString()}`);
    if (page !== null) details.push(`Page: ${page}${pages !== null ? ` of ${pages}` : ""}`);
    if (limit !== null) details.push(`Page size: ${limit}`);
    if (hasNext !== undefined) details.push(`Next page: ${hasNext ? "yes" : "no"}`);
    if (hasPrev !== undefined) details.push(`Previous page: ${hasPrev ? "yes" : "no"}`);
  }

  if (list.length === 0) {
    if (total !== null && total > 0) {
      spoken.push(`Page ${page ?? 1} came back empty, even though there ${total === 1 ? "is" : "are"} ${count(total, noun)} in total${pages ? ` across ${count(pages, "page")}` : ""}.`);
      spoken.push(hasNext ? "Try the next page, or check the filters." : "Check the filters or the page number.");
      return { spoken, details: ["No items on this page.", ...details], healthy: null, mood: "concerned" };
    }
    return { spoken: ["No results were returned."], details: ["The list is empty.", ...details], healthy: null, mood: "curious" };
  }

  // describe the content
  const fk = items[0] ? Object.keys(items[0]).find((k) => /^[a-z]+Id$/.test(k) && k !== "id") : undefined;
  const owner = fk ? fk.replace(/Id$/, "") : "";
  const distinct = fk && items.length > 1 ? new Set(items.map((i) => String(i[fk]))).size : 0;
  const fromText = distinct ? ` from ${count(distinct, owner)}` : "";
  if (distinct) details.push(`Distinct ${owner}s: ${distinct}`);

  spoken.push(
    pagination && total !== null
      ? `Showing ${list.length.toLocaleString()} of ${count(total, noun)}${fromText}${page !== null ? `, on page ${page}${pages ? ` of ${pages}` : ""}` : ""}.`
      : `Found ${count(list.length, noun)}${fromText}.`,
  );
  details.unshift(`${count(list.length, noun)} returned`);

  const labels = items.map((i) => pickStr(i, LABEL_KEYS)).filter((s): s is string => !!s);
  if (labels.length) {
    const first = labels.slice(0, 3).map((l) => `“${clip(l, 6)}”`);
    spoken.push(first.length === 1 ? `It is ${first[0]}.` : `The first ${NUMBER_WORDS[first.length]} are ${joinList(first, 3)}.`);
    details.push(...labels.slice(0, 6).map((l, i) => `${i + 1}. ${clip(l, 12)}`));
  } else if (items[0]) {
    const ids = items.slice(0, 3).map((i) => pick(i, ["id"])?.value).filter(isScalar);
    if (ids.length) spoken.push(`The first ${ids.length > 1 ? "are" : "is"} ${joinList(ids.map(String))}.`);
  }

  // status tally, when items carry a status
  const levels = items.map((i) => levelOf(i)).filter((l) => l !== "unknown");
  let healthy: boolean | null = null;
  let mood: Mood = ok === true ? "happy" : "curious";
  if (levels.length >= Math.ceil(items.length / 2)) {
    const bad = levels.filter((l) => l === "bad").length;
    details.push(`${levels.length - bad} of ${levels.length} are OK`);
    if (bad) { spoken.push(bad === 1 ? "One is reporting a problem." : `${bad} are reporting a problem.`); healthy = false; mood = "alert"; }
    else { healthy = true; mood = "happy"; }
  }

  if (items[0]) {
    const fields = Object.keys(items[0]).map((k) => lower(humanize(k)));
    details.push(`Each ${noun} has: ${joinList(fields, 8)}`);
  }
  if (hasNext === true) spoken.push("More pages are available.");
  return { spoken, details, healthy, mood };
}

/* ================= errors ================= */

function interpretError(err: ApiError | undefined, message?: string): Part {
  const details: string[] = [];
  const spoken: string[] = [];
  const text = err?.message ?? message;
  if (text) spoken.push(sentence(text));
  else if (err?.code) spoken.push(sentence(cap(codeWords(err.code))));
  else spoken.push("The request failed.");
  if (err?.code) details.push(`Error code: ${err.code}`);
  if (text) details.push(`Message: ${text}`);

  const fields = err?.fields ?? [];
  if (fields.length) {
    spoken.push(`${count(fields.length, "field")} ${fields.length === 1 ? "needs" : "need"} fixing.`);
    const lines = fields.map((f) => {
      const msg = f.messages[0];
      const names = humanize(f.field).toLowerCase();
      return msg.toLowerCase().includes(names) || msg.toLowerCase().includes(norm(f.field)) ? sentence(msg) : sentence(`${humanize(f.field)}: ${msg}`);
    });
    spoken.push(...lines.slice(0, 3));
    if (lines.length > 3) spoken.push(`${count(lines.length - 3, "other problem")} not read out.`);
    for (const f of fields) details.push(`${humanize(f.field)}: ${f.messages.join("; ")}`);
  }
  const probe = `${err?.code ?? ""} ${text ?? ""}`.toLowerCase();
  const matched = ERROR_HINTS.find(([re]) => re.test(probe))?.[1];
  const hint = matched === "Correct the highlighted fields and try again." && !fields.length ? "Check the request and try again." : matched;
  if (hint) { spoken.push(hint); details.push(`Suggestion: ${hint}`); }
  return { spoken, details, healthy: false, mood: "concerned" };
}

/* ================= entry point ================= */

export function interpretJsonResponse(endpointName: string, payload: unknown): InterpretedResponse {
  const name = endpointName;
  const title = `${name} result`;
  const finish = (lead: string | undefined, part: Part): InterpretedResponse => {
    const pieces = [lead ? sentence(lead) : "", ...part.spoken].filter(Boolean);
    return { title, summary: pieces.join(" ").replace(/\.\.+/g, ".").trim(), details: part.details.map((d) => (/[.!?…]$/.test(d) ? d : `${d}.`)), healthy: part.healthy, mood: part.mood };
  };

  if (payload === null || payload === undefined) return { title, summary: `${name} returned nothing useful.`, details: [], healthy: null, mood: "curious" };
  if (!isObj(payload) && !Array.isArray(payload)) {
    const level = levelOf(payload);
    const text = String(payload);
    return {
      title, healthy: level === "good" ? true : level === "bad" ? false : null,
      mood: level === "good" ? "happy" : level === "bad" ? "concerned" : "curious",
      summary: level === "good" ? `${name} replied ${text}, which looks healthy.` : level === "bad" ? `${name} replied ${text}, which looks like a problem.` : `${name} replied with ${text}.`,
      details: [`Value: ${text}.`],
    };
  }
  if (Array.isArray(payload)) return finish(undefined, interpretCollection(payload, undefined, null));

  const env = parseEnvelope(payload);
  if (env.error || env.success === false) return finish(undefined, interpretError(env.error, env.message));

  const ok = env.success;
  const data = env.data;
  if (data === undefined || data === null) {
    return finish(env.message ?? `${name} reported success`, { spoken: [], details: ["No data was returned."], healthy: true, mood: "happy" });
  }
  if (Array.isArray(data)) return finish(env.message, interpretCollection(data, env.pagination, ok));
  if (isScalar(data)) return finish(env.message, { spoken: [`Value: ${String(data)}.`], details: [`Value: ${String(data)}`], healthy: ok, mood: ok ? "happy" : "curious" });
  if (!isObj(data)) return finish(env.message, { spoken: [], details: [], healthy: null, mood: "curious" });

  const list = findList(data);
  if (list && (env.pagination || Object.keys(data).length <= 4)) return finish(env.message, interpretCollection(list, env.pagination ?? (isObj(pick(data, ["pagination", "meta"])?.value) ? (pick(data, ["pagination", "meta"])!.value as Obj) : undefined), ok));

  const part =
    interpretAuth(data) ??
    interpretJob(data) ??
    interpretCapabilities(data) ??
    (looksLikeHealth(data) ? interpretHealth(name, data, ok) : null) ??
    interpretEntity(data, name, ok);
  return finish(env.message, part);
}