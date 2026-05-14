import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useState, useEffect, useCallback, useContext, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { PlayerContext } from './PlayerContext';
import { useSession } from './SessionContext';
import {
  buildGeofenceRegions,
  cacheAutoPlayPlaces,
  consumePendingAutoPlay,
  findAutoPlayCandidate,
  getSavedPlacePlayTarget,
  markAutoPlayTriggered,
  readAutoPlayModeEnabled,
  readCachedAutoPlayPlaces,
  resolveAutoPlayPlaybackTarget,
  writePendingAutoPlay,
  writeAutoPlayModeEnabled,
} from '../services/autoPlayService';
import {
  getOrCreateAppUserId,
  getSavedPlaces,
  savePlayRecord,
} from '../services/firebaseService';
import { musicPlayerService } from '../services/musicPlayerService';
import {
  getMusicMapRecordingSession,
  MUSIC_MAP_RECORDING_MODES,
  recordCurrentMusicMapPlayback,
  startMusicMapRecordingSession,
  stopMusicMapRecordingSession,
  subscribeMusicMapRecordingSession,
} from '../services/musicMapRecordingService';
import {
  startMusicMapTrackPlaylistPlayback,
  stopMusicMapTrackPlaylistPlayback,
} from '../services/musicMapPlaylistPlaybackService';
import {
  cancelMusicMapSequentialPlaybackNotifications,
  consumeMusicMapPlaybackNotificationUrl,
  getInitialMusicMapPlaybackNotificationUrl,
  requestMusicMapPlaybackNotificationPermission,
  scheduleMusicMapSequentialPlaybackNotifications,
  subscribeMusicMapPlaybackNotificationPress,
} from '../services/musicMapNotificationService';
import { getCurrentWeather, isWeatherConfigured } from '../services/weatherService';
import { buildListeningContext, recordListeningEvent } from '../services/listeningHistoryService';

const LOCATION_TASK_NAME = 'nowhere-background-location';
const GEOFENCE_TASK_NAME = 'nowhere-geofence-autoplay';
const LOCATION_CACHE_KEY = '@nowhere/location-cache';
const PLACE_NAME_CACHE_KEY = '@nowhere/place-name-cache';
const WEATHER_CACHE_KEY = '@nowhere/weather-cache';
const BACKGROUND_TRACKING_KEY = '@nowhere/background-tracking-enabled';
const WEATHER_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PLACE_NAME_REFRESH_DISTANCE_M = 120;
const PLACE_NAME_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BACKGROUND_LOCATION_MAX_AGE_MS = 30 * 60 * 1000;
const AUTOPLAY_PLACE_REFRESH_INTERVAL_MS = 60 * 1000;
const LOCATION_STATE_MIN_DISTANCE_M = 5;
const LOCATION_STATE_MIN_INTERVAL_MS = 10000;
const MUSIC_MAP_STATIONARY_POLL_INTERVAL_MS = 12000;

function isAutoPlayPreparedState(state = {}) {
  const playbackStatus = String(state?.playbackStatus || state?.status || '').trim();
  return Boolean(
    state &&
    state.provider === 'spotify' &&
    state.available !== false &&
    ['openedSpotify', 'playing', 'preparingAutoPlay'].includes(playbackStatus)
  );
}

function hasSpotifyPlaybackUri(track = {}) {
  const uri = String(track?.spotifyUri || track?.uri || track?.spotifyUrl || track?.spotifyStartUrl || track?.spotifyPlaylistUrl || '').trim();
  return uri.startsWith('spotify:') || uri.startsWith('https://open.spotify.com/');
}

function serializeError(error) {
  return error?.message || '위치 정보를 가져오는 중 문제가 발생했습니다.';
}

function normalizeCoords(coords) {
  if (typeof coords?.latitude !== 'number' || typeof coords?.longitude !== 'number') {
    return null;
  }

  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy ?? null,
    altitude: coords.altitude ?? null,
    heading: coords.heading ?? null,
    speed: coords.speed ?? null,
  };
}

function getDistanceMeters(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;

  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const deltaLat = (b.latitude - a.latitude) * Math.PI / 180;
  const deltaLon = (b.longitude - a.longitude) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function shouldPublishLocationUpdate(previous, next, lastPublishedAt = 0) {
  if (!next || !previous) {
    return Boolean(next);
  }
  const movedEnough = getDistanceMeters(previous, next) >= LOCATION_STATE_MIN_DISTANCE_M;
  const waitedEnough = Date.now() - lastPublishedAt >= LOCATION_STATE_MIN_INTERVAL_MS;
  return movedEnough || waitedEnough;
}

function getMusicMapSessionSignature(session = {}) {
  const segment = session.currentSegment || {};
  const routePoints = Array.isArray(session.routePoints) && session.routePoints.length > 0
    ? session.routePoints
    : Array.isArray(segment.routePoints)
      ? segment.routePoints
      : [];
  const lastPoint = routePoints[routePoints.length - 1] || session.startLocation || {};
  return [
    session.isActive ? 'active' : 'inactive',
    session.id || '',
    session.startedAt || '',
    segment.trackKey || '',
    routePoints.length,
    Array.isArray(session.trackChangeMarkers) ? session.trackChangeMarkers.length : 0,
    Array.isArray(session.routeSegments) ? session.routeSegments.length : 0,
    segment.albumColor || '',
    typeof lastPoint.latitude === 'number' ? lastPoint.latitude.toFixed(5) : '',
    typeof lastPoint.longitude === 'number' ? lastPoint.longitude.toFixed(5) : '',
  ].join('|');
}

function pickNeighborhoodName(addresses = []) {
  const address = addresses.find(Boolean) || {};
  const candidates = [
    address.district,
    address.name,
    address.street,
    address.subregion,
    address.city,
    address.region,
  ];

  return candidates
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean) || '';
}

async function writeLocationCache(coords, source = 'foreground') {
  if (!coords) return;

  const payload = {
    coords,
    source,
    timestamp: Date.now(),
  };

  await AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(payload));
}

async function writePlaceNameCache(name, coords) {
  if (!name || !coords) return;
  await AsyncStorage.setItem(PLACE_NAME_CACHE_KEY, JSON.stringify({
    name,
    coords,
    timestamp: Date.now(),
  }));
}

async function readPlaceNameCache() {
  const raw = await AsyncStorage.getItem(PLACE_NAME_CACHE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    await AsyncStorage.removeItem(PLACE_NAME_CACHE_KEY);
    return null;
  }
}

