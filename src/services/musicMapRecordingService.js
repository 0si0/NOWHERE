import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveMusicMapRecord } from './firebaseService';
import { getDistanceMeters } from './locationService';
import { musicPlayerService } from './musicPlayerService';

const MUSIC_MAP_SESSION_KEY = '@nowhere/music-map-recording-session-v2';
const MUSIC_MAP_STOPPING_KEY = '@nowhere/music-map-recording-stopping-v2';
const MUSIC_MAP_SEGMENT_SAVE_PREFIX = '@nowhere/music-map-recording-segment-save-v2:';
const ROUTE_POINT_MIN_DISTANCE_M = 18;
const ROUTE_POINT_MAX_COUNT = 160;
const MAX_RECORDING_DURATION_MS = 60 * 60 * 1000;
const MIN_SAVED_ROUTE_POINTS = 1;
const SPOTIFY_STATE_MIN_POLL_INTERVAL_MS = 10000;
const SPOTIFY_STATE_MAX_CACHE_AGE_MS = 10 * 60 * 1000;
const SESSION_IDLE_WRITE_INTERVAL_MS = 15000;
const PLAYER_CONFIGURE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_ALBUM_COLORS = [
  '#FFC8B8',
  '#7CFFB2',
  '#A9D6FF',
  '#FFD166',
  '#FF8FAB',
  '#CDB4DB',
  '#BDE0FE',
];

let recordInFlight = false;
let lastPlayerConfiguredAt = 0;

function isFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeCoords(coords) {
  if (!isFiniteCoordinate(coords?.latitude) || !isFiniteCoordinate(coords?.longitude)) {
    return null;
  }

  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
  };
}

function getTrackKey(track = {}) {
  return [
    track.id,
    track.spotifyUri,
    track.uri,
    track.title,
    track.artist,
  ].filter(Boolean).join(':');
}

function hasValidTrack(track = {}) {
  return track &&
    track.type !== 'playlist' &&
    (track.title || track.id || track.spotifyUri || track.uri);
}

function getAlbumColor(track = {}) {
  const givenColor = typeof track.color === 'string' ? track.color.trim() : '';
  if (/^#[0-9A-Fa-f]{6}$/.test(givenColor)) {
    return givenColor;
  }

  const text = `${track.title || ''}:${track.artist || ''}:${track.album || ''}`;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }

  return DEFAULT_ALBUM_COLORS[Math.abs(hash) % DEFAULT_ALBUM_COLORS.length] || DEFAULT_ALBUM_COLORS[0];
}

function buildRoutePoint(coords, segmentIndex = 0) {
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    recordedAt: new Date().toISOString(),
    segmentIndex,
  };
}

function updateRoutePoints(routePoints = [], point) {
  const lastPoint = routePoints[routePoints.length - 1];
  const lastSegmentIndex = Number.isInteger(lastPoint?.segmentIndex) ? lastPoint.segmentIndex : 0;
  if (
    routePoints.length > 0 &&
    lastSegmentIndex === point.segmentIndex &&
    getDistanceMeters(lastPoint.latitude, lastPoint.longitude, point.latitude, point.longitude) < ROUTE_POINT_MIN_DISTANCE_M
  ) {
    return routePoints;
  }

  return [...routePoints, point].slice(-ROUTE_POINT_MAX_COUNT);
}

function getRouteDistanceMeters(routePoints = []) {
  return routePoints.reduce((total, point, index) => {
    const previousPoint = routePoints[index - 1];
    const previousSegmentIndex = Number.isInteger(previousPoint?.segmentIndex) ? previousPoint.segmentIndex : 0;
    const segmentIndex = Number.isInteger(point?.segmentIndex) ? point.segmentIndex : 0;
    if (!previousPoint || previousSegmentIndex !== segmentIndex) {
      return total;
    }

    return total + getDistanceMeters(
      previousPoint.latitude,
      previousPoint.longitude,
      point.latitude,
      point.longitude
    );
  }, 0);
}

function hasPlayableRoute(routePoints = []) {
  return routePoints.length >= MIN_SAVED_ROUTE_POINTS;
}

function getRenderableRoutePoints(routePoints = []) {
  const pointCounts = routePoints.reduce((counts, point) => {
    const index = Number.isInteger(point?.segmentIndex) ? point.segmentIndex : 0;
    counts.set(index, (counts.get(index) || 0) + 1);
    return counts;
  }, new Map());

  return routePoints.filter((point) => {
    const index = Number.isInteger(point?.segmentIndex) ? point.segmentIndex : 0;
    return (pointCounts.get(index) || 0) >= MIN_SAVED_ROUTE_POINTS;
  });
}

