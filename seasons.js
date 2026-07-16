import { byId, pick } from "./helpers.js";
import { S } from "./state.js";
import { WEATHERS } from "./defs.js";

/* ================= seasons =================
   A year is 4 seasons of 30 days. Winter is the one you plan for. */
const SEASON_LEN = 30;

/* Crops: sow, wait, harvest. `work` is growth-points needed; a tended bed
   accrues roughly 1.5–3/day, so a radish is a week and a squash is a month. */
/* CROPS — what can be sown in a bed. Fields:
     name    display name
     work    growth-points needed before ready (roughly: work/2.2 = days at full staffing)
     yield   food produced on harvest (scaled by F.contourBeds, reduced by fo.nibble)
     seed    seed cost to sow one bed
     seeds   seed RETURNED on harvest (0 = doesn't replenish itself; balance carefully —
              a crop that returns no seed and is the only thing sown starves the seed
              stock over time, which was a real bug once)
     sow     array of season ids ["spring","summer","autumn"] it can be planted in
     hardy   (optional) true = survives winter outdoors, sleeping under snow, instead
              of dying at first frost. The ONLY way a crop grows through deep winter
              without cold frames.
     locked  (optional) true = hidden from the sow sheet until S.crops[id] is set true
              (currently done via seed-frame puzzle rewards — see SEED_REWARD)
     note    flavor text on the sow sheet. */
/* feed: what a crop does to the bed's soil on harvest — see the "fertility" block
   in the growth loop. "legume" restores fertility (beans, peas fix nitrogen);
   "heavy" draws it down hard (the big calorie crops); unmarked/"light" draws a
   little, same as anything growing takes a little. A bed's fertility multiplies
   its growth rate — see bed.fertility and fertilityMult in simulateDay. */
