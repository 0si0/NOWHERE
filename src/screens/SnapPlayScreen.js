import React, { useState, useContext } from 'react';
import {
  View, Text, TouchableOpacity, Image, ScrollView,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { COLORS } from '../constants';
import { CameraIcon } from '../components/Icons';
import { PlayerContext } from '../contexts/PlayerContext';

// Claude Vision API integration
async function analyzeImageWithClaude(base64Image) {
  // Replace with your Claude API key
  const CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64Image },
            },
            {
              type: 'text',
              text: '이 사진의 분위기, 색감, 장면을 분석해서 음악 무드 태그 4-5개를 한국어 해시태그로만 답해줘. 예시: #밤길 #고요함 #차분 #도시 #가로등',
            },
          ],
        },
      ],
    }),
  });
  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  const tags = text.match(/#\S+/g) || ['#감성', '#음악', '#분위기'];
  return tags.slice(0, 5);
}

// Mock music search based on mood tags
function getMusicForTags(tags) {
  const tagStr = tags.join(' ').toLowerCase();
  if (tagStr.includes('밤') || tagStr.includes('고요') || tagStr.includes('차분')) {
    return [
      { id: 's1', title: "Nothing's Gonna Hurt You Baby", artist: 'Cigarettes After Sex', color: '#4A6FA5' },
      { id: 's2', title: 'Clair de Lune', artist: 'Debussy', color: '#6B5B95' },
      { id: 's3', title: 'Myth', artist: 'Beach House', color: '#2C5F7C' },
    ];
  }
  if (tagStr.includes('밝') || tagStr.includes('따뜻') || tagStr.includes('카페')) {
    return [
      { id: 's1', title: 'Golden Hour', artist: 'JVKE', color: COLORS.amber },
      { id: 's2', title: 'Bloom', artist: 'The Paper Kites', color: '#FF6B35' },
      { id: 's3', title: 'Budapest', artist: 'George Ezra', color: '#D4A017' },
    ];
  }
  return [
    { id: 's1', title: 'Electric Feel', artist: 'MGMT', color: COLORS.coral },
    { id: 's2', title: 'Cherry Wine', artist: 'Hozier', color: '#8B4513' },
    { id: 's3', title: 'Redbone', artist: 'Childish Gambino', color: '#C62828' },
  ];
}

export default function SnapPlayScreen({ navigation }) {
  const { play } = useContext(PlayerContext);
  const [image, setImage] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [tags, setTags] = useState([]);
  const [songs, setSongs] = useState([]);

  const handleCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('카메라 권한이 필요해요');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });
    if (!result.canceled) processImage(result.assets[0]);
  };

  const handleGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('사진 접근 권한이 필요해요');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7 });
    if (!result.canceled) processImage(result.assets[0]);
  };

  const processImage = async (asset) => {
    setImage(asset.uri);
    setSongs([]);
    setTags([]);
    setAnalyzing(true);
    try {
      const moodTags = await analyzeImageWithClaude(asset.base64);
      setTags(moodTags);
      setSongs(getMusicForTags(moodTags));
    } catch {
      // Fallback to demo tags if API not configured
      const demoTags = ['#밤길', '#고요함', '#차분', '#도시', '#감성'];
      setTags(demoTags);
      setSongs(getMusicForTags(demoTags));
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePlaySong = (song, index) => {
    play(song, songs.slice(index));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Snap & Play</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Image area */}
        <View style={styles.imageArea}>
          {image ? (
            <Image source={{ uri: image }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={styles.imagePlaceholder}>
              <CameraIcon size={40} color={COLORS.textMuted} />
              <Text style={styles.placeholderText}>사진을 찍거나 선택하면{'\n'}AI가 분위기를 분석해요</Text>
            </View>
          )}
          {analyzing && (
            <View style={styles.analyzingOverlay}>
              <ActivityIndicator size="large" color={COLORS.green} />
              <Text style={styles.analyzingText}>분위기 분석 중...</Text>
            </View>
          )}
        </View>

        {/* Capture buttons */}
        <View style={styles.captureRow}>
          <TouchableOpacity style={styles.captureBtn} onPress={handleCamera}>
            <Text style={{ fontSize: 20 }}>📷</Text>
            <Text style={styles.captureBtnText}>카메라</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.captureBtn} onPress={handleGallery}>
            <Text style={{ fontSize: 20 }}>🖼️</Text>
            <Text style={styles.captureBtnText}>갤러리</Text>
          </TouchableOpacity>
        </View>

        {/* Tags */}
        {tags.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={styles.sectionLabel}>AI 분위기 분석</Text>
            <View style={styles.tagsRow}>
              {tags.map((tag, i) => (
                <View key={i} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Song recommendations */}
        {songs.length > 0 && (
          <View style={styles.songsSection}>
            <Text style={styles.sectionLabel}>추천 음악</Text>
            {songs.map((song, i) => (
              <View key={song.id} style={styles.songRow}>
                <View style={[styles.albumArt, { backgroundColor: song.color + '44' }]}>
                  {i === 0 && <Text style={styles.rankBadge}>1</Text>}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.songTitle}>{song.title}</Text>
                  <Text style={styles.songArtist}>{song.artist}</Text>
                </View>
                <TouchableOpacity style={[styles.playBtn, i === 0 && styles.playBtnPrimary]}
                  onPress={() => handlePlaySong(song, i)}>
                  <Text style={{ color: i === 0 ? '#000' : COLORS.green, fontSize: 12, fontWeight: '700' }}>▶</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* Play all */}
            <TouchableOpacity style={styles.playAllBtn} onPress={() => handlePlaySong(songs[0], 0)}>
              <Text style={styles.playAllText}>▶  첫 번째 곡 바로 재생</Text>
            </TouchableOpacity>
          </View>
        )}

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
  imageArea: {
    height: 240, borderRadius: 16, overflow: 'hidden',
    backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 16,
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  placeholderText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,10,0.8)',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  analyzingText: { color: COLORS.text, fontSize: 14 },
  captureRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  captureBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  captureBtnText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  tagsSection: { marginBottom: 24 },
  sectionLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginBottom: 12 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: COLORS.green + '20', borderWidth: 1, borderColor: COLORS.green + '44',
  },
  tagText: { color: COLORS.green, fontSize: 13, fontWeight: '500' },
  songsSection: { marginBottom: 8 },
  songRow: {
    flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
  albumArt: { width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rankBadge: { color: COLORS.green, fontSize: 16, fontWeight: '800' },
  songTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  songArtist: { color: COLORS.textSub, fontSize: 12, marginTop: 2 },
  playBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.green + '22', alignItems: 'center', justifyContent: 'center',
  },
  playBtnPrimary: { backgroundColor: COLORS.green },
  playAllBtn: {
    marginTop: 8, paddingVertical: 14, borderRadius: 14,
    backgroundColor: COLORS.green, alignItems: 'center',
  },
  playAllText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
