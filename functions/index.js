const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

initializeApp();
const db = getFirestore();

setGlobalOptions({
  region: 'asia-northeast3',
  maxInstances: 10,
});

const openAiApiKey = defineSecret('OPENAI_API_KEY');
const telegramBotToken = defineSecret('TELEGRAM_BOT_TOKEN');
const telegramChatId = defineSecret('TELEGRAM_CHAT_ID');
const spotifyOwnerClientId = defineSecret('SPOTIFY_OWNER_CLIENT_ID');
const spotifyOwnerClientSecret = defineSecret('SPOTIFY_OWNER_CLIENT_SECRET');
const DAILY_GENERAL_AI_LIMIT = 30;
const DAILY_CHALLENGE_AI_LIMIT = 5;
const DEFAULT_RECOMMENDATION_MODEL = process.env.OPENAI_RECOMMENDATION_MODEL || 'gpt-4.1-nano';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SPOTIFY_REQUESTED_TREND_PLAYLIST_ID = '37i9dQZEVXbJZGli0rRP3r';
const SPOTIFY_KR_TOP_50_PLAYLIST_ID = '37i9dQZEVXbNxXF4SkHj9F';
let ownerSpotifyTokenCache = {
  accessToken: '',
  accessTokenExpiresAt: 0,
};

function getOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY || openAiApiKey.value();
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'OPENAI_API_KEY is not configured.');
  }
  return apiKey;
}

function getKstDayKey(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function cleanText(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Spotify email address is invalid.');
  }
  return email;
}

function getSpotifyOwnerClientId() {
  const clientId = process.env.SPOTIFY_OWNER_CLIENT_ID || spotifyOwnerClientId.value();
  if (!clientId) {
    throw new HttpsError('failed-precondition', 'SPOTIFY_OWNER_CLIENT_ID is not configured.');
  }
  return clientId;
}

function getSpotifyOwnerClientSecret() {
  const clientSecret = process.env.SPOTIFY_OWNER_CLIENT_SECRET || spotifyOwnerClientSecret.value();
  if (!clientSecret) {
    throw new HttpsError('failed-precondition', 'SPOTIFY_OWNER_CLIENT_SECRET is not configured.');
  }
  return clientSecret;
}

function firstString(source = {}, keys = []) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeSpotifyTrack(item = {}) {
  const album = item.album || {};
  const images = Array.isArray(album.images) ? album.images : [];
  const artists = Array.isArray(item.artists) ? item.artists : [];
  const uri = firstString(item, ['uri']);
  return {
    id: firstString(item, ['id']) || uri,
    provider: 'spotify',
    spotifyUri: uri,
    uri,
    title: firstString(item, ['name']) || 'Unknown Track',
    artist: firstString(artists[0] || {}, ['name']) || 'Unknown Artist',
    album: firstString(album, ['name']),
    artworkUrl: firstString(images[0] || {}, ['url']),
    durationMs: Number(item.duration_ms || 0),
  };
}

function normalizeSpotifyArtist(item = {}) {
  const images = Array.isArray(item.images) ? item.images : [];
  const uri = firstString(item, ['uri']);
  return {
    id: firstString(item, ['id']) || uri,
    provider: 'spotify',
    spotifyUri: uri,
    uri,
    name: firstString(item, ['name']) || 'Unknown Artist',
    artworkUrl: firstString(images[0] || {}, ['url']),
    imageUrl: firstString(images[0] || {}, ['url']),
    popularity: Number(item.popularity || 0),
    genres: Array.isArray(item.genres) ? item.genres.slice(0, 6) : [],
  };
}

function uniqueSpotifyTracks(tracks = []) {
  const used = new Set();
  return tracks.filter((track) => {
    const key = String(track.spotifyUri || track.id || `${track.title}::${track.artist}`).toLowerCase();
    if (!key || used.has(key) || !track.spotifyUri || !track.artworkUrl) {
      return false;
    }
    used.add(key);
    return true;
  });
}

