import { config } from './config.js';
import { createAdapter, closeAdapter } from './db/connection.js';
import { createApp } from './app.js';
import { logStream } from './services/log-stream.service.js';

async function main() {
  const adapter = await createAdapter();
  const { app } = await createApp(adapter);

  const server = app.listen(config.port, () => {
    logStream.info(`Tesla Invoice Fetcher running on port ${config.port}`);
    logStream.info(`Environment: ${config.nodeEnv}`);
    logStream.info(`Base URL: ${config.baseUrl}`);
  });

  server.on('error', async (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Stop the existing process or set PORT to a different value.`);
    } else {
      console.error('Failed to start server:', error);
    }

    await closeAdapter();
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = () => {
    logStream.info('Shutting down...');
    server.close(async () => {
      await closeAdapter();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
