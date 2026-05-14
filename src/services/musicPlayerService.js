import { Linking, Platform } from 'react-native';
import NativeNowherePlayer, {
  addPlaybackStateListener,
  addScreenStateListener,
  isNativeNowherePlayerAvailable,
} from 'nowhere-player';
import { API_KEYS } from '../constants';
import { callCloudFunctionOptionalAuth } from './firebaseService';

const DEFAULT_COLOR = '#7CFFB2';
const STOPPED_STATUS = 'stopped';
const EXTERNAL_PLAYBACK_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const SPOTIFY_RETURN_DELAY_MS = 1400;
const USER_SPOTIFY_READ_SCOPES = [
  'app-remote-control',
  'user-read-currently-playing',
];
let externalPlaybackSnapshot = null;

function getProvider() {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return 'spotify';
  }
  return 'mock';
}

function getReturnToNowhereUri() {
  return API_KEYS.SPOTIFY.redirectUri || 'com.nowhere.nowhere://spotify-auth';
}

function scheduleReturnToNowhere() {
  const returnUri = getReturnToNowhereUri();
  if (!returnUri || Platform.OS === 'web') {
    return;
  }
  setTimeout(() => {
    Linking.openURL(returnUri).catch(() => null);
  }, SPOTIFY_RETURN_DELAY_MS);
}

function getNativeOptions(extraOptions = {}) {
  return {
    provider: getProvider(),
    spotifyClientId: API_KEYS.SPOTIFY.clientId,
    spotifyRedirectUri: API_KEYS.SPOTIFY.redirectUri,
    returnToAppUri: getReturnToNowhereUri(),
    scopes: USER_SPOTIFY_READ_SCOPES,
    ...extraOptions,
  };
}

function normalizeTrack(track = {}) {
  const type = track.type === 'playlist' ? 'playlist' : 'track';
  return {
    id: track.id || track.spotifyUri || `${track.title || 'track'}-${track.artist || ''}`,
    type,
    title: track.title || track.name || 'Unknown Track',
    artist: track.artist || track.artistName || 'Unknown Artist',
    album: track.album || track.albumTitle || '',
    color: track.color || DEFAULT_COLOR,
    artworkUrl: track.artworkUrl || '',
    durationMs: track.durationMs || 0,
    provider: track.provider || getProvider(),
    spotifyUri: track.spotifyUri || (typeof track.uri === 'string' && track.uri.startsWith('spotify:') ? track.uri : ''),
    uri: track.uri || '',
    spotifyContextUri: track.spotifyContextUri || track.contextUri || '',
    spotifyUrl: track.spotifyUrl || track.externalUrl || '',
    spotifyPlaylistUrl: track.spotifyPlaylistUrl || '',
    spotifyStartUrl: track.spotifyStartUrl || '',
    trackCount: track.trackCount || 0,
    ownerName: track.ownerName || '',
  };
}

function normalizeQueue(queue = []) {
  return queue.filter(Boolean).map(normalizeTrack);
}

function mergeNativeState(state = {}) {
  const merged = {
    provider: state.provider || getProvider(),
    available: Boolean(state.available),
    isConnected: Boolean(state.isConnected),
    isPlaying: Boolean(state.isPlaying),
    playbackStatus: state.playbackStatus || 'unknown',
    authorizationStatus: state.authorizationStatus || state.status || 'unknown',
    isAuthorized: Boolean(state.isAuthorized || state.authorized),
    positionMs: state.positionMs || 0,
    error: state.error || null,
    requiresActiveDevice: Boolean(state.requiresActiveDevice),
  };
  if (Object.prototype.hasOwnProperty.call(state, 'currentTrack')) {
    merged.currentTrack = state.currentTrack ? normalizeTrack(state.currentTrack) : null;
  }
  if (Array.isArray(state.queue)) {
    merged.queue = normalizeQueue(state.queue);
  }
  return merged;
}

function buildPlaybackFailure(state = {}) {
  if (state.requiresActiveDevice || state.playbackStatus === 'noActiveDevice') {
    return new Error('Spotify 활성 기기를 찾지 못했습니다. AUTO ON을 다시 눌러 Spotify 자동 활성화를 먼저 실행해주세요.');
  }
  if (state.playbackStatus === 'playbackError' || state.error) {
    return new Error(state.error || 'Spotify 재생 요청이 실패했습니다.');
  }
  return null;
}