async function readSession() {
  const raw = await AsyncStorage.getItem(MUSIC_MAP_SESSION_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    return session && typeof session === 'object' ? session : null;
  } catch (error) {
    await AsyncStorage.removeItem(MUSIC_MAP_SESSION_KEY);
    return null;
  }
}

async function writeSession(session) {
  await AsyncStorage.setItem(MUSIC_MAP_SESSION_KEY, JSON.stringify(session));
}

async function isStopRequested() {
  return AsyncStorage.getItem(MUSIC_MAP_STOPPING_KEY)
    .then((value) => value === 'true')
    .catch(() => false);
}

async function maybeWriteSession(session, { force = false, nowMs = Date.now() } = {}) {
  const lastWriteAt = Number(session?.lastSessionWriteAt || 0);
  if (!force && lastWriteAt && nowMs - lastWriteAt < SESSION_IDLE_WRITE_INTERVAL_MS) {
    return false;
  }

  await writeSession({
    ...session,
    lastSessionWriteAt: nowMs,
  });
  return true;
}

async function clearSegmentSaveLocks() {
  const keys = await AsyncStorage.getAllKeys();
  const lockKeys = keys.filter((key) => key.startsWith(MUSIC_MAP_SEGMENT_SAVE_PREFIX));
  if (lockKeys.length > 0) {
    await AsyncStorage.multiRemove(lockKeys);
  }
}

function isExpired(session, nowMs = Date.now()) {
  const startedAtMs = new Date(session?.startedAt || 0).getTime();
  return !Number.isFinite(startedAtMs) || nowMs - startedAtMs >= MAX_RECORDING_DURATION_MS;
}

function getElapsedMs(session, nowMs = Date.now()) {
  const startedAtMs = new Date(session?.startedAt || 0).getTime();
  return Number.isFinite(startedAtMs) ? Math.max(0, nowMs - startedAtMs) : 0;
}

async function getCurrentSpotifyState(nowMs = Date.now()) {
  if (!lastPlayerConfiguredAt || nowMs - lastPlayerConfiguredAt > PLAYER_CONFIGURE_INTERVAL_MS) {
    await musicPlayerService.configure().then(() => {
      lastPlayerConfiguredAt = Date.now();
    }).catch(() => null);
  }
  return musicPlayerService.getState();
}

function sanitizePlaybackState(state = {}, checkedAtMs = Date.now()) {
  const track = hasValidTrack(state.currentTrack) ? state.currentTrack : null;
  return {
    checkedAtMs,
    isPlaying: Boolean(state.isPlaying && track),
    track,
    trackKey: track ? getTrackKey(track) : '',
    playbackStatus: state.playbackStatus || '',
    authorizationStatus: state.authorizationStatus || '',
    isAuthorized: Boolean(state.isAuthorized),
  };
}

function getCachedPlaybackState(session = {}, nowMs = Date.now()) {
  const cached = session.lastPlaybackState;
  if (!cached?.checkedAtMs || nowMs - cached.checkedAtMs > SPOTIFY_STATE_MAX_CACHE_AGE_MS) {
    return null;
  }
  return cached;
}

function shouldPollPlaybackState(session = {}, pointCoords, nowMs = Date.now()) {
  const lastCheckedAt = Number(session.lastPlaybackState?.checkedAtMs || 0);
  if (!lastCheckedAt || nowMs - lastCheckedAt >= SPOTIFY_STATE_MIN_POLL_INTERVAL_MS) {
    return true;
  }

  const routePoints = session.currentSegment?.routePoints || [];
  const lastPoint = routePoints[routePoints.length - 1];
  if (!lastPoint || !pointCoords) {
    return false;
  }

  return false;
}

function getSegmentTrack(segment = {}) {
  return hasValidTrack(segment.track) ? segment.track : null;
}

function buildSegment(track, point, recordedAt, placeName) {
  return {
    id: `${getTrackKey(track)}:${recordedAt}`,
    track,
    trackKey: getTrackKey(track),
    albumColor: getAlbumColor(track),
    albumArtUrl: track.artworkUrl || '',
    placeName,
    startedAt: recordedAt,
    lastUpdatedAt: recordedAt,
    routePoints: [point],
  };
}

function appendSessionRoutePoint(session, point) {
  const baseRoutePoints = Array.isArray(session.routePoints) && session.routePoints.length > 0
    ? session.routePoints
    : Array.isArray(session.currentSegment?.routePoints)
      ? session.currentSegment.routePoints
      : [];
  if (!point) {
    return baseRoutePoints;
  }
  return updateRoutePoints(baseRoutePoints, point);
}

function buildTrackChangeMarker(track, point, recordedAt) {
  return {
    id: `${getTrackKey(track)}:${recordedAt}`,
    track,
    trackKey: getTrackKey(track),
    albumColor: getAlbumColor(track),
    location: point,
    recordedAt,
  };
}

