import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useState, useEffect, useCallback, useContext, useRef } from 'react';
import { AppState, Platform } from 'react-native';
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
  writePendingAutoPlay,
  writeAutoPlayModeEnabled,
} from '../services/autoPlayService';
import {
  getOrCreateAppUserId,
  getSavedPlaces,
  savePlayRecord,
} from '../services/firebaseService';
import { musicPlayerService } from '../services/musicPlayerService';
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
    await musicPlayerService.playInBackground(target, [target]);
    await markAutoPlayTriggered(place.id);
  } catch (error) {
    await writePendingAutoPlay(place, source);
  }
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
  const [lastWeatherFetchedAt, setLastWeatherFetchedAt] = useState(0);
  const autoPlayPlacesRef = useRef({ places: [], fetchedAt: 0 });
  const autoPlayInFlightRef = useRef(false);
  const autoPlayColdStartOffAppliedRef = useRef(false);
  const playerRef = useRef(player);
  const locationRef = useRef(null);
  const placeNameRef = useRef({ name: '', coords: null, timestamp: 0 });
  const hasForegroundPermission = foregroundPermission === 'granted';
  const hasBackgroundPermission = backgroundPermission === 'granted';

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

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
    if (!autoPlayModeEnabled || !hasBackgroundPermission || !place || autoPlayInFlightRef.current) {
      return null;
    }

    const target = getSavedPlacePlayTarget(place);
    if (!target) {
      return null;
    }

    autoPlayInFlightRef.current = true;
    setAutoPlayStatus({ status: 'loading', place, error: null });

    try {
      if (playerRef.current?.playInBackground) {
        await playerRef.current.playInBackground(target, [target]);
      } else {
        await musicPlayerService.playInBackground(target, [target]);
      }
      await markAutoPlayTriggered(place.id);
      setAutoPlayStatus({ status: 'playing', place, error: null });

      recordListeningEvent({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        track: target,
        source: 'autoplay',
        recommendationSlot: 'place-autoplay',
        context: buildListeningContext({
          location: coords || locationRef.current,
          weather,
          place,
          savedPlaceId: place.id,
        }),
      }).catch(() => {});

      if (isFirebaseConfigured && authUser?.uid && !authUser.isAnonymous) {
        savePlayRecord({
          userId: authUser.uid,
          trackId: target.id || target.spotifyUri,
          title: target.title,
          artist: target.artist || 'Unknown Artist',
          albumArtUrl: target.artworkUrl,
          provider: target.provider || 'spotify',
          placeName: place.name,
          savedPlaceId: place.id,
          latitude: coords?.latitude ?? place.lat ?? place.coordinates?.latitude,
          longitude: coords?.longitude ?? place.lon ?? place.coordinates?.longitude,
        }).catch(() => {});
      }

      return place;
    } catch (error) {
      setAutoPlayStatus({ status: 'error', place, error: error.message || '자동재생에 실패했습니다.' });
      return null;
    } finally {
      autoPlayInFlightRef.current = false;
    }
  }, [authUser?.isAnonymous, authUser?.uid, autoPlayModeEnabled, hasBackgroundPermission, isFirebaseConfigured, weather]);

  const evaluateAutoPlay = useCallback(async (coords, source = 'foreground') => {
    if (!autoPlayModeEnabled || !hasBackgroundPermission) {
      return;
    }

    const places = await refreshAutoPlayPlaces();
    const candidate = await findAutoPlayCandidate(coords, places);
    if (candidate) {
      await executeAutoPlay(candidate, source, coords);
    }
  }, [autoPlayModeEnabled, executeAutoPlay, hasBackgroundPermission, refreshAutoPlayPlaces]);

  const refreshPermissions = useCallback(async () => {
    const foreground = await Location.getForegroundPermissionsAsync();
    const background = Platform.OS === 'web'
      ? { status: 'denied' }
      : await Location.getBackgroundPermissionsAsync();

    setForegroundPermission(foreground.status);
    setBackgroundPermission(background.status);

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

    const shouldSkip = !force && lastWeatherFetchedAt > 0 && Date.now() - lastWeatherFetchedAt < WEATHER_REFRESH_INTERVAL_MS;
    if (shouldSkip) {
      return weather;
    }

    try {
      setIsFetchingWeather(true);
      const nextWeather = await getCurrentWeather(coords.latitude, coords.longitude);
      setWeather(nextWeather);
      setLastWeatherFetchedAt(Date.now());
      await writeWeatherCache(nextWeather);
      return nextWeather;
    } catch (error) {
      setLastWeatherFetchedAt(Date.now());
      return weather;
    } finally {
      setIsFetchingWeather(false);
    }
  }, [lastWeatherFetchedAt, weather]);

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
      setLocation(coords);
      setLastKnownLocation(coords);
      await writeLocationCache(coords, 'foreground');
      await refreshPlaceName(coords);
      await refreshWeather(coords, { force: forceWeather });
      await evaluateAutoPlay(coords, 'foreground-refresh');
      return coords;
    } catch (error) {
      const cached = await Location.getLastKnownPositionAsync();
      const fallback = normalizeCoords(cached?.coords);

      if (fallback) {
        setLocation(fallback);
        setLastKnownLocation(fallback);
        await writeLocationCache(fallback, 'last-known');
        await refreshPlaceName(fallback);
        await refreshWeather(fallback, { force: forceWeather });
        await evaluateAutoPlay(fallback, 'last-known');
      }

      setLocationError(serializeError(error));
      return fallback;
    } finally {
      setIsLocating(false);
    }
  }, [evaluateAutoPlay, refreshPermissions, refreshPlaceName, refreshWeather]);

  const requestPermissions = useCallback(async () => {
    setLocationError(null);
    const foreground = await Location.requestForegroundPermissionsAsync();
    const nextForeground = foreground.status;

    setForegroundPermission(nextForeground);

    if (nextForeground !== 'granted') {
      setBackgroundPermission('denied');
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
    }

    await refreshLocation({ forceWeather: true });

    return {
      foreground: nextForeground,
      background: nextBackground,
      hasForegroundPermission: true,
      hasBackgroundPermission: nextBackground === 'granted',
    };
  }, [backgroundPermission, refreshLocation]);

  const startBackgroundTracking = useCallback(async () => {
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
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
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
      });
    }

    const autoPlayPlaces = await refreshAutoPlayPlaces({ force: true });
    await syncGeofenceRegions(autoPlayPlaces);

    await AsyncStorage.setItem(BACKGROUND_TRACKING_KEY, 'true');
    setBackgroundTrackingEnabled(true);
    return true;
  }, [refreshAutoPlayPlaces, refreshPermissions, requestPermissions, syncGeofenceRegions]);

  const setAutoPlayModeEnabled = useCallback(async (enabled) => {
    if (!enabled) {
      await writeAutoPlayModeEnabled(false);
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
    const state = await playerRef.current?.prepareAutoPlay?.(primerTarget);
    await setAutoPlayModeEnabled(true);
    return state;
  }, [refreshAutoPlayPlaces, setAutoPlayModeEnabled]);

  const forceAutoPlayOff = useCallback(async () => {
    await writeAutoPlayModeEnabled(false);
    await AsyncStorage.setItem(BACKGROUND_TRACKING_KEY, 'false');
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

  useEffect(() => {
    let subscription;

    const bootstrap = async () => {
      const [cachedLocation, cachedPlaceName, cachedWeather, savedTrackingPreference, savedAutoPlayMode] = await Promise.all([
        readLocationCache(),
        readPlaceNameCache(),
        readWeatherCache(),
        AsyncStorage.getItem(BACKGROUND_TRACKING_KEY),
        readAutoPlayModeEnabled(),
      ]);

      if (cachedLocation?.coords) {
        setLastKnownLocation(cachedLocation.coords);
        setLocation(cachedLocation.coords);
      }

      if (cachedWeather?.data) {
        setWeather(cachedWeather.data);
        setLastWeatherFetchedAt(cachedWeather.timestamp || 0);
      }

      if (cachedPlaceName?.name) {
        placeNameRef.current = cachedPlaceName;
        setPlaceName(cachedPlaceName.name);
      }

      const permissions = await refreshPermissions();
      const hasAlwaysPermission = permissions.hasBackgroundPermission;
      if (!autoPlayColdStartOffAppliedRef.current) {
        autoPlayColdStartOffAppliedRef.current = true;
        if (savedAutoPlayMode || savedTrackingPreference === 'true') {
          await forceAutoPlayOff();
          if (Platform.OS !== 'web') {
            await stopBackgroundTracking();
          }
        } else {
          await forceAutoPlayOff();
        }
      }

      if (Platform.OS !== 'web') {
        const isRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (isRegistered && !autoPlayModeEnabled) {
          await stopBackgroundTracking();
        } else {
          setBackgroundTrackingEnabled(isRegistered && hasAlwaysPermission && autoPlayModeEnabled);
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

          setLocation(coords);
          setLastKnownLocation(coords);
          await writeLocationCache(coords, 'foreground-watch');
          await refreshPlaceName(coords);
          await refreshWeather(coords);
          await evaluateAutoPlay(coords, 'foreground-watch');
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
      const shouldDisableAutoPlay = autoPlayModeEnabled || !permissions.hasBackgroundPermission;
      if (shouldDisableAutoPlay) {
        await forceAutoPlayOff();
        if (Platform.OS !== 'web') {
          await stopBackgroundTracking();
        }
      }

      const cached = await readLocationCache();
      if (cached?.coords && Date.now() - (cached.timestamp || 0) < BACKGROUND_LOCATION_MAX_AGE_MS) {
        setLocation(cached.coords);
        setLastKnownLocation(cached.coords);
        await refreshPlaceName(cached.coords);
        await refreshWeather(cached.coords);
        if (!shouldDisableAutoPlay) {
          await evaluateAutoPlay(cached.coords, 'app-active-cache');
        }
      }

      const pendingAutoPlay = await consumePendingAutoPlay();
      if (!shouldDisableAutoPlay && autoPlayModeEnabled && pendingAutoPlay?.place) {
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
    refreshAutoPlayPlaces,
    reloadAutoPlayPlaces,
    refreshLocation,
    refreshPermissions,
    refreshPlaceName,
    refreshWeather,
    startBackgroundTracking,
    stopBackgroundTracking,
    syncGeofenceRegions,
    autoPlayModeEnabled,
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
        requestPermissions,
        refreshPermissions,
        refreshLocation,
        refreshPlaceName,
        refreshWeather,
        refreshAutoPlayPlaces,
        reloadAutoPlayPlaces,
        setAutoPlayModeEnabled,
        prepareAutoPlayMode,
        startBackgroundTracking,
        stopBackgroundTracking,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}
