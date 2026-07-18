import { PUZ_META, CIRCUIT_LEVELS, CIRCUIT_REWARD, FOCUS_LEVELS, FOCUS_REWARD, PATCH_LEVELS, PATCH_REWARD, PATCH_SHAPES, PATCH_VARIANTS, PIPES_LEVELS, PIPES_REWARD, SEEDLINGS, SEED_COMPANION, SEED_LEVELS, SEED_REWARD, SEED_RIVAL, SIGNAL_LEVELS, SIGNAL_REWARD, WATER_LEVELS, WATER_PIECES, WATER_REWARD, WIRES_LEVELS, WIRES_REWARD, PICROSS_LEVELS, PICROSS_REWARD } from "./data-puzzles.js";
import { S } from "./state.js";
import { $ } from "./dom.js";
import { store } from "./store.js";
import { renderAll } from "./render.js";
import { CROPS, RESTORE_IN } from "./data-economy.js";
import { cKey, circuitAdj, circuitCap, circuitCheck, focusCheck, focusSrcs, focusTargets, patchCheck, pipesCheck, seedCheck, seedSlotAt, signalCheck, waterSim, wireRot, wiresCheck, generatePicrossClues } from "./puzzles.js";
import { bestPresent, byId } from "./helpers.js";
import { addRestore } from "./defs.js";




let picrossMode = 1;      // 1 = Fill Mode, 2 = Cross Mode
let picrossDragging = false; 
let picrossPaintState = 0; // What color are we painting right now? (0, 1, or 2)


let pz = null;   // {kind, lvl, paths|placed, sel}
function setPz(v){ pz = v; }

function cyclePatch(uid) {
  const patch = pz.placed.find(p => p.uid === uid);
  if (!patch) return;
  
  const variants = PATCH_VARIANTS[patch.shape] || [patch.shape];
  if (variants.length < 2) return;  // no variants
  
  const idx = variants.indexOf(patch.shape);
  patch.shape = variants[(idx + 1) % variants.length];
}

function worksIntro(){
  const c=S.puz.circuit, w=S.puz.water;
  return `<div class="card">
    <div class="sysname">The workshop bench</div>
    <div class="blurb">The long problems the village keeps coming back to: getting current where it's needed without burning the board, getting water where it's needed without losing the soil, sorting the seed so everything grows, sealing the drafts before winter, catching the light properly, and keeping a channel open to the world beyond. Solving one for good changes how the village works, permanently.</div>
    <div class="loadlist" style="margin-top:8px">circuit — ${c}/${CIRCUIT_LEVELS.length} &nbsp;·&nbsp; watershed — ${w}/${WATER_LEVELS.length} &nbsp;·&nbsp; seed frame — ${S.puz.seed}/${SEED_LEVELS.length} &nbsp;·&nbsp; patchwork — ${S.puz.patch}/${PATCH_LEVELS.length} &nbsp;·&nbsp; heliostat — ${S.puz.focus}/${FOCUS_LEVELS.length} &nbsp;·&nbsp; the radio — ${S.puz.radio}/${SIGNAL_LEVELS.length} &nbsp;·&nbsp; the line run — ${S.puz.wires||0}/${WIRES_LEVELS.length} &nbsp;·&nbsp; the mains — ${S.puz.pipes||0}/${PIPES_LEVELS.length}</div>
  </div>`;
}

