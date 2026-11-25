CREATE TYPE job_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       VARCHAR(50) NOT NULL,
  payload    JSONB NOT NULL,
  status     job_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
