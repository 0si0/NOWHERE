const {
  AndroidConfig,
  withAndroidManifest,
  withInfoPlist,
} = require('expo/config-plugins');

const SPOTIFY_PACKAGE = 'com.spotify.music';
const DEFAULT_REDIRECT_SCHEME = 'com.nowhere.nowhere';
const DEFAULT_REDIRECT_HOST = 'spotify-auth';

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function withNowherePlayer(config, props = {}) {
  const redirectScheme = props.spotifyRedirectScheme || DEFAULT_REDIRECT_SCHEME;
  const redirectHost = props.spotifyRedirectHost || DEFAULT_REDIRECT_HOST;

  config = withInfoPlist(config, (plistConfig) => {
    const deprecatedMediaUsageKey = ['NS', 'Apple', 'Music', 'UsageDescription'].join('');
    delete plistConfig.modResults[deprecatedMediaUsageKey];

    const querySchemes = new Set(ensureArray(plistConfig.modResults.LSApplicationQueriesSchemes));
    querySchemes.add('spotify');
    plistConfig.modResults.LSApplicationQueriesSchemes = Array.from(querySchemes);

    const urlTypes = ensureArray(plistConfig.modResults.CFBundleURLTypes);
    const hasRedirectScheme = urlTypes.some((type) => (
      ensureArray(type.CFBundleURLSchemes).includes(redirectScheme)
    ));
    if (!hasRedirectScheme) {
      urlTypes.push({
        CFBundleURLName: 'spotify-auth',
        CFBundleURLSchemes: [redirectScheme],
      });
    }
    plistConfig.modResults.CFBundleURLTypes = urlTypes;

    const backgroundModes = new Set(ensureArray(plistConfig.modResults.UIBackgroundModes));
    backgroundModes.add('audio');
    plistConfig.modResults.UIBackgroundModes = Array.from(backgroundModes);
    return plistConfig;
  });

  config = withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest;
    manifest.queries = ensureArray(manifest.queries);
    const queries = manifest.queries[0] || {};
    queries.package = ensureArray(queries.package);

    const hasSpotifyQuery = queries.package.some((item) => item.$?.['android:name'] === SPOTIFY_PACKAGE);
    if (!hasSpotifyQuery) {
      queries.package.push({ $: { 'android:name': SPOTIFY_PACKAGE } });
    }
    manifest.queries[0] = queries;

    const mainActivity = AndroidConfig.Manifest.getMainActivity(manifest);
    if (!mainActivity) {
      return manifestConfig;
    }

    mainActivity['intent-filter'] = ensureArray(mainActivity['intent-filter']);
    const hasSpotifyRedirect = mainActivity['intent-filter'].some((filter) => (
      ensureArray(filter.data).some((data) => (
        data.$?.['android:scheme'] === redirectScheme &&
        data.$?.['android:host'] === redirectHost
      ))
    ));

    if (!hasSpotifyRedirect) {
      mainActivity['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
          { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
        ],
        data: [{ $: { 'android:scheme': redirectScheme, 'android:host': redirectHost } }],
      });
    }

    return manifestConfig;
  });

  return config;
}

module.exports = withNowherePlayer;
