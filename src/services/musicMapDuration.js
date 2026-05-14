export const DEFAULT_MUSIC_MAP_TRACK_DURATION_MS = 180000;
const MAX_REASONABLE_TRACK_DURATION_SECONDS = 10 * 60;
const MAX_REASONABLE_TRACK_DURATION_MINUTES = 10;

export function normalizeMusicMapDurationMs(durationMs, fallbackMs = DEFAULT_MUSIC_MAP_TRACK_DURATION_MS) {
  const value = Number(durationMs || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackMs;
  }

  if (value <= MAX_REASONABLE_TRACK_DURATION_MINUTES) {
    return value * 60 * 1000;
  }

  return value <= MAX_REASONABLE_TRACK_DURATION_SECONDS
    ? value * 1000
    : value;
}
