/* =====================================================================
   RED SKIES — contracts.js  (FROZEN after Run A; edit only by the orchestrator)
   Single source of truth for: event names + payloads, sim state shape,
   sim command API, module boot API, Models API.
   All modules are plain scripts sharing one global namespace: window.RS
   ===================================================================== */
window.RS = window.RS || {};

/* ---------- Units & axes ----------
   World (sim): 2-D air picture in km. x = east, y = north. Battery at (0,0).
   alt in metres. speed in m/s. heading in degrees, 0 = north, clockwise.
   time in seconds of sim time. Sim steps at RS.SIM_HZ (fixed).
   Scene (three.js): metres. x = east, z = SOUTH (three.js RH: -z = north), y = up.
   Convert: sceneX = simX*1000, sceneZ = -simY*1000, sceneY = alt.          */
RS.SIM_HZ = 20;
RS.SIM_DT = 1 / RS.SIM_HZ;

/* ---------- Enums ---------- */
RS.KIND = {           // true entity kinds (sim knows; UI must NOT read kind until classified)
  JET_FRIEND:'jet_friend', STRIKE_FRIEND:'strike_friend', TRANSPORT:'transport', HELO_FRIEND:'helo_friend',
  JET_HOSTILE:'jet_hostile', HELO_HOSTILE:'helo_hostile', CRUISE:'cruise_missile', DRONE:'drone', ARM:'arm_missile'
};
RS.IFF   = { NONE:'NONE', PENDING:'PENDING', FRIEND:'FRIEND', NO_RESPONSE:'NO_RESPONSE', INVALID:'INVALID' };
RS.CLS   = { UNKNOWN:'UNKNOWN', FRIEND:'FRIEND', HOSTILE:'HOSTILE' };
RS.WEAPON= { LANCE:'lance', DART:'dart', HARROW:'harrow' };
RS.ROE   = { HOLD:'HOLD', TIGHT:'TIGHT', FREE:'FREE' };
RS.DOCTRINE = { SLS:'SHOOT_LOOK_SHOOT', SALVO:'SALVO' };
RS.RANDOM_EVENT = { RADAR_FAULT:'radar_fault', LAUNCHER_JAM:'launcher_jam', COMMS_OUT:'comms_outage',
  IFF_FAIL:'friendly_iff_failure', SWARM:'drone_swarm', NIGHT:'night', STORM:'storm',
  LATE_RESUPPLY:'late_resupply', ROE_CHANGE:'roe_change' };

