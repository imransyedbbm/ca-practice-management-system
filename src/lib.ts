import { createClient } from '@supabase/supabase-js';
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
export const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
export const shortDate = (s: string) => s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export type Client = { id: string; name: string; entity_type: string; email: string; phone: string; pan: string; gstin: string; status: string; services: string[]; created_at?: string };
export type Task = { id: string; title: string; client_id: string; category: string; period: string; due_date: string; internal_due_date: string; status: string; priority: string; assigned_to: string; reviewer: string; client_name?: string };