const CROPS = {
  // radish and greens are the only crops available with zero discovery; beans,
  // squash, and potatoes are locked but evidently get discovered fast enough (via
  // seed-frame puzzles / other unlock triggers) to still carry most of year 1.
  // Playtest report: by end of autumn yr1 (day 90), 6 founders were sitting on 50
  // banked days of food and near-max spirits — too much slack for what's meant to
  // be the scrappy, tight phase. Cut yield ~20% on these five specifically, since
  // together they're what an early village is actually eating; locked/later crops
  // beyond these are untouched, since that's not where the reported problem is and
  // the headless-bot balance for the later game shouldn't be disturbed on a guess.
  // If this over-corrects, these are the first numbers to walk back — check
  // against a fresh save at day 90 before tightening further.
  radish:  {name:"Radishes",  work:14,  yield:16, seed:1, seeds:1, sow:["spring","summer","autumn"], feed:"light",  note:"Fast, thin, and better than nothing."},
  greens:  {name:"Greens",    work:20,  yield:24, seed:1, seeds:1, sow:["spring","summer","autumn"], feed:"light",  note:"Cut and come again, until it bolts."},
  beans:   {name:"Beans",     work:32,  yield:40, seed:2, seeds:3, sow:["spring","summer"],          feed:"legume", locked:true, note:"Feeds you, then feeds the soil, then feeds you again."},
  squash:  {name:"Squash",    work:44,  yield:58, seed:2, seeds:2, sow:["spring","summer"],          feed:"heavy", locked:true, note:"Slow, heavy, and it keeps all winter in a cold room."},
  potatoes:{name:"Potatoes",  work:38,  yield:53, seed:3, seeds:3, sow:["spring"],                   feed:"heavy", locked:true, note:"Dull, heavy, and the reason anyone survived anything. Keep back the small ones to plant."},
  grain:   {name:"Grain",     work:56,  yield:84, seed:3, seeds:4, sow:["spring","autumn"], hardy:true, feed:"heavy", locked:true, note:"The one crop frost won't kill: plant it in autumn and it sleeps under the snow, ready in spring. Slow, but it feeds a winter."},
  peas:    {name:"Peas",      work:36,  yield:52, seed:2, seeds:3, sow:["spring","summer"],
            sowWindow:{spring:[1,12], summer:[22,30]}, feed:"legume", locked:true,
            note:"Wants the cold shoulders of the year, not the middle of it. Early spring, or the very end of summer as it breaks toward autumn — never the heat between."},
  // discovered through the seed-frame puzzles; locked until then
  turnip:  {name:"Turnips",   work:22,  yield:34, seed:1, seeds:1, sow:["spring","summer","autumn"], hardy:true, locked:true, feed:"light", note:"Homely and dependable. Shrugs off an early frost and keeps in the cellar."},
  sunflower:{name:"Sunflowers",work:40, yield:44, seed:2, seeds:4, sow:["spring","summer"],          locked:true, feed:"heavy", note:"Oil for the lamps, seed for the birds, and a wall of gold that lifts the whole village."},
  amaranth:{name:"Amaranth",  work:34,  yield:56, seed:2, seeds:3, sow:["spring","summer","autumn"], locked:true, feed:"light", note:"Grain and greens both, and it grows where little else will. An old, stubborn plant."},
  // perennials: planted once, never resown. They take years to earn their keep,
  // then keep giving with almost no labor — see the perennial handling in the
  // growth loop. Each bears in exactly one season; the rest of the year they
  // simply stand, dormant through winter regardless of hardy status.
  // `native:true` perennials build the soil web (mycosphere) when planted — they
  // yield food AND restore, so they're a real choice, not a sacrifice. Apple stays
  // unflagged (Eurasian orchard stock, the thing you'd eventually turn under), and so
  // does this strawberry — it's modeled as the cultivated garden strawberry (dense
  // yield, matures in a year), not Fragaria virginiana, whose wild fruit is tiny and
  // wouldn't remotely produce at this rate. Don't borrow native credibility for the
  // wrong plant. Raspberry also unflagged: the cultivated red cane is Eurasian.
  strawberry:{name:"Strawberries", perennial:true, matureYears:1, harvestSeason:"summer",
              yield:80, seed:3, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Runners fill a plot in a year. After that, pickings all summer for almost no work."},
  blueberry: {name:"Blueberries", perennial:true, native:true, matureYears:3, harvestSeason:"summer",
              yield:150, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Highbush blueberry, native to these woods. Three slow years, then a whole summer of it, and it feeds the soil it stands in."},
  raspberry: {name:"Raspberries", perennial:true, matureYears:2, harvestSeason:"summer",
              yield:125, seed:3, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Cane fruit — raspberry, or blackberry, whichever cuttings took. Bears for weeks. Spreads if you let it."},
  apple:     {name:"Apple trees", food:"apples", perennial:true, matureYears:4, harvestSeason:"autumn",
              yield:170, seed:5, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Old grafted stock from the parking-lot rows. Four years to bear, then baskets of them every fall."},
  hazelnut:  {name:"Hazelnuts", perennial:true, native:true, matureYears:5, harvestSeason:"autumn",
              yield:200, seed:5, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"American hazelnut, native stock. Five years to a real harvest, then a wall of nuts every autumn, and roots that hold the hillside."},
  // the rest of the native forest crops, researched rather than guessed —
  // maturity years drawn from real extension/nursery sources, yield tiers
  // reasoned by relative fruit size and prolificacy against what's already here.
  pawpaw:    {name:"Pawpaw", perennial:true, native:true, matureYears:6, harvestSeason:"autumn",
              yield:170, seed:6, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Asimina triloba — the largest fruit native to this continent, custard-sweet, and it needs two trees near each other to set anything. Five or six years before the first ones fall."},
  persimmon: {name:"American persimmon", perennial:true, native:true, matureYears:8, harvestSeason:"autumn",
              yield:160, seed:6, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Diospyros virginiana, and usually a male tree and a female tree both, or nothing sets. Bitter unripe, honey-sweet after the first hard frost softens it. A slow tree — plant it for later."},
  mulberry:  {name:"Red mulberry", perennial:true, native:true, matureYears:5, harvestSeason:"summer",
              yield:130, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Morus rubra — not the white mulberry that escaped every hedge in the old world, the real native one. Five years, then it drops fruit for weeks like it's trying to give the whole thing away."},
  cranberrybush:{name:"Cranberrybush viburnum", perennial:true, native:true, matureYears:4, harvestSeason:"autumn",
              yield:100, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Viburnum trilobum — tart, close cousin of the true cranberry only in name. Four years to bear, and it bears heavily; you'll want a lot of them to make the harvest worth the tartness."},
  chestnut:  {name:"American chestnut", perennial:true, native:true, matureYears:5, harvestSeason:"autumn",
              yield:190, seed:6, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Castanea dentata — sweeter and faster than people expect; it was bearing in five years before the blight took the species down to almost nothing. Plant it anyway. Some things are worth trying to bring back."},
  // a legacy planting: real oak and hickory don't mast until ~20 years old, peak
  // decades after that — genuinely outside any playthrough. It's here so the
  // choice to plant it can be made honestly: not a crop with a payoff, a gift
  // to whoever's still tending this ground when it's grown.
  oakhickory:{name:"Oak & hickory mast", perennial:true, native:true, matureYears:40, harvestSeason:"autumn",
              yield:150, seed:8, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"White oak and shagbark hickory. In the wild these don't produce a first acorn or nut until they're grown themselves — twenty years, more. Nobody who plants this expects to pick from it. Someone else will."}
};

/* Preservation: fresh food spoils; preserved food does not.
   Preserving costs a day of someone's hands and some of the food itself. */
/* PRESERVE — the three ways to turn fresh food into food-that-keeps. Each is unlocked
   by the matching PROJECTS entry (id must match the `flag` here — e.g. building the
   "dryRacks" project sets S.flags.dryRacks, which is what `flag` below checks for).
   Fields: name, flag (S.flags key that must be true to use this method), rate (base
   food/day one worker converts, before their care skill is added — see the
   "preservation" phase in simulateDay), loss (fraction lost to the process itself —
   this food never becomes preserved food, it's just gone). Two workers max; see the
   `preserve` entry in SHEET_META for the cap. */
const PRESERVE = {
  drying:     {name:"Drying racks",  flag:"dryRacks",  rate:2.8, loss:0.20, blurb:"Sun, air, patience. Loses a fifth to the process."},
  fermenting: {name:"Crocks",        flag:"crocks",    rate:2.4, loss:0.08, blurb:"Salt and time. Loses almost nothing, and it's good for people."},
  canning:    {name:"Canning",       flag:"canning",   rate:3.6, loss:0.12, blurb:"Jars, lids, heat. Fastest by far — when the power holds."}
};

/* Fabrication ends the salvage economy. Each ends one reason to leave. */
/* FABS — fabrication projects. Each is a one-time build (cost + work, like PROJECTS)
   that, once finished, produces FAB_RATE[gives] of resource `gives` EVERY DAY FOREVER
   (see the "fabrication" phase in simulateDay). This is the endgame pivot: fabs let
   the village stop depending on finite salvage sites. Fields: id, name, cost, work,
   gives (a key into S.res / FAB_RATE), blurb. */
const FABS = [
  {id:"seedSaving", name:"Seed saving",   cost:{seeds:4},           work:16, gives:"seeds",
   blurb:"Save the best, sow the best. The seed vault stops mattering."},
  {id:"forge",      name:"The forge",     cost:{scrap:16, parts:4}, work:30, gives:"scrap",
   blurb:"Charcoal, bellows, an anvil off a truck axle. Scrap becomes stock."},
  {id:"machineShop",name:"Machine shop",  cost:{scrap:20, parts:12},work:40, gives:"parts",
   blurb:"A lathe that runs off the grid. Bearings, fittings, the small hard things."},
  {id:"apothecary", name:"Apothecary",    cost:{seeds:8, meds:4},   work:26, gives:"meds",
   blurb:"Willow, yarrow, poppy, and a good book. Medicine you grow."}
];
const FAB_RATE = {seeds:0.35, scrap:0.9, parts:0.5, meds:0.25};

/* Age in years. Time is measured in winters, because that is how it is felt. */
const AGES = {nadia:34, ora:29, bec:31, sam:44, yusuf:38, petra:52, ilya:27,
              june:61, marisol:33, theo:16, ash:40, kav:47,
              rosa:36, emrys:30, din:24, halla:57, moss:66, yara:35};
const CHILD_NAMES = ["Wren","Alder","Fen","Sorrel","Reed","Juniper","Hazel","Rook","Linnet","Tamsin","Bram","Vesper",
  "Sage","Briar","Marsh","Thistle","Cedar","Larkin","Moss","Sable","Aster","Fennel","Rye","Willow",
  "Clover","Ash","Merrow","Pike","Quill","Sorel","Teal","Yarrow"];
// Deterministic fallback so a child is never lost to name exhaustion, even in a very old,
// very lucky village that outlasts the pool above.
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
const CHILD_NOTES = [
  "Born in the village. Has never seen a working streetlight.",
  "Knows every path on the ridge before knowing how to read.",
  "Grew up thinking the turbine's hum was the sound of night.",
  "Learned to plant before learning to count."
];
const ADULT=16, ELDER=62;
const canWork = p => p.age>=ADULT;
const canRoad = p => p.age>=ADULT && p.age<ELDER && !(p.perm==="leg");
const roadReady = p => canRoad(p) && p.status==="ok";
const SEASONS = [
  {id:"spring", name:"Spring", wx:[0.38,0.28,0.34],
   solar:0.9,  heat:0,    grow:1.15, forage:0.9,  roadDays:1,
   note:"Mud to the ankles, and everything trying at once."},
  {id:"summer", name:"Summer", wx:[0.62,0.24,0.14],
   solar:1.15, heat:1,    grow:1.0,  forage:1.15, roadDays:0,
   note:"Long light, thin water, and the tanks running warm."},
  {id:"autumn", name:"Autumn", wx:[0.45,0.33,0.22],
   solar:0.85, heat:0,    grow:0.85, forage:1.35, roadDays:0,
   note:"The year's whole answer comes in at once. Put it by."},
  {id:"winter", name:"Winter", wx:[0.4,0.42,0.18],
   solar:0.5,  heat:0,    grow:0.0,  forage:0.35, roadDays:1,
   note:"Nothing grows outdoors. You eat what you kept, or you don't eat."}
];
const seasonIdx = day => Math.floor((day-1)/SEASON_LEN) % 4;

// crop discovery: most crops start locked and are found over time -- through
// expeditions that turn up seed or rootstock, or the seed-frame puzzles. Radish
// and greens are the only two a village starts knowing.
function lockedCrops(){
  return Object.keys(CROPS).filter(id => CROPS[id].locked && !(S.crops && S.crops[id]));
}
// unlock a random still-locked crop (optionally filtered), returning its id or null
function discoverRandomCrop(filter){
  let pool = lockedCrops();
  if(filter) pool = pool.filter(filter);
  if(!pool.length) return null;
  const id = pool[Math.floor(Math.random()*pool.length)];
  S.crops = S.crops || {};
  S.crops[id] = true;
  return id;
}
function discoveryLine(id, how){
  const c=CROPS[id]; if(!c) return "";
  const name=c.name.toLowerCase();
  const seedWord = c.perennial ? "cuttings" : "seed";
  const where = how==="explore" ? "the far country"
              : how==="forage" ? "the near country"
              : "a stripped building";
  return `They brought ${seedWord} back from ${where} — ${name}, a crop the village hasn't grown before. Something new to put in the ground.`;
}
const FORAGE_FLAVOR = {
  spring:"Fiddleheads, ramps, nettle tops, the first dandelion greens. Spring foraging is thin but bright — the woods are barely awake.",
  summer:"Berries, chanterelles, purslane, lambsquarters, green walnuts. High summer gives the most, if you know where to look.",
  autumn:"Acorns, hickory nuts, hen-of-the-woods, rose hips, the last apples gone wild. Autumn is the year's real harvest from the near country.",
  winter:"Bark, rose hips frozen sweet, cattail root, whatever the squirrels cached and forgot. Winter foraging is hungry work for little return."
};
const season    = () => SEASONS[seasonIdx(S.day)];
const yearOf    = day => 1 + Math.floor((day-1)/(SEASON_LEN*4));
const dayOfSeason = day => ((day-1) % SEASON_LEN) + 1;
const isWinter  = () => season().id==="winter";
// the SEASONS table's note is written for the common case (no cold frames);
// this corrects it wherever it's actually shown, so it never contradicts the
// crop list right below it (which already lets hardy/cold-framed crops grow)
const seasonNote = s => (s.id==="winter" && S.flags && S.flags.coldFrames)
  ? "Frozen outside, but the cold frames keep a few beds going all winter — slow, but alive."
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


export { ADULT, AGES, CHILD_NAMES, CHILD_NOTES, CROPS, ELDER, FABS, FAB_RATE, FORAGE_FLAVOR, PRESERVE, SEASONS, SEASON_LEN, canRoad, canWork, dayOfSeason, discoverRandomCrop, discoveryLine, generateFallbackChildName, lockedCrops, roadReady, rollWeather, scaledWeather, season, seasonIdx, seasonNote, yearOf };