/* ---------- Events (sim → everyone). RS.bus.on(name, fn) / RS.bus.emit(name, payload) ----------
   Payload shapes (all fields present, no undefined):
   SIM_TICK        {t, dt}                                   every sim step (UI/scene poll RS.sim.state instead of tracking deltas)
   TRACK_NEW       {id, track}                               first detection (track = snapshot, see Track)
   TRACK_LOST      {id, reason:'faded'|'killed'|'landed'|'exited'}
   TRACK_SELECTED  {id|null}
   IFF_SENT        {id}
   IFF_RESULT      {id, result:RS.IFF.*}                     ~1.5 s after IFF_SENT
   CLASSIFIED      {id, cls:RS.CLS.*}
   ASSIGNED        {id, weapon:RS.WEAPON.*, launcherId}      launcherId 'L1'|'L2'|'L3'|'G1'
   LAUNCH          {missileId, weapon, launcherId, targetId} SAM leaves rail
   GUN_FIRE        {launcherId:'G1', targetId, burst:true}    gun burst start (scene draws tracers ~1.5 s)
   INTERCEPT       {missileId, targetId, x, y, alt}          missile reached target: kill (see KILL) or MISS follows
   MISS            {missileId, targetId}
   KILL            {targetId, weapon, wasFriend:boolean, x, y, alt}
   FRATRICIDE      {targetId}                                also KILL with wasFriend=true; shift is failed
   RELOAD_START    {launcherId, seconds}
   RELOAD_DONE     {launcherId}
   RADAR_STATE     {on:boolean}
   RADAR_WARN      {seconds}                                 continuous emission is getting dangerous (ARM risk rising)
   JAMMING         {level:0..1, bearing}                     0 = clear
   ARM_INBOUND     {id, eta, tracked}                        anti-radiation missile launched at us: once at launch
                                                             (id null, tracked false), again when the ARM becomes a track
                                                             (id = that track id, tracked true)
   ARM_IMPACT      {damage:0..1}                             radar hit (radar may go down)
   ASSET_HIT       {byId, damage:0..1}                       defended asset struck
   LEAKER          {id}                                      hostile passed the defended line
   ROE_CHANGE      {roe:RS.ROE.*}
   COMMS           {from:'HQ'|'CAP'|'TOWER'|'BATTERY', text, priority:'low'|'normal'|'high'}
   ALARM           {kind:'arm'|'leaker'|'fratricide'|'asset'|'lowammo'|'radar', on:boolean}
   RANDOM_EVENT    {kind:RS.RANDOM_EVENT.*, active:boolean, detail}
   SHIFT_START     {def}                                     def = ShiftDef (see content.js)
   SHIFT_END       {grade:'A'|'B'|'C'|'D'|'F', failed:boolean, reason, stats}
   ---- UI-only events (UI → scene/audio), same bus ----
   UI_TAP          {what:'button'|'track'|'panel'}           generic click sound/haptic
   UI_FIRE_ARMED   {armed:boolean}                           flip cover opened/closed
*/
RS.EV = ['SIM_TICK','TRACK_NEW','TRACK_LOST','TRACK_SELECTED','IFF_SENT','IFF_RESULT','CLASSIFIED','ASSIGNED',
  'LAUNCH','GUN_FIRE','INTERCEPT','MISS','KILL','FRATRICIDE','RELOAD_START','RELOAD_DONE','RADAR_STATE','RADAR_WARN',
  'JAMMING','ARM_INBOUND','ARM_IMPACT','ASSET_HIT','LEAKER','ROE_CHANGE','COMMS','ALARM','RANDOM_EVENT',
  'SHIFT_START','SHIFT_END','UI_TAP','UI_FIRE_ARMED','FIRE_REJECTED','LOCK','EVADE','RADAR_REPAIR','PAUSE',
  'WAVE', 'MISSILE_ACTIVE','CAM_FOLLOW','TUTORIAL'];

RS.bus = (function () {
  const map = {};
  return {
    on(name, fn) { (map[name] = map[name] || []).push(fn); return () => { map[name] = map[name].filter(f => f !== fn); }; },
    emit(name, payload) { const l = map[name]; if (!l) return; for (let i = 0; i < l.length; i++) { try { l[i](payload || {}); } catch (e) { console.error('[bus]', name, e); } } }
  };
})();

