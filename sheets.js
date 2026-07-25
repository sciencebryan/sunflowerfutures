import { $ } from "./dom.js";
import { TRAITS, addRestore, built, gardenSlots } from "./defs.js";
import { CROPS, FABS, PRESERVE, RESTORE_IN, SEASONS, SEASON_LEN, SITE_DEF, SYS } from "./data-economy.js";
import { FOOD_COMP, MAX_COMPANIONS } from "./data-food.js";
import { SEED_COMPANION, SEED_RIVAL } from "./data-puzzles.js";
import { S } from "./state.js";
import { SCALES, canAfford, celebDef, costOf, dayOfYear, holdCelebration, makeTradition } from "./celebrations.js";
import { TRADITION_NAMES } from "./data-celebrations.js";
import { jobName, jobSkill, workDef, workName } from "./day.js";
import { canWork, dayOfSeason, roadReady, season, seasonIdx, seasonNote } from "./seasons.js";
import { store } from "./store.js";
import { renderAll } from "./render.js";
import { byId, clamp, effStat, objp, siteDef, siteName, tripDays } from "./helpers.js";
import { exWhere } from "./events.js";









/* ================= sheets ================= */
function openSheet(html){ $("sheet").innerHTML=html; $("sheet").classList.add("open"); $("scrim").classList.add("open"); }
function closeSheet(){ $("sheet").classList.remove("open"); $("scrim").classList.remove("open"); }
$("scrim").onclick=closeSheet;

/* NOTE: sub is a function, not a template literal — this object is built at load
   time, when S is still null, so it must not read game state eagerly. */
const SHEET_META = {
  garden:{name:"The gardens", sub:()=>{const n=gardenSlots(); return n===1?"One pair of hands can work the beds. Uses green.":`Choose up to ${n} tenders. Uses green.`;}, multi:true},
  aquatend:{name:"Aquaponics — tender", sub:()=>"Someone to feed the fish and mind the plants. Output rises with green.", multi:false},
  cook:{name:"The hearth", sub:()=>"A cook lifts everyone's spirits daily and stretches the stores. Uses care.", multi:false},
  care:{name:"The sickbed", sub:()=>"The laid-up and the spent mend faster. Uses care.", multi:false},
  project:{name:"", sub:()=>"Choose who works on it. Uses hands.", multi:false},
  preserve:{name:"Putting food by", sub:()=>"Drying, fermenting, canning. Turns fresh food into stored food. Two can work at it. Uses care.", multi:true, cap:2},
  press:{name:"Pressing oil", sub:()=>"Standing at the crank, turning set-aside sunflower seed into oil. Uses hands.", multi:false},
  fab:{name:"Fabrication", sub:()=>"Building a new shop, or running the finished ones — the forge, the machine shop, the apothecary all need hands to produce.", multi:false},
  woodcut:{name:"Chopping wood", sub:()=>"Gathering deadwood for the winter fires. Hard work. Uses wild.", multi:true, cap:3}
};

function openSystemSheet(jobId){
  const meta=SHEET_META[jobId];
  const sysDef=SYS.find(s=>s.id===jobId);
  const name = meta ? (jobId==="project"&&S.project ? workName() : meta.name)
             : sysDef ? sysDef.name : "—";
  const sub = meta ? meta.sub() : "Choose a maintainer. Uses hands. A higher rating means faster repair.";
  const multi = meta ? meta.multi : false;
  const sk = jobSkill(jobId);
  const crew=S.people.filter(p=>p.job===jobId);
  let h=`<h3>${name}</h3><div class="sub">${sub}</div>`;
  for(const p of S.people){
    if(!canWork(p)) continue;
    const cur=p.job===jobId, busy=p.job && !cur;
    const unavail = p.status==="down" || p.status==="away";
    h+=`<button class="opt ${cur?'current':''} ${unavail?'dim':''}" data-pid="${p.id}" ${unavail?"disabled":""}>
      <span><span class="l1">${p.name}</span><div class="l2">${p.trait}${busy?` · now: ${jobName(p.job).toLowerCase()}`:""}${unavail?` · ${p.status==="away"?"away":"laid up"}`:""}</div></span>
      <span class="r">${sk} ${p[sk]}/5<br>spirits ${p.wb.toFixed(0)}</span>
    </button>`;
  }
  if(crew.length) h+=`<button class="opt" data-pid="__none"><span class="l1">Send ${crew.length>1?"everyone":crew[0].name} to rest</span><span class="r">unassign</span></button>`;
  openSheet(h);
  $("sheet").querySelectorAll("[data-pid]").forEach(b=>{
    b.onclick=()=>{
      const pid=b.dataset.pid;
      if(pid==="__none"){ S.people.forEach(p=>{if(p.job===jobId)p.job=null;}); }
      else{
        const p=S.people.find(x=>x.id===pid);
        if(p.job===jobId){ p.job=null; }
        else{
          if(multi){
            const lim = meta && meta.cap ? meta.cap : gardenSlots();
            const t=S.people.filter(x=>x.job===jobId);
            if(t.length>=lim && !t.includes(p)) t[0].job=null;
          } else {
            S.people.forEach(x=>{if(x.job===jobId)x.job=null;});
          }
          p.job=jobId;
        }
      }
      store.save(S); closeSheet(); renderAll();
    };
  });
}

