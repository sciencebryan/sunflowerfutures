import { $ } from "./dom.js";
import { RESTORE_IN, SITE_DEF, SYS, TRAITS, addRestore, built, gardenSlots } from "./defs.js";
import { S } from "./state.js";
import { jobName, jobSkill, workDef, workName } from "./day.js";
import { CROPS, FABS, PRESERVE, SEASONS, SEASON_LEN, canWork, dayOfSeason, roadReady, season, seasonIdx, seasonNote } from "./seasons.js";
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
  aquatend:{name:"Aquaponics — tender", sub:()=>"Someone to feed the fish and mind the beds. Output rises with green.", multi:false},
  cook:{name:"The hearth", sub:()=>"A cook lifts everyone's spirits daily and stretches the stores. Uses care.", multi:false},
  care:{name:"The sickbed", sub:()=>"The laid-up and the spent mend faster. Uses care.", multi:false},
  project:{name:"", sub:()=>"Choose who works on it. Uses hands.", multi:false},
  preserve:{name:"Putting food by", sub:()=>"Drying, fermenting, canning. Turns fresh food into food that keeps. Two can work at it. Uses care.", multi:true, cap:2},
  press:{name:"Pressing oil", sub:()=>"Standing at the crank, turning set-aside sunflower seed into oil. Slow work. Uses hands.", multi:false},
  fab:{name:"Fabrication", sub:()=>"Building the thing that ends a trip. Uses hands.", multi:false},
  woodcut:{name:"Chopping wood", sub:()=>"Gathering deadwood for the winter fires. Hard work. Uses wild.", multi:true, cap:3}
};

