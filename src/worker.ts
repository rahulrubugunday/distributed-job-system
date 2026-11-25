import { Worker } from 'bullmq';
import fs from 'fs/promises';
import path from 'path';
import { pool } from './db';
import { connection, jobQueue } from './queue';

const RESULTS_DIR = path.join(process.cwd(), 'results');

const WORKER_NAME = process.env.WORKER_NAME ?? `worker-${process.pid}`;

const worker = new Worker(
    'jobs',
    async (bullJob) => {
    const { jobId } = bullJob.data;
    console.log(`[${WORKER_NAME}] Picked up job ${jobId}`);


    // 1. Mark as PROCESSING
    const claim = await pool.query(
        `UPDATE jobs SET status = 'PROCESSING', attempts = attempts + 1, started_at = now()
        WHERE id = $1 AND status IN ('PENDING', 'PROCESSING')
        RETURNING id`,
        [jobId]
    );

    if (claim.rowCount === 0) {
        console.log(`Skipping job ${jobId}, it was cancelled or already finished`);
        return;
    }

    // 2. Read the full job from Postgres
    const result = await pool.query('SELECT payload FROM jobs WHERE id = $1', [jobId]);
    const payload = result.rows[0].payload;
    if (payload.failTimes && bullJob.attemptsMade < payload.failTimes) {
        throw new Error(`Simulated failure (attempt ${bullJob.attemptsMade + 1})`);
    }

    // 3. Pretend this is slow work (5 seconds)
    const durationMs = payload.durationMs ?? 5000;
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    // 4. Generate the report as a CSV file
    const csv =
        'reportType,startDate,endDate,generatedAt\n' +
        `${payload.reportType},${payload.startDate},${payload.endDate},${new Date().toISOString()}\n`;

    await fs.mkdir(RESULTS_DIR, { recursive: true });
    await fs.writeFile(path.join(RESULTS_DIR, `${jobId}.csv`), csv);

    // 5. Mark as COMPLETED
    await pool.query(
        "UPDATE jobs SET status = 'COMPLETED', completed_at = now() WHERE id = $1",
        [jobId]
    );
    console.log(`[${WORKER_NAME}] Completed job ${jobId}`);
    },
    {
        connection,
        concurrency: Number(process.env.CONCURRENCY ?? 1),
    }
);

worker.on('failed', async (bullJob, err) => {
  if (!bullJob) return;

  const maxAttempts = bullJob.opts.attempts ?? 1;
  const isFinal = bullJob.attemptsMade >= maxAttempts;

  if (isFinal) {
    await pool.query(
      "UPDATE jobs SET status = 'FAILED', error_message = $2 WHERE id = $1",
      [bullJob.data.jobId, err.message]
    );
    console.error(`Job ${bullJob.data.jobId} FAILED for good after ${bullJob.attemptsMade} attempts`);
  } else {
    await pool.query(
      "UPDATE jobs SET status = 'PENDING', error_message = $2 WHERE id = $1",
      [bullJob.data.jobId, err.message]
    );
    console.warn(`Job ${bullJob.data.jobId} failed attempt ${bullJob.attemptsMade}, will retry`);
  }
});

worker.on('stalled', (jobId) => {
  console.warn(`Job ${jobId} stalled (its worker died), putting it back in the queue`);
});

console.log('Worker started, waiting for jobs...');

async function reconcile() {
  const result = await pool.query(
    "SELECT id, type FROM jobs WHERE status = 'PENDING' AND created_at < now() - interval '1 minute'"
  );
  for (const row of result.rows) {
    await jobQueue.add(row.type, { jobId: row.id }, { jobId: row.id });
  }
  if (result.rowCount) {
    console.log(`Reconciler re-queued ${result.rowCount} old PENDING job(s)`);
  }
}

const reconcileTimer = setInterval(() => {
  reconcile().catch((err) => console.error('Reconciler error:', err));
}, 30000);


let shuttingDown = false;



async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`${signal} received, finishing current job before stopping...`);
    clearInterval(reconcileTimer);

    await worker.close();
    await jobQueue.close();
    await pool.end();

    console.log('Worker stopped cleanly');
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));