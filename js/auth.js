// =============================================
//  Auth helpers — used by all pages
// =============================================

import { supabase } from './supabase-client.js'

/** Returns the current Supabase session, or null if not logged in. */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

/**
 * Redirects to login.html if no active session.
 * Returns the session if valid.
 */
export async function requireLogin() {
  const session = await getSession()
  if (!session) {
    window.location.href = 'login.html'
    return null
  }
  return session
}

/**
 * Checks that the logged-in user is an admin.
 * Redirects to index.html if not.
 * Returns the user record if valid.
 */
export async function requireAdmin() {
  const session = await requireLogin()
  if (!session) return null

  const { data: user } = await supabase
    .from('users')
    .select('id, full_name, is_admin')
    .eq('auth_id', session.user.id)
    .single()

  if (!user?.is_admin) {
    window.location.href = 'index.html'
    return null
  }
  return user
}

/**
 * Returns the logged-in user's record from the users table, or null.
 * Does NOT redirect — use requireLogin() first if needed.
 */
export async function getCurrentUser() {
  const session = await getSession()
  if (!session) return null

  const { data: user } = await supabase
    .from('users')
    .select('id, full_name, is_admin')
    .eq('auth_id', session.user.id)
    .single()

  return user || null
}

/** Signs the user out and redirects to login.html. */
export async function signOut() {
  await supabase.auth.signOut()
  window.location.href = 'login.html'
}

/**
 * Updates the nav bar based on login state.
 * Shows unread share notification badge when logged in.
 * Call this on every page.
 */
export async function initNav(activePage) {
  // Mark active nav link
  if (activePage) {
    const link = document.querySelector(`.nav-links a[data-page="${activePage}"]`)
    if (link) link.classList.add('active')
  }

  const authBtn = document.getElementById('nav-auth-btn')
  if (!authBtn) return

  const session = await getSession()
  if (session) {
    authBtn.textContent = 'Sign Out'
    authBtn.addEventListener('click', signOut)
    // Load unread share count
    loadUnreadCount()
    // Inject Profile link into nav if not already there
    injectProfileLink()
    // Inject Admin link for admin users
    injectAdminLink()
  } else {
    authBtn.textContent = 'Sign In'
    authBtn.addEventListener('click', () => { window.location.href = 'login.html' })
  }
}

/** Adds a "Profile" item to the nav center list when signed in. */
function injectProfileLink() {
  const navCenter = document.querySelector('.nav-center')
  if (!navCenter || navCenter.querySelector('[data-page="profile"]')) return
  const li = document.createElement('li')
  li.innerHTML = `<a href="profile.html" data-page="profile">Profile</a>`
  navCenter.appendChild(li)
}

/** Adds an "Admin" item to the nav center list for admin users. */
async function injectAdminLink() {
  const navCenter = document.querySelector('.nav-center')
  if (!navCenter || navCenter.querySelector('[data-page="admin"]')) return

  const session = await getSession()
  if (!session) return

  const { data: user } = await supabase
    .from('users')
    .select('is_admin')
    .eq('auth_id', session.user.id)
    .single()

  if (!user?.is_admin) return

  const li = document.createElement('li')
  li.innerHTML = `<a href="admin.html" data-page="admin">Admin</a>`
  navCenter.appendChild(li)
}

/** Loads unread share count and updates the notification badge. */
async function loadUnreadCount() {
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', (await supabase.auth.getSession()).data.session?.user?.id)
    .single()

  if (!user) return

  const { count } = await supabase
    .from('shares')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .is('read_at', null)

  const badge = document.getElementById('nav-notification-badge')
  if (!badge) return

  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count
    badge.classList.remove('hidden')
  } else {
    badge.classList.add('hidden')
  }
}
