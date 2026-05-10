import { RADIUS_OPTIONS } from '../constants';
import { encodeGeohash } from './locationService';

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function cleanText(value, label, { max = 120, allowEmpty = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  invariant(allowEmpty || text.length > 0, `${label}을(를) 입력해주세요.`);
  invariant(text.length <= max, `${label}은(는) ${max}자 이하로 입력해주세요.`);
  return text;
}

function cleanOptionalText(value, label, max = 240) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  return cleanText(value, label, { max, allowEmpty: true });
}

function cleanLatitude(value) {
  invariant(isNumeric(value), '위도 값이 올바르지 않습니다.');
  invariant(value >= -90 && value <= 90, '위도 범위를 벗어났습니다.');
  return Number(value.toFixed(6));
}

function cleanLongitude(value) {
  invariant(isNumeric(value), '경도 값이 올바르지 않습니다.');
  invariant(value >= -180 && value <= 180, '경도 범위를 벗어났습니다.');
  return Number(value.toFixed(6));
}

function cleanDisplayLatitude(value) {
  return Number(cleanLatitude(value).toFixed(3));
}

function cleanDisplayLongitude(value) {
  return Number(cleanLongitude(value).toFixed(3));
}

function cleanColor(value, fallback = '#FFC8B8') {
  const color = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : fallback;
}

function cleanPositiveInteger(value, fallback = 0) {
  return isNumeric(value) && value >= 0 ? Math.round(value) : fallback;
}

function cleanRadius(value) {
  invariant(RADIUS_OPTIONS.includes(value), '허용되지 않은 반경입니다.');
  return value;
}

function cleanPlaylist(rawPlaylist = {}) {
  const title = cleanOptionalText(rawPlaylist.title, '플레이리스트 제목', 120);
  const playlistId = cleanOptionalText(rawPlaylist.playlistId, '플레이리스트 ID', 120);
  const artworkUrl = cleanOptionalText(rawPlaylist.artworkUrl, '플레이리스트 이미지 URL', 500);
  const provider = ['spotify', 'unknown'].includes(rawPlaylist.provider)
    ? rawPlaylist.provider
    : 'unknown';

  return {
    provider,
    playlistId,
    title,
    artworkUrl,
  };
}

function cleanPlayTarget(rawTarget = {}) {
  const title = cleanOptionalText(rawTarget.title || rawTarget.name, '곡 제목', 160);
  const artist = cleanOptionalText(rawTarget.artist || rawTarget.artistName, '아티스트명', 160);
  const spotifyUri = cleanOptionalText(rawTarget.spotifyUri || rawTarget.uri, 'Spotify URI', 240);
  const id = cleanOptionalText(rawTarget.id || spotifyUri, '트랙 ID', 180);
  const album = cleanOptionalText(rawTarget.album || rawTarget.albumTitle, '앨범명', 160);
  const artworkUrl = cleanOptionalText(rawTarget.artworkUrl || rawTarget.albumArtUrl, '앨범 이미지 URL', 500);
  const durationMs = isNumeric(rawTarget.durationMs) && rawTarget.durationMs >= 0
    ? Math.round(rawTarget.durationMs)
    : 0;
  const provider = rawTarget.provider === 'spotify' ? 'spotify' : 'unknown';

  if (!title && !artist && !spotifyUri && !id && !artworkUrl) {
    return null;
  }

  invariant(title || spotifyUri || id, '자동재생할 곡 정보를 선택해주세요.');

  return {
    type: rawTarget.type === 'playlist' ? 'playlist' : 'track',
    provider,
    id: id || spotifyUri || title,
    spotifyUri,
    title: title || '선택한 곡',
    artist,
    album,
    artworkUrl,
    durationMs,
  };
}

