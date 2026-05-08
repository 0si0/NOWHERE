import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const GENRES = [
  '힙합',
  'R&B',
  '인디',
  'POP',
  'KPOP',
  'JPOP',
  '락',
  '발라드',
  '재즈',
  'Lo-fi',
  '시티팝',
  'EDM',
  '하우스',
  '테크노',
  '어쿠스틱',
  '클래식',
  'OST',
];

const COUNTRIES = [
  '한국',
  '일본',
  '미국',
  '그외',
];

const MOODS = [
  '몽환적인',
  '잔잔한',
  '비 오는 밤',
  '드라이브',
  '설레는',
  '우울한',
  '따뜻한',
  '차분한',
  '신나는',
  '감성적인',
  '쓸쓸한',
  '새벽 감성',
  '집중되는',
  '여행 가는 느낌',
  '카페 분위기',
];

function BubbleRow({ title, icon, options, selected, onSelect, accent }) {
  const scrollRef = useRef(null);
  const [rowWidth, setRowWidth] = useState(0);

  useEffect(() => {
    const selectedIndex = options.indexOf(selected);
    if (selectedIndex < 0 || !rowWidth) {
      return;
    }

    const gap = 12;
    const horizontalPadding = 18;
    const itemWidths = options.map((option, index) => {
      if (option === selected) return 82;
      return index % 3 === 1 ? 68 : 58;
    });
    const xBefore = itemWidths.slice(0, selectedIndex).reduce((sum, width) => sum + width + gap, horizontalPadding);
    const selectedCenter = xBefore + itemWidths[selectedIndex] / 2;
    const targetX = Math.max(0, selectedCenter - rowWidth / 2);

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: targetX, animated: true });
    });
  }, [options, rowWidth, selected]);

  return (
    <View style={styles.rowBlock}>
      <View style={styles.rowTitleWrap}>
        <View style={styles.rowLine} />
        <Text style={styles.rowTitle}>{title}</Text>
        <View style={styles.rowLine} />
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bubbleRow}
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      >
        {options.map((option, index) => {
          const isSelected = selected === option;
          const size = isSelected ? 82 : index % 3 === 1 ? 68 : 58;
          return (
            <TouchableOpacity
              key={`${title}-${option}`}
              activeOpacity={0.85}
              onPress={() => onSelect(option)}
              style={[
                styles.bubble,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderColor: isSelected ? accent : 'rgba(255, 210, 201, 0.38)',
                  backgroundColor: isSelected ? `${accent}33` : 'rgba(255,255,255,0.08)',
                },
              ]}
            >
              {isSelected ? <Ionicons name={icon} size={22} color="#FFD2C9" /> : null}
              <Text style={[styles.bubbleText, isSelected && styles.bubbleTextActive]} numberOfLines={2}>
                {option}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SearchingOrbit() {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    spinLoop.start();
    pulseLoop.start();
    return () => {
      spinLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.86, 1.08],
  });

  return (
    <View style={styles.searchOverlay}>
      <Animated.View style={[styles.orbitWrap, { transform: [{ rotate }, { scale }] }]}>
        <View style={[styles.orbitBubble, styles.orbitBubbleA]} />
        <View style={[styles.orbitBubble, styles.orbitBubbleB]} />
        <View style={[styles.orbitBubble, styles.orbitBubbleC]} />
      </Animated.View>
      <Text style={styles.searchTitle}>AI가 조합을 듣는 중</Text>
      <Text style={styles.searchSubtitle}>세 버블이 하나의 추천 원으로 모이고 있어요</Text>
    </View>
  );
}

export default function ChallengePanel({ visible, onClose, onSubmit }) {
  const scrollRef = useRef(null);
  const [genre, setGenre] = useState('R&B');
  const [country, setCountry] = useState('한국');
  const [mood, setMood] = useState('비 오는 밤');
  const [request, setRequest] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const payload = useMemo(() => ({
    genre,
    country,
    mood,
    request: request.trim(),
  }), [country, genre, mood, request]);

  if (!visible) return null;

  const handleRandom = () => {
    setGenre(GENRES[Math.floor(Math.random() * GENRES.length)]);
    setCountry(COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)]);
    setMood(MOODS[Math.floor(Math.random() * MOODS.length)]);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestFocus = () => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 180);
  };

  return (
    <KeyboardAvoidingView
      style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <Text style={styles.brand}>NOWHERE</Text>
        <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.85}>
          <Ionicons name="close-outline" size={26} color="#FFD2C9" />
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>CHALLENGE</Text>
      <Text style={styles.subtitle}>지금 듣고 싶은 음악을 골라보세요</Text>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentScroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
      >
        <BubbleRow title="장르" icon="stats-chart-outline" options={GENRES} selected={genre} onSelect={setGenre} accent="#FFB4A9" />
        <BubbleRow title="나라" icon="globe-outline" options={COUNTRIES} selected={country} onSelect={setCountry} accent="#C6A6FF" />
        <BubbleRow title="분위기" icon="cloudy-night-outline" options={MOODS} selected={mood} onSelect={setMood} accent="#96E9FF" />

        <View style={styles.requestBlock}>
          <View style={styles.rowTitleWrap}>
            <View style={styles.rowLine} />
            <Text style={styles.rowTitle}>추가 요청</Text>
            <View style={styles.rowLine} />
          </View>
          <View style={styles.inputWrap}>
            <Ionicons name="pencil-outline" size={18} color="#8F8584" />
            <TextInput
              value={request}
              onChangeText={(value) => setRequest(value.slice(0, 30))}
              onFocus={handleRequestFocus}
              placeholder="예: 새벽에 혼자 걷고 싶을 때"
              placeholderTextColor="#8F8584"
              style={styles.input}
              maxLength={30}
              returnKeyType="done"
            />
          </View>
          <Text style={styles.countText}>{request.length} / 30</Text>
        </View>

        <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} activeOpacity={0.88} disabled={isSubmitting}>
          <View style={styles.submitContent}>
            <Ionicons name="sparkles-outline" size={24} color="#07080A" />
            <Text style={styles.submitText}>이 조합으로 추천받기</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.randomButton} onPress={handleRandom} activeOpacity={0.84} disabled={isSubmitting}>
          <Ionicons name="shuffle-outline" size={18} color="#FFD2C9" />
          <Text style={styles.randomText}>랜덤으로 고르기</Text>
        </TouchableOpacity>

        <Text style={styles.helper}>선택한 조합은 추천 기억을 더 정확하게 만들어요.</Text>
      </ScrollView>

      {isSubmitting ? <SearchingOrbit /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    backgroundColor: '#060B12',
    paddingHorizontal: 24,
    paddingTop: 54,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  brand: {
    color: '#FFD2C9',
    fontSize: 24,
    fontWeight: '300',
    letterSpacing: 8,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 180, 169, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFD2C9',
    fontSize: 28,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: '400',
  },
  subtitle: {
    color: '#B9AAA7',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  contentScroll: {
    paddingBottom: 180,
  },
  rowBlock: {
    marginTop: 15,
  },
  rowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
  rowTitle: {
    color: '#FFE8E3',
    fontSize: 15,
    fontWeight: '800',
  },
  rowLine: {
    width: 46,
    height: 1,
    backgroundColor: 'rgba(255, 210, 201, 0.28)',
  },
  bubbleRow: {
    height: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
  },
  bubble: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FFB4A9',
    shadowOpacity: 0.25,
    shadowRadius: 18,
  },
  bubbleText: {
    color: '#E8D6D2',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  bubbleTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  requestBlock: {
    marginTop: 10,
  },
  inputWrap: {
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 210, 201, 0.28)',
    backgroundColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
  },
  countText: {
    color: '#8F8584',
    textAlign: 'right',
    marginTop: 6,
    fontSize: 12,
  },
  submitButton: {
    height: 66,
    borderRadius: 33,
    backgroundColor: '#F3B59F',
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  submitContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  submitText: {
    color: '#07080A',
    fontSize: 18,
    fontWeight: '900',
  },
  randomButton: {
    alignSelf: 'center',
    minWidth: 190,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 210, 201, 0.25)',
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  randomText: {
    color: '#FFD2C9',
    fontSize: 14,
    fontWeight: '700',
  },
  helper: {
    color: '#8F8584',
    textAlign: 'center',
    marginTop: 14,
    fontSize: 12,
  },
  searchOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    backgroundColor: 'rgba(6, 11, 18, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 20,
  },
  orbitWrap: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  orbitBubble: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    shadowOpacity: 0.45,
    shadowRadius: 22,
  },
  orbitBubbleA: {
    backgroundColor: 'rgba(255, 180, 169, 0.50)',
    borderColor: '#FFB4A9',
    shadowColor: '#FFB4A9',
    transform: [{ translateY: -34 }],
  },
  orbitBubbleB: {
    backgroundColor: 'rgba(198, 166, 255, 0.48)',
    borderColor: '#C6A6FF',
    shadowColor: '#C6A6FF',
    transform: [{ translateX: -30 }, { translateY: 22 }],
  },
  orbitBubbleC: {
    backgroundColor: 'rgba(150, 233, 255, 0.42)',
    borderColor: '#96E9FF',
    shadowColor: '#96E9FF',
    transform: [{ translateX: 30 }, { translateY: 22 }],
  },
  searchTitle: {
    color: '#FFE7E2',
    fontSize: 18,
    fontWeight: '900',
  },
  searchSubtitle: {
    color: '#B9AAA7',
    fontSize: 13,
    marginTop: 8,
  },
});