const SOIL_WORD = f => f>=80?"rich soil":f>=55?"good soil":f>=30?"tired soil":"barren soil";

function openSowSheet(i, isForest){
  isForest = !!isForest;
  const sn=season();
  const coll = isForest ? S.forest : S.beds;
  const bed = coll[i];
  const curCrop = bed.crop ? CROPS[bed.crop] : null;
  const soil = SOIL_WORD(bed.fertility??75);
  const place = isForest ? "forest plot" : "bed";

  // a meadow plot: no crop menu, just the choice to return it to production
  if(isForest && bed.meadow){
    let mh=`<h3>Wildflower meadow</h3><div class="sub">This plot is full of goldenrod, milkweed, aster, other wildflowers. It's not a food source for people, but it attracts and feeds pollinators that pollinate the entire valley.</div>
      <button class="opt" data-crop="__unmeadow"><span class="l1">Turn it back to bare ground</span><span class="r">the pollinators will leave</span></button>`;
    openSheet(mh);
    $("sheet").querySelectorAll("[data-crop]").forEach(b=>{
      b.onclick=()=>{
        bed.crop=null; bed.meadow=false; bed.matured=false; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0;
        addRestore("pollinator", -RESTORE_IN.meadowPlot);   // losing the meadow costs its pollinator gain
        store.save(S); closeSheet(); renderAll();
      };
    });
    return;
  }

  let h=`<h3>${isForest?"Plant in the food forest":"Sow bed "+(i+1)}</h3><div class="sub">${sn.name}. ${isForest?"Perennials — they don't have to be replanted but take time to reach maturity.":seasonNote(sn)+" Seeds come out of seed storage; food is harvested when the plant is mature as long as someone is tending the garden bed."}</div>
    <div class="sub" style="margin-top:4px">${isForest?'<span style="color:var(--sun)">PERENNIAL</span> plantings take years to bear, but require no regular care.':'<span style="color:var(--water)">HARDY</span> crops survive winter frost without a cold frame or greenhouse. <span style="color:var(--sun)">Legumes</span> increase soil fertility; other crops decrease it.'} This ${place}: <b>${soil}</b> (${(bed.fertility??75).toFixed(0)}).</div>`;

  /* --- interplanting ---
     A bed already sown with an annual can take up to MAX_COMPANIONS
     companions alongside its primary. Good and bad pairings come from the
     SAME grid the seed-frame puzzle teaches, so the puzzle is a tutorial
     for this screen rather than a separate game. The hints below name the
     relationship plainly — this is knowledge a gardener would simply have,
     not a hidden system. */
  if(curCrop && !curCrop.perennial && !isForest){
    const mates = bed.companions || [];
    const catOf = id => FOOD_COMP[id] || null;
    const pairIn = (list,a,b) => list.some(([x,y]) => (x===a&&y===b)||(x===b&&y===a));
    const prim = catOf(bed.crop);
    h += `<div class="sub" style="margin:10px 0 4px">This bed holds <b>${curCrop.name.toLowerCase()}</b>${mates.length?`, interplanted with ${mates.map(c=>CROPS[c].name.toLowerCase()).join(" and ")}`:""}.
      ${bed.ready?"It's ready to pick — too late to plant anything else in with it.":`Up to ${MAX_COMPANIONS} things can share the ground with it.`}</div>`;
    if(!bed.ready && mates.length < MAX_COMPANIONS){
      for(const [id,c] of Object.entries(CROPS)){
        if(c.perennial || c.locked && !(S.crops&&S.crops[id])) continue;
        if(id===bed.crop || mates.includes(id)) continue;
        if(!catOf(id)) continue;
        const have = (S.seedStock&&S.seedStock[id])||0;
        const need = Math.max(1, Math.round(c.seed*0.5));
        const inSeason = c.sow.includes(sn.id) || S.flags.coldFrames;
        const good = pairIn(SEED_COMPANION, prim, catOf(id)) || mates.some(m=>pairIn(SEED_COMPANION, catOf(m), catOf(id)));
        const bad  = pairIn(SEED_RIVAL, prim, catOf(id))     || mates.some(m=>pairIn(SEED_RIVAL, catOf(m), catOf(id)));
        const ok = have>=need && inSeason;
        const hint = good ? '<span style="color:var(--leaf)">grows well alongside</span>'
                   : bad  ? '<span style="color:var(--rust)">the two of them fight</span>'
                   : "no strong feelings either way";
        h += `<button class="opt ${ok?"":"dim"}" data-mate="${id}" ${ok?"":"disabled"}>
          <span><span class="l1">${c.name}</span><div class="l2">${hint}${!inSeason?" · not this season":have<need?` · no ${c.name.toLowerCase()} seed`:""}</div></span>
          <span class="r">${need} seed (have ${have})</span></button>`;
      }
    }
    if(mates.length){
      h += `<button class="opt" data-mate="__clearmates"><span class="l1">Pull the interplanting</span><span class="r">keeps the ${curCrop.name.toLowerCase()}</span></button>`;
    }
  }

  // an established planting locks the plot -- no accidental overwrite of years of growth
  if(curCrop && curCrop.perennial){
    const ageYears = (S.day - bed.plantedDay) / (SEASON_LEN*4);
    const estFrac = clamp(ageYears/curCrop.matureYears, 0.15, 1);
    const status = estFrac>=1 ? "fully established" : `${Math.max(1,Math.ceil(ageYears))} of ${curCrop.matureYears} years toward full bearing`;
    h+=`<div class="sub" style="margin:8px 0">This plot holds <b>${curCrop.name.toLowerCase()}</b> — ${status}. It bears in ${curCrop.harvestSeason}, and requires no regular care.</div>
      <button class="opt" data-crop="__digout"><span class="l1">Dig it out</span><span class="r">loses everything invested here</span></button>`;
    openSheet(h);
    $("sheet").querySelectorAll("[data-crop]").forEach(b=>{
      b.onclick=()=>{
        bed.crop=null; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.matured=false; bed.lastHarvestYear=undefined; bed.lastPickDay=undefined;
        store.save(S); closeSheet(); renderAll();
      };
    });
    return;
  }


  for(const [id,c] of Object.entries(CROPS)){
    if(c.locked && !(S.crops && S.crops[id])) continue;
    if(isForest !== !!c.perennial) continue;   // forest shows perennials; beds show annuals
    const inWindow = c.sowWindow && c.sowWindow[sn.id]
      ? (dayOfSeason(S.day)>=c.sowWindow[sn.id][0] && dayOfSeason(S.day)<=c.sowWindow[sn.id][1])
      : true;
    let inSeason;
    if(c.perennial)       inSeason = c.sow.includes(sn.id);
    else if(c.sowWindow)  inSeason = c.sow.includes(sn.id) && inWindow;
    else                  inSeason = c.sow.includes(sn.id) || S.flags.coldFrames;
    const have = (S.seedStock && S.seedStock[id]) || 0;
    const afford = have >= c.seed;
    // the floor is a fact; the work estimate is a guess at a decent crew's pace.
    // Take the later of the two: nothing ripens before minDays no matter who tends it.
    const floorDays = c.minDays||0;
    const days = Math.max(floorDays, Math.ceil((c.work||0)/2.2));
    const toFrost = sn.id==="winter" ? 0
      : ((SEASONS.findIndex(x=>x.id==="winter") - seasonIdx(S.day))*SEASON_LEN) - dayOfSeason(S.day) + 1;
    const risky = !c.perennial && !c.hardy && !S.flags.coldFrames && toFrost>0 && days>toFrost;
    const tag = c.perennial ? '<span style="font-size:9px;color:var(--sun)">PERENNIAL</span>'
              : c.feed==="legume" ? '<span style="font-size:9px;color:var(--leaf)">LEGUME</span>'
              : c.hardy ? '<span style="font-size:9px;color:var(--water)">HARDY</span>' : "";
    const windowHint = c.sowWindow ? " · early spring or late summer only" : c.perennial ? " · plant in spring" : " · not this season";
    const rightSide = c.perennial
      ? `${c.seed} seed (have ${have})<br>~${c.matureYears}y to bear`
      : `${c.seed} seed (have ${have})<br>${floorDays}d+ · ~${c.yield} food${c.window>1?` over ${c.window}d`:""}`;
    h+=`<button class="opt ${(!inSeason||!afford)?'dim':''}" data-crop="${id}" ${(!inSeason||!afford)?"disabled":""}>
      <span><span class="l1">${c.name} ${tag}</span>
        <div class="l2">${c.note}${!inSeason?windowHint:!afford?` · no ${c.name.toLowerCase()} seed left`:risky?` · <span style="color:var(--rust)">won't finish before frost</span>`:""}</div></span>
      <span class="r">${rightSide}</span></button>`;
  }
  // a forest plot can be given over to wildflower meadow — no food, but it feeds the
  // valley's pollinators (and thence every bed's yield). the pure Terra-Nil choice:
  // retire ground from production and give it back to the wild.
  if(isForest && !bed.crop){
    // wildflower seed isn't bought out of the crop stock — goldenrod and
    // milkweed line every roadside; you gather it. The cost is the plot.
    h+=`<button class="opt" data-crop="__meadow"><span><span class="l1">Wildflower meadow <span style="font-size:9px;color:var(--leaf)">POLLINATOR</span></span>
      <div class="l2">Goldenrod, milkweed, aster, wild bergamot — gathered from the roadsides. No food for us to harvest, but the flowers bring pollinators, and our gardens produce more because of it.</div></span>
      <span class="r">gathered seed<br>gives no food</span></button>`;
  }
  if(bed.crop) h+=`<button class="opt" data-crop="__clear"><span class="l1">${isForest?"Dig it out":"Turn it under"}</span><span class="r">start again</span></button>`;
  openSheet(h);
  $("sheet").querySelectorAll("[data-mate]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.mate;
      bed.companions = bed.companions || [];
      if(id==="__clearmates"){ bed.companions = []; }
      else{
        const c=CROPS[id]; if(!c) return;
        const need=Math.max(1, Math.round(c.seed*0.5));
        S.seedStock = S.seedStock || {};
        if(((S.seedStock[id])||0) < need) return;
        if(bed.companions.length >= MAX_COMPANIONS) return;
        S.seedStock[id] -= need;
        bed.companions.push(id);
        S.pending.push(`Bed ${i+1} was interplanted with ${c.name.toLowerCase()}.`);
      }
      store.save(S); closeSheet(); renderAll();
    };
  });
  $("sheet").querySelectorAll("[data-crop]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.crop;
      if(id==="__clear"){ bed.crop=null; bed.companions=[]; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.matured=false; bed.lastHarvestYear=undefined; bed.lastPickDay=undefined; }
      else if(id==="__meadow"){
        // a meadow is a standing plot that yields no food; it's marked so the growth
        // and harvest loops skip it, and it feeds the valley's pollinators.
        bed.crop="__meadow"; bed.meadow=true; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.plantedDay=S.day; bed.matured=true;
        addRestore("pollinator", RESTORE_IN.meadowPlot);
        S.pending.push(`A forest plot was seeded with wildflowers. Hopefully, it will attract and sustain more pollinators.`);
      }
      else{
        const c=CROPS[id];
        S.seedStock = S.seedStock || {};
        if(((S.seedStock[id])||0) < c.seed) return;
        S.seedStock[id] -= c.seed;
        bed.crop=id; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.plantedDay=S.day; bed.matured=false; bed.lastHarvestYear=undefined; bed.lastPickDay=undefined;
        // native perennials in the forest feed the soil web
        if(isForest && c.native) addRestore("mycosphere", RESTORE_IN.nativePlant);
        S.pending.push(c.perennial
          ? (c.native
              ? `The food forest gained ${c.name.toLowerCase()} — a native plant, familiar to the local wildlife.`
              : `The food forest gained ${c.name.toLowerCase()}. It will be some time before we get any food from it.`)
          : `Bed ${i+1} sown with ${c.name.toLowerCase()}.`);
      }
      store.save(S); closeSheet(); renderAll();
    };
  });
}

function openPersonSheet(pid){
  const p=S.people.find(x=>x.id===pid);
  if(p.status==="away"){
    const ex=S.expeditions.find(e=>e.party.includes(p.id));
    openSheet(`<h3>${p.name}</h3><div class="sub">Out at ${ex?exWhere(ex):"—"}. Back in ${ex?ex.daysLeft:"?"} days.</div>`);
    return;
  }
  if(!canWork(p)){ openSheet(`<h3>${p.name}</h3><div class="sub">${p.age} years old. ${p.note} There is no work for ${objp(p)} yet.</div>`); return; }
  if(p.status==="down"){ openSheet(`<h3>${p.name}</h3><div class="sub">Laid up and resting. Back in a day or two — sooner with a caretaker.</div>`); return; }
  let h=`<h3>Where does ${p.name} go?</h3><div class="sub">hands ${p.hands} · green ${p.green} · care ${p.care} · wild ${p.wild} — ${TRAITS[p.trait]}.</div>`;
  const jobRow=(job,name,sub,skill)=>{
    return `<button class="opt ${p.job===job?'current':''}" data-job="${job}"><span><span class="l1">${name}</span><div class="l2">${sub}</div></span><span class="r">${skill} ${p[skill]}/5</span></button>`;
  };
  h+=`<button class="opt ${p.job===null?'current':''}" data-job="__rest"><span class="l1">Rest</span><span class="r">recover spirits</span></button>`;
  const gt=S.people.filter(x=>x.job==="garden").length;
  h+=jobRow("garden","The gardens",`${gt}/${gardenSlots()} tending`,"green");
  if(built("aquaponics")){
    const at=S.people.find(x=>x.job==="aquatend"&&x.id!==p.id);
    h+=jobRow("aquatend","Aquaponics — tender",`feeds the output${at?` · now: ${at.name}`:""}`,"green");
  }
  const ck=S.people.find(x=>x.job==="cook"&&x.id!==p.id);
  h+=jobRow("cook","The hearth",`makes everyone a little happier, stretches food${ck?` · now: ${ck.name}`:""}`,"care");
  const laidup=S.people.filter(x=>x.status==="down"||x.status==="spent").length;
  const curCare=S.people.find(x=>x.job==="care"&&x.id!==p.id);
  h+=jobRow("care","The sickbed",`${laidup} laid up${curCare?` · now: ${curCare.name}`:""}`,"care");
  if(Object.values(PRESERVE).some(m=>S.flags[m.flag])){
    const curP=S.people.find(x=>x.job==="preserve"&&x.id!==p.id);
    h+=jobRow("preserve","Preserving food",`${S.preserved.toFixed(0)} kept${curP?` · now: ${curP.name}`:""}`,"care");
  }
  if(S.flags.oilPress){
    const curPr=S.people.find(x=>x.job==="press"&&x.id!==p.id);
    h+=jobRow("press","Pressing oil",`${(S.oil||0).toFixed(1)} oil${curPr?` · now: ${curPr.name}`:""}`,"hands");
  }
  {
    // fab work exists while something's under construction OR any shop stands.
    // Construction takes the whole day; otherwise the worker runs the shops.
    const shopsBuilt = FABS.filter(d=>S.fabs && S.fabs[d.id]);
    const curF=S.people.find(x=>x.job==="fab"&&x.id!==p.id);
    if(S.fabProject){
      const fd=FABS.find(x=>x.id===S.fabProject.id);
      h+=jobRow("fab",fd.name,`${clamp(S.fabProject.progress/fd.work*100,0,100).toFixed(0)}% done${shopsBuilt.length?" · the shops wait":""}${curF?` · now: ${curF.name}`:""}`,"hands");
    } else if(shopsBuilt.length){
      h+=jobRow("fab","The workshops",`runs ${shopsBuilt.map(d=>d.name.toLowerCase().replace(/^the /,"")).join(", ")}${curF?` · now: ${curF.name}`:""}`,"hands");
    }
  }
  if(S.project){
    const proj=workDef();
    const curW=S.people.find(x=>x.job==="project"&&x.id!==p.id);
    h+=jobRow("project",workName(),`${clamp(S.project.progress/proj.work*100,0,100).toFixed(0)}% done${curW?` · now: ${curW.name}`:""}`,"hands");
  }
  for(const def of SYS){
    if(!built(def.id)) continue;
    const cur=S.people.find(x=>x.job===def.id && x.id!==p.id);
    h+=jobRow(def.id,def.name,`${S.sys[def.id].cond.toFixed(0)}%${cur?` · now: ${cur.name}`:""}`,"hands");
  }
  openSheet(h);
  $("sheet").querySelectorAll("[data-job]").forEach(b=>{
    b.onclick=()=>{
      const j=b.dataset.job;
      if(j==="__rest") p.job=null;
      else if(j==="garden"){
        const t=S.people.filter(x=>x.job==="garden" && x.id!==p.id);
        if(t.length>=gardenSlots()) t[0].job=null;
        p.job="garden";
      } else {
        S.people.forEach(x=>{if(x.job===j && x.id!==p.id)x.job=null;});
        p.job=j;
      }
      store.save(S); closeSheet(); renderAll();
    };
  });
}

let partyPick=new Set();
function openPartySheet(target){
  partyPick=new Set();
  drawPartySheet(target);
}
function drawPartySheet(target){
  const isExplore=target==="__explore", isForage=target==="__forage";
  const def = isExplore ? SITE_DEF.find(s=>!S.sites[s.id].discovered)
            : isForage ? {days:2, name:"the near country"}
            : siteDef(target);
  if(!def) return;
  const days=def.days;
  const title = isExplore?"Range farther out" : isForage?"Forage the nearby wilderness" : `Party to ${siteName(target)}`;
  const sub = isForage
    ? `${days} days, close to home and low risk. Pick up to 3. Higher wild finds more. Repeated harvest reduces yield.`
    : `${days} days there and back. Pick up to 3. High wild means a safer trip and more material salvaged. Going alone is riskier${isExplore?". No telling what they'll find, only that it's far":""}.`;
  let h=`<h3>${title}</h3><div class="sub">${sub}</div>`;
  for(const p of S.people){
    const unavail=p.status!=="ok" || !roadReady(p);
    const on=partyPick.has(p.id);
    h+=`<button class="opt ${on?'current':''} ${unavail?'dim':''}" data-pp="${p.id}" ${unavail?"disabled":""}>
      <span><span class="l1">${p.name}</span><div class="l2">${p.trait}${p.job?` · now: ${jobName(p.job).toLowerCase()}`:""}${unavail?` · ${p.status==="away"?"away":"laid up"}`:""}</div></span>
      <span class="r">wild ${p.wild}/5<br>spirits ${p.wb.toFixed(0)}</span>
    </button>`;
  }
  if(isForage && partyPick.size){
    // matches the yield math in tickExpeditions: raw × season forage × larder
    const est=[...partyPick].reduce((a,pid)=>a+3+effStat(byId(pid),"wild","forage")*1.4,0)*season().forage*(S.larder??1);
    const lowForageNote = season().forage<0.5 ? " — there isn't much to forage this season" : "";
    h+=`<div class="outline-note" style="margin:2px 2px 8px">they'd bring back about ${est.toFixed(0)} food${lowForageNote}</div>`;
  }
  // forage runs the raw round-trip; only far trips take the season/bridge road penalty
  const sendDays = isForage ? days : tripDays(days, isExplore);
  h+=`<button class="confirm" id="sendBtn" ${partyPick.size?"":"disabled"}>Send ${partyPick.size||"no one"} — ${sendDays} days</button>`;
  openSheet(h);
  $("sheet").querySelectorAll("[data-pp]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.pp;
      if(partyPick.has(id)) partyPick.delete(id);
      else if(partyPick.size<3) partyPick.add(id);
      drawPartySheet(target);
    };
  });
  $("sendBtn").onclick=()=>{
    if(!partyPick.size) return;
    const party=[...partyPick];
    const d = isForage ? days : tripDays(days, isExplore);
    for(const pid of party){ const p=byId(pid); p.status="away"; p.job="away"; }
    S.expeditions.push({id:S.expSeq++, type:isExplore?"explore":isForage?"forage":"salvage",
      siteId:(isExplore||isForage)?null:target, party, daysLeft:d, total:d, injured:[]});
    const names=party.map(pid=>byId(pid).name).join(", ");
    S.pending.push(isExplore ? `${names} set out in search of new places to salvage.`
      : isForage ? `${names} went out with baskets before all of us were awake.`
      : `${names} set out for ${siteName(target)}. ${d} days, if all goes well.`);
    store.save(S); closeSheet(); renderAll();
  };
}











