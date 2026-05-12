import AsyncStorage from '@react-native-async-storage/async-storage';
import { TIME_MOODS } from '../constants';
import { resolveAlbumArtwork } from './albumArtworkService';
import { callCloudFunction, callCloudFunctionOptionalAuth, getListeningEvents, getOrCreateAppUserId } from './firebaseService';
import { buildListeningContext } from './listeningHistoryService';
import { musicPlayerService } from './musicPlayerService';

const CACHE_KEY = '@nowhere/recommendation-slots-cache';
const CACHE_VERSION = 17;
const CACHE_TTL_MS = 10 * 60 * 1000;
const SPOTIFY_REQUESTED_TREND_PLAYLIST_ID = '37i9dQZEVXbJZGli0rRP3r';
const SPOTIFY_KR_TOP_50_PLAYLIST_ID = '37i9dQZEVXbNxXF4SkHj9F';
const RECOMMENDATION_LOG_PREFIX = '[NOWHERE Recommendation]';

export const RECOMMENDATION_SLOT_TYPES = ['taste', 'time', 'place', 'weather', 'challenge'];

const SLOT_META = {
  taste: { sourceLabel: '요즘 자주 듣는곡', title: '요즘 자주 듣는곡' },
  time: { sourceLabel: '지금 듣기 좋은 곡', title: '지금 듣기 좋은 곡' },
  place: { sourceLabel: '이곳에 어울리는 곡', title: '이곳에 어울리는 곡' },
  weather: { sourceLabel: '오늘같은 날씨엔 이런 곡', title: '오늘같은 날씨엔 이런 곡' },
  challenge: { sourceLabel: '오늘은 어떤 곡에 도전해볼까요?', title: 'CHALLENGE' },
};

const SITUATION_RECOMMENDATION_CANDIDATES = {
  weather: {
    rain: [
      { title: '비도 오고 그래서', artist: '헤이즈 신용재' },
      { title: '비가 오는 날엔', artist: '비스트' },
      { title: '우산', artist: '에픽하이 윤하' },
      { title: '비 오는 날 듣기 좋은 노래', artist: '에픽하이 Colde' },
      { title: 'Rain Drop', artist: '아이유' },
      { title: '소나기', artist: '아이오아이' },
      { title: '비', artist: '폴킴' },
      { title: '비가 와', artist: '소유 백현' },
      { title: '잠 못 드는 밤 비는 내리고', artist: '김건모' },
      { title: 'Rain', artist: '태연' },
    ],
    cloudy: [
      { title: '구름', artist: '로시' },
      { title: '가끔', artist: '크러쉬' },
      { title: '미워', artist: '크러쉬' },
      { title: '와르르', artist: 'Colde' },
      { title: '나의 사춘기에게', artist: '볼빨간사춘기' },
      { title: '스토커', artist: '10CM' },
      { title: '그때 헤어지면 돼', artist: '로이킴' },
      { title: '어떻게 이별까지 사랑하겠어, 널 사랑하는 거지', artist: 'AKMU' },
      { title: '한숨', artist: '이하이' },
      { title: 'Square', artist: '백예린' },
      { title: '너의 의미', artist: '아이유 김창완' },
    ],
    clear: [
      { title: 'Blueming', artist: '아이유' },
      { title: '봄날', artist: '방탄소년단' },
      { title: 'Dynamite', artist: '방탄소년단' },
      { title: 'LOVE DIVE', artist: 'IVE' },
      { title: 'Hype Boy', artist: 'NewJeans' },
      { title: 'Super Shy', artist: 'NewJeans' },
      { title: '여행', artist: '볼빨간사춘기' },
      { title: '낙하', artist: 'AKMU 아이유' },
    ],
    snow: [
      { title: '첫눈', artist: 'EXO' },
      { title: '겨울잠', artist: '아이유' },
      { title: 'Snowman', artist: '장나라' },
      { title: '눈의 꽃', artist: '박효신' },
      { title: 'Must Have Love', artist: 'SG워너비 브라운아이드걸스' },
      { title: '크리스마스니까', artist: '성시경 박효신 이석훈 서인국 빅스' },
      { title: 'December, 2014', artist: 'EXO' },
      { title: '첫눈처럼 너에게 가겠다', artist: '에일리' },
      { title: 'Winter Flower', artist: '윤하 RM' },
      { title: 'Merry & Happy', artist: 'TWICE' },
    ],
  },
  time: {
    morning: [
      { title: '파이팅 해야지', artist: '부석순 이영지' },
      { title: '좋은 날', artist: '아이유' },
      { title: '시작', artist: '가호' },
      { title: 'Hello Future', artist: 'NCT DREAM' },
      { title: '아로하', artist: '조정석' },
      { title: 'I AM', artist: 'IVE' },
      { title: 'Feel Special', artist: 'TWICE' },
      { title: 'Dolphin', artist: '오마이걸' },
      { title: 'Celebrity', artist: '아이유' },
      { title: '에잇', artist: '아이유 SUGA' },
    ],
    lunch: [
      { title: 'Lunch', artist: '부석순' },
      { title: 'ASAP', artist: 'STAYC' },
      { title: 'After LIKE', artist: 'IVE' },
      { title: 'Attention', artist: 'NewJeans' },
      { title: 'CHEER UP', artist: 'TWICE' },
      { title: 'Power Up', artist: 'Red Velvet' },
      { title: 'Very Nice', artist: '세븐틴' },
      { title: 'Love Lee', artist: 'AKMU' },
      { title: 'Any Song', artist: '지코' },
      { title: '봄 사랑 벚꽃 말고', artist: 'HIGH4 아이유' },
    ],
    night: [
      { title: '밤편지', artist: '아이유' },
      { title: '7시에 들어줘', artist: '부석순 Peder Elias' },
      { title: '야생화', artist: '박효신' },
      { title: '취기를 빌려', artist: '산들' },
      { title: '늦은 밤 너의 집 앞 골목길에서', artist: '노을' },
      { title: '오늘도 빛나는 너에게', artist: '마크툽 이라온' },
      { title: 'all of my life', artist: '박원' },
      { title: '기다린 만큼, 더', artist: '검정치마' },
      { title: 'Instagram', artist: 'DEAN' },
      { title: 'D', artist: 'DEAN 개코' },
    ],
  },
};

function trackKey(track = {}) {
  return track.spotifyUri || `${track.title || ''}::${track.artist || ''}`.toLowerCase();
}

function logRecommendationDebug(message, details = {}) {
  if (typeof console?.info !== 'function') {
    return;
  }
  console.info(RECOMMENDATION_LOG_PREFIX, message, details);
}

