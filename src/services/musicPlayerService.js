import { Platform } from 'react-native';
import NativeNowherePlayer, {
  addPlaybackStateListener,
  isNativeNowherePlayerAvailable,
} from 'nowhere-player';
import { API_KEYS } from '../constants';

const DEFAULT_COLOR = '#7CFFB2';
const STOPPED_STATUS = 'stopped';

function getProvider() {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return 'spotify';
  }
  return 'mock';
}

function getNativeOptions(extraOptions = {}) {
  return {
    provider: getProvider(),
    spotifyClientId: API_KEYS.SPOTIFY.clientId,
    spotifyRedirectUri: API_KEYS.SPOTIFY.redirectUri,
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

  normalizeTrack,
  normalizeQueue,

  subscribeState(listener) {
    return addPlaybackStateListener((state) => listener(mergeNativeState(state)));
  },

  addPlaybackStateListener(listener) {
    return this.subscribeState(listener);
  },

  async configure() {
    if (!isNativeNowherePlayerAvailable) {
      return mergeNativeState({ provider: 'mock', available: false });
    }
    const state = await NativeNowherePlayer.configureAsync(getNativeOptions());
    return mergeNativeState(state);
  },

  async requestAuthorization() {
    if (!isNativeNowherePlayerAvailable) {
      return { provider: 'mock', authorized: false, status: 'unavailable' };
    }

    if ((Platform.OS === 'ios' || Platform.OS === 'android') && !API_KEYS.SPOTIFY.clientId) {
      return { provider: 'spotify', authorized: false, status: 'missingClientId' };
    }

    return NativeNowherePlayer.requestAuthorizationAsync(getNativeOptions());
  },

  async connect() {
    if (!isNativeNowherePlayerAvailable) {
      return mergeNativeState({ provider: 'mock', available: false });
    }
    const state = await NativeNowherePlayer.connectAsync(getNativeOptions());
    return mergeNativeState(state);
  },

  async prepareAutoPlay(primerTrack = null) {
    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.prepareAutoPlayAsync) {
      return mergeNativeState({ provider: 'mock', available: false, playbackStatus: 'preparingAutoPlay' });
    }

    if ((Platform.OS === 'ios' || Platform.OS === 'android') && !API_KEYS.SPOTIFY.clientId) {
      return { provider: 'spotify', authorized: false, status: 'missingClientId' };
    }

    const playablePrimerTrack = primerTrack ? await maybeResolvePlayableTrack(primerTrack) : null;
    const state = await NativeNowherePlayer.prepareAutoPlayAsync(getNativeOptions({
      autoPlayPrimer: playablePrimerTrack,
    }));
    return mergeNativeState(state);
  },

  async search(query, limit = 5) {
    if (!isNativeNowherePlayerAvailable || !query) {
      return [];
    }
    const results = await NativeNowherePlayer.searchCatalogAsync(query, limit);
    return (results || []).map(normalizeTrack);
  },

  async getUserPlaylists(limit = 20) {
    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.getUserPlaylistsAsync) {
      return [];
    }
    const results = await NativeNowherePlayer.getUserPlaylistsAsync(Math.max(1, Math.min(limit, 50)));
    return (results || []).map((item) => normalizeTrack({ ...item, type: 'playlist' }));
  },

  async play(track, queue = []) {
    const requestedQueue = normalizeQueue(queue.length ? queue : [track]);

    if (!isNativeNowherePlayerAvailable) {
      return mergeNativeState({
        provider: 'mock',
        available: false,
        isPlaying: true,
        currentTrack: normalizeTrack(track),
        queue: requestedQueue,
        playbackStatus: 'playing',
      });
    }

    await this.requestAuthorization();

    const playableTrack = await maybeResolvePlayableTrack(track);
    const playableQueue = await Promise.all(
      requestedQueue.map((queuedTrack) => maybeResolvePlayableTrack(queuedTrack))
    );
    const state = await NativeNowherePlayer.playAsync(playableTrack, playableQueue);
    return mergeNativeState(state);
  },

  async playInBackground(track, queue = []) {
    const requestedQueue = normalizeQueue(queue.length ? queue : [track]);

    if (!isNativeNowherePlayerAvailable || !NativeNowherePlayer.playInBackgroundAsync) {
      return mergeNativeState({
        provider: 'mock',
        available: false,
        isPlaying: true,
        currentTrack: normalizeTrack(track),
        queue: requestedQueue,
        playbackStatus: 'playing',
      });
    }

    const playableTrack = await maybeResolvePlayableTrack(track);
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
  },

  async pause() {
    if (!isNativeNowherePlayerAvailable) return mergeNativeState({ provider: 'mock', available: false, isPlaying: false, playbackStatus: 'paused' });
    return mergeNativeState(await NativeNowherePlayer.pauseAsync());
  },

  async resume() {
    if (!isNativeNowherePlayerAvailable) return mergeNativeState({ provider: 'mock', available: false, isPlaying: true, playbackStatus: 'playing' });
    return mergeNativeState(await NativeNowherePlayer.resumeAsync());
  },

  async stop() {
    if (!isNativeNowherePlayerAvailable) return mergeNativeState({ provider: 'mock', available: false, isPlaying: false, playbackStatus: STOPPED_STATUS, currentTrack: null, queue: [] });
    return mergeNativeState(await NativeNowherePlayer.stopAsync());
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
      return mergeNativeState({ provider: 'mock', available: false });
    }
    return mergeNativeState(await NativeNowherePlayer.getStateAsync());
  },
};
