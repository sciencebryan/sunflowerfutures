import { S } from "./state.js";
import { baseTarget, comfortBand, commonsTemps, drinkHeatMult, frostKills, gapRate, greenhouseTarget,
         greenhouseTemps, growthMult, irrigationHeatMult, meltSnow, soilDiscount,
         tickClimate } from "./climate.js";
import { getState as rngGetState, setSeed as rngSetSeed, setState as rngSetState, rand as crand } from "./rng.js";
import { ELDER, canRoad, canWork, dayOfSeason, generateFallbackChildName, grantSeedSpread, rollWeather, scaledWeather, season, seasonIdx, seasonNote, yearOf } from "./seasons.js";
import { AC_MAX, HEATER_DRAW, HEATER_MAX, HEATER_BREAK_BASE, HEATER_BREAK_LOAD, WOOD_STOVE_MAX,
         AC_DRAW, WELL_DRAW, AQUA_STAGNANT_WEAR, BATTERY_UNIT, CANNING_DRAW, CANNING_MIN_STOCK, CROPS, DAY_MS, FABS, FAB_DRAW, FAB_RATE, JOB_PRACTICE, LOSS_DECAY, MAX_FOREST_PLOTS, NO_CLEANING_SICK, OFFLINE_CAP, POLLINATOR_YIELD, POWER_LOSS_BASE, PRACTICE_BROAD_CAP, PRACTICE_BROAD_DECAY, PRACTICE_BROAD_GROWTH, PRACTICE_SPECIFIC_CAP, PRACTICE_SPECIFIC_DECAY, PRACTICE_SPECIFIC_GROWTH, PRESERVE, PROJECTS, RESTORE_IN, SEASONS, SEASON_LEN, SOLAR_UNIT, SYS, TURBINE_UNIT, WATER_LOSS_BASE, WITHER_CHANCE, YIELD_SOIL_FLOOR, YIELD_TEND_MAX, YIELD_TEND_SCALE } from "./data-economy.js";
import { Cap, byId, clamp, decayPractice, eff, effStat, growPractice, hasHave, isAre, mult, objp, pick, poss, practiceOf, subj, wbFloor, working } from "./helpers.js";
import { TRAITS, VISUALS, addRes, addRestore, built, decayOf, foodCap, stepRestoration, waterCapEff } from "./defs.js";
import { tickExpeditions } from "./expeditions.js";
import { CHILD_NAMES, CHILD_NOTES, FV } from "./data-events.js";
import { bestSpecific, practiceLabel, renderAll } from "./render.js";
import { maybeSpawnEvent, resetSeasonFlares, tickDepartures, tickDinnerBonds, tickFriction, tickRelationships, tickVillageSpiritsStreak } from "./events.js";
import { store } from "./store.js";
import { rollMusic, rollPersonality } from "./bonds.js";
import { driftIdeology, seedIdeology } from "./ideology.js";
import { addFood, addForage, addPreserved, bestMethodFor, cookRecipe, decayStock, eatFresh, eatJars,
         eatForDeficiency, jarComposition, pantryTotal, preserveInto, resync, stockOf, stockTakingMethod,
         takeStock, tickMacros } from "./larder.js";
import { COMP_FERT, COMP_YIELD, FOOD_DATA, MAX_COMPANIONS, PRES_METHOD_OF, RIVAL_YIELD, famOf, famPair } from "./data-food.js";
import { tickConflicts } from "./mediation.js";
import { tickMoments } from "./moments.js";
import { tickCelebCooldowns, tickTraditions } from "./celebrations.js";
import { accrueToxins, toxDeathAdd, toxPracticeMult, toxSickMult } from "./toxins.js";
import { addMemory, addMemoryAll, drawnToCare, pushRecentEvent, recordGone,
         reluctance, tickMemories, tickRecentEvents } from "./memories.js";
import { tickConversations } from "./conversations.js";
import { MEM_TEXT } from "./data-memories.js";









/* ================= one day of the world ================= */
/* =========================================================================
   simulateDay() — one tick of the village clock. Called once per real day
   (via catchUp) or once per manual "end the day" tap. Everything the game
   does happens here, in this order. If you're hunting for where a number
   comes from, find its phase below and jump to the matching "// --- x ---"
   comment in the function body.

     1.  weather        — rollWeather() picks today's weather, seasonally weighted
     2.  power           gen (solar/turbine, weather-scaled) vs draw; brownout if short
     3.  water           catchment in vs people+gardens+irrigation out; thirst if short
     4.  food: beds       crop growth (seasonal, drought-stressed), then harvest
     5.  food: totals     aquaponics + gardens + trickle, minus mouths, minus cooking loss
     6.  preservation     hands turn fresh food into food that keeps (drying/crocks/canning)
     7.  spoilage         fresh food left over decays (faster in summer)
     8.  fabrication      forge/machine-shop/etc progress, then their daily output
     9.  crises           storms, rats, equipment breakdown, crop blight (random, escalate w/ village age)
    10.  maintenance      built systems decay; hands assigned to them repair
    11.  work-in-progress project/system construction gets today's labour applied
    12.  spirits          commons aura, cooks, carers, food variety, hunger/thirst strain
    13.  illness           random sickness checks against wellbeing
    14.  the turn of year  once a year, in winter: aging, births, deaths, departures
    15.  events            maybe spawn a decision-point event for the player
    16.  expeditions        parties out foraging/exploring/salvaging resolve if due
    17.  journal            everything above gets written up into today's entry

   State mutated: S.res, S.sys, S.beds, S.preserved, S.people, S.fabs,
   S.fabProject, S.project, S.puz (indirectly, via journal), S.journal,
   S.day (NOT incremented here — see endDayNow/catchUp), S.report (a
   snapshot of today's numbers, read by the UI to explain totals).
   ========================================================================= */
/* Captures, at the START of a day (before anything mutates), what job each
   person is actually credited with today — resolving the two dynamic cases
   (project -> the SYS or PROJECTS id being worked; fab -> the FABS id under
   construction) using S.project/S.fabProject as they stand RIGHT NOW, so a
   project that finishes partway through today's tick still credits the
   people who did the work. Expedition members are captured separately from
   S.expeditions, since they carry job:"away" rather than a job id. */
function buildWorkSnapshot(){
  const snap={};
  for(const p of S.people){
    if(!canWork(p)) continue;                              // children don't practice a trade yet
    if(p.status!=="ok" && p.status!=="spent") continue;     // down/away credited elsewhere or not at all
    const j=p.job;
    if(!j) continue;
    if(j==="project" && S.project){
      if(S.project.kind==="build"){ const d=SYS.find(x=>x.id===S.project.id); if(d) snap[p.id]={specific:d.id, broad:"hands"}; }
      else { snap[p.id]={specific:null, broad:"hands"}; }    // a one-off PROJECTS build: general handiness only
    } else if(j==="fab" && S.fabProject){
      snap[p.id]={specific:S.fabProject.id, broad:"hands"};
    } else if(JOB_PRACTICE[j]){
      snap[p.id]=JOB_PRACTICE[j];
    }
  }
  for(const ex of S.expeditions){
    for(const pid of ex.party){
      if(ex.injured.includes(pid)) continue;                // hurt and out of it — not practicing today
      snap[pid]={specific:ex.type, broad:"wild"};            // ex.type is "forage"/"explore"/"salvage"
    }
  }
  return snap;
}

/* Applies today's practice growth/decay to every person, using the snapshot
   taken at the top of the day. Whatever a person worked today grows a little
   toward its cap; everything else they've ever built up decays a little.
   Called near the end of simulateDay, so today's bonus (read via effStat
   throughout the day's math) reflects YESTERDAY's practice — today's work
   only pays off starting tomorrow. */
function applyPracticeUpdate(snap){
  for(const p of S.people){
    const pr = practiceOf(p);
    const today = snap[p.id];   // {specific, broad} or undefined if they did nothing creditable

    // specific: grow today's key (if any), decay every other key already on record
    const tox = toxPracticeMult(p);   // a dulled person learns slower, and never knows why
    if(today && today.specific!=null){
      pr.specific[today.specific] = growPractice(pr.specific[today.specific]||0, PRACTICE_SPECIFIC_CAP, PRACTICE_SPECIFIC_GROWTH*tox);
    }
    for(const k in pr.specific){
      if(today && k===today.specific) continue;
      pr.specific[k] = decayPractice(pr.specific[k], PRACTICE_SPECIFIC_DECAY);
    }

    // broad: grow today's category, decay the other three
    for(const cat of ["hands","green","care","wild"]){
      if(today && today.broad===cat) pr.broad[cat] = growPractice(pr.broad[cat]||0, PRACTICE_BROAD_CAP, PRACTICE_BROAD_GROWTH*tox);
      else pr.broad[cat] = decayPractice(pr.broad[cat]||0, PRACTICE_BROAD_DECAY);
    }
  }
}

/* Composes one journal line about the evening meal -- "what's for dinner" --
   from what the village actually has on hand: fresh produce (recent bed
   harvests, tracked in S.dietLog), fish from the tanks, food put by in the
   stores, forage brought in lately, and sunflower oil if any was pressed
   recently. The player never sees a pantry list; they just get the meal.
   How well it reads scales with the cook and the kitchen: a skilled cook with
   a canning kitchen and crocks sets a very different table than thin soup over
   a single stove. Returns "" to stay quiet (it doesn't fire every day). */
/* ================= the battery bank =================
   Batteries are the one system nobody maintains. Turbine bearings and
   irrigation joints wear, and a person with the right hands genuinely
   reverses that — battery capacity loss is chemistry, and no amount of
   labour reverses it. So the bank has decay:0 and noRepair:true in SYS,
   and its real state lives here: S.cells, one entry per wired-in pack,
   each fading on its own clock from the day it went in.

   Salvaged packs come in already part-used (they've been sitting in a
   substation or a wrecked house for a decade), so a new bank is never as
   good as the last one was when it was new. The only way back up is going
   out and finding more. */
const CELL_FADE = 0.00035;   // ~4.2% of original capacity per game year
const CELL_DEAD = 0.15;      // below this a pack is scrap, not storage
function cells(){
  if(!Array.isArray(S.cells)) S.cells = [{cap:0.9, since:S.day||1}];
  return S.cells;
}
function bankCapacity(){
  const F = S.f||{};
  const sum = cells().reduce((a,c)=>a+Math.max(0,c.cap),0);
  return (F.batteryRecond?1.857:1) * BATTERY_UNIT * sum;
}
/* Runs once a day. Fades every pack, retires the ones that are finished. */
function tickCells(lines){
  const cs = cells();
  for(const c of cs) c.cap = Math.max(0, c.cap - CELL_FADE);
  const dead = cs.filter(c=>c.cap <= CELL_DEAD);
  if(dead.length){
    S.cells = cs.filter(c=>c.cap > CELL_DEAD);
    S.batteries = Math.max(0, S.cells.length);
    // scrap value: the case and the wiring are still worth something
    S.res.scrap = (S.res.scrap||0) + dead.length*2;
    lines.push(dead.length===1
      ? "One of the packs finally stopped holding anything. It came out of the bank and went into the scrap pile."
      : `${dead.length} of the packs stopped holding anything, and came out of the bank.`);
    if(!S.cells.length) lines.push("There is nothing left in the bank room now. Whatever the panels make has to be used the day it's made.");
  }
}

/* A noun phrase for whatever is actually on the preserved shelves — the
   biggest holding, named by its real preservation method. */
function keptPhrase(){
  const js = jarComposition();
  if(!js.length) return "what was put by";
  const top = js[0];
  const byMethod = {
    dry: [`${top.name}, dried and come back to life in the pot`, `dried ${top.name}, soaked since morning`],
    ferment: [`${top.name} up out of the crocks, sharp and good`, `soured ${top.name} from the crocks`],
    can: [`${top.name} out of a jar, sealed in a better month`, `jarred ${top.name} from the good weeks`]
  };
  const pool = byMethod[top.m] || byMethod.dry;
  return pool[Math.floor(Math.random()*pool.length)];
}

function dinnerLine(){
  const cook = working("cook")[0];
  const starving = (S.res.food + S.preserved) < 3 || (S.hungerDays||0) > 0;
  // today's facts from the food block, so this line can't contradict them:
  // fromJars > 0 means the fresh stores ran out and the shelves covered it —
  // whatever else is true, this was not a night of plenty.
  const fromJars = (S.report && S.report.fromJars) || 0;
  const variety  = (S.report && S.report.varietyMood) || 0;
  const leanNight = fromJars > 0.2;
  // gather what's available. Sunflower is excluded from the fresh-veg list --
  // it shows up as oil instead (see oilBit), so it isn't named twice in one line.
  const freshCrops = [...new Set(S.dietLog.filter(e=>S.day-e.day<=5 && e.crop!=="sunflower").map(e=>e.crop))];
  const freshNames = freshCrops.filter(c=>CROPS[c]).map(c=>CROPS[c].food || CROPS[c].name.toLowerCase());
  const hasOil   = stockOf("oil") > 0.3;
  const hasFish  = built("aquaponics") && S.sys.aquaponics.cond>25;
  const hasKept  = S.preserved > 5;
  const hasForaged = (S.lastForageDay!==undefined) && (S.day - S.lastForageDay <= 4);
  const components = freshNames.length + (hasFish?1:0) + (hasKept?1:0) + (hasForaged?1:0);

  // kitchen quality: cook skill (with practice) plus what's been built
  const cookSkill = cook ? effStat(cook,"care","cook") : 0;
  const tools = (S.flags.canning?1:0)+(S.flags.crocks?1:0)+(S.flags.rootCellar?1:0)+(S.flags.dryRacks?1:0);
  const quality = cookSkill + tools*0.6 + (cook?1:0);

  const pick1 = arr => arr[Math.floor(Math.random()*arr.length)];
  const list = names => names.length<=1 ? (names[0]||"what there was")
                : names.slice(0,-1).join(", ")+" and "+names[names.length-1];

  // starving overrides everything
  if(starving){
    return pick1([
      "Dinner was inadequate — whatever vegetable bits were left, boiled into a weak soup.",
      "Not much of a supper. Everyone went to bed still a little hungry.",
      "We stretched the last of the food into a thin soup. It wasn't enough."
    ]);
  }
  // no cook on the hearth: food gets eaten, but nobody made anything of it
  if(!cook){
    if(components===0) return "";
    return pick1([
      `Supper was cold and quick — ${list(freshNames.length?freshNames:["stores"])}, eaten standing up. Nobody cooked tonight.`,
      "People ate at odd hours, whatever required minimal prep. No one took cooking duty today."
    ]);
  }

  const oilBit = hasOil ? pick1([" fried bright in sunflower oil"," glistening with sunflower oil and salt"," crisped in oil"]) : "";
  // keptBit is now a plain noun phrase, not a connector-prefixed fragment -- it
  // flows through list() like everything else instead of bolting on a second "and"
  // Reads the actual jars. This used to draw from a fixed flavour pool and
  // could cheerfully announce pickles from crocks the village hadn't built,
  // holding food it didn't have — harmless when `preserved` was one number,
  // plainly wrong now that jars are real and typed.
  const keptBit = hasKept ? keptPhrase() : "";
  const fishBit = hasFish ? pick1(["the day's fish","trout from the tanks","fish, fresh from the tanks"]) : "";
  const forageBit = hasForaged ? pick1(["mushrooms someone found on the ridge","wild-picked greens","what the foragers gathered"]) : "";

  // the shelves were opened to cover the day: say so, and don't dress it up
  if(leanNight){
    const kept = keptBit || "what was put by";
    return pick1([
      `Dinner came up out of the jars tonight — ${kept}. The fresh stores didn't reach.`,
      `${Cap(cook.name)} opened the shelves to make up the difference. ${Cap(kept)}, and enough of it.`,
      `Not much came in today, so the stores went out: ${kept}.`
    ]);
  }
  // the same thing, again, for weeks
  if(variety <= -0.4){
    const one = freshNames[0] || (fishBit ? "fish" : "the stores");
    return pick1([
      `${Cap(one)} again. Nobody complained out loud about it.`,
      `Another supper of ${one}. It feeds people. That is the most that can be said for it.`,
      `${Cap(one)}, the same as last week and the week before.`
    ]);
  }
  // high quality + real variety -> a proper spread
  if(quality>=3.5 && components>=3){
    const parts=[];
    if(freshNames.length){ parts.push(`${list(freshNames)}${oilBit}`); if(oilBit) takeStock("oil", 0.4); }
    if(fishBit) parts.push(fishBit);
    if(forageBit) parts.push(forageBit);
    if(keptBit) parts.push(keptBit);
    const spread = list(parts);
    return pick1([
      `A real supper tonight: ${spread}. ${Cap(cook.name)} did it justice.`,
      `The table was worth sitting at — ${spread}. Somebody hummed while they washed up.`,
      `${Cap(cook.name)} put together a proper meal: ${spread}. People seemed glad for it.`
    ]);
  }
  // decent meal
  if(quality>=1.8 && components>=1){
    const parts = freshNames.length ? [`${list(freshNames)}${oilBit}`] : (fishBit ? [fishBit] : ["the stores"]);
    if(freshNames.length && oilBit) takeStock("oil", 0.4);
    if(keptBit) parts.push(keptBit);
    const main = list(parts);
    return pick1([
      `Dinner was warm and nourishing: ${main}.`,
      `${Cap(cook.name)} made ${main}. Nobody left the table hungry.`,
      `A good supper — ${main}.`
    ]);
  }
  // simple but fed
  if(components>=1){
    const main = freshNames.length ? list(freshNames) : (fishBit || "stores");
    return pick1([
      `Supper was simple: ${main}, boiled and shared.`,
      `${main.charAt(0).toUpperCase()+main.slice(1)} again... but at least there was enough for everyone.`
    ]);
  }
  return "";
}


