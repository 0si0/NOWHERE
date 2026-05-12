import {
  callCloudFunctionOptionalAuth,
  getOrCreateAppUserId,
  getUserFavoriteArtists,
  saveUserFavoriteArtists,
} from './firebaseService';

const FAVORITE_ARTIST_LOG_PREFIX = '[NOWHERE Favorite Artists]';

function normalizeArtist(artist = {}) {
  const id = String(artist.id || artist.spotifyId || '').trim();
  const uri = String(artist.spotifyUri || artist.uri || '').trim();
  return {
    id,
    spotifyId: id,
    provider: 'spotify',
    name: String(artist.name || '').trim(),
    spotifyUri: uri,
    uri,
    artworkUrl: String(artist.artworkUrl || artist.imageUrl || '').trim(),
    imageUrl: String(artist.artworkUrl || artist.imageUrl || '').trim(),
    popularity: Number.isFinite(Number(artist.popularity)) ? Number(artist.popularity) : 0,
    genres: Array.isArray(artist.genres) ? artist.genres.slice(0, 6) : [],
  };
}

function uniqueArtists(artists = [], maxCount = 3) {
  const used = new Set();
  return (Array.isArray(artists) ? artists : [])
    .map(normalizeArtist)
    .filter((artist) => artist.name && (artist.id || artist.spotifyUri))
    .filter((artist) => {
      const key = String(artist.id || artist.spotifyUri || artist.name).toLowerCase();
      if (!key || used.has(key)) {
        return false;
      }
      used.add(key);
      return true;
    })
    .slice(0, maxCount);
}

export async function searchFavoriteArtists(query, limit = 8) {
  const searchText = String(query || '').trim();
  if (searchText.length < 2) {
    return [];
  }

  try {
    const response = await callCloudFunctionOptionalAuth('searchSpotifyArtists', {
      query: searchText,
      limit: Math.max(1, Math.min(Number(limit) || 8, 12)),
    });
    return uniqueArtists(response?.artists || [], Math.max(1, Math.min(Number(limit) || 8, 12)));
  } catch (error) {
    console.warn(FAVORITE_ARTIST_LOG_PREFIX, 'search failed', error?.message || error);
    throw new Error(error?.message || 'Spotify 아티스트 검색에 실패했습니다.');
  }
}

export async function loadFavoriteArtists(userId = '') {
  const ownerId = userId || await getOrCreateAppUserId();
  return uniqueArtists(await getUserFavoriteArtists(ownerId), 3);
}

export async function persistFavoriteArtists(artists = [], userId = '') {
  const ownerId = userId || await getOrCreateAppUserId();
  return saveUserFavoriteArtists(ownerId, uniqueArtists(artists, 3));
}

export function normalizeFavoriteArtists(artists = []) {
  return uniqueArtists(artists, 3);
}
