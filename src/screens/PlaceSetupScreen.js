import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, PLAYLIST_PROVIDERS, RADIUS_OPTIONS } from '../constants';
import { LocationContext } from '../contexts/LocationContext';
import { useSession } from '../contexts/SessionContext';
import {
  archiveSavedPlace,
  getOrCreateAppUserId,
  getSavedPlaces,
  saveSavedPlace,
  updateSavedPlace,
} from '../services/firebaseService';

const WEATHER_RULE_OPTIONS = [
  { key: 'Clear', icon: '☀️', label: '맑은 날' },
  { key: 'Rain', icon: '🌧️', label: '비 오는 날' },
];

const TIME_RULE_OPTIONS = [
  { key: 'night', icon: '🌙', label: '밤 시간대', startHour: 21, endHour: 24 },
];

function createPlaylistDraft(overrides = {}) {
  return {
    provider: 'unknown',
    title: '',
    playlistId: '',
    artworkUrl: '',
    ...overrides,
  };
}

function createEmptyRuleDrafts(options) {
  return options.reduce((acc, option) => {
    acc[option.key] = createPlaylistDraft();
    return acc;
  }, {});
}

function hasPlaylistInput(playlist) {
  return Boolean(playlist?.title?.trim() || playlist?.playlistId?.trim() || playlist?.artworkUrl?.trim());
}

function buildWeatherRules(drafts) {
  return WEATHER_RULE_OPTIONS
    .map((option) => ({
      option,
      playlist: drafts[option.key],
    }))
    .filter(({ playlist }) => hasPlaylistInput(playlist))
    .map(({ option, playlist }) => ({
      condition: option.key,
      playlist,
    }));
}

