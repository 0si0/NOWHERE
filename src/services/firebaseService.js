import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
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
  isFirebaseConfigured as isFirebaseConfiguredInClient,
} from './firebaseClient';
import { MAX_AUTOPLAY_PLACES } from '../constants';
import {
  buildUserProfileDocument,
  sanitizeConsentInput,
  sanitizeListeningEventInput,
  sanitizeMusicMapPublicRecordInput,
  sanitizeMusicMapRecordInput,
  sanitizePlayRecordInput,
  sanitizeSavedPlaceInput,
  sanitizeShallWeShareInput,
  sanitizeVibePayload,
} from './firebaseValidation';
import { cacheAutoPlayPlaces } from './autoPlayService';
import { getDistanceMeters } from './locationService';

const SESSION_ID_KEY = '@nowhere/session-id';
const LOCAL_APP_USER_ID_KEY = '@nowhere/local-app-user-id';
const LOCAL_SAVED_PLACES_KEY = '@nowhere/local-saved-places';
const LOCAL_LISTENING_EVENTS_KEY = '@nowhere/local-listening-events';
const LOCAL_MUSIC_MAP_RECORDS_KEY = '@nowhere/local-music-map-records';
const LOCAL_MUSIC_MAP_PUBLIC_RECORDS_KEY = '@nowhere/local-music-map-public-records';
const LOCAL_FAVORITE_ARTISTS_KEY = '@nowhere/favorite-artists-v1';
const SPOTIFY_ACCESS_REQUEST_ID_KEY = '@nowhere/spotify-access-request-id-v1';
const LOCAL_USER_PREFIX = 'local-user-';
const MAX_LOCAL_LISTENING_EVENTS = 500;
const MAX_LOCAL_MUSIC_MAP_RECORDS = 800;
const MUSIC_MAP_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SHALL_WE_SHARE_RADIUS_M = 350;
const AUTH_LOG_PREFIX = '[NOWHERE Firebase Auth]';

function getAuthDebugSnapshot(user = null) {
  const providerIds = Array.isArray(user?.providerData)
    ? user.providerData.map((provider) => provider?.providerId).filter(Boolean)
    : [];
  return {
    currentUserExists: Boolean(user?.uid),
    uid: user?.uid || null,
    isAnonymous: Boolean(user?.isAnonymous),
    isEmailUser: Boolean(user?.email || providerIds.includes('password')),
    providerIds,
  };
}

function logAuthDebug(message, user = null, details = {}) {
  console.info(AUTH_LOG_PREFIX, message, {
    ...getAuthDebugSnapshot(user),
    ...details,
  });
}

function getComparableTimestamp(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') {
    return value.toDate().getTime();
  }

  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? 0 : asDate.getTime();
}

