import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../../infrastructure/config/env';
import { ReconciliationService } from './reconciliation.service';

const QUEUE = 'maintenance';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * BullMQ scheduler for platform maintenance jobs. Today: the daily device reconciliation. Job handlers are
 * idempotent and carry no tenant data (platform scope). Runs only where WORKERS_ENABLED is true.
 */
@Injectable()
export class MaintenanceQueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceQueueService.name);
  private connections: IORedis[] = [];
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly reconciliation: ReconciliationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit() {
    if (!this.env.WORKERS_ENABLED) return;
    // BullMQ requires maxRetriesPerRequest=null on its connections.
    const make = () => {
      const c = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
      this.connections.push(c);
      return c;
    };
    const prefix = this.env.REDIS_KEY_PREFIX ? `${this.env.REDIS_KEY_PREFIX}bull` : 'bull';
    this.queue = new Queue(QUEUE, { connection: make(), prefix });
    await this.queue.upsertJobScheduler('reconcile-devices-daily', { every: DAY_MS }, { name: 'reconcile-devices', opts: { removeOnComplete: 20, removeOnFail: 50 } });
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        if (job.name === 'reconcile-devices') await this.reconciliation.run();
      },
      { connection: make(), concurrency: 1, prefix },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`Maintenance job ${job?.name} failed: ${err.message}`));
    this.logger.log('Maintenance queue started (daily device reconciliation scheduled)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    for (const c of this.connections) c.disconnect();
  }
}
