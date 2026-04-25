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

  logger.info('Challenge proxy placeholder invoked', {
    uid: request.auth.uid,
  });

  throw new HttpsError(
    'unimplemented',
    'Challenge recommendation proxy is not implemented yet.'
  );
});