/* How much summer relief the shade trees give — nothing for years, then
   real cooling once they're up. Reuses the food-forest plot system whole:
   a shade tree is just a perennial with no harvest season, so the bearing
   loop skips it and only this reads it. */
function shadeCooling(){
  let n = 0;
  for(const plot of (S.forest||[])){
    if(!plot.crop) continue;
    const c = CROPS[plot.crop];
    if(!c || !c.shade) continue;
    const ageYears = (S.day - plot.plantedDay) / (SEASON_LEN*4);
    n += clamp(ageYears / (c.matureYears||5), 0, 1);
  }
  // a forest plot is a stand, not a single tree — one mature plot already
  // shades the building; a second is worth planting but not twice as good
  return Math.min(0.45, n * 0.35);
}

/* Everything temperature does to people, applied once, after the power
   block has decided whether the cooling unit ran. Two tiers:
   - a continuous daily comfort effect, so shelter matters every day of
     summer and winter rather than only on the 15% that roll an extreme
   - the extreme-event consequences, unchanged in their severity */
/* `safety` is derived from real degrees now rather than being the input:
   1 = inside the comfort band, 0 = 15F or more outside it. Everything
   downstream that used to read a comfort scalar keeps working, but the
   number now MEANS something — and, critically, a cold Commons is cold
   because of a temperature, not because a season id said so. */
function applyTemperature(lines, tempEvent, commonsT, band, isSummer, isWinter, yr1){
  const miss = Math.max(0, band.lo - commonsT.mean, commonsT.mean - band.hi);
  const safety = clamp(1 - miss/15, 0, 1);
  const indoorSafety = safety;

  // --- the everyday cost of poor shelter ---
  // TUNING: these two rates are the first knob to check. At 1.2/0.9 a bare
  // first winter costs about 36 wb across the season — heavy, felt, and
  // survivable. Much above this and poor shelter alone drives departures
  // before the heater's parts cost can realistically be met.
  if (safety < 0.85) {
    const bite = (commonsT.mean < band.lo ? 1.2 : 0.9) * (1 - safety) * (yr1 ? 0.28 : 1);
    for (const p of S.people) {
      if (p.status === "away") continue;
      p.wb = clamp(p.wb - bite, wbFloor(p), 100);
    }
    // said once a season, on the day it starts, so it registers without nagging
    if (isWinter && dayOfSeason(S.day) === 1 && yearOf(S.day) === 2) {
      lines.push("This winter has a different edge to it than the last one. The first year here was kind, and nobody had understood that it was being kind.");
    }
    if (dayOfSeason(S.day) === 2 && safety < 0.4) {
      lines.push(isWinter
        ? "The Commons never really gets warm. People keep their coats on indoors and go to bed early to be out of it."
        : "The Commons holds the day's heat well past dark. Nobody sleeps well in this.");
    }
  }

  // --- the extremes ---
  if (tempEvent === "heatwave") {
    lines.push("A blistering heatwave today.");
    // climate.js only flags an extreme on the day the front lands, so this
    // fires once per event rather than once per day of it
    addMemoryAll(S.people.filter(q=>q.status!=="away" && canWork(q)), {
      kind:"heatwave", text:MEM_TEXT.heatwave(), intensity:0.4, valence:-0.4,
      tags:{subject:"weather"}});
    pushRecentEvent({kind:"heatwave", text:"the week the heat wouldn't break", weight:1.2,
                     tags:{subject:"weather"}});
    for (const p of S.people) {
      if (!canWork(p) && indoorSafety < 0.5 && Math.random() < 0.3) {
         p.wb = clamp(p.wb - 10, wbFloor(p), 100);
         lines.push(`${p.name} wilted in the heat. The children need a cooler place to rest.`);
      }
      // Outdoor workers risk heat exhaustion
      const isOutdoors = ["garden", "project", "woodcut", "salvage"].includes(p.job) || p.status === "away";
      if (isOutdoors && Math.random() < 0.35) {
        if (p.status === "ok") {
          p.status = "spent";
          lines.push(`${p.name} worked too hard outside and came back exhausted.`);
        } else if (p.status === "spent") {
          p.status = "down";
          p.downDays = 2; p.downSince = S.day;   // see the care block: not also a recovery day
          lines.push(`Heatstroke. ${p.name} collapsed in the sun and had to be carried to the sickbed.`);
        }
      }
    }
  }

  if (tempEvent === "deepfreeze") {
    lines.push("A deep, killing freeze settled into the valley.");
    addMemoryAll(S.people.filter(q=>q.status!=="away" && canWork(q)), {
      kind:"deepfreeze", text:MEM_TEXT.deepfreeze(), intensity:0.4, valence:-0.4,
      tags:{subject:"weather"}});
    pushRecentEvent({kind:"deepfreeze", text:"the week the cold wouldn't break", weight:1.2,
                     tags:{subject:"weather"}});
    for (const p of S.people) {
      // The vulnerable are at extreme risk if indoor safety is low
      if (p.age >= ELDER && indoorSafety < 0.5) {
         p.wb = clamp(p.wb - 20, wbFloor(p), 100);
         // Spikes the death roll for elders handled in the aging block
         if (Math.random() < 0.15) {
           p.status = "down";
           p.downDays = 4; p.downSince = S.day;   // see the care block
           lines.push(`The bitter cold got into ${p.name}'s bones. ${Cap(subj(p))} is in a bad way.`);
         }
      }
      // Expeditions caught in a blizzard
      if (p.status === "away" && Math.random() < 0.4) {
        p.wb = clamp(p.wb - 15, wbFloor(p), 100);
        lines.push(`${p.name} is caught out on the road in the freeze. A dangerous night to be away from the hearth.`);
      }
    }
    if (indoorSafety < 0.5) {
      lines.push("Without enough heat or insulation, the cold seeped into the Commons.");
      S.people.forEach(q => { if (q.status !== "away") q.wb = clamp(q.wb - 8, wbFloor(q), 100); });
    }
  }

}

