import { byId, pick } from "./helpers.js";
import { rand } from "./rng.js";
import { CROPS, SEED_RESERVE_PLANTINGS, isEdibleSeed, SEASONS, SEASON_LEN, WEATHERS } from "./data-economy.js";
import { S } from "./state.js";
/* Cycle note: larder.js imports season() from here, and this imports the
   pantry writers from there. Both sides are hoisted function declarations
   resolved at call time, not module-init time, so the cycle is safe — and
   the harness exercises it on every run. */
import { addFood, takeStock } from "./larder.js";











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
/* ================= the two seed accessors =================
   Every site that asks "how much of this can we plant" or "give the village
   some of this seed" goes through ONE of these two, and nothing anywhere
   touches S.seedStock or the pantry directly for planting purposes. That is
   the whole point: adding a future edible-seed crop is then a one-line data
   change (`edibleSeed:true`) rather than a code change at eight call sites.

   For a unified crop (beans, peas, grain, amaranth, sunflower, potatoes) the
   pantry IS the seed store — there is no S.seedStock entry at all. For
   everything else the seed store is what it always was. */
function pantryAmount(id){
  const p = Array.isArray(S.pantry) ? S.pantry : [];
  const e = p.find(x=>x.k===id);
  return e ? e.n : 0;
}
/* How much is held back from the AUTOMATIC draws — the meal, the deficiency
   override, recipes, the oil press. Computed, never stored, so there is no
   second number that can drift out of sync with the stock it describes.
   Zero once the player has released the crop from the larder card, and zero
   for anything that isn't a unified crop. */
function reserveFloor(id){
  if(!isEdibleSeed(id)) return 0;
  if(((S.eatSeedReserve||{})[id]||{}).release) return 0;
  return Math.max(1, (CROPS[id]||{}).seed || 1) * SEED_RESERVE_PLANTINGS;
}
/* THE GETTER. What can go in the ground right now. Note that planting is
   never floor-limited: the floor exists to protect planting, so it would be
   incoherent for it to block planting. */
function plantableStock(id){
  return isEdibleSeed(id) ? pantryAmount(id) : ((S.seedStock && S.seedStock[id]) || 0);
}
/* THE GRANTER. Where a seed return, gift, trade, discovery or puzzle reward
   actually lands. */
function grantPlantingStock(id, n){
  if(!id || !(n>0)) return 0;
  if(isEdibleSeed(id)) return addFood(id, n);
  S.seedStock = S.seedStock || {};
  S.seedStock[id] = (S.seedStock[id]||0) + n;
  return n;
}
/* THE SPENDER, for the planting cost itself. */
function spendPlantingStock(id, n){
  if(!(n>0)) return;
  if(isEdibleSeed(id)){ takeStock(id, n); return; }
  S.seedStock[id] = Math.max(0, (S.seedStock[id]||0) - n);
}
// kept as the old name so existing callers read naturally; same granter
function addSeeds(id, n){ grantPlantingStock(id, n); }
const seedCount = id => plantableStock(id);
const totalSeeds = () => Object.keys(CROPS).reduce((a,id)=>a+plantableStock(id),0);
/* ================= mystery packets =================
   A salvaged packet whose label rotted off. It sits in S.mysterySeed until
   the player opens it, because a packet you get to hold onto and open when
   you feel like it is a small gift, and one that resolves in a log line is
   just a number going up.

   WHAT CAN BE IN ONE is botany, not balance. A seed vault is a dry basement
   archive, so it holds ORTHODOX seed — the kind that survives being dried
   and stored. Recalcitrant seed (chestnut, oak, hickory, pawpaw, hazelnut)
   dies if it dries out, so after twenty years in a basement those are dead
   nuts and cannot come out of salvage at all. And apple does not come true
   from seed — every orchard apple in history is grafted — so a packet can
   never contain one; scionwood comes off a living tree, not out of an
   archive. Those arrive by other doors: remnant orchards, travellers, trade. */
const RECALCITRANT = ["chestnut","oakhickory","pawpaw","hazelnut","persimmon"];
const CUTTING_ONLY = ["apple","strawberry"];
function packetPool(){
  return Object.keys(CROPS).filter(id=>{
    const c = CROPS[id];
    if(!c) return false;
    if(RECALCITRANT.includes(id) || CUTTING_ONLY.includes(id)) return false;
    if(c.matureYears >= 12) return false;      // the legacy plantings aren't in packets
    return true;
  });
}
/* Locked crops are IN the pool, and weighted up when the village knows few
   of them — opening a packet should be able to hand you something new, and
   that matters most early. It never fully replaces going out and looking:
   the unlock chance is a minority of draws even at its most generous. */
