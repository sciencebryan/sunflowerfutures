import { byId, pick } from "./helpers.js";
import { CROPS, SEASONS, SEASON_LEN, WEATHERS } from "./data-economy.js";
import { S } from "./state.js";











/* Age in years. */
const AGES = {nadia:34, ora:29, bec:31, sam:44, yusuf:38, petra:52, ilya:27,
              june:61, marisol:33, theo:16, ash:40, kav:47,
              rosa:36, emrys:30, din:24, halla:57, moss:66, yara:35};

// Deterministic fallback so a child is never lost to name exhaustion, even in a very old,
// very lucky village 
function generateFallbackChildName(used){
  const syllA = ["Bri","Fen","Wil","Tam","Sor","Ash","Ren","Cal","Mer","Or"];
  const syllB = ["ar","el","wyn","on","is","eth","ora","in","ley","an"];
  for(let tries=0; tries<40; tries++){
    const name = pick(syllA) + pick(syllB);
    if(!used.has(name)) return name;
  }
  // last resort: guaranteed unique, still legible as a name
  let n = 2, name;
  do { name = "Fen"+n; n++; } while(used.has(name));
  return name;
}

const ADULT=16, ELDER=62;
const canWork = p => p.age>=ADULT;
const canRoad = p => p.age>=ADULT && p.age<ELDER && !(p.perm==="leg");
const roadReady = p => canRoad(p) && p.status==="ok";

const seasonIdx = day => Math.floor((day-1)/SEASON_LEN) % 4;

// crop discovery: most crops start locked and are found over time -- through
// expeditions that turn up seed or rootstock, or the seed-frame puzzles. Radish
// and greens are the only two a village starts knowing.
function lockedCrops(){
  return Object.keys(CROPS).filter(id => CROPS[id].locked && !(S.crops && S.crops[id]));
}
/* ---- typed seed ----
   Seeds belong to a crop now: S.seedStock = {radish: n, greens: n, ...}.
   There is no generic seed pool. Planting spends the crop's own seed;
   harvest returns it (see the picking window in day.js); gifts, trades,
   and puzzle rewards hand out spreads of what the village already grows. */
function addSeeds(id, n){
  if(!id || !n) return;
  S.seedStock = S.seedStock || {};
  S.seedStock[id] = (S.seedStock[id]||0) + n;
}
const seedCount = id => (S.seedStock && S.seedStock[id]) || 0;
const totalSeeds = () => Object.values(S.seedStock||{}).reduce((a,b)=>a+b,0);
/* n seeds spread round-robin across the unlocked ANNUALS — the shape every
   untyped grant (gift crates, traveler trades, puzzle drawers) takes now. */
function grantSeedSpread(n){
  const pool = Object.keys(CROPS).filter(id =>
    !CROPS[id].perennial && (!CROPS[id].locked || (S.crops && S.crops[id])));
  if(!pool.length) return;
  // start from a random offset so the same crop doesn't hoover every gift
  let i = Math.floor(Math.random()*pool.length);
  for(let k=0;k<n;k++){ addSeeds(pool[i%pool.length], 1); i++; }
}

// unlock a random still-locked crop (optionally filtered), returning its id or null.
// Discovery also grants starter seed — with typed seeds, an unlock you can't
// plant is a dead gift. Annuals get two plantings' worth; perennials one
// (cuttings are the harder thing to carry home).
/* Catalpa is the only locked entry with no `yield` — it's a shade tree, not
   food, and calling it "a crop the village hasn't grown before" was simply
   false. Filter by yield rather than by name so any future non-food
   perennial is handled without anyone having to remember an exception. */
const isFoodCrop = id => CROPS[id] && CROPS[id].yield !== undefined;
function discoverRandomCrop(filter){
  let pool = lockedCrops().filter(isFoodCrop);
  if(filter) pool = pool.filter(filter);
  if(!pool.length) return null;
  const id = pool[Math.floor(Math.random()*pool.length)];
  S.crops = S.crops || {};
  S.crops[id] = true;
  const c = CROPS[id];
  addSeeds(id, c.perennial ? (c.seed||1) : (c.seed||1)*2);
  return id;
}
/* You dug up your last radish before it set seed, and now you can't grow
   radishes. That's a real consequence and it stays — but it shouldn't be a
   PERMANENT dead end with no way to act on it. A ranging or salvage party
   can turn up seed of something the village already knows, and going out to
   look is a thing the player can actually choose to do.
   Deliberately not foraging: the near country gives wild food, not somebody's
   garden varieties. Rolls separately from new-crop discovery, so adding this
   never dilutes the odds of finding something genuinely new. */
