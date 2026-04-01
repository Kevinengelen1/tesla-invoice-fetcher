import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateCronExpression, startScheduler, stopScheduler, reloadScheduler } from '../src/services/scheduler.service.js';
import { config } from '../src/config.js';

describe('scheduler.service', () => {
  afterEach(() => {
    stopScheduler();
    vi.restoreAllMocks();
  });

  it('accepts a valid cron expression', () => {
    expect(validateCronExpression('0 6 * * *')).toEqual({ valid: true });
  });

  it('rejects an invalid cron expression', () => {
    const result = validateCronExpression('not-a-cron');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('reloads the scheduler with the last orchestrator instance', () => {
    vi.spyOn(config.schedule, 'autoFetchEnabled', 'get').mockReturnValue(true);
    vi.spyOn(config.schedule, 'cron', 'get').mockReturnValue('0 6 * * *');

    const orchestrator = {
      run: vi.fn().mockResolvedValue(undefined),
    } as any;

    startScheduler(orchestrator);
    reloadScheduler();

    expect(orchestrator.run).not.toHaveBeenCalled();
  });
});