function getErrorStatus(error) {
  if (!error) return 'unknown';
  const rawStatus = error.status || error.statusCode || error.code || error.nativeStatus || '';
  if (rawStatus) return rawStatus;
  const message = String(error.message || error || '');
  const match = message.match(/\b(401|403|429|500|502|503)\b/);
  return match?.[1] || 'unknown';
}

function logRecommendationApiFailure(endpoint, error) {
  logRecommendationDebug('api_failure', {
    endpoint,
    status: getErrorStatus(error),
    message: String(error?.message || error || 'unknown error'),
  });
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function compactIdentity(value = '') {
  return normalizeIdentity(value)
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*]/g, '')
    .replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]/g, '');
}

function getArtistIdentityCandidates(value = '') {
  const names = normalizeIdentity(value)
    .split(/,|&|\/|\+| x | feat\.?| featuring | with | and |、|，/i)
    .map((item) => item.trim())
    .filter(Boolean);
  const candidates = new Set();

  names.forEach((name) => {
    const compact = compactIdentity(name);
    candidates.add(name);
    candidates.add(compact);
  });

  return Array.from(candidates).filter(Boolean);
}

function scoreSearchResultForSlot(track = {}, slot = {}) {
  const requestedTitle = normalizeIdentity(slot.title);
  const requestedCompactTitle = compactIdentity(slot.title);
  const resultTitle = normalizeIdentity(track.title || track.name);
  const resultCompactTitle = compactIdentity(track.title || track.name);
  const requestedArtists = getArtistIdentityCandidates(slot.artist);
  const resultArtist = normalizeIdentity(track.artist || track.artistName);
  const resultCompactArtist = compactIdentity(track.artist || track.artistName);
  const resultArtists = getArtistIdentityCandidates(track.artist || track.artistName);

  const titleMatches = Boolean(
    (requestedTitle && resultTitle === requestedTitle) ||
    (requestedCompactTitle && resultCompactTitle === requestedCompactTitle)
  );

  const artistMatches = requestedArtists.length > 0 && requestedArtists.some((artist) => (
      resultArtists.includes(artist) ||
      resultArtist === artist ||
      resultCompactArtist === artist
  ));

  if (!titleMatches || !artistMatches) {
    return 0;
  }

  return 200 + (track.artworkUrl ? 12 : 0) + (hasSpotifyTrackIdentity(track) ? 8 : 0);
}

function getTrackIdentityKeys(track = {}) {
  return [
    track.spotifyUri,
    track.uri,
    track.id,
    track.title && track.artist ? `${track.title}::${track.artist}` : '',
    track.title && track.artist ? `${track.title}-${track.artist}` : '',
  ].map(normalizeIdentity).filter(Boolean);
}

function addTrackIdentity(usedKeys, track = {}) {
  getTrackIdentityKeys(track).forEach((key) => usedKeys.add(key));
}

function removeTrackIdentity(usedKeys, track = {}) {
  getTrackIdentityKeys(track).forEach((key) => usedKeys.delete(key));
}

function isTrackExcluded(track = {}, usedKeys = new Set()) {
  return getTrackIdentityKeys(track).some((key) => usedKeys.has(key));
}

function buildExcludedKeySet(values = []) {
  return new Set((values || []).map(normalizeIdentity).filter(Boolean));
}

function isUsefulTrack(track = {}) {
  const title = String(track.title || track.name || '').trim();
  const artist = String(track.artist || track.artistName || '').trim();
  const spotifyUri = String(track.spotifyUri || track.uri || '').trim();
  return Boolean(title && (artist || spotifyUri));
}

function hasSpotifyTrackIdentity(track = {}) {
  const spotifyUri = String(track.spotifyUri || track.uri || '').trim();
  return spotifyUri.startsWith('spotify:track:');
}

function getAlbumArtworkUrl(track = {}) {
  return String(track.artworkUrl || track.albumArtUrl || '').trim();
}

function getDisplayTitle(track = {}) {
  return String(track.displayTitle || track.localizedTitle || track.title || track.name || '').trim();
}

function getDisplayArtist(track = {}) {
  return String(track.displayArtist || track.localizedArtist || track.artist || track.artistName || '').trim();
}

function hasRequiredAlbumArtwork(track = {}) {
  return Boolean(getAlbumArtworkUrl(track));
}

function shouldRequestKoreanDisplayName(track = {}) {
  const title = getDisplayTitle(track);
  const artist = getDisplayArtist(track);
  const text = `${title} ${artist}`;
  return Boolean(
    hasSpotifyTrackIdentity(track) &&
    title &&
    !/[가-힣]/.test(text)
  );
}

async function applyKoreanDisplayNames(slots = []) {
  const targets = slots
    .filter((slot) => (
      slot &&
      !slot.isPending &&
      !slot.isActionRequired &&
      shouldRequestKoreanDisplayName(slot)
    ))
    .slice(0, 8);

  if (!targets.length) {
    return slots;
  }

  try {
    const response = await callCloudFunctionOptionalAuth('localizeSpotifyDisplayNames', {
      tracks: targets.map((slot) => ({
        key: slot.spotifyUri || slot.id,
        title: slot.spotifyTitle || slot.title,
        artist: slot.spotifyArtist || slot.artist,
        album: slot.album || '',
      })),
    });
    const localizedItems = Array.isArray(response?.tracks) ? response.tracks : [];
    const localizedByKey = new Map(
      localizedItems
        .filter((item) => item?.key && (item.displayTitle || item.displayArtist))
        .map((item) => [String(item.key), item])
    );

    return slots.map((slot) => {
      const localized = localizedByKey.get(String(slot.spotifyUri || slot.id));
      if (!localized) {
        return slot;
      }

      const displayTitle = String(localized.displayTitle || '').trim();
      const displayArtist = String(localized.displayArtist || '').trim();
      const nextTitle = displayTitle || slot.title;
      const nextArtist = displayArtist || slot.artist;
      return {
        ...slot,
        spotifyTitle: slot.spotifyTitle || slot.title,
        spotifyArtist: slot.spotifyArtist || slot.artist,
        title: nextTitle,
        artist: nextArtist,
        displayTitle: nextTitle,
        displayArtist: nextArtist,
      };
    });
  } catch (error) {
    logRecommendationApiFailure('firebase:localizeSpotifyDisplayNames', error);
    return slots;
  }
}

function isRenderableRecommendationSlot(slot = {}) {
  return Boolean(
    slot &&
    PLAYABLE_SLOT_TYPES.includes(slot.slotType) &&
    !slot.isActionRequired &&
    !slot.isPending &&
    isUsefulTrack(slot) &&
    hasSpotifyTrackIdentity(slot) &&
    hasRequiredAlbumArtwork(slot)
  );
}

