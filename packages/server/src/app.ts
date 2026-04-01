import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { config, injectSettingsRepo } from './config.js';
import { runMigrations } from './db/migrate.js';
import type { DbAdapter } from './db/adapter.js';
import { UserRepo } from './db/repositories/user.repo.js';
import { VehicleRepo } from './db/repositories/vehicle.repo.js';
import { InvoiceRepo } from './db/repositories/invoice.repo.js';
import { FetchRunRepo } from './db/repositories/fetch-run.repo.js';
import { SettingRepo } from './db/repositories/setting.repo.js';
import { setupPassport } from './auth/passport-setup.js';
import { createSessionMiddleware } from './auth/session.js';
import { setupOidcRoutes } from './auth/oidc.js';
import { bootstrapAdmin } from './auth/admin-bootstrap.js';
import { doubleCsrfProtection, generateToken } from './auth/csrf.js';
import { TeslaTokenManager } from './tesla/tesla-auth.js';
import { TeslaClient } from './tesla/tesla-client.js';
import { InvoiceOrchestrator } from './tesla/invoice-orchestrator.js';
import { createApiRouter } from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { createApiLimiter, createAuthLimiter } from './middleware/rate-limiter.js';
import { startScheduler } from './services/scheduler.service.js';
import { logStream } from './services/log-stream.service.js';
import { FetchJobService } from './services/fetch-job.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp(adapter: DbAdapter) {
  const app = express();

  // Log which database is in use
  if (adapter.dialect === 'mysql') {
    logStream.info(`Database: MySQL (${process.env.MYSQL_DATABASE ?? 'tesla_invoices'}@${process.env.MYSQL_HOST ?? 'localhost'})`);
  } else {
    logStream.info(`Database: SQLite (${process.env.DATABASE_PATH ?? './data/tesla-invoices.sqlite'})`);
  }

  // Run migrations
  await runMigrations(adapter);

  // Create repositories
  const userRepo = new UserRepo(adapter);
  const vehicleRepo = new VehicleRepo(adapter);
  const invoiceRepo = new InvoiceRepo(adapter);
  const fetchRunRepo = new FetchRunRepo(adapter);
  const settingRepo = new SettingRepo(adapter);
  const apiLimiter = createApiLimiter(adapter);
  const authLimiter = createAuthLimiter(adapter);

  // Populate setting cache so getSetting() works synchronously
  await settingRepo.load();

  // Inject settings repo into config system
  injectSettingsRepo(settingRepo);

  // Bootstrap admin user
  await bootstrapAdmin(userRepo);

  // Create Tesla services
  const tokenManager = new TeslaTokenManager(adapter);
  const teslaClient = new TeslaClient(tokenManager);
  const orchestrator = new InvoiceOrchestrator(teslaClient, invoiceRepo, vehicleRepo, fetchRunRepo);
  const fetchJobs = new FetchJobService(orchestrator, fetchRunRepo);

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: config.isProduction ? undefined : false,
  }));
  app.use(cors({
    origin: config.isProduction ? config.baseUrl : true,
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Session
  app.use(createSessionMiddleware());

  // Passport
  const passport = setupPassport(userRepo);
  app.use(passport.initialize());
  app.use(passport.session());

  // CSRF - apply to mutation routes only, skip for SSE and auth callbacks
  app.use('/api', (req, res, next) => {
    // Skip CSRF for GET/HEAD/OPTIONS, SSE streams, and OAuth callbacks
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path.includes('/callback')) return next();
    if (req.path === '/auth/login') return next();
    doubleCsrfProtection(req, res, next);
  });

  // CSRF token endpoint
  app.get('/api/csrf-token', (req, res) => {
    const token = generateToken(req, res);
    res.json({ token });
  });

  // Request logging
  app.use(requestLogger);

  // Rate limiting
  app.use('/api', apiLimiter);

  // OIDC routes (set up before API router)
  if (config.oidc.enabled) {
    setupOidcRoutes(app, userRepo);
  }

  // API routes
  app.use('/api', createApiRouter({
    userRepo,
    vehicleRepo,
    invoiceRepo,
    fetchRunRepo,
    settingRepo,
    tokenManager,
    fetchJobs,
    authLimiter,
  }));

  // Serve static client files in production
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  // Error handler
  app.use(errorHandler);

  // Start scheduler
  startScheduler(fetchJobs);

  logStream.info('Application initialized');

  return { app, orchestrator, tokenManager, fetchJobs };
}