async function readLocationCache() {
  const raw = await AsyncStorage.getItem(LOCATION_CACHE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    await AsyncStorage.removeItem(LOCATION_CACHE_KEY);
    return null;
  }
}

async function writeWeatherCache(weather) {
  if (!weather) return;
  await AsyncStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
    data: weather,
    timestamp: Date.now(),
  }));
}

async function readWeatherCache() {
  const raw = await AsyncStorage.getItem(WEATHER_CACHE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    await AsyncStorage.removeItem(WEATHER_CACHE_KEY);
    return null;
  }
}

async function tryBackgroundAutoPlay(place, source) {
  const isAutoPlayEnabled = await readAutoPlayModeEnabled();
  if (!isAutoPlayEnabled) {
    return;
  }

  const target = getSavedPlacePlayTarget(place);
  if (!target) {
    return;
  }

  try {
    const playbackTarget = await resolveAutoPlayPlaybackTarget(target);
    const trackToPlay = playbackTarget?.track || target;
    const queueToPlay = playbackTarget?.queue?.length ? playbackTarget.queue : [trackToPlay];
    if (!hasSpotifyPlaybackUri(trackToPlay)) {
      throw new Error('자동재생할 Spotify URI가 없습니다.');
    }
    await musicPlayerService.playInBackground(trackToPlay, queueToPlay);
    await markAutoPlayTriggered(place.id);
  } catch (error) {
    await writeAutoPlayModeEnabled(false).catch(() => {});
    await writePendingAutoPlay(place, source);
  }
}

async function tryBackgroundMusicMapRecord(coords) {
  const session = await getMusicMapRecordingSession().catch(() => null);
  if (!session?.isActive) {
    return;
  }
  if ((session.recordingMode || MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL) === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL) {
    return;
  }

  const playbackState = session.recordingMode === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING
    ? await musicPlayerService.getState().catch(() => null)
    : null;

  await recordCurrentMusicMapPlayback({
    coords,
    allowPlaybackPolling: session.recordingMode === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING,
    playbackState,
    source: 'background',
  }).catch(() => {});
}

if (Platform.OS !== 'web' && typeof TaskManager.defineTask === 'function' && !TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      return;
    }

    const locations = data?.locations || [];
    const nextLocation = locations[locations.length - 1];
    const coords = normalizeCoords(nextLocation?.coords);

    if (!coords) {
      return;
    }

    await writeLocationCache(coords, 'background');
    await tryBackgroundMusicMapRecord(coords);

    const isAutoPlayEnabled = await readAutoPlayModeEnabled().catch(() => false);
    if (!isAutoPlayEnabled) {
      return;
    }

    const cachedPlaces = await readCachedAutoPlayPlaces();
    const candidate = await findAutoPlayCandidate(coords, cachedPlaces);
    if (candidate) {
      await tryBackgroundAutoPlay(candidate, 'background-location');
    }
  });
}

if (Platform.OS !== 'web' && typeof TaskManager.defineTask === 'function' && !TaskManager.isTaskDefined(GEOFENCE_TASK_NAME)) {
  TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
    if (error) {
      return;
    }

    if (data?.eventType !== Location.GeofencingEventType.Enter) {
      return;
    }

    const placeId = data?.region?.identifier;
    const cachedPlaces = await readCachedAutoPlayPlaces();
    const matchingPlace = cachedPlaces.find((place) => String(place.id) === String(placeId));
    if (matchingPlace) {
      await tryBackgroundAutoPlay(matchingPlace, 'geofence-enter');
    }
  });
}

export const LocationContext = createContext(null);