function normalizeEventTrack(track = {}) {
  const artworkUrl = getAlbumArtworkUrl(track);
  return {
    type: track.type === 'playlist' ? 'playlist' : 'track',
    provider: track.provider || 'spotify',
    id: track.id || track.spotifyUri || trackKey(track),
    spotifyUri: track.spotifyUri || '',
    uri: track.spotifyUri || track.uri || '',
    title: getDisplayTitle(track) || 'Unknown Track',
    artist: getDisplayArtist(track),
    album: track.album || '',
    artworkUrl,
    durationMs: track.durationMs || 0,
  };
}

function buildSlot(slotType, track, reason, extra = {}) {
  const meta = SLOT_META[slotType];
  const artworkUrl = getAlbumArtworkUrl(track);
  const title = getDisplayTitle(track);
  const artist = getDisplayArtist(track);
  return {
    id: `${slotType}-${trackKey(track) || Date.now()}`,
    slotType,
    source: slotType,
    sourceLabel: extra.sourceLabel || meta.sourceLabel,
    title: title || meta.title,
    artist,
    album: track.album || '',
    color: track.color || '#B99BFF',
    spotifyUri: track.spotifyUri || '',
    uri: track.spotifyUri || track.uri || '',
    artworkUrl,
    reason: reason || extra.reason || '',
    searchQuery: extra.searchQuery || [title || track.title, artist || track.artist].filter(Boolean).join(' '),
    isChallenge: slotType === 'challenge',
    isFallback: Boolean(extra.isFallback),
    isPersonalized: Boolean(extra.isPersonalized),
    isSituational: Boolean(extra.isSituational),
    isPending: Boolean(extra.isPending),
  };
}

async function hydrateSlotArtwork(slot) {
  if (!slot || slot.isPending || slot.isActionRequired || slot.artworkUrl || slot.slotType === 'challenge') {
    return slot;
  }

  const artworkUrl = await resolveAlbumArtwork(slot);
  return artworkUrl ? { ...slot, artworkUrl } : slot;
}

async function hydrateSlotsArtwork(slots = []) {
  return Promise.all(slots.map(hydrateSlotArtwork));
}

async function enforceArtworkForPlayableSlots(slotsByType, usedKeys, stageName) {
  let removedCount = 0;
  let hydratedCount = 0;

  for (const slotType of PLAYABLE_SLOT_TYPES) {
    const slot = slotsByType[slotType];
    if (!slot) {
      continue;
    }

    const hydratedSlot = await hydrateSlotArtwork(slot);
    if (hasRequiredAlbumArtwork(hydratedSlot)) {
      if (!hasRequiredAlbumArtwork(slot)) {
        hydratedCount += 1;
      }
      slotsByType[slotType] = {
        ...hydratedSlot,
        artworkUrl: getAlbumArtworkUrl(hydratedSlot),
      };
      continue;
    }

    removedCount += 1;
    removeTrackIdentity(usedKeys, slot);
    delete slotsByType[slotType];
  }

  logRecommendationDebug('artwork_filter_result', {
    stage: stageName,
    removedWithoutAlbumArt: removedCount,
    hydratedAlbumArt: hydratedCount,
    playableWithAlbumArt: Object.keys(slotsByType).length,
  });

  return removedCount;
}

async function cacheAndReturnRecommendations(cacheKey, slots) {
  const hydratedSlots = await hydrateSlotsArtwork(slots);
  await writeCachedRecommendations(cacheKey, hydratedSlots);
  return hydratedSlots;
}

function getTimeRecommendationLabel(context = {}) {
  const hour = Number.isInteger(context.hour) ? context.hour : new Date().getHours();
  if (hour < 12) return '오전에 듣기 좋은 곡';
  if (hour < 18) return '오후에 듣기 좋은 곡';
  return '밤에 듣기 좋은 곡';
}

function getSlotSourceLabel(slotType, context = {}) {
  if (slotType === 'time') {
    return getTimeRecommendationLabel(context);
  }
  return SLOT_META[slotType]?.sourceLabel || '추천';
}

function getWeatherSituationKey(context = {}) {
  const weatherText = [
    context.weatherCondition,
    context.weatherMood,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/snow|눈/.test(weatherText)) return 'snow';
  if (/rain|drizzle|thunderstorm|비|이슬비|폭풍/.test(weatherText)) return 'rain';
  if (/cloud|흐림/.test(weatherText)) return 'cloudy';
  if (/clear|맑음/.test(weatherText)) return 'clear';
  return '';
}

function getTimeSituationKey(context = {}) {
  if (context.timeBucket === 'morning') return 'morning';
  if (context.timeBucket === 'afternoon') return 'lunch';
  if (['evening', 'night', 'lateNight'].includes(context.timeBucket)) return 'night';

  const hour = Number.isInteger(context.hour) ? context.hour : new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'lunch';
  return 'night';
}

function getSituationCandidates(slotType, context = {}) {
  if (slotType === 'weather') {
    const key = getWeatherSituationKey(context);
    return key ? SITUATION_RECOMMENDATION_CANDIDATES.weather[key] || [] : [];
  }
  if (slotType === 'time') {
    const key = getTimeSituationKey(context);
    return key ? SITUATION_RECOMMENDATION_CANDIDATES.time[key] || [] : [];
  }
  return [];
}

function rotateSituationCandidates(candidates = [], refreshSeed = 0, salt = 0) {
  if (!candidates.length) {
    return [];
  }
  const startIndex = seededIndex(refreshSeed, salt, candidates.length);
  return [...candidates.slice(startIndex), ...candidates.slice(0, startIndex)];
}

async function searchSituationCandidateTrack(candidate = {}, usedKeys = new Set()) {
  const query = [candidate.title, candidate.artist].filter(Boolean).join(' ');
  if (!query) {
    return null;
  }

  try {
    const response = await callCloudFunctionOptionalAuth('searchSpotifyTracks', {
      query,
      limit: 8,
    });
    const matches = (Array.isArray(response?.tracks) ? response.tracks : [])
      .filter((track) => (
        isUsefulTrack(track) &&
        hasSpotifyTrackIdentity(track) &&
        hasRequiredAlbumArtwork(track) &&
        !isTrackExcluded(track, usedKeys)
      ))
      .map((track) => ({
        track,
        score: scoreSearchResultForSlot(track, candidate),
      }))
      .sort((left, right) => right.score - left.score);

    const matchedTrack = (matches.find((match) => match.score >= 200) || matches[0])?.track || null;
    if (!matchedTrack) {
      return null;
    }
    return {
      ...matchedTrack,
      title: candidate.title || matchedTrack.title,
      artist: candidate.artist || matchedTrack.artist,
      displayTitle: candidate.title || matchedTrack.displayTitle || matchedTrack.title,
      displayArtist: candidate.artist || matchedTrack.displayArtist || matchedTrack.artist,
      spotifyTitle: matchedTrack.title,
      spotifyArtist: matchedTrack.artist,
    };
  } catch (error) {
    logRecommendationApiFailure(`firebase:searchSpotifyTracks:${query}`, error);
    return null;
  }
}

