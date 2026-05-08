import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants';
import { PlayerContext } from '../contexts/PlayerContext';
import { LocationContext } from '../contexts/LocationContext';
import { useSession } from '../contexts/SessionContext';
import { buildListeningContext, recordListeningEvent } from '../services/listeningHistoryService';
import { getRecommendationSlots } from '../services/recommendationService';

const EMPTY_ARTWORK = require('../../assets/EmptyMark.png');

const FILTERS = ['전체', '취향', '시간대', '공간', '날씨', 'Challenge'];
const FILTER_MAP = {
  '취향': 'taste',
  '시간대': 'time',
  '공간': 'place',
  '날씨': 'weather',
  Challenge: 'challenge',
};

function getTimeLabel() {
  const hour = new Date().getHours();
  if (hour < 12) return '오전에 듣기 좋은 곡';
  if (hour < 18) return '오후에 듣기 좋은 곡';
  return '밤에 듣기 좋은 곡';
}

function buildArtworkSource(artworkUrl) {
  return artworkUrl ? { uri: artworkUrl, cache: 'reload' } : EMPTY_ARTWORK;
}

function buildSections(slots) {
  const labels = {
    taste: '요즘 자주 듣는곡',
    time: getTimeLabel(),
    place: '이곳에 어울리는 곡',
    weather: '오늘같은 날씨엔 이런 곡',
    challenge: '오늘은 어떤 곡에 도전해볼까요?',
  };

  return slots.map((slot) => ({
    type: slot.slotType,
    label: labels[slot.slotType] || slot.sourceLabel || '추천',
    songs: [slot],
  }));
}

function SongRow({ song, onPlay }) {
  const source = buildArtworkSource(song.artworkUrl);
  return (
    <View style={styles.songRow}>
      <Image source={source} style={styles.albumArt} />
      <View style={styles.songTextBox}>
        <Text style={styles.songTitle} numberOfLines={1}>{song.title}</Text>
        <Text style={styles.songArtist} numberOfLines={1}>{song.artist || song.reason}</Text>
        <Text style={styles.songReason} numberOfLines={2}>{song.reason}</Text>
      </View>
      <TouchableOpacity style={styles.playBtn} onPress={() => onPlay(song)}>
        <Text style={styles.playText}>▶</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function RecommendScreen() {
  const { play } = useContext(PlayerContext);
  const { location, weather } = useContext(LocationContext);
  const { authUser } = useSession();
  const [activeFilter, setActiveFilter] = useState('전체');
  const [slots, setSlots] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const context = useMemo(() => (
    buildListeningContext({
      location,
      weather,
      place: weather?.city ? { name: `${weather.city} 근처` } : null,
    })
  ), [location, weather]);

  const loadRecommendations = useCallback(async ({ force = false } = {}) => {
    setIsLoading(true);
    try {
      const nextSlots = await getRecommendationSlots({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        location,
        weather,
        place: weather?.city ? { name: `${weather.city} 근처` } : null,
        force,
      });
      setSlots(nextSlots);
    } finally {
      setIsLoading(false);
    }
  }, [authUser?.isAnonymous, authUser?.uid, location, weather]);

  useEffect(() => {
    loadRecommendations().catch(() => {});
  }, [loadRecommendations]);

  const sections = useMemo(() => {
    const base = buildSections(slots);
    if (activeFilter === '전체') {
      return base;
    }
    return base.filter((section) => section.type === FILTER_MAP[activeFilter]);
  }, [activeFilter, slots]);

  const handlePlay = async (song) => {
    if (song.isChallenge || song.slotType === 'challenge') {
      Alert.alert('Challenge', '메인 화면의 Challenge 원에서 조합을 선택해 추천받을 수 있습니다.');
      return;
    }

    const queue = slots.filter((slot) => !slot.isChallenge && slot.slotType !== 'challenge');
    const selectedIndex = queue.findIndex((item) => item.id === song.id);
    const orderedQueue = selectedIndex >= 0
      ? queue.slice(selectedIndex).concat(queue.slice(0, selectedIndex))
      : [song];

    try {
      await play(song, orderedQueue);
      await recordListeningEvent({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        track: song,
        source: 'recommendation-tab',
        recommendationSlot: song.slotType || '',
        context,
      }).catch(() => {});
      loadRecommendations({ force: true }).catch(() => {});
    } catch (error) {
      Alert.alert('Spotify 재생 실패', error.message || 'Spotify로 곡을 열지 못했습니다.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerArea}>
        <View>
          <Text style={styles.title}>추천</Text>
          <Text style={styles.subtitle}>실제 청취 기록으로 바뀌는 음악</Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={() => loadRecommendations({ force: true })}>
          <Text style={styles.refreshText}>새로고침</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((filter) => (
          <TouchableOpacity
            key={filter}
            onPress={() => setActiveFilter(filter)}
            style={[styles.chip, activeFilter === filter && styles.chipActive]}
          >
            <Text style={[styles.chipText, activeFilter === filter && styles.chipTextActive]}>{filter}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={COLORS.green} />
          <Text style={styles.loadingText}>사용자 기록을 분석하는 중...</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {sections.map((section) => (
            <View key={section.type} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              {section.songs.map((song) => <SongRow key={song.id} song={song} onPlay={handlePlay} />)}
            </View>
          ))}
          {sections.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>이 필터에 맞는 추천이 아직 없어요.</Text>
            </View>
          ) : null}
          <View style={{ height: 20 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerArea: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: COLORS.textSub, fontSize: 13, marginTop: 2 },
  refreshButton: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
  },
  refreshText: { color: COLORS.textSub, fontSize: 12, fontWeight: '800' },
  filterRow: { paddingHorizontal: 20, paddingBottom: 12, gap: 8, flexDirection: 'row' },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  chipText: { color: COLORS.textSub, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#000' },
  scroll: { paddingHorizontal: 20, paddingTop: 4 },
  section: { marginBottom: 28 },
  sectionLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 12 },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  albumArt: { width: 48, height: 48, borderRadius: 10 },
  songTextBox: { flex: 1, marginLeft: 12 },
  songTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  songArtist: { color: COLORS.textSub, fontSize: 12, marginTop: 2 },
  songReason: { color: COLORS.textMuted, fontSize: 11, marginTop: 4, lineHeight: 15 },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.green + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playText: { color: COLORS.green, fontSize: 12 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: COLORS.textSub, fontSize: 13 },
  emptyState: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  emptyText: { color: COLORS.textSub, fontSize: 13, textAlign: 'center' },
});
