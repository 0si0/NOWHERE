import 'react-native-gesture-handler';
import { enableScreens } from 'react-native-screens';
enableScreens(false);
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <>
      <StatusBar style="light" backgroundColor="#0A0A0A" />
      <AppNavigator />
    </>
  );
}
