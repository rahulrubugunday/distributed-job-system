import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { jobQueue } from '../src/queue';
import { describe, test, expect, afterAll } from '@jest/globals';

const validJob = {
  type: 'REPORT_GENERATION',
  payload: { reportType: 'monthly', startDate: '2026-10-01', endDate: '2026-10-31' },
};

afterAll(async () => {
  await jobQueue.close();
  await pool.end();
});

describe('Health', () => {
  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('Submit a job', () => {
  test('valid job returns 202 and a jobId', async () => {
    const res = await request(app).post('/api/jobs').send(validJob);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
    expect(res.body.status).toBe('PENDING');
  });

  test('missing fields returns 400', async () => {
    const res = await request(app).post('/api/jobs').send({});
    expect(res.status).toBe(400);
  });

  test('same idempotency key returns the same job', async () => {
    const key = `test-${Date.now()}`;
    const first = await request(app).post('/api/jobs').set('Idempotency-Key', key).send(validJob);
    const second = await request(app).post('/api/jobs').set('Idempotency-Key', key).send(validJob);

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.jobId).toBe(first.body.jobId);
  });
});

describe('Get a job', () => {
  test('existing job returns 200', async () => {
    const created = await request(app).post('/api/jobs').send(validJob);
    const res = await request(app).get(`/api/jobs/${created.body.jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.jobId);
  });

  test('invalid ID returns 400', async () => {
    const res = await request(app).get('/api/jobs/abc');
    expect(res.status).toBe(400);
  });

  test('unknown ID returns 404', async () => {
    const res = await request(app).get('/api/jobs/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('Cancel a job', () => {
  test('pending job can be cancelled, then returns 409', async () => {
    const created = await request(app).post('/api/jobs').send(validJob);

    const cancel = await request(app).delete(`/api/jobs/${created.body.jobId}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');

    const again = await request(app).delete(`/api/jobs/${created.body.jobId}`);
    expect(again.status).toBe(409);
  });
});