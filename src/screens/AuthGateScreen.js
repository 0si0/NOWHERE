import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../contexts/SessionContext';
import { markNowhereOnboardingComplete } from '../services/onboardingService';
import {
  createNowhereEmailUser,
  getOrCreateAppUserId,
  refreshNowhereEmailVerification,
  sendNowhereEmailVerification,
  signInNowhereWithEmail,
  signOutNowhereAccount,
} from '../services/firebaseService';

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
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (authUser?.uid && !authUser.isAnonymous && !authUser.emailVerified) {
      setAuthMode('verify');
      setEmail(authUser.email || '');
    }
  }, [authUser?.email, authUser?.emailVerified, authUser?.isAnonymous, authUser?.uid]);

  const accountLabel = useMemo(() => {
    if (isLoading) return '회원 세션을 준비하는 중';
    if (sessionError) return '회원 세션 확인 필요';
    if (authUser?.uid && !authUser.isAnonymous && authUser.emailVerified) return '이메일 인증이 완료된 NOWHERE 회원';
    if (authUser?.uid && !authUser.isAnonymous) return '이메일 인증이 필요한 NOWHERE 회원';
    if (authUser?.uid) return '비회원 세션 준비 완료';
    return 'NOWHERE 회원 로그인이 필요합니다';
  }, [authUser?.emailVerified, authUser?.isAnonymous, authUser?.uid, isLoading, sessionError]);

  const resetMessage = () => {
    setError('');
    setInfo('');
  };

  const completeMemberOnboarding = async (user = authUser) => {
    if (!user?.uid || user.isAnonymous) {
      throw new Error('회원 로그인이 필요합니다.');
    }
    if (!user.emailVerified) {
      setAuthMode('verify');
      setInfo('이메일 인증 후 인증 완료 확인을 눌러주세요.');
      return;
    }
    await markNowhereOnboardingComplete('member');
    onComplete?.('member');
  };

  const handleEmailLogin = async () => {
    if (isLoading || isConnecting) return;
    setIsConnecting(true);
    setConnectingMode('login');
    resetMessage();
    try {
      if (sessionError) throw sessionError;
      const user = await signInNowhereWithEmail({ email, password });
      if (!user.emailVerified) {
        setAuthMode('verify');
        setInfo('이메일 인증이 아직 완료되지 않았습니다. 받은 메일의 인증 링크를 확인해주세요.');
        return;
      }
      await completeMemberOnboarding(user);
    } catch (nextError) {
      setError(nextError.message || '로그인에 실패했습니다.');
    } finally {
      setIsConnecting(false);
      setConnectingMode('');
    }
  };

  const handleSignup = async () => {
    if (isLoading || isConnecting) return;
    setIsConnecting(true);
    setConnectingMode('signup');
    resetMessage();
    try {
      if (sessionError) throw sessionError;
      const user = await createNowhereEmailUser({ email, password });
      setEmail(user.email || email);
      setAuthMode('verify');
      setInfo('인증 메일을 보냈습니다. 메일함에서 인증 링크를 누른 뒤 인증 완료 확인을 눌러주세요.');
    } catch (nextError) {
      setError(nextError.message || '회원가입에 실패했습니다.');
    } finally {
      setIsConnecting(false);
      setConnectingMode('');
    }
  };

  const handleCheckVerification = async () => {
    if (isLoading || isConnecting) return;
    setIsConnecting(true);
    setConnectingMode('verify');
    resetMessage();
    try {
      const user = await refreshNowhereEmailVerification();
      if (!user?.emailVerified) {
        setInfo('아직 이메일 인증이 확인되지 않았습니다. 인증 링크를 누른 뒤 다시 확인해주세요.');
        return;
      }
      await completeMemberOnboarding(user);
    } catch (nextError) {
      setError(nextError.message || '이메일 인증 확인에 실패했습니다.');
    } finally {
      setIsConnecting(false);
      setConnectingMode('');
    }
  };

  const handleResendVerification = async () => {
    if (isLoading || isConnecting) return;
    setIsConnecting(true);
    setConnectingMode('resend');
    resetMessage();
    try {
      await sendNowhereEmailVerification();
      setInfo('인증 메일을 다시 보냈습니다.');
    } catch (nextError) {
      setError(nextError.message || '인증 메일 재발송에 실패했습니다.');
    } finally {
      setIsConnecting(false);
      setConnectingMode('');
    }
  };

  const handleUseDifferentAccount = async () => {
    if (isLoading || isConnecting) return;
    setIsConnecting(true);
    setConnectingMode('signout');
    resetMessage();
    try {
      await signOutNowhereAccount();
      setAuthMode('login');
      setPassword('');
      setInfo('다른 이메일로 로그인하거나 회원가입할 수 있습니다.');
    } catch (nextError) {
      setError(nextError.message || '계정 전환에 실패했습니다.');
    } finally {
      setIsConnecting(false);
      setConnectingMode('');
    }
  };

  const handleConnect = async (accountMode = 'member') => {
    if (isLoading || isConnecting) {
      return;
    }

    setIsConnecting(true);
    setConnectingMode(accountMode);
    resetMessage();
    try {
      if (sessionError) {
        throw sessionError;
      }

      if (accountMode === 'member' && authUser?.uid && !authUser.isAnonymous) {
        await completeMemberOnboarding(authUser);
        return;
      }

      if (!authUser?.uid || accountMode === 'guest') {
        await getOrCreateAppUserId();
      }

      await markNowhereOnboardingComplete(accountMode);
      onComplete?.(accountMode);
    } catch (nextError) {
      setError(nextError.message || 'NOWHERE 시작에 실패했습니다.');
    } finally {
      setIsConnecting(false);
      setConnectingMode('');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
          </View>

          {authMode === 'verify' ? (
            <View style={styles.formPanel}>
              <Text style={styles.formTitle}>이메일 인증</Text>
              <Text style={styles.formText}>
                {email || authUser?.email || '가입한 이메일'}로 보낸 인증 링크를 누른 뒤 아래 버튼으로 확인해주세요.
              </Text>
              <TouchableOpacity
                style={[styles.connectButton, (isLoading || isConnecting) && styles.connectButtonDisabled]}
                activeOpacity={0.86}
                onPress={handleCheckVerification}
                disabled={isLoading || isConnecting}
              >
                {isConnecting && connectingMode === 'verify' ? (
                  <ActivityIndicator color="#07100B" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={22} color="#07100B" />
                    <Text style={styles.connectButtonText}>인증 완료 확인</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.ghostButton, (isLoading || isConnecting) && styles.connectButtonDisabled]}
                activeOpacity={0.86}
                onPress={handleResendVerification}
                disabled={isLoading || isConnecting}
              >
                {isConnecting && connectingMode === 'resend' ? (
                  <ActivityIndicator color={UI.peach} />
                ) : (
                  <Text style={styles.ghostButtonText}>인증 메일 다시 보내기</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modeLink}
                activeOpacity={0.72}
                onPress={handleUseDifferentAccount}
                disabled={isLoading || isConnecting}
              >
                <Text style={styles.modeLinkText}>다른 계정으로 로그인</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.formPanel}>
              <View style={styles.modeTabs}>
                <TouchableOpacity
                  style={[styles.modeTab, authMode === 'login' && styles.modeTabActive]}
                  onPress={() => {
                    resetMessage();
                    setAuthMode('login');
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.modeTabText, authMode === 'login' && styles.modeTabTextActive]}>로그인</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeTab, authMode === 'signup' && styles.modeTabActive]}
                  onPress={() => {
                    resetMessage();
                    setAuthMode('signup');
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.modeTabText, authMode === 'signup' && styles.modeTabTextActive]}>회원가입</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="이메일 주소"
                placeholderTextColor={UI.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={authMode === 'signup' ? '비밀번호 (6자 이상)' : '비밀번호'}
                placeholderTextColor={UI.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType={authMode === 'signup' ? 'newPassword' : 'password'}
              />

              <TouchableOpacity
                style={[styles.connectButton, (isLoading || isConnecting) && styles.connectButtonDisabled]}
                activeOpacity={0.86}
                onPress={authMode === 'signup' ? handleSignup : handleEmailLogin}
                disabled={isLoading || isConnecting}
              >
                {isConnecting && (connectingMode === 'login' || connectingMode === 'signup') ? (
                  <ActivityIndicator color="#07100B" />
                ) : (
                  <>
                    <Ionicons name={authMode === 'signup' ? 'person-add-outline' : 'log-in-outline'} size={22} color="#07100B" />
                    <Text style={styles.connectButtonText}>{authMode === 'signup' ? '회원가입 후 인증 메일 받기' : '이메일로 로그인'}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

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
            NOWHERE 회원 계정은 Shall We Share 같은 사용자 간 기능의 고유 userId로 사용됩니다. Spotify 권한은 다음 단계에서 별도로 연결합니다.
          </Text>

          {info ? <Text style={styles.infoText}>{info}</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {sessionError ? <Text style={styles.errorText}>{sessionError.message || String(sessionError)}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UI.bg,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 34,
    justifyContent: 'center',
  },
  keyboardView: {
    flex: 1,
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
  formPanel: {
    marginTop: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(14, 15, 17, 0.92)',
    padding: 18,
  },
  formTitle: {
    color: UI.text,
    fontSize: 24,
    fontWeight: '900',
  },
  formText: {
    color: UI.textSoft,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  modeTabs: {
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI.border,
    padding: 4,
    marginBottom: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  modeTab: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabActive: {
    backgroundColor: 'rgba(255, 201, 184, 0.16)',
    borderWidth: 1,
    borderColor: UI.border,
  },
  modeTabText: {
    color: UI.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  modeTabTextActive: {
    color: UI.peach,
  },
  input: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 16,
    color: UI.text,
    fontSize: 15,
    marginTop: 10,
  },
  connectButton: {
    marginTop: 18,
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
  ghostButton: {
    marginTop: 10,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: UI.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 201, 184, 0.04)',
  },
  ghostButtonText: {
    color: UI.peach,
    fontSize: 14,
    fontWeight: '800',
  },
  modeLink: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 12,
    marginTop: 2,
  },
  modeLinkText: {
    color: UI.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
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
  infoText: {
    color: UI.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
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
