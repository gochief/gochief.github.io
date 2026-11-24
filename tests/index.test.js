const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/index.js'), 'utf8');

function target(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, callback, options = {}) {
      const entries = listeners.get(type) || [];
      entries.push({ callback, once: options.once });
      listeners.set(type, entries);
    },
    dispatch(type, event = {}) {
      const entries = (listeners.get(type) || []).slice();
      for (const entry of entries) {
        if (entry.once) {
          listeners.set(type, listeners.get(type).filter(item => item !== entry));
        }
        entry.callback(event);
      }
    }
  }, extra);
}

function browser(options = {}) {
  const frames = new Map();
  const classes = new Set();
  const scripts = [];
  let clock = 0;
  let nextId = 0;
  let visibility;
  let fills = 0;
  const context = {
    clearRect() {}, setTransform() {}, beginPath() {}, arc() {},
    fill() { fills++; }
  };
  const hero = target({
    getBoundingClientRect: () => ({ left: 40, top: 60, width: 900, height: 260 })
  });
  const canvas = {
    parentElement: hero,
    getContext: () => options.noContext ? null : context
  };
  const header = target({
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      remove(name) { classes.delete(name); }
    }
  });
  const qr = target({ offsetParent: options.mobile ? null : {} });
  const elements = { J_header: header, J_firework_canvas: canvas };
  if (options.qr) {
    elements.J_qr_text = qr;
    elements.J_qr_code = {};
  }
  const desktop = target({ matches: !options.mobile });
  const motion = target({ matches: !!options.reducedMotion });
  const document = target({
    readyState: 'complete',
    hidden: false,
    getElementById: id => options.noElements ? null : elements[id],
    querySelectorAll: () => options.zoom ? [{}] : [],
    createElement: () => ({ remove() { this.removed = true; } }),
    body: { appendChild: script => scripts.push(script) }
  });
  const window = target({
    scrollY: 0,
    devicePixelRatio: 3,
    location: { href: 'https://gochief.github.io/post.html' },
    performance: { now: () => clock },
    matchMedia: query => query.includes('prefers-reduced-motion') ? motion : desktop,
    requestAnimationFrame(callback) {
      frames.set(++nextId, callback);
      return nextId;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    IntersectionObserver: class {
      constructor(callback) { visibility = callback; }
      observe() {}
    }
  });
  vm.runInNewContext(source, { window, document });
  return {
    window, document, hero, canvas, header, qr, scripts, frames, classes, motion, desktop,
    get fills() { return fills; },
    intersect(visible) { visibility([{ isIntersecting: visible }]); },
    move() { hero.dispatch('pointermove', { clientX: 100, clientY: 100, pointerType: 'mouse' }); },
    frame(time) {
      clock = time;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(time));
    }
  };
}

test('canvas stays idle until input, caps pixel density, then returns to idle', () => {
  const page = browser();
  assert.equal(page.frames.size, 0);
  assert.equal(page.canvas.width, 1800);
  assert.equal(page.canvas.height, 520);
  page.move();
  assert.equal(page.frames.size, 1);
  for (let time = 16; time <= 1600; time += 16) page.frame(time);
  assert.ok(page.fills > 0);
  assert.equal(page.frames.size, 0);
});

test('mobile and reduced-motion users do not start particle animation', () => {
  for (const options of [{ mobile: true }, { reducedMotion: true }]) {
    const page = browser(options);
    page.move();
    assert.equal(page.frames.size, 0);
    assert.equal(page.fills, 0);
  }
});

test('hiding the tab or moving the hero offscreen cancels pending animation', () => {
  const page = browser();
  page.move();
  page.document.hidden = true;
  page.document.dispatch('visibilitychange');
  assert.equal(page.frames.size, 0);
  page.document.hidden = false;
  page.move();
  assert.equal(page.frames.size, 1);
  page.intersect(false);
  assert.equal(page.frames.size, 0);
  page.move();
  assert.equal(page.frames.size, 0);
});

test('changing motion preferences stops an active effect', () => {
  const page = browser();
  page.move();
  page.motion.matches = true;
  page.motion.dispatch('change');
  assert.equal(page.frames.size, 0);
});

test('scroll work is grouped per frame and keyboard focus reveals navigation', () => {
  const page = browser();
  page.window.scrollY = 100;
  for (let i = 0; i < 5; i++) page.window.dispatch('scroll');
  assert.equal(page.frames.size, 1);
  page.frame(16);
  assert.ok(page.classes.has('header-menu-overflow'));
  page.header.dispatch('focusin');
  assert.ok(!page.classes.has('header-menu-overflow'));
  page.window.scrollY = 80;
  page.window.dispatch('scroll');
  page.frame(32);
  assert.ok(!page.classes.has('header-menu-overflow'));
});

test('missing elements, canvas support, or optional libraries do not break startup', () => {
  assert.doesNotThrow(() => browser({ noElements: true }));
  assert.doesNotThrow(() => browser({ noContext: true }));
  const page = browser({ qr: true, zoom: true });
  assert.equal(page.scripts.length, 1);
  assert.doesNotThrow(() => page.scripts[0].onload());
  page.scripts[0].onerror();
  assert.equal(page.scripts[0].removed, true);
});

test('QR code loads on interaction once, including keyboard interaction', () => {
  const page = browser({ qr: true });
  assert.equal(page.scripts.length, 0);
  page.qr.dispatch('focus');
  page.qr.dispatch('pointerenter');
  assert.equal(page.scripts.length, 1);
  assert.doesNotThrow(() => page.scripts[0].onload());
});