async function saveSegment(session, segment, endedAt = new Date().toISOString()) {
  if (
    !session?.isActive ||
    !segment?.trackKey ||
    segment.saved ||
    (session.savedSegmentKeys || []).includes(segment.id)
  ) {
    return null;
  }

  const saveLockKey = `${MUSIC_MAP_SEGMENT_SAVE_PREFIX}${session.id}:${segment.id}`;
  const isAlreadySaving = await AsyncStorage.getItem(saveLockKey);
  if (isAlreadySaving === 'true') {
    return null;
  }
  await AsyncStorage.setItem(saveLockKey, 'true');

  const routePoints = Array.isArray(segment.routePoints) ? segment.routePoints : [];
  const renderableRoutePoints = getRenderableRoutePoints(routePoints);
  const firstPoint = renderableRoutePoints[0];
  const lastPoint = renderableRoutePoints[renderableRoutePoints.length - 1] || firstPoint;
  if (!firstPoint || !lastPoint || !hasPlayableRoute(renderableRoutePoints)) {
    await AsyncStorage.removeItem(saveLockKey);
    return null;
  }

  const startedAtMs = new Date(segment.startedAt).getTime();
  const endedAtMs = new Date(endedAt).getTime();
  const playedDurationMs = Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs)
    ? Math.max(0, endedAtMs - startedAtMs)
    : 0;

  try {
    return await saveMusicMapRecord({
      userId: session.userId,
      sessionId: session.id,
      source: 'music-map-session',
      recordType: 'track',
      track: segment.track,
      albumColor: segment.albumColor,
      albumArtUrl: segment.albumArtUrl,
      placeName: segment.placeName || session.placeName || '',
      latitude: lastPoint.latitude,
      longitude: lastPoint.longitude,
      routePoints: renderableRoutePoints,
      playedDurationMs,
      startedAt: segment.startedAt,
      recordedAt: endedAt,
      publishPublic: false,
    });
  } catch (error) {
    await AsyncStorage.removeItem(saveLockKey);
    throw error;
  }
}

export async function getMusicMapRecordingSession() {
  const session = await readSession();
  if (!session?.isActive) {
    return {
      isActive: false,
      maxDurationMs: MAX_RECORDING_DURATION_MS,
      elapsedMs: 0,
    };
  }

  if (isExpired(session)) {
    return stopMusicMapRecordingSession();
  }

  return {
    ...session,
    maxDurationMs: MAX_RECORDING_DURATION_MS,
    elapsedMs: getElapsedMs(session),
    expiresAt: new Date(new Date(session.startedAt).getTime() + MAX_RECORDING_DURATION_MS).toISOString(),
  };
}

export async function startMusicMapRecordingSession({
  userId = '',
  coords = null,
  placeName = '',
  initialTrack = null,
  initialPlaybackState = null,
} = {}) {
  await AsyncStorage.removeItem(MUSIC_MAP_STOPPING_KEY);
  await clearSegmentSaveLocks();
  const ownerId = userId || '';
  const now = new Date().toISOString();
  const point = normalizeCoords(coords);
  const track = hasValidTrack(initialTrack) ? initialTrack : null;
  const initialRoutePoint = point ? buildRoutePoint(point, 0) : null;
  const session = {
    id: `music-map-session-${Date.now()}`,
    isActive: true,
    userId: ownerId,
    placeName,
    startedAt: now,
    lastUpdatedAt: now,
    currentSegment: track && initialRoutePoint ? buildSegment(track, initialRoutePoint, now, placeName) : null,
    lastPlaybackState: initialPlaybackState || (track ? sanitizePlaybackState({
      isPlaying: true,
      currentTrack: track,
      playbackStatus: 'playing',
      isAuthorized: true,
      authorizationStatus: 'authorized',
    }, Date.now()) : null),
    savedSegmentKeys: [],
    startLocation: point,
    routePoints: initialRoutePoint ? [initialRoutePoint] : [],
    trackChangeMarkers: [],
  };

  await writeSession(session);
  return getMusicMapRecordingSession();
}

export async function stopMusicMapRecordingSession() {
  await AsyncStorage.setItem(MUSIC_MAP_STOPPING_KEY, 'true');
  const session = await readSession();
  if (!session?.isActive) {
    await AsyncStorage.removeItem(MUSIC_MAP_SESSION_KEY);
    return {
      isActive: false,
      maxDurationMs: MAX_RECORDING_DURATION_MS,
      elapsedMs: 0,
    };
  }

  const endedAt = new Date().toISOString();
  const saved = await saveSegment(session, session.currentSegment, endedAt).catch(() => null);
  await AsyncStorage.removeItem(MUSIC_MAP_SESSION_KEY);
  await clearSegmentSaveLocks();

  return {
    isActive: false,
    maxDurationMs: MAX_RECORDING_DURATION_MS,
    elapsedMs: getElapsedMs(session),
    savedRecord: saved,
  };
}

