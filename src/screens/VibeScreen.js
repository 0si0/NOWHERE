import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
import { LocationContext } from '../contexts/LocationContext';
import { PlayerContext } from '../contexts/PlayerContext';
import { useSession } from '../contexts/SessionContext';
import KakaoMusicMap from '../components/KakaoMusicMap';
import { API_KEYS } from '../constants';
import {
  getNearbyShallWeShareRecords,
  hasPostedShallWeShareToday,
  saveShallWeShareRecord,
} from '../services/firebaseService';
import { searchMusicMapTracks } from '../services/musicMapPlaylistService';
import { buildListeningContext, recordListeningEvent } from '../services/listeningHistoryService';

const SHARE_RADIUS_M = 350;
const MESSAGE_MAX_LENGTH = 80;

const UI = {
  bg: '#05070A',
  surface: 'rgba(26, 23, 23, 0.86)',
  surfaceSoft: 'rgba(255, 241, 236, 0.06)',
  border: 'rgba(255, 200, 184, 0.28)',
  text: '#FFF1EC',
  muted: '#AFA09C',
  peach: '#FFC8B8',
  green: '#86E89A',
};

function getTrackKey(track = {}) {
  const safeTrack = track || {};
  return String(safeTrack.spotifyUri || safeTrack.uri || safeTrack.id || `${safeTrack.title || ''}-${safeTrack.artist || ''}`);
}

function normalizeTrack(track = {}) {
  return {
    id: track.id || track.trackId || track.spotifyUri || track.uri || '',
    provider: track.provider || 'spotify',
    spotifyUri: track.spotifyUri || track.uri || '',
    uri: track.spotifyUri || track.uri || '',
    title: track.title || track.name || track.trackName || '',
    artist: track.artist || track.artistName || '',
    album: track.album || track.albumName || '',
    artworkUrl: track.artworkUrl || track.albumArtUrl || '',
    durationMs: track.durationMs || 0,
  };
}

function hasCoordinates(coords = {}) {
  return typeof coords.latitude === 'number' && typeof coords.longitude === 'number';
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) {
    return '근처';
  }
  if (meters < 100) {
    return `${Math.max(10, Math.round(meters / 10) * 10)}m`;
  }
  return `${Math.round(meters)}m`;
}

