import { byId, pick } from "./helpers.js";
import { CROPS, SEASONS, SEASON_LEN, WEATHERS } from "./data-economy.js";
import { S } from "./state.js";











/* Age in years. Time is measured in winters, because that is how it is felt. */
const AGES = {nadia:34, ora:29, bec:31, sam:44, yusuf:38, petra:52, ilya:27,
              june:61, marisol:33, theo:16, ash:40, kav:47,
              rosa:36, emrys:30, din:24, halla:57, moss:66, yara:35};

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










export { ADULT, AGES, ELDER, canRoad, canWork, dayOfSeason, discoverRandomCrop, discoveryLine, generateFallbackChildName, lockedCrops, roadReady, rollWeather, scaledWeather, season, seasonIdx, seasonNote, yearOf };
