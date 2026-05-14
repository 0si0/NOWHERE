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
    spotifyContextUri: String(track.spotifyContextUri || track.contextUri || '').trim(),
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
    sourceType: String(playlist.sourceType || '').trim(),
    spotifyUri: String(playlist.spotifyUri || '').trim(),
    spotifyPlaylistId: String(playlist.spotifyPlaylistId || playlist.playlistId || '').trim(),
    spotifyPlaylistUrl: String(playlist.spotifyPlaylistUrl || '').trim(),
    spotifyStartUrl: String(playlist.spotifyStartUrl || '').trim(),
    playlistVisibility: String(playlist.playlistVisibility || '').trim(),
    ownerPlaylistTrackSignature: String(playlist.ownerPlaylistTrackSignature || '').trim(),
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

function extractSpotifyPlaylistId(input = '') {
  const value = String(input || '').trim();
  if (!value) return '';

  if (value.startsWith('spotify:playlist:')) {
    return value.split(':')[2] || '';
  }

  const match = value.match(/open\.spotify\.com\/playlist\/([^?/#]+)/i);
  return match?.[1] || '';
}

export async function importSpotifyPlaylistTracks(input, limit = MAX_TRACK_PLAYLIST_ITEMS) {
  const playlistId = extractSpotifyPlaylistId(input);
  if (!playlistId) {
    throw new Error('Spotify 플레이리스트 링크를 확인해주세요.');
  }

  const spotifyContextUri = `spotify:playlist:${playlistId}`;
  const response = await callCloudFunctionOptionalAuth('getSpotifyPlaylistTracks', {
    playlistId,
    limit: Math.max(1, Math.min(Number(limit) || MAX_TRACK_PLAYLIST_ITEMS, 50)),
  });
  const tracks = dedupeTracks((response?.tracks || []).map((track) => ({
    ...track,
    spotifyContextUri,
  })));

  if (!tracks.length) {
    throw new Error('이 플레이리스트에서 앨범 이미지가 있는 곡을 찾지 못했습니다.');
  }

  return {
    id: `spotify-playlist-${playlistId}`,
    name: String(response?.playlistName || 'Spotify 플레이리스트').trim(),
    spotifyUri: response?.spotifyUri || spotifyContextUri,
    tracks,
  };
}

function getSpotifyTrackIdFromUri(uri = '') {
  const value = String(uri || '').trim();
  if (value.startsWith('spotify:track:')) {
    return value.split(':')[2] || '';
  }
  const match = value.match(/open\.spotify\.com\/track\/([^?/#]+)/i);
  return match?.[1] || '';
}

function buildTrackSignature(tracks = []) {
  return (Array.isArray(tracks) ? tracks : [])
    .map((track) => String(track?.spotifyUri || track?.uri || track?.id || '').trim())
    .filter(Boolean)
    .join('|');
}

function buildSpotifyStartUrl(tracks = [], spotifyContextUri = '') {
  const firstTrack = (Array.isArray(tracks) ? tracks : []).find((track) => track?.spotifyUri || track?.uri);
  const trackId = getSpotifyTrackIdFromUri(firstTrack?.spotifyUri || firstTrack?.uri || '');
  if (!trackId || !spotifyContextUri) {
    return '';
  }
  return `https://open.spotify.com/track/${encodeURIComponent(trackId)}?context=${encodeURIComponent(spotifyContextUri)}`;
}

export async function createOwnerMusicMapSpotifyPlaylist(playlist = {}) {
  const tracks = dedupeTracks(playlist.tracks || []);
  const spotifyTracks = tracks.filter((track) => String(track.spotifyUri || '').startsWith('spotify:track:'));
  if (!spotifyTracks.length) {
    throw new Error('Spotify URI가 있는 곡을 먼저 추가해주세요.');
  }

  let response;
  try {
    response = await callCloudFunctionOptionalAuth('createOwnerMusicMapPlaylist', {
      playlistName: playlist.name || 'Music Map',
      tracks: spotifyTracks.map((track) => ({
        id: track.id,
        trackId: track.trackId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        albumArtUrl: track.albumArtUrl || track.artworkUrl,
        artworkUrl: track.albumArtUrl || track.artworkUrl,
        albumColor: track.albumColor || track.color,
        spotifyUri: track.spotifyUri,
        durationMs: track.durationMs,
      })),
    });
  } catch (error) {
    const detailMessage = error?.details?.message || error?.message || '';
    const diagnosticId = error?.details?.diagnosticId ? `\n진단 ID: ${error.details.diagnosticId}` : '';
    const stage = error?.details?.stage ? `\n실패 단계: ${error.details.stage}` : '';
    const spotifyStatus = error?.details?.status ? `\nSpotify 상태: ${error.details.status}` : '';
    const spotifyMessage = error?.details?.spotifyError?.error?.message
      || error?.details?.spotifyError?.message
      || error?.details?.spotifyError?.errorDescription
      || '';
    if (
      detailMessage.includes('playlist-modify-public') ||
      detailMessage.includes('playlist-modify-private')
    ) {
      throw new Error(`Owner Spotify 토큰에 playlist-modify-private 또는 playlist-modify-public 권한이 없습니다. owner refresh token을 playlist 생성 권한으로 다시 발급한 뒤 Firebase secret을 갱신해주세요.${diagnosticId}${stage}${spotifyStatus}`);
    }
    throw new Error(`${detailMessage || 'Owner Spotify playlist 생성에 실패했습니다.'}${spotifyMessage ? `\nSpotify 응답: ${spotifyMessage}` : ''}${diagnosticId}${stage}${spotifyStatus}`);
  }

  const spotifyContextUri = String(response?.spotifyUri || '').trim();
  const returnedTracks = dedupeTracks(response?.tracks || spotifyTracks);
  const contextTracks = returnedTracks.map((track) => ({
    ...track,
    spotifyContextUri,
  }));

  return {
    spotifyPlaylistId: String(response?.spotifyPlaylistId || response?.playlistId || '').trim(),
    spotifyPlaylistUrl: String(response?.spotifyPlaylistUrl || '').trim(),
    playlistVisibility: String(response?.playlistVisibility || '').trim(),
    spotifyUri: spotifyContextUri,
    spotifyStartUrl: buildSpotifyStartUrl(contextTracks, spotifyContextUri),
    ownerPlaylistTrackSignature: buildTrackSignature(contextTracks),
    tracks: contextTracks,
  };
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
