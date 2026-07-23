import { PUZ_META, FOURIER_LEVELS, FOURIER_REWARD, PATCH_LEVELS, PATCH_REWARD, PATCH_SHAPES, PATCH_VARIANTS, PIPES_LEVELS, PIPES_REWARD, SEEDLINGS, SEED_COMPANION, SEED_LEVELS, SEED_REWARD, SEED_RIVAL, WATER_LEVELS, WATER_PIECES, WATER_REWARD, WIRES_LEVELS, WIRES_REWARD, PICROSS_LEVELS, PICROSS_REWARD } from "./data-puzzles.js";
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

/* which tab each puzzle lives on — boards render into their host tab, and
   entry cards are requested by that tab's render */
const PUZ_TAB = {
  water:"water", pipes:"water",
  seed:"food",
  wires:"power",
  patch:"village",
  picross:"beyond", fourier:"beyond"
};
const puzHost = () => $("tab-" + (PUZ_TAB[pz.kind] || "works"));

const PUZ_TITLES = {
  water:"Watershed", seed:"The seed frames", patch:"Patchwork — sealing the Commons",
  wires:"The long wires", pipes:"The water mains", picross:"The scanner", fourier:"The radio"
};
const PUZ_DONE = {
  water:"The water knows its way. Every bed drinks, nothing scours.",
  seed:"Every frame is sown and sorted. The library holds.",
  patch:"The Commons is as tight as patchwork gets.",
  wires:"The lines run almost tight — only a trace is lost.",
  pipes:"The mains run almost tight — only a trace is lost underground.",
  picross:"Nothing left on the scanner worth digging for. For now.",
  fourier:"The band is mapped. Someone out there answers."
};

/* an entry card for one puzzle, for its host tab's render */
function puzzleEntryCard(kind){
  const meta = PUZ_META[kind];
  if(!meta) return "";
  const n = S.puz[kind] || 0;
  if(n >= meta.levels.length)
    return `<div class="card grey"><div class="card-top"><div class="sysname">${PUZ_TITLES[kind]}</div></div><div class="blurb">${PUZ_DONE[kind]}</div></div>`;
  const L = meta.levels[n];
  return `<div class="card">
    <div class="card-top"><div class="sysname">${PUZ_TITLES[kind]} — ${cap1(meta.noun)} ${L.n}</div><button class="go" data-pz="${kind}">Open</button></div>
    <div class="blurb">${L.teach}</div>
    <div class="blurb" style="margin-top:6px;color:var(--leaf)">${rewardPreview(kind)}</div>
  </div>`;
}
const cap1 = w => w.charAt(0).toUpperCase()+w.slice(1);
function bindPuzzleEntries(el){
  el.querySelectorAll("[data-pz]").forEach(b=>{ b.onclick=()=>openPuzzle(b.dataset.pz); });
}

/* paints the open puzzle's board into its host tab. Each tab's render calls
   this first and stops if it painted — the board replaces the tab content,
   exactly as it used to replace tab-works. */
function renderOpenPuzzle(tabId){
  if(!pz) return false;
  if(PUZ_TAB[pz.kind] !== tabId) return false;
  if(pz.kind==="water") renderWater();
  else if(pz.kind==="seed") renderSeed();
  else if(pz.kind==="patch") renderPatch();
  else if(pz.kind==="wires") renderWires();
  else if(pz.kind==="pipes") renderPipes();
  else if(pz.kind==="picross") renderPicross();
  else if(pz.kind==="fourier") renderFourier();
  else return false;
  return true;
}

function cyclePatch(uid) {
  const patch = pz.placed.find(p => p.uid === uid);
  if (!patch) return;
  
  const variants = PATCH_VARIANTS[patch.shape] || [patch.shape];
  if (variants.length < 2) return;  // no variants
  
  const idx = variants.indexOf(patch.shape);
  patch.shape = variants[(idx + 1) % variants.length];
}