function formatRelativeTime(value) {
  const timestamp = typeof value?.toDate === 'function'
    ? value.toDate().getTime()
    : new Date(value || Date.now()).getTime();
  if (!Number.isFinite(timestamp)) {
    return '방금';
  }
  const diffMs = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function getShareRecordLocation(share = {}) {
  if (hasCoordinates(share)) {
    return {
      latitude: share.latitude,
      longitude: share.longitude,
    };
  }
  if (hasCoordinates(share.location)) {
    return share.location;
  }
  return null;
}

function TrackRow({ track, selected, onPress, actionLabel = '선택' }) {
  if (!track?.title) {
    return null;
  }

  return (
    <TouchableOpacity
      style={[styles.trackRow, selected && styles.trackRowSelected]}
      activeOpacity={0.86}
      onPress={onPress}
    >
      {track.artworkUrl ? (
        <Image source={{ uri: track.artworkUrl }} style={styles.trackArt} />
      ) : (
        <View style={styles.trackArtFallback}>
          <Ionicons name="musical-notes-outline" size={20} color={UI.peach} />
        </View>
      )}
      <View style={styles.trackTextWrap}>
        <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
        <Text style={styles.trackArtist} numberOfLines={1}>{track.artist || 'Unknown Artist'}</Text>
      </View>
      <Text style={[styles.trackAction, selected && styles.trackActionSelected]}>{selected ? '선택됨' : actionLabel}</Text>
    </TouchableOpacity>
  );
}

export default function VibeScreen({ navigation }) {
  const { authUser } = useSession();
  const { currentTrack, openInSpotify } = useContext(PlayerContext);
  const {
    location,
    placeName,
    weather,
    hasForegroundPermission,
    isLocating,
    requestPermissions,
  } = useContext(LocationContext);

  const [message, setMessage] = useState('');
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPostedToday, setHasPostedToday] = useState(false);
  const [nearbyShares, setNearbyShares] = useState([]);
  const [selectedShareId, setSelectedShareId] = useState('');

  const normalizedCurrentTrack = useMemo(() => {
    const normalized = normalizeTrack(currentTrack || {});
    return normalized.title ? normalized : null;
  }, [currentTrack]);

  const canWrite = Boolean(
    authUser?.uid &&
    !authUser.isAnonymous &&
    !hasPostedToday &&
    hasCoordinates(location)
  );

  const loadShares = useCallback(async () => {
    if (!authUser?.uid || authUser.isAnonymous) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const alreadyPosted = await hasPostedShallWeShareToday(authUser.uid);
      setHasPostedToday(alreadyPosted);
      if (!hasCoordinates(location)) {
        if (!hasForegroundPermission) {
          await requestPermissions();
        }
        setNearbyShares([]);
      } else {
        const shares = await getNearbyShallWeShareRecords({
          userId: authUser.uid,
          latitude: location.latitude,
          longitude: location.longitude,
          radiusMeters: SHARE_RADIUS_M,
        });
        setNearbyShares(shares);
      }
    } catch (error) {
      Alert.alert('Shall We Share', error.message || '주변 기록을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [authUser?.isAnonymous, authUser?.uid, hasForegroundPermission, location, requestPermissions]);

  useEffect(() => {
    loadShares();
  }, [loadShares]);

  useEffect(() => {
    if (!selectedTrack && normalizedCurrentTrack) {
      setSelectedTrack(normalizedCurrentTrack);
    }
  }, [normalizedCurrentTrack, selectedTrack]);

  useEffect(() => {
    if (!selectedShareId) {
      return;
    }
    if (!nearbyShares.some((share) => share.id === selectedShareId)) {
      setSelectedShareId('');
    }
  }, [nearbyShares, selectedShareId]);

  const shareMapRecords = useMemo(() => nearbyShares.map((share) => {
    const locationPoint = getShareRecordLocation(share);
    if (!locationPoint) {
      return null;
    }
    return {
      id: share.id,
      recordType: 'pin',
      albumColor: share.albumColor || UI.peach,
      albumArtUrl: share.albumArtUrl || share.selectedTrack?.artworkUrl || '',
      endAlbumArtUrl: share.albumArtUrl || share.selectedTrack?.artworkUrl || '',
      placeName: share.placeName || placeName || '근처',
      location: locationPoint,
      playedDurationMs: 0,
      recordedAt: share.createdAtIso,
      track: {
        title: share.trackName || share.selectedTrack?.title || '남겨진 음악',
        artist: share.artistName || share.selectedTrack?.artist || '',
        artworkUrl: share.albumArtUrl || share.selectedTrack?.artworkUrl || '',
      },
    };
  }).filter(Boolean), [nearbyShares, placeName]);

  const selectedShare = useMemo(
    () => nearbyShares.find((share) => share.id === selectedShareId) || null,
    [nearbyShares, selectedShareId]
  );

  const handleSearch = async () => {
    const query = searchText.trim();
    if (query.length < 2) {
      Alert.alert('검색어를 입력해주세요', '곡 제목이나 아티스트명을 두 글자 이상 입력해주세요.');
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchMusicMapTracks(query, 12);
      setSearchResults(
        results
          .map(normalizeTrack)
          .filter((track) => track.title && track.artworkUrl && (track.spotifyUri || track.id))
      );
      if (!results.length) {
        Alert.alert('검색 결과 없음', '다른 곡명이나 아티스트명으로 다시 검색해주세요.');
      }
    } catch (error) {
      Alert.alert('곡 검색 실패', error.message || '곡을 검색하지 못했습니다.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSave = async () => {
    if (!authUser?.uid || authUser.isAnonymous) {
      Alert.alert('로그인 필요', 'Shall We Share는 NOWHERE 회원만 남길 수 있습니다.');
      return;
    }
    if (!hasCoordinates(location)) {
      Alert.alert('위치 필요', '현재 위치를 확인한 뒤 다시 시도해주세요.');
      return;
    }
    if (!message.trim()) {
      Alert.alert('한마디를 입력해주세요', '오늘 이 공간에 남길 짧은 문장을 적어주세요.');
      return;
    }
    if (!selectedTrack?.title) {
      Alert.alert('노래를 선택해주세요', '현재 재생곡이나 검색한 곡 중 하나를 선택해주세요.');
      return;
    }

    setIsSaving(true);
    try {
      await saveShallWeShareRecord({
        userId: authUser.uid,
        message: message.trim(),
        track: selectedTrack,
        trackId: selectedTrack.id || selectedTrack.spotifyUri,
        trackName: selectedTrack.title,
        artistName: selectedTrack.artist,
        albumName: selectedTrack.album,
        albumArtUrl: selectedTrack.artworkUrl,
        spotifyUri: selectedTrack.spotifyUri,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      setMessage('');
      setHasPostedToday(true);
      await loadShares();
      Alert.alert('저장 완료', '오늘 이 공간에 음악과 한마디를 남겼습니다.');
    } catch (error) {
      Alert.alert('저장 실패', error.message || 'Shall We Share 기록을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePlayShare = async (share) => {
    const track = normalizeTrack({
      id: share.trackId,
      spotifyUri: share.spotifyUri || share.selectedTrack?.spotifyUri,
      title: share.trackName,
      artist: share.artistName,
      album: share.albumName,
      artworkUrl: share.albumArtUrl,
    });
    try {
      await openInSpotify(track, [track]);
      recordListeningEvent({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        track,
        source: 'shall-we-share',
        recommendationSlot: 'shall-we-share',
        context: buildListeningContext({
          location,
          weather,
          place: placeName ? { name: placeName } : null,
        }),
      }).catch(() => {});
    } catch (error) {
      Alert.alert('Spotify 실행 실패', error.message || 'Spotify에서 곡을 열지 못했습니다.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>SHALL WE SHARE</Text>
            <Text style={styles.title}>이 공간에 남기는 음악</Text>
            <Text style={styles.subtitle}>
              {placeName || '현재 위치'} · 반경 {SHARE_RADIUS_M}m
            </Text>
          </View>
          <TouchableOpacity style={styles.closeButton} activeOpacity={0.86} onPress={() => navigation.goBack()}>
            <Ionicons name="close-outline" size={28} color={UI.peach} />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {!authUser?.uid || authUser.isAnonymous ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>로그인이 필요합니다</Text>
              <Text style={styles.noticeText}>공간에 음악을 남기는 기능은 NOWHERE 회원 계정으로만 사용할 수 있습니다.</Text>
            </View>
          ) : null}

          <View style={styles.composeCard}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardLabel}>오늘 이곳에 남기고 싶은 한마디</Text>
              <Text style={styles.counter}>{message.length}/{MESSAGE_MAX_LENGTH}</Text>
            </View>
            <TextInput
              value={message}
              onChangeText={(value) => setMessage(value.slice(0, MESSAGE_MAX_LENGTH))}
              placeholder={hasPostedToday ? '오늘은 이미 이 공간에 음악을 남겼어요' : '짧게 남겨주세요'}
              placeholderTextColor="rgba(255,241,236,0.34)"
              editable={canWrite && !isSaving}
              multiline
              style={styles.messageInput}
            />

            <Text style={styles.cardLabel}>함께 남길 노래 선택</Text>
            {normalizedCurrentTrack ? (
              <TrackRow
                track={normalizedCurrentTrack}
                selected={getTrackKey(selectedTrack) === getTrackKey(normalizedCurrentTrack)}
                actionLabel="현재곡"
                onPress={() => setSelectedTrack(normalizedCurrentTrack)}
              />
            ) : (
              <View style={styles.emptyTrackBox}>
                <Ionicons name="musical-notes-outline" size={22} color={UI.muted} />
                <Text style={styles.emptyTrackText}>현재 재생곡이 없으면 검색으로 선택할 수 있습니다.</Text>
              </View>
            )}

            <View style={styles.searchRow}>
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder="곡 제목 또는 아티스트 검색"
                placeholderTextColor="rgba(255,241,236,0.34)"
                returnKeyType="search"
                onSubmitEditing={handleSearch}
                style={styles.searchInput}
              />
              <TouchableOpacity style={styles.searchButton} activeOpacity={0.86} onPress={handleSearch} disabled={isSearching}>
                {isSearching ? (
                  <ActivityIndicator color="#17110F" size="small" />
                ) : (
                  <Ionicons name="search-outline" size={20} color="#17110F" />
                )}
              </TouchableOpacity>
            </View>

            {searchResults.map((track) => (
              <TrackRow
                key={getTrackKey(track)}
                track={track}
                selected={getTrackKey(selectedTrack) === getTrackKey(track)}
                onPress={() => setSelectedTrack(track)}
              />
            ))}

            <TouchableOpacity
              style={[styles.saveButton, (!canWrite || isSaving) && styles.saveButtonDisabled]}
              activeOpacity={0.88}
              onPress={handleSave}
              disabled={!canWrite || isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#17110F" />
              ) : (
                <>
                  <Ionicons name="location-outline" size={20} color="#17110F" />
                  <Text style={styles.saveButtonText}>이 장소에 남기기</Text>
                </>
              )}
            </TouchableOpacity>
            {hasPostedToday ? (
              <Text style={styles.statusText}>오늘은 이미 이 공간에 음악을 남겼어요.</Text>
            ) : null}
            {!hasCoordinates(location) && !isLocating ? (
              <TouchableOpacity style={styles.permissionButton} activeOpacity={0.86} onPress={requestPermissions}>
                <Text style={styles.permissionButtonText}>위치 권한 확인</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>근처에 남겨진 음악</Text>
            <TouchableOpacity activeOpacity={0.78} onPress={loadShares}>
              <Text style={styles.refreshText}>새로고침</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.shareMapCard}>
            <View style={styles.shareMapHeader}>
              <View>
                <Text style={styles.shareMapTitle}>주변 음악 지도</Text>
                <Text style={styles.shareMapSubtitle}>현재 위치 기준 반경 {SHARE_RADIUS_M}m</Text>
              </View>
              <View style={styles.shareMapCountPill}>
                <Text style={styles.shareMapCountText}>{nearbyShares.length}개</Text>
              </View>
            </View>
            {hasCoordinates(location) ? (
              <View style={styles.shareMapFrame}>
                <KakaoMusicMap
                  apiKey={API_KEYS.KAKAO_MAPS}
                  baseUrl={API_KEYS.KAKAO_MAPS_BASE_URL}
                  center={location}
                  records={shareMapRecords}
                  mode="pin"
                  selectedRecordId={selectedShareId}
                  onRecordPress={setSelectedShareId}
                  height={260}
                  shouldFitRecords={false}
                  fixedCenter
                  disableGestures
                  shouldFocusSelectedRecord={false}
                />
                <View pointerEvents="none" style={styles.currentLocationMarker}>
                  <View style={styles.currentLocationPulse} />
                  <View style={styles.currentLocationDot} />
                </View>
              </View>
            ) : (
              <View style={styles.mapEmptyBox}>
                <Ionicons name="location-outline" size={24} color={UI.muted} />
                <Text style={styles.mapEmptyText}>현재 위치를 확인하면 주변 음악 지도가 열립니다.</Text>
              </View>
            )}
            {selectedShare ? (
              <View style={styles.selectedSharePanel}>
                <View style={styles.selectedShareTextWrap}>
                  <Text style={styles.selectedShareMessage}>{selectedShare.message}</Text>
                  <Text style={styles.selectedShareTrack} numberOfLines={1}>
                    {selectedShare.trackName} · {selectedShare.artistName}
                  </Text>
                  <Text style={styles.selectedShareMeta} numberOfLines={1}>
                    {formatDistance(selectedShare.distanceMeters)} · {formatRelativeTime(selectedShare.createdAt || selectedShare.createdAtIso)}
                  </Text>
                </View>
                <TouchableOpacity style={styles.selectedSharePlayButton} activeOpacity={0.86} onPress={() => handlePlayShare(selectedShare)}>
                  <Ionicons name="play" size={17} color="#17110F" />
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.mapHintText}>앨범표지 원을 누르면 그 사람이 남긴 한마디가 보입니다.</Text>
            )}
          </View>

          {isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={UI.peach} />
              <Text style={styles.loadingText}>이 공간의 음악을 찾고 있습니다.</Text>
            </View>
          ) : nearbyShares.length ? (
            nearbyShares.map((share) => (
              <TouchableOpacity
                key={share.id}
                style={[styles.shareCard, selectedShareId === share.id && styles.shareCardSelected]}
                activeOpacity={0.86}
                onPress={() => setSelectedShareId(share.id)}
              >
                <View style={styles.shareTopRow}>
                  {share.albumArtUrl ? (
                    <Image source={{ uri: share.albumArtUrl }} style={styles.shareArt} />
                  ) : (
                    <View style={styles.shareArtFallback}>
                      <Ionicons name="musical-notes-outline" size={22} color={UI.peach} />
                    </View>
                  )}
                  <View style={styles.shareInfo}>
                    <Text style={styles.shareMessage}>{share.message}</Text>
                    <Text style={styles.shareTrack} numberOfLines={1}>{share.trackName}</Text>
                    <Text style={styles.shareMeta} numberOfLines={1}>
                      {share.artistName} · {formatDistance(share.distanceMeters)} · {formatRelativeTime(share.createdAt || share.createdAtIso)}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.sharePlayButton} activeOpacity={0.86} onPress={() => handlePlayShare(share)}>
                    <Ionicons name="play" size={18} color="#17110F" />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>아직 근처에 남겨진 음악이 없습니다</Text>
              <Text style={styles.emptyText}>오늘 이 공간의 첫 번째 음악을 남겨보세요.</Text>
            </View>
          )}

          <Text style={styles.privacyText}>
            정확한 위치는 저장하지 않고 약 100m 단위로 흐리게 처리합니다. 가까운 반경 안에서만 기록이 보입니다.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI.bg },
  keyboard: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: UI.border,
  },
  eyebrow: {
    color: UI.peach,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
  },
  title: {
    color: UI.text,
    fontSize: 25,
    fontWeight: '900',
    marginTop: 8,
  },
  subtitle: {
    color: UI.muted,
    fontSize: 13,
    marginTop: 5,
  },
  closeButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: UI.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.surfaceSoft,
  },
  scroll: {
    padding: 20,
    paddingBottom: 42,
  },
  noticeCard: {
    borderWidth: 1,
    borderColor: 'rgba(255, 121, 121, 0.38)',
    backgroundColor: 'rgba(255, 121, 121, 0.08)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  noticeTitle: { color: UI.text, fontSize: 16, fontWeight: '900' },
  noticeText: { color: UI.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  composeCard: {
    borderWidth: 1,
    borderColor: UI.border,
    borderRadius: 24,
    padding: 16,
    backgroundColor: UI.surface,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLabel: {
    color: UI.text,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 10,
  },
  counter: {
    color: UI.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  messageInput: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: UI.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: UI.text,
    fontSize: 16,
    lineHeight: 22,
    backgroundColor: 'rgba(0,0,0,0.22)',
    textAlignVertical: 'top',
    marginBottom: 18,
  },
  trackRow: {
    minHeight: 68,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
  },
  trackRowSelected: {
    borderColor: UI.peach,
    backgroundColor: 'rgba(255, 200, 184, 0.10)',
  },
  trackArt: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  trackArtFallback: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  trackTextWrap: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  trackTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
  },
  trackArtist: {
    color: UI.muted,
    fontSize: 13,
    marginTop: 4,
  },
  trackAction: {
    color: UI.muted,
    fontSize: 12,
    fontWeight: '900',
    marginLeft: 8,
  },
  trackActionSelected: { color: UI.peach },
  emptyTrackBox: {
    minHeight: 62,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
    marginBottom: 10,
  },
  emptyTrackText: {
    flex: 1,
    color: UI.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI.border,
    paddingHorizontal: 16,
    color: UI.text,
    fontSize: 15,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  searchButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: UI.peach,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    minHeight: 58,
    borderRadius: 999,
    backgroundColor: UI.peach,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.42,
  },
  saveButtonText: {
    color: '#17110F',
    fontSize: 16,
    fontWeight: '900',
  },
  statusText: {
    color: UI.peach,
    textAlign: 'center',
    fontSize: 13,
    marginTop: 12,
    lineHeight: 19,
  },
  permissionButton: {
    minHeight: 46,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  permissionButtonText: {
    color: UI.peach,
    fontSize: 14,
    fontWeight: '900',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    color: UI.text,
    fontSize: 18,
    fontWeight: '900',
  },
  refreshText: {
    color: UI.peach,
    fontSize: 13,
    fontWeight: '900',
  },
  shareMapCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: UI.surface,
    overflow: 'hidden',
    marginBottom: 14,
  },
  shareMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 12,
  },
  shareMapTitle: {
    color: UI.text,
    fontSize: 16,
    fontWeight: '900',
  },
  shareMapSubtitle: {
    color: UI.muted,
    fontSize: 12,
    marginTop: 4,
  },
  shareMapCountPill: {
    minWidth: 48,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 200, 184, 0.09)',
  },
  shareMapCountText: {
    color: UI.peach,
    fontSize: 12,
    fontWeight: '900',
  },
  shareMapFrame: {
    height: 260,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 200, 184, 0.16)',
    overflow: 'hidden',
    backgroundColor: '#05070A',
    position: 'relative',
  },
  currentLocationMarker: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationPulse: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(134, 232, 154, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(134, 232, 154, 0.38)',
  },
  currentLocationDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: UI.green,
    borderWidth: 2,
    borderColor: '#05070A',
  },
  mapEmptyBox: {
    minHeight: 160,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 200, 184, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  mapEmptyText: {
    color: UI.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 18,
    lineHeight: 19,
  },
  selectedSharePanel: {
    margin: 14,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI.peach,
    backgroundColor: 'rgba(255, 200, 184, 0.10)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectedShareTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  selectedShareMessage: {
    color: UI.text,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
  },
  selectedShareTrack: {
    color: UI.peach,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 7,
  },
  selectedShareMeta: {
    color: UI.muted,
    fontSize: 12,
    marginTop: 4,
  },
  selectedSharePlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: UI.peach,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  mapHintText: {
    color: UI.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  loadingBox: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: UI.surfaceSoft,
    padding: 18,
    alignItems: 'center',
  },
  loadingText: {
    color: UI.muted,
    fontSize: 13,
    marginTop: 8,
  },
  shareCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: UI.surface,
    padding: 12,
    marginBottom: 10,
  },
  shareCardSelected: {
    borderColor: UI.peach,
    backgroundColor: 'rgba(255, 200, 184, 0.09)',
  },
  shareTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shareArt: {
    width: 58,
    height: 58,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  shareArtFallback: {
    width: 58,
    height: 58,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  shareInfo: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  shareMessage: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 6,
  },
  shareTrack: {
    color: UI.peach,
    fontSize: 14,
    fontWeight: '800',
  },
  shareMeta: {
    color: UI.muted,
    fontSize: 12,
    marginTop: 4,
  },
  sharePlayButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: UI.peach,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  emptyBox: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: UI.surfaceSoft,
    padding: 18,
  },
  emptyTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyText: {
    color: UI.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  privacyText: {
    color: UI.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 18,
  },
});
