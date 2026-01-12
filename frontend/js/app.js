// Main application logic

import { setupScrollAnimations, setupHeaderScroll, scrollToSection, scrollToTop } from './animations.js';
import { initSearch } from './search.js';
import { initAuth, getCurrentUser, getUserId, isAuthenticated } from './auth.js';
import { handleStravaCallback, showMergeUI } from './claim.js';

const API_BASE = window.API_BASE || '/api';

/**
 * Initialize the application
 */
function initApp() {
  // Setup animations
  setupScrollAnimations();
  setupHeaderScroll();
  
  // Initialize search
  initSearch();
  
  // Initialize auth
  initAuth();
  
  // Check if we're returning from OAuth and need to show admin page
  // Wait a bit for auth to initialize
  setTimeout(() => {
    const hash = window.location.hash;
    const path = window.location.pathname;
    const normalizedPath = path.replace(/\/$/, '') || '/';
    const pendingAdminAccess = sessionStorage.getItem('pendingAdminAccess');
    
    if ((hash === '#/admin' || normalizedPath === '/admin' || pendingAdminAccess === 'true') && isAuthenticated()) {
      showAdminPage();
    }
  }, 500);
  
  // Load featured content
  loadFeaturedContent();
  
  // Setup mobile menu
  setupMobileMenu();
  
  // Setup routing
  setupRouting();
}

/**
 * Setup mobile menu toggle
 */
function setupMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mainNav = document.getElementById('main-nav');
  
  if (mobileMenuBtn && mainNav) {
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!mainNav.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        mainNav.classList.remove('open');
      }
    });
  }
}

/**
 * Toggle mobile menu
 */
export function toggleMobileMenu() {
  const mainNav = document.getElementById('main-nav');
  if (mainNav) {
    mainNav.classList.toggle('open');
  }
}

/**
 * Setup client-side routing
 */
function setupRouting() {
  // Handle hash changes
  window.addEventListener('hashchange', handleRoute);
  
  // Handle popstate (browser back/forward)
  window.addEventListener('popstate', handleRoute);
  
  // Handle initial route
  handleRoute();
}

/**
 * Handle route changes
 */
function handleRoute() {
  const hash = window.location.hash;
  const path = window.location.pathname;
  
  // Normalize path (remove trailing slash)
  const normalizedPath = path.replace(/\/$/, '') || '/';
  
  if (hash.startsWith('#/athlete/')) {
    const athleteId = hash.replace('#/athlete/', '');
    if (athleteId) {
      showAthleteProfile(athleteId);
    }
  } else if (hash === '#/admin' || normalizedPath === '/admin') {
    showAdminPage();
  } else {
    showLanding();
  }
}

/**
 * Show landing page
 */
export function showLanding() {
  window.location.hash = '';
  
  const hero = document.getElementById('hero');
  const searchSection = document.getElementById('search');
  const featuresSection = document.getElementById('features');
  const profileSection = document.getElementById('profile-section');
  const adminSection = document.getElementById('admin-section');
  
  if (hero) hero.classList.remove('hidden');
  if (searchSection) searchSection.classList.remove('hidden');
  if (featuresSection) featuresSection.classList.remove('hidden');
  if (profileSection) profileSection.classList.add('hidden');
  if (adminSection) adminSection.classList.add('hidden');
  
  // Scroll to top
  scrollToTop();
}

/**
 * Show admin page
 */
export async function showAdminPage() {
  // Set hash first so OAuth can redirect back to it
  window.location.hash = '#/admin';
  
  // Check authentication first
  if (!isAuthenticated()) {
    // Store that we're trying to access admin
    sessionStorage.setItem('pendingAdminAccess', 'true');
    showAuthModal();
    return;
  }

  // Clear pending admin access flag
  sessionStorage.removeItem('pendingAdminAccess');

  // Verify admin access
  const { verifyAdminAccess } = await import('./admin.js');
  const hasAccess = await verifyAdminAccess();
  
  if (!hasAccess) {
    alert('Access denied. Admin privileges required.');
    showLanding();
    return;
  }
  
  const hero = document.getElementById('hero');
  const searchSection = document.getElementById('search');
  const featuresSection = document.getElementById('features');
  const profileSection = document.getElementById('profile-section');
  const adminSection = document.getElementById('admin-section');
  
  if (hero) hero.classList.add('hidden');
  if (searchSection) searchSection.classList.add('hidden');
  if (featuresSection) featuresSection.classList.add('hidden');
  if (profileSection) profileSection.classList.add('hidden');
  if (adminSection) adminSection.classList.remove('hidden');
  
  // Initialize admin page
  const { initAdminPage } = await import('./admin.js');
  initAdminPage();
  
  // Scroll to top
  scrollToTop();
}

