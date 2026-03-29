import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants';

const { width } = Dimensions.get('window');
const MAP_HEIGHT = 320;

const PINS = [
  { x: 0.35, y: 0.3, color: COLORS.green, song: "Nothing's Gonna Hurt You Baby", place: '한강공원', age: '오늘', plays: 12 },
  { x: 0.6, y: 0.5, color: COLORS.purple, song: 'Cherry Wine', place: '반포 카페', age: '이번 주', plays: 5 },
  { x: 0.25, y: 0.65, color: COLORS.amber, song: 'Thinkin Bout You', place: '서울 도서관', age: '이번 달', plays: 3 },
  { x: 0.7, y: 0.25, color: COLORS.green, song: 'Golden Hour Mix', place: '여의도공원', age: '오늘', plays: 8 },
  { x: 0.5, y: 0.75, color: COLORS.purple, song: 'Night Owl', place: '강남역', age: '이번 주', plays: 6 },
];

const LEGEND = [
  { color: COLORS.green, label: '오늘' },
  { color: COLORS.purple, label: '이번 주' },
  { color: COLORS.amber, label: '이번 달' },
];

export default function MusicMapScreen({ navigation }) {
  const [selectedPin, setSelectedPin] = useState(null);
  const [filterMode, setFilterMode] = useState('mine');

  const mapWidth = width - 40;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>뮤직지도</Text>
          <Text style={styles.subtitle}>내 음악이 새겨진 공간들</Text>
        </View>
        <View style={styles.filterToggle}>
          {['mine', 'all'].map((m) => (
            <TouchableOpacity key={m} onPress={() => setFilterMode(m)}
              style={[styles.toggleBtn, filterMode === m && styles.toggleBtnActive]}>
              <Text style={[styles.toggleText, filterMode === m && styles.toggleTextActive]}>
                {m === 'mine' ? '내 기록' : '전체'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Map */}
        <View style={[styles.mapContainer, { width: mapWidth, height: MAP_HEIGHT }]}>
          {/* Grid lines */}
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <View key={`h${i}`} style={[styles.gridLine, { top: `${i * 14.3}%`, left: 0, right: 0, height: 1 }]} />
          ))}
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <View key={`v${i}`} style={[styles.gridLine, { left: `${i * 14.3}%`, top: 0, bottom: 0, width: 1 }]} />
          ))}

          {/* Pins */}
          {PINS.map((pin, i) => {
            const isSelected = selectedPin === i;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.pin, { left: pin.x * mapWidth - 6, top: pin.y * MAP_HEIGHT - 6 }]}
                onPress={() => setSelectedPin(isSelected ? null : i)}
              >
                <View style={[
                  styles.pinDot,
                  { backgroundColor: pin.color, width: isSelected ? 14 : 10, height: isSelected ? 14 : 10, borderRadius: isSelected ? 7 : 5 },
                ]} />
                {isSelected && (
                  <View style={styles.pinPopup}>
                    <Text style={styles.pinSong} numberOfLines={1}>{pin.song}</Text>
                    <Text style={styles.pinPlace}>{pin.place} · {pin.age}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          {LEGEND.map((l) => (
            <View key={l.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: l.color }]} />
              <Text style={styles.legendLabel}>{l.label}</Text>
            </View>
          ))}
        </View>

        {/* Add place button */}
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('PlaceSetup')}>
          <Text style={styles.addBtnText}>+ 장소 추가</Text>
        </TouchableOpacity>

        {/* Recent plays */}
        <Text style={styles.sectionTitle}>최근 기록</Text>
        {PINS.slice(0, 4).map((pin, i) => (
          <View key={i} style={styles.recordRow}>
            <View style={[styles.recordDot, { backgroundColor: pin.color }]} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.recordSong}>{pin.song}</Text>
              <Text style={styles.recordPlace}>{pin.place} · {pin.age} · {pin.plays}회</Text>
            </View>
            <TouchableOpacity style={styles.smallPlayBtn}>
              <Text style={{ color: COLORS.green, fontSize: 11 }}>▶</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: COLORS.textSub, fontSize: 13, marginTop: 2 },
  filterToggle: {
    flexDirection: 'row', backgroundColor: COLORS.surface,
    borderRadius: 10, padding: 3, borderWidth: 1, borderColor: COLORS.border,
  },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  toggleBtnActive: { backgroundColor: COLORS.surfaceLight },
  toggleText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  toggleTextActive: { color: COLORS.text },
  scroll: { paddingHorizontal: 20 },
  mapContainer: {
    borderRadius: 16, backgroundColor: COLORS.surfaceLight,
    borderWidth: 1, borderColor: COLORS.border, position: 'relative',
    overflow: 'hidden', marginBottom: 16,
  },
  gridLine: { position: 'absolute', backgroundColor: COLORS.border + '44' },
  pin: { position: 'absolute' },
  pinDot: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4 },
  pinPopup: {
    position: 'absolute', bottom: 16, left: -60, width: 140,
    backgroundColor: COLORS.surface, borderRadius: 10, padding: 8,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8,
  },
  pinSong: { color: COLORS.text, fontSize: 11, fontWeight: '600' },
  pinPlace: { color: COLORS.textSub, fontSize: 10, marginTop: 2 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginBottom: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { color: COLORS.textSub, fontSize: 11 },
  addBtn: {
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.green + '66',
    borderStyle: 'dashed', paddingVertical: 14, alignItems: 'center', marginBottom: 20,
  },
  addBtnText: { color: COLORS.green, fontSize: 14, fontWeight: '600' },
  sectionTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginBottom: 12 },
  recordRow: {
    flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
  recordDot: { width: 8, height: 8, borderRadius: 4 },
  recordSong: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  recordPlace: { color: COLORS.textSub, fontSize: 11, marginTop: 2 },
  smallPlayBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: COLORS.green + '22', alignItems: 'center', justifyContent: 'center',
  },
});
