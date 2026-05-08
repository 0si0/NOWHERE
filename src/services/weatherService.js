import { WEATHER_MOODS } from '../constants';

const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast';

const WEATHER_CODE_MAP = [
  { codes: [0], condition: 'Clear', description: '맑음' },
  { codes: [1, 2, 3, 45, 48], condition: 'Clouds', description: '흐림' },
  { codes: [51, 53, 55, 56, 57], condition: 'Drizzle', description: '이슬비' },
  { codes: [61, 63, 65, 66, 67, 80, 81, 82], condition: 'Rain', description: '비' },
  { codes: [71, 73, 75, 77, 85, 86], condition: 'Snow', description: '눈' },
  { codes: [95, 96, 99], condition: 'Thunderstorm', description: '폭풍' },
];

function resolveWeatherCode(code) {
  const matched = WEATHER_CODE_MAP.find((entry) => entry.codes.includes(Number(code)));
  return matched || WEATHER_CODE_MAP[0];
}

export function isWeatherConfigured() {
  return true;
}

export async function getCurrentWeather(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('날씨를 가져올 위치 정보가 없습니다.');
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
    timezone: 'auto',
  });

  const response = await fetch(`${OPEN_METEO_BASE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Weather fetch failed (${response.status})`);
  }

  const data = await response.json();
  const current = data.current || {};
  const resolved = resolveWeatherCode(current.weather_code);

  return {
    condition: resolved.condition,
    description: resolved.description,
    temp: Math.round(current.temperature_2m ?? 0),
    feelsLike: Math.round(current.apparent_temperature ?? current.temperature_2m ?? 0),
    humidity: Math.round(current.relative_humidity_2m ?? 0),
    city: '',
    mood: WEATHER_MOODS[resolved.condition] || WEATHER_MOODS.Clear,
    source: 'open-meteo',
    fetchedAt: Date.now(),
  };
}

export function getWeatherEmoji(condition) {
  return WEATHER_MOODS[condition]?.emoji || '🌤️';
}

export function getWeatherMoodLabel(condition) {
  return WEATHER_MOODS[condition]?.label || '맑음';
}
