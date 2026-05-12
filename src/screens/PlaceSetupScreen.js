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
import KakaoPlacePicker from '../components/KakaoPlacePicker';
import { API_KEYS, MAX_AUTOPLAY_PLACES, RADIUS_OPTIONS } from '../constants';
import { LocationContext } from '../contexts/LocationContext';
import { useSession } from '../contexts/SessionContext';
import {
  getOrCreateAppUserId,
  getSavedPlaces,
  saveSavedPlace,
  updateSavedPlace,
} from '../services/firebaseService';
import { loadMusicMapTrackPlaylists } from '../services/musicMapPlaylistService';
import { musicPlayerService } from '../services/musicPlayerService';

const EMPTY_ARTWORK = require('../../assets/EmptyMark.png');
const DEFAULT_MAP_CENTER = {
  latitude: 37.5665,
  longitude: 126.978,
};

const UI = {
  bg: '#05070A',
  surface: 'rgba(22, 22, 22, 0.74)',
  surfaceStrong: 'rgba(37, 32, 30, 0.82)',
  surfaceSoft: 'rgba(255, 201, 184, 0.08)',
  border: 'rgba(255, 201, 184, 0.22)',
  borderStrong: 'rgba(255, 201, 184, 0.58)',
  text: '#FFF1EC',
  textSoft: '#D8C5BE',
  textMuted: '#948985',
  peach: '#FFC8B8',
  peachStrong: '#FFB09E',
  amber: '#F7A94D',
};

function getSpotifyDataMessage(error, fallback = 'Spotify 요청에 실패했습니다.') {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('forbidden') || message.includes('403')) {
    return 'Spotify에서 현재 데이터를 허용하지 않았습니다. 앱은 계속 사용할 수 있으며 잠시 후 다시 시도해주세요.';
  }
  return error?.message || fallback;
}

function shouldRetryWithSpotifyPermission(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('authorization') ||
    message.includes('scope') ||
    message.includes('forbidden') ||
    message.includes('403') ||
    message.includes('401') ||
    message.includes('spotify 권한');
}

function formatTimestamp(value) {
  if (!value) {
    return '방금 전';
  }

  const date = typeof value.toDate === 'function'
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '방금 전';
  }

  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizePlayTargetForForm(track = {}) {
  const title = track.title || track.name || track.playlist?.title || '';
  const type = track.type === 'playlist' ? 'playlist' : 'track';
  const tracks = Array.isArray(track.tracks) ? track.tracks : [];
  const artist = track.artist || track.artistName || track.ownerName || '';
  const spotifyUri = track.spotifyUri || track.uri || track.playlist?.playlistId || '';

  if (!title && !spotifyUri) {
    return null;
  }

  return {
    type,
    provider: track.provider || (tracks.length ? 'nowhere' : 'spotify'),
    id: track.id || spotifyUri || `${title}-${artist}`,
    spotifyUri,
    title: title || (type === 'playlist' ? '선택한 플레이리스트' : '선택한 곡'),
    artist: artist || (type === 'playlist' ? '' : 'Unknown Artist'),
    album: track.album || '',
    artworkUrl: track.artworkUrl || track.albumArtUrl || track.playlist?.artworkUrl || '',
    durationMs: track.durationMs || 0,
    trackCount: track.trackCount || tracks.length || 0,
    ownerName: track.ownerName || (tracks.length ? 'NOWHERE' : ''),
    tracks,
  };
}

function normalizeInternalPlaylistForForm(playlist = {}) {
  const tracks = Array.isArray(playlist.tracks) ? playlist.tracks.filter(Boolean) : [];
  const firstTrack = tracks[0] || {};
  return normalizePlayTargetForForm({
    type: 'playlist',
    provider: 'nowhere',
    id: playlist.id,
    title: playlist.name || '뮤직지도 플레이리스트',
    ownerName: 'NOWHERE',
    artworkUrl: firstTrack.artworkUrl || firstTrack.albumArtUrl || '',
    trackCount: tracks.length,
    tracks,
  });
}

