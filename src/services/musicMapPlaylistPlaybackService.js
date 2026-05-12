const MAX_TRACK_PLAYLIST_ITEMS = 10;
const MIN_TRACK_DURATION_MS = 30000;
const DEFAULT_TRACK_DURATION_MS = 180000;

let playbackRunId = 0;
let playbackTimerId = null;

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

export function stopMusicMapTrackPlaylistPlayback() {
  playbackRunId += 1;
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
}

export async function startMusicMapTrackPlaylistPlayback(tracks = [], playTrack, onNextTrackError = () => {}) {
  const playableTracks = getPlayableTracks(tracks);
  if (!playableTracks.length) {
    throw new Error('재생 가능한 Spotify 곡이 없습니다. 트랙 플레이리스트를 다시 설정해주세요.');
  }
  if (typeof playTrack !== 'function') {
    throw new Error('Spotify 재생 준비가 끝나지 않았습니다. 잠시 후 다시 시도해주세요.');
  }

  stopMusicMapTrackPlaylistPlayback();
  const currentRunId = playbackRunId;

  const playAtIndex = async (index) => {
    if (playbackRunId !== currentRunId || index >= playableTracks.length) {
      return;
    }

    const track = playableTracks[index];
    await playTrack(track, playableTracks.slice(index));

    if (playbackRunId !== currentRunId || index >= playableTracks.length - 1) {
      return;
    }

    playbackTimerId = setTimeout(() => {
      playAtIndex(index + 1).catch((error) => {
        onNextTrackError(error);
      });
    }, getTrackDurationMs(track));
  };

  await playAtIndex(0);
}