function renderWorks(){
  if(pz){
    if(pz.kind==="circuit") renderCircuit();
    else if(pz.kind==="water") renderWater();
    else if(pz.kind==="seed") renderSeed();
    else if(pz.kind==="patch") renderPatch();
    else if(pz.kind==="focus") renderFocus();
    else if(pz.kind==="wires") renderWires();
    else if(pz.kind==="pipes") renderPipes();
    else if(pz.kind==="picross") renderPicross();
    else renderSignal();
    return;
  }
  let h=worksIntro();
  const c=S.puz.circuit, w=S.puz.water;
  h+=`<div class="sectionlbl">Circuit salvage</div>`;
  if(c>=CIRCUIT_LEVELS.length) h+=`<div class="card grey"><div class="sysname">The board is whole</div><div class="blurb">Nothing left to route. The grid runs as well as it ever will.</div></div>`;
  else{
    const L=CIRCUIT_LEVELS[c];
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Board ${L.n}</div><button class="go" data-pz="circuit">Open</button></div>
      <div class="blurb">${L.teach}</div>
      <div class="costchips"><span class="cost">${L.loads.length} load${L.loads.length>1?"s":""}</span><span class="cost">bus gives ${L.srcMax}A</span></div>
      <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("circuit")}</div>
    </div>`;
  }
  h+=`<div class="sectionlbl">Watershed</div>`;
  if(w>=WATER_LEVELS.length) h+=`<div class="card grey"><div class="sysname">The water knows its way</div><div class="blurb">Every bed drinks, nothing scours. The land holds what falls on it.</div></div>`;
  else{
    const L=WATER_LEVELS[w];
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Season ${L.n}</div><button class="go" data-pz="water">Open</button></div>
      <div class="blurb">${L.teach}</div>
      <div class="costchips"><span class="cost">rain ${L.rain}</span><span class="cost">${L.beds.length} bed${L.beds.length>1?"s":""}</span>${L.cisternTarget?`<span class="cost">store ${L.cisternTarget}</span>`:""}</div>
      <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("water")}</div>
    </div>`;
  }
  h+=`<div class="sectionlbl">Seed frame</div>`;
  if(S.puz.seed>=SEED_LEVELS.length) h+=`<div class="card grey"><div class="sysname">The library is sorted</div><div class="blurb">Every seed catalogued, every companion known. Nothing left to arrange.</div></div>`;
  else{
    const L=SEED_LEVELS[S.puz.seed];
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Frame ${L.n}</div><button class="go" data-pz="seed">Open</button></div>
      <div class="blurb">${L.teach}</div>
      <div class="costchips"><span class="cost">${L.slots.length} slots</span><span class="cost">${Object.values(L.supply).reduce((a,b)=>a+b,0)} seeds</span></div>
      <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("seed")}</div>
    </div>`;
  }
  if(S.flags.gridTuned) h+=`<div class="sectionlbl">Grid tuned — the village draws one less, forever</div>`;
  if(S.flags.keyline)   h+=`<div class="sectionlbl">Keyline cut — the gardens drink deeper</div>`;
  if(S.flags.seedLibrary) h+=`<div class="sectionlbl">The seed library — crops keep a little better</div>`;

 h+=`<div class="sectionlbl">Spectral scans</div>`;
  if(S.puz.picross>=PICROSS_LEVELS.length) h+=`<div class="card grey"><div class="sysname">The drives are clean</div><div class="blurb">Every cache mapped. There is no more interference to resolve.</div></div>`;
  else{
    const L=PICROSS_LEVELS[S.puz.picross];
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Scan ${L.n}</div><button class="go" data-pz="picross">Open</button></div>
      <div class="blurb">${L.teach}</div>
      <div class="costchips"><span class="cost">${L.grid[0].length}x${L.grid.length} grid</span></div>
      <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("picross")}</div>
    </div>`;
  }


  h+=`<div class="sectionlbl">Patchwork &amp; insulation</div>`;
  if(S.puz.patch>=PATCH_LEVELS.length) h+=`<div class="card grey"><div class="sysname">The drafts are sealed</div><div class="blurb">Every crack packed, every pane replaced. The heat stays where it belongs.</div></div>`;
  else{
    const L=PATCH_LEVELS[S.puz.patch];
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Draft ${L.n}</div><button class="go" data-pz="patch">Open</button></div>
      <div class="blurb">${L.teach}</div>
      <div class="costchips"><span class="cost">${L.leaks.length} leaks</span><span class="cost">${Object.values(L.supply).reduce((a,b)=>a+b,0)} patches</span></div>
      <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("patch")}</div>
    </div>`;
  }
  if(S.flags.sealedTanks) h+=`<div class="sectionlbl">Tanks sealed — catchment gathers a fifth more water</div>`;
  if(S.flags.draftProof)  h+=`<div class="sectionlbl">Drafts sealed — illness is a little rarer</div>`;

  h+=`<div class="sectionlbl">Heliostat calibration</div>`;
  if(S.puz.focus>=FOCUS_LEVELS.length) h+=`<div class="card grey"><div class="sysname">The arrays are locked</div><div class="blurb">Every mirror tracks true. The field drinks every drop of light it can.</div></div>`;
  else{
    const L=FOCUS_LEVELS[S.puz.focus];
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Array ${L.n}</div><button class="go" data-pz="focus">Open</button></div>
      <div class="blurb">${L.teach}</div>
      <div class="costchips"><span class="cost">${L.budget} mirrors</span></div>
      <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("focus")}</div>
    </div>`;
  }
  if(S.flags.silveredPanels) h+=`<div class="sectionlbl">Silvered arrays — solar yields a fifth more</div>`;
  if(S.flags.thermalStore)  h+=`<div class="sectionlbl">Thermal store — solar gives a baseline trickle in the rain</div>`;

  h+=`<div class="sectionlbl">The radio</div>`;
  if(S.puz.radio>=SIGNAL_LEVELS.length) h+=`<div class="card grey"><div class="sysname">The band is tuned</div><div class="blurb">Every frequency locked in. The antenna does the rest on its own now.</div></div>`;
  else{
    const L=SIGNAL_LEVELS[S.puz.radio];
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Frequency ${L.n}</div><button class="go" data-pz="radio">Open</button></div>
      <div class="blurb">${L.teach}</div>
      <div class="costchips"><span class="cost">${L.receivers.length} receiver${L.receivers.length>1?"s":""}</span><span class="cost">${L.budget} node${L.budget>1?"s":""}</span></div>
      <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("radio")}</div>
    </div>`;
  }
  if(S.flags.radioContact) h+=`<div class="sectionlbl">The antenna reaches out — word of this place travels on its own now</div>`;

  h+=`<div class="sectionlbl">The line run</div>`;
  if((S.puz.wires||0)>=WIRES_LEVELS.length) h+=`<div class="card grey"><div class="sysname">The lines run tight</div><div class="blurb">Every joint posted true. Only a trace is lost between the turbine and the table now.</div></div>`;
  else{
    const L=WIRES_LEVELS[S.puz.wires||0];
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Run ${L.n}</div><button class="go" data-pz="wires">Open</button></div>
      <div class="blurb">${L.teach}</div>
      <div class="costchips"><span class="cost">${L.inv.reduce((a,t)=>a+t.count,0)} boards</span><span class="cost">${L.srcs.length} circuit${L.srcs.length>1?"s":""}</span></div>
      <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("wires")}</div>
    </div>`;
  }

  h+=`<div class="sectionlbl">The water mains</div>`;
  if((S.puz.pipes||0)>=PIPES_LEVELS.length) h+=`<div class="card grey"><div class="sysname">The mains hold pressure</div><div class="blurb">Every junction seated, every trench dry on the outside. Only a trace seeps away underground now.</div></div>`;
  else{
    const L=PIPES_LEVELS[S.puz.pipes||0];
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Main ${L.n}</div><button class="go" data-pz="pipes">Open</button></div>
      <div class="blurb">${L.teach}</div>
      <div class="costchips"><span class="cost">${L.cells.filter(Boolean).length} fittings</span><span class="cost">${L.cells.filter(c=>c==="K").length} standpipe${L.cells.filter(c=>c==="K").length>1?"s":""}</span></div>
      <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("pipes")}</div>
    </div>`;
  }

  $("tab-works").innerHTML=h;
  $("tab-works").querySelectorAll("[data-pz]").forEach(b=>{ b.onclick=()=>openPuzzle(b.dataset.pz); });
}

function openPuzzle(kind){
  if(kind==="circuit"){
    const L=CIRCUIT_LEVELS[S.puz.circuit];
    pz={kind, L, paths:{}, sel:L.loads[0].name};
  } else if(kind==="water") {
    const L=WATER_LEVELS[S.puz.water];
    pz={kind, L, placed:{}, sel:Object.keys(L.budget)[0], dir:"E"};
  } else if(kind==="seed") {
    const L=SEED_LEVELS[S.puz.seed];
    pz={kind, L, placed:{}, sel:Object.keys(L.supply)[0]};
  } else if(kind==="patch") {
    const L=PATCH_LEVELS[S.puz.patch];
    pz={kind, L, placed:[], sel:Object.keys(L.supply)[0], uid:1};
  } else if(kind==="focus") {
    const L=FOCUS_LEVELS[S.puz.focus];
    pz={kind, L, placed:{}};
  } else if(kind==="wires") {
    const L=WIRES_LEVELS[S.puz.wires];
    pz={kind, L, placed:{}, sel:0};
  } else if(kind==="pipes") {
    const L=PIPES_LEVELS[S.puz.pipes];
    pz={kind, L, rots:[...L.start]};
  } else if(kind==="picross") {
    const L=PICROSS_LEVELS[S.puz.picross];
    const w=L.grid[0].length;
    const h=L.grid.length;
    pz={kind, L, state: Array(h).fill().map(() => Array(w).fill(0))};
  } else {
    const L=SIGNAL_LEVELS[S.puz.radio];
    pz={kind, L, placed:{}};
  }
  renderWorks();
}
function closePuzzle(){ pz=null; renderWorks(); }

// after a commit: save and refresh, then roll straight into the next level
// of the same bench problem — unless that was the last one.
function finishPuzzle(kind){
  pz=null; store.save(S); renderAll();
  if(S.puz[kind] < PUZ_META[kind].levels.length) openPuzzle(kind);
}

function rewardPreview(kind){
  const meta=PUZ_META[kind];
  const n = S.puz[kind];
  const at = meta.reward[n+1];
  if(at) return "Solving this one: "+at.desc+".";
  const next=Object.keys(meta.reward).map(Number).filter(k=>k>n).sort((a,b)=>a-b)[0];
  return next?`Ground gained toward ${meta.noun} ${next}: ${meta.reward[next].desc}.`:"";
}
function grantReward(kind){
  const meta=PUZ_META[kind];
  const n = S.puz[kind];
  const r = meta.reward[n];
  if(!r) return "";
  const bits=[], crops=[];
  for(const [k,v] of Object.entries(r)){
    if(k==="flag"){
      S.flags[v]=true;
      if(v==="terraces") S.beds.push({crop:null,growth:0,days:0,ready:false,stored:0,fertility:75,plantedDay:0});
      continue;
    }
    if(k==="desc") continue;
    if(k==="crop"){ S.crops=S.crops||{}; S.crops[v]=true; crops.push(CROPS[v]?CROPS[v].name.toLowerCase():v); continue; }
    S.res[k]=(S.res[k]||0)+v; bits.push(`${v} ${k}`);
  }
  const parts=[];
  if(bits.length) parts.push(`the village is ${bits.join(" and ")} better off`);
  if(crops.length) parts.push(`there ${crops.length>1?"are":"are"} ${crops.join(" and ")} to plant now`);
  return parts.length?` And ${parts.join(", and ")}.`:"";
}

/* ---------- circuit UI ---------- */
function renderCircuit(){
  const L=pz.L, r=circuitCheck(L,pz.paths);
  const cellPx=Math.min(48, Math.floor((Math.min(window.innerWidth,620)-46)/L.w));
  const sel=L.loads.find(l=>l.name===pz.sel);
  const myPath=pz.paths[pz.sel]||[];
  const started=myPath.length>0;

  let h=`<div class="card">
    <div class="pzhead"><div class="sysname">Board ${L.n}</div>
      <div class="condpct ${r.overSource?'neg':''}">bus ${r.total} / ${L.srcMax}A</div></div>
    <div class="pzteach">${L.teach}</div>

    <div class="sectionlbl" style="margin:10px 0 6px">Wiring which load?</div>
    <div class="pieces">`;
  for(const ld of L.loads){
    const lit=!!r.live[ld.name];
    h+=`<button class="piece ${pz.sel===ld.name?'sel':''}" data-sel="${ld.name}">
      ${ld.name} <span style="color:var(--ink-soft)">${ld.amps}A</span>
      <span style="color:${lit?'var(--leaf)':'var(--rust)'};font-size:10px"> ${lit?"lit":ld.req?"dark · needed":"dark · optional"}</span></button>`;
  }
  h+=`</div>
    <div class="blurb">${started
      ? `Tap a neighbouring cell to extend ${pz.sel}'s run. Tap a cell already on the run to cut back to it.`
      : `Tap the <b>BUS</b> to begin ${pz.sel}'s run.`}</div>

    <div class="grid" style="grid-template-columns:repeat(${L.w},${cellPx}px)">`;

  const onMy = (x,y)=>myPath.some(c=>c[0]===x&&c[1]===y);
  for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){
    const k=cKey(x,y), capv=circuitCap(L,x,y), cur=r.map[k]||0;
    const isSrc = L.src[0]===x&&L.src[1]===y;
    const ld = L.loads.find(l=>l.p[0]===x&&l.p[1]===y);
    let cls="cell", body="", extra="";
    if(capv===0){ cls+=" blk"; }
    else if(isSrc){ cls+=" src"; body="BUS"; }
    else if(ld){
      cls+=" load"+(r.live[ld.name]?" lit":"");
      body=`<span style="font-size:9px">${ld.name}</span>`;
      extra=`<span class="amp">${ld.amps}A</span>`;
    } else if(L.junctions && L.junctions[k]!==undefined){
      const need=L.junctions[k];
      const energized = cur>=need;
      cls+= energized ? " jopen" : " jcold";
      if(cur>capv) cls+=" over";
      body = `<b>${cur}</b>`;
      extra = `<span class="cap">relay ≥${need}</span>`;
    } else {
      if(cur>capv) cls+=" over";
      else if(cur>0) cls+=" on";
      body = cur>0 ? `<b>${cur}</b>` : "";
      if(capv<99) extra=`<span class="cap">max ${capv}</span>`;
    }
    if(!isSrc && !ld && onMy(x,y)) extra+=`<span style="position:absolute;top:1px;right:2px;font-size:8px;color:var(--leaf)">●</span>`;
    h+=`<div class="${cls}" data-c="${x},${y}" style="height:${cellPx}px">${body}${extra}</div>`;
  }
  h+=`</div>`;

  let msg="", cls="pzstatus";
  if(r.solved){ msg="Every required load is lit and nothing is burning."; cls+=" good"; }
  else if(r.over.length){ msg="A cell is carrying more current than it can. It will burn."; cls+=" bad"; }
  else if(r.overSource){ msg=`The bus can only give ${L.srcMax}A. Something has to go dark.`; cls+=" bad"; }
  else if(r.coldJunctions&&r.coldJunctions.length){ msg=`A relay isn't carrying enough current to close. Route more through it.`; cls+=" bad"; }
  else if(r.missing.length){ msg=`Still dark: ${r.missing.join(", ")}.`; }
  h+=`<div class="${cls}">${msg}</div>
    <div class="pzbar">
      <button data-act="undo">Undo a step</button>
      <button data-act="drop">Unwire ${pz.sel}</button>
      <button data-act="clear">Clear the board</button>
      <button data-act="back">Leave it</button>
      ${r.solved?`<button data-act="commit" style="border-color:var(--leaf);color:var(--leaf);font-weight:600">Wire it in</button>`:""}
    </div>
    <div class="blurb" style="margin-top:9px;line-height:1.5">
      Numbers in a cell are the current running through it. Where two runs share a cell, the current <b>adds up</b>.
      <span style="opacity:.7">max n</span> is what that cell can carry before it burns. Dark cells are burnt through — nothing crosses them.
      ${L.junctions?`<br><span style="color:var(--sun)">A <b>relay</b> cell (marked <b>relay ≥n</b>) only closes when at least n current runs through it. Route enough through to wake it.</span>`:""}
    </div>
  </div>`;
  $("tab-works").innerHTML=h;

  $("tab-works").querySelectorAll("[data-sel]").forEach(b=>{ b.onclick=()=>{pz.sel=b.dataset.sel; renderCircuit();}; });
  $("tab-works").querySelectorAll("[data-c]").forEach(el=>{
    el.onclick=()=>{
      const [x,y]=el.dataset.c.split(",").map(Number);
      if(circuitCap(L,x,y)===0) return;
      const name=pz.sel;
      let p=pz.paths[name]||[];
      if(L.src[0]===x&&L.src[1]===y){ pz.paths[name]=[[x,y]]; renderCircuit(); return; }
      if(!p.length) return;
      const idx=p.findIndex(c=>c[0]===x&&c[1]===y);
      if(idx>=0){ pz.paths[name]=p.slice(0,idx+1); renderCircuit(); return; }
      const last=p[p.length-1];
      if(!circuitAdj(last,[x,y])) return;
      if(last[0]===sel.p[0] && last[1]===sel.p[1]) return;          // already arrived
      const otherLoad=L.loads.find(l=>l.name!==name && l.p[0]===x && l.p[1]===y);
      if(otherLoad) return;                                          // can't cross another terminal
      pz.paths[name]=[...p,[x,y]];
      renderCircuit();
    };
  });
  $("tab-works").querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      const a=b.dataset.act;
      if(a==="undo"){ const p=pz.paths[pz.sel]; if(p&&p.length>1) p.pop(); else delete pz.paths[pz.sel]; renderCircuit(); }
      else if(a==="drop"){ delete pz.paths[pz.sel]; renderCircuit(); }
      else if(a==="clear"){ pz.paths={}; renderCircuit(); }
      else if(a==="back"){ closePuzzle(); }
      else if(a==="commit"){
        S.puz.circuit++;
        const extra=grantReward("circuit");
        {
          const solvers=[byId("nadia"),byId("ilya")].filter(p=>p&&p.status!=="away");
          const credit = solvers.length ? solvers.map(p=>p.name).join(" and ")
                       : (bestPresent("hands") ? bestPresent("hands").name : "Somebody");
          S.pending.push(`${credit} got board ${L.n} routed, and it held.${extra}`);
        }
        finishPuzzle("circuit");
      }
    };
  });
}

