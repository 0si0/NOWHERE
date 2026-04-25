import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  onAuthStateChanged,
  signInAnonymously,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  onValue,
  ref,
  remove,
  serverTimestamp as rtdbServerTimestamp,
  set,
} from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage';
import {
  assertFirebaseConfigured,
  getFirebaseRuntimeStatus as getFirebaseRuntimeStatusFromClient,
} from './firebaseClient';
import {
  buildUserProfileDocument,
  sanitizeConsentInput,
  sanitizePlayRecordInput,
  sanitizeSavedPlaceInput,
  sanitizeVibePayload,
} from './firebaseValidation';

const SESSION_ID_KEY = '@nowhere/session-id';

function getUserDocumentRef(db, userId) {
  return doc(db, 'users', userId);
}

function getSavedPlacesCollection(db, userId) {
  return collection(db, 'users', userId, 'savedPlaces');
}

function getPlayHistoryCollection(db, userId) {
  return collection(db, 'users', userId, 'playHistory');
}

function getConsentCollection(db, userId) {
  return collection(db, 'users', userId, 'consents');
}

function assertAuthenticatedUser(auth, requestedUserId) {
  const currentUserId = auth.currentUser?.uid;

  if (!currentUserId) {
    throw new Error('인증된 사용자가 없습니다.');
  }

  if (requestedUserId && currentUserId !== requestedUserId) {
    throw new Error('다른 사용자의 데이터에 접근할 수 없습니다.');
  }

  return currentUserId;
}

