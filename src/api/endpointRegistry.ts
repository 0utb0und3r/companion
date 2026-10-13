export interface NamedEndpoint {
  id: string;
  name: string;
  url: string;
  description?: string;
}

const STORAGE_KEY = "face-companion.named-endpoints.v1";

export const DEFAULT_ENDPOINTS: NamedEndpoint[] = [
  {
    id: "axeapi-health",
    name: "AxeAPI",
    url: "https://axepi.accredixx.com/health",
    description: "Health status endpoint",
  },
];

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

  // IPv6 literals only (they always contain a colon). Checking prefixes on every hostname
  // would wrongly block real domains such as fcc.gov or fdic.gov.
  if (host.includes(":")) {
    return (
      host === "::1" ||
      host === "::" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:") ||
      host.startsWith("::ffff:")
    );
  }

  // Block common private, loopback, link-local, and unspecified IPv4 ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part < 0 || part > 255)) return true;
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  return false;
}

export function validateEndpointUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid absolute URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("For safety, saved endpoints must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs containing embedded credentials are not allowed.");
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error("Local and private-network hosts are not allowed.");
  }
  if (parsed.hash) parsed.hash = "";
  return parsed.toString();
}

export function loadEndpoints(): NamedEndpoint[] {
  if (typeof window === "undefined") return DEFAULT_ENDPOINTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ENDPOINTS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_ENDPOINTS;
    const valid = parsed.filter(
      (item): item is NamedEndpoint =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.url === "string",
    );
    return valid.length ? valid : DEFAULT_ENDPOINTS;
  } catch {
    return DEFAULT_ENDPOINTS;
  }
}

export function saveEndpoints(endpoints: NamedEndpoint[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints));
  } catch {
    /* storage can be unavailable (private mode, quota); endpoints just won't persist */
  }
}

export function createEndpoint(name: string, url: string, description = ""): NamedEndpoint {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Give this endpoint a name.");
  if (cleanName.length > 60) throw new Error("Endpoint names must be 60 characters or fewer.");
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: cleanName,
    url: validateEndpointUrl(url),
    description: description.trim(),
  };
}
