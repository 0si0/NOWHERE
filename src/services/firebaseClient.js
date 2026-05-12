import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  initializeAuth,
} from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { API_KEYS, FIREBASE_RUNTIME } from '../constants';

const REQUIRED_FIREBASE_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

const PLACEHOLDER_PREFIXES = ['YOUR_', 'http://YOUR_', 'https://YOUR_'];
const AUTH_LOG_PREFIX = '[NOWHERE Firebase Auth]';

let cachedServices = null;
let emulatorsConnected = false;
let authInstance = null;

function logAuthClient(message, details = {}) {
  console.info(AUTH_LOG_PREFIX, message, details);
}

function isConfiguredValue(value) {
  if (!value) return false;
  return !PLACEHOLDER_PREFIXES.some((prefix) => String(value).startsWith(prefix));
}

export function getMissingFirebaseConfigKeys() {
  return REQUIRED_FIREBASE_KEYS.filter((key) => !isConfiguredValue(API_KEYS.FIREBASE[key]));
}

export function isFirebaseConfigured() {
  return getMissingFirebaseConfigKeys().length === 0;
}

function getDefaultEmulatorHost() {
  if (FIREBASE_RUNTIME.emulatorHost) {
    return FIREBASE_RUNTIME.emulatorHost;
  }

  if (Platform.OS === 'android') {
    return '10.0.2.2';
  }

  return '127.0.0.1';
}

function getFirebaseApp() {
  if (getApps().length > 0) {
    return getApp();
  }

  return initializeApp(API_KEYS.FIREBASE);
}

function getFirebaseAuth(app) {
  if (authInstance) {
    return authInstance;
  }

  if (Platform.OS === 'web') {
    authInstance = getAuth(app);
    return authInstance;
  }

  try {
    // React Native needs AsyncStorage-backed persistence for stable email sessions.
    const { getReactNativePersistence } = require('@firebase/auth');
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
    logAuthClient('initialized with AsyncStorage persistence', { platform: Platform.OS });
  } catch (error) {
    logAuthClient('AsyncStorage persistence init failed; falling back to getAuth', {
      platform: Platform.OS,
      message: error?.message || String(error),
    });
    authInstance = getAuth(app);
  }

  return authInstance;
}

function connectConfiguredEmulators(services) {
  if (!FIREBASE_RUNTIME.useEmulators || emulatorsConnected) {
    return;
  }

  const host = getDefaultEmulatorHost();

  connectAuthEmulator(services.auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(services.db, host, 8080);
  if (services.rtdb) {
    connectDatabaseEmulator(services.rtdb, host, 9000);
  }
  connectStorageEmulator(services.storage, host, 9199);
  connectFunctionsEmulator(services.functions, host, 5001);

  emulatorsConnected = true;
}

export function getFirebaseServices() {
  if (!isFirebaseConfigured()) {
    return null;
  }

  if (cachedServices) {
    return cachedServices;
  }

  const app = getFirebaseApp();
  const auth = getFirebaseAuth(app);

  cachedServices = {
    app,
    auth,
    db: getFirestore(app),
    rtdb: isConfiguredValue(API_KEYS.FIREBASE.databaseURL) ? getDatabase(app) : null,
    storage: getStorage(app),
    functions: getFunctions(app, FIREBASE_RUNTIME.functionsRegion),
  };

  connectConfiguredEmulators(cachedServices);

  return cachedServices;
}

export function assertFirebaseConfigured() {
  const services = getFirebaseServices();

  if (!services) {
    throw new Error(
      `Firebase 설정이 완료되지 않았습니다. 누락된 키: ${getMissingFirebaseConfigKeys().join(', ')}`
    );
  }

  return services;
}

export function getFirebaseRuntimeStatus() {
  return {
    configured: isFirebaseConfigured(),
    missingConfigKeys: getMissingFirebaseConfigKeys(),
    useEmulators: FIREBASE_RUNTIME.useEmulators,
    functionsRegion: FIREBASE_RUNTIME.functionsRegion,
  };
}