/* ---------- Sim state (read-only for UI/scene/audio; RS.sim.state) ----------
   {
     t:number, shift:{ id, name, duration, elapsed, running:boolean, roe:RS.ROE.* },
     radar:{ on:boolean, rangeKm:number, sweepDeg:0..360, rpm:number, emitTime:number, jam:0..1, jamBearing, health:0..1 },
     tracks:Track[]           (only currently detected/held tracks; sorted by id)
     selectedId:string|null,
     battery:{
       launchers:[ {id:'L1',weapon:'lance',rounds:4,max:4,ready:boolean,reloadT:0,jammed:false},
                   {id:'L2',weapon:'lance',...}, {id:'L3',weapon:'dart',...},
                   {id:'G1',weapon:'harrow',rounds:600,max:600,ready:true,reloadT:0,jammed:false} ],
       doctrine:RS.DOCTRINE.*, assignedTo:{ [trackId]:launcherId }
     },
     missiles:[ {id, weapon, x, y, alt, targetId, launcherId, flightT} ],   in flight
     asset:{ hp:0..1 },
     stats:{ kills, misses, leakers, fired:{lance,dart,harrow}, reactionTimes:number[], fratricide:boolean },
     visible:[ {id, kind, x, y, alt, hdg, burning:boolean} ]   TRUTH entities within RS.VISIBLE_KM of battery — for the scene only.
                                                              Scene never reads .tracks; UI never reads .visible.
   }
   Track = { id:'T01', x, y, alt, hdg, spd, rangeKm, bearingDeg, closure (m/s, + = closing), quality:0..1,
             firstSeen:t, lastSeen:t, iff:RS.IFF.*, cls:RS.CLS.*, priority:0..100, assigned:launcherId|null,
             strobe:boolean (jam strobe, position unreliable), engagedBy:missileId[] }
   Track NEVER exposes the true kind. Cues available: alt, spd, hdg, corridor, radio calls, IFF.               */
RS.VISIBLE_KM = 6;
RS.AIR_VISIBLE_KM = 15;   // aircraft (not missiles) are put in state.visible out to this range so the hatch view shows passing jets

/* ---------- Sim command API (UI → sim). All return boolean accepted. ----------
   RS.sim.cmd.selectTrack(id|null)
   RS.sim.cmd.interrogate(id)                  emits IFF_SENT then IFF_RESULT
   RS.sim.cmd.classify(id, RS.CLS.*)
   RS.sim.cmd.assign(id, launcherId)           launcherId 'L1'..'L3','G1'; null to clear
   RS.sim.cmd.fire(id)                         fires assigned launcher at track (respects ROE, ready, rounds)
   RS.sim.cmd.setDoctrine(RS.DOCTRINE.*)
   RS.sim.cmd.radar(on:boolean)
   RS.sim.cmd.reload(launcherId)               manual reload start (auto when empty too)
   RS.sim.cmd.ack(commsIndex)                  acknowledge HQ message
   ---- lifecycle ----
   RS.sim.init(opts)  RS.sim.startShift(shiftDef)  RS.sim.step()  (one fixed step; main.js calls at 20 Hz)
   RS.sim.endShift(reason)  RS.sim.state
   sim.js must run in node with no DOM: guard with `if (typeof window==='undefined') global.window = {RS:{}}` in tests. */

/* ---------- Module boot API (main.js calls in this order) ----------
   RS.content : { threats:{[kind]:ThreatDef}, shifts:ShiftDef[], makeFreeShift(seed, difficulty) }   pure data + fns
   RS.sim.init({content:RS.content})
   RS.models  : { version, kinds:string[], create(kind, opts) -> THREE.Object3D }      (see Models API)
   RS.scene.init({canvas, models:RS.models})   RS.scene.resize(w,h)   RS.scene.render(dt, state)   subscribes to bus
   RS.audio.init()   (call on first user gesture)  subscribes to bus
   RS.ui.init({root:document.getElementById('desk'), sim:RS.sim})   subscribes to bus; polls state on SIM_TICK
   RS.main : boots, runs loop, handles resize/orientation, save/load                                        */

/* ---------- Models API (the future model-lab file replaces models.js ONLY) ----------
   RS.models.create(kind, opts) -> THREE.Object3D
   kinds: 'shelter_interior','launcher_lance','launcher_dart','gun_harrow','missile_lance','missile_dart',
          'jet_friend','jet_hostile','helo_attack','cruise_missile','drone','arm_missile','tree','debris'
   Units 1 = 1 m. Origin at ground centre (aircraft: centre of mass). +Z forward (nose), +Y up.
   Materials: MeshLambertMaterial/MeshStandardMaterial, vertex colours allowed, no textures required.
   Must render under one DirectionalLight + one HemisphereLight. Keep < 600 tris per model (mobile).
   Launcher models expose obj.userData.rails: THREE.Object3D[] (missile spawn points) when available.       */

