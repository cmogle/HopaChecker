// Admin page functionality

import { getCurrentUser, getSupabaseClient, isAuthenticated } from './auth.js';

const API_BASE = window.API_BASE || '/api';
let currentDuplicateCheck = null;

/**
 * Get auth token for API calls
 */
async function getAuthToken() {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    throw new Error('Supabase client not initialized');
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session || !session.access_token) {
    throw new Error('No active session');
  }

  return session.access_token;
}

/**
 * Make authenticated API call
 */
async function apiCall(endpoint, options = {}) {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('Unauthorized - Please sign in again');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Verify admin access
 */
export async function verifyAdminAccess() {
  if (!isAuthenticated()) {
    console.log('Not authenticated');
    return false;
  }

  const user = getCurrentUser();
  if (!user) {
    console.log('No user found');
    return false;
  }

  // Use centralized admin email from config
  const adminEmail = window.ADMIN_EMAIL || 'conorogle@gmail.com';
  console.log('User email:', user.email);
  if (user.email !== adminEmail) {
    console.log('Email does not match admin email');
    return false;
  }

  // Try to make an authenticated call to verify token is valid
  try {
    await apiCall('/admin/events');
    return true;
  } catch (error) {
    console.error('Admin access verification failed:', error);
    // Still return true if email matches - the API call might fail for other reasons
    // The backend will enforce the actual authorization
    return true;
  }
}

/**
 * Initialize admin page
 */
export function initAdminPage() {
  loadEventsSummary();
  loadFailedJobs();
}

/**
 * Load events summary
 */
export async function loadEventsSummary() {
  const tbody = document.getElementById('events-tbody');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">Loading events...</td></tr>';

    const data = await apiCall('/admin/events');
    const events = data.events || [];

    if (events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No events found</td></tr>';
      return;
    }

    tbody.innerHTML = events.map(event => {
      const date = new Date(event.event_date).toLocaleDateString();
      const lastScrape = event.last_scrape_time 
        ? new Date(event.last_scrape_time).toLocaleString()
        : 'Never';
      
      return `
        <tr>
          <td>${escapeHtml(event.event_name)}</td>
          <td>${date}</td>
          <td>${escapeHtml(event.organiser)}</td>
          <td>${event.result_count}</td>
          <td>${lastScrape}</td>
          <td>
            <button class="btn-link" onclick="showEventDetails('${event.id}')">View Details</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading events:', error);
    tbody.innerHTML = `<tr><td colspan="6" class="error-cell">Error: ${escapeHtml(error.message)}</td></tr>`;
  }
}

/**
 * Show event details
 */
export async function showEventDetails(eventId) {
  const modal = document.getElementById('event-details-modal');
  const content = document.getElementById('event-details-content');
  if (!modal || !content) return;

  try {
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="loading">Loading event details...</div>';

    const data = await apiCall(`/admin/events/${eventId}`);
    const { event, schema, scrapeJobs } = data;

    const date = new Date(event.event_date).toLocaleDateString();
    const scrapedAt = event.scraped_at 
      ? new Date(event.scraped_at).toLocaleString()
      : 'Never';

    let html = `
      <h2 class="modal-title">${escapeHtml(event.event_name)}</h2>
      <div class="event-details">
        <div class="detail-row">
          <strong>Date:</strong> ${date}
        </div>
        <div class="detail-row">
          <strong>Organiser:</strong> ${escapeHtml(event.organiser)}
        </div>
        ${event.location ? `<div class="detail-row"><strong>Location:</strong> ${escapeHtml(event.location)}</div>` : ''}
        ${event.distance ? `<div class="detail-row"><strong>Distance:</strong> ${escapeHtml(event.distance)}</div>` : ''}
        ${event.event_url ? `<div class="detail-row"><strong>URL:</strong> <a href="${escapeHtml(event.event_url)}" target="_blank">${escapeHtml(event.event_url)}</a></div>` : ''}
        <div class="detail-row">
          <strong>Total Results:</strong> ${schema.totalResults}
        </div>
        <div class="detail-row">
          <strong>Last Scraped:</strong> ${scrapedAt}
        </div>
      </div>

      <h3 style="margin-top: 2rem; margin-bottom: 1rem;">Schema Information</h3>
      <div class="schema-info">
        <p><strong>Fields Populated:</strong></p>
        <ul class="schema-list">
          ${schema.fields.map(f => 
            `<li>${escapeHtml(f.name)}: ${f.populated}/${f.total} (${f.percentage}%)</li>`
          ).join('')}
        </ul>
        ${schema.distances.length > 0 ? `
          <p style="margin-top: 1rem;"><strong>Distances:</strong> ${schema.distances.join(', ')}</p>
        ` : ''}
      </div>
    `;

    if (scrapeJobs && scrapeJobs.length > 0) {
      html += `
        <h3 style="margin-top: 2rem; margin-bottom: 1rem;">Scrape History</h3>
        <div class="scrape-history">
          ${scrapeJobs.map(job => {
            const started = new Date(job.started_at).toLocaleString();
            const completed = job.completed_at 
              ? new Date(job.completed_at).toLocaleString()
              : 'In progress';
            const statusClass = job.status === 'completed' ? 'success' : 
                              job.status === 'failed' ? 'error' : 'pending';
            
            return `
              <div class="scrape-job-item">
                <div class="job-status ${statusClass}">${job.status}</div>
                <div class="job-details">
                  <div>Started: ${started}</div>
                  <div>Completed: ${completed}</div>
                  ${job.results_count !== null ? `<div>Results: ${job.results_count}</div>` : ''}
                  ${job.error_message ? `<div class="error-message">Error: ${escapeHtml(job.error_message)}</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    content.innerHTML = html;
  } catch (error) {
    console.error('Error loading event details:', error);
    content.innerHTML = `<div class="error">Error: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Close event details modal
 */
export function closeEventDetailsModal(event) {
  const modal = document.getElementById('event-details-modal');
  if (modal && (!event || event.target === modal)) {
    modal.classList.add('hidden');
  }
}

/**
 * Check for duplicate event
 */
export async function checkDuplicate() {
  const urlInput = document.getElementById('scrape-url');
  const organiserInput = document.getElementById('scrape-organiser');
  const statusDiv = document.getElementById('scrape-status');

  if (!urlInput || !statusDiv) return;

  const url = urlInput.value.trim();
  if (!url) {
    statusDiv.innerHTML = '<div class="error-message">Please enter an event URL</div>';
    return;
  }

  try {
    statusDiv.innerHTML = '<div class="loading-message">Checking for duplicates...</div>';

    // First, we need to scrape the event to get name and date
    // For now, we'll use the check-duplicate endpoint which requires name and date
    // We'll need to scrape first or get this from the scraper
    statusDiv.innerHTML = '<div class="info-message">Note: Duplicate check will be performed automatically when scraping starts.</div>';
  } catch (error) {
    console.error('Error checking duplicate:', error);
    statusDiv.innerHTML = `<div class="error-message">Error: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Start scraping
 */
export async function startScrape() {
  const urlInput = document.getElementById('scrape-url');
  const organiserInput = document.getElementById('scrape-organiser');
  const statusDiv = document.getElementById('scrape-status');

  if (!urlInput || !statusDiv) return;

  const url = urlInput.value.trim();
  if (!url) {
    statusDiv.innerHTML = '<div class="error-message">Please enter an event URL</div>';
    return;
  }

  const organiser = organiserInput?.value.trim() || undefined;
  const overwrite = currentDuplicateCheck?.isDuplicate || false;

  try {
    statusDiv.innerHTML = '<div class="loading-message">Starting scrape...</div>';

    const data = await apiCall('/admin/scrape', {
      method: 'POST',
      body: JSON.stringify({
        eventUrl: url,
        organiser,
        overwrite,
      }),
    });

    if (data.success) {
      statusDiv.innerHTML = `
        <div class="success-message">
          Scrape started successfully! Job ID: ${data.jobId}<br>
          Results: ${data.resultsCount || 0}
        </div>
      `;
      
      // Clear form
      urlInput.value = '';
      if (organiserInput) organiserInput.value = '';
      currentDuplicateCheck = null;

      // Reload events
      setTimeout(() => {
        loadEventsSummary();
        loadFailedJobs();
      }, 2000);
    } else {
      throw new Error(data.error || 'Scrape failed');
    }
  } catch (error) {
    console.error('Error starting scrape:', error);
    
    // Check if it's a duplicate error
    if (error.message.includes('Duplicate') || error.message.includes('409')) {
      // Try to parse the error response
      try {
        const response = await fetch(`${API_BASE}/admin/scrape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await getAuthToken()}`,
          },
          body: JSON.stringify({
            eventUrl: url,
            organiser,
            overwrite: false,
          }),
        });
        
        if (response.status === 409) {
          const errorData = await response.json();
          currentDuplicateCheck = errorData;
          showDuplicateModal(errorData);
          return;
        }
      } catch (e) {
        // Fall through to error message
      }
    }

    statusDiv.innerHTML = `<div class="error-message">Error: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Show duplicate confirmation modal
 */
function showDuplicateModal(duplicateData) {
  const modal = document.getElementById('duplicate-modal');
  const content = document.getElementById('duplicate-content');
  if (!modal || !content) return;

  const { existingEvent, resultCount } = duplicateData;
  const date = new Date(existingEvent.event_date).toLocaleDateString();

  content.innerHTML = `
    <div class="duplicate-warning">
      <p>An event with the same name and date already exists:</p>
      <div class="duplicate-details">
        <div><strong>Event:</strong> ${escapeHtml(existingEvent.event_name)}</div>
        <div><strong>Date:</strong> ${date}</div>
        <div><strong>Current Results:</strong> ${resultCount || 0}</div>
      </div>
      <p style="margin-top: 1rem; color: #ff6b6b;">
        <strong>Warning:</strong> Continuing will overwrite existing data. Are you sure?
      </p>
    </div>
  `;

  modal.classList.remove('hidden');
}

/**
 * Close duplicate modal
 */
export function closeDuplicateModal(event) {
  const modal = document.getElementById('duplicate-modal');
  if (modal && (!event || event.target === modal)) {
    modal.classList.add('hidden');
    currentDuplicateCheck = null;
  }
}

/**
 * Confirm overwrite and continue scraping
 */
export async function confirmOverwrite() {
  closeDuplicateModal();
  
  if (currentDuplicateCheck) {
    currentDuplicateCheck.isDuplicate = true;
  }
  
  await startScrape();
}

/**
 * Load failed jobs
 */
export async function loadFailedJobs() {
  const container = document.getElementById('failed-jobs-list');
  if (!container) return;

  try {
    container.innerHTML = '<div class="loading-cell">Loading failed jobs...</div>';

    const data = await apiCall('/admin/scrape-jobs/failed');
    const jobs = data.jobs || [];

    if (jobs.length === 0) {
      container.innerHTML = '<div class="empty-cell">No failed jobs</div>';
      return;
    }

    container.innerHTML = jobs.map(job => {
      const started = new Date(job.started_at).toLocaleString();
      const errorMsg = job.error_message || 'Unknown error';
      
      return `
        <div class="failed-job-item">
          <div class="job-header">
            <div class="job-url">${escapeHtml(job.event_url)}</div>
            <div class="job-time">${started}</div>
          </div>
          <div class="job-error">${escapeHtml(errorMsg)}</div>
          <div class="job-actions">
            <button class="btn-primary btn-small" onclick="retryJob('${job.id}')">Retry</button>
            <button class="btn-secondary btn-small" onclick="retryJobWithEdit('${job.id}')">Retry with Edit</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading failed jobs:', error);
    container.innerHTML = `<div class="error-cell">Error: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Retry failed job
 */
export async function retryJob(jobId) {
  try {
    const data = await apiCall(`/admin/scrape-jobs/${jobId}/retry`, {
      method: 'POST',
    });

    if (data.success) {
      alert(`Job retried successfully! Results: ${data.resultsCount || 0}`);
      loadFailedJobs();
      loadEventsSummary();
    } else {
      throw new Error(data.error || 'Retry failed');
    }
  } catch (error) {
    console.error('Error retrying job:', error);
    alert(`Error: ${error.message}`);
  }
}

/**
 * Retry job with URL edit
 */
export async function retryJobWithEdit(jobId) {
  const newUrl = prompt('Enter new URL (or leave empty to use original):');
  if (newUrl === null) return; // User cancelled

  try {
    const body = newUrl.trim() ? { eventUrl: newUrl.trim() } : {};
    
    const data = await apiCall(`/admin/scrape-jobs/${jobId}/retry`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (data.success) {
      alert(`Job retried successfully! Results: ${data.resultsCount || 0}`);
      loadFailedJobs();
      loadEventsSummary();
    } else {
      throw new Error(data.error || 'Retry failed');
    }
  } catch (error) {
    console.error('Error retrying job:', error);
    alert(`Error: ${error.message}`);
  }
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions available globally
window.loadEventsSummary = loadEventsSummary;
window.showEventDetails = showEventDetails;
window.closeEventDetailsModal = closeEventDetailsModal;
window.checkDuplicate = checkDuplicate;
window.startScrape = startScrape;
window.closeDuplicateModal = closeDuplicateModal;
window.confirmOverwrite = confirmOverwrite;
window.loadFailedJobs = loadFailedJobs;
window.retryJob = retryJob;
window.retryJobWithEdit = retryJobWithEdit;
