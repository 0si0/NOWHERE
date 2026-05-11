import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
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
import { useSession } from '../contexts/SessionContext';
import ChallengePanel from '../components/ChallengePanel';
import { buildListeningContext, recordListeningEvent } from '../services/listeningHistoryService';
import { clearRecommendationCache, getChallengeRecommendation, getRecommendationSlots } from '../services/recommendationService';
import { getWeatherMoodLabel } from '../services/weatherService';

const EMPTY_MARK = require('../../assets/EmptyMark.png');
const CHALLENGE_MARK = require('../../assets/ChallengeMark.png');

const UI = {
  bg: '#05070A',
  text: '#FFF1EC',
  textSoft: '#D9C6C0',
  textMuted: '#9E908D',
  peach: '#FFC8B8',
  peachStrong: '#FFB09E',
  border: 'rgba(255, 201, 184, 0.32)',
  surface: 'rgba(34, 31, 30, 0.72)',
  surfaceDark: 'rgba(14, 14, 15, 0.72)',
  green: '#6EE89A',
};

const FEATURE_ACTIONS = [
  { key: 'place', label: '장소에 남기기', icon: 'location-outline', screen: 'PlaceSetup' },
  { key: 'map', label: '뮤직지도', icon: 'map-outline', screen: 'MusicMap' },
  { key: 'like', label: '좋아요', icon: 'heart-outline' },
  { key: 'share', label: 'Shall We Share', icon: 'arrow-redo-outline', screen: 'Vibe' },
];

const SPOTIFY_REQUIRED_SLOT = {
  id: 'spotify-required-recommendation',
  slotType: 'taste',
  source: 'taste',
  sourceLabel: 'Spotify 연결 필요',
  title: 'Spotify 연결 필요',
  artist: '권한 확인 후 추천을 불러옵니다',
  color: '#A98791',
  reason: 'Spotify 권한과 실행 상태를 확인해야 추천을 만들 수 있어요.',
  isActionRequired: true,
};

const INITIAL_RECOMMENDATION_SLOTS = [
  { ...SPOTIFY_REQUIRED_SLOT, id: 'spotify-required-taste', slotType: 'taste', source: 'taste', sourceLabel: '요즘 자주 듣는곡' },
  { ...SPOTIFY_REQUIRED_SLOT, id: 'spotify-required-time', slotType: 'time', source: 'time', sourceLabel: '오늘 이 시간의 추천' },
  { ...SPOTIFY_REQUIRED_SLOT, id: 'spotify-required-place', slotType: 'place', source: 'place', sourceLabel: '이곳에 어울리는 곡' },
  { ...SPOTIFY_REQUIRED_SLOT, id: 'spotify-required-weather', slotType: 'weather', source: 'weather', sourceLabel: '오늘 이 날씨의 추천' },
  {
    id: 'pending-challenge',
    slotType: 'challenge',
    source: 'challenge',
    sourceLabel: '오늘은 어떤 곡에 도전해볼까요?',
    title: 'CHALLENGE',
    artist: '새로운 음악 도전',
    color: '#B99BFF',
    reason: '오늘은 어떤 곡에 도전해볼까요?',
    isChallenge: true,
  },
];

const FALLBACK_TRACK = SPOTIFY_REQUIRED_SLOT;

function getTrackKey(track = {}) {
  if (track.isPending || track.isActionRequired) return '';
  return track.spotifyUri || track.id || `${track.title || ''}-${track.artist || ''}`;
}

function getTrackExcludeKeys(track = {}) {
  if (track.isPending || track.isActionRequired) return [];
  return [
    track.spotifyUri,
    track.uri,
    track.id,
    `${track.title || ''}-${track.artist || ''}`,
    `${track.title || ''}::${track.artist || ''}`,
  ].filter(Boolean);
}

function isPlayableRecommendationSlot(slot = {}) {
  return Boolean(
    slot &&
    !slot.isPending &&
    !slot.isActionRequired &&
    !slot.isChallenge &&
    slot.slotType !== 'challenge' &&
    slot.spotifyUri &&
    slot.title &&
    slot.artist &&
    slot.artworkUrl
  );
}

function formatTimeLabel() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const period = hours < 12 ? '오전' : '오후';
  return `${period} ${hours % 12 || 12}:${minutes}`;
}

