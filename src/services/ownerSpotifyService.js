import { callCloudFunctionOptionalAuth } from './firebaseService';

const OWNER_SPOTIFY_LOG_PREFIX = '[NOWHERE Owner Spotify]';

export async function ensureOwnerSpotifyReady() {
  try {
    const response = await callCloudFunctionOptionalAuth('getDemoSpotifyTracks', { limit: 1 });
    const chartTracks = Array.isArray(response?.chartTracks) ? response.chartTracks : [];
    console.info(OWNER_SPOTIFY_LOG_PREFIX, 'preflight ok', {
      chartTrackCount: chartTracks.length,
      provider: response?.provider || '',
    });
    return {
      ok: true,
      chartTrackCount: chartTracks.length,
    };
  } catch (error) {
    console.warn(OWNER_SPOTIFY_LOG_PREFIX, 'preflight failed', error?.message || error);
    return {
      ok: false,
      message: error?.message || 'Spotify owner API 준비에 실패했습니다.',
    };
  }
}
