import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../contexts/SessionContext';
import { markNowhereOnboardingComplete } from '../services/onboardingService';
import { getOrCreateAppUserId } from '../services/firebaseService';

const UI = {
  bg: '#05070A',
  text: '#FFF1EC',
  textSoft: '#D9C6C0',
  textMuted: '#9E908D',
  peach: '#FFC8B8',
  border: 'rgba(255, 201, 184, 0.28)',
  surface: 'rgba(31, 29, 29, 0.78)',
};

export default function AuthGateScreen({ onComplete }) {
  const { authUser, isLoading, error: sessionError } = useSession();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingMode, setConnectingMode] = useState('');
  const [error, setError] = useState('');

  const accountLabel = useMemo(() => {
    if (isLoading) return '회원 세션을 준비하는 중';
    if (sessionError) return '회원 세션 확인 필요';
    if (authUser?.uid) return 'NOWHERE 회원 세션 준비 완료';
    return 'NOWHERE 회원 세션을 생성합니다';
  }, [authUser?.uid, isLoading, sessionError]);

  const handleConnect = async (accountMode = 'member') => {
    if (isLoading || isConnecting) {
      return;
    }

    setIsConnecting(true);
    setConnectingMode(accountMode);
    setError('');
    try {
      if (sessionError) {
        throw sessionError;
      }

      if (!authUser?.uid || accountMode === 'guest') {
        await getOrCreateAppUserId();
      }

      await markNowhereOnboardingComplete(accountMode);
      onComplete?.();
    } catch (nextError) {
      setError(nextError.message || 'NOWHERE 시작에 실패했습니다.');
    } finally {
      setIsConnecting(false);
      setConnectingMode('');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoBlock}>
          <Text style={styles.logo}>NOWHERE</Text>
          <Text style={styles.subtitle}>앱 계정을 먼저 준비합니다</Text>
        </View>

        <View style={styles.statusPanel}>
          <View style={styles.statusRow}>
            <Ionicons name="person-circle-outline" size={24} color={UI.peach} />
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusTitle}>회원가입 / 로그인</Text>
              <Text style={styles.statusText}>{accountLabel}</Text>
            </View>
          </View>

          <View style={styles.statusDivider} />

          <View style={styles.statusRow}>
            <Ionicons name="musical-notes-outline" size={24} color={UI.peach} />
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusTitle}>Spotify 연결</Text>
              <Text style={styles.statusText}>
                NOWHERE 계정 준비 후 별도 단계에서 연결합니다
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.connectButton, (isLoading || isConnecting) && styles.connectButtonDisabled]}
          activeOpacity={0.86}
          onPress={() => handleConnect('member')}
          disabled={isLoading || isConnecting}
        >
          {isConnecting && connectingMode === 'member' ? (
            <ActivityIndicator color="#07100B" />
          ) : (
            <>
              <Ionicons name="log-in-outline" size={22} color="#07100B" />
              <Text style={styles.connectButtonText}>NOWHERE 시작</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.guestButton, (isLoading || isConnecting) && styles.connectButtonDisabled]}
          activeOpacity={0.86}
          onPress={() => handleConnect('guest')}
          disabled={isLoading || isConnecting}
        >
          {isConnecting && connectingMode === 'guest' ? (
            <ActivityIndicator color={UI.peach} />
          ) : (
            <>
              <Ionicons name="person-outline" size={21} color={UI.peach} />
              <Text style={styles.guestButtonText}>이 기기에서 비회원으로 시작</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.guestHint}>
          NOWHERE 세션은 앱을 삭제하기 전까지 유지되며, Spotify 권한은 필요할 때 별도로 다시 연결합니다.
        </Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {sessionError ? <Text style={styles.errorText}>{sessionError.message || String(sessionError)}</Text> : null}
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
    backgroundColor: UI.peach,
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
  guestButton: {
    marginTop: 12,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(255, 201, 184, 0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  guestButtonText: {
    color: UI.peach,
    fontSize: 15,
    fontWeight: '800',
  },
  guestHint: {
    color: UI.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    textAlign: 'center',
  },
  errorText: {
    color: UI.peach,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
    textAlign: 'center',
  },
});
