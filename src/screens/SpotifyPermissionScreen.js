import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
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
import { PlayerContext } from '../contexts/PlayerContext';
import { markSpotifyOnboardingComplete } from '../services/onboardingService';
import { getSpotifyAccessRequestStatus, submitSpotifyAccessRequest } from '../services/firebaseService';

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

const SPOTIFY_USER_INFO_HELP_IMAGE = require('../../assets/spotify-user-info-help.png');
const HELP_IMAGE_ASPECT_RATIO = 1179 / 1800;
const HELP_IMAGE_WIDTH = Math.min(Dimensions.get('window').width - 60, 430);
const SHOW_MANUAL_SPOTIFY_ACCESS_REQUEST_FORM = false;

function isSpotifyAuthorized(result = {}, state = {}) {
  return result?.authorized === true
    || result?.isAuthorized === true
    || result?.status === 'authorized'
    || state?.authorizationStatus === 'authorized'
    || state?.isAuthorized === true;
}

function getSpotifyConnectMessage(error, fallback = 'Spotify 연결에 실패했습니다. 등록이 완료되면 다시 연결을 시도해주세요.') {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('forbidden') || message.includes('403')) {
    return 'Spotify에서 현재 연결 확인을 허용하지 않았습니다. 등록을 마쳤다면 앱을 계속 사용할 수 있으며 잠시 후 다시 시도해주세요.';
  }
  return error?.message || fallback;
}

