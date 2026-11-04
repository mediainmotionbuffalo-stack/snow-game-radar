// Snow Game Radar: the 3D game cams for the kick simulator and the QB view.
// Loaded only when one of them is on screen. Field coordinates come in yards: x across (+ right),
// y down the field from the offense's own goal line (far goal line = 100), z up.
import * as THREE from './vendor/three.module.min.js';

const P3 = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
const SIDE = 26.67, HASH = 3.08;
const hashStr = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const col = (c, d = '#335') => new THREE.Color(/^#[0-9a-f]{6}$/i.test(c || '') ? c : d);
function shade(hex, k) { const c = col(hex); if (k < 0) c.multiplyScalar(1 + k); else c.lerp(new THREE.Color('#fff'), k); return c; }
function canvasTex(w, h, draw, opts = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opts.repeat); }
  t.anisotropy = opts.aniso || 1;
  return t;
}
const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function makeWorld(canvas, opt = {}) {
  const lite = !!opt.lite;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = !lite;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1.6, 0.2, 900);
  const font = opt.font || 'sans-serif';

  // ----- lights -----
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3a4a2a, 0.9);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.castShadow = !lite;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 300 });
  sun.shadow.bias = -0.0008;
  scene.add(hemi, sun, sun.target);

  // ----- sky dome -----
  const skyGeo = new THREE.SphereGeometry(700, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  function paintSky(top, horizon) {
    const pos = skyGeo.attributes.position, colors = [];
    const a = col(top), b = col(horizon), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) { const k = Math.max(0, pos.getY(i) / 700); c.copy(b).lerp(a, Math.pow(k, 0.6)); colors.push(c.r, c.g, c.b); }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, (x, w) => { const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,245,1)'); g.addColorStop(0.18, 'rgba(255,248,220,0.95)'); g.addColorStop(0.4, 'rgba(255,230,170,0.25)'); g.addColorStop(1, 'rgba(255,230,170,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }), fog: false, depthWrite: false, transparent: true }));
  sunDisc.scale.set(120, 120, 1);
  scene.add(sunDisc);

  // ----- the field (one big painted texture) -----
  const FX0 = -32, FX1 = 32, FY0 = -18, FY1 = 118, PPY = 20;
  let fieldTex = null, fieldMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(FX1 - FX0, FY1 - FY0), fieldMat);
  field.rotation.x = -Math.PI / 2; field.position.copy(P3((FX0 + FX1) / 2, (FY0 + FY1) / 2, 0)); field.receiveShadow = true;
  scene.add(field);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(220, 260), new THREE.MeshStandardMaterial({ color: 0x23502a, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.copy(P3(0, 50, -0.02)); apron.receiveShadow = true;
  scene.add(apron);
  function paintField(cfg, logoImg) {
    const W = (FX1 - FX0) * PPY, H = (FY1 - FY0) * PPY;
    const X = x => (x - FX0) * PPY, Y = y => (FY1 - y) * PPY;
    const t = canvasTex(W, H, (c) => {
      const night = cfg.night;
      c.fillStyle = night ? '#23552b' : '#2b6a32'; c.fillRect(0, 0, W, H);
      // mowing: 5-yard bands, plus a faint crosshatch
      for (let y = 0; y < 100; y += 5) { c.fillStyle = (y / 5) % 2 ? (night ? '#2a6533' : '#347a3b') : (night ? '#25592d' : '#2d6d34'); c.fillRect(X(-SIDE), Y(y + 5), SIDE * 2 * PPY, 5 * PPY); }
      c.globalAlpha = 0.06; c.fillStyle = '#000';
      for (let x = -SIDE; x < SIDE; x += 5) if (Math.round(x / 5) % 2) c.fillRect(X(x), Y(110), 5 * PPY, 120 * PPY);
      c.globalAlpha = 1;
      // grass texture speckle
      for (let i = 0; i < 26000; i++) { c.fillStyle = rnd(i) > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'; c.fillRect(rnd(i * 1.7) * W, rnd(i * 2.3) * H, 2, 2); }
      // end zones in the home team's colors, with the team name
      const ez = shade(cfg.home.color, -0.12).getStyle();
      c.fillStyle = ez; c.fillRect(X(-SIDE), Y(110), SIDE * 2 * PPY, 10 * PPY); c.fillRect(X(-SIDE), Y(0), SIDE * 2 * PPY, 10 * PPY);
      const name = String(cfg.home.name || '').toUpperCase();
      for (const [cy, flip] of [[105, false], [-5, true]]) {
        c.save(); c.translate(X(0), Y(cy)); if (flip) c.rotate(Math.PI);
        c.font = `italic 900 ${7.2 * PPY}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        const w = c.measureText(name).width, sx = Math.min(1, 44 * PPY / Math.max(1, w));
        c.scale(sx, 1); c.lineWidth = 0.5 * PPY; c.strokeStyle = shade(cfg.home.color, -0.5).getStyle(); c.strokeText(name, 0, 0); c.fillStyle = '#fff'; c.fillText(name, 0, 0);
        c.restore();
      }
      // white: sidelines and end lines (6 ft wide border), goal lines, yard lines, hashes
      c.fillStyle = 'rgba(248,250,246,0.95)';
      c.fillRect(X(-SIDE - 2), Y(112), 2 * PPY, 124 * PPY); c.fillRect(X(SIDE), Y(112), 2 * PPY, 124 * PPY);
      c.fillRect(X(-SIDE - 2), Y(112), (SIDE * 2 + 4) * PPY, 2 * PPY); c.fillRect(X(-SIDE - 2), Y(-10), (SIDE * 2 + 4) * PPY, 2 * PPY);
      const lw = Math.max(2, 0.12 * PPY);
      for (let y = 0; y <= 100; y += 5) c.fillRect(X(-SIDE), Y(y) - lw / 2, SIDE * 2 * PPY, y === 0 || y === 100 ? lw * 1.6 : lw);
      for (let y = 1; y < 100; y++) if (y % 5) for (const x of [-HASH, HASH, -SIDE + 0.4, SIDE - 0.4]) c.fillRect(X(x - 0.33), Y(y) - lw / 2, 0.66 * PPY, lw);
      // two-point marks
      c.fillRect(X(-0.33), Y(2) - lw / 2, 0.66 * PPY, lw); c.fillRect(X(-0.33), Y(98) - lw / 2, 0.66 * PPY, lw);
      // yard numbers with their arrows
      c.font = `900 ${2 * PPY}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let y = 10; y <= 90; y += 10) for (const sd of [-1, 1]) {
        const n = String(y <= 50 ? y : 100 - y);
        c.save(); c.translate(X(sd * (SIDE - 10.3)), Y(y)); c.rotate(sd * Math.PI / 2);
        c.fillText(n[0], -0.75 * PPY, 0); if (n[1]) c.fillText(n[1], 0.75 * PPY, 0);
        if (y !== 50) { const d = (y < 50 ? -1 : 1) * sd; c.beginPath(); c.moveTo(d * -2.1 * PPY, 0); c.lineTo(d * -1.6 * PPY, -0.35 * PPY); c.lineTo(d * -1.6 * PPY, 0.35 * PPY); c.closePath(); c.fill(); }
        c.restore();
      }
      // logo at midfield
      if (logoImg && logoImg.naturalWidth) { c.globalAlpha = 0.92; c.drawImage(logoImg, X(-7), Y(57), 14 * PPY, 14 * PPY); c.globalAlpha = 1; }
    }, { aniso });
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    if (fieldTex) fieldTex.dispose();
    fieldTex = t; fieldMat.map = t; fieldMat.needsUpdate = true;
  }
  // snow lying on the field
  const snowTex = canvasTex(512, 512, (c, w) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, w); for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${200 + rnd(i) * 40 | 0},${215 + rnd(i * 2) * 30 | 0},235,${0.25 * rnd(i * 3)})`; c.beginPath(); c.arc(rnd(i * 5) * w, rnd(i * 7) * w, 1 + rnd(i * 11) * 3, 0, 6.283); c.fill(); } }, { repeat: [14, 28], aniso });
  const snowMat = new THREE.MeshStandardMaterial({ map: snowTex, color: 0xf4f8fc, roughness: 0.85, transparent: true, opacity: 0, depthWrite: false });
  const snowLayer = new THREE.Mesh(new THREE.PlaneGeometry(140, 240), snowMat);
  snowLayer.rotation.x = -Math.PI / 2; snowLayer.position.copy(P3(0, 50, 0.015)); snowLayer.receiveShadow = true; snowLayer.renderOrder = 1;
  scene.add(snowLayer);

  // ----- TV lines (line of scrimmage, first down), routes and the aim arrow -----
  const flatMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
  const losLine = new THREE.Mesh(new THREE.PlaneGeometry(SIDE * 2, 0.32), flatMat(0x3d82ff)); losLine.rotation.x = -Math.PI / 2; losLine.renderOrder = 2;
  const fdLine = new THREE.Mesh(new THREE.PlaneGeometry(SIDE * 2, 0.32), flatMat(0xffd21f)); fdLine.rotation.x = -Math.PI / 2; fdLine.renderOrder = 2;
  scene.add(losLine, fdLine);
  const artGroup = new THREE.Group(); scene.add(artGroup);
  function ribbon(pts, color, width) {
    // a flat strip along the ground through the points
    const g = new THREE.BufferGeometry(), v = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * width / 2, ny = dx / L * width / 2;
      const p = pts[i], z = p[2] ?? 0.04;
      v.push(p[0] + nx, z, -(p[1] + ny), p[0] - nx, z, -(p[1] - ny));
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.renderOrder = 3; return m;
  }
  function arrowHead(p, q, color, size) {
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const shape = [[q[0] + ux * size, q[1] + uy * size], [q[0] - uy * size * 0.8, q[1] + ux * size * 0.8], [q[0] + uy * size * 0.8, q[1] - ux * size * 0.8]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(shape.flatMap(([x, y]) => [x, 0.05, -y]), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.renderOrder = 3; return m;
  }
  let artKey = '';
  function setArt(routes, aim, preview) {
    const key = JSON.stringify([routes, aim, preview && preview.length]);
    if (key === artKey && !preview) return;
    artKey = key;
    for (const c of [...artGroup.children]) { artGroup.remove(c); c.geometry.dispose(); c.material.dispose(); }
    for (const r of routes || []) { artGroup.add(ribbon(r.pts.map(p => [p[0], p[1], 0.05]), r.color, 0.32)); const n = r.pts.length; if (n > 1) artGroup.add(arrowHead(r.pts[n - 2], r.pts[n - 1], r.color, 0.9)); }
    if (aim) { const [a, b] = aim; artGroup.add(ribbon([a, b], 0xffd21f, 0.5)); artGroup.add(arrowHead(a, b, 0xffd21f, 1.3)); }
    if (preview && preview.length > 1) {
      const g = new THREE.BufferGeometry().setFromPoints(preview.map(p => P3(p[0], p[1], p[2])));
      const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.7, fog: false }));
      l.computeLineDistances(); artGroup.add(l);
    }
  }

  // ----- the stadium bowl -----
  const stadium = new THREE.Group(); scene.add(stadium);
  function buildStadium(cfg) {
    for (const c of [...stadium.children]) { stadium.remove(c); c.traverse(o => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach(m => { m.map?.dispose(); m.dispose(); }); }); }
    const home = cfg.home.color, away = cfg.away.color;
    const crowdTex = canvasTex(1024, 256, (c, w, h) => {
      c.fillStyle = cfg.night ? '#141a24' : '#3a424e'; c.fillRect(0, 0, w, h);
      const pal = [home, home, '#f2f2f2', shade(home, -0.4).getStyle(), away, '#c9a76a', '#6b7785', '#262c35', '#d8423a'];
      for (let row = 0; row < 16; row++) {
        c.fillStyle = cfg.night ? '#0d1118' : '#2a3039'; c.fillRect(0, row * 16 + 12, w, 4);   // row of seats
        for (let s = 0; s < 128; s++) { if (rnd(row * 999 + s) < 0.1) continue; c.fillStyle = pal[(hashStr(row + '-' + s)) % pal.length]; const x = s * 8 + rnd(s + row) * 2; c.fillRect(x, row * 16 + 3, 6, 9); c.fillStyle = 'rgba(240,210,180,0.8)'; c.fillRect(x + 1.5, row * 16 + 1, 3, 3); }
      }
    }, { repeat: [10, 3], aniso });
    const standMat = new THREE.MeshLambertMaterial({ map: crowdTex, emissive: cfg.night ? 0x1a2030 : 0x000000 });
    const concrete = new THREE.MeshLambertMaterial({ color: cfg.night ? 0x262b33 : 0x6c727a });
    const fascia = new THREE.MeshLambertMaterial({ color: shade(home, -0.15), emissive: cfg.night ? shade(home, -0.6) : new THREE.Color(0) });
    const wallMat = new THREE.MeshLambertMaterial({ color: shade(home, -0.3) });
    // sloped seating as a ramp: from (inner, 0) rising to (outer, top)
    const ramp = (x0, x1, z0, z1, y0, y1, along) => {
      const len = Math.abs(along ? x1 - x0 : y1 - y0) || 1;
      const g = new THREE.BufferGeometry();
      let v;
      if (along) v = [x0, z0, -y0, x1, z0, -y0, x1, z1, -y1, x0, z1, -y1];     // end stands: run along x, rise toward y1
      else v = [x0, z0, -y0, x0, z0, -y1, x1, z1, -y1, x1, z1, -y0];           // side stands: run along y, rise toward x1
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
      const m = new THREE.Mesh(g, standMat.clone()); m.material.side = THREE.DoubleSide; m.material.map = crowdTex.clone(); m.material.map.needsUpdate = true; m.material.map.repeat.set(Math.max(2, len / 12), 3); m.material.map.wrapS = m.material.map.wrapT = THREE.RepeatWrapping;
      return m;
    };
    for (const sd of [-1, 1]) {
      stadium.add(ramp(sd * 35, sd * 58, 1.6, 18, -40, 140, false));
      stadium.add(ramp(sd * 61, sd * 80, 22, 40, -40, 140, false));
      // fascia between decks and the sideline wall
      const f = new THREE.Mesh(new THREE.BoxGeometry(2, 3.5, 180), fascia); f.position.copy(P3(sd * 59.5, 50, 19.6)); stadium.add(f);
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 180), wallMat); w.position.copy(P3(sd * 34.7, 50, 0.8)); stadium.add(w);
      // roof edge
      const r = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 190), concrete); r.position.copy(P3(sd * 76, 50, 44)); stadium.add(r);
    }
    for (const [y0, y1] of [[126, 150], [-26, -50]]) {
      stadium.add(ramp(-60, 60, 1.6, 20, y0, y1, true));
      const w = new THREE.Mesh(new THREE.BoxGeometry(120, 1.6, 0.6), wallMat); w.position.copy(P3(0, y0 - Math.sign(y1 - y0) * 0.5, 0.8)); stadium.add(w);
    }
    // boards along the walls: the home team's name and the app's own, in the team colors
    const boardTex = canvasTex(1024, 64, (c, w, h) => {
      const words = [String(cfg.home.name || '').toUpperCase(), 'SNOW GAME RADAR', 'FOOTBALL WEATHER', String(cfg.home.name || '').toUpperCase()];
      const seg = w / words.length;
      words.forEach((t, i) => {
        c.fillStyle = i % 2 ? shade(home, -0.45).getStyle() : shade(home, -0.1).getStyle(); c.fillRect(i * seg, 0, seg, h);
        c.fillStyle = '#fff'; c.font = `italic 900 34px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        const sx = Math.min(1, (seg - 24) / Math.max(1, c.measureText(t).width)); c.save(); c.translate(i * seg + seg / 2, h / 2 + 2); c.scale(sx, 1); c.fillText(t, 0, 0); c.restore();
        c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(i * seg, h - 4, seg, 4);
      });
    }, { repeat: [3, 1], aniso });
    const boardM = new THREE.MeshBasicMaterial({ map: boardTex, fog: true });
    for (const sd of [-1, 1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(170, 1.5), boardM); b.position.copy(P3(sd * 34.35, 50, 0.8)); b.rotation.y = -sd * Math.PI / 2; stadium.add(b); }
    for (const yy of [125.6, -25.6]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(110, 1.5), boardM); b.position.copy(P3(0, yy, 0.8)); if (yy < 0) b.rotation.y = Math.PI; stadium.add(b); }
    // both teams on their sidelines: simple figures, many of them, drawn in one go
    const benchFig = new THREE.CapsuleGeometry(0.2, 1.1, 3, 6);
    for (const [sd, team] of [[-1, cfg.home], [1, cfg.away]]) {
      const inst = new THREE.InstancedMesh(benchFig, new THREE.MeshLambertMaterial({ color: col(team.color) }), 36);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 36; i++) { m.makeTranslation(sd * (30 + rnd(i * 7 + sd) * 2.2), 0.85, -(32 + i * 1.0 + rnd(i * 3) * 0.6)); inst.setMatrixAt(i, m); }
      inst.castShadow = !lite; stadium.add(inst);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 40), new THREE.MeshLambertMaterial({ color: 0x3b4048 })); bench.position.copy(P3(sd * 32.6, 50, 0.25)); stadium.add(bench);
    }
    // the scoreboard over the far end
    const board = new THREE.Mesh(new THREE.BoxGeometry(34, 12, 1.5), new THREE.MeshBasicMaterial({ map: canvasTex(512, 180, (c, w, h) => {
      c.fillStyle = '#05070c'; c.fillRect(0, 0, w, h); c.fillStyle = shade(home, 0).getStyle(); c.fillRect(0, 0, w, 34);
      c.fillStyle = '#fff'; c.font = `italic 900 26px ${font}`; c.textAlign = 'center'; c.fillText(String(cfg.home.name || '').toUpperCase(), w / 2, 27);
      c.font = `900 70px ${font}`; c.fillStyle = '#ffcf3a'; c.fillText(`${cfg.score?.away ?? 0}   ${cfg.score?.home ?? 0}`, w / 2, 120);
      c.font = `800 22px ${font}`; c.fillStyle = '#9fd3ff'; c.fillText(`${cfg.away.abbr || ''}            ${cfg.home.abbr || ''}`, w / 2, 160);
    }), fog: false }));
    board.position.copy(P3(0, 158, 36)); stadium.add(board);
    const post = new THREE.Mesh(new THREE.BoxGeometry(2, 30, 2), concrete); post.position.copy(P3(0, 159, 15)); stadium.add(post);
    // light towers
    lightsGroup.clear();
    for (const [x, y] of [[-66, 132], [66, 132], [-66, -32], [66, -32]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 52, 8), concrete); pole.position.copy(P3(x, y, 26)); stadium.add(pole);
      const bank = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 1), new THREE.MeshBasicMaterial({ color: cfg.night || cfg.dome ? 0xfff6dc : 0x9aa3ad, fog: false }));
      bank.position.copy(P3(x * 0.98, y * 0.98, 53)); bank.lookAt(P3(0, 50, 0)); stadium.add(bank);
      if (cfg.night && !cfg.dome) {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2d0, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
        glow.scale.set(40, 26, 1); glow.position.copy(bank.position); lightsGroup.add(glow);
      }
    }
    // a roof for domes
    if (cfg.dome) {
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(200, 260), new THREE.MeshLambertMaterial({ map: canvasTex(512, 512, (c, w) => { c.fillStyle = '#c9cfd6'; c.fillRect(0, 0, w, w); c.strokeStyle = '#8e969f'; c.lineWidth = 6; for (let i = 0; i <= w; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, w); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); } }, { repeat: [6, 8] }), side: THREE.DoubleSide, emissive: 0x30343a }));
      roof.rotation.x = Math.PI / 2; roof.position.copy(P3(0, 50, 62)); stadium.add(roof);
    }
  }
  const glowTex = canvasTex(128, 128, (x, w) => { const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,240,210,0.5)'); g.addColorStop(1, 'rgba(255,240,210,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); });
  const lightsGroup = new THREE.Group(); scene.add(lightsGroup);

  // ----- goalposts at both end lines, with ribbons that blow in the wind -----
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2c92a, roughness: 0.35, metalness: 0.3 });
  const ribbons = [];
  function goalpost(y, dir) {
    const g = new THREE.Group();
    const cyl = (r, h) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), gold);
    // the post stands 2 yards behind the end line and curves forward so the crossbar sits right over it
    const bz = -dir * 2;
    const base = cyl(0.12, 3.0); base.position.set(0, 1.5, bz); g.add(base);
    const neck = cyl(0.1, 2.0); neck.rotation.x = Math.PI / 2; neck.position.set(0, 3.0, bz / 2); g.add(neck);
    const bar = cyl(0.07, HASH * 2); bar.rotation.z = Math.PI / 2; bar.position.set(0, 3.33, 0); g.add(bar);
    for (const sx of [-1, 1]) { const u = cyl(0.055, 10); u.position.set(sx * HASH, 3.33 + 5, 0); g.add(u);
      const rb = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshLambertMaterial({ color: 0xf06a1c, side: THREE.DoubleSide }));
      rb.geometry.translate(0.45, 0, 0); rb.position.set(sx * HASH, 13.2, 0); g.add(rb); ribbons.push(rb); }
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.2, 12), padMat); pad.position.set(0, 1.1, bz); g.add(pad);
    g.traverse(o => { o.castShadow = true; });
    g.position.copy(P3(0, y, 0));
    return g;
  }
  const padMat = new THREE.MeshLambertMaterial({ color: 0x223355 });
  scene.add(goalpost(110, 1)); scene.add(goalpost(-10, -1));

  // ----- weather: snow, rain, fog, and breath -----
  const N_SNOW = lite ? 900 : 2600, N_RAIN = lite ? 700 : 1800;
  const flakeTex = canvasTex(64, 64, (x, w) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); });
  const snowGeo = new THREE.BufferGeometry(), snowPos = new Float32Array(N_SNOW * 3), snowSeed = new Float32Array(N_SNOW);
  for (let i = 0; i < N_SNOW; i++) { snowPos[i * 3] = (rnd(i) - 0.5) * 80; snowPos[i * 3 + 1] = rnd(i * 2) * 30; snowPos[i * 3 + 2] = -rnd(i * 3) * 80; snowSeed[i] = rnd(i * 5); }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({ map: flakeTex, size: 0.32, transparent: true, depthWrite: false, opacity: 0.95, color: 0xffffff }));
  snowPts.frustumCulled = false; scene.add(snowPts);
  const rainGeo = new THREE.BufferGeometry(), rainPos = new Float32Array(N_RAIN * 6);
  for (let i = 0; i < N_RAIN; i++) { rainPos[i * 6] = (rnd(i + 9) - 0.5) * 70; rainPos[i * 6 + 1] = rnd(i * 2 + 9) * 30; rainPos[i * 6 + 2] = -rnd(i * 3 + 9) * 70; }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc9dbef, transparent: true, opacity: 0.55, depthWrite: false }));
  rain.frustumCulled = false; scene.add(rain);
  const puffs = [];
  const puffMat = new THREE.SpriteMaterial({ map: flakeTex, color: 0xf2f6fa, transparent: true, depthWrite: false, opacity: 0.4 });

  // ----- players -----
  const pool = new Map();
  const skin = ['#8d5524', '#c68642', '#e0ac69', '#5a3a22', '#f1c27d', '#3b2414'];
  const numTex = new Map();
  // jersey numbers and the name across the back, in the uniform's trim color
  function numberTexture(num, fill, edge) {
    const k = num + fill + edge;
    if (!numTex.has(k)) numTex.set(k, canvasTex(128, 112, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.font = `900 96px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineJoin = 'round'; c.lineWidth = 12; c.strokeStyle = edge; c.strokeText(num, w / 2, h / 2 + 4); c.fillStyle = fill; c.fillText(num, w / 2, h / 2 + 4);
    }));
    return numTex.get(k);
  }
  function nameTexture(name, fill) {
    const k = 'n:' + name + fill;
    if (!numTex.has(k)) numTex.set(k, canvasTex(256, 48, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.font = `800 34px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const t = String(name).toUpperCase(), sx = Math.min(1, 236 / Math.max(1, c.measureText(t).width));
      c.save(); c.translate(w / 2, h / 2 + 2); c.scale(sx, 1); c.fillStyle = fill; c.fillText(t, 0, 0); c.restore();
    }));
    return numTex.get(k);
  }
  const decals = new Map();
  function decalTexture(url) {
    if (!url) return null;
    if (!decals.has(url)) { const t = new THREE.TextureLoader().setCrossOrigin('anonymous').load(url); t.colorSpace = THREE.SRGBColorSpace; decals.set(url, t); }
    return decals.get(url);
  }
  const refStripes = canvasTex(64, 64, (c, w) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#111' : '#f4f4f2'; c.fillRect(i * 8, 0, 8, w); } });
  function makePlayer(o) {
    const ref = !!o.ref;
    const body = ref ? '#f4f4f2' : o.color, trim = ref ? '#111' : o.trim || '#ffffff';
    const jersey = new THREE.MeshStandardMaterial({ color: ref ? 0xffffff : col(body), map: ref ? refStripes : null, roughness: 0.72 });
    const trimM = new THREE.MeshStandardMaterial({ color: col(trim), roughness: 0.6 });
    const pantsM = new THREE.MeshStandardMaterial({ color: col(ref ? '#f2f2f0' : o.pants || '#e9e6da'), roughness: 0.65 });
    const sockM = new THREE.MeshStandardMaterial({ color: col(ref ? '#111' : o.sock || body), roughness: 0.8 });
    const helmM = new THREE.MeshStandardMaterial({ color: col(ref ? '#111' : o.helmet || body), roughness: 0.2, metalness: 0.4 });
    const skinM = new THREE.MeshStandardMaterial({ color: col(skin[hashStr(o.id) % skin.length]), roughness: 0.6 });
    const shoe = new THREE.MeshStandardMaterial({ color: ref ? 0x111111 : 0xf2f2f2, roughness: 0.45 });
    const glove = new THREE.MeshStandardMaterial({ color: ref ? col(skin[hashStr(o.id) % skin.length]) : col(trim === '#ffffff' ? '#f0f0f0' : trim), roughness: 0.55 });
    const mask = new THREE.MeshStandardMaterial({ color: 0xbfc4ca, roughness: 0.35, metalness: 0.6 });
    const cap = (r, l, m) => { const x = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 12), m); x.castShadow = true; return x; };
    const ring = (r, m) => { const x = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 16), m); x.rotation.x = Math.PI / 2; return x; };
    const root = new THREE.Group(), hips = new THREE.Group(), chest = new THREE.Group(), head = new THREE.Group();
    root.add(hips); hips.add(chest); chest.add(head);
    hips.position.y = 1.0;
    const pelvis = cap(0.16, 0.12, pantsM); pelvis.rotation.z = Math.PI / 2; pelvis.scale.set(1, 1.3, 0.95); hips.add(pelvis);
    // a stripe down the side of the pants
    if (!ref) for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.36, 0.06), trimM); st.position.set(sx * 0.2, -0.14, 0); hips.add(st); }
    const torso = cap(0.19, 0.28, jersey); torso.position.y = 0.32; torso.scale.set(1.5, 1, 0.85); chest.add(torso);
    // shoulder pads under the jersey: wide and squared off
    const pads = new THREE.Mesh(new THREE.SphereGeometry(0.21, 18, 10), jersey); pads.scale.set(1.9, 0.6, 1.15); pads.position.y = 0.57; pads.castShadow = true; chest.add(pads);
    if (!ref) {
      const N = numberTexture(o.num || '', trim, body === '#ffffff' || body === '#f4f4f2' ? shade(o.trim || '#335', -0.3).getStyle() : shade(body, -0.45).getStyle());
      for (const z of [-1, 1]) { const n = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.28), new THREE.MeshBasicMaterial({ map: N, transparent: true, depthWrite: false })); n.position.set(0, 0.33, z * 0.168); if (z < 0) n.rotation.y = Math.PI; chest.add(n); }
      // the small numbers on top of the shoulders
      for (const sx of [-1, 1]) { const n = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.1), new THREE.MeshBasicMaterial({ map: N, transparent: true, depthWrite: false })); n.position.set(sx * 0.3, 0.66, 0); n.rotation.x = -Math.PI / 2; n.rotation.z = Math.PI; chest.add(n); }
      if (o.name) { const nm = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.065), new THREE.MeshBasicMaterial({ map: nameTexture(o.name, trim), transparent: true, depthWrite: false })); nm.position.set(0, 0.53, -0.21); nm.rotation.y = Math.PI; chest.add(nm); }
    }
    head.position.y = 0.82;
    if (ref) {
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.08, 14), helmM); hat.position.y = 0.06; head.add(hat);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.01, 14, 1, false, 0, Math.PI), helmM); brim.position.set(0, 0.02, 0.06); head.add(brim);
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skinM); face.position.y = -0.02; head.add(face);
    } else {
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 22, 16), helmM); helmet.scale.set(1, 1.02, 1.14); helmet.castShadow = true; head.add(helmet);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.32), trimM); stripe.position.set(0, 0.145, -0.01); head.add(stripe);
      // team logo on both sides of the helmet
      const dec = decalTexture(o.logo);
      if (dec) for (const sx of [-1, 1]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), new THREE.MeshBasicMaterial({ map: dec, transparent: true, depthWrite: false })); d.position.set(sx * 0.152, 0.02, -0.01); d.rotation.y = sx * Math.PI / 2; head.add(d); }
      // facemask: two bars across and a cage down the middle
      for (const [y, w] of [[-0.02, 0.22], [-0.08, 0.18]]) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, w, 6), mask); bar.rotation.z = Math.PI / 2; bar.position.set(0, y, 0.17); head.add(bar); }
      for (const sx of [-0.05, 0.05]) { const v = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.11, 6), mask); v.position.set(sx, -0.05, 0.172); head.add(v); }
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), skinM); face.position.set(0, -0.03, 0.06); face.scale.set(0.9, 1, 0.8); head.add(face);
    }
    const limb = (parent, x, y, r1, l1, m1, r2, l2, m2, endM, isLeg) => {
      const j1 = new THREE.Group(); j1.position.set(x, y, 0); parent.add(j1);
      const a = cap(r1, l1, m1); a.position.y = -(l1 / 2 + r1 * 0.6); j1.add(a);
      // sleeve stripes on the arms
      if (!isLeg && !ref) for (const yy of [-0.13, -0.17]) { const st = ring(r1 * 1.02, trimM); st.position.y = yy; j1.add(st); }
      const j2 = new THREE.Group(); j2.position.y = -(l1 + r1 * 1.1); j1.add(j2);
      const b = cap(r2, l2, m2); b.position.y = -(l2 / 2 + r2 * 0.6); j2.add(b);
      if (isLeg && !ref) { const st = ring(r2 * 1.04, trimM); st.position.y = -0.1; j2.add(st); }
      const end = isLeg ? new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.26), endM) : new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), endM);
      end.position.set(0, -(l2 + r2 * 1.3), isLeg ? 0.05 : 0); end.castShadow = true; j2.add(end);
      return { j1, j2 };
    };
    const armL = limb(chest, -0.38, 0.56, 0.075, 0.2, jersey, 0.06, 0.2, skinM, glove), armR = limb(chest, 0.38, 0.56, 0.075, 0.2, jersey, 0.06, 0.2, skinM, glove);
    const legL = limb(hips, -0.12, -0.04, 0.095, 0.3, pantsM, 0.072, 0.32, sockM, shoe, true), legR = limb(hips, 0.12, -0.04, 0.095, 0.3, pantsM, 0.072, 0.32, sockM, shoe, true);
    const snowCap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, 6.283, 0, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })); snowCap.position.y = 0.13; snowCap.scale.set(1.2, 0.35, 1.2); head.add(snowCap);
    root.userData = { hips, chest, head, armL, armR, legL, legR, snowCap, jersey, color: o.color + (o.trim || '') + (o.name || '') + (ref ? 'ref' : '') };
    scene.add(root);
    return root;
  }
  // poses: joint angles in radians (x = forward swing)
  function pose(p, o, t) {
    const u = p.userData, ph = o.phase || 0, kind = o.pose || 'stand';
    const set = (j, x, z = 0) => { j.rotation.x = x; j.rotation.z = z; };
    let hipY = 1.0, lean = 0.06, armLx = 0.1, armRx = 0.1, armLz = 0.18, armRz = -0.18, elL = -0.3, elR = -0.3;
    let lHip = 0, rHip = 0, lKnee = 0.12, rKnee = 0.12, headX = 0;
    if (kind === 'run' || kind === 'back') {
      const s = Math.sin(ph), c2 = Math.cos(ph), dir = kind === 'back' ? -0.6 : 1;
      lHip = s * 0.85 * dir; rHip = -s * 0.85 * dir; lKnee = 0.25 + Math.max(0, -s) * 1.3; rKnee = 0.25 + Math.max(0, s) * 1.3;
      armLx = -s * 0.9; armRx = s * 0.9; elL = elR = -1.2; lean = kind === 'back' ? -0.05 : 0.28; hipY = 0.97 + Math.abs(c2) * 0.05;
    } else if (kind === 'stance3') {
      hipY = 0.72; lean = 1.15; lHip = 1.25; rHip = 0.95; lKnee = 1.5; rKnee = 1.1; armRx = -1.6; elR = 0; armLx = -0.6; elL = -0.9; headX = -0.9;
    } else if (kind === 'crouch') {
      hipY = 0.84; lean = 0.55; lHip = 0.8; rHip = 0.8; lKnee = 1.05; rKnee = 1.05; armLx = -0.5; armRx = -0.5; elL = elR = -0.9; headX = -0.4;
    } else if (kind === 'block') {
      hipY = 0.9; lean = 0.35; lHip = 0.5 + Math.sin(ph) * 0.15; rHip = 0.3 - Math.sin(ph) * 0.15; lKnee = 0.7; rKnee = 0.8; armLx = armRx = -1.35; elL = elR = -0.35; armLz = 0.1; armRz = -0.1;
    } else if (kind === 'rush') {
      hipY = 0.9; lean = 0.45; lHip = 0.6 + Math.sin(ph) * 0.4; rHip = 0.4 - Math.sin(ph) * 0.4; lKnee = 0.9; rKnee = 0.9; armLx = -1.2 + Math.sin(ph * 2) * 0.3; armRx = -1.3; elL = elR = -0.4;
    } else if (kind === 'jump') {
      hipY = 1.0 + Math.max(0, Math.sin(ph)) * 0.35; lean = 0; armLx = armRx = -2.9; elL = elR = -0.1; armLz = 0.25; armRz = -0.25; lKnee = rKnee = 0.4;
    } else if (kind === 'kneel') {
      hipY = 0.55; lean = 0.25; lHip = 1.4; lKnee = 1.45; rHip = 0.05; rKnee = 1.55; armLx = -1.1; armRx = -1.3; elL = -0.4; elR = -0.6; headX = 0.25;
    } else if (kind === 'kick') {
      // k from 0 (address) to 1 (follow through)
      const k = Math.max(0, Math.min(1, ph));
      if (k < 0.55) { const s = Math.sin(k / 0.55 * Math.PI * 3); lHip = s * 0.6; rHip = -s * 0.6; lKnee = 0.3 + Math.max(0, -s) * 0.8; rKnee = 0.3 + Math.max(0, s) * 0.8; armLx = -s * 0.5; armRx = s * 0.5; lean = 0.2; }
      else if (k < 0.72) { const q = (k - 0.55) / 0.17; lHip = 0.1; lKnee = 0.35; rHip = -1.1 * (1 - q) + 0.2 * q; rKnee = 1.6 * (1 - q) + 0.6 * q; armLz = 0.9; armRz = -0.9; lean = 0.05 - q * 0.15; }
      else { const q = Math.min(1, (k - 0.72) / 0.2); lHip = 0.1; lKnee = 0.2; rHip = 0.2 + q * 1.5; rKnee = 0.6 - q * 0.55; armLz = 1.0; armRz = -0.7; armLx = -0.5; lean = -0.2; hipY = 1.0 + q * 0.08; }
    } else if (kind === 'throw') {
      const k = Math.max(0, Math.min(1, ph));
      armRx = k < 0.5 ? -2.6 * (k / 0.5) : -2.6 + (k - 0.5) / 0.5 * 2.9; elR = k < 0.5 ? -1.6 : -1.6 + (k - 0.5) * 3; armLx = -1.0; elL = -0.8; lean = k > 0.5 ? 0.25 : -0.05; lHip = 0.35; rHip = -0.25; lKnee = 0.3; rKnee = 0.35;
    } else if (kind === 'set') {
      hipY = 0.95; armLx = -0.9; armRx = -0.9; elL = elR = -1.2; lKnee = rKnee = 0.3; lHip = rHip = 0.2;
    }
    u.hips.position.y = hipY;
    u.chest.rotation.x = lean;
    u.head.rotation.x = headX;
    set(u.armL.j1, armLx, armLz); set(u.armR.j1, armRx, armRz); u.armL.j2.rotation.x = elL; u.armR.j2.rotation.x = elR;
    set(u.legL.j1, -lHip); set(u.legR.j1, -rHip); u.legL.j2.rotation.x = lKnee; u.legR.j2.rotation.x = rKnee;
    u.snowCap.visible = !!o.snow;
  }

  // ----- the ball -----
  const ballTex = canvasTex(256, 128, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#9a5428'); g.addColorStop(0.5, '#7a3d1b'); g.addColorStop(1, '#5c2c12'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = '#f4f1ea'; c.fillRect(w * 0.12, h * 0.46, w * 0.04, h * 0.08); c.fillRect(w * 0.84, h * 0.46, w * 0.04, h * 0.08); c.fillRect(w * 0.4, h * 0.47, w * 0.2, h * 0.06); for (let i = 0; i < 7; i++) c.fillRect(w * (0.41 + i * 0.03), h * 0.42, w * 0.012, h * 0.16); });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.55 }));
  ball.scale.set(1.5, 0.95, 0.95); ball.castShadow = true; scene.add(ball);
  const trailGeo = new THREE.BufferGeometry(); const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, fog: false }));
  scene.add(trail);

  // ----- configure for a game and its weather -----
  let cfg = null, snowRate = 0, rainRate = 0, windX = 0, windY = 0;
  function configure(c) {
    cfg = c;
    const night = c.night || c.dome;
    if (c.dome) paintSky('#3a3f46', '#555b63');
    else if (night) paintSky('#02040a', '#18223a');
    else if (c.cloud > 0.55 || c.snow > 0.1 || c.rain > 0.2) paintSky('#6d7884', '#b9c2cb');
    else paintSky('#2565b8', '#b8dcf6');
    // the sun where it really is, relative to the way the offense is facing
    const el = Math.max(-5, c.sun?.el ?? 30) * Math.PI / 180, az = (c.sun?.rel ?? 30) * Math.PI / 180;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    sunDisc.visible = !night && el > 0 && c.cloud < 0.85;
    sunDisc.position.copy(dir.clone().multiplyScalar(600));
    sunDisc.material.opacity = 1 - (c.cloud || 0) * 0.8;
    if (night) {
      sun.position.set(0, 80, 0); sun.intensity = c.dome ? 1.6 : 1.4; sun.color.set(0xfff3dc);
      hemi.intensity = c.dome ? 1.1 : 0.55; hemi.color.set(0xb8c4d8); hemi.groundColor.set(0x1d2a1d);
    } else {
      const light = el > 0 ? 1 - (c.cloud || 0) * 0.6 : 0.25;
      sun.position.copy(dir.clone().multiplyScalar(120)); sun.intensity = 3.0 * light; sun.color.set(el < 0.25 ? 0xffd2a0 : 0xfff4e0);
      hemi.intensity = 1.0 + (c.cloud || 0) * 0.5; hemi.color.set(c.cloud > 0.55 ? 0xd2dae2 : 0xcfe3ff); hemi.groundColor.set(0x3a4a2a);
    }
    sun.castShadow = !lite && (night || el > 0.05) && (c.cloud || 0) < 0.92;
    // fog = how far you can see
    const vis = Math.max(40, Math.min(2000, c.vis || 2000));
    const fogCol = c.snow > 0.1 ? 0xdfe6ec : c.fog > 0.3 ? 0xcfd5da : night ? 0x1a212c : c.rain > 0.2 ? 0x8f99a3 : 0xb9cfe3;
    scene.fog = vis < 1800 ? new THREE.Fog(fogCol, vis * 0.08, vis * 1.05) : new THREE.Fog(fogCol, 260, 1300);
    renderer.setClearColor(fogCol);
    snowRate = c.snow || 0; rainRate = c.rain || 0;
    windX = c.wind?.cross || 0; windY = c.wind?.tail || 0;
    snowMat.opacity = Math.min(0.9, c.snowCover || 0);
    fieldMat.roughness = c.wet > 0.25 ? 0.42 : 0.92;
    losLine.visible = fdLine.visible = false;
    buildStadium(c);
    paintField(c, null);
    if (c.logo) { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { if (cfg === c) paintField(c, img); }; img.src = c.logo; }
    if (document.fonts?.ready) document.fonts.ready.then(() => { if (cfg === c) paintField(c, null); });
  }

  // ----- one frame -----
  let lastT = performance.now();
  const seen = new Set();
  function frame(s) {
    const now = s.t || performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (s.wind) { windX = s.wind.cross || 0; windY = s.wind.tail || 0; }
    const W = canvas.clientWidth || 340, H = canvas.clientHeight || 220;
    const pr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.75);
    if (canvas.width !== Math.round(W * pr) || canvas.height !== Math.round(H * pr)) { renderer.setPixelRatio(pr); renderer.setSize(W, H, false); }
    camera.aspect = W / H; camera.fov = s.cam.fov || 50; camera.updateProjectionMatrix();
    camera.position.copy(P3(...s.cam.pos)); camera.lookAt(P3(...s.cam.look));
    // shadows follow the action
    const focus = P3(...s.cam.look);
    sun.target.position.copy(focus);
    if (cfg && (cfg.night || cfg.dome)) sun.position.copy(focus.clone().add(new THREE.Vector3(8, 80, 10)));
    else if (cfg) { const d = sun.position.clone().sub(sun.target.position).normalize(); sun.position.copy(focus.clone().add(d.multiplyScalar(120))); }
    // the TV lines
    if (s.lines?.los != null) { losLine.visible = true; losLine.position.copy(P3(0, s.lines.los, 0.03)); } else losLine.visible = false;
    if (s.lines?.first != null && s.lines.first < 100) { fdLine.visible = true; fdLine.position.copy(P3(0, s.lines.first, 0.03)); } else fdLine.visible = false;
    setArt(s.routes, s.aim, s.preview);
    // players
    seen.clear();
    for (const o of s.players || []) {
      let p = pool.get(o.id);
      const look = o.color + (o.trim || '') + (o.name || '') + (o.ref ? 'ref' : '');
      if (!p || p.userData.color !== look) { if (p) { scene.remove(p); } p = makePlayer(o); pool.set(o.id, p); }
      p.visible = true; seen.add(o.id);
      p.position.copy(P3(o.x, o.y, 0));
      p.rotation.y = Math.PI - (o.face || 0) * Math.PI / 180;
      pose(p, o, now);
      // breath in the cold
      if (o.breath && !lite && Math.random() < dt * 0.9) {
        const sp = new THREE.Sprite(puffMat.clone()); const f = new THREE.Vector3(0, 1.75, 0.3).applyEuler(p.rotation); sp.position.copy(p.position).add(f); sp.scale.set(0.25, 0.25, 1); sp.userData = { born: now }; scene.add(sp); puffs.push(sp);
      }
    }
    for (const [id, p] of pool) if (!seen.has(id)) p.visible = false;
    for (let i = puffs.length - 1; i >= 0; i--) { const sp = puffs[i], a = (now - sp.userData.born) / 1400; if (a >= 1) { scene.remove(sp); sp.material.dispose(); puffs.splice(i, 1); continue; } sp.material.opacity = 0.45 * (1 - a); sp.scale.setScalar(0.25 + a * 0.7); sp.position.y += dt * 0.15; sp.position.x += windX * dt * 0.03; }
    // the ball and its trail
    if (s.ball) { ball.visible = true; ball.position.copy(P3(s.ball.x, s.ball.y, s.ball.z)); ball.rotation.set(s.ball.spin ? now / 120 : 0, s.ball.yaw || 0, s.ball.spin ? now / 40 : 0); }
    else ball.visible = false;
    if (s.trail?.length > 1) { trailGeo.setFromPoints(s.trail.map(p => P3(p[0], p[1], p[2]))); trail.visible = true; } else trail.visible = false;
    // goalpost ribbons
    const wmag = Math.hypot(windX, windY), flap = Math.sin(now / 80) * 0.25;
    for (const rb of ribbons) { rb.rotation.y = Math.atan2(windY, windX) + flap * Math.min(1, wmag / 10); rb.rotation.z = -1.2 + Math.min(1.15, wmag / 18) + flap * 0.2; }
    // falling weather around the camera
    const cx = camera.position.x, cz = camera.position.z;
    if (snowRate > 0.02) {
      snowPts.visible = true; snowPts.material.size = 0.22 + snowRate * 0.18;
      const n = Math.floor(N_SNOW * Math.min(1, 0.25 + snowRate)); snowGeo.setDrawRange(0, n);
      for (let i = 0; i < n; i++) {
        const k = i * 3, sd = snowSeed[i];
        snowPos[k] += (windX * 0.05 + Math.sin(now / 900 + sd * 30) * 0.4) * dt * 2; snowPos[k + 1] -= (1.1 + sd * 0.8) * dt * 2; snowPos[k + 2] -= windY * 0.05 * dt * 2;
        if (snowPos[k + 1] < 0) { snowPos[k + 1] = 28; snowPos[k] = cx + (rnd(i + now) - 0.5) * 80; snowPos[k + 2] = cz - rnd(i * 3 + now) * 85 + 5; }
        if (snowPos[k] - cx > 40) snowPos[k] -= 80; if (snowPos[k] - cx < -40) snowPos[k] += 80;
        if (snowPos[k + 2] - cz > 6) snowPos[k + 2] -= 85; if (snowPos[k + 2] - cz < -80) snowPos[k + 2] += 85;
      }
      snowGeo.attributes.position.needsUpdate = true;
    } else snowPts.visible = false;
    if (rainRate > 0.05) {
      rain.visible = true;
      const n = Math.floor(N_RAIN * Math.min(1, 0.2 + rainRate)); rainGeo.setDrawRange(0, n * 2);
      const vx = windX * 0.25, vz = -windY * 0.25, vy = -22;
      for (let i = 0; i < n; i++) {
        const k = i * 6;
        rainPos[k] += vx * dt; rainPos[k + 1] += vy * dt; rainPos[k + 2] += vz * dt;
        if (rainPos[k + 1] < 0) { rainPos[k + 1] = 26 + rnd(i + now) * 4; rainPos[k] = cx + (rnd(i * 2 + now) - 0.5) * 70; rainPos[k + 2] = cz - rnd(i * 3 + now) * 70 + 4; }
        rainPos[k + 3] = rainPos[k] - vx * 0.035; rainPos[k + 4] = rainPos[k + 1] - vy * 0.035; rainPos[k + 5] = rainPos[k + 2] - vz * 0.035;
      }
      rainGeo.attributes.position.needsUpdate = true;
    } else rain.visible = false;
    // a lightning flash
    if (s.flash) { hemi.intensity = 3.5; } else if (cfg) hemi.intensity += ((cfg.night ? (cfg.dome ? 1.1 : 0.55) : 1.0 + (cfg.cloud || 0) * 0.5) - hemi.intensity) * 0.2;
    renderer.render(scene, camera);
  }
  // screen position (CSS px) of a field point, for the on-screen graphics
  const tmp = new THREE.Vector3();
  function project(x, y, z = 0) {
    tmp.copy(P3(x, y, z)).project(camera);
    if (tmp.z > 1) return null;
    return [(tmp.x + 1) / 2 * (canvas.clientWidth || 340), (1 - tmp.y) / 2 * (canvas.clientHeight || 220)];
  }
  function dispose() { renderer.dispose(); scene.traverse(o => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach(m => { m.map?.dispose(); m.dispose(); }); }); }
  return { configure, frame, project, dispose, ok: true };
}
