// Admin page functionality

import { getCurrentUser, getSupabaseClient, isAuthenticated } from './auth.js';

const API_BASE = window.API_BASE || '/api';
let currentDuplicateCheck = null;
let currentEventSource = null; // For SSE progress streaming
let currentAnalysis = null; // For pre-scrape URL analysis

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

  // Add URL input listener for auto-analysis
  const urlInput = document.getElementById('scrape-url');
  if (urlInput) {
    let debounceTimer;
    urlInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (urlInput.value.trim().length > 10) {
          analyzeUrl();
        }
      }, 500);
    });
  }
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

      <div class="event-actions">
        <button class="btn-secondary btn-small" onclick="showDataQuality('${event.id}')">
          <span class="btn-icon">&#128202;</span> Data Quality
        </button>
        <button class="btn-secondary btn-small" onclick="findLinkedEvents('${event.id}')">
          <span class="btn-icon">&#128279;</span> Find Duplicates
        </button>
      </div>

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
          ${schema.fields.map(f => {
            const barClass = f.percentage >= 80 ? 'good' : f.percentage >= 50 ? 'warning' : 'poor';
            return `<li class="field-${barClass}">${escapeHtml(f.name)}: ${f.populated}/${f.total} (${f.percentage}%)</li>`;
          }).join('')}
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
 * Analyze URL before scraping
 */
