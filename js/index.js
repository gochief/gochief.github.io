(function () {
  'use strict';

  function initNavigation() {
    var header = document.getElementById('J_header');
    if (!header) return;

    var lastScroll = Math.max(0, window.scrollY);
    var scheduled = false;
    window.addEventListener('scroll', function () {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(function () {
        var scroll = Math.max(0, window.scrollY);
        header.classList.toggle('header-menu-overflow', scroll > lastScroll && scroll > 60);
        lastScroll = scroll;
        scheduled = false;
      });
    }, { passive: true });
    header.addEventListener('focusin', function () {
      header.classList.remove('header-menu-overflow');
    });
  }

  function initFireworks() {
    var canvas = document.getElementById('J_firework_canvas');
    if (!canvas || !window.matchMedia) return;
    var context = canvas.getContext('2d');
    if (!context) return;

    var hero = canvas.parentElement;
    var desktop = window.matchMedia('(min-width: 48em) and (hover: hover) and (pointer: fine)');
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var frameId = null;
    var particles = [];
    var pointer = null;
    var lastPointerAt = 0;
    var lastFrameAt = 0;
    var visible = true;
    var width = 0;
    var height = 0;

    function canAnimate() {
      return desktop.matches && !reducedMotion.matches && !document.hidden && visible;
    }

    function stop() {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      lastFrameAt = 0;
      pointer = null;
      particles = [];
      context.clearRect(0, 0, width, height);
    }

    function resize() {
      stop();
      if (!canAnimate()) return;
      var bounds = hero.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function schedule() {
      if (frameId === null) frameId = window.requestAnimationFrame(draw);
    }

    function draw(now) {
      frameId = null;
      if (!canAnimate()) return stop();
      var delta = lastFrameAt ? Math.min(now - lastFrameAt, 32) : 16;
      lastFrameAt = now;
      context.clearRect(0, 0, width, height);

      // Emit briefly after movement, then let existing particles fade to idle.
      if (pointer && now - lastPointerAt < 100 && particles.length < 120) {
        for (var i = 0; i < 3; i++) {
          particles.push({
            x: pointer.x + Math.random() * 10,
            y: pointer.y + Math.random() * 10,
            speed: 0.06 + Math.random() * 0.08,
            alpha: 0.4 + Math.random() * 0.5
          });
        }
      }
      particles = particles.filter(function (particle) {
        particle.y += particle.speed * delta;
        particle.alpha -= delta * 0.0015;
        if (particle.alpha <= 0 || particle.y > height) return false;
        context.beginPath();
        context.arc(particle.x, particle.y, 5, 0, Math.PI * 2);
        context.fillStyle = 'white';
        context.globalAlpha = particle.alpha;
        context.fill();
        return true;
      });
      context.globalAlpha = 1;
      if (particles.length) {
        schedule();
      } else {
        lastFrameAt = 0;
      }
    }

    hero.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch' || !canAnimate()) return;
      var bounds = hero.getBoundingClientRect();
      pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      lastPointerAt = window.performance.now();
      schedule();
    }, { passive: true });
    hero.addEventListener('pointerleave', function () { pointer = null; });
    hero.addEventListener('pointercancel', function () { pointer = null; });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
    });
    window.addEventListener('resize', resize, { passive: true });
    desktop.addEventListener('change', resize);
    reducedMotion.addEventListener('change', resize);

    if (window.IntersectionObserver) {
      var observer = new window.IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) resize();
        else stop();
      });
      observer.observe(hero);
    }
    resize();
  }

  function loadScript(url, callback) {
    var script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = callback;
    script.onerror = function () { script.remove(); };
    document.body.appendChild(script);
  }

  function initArticleTools() {
    var qr = document.getElementById('J_qr_text');
    if (qr && qr.offsetParent) {
      var requested = false;
      function loadQR() {
        if (requested) return;
        requested = true;
        loadScript('https://gw.alipayobjects.com/os/k/qa/qrcode.min.js', function () {
          if (typeof window.QRCode !== 'function') return;
          new window.QRCode(document.getElementById('J_qr_code'), {
            width: 128,
            height: 128,
            useSVG: true,
            text: window.location.href,
            correctLevel: window.QRCode.CorrectLevel.L
          });
        });
      }
      qr.addEventListener('pointerenter', loadQR, { once: true });
      qr.addEventListener('focus', loadQR, { once: true });
    }

    var images = document.querySelectorAll('.img-zoom');
    if (images.length) {
      loadScript('https://gw.alipayobjects.com/os/k/3m/intense.min.js', function () {
        if (typeof window.Intense === 'function') {
          window.Intense(images, { invertInteractionDirection: true });
        }
      });
    }
    if (typeof window.Heti === 'function') {
      new window.Heti('.heti').autoSpacing();
    }
  }

  function init() {
    initNavigation();
    initFireworks();
    initArticleTools();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}());
