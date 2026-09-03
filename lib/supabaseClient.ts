import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Client bisa null kalau env belum diisi (mis. saat build lokal pertama kali) —
// setiap pemanggil WAJIB cek null-nya sendiri, jangan asumsikan selalu ada,
// supaya build tidak crash cuma karena .env.local belum diisi.
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