export function LocationProvider({ children }) {
  const player = useContext(PlayerContext);
  const { authUser, isFirebaseConfigured, isLoading: isSessionLoading } = useSession();
  const [location, setLocation] = useState(null);
  const [lastKnownLocation, setLastKnownLocation] = useState(null);
  const [placeName, setPlaceName] = useState('');
  const [foregroundPermission, setForegroundPermission] = useState('undetermined');
  const [backgroundPermission, setBackgroundPermission] = useState('undetermined');
  const [weather, setWeather] = useState(null);
  const [isLocating, setIsLocating] = useState(true);
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);
  const [backgroundTrackingEnabled, setBackgroundTrackingEnabled] = useState(false);
  const [autoPlayModeEnabled, setAutoPlayModeEnabledState] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [autoPlayStatus, setAutoPlayStatus] = useState({ status: 'idle', place: null, error: null });
  const [musicMapRecording, setMusicMapRecording] = useState({
    isActive: false,
    elapsedMs: 0,
    maxDurationMs: 60 * 60 * 1000,
  });
  const [lastWeatherFetchedAt, setLastWeatherFetchedAt] = useState(0);
  const autoPlayPlacesRef = useRef({ places: [], fetchedAt: 0 });
  const autoPlayInFlightRef = useRef(false);
  const autoPlayColdStartOffAppliedRef = useRef(false);
  const autoPlayModeEnabledRef = useRef(false);
  const autoPlayBackgroundEnsureInFlightRef = useRef(false);
  const hasBackgroundPermissionRef = useRef(false);
  const musicMapActionTokenRef = useRef(0);
  const musicMapStopRequestedRef = useRef(false);
  const playerRef = useRef(player);
  const locationRef = useRef(null);
  const lastLocationPublishedAtRef = useRef(0);
  const weatherRef = useRef(null);
  const lastWeatherFetchedAtRef = useRef(0);
  const musicMapRecordingRef = useRef({
    isActive: false,
    elapsedMs: 0,
    maxDurationMs: 60 * 60 * 1000,
  });
  const musicMapRecordingSignatureRef = useRef('inactive||||||');
  const placeNameRef = useRef({ name: '', coords: null, timestamp: 0 });
  const hasForegroundPermission = foregroundPermission === 'granted';
  const hasBackgroundPermission = backgroundPermission === 'granted';

  const publishLocationState = useCallback((coords) => {
    if (!coords) {
      locationRef.current = null;
      setLocation(null);
      return false;
    }

    const previous = locationRef.current;
    locationRef.current = coords;
    setLastKnownLocation(coords);

    if (!shouldPublishLocationUpdate(previous, coords, lastLocationPublishedAtRef.current)) {
      return false;
    }

    lastLocationPublishedAtRef.current = Date.now();
    setLocation(coords);
    return true;
  }, []);

  const refreshMusicMapRecording = useCallback(async () => {
    const session = await getMusicMapRecordingSession();
    musicMapRecordingRef.current = session;
    musicMapRecordingSignatureRef.current = getMusicMapSessionSignature(session);
    setMusicMapRecording(session);
    return session;
  }, []);

  const recordMusicMapPlaybackAndSync = useCallback(async (coords, placeNameValue = '') => {
    const activeSession = musicMapRecordingRef.current;
    if (!activeSession?.isActive) {
      return { recorded: false, reason: 'inactive' };
    }

    const cachedPlayer = playerRef.current;
    const recordingMode = activeSession.recordingMode || MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL;
    const shouldReadSpotifyState = recordingMode === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING;
    const playbackState = shouldReadSpotifyState && typeof cachedPlayer?.getState === 'function'
      ? await cachedPlayer.getState().catch(() => null)
      : {
        currentTrack: cachedPlayer?.currentTrack || null,
        isPlaying: Boolean(cachedPlayer?.isPlaying),
        playbackStatus: cachedPlayer?.playerStatus?.playbackStatus || '',
        authorizationStatus: cachedPlayer?.playerStatus?.authorizationStatus || '',
        isAuthorized: Boolean(cachedPlayer?.playerStatus?.isAuthorized),
      };
    const result = await recordCurrentMusicMapPlayback({
      coords,
      placeName: placeNameValue,
      allowPlaybackPolling: shouldReadSpotifyState,
      playbackState,
      source: 'foreground',
    }).catch(() => null);
    if (result?.session) {
      const nextSession = {
        ...result.session,
        maxDurationMs: result.session.maxDurationMs || 60 * 60 * 1000,
      };
      const nextSignature = getMusicMapSessionSignature(nextSession);
      musicMapRecordingRef.current = nextSession;
      if (nextSignature !== musicMapRecordingSignatureRef.current) {
        musicMapRecordingSignatureRef.current = nextSignature;
        setMusicMapRecording(nextSession);
      }
    }
    return result;
  }, []);

  useEffect(() => {
    if (!musicMapRecording.isActive) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      const coords = locationRef.current;
      if (!coords) {
        return;
      }
      recordMusicMapPlaybackAndSync(coords, placeNameRef.current?.name || '');
    }, MUSIC_MAP_STATIONARY_POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [musicMapRecording.isActive, recordMusicMapPlaybackAndSync]);

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    autoPlayModeEnabledRef.current = autoPlayModeEnabled;
  }, [autoPlayModeEnabled]);

  useEffect(() => {
    hasBackgroundPermissionRef.current = hasBackgroundPermission;
  }, [hasBackgroundPermission]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    weatherRef.current = weather;
  }, [weather]);

  useEffect(() => {
    lastWeatherFetchedAtRef.current = lastWeatherFetchedAt;
  }, [lastWeatherFetchedAt]);

  useEffect(() => {
    musicMapRecordingRef.current = musicMapRecording;
    musicMapRecordingSignatureRef.current = getMusicMapSessionSignature(musicMapRecording);
  }, [musicMapRecording]);

  useEffect(() => subscribeMusicMapRecordingSession((session) => {
    const nextSession = {
      ...session,
      maxDurationMs: session.maxDurationMs || 60 * 60 * 1000,
    };
    const nextSignature = getMusicMapSessionSignature(nextSession);
    musicMapRecordingRef.current = nextSession;
    if (nextSignature !== musicMapRecordingSignatureRef.current) {
      musicMapRecordingSignatureRef.current = nextSignature;
      setMusicMapRecording(nextSession);
    }
  }), []);

  const refreshAutoPlayPlaces = useCallback(async ({ force = false } = {}) => {
    if (isFirebaseConfigured && isSessionLoading) {
      const cachedPlaces = await readCachedAutoPlayPlaces();
      autoPlayPlacesRef.current = { places: cachedPlaces, fetchedAt: Date.now() };
      return cachedPlaces;
    }

    const currentCache = autoPlayPlacesRef.current;
    if (!force && currentCache.fetchedAt && Date.now() - currentCache.fetchedAt < AUTOPLAY_PLACE_REFRESH_INTERVAL_MS) {
      return currentCache.places;
    }

    try {
      const ownerId = authUser?.uid && !authUser.isAnonymous
        ? authUser.uid
        : await getOrCreateAppUserId();
      const places = await getSavedPlaces(ownerId);
      const activePlaces = await cacheAutoPlayPlaces(places);
      autoPlayPlacesRef.current = { places: activePlaces, fetchedAt: Date.now() };
      return activePlaces;
    } catch (error) {
      const cachedPlaces = await readCachedAutoPlayPlaces();
      autoPlayPlacesRef.current = { places: cachedPlaces, fetchedAt: Date.now() };
      return cachedPlaces;
    }
  }, [authUser?.isAnonymous, authUser?.uid, isFirebaseConfigured, isSessionLoading]);

  const stopGeofenceRegions = useCallback(async () => {
    if (Platform.OS === 'web') {
      return;
    }

    try {
      if (typeof Location.hasStartedGeofencingAsync === 'function') {
        const geofenceStarted = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
        if (geofenceStarted) {
          await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
        }
        return;
      }

      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {});
    } catch (error) {
      // Geofence 정리는 부가 작업이다. 실패해도 위치/추천 화면을 흔들지 않는다.
    }
  }, []);

  const syncGeofenceRegions = useCallback(async (places) => {
    if (Platform.OS === 'web') {
      return;
    }

    const regions = buildGeofenceRegions(places);
    if (regions.length === 0) {
      await stopGeofenceRegions();
      return;
    }

    try {
      await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
    } catch (error) {
      setLocationError((prev) => prev || serializeError(error));
    }
  }, [stopGeofenceRegions]);

  const reloadAutoPlayPlaces = useCallback(async () => {
    const places = await refreshAutoPlayPlaces({ force: true });
    await syncGeofenceRegions(places);
    return places;
  }, [refreshAutoPlayPlaces, syncGeofenceRegions]);

  const executeAutoPlay = useCallback(async (place, source = 'foreground', coords = null) => {
    if (!autoPlayModeEnabledRef.current || !hasBackgroundPermissionRef.current || !place || autoPlayInFlightRef.current) {
      return null;
    }

    const target = getSavedPlacePlayTarget(place);
    if (!target) {
      return null;
    }

    autoPlayInFlightRef.current = true;
    setAutoPlayStatus({ status: 'loading', place, error: null });

    try {
      const playbackTarget = await resolveAutoPlayPlaybackTarget(target);
      const trackToPlay = playbackTarget?.track || target;
      const queueToPlay = playbackTarget?.queue?.length ? playbackTarget.queue : [trackToPlay];
      const playAndRecordTrack = async (nextTrack, nextQueue = []) => {
        const nextTrackToPlay = nextTrack || trackToPlay;
        const nextQueueToPlay = nextQueue?.length ? nextQueue : [nextTrackToPlay];
        if (!hasSpotifyPlaybackUri(nextTrackToPlay)) {
          throw new Error('자동재생할 Spotify URI가 없습니다.');
        }

        let playbackState;
        if (playerRef.current?.playInBackground) {
          playbackState = await playerRef.current.playInBackground(nextTrackToPlay, nextQueueToPlay);
        } else {
          playbackState = await musicPlayerService.playInBackground(nextTrackToPlay, nextQueueToPlay);
        }

        recordListeningEvent({
          userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
          track: nextTrackToPlay,
          source: queueToPlay.length > 1 ? 'autoplay-playlist' : 'autoplay',
          recommendationSlot: 'place-autoplay',
          context: buildListeningContext({
            location: coords || locationRef.current,
            weather: weatherRef.current,
            place,
            savedPlaceId: place.id,
          }),
        }).catch(() => {});

        if (isFirebaseConfigured && authUser?.uid && !authUser.isAnonymous) {
          savePlayRecord({
            userId: authUser.uid,
            trackId: nextTrackToPlay.id || nextTrackToPlay.spotifyUri,
            title: nextTrackToPlay.title,
            artist: nextTrackToPlay.artist || 'Unknown Artist',
            albumArtUrl: nextTrackToPlay.artworkUrl,
            provider: nextTrackToPlay.provider || 'spotify',
            placeName: place.name,
            savedPlaceId: place.id,
            latitude: coords?.latitude ?? place.lat ?? place.coordinates?.latitude,
            longitude: coords?.longitude ?? place.lon ?? place.coordinates?.longitude,
          }).catch(() => {});
        }

        return playbackState;
      };

      await startMusicMapTrackPlaylistPlayback(
        queueToPlay,
        playAndRecordTrack,
        (nextError) => {
          setAutoPlayStatus({
            status: 'error',
            place,
            error: nextError?.message || '자동재생 플레이리스트 다음 곡 재생에 실패했습니다.',
          });
        },
        () => {},
        'autoplay'
      );
      await markAutoPlayTriggered(place.id);
      setAutoPlayStatus({ status: 'playing', place, error: null });

      return place;
    } catch (error) {
      await writeAutoPlayModeEnabled(false).catch(() => {});
      autoPlayModeEnabledRef.current = false;
      setAutoPlayModeEnabledState(false);
      setAutoPlayStatus({ status: 'error', place, error: error.message || '자동재생에 실패했습니다.' });
      return null;
    } finally {
      autoPlayInFlightRef.current = false;
    }
  }, [authUser?.isAnonymous, authUser?.uid, isFirebaseConfigured]);

  const evaluateAutoPlay = useCallback(async (coords, source = 'foreground') => {
    if (!autoPlayModeEnabledRef.current || !hasBackgroundPermissionRef.current) {
      return;
    }

    const places = await refreshAutoPlayPlaces();
    const candidate = await findAutoPlayCandidate(coords, places);
    if (candidate) {
      await executeAutoPlay(candidate, source, coords);
    }
  }, [executeAutoPlay, refreshAutoPlayPlaces]);

  const refreshPermissions = useCallback(async () => {
    const foreground = await Location.getForegroundPermissionsAsync();
    const background = Platform.OS === 'web'
      ? { status: 'denied' }
      : await Location.getBackgroundPermissionsAsync();

    setForegroundPermission(foreground.status);
    setBackgroundPermission(background.status);
    hasBackgroundPermissionRef.current = background.status === 'granted';

    return {
      foreground: foreground.status,
      background: background.status,
      hasForegroundPermission: foreground.status === 'granted',
      hasBackgroundPermission: background.status === 'granted',
    };
  }, []);

  const refreshWeather = useCallback(async (coords, { force = false } = {}) => {
    if (!coords || !isWeatherConfigured()) {
      return null;
    }

    const shouldSkip = !force &&
      lastWeatherFetchedAtRef.current > 0 &&
      Date.now() - lastWeatherFetchedAtRef.current < WEATHER_REFRESH_INTERVAL_MS;
    if (shouldSkip) {
      return weatherRef.current;
    }

    try {
      setIsFetchingWeather(true);
      const nextWeather = await getCurrentWeather(coords.latitude, coords.longitude);
      weatherRef.current = nextWeather;
      lastWeatherFetchedAtRef.current = Date.now();
      setWeather(nextWeather);
      setLastWeatherFetchedAt(lastWeatherFetchedAtRef.current);
      await writeWeatherCache(nextWeather);
      return nextWeather;
    } catch (error) {
      lastWeatherFetchedAtRef.current = Date.now();
      setLastWeatherFetchedAt(lastWeatherFetchedAtRef.current);
      return weatherRef.current;
    } finally {
      setIsFetchingWeather(false);
    }
  }, []);

  const refreshPlaceName = useCallback(async (coords, { force = false } = {}) => {
    if (!coords) {
      return '';
    }

    const current = placeNameRef.current;
    const isFreshEnough = current.timestamp && Date.now() - current.timestamp < PLACE_NAME_CACHE_MAX_AGE_MS;
    const isCloseEnough = getDistanceMeters(coords, current.coords) < PLACE_NAME_REFRESH_DISTANCE_M;
    if (!force && current.name && isFreshEnough && isCloseEnough) {
      setPlaceName(current.name);
      return current.name;
    }

    try {
      const addresses = await Location.reverseGeocodeAsync({
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      const nextName = pickNeighborhoodName(addresses);
      if (nextName) {
        const payload = { name: nextName, coords, timestamp: Date.now() };
        placeNameRef.current = payload;
        setPlaceName(nextName);
        await writePlaceNameCache(nextName, coords);
        return nextName;
      }
    } catch (error) {
      // 위치명은 부가 정보이므로 실패해도 위치/날씨/자동재생 흐름은 유지한다.
    }

    return current.name || '';
  }, []);

  const refreshLocation = useCallback(async ({ forceWeather = false } = {}) => {
    const permissions = await refreshPermissions();

    if (!permissions.hasForegroundPermission) {
      setIsLocating(false);
      setLocation(null);
      return null;
    }

    try {
      setIsLocating(true);
      setLocationError(null);

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = normalizeCoords(current?.coords);
      publishLocationState(coords);
      await writeLocationCache(coords, 'foreground');
      await refreshPlaceName(coords);
      await refreshWeather(coords, { force: forceWeather });
      await evaluateAutoPlay(coords, 'foreground-refresh');
      recordMusicMapPlaybackAndSync(coords, placeNameRef.current?.name || '');
      return coords;
    } catch (error) {
      const cached = await Location.getLastKnownPositionAsync();
      const fallback = normalizeCoords(cached?.coords);

      if (fallback) {
        publishLocationState(fallback);
        await writeLocationCache(fallback, 'last-known');
        await refreshPlaceName(fallback);
        await refreshWeather(fallback, { force: forceWeather });
        await evaluateAutoPlay(fallback, 'last-known');
        recordMusicMapPlaybackAndSync(fallback, placeNameRef.current?.name || '');
      }

      setLocationError(serializeError(error));
      return fallback;
    } finally {
      setIsLocating(false);
    }
  }, [evaluateAutoPlay, publishLocationState, recordMusicMapPlaybackAndSync, refreshPermissions, refreshPlaceName, refreshWeather]);

  const requestPermissions = useCallback(async () => {
    setLocationError(null);
    const foreground = await Location.requestForegroundPermissionsAsync();
    const nextForeground = foreground.status;

    setForegroundPermission(nextForeground);

    if (nextForeground !== 'granted') {
      setBackgroundPermission('denied');
      hasBackgroundPermissionRef.current = false;
      await writeAutoPlayModeEnabled(false);
      autoPlayModeEnabledRef.current = false;
      setAutoPlayModeEnabledState(false);
      setLocation(null);
      setIsLocating(false);
      setLocationError('위치 권한이 허용되지 않았습니다.');
      return {
        foreground: nextForeground,
        background: 'denied',
        hasForegroundPermission: false,
        hasBackgroundPermission: false,
      };
    }

    let nextBackground = backgroundPermission;
    if (Platform.OS !== 'web') {
      const background = await Location.requestBackgroundPermissionsAsync();
      nextBackground = background.status;
      setBackgroundPermission(nextBackground);
      hasBackgroundPermissionRef.current = nextBackground === 'granted';
    }

    await refreshLocation({ forceWeather: true });

    await writeAutoPlayModeEnabled(false);
    autoPlayModeEnabledRef.current = false;
    setAutoPlayModeEnabledState(false);

    return {
      foreground: nextForeground,
      background: nextBackground,
      hasForegroundPermission: true,
      hasBackgroundPermission: nextBackground === 'granted',
    };
  }, [backgroundPermission, refreshLocation]);

  const startBackgroundTracking = useCallback(async ({ syncPlaces = true, musicMapOnly = false } = {}) => {
    if (Platform.OS === 'web') {
      setLocationError('웹에서는 백그라운드 위치 추적을 지원하지 않습니다.');
      return false;
    }

    const permissions = await refreshPermissions();
    if (!permissions.hasForegroundPermission || !permissions.hasBackgroundPermission) {
      const requested = await requestPermissions();
      if (!requested.hasForegroundPermission || !requested.hasBackgroundPermission) {
        setLocationError('백그라운드 위치 권한이 필요합니다.');
        return false;
      }
    }

    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (!alreadyStarted) {
      const trackingOptions = musicMapOnly
        ? {
          accuracy: Location.Accuracy.Balanced,
          activityType: Location.ActivityType.Other,
          distanceInterval: 80,
          timeInterval: 90000,
          deferredUpdatesDistance: 180,
          deferredUpdatesInterval: 300000,
          pausesUpdatesAutomatically: true,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'NOWHERE 뮤직지도',
            notificationBody: '기록 중인 이동 경로를 가볍게 확인하고 있어요.',
            killServiceOnDestroy: false,
          },
        }
        : {
          accuracy: Location.Accuracy.Balanced,
          activityType: Location.ActivityType.OtherNavigation,
          distanceInterval: 50,
          timeInterval: 60000,
          deferredUpdatesDistance: 100,
          deferredUpdatesInterval: 300000,
          pausesUpdatesAutomatically: true,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'NOWHERE 위치 감지',
            notificationBody: '저장한 장소 도착을 감지하기 위해 위치를 확인하고 있어요.',
            killServiceOnDestroy: false,
          },
        };
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        ...trackingOptions,
      });
    }

    if (syncPlaces) {
      const autoPlayPlaces = await refreshAutoPlayPlaces({ force: true });
      await syncGeofenceRegions(autoPlayPlaces);
    }

    await AsyncStorage.setItem(BACKGROUND_TRACKING_KEY, 'true');
    setBackgroundTrackingEnabled(true);
    return true;
  }, [refreshAutoPlayPlaces, refreshPermissions, requestPermissions, syncGeofenceRegions]);

  useEffect(() => {
    if (
      Platform.OS === 'web'
      || !autoPlayModeEnabled
      || !hasForegroundPermission
      || !hasBackgroundPermission
      || autoPlayBackgroundEnsureInFlightRef.current
    ) {
      return;
    }

    autoPlayBackgroundEnsureInFlightRef.current = true;
    startBackgroundTracking({ syncPlaces: true, musicMapOnly: false })
      .catch((error) => {
        setLocationError(serializeError(error));
      })
      .finally(() => {
        autoPlayBackgroundEnsureInFlightRef.current = false;
      });
  }, [autoPlayModeEnabled, hasBackgroundPermission, hasForegroundPermission, startBackgroundTracking]);

  const setAutoPlayModeEnabled = useCallback(async (enabled) => {
    if (!enabled) {
      await writeAutoPlayModeEnabled(false);
      autoPlayModeEnabledRef.current = false;
      setAutoPlayModeEnabledState(false);
      return false;
    }

    const trackingStarted = await startBackgroundTracking().catch((error) => {
      setLocationError(serializeError(error));
      return false;
    });

    const permissions = await refreshPermissions();
    const nextEnabled = Boolean(trackingStarted && permissions.hasBackgroundPermission);
    await writeAutoPlayModeEnabled(nextEnabled);
    autoPlayModeEnabledRef.current = nextEnabled;
    setAutoPlayModeEnabledState(nextEnabled);

    if (!nextEnabled) {
      await AsyncStorage.setItem(BACKGROUND_TRACKING_KEY, 'false');
      setBackgroundTrackingEnabled(false);
    }

    return nextEnabled;
  }, [refreshPermissions, startBackgroundTracking]);

  const prepareAutoPlayMode = useCallback(async () => {
    const places = await refreshAutoPlayPlaces({ force: true }).catch(() => readCachedAutoPlayPlaces());
    const primerPlace = places.find((place) => getSavedPlacePlayTarget(place));
    const primerTarget = primerPlace ? getSavedPlacePlayTarget(primerPlace) : null;
    if (!primerTarget) {
      await setAutoPlayModeEnabled(false);
      throw new Error('AUTO ON을 준비하려면 먼저 자동재생 장소와 재생할 Spotify 곡을 저장해주세요.');
    }
    if (!hasSpotifyPlaybackUri(primerTarget)) {
      await setAutoPlayModeEnabled(false);
      throw new Error('AUTO ON을 준비하려면 Spotify URI가 저장된 자동재생 곡이 필요합니다.');
    }

    const state = await playerRef.current?.prepareAutoPlay?.(primerTarget);
    if (!isAutoPlayPreparedState(state)) {
      await setAutoPlayModeEnabled(false);
      throw new Error('Spotify 실행 상태를 확인하지 못했습니다. AUTO는 OFF로 유지합니다.');
    }

    const enabled = await setAutoPlayModeEnabled(true);
    if (!enabled) {
      throw new Error('백그라운드 위치 권한이 없어 AUTO를 켤 수 없습니다.');
    }
    return state;
  }, [refreshAutoPlayPlaces, setAutoPlayModeEnabled]);

  const forceAutoPlayOff = useCallback(async () => {
    await writeAutoPlayModeEnabled(false);
    await AsyncStorage.setItem(BACKGROUND_TRACKING_KEY, 'false');
    autoPlayModeEnabledRef.current = false;
    setAutoPlayModeEnabledState(false);
    setBackgroundTrackingEnabled(false);
    setAutoPlayStatus({ status: 'idle', place: null, error: null });
  }, []);

  const stopBackgroundTracking = useCallback(async () => {
    if (Platform.OS !== 'web') {
      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (alreadyStarted) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
      await stopGeofenceRegions();
    }

    await AsyncStorage.setItem(BACKGROUND_TRACKING_KEY, 'false');
    setBackgroundTrackingEnabled(false);
    return true;
  }, [stopGeofenceRegions]);

  const recordMusicMapPlaybackNow = useCallback(async () => {
    const coords = locationRef.current;
    if (!coords) {
      return { recorded: false, reason: 'missing-location' };
    }
    return recordMusicMapPlaybackAndSync(coords, placeNameRef.current?.name || '');
  }, [recordMusicMapPlaybackAndSync]);

  const handleMusicMapPlaybackNotificationUrl = useCallback(async (url = '') => {
    const payload = await consumeMusicMapPlaybackNotificationUrl(url);
    if (!payload?.track) {
      return false;
    }

    const openSpotify = playerRef.current?.openInSpotify || musicPlayerService.openInSpotify;
    const trackWithoutContext = {
      ...payload.track,
      spotifyContextUri: '',
      contextUri: '',
    };
    const queueWithoutContext = (payload.queue?.length ? payload.queue : [payload.track]).map((queuedTrack) => ({
      ...queuedTrack,
      spotifyContextUri: '',
      contextUri: '',
    }));

    await openSpotify(trackWithoutContext, queueWithoutContext);
    await recordMusicMapPlaybackNow().catch(() => null);
    return true;
  }, [recordMusicMapPlaybackNow]);

  useEffect(() => {
    let mounted = true;
    const handleUrl = (url) => {
      if (!url) {
        return;
      }
      handleMusicMapPlaybackNotificationUrl(url).catch((error) => {
        if (mounted) {
          setLocationError(error?.message || 'Spotify에서 다음 곡을 여는 데 실패했어요.');
        }
      });
    };

    const linkingSubscription = Linking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });
    const notificationSubscription = subscribeMusicMapPlaybackNotificationPress(handleUrl);
    getInitialMusicMapPlaybackNotificationUrl()
      .then(handleUrl)
      .catch(() => null);

    return () => {
      mounted = false;
      linkingSubscription.remove();
      notificationSubscription.remove();
    };
  }, [handleMusicMapPlaybackNotificationUrl]);

  const startMusicMapRecording = useCallback(async ({
    trackPlaylist = [],
    playlist = null,
    recordingMode = MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL,
  } = {}) => {
    const actionToken = musicMapActionTokenRef.current + 1;
    musicMapActionTokenRef.current = actionToken;
    musicMapStopRequestedRef.current = false;

    const playlistTracks = Array.isArray(trackPlaylist) ? trackPlaylist.filter(Boolean) : [];
    const mode = Object.values(MUSIC_MAP_RECORDING_MODES).includes(recordingMode)
      ? recordingMode
      : MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL;

    if (mode === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL && playlistTracks.length === 0) {
      throw new Error('플레이리스트에 곡을 먼저 추가해주세요.');
    }

    if (mode === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL && !hasSpotifyPlaybackUri(playlistTracks[0])) {
      throw new Error('Spotify에서 열 수 있는 곡을 추가해주세요.');
    }

    if (mode === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL) {
      requestMusicMapPlaybackNotificationPermission().catch(() => {});
    }

    if (musicMapStopRequestedRef.current || musicMapActionTokenRef.current !== actionToken) {
      throw new Error('뮤직지도 기록 시작이 취소되었습니다.');
    }

    let initialPlaybackState = null;
    let initialTrack = playlistTracks[0] || null;

    if (mode === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING) {
      if (playerRef.current?.getState) {
        initialPlaybackState = await playerRef.current.getState().catch(() => null);
      } else {
        initialPlaybackState = await musicPlayerService.getState().catch(() => null);
      }
      initialTrack = initialPlaybackState?.currentTrack || null;
      if (!initialTrack) {
        throw new Error('아직 고급모드 권한 요청이 허용되지 않았습니다. \n 1~20분 후에 다시 시도해주세요.');
      }
    }

    if (musicMapStopRequestedRef.current || musicMapActionTokenRef.current !== actionToken) {
      stopMusicMapTrackPlaylistPlayback('music-map');
      throw new Error('뮤직지도 기록 시작이 취소되었습니다.');
    }

    const session = await startMusicMapRecordingSession({
      userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
      coords: locationRef.current,
      placeName: placeNameRef.current?.name || '',
      initialTrack,
      initialPlaybackState,
      trackPlaylist: playlistTracks,
      playlist,
      recordingMode: mode,
    });

    if (musicMapStopRequestedRef.current || musicMapActionTokenRef.current !== actionToken) {
      await stopMusicMapRecordingSession().catch(() => {});
      throw new Error('뮤직지도 기록 시작이 취소되었습니다.');
    }

    musicMapRecordingRef.current = session;
    musicMapRecordingSignatureRef.current = getMusicMapSessionSignature(session);
    setMusicMapRecording(session);

    if (mode === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL) {
      const playSequentialTrack = async (nextTrack, nextQueue = []) => {
        const nextTrackToPlay = nextTrack || playlistTracks[0];
        const nextQueueToPlay = nextQueue?.length ? nextQueue : [nextTrackToPlay];
        if (!hasSpotifyPlaybackUri(nextTrackToPlay)) {
          throw new Error('Spotify에서 다음 곡을 여는 데 실패했어요.');
        }
        const openSpotify = playerRef.current?.openInSpotify || musicPlayerService.openInSpotify;
        const trackWithoutContext = { ...nextTrackToPlay, spotifyContextUri: '', contextUri: '' };
        const queueWithoutContext = nextQueueToPlay.map((queuedTrack) => ({
          ...queuedTrack,
          spotifyContextUri: '',
          contextUri: '',
        }));
        let playbackState;
        try {
          playbackState = await openSpotify(trackWithoutContext, queueWithoutContext);
        } catch (error) {
          throw new Error('Spotify에서 다음 곡을 여는 데 실패했어요.');
        }
        await recordMusicMapPlaybackNow();
        return playbackState;
      };

      try {
        await startMusicMapTrackPlaylistPlayback(
          playlistTracks,
          playSequentialTrack,
          (nextError) => {
            setLocationError(nextError?.message || 'Spotify에서 다음 곡을 여는 데 실패했어요.');
          },
          async () => {
            stopMusicMapTrackPlaylistPlayback('music-map');
            cancelMusicMapSequentialPlaybackNotifications('music-map').catch(() => {});
            const stopped = await stopMusicMapRecordingSession().catch(() => null);
            const stoppedState = stopped || {
              isActive: false,
              elapsedMs: 0,
              maxDurationMs: 60 * 60 * 1000,
            };
            musicMapRecordingRef.current = stoppedState;
            musicMapRecordingSignatureRef.current = getMusicMapSessionSignature(stoppedState);
            setMusicMapRecording(stoppedState);
          },
          'music-map'
        );
      } catch (error) {
        stopMusicMapTrackPlaylistPlayback('music-map');
        await stopMusicMapRecordingSession().catch(() => {});
        const stoppedState = {
          isActive: false,
          elapsedMs: 0,
          maxDurationMs: 60 * 60 * 1000,
        };
        musicMapRecordingRef.current = stoppedState;
        musicMapRecordingSignatureRef.current = getMusicMapSessionSignature(stoppedState);
        setMusicMapRecording(stoppedState);
        throw error;
      }
    }

    if (mode === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING) {
      startBackgroundTracking({ syncPlaces: false, musicMapOnly: true })
        .then((started) => {
          if (!started) {
            setLocationError('백그라운드 위치 권한이 필요합니다.');
          }
        })
        .catch((error) => {
          setLocationError(serializeError(error));
        });
    }

    if (locationRef.current) {
      recordMusicMapPlaybackAndSync(locationRef.current, placeNameRef.current?.name || '');
    }

    return session;
  }, [authUser?.isAnonymous, authUser?.uid, recordMusicMapPlaybackAndSync, recordMusicMapPlaybackNow, startBackgroundTracking]);

  const stopMusicMapRecording = useCallback(async () => {
    musicMapStopRequestedRef.current = true;
    musicMapActionTokenRef.current += 1;
    stopMusicMapTrackPlaylistPlayback('music-map');
    cancelMusicMapSequentialPlaybackNotifications('music-map').catch(() => {});
    const stoppedState = {
      isActive: false,
      elapsedMs: 0,
      maxDurationMs: 60 * 60 * 1000,
    };
    musicMapRecordingRef.current = stoppedState;
    musicMapRecordingSignatureRef.current = getMusicMapSessionSignature(stoppedState);
    setMusicMapRecording(stoppedState);

    let savedSession = stoppedState;
    try {
      savedSession = await stopMusicMapRecordingSession();
      const nextStoppedState = {
        ...stoppedState,
        ...savedSession,
        isActive: false,
      };
      musicMapRecordingRef.current = nextStoppedState;
      musicMapRecordingSignatureRef.current = getMusicMapSessionSignature(nextStoppedState);
      setMusicMapRecording(nextStoppedState);
    } catch (error) {
      setLocationError(serializeError(error));
    }

    readAutoPlayModeEnabled()
      .then((autoPlayEnabled) => {
        if (!autoPlayEnabled && Platform.OS !== 'web') {
          return stopBackgroundTracking().catch(() => {});
        }
        return null;
      })
      .catch(() => {});

    return {
      ...stoppedState,
      ...savedSession,
      isActive: false,
    };
  }, [stopBackgroundTracking]);

  useEffect(() => {
    const subscription = musicPlayerService.subscribeScreenState?.((event = {}) => {
      const screenState = String(event.state || '').toLowerCase();
      if (!['off', 'locked'].includes(screenState)) {
        return;
      }

      const activeSession = musicMapRecordingRef.current;
      const recordingMode = activeSession?.recordingMode || MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL;
      if (!activeSession?.isActive || recordingMode !== MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL) {
        return;
      }

      const trackPlaylist = Array.isArray(activeSession.trackPlaylist) ? activeSession.trackPlaylist : [];
      const recordingStartedAtMs = new Date(activeSession.recordingStartedAt || activeSession.startedAt || Date.now()).getTime();
      const elapsedMs = Number.isFinite(recordingStartedAtMs) ? Math.max(0, Date.now() - recordingStartedAtMs) : 0;

      stopMusicMapRecording()
        .then(() => {
          scheduleMusicMapSequentialPlaybackNotifications(trackPlaylist, {
            channel: 'music-map',
            elapsedMs,
          }).catch(() => {});
          setLocationError('화면이 꺼져 일반모드 뮤직지도 기록이 중단됐습니다.');
        })
        .catch((error) => {
          setLocationError(serializeError(error));
        });
    });

    return () => subscription?.remove?.();
  }, [stopMusicMapRecording]);

  useEffect(() => {
    let subscription;

    const bootstrap = async () => {
      const [cachedLocation, cachedPlaceName, cachedWeather, savedMusicMapSession] = await Promise.all([
        readLocationCache(),
        readPlaceNameCache(),
        readWeatherCache(),
        getMusicMapRecordingSession(),
      ]);

      if (cachedLocation?.coords) {
        publishLocationState(cachedLocation.coords);
      }

      if (cachedWeather?.data) {
        weatherRef.current = cachedWeather.data;
        lastWeatherFetchedAtRef.current = cachedWeather.timestamp || 0;
        setWeather(cachedWeather.data);
        setLastWeatherFetchedAt(cachedWeather.timestamp || 0);
      }

      if (cachedPlaceName?.name) {
        placeNameRef.current = cachedPlaceName;
        setPlaceName(cachedPlaceName.name);
      }

      const permissions = await refreshPermissions();
      const hasAlwaysPermission = permissions.hasBackgroundPermission;
      musicMapRecordingRef.current = savedMusicMapSession;
      musicMapRecordingSignatureRef.current = getMusicMapSessionSignature(savedMusicMapSession);
      setMusicMapRecording(savedMusicMapSession);
      if (!autoPlayColdStartOffAppliedRef.current) {
        autoPlayColdStartOffAppliedRef.current = true;
        await writeAutoPlayModeEnabled(false);
        autoPlayModeEnabledRef.current = false;
        setAutoPlayModeEnabledState(false);
      }

      if (Platform.OS !== 'web') {
        let isRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (!hasAlwaysPermission && isRegistered) {
          await stopBackgroundTracking();
          isRegistered = false;
        } else if (
          hasAlwaysPermission &&
          savedMusicMapSession.isActive &&
          savedMusicMapSession.recordingMode === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING &&
          !isRegistered
        ) {
          await startBackgroundTracking({
            syncPlaces: false,
            musicMapOnly: true,
          });
          isRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        }

        if (hasAlwaysPermission && isRegistered) {
          setBackgroundTrackingEnabled(true);
        } else {
          setBackgroundTrackingEnabled(false);
        }
      }

      if (!permissions.hasForegroundPermission) {
        setIsLocating(false);
        return;
      }

      await refreshLocation({ forceWeather: !cachedWeather?.data });

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 25,
          timeInterval: 15000,
        },
        async (nextLocation) => {
          const coords = normalizeCoords(nextLocation?.coords);
          if (!coords) return;

          publishLocationState(coords);
          await writeLocationCache(coords, 'foreground-watch');
          await refreshPlaceName(coords);
          await refreshWeather(coords);
          await evaluateAutoPlay(coords, 'foreground-watch');
          recordMusicMapPlaybackAndSync(coords, placeNameRef.current?.name || '');
        }
      );
    };

    bootstrap().catch((error) => {
      setLocationError(serializeError(error));
      setIsLocating(false);
    });

    const appStateSubscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active') {
        return;
      }

      const permissions = await refreshPermissions();
      const shouldDisableAutoPlay = !permissions.hasForegroundPermission || !permissions.hasBackgroundPermission;
      if (shouldDisableAutoPlay) {
        await forceAutoPlayOff();
        if (Platform.OS !== 'web') {
          await stopBackgroundTracking();
        }
      } else if (Platform.OS !== 'web' && autoPlayModeEnabledRef.current) {
        const isRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (!isRegistered) {
          await startBackgroundTracking({ syncPlaces: true, musicMapOnly: false });
          setBackgroundTrackingEnabled(true);
        } else {
          setBackgroundTrackingEnabled(true);
        }
      }

      const cached = await readLocationCache();
      if (cached?.coords && Date.now() - (cached.timestamp || 0) < BACKGROUND_LOCATION_MAX_AGE_MS) {
        publishLocationState(cached.coords);
        await refreshPlaceName(cached.coords);
        await refreshWeather(cached.coords);
        if (!shouldDisableAutoPlay) {
          await evaluateAutoPlay(cached.coords, 'app-active-cache');
        }
      }

      const pendingAutoPlay = await consumePendingAutoPlay();
      if (!shouldDisableAutoPlay && autoPlayModeEnabledRef.current && pendingAutoPlay?.place) {
        await executeAutoPlay(pendingAutoPlay.place, pendingAutoPlay.source || 'app-active', cached?.coords || locationRef.current);
      }

    });

    return () => {
      subscription?.remove();
      appStateSubscription.remove();
    };
  }, [
    evaluateAutoPlay,
    executeAutoPlay,
    forceAutoPlayOff,
    publishLocationState,
    recordMusicMapPlaybackAndSync,
    refreshLocation,
    refreshPermissions,
    refreshPlaceName,
    refreshWeather,
    startBackgroundTracking,
    stopBackgroundTracking,
  ]);

  return (
    <LocationContext.Provider
      value={{
        location,
        lastKnownLocation,
        placeName,
        weather,
        foregroundPermission,
        backgroundPermission,
        hasPermission: hasForegroundPermission,
        hasForegroundPermission,
        hasBackgroundPermission,
        isLocating,
        isFetchingWeather,
        backgroundTrackingEnabled,
        locationError,
        autoPlayStatus,
        autoPlayModeEnabled,
        musicMapRecording,
        requestPermissions,
        refreshPermissions,
        refreshLocation,
        refreshPlaceName,
        refreshWeather,
        refreshAutoPlayPlaces,
        reloadAutoPlayPlaces,
        setAutoPlayModeEnabled,
        prepareAutoPlayMode,
        startMusicMapRecording,
        stopMusicMapRecording,
        recordMusicMapPlaybackNow,
        refreshMusicMapRecording,
        startBackgroundTracking,
        stopBackgroundTracking,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}