/* ---------- watershed UI ---------- */
const DIRGLYPH={E:"→",W:"←",S:"↓",N:"↑"};
function waterUsed(){ const u={}; for(const v of Object.values(pz.placed)){ const k=v.split(":")[0]; u[k]=(u[k]||0)+1; } return u; }
function wetShade(v,maxv){
  if(v<=0.05) return "transparent";
  const t=Math.min(1, v/Math.max(1,maxv));
  const a=0.10+0.55*t;
  return `rgba(95,134,154,${a.toFixed(2)})`;
}
function renderWater(){
  const L=pz.L, r=waterSim(L,pz.placed), used=waterUsed();
  const cellPx=Math.min(56, Math.floor((Math.min(window.innerWidth,620)-46)/L.w));
  const maxArr=Math.max(...Object.values(r.arrive));

  let h=`<div class="card">
    <div class="pzhead"><div class="sysname">Season ${L.n}</div>
      <div class="condpct">rain ${L.rain} on every cell${L.cisternTarget?` · stored ${r.totalStored.toFixed(0)}/${L.cisternTarget}`:""}</div></div>
    <div class="pzteach">${L.teach}</div>

    <div class="banner" style="margin:8px 0 10px;font-style:normal;font-family:var(--sans);font-size:12px;line-height:1.55">
      <b>How the water moves.</b> Rain falls everywhere, then runs to whichever neighbouring cell is <b>lower</b> —
      splitting evenly if several are. The small grey number is the <b>height</b> of the ground; the big blue number is
      how much water <b>passes through</b> that cell. Arrows show where it goes next.
      Your beds sit up on the dry shoulder, so the water rushes past them into the valley. Your job is to send it their way.
      ${L.scour?"<br><b>This season:</b> a channel carrying more than 9 will scour the soil.":""}
    </div>

    <div class="sectionlbl" style="margin:0 0 6px">What to place</div>
    <div class="pieces">`;
  for(const [k,def] of Object.entries(L.budget)){
    const left=def-(used[k]||0);
    h+=`<button class="piece ${pz.sel===k?'sel':''} ${left<=0?'out':''}" data-p="${k}">${WATER_PIECES[k].name} <span style="color:var(--ink-soft)">${left} left</span></button>`;
  }
  h+=`</div><div class="blurb" style="margin-bottom:6px">${WATER_PIECES[pz.sel]?WATER_PIECES[pz.sel].blurb:""}</div>`;
  if(pz.sel==="channel"){
    h+=`<div class="sectionlbl" style="margin:6px 0 6px">Send its water…</div><div class="pieces">`;
    for(const d of ["N","W","E","S"]) h+=`<button class="piece ${pz.dir===d?'sel':''}" data-d="${d}" style="min-width:44px;text-align:center;font-size:16px">${DIRGLYPH[d]}</button>`;
    h+=`</div><div class="blurb" style="margin-bottom:6px">A channel only runs downhill. Point it uphill and it takes the lowest way instead.</div>`;
  }

  h+=`<div class="grid" style="grid-template-columns:repeat(${L.w},${cellPx}px)">`;
  for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){
    const k=cKey(x,y), piece=pz.placed[k];
    const bed=L.beds.find(b=>b.p[0]===x&&b.p[1]===y);
    const br=r.beds.find(b=>b.p[0]===x&&b.p[1]===y);
    const arr=r.arrive[k]||0;
    let cls="cell", body="", style=`height:${cellPx}px`;

    if(bed){
      cls+=" bed"+(br.drowned?" drown":br.dry?" dry":"");
      body=`<span style="font-size:9.5px;text-align:center;line-height:1.15">bed<br><b>${br.got.toFixed(0)}</b><span style="opacity:.6">/${bed.min}–${bed.max}</span></span>`;
    } else {
      style+=`;background:${wetShade(arr,maxArr)}`;
      if(piece){
        const base=piece.split(":")[0];
        const g = base==="channel"?DIRGLYPH[piece.split(":")[1]] : base==="swale"?"≈" : base==="cistern"?"▣" : "▲";
        body=`<span class="glyph" style="color:var(--ink)">${g}</span>`;
        if(r.scoured.includes(k)) cls+=" over";
      } else {
        body=`<b style="color:#2f4a58;font-size:11px">${arr>=0.5?arr.toFixed(0):""}</b>`;
      }
      if(r.flooded.includes(k)) cls+=" over";
      const out=(r.dirs[k]||[]).map(d=>DIRGLYPH[d]).join("");
      if(out && !piece) body+=`<span style="position:absolute;bottom:1px;right:2px;font-size:9px;color:#2f4a58;opacity:.75">${out}</span>`;
    }
    body+=`<span class="elev">${L.elev[y][x]}</span>`;
    h+=`<div class="${cls}" data-w="${x},${y}" style="${style}">${body}</div>`;
  }
  h+=`</div>`;

  let msg="", cls="pzstatus";
  if(r.solved){ msg="Every bed drinks its fill. Nothing floods, nothing scours."; cls+=" good"; }
  else if(r.scoured.length){ msg="A channel is carrying too much — it's cutting into the soil. Slow the water first."; cls+=" bad"; }
  else if(r.flooded.length){ msg="Water is standing where it can't get out."; cls+=" bad"; }
  else if(r.beds.some(b=>b.drowned)){ msg="A bed is drowning. Send some of that water elsewhere."; cls+=" bad"; }
  else if(r.beds.some(b=>b.dry)){ msg="A bed is still thirsty. Cut it a channel from higher ground."; }
  else if(r.totalStored<L.cisternTarget){ msg=`Store ${(L.cisternTarget-r.totalStored).toFixed(0)} more for the dry weeks.`; }
  h+=`<div class="${cls}">${msg}</div>
    <div class="pzbar">
      <button data-act="clear">Clear the ground</button>
      <button data-act="back">Leave it</button>
      ${r.solved?`<button data-act="commit" style="border-color:var(--leaf);color:var(--leaf);font-weight:600">Cut it in</button>`:""}
    </div>
    <div class="blurb" style="margin-top:9px">Tap a cell to place the selected piece; tap it again to lift it. ▲ berm · ≈ swale · ▣ cistern · arrow channel</div>
  </div>`;
  $("tab-works").innerHTML=h;

  $("tab-works").querySelectorAll("[data-p]").forEach(b=>{ b.onclick=()=>{pz.sel=b.dataset.p; renderWater();}; });
  $("tab-works").querySelectorAll("[data-d]").forEach(b=>{ b.onclick=()=>{pz.dir=b.dataset.d; renderWater();}; });
  $("tab-works").querySelectorAll("[data-w]").forEach(el=>{
    el.onclick=()=>{
      const [x,y]=el.dataset.w.split(",").map(Number);
      const k=cKey(x,y);
      if(L.beds.some(b=>b.p[0]===x&&b.p[1]===y)) return;
      if(pz.placed[k]){ delete pz.placed[k]; renderWater(); return; }
      const u=waterUsed(); const left=L.budget[pz.sel]-(u[pz.sel]||0);
      if(left<=0) return;
      pz.placed[k] = pz.sel==="channel" ? "channel:"+pz.dir : pz.sel;
      renderWater();
    };
  });
  $("tab-works").querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      const a=b.dataset.act;
      if(a==="clear"){ pz.placed={}; renderWater(); }
      else if(a==="back"){ closePuzzle(); }
      else if(a==="commit"){
        S.puz.water++;
        addRestore("aquifer", RESTORE_IN.waterLevel);   // slowing and sinking water heals the water table
        const extra=grantReward("water");
        {
          const ora=byId("ora");
          const credit = (ora && ora.status!=="away") ? "Ora"
                       : (bestPresent("green") ? bestPresent("green").name : "Somebody");
          S.pending.push(`The season's water went where it was told. ${credit} walked the swales twice, grinning.${extra}`);
        }
        finishPuzzle("water");
      }
    };
  });
}
/* ---------- seed frame UI ---------- */
const LIGHT_TINT = ["#2b2f26","#4a5340","#8a9b6e","#d8c86a"];  // 0..3, dark to bright
function seedUsed(){ const u={}; for(const id of Object.values(pz.placed)) u[id]=(u[id]||0)+1; return u; }
function renderSeed(){
  const L=pz.L, r=seedCheck(L,pz.placed), used=seedUsed();
  const cellPx=Math.min(58, Math.floor((Math.min(window.innerWidth,620)-46)/L.w));

  // which cells are in violation, for tinting
  const badLight=new Set(r.wrongLight);
  const lonely=new Set(r.lonely);
  const rivalCells=new Set();
  for(const pair of r.rivalPairs){ const [a,b]=pair.split("|"); rivalCells.add(a); rivalCells.add(b); }

  let h=`<div class="card">
    <div class="pzhead"><div class="sysname">Seed frame ${L.n}</div>
      <div class="condpct">${r.filled}/${r.total} slots</div></div>
    <div class="pzteach">${L.teach}</div>

    <div class="banner" style="margin:8px 0 10px;font-style:normal;font-family:var(--sans);font-size:12px;line-height:1.55">
      <b>Sorting the seed.</b> Each slot has a <b>light</b> value (the coloured band): a seed only takes if the light suits it.
      Some seeds are <b>companions</b> — they must sit next to a friend. Some are <b>rivals</b> — they must never touch.
      Fill every slot so light, friends and rivals all agree.
    </div>

    <div class="sectionlbl" style="margin:0 0 6px">The seeds</div>
    <div class="pieces">`;
  for(const [id,c] of Object.entries(L.supply)){
    const left=c-(used[id]||0);
    const s=SEEDLINGS[id];
    h+=`<button class="piece ${pz.sel===id?'sel':''} ${left<=0?'out':''}" data-s="${id}">
      <span style="font-size:15px">${s.glyph}</span> ${s.name} <span style="color:var(--ink-soft)">${left}</span></button>`;
  }
  h+=`</div>`;

  // selected seed's rules
  if(pz.sel){
    const s=SEEDLINGS[pz.sel];
    const comps=SEED_COMPANION.filter(p=>p.includes(pz.sel)).map(p=>p[0]===pz.sel?p[1]:p[0]).filter(pt=>(L.supply[pt]||0)>0);
    const rivs=SEED_RIVAL.filter(p=>p.includes(pz.sel)).map(p=>p[0]===pz.sel?p[1]:p[0]).filter(pt=>(L.supply[pt]||0)>0);
    h+=`<div class="blurb" style="margin-bottom:6px">
      <b>${s.name}</b> — wants light ${s.light[0]}–${s.light[1]}.
      ${comps.length?` Friends with ${comps.map(x=>SEEDLINGS[x].name.toLowerCase()).join(", ")} (needs one beside it).`:""}
      ${rivs.length?` Rivals with ${rivs.map(x=>SEEDLINGS[x].name.toLowerCase()).join(", ")} (never adjacent).`:""}
    </div>`;
  }

  // the frame grid: only slot cells are interactive; non-slot cells are blank
  h+=`<div class="grid" style="grid-template-columns:repeat(${L.w},${cellPx}px)">`;
  for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){
    const slot=seedSlotAt(L,x,y);
    const k=cKey(x,y);
    if(!slot){
      h+=`<div class="cell" style="height:${cellPx}px;background:transparent;border-color:transparent"></div>`;
      continue;
    }
    const id=pz.placed[k];
    const tint=LIGHT_TINT[slot.light];
    let ring="var(--line)";
    if(id){
      if(badLight.has(k)||rivalCells.has(k)) ring="var(--rust)";
      else if(lonely.has(k)) ring="var(--sun)";
      else ring="var(--leaf)";
    }
    const glyph = id ? `<span style="font-size:20px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5)">${SEEDLINGS[id].glyph}</span>` : "";
    h+=`<div class="cell" data-seed="${x},${y}" style="height:${cellPx}px;background:${tint};border:2px solid ${ring};cursor:pointer">
      ${glyph}
      <span style="position:absolute;top:1px;left:3px;font-size:9px;color:rgba(255,255,255,.75)">☀${slot.light}</span>
    </div>`;
  }
  h+=`</div>`;

  // status line
  let msg="", cls="pzmsg";
  if(r.solved){ msg="Every seed suits its light, sits by a friend, and clear of its rivals."; cls+=" good"; }
  else if(r.overSupply.length){ msg="You've placed more of a seed than you have."; cls+=" bad"; }
  else if(r.wrongLight.length){ msg="A seed sits in the wrong light (outlined in rust)."; cls+=" bad"; }
  else if(r.rivalPairs.length){ msg="Rivals are touching (outlined in rust). Move one apart."; cls+=" bad"; }
  else if(r.lonely.length){ msg="A seed needs a friend beside it (outlined in amber)."; }
  else if(r.empties.length){ msg=`${r.empties.length} slot${r.empties.length>1?"s":""} still empty.`; }
  h+=`<div class="${cls}" style="min-height:18px;margin-top:4px;font-size:12.5px;color:${r.solved?'var(--leaf)':cls.includes('bad')?'var(--rust)':'var(--ink-soft)'}">${msg}</div>`;

  h+=`<div class="pzbar">
      <button data-act="clear">Clear the frame</button>
      <button data-act="back">Leave it</button>
      ${r.solved?`<button data-act="commit" style="border-color:var(--leaf);color:var(--leaf);font-weight:600">Sort it in</button>`:""}
    </div>
    <div class="blurb" style="margin-top:9px">Pick a seed, then tap a slot to place it; tap a filled slot to lift it. The band colour is the slot's light.</div>
  </div>`;
  $("tab-works").innerHTML=h;

  $("tab-works").querySelectorAll("[data-s]").forEach(b=>{ b.onclick=()=>{ pz.sel=b.dataset.s; renderSeed(); }; });
  $("tab-works").querySelectorAll("[data-seed]").forEach(el=>{
    el.onclick=()=>{
      const [x,y]=el.dataset.seed.split(",").map(Number);
      const k=cKey(x,y);
      if(pz.placed[k]){ delete pz.placed[k]; renderSeed(); return; }
      if(!pz.sel) return;
      const u=seedUsed(); const left=(L.supply[pz.sel]||0)-(u[pz.sel]||0);
      if(left<=0) return;
      pz.placed[k]=pz.sel;
      renderSeed();
    };
  });
  $("tab-works").querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      const a=b.dataset.act;
      if(a==="clear"){ pz.placed={}; renderSeed(); }
      else if(a==="back"){ closePuzzle(); }
      else if(a==="commit"){
        S.puz.seed++;
        const extra=grantReward("seed");
        S.pending.push(`The seed frame is sorted — every drawer labelled, every companion noted.${extra}`);
        finishPuzzle("seed");
      }
    };
  });
}

