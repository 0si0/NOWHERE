import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_ALBUM_COLOR,
  getAlbumArtUrl,
  getInitialAlbumColor,
  resolveAlbumColor,
} from './albumColorService';
import { saveMusicMapRecord } from './firebaseService';
import { getDistanceMeters } from './locationService';
import { musicPlayerService } from './musicPlayerService';

const MUSIC_MAP_SESSION_KEY = '@nowhere/music-map-recording-session-v2';
const MUSIC_MAP_STOPPING_KEY = '@nowhere/music-map-recording-stopping-v2';
const MUSIC_MAP_SEGMENT_SAVE_PREFIX = '@nowhere/music-map-recording-segment-save-v2:';
const LOCATION_ACCURACY_THRESHOLD = 30;
const MIN_DISTANCE_TO_ADD_POINT = 3;
const MAX_REASONABLE_WALKING_SPEED = 5;
const GPS_JUMP_DISTANCE_THRESHOLD = 50;
const GPS_JUMP_TIME_THRESHOLD_MS = 15000;
const STATIONARY_ACCURACY_FACTOR = 0.35;
const ROUTE_POINT_MAX_COUNT = 720;
const SAVED_ROUTE_POINT_MAX_COUNT = 160;
const MAX_RECORDING_DURATION_MS = 60 * 60 * 1000;
const MIN_SAVED_ROUTE_POINTS = 1;
const SPOTIFY_STATE_MIN_POLL_INTERVAL_MS = 10000;
const SPOTIFY_STATE_MAX_CACHE_AGE_MS = 10 * 60 * 1000;
const SESSION_IDLE_WRITE_INTERVAL_MS = 15000;
const PLAYER_CONFIGURE_INTERVAL_MS = 5 * 60 * 1000;
let recordInFlight = false;
let lastPlayerConfiguredAt = 0;
const sessionListeners = new Set();

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
    accuracy: typeof coords.accuracy === 'number' && Number.isFinite(coords.accuracy) ? coords.accuracy : null,
    speed: typeof coords.speed === 'number' && Number.isFinite(coords.speed) ? coords.speed : null,
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

function hashText(text = '') {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildRecordId(prefix, track = {}, recordedAt = new Date().toISOString()) {
  const trackPart = track.id || track.spotifyUri || track.uri || hashText(getTrackKey(track));
  return `${prefix}:${String(trackPart).slice(0, 48)}:${recordedAt}`;
}

function hasValidTrack(track = {}) {
  return track &&
    track.type !== 'playlist' &&
    (track.title || track.id || track.spotifyUri || track.uri);
}

function getAlbumColor(track = {}) {
  return getInitialAlbumColor(track);
}

function getTrackSummary(track = {}, albumColor = getAlbumColor(track)) {
  return {
    trackId: track.trackId || track.id || track.spotifyUri || track.uri || '',
    trackKey: track.trackKey || getTrackKey(track),
    trackName: track.trackName || track.title || 'Unknown Track',
    artistName: track.artistName || track.artist || '',
    albumName: track.albumName || track.album || '',
    albumArtUrl: getAlbumArtUrl(track),
    albumColor: albumColor || DEFAULT_ALBUM_COLOR,
  };
}

function getTrackIdentity(track = {}) {
  const trackId = track.trackId || track.id || track.spotifyUri || track.uri || '';
  if (trackId) return `id:${trackId}`;
  const trackKey = track.trackKey || getTrackKey(track);
  if (trackKey) return `key:${trackKey}`;
  const trackName = track.trackName || track.title || '';
  const artistName = track.artistName || track.artist || '';
  return `text:${trackName}:${artistName}`.toLowerCase();
}

function isSameTrack(left = {}, right = {}) {
  return getTrackIdentity(left) === getTrackIdentity(right);
}

function notifySessionUpdated(session) {
  sessionListeners.forEach((listener) => {
    try {
      listener(session);
    } catch (error) {
      // Listener failures must never interrupt recording.
    }
  });
}

function buildRoutePoint(coords, segmentIndex = 0) {
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy ?? null,
    speed: coords.speed ?? null,
    recordedAt: new Date().toISOString(),
    segmentIndex,
  };
}

