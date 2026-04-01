import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { authApi, clearCsrfToken, type User } from '../lib/api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  oidcEnabled: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [oidcEnabled, setOidcEnabled] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await authApi.me();
      setUser(data.user);
      setOidcEnabled(data.oidcEnabled);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await authApi.login(username, password);
    // Session was regenerated on login; clear cached CSRF token so the next
    // mutation fetches a fresh one bound to the new session.
    clearCsrfToken();
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    clearCsrfToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, oidcEnabled, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
