import { randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// Session-based CSRF (Synchronizer Token Pattern).
// A random token is stored in the session and must be echoed back in the
// x-csrf-token request header for every mutation (non-GET/HEAD/OPTIONS) request.
// No separate CSRF cookie is needed, so there are no Secure-cookie conflicts.

export function generateToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function doubleCsrfProtection(req: Request, res: Response, next: NextFunction): void {
  const sessionToken = req.session.csrfToken;
  const headerToken = req.headers['x-csrf-token'];

  if (!sessionToken || !headerToken || sessionToken !== headerToken) {
    res.status(403).json({ error: 'invalid csrf token' });
    return;
  }
  next();
}
