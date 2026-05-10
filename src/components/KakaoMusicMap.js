import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

const DEFAULT_COORDS = {
  latitude: 37.5665,
  longitude: 126.978,
};

const MAP_UI = {
  surface: 'rgba(20, 17, 16, 0.86)',
  border: 'rgba(255, 201, 184, 0.24)',
  text: '#FFF1EC',
  textSoft: '#D8C5BE',
  peach: '#FFC8B8',
  error: '#FF7777',
};
const LIVE_MAP_INJECT_THROTTLE_MS = 2500;
const MAX_SERIALIZED_ROUTE_POINTS = 160;
const MAX_MAP_RECORDS = 80;

function hasValidKakaoKey(apiKey) {
  return Boolean(apiKey && !apiKey.startsWith('YOUR_'));
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    return '';
  }
  return String(baseUrl).replace(/\/+$/, '');
}

function toNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizePoint(point) {
  if (!point || typeof point !== 'object') {
    return null;
  }
  const latitude = typeof point.latitude === 'number' && Number.isFinite(point.latitude)
    ? point.latitude
    : null;
  const longitude = typeof point.longitude === 'number' && Number.isFinite(point.longitude)
    ? point.longitude
    : null;
  if (latitude == null || longitude == null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return {
    latitude,
    longitude,
    recordedAt: point.recordedAt,
    segmentIndex: Number.isInteger(point.segmentIndex) ? point.segmentIndex : 0,
  };
}

function downsamplePoints(points = [], maxPoints = MAX_SERIALIZED_ROUTE_POINTS) {
  if (points.length <= maxPoints) {
    return points;
  }
  const lastIndex = points.length - 1;
  const step = lastIndex / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)]).filter(Boolean);
}

function normalizeMarkers(markers = []) {
  const markerList = Array.isArray(markers) ? markers : [];
  return markerList.map((marker, index) => {
    if (!marker || typeof marker !== 'object') {
      return null;
    }
    const location = normalizePoint(marker.location || marker.point);
    if (!location) return null;
    return {
      id: marker.id || `marker-${index}`,
      location,
      albumColor: marker.albumColor,
      fromTrackKey: marker.fromTrackKey || '',
      toTrackKey: marker.toTrackKey || marker.trackKey || '',
      trackId: marker.trackId || marker.track?.id || marker.track?.spotifyUri || marker.track?.uri || '',
      trackName: marker.trackName || marker.track?.title || '',
      artistName: marker.artistName || marker.track?.artist || '',
      albumName: marker.albumName || marker.track?.album || '',
      albumArtUrl: marker.albumArtUrl || marker.track?.artworkUrl || '',
      recordedAt: marker.recordedAt,
    };
  }).filter(Boolean);
}

function normalizeRouteSegments(segments = [], routePoints = []) {
  const segmentList = Array.isArray(segments) ? segments : [];
  return segmentList.map((segment, index) => {
    if (!segment || typeof segment !== 'object') {
      return null;
    }
    const startIndex = Number.isInteger(segment.startIndex) && segment.startIndex >= 0 ? segment.startIndex : 0;
    const endIndex = Number.isInteger(segment.endIndex) && segment.endIndex >= startIndex
      ? segment.endIndex
      : startIndex;
    const sourcePoints = Array.isArray(segment.routePoints) && segment.routePoints.length > 0
      ? segment.routePoints
      : routePoints.slice(startIndex, endIndex + 1);
    const normalizedPoints = downsamplePoints(sourcePoints.map(normalizePoint).filter(Boolean));
    if (normalizedPoints.length === 0) {
      return null;
    }
    return {
      id: segment.id || `segment-${index}`,
      trackId: segment.trackId || '',
      trackKey: segment.trackKey || '',
      trackName: segment.trackName || segment.track?.title || '',
      artistName: segment.artistName || segment.track?.artist || '',
      albumName: segment.albumName || segment.track?.album || '',
      albumArtUrl: segment.albumArtUrl || segment.track?.artworkUrl || '',
      albumColor: segment.albumColor || '#FFC8B8',
      startIndex,
      endIndex,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      routePoints: normalizedPoints,
    };
  }).filter(Boolean);
}

function buildMapUrl({ apiKey, baseUrl, center }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return '';
  }

  const params = new URLSearchParams({
    appkey: apiKey,
    lat: String(toNumber(center?.latitude, DEFAULT_COORDS.latitude)),
    lng: String(toNumber(center?.longitude, DEFAULT_COORDS.longitude)),
    ts: String(Date.now()),
  });

  return `${normalizedBaseUrl}/music-map.html?${params.toString()}`;
}

