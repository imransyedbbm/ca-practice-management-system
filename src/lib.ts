import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as
  | string
  | undefined;

export const supabaseKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
) as string | undefined;

/**
 * Supabase client.
 * Uses the public/publishable key and persists the signed-in session.
 */
export const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

/**
 * Indicates whether the required environment variables are present.
 * This does not verify that the credentials are valid.
 */
export const isSupabaseConfigured = Boolean(supabase);

/**
 * Returns the Supabase client or throws a readable configuration error.
 */
export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY) in your .env file.',
    );
  }

  return supabase;
}

/**
 * Creates a firm for the currently authenticated user.
 * The database function assigns the user the managing_partner role.
 */
export async function createFirm(name: string, city = '') {
  const client = requireSupabase();

  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error('Please enter your CA firm name.');
  }

  const { data, error } = await client.rpc('create_firm_with_owner', {
    p_name: trimmedName,
    p_city: city.trim(),
  });

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('The firm was not created. Please try again.');
  }

  return data as string;
}

/**
 * Formats an amount in Indian rupees.
 */
export const money = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);

/**
 * Formats a YYYY-MM-DD date for display in India.
 */
export const shortDate = (s: string) =>
  s
    ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

export type Client = {
  id: string;
  firm_id?: string;
  name: string;
  entity_type: string;
  email: string;
  phone: string;
  pan: string;
  gstin: string;
  status: string;
  services: string[];
  created_at?: string;
};

export type Task = {
  id: string;
  firm_id?: string;
  title: string;
  client_id: string;
  category: string;
  period: string;
  due_date: string;
  internal_due_date: string;
  status: string;
  priority: string;
  assigned_to: string;
  reviewer: string;
  client_name?: string;
};

let cachedFirmId: string | null = null;

/**
 * Returns the firm id of the signed-in user, or null if not signed in
 * or not yet a member of any firm. Cached after the first lookup.
 */
export async function currentFirmId(): Promise<string | null> {
  if (cachedFirmId) return cachedFirmId;
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from('firm_members')
    .select('firm_id')
    .eq('user_id', auth.user.id)
    .eq('active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  cachedFirmId = data.firm_id as string;
  return cachedFirmId;
}

/** Clears the cached firm id (call on sign-out or after creating a firm). */
export function resetFirmCache() {
  cachedFirmId = null;
}
