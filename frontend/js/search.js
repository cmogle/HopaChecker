// Search functionality with debouncing and real-time results

const API_BASE = window.API_BASE || '/api';
let searchTimeout = null;
let currentSearchQuery = '';
let searchCache = new Map();

/**
 * Initialize search functionality
 */
export function initSearch() {
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchLoading = document.getElementById('search-loading');

  if (!searchInput || !searchResults) return;

  // Debounced search on input
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    if (query.length < 2) {
      searchResults.innerHTML = '';
      searchResults.classList.add('hidden');
      return;
    }

    // Show loading
    searchLoading.classList.remove('hidden');
    searchResults.classList.remove('hidden');

    // Clear previous timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Debounce search
    searchTimeout = setTimeout(() => {
      performSearch(query);
    }, 300);
  });

  // Handle keyboard navigation
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstResult = searchResults.querySelector('.search-result-item');
      if (firstResult) {
        firstResult.click();
      }
    }
  });

  // Clear results when input is cleared
  searchInput.addEventListener('blur', () => {
    // Delay to allow click on results
    setTimeout(() => {
      if (searchInput.value.trim().length < 2) {
        searchResults.innerHTML = '';
        searchResults.classList.add('hidden');
      }
    }, 200);
  });
}

/**
 * Perform search API call
 */
async function performSearch(query) {
  const searchResults = document.getElementById('search-results');
  const searchLoading = document.getElementById('search-loading');

  if (!query || query.length < 2) {
    return;
  }

  currentSearchQuery = query;

  // Check cache
  if (searchCache.has(query)) {
    displaySearchResults(searchCache.get(query));
    searchLoading.classList.add('hidden');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/athletes/search?q=${encodeURIComponent(query)}&limit=20`);
    
    if (!response.ok) {
      throw new Error('Search failed');
    }

    const data = await response.json();
    
    // Only display if query hasn't changed
    if (currentSearchQuery === query) {
      // Cache results
      searchCache.set(query, data.athletes || []);
      
      displaySearchResults(data.athletes || []);
      searchLoading.classList.add('hidden');
    }
  } catch (error) {
    console.error('Search error:', error);
    if (currentSearchQuery === query) {
      searchResults.innerHTML = `
        <div class="search-empty">
          <p>Error searching athletes. Please try again.</p>
        </div>
      `;
      searchLoading.classList.add('hidden');
    }
  }
}

/**
 * Display search results
 */
function displaySearchResults(athletes) {
  const searchResults = document.getElementById('search-results');
  
  if (!athletes || athletes.length === 0) {
    searchResults.innerHTML = `
      <div class="search-empty">
        <p>No athletes found. Try a different search term.</p>
      </div>
    `;
    return;
  }

  let html = '';
  athletes.forEach(athlete => {
    const gender = athlete.gender || 'Unknown';
    const country = athlete.country || 'Unknown';
    
    html += `
      <div class="search-result-item" onclick="viewAthlete('${athlete.id}')">
        <div class="result-name">${escapeHtml(athlete.name)}</div>
        <div class="result-meta">${escapeHtml(gender)} • ${escapeHtml(country)}</div>
      </div>
    `;
  });

  searchResults.innerHTML = html;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Clear search cache
 */
export function clearSearchCache() {
  searchCache.clear();
}

// Make viewAthlete available globally
window.viewAthlete = function(athleteId) {
  if (window.navigateToProfile) {
    window.navigateToProfile(athleteId);
  }
};
