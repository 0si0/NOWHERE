const {
  AndroidConfig,
  withAppBuildGradle,
  withAndroidManifest,
  withInfoPlist,
} = require('expo/config-plugins');

const SPOTIFY_PACKAGE = 'com.spotify.music';
const DEFAULT_REDIRECT_SCHEME = 'com.nowhere.nowhere';
const DEFAULT_REDIRECT_HOST = 'spotify-auth';
const DEFAULT_REDIRECT_PATH_PATTERN = '.*';

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function quoteGradleString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function addAndroidManifestPlaceholders(buildGradle, redirectScheme, redirectHost, redirectPathPattern) {
  if (buildGradle.includes('redirectSchemeName') && buildGradle.includes('redirectHostName')) {
    return buildGradle;
  }

  const placeholders = [
    '        manifestPlaceholders += [',
    `            redirectSchemeName: '${quoteGradleString(redirectScheme)}',`,
    `            redirectHostName: '${quoteGradleString(redirectHost)}',`,
    `            redirectPathPattern: '${quoteGradleString(redirectPathPattern)}'`,
    '        ]',
  ].join('\n');

  const defaultConfigPattern = /(defaultConfig\s*\{[\s\S]*?buildConfigField[^\n]*\n)/;
  if (defaultConfigPattern.test(buildGradle)) {
    return buildGradle.replace(defaultConfigPattern, `$1\n${placeholders}\n`);
  }

  return buildGradle.replace(/(defaultConfig\s*\{\n)/, `$1${placeholders}\n`);
}

function withNowherePlayer(config, props = {}) {
  const redirectScheme = props.spotifyRedirectScheme || DEFAULT_REDIRECT_SCHEME;
  const redirectHost = props.spotifyRedirectHost || DEFAULT_REDIRECT_HOST;
  const redirectPathPattern = props.spotifyRedirectPathPattern || DEFAULT_REDIRECT_PATH_PATTERN;

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
    queries.intent = ensureArray(queries.intent);

    const hasSpotifyQuery = queries.package.some((item) => item.$?.['android:name'] === SPOTIFY_PACKAGE);
    if (!hasSpotifyQuery) {
      queries.package.push({ $: { 'android:name': SPOTIFY_PACKAGE } });
    }
    const hasSpotifyUriQuery = queries.intent.some((item) => (
      ensureArray(item.action).some((action) => action.$?.['android:name'] === 'android.intent.action.VIEW') &&
      ensureArray(item.data).some((data) => data.$?.['android:scheme'] === 'spotify')
    ));
    if (!hasSpotifyUriQuery) {
      queries.intent.push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
        data: [{ $: { 'android:scheme': 'spotify' } }],
      });
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

  config = withAppBuildGradle(config, (buildGradleConfig) => {
    if (buildGradleConfig.modResults.language === 'groovy') {
      buildGradleConfig.modResults.contents = addAndroidManifestPlaceholders(
        buildGradleConfig.modResults.contents,
        redirectScheme,
        redirectHost,
        redirectPathPattern
      );
    }
    return buildGradleConfig;
  });

  return config;
}

module.exports = withNowherePlayer;