async function resolveSituationTrack(slotType, context = {}, usedKeys = new Set(), refreshSeed = 0) {
  const candidates = getSituationCandidates(slotType, context);
  const rotatedCandidates = rotateSituationCandidates(
    candidates,
    refreshSeed,
    slotType === 'weather' ? 41 : 29
  );

  for (const candidate of rotatedCandidates) {
    const track = await searchSituationCandidateTrack(candidate, usedKeys);
    if (track) {
      return track;
    }
  }
  return null;
}

async function fillSituationSlots(slotsByType, usedKeys, context = {}, refreshSeed = 0) {
  const situationSlotTypes = ['time', 'weather'];
  for (const slotType of situationSlotTypes) {
    if (slotsByType[slotType]) {
      continue;
    }
    const track = await resolveSituationTrack(slotType, context, usedKeys, refreshSeed);
    if (track) {
      setPlayableSlot(
        slotsByType,
        usedKeys,
        buildContextSourceSlot(slotType, track, context, 'situation')
      );
    }
  }
}

function buildChallengeSearchQuery(challenge = {}, candidateQuery = '') {
  return [
    candidateQuery,
    challenge.genre,
    challenge.country,
    challenge.mood,
    challenge.request,
  ].filter(Boolean).join(' ');
}

function shouldTrustChallengeTrack(track = {}) {
  return isUsefulTrack(track);
}

function buildChallengeOwnerSearchQueries(track = {}, challenge = {}) {
  const title = getDisplayTitle(track);
  const artist = getDisplayArtist(track);
  const baseQuery = [title || track.title, artist || track.artist].filter(Boolean).join(' ');
  return [
    track.searchQuery,
    baseQuery,
    title,
    buildChallengeSearchQuery(challenge, baseQuery),
  ]
    .map((query) => String(query || '').trim())
    .filter((query, index, queries) => query.length >= 2 && queries.indexOf(query) === index);
}

async function searchChallengeTrackWithOwnerApi(track = {}, challenge = {}) {
  const slot = buildSlot('challenge', track, track.reason || '선택한 조합으로 찾은 새로운 추천이에요.', {
    searchQuery: track.searchQuery,
  });
  const queries = buildChallengeOwnerSearchQueries(track, challenge);

  for (const query of queries) {
    try {
      const response = await callCloudFunctionOptionalAuth('searchSpotifyTracks', {
        query,
        limit: 10,
      });
      const match = (Array.isArray(response?.tracks) ? response.tracks : [])
        .filter((candidate) => (
          isUsefulTrack(candidate) &&
          hasSpotifyTrackIdentity(candidate) &&
          hasRequiredAlbumArtwork(candidate)
        ))
        .map((candidate) => ({
          track: candidate,
          score: scoreSearchResultForSlot(candidate, slot),
        }))
        .sort((left, right) => right.score - left.score)[0]?.track;

      if (match) {
        return {
          ...slot,
          ...match,
          id: `challenge-${match.spotifyUri || match.id || trackKey(match)}`,
          slotType: 'challenge',
          source: 'challenge',
          sourceLabel: SLOT_META.challenge.sourceLabel,
          title: track.displayTitle || track.title || match.displayTitle || match.title,
          artist: track.displayArtist || track.artist || match.displayArtist || match.artist,
          displayTitle: track.displayTitle || track.title || match.displayTitle || match.title,
          displayArtist: track.displayArtist || track.artist || match.displayArtist || match.artist,
          spotifyTitle: match.title,
          spotifyArtist: match.artist,
          spotifyUri: match.spotifyUri,
          uri: match.spotifyUri || match.uri || '',
          artworkUrl: getAlbumArtworkUrl(match),
          durationMs: match.durationMs || 0,
          album: match.album || '',
          reason: track.reason || slot.reason,
          searchQuery: query,
          isChallenge: false,
        };
      }
    } catch (error) {
      logRecommendationApiFailure(`firebase:searchSpotifyTracks:challenge:${query}`, error);
    }
  }

  return null;
}

async function getSpotifyAuthorizationSnapshot() {
  try {
    const state = await musicPlayerService.getState();
    return {
      isConnected: Boolean(state?.isConnected),
      isAuthorized: state?.authorizationStatus === 'authorized' || state?.isAuthorized === true,
      authorizationStatus: state?.authorizationStatus || 'unknown',
      accessTokenPresent: state?.authorizationStatus === 'authorized' || state?.isAuthorized === true,
      playbackStatus: state?.playbackStatus || 'unknown',
    };
  } catch (error) {
    logRecommendationApiFailure('spotify:get-state', error);
    return {
      isConnected: false,
      isAuthorized: false,
      authorizationStatus: 'unknown',
      accessTokenPresent: false,
      playbackStatus: 'unknown',
    };
  }
}

async function resolveSlotWithSpotify(slot, searchQuery = '', usedKeys = new Set()) {
  if (!slot || slot.isChallenge || slot.isActionRequired) {
    return slot;
  }

  if (slot.spotifyUri && slot.artworkUrl && slot.artist && !isTrackExcluded(slot, usedKeys)) {
    return slot;
  }

  const query = searchQuery || slot.searchQuery || [slot.title, slot.artist].filter(Boolean).join(' ');
  if (!query) {
    return slot;
  }

  try {
    const results = await musicPlayerService.search(query, 10);
    const match = results
      .filter((track) => (
        isUsefulTrack(track) &&
        hasSpotifyTrackIdentity(track) &&
        hasRequiredAlbumArtwork(track) &&
        !isTrackExcluded(track, usedKeys)
      ))
      .map((track) => ({ track, score: scoreSearchResultForSlot(track, slot) }))
      .filter((candidate) => candidate.score >= 200)
      .sort((left, right) => right.score - left.score)[0]?.track;
    if (!match) {
      return slot;
    }

    return {
      ...slot,
      ...match,
      id: `${slot.slotType}-${match.spotifyUri || match.id || trackKey(match)}`,
      slotType: slot.slotType,
      source: slot.source,
      sourceLabel: slot.sourceLabel,
      title: slot.displayTitle || slot.title || match.title,
      artist: slot.displayArtist || slot.artist || match.artist,
      displayTitle: slot.displayTitle || slot.title || match.displayTitle || match.title,
      displayArtist: slot.displayArtist || slot.artist || match.displayArtist || match.artist,
      reason: slot.reason,
      searchQuery: query,
      isChallenge: slot.isChallenge,
      isFallback: slot.isFallback,
      isPersonalized: slot.isPersonalized,
      isSituational: slot.isSituational,
    };
  } catch (error) {
    return slot;
  }
}