/* ---------- radio UI ---------- */
/* ---------- signal UI (the radio) ---------- */
function renderSignal(){
  const L=pz.L, r=signalCheck(L,pz.placed);
  const cellPx=Math.min(58, Math.floor((Math.min(window.innerWidth,620)-46)/L.w));

  let h=`<div class="card">
    <div class="pzhead"><div class="sysname">Frequency ${L.n}</div>
      <div class="condpct ${r.used>L.budget?'neg':''}">${L.budget-r.used} node${(L.budget-r.used)===1?"":"s"} left</div></div>
    <div class="pzteach">${L.teach}</div>

    <div class="grid" style="grid-template-columns:repeat(${L.w},${cellPx}px)">`;

  for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){
    const k=cKey(x,y);
    const isBlk=L.blocked.some(b=>b[0]===x&&b[1]===y);
    const rec=r.recStatus.find(rc=>rc.x===x&&rc.y===y);
    const hasNode=pz.placed[k];
    const sig=r.map[k]||0;
    let cls="cell", body="", style=`height:${cellPx}px;`;
    if(sig>0 && !isBlk && !rec) style+=`background:rgba(147,164,131,${Math.min(0.8,sig*0.2)});`;
    if(isBlk && !rec){ cls+=" blk"; }
    else if(rec){
      cls+=" load"+(rec.match?" lit":rec.over?" over":"");
      body=`<span style="font-size:15px;font-weight:700">${rec.got}</span><span class="cap">/ ${rec.v}</span>`;
    } else if(hasNode){
      cls+=" on";
      body=`<span style="font-size:20px;color:var(--leaf);font-weight:700">+</span>`;
    } else if(sig>0){
      body=`<span style="font-size:11px;opacity:.45">${sig}</span>`;
    }
    h+=`<div class="${cls}" data-rx="${x},${y}" style="${style}">${body}</div>`;
  }
  h+=`</div>`;

  let msg="", mcls="pzstatus";
  if(r.solved){ msg="Every receiver is matched exactly, and no node spent past the budget."; mcls+=" good"; }
  else if(r.recStatus.some(rc=>rc.over)){ msg="Too much signal hitting a receiver (highlighted)."; mcls+=" bad"; }
  else if(r.used>L.budget){ msg=`Too many nodes out at once — only ${L.budget}.`; mcls+=" bad"; }
  else { msg=`Place ${L.budget-r.used} more node${(L.budget-r.used)===1?"":"s"} to match the targets.`; }
  h+=`<div class="${mcls}">${msg}</div>
    <div class="pzbar">
      <button data-act="clear">Clear the grid</button>
      <button data-act="back">Leave it</button>
      ${r.solved?`<button data-act="commit" style="border-color:var(--leaf);color:var(--leaf);font-weight:600">Lock the frequency</button>`:""}
    </div>
    <div class="blurb" style="margin-top:9px">Tap a space to place a node — it broadcasts to itself and the four cells around it, and overlapping fields add. Tap again to pull it up. A receiver needs its exact number, no more.</div>
  </div>`;
  $("tab-works").innerHTML=h;

  $("tab-works").querySelectorAll("[data-rx]").forEach(el=>{
    el.onclick=()=>{
      const [x,y]=el.dataset.rx.split(",").map(Number);
      const k=cKey(x,y);
      if(L.receivers.some(rc=>rc.x===x&&rc.y===y)) return;
      if(L.blocked.some(b=>b[0]===x&&b[1]===y)) return;
      if(pz.placed[k]) delete pz.placed[k];
      else { if(r.used>=L.budget) return; pz.placed[k]=true; }
      renderSignal();
    };
  });
  $("tab-works").querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      const a=b.dataset.act;
      if(a==="clear"){ pz.placed={}; renderSignal(); }
      else if(a==="back"){ closePuzzle(); }
      else if(a==="commit"){
        S.puz.radio++;
        const extra=grantReward("radio");
        S.pending.push(`The frequency locked in clean and stayed there.${extra}`);
        finishPuzzle("radio");
      }
    };
  });
}

