import { supabase } from '../db/supabase.js';
import { getAthleteResults } from '../storage/supabase.js';
import { sendNotification } from './index.js';

export interface WatchlistNotification {
  id: string;
  watchlistItemId: string;
  notificationType: 'new_result' | 'benchmark' | 'rank_change';
  thresholdValue: string | null;
  enabled: boolean;
}

export interface WatchlistItem {
  id: string;
  watchlistId: string;
  watchedAthleteId: string;
}

/**
 * Check watchlists for new results and send notifications
 */
export async function checkWatchlistNotifications(): Promise<{
  checked: number;
  notificationsSent: number;
}> {
  let checked = 0;
  let notificationsSent = 0;

  try {
    // Get all enabled notifications
    const { data: notifications, error } = await supabase
      .from('watchlist_notifications')
      .select(`
        *,
        watchlist_items!inner (
          id,
          watchlist_id,
          watched_athlete_id,
          watchlists!inner (
            id,
            athlete_id,
            name,
            athletes!athlete_id (
              user_id
            )
          )
        )
      `)
      .eq('enabled', true);

    if (error) {
      throw new Error(`Failed to get notifications: ${error.message}`);
    }

    if (!notifications || notifications.length === 0) {
      return { checked: 0, notificationsSent: 0 };
    }

    // Group notifications by watchlist item
    const itemMap = new Map<string, any[]>();
    for (const notif of notifications) {
      const item = (notif as any).watchlist_items;
      if (!item) continue;

      const itemId = item.id;
      if (!itemMap.has(itemId)) {
        itemMap.set(itemId, []);
      }
      itemMap.get(itemId)!.push(notif);
    }

    // Check each watched athlete
    for (const [itemId, notifs] of itemMap.entries()) {
      checked++;
      
      // Get the first notification to get athlete info
      const firstNotif = notifs[0] as any;
      const item = firstNotif.watchlist_items;
      const watchedAthleteId = item.watched_athlete_id;
      const watchlist = item.watchlists;
      const ownerUserId = watchlist.athletes?.user_id;

      if (!ownerUserId) continue;

      // Get recent results for watched athlete (last 24 hours)
      const recentResults = await getRecentResults(watchedAthleteId, 24);

      if (recentResults.length === 0) continue;

      // Check each notification type
      for (const notif of notifs) {
        const sent = await checkAndSendNotification(notif, recentResults, watchlist, ownerUserId);
        if (sent) {
          notificationsSent++;
        }
      }
    }

    return { checked, notificationsSent };
  } catch (error) {
    console.error('Error checking watchlist notifications:', error);
    return { checked, notificationsSent };
  }
}

/**
 * Get recent results for an athlete (within last N hours)
 */
async function getRecentResults(athleteId: string, hours: number): Promise<any[]> {
  const cutoffTime = new Date();
  cutoffTime.setHours(cutoffTime.getHours() - hours);

  const results = await getAthleteResults(athleteId);
  
  return results.filter((result) => {
    const resultDate = new Date(result.created_at);
    return resultDate >= cutoffTime;
  });
}

/**
 * Check notification condition and send if met
 */
async function checkAndSendNotification(
  notification: any,
  recentResults: any[],
  watchlist: any,
  ownerUserId: string
): Promise<boolean> {
  const { notification_type, threshold_value } = notification;
  const item = notification.watchlist_items;
  const watchedAthleteId = item.watched_athlete_id;

  switch (notification_type) {
    case 'new_result':
      // Send notification for any new result
      if (recentResults.length > 0) {
        const latestResult = recentResults[0];
        const message = `${item.watchlists.name}: New result from ${latestResult.name || 'athlete'} - ${latestResult.finish_time || 'N/A'}`;
        await sendWatchlistNotification(ownerUserId, message, watchlist.name);
        return true;
      }
      break;

    case 'benchmark':
      // Check if any result meets the threshold
      if (threshold_value) {
        const thresholdSeconds = parseTimeToSeconds(threshold_value);
        if (thresholdSeconds !== null) {
          for (const result of recentResults) {
            const resultSeconds = parseTimeToSeconds(result.finish_time);
            if (resultSeconds !== null && resultSeconds < thresholdSeconds) {
              const message = `${watchlist.name}: ${result.name || 'Athlete'} achieved benchmark! ${result.finish_time} (threshold: ${threshold_value})`;
              await sendWatchlistNotification(ownerUserId, message, watchlist.name);
              return true;
            }
          }
        }
      }
      break;

    case 'rank_change':
      // TODO: Implement rank change detection (requires tracking previous ranks)
      break;
  }

  return false;
}

/**
 * Send watchlist notification
 * TODO: Extend notification system to support user-specific notifications
 * For now, we'll log the notification and can extend to email/push later
 */
async function sendWatchlistNotification(
  userId: string,
  message: string,
  watchlistName: string
): Promise<void> {
  try {
    // Store notification in database for user to retrieve
    // TODO: Create user_notifications table for storing notifications
    console.log(`[Watchlist Notification] User ${userId}: [${watchlistName}] ${message}`);
    
    // For MVP, we can extend this to:
    // 1. Store in user_notifications table
    // 2. Send email if user has email notifications enabled
    // 3. Send push notification if user has push enabled
    // 4. Use existing WhatsApp system if user has WhatsApp number configured
  } catch (error) {
    console.error('Failed to send watchlist notification:', error);
  }
}

/**
 * Parse time string to seconds
 */
function parseTimeToSeconds(timeStr: string | null): number | null {
  if (!timeStr) return null;

  // Format: HH:MM:SS or MM:SS
  const parts = timeStr.split(':').map(Number);
  
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}
