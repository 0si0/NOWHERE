// Using @expo/vector-icons instead of react-native-svg
// to avoid Fabric (New Architecture) prop type conflicts
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import React from 'react';

export const PlayIcon = ({ size = 20, color = '#fff' }) => (
  <Ionicons name="play" size={size} color={color} />
);

export const PauseIcon = ({ size = 20, color = '#fff' }) => (
  <Ionicons name="pause" size={size} color={color} />
);

export const NextIcon = ({ size = 18, color = '#999' }) => (
  <Ionicons name="play-skip-forward" size={size} color={color} />
);

export const LocationIcon = ({ size = 16, color = '#fff' }) => (
  <Ionicons name="location-outline" size={size} color={color} />
);

export const ClockIcon = ({ size = 16, color = '#fff' }) => (
  <Ionicons name="time-outline" size={size} color={color} />
);

export const CloudIcon = ({ size = 16, color = '#fff' }) => (
  <Ionicons name="partly-sunny-outline" size={size} color={color} />
);

export const CameraIcon = ({ size = 20, color = '#fff' }) => (
  <Ionicons name="camera-outline" size={size} color={color} />
);

export const MapIcon = ({ size = 20, color = '#fff' }) => (
  <Ionicons name="map-outline" size={size} color={color} />
);

export const MusicIcon = ({ size = 20, color = '#fff' }) => (
  <Ionicons name="musical-notes-outline" size={size} color={color} />
);

export const HomeIcon = ({ size = 22, color = '#fff' }) => (
  <Ionicons name="radio-button-on-outline" size={size} color={color} />
);

export const RecommendIcon = ({ size = 22, color = '#fff' }) => (
  <Ionicons name="musical-note-outline" size={size} color={color} />
);

export const MapTabIcon = ({ size = 22, color = '#fff' }) => (
  <Ionicons name="map-outline" size={size} color={color} />
);

export const VibeTabIcon = ({ size = 22, color = '#fff' }) => (
  <Ionicons name="people-outline" size={size} color={color} />
);

export const PersonIcon = ({ size = 20, color = '#999' }) => (
  <Ionicons name="person-outline" size={size} color={color} />
);

export const ChevronRightIcon = ({ size = 16, color = '#666' }) => (
  <Ionicons name="chevron-forward" size={size} color={color} />
);