/**
 * Navigate to athlete profile
 */
export function navigateToProfile(athleteId) {
  window.location.hash = `#/athlete/${athleteId}`;
  showAthleteProfile(athleteId);
}

/**
 * Show athlete profile page
 */
async function showAthleteProfile(athleteId) {
  const hero = document.getElementById('hero');
  const searchSection = document.getElementById('search');
  const featuresSection = document.getElementById('features');
  const profileSection = document.getElementById('profile-section');
  const profileContent = document.getElementById('profile-content');
  
  // Hide landing sections
  if (hero) hero.classList.add('hidden');
  if (searchSection) searchSection.classList.add('hidden');
  if (featuresSection) featuresSection.classList.add('hidden');
  
  // Show profile section
  if (profileSection) {
    profileSection.classList.remove('hidden');
    
    // Show loading
    if (profileContent) {
      profileContent.innerHTML = '<div class="loading">Loading athlete profile...</div>';
    }
    
    // Load athlete data
    try {
      await loadAthleteProfile(athleteId);
    } catch (error) {
      console.error('Error loading profile:', error);
      if (profileContent) {
        profileContent.innerHTML = `
          <div class="error">
            <p>Failed to load athlete profile. Please try again.</p>
            <button class="btn-primary" onclick="showLanding()">Back to Search</button>
          </div>
        `;
      }
    }
  }
  
  // Scroll to top
  scrollToTop();
}

/**
 * Load athlete profile data
 */
async function loadAthleteProfile(athleteId) {
  const profileContent = document.getElementById('profile-content');
  if (!profileContent) return;
  
  try {
    // Fetch all athlete data in parallel
    const [athleteRes, resultsRes, statsRes, trendsRes] = await Promise.all([
      fetch(`${API_BASE}/athletes/${athleteId}`),
      fetch(`${API_BASE}/athletes/${athleteId}/results`),
      fetch(`${API_BASE}/athletes/${athleteId}/performance/stats`),
      fetch(`${API_BASE}/athletes/${athleteId}/performance/trends`)
    ]);
    
    if (!athleteRes.ok) {
      throw new Error('Failed to load athlete');
    }
    
    const athlete = await athleteRes.json();
    const results = await resultsRes.json();
    const stats = await statsRes.json();
    const trends = await trendsRes.json();
    
    // Render profile
    renderAthleteProfile(athlete.athlete, results.results || [], stats.stats, trends.trends || []);
  } catch (error) {
    console.error('Error loading athlete profile:', error);
    throw error;
  }
}

/**
 * Render athlete profile
 */