function serializeRecords(records = []) {
  return records.slice(0, MAX_MAP_RECORDS).map((record) => {
    const rawRoutePoints = Array.isArray(record.routePoints) ? record.routePoints : [];
    const routePoints = downsamplePoints(rawRoutePoints.map(normalizePoint).filter(Boolean));
    const routeSegments = normalizeRouteSegments(record.routeSegments, routePoints);
    const location = normalizePoint(record.location) || routePoints[routePoints.length - 1] || normalizePoint(record.startLocation);
    if (!location) {
      return null;
    }
    return {
      id: record.id,
      sessionId: record.sessionId,
      isLive: Boolean(record.isLive),
      recordType: record.recordType,
      albumColor: record.albumColor,
      startAlbumColor: record.startAlbumColor,
      endAlbumColor: record.endAlbumColor,
      albumArtUrl: record.albumArtUrl,
      placeName: record.placeName,
      location,
      currentLocation: normalizePoint(record.currentLocation),
      startLocation: normalizePoint(record.startLocation),
      endLocation: normalizePoint(record.endLocation),
      endpointPinsMerged: Boolean(record.endpointPinsMerged),
      routePoints,
      routeSegments,
      trackChangeMarkers: normalizeMarkers(record.trackChangeMarkers || []),
      routeDistance: record.routeDistance || 0,
      playedDurationMs: record.playedDurationMs,
      track: {
        title: record.track?.title || record.title || 'Unknown Track',
        artist: record.track?.artist || record.artist || '',
        artworkUrl: record.track?.artworkUrl || record.albumArtUrl || '',
      },
    };
  }).filter(Boolean);
}

