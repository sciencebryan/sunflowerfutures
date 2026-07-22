import { $ } from "./dom.js";
import { ROSTER, TRAITS, VISUALS } from "./defs.js";
import { renderAll, skillDots } from "./render.js";
import { FOUNDER_COUNT, S, applyFounders, applyFounding, newState, setS } from "./state.js";
import { store } from "./store.js";
import { setPz } from "./puzzle-ui.js";
import { closeSheet } from "./sheets.js";









/* ================= founding screen ================= */
const fPick=new Set();        // founding place-visuals chosen
const fPeoplePick=new Set();  // founding people chosen
function fChip(id,label){
  const on=fPick.has(id);
  return `<button class="chip" data-fid="${id}" style="cursor:pointer;padding:8px 13px;font-family:var(--serif);font-size:13.5px;border-radius:16px;text-align:left;${on?'background:#E7EADB;border-color:var(--leaf);box-shadow:0 0 0 1px var(--leaf) inset':''}">${label}</button>`;
}
function drawFoundingPlace(){
  $("foundingBody").innerHTML = `
    <div style="font-family:var(--serif);font-weight:600;font-size:23px;letter-spacing:.04em">Before the first day</div>
    <div style="font-family:var(--serif);font-style:italic;color:var(--ink-soft);font-size:14.5px;margin:8px 0 4px;line-height:1.55">
      Every village is somewhere, and the somewhere leaves its mark on the people and on the days.<br>Circle three to five things that are true of this place.
    </div>
    <div id="fVisuals" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:20px"></div>
    <div style="position:sticky;bottom:0;background:linear-gradient(transparent,var(--paper) 34%);padding-top:22px;margin-top:20px">
      <button class="confirm" id="foundBtn" disabled>Circle a few more</button>
      <div style="text-align:center;margin-top:11px"><button id="foundSkip" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);text-decoration:underline">Begin with none of it</button></div>
    </div>`;
  refreshFoundingPlace();
}
function refreshFoundingPlace(){
  $("fVisuals").innerHTML=VISUALS.map(v=>fChip(v.id,v.label)).join("");
  const n=fPick.size;
  const btn=$("foundBtn");
  if(n>=3&&n<=5){ btn.disabled=false; btn.textContent="Next — who's already here"; }
  else { btn.disabled=true; btn.textContent = n<3?`Circle ${3-n} more`:"Circle no more than five"; }
  $("fVisuals").querySelectorAll("[data-fid]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.fid;
      if(fPick.has(id)) fPick.delete(id);
      else if(fPick.size<5) fPick.add(id);
      refreshFoundingPlace();
    };
  });
  $("foundBtn").onclick=()=>drawFoundingPeople();
  $("foundSkip").onclick=()=>{ fPick.clear(); drawFoundingPeople(); };
}

function pChip(id){
  const def=ROSTER.find(r=>r.id===id);
  const on=fPeoplePick.has(id);
  return `<button class="card pcard" data-pid="${id}" style="text-align:left;cursor:pointer;width:100%;${on?'border-color:var(--leaf);background:#E7EADB;box-shadow:0 0 0 1px var(--leaf) inset':''}">
    <div><span class="pname">${def.name}<span class="pn">${def.pn}</span></span> <span class="trait">${def.trait}</span></div>
    <div class="skills">${skillDots(def)}</div>
    <div class="flavor">${def.note} <span style="font-style:normal;color:var(--moss)">· ${TRAITS[def.trait]}.</span></div>
  </button>`;
}
function drawFoundingPeople(){
  $("foundingBody").innerHTML = `
    <div style="font-family:var(--serif);font-weight:600;font-size:23px;letter-spacing:.04em">Who's already here</div>
    <div style="font-family:var(--serif);font-style:italic;color:var(--ink-soft);font-size:14.5px;margin:8px 0 4px;line-height:1.55">
      Twelve people could have ended up in this place. Only ${FOUNDER_COUNT} are standing in the yard on day one — choose who. The rest aren't gone; they may still find the road here, later, on their own time.
    </div>
    <div id="fPeople" style="display:flex;flex-direction:column;gap:8px;margin-top:20px"></div>
    <div style="position:sticky;bottom:0;background:linear-gradient(transparent,var(--paper) 34%);padding-top:22px;margin-top:20px">
      <button class="confirm" id="peopleBtn" disabled>Choose ${FOUNDER_COUNT} more</button>
      <div style="text-align:center;margin-top:11px"><button id="peopleSkip" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);text-decoration:underline">Choose for me</button></div>
      <div style="text-align:center;margin-top:8px"><button id="peopleBack" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);text-decoration:underline">Back</button></div>
    </div>`;
  refreshFoundingPeople();
}
function refreshFoundingPeople(){
  $("fPeople").innerHTML = ROSTER.map(r=>pChip(r.id)).join("");
  const n=fPeoplePick.size;
  const btn=$("peopleBtn");
  if(n===FOUNDER_COUNT){ btn.disabled=false; btn.textContent="Begin the first day"; }
  else { btn.disabled=true; btn.textContent = n<FOUNDER_COUNT?`Choose ${FOUNDER_COUNT-n} more`:`Choose ${n-FOUNDER_COUNT} fewer`; }
  $("fPeople").querySelectorAll("[data-pid]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.pid;
      if(fPeoplePick.has(id)) fPeoplePick.delete(id);
      else if(fPeoplePick.size<FOUNDER_COUNT) fPeoplePick.add(id);
      refreshFoundingPeople();
    };
  });
  $("peopleBtn").onclick=()=>startNewGame([...fPick],[...fPeoplePick]);
  $("peopleSkip").onclick=()=>{
    const shuffled=[...ROSTER].sort(()=>Math.random()-0.5);
    startNewGame([...fPick], shuffled.slice(0,FOUNDER_COUNT).map(r=>r.id));
  };
  $("peopleBack").onclick=()=>drawFoundingPlace();
}

async function startNewGame(visualIds, founderIds){
  setS(newState());
  applyFounding(S, visualIds);
  applyFounders(S, founderIds);
  await store.save(S);
  $("founding").style.display="none";
  $("offlineBanner").innerHTML="";
  setPz(null);                   // drop any open puzzle from the old game
  closeSheet && closeSheet();    // close any lingering sheet
  // land on the village tab so the fresh state is what's shown
  document.querySelectorAll("nav button").forEach(x=>x.classList.remove("on"));
  const vb=document.querySelector('nav button[data-tab="village"]');
  if(vb) vb.classList.add("on");
  ["village","beyond","works","power","water","people","journal"].forEach(t=>{ const el=$("tab-"+t); if(el) el.style.display = t==="village"?"":"none"; });
  const dbg=$("tab-debug"); if(dbg) dbg.style.display="none";   // the dev ledger, if injected, hides with the rest
  renderAll();                   // paint the new village
}
function dismissOffline(){ const n=$("offlineBanner"); if(n) n.innerHTML=""; }
function openFounding(){
  fPick.clear(); fPeoplePick.clear();
  $("founding").style.display="block";
  drawFoundingPlace();
}












export { dismissOffline, openFounding };