function cleanRoutePoints(routePoints = []) {
  invariant(Array.isArray(routePoints), '뮤직지도 이동 경로 형식이 올바르지 않습니다.');
  invariant(routePoints.length <= 160, '뮤직지도 이동 경로는 최대 160개 지점까지 저장할 수 있습니다.');

  return routePoints
    .filter((point) => isNumeric(point?.latitude) && isNumeric(point?.longitude))
    .map((point) => ({
      latitude: cleanLatitude(point.latitude),
      longitude: cleanLongitude(point.longitude),
      recordedAt: cleanOptionalText(point.recordedAt, '경로 기록 시각', 64),
      segmentIndex: Number.isInteger(point.segmentIndex) && point.segmentIndex >= 0 ? point.segmentIndex : 0,
    }));
}

function cleanWeatherRules(weatherRules = []) {
  invariant(Array.isArray(weatherRules), '날씨 규칙 형식이 올바르지 않습니다.');
  invariant(weatherRules.length <= 8, '날씨 규칙은 최대 8개까지 저장할 수 있습니다.');
  const conditionSet = new Set();

  return weatherRules.map((rule) => {
    const condition = cleanText(rule.condition, '날씨 조건', { max: 40 });
    invariant(!conditionSet.has(condition), '같은 날씨 규칙은 한 번만 저장할 수 있습니다.');
    conditionSet.add(condition);

    const playlist = cleanPlaylist(rule.playlist);
    invariant(
      playlist.title || playlist.playlistId || playlist.artworkUrl,
      `${condition} 규칙에는 플레이리스트 정보를 하나 이상 입력해주세요.`
    );

    return {
      condition,
      playlist,
    };
  });
}

function cleanTimeRules(timeRules = []) {
  invariant(Array.isArray(timeRules), '시간 규칙 형식이 올바르지 않습니다.');
  invariant(timeRules.length <= 8, '시간 규칙은 최대 8개까지 저장할 수 있습니다.');
  const normalizedRules = timeRules.map((rule) => {
    invariant(Number.isInteger(rule.startHour) && rule.startHour >= 0 && rule.startHour <= 23, '시작 시간이 올바르지 않습니다.');
    invariant(Number.isInteger(rule.endHour) && rule.endHour >= 0 && rule.endHour <= 23, '종료 시간이 올바르지 않습니다.');
    invariant(rule.startHour !== rule.endHour, '시간 규칙의 시작과 종료 시각이 같을 수 없습니다.');

    const playlist = cleanPlaylist(rule.playlist);
    invariant(
      playlist.title || playlist.playlistId || playlist.artworkUrl,
      '시간 규칙에는 플레이리스트 정보를 하나 이상 입력해주세요.'
    );

    return {
      label: cleanText(rule.label, '시간 규칙 이름', { max: 40 }),
      startHour: rule.startHour,
      endHour: rule.endHour,
      playlist,
    };
  });

  normalizedRules.forEach((rule, index) => {
    normalizedRules.slice(index + 1).forEach((nextRule) => {
      const overlaps = rule.startHour < nextRule.endHour && nextRule.startHour < rule.endHour;
      invariant(!overlaps, '시간대 규칙이 서로 겹칠 수 없습니다.');
    });
  });

  return normalizedRules;
}

export function buildUserProfileDocument(user) {
  return {
    uid: user.uid,
    isAnonymous: !!user.isAnonymous,
    lastLoginAt: new Date().toISOString(),
    profileVersion: 1,
  };
}

export function sanitizeSavedPlaceInput(input) {
  const latitude = cleanLatitude(input.latitude);
  const longitude = cleanLongitude(input.longitude);
  const playTarget = cleanPlayTarget(input.playTarget);

  return {
    userId: cleanText(input.userId, '사용자 ID', { max: 128 }),
    name: cleanText(input.name, '장소 이름', { max: 60 }),
    radiusMeters: cleanRadius(input.radiusMeters),
    coordinates: {
      latitude,
      longitude,
    },
    geohash: encodeGeohash(latitude, longitude),
    playlist: cleanPlaylist(input.playlist),
    playTarget,
    weatherRules: cleanWeatherRules(input.weatherRules),
    timeRules: cleanTimeRules(input.timeRules),
    status: input.status === 'archived' ? 'archived' : 'active',
    source: cleanOptionalText(input.source, '저장 소스', 40) || 'manual',
  };
}