function TrackArtwork({ track, size = 48 }) {
  const source = track?.artworkUrl ? { uri: track.artworkUrl } : EMPTY_ARTWORK;
  return <Image source={source} style={{ width: size, height: size, borderRadius: 10 }} />;
}

function TrackResultCard({ track, isSelected, onPress }) {
  const isPlaylist = track.type === 'playlist';
  return (
    <TouchableOpacity
      onPress={() => onPress(track)}
      style={[styles.trackCard, isSelected && styles.trackCardSelected]}
    >
      <TrackArtwork track={track} />
      <View style={styles.trackTextBox}>
        <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
        <Text style={styles.trackArtist} numberOfLines={1}>
          {isPlaylist
            ? `${track.ownerName || track.artist || '플레이리스트'}${track.trackCount ? ` · ${track.trackCount}곡` : ''}`
            : track.artist}
        </Text>
      </View>
      <View style={[styles.selectDot, isSelected && styles.selectDotActive]} />
    </TouchableOpacity>
  );
}

function SavedPlaceCard({ place, onLoad }) {
  const track = normalizePlayTargetForForm(place.playTarget || place);
  const label = track
    ? `${track.type === 'playlist' ? '플레이리스트' : '곡'} · ${track.title}${track.artist ? ` · ${track.artist}` : ''}`
    : '연결된 음악 없음';

  return (
    <View style={styles.savedPlaceCard}>
      <View style={styles.savedPlaceHeader}>
        <TrackArtwork track={track} size={44} />
        <View style={styles.savedPlaceInfo}>
          <Text style={styles.savedPlaceTitle} numberOfLines={1}>{place.name}</Text>
          <Text style={styles.savedPlaceSub} numberOfLines={1}>{label}</Text>
          <Text style={styles.savedPlaceMeta}>{place.radiusMeters}m 반경에서 자동재생</Text>
        </View>
      </View>
      <Text style={styles.savedPlaceMeta}>업데이트 {formatTimestamp(place.updatedAt)}</Text>
      <View style={styles.savedPlaceActions}>
        <TouchableOpacity style={styles.savedActionPrimary} onPress={() => onLoad(place)}>
          <Text style={styles.savedActionPrimaryText}>수정</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function PlaceSetupScreen({ navigation }) {
  const {
    location,
    hasForegroundPermission,
    hasBackgroundPermission,
    isLocating,
    backgroundTrackingEnabled,
    requestPermissions,
    reloadAutoPlayPlaces,
    startBackgroundTracking,
    locationError,
  } = useContext(LocationContext);
  const { authUser, isLoading, isFirebaseConfigured, missingConfigKeys } = useSession();

  const currentOrDefaultCoords = useMemo(() => (
    location
      ? { latitude: location.latitude, longitude: location.longitude }
      : DEFAULT_MAP_CENTER
  ), [location]);

  const [placeName, setPlaceName] = useState('');
  const [selectedCoordinates, setSelectedCoordinates] = useState(currentOrDefaultCoords);
  const [selectedRadius, setSelectedRadius] = useState(50);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [targetMode, setTargetMode] = useState('track');
  const [trackQuery, setTrackQuery] = useState('');
  const [trackResults, setTrackResults] = useState([]);
  const [isSearchingTracks, setIsSearchingTracks] = useState(false);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSavedPlaces, setIsLoadingSavedPlaces] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [editingPlaceId, setEditingPlaceId] = useState(null);

  const activePlaces = useMemo(
    () => savedPlaces.filter((place) => place.status !== 'archived'),
    [savedPlaces]
  );

  const resolveOwnerId = useCallback(async () => {
    if (!isFirebaseConfigured || authUser?.isAnonymous) {
      return getOrCreateAppUserId();
    }

    if (authUser?.uid) {
      return authUser.uid;
    }

    return getOrCreateAppUserId();
  }, [authUser?.isAnonymous, authUser?.uid, isFirebaseConfigured]);

  useEffect(() => {
    if (!location || editingPlaceId) {
      return;
    }

    setSelectedCoordinates((prev) => (
      prev === DEFAULT_MAP_CENTER
        ? { latitude: location.latitude, longitude: location.longitude }
        : prev
    ));
  }, [editingPlaceId, location]);

  const resetForm = useCallback(() => {
    setEditingPlaceId(null);
    setPlaceName('');
    setSelectedRadius(50);
    setSelectedTrack(null);
    setTargetMode('track');
    setTrackQuery('');
    setTrackResults([]);
    setSelectedCoordinates(currentOrDefaultCoords);
  }, [currentOrDefaultCoords]);

  const loadSavedPlaces = useCallback(async () => {
    if (isFirebaseConfigured && isLoading) {
      return;
    }

    setIsLoadingSavedPlaces(true);
    try {
      const ownerId = await resolveOwnerId();
      const places = await getSavedPlaces(ownerId);
      setSavedPlaces(places);
    } catch (error) {
      Alert.alert('수정 준비 실패', error.message || '저장된 장소를 수정할 수 없습니다.');
    } finally {
      setIsLoadingSavedPlaces(false);
    }
  }, [isFirebaseConfigured, isLoading, resolveOwnerId]);

  useEffect(() => {
    loadSavedPlaces();
  }, [loadSavedPlaces]);

  const handleSearchTracks = async () => {
    const query = trackQuery.trim();
    if (!query) {
      Alert.alert('검색어를 입력해주세요', '곡 제목이나 아티스트명을 입력하면 Spotify에서 검색합니다.');
      return;
    }

    try {
      setIsSearchingTracks(true);
      const results = await musicPlayerService.search(query, 10);
      setTrackResults(results.map(normalizePlayTargetForForm).filter(Boolean));
      if (results.length === 0) {
        Alert.alert('검색 결과 없음', '다른 곡명이나 아티스트명으로 다시 검색해주세요.');
      }
    } catch (error) {
      Alert.alert('Spotify 검색 실패', getSpotifyDataMessage(error, 'Spotify 곡 검색에 실패했습니다.'));
    } finally {
      setIsSearchingTracks(false);
    }
  };

  const handleLoadPlaylists = async () => {
    try {
      setIsLoadingPlaylists(true);
      const playlists = await loadMusicMapTrackPlaylists();
      const normalizedPlaylists = playlists
        .filter((playlist) => Array.isArray(playlist.tracks) && playlist.tracks.length > 0)
        .map(normalizeInternalPlaylistForForm)
        .filter(Boolean);
      setTargetMode('playlist');
      setTrackResults(normalizedPlaylists);
      if (normalizedPlaylists.length === 0) {
        Alert.alert('플레이리스트 없음', '뮤직지도에서 먼저 트랙 플레이리스트를 만들어주세요.');
      }
    } catch (error) {
      Alert.alert(
        '플레이리스트 가져오기 실패',
        error.message || '뮤직지도 플레이리스트를 불러오지 못했습니다.'
      );
    } finally {
      setIsLoadingPlaylists(false);
    }
  };

  const handleSelectCurrentLocation = () => {
    if (!location) {
      Alert.alert('현재 위치 없음', '위치 권한을 허용하고 현재 위치를 먼저 불러와주세요.');
      return;
    }

    setSelectedCoordinates({
      latitude: location.latitude,
      longitude: location.longitude,
    });
  };

  const buildPlacePayload = useCallback((userId) => {
    const playTarget = normalizePlayTargetForForm(selectedTrack);

    return {
      userId,
      name: placeName,
      latitude: selectedCoordinates.latitude,
      longitude: selectedCoordinates.longitude,
      radiusMeters: selectedRadius,
      playTarget,
      playlist: playTarget
        ? {
          provider: 'spotify',
          playlistId: playTarget.spotifyUri || playTarget.id,
          title: `${playTarget.title}${playTarget.artist ? ` - ${playTarget.artist}` : ''}`,
          artworkUrl: playTarget.artworkUrl,
        }
        : {},
      weatherRules: [],
      timeRules: [],
      source: 'place-autoplay-setup',
    };
  }, [placeName, selectedCoordinates, selectedRadius, selectedTrack]);

  const applyPlaceToForm = useCallback((place) => {
    setEditingPlaceId(place.id);
    setPlaceName(place.name || '');
    setSelectedRadius(place.radiusMeters || 50);
    setSelectedCoordinates({
      latitude: place.coordinates?.latitude ?? DEFAULT_MAP_CENTER.latitude,
      longitude: place.coordinates?.longitude ?? DEFAULT_MAP_CENTER.longitude,
    });
    const track = normalizePlayTargetForForm(place.playTarget || place);
    setSelectedTrack(track);
    setTargetMode(track?.type || 'track');
    setTrackQuery(track?.type === 'playlist' ? '' : track ? `${track.title} ${track.artist}`.trim() : '');
    setTrackResults(track ? [track] : []);
  }, []);

  const handleSave = async () => {
    if (!placeName.trim()) {
      Alert.alert('장소 이름을 입력해주세요');
      return;
    }

    if (!selectedCoordinates) {
      Alert.alert('장소를 선택해주세요', '지도에서 자동재생할 장소를 먼저 선택해야 합니다.');
      return;
    }

    if (!selectedTrack) {
      Alert.alert('재생할 음악을 선택해주세요', '이 장소에 도착했을 때 Spotify로 열 곡 또는 플레이리스트를 선택해야 합니다.');
      return;
    }

    if (!editingPlaceId && activePlaces.length >= MAX_AUTOPLAY_PLACES) {
      Alert.alert('저장 제한', `자동재생 장소는 한 사람당 최대 ${MAX_AUTOPLAY_PLACES}개까지 저장할 수 있습니다.`);
      return;
    }

    try {
      setIsSaving(true);
      const ownerId = await resolveOwnerId();
      const payload = buildPlacePayload(ownerId);

      if (editingPlaceId) {
        await updateSavedPlace(editingPlaceId, payload);
      } else {
        await saveSavedPlace(payload);
      }

      await loadSavedPlaces();
      if (!backgroundTrackingEnabled) {
        await startBackgroundTracking().catch(() => null);
      }
      await reloadAutoPlayPlaces?.();

      Alert.alert(
        editingPlaceId ? '수정 완료' : '저장 완료',
        `"${placeName}"에 도착하면 "${selectedTrack.title}"을 Spotify에서 엽니다.${isFirebaseConfigured ? '' : '\n현재는 기기 내부에 임시 저장 중이에요.'}`,
        [{ text: '확인' }]
      );

      resetForm();
    } catch (error) {
      Alert.alert(
        '저장 실패',
        error.message || '장소 저장 중 문제가 발생했습니다. Firebase 익명 인증 설정을 확인해주세요.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestLocation = async () => {
    try {
      await requestPermissions();
    } catch (error) {
      Alert.alert('권한 요청 실패', error.message || '위치 권한을 불러오지 못했습니다.');
    }
  };

  const handleEnableBackground = async () => {
    try {
      const enabled = await startBackgroundTracking();
      if (!enabled) {
        Alert.alert('권한 필요', '백그라운드 위치 권한이 허용되어야 감지를 시작할 수 있어요.');
      }
    } catch (error) {
      Alert.alert('감지 시작 실패', error.message || '백그라운드 위치 감지를 시작하지 못했습니다.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>장소 자동재생</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>1. 장소 선택</Text>
          </View>
          <KakaoPlacePicker
            apiKey={API_KEYS.KAKAO_MAPS}
            baseUrl={API_KEYS.KAKAO_MAPS_BASE_URL}
            center={selectedCoordinates}
            radiusMeters={selectedRadius}
            onSelect={setSelectedCoordinates}
            onMoveToCurrentLocation={handleSelectCurrentLocation}
          />
          <View style={styles.permissionRow}>
            {!hasForegroundPermission && (
              <TouchableOpacity style={styles.permissionButton} onPress={handleRequestLocation} disabled={isLocating}>
                <Text style={styles.permissionButtonText}>{isLocating ? '확인 중...' : '위치 권한 허용'}</Text>
              </TouchableOpacity>
            )}
            {hasForegroundPermission && !backgroundTrackingEnabled && (
              <TouchableOpacity style={styles.permissionGhostButton} onPress={handleEnableBackground}>
                <Text style={styles.permissionGhostButtonText}>
                  {hasBackgroundPermission ? '백그라운드 감지 시작' : '백그라운드 권한 요청'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
        </View>

        {!isFirebaseConfigured && (
          <View style={styles.localModeBanner}>
            <Text style={styles.localModeTitle}>로컬 저장 모드</Text>
            <Text style={styles.localModeText}>
              Firebase 설정 전까지 저장한 장소는 이 기기 안에만 임시 저장됩니다.
            </Text>
            <Text style={styles.localModeHint}>
              아직 비어 있는 Firebase 키: {missingConfigKeys.join(', ')}
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. 장소 이름과 반경</Text>
          <TextInput
            value={placeName}
            onChangeText={setPlaceName}
            placeholder="예: 성수동 카페, 학교 정문, 퇴근 버스정류장"
            placeholderTextColor={UI.textMuted}
            style={styles.input}
          />
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map((radius) => (
              <TouchableOpacity
                key={radius}
                onPress={() => setSelectedRadius(radius)}
                style={[styles.radiusBtn, selectedRadius === radius && styles.radiusBtnActive]}
              >
                <Text style={[styles.radiusBtnText, selectedRadius === radius && styles.radiusBtnTextActive]}>
                  {radius}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. 자동재생 음악 선택</Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeButton, targetMode === 'track' && styles.modeButtonActive]}
              onPress={() => {
                setTargetMode('track');
                setTrackResults([]);
              }}
            >
              <Ionicons
                name="musical-notes-outline"
                size={16}
                color={targetMode === 'track' ? UI.text : UI.textMuted}
              />
              <Text style={[styles.modeButtonText, targetMode === 'track' && styles.modeButtonTextActive]}>곡 검색</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeButton, targetMode === 'playlist' && styles.modeButtonActive]}
              onPress={handleLoadPlaylists}
              disabled={isLoadingPlaylists}
            >
              <Ionicons
                name="list-outline"
                size={18}
                color={targetMode === 'playlist' ? UI.text : UI.textMuted}
              />
              <Text style={[styles.modeButtonText, targetMode === 'playlist' && styles.modeButtonTextActive]}>
                {isLoadingPlaylists ? '불러오는 중' : '내 플레이리스트'}
              </Text>
            </TouchableOpacity>
          </View>
          {targetMode === 'track' && (
            <View style={styles.searchRow}>
              <TextInput
                value={trackQuery}
                onChangeText={setTrackQuery}
                placeholder="곡 제목 또는 아티스트 검색"
                placeholderTextColor={UI.textMuted}
                style={styles.searchInput}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={handleSearchTracks}
              />
              <TouchableOpacity
                style={[styles.searchButton, isSearchingTracks && styles.searchButtonDisabled]}
                onPress={handleSearchTracks}
                disabled={isSearchingTracks}
              >
                <Text style={styles.searchButtonText}>{isSearchingTracks ? '검색중' : '검색'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {selectedTrack ? (
            <View style={styles.selectedTrackBox}>
              <TrackArtwork track={selectedTrack} size={54} />
              <View style={styles.trackTextBox}>
                <Text style={styles.selectedLabel}>
                  선택된 자동재생 {selectedTrack.type === 'playlist' ? '플레이리스트' : '곡'}
                </Text>
                <Text style={styles.trackTitle} numberOfLines={1}>{selectedTrack.title}</Text>
                <Text style={styles.trackArtist} numberOfLines={1}>
                  {selectedTrack.type === 'playlist'
                    ? `${selectedTrack.ownerName || selectedTrack.artist || '플레이리스트'}${selectedTrack.trackCount ? ` · ${selectedTrack.trackCount}곡` : ''}`
                    : selectedTrack.artist}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.helperText}>이 장소에 도착했을 때 Spotify 앱으로 열 곡 또는 NOWHERE 플레이리스트를 선택하세요.</Text>
          )}

          {trackResults.map((track) => (
            <TrackResultCard
              key={track.spotifyUri || track.id}
              track={track}
              isSelected={(selectedTrack?.spotifyUri || selectedTrack?.id) === (track.spotifyUri || track.id)}
              onPress={(item) => setSelectedTrack(normalizePlayTargetForForm(item))}
            />
          ))}
        </View>

        <View style={styles.formActions}>
          <TouchableOpacity
            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            <Text style={styles.saveBtnText}>
              {isSaving ? '저장 중...' : editingPlaceId ? '자동재생 수정하기' : '자동재생 저장하기'}
            </Text>
          </TouchableOpacity>
          {editingPlaceId && (
            <TouchableOpacity style={styles.cancelBtn} onPress={resetForm}>
              <Text style={styles.cancelBtnText}>새 장소 등록으로 돌아가기</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.savedPlacesSection}>
          <View style={styles.savedPlacesHeader}>
            <Text style={styles.savedPlacesTitle}>저장된 자동재생 장소</Text>
            <TouchableOpacity onPress={loadSavedPlaces}>
              <Text style={styles.savedPlacesRefresh}>새로고침</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.limitNotice}>
            자동재생 설정은 한 사람당 최대 {MAX_AUTOPLAY_PLACES}개까지 저장할 수 있습니다. 현재 {activePlaces.length}/{MAX_AUTOPLAY_PLACES}
          </Text>
          {isLoadingSavedPlaces ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={UI.peach} />
              <Text style={styles.loadingText}>저장된 장소를 불러오는 중...</Text>
            </View>
          ) : activePlaces.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>아직 저장한 장소가 없어요. 지도에서 장소를 고르고 곡을 연결해보세요.</Text>
            </View>
          ) : (
            activePlaces.map((place) => (
              <SavedPlaceCard
                key={place.id}
                place={place}
                onLoad={applyPlaceToForm}
              />
            ))
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.10)',
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  backText: { color: UI.peach, fontSize: 30, fontWeight: '300' },
  title: { color: UI.text, fontSize: 19, fontWeight: '800' },
  keyboardAvoider: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 180 },
  section: { marginBottom: 26 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  sectionTitle: { color: UI.peach, fontSize: 19, fontWeight: '900', marginBottom: 14 },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 18,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.border,
    color: UI.text,
    fontSize: 15,
    marginBottom: 14,
  },
  permissionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  permissionButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: UI.peach,
  },
  permissionButtonText: { color: '#211817', fontSize: 13, fontWeight: '900' },
  permissionGhostButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.borderStrong,
  },
  permissionGhostButtonText: { color: UI.peach, fontSize: 13, fontWeight: '900' },
  errorText: { color: '#FF7777', fontSize: 12, marginTop: 10, lineHeight: 18 },
  localModeBanner: {
    padding: 15,
    borderRadius: 18,
    backgroundColor: 'rgba(247, 169, 77, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(247, 169, 77, 0.45)',
    marginBottom: 22,
  },
  localModeTitle: { color: UI.amber, fontSize: 14, fontWeight: '800' },
  localModeText: { color: UI.textSoft, fontSize: 12, lineHeight: 18, marginTop: 7 },
  localModeHint: { color: UI.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  radiusRow: { flexDirection: 'row', gap: 10 },
  radiusBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusBtnActive: {
    backgroundColor: 'rgba(255, 201, 184, 0.28)',
    borderColor: UI.borderStrong,
    shadowColor: UI.peachStrong,
    shadowOpacity: 0.34,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 4 },
  },
  radiusBtnText: { color: UI.textMuted, fontSize: 15, fontWeight: '800' },
  radiusBtnTextActive: { color: UI.text },
  modeRow: {
    flexDirection: 'row',
    gap: 0,
    marginBottom: 13,
    padding: 4,
    borderRadius: 18,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.border,
  },
  modeButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  modeButtonActive: {
    backgroundColor: 'rgba(255, 201, 184, 0.34)',
    borderWidth: 1,
    borderColor: UI.borderStrong,
  },
  modeButtonText: { color: UI.textMuted, fontSize: 13, fontWeight: '900' },
  modeButtonTextActive: { color: UI.text },
  searchRow: { flexDirection: 'row', gap: 10 },
  searchInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.border,
    color: UI.text,
    fontSize: 14,
  },
  searchButton: {
    minWidth: 74,
    borderRadius: 16,
    backgroundColor: UI.surfaceStrong,
    borderWidth: 1,
    borderColor: UI.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonDisabled: { opacity: 0.6 },
  searchButtonText: { color: UI.peach, fontSize: 14, fontWeight: '900' },
  helperText: { color: UI.textMuted, fontSize: 12, marginTop: 12, lineHeight: 18 },
  selectedTrackBox: {
    marginTop: 14,
    marginBottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    padding: 13,
    backgroundColor: UI.surfaceSoft,
    borderWidth: 1,
    borderColor: UI.borderStrong,
  },
  selectedLabel: { color: UI.peach, fontSize: 11, fontWeight: '900', marginBottom: 3 },
  trackCard: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    padding: 13,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.border,
  },
  trackCardSelected: { borderColor: UI.borderStrong, backgroundColor: UI.surfaceSoft },
  trackTextBox: { flex: 1, minWidth: 0 },
  trackTitle: { color: UI.text, fontSize: 14, fontWeight: '900' },
  trackArtist: { color: UI.textSoft, fontSize: 12, marginTop: 4 },
  selectDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: UI.textMuted,
  },
  selectDotActive: { backgroundColor: UI.peach, borderColor: UI.peach },
  formActions: { marginTop: 4 },
  saveBtn: {
    paddingVertical: 18,
    borderRadius: 999,
    backgroundColor: UI.peach,
    alignItems: 'center',
    shadowColor: UI.peachStrong,
    shadowOpacity: 0.42,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#241A18', fontSize: 17, fontWeight: '900' },
  cancelBtn: {
    marginTop: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: UI.surface,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: { color: UI.textSoft, fontSize: 14, fontWeight: '800' },
  savedPlacesSection: { marginTop: 24 },
  savedPlacesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  savedPlacesTitle: { color: UI.peach, fontSize: 18, fontWeight: '900' },
  savedPlacesRefresh: { color: UI.peach, fontSize: 13, fontWeight: '800' },
  limitNotice: {
    color: UI.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  loadingState: {
    padding: 22,
    borderRadius: 20,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.border,
    alignItems: 'center',
  },
  loadingText: { color: UI.textSoft, fontSize: 12, marginTop: 10 },
  emptyState: {
    padding: 18,
    borderRadius: 20,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.border,
  },
  emptyStateText: { color: UI.textMuted, fontSize: 13, lineHeight: 20 },
  savedPlaceCard: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.border,
    marginBottom: 12,
  },
  savedPlaceHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 13 },
  savedPlaceInfo: { flex: 1, minWidth: 0 },
  savedPlaceTitle: { color: UI.text, fontSize: 15, fontWeight: '900' },
  savedPlaceSub: { color: UI.textSoft, fontSize: 12, marginTop: 4 },
  savedPlaceMeta: { color: UI.textMuted, fontSize: 11, marginTop: 4 },
  savedPlaceActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  savedActionPrimary: {
    alignSelf: 'flex-end',
    minWidth: 82,
    backgroundColor: UI.surfaceStrong,
    borderWidth: 1,
    borderColor: UI.borderStrong,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  savedActionPrimaryText: { color: UI.peach, fontSize: 13, fontWeight: '900' },
});
