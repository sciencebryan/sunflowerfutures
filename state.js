import { CROPS, MAX_BATTERIES, MAX_SOLAR, SEASON_LEN, SITE_DEF, SYS } from "./data-economy.js";
import { PUZ_META } from "./data-puzzles.js";

import { AGES } from "./seasons.js";
import { NEWCOMERS, ROSTER, VISUALS } from "./defs.js";
import { clamp } from "./helpers.js";
import { rollMusic, rollPersonality, seedFounderBonds } from "./bonds.js";
import { seedIdeology } from "./ideology.js";









/* ================= state ================= */
function newSites(){
  return Object.fromEntries(SITE_DEF.map(s=>[s.id,{
    stock:{...s.stock}, total0:Object.values(s.stock).reduce((a,b)=>a+b,0),
    discovered:!!s.known, 
    visited: false, // Add this new flag
    lastVisited: -999,    
    depleted:false
  }]));
}


function freshPerson(def){
  // personality: hidden chemistry, rolled fresh per person per game — never
  // rendered, never derived from anything visible (see bonds.js)
  const p = {...def, age: AGES[def.id] ?? 30, years:0, perm:null, wb:78+Math.floor(Math.random()*10), job:null, streak:0, status:"ok", downDays:0, mem:null, toxins:0, personality: rollPersonality(), music: rollMusic(), practice:{specific:{}, broad:{hands:0,green:0,care:0,wild:0}}};
  // ideology: hidden stance vector, seeded from who they already are
  // (stats + trait), so it needs the finished person — hence after the spread
  p.ideology = seedIdeology(p);
  return p;
}

// every demand at full — the sim at these defaults behaves exactly as it
// did before allocation existed (see the ALLOCATION section of data-economy)
function defaultAlloc(){
  return { power:{pump:1, aqua:1, commons:1, canning:1, fab:1, ac:1},
           water:{drinking:1, cooking:1, cleaning:1, irrigation:1} };
}

