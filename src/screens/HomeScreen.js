import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PlayerContext } from '../contexts/PlayerContext';
import { LocationContext } from '../contexts/LocationContext';
import { getWeatherMoodLabel } from '../services/weatherService';

const EMPTY_MARK = require('../../assets/EmptyMark.png');

const FEATURE_ACTIONS = [
  { key: 'place', label: '장소 정하기', icon: 'location-outline', screen: 'PlaceSetup' },
  { key: 'map', label: '뮤직지도', icon: 'map-outline', screen: 'MusicMap' },
  { key: 'like', label: '좋아요', icon: 'heart-outline' },
  { key: 'share', label: 'Shall we\nShare?', icon: 'arrow-redo-outline', screen: 'Vibe' },
];

const RECOMMENDED_TRACKS = [
  {
    id: 'place-recommended-track',
    source: 'place',
    sourceLabel: '장소 추천',
    title: "Nothing's Gonna Hurt You Baby",
    artist: 'Cigarettes After Sex',
    album: 'I.',
    color: '#FF9B91',
    spotifyUrl: 'https://open.spotify.com/track/1W7Eajq8Hlqiy39QnuKjvD',
    reason: '비 오는 성수동 카페에 어울리는 추천',
  },
  {
    id: 'weather-recommended-track',
    source: 'weather',
    sourceLabel: '날씨 추천',
    title: 'Cherry Wine',
    artist: 'Hozier',
    album: 'Spotify',
    color: '#D69A86',
    spotifyUrl: 'https://open.spotify.com/track/0QnW4TK50P6O4LI9UmXU8q',
    reason: '촉촉한 밤공기와 어울리는 추천',
  },
  {
    id: 'time-recommended-track',
    source: 'time',
    sourceLabel: '시간 추천',
    title: 'Thinkin Bout You',
    artist: 'Frank Ocean',
    album: 'Spotify',
    color: '#C9968C',
    spotifyUrl: 'https://open.spotify.com/track/7DfFc7a6Rwfi3YQMRbDMau',
    reason: '이 시간대에 자주 어울리는 추천',
  },
  {
    id: 'favorite-recommended-track',
    source: 'favorite',
    sourceLabel: '취향 추천',
    title: 'Night Owl',
    artist: 'Galimatias',
    album: 'Spotify',
    color: '#A98791',
    spotifyUrl: 'https://open.spotify.com/track/2WlO6U5m0pyQ5xXyDqS1V3',
    reason: '추천 후보가 부족할 때 이어지는 취향 기반 추천',
  },
];

const FALLBACK_TRACK = RECOMMENDED_TRACKS[0];

function formatTimeLabel() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const period = hours < 12 ? '오전' : '오후';
  return `${period} ${hours % 12 || 12}:${minutes}`;
}

