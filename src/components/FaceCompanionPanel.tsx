import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import CompanionFace from "./CompanionFace";
import type { Mood } from "./faceModel";
import {
  createEndpoint,
  DEFAULT_ENDPOINTS,
  loadEndpoints,
  saveEndpoints,
  type NamedEndpoint,
} from "../api/endpointRegistry";
import { fetchEndpointJson } from "../api/jsonEndpointClient";
import {
  interpretJsonResponse,
  type InterpretedResponse,
} from "../api/interpretJson";
import {
  useCompanionSpeech,
  type VoiceEngine,
} from "../hooks/useCompanionSpeech.ts";
import "./face-companion-panel.css";

const VOICE_KEY = "face-companion.voice-engine.v1";

function loadVoiceEngine(): VoiceEngine {
  try {
    return window.localStorage.getItem(VOICE_KEY) === "kokoro"
      ? "kokoro"
      : "browser";
  } catch {
    return "browser";
  }
}

function greetingForNow() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function FaceCompanionPanel() {
  const [greeting, setGreeting] = useState(true);
  const [greetingText] = useState(greetingForNow);
  const [calm, setCalm] = useState(true);
  const startedAt = useRef(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [endpoints, setEndpoints] = useState<NamedEndpoint[]>(() =>
    loadEndpoints(),
  );
  const [task, setTask] = useState("Check AxeAPI health");
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [interpretation, setInterpretation] =
    useState<InterpretedResponse | null>(null);
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>(loadVoiceEngine);
  // const headTtsUrl = import.meta.env.VITE_HEADTTS_API_URL?.trim() || undefined;
  const voice = useCompanionSpeech(voiceEngine);
  const requestId = useRef(0);

  useEffect(() => {
    saveEndpoints(endpoints);
  }, [endpoints]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VOICE_KEY, voiceEngine);
    } catch {
      /* preference just won't persist */
    }
  }, [voiceEngine]);

  useEffect(() => {
    if (busy || voice.speaking || !(interpretation || failed)) return;
    const wait = Math.max(0, 10_000 - (Date.now() - startedAt.current));
    const id = window.setTimeout(() => setCalm(true), wait);
    return () => window.clearTimeout(id);
  }, [busy, voice.speaking, interpretation, failed]);

  useEffect(() => {
    const end = window.setTimeout(() => setGreeting(false), 6000);
    const onFirstTap = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button, aside")) return;
      window.removeEventListener("pointerdown", onFirstTap);
      voice.speak(`${greetingText}! I'm ready when you are.`);
    };
    window.addEventListener("pointerdown", onFirstTap);
    return () => {
      window.clearTimeout(end);
      window.removeEventListener("pointerdown", onFirstTap);
    };
  }, []);

  // const selectedEndpoint = endpoints.find((endpoint) =>
  //   task.toLowerCase().includes(endpoint.name.toLowerCase()),
  // );

  async function runTask(taskText: string) {
    const currentRequest = ++requestId.current;
    voice.stop();
    startedAt.current = Date.now();
    setCalm(false);
    setGreeting(false);
    setFailed(false);
    setMessage("");
    setResult(null);
    setInterpretation(null);

    const selectedEndpoint = endpoints.find((e) =>
      taskText.toLowerCase().includes(e.name.toLowerCase()),
    );
    if (!selectedEndpoint) {
      const text = `I couldn't find a saved endpoint in "${taskText}". Try using one of the saved names.`;
      setFailed(true);
      setMessage(text);
      voice.speak(text);
      return;
    }

    setBusy(true);
    try {
      const payload = await fetchEndpointJson(selectedEndpoint.url);
      if (currentRequest !== requestId.current) return;
      setResult(payload);
      const interpreted = interpretJsonResponse(selectedEndpoint.name, payload);
      setInterpretation(interpreted);
      voice.speak(interpreted.summary); // speaks automatically
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      const text = error instanceof Error ? error.message : "The task failed.";
      setFailed(true);
      setMessage(text);
      voice.speak(text);
    } finally {
      if (currentRequest === requestId.current) setBusy(false);
    }
  }

  function speakResult() {
    if (interpretation) voice.speak(interpretation.summary);
  }

  function addEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const endpoint = createEndpoint(newName, newUrl);
      if (
        endpoints.some(
          (item) => item.name.toLowerCase() === endpoint.name.toLowerCase(),
        )
      ) {
        throw new Error("An endpoint with that name already exists.");
      }
      setEndpoints((current) => [...current, endpoint]);
      setNewName("");
      setNewUrl("");
      setMessage(
        `${endpoint.name} was saved. You can now mention that name in a task.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save endpoint.",
      );
    }
  }

  const mood: Mood = busy
    ? "thinking"
    : greeting && !interpretation
      ? "happy"
      : calm
        ? "neutral"
        : failed
          ? "concerned"
          : interpretation
            ? interpretation.healthy === false
              ? "alert"
              : interpretation.healthy === true
                ? "happy"
                : "curious"
            : "neutral";
  const speaking = voice.speaking;
  const caption =
    greeting && !speaking && !busy
      ? `${greetingText}!`
      : failed && !calm && message
        ? message
        : speaking
          ? "Speaking…"
          : voice.loading
            ? "Warming up the voice… the first run downloads the model."
            : busy
              ? "Checking your endpoint…"
              : voiceEngine === "kokoro"
                ? "Kokoro voice ready when requested."
                : "Browser voice ready when requested.";

  return (
    <main className="fc-app" data-mood={mood}>
      <div className="fc-fullface">
        <CompanionFace
          isSpeaking={speaking}
          mouthPose={voice.mouthPose}
          lipSync={voice.lipSync}
          mood={mood}
        />
      </div>
      <p className="fc-caption" aria-live="polite">
        {caption}
      </p>

      <button
        className="fc-widget-btn"
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
      >
        {panelOpen ? "✕" : "☰ Tasks"}
      </button>

      <div className="fc-quick">
        {endpoints.map((endpoint) => (
          <button
            key={endpoint.id}
            className="fc-chip"
            type="button"
            disabled={busy}
            onClick={() => void runTask(`Check ${endpoint.name} health`)}
          >
            Check {endpoint.name} health
          </button>
        ))}
      </div>

      {panelOpen && (
        <aside className="fc-task-card fc-drawer">
          <div className="fc-section-heading">
            <div>
              <p className="fc-eyebrow">TASK RUNNER</p>
              <h2>What should I check?</h2>
            </div>
            <span className="fc-json-tag">JSON only</span>
          </div>

          <form
            className="fc-task-form"
            onSubmit={(e) => {
              e.preventDefault();
              void runTask(task);
            }}
          >
            <label htmlFor="fc-task">Task</label>
            <textarea
              id="fc-task"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="e.g. Check AxeAPI health"
              rows={2}
            />
            <p className="fc-help">
              Mention a saved endpoint name, such as “Check AxeAPI health”.
            </p>
            <button
              className="fc-primary-button"
              type="submit"
              disabled={busy || !task.trim()}
            >
              {busy ? "Checking…" : "Run task"}
            </button>
          </form>

          {(message || voice.notice) && (
            <p className="fc-message" role="status">
              {[message, voice.notice].filter(Boolean).join(" ")}
            </p>
          )}

          <div className="fc-voice-row">
            <label htmlFor="fc-voice">Voice</label>
            <select
              id="fc-voice"
              value={voiceEngine}
              onChange={(event) => {
                voice.stop();
                setVoiceEngine(event.target.value as VoiceEngine);
              }}
            >
              <option value="browser">Browser voice (instant)</option>
              <option value="kokoro">Kokoro (natural, runs on-device)</option>
            </select>
          </div>

          {interpretation && (
            <section className="fc-result" aria-live="polite">
              <div className="fc-result-heading">
                <div>
                  <span
                    className={`fc-result-dot ${interpretation.healthy === false ? "is-unhealthy" : interpretation.healthy === true ? "is-healthy" : ""}`}
                  />
                  <h3>{interpretation.title}</h3>
                </div>
                <button
                  className="fc-secondary-button"
                  type="button"
                  onClick={speakResult}
                >
                  {speaking ? "Replay summary" : "Speak summary"}
                </button>
              </div>
              <p className="fc-summary">{interpretation.summary}</p>
              {interpretation.details.length > 0 && (
                <ul className="fc-detail-list">
                  {interpretation.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
              <details className="fc-json-details">
                <summary>View JSON response</summary>
                <pre>{JSON.stringify(result, null, 2)}</pre>
              </details>
            </section>
          )}

          <section className="fc-endpoints">
            <div className="fc-endpoints-heading">
              <h3>Saved endpoints</h3>
              <span>{endpoints.length}</span>
            </div>
            <div className="fc-endpoint-list">
              {endpoints.map((endpoint) => (
                <article className="fc-endpoint-item" key={endpoint.id}>
                  <div className="fc-endpoint-icon">
                    <span>{endpoint.name.slice(0, 1).toUpperCase()}</span>
                  </div>
                  <div className="fc-endpoint-copy">
                    <strong>{endpoint.name}</strong>
                    <span>{endpoint.url}</span>
                  </div>
                  {endpoint.id !== DEFAULT_ENDPOINTS[0].id && (
                    <button
                      className="fc-remove-button"
                      type="button"
                      aria-label={`Remove ${endpoint.name}`}
                      onClick={() =>
                        setEndpoints((current) =>
                          current.filter((item) => item.id !== endpoint.id),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </article>
              ))}
            </div>

            <details className="fc-add-endpoint">
              <summary>＋ Add a named endpoint</summary>
              <form onSubmit={addEndpoint}>
                <label htmlFor="fc-endpoint-name">Name</label>
                <input
                  id="fc-endpoint-name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="e.g. OrdersAPI"
                  required
                  maxLength={60}
                />
                <label htmlFor="fc-endpoint-url">HTTPS URL</label>
                <input
                  id="fc-endpoint-url"
                  type="url"
                  value={newUrl}
                  onChange={(event) => setNewUrl(event.target.value)}
                  placeholder="https://api.example.com/health"
                  required
                />
                <p className="fc-help">
                  Only HTTPS endpoints are accepted. Local/private hosts and
                  URLs with embedded credentials are blocked.
                </p>
                <button className="fc-secondary-button" type="submit">
                  Save endpoint
                </button>
              </form>
            </details>
          </section>
        </aside>
      )}
    </main>
  );
}
