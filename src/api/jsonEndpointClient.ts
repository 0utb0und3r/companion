export interface JsonRequestOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 256 * 1024;

function isJsonContentType(contentType: string | null): boolean {
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return mime === "application/json" || (mime.startsWith("application/") && mime.endsWith("+json"));
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`JSON response exceeds the ${Math.round(maxBytes / 1024)} KB size limit.`);
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`JSON response exceeds the ${Math.round(maxBytes / 1024)} KB size limit.`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let output = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`JSON response exceeds the ${Math.round(maxBytes / 1024)} KB size limit.`);
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

/** Fetches JSON only. It rejects redirects and never reads a non-JSON response body. */
export async function fetchEndpointJson<T = unknown>(
  url: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json, application/*+json" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      mode: "cors",
      signal: controller.signal,
    });

    // Check the media type before touching the response body.
    if (!isJsonContentType(response.headers.get("content-type"))) {
      throw new Error("The endpoint did not return JSON. Its response body was not read.");
    }
    if (!response.ok) {
      // Do not read error bodies, even when the server labels them as JSON.
      throw new Error(`Endpoint request failed with HTTP ${response.status}.`);
    }

    const text = await readTextWithLimit(response, maxBytes);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("The endpoint declared JSON but returned invalid JSON.");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Endpoint request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    if (error instanceof TypeError) {
      throw new Error("The request could not be completed. Check the URL, network, and endpoint CORS settings.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
