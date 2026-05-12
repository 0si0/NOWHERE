import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { markFavoriteArtistsOnboardingComplete } from '../services/onboardingService';
import { persistFavoriteArtists, searchFavoriteArtists } from '../services/favoriteArtistsService';

const UI = {
  bg: '#05070A',
  text: '#FFF1EC',
  textSoft: '#D9C6C0',
  textMuted: '#9E908D',
  peach: '#FFC8B8',
  border: 'rgba(255, 201, 184, 0.28)',
  surface: 'rgba(31, 29, 29, 0.78)',
};

function artistKey(artist = {}) {
  return String(artist.id || artist.spotifyUri || artist.name || '').toLowerCase();
}

export default function FavoriteArtistsScreen({ onComplete }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedArtists, setSelectedArtists] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const searchRunRef = useRef(0);

  const selectedKeys = useMemo(() => new Set(selectedArtists.map(artistKey)), [selectedArtists]);
  const canContinue = selectedArtists.length === 3 && !isSaving;

  const runSearch = async (nextQuery) => {
    const searchText = String(nextQuery || '').trim();
    setQuery(nextQuery);
    setError('');
    if (searchText.length < 2) {
      setResults([]);
      return;
    }

    const searchRun = searchRunRef.current + 1;
    searchRunRef.current = searchRun;
    setIsSearching(true);
    try {
      const artists = await searchFavoriteArtists(searchText, 8);
      if (searchRunRef.current === searchRun) {
        setResults(artists);
        if (!artists.length) {
          setError('검색 결과가 없습니다. 다른 이름으로 다시 검색해주세요.');
        }
      }
    } catch (nextError) {
      if (searchRunRef.current === searchRun) {
        setResults([]);
        setError(nextError?.message || 'Spotify 아티스트 검색에 실패했습니다.');
      }
    } finally {
      if (searchRunRef.current === searchRun) {
        setIsSearching(false);
      }
    }
  };

  const toggleArtist = (artist) => {
    const key = artistKey(artist);
    if (!key) {
      return;
    }
    if (selectedKeys.has(key)) {
      setSelectedArtists((current) => current.filter((item) => artistKey(item) !== key));
      return;
    }
    if (selectedArtists.length >= 3) {
      setError('좋아하는 아티스트는 3명까지 선택할 수 있어요.');
      return;
    }
    setSelectedArtists((current) => [...current, artist]);
    setError('');
  };

  const handleContinue = async () => {
    if (!canContinue) {
      setError('좋아하는 아티스트 3명을 선택해주세요.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await persistFavoriteArtists(selectedArtists);
      await markFavoriteArtistsOnboardingComplete();
      onComplete?.();
    } catch (nextError) {
      setError(nextError?.message || '아티스트 저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.kicker}>NOWHERE TASTE SETUP</Text>
            <Text style={styles.title}>좋아하는 아티스트 3명을 골라주세요</Text>
            <Text style={styles.body}>
              저장된 청취 기록이 적을 때 이 아티스트들의 히트곡을 추천탭에 먼저 채웁니다.
            </Text>
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={20} color={UI.peach} />
            <TextInput
              value={query}
              onChangeText={runSearch}
              placeholder="아티스트 검색"
              placeholderTextColor={UI.textMuted}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {isSearching ? <ActivityIndicator size="small" color={UI.peach} /> : null}
          </View>

          <View style={styles.selectedPanel}>
            <Text style={styles.sectionTitle}>선택됨 {selectedArtists.length}/3</Text>
            <View style={styles.selectedList}>
              {selectedArtists.map((artist) => (
                <TouchableOpacity
                  key={artistKey(artist)}
                  style={styles.selectedChip}
                  activeOpacity={0.8}
                  onPress={() => toggleArtist(artist)}
                >
                  <Text style={styles.selectedChipText}>{artist.name}</Text>
                  <Ionicons name="close-outline" size={16} color={UI.peach} />
                </TouchableOpacity>
              ))}
              {!selectedArtists.length ? (
                <Text style={styles.emptyText}>검색 결과에서 아티스트를 추가해주세요.</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.resultList}>
            {results.map((artist) => {
              const selected = selectedKeys.has(artistKey(artist));
              return (
                <TouchableOpacity
                  key={artistKey(artist)}
                  style={[styles.resultRow, selected && styles.resultRowSelected]}
                  activeOpacity={0.85}
                  onPress={() => toggleArtist(artist)}
                >
                  {artist.artworkUrl ? (
                    <Image source={{ uri: artist.artworkUrl }} style={styles.artistImage} />
                  ) : (
                    <View style={styles.artistFallback}>
                      <Ionicons name="person-outline" size={22} color={UI.peach} />
                    </View>
                  )}
                  <View style={styles.artistInfo}>
                    <Text style={styles.artistName} numberOfLines={1}>{artist.name}</Text>
                    <Text style={styles.artistMeta} numberOfLines={1}>
                      {artist.genres?.slice(0, 2).join(' · ') || 'Spotify Artist'}
                    </Text>
                  </View>
                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'add-circle-outline'}
                    size={24}
                    color={selected ? '#8AF2A9' : UI.peach}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
            activeOpacity={0.88}
            onPress={handleContinue}
            disabled={!canContinue}
          >
            {isSaving ? (
              <ActivityIndicator color="#07100B" />
            ) : (
              <>
                <Ionicons name="musical-notes-outline" size={22} color="#07100B" />
                <Text style={styles.continueButtonText}>추천 설정 완료</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: UI.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 42,
  },
  header: {
    marginTop: 22,
    marginBottom: 26,
  },
  kicker: {
    color: UI.peach,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 4,
    marginBottom: 14,
  },
  title: {
    color: UI.text,
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 38,
  },
  body: {
    color: UI.textSoft,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  searchBox: {
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: UI.surface,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchInput: {
    flex: 1,
    color: UI.text,
    fontSize: 17,
    fontWeight: '700',
    minHeight: 54,
  },
  selectedPanel: {
    borderWidth: 1,
    borderColor: UI.border,
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
    backgroundColor: 'rgba(12, 12, 13, 0.88)',
  },
  sectionTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 12,
  },
  selectedList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: UI.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 200, 184, 0.12)',
  },
  selectedChipText: {
    color: UI.peach,
    fontSize: 14,
    fontWeight: '800',
  },
  emptyText: {
    color: UI.textMuted,
    fontSize: 14,
  },
  resultList: {
    marginTop: 18,
    gap: 10,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 74,
    borderWidth: 1,
    borderColor: 'rgba(255, 201, 184, 0.18)',
    borderRadius: 18,
    padding: 12,
    backgroundColor: 'rgba(22, 20, 20, 0.72)',
  },
  resultRowSelected: {
    borderColor: UI.peach,
    backgroundColor: 'rgba(255, 200, 184, 0.12)',
  },
  artistImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#1C1717',
  },
  artistFallback: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1717',
  },
  artistInfo: {
    flex: 1,
    minWidth: 0,
  },
  artistName: {
    color: UI.text,
    fontSize: 17,
    fontWeight: '900',
  },
  artistMeta: {
    color: UI.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  errorText: {
    color: UI.peach,
    fontSize: 14,
    marginTop: 16,
  },
  continueButton: {
    minHeight: 60,
    borderRadius: 999,
    backgroundColor: UI.peach,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  continueButtonDisabled: {
    opacity: 0.42,
  },
  continueButtonText: {
    color: '#07100B',
    fontSize: 18,
    fontWeight: '900',
  },
});
