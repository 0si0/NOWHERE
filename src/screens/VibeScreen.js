import React, { useState, useEffect, useContext } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants';
import { PlayerContext } from '../contexts/PlayerContext';

const LISTENERS = [
  { nick: '익명의 달빛', song: 'Blinding Lights', artist: 'The Weeknd', time: '2분 전', color: COLORS.purple },
  { nick: '밤하늘별', song: 'Sweater Weather', artist: 'The Neighbourhood', time: '1분 전', color: COLORS.accent },
  { nick: '구름위산책', song: "Nothing's Gonna Hurt You Baby", artist: 'Cigarettes After Sex', time: '방금', color: COLORS.green },
  { nick: '노을지는강', song: 'Electric Feel', artist: 'MGMT', time: '4분 전', color: COLORS.amber },
  { nick: '새벽감성', song: 'Clair de Lune', artist: 'Debussy', time: '3분 전', color: COLORS.coral },
];

const TOP_SONG = { title: "Nothing's Gonna Hurt You Baby", artist: 'Cigarettes After Sex', plays: 12, color: COLORS.green };

export default function VibeScreen() {
  const { play, currentTrack } = useContext(PlayerContext);
  const [nearbyCount] = useState(5);
  const [refreshTimer, setRefreshTimer] = useState(30);

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTimer((prev) => (prev <= 1 ? 30 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const sameSongListener = LISTENERS.find(
    (l) => currentTrack && l.song === currentTrack.title
  );

  const handlePlayTop = () => {
    play(
      { id: 'vibe-top', title: TOP_SONG.title, artist: TOP_SONG.artist, color: TOP_SONG.color },
      LISTENERS.map((l, i) => ({ id: `vibe-${i}`, title: l.song, artist: l.artist, color: l.color }))
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>지금 여기 바이브</Text>
          <Text style={styles.subtitle}>반경 200m · {nearbyCount}명이 함께 듣는 중</Text>
        </View>
        <View style={styles.refreshBadge}>
          <Text style={styles.refreshText}>{refreshTimer}s</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Avatar stack */}
        <View style={styles.avatarRow}>
          {LISTENERS.map((l, i) => (
            <View key={i} style={[styles.avatar, { backgroundColor: l.color, marginLeft: i > 0 ? -10 : 0, zIndex: LISTENERS.length - i }]}>
              <Text style={styles.avatarText}>{l.nick[0]}</Text>
            </View>
          ))}
          <Text style={styles.nearbyCount}>  {nearbyCount}명</Text>
        </View>

        {/* Top song */}
        <View style={styles.topCard}>
          <Text style={styles.topBadge}>🏆 이 장소 오늘 1위</Text>
          <View style={styles.topRow}>
            <View style={[styles.albumArt, { backgroundColor: TOP_SONG.color + '44', width: 52, height: 52, borderRadius: 10 }]} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.topTitle}>{TOP_SONG.title}</Text>
              <Text style={styles.topArtist}>{TOP_SONG.artist} · {TOP_SONG.plays}회 재생</Text>
            </View>
            <TouchableOpacity style={styles.playBtn} onPress={handlePlayTop}>
              <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>▶</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Real-time list */}
        <Text style={styles.sectionTitle}>실시간</Text>
        {LISTENERS.map((l, i) => (
          <View key={i} style={styles.listenerRow}>
            <View style={[styles.listenerAvatar, { backgroundColor: l.color + '33' }]}>
              <Text style={[styles.listenerInitial, { color: l.color }]}>{l.nick[0]}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.listenerNick}>{l.nick}</Text>
              <Text style={styles.listenerSong} numberOfLines={1}>{l.song} · {l.artist}</Text>
            </View>
            <Text style={styles.listenerTime}>{l.time}</Text>
          </View>
        ))}

        {/* Same song banner */}
        {sameSongListener && (
          <View style={styles.sameSongBanner}>
            <Text style={{ fontSize: 16 }}>🎵</Text>
            <Text style={styles.sameSongText}>
              <Text style={{ fontWeight: '700' }}>{sameSongListener.nick}</Text>님이 같은 곡을 듣고 있어요!
            </Text>
          </View>
        )}

        {/* Privacy notice */}
        <View style={styles.privacyNote}>
          <Text style={styles.privacyText}>🔒 모든 위치는 200m 단위로 익명 처리되며 세션 종료 시 삭제됩니다</Text>
        </View>

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
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: COLORS.textSub, fontSize: 13, marginTop: 2 },
  refreshBadge: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  refreshText: { color: COLORS.textMuted, fontSize: 12 },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.bg,
  },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  nearbyCount: { color: COLORS.textSub, fontSize: 13, marginLeft: 12 },
  topCard: {
    padding: 16, borderRadius: 14, marginBottom: 20,
    backgroundColor: COLORS.greenSurface,
    borderWidth: 1, borderColor: COLORS.green + '33',
  },
  topBadge: { color: COLORS.green, fontSize: 12, fontWeight: '600', marginBottom: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  albumArt: {},
  topTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  topArtist: { color: COLORS.textSub, fontSize: 12, marginTop: 3 },
  playBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginBottom: 12 },
  listenerRow: {
    flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
  listenerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  listenerInitial: { fontSize: 14, fontWeight: '600' },
  listenerNick: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  listenerSong: { color: COLORS.textSub, fontSize: 12, marginTop: 2 },
  listenerTime: { color: COLORS.textMuted, fontSize: 11, flexShrink: 0 },
  sameSongBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8,
    padding: 12, borderRadius: 12, backgroundColor: COLORS.green + '15',
    borderWidth: 1, borderColor: COLORS.green + '33',
  },
  sameSongText: { color: COLORS.green, fontSize: 13, flex: 1 },
  privacyNote: {
    marginTop: 16, padding: 12, borderRadius: 10,
    backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.border,
  },
  privacyText: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center' },
});
