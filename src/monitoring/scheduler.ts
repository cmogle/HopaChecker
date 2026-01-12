import cron from 'node-cron';
import { getAllMonitoredEndpoints, type MonitoredEndpoint } from '../storage/monitoring.js';
import { monitorEndpoint } from './endpoint-monitor.js';

let schedulerRunning = false;
const scheduledTasks = new Map<string, cron.ScheduledTask>();

/**
 * Start the monitoring scheduler
 * Checks all enabled endpoints at their configured intervals
 */
export function startMonitoringScheduler(): void {
  if (schedulerRunning) {
    console.log('[Scheduler] Already running');
    return;
  }

  console.log('[Scheduler] Starting monitoring scheduler...');
  schedulerRunning = true;

  // Load and schedule all enabled endpoints
  loadAndScheduleEndpoints();

  // Refresh endpoint list every hour (in case new ones are added)
  cron.schedule('0 * * * *', () => {
    console.log('[Scheduler] Refreshing endpoint list...');
    loadAndScheduleEndpoints();
  });

  // Check watchlist notifications every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('[Scheduler] Checking watchlist notifications...');
    try {
      const { checkWatchlistNotifications } = await import('../notifications/watchlist-notifications.js');
      const result = await checkWatchlistNotifications();
      console.log(`[Scheduler] Checked ${result.checked} watchlists, sent ${result.notificationsSent} notifications`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Scheduler] Error checking watchlist notifications: ${errorMessage}`);
    }
  });
}

/**
 * Stop the monitoring scheduler
 */
export function stopMonitoringScheduler(): void {
  console.log('[Scheduler] Stopping monitoring scheduler...');
  schedulerRunning = false;

  for (const [endpointId, task] of scheduledTasks) {
    task.stop();
    scheduledTasks.delete(endpointId);
  }
}

/**
 * Load enabled endpoints and schedule checks
 */
async function loadAndScheduleEndpoints(): Promise<void> {
  try {
    const endpoints = await getAllMonitoredEndpoints(true); // Only enabled

    // Remove tasks for endpoints that no longer exist or are disabled
    for (const [endpointId, task] of scheduledTasks) {
      const stillExists = endpoints.some((e) => e.id === endpointId);
      if (!stillExists) {
        task.stop();
        scheduledTasks.delete(endpointId);
        console.log(`[Scheduler] Removed task for endpoint ${endpointId}`);
      }
    }

    // Schedule checks for each endpoint
    for (const endpoint of endpoints) {
      if (!scheduledTasks.has(endpoint.id)) {
        scheduleEndpointCheck(endpoint);
      }
    }

    console.log(`[Scheduler] Monitoring ${endpoints.length} endpoint(s)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Scheduler] Error loading endpoints: ${errorMessage}`);
  }
}

/**
 * Schedule checks for a specific endpoint
 */
function scheduleEndpointCheck(endpoint: MonitoredEndpoint): void {
  if (!endpoint.enabled) {
    return;
  }

  // Calculate cron expression based on interval
  // For MVP, we'll use simple intervals: 5, 10, 15, 30, 60 minutes
  const interval = endpoint.checkIntervalMinutes || 5;
  let cronExpression: string;

  if (interval >= 60) {
    // Hourly or less frequent
    const hours = Math.floor(interval / 60);
    cronExpression = `0 */${hours} * * *`;
  } else if (interval >= 1) {
    // Every N minutes
    cronExpression = `*/${interval} * * * *`;
  } else {
    // Default to every 5 minutes
    cronExpression = '*/5 * * * *';
  }

  const task = cron.schedule(
    cronExpression,
    async () => {
      console.log(`[Scheduler] Checking endpoint: ${endpoint.name} (${endpoint.endpointUrl})`);
      try {
        const result = await monitorEndpoint(endpoint);
        if (result.stateChanged) {
          console.log(
            `[Scheduler] Status changed for ${endpoint.name}: ${result.wentUp ? 'UP' : 'DOWN'}`
          );
          // Here you could add notification logic if needed
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Scheduler] Error checking ${endpoint.name}: ${errorMessage}`);
      }
    },
    {
      scheduled: true,
      timezone: 'UTC',
    }
  );

  scheduledTasks.set(endpoint.id, task);
  console.log(
    `[Scheduler] Scheduled ${endpoint.name} to check every ${interval} minute(s) (cron: ${cronExpression})`
  );
}

/**
 * Manually trigger check for an endpoint (outside of schedule)
 */
export async function triggerEndpointCheck(endpointId: string): Promise<void> {
  const { getMonitoredEndpoint } = await import('../storage/monitoring.js');
  const endpoint = await getMonitoredEndpoint(endpointId);

  if (!endpoint) {
    throw new Error(`Endpoint ${endpointId} not found`);
  }

  if (!endpoint.enabled) {
    throw new Error(`Endpoint ${endpointId} is disabled`);
  }

  await monitorEndpoint(endpoint);
}