/* =====================================================================
   RUN B ADDITIONS (Phases 3–4). Additive only; everything above still holds.
   ===================================================================== */

/* ---------- Extra events ----------
   FIRE_REJECTED  {id, reason:'roe_hold'|'roe_tight_not_hostile'|'classified_friend'|'not_assigned'|'not_ready'|
                   'no_rounds'|'out_of_range'|'too_close'|'radar_off'|'jammed'|'no_track'}
   LOCK           {id, launcherId, on:boolean}          fire-control lock tone start/stop (on ASSIGN with valid solution / on fire or clear)
   Payload amendments (fields ADDED):
   GUN_FIRE       + bearingDeg, elevDeg, rounds (rounds used this burst)
   LAUNCH         + x, y, alt (launcher position km/m; battery launchers sit within 0.15 km of (0,0))
   KILL           + trackId|null (UI uses trackId; targetId stays the TRACK id when known)
   COMMS          + id (int, increasing), needsAck:boolean
   SHIFT_END.stats = state.stats snapshot
   IDs: every event field named targetId / id that refers to an air object uses the TRACK id ('T07').
   Scene needs truth positions → use state.visible (entity ids 'E12') and the x/y/alt in the payload.  */

/* ---------- Extra state ----------
   state.battery.reserve = { lance:number, dart:number, harrow:number }   rounds left in the battery magazine
       (reload refills a launcher from reserve; reserve 0 → cannot reload)
   state.battery.launchers[i] + { assignedTrack:string|null, reloadTotal:number }
   state.missiles[i] + { hdg, spd, phase:'boost'|'midcourse'|'terminal', tti:number (s to intercept, est.) }
   V1.1.3: state.missiles[i].active:boolean — Lance seeker active (inside 20 km, latched): radar no longer needed for that round.
   MISSILE_ACTIVE {missileId, targetId, weapon}  emitted once when a round goes active.
   state.gun = { firing:boolean, bearingDeg, elevDeg, targetId|null }
   state.radar + { armEta:number|null }        seconds until nearest ARM impact (null = none inbound)
   state.shift + { failed:boolean }
   state.comms = [ {id, t, from, text, priority, needsAck, acked} ]  (newest last, capped 40)
   state.visible[i] + { spd }  (and entries for missiles in flight: kind 'missile_lance'|'missile_dart', id 'M3')
   Track + { iffBroken:never } — tracks still never expose truth. Track.engagedBy = missileIds in flight at it. */

/* ---------- Extra sim query API (UI → sim, read-only, cheap) ----------
   RS.sim.query.engage(trackId, launcherId) -> { ok:boolean, reason:string|null, pk:0..1, tti:seconds, inRange:boolean }
   RS.sim.query.bestLauncher(trackId) -> launcherId|null   (ready, in range, highest pk, prefers cheapest weapon on ties)
   Rules of engagement (enforced by cmd.fire):
     HOLD  → no fire at all (reason roe_hold)
     TIGHT → only tracks classified HOSTILE (reason roe_tight_not_hostile)
     FREE  → any track not classified FRIEND
     A track classified FRIEND can never be fired on (classified_friend).
   Doctrine: SHOOT_LOOK_SHOOT fires 1 round per fire command; SALVO fires 2 (Harrow: SALVO = double-length burst).
   Fratricide: KILL of a true friendly → FRATRICIDE, stats.fratricide=true, shift.failed=true, SHIFT_END ~4 s later (grade F).
   IFF truth table (IFF_RESULT ~1.5 s after IFF_SENT, radar must be ON):
     friendly, IFF working → FRIEND (p .95) else NO_RESPONSE
     friendly, iffBroken   → NO_RESPONSE
     hostile               → NO_RESPONSE (p .85) else INVALID                                                */

