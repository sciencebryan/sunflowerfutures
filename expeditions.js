import { S } from "./state.js";
import { Cap, byId, clamp, effStat, isAre, objp, siteDef, siteName, subj, wbFloor } from "./helpers.js";
import { CROPS, INJURY_PER_DAY, MAX_SEED_ROLLS, SEED_RICH_SITES, SITE_DEF } from "./data-economy.js";
import { addMysteryPacket, discoverRandomCrop, grantSeedSpread, totalSeeds, discoverRandomUseful, discoveryLine, lockedCrops, lockedUseful, restockRandomCrop, restockLine, usefulLine, season } from "./seasons.js";
import { addRes, foodCap } from "./defs.js";
import { addForage, addPreservedFound, foodName, pantryTotal, resync } from "./larder.js";
import { addMemory, injuryIsNotable, pushRecentEvent, reluctance } from "./memories.js";
import { MEM_TEXT } from "./data-memories.js";









/* ================= expeditions ================= */
// per-roll chance that a salvage trip turns up a crop the village has never
// grown. Unchanged from the old inline 0.16 -- the seed-rich sites got more
// ROLLS, not better odds, so this stays the one number to tune.
const DISCOVER_P = 0.16;

function tickExpeditions(lines){
  const done=[];
  // drop anyone who left the roster mid-trip (a death or departure elsewhere); if
  // that empties a party, retire the whole expedition so nothing dangles behind it.
  for(const ex of S.expeditions){ ex.party = ex.party.filter(pid=>byId(pid)); }
  S.expeditions = S.expeditions.filter(ex=>ex.party.length>0);
  for(const ex of S.expeditions){
    /* BEHAVIOURAL TEETH. Somebody who got hurt badly at a place doesn't
       refuse to go back — a hard block on assignment fights the player
       rather than characterising anybody — but it costs them something to
       walk back up that road, and the journal says so. Once, on the day
       they set out, not every day of the trip. */
    if(ex.total !== undefined && ex.daysLeft === ex.total){
      const where = ex.siteId || ex.type;
      for(const pid of ex.party){
        const q = byId(pid); if(!q) continue;
        const m = reluctance(q, {place: where, action: ex.type});
        if(m){
          lines.push(`${q.name} went out to ${ex.type==="forage"?"the near country":ex.type==="explore"?"the far country":siteName(ex.siteId)} again. ${Cap(subj(q))} didn't say anything about the last time.`);
          break;   // one line, not a chorus
        }
      }
    }
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
    // NOTE: the party's homecoming lives in the finally below. The expedition
    // is already off S.expeditions by this point, so if anything in the loot
    // or narration throws, these people would otherwise be stranded "away"
    // forever with no expedition backing them. That is exactly the bug that
    // a missing objp import caused. Belt and braces now.
    try{
    if(ex.type==="forage"){
      // yield scales with wild skill and with how much it's been used
      const sf=season().forage;
      /* YIELD, recut. The old constants (3 + skill*1.4) put a skilled
         forager at ~11.5 before bonuses -- about 21,000 kcal off a two-day
         trip, against the game's own anchor of 0.85 food = one adult-day =
         2000 kcal. That is four to five times what a good forager can
         actually carry out of the woods, and a two-day round trip is not
         two days of field time. At 0.4 + skill*0.3 the best forager clears
         ~2.2 in summer (~2,600 kcal per day of the trip) and a novice
         ~0.8, which is the honest shape of it. */
      const raw=ex.party.reduce((a,pid)=>a+0.4+effStat(byId(pid),"wild","forage")*0.3,0)*sf;
      const got=raw*(S.larder??1)*((S.f||{}).forageBonus||1);   // paths worn by feet: the near country is known ground
      // typed: what the near country gives depends on the season, and on
      // whether it has rained lately (mushrooms follow the weather)
      const kinds = addForage(Math.min(got, Math.max(0, foodCap()-pantryTotal())));
      resync();
      // Scaled with the yield cut above: at the old numbers a 3-person trip
      // took ~0.26 off the larder (95 was tuned against ~25 food a trip).
      // Same depletion per trip at the new, much smaller yields.
      S.larder=clamp((S.larder??1) - got/25, 0.12, 1);
      const names=ex.party.map(pid=>byId(pid).name).join(", ");
      const thin=(S.larder??1)<0.45;
      if(season().id==="winter") lines.push("Winter foraging. Bark, rosehips, and whatever the squirrels missed.");
      S.lastForageDay = S.day;
      const what = kinds && kinds.length ? kinds.map(foodName).join(", ") : "what they could find";
      lines.push(`${names} came back from the near country with ${got.toFixed(0)} food — ${what}.${thin?" The good patches are thinning. What's left needs a season to come back.":""}`);
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
        for(const pid of ex.party){
          const q=byId(pid); if(!q) continue;
          addMemory(q, {kind:"discovery", text:MEM_TEXT.discovery(next.name),
                        intensity:0.5, valence:0.7,
                        tags:{place:next.id, action:"explore", subject:"discovery"}});
        }
        pushRecentEvent({kind:"discovery", text:`what they found out at ${next.name}`,
                         weight:1.3, tags:{subject:"discovery"}});
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
      // separate roll: seed of something the village knows and has run out of
      if(Math.random()<0.35){ const id=restockRandomCrop(); if(id) lines.push(restockLine(id)); }
      // and the non-food finds — shade trees. Explore only, by design.
      if(lockedUseful().length && Math.random()<0.2){
        const id=discoverRandomUseful(); if(id) lines.push(usefulLine(id));
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
      // "3 parts, 0 scrap": anything from 0.05 to 0.49 cleared the take gate
      // and then printed through toFixed(0). The loot was real; the sentence
      // was lying about it.
      const amountWord = n => n < 1 ? n.toFixed(1) : n.toFixed(0);
      for(const [k,v] of Object.entries(wants)){
        const yf=((S.f||{}).siteYield||{})[ex.siteId]||1;
        const take=Math.min(st.stock[k], Math.round(v*scale*yf*10)/10);
        if(take>0.05){
          st.stock[k]=Math.max(0,st.stock[k]-take);
          if(k==="cans"){
            // salvaged tins: real canned goods, and they keep like it
            // whole tins, not fractions of tins
            // count what actually went on the shelf -- addPreservedFound
            // rounds each kind UP to a whole tin, so a small take could put
            // three cans by and then report "0 cans of food".
            const tins = addPreservedFound("beans", take*0.5, "can")
                       + addPreservedFound("squash", take*0.3, "can")
                       + addPreservedFound("apple", take*0.2, "can");
            resync();
            S.preserved = clamp(S.preserved, 0, S.flags.rootCellar?300:170);
            if(tins>0) gotWords.push(`${tins.toFixed(0)} can${tins===1?"":"s"} of food`);
          } else if(k==="seeds"){
            /* THERE IS NO GENERIC SEED ANY MORE. This used to call
               addRes("seeds", ...), writing to an S.res.seeds that does not
               exist in the state shape and has no cap and no spender — a
               phantom resource that silently swallowed every seed-vault
               haul in the game. Spread it across the crops the village
               actually knows instead, which is what the grant already
               means everywhere else. */
            /* Some of the haul comes up as sealed packets whose labels have
               gone. Those become mystery packets the player opens when they
               like; the rest spreads across what the village already grows. */
            const packets = Math.min(2, Math.floor(take/6));
            if(packets > 0){
              addMysteryPacket(packets);
              gotWords.push(`${packets} unlabelled seed packet${packets===1?"":"s"}`);
            }
            const loose = Math.max(0, Math.round(take) - packets*6);
            if(loose > 0){
              const before = totalSeeds();
              grantSeedSpread(loose);
              const got = totalSeeds() - before;
              if(got > 0.05) gotWords.push(`${amountWord(got)} seed`);
            }
          } else {
            const actual = addRes(k, take);
            if(actual>0.05) gotWords.push(`${amountWord(actual)} ${k}`);
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
      /* --- crop discovery, weighted by what the place actually is ---
         One roll at an electronics depot; up to MAX_SEED_ROLLS at the seed
         vault or the agricultural extension, which are, in the fiction,
         nothing but seed. The count tapers with the pool: each landed roll
         unlocks its crop immediately, so lockedCrops() shrinks INSIDE the
         loop and a roll can never be spent on something already found.
         Per-roll odds are unchanged. */
      const rolls = SEED_RICH_SITES.includes(ex.siteId)
        ? clamp(lockedCrops().length, 1, MAX_SEED_ROLLS)
        : 1;
      const found=[];
      for(let i=0;i<rolls;i++){
        if(!lockedCrops().length) break;
        if(Math.random()>=DISCOVER_P) continue;
        const id=discoverRandomCrop();
        if(id) found.push(id);
      }
      // one consolidated sentence, not three near-identical ones in a row
      if(found.length) lines.push(discoveryLine(found,"salvage"));
      // separate roll: a seed packet in a drawer, of something already grown here
      if(Math.random()<0.3){ const id=restockRandomCrop(); if(id) lines.push(restockLine(id)); }
    }
    }catch(err){
      console.error("expedition return failed", err);
      lines.push("The party came back. Nobody wrote down what they carried.");
    }finally{
    for(const pid of ex.party){
      const p=byId(pid);
      if(!p) continue;
      const name=ex.type==="explore"?"the far country":ex.type==="forage"?"the near country":siteName(ex.siteId);
      // what the memory system keys off: the SITE id, not its display name,
      // so a renamed site (founding visuals rename oldtown) still matches
      const placeKey = ex.siteId || ex.type;
      if(ex.injured.includes(pid)){
        p.status="down"; p.downDays=(ex.party.length>1?2:4)+Math.floor(Math.random()*2); p.job=null;
        // Stamped so the care block in day.js can tell "hurt today" from
        // "hurt a while ago". tickExpeditions runs early in simulateDay and
        // the recovery tick runs late in the SAME day, so a two-day injury
        // could be decremented to zero before the day was out -- the journal
        // said someone came back hurt and was back on their feet, together.
        p.downSince=S.day;
        p.wb=clamp(p.wb-15, wbFloor(p), 100);
        // The homecoming first, the diagnosis after. These were pushed in
        // the other order, so the leg set badly before anyone had noticed
        // there was anything wrong with it.
        lines.push(`${p.name} came back injured. ${Cap(subj(p))} ${isAre(p)} laid up until it heals.`);
        if(!p.perm && Math.random()<0.12){
          p.perm="leg";
          p.wild=Math.max(1,p.wild-2);
          lines.push(`${p.name}'s leg set badly. ${Cap(subj(p))} will walk, but can't go on expeditions any longer.`);
          // a leg that won't come back is one of the three things a person
          // keeps forever, regardless of how quiet it goes
          addMemory(p, {kind:"permInjury", text:MEM_TEXT.permInjury(name),
                        intensity:0.8, valence:-0.7, unforgettable:true,
                        tags:{place:placeKey, action:ex.type}});
        } else if(injuryIsNotable(p)){
          /* NOTABILITY FLOOR. Ordinary injuries are frequent enough that
             logging every one crowds rarer, more defining material out of
             twelve slots inside a single season. One per person per ~20
             days; the rest still hurt, they just don't become memories. */
          addMemory(p, {kind:"injury", text:MEM_TEXT.injury(name),
                        intensity:0.5, valence:-0.5,
                        tags:{place:placeKey, action:ex.type}});
        }
      } else {
        p.status="ok"; p.job=null;
        // coming home fine is not an event. The old `mem` string recorded it
        // because it had nowhere else to put "where were you last" — that was
        // a status line wearing a memory's clothes, and it's gone.
        (S.returnedToday=S.returnedToday||[]).push({id:p.id, place:name});
      }
    }
    }
  }
}










export { tickExpeditions };
