import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/guards.js';
import { logStream } from '../services/log-stream.service.js';

export function createLogRoutes(): Router {
  const router = Router();

  router.get('/recent', requireAuth, (_req: Request, res: Response) => {
    res.json(logStream.getRecentLogs());
  });

  router.get('/stream', requireAuth, (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send buffered history immediately on connect
    const history = logStream.getRecentLogs();
    for (const entry of history) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
    res.write('data: {"type":"connected"}\n\n');

    const onLog = (entry: any) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };

    logStream.on('log', onLog);

    req.on('close', () => {
      logStream.off('log', onLog);
    });
  });

  return router;
}
