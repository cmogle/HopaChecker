// Watchlist management functionality

const API_BASE = window.API_BASE || '/api';
import { getUserId, isAuthenticated, showAuthModal } from './auth.js';

/**
 * Replace follow button with "Add to Watchlist" dropdown
 */
export function addWatchlistButton(athleteId, container) {
  const userId = getUserId();
  if (!userId || !isAuthenticated()) {
    return; // Don't show if not authenticated
  }

  if (!container) {
    container = document.querySelector('.profile-header') || document.querySelector('.result-actions');
  }

  if (!container) return;

  // Remove existing follow button if present
  const existingBtn = container.querySelector('.btn-follow, .btn-watchlist');
  if (existingBtn) {
    existingBtn.remove();
  }

  // Create watchlist dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'watchlist-dropdown';
  
  const button = document.createElement('button');
  button.className = 'btn-watchlist';
  button.innerHTML = `
    <span>Add to Watchlist</span>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
  button.onclick = () => toggleWatchlistDropdown(athleteId, dropdown);

  dropdown.appendChild(button);
  
  const menu = document.createElement('div');
  menu.className = 'watchlist-menu hidden';
  menu.innerHTML = '<div class="watchlist-menu-loading">Loading watchlists...</div>';
  dropdown.appendChild(menu);

  container.appendChild(dropdown);

  // Load watchlists
  loadWatchlistsForDropdown(athleteId, menu, userId);
}

/**
 * Toggle watchlist dropdown menu
 */
function toggleWatchlistDropdown(athleteId, dropdown) {
  const menu = dropdown.querySelector('.watchlist-menu');
  if (!menu) return;

  menu.classList.toggle('hidden');
  
  // Close on outside click
  if (!menu.classList.contains('hidden')) {
    setTimeout(() => {
      document.addEventListener('click', function closeOnOutside(e) {
        if (!dropdown.contains(e.target)) {
          menu.classList.add('hidden');
          document.removeEventListener('click', closeOnOutside);
        }
      });
    }, 0);
  }
}

/**
 * Load watchlists for dropdown
 */
async function loadWatchlistsForDropdown(athleteId, menu, userId) {
  try {
    // Get user's athlete profile first
    const athleteRes = await fetch(`${API_BASE}/athletes/search?q=${encodeURIComponent(userId)}&limit=1`);
    const athleteData = await athleteRes.json();
    
    if (!athleteData.athletes || athleteData.athletes.length === 0) {
      menu.innerHTML = '<div class="watchlist-menu-empty">Create a watchlist first</div>';
      return;
    }

    const userAthleteId = athleteData.athletes[0].id;

    // Get watchlists
    const res = await fetch(`${API_BASE}/athletes/${userAthleteId}/watchlists?user_id=${userId}`);
    if (!res.ok) {
      throw new Error('Failed to load watchlists');
    }

    const data = await res.json();
    const watchlists = data.watchlists || [];

    if (watchlists.length === 0) {
      menu.innerHTML = `
        <div class="watchlist-menu-empty">
          <p>No watchlists yet</p>
          <button class="btn-create-watchlist" onclick="showCreateWatchlistModal('${userAthleteId}')">
            Create Watchlist
          </button>
        </div>
      `;
      return;
    }

    // Check which watchlists already contain this athlete
    const watchlistChecks = await Promise.all(
      watchlists.map(async (wl) => {
        const itemsRes = await fetch(`${API_BASE}/watchlists/${wl.id}/athletes`);
        const itemsData = await itemsRes.json();
        const isInWatchlist = itemsData.items?.some(
          (item: any) => item.watched_athlete_id === athleteId || item.athletes?.id === athleteId
        );
        return { ...wl, isInWatchlist };
      })
    );

    let html = '<div class="watchlist-menu-header">Add to Watchlist</div>';
    
    watchlistChecks.forEach((wl) => {
      html += `
        <div class="watchlist-menu-item" data-watchlist-id="${wl.id}">
          <label>
            <input 
              type="checkbox" 
              ${wl.isInWatchlist ? 'checked' : ''}
              onchange="toggleWatchlistItem('${wl.id}', '${athleteId}', this.checked)"
            >
            <span>${escapeHtml(wl.name)}</span>
            ${wl.description ? `<small>${escapeHtml(wl.description)}</small>` : ''}
          </label>
        </div>
      `;
    });

    html += `
      <div class="watchlist-menu-footer">
        <button class="btn-create-watchlist-small" onclick="showCreateWatchlistModal('${userAthleteId}')">
          + Create New Watchlist
        </button>
      </div>
    `;

    menu.innerHTML = html;
  } catch (error) {
    console.error('Error loading watchlists:', error);
    menu.innerHTML = '<div class="watchlist-menu-error">Error loading watchlists</div>';
  }
}

/**
 * Toggle athlete in watchlist
 */
window.toggleWatchlistItem = async function(watchlistId, athleteId, add) {
  const userId = getUserId();
  if (!userId) {
    showAuthModal();
    return;
  }

  try {
    const url = add
      ? `${API_BASE}/watchlists/${watchlistId}/athletes/${athleteId}`
      : `${API_BASE}/watchlists/${watchlistId}/athletes/${athleteId}`;
    
    const method = add ? 'POST' : 'DELETE';

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      throw new Error('Failed to update watchlist');
    }

    // Update UI
    const menuItem = document.querySelector(`[data-watchlist-id="${watchlistId}"]`);
    if (menuItem) {
      const checkbox = menuItem.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.checked = add;
      }
    }
  } catch (error) {
    console.error('Error toggling watchlist item:', error);
    alert('Failed to update watchlist. Please try again.');
  }
};

/**
 * Show create watchlist modal
 */
window.showCreateWatchlistModal = function(userAthleteId) {
  const modal = document.getElementById('create-watchlist-modal');
  if (!modal) {
    createWatchlistModal();
    showCreateWatchlistModal(userAthleteId);
    return;
  }

  modal.setAttribute('data-athlete-id', userAthleteId);
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

/**
 * Create watchlist modal
 */
function createWatchlistModal() {
  const modal = document.createElement('div');
  modal.id = 'create-watchlist-modal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>Create Watchlist</h2>
        <button class="modal-close" onclick="closeCreateWatchlistModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="create-watchlist-form">
          <div class="form-group">
            <label for="watchlist-name">Name *</label>
            <input 
              type="text" 
              id="watchlist-name" 
              name="name" 
              required 
              placeholder="e.g., Local M40 Rivals"
            >
          </div>
          <div class="form-group">
            <label for="watchlist-description">Description</label>
            <textarea 
              id="watchlist-description" 
              name="description" 
              rows="3"
              placeholder="Optional description"
            ></textarea>
          </div>
          <div id="create-watchlist-error" class="error-message hidden"></div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeCreateWatchlistModal()">Cancel</button>
        <button class="btn-primary" onclick="submitCreateWatchlist()">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeCreateWatchlistModal();
    }
  });
}

/**
 * Submit create watchlist form
 */
window.submitCreateWatchlist = async function() {
  const modal = document.getElementById('create-watchlist-modal');
  if (!modal) return;

  const athleteId = modal.getAttribute('data-athlete-id');
  const userId = getUserId();
  if (!athleteId || !userId) return;

  const nameInput = document.getElementById('watchlist-name') as HTMLInputElement;
  const descriptionInput = document.getElementById('watchlist-description') as HTMLTextAreaElement;
  const errorDiv = document.getElementById('create-watchlist-error');

  const name = nameInput?.value.trim();
  if (!name) {
    if (errorDiv) {
      errorDiv.textContent = 'Name is required';
      errorDiv.classList.remove('hidden');
    }
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/athletes/${athleteId}/watchlists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        name,
        description: descriptionInput?.value.trim() || null,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create watchlist');
    }

    // Success - close modal and refresh
    closeCreateWatchlistModal();
    
    // Refresh watchlist dropdown if open
    const dropdown = document.querySelector('.watchlist-dropdown');
    if (dropdown) {
      const menu = dropdown.querySelector('.watchlist-menu');
      if (menu && !menu.classList.contains('hidden')) {
        const userAthleteId = athleteId;
        loadWatchlistsForDropdown('', menu, userId);
      }
    }
  } catch (error) {
    console.error('Error creating watchlist:', error);
    if (errorDiv) {
      errorDiv.textContent = error instanceof Error ? error.message : 'Failed to create watchlist';
      errorDiv.classList.remove('hidden');
    }
  }
};

/**
 * Close create watchlist modal
 */
window.closeCreateWatchlistModal = function() {
  const modal = document.getElementById('create-watchlist-modal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    
    // Reset form
    const form = document.getElementById('create-watchlist-form') as HTMLFormElement;
    if (form) {
      form.reset();
    }
    const errorDiv = document.getElementById('create-watchlist-error');
    if (errorDiv) {
      errorDiv.classList.add('hidden');
    }
  }
};

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