function rollPacket(){
  const pool = packetPool();
  if(!pool.length) return null;
  const known  = pool.filter(id=>!CROPS[id].locked || (S.crops&&S.crops[id]));
  const locked = pool.filter(id=>CROPS[id].locked && !(S.crops&&S.crops[id]));
  const scarcity = known.length ? clampNum(1 - known.length/14, 0, 1) : 1;
  const unlockChance = locked.length ? 0.18 + 0.42*scarcity : 0;
  const fromLocked = Math.random() < unlockChance;
  const from = fromLocked ? locked : (known.length ? known : locked);
  if(!from.length) return null;
  const id = from[Math.floor(Math.random()*from.length)];
  return {id, unlock: CROPS[id].locked && !(S.crops&&S.crops[id])};
}
const clampNum = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));
/* Grant a packet. Called when salvage turns one up. */
function addMysteryPacket(n){
  S.mysterySeed = (S.mysterySeed||0) + (n||1);
}
/* Open one: resolve it, unlock if it's new, and hand over the seed. The
   caller does the reveal animation; this is only the outcome. */
function openMysteryPacket(){
  if(!(S.mysterySeed>0)) return null;
  const roll = rollPacket();
  if(!roll) return null;
  S.mysterySeed--;
  const c = CROPS[roll.id];
  if(roll.unlock){ S.crops = S.crops || {}; S.crops[roll.id] = true; }
  // a real packet's worth: enough to actually plant with, more if it's new
  const n = Math.max(1, (c.seed||1) * (roll.unlock ? 3 : 2));
  grantPlantingStock(roll.id, n);
  return {id: roll.id, name: c.name, unlock: roll.unlock, n,
          perennial: !!c.perennial, seedWord: c.perennial ? "cuttings" : "seed"};
}

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
    return plantableStock(id) <= 0;       // known, and out
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

/* Takes one crop id or a list of them. The seed vault and the agricultural
   extension can now turn up several varieties in a single visit (see the
   discovery rolls in expeditions.js), and three near-identical sentences
   stacked in a row is not a journal -- it's a receipt. */
const DISC_NUM=["no","one","two","three","four","five","six","seven","eight","nine","ten"];
function discoveryLine(ids, how){
  const crops=(Array.isArray(ids)?ids:[ids]).map(id=>CROPS[id]).filter(Boolean);
  if(!crops.length) return "";
  const where = how==="explore" ? "the far country"
              : how==="forage" ? "the near country"
              : "a stripped building";
  if(crops.length===1){
    const c=crops[0];
    const seedWord = c.perennial ? "cuttings" : "seed";
    return `They brought ${seedWord} back from ${where} — ${c.name.toLowerCase()}, a crop the village hasn't grown before.`;
  }
  const names=crops.map(c=>c.name.toLowerCase());
  const joined=names.slice(0,-1).join(", ")+", and "+names[names.length-1];
  return `They came back from ${where} with seed for ${DISC_NUM[crops.length]||crops.length} crops the village has never grown: ${joined}.`;
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

/* ---- can this go in the ground right now? ----
   ONE question, ONE answer. The sow sheet asked it twice with two different
   sets of rules: the primary-crop list tested a crop's sowWindow, and the
   interplanting list didn't test it at all, so peas -- early spring or the
   very end of summer, never the heat between -- could be interplanted into
   the middle of midsummer.

   Cold frames (and, later, the greenhouse) let you sow out of SEASON. They
   do not repeal a sowing WINDOW: protected ground is warmer, it is not a
   different month. Annual beds only for now; the food forest has its own
   rules and gets its own pass when perennial layering goes in. */
function canSow(crop, protectedGround){
  if(!crop) return false;
  const sn=season();
  const inList=crop.sow.includes(sn.id);
  if(crop.perennial) return inList;
  if(crop.sowWindow){
    const w=crop.sowWindow[sn.id];
    if(!inList || !w) return false;
    const d=dayOfSeason(S.day);
    return d>=w[0] && d<=w[1];
  }
  return inList || !!protectedGround;
}

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
  /* Seeded, like the temperature it feeds: weather shifts the day's high
     and low (climate.js WX_SHIFT), so a reproducible temperature stream is
     worthless if the weather driving it isn't reproducible too. Same
     generator, same stream. */
  const r=rand(); let acc=0;
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










export { ADULT, AGES, ELDER, addSeeds, addMysteryPacket, openMysteryPacket, packetPool, plantableStock, grantPlantingStock, spendPlantingStock, reserveFloor, pantryAmount, canSow, discoverRandomUseful, isFoodCrop, lockedUseful, usefulLine, restockLine, restockRandomCrop, restockableCrops, canRoad, canWork, dayOfSeason, discoverRandomCrop, discoveryLine, generateFallbackChildName, grantSeedSpread, lockedCrops, roadReady, rollWeather, scaledWeather, season, seasonIdx, seasonNote, seedCount, totalSeeds, yearOf };
