// Firebase service — initialize with your own config in src/constants/index.js
// import { initializeApp } from 'firebase/app';
// import { getFirestore, collection, addDoc, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
// import { getDatabase, ref, set, onValue, remove } from 'firebase/database';
// import { getAuth, signInAnonymously } from 'firebase/auth';
// import { API_KEYS } from '../constants';

// const app = initializeApp(API_KEYS.FIREBASE);
// const db = getFirestore(app);
// const rtdb = getDatabase(app);
// const auth = getAuth(app);

// ── Firestore: Play history ────────────────────────────────────────────────────

export async function savePlayRecord({ userId, trackId, title, artist, lat, lon, placeName, geohash }) {
  // await addDoc(collection(db, 'playHistory'), {
  //   userId, trackId, title, artist,
  //   lat, lon, placeName, geohash,
  //   playedAt: new Date(),
  // });
  console.log('[Firebase] savePlayRecord:', title, 'at', placeName);
}

export async function getTopTracksForPlace(geohash, limit = 3) {
  // Aggregate top tracks for a geohash
  // const q = query(collection(db, 'playHistory'), where('geohash', '==', geohash), orderBy('playedAt', 'desc'), limit(50));
  // const snap = await getDocs(q);
  // ...aggregate and sort
  return [
    { title: "Nothing's Gonna Hurt You Baby", artist: 'Cigarettes After Sex', plays: 12 },
    { title: 'Cherry Wine', artist: 'Hozier', plays: 5 },
    { title: 'Night Owl', artist: 'Galimatias', plays: 3 },
  ];
}

export async function saveSavedPlace({ userId, name, lat, lon, radius, playlistId }) {
  // await addDoc(collection(db, 'savedPlaces'), { userId, name, lat, lon, radius, playlistId, createdAt: new Date() });
  console.log('[Firebase] saveSavedPlace:', name);
}

export async function getSavedPlaces(userId) {
  // const q = query(collection(db, 'savedPlaces'), where('userId', '==', userId));
  // const snap = await getDocs(q);
  // return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return [];
}

// ── Realtime Database: Vibe (anonymous, session-based) ────────────────────────

export function publishVibe({ geohash, nickname, trackTitle, trackArtist }) {
  const key = `vibes/${geohash}/${nickname}`;
  // set(ref(rtdb, key), { nickname, trackTitle, trackArtist, timestamp: Date.now() });
  console.log('[Firebase] publishVibe:', geohash, nickname, trackTitle);
}

export function subscribeVibes(geohash, onChange) {
  // const vibeRef = ref(rtdb, `vibes/${geohash}`);
  // const unsub = onValue(vibeRef, (snap) => { onChange(snap.val() || {}); });
  // return unsub;
  return () => {};
}

export function clearVibe(geohash, nickname) {
  // remove(ref(rtdb, `vibes/${geohash}/${nickname}`));
}

// ── Auth: anonymous sign-in ────────────────────────────────────────────────────

export async function signInAnon() {
  // const cred = await signInAnonymously(auth);
  // return cred.user.uid;
  return 'anonymous-user-' + Math.random().toString(36).slice(2, 8);
}
