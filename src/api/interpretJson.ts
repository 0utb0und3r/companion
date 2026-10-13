export interface InterpretedResponse {
  title: string;
  summary: string;
  details: string[];
  healthy: boolean | null;
}

function humanizeStatus(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const status = String(value).toLowerCase();
  if (["ok", "healthy", "up", "success", "true", "200"].includes(status)) return "healthy";
  if (["error", "failed", "unhealthy", "down", "false", "critical"].includes(status)) return "unhealthy";
  return String(value);
}

function formatUptime(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes || parts.length === 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.slice(0, 2).join(" and ");
}

function displayValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function interpretJsonResponse(endpointName: string, payload: unknown): InterpretedResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      title: `${endpointName} response received`,
      summary: `${endpointName} returned valid JSON, but it was not a JSON object.`,
      details: [],
      healthy: null,
    };
  }

  const data = payload as Record<string, unknown>;
  const details: string[] = [];
  const status = humanizeStatus(data.status);
  const healthy = status === "healthy" ? true : status === "unhealthy" ? false : null;

  if (status) {
    details.push(`Status: ${status === "healthy" ? "OK" : status === "unhealthy" ? "unhealthy" : status}.`);
  }

  if (data.checks && typeof data.checks === "object" && !Array.isArray(data.checks)) {
    for (const [checkName, checkValue] of Object.entries(data.checks as Record<string, unknown>)) {
      const checkStatus = humanizeStatus(checkValue);
      if (checkStatus === "healthy") details.push(`${checkName} is healthy.`);
      else if (checkStatus === "unhealthy") details.push(`${checkName} is reporting a problem.`);
      else if (checkStatus) details.push(`${checkName}: ${checkStatus}.`);
    }
  }

  const uptime = formatUptime(data.uptime);
  if (uptime) details.push(`Uptime: ${uptime}.`);

  const environment = displayValue(data.env);
  if (environment) details.push(`Environment: ${environment}.`);

  const timestamp = displayValue(data.timestamp);
  if (timestamp) {
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) details.push(`Last reported: ${date.toLocaleString()}.`);
  }

  const failedChecks = Boolean(
    data.checks &&
    typeof data.checks === "object" &&
    Object.values(data.checks as Record<string, unknown>).some((value) => humanizeStatus(value) === "unhealthy"),
  );
  const overallHealthy = healthy === false || failedChecks ? false : healthy;
  const summary = overallHealthy === true
    ? `${endpointName} health is good. ${details.slice(0, 3).join(" ")}`
    : overallHealthy === false
      ? `${endpointName} needs attention. ${details.filter(Boolean).slice(0, 4).join(" ")}`
      : `${endpointName} returned JSON. ${details.slice(0, 3).join(" ")}`;

  return {
    title: `${endpointName} result`,
    summary: summary.trim(),
    details,
    healthy: overallHealthy,
  };
}
