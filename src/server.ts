import { app } from './app';
import { jobQueue } from './queue';
import { registerQueueMetrics } from './metrics';

const PORT = Number(process.env.PORT ?? 3000);

registerQueueMetrics(jobQueue);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});