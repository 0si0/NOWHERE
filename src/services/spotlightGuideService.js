import AsyncStorage from '@react-native-async-storage/async-storage';

export const SPOTLIGHT_GUIDE_KEYS = {
  home: '@nowhere/home-guide-seen',
  placeAlert: '@nowhere/place-alert-guide-seen',
  musicMap: '@nowhere/music-map-guide-seen',
  sharePlace: '@nowhere/share-place-guide-seen',
};

const ALL_GUIDE_KEYS = Object.values(SPOTLIGHT_GUIDE_KEYS);

export async function hasSeenSpotlightGuide(key) {
  if (!key) return true;
  try {
    return (await AsyncStorage.getItem(key)) === 'true';
  } catch {
    return true;
  }
}

export async function markSpotlightGuideSeen(key) {
  if (!key) return;
  try {
    await AsyncStorage.setItem(key, 'true');
  } catch {
    // Guide persistence must never block the app.
  }
}

export async function resetSpotlightGuide(key) {
  if (!key) return;
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Dev helper only.
  }
}

export async function resetAllSpotlightGuides() {
  try {
    await AsyncStorage.multiRemove(ALL_GUIDE_KEYS);
  } catch {
    // Dev helper only.
  }
}

if (__DEV__ && typeof global !== 'undefined') {
  global.resetNowhereSpotlightGuides = resetAllSpotlightGuides;
}