function getPointSignature(point) {
  if (!point || typeof point !== 'object') {
    return '';
  }
  if (typeof point.latitude !== 'number' || typeof point.longitude !== 'number') {
    return '';
  }
  return `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
}

function getRecordsSignature(records = [], mode, selectedRecordId, shouldFit) {
  const safeRecords = records.slice(0, MAX_MAP_RECORDS);
  return JSON.stringify({
    mode,
    selectedRecordId,
    shouldFit,
    records: safeRecords.map((record) => {
      const routePoints = Array.isArray(record.routePoints) ? record.routePoints : [];
      const lastPoint = routePoints[routePoints.length - 1] || record.currentLocation || record.location;
      const routeSegmentSignature = Array.isArray(record.routeSegments)
        ? record.routeSegments.map((segment) => `${segment?.id || ''}:${segment?.albumColor || ''}:${segment?.endIndex ?? ''}`).join('|')
        : '';
      return {
        id: record.id,
        sessionId: record.sessionId,
        isLive: Boolean(record.isLive),
        recordType: record.recordType,
        color: record.albumColor,
        startColor: record.startAlbumColor,
        endColor: record.endAlbumColor,
        routeCount: routePoints.length,
        segmentCount: Array.isArray(record.routeSegments) ? record.routeSegments.length : 0,
        routeSegmentSignature,
        markerCount: Array.isArray(record.trackChangeMarkers) ? record.trackChangeMarkers.length : 0,
        lastPoint: getPointSignature(lastPoint),
        currentLocation: getPointSignature(record.currentLocation),
        startLocation: getPointSignature(record.startLocation),
        endLocation: getPointSignature(record.endLocation),
        selected: record.id === selectedRecordId,
        trackTitle: record.track?.title || record.title || '',
      };
    }),
  });
}

function KakaoMusicMap({
  apiKey,
  baseUrl,
  center,
  records,
  mode,
  selectedRecordId,
  onRecordPress,
}) {
  const webviewRef = useRef(null);
  const readyTimerRef = useRef(null);
  const injectThrottleTimerRef = useRef(null);
  const pendingInjectRef = useRef(null);
  const lastInjectSignatureRef = useRef('');
  const lastLiveInjectAtRef = useRef(0);
  const hasFittedLiveRecordRef = useRef(false);
  const initialCenterRef = useRef(center || DEFAULT_COORDS);
  const canRenderMap = hasValidKakaoKey(apiKey);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const [isMapReady, setIsMapReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  const mapUrl = useMemo(
    () => buildMapUrl({
      apiKey,
      baseUrl: normalizedBaseUrl,
      center: initialCenterRef.current,
    }),
    [apiKey, normalizedBaseUrl]
  );

  const performInject = useCallback((payload) => {
    if (!webviewRef.current || !isMapReady) {
      return;
    }

    webviewRef.current.injectJavaScript(`
      if (window.nowhereSetMusicMap) {
        window.nowhereSetMusicMap(${JSON.stringify(payload)});
      }
      true;
    `);
  }, [isMapReady]);

  const injectRecords = useCallback((shouldFit = true) => {
    if (!webviewRef.current || !isMapReady) {
      return;
    }

    const hasLiveRecord = records?.some((record) => record.isLive);
    const signature = getRecordsSignature(records, mode, selectedRecordId, shouldFit);
    if (signature === lastInjectSignatureRef.current) {
      return;
    }

    const payload = {
      records: serializeRecords(records),
      mode,
      selectedRecordId,
      shouldFit,
    };

    if (!hasLiveRecord) {
      clearTimeout(injectThrottleTimerRef.current);
      injectThrottleTimerRef.current = null;
      pendingInjectRef.current = null;
      lastInjectSignatureRef.current = signature;
      performInject(payload);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastLiveInjectAtRef.current;
    if (elapsed >= LIVE_MAP_INJECT_THROTTLE_MS || shouldFit) {
      clearTimeout(injectThrottleTimerRef.current);
      injectThrottleTimerRef.current = null;
      pendingInjectRef.current = null;
      lastLiveInjectAtRef.current = now;
      lastInjectSignatureRef.current = signature;
      performInject(payload);
      return;
    }

    pendingInjectRef.current = { payload, signature };
    if (!injectThrottleTimerRef.current) {
      injectThrottleTimerRef.current = setTimeout(() => {
        const pending = pendingInjectRef.current;
        injectThrottleTimerRef.current = null;
        pendingInjectRef.current = null;
        if (!pending) {
          return;
        }
        lastLiveInjectAtRef.current = Date.now();
        lastInjectSignatureRef.current = pending.signature;
        performInject(pending.payload);
      }, LIVE_MAP_INJECT_THROTTLE_MS - elapsed);
    }
  }, [isMapReady, mode, performInject, records, selectedRecordId]);

  const handleMessage = useCallback((event) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload.type === 'ready') {
        clearTimeout(readyTimerRef.current);
        setIsMapReady(true);
        setLoadError('');
        return;
      }
      if (payload.type === 'error') {
        setLoadError(payload.message || 'Kakao 뮤직지도를 불러오지 못했습니다.');
        return;
      }
      if (payload.type === 'recordPress') {
        onRecordPress?.(payload.id || '');
      }
    } catch (error) {
      // WebView 내부 지도 이벤트 외 메시지는 무시한다.
    }
  }, [onRecordPress]);

  useEffect(() => {
    if (!canRenderMap || !mapUrl) {
      return undefined;
    }

    setIsMapReady(false);
    setLoadError('');
    clearTimeout(readyTimerRef.current);
    readyTimerRef.current = setTimeout(() => {
      setLoadError('지도 로딩 시간이 초과되었습니다. Kakao Developers 설정과 Hosting 배포 상태를 확인하세요.');
    }, 12000);

    return () => clearTimeout(readyTimerRef.current);
  }, [canRenderMap, mapUrl]);

  useEffect(() => () => {
    clearTimeout(injectThrottleTimerRef.current);
    clearTimeout(readyTimerRef.current);
  }, []);

  useEffect(() => {
    const hasLiveRecord = records?.some((record) => record.isLive);
    const shouldFit = hasLiveRecord ? !hasFittedLiveRecordRef.current : true;
    injectRecords(shouldFit);
    if (hasLiveRecord) {
      hasFittedLiveRecordRef.current = true;
    } else {
      hasFittedLiveRecordRef.current = false;
    }
  }, [injectRecords, records]);

  if (!canRenderMap) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Kakao Maps API 키가 필요합니다</Text>
        <Text style={styles.fallbackText}>
          뮤직지도를 실제 지도 위에 표시하려면 EXPO_PUBLIC_KAKAO_MAPS_API_KEY 설정이 필요합니다.
        </Text>
      </View>
    );
  }

  if (!mapUrl) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>지도 Hosting URL이 필요합니다</Text>
        <Text style={styles.fallbackText}>
          EXPO_PUBLIC_KAKAO_MAPS_BASE_URL에 music-map.html이 배포된 Firebase Hosting 주소를 설정해주세요.
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
          <Text style={styles.errorBody}>지도 URL: {normalizedBaseUrl}/music-map.html</Text>
        </View>
      ) : null}
    </View>
  );
}

export default React.memo(KakaoMusicMap);

const styles = StyleSheet.create({
  container: {
    height: 520,
    overflow: 'hidden',
    backgroundColor: '#05070A',
  },
  webview: {
    flex: 1,
    backgroundColor: '#05070A',
  },
  errorOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 18,
    padding: 12,
    backgroundColor: 'rgba(10,10,10,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 119, 119, 0.55)',
  },
  errorTitle: {
    color: MAP_UI.error,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 5,
  },
  errorBody: {
    color: MAP_UI.textSoft,
    fontSize: 11,
    lineHeight: 16,
  },
  fallback: {
    height: 520,
    padding: 20,
    backgroundColor: MAP_UI.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: MAP_UI.border,
    justifyContent: 'center',
  },
  fallbackTitle: {
    color: MAP_UI.text,
    fontSize: 16,
    fontWeight: '800',
  },
  fallbackText: {
    color: MAP_UI.textSoft,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
});