export function sanitizePlayRecordInput(input) {
  const hasCoordinates = isNumeric(input.latitude) && isNumeric(input.longitude);
  const latitude = hasCoordinates ? cleanLatitude(input.latitude) : null;
  const longitude = hasCoordinates ? cleanLongitude(input.longitude) : null;
  const geohash = hasCoordinates
    ? encodeGeohash(latitude, longitude)
    : cleanOptionalText(input.geohash, '지오해시', 12);

  return {
    userId: cleanText(input.userId, '사용자 ID', { max: 128 }),
    trackId: cleanText(input.trackId, '트랙 ID', { max: 160 }),
    title: cleanText(input.title, '곡 제목', { max: 160 }),
    artist: cleanText(input.artist, '아티스트명', { max: 160 }),
    albumArtUrl: cleanOptionalText(input.albumArtUrl, '앨범 이미지 URL', 500),
    provider: ['spotify', 'manual', 'unknown'].includes(input.provider)
      ? input.provider
      : 'unknown',
    placeName: cleanOptionalText(input.placeName, '장소 이름', 80),
    savedPlaceId: cleanOptionalText(input.savedPlaceId, '저장된 장소 ID', 160),
    location: {
      latitude,
      longitude,
      geohash,
    },
  };
}

export function sanitizeListeningEventInput(input) {
  const hasCoordinates = isNumeric(input.latitude) && isNumeric(input.longitude);
  const latitude = hasCoordinates ? cleanLatitude(input.latitude) : null;
  const longitude = hasCoordinates ? cleanLongitude(input.longitude) : null;
  const geohash = hasCoordinates
    ? encodeGeohash(latitude, longitude)
    : cleanOptionalText(input.geohash, '지오해시', 12);
  const track = cleanPlayTarget(input.track || input.playTarget || input);
  invariant(track, '청취 이벤트에는 곡 정보가 필요합니다.');

  const occurredAt = typeof input.occurredAt === 'string' && input.occurredAt
    ? input.occurredAt
    : new Date().toISOString();

  return {
    userId: cleanText(input.userId, '사용자 ID', { max: 128 }),
    schemaVersion: Number.isInteger(input.schemaVersion) ? input.schemaVersion : 1,
    eventType: cleanOptionalText(input.eventType, '이벤트 종류', 40) || 'play',
    source: cleanOptionalText(input.source, '청취 소스', 40) || 'unknown',
    recommendationSlot: cleanOptionalText(input.recommendationSlot, '추천 슬롯', 40),
    track,
    context: {
      timeBucket: cleanOptionalText(input.timeBucket, '시간대', 40),
      hour: Number.isInteger(input.hour) && input.hour >= 0 && input.hour <= 23 ? input.hour : new Date(occurredAt).getHours(),
      weatherCondition: cleanOptionalText(input.weatherCondition, '날씨 조건', 40),
      weatherMood: cleanOptionalText(input.weatherMood, '날씨 분위기', 60),
      placeName: cleanOptionalText(input.placeName, '장소 이름', 80),
      savedPlaceId: cleanOptionalText(input.savedPlaceId, '저장 장소 ID', 160),
      geohash,
      location: {
        latitude,
        longitude,
      },
    },
    challenge: {
      genre: cleanOptionalText(input.challenge?.genre, 'Challenge 장르', 40),
      country: cleanOptionalText(input.challenge?.country, 'Challenge 나라', 40),
      mood: cleanOptionalText(input.challenge?.mood, 'Challenge 분위기', 40),
      request: cleanOptionalText(input.challenge?.request, 'Challenge 추가 요청', 30),
    },
    occurredAt,
  };
}