function isAuthorizedState(state = {}) {
  return state?.authorizationStatus === 'authorized' || state?.isAuthorized === true;
}

function hasTrackIdentity(track = {}) {
  return Boolean(track?.spotifyUri || track?.uri || track?.id || track?.title);
}

function isExternalPlaybackFresh(nowMs = Date.now()) {
  return Boolean(
    externalPlaybackSnapshot?.track &&
    externalPlaybackSnapshot?.openedAtMs &&
    nowMs - externalPlaybackSnapshot.openedAtMs < EXTERNAL_PLAYBACK_MAX_AGE_MS
  );
}

function setExternalPlaybackSnapshot(track, queue = [], playbackStatus = 'playing') {
  const normalizedTrack = normalizeTrack(track);
  if (!hasTrackIdentity(normalizedTrack)) {
    return null;
  }
  externalPlaybackSnapshot = {
    openedAtMs: Date.now(),
    track: normalizedTrack,
    queue: normalizeQueue(queue.length ? queue : [track]),
    playbackStatus,
  };
  return externalPlaybackSnapshot;
}

function clearExternalPlaybackSnapshot() {
  externalPlaybackSnapshot = null;
}

function getExternalPlaybackState(baseState = {}) {
  if (!isExternalPlaybackFresh()) {
    return null;
  }
  return mergeNativeState({
    ...baseState,
    provider: 'spotify',
    available: true,
    isConnected: Boolean(baseState.isConnected),
    isAuthorized: Boolean(baseState.isAuthorized),
    authorizationStatus: baseState.authorizationStatus || 'ownerApiProxy',
    isPlaying: true,
    playbackStatus: externalPlaybackSnapshot.playbackStatus || 'playing',
    currentTrack: externalPlaybackSnapshot.track,
    queue: externalPlaybackSnapshot.queue,
  });
}

function buildReconnectionRequiredError() {
  return new Error('이 곡의 Spotify 링크가 아직 준비되지 않았습니다. 추천을 다시 불러온 뒤 시도해주세요.');
}

function getSpotifyOpenUri(track = {}) {
  const uri = String(track.spotifyUri || track.uri || '').trim();
  return uri.startsWith('spotify:') ? uri : '';
}

function getSpotifyOpenUrl(track = {}) {
  const url = String(track.spotifyUrl || track.externalUrl || '').trim();
  return url.startsWith('https://open.spotify.com/') ? url : '';
}

