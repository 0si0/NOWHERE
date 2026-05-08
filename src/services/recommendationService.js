import AsyncStorage from '@react-native-async-storage/async-storage';
import { TIME_MOODS } from '../constants';
import { resolveAlbumArtwork } from './albumArtworkService';
import { callCloudFunction, getListeningEvents, getOrCreateAppUserId } from './firebaseService';
import { buildListeningContext } from './listeningHistoryService';
import { musicPlayerService } from './musicPlayerService';

const CACHE_KEY = '@nowhere/recommendation-slots-cache';
const CACHE_VERSION = 9;
const CACHE_TTL_MS = 10 * 60 * 1000;
const SPOTIFY_KR_TOP_50_PLAYLIST_ID = '37i9dQZEVXbNxXF4SkHj9F';

export const RECOMMENDATION_SLOT_TYPES = ['taste', 'time', 'place', 'weather', 'challenge'];

const SLOT_META = {
  taste: { sourceLabel: '요즘 자주 듣는곡', title: '요즘 자주 듣는곡' },
  time: { sourceLabel: '지금 듣기 좋은 곡', title: '지금 듣기 좋은 곡' },
  place: { sourceLabel: '이곳에 어울리는 곡', title: '이곳에 어울리는 곡' },
  weather: { sourceLabel: '오늘같은 날씨엔 이런 곡', title: '오늘같은 날씨엔 이런 곡' },
  challenge: { sourceLabel: '오늘은 어떤 곡에 도전해볼까요?', title: 'CHALLENGE' },
};