/* ---------- celebrations: pick a scale, then optionally name it ---------- */
function openCelebrationSheet(id){
  const def = celebDef(id); if(!def) return;
  let h = `<h3>${def.name}</h3><div class="sub">${def.blurb}</div>`;
  for(const sc of SCALES){
    const c = costOf(def, sc.id);
    const afford = canAfford(def, sc.id);
    const cost = Object.entries(c).map(([k,v])=>`${v} ${k}`).join(" · ") || "nothing but the evening";
    h += `<button class="opt ${afford?'':'dim'}" data-scale="${sc.id}" ${afford?'':'disabled'}>
      <span><span class="l1">${sc.label}</span>
      <div class="l2">${sc.note} · ${cost}${afford?"":" · not enough spare"}</div></span></button>`;
  }
  h += `<button class="opt" id="celebCancel" style="justify-content:center;margin-top:7px"><span class="l1">Not now</span></button>`;
  openSheet(h);
  document.querySelectorAll("[data-scale]").forEach(b=>{
    b.onclick=()=>{
      if(holdCelebration(id, b.dataset.scale)) openTraditionSheet(id);
      else closeSheet();
      store.save(S); renderAll();
    };
  });
  $("celebCancel").onclick = closeSheet;
}

/* Offered once, right after a celebration: make this a yearly thing. */
function openTraditionSheet(id){
  const names = TRADITION_NAMES[id] || [];
  const taken = new Set((S.traditions||[]).map(t=>t.day));
  const clash = taken.has(dayOfYear(S.day));
  if(clash){ closeSheet(); return; }   // already something on this date
  openSheet(`<h3>Keep this?</h3>
    <div class="sub">Every year on this day, for as long as the village can manage it. It gets a little stronger each time it's kept — and it's felt when it isn't.</div>
    <div style="display:flex;flex-wrap:wrap;gap:7px;margin:10px 0">
      ${names.map(n=>`<button class="chip" data-tname="${n}" style="cursor:pointer;padding:7px 12px;font-family:var(--serif);font-size:13.5px;border-radius:15px">${n}</button>`).join("")}
    </div>
    <input id="tradInput" placeholder="or call it something else" maxlength="32"
      style="width:100%;padding:9px 11px;font-family:var(--serif);font-size:14.5px;border:1px solid var(--line);border-radius:7px;background:var(--paper);color:var(--ink)">
    <button class="confirm" id="tradSave" style="margin-top:10px">Make it a tradition</button>
    <button class="opt" id="tradSkip" style="justify-content:center;margin-top:7px"><span class="l1">Just this once</span></button>`);
  document.querySelectorAll("[data-tname]").forEach(b=>{
    b.onclick=()=>{ $("tradInput").value = b.dataset.tname; };
  });
  $("tradSave").onclick=()=>{
    const v = $("tradInput").value;
    if(!v || !v.trim()) return;
    makeTradition(v);
    closeSheet(); store.save(S); renderAll();
  };
  $("tradSkip").onclick=()=>{ closeSheet(); renderAll(); };
}

export { SOIL_WORD, openCelebrationSheet, closeSheet, openPartySheet, openPersonSheet, openSheet, openSowSheet, openSystemSheet };
