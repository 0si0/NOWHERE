import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';

const NativeNowherePlayer = requireOptionalNativeModule('NowherePlayer');
const emitter = NativeNowherePlayer ? new EventEmitter(NativeNowherePlayer) : null;

export const isNativeNowherePlayerAvailable = Boolean(NativeNowherePlayer);

export function addPlaybackStateListener(listener) {
  if (!emitter) {
    return { remove() {} };
  }
  return emitter.addListener('onPlaybackStateChanged', listener);
}

export function addScreenStateListener(listener) {
  if (!emitter) {
    return { remove() {} };
  }
  return emitter.addListener('onScreenStateChanged', listener);
}

export function addPlaybackNotificationPressedListener(listener) {
  if (!emitter) {
    return { remove() {} };
  }
  return emitter.addListener('onPlaybackNotificationPressed', listener);
}

export default NativeNowherePlayer;
