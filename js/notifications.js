// =============================================
//  Notifications Module — notification center
// =============================================
import { supabase } from './supabase-client.js'
import { getCurrentUser } from './auth.js'

/**
 * Returns the count of unread notifications for the current user.
 */
export async function getUnreadCount() {
  const user = await getCurrentUser()
  if (!user) return 0

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)

  return count || 0
}

/**
 * Fetches recent notifications for the current user.
 * @param {number} limit
 */
export async function getNotifications(limit = 20) {
  const user = await getCurrentUser()
  if (!user) return []

  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  return data || []
}

/**
 * Mark a single notification as read.
 * @param {string} notifId
 */
export async function markRead(notifId) {
  return supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notifId)
    .is('read_at', null)
}

/**
 * Mark all notifications as read for the current user.
 */
export async function markAllRead() {
  const user = await getCurrentUser()
  if (!user) return

  return supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
}

/**
 * Format a timestamp as relative time (e.g. "2h ago", "3d ago").
 */
export function timeAgo(dateStr) {
  const now  = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Icon for notification type */
export function notifIcon(type) {
  switch (type) {
    case 'share_listened': return '🎧'
    case 'new_share':      return '📤'
    case 'new_follower':   return '👤'
    case 'follow_activity': return '🎙️'
    default:               return '🔔'
  }
}

/**
 * Render the notification dropdown panel and wire it to the bell icon.
 * Call once per page after initNav().
 */
export async function initNotificationDropdown() {
  const bellLink = document.querySelector('.nav-notification a')
  if (!bellLink) return

  // Prevent default navigation
  bellLink.addEventListener('click', async (e) => {
    e.preventDefault()
    toggleDropdown()
  })

  // Close on outside click
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-dropdown')
    const bell  = document.querySelector('.nav-notification')
    if (panel && !panel.contains(e.target) && !bell.contains(e.target)) {
      panel.remove()
    }
  })
}

async function toggleDropdown() {
  let panel = document.getElementById('notif-dropdown')
  if (panel) {
    panel.remove()
    return
  }

  panel = document.createElement('div')
  panel.id = 'notif-dropdown'
  panel.className = 'notif-dropdown'
  panel.innerHTML = '<div class="notif-dropdown-loading"><div class="spinner"></div></div>'

  const bell = document.querySelector('.nav-notification')
  bell.appendChild(panel)

  const notifs = await getNotifications(15)

  if (!notifs.length) {
    panel.innerHTML = `
      <div class="notif-dropdown-header">
        <span>Notifications</span>
      </div>
      <div class="notif-dropdown-empty">No notifications yet</div>`
    return
  }

  panel.innerHTML = `
    <div class="notif-dropdown-header">
      <span>Notifications</span>
      <button class="notif-mark-all" id="notif-mark-all-btn">Mark all read</button>
    </div>
    <div class="notif-dropdown-list">
      ${notifs.map(n => `
        <a href="${n.link || '#'}" class="notif-item ${n.read_at ? '' : 'unread'}" data-notif-id="${n.id}">
          <span class="notif-item-icon">${notifIcon(n.type)}</span>
          <div class="notif-item-body">
            <div class="notif-item-title">${escHtml(n.title)}</div>
            ${n.body ? `<div class="notif-item-text">${escHtml(n.body)}</div>` : ''}
            <div class="notif-item-time">${timeAgo(n.created_at)}</div>
          </div>
        </a>`).join('')}
    </div>
    <a href="library.html#shared" class="notif-dropdown-footer">View all shared items</a>`

  // Wire mark-all-read
  document.getElementById('notif-mark-all-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation()
    await markAllRead()
    panel.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'))
    updateBadge(0)
  })

  // Wire individual click — mark read + navigate
  panel.querySelectorAll('.notif-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      const notifId = el.dataset.notifId
      if (notifId) await markRead(notifId)
    })
  })
}

/** Update the nav badge count */
export function updateBadge(count) {
  const badge = document.getElementById('nav-notification-badge')
  if (!badge) return
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count
    badge.classList.remove('hidden')
  } else {
    badge.classList.add('hidden')
  }
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