export default function SpotifyPermissionScreen({ onComplete }) {
  const { requestAuthorization, getState } = useContext(PlayerContext);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [isCheckingRequest, setIsCheckingRequest] = useState(true);
  const [accessRequest, setAccessRequest] = useState({ status: 'none' });
  const [spotifyFullName, setSpotifyFullName] = useState('');
  const [spotifyEmail, setSpotifyEmail] = useState('');
  const [error, setError] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [isHelpVisible, setIsHelpVisible] = useState(false);
  const isRequestFormValid = useMemo(() => (
    spotifyFullName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(spotifyEmail.trim())
  ), [spotifyEmail, spotifyFullName]);
  const hasAccessRequest = ['pending', 'approved'].includes(accessRequest?.status);

  const refreshAccessRequestStatus = async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setIsCheckingRequest(true);
    }
    setError('');
    try {
      const status = await getSpotifyAccessRequestStatus();
      setAccessRequest(status || { status: 'none' });
      return status;
    } catch (nextError) {
      setError(nextError.message || 'Spotify 권한 요청 상태를 확인하지 못했습니다.');
      return null;
    } finally {
      if (showLoading) {
        setIsCheckingRequest(false);
      }
    }
  };

  useEffect(() => {
    let mounted = true;
    getSpotifyAccessRequestStatus()
      .then((status) => {
        if (mounted) {
          setAccessRequest(status || { status: 'none' });
        }
      })
      .catch((nextError) => {
        if (mounted) {
          setError(nextError.message || 'Spotify 권한 요청 상태를 확인하지 못했습니다.');
        }
      })
      .finally(() => {
        if (mounted) {
          setIsCheckingRequest(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleConnect = async () => {
    if (isConnecting) {
      return;
    }

    setIsConnecting(true);
    setError('');
    try {
      const authorization = await requestAuthorization({
        forcePrompt: true,
      });
      const state = await getState().catch(() => null);
      if (!isSpotifyAuthorized(authorization, state)) {
        throw new Error('Spotify 권한 승인이 완료되지 않았습니다.');
      }

      await markSpotifyOnboardingComplete();
      onComplete?.();
    } catch (nextError) {
      setError(getSpotifyConnectMessage(nextError));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSubmitAccessRequest = async () => {
    if (isSubmittingRequest) {
      return;
    }

    setIsSubmittingRequest(true);
    setError('');
    setRequestMessage('');
    try {
      if (!isRequestFormValid) {
        throw new Error('Spotify 사용자 이름과 이메일을 모두 정확히 입력해주세요.');
      }

      await submitSpotifyAccessRequest({
        spotifyFullName: spotifyFullName.trim(),
        spotifyEmail: spotifyEmail.trim(),
      });
      const nextStatus = await refreshAccessRequestStatus();
      setAccessRequest(nextStatus || { status: 'pending' });
      setRequestMessage('등록 요청을 보냈습니다. 개발자가 Spotify Console에 등록한 뒤 아래 Spotify 연결을 다시 시도해주세요.');
      setSpotifyFullName('');
      setSpotifyEmail('');
    } catch (nextError) {
      setError(nextError.message || 'Spotify 등록 요청 전송에 실패했습니다.');
    } finally {
      setIsSubmittingRequest(false);
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

          {isCheckingRequest ? (
            <View style={styles.checkingPanel}>
              <ActivityIndicator color={UI.peach} />
              <Text style={styles.infoText}>Spotify 권한 요청 상태를 확인하는 중입니다.</Text>
            </View>
          ) : null}

          {SHOW_MANUAL_SPOTIFY_ACCESS_REQUEST_FORM && !hasAccessRequest ? <View style={styles.requestPanel}>
            <Text style={styles.requestTitle}>공모전 심사용 등록 요청</Text>
            <Text style={styles.requestText}>
              NOWHERE는 Spotify 개발 모드 제한으로 인해 사전 권한 등록이 필요합니다. Spotify 계정의 이름과 이메일을 입력해 권한 요청을 먼저 진행해주세요.
            </Text>
            <Text style={styles.requestText}>
              Spotify에 접속하여 왼쪽 상단 프로필 마크 클릭 → 설정 및 개인정보 → 계정 → 사용자 이름과 이메일을 복사해서 붙여넣어주세요.
            </Text>
            <TouchableOpacity
              style={styles.helpButton}
              activeOpacity={0.86}
              onPress={() => setIsHelpVisible(true)}
            >
              <Ionicons name="help-circle-outline" size={18} color={UI.peach} />
              <Text style={styles.helpButtonText}>사용자 이름 / 이메일 확인 방법</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={spotifyFullName}
              onChangeText={setSpotifyFullName}
              placeholder="Spotify 사용자 이름"
              placeholderTextColor={UI.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.input}
              value={spotifyEmail}
              onChangeText={setSpotifyEmail}
              placeholder="Spotify 이메일"
              placeholderTextColor={UI.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <TouchableOpacity
              style={[
                styles.requestButton,
                (!isRequestFormValid || isSubmittingRequest) && styles.connectButtonDisabled,
              ]}
              activeOpacity={0.86}
              onPress={handleSubmitAccessRequest}
              disabled={!isRequestFormValid || isSubmittingRequest}
            >
              {isSubmittingRequest ? (
                <ActivityIndicator color={UI.peach} />
              ) : (
                <Text style={styles.requestButtonText}>등록 요청 보내기</Text>
              )}
            </TouchableOpacity>
          </View> : null}

          {hasAccessRequest ? (
            <View style={styles.pendingPanel}>
              <Ionicons name="time-outline" size={23} color={UI.peach} />
              <View style={styles.pendingTextWrap}>
                <Text style={styles.pendingTitle}>등록 요청 완료</Text>
                <Text style={styles.pendingText}>
                  개발자가 Spotify Console에 계정을 등록하면 Spotify 연결이 성공합니다. 아직 등록 전이면 연결 후 다시 이 화면으로 돌아옵니다.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.refreshButton}
                activeOpacity={0.86}
                onPress={() => refreshAccessRequestStatus({ showLoading: true })}
              >
                <Ionicons name="refresh-outline" size={18} color={UI.peach} />
              </TouchableOpacity>
            </View>
          ) : null}

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

          {requestMessage ? <Text style={styles.infoText}>{requestMessage}</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <Modal
          visible={isHelpVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setIsHelpVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.helpModal}>
              <View style={styles.helpModalHeader}>
                <Text style={styles.helpModalTitle}>Spotify 정보 확인 방법</Text>
                <TouchableOpacity
                  style={styles.modalCloseButton}
                  activeOpacity={0.86}
                  onPress={() => setIsHelpVisible(false)}
                >
                  <Ionicons name="close-outline" size={24} color={UI.text} />
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.helpImageScroll}
                contentContainerStyle={styles.helpImageContent}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                <Image
                  source={SPOTIFY_USER_INFO_HELP_IMAGE}
                  style={[
                    styles.helpImage,
                    {
                      width: HELP_IMAGE_WIDTH,
                      height: HELP_IMAGE_WIDTH / HELP_IMAGE_ASPECT_RATIO,
                    },
                  ]}
                  resizeMode="contain"
                />
              </ScrollView>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UI.bg,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 46,
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
  checkingPanel: {
    marginTop: 22,
    alignItems: 'center',
    gap: 8,
  },
  requestPanel: {
    marginTop: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(255, 201, 184, 0.05)',
    padding: 16,
  },
  requestTitle: {
    color: UI.text,
    fontSize: 16,
    fontWeight: '900',
  },
  requestText: {
    color: UI.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  helpButton: {
    marginTop: 12,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(255, 201, 184, 0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  helpButtonText: {
    color: UI.peach,
    fontSize: 13,
    fontWeight: '800',
  },
  input: {
    height: 48,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 14,
    color: UI.text,
    fontSize: 14,
    marginTop: 10,
  },
  requestButton: {
    marginTop: 12,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: UI.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestButtonText: {
    color: UI.peach,
    fontSize: 14,
    fontWeight: '900',
  },
  pendingPanel: {
    marginTop: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: 'rgba(255, 201, 184, 0.07)',
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pendingTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  pendingTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
  },
  pendingText: {
    color: UI.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
  },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: UI.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    color: UI.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
    textAlign: 'center',
  },
  errorText: {
    color: UI.peach,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.74)',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 42,
  },
  helpModal: {
    maxHeight: '92%',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: '#07090C',
    overflow: 'hidden',
  },
  helpModalHeader: {
    minHeight: 56,
    paddingLeft: 18,
    paddingRight: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 201, 184, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  helpModalTitle: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '900',
  },
  modalCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpImageScroll: {
    width: '100%',
  },
  helpImageContent: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  helpImage: {
    borderRadius: 16,
  },
});
