// =============================================
//  Share Modal — reusable component
//  Import and call initShareModal() on any page
// =============================================

import { supabase } from './supabase-client.js'
import { getCurrentUser } from './auth.js'

let currentUser = null

/**
 * Initialises the share modal. Call once per page.
 * The page must include the share modal HTML (injected below) or
 * have an element with id="share-modal-container".
 */
export async function initShareModal() {
  currentUser = await getCurrentUser()
  if (!currentUser) return  // no share functionality for guests

  // Inject modal HTML if not already present
  if (!document.getElementById('share-modal')) {
    const container = document.getElementById('share-modal-container') || document.body
    container.insertAdjacentHTML('beforeend', SHARE_MODAL_HTML)
  }

  // Wire up close button
  document.getElementById('share-modal-close').addEventListener('click', closeShareModal)
  document.getElementById('share-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeShareModal()
  })

  // Wire up send button
  document.getElementById('share-send-btn').addEventListener('click', sendShare)
}

/**
 * Opens the share modal for a podcast or episode.
 * @param {object} opts - { podcastId?, episodeId?, title }
 */
export async function openShareModal({ podcastId = null, episodeId = null, title }) {
  if (!currentUser) {
    alert('Sign in to share with other members.')
    return
  }

  // Store context
  document.getElementById('share-modal').dataset.podcastId = podcastId || ''
  document.getElementById('share-modal').dataset.episodeId = episodeId || ''
  document.getElementById('share-modal-title').textContent = `Share: ${title}`
  document.getElementById('share-send-alert').className = 'alert hidden'
  document.getElementById('share-message').value = ''
  document.getElementById('share-recipient').value = ''

  // Load member list
  await loadMembers()

  // Show modal
  document.getElementById('share-modal-overlay').classList.remove('hidden')
}

function closeShareModal() {
  document.getElementById('share-modal-overlay').classList.add('hidden')
}

async function loadMembers() {
  const select = document.getElementById('share-recipient')
  select.innerHTML = '<option value="">— Select a member —</option>'

  const { data: users } = await supabase
    .from('users')
    .select('id, full_name')
    .order('full_name')

  if (!users) return

  for (const u of users) {
    if (u.id === currentUser.id) continue  // skip self
    const opt = document.createElement('option')
    opt.value = u.id
    opt.textContent = u.full_name
    select.appendChild(opt)
  }
}

async function sendShare() {
  const modal      = document.getElementById('share-modal')
  const recipientId = document.getElementById('share-recipient').value
  const message    = document.getElementById('share-message').value.trim()
  const podcastId  = modal.dataset.podcastId || null
  const episodeId  = modal.dataset.episodeId || null
  const alertEl    = document.getElementById('share-send-alert')
  const sendBtn    = document.getElementById('share-send-btn')

  if (!recipientId) {
    alertEl.textContent = 'Please select a member to share with.'
    alertEl.className = 'alert alert-error'
    return
  }

  sendBtn.disabled = true
  sendBtn.textContent = 'Sending…'
  alertEl.className = 'alert hidden'

  const { data: shareData, error } = await supabase.from('shares').insert({
    sender_id:    currentUser.id,
    recipient_id: recipientId,
    podcast_id:   podcastId || null,
    episode_id:   episodeId || null,
    message:      message || null
  }).select('id').single()

  sendBtn.disabled = false
  sendBtn.textContent = 'Send'

  if (error) {
    alertEl.textContent = 'Could not send. Please try again.'
    alertEl.className = 'alert alert-error'
    return
  }

  // Create notification for recipient
  const title = document.getElementById('share-modal-title').textContent.replace('Share: ', '')
  await supabase.from('notifications').insert({
    user_id:            recipientId,
    type:               'new_share',
    title:              `${currentUser.full_name} shared "${title}" with you`,
    body:               message || null,
    link:               episodeId ? `episode.html?id=${episodeId}` : (podcastId ? `podcast.html?id=${podcastId}` : 'library.html#shared'),
    related_user_id:    currentUser.id,
    related_episode_id: episodeId || null,
    related_share_id:   shareData?.id || null
  })

  alertEl.textContent = 'Shared!'
  alertEl.className = 'alert alert-success'
  setTimeout(closeShareModal, 1200)
}

const SHARE_MODAL_HTML = `
<div id="share-modal-overlay" class="modal-overlay hidden">
  <div id="share-modal" class="modal-card" data-podcast-id="" data-episode-id="">
    <div class="modal-header">
      <h3 id="share-modal-title">Share</h3>
      <button id="share-modal-close" class="modal-close" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">
      <div id="share-send-alert" class="alert hidden"></div>
      <div class="form-group">
        <label for="share-recipient">Send to</label>
        <select id="share-recipient">
          <option value="">— Select a member —</option>
        </select>
      </div>
      <div class="form-group">
        <label for="share-message">Message <span style="color:var(--gray-600);font-weight:400">(optional)</span></label>
        <textarea id="share-message" rows="3" placeholder="Check this out!"></textarea>
      </div>
      <button id="share-send-btn" class="btn btn-primary btn-full">Send</button>
    </div>
  </div>
</div>
`
