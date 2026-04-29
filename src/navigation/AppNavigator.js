import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlayerProvider } from '../contexts/PlayerContext';
import { LocationProvider } from '../contexts/LocationContext';
import { SessionProvider } from '../contexts/SessionContext';

import HomeScreen from '../screens/HomeScreen';
import RecommendScreen from '../screens/RecommendScreen';
import MusicMapScreen from '../screens/MusicMapScreen';
import VibeScreen from '../screens/VibeScreen';
import PlaceSetupScreen from '../screens/PlaceSetupScreen';

const Stack = createNativeStackNavigator();

function RootStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={HomeScreen} />
      <Stack.Screen name="Recommend" component={RecommendScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="PlaceSetup" component={PlaceSetupScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Vibe" component={VibeScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="MusicMap" component={MusicMapScreen} options={{ presentation: 'modal' }} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <PlayerProvider>
          <LocationProvider>
            <NavigationContainer>
              <RootStack />
            </NavigationContainer>
          </LocationProvider>
        </PlayerProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
