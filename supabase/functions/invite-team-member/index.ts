// Emails a team member an invitation to log in to the firm.
// Deploy: supabase functions deploy invite-team-member
//
// Body: { team_member_id: string, redirect_to?: string }
// Only an active partner of the team member's firm may call it. Returns { status: 'invited' | 'linked' }:
// 'linked' means the person already had a confirmed account, which now has access to the firm.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Who is calling?
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who.user) return reply(401, { error: 'Please sign in again.' });

  let body: { team_member_id?: string; redirect_to?: string };
  try { body = await req.json(); } catch { return reply(400, { error: 'Invalid request.' }); }
  if (!body.team_member_id) return reply(400, { error: 'team_member_id is required.' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: tm, error: tmErr } = await admin.from('team_members')
    .select('id, firm_id, user_id, name, email, active').eq('id', body.team_member_id).maybeSingle();
  if (tmErr) return reply(500, { error: tmErr.message });
  if (!tm) return reply(404, { error: 'Team member not found.' });

  // Caller must be an active partner of that firm.
  const { data: fm, error: fmErr } = await admin.from('firm_members')
    .select('role').eq('firm_id', tm.firm_id).eq('user_id', who.user.id).eq('active', true);
  if (fmErr) return reply(500, { error: fmErr.message });
  if (!(fm ?? []).some((r) => ['managing_partner', 'partner'].includes(String(r.role)))) {
    return reply(403, { error: 'Only partners can invite team members.' });
  }

  if (tm.user_id) return reply(409, { error: `${tm.name} already has a login.` });
  if (!tm.active) return reply(400, { error: `${tm.name} is inactive. Mark them active first.` });
  const email = String(tm.email ?? '').trim();
  if (!EMAIL_RE.test(email)) return reply(400, { error: `Add a valid email address for ${tm.name} first.` });

  const markInvited = () => admin.from('team_members').update({ invited_at: new Date().toISOString() }).eq('id', tm.id);

  const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: body.redirect_to || undefined,
    data: { full_name: tm.name, needs_password: true },
  });

  if (invErr) {
    // Already registered with a confirmed email: give that account access now.
    const exists = (invErr as { code?: string }).code === 'email_exists' || /already been registered/i.test(invErr.message);
    if (exists) {
      const { error: mErr } = await markInvited();
      if (mErr) return reply(500, { error: mErr.message });
      const { data: linked, error: lErr } = await admin.rpc('link_team_member_by_email', { p_member: tm.id });
      if (lErr) return reply(500, { error: lErr.message });
      if (linked) return reply(200, { status: 'linked' });
      return reply(409, { error: `${email} has an account that is not confirmed yet. Ask them to confirm their email, then sign in.` });
    }
    const limited = (invErr as { status?: number }).status === 429 || /rate limit/i.test(invErr.message);
    return reply(limited ? 429 : 400, {
      error: limited
        ? 'Supabase is limiting how many emails can be sent. Try again later, or raise the email rate limit in Supabase.'
        : invErr.message,
    });
  }

  const { error: mErr } = await markInvited();
  if (mErr) return reply(500, { error: mErr.message });
  return reply(200, { status: 'invited' });
});
