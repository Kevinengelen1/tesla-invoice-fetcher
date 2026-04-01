import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { requireAdmin } from '../auth/guards.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { UserRepo } from '../db/repositories/user.repo.js';

const roleSchema = z.enum(['admin', 'user']);

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(100),
  display_name: z.string().trim().max(200).optional().or(z.literal('')),
  password: z.string().min(8).max(200),
  role: roleSchema.default('user'),
});

const updateUserSchema = z.object({
  display_name: z.string().trim().max(200).optional().nullable(),
  role: roleSchema.optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(200),
});

const userIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

function createBadRequestError(message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

function serializeUser(user: {
  id: number;
  username: string;
  display_name: string | null;
  role: 'admin' | 'user';
  password_hash: string | null;
  oidc_sub: string | null;
  created_at: string;
  updated_at: string;
}) {
  let authType: 'local' | 'oidc' | 'mixed' = 'local';

  if (user.password_hash && user.oidc_sub) {
    authType = 'mixed';
  } else if (user.oidc_sub) {
    authType = 'oidc';
  }

  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    authType,
    hasPassword: Boolean(user.password_hash),
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

async function ensureNotLastAdmin(userRepo: UserRepo, userId: number) {
  const users = await userRepo.findAll();
  const targetUser = users.find((user) => user.id === userId);

  if (!targetUser || targetUser.role !== 'admin') {
    return;
  }

  const adminCount = users.filter((user) => user.role === 'admin').length;
  if (adminCount <= 1) {
    throw createBadRequestError('At least one admin account must remain');
  }
}

export function createUserRoutes(userRepo: UserRepo): Router {
  const router = Router();

  router.get('/', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const users = await userRepo.findAll();
    res.json({ users: users.map(serializeUser) });
  }));

  router.post('/', requireAdmin, validate(createUserSchema), asyncHandler(async (req: Request, res: Response) => {
    const { username, display_name, password, role } = req.body;
    const existingUser = await userRepo.findByUsername(username);

    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await userRepo.create({
      username,
      password_hash: passwordHash,
      display_name: display_name || undefined,
      role,
    });

    res.status(201).json({ user: serializeUser(user) });
  }));

  router.put('/:id', requireAdmin, validate(userIdSchema, 'params'), validate(updateUserSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.id as unknown as number;
    const existingUser = await userRepo.findById(userId);

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.body.role && req.body.role !== existingUser.role) {
      await ensureNotLastAdmin(userRepo, existingUser.id);
    }

    const user = await userRepo.update(userId, {
      display_name: Object.prototype.hasOwnProperty.call(req.body, 'display_name')
        ? req.body.display_name || null
        : undefined,
      role: req.body.role,
    });

    res.json({ user: serializeUser(user) });
  }));

  router.post('/:id/password', requireAdmin, validate(userIdSchema, 'params'), validate(resetPasswordSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.id as unknown as number;
    const existingUser = await userRepo.findById(userId);

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (existingUser.oidc_sub && !existingUser.password_hash) {
      return res.status(400).json({ error: 'Password reset is only available for local accounts' });
    }

    const passwordHash = await bcrypt.hash(req.body.password, 12);
    await userRepo.updatePassword(existingUser.id, passwordHash);
    const user = await userRepo.findById(existingUser.id);
    res.json({ user: serializeUser(user!) });
  }));

  router.delete('/:id', requireAdmin, validate(userIdSchema, 'params'), asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.id as unknown as number;
    const existingUser = await userRepo.findById(userId);

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.user!.id === existingUser.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    await ensureNotLastAdmin(userRepo, existingUser.id);
    await userRepo.delete(existingUser.id);

    res.json({ ok: true });
  }));

  return router;
}