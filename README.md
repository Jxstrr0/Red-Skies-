# Red Skies

A phone-first air-defence game by Prairie Blue Studio. The current version is in [`VERSION`](VERSION); changes are logged in [`plan/status.md`](plan/status.md).

You are the fire-control officer of SAM battery *Kessel*, Republic of Varenna.
Watch the radar, sort friend from foe, and hold your fire until you are sure.
Friendly jets fly home through your sector, some with broken transponders, so
if you shoot one down (fratricide) the shift fails.

## Play

Open `index.html` in a browser; it is the whole game in one self-contained page,
three.js included, so it also plays offline. It is laid out for a phone held in
portrait. Two title fonts load from Google Fonts when a connection is available;
without one, the title uses fallback fonts.

To play from GitHub, enable **Settings → Pages** for this repository and serve the root folder.

### How a shift plays

- **Radar scope:** tracks appear as the sweep finds them. Tap one to select it,
  or cycle targets with ◀ ▶. After 90 s of continuous transmission, enemy ARM
  carriers start firing anti-radiation missiles (ARMs) at your radar, so switch
  **RADAR** off when you can. Lance and Dart need the radar on to fire; the gun does not.
- **IFF → FRIEND / HOSTILE:** interrogate the selected track, then classify it.
  Altitude, speed, heading, corridor and radio calls are your other cues.
- **ASSIGN → FIRE:** pick a launcher, lift the cover and hold **FIRE**.
  Rules of engagement (ROE) are HOLD / TIGHT / FREE, and HQ changes them
  during a shift. Under TIGHT you may only engage tracks classified HOSTILE.
- **Weapons:** *Lance*, a long-range SAM (3–60 km) · *Dart*, a short-range SAM (1–25 km)
  · *Harrow*, a gun (0–4 km). The battery has two Lance launchers, one Dart launcher and the gun.
- **Grading:** each shift is graded A–F. The score is weighted 40 % on asset health
  and 20 % each on leakers, ammo efficiency and reaction time. Fratricide or losing
  the defended asset is an automatic F.
- **Modes:** a guided *Training Watch*, a six-shift campaign (*First Watch* to
  *Red Skies*, each shift with three mission variants) with briefings, debriefs and a
  resupply shop, seeded *Free watch* skirmishes, and an endless *Survival* mode.
  Progress is saved in `localStorage` (keys prefixed `redskies.v1.`).

## Build

The game is written as plain scripts in `src/`. All of them share one global
namespace, `window.RS`. `build.js` inlines three.js (`vendor/three.min.js`, r128)
and the modules, in a fixed order, into `src/00_shell.html`, one `<script>` per module:

```sh
node build.js        # or: npm run build
```

This writes three files:

| Output | What it is |
| --- | --- |
| `index.html` | standalone page (committed, so the repo root is playable) |
| `dist/weapons_hold.html` | the same page; the browser checks load this one |
| `dist/weapons_hold.artifact.html` | the claude.ai artifact flavour, with no doctype/html/head/body skeleton |

- **Version:** the `VERSION` file (Major.Minor.Patch.Build) is stamped into the title and `window.RS.VERSION`.
- **Module list:** new modules go into the `ORDER` list in `build.js`. The build fails if a file in `src/` is missing from `ORDER`, or the other way round.
- **Commit the build:** commit `index.html` after building. CI fails when it is out of date with `src/`.

## Source map

| File | Role |
| --- | --- |
| `src/00_shell.html` | Page markup and CSS; three.js goes in at `<!-- RS_THREE -->` and the modules at `<!-- RS_SCRIPTS -->` |
| `vendor/three.min.js` | three.js r128 (MIT, see `vendor/three.LICENSE`), bundled so the game never waits on a CDN |
| `src/contracts.js` | Shared contract: units, enums, event bus (`RS.bus`) and event payloads, sim state shape, command API |
| `src/content.js` | `RS.content`: weapon and threat data, the Shift 0 range check, seeded free-play shift generator |
| `src/campaign.js` | `RS.campaign`: the six Kessel campaign shifts, story, budget and grading |
| `src/sim.js` | `RS.sim`: the air picture, including radar, tracks, IFF, weapons, ARMs, jamming, ROE and comms (no DOM; runs in node) |
| `src/models*.js`, `src/jet_friend.js` | `RS.models`: procedural three.js models of launchers, ground kit, jets and weapons (all fictional designs) |
| `src/scene.js` | `RS.scene`: the 3-D world outside, including terrain, sky/weather, aircraft, missiles and effects |
| `src/cabin.js` | `RS.cabin`: the operator cabin (V1.4); projects the DOM radar console and the EO overlay onto its monitors |
| `src/audio.js` | `RS.audio`: procedural WebAudio for radar, UI, IFF, alarms, the gun and flybys, plus haptics |
| `src/audio_weapons.js` | `RS.sfx`: procedural weapon sounds (launch, flight, detonation) |
| `src/ui.js` | `RS.ui`: radar scope, TRACK/IFF, BATTERY and COMMS tabs, launcher strip, thumb zone |
| `src/eo.js` | `RS.eo`: electro-optical tracker symbology |
| `src/meta.js` | `RS.meta`: menus, briefing, debrief, resupply, free watch, settings, pause |
| `src/title.js` | `RS.title`: the animated cover page over the live scene |
| `src/tutorial.js` | `RS.tutorial`: the guided Training Watch |
| `src/main.js` | `RS.main`: boot, fixed-step loop (20 Hz sim), resize, save/load |

## Tests

```sh
npm test                 # node tests: test/*.test.js (sim, content, campaign, fixes); no install needed
npm run check:browser    # Playwright checks: test/*.check.js (browser, ui, meta, scene, audio)
npm run balance          # tools/balance.js: a bot operator plays shifts and prints outcomes per weapon
```

- **Runner:** `test/run.js` runs every file, even after a failure, and exits 1 if any failed.
- **Browser checks:**
  - They need `npm install` and a Chromium that Playwright can launch: run `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM`.
  - Their shared setup is in `test/_browser.js`.
  - They run with software WebGL and are slow.
- **CI:**
  - GitHub Actions (`.github/workflows/ci.yml`) builds, checks that `index.html` is current, and runs the node tests on every push and pull request.
  - The browser checks run when you start the workflow by hand with **browser** ticked.

## License

Copyright © 2026 Prairie Blue Studio. All rights reserved. See [`LICENSE`](LICENSE).
three.js is used under the MIT License (`vendor/three.LICENSE`).

## Provenance

This repository was created from the game's claude.ai artifact:

1. The first commit imports the artifact's 30 files exactly as published.
2. The artifact's `src/` folder was older than its published page. The second
   commit rebuilds `src/` from the live V1.4.2.0 page (adding `cabin.js`, `eo.js`
   and `tutorial.js`), so that `node build.js` reproduces that page byte for byte.
