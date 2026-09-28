# Red Skies — status

Read this first in a new session; it replaces re-exploring the code. Update it after every publish.

- **Version:** see `VERSION` (Major.Minor.Patch.Build; Major = overhaul, Minor = feature batch, Patch = tweak/fix, Build = republish). Bump before every publish.
- **Repo:** https://github.com/Jxstrr0/Red-Skies- (`main` is the default branch)
- **Live artifact:** https://claude.ai/artifact/2vVrrJw4wg99sdZw6rptYP. Publish `dist/weapons_hold.artifact.html` to this same URL, labelled with the version.
  - Last publish: V1.4.3.0 (artifact version 37), 2026-09-27. The source files are published alongside the page.
- **Studio:** Prairie Blue Studio. The license is all rights reserved (`LICENSE`); three.js is MIT (`vendor/three.LICENSE`).

## Layout (details in README.md)

- `src/*.js` + `src/00_shell.html`: `build.js` inlines them in its ORDER list, plus `vendor/three.min.js` (r128), into one self-contained page:
  - `index.html` (committed; GitHub Pages serves it)
  - `dist/weapons_hold.html`
  - `dist/weapons_hold.artifact.html`
- `build.js` fails when a file in `src/` is missing from ORDER, or the other way round.
- The contract is `src/contracts.js`: every event payload, state field and command. Update it with any API change.
- The sim (`src/sim.js`) never touches the DOM; the node tests drive it headless.
- Tests:
  - `npm test` runs the node tests (`test/*.test.js`).
  - `npm run check:browser` runs the Playwright checks (`test/*.check.js`, shared setup in `test/_browser.js`).
  - `tools/balance.js` is the bot operator. Run it before and after gameplay changes.
- CI (`.github/workflows/ci.yml`):
  - on every push and PR: build, `index.html` drift check, node tests;
  - browser checks only on manual dispatch.

## Decisions (user)

- V1.4.3.0: a single version bump for the three improvement batches, then republish to the same artifact URL.
- Pop-up helicopters hide until about 8–10 km, as the briefings say. They start just outside their pop-up range at the authored time. Shifts with helicopters are a little harder.
- License: all rights reserved.
- The title/cover shot keeps full-quality grass; the performance savings apply in play only.
- V1.4.4.0 Training Watch:
  - Every shot the player fires in training hits: Lance, Dart and gun (`ShiftDef.sureHit`). Real watches are unchanged.
  - The training jet starts at about 40 km (was 48), so the tracker camera (35 km by day) picks it up during a prompt Lance's flight.
  - After launch the coach card follows the camera: it explains OUT OF RANGE, then says when the camera has picked up the jet.

## Changelog

- **1.4.4.0** (Training Watch)
  - Every training shot hits: no Pk roll, no dodging or chaff, an engaged target cannot leave, and a salvo's spare round vanishes without a MISS. The flag is tested before any `rand()`, and 108 normal-shift fingerprint runs are byte-identical to 1.4.3.0.
  - The training jet starts at ~40 km.
  - The post-launch steps follow the camera (OUT OF RANGE → picked up, ring on the camera). The step moves on by itself at the splash.
  - `RS.scene.eo.state.maxKm` gives the camera's current range.
  - The tutorial remembers what each shot was fired at, so a kill after the track faded (radar off) still counts. Before, the training got stuck.
  - Reworded: the salvo step (training shots always hit; real ones can miss), the miss hint and the out-of-range hint.
  - New `test/training.test.js`.
  - Follow-up after verification:
    - The OUT OF RANGE card is shorter, so it fits a 360 px phone without covering the camera.
    - On camera steps the card keeps clear of the camera. A card that fits nowhere goes where it covers the least (it used to jump to the top).
    - The jet's distance shows to 0.1 km (like the camera's readout) and always reads above the camera's reach.
    - The text drops "(top right)" and the "make it big" tip when the camera fills the view.
    - Watching steps show "watching…" instead of "your move". The out-of-range hint also covers "too high" (gun vs the 5000 m jet).
    - A salvo's spare round vanishes with the kill.
- **1.4.3.0**
  - Batch 1 (bug fixes):
    - SALVO second round re-checks ROE, FRIEND, assignment, radar and the fire-control solution.
    - ARM_INBOUND names the ARM's track.
    - Pop-up helicopters work.
    - Corridor friendlies join the route ahead of them.
    - Reloads cannot share reserve rounds, and an empty launcher retries its reload.
    - SHIFT_END.grade equals the debrief grade.
    - C5B keeps its 6-Lance cap; the extra Lance wait in the depot and the screens show it.
    - Rotating the phone pauses the shift.
    - Audio suspends when the page is hidden.
    - One `<script>` per module.
  - Batch 2 (phone performance):
    - Grass far band uses lighter tufts.
    - Far-jet LOD tier.
    - Distant ground kit uses low detail.
    - 60 fps cap; nothing renders under opaque menus.
    - EO pass at 30 Hz or less.
    - Particle uploads cover live particles only.
    - Launch smoke rate is capped.
    - Finished weapon-audio voices are disconnected.
  - Batch 3 (repo):
    - three.js bundled; the game works offline.
    - Fonts no longer block the page.
    - `VERSION` file.
    - ORDER check in `build.js`.
    - Tests updated to V1.4.3, with a test runner and a shared browser helper.
    - CI, LICENSE and this status doc.
- **1.4.2.0**: imported from the claude.ai artifact; `src/` rebuilt from the live page.

## Back-burner (reviewed ideas not done yet)

- **Polish and accessibility:**
  - Amber text on the light keyboard shelf is about 3.1:1 contrast.
  - Track-list rows are 36 px (below the 44/48 px touch-target guideline).
  - The EO TV/IR key is 43×42 px on a 360 px phone.
  - "OUT RNG" is clipped on the assigned chip at 360–412 px.
  - The main buttons are pointer-only (no keyboard).
  - `#toast` is not a live region, and the tabs lack `aria-selected`.
  - `prefers-reduced-motion` does not cover the in-game blinks.
  - The debrief replay canvas blocks page scrolling (`touch-action: none`).
- **Performance** (these need an on-device test):
  - Drop `logarithmicDepthBuffer` (it disables early-Z).
  - Send the launcher FX sprites through the one-draw particle system.
  - Bake the static meshes of ready TELs.
  - Shorten the 26 s weapon-audio delay line and add a voice budget.
- **Sim:** LEAKER and ASSET_HIT carry the entity id when the attacker was never tracked (the log shows "E13").
- **Content:** the Dustoff 3 (C2) and Dustoff 4 (C2B) medevac helicopters land after their shift ends.
- **Code comments:** keep or reword the "Kelbo" nickname in `src/models_launchers.js` and `src/scene.js`.
- **Salvo spare-round MISS (normal play):** after the first round of a salvo kills, the second round's self-destruct is logged and flashed as a MISS and counts in stats.misses. Training hides it (1.4.4). Changing it for real watches would alter the debrief numbers, so it needs a decision.
- **Deliberate, not bugs:** Survival counts outlasted waves (`sim.js`, "outlasted the previous wave").
