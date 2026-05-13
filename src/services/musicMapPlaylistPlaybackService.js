const MAX_TRACK_PLAYLIST_ITEMS = 10;
const MIN_TRACK_DURATION_MS = 30000;
const DEFAULT_TRACK_DURATION_MS = 180000;

const playbackControllers = new Map();

function getController(channel = 'music-map') {
  const key = String(channel || 'music-map');
  const controller = playbackControllers.get(key) || { runId: 0, timerId: null };
  playbackControllers.set(key, controller);
  return controller;
}

function getTrackDurationMs(track = {}) {
  const durationMs = Number(track.durationMs || 0);
  return Number.isFinite(durationMs) && durationMs > 0
    ? Math.max(MIN_TRACK_DURATION_MS, durationMs)
    : DEFAULT_TRACK_DURATION_MS;
}

function getPlayableTracks(tracks = []) {
  return (Array.isArray(tracks) ? tracks : [])
    .filter((track) => track?.spotifyUri || track?.uri || track?.spotifyUrl)
    .slice(0, MAX_TRACK_PLAYLIST_ITEMS);
}

export function stopMusicMapTrackPlaylistPlayback(channel = 'music-map') {
  const controller = getController(channel);
  controller.runId += 1;
  if (controller.timerId) {
    clearTimeout(controller.timerId);
    controller.timerId = null;
  }
}

export async function startMusicMapTrackPlaylistPlayback(
  tracks = [],
  playTrack,
  onNextTrackError = () => {},
  onComplete = () => {},
  channel = 'music-map'
) {
  const playableTracks = getPlayableTracks(tracks);
  if (!playableTracks.length) {
    throw new Error('재생 가능한 Spotify 곡이 없습니다. 트랙 플레이리스트를 다시 설정해주세요.');
  }
  if (typeof playTrack !== 'function') {
    throw new Error('Spotify 재생 준비가 끝나지 않았습니다. 잠시 후 다시 시도해주세요.');
  }

  const controller = getController(channel);
  stopMusicMapTrackPlaylistPlayback(channel);
  const currentRunId = controller.runId;

  try {
    await playTrack(playableTracks[0], playableTracks);
  } catch (error) {
    onNextTrackError(error);
    throw error;
  }

  if (controller.runId !== currentRunId) {
    return;
  }

  const scheduleNextTrack = (index) => {
    const currentTrack = playableTracks[index];
    controller.timerId = setTimeout(() => {
      if (controller.runId !== currentRunId) {
        return;
      }

      const nextIndex = index + 1;
      if (nextIndex >= playableTracks.length) {
        controller.timerId = null;
        onComplete();
        return;
      }

      playTrack(playableTracks[nextIndex], playableTracks.slice(nextIndex))
        .then(() => {
          if (controller.runId !== currentRunId) {
            return;
          }
          scheduleNextTrack(nextIndex);
        })
        .catch((error) => {
          onNextTrackError(error);
        });
    }, getTrackDurationMs(currentTrack));
  };

  scheduleNextTrack(0);
}
