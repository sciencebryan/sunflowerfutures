import { S } from "./state.js";
import { canWork, season } from "./seasons.js";
import { SITE_DEF } from "./defs.js";

/* ================= sim helpers ================= */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mult=c=> c>=40 ? 0.6+0.4*(c-40)/60 : (c/40)*0.6;
const eff=p=> (0.58 + p.wb/240) * (p.status==="spent"?0.75:1);
/* "spent" is exhaustion, not incapacity: they keep working, badly.
   Only "down" (hurt or ill) and "away" take a person out of the village's hands.
   This matters: without it, a famine can never end, because ending it takes work. */
const working=id=>S.people.filter(p=>p.job===id && (p.status==="ok"||p.status==="spent") && canWork(p));

/* ================= practice: earned skill, not endless growth =================
   Two small, capped bonuses on top of a person's fixed hands/green/care/wild.
   SPECIFIC practice is tied to one exact job — turbine repair, cooking, foraging
   the near country — and caps at +0.7. BROAD practice is tied to the wider
   category that job belongs to (any hands-job, any green-job...) and caps at
   +0.3. They stack, so a lifelong specialist tops out +1.0 on that stat; someone
   who rotates jobs within a category without specializing tops out +0.3.
   Both grow on days the matching job is actually worked, and both decay — slowly
   — on days it isn't, so an unused skill fades but never resets to zero.
   None of this is inherited by children (see the birth code): each person earns
   their own. It also never shows in the dot display — the dots are a person's
   fixed nature; practice is silent texture read only by the day's math and by
   the one flavour line under their name (see practiceLine()).

   JOB_PRACTICE maps a static job id to {specific, broad}. Two jobs resolve
   dynamically instead (their specific target changes over time) and are
   handled in buildWorkSnapshot(): "project" (specific = the SYS being raised,
   or none for a one-off PROJECTS build) and "fab" (specific = the FABS id
   under construction). Expedition types (forage/explore/salvage) feed "wild"
   and are credited separately, from S.expeditions, since travelling people
   carry job:"away" rather than a job id. */
const PRACTICE_SPECIFIC_CAP = 0.7;
const PRACTICE_BROAD_CAP = 0.3;
const PRACTICE_SPECIFIC_GROWTH = 0.012;   // per day worked -> ~94% of cap by ~2 game-years
const PRACTICE_BROAD_GROWTH = 0.005;      // per day worked (any job in the category)
const PRACTICE_SPECIFIC_DECAY = 0.0023;   // per day NOT worked -> ~300-day half-life
const PRACTICE_BROAD_DECAY = 0.00115;     // per day NOT worked -> ~600-day half-life (slower: general handiness is stickier than one task)

const JOB_PRACTICE = {
  turbine:{specific:"turbine", broad:"hands"}, solar:{specific:"solar", broad:"hands"}, woodcut:{specific:"woodcut", broad:"wild"},
  battery:{specific:"battery", broad:"hands"}, catchment:{specific:"catchment", broad:"hands"},
  aquaponics:{specific:"aquaponics", broad:"hands"}, irrigation:{specific:"irrigation", broad:"hands"},
  commons:{specific:"commons", broad:"hands"},
  garden:{specific:"garden", broad:"green"}, aquatend:{specific:"aquatend", broad:"green"},
  cook:{specific:"cook", broad:"care"}, care:{specific:"care", broad:"care"}, preserve:{specific:"preserve", broad:"care"}, press:{specific:"press", broad:"hands"}
};

const growPractice = (level, cap, rate) => level + (cap - level) * rate;
const decayPractice = (level, rate) => Math.max(0, level * (1 - rate));

// A person's practice object, tolerant of saves/objects that predate this feature.
const practiceOf = p => p.practice || (p.practice = {specific:{}, broad:{hands:0,green:0,care:0,wild:0}});