/* ---------- patchwork UI ---------- */
// tints for laid patches, cycled by placement order. rust is deliberately
// absent — it stays reserved for the overlap/error state.
const PATCH_TINTS=[
  {line:"#44622F", bg:"rgba(68,98,47,0.20)"},    // leaf
  {line:"#4C7286", bg:"rgba(76,114,134,0.22)"},  // water
  {line:"#B88124", bg:"rgba(184,129,36,0.22)"},  // sun
  {line:"#6E5A7E", bg:"rgba(110,90,126,0.20)"},  // dusk violet
  {line:"#7D8E6C", bg:"rgba(125,142,108,0.26)"}, // moss
  {line:"#5B6770", bg:"rgba(91,103,112,0.20)"}   // slate
];
function renderPatch(){
  const L=pz.L, r=patchCheck(L,pz.placed);
  const cellPx=Math.min(50, Math.floor((Math.min(window.innerWidth,620)-46)/L.w));

  let h=`<div class="card">
    <div class="pzhead"><div class="sysname">Draft ${L.n}</div>
      <div class="condpct">${L.leaks.length-r.leaksUncovered.length}/${L.leaks.length} sealed</div></div>
    <div class="pzteach">${L.teach}</div>

    <div class="sectionlbl" style="margin:0 0 6px">The patches</div>
    <div class="pieces">`;
  for(const [id,total] of Object.entries(L.supply)){
    const left=total-(r.used[id]||0);
    h+=`<button class="piece ${pz.sel===id?'sel':''} ${left<=0?'out':''}" data-patch="${id}">${PATCH_SHAPES[id].name} <span style="color:var(--ink-soft)">${left} left</span></button>`;
  }
  h+=`</div>`;

  h+=`<div class="grid" style="grid-template-columns:repeat(${L.w},${cellPx}px)">`;
  for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){
    const k=cKey(x,y);
    const uids=r.map[k]||[];
    const isLeak=L.leaks.some(l=>l[0]===x&&l[1]===y);
    const isBlk=L.blocked.some(b=>b[0]===x&&b[1]===y);
    let cls="cell", style=`height:${cellPx}px;`;
    if(isBlk){ cls+=" blk"; }
    else if(isLeak && uids.length===0){ style+="background:#D9D2C5;box-shadow:inset 0 2px 6px rgba(168,91,56,.3);border-color:var(--rust);"; }
    else if(uids.length>0){
      cls+=" load"+(uids.length>1?" over":"");
      const myUid=uids[0];
      // each laid patch gets its own colour from the village palette;
      // overlaps skip the tint so the rust error state stays unmistakable
      if(uids.length===1){
        const t=PATCH_TINTS[(myUid-1)%PATCH_TINTS.length];
        style+=`border-color:${t.line};background:${t.bg};`;
      }
      // merge cells of the same patch into one solid piece: drop the shared
      // borders, and bleed 3px (the grid gap) up/left so the seams paint over.
      if((r.map[cKey(x,y-1)]||[]).includes(myUid)) style+=`border-top:none;margin-top:-3px;height:${cellPx+3}px;`;
      if((r.map[cKey(x,y+1)]||[]).includes(myUid)) style+="border-bottom:none;";
      if((r.map[cKey(x-1,y)]||[]).includes(myUid)) style+="border-left:none;margin-left:-3px;width:calc(100% + 3px);";
      if((r.map[cKey(x+1,y)]||[]).includes(myUid)) style+="border-right:none;";
    }
    h+=`<div class="${cls}" data-px="${x},${y}" style="${style}"></div>`;
  }
  h+=`</div>`;

  let msg="", mcls="pzstatus";
  if(r.solved){ msg="Every gap is sealed. Nothing overlaps, nothing covers a strut."; mcls+=" good"; }
  else if(r.overlaps.length){ msg="Patches are overlapping."; mcls+=" bad"; }
  else if(r.onBlocked.length){ msg="A patch covers a load-bearing strut."; mcls+=" bad"; }
  else if(r.leaksUncovered.length){ msg=`${r.leaksUncovered.length} draft${r.leaksUncovered.length>1?"s":""} still open.`; }
  h+=`<div class="${mcls}">${msg}</div>
    <div class="pzbar">
      <button data-act="clear">Strip the work</button>
      <button data-act="back">Leave it</button>
      ${r.solved?`<button data-act="commit" style="border-color:var(--leaf);color:var(--leaf);font-weight:600">Seal it</button>`:""}
    </div>
    <div class="blurb" style="margin-top:9px">Pick a patch, then tap a space to lay it down — its corner lands where you tap. Tap a laid patch to pull it back up.</div>
  </div>`;
  $("tab-works").innerHTML=h;

  $("tab-works").querySelectorAll("[data-patch]").forEach(b=>{ b.onclick=()=>{ pz.sel=b.dataset.patch; renderPatch(); }; });