export async function recordCurrentMusicMapPlayback({
  coords,
  placeName = '',
  allowPlaybackPolling = true,
} = {}) {
  if (recordInFlight) {
    return { recorded: false, reason: 'busy' };
  }

  recordInFlight = true;
  try {
    if (await isStopRequested()) {
      return { recorded: false, reason: 'stopping' };
    }

    const session = await readSession();
    if (!session?.isActive) {
      return { recorded: false, reason: 'inactive' };
    }

    const pointCoords = normalizeCoords(coords);
    if (!pointCoords) {
      return { recorded: false, reason: 'missing-location' };
    }

    if (isExpired(session)) {
      const stopped = await stopMusicMapRecordingSession();
      return { recorded: false, reason: 'expired', stopped };
    }

    const nowMs = Date.now();
    let playbackState = getCachedPlaybackState(session, nowMs);
    if (allowPlaybackPolling && (shouldPollPlaybackState(session, pointCoords, nowMs) || !playbackState)) {
      const state = await getCurrentSpotifyState(nowMs).catch(() => null);
      if (!state && !playbackState && !getSegmentTrack(session.currentSegment)) {
        return { recorded: false, reason: 'playback-unavailable' };
      }
      if (state) {
        playbackState = sanitizePlaybackState(state, nowMs);
        session.lastPlaybackState = playbackState;
      }
    }

    const track = playbackState?.track || getSegmentTrack(session.currentSegment);
    if (!hasValidTrack(track)) {
      session.lastUpdatedAt = new Date().toISOString();
      if (await isStopRequested()) {
        return { recorded: false, reason: 'stopping' };
      }
      await maybeWriteSession(session, { nowMs });
      return { recorded: false, reason: 'missing-track' };
    }

    const trackKey = playbackState?.trackKey || getTrackKey(track);
    if (!trackKey) {
      return { recorded: false, reason: 'missing-track-key' };
    }

    const recordedAt = new Date().toISOString();
    const currentSegment = session.currentSegment;
    const savedRecords = [];

    if (currentSegment?.trackKey && currentSegment.trackKey !== trackKey) {
      const saved = await saveSegment(session, currentSegment, recordedAt).catch(() => null);
      if (saved) {
        savedRecords.push(saved);
      }
      session.savedSegmentKeys = [...(session.savedSegmentKeys || []), currentSegment.id].filter(Boolean).slice(-120);
      const point = buildRoutePoint(pointCoords, 0);
      session.routePoints = appendSessionRoutePoint(session, point);
      session.trackChangeMarkers = [
        ...(session.trackChangeMarkers || []),
        buildTrackChangeMarker(track, point, recordedAt),
      ].slice(-120);
      session.currentSegment = buildSegment(track, point, recordedAt, placeName || session.placeName || '');
    } else if (currentSegment?.trackKey === trackKey) {
      const routePoints = currentSegment.routePoints || [];
      const lastPoint = routePoints[routePoints.length - 1];
      const segmentIndex = Number.isInteger(lastPoint?.segmentIndex) ? lastPoint.segmentIndex : 0;
      const point = buildRoutePoint(pointCoords, segmentIndex);
      const nextRoutePoints = updateRoutePoints(routePoints, point);
      if (nextRoutePoints === routePoints && !currentSegment.shouldBreakRoute) {
        session.lastUpdatedAt = recordedAt;
        if (await isStopRequested()) {
          return { recorded: false, reason: 'stopping' };
        }
        await maybeWriteSession(session, { nowMs });
        return { recorded: false, reason: 'route-unchanged', session };
      }
      session.routePoints = appendSessionRoutePoint(session, point);
      session.currentSegment = {
        ...currentSegment,
        track,
        albumColor: getAlbumColor(track),
        albumArtUrl: track.artworkUrl || currentSegment.albumArtUrl || '',
        placeName: placeName || currentSegment.placeName || session.placeName || '',
        routePoints: nextRoutePoints,
        lastUpdatedAt: recordedAt,
        pausedAt: '',
        shouldBreakRoute: false,
      };
    } else {
      const point = buildRoutePoint(pointCoords, 0);
      session.routePoints = appendSessionRoutePoint(session, point);
      session.currentSegment = buildSegment(track, point, recordedAt, placeName || session.placeName || '');
    }

    session.lastUpdatedAt = recordedAt;
    if (placeName) {
      session.placeName = placeName;
    }
    if (await isStopRequested()) {
      return { recorded: false, reason: 'stopping' };
    }
    await maybeWriteSession(session, { force: true, nowMs });

    return {
      recorded: savedRecords.length > 0,
      records: savedRecords,
      session,
    };
  } finally {
    recordInFlight = false;
  }
}
