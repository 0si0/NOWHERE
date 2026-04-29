const { initializeApp } = require('firebase-admin/app');
const { setGlobalOptions } = require('firebase-functions/v2');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');

initializeApp();

setGlobalOptions({
  region: 'asia-northeast3',
  maxInstances: 10,
});

exports.challengeRecommendationProxy = onCall({
  timeoutSeconds: 30,
  memory: '256MiB',
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'OPENAI_API_KEY is not configured.');
  }

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
        model: process.env.OPENAI_RECOMMENDATION_MODEL || 'gpt-4.1-mini',
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

  const outputText = body?.output_text
    || body?.output?.flatMap((item) => item.content || [])
      .map((content) => content.text)
      .filter(Boolean)
      .join('\n')
    || '';

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
