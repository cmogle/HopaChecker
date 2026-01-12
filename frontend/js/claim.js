// Profile claim functionality

const API_BASE = window.API_BASE || '/api';
import { getUserId, isAuthenticated, showAuthModal } from './auth.js';

/**
 * Show claim profile button in search results
 */
export function addClaimButton(athleteId, athleteName, container) {
  const userId = getUserId();
  if (!userId) {
    return; // Don't show claim button if not authenticated
  }

  // Check if already claimed
  checkClaimStatus(athleteId).then(claimed => {
    if (claimed) {
      // Already claimed - show verified badge
      if (container) {
        const badge = document.createElement('span');
        badge.className = 'claim-badge verified';
        badge.textContent = '✓ Verified';
        container.appendChild(badge);
      }
      return;
    }

    // Add claim button to search results
    if (container) {
      const claimBtn = document.createElement('button');
      claimBtn.className = 'btn-claim';
      claimBtn.textContent = 'Is this you?';
      claimBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent triggering viewAthlete
        showClaimModal(athleteId, athleteName);
      };
      container.appendChild(claimBtn);
    }
  });
}

// Make available globally
window.addClaimButton = addClaimButton;

/**
 * Check if profile is already claimed by current user
 */
async function checkClaimStatus(athleteId) {
  const userId = getUserId();
  if (!userId) return false;

  try {
    const response = await fetch(`${API_BASE}/athletes/${athleteId}/claim-status?user_id=${userId}`);
    if (!response.ok) return false;
    
    const data = await response.json();
    return data.claimed === true;
  } catch (error) {
    console.error('Error checking claim status:', error);
    return false;
  }
}

/**
 * Show claim modal
 */
export function showClaimModal(athleteId, athleteName) {
  if (!isAuthenticated()) {
    showAuthModal();
    return;
  }

  const modal = document.getElementById('claim-modal');
  if (!modal) {
    createClaimModal();
    showClaimModal(athleteId, athleteName);
    return;
  }

  // Set athlete info
  modal.setAttribute('data-athlete-id', athleteId);
  const modalTitle = modal.querySelector('.claim-modal-title');
  if (modalTitle) {
    modalTitle.textContent = `Claim Profile: ${athleteName}`;
  }

  // Check current claim status
  loadClaimStatus(athleteId);

  // Show modal
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/**
 * Create claim modal HTML
 */
function createClaimModal() {
  const modal = document.createElement('div');
  modal.id = 'claim-modal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="claim-modal-title">Claim Profile</h2>
        <button class="modal-close" onclick="closeClaimModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div id="claim-status" class="claim-status">
          <p>Verifying your identity...</p>
        </div>
        
        <div id="claim-strava-section" class="claim-section hidden">
          <h3>Verify with Strava</h3>
          <p>Connect your Strava account to verify this is your profile. We'll match your name and check your activity history.</p>
          <button id="strava-connect-btn" class="btn-strava" onclick="initiateStravaAuth()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L7.322 17.944l1.619-4.926-3.765-2.293h4.691L12 6.673l2.133 4.052h4.691l-3.765 2.293 1.619 4.926z"/>
            </svg>
            Connect with Strava
          </button>
        </div>

        <div id="claim-verified-section" class="claim-section hidden">
          <div class="claim-success">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <h3>Profile Verified!</h3>
            <p>Your profile has been successfully verified. You can now manage your results and merge duplicate profiles.</p>
          </div>
        </div>

        <div id="claim-pending-section" class="claim-section hidden">
          <div class="claim-pending">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <h3>Verification Pending</h3>
            <p>Your verification request is being processed. Please complete the Strava connection to verify your identity.</p>
          </div>
        </div>

        <div id="claim-error" class="claim-error hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeClaimModal()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeClaimModal();
    }
  });
}

/**
 * Load claim status for athlete
 */
