const SUPABASE_URL = "https://uhuyjlfffpwaphnlkdqb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3mBzFMrxYRyyDURL16JtUQ_dE7r3zRY";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { db };
