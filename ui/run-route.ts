export const unsupportedCustomRunId = "local-agent-preview";
export const sampleSyntheticRunId = "realtimekit-video-room-v1-1784203200000";

export function runIdFromPath(path: string): string | undefined {
  const match = path.match(/^\/(?:runs|reports)\/([^/]+)\/?$/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export function resultMatchesRunPath(path: string, resultRunId: string | undefined): boolean {
  return resultRunId !== undefined && resultRunId === runIdFromPath(path);
}