function getSpotifyTrackIdFromUri(uri = '') {
  const value = String(uri || '').trim();
  if (value.startsWith('spotify:track:')) {
    return value.split(':')[2] || '';
  }
  const match = value.match(/open\.spotify\.com\/track\/([^?/#]+)/i);
  return match?.[1] || '';
}

function getSpotifyContextOpenUrl(track = {}) {
  const contextUri = String(track.spotifyContextUri || track.contextUri || '').trim();
  const trackId = getSpotifyTrackIdFromUri(track.spotifyUri || track.uri || track.spotifyUrl || '');
  if (!trackId || !contextUri.startsWith('spotify:playlist:')) {
    return '';
  }
  return `https://open.spotify.com/track/${encodeURIComponent(trackId)}?context=${encodeURIComponent(contextUri)}`;
}

function getSpotifyWebUrlFromUri(uri = '') {
  const parts = String(uri || '').split(':');
  if (parts.length < 3 || parts[0] !== 'spotify') {
    return '';
  }
  const [, type, id] = parts;
  if (!type || !id) {
    return '';
  }
  return `https://open.spotify.com/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

function isSpotifyControlBlockedError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('403') ||
    message.includes('forbidden') ||
    message.includes('허용하지 않았') ||
    message.includes('premium') ||
    message.includes('재연결이 필요');
}

async function openSpotifyUriFallback(track, queue = []) {
  const uri = track.spotifyStartUrl || getSpotifyContextOpenUrl(track) || getSpotifyOpenUri(track) || getSpotifyOpenUrl(track) || track.spotifyPlaylistUrl;
  if (!uri) {
    throw buildReconnectionRequiredError();
  }

  if (isNativeNowherePlayerAvailable && NativeNowherePlayer.openSpotifyUrlAsync) {
    try {
      await NativeNowherePlayer.openSpotifyUrlAsync(uri, getNativeOptions({
        skipAuthorization: true,
      }));
    } catch (nativeError) {
      try {
        await Linking.openURL(uri);
      } catch (error) {
        const webUrl = getSpotifyWebUrlFromUri(uri);
        if (!webUrl) {
          throw nativeError;
        }
        await Linking.openURL(webUrl);
      }
      scheduleReturnToNowhere();
    }
  } else {
    try {
      await Linking.openURL(uri);
    } catch (error) {
      const webUrl = getSpotifyWebUrlFromUri(uri);
      if (!webUrl) {
        throw error;
      }
      await Linking.openURL(webUrl);
    }
    scheduleReturnToNowhere();
  }
  const snapshot = setExternalPlaybackSnapshot(track, queue, 'playing');
  return mergeNativeState({
    provider: 'spotify',
    available: true,
    isConnected: false,
    authorizationStatus: 'sequentialUrl',
    isPlaying: true,
    playbackStatus: 'playing',
    currentTrack: snapshot?.track || normalizeTrack(track),
    queue: snapshot?.queue || normalizeQueue(queue.length ? queue : [track]),
  });
}

async function searchTracksWithOwnerApi(query, limit = 5) {
  const searchText = String(query || '').trim();
  if (searchText.length < 2) {
    return [];
  }

  try {
    const response = await callCloudFunctionOptionalAuth('searchSpotifyTracks', {
      query: searchText,
      limit: Math.max(1, Math.min(Number(limit) || 5, 20)),
    });
    return (Array.isArray(response?.tracks) ? response.tracks : []).map(normalizeTrack);
  } catch (error) {
    console.warn('[NOWHERE Spotify Owner API] track search failed', error?.message || error);
    return [];
  }
}

async function maybeResolvePlayableTrack(track) {
  const normalized = normalizeTrack(track);

  if (!isNativeNowherePlayerAvailable) {
    return normalized;
  }

  if ((Platform.OS === 'ios' || Platform.OS === 'android') && normalized.spotifyUri) {
    return normalized;
  }

  const query = [normalized.title, normalized.artist].filter(Boolean).join(' ');
  if (!query || !NativeNowherePlayer.searchCatalogAsync) {
    return normalized;
  }

  try {
    if ((Platform.OS === 'ios' || Platform.OS === 'android') && !API_KEYS.SPOTIFY.clientId) {
      return normalized;
    }
    const results = await NativeNowherePlayer.searchCatalogAsync(query, 1);
    return normalizeTrack({ ...normalized, ...(results?.[0] || {}) });
  } catch (error) {
    return normalized;
  }
}

export const musicPlayerService = {
  provider: getProvider(),
  isNativeAvailable: isNativeNowherePlayerAvailable,
  userReadScopes: USER_SPOTIFY_READ_SCOPES,

  normalizeTrack,
  normalizeQueue,

  subscribeState(listener) {
    return addPlaybackStateListener((state) => listener(mergeNativeState(state)));
  },

  addPlaybackStateListener(listener) {
    return this.subscribeState(listener);
  },

  subscribeScreenState(listener) {
    return addScreenStateListener((state) => listener?.(state));
  },

  async configure() {
    if (!isNativeNowherePlayerAvailable) {
      return mergeNativeState({ provider: 'mock', available: false });
    }
    const state = await NativeNowherePlayer.configureAsync(getNativeOptions());
    return mergeNativeState(state);
  },

  async requestAuthorization(extraOptions = {}) {
    if (!isNativeNowherePlayerAvailable) {
      return { provider: 'mock', authorized: false, status: 'unavailable' };
    }

    if ((Platform.OS === 'ios' || Platform.OS === 'android') && !API_KEYS.SPOTIFY.clientId) {
      return { provider: 'spotify', authorized: false, status: 'missingClientId' };
    }

    return NativeNowherePlayer.requestAuthorizationAsync(getNativeOptions(extraOptions));
  },

  async connect() {
    if (!isNativeNowherePlayerAvailable) {
      return mergeNativeState({ provider: 'mock', available: false });
    }
    const state = await NativeNowherePlayer.connectAsync(getNativeOptions());
    return mergeNativeState(state);
  },

  async prepareAutoPlay(primerTrack = null) {
    const normalizedPrimer = primerTrack ? normalizeTrack(primerTrack) : null;
    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.prepareAutoPlayAsync) {
      if (normalizedPrimer && getSpotifyOpenUri(normalizedPrimer)) {
        return openSpotifyUriFallback(normalizedPrimer, [normalizedPrimer]);
      }
      return mergeNativeState({ provider: 'mock', available: false, playbackStatus: 'readyToOpenSpotify' });
    }

    try {
      const state = await NativeNowherePlayer.prepareAutoPlayAsync(getNativeOptions({
        autoPlayPrimer: normalizedPrimer,
        skipAuthorization: true,
      }));
      if (normalizedPrimer) {
        setExternalPlaybackSnapshot(normalizedPrimer, [normalizedPrimer], state?.playbackStatus || 'openedSpotify');
      }
      return mergeNativeState(state);
    } catch (error) {
      if (normalizedPrimer && getSpotifyOpenUri(normalizedPrimer)) {
        return openSpotifyUriFallback(normalizedPrimer, [normalizedPrimer]);
      }
      return mergeNativeState({
        provider: 'spotify',
        available: true,
        isConnected: false,
        playbackStatus: 'readyToOpenSpotify',
      });
    }
  },

  async search(query, limit = 5) {
    const ownerResults = await searchTracksWithOwnerApi(query, limit);
    if (ownerResults.length) {
      return ownerResults;
    }

    if (!isNativeNowherePlayerAvailable || !query) {
      return [];
    }
    const currentState = await this.getState().catch(() => null);
    if (!isAuthorizedState(currentState)) {
      return [];
    }
    const results = await NativeNowherePlayer.searchCatalogAsync(query, limit);
    return (results || []).map(normalizeTrack);
  },

  async ensureAuthorizationForData() {
    if (!isNativeNowherePlayerAvailable) {
      return false;
    }
    const state = await this.getState().catch(() => null);
    return isAuthorizedState(state);
  },

  async getUserPlaylists(limit = 20) {
    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.getUserPlaylistsAsync) {
      return [];
    }
    if (!(await this.ensureAuthorizationForData())) {
      return [];
    }
    const results = await NativeNowherePlayer.getUserPlaylistsAsync(Math.max(1, Math.min(limit, 50)));
    return (results || []).map((item) => normalizeTrack({ ...item, type: 'playlist' }));
  },

  async getUserTopTracks(limit = 20) {
    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.getUserTopTracksAsync) {
      return [];
    }
    if (!(await this.ensureAuthorizationForData())) {
      return [];
    }
    const results = await NativeNowherePlayer.getUserTopTracksAsync(Math.max(1, Math.min(limit, 50)));
    return (results || []).map(normalizeTrack);
  },

  async getRecentlyPlayedTracks(limit = 20) {
    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.getRecentlyPlayedTracksAsync) {
      return [];
    }
    if (!(await this.ensureAuthorizationForData())) {
      return [];
    }
    const results = await NativeNowherePlayer.getRecentlyPlayedTracksAsync(Math.max(1, Math.min(limit, 50)));
    return (results || []).map(normalizeTrack);
  },

  async getPlaylistTracks(playlistId, limit = 50) {
    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.getPlaylistTracksAsync || !playlistId) {
      return [];
    }
    if (!(await this.ensureAuthorizationForData())) {
      return [];
    }
    const results = await NativeNowherePlayer.getPlaylistTracksAsync(playlistId, Math.max(1, Math.min(limit, 50)));
    return (results || []).map(normalizeTrack);
  },

  async play(track, queue = []) {
    const requestedQueue = normalizeQueue(queue.length ? queue : [track]);
    const normalizedTrack = normalizeTrack(track);

    if (normalizedTrack.spotifyContextUri) {
      return openSpotifyUriFallback(normalizedTrack, requestedQueue);
    }

    if (!isNativeNowherePlayerAvailable) {
      if (getSpotifyOpenUri(track)) {
        return openSpotifyUriFallback(track, requestedQueue);
      }
      return mergeNativeState({
        provider: 'mock',
        available: false,
        isPlaying: true,
        currentTrack: normalizeTrack(track),
        queue: requestedQueue,
        playbackStatus: 'playing',
      });
    }

    try {
      const playableTrack = await maybeResolvePlayableTrack(normalizedTrack);
      const playableQueue = await Promise.all(
        requestedQueue.map((queuedTrack) => maybeResolvePlayableTrack(queuedTrack))
      );
      const state = await NativeNowherePlayer.playAsync(playableTrack, playableQueue);
      return mergeNativeState(state);
    } catch (error) {
      if (isSpotifyControlBlockedError(error)) {
        return openSpotifyUriFallback(track, requestedQueue);
      }
      throw error;
    }
  },

  async openInSpotify(track, queue = []) {
    const requestedQueue = normalizeQueue(queue.length ? queue : [track]);
    return openSpotifyUriFallback(track, requestedQueue);
  },

  async playInBackground(track, queue = []) {
    const requestedQueue = normalizeQueue(queue.length ? queue : [track]);
    const normalizedTrack = normalizeTrack(track);

    if (normalizedTrack.spotifyContextUri) {
      return openSpotifyUriFallback(normalizedTrack, requestedQueue);
    }

    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.playInBackgroundAsync) {
      if (getSpotifyOpenUri(track)) {
        return openSpotifyUriFallback(track, requestedQueue);
      }
      return mergeNativeState({
        provider: 'mock',
        available: false,
        isPlaying: true,
        currentTrack: normalizeTrack(track),
        queue: requestedQueue,
        playbackStatus: 'playing',
      });
    }

    try {
      const playableTrack = await maybeResolvePlayableTrack(normalizedTrack);
      const playableQueue = await Promise.all(
        requestedQueue.map((queuedTrack) => maybeResolvePlayableTrack(queuedTrack))
      );
      const state = await NativeNowherePlayer.playInBackgroundAsync(playableTrack, playableQueue);
      const mergedState = mergeNativeState(state);
      const failure = buildPlaybackFailure(mergedState);
      if (failure) {
        throw failure;
      }
      return mergedState;
    } catch (error) {
      if (isSpotifyControlBlockedError(error)) {
        return openSpotifyUriFallback(track, requestedQueue);
      }
      throw error;
    }
  },

  async pause() {
    clearExternalPlaybackSnapshot();
    if (!isNativeNowherePlayerAvailable) return mergeNativeState({ provider: 'mock', available: false, isPlaying: false, playbackStatus: 'paused' });
    return mergeNativeState(await NativeNowherePlayer.pauseAsync());
  },

  async resume() {
    if (!isNativeNowherePlayerAvailable) return mergeNativeState({ provider: 'mock', available: false, isPlaying: true, playbackStatus: 'playing' });
    return mergeNativeState(await NativeNowherePlayer.resumeAsync());
  },

  async stop() {
    clearExternalPlaybackSnapshot();
    if (!isNativeNowherePlayerAvailable) return mergeNativeState({ provider: 'mock', available: false, isPlaying: false, playbackStatus: STOPPED_STATUS, currentTrack: null, queue: [] });
    return mergeNativeState(await NativeNowherePlayer.stopAsync());
  },

  async clearAuthorization() {
    clearExternalPlaybackSnapshot();
    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.clearAuthorizationAsync) {
      return mergeNativeState({
        provider: getProvider(),
        available: isNativeNowherePlayerAvailable,
        isPlaying: false,
        playbackStatus: STOPPED_STATUS,
        currentTrack: null,
        queue: [],
        authorizationStatus: 'notDetermined',
        isAuthorized: false,
      });
    }
    return mergeNativeState(await NativeNowherePlayer.clearAuthorizationAsync());
  },

  async skipNext() {
    if (!isNativeNowherePlayerAvailable) return null;
    return mergeNativeState(await NativeNowherePlayer.skipNextAsync());
  },

  async skipPrevious() {
    if (!isNativeNowherePlayerAvailable) return null;
    return mergeNativeState(await NativeNowherePlayer.skipPreviousAsync());
  },

  async seek(positionMs) {
    if (!isNativeNowherePlayerAvailable) return null;
    return mergeNativeState(await NativeNowherePlayer.seekToAsync(positionMs));
  },

  async seekTo(positionMs) {
    return this.seek(positionMs);
  },

  async getState() {
    if (!isNativeNowherePlayerAvailable) {
      return getExternalPlaybackState({ provider: 'mock', available: false }) ||
        mergeNativeState({ provider: 'mock', available: false });
    }
    const nativeState = mergeNativeState(await NativeNowherePlayer.getStateAsync());
    const nativeHasLiveTrack = hasTrackIdentity(nativeState.currentTrack);
    if (nativeState.isPlaying && nativeHasLiveTrack) {
      clearExternalPlaybackSnapshot();
      return nativeState;
    }
    if (!isAuthorizedState(nativeState) || !nativeHasLiveTrack || ['idle', 'unknown', 'notDetermined'].includes(nativeState.playbackStatus)) {
      return getExternalPlaybackState(nativeState) || nativeState;
    }
    return nativeState;
  },
};
