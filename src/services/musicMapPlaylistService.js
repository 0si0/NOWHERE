import AsyncStorage from '@react-native-async-storage/async-storage';
import { callCloudFunctionOptionalAuth } from './firebaseService';
import { DEFAULT_ALBUM_COLOR, getInitialAlbumColor, resolveAlbumColor } from './albumColorService';

const MUSIC_MAP_TRACK_PLAYLIST_KEY = '@nowhere/music-map-track-playlist-v1';
const MUSIC_MAP_TRACK_PLAYLISTS_KEY = '@nowhere/music-map-track-playlists-v1';
const MUSIC_MAP_SELECTED_TRACK_PLAYLIST_ID_KEY = '@nowhere/music-map-selected-track-playlist-id-v1';
const MAX_TRACK_PLAYLIST_ITEMS = 10;
const MAX_SAVED_TRACK_PLAYLISTS = 12;

function normalizeTrack(track = {}) {
  const title = String(track.title || track.name || track.trackName || '').trim();
  const artist = String(track.artist || track.artistName || '').trim();
  const spotifyUri = String(track.spotifyUri || track.uri || '').trim();
  const albumArtUrl = String(track.albumArtUrl || track.artworkUrl || track.imageUrl || '').trim();

  if (!title || !artist || !albumArtUrl) {
    return null;
  }

  return {
    type: 'track',
    provider: 'spotify',
    id: String(track.id || spotifyUri || `${title}-${artist}`).trim(),
    trackId: String(track.trackId || track.id || spotifyUri || '').trim(),
    title,
    artist,
    album: String(track.album || track.albumName || '').trim(),
    albumArtUrl,
    artworkUrl: albumArtUrl,
    albumColor: track.albumColor || track.color || getInitialAlbumColor(track) || DEFAULT_ALBUM_COLOR,
    color: track.albumColor || track.color || getInitialAlbumColor(track) || DEFAULT_ALBUM_COLOR,
    spotifyUri,
    spotifyUrl: String(track.spotifyUrl || '').trim(),
    durationMs: Math.max(30000, Number(track.durationMs || 0) || 180000),
  };
}

function dedupeTracks(tracks = []) {
  const seen = new Set();
  return tracks
    .map(normalizeTrack)
    .filter(Boolean)
    .filter((track) => {
      const key = String(track.spotifyUri || track.id || `${track.title}:${track.artist}`).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_TRACK_PLAYLIST_ITEMS);
}

function buildPlaylistId(index = 0) {
  return `music-map-playlist-${Date.now()}-${index}`;
}

function normalizePlaylist(playlist = {}, index = 0) {
  const rawTracks = Array.isArray(playlist.tracks)
    ? playlist.tracks
    : Array.isArray(playlist)
      ? playlist
      : [];
  const tracks = dedupeTracks(rawTracks);
  const now = new Date().toISOString();
  const id = String(playlist.id || buildPlaylistId(index)).trim();
  return {
    id,
    name: String(playlist.name || `트랙 플레이리스트 ${index + 1}`).trim(),
    tracks,
    createdAt: playlist.createdAt || now,
    updatedAt: playlist.updatedAt || now,
  };
}

function normalizePlaylists(playlists = []) {
  const seen = new Set();
  return (Array.isArray(playlists) ? playlists : [])
    .map(normalizePlaylist)
    .filter((playlist) => {
      if (!playlist.id || seen.has(playlist.id)) return false;
      seen.add(playlist.id);
      return true;
    })
    .slice(0, MAX_SAVED_TRACK_PLAYLISTS);
}

async function loadLegacyTrackPlaylist() {
  const raw = await AsyncStorage.getItem(MUSIC_MAP_TRACK_PLAYLIST_KEY);
  if (!raw) return [];

  try {
    return dedupeTracks(JSON.parse(raw));
  } catch (error) {
    await AsyncStorage.removeItem(MUSIC_MAP_TRACK_PLAYLIST_KEY);
    return [];
  }
}

export async function loadSelectedMusicMapTrackPlaylistId() {
  return AsyncStorage.getItem(MUSIC_MAP_SELECTED_TRACK_PLAYLIST_ID_KEY).catch(() => '');
}

export async function saveSelectedMusicMapTrackPlaylistId(playlistId = '') {
  const id = String(playlistId || '').trim();
  if (!id) {
    await AsyncStorage.removeItem(MUSIC_MAP_SELECTED_TRACK_PLAYLIST_ID_KEY);
    return '';
  }
  await AsyncStorage.setItem(MUSIC_MAP_SELECTED_TRACK_PLAYLIST_ID_KEY, id);
  return id;
}

export async function loadMusicMapTrackPlaylists() {
  const raw = await AsyncStorage.getItem(MUSIC_MAP_TRACK_PLAYLISTS_KEY);
  if (raw) {
    try {
      return normalizePlaylists(JSON.parse(raw));
    } catch (error) {
      await AsyncStorage.removeItem(MUSIC_MAP_TRACK_PLAYLISTS_KEY);
    }
  }

  const legacyTracks = await loadLegacyTrackPlaylist();
  if (!legacyTracks.length) {
    return [];
  }

  const migratedPlaylists = normalizePlaylists([{
    id: 'music-map-playlist-default',
    name: '트랙 플레이리스트 1',
    tracks: legacyTracks,
  }]);
  await AsyncStorage.setItem(MUSIC_MAP_TRACK_PLAYLISTS_KEY, JSON.stringify(migratedPlaylists));
  await saveSelectedMusicMapTrackPlaylistId(migratedPlaylists[0]?.id || '');
  return migratedPlaylists;
}

export async function saveMusicMapTrackPlaylists(playlists = []) {
  const normalized = normalizePlaylists(playlists);
  await AsyncStorage.setItem(MUSIC_MAP_TRACK_PLAYLISTS_KEY, JSON.stringify(normalized));
  const firstTracks = normalized[0]?.tracks || [];
  await AsyncStorage.setItem(MUSIC_MAP_TRACK_PLAYLIST_KEY, JSON.stringify(firstTracks));
  return normalized;
}

export async function loadMusicMapTrackPlaylist() {
  const playlists = await loadMusicMapTrackPlaylists();
  const selectedId = await loadSelectedMusicMapTrackPlaylistId();
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedId) || playlists[0];
  if (selectedPlaylist) {
    return selectedPlaylist.tracks || [];
  }
  return loadLegacyTrackPlaylist();
}