function openPuzzle(kind){
  if(kind==="water") {
    const L=WATER_LEVELS[S.puz.water];
    pz={kind, L, placed:{}, sel:Object.keys(L.budget)[0], dir:"E"};
  } else if(kind==="seed") {
    const L=SEED_LEVELS[S.puz.seed];
    pz={kind, L, placed:{}, sel:Object.keys(L.supply)[0]};
  } else if(kind==="patch") {
    const L=PATCH_LEVELS[S.puz.patch];
    pz={kind, L, placed:[], sel:Object.keys(L.supply)[0], uid:1};
  } else if(kind==="fourier") {
    const L=FOURIER_LEVELS[S.puz.fourier];
    pz={kind, L, amps:L.amps.map(()=>0)};
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
    return;   // unknown kind — retired puzzles land here harmlessly
  }
  renderAll();   // the host tab repaints and finds pz open
}
function closePuzzle(){ pz=null; renderAll(); }

function showPuzzleComplete(rewardsArray, onContinue) {
  const overlay = document.createElement("div");
  overlay.className = "victory-overlay";

  // Build the list of rewards
  let rewardsHTML = "";
  if (rewardsArray && rewardsArray.length > 0) {
    const listItems = rewardsArray.map(r => `<li>${r}</li>`).join("");
    rewardsHTML = `
      <div style="font-size: 0.9em; color: #a3a3a3; text-align: left; padding-left: 5px;">You earned:</div>
      <ul class="victory-rewards">
        ${listItems}
      </ul>`;
  } else {
    rewardsHTML = `<p style="color: #a3a3a3; margin: 15px 0;">Great job getting everything connected!</p>`;
  }

  // Inject the sunflowers and the modal into the overlay
  overlay.innerHTML = `
    <!-- The sunflowers sprout in the background of the overlay -->
    ${sunflowerCelebration()}
    
    <!-- The modal box sits on top -->
    <div class="victory-modal" style="position: relative; z-index: 100;">
      <h2>System Online!</h2>
      ${rewardsHTML}
      <button class="victory-btn">Awesome</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector(".victory-btn").onclick = () => {
    overlay.remove();
    if (onContinue) onContinue();
  };
}
// after a commit: save and refresh, then roll straight into the next level
// of the same bench problem — unless that was the last one.
function finishPuzzle(kind) {
  const meta = PUZ_META[kind];
  const n = S.puz[kind];
  const r = meta.reward[n]; // Pull the specific rewards for this level
  const L = pz.L || meta.levels[n]; // Get the current level data

  // 1. Build the list of rewards for the Victory Modal
  const myRewards = [];
  
  // If the PUZ_META reward block has a description, use it
  if (r && r.desc) {
    myRewards.push(r.desc);
  }
  
  // If the level itself has raw rewards (like Picross parts or rewardText)
  if (L.rewardText) myRewards.push(L.rewardText);
  // only the generic line when the level didn't already say it in its own words
  if (L.parts && !L.rewardText && (!r || !r.parts)) myRewards.push(`Recovered +${L.parts} parts`);

  // 2. Show the modal
  showPuzzleComplete(myRewards, () => {
    
    // ==========================================
    // STATE MUTATION (Happens AFTER clicking "Awesome")
    // ==========================================
    
    // A. Apply the specific PUZ_META rewards (from your original grantReward logic)
    if (r) {
      for (const [k, v] of Object.entries(r)) {
        if (k === "desc") continue;
        
        if (k === "flag") {
          S.flags[v] = true;
          // Special logic for watershed terraces
          if (v === "terraces") {
            S.beds.push({crop: null, growth: 0, days: 0, ready: false, stored: 0, fertility: 75, plantedDay: 0});
          }
        } 
        else if (k === "crop") {
          S.crops = S.crops || {};
          S.crops[v] = true;
        } 
        else {
          // Standard resource increments (parts, seeds)
          S.res[k] = (S.res[k] || 0) + v;
        }
      }
    }

    // B. Apply base level rewards (for modules like Picross that define parts on the level itself)
    if (L.parts && (!r || !r.parts)) {
      S.res.parts = (S.res.parts || 0) + L.parts;
    }

    // C. Advance the puzzle progress counter
    S.puz[kind]++;

    // D. Clean up, save to database, and re-render the screen
    pz = null; 
    store.save(S); 
    renderAll();
    
    // E. Roll straight into the next level of this bench problem, if one exists
    if (S.puz[kind] < meta.levels.length) {
      openPuzzle(kind);
    }
  });
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
function sunflowerCelebration() {
  let html = `<div class="puzzle-celebration">`;

  // 1. Dynamic Density: Target one flower roughly every 40 pixels of screen width
  const screenWidth = window.innerWidth;
  const numFlowers = Math.max(4, Math.floor(screenWidth / 40)); 
  const segmentWidth = 100 / numFlowers; 

  // Dynamically generate the 12 petals once to save string space
  let petals = '';
  for (let i = 0; i < 12; i++) {
    petals += `<ellipse cx="50" cy="22" rx="7" ry="20" fill="#fbbf24" transform="rotate(${i * 30} 50 50)" />`;
  }

  // The core SVG for the flower head
  const headSVG = `
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      ${petals}
      <circle cx="50" cy="50" r="22" fill="#78350f" />
      <circle cx="50" cy="50" r="16" fill="none" stroke="#522504" stroke-width="3" stroke-dasharray="2 4" />
    </svg>
  `;

  // Build the garden organically
  for (let i = 0; i < numFlowers; i++) {
    const jitter = Math.random() * (segmentWidth * 0.6); 
    const left = (i * segmentWidth) + jitter;
    
    const height = Math.floor(Math.random() * 75) + 20; 
    
    const stalkDelay = 0;
    const headDelay = 0.3 + height/500 + Math.random()/10;
    const leafDelay = 0.2 + Math.random()/10;

    // Randomly decide if this flower leans left or right for leaf placement variety
    const flipLeaf = i % 2 === 0;
    
    // Leaf styling common variables
    const leafCommon = `position: absolute; width: 22px; height: 10px; background: #15803d; border-radius: 0 100% 0 100%; opacity: 0; animation: bloom-leaf 0.4s ease-out ${leafDelay}s forwards;`;
    
    // Left leaf style & position (placed around 40% down the stalk)
    const leftLeaf = flipLeaf 
      ? `${leafCommon} top: 40%; left: -18px; transform-origin: right center; transform: rotate(-25deg);` 
      : `${leafCommon} top: 40%; right: -18px; transform-origin: left center; transform: scaleX(-1) rotate(-25deg);`;

    // Right leaf style & position (placed around 70% down the stalk, mirrored)
    const rightLeaf = flipLeaf 
      ? `${leafCommon} top: 70%; right: -18px; transform-origin: left center; transform: scaleX(-1) rotate(15deg);` 
      : `${leafCommon} top: 70%; left: -18px; transform-origin: right center; transform: rotate(15deg);`;

    html += `
      <div style="position: absolute; bottom: 0; left: ${left}%; height: ${height}%; width: 8px;">
        
        <!-- The Stalk -->
        <div style="width: 100%; height: 100%; background: #16a34a; border-radius: 4px; 
                    transform-origin: bottom center; transform: scaleY(0); 
                    animation: grow-stalk 0.6s ease-out ${stalkDelay}s forwards;">
          
          <!-- Leaf Pair Along the Stalk -->
          <div style="${leftLeaf}"></div>
          <div style="${rightLeaf}"></div>

        </div>
        
        <!-- The Head -->
        <div style="position: absolute; top: 0; left: 50%; width: 70px; height: 70px; 
                    margin-top: -35px; margin-left: -35px; opacity: 0; 
                    animation: bloom-sunflower 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${headDelay}s forwards;">
          ${headSVG}
        </div>
        
      </div>
    `;
  }

  html += `</div>`;
  return html;
}
/*
function sunflowerCelebration() {
  let html = `<div class="puzzle-celebration">`;

  // 1. Dynamic Density: Target one flower roughly every 40 pixels of screen width
  const screenWidth = window.innerWidth;
  const numFlowers = Math.max(4, Math.floor(screenWidth / 40)); // Ensure at least 4 show up
  const segmentWidth = 100 / numFlowers; // Divide the screen into even percentage chunks

  // Dynamically generate the 12 petals once to save string space
  let petals = '';
  for (let i = 0; i < 12; i++) {
    petals += `<ellipse cx="50" cy="22" rx="7" ry="20" fill="#fbbf24" transform="rotate(${i * 30} 50 50)" />`;
  }

  // The core SVG for the flower head
  const headSVG = `
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      ${petals}
      <circle cx="50" cy="50" r="22" fill="#78350f" />
      <circle cx="50" cy="50" r="16" fill="none" stroke="#522504" stroke-width="3" stroke-dasharray="2 4" />
    </svg>
  `;

  // Build the garden organically
  for (let i = 0; i < numFlowers; i++) {
    // Left Placement: Put it in its assigned segment, plus a random jitter so it's not a rigid grid
    const jitter = Math.random() * (segmentWidth * 0.6); 
    const left = (i * segmentWidth) + jitter;
    
    // Height: Randomize between 40% and 95% of the container height
    const height = Math.floor(Math.random() * 75) + 20; 
    
    // Timing: Make them all grow simultaneously 
    // Stalks start immediately (0s), heads pop slightly after (0.3s)
    const stalkDelay = 0;
    const headDelay = 0.3 + height/500 + Math.random()/10;

    html += `
      <div style="position: absolute; bottom: 0; left: ${left}%; height: ${height}%; width: 8px;">
        
        <!-- The Stalk -->
        <div style="width: 100%; height: 100%; background: #16a34a; border-radius: 4px; 
                    transform-origin: bottom center; transform: scaleY(0); 
                    animation: grow-stalk 0.6s ease-out ${stalkDelay}s forwards;"></div>
        
        <!-- The Head -->
        <div style="position: absolute; top: 0; left: 50%; width: 70px; height: 70px; 
                    margin-top: -35px; margin-left: -35px; opacity: 0; 
                    animation: bloom-sunflower 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${headDelay}s forwards;">
          ${headSVG}
        </div>
        
      </div>
    `;
  }

  html += `</div>`;
  return html;
}*/

