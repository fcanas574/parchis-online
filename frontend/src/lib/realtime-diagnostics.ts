export type RealtimeDiagnosticValue = string | number | boolean | null;
export type RealtimeDiagnosticDetails = Record<string, RealtimeDiagnosticValue>;

const uuidV4Pattern =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function correlatableRequestId(value: unknown): string | null {
  return typeof value === "string" && uuidV4Pattern.test(value)
    ? value.toLowerCase()
    : null;
}

export function realtimeDebugEnabled(): boolean {
  return typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("realtime-debug") === "1";
}

export function logRealtime(
  event: string,
  details: RealtimeDiagnosticDetails,
): void {
  if (!realtimeDebugEnabled()) return;
  console.info("[parchis-realtime]", JSON.stringify({
    event,
    at: new Date().toISOString(),
    ...details,
  }));
}