export function sanitizeMusicMapRecordInput(input) {
  const latitude = cleanLatitude(input.latitude);
  const longitude = cleanLongitude(input.longitude);
  const track = cleanPlayTarget(input.track || input.playTarget || input);
  invariant(track, '뮤직지도 기록에는 곡 정보가 필요합니다.');

  const recordedAt = typeof input.recordedAt === 'string' && input.recordedAt
    ? input.recordedAt
    : new Date().toISOString();
  const startedAt = typeof input.startedAt === 'string' && input.startedAt
    ? input.startedAt
    : recordedAt;

  return {
    userId: cleanText(input.userId, '사용자 ID', { max: 128 }),
    schemaVersion: Number.isInteger(input.schemaVersion) ? input.schemaVersion : 1,
    recordType: input.recordType === 'track' ? 'track' : 'pin',
    source: cleanOptionalText(input.source, '기록 소스', 40) || 'spotify-playback',
    sessionId: cleanOptionalText(input.sessionId, '세션 ID', 80),
    track,
    albumColor: cleanColor(input.albumColor || track.color),
    albumArtUrl: cleanOptionalText(input.albumArtUrl || track.artworkUrl, '앨범 이미지 URL', 500),
    placeName: cleanOptionalText(input.placeName, '장소 이름', 80),
    location: {
      latitude,
      longitude,
      geohash: encodeGeohash(latitude, longitude),
    },
    routePoints: cleanRoutePoints(input.routePoints),
    playedDurationMs: cleanPositiveInteger(input.playedDurationMs),
    startedAt,
    recordedAt,
  };
}

export function sanitizeMusicMapPublicRecordInput(input) {
  const latitude = cleanDisplayLatitude(input.latitude);
  const longitude = cleanDisplayLongitude(input.longitude);
  const track = cleanPlayTarget(input.track || input.playTarget || input);
  invariant(track, '뮤직지도 전체 기록에는 곡 정보가 필요합니다.');

  const recordedAt = typeof input.recordedAt === 'string' && input.recordedAt
    ? input.recordedAt
    : new Date().toISOString();
  const startedAt = typeof input.startedAt === 'string' && input.startedAt
    ? input.startedAt
    : recordedAt;

  return {
    schemaVersion: Number.isInteger(input.schemaVersion) ? input.schemaVersion : 1,
    recordType: input.recordType === 'track' ? 'track' : 'pin',
    source: cleanOptionalText(input.source, '기록 소스', 40) || 'spotify-playback',
    track: {
      type: track.type,
      provider: track.provider,
      id: track.id,
      spotifyUri: '',
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artworkUrl,
      durationMs: track.durationMs,
    },
    albumColor: cleanColor(input.albumColor || track.color),
    albumArtUrl: cleanOptionalText(input.albumArtUrl || track.artworkUrl, '앨범 이미지 URL', 500),
    placeName: cleanOptionalText(input.placeName, '장소 이름', 80),
    location: {
      latitude,
      longitude,
      geohash: encodeGeohash(latitude, longitude),
    },
    routePoints: cleanRoutePoints(input.routePoints).map((point) => ({
      ...point,
      latitude: Number(point.latitude.toFixed(3)),
      longitude: Number(point.longitude.toFixed(3)),
    })),
    playedDurationMs: cleanPositiveInteger(input.playedDurationMs),
    startedAt,
    recordedAt,
  };
}

export function sanitizeConsentInput(input) {
  invariant(typeof input.granted === 'boolean', '동의 여부 형식이 올바르지 않습니다.');

  return {
    userId: cleanText(input.userId, '사용자 ID', { max: 128 }),
    consentType: cleanText(input.consentType, '동의 종류', { max: 40 }),
    granted: input.granted,
    version: cleanOptionalText(input.version, '동의 버전', 20) || 'v1',
  };
}

export function sanitizeVibePayload(input) {
  return {
    geohash: cleanText(input.geohash, '지오해시', { max: 12 }),
    sessionId: cleanText(input.sessionId, '세션 ID', { max: 80 }),
    uid: cleanText(input.uid, '사용자 ID', { max: 128 }),
    nickname: cleanText(input.nickname, '닉네임', { max: 40 }),
    trackId: cleanOptionalText(input.trackId, '트랙 ID', 160),
    trackTitle: cleanText(input.trackTitle, '곡 제목', { max: 160 }),
    trackArtist: cleanText(input.trackArtist, '아티스트명', { max: 160 }),
    provider: ['spotify', 'unknown'].includes(input.provider)
      ? input.provider
      : 'unknown',
  };
}