async function resolveSlotsWithSpotify(slots = [], excludedKeys = new Set()) {
  const usedKeys = new Set(excludedKeys);
  const resolvedSlots = [];

  for (const slot of slots) {
    if (!slot || slot.isChallenge || slot.slotType === 'challenge') {
      resolvedSlots.push(slot);
      continue;
    }

    const resolved = await resolveSlotWithSpotify(slot, slot.searchQuery, usedKeys);
    const resolvedWithArtwork = hasRequiredAlbumArtwork(resolved)
      ? resolved
      : await hydrateSlotArtwork(resolved);
    if (!isTrackExcluded(resolvedWithArtwork, usedKeys) && hasRequiredAlbumArtwork(resolvedWithArtwork)) {
      addTrackIdentity(usedKeys, resolvedWithArtwork);
      resolvedSlots.push({
        ...resolvedWithArtwork,
        artworkUrl: getAlbumArtworkUrl(resolvedWithArtwork),
      });
    } else {
      resolvedSlots.push({ ...slot, spotifyUri: '', uri: '', artworkUrl: '' });
    }
  }

  return resolvedSlots;
}

function isLikeEvent(event = {}) {
  return event.eventType === 'like' || event.source === 'moment-action-like';
}

function getEventWeight(event = {}) {
  if (isLikeEvent(event)) {
    return 5;
  }
  if (event.eventType === 'challenge') {
    return 2;
  }
  return 1;
}

function scoreEvents(events = [], predicate = () => true) {
  const now = Date.now();
  const scores = new Map();

  events.filter(predicate).forEach((event) => {
    if (Number(event.schemaVersion || 1) < 2) {
      return;
    }
    const track = normalizeEventTrack(event.track || event);
    const key = trackKey(track);
    if (!key || !isUsefulTrack(track) || !hasSpotifyTrackIdentity(track)) {
      return;
    }
    const ageMs = now - new Date(event.occurredAt || event.createdAt || now).getTime();
    const recency = Number.isFinite(ageMs) ? Math.max(0.25, 1 - ageMs / (1000 * 60 * 60 * 24 * 21)) : 0.5;
    const eventWeight = getEventWeight(event);
    const previous = scores.get(key) || { track, score: 0, count: 0 };
    scores.set(key, {
      track,
      score: previous.score + eventWeight + recency,
      count: previous.count + eventWeight,
    });
  });

  return Array.from(scores.values()).sort((left, right) => right.score - left.score);
}

function hasEnoughListeningData(events = []) {
  const meaningfulTrackCount = scoreEvents(events).length;
  return meaningfulTrackCount >= 4;
}

function hasLikeSignal(events = []) {
  return events.some((event) => Number(event.schemaVersion || 1) >= 2 && isLikeEvent(event));
}

function pickUniqueScored(scored = [], usedKeys = new Set()) {
  const item = scored.find((candidate) => !isTrackExcluded(candidate.track, usedKeys));
  if (item) {
    addTrackIdentity(usedKeys, item.track);
  }
  return item || null;
}

function buildChallengeEntrySlot() {
  return buildSlot(
    'challenge',
    { title: 'CHALLENGE', artist: '새로운 음악 도전', color: '#B99BFF' },
    '오늘은 어떤 곡에 도전해볼까요?'
  );
}

function buildUnavailableSlot(slotType, context = {}) {
  const slot = buildSlot(
    slotType,
    {
      title: '추천 준비 중',
      artist: 'NOWHERE 기록과 차트를 확인하고 있어요',
      color: '#A98791',
    },
    'NOWHERE 기록, 좋아하는 아티스트, 한국 Top50에서 추천을 다시 확인하고 있어요.',
    {
      sourceLabel: getSlotSourceLabel(slotType, context),
      isActionRequired: true,
    }
  );
  return {
    ...slot,
    id: `spotify-required-${slotType}`,
  };
}

function buildUserDataSlots(events, context, usedKeys = new Set()) {
  const overall = scoreEvents(events);
  const byTime = scoreEvents(events, (event) => event.context?.timeBucket === context.timeBucket);
  const byPlace = scoreEvents(events, (event) => (
    event.context?.savedPlaceId && event.context.savedPlaceId === context.savedPlaceId
  ) || (
    event.context?.geohash && context.geohash && event.context.geohash.slice(0, 6) === context.geohash.slice(0, 6)
  ));
  const byWeather = scoreEvents(events, (event) => (
    event.context?.weatherCondition && event.context.weatherCondition === context.weatherCondition
  ) || (
    event.context?.weatherMood && event.context.weatherMood === context.weatherMood
  ));
  const canUseTasteHistory = hasEnoughListeningData(events) || hasLikeSignal(events);
  const pickKeys = new Set(usedKeys);
  const slots = {};
  const tastePick = canUseTasteHistory ? pickUniqueScored(overall, pickKeys) : null;
  const timePick = pickUniqueScored(byTime, pickKeys);
  const placePick = pickUniqueScored(byPlace, pickKeys);
  const weatherPick = pickUniqueScored(byWeather, pickKeys);

  if (tastePick) {
    slots.taste = buildSlot('taste', tastePick.track, `${tastePick.count}번 이상 좋은 반응이 쌓인 곡이에요.`, {
      isPersonalized: true,
      sourceLabel: getSlotSourceLabel('taste', context),
    });
  }
  if (timePick) {
    slots.time = buildSlot('time', timePick.track, `${TIME_MOODS[context.timeBucket]?.label || '이 시간'}에 가장 자주 들은 곡이에요.`, {
      isPersonalized: true,
      sourceLabel: getSlotSourceLabel('time', context),
    });
  }
  if (placePick) {
    slots.place = buildSlot('place', placePick.track, `${context.placeName || '지금 공간'}에서 가장 자주 들은 곡이에요.`, {
      isPersonalized: true,
      sourceLabel: getSlotSourceLabel('place', context),
    });
  }
  if (weatherPick) {
    slots.weather = buildSlot('weather', weatherPick.track, `${context.weatherMood || '오늘 날씨'}에 가장 자주 들은 곡이에요.`, {
      isPersonalized: true,
      sourceLabel: getSlotSourceLabel('weather', context),
    });
  }

  return slots;
}

