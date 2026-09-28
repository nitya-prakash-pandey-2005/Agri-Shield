import { Queue, Worker, Job } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const notificationQueue = new Queue('notification-dispatch', { 
    connection,
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 } // retry faster for notifications
    }
});

const worker = new Worker('notification-dispatch', async (job: Job) => {
  console.log(`[Worker: Notification] Processing job ${job.id}`);
  const { userId, channels, message, severity } = job.data;
  
  try {
      console.log(`[Worker: Notification] Dispatching ${severity} alert to user ${userId} via ${channels.join(', ')}`);
      
      // Simulate Twilio / FCM API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (channels.includes('sms')) {
          console.log(`[Worker: Notification] Simulated SMS Sent: "${message.substring(0, 50)}..."`);
      }
      
      return { success: true, deliveredAt: new Date().toISOString() };
  } catch (error) {
      console.error(`[Worker: Notification] Failed job ${job.id}:`, error);
      throw error;
  }
}, { connection, autorun: false });

export const startNotificationWorker = () => {
    if (process.env.ENABLE_WORKERS === 'true') {
        worker.run();
        console.log('[Worker: Notification] Started');
    } else {
        console.log('[Worker: Notification] Disabled');
    }
};