/* ---------- Content additions (RS.content) ----------
   RS.content.weapons = {
     lance:  { label:'Lance',  kind:'sam', minKm, maxKm, maxAlt, spd (m/s), pkBase, reloadS, perLauncher:4 },
     dart:   { label:'Dart',   kind:'sam', minKm, maxKm, maxAlt, spd, pkBase, reloadS, perLauncher:4 },
     harrow: { label:'Harrow', kind:'gun', minKm:0, maxKm, maxAlt, roundsPerBurst, pkPerBurst, reloadS, perLauncher:600 } }
   RS.content.threats[kind] + { pkMod:{lance,dart,harrow} (multiplier), maneuver:0..1, armCapable:boolean, jammer:boolean }
   RS.content.reserve = { lance, dart, harrow }   starting magazine for a shift unless ShiftDef.reserve overrides
   ShiftDef + { reserve?, roeChanges?:[{t, roe}], events?:[{t, kind:RS.RANDOM_EVENT.*, duration, detail}] }
   ShiftDef + sureHit?:true   V1.4.4 training aid (the Training Watch sets it): every battery shot (Lance, Dart, Harrow) kills its
       target, targets never evade, a target with a round on the way cannot leave, and a salvo's spare round whose target was
       already killed vanishes without a MISS. Without the flag the sim behaves (and draws random numbers) exactly as before.
   ShiftDef.spawns[i] + { iffBroken?:true, jammer?:true, armCarrier?:true (fires an ARM when our radar has emitted >90 s and
       it is within 45 km), strike?:true (hostile releases on the asset when inside 6 km → ASSET_HIT), group?:string,
       popup?:{hideAlt, atKm} (helo stays below hideAlt until within atKm, then climbs) , count?:n, spread?:km (swarm) }
   ShiftDef.comms[i] + { needsAck?:true }                                                               */

/* ---------- Scene/Audio hooks (optional to call) ----------
   RS.scene.shake(intensity 0..1)   RS.audio.alarm(kind, on)   — both listen to the bus themselves; these are for tests. */

/* =====================================================================
   RUN C + 3-D FOLD-IN ADDITIONS. Additive only.
   ===================================================================== */
/* ---------- Models bridge ----------
   models.js ends with `window.Models = RS.models;` so the vendor modules (models_weapons.js, models_weapons_east.js,
   models_launchers.js, models_jets.js, jet_friend.js — loaded right after models.js) wrap RS.models.create in place.
   Kinds they add: jet_hostile{variant,loadout,lod}, jet_hostile_bomber, jet_friend{loadout}, cruise_missile, arm_missile/agm_arm,
   missile_lance, missile_dart, missile_*_canister, launcher_lance, launcher_dart (TEL trucks with deploy/launch/reload API),
   plus aam_xxx, agm_xxx and bomb kinds. RS.models.kinds stays a superset of the build-plan kinds.   */
/* ---------- Scene additions ----------
   RS.scene.launcherPos(id:'L1'|'L2'|'L3'|'G1'|'RADAR'|'ASSET') -> {x,y,z} scene metres (x east, y up, z south)
   RS.scene.listener() -> { pos:{x,y,z}, headingDeg }   the hatch camera (for 3-D audio)
   RS.scene.setEnv({time:'day'|'dusk'|'night', weather:'clear'|'storm'})   also driven by RANDOM_EVENT night/storm
   RS.scene.shake(0..1)   */
/* ---------- Weapon audio ----------
   audio_weapons.js (RS.sfx) owns weapon sounds: launches (Lance cold, Dart hot), missile flight, detonations, kills/break-up,
   ARM impact, asset hits, cruise/ARM flight loops. audio.js keeps: radar sweep, UI, IFF, lock, gun (Harrow), alarms, comms, haptics.
   Wiring (main.js/audio.js): after RS.audio.init(): RS.sfx.attach(RS.audio.ctx, RS.audio.sfxBus); RS.sfx.bindGame(RS, {launcherPos:
   id => RS.scene.launcherPos(id), radarPos: () => RS.scene.launcherPos('RADAR'), assetPos: () => RS.scene.launcherPos('ASSET')});
   RS.sfx.update() every frame; RS.sfx.setListener(pos, headingDeg) when the view changes.   */
