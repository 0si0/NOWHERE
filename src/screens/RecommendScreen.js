import React, { useContext, useState } from 'react';
import { Alert, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants';
import { PlayerContext } from '../contexts/PlayerContext';

const FILTERS = ['전체', '시간대', '공간', '날씨', 'Challenge'];
const FILTER_MAP = { '시간대': 'time', '공간': 'space', '날씨': 'weather', 'Challenge': 'challenge' };

const MOCK_DATA = [
  {
    type: 'time', label: '⏰ 밤 9-11시 단골',
    songs: [
      { id: 'r1', title: 'Thinkin Bout You', artist: 'Frank Ocean', color: '#4A6FA5' },
      { id: 'r2', title: 'Night Owl', artist: 'Galimatias', color: '#6B5B95' },
    ],
  },
  {
    type: 'space', label: '📍 한강공원 단골곡',
    songs: [
      { id: 'r3', title: "Nothing's Gonna Hurt You Baby", artist: 'Cigarettes After Sex', color: COLORS.green },
      { id: 'r4', title: 'Cherry Wine', artist: 'Hozier', color: '#8B4513' },
    ],
  },
  {
    type: 'weather', label: '☀️ 맑음 · 19°C 저녁',
    songs: [
      { id: 'r5', title: 'Golden Hour', artist: 'JVKE', color: COLORS.amber },
      { id: 'r6', title: 'Sunset Lover', artist: 'Petit Biscuit', color: '#FF6B35' },
    ],
  },
];

const SongRow = ({ song, onPlay }) => (
  <View style={styles.songRow}>
    <View style={[styles.albumArt, { backgroundColor: song.color + '44' }]} />
    <View style={{ flex: 1, marginLeft: 12 }}>
      <Text style={styles.songTitle}>{song.title}</Text>
      <Text style={styles.songArtist}>{song.artist}</Text>
    </View>
    <TouchableOpacity style={styles.playBtn} onPress={() => onPlay(song)}>
      <Text style={{ color: COLORS.green, fontSize: 12 }}>▶</Text>
    </TouchableOpacity>
  </View>
);

export default function RecommendScreen() {
  const { play } = useContext(PlayerContext);
  const [activeFilter, setActiveFilter] = useState('전체');

  const filtered = activeFilter === '전체'
    ? MOCK_DATA
    : MOCK_DATA.filter((r) => r.type === FILTER_MAP[activeFilter]);

  const handlePlay = async (song) => {
    const queue = filtered.flatMap((section) => section.songs);
    const selectedIndex = queue.findIndex((item) => item.id === song.id);
    const orderedQueue = selectedIndex >= 0
      ? queue.slice(selectedIndex).concat(queue.slice(0, selectedIndex))
      : [song];

    try {
      await play(song, orderedQueue);
    } catch (error) {
      Alert.alert('Spotify 재생 실패', error.message || 'Spotify로 곡을 열지 못했습니다.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerArea}>
        <Text style={styles.title}>추천</Text>
        <Text style={styles.subtitle}>지금 이 순간에 맞는 음악</Text>
      </View>

      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} onPress={() => setActiveFilter(f)}
            style={[styles.chip, activeFilter === f && styles.chipActive]}>
            <Text style={[styles.chipText, activeFilter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {filtered.map((section) => (
          <View key={section.type} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.label}</Text>
            {section.songs.map((song) => <SongRow key={song.id} song={song} onPlay={handlePlay} />)}
          </View>
        ))}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerArea: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: COLORS.textSub, fontSize: 13, marginTop: 2 },
  filterRow: { paddingHorizontal: 20, paddingBottom: 12, gap: 8, flexDirection: 'row' },
  chip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  chipText: { color: COLORS.textSub, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#000' },
  scroll: { paddingHorizontal: 20, paddingTop: 4 },
  section: { marginBottom: 28 },
  sectionLabel: { color: COLORS.text, fontSize: 15, fontWeight: '600', marginBottom: 12 },
  songRow: {
    flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
  albumArt: { width: 44, height: 44, borderRadius: 8 },
  songTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  songArtist: { color: COLORS.textSub, fontSize: 12, marginTop: 2 },
  playBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.green + '22', alignItems: 'center', justifyContent: 'center',
  },
});
