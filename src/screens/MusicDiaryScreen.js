import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import KakaoMusicMap from '../components/KakaoMusicMap';
import { API_KEYS } from '../constants';
import { getMusicDiaryDraft } from '../services/musicDiaryDraftService';

const RECEIPT_BACKGROUND = require('../../assets/receipt-transparent.png');

const UI = {
  bg: '#05070A',
  panel: 'rgba(22, 18, 18, 0.92)',
  panelSoft: 'rgba(255, 201, 184, 0.08)',
  border: 'rgba(255, 201, 184, 0.22)',
  text: '#FFF1EC',
  textSoft: '#D9C6C0',
  textMuted: '#9E908D',
  peach: '#FFC8B8',
  receiptInk: '#144D32',
  receiptText: '#1E1A18',
  receiptMuted: '#5D6760',
};

const RECEIPT_ROUTE_PREVIEW_HEIGHT = 260;

function getDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = getDate(value) || new Date();
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} (${weekday}) ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDistance(meters = 0) {
  const value = Number(meters || 0);
  if (!Number.isFinite(value) || value <= 0) return '0m';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}km`;
  return `${Math.round(value)}m`;
}

function hexToRgba(color = UI.peach, alpha = 1) {
  const clean = String(color || UI.peach).replace('#', '').trim();
  const normalized = clean.length === 3
    ? clean.split('').map((char) => `${char}${char}`).join('')
    : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(255, 200, 184, ${alpha})`;
  }
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function normalizePoint(point) {
  const latitude = Number(point?.latitude ?? point?.lat);
  const longitude = Number(point?.longitude ?? point?.lon ?? point?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function buildPath(points = [], width = 320, height = 150) {
  const normalized = points.map(normalizePoint).filter(Boolean);
  if (normalized.length < 2) return '';
  const minLat = Math.min(...normalized.map((point) => point.latitude));
  const maxLat = Math.max(...normalized.map((point) => point.latitude));
  const minLon = Math.min(...normalized.map((point) => point.longitude));
  const maxLon = Math.max(...normalized.map((point) => point.longitude));
  const latSpan = Math.max(0.00001, maxLat - minLat);
  const lonSpan = Math.max(0.00001, maxLon - minLon);
  const padding = 24;

  return normalized.map((point, index) => {
    const x = padding + ((point.longitude - minLon) / lonSpan) * (width - padding * 2);
    const y = padding + (1 - ((point.latitude - minLat) / latSpan)) * (height - padding * 2);
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function getDiaryTrack(record = {}, selectedTrack = {}) {
  const trackRecord = selectedTrack?.record || {};
  const track = trackRecord.track || record.track || {};
  return {
    title: selectedTrack?.title || track.title || record.trackName || 'Unknown Track',
    artist: selectedTrack?.artist || track.artist || record.artistName || 'Unknown Artist',
    album: track.album || record.albumName || '',
    artworkUrl: selectedTrack?.artworkUrl || track.artworkUrl || record.albumArtUrl || record.startAlbumArtUrl || '',
    albumColor: selectedTrack?.albumColor || record.albumColor || record.startAlbumColor || UI.peach,
    playedDurationMs: selectedTrack?.playedDurationMs || trackRecord.playedDurationMs || record.playedDurationMs || 0,
  };
}

function getRecordCenter(record = {}) {
  const routePoints = Array.isArray(record.routePoints) ? record.routePoints.map(normalizePoint).filter(Boolean) : [];
  return normalizePoint(record.location) ||
    normalizePoint(record.endLocation) ||
    routePoints[routePoints.length - 1] ||
    normalizePoint(record.startLocation) ||
    null;
}

function getSummaryTracks(record = {}, track = {}) {
  const sourceTracks = Array.isArray(record.tracks) && record.tracks.length > 0
    ? record.tracks
    : Array.isArray(record.routeSegments)
      ? record.routeSegments
      : [];
  const tracks = sourceTracks
    .map((item) => item?.track || item)
    .filter(Boolean)
    .map((item, index) => ({
      id: item.id || item.trackId || item.spotifyUri || `track-${index}`,
      title: item.title || item.trackName || track.title,
      artist: item.artist || item.artistName || track.artist,
      artworkUrl: item.artworkUrl || item.albumArtUrl || track.artworkUrl,
    }));
  const fallback = {
    id: track.title || 'current-track',
    title: track.title,
    artist: track.artist,
    artworkUrl: track.artworkUrl,
  };
  return (tracks.length ? tracks : [fallback]).filter((item) => item.title || item.artworkUrl).slice(0, 4);
}

function getRecordId(record = {}) {
  return record.id || record.recordId || record.sessionId || 'music-diary-record';
}

function MusicRoutePreview({ record, color }) {
  const routePoints = Array.isArray(record?.routePoints) ? record.routePoints : [];
  const fallbackPath = buildPath(routePoints);
  const segments = Array.isArray(record?.routeSegments) && record.routeSegments.length > 0
    ? record.routeSegments
    : [{ id: 'route', routePoints, albumColor: color }];

  return (
    <View style={styles.routePreview}>
      <View style={styles.mapGrid} />
      <Svg width="100%" height="100%" viewBox="0 0 320 150">
        <Defs>
          <LinearGradient id="routeGlow" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity="0.32" />
            <Stop offset="1" stopColor="#FFC8B8" stopOpacity="0.95" />
          </LinearGradient>
        </Defs>
        {segments.map((segment, index) => {
          const segmentPath = buildPath(segment.routePoints || routePoints) || fallbackPath;
          if (!segmentPath) return null;
          const segmentColor = segment.albumColor || color;
          return (
            <React.Fragment key={segment.id || `segment-${index}`}>
              <Path d={segmentPath} fill="none" stroke={segmentColor} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity="0.12" />
              <Path d={segmentPath} fill="none" stroke={index === 0 ? 'url(#routeGlow)' : segmentColor} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.92" />
            </React.Fragment>
          );
        })}
        {routePoints.length > 0 ? (
          <Circle cx="238" cy="76" r="10" fill={hexToRgba(color, 0.24)} stroke={color} strokeWidth="2" />
        ) : null}
      </Svg>
    </View>
  );
}

function ReceiptRoutePreview({
  record,
  color,
  isEditable,
  shouldFitRecords,
  useStaticPreview,
}) {
  const center = getRecordCenter(record);
  const recordId = getRecordId(record);
  const previewRecord = { ...record, id: recordId };
  const canRenderKakaoMap = Boolean(API_KEYS?.KAKAO_MAPS && API_KEYS?.KAKAO_MAPS_BASE_URL && center);

  if (useStaticPreview || !canRenderKakaoMap) {
    return <MusicRoutePreview record={record} color={color} />;
  }

  if (canRenderKakaoMap) {
    return (
      <View
        collapsable={false}
        pointerEvents={isEditable ? 'auto' : 'none'}
        style={styles.receiptKakaoCapture}
      >
        <KakaoMusicMap
          apiKey={API_KEYS.KAKAO_MAPS}
          baseUrl={API_KEYS.KAKAO_MAPS_BASE_URL}
          center={center}
          records={[previewRecord]}
          mode="track"
          selectedRecordId={recordId}
          height={RECEIPT_ROUTE_PREVIEW_HEIGHT}
          shouldFitRecords={shouldFitRecords}
          disableGestures={!isEditable}
          shouldFocusSelectedRecord={false}
        />
      </View>
    );
  }

  return <MusicRoutePreview record={record} color={color} />;
}

export default function MusicDiaryScreen({ navigation, route }) {
  const draft = getMusicDiaryDraft(route?.params?.draftId);
  const record = draft?.record || route?.params?.record || {};
  const selectedTrack = draft?.track || route?.params?.track || null;
  const [isRouteMapEditable, setIsRouteMapEditable] = useState(false);
  const [hasRouteMapAdjusted, setHasRouteMapAdjusted] = useState(false);

  const track = useMemo(() => getDiaryTrack(record, selectedTrack), [record, selectedTrack]);
  const summaryTracks = useMemo(() => getSummaryTracks(record, track), [record, track]);
  const summaryTrackCount = useMemo(() => {
    if (Array.isArray(record.tracks) && record.tracks.length > 0) return record.tracks.length;
    if (Array.isArray(record.routeSegments) && record.routeSegments.length > 0) return record.routeSegments.length;
    return summaryTracks.length;
  }, [record.routeSegments, record.tracks, summaryTracks.length]);
  const pointColor = track.albumColor || UI.peach;
  const musicSummaryText = [track.title, track.artist].filter(Boolean).join(', ');

  useEffect(() => {
    setIsRouteMapEditable(false);
    setHasRouteMapAdjusted(false);
  }, [record?.id, record?.recordId, record?.sessionId]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity style={styles.circleButton} onPress={() => navigation.goBack()} activeOpacity={0.86}>
            <Ionicons name="chevron-back-outline" size={25} color={UI.peach} />
          </TouchableOpacity>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>Music Receipt</Text>
          <Text style={styles.subtitle}>공간과 음악, 오늘의 감정을 남겨요</Text>
        </View>

          <View
            collapsable={false}
            style={[
              styles.card,
              {
                borderColor: hexToRgba(pointColor, 0.78),
                shadowColor: pointColor,
              },
            ]}
          >
            <Image source={RECEIPT_BACKGROUND} style={styles.receiptBackground} resizeMode="contain" />

            <View style={[styles.cardTopRow, styles.receiptOverlay]}>
              <View style={styles.cardChip}>
                <Text style={styles.cardChipText} numberOfLines={1}>{record.placeName || '내 음악 위치'}</Text>
              </View>
            </View>

            <View style={[styles.receiptMetaRow, styles.receiptOverlay]}>
              <View style={styles.receiptMetaCell}>
                <Text style={styles.receiptValue}>{formatDateTime(record.startedAt || record.recordedAt)}</Text>
              </View>
              <View style={styles.receiptMetaCell}>
                <Text style={styles.receiptValue}>
                  {formatDistance(record.routeDistance)} 이동 · {formatDuration(record.playedDurationMs)}
                </Text>
              </View>
            </View>

            <View style={[styles.routePreviewSlot, styles.receiptOverlay]}>
              <ReceiptRoutePreview
                record={record}
                color={pointColor}
                isEditable={isRouteMapEditable}
                shouldFitRecords={!hasRouteMapAdjusted}
                useStaticPreview={false}
              />
              <TouchableOpacity
                style={styles.mapEditButton}
                onPress={() => {
                  setHasRouteMapAdjusted(true);
                  setIsRouteMapEditable((current) => !current);
                }}
                activeOpacity={0.86}
              >
                <Ionicons name={isRouteMapEditable ? 'checkmark-outline' : 'expand-outline'} size={16} color={UI.receiptInk} />
              </TouchableOpacity>
              {isRouteMapEditable ? (
                <View style={styles.mapEditBadge} pointerEvents="none">
                  <Text style={styles.mapEditBadgeText}>지도를 움직여 위치를 맞춘 뒤 저장하세요</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.musicSummaryRow, styles.receiptOverlay]}>
              <View style={styles.summaryArtworkStack}>
                {summaryTracks.slice(0, 3).map((item, index) => (
                  <Image
                    key={item.id || `summary-${index}`}
                    source={item.artworkUrl ? { uri: item.artworkUrl } : require('../../assets/AppLogo.png')}
                    style={[
                      styles.summaryArtwork,
                      {
                        left: index * 26,
                        zIndex: 4 - index,
                        borderColor: index === 0 ? pointColor : '#F1E9DA',
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.musicSummaryTextBlock}>
                <Text style={styles.summaryTitle}>{summaryTrackCount}곡 포함</Text>
                <Text style={styles.summarySubtitle} numberOfLines={2}>
                  {musicSummaryText}
                </Text>
              </View>
            </View>

          </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UI.bg,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 220,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  circleButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 201, 184, 0.06)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  headerSpacer: {
    width: 48,
    height: 48,
  },
  titleBlock: {
    marginTop: 18,
    marginBottom: 22,
  },
  title: {
    color: UI.peach,
    fontSize: 40,
    fontWeight: '300',
  },
  subtitle: {
    color: UI.textSoft,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
  },
  card: {
    aspectRatio: 2 / 3,
    width: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0.26,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },
  receiptBackground: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  receiptOverlay: {
    position: 'absolute',
    left: '7.6%',
    right: '7.6%',
  },
  cardTopRow: {
    top: '6.0%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardChip: {
    maxWidth: '48%',
    minHeight: 34,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  cardChipText: {
    color: UI.receiptInk,
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 38,
  },
  routePreview: {
    height: RECEIPT_ROUTE_PREVIEW_HEIGHT,
    marginTop: 6,
    marginHorizontal: 0,
    overflow: 'hidden',
  },
  mapGrid: {
    position: 'absolute',
    top: 8,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 18,
    backgroundColor: 'rgba(5, 7, 10, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 241, 236, 0.04)',
  },
  diaryQuote: {
    top: '84.3%',
    height: '5.6%',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  quoteMark: {
    position: 'absolute',
    left: 8,
    top: 8,
    color: 'rgba(20, 77, 50, 0.54)',
    fontSize: 28,
    fontWeight: '900',
  },
  quoteMarkEnd: {
    position: 'absolute',
    right: 6,
    bottom: 0,
    color: 'rgba(20, 77, 50, 0.54)',
    fontSize: 28,
    fontWeight: '900',
  },
  diaryCardText: {
    color: UI.receiptText,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 19,
  },
  receiptMetaRow: {
    top: '22.6%',
    height: '5.2%',
    flexDirection: 'row',
    gap: 36,
  },
  receiptMetaCell: {
    flex: 1,
  },
  receiptValue: {
    color: UI.receiptText,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  routePreviewSlot: {
    top: '30.4%',
    height: '41.8%',
    overflow: 'hidden',
  },
  receiptKakaoCapture: {
    height: '100%',
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: 'rgba(20, 77, 50, 0.08)',
  },
  mapEditButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 239, 225, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(20, 77, 50, 0.34)',
  },
  mapEditBadge: {
    position: 'absolute',
    left: 8,
    right: 44,
    bottom: 6,
    minHeight: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5, 7, 10, 0.58)',
  },
  mapEditBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  musicSummaryRow: {
    top: '77.2%',
    height: '5.6%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryArtworkStack: {
    width: 102,
    height: 50,
    position: 'relative',
  },
  summaryArtwork: {
    position: 'absolute',
    top: 0,
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    backgroundColor: '#EFE6D6',
  },
  musicSummaryTextBlock: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 6,
  },
  summaryTitle: {
    color: UI.receiptText,
    fontSize: 15,
    fontWeight: '900',
  },
  summarySubtitle: {
    color: UI.receiptMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 4,
  },
});