async function getOwnerSpotifyAccessToken() {
  if (
    ownerSpotifyTokenCache.accessToken &&
    ownerSpotifyTokenCache.accessTokenExpiresAt > Date.now() + 60 * 1000
  ) {
    return ownerSpotifyTokenCache.accessToken;
  }

  const credentials = Buffer
    .from(`${getSpotifyOwnerClientId()}:${getSpotifyOwnerClientSecret()}`)
    .toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials' });

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.access_token) {
    logger.error('Owner Spotify app token request failed', {
      status: response.status,
      error: json?.error,
      errorDescription: json?.error_description,
    });
    throw new HttpsError('failed-precondition', 'Owner Spotify app token request failed.');
  }
  ownerSpotifyTokenCache.accessToken = json.access_token;
  ownerSpotifyTokenCache.accessTokenExpiresAt = Date.now() + Math.max(60, Number(json.expires_in || 3600)) * 1000;
  return json.access_token;
}

async function ownerSpotifyJSONRequest(path, accessToken) {
  const response = await fetch(`https://api.spotify.com${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    logger.warn('Owner Spotify request failed', {
      path,
      status: response.status,
      error: json?.error,
    });
    return null;
  }
  return json;
}

async function getOwnerPlaylistTracks(accessToken, playlistId, limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 50));
  const playlistPath = `/v1/playlists/${playlistId}/tracks?limit=${safeLimit}&offset=0&market=KR&additional_types=track`;
  const fallbackPath = `/v1/playlists/${playlistId}/tracks?limit=${safeLimit}&offset=0&additional_types=track`;
  const json = await ownerSpotifyJSONRequest(playlistPath, accessToken)
    || await ownerSpotifyJSONRequest(fallbackPath, accessToken);
  return (Array.isArray(json?.items) ? json.items : [])
    .map((item) => item?.track)
    .filter((track) => track?.type === 'track')
    .map(normalizeSpotifyTrack);
}

async function getOwnerKoreaTop50Tracks(accessToken, limit) {
  const requestedPlaylistTracks = await getOwnerPlaylistTracks(
    accessToken,
    SPOTIFY_REQUESTED_TREND_PLAYLIST_ID,
    limit
  );
  if (requestedPlaylistTracks.length) {
    logger.info('Owner Spotify requested trend playlist loaded.', {
      playlistId: SPOTIFY_REQUESTED_TREND_PLAYLIST_ID,
      count: requestedPlaylistTracks.length,
    });
    return {
      playlistId: SPOTIFY_REQUESTED_TREND_PLAYLIST_ID,
      tracks: requestedPlaylistTracks,
    };
  }

  logger.warn('Requested Spotify trend playlist unavailable; falling back to original Korea Top50 playlist.', {
    playlistId: SPOTIFY_REQUESTED_TREND_PLAYLIST_ID,
  });

  const playlistTracks = await getOwnerPlaylistTracks(
    accessToken,
    SPOTIFY_KR_TOP_50_PLAYLIST_ID,
    limit
  );
  if (playlistTracks.length) {
    return {
      playlistId: SPOTIFY_KR_TOP_50_PLAYLIST_ID,
      tracks: playlistTracks,
    };
  }

  logger.warn('Owner Spotify Top50 playlists unavailable; falling back to search catalog.');
  const fallbackQueries = [
    'K-Pop 2026',
    'K-Pop hits',
    'Korean pop hits',
    'Korea chart hits',
    '인기 K팝',
  ];
  const collectedTracks = [];
  for (const query of fallbackQueries) {
    if (collectedTracks.length >= limit) {
      break;
    }
    const tracks = await searchOwnerSpotifyTracks(accessToken, query, Math.min(10, limit - collectedTracks.length));
    collectedTracks.push(...tracks);
  }
  return {
    playlistId: 'owner-search-fallback',
    tracks: uniqueSpotifyTracks(collectedTracks).slice(0, limit),
  };
}

async function searchOwnerSpotifyArtists(accessToken, queryText, limit) {
  const query = encodeURIComponent(queryText);
  const json = await ownerSpotifyJSONRequest(
    `/v1/search?type=artist&limit=${limit}&market=KR&q=${query}`,
    accessToken
  );
  return (Array.isArray(json?.artists?.items) ? json.artists.items : [])
    .map(normalizeSpotifyArtist)
    .filter((artist) => artist.id && artist.name);
}

async function searchOwnerSpotifyTracks(accessToken, queryText, limit) {
  const query = encodeURIComponent(queryText);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 10));
  const json = await ownerSpotifyJSONRequest(
    `/v1/search?type=track&limit=${safeLimit}&market=KR&q=${query}`,
    accessToken
  );
  return (Array.isArray(json?.tracks?.items) ? json.tracks.items : [])
    .filter((track) => track?.type === 'track')
    .map(normalizeSpotifyTrack);
}

function textIncludesNeedle(value, needle) {
  const left = String(value || '').trim().toLowerCase();
  const right = String(needle || '').trim().toLowerCase();
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

async function getOwnerArtistTopTracks(accessToken, artistId, artistName = '') {
  if (!artistId && !artistName) {
    return [];
  }

  const query = cleanText(artistName, 160);
  if (query) {
    const searchTracks = await searchOwnerSpotifyTracks(accessToken, query, 20);
    const exactArtistTracks = searchTracks.filter((track) => textIncludesNeedle(track.artist, query));
    const pickedTracks = exactArtistTracks.length ? exactArtistTracks : searchTracks;
    if (pickedTracks.length) {
      logger.info('Owner Spotify artist tracks loaded from search catalog.', {
        artistId,
        artistName: query,
        count: pickedTracks.length,
      });
      return pickedTracks.slice(0, 10);
    }
  }

  if (artistId) {
    const json = await ownerSpotifyJSONRequest(
      `/v1/artists/${encodeURIComponent(artistId)}/top-tracks?market=KR`,
      accessToken
    );
    const topTracks = (Array.isArray(json?.tracks) ? json.tracks : [])
      .filter((track) => track?.type === 'track')
      .map(normalizeSpotifyTrack);
    if (topTracks.length) {
      return topTracks;
    }
  }
  return [];
}

async function resolveOwnerArtist(accessToken, artist = {}) {
  const artistId = cleanText(artist.id || artist.spotifyId, 120);
  if (artistId) {
    return {
      id: artistId,
      name: cleanText(artist.name, 160),
    };
  }

  const artistName = cleanText(artist.name, 160);
  if (!artistName) {
    return null;
  }
  const matches = await searchOwnerSpotifyArtists(accessToken, artistName, 1);
  return matches[0] || null;
}

function escapeTelegramHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendSpotifyAccessRequestTelegram(payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN || telegramBotToken.value();
  const chatId = process.env.TELEGRAM_CHAT_ID || telegramChatId.value();
  if (!token || !chatId) {
    throw new HttpsError('failed-precondition', 'Telegram secrets are not configured.');
  }

  const message = [
    '<b>NOWHERE Spotify 등록 요청</b>',
    '',
    `<b>Spotify name</b>: ${escapeTelegramHtml(payload.spotifyFullName)}`,
    `<b>Spotify email</b>: ${escapeTelegramHtml(payload.spotifyEmail)}`,
    `<b>NOWHERE uid</b>: <code>${escapeTelegramHtml(payload.nowhereUserId)}</code>`,
    `<b>NOWHERE email</b>: ${escapeTelegramHtml(payload.nowhereEmail || '(unknown)')}`,
    `<b>Request id</b>: <code>${escapeTelegramHtml(payload.requestId)}</code>`,
    `<b>Created at</b>: ${escapeTelegramHtml(payload.createdAtIso)}`,
    '',
    'Spotify Developer Dashboard > Users Management에 위 계정을 수동 등록하세요.',
  ].join('\n');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new HttpsError('internal', `Telegram notification failed: ${body || response.status}`);
  }
}

async function assertDailyAiQuota(uid, usageType = 'general', limit = DAILY_GENERAL_AI_LIMIT) {
  const dayKey = getKstDayKey();
  const usageRef = db
    .collection('users')
    .doc(uid)
    .collection('aiUsage')
    .doc(`${dayKey}-${usageType}`);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(usageRef);
    const currentCount = snapshot.exists ? Number(snapshot.data().count || 0) : 0;

    if (currentCount >= limit) {
      throw new HttpsError('resource-exhausted', 'Daily AI recommendation limit reached.');
    }

    const nextUsage = {
      count: currentCount + 1,
      limit,
      dayKey,
      usageType,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!snapshot.exists) {
      nextUsage.createdAt = FieldValue.serverTimestamp();
    }

    transaction.set(usageRef, nextUsage, { merge: true });
  });
}

function extractOutputText(body) {
  return body?.output_text
    || body?.output?.flatMap((item) => item.content || [])
      .map((content) => content.text)
      .filter(Boolean)
      .join('\n')
    || '';
}

async function createStructuredRecommendation({ schemaName, schema, prompt, temperature = 0.7 }) {
  const apiKey = getOpenAiApiKey();

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_RECOMMENDATION_MODEL,
        input: prompt,
        temperature,
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
    });
  } catch (error) {
    logger.error('OpenAI request failed', error);
    throw new HttpsError('unavailable', 'GPT recommendation request failed.');
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    logger.error('OpenAI response failed', body);
    throw new HttpsError('internal', 'GPT recommendation response failed.');
  }

  const outputText = extractOutputText(body);
  try {
    return JSON.parse(outputText);
  } catch (error) {
    logger.error('OpenAI output parse failed', { outputText });
    throw new HttpsError('internal', 'GPT recommendation output was not valid JSON.');
  }
}

const trackSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slotType', 'title', 'artist', 'reason', 'searchQuery'],
  properties: {
    slotType: { type: 'string', enum: ['taste', 'time', 'place', 'weather', 'challenge'] },
    title: { type: 'string' },
    artist: { type: 'string' },
    reason: { type: 'string' },
    searchQuery: { type: 'string' },
  },
};

const challengeTrackSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'artist', 'reason', 'searchQuery'],
  properties: {
    title: { type: 'string' },
    artist: { type: 'string' },
    reason: { type: 'string' },
    searchQuery: { type: 'string' },
  },
};

exports.submitSpotifyAccessRequest = onCall({
  timeoutSeconds: 20,
  memory: '256MiB',
  secrets: [telegramBotToken, telegramChatId],
}, async (request) => {
  const spotifyFullName = cleanText(request.data?.spotifyFullName, 120);
  const spotifyEmail = cleanEmail(request.data?.spotifyEmail);
  if (!spotifyFullName) {
    throw new HttpsError('invalid-argument', 'Spotify full name is required.');
  }

  const createdAtIso = new Date().toISOString();
  const docRef = db.collection('spotifyAccessRequests').doc();
  const nowhereUserId = request.auth?.uid || cleanText(request.data?.nowhereUserId, 128);
  const nowhereEmail = cleanText(request.auth?.token?.email || request.data?.nowhereEmail, 254);
  const payload = {
    userId: nowhereUserId,
    fullName: spotifyFullName,
    spotifyFullName,
    spotifyEmail,
    nowhereUserId,
    nowhereEmail,
    isAuthenticatedRequest: Boolean(request.auth),
    status: 'pending',
    source: 'contest-demo',
    notificationStatus: 'pending',
    requestedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    createdAtIso,
  };

  await docRef.set(payload);
  if (nowhereUserId) {
    await db.collection('spotifyAccessRequestStatuses').doc(nowhereUserId).set({
      ...payload,
      latestRequestId: docRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  try {
    await sendSpotifyAccessRequestTelegram({
      ...payload,
      requestId: docRef.id,
    });
    await docRef.set({
      notificationStatus: 'sent',
      notifiedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    logger.error('Spotify access request Telegram notification failed', {
      requestId: docRef.id,
      uid: nowhereUserId,
      message: error?.message || String(error),
    });
    await docRef.set({
      notificationStatus: 'failed',
      notificationError: cleanText(error?.message || String(error), 500),
      notificationFailedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new HttpsError(
      error instanceof HttpsError ? error.code : 'internal',
      error?.message || 'Spotify access request notification failed.'
    );
  }

  return {
    ok: true,
    requestId: docRef.id,
    status: 'pending',
    notificationSent: true,
  };
});

exports.getSpotifyAccessRequestStatus = onCall({
  timeoutSeconds: 10,
  memory: '256MiB',
}, async (request) => {
  const uid = request.auth?.uid || cleanText(request.data?.nowhereUserId, 128);
  const requestId = cleanText(request.data?.requestId, 128);
  let snapshot = null;

  if (uid) {
    const statusDoc = await db.collection('spotifyAccessRequestStatuses').doc(uid).get();
    if (statusDoc.exists) {
      snapshot = { id: statusDoc.id, ...statusDoc.data() };
    }
  }

  if (!snapshot && requestId) {
    const requestDoc = await db.collection('spotifyAccessRequests').doc(requestId).get();
    if (requestDoc.exists) {
      snapshot = { id: requestDoc.id, ...requestDoc.data() };
    }
  }

  if (!snapshot) {
    return { ok: true, status: 'none' };
  }

  const ownsRequest = !uid || !snapshot.nowhereUserId || snapshot.nowhereUserId === uid || snapshot.userId === uid;
  if (!ownsRequest) {
    throw new HttpsError('permission-denied', 'Spotify access request belongs to another user.');
  }

  return {
    ok: true,
    requestId: snapshot.latestRequestId || snapshot.id || '',
    status: cleanText(snapshot.status, 40) || 'pending',
    fullName: cleanText(snapshot.fullName || snapshot.spotifyFullName, 120),
    spotifyEmail: cleanText(snapshot.spotifyEmail, 254),
    requestedAtIso: cleanText(snapshot.createdAtIso, 40),
  };
});

exports.getDemoSpotifyTracks = onCall({
  timeoutSeconds: 20,
  memory: '256MiB',
  secrets: [spotifyOwnerClientId, spotifyOwnerClientSecret],
}, async (request) => {
  const limitValue = Number(request.data?.limit || 50);
  const limit = Math.max(1, Math.min(Number.isFinite(limitValue) ? limitValue : 50, 50));
  const accessToken = await getOwnerSpotifyAccessToken();

  const chartResult = await getOwnerKoreaTop50Tracks(accessToken, limit).catch((error) => {
    logger.warn('Owner KR Top 50 fallback failed', { message: error?.message || String(error) });
    return { playlistId: '', tracks: [] };
  });
  const chartTracks = Array.isArray(chartResult?.tracks) ? chartResult.tracks : [];

  return {
    ok: true,
    provider: 'spotify-owner-demo',
    requestedPlaylistId: SPOTIFY_REQUESTED_TREND_PLAYLIST_ID,
    playlistId: chartResult?.playlistId || '',
    chartTracks: uniqueSpotifyTracks(chartTracks.map((track, index) => ({ ...track, rank: index + 1 }))),
  };
});

exports.searchSpotifyArtists = onCall({
  timeoutSeconds: 15,
  memory: '256MiB',
  secrets: [spotifyOwnerClientId, spotifyOwnerClientSecret],
}, async (request) => {
  const query = cleanText(request.data?.query, 120);
  if (query.length < 2) {
    return { ok: true, artists: [] };
  }

  const limitValue = Number(request.data?.limit || 8);
  const limit = Math.max(1, Math.min(Number.isFinite(limitValue) ? limitValue : 8, 12));
  const accessToken = await getOwnerSpotifyAccessToken();
  const artists = await searchOwnerSpotifyArtists(accessToken, query, limit);
  return {
    ok: true,
    artists,
  };
});

exports.searchSpotifyTracks = onCall({
  timeoutSeconds: 15,
  memory: '256MiB',
  secrets: [spotifyOwnerClientId, spotifyOwnerClientSecret],
}, async (request) => {
  const query = cleanText(request.data?.query, 160);
  if (query.length < 2) {
    return { ok: true, tracks: [] };
  }

  const limitValue = Number(request.data?.limit || 10);
  const limit = Math.max(1, Math.min(Number.isFinite(limitValue) ? limitValue : 10, 20));
  const accessToken = await getOwnerSpotifyAccessToken();
  const tracks = await searchOwnerSpotifyTracks(accessToken, query, limit);
  return {
    ok: true,
    tracks: uniqueSpotifyTracks(tracks),
  };
});

exports.localizeSpotifyDisplayNames = onCall({
  timeoutSeconds: 20,
  memory: '256MiB',
  secrets: [openAiApiKey],
}, async (request) => {
  const rawTracks = Array.isArray(request.data?.tracks) ? request.data.tracks : [];
  const tracks = rawTracks.slice(0, 8)
    .map((track, index) => ({
      key: cleanText(track?.key || track?.spotifyUri || track?.id || `track-${index}`, 180),
      title: cleanText(track?.title || track?.name, 180),
      artist: cleanText(track?.artist || track?.artistName, 180),
      album: cleanText(track?.album, 180),
    }))
    .filter((track) => track.key && track.title);

  if (!tracks.length) {
    return { ok: true, tracks: [] };
  }

  const result = await createStructuredRecommendation({
    schemaName: 'nowhere_spotify_display_names',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tracks'],
      properties: {
        tracks: {
          type: 'array',
          minItems: 0,
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'displayTitle', 'displayArtist'],
            properties: {
              key: { type: 'string' },
              displayTitle: { type: 'string' },
              displayArtist: { type: 'string' },
            },
          },
        },
      },
    },
    prompt: [
      'NOWHERE 추천탭 표시명을 한국어 사용자에게 읽기 쉽게 정리합니다.',
      '입력은 Spotify 공식 track title/artist/album입니다. Spotify URI나 재생 정보는 변경하지 않습니다.',
      '한국 곡, K-Pop, 한국 아티스트 곡은 한국에서 일반적으로 쓰는 곡명/아티스트명으로 표시하세요.',
      '영문 표기가 공식 곡명이어도 한국 사용자가 더 잘 알아보는 한국어 제목이 널리 쓰이면 한국어 제목을 사용하세요.',
      '확실하지 않은 곡명은 원문을 유지하세요. 임의 번역, 없는 제목 생성, 설명 추가는 금지합니다.',
      '아티스트도 한국에서 통용되는 이름이 있으면 한국어로 쓰고, 확실하지 않으면 원문을 유지하세요.',
      '반드시 입력 key를 그대로 반환하세요.',
      `tracks: ${JSON.stringify(tracks)}`,
    ].join('\n'),
    temperature: 0.2,
  });

  return {
    ok: true,
    tracks: Array.isArray(result.tracks) ? result.tracks : [],
  };
});

exports.getFavoriteArtistHitTracks = onCall({
  timeoutSeconds: 20,
  memory: '256MiB',
  secrets: [spotifyOwnerClientId, spotifyOwnerClientSecret],
}, async (request) => {
  const rawArtists = Array.isArray(request.data?.artists) ? request.data.artists : [];
  const artists = rawArtists.slice(0, 3)
    .map((artist) => ({
      id: cleanText(artist?.id || artist?.spotifyId, 120),
      name: cleanText(artist?.name, 160),
    }))
    .filter((artist) => artist.id || artist.name);
  if (!artists.length) {
    return { ok: true, tracks: [] };
  }

  const accessToken = await getOwnerSpotifyAccessToken();
  const collectedTracks = [];
  for (const artist of artists) {
    const resolvedArtist = await resolveOwnerArtist(accessToken, artist).catch((error) => {
      logger.warn('Favorite artist resolve failed', {
        artistName: artist.name,
        message: error?.message || String(error),
      });
      return null;
    });
    if (!resolvedArtist?.id) {
      continue;
    }
    const tracks = await getOwnerArtistTopTracks(
      accessToken,
      resolvedArtist.id,
      resolvedArtist.name || artist.name
    ).catch((error) => {
      logger.warn('Favorite artist top tracks failed', {
        artistId: resolvedArtist.id,
        artistName: resolvedArtist.name || artist.name,
        message: error?.message || String(error),
      });
      return [];
    });
    const baseRank = collectedTracks.length;
    tracks.forEach((track, index) => {
      collectedTracks.push({
        ...track,
        rank: baseRank + index + 1,
        sourceArtistId: resolvedArtist.id,
        sourceArtistName: resolvedArtist.name || artist.name,
        isFavoriteArtistTrack: true,
      });
    });
  }

  return {
    ok: true,
    tracks: uniqueSpotifyTracks(collectedTracks).slice(0, 30),
  };
});

exports.recommendTracks = onCall({
  timeoutSeconds: 30,
  memory: '256MiB',
  secrets: [openAiApiKey],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }

  const { context = {}, history = {}, requestedSlots = ['time', 'place', 'weather'] } = request.data || {};
  logger.info('Recommendation slots requested', { uid: request.auth.uid });
  getOpenAiApiKey();
  await assertDailyAiQuota(request.auth.uid, 'general', DAILY_GENERAL_AI_LIMIT);

  const prompt = [
    'NOWHERE의 개인화 음악 추천 서버입니다.',
    '이 요청은 하드코딩된 추천 후보 없이 OpenAI API로 처리하는 2순위 맥락 추천입니다.',
    '클라이언트가 1순위 사용자 데이터와 3순위 Spotify 대한민국 Trend 차트 fallback을 별도로 처리합니다.',
    '따라서 이 함수에서는 requestedSlots에 포함된 슬롯에 대해 현재 장소, 시간, 날씨 맥락상 사람들이 실제로 듣기 좋은 Spotify 검색 가능 곡을 추천하세요.',
    '반드시 네 슬롯(taste, time, place, weather)을 각각 하나씩 반환하되, requestedSlots가 아닌 슬롯은 낮은 우선순위로 작성하세요.',
    'time 슬롯은 이 시간대에 사람들이 많이 듣는 음악, place 슬롯은 이 장소에서 듣기 좋은 음악, weather 슬롯은 이 날씨에 사람들이 좋아하는 음악을 추천하세요.',
    '특정 고정 후보 목록, 예시 곡 목록, 로컬 fallback 목록을 가정하지 마세요.',
    '동일한 title+artist 조합을 중복 추천하지 마세요.',
    '한국어 reason은 짧고 사용자에게 자연스럽게 작성하세요.',
    `현재 맥락: ${JSON.stringify(context)}`,
    `청취 기록 요약: ${JSON.stringify(history)}`,
    `요청 슬롯: ${JSON.stringify(requestedSlots)}`,
  ].join('\n');

  const result = await createStructuredRecommendation({
    schemaName: 'nowhere_recommendation_slots',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['slots'],
      properties: {
        slots: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: trackSchema,
        },
      },
    },
    prompt,
    temperature: 0.65,
  });

  return {
    provider: 'openai',
    slots: result.slots,
  };
});

exports.recommendChallengeTrack = onCall({
  timeoutSeconds: 30,
  memory: '256MiB',
  secrets: [openAiApiKey],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }

  const { context = {}, challenge = {}, history = {} } = request.data || {};
  logger.info('Challenge track requested', { uid: request.auth.uid });
  getOpenAiApiKey();
  await assertDailyAiQuota(request.auth.uid, 'challenge', DAILY_CHALLENGE_AI_LIMIT);

  const genre = String(challenge.genre || '').trim() || '미지정 장르';
  const country = String(challenge.country || '').trim() || '미지정 국가';
  const mood = String(challenge.mood || '').trim() || '미지정 분위기';
  const requestText = String(challenge.request || '').trim();

  const prompt = [
    'NOWHERE Challenge 음악 추천 서버입니다.',
    '절대 로컬 하드코딩 후보, 예시 후보, 고정 fallback 목록을 사용하지 마세요.',
    `사용자가 고른 조건: 나라=${country}, 장르=${genre}, 분위기=${mood}`,
    `${country}에서 요즘 유행하거나 최근 많이 회자되는 노래 중에서 ${genre} 장르인 곡만 후보로 생각하세요.`,
    `그 후보 중 ${mood} 분위기와 가장 잘 맞는 곡 하나만 추천하세요.`,
    country === '그외'
      ? '나라가 그외이면 특정 국가를 임의 고정하지 말고, 현재 글로벌/지역 씬에서 유행하는 곡 중 조건에 맞는 곡을 고르세요.'
      : `${country} 아티스트 또는 ${country} 음악 씬에 속한다고 판단할 수 있는 곡만 추천하세요.`,
    `${genre}가 아닌 곡은 유명하거나 안전해 보여도 추천하지 마세요.`,
    `${mood}와 맞지 않는 곡은 차트 상위권이어도 추천하지 마세요.`,
    'Spotify에서 검색 가능한 공식 곡명과 공식 아티스트명을 title, artist에 넣으세요.',
    'searchQuery는 Spotify 검색에 바로 쓸 수 있게 "곡명 아티스트명" 형태로 작성하세요.',
    requestText ? `추가 요청도 반영하세요: ${requestText}` : '추가 요청은 없습니다.',
    'reason은 왜 이 나라/장르/분위기 조건에 맞는지 한국어 한 문장으로 짧게 작성하세요.',
    `현재 맥락: ${JSON.stringify(context)}`,
    `청취 기록 요약: ${JSON.stringify(history)}`,
  ].join('\n');

  const result = await createStructuredRecommendation({
    schemaName: 'nowhere_challenge_track',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['track'],
      properties: {
        track: challengeTrackSchema,
      },
    },
    prompt,
    temperature: 0.85,
  });

  return {
    provider: 'openai',
    track: result.track,
  };
});

exports.challengeRecommendationProxy = onCall({
  timeoutSeconds: 30,
  memory: '256MiB',
  secrets: [openAiApiKey],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }

  const apiKey = getOpenAiApiKey();

  const {
    mood = '',
    genre = '',
    country = '',
    weather = '',
    timeOfDay = '',
  } = request.data || {};

  logger.info('Challenge recommendation proxy invoked', {
    uid: request.auth.uid,
  });
  await assertDailyAiQuota(request.auth.uid, 'challenge', DAILY_CHALLENGE_AI_LIMIT);

  const prompt = [
    'NOWHERE 앱의 음악 추천 엔진으로 동작하세요.',
    '사용자의 기분, 장르, 나라, 현재 날씨, 시간대를 바탕으로 Spotify에서 검색 가능한 곡 5개를 추천하세요.',
    '반드시 JSON 배열만 반환하세요. 각 항목은 title, artist, reason 필드를 가져야 합니다.',
    `기분: ${mood || '미지정'}`,
    `장르: ${genre || '미지정'}`,
    `나라: ${country || '미지정'}`,
    `날씨: ${weather || '미지정'}`,
    `시간대: ${timeOfDay || '미지정'}`,
  ].join('\n');

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_RECOMMENDATION_MODEL,
        input: prompt,
        temperature: 0.8,
      }),
    });
  } catch (error) {
    logger.error('OpenAI request failed', error);
    throw new HttpsError('unavailable', 'GPT recommendation request failed.');
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    logger.error('OpenAI response failed', body);
    throw new HttpsError('internal', 'GPT recommendation response failed.');
  }

  const outputText = extractOutputText(body);

  try {
    const recommendations = JSON.parse(outputText);
    if (!Array.isArray(recommendations)) {
      throw new Error('Recommendation output is not an array.');
    }
    return { provider: 'openai', recommendations: recommendations.slice(0, 5) };
  } catch (error) {
    logger.error('OpenAI output parse failed', { outputText });
    throw new HttpsError('internal', 'GPT recommendation output was not valid JSON.');
  }
});
