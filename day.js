import { S } from "./state.js";
import { ELDER, canRoad, canWork, dayOfSeason, generateFallbackChildName, rollWeather, scaledWeather, season, seasonIdx, seasonNote, yearOf } from "./seasons.js";
import { AQUA_STAGNANT_WEAR, BATTERY_UNIT, CANNING_DRAW, CROPS, DAY_MS, FABS, FAB_DRAW, FAB_RATE, JOB_PRACTICE, LOSS_DECAY, MAX_FOREST_PLOTS, NO_CLEANING_SICK, OFFLINE_CAP, POLLINATOR_YIELD, POWER_LOSS_BASE, PRACTICE_BROAD_CAP, PRACTICE_BROAD_DECAY, PRACTICE_BROAD_GROWTH, PRACTICE_SPECIFIC_CAP, PRACTICE_SPECIFIC_DECAY, PRACTICE_SPECIFIC_GROWTH, PRESERVE, PROJECTS, RESTORE_IN, SEASONS, SEASON_LEN, SOLAR_UNIT, SYS, TURBINE_UNIT, WATER_LOSS_BASE, WITHER_CHANCE, YIELD_SOIL_FLOOR, YIELD_TEND_MAX, YIELD_TEND_SCALE } from "./data-economy.js";
import { Cap, byId, clamp, decayPractice, eff, effStat, growPractice, hasHave, isAre, mult, objp, pick, poss, practiceOf, subj, wbFloor, working } from "./helpers.js";
import { TRAITS, VISUALS, addRes, addRestore, built, decayOf, foodCap, stepRestoration, waterCapEff } from "./defs.js";
import { tickExpeditions } from "./expeditions.js";
import { CHILD_NAMES, CHILD_NOTES, FV } from "./data-events.js";
import { bestSpecific, practiceLabel, renderAll } from "./render.js";
import { maybeSpawnEvent, tickDepartures, tickDinnerBonds, tickRelationships, tickVillageSpiritsStreak } from "./events.js";
import { store } from "./store.js";









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
    if(today && today.specific!=null){
      pr.specific[today.specific] = growPractice(pr.specific[today.specific]||0, PRACTICE_SPECIFIC_CAP, PRACTICE_SPECIFIC_GROWTH);
    }
    for(const k in pr.specific){
      if(today && k===today.specific) continue;
      pr.specific[k] = decayPractice(pr.specific[k], PRACTICE_SPECIFIC_DECAY);
    }

    // broad: grow today's category, decay the other three
    for(const cat of ["hands","green","care","wild"]){
      if(today && today.broad===cat) pr.broad[cat] = growPractice(pr.broad[cat]||0, PRACTICE_BROAD_CAP, PRACTICE_BROAD_GROWTH);
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
function dinnerLine(){
  const cook = working("cook")[0];
  const starving = (S.res.food + S.preserved) < 3 || (S.hungerDays||0) > 0;
  // gather what's available. Sunflower is excluded from the fresh-veg list --
  // it shows up as oil instead (see oilBit), so it isn't named twice in one line.
  const freshCrops = [...new Set(S.dietLog.filter(e=>S.day-e.day<=5 && e.crop!=="sunflower").map(e=>e.crop))];
  const freshNames = freshCrops.filter(c=>CROPS[c]).map(c=>CROPS[c].food || CROPS[c].name.toLowerCase());
  const hasOil   = (S.oil||0) > 0.3;
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
  const keptBit = hasKept ? pick1(["beans put up last season","pickles up from the crocks","something dried, rehydrated","what was canned in the good months"]) : "";
  const fishBit = hasFish ? pick1(["the day's fish","trout from the tanks","fish, fresh from the tanks"]) : "";
  const forageBit = hasForaged ? pick1(["mushrooms someone found on the ridge","wild-picked greens","what the foragers gathered"]) : "";

  // high quality + real variety -> a proper spread
  if(quality>=3.5 && components>=3){
    const parts=[];
    if(freshNames.length){ parts.push(`${list(freshNames)}${oilBit}`); if(oilBit) S.oil=Math.max(0,S.oil-0.4); }
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
    if(freshNames.length && oilBit) S.oil=Math.max(0,S.oil-0.4);
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

function simulateDay(){
  // captured before anything else runs — see buildWorkSnapshot() for why
  const workSnapshot = buildWorkSnapshot();
  const lines=[...S.pending]; S.pending=[];
  // if a forecast was made for today (see the end of this function), honor it —
  // the log only means something if it's actually right
  const wx = S.forecast ? scaledWeather(S.forecast) : rollWeather();
  S.weather=wx.id;
  const F=S.flags;
  const sn=season();


  // --- TEMPERATURE EXTREMES ---
  const isSummer = sn.id === "summer";
  const isWinter = sn.id === "winter";
  
  let tempEvent = null;
  if (isSummer && Math.random() < 0.15) tempEvent = "heatwave";
  if (isWinter && Math.random() < 0.15) tempEvent = "deepfreeze";

  let indoorSafety = 0; // 0 = dangerously exposed, 1 = perfectly comfortable
  
  if (isWinter) {
    if (F.earthBerming) indoorSafety += 0.4; // Passive insulation
    if (F.woodStove && S.res.wood >= 3) {
      S.res.wood -= 3; // Burn wood to stay alive
      indoorSafety += 0.6;
      lines.push("The masonry heater burned through 3 wood today, keeping the Commons warm against the cold.");
    } else if (F.woodStove && S.res.wood < 3) {
      lines.push("A freezing day, and the woodpile is empty. The masonry heater sits cold.");
    }
  }

  if (isSummer) {
    if (F.earthBerming) indoorSafety += 0.6; // Earth walls keep things cool
    // AC could be added here later, draining S.res.charge heavily
  }

  // --- APPLYING EXTREME WEATHER CONSEQUENCES ---
  if (tempEvent === "heatwave") {
    lines.push("A blistering heatwave today.");
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
          p.downDays = 2;
          lines.push(`Heatstroke. ${p.name} collapsed in the sun and had to be carried to the sickbed.`);
        }
      }
    }
  }

  if (tempEvent === "deepfreeze") {
    lines.push("A deep, killing freeze settled into the valley.");
    for (const p of S.people) {
      // The vulnerable are at extreme risk if indoor safety is low
      if (p.age >= ELDER && indoorSafety < 0.5) {
         p.wb = clamp(p.wb - 20, wbFloor(p), 100);
         // Spikes the death roll for elders handled in the aging block
         if (Math.random() < 0.15) {
           p.status = "down";
           p.downDays = 4;
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

  tickExpeditions(lines);

  // gift return, if any
  if(S.giftDay && S.day>=S.giftDay){
    if(S.giftGood){
      S.res.seeds+=5; S.res.parts+=3;
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
  const canningAl = F.canning           ? alv("canning") : 0;
  const fabAl     = S.fabProject        ? alv("fab")     : 0;
  const sysDraw=id=>SYS.find(d=>d.id===id).draw;
  const rawDraw = sysDraw("catchment")*pumpAl + sysDraw("aquaponics")*aquaAl
                + sysDraw("commons")*commonsAl
                + CANNING_DRAW*canningAl + FAB_DRAW*fabAl;
  const draw = Math.max(1, rawDraw - ((S.f||{}).drawReduce||0) - (F.gridTuned?1:0));
  // transmission loss: the lines bleed a share of everything generated.
  // Solving line-run benches (S.puz.wires) shrinks it toward zero.
  const powerLoss = POWER_LOSS_BASE * Math.pow(LOSS_DECAY, (S.puz&&S.puz.wires)||0);
  if(gen>0 && powerLoss>0){ genWhy.push(`lines lose ${(powerLoss*100).toFixed(0)}%`); }
  gen = gen*(1-powerLoss);
  const cap = (built("battery") ? (F.batteryRecond?1.857:1)*BATTERY_UNIT*(S.batteries||1)*mult(S.sys.battery.cond) : 0);   // bank surplus to ride out calm/storm days
  let brownout=false;
  const avail = gen + S.res.charge;
  if(avail < draw){ brownout=true; S.res.charge=0; }
  else S.res.charge = clamp(avail - draw, 0, cap);
  // effective tiers: what each demand actually gets today. Brownout forces
  // the old brownout behavior (pump on gravity, tanks slow, commons dark,
  // canning cold, shops on hand power) — allocation can only cut further.
  const pumpEff    = brownout ? 0 : pumpAl;
  const aquaEff    = brownout ? Math.min(aquaAl,0.5) : aquaAl;
  const commonsLit = !brownout && commonsAl>0;
  const canningOn  = !brownout && canningAl>0;
  const fabPowered = !brownout && (S.fabProject ? fabAl>0 : true);

  // --- water ---
  const irr = built("irrigation") ? mult(S.sys.irrigation.cond) : 0;
  const pumpFactor = pumpEff>=1 ? 1 : pumpEff>=0.5 ? 0.75 : 0.5;
  // transmission loss: the mains seep a share of everything the catchment
  // pipes carry. Rain into the tanks and hand-hauled water skip the pipes.
  // Solving water-main benches (S.puz.pipes) shrinks it toward zero.
  const waterLoss = WATER_LOSS_BASE * Math.pow(LOSS_DECAY, (S.puz&&S.puz.pipes)||0);
  const wIn = (built("catchment") ? 14*mult(S.sys.catchment.cond)*pumpFactor*(F.sealedTanks?1.2:1)*(1-waterLoss) : 3) + wx.rain;
  let gardenWater = irr>0.75 ? 2.5 : 4;
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
  const drinkNeed = S.people.reduce((a,p)=>a+(canWork(p)?0.5:0.3),0);
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
    return Math.max(0, crop.yield*tend*soil*bloom*(F.contourBeds?1.15:1) - (fo.nibble||0));
  };
  const PEREN_PICK_DAYS = [6, 12, 18, 24];   // a perennial bears on these days of its harvest season

  // The kitchen garden (S.beds, annuals) and the food forest (S.forest,
  // perennials) are separate ground: annual beds want tending; forest plots
  // want years. They don't compete for space or for the gardener's day.
  const annualPlanted = S.beds.filter(b=>b.crop).length;

  // shared harvest bookkeeping, used by both the beds and the forest
  const bringIn = (plot, crop, placeLabel, isPeren) => {
    gardenFood += plot.stored;
    if(crop.seeds) S.res.seeds += crop.seeds;
    S.dietLog.push({crop:plot.crop, day:S.day, amt:plot.stored});
    plot.fertility = clamp((plot.fertility??75) + feedDelta(crop.feed)*(isPeren?0.25:1), 10, 100);
    // sunflower gives up a byproduct on top of what's eaten fresh -- seed set
    // aside for pressing, not a cut of the food value itself
    if(plot.crop==="sunflower") S.res.rawSeed = (S.res.rawSeed||0) + plot.stored*0.5;
    lines.push(`${placeLabel} came in: ${plot.stored.toFixed(0)} of ${crop.name.toLowerCase()}${crop.seeds?`, and ${crop.seeds} seed saved`:""}.`);
  };

  // --- kitchen garden: annuals grow with tending, then wait on hands to harvest ---
  for(const bed of S.beds){
    if(!bed.crop) continue;
    const crop=CROPS[bed.crop];
    // defensive, and symmetric with the food-forest loop below: a bed holding
    // something with no crop def (a meadow, an old save, a future marker crop)
    // must not take the annual path — and must not throw on the way past.
    if(!crop || crop.perennial) continue;
    if(sn.grow===0){
      if(crop.hardy){ continue; }
      if(!F.coldFrames){
        if(bed.growth>0.5) lines.push(`The ${crop.name.toLowerCase()} in bed ${S.beds.indexOf(bed)+1} died with the first hard frost.`);
        bed.crop=null; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.fertility=clamp((bed.fertility??75)-2,10,100); continue;
      }
    }
    if(irrAl===0 && Math.random()<WITHER_CHANCE){
      lines.push(`With the irrigation shut off, the ${crop.name.toLowerCase()} in bed ${S.beds.indexOf(bed)+1} died.`);
      bed.crop=null; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0;
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
    const seasonRate = sn.grow===0 ? 0.25 : sn.grow;
    // tending, water, season and soil set the PACE toward crop.work; falling
    // behind here means a longer season, not a smaller one (the weeds win time
    // before they win bulk). The pollinator bloom is not a pace effect — it
    // lives in yieldOf, where its comment always claimed it did.
    bed.growth += (0.6 + perBed*0.55) * water * drought * seasonRate * fertilityMult(bed.fertility) * (fo.gardenBonus||1) * (F.keyline?1.12:1);
    bed.days++;
    // BOTH gates: the work has to be in, and the days have to have passed.
    // !bed.ready freezes the yield on the first qualifying day.
    if(!bed.ready && bed.growth >= crop.work && bed.days >= (crop.minDays||0)){
      bed.stored = yieldOf(bed, crop, polR, fo);
      bed.ready = true;
    }
  }
  for(const bed of S.beds){
    if(!bed.ready || !bed.crop) continue;
    const crop=CROPS[bed.crop];
    if(crop.perennial) continue;
    if(!tenders.length) continue;   // annual harvest waits on hands
    bringIn(bed, crop, `Bed ${S.beds.indexOf(bed)+1}`, false);
    bed.crop=null; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0;
  }

  // --- food forest: perennials bear across their season, no tending needed ---
  for(const plot of (S.forest||[])){
    if(!plot.crop) continue;
    const crop=CROPS[plot.crop];
    if(!crop || !crop.perennial) continue;
    if(sn.id!==crop.harvestSeason) continue;
    if(!PEREN_PICK_DAYS.includes(dayOfSeason(S.day))) continue;
    if(plot.lastPickDay===S.day) continue;
    const ageYears = (S.day - plot.plantedDay) / (SEASON_LEN*4);
    const estFrac = clamp(ageYears/crop.matureYears, 0.15, 1);
    if(estFrac>=1 && !plot.matured){
      plot.matured=true;
      lines.push(`The ${crop.name.toLowerCase()} in the food forest has fully matured.`);
    }
    plot.stored = (crop.yield/PEREN_PICK_DAYS.length) * estFrac * fertilityMult(plot.fertility);
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
  const foodIn = aquaFood + gardenFood + (fo.foodTrickle||0);
  const cooks = working("cook");
  const cookStretch = cooks.length ? 1-0.03*Math.min(5,cooks[0].care) : 1;
  // each adult eats 0.85 food/day, each child 0.5 — not 1.0, because the daily
  // food-in numbers (aquaponics/gardens/foraging) are calibrated against this;
  // raising it tightens the food budget village-wide, see TUNING GUIDE above
  const mouths = S.people.reduce((a,p)=>a+(canWork(p)?0.85:0.5),0);
  const foodOut = mouths*cookStretch;
  // Desperation gleaning: with nothing in the stores, people go out and dig.
  // It is never enough, but a village can always claw at the ground. No lockout.
  let gleaned = 0;
  if(S.res.food + S.preserved < 1 && season().forage>0){
    const able = S.people.filter(p=>canWork(p) && p.status!=="away").length;
    // near-subsistence: a starving village limps, it does not simply die.
    // In winter the woods give almost nothing, which is the whole point of preserving.
    gleaned = Math.max(1, able*0.62) * (S.larder??1) * season().forage;
    S.larder = clamp((S.larder??1) - gleaned/260, 0.12, 1);
    if(S.day%6===0) lines.push("Everyone who could stand went out foraging. Roots, bark, whatever they could find. It wasn't enough.");
  }
  let hunger=0;
  let f = S.res.food + foodIn + gleaned - foodOut;
  if(f<0){
    // the fresh stores are gone; open the jars
    const short = -f;
    const fromJars = Math.min(S.preserved, short);
    S.preserved -= fromJars;
    const still = short - fromJars;
    if(fromJars>0.2 && S.day%5===0) lines.push("Dinner came out of jars or cans tonight.");
    if(still>0){ hunger = Math.min(1, still/foodOut); }
    f=0;
  }
  // a big harvest can overtop the fresh store; jars catch what the shelves can't hold
  if(f > foodCap()){
    const over = f - foodCap();
    const methods=Object.values(PRESERVE).filter(m=>S.flags[m.flag]);
    if(methods.length){
      const best=methods.reduce((a,b)=>a.loss<b.loss?a:b);
      S.preserved += over*(1-best.loss);
      lines.push(`The stores overflowed. Everyone spent the evening at the ${best.name.toLowerCase()}, and ${(over*(1-best.loss)).toFixed(0)} was preserved for later.`);
    } else {
      lines.push(`${over.toFixed(0)} of the harvest had nowhere to go and will spoil. Somebody should build a way to preserve food.`);
    }
    f = foodCap();
  }
  S.res.food = clamp(f,0,foodCap());
  S.preserved = clamp(S.preserved, 0, S.flags.rootCellar?300:170);

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
  const preservers = working("preserve");
  if(preservers.length){
    const method = canningOn ? PRESERVE.canning
                 : F.crocks   ? PRESERVE.fermenting
                 : F.dryRacks ? PRESERVE.drying : null;
    if(method){
      let rate = 0;
      for(const p of preservers) rate += method.rate*0.55 + effStat(p,"care","preserve")*0.4*eff(p);
      const take = Math.min(S.res.food, rate);
      if(take>0.2){
        S.res.food -= take;
        S.preserved += take*(1-method.loss);
        const wasted = take*method.loss;
        if(F.compost) S.compost = clamp((S.compost||0) + wasted*0.5, 0, 80);
        S._preserveWhy = `${method.name.toLowerCase()} · ${take.toFixed(1)} put by, ${wasted.toFixed(1)} lost`;
      }
    }
  }

  // --- pressing: sunflower seed set aside becomes oil, slowly, and only with hands on it ---
  S._pressWhy = "";
  const pressers = working("press");
  if(pressers.length && S.flags.oilPress){
    const OIL_EFF = 0.35;   // most of the seed is not oil -- pressing loses a lot of volume
    let rate = 0;
    for(const p of pressers) rate += 2.0*0.55 + effStat(p,"hands","press")*0.4*eff(p);
    const take = Math.min(S.res.rawSeed||0, rate);
    if(take>0.2){
      S.res.rawSeed -= take;
      S.oil = clamp(S.oil + take*OIL_EFF, 0, 20);
      S._pressWhy = `${take.toFixed(1)} seed pressed, ${(take*OIL_EFF).toFixed(1)} oil`;
    }
  }

  // --- wood gathering ---
  const woodcutters = working("woodcut");
  if(woodcutters.length){
    let gathered = 0;
    for(const p of woodcutters) gathered += 1.5 + effStat(p,"wild","woodcut")*0.6*eff(p);
    const actual = addRes("wood", gathered);
    S._woodWhy = `${actual.toFixed(1)} wood hauled`;
  } else {
    S._woodWhy = "";
  }


  // --- spoilage: fresh food does not keep; preserved food does ---
  {
    const heat = season().heat ? 1.7 : 1;
    const rate = (F.rootCellar?0.007:0.020) * heat * (F.seedLibrary?0.9:1);
    const lost = S.res.food * rate;
    if(lost>0.05){
      S.res.food -= lost; S.spoilMemo = lost;
      if(F.compost) S.compost = clamp((S.compost||0) + lost*0.4, 0, 80);
    }
    else S.spoilMemo = 0;
  }

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
    // finished fabs produce, slowly, forever, without anyone leaving the valley
    for(const def of FABS){
      if(!S.fabs[def.id]) continue;
      const r = FAB_RATE[def.gives] * (fabPowered?1:0.6);
      addRes(def.gives, r);
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
      }
    }
  }
  {
    const frac=S.res.food/foodCap();
    if(S.res.food>8 && Math.random() < 0.015 + 0.05*frac){
      const eatFrac=(0.12+Math.random()*0.14)*(F.rootCellar?0.45:1);
      const eaten=S.res.food*eatFrac;
      S.res.food=Math.max(0,S.res.food-eaten);
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
    for(const p of working("project")){
      pts += (effStat(p,"hands",S.project.kind==="build"?S.project.id:null)+(p.trait==="Tinkerer"?1.5:0))*1.2*eff(p)*((S.f||{}).projectFaster?1.2:1)*(S.flags.fineTools?1.1:1);
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
        if(def.id==="gardenBeds") S.beds.push({crop:null,growth:0,days:0,ready:false,stored:0,fertility:75,plantedDay:0});
        lines.push(`The ${def.name.toLowerCase()} is finished. ${def.blurb}`);
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
  const standstill = !S.people.some(p=>p.status==="ok");
  const spentToday=[], recovered=[];
  for(const p of S.people){
    if(p.status==="away") continue;
    if(p.status==="down"){
      p.downDays -= standstill?2:1;
      p.wb=clamp(p.wb+2+careBoost+(standstill?6:0),0,100);
      if(careHeal && p.downDays>0 && Math.random()<careHeal){ p.downDays--; }
      if(F.herbalStores && p.downDays>0 && Math.random()<0.3){ p.downDays--; }
      if(p.downDays<=0){ p.status="ok"; recovered.push(p); }
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
    const strain = hungerBite + thirstBite + (commonsLit?0:2);
    d -= (p.status==="spent"||standstill) ? strain*0.5 : strain;
    p.wb = clamp(p.wb+d, wbFloor(p), 100);
    if(p.status==="spent" && p.wb>=30){ p.status="ok"; recovered.push(p); }
    if(p.status==="ok" && p.wb<=5){ p.status="spent"; spentToday.push(p); }
  }

  // --- illness ---
  const healthy=S.people.filter(p=>p.status==="ok");
  const sickChance=Math.max(0.02, (F.herbalStores?0.07:0.12) - (F.draftProof?0.02:0));
  if(healthy.length && Math.random()<sickChance){
    let sick=pick(healthy);
    if(sick.trait==="Cautious" && Math.random()<0.7) sick=null;
    if(sick){ sick.status="down"; sick.downDays=2; const wasJob=sick.job; sick.job=null;
      const stillTended = wasJob && wasJob!=="away" && working(wasJob).length>0;
      lines.push(`${sick.name} woke feverish and was sent to rest${wasJob&&wasJob!=="away"&&!stillTended?`; the ${jobName(wasJob).toLowerCase()} went untended`:""}.`);
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
        S.people.push({
          id:"child_"+S.day+"_"+name.toLowerCase(), name, pn: pick(["she/her","he/him","they/them"]),
          trait: pick(Object.keys(TRAITS)), hands:inh("hands"), green:inh("green"), care:inh("care"), wild:inh("wild"),
          note: pick(CHILD_NOTES), age:0, years:0, perm:null,
          wb:80, job:null, streak:0, status:"ok", downDays:0, mem:`Born in the village, winter of year ${yr}.`,
          practice:{specific:{}, broad:{hands:0,green:0,care:0,wild:0}}   // earned fresh, not inherited
        });
        S.births++;
        const raiserPhrase = raisers[0]===raisers[1]
          ? `${raisers[0].name} will raise ${name}, and so will everyone else`
          : `${raisers[0].name} and ${raisers[1].name} will raise ${name} between them, and so will everyone else`;
        lines.push(`A child was born in the deep of winter and named ${name}. ${raiserPhrase}.`);
      }
    }

    // the old die, in winter, at home. Nobody dies "in a warm room" while out on
    // the road — the away check also prevents a death from stranding an expedition
    // that still holds the person's id (which used to crash the next day's tick).
    for(const p of [...S.people]){
      if(p.age<ELDER) continue;
      if(p.status==="away") continue;
      const risk = 0.04 + Math.max(0,(p.age-ELDER))*0.022 + (p.wb<35?0.05:0);
      if(Math.random()<risk){
        S.people = S.people.filter(x=>x!==p);
        S.deaths++;
        S.people.forEach(q=>{ if(q.status!=="away") q.wb=clamp(q.wb-7,wbFloor(q),100); });
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
//    checkForHearthConflicts(lines); 
  }

  tickDepartures(lines);            
  tickVillageSpiritsStreak();      
  
  if (S.lowSpiritsStreak === 5 && S.day % 7 === 0) {
    lines.push("No one has come up the road in a long time. The valley has a reputation now — a place where people go to fade.");
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
  if(varietyMood <= -0.4 && S.day%6===0) lines.push(`Another week of little but ${(function(){const c=S.dietLog.filter(e=>S.day-e.day<=14).map(e=>CROPS[e.crop]?CROPS[e.crop].name.toLowerCase():e.crop); return c[c.length-1]||"the same thing";})()}.`);
  else if(varietyMood >= 0.4 && S.day%9===0) lines.push("The table had a bit of everything tonight.");
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

  if(hunger>0){ S.hungerDays++; } else { S.hungerDays=0; }
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
  if(S.day % 3 === 0){
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

  S.report={gen,draw,cap,foodIn,foodOut,waterIn:wIn,waterOut:wOut,brownout,thirst, preserveWhy:S._preserveWhy||"", pressWhy:S._pressWhy||"",
    waterParts:{drink:drinkUse, garden:gardenWater*wateredBeds*irrAl, gardenFull:gardenWater*wateredBeds, cook:1*cookAl, clean:1*cleanAl, perBed:gardenWater},
    powerLoss, waterLoss,
    genWhy:genWhy.join(" · ")||"nothing built that makes power", gardenWhy:gWhy.join(" · "), aquaWhy:S._aquaWhy||"", gardenFood, aquaFood, woodWhy:S._woodWhy||""};


  // roll tomorrow's weather now, using tomorrow's season, so a forecast (once
  // unlocked) is a real fact about the day ahead rather than a guess
  { const _d=S.day; S.day=_d+1; S.forecast=rollWeather().id; S.day=_d; }

  S.day++;
}

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