function simulateDay(){
  // captured before anything else runs — see buildWorkSnapshot() for why
  const workSnapshot = buildWorkSnapshot();
  const lines=[...S.pending]; S.pending=[];
  // if a forecast was made for today (see the end of this function), honor it —
  // the log only means something if it's actually right
  /* Restore the seeded stream before ANYTHING climatic draws from it —
     rollWeather() is the first consumer, and it feeds the temperature. */
  if(!S.rngState) rngSetSeed(S.seed || 1); else rngSetState(S.rngState);
  const wx = S.forecast ? scaledWeather(S.forecast) : rollWeather();
  S.weather=wx.id;
  const F=S.flags;
  const sn=season();


  // --- CLIMATE ---
  const isSummer = sn.id === "summer";
  const isWinter = sn.id === "winter";
  const yr1 = yearOf(S.day) === 1;

  /* Reproducibility: the weather stream is seeded and its position is saved
     with the game, so the same seed replays the same year exactly — and a
     reload picks the stream up where it left off rather than restarting
     the season's weather. Only climate draws from this generator; see
     rng.js for why the rest of the game still uses Math.random. */
  const clim = tickClimate(wx);
  S.rngState = rngGetState();

  /* An extreme is no longer an independent coin-flip laid on top of a
     season id — it IS a large frontal kick, so "it lasted a few days"
     falls out of the anomaly it leaves behind instead of needing its own
     duration rule. Year 1's mildness now lives in the temperature curve
     itself (climate.js trendOffset), not in a separate probability. */
  const tempEvent = clim.extreme;
  const outHi = clim.out.hi, outLo = clim.out.lo;

  // indoorSafety: 0 = dangerously exposed, 1 = perfectly comfortable.
  // PASSIVE contributions only are computed here. The one powered option
  // (the cooling unit) is added after the power block resolves, because
  // whether it runs at all depends on the brownout — a machine that fails
  // exactly when everyone is running everything is the whole argument
  // against depending on it. See applyTemperature() below.
  /* The old `indoorSafety` 0-1 comfort scalar is gone. Its contributors
     survive, re-expressed as the three physically different things they
     actually are:
       groundCoupling  - berming and earth tubes tie the building to deep
                         soil (~52F year-round). This is the term that
                         actually holds the Commons above outdoor-mean
                         through a cold month with no fire lit.
       loadReduction   - shade and the windcatcher cut the SUMMER heat
                         load; they subtract from the target.
       massDamping     - thermal mass and draught-proofing only slow how
                         fast the building tracks its target. A lag can
                         never change where the target sits, which is why
                         folding all three into one damping number (as an
                         earlier pass did) quietly meant insulation alone
                         couldn't keep anyone warm.  */
  let groundCoupling = 0, loadReduction = 0, massDamping = 0.35, heatIn = 0, coolIn = 0;
  const hearthParts=[];
  const addWarm=(label,amt)=>{ hearthParts.push([label,amt]); };
  // the patchwork puzzle: each finished draft seals the Commons a little,
  // both seasons — S.puz.patch is read directly, no flags
  const patchSeal = Math.min((S.puz&&S.puz.patch)||0, 6) * 0.03;
  // year-round now, not winter-only: ground coupling cools in summer for
  // exactly the same reason it warms in winter
  if (F.earthBerming) { groundCoupling += 0.40; addWarm("earth-bermed walls", 0.40); }
  if (F.earthTubes)   { groundCoupling += 0.25; addWarm("earth tubes", 0.25); }
  if (patchSeal>0)    { massDamping += patchSeal; addWarm("patchwork draught-proofing", patchSeal); }
  if (F.rocketHeater || F.woodStove) massDamping += 0.12;   // stone holds what it's given

  const band = comfortBand(sn.id);
  if (true) {
    /* WOOD. The fire used to burn a flat 3 (or 1.5) a day whenever it was
       winter, and deliver a flat comfort bump. Now the burn scales with the
       gap it's actually being asked to close: a mild day genuinely costs
       less firewood than a bitter one, which is the whole point of having a
       temperature at all. */
    /* Feed-forward: measure against the UNHEATED building, not against
       yesterday's heated indoor temp. Aiming a couple of degrees inside
       the band rather than exactly at its floor, so a normal winter day
       lands comfortable instead of permanently one degree short. */
    const unheated = baseTarget(clim.out.mean, groundCoupling, 0);
    const heatGap = Math.max(0, (band.lo + 2) - unheated);
    const burnFull = F.rocketHeater ? 1.5 : 3;          // a full day's burn
    const want = gapRate(heatGap, burnFull, burnFull);   // proportional to need
    const burn = Math.min(want, S.res.wood);
    if (F.woodStove && heatGap > 0.5 && burn > 0.05) {
      S.res.wood -= burn;
      heatIn += gapRate(heatGap, WOOD_STOVE_MAX, WOOD_STOVE_MAX) * (burn / Math.max(0.01, want));
      addWarm(F.rocketHeater?"the rocket heater":"the masonry heater", burn);
      // journal: the first burn of the season, then only when the pile is
      // getting thin. Thirty identical lines a winter is not a journal.
      const daysLeft = Math.floor(S.res.wood / Math.max(0.3, burn));
      if (isWinter && dayOfSeason(S.day) === 1) {
        lines.push(F.rocketHeater
          ? "First fire of the winter in the rocket heater. It'll draw down the woodpile slower than the old hearth did."
          : "First fire of the winter in the masonry heater. The stone holds the warmth for hours after it burns down.");
      } else if (daysLeft <= 7 && S.day % 3 === 0) {
        lines.push(`The woodpile is down to about ${daysLeft} more day${daysLeft === 1 ? "" : "s"} of burning. Somebody should be at the tree line.`);
      }
    } else if (F.woodStove && heatGap > 6 && S.res.wood < 0.3) {
      lines.push("A freezing day, and the woodpile is empty. The hearth sits cold.");
    }
  }

  if (outHi > band.hi) {
    // load reduction is a summer-only effect by nature: shade and a
    // windcatcher cut incoming heat, they don't add warmth in January
    if (F.catalpaShade)  { loadReduction += 4; addWarm("catalpa shade", 4); }
    if (F.windcatcher)   { loadReduction += 5; addWarm("the windcatcher", 5); }
  }
  if (false) {
    if (F.earthBerming)  addWarm("earth-bermed walls", 0.5);
    if (F.earthTubes)    addWarm("earth tubes", 0.4);
    if (F.windcatcher)   addWarm("the windcatcher", 0.35);     // no moving parts, nothing to break
    if (patchSeal>0)     addWarm("patchwork draught-proofing", patchSeal);
    const sh=shadeCooling(); if(sh>0) addWarm("catalpa shade", sh);
  }

  S.returnedToday = [];   // expeditions.js fills this as parties come home; moments read it
  S.report.fromJars = 0;  // today's meal facts, rebuilt each day for dinnerLine()
  S.report.varietyMood = 0;
  tickExpeditions(lines);

  // gift return, if any
  if(S.giftDay && S.day>=S.giftDay){
    if(S.giftGood){
      grantSeedSpread(5); S.res.parts+=3;
      lines.push("Before dawn, someone left a crate at the gate. Seeds, some parts, a pencil drawing of a bicycle.");
    }
    S.giftDay=null;
  }

  // --- power (a flow, not a stock) ---
  // generation happens today; draw happens today; the battery buffers the difference.
  const genWhy=[];
  let gen=0;
  if(built("solar")){
    const n=S.solarPanels||1;
    const baseGen = SOLAR_UNIT*n*mult(S.sys.solar.cond);
    let g = baseGen * wx.solar * (F.silveredPanels?1.2:1);
    if(F.thermalStore) g = Math.max(n*0.3, g);   // a thermal mass tank banks enough heat to trickle power even on a grey day
    gen+=g;
    genWhy.push(`${n} panel${n>1?"s":""} ${g.toFixed(1)} (${S.sys.solar.cond.toFixed(0)}%${wx.solar!==1?`, ${wx.id}`:""})`);
  }
  if(built("turbine")){ const n=S.turbines||1; const g=TURBINE_UNIT*n*mult(S.sys.turbine.cond)*wx.wind; gen+=g; genWhy.push(`${n} turbine${n>1?"s":""} ${g.toFixed(1)} (${S.sys.turbine.cond.toFixed(0)}%${wx.wind!==1?", good wind":""})`); }
  // --- allocation: the player's power triage (Power tab) ---
  // every demand at full reproduces the old fixed draw exactly; cutting a
  // demand trims the budget and that system runs at the tier described in
  // POWER_DEMANDS.fx. A brownout still forces everything to its old
  // brownout tier regardless of allocation.
  const alP=(S.alloc&&S.alloc.power)||{};
  const alv=(k)=>{ const v=alP[k]; return (v===0||v===0.5||v===1)?v:1; };
  const pumpAl    = built("catchment")  ? alv("pump")    : 0;
  const aquaAl    = built("aquaponics") ? alv("aqua")    : 0;
  const commonsAl = built("commons")    ? alv("commons") : 0;
  const wellAl    = F.well              ? alv("well")   : 0;
  /* Both climate machines now scale with the gap instead of firing flat
     whenever a season id matched. The cooling unit used to draw AC_DRAW
     every summer day regardless of whether it was hot, and nothing at all
     on a 90-degree day in late spring. */
  const _band = comfortBand(sn.id);
  const _unheated = baseTarget(clim.out.mean, groundCoupling, loadReduction);
  const coolGapRaw = Math.max(0, _unheated - _band.hi);
  // what the fire could NOT close is what the electric heaters are for
  const _woodLift = (F.woodStove && S.res.wood > 0.3) ? heatIn : 0;
  const heatGapRaw = Math.max(0, (_band.lo + 2) - (_unheated + _woodLift));
  const acAl      = (F.acUnit && coolGapRaw > 1) ? alv("ac") * Math.min(1, coolGapRaw/8) : 0;
  const heaterAl  = (F.eHeater && heatGapRaw > 1 && !S.heaterBroken)
                    ? alv("heater") * Math.min(1, heatGapRaw/10) : 0;
  /* Built is not the same as running. The kitchen needs hands on the job
     AND enough cannable stock on the shelf to be worth heating the boilers
     -- otherwise a village that built the kitchen in year one paid 1.0
     power a day forever for a room nobody was standing in. Compare
     fabActive just below, which has always got this right. */
  const canningWorked = working("preserve").length > 0;
  const canningStock  = stockTakingMethod("can");
  const canningAl = (F.canning && canningWorked && canningStock >= CANNING_MIN_STOCK)
                    ? alv("canning") : 0;
  // fab draws power when there's fab WORK: a project under construction, or a
  // built shop with someone assigned to run it. Idle shops draw nothing.
  tickCells(lines);
  if(S.climate.precip==="rain") S.lastRainDay = S.day;   // flushes follow RAIN, not a snowy week
  const fabActive = !!S.fabProject
    || (S.people.some(p=>p.job==="fab") && FABS.some(d=>S.fabs&&S.fabs[d.id]&&!d.passive));
  const fabAl     = fabActive           ? alv("fab")     : 0;
  const sysDraw=id=>SYS.find(d=>d.id===id).draw;
  const rawDraw = sysDraw("catchment")*pumpAl + sysDraw("aquaponics")*aquaAl
                + sysDraw("commons")*commonsAl
                + CANNING_DRAW*canningAl + FAB_DRAW*fabAl + AC_DRAW*acAl + WELL_DRAW*wellAl
                + HEATER_DRAW*heaterAl;
  const draw = Math.max(1, rawDraw - ((S.f||{}).drawReduce||0) - (F.gridTuned?1:0));
  // transmission loss: the lines bleed a share of everything generated.
  // Solving line-run benches (S.puz.wires) shrinks it toward zero.
  const powerLoss = POWER_LOSS_BASE * Math.pow(LOSS_DECAY, (S.puz&&S.puz.wires)||0);
  if(gen>0 && powerLoss>0){ genWhy.push(`lines lose ${(powerLoss*100).toFixed(0)}%`); }
  gen = gen*(1-powerLoss);
  const cap = built("battery") ? bankCapacity() : 0;   // bank surplus to ride out calm/storm days
  let brownout=false;
  const avail = gen + S.res.charge;
  if(avail < draw){ brownout=true; S.res.charge=0; }
  else S.res.charge = clamp(avail - draw, 0, cap);
  // effective tiers: what each demand actually gets today. Brownout forces
  // the old brownout behavior (pump on gravity, tanks slow, commons dark,
  // canning cold, shops on hand power) — allocation can only cut further.
  // --- temperature, resolved ---
  // the cooling unit only helps if the grid actually carried it today
  if (F.acUnit && coolGapRaw > 1) {
    const acOn = !brownout && acAl > 0;
    if (acOn) { coolIn += gapRate(coolGapRaw, AC_MAX, AC_MAX) * acAl; addWarm("the cooling unit", acAl); }
    else if (tempEvent === "heatwave") lines.push("The cooling unit sat dead through the worst of the heat. Nothing to run it on.");
  }
  if (F.eHeater && heaterAl > 0) {
    if (!brownout) { heatIn += gapRate(heatGapRaw, HEATER_MAX, HEATER_MAX) * heaterAl; addWarm("the electric heaters", heaterAl); }
    else if (tempEvent === "deepfreeze") lines.push("The heaters were dead all night. Nothing on the bank to run them with.");
  }
  /* Breakage is rolled at NIGHT, after the day's load is known, so you find
     out at breakfast that the greenhouse froze — not in a live warning. */
  if (F.eHeater && !S.heaterBroken && heaterAl > 0 && !brownout) {
    if (Math.random() < HEATER_BREAK_BASE + HEATER_BREAK_LOAD * heaterAl) {
      S.heaterBroken = true;
      lines.push("The heaters quit sometime in the night. Whatever they were keeping warm spent the small hours at whatever the outside was doing.");
    }
  }

  // --- indoor temperatures, resolved ---
  const commonsT = commonsTemps({outMean:clim.out.mean, outHi, outLo, groundCoupling,
                                 loadReduction, heatIn, coolIn, massDamping,
                                 prevMean:(S.climate.commons||{}).mean});
  S.climate.commons = commonsT;
  const ghTarget = greenhouseTarget(S.greenhouse||[], CROPS);
  const ghHeat = F.greenhouse ? Math.min(heatIn, gapRate(Math.max(0, ghTarget-outLo), HEATER_MAX, HEATER_MAX)) : 0;
  S.climate.greenhouse = greenhouseTemps(outHi, outLo, (wx.solar||1)*sn.solar, massDamping*4, ghHeat);
  S.report.hearth = {commons: commonsT, out: clim.out, band: comfortBand(sn.id), parts: hearthParts};
  applyTemperature(lines, tempEvent, commonsT, comfortBand(sn.id), isSummer, isWinter, yr1);

  const pumpEff    = brownout ? 0 : pumpAl;
  const aquaEff    = brownout ? Math.min(aquaAl,0.5) : aquaAl;
  const commonsLit = !brownout && commonsAl>0;
  // the shop has to exist, not merely have power pointed at it. Without the
  // flag check this let a village can food on day one with no canning built —
  // the overflow path checked the flag and this one didn't, and they disagreed.
  const canningOn  = !brownout && canningAl>0 && !!S.flags.canning;
  const fabPowered = !brownout && (fabActive ? fabAl>0 : true);

  // --- water ---
  const irr = built("irrigation") ? mult(S.sys.irrigation.cond) : 0;
  const pumpFactor = pumpEff>=1 ? 1 : pumpEff>=0.5 ? 0.75 : 0.5;
  // transmission loss: the mains seep a share of everything the catchment
  // pipes carry. Rain into the tanks and hand-hauled water skip the pipes.
  // Solving water-main benches (S.puz.pipes) shrinks it toward zero.
  const waterLoss = WATER_LOSS_BASE * Math.pow(LOSS_DECAY, (S.puz&&S.puz.pipes)||0);
  const wetIn = S.climate.precip==="snow" ? 0 : wx.rain;   // snow banks instead (see below)
  const rainIn = (built("catchment") ? 14*mult(S.sys.catchment.cond)*pumpFactor*(F.sealedTanks?1.2:1)*(1-waterLoss) : 3) + wetIn;
  // --- the well ---
  // Independent of the weather, which is the whole appeal. Yield rides on
  // the aquifer's health, so the restoration metric stops being a dampener
  // on distant hazards and becomes the thing the tap runs on.
  const wellEff = brownout ? 0 : wellAl;
  const aquiferHealth = clamp(((S.restore&&S.restore.aquifer)||0)/100, 0, 1);
  const wellIn = F.well ? 16 * wellEff * (0.45 + 0.55*aquiferHealth) : 0;
  /* Snow doesn't fill a cistern the day it falls. It banks as snowpack and
     comes in either free (a thaw, whenever the high clears freezing) or on
     purpose — a pot kept going, which costs firewood you might rather burn
     for warmth. That trade is the point. */
  const meltOn = ((S.alloc&&S.alloc.water&&S.alloc.water.snowmelt)!==0) && (S.alloc&&S.alloc.water&&S.alloc.water.snowmelt)>0;
  const melt = meltSnow(meltOn, commonsLit || S.res.wood>0.3, S.res.wood);
  if(melt.wood>0) S.res.wood = Math.max(0, S.res.wood - melt.wood);
  if(melt.water>0.05 && S.day%4===0) lines.push(`Snow hauled in and melted down — ${melt.water.toFixed(1)} water, and ${melt.wood.toFixed(1)} wood gone into it.`);
  const wIn = rainIn + wellIn + (S.climate.thaw||0) + melt.water;
  // and what comes up with it. Cumulative, silent, permanent.
  const wellShare = wIn>0 ? wellIn/wIn : 0;
  accrueToxins(S.people, wellShare, S.groundwaterContam||0);
  if(F.well && wellEff>0 && (S.groundwaterContam||0)>=25 && S.day%45===0){
    lines.push("The well water has a taste to it some days — metal, or something like it. It passes. Nobody has ever gotten sick from it that anyone could point to.");
  }
  /* Beds drink more when it's hot (evapotranspiration) and less when the
     soil is still holding rain. Two separate effects, and they stack: a hot
     day right after a downpour still costs less than a hot dry one. */
  let gardenWater = (irr>0.75 ? 2.5 : 4) * irrigationHeatMult(outHi) * soilDiscount(S.climate.soilMoisture);
  if(F.dripRetrofit) gardenWater=Math.max(1.5,gardenWater-1);
  if(F.keyline) gardenWater=Math.max(1,gardenWater-0.8);
  if(F.graywater) gardenWater=Math.max(0.6,gardenWater-1.4);
  // annual beds drink fully; the food forest is established and deep-rooted, so
  // each forest plot costs only a quarter of a bed's water
  const wateredBeds = S.beds.reduce((a,b)=> a + (b.crop?1:0), 0)
                    + (S.forest||[]).reduce((a,p)=> a + (p.crop?0.25:0), 0);
  // --- allocation: the player's water triage (Water tab) ---
  // the old flat 2/day base use is split into cooking (1) and cleaning (1);
  // at full allocation the total is exactly what it was.
  const alW=(S.alloc&&S.alloc.water)||{};
  const alw=(k)=>{ const v=alW[k]; return (v===0||v===0.5||v===1)?v:1; };
  const drinkAl = alw("drinking")>=1 ? 1 : 0.5;   // no off switch on drinking
  const cookAl  = alw("cooking")>0 ? 1 : 0;
  const cleanAl = alw("cleaning");
  const irrAl   = alw("irrigation");
  // one-sided on purpose: thirst climbs with heat, and doesn't meaningfully
  // fall away with cold
  const drinkNeed = S.people.reduce((a,p)=>a+(canWork(p)?0.5:0.3),0) * drinkHeatMult(outHi);
  const drinkUse  = drinkNeed*(drinkAl===1?1:0.7);   // rationing saves 3/10
  const wOut = drinkUse + gardenWater*wateredBeds*irrAl + 1*cookAl + 1*cleanAl;
  let thirst=0;
  let w = S.res.water + wIn - wOut;
  if(w<0){ thirst = Math.min(1, -w/wOut); w=0; }
  S.res.water = clamp(w,0,waterCapEff());
  // people feel voluntary rationing as a mild chronic thirst; the crops don't
  // (drought below keys off real shortage, not the ration) — but a real
  // shortage on top of rationing bites at the shortage level, not both.
  const thirstFelt = Math.max(thirst, drinkAl<1 ? 0.25 : 0);

  // --- food ---
  let aquaFood = 0;
  if(built("aquaponics")){
    let aquaBase = 3.2;
    for(const t of working("aquatend")){
      aquaBase += (effStat(t,"green","aquatend") + (t.trait==="Green-thumb"?1.5:0))*0.9*eff(t);
    }
    const aquaFactor = aquaEff>=1 ? 1 : aquaEff>=0.5 ? 0.7 : 0.35;
    if(aquaEff===0){ S.sys.aquaponics.cond = clamp(S.sys.aquaponics.cond - AQUA_STAGNANT_WEAR, 0, 100); }
    aquaFood = aquaBase*mult(S.sys.aquaponics.cond)*aquaFactor;
    addFood("fish", aquaFood);   // the tanks give fish, and fish is the valley's protein
    S._aquaWhy=[`tending ${aquaBase.toFixed(1)}`,`condition ×${mult(S.sys.aquaponics.cond).toFixed(2)}`]
      .concat(aquaFactor<1?[brownout?`brownout ×${aquaFactor}`:`pumps ${aquaEff===0?"off":"slow"} ×${aquaFactor}`]:[])
      .concat(aquaEff===0?["still water is souring the system"]:[]).join(" · ");
  }
  // ---- the beds: a crop is planted, tended, and only then harvested ----
  const tenders = working("garden");
  const fo=S.f||{};
  let gardenFood = 0;
  const gWhy=[];

  // tending accumulates growth in each planted bed
  let tendPts = 0;
  for(const t of tenders) tendPts += (effStat(t,"green","garden") + (t.trait==="Green-thumb"?1.5:0))*eff(t);

  // a bed's fertility (0-100) shapes how well anything grows in it; see the
  // feedDelta() call at harvest, which is where fertility actually moves
  // defensive: a bed missing a fertility field (an old save mid-migration, a
  // test fixture, any future code that builds a bed literal without it) should
  // behave as decent average soil, not silently NaN the whole growth formula
  const fertilityMult = f => 0.6 + 0.4*clamp(Number.isFinite(f)?f:75, 0, 100)/100;
  const feedDelta = feed => feed==="legume" ? 15 : feed==="heavy" ? -12 : -4;   // light/undefined = -4

  /* --- companion planting ---
     A bed holds a primary crop plus up to MAX_COMPANIONS interplantings,
     scored against the SAME companion/rival grid the seed-frame puzzle
     teaches (bean·corn·squash·root·herb·bramble). Solving the frame and
     planting a bed are therefore the same knowledge, which is what that
     puzzle's companion data was built for.
     Effects are deliberately modest — real companion planting is a real
     but small effect, and the one genuinely large piece of it (a legume
     feeding its neighbours) shows up as FERTILITY at harvest rather than
     as yield, because that's the mechanism. */
  /* Scoring is PER SLOT, not per bed. Every plant in the ground is judged
     against its own neighbours and gets its own multiplier, which is what
     makes the next paragraph possible.

     Most rivalries are symmetric and stay that way: two brassicas
     concentrate the same pests, two nightshades share the same blight, and
     both sides of that bargain suffer for it equally.

     ALLELOPATHY IS NOT SYMMETRIC. A sunflower releases compounds that
     suppress what grows beside it. It does not suppress itself. So a
     pairing that is bad ONLY because one side is an aster is charged to
     the other side alone -- the sunflower takes its full yield and its
     neighbours pay for standing there. Aster beside aster still hurts
     both, because that one is ordinary same-family crowding, not poison. */
  const ALLELOPATH = "aster";
  function slotScore(selfId, otherIds){
    const selfFam = famOf(selfId);
    let good = 0, bad = 0;
    if(!selfFam) return {good, bad};
    for(const o of otherIds){
      const oFam = famOf(o);
      if(!oFam) continue;
      const v = famPair(selfFam, oFam);
      if(v > 0){ good++; continue; }
      if(v < 0){
        // the poisoner doesn't drink it
        if(selfFam === ALLELOPATH && oFam !== ALLELOPATH) continue;
        bad++;
      }
    }
    return {good, bad};
  }
  const slotMult = (selfId, otherIds) => {
    const sc = slotScore(selfId, otherIds);
    return clamp(1 + sc.good*COMP_YIELD + sc.bad*RIVAL_YIELD, 0.5, 1.6);
  };
  // legumes still feed the whole bed at harvest -- that one is a soil
  // effect, not a yield effect, and it was always the right mechanism
  const legumeMates = bed => (bed.companions||[]).filter(c=>famOf(c)==="legume").length;
  // "a, b, and c"
  const listWords = a => a.length<=1 ? (a[0]||"") : a.slice(0,-1).join(", ")+" and "+a[a.length-1];

  // What a bed actually sets, decided ONCE on the day it comes ready and never
  // revisited — a stand left waiting on hands doesn't keep fattening. Yield is
  // a function of how well the bed was grown (tending banked beyond what the
  // crop needed, and the richness of the ground), not of how fast: the day it
  // ripens is settled by crop.minDays. See MATURITY & YIELD in data-economy.
  const yieldOf = (bed, crop, polR, fo) => {
    const tendRatio = crop.work>0 ? bed.growth/crop.work : 1;
    const tend = 1 + YIELD_TEND_MAX*(1 - Math.exp(-Math.max(0, tendRatio-1)/YIELD_TEND_SCALE));
    const soil = YIELD_SOIL_FLOOR + (1-YIELD_SOIL_FLOOR)*clamp(Number.isFinite(bed.fertility)?bed.fertility:75,0,100)/100;
    const bloom = 1 + POLLINATOR_YIELD*(polR/100);
    // bare: what this stand would set with the bed to itself. Who it's
    // sharing the ground with is applied per slot at the freeze below.
    return Math.max(0, crop.yield*tend*soil*bloom*(F.contourBeds?1.15:1) - (fo.nibble||0));
  };
  const PEREN_PICK_DAYS = [6, 12, 18, 24];   // a perennial bears on these days of its harvest season


  // The kitchen garden (S.beds, annuals) and the food forest (S.forest,
  // perennials) are separate ground: annual beds want tending; forest plots
  // want years. They don't compete for space or for the gardener's day.
  const annualPlanted = S.beds.filter(b=>b.crop).length;

  // shared harvest bookkeeping — the food forest's whole-plot pick. Annual
  // beds no longer come through here: they bear across a window (below) and
  // return TYPED seed when the stand is spent. Perennials return no seed.
  const bringIn = (plot, crop, placeLabel, isPeren) => {
    gardenFood += plot.stored;
    addFood(plot.crop, plot.stored);
    S.dietLog.push({crop:plot.crop, day:S.day, amt:plot.stored});
    plot.fertility = clamp((plot.fertility??75) + feedDelta(crop.feed)*(isPeren?0.25:1), 10, 100);
    lines.push(`${placeLabel} came in: ${plot.stored.toFixed(0)} of ${crop.name.toLowerCase()}.`);
  };

  // typed seed returned at the end of an annual stand: the crop's own seed,
  // half again more if the seed-saving bench is built (the one place that
  // project pays out — see PROJECTS.seedSaving)
  const seedReturn = crop => {
    const base = crop.seeds||0;
    if(!base) return 0;
    return base + (S.flags.seedSaving ? Math.max(1, Math.round(base*0.6)) : 0);
  };

  // --- kitchen garden: annuals grow with tending, then wait on hands to harvest ---
  for(const bed of S.beds){
    if(!bed.crop) continue;
    const crop=CROPS[bed.crop];
    // defensive, and symmetric with the food-forest loop below: a bed holding
    // something with no crop def (a meadow, an old save, a future marker crop)
    // must not take the annual path — and must not throw on the way past.
    if(!crop || crop.perennial) continue;
    /* Frost is a TEMPERATURE now, not a calendar date. The old code wiped
       every non-hardy bed the instant the season table said grow===0, which
       meant there was no such thing as an early killing frost in autumn, no
       such thing as a mild winter, and a "deep, killing freeze" event that
       couldn't kill anything because winter had already done it on schedule.
       Snow cover insulates; established perennials go dormant rather than
       dying (handled inside frostKills). */
    if(frostKills(crop, S.climate.out.lo, S.climate.snowpack)){
      if(bed.growth>0.5) lines.push(`The cold took the ${crop.name.toLowerCase()} in bed ${S.beds.indexOf(bed)+1}.`);
      bed.fertility=clamp((bed.fertility??75)-2,10,100);
      bed.crop=null; bed.companions=[]; bed.growth=0; bed.days=0;
      bed.ready=false; bed.stored=0; bed.bare=0; bed.mateGot=null; bed.picked=0;
      continue;
    }
    if(false){
      if(false){ continue; }
      if(!F.coldFrames){
        if(bed.growth>0.5) lines.push(`The ${crop.name.toLowerCase()} in bed ${S.beds.indexOf(bed)+1} died with the first hard frost.`);
        bed.crop=null; bed.companions=[]; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.bare=0; bed.mateGot=null; bed.picked=0; bed.fertility=clamp((bed.fertility??75)-2,10,100); continue;
      }
    }
    if(irrAl===0 && Math.random()<WITHER_CHANCE){
      lines.push(`With the irrigation shut off, the ${crop.name.toLowerCase()} in bed ${S.beds.indexOf(bed)+1} died.`);
      bed.crop=null; bed.companions=[]; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.bare=0; bed.mateGot=null; bed.picked=0;
      bed.fertility=clamp((bed.fertility??75)-2,10,100); continue;
    }
    const perBed = tenders.length ? tendPts/Math.max(1,annualPlanted) : 0;
    // allocation throttles what the beds actually receive: full ×1 (unchanged),
    // half ×0.675, off ×0.35 (rain and dew only)
    const water = (0.75+0.45*irr)*(0.35+0.65*irrAl);
    // a healed water table softens drought stress; a valley full of pollinators
    // lifts fruit set across every bed (the standing bloom, not any one crop's bonus).
    const aqR = (S.restore && S.restore.aquifer) || 0;
    const polR = (S.restore && S.restore.pollinator) || 0;
    const drought = 1 - 0.55*thirst*(1 - 0.5*(aqR/100));
    /* Sun and temperature are SEPARATE limiters on purpose: a heated
       greenhouse doesn't save a sunflower in December, short days do it in,
       and either one has to be able to be the binding constraint alone. */
    const inGH = !!bed.greenhouse;
    const tHi = inGH ? S.climate.greenhouse.hi : S.climate.out.hi;
    const tLo = inGH ? S.climate.greenhouse.lo : S.climate.out.lo;
    const tempRate = growthMult(crop, tHi, tLo);
    const seasonRate = Math.max(0.25, sn.grow) * tempRate;
    // tending, water, season and soil set the PACE toward crop.work; falling
    // behind here means a longer season, not a smaller one (the weeds win time
    // before they win bulk). The pollinator bloom is not a pace effect — it
    // lives in yieldOf, where its comment always claimed it did.
    bed.growth += (0.6 + perBed*0.55) * water * drought * seasonRate * fertilityMult(bed.fertility) * (fo.gardenBonus||1) * (F.keyline?1.12:1);
    bed.days++;
    // BOTH gates: the work has to be in, and the days have to have passed.
    // !bed.ready freezes the yield on the first qualifying day.
    if(!bed.ready && bed.growth >= crop.work && bed.days >= (crop.minDays||0)){
      bed.bare = yieldOf(bed, crop, polR, fo);
      bed.stored = bed.bare * slotMult(bed.crop, bed.companions||[]);
      bed.ready = true;
    }
  }
  // --- the picking window: an annual doesn't come in all at once ---
  // A ready bed bears stored/window food per day, for `window` days, and only
  // on days someone is in the gardens (picking still waits on hands — unpicked
  // days don't advance the window, the crop stands and waits, same as before).
  // Seed return and the fertility hit settle once, when the stand is spent.
  for(const bed of S.beds){
    if(!bed.ready || !bed.crop) continue;
    const crop=CROPS[bed.crop];
    if(!crop || crop.perennial) continue;
    if(!tenders.length) continue;
    const win = Math.max(1, crop.window||1);
    const perDay = bed.stored/win;
    // old saves froze a yield before bare existed; fall back to it
    const barePerDay = (Number.isFinite(bed.bare) ? bed.bare : bed.stored)/win;
    bed.picked = (bed.picked||0) + 1;
    gardenFood += perDay;
    addFood(bed.crop, perDay);                     // into the pantry as itself
    const mateWords=[];
    for(const c of (bed.companions||[])){          // interplantings bear too, thinly
      const cd = CROPS[c];
      if(!cd) continue;
      // each interplanting scored against ITS OWN neighbours -- the primary
      // and the other mates -- so the aster rule above actually lands
      const others = [bed.crop, ...(bed.companions||[]).filter(x=>x!==c)];
      const side = barePerDay*0.22*slotMult(c, others);
      if(!(side>0)) continue;
      gardenFood += side; addFood(c, side);
      S.dietLog.push({crop:c, day:S.day, amt:side});
      // remembered so the last-of-the-stand line can report the whole thing
      bed.mateGot = bed.mateGot || {};
      bed.mateGot[c] = (bed.mateGot[c]||0) + side;
      mateWords.push(cd.name.toLowerCase());
    }
    S.dietLog.push({crop:bed.crop, day:S.day, amt:perDay});
    /* Only the FIRST picking of a crop the village had to go out and FIND —
       not ordinary weekly harvest, and not the two it started knowing. A
       crop the beds give every season is a routine; the first turnip out of
       ground nobody thought would hold one is a day. */
    if(CROPS[bed.crop] && CROPS[bed.crop].locked){
      S.harvested = S.harvested || {};
      if(!S.harvested[bed.crop]){
        S.harvested[bed.crop] = true;
        const text = MEM_TEXT.firstHarvest(CROPS[bed.crop].name.toLowerCase());
        for(const q of S.people){
          if(q.status==="away" || !canWork(q)) continue;
          if(q.job!=="garden" && q.trait!=="Green-thumb") continue;
          addMemory(q, {kind:"firstHarvest", text, intensity:0.4, valence:0.6,
                        tags:{action:"garden", place:"beds", subject:"harvest"}});
        }
        pushRecentEvent({kind:"firstHarvest", text:`the first ${CROPS[bed.crop].name.toLowerCase()} off this ground`,
                         weight:1.1, tags:{subject:"harvest"}});
      }
    }
    // the interplanting used to bear in complete silence: it fed the village
    // and reached the diet log, and no journal line ever mentioned it
    const alongside = mateWords.length ? `, with ${listWords(mateWords)} alongside` : "";
    // sunflower's byproduct accrues per picking day — seed set aside for the
    // press, not a cut of the food value itself
    if(bed.crop==="sunflower") S.res.rawSeed = (S.res.rawSeed||0) + perDay*0.5;
    const label = `Bed ${S.beds.indexOf(bed)+1}`;
    if(bed.picked===1 && win>1){
      lines.push(`${label}: the first ${crop.name.toLowerCase()} came in — ${perDay.toFixed(0)} food today${alongside}, more ripening behind it.`);
    } else if(win>2 && bed.picked>1 && bed.picked<win && (bed.picked%2===0 || win<=4)){
      // the middle of a picking window used to pass in total silence, which
      // read as the harvest having stopped. It hadn't.
      lines.push(`${label}: another ${perDay.toFixed(0)} of ${crop.name.toLowerCase()} picked${alongside} — ${win-bed.picked} more day${win-bed.picked===1?"":"s"} of it to come.`);
    }
    if(bed.picked >= win){
      const seeds = seedReturn(crop);
      if(seeds){ S.seedStock = S.seedStock||{}; S.seedStock[bed.crop] = (S.seedStock[bed.crop]||0) + seeds; }
      // companions return their own seed too, and a legume among them leaves
      // the ground better than it found it — the real mechanism, as fertility
      for(const c of (bed.companions||[])){
        const cd = CROPS[c]; if(!cd || !cd.seeds) continue;
        S.seedStock = S.seedStock||{};
        S.seedStock[c] = (S.seedStock[c]||0) + Math.max(1, Math.round(cd.seeds*0.5));
      }
      bed.fertility = clamp((bed.fertility??75) + feedDelta(crop.feed) + legumeMates(bed)*COMP_FERT, 10, 100);
      const mateSum = Object.entries(bed.mateGot||{})
        .filter(([,n])=>n>0.5)
        .map(([c,n])=>`${n.toFixed(0)} of ${CROPS[c]?CROPS[c].name.toLowerCase():c}`);
      const withMates = mateSum.length ? ` The interplanting gave ${listWords(mateSum)} on top of it.` : "";
      lines.push((win>1
        ? `${label}: the last of the ${crop.name.toLowerCase()} — ${bed.stored.toFixed(0)} food over ${win} days${seeds?`, and ${seeds} seed saved back`:""}.`
        : `${label} came in: ${bed.stored.toFixed(0)} of ${crop.name.toLowerCase()}${seeds?`, and ${seeds} seed saved`:""}.`) + withMates);
      bed.crop=null; bed.companions=[]; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.bare=0; bed.mateGot=null; bed.picked=0;
    }
  }

  // --- food forest: perennials bear across their season, no tending needed ---
  for(const plot of (S.forest||[])){
    if(!plot.crop) continue;
    const crop=CROPS[plot.crop];
    if(!crop || !crop.perennial) continue;
    if(sn.id!==crop.harvestSeason) continue;
    if(!PEREN_PICK_DAYS.includes(dayOfSeason(S.day))) continue;
    if(plot.lastPickDay===S.day) continue;
    // --- how much a perennial bears for its age ---
    // TWO dates, not one. bearYears is when it first fruits at all;
    // matureYears is when it reaches maximum yield. Between them it ramps
    // from nothing to full. Before bearYears it produces exactly zero — it
    // is a young tree, and young trees do not feed anyone.
    const ageYears = (S.day - plot.plantedDay) / (SEASON_LEN*4);
    const bearY = crop.bearYears ?? crop.matureYears*0.7;   // fallback for any crop not yet given one
    if(ageYears < bearY){
      plot.ready = false;
      plot.lastPickDay = S.day;
      continue;
    }
    const span = Math.max(0.25, crop.matureYears - bearY);
    const estFrac = clamp((ageYears - bearY)/span, 0, 1);
    if(estFrac>=1 && !plot.matured){
      plot.matured=true;
      lines.push(`The ${crop.name.toLowerCase()} in the food forest has come into its full bearing. This is as much as it will ever give in a year.`);
    }
    plot.stored = (crop.yield/PEREN_PICK_DAYS.length) * estFrac * fertilityMult(plot.fertility);
    if(!plot.firstBorne && plot.stored >= 1){
      plot.firstBorne = true;
      lines.push(`The ${crop.name.toLowerCase()} in the food forest bore for the first time. A thin crop — it was never going to be more than that, this year.`);
    }
    plot.ready = true;
    plot.lastPickDay = S.day;
  }
  for(const plot of (S.forest||[])){
    if(!plot.ready || !plot.crop) continue;
    const crop=CROPS[plot.crop];
    bringIn(plot, crop, "The food forest", true);
    plot.lastHarvestYear = yearOf(S.day);
    plot.ready=false; plot.stored=0;   // the planting stays -- it bears again next year
  }

  if(gardenFood>0) gWhy.push("harvest");
  else {
    const planted=S.beds.filter(b=>b.crop).length;
    gWhy.push(planted?`${planted} bed${planted>1?"s":""} growing`:"nothing planted");
    if(!tenders.length && planted) gWhy.push("untended — growth crawls");
  }
  if(fo.foodTrickle) addFood(S.crops&&S.crops.chestnut?"chestnut":"greens", fo.foodTrickle);
  const foodIn = aquaFood + gardenFood + (fo.foodTrickle||0);
  const cooks = working("cook");
  const cookStretch = cooks.length ? 1-0.03*Math.min(5,cooks[0].care) : 1;
  // each adult eats 0.85 food/day, each child 0.5 — not 1.0, because the daily
  // food-in numbers (aquaponics/gardens/foraging) are calibrated against this;
  // raising it tightens the food budget village-wide, see TUNING GUIDE above
  const mouths = S.people.reduce((a,p)=>a+(canWork(p)?0.85:0.5),0);
  const foodOut = mouths*cookStretch;
  // Desperation gleaning: with nothing left for TONIGHT, people go out and dig.
  // Gate on the projected end-of-day balance — stores at dawn PLUS whatever
  // came in today (harvest, tanks, foraging returns) minus tonight's meal —
  // not on the dawn stores alone. Without foodIn in the check, a 30-food
  // radish harvest could land the same day everyone "went out to scrape
  // bark", with no causal thread in the journal. Gleaning also takes only
  // the real shortfall now: it is scraping, not a food source.
  let gleaned = 0;
  {
    // pantryTotal() already includes today's harvest/tanks/trickle — the
    // scalar S.res.food is still yesterday's until resync() runs below
    const projected = pantryTotal() + S.preserved - foodOut;
    if(projected < 1 && season().forage>0){
      const able = S.people.filter(p=>canWork(p) && p.status!=="away").length;
      // near-subsistence: a starving village limps, it does not simply die.
      // In winter the woods give almost nothing, which is the whole point of preserving.
      const scraped = Math.max(1, able*0.62) * (S.larder??1) * season().forage;
      gleaned = Math.min(scraped, Math.max(0, 1 - projected));
      S.larder = clamp((S.larder??1) - gleaned/260, 0.12, 1);
      addForage(gleaned);   // typed, and whatever this season actually offers
      if(S.day%6===0) lines.push(foodIn > 0.5
        ? "What came in today was gone by dark. Everyone who could stand went out after it anyway — roots, bark, whatever they could find."
        : "Everyone who could stand went out foraging. Roots, bark, whatever they could find. It wasn't enough.");
    }
  }
  /* ---- the meal ----
     Drawn out of the typed pantry most-perishable-first: the village eats
     what is about to go over before it eats what keeps. That single rule is
     what makes macros move on their own — a week when only berries are
     ripening is a week of eating sugar, whether anyone chose it or not.
     Only once the fresh is gone do the jars get opened. */
  let hunger=0;
  let macDrag=0, macCeil=100, macFloor=0;
  {
    // a real shortfall gets first claim on whatever fixes it, fresh or jarred,
    // before the ordinary spoilage-ordered draw takes the rest
    const fix = eatForDeficiency(foodOut);
    const meal = eatFresh(foodOut - fix.taken);
    let eaten = {c:fix.mac.c+meal.mac.c, f:fix.mac.f+meal.mac.f, p:fix.mac.p+meal.mac.p};
    let short = foodOut - fix.taken - meal.taken;
    if(short > 1e-6){
      const fromJarsDraw = eatJars(short);
      // NOT narrated here. dinnerLine() is the single owner of meal narration —
      // three generators describing the same supper from different data is how
      // you get "dinner came out of jars" directly above "raspberries, fish
      // fresh from the tanks". It records the fact and moves on.
      S.report.fromJars = fromJarsDraw.taken;
      eaten = {c:eaten.c+fromJarsDraw.mac.c, f:eaten.f+fromJarsDraw.mac.f, p:eaten.p+fromJarsDraw.mac.p};
      short -= fromJarsDraw.taken;
      if(short > 1e-6) hunger = Math.min(1, short/foodOut);
    }
    // what was actually eaten, not what was harvested — the honest input to
    // the deficiency counters (see tickMacros)
    S.report.ate = eaten;
    const m = tickMacros(eaten, lines);
    macDrag = m.drag; macCeil = m.ceil; macFloor = m.floor;

    // someone at the hearth turns the day's ingredients into an actual dish
    if(cooks.length) cookRecipe(lines);
  }

  // a big harvest can overtop the shelves; jars catch what they can't hold,
  // and now the METHOD decides what can even be put by — you do not can a
  // leaf, and the fragile things are exactly the ones that won't wait
  {
    const over = pantryTotal() - foodCap();
    if(over > 0.5){
      const methods = bestMethodFor(canningOn);
      let put = 0; const kinds = [];
      for(const m of methods){
        if(put >= over-1e-6) break;
        const r = preserveInto(over-put, m);
        put += r.taken; kinds.push(...r.kinds);
      }
      const spoiled = over - put;
      if(put > 0.5) lines.push(`The stores overflowed. Everyone spent the evening putting ${put.toFixed(0)} of it by${kinds.length?` — ${[...new Set(kinds)].slice(0,3).join(", ")}`:""}.`);
      if(spoiled > 0.5){
        // whatever's left over the cap, and whatever no method could touch
        // what's lost is what wouldn't have kept anyway — the berries go
        // before the squash does, which is both true and the right incentive
        const p = S.pantry||[];
        let need = spoiled;
        const frag = [...p].sort((a,b)=>((FOOD_DATA[b.k]||{dk:0}).dk)-((FOOD_DATA[a.k]||{dk:0}).dk));
        for(const e of frag){ const t=Math.min(e.n,need); e.n-=t; need-=t; if(need<=0) break; }
        for(let i=p.length-1;i>=0;i--) if(p[i].n<=1e-6) p.splice(i,1);
        lines.push(`${spoiled.toFixed(0)} of the harvest had nowhere to go and will spoil.${methods.length?"":" Somebody should build a way to preserve food."}`);
      }
    }
  }

  // overnight: everything on the shelves ages at its own rate
  decayStock(lines);
  resync();
  S.preserved = clamp(S.preserved, 0, S.flags.rootCellar?300:170);
  let f = S.res.food;

  // the wild larder recovers slowly; foraging draws it down (see tickExpeditions)
  S.larder = clamp((S.larder??1) + 0.018, 0, 1);

  // --- what the land takes and gives, daily ---
  const fz=S.f||{};
  if(fz.scrapTrickle) addRes("scrap", fz.scrapTrickle);                 // spikes and plates off the rail
  if(fz.upkeepScrap)  S.res.scrap = Math.max(0, S.res.scrap - fz.upkeepScrap); // the library roof
  if(fz.partsUpkeep)  S.res.parts = Math.max(0, S.res.parts - fz.partsUpkeep); // endlessly repaired
  if(fz.stormBreak && wx.id==="rain" && Math.random()<0.18){
    if(S.res.scrap>=1){ S.res.scrap-=1; lines.push("A glass pane broke in a storm. Someone swept it up and cut another windshield to replace it."); }
    else lines.push("A glass pane broke in a storm, and there was nothing to replace it with.");
  }
  if(fz.floodRisk && wx.id==="rain" && Math.random()<fz.floodRisk){
    const cands=["irrigation","catchment","aquaponics"].filter(built);
    if(cands.length){
      const low=pick(cands);
      S.sys[low].cond=clamp(S.sys[low].cond-14,0,100);
      lines.push(`The river flooded its banks. The ${SYS.find(s=>s.id===low).name.toLowerCase()} took the worst of it.`);
    }
  }

  // --- preservation: hands turn fresh food into food that keeps ---
  S._preserveWhy = "";   // reset daily, or yesterday's line reads as today's
  const preservers = working("preserve");
  if(preservers.length){
    const method = canningOn ? PRESERVE.canning
                 : F.crocks   ? PRESERVE.fermenting
                 : F.dryRacks ? PRESERVE.drying : null;
    if(method){
      let rate = 0;
      for(const p of preservers) rate += method.rate*0.55 + effStat(p,"care","preserve")*0.4*eff(p);
      // the method decides what it can even touch now: drying takes almost
      // anything, fermenting wants vegetables, canning can't handle a leaf.
      // If nothing in the pantry suits today's method, the day is wasted —
      // which is the argument for building more than one.
      const r = preserveInto(rate, PRES_METHOD_OF[Object.keys(PRESERVE).find(k=>PRESERVE[k]===method)]);
      if(r.taken>0.2){
        const wasted = r.taken*method.loss;
        if(F.compost) S.compost = clamp((S.compost||0) + wasted*0.5, 0, 80);
        S._preserveWhy = `${method.name.toLowerCase()} · ${r.taken.toFixed(1)} put by (${[...new Set(r.kinds)].slice(0,3).join(", ")}), ${wasted.toFixed(1)} lost`;
        resync();
      } else {
        S._preserveWhy = `nothing in the stores takes ${method.name.toLowerCase()}`;
      }
    }
  }

  // --- pressing: sunflower seed set aside becomes oil, slowly, and only with hands on it ---
  S._pressWhy = "";
  const pressers = working("press");
  if(pressers.length && S.flags.oilPress){
    const OIL_EFF = 0.35;   // most of the seed is not oil -- pressing loses a lot of volume
    const OIL_CAP = 20;     // was the clamp on the old S.oil scalar; kept as a shelf limit
    let rate = 0;
    for(const p of pressers) rate += 2.0*0.55 + effStat(p,"hands","press")*0.4*eff(p);
    // Oil goes into the pantry as a food now, not into a scalar off to one
    // side. It's flagged noBulk in FOOD_DATA, so nobody eats it by the
    // bowl -- it leaves through the oil dishes and the dinner line.
    const room = Math.max(0, OIL_CAP - stockOf("oil"));
    const take = Math.min(S.res.rawSeed||0, rate, room/OIL_EFF);
    if(take>0.2){
      S.res.rawSeed -= take;
      addFood("oil", take*OIL_EFF);
      resync();
      S._pressWhy = `${take.toFixed(1)} seed pressed, ${(take*OIL_EFF).toFixed(1)} oil`;
    } else if(room<=0.01){
      S._pressWhy = "the oil jars are full";
    }
  }

  // --- wood gathering ---
  const woodcutters = working("woodcut");
  if(woodcutters.length){
    let gathered = 0;
    for(const p of woodcutters) gathered += 1.5 + effStat(p,"wild","woodcut")*0.6*eff(p);
    gathered *= ((S.f||{}).woodcutBonus || 1);   // a coppiced woodlot cuts easier and regrows faster
    const actual = addRes("wood", gathered);
    S._woodWhy = `${actual.toFixed(1)} wood hauled`;
  } else {
    S._woodWhy = "";
  }


  // --- spoilage ---
  // Gone: this was a flat percentage off one pooled number. Every food now
  // rots at its own real rate inside the larder (decayStock, run at the end
  // of the meal above) — pawpaws in days, squash over months. Summer heat
  // still bites, applied there rather than here.
  S.spoilMemo = S.spoilMemo || 0;

  // --- compost: what spoiled and what preserving wasted goes back into the ground ---
  // Spreads automatically onto whichever bed or forest plot is most worn, rather
  // than asking for another manual action — this is upkeep, not a decision.
  let compostSpread=false, compostTarget=null;
  if(F.compost && (S.compost||0)>=5){
    const plots=[...S.beds, ...(S.forest||[])];
    const target=plots.reduce((worst,pl)=> (pl.fertility??75) < (worst?worst.fertility??75:101) ? pl : worst, null);
    if(target && (target.fertility??75) < 92){
      target.fertility = clamp((target.fertility??75)+8, 10, 100);
      S.compost -= 5;
      compostSpread=true; compostTarget=target;
    }
  }

  // --- fabrication: the village makes what it used to scavenge ---
  {
    const fabWorkers = working("fab");
    if(S.fabProject && fabWorkers.length){
      const def = FABS.find(x=>x.id===S.fabProject.id);
      let pts=0;
      for(const p of fabWorkers) pts += (effStat(p,"hands",S.fabProject.id)+(p.trait==="Tinkerer"?1.5:0))*1.2*eff(p)*(F.fineTools?1.1:1);
      S.fabProject.progress += pts;
      if(S.fabProject.progress >= def.work){
        S.fabs[def.id]=true;
        lines.push(`${def.name} stands. ${def.blurb}`);
        S.people.forEach(p=>{ if(p.job==="fab") p.job=null; });
        S.fabProject=null;
      }
    }
    // Built shops produce only when someone runs them, and they eat feedstock:
    // the forge turns wood (charcoal) into scrap, the machine shop turns scrap
    // into parts, the apothecary turns garden output into medicine. Nothing
    // comes from nothing anymore. Construction takes the worker's whole day —
    // shops sit cold while something new is going up. Output scales modestly
    // with the worker's hands, and short feed throttles it instead of a hard
    // stop (you make what the stock allows). NOTE addRes ignores non-positive
    // amounts, so feed is deducted by direct subtraction, never through it.
    // The apothecary is a herb bed and a good book, not a workshop — once it
    // exists it simply produces, with no assignment and no feedstock. It is
    // closer in kind to the mushroom logs than to the forge.
    for(const def of FABS){
      if(!S.fabs[def.id] || !def.passive) continue;
      addRes(def.gives, FAB_RATE[def.gives]);
    }
    if(!S.fabProject && fabWorkers.length){
      const w = fabWorkers[0];
      const skill = 0.75 + 0.1*effStat(w,"hands","fab");
      for(const def of FABS){
        if(!S.fabs[def.id] || def.passive) continue;   // passive shops run themselves
        // Per-shop switch. Without it the machine shop ran whenever ANY fab
        // worker was assigned, and since it eats 1.0 scrap to make 0.5 parts
        // while the forge only makes 0.9, net scrap ran negative whenever
        // both were on -- with no way to pause one and rebuild the pile.
        if(S.fabsOff && S.fabsOff[def.id]) continue;
        let r = FAB_RATE[def.gives] * (fabPowered?1:0.6) * skill;
        if(def.feed){
          const have = S.res[def.feed.res]||0;
          const need = r*def.feed.per;
          if(have < need) r = have/def.feed.per;
          if(r>0.001) S.res[def.feed.res] = Math.max(0, have - r*def.feed.per);
        }
        if(r>0.001) addRes(def.gives, r);
      }
    }
  }

  // --- crises: the world is not only gentle ---
  let stormHit=false, equipShort=false, equipShortDef=null, equipShortNeed=0;
  {
    // Storms grow more likely and rougher the longer the village stands — the
    // infrastructure you build is more to lose, and the world doesn't get gentler.
    const yrs = yearOf(S.day) - 1;
    // a healed water table (aquifer) sponges the flash floods: rewilded wetlands and
    // a high table cut both the chance a storm reaches infrastructure and the damage.
    const aq = (S.restore && S.restore.aquifer) || 0;
    const stormShield = 1 - 0.75*(aq/100);   // 1.0 at 0, 0.25 at 100
    const stormChance = (0.10 + Math.min(0.10, yrs*0.02) + (season().id==="winter"?0.05:0)) * stormShield;
    if((wx.id==="rain"||wx.id==="overcast") && Math.random()<stormChance){
      const cands=SYS.filter(d=>built(d.id) && d.id!=="battery");
      if(cands.length){
        stormHit=true;
        const nHits = 1 + (Math.random()<0.3+yrs*0.03?1:0);
        const named=[];
        const chosen=new Set();
        for(let i=0;i<nHits;i++){ const d=pick(cands); chosen.add(d); }
        for(const d of chosen){
          const dmg=Math.round((8+Math.floor(Math.random()*10)+Math.min(8,yrs*1.5)+(S.sys[d.id].cond<40?5:0)) * (0.35+0.65*stormShield));
          S.sys[d.id].cond=clamp(S.sys[d.id].cond-dmg,0,100);
          named.push(d.name.toLowerCase());
        }
        lines.push(`A hard storm in the night. The ${named.join(" and the ")} took damage.`);
        /* Only for the people who TEND the thing that broke. A storm is
           weather for everybody and a loss for whoever keeps it running. */
        const hitIds = [...chosen].map(d=>d.id);
        for(const q of S.people){
          if(q.status==="away" || !hitIds.includes(q.job)) continue;
          addMemory(q, {kind:"storm", text:MEM_TEXT.storm(jobName(q.job).toLowerCase()),
                        intensity:0.5, valence:-0.5,
                        tags:{action:q.job, place:q.job, subject:"storm"}});
        }
        pushRecentEvent({kind:"storm", text:`the storm and what it took`, weight:1.4,
                         tags:{subject:"storm"}});
      }
    }
  }
  {
    const frac=S.res.food/foodCap();
    if(S.res.food>8 && Math.random() < 0.015 + 0.05*frac){
      const eatFrac=(0.12+Math.random()*0.14)*(F.rootCellar?0.45:1);
      // rats work the shelves, not an abstraction: they take the sweet and
      // the starchy first, which is the least perishable half of the store
      const want = S.res.food*eatFrac;
      const p = S.pantry||[];
      let need = want;
      for(const e of [...p].sort((a,b)=>b.n-a.n)){ const t=Math.min(e.n,need); e.n-=t; need-=t; if(need<=0) break; }
      for(let i=p.length-1;i>=0;i--) if(p[i].n<=1e-6) p.splice(i,1);
      const eaten = want-Math.max(0,need);
      resync();
      lines.push(F.rootCellar
        ? `Rats got into what wasn't in the cellar — ${eaten.toFixed(0)} food gone.`
        : `Rats found the stores. ${eaten.toFixed(0)} food gone, and droppings in what's left. A root cellar would keep them out of most of it.`);
    }
  }

  // --- equipment failure: a long-run system can suddenly break, needing parts ---
  // This is the late-game pressure that keeps the forge and machine shop worth having.
  {
    const yrs = yearOf(S.day) - 1;
    if(yrs>=1 && Math.random() < 0.012 + yrs*0.004){
      const cands=SYS.filter(d=>built(d.id) && S.sys[d.id].cond>50);
      if(cands.length){
        const d=pick(cands);
        S.sys[d.id].cond=clamp(S.sys[d.id].cond-30-Math.floor(Math.random()*15),0,100);
        const partsNeed = 3+Math.floor(Math.random()*3);
        if(S.res.parts>=partsNeed){
          S.res.parts-=partsNeed;
          lines.push(`Something broke in the ${d.name.toLowerCase()} — a hinge, a weld, a cracked housing. It took ${partsNeed} parts to fix it.`);
        } else {
          equipShort=true; equipShortDef=d; equipShortNeed=partsNeed;
          lines.push(`Something broke in the ${d.name.toLowerCase()}, and there weren't parts enough to fix it. We need to make or find more parts.`);
        }
      }
    }
  }

  // --- neighbors: favor owed comes back when it's needed most, not on a schedule ---
  // S.neighborStanding is built by helping other settlements (see the neighborsAsk
  // event) and spent here, automatically, when this village is the one in trouble.
  // Priority: a specific parts shortage > a hunger streak > storm damage, since
  // "the exact thing you needed showed up" reads better than a vague gift.
  if((S.neighborStanding||0) >= 1){
    if(equipShort && Math.random()<0.55){
      S.neighborStanding -= 1;
      addRes("parts", equipShortNeed);
      S.sys[equipShortDef.id].cond = clamp(S.sys[equipShortDef.id].cond+8,0,100);
      lines.push(`A cart came up the road — someone from two valleys over, paying back a debt with ${equipShortNeed} parts and a spare pair of hands for an hour. The ${equipShortDef.name.toLowerCase()} is working again.`);
      equipShort=false;
    } else if((S.hungerDays||0)>=3 && Math.random()<0.45){
      S.neighborStanding -= 1;
      const gift=8+Math.floor(Math.random()*8);
      S.res.food = clamp(S.res.food+gift, 0, foodCap());
      lines.push(`Someone brought us a gift -- a sack of ${gift.toFixed(0)} food was left at the door before dawn.`);
    } else if(stormHit && Math.random()<0.3){
      S.neighborStanding -= 1;
      addRes("scrap", 4); addRes("parts", 2);
      lines.push(`After the storm, a runner from a nearby community dropped off a little scrap and a few parts to help us make repairs.`);
    }
    S.neighborStanding = Math.max(0, S.neighborStanding);
  }
  // favor fades if it's never called in — this is reciprocity, not a bank account
  if((S.neighborStanding||0)>0) S.neighborStanding = Math.max(0, S.neighborStanding - 0.004);

  // --- blight: a monoculture invites disaster. 
  {
    const planted=S.beds.filter(b=>b.crop);
    if(planted.length>=2){
      const kinds={};
      for(const b of planted) kinds[b.crop]=(kinds[b.crop]||0)+1;
      // if one crop dominates the beds, it can catch blight — but a living soil web
      // (mycosphere) suppresses it: at full health, monoculture blight nearly vanishes.
      const myco = (S.restore && S.restore.mycosphere) || 0;
      const blightMult = 1 - 0.85*(myco/100);   // 1.0 at 0, ~0.15 at 100
      for(const [crop,n] of Object.entries(kinds)){
        if(n>=2 && Math.random()<0.012*n*blightMult){
          const hit=planted.filter(b=>b.crop===crop);
          for(const b of hit){ b.crop=null; b.growth=0; b.days=0; b.ready=false; b.stored=0; }
          lines.push(`Blight took the ${CROPS[crop]?CROPS[crop].name.toLowerCase():crop} — all ${n} beds of it, discolored and wilting by morning. Multiple beds of the same crop increases the risk of this.`);
          break;
        }
      }
    }
  }

  // --- maintenance & decay ---
  let worstSys=null, worstCond=101;
  for(const def of SYS){
    if(!built(def.id)) continue;
    const sys=S.sys[def.id];
    let repair=0;
    for(const p of working(def.id)){
      let h = effStat(p,"hands",def.id) + (p.trait==="Tinkerer"?1.5:0) + (p.trait==="Cautious"?-0.5:0);
      repair += h*1.6*eff(p)*(F.toolLibrary?1.2:1)*(sys.cond>=85?0.45:1);
    }
    sys.cond = clamp(sys.cond + repair - decayOf(def), 0, 100);
    if(sys.cond<worstCond){worstCond=sys.cond; worstSys=def;}
  }

  // --- work in progress: either raising a system, or a project ---
  if(S.project){
    const isBuild = S.project.kind==="build";
    const def = workDef();
    let pts=0;
    /* WHO BUILT IT. S.project.progress was one shared pool and nothing
       recorded whose hands put it there, so a finished thing couldn't be
       anyone's in particular. This is the smallest possible fix: a running
       tally, read once at completion and then thrown away with the project. */
    S.project.contributors = S.project.contributors || {};
    for(const p of working("project")){
      const own = (effStat(p,"hands",S.project.kind==="build"?S.project.id:null)+(p.trait==="Tinkerer"?1.5:0))*1.2*eff(p)*((S.f||{}).projectFaster?1.2:1)*(S.flags.fineTools?1.1:1);
      pts += own;
      S.project.contributors[p.id] = (S.project.contributors[p.id]||0) + own;
    }
    S.project.progress += pts;
    if(S.project.progress >= def.work){
      if(isBuild){
        S.sys[def.id].built=true;
        if(def.id==="solar" && !S.solarPanels) S.solarPanels=1;
        S.sys[def.id].cond=100;
        lines.push(`The ${def.name.toLowerCase()} is up and running. ${def.draw>0?"It's using power.":""}`);
      } else {
        S.flags[def.id]=true;
        if(def.id==="gardenBeds") S.beds.push({crop:null,companions:[],growth:0,days:0,ready:false,stored:0,fertility:75,plantedDay:0});
        lines.push(`The ${def.name.toLowerCase()} is finished. ${def.blurb}`);
      }
      /* Three tiers, on purpose. Someone who spent a season on it, someone
         whose daily work now runs through it, and someone it simply speaks
         to are not equally OF this — and a system that gave all three the
         same memory would be recording an event rather than people. */
      {
        const contrib = S.project.contributors || {};
        const total = Object.values(contrib).reduce((a,b)=>a+b, 0) || 1;
        const userJob = WORK_USER_JOB[def.id];
        const broad = JOB_SKILL[userJob] || "hands";
        const traits = WORK_TRAIT[broad] || [];
        const text = MEM_TEXT.project(def.name.toLowerCase());
        for(const q of S.people){
          if(q.status==="away" || !canWork(q)) continue;
          let intensity = 0;
          if(contrib[q.id])            intensity = 0.3 + 0.4*(contrib[q.id]/total);   // built it
          else if(userJob && q.job===userJob) intensity = 0.4;                        // will use it
          else if(traits.includes(q.trait))   intensity = 0.3;                        // just cares
          if(!intensity) continue;
          addMemory(q, {kind:"project", text, intensity, valence:0.6,
                        tags:{action:"project", place:def.id, subject:"built"}});
        }
        pushRecentEvent({kind:"project", text:`${def.name.toLowerCase()} finally going up`,
                         weight:1.5, tags:{subject:"built"}});
      }
      S.people.forEach(p=>{if(p.job==="project")p.job=null;});
      S.project=null;
    }
  }

  // --- hearth, commons & care ---
  const cc = S.sys.commons.cond;
  const fa=S.f||{};
  let aura = (cc>=70 ? 1 : cc>=50 ? 0.5 : cc<40 ? -1 : 0) + (fa.spirits||0);
  if(fa.spiritsGrey && wx.id!=="clear") aura += fa.spiritsGrey;
  // sunflowers in the beds lift the whole village a little
  if(S.beds.some(b=>b.crop==="sunflower")) aura += 0.4;
  // a recent festival's afterglow — see holdFestival()
  if((S.festivalBoostDays||0)>0){ aura += 1.5; S.festivalBoostDays--; }
  if((S.festivalCooldown||0)>0) S.festivalCooldown--;
  // --- food variety: a monotonous diet wears on people; a varied one lifts them ---
  // Look at what's been harvested in the last ~3 weeks. Only matters when the
  // village actually leans on its own crops (not living on fish and foraging).
  S.dietLog = S.dietLog.filter(e => S.day - e.day <= 21);
  let varietyMood = 0, dietKinds = 0;
  {
    const recent = S.dietLog.filter(e => S.day - e.day <= 14);
    const kinds = new Set(recent.map(e=>e.crop));
    dietKinds = kinds.size;
    const leaningOnGarden = recent.reduce((a,e)=>a+e.amt,0) > 12; // meaningful garden eating
    if(leaningOnGarden){
      if(dietKinds<=1)      varietyMood = -0.7;   // week after week of the same thing
      else if(dietKinds===2) varietyMood = -0.2;
      else if(dietKinds>=4)  varietyMood = 0.5;   // a full table
      else                   varietyMood = 0.2;
    }
  }
  aura += varietyMood;
  if(cooks.length){
    const c=cooks[0];
    aura += 0.5 + effStat(c,"care","cook")*0.3*eff(c) + (c.trait==="Mender"?0.5:0);
  }
  const carers=working("care");
  let careBoost=0, careHeal=0;
  if(carers.length){
    const c=carers[0];
    careBoost = 2 + effStat(c,"care","care")*0.5*eff(c) + (c.trait==="Mender"?2:0);
    careHeal = 0.12*effStat(c,"care","care")*eff(c);
  }

  // --- wellbeing ---
  // Starvation is a CEILING, not a subtraction. The strain math below still
  // runs (it sets the slope), but no amount of good company, warm hearth, or
  // trait bonus can hold spirits above these caps while the village goes
  // hungry — that's how a starving village once read 97 spirits. The caps
  // collapse per consecutive lean day; thirst runs a step harsher.
  // OFF-BY-ONE, deliberate: S.hungerDays/S.thirstDays are incremented AFTER
  // this block (end of day), so on the first lean day they still read 0 —
  // today is lean day (count+1), which maps to array index (count) directly.
  // Thirst caps key off `thirst` (a real supply shortfall), NOT `thirstFelt`,
  // so voluntary rationing keeps its existing mild bite without a cliff.
  const HUNGER_CAP=[70,55,40,28,20], THIRST_CAP=[55,40,28,20,14];
  const capAt=(arr,days)=>arr[Math.min(arr.length-1, Math.max(0, days||0))];
  // A long deficiency puts its own, much gentler ceiling on top of these:
  // starvation is a cliff, malnutrition is a slope. See tickMacros.
  const wbCeil = Math.min(
    hunger>0 ? capAt(HUNGER_CAP, S.hungerDays) : 100,
    thirst>0 ? capAt(THIRST_CAP, S.thirstDays) : 100,
    macCeil
  );
  // the Weathered floor (25) still holds even under the ceiling — the trait's
  // promise is literal, and one person who won't break is worth keeping
  const capWb = p => { if(wbCeil<100) p.wb = Math.max(wbFloor(p), Math.min(p.wb, wbCeil)); };
  const standstill = !S.people.some(p=>p.status==="ok");
  const spentToday=[], recovered=[];
  for(const p of S.people){
    if(p.status==="away") continue;
    if(p.status==="down"){
      // The day you come home hurt is not also a day of recovery.
      // tickExpeditions runs at the top of simulateDay and this block runs
      // near the bottom, so a two-day injury could be decremented here --
      // and rolled down again by care and by the herbal stores -- before
      // the same day was out. The journal then reported that someone came
      // back injured and was back on their feet, in one entry.
      const hurtToday = p.downSince === S.day;
      if(!hurtToday){
        p.downDays -= standstill?2:1;
        if(careHeal && p.downDays>0 && Math.random()<careHeal){ p.downDays--; }
        if(F.herbalStores && p.downDays>0 && Math.random()<0.3){ p.downDays--; }
      }
      p.wb=clamp(p.wb+2+careBoost+(standstill?6:0),0,100);
      capWb(p);
      if(p.downDays<=0){ p.status="ok"; p.downSince=null; recovered.push(p); }
      continue;
    }
    let d=0;
    // rest only restores when there is something in the pot
    const restBase = hunger>0 ? 1 : 4;
    const spentBase = hunger>0 ? 4 : 8;
    if(p.job===null){ d += (p.status==="spent") ? spentBase+careBoost+(standstill?6:0) : restBase; if(p.trait==="Tinkerer") d-=2; }
    else { d -= (p.trait==="Steady") ? 0 : 1; }
    if(p.job===p._yjob && p.job!==null) p.streak++; else p.streak=1;
    p._yjob=p.job;
    if(p.trait==="Restless" && p.streak>=3 && p.job!==null) d-=3;
    d += aura;
    // cut household water is felt at home: cold sparse meals (cooking off),
    // nothing washed (cleaning half/off)
    if(p.status!=="away") d -= (cookAl===0?1:0) + (cleanAl===0.5?0.5:cleanAl===0?1.5:0);
    // hunger AND thirst compound: the first lean day is bearable, the fifth is not
    const hungerBite = hunger>0 ? (3 + 2*Math.min(4,S.hungerDays))*hunger : 0;
    const thirstBite = thirstFelt>0 ? (3 + 2*Math.min(4,S.thirstDays))*thirstFelt : 0;
    // macDrag is the malnutrition slope — no bite at all for the first ten
    // deficient days, then a small daily cost that caps low. It sits with
    // the other strains rather than in its own system.
    // the malnutrition drag stops pushing once it has pushed someone down to
    // its floor — it makes people weak and keeps them weak, rather than
    // driving them to nothing. Starvation is the system that kills.
    const macBite = p.wb > macFloor ? macDrag : 0;
    const strain = hungerBite + thirstBite + macBite + (commonsLit?0:2);
    d -= (p.status==="spent"||standstill) ? strain*0.5 : strain;
    p.wb = clamp(p.wb+d, wbFloor(p), 100);
    capWb(p);
    if(p.status==="spent" && p.wb>=30){ p.status="ok"; recovered.push(p); }
    if(p.status==="ok" && p.wb<=5){ p.status="spent"; spentToday.push(p); }
  }

  // --- illness ---
  const healthy=S.people.filter(p=>p.status==="ok");
  const sickChance=Math.max(0.02, (F.herbalStores?0.07:0.12) - (F.draftProof?0.02:0));
  if(healthy.length && Math.random()<sickChance){
    // who it lands on is weighted by lifetime exposure — the same roll,
    // but the people who drank the bad water come up more often
    let sick=(function(){
      const w=healthy.map(toxSickMult);
      const tot=w.reduce((a,b)=>a+b,0);
      let r=Math.random()*tot;
      for(let i=0;i<healthy.length;i++){ r-=w[i]; if(r<=0) return healthy[i]; }
      return healthy[healthy.length-1];
    })();
    if(sick.trait==="Cautious" && Math.random()<0.7) sick=null;
    if(sick){ sick.status="down"; sick.downDays=2; const wasJob=sick.job; sick.job=null;
      const stillTended = wasJob && wasJob!=="away" && working(wasJob).length>0;
      lines.push(`${sick.name} woke feverish and was sent to rest${wasJob&&wasJob!=="away"&&!stillTended?`; the ${jobName(wasJob).toLowerCase()} went untended`:""}.`);
      addMemory(sick, {kind:"illness", text:MEM_TEXT.illness(), intensity:0.35, valence:-0.4,
                       tags:{subject:"illness", place:"sickbed"}});
    }
  }
  // with cleaning water shut off entirely, sickness finds the village faster —
  // a second, separate roll that only exists while the tap is closed
  if(cleanAl===0){
    const home=S.people.filter(p=>p.status==="ok");
    if(home.length && Math.random()<NO_CLEANING_SICK){
      const sick=pick(home);
      sick.status="down"; sick.downDays=2; sick.job=null;
      lines.push(`${sick.name} got sick. Unwashed dishes, unwashed hands — with the cleaning water shut off, it was a matter of time.`);
    }
  }

  // --- the turn of each season: the land's slow feedback runs ---
  if(dayOfSeason(S.day)===SEASON_LEN){
    stepRestoration(lines);
    resetSeasonFlares();   // a new season is a clean(ish) slate; the per-pair log persists
  }

  // --- the turn of the year: people age, and the village changes ---
  if(dayOfSeason(S.day)===SEASON_LEN && season().id==="winter"){
    const yr = yearOf(S.day);
    for(const p of S.people){ p.age++; p.years++; }

    // a child comes into the village
    const adults = S.people.filter(p=>canWork(p) && p.age<48 && p.status!=="away");
    const wellFed = S.res.food + S.preserved > 25;
    if(adults.length>=4 && wellFed && S.people.length<18 && Math.random()<0.45){
      const used = new Set(S.people.map(p=>p.name));
      const name = pick(CHILD_NAMES.filter(n=>!used.has(n))) || generateFallbackChildName(used);
      if(name){
        // two distinct raisers where the village is big enough; if only one adult
        // is eligible, they raise the child alone rather than co-parenting themselves
        const r0 = pick(adults);
        const rest = adults.filter(a=>a!==r0);
        const r1 = rest.length ? pick(rest) : r0;
        const raisers = [r0, r1];
        // a child inherits from who raises them, not who bore them
        const inh = k => clamp(Math.round((raisers[0][k]+raisers[1][k])/2 + (Math.random()<0.5?-1:1)), 1, 5);
        const kid = {
          id:"child_"+S.day+"_"+name.toLowerCase(), name, pn: pick(["she/her","he/him","they/them"]),
          trait: pick(Object.keys(TRAITS)), hands:inh("hands"), green:inh("green"), care:inh("care"), wild:inh("wild"),
          note: pick(CHILD_NOTES), age:0, years:0, perm:null,
          wb:80, job:null, streak:0, status:"ok", downDays:0,
          // born here, so no pre-game memory — nothing happened to them yet
          memories:[], frontId:null,
          personality: rollPersonality(),   // chemistry, not lineage — deliberately not inherited
          toxins: 0,   // born clean; the well will do its own work over their lifetime
          music: rollMusic(),
          practice:{specific:{}, broad:{hands:0,green:0,care:0,wild:0}}   // earned fresh, not inherited
        };
        kid.ideology = seedIdeology(kid);   // seeded from their own rolled self; the village will do the rest
        S.people.push(kid);
        S.births++;
        const raiserPhrase = raisers[0]===raisers[1]
          ? `${raisers[0].name} will raise ${name}, and so will everyone else`
          : `${raisers[0].name} and ${raisers[1].name} will raise ${name} between them, and so will everyone else`;
        lines.push(`A child was born in the deep of winter and named ${name}. ${raiserPhrase}.`);
        addMemoryAll(S.people.filter(q=>q.status!=="away" && q.id!==kid.id), {
          kind:"birth", text:MEM_TEXT.birth(name), intensity:0.7, valence:0.8,
          tags:{people:[kid.id], subject:"birth"}});
        pushRecentEvent({kind:"birth", text:`${name} being born`, weight:2,
                         tags:{subject:"birth", people:[kid.id]}});
      }
    }

    // the old die, in winter, at home. Nobody dies "in a warm room" while out on
    // the road — the away check also prevents a death from stranding an expedition
    // that still holds the person's id (which used to crash the next day's tick).
    for(const p of [...S.people]){
      if(p.age<ELDER) continue;
      if(p.status==="away") continue;
      const risk = 0.04 + Math.max(0,(p.age-ELDER))*0.022 + (p.wb<35?0.05:0) + toxDeathAdd(p);
      if(Math.random()<risk){
        S.people = S.people.filter(x=>x!==p);
        S.deaths++;
        /* S.gone is what makes ache possible. Removing someone from S.people
           erases every fact about them; the fond memories other people hold
           would otherwise have no way to ask whether they're still here. */
        recordGone(p, "death");
        S.people.forEach(q=>{ if(q.status!=="away") q.wb=clamp(q.wb-7,wbFloor(q),100); });
        // for everyone who was there. Unforgettable: this is one of the three
        // things a person keeps at near-zero salience forever rather than
        // losing to routine churn.
        addMemoryAll(S.people.filter(q=>q.status!=="away"), {
          kind:"death", text:MEM_TEXT.death(p.name), intensity:0.9, valence:-0.9,
          unforgettable:true, tags:{people:[p.id], subject:"death"}});
        pushRecentEvent({kind:"death", text:`${p.name}, and the night of it`, weight:2.5,
                         tags:{subject:"death", people:[p.id]}});
        lines.push(`${p.name} died in the night, ${p.age} years old, in a warm room with people in it. ${Cap(subj(p))} ${hasHave(p)} been here as long as anyone can easily say.`);
        const memLines=[`${p.name} — ${p.note}`];

        // apprenticeship: whatever this person was best at doesn't vanish with
        // them if someone else was already standing beside them doing it —
        // that person inherits a real chunk of the practice, not just a memory.
        const legacy = bestSpecific(p);
        if(legacy && legacy.val>=0.15){
          const heir = S.people.find(q => q.id!==p.id && q.job===legacy.key && canWork(q));
          if(heir){
            const hpr=practiceOf(heir);
            const before = hpr.specific[legacy.key]||0;
            hpr.specific[legacy.key] = Math.min(PRACTICE_SPECIFIC_CAP, before + legacy.val*0.45);
            if(hpr.specific[legacy.key] > before + 0.02){
              memLines.push(`${heir.name} had stood beside ${objp(p)} at ${practiceLabel(legacy.key)} long enough to keep going without ${objp(p)}. Some of what ${subj(p)} knew, ${heir.name} ${isAre(heir)} carries forward.`);
            }
          }
        }

        // a tree for the hill: costs nothing, and eventually feeds whoever's here
        // to pick it. Only plantable once the village actually knows a perennial.
        S.forest = S.forest || [];
        const knownPerennial = Object.keys(CROPS).find(id=>CROPS[id].perennial && (!CROPS[id].locked || (S.crops&&S.crops[id])));
        if(knownPerennial && S.forest.length<MAX_FOREST_PLOTS){
          S.forest.push({crop:knownPerennial, growth:0, days:0, ready:false, stored:0, fertility:80, plantedDay:S.day, memorial:p.name});
          memLines.push(`${CROPS[knownPerennial].name} went into the ground on the hill above the beds, for ${p.name}.`);
        }

        S.journal.unshift({day:S.day, weather:S.weather, event:true,
          lines:[...memLines, `Buried on the hill above the beds. The village keeps going, which is what ${subj(p)} would have said.`]});
      }
    }

    // someone leaves: the road pulls at the restless, and at the young
    if(S.people.length>7 && Math.random()<0.22){
      const cands = S.people.filter(p=>p.status==="ok" && canRoad(p) && (p.trait==="Restless"||p.age<26) && p.wb<62);
      if(cands.length){
        const p = pick(cands);
        S.people = S.people.filter(x=>x!==p);
        S.departures++;
        recordGone(p, "departure");
        addMemoryAll(S.people.filter(q=>q.status!=="away"), {
          kind:"departure", text:MEM_TEXT.departure(p.name), intensity:0.5, valence:-0.4,
          tags:{people:[p.id], subject:"departure"}});
        pushRecentEvent({kind:"departure", text:`${p.name} going`, weight:1.8,
                         tags:{subject:"departure", people:[p.id]}});
        lines.push(`${p.name} left with a pack and an apology. ${Cap(subj(p))} said there was a place ${subj(p)} needed to see. Nobody stopped ${objp(p)}.`);
      }
    }
    lines.push(`— The turn of year ${yr}. ${S.people.length} at the table.`);
  }

  // --- practice: today's work quietly becomes tomorrow's skill ---
  applyPracticeUpdate(workSnapshot);

  // --- events ---
  maybeSpawnEvent();
  // add new stuff here 
  if (S.day > 5) { // e.g., let them settle in for a few days first
    tickRelationships(); 
    if(cookAl>0) tickDinnerBonds(hunger, S.sys.commons.cond); // no one bonds over a cold, silent dinner
    tickFriction(lines);      // flares read today's wb and bonds, after the warm ticks land
    tickConflicts(lines);     // and the conflict lifecycle reads today's flares
    tickMoments(lines);       // and the small tender things, off the same bond graph
  }
  /* --- what people are carrying ---
     Runs from day one, unlike the bond systems above: a founder has a
     pre-game memory before anything here has happened, and it should be
     decaying and surfacing from the first morning. Order matters — the
     memory tick sets each person's front-of-mind, and conversations read it
     to pick a topic, so it has to land first. wbCeil is passed through so a
     fond memory can't lift anyone above what a hungry village allows. */
  tickRecentEvents();
  tickMemories(lines, wbCeil);
  if (S.day > 5) tickConversations(lines);
  tickCelebCooldowns();
  tickTraditions(lines);      // anything the village keeps yearly comes round on its day
  driftIdeology(lines);       // stances move last, off the day as it actually went

  tickDepartures(lines);            
  tickVillageSpiritsStreak();      
  
  if (S.lowSpiritsStreak === 5 && S.day % 7 === 0) {
    lines.push("No one has come up the road in a long time. The valley has a reputation now — a place where people go to fade.");
  }


  /* --- BEHAVIOURAL TEETH ---
     A memory system without behavioural consequence is just a nicer `mem`
     string. What a dwarf who watched someone die in a mineshaft does about
     mining is what makes that game read as alive.

     Deliberately capped at reluctance and journal texture. No hard refusal:
     blocking a job assignment fights the player instead of characterising
     anybody, and the player is the one who can actually see the roster. One
     line a day, so this stays texture rather than a second journal. */
  {
    const sore = [];
    for(const q of S.people){
      if(q.status==="away" || !q.job) continue;
      const m = reluctance(q, {action:q.job});
      if(m) sore.push({q, m});
    }
    if(sore.length && Math.random() < 0.4){
      const {q} = pick(sore);
      lines.push(`${q.name} has been slow to ${jobName(q.job).toLowerCase()} lately. ${Cap(subj(q))} ${hasHave(q)} not said why, and nobody has asked.`);
    } else if(S.people.some(q=>q.status==="down")){
      // a live grief turns people toward the sickbed. Query only: the player
      // assigns jobs, and a system that quietly reassigns them behind the
      // player's back is a bug wearing a feature's coat.
      const drawn = S.people.filter(q=>q.status!=="away" && q.status!=="down" && canWork(q) && drawnToCare(q));
      if(drawn.length && Math.random() < 0.3){
        const q = pick(drawn);
        lines.push(`${q.name} keeps finding reasons to be near the sickbed. ${Cap(subj(q))} ${isAre(q)} not much use there, and goes anyway.`);
      }
    }
  }

  // --- journal ---
  if(dayOfSeason(S.day)===1){
    const s=season();
    lines.unshift(`— ${s.name}. ${seasonNote(s)}`);
  }
  let wxLine;
  if(wx.id==="clear")    wxLine = built("solar") ? "A clear day; the panels turned sunlight into electricity." : "A clear, bright day.";
  else if(wx.id==="overcast") wxLine = built("turbine") ? "Grey all day, the turbine spinning in the wind." : "Grey day.";
  else                   wxLine = built("catchment") ? "Rain on the catchment roof — a good kind of noise." : "Rain all day.";
  lines.unshift(wxLine);
  // monotony and abundance are ALSO the meal's business — handed to dinnerLine
  // rather than pushed here, so the table is described once, by one voice.
  S.report.varietyMood = varietyMood;
  if(brownout) lines.push(built("aquaponics")
    ? "We didn't have enough electricity to run everything today. Brownout. The fish tanks went quiet for a while."
    : "We didn't have enough electricity to run everything today. Brownout. The pump slowed to a trickle and we spent the evening in the dark.");
  if(standstill) lines.push("No one is on their feet. The village is resting.");
  // the village counts its stores against the coming winter
  {
    const sn=season();
    const daysToWinter = sn.id==="winter" ? 0
      : ((SEASONS.findIndex(s=>s.id==="winter") - seasonIdx(S.day))*SEASON_LEN) - dayOfSeason(S.day) + 1;
    const need = S.report && S.report.foodOut ? S.report.foodOut : mouths;
    const winterNeed = need*SEASON_LEN;
    const banked = S.res.food + S.preserved;
    S.winterDays = need>0 ? banked/need : 0;
    if(sn.id==="autumn" && dayOfSeason(S.day)===20){
      const short = winterNeed - banked - (built("aquaponics") ? aquaFood*SEASON_LEN*0.8 : 0);
      lines.push(short > 0
        ? `Ten days to the frost. Counting the jars and the cellar: about ${Math.max(0,short).toFixed(0)} short to last the winter.`
        : `Ten days to the frost, and we have enough food stored.`);
    }
  }

  /* A hunger stretch is one memory, not one a day. It lands on the fourth
     lean day — the same point the journal stops describing thin meals and
     starts counting them — and its end lands the day the counter releases,
     because the first proper meal after is its own distinct thing. */
  const hungerWas = S.hungerDays || 0;
  if(hunger>0){ S.hungerDays++; } else { S.hungerDays=0; }
  if(hunger>0 && S.hungerDays === 4){
    addMemoryAll(S.people.filter(q=>q.status!=="away"), {
      kind:"hunger", text:MEM_TEXT.hunger(4), intensity:0.6, valence:-0.7,
      tags:{subject:"hunger", place:"commons"}});
    pushRecentEvent({kind:"hunger", text:"the hungry stretch", weight:2,
                     tags:{subject:"hunger"}});
  }
  if(hunger<=0 && hungerWas >= 4){
    addMemoryAll(S.people.filter(q=>q.status!=="away"), {
      kind:"famineEnd", text:MEM_TEXT.famineEnd(), intensity:0.5, valence:0.7,
      tags:{subject:"hunger", place:"commons"}});
    pushRecentEvent({kind:"famineEnd", text:"the first proper meal after", weight:1.5,
                     tags:{subject:"hunger"}});
  }
  if(thirstFelt>0){ S.thirstDays++; } else { S.thirstDays=0; }
  if(hunger>0){
    const avgWb = S.people.length ? S.people.reduce((a,p)=>a+p.wb,0)/S.people.length : 100;
    const low = avgWb < 55;
    if(S.hungerDays>=4) lines.push(low
      ? "Day "+S.hungerDays+" without adequate food. People move slower and speak less."
      : "Day "+S.hungerDays+" of thin meals. Not sure how much longer we can manage this way.");
    else if(S.hungerDays>=2) lines.push(low
      ? "The food stores are empty again. Belts tightened, tempers shorter."
      : "Not enough food. Again.");
    else lines.push("Not enough at the long table tonight.");
  }
  if(thirst>=0.34) lines.push(S.thirstDays>=4
    ? "Day "+S.thirstDays+" without adequate water. People are short with each other, and no one's washing much."
    : "Not enough water -- a day of dry throats and short tempers.");
  else if(thirst===0 && thirstFelt>0) lines.push(S.thirstDays>=3
    ? "Day "+S.thirstDays+" on water rationing."
    : "We need more water.");
  else if(thirst>0) lines.push(S.thirstDays>=3
    ? "Day "+S.thirstDays+" of inadequate water."
    : "The cisterns ran low. We watch the horizon for rain clouds.");
  for(const p of spentToday) lines.push(p.job
    ? `${p.name} has nothing left. ${Cap(subj(p))} keeps working -- slowly, badly -- because the work needs done and no one else is doing it.`
    : `${p.name} has nothing left. ${Cap(subj(p))} sat down and didn't get up again today.`);
  for(const p of recovered) lines.push(`${p.name} is back on ${poss(p)} feet.`);
  const failing = worstSys && worstCond<35;
  if(failing) lines.push(`The ${worstSys.name.toLowerCase()} is failing. Someone should work on it.`);
  if(commonsLit && hunger===0 && thirst===0 && Math.random()<(failing?0.14:0.32)){
    const base=[
      "An ordinary day, somehow.",
      "Someone fixed a squeaking hinge or uneven table without being asked.",
      "The evening smelled like rain and solder."
    ];
    // named lines only appear while that person is actually here to be doing them
    //if(byId("ora") && byId("ora").status!=="away") base.push("Ora left the last tomato on the vine. For luck, she said.");
    if(byId("theo") && byId("theo").status!=="away") base.push("Theo raced the sunset up the water tower and won.");
    //if(byId("kav") && byId("kav").status!=="away") base.push("Kav's weather log gained a page. Xe says the sky owes us one.");
    const pool=[...base];
    for(const id of (S.founding&&S.founding.visuals||[])){
      const v=VISUALS.find(x=>x.id===id);
      const ls=v&&v.fx.journal&&FV[v.fx.journal];
      if(!ls) continue;
      // FV entries are plain strings or {who, present, absent} variants
      // (see data-events.js) — resolve by whether that character is here today
      const resolved=ls.map(e=>typeof e==="string"?e
        :((byId(e.who)&&byId(e.who).status!=="away")?e.present:e.absent));
      pool.push(...resolved,...resolved);
    }
    lines.push(pick(pool));
  }

  // what's for dinner -- not every night, so it stays a small pleasure to notice
  // every third night, plus every second night while the shelves are carrying
  // the village — running down the winter stores is worth hearing about
  if(S.day % 3 === 0 || ((S.report.fromJars||0) > 0.2 && S.day % 2 === 0)){
    const dl = dinnerLine();
    if(dl) lines.push(dl);
  }
  if(compostSpread && S.day % 7 === 0){
    const isForestPlot = (S.forest||[]).includes(compostTarget);
    addRestore("mycosphere", RESTORE_IN.compost);   // returning worn soil to life feeds the web
    lines.push(`Turned compost went onto ${isForestPlot?"a tired plot in the food forest":"the worst of the beds"} — improving soil richness.`);
  }





  S.journal.unshift({day:S.day, weather:wx.word, lines});
  if(S.journal.length>80) S.journal.length=80;

  // --- reputation (hidden): a slow read on whether this is a good place to end
  // up, built from spirits, food security, and water security. It moves a
  // little each day toward how things actually are right now, so one bad day
  // doesn't swing it -- it reflects sustained conditions, the way word actually
  // travels. It nudges how often a stranger finds the road here (see EVENTS).
  {
    const avgWbNow = S.people.length ? S.people.reduce((a,p)=>a+p.wb,0)/S.people.length : 100;
    const foodOk = S.hungerDays===0 ? 1 : clamp(1-S.hungerDays*0.15, 0, 1);
    const waterOk = 1-thirst;
    const instantRep = clamp(0.5*(avgWbNow/100) + 0.3*foodOk + 0.2*waterOk, 0, 1);
    S.reputation = clamp((S.reputation??0.55) + (instantRep-(S.reputation??0.55))*0.03, 0, 1);
  }

  const hearthKeep = S.report && S.report.hearth;   // written back in the temperature
                                                   // block, long before this wholesale
                                                   // rebuild — carry it or the hearth
                                                   // card has nothing to read
  S.report={hearth:hearthKeep, gen,draw,cap,foodIn,foodOut,waterIn:wIn,waterOut:wOut,brownout,thirst, preserveWhy:S._preserveWhy||"", pressWhy:S._pressWhy||"",
    waterParts:{drink:drinkUse, garden:gardenWater*wateredBeds*irrAl, gardenFull:gardenWater*wateredBeds, cook:1*cookAl, clean:1*cleanAl, perBed:gardenWater},
    powerLoss, waterLoss,
    genWhy:genWhy.join(" · ")||"nothing built that makes power", gardenWhy:gWhy.join(" · "), aquaWhy:S._aquaWhy||"", gardenFood, aquaFood, woodWhy:S._woodWhy||""};


  // roll tomorrow's weather now, using tomorrow's season, so a forecast (once
  // unlocked) is a real fact about the day ahead rather than a guess
  { const _d=S.day; S.day=_d+1; S.forecast=rollWeather().id; S.day=_d; }

  S.day++;
}