function shouldKeepRoutePoint(routePoints = [], point) {
  if (!point) {
    return false;
  }

  if (
    typeof point.accuracy === 'number' &&
    Number.isFinite(point.accuracy) &&
    point.accuracy > LOCATION_ACCURACY_THRESHOLD
  ) {
    return false;
  }

  const lastPoint = routePoints[routePoints.length - 1];
  if (!lastPoint) {
    return true;
  }

  const distance = getDistanceMeters(lastPoint.latitude, lastPoint.longitude, point.latitude, point.longitude);
  const adaptiveMinimumDistance = Math.max(
    MIN_DISTANCE_TO_ADD_POINT,
    Math.min(10, (point.accuracy || 0) * STATIONARY_ACCURACY_FACTOR)
  );
  if (distance <= adaptiveMinimumDistance) {
    return false;
  }

  const lastRecordedAt = new Date(lastPoint.recordedAt || 0).getTime();
  const nextRecordedAt = new Date(point.recordedAt || 0).getTime();
  const elapsedMs = Number.isFinite(lastRecordedAt) && Number.isFinite(nextRecordedAt)
    ? Math.max(0, nextRecordedAt - lastRecordedAt)
    : 0;
  const elapsedSeconds = elapsedMs / 1000;
  const calculatedSpeed = elapsedSeconds > 0 ? distance / elapsedSeconds : 0;
  const reportedSpeed = typeof point.speed === 'number' && Number.isFinite(point.speed) ? point.speed : 0;

  if (
    distance >= GPS_JUMP_DISTANCE_THRESHOLD &&
    elapsedMs > 0 &&
    elapsedMs <= GPS_JUMP_TIME_THRESHOLD_MS &&
    Math.max(calculatedSpeed, reportedSpeed) > MAX_REASONABLE_WALKING_SPEED
  ) {
    return false;
  }

  return true;
}

function updateRoutePoints(routePoints = [], point) {
  if (!shouldKeepRoutePoint(routePoints, point)) {
    return routePoints;
  }

  return [...routePoints, point].slice(-ROUTE_POINT_MAX_COUNT);
}

function downsamplePoints(points = [], maxPoints = SAVED_ROUTE_POINT_MAX_COUNT) {
  if (points.length <= maxPoints) {
    return points;
  }
  const lastIndex = points.length - 1;
  const step = lastIndex / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)]).filter(Boolean);
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

function buildRouteSegment(segment = {}, endIndex = 0) {
  const startIndex = Number.isInteger(segment.startIndex) && segment.startIndex >= 0
    ? segment.startIndex
    : 0;
  return {
    id: segment.id,
    trackKey: segment.trackKey,
    ...getTrackSummary(segment.track || segment, segment.albumColor),
    startIndex,
    endIndex: Math.max(startIndex, Number.isInteger(endIndex) ? endIndex : startIndex),
    startedAt: segment.startedAt,
    endedAt: segment.endedAt || segment.lastUpdatedAt || '',
  };
}

function upsertRouteSegment(session, segment) {
  if (!segment?.id) return session.routeSegments || [];
  const endIndex = Math.max(0, (session.routePoints || []).length - 1);
  const nextSegment = buildRouteSegment(segment, endIndex);
  const routeSegments = Array.isArray(session.routeSegments) ? session.routeSegments : [];
  const existingIndex = routeSegments.findIndex((item) => item?.id === segment.id);
  if (existingIndex < 0) {
    return [...routeSegments, nextSegment].slice(-120);
  }
  return routeSegments.map((item, index) => (index === existingIndex ? nextSegment : item)).slice(-120);
}