function fillSlotsFromListeningHistory(slotsByType, usedKeys, events = [], context = {}) {
  const scored = scoreEvents(events)
    .filter((candidate) => (
      candidate?.track &&
      hasSpotifyTrackIdentity(candidate.track) &&
      hasRequiredAlbumArtwork(candidate.track)
    ));

  if (!scored.length) {
    return;
  }

  PLAYABLE_SLOT_TYPES.forEach((slotType) => {
    if (slotsByType[slotType]) {
      return;
    }
    const picked = pickUniqueScored(scored, usedKeys);
    if (!picked?.track) {
      return;
    }
    setPlayableSlot(
      slotsByType,
      usedKeys,
      buildSlot(
        slotType,
        picked.track,
        'NOWHERE에 저장된 청취 기록에서 다시 꺼낸 곡이에요.',
        {
          isPersonalized: true,
          sourceLabel: getSlotSourceLabel(slotType, context),
        }
      )
    );
  });
}

const PLAYABLE_SLOT_TYPES = ['taste', 'time', 'place', 'weather'];

function trackText(track = {}) {
  return [track.title, track.artist, track.album, track.searchQuery].filter(Boolean).join(' ').toLowerCase();
}

function textMatches(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function scoreContextTrack(track, context, slotType) {
  const rank = Number.isFinite(track.rank) ? track.rank : 50;
  const text = trackText(track);
  const bright = [/pop/i, /dance/i, /summer/i, /sun/i, /spring/i, /joy/i, /청량/i];
  const mellow = [/ballad/i, /r&b/i, /chill/i, /lo-?fi/i, /acoustic/i, /jazz/i, /blue/i, /night/i, /rain/i, /비/i, /밤/i, /슬픔/i, /이별/i, /눈/i, /감성/i];
  const energy = [/hip-?hop/i, /rock/i, /game/i, /focus/i, /랩/i, /힙합/i];
  const cozy = [/acoustic/i, /warm/i, /winter/i, /snow/i, /christmas/i, /눈/i];
  const isNightContext = context.timeBucket === 'night' || context.timeBucket === 'lateNight';
  const isBrightOrEnergy = textMatches(text, [...bright, ...energy]);
  const isMellowOrCozy = textMatches(text, [...mellow, ...cozy]);

  let score = 130 - Math.min(rank, 100);
  if (track.artworkUrl) score += 8;
  if (isNightContext && isBrightOrEnergy && !isMellowOrCozy) {
    score -= slotType === 'time' ? 64 : 34;
  }

  if (slotType === 'time') {
    if (context.timeBucket === 'morning' && textMatches(text, bright)) score += 32;
    if (context.timeBucket === 'afternoon' && textMatches(text, [...bright, ...energy])) score += 26;
    if (context.timeBucket === 'evening' && textMatches(text, [...mellow, /love/i, /노을/i])) score += 26;
    if (isNightContext && isMellowOrCozy) score += 46;
  }

  if (slotType === 'weather') {
    if (/비|이슬비/.test(context.weatherMood || '') && textMatches(text, mellow)) score += 34;
    if (/맑음/.test(context.weatherMood || '') && !isNightContext && textMatches(text, bright)) score += 30;
    if (/맑음/.test(context.weatherMood || '') && isNightContext && isMellowOrCozy) score += 28;
    if (/흐림/.test(context.weatherMood || '') && textMatches(text, mellow)) score += 24;
    if (/눈/.test(context.weatherMood || '') && textMatches(text, cozy)) score += 30;
    if (/폭풍/.test(context.weatherMood || '') && textMatches(text, energy)) score += 30;
  }

  if (slotType === 'place') {
    const placeName = String(context.placeName || '').toLowerCase();
    if (/카페|cafe/.test(placeName) && textMatches(text, [...mellow, /coffee/i, /카페/i])) score += 30;
    if (/공원|산책|park|walk/.test(placeName) && textMatches(text, [...bright, /acoustic/i, /spring/i])) score += 26;
    if (/역|지하철|버스|거리|강남|홍대|city|drive|road/.test(placeName) && textMatches(text, [...energy, ...bright])) score += 24;
    if (!placeName && textMatches(text, [...bright, ...mellow])) score += 12;
  }

  if (slotType === 'taste') {
    score += track.isSpotifyTopTrack ? 28 : 10;
    if (track.isRecentlyPlayed) score += 18;
  }

  return score;
}

function uniqueTracks(tracks = []) {
  const usedKeys = new Set();
  return tracks.filter((track) => {
    if (!isUsefulTrack(track) || isTrackExcluded(track, usedKeys)) {
      return false;
    }
    addTrackIdentity(usedKeys, track);
    return true;
  });
}

function seededIndex(seed, salt, length) {
  if (length <= 1) {
    return 0;
  }
  const raw = Math.sin((Number(seed) || Date.now()) + salt * 1009) * 10000;
  return Math.abs(Math.floor(raw)) % length;
}

function pickContextTrack(tracks, context, slotType, usedKeys, refreshSeed, slotOffset) {
  const candidates = tracks
    .filter((track) => isUsefulTrack(track) && !isTrackExcluded(track, usedKeys))
    .map((track) => ({ track, score: scoreContextTrack(track, context, slotType) }))
    .sort((left, right) => right.score - left.score || (left.track.rank || 999) - (right.track.rank || 999));

  if (!candidates.length) {
    return null;
  }

  const topScore = candidates[0].score;
  const viablePool = candidates.filter((candidate) => candidate.score >= topScore - 42);
  const poolSize = Math.min(
    candidates.length,
    Math.max(8, Math.ceil(candidates.length * 0.42), viablePool.length)
  );
  const pool = candidates.slice(0, poolSize);
  const salt = Array.from(slotType).reduce((sum, char) => sum + char.charCodeAt(0), slotOffset + 1);
  return pool[seededIndex(refreshSeed, salt, pool.length)].track;
}

async function getSpotifyKoreaChartTracks(limit = 50) {
  try {
    return musicPlayerService.getPlaylistTracks(SPOTIFY_KR_TOP_50_PLAYLIST_ID, limit);
  } catch (error) {
    logRecommendationApiFailure('spotify:playlist:korea-top-50', error);
    return [];
  }
}

async function getDemoOwnerSpotifyTracks(limit = 50) {
  try {
    const response = await callCloudFunctionOptionalAuth('getDemoSpotifyTracks', { limit });
    const chartTracks = Array.isArray(response?.chartTracks) ? response.chartTracks : [];
    logRecommendationDebug('spotify_owner_demo_result', {
      chartCount: chartTracks.length,
      requestedPlaylistId: response?.requestedPlaylistId || SPOTIFY_REQUESTED_TREND_PLAYLIST_ID,
      playlistId: response?.playlistId || '',
    });
    return {
      chartTracks,
      playlistId: response?.playlistId || '',
      requestedPlaylistId: response?.requestedPlaylistId || SPOTIFY_REQUESTED_TREND_PLAYLIST_ID,
    };
  } catch (error) {
    logRecommendationApiFailure('firebase:getDemoSpotifyTracks', error);
    return { chartTracks: [], playlistId: '', requestedPlaylistId: SPOTIFY_REQUESTED_TREND_PLAYLIST_ID };
  }
}

function buildContextSourceSlot(slotType, track, context, mode) {
  const isPersonalized = mode === 'favorite-artist';
  const isSituational = mode === 'situation';
  const isFallback = mode === 'trend';
  const trendPrefix = 'Spotify 대한민국 Top 50에서';
  const reasonByMode = {
    'favorite-artist': {
      taste: `${track.sourceArtistName || track.artist || '좋아하는 아티스트'}의 인기곡을 골랐어요.`,
      time: `${TIME_MOODS[context.timeBucket]?.label || '지금 시간'}에 어울리는 좋아하는 아티스트의 곡이에요.`,
      place: `${context.placeName || '현재 공간'}에 어울리는 좋아하는 아티스트의 곡이에요.`,
      weather: `${context.weatherMood || '오늘 날씨'}와 잘 맞는 좋아하는 아티스트의 곡이에요.`,
    },
    trend: {
      taste: `${trendPrefix} 최근 흐름이 좋은 곡을 골랐어요.`,
      time: `${trendPrefix} ${TIME_MOODS[context.timeBucket]?.label || '지금 시간'}에 어울리는 곡을 골랐어요.`,
      place: `${trendPrefix} ${context.placeName || '현재 공간'} 분위기에 맞는 곡을 골랐어요.`,
      weather: `${trendPrefix} ${context.weatherMood || '오늘 날씨'}와 어울리는 곡을 골랐어요.`,
    },
    situation: {
      time: `${TIME_MOODS[context.timeBucket]?.label || '지금 시간'}에 한국에서 자주 찾는 곡이에요.`,
      weather: `${context.weatherMood || '오늘 날씨'}에 한국에서 자주 찾는 곡이에요.`,
    },
  };

  return buildSlot(slotType, track, reasonByMode[mode]?.[slotType] || '', {
    isPersonalized,
    isFallback,
    isSituational,
    sourceLabel: getSlotSourceLabel(slotType, context),
  });
}

function pickSourceTrackForSlot(tracks = [], context, slotType, usedKeys, refreshSeed = 0, slotOffset = 0, mode = 'trend') {
  const normalizedTracks = tracks
    .filter(isUsefulTrack)
    .map((track, index) => ({
      ...track,
      rank: Number.isFinite(track.rank) ? track.rank : index + 1,
      isSpotifyTopTrack: mode === 'favorite-artist',
    }));

  return pickContextTrack(normalizedTracks, context, slotType, usedKeys, refreshSeed, slotOffset);
}

function fillSlotsFromTracks(slotsByType, usedKeys, tracks = [], context, slotTypes = PLAYABLE_SLOT_TYPES, mode = 'trend', refreshSeed = 0) {
  slotTypes.forEach((slotType, index) => {
    if (slotsByType[slotType]) {
      return;
    }
    const track = pickSourceTrackForSlot(
      tracks,
      context,
      slotType,
      usedKeys,
      refreshSeed,
      index + 1,
      mode
    );
    if (track) {
      setPlayableSlot(
        slotsByType,
        usedKeys,
        buildContextSourceSlot(slotType, track, context, mode)
      );
    }
  });
}

function buildHistorySummary(events = []) {
  const currentEvents = events.filter((event) => Number(event.schemaVersion || 1) >= 2);
  return {
    topTracks: scoreEvents(currentEvents).slice(0, 12).map((item) => ({
      title: item.track.title,
      artist: item.track.artist,
      count: item.count,
    })),
    recentTracks: currentEvents.slice(0, 20).map((event) => ({
      title: event.track?.title,
      artist: event.track?.artist,
      source: event.source,
      timeBucket: event.context?.timeBucket,
      weatherMood: event.context?.weatherMood,
      placeName: event.context?.placeName,
    })),
  };
}

async function readCachedRecommendations(cacheKey) {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== CACHE_VERSION || parsed.cacheKey !== cacheKey || Date.now() - parsed.createdAt > CACHE_TTL_MS) {
      return null;
    }
    if (!Array.isArray(parsed.slots) || parsed.slots.length !== RECOMMENDATION_SLOT_TYPES.length) {
      await AsyncStorage.removeItem(CACHE_KEY);
      return null;
    }
    if (!parsed.slots.some(isRenderableRecommendationSlot)) {
      await AsyncStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.slots;
  } catch (error) {
    await AsyncStorage.removeItem(CACHE_KEY);
    return null;
  }
}

