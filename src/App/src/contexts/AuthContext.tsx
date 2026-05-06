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
      return null;
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload) || payload.length === 0) {
      return null;
    }
    const claims = payload[0].user_claims || [];
    const emailFromClaims =
      claims.find((c: any) => c.typ === 'preferred_username')?.val ||
      claims.find((c: any) => c.typ === 'email')?.val ||
      claims.find((c: any) => c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress')?.val ||
      claims.find((c: any) => c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn')?.val ||
      payload[0].user_id || '';
    const user: AuthUser = {
      userName: claims.find((c: any) => c.typ === 'name')?.val || '',
      userEmail: emailFromClaims,
      userId:
        claims.find(
          (c: any) => c.typ === 'http://schemas.microsoft.com/identity/claims/objectidentifier',
        )?.val || '',
    };
    return user;
  } catch {
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
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(window.location.pathname);
  }, []);

  const logout = useCallback(() => {
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