export async function bootstrapUserProfile(user) {
  const { db } = assertFirebaseConfigured();
  const profileRef = getUserDocumentRef(db, user.uid);
  const existingSnapshot = await getDoc(profileRef);
  const baseProfile = buildUserProfileDocument(user);

  if (!existingSnapshot.exists()) {
    await setDoc(profileRef, {
      ...baseProfile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(profileRef, {
      ...baseProfile,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  const snapshot = await getDoc(profileRef);
  return { id: snapshot.id, ...snapshot.data() };
}

export async function ensureAnonymousSession() {
  const { auth } = assertFirebaseConfigured();

  if (auth.currentUser) {
    return bootstrapUserProfile(auth.currentUser);
  }

  const credential = await signInAnonymously(auth);
  return bootstrapUserProfile(credential.user);
}

export function subscribeToAuthSession(onChange) {
  const { auth } = assertFirebaseConfigured();

  return onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        await signInAnonymously(auth);
        return;
      }

      const profile = await bootstrapUserProfile(user);
      onChange({ user, profile, error: null });
    } catch (error) {
      onChange({ user: null, profile: null, error });
    }
  });
}

export async function getOrCreateSessionId() {
  const existing = await AsyncStorage.getItem(SESSION_ID_KEY);

  if (existing) {
    return existing;
  }

  const nextValue = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(SESSION_ID_KEY, nextValue);
  return nextValue;
}

export async function saveSavedPlace(input) {
  const { auth, db } = assertFirebaseConfigured();
  const sanitized = sanitizeSavedPlaceInput(input);
  const userId = assertAuthenticatedUser(auth, sanitized.userId);
  const docRef = doc(getSavedPlacesCollection(db, userId));

  const payload = {
    ...sanitized,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(docRef, payload);

  return { id: docRef.id, ...sanitized };
}

export async function getSavedPlaces(userId) {
  const { auth, db } = assertFirebaseConfigured();
  const ownerId = assertAuthenticatedUser(auth, userId);
  const placesQuery = query(
    getSavedPlacesCollection(db, ownerId),
    orderBy('updatedAt', 'desc')
  );
  const snapshot = await getDocs(placesQuery);

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function updateSavedPlace(placeId, input) {
  const { auth, db } = assertFirebaseConfigured();
  const sanitized = sanitizeSavedPlaceInput(input);
  const userId = assertAuthenticatedUser(auth, sanitized.userId);
  const placeRef = doc(getSavedPlacesCollection(db, userId), placeId);

  await setDoc(placeRef, {
    ...sanitized,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  const snapshot = await getDoc(placeRef);
  return { id: snapshot.id, ...snapshot.data() };
}

export async function archiveSavedPlace(userId, placeId) {
  const { auth, db } = assertFirebaseConfigured();
  const ownerId = assertAuthenticatedUser(auth, userId);
  const placeRef = doc(getSavedPlacesCollection(db, ownerId), placeId);

  await updateDoc(placeRef, {
    status: 'archived',
    updatedAt: serverTimestamp(),
  });
}

export async function savePlayRecord(input) {
  const { auth, db } = assertFirebaseConfigured();
  const sanitized = sanitizePlayRecordInput(input);
  const userId = assertAuthenticatedUser(auth, sanitized.userId);
  const historyCollection = getPlayHistoryCollection(db, userId);

  const docRef = await addDoc(historyCollection, {
    ...sanitized,
    playedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  return { id: docRef.id, ...sanitized };
}

export async function getRecentPlayHistory(userId, maxRecords = 25) {
  const { auth, db } = assertFirebaseConfigured();
  const ownerId = assertAuthenticatedUser(auth, userId);
  const historyQuery = query(
    getPlayHistoryCollection(db, ownerId),
    orderBy('playedAt', 'desc'),
    limit(maxRecords)
  );
  const snapshot = await getDocs(historyQuery);

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function getTopTracksForPlace(userId, geohash, maxTracks = 3) {
  const { auth, db } = assertFirebaseConfigured();
  const ownerId = assertAuthenticatedUser(auth, userId);
  const historyQuery = query(
    getPlayHistoryCollection(db, ownerId),
    where('location.geohash', '==', geohash),
    limit(100)
  );
  const snapshot = await getDocs(historyQuery);
  const aggregation = new Map();

  snapshot.forEach((item) => {
    const data = item.data();
    const key = `${data.trackId}:${data.title}:${data.artist}`;
    const existing = aggregation.get(key);

    if (existing) {
      existing.plays += 1;
      return;
    }

    aggregation.set(key, {
      trackId: data.trackId,
      title: data.title,
      artist: data.artist,
      plays: 1,
    });
  });

  return Array.from(aggregation.values())
    .sort((left, right) => right.plays - left.plays)
    .slice(0, maxTracks);
}

export async function saveUserConsent(input) {
  const { auth, db } = assertFirebaseConfigured();
  const sanitized = sanitizeConsentInput(input);
  const userId = assertAuthenticatedUser(auth, sanitized.userId);
  const consentRef = doc(getConsentCollection(db, userId), sanitized.consentType);

  await setDoc(consentRef, {
    ...sanitized,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { id: sanitized.consentType, ...sanitized };
}

export async function getUserConsents(userId) {
  const { auth, db } = assertFirebaseConfigured();
  const ownerId = assertAuthenticatedUser(auth, userId);
  const snapshot = await getDocs(getConsentCollection(db, ownerId));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function publishVibe(input) {
  const { auth, rtdb } = assertFirebaseConfigured();
  const sanitized = sanitizeVibePayload(input);
  const userId = assertAuthenticatedUser(auth, sanitized.uid);
  const vibeRef = ref(rtdb, `vibes/${sanitized.geohash}/${sanitized.sessionId}`);

  await set(vibeRef, {
    ...sanitized,
    uid: userId,
    createdAt: rtdbServerTimestamp(),
    updatedAt: rtdbServerTimestamp(),
  });
}

export function subscribeVibes(geohash, onChange) {
  const { auth, rtdb } = assertFirebaseConfigured();
  assertAuthenticatedUser(auth);

  const vibeRef = ref(rtdb, `vibes/${geohash}`);

  return onValue(vibeRef, (snapshot) => {
    const raw = snapshot.val() || {};
    const items = Object.entries(raw).map(([sessionId, value]) => ({
      sessionId,
      ...value,
    }));

    items.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
    onChange(items);
  });
}

export async function clearVibe(geohash, sessionId) {
  const { auth, rtdb } = assertFirebaseConfigured();
  assertAuthenticatedUser(auth);
  await remove(ref(rtdb, `vibes/${geohash}/${sessionId}`));
}

export function buildMusicMapPhotoPath({ userId, filename }) {
  return `users/${userId}/music-map/${filename}`;
}

export async function uploadMusicMapPhoto({
  userId,
  filename,
  blob,
  contentType = 'image/jpeg',
}) {
  const { auth, storage } = assertFirebaseConfigured();
  const ownerId = assertAuthenticatedUser(auth, userId);
  const objectPath = buildMusicMapPhotoPath({ userId: ownerId, filename });
  const objectRef = storageRef(storage, objectPath);

  await uploadBytes(objectRef, blob, {
    contentType,
    customMetadata: {
      ownerId,
      uploadedBy: 'nowhere-client',
    },
  });

  return {
    path: objectPath,
    url: await getDownloadURL(objectRef),
  };
}

export async function callCloudFunction(name, payload) {
  const { auth, functions } = assertFirebaseConfigured();
  assertAuthenticatedUser(auth);
  const callable = httpsCallable(functions, name);
  const result = await callable(payload);
  return result.data;
}

export function getFirebaseRuntimeStatus() {
  return getFirebaseRuntimeStatusFromClient();
}