function newState(){
  const puz = {};
  Object.keys(PUZ_META).forEach(key => {
    puz[key] = 0;
  });
  return {
    v:7, day:1, lastTick:Date.now(),
    alloc: defaultAlloc(),
    res:{food:58, water:50, charge:4, scrap:6, parts:0, seeds:8, meds:0, rawSeed:0, wood:10},
    larder:1,
    weather:"clear",
    people: ROSTER.map(freshPerson),
    sys: Object.fromEntries(SYS.map(s => [s.id, {cond: s.start ? 70+Math.floor(Math.random()*18) : 100, built: !!s.start}])),
    sites: newSites(),
    expeditions: [], expSeq:1,
    project: null,
    flags: {},
    pending: [],
    event: null, eventCd: 2, newcomerIdx: 0,
    arrivalQueue: NEWCOMERS.slice(),  // who might still show up on the road; startNewGame's
                                       // applyFounders() rebuilds this as [unchosen founders, ...NEWCOMERS]
                                       // when the player actually picks who's here on day one
    giftDay: null, giftGood: false,
    founding: {visuals:[]}, f:{}, waterCap:80, hungerDays:0, thirstDays:0,
    turbines: 1,   // stackable: one weak turbine at start, raise more over time
    solarPanels: 0, // solar isn't built at start -- set to 1 the moment it's first raised
    batteries: 1,   // stackable: one weak bank at start (it's already built, like turbines)
    forest: [],    // food forest: perennial plots, separate from the annual beds
    discovered: {}, // gated builds/projects found via expedition (parallel to S.crops)
    beds: [{crop:null,growth:0,days:0,ready:false,stored:0,fertility:75,plantedDay:0},{crop:null,growth:0,days:0,ready:false,stored:0,fertility:75,plantedDay:0}],
    preserved: 0, spoilMemo: 0, winterDays: 0, oil: 0,   // pressed sunflower oil -- a seasoning, not a staple, and it takes real labor to make
    reputation: 0.55,  // HIDDEN. A slow-moving read on whether this is a good place to end up --
                        // spirits, food, and water security, smoothed over time. Nudges how often
                        // strangers find the road here. Never shown to the player.
    neighborStanding: 0,  // HIDDEN. Favor owed BY other settlements, built by helping them (the
                          // neighborsAsk event) and spent automatically when this village is the
                          // one in trouble — see the "neighbors" block in simulateDay. Decays
                          // slowly if never called in; this is reciprocity, not a bank account.
    festivalCooldown: 0, festivalBoostDays: 0,  // boostDays still drives the daily aura; see celebrations.js
    celebCd: {},        // per-kind cooldowns — a bonfire and a feast rest separately
    traditions: [],     // named celebrations that come back on the same day every year
    mournedDeaths: 0,   // deaths already marked by a remembrance
    lastCelebration: null,
    groundwaterContam: 0,  // HIDDEN. What's in the water table, 0-100. Seeded by the landfill
                           // visual, read only by the well. Rain is always clean; this is the
                           // cost of the reliable supply, and it is never shown to anyone.
    compost: 0,  // built up from spoilage/preserving loss once compost bins exist; spread onto
                 // whichever bed or forest plot needs it most (see the compost phase below)

    bonds: {},          // Keyed by "char1Id:char2Id", value is {familiarity 0..10, affinity -10..+10}
                        // (+ lazily: flares, log, lastFix — see events.js friction & mediation.js)
    activeConflicts: [],// Array of current interpersonal issues (see mediation.js)
    conflictSeq: 1,
    legitimacy: 70,     // HIDDEN. The village's read on your facilitation — built by honest
                        // process (a values airing that lands), spent by misjudged ones.
                        // Governance (M6) will draw on this same pool. Leaks via journal only.
    earthseedUnlocked: false, // Set to true once the Commons or a specific milestone is reached

    lastForageDay: -999,  // safely far in the past so "hasForaged" starts false, not undefined
    fabs: {}, fabProject: null,
    births: 0, deaths: 0, departures: 0,
    dietLog: [],   // recent harvests, for food-variety spirits
    puz:puz, crops:{},
    restore:{mycosphere:0, aquifer:0, pollinator:0, seen:false, restored:false},
    journal: [],
    report:{gen:0,draw:6,foodIn:0,foodOut:12,waterIn:0,waterOut:13,brownout:false}
  };
}

