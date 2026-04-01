import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth/guards.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { UserRepo } from '../db/repositories/user.repo.js';
import { config } from '../config.js';
import { RequestHandler } from 'express';

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export function createAuthRoutes(userRepo: UserRepo, authLimiter: RequestHandler): Router {
  const router = Router();

  router.post('/login', authLimiter, validate(loginSchema), (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('local', (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ error: info?.message ?? 'Invalid credentials' });

      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        // Explicitly save session so MySQL async store flushes before the
        // browser makes the next authenticated request.
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          res.json({ user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name } });
        });
      });
    })(req, res, next);
  });

  router.post('/logout', (req: Request, res: Response) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie('tif.sid');
        res.json({ ok: true });
      });
    });
  });

  router.get('/me', (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      return res.json({ user: null, oidcEnabled: config.oidc.enabled });
    }
    res.json({
      user: {
        id: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        display_name: req.user!.display_name,
      },
      oidcEnabled: config.oidc.enabled,
    });
  });

  router.post('/change-password', requireAuth, validate(changePasswordSchema), asyncHandler(async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body;
    const user = await userRepo.findById(req.user!.id);
    if (!user || !user.password_hash) {
      return res.status(400).json({ error: 'Cannot change password for OIDC-only accounts' });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await userRepo.updatePassword(user.id, hash);
    res.json({ ok: true });
  }));

  return router;
}