async function loadClaimStatus(athleteId) {
  const userId = getUserId();
  if (!userId) return;

  const statusDiv = document.getElementById('claim-status');
  const stravaSection = document.getElementById('claim-strava-section');
  const verifiedSection = document.getElementById('claim-verified-section');
  const pendingSection = document.getElementById('claim-pending-section');
  const errorDiv = document.getElementById('claim-error');

  // Hide all sections
  if (statusDiv) statusDiv.classList.add('hidden');
  if (stravaSection) stravaSection.classList.add('hidden');
  if (verifiedSection) verifiedSection.classList.add('hidden');
  if (pendingSection) pendingSection.classList.add('hidden');
  if (errorDiv) errorDiv.classList.add('hidden');

  try {
    // Check if already claimed
    const claimResponse = await fetch(`${API_BASE}/athletes/${athleteId}/claim-status?user_id=${userId}`);
    if (!claimResponse.ok) {
      throw new Error('Failed to check claim status');
    }

    const claimData = await claimResponse.json();

    if (claimData.claimed) {
      const claim = claimData.claim;
      
      if (claim.verification_status === 'verified') {
        // Show verified section
        if (verifiedSection) verifiedSection.classList.remove('hidden');
      } else {
        // Show pending section with option to complete verification
        if (pendingSection) pendingSection.classList.remove('hidden');
        if (stravaSection) stravaSection.classList.remove('hidden');
      }
    } else {
      // Not claimed yet - show Strava connect option
      if (stravaSection) stravaSection.classList.remove('hidden');
      
      // Initiate claim
      await initiateClaim(athleteId);
    }
  } catch (error) {
    console.error('Error loading claim status:', error);
    if (errorDiv) {
      errorDiv.textContent = 'Error loading claim status. Please try again.';
      errorDiv.classList.remove('hidden');
    }
  }
}

/**
 * Initiate profile claim
 */
async function initiateClaim(athleteId) {
  const userId = getUserId();
  if (!userId) return;

  try {
    const response = await fetch(`${API_BASE}/athletes/${athleteId}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        verificationMethod: 'strava',
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to initiate claim');
    }

    // Claim created, now show Strava connect option
    return true;
  } catch (error) {
    console.error('Error initiating claim:', error);
    return false;
  }
}

/**
 * Initiate Strava OAuth flow
 */
window.initiateStravaAuth = async function() {
  const modal = document.getElementById('claim-modal');
  if (!modal) return;

  const athleteId = modal.getAttribute('data-athlete-id');
  if (!athleteId) return;

  const errorDiv = document.getElementById('claim-error');
  if (errorDiv) {
    errorDiv.classList.add('hidden');
  }

  try {
    // Get Strava auth URL
    const redirectUri = `${window.location.origin}/api/auth/strava/callback`;
    const response = await fetch(
      `${API_BASE}/auth/strava/authorize?athlete_id=${athleteId}&redirect_uri=${encodeURIComponent(redirectUri)}`
    );

    if (!response.ok) {
      throw new Error('Failed to get Strava authorization URL');
    }

    const data = await response.json();
    
    // Redirect to Strava
    window.location.href = data.authUrl;
  } catch (error) {
    console.error('Error initiating Strava auth:', error);
    if (errorDiv) {
      errorDiv.textContent = 'Error connecting to Strava. Please try again.';
      errorDiv.classList.remove('hidden');
    }
  }
};

/**
 * Close claim modal
 */
window.closeClaimModal = function() {
  const modal = document.getElementById('claim-modal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
};

/**
 * Handle Strava callback (called after OAuth redirect)
 */
export function handleStravaCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const verified = urlParams.get('strava_verified');
  const confidence = urlParams.get('confidence');
  const athleteId = window.location.hash.match(/\/athlete\/([^?]+)/)?.[1];

  if (verified && athleteId) {
    // Reload claim status
    if (athleteId) {
      loadClaimStatus(athleteId);
    }

    // Show success message
    if (verified === 'true') {
      alert(`Profile verified successfully! Confidence: ${confidence}%`);
    } else {
      alert(`Verification pending. Confidence: ${confidence}%. Please try again.`);
    }
  }
}

/**
 * Show profile merge UI (for verified users)
 */
export async function showMergeUI(athleteId) {
  const userId = getUserId();
  if (!userId) return;

  // Check if user has verified claim
  try {
    const response = await fetch(`${API_BASE}/athletes/${athleteId}/claim-status?user_id=${userId}`);
    if (!response.ok) return;

    const data = await response.json();
    if (!data.claimed || data.claim.verification_status !== 'verified') {
      return; // Not verified, don't show merge UI
    }

    // TODO: Fetch suggested duplicate profiles and show merge UI
    // This would require a new API endpoint to suggest duplicates
    console.log('Merge UI - to be implemented with duplicate suggestion API');
  } catch (error) {
    console.error('Error checking merge eligibility:', error);
  }
}