/* Apply circled visuals to a fresh state. */
function applyFounding(s, visualIds){
  s.founding={visuals:visualIds.slice()};
  s.waterCap=80; s.f={};
  const f=s.f;
  for(const id of visualIds){
    const v=VISUALS.find(x=>x.id===id); if(!v) continue;
    const fx=v.fx;
    if(fx.siteRename){ s.siteNames=s.siteNames||{}; s.siteNames[fx.siteRename[0]]=fx.siteRename[1]; }
    if(fx.siteBonus){ const st=s.sites[fx.siteBonus[0]]; for(const[k,val]of Object.entries(fx.siteBonus[1])){st.stock[k]=(st.stock[k]||0)+val; st.total0+=val;} }
    if(fx.sysStart){ s.sys[fx.sysStart[0]].cond=clamp(s.sys[fx.sysStart[0]].cond+fx.sysStart[1],0,100); }
    if(fx.solarStart){
      // one panel already up and wired, same as the systems that start built
      s.sys.solar.built=true;
      s.sys.solar.cond=70+Math.floor(Math.random()*18);
      s.solarPanels=1;
      s.discovered=s.discovered||{}; s.discovered.solar=true;
    }
    if(fx.waterStart) s.res.water+=fx.waterStart;
    if(fx.foodStart) s.res.food=clamp(s.res.food+fx.foodStart,0,60);
    if(fx.scrapStart) s.res.scrap+=fx.scrapStart;
    if(fx.seedsStart) s.res.seeds+=fx.seedsStart;
    if(fx.forestStart){
      // an old orchard: start with a small food forest, some of it already
      // grown apple trees from the parking-lot rows (backdated so they bear soon)
      s.forest = s.forest || [];
      s.crops = s.crops || {};
      s.crops.apple = true;
      const apples = fx.orchardApples || 0;
      for(let i=0;i<fx.forestStart;i++){
        if(i<apples){
          // a long-abandoned orchard: these trees are already at full bearing
          // age, not merely started. Backdate to matureYears so the first
          // autumn here gives a real crop, not a sapling's handful.
          s.forest.push({crop:"apple", growth:0, days:0, ready:false, stored:0, fertility:75,
                         matured:true, firstBorne:true,
                         plantedDay: -(SEASON_LEN*4*(CROPS.apple.matureYears||4))});
        } else {
          s.forest.push({crop:null, growth:0, days:0, ready:false, stored:0, fertility:75, plantedDay:0});
        }
      }
    }
    if(fx.catalpaStart){
      // the trees were here before anyone was. Backdated past maturity, so
      // the shade is real on day one — the one way to have it without waiting.
      s.forest = s.forest || []; s.crops = s.crops || {};
      s.crops.catalpa = true;
      for(let i=0;i<fx.catalpaStart;i++){
        s.forest.push({crop:"catalpa", growth:0, days:0, ready:false, stored:0, fertility:75,
                       plantedDay: -(SEASON_LEN*4*30)});   // old trees, long past mature
      }
    }
    if(fx.cropGrant){
      // one specific perennial known from the start, unlike cropUnlock's
      // random annuals — you know these trees because they're standing here
      s.crops = s.crops || {}; s.crops[fx.cropGrant] = true;
    }
    if(fx.flagStart){ s.flags[fx.flagStart] = true; }
    if(fx.woodStart){ s.res.wood = (s.res.wood||0) + fx.woodStart; }
    if(fx.restoreStart){
      s.restore = s.restore || {mycosphere:0, aquifer:0, pollinator:0, seen:false, restored:false};
      for(const [k,v] of Object.entries(fx.restoreStart)) s.restore[k] = clamp((s.restore[k]||0)+v, 0, 100);
      s.restore.seen = true;   // the land is already doing something; the panel should show it
    }
    if(fx.contamStart){
      // the mound has been leaching into the water table since long before
      // anyone arrived. Only matters if the village ever drills for water.
      s.groundwaterContam = (s.groundwaterContam||0) + fx.contamStart;
    }
    if(fx.cropUnlock){
      // a seed store: start already knowing a few more crops (annuals, not the
      // slow perennials -- those you still have to find or plant into the forest)
      s.crops = s.crops || {};
      const annuals = Object.keys(CROPS).filter(id=>CROPS[id].locked && !CROPS[id].perennial);
      for(let i=0;i<fx.cropUnlock && annuals.length;i++){
        const pick = annuals.splice(Math.floor(Math.random()*annuals.length),1)[0];
        s.crops[pick]=true;
      }
    }
    if(fx.coldStart) s.flags.coldFrames=true;
    // accumulating sim modifiers
    if(fx.drawReduce)   f.drawReduce=(f.drawReduce||0)+fx.drawReduce;
    if(fx.safeReturn)   f.safeReturn=true;
    if(fx.strangerRate) f.strangerRate=(f.strangerRate||1)*fx.strangerRate;
    if(fx.carry)        f.carry=(f.carry||0)+fx.carry;
    if(fx.siteYield){ f.siteYield=f.siteYield||{}; for(const[k,val]of Object.entries(fx.siteYield)) f.siteYield[k]=(f.siteYield[k]||1)*val; }
    if(fx.farSafe)      f.farSafe=fx.farSafe;
    if(fx.scrapTrickle) f.scrapTrickle=(f.scrapTrickle||0)+fx.scrapTrickle;
    if(fx.fastLong)     f.fastLong=true;
    if(fx.bikeDull)     f.bikeDull=true;
    if(fx.partsUpkeep)  f.partsUpkeep=(f.partsUpkeep||0)+fx.partsUpkeep;
    if(fx.wetter)       f.wetter=true;
    if(fx.drier)        f.drier=true;
    if(fx.floodRisk)    f.floodRisk=(f.floodRisk||0)+fx.floodRisk;
    if(fx.projectFaster)f.projectFaster=true;
    if(fx.upkeepScrap)  f.upkeepScrap=(f.upkeepScrap||0)+fx.upkeepScrap;
    if(fx.stormBreak)   f.stormBreak=true;
    if(fx.gardenBonus)  f.gardenBonus=(f.gardenBonus||1)*fx.gardenBonus;
    if(fx.nibble)       f.nibble=(f.nibble||0)+fx.nibble;
    if(fx.foodTrickle)  f.foodTrickle=(f.foodTrickle||0)+fx.foodTrickle;
    if(fx.tripLong)     f.tripLong=true;
    if(fx.spirits)      f.spirits=(f.spirits||0)+fx.spirits;
    if(fx.spiritsGrey)  f.spiritsGrey=(f.spiritsGrey||0)+fx.spiritsGrey;
    if(fx.forageBonus)  f.forageBonus=(f.forageBonus||1)*fx.forageBonus;
    if(fx.woodcutBonus) f.woodcutBonus=(f.woodcutBonus||1)*fx.woodcutBonus;
    if(fx.practiceStart){ f.practiceStart=f.practiceStart||{}; for(const[k,v]of Object.entries(fx.practiceStart)) f.practiceStart[k]=(f.practiceStart[k]||0)+v; }
    // the place leaves its mark on what people come to believe: circled
    // visuals accumulate stance nudges, applied to the founders once they
    // exist (applyFounders) — your opening aesthetic choice IS early politics
    if(fx.ideology){ f.ideoSeed=f.ideoSeed||{}; for(const[ax,amt]of Object.entries(fx.ideology)) f.ideoSeed[ax]=(f.ideoSeed[ax]||0)+amt; }
  }
  // bicycles and footpaths argue with each other
  if(f.fastLong && f.bikeDull){ f.fastLong=false; f.carry=(f.carry||0)-1; f.partsUpkeep=(f.partsUpkeep||0)*0.5; }
  // the tower is a landmark; the river is wet; the reservoir is dry
  if(f.wetter && f.drier){ f.wetter=false; f.drier=false; }
  s.res.water=clamp(s.res.water,0,s.waterCap);
}