// The earned bonus on top of a base stat, for one calculation. `specificKey` is
// whatever the surrounding code is actually crediting right now (a SYS id, a
// FABS id, "garden", "cook", an expedition type...) — pass null if there is none.
function skillBonus(p, statKey, specificKey){
  const pr = practiceOf(p);
  const spec = specificKey!=null ? (pr.specific[specificKey]||0) : 0;
  const broad = pr.broad ? (pr.broad[statKey]||0) : 0;
  return spec + broad;
}
// Base stat + earned practice, for use anywhere a formula currently reads p.hands
// / p.green / p.care / p.wild directly. This is the ONLY place practice should
// touch a number — the dot display always shows the raw base stat.
const effStat = (p, statKey, specificKey) => p[statKey] + skillBonus(p, statKey, specificKey);
const pick=a=>a[Math.floor(Math.random()*a.length)];
const byId=id=>S.people.find(p=>p.id===id);
// Names a specific founding-cast villager for flavor text, but only if they're
// still in the village (alive, not departed) — otherwise falls back to a vague
// stand-in so the journal never has the dead or gone doing things on-page.
// `alive` also requires status !== "away": someone out on the road shouldn't
// be narrated puttering around the commons the same day.
function aliveName(id, fallback){
  const p=byId(id);
  return (p && p.status!=="away") ? p.name : (fallback||"someone");
}
function aliveHe(id, fallback){
  const p=byId(id);
  return (p && p.status!=="away") ? subj(p) : (fallback||"someone");
}
// For flavor lines crediting a puzzle solve to "whoever's good at this" rather
// than a name hardcoded to the founding cast — picks the present villager with
// the highest relevant stat, so the line still makes sense generations later.
function bestPresent(statKey){
  const cands=S.people.filter(p=>canWork(p) && p.status!=="away");
  if(!cands.length) return null;
  return cands.reduce((a,b)=> (b[statKey]>a[statKey] ? b : a));
}
const siteDef=id=>SITE_DEF.find(s=>s.id===id);
const siteName=id=>(S.siteNames&&S.siteNames[id])||siteDef(id).name;
const siteRemainFrac=id=>{const st=S.sites[id];return Object.values(st.stock).reduce((a,b)=>a+b,0)/st.total0;};
const wbFloor=p=>p.trait==="Weathered"?25:0;
/* Pronouns: possessive form, and subject + correct verb agreement.
   "they" takes plural verbs ("they are"); xe/xem takes singular ("xe is"). */
const POSS={"she/her":"her","he/him":"his","they/them":"their","she/they":"her","he/they":"his","xe/xem":"xyr"};
const poss=p=>POSS[p.pn]||"their";
const subj=p=>p.pn.split("/")[0];
const isAre=p=>subj(p)==="they"?"are":"is";
const OBJ={"she/her":"her","he/him":"him","they/them":"them","she/they":"her","he/they":"him","xe/xem":"xem"};
const objp=p=>OBJ[p.pn]||"them";
const Cap=w=>w.charAt(0).toUpperCase()+w.slice(1);
const hasHave=p=>subj(p)==="they"?"have":"has";
function tripDays(days,isExplore){
  const f=S.f||{};
  let d=days + (season().roadDays||0);   // mud in spring, snow in winter
  if(f.tripLong) d+=1;                       // the bridge is out
  if(f.fastLong && d>=4) d=Math.max(1,d-2);  // bicycles are range multipliers
  else if(f.fastLong && d>=3) d=Math.max(1,d-1);
  return d;
}


export { Cap, JOB_PRACTICE, PRACTICE_BROAD_CAP, PRACTICE_BROAD_DECAY, PRACTICE_BROAD_GROWTH, PRACTICE_SPECIFIC_CAP, PRACTICE_SPECIFIC_DECAY, PRACTICE_SPECIFIC_GROWTH, aliveName, bestPresent, byId, clamp, decayPractice, eff, effStat, growPractice, hasHave, isAre, mult, objp, pick, poss, practiceOf, siteDef, siteName, siteRemainFrac, subj, tripDays, wbFloor, working };
