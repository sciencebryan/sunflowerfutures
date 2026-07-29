/* ================= seeded RNG =================
   A named, seedable generator so a run can be REPRODUCED. Same seed, same
   weather, same year — which is the difference between "the village starved
   in year two" being a bug report you can act on and being an anecdote.

   Scope, deliberately narrow for now: climate.js draws from here, and
   nothing else does yet. The rest of the game still calls Math.random.
   That's a real inconsistency and it's on purpose — rewiring every
   Math.random site in the same pass that rebuilds temperature would mean
   two large changes tangled together, and a failure in either would be
   hard to attribute. Weather is the part we're building and the part
   worth reproducing first; other systems can migrate to this later, one
   at a time, without anything here changing.

   The generator is mulberry32: small, fast, well-distributed enough for a
   game, and — unlike an LCG — its low bits are fine, so `rand() < p`
   behaves properly. */

let state = 0;

function setSeed(n){
  state = (n >>> 0) || 1;
}
/* uniform [0,1) */
function rand(){
  state = (state + 0x6D2B79F5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/* Box-Muller, one draw per call (the second is discarded — we're not
   generating enough numbers for the waste to matter, and caching it makes
   the stream order depend on call parity, which is a nasty thing to debug) */
function gauss(mean, sd){
  const u = Math.max(1e-12, rand()), v = rand();
  return mean + sd * Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
}
/* Save/restore so the stream survives a reload: the climate picks up
   exactly where it left off rather than restarting the year's weather. */
const getState = () => state;
const setState = n => { state = (n >>> 0) || 1; };

export { gauss, getState, rand, setSeed, setState };
