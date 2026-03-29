import React, { createContext, useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';

export const LocationContext = createContext(null);

export function LocationProvider({ children }) {
  const [location, setLocation] = useState(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [weather, setWeather] = useState(null);

  const requestPermissions = useCallback(async () => {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') return false;
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    setHasPermission(true);
    return bg === 'granted';
  }, []);

  useEffect(() => {
    let subscription;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setHasPermission(true);
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 20,
          timeInterval: 10000,
        },
        (loc) => setLocation(loc.coords)
      );
    })();
    return () => subscription?.remove();
  }, []);

  return (
    <LocationContext.Provider value={{ location, hasPermission, weather, requestPermissions }}>
      {children}
    </LocationContext.Provider>
  );
}