// How many of the twelve are standing in the yard on day one. The other six
// aren't gone — they're queued to find the road here later (see arrivalQueue),
// with their own names and notes intact, unlike a generic newcomer.
const FOUNDER_COUNT = 6;
function applyFounders(s, founderIds){
  const ids = (founderIds && founderIds.length===FOUNDER_COUNT) ? founderIds
            : ROSTER.slice(0,FOUNDER_COUNT).map(r=>r.id);  // safety net, shouldn't be reachable from the UI
  s.people = ids.map(id=>ROSTER.find(r=>r.id===id)).filter(Boolean).map(freshPerson);
  seedFounderBonds(s);   // they traveled here together; day one is not a room full of strangers
  // the circled visuals shape the founders' starting stances — later arrivals
  // weren't formed by this place, so the nudge is founders-only
  // a place of footpaths means everyone already knows the near country
  const prStart = s.f && s.f.practiceStart;
  if(prStart) for(const p of s.people)
    for(const [k,v] of Object.entries(prStart)) p.practice.broad[k] = (p.practice.broad[k]||0) + v;
  const ideoSeed = s.f && s.f.ideoSeed;
  if(ideoSeed) for(const p of s.people)
    for(const [ax,amt] of Object.entries(ideoSeed))
      p.ideology[ax] = clamp((p.ideology[ax]||0)+amt, -1, 1);
  const unchosen = ROSTER.filter(r=>!ids.includes(r.id)).map(r=>({...r, founderEcho:true}));
  // shuffle so who shows up first isn't always the same across playthroughs
  for(let i=unchosen.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [unchosen[i],unchosen[j]]=[unchosen[j],unchosen[i]]; }
  s.arrivalQueue = [...unchosen, ...NEWCOMERS];
}

