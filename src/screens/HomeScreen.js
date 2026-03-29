import React, { useContext, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants';
import { LocationIcon, ClockIcon, CloudIcon, CameraIcon, MapIcon, PersonIcon } from '../components/Icons';
import { PlayerContext } from '../contexts/PlayerContext';
import { LocationContext } from '../contexts/LocationContext';

const { width } = Dimensions.get('window');

const AlbumArt = ({ color, size = 48, radius = 8 }) => (
  <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: color + '66', flexShrink: 0 }} />
);

// 장소 추천 카드
const PlaceCard = ({ onPlay }) => {
  const topTrack = { title: "Nothing's Gonna Hurt You Baby", artist: "Cigarettes After Sex", color: COLORS.green };
  const sub = [
    { title: "2월 Cherry Wine", artist: "Hozier" },
    { title: "3위 더보기", artist: "" },
  ];
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <LocationIcon size={14} color={COLORS.green} />
        <Text style={styles.cardLabel}>  장소 추천 · 한강공원</Text>
      </View>
      <Text style={styles.cardTitle}>지금 이 장소에선 이 노래!</Text>
      <View style={styles.topTrackRow}>
        <AlbumArt color={COLORS.green} size={52} radius={10} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.trackTitle}>{topTrack.title}</Text>
          <Text style={styles.trackArtist}>{topTrack.artist}</Text>
          <Text style={styles.cardSub}>단골곡 1위 · 12회 재생</Text>
        </View>
        <TouchableOpacity style={styles.playBtn} onPress={onPlay}>
          <View style={styles.playBtnInner}>
            <Text style={{ color: '#000', fontSize: 12, fontWeight: '700' }}>▶</Text>
          </View>
        </TouchableOpacity>
      </View>
      <View style={styles.subTracks}>
        {sub.map((s, i) => (
          <Text key={i} style={styles.subTrackText}>{s.title}{s.artist ? ` — ${s.artist}` : ''}</Text>
        ))}
      </View>
    </View>
  );
};

// 시간대 추천 카드
const TimeCard = () => {
  const hour = new Date().getHours();
  const label = hour >= 21 ? '밤 9-11시 단골' : hour >= 17 ? '저녁 시간대 단골' : hour >= 11 ? '낮 시간대 단골' : '아침 시간대 단골';
  const songs = [
    { title: "Thinkin Bout You", artist: "Frank Ocean", color: COLORS.purple },
    { title: "Night Owl", artist: "Galimatias", color: '#5B8DEF' },
  ];
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <ClockIcon size={14} color={COLORS.purple} />
        <Text style={[styles.cardLabel, { color: COLORS.purple }]}>  시간대 추천</Text>
      </View>
      <Text style={styles.cardTitle}>{label}</Text>
      <Text style={styles.cardDesc}>이 시간대에 자주 들었던 음악</Text>
      {songs.map((s, i) => (
        <View key={i} style={[styles.songRow, { marginTop: i === 0 ? 10 : 8 }]}>
          <AlbumArt color={s.color} size={40} radius={8} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.trackTitle}>{s.title}</Text>
            <Text style={styles.trackArtist}>{s.artist}</Text>
          </View>
          <TouchableOpacity style={styles.smallPlayBtn}>
            <Text style={{ color: COLORS.green, fontSize: 11 }}>▶</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
};

// 날씨 추천 카드
const WeatherCard = () => {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <CloudIcon size={14} color={COLORS.amber} />
        <Text style={[styles.cardLabel, { color: COLORS.amber }]}>  날씨 추천</Text>
      </View>
      <Text style={styles.cardTitle}>맑음 · 19°C 저녁</Text>
      <Text style={styles.cardDesc}>오늘 같은 날씨엔 이 음악</Text>
      <View style={[styles.songRow, { marginTop: 10 }]}>
        <AlbumArt color={COLORS.amber} size={52} radius={10} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.trackTitle}>Golden Hour Mix</Text>
          <Text style={styles.trackArtist}>맑음 · 인디팝</Text>
          <Text style={styles.cardSub}>24곡 · 1시간 32분</Text>
        </View>
        <TouchableOpacity style={styles.smallPlayBtn}>
          <Text style={{ color: COLORS.green, fontSize: 11 }}>▶</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// 기능 바로가기
const QuickActions = ({ navigation }) => {
  const actions = [
    { icon: '📍', label: '장소설정', screen: 'PlaceSetup' },
    { icon: '🎵', label: '지금여기바이브', screen: 'Vibe' },
    { icon: '🗺️', label: '뮤직지도', screen: 'MusicMap' },
    { icon: '📷', label: 'Snap&Play', screen: 'SnapPlay' },
  ];
  return (
    <View style={styles.quickActions}>
      {actions.map((a) => (
        <TouchableOpacity key={a.screen} style={styles.quickBtn} onPress={() => navigation.navigate(a.screen)}>
          <View style={styles.quickBtnIcon}>
            <Text style={{ fontSize: 20 }}>{a.icon}</Text>
          </View>
          <Text style={styles.quickBtnLabel}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

export default function HomeScreen({ navigation }) {
  const { play } = useContext(PlayerContext);
  const { location } = useContext(LocationContext);
  const [time, setTime] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes();
      const period = h < 6 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : '밤';
      setTime(`${period} ${h % 12 || 12}:${String(m).padStart(2, '0')}`);
    };
    update();
    const t = setInterval(update, 60000);
    return () => clearInterval(t);
  }, []);

  const handlePlay = () => {
    play(
      { id: '1', title: "Nothing's Gonna Hurt You Baby", artist: 'Cigarettes After Sex', color: COLORS.green },
      [
        { id: '1', title: "Nothing's Gonna Hurt You Baby", artist: 'Cigarettes After Sex', color: COLORS.green },
        { id: '2', title: 'Cherry Wine', artist: 'Hozier', color: '#8B4513' },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>NOWHERE</Text>
          <View style={styles.headerInfo}>
            <Text style={styles.headerSub}>맑음 · 19°C · {time}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.vibeChip} onPress={() => navigation.navigate('Vibe')}>
            <Text style={styles.vibeChipText}>근처 5명</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.avatarBtn}>
            <PersonIcon size={20} color={COLORS.textSub} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <PlaceCard onPlay={handlePlay} />
        <TimeCard />
        <WeatherCard />
        <QuickActions navigation={navigation} />
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  appName: { color: COLORS.text, fontSize: 20, fontWeight: '800', letterSpacing: 2 },
  headerInfo: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  headerSub: { color: COLORS.textSub, fontSize: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vibeChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  vibeChipText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  avatarBtn: { padding: 4 },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1,
    borderColor: COLORS.border, padding: 16, marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  cardLabel: { color: COLORS.green, fontSize: 12, fontWeight: '600' },
  cardTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: 2 },
  cardDesc: { color: COLORS.textSub, fontSize: 12, marginBottom: 0 },
  cardSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  topTrackRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  trackTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  trackArtist: { color: COLORS.textSub, fontSize: 12, marginTop: 2 },
  playBtn: { marginLeft: 8 },
  playBtnInner: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center',
  },
  smallPlayBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.green + '22',
    alignItems: 'center', justifyContent: 'center',
  },
  subTracks: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  subTrackText: { color: COLORS.textSub, fontSize: 12, marginBottom: 4 },
  songRow: { flexDirection: 'row', alignItems: 'center' },
  quickActions: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 4, marginBottom: 8,
  },
  quickBtn: { alignItems: 'center', flex: 1 },
  quickBtnIcon: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  quickBtnLabel: { color: COLORS.textSub, fontSize: 11, textAlign: 'center' },
});
