import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

interface AuthUser {
  userName: string;
  userEmail: string;
  userId: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

async function fetchEasyAuthUser(): Promise<AuthUser | null> {
  try {
    const response = await fetch('/.auth/me');
    if (!response.ok) {
      console.log('[Auth] /.auth/me returned non-OK status:', response.status);
      return null;
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload) || payload.length === 0) {
      console.log('[Auth] /.auth/me returned empty payload');
      return null;
    }
    const claims = payload[0].user_claims || [];
    const user: AuthUser = {
      userName: claims.find((c: any) => c.typ === 'name')?.val || '',
      userEmail: payload[0].user_id || '',
      userId:
        claims.find(
          (c: any) => c.typ === 'http://schemas.microsoft.com/identity/claims/objectidentifier',
        )?.val || '',
    };
    console.log('[Auth] User authenticated:', user.userName || user.userEmail);
    return user;
  } catch (error) {
    console.log('[Auth] Failed to fetch /.auth/me (expected in local dev):', error);
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchEasyAuthUser()
      .then((userInfo) => setUser(userInfo))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(() => {
    console.log('[Auth] Login initiated: redirecting to /.auth/login/aad');
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(window.location.pathname);
  }, []);

  const logout = useCallback(() => {
    console.log('[Auth] Logout initiated: redirecting to /.auth/logout');
    window.location.href = '/.auth/logout?post_logout_redirect_uri=' + encodeURIComponent('/');
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!user, user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export default AuthContext;
