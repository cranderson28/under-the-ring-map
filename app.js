(function () {
  'use strict';

  var DM_PAGE = document.body.getAttribute('data-mode') === 'dm';
  var CFG = window.UTR_CONFIG || {};
  var SMAX = 2.5;
  var DEMO_KEY = 'utr-demo-state';
  var DEMO_PW = 'demo';

  function $(id) { return document.getElementById(id); }
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else n.setAttribute(k, props[k]);
    }
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  /* ---------- backends ---------- */

  function demoBackend() {
    var subs = [], authSubs = [];
    function read() {
      try {
        var s = JSON.parse(localStorage.getItem(DEMO_KEY) || '{}');
        return { pins: s.pins || {}, maps: s.maps || {} };
      } catch (e) { return { pins: {}, maps: {} }; }
    }
    function write(s) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); } catch (e) {} fire(); }
    function fire() { var s = read(); subs.forEach(function (f) { f(s); }); }
    window.addEventListener('storage', function (e) { if (e.key === DEMO_KEY) fire(); });
    function loggedIn() { try { return sessionStorage.getItem('utr-demo-dm') === '1'; } catch (e) { return false; } }
    return {
      demo: true,
      onState: function (f) { subs.push(f); f(read()); },
      setPin: function (id, on) { var s = read(); if (on) s.pins[id] = true; else delete s.pins[id]; write(s); },
      setMap: function (id, on) { var s = read(); if (on) s.maps[id] = true; else delete s.maps[id]; write(s); },
      onAuth: function (f) { authSubs.push(f); f(loggedIn()); },
      login: function (email, pw) {
        return new Promise(function (res, rej) {
          if (pw === DEMO_PW) { try { sessionStorage.setItem('utr-demo-dm', '1'); } catch (e) {} authSubs.forEach(function (f) { f(true); }); res(); }
          else rej(new Error('Wrong password (test mode password is "demo").'));
        });
      },
      logout: function () { try { sessionStorage.removeItem('utr-demo-dm'); } catch (e) {} authSubs.forEach(function (f) { f(false); }); }
    };
  }

  function firebaseBackend(cfg) {
    firebase.initializeApp(cfg);
    var db = firebase.database();
    var auth = DM_PAGE && firebase.auth ? firebase.auth() : null;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { try { db.goOnline(); } catch (e) {} }
    });
    return {
      demo: false,
      onState: function (f) {
        db.ref('state').on('value', function (snap) {
          var v = snap.val() || {};
          f({ pins: v.pins || {}, maps: v.maps || {} });
        });
      },
      setPin: function (id, on) { return db.ref('state/pins/' + id).set(on ? true : null); },
      setMap: function (id, on) { return db.ref('state/maps/' + id).set(on ? true : null); },
      onAuth: function (f) { if (auth) auth.onAuthStateChanged(function (u) { f(!!u); }); else f(false); },
      login: function (email, pw) { return auth.signInWithEmailAndPassword(email, pw); },
      logout: function () { if (auth) auth.signOut(); }
    };
  }

  var backend = (CFG.firebase && window.firebase) ? firebaseBackend(CFG.firebase) : demoBackend();

  /* ---------- state ---------- */

  var maps = [], pinsByMap = {};
  var state = { pins: {}, maps: {} };
  var cur = null, selId = null, canEdit = false, coordOn = false;
  var view = { s: 1, cx: 0, cy: 0 };
  var vw = 0, vh = 0, W = 1, H = 1, wrap = true;
  var items = [];           // [{pin, els:[btn,btn]}]
  var openWards = {};
  var raf = 0;

  var stage = $('stage'), mapEl = $('map'), pinsEl = $('pins'), panel = $('panel');
  var cross = el('div', { 'class': 'cross' });
  pinsEl.appendChild(cross);

  function revealed(p) { return !!state.pins[p.id]; }
  function unlocked(m) { return !!m.alwaysUnlocked || !!state.maps[m.id]; }
  function selectable() { return DM_PAGE ? maps : maps.filter(unlocked); }
  function wardOf(p) {
    for (var i = 0; i < cur.wards.length; i++) if (cur.wards[i].id === p.ward) return cur.wards[i];
    return { name: '', color: '#d9b36a' };
  }
  function curPins() { return pinsByMap[cur.id] || []; }
  function visiblePins() { return DM_PAGE ? curPins() : curPins().filter(revealed); }

  /* ---------- view ---------- */

  function clamp() {
    var smin = Math.max(vh / H, wrap ? vw / W : vw / W);
    view.s = Math.min(Math.max(view.s, smin), Math.max(SMAX, smin));
    var hh = vh / (2 * view.s);
    view.cy = (hh * 2 >= H) ? H / 2 : Math.min(H - hh, Math.max(hh, view.cy));
    if (wrap) view.cx = ((view.cx % W) + W) % W;
    else {
      var hw = vw / (2 * view.s);
      view.cx = (hw * 2 >= W) ? W / 2 : Math.min(W - hw, Math.max(hw, view.cx));
    }
  }
  function req() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(); }); }

  function zoomAt(sx, sy, ns) {
    var wx = view.cx + (sx - vw / 2) / view.s;
    var wy = view.cy + (sy - vh / 2) / view.s;
    view.s = ns;
    view.cx = wx - (sx - vw / 2) / ns;
    view.cy = wy - (sy - vh / 2) / ns;
    clamp(); req();
  }

  function render() {
    if (!cur) return;
    clamp();
    var s = view.s, bgx = vw / 2 - view.cx * s, bgy = vh / 2 - view.cy * s;
    mapEl.style.backgroundSize = (W * s) + 'px ' + (H * s) + 'px';
    mapEl.style.backgroundPosition = bgx + 'px ' + bgy + 'px';
    stage.classList.toggle('labels', s >= 0.5);
    var Ws = W * s;
    items.forEach(function (it) {
      var px = bgx + it.pin.x * s, py = bgy + it.pin.y * s;
      var xs = wrap ? (function () { var x0 = ((px % Ws) + Ws) % Ws; return [x0, x0 - Ws]; })() : [px];
      it.els.forEach(function (b, i) {
        if (i >= xs.length) { b.style.display = 'none'; return; }
        var x = xs[i];
        if (x < -80 || x > vw + 80 || py < -40 || py > vh + 40) { b.style.display = 'none'; return; }
        b.style.display = '';
        b.style.left = Math.round(x) + 'px';
        b.style.top = Math.round(py) + 'px';
      });
    });
    if (cross._w) {
      var cx0 = bgx + cross._w.x * s, cy0 = bgy + cross._w.y * s;
      var x1 = wrap ? ((cx0 % Ws) + Ws) % Ws : cx0;
      cross.style.left = x1 + 'px'; cross.style.top = cy0 + 'px';
      cross.style.display = 'block';
    }
  }

  function flyTo(x, y) {
    var s0 = view.s, s1 = Math.max(s0, Math.min(1.0, SMAX));
    var x0 = view.cx, y0 = view.cy;
    var dx = x - x0;
    if (wrap) dx = ((dx + W / 2) % W + W) % W - W / 2;
    var dy = y - y0, t0 = performance.now(), D = 450;
    function step(t) {
      var k = Math.min(1, (t - t0) / D); k = k * k * (3 - 2 * k);
      view.s = s0 + (s1 - s0) * k;
      view.cx = x0 + dx * k; view.cy = y0 + dy * k;
      render();
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- building the UI ---------- */

  function buildPins() {
    pinsEl.querySelectorAll('.pin').forEach(function (n) { n.remove(); });
    items = [];
    visiblePins().forEach(function (p) {
      if (p.x == null || p.y == null) return; // card-only pin: listed in the ward panel, no dot
      var w = wardOf(p), els = [];
      for (var i = 0; i < (wrap ? 2 : 1); i++) {
        var b = el('button', { 'class': 'pin', type: 'button', 'aria-label': p.name, 'data-id': p.id }, [
          el('span', { 'class': 'dot' })].concat(p.nolabel ? [] : [el('span', { 'class': 'lab', text: p.name })]));
        b.style.setProperty('--c', w.color);
        if (DM_PAGE && !revealed(p)) b.classList.add('off');
        if (p.id === selId) b.classList.add('sel');
        b.addEventListener('click', function (e) {
          if (justDragged) return;
          e.stopPropagation();
          select(p.id, false);
        });
        pinsEl.appendChild(b); els.push(b);
      }
      items.push({ pin: p, els: els });
    });
    req();
  }

  function buildCard() {
    var c = $('card');
    var p = selId && curPins().filter(function (q) { return q.id === selId; })[0];
    if (!p || (!DM_PAGE && !revealed(p))) {
      selId = null;
      c.className = 'empty'; c.style.removeProperty('--c'); c.textContent =
        DM_PAGE ? 'Tap a pin to see its card. Use the switches below to reveal or hide pins.' : 'Tap a pin on the map to read about it.';
      return;
    }
    var w = wardOf(p);
    c.className = ''; c.style.setProperty('--c', w.color); c.textContent = '';
    c.appendChild(el('h2', { text: p.name }));
    c.appendChild(el('div', { 'class': 'where', text: w.name }));
    c.appendChild(el('p', { text: p.text || '' }));
  }

  function buildPanel() {
    var box = $('wards'); box.textContent = '';
    var all = curPins();
    cur.wards.forEach(function (w) {
      var list = all.filter(function (p) { return p.ward === w.id; });
      var rev = list.filter(revealed);
      var shown = (DM_PAGE ? list : rev).slice().sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); });
      var d = el('details'); d.style.setProperty('--c', w.color);
      if (openWards[w.id]) d.open = true;
      d.addEventListener('toggle', function () { openWards[w.id] = d.open; });
      d.appendChild(el('summary', {}, [
        el('span', { text: w.name }),
        el('span', { 'class': 'count', text: DM_PAGE ? rev.length + '/' + list.length : String(rev.length) })
      ]));
      var ul = el('ul');
      shown.forEach(function (p) {
        var li = el('li', { 'class': revealed(p) ? '' : 'off' });
        var b = el('button', { type: 'button', text: p.name });
        if (p.id === selId) b.className = 'sel';
        b.addEventListener('click', function () { select(p.id, true); });
        li.appendChild(b);
        if (DM_PAGE) {
          var cb = el('input', { type: 'checkbox', 'class': 'switch', 'aria-label': 'Reveal ' + p.name });
          cb.checked = revealed(p);
          cb.addEventListener('change', function () { backend.setPin(p.id, cb.checked); });
          li.appendChild(cb);
        }
        ul.appendChild(li);
      });
      d.appendChild(ul);
      box.appendChild(d);
    });
    if (DM_PAGE) {
      var tot = all.length, r = all.filter(revealed).length;
      $('tally').textContent = 'Revealed ' + r + ' of ' + tot + ' pins' + (backend.demo ? ' (test mode)' : '');
    }
  }

  function buildMapSel() {
    var sel = $('mapsel'), list = selectable();
    sel.textContent = '';
    list.forEach(function (m) {
      var o = el('option', { value: m.id, text: m.name });
      if (cur && m.id === cur.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.hidden = list.length < 2;
  }

  function buildMapSec() {
    if (!DM_PAGE) return;
    var box = $('maplist'); box.textContent = '';
    var locks = maps.filter(function (m) { return !m.alwaysUnlocked; });
    $('mapsec').style.display = locks.length ? '' : 'none';
    locks.forEach(function (m) {
      var cb = el('input', { type: 'checkbox', 'class': 'switch' });
      cb.checked = !!state.maps[m.id];
      cb.addEventListener('change', function () { backend.setMap(m.id, cb.checked); });
      box.appendChild(el('label', {}, [cb, el('span', { text: m.name })]));
    });
  }

  function select(id, fly) {
    selId = id;
    buildCard(); buildPanel();
    items.forEach(function (it) { it.els.forEach(function (b) { b.classList.toggle('sel', it.pin.id === id); }); });
    var p = curPins().filter(function (q) { return q.id === id; })[0];
    if (p && fly && p.x != null && p.y != null) flyTo(p.x, p.y);
    panel.scrollTop = 0;
    req();
  }

  function loadMap(m) {
    cur = m; W = m.width; H = m.height; wrap = !!m.wrap; selId = null; openWards = {};
    mapEl.style.backgroundImage = 'url("' + m.image + '")';
    mapEl.style.backgroundRepeat = wrap ? 'repeat-x' : 'no-repeat';
    cross._w = null; cross.style.display = 'none';
    measure();
    view.s = 0; view.cx = W / 2; view.cy = H / 2;
    clamp();
    buildMapSel(); buildMapSec(); buildPins(); buildCard(); buildPanel();
  }

  function measure() { vw = stage.clientWidth; vh = stage.clientHeight; }

  function onState(s) {
    state = s;
    if (!maps.length) return;
    if (!cur || (!DM_PAGE && !unlocked(cur))) {
      var first = selectable()[0];
      if (first && (!cur || first.id !== cur.id)) { loadMap(first); return; }
    }
    buildMapSel(); buildMapSec(); buildPins(); buildCard(); buildPanel();
  }

  /* ---------- gestures ---------- */

  var ptrs = {}, gest = null, justDragged = false;
  function rel(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function ptrList() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }

  stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('#mapctl') || e.target.closest('#coord')) return;
    var p = rel(e);
    ptrs[e.pointerId] = { x: p.x, y: p.y, t: e.target };
    var l = ptrList();
    if (l.length === 1) gest = { type: 'pan', sx: p.x, sy: p.y, moved: false, lx: p.x, ly: p.y };
    else if (l.length === 2) {
      gest = { type: 'pinch', moved: true, d: Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y), mx: (l[0].x + l[1].x) / 2, my: (l[0].y + l[1].y) / 2 };
      stage.classList.add('dragging');
    }
  });

  stage.addEventListener('pointermove', function (e) {
    if (!ptrs[e.pointerId] || !gest) return;
    var p = rel(e); ptrs[e.pointerId].x = p.x; ptrs[e.pointerId].y = p.y;
    if (gest.type === 'pan') {
      if (!gest.moved && Math.hypot(p.x - gest.sx, p.y - gest.sy) < 6) return;
      if (!gest.moved) {
        gest.moved = true; stage.classList.add('dragging');
        try { stage.setPointerCapture(e.pointerId); } catch (er) {}
      }
      view.cx -= (p.x - gest.lx) / view.s; view.cy -= (p.y - gest.ly) / view.s;
      gest.lx = p.x; gest.ly = p.y; clamp(); req();
    } else if (gest.type === 'pinch') {
      var l = ptrList(); if (l.length < 2) return;
      var d = Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y), mx = (l[0].x + l[1].x) / 2, my = (l[0].y + l[1].y) / 2;
      view.cx -= (mx - gest.mx) / view.s; view.cy -= (my - gest.my) / view.s;
      if (gest.d > 0) zoomAt(mx, my, view.s * d / gest.d);
      gest.d = d; gest.mx = mx; gest.my = my; clamp(); req();
    }
  });

  function endPtr(e) {
    var info = ptrs[e.pointerId];
    if (!info) return;
    var wasMoved = gest && gest.moved;
    delete ptrs[e.pointerId];
    var n = Object.keys(ptrs).length;
    if (n === 0) {
      if (gest && gest.type === 'pan' && !gest.moved && e.type === 'pointerup' && coordOn && !(info.t && info.t.closest && info.t.closest('.pin'))) {
        var p = rel(e);
        var wx = view.cx + (p.x - vw / 2) / view.s, wy = view.cy + (p.y - vh / 2) / view.s;
        if (wrap) wx = ((wx % W) + W) % W;
        showCoord(wx, wy);
      }
      if (wasMoved) { justDragged = true; setTimeout(function () { justDragged = false; }, 60); }
      gest = null; stage.classList.remove('dragging');
    } else if (n === 1) {
      var rest = ptrList()[0];
      gest = { type: 'pan', sx: rest.x, sy: rest.y, moved: true, lx: rest.x, ly: rest.y };
    }
  }
  stage.addEventListener('pointerup', endPtr);
  stage.addEventListener('pointercancel', endPtr);

  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = rel(e);
    zoomAt(p.x, p.y, view.s * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  $('zin').addEventListener('click', function () { zoomAt(vw / 2, vh / 2, view.s * 1.4); });
  $('zout').addEventListener('click', function () { zoomAt(vw / 2, vh / 2, view.s / 1.4); });
  $('mapsel').addEventListener('change', function () {
    var m = maps.filter(function (x) { return x.id === $('mapsel').value; })[0];
    if (m) loadMap(m);
  });

  if (window.ResizeObserver) new ResizeObserver(function () { measure(); req(); }).observe(stage);
  window.addEventListener('resize', function () { measure(); req(); });

  /* ---------- DM extras ---------- */

  function showCoord(x, y) {
    cross._w = { x: x, y: y };
    $('coord').textContent = 'x ' + Math.round(x) + ', y ' + Math.round(y);
    $('coord').style.display = 'block';
    req();
  }

  if (DM_PAGE) {
    $('loginform').addEventListener('submit', function (e) {
      e.preventDefault();
      $('loginerr').textContent = '';
      Promise.resolve(backend.login($('em').value, $('pw').value)).catch(function (err) {
        $('loginerr').textContent = (err && err.message) || 'Sign in failed.';
      });
    });
    $('logout').addEventListener('click', function () { backend.logout(); });
    $('coordbtn').addEventListener('click', function () {
      coordOn = !coordOn;
      $('coordbtn').textContent = coordOn ? 'Hide coordinates' : 'Show coordinates';
      if (!coordOn) { $('coord').style.display = 'none'; cross.style.display = 'none'; cross._w = null; }
      else { $('coord').textContent = 'Tap the map'; $('coord').style.display = 'block'; }
    });
    backend.onAuth(function (ok) {
      canEdit = ok;
      $('login').style.display = ok ? 'none' : 'flex';
    });
  }

  /* ---------- start ---------- */

  function getJSON(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }

  Promise.all([getJSON('data/maps.json'), getJSON('data/pins.json')]).then(function (r) {
    maps = r[0]; pinsByMap = r[1];
    measure();
    backend.onState(onState);
    if (!cur && maps.length) loadMap(selectable()[0] || maps[0]);
    window.UTR = { view: view, get state() { return state; }, get cur() { return cur; }, render: render };
  }).catch(function (err) {
    $('card').textContent = 'Could not load the map data.';
    if (window.console) console.error(err);
  });
})();
