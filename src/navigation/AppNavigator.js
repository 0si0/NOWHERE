import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlayerProvider } from '../contexts/PlayerContext';
import { LocationProvider } from '../contexts/LocationContext';
import { SessionProvider } from '../contexts/SessionContext';

import HomeScreen from '../screens/HomeScreen';
import AuthGateScreen from '../screens/AuthGateScreen';
import SpotifyPermissionScreen from '../screens/SpotifyPermissionScreen';
import RecommendScreen from '../screens/RecommendScreen';
import VibeScreen from '../screens/VibeScreen';
import PlaceSetupScreen from '../screens/PlaceSetupScreen';
import {
  getOnboardingAccountMode,
  isNowhereOnboardingComplete,
  isSpotifyOnboardingComplete,
  subscribeOnboardingReset,
} from '../services/onboardingService';
import { ensureOwnerSpotifyReady } from '../services/ownerSpotifyService';
import { useSession } from '../contexts/SessionContext';

const Stack = createNativeStackNavigator();

function MusicMapRoute(props) {
  const MusicMapScreen = require('../screens/MusicMapScreen').default;
  return <MusicMapScreen {...props} />;
}

function MusicDiaryRoute(props) {
  const MusicDiaryScreen = require('../screens/MusicDiaryScreen').default;
  return <MusicDiaryScreen {...props} />;
}

function RootStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={HomeScreen} />
      <Stack.Screen name="Recommend" component={RecommendScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="PlaceSetup" component={PlaceSetupScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Vibe" component={VibeScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="MusicMap" component={MusicMapRoute} options={{ presentation: 'modal' }} />
      <Stack.Screen name="MusicDiary" component={MusicDiaryRoute} options={{ presentation: 'modal' }} />
    </Stack.Navigator>
  );
}

function AppEntry() {
  const [isCheckingOwnerSpotify, setIsCheckingOwnerSpotify] = useState(true);
  const [ownerSpotifyError, setOwnerSpotifyError] = useState('');
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [isAccountReady, setIsAccountReady] = useState(false);
  const [isSpotifyGateReady, setIsSpotifyGateReady] = useState(false);
  const [accountMode, setAccountMode] = useState('member');
  const { authUser, isLoading: isSessionLoading } = useSession();

  const runOwnerSpotifyPreflight = useCallback(async () => {
    setIsCheckingOwnerSpotify(true);
    setOwnerSpotifyError('');
    const result = await ensureOwnerSpotifyReady();
    if (!result.ok) {
      setOwnerSpotifyError(result.message || 'Spotify owner API 준비에 실패했습니다.');
    }
    setIsCheckingOwnerSpotify(false);
  }, []);

  useEffect(() => {
    runOwnerSpotifyPreflight();
  }, [runOwnerSpotifyPreflight]);

  useEffect(() => subscribeOnboardingReset(() => {
    setAccountMode('member');
    setIsAccountReady(false);
    setIsSpotifyGateReady(false);
    setIsCheckingOnboarding(false);
  }), []);

  useEffect(() => {
    if (isCheckingOwnerSpotify || ownerSpotifyError || isSessionLoading) {
      return undefined;
    }

    let mounted = true;
    async function checkOnboarding() {
      const accountReady = await isNowhereOnboardingComplete();
      if (!accountReady) {
        return {
          accountReady: false,
          accountMode: 'member',
        };
      }

      const nextAccountMode = await getOnboardingAccountMode();
      const spotifyReady = await isSpotifyOnboardingComplete();
      return {
        accountReady,
        accountMode: nextAccountMode,
        spotifyReady,
      };
    }

    checkOnboarding()
      .then((result) => {
        if (!mounted) return;
        setIsAccountReady(Boolean(result.accountReady));
        setAccountMode(result.accountMode || 'member');
        setIsSpotifyGateReady(Boolean(result.spotifyReady));
      })
      .catch(() => {
        if (!mounted) return;
        setIsAccountReady(false);
      })
      .finally(() => {
        if (mounted) {
          setIsCheckingOnboarding(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [authUser?.uid, isCheckingOwnerSpotify, isSessionLoading, ownerSpotifyError]);

  if (isCheckingOwnerSpotify) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#FFC8B8" />
        <Text style={styles.loadingTitle}>Spotify 추천 준비 중</Text>
        <Text style={styles.loadingText}>NOWHERE 음악 추천 서버를 먼저 연결하고 있어요.</Text>
      </View>
    );
  }

  if (ownerSpotifyError) {
    return (
      <View style={styles.loadingScreen}>
        <Text style={styles.errorTitle}>Spotify 추천 서버 연결 실패</Text>
        <Text style={styles.errorText}>{ownerSpotifyError}</Text>
        <TouchableOpacity style={styles.retryButton} activeOpacity={0.86} onPress={runOwnerSpotifyPreflight}>
          <Text style={styles.retryButtonText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isCheckingOnboarding || isSessionLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#FFC8B8" />
      </View>
    );
  }

  if (!isAccountReady) {
    return <AuthGateScreen onComplete={(nextMode = 'member') => {
      setAccountMode(nextMode);
      setIsAccountReady(true);
    }} />;
  }

  if (accountMode !== 'guest' && (!authUser?.uid || authUser.isAnonymous || !authUser.emailVerified)) {
    return <AuthGateScreen onComplete={(nextMode = 'member') => {
      setAccountMode(nextMode);
      setIsAccountReady(true);
    }} />;
  }

  if (!isSpotifyGateReady) {
    return <SpotifyPermissionScreen onComplete={() => {
      setIsSpotifyGateReady(true);
    }} />;
  }

  return <RootStack />;
}

export default function AppNavigator() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <PlayerProvider>
          <LocationProvider>
            <NavigationContainer>
              <AppEntry />
            </NavigationContainer>
          </LocationProvider>
        </PlayerProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05070A',
    paddingHorizontal: 28,
  },
  loadingTitle: {
    color: '#FFF1EC',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 18,
    textAlign: 'center',
  },
  loadingText: {
    color: '#9E908D',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    textAlign: 'center',
  },
  errorTitle: {
    color: '#FFF1EC',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  errorText: {
    color: '#D9C6C0',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: '#FFC8B8',
    paddingHorizontal: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  retryButtonText: {
    color: '#07100B',
    fontSize: 16,
    fontWeight: '900',
  },
});
