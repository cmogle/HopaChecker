// Supabase authentication integration

let supabaseClient = null;
let currentUser = null;

/**
 * Initialize Supabase client
 */
export function initAuth() {
  // Check if Supabase credentials are available
  const supabaseUrl = window.SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = window.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase credentials not configured. Authentication will be disabled.');
    return;
  }

  try {
    // Check if supabase is available
    if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
      
      // Listen for auth state changes
      supabaseClient.auth.onAuthStateChange((event, session) => {
        handleAuthStateChange(event, session);
      });

      // Check for existing session
      supabaseClient.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          currentUser = session.user;
          updateAuthUI(session.user);
        }
      });
    } else {
      console.warn('Supabase library not loaded. Make sure @supabase/supabase-js is included.');
    }
  } catch (error) {
    console.error('Failed to initialize Supabase:', error);
  }
}

/**
 * Handle auth state changes
 */
function handleAuthStateChange(event, session) {
  if (event === 'SIGNED_IN' && session) {
    currentUser = session.user;
    updateAuthUI(session.user);
    closeAuthModal();
    
    // Check if user was trying to access admin page
    const pendingAdminAccess = sessionStorage.getItem('pendingAdminAccess');
    const hash = window.location.hash;
    const path = window.location.pathname;
    const normalizedPath = path.replace(/\/$/, '') || '/';
    
    // If user was trying to access /admin, redirect there
    if (pendingAdminAccess === 'true' || hash === '#/admin' || normalizedPath === '/admin') {
      sessionStorage.removeItem('pendingAdminAccess');
      // Small delay to ensure UI is updated
      setTimeout(() => {
        if (window.showAdminPage) {
          window.showAdminPage();
        } else {
          window.location.hash = '#/admin';
          // Force a route update
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
      }, 200);
    }
  } else if (event === 'SIGNED_OUT') {
    currentUser = null;
    updateAuthUI(null);
    sessionStorage.removeItem('pendingAdminAccess');
  }
}

/**
 * Update UI based on auth state
 */
function updateAuthUI(user) {
  const signinBtn = document.getElementById('signin-btn');
  const userMenu = document.getElementById('user-menu');
  const userName = document.getElementById('user-name');
  const userDropdown = document.getElementById('user-dropdown');

  if (user) {
    // User is signed in
    if (signinBtn) signinBtn.classList.add('hidden');
    if (userMenu) userMenu.classList.remove('hidden');
    if (userName) {
      // Try to get name from user metadata or email
      const name = user.user_metadata?.full_name || 
                   user.user_metadata?.name || 
                   user.email?.split('@')[0] || 
                   'User';
      userName.textContent = name;
    }
    
    // Add admin link if user is admin
    if (userDropdown && user.email === 'conorogle@gmail.com') {
      // Check if admin link already exists
      let adminLink = userDropdown.querySelector('.admin-link');
      if (!adminLink) {
        adminLink = document.createElement('a');
        adminLink.href = '#';
        adminLink.className = 'admin-link';
        adminLink.textContent = 'Admin';
        adminLink.onclick = (e) => {
          e.preventDefault();
          if (window.showAdminPage) {
            window.showAdminPage();
          } else {
            window.location.hash = '#/admin';
          }
          return false;
        };
        // Insert before "Sign Out"
        const signOutLink = userDropdown.querySelector('a[onclick*="signOut"]');
        if (signOutLink) {
          userDropdown.insertBefore(adminLink, signOutLink);
        } else {
          userDropdown.appendChild(adminLink);
        }
      }
    } else if (userDropdown) {
      // Remove admin link if not admin
      const adminLink = userDropdown.querySelector('.admin-link');
      if (adminLink) {
        adminLink.remove();
      }
    }
  } else {
    // User is not signed in
    if (signinBtn) signinBtn.classList.remove('hidden');
    if (userMenu) userMenu.classList.add('hidden');
    // Remove admin link
    if (userDropdown) {
      const adminLink = userDropdown.querySelector('.admin-link');
      if (adminLink) {
        adminLink.remove();
      }
    }
  }
}

/**
 * Show auth modal
 */
export function showAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

/**
 * Close auth modal
 */
export function closeAuthModal(event) {
  const modal = document.getElementById('auth-modal');
  if (modal && (!event || event.target === modal)) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

/**
 * Sign in with OAuth provider
 */
export async function signInWithProvider(provider) {
  if (!supabaseClient) {
    alert('Authentication is not configured. Please contact support.');
    return;
  }

  try {
    // Determine where to redirect after OAuth
    // Preserve the current path and hash (e.g., /admin or #/admin)
    let redirectTo = window.location.origin;
    
    // If we're on /admin path, redirect back to /admin
    if (window.location.pathname === '/admin' || window.location.pathname.endsWith('/admin')) {
      redirectTo = window.location.origin + '/admin';
    } else if (window.location.hash === '#/admin') {
      // If using hash routing, redirect to origin and let hash routing handle it
      redirectTo = window.location.origin;
    } else {
      // Otherwise, redirect to current pathname
      redirectTo = window.location.origin + window.location.pathname;
    }
    
    console.log('OAuth redirectTo:', redirectTo);
    
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
      provider: provider,
      options: {
        redirectTo: redirectTo
      }
    });

    if (error) {
      console.error('Auth error:', error);
      alert('Failed to sign in. Please try again.');
    }
  } catch (error) {
    console.error('Sign in error:', error);
    alert('An error occurred during sign in. Please try again.');
  }
}

/**
 * Sign out
 */
export async function signOut() {
  if (!supabaseClient) return;

  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      console.error('Sign out error:', error);
      alert('Failed to sign out. Please try again.');
    } else {
      currentUser = null;
      updateAuthUI(null);
    }
  } catch (error) {
    console.error('Sign out error:', error);
  }
}

/**
 * Get current user
 */
export function getCurrentUser() {
  return currentUser;
}

/**
 * Get Supabase client
 */
export function getSupabaseClient() {
  return supabaseClient;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  return currentUser !== null;
}

/**
 * Get user ID for API calls
 */
export function getUserId() {
  return currentUser?.id || null;
}

// Make functions available globally
window.showAuthModal = showAuthModal;
window.closeAuthModal = closeAuthModal;
window.signInWithProvider = signInWithProvider;
window.signOut = signOut;
