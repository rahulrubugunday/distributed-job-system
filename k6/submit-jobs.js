import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://api:3000';

export const options = {
  scenarios: {
    submit: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 1),   // jobs per timeUnit
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: 5,
      maxVUs: 20,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],     // under 1% errors
    http_req_duration: ['p(95)<200'],   // API accepts jobs fast
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/api/jobs`,
    JSON.stringify({
        type: 'REPORT_GENERATION',
        payload: { reportType: __ENV.LABEL || 'loadtest', startDate: '2026-11-01', endDate: '2026-11-30' },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'status is 202': (r) => r.status === 202 });
}