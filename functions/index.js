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
const DAILY_GENERAL_AI_LIMIT = 30;
const DAILY_CHALLENGE_AI_LIMIT = 5;
const DEFAULT_RECOMMENDATION_MODEL = process.env.OPENAI_RECOMMENDATION_MODEL || 'gpt-4.1-nano';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
