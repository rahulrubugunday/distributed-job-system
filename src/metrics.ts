import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import type { Queue } from 'bullmq';

// Node process metrics: CPU, memory, event loop lag, GC
collectDefaultMetrics();

// Worker: jobs finished, by outcome
export const jobsProcessed = new Counter({
  name: 'jobs_processed_total',
  help: 'Total jobs processed by workers, by final status',
  labelNames: ['status'] as const,
});

// Worker: how long each job took (seconds)
export const jobDuration = new Histogram({
  name: 'job_duration_seconds',
  help: 'Time from job start to finish in seconds',
  buckets: [0.5, 1, 2.5, 5, 5.25, 5.5, 6, 7.5, 10, 30, 60],
});

// API: request latency, labelled by route PATTERN (not raw URL)
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

// API only: queue depth, read from Redis each time Prometheus scrapes
export function registerQueueMetrics(queue: Queue) {
  new Gauge({
    name: 'queue_jobs',
    help: 'Jobs in the BullMQ queue by state',
    labelNames: ['state'] as const,
    async collect() {
      const counts = await queue.getJobCounts(
        'waiting', 'active', 'delayed', 'failed', 'completed',
      );
      for (const [state, count] of Object.entries(counts)) {
        this.set({ state }, count);
      }
    },
  });
}

export { register };