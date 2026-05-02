export { COLORS } from './colors';

const env = process.env || {};

const PUBLIC_FALLBACK_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyDg9tqV3xpvIhwF0l61i4u8eIJKL6LNsmQ',
    authDomain: 'nowhere-a5e09.firebaseapp.com',
    projectId: 'nowhere-a5e09',
    storageBucket: 'nowhere-a5e09.firebasestorage.app',
    messagingSenderId: '498231005645',
    appId: '1:498231005645:web:3a9b323a3e3d98ea7d3484',
    databaseURL: '',
  },
  kakaoMapsApiKey: '4e752d3d73703df97c9740921b1e37f0',
  kakaoMapsBaseUrl: 'https://nowhere-a5e09.web.app',
  spotifyClientId: 'cc6b822a806d4e2e909921ac3a69b681',
  spotifyRedirectUri: 'com.nowhere.nowhere://spotify-auth',
};

// Firebase client config values are safe to ship in the app bundle.
// Secrets such as OpenAI API keys should stay in Cloud Functions only.
export const API_KEYS = {
  OPENWEATHER: env.EXPO_PUBLIC_OPENWEATHER_API_KEY || 'YOUR_OPENWEATHER_API_KEY',
  KAKAO_MAPS: env.EXPO_PUBLIC_KAKAO_MAPS_API_KEY || PUBLIC_FALLBACK_CONFIG.kakaoMapsApiKey,
  KAKAO_MAPS_BASE_URL: env.EXPO_PUBLIC_KAKAO_MAPS_BASE_URL || (
    env.EXPO_PUBLIC_FIREBASE_PROJECT_ID
      ? `https://${env.EXPO_PUBLIC_FIREBASE_PROJECT_ID}.web.app`
      : PUBLIC_FALLBACK_CONFIG.kakaoMapsBaseUrl
  ),
  OPENAI: '',
  SPOTIFY: {
    clientId: env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID || PUBLIC_FALLBACK_CONFIG.spotifyClientId,
    redirectUri: env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI || PUBLIC_FALLBACK_CONFIG.spotifyRedirectUri,
  },
  FIREBASE: {
    apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY || PUBLIC_FALLBACK_CONFIG.firebase.apiKey,
    authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || PUBLIC_FALLBACK_CONFIG.firebase.authDomain,
    projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || PUBLIC_FALLBACK_CONFIG.firebase.projectId,
    storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || PUBLIC_FALLBACK_CONFIG.firebase.storageBucket,
    messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || PUBLIC_FALLBACK_CONFIG.firebase.messagingSenderId,
    appId: env.EXPO_PUBLIC_FIREBASE_APP_ID || PUBLIC_FALLBACK_CONFIG.firebase.appId,
    databaseURL: env.EXPO_PUBLIC_FIREBASE_DATABASE_URL || PUBLIC_FALLBACK_CONFIG.firebase.databaseURL,
  },
};

export const FIREBASE_RUNTIME = {
  functionsRegion: env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION || 'asia-northeast3',
  useEmulators: env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true',
  emulatorHost: env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || '',
};

export const RADIUS_OPTIONS = [50, 100, 200, 300];
export const MAX_AUTOPLAY_PLACES = 5;

export const PLAYLIST_PROVIDERS = [
  { value: 'unknown', label: '미정' },
  { value: 'spotify', label: 'Spotify' },
];

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
