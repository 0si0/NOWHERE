import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS } from '../constants';

const DEFAULT_COORDS = {
  latitude: 37.5665,
  longitude: 126.978,
};

function hasValidKakaoKey(apiKey) {
  return Boolean(apiKey && !apiKey.startsWith('YOUR_'));
}

function toNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    return '';
  }
  return String(baseUrl).replace(/\/+$/, '');
}

function buildMapUrl({ apiKey, baseUrl, center, radiusMeters }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return '';
  }

  const params = new URLSearchParams({
    appkey: apiKey,
    lat: String(toNumber(center?.latitude, DEFAULT_COORDS.latitude)),
    lng: String(toNumber(center?.longitude, DEFAULT_COORDS.longitude)),
    radius: String(toNumber(radiusMeters, 200)),
    ts: String(Date.now()),
  });

  return `${normalizedBaseUrl}/kakao-map.html?${params.toString()}`;
}

export default function KakaoPlacePicker({
  apiKey,
  baseUrl,
  center,
  radiusMeters,
  onSelect,
  onMoveToCurrentLocation,
}) {
  const webviewRef = useRef(null);
  const readyTimerRef = useRef(null);
  const initialCenterRef = useRef(center || DEFAULT_COORDS);
  const selectedCenter = center || DEFAULT_COORDS;
  const canRenderMap = hasValidKakaoKey(apiKey);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const [loadError, setLoadError] = useState('');
  const [isMapReady, setIsMapReady] = useState(false);

  const mapUrl = useMemo(
    () => buildMapUrl({
      apiKey,
      baseUrl: normalizedBaseUrl,
      center: initialCenterRef.current,
      radiusMeters,
    }),
    [apiKey, normalizedBaseUrl]
  );

  const handleMessage = useCallback((event) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload.type === 'ready') {
        clearTimeout(readyTimerRef.current);
        setIsMapReady(true);
        setLoadError('');
      }
      if (payload.type === 'error') {
        setLoadError(payload.message || 'Kakao 지도를 불러오지 못했습니다.');
      }
      if (typeof payload.latitude === 'number' && typeof payload.longitude === 'number') {
        onSelect?.({
          latitude: payload.latitude,
          longitude: payload.longitude,
        });
      }
    } catch (error) {
      // WebView 내부 지도 이벤트 외 메시지는 무시한다.
    }
  }, [onSelect]);

  useEffect(() => {
    if (!canRenderMap || !mapUrl) {
      return undefined;
    }

    setIsMapReady(false);
    setLoadError('');
    clearTimeout(readyTimerRef.current);
    readyTimerRef.current = setTimeout(() => {
      setLoadError('지도 로딩 시간이 초과되었습니다. Kakao Developers의 카카오맵 사용 설정과 JavaScript SDK 도메인 등록을 확인하세요.');
    }, 12000);

    return () => clearTimeout(readyTimerRef.current);
  }, [canRenderMap, mapUrl]);

  useEffect(() => {
    if (!canRenderMap || !isMapReady || !webviewRef.current) {
      return;
    }

    webviewRef.current.injectJavaScript(`
      if (window.nowhereMoveTo) {
        window.nowhereMoveTo(${selectedCenter.latitude}, ${selectedCenter.longitude}, ${toNumber(radiusMeters, 200)});
      }
      true;
    `);
  }, [canRenderMap, isMapReady, radiusMeters, selectedCenter.latitude, selectedCenter.longitude]);

  if (!canRenderMap) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Kakao Maps API 키가 필요합니다</Text>
        <Text style={styles.fallbackText}>
          .env.local에 EXPO_PUBLIC_KAKAO_MAPS_API_KEY를 넣으면 지도에서 장소를 직접 고를 수 있습니다.
        </Text>
        {onMoveToCurrentLocation ? (
          <TouchableOpacity style={styles.currentButton} onPress={onMoveToCurrentLocation}>
            <Text style={styles.currentButtonText}>현재 위치로 설정</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (!mapUrl) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>지도 Hosting URL이 필요합니다</Text>
        <Text style={styles.fallbackText}>
          .env.local에 EXPO_PUBLIC_KAKAO_MAPS_BASE_URL을 Firebase Hosting 도메인으로 설정해주세요.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        originWhitelist={['https://*']}
        source={{ uri: mapUrl }}
        onMessage={handleMessage}
        onError={(event) => setLoadError(event.nativeEvent.description || 'WebView 로딩 실패')}
        onHttpError={(event) => setLoadError(`WebView HTTP 오류 ${event.nativeEvent.statusCode}`)}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        startInLoadingState
        cacheEnabled={false}
        cacheMode="LOAD_NO_CACHE"
        style={styles.webview}
      />
      {loadError ? (
        <View style={styles.errorOverlay} pointerEvents="none">
          <Text style={styles.errorTitle}>지도 로딩 실패</Text>
          <Text style={styles.errorBody}>{loadError}</Text>
          <Text style={styles.errorBody}>필수 설정: 앱 &gt; 제품 설정 &gt; 카카오맵 사용 ON</Text>
          <Text style={styles.errorBody}>지도 URL: {normalizedBaseUrl}/kakao-map.html</Text>
        </View>
      ) : null}
      <TouchableOpacity style={styles.currentButtonFloating} onPress={onMoveToCurrentLocation}>
        <Text style={styles.currentButtonText}>현재 위치</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 260,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  webview: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  errorOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(10,10,10,0.86)',
    borderWidth: 1,
    borderColor: COLORS.coral + '77',
  },
  errorTitle: {
    color: COLORS.coral,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 5,
  },
  errorBody: {
    color: COLORS.textSub,
    fontSize: 11,
    lineHeight: 16,
  },
  fallback: {
    minHeight: 220,
    borderRadius: 18,
    padding: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
  },
  fallbackTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  fallbackText: {
    color: COLORS.textSub,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  currentButton: {
    alignSelf: 'flex-start',
    marginTop: 16,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.green,
  },
  currentButtonFloating: {
    position: 'absolute',
    top: 12,
    right: 12,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.green,
  },
  currentButtonText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '800',
  },
});
