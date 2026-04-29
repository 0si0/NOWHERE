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
