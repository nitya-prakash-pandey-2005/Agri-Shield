import { Queue, Worker, Job } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const satelliteQueue = new Queue('satellite-ingest', { 
    connection,
    defaultJobOptions: {
        attempts: 2,
    }
});

const worker = new Worker('satellite-ingest', async (job: Job) => {
  console.log(`[Worker: Satellite Ingest] Processing job ${job.id}`);
  const { region, targetDate } = job.data;
  
  try {
      console.log(`[Worker: Satellite Ingest] Simulating Sentinel-2 imagery ingestion for ${region} on ${targetDate}`);
      
      // Simulate long-running data processing task
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`[Worker: Satellite Ingest] Completed NDVI extraction for ${region}`);
      return { success: true, recordsProcessed: 1250 };
  } catch (error) {
      console.error(`[Worker: Satellite Ingest] Failed job ${job.id}:`, error);
      throw error;
  }
}, { connection, autorun: false });

export const startSatelliteWorker = () => {
    if (process.env.ENABLE_WORKERS === 'true') {
        worker.run();
        console.log('[Worker: Satellite Ingest] Started');
    } else {
        console.log('[Worker: Satellite Ingest] Disabled');
    }
};