/* ---------- circuit UI ---------- */
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
  puzHost().innerHTML=h;

  puzHost().querySelectorAll("[data-p]").forEach(b=>{ b.onclick=()=>{pz.sel=b.dataset.p; renderWater();}; });
  puzHost().querySelectorAll("[data-d]").forEach(b=>{ b.onclick=()=>{pz.dir=b.dataset.d; renderWater();}; });
  puzHost().querySelectorAll("[data-w]").forEach(el=>{
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
  puzHost().querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      const a=b.dataset.act;
      if(a==="clear"){ pz.placed={}; renderWater(); }
      else if(a==="back"){ closePuzzle(); }
      else if(a==="commit"){
       
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
  puzHost().innerHTML=h;

  puzHost().querySelectorAll("[data-s]").forEach(b=>{ b.onclick=()=>{ pz.sel=b.dataset.s; renderSeed(); }; });
  puzHost().querySelectorAll("[data-seed]").forEach(el=>{
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
  puzHost().querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      const a=b.dataset.act;
      if(a==="clear"){ pz.placed={}; renderSeed(); }
      else if(a==="back"){ closePuzzle(); }
      else if(a==="commit"){
        
        const extra=grantReward("seed");
        S.pending.push(`The seed frame is sorted — every drawer labelled, every companion noted.${extra}`);
        finishPuzzle("seed");
      }
    };
  });
}

/* ---------- radio UI ---------- */
/* ---------- signal UI (the radio) ---------- */
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
  puzHost().innerHTML=h;

  puzHost().querySelectorAll("[data-patch]").forEach(b=>{ b.onclick=()=>{ pz.sel=b.dataset.patch; renderPatch(); }; });
puzHost().querySelectorAll("[data-px]").forEach(el => {
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
            const gridRect = puzHost().querySelector(".grid").getBoundingClientRect();
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
  puzHost().querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=()=>{
      const a=b.dataset.act;
      if(a==="clear"){ pz.placed=[]; renderPatch(); }
      else if(a==="back"){ closePuzzle(); }
      else if(a==="commit"){
        
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

  puzHost().innerHTML = h;

  // 1. Bind Selection Buttons
  puzHost().querySelectorAll("[data-sel]").forEach(b => {
    b.onclick = () => { pz.sel = +b.dataset.sel; renderWires(); };
  });

  // 2. Bind Grid Interactions (Drag/Swap/Rotate)
  puzHost().querySelectorAll("[data-cell]").forEach(el => {
    el.onpointerdown = (e) => {
      const [x, y] = el.dataset.cell.split(",").map(Number);
      const key = `${x},${y}`;

      if (L.srcs.some(t => t.x === x && t.y === y) || L.sinks.some(t => t.x === x && t.y === y) || L.blocks.some(([bx, by]) => bx === x && by === y)) return;

      el.setPointerCapture(e.pointerId);

      const onPointerUp = (ev) => {
        el.releasePointerCapture(ev.pointerId);
        const targetEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-cell]");
        const gridRect = puzHost().querySelector(".grid").getBoundingClientRect();
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
  puzHost().querySelectorAll("[data-act]").forEach(b => {
    b.onclick = () => {
      const a = b.dataset.act;
      if (a === "clear") { pz.placed = {}; renderWires(); }
      else if (a === "back") { closePuzzle(); }
      else if (a === "commit") {
      
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

  puzHost().innerHTML = h;

  // 1. Bind Tapping (Rotation only, no dragging!)
  puzHost().querySelectorAll("[data-idx]").forEach(el => {
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
  puzHost().querySelectorAll("[data-act]").forEach(b => {
    b.onclick = () => {
      const a = b.dataset.act;
      if (a === "back") { closePuzzle(); }
      else if (a === "commit") {
       
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

  const gw=L.grid[0].length, gh=L.grid.length;
  const cell = Math.min(20, Math.floor((Math.min(window.innerWidth,620)-90)/gw));
  h += `<div class="picross-board" style="grid-template-columns:auto repeat(1,max-content)">`;

  h += `<div class="top-clues" style="grid-template-columns:repeat(${gw},${cell}px)">`;
  colClues.forEach(clue => { h += `<div>${clue.join("<br>")}</div>`; });
  h += `</div>`;
  
  h += `<div class="left-clues" style="grid-template-rows:repeat(${gh},${cell}px)">`;
  rowClues.forEach(clue => { h += `<div>${clue.join(" ")}</div>`; });
  h += `</div>`;
  
  h += `<div class="puzzle-grid" id="p-grid" style="grid-template-columns:repeat(${gw},${cell}px);grid-template-rows:repeat(${gh},${cell}px)">`;
  for (let r = 0; r < L.grid.length; r++) {
    for (let c = 0; c < L.grid[0].length; c++) {
      const st = pz.state[r][c];
      const cls = st === 1 ? " filled" : st === 2 ? " crossed" : "";
      h += `<div class="puzzle-cell${cls}" data-px="${r},${c}"></div>`;
    }
  }
  h += `</div></div>`;
  h += `<div class="blurb" style="margin-top:16px;text-align:center;">Drag to paint. Desktop: right-click to mark.</div>`;
  
  puzHost().innerHTML = h;

  // Setup UI Buttons
  puzHost().querySelector("[data-act='back']").onclick = closePuzzle;
  
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
  if (!pz || pz.solved) return;   // this fires on every paint AND on pointer-up:
                                  // without the guard a winning click opens the
                                  // completion modal twice
  const L = pz.L;
  const isWin = L.grid.every((row, r) =>
    row.every((val, c) => (val === 1 ? pz.state[r][c] === 1 : pz.state[r][c] !== 1))
  );
  if (!isWin) return;

  pz.solved = true;
  S.pending.push(L.rewardText);
  // finishPuzzle handles the rest — the sunflower modal, the level's own
  // `parts`/`rewardText`, advancing S.puz.picross, saving, and rolling into
  // the next scan. It already has a branch for levels that carry their own
  // rewards, which is exactly picross's shape.
  finishPuzzle("picross");
}





const DIRGLYPH={E:"→",W:"←",S:"↓",N:"↑"};

const PATCH_TINTS=[
  {line:"#44622F", bg:"rgba(68,98,47,0.20)"},    // leaf
  {line:"#4C7286", bg:"rgba(76,114,134,0.22)"},  // water
  {line:"#B88124", bg:"rgba(184,129,36,0.22)"},  // sun
  {line:"#6E5A7E", bg:"rgba(110,90,126,0.20)"},  // dusk violet
  {line:"#7D8E6C", bg:"rgba(125,142,108,0.26)"}, // moss
  {line:"#5B6770", bg:"rgba(91,103,112,0.20)"}   // slate
];

const WIRE_COLORS = {k:"var(--ink)", r:"var(--rust)", b:"#3d6b8a"};

const WIRE_POST = [[1/3,0],[2/3,0],[1,1/3],[1,2/3],[2/3,1],[1/3,1],[0,2/3],[0,1/3]];

/* ---------- fourier UI (the radio) ----------
   Target wave behind static; player wave overlaid live. Quarter-step
   amplitude buttons per harmonic; no spectrum shown anywhere. Exact match
   (discrete steps) finishes the frequency. */
function fourierWave(amps, x){
  let y=0; for(let i=0;i<amps.length;i++) y += amps[i]*Math.sin((i+1)*x);
  return y;
}
function fourierMismatch(){
  const t=pz.L.amps, a=pz.amps;
  let m=0; for(let i=0;i<t.length;i++) m += Math.abs(t[i]-a[i]);
  return m;
}
function drawFourier(){
  const cv=document.getElementById("fourierCv");
  if(!cv) return;
  const ctx=cv.getContext("2d");
  const W=cv.width, H=cv.height, mid=H/2, scale=H/5.4;
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle="rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.moveTo(0,mid); ctx.lineTo(W,mid); ctx.stroke();
  const mm=fourierMismatch();
  // the target, under static that clears as the match improves
  ctx.strokeStyle="#5B6770"; ctx.lineWidth=2; ctx.beginPath();
  for(let px=0;px<=W;px++){
    const x=px/W*2*Math.PI*2;
    const noise=(Math.random()-0.5)*mm*0.35*scale;
    const y=mid - fourierWave(pz.L.amps,x)*scale + noise;
    px?ctx.lineTo(px,y):ctx.moveTo(px,y);
  }
  ctx.stroke();
  // the player's wave
  ctx.strokeStyle="#B88124"; ctx.lineWidth=2; ctx.beginPath();
  for(let px=0;px<=W;px++){
    const x=px/W*2*Math.PI*2;
    const y=mid - fourierWave(pz.amps,x)*scale;
    px?ctx.lineTo(px,y):ctx.moveTo(px,y);
  }
  ctx.stroke();
}
function renderFourier(){
  const L=pz.L;
  const lo = L.signed ? -1 : 0;
  let h=`<div class="card">
    <div class="pzhead"><div class="sysname">Frequency ${L.n}</div>
      <div class="condpct">${L.amps.length} tone${L.amps.length>1?"s":""}</div></div>
    <div class="pzteach">${L.teach}</div>
    <canvas id="fourierCv" width="560" height="200" style="width:100%;max-width:560px;display:block;margin:8px auto;background:var(--paper);border:1px solid var(--line);border-radius:6px"></canvas>
    <div class="blurb" style="text-align:center">The grey line is what the antenna hears. The gold one is yours. Static thins as they agree.</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:10px">`;
  for(let i=0;i<pz.amps.length;i++){
    h+=`<div style="text-align:center">
      <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft)">tone ${i+1}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
        <button class="go" data-fq="${i}" data-d="-1" ${pz.amps[i]<=lo?"disabled":""}>−</button>
        <span style="font-family:ui-monospace,monospace;min-width:42px;display:inline-block">${pz.amps[i].toFixed(2)}</span>
        <button class="go" data-fq="${i}" data-d="1" ${pz.amps[i]>=1?"disabled":""}>+</button>
      </div>
    </div>`;
  }
  h+=`</div>
    <div style="margin-top:12px;text-align:center"><button class="go" data-act="back">Leave it</button></div>
  </div>`;
  puzHost().innerHTML=h;
  puzHost().querySelector("[data-act='back']").onclick=closePuzzle;
  puzHost().querySelectorAll("[data-fq]").forEach(b=>{
    b.onclick=()=>{
      const i=+b.dataset.fq, d=+b.dataset.d;
      pz.amps[i]=Math.round((pz.amps[i]+d*0.25)*100)/100;
      if(fourierMismatch()===0){
        S.pending.push("The wave sat down onto the signal and the static went quiet. A clear channel, held.");
        finishPuzzle("fourier");
        return;
      }
      renderFourier();
    };
  });
  drawFourier();
  // idle shimmer: the static crawls even when the player is thinking
  if(pz._anim) cancelAnimationFrame(pz._anim);
  (function loop(){ if(!pz||pz.kind!=="fourier")return; drawFourier(); pz._anim=requestAnimationFrame(()=>setTimeout(loop,120)); })();
}

export { bindPuzzleEntries, closePuzzle, openPuzzle, puzzleEntryCard, renderOpenPuzzle, setPz };