function buildTimeRules(drafts) {
  return TIME_RULE_OPTIONS
    .map((option) => ({
      option,
      playlist: drafts[option.key],
    }))
    .filter(({ playlist }) => hasPlaylistInput(playlist))
    .map(({ option, playlist }) => ({
      label: option.label,
      startHour: option.startHour,
      endHour: option.endHour,
      playlist,
    }));
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

function PlaylistProviderSelector({ value, onChange }) {
  return (
    <View style={styles.providerRow}>
      {PLAYLIST_PROVIDERS.map((provider) => (
        <TouchableOpacity
          key={provider.value}
          onPress={() => onChange(provider.value)}
          style={[styles.providerChip, value === provider.value && styles.providerChipActive]}
        >
          <Text style={[styles.providerChipText, value === provider.value && styles.providerChipTextActive]}>
            {provider.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function PlaylistFields({ title, value, onChange, compact = false }) {
  return (
    <View style={[styles.card, compact && styles.compactCard]}>
      <Text style={styles.label}>{title}</Text>
      <PlaylistProviderSelector
        value={value.provider}
        onChange={(provider) => onChange({ ...value, provider })}
      />
      <TextInput
        value={value.title}
        onChangeText={(text) => onChange({ ...value, title: text })}
        placeholder="플레이리스트 제목"
        placeholderTextColor={COLORS.textMuted}
        style={styles.input}
      />
      <TextInput
        value={value.playlistId}
        onChangeText={(text) => onChange({ ...value, playlistId: text })}
        placeholder="플레이리스트 ID"
        placeholderTextColor={COLORS.textMuted}
        style={styles.input}
      />
      <TextInput
        value={value.artworkUrl}
        onChangeText={(text) => onChange({ ...value, artworkUrl: text })}
        placeholder="커버 이미지 URL (선택)"
        placeholderTextColor={COLORS.textMuted}
        style={[styles.input, styles.inputLast]}
        autoCapitalize="none"
      />
    </View>
  );
}

function SavedPlaceCard({ place, onLoad, onArchive }) {
  const advancedCount = (place.weatherRules?.length || 0) + (place.timeRules?.length || 0);
  const playlistTitle = place.playlist?.title || place.playlist?.playlistId || '기본 플레이리스트 미설정';

  return (
    <View style={styles.savedPlaceCard}>
      <View style={styles.savedPlaceHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.savedPlaceTitle}>{place.name}</Text>
          <Text style={styles.savedPlaceMeta}>
            {place.radiusMeters}m · {place.coordinates?.latitude?.toFixed?.(4)}, {place.coordinates?.longitude?.toFixed?.(4)}
          </Text>
        </View>
        <View style={styles.savedPlaceBadge}>
          <Text style={styles.savedPlaceBadgeText}>{place.status === 'archived' ? '보관됨' : '활성'}</Text>
        </View>
      </View>
      <Text style={styles.savedPlaceSub}>기본: {playlistTitle}</Text>
      <Text style={styles.savedPlaceSub}>고급 설정 {advancedCount}개 · 업데이트 {formatTimestamp(place.updatedAt)}</Text>
      <View style={styles.savedPlaceActions}>
        <TouchableOpacity style={styles.savedActionPrimary} onPress={() => onLoad(place)}>
          <Text style={styles.savedActionPrimaryText}>불러오기</Text>
        </TouchableOpacity>
        {place.status !== 'archived' && (
          <TouchableOpacity style={styles.savedActionSecondary} onPress={() => onArchive(place)}>
            <Text style={styles.savedActionSecondaryText}>보관</Text>
          </TouchableOpacity>
        )}
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
    startBackgroundTracking,
    locationError,
  } = useContext(LocationContext);
  const { authUser, isLoading, isFirebaseConfigured, missingConfigKeys } = useSession();

  const [placeName, setPlaceName] = useState('');
  const [selectedRadius, setSelectedRadius] = useState(200);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSavedPlaces, setIsLoadingSavedPlaces] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [editingPlaceId, setEditingPlaceId] = useState(null);
  const [playlistDraft, setPlaylistDraft] = useState(createPlaylistDraft());
  const [weatherRuleDrafts, setWeatherRuleDrafts] = useState(createEmptyRuleDrafts(WEATHER_RULE_OPTIONS));
  const [timeRuleDrafts, setTimeRuleDrafts] = useState(createEmptyRuleDrafts(TIME_RULE_OPTIONS));

  const activePlaces = useMemo(
    () => savedPlaces.filter((place) => place.status !== 'archived'),
    [savedPlaces]
  );

  const resetForm = useCallback(() => {
    setEditingPlaceId(null);
    setPlaceName('');
    setSelectedRadius(200);
    setPlaylistDraft(createPlaylistDraft());
    setWeatherRuleDrafts(createEmptyRuleDrafts(WEATHER_RULE_OPTIONS));
    setTimeRuleDrafts(createEmptyRuleDrafts(TIME_RULE_OPTIONS));
    setShowAdvanced(false);
  }, []);

  const loadSavedPlaces = useCallback(async () => {
    if (isFirebaseConfigured && (isLoading || !authUser?.uid)) {
      return;
    }

    setIsLoadingSavedPlaces(true);
    try {
      const ownerId = authUser?.uid || await getOrCreateAppUserId();
      const places = await getSavedPlaces(ownerId);
      setSavedPlaces(places);
    } catch (error) {
      Alert.alert('불러오기 실패', error.message || '저장된 장소를 불러오지 못했습니다.');
    } finally {
      setIsLoadingSavedPlaces(false);
    }
  }, [authUser?.uid, isFirebaseConfigured, isLoading]);

  useEffect(() => {
    loadSavedPlaces();
  }, [loadSavedPlaces]);

  const buildPlacePayload = useCallback((userId) => ({
    userId,
    name: placeName,
    latitude: location.latitude,
    longitude: location.longitude,
    radiusMeters: selectedRadius,
    playlist: playlistDraft,
    weatherRules: buildWeatherRules(weatherRuleDrafts),
    timeRules: buildTimeRules(timeRuleDrafts),
    source: 'place-setup-screen',
  }), [location, placeName, playlistDraft, selectedRadius, timeRuleDrafts, weatherRuleDrafts]);

  const applyPlaceToForm = useCallback((place) => {
    setEditingPlaceId(place.id);
    setPlaceName(place.name || '');
    setSelectedRadius(place.radiusMeters || 200);
    setPlaylistDraft(createPlaylistDraft(place.playlist || {}));

    const nextWeatherDrafts = createEmptyRuleDrafts(WEATHER_RULE_OPTIONS);
    (place.weatherRules || []).forEach((rule) => {
      if (nextWeatherDrafts[rule.condition]) {
        nextWeatherDrafts[rule.condition] = createPlaylistDraft(rule.playlist || {});
      }
    });
    setWeatherRuleDrafts(nextWeatherDrafts);

    const nextTimeDrafts = createEmptyRuleDrafts(TIME_RULE_OPTIONS);
    (place.timeRules || []).forEach((rule) => {
      const matchingOption = TIME_RULE_OPTIONS.find((option) => option.label === rule.label);
      if (matchingOption) {
        nextTimeDrafts[matchingOption.key] = createPlaylistDraft(rule.playlist || {});
      }
    });
    setTimeRuleDrafts(nextTimeDrafts);
    setShowAdvanced(Boolean((place.weatherRules || []).length || (place.timeRules || []).length));
  }, []);

  const handleSave = async () => {
    if (!placeName.trim()) {
      Alert.alert('장소 이름을 입력해주세요');
      return;
    }

    if (isFirebaseConfigured && (isLoading || !authUser)) {
      Alert.alert('잠시만요', '익명 세션을 준비하는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    if (!location) {
      Alert.alert('현재 위치가 필요해요', '장소를 저장하려면 위치 권한을 허용하고 현재 위치를 불러와야 합니다.');
      return;
    }

    try {
      setIsSaving(true);
      const ownerId = authUser?.uid || await getOrCreateAppUserId();
      const payload = buildPlacePayload(ownerId);

      if (editingPlaceId) {
        await updateSavedPlace(editingPlaceId, payload);
      } else {
        await saveSavedPlace(payload);
      }

      await loadSavedPlaces();

      Alert.alert(
        editingPlaceId ? '수정 완료' : '저장 완료',
        editingPlaceId
          ? `"${placeName}" 장소 설정이 업데이트되었어요.`
          : `"${placeName}" 장소가 등록되었어요!\n${selectedRadius}m 반경에 도착하면 음악이 자동 재생됩니다.${isFirebaseConfigured ? '' : '\n현재는 기기 내부에 임시 저장 중이에요.'}`,
        [{ text: '확인' }]
      );

      resetForm();
    } catch (error) {
      Alert.alert('저장 실패', error.message || '장소 저장 중 문제가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchivePlace = async (place) => {
    Alert.alert(
      '장소 보관',
      `"${place.name}" 장소를 보관할까요? 자동재생 대상에서는 제외되지만 기록은 남아 있습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '보관',
          style: 'destructive',
          onPress: async () => {
            try {
              const ownerId = authUser?.uid || await getOrCreateAppUserId();
              await archiveSavedPlace(ownerId, place.id);
              await loadSavedPlaces();
              if (editingPlaceId === place.id) {
                resetForm();
              }
            } catch (error) {
              Alert.alert('보관 실패', error.message || '장소를 보관하지 못했습니다.');
            }
          },
        },
      ]
    );
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
        <Text style={styles.title}>장소설정</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.mapContainer}>
          <View style={[styles.radiusCircle, {
            width: selectedRadius * 0.35, height: selectedRadius * 0.35, borderRadius: selectedRadius * 0.175,
          }]} />
          <Text style={styles.mapPin}>📍</Text>
          <Text style={styles.mapHint}>
            {hasForegroundPermission ? '현재 위치 기준으로 장소를 저장할 수 있어요' : '위치 권한을 허용하면 현재 위치를 사용할 수 있어요'}
          </Text>
          {location && (
            <Text style={styles.locationText}>
              현재 위치: {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
            </Text>
          )}
          {!hasForegroundPermission && (
            <TouchableOpacity style={styles.mapActionBtn} onPress={handleRequestLocation} disabled={isLocating}>
              <Text style={styles.mapActionText}>{isLocating ? '확인 중...' : '위치 권한 허용'}</Text>
            </TouchableOpacity>
          )}
          {hasForegroundPermission && !backgroundTrackingEnabled && (
            <TouchableOpacity style={[styles.mapActionBtn, styles.mapSecondaryBtn]} onPress={handleEnableBackground}>
              <Text style={styles.mapSecondaryText}>
                {hasBackgroundPermission ? '백그라운드 감지 시작' : '백그라운드 권한 요청'}
              </Text>
            </TouchableOpacity>
          )}
          {locationError ? <Text style={styles.mapErrorText}>{locationError}</Text> : null}
        </View>

        {!isFirebaseConfigured && (
          <View style={styles.localModeBanner}>
            <Text style={styles.localModeTitle}>로컬 저장 모드</Text>
            <Text style={styles.localModeText}>
              Firebase 설정 전까지 저장한 장소는 이 기기 안에만 임시로 보관됩니다.
            </Text>
            <Text style={styles.localModeHint}>
              아직 비어 있는 Firebase 키: {missingConfigKeys.join(', ')}
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>장소 닉네임</Text>
          <TextInput
            value={placeName}
            onChangeText={setPlaceName}
            placeholder="예: 우리 학교, 한강 자전거 코스"
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>감지 반경</Text>
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setSelectedRadius(r)}
                style={[styles.radiusBtn, selectedRadius === r && styles.radiusBtnActive]}
              >
                <Text style={[styles.radiusBtnText, selectedRadius === r && styles.radiusBtnTextActive]}>{r}m</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <PlaylistFields
          title="기본 플레이리스트"
          value={playlistDraft}
          onChange={setPlaylistDraft}
        />

        <TouchableOpacity style={styles.advancedHeader} onPress={() => setShowAdvanced((value) => !value)}>
          <Text style={styles.label}>고급 설정</Text>
          <Text style={styles.advancedToggle}>{showAdvanced ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {showAdvanced && (
          <View style={styles.advancedSection}>
            <Text style={styles.advancedDesc}>날씨별·시간대별로 다른 플레이리스트를 저장할 수 있어요</Text>
            {WEATHER_RULE_OPTIONS.map((option) => (
              <PlaylistFields
                key={option.key}
                title={`${option.icon} ${option.label}`}
                value={weatherRuleDrafts[option.key]}
                onChange={(value) => setWeatherRuleDrafts((prev) => ({ ...prev, [option.key]: value }))}
                compact
              />
            ))}
            {TIME_RULE_OPTIONS.map((option) => (
              <PlaylistFields
                key={option.key}
                title={`${option.icon} ${option.label} (${String(option.startHour).padStart(2, '0')}:00~)`}
                value={timeRuleDrafts[option.key]}
                onChange={(value) => setTimeRuleDrafts((prev) => ({ ...prev, [option.key]: value }))}
                compact
              />
            ))}
          </View>
        )}

        <View style={styles.formActions}>
          <TouchableOpacity style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]} onPress={handleSave} disabled={isSaving}>
            <Text style={styles.saveBtnText}>{isSaving ? '저장 중...' : editingPlaceId ? '장소 수정하기' : '장소 저장하기'}</Text>
          </TouchableOpacity>
          {editingPlaceId && (
            <TouchableOpacity style={styles.cancelBtn} onPress={resetForm}>
              <Text style={styles.cancelBtnText}>새 장소 등록으로 돌아가기</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.savedPlacesSection}>
          <View style={styles.savedPlacesHeader}>
            <Text style={styles.savedPlacesTitle}>저장된 장소</Text>
            <TouchableOpacity onPress={loadSavedPlaces}>
              <Text style={styles.savedPlacesRefresh}>새로고침</Text>
            </TouchableOpacity>
          </View>
          {isLoadingSavedPlaces ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={COLORS.green} />
              <Text style={styles.loadingText}>저장된 장소를 불러오는 중...</Text>
            </View>
          ) : activePlaces.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>아직 저장한 장소가 없어요. 첫 장소를 등록해보세요.</Text>
            </View>
          ) : (
            activePlaces.map((place) => (
              <SavedPlaceCard
                key={place.id}
                place={place}
                onLoad={applyPlaceToForm}
                onArchive={handleArchivePlace}
              />
            ))
          )}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 4 },
  backText: { color: COLORS.text, fontSize: 22 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingTop: 20 },
  localModeBanner: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: COLORS.amberSurface,
    borderWidth: 1,
    borderColor: COLORS.amber + '55',
    marginBottom: 18,
  },
  localModeTitle: { color: COLORS.amber, fontSize: 14, fontWeight: '700' },
  localModeText: { color: COLORS.textSub, fontSize: 12, lineHeight: 18, marginTop: 6 },
  localModeHint: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  mapContainer: {
    height: 220, borderRadius: 16, backgroundColor: COLORS.surfaceLight,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 20,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  radiusCircle: {
    position: 'absolute', borderWidth: 2, borderColor: COLORS.green + '55',
    backgroundColor: COLORS.green + '15',
  },
  mapPin: { fontSize: 28, zIndex: 1 },
  mapHint: { position: 'absolute', bottom: 12, color: COLORS.textMuted, fontSize: 12 },
  locationText: { position: 'absolute', top: 10, color: COLORS.textMuted, fontSize: 10 },
  mapActionBtn: {
    position: 'absolute',
    bottom: 42,
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  mapActionText: { color: '#000', fontSize: 13, fontWeight: '700' },
  mapSecondaryBtn: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.green },
  mapSecondaryText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },
  mapErrorText: { position: 'absolute', bottom: 12, color: COLORS.coral, fontSize: 11, textAlign: 'center', paddingHorizontal: 16 },
  section: { marginBottom: 20 },
  label: { color: COLORS.textSub, fontSize: 13, marginBottom: 8, fontWeight: '500' },
  input: {
    padding: 14, borderRadius: 12, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border, color: COLORS.text,
    fontSize: 15, marginBottom: 10,
  },
  inputLast: { marginBottom: 0 },
  radiusRow: { flexDirection: 'row', gap: 8 },
  radiusBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center',
  },
  radiusBtnActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  radiusBtnText: { color: COLORS.textSub, fontSize: 14, fontWeight: '600' },
  radiusBtnTextActive: { color: '#000' },
  card: {
    padding: 16, borderRadius: 14, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 16,
  },
  compactCard: { marginBottom: 12 },
  providerRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  providerChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  providerChipActive: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },
  providerChipText: { color: COLORS.textSub, fontSize: 12, fontWeight: '600' },
  providerChipTextActive: { color: '#000' },
  advancedHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  advancedToggle: { color: COLORS.textSub, fontSize: 12 },
  advancedSection: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  advancedDesc: { color: COLORS.textMuted, fontSize: 12, marginBottom: 12 },
  formActions: { marginTop: 4 },
  saveBtn: {
    paddingVertical: 16, borderRadius: 14,
    backgroundColor: COLORS.green, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  cancelBtn: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: { color: COLORS.textSub, fontSize: 14, fontWeight: '600' },
  savedPlacesSection: { marginTop: 24 },
  savedPlacesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  savedPlacesTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  savedPlacesRefresh: { color: COLORS.green, fontSize: 13, fontWeight: '600' },
  loadingState: {
    padding: 20,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  loadingText: { color: COLORS.textSub, fontSize: 12, marginTop: 10 },
  emptyState: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyStateText: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20 },
  savedPlaceCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  savedPlaceHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  savedPlaceTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  savedPlaceMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  savedPlaceBadge: {
    marginLeft: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.green + '22',
  },
  savedPlaceBadgeText: { color: COLORS.green, fontSize: 11, fontWeight: '700' },
  savedPlaceSub: { color: COLORS.textSub, fontSize: 12, marginTop: 4 },
  savedPlaceActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  savedActionPrimary: {
    flex: 1,
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  savedActionPrimaryText: { color: '#000', fontSize: 13, fontWeight: '700' },
  savedActionSecondary: {
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedActionSecondaryText: { color: COLORS.textSub, fontSize: 13, fontWeight: '600' },
});
