import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDistanceMeters, normalizeSavedPlace } from './locationService';

const AUTOPLAY_PLACE_CACHE_KEY = '@nowhere/autoplay-place-cache';
const AUTOPLAY_COOLDOWN_KEY = '@nowhere/autoplay-cooldowns';
const PENDING_AUTOPLAY_KEY = '@nowhere/pending-autoplay';
const AUTOPLAY_MODE_KEY = '@nowhere/autoplay-mode-enabled';
const MUSIC_MAP_TRACK_PLAYLISTS_KEY = '@nowhere/music-map-track-playlists-v1';

export const AUTOPLAY_COOLDOWN_MS = 30 * 60 * 1000;
export const GEOFENCE_REGION_LIMIT_IOS = 20;

export async function readAutoPlayModeEnabled() {
  const value = await AsyncStorage.getItem(AUTOPLAY_MODE_KEY);
  return value === 'true';
}

export async function writeAutoPlayModeEnabled(enabled) {
  await AsyncStorage.setItem(AUTOPLAY_MODE_KEY, enabled ? 'true' : 'false');
  return Boolean(enabled);
}

function isFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePlayTarget(target = {}) {
  const spotifyUri = target.spotifyUri || (typeof target.uri === 'string' && target.uri.startsWith('spotify:') ? target.uri : '');
  const title = target.title || target.name || '';

  if (!spotifyUri && !title && !target.id) {
    return null;
  }

  return {
    type: target.type === 'playlist' ? 'playlist' : 'track',
    provider: target.provider || 'spotify',
    id: target.id || spotifyUri || title,
    spotifyUri,
    uri: spotifyUri || target.uri || '',
    title: title || '선택한 곡',
    artist: target.artist || target.artistName || '',
    album: target.album || '',
    artworkUrl: target.artworkUrl || target.albumArtUrl || '',
    durationMs: target.durationMs || 0,
  };
}

function normalizeInternalTrack(track = {}) {
  const spotifyUri = track.spotifyUri || (typeof track.uri === 'string' && track.uri.startsWith('spotify:') ? track.uri : '');
  const title = track.title || track.name || '';
  const artist = track.artist || track.artistName || '';
  if (!spotifyUri || !title) {
    return null;
  }
  return {
    type: 'track',
    provider: 'spotify',
    id: track.id || track.trackId || spotifyUri,
    spotifyUri,
    uri: spotifyUri,
    title,
    artist,
    album: track.album || track.albumName || '',
    artworkUrl: track.artworkUrl || track.albumArtUrl || '',
    durationMs: track.durationMs || 0,
  };
}

