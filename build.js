#!/usr/bin/env node
/* RED SKIES build: inline src/*.js into the shell → dist/weapons_hold.html */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, 'src'), OUT = path.join(__dirname, 'dist', 'weapons_hold.html');
const VERSION = '1.4.2.0';   // stamped into <title> (%RS_VERSION%) and window.RS.VERSION
const ORDER = ['contracts.js', 'content.js', 'campaign.js', 'sim.js',
  'models.js', 'models_weapons.js', 'models_weapons_east.js', 'models_launchers.js', 'models_ground.js', 'models_jets.js', 'jet_friend.js',
  'scene.js', 'cabin.js', 'audio.js', 'audio_weapons.js', 'ui.js', 'eo.js', 'meta.js', 'title.js', 'tutorial.js', 'main.js'];   // missing optional files are skipped
const MARKER = '<!-- RS_SCRIPTS -->';

const shell = fs.readFileSync(path.join(SRC, '00_shell.html'), 'utf8');
if (!shell.includes(MARKER)) { console.error('build: marker ' + MARKER + ' missing in shell'); process.exit(1); }
const js = ORDER.filter(f => fs.existsSync(path.join(SRC, f))).map(f => `/* == ${f} == */\n` + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
if (/<\/script/i.test(js)) { console.error('build: "</script" found inside sources'); process.exit(1); }
const html = shell.replace(/%RS_VERSION%/g, VERSION)
  .replace(MARKER, () => `<script>\nwindow.RS = window.RS || {}; window.RS.VERSION = '${VERSION}';\n` + js + '\n</script>');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
fs.writeFileSync(path.join(__dirname, 'index.html'), html);   // repo-root copy: open it directly or serve it with GitHub Pages
// Artifact flavour: the claude.ai Artifact host wraps content in its own doctype/html/head/body skeleton,
// so strip ours (keep <title>, <meta>, <style> and the body content in document order).
const art = html.replace(/^\s*<!DOCTYPE[^>]*>\s*/i, '').replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '').replace(/<\/?body[^>]*>/gi, '').replace(/^\s*<meta (charset|name="viewport")[^>]*>\s*$/gim, '');
fs.writeFileSync(OUT.replace(/\.html$/, '.artifact.html'), art.trim() + '\n');
console.log(`build: ${path.relative(__dirname, OUT)}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB (${html.split('\n').length} lines) + artifact flavour + index.html`);
