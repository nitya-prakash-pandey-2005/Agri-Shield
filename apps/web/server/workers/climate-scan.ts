import { Queue, Worker, Job } from 'bullmq';

// In a real app, this connects to Redis.
// We'll stub it out for the hackathon so it runs without requiring a Redis server locally.
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const climateScanQueue = new Queue('climate-scan', { 
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
    }
});

// Worker
const worker = new Worker('climate-scan', async (job: Job) => {
  console.log(`[Worker: Climate Scan] Processing job ${job.id}`);
  const { farmId, lat, lon } = job.data;
  
  try {
      // 1. Fetch latest weather and soil data via ML API
      console.log(`[Worker: Climate Scan] Fetching ML API predictions for farm ${farmId} at ${lat}, ${lon}`);
      
      // In real implementation:
      // const res = await fetch(`http://localhost:8000/api/v1/flood-risk/predict?lat=${lat}&lon=${lon}`);
      // const data = await res.json();
      
      // Simulate API response processing
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log(`[Worker: Climate Scan] Completed analysis for farm ${farmId}`);
      return { success: true, timestamp: new Date().toISOString() };
  } catch (error) {
      console.error(`[Worker: Climate Scan] Failed job ${job.id}:`, error);
      throw error;
  }
}, { connection, autorun: false });

export const startClimateScanWorker = () => {
    // Only run if Redis is configured or in specific environments
    if (process.env.ENABLE_WORKERS === 'true') {
        worker.run();
        console.log('[Worker: Climate Scan] Started');
    } else {
        console.log('[Worker: Climate Scan] Disabled (set ENABLE_WORKERS=true to run)');
    }
};
