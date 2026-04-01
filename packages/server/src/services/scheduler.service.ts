import { CronJob } from 'cron';
import { config } from '../config.js';
import { logStream } from './log-stream.service.js';
import { FetchJobService } from './fetch-job.service.js';

let currentJob: CronJob | null = null;
let currentFetchJobs: FetchJobService | null = null;

export function validateCronExpression(expression: string): { valid: boolean; error?: string } {
  if (!expression.trim()) {
    return { valid: false, error: 'Cron expression is required when auto-fetch is enabled' };
  }

  try {
    const probe = new CronJob(expression, () => undefined, null, false);
    probe.stop();
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid cron expression',
    };
  }
}

export function startScheduler(fetchJobs: FetchJobService) {
  currentFetchJobs = fetchJobs;
  stopScheduler();

  if (!config.schedule.autoFetchEnabled || !config.schedule.cron) {
    logStream.info('Auto-fetch scheduler not enabled');
    return;
  }

  try {
    currentJob = new CronJob(config.schedule.cron, async () => {
      logStream.info('Scheduled fetch triggered');
      try {
        const result = await fetchJobs.start({ source: 'scheduled' });
        if (!result.accepted) {
          logStream.warn('Scheduled fetch skipped', { reason: result.reason });
        }
      } catch (err) {
        logStream.error('Scheduled fetch failed', { error: String(err) });
      }
    });
    currentJob.start();
    logStream.info(`Scheduler started with cron: ${config.schedule.cron}`);
  } catch (err) {
    logStream.error('Failed to start scheduler', { error: String(err) });
  }
}

export function stopScheduler() {
  if (currentJob) {
    currentJob.stop();
    currentJob = null;
    logStream.info('Scheduler stopped');
  }
}

export function reloadScheduler() {
  if (!currentFetchJobs) {
    return;
  }

  startScheduler(currentFetchJobs);
}

export function isSchedulerRunning(): boolean {
  return currentJob?.running ?? false;
}