function buildSegment(track, point, recordedAt, placeName, startIndex = 0) {
  const albumColor = getAlbumColor(track);
  return {
    id: buildRecordId('segment', track, recordedAt),
    track,
    trackKey: getTrackKey(track),
    ...getTrackSummary(track, albumColor),
    albumColor,
    albumArtUrl: getAlbumArtUrl(track),
    placeName,
    startedAt: recordedAt,
    lastUpdatedAt: recordedAt,
    startIndex,
    endIndex: startIndex,
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

function getStablePointForNewSegment(session, point) {
  const routePoints = Array.isArray(session.routePoints) ? session.routePoints : [];
  if (shouldKeepRoutePoint(routePoints, point)) {
    return point;
  }
  return routePoints[routePoints.length - 1] || point;
}

function buildTrackChangeMarker(track, point, recordedAt, fromTrackKey = '') {
  const albumColor = getAlbumColor(track);
  return {
    id: buildRecordId('change', track, recordedAt),
    fromTrackKey,
    toTrackKey: getTrackKey(track),
    trackKey: getTrackKey(track),
    ...getTrackSummary(track, albumColor),
    albumColor,
    location: point,
    recordedAt,
  };
}

async function resolveCurrentSegmentAlbumColor(sessionId, trackKey, track) {
  const resolvedColor = await resolveAlbumColor(track).catch(() => DEFAULT_ALBUM_COLOR);
  const session = await readSession();
  if (!session?.isActive || session.id !== sessionId) {
    return;
  }
  if (session.currentSegment?.trackKey !== trackKey) {
    return;
  }

  session.currentSegment = {
    ...session.currentSegment,
    ...getTrackSummary(session.currentSegment.track || track, resolvedColor),
    albumColor: resolvedColor,
  };
  session.routeSegments = upsertRouteSegment(session, session.currentSegment);
  session.trackChangeMarkers = Array.isArray(session.trackChangeMarkers)
    ? session.trackChangeMarkers.map((marker) => (
      marker?.trackKey === trackKey
        ? { ...marker, albumColor: resolvedColor }
        : marker
    ))
    : [];
  await maybeWriteSession(session, { force: true }).catch(() => null);
  notifySessionUpdated({
    ...session,
    maxDurationMs: MAX_RECORDING_DURATION_MS,
    elapsedMs: getElapsedMs(session),
  });
}

function scheduleAlbumColorResolution(session, track) {
  const trackKey = getTrackKey(track);
  if (!session?.id || !trackKey) return;
  resolveCurrentSegmentAlbumColor(session.id, trackKey, track).catch(() => null);
}

export function subscribeMusicMapRecordingSession(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
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

  const segmentRoutePoints = Array.isArray(segment.routePoints) ? segment.routePoints : [];
  const sessionRoutePoints = Array.isArray(session.routePoints) ? session.routePoints : [];
  const routePoints = segmentRoutePoints.length > 1 || (session.savedSegmentKeys || []).length > 0
    ? segmentRoutePoints
    : sessionRoutePoints;
  const renderableRoutePoints = downsamplePoints(getRenderableRoutePoints(routePoints));
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
      routeSegments: [buildRouteSegment({
        ...segment,
        startIndex: 0,
        endIndex: Math.max(0, renderableRoutePoints.length - 1),
      }, Math.max(0, renderableRoutePoints.length - 1))],
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
  const currentSegment = track && initialRoutePoint ? buildSegment(track, initialRoutePoint, now, placeName, 0) : null;
  const session = {
    id: `music-map-session-${Date.now()}`,
    isActive: true,
    userId: ownerId,
    placeName,
    startedAt: now,
    lastUpdatedAt: now,
    currentSegment,
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
    routeSegments: currentSegment ? [buildRouteSegment(currentSegment, 0)] : [],
    trackChangeMarkers: [],
  };

  await writeSession(session);
  if (track) {
    scheduleAlbumColorResolution(session, track);
  }
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

    if (currentSegment?.trackKey && !isSameTrack(currentSegment, track)) {
      const saved = await saveSegment(session, currentSegment, recordedAt).catch(() => null);
      if (saved) {
        savedRecords.push(saved);
      }
      session.savedSegmentKeys = [...(session.savedSegmentKeys || []), currentSegment.id].filter(Boolean).slice(-120);
      const point = getStablePointForNewSegment(session, buildRoutePoint(pointCoords, 0));
      session.routePoints = appendSessionRoutePoint(session, point);
      const startIndex = Math.max(0, (session.routePoints || []).length - 1);
      session.trackChangeMarkers = [
        ...(session.trackChangeMarkers || []),
        buildTrackChangeMarker(track, point, recordedAt, currentSegment.trackKey || ''),
      ].slice(-120);
      session.routeSegments = upsertRouteSegment(session, {
        ...currentSegment,
        endedAt: recordedAt,
      });
      session.currentSegment = buildSegment(track, point, recordedAt, placeName || session.placeName || '', startIndex);
      session.routeSegments = upsertRouteSegment(session, session.currentSegment);
      scheduleAlbumColorResolution(session, track);
    } else if (currentSegment?.trackKey && isSameTrack(currentSegment, track)) {
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
        ...getTrackSummary(track, currentSegment.albumColor || getAlbumColor(track)),
        albumColor: currentSegment.albumColor || getAlbumColor(track),
        albumArtUrl: getAlbumArtUrl(track) || currentSegment.albumArtUrl || '',
        placeName: placeName || currentSegment.placeName || session.placeName || '',
        routePoints: nextRoutePoints,
        endIndex: Math.max(currentSegment.startIndex || 0, (session.routePoints || []).length - 1),
        lastUpdatedAt: recordedAt,
        pausedAt: '',
        shouldBreakRoute: false,
      };
      session.routeSegments = upsertRouteSegment(session, session.currentSegment);
    } else {
      const point = getStablePointForNewSegment(session, buildRoutePoint(pointCoords, 0));
      session.routePoints = appendSessionRoutePoint(session, point);
      const startIndex = Math.max(0, (session.routePoints || []).length - 1);
      session.currentSegment = buildSegment(track, point, recordedAt, placeName || session.placeName || '', startIndex);
      session.routeSegments = upsertRouteSegment(session, session.currentSegment);
      scheduleAlbumColorResolution(session, track);
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