function renderAthleteProfile(athlete, results, stats, trends) {
  const profileContent = document.getElementById('profile-content');
  if (!profileContent) return;
  
  let html = `
    <div class="profile-header">
      <h1 class="profile-name">${escapeHtml(athlete.name)}</h1>
      <div class="profile-meta">
        ${athlete.gender ? `<span>${escapeHtml(athlete.gender)}</span>` : ''}
        ${athlete.country ? `<span> • ${escapeHtml(athlete.country)}</span>` : ''}
      </div>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-value">${stats.totalRaces || 0}</div>
        <div class="stat-card-label">Total Races</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${stats.personalBests?.fastestTime || 'N/A'}</div>
        <div class="stat-card-label">Personal Best</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${stats.categoryRankings?.bestRank || 'N/A'}</div>
        <div class="stat-card-label">Best Category Rank</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">
          ${getTrendIcon(stats.recentTrend)}
          ${stats.recentTrend || 'N/A'}
        </div>
        <div class="stat-card-label">Recent Trend</div>
      </div>
    </div>
  `;
  
  // Performance chart
  if (trends && trends.length > 0) {
    html += `
      <div class="chart-container">
        <canvas id="performance-chart"></canvas>
      </div>
    `;
  }
  
  // Results table
  if (results && results.length > 0) {
    html += `
      <div class="results-table">
        <h3 style="margin-bottom: 1rem; color: var(--text-primary);">Recent Results</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Finish Time</th>
              <th>Position</th>
              <th>Category Rank</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    results.slice(0, 10).forEach(result => {
      const date = new Date(result.created_at).toLocaleDateString();
      html += `
        <tr>
          <td>${date}</td>
          <td>${escapeHtml(result.finish_time || 'N/A')}</td>
          <td>${result.position || 'N/A'}</td>
          <td>${result.category_position || 'N/A'}</td>
          ${result.event_url ? `<td><a href="${escapeHtml(result.event_url)}" target="_blank" rel="noopener">View Source</a></td>` : '<td></td>'}
        </tr>
      `;
    });
    
    html += `
          </tbody>
        </table>
      </div>
    `;
  }
  
  profileContent.innerHTML = html;
  
  // Render chart if data available
  if (trends && trends.length > 0 && window.Chart) {
    renderPerformanceChart(trends);
  }
  
  // Add watchlist button if authenticated (replaces follow button)
  if (isAuthenticated()) {
    import('./watchlists.js').then(({ addWatchlistButton }) => {
      const profileHeader = document.querySelector('.profile-header');
      if (profileHeader) {
        addWatchlistButton(athlete.id, profileHeader);
      }
    });
    
    // Add merge UI if user has verified claim
    import('./claim.js').then(({ showMergeUI }) => {
      showMergeUI(athlete.id);
    });
  }
}

/**
 * Render performance chart
 */
function renderPerformanceChart(trends) {
  const canvas = document.getElementById('performance-chart');
  if (!canvas || !window.Chart) return;
  
  const ctx = canvas.getContext('2d');
  
  // Prepare data
  const labels = trends.map(t => {
    const date = new Date(t.date);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  });
  
  const times = trends.map(t => {
    // Convert time string to seconds for charting
    if (!t.finishTime) return null;
    return parseTimeToSeconds(t.finishTime);
  });
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Finish Time',
        data: times,
        borderColor: '#d4af37',
        backgroundColor: 'rgba(212, 175, 55, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#d4af37',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(26, 26, 26, 0.9)',
          titleColor: '#ffffff',
          bodyColor: '#d4af37',
          borderColor: '#d4af37',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              const index = context.dataIndex;
              return trends[index].finishTime || 'N/A';
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#999999'
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          }
        },
        y: {
          ticks: {
            color: '#999999',
            callback: function(value) {
              return formatSecondsToTime(value);
            }
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          reverse: true // Lower times are better
        }
      }
    }
  });
}

/**
 * Parse time string to seconds
 */
function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  } else if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  }
  return null;
}

/**
 * Format seconds to time string
 */
function formatSecondsToTime(seconds) {
  if (seconds === null || seconds === undefined) return 'N/A';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get trend icon
 */
function getTrendIcon(trend) {
  if (trend === 'improving') return '📈';
  if (trend === 'declining') return '📉';
  return '➡️';
}

/**
 * Add follow button
 */
async function addFollowButton(athleteId) {
  const profileContent = document.getElementById('profile-content');
  if (!profileContent) return;
  
  const userId = getUserId();
  if (!userId) return;
  
  // Check if already following
  // TODO: Implement follow status check
  
  const followBtn = document.createElement('button');
  followBtn.className = 'btn-primary';
  followBtn.textContent = 'Follow';
  followBtn.onclick = () => followAthlete(athleteId);
  
  const profileHeader = profileContent.querySelector('.profile-header');
  if (profileHeader) {
    profileHeader.appendChild(followBtn);
  }
}

/**
 * Follow athlete
 */
async function followAthlete(athleteId) {
  const userId = getUserId();
  if (!userId) {
    showAuthModal();
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/athletes/${athleteId}/follow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId })
    });
    
    if (response.ok) {
      alert('Now following this athlete!');
    } else {
      throw new Error('Failed to follow');
    }
  } catch (error) {
    console.error('Follow error:', error);
    alert('Failed to follow athlete. Please try again.');
  }
}

/**
 * Load featured content (stats)
 */
async function loadFeaturedContent() {
  try {
    // Try to get platform stats from API
    // For now, we'll use placeholder values
    // TODO: Add platform stats endpoint
    
    const statAthletes = document.getElementById('stat-athletes');
    const statRaces = document.getElementById('stat-races');
    const statEvents = document.getElementById('stat-events');
    
    // Placeholder values - can be replaced with actual API call
    if (statAthletes) statAthletes.textContent = '1,234';
    if (statRaces) statRaces.textContent = '5,678';
    if (statEvents) statEvents.textContent = '12';
  } catch (error) {
    console.error('Error loading featured content:', error);
  }
}

/**
 * Show my profile (if authenticated)
 */
export function showMyProfile() {
  const user = getCurrentUser();
  if (!user) {
    showAuthModal();
    return;
  }
  
  // TODO: Implement user's own profile view
  alert('My Profile feature coming soon!');
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
window.scrollToSection = scrollToSection;
window.scrollToTop = scrollToTop;
window.showLanding = showLanding;
window.navigateToProfile = navigateToProfile;
window.showMyProfile = showMyProfile;
window.showAdminPage = showAdminPage;
window.toggleMobileMenu = toggleMobileMenu;

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
