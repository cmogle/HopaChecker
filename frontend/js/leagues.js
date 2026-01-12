// Virtual leagues UI

const API_BASE = window.API_BASE || '/api';

/**
 * Load and display league rankings
 */
export async function loadLeagueRankings(leagueId, container) {
  try {
    const response = await fetch(`${API_BASE}/leagues/${leagueId}/rankings`);
    if (!response.ok) throw new Error('Failed to load league rankings');
    
    const data = await response.json();
    renderLeagueRankings(data.rankings || [], container);
  } catch (error) {
    console.error('Error loading league rankings:', error);
  }
}

/**
 * Render league rankings table
 */
function renderLeagueRankings(rankings, container) {
  if (!container) return;

  if (rankings.length === 0) {
    container.innerHTML = '<p>No rankings available yet.</p>';
    return;
  }

  let html = `
    <table class="league-rankings-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Athlete</th>
          <th>Points</th>
        </tr>
      </thead>
      <tbody>
  `;

  rankings.forEach(ranking => {
    html += `
      <tr>
        <td>#${ranking.rank}</td>
        <td>${escapeHtml(ranking.athleteName)}</td>
        <td>${ranking.points || 'N/A'}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

/**
 * Load and display athlete's league memberships
 */
export async function loadAthleteLeagues(athleteId, container) {
  try {
    const response = await fetch(`${API_BASE}/athletes/${athleteId}/leagues`);
    if (!response.ok) throw new Error('Failed to load athlete leagues');
    
    const data = await response.json();
    renderAthleteLeagues(data.leagues || [], container);
  } catch (error) {
    console.error('Error loading athlete leagues:', error);
  }
}

/**
 * Render athlete's league memberships
 */
function renderAthleteLeagues(leagues, container) {
  if (!container) return;

  if (leagues.length === 0) {
    container.innerHTML = '<p>Not participating in any leagues yet.</p>';
    return;
  }

  let html = '<div class="athlete-leagues">';
  
  leagues.forEach(league => {
    const leagueData = league.leagues;
    html += `
      <div class="league-card">
        <h4>${escapeHtml(leagueData.name)}</h4>
        <p class="league-rank">Rank: #${league.rank}</p>
        ${leagueData.description ? `<p class="league-description">${escapeHtml(leagueData.description)}</p>` : ''}
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
