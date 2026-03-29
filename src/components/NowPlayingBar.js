import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants';
import { PlayIcon, PauseIcon, NextIcon } from './Icons';
import { PlayerContext } from '../contexts/PlayerContext';

export default function NowPlayingBar({ onPress }) {
  const { currentTrack, isPlaying, togglePlay, skipNext } = useContext(PlayerContext);

  if (!currentTrack) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>장소를 설정하면 자동으로 음악이 시작돼요</Text>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.9}>
      <View style={[styles.albumArt, { backgroundColor: currentTrack.color + '44' }]} />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{currentTrack.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{currentTrack.artist}</Text>
      </View>
      <View style={styles.controls}>
        <TouchableOpacity onPress={togglePlay} style={styles.controlBtn}>
          {isPlaying ? <PauseIcon size={20} color={COLORS.text} /> : <PlayIcon size={20} color={COLORS.text} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={skipNext} style={styles.controlBtn}>
          <NextIcon size={18} color={COLORS.textSub} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  albumArt: {
    width: 40,
    height: 40,
    borderRadius: 8,
    flexShrink: 0,
  },
  info: {
    flex: 1,
  },
  title: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  artist: {
    color: COLORS.textSub,
    fontSize: 12,
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlBtn: {
    padding: 6,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
});
