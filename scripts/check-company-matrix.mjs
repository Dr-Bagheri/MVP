// Exercise the shipped single-file site, without touching product services.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
const require = createRequire(resolve('web/package.json'));
const { JSDOM } = require('jsdom');
const html = await readFile('site/index.html', 'utf8');
const faHtml = await readFile('site/fa.html', 'utf8');
const document = new JSDOM(html).window.document;
const source = document.querySelector('script').textContent;
new Script(source);
assert.equal(document.querySelectorAll('.scene').length, 5);
assert.equal(document.querySelector('h1').getAttribute('aria-label'), 'NeurAI Platform');
assert.equal(document.querySelector('#boot-l1').textContent,'NeurAI');
assert.equal(document.querySelector('.logo-surface'),null);
assert.equal(document.querySelector('#bars'), null);
assert.ok(!source.includes('drawBars'));
assert.ok(!document.body.textContent.includes('86,000,000,000'));
assert.ok(!document.body.textContent.includes('2400'));
assert.ok(document.querySelector('.figures').textContent.includes('ONE REFERENCE CLIP, 13 AUG 2026'));
assert.equal(document.querySelector('.login').href, 'https://app.neurai.pt/en/sign-in');

function runtime({ reduced = false, omitRenderer = false, paintBox = false, width = 1280, overlap = true, fa = false, hash = '' } = {}) {
  const dom = new JSDOM(fa ? faHtml : html, { url: 'http://127.0.0.1:4173/' + (fa ? 'fa.html' : '') + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window, frames = [], glyphs = [], ink={paths:0};
  const context = new Proxy({
    fillText(text, x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); if(glyphs.length<2000)glyphs.push({text,x,y}); },
    stroke() { ink.paths++; }, fill() { ink.paths++; },
    createLinearGradient() { return { addColorStop() {} }; },
  }, { get: (obj,key) => key in obj ? obj[key] : () => {} });
  win.matchMedia = query => ({matches: query.includes('prefers-reduced-motion') ? reduced : width <= 360});
  win.HTMLCanvasElement.prototype.getContext = type => type === '2d' ? context : null;
  for (const canvas of win.document.querySelectorAll('canvas')) {
    Object.defineProperty(canvas, 'clientWidth', {value:width});
    Object.defineProperty(canvas, 'clientHeight', {value:900});
  }
  Object.defineProperty(win.document.getElementById('track'), 'offsetHeight', {value:5940});
  Object.defineProperty(win,'innerWidth',{value:width});
  Object.defineProperty(win,'innerHeight',{value:900});
  win.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  win.setTimeout = fn => { fn(); return 1; };
  win.setInterval = () => 1;
  win.scrollTo = ({top}) => { win.scrollY=top;win.dispatchEvent(new win.Event('scroll')); };
  win.HTMLElement.prototype.scrollIntoView = function() { win.document.body.dataset.scrollTarget = this.id; };
  let delivered=source;
  if(omitRenderer)delivered=delivered.replace('if (brain) brain.draw(', 'if (false) brain.draw(');
  if(paintBox)delivered=delivered.replace('ctx2.clearRect(0, 0, W2, H2);','ctx2.clearRect(0, 0, W2, H2);ctx2.stroke();');
  if(!overlap)delivered=delivered.replace('const CHAPTER_OVERLAP = .24;', 'const CHAPTER_OVERLAP = 0;');
  win.eval(delivered);
  let now = win.performance.now();
  function advance() { for(let i=0;i<160;i++){now+=16.67;frames.splice(0).forEach(fn=>fn(now));} }
  advance();
  const seek = phase => {win.scrollTo({top:phase/4.45*5040});advance();};
  return {win,glyphs,ink,advance,seek,close:()=>win.close()};
}
const run = runtime();
const canvas = run.win.document.getElementById('brain');
const requireRenderedN = page => assert.ok(Number(page.win.document.getElementById('brain').dataset.glyphs)>100, 'INVALID: N renderer did not identify its subject');
requireRenderedN(run);
assert.equal(canvas.dataset.depthPlanes, '3');
assert.ok(run.glyphs.length > 100);
const requireUnboxed = page => assert.equal(page.ink.paths,0,'A solid face or wireframe was painted');
requireUnboxed(run);
const originalFrame = +canvas.dataset.frame, originalYaw = +canvas.dataset.yaw;
run.win.dispatchEvent(new run.win.MouseEvent('pointermove',{clientX:1100,clientY:220}));
run.advance();
assert.ok(+canvas.dataset.frame>originalFrame);
assert.notEqual(+canvas.dataset.yaw,originalYaw);
for(const [index,button] of [...run.win.document.querySelectorAll('#chapters button')].entries()) {
  button.click();run.advance();
  assert.equal(run.win.document.querySelector('.scene.active').dataset.scene,String(index));
  assert.equal(run.win.document.querySelectorAll('.scene.active').length,1);
  if(index>0)assert.equal(run.win.document.querySelector('.scene.active h2').style.opacity,'1','Chapter button landed before the heading became readable');
}
assert.equal(run.win.document.querySelector('[data-count="2.1"]').textContent,'2.1%');
function requireCrossfade(page) {
  page.seek(.92);
  assert.equal(page.win.document.querySelector('.s1').style.display,'grid');
  assert.ok(+page.win.document.querySelector('.s1 h2').style.opacity>.05,'Next chapter did not start fading in');
  assert.ok(+page.win.document.querySelector('.s0 .copy').style.opacity>.01,'Previous chapter vanished during handoff');
}
requireCrossfade(run);
// Forward and reverse travel must both leave the correct fully visible scene.
for (const phase of [2.64,1.64,3.64,.4]) {run.seek(phase);assert.equal(run.win.document.querySelector('.scene.active').dataset.scene,String(Math.floor(phase)));}
run.win.document.querySelector('#chrome-logo').click();run.advance();
assert.equal(run.win.document.querySelector('.scene.active').dataset.scene,'0');
run.close();
const broken = runtime({omitRenderer:true});
assert.throws(()=>requireRenderedN(broken), /INVALID/);
broken.close();
const boxed = runtime({paintBox:true});
assert.throws(()=>requireUnboxed(boxed),/wireframe/);boxed.close();
const abrupt = runtime({overlap:false});
assert.throws(()=>requireCrossfade(abrupt));abrupt.close();
const mobile = runtime({width:390});
mobile.seek(.999);const before=+mobile.win.document.getElementById('brain').dataset.centerY;
mobile.seek(1.001);const after=+mobile.win.document.getElementById('brain').dataset.centerY;
assert.ok(Math.abs(before-after)<.002,'Mobile N jumped at the chapter boundary');
mobile.close();
const still = runtime({reduced:true});
assert.ok(still.win.document.body.classList.contains('static'));
assert.equal(still.glyphs.length,0);
assert.equal(still.win.document.querySelector('[data-count="2.1"]').textContent,'2.1%');
still.close();
const compactPage = runtime({width:320,fa:true});
assert.ok(compactPage.win.document.body.classList.contains('static'));
assert.equal(compactPage.glyphs.length,0);
assert.equal(compactPage.win.document.querySelector('[data-count="2.1"]').textContent,'۲٫۱٪');
compactPage.close();
// Exercise both delivered locales, including the complete static fallback.
function identifyLocale(doc, fa) {
  assert.equal(doc.documentElement.lang, fa ? 'fa' : 'en');
  assert.equal(doc.documentElement.dir, fa ? 'rtl' : 'ltr');
  const actual = doc.querySelector('[data-fx="s3-title"]').textContent;
  assert.equal(actual, fa ? 'یک پلتفرم، ذهن‌های بسیار.' : 'One platform. Many minds.', 'INVALID: wrong locale subject');
  assert.notEqual(actual, fa ? 'One platform. Many minds.' : 'یک پلتفرم، ذهن‌های بسیار.');
  assert.equal(doc.querySelectorAll('.language-switch [aria-current="page"]').length, 1);
  assert.equal(doc.querySelector('.language-switch [aria-current="page"]').hreflang, fa ? 'fa' : 'en');
}
const yaws = {};
const mockYaws = {};
for (const fa of [false,true]) {
  const raw = new JSDOM(fa ? faHtml : html);
  identifyLocale(raw.window.document, fa);
  // the wordmark reads in the page's own script (2026-09-05)
  assert.equal(raw.window.document.querySelector('#boot-l1').textContent, fa ? 'نورای' : 'NeurAI');
  assert.throws(() => identifyLocale(raw.window.document, !fa));
  assert.equal(raw.window.document.querySelector('script').textContent, source, 'Locales must share the same animation engine');
  raw.window.close();
  const page = runtime({fa, width:390, hash:'#chapter-2'});
  const doc = page.win.document;
  identifyLocale(doc, fa);requireRenderedN(page);requireUnboxed(page);
  yaws[fa] = +doc.getElementById('brain').dataset.yaw;
  assert.equal(doc.querySelector('.scene.active').dataset.scene, '2');
  const currentLink = doc.querySelector(`[data-language="${fa ? 'fa' : 'en'}"]`);
  const currentClick = new page.win.MouseEvent('click', {bubbles:true,cancelable:true});
  currentLink.dispatchEvent(currentClick);
  assert.ok(currentClick.defaultPrevented,'Selecting the current language must not reset the film');
  const switchLink = doc.querySelector(`[data-language="${fa ? 'en' : 'fa'}"]`);
  switchLink.addEventListener('click', e => e.preventDefault());
  switchLink.click();
  assert.equal(new URL(switchLink.href).hash, '#chapter-2');
  assert.equal(new URL(switchLink.href).pathname, fa ? '/' : '/fa.html');
  for (const [index,button] of [...doc.querySelectorAll('#chapters button')].entries()) {
    button.click();page.advance();
    assert.equal(doc.querySelector('.scene.active').dataset.scene, String(index));
    assert.ok(button.getAttribute('aria-label'));
    assert.equal(button.getAttribute('aria-current'), 'step');
    if (index === 3) assert.equal(doc.querySelector('[data-count="2.1"]').textContent, fa ? '۲٫۱٪' : '2.1%');
    // the room mock at rest in its chapter — its turn is read off the transform (2026-09-05)
    if (index === 2) mockYaws[fa] = +/rotateY\(([-\d.e]+)deg\)/.exec(doc.querySelector('[data-fx="s2-mock"]').style.transform)[1];
  }
  page.close();
  const staticPage = runtime({fa, reduced:true, hash:'#chapter-3'});
  identifyLocale(staticPage.win.document, fa);
  assert.equal(staticPage.win.document.body.dataset.scrollTarget, 'chapter-3');
  assert.equal(staticPage.win.document.querySelector('[data-count="2.1"]').textContent, fa ? '۲٫۱٪' : '2.1%');
  staticPage.close();
}
// The Persian film mirrors the composition: copy side, N side AND the N's yaw
// (2026-09-05 — position was mirrored, the turn was not, so the N stood on
// the mirrored side facing away from the wordmark). Same chapter, same
// frame count, so the two readings must be exact negatives; the first
// assertion is the control that the reading had a subject at all.
assert.ok(Math.abs(yaws[false]) > .01, 'INVALID: chapter-2 yaw is zero, the mirror check has no subject');
assert.ok(Math.abs(yaws[true] + yaws[false]) < 1e-9, `Persian yaw ${yaws[true]} must mirror English ${yaws[false]}`);
// The room mock turns to FACE the copy in both films (2026-09-05: "make the
// image of the chatbox … face the text as well") — English on the right of
// the copy turns left (negative), Persian on the left turns right.
assert.ok(Number.isFinite(mockYaws[false]) && mockYaws[false] < -1, `INVALID: English mock yaw ${mockYaws[false]} — no turn to mirror`);
assert.ok(mockYaws[true] > 1 && Math.abs(mockYaws[true] + mockYaws[false]) < 1e-6, `Persian mock yaw ${mockYaws[true]} must mirror English ${mockYaws[false]}`);
for (const [file,fa] of [['privacy.html',false],['privacy-fa.html',true]]) {
  const text = await readFile('site/' + file,'utf8');
  const dom = new JSDOM(text);
  const doc = dom.window.document;
  assert.equal(doc.querySelector('h1').textContent, fa ? 'سیاست حریم خصوصی' : 'Privacy Policy');
  assert.notEqual(doc.querySelector('h1').textContent, fa ? 'Privacy Policy' : 'سیاست حریم خصوصی');
  assert.equal(doc.querySelectorAll('h2').length,7);
  assert.equal(doc.querySelectorAll('li').length,7);
  assert.equal(doc.querySelector('.language-switch [aria-current="page"]').hreflang,fa ? 'fa':'en');
  assert.equal(doc.querySelector('.home').getAttribute('href'),fa ? '/fa.html':'/');
  assert.ok(doc.querySelector('a[href="https://myaccount.google.com/permissions"]'));
  assert.ok(doc.querySelector('a[href="https://developers.google.com/terms/api-services-user-data-policy"]'));
  dom.window.close();
}
assert.equal((await fetch('http://127.0.0.1:4173/')).status,200);
assert.equal((await fetch('http://127.0.0.1:4173/privacy.html')).status,200);
for (const path of ['fa.html','privacy-fa.html']) {
  const response = await fetch('http://127.0.0.1:4173/' + path);
  assert.equal(response.status,200);
  const served = new JSDOM(await response.text());
  assert.equal(served.window.document.documentElement.lang,'fa');
  assert.ok(served.window.document.querySelector('h1').textContent.trim());
  served.window.close();
}
assert.equal((await fetch('http://127.0.0.1:4173/no-such-site-page')).status,404);
for (const file of ['site/index.html','site/fa.html','site/privacy.html','site/privacy-fa.html','scripts/build-company-locales.ts']) {
  const bytes = await readFile(file);
  assert.notEqual(bytes.subarray(0,3).toString('hex'),'efbbbf');
  for (const codes of [[0xe2,0x20ac],[0xc3],[0xc2,0xab],[0xd9],[0xd8],[0xef,0xbb,0xbf],[0xc2,0xa0]]) {
    assert.ok(!bytes.toString('utf8').includes(String.fromCharCode(...codes)), 'Encoding corruption in ' + file);
  }
}
console.log('PASS: EN/FA static pages and runtime, locale/subject negative controls, RTL and localized numbers, language links keep the chapter, privacy translations, full NeurAI wordmark, mirrored room mock, unboxed N, smooth camera/crossfade, reduced motion, and HTTP.');
