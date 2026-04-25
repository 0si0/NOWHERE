import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  getFirebaseRuntimeStatus,
  subscribeToAuthSession,
} from '../services/firebaseService';

export const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const runtimeStatus = getFirebaseRuntimeStatus();
  const [authUser, setAuthUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(runtimeStatus.configured);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!runtimeStatus.configured) {
      setIsLoading(false);
      return undefined;
    }

    let mounted = true;

    const unsubscribe = subscribeToAuthSession((snapshot) => {
      if (!mounted) return;
      setAuthUser(snapshot.user || null);
      setUserProfile(snapshot.profile || null);
      setError(snapshot.error || null);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [runtimeStatus.configured]);

  return (
    <SessionContext.Provider
      value={{
        authUser,
        userProfile,
        isLoading,
        error,
        isFirebaseConfigured: runtimeStatus.configured,
        missingConfigKeys: runtimeStatus.missingConfigKeys,
        useEmulators: runtimeStatus.useEmulators,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }

  return context;
}
