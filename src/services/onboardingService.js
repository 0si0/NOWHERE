import AsyncStorage from '@react-native-async-storage/async-storage';

const SPOTIFY_ONBOARDING_COMPLETE_KEY = '@nowhere/spotify-onboarding-complete-v1';
const NOWHERE_ONBOARDING_COMPLETE_KEY = '@nowhere/account-onboarding-complete-v1';
const ONBOARDING_ACCOUNT_MODE_KEY = '@nowhere/onboarding-account-mode-v1';
const FAVORITE_ARTISTS_ONBOARDING_COMPLETE_KEY = '@nowhere/favorite-artists-onboarding-complete-v1';
const onboardingResetListeners = new Set();

function notifyOnboardingReset() {
  onboardingResetListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn('[NOWHERE Onboarding] reset listener failed', error?.message || error);
    }
  });
}

export function subscribeOnboardingReset(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  onboardingResetListeners.add(listener);
  return () => onboardingResetListeners.delete(listener);
}

export async function isNowhereOnboardingComplete() {
  return AsyncStorage.getItem(NOWHERE_ONBOARDING_COMPLETE_KEY)
    .then((value) => value === 'true')
    .catch(() => false);
}

export async function markNowhereOnboardingComplete(accountMode = 'member') {
  await AsyncStorage.multiSet([
    [NOWHERE_ONBOARDING_COMPLETE_KEY, 'true'],
    [ONBOARDING_ACCOUNT_MODE_KEY, accountMode],
  ]);
}

export async function isSpotifyOnboardingComplete() {
  return AsyncStorage.getItem(SPOTIFY_ONBOARDING_COMPLETE_KEY)
    .then((value) => value === 'true')
    .catch(() => false);
}

export async function markSpotifyOnboardingComplete() {
  await AsyncStorage.setItem(SPOTIFY_ONBOARDING_COMPLETE_KEY, 'true');
}

export async function isFavoriteArtistsOnboardingComplete() {
  return AsyncStorage.getItem(FAVORITE_ARTISTS_ONBOARDING_COMPLETE_KEY)
    .then((value) => value === 'true')
    .catch(() => false);
}

export async function markFavoriteArtistsOnboardingComplete() {
  await AsyncStorage.setItem(FAVORITE_ARTISTS_ONBOARDING_COMPLETE_KEY, 'true');
}

export async function markOnboardingComplete(accountMode = 'member') {
  await AsyncStorage.multiSet([
    [NOWHERE_ONBOARDING_COMPLETE_KEY, 'true'],
    [SPOTIFY_ONBOARDING_COMPLETE_KEY, 'true'],
    [FAVORITE_ARTISTS_ONBOARDING_COMPLETE_KEY, 'true'],
    [ONBOARDING_ACCOUNT_MODE_KEY, accountMode],
  ]);
}

export async function clearSpotifyOnboardingComplete() {
  await AsyncStorage.removeItem(SPOTIFY_ONBOARDING_COMPLETE_KEY);
}

export async function clearFavoriteArtistsOnboardingComplete() {
  await AsyncStorage.removeItem(FAVORITE_ARTISTS_ONBOARDING_COMPLETE_KEY);
}

export async function resetOnboardingState() {
  await AsyncStorage.multiRemove([
    SPOTIFY_ONBOARDING_COMPLETE_KEY,
    NOWHERE_ONBOARDING_COMPLETE_KEY,
    ONBOARDING_ACCOUNT_MODE_KEY,
    FAVORITE_ARTISTS_ONBOARDING_COMPLETE_KEY,
  ]);
  notifyOnboardingReset();
}

export async function getOnboardingAccountMode() {
  return AsyncStorage.getItem(ONBOARDING_ACCOUNT_MODE_KEY)
    .then((value) => value || 'member')
    .catch(() => 'member');
}
