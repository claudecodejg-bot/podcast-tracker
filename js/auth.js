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
 * Creates the users row on first sign-in (allowed by the users_insert_own
 * RLS policy), so admin only needs to create the auth account.
 */
export async function getCurrentUser() {
  const session = await getSession()
  if (!session) return null

  const { data: user } = await supabase
    .from('users')
    .select('id, full_name, is_admin, preferred_platform')
    .eq('auth_id', session.user.id)
    .maybeSingle()
  if (user) return user

  return await ensureUserRow(session)
}

/**
 * Inserts the users-table row for the signed-in auth account if missing.
 * Returns the row (existing or newly created), or null on failure.
 */
export async function ensureUserRow(session) {
  const fallbackName = session.user.email?.split('@')[0] || 'Member'
  const { data: inserted, error } = await supabase
    .from('users')
    .upsert(
      {
        auth_id: session.user.id,
        email: session.user.email,
        full_name: session.user.user_metadata?.full_name || fallbackName,
      },
      { onConflict: 'auth_id', ignoreDuplicates: true }
    )
    .select('id, full_name, is_admin')
    .maybeSingle()

  if (error) {
    console.error('Could not create users row:', error.message)
    return null
  }
  if (inserted) return inserted

  // Row already existed (upsert ignored the duplicate) — fetch it
  const { data: existing } = await supabase
    .from('users')
    .select('id, full_name, is_admin')
    .eq('auth_id', session.user.id)
    .maybeSingle()
  return existing || null
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
    // Inject People link into nav
    injectPeopleLink()
    // Inject Profile link into nav if not already there
    injectProfileLink()
    // Inject Admin link for admin users
    injectAdminLink()
  } else {
    authBtn.textContent = 'Sign In'
    authBtn.addEventListener('click', () => { window.location.href = 'login.html' })
  }
}

/** Adds a "People" item to the nav center list when signed in. */
function injectPeopleLink() {
  const navCenter = document.querySelector('.nav-center')
  if (!navCenter || navCenter.querySelector('[data-page="people"]')) return
  const li = document.createElement('li')
  li.innerHTML = `<a href="people.html" data-page="people">People</a>`
  navCenter.appendChild(li)
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

/** Loads unread notification count and updates the nav badge. */
async function loadUnreadCount() {
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', (await supabase.auth.getSession()).data.session?.user?.id)
    .single()

  if (!user) return

  // Count unread notifications (replaces old shares-only count)
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
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