$("tab-works").querySelectorAll("[data-px]").forEach(el => {
    el.onpointerdown = (e) => {
      // 1. Get cell coordinates and check for existing patch
      const [x, y] = el.dataset.px.split(",").map(Number);
      const k = cKey(x, y);
      const uids = r.map[k] || [];

      if (uids.length > 0) {
        // --- WE TAPPED AN EXISTING PATCH ---
        const myUid = uids[0];
        const patch = pz.placed.find(p => p.uid === myUid);
        if (!patch) return;

        let hasDragged = false;
        let startX = e.clientX, startY = e.clientY;
        let startPx = patch.x, startPy = patch.y;

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;

          // If the pointer moves more than 5px, transition from tap to drag
          if (!hasDragged && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
            hasDragged = true;
          }

          if (hasDragged) {
            // Calculate grid movement based on your existing cellPx variable
            const dGridX = Math.round(dx / cellPx);
            const dGridY = Math.round(dy / cellPx);
            
            // Only re-render if the grid position actually shifted
            if (patch.x !== startPx + dGridX || patch.y !== startPy + dGridY) {
              patch.x = startPx + dGridX;
              patch.y = startPy + dGridY;
              renderPatch(); // Visually update the patch during drag
            }
          }
        };

        const onUp = (ev) => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);

          if (!hasDragged) {
            // No movement = Tap. Cycle the patch variant.
            cyclePatch(myUid);
            renderPatch();
          } else {
            // Movement = Drag. Check if we dropped it off the board.
            const gridRect = $("tab-works").querySelector(".grid").getBoundingClientRect();
            const isOutside = ev.clientX < gridRect.left || ev.clientX > gridRect.right ||
                              ev.clientY < gridRect.top || ev.clientY > gridRect.bottom;
            
            if (isOutside) {
              // Delete the patch if dropped off the grid (refunds supply automatically)
              pz.placed = pz.placed.filter(p => p.uid !== myUid);
            }
            renderPatch(); // Final clean up / boundary check
          }
        };

        // Attach listeners to document so we don't drop the drag if renderPatch rewrites the DOM
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        
        // Prevent default browser dragging/text selection
        e.preventDefault(); 
        return; 
      }

      // --- WE TAPPED AN EMPTY CELL (Original Placement Logic) ---
      if (!pz.sel) return;
      const left = (L.supply[pz.sel] || 0) - (r.used[pz.sel] || 0);
      if (left <= 0) return;
      
      const def = PATCH_SHAPES[pz.sel];
      const isOOB = def.pts.some(pt => { 
        const nx = x + pt[0], ny = y + pt[1]; 
        return nx < 0 || nx >= L.w || ny < 0 || ny >= L.h; 
      });
      
      if (isOOB) return;
      
      pz.placed.push({uid: pz.uid++, shape: pz.sel, x, y});
      renderPatch();
    };
  });
  $("tab-works").querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      const a=b.dataset.act;
      if(a==="clear"){ pz.placed=[]; renderPatch(); }
      else if(a==="back"){ closePuzzle(); }
      else if(a==="commit"){
        S.puz.patch++;
        let extra=grantReward("patch");
        const targetGoal = L.leftoverGoal || 0;
        const margin = r.savedSquares - targetGoal;
        if (margin > 0) {
          const bonusScrap = margin; 
          extra += ` You saved ${margin} extra square${margin > 1 ? 's' : ''} of material, yielding ${bonusScrap} bonus scrap!`;
          S.res.scrap += bonusScrap;
        } else if (margin < 0) {
          extra += ` (You missed the goal by ${Math.abs(margin)} squares).`;
        }
        S.pending.push(`The patching is done. Another edge sealed against the winter.${extra}`);
        finishPuzzle("patch");
      }
    };
  });
}

/* ---------- focus UI (heliostat calibration) ---------- */
function renderFocus(){
  const L=pz.L, r=focusCheck(L,pz.placed);
  const srcs=focusSrcs(L), targets=focusTargets(L);
  const cellPx=Math.min(56, Math.floor((Math.min(window.innerWidth,620)-46)/L.w));
  const unlit=r.hit.filter(h=>!h).length;

  let h=`<div class="card">
    <div class="pzhead"><div class="sysname">Array ${L.n}</div>
      <div class="condpct ${r.used>L.budget?'neg':''}">${L.budget-r.used} mirror${(L.budget-r.used)===1?"":"s"} left</div></div>
    <div class="pzteach">${L.teach}</div>

    <div style="position:relative;margin:10px auto 0;width:${L.w*cellPx}px">
      
      <div class="grid" style="grid-template-columns:repeat(${L.w},${cellPx}px);margin:0;position:relative;z-index:2">`;
  for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){
    const k=cKey(x,y);
    const isSrc=srcs.some(s=>s.x===x&&s.y===y);
    const ti=targets.findIndex(t=>t.x===x&&t.y===y);
    const isBlk=L.blocked.some(b=>b[0]===x&&b[1]===y);
    const mirror=pz.placed[k];
    let cls="cell", body="", style=`height:${cellPx}px;`;
    if(isBlk){ cls+=" blk"; }
    else if(isSrc){ cls+=" src"; body="☀"; style+="font-size:18px;"; }
    else if(ti>=0){
      cls+=" load"+(r.hit[ti]?" lit":"");
      body=targets[ti].pass?"◇":"▣";
      style+="font-size:18px;";
    }
    else if(mirror){ body=`<span style="font-size:22px;font-weight:700;color:var(--ink)">${mirror}</span>`; }
    h+=`<div class="${cls}" data-fx="${x},${y}" style="${style}">${body}</div>`;
  }
  h+=`<svg style="position:absolute;inset:0;z-index:1;pointer-events:none" width="${L.w*cellPx}" height="${L.h*cellPx}">
        ${r.beams.map(pts=>`<polyline points="${pts.map(p=>`${p[0]*cellPx+cellPx/2},${p[1]*cellPx+cellPx/2}`).join(" ")}"
          stroke="var(--sun)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"
          style="filter:drop-shadow(0 0 4px var(--sun))"/>`).join("")}
      </svg></div></div>`;

  let msg="", mcls="pzstatus";
  if(r.solved){ msg="The light connects. The array hums."; mcls+=" good"; }
  else if(r.hitTarget && r.used>L.budget){ msg="Connected, but with too many mirrors."; mcls+=" bad"; }
  else if(r.used>L.budget){ msg="Out of mirrors."; mcls+=" bad"; }
  else if(unlit){ msg=`${unlit} of ${targets.length} still dark. ${L.budget-r.used} mirror${(L.budget-r.used)===1?"":"s"} left to place.`; }
  else { msg=`${L.budget-r.used} mirror${(L.budget-r.used)===1?"":"s"} left to place.`; }
  h+=`<div class="${mcls}" style="margin-top:12px">${msg}</div>
    <div class="pzbar">
      <button data-act="clear">Clear the field</button>
      <button data-act="back">Leave it</button>
      ${r.solved?`<button data-act="commit" style="border-color:var(--leaf);color:var(--leaf);font-weight:600">Lock the alignment</button>`:""}
    </div>
    <div class="blurb" style="margin-top:9px">Tap a space to place a mirror (/). Tap again to flip it (\\). Tap a third time to clear it.${targets.some(t=>t.pass)?` A lens (◇) must catch the light, but the beam runs on through it; a boiler (▣) drinks the beam where it lands.`:""}</div>
  </div>`;
  $("tab-works").innerHTML=h;

  $("tab-works").querySelectorAll("[data-fx]").forEach(el=>{
    el.onclick=()=>{
      const [x,y]=el.dataset.fx.split(",").map(Number);
      const k=cKey(x,y);
      if(srcs.some(s=>s.x===x&&s.y===y)) return;
      if(targets.some(t=>t.x===x&&t.y===y)) return;
      if(L.blocked.some(b=>b[0]===x&&b[1]===y)) return;
      if(!pz.placed[k]) pz.placed[k]="/";
      else if(pz.placed[k]==="/") pz.placed[k]="\\";
      else delete pz.placed[k];
      renderFocus();
    };
  });
  $("tab-works").querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      const a=b.dataset.act;
      if(a==="clear"){ pz.placed={}; renderFocus(); }
      else if(a==="back"){ closePuzzle(); }
      else if(a==="commit"){
        S.puz.focus++;
        const extra=grantReward("focus");
        S.pending.push(`The array is aligned. Sunlight hits the boiler squarely.${extra}`);
        finishPuzzle("focus");
      }
    };
  });
}







/* ---------- the line run (wires) UI ---------- */
// posts, clockwise from top-left, as x,y fractions of the cell
const WIRE_POST = [[1/3,0],[2/3,0],[1,1/3],[1,2/3],[2/3,1],[1/3,1],[0,2/3],[0,1/3]];
const WIRE_COLORS = {k:"var(--ink)", r:"var(--rust)", b:"#3d6b8a"};