/* ---------- Meta layer (Run C) — meta.js + campaign.js ----------
   RS.campaign = { shifts:ShiftDef[] (5–7, escalating), budget per shift, prices {lance,dart,harrow} }
   RS.meta : owns menus (main menu, campaign map, free-mode setup, resupply, debrief), grading, save/load.
     RS.meta.init()           called by main after modules init; shows the main menu instead of auto-starting shift 0
     RS.meta.startShift(def)  → RS.sim.startShift(def)
     Listens to SHIFT_END; shows the full debrief (replaces the UI's minimal end card: UI hides its card when RS.meta exists).
   Grade (A–F) computed in meta from SHIFT_END.stats + state: asset hp, leakers, ammo efficiency (kills per round),
   reaction time, fratricide = F. Save: localStorage key 'redskies.v1' in try/catch → {campaign:{unlocked, results[], reserve}, settings}.
*/

/* =====================================================================
   v20 ADDITIONS. Additive only.
   ===================================================================== */
/* ---------- Hostile evasion (sim) ----------
   Hostile jets hear an RWR warning when we LOCK them (reacts ~28 %) or when one of our SAMs in flight at them closes inside
   30 km (Lance) / 16 km (Dart) (reacts ~66 %, once per missile, ≥ 3 s between reactions). Reactions (seeded, situational):
     'break' — hard turn 60–150°: drag (turn away) when the round is > 12 km off, beam/notch (±90° to it) when closer; +10 % speed
     'dive'  — descend at 120 m/s to 100–300 m (ground clutter: Pk ×0.85 while low); helo_hostile only dives (20–40 m, terrain mask)
     'chaff' — terminal (round inside 3 km), 2 programmes per jet, 75 %: that missile's Pk ×0.7
   A break can come with a dive. After 10–20 s the jet resumes its mission (strike run toward the asset, or egress).
   Missile energy matters: coasting rounds bleed speed when they turn, lose Pk at low closing speed and fall short below
   ~350 m/s — a max-range Lance at a dragging jet is a gamble; Darts inside ~10 km stay reliable.
   EVADE        {trackId|null, missileId|null, kind:'break'|'dive'|'chaff'}   one event per reaction kind (break+dive → two)
                trackId = our track id of the jet (null if untracked); missileId null = reaction to a LOCK spike
   Track + { evade:'break'|'dive'|'chaff'|null }   most recent reaction, cleared ~6 s after it started
   ---------- Radar repair (sim) ----------
   RS.sim.cmd.repairRadar() -> boolean   allowed when radar.health < 0.95, shift running and not already repairing.
       Forces the radar OFF (RADAR_STATE {on:false} if it was on); cmd.radar(true) returns false while repairing.
       Duration 18 + 13·(1 − health) s (≈ 19–30 s). On completion health = 1, radar stays OFF (operator re-transmits).
   state.radar + { repair:{until:simTime, total:seconds}|null, degraded:boolean (health < 0.7, kept up to date) }
   RADAR_REPAIR {active:boolean, health}   active:true at start, active:false at completion (health then 1)
       COMMS from BATTERY at start ('Radar cold for repairs, N seconds.', normal) and completion
       ('Radar repaired. Transmit when ready.', high).
   ---------- UI events ----------
   PAUSE        {paused:boolean}          emitted by main.js on RS.main.pause()/resume() (audio/voice go quiet while paused) */


/* =====================================================================
   V1.1.0.0 ADDITIONS. Additive only.
   ===================================================================== */