function ContextChip({ icon, label, compact }) {
  return (
    <View style={styles.contextChip}>
      <Ionicons name={icon} size={compact ? 15 : 17} color="#FFD2C9" />
      <Text style={[styles.contextChipText, compact && styles.contextChipTextCompact]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function ActionTile({ action, onPress, tileHeight, compact }) {
  return (
    <TouchableOpacity style={[styles.actionTile, { height: tileHeight }]} activeOpacity={0.82} onPress={onPress}>
      <Ionicons name={action.icon} size={compact ? 34 : 42} color="#FFD2C9" />
      <Text style={[styles.actionLabel, compact && styles.actionLabelCompact]}>{action.label}</Text>
    </TouchableOpacity>
  );
}

function fitTitleSize(title, compact) {
  const length = title.length;
  if (length > 34) return compact ? 16 : 18;
  if (length > 26) return compact ? 18 : 21;
  if (length > 20) return compact ? 20 : 24;
  return compact ? 24 : 30;
}

function NowPlayingPill({ currentTrack, playerStatus, height, bottom, compact }) {
  const track = currentTrack || FALLBACK_TRACK;
  const isPlaying = Boolean(playerStatus?.isPlaying);
  const statusText = isPlaying ? 'Spotify에서 재생 중' : 'Spotify 재생 대기';

  return (
    <View style={[styles.nowPlayingPill, { height, bottom, borderRadius: height / 2 }]}>
      <View style={styles.nowPlayingTextWrap}>
        <Text style={[styles.nowPlayingEyebrow, compact && styles.nowPlayingEyebrowCompact]}>N O W   P L A Y I N G</Text>
        <Text style={[styles.nowPlayingTitle, compact && styles.nowPlayingTitleCompact]} numberOfLines={1}>
          {track.title}  ·  {track.artist}
        </Text>
        <Text style={[styles.nowPlayingSub, compact && styles.nowPlayingSubCompact]}>{statusText}</Text>
      </View>
      <Ionicons name="stats-chart-outline" size={compact ? 24 : 29} color="#FFB4A9" />
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { play, currentTrack, playerStatus } = useContext(PlayerContext);
  const {
    weather,
    hasForegroundPermission,
    hasBackgroundPermission,
    isLocating,
    locationError,
    autoPlayModeEnabled,
    setAutoPlayModeEnabled,
    prepareAutoPlayMode,
    requestPermissions,
  } = useContext(LocationContext);
  const { width, height } = useWindowDimensions();
  const [timeLabel, setTimeLabel] = useState(formatTimeLabel());
  const [isActionPanelOpen, setIsActionPanelOpen] = useState(false);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(0);
  const [artworkByTrackId, setArtworkByTrackId] = useState({});

  const isCompact = height < 760;
  const wheelSize = Math.min(width * (isCompact ? 0.48 : 0.53), isCompact ? 194 : 224);
  const albumInset = Math.max(7, wheelSize * 0.035);
  const sideInset = Math.max(22, width * 0.055);
  const isAutoPlayVisibleOn = autoPlayModeEnabled && hasBackgroundPermission;
  const contextTop = isCompact ? 104 : 118;
  const heroTop = contextTop + (isCompact ? 56 : 70);
  const dotsTop = heroTop + wheelSize + (isCompact ? 17 : 22);
  const trackTop = dotsTop + (isCompact ? 30 : 40);
  const tileHeight = isCompact ? 76 : 92;
  const nowPlayingHeight = isCompact ? 64 : 74;
  const nowPlayingBottom = isActionPanelOpen ? (isCompact ? 0 : 2) : 10;
  const nowPlayingTop = height - nowPlayingHeight - nowPlayingBottom;
  const closeSize = isCompact ? 44 : 50;
  const closeGap = isCompact ? 4 : 6;
  const panelPaddingY = isCompact ? 12 : 16;
  const panelHeight = tileHeight + panelPaddingY * 2;
  const panelTop = Math.max(
    trackTop + (isCompact ? 74 : 92),
    nowPlayingTop - closeSize - closeGap - panelHeight
  );
  const closeTop = nowPlayingTop - closeSize - closeGap;
  const selectedTrack = RECOMMENDED_TRACKS[selectedTrackIndex] || FALLBACK_TRACK;
  const albumArtworkUrl = artworkByTrackId[selectedTrack.id] || '';
  const titleFontSize = fitTitleSize(selectedTrack.title, isCompact);

  const moveRecommendation = (offset) => {
    setSelectedTrackIndex((prev) => {
      const next = prev + offset;
      if (next < 0) return RECOMMENDED_TRACKS.length - 1;
      if (next >= RECOMMENDED_TRACKS.length) return 0;
      return next;
    });
  };

  const wheelPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => (
      Math.abs(gestureState.dx) > 18 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
    ),
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx <= -35) {
        moveRecommendation(1);
      } else if (gestureState.dx >= 35) {
        moveRecommendation(-1);
      }
    },
  }), []);

  useEffect(() => {
    const interval = setInterval(() => setTimeLabel(formatTimeLabel()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let mounted = true;

    Promise.all(
      RECOMMENDED_TRACKS.map(async (track) => {
        try {
          const encodedUrl = encodeURIComponent(track.spotifyUrl);
          const response = await fetch(`https://open.spotify.com/oembed?url=${encodedUrl}`);
          const payload = response.ok ? await response.json() : null;
          return [track.id, payload?.thumbnail_url || ''];
        } catch (error) {
          return [track.id, ''];
        }
      })
    ).then((entries) => {
      if (mounted) {
        setArtworkByTrackId(Object.fromEntries(entries.filter(([, artworkUrl]) => artworkUrl)));
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const weatherLabel = useMemo(() => {
    if (weather) {
      const mood = getWeatherMoodLabel(weather.condition);
      return mood.includes('비') ? '비 오는 밤' : `${mood} 밤`;
    }
    return hasForegroundPermission ? '날씨 확인 중' : '비 오는 밤';
  }, [hasForegroundPermission, weather]);

  const placeLabel = weather?.city ? `${weather.city} 카페` : '성수동 카페';

  const handlePlay = async () => {
    if (!hasForegroundPermission) {
      try {
        await requestPermissions();
      } catch (error) {
        Alert.alert('위치 권한 실패', error.message || '위치 권한을 확인하지 못했습니다.');
      }
    }

    const orderedQueue = RECOMMENDED_TRACKS
      .slice(selectedTrackIndex)
      .concat(RECOMMENDED_TRACKS.slice(0, selectedTrackIndex));

    try {
      await play(selectedTrack, orderedQueue);
    } catch (error) {
      Alert.alert('Spotify 재생 실패', error.message || 'Spotify로 곡을 열지 못했습니다.');
    }
  };

  const handleAction = (action) => {
    if (action.screen) {
      navigation.navigate(action.screen);
    }
  };

  const handleWheelLongPress = () => {
    setIsActionPanelOpen(true);
  };

  const handleToggleAutoPlayMode = () => {
    if (isAutoPlayVisibleOn) {
      setAutoPlayModeEnabled(false).catch((error) => {
        Alert.alert('자동재생 설정 실패', error.message || '자동재생 모드를 끄지 못했습니다.');
      });
      return;
    }

    Alert.alert(
      '자동재생 모드 ON',
      '자동재생을 사용하기 위해 Spotify를 실행합니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '실행',
          onPress: async () => {
            try {
              await prepareAutoPlayMode();
            } catch (error) {
              Alert.alert('Spotify 실행 실패', error.message || 'Spotify를 실행하지 못했습니다.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.backdrop} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={[styles.topBar, { paddingHorizontal: sideInset }]}>
          <Text style={styles.logo}>NOWHERE</Text>
          <TouchableOpacity
            style={[styles.autoPlayToggle, isAutoPlayVisibleOn && styles.autoPlayToggleActive]}
            activeOpacity={0.82}
            onPress={handleToggleAutoPlayMode}
          >
            <Text style={[styles.autoPlayToggleText, isAutoPlayVisibleOn && styles.autoPlayToggleTextActive]}>
              {isAutoPlayVisibleOn ? 'AUTO ON' : 'AUTO OFF'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.contextRow, { top: contextTop }]}>
          <ContextChip icon="location-outline" label={placeLabel} compact={isCompact} />
          <ContextChip icon="time-outline" label={timeLabel} compact={isCompact} />
          <ContextChip icon="rainy-outline" label={weatherLabel} compact={isCompact} />
        </View>

        {locationError ? (
          <Text style={styles.locationWarning} numberOfLines={1}>{locationError}</Text>
        ) : null}

        <View style={[styles.heroWrap, { top: heroTop }]}>
          <TouchableOpacity style={styles.arrowButton} activeOpacity={0.8} onPress={() => moveRecommendation(-1)}>
            <Ionicons name="chevron-back-outline" size={38} color="#FFD2C9" />
          </TouchableOpacity>

          <TouchableOpacity
            {...wheelPanResponder.panHandlers}
            activeOpacity={0.88}
            onPress={handlePlay}
            onLongPress={handleWheelLongPress}
            delayLongPress={420}
            style={[
              styles.wheelOuter,
              {
                width: wheelSize,
                height: wheelSize,
                borderRadius: wheelSize / 2,
              },
            ]}
          >
            <Image
              source={albumArtworkUrl ? { uri: albumArtworkUrl } : EMPTY_MARK}
              style={[
                styles.wheelImage,
                {
                  width: wheelSize - albumInset * 2,
                  height: wheelSize - albumInset * 2,
                  borderRadius: (wheelSize - albumInset * 2) / 2,
                },
              ]}
              resizeMode="cover"
            />
            <View style={styles.wheelGlowDot} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.arrowButton} activeOpacity={0.8} onPress={() => moveRecommendation(1)}>
            <Ionicons name="chevron-forward-outline" size={38} color="#FFD2C9" />
          </TouchableOpacity>
        </View>

        <View style={[styles.pageDots, { top: dotsTop }]}>
          {RECOMMENDED_TRACKS.map((track, index) => (
            <View key={track.id} style={[styles.dot, index === selectedTrackIndex && styles.dotActive]} />
          ))}
        </View>

        <View style={[styles.trackBlock, { top: trackTop }]}>
          <View style={styles.titleRow}>
            <Text style={[styles.trackTitle, { fontSize: titleFontSize }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.74}>
              {selectedTrack.title}
            </Text>
          </View>
          <Text style={styles.trackMeta}>{selectedTrack.artist}</Text>
          <Text style={[styles.recommendReason, isCompact && styles.recommendReasonCompact]}>{selectedTrack.reason}</Text>
          <TouchableOpacity style={styles.playHint} activeOpacity={0.8} onPress={handlePlay} disabled={isLocating}>
            <Ionicons name="link-outline" size={22} color="#B9AAA7" />
            <Text style={styles.playHintText}>{isLocating ? '위치 확인 중' : '원을 탭하여 재생'}</Text>
          </TouchableOpacity>
        </View>

        {isActionPanelOpen ? (
          <View style={[styles.actionsPanel, { top: panelTop, paddingVertical: panelPaddingY }]}>
            <View style={styles.actionsRow}>
              {FEATURE_ACTIONS.map((action) => (
                <ActionTile
                  key={action.key}
                  action={action}
                  onPress={() => handleAction(action)}
                  tileHeight={tileHeight}
                  compact={isCompact}
                />
              ))}
            </View>
          </View>
        ) : null}

        {isActionPanelOpen ? (
          <TouchableOpacity
            style={[styles.closeButton, { top: closeTop, width: closeSize, height: closeSize, borderRadius: closeSize / 2, marginLeft: -closeSize / 2 }]}
            activeOpacity={0.8}
            onPress={() => setIsActionPanelOpen(false)}
          >
            <Ionicons name="close-outline" size={42} color="#FFD2C9" />
          </TouchableOpacity>
        ) : null}

        <NowPlayingPill
          currentTrack={currentTrack}
          playerStatus={playerStatus}
          height={nowPlayingHeight}
          bottom={nowPlayingBottom}
          compact={isCompact}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#07080A',
  },
  safeArea: {
    flex: 1,
    paddingTop: 18,
    paddingBottom: 10,
    position: 'relative',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    color: '#FFD2C9',
    fontSize: 22,
    fontWeight: '300',
    letterSpacing: 8,
  },
  autoPlayToggle: {
    minWidth: 76,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 210, 201, 0.45)',
    backgroundColor: 'rgba(39, 32, 33, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoPlayToggleActive: {
    borderColor: '#31D97C',
    backgroundColor: 'rgba(49, 217, 124, 0.22)',
  },
  autoPlayToggleText: {
    color: '#FFD2C9',
    fontSize: 11,
    fontWeight: '800',
  },
  autoPlayToggleTextActive: {
    color: '#6CFFA6',
  },
  contextRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  contextChip: {
    flex: 1,
    maxWidth: 122,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 168, 158, 0.58)',
    backgroundColor: 'rgba(45, 35, 34, 0.58)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  contextChipText: {
    color: '#F9D8D1',
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  contextChipTextCompact: {
    fontSize: 12,
  },
  locationWarning: {
    position: 'absolute',
    top: 151,
    left: 0,
    right: 0,
    color: '#FFB4A9',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  heroWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  arrowButton: {
    width: 44,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelOuter: {
    borderWidth: 2,
    borderColor: '#FF8E89',
    backgroundColor: 'rgba(26, 22, 23, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#FF8E89',
    shadowOpacity: 0.65,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  wheelImage: {
    opacity: 1,
  },
  wheelGlowDot: {
    position: 'absolute',
    right: 17,
    top: 49,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF928C',
    shadowColor: '#FF8E89',
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  pageDots: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
  },
  dot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  dotActive: {
    backgroundColor: '#FFAAA1',
  },
  trackBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  trackTitle: {
    color: '#FFE7E2',
    fontSize: 30,
    fontWeight: '300',
    letterSpacing: 0,
    textShadowColor: 'rgba(255, 174, 162, 0.45)',
    textShadowRadius: 10,
  },
  trackMeta: {
    color: '#EAD0CB',
    fontSize: 15,
    marginTop: 6,
  },
  recommendReason: {
    color: '#FF9186',
    fontSize: 15,
    marginTop: 16,
  },
  recommendReasonCompact: {
    fontSize: 15,
    marginTop: 14,
  },
  playHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
  },
  playHintText: {
    color: '#B9AAA7',
    fontSize: 14,
  },
  actionsPanel: {
    position: 'absolute',
    left: 14,
    right: 14,
    paddingHorizontal: 12,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255, 160, 150, 0.66)',
    backgroundColor: 'rgba(39, 29, 30, 0.70)',
    shadowColor: '#FF8D84',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -2 },
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 9,
  },
  actionTile: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 160, 150, 0.38)',
    backgroundColor: 'rgba(31, 28, 29, 0.73)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  actionLabel: {
    minHeight: 42,
    color: '#FFE5DF',
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
    fontWeight: '400',
  },
  actionLabelCompact: {
    minHeight: 34,
    fontSize: 14,
    lineHeight: 19,
  },
  closeButton: {
    position: 'absolute',
    left: '50%',
    marginLeft: -35,
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: 'rgba(255, 160, 150, 0.56)',
    backgroundColor: 'rgba(43, 33, 33, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowPlayingPill: {
    position: 'absolute',
    left: 38,
    right: 38,
    bottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 166, 154, 0.75)',
    backgroundColor: 'rgba(35, 29, 31, 0.82)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 12,
    shadowColor: '#FF8E89',
    shadowOpacity: 0.48,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
  },
  nowPlayingTextWrap: {
    flex: 1,
    alignItems: 'center',
  },
  nowPlayingEyebrow: {
    color: '#EAB8B1',
    fontSize: 11,
    letterSpacing: 4,
  },
  nowPlayingEyebrowCompact: {
    fontSize: 11,
    letterSpacing: 4,
  },
  nowPlayingTitle: {
    color: '#FFE2DC',
    fontSize: 15,
    marginTop: 6,
    maxWidth: '100%',
  },
  nowPlayingTitleCompact: {
    fontSize: 15,
    marginTop: 4,
  },
  nowPlayingSub: {
    color: '#B9AAA7',
    fontSize: 13,
    marginTop: 3,
  },
  nowPlayingSubCompact: {
    fontSize: 11,
    marginTop: 2,
  },
});
