import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as
  | string
  | undefined;

// Supports the variable name already used by this project.
// VITE_SUPABASE_PUBLISHABLE_KEY is also supported for compatibility.
export const supabaseKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
) as string | undefined;

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
 * Check whether Supabase configuration is present.
 * This does not verify that the key is valid or that the database is reachable.
 */
export const isSupabaseConfigured = Boolean(supabase);

/**
 * Use this helper when a feature requires a configured Supabase client.
 */
export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Check VITE_SUPABASE_URL and your publishable key in the .env file.',
    );
  }

  return supabase;
}

/**
 * Create a CA firm for the currently authenticated user.
 * The database function assigns that user the managing_partner role.
 */
export async function createFirm(name: string, city = '') {
  const client = requireSupabase();

  const { data, error } = await client.rpc('create_firm_with_owner', {
    p_name: name.trim(),
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

export const money = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);

export const shortDate = (s: string) =>
  s
    ? new Date(${s}T00:00:00).toLocaleDateString('en-IN', {
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