function getTimeWord() {
  const hour = new Date().getHours();
  if (hour < 6) return '새벽';
  if (hour < 12) return '아침';
  if (hour < 17) return '오후';
  if (hour < 21) return '저녁';
  return '밤';
}

function getWeatherIcon(condition, hour = new Date().getHours()) {
  if (condition === 'Clear') {
    return hour >= 18 || hour < 6 ? 'moon-outline' : 'sunny-outline';
  }
  if (condition === 'Clouds') return 'cloudy-outline';
  if (condition === 'Rain' || condition === 'Drizzle') return 'rainy-outline';
  if (condition === 'Snow') return 'snow-outline';
  if (condition === 'Thunderstorm') return 'thunderstorm-outline';
  return 'partly-sunny-outline';
}

function buildArtworkSource(artworkUrl) {
  return artworkUrl ? { uri: artworkUrl, cache: 'reload' } : EMPTY_MARK;
}

function getRecommendationCaption(slotType) {
  switch (slotType) {
    case 'taste':
      return '요즘 자주 듣는곡';
    case 'time':
      return '오늘 이 시간의 추천';
    case 'place':
      return '이곳에 어울리는 곡';
    case 'weather':
      return '오늘 이 날씨의 추천';
    case 'challenge':
      return '도전해보세요';
    default:
      return '오늘의 추천';
  }
}

function ContextChip({ icon, label, compact }) {
  return (
    <View style={styles.contextChip}>
      <Ionicons name={icon} size={compact ? 16 : 18} color={UI.peach} />
      <Text
        style={[styles.contextChipText, compact && styles.contextChipTextCompact]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
      >
        {label}
      </Text>
    </View>
  );
}

function ActionTile({ action, onPress, compact, active, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.actionTile, active && styles.actionTileActive, disabled && styles.actionTileDisabled]}
      activeOpacity={0.82}
      onPress={onPress}
      disabled={disabled}
    >
      <Ionicons
        name={active && action.key === 'like' ? 'heart' : action.icon}
        size={compact ? 22 : 26}
        color={active ? UI.green : UI.peach}
      />
      <Text
        style={[styles.actionLabel, compact && styles.actionLabelCompact]}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {action.label}
      </Text>
    </TouchableOpacity>
  );
}

function NowPlayingCard({ currentTrack, playerStatus, compact }) {
  const track = currentTrack || FALLBACK_TRACK;
  const isPlaying = Boolean(playerStatus?.isPlaying);
  return (
    <View style={styles.nowPlayingCard}>
      <Image
        source={buildArtworkSource(track?.artworkUrl)}
        style={[styles.nowPlayingArtwork, compact && styles.nowPlayingArtworkCompact]}
      />
      <View style={styles.nowPlayingTextWrap}>
        <Text
          style={styles.nowPlayingEyebrow}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          N O W   P L A Y I N G
        </Text>
        <MarqueeText
          style={[styles.nowPlayingTitle, compact && styles.nowPlayingTitleCompact]}
          containerStyle={styles.nowPlayingTitleClip}
        >
          {track.title}
        </MarqueeText>
        <Text style={styles.nowPlayingSub} numberOfLines={1}>
          {isPlaying ? 'Spotify에서 재생 중' : 'Spotify 재생 대기'}
        </Text>
      </View>
      <Ionicons name="stats-chart-outline" size={24} color={UI.peach} />
    </View>
  );
}