async function readMusicMapTrackPlaylists() {
  const raw = await AsyncStorage.getItem(MUSIC_MAP_TRACK_PLAYLISTS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export async function resolveAutoPlayPlaybackTarget(target = {}) {
  const normalizedTarget = normalizePlayTarget(target);
  if (!normalizedTarget) {
    return null;
  }

  const isInternalPlaylist = normalizedTarget.type === 'playlist' && !normalizedTarget.spotifyUri;
  if (!isInternalPlaylist) {
    return {
      target: normalizedTarget,
      track: normalizedTarget,
      queue: [normalizedTarget],
    };
  }

  const playlists = await readMusicMapTrackPlaylists();
  const playlist = playlists.find((item) => item?.id === normalizedTarget.id);
  const queue = (Array.isArray(playlist?.tracks) ? playlist.tracks : [])
    .map(normalizeInternalTrack)
    .filter(Boolean);
  if (!queue.length) {
    return {
      target: normalizedTarget,
      track: normalizedTarget,
      queue: [normalizedTarget],
    };
  }

  return {
    target: {
      ...normalizedTarget,
      title: playlist.name || normalizedTarget.title,
      artworkUrl: queue[0]?.artworkUrl || normalizedTarget.artworkUrl,
    },
    track: queue[0],
    queue,
  };
}

export function getSavedPlacePlayTarget(place) {
  const target = normalizePlayTarget(place?.playTarget);
  if (target) {
    return target;
  }

  if (place?.playlist?.playlistId || place?.playlist?.title) {
    return normalizePlayTarget({
      type: 'track',
      provider: place.playlist.provider || 'spotify',
      id: place.playlist.playlistId,
      spotifyUri: typeof place.playlist.playlistId === 'string' && place.playlist.playlistId.startsWith('spotify:')
        ? place.playlist.playlistId
        : '',
      title: place.playlist.title,
      artworkUrl: place.playlist.artworkUrl,
    });
  }

  return null;
}

async function readCooldowns() {
  const raw = await AsyncStorage.getItem(AUTOPLAY_COOLDOWN_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    await AsyncStorage.removeItem(AUTOPLAY_COOLDOWN_KEY);
    return {};
  }
}

export async function canTriggerAutoPlay(placeId, now = Date.now()) {
  const cooldowns = await readCooldowns();
  const lastTriggeredAt = Number(cooldowns[placeId] || 0);
  return !lastTriggeredAt || now - lastTriggeredAt >= AUTOPLAY_COOLDOWN_MS;
}

export async function markAutoPlayTriggered(placeId, now = Date.now()) {
  const cooldowns = await readCooldowns();
  cooldowns[placeId] = now;
  await AsyncStorage.setItem(AUTOPLAY_COOLDOWN_KEY, JSON.stringify(cooldowns));
}

export async function cacheAutoPlayPlaces(places = []) {
  const activePlaces = places
    .filter((place) => place?.status !== 'archived')
    .map((place) => ({
      ...place,
      playTarget: getSavedPlacePlayTarget(place),
    }))
    .filter((place) => place.playTarget);

  await AsyncStorage.setItem(AUTOPLAY_PLACE_CACHE_KEY, JSON.stringify({
    places: activePlaces,
    updatedAt: Date.now(),
  }));

  return activePlaces;
}

export async function readCachedAutoPlayPlaces() {
  const raw = await AsyncStorage.getItem(AUTOPLAY_PLACE_CACHE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.places) ? parsed.places : [];
  } catch (error) {
    await AsyncStorage.removeItem(AUTOPLAY_PLACE_CACHE_KEY);
    return [];
  }
}

export async function writePendingAutoPlay(place, source = 'background') {
  const target = getSavedPlacePlayTarget(place);
  if (!place?.id || !target) {
    return null;
  }

  const payload = {
    source,
    createdAt: Date.now(),
    place: {
      ...place,
      playTarget: target,
    },
  };

  await AsyncStorage.setItem(PENDING_AUTOPLAY_KEY, JSON.stringify(payload));
  return payload;
}

export async function consumePendingAutoPlay() {
  const raw = await AsyncStorage.getItem(PENDING_AUTOPLAY_KEY);
  if (!raw) {
    return null;
  }

  await AsyncStorage.removeItem(PENDING_AUTOPLAY_KEY);
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

export async function findAutoPlayCandidate(coords, places = [], now = Date.now()) {
  if (!coords || !isFiniteCoordinate(coords.latitude) || !isFiniteCoordinate(coords.longitude)) {
    return null;
  }

  const candidates = [];

  for (const place of places) {
    const normalizedPlace = normalizeSavedPlace(place);
    const target = getSavedPlacePlayTarget(place);
    if (
      !normalizedPlace.id ||
      normalizedPlace.status === 'archived' ||
      !target ||
      !isFiniteCoordinate(normalizedPlace.lat) ||
      !isFiniteCoordinate(normalizedPlace.lon) ||
      !normalizedPlace.radius
    ) {
      continue;
    }

    const distanceMeters = getDistanceMeters(
      coords.latitude,
      coords.longitude,
      normalizedPlace.lat,
      normalizedPlace.lon
    );

    if (distanceMeters <= normalizedPlace.radius && await canTriggerAutoPlay(normalizedPlace.id, now)) {
      candidates.push({
        ...normalizedPlace,
        playTarget: target,
        distanceMeters,
      });
    }
  }

  return candidates.sort((left, right) => left.distanceMeters - right.distanceMeters)[0] || null;
}

export function buildGeofenceRegions(places = [], limit = GEOFENCE_REGION_LIMIT_IOS) {
  return places
    .map(normalizeSavedPlace)
    .filter((place) => (
      place.id &&
      place.status !== 'archived' &&
      getSavedPlacePlayTarget(place) &&
      isFiniteCoordinate(place.lat) &&
      isFiniteCoordinate(place.lon) &&
      place.radius
    ))
    .slice(0, limit)
    .map((place) => ({
      identifier: String(place.id),
      latitude: place.lat,
      longitude: place.lon,
      radius: place.radius,
      notifyOnEnter: true,
      notifyOnExit: false,
    }));
}
