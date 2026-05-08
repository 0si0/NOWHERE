import { TIME_MOODS } from '../constants';
import { encodeGeohash } from './locationService';
import { getOrCreateAppUserId, saveListeningEvent } from './firebaseService';
import { getWeatherMoodLabel } from './weatherService';

export function getTimeBucket(date = new Date()) {
  const hour = date.getHours();
  const match = Object.entries(TIME_MOODS).find(([, value]) => {
    const [start, end] = value.range;
    return hour >= start && hour < end;
  });
  return match?.[0] || 'night';
}

function normalizeTrack(track = {}) {
  const spotifyUri = track.spotifyUri || (typeof track.uri === 'string' && track.uri.startsWith('spotify:') ? track.uri : '');
  return {
    type: track.type === 'playlist' ? 'playlist' : 'track',
    provider: track.provider || 'spotify',
    id: track.id || spotifyUri || `${track.title || track.name || 'track'}-${track.artist || track.artistName || ''}`,
    spotifyUri,
    uri: spotifyUri || track.uri || '',
    title: track.title || track.name || 'Unknown Track',
    artist: track.artist || track.artistName || '',
    album: track.album || track.albumTitle || '',
    artworkUrl: track.artworkUrl || track.albumArtUrl || '',
    durationMs: track.durationMs || 0,
  };
}

export function buildListeningContext({
  location = null,
  weather = null,
  place = null,
  savedPlaceId = '',
  now = new Date(),
} = {}) {
  const latitude = typeof location?.latitude === 'number'
    ? location.latitude
    : typeof place?.coordinates?.latitude === 'number'
      ? place.coordinates.latitude
      : null;
  const longitude = typeof location?.longitude === 'number'
    ? location.longitude
    : typeof place?.coordinates?.longitude === 'number'
      ? place.coordinates.longitude
      : null;

  return {
    timeBucket: getTimeBucket(now),
    hour: now.getHours(),
    weatherCondition: weather?.condition || '',
    weatherMood: weather?.condition ? getWeatherMoodLabel(weather.condition) : '',
    placeName: place?.name || weather?.city || '',
    savedPlaceId: savedPlaceId || place?.id || '',
    latitude,
    longitude,
    geohash: latitude != null && longitude != null ? encodeGeohash(latitude, longitude) : '',
  };
}

export async function recordListeningEvent({
  userId = '',
  track,
  eventType = 'play',
  source = 'unknown',
  recommendationSlot = '',
  context = {},
  challenge = {},
} = {}) {
  const ownerId = userId || await getOrCreateAppUserId();
  const normalizedTrack = normalizeTrack(track);
  return saveListeningEvent({
    userId: ownerId,
    schemaVersion: 2,
    eventType,
    source,
    recommendationSlot,
    track: normalizedTrack,
    timeBucket: context.timeBucket,
    hour: context.hour,
    weatherCondition: context.weatherCondition,
    weatherMood: context.weatherMood,
    placeName: context.placeName,
    savedPlaceId: context.savedPlaceId,
    latitude: context.latitude,
    longitude: context.longitude,
    geohash: context.geohash,
    challenge,
    occurredAt: new Date().toISOString(),
  });
}
