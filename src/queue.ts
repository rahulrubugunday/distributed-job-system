import { Queue } from 'bullmq';

export const connection = { host: 'localhost', port: 6379 };

export const jobQueue = new Queue('jobs', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});