function MarqueeText({ children, style, containerStyle }) {
  const text = String(children || '');
  const translateX = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const overflow = Math.max(0, textWidth - containerWidth);
  const shouldAnimate = containerWidth > 0 && overflow > 8;

  useEffect(() => {
    translateX.stopAnimation();
    translateX.setValue(0);

    if (!shouldAnimate) {
      return undefined;
    }

    const distance = overflow + 24;
    const moveDuration = Math.max(7800, distance * 70);
    const returnDuration = Math.max(2200, moveDuration * 0.32);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(1000),
        Animated.timing(translateX, {
          toValue: -distance,
          duration: moveDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(700),
        Animated.timing(translateX, {
          toValue: 0,
          duration: returnDuration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(800),
      ])
    );

    animation.start();
    return () => {
      animation.stop();
      translateX.stopAnimation();
      translateX.setValue(0);
    };
  }, [overflow, shouldAnimate, translateX]);

  return (
    <View
      style={[styles.marqueeClip, containerStyle]}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
    >
      <Text
        style={[style, styles.marqueeMeasure]}
        numberOfLines={1}
        onTextLayout={(event) => {
          const width = event.nativeEvent.lines?.[0]?.width || 0;
          if (width) {
            setTextWidth(width);
          }
        }}
      >
        {text}
      </Text>
      {shouldAnimate ? (
        <Animated.Text
          style={[style, styles.marqueeMoving, { transform: [{ translateX }] }]}
          numberOfLines={1}
        >
          {text}
        </Animated.Text>
      ) : (
        <Text style={[style, styles.marqueeStatic]} numberOfLines={1}>
          {text}
        </Text>
      )}
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { play, currentTrack, playerStatus, prepareAutoPlay, requestAuthorization, getState } = useContext(PlayerContext);
  const {
    location,
    placeName,
    weather,
    hasForegroundPermission,
    hasBackgroundPermission,
    isLocating,
    locationError,
    foregroundPermission,
    autoPlayModeEnabled,
    setAutoPlayModeEnabled,
    prepareAutoPlayMode,
    requestPermissions,
  } = useContext(LocationContext);
  const { authUser } = useSession();
  const { width, height } = useWindowDimensions();
  const [timeLabel, setTimeLabel] = useState(formatTimeLabel());
  const [isChallengeOpen, setIsChallengeOpen] = useState(false);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(0);
  const [recommendationSlots, setRecommendationSlots] = useState(INITIAL_RECOMMENDATION_SLOTS);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(true);
  const [likedTrackId, setLikedTrackId] = useState('');
  const [likeFeedback, setLikeFeedback] = useState('');
  const recommendationRefreshInFlightRef = useRef(false);
  const selectedTrackKeyRef = useRef('');
  const selectedTrackRef = useRef(FALLBACK_TRACK);
  const screenReadyRef = useRef(false);
  const startupRecommendationRefreshRef = useRef(false);
  const seenRecommendationKeysRef = useRef([]);
  const spotifyEnsureInFlightRef = useRef(false);
  const locationPromptShownRef = useRef(false);

  const isTiny = height < 740;
  const isCompact = height < 820;
  const sideInset = Math.max(18, width * 0.055);
  const wheelSize = Math.min(width * (isTiny ? 0.43 : isCompact ? 0.49 : 0.54), isTiny ? 178 : isCompact ? 216 : 262);
  const albumInset = Math.max(6, wheelSize * 0.024);
  const selectedTrack = recommendationSlots[selectedTrackIndex] || FALLBACK_TRACK;
  const wheelImageSource = selectedTrack.isChallenge
    ? CHALLENGE_MARK
    : buildArtworkSource(selectedTrack.artworkUrl);

  useEffect(() => {
    if (locationPromptShownRef.current || foregroundPermission !== 'undetermined') {
      return;
    }

    locationPromptShownRef.current = true;
    const timer = setTimeout(() => {
      requestPermissions().catch(() => {});
    }, 600);

    return () => clearTimeout(timer);
  }, [foregroundPermission, requestPermissions]);
  const titleFontSize = isCompact ? 24 : 31;
  const isAutoPlayVisibleOn = autoPlayModeEnabled && hasBackgroundPermission;

  const recommendationContext = useMemo(() => (
    buildListeningContext({
      location,
      weather,
      place: placeName ? { name: placeName } : null,
    })
  ), [location, placeName, weather]);

  const weatherLabel = useMemo(() => {
    if (weather) {
      const mood = getWeatherMoodLabel(weather.condition);
      return mood.includes('비') ? `비 오는 ${getTimeWord()}` : `${mood} ${getTimeWord()}`;
    }
    return hasForegroundPermission ? '날씨 확인 중' : '날씨 권한 필요';
  }, [hasForegroundPermission, weather]);
  const weatherIcon = useMemo(() => getWeatherIcon(weather?.condition), [weather?.condition]);

  const placeLabel = placeName
    ? placeName
    : isLocating
      ? '장소 확인 중'
      : hasForegroundPermission
        ? '현재 위치'
        : '위치 권한 필요';

  const recommendationCaption = getRecommendationCaption(selectedTrack.slotType);
  const recommendationLabel = selectedTrack.sourceLabel || recommendationCaption;
  const selectedTrackKey = getTrackKey(selectedTrack);
  const isSelectedTrackLiked = Boolean(selectedTrackKey && likedTrackId === selectedTrackKey);
  const locationKey = location
    ? `${Number(location.latitude).toFixed(4)},${Number(location.longitude).toFixed(4)}`
    : '';
  const recommendationLocation = useMemo(() => {
    if (!locationKey) return null;
    const [latitude, longitude] = locationKey.split(',').map(Number);
    return { latitude, longitude };
  }, [locationKey]);

  const moveRecommendation = useCallback((offset) => {
    setSelectedTrackIndex((prev) => {
      if (recommendationSlots.length <= 0) return 0;
      const next = prev + offset;
      if (next < 0) return recommendationSlots.length - 1;
      if (next >= recommendationSlots.length) return 0;
      return next;
    });
  }, [recommendationSlots.length]);

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
  }), [moveRecommendation]);

  useEffect(() => {
    const interval = setInterval(() => setTimeLabel(formatTimeLabel()), 30000);
    return () => clearInterval(interval);
  }, []);

  const rememberRecommendationSlots = useCallback((slots = []) => {
    const nextKeys = [...seenRecommendationKeysRef.current];
    slots
      .filter((slot) => slot && !slot.isChallenge && slot.slotType !== 'challenge')
      .flatMap(getTrackExcludeKeys)
      .forEach((key) => {
        if (!nextKeys.includes(key)) {
          nextKeys.push(key);
        }
      });

    seenRecommendationKeysRef.current = nextKeys.slice(-32);
  }, []);

  const getRefreshExcludeKeys = useCallback(() => {
    return Array.from(new Set([
      ...getTrackExcludeKeys(selectedTrackRef.current),
      ...seenRecommendationKeysRef.current,
    ]));
  }, []);

  const refreshRecommendations = useCallback(async ({
    force = false,
    showLoading = false,
    advance = false,
    refreshSeed = null,
    allowSpotifyPrompt = true,
  } = {}) => {
    if (recommendationRefreshInFlightRef.current) {
      return;
    }

    recommendationRefreshInFlightRef.current = true;
    if (showLoading) {
      setIsLoadingRecommendations(true);
    }
    try {
      let slots = await getRecommendationSlots({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        location: recommendationLocation,
        weather,
        place: placeName ? { name: placeName } : null,
        force,
        excludeTrackKeys: advance ? getRefreshExcludeKeys() : [],
        refreshSeed: refreshSeed ?? (force ? Date.now() : 0),
      });

      let playableSlots = Array.isArray(slots)
        ? slots.filter(isPlayableRecommendationSlot)
        : [];

      if (playableSlots.length < 4 && allowSpotifyPrompt) {
        await requestAuthorization({ forcePrompt: true });
        await prepareAutoPlay(null).catch(() => {});
        slots = await getRecommendationSlots({
          userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
          location: recommendationLocation,
          weather,
          place: placeName ? { name: placeName } : null,
          force: true,
          excludeTrackKeys: advance ? getRefreshExcludeKeys() : [],
          refreshSeed: Date.now(),
        });
        playableSlots = Array.isArray(slots)
          ? slots.filter(isPlayableRecommendationSlot)
          : [];
      }

      const validSlots = Array.isArray(slots)
        ? slots.filter(Boolean)
        : [];
      if (playableSlots.length >= 4 && validSlots.length > 0) {
        rememberRecommendationSlots(slots);
        setRecommendationSlots(slots);
        if (advance) {
          if (playableSlots.length > 0) {
            const currentKey = selectedTrackKeyRef.current;
            const currentIndex = playableSlots.findIndex((slot) => getTrackKey(slot) === currentKey);
            const nextPlayable = playableSlots[(Math.max(currentIndex, 0) + 1) % playableSlots.length] || playableSlots[0];
            const nextIndex = slots.findIndex((slot) => getTrackKey(slot) === getTrackKey(nextPlayable));
            setSelectedTrackIndex(nextIndex >= 0 ? nextIndex : 0);
          }
        }
      } else {
        Alert.alert('Spotify 연결 필요', '추천곡과 앨범표지를 가져오려면 Spotify 권한을 다시 확인해주세요.');
      }
    } catch (error) {
      if (showLoading) {
        Alert.alert(
          'Spotify 연결 필요',
          error.message || '추천곡과 앨범표지를 가져오려면 Spotify 권한을 다시 확인해주세요.'
        );
      }
    } finally {
      recommendationRefreshInFlightRef.current = false;
      if (showLoading) {
        setIsLoadingRecommendations(false);
      }
    }
  }, [
    authUser?.isAnonymous,
    authUser?.uid,
    getRefreshExcludeKeys,
    placeName,
    prepareAutoPlay,
    recommendationLocation,
    rememberRecommendationSlots,
    requestAuthorization,
    weather,
  ]);

  const shouldAskToOpenSpotify = useCallback((state = playerStatus) => {
    const status = state?.playbackStatus || 'idle';
    if (state?.isPlaying) {
      return false;
    }
    if ([
      'playing',
      'paused',
      'openedSpotify',
      'loading',
      'preparingAutoPlay',
      'appRemoteOpeningSpotify',
      'appRemoteAwaitingSpotify',
      'appRemoteAuthorized',
      'appRemoteConnected',
    ].includes(status)) {
      return false;
    }
    return true;
  }, [playerStatus]);

  const ensureSpotifyRunningAndRefresh = useCallback(async ({
    enableAutoPlayMode = false,
    showLoading = true,
  } = {}) => {
    if (spotifyEnsureInFlightRef.current) {
      return;
    }

    spotifyEnsureInFlightRef.current = true;
    try {
      const state = await getState().catch(() => null);

      if (enableAutoPlayMode) {
        await prepareAutoPlayMode();
      } else if (shouldAskToOpenSpotify(state)) {
        await prepareAutoPlay(null).catch(() => {});
      }

      await clearRecommendationCache();
      await refreshRecommendations({ force: true, showLoading, refreshSeed: Date.now() });
    } finally {
      spotifyEnsureInFlightRef.current = false;
    }
  }, [
    getState,
    prepareAutoPlay,
    prepareAutoPlayMode,
    refreshRecommendations,
    shouldAskToOpenSpotify,
  ]);

  useEffect(() => {
    screenReadyRef.current = true;
    if (startupRecommendationRefreshRef.current) {
      return undefined;
    }

    startupRecommendationRefreshRef.current = true;
    clearRecommendationCache()
      .then(() => refreshRecommendations({ force: true, showLoading: true, refreshSeed: Date.now() }))
      .catch(() => {
        setIsLoadingRecommendations(false);
      });
    return undefined;
  }, [refreshRecommendations]);

  useEffect(() => {
    if (selectedTrackIndex < 0 || selectedTrackIndex >= recommendationSlots.length) {
      setSelectedTrackIndex(0);
    }
  }, [recommendationSlots.length, selectedTrackIndex]);

  useEffect(() => {
    setLikeFeedback('');
    selectedTrackKeyRef.current = selectedTrackKey;
    selectedTrackRef.current = selectedTrack;
  }, [selectedTrack, selectedTrackKey]);

  const handlePlay = async () => {
    if (selectedTrack.isPending || selectedTrack.isActionRequired) {
      await refreshRecommendations({
        force: true,
        showLoading: true,
        refreshSeed: Date.now(),
        allowSpotifyPrompt: true,
      });
      return;
    }

    if (selectedTrack.isChallenge) {
      setIsChallengeOpen(true);
      return;
    }

    if (!hasForegroundPermission) {
      try {
        await requestPermissions();
      } catch (error) {
        Alert.alert('위치 권한 실패', error.message || '위치 권한을 확인하지 못했습니다.');
      }
    }

    const playableSlots = recommendationSlots.filter((track) => !track.isPending && !track.isChallenge);
    const playableIndex = playableSlots.findIndex((track) => track.id === selectedTrack.id);
    const queueStartIndex = playableIndex >= 0 ? playableIndex : 0;
    const orderedQueue = playableSlots
      .slice(queueStartIndex)
      .concat(playableSlots.slice(0, queueStartIndex));

    try {
      const state = await getState().catch(() => null);
      if (shouldAskToOpenSpotify(state)) {
        await prepareAutoPlay(selectedTrack).catch(() => {});
      }
      await play(selectedTrack, orderedQueue);
      await recordListeningEvent({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        track: selectedTrack,
        source: 'recommendation',
        recommendationSlot: selectedTrack.slotType || selectedTrack.source || '',
        context: recommendationContext,
      }).catch(() => {});
    } catch (error) {
      Alert.alert('Spotify 재생 실패', error.message || 'Spotify로 곡을 열지 못했습니다.');
    }
  };

  const handleChallengeSubmit = async (challenge) => {
    try {
      const challengeTrack = await getChallengeRecommendation({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        location,
        weather,
        challenge,
      });
      const nextTrack = {
        ...challengeTrack,
        isChallenge: false,
        slotType: 'challenge',
        source: 'challenge',
        sourceLabel: '오늘은 어떤 곡에 도전해볼까요?',
        color: '#B99BFF',
      };
      setIsChallengeOpen(false);
      await play(nextTrack, [nextTrack]);
      await recordListeningEvent({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        track: nextTrack,
        source: 'challenge',
        recommendationSlot: 'challenge',
        context: recommendationContext,
        challenge,
      }).catch(() => {});
    } catch (error) {
      Alert.alert('Challenge 추천 실패', error.message || '선택한 조합으로 추천을 만들지 못했습니다.');
    }
  };

  const handleAction = (action) => {
    if (action.key === 'like') {
      if (selectedTrack.isPending || selectedTrack.isActionRequired) {
        return;
      }

      if (selectedTrack.isChallenge) {
        setIsChallengeOpen(true);
        return;
      }

      setLikedTrackId(selectedTrackKey);
      setLikeFeedback('비슷한 순간에 더 자주 추천할게요.');
      recordListeningEvent({
        userId: authUser?.uid && !authUser.isAnonymous ? authUser.uid : '',
        track: selectedTrack,
        eventType: 'like',
        source: 'moment-action-like',
        recommendationSlot: selectedTrack.slotType || selectedTrack.source || '',
        context: recommendationContext,
      })
        .then(() => clearRecommendationCache())
        .catch(() => {
          setLikeFeedback('좋아요 저장에 실패했습니다.');
        });
      return;
    }

    if (action.screen) {
      navigation.navigate(action.screen);
    }
  };

  const handleRefreshRecommendationPress = async () => {
    await refreshRecommendations({ force: true, showLoading: true, advance: true });
  };

  const handleToggleAutoPlayMode = () => {
    if (isAutoPlayVisibleOn) {
      setAutoPlayModeEnabled(false).catch((error) => {
        Alert.alert('자동재생 설정 실패', error.message || '자동재생 모드를 끄지 못했습니다.');
      });
      return;
    }

    ensureSpotifyRunningAndRefresh({ enableAutoPlayMode: true, showLoading: true }).catch((error) => {
      Alert.alert('자동재생 설정 실패', error.message || 'Spotify 실행 또는 자동재생 설정에 실패했습니다.');
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.backdrop} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={[styles.screenContent, { paddingHorizontal: sideInset }]}>
          <View style={styles.topBar}>
            <Text style={[styles.logo, isCompact && styles.logoCompact]}>NOWHERE</Text>
            <TouchableOpacity
              style={[styles.autoPlayToggle, isAutoPlayVisibleOn && styles.autoPlayToggleActive]}
              activeOpacity={0.82}
              onPress={handleToggleAutoPlayMode}
            >
              <View style={[styles.autoPlayDot, isAutoPlayVisibleOn && styles.autoPlayDotActive]} />
              <Text style={[styles.autoPlayToggleText, isAutoPlayVisibleOn && styles.autoPlayToggleTextActive]}>
                {isAutoPlayVisibleOn ? 'AUTO ON' : 'AUTO OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.contextRow}>
            <ContextChip icon="location-outline" label={placeLabel} compact={isCompact} />
            <ContextChip icon="time-outline" label={timeLabel} compact={isCompact} />
            <ContextChip icon={weatherIcon} label={weatherLabel} compact={isCompact} />
          </View>

          {locationError ? (
            <Text style={styles.locationWarning} numberOfLines={1}>{locationError}</Text>
          ) : null}

          <View style={styles.sectionCaptionRow}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionCaption}>{recommendationCaption}</Text>
          </View>

          <View style={styles.heroWrap}>
            <TouchableOpacity style={styles.arrowButton} activeOpacity={0.8} onPress={() => moveRecommendation(-1)}>
              <Ionicons name="chevron-back-outline" size={32} color={UI.peach} />
            </TouchableOpacity>

            <View style={styles.wheelFrame}>
              <TouchableOpacity
                {...wheelPanResponder.panHandlers}
                activeOpacity={0.9}
                onPress={handlePlay}
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
                  source={wheelImageSource}
                  resizeMode="cover"
                  style={[
                    styles.wheelImage,
                    selectedTrack.isChallenge && styles.challengeWheelImage,
                    {
                      width: wheelSize - albumInset * 2,
                      height: wheelSize - albumInset * 2,
                      borderRadius: (wheelSize - albumInset * 2) / 2,
                    },
                  ]}
                />
                {selectedTrack.isChallenge ? null : <View style={styles.wheelGlass} />}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.wheelRefreshButton}
                activeOpacity={0.82}
                onPress={handleRefreshRecommendationPress}
              >
                <Ionicons name="refresh-outline" size={19} color={UI.peach} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.arrowButton} activeOpacity={0.8} onPress={() => moveRecommendation(1)}>
              <Ionicons name="chevron-forward-outline" size={32} color={UI.peach} />
            </TouchableOpacity>
          </View>

          <View style={styles.pageDots}>
            {recommendationSlots.map((track, index) => (
              <View key={track.id} style={[styles.dot, index === selectedTrackIndex && styles.dotActive]} />
            ))}
          </View>

          <View style={styles.trackBlock}>
            <Text style={styles.recommendationLabel} numberOfLines={1}>
              {recommendationLabel}
            </Text>
            <MarqueeText
              style={[styles.trackTitle, { fontSize: titleFontSize }]}
              containerStyle={styles.trackTitleClip}
            >
              {selectedTrack.title}
            </MarqueeText>
            <Text style={styles.trackArtist} numberOfLines={1}>{selectedTrack.artist}</Text>
            <Text style={styles.tapHint}>
              {selectedTrack.isActionRequired
                ? '원을 탭하여 Spotify 연결 확인'
                : isLoadingRecommendations
                  ? 'Spotify 추천을 불러오는 중'
                  : '원을 탭하여 듣기'}
            </Text>
          </View>

          <View style={styles.actionsPanel}>
            <View style={styles.actionsTitleRow}>
              <Text style={styles.actionsEyebrow}>M O M E N T   A C T I O N S</Text>
              <View style={styles.actionsLine} />
            </View>
            <View style={styles.actionsRow}>
              {FEATURE_ACTIONS.map((action) => (
                <ActionTile
                  key={action.key}
                  action={action}
                  onPress={() => handleAction(action)}
                  compact={isCompact}
                  active={action.key === 'like' && isSelectedTrackLiked}
                  disabled={action.key === 'like' && (isLoadingRecommendations || selectedTrack.isActionRequired)}
                />
              ))}
            </View>
            {likeFeedback ? <Text style={styles.likeFeedback}>{likeFeedback}</Text> : null}
          </View>

          <NowPlayingCard
            currentTrack={currentTrack || (selectedTrack.isPending || selectedTrack.isActionRequired ? null : selectedTrack)}
            playerStatus={playerStatus}
            compact={isCompact}
          />
        </View>

        <ChallengePanel
          visible={isChallengeOpen}
          onClose={() => setIsChallengeOpen(false)}
          onSubmit={handleChallengeSubmit}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI.bg },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: UI.bg,
  },
  safeArea: {
    flex: 1,
  },
  screenContent: {
    flex: 1,
    paddingTop: 18,
    paddingBottom: 12,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
  },
  logo: {
    color: UI.text,
    fontSize: 23,
    fontWeight: '300',
    letterSpacing: 10,
  },
  logoCompact: {
    fontSize: 20,
    letterSpacing: 8,
  },
  autoPlayToggle: {
    minWidth: 90,
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.38)',
    backgroundColor: 'rgba(31, 29, 29, 0.74)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  autoPlayToggleActive: {
    borderColor: 'rgba(110, 232, 154, 0.35)',
    backgroundColor: 'rgba(33, 56, 39, 0.52)',
  },
  autoPlayDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(255, 201, 184, 0.7)',
  },
  autoPlayDotActive: {
    backgroundColor: UI.green,
  },
  autoPlayToggleText: {
    color: UI.peach,
    fontSize: 11,
    fontWeight: '800',
  },
  autoPlayToggleTextActive: {
    color: UI.green,
  },
  contextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 18,
  },
  contextChip: {
    flex: 1,
    minWidth: 0,
    height: 34,
    paddingHorizontal: 7,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(38, 33, 31, 0.72)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  contextChipText: {
    color: UI.text,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
    minWidth: 0,
  },
  contextChipTextCompact: {
    fontSize: 11,
  },
  locationWarning: {
    color: UI.peachStrong,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 6,
  },
  sectionCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  sectionAccent: {
    width: 3,
    height: 21,
    borderRadius: 2,
    backgroundColor: UI.peach,
  },
  sectionCaption: {
    color: UI.textSoft,
    fontSize: 12,
    fontWeight: '500',
  },
  heroWrap: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wheelFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.24)',
    backgroundColor: 'rgba(54, 44, 39, 0.7)',
  },
  wheelOuter: {
    borderWidth: 2,
    borderColor: 'rgba(255, 215, 204, 0.7)',
    backgroundColor: 'rgba(31, 29, 29, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: UI.peach,
    shadowOpacity: 0.42,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  wheelImage: {
    opacity: 0.92,
  },
  challengeWheelImage: {
    opacity: 1,
  },
  wheelGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 9,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  wheelRefreshButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.38)',
    backgroundColor: 'rgba(17, 17, 18, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    marginTop: 13,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  dotActive: {
    backgroundColor: UI.peach,
  },
  trackBlock: {
    alignItems: 'center',
    marginTop: 13,
  },
  recommendationLabel: {
    color: UI.peach,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
  },
  marqueeClip: {
    overflow: 'hidden',
  },
  marqueeMeasure: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
    flexShrink: 0,
  },
  marqueeMoving: {
    alignSelf: 'flex-start',
    flexShrink: 0,
    textAlign: 'left',
  },
  marqueeStatic: {
    width: '100%',
  },
  trackTitleClip: {
    width: '100%',
    height: 39,
    justifyContent: 'center',
  },
  trackTitle: {
    maxWidth: '100%',
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0,
    textAlign: 'center',
  },
  trackArtist: {
    color: UI.textMuted,
    fontSize: 15,
    marginTop: 5,
    fontWeight: '500',
  },
  tapHint: {
    marginTop: 7,
    color: UI.textMuted,
    fontSize: 11,
  },
  actionsPanel: {
    marginTop: 'auto',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.22)',
    backgroundColor: 'rgba(20, 20, 20, 0.72)',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  actionsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 7,
    marginBottom: 9,
  },
  actionsEyebrow: {
    color: UI.peach,
    fontSize: 8,
    letterSpacing: 4,
    fontWeight: '700',
  },
  actionsLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 201, 184, 0.22)',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 7,
  },
  actionTile: {
    flex: 1,
    minHeight: 66,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.28)',
    backgroundColor: 'rgba(47, 43, 40, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  actionTileActive: {
    borderColor: 'rgba(110, 232, 154, 0.48)',
    backgroundColor: 'rgba(34, 58, 41, 0.72)',
  },
  actionTileDisabled: {
    opacity: 0.62,
  },
  actionLabel: {
    color: UI.text,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
    fontWeight: '600',
  },
  actionLabelCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  likeFeedback: {
    color: UI.green,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  nowPlayingCard: {
    marginTop: 12,
    minHeight: 62,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.22)',
    backgroundColor: 'rgba(32, 30, 29, 0.82)',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
  },
  nowPlayingArtwork: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  nowPlayingArtworkCompact: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  nowPlayingTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  nowPlayingEyebrow: {
    color: UI.peach,
    fontSize: 8,
    letterSpacing: 3,
    fontWeight: '700',
  },
  nowPlayingTitle: {
    color: UI.text,
    fontSize: 14,
    fontWeight: '700',
  },
  nowPlayingTitleClip: {
    width: '100%',
    height: 20,
    marginTop: 6,
  },
  nowPlayingTitleCompact: {
    fontSize: 13,
  },
  nowPlayingSub: {
    color: UI.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
});