function wireTileSVG(wires, rot, px, opts={}){
  let h=`<svg width="${px}" height="${px}" viewBox="0 0 48 48" style="display:block">`;
  h+=`<rect x="1" y="1" width="46" height="46" rx="5" fill="${opts.bg||"var(--card)"}" stroke="var(--line)"/>`;
  for(const w of wires){
    const a=WIRE_POST[wireRot(w.a,rot)], b=WIRE_POST[wireRot(w.b,rot)];
    const [ax,ay]=[a[0]*48,a[1]*48], [bx,by]=[b[0]*48,b[1]*48];
    h+=`<path d="M ${ax} ${ay} Q 24 24 ${bx} ${by}" fill="none" stroke="${WIRE_COLORS[w.c]||"var(--ink)"}" stroke-width="3.4" stroke-linecap="round"/>`;
    h+=`<circle cx="${ax}" cy="${ay}" r="2.6" fill="${WIRE_COLORS[w.c]}"/><circle cx="${bx}" cy="${by}" r="2.6" fill="${WIRE_COLORS[w.c]}"/>`;
  }
  return h+"</svg>";
}
function wireTermSVG(t, px, kindLabel){
  const p=WIRE_POST[t.node];
  let h=`<svg width="${px}" height="${px}" viewBox="0 0 48 48" style="display:block">`;
  h+=`<rect x="1" y="1" width="46" height="46" rx="5" fill="var(--paper-deep)" stroke="var(--ink)"/>`;
  h+=`<path d="M ${p[0]*48} ${p[1]*48} L 24 24" fill="none" stroke="${WIRE_COLORS[t.c]}" stroke-width="3.4" stroke-linecap="round"/>`;
  h+=`<circle cx="24" cy="24" r="7" fill="${kindLabel==="src"?WIRE_COLORS[t.c]:"var(--card)"}" stroke="${WIRE_COLORS[t.c]}" stroke-width="2.5"/>`;
  return h+"</svg>";
}

function renderWires() {
  const L = pz.L;
  const r = wiresCheck(L, pz.placed);
  const cellPx = Math.min(52, Math.floor((Math.min(window.innerWidth, 620) - 46) / L.w));
  const remaining = L.inv.map((t, i) => t.count - Object.values(pz.placed).filter(p => p.inv === i).length);

  let h = `<div class="card">
    <div class="pzhead"><div class="sysname">Run ${L.n}</div>
      <div class="condpct">${Object.entries(r.fedByColor).map(([c, ok]) => `${c === "k" ? "black" : c === "r" ? "red" : "blue"} ${ok ? "live" : "dead"}`).join(" · ")}</div></div>
    <div class="pzteach">${L.teach}</div>
    <div class="sectionlbl" style="margin:10px 0 6px">Boards on the bench</div>
    <div class="pieces">`;

  L.inv.forEach((t, i) => {
    h += `<button class="piece ${pz.sel === i ? 'sel' : ''} ${remaining[i] <= 0 ? 'out' : ''}" data-sel="${i}">
      ${wireTileSVG(t.wires, 0, 34)}<span>${t.name} ×${remaining[i]}</span></button>`;
  });

  h += `</div>
    <div class="blurb">Tap an empty cell to set the selected board. Tap a placed board to turn it a quarter. Tap it while holding nothing left to pick it back up — or use Clear.</div>
    <div class="grid" style="grid-template-columns:repeat(${L.w},${cellPx}px)">`;

  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    const src = L.srcs.find(t => t.x === x && t.y === y), snk = L.sinks.find(t => t.x === x && t.y === y);
    const blocked = L.blocks.some(([bx, by]) => bx === x && by === y);
    const pl = pz.placed[`${x},${y}`];
    let inner = "", cls = "cell";
    if (src) inner = wireTermSVG(src, cellPx, "src");
    else if (snk) inner = wireTermSVG(snk, cellPx, "sink");
    else if (blocked) { cls += " blockcell"; inner = ""; }
    else if (pl) inner = wireTileSVG(L.inv[pl.inv].wires, pl.rot, cellPx);
    h += `<div class="${cls}" data-cell="${x},${y}" style="width:${cellPx}px;height:${cellPx}px;padding:0">${inner}</div>`;
  }

  h += `</div>
    ${r.mismatches.length ? `<div class="warnline">Somewhere a red post meets a black one. Nothing conducts across a mismatched joint.</div>` : ""}
    <div class="btnrow" style="margin-top:10px">
      <button data-act="clear">Clear</button>
      <button data-act="back">Put it down</button>
      ${r.solved ? `<button data-act="commit" style="border-color:var(--leaf);color:var(--leaf);font-weight:600">Energize the run</button>` : ""}
    </div>
    <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview("wires")}</div>
  </div>`;

  $("tab-works").innerHTML = h;

  // 1. Bind Selection Buttons
  $("tab-works").querySelectorAll("[data-sel]").forEach(b => {
    b.onclick = () => { pz.sel = +b.dataset.sel; renderWires(); };
  });

  // 2. Bind Grid Interactions (Drag/Swap/Rotate)
  $("tab-works").querySelectorAll("[data-cell]").forEach(el => {
    el.onpointerdown = (e) => {
      const [x, y] = el.dataset.cell.split(",").map(Number);
      const key = `${x},${y}`;

      if (L.srcs.some(t => t.x === x && t.y === y) || L.sinks.some(t => t.x === x && t.y === y) || L.blocks.some(([bx, by]) => bx === x && by === y)) return;

      el.setPointerCapture(e.pointerId);

      const onPointerUp = (ev) => {
        el.releasePointerCapture(ev.pointerId);
        const targetEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-cell]");
        const gridRect = $("tab-works").querySelector(".grid").getBoundingClientRect();
        const isOutside = ev.clientX < gridRect.left || ev.clientX > gridRect.right || ev.clientY < gridRect.top || ev.clientY > gridRect.bottom;

        if (isOutside) {
          delete pz.placed[key];
        } else if (targetEl) {
          const [tx, ty] = targetEl.dataset.cell.split(",").map(Number);
          const targetKey = `${tx},${ty}`;
          if (targetKey !== key) {
            const sourcePiece = pz.placed[key];
            const targetPiece = pz.placed[targetKey];
            pz.placed[targetKey] = sourcePiece;
            if (targetPiece) pz.placed[key] = targetPiece;
            else delete pz.placed[key];
          } else {
            if (pz.placed[key]) pz.placed[key].rot = (pz.placed[key].rot + 1) % 4;
            else if (pz.sel != null && remaining[pz.sel] > 0) pz.placed[key] = { inv: pz.sel, rot: 0 };
          }
        }
        renderWires();
        el.removeEventListener("pointerup", onPointerUp);
      };
      el.addEventListener("pointerup", onPointerUp);
    };
  });

  // 3. Bind Footer Buttons
  $("tab-works").querySelectorAll("[data-act]").forEach(b => {
    b.onclick = () => {
      const a = b.dataset.act;
      if (a === "clear") { pz.placed = {}; renderWires(); }
      else if (a === "back") { closePuzzle(); }
      else if (a === "commit") {
        S.puz.wires++;
        const extra = grantReward("wires");
        const solver = bestPresent("hands");
        S.pending.push(`${solver ? solver.name : "Somebody"} energized run ${L.n}, and the meter barely dips now.${extra}`);
        finishPuzzle("wires");
      }
    };
  });
}

