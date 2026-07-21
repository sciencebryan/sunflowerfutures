import { S } from "./state.js";
import { Cap, byId, clamp, effStat, isAre, siteDef, siteName, subj, wbFloor } from "./helpers.js";
import { CROPS, INJURY_PER_DAY, SITE_DEF } from "./data-economy.js";
import { discoverRandomCrop, discoveryLine, lockedCrops, season } from "./seasons.js";
import { addRes, foodCap } from "./defs.js";









/* ================= expeditions ================= */
function tickExpeditions(lines){
  const done=[];
  // drop anyone who left the roster mid-trip (a death or departure elsewhere); if
  // that empties a party, retire the whole expedition so nothing dangles behind it.
  for(const ex of S.expeditions){ ex.party = ex.party.filter(pid=>byId(pid)); }
  S.expeditions = S.expeditions.filter(ex=>ex.party.length>0);
  for(const ex of S.expeditions){
    for(const pid of ex.party){
      if(ex.injured.includes(pid)) continue;
      const p=byId(pid);
      if(!p) continue;
      const f=S.f||{};
      let risk=INJURY_PER_DAY*(1-0.12*(effStat(p,"wild",ex.type)-1))*(p.trait==="Cautious"?0.4:1)*(ex.riskMult||1)*(ex.party.length===1?1.5:1);
      if(ex.type==="forage") risk*=0.35;              // near country, known ground
      if(f.farSafe && ex.total>=4) risk*=f.farSafe;   // the rail corridor: graded, cleared, unlosable
      if(f.safeReturn) risk*=0.85;                    // the tower: nobody gets turned around
      risk=Math.max(0.006,risk);
      if(Math.random()<risk) ex.injured.push(pid);
    }
    for(const pid of ex.party){
      const p=byId(pid);
      p.wb=clamp(p.wb + (p.trait==="Restless"?1.5:p.trait==="Steady"?0:-1), wbFloor(p), 100);
    }
    ex.daysLeft--;
    if(ex.daysLeft<=0) done.push(ex);
  }
  for(const ex of done){
    S.expeditions=S.expeditions.filter(x=>x!==ex);
    if(ex.type==="forage"){
      // yield scales with wild skill and with how much it's been used
      const sf=season().forage;
      const raw=ex.party.reduce((a,pid)=>a+3+effStat(byId(pid),"wild","forage")*1.4,0)*sf;
      const got=raw*(S.larder??1);
      S.res.food=clamp(S.res.food+got,0,foodCap());
      S.larder=clamp((S.larder??1) - got/95, 0.12, 1);
      const names=ex.party.map(pid=>byId(pid).name).join(", ");
      const thin=(S.larder??1)<0.45;
      if(season().id==="winter") lines.push("Winter foraging. Bark, rosehips, and whatever the squirrels missed.");
      S.lastForageDay = S.day;
      lines.push(`${names} came back from the near country with ${got.toFixed(0)} food.${thin?" The good patches are thinning. What's left needs a season to come back.":""}`);
      if(lockedCrops().length && Math.random()<0.12){
        // discovery lean toward things that grow wild: perennials first if any remain
        const id = discoverRandomCrop(c=>CROPS[c].perennial) || discoverRandomCrop();
        if(id) lines.push(discoveryLine(id,"forage"));
      }
    } else if(ex.type==="explore"){
      const next=SITE_DEF.find(s=>!S.sites[s.id].discovered);
      if(next){
        S.sites[next.id].discovered=true;
        lines.push(`The ranging party came back with a place: ${next.name}, ${next.days} days' round walk. ${next.blurb}`);
      } else if(lockedCrops().length && Math.random()<0.5){
        const id=discoverRandomCrop();
        if(id) lines.push("The ranging party didn't find any new places to salvage, but they came back with something better. "+discoveryLine(id,"explore"));
        else lines.push("The ranging party came back with nothing new.");
      } else {
        lines.push("The ranging party came back with nothing new.");
      }
      // even when they DO find a place, a chance of turning up seed too
      if(next && lockedCrops().length && Math.random()<0.3){
        const id=discoverRandomCrop();
        if(id) lines.push(discoveryLine(id,"explore"));
      }
    } else {
      const st=S.sites[ex.siteId], def=siteDef(ex.siteId);
      st.visited = true;
      st.lastVisited = S.day;
      const carry=ex.party.reduce((a,pid)=>a+4+effStat(byId(pid),"wild",ex.type)+((S.f||{}).carry||0),0);
      let wants={}, wantTotal=0;
      for(const [k,v] of Object.entries(st.stock)){ const t=Math.min(v, v*0.4+1); wants[k]=t; wantTotal+=t; }
      const scale=wantTotal>0?Math.min(1, carry/wantTotal):0;
      const gotWords=[];
      for(const [k,v] of Object.entries(wants)){
        const yf=((S.f||{}).siteYield||{})[ex.siteId]||1;
        const take=Math.min(st.stock[k], Math.round(v*scale*yf*10)/10);
        if(take>0.05){
          st.stock[k]=Math.max(0,st.stock[k]-take);
          if(k==="cans"){
            S.preserved = clamp(S.preserved+take, 0, S.flags.rootCellar?300:170);
            gotWords.push(`${take.toFixed(0)} cans of food`);
          } else {
            const actual = addRes(k, take);
            if(actual>0.05) gotWords.push(`${actual.toFixed(0)} ${k}`);
            else gotWords.push(`no room for more ${k} — our storage is full`);
          }
        }
      }
      const remain=Object.values(st.stock).reduce((a,b)=>a+b,0);
      if(remain<2){ st.depleted=true; for(const k in st.stock) st.stock[k]=0; }
      const names=ex.party.map(pid=>byId(pid).name).join(", ");
      lines.push(`${names} came back from ${siteName(ex.siteId)}${gotWords.length?` with ${gotWords.join(", ")}`:" empty-handed"}.${st.depleted?` There is nothing left there. ${siteName(ex.siteId)} is stripped.`:""}`);
      S.discovered = S.discovered || {};
      if(ex.siteId==="solarfarm" && !S.discovered.solar){
        S.discovered.solar = true;
        lines.push("We found some still-readable wiring diagrams at the solar farm, plus a bunch of solar panels we've brought back. We think we can install them on our roof.");
      }
      if((ex.siteId==="pharmacy"||ex.siteId==="hospital") && !S.discovered.herbalStores){
        S.discovered.herbalStores = true;
        lines.push("We also found a beat-up guide to wild remedies — a working knowledge of what to dry, and how, and for what.");
      }
      if(lockedCrops().length && Math.random()<0.16){
        const id=discoverRandomCrop();
        if(id) lines.push(discoveryLine(id,"salvage"));
      }
    }
    for(const pid of ex.party){
      const p=byId(pid);
      const name=ex.type==="explore"?"the far country":ex.type==="forage"?"the near country":siteName(ex.siteId);
      if(ex.injured.includes(pid)){
        p.status="down"; p.downDays=(ex.party.length>1?2:4)+Math.floor(Math.random()*2); p.job=null;
        p.wb=clamp(p.wb-15, wbFloor(p), 100);
        if(!p.perm && Math.random()<0.12){
          p.perm="leg";
          p.wild=Math.max(1,p.wild-2);
          lines.push(`${p.name}'s leg set badly. ${Cap(subj(p))} will walk, but can't go on expeditions any longer.`);
          p.mem=`Hurt at ${name}, day ${S.day}. Can no longer travel long distances quickly or easily, but can still get around.`;
        } else {
          p.mem=`Hurt at ${name}, day ${S.day}.`;
        }
        lines.push(`${p.name} came back injured. ${subj(p)} ${isAre(p)} is laid up until ${objp(p)}'s healed.`);
      } else {
        p.status="ok"; p.job=null;
        p.mem=`Last out: ${name}, day ${S.day}.`;
      }
    }
  }
}










export { tickExpeditions };
