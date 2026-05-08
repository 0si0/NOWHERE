import React, { useContext, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PlayerContext } from '../contexts/PlayerContext';
import { markSpotifyOnboardingComplete } from '../services/onboardingService';

const UI = {
  bg: '#05070A',
  text: '#FFF1EC',
  textSoft: '#D9C6C0',
  textMuted: '#9E908D',
  peach: '#FFC8B8',
  green: '#6EE89A',
  border: 'rgba(255, 201, 184, 0.28)',
  surface: 'rgba(31, 29, 29, 0.78)',
};

function isSpotifyAuthorized(result = {}, state = {}) {
  return result?.authorized === true
    || result?.isAuthorized === true
    || result?.status === 'authorized'
    || state?.authorizationStatus === 'authorized'
    || state?.isAuthorized === true;
}

export default function SpotifyPermissionScreen({ onComplete }) {
  const { requestAuthorization, getState } = useContext(PlayerContext);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    if (isConnecting) {
      return;
    }

    setIsConnecting(true);
    setError('');
    try {
      const authorization = await requestAuthorization({ forcePrompt: true });
      const state = await getState().catch(() => null);
      if (!isSpotifyAuthorized(authorization, state)) {
        throw new Error('Spotify 권한 승인이 완료되지 않았습니다.');
      }

      await markSpotifyOnboardingComplete();
      onComplete?.();
    } catch (nextError) {
      setError(nextError.message || 'Spotify 연결에 실패했습니다.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoBlock}>
          <Text style={styles.logo}>NOWHERE</Text>
          <Text style={styles.subtitle}>Spotify 권한을 연결합니다</Text>
        </View>

        <View style={styles.statusPanel}>
          <View style={styles.statusRow}>
            <Ionicons name="checkmark-circle-outline" size={24} color={UI.green} />
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusTitle}>NOWHERE 계정</Text>
              <Text style={styles.statusText}>앱 삭제 전까지 유지됩니다</Text>
            </View>
          </View>

          <View style={styles.statusDivider} />

          <View style={styles.statusRow}>
            <Ionicons name="musical-notes-outline" size={24} color={UI.peach} />
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusTitle}>Spotify 연결</Text>
              <Text style={styles.statusText}>
                권한이 만료되었을 때 이 단계만 다시 진행합니다
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.connectButton, isConnecting && styles.connectButtonDisabled]}
          activeOpacity={0.86}
          onPress={handleConnect}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <ActivityIndicator color="#07100B" />
          ) : (
            <>
              <Ionicons name="link-outline" size={22} color="#07100B" />
              <Text style={styles.connectButtonText}>Spotify 연결</Text>
            </>
          )}
        </TouchableOpacity>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UI.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 34,
    justifyContent: 'center',
  },
  logoBlock: {
    marginBottom: 44,
  },
  logo: {
    color: UI.text,
    fontSize: 31,
    fontWeight: '300',
    letterSpacing: 12,
  },
  subtitle: {
    color: UI.textMuted,
    fontSize: 14,
    marginTop: 16,
  },
  statusPanel: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: UI.surface,
    padding: 18,
    gap: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  statusTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  statusTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '800',
  },
  statusText: {
    color: UI.textMuted,
    fontSize: 12,
    marginTop: 5,
    lineHeight: 17,
  },
  statusDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 201, 184, 0.16)',
  },
  connectButton: {
    marginTop: 28,
    height: 54,
    borderRadius: 27,
    backgroundColor: UI.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  connectButtonDisabled: {
    opacity: 0.58,
  },
  connectButtonText: {
    color: '#07100B',
    fontSize: 15,
    fontWeight: '900',
  },
  errorText: {
    color: UI.peach,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
    textAlign: 'center',
  },
});
