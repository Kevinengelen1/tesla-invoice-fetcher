declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      role: 'admin' | 'user';
      display_name: string | null;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    teslaOAuthState?: string;
    teslaCodeVerifier?: string;
    teslaAccountId?: number;
    teslaOwnershipOAuthState?: string;
    teslaOwnershipCodeVerifier?: string;
    teslaOwnershipAccountId?: number;
    passport?: { user: number };
  }
}

export {};