export async function analyzeUrl() {
  const urlInput = document.getElementById('scrape-url');
  const analysisDiv = document.getElementById('url-analysis') || createAnalysisDiv();

  if (!urlInput) return;

  const url = urlInput.value.trim();
  if (!url) {
    analysisDiv.innerHTML = '';
    currentAnalysis = null;
    return;
  }

  try {
    analysisDiv.innerHTML = '<div class="analysis-loading"><span class="spinner"></span> Analyzing URL...</div>';

    const data = await apiCall('/admin/scrape/analyze', {
      method: 'POST',
      body: JSON.stringify({ eventUrl: url }),
    });

    currentAnalysis = data;

    if (!data.isValid) {
      analysisDiv.innerHTML = `
        <div class="analysis-result analysis-result--error">
          <div class="analysis-header">
            <span class="analysis-icon">&#10005;</span>
            <strong>URL Not Supported</strong>
          </div>
          <ul class="analysis-issues">
            ${data.issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
          </ul>
        </div>
      `;
      return;
    }

    const browserIndicator = data.requiresHeadlessBrowser
      ? '<span class="badge badge--warning">Requires Browser</span>'
      : '<span class="badge badge--success">Fast Mode</span>';

    analysisDiv.innerHTML = `
      <div class="analysis-result analysis-result--success">
        <div class="analysis-header">
          <span class="analysis-icon">&#10003;</span>
          <strong>URL Analyzed</strong>
          ${browserIndicator}
        </div>
        <div class="analysis-details">
          <div class="analysis-row">
            <span class="analysis-label">Organiser:</span>
            <span class="analysis-value">${escapeHtml(data.detectedOrganiser)}</span>
          </div>
          ${data.eventName ? `
            <div class="analysis-row">
              <span class="analysis-label">Event:</span>
              <span class="analysis-value">${escapeHtml(data.eventName)}</span>
            </div>
          ` : ''}
          ${data.eventDate ? `
            <div class="analysis-row">
              <span class="analysis-label">Date:</span>
              <span class="analysis-value">${escapeHtml(data.eventDate)}</span>
            </div>
          ` : ''}
          ${data.estimatedDistances.length > 0 ? `
            <div class="analysis-row">
              <span class="analysis-label">Distances:</span>
              <span class="analysis-value">${data.estimatedDistances.join(', ')}</span>
            </div>
          ` : ''}
          ${data.estimatedResultCount ? `
            <div class="analysis-row">
              <span class="analysis-label">Est. Results:</span>
              <span class="analysis-value">~${data.estimatedResultCount}</span>
            </div>
          ` : ''}
        </div>
        ${data.suggestions && data.suggestions.length > 0 ? `
          <div class="analysis-suggestions">
            <strong>Suggestions:</strong>
            <ul>${data.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
    `;
  } catch (error) {
    console.error('Error analyzing URL:', error);
    analysisDiv.innerHTML = `
      <div class="analysis-result analysis-result--warning">
        <div class="analysis-header">
          <span class="analysis-icon">&#9888;</span>
          Analysis unavailable
        </div>
        <p>Will analyze during scrape</p>
      </div>
    `;
  }
}

/**
 * Create analysis div if it doesn't exist
 */
function createAnalysisDiv() {
  const formGroup = document.querySelector('.admin-form .form-group');
  if (!formGroup) return document.createElement('div');

  const div = document.createElement('div');
  div.id = 'url-analysis';
  div.className = 'url-analysis-container';
  formGroup.appendChild(div);
  return div;
}

/**
 * Check for duplicate event
 */
export async function checkDuplicate() {
  const urlInput = document.getElementById('scrape-url');
  const statusDiv = document.getElementById('scrape-status');

  if (!urlInput || !statusDiv) return;

  const url = urlInput.value.trim();
  if (!url) {
    statusDiv.innerHTML = '<div class="error-message">Please enter an event URL</div>';
    return;
  }

  // Use the analysis if available
  if (currentAnalysis && currentAnalysis.isValid) {
    statusDiv.innerHTML = `
      <div class="info-message">
        Ready to scrape <strong>${escapeHtml(currentAnalysis.detectedOrganiser)}</strong> event.
        ${currentAnalysis.requiresHeadlessBrowser ? 'This will use the browser for JavaScript rendering.' : ''}
      </div>
    `;
  } else {
    statusDiv.innerHTML = '<div class="info-message">Duplicate check will be performed when scraping starts.</div>';
  }
}

/**
 * Show scrape progress indicator
 */
function showScrapeProgress(stage, message, details = {}) {
  const statusDiv = document.getElementById('scrape-status');
  if (!statusDiv) return;

  const stages = ['initializing', 'connecting', 'detecting_pages', 'scraping', 'validating', 'saving', 'complete'];
  const stageIndex = stages.indexOf(stage);
  const progressPercent = stage === 'complete' ? 100 : Math.max(5, (stageIndex / (stages.length - 1)) * 95);

  const stageLabels = {
    initializing: 'Initializing',
    connecting: 'Connecting',
    detecting_pages: 'Detecting Pages',
    scraping: 'Scraping',
    validating: 'Validating',
    saving: 'Saving',
    complete: 'Complete',
    error: 'Error'
  };

  const isError = stage === 'error';
  const isComplete = stage === 'complete';

  statusDiv.innerHTML = `
    <div class="scrape-progress ${isError ? 'scrape-progress--error' : ''} ${isComplete ? 'scrape-progress--complete' : ''}">
      <div class="scrape-progress__header">
        <span class="scrape-progress__stage">${stageLabels[stage] || stage}</span>
        ${!isError && !isComplete ? '<span class="scrape-progress__spinner"></span>' : ''}
        ${isComplete ? '<span class="scrape-progress__check">&#10003;</span>' : ''}
        ${isError ? '<span class="scrape-progress__x">&#10005;</span>' : ''}
      </div>
      <div class="scrape-progress__bar-container">
        <div class="scrape-progress__bar" style="width: ${progressPercent}%"></div>
      </div>
      <div class="scrape-progress__message">${escapeHtml(message)}</div>
      ${details.resultsCount !== undefined ? `<div class="scrape-progress__results">Results scraped: <strong>${details.resultsCount}</strong></div>` : ''}
      ${details.jobId ? `<div class="scrape-progress__jobid">Job ID: ${details.jobId}</div>` : ''}
      ${!isError && !isComplete ? '<div class="scrape-progress__hint">You can navigate away - scraping continues in the background</div>' : ''}
    </div>
  `;
}

/**
 * Show SSE scrape progress (enhanced version with more details)
 */
function showScrapeProgressSSE(progress) {
  const statusDiv = document.getElementById('scrape-status');
  if (!statusDiv) return;

  const stages = ['initializing', 'connecting', 'detecting_pages', 'scraping', 'validating', 'saving', 'complete'];
  const stageIndex = stages.indexOf(progress.stage);

  // Calculate progress percentage
  let progressPercent;
  if (progress.stage === 'complete') {
    progressPercent = 100;
  } else if (progress.stage === 'scraping' && progress.totalPages) {
    // More granular progress during scraping
    const scrapeProgress = progress.currentPage / progress.totalPages;
    progressPercent = 30 + (scrapeProgress * 50); // Scraping is 30-80%
  } else if (progress.percentComplete) {
    progressPercent = progress.percentComplete;
  } else {
    progressPercent = Math.max(5, (stageIndex / (stages.length - 1)) * 95);
  }

  const stageLabels = {
    initializing: 'Initializing',
    connecting: 'Connecting',
    detecting_pages: 'Detecting Pages',
    scraping: 'Scraping',
    validating: 'Validating',
    saving: 'Saving',
    complete: 'Complete',
    error: 'Error'
  };

  const isError = progress.stage === 'error';
  const isComplete = progress.stage === 'complete';

  // Build page progress indicator
  let pageProgress = '';
  if (progress.currentPage && progress.totalPages) {
    pageProgress = `<div class="scrape-progress__pages">Page ${progress.currentPage} of ${progress.totalPages}</div>`;
  }

  // Build validation info
  let validationInfo = '';
  if (progress.validation) {
    const validClass = progress.validation.isValid ? 'valid' : 'invalid';
    validationInfo = `
      <div class="scrape-progress__validation ${validClass}">
        <span>Quality Score: <strong>${progress.validation.completenessScore}%</strong></span>
        ${progress.validation.isValid ? '<span class="badge badge--success">Valid</span>' : '<span class="badge badge--warning">Review Needed</span>'}
      </div>
    `;
  }

  // Build distance indicator
  let distanceInfo = '';
  if (progress.currentDistance) {
    distanceInfo = `<div class="scrape-progress__distance">Distance: ${escapeHtml(progress.currentDistance)}</div>`;
  }

  statusDiv.innerHTML = `
    <div class="scrape-progress ${isError ? 'scrape-progress--error' : ''} ${isComplete ? 'scrape-progress--complete' : ''}">
      <div class="scrape-progress__header">
        <span class="scrape-progress__stage">${stageLabels[progress.stage] || progress.stage}</span>
        ${!isError && !isComplete ? '<span class="scrape-progress__spinner"></span>' : ''}
        ${isComplete ? '<span class="scrape-progress__check">&#10003;</span>' : ''}
        ${isError ? '<span class="scrape-progress__x">&#10005;</span>' : ''}
      </div>
      <div class="scrape-progress__bar-container">
        <div class="scrape-progress__bar" style="width: ${progressPercent}%"></div>
      </div>
      <div class="scrape-progress__message">${escapeHtml(progress.message)}</div>
      ${pageProgress}
      ${distanceInfo}
      <div class="scrape-progress__results">Results scraped: <strong>${progress.resultsScraped || 0}</strong></div>
      ${validationInfo}
      ${progress.eventId ? `<div class="scrape-progress__eventid">Event ID: ${progress.eventId}</div>` : ''}
      ${!isError && !isComplete ? '<div class="scrape-progress__hint">Live progress - you can navigate away</div>' : ''}
    </div>
  `;
}

/**
 * Start scraping with SSE progress streaming
 */
export async function startScrape() {
  const urlInput = document.getElementById('scrape-url');
  const organiserInput = document.getElementById('scrape-organiser');
  const statusDiv = document.getElementById('scrape-status');
  const startButton = document.querySelector('.admin-form .btn-primary');

  if (!urlInput || !statusDiv) return;

  const url = urlInput.value.trim();
  if (!url) {
    statusDiv.innerHTML = '<div class="error-message">Please enter an event URL</div>';
    return;
  }

  const organiser = organiserInput?.value.trim() ||
    (currentAnalysis?.detectedOrganiser !== 'unknown' ? currentAnalysis?.detectedOrganiser : undefined);
  const overwrite = currentDuplicateCheck?.isDuplicate || false;
  const useHeadlessBrowser = currentAnalysis?.requiresHeadlessBrowser || false;

  // Disable button during scrape
  if (startButton) {
    startButton.disabled = true;
    startButton.textContent = 'Scraping...';
  }

  // Close any existing SSE connection
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }

  try {
    // Stage 1: Initiated
    showScrapeProgress('initializing', 'Preparing to scrape...', { stage: 'initializing' });

    // Start the scrape job
    const data = await apiCall('/admin/scrape/start', {
      method: 'POST',
      body: JSON.stringify({
        eventUrl: url,
        organiser,
        overwrite,
        useHeadlessBrowser,
      }),
    });

    if (!data.success) {
      throw new Error(data.error || 'Failed to start scrape');
    }

    const jobId = data.jobId;

    // Connect to SSE for real-time progress
    const token = await getAuthToken();
    const sseUrl = `${API_BASE}/admin/scrape/${jobId}/progress`;

    currentEventSource = new EventSource(sseUrl);

    currentEventSource.onmessage = (event) => {
      try {
        const progress = JSON.parse(event.data);
        showScrapeProgressSSE(progress);

        // Handle completion
        if (progress.stage === 'complete' || progress.stage === 'error') {
          currentEventSource.close();
          currentEventSource = null;

          if (progress.stage === 'complete') {
            // Clear form
            urlInput.value = '';
            if (organiserInput) organiserInput.value = '';
            currentDuplicateCheck = null;
            currentAnalysis = null;

            // Clear analysis div
            const analysisDiv = document.getElementById('url-analysis');
            if (analysisDiv) analysisDiv.innerHTML = '';

            // Reload events
            setTimeout(() => {
              loadEventsSummary();
              loadFailedJobs();
            }, 2000);
          }

          // Re-enable button
          if (startButton) {
            startButton.disabled = false;
            startButton.textContent = 'Start Scrape';
          }
        }
      } catch (e) {
        console.error('Error parsing SSE message:', e);
      }
    };

    currentEventSource.onerror = (error) => {
      console.error('SSE error:', error);
      currentEventSource.close();
      currentEventSource = null;

      // Re-enable button
      if (startButton) {
        startButton.disabled = false;
        startButton.textContent = 'Start Scrape';
      }

      // Only show error if we haven't already shown complete
      const currentStatus = statusDiv.querySelector('.scrape-progress--complete');
      if (!currentStatus) {
        showScrapeProgress('error', 'Connection lost. Scraping may continue in background.');
      }
    };

  } catch (error) {
    console.error('Error starting scrape:', error);

    // Check if it's a duplicate error
    if (error.message.includes('Duplicate') || error.message.includes('409')) {
      try {
        const response = await fetch(`${API_BASE}/admin/scrape/start`, {
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
          statusDiv.innerHTML = '';
          return;
        }
      } catch (e) {
        // Fall through
      }
    }

    showScrapeProgress('error', error.message);

    // Re-enable button
    if (startButton) {
      startButton.disabled = false;
      startButton.textContent = 'Start Scrape';
    }
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
 * Show data quality report for an event
 */
export async function showDataQuality(eventId) {
  const modal = document.getElementById('quality-modal') || createQualityModal();
  const content = document.getElementById('quality-content');
  if (!modal || !content) return;

  try {
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="loading">Loading data quality report...</div>';

    const data = await apiCall(`/admin/events/${eventId}/quality`);
    const report = data.report;

    // Build field population chart
    const fieldRows = Object.entries(report.fieldPopulation)
      .sort((a, b) => b[1].percentage - a[1].percentage)
      .map(([field, data]) => {
        const barClass = data.percentage >= 80 ? 'bar--good' :
                        data.percentage >= 50 ? 'bar--warning' : 'bar--poor';
        return `
          <div class="quality-field">
            <span class="field-name">${escapeHtml(field)}</span>
            <div class="field-bar-container">
              <div class="field-bar ${barClass}" style="width: ${data.percentage}%"></div>
            </div>
            <span class="field-percent">${data.percentage}%</span>
          </div>
        `;
      }).join('');

    // Build sources list
    const sourcesList = report.sources.length > 0 ? report.sources.map(s => `
      <div class="source-item">
        <span class="source-name">${escapeHtml(s.organiser)}</span>
        <span class="source-count">${s.resultCount} results (${s.percentage}%)</span>
      </div>
    `).join('') : '<p>No source information available</p>';

    content.innerHTML = `
      <h2 class="modal-title">Data Quality Report</h2>

      <div class="quality-summary">
        <div class="quality-stat">
          <span class="stat-value">${report.totalResults}</span>
          <span class="stat-label">Total Results</span>
        </div>
        <div class="quality-stat">
          <span class="stat-value">${report.checkpointCoverage.resultsWithCheckpoints}</span>
          <span class="stat-label">With Checkpoints</span>
        </div>
        <div class="quality-stat">
          <span class="stat-value">${report.checkpointCoverage.averageCheckpointsPerResult.toFixed(1)}</span>
          <span class="stat-label">Avg Checkpoints</span>
        </div>
        <div class="quality-stat ${report.validationSummary.withErrorsCount > 0 ? 'stat--warning' : ''}">
          <span class="stat-value">${report.validationSummary.withErrorsCount}</span>
          <span class="stat-label">Validation Errors</span>
        </div>
      </div>

      <h3>Field Population</h3>
      <div class="quality-fields">
        ${fieldRows}
      </div>

      <h3>Data Sources</h3>
      <div class="quality-sources">
        ${sourcesList}
      </div>

      ${report.validationSummary.withErrorsCount > 0 ? `
        <h3>Validation Issues</h3>
        <div class="quality-errors">
          ${Object.entries(report.validationSummary.errorTypes).map(([field, count]) => `
            <div class="error-type">
              <span class="error-field">${escapeHtml(field)}</span>
              <span class="error-count">${count} errors</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  } catch (error) {
    console.error('Error loading quality report:', error);
    content.innerHTML = `<div class="error">Error: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Create quality modal if it doesn't exist
 */
function createQualityModal() {
  const modal = document.createElement('div');
  modal.id = 'quality-modal';
  modal.className = 'modal hidden';
  modal.onclick = (e) => { if (e.target === modal) closeQualityModal(); };
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close" onclick="closeQualityModal()">&times;</button>
      <div id="quality-content"></div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

/**
 * Close quality modal
 */
export function closeQualityModal(event) {
  const modal = document.getElementById('quality-modal');
  if (modal && (!event || event.target === modal)) {
    modal.classList.add('hidden');
  }
}

/**
 * Find potential duplicate events for linking
 */
export async function findLinkedEvents(eventId) {
  const modal = document.getElementById('link-modal') || createLinkModal();
  const content = document.getElementById('link-content');
  if (!modal || !content) return;

  try {
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="loading">Finding potential linked events...</div>';

    const data = await apiCall('/admin/events/link', {
      method: 'POST',
      body: JSON.stringify({ primaryEventId: eventId, autoDetect: true }),
    });

    if (!data.candidates || data.candidates.length === 0) {
      content.innerHTML = `
        <h2 class="modal-title">Link Events</h2>
        <p>No potential duplicates found for this event.</p>
        <p class="hint">Events must share the same date to be considered duplicates.</p>
      `;
      return;
    }

    content.innerHTML = `
      <h2 class="modal-title">Link Events</h2>
      <p>Found ${data.candidates.length} potential match(es):</p>
      <div class="link-candidates">
        ${data.candidates.map(c => `
          <div class="link-candidate">
            <div class="candidate-info">
              <strong>${escapeHtml(c.name)}</strong>
              <span class="candidate-organiser">${escapeHtml(c.organiser)}</span>
              <span class="candidate-date">${c.date}</span>
            </div>
            <button class="btn-primary btn-small" onclick="linkEvents('${eventId}', '${c.id}')">Link</button>
          </div>
        `).join('')}
      </div>
    `;
  } catch (error) {
    console.error('Error finding linked events:', error);
    content.innerHTML = `<div class="error">Error: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Link two events
 */
export async function linkEvents(primaryEventId, linkedEventId) {
  try {
    await apiCall('/admin/events/link', {
      method: 'POST',
      body: JSON.stringify({ primaryEventId, linkedEventId }),
    });

    alert('Events linked successfully!');
    closeLinkModal();

    // Optionally offer to reconcile
    if (confirm('Would you like to reconcile these events now?')) {
      await reconcileEvents(primaryEventId, linkedEventId);
    }
  } catch (error) {
    console.error('Error linking events:', error);
    alert(`Error: ${error.message}`);
  }
}

/**
 * Reconcile two linked events
 */
export async function reconcileEvents(primaryEventId, secondaryEventId) {
  const modal = document.getElementById('reconcile-modal') || createReconcileModal();
  const content = document.getElementById('reconcile-content');
  if (!modal || !content) return;

  try {
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="loading">Reconciling events... This may take a moment.</div>';

    const data = await apiCall('/admin/events/reconcile', {
      method: 'POST',
      body: JSON.stringify({ primaryEventId, secondaryEventId }),
    });

    const rec = data.reconciliation;

    content.innerHTML = `
      <h2 class="modal-title">Reconciliation Results</h2>

      <div class="reconcile-summary">
        <div class="reconcile-stat">
          <span class="stat-value">${rec.matchedCount}</span>
          <span class="stat-label">Matched</span>
        </div>
        <div class="reconcile-stat">
          <span class="stat-value">${rec.unmatchedFromPrimary}</span>
          <span class="stat-label">Unmatched (Primary)</span>
        </div>
        <div class="reconcile-stat">
          <span class="stat-value">${rec.unmatchedFromSecondary}</span>
          <span class="stat-label">Unmatched (Secondary)</span>
        </div>
        <div class="reconcile-stat ${rec.conflictCount > 0 ? 'stat--warning' : ''}">
          <span class="stat-value">${rec.conflictCount}</span>
          <span class="stat-label">Conflicts</span>
        </div>
      </div>

      <div class="reconcile-stats">
        <p><strong>Match Rate:</strong> ${rec.statistics.matchRate.toFixed(1)}%</p>
        ${rec.statistics.fieldsEnriched.length > 0 ? `
          <p><strong>Fields Enriched:</strong> ${rec.statistics.fieldsEnriched.join(', ')}</p>
        ` : ''}
      </div>

      ${data.sampleConflicts.length > 0 ? `
        <h3>Sample Conflicts (Review Needed)</h3>
        <div class="conflict-list">
          ${data.sampleConflicts.slice(0, 5).map(c => `
            <div class="conflict-item">
              <span class="conflict-field">${escapeHtml(c.field)}</span>
              <span class="conflict-values">
                "${escapeHtml(String(c.valueA))}" vs "${escapeHtml(String(c.valueB))}"
              </span>
              <span class="conflict-resolution">${c.resolution}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="reconcile-report">
        <h3>Full Report</h3>
        <pre>${escapeHtml(data.report)}</pre>
      </div>
    `;
  } catch (error) {
    console.error('Error reconciling events:', error);
    content.innerHTML = `<div class="error">Error: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Create link modal
 */
function createLinkModal() {
  const modal = document.createElement('div');
  modal.id = 'link-modal';
  modal.className = 'modal hidden';
  modal.onclick = (e) => { if (e.target === modal) closeLinkModal(); };
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close" onclick="closeLinkModal()">&times;</button>
      <div id="link-content"></div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

/**
 * Close link modal
 */
export function closeLinkModal(event) {
  const modal = document.getElementById('link-modal');
  if (modal && (!event || event.target === modal)) {
    modal.classList.add('hidden');
  }
}

/**
 * Create reconcile modal
 */
function createReconcileModal() {
  const modal = document.createElement('div');
  modal.id = 'reconcile-modal';
  modal.className = 'modal hidden';
  modal.onclick = (e) => { if (e.target === modal) closeReconcileModal(); };
  modal.innerHTML = `
    <div class="modal-content modal-content--wide">
      <button class="modal-close" onclick="closeReconcileModal()">&times;</button>
      <div id="reconcile-content"></div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

/**
 * Close reconcile modal
 */
export function closeReconcileModal(event) {
  const modal = document.getElementById('reconcile-modal');
  if (modal && (!event || event.target === modal)) {
    modal.classList.add('hidden');
  }
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Make functions available globally
window.loadEventsSummary = loadEventsSummary;
window.showEventDetails = showEventDetails;
window.closeEventDetailsModal = closeEventDetailsModal;
window.checkDuplicate = checkDuplicate;
window.analyzeUrl = analyzeUrl;
window.startScrape = startScrape;
window.closeDuplicateModal = closeDuplicateModal;
window.confirmOverwrite = confirmOverwrite;
window.loadFailedJobs = loadFailedJobs;
window.retryJob = retryJob;
window.retryJobWithEdit = retryJobWithEdit;
window.showDataQuality = showDataQuality;
window.closeQualityModal = closeQualityModal;
window.findLinkedEvents = findLinkedEvents;
window.linkEvents = linkEvents;
window.reconcileEvents = reconcileEvents;
window.closeLinkModal = closeLinkModal;
window.closeReconcileModal = closeReconcileModal;
