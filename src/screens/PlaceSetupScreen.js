import React, { useState, useContext } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, RADIUS_OPTIONS } from '../constants';
import { LocationContext } from '../contexts/LocationContext';

const ADVANCED_OPTIONS = [
  { icon: '☀️', label: '맑은 날' },
  { icon: '🌧️', label: '비 오는 날' },
  { icon: '🌙', label: '밤 시간대 (21:00~)' },
];

export default function PlaceSetupScreen({ navigation }) {
  const { location } = useContext(LocationContext);
  const [placeName, setPlaceName] = useState('');
  const [selectedRadius, setSelectedRadius] = useState(200);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSave = () => {
    if (!placeName.trim()) {
      Alert.alert('장소 이름을 입력해주세요');
      return;
    }
    // TODO: Save to Firebase Firestore
    Alert.alert('저장 완료', `"${placeName}" 장소가 등록되었어요!\n${selectedRadius}m 반경에 도착하면 음악이 자동 재생됩니다.`, [
      { text: '확인', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>장소설정</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Map placeholder */}
        <View style={styles.mapContainer}>
          <View style={[styles.radiusCircle, {
            width: selectedRadius * 0.35, height: selectedRadius * 0.35, borderRadius: selectedRadius * 0.175,
          }]} />
          <Text style={styles.mapPin}>📍</Text>
          <Text style={styles.mapHint}>지도에서 장소를 탭하세요</Text>
          {location && (
            <Text style={styles.locationText}>
              현재 위치: {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
            </Text>
          )}
        </View>

        {/* Place name */}
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

        {/* Radius selector */}
        <View style={styles.section}>
          <Text style={styles.label}>감지 반경</Text>
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map((r) => (
              <TouchableOpacity key={r} onPress={() => setSelectedRadius(r)}
                style={[styles.radiusBtn, selectedRadius === r && styles.radiusBtnActive]}>
                <Text style={[styles.radiusBtnText, selectedRadius === r && styles.radiusBtnTextActive]}>{r}m</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Playlist connection */}
        <View style={styles.card}>
          <Text style={styles.label}>연결할 플레이리스트</Text>
          <TouchableOpacity style={styles.playlistPicker}>
            <Text style={styles.playlistPickerText}>+ 플레이리스트 선택</Text>
          </TouchableOpacity>
        </View>

        {/* Advanced settings */}
        <TouchableOpacity style={styles.advancedHeader} onPress={() => setShowAdvanced((v) => !v)}>
          <Text style={styles.label}>고급 설정</Text>
          <Text style={styles.advancedToggle}>{showAdvanced ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {showAdvanced && (
          <View style={styles.card}>
            <Text style={styles.advancedDesc}>날씨별·시간대별로 다른 플레이리스트를 설정할 수 있어요</Text>
            {ADVANCED_OPTIONS.map((opt, i) => (
              <TouchableOpacity key={i} style={[styles.advancedRow, i < ADVANCED_OPTIONS.length - 1 && styles.advancedRowBorder]}>
                <Text style={styles.advancedLabel}>{opt.icon} {opt.label}</Text>
                <Text style={styles.advancedValue}>미설정</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Save button */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>장소 저장하기</Text>
        </TouchableOpacity>

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
  section: { marginBottom: 20 },
  label: { color: COLORS.textSub, fontSize: 13, marginBottom: 8, fontWeight: '500' },
  input: {
    padding: 14, borderRadius: 12, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border, color: COLORS.text,
    fontSize: 15,
  },
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
  playlistPicker: {
    padding: 14, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
    borderStyle: 'dashed', alignItems: 'center', marginTop: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  playlistPickerText: { color: COLORS.textMuted, fontSize: 14 },
  advancedHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  advancedToggle: { color: COLORS.textSub, fontSize: 12 },
  advancedDesc: { color: COLORS.textMuted, fontSize: 12, marginBottom: 12 },
  advancedRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12,
  },
  advancedRowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  advancedLabel: { color: COLORS.textSub, fontSize: 14 },
  advancedValue: { color: COLORS.textMuted, fontSize: 12 },
  saveBtn: {
    paddingVertical: 16, borderRadius: 14,
    backgroundColor: COLORS.green, alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