/* Who a finished thing is FOR. Used only by the project-completion memories:
   somebody whose daily work runs through a system remembers it being raised
   differently from somebody who happened to be in the village that week.
   Not everyone present is equally OF an event. */
const WORK_USER_JOB = {
  aquaponics:"aquatend", irrigation:"garden", catchment:"garden", commons:"cook",
  solar:"solar", turbine:"turbine", battery:"battery",
  rootCellar:"preserve", dryRacks:"preserve", crocks:"preserve", canning:"preserve",
  oilPress:"press", gardenBeds:"garden", coldFrames:"garden", compost:"garden",
  graywater:"garden", dripRetrofit:"garden", seedSaving:"garden",
  herbalStores:"care", toolLibrary:"project", well:"catchment",
  woodStove:"cook", rocketHeater:"cook", earthBerming:"project"
};
/* ...and whose temperament it speaks to, for the people who just care. */
const WORK_TRAIT = {
  hands:["Tinkerer"], green:["Green-thumb"], care:["Mender"], wild:["Restless"]
};

const JOB_SKILL = {garden:"green", aquatend:"green", care:"care", cook:"care", project:"hands", preserve:"care", press:"hands", fab:"hands", woodcut:"wild"};
/* whatever currently occupies the single work slot: a system being raised, or a project */
function workDef(){
  if(!S.project) return null;
  return S.project.kind==="build" ? SYS.find(x=>x.id===S.project.id) : PROJECTS.find(p=>p.id===S.project.id);
}
function workName(){
  const d=workDef(); if(!d) return "Workshop";
  return S.project.kind==="build" ? `Building the ${d.name.toLowerCase()}` : d.name;
}
function jobSkill(j){ return JOB_SKILL[j]||"hands"; }
function assignPhrase(p){
  const j=p.job;
  if(!j || j==="away") return "";
  // things phrased as an activity, not a place ("putting food by", "fabrication")
  if(j==="preserve") return "Preserving food";
  if(j==="press") return "Pressing oil";
  if(j==="fab"){
    const d=S.fabProject?FABS.find(x=>x.id===S.fabProject.id):null;
    return d?`Building the <b>${d.name.toLowerCase()}</b>`:"Fabricating";
  }
  if(j==="project"){
    // a project may be building a new system or an improvement
    const isSys = S.project && S.project.kind==="build";
    return `${isSys?"Building":"Working on"} the <b>${workName().toLowerCase()}</b>`;
  }
  // a SYS job: building it if not yet built, otherwise keeping it
  const d=SYS.find(s=>s.id===j);
  if(d && !built(j)) return `Raising the <b>${d.name.toLowerCase()}</b>`;
  return `Maintaining the <b>${jobName(j).toLowerCase()}</b>`;
}
function jobName(j){
  if(j==="garden") return "Gardens";
  if(j==="aquatend") return "Fish tanks";
  if(j==="care") return "Sickbed";
  if(j==="cook") return "Hearth";
  if(j==="preserve") return "Storing food";
  if(j==="press") return "Pressing oil";
  if(j==="fab") return S.fabProject ? FABS.find(x=>x.id===S.fabProject.id).name : "Fabrication";
  if(j==="project") return workName();
  if(j==="woodcut") return "The tree line";
  if(j==="away") return "Away";
  const d=SYS.find(s=>s.id===j); return d?d.name:"—";
}

/* ================= time ================= */
function catchUp(){
  const now=Date.now();
  let elapsed=Math.floor((now-S.lastTick)/DAY_MS);
  if(elapsed<=0) return 0;
  const run=Math.min(elapsed, OFFLINE_CAP);
  for(let i=0;i<run;i++) simulateDay();
  S.lastTick = now - ((now-S.lastTick) % DAY_MS);
  if(elapsed>OFFLINE_CAP) S.lastTick=now;
  return run;
}
function endDayNow(){
  simulateDay();
  S.lastTick=Date.now();
  store.save(S); renderAll();
}












export { assignPhrase, catchUp, endDayNow, jobName, jobSkill, simulateDay, workDef, workName };
