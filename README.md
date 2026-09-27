# Red Skies

**V1.4.2.0** · a phone-first air-defence game by Prairie Blue Studio.

You are the fire-control officer of SAM battery *Kessel*, Republic of Varenna.
Watch the radar, sort friend from foe, and hold your fire until you are sure.
Friendly jets fly home through your sector, some with broken transponders, so
if you shoot one down (fratricide) the shift fails.

## Play

Open `index.html` in a browser; it is the whole game in one self-contained page.
It is laid out for a phone held in portrait. The page loads three.js r128 from
cdnjs and two fonts from Google Fonts, so it needs a network connection.

To play from GitHub, enable **Settings → Pages** for this repository and serve the root folder.

### How a shift plays

- **Radar scope:** tracks appear as the sweep finds them. Tap one to select it,
  or cycle targets with ◀ ▶. Transmitting for a long time invites anti-radiation
  missiles (ARMs), so switch **RADAR** off when you can.
- **IFF → FRIEND / HOSTILE:** interrogate the selected track, then classify it.
  Altitude, speed, heading, corridor and radio calls are your other cues.
- **ASSIGN → FIRE:** pick a launcher, lift the cover and hold **FIRE**.
  Rules of engagement (ROE) are HOLD / TIGHT / FREE, and HQ changes them
  during a shift. Under TIGHT you may only engage tracks classified HOSTILE.
- **Weapons:** *Lance*, a long-range SAM (3–60 km) · *Dart*, a short-range SAM (1–25 km)
  · *Harrow*, a gun (0–4 km).
- **Modes:** a guided *Training Watch*, a six-shift campaign (*First Watch* to
  *Red Skies*) with briefings, debriefs, grades and resupply, seeded *Free watch*
  skirmishes, and an endless *Survival* mode. Progress is saved in `localStorage`
  (keys prefixed `redskies.v1.`).

## Build

The game is written as plain scripts in `src/`. All of them share one global
namespace, `window.RS`. `build.js` inlines them into `src/00_shell.html` in a fixed order:

```sh
node build.js        # or: npm run build
```

This writes three files:

| Output | What it is |
| --- | --- |
| `index.html` | standalone page (committed, so the repo root is playable) |
| `dist/weapons_hold.html` | the same page; the browser checks load this one |
| `dist/weapons_hold.artifact.html` | the claude.ai artifact flavour, with no doctype/html/head/body skeleton |

Bump `VERSION` in `build.js` to change the version shown in the title and in `window.RS.VERSION`.

## Source map

| File | Role |
| --- | --- |
| `src/00_shell.html` | Page markup and CSS; the scripts are injected at `<!-- RS_SCRIPTS -->` |
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
npm test                 # node-only: test/sim.test.js, test/content.test.js, test/campaign.test.js
npm run check:browser    # Playwright + Chromium checks (browser, scene, ui, meta, audio)
npm run balance          # tools/balance.js: a bot operator plays shifts and prints weapon usage
```

**Known state:** the tests came from an earlier version of the game and were not
updated alongside V1.3/V1.4, so several of them fail against the current code:

- `content.test.js` still expects the old Lance and Dart ranges and speeds.
- `campaign.test.js` rejects the new per-shift `weather` field.
- `browser.check.js`, `ui.check.js` and a few others expect the pre-V1.4 layout (35 % hatch, 4-chip launcher strip).

Treat those failures as out-of-date tests, not game bugs, until the tests are updated.

## Provenance

This repository was created from the game's claude.ai artifact:

1. The first commit imports the artifact's 30 files exactly as published.
2. The artifact's `src/` folder was older than its published page. The second
   commit rebuilds `src/` from the live V1.4.2.0 page (adding `cabin.js`, `eo.js`
   and `tutorial.js`), so that `node build.js` reproduces that page byte for byte.
