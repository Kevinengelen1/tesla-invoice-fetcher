import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestAdapter } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { UserRepo } from '../src/db/repositories/user.repo.js';
import { createUserRoutes } from '../src/routes/users.routes.js';
import { errorHandler } from '../src/middleware/error-handler.js';

describe('users.routes', () => {
  let app: express.Express;
  let userRepo: UserRepo;
  let adminId: number;

  beforeEach(async () => {
    const adapter = createTestAdapter();
    await runMigrations(adapter);
    userRepo = new UserRepo(adapter);

    const admin = await userRepo.create({
      username: 'admin',
      password_hash: await bcrypt.hash('admin-pass-123', 12),
      role: 'admin',
      display_name: 'Admin',
    });
    adminId = admin.id;

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).isAuthenticated = () => true;
      req.user = {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        display_name: admin.display_name,
      };
      next();
    });
    app.use('/users', createUserRoutes(userRepo));
    app.use(errorHandler);
  });

  it('creates and lists a local user', async () => {
    const createResponse = await request(app)
      .post('/users')
      .send({
        username: 'operator',
        display_name: 'Operator',
        password: 'operator-pass-123',
        role: 'user',
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.user.username).toBe('operator');
    expect(createResponse.body.user.authType).toBe('local');
    expect(createResponse.body.user.hasPassword).toBe(true);

    const listResponse = await request(app).get('/users');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.users).toHaveLength(2);
  });

  it('prevents deleting the current admin account', async () => {
    const response = await request(app).delete(`/users/${adminId}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('cannot delete your own account');
  });

  it('prevents demoting the last remaining admin', async () => {
    const response = await request(app)
      .put(`/users/${adminId}`)
      .send({ role: 'user' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('At least one admin account must remain');
  });
});