function getKstDayKey(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getMusicMapRecordCutoffIso() {
  return new Date(Date.now() - MUSIC_MAP_RECORD_TTL_MS).toISOString();
}

function isFreshMusicMapRecord(record = {}) {
  const timestamp = getComparableTimestamp(record.recordedAt || record.createdAt || record.startedAt);
  return timestamp > 0 && timestamp >= Date.now() - MUSIC_MAP_RECORD_TTL_MS;
}

function sortByUpdatedAtDescending(items) {
  return [...items].sort(
    (left, right) => getComparableTimestamp(right.updatedAt) - getComparableTimestamp(left.updatedAt)
  );
}

function sortByRecordedAtDescending(items) {
  return [...items].sort(
    (left, right) => (
      getComparableTimestamp(right.recordedAt || right.createdAt) -
      getComparableTimestamp(left.recordedAt || left.createdAt)
    )
  );
}

async function readLocalSavedPlaces() {
  const raw = await AsyncStorage.getItem(LOCAL_SAVED_PLACES_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    await AsyncStorage.removeItem(LOCAL_SAVED_PLACES_KEY);
    return [];
  }
}

async function writeLocalSavedPlaces(places) {
  await AsyncStorage.setItem(LOCAL_SAVED_PLACES_KEY, JSON.stringify(places));
}

async function readLocalListeningEvents() {
  const raw = await AsyncStorage.getItem(LOCAL_LISTENING_EVENTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    await AsyncStorage.removeItem(LOCAL_LISTENING_EVENTS_KEY);
    return [];
  }
}

async function writeLocalListeningEvents(events) {
  await AsyncStorage.setItem(LOCAL_LISTENING_EVENTS_KEY, JSON.stringify(events.slice(0, MAX_LOCAL_LISTENING_EVENTS)));
}

async function readLocalFavoriteArtists() {
  const raw = await AsyncStorage.getItem(LOCAL_FAVORITE_ARTISTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    await AsyncStorage.removeItem(LOCAL_FAVORITE_ARTISTS_KEY);
    return [];
  }
}

async function writeLocalFavoriteArtists(artists) {
  await AsyncStorage.setItem(LOCAL_FAVORITE_ARTISTS_KEY, JSON.stringify(artists.slice(0, 3)));
}

async function readLocalMusicMapRecords() {
  const raw = await AsyncStorage.getItem(LOCAL_MUSIC_MAP_RECORDS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    await AsyncStorage.removeItem(LOCAL_MUSIC_MAP_RECORDS_KEY);
    return [];
  }
}

async function writeLocalMusicMapRecords(records) {
  await AsyncStorage.setItem(
    LOCAL_MUSIC_MAP_RECORDS_KEY,
    JSON.stringify(records.filter(isFreshMusicMapRecord).slice(0, MAX_LOCAL_MUSIC_MAP_RECORDS))
  );
}

async function pruneRemoteMusicMapRecords(db, userId, cutoffIso) {
  const oldRecordsQuery = query(
    getMusicMapRecordsCollection(db, userId),
    where('recordedAt', '<', cutoffIso),
    orderBy('recordedAt', 'asc'),
    limit(50)
  );
  const snapshot = await getDocs(oldRecordsQuery);
  await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
}

async function readLocalMusicMapPublicRecords() {
  const raw = await AsyncStorage.getItem(LOCAL_MUSIC_MAP_PUBLIC_RECORDS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    await AsyncStorage.removeItem(LOCAL_MUSIC_MAP_PUBLIC_RECORDS_KEY);
    return [];
  }
}

async function writeLocalMusicMapPublicRecords(records) {
  await AsyncStorage.setItem(LOCAL_MUSIC_MAP_PUBLIC_RECORDS_KEY, JSON.stringify(records.slice(0, MAX_LOCAL_MUSIC_MAP_RECORDS)));
}

function isLocalAppUserId(userId) {
  return typeof userId === 'string' && userId.startsWith(LOCAL_USER_PREFIX);
}

function shouldUseLocalSavedPlaces(auth, userId) {
  return auth.currentUser?.isAnonymous || isLocalAppUserId(userId);
}

async function migrateAnonymousLocalPlaces(ownerId) {
  if (!isLocalAppUserId(ownerId)) {
    return readLocalSavedPlaces();
  }

  const savedPlaces = await readLocalSavedPlaces();
  let didChange = false;
  const nextPlaces = savedPlaces.map((item) => {
    if (
      item.userId !== ownerId &&
      item.status !== 'archived' &&
      (item.syncStatus === 'localOnly' || item.remoteError === 'permission-denied')
    ) {
      didChange = true;
      return {
        ...item,
        userId: ownerId,
        updatedAt: item.updatedAt || new Date().toISOString(),
      };
    }

    return item;
  });

  if (didChange) {
    await writeLocalSavedPlaces(nextPlaces);
  }

  return nextPlaces;
}

function buildLocalSavedPlaceId() {
  return `local-place-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPermissionDeniedError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === 'permission-denied' ||
    error?.code === 'firestore/permission-denied' ||
    message.includes('missing or insufficient permissions') ||
    message.includes('permission-denied');
}

async function saveLocalSavedPlaceDocument(sanitized, overrides = {}) {
  const savedPlaces = await migrateAnonymousLocalPlaces(sanitized.userId);
  const activeCount = savedPlaces.filter((item) => item.userId === sanitized.userId && item.status !== 'archived').length;
  if (activeCount >= MAX_AUTOPLAY_PLACES) {
    throw new Error(`자동재생 장소는 한 사람당 최대 ${MAX_AUTOPLAY_PLACES}개까지 저장할 수 있습니다.`);
  }
  const now = new Date().toISOString();
  const nextPlace = {
    id: buildLocalSavedPlaceId(),
    ...sanitized,
    syncStatus: 'localOnly',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  const nextPlaces = [...savedPlaces, nextPlace];
  await writeLocalSavedPlaces(nextPlaces);
  await cacheAutoPlayPlaces(nextPlaces.filter((item) => item.userId === sanitized.userId));
  return nextPlace;
}

function getUserDocumentRef(db, userId) {
  return doc(db, 'users', userId);
}

function getSavedPlacesCollection(db, userId) {
  return collection(db, 'users', userId, 'savedPlaces');
}

function getPlayHistoryCollection(db, userId) {
  return collection(db, 'users', userId, 'playHistory');
}

function getListeningEventsCollection(db, userId) {
  return collection(db, 'users', userId, 'listeningEvents');
}

function getMusicMapRecordsCollection(db, userId) {
  return collection(db, 'users', userId, 'musicMapRecords');
}

function getMusicMapPublicRecordsCollection(db) {
  return collection(db, 'musicMapPublicRecords');
}

function getShallWeShareRecordsCollection(db) {
  return collection(db, 'shallWeShareRecords');
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

async function buildLocalAnonymousProfile(user = null) {
  const localUserId = await getOrCreateAppUserId();
  return {
    id: localUserId,
    uid: localUserId,
    firebaseUid: user?.uid || null,
    displayName: '익명 회원',
    isAnonymous: true,
    storageMode: 'local',
  };
}

export async function bootstrapUserProfile(user) {
  const { db } = assertFirebaseConfigured();
  const profileRef = getUserDocumentRef(db, user.uid);
  logAuthDebug('bootstrap users document', user, { userDocPath: `users/${user.uid}` });
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
  logAuthDebug('ensureAnonymousSession requested', auth.currentUser, {
    willCallSignInAnonymously: !auth.currentUser,
  });

  if (auth.currentUser) {
    if (auth.currentUser.isAnonymous) {
      return buildLocalAnonymousProfile(auth.currentUser);
    }

    return bootstrapUserProfile(auth.currentUser);
  }

  logAuthDebug('signInAnonymously called by explicit guest flow', null, {
    willCallSignInAnonymously: true,
  });
  const credential = await signInAnonymously(auth);
  return buildLocalAnonymousProfile(credential.user);
}

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function mapAuthError(error) {
  const code = error?.code || '';
  if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use') {
    return new Error('이미 가입된 이메일입니다. 로그인으로 진행해주세요.');
  }
  if (code === 'auth/invalid-email') {
    return new Error('이메일 주소 형식을 확인해주세요.');
  }
  if (code === 'auth/weak-password') {
    return new Error('비밀번호는 6자 이상으로 입력해주세요.');
  }
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  if (code === 'auth/network-request-failed') {
    return new Error('네트워크 연결을 확인한 뒤 다시 시도해주세요.');
  }
  if (code === 'auth/operation-not-allowed') {
    return new Error('Firebase Console에서 이메일/비밀번호 로그인을 활성화해야 합니다.');
  }
  return error instanceof Error ? error : new Error('회원 인증 처리에 실패했습니다.');
}

export async function createNowhereEmailUser({ email, password }) {
  const { auth } = assertFirebaseConfigured();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || '');

  if (!normalizedEmail) {
    throw new Error('이메일 주소를 입력해주세요.');
  }
  if (normalizedPassword.length < 6) {
    throw new Error('비밀번호는 6자 이상으로 입력해주세요.');
  }

  try {
    let user = null;
    if (auth.currentUser?.isAnonymous) {
      logAuthDebug('link anonymous user to email account', auth.currentUser);
      const credential = EmailAuthProvider.credential(normalizedEmail, normalizedPassword);
      const linked = await linkWithCredential(auth.currentUser, credential);
      user = linked.user;
    } else {
      logAuthDebug('create email user', auth.currentUser);
      const created = await createUserWithEmailAndPassword(auth, normalizedEmail, normalizedPassword);
      user = created.user;
    }

    await bootstrapUserProfile(user);
    if (!user.emailVerified) {
      await sendEmailVerification(user);
    }
    return user;
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function signInNowhereWithEmail({ email, password }) {
  const { auth } = assertFirebaseConfigured();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || '');

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error('이메일과 비밀번호를 입력해주세요.');
  }

  try {
    logAuthDebug('sign in with email requested', auth.currentUser);
    const credential = await signInWithEmailAndPassword(auth, normalizedEmail, normalizedPassword);
    await bootstrapUserProfile(credential.user);
    return credential.user;
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function sendNowhereEmailVerification() {
  const { auth } = assertFirebaseConfigured();
  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    throw new Error('이메일 인증을 보낼 회원 계정이 없습니다.');
  }
  if (user.emailVerified) {
    return user;
  }
  await sendEmailVerification(user);
  return user;
}

export async function refreshNowhereEmailVerification() {
  const { auth } = assertFirebaseConfigured();
  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    throw new Error('로그인된 회원 계정이 없습니다.');
  }
  await reload(user);
  logAuthDebug('email verification refreshed', auth.currentUser);
  await bootstrapUserProfile(auth.currentUser);
  return auth.currentUser;
}

export async function signOutNowhereAccount() {
  const { auth } = assertFirebaseConfigured();
  logAuthDebug('sign out requested', auth.currentUser);
  await signOut(auth);
}

export async function clearSpotifyAccessRequestStatus() {
  await AsyncStorage.removeItem(SPOTIFY_ACCESS_REQUEST_ID_KEY);
}

export function subscribeToAuthSession(onChange) {
  const { auth } = assertFirebaseConfigured();

  return onAuthStateChanged(auth, async (user) => {
    try {
      logAuthDebug('onAuthStateChanged', user, {
        willCallSignInAnonymously: false,
      });
      if (!user) {
        onChange({ user: null, profile: null, error: null });
        return;
      }

      if (user.isAnonymous) {
        const profile = await buildLocalAnonymousProfile(user);
        onChange({ user, profile, error: null });
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

export async function getOrCreateAppUserId() {
  if (isFirebaseConfiguredInClient()) {
    const { auth } = assertFirebaseConfigured();
    if (auth.currentUser?.uid && !auth.currentUser.isAnonymous) {
      return auth.currentUser.uid;
    }
  }

  const existing = await AsyncStorage.getItem(LOCAL_APP_USER_ID_KEY);
  if (existing) {
    return existing;
  }

  const nextValue = `local-user-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(LOCAL_APP_USER_ID_KEY, nextValue);
  return nextValue;
}

export async function saveSavedPlace(input) {
  const resolvedUserId = input.userId || await getOrCreateAppUserId();
  const sanitized = sanitizeSavedPlaceInput({
    ...input,
    userId: resolvedUserId,
  });

  if (!isFirebaseConfiguredInClient()) {
    return saveLocalSavedPlaceDocument(sanitized);
  }

  const { auth, db } = assertFirebaseConfigured();
  if (shouldUseLocalSavedPlaces(auth, sanitized.userId)) {
    return saveLocalSavedPlaceDocument(sanitized);
  }

  const userId = assertAuthenticatedUser(auth, sanitized.userId);
  const existingPlaces = await getSavedPlaces(userId);
  const activeCount = existingPlaces.filter((item) => item.status !== 'archived').length;
  if (activeCount >= MAX_AUTOPLAY_PLACES) {
    throw new Error(`자동재생 장소는 한 사람당 최대 ${MAX_AUTOPLAY_PLACES}개까지 저장할 수 있습니다.`);
  }
  const docRef = doc(getSavedPlacesCollection(db, userId));

  const payload = {
    ...sanitized,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(docRef, payload);
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return saveLocalSavedPlaceDocument(sanitized, {
        remoteError: 'permission-denied',
      });
    }
    throw error;
  }

  return { id: docRef.id, ...sanitized };
}

