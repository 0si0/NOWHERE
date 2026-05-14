import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { getMusicDiaryDraft } from '../services/musicDiaryDraftService';

const UI = {
  bg: '#05070A',
  panel: 'rgba(22, 18, 18, 0.92)',
  panelSoft: 'rgba(255, 201, 184, 0.08)',
  border: 'rgba(255, 201, 184, 0.22)',
  text: '#FFF1EC',
  textSoft: '#D9C6C0',
  textMuted: '#9E908D',
  peach: '#FFC8B8',
};

const DIARY_MAX_LENGTH = 260;
const EMOTION_TAGS = ['잔잔함', '설렘', '비 오는 밤', '드라이브', '혼자 걷기'];

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

export default function MusicDiaryScreen({ navigation, route }) {
  const draft = getMusicDiaryDraft(route?.params?.draftId);
  const record = draft?.record || route?.params?.record || {};
  const selectedTrack = draft?.track || route?.params?.track || null;
  const cardRef = useRef(null);
  const [diaryText, setDiaryText] = useState('');
  const [emotionTag, setEmotionTag] = useState('');
  const [capturedUri, setCapturedUri] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const track = useMemo(() => getDiaryTrack(record, selectedTrack), [record, selectedTrack]);
  const pointColor = track.albumColor || UI.peach;
  const diaryDisplayText = diaryText.trim() || '이 길을 걸으며 남기고 싶은 감정을 적어주세요.';

  const captureCard = useCallback(async () => {
    if (!cardRef.current) {
      throw new Error('카드를 준비하지 못했습니다.');
    }
    const uri = await captureRef(cardRef.current, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
    });
    setCapturedUri(uri);
    return uri;
  }, []);

  const handleCaptureCard = useCallback(async () => {
    setIsSaving(true);
    try {
      await captureCard();
      Alert.alert('음악 카드 저장 완료', '카드 이미지가 만들어졌습니다. 사진첩 저장 또는 공유를 이어서 할 수 있어요.');
    } catch (error) {
      Alert.alert('저장 실패', error.message || '음악 카드를 이미지로 만들지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [captureCard]);

  const handleSaveToLibrary = useCallback(async () => {
    setIsSaving(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('사진 권한 필요', '음악 카드를 사진첩에 저장하려면 사진 접근 권한이 필요합니다.');
        return;
      }
      const uri = capturedUri || await captureCard();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('사진첩 저장 완료', '뮤직 다이어리 카드가 사진첩에 저장됐습니다.');
    } catch (error) {
      Alert.alert('사진첩 저장 실패', error.message || '사진첩에 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [captureCard, capturedUri]);

  const handleShare = useCallback(async () => {
    setIsSaving(true);
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('공유 불가', '현재 기기에서 공유 기능을 사용할 수 없습니다.');
        return;
      }
      const uri = capturedUri || await captureCard();
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: 'NOWHERE 뮤직 다이어리 공유',
      });
    } catch (error) {
      Alert.alert('공유 실패', error.message || '음악 카드를 공유하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [captureCard, capturedUri]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity style={styles.circleButton} onPress={() => navigation.goBack()} activeOpacity={0.86}>
              <Ionicons name="chevron-back-outline" size={25} color={UI.peach} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.circleButton} onPress={handleCaptureCard} activeOpacity={0.86}>
              <Ionicons name="ellipsis-horizontal" size={22} color={UI.peach} />
            </TouchableOpacity>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.title}>뮤직 다이어리</Text>
            <Text style={styles.subtitle}>공간과 음악, 오늘의 감정을 남겨요</Text>
          </View>

          <View
            ref={cardRef}
            collapsable={false}
            style={[
              styles.card,
              {
                borderColor: hexToRgba(pointColor, 0.78),
                shadowColor: pointColor,
              },
            ]}
          >
            {track.artworkUrl ? (
              <Image source={{ uri: track.artworkUrl }} style={styles.cardBlurArtwork} blurRadius={28} />
            ) : null}
            <View style={[styles.cardColorWash, { backgroundColor: hexToRgba(pointColor, 0.30) }]} />

            <View style={styles.cardTopRow}>
              <View style={styles.cardChip}>
                <Ionicons name="location-outline" size={15} color={UI.peach} />
                <Text style={styles.cardChipText} numberOfLines={1}>{record.placeName || '내 음악 위치'}</Text>
              </View>
              <View style={styles.cardChip}>
                <Ionicons name="map-outline" size={15} color={UI.peach} />
                <Text style={styles.cardChipText}>뮤직맵 기록</Text>
              </View>
            </View>

            <MusicRoutePreview record={record} color={pointColor} />

            <View style={styles.cardMetaBlock}>
              <Text style={styles.cardDate}>{formatDateTime(record.startedAt || record.recordedAt)}</Text>
              <Text style={styles.cardPlaceTitle} numberOfLines={1}>{record.placeName || '내 음악 위치'}</Text>
              <Text style={styles.cardPlaceMeta}>
                {formatDistance(record.routeDistance)} 이동 · {formatDuration(record.playedDurationMs)} 기록
              </Text>
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.trackBlock}>
              <Image
                source={track.artworkUrl ? { uri: track.artworkUrl } : require('../../assets/AppLogo.png')}
                style={[styles.cardArtwork, { borderColor: hexToRgba(pointColor, 0.55) }]}
              />
              <View style={styles.trackTextBlock}>
                <Text style={styles.trackTitle} numberOfLines={2}>{track.title}</Text>
                <Text style={styles.trackArtist} numberOfLines={1}>{track.artist}</Text>
                {track.album ? <Text style={styles.trackAlbum} numberOfLines={1}>{track.album}</Text> : null}
                <View style={styles.trackProgressRow}>
                  <View style={styles.playCircle}>
                    <Ionicons name="play" size={11} color={UI.peach} />
                  </View>
                  <Text style={styles.trackTime}>{formatDuration(track.playedDurationMs || record.playedDurationMs)}</Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { backgroundColor: pointColor }]} />
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.diaryQuote}>
              <Text style={styles.quoteMark}>“</Text>
              <Text style={styles.diaryCardText}>{diaryDisplayText}</Text>
              <Text style={styles.quoteMarkEnd}>”</Text>
            </View>

            <View style={styles.cardFooter}>
              <View style={styles.footerBrandIcon}>
                <Ionicons name="musical-note-outline" size={18} color={UI.peach} />
              </View>
              <View>
                <Text style={styles.footerTitle}>Music Map Record</Text>
                <Text style={styles.footerBrand}>N O W H E R E</Text>
              </View>
              <View style={[styles.compassButton, { shadowColor: pointColor }]}>
                <Ionicons name="navigate" size={20} color={UI.peach} />
              </View>
            </View>
          </View>

          <View style={styles.inputPanel}>
            <View style={styles.inputHeader}>
              <Text style={styles.inputTitle}>오늘의 다이어리</Text>
              <Text style={styles.inputCount}>{diaryText.length}/{DIARY_MAX_LENGTH}</Text>
            </View>
            <TextInput
              value={diaryText}
              onChangeText={(text) => {
                setCapturedUri('');
                setDiaryText(text.slice(0, DIARY_MAX_LENGTH));
              }}
              placeholder="이 길을 걸으며 어떤 기분이었나요?"
              placeholderTextColor={UI.textMuted}
              style={styles.diaryInput}
              multiline
              maxLength={DIARY_MAX_LENGTH}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagScroller}>
              {EMOTION_TAGS.map((tag) => {
                const isActive = emotionTag === tag;
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.emotionTag, isActive && { borderColor: pointColor, backgroundColor: hexToRgba(pointColor, 0.16) }]}
                    onPress={() => {
                      setCapturedUri('');
                      setEmotionTag((current) => (current === tag ? '' : tag));
                      if (!diaryText.trim()) setDiaryText(tag);
                    }}
                    activeOpacity={0.86}
                  >
                    <Text style={[styles.emotionTagText, isActive && { color: UI.text }]}>{tag}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryAction} onPress={handleCaptureCard} disabled={isSaving} activeOpacity={0.86}>
              <Ionicons name="download-outline" size={20} color={UI.peach} />
              <Text style={styles.secondaryActionText}>저장</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryActionWide} onPress={handleSaveToLibrary} disabled={isSaving} activeOpacity={0.86}>
              <Ionicons name="image-outline" size={20} color={UI.peach} />
              <Text style={styles.secondaryActionText}>사진첩에 저장</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryAction, { backgroundColor: pointColor }]} onPress={handleShare} disabled={isSaving} activeOpacity={0.86}>
              {isSaving ? <ActivityIndicator color="#211817" size="small" /> : <Ionicons name="share-outline" size={21} color="#211817" />}
              <Text style={styles.primaryActionText}>공유하기</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingBottom: 28,
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
    aspectRatio: 3 / 4,
    width: '100%',
    borderRadius: 30,
    overflow: 'hidden',
    padding: 16,
    backgroundColor: '#151013',
    borderWidth: 1.4,
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  cardBlurArtwork: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: '92%',
    height: '92%',
    opacity: 0.38,
  },
  cardColorWash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.82,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardChip: {
    maxWidth: '52%',
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 241, 236, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.24)',
  },
  cardChipText: {
    color: UI.text,
    fontSize: 11,
    fontWeight: '800',
  },
  routePreview: {
    height: 92,
    marginTop: 8,
    marginHorizontal: -2,
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
  cardMetaBlock: {
    marginTop: -2,
  },
  cardDate: {
    color: UI.peach,
    fontSize: 12,
    fontWeight: '800',
  },
  cardPlaceTitle: {
    color: UI.peach,
    fontSize: 22,
    fontWeight: '300',
    marginTop: 6,
  },
  cardPlaceMeta: {
    color: UI.textSoft,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  cardDivider: {
    height: 1,
    marginVertical: 10,
    backgroundColor: 'rgba(255, 201, 184, 0.14)',
  },
  trackBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardArtwork: {
    width: 86,
    height: 86,
    borderRadius: 13,
    borderWidth: 1,
    backgroundColor: '#211817',
  },
  trackTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
  },
  trackArtist: {
    color: UI.textSoft,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 6,
  },
  trackAlbum: {
    color: UI.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  trackProgressRow: {
    minHeight: 22,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playCircle: {
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: UI.peach,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackTime: {
    color: UI.peach,
    fontSize: 11,
    fontWeight: '800',
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 241, 236, 0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    width: '48%',
    height: '100%',
    borderRadius: 2,
  },
  diaryQuote: {
    flex: 1,
    minHeight: 58,
    marginTop: 12,
    paddingHorizontal: 7,
    justifyContent: 'center',
  },
  quoteMark: {
    position: 'absolute',
    left: 0,
    top: -10,
    color: 'rgba(255, 201, 184, 0.18)',
    fontSize: 32,
    fontWeight: '900',
  },
  quoteMarkEnd: {
    position: 'absolute',
    right: 0,
    bottom: -16,
    color: 'rgba(255, 201, 184, 0.14)',
    fontSize: 32,
    fontWeight: '900',
  },
  diaryCardText: {
    color: UI.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  cardFooter: {
    minHeight: 42,
    paddingTop: 10,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: 'rgba(255, 201, 184, 0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  footerBrandIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(5, 7, 10, 0.28)',
  },
  footerTitle: {
    color: UI.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  footerBrand: {
    color: UI.textMuted,
    fontSize: 10,
    marginTop: 4,
  },
  compassButton: {
    marginLeft: 'auto',
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5, 7, 10, 0.34)',
    borderWidth: 1,
    borderColor: UI.border,
    shadowOpacity: 0.45,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 },
  },
  inputPanel: {
    marginTop: 18,
    borderRadius: 22,
    padding: 14,
    backgroundColor: UI.panel,
    borderWidth: 1,
    borderColor: UI.border,
  },
  inputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  inputTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
  },
  inputCount: {
    color: UI.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  diaryInput: {
    minHeight: 98,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: UI.text,
    backgroundColor: 'rgba(5, 7, 10, 0.46)',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.14)',
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  tagScroller: {
    paddingTop: 10,
    gap: 8,
  },
  emotionTag: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: UI.panelSoft,
  },
  emotionTagText: {
    color: UI.textSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  actionRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  secondaryAction: {
    minHeight: 54,
    minWidth: 96,
    borderRadius: 27,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 201, 184, 0.06)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  secondaryActionWide: {
    minHeight: 54,
    minWidth: 136,
    borderRadius: 27,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 201, 184, 0.06)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  secondaryActionText: {
    color: UI.peach,
    fontSize: 14,
    fontWeight: '900',
  },
  primaryAction: {
    flex: 1,
    minHeight: 54,
    borderRadius: 27,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryActionText: {
    color: '#211817',
    fontSize: 14,
    fontWeight: '900',
  },
});
