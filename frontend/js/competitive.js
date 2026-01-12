// Competitive intelligence features (H2H, percentiles, CDI)

const API_BASE = window.API_BASE || '/api';

/**
 * Load and display head-to-head comparison
 */
export async function loadHeadToHead(athlete1Id, athlete2Id, container) {
  try {
    const response = await fetch(`${API_BASE}/athletes/${athlete1Id}/vs/${athlete2Id}`);
    if (!response.ok) throw new Error('Failed to load H2H data');
    
    const data = await response.json();
    renderH2HCard(data.h2h, container);
  } catch (error) {
    console.error('Error loading H2H:', error);
  }
}

/**
 * Render H2H card
 */
function renderH2HCard(h2h, container) {
  if (!container || !h2h) return;

  const winRate = h2h.commonRaces > 0 
    ? Math.round((h2h.athlete1Wins / h2h.commonRaces) * 100)
    : 0;

  container.innerHTML = `
    <div class="h2h-card">
      <h3>Head-to-Head</h3>
      <div class="h2h-stats">
        <div class="h2h-stat">
          <span class="h2h-label">Common Races:</span>
          <span class="h2h-value">${h2h.commonRaces}</span>
        </div>
        <div class="h2h-stat">
          <span class="h2h-label">Record:</span>
          <span class="h2h-value">${h2h.athlete1Wins}-${h2h.athlete2Wins}${h2h.ties > 0 ? `-${h2h.ties}` : ''}</span>
        </div>
        <div class="h2h-stat">
          <span class="h2h-label">Avg Gap:</span>
          <span class="h2h-value">${formatSeconds(h2h.averageGapSeconds)}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Load and display percentile badge
 */
export async function loadPercentile(athleteId, distance, location, container) {
  try {
    const url = location
      ? `${API_BASE}/athletes/${athleteId}/percentiles?distance=${encodeURIComponent(distance)}&location=${encodeURIComponent(location)}`
      : `${API_BASE}/athletes/${athleteId}/percentiles?distance=${encodeURIComponent(distance)}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load percentile');
    
    const data = await response.json();
    renderPercentileBadge(data.percentile, container);
  } catch (error) {
    console.error('Error loading percentile:', error);
  }
}

/**
 * Render percentile badge
 */
function renderPercentileBadge(percentile, container) {
  if (!container || !percentile) return;

  const locationText = percentile.location ? ` in ${escapeHtml(percentile.location)}` : '';
  
  container.innerHTML = `
    <div class="percentile-badge">
      <div class="percentile-value">Top ${percentile.percentile}%</div>
      <div class="percentile-label">${escapeHtml(percentile.distance)}${locationText}</div>
      <div class="percentile-details">
        Rank ${percentile.rank} of ${percentile.totalAthletes}
      </div>
    </div>
  `;
}

/**
 * Load and display course difficulty
 */
export async function loadCourseDifficulty(eventId, container) {
  try {
    const response = await fetch(`${API_BASE}/events/${eventId}/difficulty`);
    if (!response.ok) throw new Error('Failed to load course difficulty');
    
    const data = await response.json();
    renderCDI(data.cdi, container);
  } catch (error) {
    console.error('Error loading CDI:', error);
  }
}

/**
 * Render Course Difficulty Index
 */
function renderCDI(cdi, container) {
  if (!container || !cdi) return;

  const difficulty = cdi.difficultyIndex > 0 
    ? `${cdi.difficultyIndex}% harder`
    : cdi.difficultyIndex < 0
    ? `${Math.abs(cdi.difficultyIndex)}% easier`
    : 'Standard';

  const color = cdi.difficultyIndex > 5 ? '#ef5350' : cdi.difficultyIndex < -5 ? '#66bb6a' : '#ffc107';

  container.innerHTML = `
    <div class="cdi-badge" style="border-color: ${color}">
      <div class="cdi-label">Course Difficulty</div>
      <div class="cdi-value" style="color: ${color}">${difficulty}</div>
    </div>
  `;
}

/**
 * Format seconds to readable time
 */
function formatSeconds(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