async function readLastRenderableCachedRecommendations() {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const slots = Array.isArray(parsed.slots) ? parsed.slots : [];
    if (!slots.some(isRenderableRecommendationSlot)) {
      return null;
    }
    return slots;
  } catch (error) {
    return null;
  }
}

async function writeCachedRecommendations(cacheKey, slots) {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
    version: CACHE_VERSION,
    cacheKey,
    slots,
    createdAt: Date.now(),
  }));
}

export async function clearRecommendationCache() {
  await AsyncStorage.removeItem(CACHE_KEY);
}

function setPlayableSlot(slotsByType, usedKeys, slot) {
  if (!slot || !PLAYABLE_SLOT_TYPES.includes(slot.slotType) || !isUsefulTrack(slot)) {
    return false;
  }
  if (slotsByType[slot.slotType] || isTrackExcluded(slot, usedKeys)) {
    return false;
  }
  addTrackIdentity(usedKeys, slot);
  slotsByType[slot.slotType] = slot;
  return true;
}

function orderedRecommendationSlots(slotsByType, context = {}) {
  return [
    ...PLAYABLE_SLOT_TYPES.map((slotType) => slotsByType[slotType] || buildUnavailableSlot(slotType, context)),
    buildChallengeEntrySlot(),
  ];
}