/* ---------- Weather (sim) ----------
   ShiftDef + weather?:{ time:'dawn'|'day'|'dusk'|'night', sky:'clear'|'overcast'|'rain' }   (absent → {dusk, clear})
   state.weather = { time, sky (as defined), visKm, storm:boolean (STORM event active), nightEv:boolean (NIGHT event active) }
       visKm: clear 15, overcast 11, rain 6 (STORM counts as rain); night (time or event) halves it, min 3.
   Rain (sky 'rain' or storm): radar Pd ×0.8 for RCS < 0.3, a little more track position noise, Harrow Pk ×0.85.
   Overcast / night: no sim effect. No new event (SHIFT_START.def carries weather; RANDOM_EVENT still flags night/storm).
   RS.content.makeFreeShift(seed, diff, opts?) → def.weather; opts.weather {time?, sky?} ('random'/absent → seeded pick:
       time dusk .3 day .3 dawn .2 night .2; sky clear .55 overcast .3 rain .15). RS.content.pickWeather(seed, want?) same pick.
   Campaign shifts carry a fixed weather (C3 Storm Front = rain).
   ---------- Kill cam (sim) ----------
   state.visible additionally holds, at ANY range: every own missile in flight ('missile_lance'|'missile_dart', id 'M3'), every
   entity that is the target of an in-flight missile, and burning debris of SAM kills (BURN 3 s). Every entry has far:boolean
   (true = beyond the normal visible range: AIR_VISIBLE_KM for air/debris, 3·VISIBLE_KM for missiles).
   CAM_FOLLOW   {id|null}            scene: kill-cam follow started (missile id) / ended (null)  — UI-side event
   ---------- Survival / endless (sim + content) ----------
   RS.content.makeSurvivalShift(seed) → ShiftDef { id:'SURV-'+seed, name:'Survival #'+seed, endless:true, seed, duration:0,
       roe FREE, reserve {lance 12, dart 12, harrow 1800}, weather (seeded), CAP pair spawns, 2 comms }
   RS.content.makeSurvivalWave(n, seed) → { spawns (t relative to wave start, 0..~60 s), comms (t relative) }  deterministic.
       Escalates with n: jets/cruise/drones/helos from 1, swarms from 3, ARM carriers from 4, jammers from 6; friendly transit
       with a TOWER call ~60 % of waves from 3 (IFF inop sometimes from 5).
   Sim when def.endless: never ends on duration; state.shift + { endless:true, wave (1-based; 0 before wave 1) }.
       Wave 1 at 8 s; next wave 15 s after every hostile of the current wave is gone, or 150 s after it began (first wins).
       Each wave start: WAVE {n, hostiles} + BATTERY comms. Each wave cleared (while alive): stats.waves++, reserve +2 Lance,
       +2 Dart, +200 Harrow (caps 16/16/2400) + BATTERY comms. Ends on asset_destroyed, fratricide or quit (endShift).
   WAVE         {n, hostiles}        survival wave n started with `hostiles` hostile airframes expected
   TUTORIAL     {step, done}         tutorial.js (optional)
   ---------- Debrief history + stats (sim) ----------
   RS.sim.history (reset each startShift) = { samples:[{t, tr:[[trackId, xKm(1dp), yKm(1dp), cls]]}] (every 2 s, UI knowledge only,
       cap 900, oldest dropped), events:[{t, type, id, x, y, ...extra}] }
       types: LAUNCH (id missileId, launcher pos, +weapon,targetId), KILL (+wasFriend, weapon), MISS (target track pos, +missileId),
       LEAKER, ASSET_HIT (+damage), ARM_IMPACT (at 0,0, +damage), FRATRICIDE, WAVE (id 'W'+n at 0,0, +n,hostiles)
   state.stats + { firstShotKills (hostiles killed by the first round/burst fired at them), shotsAtFriends (rounds/bursts fired at
       true friendlies), maxEmit (longest continuous emission s), waves (survival: waves fully survived) }            */
