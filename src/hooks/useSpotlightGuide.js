import { useCallback, useEffect, useState } from 'react';
import {
  hasSeenSpotlightGuide,
  markSpotlightGuideSeen,
} from '../services/spotlightGuideService';

export default function useSpotlightGuide(storageKey) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;

    hasSeenSpotlightGuide(storageKey).then((hasSeen) => {
      if (isMounted && !hasSeen) {
        setVisible(true);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [storageKey]);

  const finish = useCallback(async () => {
    setVisible(false);
    await markSpotlightGuideSeen(storageKey);
  }, [storageKey]);

  return {
    visible,
    finish,
  };
}
