import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

const UI = {
  card: '#151313',
  peach: '#FFD4CC',
  peachStrong: '#FFC8B8',
  text: '#FFF1EC',
  textSoft: '#D9C6C0',
  muted: '#9E908D',
  border: 'rgba(255, 212, 204, 0.42)',
};

const TARGET_PADDING = 10;
const TOOLTIP_HORIZONTAL_MARGIN = 22;
const TOOLTIP_ESTIMATED_HEIGHT = 216;

function normalizeLayout(layout, screenWidth, screenHeight) {
  if (!layout) return null;

  const x = Math.max(8, layout.x - TARGET_PADDING);
  const y = Math.max(8, layout.y - TARGET_PADDING);
  const width = Math.min(screenWidth - x - 8, Math.max(56, layout.width + TARGET_PADDING * 2));
  const height = Math.min(screenHeight - y - 8, Math.max(48, layout.height + TARGET_PADDING * 2));

  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function getTooltipTop(targetLayout, placement, screenHeight) {
  if (!targetLayout || placement === 'center') {
    return Math.max(96, Math.round(screenHeight / 2 - TOOLTIP_ESTIMATED_HEIGHT / 2));
  }

  if (placement === 'top') {
    return Math.max(72, targetLayout.y - TOOLTIP_ESTIMATED_HEIGHT - 18);
  }

  const bottomTop = targetLayout.y + targetLayout.height + 18;
  if (bottomTop + TOOLTIP_ESTIMATED_HEIGHT < screenHeight - 24) {
    return bottomTop;
  }
  return Math.max(72, targetLayout.y - TOOLTIP_ESTIMATED_HEIGHT - 18);
}

export default function SpotlightGuide({ visible, steps = [], onFinish }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [targetLayout, setTargetLayout] = useState(null);
  const currentStep = steps[currentIndex] || null;
  const isLastStep = currentIndex >= steps.length - 1;

  useEffect(() => {
    if (visible) {
      setCurrentIndex(0);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !currentStep) return undefined;

    setTargetLayout(null);
    const timeoutId = setTimeout(() => {
      const node = currentStep.targetRef?.current;
      if (!node?.measureInWindow) {
        return;
      }

      try {
        node.measureInWindow((x, y, measuredWidth, measuredHeight) => {
          setTargetLayout(normalizeLayout({
            x,
            y,
            width: measuredWidth,
            height: measuredHeight,
          }, screenWidth, screenHeight));
        });
      } catch {
        setTargetLayout(null);
      }
    }, 90);

    return () => clearTimeout(timeoutId);
  }, [currentIndex, currentStep, screenHeight, screenWidth, visible]);

  const tooltipStyle = useMemo(() => {
    const top = getTooltipTop(targetLayout, currentStep?.placement, screenHeight);
    return {
      top,
      left: TOOLTIP_HORIZONTAL_MARGIN,
      right: TOOLTIP_HORIZONTAL_MARGIN,
    };
  }, [currentStep?.placement, screenHeight, targetLayout]);

  const finishGuide = () => {
    onFinish?.();
  };

  const handleNext = () => {
    if (isLastStep) {
      finishGuide();
      return;
    }
    setCurrentIndex((index) => index + 1);
  };

  if (!visible || steps.length === 0 || !currentStep) {
    return null;
  }

  const radius = Math.min(30, Math.max(18, (targetLayout?.height || 72) / 3));

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={finishGuide}>
      <View style={styles.overlay}>
        <Svg width={screenWidth} height={screenHeight} style={StyleSheet.absoluteFillObject}>
          <Defs>
            <Mask id="spotlightMask">
              <Rect x="0" y="0" width={screenWidth} height={screenHeight} fill="white" />
              {targetLayout ? (
                <Rect
                  x={targetLayout.x}
                  y={targetLayout.y}
                  width={targetLayout.width}
                  height={targetLayout.height}
                  rx={radius}
                  ry={radius}
                  fill="black"
                />
              ) : null}
            </Mask>
          </Defs>
          <Rect
            x="0"
            y="0"
            width={screenWidth}
            height={screenHeight}
            fill="rgba(0,0,0,0.80)"
            mask="url(#spotlightMask)"
          />
        </Svg>

        {targetLayout ? (
          <View
            pointerEvents="none"
            style={[
              styles.highlight,
              {
                left: targetLayout.x,
                top: targetLayout.y,
                width: targetLayout.width,
                height: targetLayout.height,
                borderRadius: radius,
              },
            ]}
          />
        ) : null}

        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleNext} />

        <View style={[styles.tooltip, tooltipStyle]}>
          <Text style={styles.stepCount}>{currentIndex + 1}/{steps.length}</Text>
          <Text style={styles.title}>{currentStep.title}</Text>
          <Text style={styles.description}>{currentStep.description}</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.skipButton} activeOpacity={0.82} onPress={finishGuide}>
              <Text style={styles.skipText}>건너뛰기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nextButton} activeOpacity={0.88} onPress={handleNext}>
              <Text style={styles.nextText}>{isLastStep ? '시작하기' : '다음'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  highlight: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: UI.peach,
    shadowColor: UI.peach,
    shadowOpacity: 0.72,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
    borderRadius: 24,
    padding: 20,
    shadowColor: UI.peach,
    shadowOpacity: 0.24,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  stepCount: {
    color: UI.muted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  title: {
    color: UI.text,
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 9,
  },
  description: {
    color: UI.textSoft,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  buttonRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  skipButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    color: UI.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  nextButton: {
    minHeight: 46,
    paddingHorizontal: 22,
    borderRadius: 18,
    backgroundColor: UI.peachStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: {
    color: '#17110F',
    fontSize: 15,
    fontWeight: '900',
  },
});
