// =============================================
//  Follow helpers — tri-state follows honoring each
//  user's follow policy ('open' or 'approval').
//  States: 'none' | 'pending' | 'accepted'
// =============================================
import { supabase } from './supabase-client.js'

/** Current follow relationship from meId → targetId. */
export async function getFollowState(meId, targetId) {
  const { data } = await supabase
    .from('user_follows')
    .select('status')
    .eq('follower_id', meId)
    .eq('following_id', targetId)
    .maybeSingle()
  return data?.status || 'none'
}

/**
 * Follow a user, honoring their follow policy.
 * @param {{id, full_name}} me       the signed-in user record
 * @param {{id, follow_policy}} target
 * @returns {'accepted'|'pending'} the resulting state
 */
export async function follow(me, target) {
  const pending = target.follow_policy === 'approval'
  const status  = pending ? 'pending' : 'accepted'

  const { error } = await supabase
    .from('user_follows')
    .insert({ follower_id: me.id, following_id: target.id, status })
  if (error) throw error

  await supabase.from('notifications').insert({
    user_id: target.id,
    type: pending ? 'follow_request' : 'new_follower',
    title: pending
      ? `${me.full_name} wants to follow you`
      : `${me.full_name} started following you`,
    link: pending ? 'people.html' : `profile.html?user=${me.id}`,
    related_user_id: me.id,
  })
  return status
}

/** Unfollow, or cancel a pending request. */
export async function unfollow(meId, targetId) {
  return supabase
    .from('user_follows')
    .delete()
    .eq('follower_id', meId)
    .eq('following_id', targetId)
}

/** Incoming pending follow requests for the signed-in user. */
export async function getPendingRequests(meId) {
  const { data } = await supabase
    .from('user_follows')
    .select('id, follower_id, created_at, users!user_follows_follower_id_fkey(id, full_name)')
    .eq('following_id', meId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  return data || []
}

/** Accept a pending request (me = the followee). */
export async function acceptRequest(me, request) {
  const { error } = await supabase
    .from('user_follows')
    .update({ status: 'accepted' })
    .eq('id', request.id)
  if (error) throw error

  await supabase.from('notifications').insert({
    user_id: request.follower_id,
    type: 'follow_accepted',
    title: `${me.full_name} accepted your follow request`,
    link: `profile.html?user=${me.id}`,
    related_user_id: me.id,
  })
}

/** Decline a pending request (deletes it, requester is not notified). */
export async function declineRequest(requestId) {
  return supabase.from('user_follows').delete().eq('id', requestId)
}

/** Button label for a follow state. */
export function followBtnLabel(state) {
  return state === 'accepted' ? 'Following' : state === 'pending' ? 'Requested' : 'Follow'
}
