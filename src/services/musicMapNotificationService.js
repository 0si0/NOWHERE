import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import NativeNowherePlayer, {
  addPlaybackNotificationPressedListener,
  isNativeNowherePlayerAvailable,
} from 'nowhere-player';
import { API_KEYS } from '../constants';
import {
  DEFAULT_MUSIC_MAP_TRACK_DURATION_MS,
  normalizeMusicMapDurationMs,
} from './musicMapDuration';

const PENDING_PLAYBACK_KEY = '@nowhere/music-map-notification-playback';
const NOTIFICATION_PREFIX = 'nowhere-music-map-sequential';
const MAX_NOTIFICATION_TRACKS = 10;
const ACTION_NAME = 'musicMapSequentialPlayback';

function getReturnBaseUri() {
  return API_KEYS.SPOTIFY.redirectUri || 'com.nowhere.nowhere://spotify-auth';
}

function getTrackDurationMs(track = {}) {
  return normalizeMusicMapDurationMs(track.durationMs, DEFAULT_MUSIC_MAP_TRACK_DURATION_MS);
}

function normalizeNotificationTrack(track = {}) {
  return {
    id: track.id || track.spotifyUri || track.uri || '',
    title: track.title || track.name || 'Unknown Track',
    artist: track.artist || track.artistName || 'Unknown Artist',
    album: track.album || track.albumTitle || '',
    artworkUrl: track.artworkUrl || '',
    durationMs: track.durationMs || 0,
    provider: track.provider || 'spotify',
    spotifyUri: track.spotifyUri || (typeof track.uri === 'string' && track.uri.startsWith('spotify:') ? track.uri : ''),
    uri: track.uri || '',
    spotifyUrl: track.spotifyUrl || track.externalUrl || '',
    spotifyStartUrl: track.spotifyStartUrl || '',
  };
}

function getPlayableTracks(tracks = []) {
  return (Array.isArray(tracks) ? tracks : [])
    .map(normalizeNotificationTrack)
    .filter((track) => track.spotifyUri || track.uri || track.spotifyUrl || track.spotifyStartUrl)
    .slice(0, MAX_NOTIFICATION_TRACKS);
}

function getActionUrl(channel, index) {
  const separator = getReturnBaseUri().includes('?') ? '&' : '?';
  return `${getReturnBaseUri()}${separator}nowhereAction=${ACTION_NAME}&channel=${encodeURIComponent(channel)}&trackIndex=${index}`;
}

function parseNotificationUrl(url = '') {
  try {
    const parsed = new URL(url);
    const action = parsed.searchParams.get('nowhereAction');
    if (action !== ACTION_NAME) {
      return null;
    }
    return {
      channel: parsed.searchParams.get('channel') || 'music-map',
      trackIndex: Number(parsed.searchParams.get('trackIndex')),
    };
  } catch (error) {
    return null;
  }
}

async function writePendingPlayback(payload) {
  await AsyncStorage.setItem(PENDING_PLAYBACK_KEY, JSON.stringify({
    ...payload,
    savedAt: Date.now(),
  }));
}

async function readPendingPlayback() {
  const raw = await AsyncStorage.getItem(PENDING_PLAYBACK_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    await AsyncStorage.removeItem(PENDING_PLAYBACK_KEY);
    return null;
  }
}

export async function requestMusicMapPlaybackNotificationPermission() {
  if (Platform.OS === 'web' || !isNativeNowherePlayerAvailable || !NativeNowherePlayer.requestPlaybackNotificationPermissionAsync) {
    return { granted: false, available: false };
  }
  return NativeNowherePlayer.requestPlaybackNotificationPermissionAsync();
}

export async function cancelMusicMapSequentialPlaybackNotifications(channel = 'music-map') {
  if (isNativeNowherePlayerAvailable && NativeNowherePlayer.cancelPlaybackNotificationsAsync) {
    await NativeNowherePlayer.cancelPlaybackNotificationsAsync(`${NOTIFICATION_PREFIX}-${channel}`).catch(() => null);
  }
}

export async function scheduleMusicMapSequentialPlaybackNotifications(
  tracks = [],
  {
    channel = 'music-map',
    elapsedMs = 0,
  } = {}
) {
  const playableTracks = getPlayableTracks(tracks);
  await writePendingPlayback({ channel, tracks: playableTracks });

  if (Platform.OS === 'web' || !isNativeNowherePlayerAvailable || !NativeNowherePlayer.schedulePlaybackNotificationAsync) {
    return { scheduled: false, reason: 'native-unavailable' };
  }

  await requestMusicMapPlaybackNotificationPermission().catch(() => null);
  await cancelMusicMapSequentialPlaybackNotifications(channel);

  let elapsedBeforeTrack = 0;
  let scheduledCount = 0;
  const elapsed = Math.max(0, Number(elapsedMs || 0));

  for (let index = 0; index < playableTracks.length; index += 1) {
    const track = playableTracks[index];
    const trackDurationMs = getTrackDurationMs(track);
    const trackEndMs = elapsedBeforeTrack + trackDurationMs;

    if (index > 0 && trackEndMs > elapsed) {
      const delayMs = Math.max(1000, elapsedBeforeTrack - elapsed);
      await NativeNowherePlayer.schedulePlaybackNotificationAsync({
        identifier: `${NOTIFICATION_PREFIX}-${channel}-${index}`,
        delayMs,
        title: '다음 곡을 재생할 시간이에요',
        body: `${track.title} - ${track.artist}\n잠금화면에서 탭하면 Spotify로 열어요.`,
        url: getActionUrl(channel, index),
        payload: {
          action: ACTION_NAME,
          channel,
          trackIndex: index,
        },
      });
      scheduledCount += 1;
    }

    elapsedBeforeTrack = trackEndMs;
  }

  return { scheduled: scheduledCount > 0, scheduledCount };
}

export async function consumeMusicMapPlaybackNotificationUrl(url = '') {
  const action = parseNotificationUrl(url);
  if (!action || !Number.isFinite(action.trackIndex)) {
    return null;
  }

  const pending = await readPendingPlayback();
  if (!pending || pending.channel !== action.channel) {
    return null;
  }

  const track = pending.tracks?.[action.trackIndex];
  return track ? {
    track,
    queue: pending.tracks.slice(action.trackIndex),
    channel: action.channel,
    trackIndex: action.trackIndex,
  } : null;
}

export function subscribeMusicMapPlaybackNotificationPress(listener) {
  return addPlaybackNotificationPressedListener((payload = {}) => {
    if (payload.url) {
      listener?.(payload.url);
    }
  });
}

export async function getInitialMusicMapPlaybackNotificationUrl() {
  const initialUrl = await Linking.getInitialURL().catch(() => null);
  if (parseNotificationUrl(initialUrl || '')) {
    return initialUrl;
  }
  if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.getPendingPlaybackNotificationAsync) {
    return null;
  }
  const payload = await NativeNowherePlayer.getPendingPlaybackNotificationAsync().catch(() => null);
  return payload?.url || null;
}