export async function getSavedPlaces(userId) {
  const ownerId = userId || await getOrCreateAppUserId();

  if (!isFirebaseConfiguredInClient()) {
    const savedPlaces = await migrateAnonymousLocalPlaces(ownerId);
    const sortedPlaces = sortByUpdatedAtDescending(
      savedPlaces.filter((item) => item.userId === ownerId)
    );
    await cacheAutoPlayPlaces(sortedPlaces);
    return sortedPlaces;
  }

  try {
    const { auth, db } = assertFirebaseConfigured();
    if (shouldUseLocalSavedPlaces(auth, ownerId)) {
      const savedPlaces = await migrateAnonymousLocalPlaces(ownerId);
      const sortedPlaces = sortByUpdatedAtDescending(
        savedPlaces.filter((item) => item.userId === ownerId)
      );
      await cacheAutoPlayPlaces(sortedPlaces);
      return sortedPlaces;
    }

    const validatedOwnerId = assertAuthenticatedUser(auth, ownerId);
    const placesQuery = query(
      getSavedPlacesCollection(db, validatedOwnerId),
      orderBy('updatedAt', 'desc')
    );
    const snapshot = await getDocs(placesQuery);

    const remotePlaces = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));
    const localPlaces = await readLocalSavedPlaces();
    const mergedPlaces = sortByUpdatedAtDescending([
      ...remotePlaces,
      ...localPlaces.filter((item) => item.userId === validatedOwnerId),
    ]);
    await cacheAutoPlayPlaces(mergedPlaces);
    return mergedPlaces;
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      const savedPlaces = await readLocalSavedPlaces();
      const sortedPlaces = sortByUpdatedAtDescending(
        savedPlaces.filter((item) => item.userId === ownerId)
      );
      await cacheAutoPlayPlaces(sortedPlaces);
      return sortedPlaces;
    }
    throw error;
  }
}

