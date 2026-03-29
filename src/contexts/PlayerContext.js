import React, { createContext, useState, useCallback } from 'react';

export const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueue] = useState([]);

  const play = useCallback((track, trackQueue = []) => {
    setCurrentTrack(track);
    setQueue(trackQueue);
    setIsPlaying(true);
    // TODO: Integrate with Apple MusicKit (iOS) or Spotify SDK (Android)
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const skipNext = useCallback(() => {
    if (queue.length === 0) return;
    const currentIdx = queue.findIndex((t) => t.id === currentTrack?.id);
    const next = queue[currentIdx + 1] || queue[0];
    setCurrentTrack(next);
    setIsPlaying(true);
  }, [queue, currentTrack]);

  const stop = useCallback(() => {
    setCurrentTrack(null);
    setIsPlaying(false);
  }, []);

  return (
    <PlayerContext.Provider value={{ currentTrack, isPlaying, queue, play, togglePlay, skipNext, stop }}>
      {children}
    </PlayerContext.Provider>
  );
}
