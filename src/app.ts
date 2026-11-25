import express from 'express';
import { pool } from './db';
import { jobQueue } from './queue';


export const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/jobs', async (req, res) => {
  const { type, payload } = req.body;
  const idempotencyKey = req.header('Idempotency-Key') ?? null;

  if (!type || !payload) {
    res.status(400).json({ error: 'type and payload are required' });
    return;
  }

  const insert = await pool.query(
    `INSERT INTO jobs (type, payload, idempotency_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, status`,
    [type, JSON.stringify(payload), idempotencyKey]
  );

  // Key already used: return the existing job
  if (insert.rowCount === 0) {
    const existing = await pool.query(
      'SELECT id, status FROM jobs WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    const job = existing.rows[0];
    res.status(200).json({
      jobId: job.id,
      status: job.status,
      message: 'Duplicate request, returning existing job',
    });
    return;
  }

  const job = insert.rows[0];

  try {
    await jobQueue.add(type, { jobId: job.id }, { jobId: job.id });
  } catch (err) {
    console.error(`Could not queue job ${job.id}, reconciler will retry:`, err);
  }

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    message: 'Job submitted successfully',
  });
});

app.delete('/api/jobs/:id', async (req, res) => {
  const { id } = req.params;

  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: 'Invalid job ID format' });
    return;
  }

  // Only cancel if it's STILL pending
  const result = await pool.query(
    "UPDATE jobs SET status = 'CANCELLED' WHERE id = $1 AND status = 'PENDING' RETURNING id",
    [id]
  );

  if (result.rowCount === 0) {
    const existing = await pool.query('SELECT status FROM jobs WHERE id = $1', [id]);
    if (existing.rowCount === 0) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.status(409).json({ error: `Cannot cancel a job that is ${existing.rows[0].status}` });
    return;
  }

  // Best effort: also remove it from the queue
  try {
    await jobQueue.remove(id);
  } catch (err) {
    console.warn(`Could not remove job ${id} from queue:`, err);
  }

  res.json({ jobId: id, status: 'CANCELLED' });
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get('/api/jobs/:id', async (req, res) => {
  const { id } = req.params;

  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: 'Invalid job ID format' });
    return;
  }

  const result = await pool.query(
    'SELECT id, type, payload, status, created_at FROM jobs WHERE id = $1',
    [id]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json(result.rows[0]);
});
