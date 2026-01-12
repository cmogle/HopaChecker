// Analytics and age-grading visualizations

const API_BASE = window.API_BASE || '/api';

/**
 * Load and display age-graded performance
 */
export async function loadAgeGradedPerformance(athleteId, distance = '10K') {
  try {
    const response = await fetch(`${API_BASE}/athletes/${athleteId}/age-graded-performance?distance=${encodeURIComponent(distance)}`);
    if (!response.ok) throw new Error('Failed to load age-graded performance');
    
    const data = await response.json();
    renderAgeGradedChart(data.performance || []);
  } catch (error) {
    console.error('Error loading age-graded performance:', error);
  }
}

/**
 * Render age-graded performance chart
 */
function renderAgeGradedChart(performance) {
  const container = document.getElementById('age-graded-chart-container');
  if (!container || !window.Chart) return;

  const canvas = document.createElement('canvas');
  container.innerHTML = '';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const labels = performance.map(p => new Date(p.date).toLocaleDateString());
  const rawTimes = performance.map(p => parseTimeToSeconds(p.rawTime));
  const ageGradedTimes = performance.map(p => parseTimeToSeconds(p.ageGradedTime));
  const percentages = performance.map(p => p.ageGradedPercentage);

  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Raw Time (seconds)',
          data: rawTimes,
          borderColor: '#ef5350',
          backgroundColor: 'rgba(239, 83, 80, 0.1)',
          yAxisID: 'y',
        },
        {
          label: 'Age-Graded Time (seconds)',
          data: ageGradedTimes,
          borderColor: '#66bb6a',
          backgroundColor: 'rgba(102, 187, 106, 0.1)',
          yAxisID: 'y',
        },
        {
          label: 'Age-Graded %',
          data: percentages,
          borderColor: '#d4af37',
          backgroundColor: 'rgba(212, 175, 55, 0.1)',
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Time (seconds)' },
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Age-Graded %' },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

/**
 * Load and display season bests
 */
export async function loadSeasonBests(athleteId, year) {
  try {
    const url = year 
      ? `${API_BASE}/athletes/${athleteId}/season-bests?year=${year}`
      : `${API_BASE}/athletes/${athleteId}/season-bests`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load season bests');
    
    const data = await response.json();
    renderSeasonBests(data.seasonBests || []);
  } catch (error) {
    console.error('Error loading season bests:', error);
  }
}

/**
 * Render season bests table
 */
function renderSeasonBests(seasonBests) {
  const container = document.getElementById('season-bests-container');
  if (!container) return;

  if (seasonBests.length === 0) {
    container.innerHTML = '<p>No season bests recorded yet.</p>';
    return;
  }

  let html = `
    <table class="season-bests-table">
      <thead>
        <tr>
          <th>Distance</th>
          <th>Best Time</th>
          <th>Season</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
  `;

  seasonBests.forEach(sb => {
    html += `
      <tr>
        <td>${escapeHtml(sb.distance)}</td>
        <td>${escapeHtml(sb.bestTime)}</td>
        <td>${sb.seasonYear}</td>
        <td>${sb.improved ? '<span class="badge-improved">✓ Improved</span>' : ''}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

/**
 * Load and display badges
 */
export async function loadBadges(athleteId) {
  try {
    const response = await fetch(`${API_BASE}/athletes/${athleteId}/badges`);
    if (!response.ok) throw new Error('Failed to load badges');
    
    const data = await response.json();
    renderBadges(data.badges || []);
  } catch (error) {
    console.error('Error loading badges:', error);
  }
}

/**
 * Render badges
 */
function renderBadges(badges) {
  const container = document.getElementById('badges-container');
  if (!container) return;

  if (badges.length === 0) {
    container.innerHTML = '<p>No badges earned yet.</p>';
    return;
  }

  let html = '<div class="badges-grid">';
  
  badges.forEach(badge => {
    html += `
      <div class="badge-card">
        <div class="badge-icon">🏆</div>
        <div class="badge-title">${escapeHtml(badge.title)}</div>
        <div class="badge-description">${escapeHtml(badge.description)}</div>
        <div class="badge-date">${new Date(badge.earnedDate).toLocaleDateString()}</div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

/**
 * Parse time to seconds
 */
function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
