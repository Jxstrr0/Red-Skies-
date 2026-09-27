/* =====================================================================
   RED SKIES — meta.js   RS.meta : menus, briefing, debrief, resupply, free watch, settings, pause.
   Owns its own DOM (#meta overlay + #m-pause in the hatch) and injects its own <style>.
   API: init(), startShift(def), show(screen), pause(), resume(), restart(), quit(), grade(stats, state),
        get screen, get campaign, get settings, reset()
   Save keys (RS.save/RS.load, main.js): 'campaign' {next, unlocked, best:{id:grade}, results[], reserve, pending, bank},
        'settings' {sound, haptics}, 'free' {seed, diff, dur, ev:{}}
   ===================================================================== */
(function () {
  const RS = window.RS;
  RS.settings = RS.settings || { haptics: true, sound: true };
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
`;

  let root, mc, pbtn;
  let camp = null, cfg = null, freeOpts = null;
  let screen = null, mode = null;            // mode: {type:'campaign', idx, frontier} | {type:'free', opts}
  let curDef = null, lastEnd = null, tally = null, buy = null, resetArm = false, debTimer = 0;

  /* ---------- persistence ---------- */
  const content = () => RS.content, CP = () => RS.campaign;
  const load = (k, fb) => (RS.load ? RS.load(k, fb) : fb);
  const save = (k, v) => { if (RS.save) RS.save(k, v); };
  function freshCamp() { return { next: 0, unlocked: 1, best: {}, results: [], reserve: clone(content().reserve), pending: null, bank: 0 }; }
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
    f.unlocked = Math.min(n, f.next + 1);
    return f;
  }
  function saveCamp() { camp.unlocked = Math.min(CP().shifts.length, camp.next + 1); save('campaign', camp); }
  function applySettings() {
    RS.settings.sound = cfg.sound; RS.settings.haptics = cfg.haptics;
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
    show('menu', `<h1>RED SKIES</h1><div class="sub">BATTERY KESSEL · REPUBLIC OF VARENNA</div><div style="height:18px"></div>` +
      btn('map', `CAMPAIGN<small>${sub}</small>`, 'pri col', 'id="m-campaign"') +
      btn('free', 'FREE WATCH<small>Seeded skirmish, your rules</small>', 'col', 'id="m-free"') +
      btn('settings', 'SETTINGS<small>Sound · haptics · progress</small>', 'dim col', 'id="m-settings"') +
      `<div class="sub" style="margin-top:14px">a game by Prairie Blue Studio</div>`);
  }

  function map() {
    const S = CP().shifts, rows = S.map((s, i) => {
      const locked = i > camp.next, best = camp.best[s.id], next = i === camp.next;
      const nm = s.name.replace(/^Shift \d+:\s*/, '');
      const badge = locked ? '<span class="badge s muted">LOCKED</span>' : best ? `<span class="badge ${gcol(best)}">${best}</span>` : '<span class="badge s amber">NEXT</span>';
      return `<button class="mrow${next ? ' next' : ''}" data-m="pick" data-i="${i}" ${locked ? 'disabled' : ''}><span><b>SHIFT ${i + 1}</b>${esc(nm)} <span class="muted">· ${mmss(s.duration)}</span></span>${badge}</button>`;
    }).join('');
    show('map', `<div class="kick">CAMPAIGN</div><h2>BATTERY KESSEL</h2><p class="muted">Six watches on the Varenna border. Grade D or better unlocks the next shift.</p>` +
      rows + `<div class="box"><div class="sec">MAGAZINE (NEXT SHIFT)</div>${resTxt(camp.reserve)}</div>` + btn('menu', '◂ MENU', 'dim'));
  }

  function campDef(i) {
    const d = clone(CP().shifts[i]);
    if (i === camp.next) d.reserve = clone(camp.reserve);
    else d.reserve = d.reserve || clone(content().reserve);
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
      const k = KW[s.kind] || s.kind, b = by[k] || (by[k] = { n: 0, dirs: new Set(), swarm: 0 });
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

  function briefing(def) {
    curDef = def;
    const friends = (def.spawns || []).filter(s => FRIENDK[s.kind]);
    const fr = friends.map(s => `${esc(s.callsign || 'friendly')}${s.iffBroken ? ' <span class="amber">IFF INOP</span>' : ''}`).join(', ');
    const roe = [`<b class="amber">${def.roe}</b> at start`].concat((def.roeChanges || []).map(r => `<b class="amber">${r.roe}</b> at ${mmss(r.t)}`)).join(' → ');
    const evs = [...new Set((def.events || []).map(e => e.kind))].map(k => `<li>${esc(EVW[k] || k)}</li>`).join('');
    const st = mode.type === 'campaign' ? CP().story[mode.idx] : null;
    const situation = st ? st.situation : `Free watch, seed ${mode.opts.seed}, difficulty ${diffLabel(mode.opts.diff)}. Unknown traffic along the border; friendlies use the east and north corridors.`;
    const notes = st && st.notes ? st.notes.map(n => `<li>${esc(n)}</li>`).join('') : '';
    const r = Object.assign({}, content().reserve, def.reserve);
    const kick = mode.type === 'campaign' ? `BRIEFING · SHIFT ${mode.idx + 1} OF ${CP().shifts.length}` : 'BRIEFING · FREE WATCH';
    show('briefing', `<div class="kick">${kick}</div><h2 id="m-bname">${esc(def.name.replace(/^Shift \d+:\s*/, ''))}</h2>` +
      `<p>${esc(situation)}</p>` +
      `<div class="box"><div class="sec">EXPECTED THREATS</div><ul>${threatWords(def).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` +
      (friends.length ? `<div class="box"><div class="sec">FRIENDLY TRAFFIC</div>${fr}</div>` : '') +
      (evs ? `<div class="box"><div class="sec">CONDITIONS</div><ul>${evs}</ul></div>` : '') +
      `<div class="box"><div class="sec">RULES OF ENGAGEMENT</div>Weapons ${roe}</div>` +
      `<div class="box"><div class="sec">RESERVE · WATCH ${mmss(def.duration)}</div>${resTxt(r)}<div class="muted" style="font-size:11px">Launchers start loaded (Lance 2×4, Dart 4, Harrow 600).</div></div>` +
      (notes ? `<div class="box"><div class="sec">HQ NOTES</div><ul>${notes}</ul></div>` : '') +
      btn('begin', 'BEGIN SHIFT ▸', 'pri', 'id="m-begin"') + btn(mode.type === 'campaign' ? 'map' : 'free', '◂ BACK', 'dim'));
  }

  function startShift(def) {
    def = def || curDef;
    curDef = def;
    clearTimeout(debTimer);
    hide();
    tally = { kills: {}, misses: {}, mis: {} };
    lastEnd = null;
    if (RS.main && RS.main.resume) RS.main.resume();
    RS.sim.startShift(def);
    pbtn.classList.add('on');
    return true;
  }

  function onEnd(p) {
    pbtn.classList.remove('on');
    if (p.reason === 'restart' || p.reason === 'quit') return;
    const s = RS.sim.state, g = grade(p.stats, s);
    lastEnd = { p, g, reserve: clone(s.battery.reserve), hp: s.asset.hp, def: curDef, mode: mode && clone(mode), tally: tally || { kills: {}, misses: {} } };
    if (mode && mode.type === 'campaign') {
      const id = CP().shifts[mode.idx].id, n = CP().shifts.length;
      camp.best[id] = better(camp.best[id], g.grade);
      camp.results.push({ id, grade: g.grade, score: g.score, at: Date.now() });
      if (camp.results.length > 40) camp.results.splice(0, camp.results.length - 40);
      if (mode.frontier && !g.failed) {
        camp.next = mode.idx + 1;
        camp.reserve = clone(s.battery.reserve);
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
      `<div class="box"><table><tr><th>WEAPON</th><th>FIRED</th><th>KILLS</th><th>MISSES</th><th>RESERVE</th></tr>${rows}</table></div>` +
      actions);
  }

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
  function defaultFree() { return { seed: 1 + Math.floor(Math.random() * 99999), diff: 0.5, dur: 480, ev: {} }; }
  function free() {
    const o = freeOpts;
    show('free', `<div class="kick">FREE WATCH</div><h2>SETUP</h2>` +
      `<div class="box"><div class="sec">SEED</div><div class="seedrow"><input type="number" id="m-seed" inputmode="numeric" min="1" max="999999" value="${o.seed}" aria-label="seed">${btn('rseed', 'RANDOM', 'dim', 'id="m-rseed"')}</div></div>` +
      `<div class="box"><div class="sec">DIFFICULTY · <span class="amber" id="m-dlabel">${diffLabel(o.diff)} ${o.diff.toFixed(2)}</span></div>` +
      `<input type="range" id="m-diff" min="0" max="1" step="0.05" value="${o.diff}" aria-label="difficulty"><div class="tot muted" style="font-size:10px"><span>EASY</span><span>NORMAL</span><span>HARD</span></div></div>` +
      `<div class="box"><div class="sec">RANDOM EVENTS</div><div class="row2">${EVT.map(([k, l]) => `<button class="tg" data-m="tev" data-k="${k}" id="m-ev-${k}" aria-pressed="${!!o.ev[k]}">${l}<em>${o.ev[k] ? 'ON' : 'OFF'}</em></button>`).join('')}</div></div>` +
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
    const d = content().makeFreeShift(o.seed, o.diff), k = o.dur / 480;
    const r = content().mulberry32(((o.seed >>> 0) ^ 0x5eed1234) >>> 0), rng = (a, b) => Math.round(a + (b - a) * r());
    for (const s of d.spawns) s.t = Math.round(s.t * k);
    for (const c of d.comms) c.t = Math.round(c.t * k);
    for (const c of d.roeChanges || []) c.t = Math.round(c.t * k);
    d.duration = o.dur;
    d.name = `Free Watch #${o.seed} · ${diffLabel(o.diff)}`;
    d.id = `F${o.seed}-${Math.round(o.diff * 100)}`;
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
    show('pause', `<div style="height:8vh"></div><div class="kick" style="text-align:center">PAUSED</div><h2 style="text-align:center">${esc(s.shift.name)}</h2>` +
      `<p class="muted" style="text-align:center">${mmss(s.shift.elapsed)} / ${mmss(s.shift.duration)}</p>` +
      btn('resume', 'RESUME', 'pri', 'id="m-resume"') + btn('restart', 'RESTART SHIFT', 'amb', 'id="m-restart"') + btn('quit', 'QUIT TO MENU', 'red', 'id="m-quit"'));
    return true;
  }
  function resume() { if (screen !== 'pause') return false; hide(); RS.main.resume(); return true; }
  function restart() {
    hide(); tally = { kills: {}, misses: {}, mis: {} };
    RS.main.restart();
    pbtn.classList.add('on');
  }
  function quit() {
    if (RS.sim.state.shift.running) RS.sim.endShift('quit');
    RS.main.resume();
    mode && mode.type === 'campaign' ? map() : menu();
  }

  /* ---------- input ---------- */
  function onClick(e) {
    const el = e.target.closest('[data-m]'); if (!el || el.disabled) return;
    const a = el.dataset.m;
    if (a !== 'noop') tap();
    switch (a) {
      case 'menu': resetArm = false; return menu();
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
        return briefing(clone(L.def));
      }
      case 'free': return free();
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
    cfg = Object.assign({ sound: true, haptics: true }, load('settings', {}));
    const fo = load('free', null);
    freeOpts = Object.assign(defaultFree(), fo && typeof fo === 'object' ? fo : {});
    freeOpts.ev = Object.assign({}, freeOpts.ev);
    wrapVibrate(); applySettings();

    RS.bus.on('SHIFT_END', onEnd);
    RS.bus.on('LAUNCH', p => { if (tally) tally.mis[p.missileId] = p.weapon; });
    RS.bus.on('KILL', p => { if (tally && !p.wasFriend) tally.kills[p.weapon] = (tally.kills[p.weapon] || 0) + 1; });
    RS.bus.on('MISS', p => { if (tally) { const w = tally.mis[p.missileId] || 'harrow'; tally.misses[w] = (tally.misses[w] || 0) + 1; } });
    menu();
  }

  RS.meta = { init, startShift, show: n => ({ menu, map, free, settings, resupply, debrief })[n] && ({ menu, map, free, settings, resupply, debrief })[n](),
    pause, resume, restart, quit, grade, reset, buildFree, threatWords,
    get screen() { return screen; }, get campaign() { return camp; }, get settings() { return cfg; }, get last() { return lastEnd; }, get def() { return curDef; } };
})();