export async function getRecommendationSlots({
  userId = '',
  location = null,
  weather = null,
  place = null,
  force = false,
  excludeTrackKeys = [],
  refreshSeed = 0,
} = {}) {
  const ownerId = userId || await getOrCreateAppUserId();
  const context = buildListeningContext({ location, weather, place });
  const excludedKeys = buildExcludedKeySet(excludeTrackKeys);
  const cacheKey = [
    ownerId,
    context.timeBucket,
    context.weatherCondition,
    context.geohash?.slice(0, 6),
  ].join(':');

  if (!force) {
    const cached = await readCachedRecommendations(cacheKey);
    if (cached) {
      const resolvedCachedSlots = await resolveSlotsWithSpotify(cached);
      return hydrateSlotsArtwork(await applyKoreanDisplayNames(resolvedCachedSlots));
    }
  }

  const events = await getListeningEvents(ownerId, 200).catch(() => []);
  const usedKeys = new Set(excludedKeys);
  const slotsByType = {};
  const hasNowhereData = hasEnoughListeningData(events) || hasLikeSignal(events);
  const spotifySnapshot = await getSpotifyAuthorizationSnapshot();

  logRecommendationDebug('load_start', {
    ownerId,
    force,
    spotifyConnected: spotifySnapshot.isConnected,
    spotifyAuthorized: spotifySnapshot.isAuthorized,
    spotifyAuthorizationStatus: spotifySnapshot.authorizationStatus,
    accessTokenPresent: spotifySnapshot.accessTokenPresent,
    listeningEventCount: events.length,
  });

  if (hasNowhereData) {
    Object.values(buildUserDataSlots(events, context, usedKeys)).forEach((slot) => {
      setPlayableSlot(slotsByType, usedKeys, slot);
    });
  }
  await enforceArtworkForPlayableSlots(slotsByType, usedKeys, 'nowhere-history');

  logRecommendationDebug('nowhere_history_result', {
    count: Object.keys(slotsByType).length,
  });

  const missingSituationSlots = ['time', 'weather'].filter((slotType) => !slotsByType[slotType]);
  if (missingSituationSlots.length) {
    await fillSituationSlots(slotsByType, usedKeys, context, refreshSeed);
    await enforceArtworkForPlayableSlots(slotsByType, usedKeys, 'korean-situation');
    logRecommendationDebug('korean_situation_result', {
      requestedSlots: missingSituationSlots,
      filledSlots: missingSituationSlots.filter((slotType) => Boolean(slotsByType[slotType])),
      weatherSituationKey: getWeatherSituationKey(context),
      timeSituationKey: getTimeSituationKey(context),
    });
  }

  fillSlotsFromListeningHistory(slotsByType, usedKeys, events, context);
  await enforceArtworkForPlayableSlots(slotsByType, usedKeys, 'nowhere-general-history');
  logRecommendationDebug('nowhere_general_history_result', {
    count: Object.keys(slotsByType).length,
  });

  let missingSlots = PLAYABLE_SLOT_TYPES.filter((slotType) => !slotsByType[slotType]);
  if (missingSlots.length) {
    const demoOwnerTracks = await getDemoOwnerSpotifyTracks(50);
    const chartTracks = demoOwnerTracks?.chartTracks?.length
      ? demoOwnerTracks.chartTracks
      : await getSpotifyKoreaChartTracks(50);
    logRecommendationDebug('spotify_top50_result', {
      count: chartTracks.length,
      requestedPlaylistId: SPOTIFY_REQUESTED_TREND_PLAYLIST_ID,
      playlistId: demoOwnerTracks?.playlistId || SPOTIFY_KR_TOP_50_PLAYLIST_ID,
      missingSlots,
    });
    fillSlotsFromTracks(
      slotsByType,
      usedKeys,
      chartTracks,
      context,
      missingSlots,
      'trend',
      refreshSeed
    );
    await enforceArtworkForPlayableSlots(slotsByType, usedKeys, 'spotify-top50');
  }

  const slots = await applyKoreanDisplayNames(orderedRecommendationSlots(slotsByType, context));
  const finalPlayableCount = slots.filter((slot) => (
    slot &&
    PLAYABLE_SLOT_TYPES.includes(slot.slotType) &&
    !slot.isActionRequired &&
    !slot.isPending &&
    isUsefulTrack(slot) &&
    hasRequiredAlbumArtwork(slot)
  )).length;
  logRecommendationDebug('final_result', {
    playableCount: finalPlayableCount,
    totalSlots: slots.length,
    allPlayableHaveAlbumArt: finalPlayableCount === PLAYABLE_SLOT_TYPES.filter((slotType) => slotsByType[slotType]).length,
  });

  if (finalPlayableCount === 0) {
    const cachedSlots = await readLastRenderableCachedRecommendations();
    if (cachedSlots) {
      logRecommendationDebug('last_renderable_cache_fallback', {
        cachedPlayableCount: cachedSlots.filter(isRenderableRecommendationSlot).length,
      });
      return hydrateSlotsArtwork(cachedSlots);
    }
  }

  if (force) {
    return hydrateSlotsArtwork(slots);
  }
  return cacheAndReturnRecommendations(cacheKey, slots);
}

export async function getChallengeRecommendation({
  userId = '',
  location = null,
  weather = null,
  challenge = {},
} = {}) {
  const ownerId = userId || await getOrCreateAppUserId();
  const context = buildListeningContext({ location, weather });
  const events = await getListeningEvents(ownerId, 120).catch(() => []);

  let challengeError = null;

  try {
    const response = await callCloudFunction('recommendChallengeTrack', {
      context,
      challenge,
      history: buildHistorySummary(events),
    });
    const track = response?.track || response?.recommendations?.[0];
    if (track?.title && shouldTrustChallengeTrack(track, challenge)) {
      const resolved = await searchChallengeTrackWithOwnerApi(track, challenge);
      if (
        resolved &&
        isUsefulTrack(resolved) &&
        hasSpotifyTrackIdentity(resolved) &&
        hasRequiredAlbumArtwork(resolved) &&
        shouldTrustChallengeTrack(resolved, challenge)
      ) {
        const [localizedResolved] = await applyKoreanDisplayNames([resolved]);
        return {
          ...localizedResolved,
          slotType: 'challenge',
          source: 'challenge',
          sourceLabel: SLOT_META.challenge.sourceLabel,
          isChallenge: false,
        };
      }
    }
  } catch (error) {
    challengeError = error;
  }

  throw new Error(challengeError?.message || 'Challenge 추천 후보를 찾지 못했습니다.');
}
