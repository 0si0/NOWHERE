import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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
import { isNowhereOnboardingComplete, isSpotifyOnboardingComplete } from '../services/onboardingService';
import { musicPlayerService } from '../services/musicPlayerService';
import { useSession } from '../contexts/SessionContext';

const Stack = createNativeStackNavigator();

function MusicMapRoute(props) {
  const MusicMapScreen = require('../screens/MusicMapScreen').default;
  return <MusicMapScreen {...props} />;
}

function RootStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={HomeScreen} />
      <Stack.Screen name="Recommend" component={RecommendScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="PlaceSetup" component={PlaceSetupScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Vibe" component={VibeScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="MusicMap" component={MusicMapRoute} options={{ presentation: 'modal' }} />
    </Stack.Navigator>
  );
}

function AppEntry() {
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [isAccountReady, setIsAccountReady] = useState(false);
  const [isSpotifyAuthorized, setIsSpotifyAuthorized] = useState(false);
  const { isLoading: isSessionLoading } = useSession();

  useEffect(() => {
    let mounted = true;
    async function checkOnboarding() {
      const accountReady = await isNowhereOnboardingComplete();
      if (!accountReady) {
        return { accountReady: false, spotifyAuthorized: false };
      }

      const spotifyOnboardingComplete = await isSpotifyOnboardingComplete();
      const state = await musicPlayerService.configure().catch(() => null);
      const authorized = state?.authorizationStatus === 'authorized' || state?.isAuthorized === true;
      return { accountReady, spotifyAuthorized: spotifyOnboardingComplete || authorized };
    }

    checkOnboarding()
      .then((result) => {
        if (!mounted) return;
        setIsAccountReady(Boolean(result.accountReady));
        setIsSpotifyAuthorized(Boolean(result.spotifyAuthorized));
      })
      .catch(() => {
        if (!mounted) return;
        setIsAccountReady(false);
        setIsSpotifyAuthorized(false);
      })
      .finally(() => {
        if (mounted) {
          setIsCheckingOnboarding(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (isCheckingOnboarding || isSessionLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#FFC8B8" />
      </View>
    );
  }

  if (!isAccountReady) {
    return <AuthGateScreen onComplete={() => setIsAccountReady(true)} />;
  }

  if (!isSpotifyAuthorized) {
    return <SpotifyPermissionScreen onComplete={() => setIsSpotifyAuthorized(true)} />;
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
  },
});