function trackKey(track = {}) {
  return track.spotifyUri || `${track.title || ''}::${track.artist || ''}`.toLowerCase();
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

function normalizeEventTrack(track = {}) {
  return {
    type: track.type === 'playlist' ? 'playlist' : 'track',
    provider: track.provider || 'spotify',
    id: track.id || track.spotifyUri || trackKey(track),
    spotifyUri: track.spotifyUri || '',
    uri: track.spotifyUri || track.uri || '',
    title: track.title || 'Unknown Track',
    artist: track.artist || '',
    album: track.album || '',
    artworkUrl: track.artworkUrl || '',
    durationMs: track.durationMs || 0,
  };
}

function buildSlot(slotType, track, reason, extra = {}) {
  const meta = SLOT_META[slotType];
  return {
    id: `${slotType}-${trackKey(track) || Date.now()}`,
    slotType,
    source: slotType,
    sourceLabel: extra.sourceLabel || meta.sourceLabel,
    title: track.title || meta.title,
    artist: track.artist || '',
    album: track.album || '',
    color: track.color || '#B99BFF',
    spotifyUri: track.spotifyUri || '',
    uri: track.spotifyUri || track.uri || '',
    artworkUrl: track.artworkUrl || '',
    reason: reason || extra.reason || '',
    searchQuery: extra.searchQuery || [track.title, track.artist].filter(Boolean).join(' '),
    isChallenge: slotType === 'challenge',
    isFallback: Boolean(extra.isFallback),
    isPersonalized: Boolean(extra.isPersonalized),
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

async function isSpotifyAuthorized() {
  try {
    const state = await musicPlayerService.getState();
    return state?.authorizationStatus === 'authorized' || state?.isAuthorized === true;
  } catch (error) {
    return false;
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
      .filter((track) => isUsefulTrack(track) && hasSpotifyTrackIdentity(track) && !isTrackExcluded(track, usedKeys))
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
      reason: slot.reason,
      searchQuery: query,
      isChallenge: slot.isChallenge,
      isFallback: slot.isFallback,
      isPersonalized: slot.isPersonalized,
    };
  } catch (error) {
    return slot;
  }
}

async function resolveSlotsWithSpotify(slots = [], excludedKeys = new Set()) {
  if (!(await isSpotifyAuthorized())) {
    return slots;
  }

  const usedKeys = new Set(excludedKeys);
  const resolvedSlots = [];

  for (const slot of slots) {
    if (!slot || slot.isChallenge || slot.slotType === 'challenge') {
      resolvedSlots.push(slot);
      continue;
    }

    const resolved = await resolveSlotWithSpotify(slot, slot.searchQuery, usedKeys);
    if (!isTrackExcluded(resolved, usedKeys)) {
      addTrackIdentity(usedKeys, resolved);
      resolvedSlots.push(resolved);
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
      title: 'Spotify 연결 필요',
      artist: '권한 확인 후 추천을 불러옵니다',
      color: '#A98791',
    },
    'Spotify 권한과 실행 상태를 확인해야 추천을 만들 수 있어요.',
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

async function getSpotifyTopTracks(limit = 50) {
  try {
    return musicPlayerService.getUserTopTracks(limit);
  } catch (error) {
    return [];
  }
}

async function getSpotifyRecentlyPlayedTracks(limit = 50) {
  try {
    return musicPlayerService.getRecentlyPlayedTracks(limit);
  } catch (error) {
    return [];
  }
}

async function getSpotifyPersonalTracks(limit = 50) {
  const [topTracks, recentlyPlayedTracks] = await Promise.all([
    getSpotifyTopTracks(limit),
    getSpotifyRecentlyPlayedTracks(limit),
  ]);

  return uniqueTracks([
    ...topTracks.map((track, index) => ({
      ...track,
      rank: index + 1,
      isSpotifyTopTrack: true,
    })),
    ...recentlyPlayedTracks.map((track, index) => ({
      ...track,
      rank: Math.min(limit, index + 1),
      isRecentlyPlayed: true,
    })),
  ]);
}

async function getSpotifyKoreaChartTracks(limit = 50) {
  try {
    return musicPlayerService.getPlaylistTracks(SPOTIFY_KR_TOP_50_PLAYLIST_ID, limit);
  } catch (error) {
    return [];
  }
}

function buildContextSourceSlot(slotType, track, context, mode) {
  const isPersonalized = mode === 'spotify-top';
  const isFallback = mode === 'trend';
  const trendPrefix = 'Spotify 대한민국 Top 50에서';
  const reasonByMode = {
    'spotify-top': {
      taste: 'Spotify 이용 통계에서 자주 들은 곡을 기반으로 추천했어요.',
      time: `${TIME_MOODS[context.timeBucket]?.label || '지금 시간'}에 어울리는 Spotify 취향 데이터를 골랐어요.`,
      place: `${context.placeName || '현재 공간'}에 어울리는 Spotify 취향 데이터를 골랐어요.`,
      weather: `${context.weatherMood || '오늘 날씨'}에 맞는 Spotify 취향 데이터를 골랐어요.`,
    },
    trend: {
      taste: `${trendPrefix} 최근 흐름이 좋은 곡을 골랐어요.`,
      time: `${trendPrefix} ${TIME_MOODS[context.timeBucket]?.label || '지금 시간'}에 어울리는 곡을 골랐어요.`,
      place: `${trendPrefix} ${context.placeName || '현재 공간'} 분위기에 맞는 곡을 골랐어요.`,
      weather: `${trendPrefix} ${context.weatherMood || '오늘 날씨'}와 어울리는 곡을 골랐어요.`,
    },
  };

  return buildSlot(slotType, track, reasonByMode[mode]?.[slotType] || '', {
    isPersonalized,
    isFallback,
    sourceLabel: getSlotSourceLabel(slotType, context),
  });
}

function pickSourceTrackForSlot(tracks = [], context, slotType, usedKeys, refreshSeed = 0, slotOffset = 0, mode = 'trend') {
  const normalizedTracks = tracks
    .filter(isUsefulTrack)
    .map((track, index) => ({
      ...track,
      rank: Number.isFinite(track.rank) ? track.rank : index + 1,
      isSpotifyTopTrack: mode === 'spotify-top',
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
    return parsed.slots;
  } catch (error) {
    await AsyncStorage.removeItem(CACHE_KEY);
    return null;
  }
}

async function writeCachedRecommendations(cacheKey, slots) {
  const slotsWithoutArtworkCache = slots.map((slot) => ({
    ...slot,
    artworkUrl: '',
  }));

  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
    version: CACHE_VERSION,
    cacheKey,
    slots: slotsWithoutArtworkCache,
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
      return hydrateSlotsArtwork(resolvedCachedSlots);
    }
  }

  const events = await getListeningEvents(ownerId, 200).catch(() => []);
  const usedKeys = new Set(excludedKeys);
  const slotsByType = {};
  const hasNowhereData = hasEnoughListeningData(events) || hasLikeSignal(events);

  if (hasNowhereData) {
    Object.values(buildUserDataSlots(events, context, usedKeys)).forEach((slot) => {
      setPlayableSlot(slotsByType, usedKeys, slot);
    });
  }

  let missingSlots = PLAYABLE_SLOT_TYPES.filter((slotType) => !slotsByType[slotType]);
  if (missingSlots.length) {
    const spotifyPersonalTracks = await getSpotifyPersonalTracks(50);
    fillSlotsFromTracks(
      slotsByType,
      usedKeys,
      spotifyPersonalTracks,
      context,
      missingSlots,
      'spotify-top',
      refreshSeed
    );
  }

  missingSlots = PLAYABLE_SLOT_TYPES.filter((slotType) => !slotsByType[slotType]);
  if (missingSlots.length) {
    const chartTracks = await getSpotifyKoreaChartTracks(50);
    fillSlotsFromTracks(
      slotsByType,
      usedKeys,
      chartTracks,
      context,
      missingSlots,
      'trend',
      refreshSeed
    );
  }

  const slots = orderedRecommendationSlots(slotsByType, context);
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
      const slot = buildSlot('challenge', track, track.reason || '선택한 조합으로 찾은 새로운 추천이에요.', {
        searchQuery: track.searchQuery,
      });
      const resolved = await resolveSlotWithSpotify(
        { ...slot, isChallenge: false },
        buildChallengeSearchQuery(challenge, slot.searchQuery || [track.title, track.artist].filter(Boolean).join(' '))
      );
      if (isUsefulTrack(resolved) && shouldTrustChallengeTrack(resolved, challenge)) {
        const artworkUrl = resolved.artworkUrl || await resolveAlbumArtwork(resolved);
        return {
          ...resolved,
          artworkUrl,
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