function migrate(s){

  if(s.v<2){
    s.v=2;
    Object.assign(s.res,{scrap:4,parts:0,seeds:0,meds:0});
    s.sites=newSites(); s.expeditions=[]; s.expSeq=1;
    s.project=null; s.flags={}; s.pending=[];
    s.people.forEach(p=>{ if(p.mem===undefined) p.mem=null; });
  }
  if(s.v<3){
    const all=[...ROSTER,...NEWCOMERS];
    s.people.forEach(p=>{
      const def=all.find(d=>d.id===p.id);
      if(def){ p.care=def.care; p.wild=def.wild; }
      else { p.care=p.care??2; p.wild=p.wild??2; }
    });
    s.event=null; s.eventCd=2; s.newcomerIdx=0;
    s.giftDay=null; s.giftGood=false;
    s.v=3;
  }
  if(s.v<4){
    // v3 -> v4: systems can be unbuilt. Existing villages keep everything they had.
    for(const d of SYS){
      if(!s.sys[d.id]) s.sys[d.id]={cond:100};
      if(s.sys[d.id].built===undefined) s.sys[d.id].built=true;
    }
    if(s.project && !s.project.kind) s.project.kind="project";
    s.v=4;
  }
  if(!s.founding) s.founding={visuals:[]};
  if(!s.waterCap) s.waterCap=80;
  if(!s.f) s.f={};
  if (!s.puz) s.puz = {};
    Object.keys(PUZ_META).forEach(key => {
    if (s.puz[key] === undefined) s.puz[key] = 0;
  });
  if(!s.crops) s.crops={};
  if(s.hungerDays===undefined) s.hungerDays=0;
  if(s.thirstDays===undefined) s.thirstDays=0;
  if(!s.dietLog) s.dietLog=[];
  for(const b of s.beds||[]){ if(b.fertility===undefined) b.fertility=75; if(b.plantedDay===undefined) b.plantedDay=0; }
  if(s.turbines===undefined) s.turbines = 1;
  // an old save built solar as one flat array under the old system -- give it the
  // full 5 panels rather than dropping a built player back to a fifth of their power
  if(s.solarPanels===undefined) s.solarPanels = (s.sys && s.sys.solar && s.sys.solar.built) ? MAX_SOLAR : 0;
  if(s.batteries===undefined) s.batteries = (s.sys && s.sys.battery && s.sys.battery.built) ? MAX_BATTERIES : 1;
  if(!s.forest) s.forest=[];
  if(!s.discovered) s.discovered={};
  if(s.res.rawSeed===undefined) s.res.rawSeed=0;
  if(s.oil===undefined) s.oil=0;
  if(s.reputation===undefined) s.reputation=0.55;
  if(s.neighborStanding===undefined) s.neighborStanding=0;
  if(s.forecast===undefined) s.forecast=null;
  if(s.festivalCooldown===undefined) s.festivalCooldown=0;
  if(!s.celebCd) s.celebCd={};
  if(!s.traditions) s.traditions=[];
  if(s.mournedDeaths===undefined) s.mournedDeaths=0;
  if(s.lastCelebration===undefined) s.lastCelebration=null;
  if(s.festivalBoostDays===undefined) s.festivalBoostDays=0;
  if(s.compost===undefined) s.compost=0;
  if(s.groundwaterContam===undefined) s.groundwaterContam=0;
  if(s.lastForageDay===undefined) s.lastForageDay=-999;
  if(s.arrivalQueue===undefined) s.arrivalQueue=NEWCOMERS.slice();  // old saves already started with all 12; nothing unchosen to add
  // perennials used to live in the beds; move any into the food forest
  if(s.beds){
    const moved = s.beds.filter(b=>b.crop && CROPS[b.crop] && CROPS[b.crop].perennial);
    for(const b of moved){ s.forest.push({...b}); }
    s.beds = s.beds.filter(b=>!(b.crop && CROPS[b.crop] && CROPS[b.crop].perennial));
    if(!s.beds.length) s.beds.push({crop:null,growth:0,days:0,ready:false,stored:0,fertility:75,plantedDay:0});
  }
  if(s.larder===undefined) s.larder=1;
  // practice: earned skill added later — anyone from an older save starts with none
  for(const p of s.people) if(!p.practice) p.practice={specific:{}, broad:{hands:0,green:0,care:0,wild:0}};
  // personality: hidden chemistry added later — anyone without one rolls it now
  for(const p of s.people) if(!p.personality) p.personality=rollPersonality();
  // ideology: hidden stance vector added later — seeded from stats+trait now
  for(const p of s.people) if(!p.ideology) p.ideology=seedIdeology(p);
  for(const p of s.people) if(p.toxins===undefined) p.toxins=0;
  for(const p of s.people) if(!p.music) p.music=rollMusic();
  if(s.legitimacy===undefined) s.legitimacy=70;
  if(!s.conflictSeq) s.conflictSeq=1;
  if(!s.activeConflicts) s.activeConflicts=[];
  if(s.v<5){
    // v4 -> v5: seasons, crop beds, preservation, fabrication, generations
    s.beds = Array.from({length: 1 + (s.flags.gardenBeds?1:0) + (s.flags.terraces?1:0)},
                        ()=>({crop:null,growth:0,days:0,ready:false,stored:0,fertility:75,plantedDay:0}));
    s.preserved = 0; s.spoilMemo = 0;
    s.fabs = {}; s.fabProject = null;
    s.births=0; s.deaths=0; s.departures=0;
    s.dietLog=[];
    for(const p of s.people){
      if(p.age===undefined) p.age = AGES[p.id] ?? 30;
      if(p.years===undefined) p.years = 0;
      if(p.perm===undefined) p.perm = null;
    }
    s.v=5;
  }
  if(s.v<6){
    s.v=6;
    if(!s.alloc) s.alloc=defaultAlloc();
  }
  if(s.v<7){
    s.v=7;
    if(s.puz.wires===undefined) s.puz.wires=0;
    if(s.puz.pipes===undefined) s.puz.pipes=0;
  }
  // repair rather than trust: fill any missing keys, snap values to a legal level
  {
    const d=defaultAlloc();
    if(!s.alloc) s.alloc=d;
    for(const side of ["power","water"]){
      if(!s.alloc[side]) s.alloc[side]=d[side];
      for(const k of Object.keys(d[side])){
        const v=s.alloc[side][k];
        s.alloc[side][k] = (v===0||v===0.5||v===1) ? v : d[side][k];
      }
    }
    // drinking has no off switch
    if(s.alloc.water.drinking===0) s.alloc.water.drinking=0.5;
  }
  if(s.res.wood === undefined) s.res.wood = 0;
  // beds track garden slots, however they were gained
  while(s.beds.length < 1 + (s.flags.gardenBeds?1:0) + (s.flags.terraces?1:0))
    s.beds.push({crop:null,growth:0,days:0,ready:false,stored:0,fertility:75,plantedDay:0});
  // restoration metrics — absent from any pre-restoration save
  if(!s.restore) s.restore = {mycosphere:0, aquifer:0, pollinator:0, seen:false, restored:false};
  // repair: bring home anyone stranded "away" with no expedition backing them.
  // The old objp crash in tickExpeditions could strand the rest of a party
  // mid-return, leaving people permanently away to nowhere, "back in ? days".
  // Cheap to check every load, and it can never fire wrongly — an away person
  // without an expedition is always a bug.
  {
    const onRoad = new Set();
    for(const ex of (s.expeditions||[])) for(const pid of (ex.party||[])) onRoad.add(pid);
    for(const p of s.people){
      if(p.status==="away" && !onRoad.has(p.id)){
        p.status="ok"; p.job=null;
        p.mem=p.mem||`Came home, day ${s.day}.`;
      }
    }
  }
  return s;
}
let S = null;
function setS(v){ S = v; }










export { FOUNDER_COUNT, S, applyFounders, applyFounding, freshPerson, migrate, newState, setS };