export async function saveMusicMapTrackPlaylist(tracks = []) {
  const normalized = dedupeTracks(tracks);
  const playlists = await loadMusicMapTrackPlaylists();
  const selectedId = await loadSelectedMusicMapTrackPlaylistId();
  const selectedIndex = playlists.findIndex((playlist) => playlist.id === selectedId);
  const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const targetPlaylist = playlists[targetIndex] || normalizePlaylist({
    id: 'music-map-playlist-default',
    name: '트랙 플레이리스트 1',
    tracks: [],
  });
  const nextPlaylists = playlists.length
    ? playlists.map((playlist, index) => (
      index === targetIndex
        ? { ...playlist, tracks: normalized, updatedAt: new Date().toISOString() }
        : playlist
    ))
    : [{ ...targetPlaylist, tracks: normalized, updatedAt: new Date().toISOString() }];
  await saveMusicMapTrackPlaylists(nextPlaylists);
  await saveSelectedMusicMapTrackPlaylistId(nextPlaylists[targetIndex]?.id || nextPlaylists[0]?.id || '');
  await AsyncStorage.setItem(MUSIC_MAP_TRACK_PLAYLIST_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function searchMusicMapTracks(query, limit = 8) {
  const searchText = String(query || '').trim();
  if (searchText.length < 2) return [];
  try {
    const response = await callCloudFunctionOptionalAuth('searchSpotifyTracks', {
      query: searchText,
      limit: Math.max(1, Math.min(Number(limit) || 8, 12)),
    });
    return dedupeTracks(response?.tracks || []);
  } catch (error) {
    return [];
  }
}

export async function getTrendingMusicMapTracks(limit = 8) {
  try {
    const response = await callCloudFunctionOptionalAuth('getDemoSpotifyTracks', {
      limit: Math.max(1, Math.min(Number(limit) || 8, 20)),
    });
    return dedupeTracks(response?.chartTracks || []);
  } catch (error) {
    return [];
  }
}

export async function hydrateMusicMapTrackColors(tracks = []) {
  const normalized = dedupeTracks(tracks);
  return Promise.all(normalized.map(async (track) => {
    const albumColor = await resolveAlbumColor(track).catch(() => track.albumColor || DEFAULT_ALBUM_COLOR);
    return {
      ...track,
      albumColor,
      color: albumColor,
    };
  }));
}

export { MAX_TRACK_PLAYLIST_ITEMS };
