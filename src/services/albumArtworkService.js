const DEEZER_SEARCH_URL = 'https://api.deezer.com/search';
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const SEARCH_COUNTRIES = ['KR', 'US', 'JP'];
const memoryArtworkCache = new Map();

function normalizeKey(value = '') {
  return String(value).trim().toLowerCase();
}

function compactKey(value = '') {
  return normalizeKey(value)
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*]/g, '')
    .replace(/[^0-9a-z가-힣ぁ-んァ-ン一-龥]/g, '');
}

function splitArtistNames(value = '') {
  return normalizeKey(value)
    .split(/,|&|\/|\+| x | feat\.?| featuring | with | and |、|，/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function expandArtistCandidates(value = '') {
  const baseNames = splitArtistNames(value);
  const expanded = new Set();

  baseNames.forEach((name) => {
    const normalized = normalizeKey(name);
    const compact = compactKey(name);
    if (normalized) expanded.add(normalized);
    if (compact) expanded.add(compact);
  });

  return Array.from(expanded).filter(Boolean);
}

function buildCacheKey(track = {}) {
  return [track.title, track.artist].map(normalizeKey).filter(Boolean).join('::');
}

function upgradeItunesArtworkUrl(url = '') {
  if (!url) return '';
  return url
    .replace(/100x100bb\.(jpg|png|webp)$/i, '600x600bb.$1')
    .replace(/100x100-75\.(jpg|png|webp)$/i, '600x600bb.$1');
}

function scoreProviderResult({ resultTitle = '', resultArtist = '', hasArtwork = false } = {}, track = {}) {
  const title = normalizeKey(track.title);
  const compactTitle = compactKey(track.title);
  const requestedArtists = expandArtistCandidates(track.artist);
  const normalizedResultTitle = normalizeKey(resultTitle);
  const compactResultTitle = compactKey(resultTitle);
  const normalizedResultArtist = normalizeKey(resultArtist);
  const compactResultArtist = compactKey(resultArtist);
  const resultArtists = expandArtistCandidates(resultArtist);

  let titleScore = 0;
  if (title && normalizedResultTitle === title) titleScore = 80;
  else if (compactTitle && compactResultTitle === compactTitle) titleScore = 78;
  else if (title && (normalizedResultTitle.includes(title) || title.includes(normalizedResultTitle))) titleScore = 36;
  else if (compactTitle && (compactResultTitle.includes(compactTitle) || compactTitle.includes(compactResultTitle))) titleScore = 32;

  let artistScore = 0;
  requestedArtists.forEach((artist) => {
    if (
      resultArtists.includes(artist) ||
      normalizedResultArtist === artist ||
      compactResultArtist === artist
    ) {
      artistScore = Math.max(artistScore, 80);
    } else if (
      artist.length >= 3 &&
      (normalizedResultArtist.includes(artist) || compactResultArtist.includes(artist))
    ) {
      artistScore = Math.max(artistScore, 48);
    }
  });

  if (titleScore < 70 || artistScore < 70) {
    return 0;
  }

  let score = titleScore + artistScore;
  if (hasArtwork) score += 20;
  return score;
}

function getDeezerArtworkUrl(result = {}) {
  return result.album?.cover_xl || result.album?.cover_big || result.album?.cover_medium || result.album?.cover || '';
}

function scoreDeezerResult(result = {}, track = {}) {
  return scoreProviderResult({
    resultTitle: result.title,
    resultArtist: result.artist?.name,
    hasArtwork: Boolean(getDeezerArtworkUrl(result)),
  }, track);
}

function scoreItunesResult(result = {}, track = {}) {
  return scoreProviderResult({
    resultTitle: result.trackName,
    resultArtist: result.artistName,
    hasArtwork: Boolean(result.artworkUrl100),
  }, track);
}

async function searchDeezerArtwork(track = {}) {
  const query = [track.title, track.artist].filter(Boolean).join(' ');
  if (!query) return '';
  try {
    const params = new URLSearchParams({
      q: query,
      limit: '8',
    });
    const response = await fetch(`${DEEZER_SEARCH_URL}?${params.toString()}`);
    if (!response.ok) {
      return '';
    }

    const json = await response.json();
    const results = Array.isArray(json?.data) ? json.data : [];
    const match = results
      .map((result) => ({ result, score: scoreDeezerResult(result, track) }))
      .sort((left, right) => right.score - left.score)[0];
    return match?.score >= 150 ? getDeezerArtworkUrl(match.result) : '';
  } catch (error) {
    return '';
  }
}

async function searchItunesArtwork(track = {}, country = 'KR') {
  const term = [track.title, track.artist].filter(Boolean).join(' ');
  if (!term) return '';
  try {
    const params = new URLSearchParams({
      term,
      media: 'music',
      entity: 'song',
      country,
      limit: '8',
    });
    const response = await fetch(`${ITUNES_SEARCH_URL}?${params.toString()}`);
    if (!response.ok) {
      return '';
    }

    const json = await response.json();
    const results = Array.isArray(json?.results) ? json.results : [];
    const match = results
      .map((result) => ({ result, score: scoreItunesResult(result, track) }))
      .sort((left, right) => right.score - left.score)[0];
    return match?.score >= 150 ? upgradeItunesArtworkUrl(match.result.artworkUrl100) : '';
  } catch (error) {
    return '';
  }
}

export async function resolveAlbumArtwork(track = {}) {
  const cacheKey = buildCacheKey(track);
  if (!cacheKey) return '';
  if (memoryArtworkCache.has(cacheKey)) {
    return memoryArtworkCache.get(cacheKey);
  }

  const deezerArtworkUrl = await searchDeezerArtwork(track);
  if (deezerArtworkUrl) {
    memoryArtworkCache.set(cacheKey, deezerArtworkUrl);
    return deezerArtworkUrl;
  }

  for (const country of SEARCH_COUNTRIES) {
    const artworkUrl = await searchItunesArtwork(track, country);
    if (artworkUrl) {
      memoryArtworkCache.set(cacheKey, artworkUrl);
      return artworkUrl;
    }
  }

  memoryArtworkCache.set(cacheKey, '');
  return '';
}
