(() => {
  const API = ((self.SNOW_RADAR && self.SNOW_RADAR.workerUrl) || '').replace(/\/$/, '');
  const DEMO = !API || API.includes('YOUR-SUBDOMAIN');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLD = 35; // °F: at or below, precipitation could fall as snow

  const $ = sel => document.querySelector(sel);
  const state = { data: null, filter: 'weather', open: new Set(), installPrompt: null };

  // ---------- Formatting ----------
  const fmtTime = d => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtHour = d => new Date(d).toLocaleTimeString([], { hour: 'numeric' });
  const fmtDay = d => new Date(d).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const fmtWhen = d => new Date(d).toLocaleDateString([], { weekday: 'long' }) + ' at ' + fmtTime(d);
  const inches = n => (n >= 0.05 ? n.toFixed(1) : '0') + '″';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const flakeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#flake"/></svg>';
  const ballIcon = '<svg class="meter-ball" viewBox="0 0 64 36" aria-hidden="true"><use href="#football"/></svg>';
  const analyzed = g => g.roof !== 'dome';

  function condition(code, snow) {
    if ([71, 73, 75, 77, 85, 86].includes(code) || snow > 0) return { text: 'Snow', snow: true };
    if ([66, 67, 56, 57].includes(code)) return { text: 'Ice', snow: true };
    if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82)) return { text: 'Rain' };
    if (code >= 95) return { text: 'Storms' };
    if (code === 45 || code === 48) return { text: 'Fog' };
    if (code === 3) return { text: 'Cloudy' };
    if (code === 1 || code === 2) return { text: 'Some sun' };
    return { text: 'Clear' };
  }

  // Team logos come straight from ESPN; if one fails to load, show the team's colors instead.
  const logoUrl = team => team?.logo || (team?.abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.abbr.toLowerCase()}.png` : '');
  function logo(team) {
    const fallback = `<span class="logo" style="background:${esc(team?.color || '#2B4566')}">${esc(team?.abbr || '')}</span>`;
    const url = logoUrl(team);
    if (!url) return fallback;
    return `<img class="logo" src="${esc(url)}" alt="${esc(team.name || team.abbr)}" loading="lazy" data-fallback="${esc(fallback)}">`;
  }
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.fallback) img.outerHTML = img.dataset.fallback;
  }, true);

  // 0–100 position on the snow meter
  function snowScore(g) {
    const w = g.wx;
    if (!w) return 0;
    if (g.level === 2) return Math.min(96, 78 + Math.round(w.snowIn * 8));
    if (g.level === 1) return Math.min(72, 40 + Math.round(w.coldPrecipChance * 0.3));
    const cold = Math.max(0, Math.min(1, (50 - w.lowF) / 15));
    return Math.max(4, Math.round(cold * 20 + cold * w.precipChance * 0.15));
  }

  // ---------- Data ----------
  async function load(fresh) {
    $('#refresh').classList.add('spinning');
    try {
      state.data = DEMO ? demoData() : await (await fetch(API + '/games' + (fresh ? '?fresh=1' : ''), { cache: 'no-store' })).json();
      if (!state.data || !Array.isArray(state.data.games)) throw new Error(state.data && state.data.error || 'Bad response');
      render();
      const m = location.hash.match(/^#game-(.+)$/);
      if (m && !GameView.isOpen()) GameView.open(m[1], true);
    } catch (err) {
      $('#hero-body').innerHTML = '<p class="hero-quiet">No forecast to show right now.</p>';
      $('#list').innerHTML = `<div class="error">Couldn't reach the forecast service. Check your connection, then try again.<br><button id="retry">Try again</button></div>`;
      $('#retry').onclick = () => load(true);
      Snow.set(0, 0);
    } finally {
      $('#refresh').classList.remove('spinning');
    }
  }

  // ---------- Rendering ----------
  function render() {
    const games = state.data.games;
    renderHero(games);

    const shown = state.filter === 'weather' ? games.filter(analyzed) : games;
    if (!shown.length) {
      $('#list').innerHTML = `<p class="empty">No games in the next ${state.data.daysAhead || 7} days.</p>`;
    } else {
      const days = new Map();
      for (const g of shown) {
        const key = new Date(g.kickoff).toDateString();
        if (!days.has(key)) days.set(key, []);
        days.get(key).push(g);
      }
      $('#list').innerHTML = [...days.values()].map(list => `
        <div class="day">
          <h3 class="day-head">${esc(fmtDay(list[0].kickoff))}</h3>
          <div class="day-games">${list.map(gameRow).join('')}</div>
        </div>`).join('');
    }

    const updated = new Date(state.data.updated);
    $('#footnote').textContent = (DEMO ? 'Sample data shown. Add your backend URL in config.js to see real games. ' : '')
      + `Forecast updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. `
      + 'Schedule and logos from ESPN, weather from Open-Meteo. Forecasts beyond 5 days are rough.';
  }

  function meter(g) {
    const score = snowScore(g);
    const cls = g.level === 2 ? 'likely' : '';
    return `<div class="meter" role="img" aria-label="Snow risk ${score} out of 100">
      <div class="meter-track">
        <div class="meter-fill ${cls}" style="width:${score}%"></div>
        <div class="meter-endzone">SNOW</div>
        <span style="position:absolute;left:${Math.max(6, Math.min(score, 76))}%;top:0;bottom:0">${ballIcon}</span>
      </div>
      <div class="meter-scale"><span>Dry</span><span>Flurries</span><span>Snow game</span></div>
    </div>`;
  }

  function renderHero(games) {
    const hero = document.querySelector('.hero');
    const threats = games.filter(g => analyzed(g) && g.level > 0 && !g.live)
      .sort((a, b) => b.level - a.level || b.wx.snowIn - a.wx.snowIn || new Date(a.kickoff) - new Date(b.kickoff));
    const g = threats[0];

    if (!g) {
      const coldest = games.filter(x => analyzed(x) && x.wx).sort((a, b) => a.wx.lowF - b.wx.lowF)[0];
      hero.classList.add('calm');
      $('#hero-body').innerHTML = `
        <p class="hero-kicker">${flakeIcon} No snow in the forecast</p>
        <h2 class="hero-title">All clear for the next ${state.data.daysAhead || 7} days</h2>
        ${coldest ? `<p class="hero-when">Coldest game: ${esc(coldest.away.name)} at ${esc(coldest.home.name)}, ${esc(fmtWhen(coldest.kickoff))}, low of ${coldest.wx.lowF}°.</p>${meter(coldest)}<button class="open-btn" data-open="${esc(coldest.id)}">See the full forecast</button>` : ''}`;
      Snow.set(0, coldest?.wx?.windMph || 0);
      return;
    }

    hero.classList.remove('calm');
    const cls = g.level === 2 ? 'likely' : 'possible';
    const more = threats.length > 1 ? `<span class="more">+${threats.length - 1} more below</span>` : '';
    const roof = g.roof === 'retractable' ? ' Retractable roof, so it may be closed.' : '';
    $('#hero-body').innerHTML = `
      <p class="hero-kicker ${cls}">${flakeIcon} ${g.level === 2 ? 'Snow game likely' : 'Snow possible'} ${more}</p>
      <div class="matchup">${logo(g.away)}<span class="at">at</span>${logo(g.home)}</div>
      <h2 class="hero-title">${esc(g.away.name)} at ${esc(g.home.name)}</h2>
      <p class="hero-when">${esc(fmtWhen(g.kickoff))}, ${esc(g.venue.name)}.${roof}</p>
      <div class="hero-numbers">
        <div class="big-snow ${cls}">${inches(g.wx.snowIn)}<span class="big-snow-label">snow during the game</span></div>
        <div class="side-stats">
          <div class="stat"><b>${g.wx.lowF}°</b><span>low</span></div>
          <div class="stat"><b>${g.wx.coldPrecipChance || g.wx.precipChance}%</b><span>precip</span></div>
          <div class="stat"><b>${g.wx.windMph ?? '–'}</b><span>mph wind</span></div>
        </div>
      </div>
      ${meter(g)}
      ${hourStrip(g.wx.hours)}
      <button class="open-btn" data-open="${esc(g.id)}">See the full forecast</button>`;
    Snow.set(g.level, g.wx.windMph || 0);
  }

  function hourStrip(hours) {
    if (!hours || !hours.length) return '';
    return `<div class="hours">${hours.map(h => {
      const c = condition(h.c, h.s);
      return `<div class="hour">
        <div class="hour-time">${esc(fmtHour(h.t))}</div>
        <div class="hour-temp">${h.f}°</div>
        <div class="hour-cond ${c.snow ? 'snow' : ''}">${c.snow && h.s > 0 ? inches(h.s) + ' snow' : c.text}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function chip(g) {
    const live = g.live ? '<span class="live">Live</span>' : '';
    if (g.roof === 'dome') return `<span class="chip">${live}Dome</span>`;
    if (!g.wx) return `<span class="chip">${live}Forecast soon</span>`;
    if (g.level === 2) return `<span class="chip likely">${live}${flakeIcon}Snow likely</span>`;
    if (g.level === 1) return `<span class="chip possible">${live}${flakeIcon}Snow possible</span>`;
    const range = g.wx.lowF === g.wx.highF ? `${g.wx.lowF}°` : `${g.wx.lowF}–${g.wx.highF}°`;
    return `<span class="chip temp">${live}${range}</span>`;
  }

  function gameRow(g) {
    const tone = g.level === 2 ? 'likely' : g.level === 1 ? 'possible' : '';
    return `<div class="game-wrap ${tone}">
      <button class="game" data-id="${esc(g.id)}" aria-label="Open forecast for ${esc(g.away.name)} at ${esc(g.home.name)}">
        <div>
          <div class="teams">${logo(g.away)} ${esc(g.away.abbr)} <span class="at">at</span> ${logo(g.home)} ${esc(g.home.abbr)}</div>
          <div class="game-meta"><span>${esc(fmtTime(g.kickoff))}</span><span>${esc(g.venue.city || g.venue.name)}</span>${g.broadcast ? `<span>${esc(g.broadcast)}</span>` : ''}</div>
        </div>
        ${chip(g)}
      </button>
    </div>`;
  }

  // ---------- Full-screen snowfall: heavier and windier when a snow game is coming ----------
  const Snow = (() => {
    const canvas = $('#snow');
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = 1, flakes = [], target = 50, wind = 0.2, raf = null;

    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.width = innerWidth * dpr;
      h = canvas.height = innerHeight * dpr;
    }
    function make(anywhere) {
      const z = Math.random();                 // depth: 0 far, 1 near
      return {
        x: Math.random() * w, y: anywhere ? Math.random() * h : -10 * dpr,
        r: (0.7 + z * z * 2.6) * dpr, vy: (0.35 + z * 1.25) * dpr,
        a: 0.25 + z * 0.6, ph: Math.random() * 6.28, sway: 0.2 + Math.random() * 0.5
      };
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        ctx.globalAlpha = f.a;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function step() {
      if (flakes.length < target) flakes.push(make(false), make(false));
      else if (flakes.length > target + 2) flakes.splice(0, 2);
      for (const f of flakes) {
        f.ph += 0.012;
        f.y += f.vy;
        f.x += wind * f.vy + Math.sin(f.ph) * f.sway * dpr;
        if (f.y > h + 10) { Object.assign(f, make(false)); }
        if (f.x > w + 10) f.x = -10; else if (f.x < -10) f.x = w + 10;
      }
      draw();
      raf = requestAnimationFrame(step);
    }
    function start() {
      resize();
      ctx.fillStyle = '#EEF5FA';
      flakes = Array.from({ length: target }, () => make(true));
      addEventListener('resize', () => { resize(); ctx.fillStyle = '#EEF5FA'; if (REDUCED) draw(); });
      if (REDUCED) draw(); else raf = requestAnimationFrame(step);
    }
    function set(level, windMph) {
      target = [55, 110, 190][level] || 55;
      wind = Math.min(1.6, 0.15 + windMph / 14);
      if (REDUCED) { flakes = Array.from({ length: target }, () => make(true)); draw(); }
    }
    return { start, set };
  })();

  // ---------- Alerts (push notifications) ----------
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  async function currentSub() {
    if (!pushSupported) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function refreshBell() {
    const sub = await currentSub().catch(() => null);
    $('.bell-dot').hidden = !sub;
  }

  async function openSheet(message) {
    const status = $('#sheet-status');
    const actions = $('#sheet-actions');
    actions.innerHTML = '';
    const add = (label, cls, fn) => {
      const b = document.createElement('button');
      b.textContent = label; b.className = cls; b.onclick = fn;
      actions.appendChild(b);
    };

    if (state.installPrompt) add('Install app', 'secondary', installApp);

    if (DEMO) {
      status.textContent = 'Add your backend URL in config.js to turn on alerts.';
    } else if (!pushSupported) {
      status.textContent = "This browser can't receive push alerts. Open the app in Chrome.";
    } else if (Notification.permission === 'denied') {
      status.textContent = 'Notifications are blocked. Allow them in your phone settings for this app, then come back here.';
    } else {
      const sub = await currentSub();
      if (sub) {
        status.textContent = message || 'Alerts are on for this phone.';
        add('Send a test alert', 'primary', sendTest);
        add('Turn off alerts', 'secondary', disableAlerts);
      } else {
        status.textContent = message || 'Get a notification when a game looks snowy.';
        add('Turn on alerts', 'primary', enableAlerts);
      }
    }
    if (!$('#sheet').open) $('#sheet').showModal();
  }

  async function enableAlerts() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return openSheet();
      const { vapidPublicKey } = await (await fetch(API + '/config')).json();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) });
      const res = await fetch(API + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error('subscribe ' + res.status);
      await refreshBell();
      openSheet('Alerts are on. Send a test to make sure they come through.');
    } catch (err) {
      openSheet("Couldn't turn on alerts: " + err.message + '. Check the backend setup and try again.');
    }
  }

  async function sendTest() {
    const sub = await currentSub();
    const res = await fetch(API + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    const body = await res.json().catch(() => ({}));
    openSheet(res.ok && body.ok ? 'Test sent. It should show up in a few seconds.' : "The test didn't go through (" + (body.error || body.status || res.status) + ').');
  }

  async function disableAlerts() {
    const sub = await currentSub();
    if (sub) {
      await fetch(API + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
    await refreshBell();
    openSheet('Alerts are off.');
  }

  async function installApp() {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    openSheet();
  }

  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  // ---------- Sample data (until the backend is connected) ----------
  function demoData() {
    const day = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const T = (abbr, name, color) => ({ abbr, name, color });
    const wx = (start, temps, snow, codes, probs, wind) => {
      const hours = temps.map((f, i) => ({ t: new Date(new Date(start).getTime() + i * 3600000).toISOString(), f, s: snow[i], c: codes[i], p: probs[i] }));
      const cold = hours.filter(x => x.f <= 35).map(x => x.p);
      const timeline = [];
      for (let k = -3; k <= 5; k++) {
        const j = Math.max(0, Math.min(3, k));
        const ramp = k < 0 ? 0.6 + 0.13 * (3 + k) : k > 3 ? 1 - 0.3 * (k - 3) : 1;
        timeline.push({
          t: new Date(new Date(start).getTime() + k * 3600000).toISOString(), inGame: k >= 0 && k <= 3,
          f: temps[j] + (k < 0 ? -k : k > 3 ? -(k - 3) : 0), fl: temps[j] - Math.round(wind / 2.5) + (k < 0 ? -k : 0),
          p: Math.round(probs[j] * ramp), pr: Math.round(snow[j] * ramp * 10) / 100, s: Math.round(snow[j] * ramp * 100) / 100,
          c: codes[j], w: wind - 3 + (k % 3), g: wind + 9 + (k % 4)
        });
      }
      const pre = timeline.filter(x => !x.inGame && new Date(x.t) < new Date(start)).reduce((a, x) => a + x.s, 0);
      return { snowIn: Math.round(snow.reduce((a, b) => a + b, 0) * 10) / 10, lowF: Math.min(...temps), highF: Math.max(...temps),
        feelsLowF: Math.min(...temps) - Math.round(wind / 2.5), coldPrecipChance: cold.length ? Math.max(...cold) : 0,
        precipChance: Math.max(...probs), windMph: wind, gustMph: wind + 12, snowBefore24In: Math.round(pre * 25) / 10,
        snowDepthIn: Math.round(pre * 18) / 10, hours, timeline };
    };
    const g = (id, away, home, kickoff, venue, roof, w, level, broadcast, neutral = false) =>
      ({ id, short: `${away.abbr} @ ${home.abbr}`, kickoff, away, home, venue, roof, wx: w, level, broadcast, neutral, live: false });

    const k1 = day(4, 13), k2 = day(4, 16, 25), k3 = day(4, 13), k4 = day(4, 20, 20), k5 = day(5, 20, 15), k6 = day(4, 16, 5), k7 = day(4, 13), k8 = day(3, 9, 30);
    return {
      updated: new Date().toISOString(), daysAhead: 7,
      games: [
        g('d1', T('NYJ', 'Jets', '#125740'), T('BUF', 'Bills', '#00338D'), k1, { name: 'Highmark Stadium', city: 'Orchard Park, NY' }, 'open',
          wx(k1, [29, 28, 27, 27], [0.3, 0.5, 0.4, 0.2], [73, 75, 73, 71], [80, 85, 80, 70], 18), 2, 'CBS'),
        g('d2', T('CHI', 'Bears', '#0B162A'), T('GB', 'Packers', '#203731'), k2, { name: 'Lambeau Field', city: 'Green Bay, WI' }, 'open',
          wx(k2, [31, 30, 30, 29], [0, 0, 0.1, 0], [3, 3, 71, 3], [30, 40, 45, 35], 11), 1, 'FOX'),
        g('d3', T('MIN', 'Vikings', '#4F2683'), T('DET', 'Lions', '#0076B6'), k3, { name: 'Ford Field', city: 'Detroit, MI' }, 'dome', null, 0, 'FOX'),
        g('d4', T('BAL', 'Ravens', '#241773'), T('PIT', 'Steelers', '#101820'), k4, { name: 'Acrisure Stadium', city: 'Pittsburgh, PA' }, 'open',
          wx(k4, [38, 37, 36, 36], [0, 0, 0, 0], [3, 61, 61, 3], [20, 50, 55, 30], 9), 0, 'NBC'),
        g('d5', T('KC', 'Chiefs', '#E31837'), T('DEN', 'Broncos', '#FB4F14'), k5, { name: 'Empower Field at Mile High', city: 'Denver, CO' }, 'open',
          wx(k5, [41, 39, 37, 36], [0, 0, 0, 0], [1, 1, 2, 2], [5, 5, 10, 10], 7), 0, 'ESPN'),
        g('d6', T('NE', 'Patriots', '#002244'), T('MIA', 'Dolphins', '#008E97'), k6, { name: 'Hard Rock Stadium', city: 'Miami Gardens, FL' }, 'open',
          wx(k6, [79, 80, 80, 78], [0, 0, 0, 0], [1, 2, 2, 1], [10, 10, 15, 10], 12), 0, 'CBS'),
        g('d7', T('HOU', 'Texans', '#03202F'), T('IND', 'Colts', '#002C5F'), k7, { name: 'Lucas Oil Stadium', city: 'Indianapolis, IN' }, 'retractable',
          wx(k7, [34, 33, 33, 32], [0, 0.1, 0.1, 0], [3, 71, 71, 3], [40, 50, 50, 40], 14), 1, 'CBS'),
        g('d8', T('PHI', 'Eagles', '#004C54'), T('JAX', 'Jaguars', '#006778'), k8, { name: 'Tottenham Hotspur Stadium', city: 'London, England' }, 'open',
          wx(k8, [46, 45, 45, 44], [0, 0, 0, 0], [61, 61, 3, 3], [60, 55, 30, 20], 13), 0, 'NFL Network', true)
      ].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    };
  }

  // ---------- Full-screen game view ----------
  const C1 = '#3987E5';   // chart series 1 (blue)  — validated pair for the dark surface
  const C2 = '#C98500';   // chart series 2 (yellow)

  const GameView = (() => {
    const view = $('#game-view');
    const body = $('#gv-body');
    let current = null;

    function open(id, fromHistory) {
      const g = state.data && state.data.games.find(x => String(x.id) === String(id));
      if (!g) return;
      current = g;
      body.innerHTML = renderGame(g);
      view.hidden = false;
      view.scrollTop = 0;
      document.body.classList.add('gv-open');
      if (!fromHistory) history.pushState({ game: g.id }, '', '#game-' + g.id);
      drawCharts(g);
      Intro.play(g);
      $('#gv-back').focus({ preventScroll: true });
    }

    function close(fromHistory) {
      if (view.hidden) return;
      Intro.stop();
      view.hidden = true;
      document.body.classList.remove('gv-open');
      current = null;
      if (!fromHistory && location.hash.startsWith('#game-')) history.back();
    }

    function summary(g) {
      const w = g.wx;
      const tl = w.timeline || [];
      const snowyGame = tl.filter(x => x.inGame && x.s > 0);
      const peak = snowyGame.slice().sort((a, b) => b.s - a.s)[0];
      const parts = [];
      if (g.level === 2) parts.push(`Snow is likely during this game, with about ${inches(w.snowIn)} forecast from kickoff into the fourth quarter.`);
      else if (g.level === 1) parts.push(w.snowIn > 0
        ? `Snow is possible. Only about ${inches(w.snowIn)} is forecast during the game, so it may come down as flurries.`
        : `Snow is possible. It will be cold enough, with up to a ${w.coldPrecipChance}% chance of precipitation while below freezing.`);
      else if (w.lowF <= 35) parts.push(`No snow expected, but it will be cold, between ${w.lowF}° and ${w.highF}°.`);
      else parts.push(`No snow expected. Temperatures should run between ${w.lowF}° and ${w.highF}°.`);
      if (peak) parts.push(`Heaviest around ${fmtHour(peak.t)}.`);
      if (w.snowBefore24In >= 0.5) parts.push(`Another ${inches(w.snowBefore24In)} falls in the 24 hours before kickoff, so the field could already be white.`);
      if (w.gustMph >= 25) parts.push(`Gusts up to ${w.gustMph} mph could blow the snow sideways and affect kicking.`);
      if (w.feelsLowF <= 20) parts.push(`It will feel like ${w.feelsLowF}° with the wind.`);
      if (g.roof === 'retractable') parts.push(`${g.venue.name} has a retractable roof, so it may be closed.`);
      return parts.join(' ');
    }

    function stat(value, label) { return `<div class="gv-stat"><b>${value}</b><span>${label}</span></div>`; }

    function renderGame(g) {
      const w = g.wx;
      const verdict = g.roof === 'dome' ? '' : !w ? '' :
        g.level === 2 ? `<p class="gv-verdict likely">${flakeIcon} Snow game likely</p>`
        : g.level === 1 ? `<p class="gv-verdict possible">${flakeIcon} Snow possible</p>`
        : `<p class="gv-verdict">No snow expected</p>`;

      const head = `
        <div class="gv-matchup">${logo(g.away)}<span class="at">at</span>${logo(g.home)}</div>
        <h2 class="gv-title">${esc(g.away.name)} at ${esc(g.home.name)}</h2>
        <p class="gv-when">${esc(fmtWhen(g.kickoff))}${g.broadcast ? ' on ' + esc(g.broadcast) : ''}<br>${esc(g.venue.name)}${g.venue.city ? ', ' + esc(g.venue.city) : ''}</p>
        ${verdict}`;

      if (g.roof === 'dome') return head + `<p class="gv-summary">${esc(g.venue.name)} is a dome, so the weather won't touch this one.</p>`;
      if (!w) return head + `<p class="gv-summary">This game is past the forecast range. Check back a few days before kickoff.</p>`;

      const chartBlock = (id, title, sub, legend) => `
        <section class="gv-chart">
          <h3>${title}</h3>
          <p class="gv-sub">${sub}</p>
          ${legend ? `<div class="legend">${legend}</div>` : ''}
          <div class="chart" id="${id}"></div>
        </section>`;
      const key = (color, label, line) => `<span><i class="${line ? 'line' : 'box'}" style="background:${color}"></i>${label}</span>`;

      return head + `
        <p class="gv-summary">${esc(summary(g))}</p>
        ${meter(g)}
        <div class="gv-stats">
          ${stat(inches(w.snowIn), 'snow during the game')}
          ${stat(inches(w.snowBefore24In ?? 0), 'snow in the 24 hours before')}
          ${stat(inches(w.snowDepthIn ?? 0), 'snow on the ground at kickoff')}
          ${stat(`${w.lowF}–${w.highF}°`, 'game temperature')}
          ${stat(`${w.feelsLowF ?? w.lowF}°`, 'coldest feels-like')}
          ${stat(`${w.gustMph ?? w.windMph} mph`, 'strongest gusts')}
        </div>
        ${chartBlock('ch-snow', 'Snowfall and accumulation', 'Inches per hour, and the running total from 3 hours before kickoff', key(C1, 'Snow per hour') + key(C2, 'Running total', true))}
        ${chartBlock('ch-precip', 'Chance of precipitation', 'Percent chance each hour, by what would fall', key(C1, 'Snow or ice') + key(C2, 'Rain'))}
        ${chartBlock('ch-temp', 'Temperature', 'Degrees Fahrenheit; the line at 32° is freezing', key(C1, 'Temperature', true) + key(C2, 'Feels like', true))}
        ${chartBlock('ch-wind', 'Wind', 'Miles per hour', key(C1, 'Sustained', true) + key(C2, 'Gusts', true))}
        <section class="gv-table-wrap">
          <h3>Hour by hour</h3>
          <div class="gv-table-scroll">
            <table class="gv-table">
              <thead><tr><th>Time</th><th>Temp</th><th>Feels</th><th>Precip</th><th>Snow</th><th>Wind</th><th>Sky</th></tr></thead>
              <tbody>${(w.timeline || []).map(h => `<tr class="${h.inGame ? 'in-game' : ''}">
                <td>${esc(fmtHour(h.t))}</td><td>${h.f}°</td><td>${h.fl}°</td><td>${h.p}%</td>
                <td>${h.s > 0 ? h.s.toFixed(2) + '″' : '–'}</td><td>${h.w}/${h.g}</td><td>${condition(h.c, h.s).text}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          <p class="gv-sub">Highlighted rows are during the game. Wind shows sustained/gusts in mph.</p>
        </section>
        <p class="gv-source">Forecast from Open-Meteo, updated ${esc(new Date(state.data.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}. Snow totals assume typical snow-to-liquid ratios.</p>`;
    }

    function drawCharts(g) {
      const tl = g.wx && g.wx.timeline;
      if (!tl || !tl.length) return;
      const isFrozen = h => [71, 73, 75, 77, 85, 86, 66, 67, 56, 57].includes(h.c) || h.s > 0 || h.f <= COLD;
      let run = 0;
      const total = tl.map(h => (run += h.s));
      const snowMax = Math.max(0.5, ...total) ;

      lineBarChart('#ch-snow', tl, {
        max: niceMax(snowMax), fmt: v => (v === 0 ? '0' : v.toFixed(v < 1 ? 2 : 1)) + '″',
        bars: [{ values: tl.map(h => h.s), color: () => C1, label: 'Snow' }],
        lines: [{ values: total, color: C2, label: 'Total' }]
      });
      lineBarChart('#ch-precip', tl, {
        max: 100, fmt: v => Math.round(v) + '%', ticks: [0, 50, 100],
        bars: [{ values: tl.map(h => h.p), color: i => isFrozen(tl[i]) ? C1 : C2, label: i => isFrozen(tl[i]) ? 'Snow or ice' : 'Rain' }],
        lines: []
      });
      const temps = tl.flatMap(h => [h.f, h.fl]);
      const lo = Math.floor((Math.min(...temps, 30) - 4) / 10) * 10;
      const hi = Math.ceil((Math.max(...temps, 34) + 4) / 10) * 10;
      lineBarChart('#ch-temp', tl, {
        min: lo, max: hi, fmt: v => Math.round(v) + '°', ref: { value: 32, label: 'Freezing' },
        bars: [],
        lines: [{ values: tl.map(h => h.f), color: C1, label: 'Temp' }, { values: tl.map(h => h.fl), color: C2, label: 'Feels like' }]
      });
      lineBarChart('#ch-wind', tl, {
        max: niceMax(Math.max(10, ...tl.map(h => h.g))), fmt: v => Math.round(v) + ' mph',
        bars: [],
        lines: [{ values: tl.map(h => h.w), color: C1, label: 'Wind' }, { values: tl.map(h => h.g), color: C2, label: 'Gusts' }]
      });
    }

    function niceMax(v) {
      const steps = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
      return steps.find(s => s >= v * 1.1) || Math.ceil(v * 1.2);
    }

    // One small SVG chart: optional bars + up to two lines on a single y-axis, game window shaded,
    // tap or drag for a crosshair and tooltip.
    function lineBarChart(sel, tl, opt) {
      const host = body.querySelector(sel);
      if (!host) return;
      const W = host.clientWidth || 340, H = 172;
      const pad = { l: 40, r: 30, t: 18, b: 24 };
      const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      const n = tl.length, band = iw / n;
      const min = opt.min ?? 0, max = opt.max;
      const x = i => pad.l + band * i + band / 2;
      const y = v => pad.t + ih - ((v - min) / (max - min)) * ih;
      const ticks = opt.ticks || [min, min + (max - min) / 2, max];

      let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(host.parentNode.querySelector('h3').textContent)} chart">`;
      // game window
      const gi = tl.map((h, i) => (h.inGame ? i : -1)).filter(i => i >= 0);
      if (gi.length) {
        const gx = pad.l + band * gi[0], gw = band * gi.length;
        s += `<rect x="${gx}" y="${pad.t - 14}" width="${gw}" height="${ih + 14}" fill="rgba(233,241,247,0.06)"/>`;
        s += `<text x="${gx + 4}" y="${pad.t - 4}" class="ch-note">Game</text>`;
      }
      // grid + y labels
      for (const tv of ticks) {
        s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(tv)}" y2="${y(tv)}" class="ch-grid"/>`;
        s += `<text x="${pad.l - 6}" y="${y(tv) + 4}" text-anchor="end" class="ch-axis">${opt.fmt(tv)}</text>`;
      }
      if (opt.ref && opt.ref.value > min && opt.ref.value < max) {
        s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(opt.ref.value)}" y2="${y(opt.ref.value)}" class="ch-ref"/>`;
        s += `<text x="${W - pad.r}" y="${y(opt.ref.value) - 4}" text-anchor="end" class="ch-note">${opt.ref.label}</text>`;
      }
      // x labels (every other hour)
      tl.forEach((h, i) => {
        if (i % 2 === 0) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ch-axis">${esc(fmtHour(h.t).replace(' ', '').toLowerCase())}</text>`;
      });
      // bars: <=24px, 4px rounded top, square at baseline
      for (const b of opt.bars) {
        const bw = Math.min(24, band - 2);
        b.values.forEach((v, i) => {
          if (!(v > 0)) return;
          const top = y(Math.min(v, max)), base = y(min), bx = x(i) - bw / 2, r = Math.min(4, bw / 2, base - top);
          s += `<path d="M${bx},${base} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + bw - r} Q${bx + bw},${top} ${bx + bw},${top + r} V${base} Z" fill="${b.color(i)}"/>`;
        });
      }
      // lines: 2px, end dot with a surface ring, end value labeled
      for (const ln of opt.lines) {
        const pts = ln.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        s += `<polyline points="${pts}" fill="none" stroke="${ln.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        const li = n - 1, lv = ln.values[li];
        s += `<circle cx="${x(li)}" cy="${y(lv)}" r="4" fill="${ln.color}" stroke="#13253B" stroke-width="2"/>`;
      }
      if (opt.lines.length) {
        const ends = opt.lines.map(ln => ({ v: ln.values[n - 1] })).sort((a, b) => y(a.v) - y(b.v));
        if (ends.length === 2 && Math.abs(y(ends[0].v) - y(ends[1].v)) < 12) { ends[0].dy = -6; ends[1].dy = 6; }
        for (const e of ends) s += `<text x="${x(n - 1) + 8}" y="${y(e.v) + 4 + (e.dy || 0)}" class="ch-end">${opt.fmt(e.v).replace(' mph', '')}</text>`;
      }
      // hover layer
      s += `<line class="ch-cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" visibility="hidden"/>`;
      s += `<rect class="ch-hit" x="${pad.l}" y="0" width="${iw}" height="${H}" fill="transparent"/>`;
      s += `</svg><div class="ch-tip" hidden></div>`;
      host.innerHTML = s;

      const svg = host.querySelector('svg');
      const cross = svg.querySelector('.ch-cross');
      const tip = host.querySelector('.ch-tip');
      const show = evt => {
        const rect = svg.getBoundingClientRect();
        const px = (evt.clientX - rect.left) * (W / rect.width);
        const i = Math.max(0, Math.min(n - 1, Math.floor((px - pad.l) / band)));
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        const rows = [
          ...opt.bars.map(b => [typeof b.label === 'function' ? b.label(i) : b.label, b.values[i], b.color(i)]),
          ...opt.lines.map(l => [l.label, l.values[i], l.color])
        ];
        tip.innerHTML = `<b>${esc(fmtHour(tl[i].t))}${tl[i].inGame ? ', in game' : ''}</b>` +
          rows.map(([label, v, c]) => `<span><i style="background:${c}"></i>${esc(label)} <strong>${opt.fmt(v || 0)}</strong></span>`).join('');
        tip.hidden = false;
        const left = (x(i) / W) * rect.width;
        tip.style.left = Math.max(4, Math.min(rect.width - tip.offsetWidth - 4, left - tip.offsetWidth / 2)) + 'px';
      };
      svg.addEventListener('pointerdown', show);
      svg.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) show(e); });
      svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); } });
    }

    $('#gv-back').addEventListener('click', () => close());
    addEventListener('popstate', () => {
      const m = location.hash.match(/^#game-(.+)$/);
      if (m) open(m[1], true); else close(true);
    });
    let resizeTimer;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (current) drawCharts(current); }, 150);
    });

    return { open, close, isOpen: () => !!current, current: () => current };
  })();

  // ---------- Opening animation: snow and both teams' logos falling together ----------
  const Intro = (() => {
    const layer = $('#gv-intro');
    const canvas = layer.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    let raf = null, endTimer = null;
    const DURATION = 2600;

    function loadLogo(team) {
      return new Promise(resolve => {
        const url = logoUrl(team);
        if (!url) return resolve(null);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
        setTimeout(() => resolve(img.complete && img.naturalWidth ? img : null), 700);
      });
    }

    function badge(team) {
      // Fallback when a logo can't load: the team's color with its abbreviation
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const b = c.getContext('2d');
      b.fillStyle = team?.color || '#2B4566';
      b.beginPath(); b.arc(64, 64, 62, 0, 6.283); b.fill();
      b.fillStyle = '#fff'; b.font = '700 40px "Public Sans", sans-serif'; b.textAlign = 'center'; b.textBaseline = 'middle';
      b.fillText(team?.abbr || '', 64, 68);
      return c;
    }

    async function play(g) {
      stop();
      if (REDUCED) return;
      $('#gv-intro-title').textContent = `${g.away.name} at ${g.home.name}`;
      layer.hidden = false;
      layer.classList.remove('fading');
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = canvas.width = innerWidth * dpr, H = canvas.height = innerHeight * dpr;
      const [a, h] = await Promise.all([loadLogo(g.away), loadLogo(g.home)]);
      const pics = [a || badge(g.away), h || badge(g.home)];

      const items = [];
      const spawn = (initial) => {
        const isLogo = Math.random() < 0.5;
        const z = Math.random();
        items.push({
          logo: isLogo ? pics[items.length % 2] : null,
          x: Math.random() * W,
          y: initial ? Math.random() * H * 1.1 - H * 0.35 : -60 * dpr,
          size: isLogo ? (24 + z * 30) * dpr : (2 + z * 4) * dpr,
          vy: (2.2 + z * 3.4) * dpr,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.06,
          ph: Math.random() * 6.28, a: 0.55 + z * 0.45
        });
      };
      for (let i = 0; i < 46; i++) spawn(true);

      const t0 = performance.now();
      const frame = now => {
        const t = now - t0;
        if (t < DURATION - 900 && Math.random() < 0.8) spawn(false);
        ctx.clearRect(0, 0, W, H);
        for (const it of items) {
          it.y += it.vy; it.ph += 0.03; it.rot += it.vr;
          const px = it.x + Math.sin(it.ph) * 14 * dpr;
          ctx.globalAlpha = it.a;
          if (it.logo) {
            ctx.save();
            ctx.translate(px, it.y);
            ctx.rotate(Math.sin(it.rot) * 0.5);
            ctx.drawImage(it.logo, -it.size / 2, -it.size / 2, it.size, it.size);
            ctx.restore();
          } else {
            ctx.fillStyle = '#EEF5FA';
            ctx.beginPath(); ctx.arc(px, it.y, it.size, 0, 6.283); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        for (let i = items.length - 1; i >= 0; i--) if (items[i].y > H + 80 * dpr) items.splice(i, 1);
        if (t < DURATION) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      endTimer = setTimeout(finish, DURATION - 500);
    }

    function finish() {
      layer.classList.add('fading');
      endTimer = setTimeout(stop, 500);
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(endTimer);
      raf = null;
      layer.hidden = true;
      layer.classList.remove('fading');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    layer.addEventListener('click', stop);   // tap to skip
    return { play, stop };
  })();

  // ---------- Wiring ----------
  document.querySelectorAll('.tabs button').forEach(btn => btn.addEventListener('click', () => {
    state.filter = btn.dataset.filter;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
    render();
  }));

  $('#list').addEventListener('click', e => {
    const btn = e.target.closest('.game');
    if (btn) GameView.open(btn.dataset.id);
  });
  $('#hero-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-open]');
    if (btn) GameView.open(btn.dataset.open);
  });

  $('#refresh').addEventListener('click', () => load(true));
  $('#bell').addEventListener('click', () => openSheet());
  $('#sheet-close').addEventListener('click', () => $('#sheet').close());
  $('#sheet').addEventListener('click', e => { if (e.target === $('#sheet')) $('#sheet').close(); });

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.data && !GameView.isOpen()) load(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(refreshBell).catch(() => {});
  }
  Snow.start();
  load();
})();
