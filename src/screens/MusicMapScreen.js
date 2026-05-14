import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import KakaoMusicMap from '../components/KakaoMusicMap';
import { PlayerContext } from '../contexts/PlayerContext';
import { LocationContext } from '../contexts/LocationContext';
import { useSession } from '../contexts/SessionContext';
import { API_KEYS, COLORS } from '../constants';
import {
  getMusicMapRecords,
  getOrCreateAppUserId,
} from '../services/firebaseService';
import {
  getTrendingMusicMapTracks,
  hydrateMusicMapTrackColors,
  importSpotifyPlaylistTracks,
  loadMusicMapTrackPlaylists,
  loadSelectedMusicMapTrackPlaylistId,
  MAX_TRACK_PLAYLIST_ITEMS,
  saveMusicMapTrackPlaylists,
  saveSelectedMusicMapTrackPlaylistId,
  searchMusicMapTracks,
} from '../services/musicMapPlaylistService';
import { MUSIC_MAP_RECORDING_MODES } from '../services/musicMapRecordingService';
import { buildListeningContext, recordListeningEvent } from '../services/listeningHistoryService';

const UI = {
  bg: '#05070A',
  panel: 'rgba(24, 20, 19, 0.92)',
  panelSoft: 'rgba(255, 201, 184, 0.08)',
  border: 'rgba(255, 201, 184, 0.22)',
  borderStrong: 'rgba(255, 201, 184, 0.48)',
  text: '#FFF1EC',
  textSoft: '#D9C6C0',
  textMuted: '#9E908D',
  peach: '#FFC8B8',
  green: '#6EE89A',
};

function getSpotifyPlaybackMessage(error, fallback = 'Spotify 재생 요청에 실패했습니다.') {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('forbidden') || message.includes('403')) {
    return 'Spotify에서 현재 재생 요청을 허용하지 않았습니다. 앱은 계속 사용할 수 있으며 잠시 후 다시 시도해주세요.';
  }
  return error?.message || fallback;
}

