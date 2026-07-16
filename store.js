import { db } from "./db.js";

/* ================= storage adapter ================= */
const store = {
  mem: null,

  // Helper to quickly grab the logged-in user's ID from Supabase
  async getUserId() {
    const { data: { user } } = await db.auth.getUser();
    return user ? user.id : null;
  },

  async load() {
    try {
      const uid = await this.getUserId();
      
      // If there is no logged-in user, fall back to temporary in-memory state
      if (!uid) return this.mem;

      // Query the database for this user's row.
      // We use .maybeSingle() because if it's their first time playing, 
      // there won't be a row yet, and we want it to return null gracefully.
      const { data, error } = await db
        .from('player_saves')
        .select('game_state')
        .eq('user_id', uid)
        .maybeSingle();

      if (error) throw error;

      if (data && data.game_state) {
        this.mem = data.game_state;
        return this.mem;
      }
      
      return null; // Triggers your openFounding() screen for a fresh game
    } catch (e) {
      console.error("Cloud load failed, falling back to memory:", e);
      return this.mem;
    }
  },

  async save(s) {
    this.mem = s;
    try {
      const uid = await this.getUserId();
      if (!uid) return; // If not logged in, we can't save to the cloud

      // upsert will automatically insert a new row OR update the existing row 
      // because we made user_id a UNIQUE key constraint in the database!
      const { error } = await db
        .from('player_saves')
        .upsert(
          { user_id: uid, game_state: s },
          { onConflict: 'user_id' }
        );

      if (error) throw error;
    } catch (e) {
      console.error("Cloud save failed:", e);
    }
  },

  async clear() {
    this.mem = null;
    try {
      const uid = await this.getUserId();
      if (!uid) return;

      const { error } = await db
        .from('player_saves')
        .delete()
        .eq('user_id', uid);

      if (error) throw error;
    } catch (e) {
      console.error("Cloud delete failed:", e);
    }
  }
};


export { store };