/* ---------- the water mains (pipes) UI ---------- */
const PIPE_GLYPH = {
  I:["│","─","│","─"],
  L:["└","┌","┐","┘"],
  T:["┴","├","┬","┤"],
  X:["┼","┼","┼","┼"],
  S:["▲","▶","▼","◀"],
  K:["◍","◍","◍","◍"]
};
function renderPipes() {
  const L = pz.L;
  
  // Safety check: ensure rotation array exists and matches the grid size
  if (!pz.rots || pz.rots.length !== L.cells.length) {
    pz.rots = new Array(L.cells.length).fill(0);
  }

  // Now we safely pass the rots array to your check function!
  const r = pipesCheck(L, pz.rots); 
  const cellPx = Math.min(52, Math.floor((Math.min(window.innerWidth, 620) - 46) / L.w));

  let h = `<div class="card">
    <div class="pzhead">
      <div class="sysname">Main ${L.n}</div>
      <div class="condpct">${r.leaks > 0 ? `${r.leaks} spilling` : (r.solved ? "Pressurized" : "Dry")}</div>
    </div>
    <div class="pzteach">${L.teach || ""}</div>
    <div class="blurb">Tap a pipe to turn it. Direct the water to every standpipe.</div>
    <div class="grid" style="grid-template-columns:repeat(${L.w},${cellPx}px)">`;

  // Draw the grid using L.cells directly
  for (let y = 0; y < L.h; y++) {
    for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      const type = L.cells[i];
      const isLive = r.seen && (r.seen.has ? r.seen.has(i) : r.seen.includes(i));
      
      let inner = "", cls = "cell";
      
      if (type === "S") {
        inner = pipeTermSVG("src", cellPx, true); // Source is always blue
      } else if (type === "K") {
        inner = pipeTileSVG("K", pz.rots[i], cellPx, isLive); // Standpipes can rotate
      } else if (type && type !== ".") {
        inner = pipeTileSVG(type, pz.rots[i], cellPx, isLive); // Standard pipes
      } else {
        cls += " blockcell"; // Empty space
      }

      h += `<div class="${cls}" data-idx="${i}" style="width:${cellPx}px;height:${cellPx}px;padding:0">${inner}</div>`;
    }
  }

  h += `</div>
    ${r.leaks ? `<div class="warnline">Water is spilling from open pipes! Cap them or connect them.</div>` : ""}
    <div class="btnrow" style="margin-top:10px">
      <button data-act="back">Put it down</button>
      ${r.solved ? `<button data-act="commit" style="border-color:#3b82f6;color:#3b82f6;font-weight:600">Open the valve</button>` : ""}
    </div>
  </div>`;

  $("tab-works").innerHTML = h;

  // 1. Bind Tapping (Rotation only, no dragging!)
  $("tab-works").querySelectorAll("[data-idx]").forEach(el => {
    el.onpointerdown = () => {
      const i = parseInt(el.dataset.idx);
      const type = L.cells[i];
      
      // Only rotate actual pipes and the K standpipe. (Don't rotate S or empty blocks).
      if (type && type !== "." && type !== "S") {
        pz.rots[i] = (pz.rots[i] + 1) % 4;
        renderPipes();
      }
    };
  });

  // 2. Bind Footer Buttons
  $("tab-works").querySelectorAll("[data-act]").forEach(b => {
    b.onclick = () => {
      const a = b.dataset.act;
      if (a === "back") { closePuzzle(); }
      else if (a === "commit") {
        S.puz.pipes++;
        // Replace with your actual reward/commit logic
        finishPuzzle("pipes"); 
      }
    };
  });
}
function pipeTileSVG(type, rot, size, isLive = false) {
  const thickness = 28;
  const stateClass = isLive ? "pipe-live" : "pipe-dead";
  
  const paths = {
    "I": `<path d="M50,0 L50,100" fill="none" stroke="currentColor" stroke-width="${thickness}" />`,
    "L": `<path d="M50,0 L50,50 L100,50" fill="none" stroke="currentColor" stroke-width="${thickness}" stroke-linejoin="miter"/>`,
    "T": `<path d="M0,50 L100,50 M50,0 L50,50" fill="none" stroke="currentColor" stroke-width="${thickness}" />`,
    "X": `<path d="M0,50 L100,50 M50,0 L50,100" fill="none" stroke="currentColor" stroke-width="${thickness}" />`,
    
    // "K" Directional Standpipe
    "K": `<path d="M50,50 L50,0" fill="none" stroke="currentColor" stroke-width="${thickness}" />
          <circle cx="50" cy="50" r="22" fill="currentColor" />
          <circle cx="50" cy="50" r="10" fill="var(--bg, #111)" />
          <rect x="25" y="55" width="50" height="12" rx="6" fill="currentColor" />
          <rect x="44" y="50" width="12" height="15" fill="currentColor" />`
  };

  // Default to "X" (the cross) if an unknown type is passed
  const svgContent = paths[type] || paths["X"];
  const rotation = rot * 90;
  
  return `<svg class="${stateClass}" width="${size}" height="${size}" viewBox="0 0 100 100" 
          style="transform: rotate(${rotation}deg); display: block; transition: transform 0.15s ease-out;">
            ${svgContent}
          </svg>`;
}
function pipeTermSVG(type, size, isLive = false) {
  // type is "src" (pump) or "sink" (drain)
  const isSrc = type === "src";
  const color = (isSrc || isLive) ? "#3b82f6" : "#444444"; // Always blue for source. Blue for sink only if solved.

  if (isSrc) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" style="display: block;">
      <polygon points="50,10 90,30 90,70 50,90 10,70 10,30" fill="none" stroke="${color}" stroke-width="8"/>
      <circle cx="50" cy="50" r="22" fill="${color}" />
      <line x1="50" y1="10" x2="50" y2="28" stroke="${color}" stroke-width="8" />
      <line x1="50" y1="72" x2="50" y2="90" stroke="${color}" stroke-width="8" />
      <line x1="15" y1="50" x2="28" y2="50" stroke="${color}" stroke-width="8" />
      <line x1="72" y1="50" x2="85" y2="50" stroke="${color}" stroke-width="8" />
    </svg>`;
  } else {
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" style="display: block;">
      <rect x="15" y="15" width="70" height="70" rx="12" fill="none" stroke="${color}" stroke-width="10"/>
      <line x1="30" y1="15" x2="30" y2="85" stroke="${color}" stroke-width="8" />
      <line x1="50" y1="15" x2="50" y2="85" stroke="${color}" stroke-width="8" />
      <line x1="70" y1="15" x2="70" y2="85" stroke="${color}" stroke-width="8" />
    </svg>`;
  }
}
/* ================= SPECTRAL SCANS UI ================= */

// Temporary state to hold the player's current puzzle progress
let currentPicrossState = null;
let currentPicrossTarget = null;

export function renderPicross() {
  const L = pz.L;
  const { rowClues, colClues } = generatePicrossClues(L.grid);
  
  let h = `<div class="puzzle-header">
    <h3>Scan ${L.n}</h3>
    <div class="sub">${L.teach}</div>
    <div style="margin-top:8px">
      <button class="go" data-act="back">Leave it</button>
    </div>
  </div>`;
  
  // ADDED: The Mode Toggle for Mobile
  h += `<div class="picross-controls">
    <button class="go ${picrossMode === 1 ? 'active' : ''}" id="pmode-fill">■ Fill</button>
    <button class="go ${picrossMode === 2 ? 'active' : ''}" id="pmode-cross">× Mark</button>
  </div>`;

  h += `<div class="picross-board">`;
  
  h += `<div class="top-clues">`;
  colClues.forEach(clue => { h += `<div>${clue.join("<br>")}</div>`; });
  h += `</div>`;
  
  h += `<div class="left-clues">`;
  rowClues.forEach(clue => { h += `<div>${clue.join(" ")}</div>`; });
  h += `</div>`;
  
  h += `<div class="puzzle-grid" id="p-grid">`;
  for (let r = 0; r < L.grid.length; r++) {
    for (let c = 0; c < L.grid[0].length; c++) {
      const st = pz.state[r][c];
      const cls = st === 1 ? " filled" : st === 2 ? " crossed" : "";
      h += `<div class="puzzle-cell${cls}" data-px="${r},${c}"></div>`;
    }
  }
  h += `</div></div>`;
  h += `<div class="blurb" style="margin-top:16px;text-align:center;">Drag to paint. Desktop: right-click to mark.</div>`;
  
  $("tab-works").innerHTML = h;

  // Setup UI Buttons
  $("tab-works").querySelector("[data-act='back']").onclick = closePuzzle;
  
  $("pmode-fill").onclick = () => { picrossMode = 1; renderPicross(); };
  $("pmode-cross").onclick = () => { picrossMode = 2; renderPicross(); };

  // Setup Drag-to-Paint Logic
  attachPicrossDragEvents();
}

function attachPicrossDragEvents() {
  const grid = document.getElementById("p-grid");
  
  // Stop right clicks from opening the browser menu anywhere on the grid
  grid.oncontextmenu = e => e.preventDefault();

  grid.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".puzzle-cell");
    if (!cell) return;

    e.preventDefault(); // Stop text highlighting/scrolling
    grid.setPointerCapture(e.pointerId); // Lock events to the grid even if finger slides off
    
    picrossDragging = true;
    const [r, c] = cell.dataset.px.split(",").map(Number);
    
    // Determine target state based on desktop right-click OR mobile mode toggle
    const isRightClick = e.button === 2;
    const activeMode = isRightClick ? 2 : picrossMode;

    // If we click on a cell that is ALREADY the active mode, we want to erase instead
    picrossPaintState = pz.state[r][c] === activeMode ? 0 : activeMode;

    applyPicrossPaint(r, c, picrossPaintState);
  });

  grid.addEventListener("pointermove", (e) => {
    if (!picrossDragging) return;
    
    // On touch screens, pointermove fires on the ORIGINAL element touched.
    // We must use elementFromPoint to find out what cell the finger is CURRENTLY hovering over.
    const hoveredEl = document.elementFromPoint(e.clientX, e.clientY);
    const cell = hoveredEl ? hoveredEl.closest(".puzzle-cell") : null;
    
    if (cell && grid.contains(cell)) {
      const [r, c] = cell.dataset.px.split(",").map(Number);
      applyPicrossPaint(r, c, picrossPaintState);
    }
  });

  // End drag when lifting finger/mouse OR sliding off the screen completely
  const stopDrag = (e) => {
    if (picrossDragging) {
      picrossDragging = false;
      grid.releasePointerCapture(e.pointerId);
      checkPicrossWin(); // Check for a win only when they finish a drag stroke
    }
  };
  
  grid.addEventListener("pointerup", stopDrag);
  grid.addEventListener("pointercancel", stopDrag);
}

// Helper: Applies paint and updates UI instantly without a full re-render
function applyPicrossPaint(r, c, targetState) {
  if (pz.state[r][c] !== targetState) {
    pz.state[r][c] = targetState;
    const cell = document.querySelector(`.puzzle-cell[data-px="${r},${c}"]`);
    if (cell) {
      cell.className = "puzzle-cell" + (targetState === 1 ? " filled" : targetState === 2 ? " crossed" : "");
    }
  }
}

function handlePicrossClick(el, actionType) {
  const [r, c] = el.dataset.px.split(",").map(Number);
  
  // Toggle logic: if already this type, set to 0, else set to actionType
  pz.state[r][c] = pz.state[r][c] === actionType ? 0 : actionType;
  renderPicross(); // Re-render to update classes
  checkPicrossWin();
}

function checkPicrossWin() {
  const L = pz.L;
  const isWin = L.grid.every((row, r) => 
    row.every((val, c) => (val === 1 ? pz.state[r][c] === 1 : pz.state[r][c] !== 1))
  );

  if (isWin) {
    S.pending.push(L.rewardText);
    
    // Apply reward (e.g., if level yields parts)
    if (L.parts) S.res.parts += L.parts;
    
    // Advance progress
    S.puz.picross++;
    closePuzzle();
  }
}




export { closePuzzle, openPuzzle, renderWorks, setPz };
