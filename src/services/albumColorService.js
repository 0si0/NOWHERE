import AsyncStorage from '@react-native-async-storage/async-storage';
import NativeNowherePlayer from 'nowhere-player';

export const DEFAULT_ALBUM_COLOR = '#FFC8B8';

const ALBUM_COLOR_CACHE_KEY = '@nowhere/album-color-cache-v1';
const MAX_CACHE_ITEMS = 320;
const memoryCache = new Map();
let cacheLoaded = false;
let cacheLoadPromise = null;

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

function normalizeColor(value) {
  return isHexColor(value) ? value.trim().toUpperCase() : '';
}

export function getAlbumArtUrl(track = {}) {
  return String(track.albumArtUrl || track.artworkUrl || track.imageUrl || '').trim();
}

export function getTrackColorKey(track = {}) {
  return [
    track.id,
    track.spotifyUri,
    track.uri,
    track.title || track.trackName,
    track.artist || track.artistName,
    track.album || track.albumName,
    getAlbumArtUrl(track),
  ].filter(Boolean).join(':');
}

function getCacheKey(track = {}) {
  const albumArtUrl = getAlbumArtUrl(track);
  return albumArtUrl || getTrackColorKey(track);
}

async function loadCache() {
  if (cacheLoaded) return;
  if (cacheLoadPromise) {
    await cacheLoadPromise;
    return;
  }

  cacheLoadPromise = AsyncStorage.getItem(ALBUM_COLOR_CACHE_KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      Object.entries(parsed).forEach(([key, value]) => {
        const color = normalizeColor(value?.color || value);
        if (key && color) {
          memoryCache.set(key, color);
        }
      });
    })
    .catch(() => null)
    .finally(() => {
      cacheLoaded = true;
      cacheLoadPromise = null;
    });

  await cacheLoadPromise;
}

async function persistCache() {
  const entries = Array.from(memoryCache.entries()).slice(-MAX_CACHE_ITEMS);
  const payload = entries.reduce((next, [key, color]) => {
    next[key] = { color, updatedAt: Date.now() };
    return next;
  }, {});
  await AsyncStorage.setItem(ALBUM_COLOR_CACHE_KEY, JSON.stringify(payload)).catch(() => null);
}

export function getCachedAlbumColor(trackOrUrl = {}) {
  const cacheKey = typeof trackOrUrl === 'string' ? trackOrUrl : getCacheKey(trackOrUrl);
  if (!cacheKey) return '';
  return normalizeColor(memoryCache.get(cacheKey));
}

export function getInitialAlbumColor(track = {}) {
  return getCachedAlbumColor(track) || DEFAULT_ALBUM_COLOR;
}

function componentToHex(value) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();
}

function rgbToHex(red, green, blue) {
  return `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`;
}

function getLuma(red, green, blue) {
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function hashAlbumColor(text = '') {
  if (!text) return DEFAULT_ALBUM_COLOR;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 62, 70);
}

function hslToHex(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) [red, green, blue] = [c, x, 0];
  else if (hue < 120) [red, green, blue] = [x, c, 0];
  else if (hue < 180) [red, green, blue] = [0, c, x];
  else if (hue < 240) [red, green, blue] = [0, x, c];
  else if (hue < 300) [red, green, blue] = [x, 0, c];
  else [red, green, blue] = [c, 0, x];

  return rgbToHex((red + m) * 255, (green + m) * 255, (blue + m) * 255);
}

function canUseCanvas() {
  return typeof document !== 'undefined' &&
    typeof Image !== 'undefined' &&
    typeof document.createElement === 'function';
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function getCanvasPixels(image, size = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);
  return context.getImageData(0, 0, size, size).data;
}

function extractDominantColorFromPixels(pixels) {
  if (!pixels) return '';
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 180) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const luma = getLuma(red, green, blue);
    if (luma < 24 || luma > 238) continue;
    const key = [
      Math.round(red / 24) * 24,
      Math.round(green / 24) * 24,
      Math.round(blue / 24) * 24,
    ].join(',');
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const dominant = Array.from(buckets.entries()).sort((left, right) => right[1] - left[1])[0];
  if (!dominant) return '';
  const [red, green, blue] = dominant[0].split(',').map(Number);
  return rgbToHex(red, green, blue);
}

function extractAverageColorFromPixels(pixels) {
  if (!pixels) return '';
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let count = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 180) continue;
    redTotal += pixels[index];
    greenTotal += pixels[index + 1];
    blueTotal += pixels[index + 2];
    count += 1;
  }

  if (!count) return '';
  return rgbToHex(redTotal / count, greenTotal / count, blueTotal / count);
}

async function extractImageColor(albumArtUrl) {
  if (!albumArtUrl || !canUseCanvas()) return '';
  const image = await loadImage(albumArtUrl);
  const pixels = getCanvasPixels(image, 32);
  return extractDominantColorFromPixels(pixels) || extractAverageColorFromPixels(pixels);
}

async function extractNativeImageColor(albumArtUrl) {
  if (!albumArtUrl || !NativeNowherePlayer?.extractAlbumColorAsync) return '';
  return normalizeColor(await NativeNowherePlayer.extractAlbumColorAsync(albumArtUrl).catch(() => ''));
}

export async function resolveAlbumColor(track = {}) {
  const cacheKey = getCacheKey(track);
  if (!cacheKey) return DEFAULT_ALBUM_COLOR;

  await loadCache();

  const cachedColor = getCachedAlbumColor(cacheKey);
  if (cachedColor) return cachedColor;

  const albumArtUrl = getAlbumArtUrl(track);
  const color = await extractNativeImageColor(albumArtUrl) ||
    normalizeColor(await extractImageColor(albumArtUrl).catch(() => '')) ||
    normalizeColor(hashAlbumColor(albumArtUrl || getTrackColorKey(track))) ||
    DEFAULT_ALBUM_COLOR;

  memoryCache.set(cacheKey, color);
  if (albumArtUrl) {
    memoryCache.set(albumArtUrl, color);
  }
  await persistCache();
  return color;
}