export async function updateSavedPlace(placeId, input) {
  const resolvedUserId = input.userId || await getOrCreateAppUserId();
  const sanitized = sanitizeSavedPlaceInput({
    ...input,
    userId: resolvedUserId,
  });

  const shouldUseLocal = !isFirebaseConfiguredInClient() ||
    shouldUseLocalSavedPlaces(assertFirebaseConfigured().auth, sanitized.userId);

  if (shouldUseLocal) {
    const savedPlaces = await migrateAnonymousLocalPlaces(sanitized.userId);
    const nextPlaces = savedPlaces.map((item) => {
      if (item.id !== placeId || item.userId !== sanitized.userId) {
        return item;
      }

      return {
        ...item,
        ...sanitized,
        updatedAt: new Date().toISOString(),
      };
    });

    await writeLocalSavedPlaces(nextPlaces);
    await cacheAutoPlayPlaces(nextPlaces.filter((item) => item.userId === sanitized.userId));
    return nextPlaces.find((item) => item.id === placeId) || null;
  }

  const { auth, db } = assertFirebaseConfigured();
  const userId = assertAuthenticatedUser(auth, sanitized.userId);
  const placeRef = doc(getSavedPlacesCollection(db, userId), placeId);

  try {
    await setDoc(placeRef, {
      ...sanitized,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      const savedPlaces = await readLocalSavedPlaces();
      const now = new Date().toISOString();
      const existing = savedPlaces.find((item) => item.id === placeId && item.userId === sanitized.userId);
      const nextPlaces = existing
        ? savedPlaces.map((item) => (
          item.id === placeId && item.userId === sanitized.userId
            ? { ...item, ...sanitized, syncStatus: 'localOnly', remoteError: 'permission-denied', updatedAt: now }
            : item
        ))
        : [...savedPlaces, {
          id: placeId,
          ...sanitized,
          syncStatus: 'localOnly',
          remoteError: 'permission-denied',
          createdAt: now,
          updatedAt: now,
        }];
      await writeLocalSavedPlaces(nextPlaces);
      await cacheAutoPlayPlaces(nextPlaces.filter((item) => item.userId === sanitized.userId));
      return nextPlaces.find((item) => item.id === placeId) || null;
    }
    throw error;
  }

  const snapshot = await getDoc(placeRef);
  return { id: snapshot.id, ...snapshot.data() };
}

export async function archiveSavedPlace(userId, placeId) {
  const ownerId = userId || await getOrCreateAppUserId();

  const shouldUseLocal = !isFirebaseConfiguredInClient() ||
    shouldUseLocalSavedPlaces(assertFirebaseConfigured().auth, ownerId);

  if (shouldUseLocal) {
    const savedPlaces = await migrateAnonymousLocalPlaces(ownerId);
    const nextPlaces = savedPlaces.map((item) => {
      if (item.id !== placeId || item.userId !== ownerId) {
        return item;
      }

      return {
        ...item,
        status: 'archived',
        updatedAt: new Date().toISOString(),
      };
    });

    await writeLocalSavedPlaces(nextPlaces);
    await cacheAutoPlayPlaces(nextPlaces.filter((item) => item.userId === ownerId));
    return;
  }

  const { auth, db } = assertFirebaseConfigured();
  const validatedOwnerId = assertAuthenticatedUser(auth, ownerId);
  const placeRef = doc(getSavedPlacesCollection(db, validatedOwnerId), placeId);

  try {
    await updateDoc(placeRef, {
      status: 'archived',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      const savedPlaces = await readLocalSavedPlaces();
      const nextPlaces = savedPlaces.map((item) => {
        if (item.id !== placeId || item.userId !== ownerId) {
          return item;
        }

        return {
          ...item,
          status: 'archived',
          syncStatus: 'localOnly',
          remoteError: 'permission-denied',
          updatedAt: new Date().toISOString(),
        };
      });
      await writeLocalSavedPlaces(nextPlaces);
      await cacheAutoPlayPlaces(nextPlaces.filter((item) => item.userId === ownerId));
      return;
    }
    throw error;
  }
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

export async function saveListeningEvent(input) {
  const resolvedUserId = input.userId || await getOrCreateAppUserId();
  const sanitized = sanitizeListeningEventInput({
    ...input,
    userId: resolvedUserId,
  });
  const localPayload = {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ...sanitized,
    createdAt: new Date().toISOString(),
  };

  if (!isFirebaseConfiguredInClient()) {
    const events = await readLocalListeningEvents();
    await writeLocalListeningEvents([localPayload, ...events]);
    return localPayload;
  }

  const { auth, db } = assertFirebaseConfigured();
  if (shouldUseLocalSavedPlaces(auth, sanitized.userId)) {
    const events = await readLocalListeningEvents();
    await writeLocalListeningEvents([localPayload, ...events]);
    return localPayload;
  }

  const userId = assertAuthenticatedUser(auth, sanitized.userId);
  try {
    const docRef = await addDoc(getListeningEventsCollection(db, userId), {
      ...sanitized,
      createdAt: serverTimestamp(),
    });

    return { id: docRef.id, ...sanitized };
  } catch (error) {
    console.warn('[NOWHERE ListeningEvent] remote save failed; falling back to local storage', error?.message || error);
    const fallbackPayload = {
      ...localPayload,
      syncStatus: 'localOnly',
      remoteError: error?.code || error?.message || 'remote-save-failed',
    };
    const events = await readLocalListeningEvents();
    await writeLocalListeningEvents([fallbackPayload, ...events]);
    return fallbackPayload;
  }
}

export async function getListeningEvents(userId, maxRecords = 200) {
  const ownerId = userId || await getOrCreateAppUserId();

  if (!isFirebaseConfiguredInClient()) {
    const events = await readLocalListeningEvents();
    return events.filter((event) => event.userId === ownerId).slice(0, maxRecords);
  }

  const { auth, db } = assertFirebaseConfigured();
  if (shouldUseLocalSavedPlaces(auth, ownerId)) {
    const events = await readLocalListeningEvents();
    return events.filter((event) => event.userId === ownerId).slice(0, maxRecords);
  }

  const validatedOwnerId = assertAuthenticatedUser(auth, ownerId);
  const localEvents = (await readLocalListeningEvents()).filter((event) => event.userId === validatedOwnerId);
  try {
    const eventsQuery = query(
      getListeningEventsCollection(db, validatedOwnerId),
      orderBy('occurredAt', 'desc'),
      limit(maxRecords)
    );
    const snapshot = await getDocs(eventsQuery);
    const remoteEvents = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));
    const seen = new Set();
    return [...remoteEvents, ...localEvents]
      .filter((event) => {
        const key = event.id || `${event.eventType}:${event.occurredAt}:${event.track?.id || event.track?.spotifyUri || event.track?.title}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => getComparableTimestamp(right.occurredAt || right.createdAt) - getComparableTimestamp(left.occurredAt || left.createdAt))
      .slice(0, maxRecords);
  } catch (error) {
    console.warn('[NOWHERE ListeningEvent] remote read failed; using local events', error?.message || error);
    return localEvents.slice(0, maxRecords);
  }
}

function normalizeFavoriteArtistInput(artist = {}) {
  const id = String(artist.id || artist.spotifyId || '').trim();
  const name = String(artist.name || '').trim();
  return {
    id,
    spotifyId: id,
    name,
    spotifyUri: String(artist.spotifyUri || artist.uri || '').trim(),
    uri: String(artist.spotifyUri || artist.uri || '').trim(),
    artworkUrl: String(artist.artworkUrl || artist.imageUrl || '').trim(),
    imageUrl: String(artist.artworkUrl || artist.imageUrl || '').trim(),
    popularity: Number.isFinite(Number(artist.popularity)) ? Number(artist.popularity) : 0,
    genres: Array.isArray(artist.genres) ? artist.genres.slice(0, 6).map((item) => String(item || '').trim()).filter(Boolean) : [],
  };
}

function normalizeFavoriteArtistsInput(artists = []) {
  const used = new Set();
  return (Array.isArray(artists) ? artists : [])
    .map(normalizeFavoriteArtistInput)
    .filter((artist) => artist.name && (artist.id || artist.spotifyUri))
    .filter((artist) => {
      const key = String(artist.id || artist.spotifyUri || artist.name).toLowerCase();
      if (!key || used.has(key)) {
        return false;
      }
      used.add(key);
      return true;
    })
    .slice(0, 3);
}

export async function saveUserFavoriteArtists(userId, artists = []) {
  const ownerId = userId || await getOrCreateAppUserId();
  const normalizedArtists = normalizeFavoriteArtistsInput(artists);
  await writeLocalFavoriteArtists(normalizedArtists);

  if (!isFirebaseConfiguredInClient()) {
    return normalizedArtists;
  }

  const { auth, db } = assertFirebaseConfigured();
  if (shouldUseLocalSavedPlaces(auth, ownerId)) {
    return normalizedArtists;
  }

  const validatedOwnerId = assertAuthenticatedUser(auth, ownerId);
  await setDoc(getUserDocumentRef(db, validatedOwnerId), {
    favoriteArtists: normalizedArtists,
    favoriteArtistsUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return normalizedArtists;
}

export async function getUserFavoriteArtists(userId) {
  const ownerId = userId || await getOrCreateAppUserId();

  if (isFirebaseConfiguredInClient()) {
    try {
      const { auth, db } = assertFirebaseConfigured();
      if (!shouldUseLocalSavedPlaces(auth, ownerId)) {
        const validatedOwnerId = assertAuthenticatedUser(auth, ownerId);
        const snapshot = await getDoc(getUserDocumentRef(db, validatedOwnerId));
        const remoteArtists = normalizeFavoriteArtistsInput(snapshot.data()?.favoriteArtists || []);
        if (remoteArtists.length) {
          await writeLocalFavoriteArtists(remoteArtists);
          return remoteArtists;
        }
      }
    } catch (error) {
      console.warn('[NOWHERE Favorite Artists] remote read failed', error?.message || error);
    }
  }

  return normalizeFavoriteArtistsInput(await readLocalFavoriteArtists());
}

async function publishMusicMapPublicRecord(record) {
  const publicPayload = sanitizeMusicMapPublicRecordInput({
    ...record,
    latitude: record.location?.latitude,
    longitude: record.location?.longitude,
  });
  const localPayload = {
    id: `public-map-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ...publicPayload,
    createdAt: new Date().toISOString(),
  };

  const localRecords = await readLocalMusicMapPublicRecords();
  await writeLocalMusicMapPublicRecords([localPayload, ...localRecords]);

  if (!isFirebaseConfiguredInClient()) {
    return localPayload;
  }

  try {
    const { auth, db } = assertFirebaseConfigured();
    if (!auth.currentUser) {
      return localPayload;
    }

    const docRef = await addDoc(getMusicMapPublicRecordsCollection(db), {
      ...publicPayload,
      createdAt: serverTimestamp(),
    });
    return { id: docRef.id, ...publicPayload };
  } catch (error) {
    return localPayload;
  }
}

export async function saveMusicMapRecord(input) {
  const resolvedUserId = input.userId || await getOrCreateAppUserId();
  const sanitized = sanitizeMusicMapRecordInput({
    ...input,
    userId: resolvedUserId,
  });
  const localPayload = {
    id: `music-map-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ...sanitized,
    createdAt: new Date().toISOString(),
  };

  const publishPublic = input.publishPublic !== false;

  if (!isFirebaseConfiguredInClient()) {
    const records = await readLocalMusicMapRecords();
    await writeLocalMusicMapRecords([localPayload, ...records]);
    if (publishPublic) {
      await publishMusicMapPublicRecord(sanitized);
    }
    return localPayload;
  }

  const { auth, db } = assertFirebaseConfigured();
  if (shouldUseLocalSavedPlaces(auth, sanitized.userId)) {
    const records = await readLocalMusicMapRecords();
    await writeLocalMusicMapRecords([localPayload, ...records]);
    if (publishPublic) {
      await publishMusicMapPublicRecord(sanitized);
    }
    return localPayload;
  }

  const userId = assertAuthenticatedUser(auth, sanitized.userId);
  try {
    const docRef = await addDoc(getMusicMapRecordsCollection(db, userId), {
      ...sanitized,
      createdAt: serverTimestamp(),
    });
    const savedRecord = { id: docRef.id, ...sanitized };
    if (publishPublic) {
      await publishMusicMapPublicRecord(savedRecord);
    }
    return savedRecord;
  } catch (error) {
    const records = await readLocalMusicMapRecords();
    await writeLocalMusicMapRecords([{
      ...localPayload,
      remoteError: isPermissionDeniedError(error) ? 'permission-denied' : String(error?.code || error?.message || 'remote-save-failed'),
      syncStatus: 'localOnly',
    }, ...records]);
    if (publishPublic) {
      await publishMusicMapPublicRecord(sanitized);
    }
    return localPayload;
  }
}

export async function getMusicMapRecords(userId, maxRecords = 200) {
  const ownerId = userId || await getOrCreateAppUserId();
  const cutoffIso = getMusicMapRecordCutoffIso();

  if (!isFirebaseConfiguredInClient()) {
    const records = await readLocalMusicMapRecords();
    const freshRecords = records.filter((record) => record.userId === ownerId && isFreshMusicMapRecord(record));
    if (freshRecords.length !== records.length) {
      await writeLocalMusicMapRecords(records);
    }
    return sortByRecordedAtDescending(freshRecords).slice(0, maxRecords);
  }

  const { auth, db } = assertFirebaseConfigured();
  if (shouldUseLocalSavedPlaces(auth, ownerId)) {
    const records = await readLocalMusicMapRecords();
    const freshRecords = records.filter((record) => record.userId === ownerId && isFreshMusicMapRecord(record));
    if (freshRecords.length !== records.length) {
      await writeLocalMusicMapRecords(records);
    }
    return sortByRecordedAtDescending(freshRecords).slice(0, maxRecords);
  }

  const validatedOwnerId = assertAuthenticatedUser(auth, ownerId);
  await pruneRemoteMusicMapRecords(db, validatedOwnerId, cutoffIso).catch(() => {});
  const recordsQuery = query(
    getMusicMapRecordsCollection(db, validatedOwnerId),
    where('recordedAt', '>=', cutoffIso),
    orderBy('recordedAt', 'desc'),
    limit(maxRecords)
  );
  const snapshot = await getDocs(recordsQuery);

  const remoteRecords = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
  const localRecords = await readLocalMusicMapRecords();
  return sortByRecordedAtDescending([
    ...remoteRecords,
    ...localRecords.filter((record) => record.userId === validatedOwnerId && isFreshMusicMapRecord(record)),
  ]).slice(0, maxRecords);
}

export async function getMusicMapPublicRecords(maxRecords = 200) {
  const localRecords = await readLocalMusicMapPublicRecords();

  if (!isFirebaseConfiguredInClient()) {
    return sortByRecordedAtDescending(localRecords).slice(0, maxRecords);
  }

  try {
    const { auth, db } = assertFirebaseConfigured();
    if (!auth.currentUser) {
      return sortByRecordedAtDescending(localRecords).slice(0, maxRecords);
    }

    const recordsQuery = query(
      getMusicMapPublicRecordsCollection(db),
      orderBy('recordedAt', 'desc'),
      limit(maxRecords)
    );
    const snapshot = await getDocs(recordsQuery);
    const remoteRecords = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
      anonymous: true,
    }));
    return sortByRecordedAtDescending([...remoteRecords, ...localRecords]).slice(0, maxRecords);
  } catch (error) {
    return sortByRecordedAtDescending(localRecords).slice(0, maxRecords);
  }
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

export function getShallWeShareDayKey(date = new Date()) {
  return getKstDayKey(date);
}

export async function hasPostedShallWeShareToday(userId) {
  const { auth, db } = assertFirebaseConfigured();
  const ownerId = assertAuthenticatedUser(auth, userId);
  const dayKey = getKstDayKey();
  const recordRef = doc(getShallWeShareRecordsCollection(db), `${ownerId}_${dayKey}`);
  const snapshot = await getDoc(recordRef);
  return snapshot.exists();
}

export async function saveShallWeShareRecord(input) {
  const { auth, db } = assertFirebaseConfigured();
  const ownerId = assertAuthenticatedUser(auth, input.userId);
  const dayKey = getKstDayKey();
  const sanitized = sanitizeShallWeShareInput({
    ...input,
    userId: ownerId,
    dayKey,
  });
  const recordRef = doc(getShallWeShareRecordsCollection(db), `${ownerId}_${dayKey}`);
  const existing = await getDoc(recordRef);
  if (existing.exists()) {
    throw new Error('오늘은 이미 이 공간에 음악을 남겼어요.');
  }

  await setDoc(recordRef, {
    ...sanitized,
    createdAt: serverTimestamp(),
  });

  return {
    id: recordRef.id,
    ...sanitized,
  };
}

export async function getNearbyShallWeShareRecords({
  userId,
  latitude,
  longitude,
  radiusMeters = SHALL_WE_SHARE_RADIUS_M,
  maxRecords = 40,
} = {}) {
  const { auth, db } = assertFirebaseConfigured();
  assertAuthenticatedUser(auth, userId);
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return [];
  }

  const sharesQuery = query(
    getShallWeShareRecordsCollection(db),
    orderBy('createdAt', 'desc'),
    limit(Math.max(10, Math.min(Number(maxRecords) || 40, 80)))
  );
  const snapshot = await getDocs(sharesQuery);
  const records = snapshot.docs.map((item) => {
    const data = item.data();
    const distanceMeters = getDistanceMeters(
      latitude,
      longitude,
      Number(data.latitude),
      Number(data.longitude)
    );
    return {
      id: item.id,
      ...data,
      distanceMeters,
    };
  });

  return records
    .filter((record) => Number.isFinite(record.distanceMeters) && record.distanceMeters <= radiusMeters)
    .sort((left, right) => {
      const distanceDiff = left.distanceMeters - right.distanceMeters;
      if (Math.abs(distanceDiff) > 30) {
        return distanceDiff;
      }
      return getComparableTimestamp(right.createdAt || right.createdAtIso) -
        getComparableTimestamp(left.createdAt || left.createdAtIso);
    });
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

export async function callCloudFunctionOptionalAuth(name, payload) {
  const { functions } = assertFirebaseConfigured();
  const callable = httpsCallable(functions, name);
  const result = await callable(payload);
  return result.data;
}

export async function submitSpotifyAccessRequest({ spotifyFullName, spotifyEmail }) {
  const { auth, functions } = assertFirebaseConfigured();
  const callable = httpsCallable(functions, 'submitSpotifyAccessRequest');
  const result = await callable({
    spotifyFullName,
    spotifyEmail,
    nowhereUserId: auth.currentUser?.uid || '',
    nowhereEmail: auth.currentUser?.email || '',
  });
  if (result.data?.requestId) {
    await AsyncStorage.setItem(SPOTIFY_ACCESS_REQUEST_ID_KEY, result.data.requestId);
  }
  return result.data;
}

export async function getSpotifyAccessRequestStatus() {
  const { auth, functions } = assertFirebaseConfigured();
  const requestId = await AsyncStorage.getItem(SPOTIFY_ACCESS_REQUEST_ID_KEY).catch(() => '');
  const callable = httpsCallable(functions, 'getSpotifyAccessRequestStatus');
  const result = await callable({
    requestId: requestId || '',
    nowhereUserId: auth.currentUser?.uid || '',
  });
  if (result.data?.requestId) {
    await AsyncStorage.setItem(SPOTIFY_ACCESS_REQUEST_ID_KEY, result.data.requestId);
  }
  return result.data || { status: 'none' };
}

export function getFirebaseRuntimeStatus() {
  return getFirebaseRuntimeStatusFromClient();
}