function restockableCrops(){
  return Object.keys(CROPS).filter(id => {
    const c = CROPS[id];
    if(!c.seed) return false;                                  // nothing to restock
    if(c.locked && !(S.crops && S.crops[id])) return false;    // never known it
    return ((S.seedStock && S.seedStock[id]) || 0) <= 0;       // known, and out
  });
}
function restockRandomCrop(){
  const pool = restockableCrops();
  if(!pool.length) return null;
  const id = pool[Math.floor(Math.random()*pool.length)];
  addSeeds(id, (CROPS[id].seed||1)*2);
  return id;
}
// crop names are plural ("Radishes", "Greens"), so phrase around them
const restockLine = id =>
  `We found more seed for ${CROPS[id].name.toLowerCase()}. We can grow them again.`;

/* The non-food half of discovery: shade trees and the like. Explore only —
   you find a living stand of trees out in the country, you don't find one in
   a stripped building. */
function lockedUseful(){
  return lockedCrops().filter(id => !isFoodCrop(id));
}
function discoverRandomUseful(){
  const pool = lockedUseful();
  if(!pool.length) return null;
  const id = pool[Math.floor(Math.random()*pool.length)];
  S.crops = S.crops || {};
  S.crops[id] = true;
  addSeeds(id, CROPS[id].seed || 1);
  return id;
}
const usefulLine = id =>
  `The ranging party came back with cuttings from a stand of ${CROPS[id].name.toLowerCase()}. Nothing to eat off them — but in time, shade, and a windbreak, and something for the generation after this one to sit under.`;

function discoveryLine(id, how){
  const c=CROPS[id]; if(!c) return "";
  const name=c.name.toLowerCase();
  const seedWord = c.perennial ? "cuttings" : "seed";
  const where = how==="explore" ? "the far country"
              : how==="forage" ? "the near country"
              : "a stripped building";
  return `They brought ${seedWord} back from ${where} — ${name}, a crop the village hasn't grown before.`;
}

const season    = () => SEASONS[seasonIdx(S.day)];
const yearOf    = day => 1 + Math.floor((day-1)/(SEASON_LEN*4));
const dayOfSeason = day => ((day-1) % SEASON_LEN) + 1;
const isWinter  = () => season().id==="winter";
// the SEASONS table's note is written for the common case (no cold frames);
// this corrects it wherever it's actually shown, so it never contradicts the
// crop list right below it (which already lets hardy/cold-framed crops grow)
const seasonNote = s => (s.id==="winter" && S.flags && S.flags.coldFrames)
  ? "Frozen outside, but the cold frames keep the garden going all winter, albeit slower."
  : s.note;

function rollWeather(){
  const f=S.f||{};
  const sn=season();
  let p=[...sn.wx];                                  // clear / overcast / rain, by season
  if(f.wetter){ p=[p[0]-0.08,p[1],p[2]+0.08]; }
  else if(f.drier){ p=[p[0]+0.12,p[1]-0.04,p[2]-0.08]; }
  p=p.map(v=>Math.max(0.02,v));
  const tot=p.reduce((a,b)=>a+b,0);
  let ws=WEATHERS.map((w,i)=>({...w, p:p[i]/tot,
    solar: w.solar*sn.solar}));
  const r=Math.random(); let acc=0;
  for(const w of ws){ acc+=w.p; if(r<=acc) return w; }
  return ws[0];
}
// Turns a bare weather id (as stashed in S.forecast) back into the same scaled
// shape rollWeather() returns, using whatever season is current when it resolves.
function scaledWeather(id){
  const w=WEATHERS.find(x=>x.id===id) || WEATHERS[0];
  return {...w, solar: w.solar*season().solar};
}
// Kav's weather log, made real: once someone is actually keeping it — Kav
// themself, or any Cautious villager (the trait note says "trusts the sky
// less each year"), or a village old enough to have learned the patterns —
// tomorrow's weather shows in the header. Query-only; doesn't touch state.
function forecastUnlocked(){
  const kav=byId("kav");
  if(kav && kav.status!=="away") return true;
  if(S.people.some(p=>p.trait==="Cautious" && p.status!=="away" && canWork(p))) return true;
  if(S.day>=200) return true;
  return false;
}










export { ADULT, AGES, ELDER, addSeeds, discoverRandomUseful, isFoodCrop, lockedUseful, usefulLine, restockLine, restockRandomCrop, restockableCrops, canRoad, canWork, dayOfSeason, discoverRandomCrop, discoveryLine, generateFallbackChildName, grantSeedSpread, lockedCrops, roadReady, rollWeather, scaledWeather, season, seasonIdx, seasonNote, seedCount, totalSeeds, yearOf };
