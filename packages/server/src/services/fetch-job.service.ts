import { FetchRunRepo } from '../db/repositories/fetch-run.repo.js';
import { InvoiceOrchestrator } from '../tesla/invoice-orchestrator.js';
import { logStream } from './log-stream.service.js';

export interface FetchJobRequest {
  source: 'manual' | 'scheduled';
  dryRun?: boolean;
  vins?: string[];
}

export interface FetchJobSnapshot extends FetchJobRequest {
  runId: number;
  startedAt: string;
}

export class FetchJobService {
  private currentJob: Promise<unknown> | null = null;
  private currentSnapshot: FetchJobSnapshot | null = null;
  private starting = false;

  constructor(
    private orchestrator: InvoiceOrchestrator,
    private fetchRunRepo: FetchRunRepo,
  ) {}

  isRunning(): boolean {
    return this.currentJob !== null || this.starting;
  }

  getSnapshot(): FetchJobSnapshot | null {
    return this.currentSnapshot;
  }

  async start(request: FetchJobRequest): Promise<{ accepted: boolean; runId?: number; reason?: string }> {
    if (this.isRunning()) {
      return { accepted: false, reason: 'A fetch is already running' };
    }

    this.starting = true;

    try {
      const run = await this.fetchRunRepo.create(!!request.dryRun);
      this.currentSnapshot = {
        ...request,
        dryRun: !!request.dryRun,
        vins: request.vins,
        runId: run.id,
        startedAt: new Date().toISOString(),
      };

      this.currentJob = this.orchestrator.run({
        dryRun: request.dryRun,
        vins: request.vins,
        runId: run.id,
      }).finally(() => {
        this.currentJob = null;
        this.currentSnapshot = null;
        this.starting = false;
      });

      logStream.info('Fetch job accepted', {
        source: request.source,
        runId: run.id,
        dryRun: !!request.dryRun,
        vins: request.vins ?? [],
      });

      return { accepted: true, runId: run.id };
    } catch (error) {
      this.currentJob = null;
      this.currentSnapshot = null;
      this.starting = false;
      logStream.error('Failed to start fetch job', { error: String(error), source: request.source });
      throw error;
    }
  }
}