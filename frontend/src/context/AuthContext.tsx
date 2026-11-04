import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch, setAccessToken, attemptSilentRefresh } from '../api/client';

export interface UserProfile {
  id: string;
  email: string;
  role: 'CUSTOMER' | 'CREDIT_ANALYST' | 'SECURITY_ADMIN';
  ssnLastFour?: string | null;
}

interface AuthContextValue {
  user: UserProfile | null;
  isInitializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, ssn: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // On page load/refresh, silently restore session via HttpOnly Refresh Cookie
  useEffect(() => {
    let mounted = true;
    async function restoreSession() {
      const ok = await attemptSilentRefresh();
      if (ok && mounted) {
        try {
          const profileRes = await apiFetch<{ user: UserProfile }>('/vault/profile');
          if (mounted) setUser(profileRes.user);
        } catch {
          setAccessToken(null);
        }
      }
      if (mounted) setIsInitializing(false);
    }
    restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await apiFetch<{ accessToken: string; user: UserProfile }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
  };

  const register = async (email: string, password: string, ssn: string) => {
    await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, ssn }),
    });
    // Automatically log in after registration
    await login(email, password);
  };

  const logout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      // Always wipe in-memory token and React state immediately
      setAccessToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isInitializing, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}