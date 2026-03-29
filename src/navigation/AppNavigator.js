import React from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { COLORS } from '../constants';
import { PlayerProvider } from '../contexts/PlayerContext';
import { LocationProvider } from '../contexts/LocationContext';

import HomeScreen from '../screens/HomeScreen';
import RecommendScreen from '../screens/RecommendScreen';
import MusicMapScreen from '../screens/MusicMapScreen';
import VibeScreen from '../screens/VibeScreen';
import SnapPlayScreen from '../screens/SnapPlayScreen';
import PlaceSetupScreen from '../screens/PlaceSetupScreen';
import NowPlayingBar from '../components/NowPlayingBar';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: COLORS.green,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color, size }) => {
          const icons = {
            홈: 'radio-button-on-outline',
            추천: 'musical-note-outline',
            뮤직지도: 'map-outline',
            바이브: 'people-outline',
          };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="홈" component={HomeScreen} />
      <Tab.Screen name="추천" component={RecommendScreen} />
      <Tab.Screen name="뮤직지도" component={MusicMapScreen} />
      <Tab.Screen name="바이브" component={VibeScreen} />
    </Tab.Navigator>
  );
}

function RootStack() {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="PlaceSetup" component={PlaceSetupScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="SnapPlay" component={SnapPlayScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="Vibe" component={VibeScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="MusicMap" component={MusicMapScreen} options={{ presentation: 'modal' }} />
      </Stack.Navigator>
      <NowPlayingBar />
    </View>
  );
}

export default function AppNavigator() {
  return (
    <SafeAreaProvider>
      <PlayerProvider>
        <LocationProvider>
          <NavigationContainer>
            <RootStack />
          </NavigationContainer>
        </LocationProvider>
      </PlayerProvider>
    </SafeAreaProvider>
  );
}
