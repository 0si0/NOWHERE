import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import NativeNowherePlayer, {
  addPlaybackNotificationPressedListener,
  isNativeNowherePlayerAvailable,
} from 'nowhere-player';
import { API_KEYS } from '../constants';

const PENDING_AUTOPLAY_NOTIFICATION_KEY = '@nowhere/autoplay-notification-pending';
const AUTOPLAY_NOTIFICATION_PREFIX = 'nowhere-autoplay-place';
const ACTION_NAME = 'autoPlayPlacePlayback';

function getReturnBaseUri() {
  return API_KEYS.SPOTIFY.redirectUri || 'com.nowhere.nowhere://spotify-auth';
}

function getActionUrl(placeId = '') {
  const separator = getReturnBaseUri().includes('?') ? '&' : '?';
  return `${getReturnBaseUri()}${separator}nowhereAction=${ACTION_NAME}&placeId=${encodeURIComponent(String(placeId || ''))}`;
}

function parseAutoPlayNotificationUrl(url = '') {
  try {
    const parsed = new URL(url);
    const action = parsed.searchParams.get('nowhereAction');
    if (action !== ACTION_NAME) {
      return null;
    }
    return {
      placeId: parsed.searchParams.get('placeId') || '',
    };
  } catch (error) {
    return null;
  }
}

export function getAutoPlayNotificationPlaceId(url = '') {
  return parseAutoPlayNotificationUrl(url)?.placeId || '';
}

async function writePendingAutoPlayNotification(payload) {
  await AsyncStorage.setItem(PENDING_AUTOPLAY_NOTIFICATION_KEY, JSON.stringify({
    ...payload,
    savedAt: Date.now(),
  }));
}

async function readPendingAutoPlayNotification() {
  const raw = await AsyncStorage.getItem(PENDING_AUTOPLAY_NOTIFICATION_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    await AsyncStorage.removeItem(PENDING_AUTOPLAY_NOTIFICATION_KEY);
    return null;
  }
}

export async function requestAutoPlayNotificationPermission() {
  if (Platform.OS === 'web' || !isNativeNowherePlayerAvailable || !NativeNowherePlayer.requestPlaybackNotificationPermissionAsync) {
    return { granted: false, available: false };
  }
  return NativeNowherePlayer.requestPlaybackNotificationPermissionAsync();
}

export async function cancelAutoPlayNotifications(placeId = '') {
  if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.cancelPlaybackNotificationsAsync) {
    return;
  }
  const suffix = placeId ? `-${placeId}` : '';
  await NativeNowherePlayer.cancelPlaybackNotificationsAsync(`${AUTOPLAY_NOTIFICATION_PREFIX}${suffix}`).catch(() => null);
}

export async function scheduleAutoPlayNotification(place, { source = 'background', delayMs = 1000 } = {}) {
  if (!place?.id) {
    return { scheduled: false, reason: 'missing-place' };
  }

  const actionUrl = getActionUrl(place.id);
  await writePendingAutoPlayNotification({
    source,
    place,
    url: actionUrl,
  });

  if (Platform.OS === 'web' || !isNativeNowherePlayerAvailable || !NativeNowherePlayer.schedulePlaybackNotificationAsync) {
    return { scheduled: false, reason: 'native-unavailable' };
  }

  await requestAutoPlayNotificationPermission().catch(() => null);
  await cancelAutoPlayNotifications(place.id);

  return NativeNowherePlayer.schedulePlaybackNotificationAsync({
    identifier: `${AUTOPLAY_NOTIFICATION_PREFIX}-${place.id}`,
    delayMs: Math.max(1000, Number(delayMs || 0)),
    title: '장소에 도착했습니다.',
    body: '탭하면 지정한 노래를 Spotify에서 재생해요.',
    url: actionUrl,
    payload: {
      action: ACTION_NAME,
      placeId: String(place.id),
      source,
    },
  });
}

export async function consumeAutoPlayNotificationUrl(url = '') {
  const action = parseAutoPlayNotificationUrl(url);
  if (!action) {
    return null;
  }

  const pending = await readPendingAutoPlayNotification();
  if (!pending?.place || String(pending.place.id) !== String(action.placeId)) {
    return null;
  }

  await AsyncStorage.removeItem(PENDING_AUTOPLAY_NOTIFICATION_KEY).catch(() => null);
  await cancelAutoPlayNotifications(action.placeId).catch(() => null);
  return {
    ...pending,
    place: pending.place,
    placeId: action.placeId,
  };
}

export function subscribeAutoPlayNotificationPress(listener) {
  return addPlaybackNotificationPressedListener((payload = {}) => {
    if (payload.url && parseAutoPlayNotificationUrl(payload.url)) {
      listener?.(payload.url);
    }
  });
}

export async function getInitialPlaybackNotificationUrl() {
  const initialUrl = await Linking.getInitialURL().catch(() => null);
  if (initialUrl) {
    return initialUrl;
  }
  if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.getPendingPlaybackNotificationAsync) {
    return null;
  }
  const payload = await NativeNowherePlayer.getPendingPlaybackNotificationAsync().catch(() => null);
  return payload?.url || null;
}

export function isAutoPlayNotificationUrl(url = '') {
  return Boolean(parseAutoPlayNotificationUrl(url));
}
