/* =====================================================================
   RED SKIES — meta.js   RS.meta : menus, briefing, debrief, resupply, free watch, settings, pause.
   Owns its own DOM (#meta overlay + #m-pause in the hatch) and injects its own <style>.
   API: init(), startShift(def), show(screen), pause(), resume(), restart(), quit(), grade(stats, state),
        medals(stats, ctx), buildFree(o), buildSurvival(seed), survivalScore(stats, hp),
        get screen, get campaign, get settings, get survival, get last, get def, reset()
   Save keys (RS.save/RS.load, main.js): 'campaign' {next, unlocked, best:{id:grade}, results[], reserve, pending, bank, medals:{id:[medalId]}},
        'settings' {sound, haptics}, 'free' {seed, diff, dur, ev:{}, time, sky}, 'survival' {seed, best:[{score,waves,kills,seed,at}]}
   V1.1: weather pickers + briefing line, SURVIVAL (endless) mode, debrief REPLAY mini-scope + MEDALS, tutorial hooks.
   Tutorial hooks (RS.tutorial feature-detected): menu TRAINING (when !done) + SETTINGS TRAINING call RS.tutorial.start();
   SHIFT_END of a def.tutorial shift is ignored (no debrief/save); pause QUIT during it calls RS.tutorial.stop().
   Also: replay {play(on?), seek(t), get state}, show('surv'|'survival'), END RUN (pause, endless) → endShift('ended').
   Everything that depends on the SIM's V1.1 additions (makeSurvivalShift, RS.sim.history, stats.waves/firstShotKills/…)
   is feature-detected; meta keeps its own light history/tally as a fallback.
   ===================================================================== */
