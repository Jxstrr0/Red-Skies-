#!/usr/bin/env node
/* RED SKIES build: inline vendor/three.min.js + src/*.js into the shell → index.html, dist/weapons_hold.html (+ artifact flavour) */
const fs = require('fs'), path = require('path');
const ROOT = __dirname, SRC = path.join(ROOT, 'src'), OUT = path.join(ROOT, 'dist', 'weapons_hold.html');
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();   // single source: <title> (%RS_VERSION%) + window.RS.VERSION
const ORDER = ['contracts.js', 'content.js', 'campaign.js', 'sim.js',
  'models.js', 'models_weapons.js', 'models_weapons_east.js', 'models_launchers.js', 'models_ground.js', 'models_jets.js', 'jet_friend.js',
  'scene.js', 'cabin.js', 'audio.js', 'audio_weapons.js', 'ui.js', 'eo.js', 'meta.js', 'title.js', 'tutorial.js', 'main.js'];
const MARKER = '<!-- RS_SCRIPTS -->', THREE_MARKER = '<!-- RS_THREE -->';
const die = msg => { console.error('build: ' + msg); process.exit(1); };

if (!/^\d+\.\d+\.\d+\.\d+$/.test(VERSION)) die(`VERSION "${VERSION}" is not Major.Minor.Patch.Build`);
// every module is required, and every module in src/ must be listed (a new file must not silently drop out of the build)
const onDisk = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));
const missing = ORDER.filter(f => !onDisk.includes(f)), unlisted = onDisk.filter(f => !ORDER.includes(f));
if (missing.length) die('listed in ORDER but missing from src/: ' + missing.join(', '));
if (unlisted.length) die('in src/ but not in ORDER (add them in load order): ' + unlisted.join(', '));

const shell = fs.readFileSync(path.join(SRC, '00_shell.html'), 'utf8');
for (const m of [MARKER, THREE_MARKER]) if (!shell.includes(m)) die('marker ' + m + ' missing in shell');
// three.js r128 is bundled (vendor/, MIT, see vendor/three.LICENSE) so the game works offline and never waits on a CDN
const three = fs.readFileSync(path.join(ROOT, 'vendor', 'three.min.js'), 'utf8');
const js = ORDER.map(f => `/* == ${f} == */\n` + fs.readFileSync(path.join(SRC, f), 'utf8'));
if ([three, ...js].some(s => /<\/script|<!--/i.test(s))) die('"</script" or "<!--" found inside a script');
// one <script> per module: a module that throws cannot stop main.js from booting and reporting it
const html = shell.replace(/%RS_VERSION%/g, VERSION)
  .replace(THREE_MARKER, () => '<script>\n/* == vendor/three.min.js (three.js r128, MIT) == */\n' + three + '\n</script>')
  .replace(MARKER, () => `<script>window.RS = window.RS || {}; window.RS.VERSION = '${VERSION}';</script>\n` + js.map(s => '<script>\n' + s + '\n</script>').join('\n'));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
fs.writeFileSync(path.join(ROOT, 'index.html'), html);   // repo-root copy: open it directly or serve it with GitHub Pages
// Artifact flavour: the claude.ai Artifact host wraps content in its own doctype/html/head/body skeleton,
// so strip ours (keep <title>, <meta>, <style> and the body content in document order).
const art = html.replace(/^\s*<!DOCTYPE[^>]*>\s*/i, '').replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '').replace(/<\/?body[^>]*>/gi, '').replace(/^\s*<meta (charset|name="viewport")[^>]*>\s*$/gim, '');
fs.writeFileSync(OUT.replace(/\.html$/, '.artifact.html'), art.trim() + '\n');
console.log(`build: V${VERSION}  ${path.relative(ROOT, OUT)}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB (${html.split('\n').length} lines) + artifact flavour + index.html`);
