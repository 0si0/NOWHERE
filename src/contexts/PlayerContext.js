import React, { createContext, useState, useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { musicPlayerService } from '../services/musicPlayerService';

export const PlayerContext = createContext(null);

const initialPlayerState = {
  provider: musicPlayerService.provider,
  available: musicPlayerService.isNativeAvailable,
  isConnected: false,
  isPlaying: false,
  playbackStatus: 'idle',
  positionMs: 0,
  currentTrack: null,
  queue: [],
  error: null,
};

export function PlayerProvider({ children }) {
  const [playerState, setPlayerState] = useState(initialPlayerState);

  const applyState = useCallback((state) => {
    if (!state) return;
    setPlayerState((prev) => ({
      ...prev,
      ...state,
      currentTrack: state.currentTrack === undefined ? prev.currentTrack : state.currentTrack,
      queue: Array.isArray(state.queue) ? state.queue : prev.queue,
      isPlaying: Boolean(state.isPlaying),
    }));
  }, []);

  useEffect(() => {
    let mounted = true;
    const subscription = musicPlayerService.subscribeState((state) => {
      if (mounted) {
        applyState(state);
      }
    });

    musicPlayerService.configure()
      .then((state) => {
        if (mounted) applyState(state);
      })
      .catch((error) => {
        if (mounted) {
          setPlayerState((prev) => ({
            ...prev,
            error: error.message,
          }));
        }
      });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [applyState]);

  const play = useCallback(async (track, trackQueue = []) => {
    const normalizedTrack = musicPlayerService.normalizeTrack(track);
    const normalizedQueue = musicPlayerService.normalizeQueue(trackQueue.length ? trackQueue : [track]);
    setPlayerState((prev) => ({
      ...prev,
      error: null,
      playbackStatus: 'loading',
      queue: musicPlayerService.isNativeAvailable ? prev.queue : normalizedQueue,
      currentTrack: musicPlayerService.isNativeAvailable ? prev.currentTrack : normalizedTrack,
      isPlaying: musicPlayerService.isNativeAvailable ? prev.isPlaying : true,
    }));

    try {
      const state = await musicPlayerService.play(normalizedTrack, normalizedQueue);
      applyState(state);
      return state;
    } catch (error) {
      setPlayerState((prev) => ({
        ...prev,
        isPlaying: false,
        playbackStatus: 'error',
        error: error.message,
      }));
      throw error;
    }
  }, [applyState]);

  const requestAuthorization = useCallback(async () => {
    const result = await musicPlayerService.requestAuthorization();
    setPlayerState((prev) => ({
      ...prev,
      authorizationStatus: result.status,
      isAuthorized: Boolean(result.authorized),
    }));
    return result;
  }, []);

  const pause = useCallback(async () => {
    try {
      const state = await musicPlayerService.pause();
      applyState(state);
      return state;
    } catch (error) {
      setPlayerState((prev) => ({ ...prev, error: error.message }));
      throw error;
    }
  }, [applyState]);

  const resume = useCallback(async () => {
    try {
      const state = await musicPlayerService.resume();
      applyState(state);
      return state;
    } catch (error) {
      setPlayerState((prev) => ({ ...prev, error: error.message }));
      throw error;
    }
  }, [applyState]);

  const togglePlay = useCallback(async () => {
    return playerState.isPlaying ? pause() : resume();
  }, [pause, playerState.isPlaying, resume]);

  const skipNext = useCallback(async () => {
    try {
      const state = await musicPlayerService.skipNext();
      applyState(state);
      return state;
    } catch (error) {
      setPlayerState((prev) => ({ ...prev, error: error.message }));
      throw error;
    }
  }, [applyState]);

  const skipPrevious = useCallback(async () => {
    try {
      const state = await musicPlayerService.skipPrevious();
      applyState(state);
      return state;
    } catch (error) {
      setPlayerState((prev) => ({ ...prev, error: error.message }));
      throw error;
    }
  }, [applyState]);

  const seek = useCallback(async (positionMs) => {
    try {
      const state = await musicPlayerService.seek(positionMs);
      applyState(state);
      return state;
    } catch (error) {
      setPlayerState((prev) => ({ ...prev, error: error.message }));
      throw error;
    }
  }, [applyState]);

  const seekTo = seek;

  const stop = useCallback(async () => {
    try {
      const state = await musicPlayerService.stop();
      applyState(state || { currentTrack: null, isPlaying: false, playbackStatus: 'stopped', queue: [] });
      return state;
    } catch (error) {
      setPlayerState((prev) => ({ ...prev, error: error.message }));
      throw error;
    }
  }, [applyState]);

  const getState = useCallback(async () => {
    const state = await musicPlayerService.getState();
    applyState(state);
    return state;
  }, [applyState]);

  useEffect(() => {
    const shouldPoll = Boolean(playerState.currentTrack)
      || ['loading', 'openedSpotify', 'playing', 'paused'].includes(playerState.playbackStatus);
    if (!shouldPoll) {
      return undefined;
    }

    let inFlight = false;
    const interval = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await getState();
      } catch (error) {
        setPlayerState((prev) => ({
          ...prev,
          error: prev.error || error.message,
        }));
      } finally {
        inFlight = false;
      }
    }, playerState.isPlaying ? 2500 : 5000);

    return () => clearInterval(interval);
  }, [getState, playerState.currentTrack, playerState.isPlaying, playerState.playbackStatus]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && playerState.currentTrack) {
        getState().catch((error) => {
          setPlayerState((prev) => ({
            ...prev,
            error: prev.error || error.message,
          }));
        });
      }
    });

    return () => subscription.remove();
  }, [getState, playerState.currentTrack]);

  const subscribeState = useCallback((listener) => (
    musicPlayerService.subscribeState((state) => {
      applyState(state);
      listener?.(state);
    })
  ), [applyState]);

  const value = useMemo(() => ({
    currentTrack: playerState.currentTrack,
    isPlaying: playerState.isPlaying,
    queue: playerState.queue,
    playerStatus: playerState,
    playerState,
    play,
    pause,
    resume,
    requestAuthorization,
    togglePlay,
    skipNext,
    skipPrevious,
    seek,
    seekTo,
    stop,
    getState,
    subscribeState,
  }), [
    playerState,
    play,
    pause,
    resume,
    requestAuthorization,
    togglePlay,
    skipNext,
    skipPrevious,
    seek,
    seekTo,
    stop,
    getState,
    subscribeState,
  ]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
}