(function () {
  const RS = window.RS;
  RS.settings = RS.settings || { haptics: true, sound: true, voice: true };
  const W3 = ['lance', 'dart', 'harrow'], WL = { lance: 'LANCE', dart: 'DART', harrow: 'HARROW' };
  const ORDER = 'ABCDF';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const clone = o => JSON.parse(JSON.stringify(o));
  const gcol = g => g === 'A' || g === 'B' ? 'ok' : g === 'C' || g === 'D' ? 'amber' : 'red';
  const better = (a, b) => !a ? b : !b ? a : ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
  const tap = () => RS.bus.emit('UI_TAP', { what: 'button' });

  const CSS = `
#meta { position: fixed; inset: 0; z-index: 15; display: none; overflow-x: hidden; overflow-y: auto; -webkit-overflow-scrolling: touch;
  background: radial-gradient(ellipse at 50% 30%, rgba(26,12,8,.985) 0%, rgba(5,7,7,.995) 70%); color: var(--text, #b9d6c2);
  font: 13px/1.4 var(--mono, monospace); padding: calc(14px + env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) calc(14px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
#meta.on { display: block; }
#meta .mc { width: 100%; max-width: 440px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
#meta h1 { margin: 18px 0 0; font-size: 38px; letter-spacing: .2em; color: #ff4b3a; text-align: center; text-shadow: 0 0 18px rgba(255,75,58,.45); }
#meta h2 { margin: 0; font-size: 17px; color: #45ff84; letter-spacing: .12em; }
#meta .kick { color: #ffb020; font-size: 11px; letter-spacing: .22em; font-weight: 700; }
#meta .sub { color: #6d8a76; font-size: 11px; letter-spacing: .12em; text-align: center; }
#meta p { margin: 0; }
#meta .mb { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 52px; padding: 6px 14px; border: 1px solid #1a6b39;
  border-radius: 6px; background: #07140c; color: #45ff84; font: inherit; font-size: 15px; letter-spacing: .14em; text-align: center; cursor: pointer; }
#meta .mb small { display: block; color: #6d8a76; font-size: 10px; letter-spacing: .08em; }
#meta .mb.col { flex-direction: column; gap: 1px; }
#meta .mb.pri { border-color: #45ff84; box-shadow: 0 0 14px rgba(69,255,132,.18); font-weight: 700; }
#meta .mb.amb { border-color: #ffb020; color: #ffb020; background: #1a1406; }
#meta .mb.red { border-color: #ff4b3a; color: #ff4b3a; background: #1e0705; }
#meta .mb.dim { border-color: #2f4a39; color: #b9d6c2; background: #0b100e; }
#meta .mb:active { filter: brightness(1.4); }
#meta .mb[disabled] { opacity: .35; cursor: default; }
#meta .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#meta .box { border: 1px solid #1f2e25; border-radius: 6px; background: #0b100e; padding: 10px 12px; }
#meta .sec { color: #6d8a76; font-size: 10px; letter-spacing: .16em; margin: 0 0 4px; }
#meta ul { margin: 0; padding-left: 18px; }
#meta li { margin: 2px 0; }
#meta .ok { color: #45ff84; } #meta .amber { color: #ffb020; } #meta .red { color: #ff4b3a; } #meta .muted { color: #6d8a76; } #meta .cyan { color: #3ff0d0; }
#meta .mrow { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; width: 100%; min-height: 58px; padding: 6px 12px;
  border: 1px solid #1f2e25; border-radius: 6px; background: #0b100e; color: #b9d6c2; font: inherit; text-align: left; cursor: pointer; }
#meta .mrow b { display: block; color: #45ff84; letter-spacing: .1em; }
#meta .mrow.next { border-color: #ffb020; }
#meta .mrow.next b { color: #ffb020; }
#meta .mrow[disabled] { opacity: .45; cursor: default; }
#meta .badge { min-width: 44px; text-align: center; font-size: 22px; font-weight: 700; }
#meta .badge.s { font-size: 11px; letter-spacing: .1em; }
#meta .grade { font-size: 88px; font-weight: 700; line-height: 1; text-align: center; text-shadow: 0 0 22px currentColor; }
#meta .comp { display: grid; grid-template-columns: 92px 1fr 36px; align-items: center; gap: 8px; margin: 5px 0; font-size: 12px; }
#meta .comp small { display: block; color: #6d8a76; font-size: 10px; }
#meta .barx { height: 8px; border-radius: 4px; background: #0f3a20; overflow: hidden; }
#meta .barx i { display: block; height: 100%; background: #45ff84; }
#meta .barx i.amber { background: #ffb020; } #meta .barx i.red { background: #ff4b3a; }
#meta table { width: 100%; border-collapse: collapse; font-size: 12px; }
#meta td, #meta th { padding: 4px 4px; text-align: right; border-top: 1px solid #1f2e25; }
#meta th { color: #6d8a76; font-weight: 400; font-size: 10px; border-top: 0; }
#meta td:first-child, #meta th:first-child { text-align: left; }
#meta .step { display: grid; grid-template-columns: minmax(0,1fr) 48px 54px 48px; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid #1f2e25; }
#meta .step:first-of-type { border-top: 0; }
#meta .step .q { text-align: center; font-size: 18px; color: #45ff84; }
#meta .sb { width: 48px; height: 48px; border: 1px solid #1a6b39; border-radius: 6px; background: #07140c; color: #45ff84; font: inherit; font-size: 22px; cursor: pointer; }
#meta .sb[disabled] { opacity: .3; cursor: default; }
#meta .tot { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 13px; }
#meta .tg { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 48px; padding: 4px 12px; border: 1px solid #2f4a39;
  border-radius: 6px; background: #0b100e; color: #b9d6c2; font: inherit; font-size: 12px; letter-spacing: .06em; text-align: left; cursor: pointer; }
#meta .tg em { font-style: normal; font-weight: 700; color: #6d8a76; }
#meta .tg[aria-pressed="true"] { border-color: #45ff84; background: #0f2a18; }
#meta .tg[aria-pressed="true"] em { color: #45ff84; }
#meta .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#meta input[type=number] { width: 100%; min-height: 48px; padding: 0 12px; border: 1px solid #2f4a39; border-radius: 6px; background: #050907; color: #45ff84;
  font: inherit; font-size: 18px; letter-spacing: .1em; -webkit-user-select: text; user-select: text; }
#meta input[type=range] { width: 100%; height: 44px; margin: 0; accent-color: #45ff84; }
#meta .seedrow { display: grid; grid-template-columns: minmax(0,1fr) 110px; gap: 8px; }
#meta .kvs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; }
#meta .kvs div { border: 1px solid #1f2e25; border-radius: 4px; padding: 4px; background: #07100b; }
#meta .kvs b { display: block; color: #6d8a76; font-size: 9px; font-weight: 400; letter-spacing: .12em; }
#meta .kvs span { color: #45ff84; font-size: 16px; }
#m-pause { position: absolute; top: calc(4px + env(safe-area-inset-top)); right: 6px; z-index: 4; display: none; width: 48px; height: 44px;
  border: 1px solid #2f4a39; border-radius: 5px; background: rgba(0,0,0,.55); color: #45ff84; font: 700 15px/1 var(--mono, monospace); letter-spacing: .05em; cursor: pointer; }
#m-pause.on { display: block; }
#m-pause:active { background: #0f3a20; }
#hud { padding-right: 62px !important; }
#meta .seg5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
#meta .seg4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
#meta .mb.pk { min-height: 48px; padding: 4px 2px; font-size: 11px; letter-spacing: .04em; }
#meta .mb.pk[aria-pressed="true"] { border-color: #45ff84; background: #0f2a18; font-weight: 700; box-shadow: 0 0 10px rgba(69,255,132,.15); }
#meta .mb.pk[aria-pressed="false"] { border-color: #2f4a39; color: #b9d6c2; background: #0b100e; }
#meta .medals { display: flex; flex-wrap: wrap; gap: 6px; }
#meta .medal { display: inline-flex; flex-direction: column; min-width: 92px; padding: 5px 9px; border: 1px solid var(--mc); border-left-width: 4px; border-radius: 4px;
  background: #07100b; color: var(--mc); font-size: 11px; font-weight: 700; letter-spacing: .1em; }
#meta .medal small { color: #6d8a76; font-size: 9px; font-weight: 400; letter-spacing: .04em; }
#meta .mds { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
#meta .mds i { font-style: normal; font-size: 10px; line-height: 1; padding: 3px 5px; border: 1px solid var(--mc); border-radius: 3px; color: var(--mc); letter-spacing: .06em; }
#meta .rp canvas { display: block; width: 100%; aspect-ratio: 1 / 1; max-width: 380px; margin: 0 auto 8px; border-radius: 50%; background: #030805; touch-action: none; }
#meta .rpc { display: grid; grid-template-columns: 52px minmax(0,1fr) 44px; align-items: center; gap: 8px; }
#meta .rpc .mb { min-height: 48px; padding: 0; font-size: 16px; letter-spacing: 0; }
#meta .rpc span { text-align: right; font-size: 11px; color: #6d8a76; }
#meta .rpk { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 6px; font-size: 10px; color: #6d8a76; }
#meta .wv { font-size: 58px; color: #ffb020; }
#meta tr.me td { color: #ffb020; background: #1a1406; font-weight: 700; }
`;

  let root, mc, pbtn;
  let camp = null, cfg = null, freeOpts = null, surv = null;
  let screen = null, mode = null;            // mode: {type:'campaign', idx, frontier} | {type:'free', opts} | {type:'survival', seed}
  let curDef = null, lastEnd = null, tally = null, buy = null, resetArm = false, debTimer = 0;

  /* ---------- persistence ---------- */
  const content = () => RS.content, CP = () => RS.campaign;
  const load = (k, fb) => (RS.load ? RS.load(k, fb) : fb);
  const save = (k, v) => { if (RS.save) RS.save(k, v); };
  function freshCamp() { return { next: 0, unlocked: 1, best: {}, results: [], reserve: clone(content().reserve), pending: null, bank: 0, medals: {}, vpick: {}, vlast: {} }; }
  function loadCamp() {
    const c = load('campaign', null), f = freshCamp();
    if (!c || typeof c !== 'object') return f;
    const n = CP().shifts.length;
    f.next = Math.max(0, Math.min(n, typeof c.next === 'number' ? c.next : (c.unlocked || 1) - 1));
    f.best = c.best && typeof c.best === 'object' ? c.best : {};
    f.results = Array.isArray(c.results) ? c.results.slice(-40) : [];
    if (c.reserve && W3.every(w => typeof c.reserve[w] === 'number')) f.reserve = c.reserve;
    f.pending = c.pending && typeof c.pending.idx === 'number' ? c.pending : null;
    f.bank = +c.bank || 0;
    f.medals = c.medals && typeof c.medals === 'object' ? c.medals : {};
    f.vpick = c.vpick && typeof c.vpick === 'object' ? c.vpick : {};     // V1.2: variant rolled for a shift (kept until passed)
    f.vlast = c.vlast && typeof c.vlast === 'object' ? c.vlast : {};     // last variant passed per shift (not rolled twice in a row)
    f.unlocked = Math.min(n, f.next + 1);
    return f;
  }
  function saveCamp() { camp.unlocked = Math.min(CP().shifts.length, camp.next + 1); save('campaign', camp); }
  function applySettings() {
    RS.settings.sound = cfg.sound; RS.settings.haptics = cfg.haptics; RS.settings.voice = cfg.voice !== false;
    try { if (RS.audio && RS.audio.setMuted) RS.audio.setMuted(!cfg.sound); } catch (e) { /* audio optional */ }
  }
  function wrapVibrate() {                  // haptics flag gates every navigator.vibrate call (audio/ui use it directly)
    try {
      const nav = navigator, orig = nav.vibrate;
      if (typeof orig !== 'function' || orig.__rsWrapped) return;
      const w = function (p) { return RS.settings.haptics === false ? false : orig.call(nav, p); };
      w.__rsWrapped = true;
      nav.vibrate = w;
    } catch (e) { /* read-only navigator */ }
  }

  /* ---------- rendering helpers ---------- */
  function show(name, html) {
    screen = name;
    mc.innerHTML = html;
    mc.dataset.screen = name;
    root.classList.add('on');
    root.scrollTop = 0;
    const ec = document.getElementById('endcard'); if (ec) ec.classList.remove('show');
    const sh = document.getElementById('sheet'); if (sh) sh.classList.remove('open');
  }
  function hide() { screen = null; root.classList.remove('on'); mc.innerHTML = ''; }
  const btn = (act, label, cls, extra) => `<button class="mb ${cls || ''}" data-m="${act}" ${extra || ''}>${label}</button>`;
  const resTxt = r => `Lance <b class="ok">${r.lance}</b> · Dart <b class="ok">${r.dart}</b> · Harrow <b class="ok">${r.harrow}</b>`;

  /* ---------- screens ---------- */
  function menu() {
    if (RS.title) RS.title.backdrop(true);                  // v19: the menu sits on the live cover-page scene
    const n = CP().shifts.length, done = camp.next >= n;
    const sub = done ? 'Campaign complete · replay any shift' : `Next: ${esc(CP().shifts[camp.next].name)}`;
    const train = RS.tutorial && !RS.tutorial.done, sb = surv.best[0];
    show('menu', `<h1>RED SKIES</h1><div class="sub">BATTERY KESSEL · REPUBLIC OF VARENNA</div><div style="height:18px"></div>` +
      (train ? btn('train', 'TRAINING ▸<small>Recommended · a guided first watch</small>', 'amb col', 'id="m-train"') : '') +
      btn('map', `CAMPAIGN<small>${sub}</small>`, (train ? '' : 'pri ') + 'col', 'id="m-campaign"') +
      btn('surv', `SURVIVAL<small>Hold as long as you can${sb ? ' · best wave ' + sb.waves : ''}</small>`, 'col', 'id="m-surv"') +
      btn('free', 'FREE WATCH<small>Seeded skirmish, your rules</small>', 'col', 'id="m-free"') +
      btn('settings', 'SETTINGS<small>Sound · haptics · progress</small>', 'dim col', 'id="m-settings"') +
      `<div class="sub" style="margin-top:14px">a game by Prairie Blue Studio${RS.VERSION ? ' · V' + RS.VERSION : ''}</div>`);
  }

  function map() {
    const S = CP().shifts, rows = S.map((s, i) => {
      const locked = i > camp.next, best = camp.best[s.id], next = i === camp.next;
      const nm = s.name.replace(/^Shift \d+:\s*/, '');
      const badge = locked ? '<span class="badge s muted">LOCKED</span>' : best ? `<span class="badge ${gcol(best)}">${best}</span>` : '<span class="badge s amber">NEXT</span>';
      const md = (camp.medals[s.id] || []).filter(k => MEDALS[k]);
      const mds = md.length ? `<span class="mds" aria-label="medals">${md.map(k => `<i style="--mc:${MEDALS[k].c}" title="${MEDALS[k].l}">${MEDALS[k].s}</i>`).join('')}</span>` : '';
      return `<button class="mrow${next ? ' next' : ''}" data-m="pick" data-i="${i}" ${locked ? 'disabled' : ''}><span><b>SHIFT ${i + 1}</b>${esc(nm)} <span class="muted">· ${mmss(s.duration)}</span>${mds}</span>${badge}</button>`;
    }).join('');
    show('map', `<div class="kick">CAMPAIGN</div><h2>BATTERY KESSEL</h2><p class="muted">Six watches on the Varenna border. Grade D or better unlocks the next shift.</p>` +
      rows + `<div class="box"><div class="sec">MAGAZINE (NEXT SHIFT)</div>${resTxt(camp.reserve)}</div>` + btn('menu', '◂ MENU', 'dim'));
  }

  /* V1.2: each shift has variants A/B/C; one is rolled per playthrough, a retry after a failure keeps it */
  function variantOf(i) {
    const vs = (CP().variants || [])[i];
    if (!vs || !vs.length) return null;
    let v = vs.find(x => x.key === camp.vpick[i]);
    if (!v) {
      const pool = vs.length > 1 ? vs.filter(x => x.key !== camp.vlast[i]) : vs;
      v = pool[Math.floor(Math.random() * pool.length)];
      camp.vpick[i] = v.key; saveCamp();
    }
    return v;
  }
  function campDef(i) {
    const v = variantOf(i), d = clone(v ? v.def : CP().shifts[i]);
    if (v) d.brief = clone(v.story);
    if (i === camp.next) {
      d.reserve = clone(camp.reserve);
      // V1.4.3: a variant that authors a thinner magazine (C5B: 6 Lance) caps what goes into the shift; the rest waits in the depot
      const vr = v && v.def.reserve, base = CP().shifts[i].reserve || content().reserve;
      if (vr) for (const w of W3) if (vr[w] < base[w] && d.reserve[w] > vr[w]) { (d.held = d.held || {})[w] = d.reserve[w] - vr[w]; d.reserve[w] = vr[w]; }
    } else d.reserve = d.reserve || clone(content().reserve);
    return d;
  }
  function pick(i) {
    if (i > camp.next) return;
    if (i === camp.next && camp.pending && camp.pending.idx === i) return resupply();
    mode = { type: 'campaign', idx: i, frontier: i === camp.next };
    briefing(campDef(i));
  }

  const BRG = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const dirOf = (x, y) => BRG[Math.round((((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360) / 45) % 8];
  const KW = { jet_hostile: 'strike fighter', helo_hostile: 'attack helicopter', cruise_missile: 'cruise missile', drone: 'drone' };
  const FRIENDK = { jet_friend: 1, strike_friend: 1, transport: 1, helo_friend: 1 };
  function threatWords(def) {
    const by = {}, flags = { jammer: 0, arm: 0, popup: 0 };
    for (const s of def.spawns || []) {
      if (FRIENDK[s.kind]) continue;
      const k = s.decoy ? 'decoy' : (KW[s.kind] || s.kind), b = by[k] || (by[k] = { n: 0, dirs: new Set(), swarm: 0 });
      b.n += s.count || 1; b.dirs.add(dirOf(s.x, s.y));
      if ((s.count || 1) >= 6) b.swarm = Math.max(b.swarm, s.count);
      if (s.jammer) flags.jammer++; if (s.armCarrier) flags.arm++; if (s.popup) flags.popup++;
    }
    const out = Object.keys(by).map(k => {
      const b = by[k], d = [...b.dirs].slice(0, 3).join(', ');
      return `${b.n} ${k}${b.n > 1 ? 's' : ''} from the ${d}${b.swarm ? ` (swarms of up to ${b.swarm})` : ''}`;
    });
    if (flags.jammer) out.push(`${flags.jammer > 1 ? flags.jammer + ' stand-off jammers' : 'A stand-off jammer'}: expect strobes`);
    if (flags.arm) out.push(`${flags.arm} anti-radiation missile shooter${flags.arm > 1 ? 's' : ''}: watch your emission time`);
    if (flags.popup) out.push('Helicopters hiding low, popping up near 10 km');
    return out.length ? out : ['No hostile activity expected'];
  }
  const EVW = { night: 'Night: the hatch view is dark, trust the scope', storm: 'Storm: clutter and poor visibility', radar_fault: 'Radar fault: expect a dropout',
    launcher_jam: 'Launcher jam: one launcher out for a while', friendly_iff_failure: 'Interrogator fault: IFF unreliable for a while',
    comms_outage: 'HQ link outage: no radio for a while', late_resupply: 'Late resupply: reserve top-up mid-shift', drone_swarm: 'Drone swarms', roe_change: 'ROE change ordered by HQ' };

  /* weather (contract §1): visKm clear 15, overcast 11, rain 6; night halves it (min 3) */
  const TIMES = ['dawn', 'day', 'dusk', 'night'], SKIES = ['clear', 'overcast', 'rain'];
  const visKm = w => { const v = { clear: 15, overcast: 11, rain: 6 }[w.sky] || 15; return w.time === 'night' ? Math.max(3, v / 2) : v; };
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  function wxLine(w) {
    w = Object.assign({ time: 'dusk', sky: 'clear' }, w || {});
    return `${cap(w.time)} · ${w.sky}, visibility ${Math.round(visKm(w))} km`;
  }
  function seededWx(seed) {                  // fallback when content.makeFreeShift predates weather (same weights as the contract)
    const r = content().mulberry32(((seed >>> 0) ^ 0x77e47e7) >>> 0), pickW = (keys, w) => { let x = r(); for (let i = 0; i < keys.length; i++) { x -= w[i]; if (x < 0) return keys[i]; } return keys[keys.length - 1]; };
    return { time: pickW(['dusk', 'day', 'dawn', 'night'], [0.3, 0.3, 0.2, 0.2]), sky: pickW(SKIES, [0.55, 0.3, 0.15]) };
  }

  function briefing(def) {
    curDef = def;
    const friends = (def.spawns || []).filter(s => FRIENDK[s.kind]);
    const fr = friends.map(s => `${esc(s.callsign || 'friendly')}${s.iffBroken ? ' <span class="amber">IFF INOP</span>' : ''}`).join(', ');
    const roe = [`<b class="amber">${def.roe}</b> at start`].concat((def.roeChanges || []).map(r => `<b class="amber">${r.roe}</b> at ${mmss(r.t)}`)).join(' → ');
    const evs = [...new Set((def.events || []).map(e => e.kind))].map(k => `<li>${esc(EVW[k] || k)}</li>`).join('');
    const st = mode.type === 'campaign' ? (def.brief || CP().story[mode.idx]) : null, sv = mode.type === 'survival';
    const situation = st ? st.situation : sv ? `Survival watch, seed ${mode.seed}. Raids come in waves, each heavier than the last, until the site falls. The magazine is topped up between waves. Friendly transits still use the corridors: identify before you shoot.`
      : `Free watch, seed ${mode.opts.seed}, difficulty ${diffLabel(mode.opts.diff)}. Unknown traffic along the border; friendlies use the east and north corridors.`;
    let threats = threatWords(def);
    if (sv) {
      threats = [];
      try { const w1 = content().makeSurvivalWave && content().makeSurvivalWave(1, mode.seed); if (w1 && w1.spawns) threats = threatWords({ spawns: w1.spawns }).map((t, i) => (i ? '' : 'Wave 1: ') + t); } catch (e) { /* optional */ }
      threats.push('Each wave grows: anti-radiation shooters from wave 4, stand-off jammers from wave 6, drone swarms later');
    }
    const notes = st && st.notes ? st.notes.map(n => `<li>${esc(n)}</li>`).join('') : '';
    const r = Object.assign({}, content().reserve, def.reserve);
    const kick = mode.type === 'campaign' ? `BRIEFING · SHIFT ${mode.idx + 1} OF ${CP().shifts.length}` : sv ? 'BRIEFING · SURVIVAL' : 'BRIEFING · FREE WATCH';
    show('briefing', `<div class="kick">${kick}</div><h2 id="m-bname">${esc(def.name.replace(/^Shift \d+:\s*/, ''))}</h2>` +
      `<p>${esc(situation)}</p>` +
      `<div class="box"><div class="sec">EXPECTED THREATS</div><ul>${threats.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` +
      (friends.length ? `<div class="box"><div class="sec">FRIENDLY TRAFFIC</div>${fr}</div>` : '') +
      `<div class="box" id="m-wx"><div class="sec">CONDITIONS</div><p><b class="cyan">${esc(wxLine(def.weather))}</b></p>${evs ? `<ul>${evs}</ul>` : ''}</div>` +
      `<div class="box"><div class="sec">RULES OF ENGAGEMENT</div>Weapons ${roe}</div>` +
      `<div class="box"><div class="sec">RESERVE · ${def.endless ? 'ENDLESS WATCH' : 'WATCH ' + mmss(def.duration)}</div>${resTxt(r)}<div class="muted" style="font-size:11px">Launchers start loaded (Lance 2×4, Dart 4, Harrow 600).</div></div>` +
      (notes ? `<div class="box"><div class="sec">HQ NOTES</div><ul>${notes}</ul></div>` : '') +
      btn('begin', sv ? 'BEGIN RUN ▸' : 'BEGIN SHIFT ▸', 'pri', 'id="m-begin"') + btn(mode.type === 'campaign' ? 'map' : sv ? 'surv' : 'free', '◂ BACK', 'dim'));
  }

  function startShift(def) {
    def = def || curDef;
    curDef = def;
    clearTimeout(debTimer);
    hide();
    tally = newTally();
    lastEnd = null;
    if (RS.main && RS.main.resume) RS.main.resume();
    RS.sim.startShift(def);
    pbtn.classList.add('on');
    return true;
  }

  function onEnd(p) {
    pbtn.classList.remove('on');
    stopReplay();
    if (p.reason === 'restart' || p.reason === 'quit') return;
    if ((curDef && curDef.tutorial) || (RS.tutorial && RS.tutorial.running)) return;     // training watch: the tutorial owns its ending
    const s = RS.sim.state, endless = !!((curDef && curDef.endless) || s.shift.endless || (mode && mode.type === 'survival'));
    const T = tally || newTally();
    if (T.emitOn != null) { T.maxEmit = Math.max(T.maxEmit, s.t - T.emitOn); T.emitOn = null; }
    const g = endless ? null : grade(p.stats, s);
    const Hs = histSrc(), hist = Hs && Hs.samples && Hs.samples.length ? { samples: Hs.samples.slice(), events: (Hs.events || []).slice() } : null;
    lastEnd = { p, g, reserve: clone(s.battery.reserve), hp: s.asset.hp, def: curDef, mode: mode && clone(mode), tally: T, hist, endless,
      wave: s.shift.wave || ((p.stats && p.stats.waves) || 0) + (endless ? 1 : 0) };
    lastEnd.medals = medals(p.stats || {}, { hp: s.asset.hp, failed: endless ? !!(p.stats && p.stats.fratricide) : g.failed, endless, wave: lastEnd.wave, tally: T });
    if (endless) {
      const sc = survivalScore(p.stats || {}, s.asset.hp), e = { score: sc.score, waves: sc.waves, kills: sc.kills, seed: (mode && mode.seed) || 0, at: Date.now() };
      surv.best.push(e); surv.best.sort((a, b) => b.score - a.score || a.at - b.at); surv.best = surv.best.slice(0, 5);
      lastEnd.sc = sc; lastEnd.entry = e; lastEnd.rank = surv.best.indexOf(e);
      save('survival', surv);
    } else if (mode && mode.type === 'campaign') {
      const id = CP().shifts[mode.idx].id, n = CP().shifts.length;
      camp.best[id] = better(camp.best[id], g.grade);
      camp.results.push({ id, grade: g.grade, score: g.score, at: Date.now() });
      if (lastEnd.medals.length) camp.medals[id] = MEDAL_IDS.filter(k => lastEnd.medals.includes(k) || (camp.medals[id] || []).includes(k));
      if (camp.results.length > 40) camp.results.splice(0, camp.results.length - 40);
      if (!g.failed) { camp.vlast[mode.idx] = camp.vpick[mode.idx]; delete camp.vpick[mode.idx]; }   // passed → next time rolls a different variant
      if (mode.frontier && !g.failed) {
        camp.next = mode.idx + 1;
        camp.reserve = clone(s.battery.reserve);
        if (curDef && curDef.held) for (const w of W3) camp.reserve[w] += curDef.held[w] || 0;   // V1.4.3: depot stock held back by a thin-magazine variant
        camp.pending = camp.next < n ? { idx: camp.next, credits: CP().budget[camp.next] + (CP().bonus[g.grade] || 0) + (camp.bank || 0) } : null;
        camp.bank = 0;
        lastEnd.advanced = true;
      }
      saveCamp();
    }
    clearTimeout(debTimer);
    debTimer = setTimeout(debrief, 900);
  }

  function debrief() {
    const L = lastEnd; if (!L) return;
    if (L.endless) return survDebrief();
    const { p, g } = L, st = p.stats || {}, f = st.fired || {}, t = L.tally;
    const bar = (name, w, v, detail) => `<div class="comp"><span>${name} <small>${w} · ${esc(detail)}</small></span><span class="barx"><i class="${v >= 70 ? '' : v >= 40 ? 'amber' : 'red'}" style="width:${v}%"></i></span><span>${v}</span></div>`;
    const shots = (f.lance || 0) + (f.dart || 0) + Math.round((f.harrow || 0) / 40);
    const rows = W3.map(w => `<tr><td>${WL[w]}</td><td>${f[w] || 0}${w === 'harrow' ? ' rds' : ''}</td><td>${t.kills[w] || 0}</td><td>${t.misses[w] || 0}</td><td>${L.reserve[w]}</td></tr>`).join('');
    const isC = L.mode && L.mode.type === 'campaign', n = CP().shifts.length;
    const best = isC ? camp.best[CP().shifts[L.mode.idx].id] : null;
    let actions = '', note = '';
    if (isC) {
      if (L.advanced && camp.next < n) { note = `<p class="ok" style="text-align:center">${esc(CP().shifts[camp.next].name)} unlocked.</p>`; actions = btn('resupply', 'RESUPPLY ▸', 'pri', 'id="m-toresupply"') + btn('map', 'CAMPAIGN MAP', 'dim'); }
      else if (L.advanced) { note = '<p class="ok" style="text-align:center">CAMPAIGN COMPLETE. The line held. Varenna thanks you, Kessel.</p>'; actions = btn('map', 'CAMPAIGN MAP', 'pri') + btn('menu', 'MAIN MENU', 'dim'); }
      else actions = `<div class="row2">${btn('retry', 'RETRY SHIFT', g.failed ? 'amb' : '', 'id="m-retry"')}${btn('map', 'CAMPAIGN MAP', 'dim')}</div>`;
    } else actions = `<div class="row2">${btn('retry', 'SAME AGAIN', '', 'id="m-retry"')}${btn('free', 'NEW SETUP', '')}</div>` + btn('menu', 'MAIN MENU', 'dim');
    show('debrief', `<div class="kick" style="text-align:center">DEBRIEF · ${esc((L.def && L.def.name) || '')}</div>` +
      `<div class="muted" style="text-align:center;letter-spacing:.2em">SHIFT ${g.failed ? '<span class="red">FAILED</span>' : 'COMPLETE'}</div>` +
      `<div class="grade ${gcol(g.grade)}" id="m-grade">${g.grade}</div>` +
      `<p style="text-align:center">${esc(g.reason)} · score <b>${g.score}</b>/100${best ? ` · best <b class="${gcol(best)}">${best}</b>` : ''}</p>` + note +
      `<div class="box">${bar('ASSET', '40%', g.parts.asset, Math.round(L.hp * 100) + '% intact')}${bar('LEAKERS', '20%', g.parts.leakers, (st.leakers || 0) + ' through')}` +
      `${bar('AMMO', '20%', g.parts.ammo, (st.kills || 0) + ' kills / ' + shots + ' shots')}${bar('REACTION', '20%', g.parts.reaction, g.meanRt == null ? 'no engagements' : 'mean ' + g.meanRt.toFixed(0) + ' s')}</div>` +
      `<div class="kvs"><div><b>KILLS</b><span>${st.kills || 0}</span></div><div><b>MISSES</b><span>${st.misses || 0}</span></div><div><b>LEAKERS</b><span class="${st.leakers ? 'amber' : ''}">${st.leakers || 0}</span></div></div>` +
      medalBox(L) + replayBox(L) +
      `<div class="box"><table><tr><th>WEAPON</th><th>FIRED</th><th>KILLS</th><th>MISSES</th><th>RESERVE</th></tr>${rows}</table></div>` +
      actions);
    setupReplay(L);
  }
  function weaponTable(L) {
    const f = (L.p.stats || {}).fired || {}, t = L.tally;
    return `<div class="box"><table><tr><th>WEAPON</th><th>FIRED</th><th>KILLS</th><th>MISSES</th><th>RESERVE</th></tr>` +
      W3.map(w => `<tr><td>${WL[w]}</td><td>${f[w] || 0}${w === 'harrow' ? ' rds' : ''}</td><td>${t.kills[w] || 0}</td><td>${t.misses[w] || 0}</td><td>${L.reserve[w]}</td></tr>`).join('') + '</table></div>';
  }

  /* ---------- medals (contract §4) ---------- */
  const MEDALS = {
    clean: { l: 'CLEAN SKIES', s: 'CLEAN', c: '#3ff0d0', d: 'No leakers' },
    marksman: { l: 'MARKSMAN', s: 'MARKS', c: '#ffb020', d: '70%+ first-shot kills' },
    iron: { l: 'IRON DOME', s: 'IRON', c: '#45ff84', d: 'Asset 100% intact' },
    quiet: { l: 'QUIET RADAR', s: 'QUIET', c: '#7aa8ff', d: 'Never emitted > 90 s' },
    fof: { l: 'FRIEND OR FOE', s: 'IFF', c: '#c58cff', d: 'Friendly identified, never shot at' },
    miser: { l: 'MISER', s: 'MISER', c: '#e8d36a', d: '≤ 1.3 rounds per kill' },
    survivor: { l: 'SURVIVOR', s: 'SURV', c: '#ff6a55', d: 'Reached wave 10' } };
  const MEDAL_IDS = Object.keys(MEDALS);
  /** Medals earned this shift. stats = SHIFT_END stats (V1.1 fields optional); ctx {hp, failed, endless, wave, tally}. */
  function medals(st, ctx) {
    ctx = ctx || {}; const T = ctx.tally || newTally(), out = [], kills = st.kills || 0, f = st.fired || {};
    if (ctx.endless && (ctx.wave || 0) >= 10) out.push('survivor');
    if (ctx.failed) return out;
    const fsk = typeof st.firstShotKills === 'number' ? st.firstShotKills : T.fsk;
    const maxEmit = typeof st.maxEmit === 'number' ? st.maxEmit : T.maxEmit;
    const atFriends = typeof st.shotsAtFriends === 'number' ? st.shotsAtFriends : T.shotFriend;
    const rounds = (f.lance || 0) + (f.dart || 0) + (f.harrow || 0) / 40;
    if (!ctx.endless && !(st.leakers || 0) && kills >= 1) out.push('clean');
    if (kills >= 4 && fsk / kills >= 0.7) out.push('marksman');
    if ((ctx.hp == null ? 1 : ctx.hp) >= 0.999 && kills >= 1) out.push('iron');
    if (maxEmit > 0 && maxEmit <= 90) out.push('quiet');
    if (Object.keys(T.friends).length && !atFriends) out.push('fof');
    if (kills >= 3 && rounds / kills <= 1.3) out.push('miser');
    return MEDAL_IDS.filter(k => out.includes(k));
  }
  const medalBox = L => `<div class="box" id="m-medals"><div class="sec">MEDALS</div>` + (L.medals && L.medals.length
    ? `<div class="medals">${L.medals.map(k => `<span class="medal" data-medal="${k}" style="--mc:${MEDALS[k].c}">${MEDALS[k].l}<small>${esc(MEDALS[k].d)}</small></span>`).join('')}</div>`
    : '<p class="muted" style="font-size:11px">None this time. Try: no leakers, first-shot kills, a quiet radar, or an untouched asset.</p>') + '</div>';

  /* ---------- survival ---------- */
  /** score = waves survived × 1000 + kills × 100 + asset % × 5 */
  function survivalScore(st, hp) {
    const waves = st.waves || 0, kills = st.kills || 0, asset = Math.round(Math.max(0, Math.min(1, hp || 0)) * 100);
    return { waves, kills, asset, score: waves * 1000 + kills * 100 + asset * 5 };
  }
  function hsTable(hl) {
    if (!surv.best.length) return '<p class="muted" style="font-size:11px">No runs yet.</p>';
    return `<table id="m-hs"><tr><th>#</th><th>SCORE</th><th>WAVE</th><th>KILLS</th><th>SEED</th></tr>` + surv.best.map((b, i) =>
      `<tr class="${b === hl ? 'me' : ''}"><td>${i + 1}</td><td>${b.score}</td><td>${b.waves}</td><td>${b.kills}</td><td>${b.seed}</td></tr>`).join('') + '</table>';
  }
  function survSetup() {
    const can = !!(content().makeSurvivalShift);
    show('surv', `<div class="kick">SURVIVAL</div><h2>HOLD THE LINE</h2>` +
      `<p class="muted">Endless raids, each wave heavier than the last. The magazine is topped up between waves. The run ends when the site falls.</p>` +
      `<div class="box"><div class="sec">SEED</div><div class="seedrow"><input type="number" id="m-sseed" inputmode="numeric" min="1" max="999999" value="${surv.seed}" aria-label="survival seed">${btn('srseed', 'RANDOM', 'dim', 'id="m-srseed"')}</div></div>` +
      `<div class="box"><div class="sec">BEST RUNS</div>${hsTable(null)}<div class="muted" style="font-size:10px;margin-top:6px">Score = waves survived × 1000 + kills × 100 + asset % × 5</div></div>` +
      (can ? '' : '<p class="amber" style="font-size:12px">Survival is not available in this build.</p>') +
      btn('sbrief', 'BRIEFING ▸', 'pri', `id="m-sbrief" ${can ? '' : 'disabled'}`) + btn('menu', '◂ MENU', 'dim'));
  }
  function readSurv() {
    const si = document.getElementById('m-sseed');
    if (si) { const v = Math.floor(Math.abs(+si.value)); surv.seed = v > 0 && v < 1e9 ? v : 1; }
  }
  function buildSurvival(seed) {
    const d = content().makeSurvivalShift(seed);
    d.endless = true;
    if (!d.weather) d.weather = seededWx(seed);
    return d;
  }
  function survDebrief() {
    const L = lastEnd, st = L.p.stats || {}, sc = L.sc, frat = st.fratricide;
    const why = frat ? 'Fratricide: a friendly aircraft was shot down' : L.hp <= 0 ? 'The defended site was destroyed' : 'Run ended by the battery commander';
    show('debrief', `<div class="kick" style="text-align:center">DEBRIEF · ${esc((L.def && L.def.name) || 'Survival')}</div>` +
      `<div class="muted" style="text-align:center;letter-spacing:.2em">RUN OVER</div>` +
      `<div class="grade wv" id="m-wave">WAVE ${L.wave || 1}</div>` +
      `<p style="text-align:center">${esc(why)} · <b>${sc.waves}</b> wave${sc.waves === 1 ? '' : 's'} survived</p>` +
      `<div class="box" style="text-align:center"><div class="sec">SCORE</div><div style="font-size:30px;color:#45ff84" id="m-sscore">${sc.score}</div>` +
      `<div class="muted" style="font-size:11px">${sc.waves} waves × 1000 + ${sc.kills} kills × 100 + asset ${sc.asset}% × 5</div>` +
      (L.rank === 0 ? '<p class="amber" style="margin-top:4px">NEW BEST</p>' : L.rank > 0 ? `<p class="amber" style="margin-top:4px">#${L.rank + 1} on the board</p>` : '') + '</div>' +
      `<div class="kvs"><div><b>KILLS</b><span>${st.kills || 0}</span></div><div><b>MISSES</b><span>${st.misses || 0}</span></div><div><b>LEAKERS</b><span class="${st.leakers ? 'amber' : ''}">${st.leakers || 0}</span></div></div>` +
      medalBox(L) + replayBox(L) + weaponTable(L) +
      `<div class="box"><div class="sec">BEST RUNS</div>${hsTable(L.entry)}</div>` +
      `<div class="row2">${btn('sagain', 'SAME SEED', 'pri', 'id="m-sagain"')}${btn('snew', 'NEW SEED', '', 'id="m-snew"')}</div>` + btn('menu', 'MAIN MENU', 'dim'));
    setupReplay(L);
  }

  /* ---------- replay mini-scope (contract §4) ----------
     History source: RS.sim.history {samples:[{t, tr:[[id,x,y,cls]]}], events:[{t,type,id,x,y}]} when the sim provides it,
     otherwise meta's own light recorder (2 s samples from SIM_TICK + bus events). */
  const rec = { samples: [], events: [], next: 0 };
  const simHist = () => RS.sim && RS.sim.history && Array.isArray(RS.sim.history.samples) ? RS.sim.history : null;
  const histSrc = () => simHist() || rec;
  const CLSC = { UNKNOWN: '#ffb020', HOSTILE: '#ff4b3a', FRIEND: '#3ff0d0', PENDING: '#ffb020' };
  let rp = null;
  function replayBox(L) {
    if (!L.hist || L.hist.samples.length < 2) return '';
    return `<div class="box rp" id="m-replay"><div class="sec">REPLAY · 20×</div><canvas id="m-rpc" aria-label="replay scope"></canvas>` +
      `<div class="rpc"><button class="mb" data-m="rpplay" id="m-rpplay" aria-label="play or pause replay">▶</button>` +
      `<input type="range" id="m-rpscrub" min="0" max="1000" step="1" value="0" aria-label="replay position"><span id="m-rpt">0:00</span></div>` +
      `<div class="rpk"><span style="color:#ffb020">● unknown</span><span style="color:#ff4b3a">● hostile</span><span style="color:#3ff0d0">● friend</span><span>✕ kill</span><span style="color:#ffb020">! leaker</span><span>— launch</span></div></div>`;
  }
  function stopReplay() { if (rp && rp.raf) cancelAnimationFrame(rp.raf); if (rp) rp.raf = 0; rp = null; }
  function setupReplay(L) {
    stopReplay();
    const cv = document.getElementById('m-rpc'); if (!cv || !L.hist) return;
    const S = L.hist.samples, t0 = S[0].t, t1 = Math.max(S[S.length - 1].t, ...L.hist.events.map(e => e.t || 0));
    let ext = 10;
    for (const sm of S) for (const r of sm.tr) { const d = Math.hypot(r[1], r[2]); if (d > ext && d < 400) ext = d; }
    const first = S.find(sm => sm.tr.length);         // open on the first frame that shows traffic
    rp = { L, cv, t0, t1: Math.max(t1, t0 + 1), t: first ? first.t : t0, playing: false, raf: 0, last: 0, R: Math.min(60, Math.max(20, Math.ceil(ext / 10) * 10)) };
    drawReplay();
  }
  function rpTick(now) {
    if (!rp) return;
    if (!rp.cv.isConnected) { rp.raf = 0; rp = null; return; }
    const dt = rp.last ? Math.min(0.25, (now - rp.last) / 1000) : 0; rp.last = now;
    rp.t += dt * 20;
    if (rp.t >= rp.t1) { rp.t = rp.t1; rp.playing = false; }
    drawReplay();
    rp.raf = rp.playing ? requestAnimationFrame(rpTick) : 0;
  }
  function rpPlay(on) {
    if (!rp) return;
    rp.playing = on == null ? !rp.playing : on;
    if (rp.playing && rp.t >= rp.t1) rp.t = rp.t0;
    rp.last = 0;
    if (rp.playing && !rp.raf) rp.raf = requestAnimationFrame(rpTick);
    drawReplay();
  }
  function drawReplay() {
    const P = rp; if (!P) return;
    const cv = P.cv, dpr = Math.min(3, window.devicePixelRatio || 1), W = Math.max(120, Math.round(cv.clientWidth * dpr) || 300);
    if (cv.width !== W) { cv.width = W; cv.height = W; }
    const c = cv.getContext('2d'); if (!c) return;
    const S = P.L.hist.samples, E = P.L.hist.events, R = P.R, k = W / 2 / R / 1.04, cx = W / 2, cy = W / 2, T = P.t;
    const X = x => cx + x * k, Y = y => cy - y * k, px = n => n * dpr;
    c.clearRect(0, 0, W, W);
    c.fillStyle = '#030805'; c.beginPath(); c.arc(cx, cy, W / 2, 0, 7); c.fill();
    c.strokeStyle = 'rgba(69,255,132,.22)'; c.lineWidth = px(1); c.fillStyle = 'rgba(109,138,118,.9)'; c.font = `${px(9)}px monospace`;
    for (let i = 1; i <= 4; i++) { const r = R * i / 4 * k; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke(); c.fillText(Math.round(R * i / 4) + '', cx + px(2), cy - r + px(10)); }
    c.beginPath(); c.moveTo(cx, cy - R * k); c.lineTo(cx, cy + R * k); c.moveTo(cx - R * k, cy); c.lineTo(cx + R * k, cy); c.strokeStyle = 'rgba(69,255,132,.1)'; c.stroke();
    c.fillStyle = '#45ff84'; c.fillRect(cx - px(3), cy - px(3), px(6), px(6));
    // sample index at T (binary search)
    let lo = 0, hi = S.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].t <= T) lo = m; else hi = m - 1; }
    const idx = lo, pos = {};
    for (const r of S[idx].tr) pos[r[0]] = r;
    // tails (previous 5 samples)
    for (const id in pos) {
      const col = CLSC[pos[id][3]] || '#ffb020';
      c.strokeStyle = col; c.globalAlpha = 0.45; c.lineWidth = px(1.5); c.beginPath();
      let first = true;
      for (let j = Math.max(0, idx - 5); j <= idx; j++) { const r = S[j].tr.find(q => q[0] === id); if (!r) continue; if (first) c.moveTo(X(r[1]), Y(r[2])); else c.lineTo(X(r[1]), Y(r[2])); first = false; }
      c.stroke(); c.globalAlpha = 1;
      c.fillStyle = col; c.beginPath(); c.arc(X(pos[id][1]), Y(pos[id][2]), px(3.2), 0, 7); c.fill();
    }
    // events up to T: launches fade after 12 s, kills/leakers stay (dimmed after 30 s)
    let wave = null;
    for (const e of E) {
      if (e.t > T) break;
      const age = T - e.t, x = X(e.x || 0), y = Y(e.y || 0), a = age < 30 ? 1 : 0.35;
      switch (e.type) {
        case 'LAUNCH': {
          if (age > 12) break;
          const tg = pos[e.id] || (S[idx].tr.find(q => q[0] === e.targetId));
          c.strokeStyle = 'rgba(69,255,132,' + (1 - age / 12).toFixed(2) + ')'; c.lineWidth = px(1.2); c.setLineDash([px(3), px(3)]);
          c.beginPath(); c.moveTo(x, y); if (tg) c.lineTo(X(tg[1]), Y(tg[2])); else c.arc(x, y, px(5), 0, 7); c.stroke(); c.setLineDash([]); break;
        }
        case 'KILL': case 'FRATRICIDE': {
          const s = px(5); c.strokeStyle = e.type === 'FRATRICIDE' || e.wasFriend ? '#3ff0d0' : '#ff4b3a'; c.globalAlpha = a; c.lineWidth = px(2);
          c.beginPath(); c.moveTo(x - s, y - s); c.lineTo(x + s, y + s); c.moveTo(x + s, y - s); c.lineTo(x - s, y + s); c.stroke(); c.globalAlpha = 1; break;
        }
        case 'MISS': if (age < 8) { c.strokeStyle = 'rgba(185,214,194,.6)'; c.lineWidth = px(1); c.beginPath(); c.arc(x, y, px(5), 0, 7); c.stroke(); } break;
        case 'LEAKER': c.globalAlpha = a; c.fillStyle = '#ffb020'; c.font = `bold ${px(14)}px monospace`; c.fillText('!', x - px(3), y + px(5)); c.globalAlpha = 1; break;
        case 'ASSET_HIT': case 'ARM_IMPACT': if (age < 6) { c.strokeStyle = e.type === 'ARM_IMPACT' ? '#ffb020' : '#ff4b3a'; c.lineWidth = px(2); c.beginPath(); c.arc(cx, cy, px(8 + age * 3), 0, 7); c.stroke(); } break;
        case 'WAVE': wave = e.n != null ? e.n : e.id; break;
      }
    }
    c.fillStyle = '#6d8a76'; c.font = `${px(10)}px monospace`;
    c.fillText(`${R} km`, px(6), W - px(8));
    if (wave != null) { c.fillStyle = '#ffb020'; c.fillText('WAVE ' + wave, px(6), px(14)); }
    const sl = document.getElementById('m-rpscrub'), tl = document.getElementById('m-rpt'), pb = document.getElementById('m-rpplay');
    if (sl && document.activeElement !== sl) sl.value = String(Math.round((T - P.t0) / (P.t1 - P.t0) * 1000));
    if (tl) tl.textContent = mmss(T);
    if (pb) pb.textContent = P.playing ? 'II' : '▶';
  }
  function newTally() { return { kills: {}, misses: {}, mis: {}, first: {}, icpt: {}, fsk: 0, friends: {}, shotFriend: 0, emitOn: null, maxEmit: 0 }; }

  function resupply() {
    const pend = camp.pending; if (!pend) return map();
    mode = { type: 'campaign', idx: pend.idx, frontier: true };
    buy = buy && buy.idx === pend.idx ? buy : { idx: pend.idx, lance: 0, dart: 0, harrow: 0 };
    renderResupply();
  }
  const costOf = b => W3.reduce((a, w) => a + (w === 'harrow' ? b[w] / 100 : b[w]) * CP().prices[w], 0);
  function renderResupply() {
    const pend = camp.pending, P = CP().prices, stp = CP().step, mx = CP().max, spent = costOf(buy), left = pend.credits - spent;
    const rows = W3.map(w => {
      const have = camp.reserve[w] + buy[w], unit = (w === 'harrow' ? P[w] : P[w] * stp[w]);
      const canAdd = left >= unit && have + stp[w] <= mx[w];
      return `<div class="step" data-w="${w}"><span><b class="ok">${WL[w]}</b><br><span class="muted" style="font-size:11px">${w === 'harrow' ? P[w] + ' cr / 100 rds' : P[w] + ' cr each'} · have ${camp.reserve[w]}</span></span>` +
        `<button class="sb" data-m="dec" data-w="${w}" aria-label="less ${w}" ${buy[w] > 0 ? '' : 'disabled'}>−</button>` +
        `<span class="q" id="m-q-${w}">${have}</span>` +
        `<button class="sb" data-m="inc" data-w="${w}" aria-label="more ${w}" ${canAdd ? '' : 'disabled'}>+</button></div>`;
    }).join('');
    const bonus = lastEnd && lastEnd.g && CP().bonus[lastEnd.g.grade] ? ` (incl. +${CP().bonus[lastEnd.g.grade]} for grade ${lastEnd.g.grade})` : '';
    show('resupply', `<div class="kick">RESUPPLY · BEFORE SHIFT ${pend.idx + 1}</div><h2>MAGAZINE ORDER</h2>` +
      `<p class="muted">Budget ${pend.credits} cr${esc(bonus)}. Unused reserve carries over; unspent credits are banked.</p>` +
      `<div class="box">${rows}</div>` +
      `<div class="box tot"><span>SPEND <b class="${left < 0 ? 'red' : 'amber'}" id="m-spent">${spent}</b> cr</span><span>LEFT <b class="ok" id="m-left">${left}</b> cr</span></div>` +
      `<div class="box"><div class="sec">RESERVE FOR SHIFT ${pend.idx + 1}</div>${resTxt({ lance: camp.reserve.lance + buy.lance, dart: camp.reserve.dart + buy.dart, harrow: camp.reserve.harrow + buy.harrow })}</div>` +
      btn('confirm', 'CONFIRM ▸ BRIEFING', 'pri', 'id="m-confirm"') + btn('map', '◂ CAMPAIGN MAP', 'dim'));
  }
  function stepBuy(w, dir) {
    const stp = CP().step[w], mx = CP().max[w];
    if (dir < 0) buy[w] = Math.max(0, buy[w] - stp);
    else if (camp.pending.credits - costOf(buy) >= (w === 'harrow' ? CP().prices[w] : CP().prices[w] * stp) && camp.reserve[w] + buy[w] + stp <= mx) buy[w] += stp;
    renderResupply();
  }
  function confirmBuy() {
    const pend = camp.pending, left = pend.credits - costOf(buy);
    for (const w of W3) camp.reserve[w] += buy[w];
    camp.bank = Math.max(0, Math.round(left));
    camp.pending = null; buy = null;
    saveCamp();
    mode = { type: 'campaign', idx: pend.idx, frontier: true };
    briefing(campDef(pend.idx));
  }

  /* ---------- free watch ---------- */
  const EVT = [['night', 'NIGHT'], ['storm', 'STORM'], ['radar_fault', 'RADAR FAULT'], ['launcher_jam', 'LAUNCHER JAM'], ['friendly_iff_failure', 'FRIENDLY IFF FAILURE'], ['late_resupply', 'LATE RESUPPLY']];
  const diffLabel = d => d < 0.34 ? 'Easy' : d < 0.67 ? 'Normal' : 'Hard';
  function defaultFree() { return { seed: 1 + Math.floor(Math.random() * 99999), diff: 0.5, dur: 480, ev: {}, time: 'random', sky: 'random' }; }
  const pickRow = (act, cur, vals, cls, idp) => `<div class="${cls}">${['random'].concat(vals).map(v => btn(act, v === 'random' ? 'ANY' : v.toUpperCase(), 'pk', `data-v="${v}" id="${idp}-${v}" aria-pressed="${cur === v}"`)).join('')}</div>`;
  function free() {
    const o = freeOpts;
    show('free', `<div class="kick">FREE WATCH</div><h2>SETUP</h2>` +
      `<div class="box"><div class="sec">SEED</div><div class="seedrow"><input type="number" id="m-seed" inputmode="numeric" min="1" max="999999" value="${o.seed}" aria-label="seed">${btn('rseed', 'RANDOM', 'dim', 'id="m-rseed"')}</div></div>` +
      `<div class="box"><div class="sec">DIFFICULTY · <span class="amber" id="m-dlabel">${diffLabel(o.diff)} ${o.diff.toFixed(2)}</span></div>` +
      `<input type="range" id="m-diff" min="0" max="1" step="0.05" value="${o.diff}" aria-label="difficulty"><div class="tot muted" style="font-size:10px"><span>EASY</span><span>NORMAL</span><span>HARD</span></div></div>` +
      `<div class="box"><div class="sec">RANDOM EVENTS</div><div class="row2">${EVT.map(([k, l]) => `<button class="tg" data-m="tev" data-k="${k}" id="m-ev-${k}" aria-pressed="${!!o.ev[k]}">${l}<em>${o.ev[k] ? 'ON' : 'OFF'}</em></button>`).join('')}</div></div>` +
      `<div class="box"><div class="sec">TIME OF DAY</div>${pickRow('ftime', o.time, TIMES, 'seg5', 'm-time')}` +
      `<div class="sec" style="margin-top:8px">SKY</div>${pickRow('fsky', o.sky, SKIES, 'seg4', 'm-sky')}</div>` +
      `<div class="box"><div class="sec">DURATION</div><div class="seg">${[360, 480, 600].map(d => btn('dur', (d / 60) + ' MIN', d === o.dur ? 'pri' : 'dim', `data-d="${d}" id="m-dur-${d / 60}"`)).join('')}</div></div>` +
      btn('fbrief', 'BRIEFING ▸', 'pri', 'id="m-fbrief"') + btn('menu', '◂ MENU', 'dim'));
  }
  function readFree() {
    const si = document.getElementById('m-seed'), di = document.getElementById('m-diff');
    if (si) { const v = Math.floor(Math.abs(+si.value)); freeOpts.seed = v > 0 && v < 1e9 ? v : 1; }
    if (di) freeOpts.diff = Math.max(0, Math.min(1, +di.value || 0));
  }
  /** Build a free-watch ShiftDef: content.makeFreeShift(seed, difficulty) + duration scaling + toggled random events. */
  function buildFree(o) {
    const d = content().makeFreeShift(o.seed, o.diff, { weather: { time: o.time, sky: o.sky } }), k = o.dur / 480;
    const r = content().mulberry32(((o.seed >>> 0) ^ 0x5eed1234) >>> 0), rng = (a, b) => Math.round(a + (b - a) * r());
    for (const s of d.spawns) s.t = Math.round(s.t * k);
    for (const c of d.comms) c.t = Math.round(c.t * k);
    for (const c of d.roeChanges || []) c.t = Math.round(c.t * k);
    d.duration = o.dur;
    d.name = `Free Watch #${o.seed} · ${diffLabel(o.diff)}`;
    d.id = `F${o.seed}-${Math.round(o.diff * 100)}`;
    const w = Object.assign({}, d.weather || seededWx(o.seed));
    if (TIMES.includes(o.time)) w.time = o.time;
    if (SKIES.includes(o.sky)) w.sky = o.sky;
    d.weather = { time: w.time, sky: w.sky };
    const T = o.dur, ev = [], say = (t, from, text, pr) => d.comms.push({ t: Math.max(1, t), from, text, priority: pr || 'normal' });
    if (o.ev.night) { ev.push({ t: 0, kind: 'night', duration: T, detail: 'night' }); say(4, 'HQ', 'Night watch. Trust the scope.', 'low'); }
    if (o.ev.storm) { const t = rng(40, T * 0.4), du = rng(120, 200); ev.push({ t, kind: 'storm', duration: du, detail: 'storm cell' }); say(t - 15, 'HQ', 'Storm cell moving over the site. Expect clutter.'); }
    if (o.ev.radar_fault) { const t = rng(100, T - 120); ev.push({ t, kind: 'radar_fault', duration: rng(18, 30), detail: 'radar fault' }); }
    if (o.ev.launcher_jam) { const t = rng(90, T - 90); ev.push({ t, kind: 'launcher_jam', duration: 25, detail: ['L1', 'L2', 'L3'][rng(0, 2)] }); }
    if (o.ev.friendly_iff_failure) { const t = rng(90, T - 150); ev.push({ t, kind: 'friendly_iff_failure', duration: 60, detail: 'interrogator degraded' }); say(t - 2, 'BATTERY', 'Interrogator fault. IFF replies unreliable for about a minute.', 'high'); }
    if (o.ev.late_resupply) { const t = rng(150, T - 150); ev.push({ t, kind: 'late_resupply', duration: 60, detail: { lance: 4, dart: 4, harrow: 300 } }); say(t, 'BATTERY', 'Resupply truck delayed. Reserve top-up in one minute.'); }
    d.events = (d.events || []).concat(ev).sort((a, b) => a.t - b.t);
    d.comms.sort((a, b) => a.t - b.t);
    return d;
  }

  /* ---------- settings ---------- */
  function settings() {
    const hint = RS.audio && RS.audio.hint ? `<p class="amber" style="font-size:12px">${esc(RS.audio.hint)}</p>` : '';
    show('settings', `<div class="kick">SETTINGS</div><h2>CONSOLE</h2>` +
      `<button class="tg" data-m="sound" id="m-sound" aria-pressed="${cfg.sound}">SOUND<em>${cfg.sound ? 'ON' : 'OFF'}</em></button>${hint}` +
      `<button class="tg" data-m="haptics" id="m-haptics" aria-pressed="${cfg.haptics}">HAPTICS<em>${cfg.haptics ? 'ON' : 'OFF'}</em></button>` +
      (RS.tutorial && RS.tutorial.start ? btn('train', 'TRAINING<small>Replay the guided first watch</small>', 'dim col', 'id="m-strain"') : '') +
      `<div class="box"><div class="sec">PROGRESS</div><p style="margin-bottom:8px">Campaign: shift ${Math.min(camp.next + 1, CP().shifts.length)} of ${CP().shifts.length}${camp.next >= CP().shifts.length ? ' (complete)' : ''}.</p>` +
      (resetArm ? `<p class="red" style="margin-bottom:8px">Erase all campaign progress? This cannot be undone.</p><div class="row2">${btn('resetyes', 'ERASE', 'red', 'id="m-resetyes"')}${btn('resetno', 'CANCEL', 'dim')}</div>`
        : btn('reset', 'RESET PROGRESS', 'amb', 'id="m-reset"')) + `</div>` +
      btn('menu', '◂ MENU', 'dim'));
  }

  /* ---------- pause ---------- */
  function pause() {
    const s = RS.sim.state;
    if (!s.shift.running || screen) return false;
    RS.main.pause();
    const tut = !!(curDef && curDef.tutorial), endless = !!(s.shift.endless || (curDef && curDef.endless));
    const when = endless ? `WAVE ${s.shift.wave || 1} · ${mmss(s.shift.elapsed)}` : `${mmss(s.shift.elapsed)} / ${mmss(s.shift.duration)}`;
    show('pause', `<div style="height:8vh"></div><div class="kick" style="text-align:center">PAUSED</div><h2 style="text-align:center">${esc(s.shift.name)}</h2>` +
      `<p class="muted" style="text-align:center">${when}</p>` +
      btn('resume', 'RESUME', 'pri', 'id="m-resume"') +
      (tut ? '' : btn('restart', endless ? 'RESTART RUN' : 'RESTART SHIFT', 'amb', 'id="m-restart"')) +
      (endless ? btn('endrun', 'END RUN<small>Bank the score</small>', 'amb col', 'id="m-endrun"') : '') +
      btn('quit', tut ? 'QUIT TRAINING' : 'QUIT TO MENU', 'red', 'id="m-quit"'));
    return true;
  }
  function resume() { if (screen !== 'pause') return false; hide(); RS.main.resume(); return true; }
  function restart() {
    hide(); tally = newTally();
    RS.main.restart();
    pbtn.classList.add('on');
  }
  function quit() {
    const tut = !!(curDef && curDef.tutorial);
    if (tut && RS.tutorial && RS.tutorial.stop) try { RS.tutorial.stop(); } catch (e) { /* tutorial optional */ }
    if (RS.sim.state.shift.running) RS.sim.endShift('quit');
    if (RS.main.hold) RS.main.hold(false);
    RS.main.resume();
    !tut && mode && mode.type === 'campaign' ? map() : menu();
  }
  function endRun() { hide(); RS.main.resume(); if (RS.sim.state.shift.running) RS.sim.endShift('ended'); }
  function training() {
    if (!RS.tutorial || !RS.tutorial.start) return menu();
    hide(); if (RS.title) RS.title.backdrop(false);
    RS.tutorial.start();
  }

  /* ---------- input ---------- */
  function onClick(e) {
    const el = e.target.closest('[data-m]'); if (!el || el.disabled) return;
    const a = el.dataset.m;
    if (a !== 'noop') tap();
    switch (a) {
      case 'menu': resetArm = false; stopReplay(); return menu();
      case 'map': return map();
      case 'pick': return pick(+el.dataset.i);
      case 'begin': return startShift(curDef);
      case 'resupply': return resupply();
      case 'inc': return stepBuy(el.dataset.w, 1);
      case 'dec': return stepBuy(el.dataset.w, -1);
      case 'confirm': return confirmBuy();
      case 'retry': {
        const L = lastEnd; if (!L) return menu();
        mode = L.mode;
        if (mode.type === 'campaign') { mode.frontier = mode.idx === camp.next; return briefing(campDef(mode.idx)); }
        if (mode.type === 'survival') return briefing(buildSurvival(mode.seed));
        return briefing(clone(L.def));
      }
      case 'free': return free();
      case 'ftime': readFree(); freeOpts.time = el.dataset.v; save('free', freeOpts); return free();
      case 'fsky': readFree(); freeOpts.sky = el.dataset.v; save('free', freeOpts); return free();
      case 'surv': return survSetup();
      case 'srseed': surv.seed = 1 + Math.floor(Math.random() * 99999); save('survival', surv); return survSetup();
      case 'sbrief': readSurv(); save('survival', surv); mode = { type: 'survival', seed: surv.seed }; return briefing(buildSurvival(surv.seed));
      case 'sagain': mode = { type: 'survival', seed: (lastEnd && lastEnd.mode && lastEnd.mode.seed) || surv.seed }; return briefing(buildSurvival(mode.seed));
      case 'snew': surv.seed = 1 + Math.floor(Math.random() * 99999); save('survival', surv); mode = { type: 'survival', seed: surv.seed }; return briefing(buildSurvival(surv.seed));
      case 'endrun': return endRun();
      case 'train': return training();
      case 'rpplay': return rpPlay();
      case 'rseed': readFree(); freeOpts.seed = 1 + Math.floor(Math.random() * 99999); save('free', freeOpts); return free();
      case 'tev': readFree(); freeOpts.ev[el.dataset.k] = !freeOpts.ev[el.dataset.k]; save('free', freeOpts); return free();
      case 'dur': readFree(); freeOpts.dur = +el.dataset.d; save('free', freeOpts); return free();
      case 'fbrief': readFree(); save('free', freeOpts); mode = { type: 'free', opts: clone(freeOpts) }; return briefing(buildFree(freeOpts));
      case 'settings': resetArm = false; return settings();
      case 'sound': cfg.sound = !cfg.sound; applySettings(); save('settings', cfg); return settings();
      case 'haptics': cfg.haptics = !cfg.haptics; applySettings(); save('settings', cfg); if (cfg.haptics) try { navigator.vibrate && navigator.vibrate(20); } catch (x) { /* */ } return settings();
      case 'reset': resetArm = true; return settings();
      case 'resetno': resetArm = false; return settings();
      case 'resetyes': resetArm = false; reset(); return settings();
      case 'resume': return resume();
      case 'restart': return restart();
      case 'quit': return quit();
    }
  }
  function onInput(e) {
    if (e.target.id === 'm-diff') { readFree(); const l = document.getElementById('m-dlabel'); if (l) l.textContent = diffLabel(freeOpts.diff) + ' ' + freeOpts.diff.toFixed(2); save('free', freeOpts); }
    else if (e.target.id === 'm-seed') { readFree(); save('free', freeOpts); }
    else if (e.target.id === 'm-sseed') { readSurv(); save('survival', surv); }
    else if (e.target.id === 'm-rpscrub' && rp) { rp.t = rp.t0 + (rp.t1 - rp.t0) * (+e.target.value / 1000); drawReplay(); }
  }

  function reset() { camp = freshCamp(); buy = null; saveCamp(); }

  /** Grade a finished shift (delegates to RS.campaign.grade; see campaign.js). */
  function grade(stats, state) { return CP().grade(stats, state || RS.sim.state); }

  function init() {
    if (root) { menu(); return; }
    const st = document.createElement('style'); st.id = 'meta-style'; st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'meta'; root.setAttribute('role', 'dialog');
    mc = document.createElement('div'); mc.className = 'mc'; root.appendChild(mc);
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    pbtn = document.createElement('button'); pbtn.id = 'm-pause'; pbtn.setAttribute('aria-label', 'Pause'); pbtn.textContent = 'II';
    pbtn.addEventListener('click', () => { tap(); pause(); });
    (document.getElementById('hatch') || document.body).appendChild(pbtn);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'p') { if (screen === 'pause') resume(); else pause(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

    camp = loadCamp();
    cfg = Object.assign({ sound: true, haptics: true, voice: true }, load('settings', {}));
    const fo = load('free', null);
    freeOpts = Object.assign(defaultFree(), fo && typeof fo === 'object' ? fo : {});
    freeOpts.ev = Object.assign({}, freeOpts.ev);
    const so = load('survival', null);
    surv = { seed: 1 + Math.floor(Math.random() * 99999), best: [] };
    if (so && typeof so === 'object') {
      if (+so.seed > 0) surv.seed = Math.floor(+so.seed);
      if (Array.isArray(so.best)) surv.best = so.best.filter(b => b && typeof b.score === 'number').slice(0, 5);
    }
    wrapVibrate(); applySettings();

    RS.bus.on('SHIFT_END', onEnd);
    const truthFriend = id => { try { const k = RS.sim.debugTruth && RS.sim.debugTruth(id); return !!(k && ((content().friendlyKinds || {})[k] || FRIENDK[k])); } catch (e) { return false; } };
    RS.bus.on('LAUNCH', p => {
      if (!tally) return;
      tally.mis[p.missileId] = p.weapon;
      if (p.targetId && !(p.targetId in tally.first)) tally.first[p.targetId] = p.missileId;
      if (p.targetId && truthFriend(p.targetId)) tally.shotFriend++;
    });
    RS.bus.on('GUN_FIRE', p => { if (tally && p.targetId && truthFriend(p.targetId)) tally.shotFriend++; });
    RS.bus.on('INTERCEPT', p => { if (tally) tally.icpt[p.targetId] = p.missileId; });
    RS.bus.on('KILL', p => {
      if (tally && !p.wasFriend) { tally.kills[p.weapon] = (tally.kills[p.weapon] || 0) + 1; if (tally.first[p.targetId] && tally.first[p.targetId] === tally.icpt[p.targetId]) tally.fsk++; }
      recEv('KILL', p.targetId, p.x, p.y, { wasFriend: !!p.wasFriend });
    });
    RS.bus.on('MISS', p => { if (tally) { const w = tally.mis[p.missileId] || 'harrow'; tally.misses[w] = (tally.misses[w] || 0) + 1; } const t = trk(p.targetId); recEv('MISS', p.targetId, t && t.x, t && t.y); });
    RS.bus.on('CLASSIFIED', p => { if (tally && p.cls === 'FRIEND' && truthFriend(p.id)) tally.friends[p.id] = 1; });
    RS.bus.on('RADAR_STATE', p => {
      if (!tally) return; const t = RS.sim.state.t;
      if (p.on) tally.emitOn = t; else if (tally.emitOn != null) { tally.maxEmit = Math.max(tally.maxEmit, t - tally.emitOn); tally.emitOn = null; }
    });
    // fallback history recorder (only when the sim does not keep RS.sim.history)
    const trk = id => RS.sim.state.tracks.find(t => t.id === id);
    const r1 = v => Math.round((+v || 0) * 10) / 10;
    function recEv(type, id, x, y, extra) { if (simHist() || !RS.sim.state.shift.running) return; rec.events.push(Object.assign({ t: r1(RS.sim.state.t), type, id, x: r1(x), y: r1(y) }, extra)); }
    RS.bus.on('SHIFT_START', () => { rec.samples = []; rec.events = []; rec.next = 0; });
    RS.bus.on('SIM_TICK', p => {
      if (simHist() || p.t < rec.next) return;
      rec.next = p.t + 2;
      rec.samples.push({ t: r1(p.t), tr: RS.sim.state.tracks.map(t => [t.id, r1(t.x), r1(t.y), t.cls]) });
      if (rec.samples.length > 900) rec.samples.shift();
    });
    RS.bus.on('LAUNCH', p => recEv('LAUNCH', p.targetId, 0, 0));
    RS.bus.on('LEAKER', p => { const t = trk(p.id); recEv('LEAKER', p.id, t && t.x, t && t.y); });
    RS.bus.on('ASSET_HIT', p => recEv('ASSET_HIT', p.byId, 0, 0));
    RS.bus.on('ARM_IMPACT', () => recEv('ARM_IMPACT', null, 0, 0));
    RS.bus.on('WAVE', p => recEv('WAVE', p.n, 0, 0));
    menu();
  }

  const SCREENS = { menu, map, free, settings, resupply, debrief, survival: survSetup, surv: survSetup };
  RS.meta = { init, startShift, show: n => SCREENS[n] && SCREENS[n](),
    pause, resume, restart, quit, grade, reset, buildFree, buildSurvival, survivalScore, medals, threatWords, wxLine, MEDALS,
    replay: { play: on => rpPlay(on), seek: t => { if (rp) { rp.t = Math.max(rp.t0, Math.min(rp.t1, t)); drawReplay(); } }, get state() { return rp && { t: rp.t, t0: rp.t0, t1: rp.t1, playing: rp.playing, R: rp.R }; } },
    get screen() { return screen; }, get campaign() { return camp; }, get settings() { return cfg; }, get survival() { return surv; }, get last() { return lastEnd; }, get def() { return curDef; } };
})();