function openSystemSheet(jobId){
  const meta=SHEET_META[jobId];
  const sysDef=SYS.find(s=>s.id===jobId);
  const name = meta ? (jobId==="project"&&S.project ? workName() : meta.name)
             : sysDef ? sysDef.name : "—";
  const sub = meta ? meta.sub() : "Choose a keeper. Good hands slow the wear. Uses hands.";
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

const SOIL_WORD = f => f>=80?"rich soil":f>=55?"good soil":f>=30?"tired soil":"soil worn thin";

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
    let mh=`<h3>Wildflower meadow</h3><div class="sub">This plot is given over to goldenrod, milkweed, and aster. It feeds no one at the table, but the whole valley's bloom depends on ground like this.</div>
      <button class="opt" data-crop="__unmeadow"><span class="l1">Turn it back to bare ground</span><span class="r">the bloom fades</span></button>`;
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

  let h=`<h3>${isForest?"Plant in the food forest":"Sow bed "+(i+1)}</h3><div class="sub">${sn.name}. ${isForest?"Perennials — planted once, they bear for years.":seasonNote(sn)+" Seeds come out of the store; the harvest comes back when it's ready, and only if someone is tending."}</div>
    <div class="sub" style="margin-top:4px">${isForest?'<span style="color:var(--sun)">PERENNIAL</span> plantings take years to bear, then give freely with no tending.':'<span style="color:var(--water)">HARDY</span> crops survive winter frost. <span style="color:var(--sun)">Legumes</span> feed the soil back; heavy feeders draw it down.'} This ${place}: <b>${soil}</b> (${(bed.fertility??75).toFixed(0)}).</div>`;

  // an established planting locks the plot -- no accidental overwrite of years of growth
  if(curCrop && curCrop.perennial){
    const ageYears = (S.day - bed.plantedDay) / (SEASON_LEN*4);
    const estFrac = clamp(ageYears/curCrop.matureYears, 0.15, 1);
    const status = estFrac>=1 ? "fully established" : `${Math.max(1,Math.ceil(ageYears))} of ${curCrop.matureYears} years toward full bearing`;
    h+=`<div class="sub" style="margin:8px 0">This plot holds <b>${curCrop.name.toLowerCase()}</b> — ${status}. It bears in ${curCrop.harvestSeason}, and asks for no tending the rest of the year.</div>
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
    const afford = S.res.seeds >= c.seed;
    const days = Math.ceil((c.work||0)/2.2);
    const toFrost = sn.id==="winter" ? 0
      : ((SEASONS.findIndex(x=>x.id==="winter") - seasonIdx(S.day))*SEASON_LEN) - dayOfSeason(S.day) + 1;
    const risky = !c.perennial && !c.hardy && !S.flags.coldFrames && toFrost>0 && days>toFrost;
    const tag = c.perennial ? '<span style="font-size:9px;color:var(--sun)">PERENNIAL</span>'
              : c.feed==="legume" ? '<span style="font-size:9px;color:var(--leaf)">LEGUME</span>'
              : c.hardy ? '<span style="font-size:9px;color:var(--water)">HARDY</span>' : "";
    const windowHint = c.sowWindow ? " · early spring or late summer only" : c.perennial ? " · plant in spring" : " · not this season";
    const rightSide = c.perennial
      ? `${c.seed} seed<br>~${c.matureYears}y to bear`
      : `${c.seed} seed<br>~${days}d · ${c.yield} food`;
    h+=`<button class="opt ${(!inSeason||!afford)?'dim':''}" data-crop="${id}" ${(!inSeason||!afford)?"disabled":""}>
      <span><span class="l1">${c.name} ${tag}</span>
        <div class="l2">${c.note}${!inSeason?windowHint:!afford?" · not enough seed":risky?` · <span style="color:var(--rust)">won't finish before frost</span>`:""}</div></span>
      <span class="r">${rightSide}</span></button>`;
  }
  // a forest plot can be given over to wildflower meadow — no food, but it feeds the
  // valley's pollinators (and thence every bed's yield). the pure Terra-Nil choice:
  // retire ground from production and give it back to the wild.
  if(isForest && !bed.crop){
    h+=`<button class="opt" data-crop="__meadow"><span><span class="l1">Wildflower meadow <span style="font-size:9px;color:var(--leaf)">POLLINATOR</span></span>
      <div class="l2">Goldenrod, milkweed, aster, wild bergamot — no harvest, but the bloom brings back the bees, and the whole valley's gardens set heavier for it.</div></span>
      <span class="r">4 seed<br>gives no food</span></button>`;
  }
  if(bed.crop) h+=`<button class="opt" data-crop="__clear"><span class="l1">${isForest?"Dig it out":"Turn it under"}</span><span class="r">start again</span></button>`;
  openSheet(h);
  $("sheet").querySelectorAll("[data-crop]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.crop;
      if(id==="__clear"){ bed.crop=null; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.matured=false; bed.lastHarvestYear=undefined; bed.lastPickDay=undefined; }
      else if(id==="__meadow"){
        const MEADOW_SEED=4;
        if(S.res.seeds < MEADOW_SEED) return;
        S.res.seeds -= MEADOW_SEED;
        // a meadow is a standing plot that yields no food; it's marked so the growth
        // and harvest loops skip it, and it feeds the valley's pollinators.
        bed.crop="__meadow"; bed.meadow=true; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.plantedDay=S.day; bed.matured=true;
        addRestore("pollinator", RESTORE_IN.meadowPlot);
        S.pending.push(`A forest plot was given over to wildflowers. It will feed no one at the table — and the whole valley will be the better fed for it.`);
      }
      else{
        const c=CROPS[id];
        if(S.res.seeds < c.seed) return;
        S.res.seeds -= c.seed;
        bed.crop=id; bed.growth=0; bed.days=0; bed.ready=false; bed.stored=0; bed.plantedDay=S.day; bed.matured=false; bed.lastHarvestYear=undefined; bed.lastPickDay=undefined;
        // native perennials in the forest feed the soil web
        if(isForest && c.native) addRestore("mycosphere", RESTORE_IN.nativePlant);
        S.pending.push(c.perennial
          ? (c.native
              ? `The food forest gained ${c.name.toLowerCase()} — native stock, and the ground is better for it already.`
              : `The food forest gained ${c.name.toLowerCase()}. It will be years before it gives much back.`)
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
    openSheet(`<h3>${p.name}</h3><div class="sub">Out at ${ex?exWhere(ex):"—"}. Back in ${ex?ex.daysLeft:"?"} days. The village waits.</div>`);
    return;
  }
  if(!canWork(p)){ openSheet(`<h3>${p.name}</h3><div class="sub">${p.age} years old. ${p.note} There is no work for ${objp(p)} yet, and that is the point of the whole thing.</div>`); return; }
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
  h+=jobRow("cook","The hearth",`lifts everyone, stretches food${ck?` · now: ${ck.name}`:""}`,"care");
  const laidup=S.people.filter(x=>x.status==="down"||x.status==="spent").length;
  const curCare=S.people.find(x=>x.job==="care"&&x.id!==p.id);
  h+=jobRow("care","The sickbed",`${laidup} laid up${curCare?` · now: ${curCare.name}`:""}`,"care");
  if(Object.values(PRESERVE).some(m=>S.flags[m.flag])){
    const curP=S.people.find(x=>x.job==="preserve"&&x.id!==p.id);
    h+=jobRow("preserve","Putting food by",`${S.preserved.toFixed(0)} kept${curP?` · now: ${curP.name}`:""}`,"care");
  }
  if(S.flags.oilPress){
    const curPr=S.people.find(x=>x.job==="press"&&x.id!==p.id);
    h+=jobRow("press","Pressing oil",`${(S.oil||0).toFixed(1)} oil${curPr?` · now: ${curPr.name}`:""}`,"hands");
  }
  if(S.fabProject){
    const fd=FABS.find(x=>x.id===S.fabProject.id);
    const curF=S.people.find(x=>x.job==="fab"&&x.id!==p.id);
    h+=jobRow("fab",fd.name,`${clamp(S.fabProject.progress/fd.work*100,0,100).toFixed(0)}% done${curF?` · now: ${curF.name}`:""}`,"hands");
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
  const title = isExplore?"Range farther out" : isForage?"Forage the near country" : `Party to ${siteName(target)}`;
  const sub = isForage
    ? `${days} days, close to home and low risk. Pick up to 3. Wild hands find more. What they bring back feeds the village now — and thins the patches for later.`
    : `${days} days there and back. Pick up to 3. High wild means safer on the road and stronger packs. Going alone is riskier, and there's no one to carry you home${isExplore?". No telling what they'll find, only that it's far":""}.`;
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
    const lowForageNote = season().forage<0.5 ? " — the near country gives little this season" : "";
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
    S.pending.push(isExplore ? `${names} set out past the edge of the maps.`
      : isForage ? `${names} went out with baskets before the dew burned off.`
      : `${names} set out for ${siteName(target)}. ${d} days, if the road is kind.`);
    store.save(S); closeSheet(); renderAll();
  };
}


export { SOIL_WORD, closeSheet, openPartySheet, openPersonSheet, openSheet, openSowSheet, openSystemSheet };