const PERIOD_FILTERS = [
  { key: 'today', label: '하루' },
  { key: 'week', label: '일주일' },
  { key: 'date', label: '기간 선택' },
];
const MEANINGFUL_ROUTE_DISTANCE_M = 5;
const LIVE_ROUTE_POINT_MIN_DISTANCE_M = 3;
const START_END_PIN_MIN_DISTANCE_M = 25;
const MAX_DISPLAY_ROUTE_POINTS = 360;
const DEFAULT_PLAYLIST_NAME = '트랙 플레이리스트';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toFiniteNumber(value) {
  if (isFiniteNumber(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
  }
  return null;
}

function getDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    return value.toDate();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAge(value) {
  const date = getDate(value);
  if (!date) return '기록됨';
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return '방금';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}분 전`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}시간 전`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}일 전`;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function startOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatDateLabel(date = new Date()) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function isRecordInPeriod(record, period, selectedDate) {
  const date = getDate(record.recordedAt || record.startedAt);
  if (!date) return false;

  const now = new Date();
  if (period === 'today') {
    return date >= startOfDay(now);
  }

  if (period === 'date') {
    const start = startOfDay(selectedDate);
    const end = addDays(start, 1);
    return date >= start && date < end;
  }

  return date.getTime() >= now.getTime() - (7 * 24 * 60 * 60 * 1000);
}

function getSessionElapsedMs(session = {}, nowMs = Date.now()) {
  if (!session.isActive) return 0;
  const startedAtMs = new Date(session.startedAt || 0).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return session.elapsedMs || 0;
  }
  return Math.max(0, nowMs - startedAtMs);
}

function recordTitle(record = {}) {
  return record.track?.title || record.title || 'Unknown Track';
}

function recordArtist(record = {}) {
  return record.track?.artist || record.artist || 'Unknown Artist';
}

function getRecordKey(record = {}) {
  return `${record.track?.id || record.track?.spotifyUri || recordTitle(record)}:${recordArtist(record)}`;
}

function getPointDistanceMeters(a, b) {
  if (!isFiniteNumber(a?.latitude) || !isFiniteNumber(a?.longitude) || !isFiniteNumber(b?.latitude) || !isFiniteNumber(b?.longitude)) {
    return Number.POSITIVE_INFINITY;
  }
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const deltaLat = (b.latitude - a.latitude) * Math.PI / 180;
  const deltaLon = (b.longitude - a.longitude) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getRouteDistanceMeters(points = []) {
  return points.reduce((total, point, index) => (
    index === 0 ? total : total + getPointDistanceMeters(points[index - 1], point)
  ), 0);
}

function normalizePoint(point, segmentIndex = 0) {
  if (!point || typeof point !== 'object') {
    return null;
  }
  const latitude = toFiniteNumber(point.latitude ?? point.lat);
  const longitude = toFiniteNumber(point.longitude ?? point.lon ?? point.lng);
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return {
    latitude,
    longitude,
    recordedAt: point.recordedAt || new Date().toISOString(),
    segmentIndex,
  };
}

function downsamplePoints(points = [], maxPoints = MAX_DISPLAY_ROUTE_POINTS) {
  if (points.length <= maxPoints) {
    return points;
  }
  const lastIndex = points.length - 1;
  const step = lastIndex / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)]).filter(Boolean);
}

function getRecordPoints(record = {}, segmentIndex = 0) {
  const routePoints = Array.isArray(record.routePoints)
    ? record.routePoints.map((point) => normalizePoint(point, point.segmentIndex ?? segmentIndex)).filter(Boolean)
    : [];
  if (routePoints.length > 0) {
    return routePoints;
  }
  const fallbackPoint = normalizePoint(record.location, segmentIndex);
  return fallbackPoint ? [fallbackPoint] : [];
}

function getTrackSummary(record = {}, albumColor = UI.peach) {
  const track = record.track || {};
  return {
    trackId: track.id || track.spotifyUri || track.uri || track.spotifyUrl || record.trackId || record.spotifyUri || record.uri || record.spotifyUrl || '',
    trackKey: record.trackKey || record.trackId || record.spotifyUri || record.uri || record.spotifyUrl || track.id || track.spotifyUri || track.uri || track.spotifyUrl || getRecordKey(record),
    trackName: record.trackName || track.title || record.title || 'Unknown Track',
    artistName: record.artistName || track.artist || record.artist || '',
    albumName: record.albumName || track.album || record.album || '',
    albumArtUrl: record.albumArtUrl || track.artworkUrl || '',
    albumColor: albumColor || record.albumColor || UI.peach,
  };
}

function getTrackDedupeKey(record = {}) {
  const summary = getTrackSummary(record);
  if (summary.trackId) return `id:${summary.trackId}`;
  if (summary.trackKey) return `key:${summary.trackKey}`;
  return `text:${summary.trackName}:${summary.artistName}`.toLowerCase();
}

function dedupeDisplayTracks(records = []) {
  const seen = new Set();
  const tracks = [];

  records.forEach((record, index) => {
    const summary = getTrackSummary(record, record.albumColor || UI.peach);
    const dedupeKey = getTrackDedupeKey(record);
    const existing = tracks.find((item) => item.dedupeKey === dedupeKey);
    if (existing) {
      existing.playedDurationMs += record.playedDurationMs || 0;
      return;
    }
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    tracks.push({
      key: `${summary.trackId || summary.trackKey || record.id || summary.trackName}-${index}`,
      dedupeKey,
      title: summary.trackName,
      artist: summary.artistName || 'Unknown Artist',
      artworkUrl: summary.albumArtUrl,
      albumColor: summary.albumColor,
      playedDurationMs: record.playedDurationMs || 0,
      recordedAt: record.recordedAt,
      record,
    });
  });

  return tracks;
}

function getRouteSegmentColor(segments = [], position = 'last') {
  const validSegments = Array.isArray(segments)
    ? segments.filter((segment) => segment?.albumColor)
    : [];
  if (validSegments.length === 0) return '';
  return position === 'first'
    ? validSegments[0].albumColor
    : validSegments[validSegments.length - 1].albumColor;
}

function getRouteSegmentAlbumArtUrl(segments = [], position = 'last') {
  const validSegments = Array.isArray(segments)
    ? segments.filter((segment) => segment?.albumArtUrl)
    : [];
  if (validSegments.length === 0) return '';
  return position === 'first'
    ? validSegments[0].albumArtUrl
    : validSegments[validSegments.length - 1].albumArtUrl;
}

function buildRouteSegmentsFromRecords(sortedRecords = []) {
  const routePoints = [];
  const routeSegments = [];

  sortedRecords.forEach((record, recordIndex) => {
    const segmentPoints = getRecordPoints(record, recordIndex);
    if (segmentPoints.length === 0) return;

    const startIndex = routePoints.length;
    routePoints.push(...segmentPoints);
    const endIndex = Math.max(startIndex, routePoints.length - 1);
    const storedSegment = Array.isArray(record.routeSegments) ? record.routeSegments[0] : null;
    const albumColor = storedSegment?.albumColor || record.albumColor || UI.peach;

    routeSegments.push({
      id: storedSegment?.id || `${record.id || getRecordKey(record)}-segment-${recordIndex}`,
      ...getTrackSummary({ ...record, ...storedSegment }, albumColor),
      startIndex,
      endIndex,
      startedAt: storedSegment?.startedAt || record.startedAt || record.recordedAt,
      endedAt: storedSegment?.endedAt || record.recordedAt || record.startedAt,
      routePoints: downsamplePoints(segmentPoints.map((point) => normalizePoint(point, recordIndex)).filter(Boolean), 120),
    });
  });

  return {
    routePoints,
    routeSegments,
  };
}

function buildRouteSegmentsFromSession(session = {}, routePoints = []) {
  const sessionSegments = Array.isArray(session.routeSegments) ? session.routeSegments : [];
  if (sessionSegments.length > 0) {
    return sessionSegments.map((segment, index) => {
      const startIndex = Math.max(0, Number.isInteger(segment.startIndex) ? segment.startIndex : 0);
      const endIndex = Math.max(startIndex, Number.isInteger(segment.endIndex) ? segment.endIndex : routePoints.length - 1);
      const segmentPoints = routePoints.slice(startIndex, endIndex + 1);
      if (segmentPoints.length === 0) return null;
      const albumColor = segment.albumColor || UI.peach;
      return {
        id: segment.id || `live-segment-${index}`,
        ...getTrackSummary(segment, albumColor),
        startIndex,
        endIndex,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        routePoints: downsamplePoints(segmentPoints, 120),
      };
    }).filter(Boolean);
  }

  const currentSegment = session.currentSegment || {};
  if (routePoints.length === 0) return [];
  const albumColor = currentSegment.albumColor || UI.peach;
  return [{
    id: currentSegment.id || 'live-segment',
    ...getTrackSummary(currentSegment, albumColor),
    startIndex: 0,
    endIndex: Math.max(0, routePoints.length - 1),
    startedAt: currentSegment.startedAt || session.startedAt,
    endedAt: currentSegment.lastUpdatedAt || session.lastUpdatedAt,
    routePoints: downsamplePoints(routePoints, 120),
  }];
}

function getAveragePoint(points = []) {
  if (points.length === 0) return null;
  const total = points.reduce((next, point) => ({
    latitude: next.latitude + point.latitude,
    longitude: next.longitude + point.longitude,
  }), { latitude: 0, longitude: 0 });
  return {
    latitude: total.latitude / points.length,
    longitude: total.longitude / points.length,
  };
}

function sortRecordsAscending(records = []) {
  return [...records].sort((left, right) => {
    const leftDate = getDate(left.startedAt || left.recordedAt)?.getTime() || 0;
    const rightDate = getDate(right.startedAt || right.recordedAt)?.getTime() || 0;
    return leftDate - rightDate;
  });
}

function getExplicitSessionHint(record = {}) {
  const cleanHint = (value) => {
    if (value === undefined || value === null || value === '') {
      return '';
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
    const date = getDate(value);
    if (date) {
      return date.toISOString();
    }
    return '';
  };

  const sessionId = cleanHint(record.sessionId);
  if (sessionId) return `sessionId:${sessionId}`;
  const trackingId = cleanHint(record.trackingId);
  if (trackingId) return `trackingId:${trackingId}`;
  const batchId = cleanHint(record.batchId);
  if (batchId) return `batchId:${batchId}`;
  const recordingStartedAt = cleanHint(record.recordingStartedAt);
  if (recordingStartedAt) return `recordingStartedAt:${recordingStartedAt}`;
  const sessionStartedAt = cleanHint(record.sessionStartedAt);
  if (sessionStartedAt) return `sessionStartedAt:${sessionStartedAt}`;
  const startedAt = cleanHint(record.startedAt);
  if (startedAt) return `startedAt:${startedAt}`;
  return '';
}

function buildSessionDisplayRecord(sessionRecords = [], fallbackIndex = 0) {
  const sorted = sortRecordsAscending(sessionRecords);
  if (sorted.length === 0) {
    return null;
  }
  const builtRoute = buildRouteSegmentsFromRecords(sorted);
  const routePoints = downsamplePoints(builtRoute.routePoints);
  const routeSegments = builtRoute.routeSegments;
  const routeDistance = getRouteDistanceMeters(routePoints);
  const first = sorted[0] || {};
  const last = sorted[sorted.length - 1] || first;
  const sessionId = first.sessionId || `fallback-${fallbackIndex}-${first.id || getDate(first.startedAt || first.recordedAt)?.getTime() || 'record'}`;
  const isTrack = routePoints.length >= 2 && routeDistance >= MEANINGFUL_ROUTE_DISTANCE_M;
  const startLocation = routePoints[0] || normalizePoint(first.location) || normalizePoint(last.location);
  const endLocation = routePoints[routePoints.length - 1] || normalizePoint(last.location) || normalizePoint(first.location);
  const shouldMergeEndpointPins = startLocation && endLocation
    ? getPointDistanceMeters(startLocation, endLocation) < START_END_PIN_MIN_DISTANCE_M
    : true;
  const pinLocation = isTrack
    ? routePoints[routePoints.length - 1]
    : getAveragePoint(routePoints) || normalizePoint(first.location) || normalizePoint(last.location);
  if (!pinLocation) {
    return null;
  }
  const trackChangeMarkers = sorted.slice(1).map((record, index) => {
    const point = getRecordPoints(record, index + 1)[0];
    const previousRecord = sorted[index];
    if (previousRecord && getTrackDedupeKey(previousRecord) === getTrackDedupeKey(record)) {
      return null;
    }
    if (!point) return null;
    return {
      id: `${record.id || getRecordKey(record)}-change-${index}`,
      location: point,
      albumColor: record.albumColor || UI.peach,
      fromTrackKey: previousRecord ? getTrackSummary(previousRecord).trackKey : '',
      toTrackKey: getTrackSummary(record).trackKey,
      ...getTrackSummary(record, record.albumColor || UI.peach),
      recordedAt: record.startedAt || record.recordedAt,
    };
  }).filter(Boolean);
  const tracks = dedupeDisplayTracks(sorted);
  const startAlbumColor = getRouteSegmentColor(routeSegments, 'first') || first.albumColor || UI.peach;
  const endAlbumColor = getRouteSegmentColor(routeSegments, 'last') || last.albumColor || first.albumColor || UI.peach;
  const startAlbumArtUrl = getRouteSegmentAlbumArtUrl(routeSegments, 'first') || first.track?.artworkUrl || first.albumArtUrl || '';
  const endAlbumArtUrl = getRouteSegmentAlbumArtUrl(routeSegments, 'last') || last.track?.artworkUrl || last.albumArtUrl || startAlbumArtUrl;

  return {
    id: `session:${sessionId}`,
    sessionId,
    recordType: isTrack ? 'track' : 'pin',
    albumColor: isTrack ? startAlbumColor : endAlbumColor,
    startAlbumColor,
    endAlbumColor,
    startAlbumArtUrl,
    endAlbumArtUrl,
    albumArtUrl: isTrack ? startAlbumArtUrl : endAlbumArtUrl,
    placeName: first.placeName || last.placeName || '내 음악 위치',
    location: pinLocation,
    routePoints: isTrack ? routePoints : [],
    routeSegments: isTrack ? routeSegments : [],
    startLocation: startLocation || pinLocation,
    endLocation: shouldMergeEndpointPins ? null : endLocation,
    endpointPinsMerged: shouldMergeEndpointPins,
    trackChangeMarkers,
    routeDistance,
    playedDurationMs: sorted.reduce((total, record) => total + (record.playedDurationMs || 0), 0),
    startedAt: first.startedAt || first.recordedAt,
    recordedAt: last.recordedAt || last.startedAt,
    track: first.track,
    tracks,
    records: sorted,
  };
}

function buildMusicMapSessionRecords(records = []) {
  const grouped = new Map();
  const individualRecords = [];

  records.forEach((record) => {
    const explicitHint = getExplicitSessionHint(record);
    if (explicitHint) {
      const key = `hint:${explicitHint}`;
      grouped.set(key, [...(grouped.get(key) || []), record]);
    } else {
      individualRecords.push(record);
    }
  });

  return [
    ...Array.from(grouped.values()).map((items, index) => buildSessionDisplayRecord(items, index)),
    ...individualRecords.map((record, index) => buildSessionDisplayRecord([record], index)),
  ].filter(Boolean).sort((left, right) => {
    const leftDate = getDate(left.recordedAt || left.startedAt)?.getTime() || 0;
    const rightDate = getDate(right.recordedAt || right.startedAt)?.getTime() || 0;
    return rightDate - leftDate;
  });
}

function buildLiveMusicMapRecord({ session = {}, location, currentTrack }) {
  if (!session?.isActive && !location) {
    return null;
  }

  const currentSegment = session.currentSegment || {};
  const segmentTrack = currentSegment.track || null;
  const track = segmentTrack || currentTrack || {
    title: '기록 중',
    artist: 'NOWHERE',
  };
  const sessionRoutePoints = Array.isArray(session.routePoints) ? session.routePoints : [];
  const baseRoutePoints = sessionRoutePoints.length > 0
    ? sessionRoutePoints.map((point) => normalizePoint(point, point.segmentIndex ?? 0)).filter(Boolean)
    : Array.isArray(currentSegment.routePoints)
      ? currentSegment.routePoints.map((point) => normalizePoint(point, point.segmentIndex ?? 0)).filter(Boolean)
      : [];
  const currentPoint = normalizePoint(location, baseRoutePoints[baseRoutePoints.length - 1]?.segmentIndex || 0);
  let routePoints = baseRoutePoints;

  if (currentPoint) {
    const lastPoint = routePoints[routePoints.length - 1];
    if (!lastPoint || getPointDistanceMeters(lastPoint, currentPoint) >= LIVE_ROUTE_POINT_MIN_DISTANCE_M) {
      routePoints = [...routePoints, currentPoint];
    }
  }

  const routeSegments = buildRouteSegmentsFromSession(session, routePoints);
  routePoints = downsamplePoints(routePoints);
  const displayLocation = currentPoint || routePoints[routePoints.length - 1] || normalizePoint(session.startLocation, 0);
  if (!displayLocation) {
    return null;
  }
  if (routePoints.length === 0) {
    routePoints = [displayLocation];
  }

  const routeDistance = getRouteDistanceMeters(routePoints);
  const startLocation = routePoints[0] || displayLocation;
  const startAlbumColor = getRouteSegmentColor(routeSegments, 'first') || currentSegment.albumColor || track.color || UI.green;
  const endAlbumColor = getRouteSegmentColor(routeSegments, 'last') || currentSegment.albumColor || track.color || UI.green;
  const startAlbumArtUrl = getRouteSegmentAlbumArtUrl(routeSegments, 'first') || currentSegment.albumArtUrl || track.artworkUrl || '';
  const endAlbumArtUrl = getRouteSegmentAlbumArtUrl(routeSegments, 'last') || track.artworkUrl || currentSegment.albumArtUrl || startAlbumArtUrl;

  return {
    id: 'live:music-map-recording',
    sessionId: session.id || 'live',
    isLive: true,
    recordType: 'track',
    albumColor: endAlbumColor,
    startAlbumColor,
    endAlbumColor,
    startAlbumArtUrl,
    endAlbumArtUrl,
    albumArtUrl: endAlbumArtUrl,
    placeName: currentSegment.placeName || session.placeName || '현재 위치',
    location: startLocation,
    currentLocation: displayLocation,
    routePoints,
    routeSegments,
    startLocation,
    endLocation: null,
    endpointPinsMerged: true,
    trackChangeMarkers: Array.isArray(session.trackChangeMarkers)
      ? session.trackChangeMarkers
        .map((marker, index) => ({
          id: marker.id || `live-change-${index}`,
          location: normalizePoint(marker.location || marker.point, marker.segmentIndex ?? 0),
          albumColor: marker.albumColor || UI.peach,
          fromTrackKey: marker.fromTrackKey || '',
          toTrackKey: marker.toTrackKey || marker.trackKey || '',
          ...getTrackSummary(marker, marker.albumColor || UI.peach),
          recordedAt: marker.recordedAt,
        }))
        .filter((marker) => marker.location)
      : [],
    routeDistance,
    playedDurationMs: getSessionElapsedMs(session),
    startedAt: session.startedAt,
    recordedAt: currentSegment.lastUpdatedAt || session.lastUpdatedAt || new Date().toISOString(),
    track,
    tracks: [],
    records: [],
  };
}

function getCenterFromRecords(records = [], fallback) {
  const record = records.find((item) => (
    typeof item.location?.latitude === 'number' &&
    typeof item.location?.longitude === 'number'
  ));
  if (record) {
    return {
      latitude: record.location.latitude,
      longitude: record.location.longitude,
    };
  }
  return fallback || { latitude: 37.5665, longitude: 126.978 };
}

function buildTopTracks(records = []) {
  const map = new Map();
  records.forEach((record) => {
    const key = getRecordKey(record);
    const existing = map.get(key);
    if (existing) {
      existing.plays += 1;
      return;
    }
    map.set(key, {
      key,
      title: recordTitle(record),
      artist: recordArtist(record),
      plays: 1,
    });
  });

  return Array.from(map.values())
    .sort((left, right) => right.plays - left.plays)
    .slice(0, 3);
}

function AlbumThumb({ uri, color, size = 56 }) {
  if (uri) {
    return <Image source={{ uri }} style={[styles.albumThumb, { width: size, height: size, borderRadius: 14 }]} />;
  }
  return (
    <View style={[styles.albumFallback, { width: size, height: size, borderRadius: 14, backgroundColor: `${color || UI.peach}55` }]} />
  );
}

function getPlaylistItemKey(track = {}) {
  return String(track.spotifyUri || track.uri || track.spotifyUrl || track.id || `${track.title || ''}:${track.artist || ''}`).toLowerCase();
}

function hasSpotifyTrackUrl(track = {}) {
  const uri = String(track.spotifyUri || track.uri || track.spotifyUrl || '').trim();
  return uri.startsWith('spotify:') || uri.startsWith('https://open.spotify.com/');
}

function createEmptyTrackPlaylist(index = 0) {
  const now = new Date().toISOString();
  return {
    id: `music-map-playlist-${Date.now()}-${index}`,
    name: `${DEFAULT_PLAYLIST_NAME} ${index + 1}`,
    tracks: [],
    createdAt: now,
    updatedAt: now,
  };
}

export default function MusicMapScreen({ navigation }) {
  const player = useContext(PlayerContext);
  const locationContext = useContext(LocationContext);
  const { authUser } = useSession();
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRecordingBusy, setIsRecordingBusy] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [error, setError] = useState('');
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [periodFilter, setPeriodFilter] = useState('today');
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [recordingUiPhase, setRecordingUiPhase] = useState('idle');
  const [activeTab, setActiveTab] = useState('map');
  const [recordingMode, setRecordingMode] = useState(MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL);
  const [savedPlaylists, setSavedPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [trackQuery, setTrackQuery] = useState('');
  const [trackResults, setTrackResults] = useState([]);
  const [spotifyPlaylistUrl, setSpotifyPlaylistUrl] = useState('');
  const [trendingTracks, setTrendingTracks] = useState([]);
  const [isSearchingTracks, setIsSearchingTracks] = useState(false);
  const [isImportingSpotifyPlaylist, setIsImportingSpotifyPlaylist] = useState(false);
  const [isLoadingTrendingTracks, setIsLoadingTrendingTracks] = useState(false);
  const loadRecordsInFlightRef = useRef(null);
  const startActionInFlightRef = useRef(false);
  const stopActionInFlightRef = useRef(false);
  const recordingStartedAtRef = useRef(null);

  const refreshMusicMapRecording = locationContext?.refreshMusicMapRecording;
  const refreshLocation = locationContext?.refreshLocation;
  const requestLocationPermissions = locationContext?.requestPermissions;
  const startMusicMapRecording = locationContext?.startMusicMapRecording;
  const stopMusicMapRecording = locationContext?.stopMusicMapRecording;
  const currentTrack = player?.currentTrack;
  const playerState = player?.playerState || {};
  const location = locationContext?.location || locationContext?.lastKnownLocation;
  const weather = locationContext?.weather;
  const currentPlaceName = locationContext?.placeName || '';
  const musicMapRecording = locationContext?.musicMapRecording || {};
  const isRecording = Boolean(musicMapRecording.isActive);
  const effectiveIsRecording = isRecording || recordingUiPhase === 'starting' || recordingUiPhase === 'recording';
  const recordingRemainingMs = Math.max(0, (musicMapRecording.maxDurationMs || 60 * 60 * 1000) - recordingElapsedMs);
  const showStartSpinner = isRecordingBusy && !effectiveIsRecording;
  const selectedPlaylist = useMemo(
    () => savedPlaylists.find((playlist) => playlist.id === selectedPlaylistId) || savedPlaylists[0] || null,
    [savedPlaylists, selectedPlaylistId]
  );
  const trackPlaylist = selectedPlaylist?.tracks || [];
  const canUseSpotifyNowPlaying = Boolean(
    playerState.isAuthorized ||
    playerState.authorizationStatus === 'authorized'
  );
  const activeRecordingMode = musicMapRecording.recordingMode || recordingMode;
  const isSequentialUrlMode = recordingMode === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL;
  const currentRecordingTrack = musicMapRecording.currentSegment?.track || currentTrack || null;
  const currentTrackIndex = useMemo(() => {
    if (!currentRecordingTrack || !trackPlaylist.length) return -1;
    const currentKey = getPlaylistItemKey(currentRecordingTrack);
    return trackPlaylist.findIndex((track) => getPlaylistItemKey(track) === currentKey);
  }, [currentRecordingTrack, trackPlaylist]);
  const nextRecordingTrack = currentTrackIndex >= 0
    ? trackPlaylist[currentTrackIndex + 1] || null
    : trackPlaylist[0] || null;

  const loadRecords = useCallback(async ({ refreshing = false, force = false } = {}) => {
    if (loadRecordsInFlightRef.current && !force) {
      return loadRecordsInFlightRef.current;
    }

    if (refreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError('');

    const request = (async () => {
      const nextRecords = await getMusicMapRecords(
        authUser?.uid && !authUser.isAnonymous ? authUser.uid : await getOrCreateAppUserId(),
        240
      );
      setRecords(nextRecords);
      return nextRecords;
    })();

    loadRecordsInFlightRef.current = request;

    try {
      return await request;
    } catch (nextError) {
      setError(nextError.message || '뮤직지도 기록을 불러오지 못했습니다.');
      return [];
    } finally {
      loadRecordsInFlightRef.current = null;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [authUser?.isAnonymous, authUser?.uid]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!isSequentialUrlMode && activeTab === 'playlist') {
      setActiveTab('map');
    }
  }, [activeTab, isSequentialUrlMode]);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      loadMusicMapTrackPlaylists(),
      loadSelectedMusicMapTrackPlaylistId(),
    ])
      .then(([playlists, selectedId]) => {
        if (!isMounted) return;
        const nextPlaylists = playlists;
        setSavedPlaylists(nextPlaylists);
        const nextSelectedId = nextPlaylists.some((playlist) => playlist.id === selectedId)
          ? selectedId
          : nextPlaylists[0]?.id || '';
        setSelectedPlaylistId(nextSelectedId);
        if (nextSelectedId) {
          saveSelectedMusicMapTrackPlaylistId(nextSelectedId).catch(() => null);
        }
      })
      .catch(() => null);
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    setIsLoadingTrendingTracks(true);
    getTrendingMusicMapTracks(8)
      .then((tracks) => {
        if (isMounted) setTrendingTracks(tracks);
      })
      .catch(() => null)
      .finally(() => {
        if (isMounted) setIsLoadingTrendingTracks(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener?.('focus', () => {
      refreshMusicMapRecording?.();
      loadRecords({ refreshing: true });
    });
    return unsubscribe;
  }, [loadRecords, navigation, refreshMusicMapRecording]);

  useEffect(() => {
    if (!effectiveIsRecording) {
      recordingStartedAtRef.current = null;
      if (!isRecordingBusy && recordingUiPhase !== 'idle') {
        setRecordingUiPhase('idle');
      }
      setRecordingElapsedMs(0);
      return undefined;
    }

    const maxDurationMs = musicMapRecording.maxDurationMs || 60 * 60 * 1000;
    if (!recordingStartedAtRef.current) {
      const sessionStartedAt = new Date(musicMapRecording.startedAt || 0).getTime();
      recordingStartedAtRef.current = Number.isFinite(sessionStartedAt) && sessionStartedAt > 0
        ? sessionStartedAt
        : Date.now();
    }

    const updateElapsed = () => {
      setRecordingElapsedMs(Math.min(Math.max(0, Date.now() - recordingStartedAtRef.current), maxDurationMs));
    };

    updateElapsed();
    const intervalId = setInterval(() => {
      updateElapsed();
    }, 1000);
    return () => clearInterval(intervalId);
  }, [effectiveIsRecording, isRecordingBusy, musicMapRecording.maxDurationMs, musicMapRecording.startedAt, recordingUiPhase]);

  const visibleRecords = useMemo(
    () => records
      .filter((record) => record.recordType === 'track')
      .filter((record) => isRecordInPeriod(record, periodFilter, selectedDate)),
    [periodFilter, records, selectedDate]
  );

  const sessionRecords = useMemo(
    () => buildMusicMapSessionRecords(visibleRecords),
    [visibleRecords]
  );

  const liveRecord = useMemo(
    () => buildLiveMusicMapRecord({
      session: musicMapRecording,
      location,
      currentTrack,
    }),
    [
      currentTrack?.artist,
      currentTrack?.artworkUrl,
      currentTrack?.color,
      currentTrack?.id,
      currentTrack?.spotifyUri,
      currentTrack?.title,
      currentTrack?.uri,
      location,
      musicMapRecording,
    ]
  );

  const mapRecords = useMemo(
    () => (effectiveIsRecording && liveRecord ? [liveRecord] : sessionRecords),
    [effectiveIsRecording, liveRecord, sessionRecords]
  );
  const recordingDistanceM = liveRecord?.routeDistance || 0;

  useEffect(() => {
    if (effectiveIsRecording) {
      setSelectedRecordId('');
      return;
    }

    if (!sessionRecords.length) {
      setSelectedRecordId('');
      return;
    }

    if (selectedRecordId && !sessionRecords.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId('');
    }
  }, [effectiveIsRecording, selectedRecordId, sessionRecords]);

  const selectedRecord = useMemo(
    () => mapRecords.find((record) => record.id === selectedRecordId) || null,
    [mapRecords, selectedRecordId]
  );

  const topTracks = useMemo(() => buildTopTracks(selectedRecord?.records || []), [selectedRecord]);
  const mapCenter = useMemo(() => getCenterFromRecords(mapRecords, location), [location, mapRecords]);

  const persistPlaylists = useCallback(async (playlists, nextSelectedId = selectedPlaylistId) => {
    const saved = await saveMusicMapTrackPlaylists(playlists);
    const resolvedSelectedId = saved.some((playlist) => playlist.id === nextSelectedId)
      ? nextSelectedId
      : saved[0]?.id || '';
    setSavedPlaylists(saved);
    setSelectedPlaylistId(resolvedSelectedId);
    await saveSelectedMusicMapTrackPlaylistId(resolvedSelectedId);
    return saved;
  }, [selectedPlaylistId]);

  const persistTrackPlaylist = useCallback(async (tracks) => {
    const targetPlaylist = selectedPlaylist || savedPlaylists[0] || createEmptyTrackPlaylist(0);
    const hydratedTracks = await hydrateMusicMapTrackColors(tracks);
    const now = new Date().toISOString();
    const nextPlaylist = {
      ...targetPlaylist,
      tracks: hydratedTracks,
      updatedAt: now,
    };
    const nextPlaylists = savedPlaylists.some((playlist) => playlist.id === targetPlaylist.id)
      ? savedPlaylists.map((playlist) => (playlist.id === targetPlaylist.id ? nextPlaylist : playlist))
      : [nextPlaylist, ...savedPlaylists];
    await persistPlaylists(nextPlaylists, nextPlaylist.id);
    return hydratedTracks;
  }, [persistPlaylists, savedPlaylists, selectedPlaylist]);

  const handleSearchTracks = useCallback(async () => {
    const query = trackQuery.trim();
    if (query.length < 2) {
      Alert.alert('검색어 필요', '곡 제목이나 아티스트명을 2글자 이상 입력해주세요.');
      return;
    }
    setIsSearchingTracks(true);
    try {
      const results = await searchMusicMapTracks(query, 10);
      setTrackResults(results);
      if (!results.length) {
        Alert.alert('검색 결과 없음', '앨범 이미지가 있는 곡을 찾지 못했습니다.');
      }
    } catch (nextError) {
      setError(nextError.message || '곡 검색에 실패했습니다.');
    } finally {
      setIsSearchingTracks(false);
    }
  }, [trackQuery]);

  const handleImportSpotifyPlaylist = useCallback(async () => {
    const input = spotifyPlaylistUrl.trim();
    if (!input) {
      Alert.alert('링크 필요', 'Spotify 플레이리스트 링크를 붙여넣어주세요.');
      return;
    }
    if (effectiveIsRecording) {
      Alert.alert('기록 중 가져오기 불가', '기록 중에는 플레이리스트를 수정할 수 없습니다.');
      return;
    }

    setIsImportingSpotifyPlaylist(true);
    try {
      const imported = await importSpotifyPlaylistTracks(input, MAX_TRACK_PLAYLIST_ITEMS);
      const now = new Date().toISOString();
      const nextPlaylist = {
        id: `${imported.id}-${Date.now()}`,
        name: imported.name || `Spotify 플레이리스트 ${savedPlaylists.length + 1}`,
        spotifyUri: imported.spotifyUri,
        sourceType: 'spotify-playlist',
        tracks: await hydrateMusicMapTrackColors(imported.tracks),
        createdAt: now,
        updatedAt: now,
      };
      await persistPlaylists([nextPlaylist, ...savedPlaylists], nextPlaylist.id);
      setSpotifyPlaylistUrl('');
      Alert.alert(
        '가져오기 완료',
        '가져온 곡은 NOWHERE 내부 플레이리스트에 저장됩니다. 일반 모드는 곡마다 Spotify URL을 순서대로 엽니다.'
      );
    } catch (nextError) {
      Alert.alert('가져오기 실패', nextError.message || 'Spotify 플레이리스트를 가져오지 못했습니다.');
    } finally {
      setIsImportingSpotifyPlaylist(false);
    }
  }, [effectiveIsRecording, persistPlaylists, savedPlaylists, spotifyPlaylistUrl]);

  const handleAddPlaylistTrack = useCallback(async (track) => {
    if (effectiveIsRecording) {
      Alert.alert('기록 중 수정 불가', '기록 중에는 트랙 플레이리스트를 수정할 수 없습니다.');
      return;
    }
    if (!selectedPlaylist?.id) {
      Alert.alert('플레이리스트를 먼저 만들어주세요', '새로 만들기를 누른 뒤 이름을 정하고 곡을 추가해주세요.');
      return;
    }
    if (trackPlaylist.length >= MAX_TRACK_PLAYLIST_ITEMS) {
      Alert.alert('최대 10곡', '뮤직지도 트랙 플레이리스트는 최대 10곡까지 설정할 수 있습니다.');
      return;
    }
    const key = getPlaylistItemKey(track);
    if (trackPlaylist.some((item) => getPlaylistItemKey(item) === key)) {
      return;
    }
    await persistTrackPlaylist([...trackPlaylist, track]);
  }, [effectiveIsRecording, persistTrackPlaylist, selectedPlaylist?.id, trackPlaylist]);

  const handleRemovePlaylistTrack = useCallback(async (index) => {
    if (effectiveIsRecording) return;
    await persistTrackPlaylist(trackPlaylist.filter((_, itemIndex) => itemIndex !== index));
  }, [effectiveIsRecording, persistTrackPlaylist, trackPlaylist]);

  const handleMovePlaylistTrack = useCallback(async (index, direction) => {
    if (effectiveIsRecording) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= trackPlaylist.length) return;
    const nextTracks = [...trackPlaylist];
    const [item] = nextTracks.splice(index, 1);
    nextTracks.splice(nextIndex, 0, item);
    await persistTrackPlaylist(nextTracks);
  }, [effectiveIsRecording, persistTrackPlaylist, trackPlaylist]);

  const handleSelectPlaylist = useCallback(async (playlistId) => {
    if (effectiveIsRecording) return;
    setSelectedPlaylistId(playlistId);
    await saveSelectedMusicMapTrackPlaylistId(playlistId);
  }, [effectiveIsRecording]);

  const handleCreatePlaylist = useCallback(async () => {
    if (effectiveIsRecording) {
      Alert.alert('기록 중 생성 불가', '기록 중에는 트랙 플레이리스트를 새로 만들 수 없습니다.');
      return;
    }
    const nextPlaylist = createEmptyTrackPlaylist(savedPlaylists.length);
    await persistPlaylists([...savedPlaylists, nextPlaylist], nextPlaylist.id);
    setTrackResults([]);
    setTrackQuery('');
    setActiveTab('playlist');
  }, [effectiveIsRecording, persistPlaylists, savedPlaylists]);

  const handleDeletePlaylist = useCallback(async (playlistId) => {
    if (effectiveIsRecording || savedPlaylists.length <= 1) return;
    const nextPlaylists = savedPlaylists.filter((playlist) => playlist.id !== playlistId);
    await persistPlaylists(nextPlaylists, nextPlaylists[0]?.id || '');
  }, [effectiveIsRecording, persistPlaylists, savedPlaylists]);

  const handleRenamePlaylist = useCallback((name) => {
    if (effectiveIsRecording || !selectedPlaylist?.id) return;
    const nextName = String(name || '').slice(0, 32);
    const now = new Date().toISOString();
    const nextPlaylists = savedPlaylists.map((playlist) => (
      playlist.id === selectedPlaylist.id
        ? { ...playlist, name: nextName, updatedAt: now }
        : playlist
    ));
    setSavedPlaylists(nextPlaylists);
    saveMusicMapTrackPlaylists(nextPlaylists).catch(() => null);
  }, [effectiveIsRecording, savedPlaylists, selectedPlaylist?.id]);

  const finalizeRecording = useCallback(async () => {
    if (stopActionInFlightRef.current) {
      return;
    }
    stopActionInFlightRef.current = true;
    recordingStartedAtRef.current = null;
    setRecordingElapsedMs(0);
    setRecordingUiPhase('idle');
    try {
      const stopped = await stopMusicMapRecording?.();
      if (stopped?.savedRecord) {
        setRecords((previousRecords) => [
          stopped.savedRecord,
          ...previousRecords.filter((record) => record.id !== stopped.savedRecord.id),
        ]);
        setSelectedRecordId(`session:${stopped.savedRecord.sessionId || stopped.savedRecord.id}`);
      }
      await loadRecords({ refreshing: true, force: true });
    } catch (nextError) {
      const message = nextError.message || '뮤직지도 기록 중단에 실패했습니다.';
      setError(message);
    } finally {
      stopActionInFlightRef.current = false;
      setIsRecordingBusy(false);
    }
  }, [loadRecords, stopMusicMapRecording]);

  const handleToggleRecording = useCallback(async () => {
    setError('');

    if (effectiveIsRecording) {
      await finalizeRecording();
      return;
    }

    if (startActionInFlightRef.current) {
      return;
    }

    const modeToStart = recordingMode;

    if (modeToStart === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING && !canUseSpotifyNowPlaying) {
      Alert.alert(
        '고급모드 계정 필요',
        '등록된 Spotify 계정에서는 현재 재생곡 기반 고급모드 기록을 사용할 수 있어요.'
      );
      return;
    }

    if (modeToStart === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL && trackPlaylist.length === 0) {
      Alert.alert(
        '플레이리스트 설정 필요',
        '플레이리스트에 곡을 먼저 추가해주세요.'
      );
      return;
    }

    if (modeToStart === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL && !hasSpotifyTrackUrl(trackPlaylist[0])) {
      Alert.alert('Spotify 곡 필요', 'Spotify에서 열 수 있는 곡을 추가해주세요.');
      return;
    }

    startActionInFlightRef.current = true;
    setIsRecordingBusy(true);
    let didStartRecording = false;
    try {
      const needsBackgroundPermission = modeToStart === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING;
      const hasLocationPermission = needsBackgroundPermission
        ? Boolean(locationContext?.hasForegroundPermission && locationContext?.hasBackgroundPermission)
        : Boolean(locationContext?.hasForegroundPermission);
      if (!hasLocationPermission) {
        const permissions = await requestLocationPermissions?.();
        if (!permissions?.hasForegroundPermission || (needsBackgroundPermission && !permissions?.hasBackgroundPermission)) {
          Alert.alert(
            '위치 권한 필요',
            needsBackgroundPermission
              ? '현재 재생곡 기반 기록을 사용하려면 위치 권한을 항상 허용으로 켜주세요.'
              : '뮤직지도 기록을 사용하려면 위치 권한을 허용해주세요.'
          );
          return;
        }
      }
      const startLocation = location;

      recordingStartedAtRef.current = Date.now();
      setRecordingElapsedMs(0);
      setRecordingUiPhase('recording');
      await startMusicMapRecording?.({
        trackPlaylist,
        playlist: selectedPlaylist,
        recordingMode: modeToStart,
      });
      didStartRecording = true;
      if (!startLocation) {
        refreshLocation?.({ forceWeather: false }).catch(() => null);
      }
      const recordingContext = buildListeningContext({
        location: startLocation || location,
        weather,
        place: currentPlaceName ? { name: currentPlaceName } : null,
      });
      if (modeToStart === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL && trackPlaylist[0]) {
        recordListeningEvent({
          userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
          track: trackPlaylist[0],
          source: 'music-map',
          recommendationSlot: 'music-map-sequential-url',
          context: recordingContext,
        }).catch(() => { });
      }
    } catch (nextError) {
      if (didStartRecording) {
        await stopMusicMapRecording?.().catch(() => null);
      }
      if ((nextError.message || '').includes('취소')) {
        return;
      }
      setRecordingUiPhase('idle');
      recordingStartedAtRef.current = null;
      setRecordingElapsedMs(0);
      const message = nextError.message || '뮤직지도 기록 상태를 변경하지 못했습니다.';
      setError(message);
      Alert.alert(
        modeToStart === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING ? '고급모드 사용불가' : '뮤직지도 기록 실패',
        message
      );
    } finally {
      startActionInFlightRef.current = false;
      setIsRecordingBusy(false);
    }
  }, [
    effectiveIsRecording,
    authUser?.isAnonymous,
    authUser?.uid,
    canUseSpotifyNowPlaying,
    currentPlaceName,
    finalizeRecording,
    location,
    locationContext?.hasBackgroundPermission,
    locationContext?.hasForegroundPermission,
    requestLocationPermissions,
    refreshLocation,
    recordingMode,
    selectedPlaylist,
    startMusicMapRecording,
    stopMusicMapRecording,
    trackPlaylist,
    weather,
  ]);

  const handlePlayRecord = useCallback(async (record) => {
    if (!record?.track) return;
    const openTrack = player?.openInSpotify || player?.play;
    await openTrack?.(record.track, [record.track]).then(() => {
      recordListeningEvent({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        track: record.track,
        source: 'music-map-history',
        recommendationSlot: 'music-map-history',
        context: buildListeningContext({
          location,
          weather,
          place: currentPlaceName ? { name: currentPlaceName } : null,
        }),
      }).catch(() => { });
    }).catch((nextError) => {
      setError(getSpotifyPlaybackMessage(nextError));
    });
  }, [authUser?.isAnonymous, authUser?.uid, currentPlaceName, location, player, weather]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            tintColor={UI.peach}
            refreshing={isRefreshing}
            onRefresh={() => loadRecords({ refreshing: true })}
          />
        )}
      >
        <View style={styles.hero}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>뮤직지도</Text>
              {recordingMode === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL ? (
                <View style={styles.rulePill}>
                  <Ionicons name="information-circle-outline" size={16} color={UI.peach} />
                  <Text style={styles.ruleText}>
                    일반모드에서는 노래를 일시정지 or 다음곡으로 넘기지마세요.
                  </Text>
                </View>
              ) : null}
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-down-outline" size={21} color={UI.peach} />
            </TouchableOpacity>
          </View>

          {activeTab === 'map' || !isSequentialUrlMode ? (
            <>
              {!effectiveIsRecording ? (
                <View style={styles.recordModePanel}>
                  <View style={styles.modeSwitch}>
                    {[
                      { key: MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL, label: '일반 모드' },
                      { key: MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING, label: '고급모드' },
                    ].map((mode) => {
                      const isActive = recordingMode === mode.key;
                      return (
                        <TouchableOpacity
                          key={mode.key}
                          style={[styles.modeButton, isActive && styles.modeButtonActive]}
                          activeOpacity={0.86}
                          onPress={() => {
                            if (mode.key === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING && !canUseSpotifyNowPlaying) {
                              Alert.alert(
                                '고급모드 Spotify 계정',
                                '등록된 Spotify 계정에서는 현재 재생곡 기반 고급모드 기록을 사용할 수 있어요.'
                              );
                            }
                            setRecordingMode(mode.key);
                          }}
                        >
                          <Text style={[styles.modeText, isActive && styles.modeTextActive]}>{mode.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View style={[styles.recordControl, effectiveIsRecording && styles.recordControlActive]}>
                <View style={styles.recordControlText}>
                  <Text style={styles.recordControlLabel}>{effectiveIsRecording ? 'RECORDING' : 'MUSIC MAP'}</Text>
                  <Text style={styles.recordControlTitle}>
                    {effectiveIsRecording
                      ? currentRecordingTrack?.title || '기록 진행 중'
                      : recordingMode === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING
                        ? '지금 듣는 곡 기록하기'
                        : '내 플레이리스트 기록하기'}
                  </Text>
                  <Text style={styles.recordControlMeta}>
                    {effectiveIsRecording
                      ? `${currentRecordingTrack?.artist || 'Unknown Artist'} · ${formatDuration(recordingElapsedMs)} 경과 · ${Math.round(recordingDistanceM)}m 이동`
                      : recordingMode === MUSIC_MAP_RECORDING_MODES.SPOTIFY_NOW_PLAYING
                        ? '기록을 누르면 지금부터 듣는 곡이 뮤직지도에 남아요.'
                        : '화면이 꺼지면 기록이 중단돼요.'}
                  </Text>
                  {effectiveIsRecording ? (
                    <Text style={styles.recordControlMeta}>
                      다음 곡: {nextRecordingTrack?.title || '없음'} · 남은 시간 {formatDuration(recordingRemainingMs)}
                    </Text>
                  ) : null}
                  {effectiveIsRecording && activeRecordingMode === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL ? (
                    <Text style={styles.recordWarningText}>화면을 켠 상태에서 기록해주세요.</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={[styles.recordToggleButton, effectiveIsRecording && styles.recordToggleButtonActive]}
                  onPress={handleToggleRecording}
                  disabled={showStartSpinner}
                  activeOpacity={0.86}
                >
                  {showStartSpinner ? (
                    <ActivityIndicator color={effectiveIsRecording ? UI.peach : '#211817'} />
                  ) : (
                    <>
                      <Ionicons name={effectiveIsRecording ? 'stop' : 'radio-outline'} size={18} color={effectiveIsRecording ? UI.peach : '#211817'} />
                      <Text style={[styles.recordToggleText, effectiveIsRecording && styles.recordToggleTextActive]}>
                        {effectiveIsRecording ? '중단' : '기록'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {isSequentialUrlMode ? (
                <View style={styles.playlistSelectPanel}>
                  <View style={styles.playlistSelectHeader}>
                    <View style={styles.playlistSelectTitleWrap}>
                      <Text style={styles.playlistLabel}>TRACK PLAYLIST</Text>
                      <Text style={styles.playlistSelectTitle} numberOfLines={1}>
                        {selectedPlaylist?.name || '플레이리스트를 만들어주세요'}
                      </Text>
                      <Text style={styles.playlistSelectMeta}>
                        {trackPlaylist.length ? `${trackPlaylist.length}곡 선택됨` : '플레이리스트 설정에서 곡을 추가해주세요'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.playlistManageButton}
                      onPress={() => setActiveTab('playlist')}
                      activeOpacity={0.86}
                    >
                      <Ionicons name="list-outline" size={16} color={UI.peach} />
                      <Text style={styles.playlistManageText}>설정</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedPlaylistScroller}>
                    {savedPlaylists.map((playlist) => {
                      const isActive = playlist.id === selectedPlaylist?.id;
                      return (
                        <TouchableOpacity
                          key={playlist.id}
                          style={[styles.savedPlaylistChip, isActive && styles.savedPlaylistChipActive]}
                          onPress={() => handleSelectPlaylist(playlist.id)}
                          disabled={effectiveIsRecording}
                          activeOpacity={0.86}
                        >
                          <Text style={[styles.savedPlaylistChipText, isActive && styles.savedPlaylistChipTextActive]} numberOfLines={1}>
                            {playlist.name}
                          </Text>
                          <Text style={styles.savedPlaylistChipMeta}>{playlist.tracks?.length || 0}곡</Text>
                        </TouchableOpacity>
                      );
                    })}
                    <TouchableOpacity
                      style={styles.savedPlaylistAddChip}
                      onPress={handleCreatePlaylist}
                      disabled={effectiveIsRecording}
                      activeOpacity={0.86}
                    >
                      <Ionicons name="add-outline" size={18} color={UI.peach} />
                      <Text style={styles.savedPlaylistAddText}>새로 만들기</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              ) : null}

              <View style={styles.periodPanel}>
                <View style={styles.periodHeader}>
                  <Text style={styles.periodTitle}>기간</Text>
                  <Text style={styles.periodMeta}>{periodFilter === 'date' ? formatDateLabel(selectedDate) : '기록 트랙 보기'}</Text>
                </View>
                <View style={styles.periodButtons}>
                  {PERIOD_FILTERS.map((filter) => {
                    const isActive = periodFilter === filter.key;
                    return (
                      <TouchableOpacity
                        key={filter.key}
                        style={[styles.periodButton, isActive && styles.periodButtonActive]}
                        onPress={() => setPeriodFilter(filter.key)}
                        activeOpacity={0.86}
                      >
                        <Text style={[styles.periodButtonText, isActive && styles.periodButtonTextActive]}>
                          {filter.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {periodFilter === 'date' ? (
                  <View style={styles.dateStepper}>
                    <TouchableOpacity style={styles.dateButton} onPress={() => setSelectedDate((date) => addDays(date, -1))}>
                      <Ionicons name="chevron-back-outline" size={18} color={UI.peach} />
                    </TouchableOpacity>
                    <Text style={styles.dateText}>{formatDateLabel(selectedDate)}</Text>
                    <TouchableOpacity style={styles.dateButton} onPress={() => setSelectedDate((date) => addDays(date, 1))}>
                      <Ionicons name="chevron-forward-outline" size={18} color={UI.peach} />
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              <View style={[styles.mapWrap, !effectiveIsRecording && selectedRecord && styles.mapWrapSelected]}>
                <KakaoMusicMap
                  apiKey={API_KEYS.KAKAO_MAPS}
                  baseUrl={API_KEYS.KAKAO_MAPS_BASE_URL}
                  center={mapCenter}
                  records={mapRecords}
                  mode="track"
                  selectedRecordId={selectedRecord?.id || ''}
                  onRecordPress={setSelectedRecordId}
                />
                {isLoading ? (
                  <View style={styles.mapLoading}>
                    <ActivityIndicator color={UI.peach} />
                    <Text style={styles.mapLoadingText}>뮤직 기록을 불러오는 중</Text>
                  </View>
                ) : null}
                {!effectiveIsRecording && !isLoading && mapRecords.length === 0 ? (
                  <View style={styles.emptyOverlay}>
                    <Ionicons name="git-branch-outline" size={24} color={UI.peach} />
                    <Text style={styles.emptyTitle}>아직 표시할 기록이 없습니다</Text>
                    <Text style={styles.emptyText}>기록하기를 누른 뒤 음악을 들으며 이동하면 경로가 남습니다.</Text>
                  </View>
                ) : null}
                {!effectiveIsRecording && selectedRecord ? (
                  <View style={styles.selectedOverlay}>
                    <View style={styles.selectedOverlayHeader}>
                      <View style={[styles.selectedOverlayIcon, { borderColor: selectedRecord.albumColor || UI.peach }]}>
                        <Ionicons
                          name={selectedRecord.recordType === 'pin' ? 'location-outline' : 'git-branch-outline'}
                          size={20}
                          color={selectedRecord.albumColor || UI.peach}
                        />
                      </View>
                      <View style={styles.selectedOverlayTitleWrap}>
                        <Text style={styles.selectedOverlayTitle} numberOfLines={1}>
                          {selectedRecord.placeName || '내 음악 위치'}
                        </Text>
                        <Text style={styles.selectedOverlayMeta} numberOfLines={1}>
                          {selectedRecord.tracks.length}곡 · {selectedRecord.recordType === 'pin' ? '한 지점 기록' : `${Math.round(selectedRecord.routeDistance)}m 이동`}
                        </Text>
                      </View>
                      <TouchableOpacity style={styles.selectedOverlayClose} onPress={() => setSelectedRecordId('')}>
                        <Ionicons name="close-outline" size={18} color={UI.peach} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.selectedScrollHint}>
                      <Text style={styles.selectedScrollHintText}>아래로 스크롤해 포함된 노래 보기</Text>
                      <Ionicons name="chevron-down-outline" size={14} color={UI.peach} />
                    </View>
                  </View>
                ) : null}
              </View>

              {!effectiveIsRecording && selectedRecord ? (
                <View style={styles.selectedDetailsPanel}>
                  <Text style={styles.selectedOverlayLabel}>이 기록에 포함된 노래</Text>
                  <ScrollView
                    style={styles.selectedTrackList}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={selectedRecord.tracks.length > 3}
                  >
                    {selectedRecord.tracks.map((track) => (
                      <View key={track.key} style={styles.selectedTrackRow}>
                        <AlbumThumb uri={track.artworkUrl} color={track.albumColor} size={34} />
                        <View style={styles.recordTextWrap}>
                          <Text style={styles.recordTitle} numberOfLines={1}>{track.title}</Text>
                          <Text style={styles.recordMeta} numberOfLines={1}>
                            {track.artist} · {formatAge(track.recordedAt)}
                          </Text>
                        </View>
                        {track.record?.track ? (
                          <TouchableOpacity style={styles.selectedPlayButton} onPress={() => handlePlayRecord(track.record)}>
                            <Ionicons name="play" size={12} color="#211817" />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                  {topTracks.length > 0 ? (
                    <Text style={styles.selectedTopText} numberOfLines={1}>
                      이 위치 TOP 3 · {topTracks.map((track) => track.title).join(' · ')}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {currentTrack ? (
                <View style={styles.nowPlaying}>
                  <AlbumThumb uri={currentTrack.artworkUrl} color={currentTrack.color || UI.peach} size={58} />
                  <View style={styles.nowTextWrap}>
                    <Text style={styles.nowLabel}>NOW PLAYING</Text>
                    <Text style={styles.nowTitle} numberOfLines={1}>{currentTrack.title}</Text>
                    <Text style={styles.nowMeta} numberOfLines={1}>
                      {activeRecordingMode === MUSIC_MAP_RECORDING_MODES.SEQUENTIAL_URL
                        ? recordArtist({ track: currentTrack })
                        : `${recordArtist({ track: currentTrack })} · ${formatDuration(playerState.positionMs || 0)} 재생됨`}
                    </Text>
                  </View>
                  <View style={[styles.liveDot, { backgroundColor: playerState.isPlaying ? UI.peach : UI.textMuted }]} />
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.playlistPanel}>
              <View style={styles.playlistHeader}>
                <View>
                  <Text style={styles.playlistLabel}>TRACK PLAYLIST</Text>
                  <Text style={styles.playlistTitle}>플레이리스트 설정</Text>
                </View>
                <View style={styles.playlistHeaderActions}>
                  <Text style={styles.playlistCount}>{trackPlaylist.length}/{MAX_TRACK_PLAYLIST_ITEMS}</Text>
                  <TouchableOpacity
                    style={styles.playlistMapButton}
                    onPress={() => setActiveTab('map')}
                    activeOpacity={0.86}
                  >
                    <Ionicons name="map-outline" size={15} color={UI.peach} />
                    <Text style={styles.playlistMapButtonText}>지도</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.playlistLibraryHeader}>
                <Text style={styles.playlistLibraryTitle}>내 플레이리스트</Text>
                <TouchableOpacity
                  style={styles.playlistCreateButton}
                  onPress={handleCreatePlaylist}
                  disabled={effectiveIsRecording}
                  activeOpacity={0.86}
                >
                  <Ionicons name="add-outline" size={16} color={UI.peach} />
                  <Text style={styles.playlistCreateText}>새로 만들기</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedPlaylistScroller}>
                {savedPlaylists.map((playlist) => {
                  const isActive = playlist.id === selectedPlaylist?.id;
                  return (
                    <TouchableOpacity
                      key={playlist.id}
                      style={[styles.savedPlaylistChip, isActive && styles.savedPlaylistChipActive]}
                      onPress={() => handleSelectPlaylist(playlist.id)}
                      disabled={effectiveIsRecording}
                      activeOpacity={0.86}
                    >
                      <Text style={[styles.savedPlaylistChipText, isActive && styles.savedPlaylistChipTextActive]} numberOfLines={1}>
                        {playlist.name}
                      </Text>
                      <Text style={styles.savedPlaylistChipMeta}>{playlist.tracks?.length || 0}곡</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {selectedPlaylist ? (
                <View style={styles.playlistEditingHeader}>
                  <View style={styles.playlistEditingTitleWrap}>
                    <Text style={styles.playlistNameLabel}>플레이리스트 이름</Text>
                    <TextInput
                      value={selectedPlaylist.name || ''}
                      onChangeText={handleRenamePlaylist}
                      placeholder="플레이리스트 이름을 입력하세요"
                      placeholderTextColor={UI.textMuted}
                      style={styles.playlistNameInput}
                      editable={!effectiveIsRecording}
                      maxLength={32}
                      returnKeyType="done"
                    />
                  </View>
                  {savedPlaylists.length > 1 ? (
                    <TouchableOpacity
                      style={styles.playlistDeleteButton}
                      onPress={() => handleDeletePlaylist(selectedPlaylist?.id)}
                      disabled={effectiveIsRecording || !selectedPlaylist?.id}
                      activeOpacity={0.86}
                    >
                      <Ionicons name="trash-outline" size={15} color={UI.peach} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <View style={styles.playlistCreateNotice}>
                  <Text style={styles.playlistCreateNoticeTitle}>아직 만든 플레이리스트가 없습니다</Text>
                  <Text style={styles.playlistCreateNoticeText}>새로 만들기를 누른 뒤 이름을 정하고 곡을 추가해주세요.</Text>
                </View>
              )}

              <View style={styles.searchRow}>
                <TextInput
                  value={trackQuery}
                  onChangeText={setTrackQuery}
                  placeholder="곡 제목 또는 아티스트 검색"
                  placeholderTextColor={UI.textMuted}
                  style={styles.searchInput}
                  editable={!effectiveIsRecording}
                  returnKeyType="search"
                  onSubmitEditing={handleSearchTracks}
                />
                <TouchableOpacity
                  style={[styles.searchButton, (isSearchingTracks || effectiveIsRecording) && styles.searchButtonDisabled]}
                  onPress={handleSearchTracks}
                  disabled={isSearchingTracks || effectiveIsRecording}
                >
                  <Text style={styles.searchButtonText}>{isSearchingTracks ? '검색중' : '검색'}</Text>
                </TouchableOpacity>
              </View>

              {trackPlaylist.length > 0 ? (
                <View style={styles.playlistQueue}>
                  {trackPlaylist.map((track, index) => (
                    <View key={`${getPlaylistItemKey(track)}-${index}`} style={styles.playlistQueueRow}>
                      <Text style={styles.playlistRank}>{index + 1}</Text>
                      <AlbumThumb uri={track.albumArtUrl || track.artworkUrl} color={track.albumColor || track.color} size={34} />
                      <View style={styles.playlistTrackText}>
                        <Text style={styles.playlistTrackTitle} numberOfLines={1}>{track.title}</Text>
                        <Text style={styles.playlistTrackMeta} numberOfLines={1}>
                          {track.artist} · {formatDuration(track.durationMs)}
                        </Text>
                      </View>
                      {!effectiveIsRecording ? (
                        <View style={styles.playlistActions}>
                          <TouchableOpacity style={styles.iconMiniButton} onPress={() => handleMovePlaylistTrack(index, -1)}>
                            <Ionicons name="chevron-up-outline" size={15} color={UI.peach} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.iconMiniButton} onPress={() => handleMovePlaylistTrack(index, 1)}>
                            <Ionicons name="chevron-down-outline" size={15} color={UI.peach} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.iconMiniButton} onPress={() => handleRemovePlaylistTrack(index)}>
                            <Ionicons name="close-outline" size={15} color={UI.peach} />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.playlistEmptyText}>기록 전 최소 1곡을 추가해주세요.</Text>
              )}

              <Text style={styles.suggestionTitle}>
                {trackResults.length > 0 ? '검색 결과' : '대한민국 TOP50 추천'}
              </Text>
              {isLoadingTrendingTracks && trackResults.length === 0 ? (
                <View style={styles.suggestionLoading}>
                  <ActivityIndicator color={UI.peach} />
                  <Text style={styles.suggestionLoadingText}>추천곡을 불러오는 중</Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionScroller}>
                  {(trackResults.length > 0 ? trackResults : trendingTracks).map((track, index) => {
                    const added = trackPlaylist.some((item) => getPlaylistItemKey(item) === getPlaylistItemKey(track));
                    return (
                      <TouchableOpacity
                        key={`${getPlaylistItemKey(track)}-${index}`}
                        style={[styles.suggestionCard, added && styles.suggestionCardAdded]}
                        onPress={() => handleAddPlaylistTrack(track)}
                        disabled={added || effectiveIsRecording}
                        activeOpacity={0.86}
                      >
                        <AlbumThumb uri={track.albumArtUrl || track.artworkUrl} color={track.albumColor || track.color} size={44} />
                        <Text style={styles.suggestionTrackTitle} numberOfLines={1}>{track.title}</Text>
                        <Text style={styles.suggestionTrackMeta} numberOfLines={1}>{track.artist}</Text>
                        <Text style={styles.suggestionAddText}>{added ? '추가됨' : '추가'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          )}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UI.bg,
  },
  hero: {
    paddingBottom: 18,
    backgroundColor: UI.bg,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: {
    color: UI.peach,
    fontSize: 26,
    fontWeight: '300',
  },
  rulePill: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(255, 241, 236, 0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ruleText: {
    color: UI.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 201, 184, 0.08)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  modeSwitch: {
    height: 48,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI.borderStrong,
    backgroundColor: 'rgba(7, 8, 10, 0.78)',
    flexDirection: 'row',
    padding: 4,
  },
  modeButton: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: {
    backgroundColor: 'rgba(255, 201, 184, 0.12)',
    borderWidth: 1,
    borderColor: UI.peach,
  },
  modeText: {
    color: UI.textMuted,
    fontSize: 13,
    fontWeight: '900',
  },
  modeTextActive: {
    color: UI.peach,
  },
  recordModePanel: {
    marginHorizontal: 18,
    marginTop: 4,
    marginBottom: 10,
  },
  modeHelpPanel: {
    marginTop: 8,
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(255, 241, 236, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.12)',
    gap: 5,
  },
  modeHelpText: {
    color: UI.textSoft,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  recordControl: {
    marginHorizontal: 18,
    marginTop: 4,
    minHeight: 84,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI.borderStrong,
    backgroundColor: 'rgba(7, 8, 10, 0.78)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  recordControlActive: {
    backgroundColor: 'rgba(255, 201, 184, 0.12)',
    borderColor: UI.peach,
  },
  recordControlText: {
    flex: 1,
    minWidth: 0,
  },
  recordControlLabel: {
    color: UI.peach,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 5,
  },
  recordControlTitle: {
    color: UI.text,
    fontSize: 18,
    fontWeight: '900',
  },
  recordControlMeta: {
    color: UI.textSoft,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 5,
  },
  recordWarningText: {
    color: UI.peach,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    marginTop: 6,
  },
  recordToggleButton: {
    minWidth: 74,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    backgroundColor: UI.peach,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  recordToggleButtonActive: {
    backgroundColor: 'rgba(5, 7, 10, 0.72)',
    borderWidth: 1,
    borderColor: UI.borderStrong,
  },
  recordToggleText: {
    color: '#211817',
    fontSize: 12,
    fontWeight: '900',
  },
  recordToggleTextActive: {
    color: UI.peach,
  },
  playlistSelectPanel: {
    marginHorizontal: 18,
    marginTop: 10,
    borderRadius: 18,
    padding: 12,
    backgroundColor: 'rgba(255, 241, 236, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.14)',
  },
  playlistSelectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playlistSelectTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  playlistSelectTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 4,
  },
  playlistSelectMeta: {
    color: UI.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  playlistManageButton: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 201, 184, 0.08)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  playlistManageText: {
    color: UI.peach,
    fontSize: 11,
    fontWeight: '900',
  },
  savedPlaylistScroller: {
    gap: 8,
    paddingTop: 10,
    paddingRight: 4,
  },
  savedPlaylistChip: {
    minWidth: 108,
    maxWidth: 156,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: 'rgba(5, 7, 10, 0.42)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  savedPlaylistChipActive: {
    backgroundColor: 'rgba(255, 201, 184, 0.16)',
    borderColor: UI.borderStrong,
  },
  savedPlaylistChipText: {
    color: UI.textSoft,
    fontSize: 12,
    fontWeight: '900',
  },
  savedPlaylistChipTextActive: {
    color: UI.peach,
  },
  savedPlaylistChipMeta: {
    color: UI.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
  },
  savedPlaylistAddChip: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 201, 184, 0.06)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  savedPlaylistAddText: {
    color: UI.peach,
    fontSize: 11,
    fontWeight: '900',
  },
  filterSwitch: {
    marginHorizontal: 24,
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 241, 236, 0.06)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  filterButtonActive: {
    backgroundColor: 'rgba(255, 201, 184, 0.16)',
    borderColor: UI.borderStrong,
  },
  filterText: {
    color: UI.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  filterTextActive: {
    color: UI.peach,
  },
  mapWrap: {
    marginTop: 10,
    minHeight: 450,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.12)',
  },
  mapWrapSelected: {
    minHeight: 360,
  },
  mapLoading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5, 7, 10, 0.58)',
  },
  mapLoadingText: {
    color: UI.textSoft,
    fontSize: 12,
    marginTop: 10,
  },
  emptyOverlay: {
    position: 'absolute',
    left: 26,
    right: 26,
    bottom: 28,
    borderRadius: 22,
    padding: 18,
    backgroundColor: 'rgba(22, 18, 17, 0.9)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  emptyTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 8,
  },
  emptyText: {
    color: UI.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  selectedOverlay: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    borderRadius: 20,
    padding: 12,
    backgroundColor: 'rgba(18, 15, 14, 0.96)',
    borderWidth: 1,
    borderColor: UI.borderStrong,
  },
  selectedOverlayHeader: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectedOverlayIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 201, 184, 0.08)',
  },
  selectedOverlayTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  selectedOverlayTitle: {
    color: UI.peach,
    fontSize: 16,
    fontWeight: '800',
  },
  selectedOverlayMeta: {
    color: UI.textSoft,
    fontSize: 11,
    marginTop: 4,
  },
  selectedOverlayClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.panelSoft,
    borderWidth: 1,
    borderColor: UI.border,
  },
  selectedScrollHint: {
    marginTop: 9,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 201, 184, 0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedScrollHintText: {
    color: UI.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  selectedDetailsPanel: {
    marginHorizontal: 18,
    marginTop: 8,
    borderRadius: 18,
    padding: 12,
    backgroundColor: UI.panel,
    borderWidth: 1,
    borderColor: UI.border,
  },
  selectedOverlayDivider: {
    height: 1,
    marginVertical: 10,
    backgroundColor: 'rgba(255, 201, 184, 0.12)',
  },
  selectedOverlayLabel: {
    color: UI.text,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 8,
  },
  selectedTrackList: {
    maxHeight: 172,
  },
  selectedTrackRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 8,
    marginBottom: 7,
    backgroundColor: 'rgba(255, 241, 236, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.10)',
    gap: 10,
  },
  selectedPlayButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.peach,
  },
  selectedMoreText: {
    color: UI.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
    marginTop: 1,
  },
  selectedTopText: {
    color: UI.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  nowPlaying: {
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 2,
    borderRadius: 18,
    padding: 11,
    backgroundColor: UI.panel,
    borderWidth: 1,
    borderColor: UI.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  nowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  nowLabel: {
    color: UI.peach,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 3,
    marginBottom: 4,
  },
  nowTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
  },
  nowMeta: {
    color: UI.textSoft,
    fontSize: 11,
    marginTop: 4,
  },
  liveDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  sheet: {
    marginTop: 8,
    marginHorizontal: 12,
    marginBottom: 28,
    borderRadius: 26,
    padding: 18,
    backgroundColor: UI.panel,
    borderWidth: 1,
    borderColor: UI.border,
  },
  handle: {
    alignSelf: 'center',
    width: 78,
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255, 201, 184, 0.34)',
    marginBottom: 18,
  },
  periodPanel: {
    marginHorizontal: 18,
    marginTop: 10,
    borderRadius: 18,
    padding: 12,
    backgroundColor: 'rgba(255, 241, 236, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.12)',
  },
  periodHeader: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  periodTitle: {
    color: UI.text,
    fontSize: 13,
    fontWeight: '900',
  },
  periodMeta: {
    color: UI.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  periodButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  periodButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 241, 236, 0.05)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  periodButtonActive: {
    backgroundColor: 'rgba(255, 201, 184, 0.16)',
    borderColor: UI.borderStrong,
  },
  periodButtonText: {
    color: UI.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  periodButtonTextActive: {
    color: UI.peach,
  },
  dateStepper: {
    minHeight: 38,
    marginTop: 10,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(5, 7, 10, 0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.14)',
  },
  dateButton: {
    width: 42,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateText: {
    color: UI.textSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  playlistPanel: {
    marginHorizontal: 18,
    marginTop: 10,
    borderRadius: 18,
    padding: 12,
    backgroundColor: 'rgba(255, 241, 236, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.14)',
  },
  playlistHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  playlistHeaderActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  playlistMapButton: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(255, 201, 184, 0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  playlistMapButtonText: {
    color: UI.peach,
    fontSize: 11,
    fontWeight: '900',
  },
  playlistLabel: {
    color: UI.peach,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  playlistTitle: {
    color: UI.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 4,
  },
  playlistCount: {
    color: UI.peach,
    fontSize: 12,
    fontWeight: '900',
  },
  playlistHelp: {
    color: UI.textSoft,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
  playlistImportHelp: {
    color: UI.peach,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
    marginTop: 8,
  },
  playlistLibraryHeader: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  playlistLibraryTitle: {
    color: UI.text,
    fontSize: 13,
    fontWeight: '900',
  },
  playlistCreateButton: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 201, 184, 0.08)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  playlistCreateText: {
    color: UI.peach,
    fontSize: 11,
    fontWeight: '900',
  },
  playlistEditingHeader: {
    marginTop: 12,
    minHeight: 72,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(5, 7, 10, 0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.12)',
  },
  playlistEditingTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  playlistEditingTitle: {
    color: UI.text,
    fontSize: 13,
    fontWeight: '900',
  },
  playlistNameLabel: {
    color: UI.peach,
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 6,
  },
  playlistNameInput: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(255, 241, 236, 0.04)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
  },
  playlistEditingMeta: {
    color: UI.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  playlistCreateNotice: {
    marginTop: 12,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.16)',
    backgroundColor: 'rgba(255, 201, 184, 0.06)',
  },
  playlistCreateNoticeTitle: {
    color: UI.text,
    fontSize: 14,
    fontWeight: '900',
  },
  playlistCreateNoticeText: {
    color: UI.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  playlistDeleteButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 201, 184, 0.08)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  searchRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 12,
    color: UI.text,
    backgroundColor: 'rgba(5, 7, 10, 0.42)',
    borderWidth: 1,
    borderColor: UI.border,
    fontSize: 13,
    fontWeight: '700',
  },
  searchButton: {
    minWidth: 58,
    minHeight: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.peach,
  },
  searchButtonDisabled: {
    opacity: 0.55,
  },
  searchButtonText: {
    color: '#211817',
    fontSize: 12,
    fontWeight: '900',
  },
  playlistQueue: {
    marginTop: 10,
    gap: 7,
  },
  playlistQueueRow: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(255, 241, 236, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.10)',
  },
  playlistRank: {
    width: 18,
    color: UI.peach,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  playlistTrackText: {
    flex: 1,
    minWidth: 0,
  },
  playlistTrackTitle: {
    color: UI.text,
    fontSize: 13,
    fontWeight: '900',
  },
  playlistTrackMeta: {
    color: UI.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  playlistActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconMiniButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 201, 184, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.14)',
  },
  playlistEmptyText: {
    color: UI.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
  },
  suggestionTitle: {
    color: UI.text,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 13,
    marginBottom: 8,
  },
  suggestionLoading: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  suggestionLoadingText: {
    color: UI.textSoft,
    fontSize: 12,
  },
  suggestionScroller: {
    gap: 8,
    paddingRight: 4,
  },
  suggestionCard: {
    width: 112,
    minHeight: 128,
    borderRadius: 16,
    padding: 9,
    backgroundColor: 'rgba(5, 7, 10, 0.42)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  suggestionCardAdded: {
    opacity: 0.58,
    borderColor: UI.borderStrong,
  },
  suggestionTrackTitle: {
    color: UI.text,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 8,
  },
  suggestionTrackMeta: {
    color: UI.textMuted,
    fontSize: 10,
    marginTop: 3,
  },
  suggestionAddText: {
    color: UI.peach,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  sheetIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 201, 184, 0.08)',
  },
  sheetTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    color: UI.peach,
    fontSize: 25,
    fontWeight: '500',
  },
  sheetSub: {
    color: UI.textSoft,
    fontSize: 14,
    marginTop: 7,
    lineHeight: 20,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.panelSoft,
    borderWidth: 1,
    borderColor: UI.border,
  },
  selectedSong: {
    marginTop: 18,
    borderRadius: 18,
    padding: 12,
    backgroundColor: 'rgba(5, 7, 10, 0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectedSongText: {
    flex: 1,
    minWidth: 0,
  },
  selectedTitle: {
    color: UI.text,
    fontSize: 17,
    fontWeight: '900',
  },
  selectedMeta: {
    color: UI.textSoft,
    fontSize: 12,
    marginTop: 7,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.peach,
  },
  smallPlayButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.peach,
  },
  sectionLabel: {
    color: UI.text,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 20,
    marginBottom: 10,
  },
  topRow: {
    minHeight: 58,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 201, 184, 0.12)',
  },
  rank: {
    width: 22,
    color: UI.peach,
    fontSize: 18,
    fontWeight: '300',
    textAlign: 'center',
  },
  topTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  topTitle: {
    color: UI.text,
    fontSize: 14,
    fontWeight: '800',
  },
  topMeta: {
    color: UI.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  recordRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(255, 241, 236, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.10)',
    gap: 12,
  },
  recordRowActive: {
    borderColor: UI.borderStrong,
    backgroundColor: 'rgba(255, 201, 184, 0.09)',
  },
  recordColor: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  recordTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  recordTitle: {
    color: UI.text,
    fontSize: 13,
    fontWeight: '800',
  },
  recordMeta: {
    color: UI.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  albumThumb: {
    backgroundColor: COLORS.surface,
  },
  albumFallback: {
    borderWidth: 1,
    borderColor: 'rgba(255, 241, 236, 0.22)',
  },
  emptySheet: {
    paddingVertical: 10,
  },
  errorText: {
    color: UI.peach,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
  },
});
