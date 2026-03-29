export { COLORS } from './colors';

// API Keys (replace with actual keys)
export const API_KEYS = {
  OPENWEATHER: 'YOUR_OPENWEATHER_API_KEY',
  KAKAO_MAPS: 'YOUR_KAKAO_MAPS_API_KEY',
  CLAUDE: 'YOUR_CLAUDE_API_KEY',
  FIREBASE: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
    databaseURL: 'YOUR_DATABASE_URL',
  },
};

export const RADIUS_OPTIONS = [100, 200, 300, 500];

export const WEATHER_MOODS = {
  Clear: { label: '맑음', emoji: '☀️', mood: 'bright', genres: ['indie pop', 'summer', 'upbeat'] },
  Clouds: { label: '흐림', emoji: '☁️', mood: 'mellow', genres: ['lo-fi', 'chill', 'acoustic'] },
  Rain: { label: '비', emoji: '🌧️', mood: 'rainy', genres: ['jazz', 'rain mix', 'ballad'] },
  Snow: { label: '눈', emoji: '❄️', mood: 'cozy', genres: ['acoustic', 'christmas', 'warm'] },
  Drizzle: { label: '이슬비', emoji: '🌦️', mood: 'rainy', genres: ['jazz', 'soft', 'cafe'] },
  Thunderstorm: { label: '폭풍', emoji: '⛈️', mood: 'intense', genres: ['rock', 'dramatic', 'cinematic'] },
};

export const TIME_MOODS = {
  morning: { label: '아침', range: [6, 11], genres: ['morning', 'energetic', 'upbeat'] },
  afternoon: { label: '낮', range: [11, 17], genres: ['pop', 'indie', 'chill'] },
  evening: { label: '저녁', range: [17, 21], genres: ['evening', 'indie pop', 'golden hour'] },
  night: { label: '밤', range: [21, 24], genres: ['night', 'r&b', 'dreamy', 'lo-fi'] },
  lateNight: { label: '새벽', range: [0, 6], genres: ['late night', 'ambient', 'slow'] },
};

export const GEOHASH_PRECISION = 6; // ~1.2km grid, then filter to 200m
export const VIBE_RADIUS_M = 200;
export const VIBE_REFRESH_INTERVAL_MS = 30000;

export const ANONYMOUS_NICKNAMES = [
  '익명의 달빛', '익명의 별빛', '익명의 새벽', '익명의 노을', '익명의 바람',
  '익명의 파도', '익명의 안개', '익명의 구름', '익명의 빗소리', '익명의 봄날',
];
