(() => {
  const API = ((self.SNOW_RADAR && self.SNOW_RADAR.workerUrl) || '').replace(/\/$/, '');
  const DEMO = !API || API.includes('YOUR-SUBDOMAIN');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLD = 35; // °F: at or below, precipitation could fall as snow

  const $ = sel => document.querySelector(sel);
  const state = { data: null, installPrompt: null };

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
    if (!url) return `<span class="capped">${fallback}</span>`;
    // second, whitened copy of the logo is masked to its top edge: snow that follows the logo's own outline
    return `<span class="capped"><img class="logo" src="${esc(url)}" alt="${esc(team.name || team.abbr)}" loading="lazy" data-fallback="${esc(fallback)}"><img class="logo logo-snow" src="${esc(url)}" alt="" aria-hidden="true" loading="lazy" onerror="this.remove()"></span>`;
  }
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.fallback) img.outerHTML = img.dataset.fallback;
  }, true);

  // A little snow resting on top of a team name
  const seed = text => [...String(text)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7);
  const snowy = text => `<span class="snowy" data-text="${esc(text)}" style="--seed:${seed(text) % 60}px">${esc(text)}</span>`;
  // 0–1 strength of a game's frosty border glow: more forecast snow, more glow
  const glow = g => (g.roof === 'dome' || !g.wx ? 0 : Math.round(snowScore(g)) / 100).toFixed(2);

  // 0–100 position on the snow meter
  function snowScore(g) {
    const w = g.wx;
    if (!w) return 0;
    if (g.level === 2) return Math.min(96, 78 + Math.round(w.snowIn * 8));
    if (g.level === 1) return Math.min(72, 40 + Math.round(w.coldPrecipChance * 0.3));
    const cold = Math.max(0, Math.min(1, (50 - w.lowF) / 15));
    return Math.max(4, Math.round(cold * 20 + cold * w.precipChance * 0.15));
  }


  // ---------- Snow resting on team names and logos (snow games only) ----------
  // Given a canvas holding a shape (a word or a logo), find the top surface of every part of it
  // and heap a rounded mound of snow there: thicker on flat tops, thinner on slopes, a little uneven,
  // deeper when the game's forecast has more snow. Returns a canvas with just the snow.
  function heapSnow(mask, { unit, snow, seedVal, min }) {
    const cw = mask.width, ch = mask.height;
    const data = mask.getContext('2d').getImageData(0, 0, cw, ch).data;
    const top = new Float32Array(cw).fill(-1);
    for (let x = 0; x < cw; x++) {
      for (let y = 0; y < ch; y++) {
        if (data[(y * cw + x) * 4 + 3] > 140) { top[x] = y; break; }
      }
    }
    const max = Math.max(min, unit * (0.09 + 0.08 * snow));
    const depth = new Float32Array(cw);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const steep = 1.8 * dpr;
    let x0 = 0;
    while (x0 < cw) {
      if (top[x0] < 0) { x0++; continue; }
      let x1 = x0 + 1;
      while (x1 < cw && top[x1] >= 0 && Math.abs(top[x1] - top[x1 - 1]) <= steep) x1++;
      const w = x1 - x0;
      if (w >= 2 * dpr) {
        const cap = Math.min(max, w * 0.38);
        for (let i = x0; i < x1; i++) {
          const t = (i - x0 + 0.5) / w;
          const dome = Math.pow(Math.sin(Math.PI * t), 0.55);
          const noise = 0.82 + 0.18 * Math.sin(i / (unit * 0.06) + seedVal);
          depth[i] = cap * dome * noise;
        }
      }
      x0 = x1;
    }
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    const o = out.getContext('2d');
    const sink = unit * 0.03;
    let x = 0;
    while (x < cw) {
      if (depth[x] < 0.4) { x++; continue; }
      const start = x;
      while (x < cw && depth[x] >= 0.4) x++;
      o.beginPath();
      o.moveTo(start, top[start] + sink);
      for (let i = start; i < x; i++) o.lineTo(i, top[i] - depth[i]);
      for (let i = x - 1; i >= start; i--) o.lineTo(i, top[i] + sink);
      o.closePath();
      const g = o.createLinearGradient(0, top[start] - max, 0, top[start] + sink);
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.7, '#F1F7FB'); g.addColorStop(1, '#BCD3E5');
      o.fillStyle = g;
      o.shadowColor = 'rgba(0, 0, 0, 0.3)'; o.shadowBlur = 1.5 * dpr; o.shadowOffsetY = 0.6 * dpr;
      o.fill();
    }
    return out;
  }

  function capNames(root) {
    const els = (root || document).querySelectorAll('[data-snowgame] .snowy:not([data-capped])');
    for (const el of els) {
      const text = el.dataset.text;
      if (!text || !el.offsetWidth) continue;
      el.setAttribute('data-capped', '');
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      const snow = parseFloat(cs.getPropertyValue('--snow')) || 0;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const pad = Math.ceil(fs * 0.3);
      const W = el.offsetWidth + pad * 2, H = el.offsetHeight + pad * 2;
      const probe = document.createElement('canvas');
      probe.width = Math.ceil(W * dpr); probe.height = Math.ceil(H * dpr);
      const p = probe.getContext('2d');
      p.scale(dpr, dpr);
      p.font = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
      p.textBaseline = 'alphabetic';
      const m = p.measureText(text);
      const baseline = pad + (el.offsetHeight - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
      p.fillText(text, pad, baseline);
      const out = heapSnow(probe, { unit: fs * dpr, snow, seedVal: seed(text), min: 2.5 * dpr });
      out.className = 'snowcap';
      out.style.cssText = `left:${-pad}px;top:${-pad}px;width:${W}px;height:${H}px`;
      el.appendChild(out);
    }
  }

  // Logos: trace the logo's real outline and settle snow on it. ESPN's images are read through
  // the backend (which adds the header browsers need to let the app read the pixels).
  const maskUrl = url => (!DEMO && /^https:\/\/a\.espncdn\.com\//.test(url)) ? API + '/logo?u=' + encodeURIComponent(url) : url;
  function capLogos(root) {
    const boxes = (root || document).querySelectorAll('[data-snowgame] .capped:not([data-capped])');
    for (const box of boxes) {
      const shown = box.querySelector('.logo:not(.logo-snow), .wordmark');
      if (!shown || !shown.offsetWidth) continue;
      if (shown.classList.contains('wordmark')) { if (shown.complete && shown.naturalWidth) capWordmark(box, shown); else shown.addEventListener('load', () => capWordmark(box, shown), { once: true }); continue; }
      box.setAttribute('data-capped', '');
      const size = shown.offsetWidth;
      const snow = parseFloat(getComputedStyle(box).getPropertyValue('--snow')) || 0;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const pad = Math.ceil(size * 0.25);
      const W = size + pad * 2;
      const finish = draw => {
        try {
          const mask = document.createElement('canvas');
          mask.width = mask.height = Math.ceil(W * dpr);
          const c = mask.getContext('2d');
          c.scale(dpr, dpr);
          draw(c, pad, size);
          const out = heapSnow(mask, { unit: size * dpr * 0.6, snow, seedVal: size + W, min: 2 * dpr });
          out.className = 'snowcap';
          out.style.cssText = `left:${-pad}px;top:${-pad}px;width:${W}px;height:${W}px;z-index:2`;
          box.appendChild(out);
          box.querySelector('.logo-snow')?.remove();   // real snow replaces the simple rim
        } catch (e) { /* pixels unreadable: keep the simple rim */ }
      };
      if (shown.tagName !== 'IMG') {
        finish((c, o, s2) => { c.beginPath(); c.arc(o + s2 / 2, o + s2 / 2, s2 / 2, 0, 6.283); c.fill(); });
        continue;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => finish((c, o, s2) => {
        const k = Math.min(s2 / img.naturalWidth, s2 / img.naturalHeight);
        const w = img.naturalWidth * k, h = img.naturalHeight * k;
        c.drawImage(img, o + (s2 - w) / 2, o + (s2 - h) / 2, w, h);
      });
      img.src = maskUrl(shown.currentSrc || shown.src);
    }
  }

  // Wordmarks are wide: trace the lettering and let snow settle along the top of each letter
  function capWordmark(box, img) {
    if (box.hasAttribute('data-capped') || !img.offsetWidth) return;
    if (!img.dataset.clean) { img.addEventListener('wmclean', () => capWordmark(box, img), { once: true }); return; }
    box.setAttribute('data-capped', '');
    const w = img.offsetWidth, h = img.offsetHeight;
    const snow = parseFloat(getComputedStyle(box).getPropertyValue('--snow')) || 0;
    const dpr = Math.min(devicePixelRatio || 1, 2), pad = Math.ceil(h * 0.45);
    const src = new Image();
    src.crossOrigin = 'anonymous';
    src.onload = () => {
      try {
        const mask = document.createElement('canvas');
        mask.width = Math.ceil((w + pad * 2) * dpr); mask.height = Math.ceil((h + pad * 2) * dpr);
        const c = mask.getContext('2d'); c.scale(dpr, dpr);
        c.drawImage(src, pad, pad, w, h);
        const out = heapSnow(mask, { unit: h * dpr * 0.9, snow, seedVal: w + h, min: 1.6 * dpr });
        out.className = 'snowcap';
        out.style.cssText = `left:${-pad}px;top:${-pad}px;width:${w + pad * 2}px;height:${h + pad * 2}px;z-index:2`;
        box.appendChild(out);
      } catch (e) { /* unreadable pixels: no snow on this one */ }
    };
    src.src = img.currentSrc || img.src;
  }
  // A wordmark that fails to load falls back to the team name
  document.addEventListener('error', e => {
    const img = e.target;
    if (img && img.classList && img.classList.contains('wordmark')) {
      const cap = img.closest('.wm-cap');
      if (cap) { cap.outerHTML = img.dataset.fallback || ''; capSoon(document); }
    }
  }, true);

  const fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
  const capSoon = root => fontsReady.then(() => requestAnimationFrame(() => {
    capNames(root); capLogos(root); DriftMeter.mount(root || document);
  }));

  // ---------- Data ----------
  async function load(fresh) {
    $('#refresh').classList.add('spinning');
    try {
      let data;
      try {
        data = DEMO ? demoData() : await (await fetch(API + '/games' + (fresh ? '?fresh=1' : ''), { cache: 'no-store' })).json();
        if (!data || !Array.isArray(data.games)) throw new Error(data && data.error || 'Bad response');
        state.offline = false;
        if (!DEMO) store.set('lastData', data);
      } catch (e) {
        // no signal: fall back to the last forecast we saved, if it's from this week
        const saved = store.get('lastData', null);
        if (!saved || Date.now() - new Date(saved.updated).getTime() > 3 * 86400000) throw e;
        data = saved; state.offline = true;
        data.games = data.games.filter(g => new Date(g.kickoff).getTime() > Date.now() - 4 * 3600000);
      }
      state.data = data;
      render();
      capSoon(document);
      GameView.refresh();
      Splash.hide();
      const m = location.hash.match(/^#game-(.+)$/);
      if (m && !GameView.isOpen()) GameView.open(m[1], true);
    } catch (err) {
      $('#hero-body').innerHTML = '<p class="hero-quiet">No forecast to show right now.</p>';
      $('#list').innerHTML = `<div class="error"><b>${navigator.onLine ? "The forecast service isn't answering." : "You're offline."}</b> ${navigator.onLine ? 'It usually comes back within a few minutes.' : 'Connect to Wi-Fi or data, then try again.'}<br><button id="retry">Try again</button></div>`;
      $('#fresh').textContent = '';
      $('#retry').onclick = () => load(true);
      Splash.hide();
      Snow.set(0, 0);
    } finally {
      $('#refresh').classList.remove('spinning');
    }
  }

  // ---------- Rendering ----------
  function render() {
    const games = state.data.games;

    // Games in progress first
    const live = games.filter(g => g.live).sort((a, b) => (snowingLive(b) - snowingLive(a)) || (Favs.game(b) - Favs.game(a)));
    $('#live-now').innerHTML = live.length ? `
      <h2 class="section-head">Live now</h2>
      <div class="feature-grid">${live.map(liveCard).join('')}</div>` : '';
    scheduleLiveRefresh(live.length > 0);

    // Any game with a chance of snow moves to the top: the worst one in the hero, the rest as featured cards.
    const featured = games.filter(g => analyzed(g) && g.level > 0 && !g.live && !g.final)
      .sort((a, b) => b.level - a.level || (Favs.game(b) - Favs.game(a)) || b.wx.snowIn - a.wx.snowIn || new Date(a.kickoff) - new Date(b.kickoff));
    state.featured = featured;
    renderHero(games, featured);

    renderWOTW(games, featured);
    renderWeatherGames(games, featured);
    const more = featured.slice(1);
    $('#featured').innerHTML = more.length ? `
      <h2 class="section-head">More snow on the radar</h2>
      <div class="feature-grid">${more.map(featureCard).join('')}</div>` : '';

    // Your teams' other games next
    const weather = [...(state.weatherGames || []), ...(state.wotw ? [state.wotw] : [])];
    const mine = games.filter(g => !g.live && !featured.includes(g) && !weather.includes(g) && Favs.game(g));
    $('#favs').innerHTML = mine.length ? `
      <h2 class="section-head">Your teams</h2>
      <div class="day-games fav-games">${mine.map(gameRow).join('')}</div>` : '';

    const rest = games.filter(g => !g.live && !featured.includes(g) && !mine.includes(g) && !weather.includes(g));
    $('#list-head').textContent = featured.length || mine.length || live.length || weather.length ? 'Every other game this week' : "This week's games";
    if (!rest.length) {
      $('#list').innerHTML = `<p class="empty">${games.length ? 'Every game this week is listed above.' : `No games in the next ${state.data.daysAhead || 7} days.`}</p>`;
    } else {
      const days = new Map();
      for (const g of rest) {
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
    renderOutlook();
    renderRanking();
    Season.render();
    renderGameDay(games);
    freshness();
    whatsNew();
    if (!GameView.isOpen()) homeWinter();
    tickCountdowns();

    $('#footnote').textContent = (DEMO ? 'Sample data shown. Add your backend URL in config.js to see real games. ' : '')
      + 'Schedule and logos from ESPN, weather from Open-Meteo. Forecasts beyond 5 days are rough.';
  }

  // Frost creeps onto the home screen when a likely snow game is less than 2 days away,
  // and snow piles along the bottom as deep as the top snow game's forecast.
  function homeWinter() {
    const featured = state.featured || [];
    const soon = featured.find(g => g.level === 2 && new Date(g.kickoff).getTime() - Date.now() < 48 * 3600000);
    Frost.set(!!soon, 0.7);
    const liveSnow = (state.data?.games || []).filter(snowingLive).sort((a, b) => b.liveWx.snowSoFarIn - a.liveWx.snowSoFarIn)[0];
    SnowBank.set(liveSnow ? Math.max(liveSnow.liveWx.snowSoFarIn, featured[0] ? featured[0].wx.snowIn * 0.55 : 0) : featured[0] ? featured[0].wx.snowIn * 0.55 : 0);
    SnowBank.snowman(liveSnow ? liveSnow.liveWx.snowSoFarIn : 0, liveSnow ? liveSnow.venue.name : '');
    if (liveSnow) Blizzard.apply(liveSnow, 'home'); else Blizzard.off();
    if (Theme.field()) Turf.set(homeTurf());
  }

  function meter(g) {
    const score = snowScore(g);
    return `<div class="meter" role="img" aria-label="Snow risk ${score} out of 100">
      <canvas class="drift-meter" data-score="${score}" data-seed="${seed(g.id)}"></canvas>
      <div class="meter-scale"><span>Dry</span><span>Flurries</span><span>Snow game</span></div>
    </div>`;
  }

  function renderHero(games, threats) {
    const hero = document.querySelector('.hero');
    const g = threats[0];

    if (!g) {
      const coldest = games.filter(x => analyzed(x) && x.wx).sort((a, b) => a.wx.lowF - b.wx.lowF)[0];
      hero.classList.add('calm');
      hero.classList.remove('day');
      $('#hero-body').style.setProperty('--snow', 0);
      $('#hero-body').removeAttribute('data-snowgame');
      $('#hero-body').innerHTML = `
        <p class="hero-kicker">${flakeIcon} No snow in the forecast</p>
        <h2 class="hero-title">All clear for the next ${state.data.daysAhead || 7} days</h2>
        ${coldest ? `<p class="hero-when">Coldest game: ${esc(coldest.away.name)} at ${esc(coldest.home.name)}, ${esc(fmtWhen(coldest.kickoff))}, low of ${coldest.wx.lowF}°.</p>${meter(coldest)}<button class="open-btn" data-open="${esc(coldest.id)}">See the full forecast</button>` : ''}`;
      Snow.set(0, coldest?.wx?.windMph || 0);
      return;
    }

    hero.classList.remove('calm');
    hero.classList.toggle('day', g.wx.night === false);
    $('#hero-body').style.setProperty('--snow', glow(g));
    $('#hero-body').setAttribute('data-snowgame', '');
    const cls = g.level === 2 ? 'likely' : 'possible';
    const more = threats.length > 1 ? `<span class="more">+${threats.length - 1} more below</span>` : '';
    const roof = g.roof === 'retractable' ? ' Retractable roof, so it may be closed.' : '';
    $('#hero-body').innerHTML = `
      <p class="hero-kicker ${cls}">${alertIcon} ${advisoryName(g)} ${more}</p>
      <div class="matchup wm-matchup">${matchupStack(g, 'lg', favMark(g))}</div>
      <h2 class="visually-hidden">${esc(g.away.name)} at ${esc(g.home.name)}</h2>
      <p class="hero-when">${esc(fmtWhen(g.kickoff))}, ${esc(g.venue.name)}.${roof}</p>
      <div class="meta-row">${countdown(g)}${trendHtml(g)}${agreeHtml(g)}${badgeHtml(g)}</div>
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
      <div class="hero-actions"><button class="open-btn" data-open="${esc(g.id)}">See the full forecast</button>${watchLink(g) ? `<a class="watch-chip" href="${esc(watchLink(g).url)}" target="_blank" rel="noopener">${playIcon}${esc(watchLink(g).service)}</a>` : ''}</div>`;
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
    if (g.final) return `<span class="chip final">Final ${g.score?.away ?? ''}–${g.score?.home ?? ''}</span>`;
    const live = g.live ? '<span class="live">Live</span>' : '';
    if (g.roof === 'dome') return `<span class="chip">${live}Dome</span>`;
    if (!g.wx) return `<span class="chip">${live}Forecast soon</span>`;
    if (g.level === 2) return `<span class="chip likely">${live}${flakeIcon}Warning</span>`;
    if (g.level === 1) return `<span class="chip possible">${live}${flakeIcon}Watch</span>`;
    const range = g.wx.lowF === g.wx.highF ? `${g.wx.lowF}°` : `${g.wx.lowF}–${g.wx.highF}°`;
    return `<span class="chip temp">${live}${range}</span>`;
  }

  function featureCard(g) {
    const cls = g.level === 2 ? 'likely' : 'possible';
    const when = new Date(g.kickoff).toLocaleDateString([], { weekday: 'short' }) + ' ' + fmtTime(g.kickoff);
    const roof = g.roof === 'retractable' ? ' Roof may be closed.' : '';
    return `<button class="feature-card ${cls}${seed(g.id) % 2 ? ' flip' : ''}" style="--snow:${glow(g)}" data-snowgame data-open="${esc(g.id)}" aria-label="Open forecast for ${esc(g.away.name)} at ${esc(g.home.name)}">
      <span class="fc-top">
        <span class="fc-kicker">${alertIcon}${g.level === 2 ? 'Snow Game Warning' : 'Snow Game Watch'}</span>
        <span class="fc-when">${favMark(g)}${esc(when)}</span>
      </span>
      <span class="fc-teams">${matchupStack(g, 'md')}</span>
      <span class="fc-bottom">
        <span class="fc-snow">${inches(g.wx.snowIn)}<small>snow in game</small></span>
        <span class="fc-facts">${g.wx.lowF}–${g.wx.highF}°, ${g.wx.coldPrecipChance || g.wx.precipChance}% precip<br>${esc(g.venue.name)}.${roof}</span>
      </span>
      <span class="meta-row">${countdown(g)}${trendHtml(g)}${agreeHtml(g)}${badgeHtml(g)}</span>
    </button>`;
  }

  function gameRow(g) {
    const tone = g.level === 2 ? 'likely' : g.level === 1 ? 'possible' : '';
    return `<div class="game-wrap ${tone}${seed(g.id) % 2 ? ' flip' : ''}" style="--snow:${glow(g)}"${g.level > 0 ? ' data-snowgame' : ''}>
      <button class="game" data-id="${esc(g.id)}" aria-label="Open forecast for ${esc(g.away.name)} at ${esc(g.home.name)}">
        <div>
          <div class="teams">${matchupStack(g, 'sm', favMark(g))}</div>
          <div class="game-meta"><span>${esc(fmtTime(g.kickoff))}</span><span>${esc(g.venue.city || g.venue.name)}</span>${g.broadcast ? `<span>${esc(g.broadcast)}</span>` : ''}${holidayTag(g.kickoff)}</div>
          ${badges(g).length ? `<div class="meta-row">${badgeHtml(g)}</div>` : ''}
        </div>
        ${chip(g)}
      </button>
    </div>`;
  }


  // ---------- Snow meter: a living drift on a strip of field ----------
  // The drift piles up toward the risk level, its surface rolls slowly, snow blows off the crest,
  // flakes land on it, and the football rides the top. Frozen in place when motion is reduced.
  const DriftMeter = (() => {
    const meters = [];
    let raf = null;
    const H = 78;

    function mount(root) {
      root.querySelectorAll('canvas.drift-meter:not([data-live])').forEach(c => {
        c.setAttribute('data-live', '');
        const rnd = mulberry(+c.dataset.seed || 1);
        meters.push({
          c, ctx: c.getContext('2d'), s: (+c.dataset.score || 0) / 100, seedVal: +c.dataset.seed || 1,
          flakes: [], drift: [], sparkles: Array.from({ length: 9 }, () => ({ u: rnd(), ph: rnd() * 6.28 })), w: 0
        });
      });
      if (REDUCED) { meters.forEach(m => draw(m, 0)); return; }
      if (!raf && meters.length) raf = requestAnimationFrame(loop);
    }

    function loop(t) {
      for (let i = meters.length - 1; i >= 0; i--) {
        if (!meters[i].c.isConnected) meters.splice(i, 1); else if (Gov.ok('dm' + i, meters[i].c, t)) draw(meters[i], t);
      }
      raf = meters.length ? requestAnimationFrame(loop) : null;
    }

    function mulberry(a) {
      return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }

    // colors and type for each theme
    const LOOK = {
      night: { strip: '#12304A', line: 'rgba(233,241,247,0.13)', ez: 'rgba(233,241,247,0.07)', goal: 'rgba(233,241,247,0.55)', label: 'rgba(233,241,247,0.7)', font: '800 14px "Big Shoulders Display", sans-serif', snow: ['#FFFFFF', '#E3EEF6', '#9DBDD6'], border: 'rgba(233,241,247,0.35)', r: 10 },
      field: { strip: 'stripes', line: 'rgba(255,255,255,0.75)', ez: 'rgba(10,40,16,0.55)', goal: '#FFFFFF', label: '#FFFFFF', font: '800 14px "Big Shoulders Display", sans-serif', snow: ['#FFFFFF', '#EEF4F8', '#B9CFDF'], border: 'rgba(255,255,255,0.8)', r: 8 },
      retro: { strip: 'brown', line: 'rgba(246,233,204,0.18)', ez: 'tvstripes', goal: '#F6E9CC', label: '#140E0A', font: 'italic 900 15px "Big Shoulders Display", sans-serif', snow: ['#FBF3E2', '#EADDC2', '#B89F78'], border: 'rgba(246,233,204,0.7)', r: 6, scan: true },
      scoreboard: { strip: '#0A0806', line: 'rgba(242,200,110,0.25)', ez: 'rgba(255,139,61,0.35)', goal: '#F6C453', label: '#FFE3A0', font: '900 13px "Doto", monospace', snow: ['#FFE7A8', '#F6C453', '#C98F2E'], border: 'rgba(242,200,110,0.6)', r: 4, bulbs: 4 },
      ninety: { strip: '#16297A', line: 'rgba(255,255,255,0.35)', ez: '#E8202E', goal: '#FFFFFF', label: '#FFFFFF', font: '11px "Press Start 2P", monospace', snow: ['#FFFFFF', '#FFFFFF', '#9DB4E8'], border: '#FFFFFF', r: 3, pixel: 3 }
    };
    function draw(m, t) {
      const { c, ctx } = m;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = c.clientWidth || 320;
      if (m.w !== W) { m.w = W; c.width = W * dpr; c.height = H * dpr; }
      const L = LOOK[document.documentElement.dataset.theme] || LOOK.night;
      // 80s bulbs and 90s pixels: draw small, then light up each cell as a bulb or blow it up as a pixel
      const cell = L.bulbs || L.pixel;
      if (cell) {
        const ow = Math.ceil(W / cell), oh = Math.ceil(H / cell);
        if (!m.off || m.off.width !== ow) { m.off = document.createElement('canvas'); m.off.width = ow; m.off.height = oh; m.octx = m.off.getContext('2d', { willReadFrequently: !!L.bulbs }); }
        const o = m.octx;
        o.setTransform(1 / cell, 0, 0, 1 / cell, 0, 0); o.clearRect(0, 0, W, H);
        scene(m, o, W, t, L);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
        if (L.pixel) {
          ctx.imageSmoothingEnabled = false; ctx.drawImage(m.off, 0, 0, ow * cell, oh * cell);
          // chunky white frame with a hard shadow, like a game HUD
          ctx.fillStyle = '#050B2A'; ctx.fillRect(4, H - 4, W - 4, 4); ctx.fillRect(W - 4, 14, 4, H - 14);
          ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 11.5, W - 6, H - 16);
        } else {
          const d = o.getImageData(0, 0, ow, oh).data;
          for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
            const p = (j * ow + i) * 4; if (d[p + 3] < 30) continue;
            const lum = (d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11) / 255;
            const lit = lum > 0.32;
            ctx.fillStyle = lit ? `rgba(${d[p]},${d[p + 1]},${d[p + 2]},1)` : 'rgba(242,195,90,0.12)';
            ctx.beginPath(); ctx.arc((i + 0.5) * cell, (j + 0.5) * cell, cell * (lit ? 0.44 : 0.3), 0, 6.283); ctx.fill();
          }
        }
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      scene(m, ctx, W, t, L);
    }

    function scene(m, ctx, W, t, L) {
      const s = m.s;
      const top = 10, base = H - 2, goal = W * 0.84;
      // field strip with yard lines and an end zone
      ctx.save();
      roundRect(ctx, 0.5, top, W - 1, base - top, L.r);
      if (L.strip === 'stripes') {
        ctx.save(); ctx.clip();
        for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#2F6B35' : '#3A8442'; ctx.fillRect(goal * i / 10, top, goal / 10 + 1, base - top); }
        ctx.restore();
      } else if (L.strip === 'brown') {
        const bg = ctx.createLinearGradient(0, top, 0, base); bg.addColorStop(0, '#5A3416'); bg.addColorStop(1, '#2A190C');
        ctx.fillStyle = bg; ctx.fill();
      } else { ctx.fillStyle = L.strip; ctx.fill(); }
      ctx.clip();
      ctx.strokeStyle = L.line; ctx.lineWidth = L.strip === 'stripes' ? 1.5 : 1;
      for (let i = 1; i < 10; i++) { const x = Math.round(goal * i / 10) + 0.5; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, base); ctx.stroke(); }
      if (L.ez === 'tvstripes') {
        ['#E8642A', '#F0B13C', '#F6E9CC'].forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(goal, top + i * (base - top) / 3, W - goal, (base - top) / 3 + 1); });
      } else { ctx.fillStyle = L.ez; ctx.fillRect(goal, top, W - goal, base - top); }
      ctx.fillStyle = L.goal; ctx.fillRect(goal, top, 2, base - top);
      ctx.font = L.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = L.label; ctx.fillText('SNOW', (goal + W) / 2 + 1, top + (base - top) * 0.42);

      // the drift
      const crest = Math.max(W * 0.06, Math.min(goal * s, goal - 6));
      const hmax = (base - top) * (0.18 + 0.66 * s);
      const time = t * 0.001;
      const height = x => {
        let h = x <= crest ? hmax * Math.pow(x / crest, 1.5) : hmax * Math.exp(-Math.pow((x - crest) / (W * 0.05), 2));
        const roll = (1.2 + 2.2 * s) * Math.sin(x * 0.045 + time * 1.1) + 0.9 * Math.sin(x * 0.13 - time * 1.7 + m.seedVal);
        return Math.max(0, h + roll * Math.min(1, h / 8));
      };
      const surf = x => base - height(x);

      // football riding the crest, half buried
      const by = surf(crest) - 3 + Math.sin(time * 1.6) * 0.8, slope = (surf(crest + 6) - surf(crest - 6)) / 12;
      football(ctx, crest, by, Math.atan(slope) - 0.25, 30, 17);

      ctx.beginPath(); ctx.moveTo(0, base);
      for (let x = 0; x <= W; x += 2) ctx.lineTo(x, surf(x));
      ctx.lineTo(W, base); ctx.closePath();
      const g = ctx.createLinearGradient(0, base - hmax - 4, 0, base);
      g.addColorStop(0, L.snow[0]); g.addColorStop(0.55, L.snow[1]); g.addColorStop(1, L.snow[2]);
      ctx.fillStyle = g; ctx.fill();
      // bright crust along the surface
      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) { const y = surf(x) + 0.8; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = L.snow[0]; ctx.lineWidth = 1.4; ctx.stroke();
      // twinkles on the snow
      for (const sp of m.sparkles) {
        const x = sp.u * Math.min(W, crest + W * 0.08), y = surf(x) + 3;
        const a = Math.pow(Math.max(0, Math.sin(time * 2.2 + sp.ph)), 12);
        if (a > 0.02 && height(x) > 4) { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(x - 1, y - 1, 2, 2); }
      }

      if (t) {
        // flakes falling onto the drift
        if (Math.random() < 0.25 + 0.6 * s) m.flakes.push({ x: Math.random() * W, y: top - 4, vy: 0.35 + Math.random() * 0.5, r: 0.8 + Math.random() * 1.4, ph: Math.random() * 6 });
        // snow blowing off the crest
        if (s > 0.1 && Math.random() < 0.15 + 0.7 * s) m.drift.push({ x: crest - 6 + Math.random() * 12, y: surf(crest) - 1, vx: 0.5 + Math.random() * 1.2, vy: -0.25 - Math.random() * 0.35, life: 1 });
      }
      ctx.fillStyle = L.snow[0];
      for (let i = m.flakes.length - 1; i >= 0; i--) {
        const f = m.flakes[i]; f.y += f.vy; f.ph += 0.05; const x = f.x + Math.sin(f.ph) * 1.5;
        if (f.y >= surf(x)) { m.flakes.splice(i, 1); continue; }
        ctx.globalAlpha = 0.85;
        if (L.pixel) ctx.fillRect(x - f.r, f.y - f.r, f.r * 2.4, f.r * 2.4); else { ctx.beginPath(); ctx.arc(x, f.y, f.r, 0, 6.283); ctx.fill(); }
      }
      for (let i = m.drift.length - 1; i >= 0; i--) {
        const d = m.drift[i]; d.x += d.vx; d.y += d.vy; d.vy += 0.012; d.life -= 0.018;
        if (d.life <= 0 || d.x > W) { m.drift.splice(i, 1); continue; }
        ctx.globalAlpha = d.life * 0.8; ctx.beginPath(); ctx.arc(d.x, d.y, 1.1, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // old picture tube: scanlines across the strip
      if (L.scan) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = top; y < base; y += 3) ctx.fillRect(0, y, W, 1); }
      ctx.restore();
      if (!L.pixel) { roundRect(ctx, 0.5, top, W - 1, base - top, L.r); ctx.strokeStyle = L.border; ctx.lineWidth = L.strip === 'brown' ? 2 : 1; ctx.stroke(); }
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }

    function football(ctx, x, y, rot, w, h) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.beginPath(); ctx.moveTo(-w / 2, 0);
      ctx.quadraticCurveTo(0, -h, w / 2, 0); ctx.quadraticCurveTo(0, h, -w / 2, 0); ctx.closePath();
      ctx.fillStyle = '#7A4526'; ctx.fill();
      ctx.strokeStyle = '#4E2A14'; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = '#F4EFE6'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-w * 0.2, -h * 0.08); ctx.lineTo(w * 0.2, -h * 0.08); ctx.stroke();
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * w * 0.08, -h * 0.2); ctx.lineTo(i * w * 0.08, h * 0.04); ctx.stroke(); }
      ctx.restore();
    }

    return { mount };
  })();

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
      if (!Gov.ok('snow', null, performance.now())) { raf = requestAnimationFrame(step); return; }
      const cap = Gov.lite() ? Math.min(target, 70) : target;
      if (flakes.length > cap + 2) flakes.length = cap;
      if (flakes.length < cap) flakes.push(make(false), make(false));
      else if (flakes.length > target + 2) flakes.splice(0, swirl > 0.2 ? 0 : 2);
      swirl *= 0.985;
      for (const f of flakes) {
        f.ph += 0.012 + swirl * 0.08;
        f.y += f.vy * (1 - swirl * 0.6) + Math.sin(f.ph * 2) * swirl * 3 * dpr;
        f.x += (wind + swirl * 2 + Tilt.x * 1.4) * f.vy + Math.sin(f.ph) * (f.sway + swirl * 4) * dpr;
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
    let swirl = 0;
    function burst() {
      swirl = 1;
      for (let i = 0; i < 180; i++) flakes.push(make(true));
    }
    let base = 55, extra = 0;
    function set(level, windMph) {
      base = [55, 110, 190][level] || 55;
      target = Math.max(base, extra);
      if (!extra) wind = Math.min(1.6, 0.15 + windMph / 14);
      if (REDUCED) { flakes = Array.from({ length: target }, () => make(true)); draw(); }
    }
    // blizzard mode: as many flakes as the real snowfall rate calls for, blown by the real wind
    function blizzard(n, windMph) {
      extra = n || 0;
      target = Math.max(base, extra);
      if (extra) wind = Math.min(2.4, 0.2 + (windMph || 0) / 12);
      if (REDUCED) { flakes = Array.from({ length: Math.min(target, 200) }, () => make(true)); draw(); }
    }
    return { start, set, burst, blizzard };
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
    renderSettings();
    settingsExtras();
    if (!$('#sheet').open) $('#sheet').showModal();
  }

  async function renderSettings() {
    const favs = Favs.list();
    $('#team-grid').innerHTML = TEAMS.map(([abbr, name]) => `
      <button class="team-pick${favs.includes(abbr) ? ' on' : ''}" data-team="${abbr}" aria-pressed="${favs.includes(abbr)}">
        <img src="https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span>${name}</span>
      </button>`).join('');
    $('#sound-on').checked = store.get('sound', false);
    const hm = store.get('holiday', 'auto');
    for (const b of document.querySelectorAll('[data-holiday]')) b.setAttribute('aria-pressed', b.dataset.holiday === hm);
    $('#passport-count').textContent = `${Passport.count()} of ${STADIUM_LIST.length} stamped`;
    $('#only-favs').checked = store.get('onlyFavs', false);
    const sub = !DEMO && pushSupported ? await currentSub().catch(() => null) : null;
    $('#only-favs-row').hidden = !sub;
    $('#only-favs').disabled = !favs.length;
    $('#only-favs-row').title = favs.length ? '' : 'Pick at least one team first';
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
      await syncPrefs();
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
    const CITY = { CLE: 'Cleveland', CIN: 'Cincinnati', NYJ: 'New York', BUF: 'Buffalo', CHI: 'Chicago', GB: 'Green Bay', MIN: 'Minnesota', DET: 'Detroit',
      BAL: 'Baltimore', PIT: 'Pittsburgh', KC: 'Kansas City', DEN: 'Denver', NE: 'New England', MIA: 'Miami', HOU: 'Houston', IND: 'Indianapolis',
      PHI: 'Philadelphia', JAX: 'Jacksonville', TB: 'Tampa Bay', NYG: 'New York', SEA: 'Seattle', LAR: 'Los Angeles' };
    const T = (abbr, name, color) => ({ abbr, name, color, location: CITY[abbr], full: (CITY[abbr] || '') + ' ' + name });
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
        snowDepthIn: Math.round(pre * 18) / 10, windAvgMph: wind, windDir: 255, dir850: 258, t850F: Math.min(...temps) - 16, rainHours: codes.filter(c => c >= 51 && c <= 67).length, hours, timeline };
    };
    const g = (id, away, home, kickoff, venue, roof, w, level, broadcast, neutral = false) =>
      ({ id, short: `${away.abbr} @ ${home.abbr}`, kickoff, away, home, venue, roof, wx: w, level, broadcast, neutral, live: false });

    const V = (name, city, lat, lon) => ({ name, city, lat, lon });
    const hist = (...s) => s.map((v, i) => ({ d: (() => { const d = new Date(); d.setDate(d.getDate() - (s.length - 1 - i)); return d.toISOString().slice(0, 10).replace(/-/g, ''); })(), s: v, p: Math.min(90, 30 + v * 40), l: v >= 0.2 ? 2 : v > 0 ? 1 : 0, lo: 28 }));
    const models = (a, b, c) => [{ name: 'American (GFS)', snowIn: a, lowF: 27 }, { name: 'European (ECMWF)', snowIn: b, lowF: 28 }, { name: 'German (ICON)', snowIn: c, lowF: 31 }];
    const withModels = (w, m) => Object.assign(w, { models: m, agree: m.filter(x => x.snowIn >= 0.1).length });

    const k0 = new Date(Date.now() - 95 * 60000).toISOString();
    const k1 = day(4, 13), k2 = day(4, 16, 25), k3 = day(4, 13), k4 = day(4, 20, 20), k5 = day(5, 20, 15), k6 = day(4, 16, 5), k7 = day(4, 13), k8 = day(3, 9, 30);
    const live = g('d0', T('CLE', 'Browns', '#311D00'), T('CIN', 'Bengals', '#FB4F14'), k0, V('Paycor Stadium', 'Cincinnati, OH', 39.0955, -84.5161), 'open',
      wx(k0, [30, 29, 29, 28], [0.2, 0.3, 0.3, 0.2], [73, 75, 75, 73], [80, 85, 85, 80], 16), 2, 'CBS');
    Object.assign(live, { live: true, status: '3rd 8:42', score: { away: 13, home: 17 },
      liveWx: { f: 29, fl: 19, c: 75, w: 16, g: 29, d: 250, snowNow: 0.08, snowSoFarIn: 0.7, lastHourIn: 0.31 },
      situation: { poss: 'CIN', toGoal: 28, text: '3rd & 6 at CLE 28', down: 3, distance: 6 } });
    live.wx.night = false;

    const buf = withModels(wx(k1, [29, 28, 27, 27], [0.3, 0.5, 0.4, 0.2], [73, 75, 73, 71], [80, 85, 80, 70], 18), models(1.5, 1.1, 0.4));
    buf.night = false;
    const gb = withModels(wx(k2, [31, 30, 30, 29], [0, 0, 0.1, 0], [3, 3, 71, 3], [30, 40, 45, 35], 11), models(0.2, 0, 0));
    gb.night = false;
    const pit = withModels(wx(k4, [24, 22, 21, 20], [0, 0, 0, 0], [3, 3, 2, 2], [10, 10, 5, 5], 22), models(0, 0, 0));
    Object.assign(pit, { feelsLowF: 6, gustMph: 36, night: true });
    const den = wx(k5, [41, 39, 37, 36], [0, 0, 0, 0], [61, 63, 61, 61], [60, 70, 65, 50], 7);
    Object.assign(den, { rainHours: 4, night: true });

    const games = [
      live,
      Object.assign(g('d1', T('NYJ', 'Jets', '#125740'), T('BUF', 'Bills', '#00338D'), k1, V('Highmark Stadium', 'Orchard Park, NY', 42.7738, -78.787), 'open', buf, 2, 'CBS'), { hist: hist(0.4, 0.9, 1.4) }),
      Object.assign(g('d2', T('CHI', 'Bears', '#0B162A'), T('GB', 'Packers', '#203731'), k2, V('Lambeau Field', 'Green Bay, WI', 44.5013, -88.0622), 'open', gb, 1, 'FOX'), { hist: hist(0.5, 0.3, 0.1) }),
      g('d3', T('MIN', 'Vikings', '#4F2683'), T('DET', 'Lions', '#0076B6'), k3, V('Ford Field', 'Detroit, MI', 42.34, -83.0456), 'dome', null, 0, 'FOX'),
      g('d4', T('BAL', 'Ravens', '#241773'), T('PIT', 'Steelers', '#101820'), k4, V('Acrisure Stadium', 'Pittsburgh, PA', 40.4468, -80.0158), 'open', pit, 0, 'NBC'),
      g('d5', T('KC', 'Chiefs', '#E31837'), T('DEN', 'Broncos', '#FB4F14'), k5, V('Empower Field at Mile High', 'Denver, CO', 39.7439, -105.0201), 'open', den, 0, 'ESPN'),
      g('d6', T('NE', 'Patriots', '#002244'), T('MIA', 'Dolphins', '#008E97'), k6, V('Hard Rock Stadium', 'Miami Gardens, FL', 25.958, -80.2389), 'open',
        wx(k6, [86, 88, 87, 84], [0, 0, 0, 0], [95, 95, 81, 80], [70, 80, 70, 50], 14), 0, 'CBS'),
      g('d7', T('HOU', 'Texans', '#03202F'), T('IND', 'Colts', '#002C5F'), k7, V('Lucas Oil Stadium', 'Indianapolis, IN', 39.7601, -86.1639), 'retractable',
        withModels(wx(k7, [34, 33, 33, 32], [0, 0.1, 0.1, 0], [3, 71, 71, 3], [40, 50, 50, 40], 14), models(0.2, 0.1, 0)), 1, 'CBS'),
      g('d8', T('PHI', 'Eagles', '#004C54'), T('JAX', 'Jaguars', '#006778'), k8, V('Tottenham Hotspur Stadium', 'London, England', 51.6, -0.07), 'open',
        wx(k8, [46, 45, 45, 44], [0, 0, 0, 0], [61, 61, 3, 3], [60, 55, 30, 20], 13), 0, 'NFL Network', true)
    ];
    for (const x of games) if (x.wx && x.wx.night == null) x.wx.night = new Date(x.kickoff).getHours() >= 17;

    // a game that finished earlier today
    const kf = new Date(Date.now() - 6 * 3600000).toISOString();
    const fin = g('df', T('TB', 'Buccaneers', '#D50A0A'), T('CHI', 'Bears', '#0B162A'), kf, V('Soldier Field', 'Chicago, IL', 41.8623, -87.6167), 'open',
      wx(kf, [31, 30, 29, 29], [0.2, 0.5, 0.6, 0.3], [71, 73, 75, 73], [60, 80, 85, 70], 14), 1, 'NBC');
    Object.assign(fin, { final: true, status: 'Final', score: { away: 20, home: 27 }, lines: { away: [7, 3, 7, 3], home: [0, 14, 3, 10] },
      leaders: [{ cat: 'Passing', name: 'C. Williams', line: '24/33, 281 YDS, 2 TD', team: 'CHI' }, { cat: 'Rushing', name: "D. Swift", line: '19 CAR, 96 YDS', team: 'CHI' }] });
    games.push(fin);

    // stadium facts and snow history
    const FACTS = {
      'Paycor Stadium': ['turf', 2000, 65515, 482], 'Highmark Stadium': ['grass', 2026, 63000, 650, true], 'Lambeau Field': ['grass', 1957, 81441, 643, true],
      'Ford Field': ['turf', 2002, 65000, 600], 'Acrisure Stadium': ['grass', 2001, 68400, 728], 'Empower Field at Mile High': ['grass', 2001, 76125, 5285],
      'Hard Rock Stadium': ['grass', 1987, 65326, 7], 'Lucas Oil Stadium': ['turf', 2008, 67000, 717], 'Soldier Field': ['grass', 1924, 61500, 594]
    };
    const HIST = { 'Highmark Stadium': [24.1, 19.7, 8.9, '2014-11-18'], 'Lambeau Field': [21.4, 17.2, 7.4, '2010-12-11'], 'Paycor Stadium': [9.6, 8.3, 5.1, '2009-12-19'],
      'Acrisure Stadium': [12.8, 11.5, 6.3, '2010-02-06'], 'Empower Field at Mile High': [10.2, 11.8, 9.6, '2006-12-20'], 'Soldier Field': [14.9, 13.6, 7.0, '2011-02-02'] };
    for (const x of games) {
      const f = FACTS[x.venue.name];
      if (f) x.venue.facts = { surface: f[0], opened: f[1], capacity: f[2], elevationFt: f[3], heated: !!f[4], note: x.venue.name === 'Lambeau Field' ? "The NFL's oldest continuously used stadium." : null };
      const h = HIST[x.venue.name];
      if (h && x.roof !== 'dome') x.venue.history = { years: '2006–2025', monthName: new Date(x.kickoff).toLocaleString('en-US', { month: 'long' }), weekPct: h[0], monthPct: h[1], max: { in: h[2], date: h[3] } };
    }
    const ranking = { ready: 25, total: 25, years: '2006–2025', list: [
      ['Highmark Stadium', 'Orchard Park, NY', ['BUF'], 22.4], ['Lambeau Field', 'Green Bay, WI', ['GB'], 20.8], ['Empower Field at Mile High', 'Denver, CO', ['DEN'], 13.1],
      ['Soldier Field', 'Chicago, IL', ['CHI'], 12.9], ['Huntington Bank Field', 'Cleveland, OH', ['CLE'], 12.5], ['Acrisure Stadium', 'Pittsburgh, PA', ['PIT'], 11.2],
      ['Gillette Stadium', 'Foxborough, MA', ['NE'], 9.9], ['GEHA Field at Arrowhead', 'Kansas City, MO', ['KC'], 8.4], ['Paycor Stadium', 'Cincinnati, OH', ['CIN'], 8.0],
      ['MetLife Stadium', 'East Rutherford, NJ', ['NYG', 'NYJ'], 6.7]].map(([name, city, teams, pct]) => ({ name, city, teams, pct, roof: 'open' })) };
    const O = (id, away, home, kickoff, venue, p, basis, detail, confidence, trend) => ({ id, away, home, kickoff, venue, p, basis, detail, confidence, trend, roof: 'open' });
    const outlook = { at: new Date().toISOString(), days: 15, items: [
      O('d1', T('NYJ', 'Jets'), T('BUF', 'Bills'), k1, V('Highmark Stadium', 'Orchard Park, NY'), 74, 'forecast', 'Lake-effect bands look likely, about 2.4″ during the game', 'High', 'up'),
      O('o2', T('SEA', 'Seahawks'), T('GB', 'Packers'), day(9, 13), V('Lambeau Field', 'Green Bay, WI'), 41, 'ensemble', '33 of 81 forecast runs show snow', 'Low', 'up'),
      O('d2', T('CHI', 'Bears'), T('GB', 'Packers'), k2, V('Lambeau Field', 'Green Bay, WI'), 36, 'forecast', 'A cold rain could turn to snow late', 'Medium', 'down'),
      O('o4', T('MIA', 'Dolphins'), T('BUF', 'Bills'), day(12, 20, 15), V('Highmark Stadium', 'Orchard Park, NY'), 29, 'ensemble', '21 of 81 forecast runs show snow', 'Low', null),
      O('o5', T('LAR', 'Rams'), T('DEN', 'Broncos'), day(11, 16, 5), V('Empower Field at Mile High', 'Denver, CO'), 18, 'ensemble', '12 of 81 forecast runs show snow', 'Low', 'up'),
      O('o6', T('NYG', 'Giants'), T('NE', 'Patriots'), day(10, 13), V('Gillette Stadium', 'Foxborough, MA'), 11, 'history', 'Snow in 9.9% of years this week', 'Low', null)
    ] };
    // an official warning on the Buffalo game
    games.find(x => x.id === 'd1').nws = [{ event: 'Lake Effect Snow Warning', snowy: true, cold: false, severity: 'Moderate', ends: day(5, 1) }];
    const sg = (id, a, h, as, hs, v, t, sn, kf, gu, rn) => ({ id, a, h, as, hs, v, t: day(t, 13), sn, kf, gu, wd: Math.round(gu * 0.6), rn });
    const season = { season: new Date().getMonth() < 5 ? new Date().getFullYear() - 1 : new Date().getFullYear(), games: 118, counts: { snow: 2, freezing: 5, frigid: 1, wind: 14, rain: 11 },
      snowiest: [sg('s1', 'MIA', 'BUF', 10, 27, 'Highmark Stadium', -9, 2.4, 25, 31, 0), sg('s2', 'DET', 'GB', 20, 23, 'Lambeau Field', -2, 0.6, 29, 22, 0)],
      coldest: [sg('s3', 'HOU', 'GB', 13, 24, 'Lambeau Field', -2, 0.6, 14, 20, 0), sg('s1', 'MIA', 'BUF', 10, 27, 'Highmark Stadium', -9, 2.4, 25, 31, 0), sg('s4', 'NYJ', 'NE', 17, 20, 'Gillette Stadium', -3, 0, 27, 26, 0)],
      windiest: [sg('s5', 'SEA', 'CHI', 20, 17, 'Soldier Field', -16, 0, 44, 41, 0.1), sg('s6', 'PIT', 'CLE', 10, 13, 'Huntington Bank Field', -23, 0, 51, 38, 0.2), sg('s1', 'MIA', 'BUF', 10, 27, 'Highmark Stadium', -9, 2.4, 25, 31, 0)],
      stadiums: [{ name: 'Highmark Stadium', games: 5, snow: 1, freezing: 2, wind: 3, rain: 1, snowIn: 2.4, coldest: 25 }, { name: 'Lambeau Field', games: 5, snow: 1, freezing: 2, wind: 1, rain: 0, snowIn: 0.6, coldest: 14 }, { name: 'Soldier Field', games: 4, snow: 0, freezing: 0, wind: 3, rain: 2, snowIn: 0, coldest: 38 }, { name: 'Huntington Bank Field', games: 4, snow: 0, freezing: 0, wind: 2, rain: 2, snowIn: 0, coldest: 41 }] };
    return { updated: new Date().toISOString(), daysAhead: 7, ranking, outlook, season, ledger: { done: 110, total: 110, ready: true, from: 2022 }, games: games.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff)) };
  }

  // Sample stats for the preview
  function demoStats(g) {
    const pre = !g.live && !g.final;
    const P = { BUF: ['Josh Allen', 'James Cook', 'Khalil Shakir'], NYJ: ['Justin Fields', 'Breece Hall', 'Garrett Wilson'], CIN: ['Joe Burrow', 'Chase Brown', "Ja'Marr Chase"],
      CLE: ['Shedeur Sanders', 'Quinshon Judkins', 'Jerry Jeudy'], CHI: ['Caleb Williams', "D'Andre Swift", 'DJ Moore'], TB: ['Baker Mayfield', 'Bucky Irving', 'Mike Evans'] };
    const teamLeaders = abbr => {
      const n = P[abbr] || ['Starting QB', 'Lead RB', 'Top WR'];
      return pre
        ? [{ team: abbr, cat: 'Passing Yards', name: n[0], line: '2,104 YDS, 15 TD, 5 INT' }, { team: abbr, cat: 'Rushing Yards', name: n[1], line: '612 YDS, 5 TD' }, { team: abbr, cat: 'Receiving Yards', name: n[2], line: '701 YDS, 4 TD' }]
        : [{ team: abbr, cat: 'Passing Yards', name: n[0], line: '15/24, 168 YDS, 1 TD' }, { team: abbr, cat: 'Rushing Yards', name: n[1], line: '14 CAR, 71 YDS' }, { team: abbr, cat: 'Receiving Yards', name: n[2], line: '5 REC, 62 YDS' }];
    };
    const st = (ty, py, ry, to, top) => ({ totalYards: { label: 'Total yards', value: ty }, netPassingYards: { label: 'Passing', value: py }, rushingYards: { label: 'Rushing', value: ry }, turnovers: { label: 'Turnovers', value: to }, possessionTime: { label: 'Possession', value: top } });
    return {
      state: g.live ? 'in' : g.final ? 'post' : 'pre',
      teams: [{ abbr: g.away.abbr, record: [{ type: 'total', summary: '6-3' }], lines: g.lines?.away || [3, 7, 3] }, { abbr: g.home.abbr, record: [{ type: 'total', summary: '7-2' }], lines: g.lines?.home || [7, 7, 3] }],
      leaders: [...teamLeaders(g.away.abbr), ...teamLeaders(g.home.abbr)],
      scoringPlays: pre ? [] : [
        { q: 1, clock: '6:12', team: g.home.abbr, kind: 'Field Goal', text: '38 yard field goal', away: 0, home: 3 },
        { q: 2, clock: '10:40', team: g.away.abbr, kind: 'Touchdown', text: '12 yard pass, kick good', away: 7, home: 3 },
        { q: 2, clock: '0:35', team: g.home.abbr, kind: 'Touchdown', text: '3 yard run in the snow, kick good', away: 7, home: 10 },
        { q: 3, clock: '7:02', team: g.away.abbr, kind: 'Field Goal', text: '29 yard field goal', away: 10, home: 10 },
        { q: 4, clock: '4:18', team: g.home.abbr, kind: 'Touchdown', text: '1 yard run, kick good', away: 10, home: 17 }].filter(p => g.final || p.q <= 3),
      teamStats: pre ? [] : [{ abbr: g.away.abbr, stats: st('248', '161', '87', '1', '21:04') }, { abbr: g.home.abbr, stats: st('301', '178', '123', '0', '23:41') }],
      kicks: pre ? [] : [{ team: g.home.abbr, yd: 38, made: true, q: 1, clock: '6:12' }, { team: g.away.abbr, yd: 47, made: false, q: 2, clock: '4:01' }, { team: g.away.abbr, yd: 29, made: true, q: 3, clock: '7:02' }],
      nws: g.roof === 'dome' || g.final ? null : {
        office: 'BUF',
        alerts: g.id === 'd1' ? [{ event: 'Lake Effect Snow Warning', snowy: true, severity: 'Moderate', starts: new Date().toISOString(), ends: new Date(Date.now() + 5 * 86400000).toISOString(), text: '* WHAT...Lake effect snow. Additional snow accumulations of 1 to 2 feet in the most persistent bands.\n* WHERE...Southern Erie County, including Orchard Park.\n* WHEN...From Saturday evening through Monday morning.', from: 'NWS Buffalo NY' }] : [],
        discussion: g.level > 0 ? { office: 'BUF', issued: new Date(Date.now() - 2 * 3600000).toISOString(), title: 'Key Messages', summary: ['- A long duration lake effect snow event begins Saturday night, with the heaviest snow south of Buffalo.', '- Travel will become very difficult in the most persistent bands. Snowfall rates of 2 to 3 inches per hour are possible.'], mentions: [{ section: 'Short Term', text: 'Lake effect snow will organize into a single intense band over the Buffalo Southtowns by Sunday morning.' }, { section: 'Long Term', text: 'The band should drift north toward the city Sunday afternoon before weakening Sunday night.' }], url: 'https://forecast.weather.gov/product.php?site=NWS&issuedby=BUF&product=AFD' } : null
      },
      records: (() => {
        const side = (t, rating, home, reasons, cats, best) => ({ abbr: t.abbr, home, rating, reasons, cats, best, games: 60 });
        const cats = g.roof === 'dome' ? [] : g.level > 0 ? ['snow', 'freezing'] : (g.wx?.gustMph || 0) >= 30 ? ['freezing', 'wind'] : g.wx?.rainHours ? ['rain'] : [];
        return { cats, from: 2022, ready: true, progress: { done: 110, total: 110, ready: true },
          flag: g.away.abbr === 'MIA' || g.away.abbr === 'MIN' ? { abbr: g.away.abbr, kind: g.away.abbr === 'MIA' ? 'warm' : 'dome' } : null,
          away: side(g.away, cats.length ? 41 : null, 'mild', cats.length ? ['3-6 in snow games since 2022', 'Pass-heavy (63% passes)'] : [], { snow: [3, 6, 0], freezing: [5, 8, 0], wind: [9, 10, 0], rain: [6, 4, 0] }, { snow: { us: 13, them: 20, home: false, opp: g.home.abbr, t: '2024-12-15T18:00Z', sn: 1.4, kf: 27, gu: 25, rn: 0 } }),
          home: side(g.home, cats.length ? 82 : null, 'cold', cats.length ? ['9-2 in snow games since 2022', 'Runs the ball a lot (47% of plays)', 'Plays its home games outside in the cold'] : [], { snow: [9, 2, 0], freezing: [14, 4, 0], frigid: [4, 0, 0], wind: [12, 7, 0], rain: [5, 3, 0] }, { snow: { us: 31, them: 10, home: true, opp: 'MIA', t: '2025-12-21T18:00Z', sn: 2.3, kf: 24, gu: 30, rn: 0 } }) };
      })(),
      box: !g.final ? null : { venue: g.venue.name, forecast: { snowIn: 0.6, lowF: 30, windAvgMph: 12, gustMph: 24 }, actual: { kickF: 31, lowF: 28, highF: 31, feelsLowF: 17, snowIn: 1.1, rainIn: 0, windAvgMph: 14, gustMph: 29, visYd: 640 }, grade: { letter: 'B', pts: 81 },
        kicks: [{ team: g.home.abbr, yd: 38, made: true, q: 1, clock: '6:12', w: 13, g: 22, d: 260, f: 31, snow: true }, { team: g.away.abbr, yd: 47, made: false, q: 2, clock: '4:01', w: 15, g: 29, d: 255, f: 30, snow: true }, { team: g.away.abbr, yd: 29, made: true, q: 3, clock: '7:02', w: 14, g: 27, d: 250, f: 29, snow: true }] }
    };
  }

  // ---------- Full-screen game view ----------
  const C1 = '#3987E5';   // chart series 1 (blue)  — validated pair for the dark surface
  const C2 = '#C98500';   // chart series 2 (yellow)

  // =====================================================================================
  // ---------- The phone feels like the stadium: the screen reacts to the game's real weather ----------
  // Gusts push the cards sideways, cold fogs the glass (wipe it with your finger), rain beads and runs
  // down the screen, the phone buzzes with each gust and rumbles with thunder.
  function feelConds(g) {
    if (!g || g.roof === 'dome' || (!g.wx && !g.liveWx)) return null;
    const lw = g.live && g.liveWx, w = g.wx || {}, S = weatherOf(g).spec;
    const hr = (w.timeline || []).find(h => h.inGame) || {};
    return {
      live: !!lw,
      F: lw ? lw.f : Math.round(((w.lowF ?? 50) + (w.highF ?? w.lowF ?? 50)) / 2),
      fl: lw ? lw.fl : w.feelsLowF ?? w.lowF ?? 50,
      wind: lw ? lw.w : w.windAvgMph ?? hr.w ?? 0,
      gust: lw ? lw.g : w.gustMph ?? hr.g ?? 0,
      dir: lw ? lw.d : w.windDir ?? hr.d ?? null,
      snowRate: lw ? Blizzard.rateOf(g) : (S.snow || 0) * 0.5,
      rain: S.rain || 0, thunder: S.thunder || 0, S
    };
  }
  const Haptics = (() => {
    const can = () => 'vibrate' in navigator && store.get('haptics', true) && document.visibilityState === 'visible';
    return {
      gust(k) { if (can()) navigator.vibrate(k > 0.6 ? [30, 40, 55, 30, 25] : k > 0.3 ? [25, 35, 35] : [18]); },
      thunder() { if (can()) navigator.vibrate([70, 50, 140, 60, 260, 80, 120]); },
      bingo() { if (can()) navigator.vibrate([40, 50, 40, 50, 120]); }
    };
  })();

  const Feel = (() => {
    const cv = document.createElement('canvas');
    cv.className = 'glass'; cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    let g = null, c = null, raf = null, nextGust = 0, fogDensity = 0, beads = [], lastT = 0, extraSnow = 0, snowBase = 0, lastBank = 0;
    // the fog is a small mask that's scaled up, so wiping stays cheap
    const fog = document.createElement('canvas'), fctx = fog.getContext('2d');
    const FS = 0.25;
    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      fog.width = Math.ceil(innerWidth * FS); fog.height = Math.ceil(innerHeight * FS);
    }
    addEventListener('resize', () => { if (g) size(); });
    function start(game) {
      stop();
      c = feelConds(game);
      if (!c || REDUCED) return;
      g = game; size();
      fogDensity = 0; beads = []; extraSnow = 0; snowBase = game.live && game.liveWx ? game.liveWx.snowSoFarIn : 0;
      fctx.clearRect(0, 0, fog.width, fog.height);
      nextGust = performance.now() + 2500;
      cv.classList.add('on');
      raf = requestAnimationFrame(loop);
    }
    function update(game) { if (g && game && game.id === g.id) { g = game; c = feelConds(game); } }
    function stop() { cancelAnimationFrame(raf); raf = null; g = null; c = null; cv.classList.remove('on'); ctx.clearRect(0, 0, cv.width, cv.height); }
    // wipe the fog with a finger (works while scrolling, too)
    const wipe = (x, y) => {
      if (!g || fogDensity < 0.05) return;
      fctx.save(); fctx.globalCompositeOperation = 'destination-out';
      const r = 26 * FS * 1.6, gr = fctx.createRadialGradient(x * FS, y * FS, 0, x * FS, y * FS, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      fctx.fillStyle = gr; fctx.beginPath(); fctx.arc(x * FS, y * FS, r, 0, 6.283); fctx.fill(); fctx.restore();
      // clearing the glass knocks beads loose
      for (const b of beads) if (Math.hypot(b.x - x, b.y - y) < 40) b.vy = Math.max(b.vy, 3);
    };
    addEventListener('touchmove', e => { for (const t of e.touches) wipe(t.clientX, t.clientY); }, { passive: true });
    addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && e.buttons) wipe(e.clientX, e.clientY); }, { passive: true });

    function gustNow(now) {
      const k = Math.max(0.15, Math.min(1, (c.gust - 10) / 30));
      const dirX = c.dir == null ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(Math.sin((c.dir + 180) * Math.PI / 180)) || 1;
      const root = GameView.isOpen() ? document.querySelectorAll('#gv-body > section, #gv-body > .gv-group > section, #gv-body > p, #gv-body > div:not(.gv-jump)') : document.querySelectorAll('main > section, main > .report-btn');
      let i = 0;
      for (const el of root) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) continue;   // only what's on screen
        const dx = dirX * (3 + k * 13) * (0.7 + Math.random() * 0.5);
        el.animate([{ transform: 'translateX(0) rotate(0)' }, { transform: `translateX(${dx}px) rotate(${dirX * k * 0.5}deg)` }, { transform: `translateX(${-dx * 0.25}px)` }, { transform: 'translateX(0) rotate(0)' }],
          { duration: 700 + k * 600, delay: i * 45, easing: 'cubic-bezier(.3,.6,.3,1)' });
        if (++i > 8) break;
      }
      Haptics.gust(k);
      if (Sound.on() && k > 0.35) Sound.whoosh();
      Soundscape.gust(k);
      // snow blown across the glass with the gust
      if (c.snowRate > 0.05) Snow.burst();
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (!g || document.visibilityState !== 'visible') return;
      const dt = Math.min(0.1, (now - lastT) / 1000 || 0); lastT = now;
      const W = innerWidth, H = innerHeight, dpr = cv.width / W;
      // gusts come more often the gustier it is
      if (c.gust >= 15 && now > nextGust) { gustNow(now); nextGust = now + (3500 + Math.random() * 9000) / (1 + (c.gust - 15) / 18); }
      // cold fogs the glass, slowly, up to a point; wiped areas fog back over
      const target = c.F <= 40 ? Math.min(0.55, (40 - c.F) / 45 + 0.12) : 0;
      if (target > 0) { fctx.globalCompositeOperation = 'source-over'; fctx.fillStyle = `rgba(255,255,255,${dt * 0.12})`; fctx.fillRect(0, 0, fog.width, fog.height); }
      fogDensity += (target - fogDensity) * dt * 0.35;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      if (fogDensity > 0.02) {
        ctx.globalAlpha = fogDensity; ctx.imageSmoothingEnabled = true;
        ctx.drawImage(fog, 0, 0, cv.width, cv.height);
        ctx.globalAlpha = 1;
      }
      // rain beads on the glass: they grow, then run down and leave a clear streak
      if (c.rain > 0.1 && beads.length < 26 + c.rain * 50 && Math.random() < dt * (2 + c.rain * 10)) beads.push({ x: Math.random() * W, y: Math.random() * H * 0.95, r: 1.5 + Math.random() * 3, vy: 0, grow: Math.random() * 0.6 });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = beads.length - 1; i >= 0; i--) {
        const b = beads[i];
        b.r = Math.min(7, b.r + b.grow * dt);
        if (b.r > 4.5 && b.vy === 0 && Math.random() < dt * 0.4) b.vy = 1;
        if (b.vy) { b.vy = Math.min(140, b.vy + dt * 220); b.y += b.vy * dt; b.x += Math.sin(b.y / 30) * 0.3; b.r -= dt * 0.25; if (fogDensity > 0.02) wipe(b.x, b.y); }
        if (b.y > H + 10 || b.r < 1) { beads.splice(i, 1); continue; }
        const gr = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
        gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.45, 'rgba(200,220,240,0.18)'); gr.addColorStop(0.85, 'rgba(20,30,45,0.35)'); gr.addColorStop(1, 'rgba(20,30,45,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r, b.r * (b.vy ? 1.25 : 1), 0, 0, 6.283); ctx.fill();
      }
      // snow keeps piling up along the bottom while you watch
      if (c.snowRate > 0.02 && now - lastBank > 4000) {
        lastBank = now; extraSnow += c.snowRate * (4 / 3600) * 40;   // exaggerated so you can see it build
        if (GameView.isOpen()) SnowBank.set(Math.min(14, (g.live && g.liveWx ? g.liveWx.snowSoFarIn : snowBase || (g.wx?.snowIn || 0)) + extraSnow));
      }
    }
    return { start, stop, update, thunder: () => Haptics.thunder() };
  })();

  // ---------- Snow in your room: the camera, with the stadium's weather falling over it ----------
  const RoomCam = (() => {
    let stream = null, raf = null, sky = null, box = null, cur = null;
    const label = g => { const s = weatherOf(g).spec; return s.snow ? 'Snow' : s.rain || s.thunder ? 'Rain' : s.hail ? 'Hail' : s.fog ? 'Fog' : 'Weather'; };
    const button = g => g.roof === 'dome' || (!g.wx && !g.liveWx) ? '' : `<button class="secondary roomcam-btn" id="roomcam-btn">${label(g)} in my room</button>`;
    async function open(g) {
      close();
      cur = g;
      box = document.createElement('div'); box.className = 'roomcam';
      const c = feelConds(g) || {};
      const live = g.live && g.liveWx;
      const what = live ? `${snowingLive(g) ? `${Blizzard.rateOf(g).toFixed(2)}″ an hour` : condition(live.c, live.snowNow).text.toLowerCase()}, ${live.f}°, wind ${live.w} mph${live.d != null ? ` from the ${compass(live.d)}` : ''}` : `${weatherOf(g).label.toLowerCase()} in the forecast, ${g.wx.lowF}°, wind ${g.wx.windAvgMph ?? g.wx.windMph} mph`;
      box.innerHTML = `<video playsinline muted autoplay></video><canvas></canvas>
        <div class="rc-top"><b>${esc(g.venue.name)}${live ? ' · live' : ''}</b><span>${esc(what)}</span></div>
        <p class="rc-msg" hidden></p>
        <div class="rc-bar"><button class="secondary" data-rc="shot">Snapshot</button><button class="primary" data-rc="close">Done</button></div>`;
      document.body.appendChild(box);
      box.addEventListener('click', e => { const b = e.target.closest('[data-rc]'); if (!b) return; if (b.dataset.rc === 'close') close(); else snapshot(); });
      const video = box.querySelector('video'), cv = box.querySelector('canvas'), ctx = cv.getContext('2d');
      // the weather at the stadium's real rate
      const spec = { ...weatherOf(g).spec, sun: 0, cloud: 0, fog: Math.min(0.4, weatherOf(g).spec.fog || 0), frigid: 0, heat: 0 };
      sky = makeSky(spec, { lens: true, frostEdges: (c.F ?? 50) <= 25, onThunder: () => { Sound.thunder(); Haptics.thunder(); } });
      if (live && snowingLive(g)) sky.override(Math.round(140 + Blizzard.rateOf(g) * 500), live.g || live.w);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = stream;
      } catch (e) {
        const m = box.querySelector('.rc-msg'); m.hidden = false;
        m.textContent = "The camera isn't available, so here's the weather on its own. To see it over your room, allow camera access for this app in your phone's settings.";
      }
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const loop = t => {
        raf = requestAnimationFrame(loop);
        if (cv.width !== innerWidth * dpr) { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
        sky.step(ctx, cv.width, cv.height, t, dpr);
      };
      raf = requestAnimationFrame(loop);
      Sound.weatherStart(spec);
    }
    // save the camera frame with the weather on top
    function snapshot() {
      if (!box) return;
      const video = box.querySelector('video'), cv = box.querySelector('canvas');
      const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
      const o = out.getContext('2d');
      o.fillStyle = '#0B1626'; o.fillRect(0, 0, out.width, out.height);
      if (video.videoWidth) {
        const s = Math.max(out.width / video.videoWidth, out.height / video.videoHeight), w = video.videoWidth * s, h = video.videoHeight * s;
        o.drawImage(video, (out.width - w) / 2, (out.height - h) / 2, w, h);
      }
      o.drawImage(cv, 0, 0);
      const k = out.width / 400;
      o.fillStyle = 'rgba(5,10,18,0.7)'; o.fillRect(0, out.height - 56 * k, out.width, 56 * k);
      o.fillStyle = '#fff'; o.font = `800 ${18 * k}px ${Arena.cssVar('--display', 'sans-serif')}`; o.fillText(`${cur.away.abbr} at ${cur.home.abbr} weather, in my room`, 14 * k, out.height - 30 * k);
      o.font = `600 ${12 * k}px sans-serif`; o.fillText('Snow Game Radar', 14 * k, out.height - 12 * k);
      out.toBlob(async blob => {
        const file = new File([blob], 'snow-in-my-room.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Snow in my room' }); return; } catch (e) { /* fall through */ } }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      });
      Sound.crunch();
    }
    function close() {
      cancelAnimationFrame(raf); raf = null;
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (box) { box.remove(); box = null; Sound.weatherStop(); }
    }
    return { button, open, close };
  })();

  // ---------- Compared to you: your weather right now vs. the stadium's ----------
  const Compare = (() => {
    let mine = null;
    const section = g => g.roof === 'dome' || (!g.wx && !g.liveWx) ? '' : `<section class="gv-chart cmp" id="gv-cmp"><h3>Compared to you</h3><div id="cmp-body">${store.get('myloc', null) ? '<p class="gv-sub">Checking your weather…</p>' : `<p class="gv-sub">See how the weather at ${esc(g.venue.name)} stacks up against yours. Your location is used once to check your weather and stays on this phone.</p><button class="secondary" id="cmp-go">Compare with my weather</button>`}</div></section>`;
    async function here() {
      const loc = store.get('myloc', null); if (!loc) return null;
      if (mine && Date.now() - mine.at < 15 * 60000) return mine;
      if (DEMO) return (mine = { at: Date.now(), f: 44, fl: 40, w: 7, c: 3, snow: 0, rain: 0, lat: loc.lat, lon: loc.lon });
      const r = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code,snowfall,rain&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`)).json();
      const c = r.current || {};
      return (mine = { at: Date.now(), f: Math.round(c.temperature_2m), fl: Math.round(c.apparent_temperature), w: Math.round(c.wind_speed_10m || 0), c: c.weather_code, snow: c.snowfall || 0, rain: c.rain || 0, lat: loc.lat, lon: loc.lon });
    }
    const miles = (a, b, c2, d) => { const R = 3959, t = x => x * Math.PI / 180, dl = t(c2 - a), dn = t(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c2)) * Math.sin(dn / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h))); };
    async function fill(g) {
      const box = document.getElementById('cmp-body'); if (!box) return;
      let m;
      try { m = await here(); } catch (e) { m = null; }
      if (!document.getElementById('cmp-body')) return;
      if (!m) { if (store.get('myloc', null)) box.innerHTML = `<p class="gv-sub">Couldn't get your weather right now.</p>`; return; }
      const lw = g.live && g.liveWx, w = g.wx || {}, k = w.hours?.[0] || {};
      const s = lw ? { f: lw.f, fl: lw.fl, w: lw.w, snow: lw.lastHourIn || 0, when: 'right now' } : { f: k.f ?? w.lowF, fl: w.feelsLowF ?? w.lowF, w: w.windAvgMph ?? w.windMph ?? 0, snow: (w.snowIn || 0) / 4, when: 'at kickoff' };
      const d = s.f - m.f, dfl = s.fl - m.fl, dist = g.venue?.lat != null ? miles(m.lat, m.lon, g.venue.lat, g.venue.lon) : null;
      const lines = [];
      if (Math.abs(d) <= 2) lines.push(`About the same temperature as where you are.`);
      else lines.push(`<b>${Math.abs(d)}° ${d < 0 ? 'colder' : 'warmer'}</b> than where you are${Math.abs(dfl - d) >= 5 ? `, and it feels ${Math.abs(dfl)}° ${dfl < 0 ? 'colder' : 'warmer'} with the wind` : ''}.`);
      // the fun part: what it's like, in things you have at home
      if (s.fl <= 0) lines.push(`That's a chest freezer. Climb in for three and a half hours to get the full experience.`);
      else if (s.fl <= 10) lines.push(`Colder than your freezer door left open. Stand in front of it for the whole game.`);
      else if (s.fl <= 37 && d < -8) lines.push(`Colder than the inside of your fridge (about 37°). Bring a lawn chair.`);
      if (s.w >= 15) lines.push(`For the wind, hold your head out of a car window going ${s.w} mph${d < -10 ? ', with the AC on' : ''}.`);
      if (s.snow >= 0.1) { const m = Math.max(5, Math.round(60 / Math.max(0.05, s.snow))), hh = Math.floor(m / 60), mm = m % 60; lines.push(`At this rate, your driveway would get a fresh inch every ${hh ? `${hh} hour${hh > 1 ? 's' : ''}${mm ? ` and ${mm} minutes` : ''}` : `${mm} minutes`}.`); }
      if (d > 8) lines.push(`Lucky them. Warmer there than here.`);
      box.innerHTML = `<div class="cmp-row"><div class="cmp-side"><small>You</small><b>${m.f}°</b><span>${esc(condition(m.c, m.snow).text)}, wind ${m.w}</span></div>
          <div class="cmp-vs">vs</div>
          <div class="cmp-side stadium"><small>${esc(g.venue.name)} ${s.when}</small><b>${s.f}°</b><span>feels ${s.fl}°, wind ${s.w}</span></div></div>
        <ul class="cmp-lines">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
        ${dist != null ? `<p class="gv-sub">You're about ${dist.toLocaleString()} miles from ${esc(g.venue.name)}. <button class="text-btn" id="cmp-forget">Forget my location</button></p>` : ''}`;
    }
    function mount(g) {
      const root = document.getElementById('gv-cmp'); if (!root) return;
      root.addEventListener('click', e => {
        if (e.target.closest('#cmp-go')) {
          if (!navigator.geolocation) { document.getElementById('cmp-body').innerHTML = `<p class="gv-sub">This browser can't share your location.</p>`; return; }
          document.getElementById('cmp-body').innerHTML = `<p class="gv-sub">Finding your weather…</p>`;
          navigator.geolocation.getCurrentPosition(p => { store.set('myloc', { lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }); mine = null; fill(g); },
            () => { document.getElementById('cmp-body').innerHTML = `<p class="gv-sub">Location wasn't shared, so there's nothing to compare. You can allow it any time in your phone's settings.</p>`; }, { maximumAge: 3600000, timeout: 12000, enableHighAccuracy: false });
        }
        if (e.target.closest('#cmp-forget')) { store.set('myloc', null); mine = null; root.outerHTML = section(g); mount(g); toast('Location forgotten'); }
      });
      if (store.get('myloc', null)) fill(g);
    }
    return { section, mount, fill };
  })();

  // =====================================================================================
  // ---------- Snow Game Bingo ----------
  // A card of weather moments for each game. Some squares mark themselves from the live data;
  // the rest you tap when you see them on TV. Five in a row is a Bingo.
  const Bingo = (() => {
    // auto squares: checked against the live game; tags say which kind of game they belong in
    const AUTO = [
      { k: 'freeze', t: 'Below freezing', tags: ['snow', 'cold'], test: x => x.lw && x.lw.f <= 32 },
      { k: 'falling', t: 'Snow is falling', tags: ['snow'], test: x => x.lw && (x.lw.snowNow > 0 || x.lw.lastHourIn > 0) },
      { k: 'inch', t: 'An inch on the ground', tags: ['snow'], test: x => x.lw && x.lw.snowSoFarIn >= 1 },
      { k: 'heavy', t: 'Half an inch in an hour', tags: ['snow'], test: x => x.lw && x.lw.lastHourIn >= 0.5 },
      { k: 'gust', t: 'Gusts over 25 mph', tags: ['wind', 'snow', 'cold', 'rain'], test: x => x.lw && x.lw.g >= 25 },
      { k: 'chill', t: 'Wind chill in single digits', tags: ['cold', 'snow'], test: x => x.lw && x.lw.fl <= 9 },
      { k: 'vis', t: 'Can\'t see 300 yards', tags: ['snow', 'fog', 'rain'], test: x => x.lw && x.lw.vis != null && x.lw.vis < 300 },
      { k: 'drop', t: 'Temp drops 5° since kickoff', tags: ['cold', 'snow', 'wind'], test: x => x.lw && x.st.t0 != null && x.st.t0 - x.lw.f >= 5 },
      { k: 'snowtd', t: 'Touchdown in the snow', tags: ['snow'], test: x => x.st.snowAt && (x.d?.scoringPlays || []).some(p => /touchdown/i.test(p.kind) && (!p.wall || Date.parse(p.wall) >= x.st.snowAt)) },
      { k: 'fg', t: 'A field goal is good', tags: ['any'], test: x => (x.d?.kicks || []).some(k => k.made) || (x.d?.scoringPlays || []).some(p => /field goal/i.test(p.kind)) },
      { k: 'miss', t: 'A field goal misses', tags: ['wind', 'snow', 'rain', 'cold'], test: x => (x.d?.kicks || []).some(k => !k.made) },
      { k: 'lead', t: 'Lead change', tags: ['any'], test: x => { let lead = 0, n = 0; for (const p of x.d?.scoringPlays || []) { const l = Math.sign((p.home ?? 0) - (p.away ?? 0)); if (l && lead && l !== lead) n++; if (l) lead = l; } return n > 0; } },
      { k: 'storm', t: 'Thunder at the stadium', tags: ['rain'], test: x => x.lw && [95, 96, 99].includes(x.lw.c) },
      { k: 'rain', t: 'Rain is falling', tags: ['rain'], test: x => x.lw && ((x.lw.c >= 51 && x.lw.c <= 67) || (x.lw.c >= 80 && x.lw.c <= 82)) },
      { k: 'switch', t: 'Rain turns to snow', tags: ['snow', 'rain'], test: x => x.st.sawRain && x.lw && SNOW_CODES_UI.includes(x.lw.c) }
    ];
    // squares you mark yourself
    const MANUAL = [
      { k: 'slip', t: 'A player slips on a cut', tags: ['snow', 'rain', 'cold'] }, { k: 'breath', t: 'Breath clouds on the sideline', tags: ['cold', 'snow'] },
      { k: 'heaters', t: 'Sideline heaters glowing', tags: ['cold', 'snow'] }, { k: 'plow', t: 'Crew clears a yard line', tags: ['snow'] },
      { k: 'angel', t: 'Snow angel celebration', tags: ['snow'] }, { k: 'shirtless', t: 'Shirtless fans in the stands', tags: ['cold', 'snow'] },
      { k: 'skid', t: 'The ball skids on the field', tags: ['snow', 'rain'] }, { k: 'pouch', t: 'QB with a hand warmer pouch', tags: ['cold', 'snow'] },
      { k: 'talk', t: 'Broadcast talks about the weather', tags: ['any'] }, { k: 'towel', t: 'Towel on a player\'s head', tags: ['rain', 'snow', 'cold'] },
      { k: 'punt', t: 'Wind knocks down a punt', tags: ['wind'] }, { k: 'spot', t: 'Kicker clears snow off his spot', tags: ['snow'] },
      { k: 'fumble', t: 'Fumble in the slop', tags: ['snow', 'rain'] }, { k: 'parka', t: 'Head coach in a parka', tags: ['cold', 'snow'] },
      { k: 'snowball', t: 'Snowball in the stands', tags: ['snow'] }, { k: 'mud', t: 'Muddy jerseys', tags: ['rain'] },
      { k: 'poncho', t: 'Ponchos in the stands', tags: ['rain'] }, { k: 'wipe', t: 'A camera lens gets wiped', tags: ['rain', 'snow'] },
      { k: 'flag', t: 'Flags standing straight out', tags: ['wind'] }, { k: 'sleeves', t: 'A lineman in short sleeves', tags: ['cold', 'snow'] },
      { k: 'drop', t: 'A dropped pass, blamed on the weather', tags: ['any'] }, { k: 'run', t: 'Three runs in a row', tags: ['any'] },
      { k: 'blimp', t: 'An overhead shot of the weather', tags: ['any'] }, { k: 'tarp', t: 'A tarp or blower on the sideline', tags: ['rain', 'snow'] },
      { k: 'hood', t: 'Players in hoods on the bench', tags: ['cold', 'snow'] }, { k: 'redzone', t: 'A red zone trip ends in a field goal', tags: ['any'] }
    ];
    const kinds = g => { const s = weatherOf(g).spec, w = g.wx || {}, out = ['any']; if (g.level > 0 || s.snow) out.push('snow'); if ((w.lowF ?? 60) <= 35) out.push('cold'); if ((w.gustMph || 0) >= 22 || s.wind >= 0.45) out.push('wind'); if (s.rain || s.thunder) out.push('rain'); if (s.fog) out.push('fog'); return out; };
    const has = g => g.roof !== 'dome' && !!g.wx && (g.level > 0 || weatherScore(g) >= 1 || (g.wx.lowF ?? 60) <= 35 || (g.wx.gustMph || 0) >= 22 || g.live);
    const seedRnd = s => () => (s = (s * 9301 + 49297) % 233280) / 233280;
    function card(g) {
      const key = 'bingo:' + g.id, saved = store.get(key, null);
      if (saved?.cells?.length === 25) return saved;
      const ks = kinds(g), r = seedRnd(hashSeed(String(g.id)));
      const pick = (list, n) => { const ok = list.filter(x => x.tags.some(t => ks.includes(t))); const a = [...ok].sort(() => r() - 0.5); return a.slice(0, n); };
      const auto = pick(AUTO, 9).map(x => ({ k: 'a:' + x.k, t: x.t, auto: true }));
      const man = pick(MANUAL, 24 - auto.length).map(x => ({ k: 'm:' + x.k, t: x.t }));
      const all = [...auto, ...man].sort(() => r() - 0.5).slice(0, 24);
      while (all.length < 24) all.push({ k: 'm:filler' + all.length, t: 'A big hit in the cold' });
      all.splice(12, 0, { k: 'free', t: 'Free space', free: true });
      const c = { cells: all, marks: [12], lines: 0, st: {} };
      store.set(key, c);
      return c;
    }
    const hashSeed = s => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 233280; return h || 11; };
    const LINES = (() => { const L = []; for (let i = 0; i < 5; i++) { L.push([0, 1, 2, 3, 4].map(j => i * 5 + j)); L.push([0, 1, 2, 3, 4].map(j => j * 5 + i)); } L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]); return L; })();
    const countLines = marks => LINES.filter(l => l.every(i => marks.includes(i))).length;

    function section(g) {
      if (!has(g)) return '';
      return `<section class="gv-chart bingo" id="gv-bingo">${render(g)}</section>`;
    }
    function render(g) {
      const c = card(g), live = g.live, done = g.final;
      const lines = countLines(c.marks);
      const head = live ? `<span class="live-dot">Live</span> Tap a square when you see it on TV. Squares with a ⚡ mark themselves from the live weather and scoring.`
        : done ? `Final card: ${lines ? `${lines} Bingo${lines > 1 ? 's' : ''}!` : 'no Bingo this time.'}` : 'Your card for this game. It goes live at kickoff. Squares with a ⚡ mark themselves from the live weather and scoring.';
      return `<h3>Snow Game Bingo</h3><p class="gv-sub">${head}</p>
        <div class="bg-grid${live ? ' live' : ''}" role="grid" aria-label="Bingo card">${c.cells.map((x, i) => `<button class="bg-cell${c.marks.includes(i) ? ' on' : ''}${x.auto ? ' auto' : ''}${x.free ? ' free' : ''}" data-cell="${i}" role="gridcell" aria-pressed="${c.marks.includes(i)}"${!live || x.auto || x.free ? ' tabindex="-1"' : ''}>${x.auto ? '<i aria-hidden="true">⚡</i>' : ''}<span>${esc(x.t)}</span></button>`).join('')}</div>
        <div class="bg-foot"><span>${lines ? `<b>${lines}</b> Bingo${lines > 1 ? 's' : ''}` : `${c.marks.length - 1} of 24 marked`}</span>${c.marks.length > 1 ? '<button class="text-btn" id="bg-share">Share my card</button>' : ''}</div>`;
    }
    function mount(g) {
      const root = document.getElementById('gv-bingo'); if (!root) return;
      root.addEventListener('click', e => {
        if (e.target.closest('#bg-share')) return share(g);
        const b = e.target.closest('[data-cell]'); if (!b) return;
        const cur = state.data.games.find(x => String(x.id) === String(g.id)) || g;
        const c = card(cur), i = +b.dataset.cell, x = c.cells[i];
        if (x.free) return;
        if (x.auto) return toast('This one marks itself when it happens.');
        if (!cur.live) return toast(cur.final ? 'This game is over.' : 'The card goes live at kickoff.');
        c.marks = c.marks.includes(i) ? c.marks.filter(m => m !== i) : [...c.marks, i];
        Sound.crunch();
        save(cur, c);
      });
    }
    function save(g, c) {
      const before = c.lines || 0, now = countLines(c.marks);
      c.lines = Math.max(before, now);
      store.set('bingo:' + g.id, c);
      if (now > before) celebrate(g, now, c.marks.length === 25);
      const root = document.getElementById('gv-bingo'); if (root) root.innerHTML = render(g);
    }
    // squares that mark themselves: called whenever new live data arrives
    function update(g, d) {
      if (!has(g) || !g.live) { const root = document.getElementById('gv-bingo'); if (root && d) root.innerHTML = render(g); return; }
      const c = card(g), lw = g.liveWx, st = c.st || (c.st = {});
      if (lw) { if (st.t0 == null) st.t0 = lw.f; if (!st.snowAt && (lw.snowNow > 0 || lw.lastHourIn > 0)) st.snowAt = Date.now(); if ((lw.c >= 51 && lw.c <= 67) || (lw.c >= 80 && lw.c <= 82)) st.sawRain = true; }
      const ctx = { lw, d, st };
      let changed = false;
      c.cells.forEach((x, i) => { if (!x.auto || c.marks.includes(i)) return; const def = AUTO.find(a => 'a:' + a.k === x.k); if (def && def.test(ctx)) { c.marks.push(i); changed = true; } });
      if (changed) { toast('Bingo square marked from the live game'); save(g, c); }
      else { store.set('bingo:' + g.id, c); const root = document.getElementById('gv-bingo'); if (root) root.innerHTML = render(g); }
    }
    function celebrate(g, n, blackout) {
      const tally = store.get('bingoTally', { games: [], bingos: 0, blackouts: 0 });
      tally.bingos++; if (!tally.games.includes(g.id)) tally.games.push(g.id); if (blackout) tally.blackouts++;
      store.set('bingoTally', tally);
      toast(blackout ? 'BLACKOUT! Every square on the card!' : n > 1 ? `Bingo number ${n}!` : 'BINGO!');
      Sound.jingle(Theme.get()); Haptics.bingo();
      const el = document.createElement('div'); el.className = 'bingo-burst'; el.textContent = blackout ? 'BLACKOUT!' : 'BINGO!'; document.body.appendChild(el); setTimeout(() => el.remove(), 2200);
      if (!REDUCED) for (let i = 0; i < 50; i++) { const s = document.createElement('span'); s.className = 'confetti'; s.style.left = Math.random() * 100 + 'vw'; s.style.setProperty('--c', ['#8FD3FF', '#fff', '#F5B841', '#3DDC84', '#FF5A5F'][i % 5]); s.style.animationDelay = Math.random() * 0.5 + 's'; document.body.appendChild(s); setTimeout(() => s.remove(), 2600); }
    }
    async function share(g) {
      const c = card(g), n = countLines(c.marks);
      const grid = [0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4].map(k => c.marks.includes(r * 5 + k) ? '❄️' : '⬜').join('')).join('\n');
      const text = `Snow Game Bingo: ${g.away.abbr} at ${g.home.abbr}\n${grid}\n${n ? `${n} Bingo${n > 1 ? 's' : ''}!` : `${c.marks.length - 1} of 24 marked`}`;
      try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { return; }
      try { await navigator.clipboard.writeText(text); toast('Card copied. Paste it anywhere.'); } catch (e) { toast("Couldn't share the card."); }
    }
    const tally = () => store.get('bingoTally', { games: [], bingos: 0, blackouts: 0 });
    return { section, mount, update, render, tally, has };
  })();
  const SNOW_CODES_UI = [71, 73, 75, 77, 85, 86];

  const GameView = (() => {
    const view = $('#game-view');
    const body = $('#gv-body');
    let current = null, lastScore = null;

    function open(id, fromHistory) {
      const g = state.data && state.data.games.find(x => String(x.id) === String(id));
      if (!g) return;
      current = g;
      Sound.crunch();
      body.innerHTML = renderGame(g);
      jumpNav();
      view.classList.toggle('is-day', !!g.wx && g.wx.night === false);
      view.classList.toggle('is-snow', g.level > 0 || snowingLive(g));
      body.style.setProperty('--snow', glow(g));
      if (g.level > 0) body.setAttribute('data-snowgame', ''); else body.removeAttribute('data-snowgame');
      capSoon(body);
      Stats.load(g);
      Photo.load(g);
      Passport.stamp(g);
      Kicker.mount(g);
      QB.mount(g);
      if (Theme.field()) Turf.set(turfFor(g));
      view.hidden = false;
      view.scrollTop = 0;
      document.body.classList.add('gv-open');
      if (!fromHistory) history.pushState({ game: g.id }, '', '#game-' + g.id);
      drawCharts(g);
      Intro.play(g);
      FX.start(g);
      Radar.mount(g);
      const snowGame = g.level > 0 || snowingLive(g);
      Frost.set(snowGame, g.level === 2 || snowingLive(g) ? 0.8 : 0.6);
      SnowBank.set(snowingLive(g) ? g.liveWx.snowSoFarIn : snowGame ? g.wx.snowIn : 0);
      SnowBank.snowman(snowingLive(g) ? g.liveWx.snowSoFarIn : 0, g.venue.name);
      if (snowGame) Sound.windStart(g.level === 2 ? 1 : 0.5);
      if (snowingLive(g)) Blizzard.apply(g, 'game');
      else { Blizzard.off(); Soundscape.level(snowGame && g.roof !== 'dome' ? 0.3 + g.level * 0.2 : 0.08); }
      const fc = feelConds(g); Soundscape.wind(fc ? fc.wind : 0);
      Feel.start(g);
      Compare.mount(g);
      Bingo.mount(g);
      body.querySelector('#roomcam-btn')?.addEventListener('click', () => RoomCam.open(state.data.games.find(x => String(x.id) === String(g.id)) || g));
      lastScore = g.score ? g.score.home + g.score.away : null;
      FieldCam.mount(g);
      Replay.mount(g);
      $('#gv-back').focus({ preventScroll: true });
    }

    function close(fromHistory) {
      if (view.hidden) return;
      Intro.stop();
      FX.stop();
      Radar.stop();
      Stats.stop();
      Kicker.stop();
      QB.stop();
      FieldCam.stop();
      Replay.stop();
      Soundscape.stop();
      Sound.windStop();
      Feel.stop();
      RoomCam.close();
      view.hidden = true;
      document.body.classList.remove('gv-open');
      current = null;
      homeWinter();
      if (!fromHistory && location.hash.startsWith('#game-')) history.back();
    }

    // Keep a live game's score and conditions current while you're looking at it
    function refresh() {
      if (!current || !state.data) return;
      const g = state.data.games.find(x => String(x.id) === String(current.id));
      if (!g) return;
      current = g;
      const banner = body.querySelector('.gv-live');
      if (banner && (g.live || g.final)) banner.outerHTML = scoreBanner(g);
      if (g.live && snowingLive(g)) { SnowBank.set(g.liveWx.snowSoFarIn); SnowBank.snowman(g.liveWx.snowSoFarIn, g.venue.name); Blizzard.apply(g, 'game'); FieldCam.refresh(g); }
      Kicker.refresh(g);
      QB.refresh(g);
      FX.check(g);
      Feel.update(g);
      const fc = feelConds(g); if (fc) Soundscape.wind(fc.wind);
      // a real score: the crowd goes up
      const tot = g.score ? g.score.home + g.score.away : null;
      if (lastScore != null && tot != null && tot > lastScore) Soundscape.roar(tot - lastScore >= 6);
      lastScore = tot;
      const mu = body.querySelector('.gv-matchup');
      if (mu && !mu.querySelector('.wordmark') && Wordmarks.url(g.home)) { mu.innerHTML = matchupStack(g, 'lg'); capSoon(body); }
    }

    function liveBanner(g) {
      if (!g.live) return '';
      const lw = g.liveWx;
      return `<div class="gv-live${snowingLive(g) ? ' snowing' : ''}">
        <div class="gv-live-top"><span class="live-dot">Live</span><span>${esc(g.status || 'In progress')}</span></div>
        <div class="gv-live-score"><span>${esc(g.away.name)}</span><b>${g.score?.away ?? '–'}</b><span class="lc-dash">–</span><b>${g.score?.home ?? '–'}</b><span>${esc(g.home.name)}</span></div>
        <div class="gv-live-cond">${esc(liveNow(g, true))}</div>
        ${lw && lw.snowSoFarIn > 0 ? `<div class="gv-live-snow"><b>${inches(lw.snowSoFarIn)}</b> since kickoff, <b>${lw.lastHourIn.toFixed(2)}″</b> in the last hour</div>` : ''}
      </div>`;
    }

    function favButtons(g) {
      return `<div class="fav-row">${[g.away, g.home].filter(Boolean).map(t => `
        <button class="fav-btn${Favs.has(t.abbr) ? ' on' : ''}" data-fav="${esc(t.abbr)}" aria-pressed="${Favs.has(t.abbr)}">${starIcon(Favs.has(t.abbr))}${esc(t.name)}</button>`).join('')}
      </div>`;
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
      if ((w.rainHours || 0) > 0 && w.precipChance >= 40 && g.level === 0) parts.push(`Expect rain, with up to a ${w.precipChance}% chance during the game.`);
      if (w.gustMph >= 25) parts.push(g.level > 0 ? `Gusts up to ${w.gustMph} mph could blow the snow sideways and affect kicking.` : `Gusts up to ${w.gustMph} mph could affect passing and kicking.`);
      if (w.feelsLowF <= 20) parts.push(`It will feel like ${w.feelsLowF}° with the wind.`);
      if (g.roof === 'retractable') parts.push(`${g.venue.name} has a retractable roof, so it may be closed.`);
      return parts.join(' ');
    }

    function stat(value, label) { return `<div class="gv-stat"><b>${value}</b><span>${label}</span></div>`; }

    // The page puts each game's most interesting parts first, based on its weather, and a row of
    // chips under the matchup jumps to any part of the page.
    function arrange(g, parts) {
      const W = weatherOf(g), sp = W.spec, lake = lakeSetup(g);
      const snowy = g.level > 0 || snowingLive(g), windy = (sp.wind || 0) >= 0.45 || (g.wx?.gustMph || 0) >= 25;
      let order;
      if (g.live || g.final) order = snowy ? ['field', 'game', 'play', 'charts', 'stadium'] : ['game', 'play', 'field', 'charts', 'stadium'];
      else if (snowy || lake?.tone === 'aimed') order = ['field', 'play', 'charts', 'game', 'stadium'];
      else if (windy) order = ['play', 'field', 'charts', 'game', 'stadium'];
      else if (sp.rain || sp.thunder || sp.fog || sp.ice || sp.hail || sp.frigid > 0.4) order = ['play', 'charts', 'field', 'game', 'stadium'];
      else order = ['game', 'play', 'stadium', 'charts', 'field'];
      const names = { field: 'Field', play: 'Play', game: 'Game', stadium: 'Stadium', charts: 'Charts' };
      const groups = order.filter(k => (parts[k] || '').trim());
      const chips = `<nav class="gv-jump" id="gv-jump" aria-label="Jump to"><button data-jump="top" class="on">Forecast</button>${groups.map(k => `<button data-jump="${k}">${names[k]}</button>`).join('')}</nav>`;
      return chips + groups.map(k => `<div class="gv-group" id="grp-${k}" data-group="${k}">${parts[k]}</div>`).join('');
    }
    // jump chips: tap to glide to a part of the page; the chip for what's on screen lights up
    let spy = null;
    function jumpNav() {
      const nav = body.querySelector('#gv-jump'); if (!nav) return;
      const bar = view.querySelector('.gv-bar');
      const offset = () => (bar?.offsetHeight || 56) + nav.offsetHeight + 8;
      nav.addEventListener('click', e => {
        const b = e.target.closest('[data-jump]'); if (!b) return;
        const k = b.dataset.jump, el = k === 'top' ? null : body.querySelector('#grp-' + k);
        const y = el ? el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - offset() : 0;
        view.scrollTo({ top: Math.max(0, y), behavior: REDUCED ? 'auto' : 'smooth' });
        Sound.crunch();
      });
      spy?.disconnect();
      const mark = k => { for (const b of nav.querySelectorAll('[data-jump]')) b.classList.toggle('on', b.dataset.jump === k); const on = nav.querySelector('.on'); if (on) nav.scrollTo({ left: on.offsetLeft - 16, behavior: 'smooth' }); };
      const onScroll = () => {
        const line = view.getBoundingClientRect().top + offset() + 30;
        let k = 'top';
        for (const el of body.querySelectorAll('.gv-group')) if (el.getBoundingClientRect().top <= line) k = el.dataset.group;
        if (nav.querySelector('.on')?.dataset.jump !== k) mark(k);
      };
      view.removeEventListener('scroll', view._spy || (() => {}));
      view._spy = () => requestAnimationFrame(onScroll);
      view.addEventListener('scroll', view._spy, { passive: true });
    }
    function renderGame(g) {
      const w = g.wx;
      const verdict = g.roof === 'dome' ? '' : !w ? '' :
        g.level === 2 ? `<p class="gv-verdict likely">${flakeIcon} Snow game likely</p>`
        : g.level === 1 ? `<p class="gv-verdict possible">${flakeIcon} Snow possible</p>`
        : `<p class="gv-verdict">No snow expected</p>`;

      const head = `
        <div class="gv-matchup wm-matchup">${matchupStack(g, 'lg')}</div>
        <h2 class="visually-hidden">${esc(g.away.name)} at ${esc(g.home.name)}</h2>
        <p class="gv-when">${holidayTag(g.kickoff)}${esc(fmtWhen(g.kickoff))}${g.broadcast ? ' on ' + esc(g.broadcast) : ''}<br>${esc(g.venue.name)}${g.venue.city ? ', ' + esc(g.venue.city) : ''}</p>
        ${favButtons(g)}
        ${watchBlock(g)}
        ${scoreBanner(g)}
        ${advisoryBanner(g)}
        ${Extras.alertsSlot(g)}
        <div class="meta-row">${countdown(g)}${w ? trendHtml(g) + agreeHtml(g) + badgeHtml(g) : ''}</div>`;
      const share = `<button class="share-btn" id="share-btn">Share this forecast</button>`;

      const credit = `<p class="gv-source" id="photo-credit"></p>`;
      if (g.roof === 'dome') return head + `<p class="gv-summary">${esc(g.venue.name)} is a dome, so the weather won't touch this one.</p>` + share + arrange(g, { play: Kicker.section(g), game: Extras.recordsSection(g) + Stats.section(g), stadium: factsSection(g) }) + credit;
      if (!w) return head + `<p class="gv-summary">This game is past the forecast range. Check back a few days before kickoff.</p>` + share + arrange(g, { play: Kicker.section(g), game: Extras.recordsSection(g) + Stats.section(g), stadium: factsSection(g) + historySection(g) }) + credit;

      const chartBlock = (id, title, sub, legend) => `
        <section class="gv-chart">
          <h3>${title}</h3>
          <p class="gv-sub">${sub}</p>
          ${legend ? `<div class="legend">${legend}</div>` : ''}
          <div class="chart" id="${id}"></div>
        </section>`;
      const key = (color, label, line) => `<span><i class="${line ? 'line' : 'box'}" style="background:${color}"></i>${label}</span>`;

      const forecastCore = `
        ${Extras.boxSection(g)}
        <p class="gv-summary">${esc(summary(g))}</p>
        ${meter(g)}
        ${quartersSection(g)}
        ${Extras.notesSection(g)}
        <div class="gv-stats">
          ${stat(inches(w.snowIn), 'snow during the game')}
          ${stat(inches(w.snowBefore24In ?? 0), 'snow in the 24 hours before')}
          ${stat(inches(w.snowDepthIn ?? 0), 'snow on the ground at kickoff')}
          ${stat(`${w.lowF}–${w.highF}°`, 'game temperature')}
          ${stat(`${w.feelsLowF ?? w.lowF}°`, 'coldest feels-like')}
          ${stat(`${w.gustMph ?? w.windMph} mph`, 'strongest gusts')}
        </div>
        <div class="gv-actions">${share}${RoomCam.button(g)}</div>
        ${Compare.section(g)}`;
      const charts = `
        ${modelsSection(g)}
        ${historyChart(g)}
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
        </section>`;
      return head + forecastCore + arrange(g, {
        field: Replay.section(g) + FieldCam.section(g) + lakeSection(g) + Radar.section(g),
        play: Kicker.section(g),
        game: Bingo.section(g) + Extras.recordsSection(g) + Stats.section(g),
        stadium: factsSection(g) + historySection(g),
        charts
      }) + credit + `<p class="gv-source">Forecast from Open-Meteo, updated ${esc(new Date(state.data.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}. Snow totals assume typical snow-to-liquid ratios.</p>`;

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

    body.addEventListener('click', e => {
      if (e.target.closest('[data-tvflip]') && current) { tvFlip(current); return; }
      const fav = e.target.closest('[data-fav]');
      if (fav) {
        const abbr = fav.dataset.fav, on = Favs.toggle(abbr);
        const team = TEAMS.find(t => t[0] === abbr);
        fav.outerHTML = `<button class="fav-btn${on ? ' on' : ''}" data-fav="${esc(abbr)}" aria-pressed="${on}">${starIcon(on)}${esc(team ? team[1] : abbr)}</button>`;
        toast(on ? `${team ? team[1] : abbr} added to your teams` : `${team ? team[1] : abbr} removed from your teams`);
        Sound.crunch();
        render();
        return;
      }
      if (e.target.closest('#share-btn') && current) shareCard(current);
    });

    return { open, close, refresh, isOpen: () => !!current, current: () => current };
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

    let run = 0;
    async function play(g) {
      stop();
      if (REDUCED) return;
      const my = run;
      introTitle(g);
      layer.hidden = false;
      layer.classList.remove('fading');
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = canvas.width = innerWidth * dpr, H = canvas.height = innerHeight * dpr;
      const [a, h] = await Promise.all([loadLogo(g.away), loadLogo(g.home)]);
      if (my !== run) return;   // a newer intro started while the logos loaded
      let pics = [a || badge(g.away), h || badge(g.home)];
      const th = Theme.get();
      layer.dataset.style = th;
      if (th === 'ninety') return playVS(g, pics, W, H, dpr);
      // the scoreboard: logos rebuilt from bulbs, and the snow falls as glowing gold lights
      if (th === 'scoreboard') pics = pics.map(bulbify);
      const flakeColor = th === 'scoreboard' ? '#FFD98A' : th === 'retro' ? '#F6EEDC' : '#EEF5FA';
      // any weather but snow plays its own intro
      const wxr = weatherOf(g);
      if (wxr.primary !== 'snow') return playWeather(g, pics, W, H, dpr, th, wxr);

      const items = [];
      const spawn = (initial) => {
        const isLogo = Math.random() < 0.16;
        const z = Math.random();
        items.push({
          logo: isLogo ? pics[items.length % 2] : null,
          x: Math.random() * W,
          y: initial ? Math.random() * H * 1.1 - H * 0.35 : -60 * dpr,
          size: isLogo ? (22 + z * 24) * dpr : (1.6 + z * z * 6.5) * dpr,
          soft: !isLogo && z > 0.82,
          vy: (2.2 + z * 3.4) * dpr,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.06,
          ph: Math.random() * 6.28, a: 0.55 + z * 0.45
        });
      };
      for (let i = 0; i < 170; i++) spawn(true);

      const t0 = performance.now();
      const frame = now => {
        const t = now - t0;
        if (t < DURATION - 900) { spawn(false); spawn(false); if (Math.random() < 0.6) spawn(false); }
        ctx.clearRect(0, 0, W, H);
        // Retro TV: tune in through a burst of static first
        if (th === 'retro' && t < 520) { staticNoise(W, H, 1 - t / 520); raf = requestAnimationFrame(frame); return; }
        if (th === 'scoreboard') { ctx.shadowColor = 'rgba(255,190,80,0.9)'; ctx.shadowBlur = 8 * dpr; }
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
            if (it.soft) {
              // big out-of-focus flakes drifting close to the screen
              const g = ctx.createRadialGradient(px, it.y, 0, px, it.y, it.size * 1.6);
              g.addColorStop(0, 'rgba(238,245,250,0.9)'); g.addColorStop(1, 'rgba(238,245,250,0)');
              ctx.fillStyle = g;
              ctx.beginPath(); ctx.arc(px, it.y, it.size * 1.6, 0, 6.283); ctx.fill();
            } else {
              ctx.fillStyle = flakeColor;
              ctx.beginPath(); ctx.arc(px, it.y, it.size, 0, 6.283); ctx.fill();
            }
          }
        }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        if (th === 'retro') { ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let yy = 0; yy < H; yy += 4 * dpr) ctx.fillRect(0, yy, W, 1.5 * dpr); }
        for (let i = items.length - 1; i >= 0; i--) if (items[i].y > H + 80 * dpr) items.splice(i, 1);
        if (t < DURATION) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      endTimer = setTimeout(finish, DURATION - 500);
    }

    // the official team name logos (the lettering) for the intro, or the names in type if there aren't any
    function introTitle(g) {
      const el = $('#gv-intro-title');
      const mark = t => {
        const u = Wordmarks.url(t);
        if (!u) return `<span class="iw-text">${esc(t.name)}</span>`;
        const clean = WMClean.cached(u);
        return `<img class="wordmark iw${clean ? ' ready' : ''}" src="${esc(clean || u)}" data-orig="${esc(u)}"${clean ? ' data-clean="done"' : ''} alt="${esc(t.name)}" data-fallback="${esc(`<span class="iw-text">${esc(t.name)}</span>`)}">`;
      };
      el.innerHTML = `${mark(g.away)}<span class="iw-at">at</span>${mark(g.home)}`;
    }
    function loadMark(t) {
      const u = Wordmarks.url(t);
      if (!u) return Promise.resolve(null);
      const src = WMClean.cached(u) || u;
      return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; setTimeout(() => res(i.complete && i.naturalWidth ? i : null), 900); });
    }
    // Any weather but snow: the intro plays out the game's own weather, and the logos move with it
    // (blown sideways in wind, rising into the sun, emerging out of fog, washed down in rain).
    function playWeather(g, pics, W, H, dpr, th, wxr) {
      const s = wxr.spec;
      const sky = makeSky(s, { bg: true, lights: true, gold: th === 'scoreboard', onThunder: () => Sound.thunder(), onHail: () => Sound.tink() });
      const mode = s.wind >= 0.55 ? 'blow' : s.fog >= 0.5 ? 'emerge' : (s.rain || s.hail || s.ice || s.thunder) ? 'wash' : (s.sun > 0.5 || s.heat > 0.3) ? 'rise' : 'drift';
      const logos = Array.from({ length: mode === 'emerge' ? 6 : 12 }, (_, i) => {
        const z = Math.random(), size = (30 + z * 34) * dpr;
        const base = { img: pics[i % 2], size, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.05, z, ph: Math.random() * 6.28 };
        if (mode === 'blow') return { ...base, x: -size - Math.random() * W, y: H * (0.1 + Math.random() * 0.8), vx: (9 + z * 9) * dpr, vy: 0, vr: 0.12 + Math.random() * 0.1 };
        if (mode === 'rise') return { ...base, x: Math.random() * W, y: H * 0.7 + size + Math.random() * H * 0.5, vx: 0, vy: -(3.5 + z * 3.5) * dpr };
        if (mode === 'emerge') return { ...base, x: W * (0.15 + (i % 3) * 0.35), y: H * (0.25 + Math.floor(i / 3) * 0.45), vx: 0.3 * dpr, vy: 0, size: size * 1.4 };
        if (mode === 'wash') return { ...base, x: Math.random() * W, y: -size - Math.random() * H * 0.8, vx: 0, vy: (5 + z * 5) * dpr };
        return { ...base, x: Math.random() * W, y: -size - Math.random() * H * 0.8, vx: 0.4 * dpr, vy: (2 + z * 2) * dpr };
      });
      Sound.weatherStart(s); setTimeout(() => { if (!GameView.isOpen()) Sound.weatherStop(); }, DURATION);
      const t0 = performance.now();
      const frame = now => {
        const t = now - t0;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (th === 'retro' && t < 520) { ctx.clearRect(0, 0, W, H); staticNoise(W, H, 1 - t / 520); raf = requestAnimationFrame(frame); return; }
        sky.step(ctx, W, H, now, dpr);
        for (const L of logos) {
          L.x += L.vx; L.y += L.vy; L.rot += L.vr; L.ph += 0.03;
          let a = 0.9;
          if (mode === 'emerge') a = Math.min(1, Math.max(0, (t - 300 - L.z * 600) / 1200)) * 0.95;
          if (mode === 'rise') a = 0.85 + Math.sin(L.ph * 3) * 0.15;   // glinting in the sun
          ctx.save(); ctx.globalAlpha = a;
          ctx.translate(L.x + (mode === 'drift' ? Math.sin(L.ph) * 12 * dpr : 0), L.y);
          ctx.rotate(mode === 'blow' ? L.rot : Math.sin(L.rot) * 0.35);
          if (th === 'scoreboard') { ctx.shadowColor = 'rgba(255,190,80,0.9)'; ctx.shadowBlur = 10 * dpr; }
          ctx.drawImage(L.img, -L.size / 2, -L.size / 2, L.size, L.size);
          if (mode === 'wash') {
            // rain streaking past and dripping off the logo (thin lines, no box behind it)
            ctx.rotate(-Math.sin(L.rot) * 0.35);
            ctx.lineCap = 'round';
            for (let k = 0; k < 4; k++) {
              const sx = (k / 3 - 0.5) * L.size * 0.8 + Math.sin(L.ph * 2 + k) * 2 * dpr, len = L.size * (0.35 + ((k * 37) % 5) / 10);
              const gr = ctx.createLinearGradient(0, -L.size * 0.5 - len, 0, -L.size * 0.4);
              gr.addColorStop(0, 'rgba(207,224,239,0)'); gr.addColorStop(1, 'rgba(207,224,239,0.55)');
              ctx.globalAlpha = 1; ctx.strokeStyle = gr; ctx.lineWidth = 1.2 * dpr;
              ctx.beginPath(); ctx.moveTo(sx, -L.size * 0.5 - len); ctx.lineTo(sx, -L.size * 0.42); ctx.stroke();
            }
            // drips falling off the bottom edge
            ctx.fillStyle = 'rgba(214,230,244,0.75)';
            for (let k = 0; k < 3; k++) { const f = ((L.ph * 0.9 + k * 0.33) % 1), dx = (k - 1) * L.size * 0.28; ctx.globalAlpha = 1 - f; ctx.beginPath(); ctx.ellipse(dx, L.size * 0.5 + f * L.size * 0.5, 1.4 * dpr, 2.4 * dpr, 0, 0, 6.283); ctx.fill(); }
          }
          ctx.restore();
        }
        // fog swallows the logos back up near the end
        if (mode === 'emerge' && t > DURATION - 900) { ctx.fillStyle = `rgba(210,216,222,${(t - DURATION + 900) / 900 * 0.5})`; ctx.fillRect(0, 0, W, H); }
        if (th === 'retro') { ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let yy = 0; yy < H; yy += 4 * dpr) ctx.fillRect(0, yy, W, 1.5 * dpr); }
        if (t < DURATION) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      endTimer = setTimeout(finish, DURATION - 500);
    }

    function bulbify(img) {
      const c = document.createElement('canvas'); c.width = c.height = 160;
      SHARE_THEMES.scoreboard.logo(c.getContext('2d'), img, 0, 0, 160);
      return c;
    }
    function staticNoise(W, H, amt) {
      const cell = 6;
      for (let yy = 0; yy < H; yy += cell) for (let xx = 0; xx < W; xx += cell) {
        const v = Math.random() * 255 | 0;
        ctx.fillStyle = `rgba(${v},${v},${v},${0.55 + amt * 0.4})`; ctx.fillRect(xx, yy, cell, cell);
      }
      const band = (performance.now() / 3) % H;
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, band, W, 40);
    }

    // 90s: a fighting-game VS screen
    async function playVS(g, pics, W, H, dpr) {
      $('#gv-intro-title').textContent = '';
      const my = run;
      const marks = await Promise.all([loadMark(g.away), loadMark(g.home)]);
      if (my !== run) return;
      const t0 = performance.now(), D = 2700;
      const stars = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: (1 + Math.random() * 2.5) * dpr, tw: Math.random() * 6 }));
      const flakes = [];
      const easeBack = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
      const star5 = (cx, cy, r, rot = 0) => { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = rot + i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); };
      const snowy = g.level > 0 || snowingLive(g);
      const vsW = weatherOf(g);
      const vsSky = !snowy && !['dome', 'unknown', 'cloud', 'night'].includes(vsW.primary) ? makeSky(vsW.spec, { lens: false, glaze: false, frostEdges: false, onThunder: () => Sound.thunder() }) : null;
      Sound.whoosh();
      let slammed = false;
      const frame = now => {
        const t = now - t0;
        // navy stage, spinning light rays, twinkling stars
        const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0B1A5C'); bg.addColorStop(0.7, '#08113D'); bg.addColorStop(1, '#050A28');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.translate(W / 2, H * 0.42); ctx.rotate(t / 4000);
        for (let i = 0; i < 16; i++) { ctx.rotate(Math.PI / 8); ctx.fillStyle = i % 2 ? 'rgba(80,120,255,0.12)' : 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-W * 0.15, -H); ctx.lineTo(W * 0.15, -H); ctx.fill(); }
        ctx.restore();
        for (const s2 of stars) { ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(s2.tw + t / 300)); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s2.x, s2.y, s2.r, 0, 6.283); ctx.fill(); }
        ctx.globalAlpha = 1;
        // the stage floor stripes
        ctx.fillStyle = '#2541B8'; ctx.fillRect(0, H * 0.8, W, H * 0.05); ctx.fillStyle = '#7C9BF0'; ctx.fillRect(0, H * 0.85, W, H * 0.012); ctx.fillStyle = '#16297A'; ctx.fillRect(0, H * 0.862, W, H);
        if (vsSky && t > 300) vsSky.step(ctx, W, H, now, dpr);
        // fighters slide in
        const k = Math.min(1, t / 520), e = easeBack(k), size = Math.min(W * 0.27, H * 0.24);
        const lx = -size + (W * 0.19 + size) * e, rx = W + size - (W + size - W * 0.81) * e, ly = H * 0.42;
        for (const [img, cx] of [[pics[0], lx], [pics[1], rx]]) {
          ctx.save(); ctx.shadowColor = '#fff'; ctx.shadowBlur = 0;
          // white sticker outline
          for (const [ox, oy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) { ctx.globalAlpha = 1; ctx.filter = 'brightness(0) invert(1)'; ctx.drawImage(img, cx - size / 2 + ox * dpr, ly - size / 2 + oy * dpr, size, size); }
          ctx.filter = 'none'; ctx.drawImage(img, cx - size / 2, ly - size / 2, size, size);
          ctx.restore();
        }
        // VS slams in
        if (t > 520) {
          if (!slammed) { slammed = true; Sound.crunch(); if (navigator.vibrate) navigator.vibrate(30); }
          const s3 = Math.max(1, 3 - (t - 520) / 90), shake = t < 760 ? (Math.random() - 0.5) * 14 * dpr : 0;
          ctx.save(); ctx.translate(W / 2 + shake, ly + shake); ctx.scale(s3, s3);
          ctx.font = `${Math.round(Math.min(W, H) * 0.13)}px "Bungee", "Impact", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round'; ctx.lineWidth = 10 * dpr; ctx.strokeStyle = '#fff'; ctx.strokeText('VS', 0, 0);
          ctx.fillStyle = '#E8202E'; ctx.fillText('VS', 0, 0);
          ctx.restore();
          if (t < 640) { ctx.fillStyle = `rgba(255,255,255,${0.8 - (t - 520) / 150})`; ctx.fillRect(0, 0, W, H); }
        }
        // names and the banner
        if (t > 820) {
          const a2 = Math.min(1, (t - 820) / 200);
          ctx.globalAlpha = a2; ctx.font = `${Math.round(13 * dpr)}px "Press Start 2P", monospace`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
          [[g.away, marks[0], W * 0.19], [g.home, marks[1], W * 0.81]].forEach(([tm, mk, cx]) => {
            if (mk) {
              // the team's own lettering with a white sticker outline
              const mw = Math.min(W * 0.36, mk.naturalWidth * (size * 0.3) / mk.naturalHeight), mh = mw * mk.naturalHeight / mk.naturalWidth, top = ly + size * 0.58;
              for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) { ctx.filter = 'brightness(0) invert(1)'; ctx.drawImage(mk, cx - mw / 2 + ox * dpr, top + oy * dpr, mw, mh); }
              ctx.filter = 'none'; ctx.drawImage(mk, cx - mw / 2, top, mw, mh);
            } else ctx.fillText(tm.name.toUpperCase(), cx, ly + size * 0.7);
          });
          const banner = snowy ? 'SNOW GAME!' : vsSky ? (vsW.label.toUpperCase().replace('THUNDERSTORMS', 'STORM') + (vsW.label.length < 9 ? ' GAME!' : '!')) : g.live ? 'GAME ON!' : 'KICKOFF!';
          const blink = Math.floor(t / 260) % 2 === 0;
          ctx.font = `${Math.round(Math.min(W, H) * 0.09)}px "Bungee", "Impact", sans-serif`;
          ctx.lineWidth = 8 * dpr; ctx.strokeStyle = '#fff'; ctx.strokeText(banner, W / 2, H * 0.7);
          ctx.fillStyle = blink ? '#1E3FC8' : '#E8202E'; ctx.fillText(banner, W / 2, H * 0.7);
          star5(W * 0.12, H * 0.7, 16 * dpr, t / 400); ctx.fillStyle = '#fff'; ctx.fill(); star5(W * 0.88, H * 0.7, 16 * dpr, -t / 400); ctx.fill();
          ctx.globalAlpha = 1;
        }
        // and then it snows
        if (snowy && t > 900) { for (let i = 0; i < 3; i++) flakes.push({ x: Math.random() * W, y: -10, r: (1.5 + Math.random() * 3.5) * dpr, v: (2 + Math.random() * 3) * dpr }); }
        ctx.fillStyle = '#fff';
        for (const f of flakes) { f.y += f.v; ctx.fillRect(f.x, f.y, f.r * 1.6, f.r * 1.6); }   // square, pixel-style flakes
        if (t < D) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      endTimer = setTimeout(finish, D - 500);
    }

    function finish() {
      layer.classList.add('fading');
      endTimer = setTimeout(stop, 500);
    }

    function stop() {
      run++;
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

  // =====================================================================================
  // ---------- Saved settings (this phone only) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('sgr:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sgr:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // ---------- Frame governor: keeps the phone cool ----------
  // Animations that are scrolled off screen skip their drawing. With Battery saver on, or on a phone that's
  // struggling to keep up, the busier animations run at half speed and draw fewer particles.
  const Gov = (() => {
    const vis = new WeakMap(), last = new Map();
    let io = null, slow = false;
    const samples = []; let prev = 0;
    const measure = t => { if (prev) samples.push(t - prev); prev = t; if (samples.length < 120) requestAnimationFrame(measure); else { const s2 = samples.slice(40).sort((a, b) => a - b); slow = s2[Math.floor(s2.length / 2)] > 24; } };
    requestAnimationFrame(measure);
    function watch(el) {
      if (!el || vis.has(el)) return;
      vis.set(el, true);
      if (!io) io = new IntersectionObserver(es => es.forEach(e => vis.set(e.target, e.isIntersecting)), { rootMargin: '150px' });
      io.observe(el);
    }
    const low = () => store.get('lowpower', false);
    function ok(key, el, now) {
      if (el) { watch(el); if (vis.get(el) === false) return false; }
      if (low() || slow) { const l = last.get(key) || 0; if (now - l < 31) return false; last.set(key, now); }
      return true;
    }
    return { ok, low, slow: () => slow, lite: () => low() || slow };
  })();

  // ---------- Favorite teams ----------
  const TEAMS = [
    ['ARI', 'Cardinals'], ['ATL', 'Falcons'], ['BAL', 'Ravens'], ['BUF', 'Bills'], ['CAR', 'Panthers'], ['CHI', 'Bears'],
    ['CIN', 'Bengals'], ['CLE', 'Browns'], ['DAL', 'Cowboys'], ['DEN', 'Broncos'], ['DET', 'Lions'], ['GB', 'Packers'],
    ['HOU', 'Texans'], ['IND', 'Colts'], ['JAX', 'Jaguars'], ['KC', 'Chiefs'], ['LV', 'Raiders'], ['LAC', 'Chargers'],
    ['LAR', 'Rams'], ['MIA', 'Dolphins'], ['MIN', 'Vikings'], ['NE', 'Patriots'], ['NO', 'Saints'], ['NYG', 'Giants'],
    ['NYJ', 'Jets'], ['PHI', 'Eagles'], ['PIT', 'Steelers'], ['SF', '49ers'], ['SEA', 'Seahawks'], ['TB', 'Buccaneers'],
    ['TEN', 'Titans'], ['WSH', 'Commanders']
  ];
  const Favs = {
    list: () => store.get('favs', []),
    has: abbr => Favs.list().includes(abbr),
    game: g => !!g && (Favs.has(g.home?.abbr) || Favs.has(g.away?.abbr)),
    toggle(abbr) {
      const l = Favs.list();
      const next = l.includes(abbr) ? l.filter(a => a !== abbr) : [...l, abbr];
      store.set('favs', next);
      syncPrefs();
      return next.includes(abbr);
    }
  };
  async function syncPrefs() {
    if (DEMO || !pushSupported) return;
    const sub = await currentSub().catch(() => null);
    if (!sub) return;
    fetch(API + '/prefs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, favorites: Favs.list(), onlyFavorites: store.get('onlyFavs', false) })
    }).catch(() => {});
  }
  const starIcon = on => `<svg class="star ${on ? 'on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.1 5.9L12 16.5l-5.3 2.9 1.1-5.9-4.4-4.1 6-.7z"/></svg>`;
  const favMark = g => Favs.game(g) ? `<span class="fav-mark" title="Your team">${starIcon(true)}</span>` : '';

  // ---------- Cold-weather badges, forecast trend, model agreement ----------
  function badges(g) {
    const w = g.wx, out = [];
    if (!w || g.roof === 'dome') return out;
    // an official National Weather Service warning that covers the game
    for (const a of (g.nws || []).filter(a => a.snowy || a.cold).slice(0, 1)) out.push(['nws', a.event]);
    if (w.feelsLowF <= 0) out.push(['ice', 'Ice Bowl']);
    else if (w.feelsLowF <= 20) out.push(['tundra', 'Frozen Tundra']);
    if ((w.gustMph || 0) >= 30 || (w.windMph || 0) >= 20) out.push(['wind', 'Wind Game']);
    const x = weatherOf(g).spec;
    if (x.rain >= 0.35 && (g.venue?.facts?.surface || 'grass') === 'grass' && !x.ice) out.push(['mud', 'Mud Bowl']);
    if (x.fog >= 0.5) out.push(['fog', 'Fog Bowl']);
    if (x.ice >= 0.8) out.push(['glaze', 'Ice Storm']);
    if (x.thunder >= 0.5) out.push(['storm', 'Lightning Risk']);
    if (x.hail) out.push(['hail', 'Hail']);
    if (x.heat >= 0.4) out.push(['heat', 'Heat Check']);
    return out;
  }
  const badgeHtml = g => badges(g).map(([k, label]) => `<span class="badge badge-${k}">${label}</span>`).join('');

  function trend(g) {
    const h = g.hist;
    if (!h || h.length < 2 || !g.wx || (g.level === 0 && g.wx.lowF > 38)) return null;
    const val = x => x.l * 100 + x.s * 25 + x.p * 0.3;
    const d = val(h[h.length - 1]) - val(h[h.length - 2]);
    if (d > 4) return { dir: 'up', text: 'Snow odds rising since yesterday' };
    if (d < -4) return { dir: 'down', text: 'Snow odds falling since yesterday' };
    return { dir: 'flat', text: 'Forecast steady since yesterday' };
  }
  const arrow = dir => `<svg class="trend-arrow ${dir}" viewBox="0 0 16 16" aria-hidden="true"><path d="${dir === 'up' ? 'M8 3l5 6H9.5v4h-3V9H3z' : dir === 'down' ? 'M8 13l-5-6h3.5V3h3v4H13z' : 'M2 8l5-4v2.5h7v3H7V12z'}"/></svg>`;
  const trendHtml = g => { const t = trend(g); return t ? `<span class="trend ${t.dir}">${arrow(t.dir)}${t.text}</span>` : ''; };

  function agreeHtml(g) {
    const m = g.wx?.models;
    if (!m || !m.length) return '';
    const a = g.wx.agree || 0;
    const cls = a === m.length ? 'all' : a === 0 ? 'none' : 'split';
    return `<span class="agree ${cls}">${a} of ${m.length} models show snow</span>`;
  }

  // ---------- Kickoff countdowns (updated every second) ----------
  const countdown = g => g.live || g.final ? '' : `<span class="countdown" data-kick="${esc(g.kickoff)}"></span>`;
  function tickCountdowns() {
    const now = Date.now();
    document.querySelectorAll('.countdown[data-kick]').forEach(el => {
      const ms = new Date(el.dataset.kick).getTime() - now;
      let t;
      if (ms <= 0) t = 'Kicking off';
      else {
        const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
        t = d ? `Kickoff in ${d}d ${h}h` : h ? `Kickoff in ${h}h ${String(m).padStart(2, '0')}m` : `Kickoff in ${m}:${String(s).padStart(2, '0')}`;
        el.classList.toggle('soon', ms < 3600000);
      }
      if (el.textContent !== t) el.textContent = t;
    });
  }
  setInterval(tickCountdowns, 1000);

  // ---------- Live games ----------
  function liveNow(g, skipSnow) {
    const lw = g.liveWx;
    if (g.roof === 'dome') return 'Inside the dome';
    if (!lw) return 'Live conditions unavailable';
    const c = condition(lw.c, lw.snowNow);
    const snow = lw.snowSoFarIn > 0 && !skipSnow ? `, ${inches(lw.snowSoFarIn)} since kickoff` : '';
    return `Now ${lw.f}° (feels ${lw.fl}°), ${c.text.toLowerCase()}${snow}, wind ${lw.w} mph`;
  }
  const snowingLive = g => !!g.liveWx && (g.liveWx.snowNow > 0 || g.liveWx.snowSoFarIn > 0);
  function liveCard(g) {
    const snowing = snowingLive(g);
    return `<button class="live-card${snowing ? ' snowing' : ''}" data-open="${esc(g.id)}" style="--snow:${snowing ? Math.min(1, 0.45 + g.liveWx.snowSoFarIn / 2) : glow(g)}"${snowing ? ' data-snowgame' : ''}>
      <span class="lc-top"><span class="live-dot">Live</span><span>${esc(g.status || 'In progress')}</span>${snowing ? `<span class="lc-snowing">${flakeIcon}Snow Game in Progress</span>` : ''}</span>
      <span class="lc-score">
        <span class="lc-team">${teamLine(g.away, 'xs')}</span>
        <b>${g.score?.away ?? '–'}</b><span class="lc-dash">–</span><b>${g.score?.home ?? '–'}</b>
        <span class="lc-team">${teamLine(g.home, 'xs')}</span>
      </span>
      <span class="lc-cond">${esc(liveNow(g))}</span>
      ${snowing && Blizzard.label(g) ? `<span class="lc-rate">${flakeIcon}${esc(Blizzard.label(g))}</span>` : ''}
    </button>`;
  }
  let liveTimer = null;
  function scheduleLiveRefresh(hasLive) {
    if (hasLive && !liveTimer) liveTimer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
    if (!hasLive && liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }

  // ---------- Little notices ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 300); }, 2600);
  }

  // =====================================================================================
  // ---------- Sound (made on the fly with Web Audio; off until turned on in Settings) ----------
  const Sound = (() => {
    let ctx = null, noise = null, wind = null, lastScrape = 0;
    const on = () => store.get('sound', false);
    function ac() {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function burst(c, t, { freq, q = 1, gain, dur, type = 'bandpass' }) {
      const src = c.createBufferSource(); src.buffer = noise;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t, Math.random()); src.stop(t + dur + 0.02);
    }
    // footstep-in-snow crunch: a few tiny gritty bursts
    function crunch() {
      if (!on()) return; const c = ac(); if (!c) return;
      const t = c.currentTime;
      for (let i = 0; i < 5; i++) burst(c, t + i * 0.022 + Math.random() * 0.012, { freq: 1400 + Math.random() * 2200, q: 1.4, gain: 0.18 + Math.random() * 0.12, dur: 0.05 + Math.random() * 0.05 });
    }
    // frost being scraped
    function scrape() {
      if (!on()) return; const now = performance.now(); if (now - lastScrape < 70) return; lastScrape = now;
      const c = ac(); if (!c) return;
      burst(c, c.currentTime, { freq: 5200 + Math.random() * 1500, q: 2.5, gain: 0.05, dur: 0.07, type: 'bandpass' });
    }
    // gust when you shake for a flurry
    function whoosh() {
      if (!on()) return; const c = ac(); if (!c) return;
      const t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1600, t + 0.45); f.frequency.exponentialRampToValueAtTime(350, t + 1.4);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      src.connect(f).connect(g).connect(c.destination); src.start(t); src.stop(t + 1.6);
    }
    // soft wind behind snowy games
    function windStart(strength) {
      if (!on()) return; const c = ac(); if (!c) return;
      windStop(true);
      const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.6;
      const g = c.createGain(); g.gain.value = 0.0001;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
      const lfoGain = c.createGain(); lfoGain.gain.value = 0.02 + 0.03 * strength;
      lfo.connect(lfoGain).connect(g.gain);
      src.connect(f).connect(g).connect(c.destination);
      const t = c.currentTime;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.04 + 0.06 * strength, t + 1.5);
      src.start(); lfo.start();
      wind = { src, g, lfo };
    }
    function windStop(now) {
      if (!wind || !ctx) return;
      const w = wind; wind = null;
      const t = ctx.currentTime;
      w.g.gain.cancelScheduledValues(t); w.g.gain.setValueAtTime(w.g.gain.value, t); w.g.gain.linearRampToValueAtTime(0.0001, t + (now ? 0.05 : 0.8));
      setTimeout(() => { try { w.src.stop(); w.lfo.stop(); } catch (e) { /* already stopped */ } }, now ? 80 : 900);
    }
    // a silly synthesized gobble: a warbling, falling square wave
    function gobble() {
      if (!on()) return; const c = ac(); if (!c) return;
      const t = c.currentTime;
      const o = c.createOscillator(); o.type = 'square';
      const lfo = c.createOscillator(); lfo.frequency.value = 26; const lg = c.createGain(); lg.gain.value = 90;
      lfo.connect(lg).connect(o.frequency);
      o.frequency.setValueAtTime(620, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.55);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
      for (let i = 0; i < 4; i++) { g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.14 + 0.02); g.gain.exponentialRampToValueAtTime(0.01, t + i * 0.14 + 0.12); }
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(f).connect(g).connect(c.destination);
      o.start(t); lfo.start(t); o.stop(t + 0.62); lfo.stop(t + 0.62);
    }
    // sleigh bells: bright jingly partials
    function bells() {
      if (!on()) return; const c = ac(); if (!c) return;
      const t = c.currentTime;
      for (let i = 0; i < 10; i++) {
        const at = t + i * 0.07 + Math.random() * 0.03;
        for (const mult of [1, 2.76, 5.4]) {
          const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = (2100 + Math.random() * 500) * mult / 2;
          const g = c.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.05 / mult, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
          o.connect(g).connect(c.destination); o.start(at); o.stop(at + 0.4);
        }
      }
    }
    // weather sounds: steady rain (filtered noise), thunder rumbles, hail tinks
    let rainNode = null;
    function weatherStart(spec) {
      weatherStop();
      const lvl = Math.max(spec.rain || 0, spec.thunder ? 0.6 : 0, spec.ice ? 0.4 : 0, spec.hail ? 0.5 : 0);
      if (!on() || !lvl) return; const c = ac(); if (!c) return;
      const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 0.5;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.03 + lvl * 0.09, c.currentTime + 1.2);
      src.connect(f).connect(lp).connect(g).connect(c.destination); src.start();
      rainNode = { src, g };
    }
    function weatherStop() {
      if (!rainNode || !ctx) return;
      const n = rainNode; rainNode = null;
      n.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3); setTimeout(() => { try { n.src.stop(); } catch (e) {} }, 1200);
    }
    function thunder() {
      if (!on()) return; const c = ac(); if (!c) return;
      const t = c.currentTime + 0.25 + Math.random() * 0.6;
      const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(120, t + 2.5);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.08); g.gain.exponentialRampToValueAtTime(0.18, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      src.connect(f).connect(g).connect(c.destination); src.start(t); src.stop(t + 3.1);
    }
    let lastTink = 0;
    function tink() {
      if (!on()) return; const now = performance.now(); if (now - lastTink < 60) return; lastTink = now;
      const c = ac(); if (!c) return; const t = c.currentTime;
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 2400 + Math.random() * 1800;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.1);
    }
    // a short sting before the Snow Game Report, a little different per theme
    function jingle(th) {
      if (!on()) return; const c = ac(); if (!c) return;
      const notes = th === 'ninety' ? [523, 659, 784, 1047] : th === 'retro' ? [392, 494, 587, 784] : th === 'scoreboard' ? [349, 440, 523, 698] : [440, 554, 659, 880];
      notes.forEach((fq, i) => {
        const t = c.currentTime + i * 0.14;
        const o = c.createOscillator(); o.type = th === 'ninety' ? 'square' : th === 'scoreboard' ? 'sawtooth' : 'triangle'; o.frequency.value = fq;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 3 ? 0.6 : 0.16));
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.7);
      });
    }
    return { crunch, scrape, whoosh, gobble, bells, windStart, windStop, weatherStart, weatherStop, thunder, tink, jingle, on, unlock: () => on() && ac() };
  })();

  // ---------- Shake for a flurry ----------
  (() => {
    let last = null, hits = 0, lastHit = 0, cool = 0;
    addEventListener('devicemotion', e => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      if (last) {
        const d = Math.abs(a.x - last.x) + Math.abs(a.y - last.y) + Math.abs(a.z - last.z);
        const now = Date.now();
        if (d > 28) {
          hits = now - lastHit < 500 ? hits + 1 : 1;
          lastHit = now;
          if (hits >= 3 && now > cool) { cool = now + 2000; hits = 0; flurry(); }
        }
      }
      last = { x: a.x, y: a.y, z: a.z };
    });
  })();
  function flurry() {
    if (typeof Eggs !== 'undefined') Eggs.onFlurry();
    Sound.whoosh();
    if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
    if (GameView.isOpen()) FX.burst(); else Snow.burst();
  }

  // =====================================================================================
  // ---------- Frost: creeps in from the edges on snow games; wipe it with your finger ----------
  const Frost = (() => {
    const canvas = $('#frost');
    const ctx = canvas.getContext('2d');
    const wipe = document.createElement('canvas');
    const wctx = wipe.getContext('2d');
    let tex = null, active = false, strength = 0, start = 0, raf = null, w = 0, h = 0, dpr = 1, down = false, hinted = store.get('frostHint', false);

    function build() {
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      w = innerWidth; h = innerHeight;
      for (const c of [canvas, wipe]) { c.width = w * dpr; c.height = h * dpr; }
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      tex = document.createElement('canvas'); tex.width = w * dpr; tex.height = h * dpr;
      const t = tex.getContext('2d'); t.scale(dpr, dpr);
      const band = Math.min(w, h) * 0.24;
      // frosty haze along every edge, heavier in the corners
      const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => { const g = t.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(226,240,250,0.42)'); g.addColorStop(1, 'rgba(226,240,250,0)'); t.fillStyle = g; t.fillRect(rx, ry, rw, rh); };
      edge(0, 0, 0, band, 0, 0, w, band); edge(0, h, 0, h - band, 0, h - band, w, band);
      edge(0, 0, band, 0, 0, 0, band, h); edge(w, 0, w - band, 0, w - band, 0, band, h);
      for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
        const g = t.createRadialGradient(cx, cy, 0, cx, cy, band * 1.3); g.addColorStop(0, 'rgba(236,246,252,0.5)'); g.addColorStop(1, 'rgba(236,246,252,0)');
        t.fillStyle = g; t.fillRect(0, 0, w, h);
      }
      // ice crystals growing inward like frost ferns
      t.lineCap = 'round';
      const fern = (x, y, ang, len, depth) => {
        const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        t.strokeStyle = `rgba(245,251,255,${0.14 + Math.random() * 0.3})`; t.lineWidth = 0.5 + depth * 0.4;
        t.beginPath(); t.moveTo(x, y); t.lineTo(x2, y2); t.stroke();
        if (depth > 0) for (let k = 1; k <= 3; k++) {
          const f = k / 4, bx = x + (x2 - x) * f, by = y + (y2 - y) * f;
          fern(bx, by, ang + 0.75, len * 0.38, depth - 1); fern(bx, by, ang - 0.75, len * 0.38, depth - 1);
        }
      };
      for (let i = 0; i < 150; i++) {
        const side = Math.floor(Math.random() * 4), d = Math.pow(Math.random(), 3) * band * 0.8, along = Math.random();
        let x, y, ang;
        if (side === 0) { x = along * w; y = d; ang = Math.PI / 2; }
        else if (side === 1) { x = along * w; y = h - d; ang = -Math.PI / 2; }
        else if (side === 2) { x = d; y = along * h; ang = 0; }
        else { x = w - d; y = along * h; ang = Math.PI; }
        fern(x, y, ang + (Math.random() - 0.5) * 1.2, 10 + Math.random() * 26 * (1 - d / band), 2);
      }
      for (let i = 0; i < 500; i++) { // glints
        const x = Math.random() * w, y = Math.random() * h;
        const edgeDist = Math.min(x, y, w - x, h - y) / band;
        if (Math.random() > Math.pow(Math.max(0, 1 - edgeDist), 1.5)) continue;
        t.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`; t.fillRect(x, y, 1, 1);
      }
    }

    function set(on, amount = 1) {
      if (REDUCED && on) amount = Math.min(amount, 0.7);
      if (on && !active) {
        if (!tex || w !== innerWidth || h !== innerHeight) build();
        wctx.clearRect(0, 0, wipe.width, wipe.height);
        start = performance.now(); active = true; strength = amount;
        canvas.hidden = false;
        if (!hinted) { hinted = true; store.set('frostHint', true); setTimeout(() => toast('Frosty! Swipe to scrape it off.'), 2400); }
        loop();
      } else if (on) { strength = amount; }
      else if (!on && active) {
        active = false; canvas.hidden = true;
        if (raf) cancelAnimationFrame(raf); raf = null;
      }
    }

    function loop() {
      raf = requestAnimationFrame(loop);
      const p = REDUCED ? 1 : Math.min(1, (performance.now() - start) / 2600);
      // the scraped area slowly frosts back over
      wctx.globalCompositeOperation = 'destination-out';
      wctx.fillStyle = 'rgba(0,0,0,0.004)'; wctx.fillRect(0, 0, wipe.width, wipe.height);
      wctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = strength;
      ctx.drawImage(tex, 0, 0);
      ctx.globalAlpha = 1;
      // creep in from the edges
      if (p < 1) {
        ctx.globalCompositeOperation = 'destination-in';
        const cx = canvas.width / 2, cy = canvas.height / 2, R = Math.hypot(cx, cy);
        const g = ctx.createRadialGradient(cx, cy, R * (1 - p) * 0.95, cx, cy, R * (1.02 - p * 0.3));
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(wipe, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }

    function scrapeAt(x, y) {
      if (!active) return;
      const r = 34 * dpr, X = x * dpr, Y = y * dpr;
      const g = wctx.createRadialGradient(X, Y, 0, X, Y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.6, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      wctx.fillStyle = g; wctx.beginPath(); wctx.arc(X, Y, r, 0, 6.283); wctx.fill();
      Sound.scrape();
    }
    // Wiping never blocks taps or scrolling: we just watch where your finger goes.
    addEventListener('pointerdown', e => { down = true; scrapeAt(e.clientX, e.clientY); }, { passive: true });
    addEventListener('pointerup', () => { down = false; }, { passive: true });
    addEventListener('pointercancel', () => { down = false; }, { passive: true });
    addEventListener('pointermove', e => { if (down || e.pointerType === 'touch') scrapeAt(e.clientX, e.clientY); }, { passive: true });
    addEventListener('touchmove', e => { for (const t of e.touches) scrapeAt(t.clientX, t.clientY); }, { passive: true });
    addEventListener('resize', () => { if (active) { const a = strength; active = false; tex = null; set(true, a); } });
    return { set };
  })();

  // ---------- Snowbank: snow piled along the bottom, as deep as the game's snowfall ----------
  const SnowBank = (() => {
    const canvas = $('#snowbank');
    const ctx = canvas.getContext('2d');
    const H = 170;
    let target = 0, height = 0, raf = null, sparkles = [], t0 = performance.now(), dirty = true;
    // finger writing in the snow (fills back in over ~20 seconds)
    const marks = document.createElement('canvas'), mctx = marks.getContext('2d');
    let drawing = false, last = null, wroteHint = store.get('bankHint', false);
    // the snowman that builds itself as snow piles up during a live game
    let man = { inches: 0, shown: 0, label: '', x: 0, y: 0, r: 0 };
    const px = inchesOfSnow => inchesOfSnow > 0 ? Math.min(150, 16 + inchesOfSnow * 42) : 0;

    function set(inchesOfSnow) {
      const next = px(inchesOfSnow);
      if (next === target && (next === 0 || raf)) return;
      target = next;
      document.documentElement.style.setProperty('--bank', target + 'px');
      document.body.classList.toggle('has-bank', target > 0);
      if (target > 0) {
        canvas.hidden = false;
        sparkles = Array.from({ length: 14 }, () => ({ u: Math.random(), ph: Math.random() * 6.28, d: Math.random() }));
        if (!wroteHint && !REDUCED) { wroteHint = true; store.set('bankHint', true); setTimeout(() => toast('Try writing in the snow at the bottom.'), 6000); }
      }
      kick();
    }
    function snowman(inches, label) {
      man.inches = inches || 0; man.label = label || '';
      if (man.inches > 0 && target < px(1.4)) set(Math.max(1.4, man.inches));
      kick();
    }
    function kick() { dirty = true; if (!raf) raf = requestAnimationFrame(loop); }

    function surfAt(x, W, time) {
      return H - height * (0.82 + 0.1 * Math.sin(x / 70 + 1.3) + 0.06 * Math.sin(x / 23 + 0.4) + 0.03 * Math.sin(x / 9 + time * 0.6));
    }

    function loop() {
      raf = null;
      const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth;
      if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; marks.width = W * dpr; marks.height = H * dpr; }
      height += (target - height) * (REDUCED ? 1 : 0.035);
      man.shown += (man.inches - man.shown) * (REDUCED ? 1 : 0.03);
      if (target === 0 && height < 0.5 && man.inches === 0) { height = 0; canvas.hidden = true; return; }
      const time = REDUCED ? 0 : (performance.now() - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const surf = x => surfAt(x, W, time);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 3) ctx.lineTo(x, surf(x));
      ctx.lineTo(W, H); ctx.closePath();
      const g = ctx.createLinearGradient(0, H - height, 0, H);
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.35, '#EAF3F9'); g.addColorStop(1, '#B6CFE2');
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = -2;
      ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent';
      // writing: grooves pressed into the snow, only where there is snow
      if (!REDUCED) { mctx.globalCompositeOperation = 'destination-out'; mctx.fillStyle = 'rgba(0,0,0,0.006)'; mctx.fillRect(0, 0, marks.width, marks.height); mctx.globalCompositeOperation = 'source-over'; }
      ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(marks, 0, 0); ctx.restore();
      for (const sp of sparkles) {
        const x = sp.u * W, y = surf(x) + 4 + sp.d * height * 0.5;
        const a = Math.pow(Math.max(0, Math.sin(time * 1.8 + sp.ph)), 14);
        if (a > 0.02) { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(x - 1, y - 1, 2, 2); ctx.fillRect(x - 3, y - 0.5, 6, 1); ctx.fillRect(x - 0.5, y - 3, 1, 6); }
      }
      drawSnowman(W, surf);
      const busy = Math.abs(target - height) > 0.5 || Math.abs(man.inches - man.shown) > 0.01;
      if (!REDUCED || busy || dirty) { dirty = false; if (!REDUCED || busy) raf = requestAnimationFrame(loop); }
    }

    function ball(x, y, r) {
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.7, '#EEF5FA'); g.addColorStop(1, '#B9CFE0');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
    function drawSnowman(W, surf) {
      const inch = man.shown;
      if (inch <= 0.02) { man.r = 0; return; }
      const x = Math.min(W * 0.16, 70), ground = surf(x) + 6;
      const stage = inch < 1 ? 0 : inch < 2 ? 1 : inch < 3 ? 2 : 3;
      const grow = t => Math.max(0, Math.min(1, t));
      // a snowball that grows until the 1" base is complete
      const rBase = 10 + 14 * grow(inch);
      ctx.save();
      ctx.fillStyle = 'rgba(40,60,80,0.25)'; ctx.beginPath(); ctx.ellipse(x + 3, ground + 2, rBase * 1.1, 4, 0, 0, 6.283); ctx.fill();
      ball(x, ground - rBase, rBase);
      let top = ground - rBase * 2;
      if (stage >= 1) { const r = 16 * grow(inch - 1); if (r > 1) { ball(x, top - r + 3, r); top -= r * 2 - 3; } }
      if (stage >= 2) {
        const r = 11 * grow(inch - 2);
        if (r > 1) {
          const cy = top - r + 2;
          ball(x, cy, r);
          if (r > 8) {
            ctx.fillStyle = '#1B1F24'; ctx.beginPath(); ctx.arc(x - 3.5, cy - 2, 1.5, 0, 6.283); ctx.arc(x + 3.5, cy - 2, 1.5, 0, 6.283); ctx.fill();
            ctx.fillStyle = '#F08A24'; ctx.beginPath(); ctx.moveTo(x, cy + 0.5); ctx.lineTo(x + 9, cy + 2); ctx.lineTo(x, cy + 3.2); ctx.fill();
            for (let k = -2; k <= 2; k++) { ctx.fillStyle = '#1B1F24'; ctx.beginPath(); ctx.arc(x + k * 2.3, cy + 6 + Math.abs(k) * -0.8, 0.9, 0, 6.283); ctx.fill(); }
          }
          top = cy - r;
        }
      }
      if (stage >= 3) {
        const a = grow((inch - 3) * 2);
        // scarf, stick arms, knit hat
        const neckY = top + 22 * 1;
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#6B4A2E'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        const armY = ground - rBase * 2 - 14;
        ctx.beginPath(); ctx.moveTo(x - 13, armY); ctx.lineTo(x - 30, armY - 10); ctx.moveTo(x - 25, armY - 7); ctx.lineTo(x - 29, armY - 15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 13, armY); ctx.lineTo(x + 30, armY - 12); ctx.moveTo(x + 25, armY - 9); ctx.lineTo(x + 31, armY - 4); ctx.stroke();
        ctx.fillStyle = '#F5B841'; ctx.fillRect(x - 12, neckY, 24, 5); ctx.fillRect(x + 4, neckY + 3, 5, 12);
        ctx.fillStyle = '#C9DDEC'; ctx.fillRect(x - 12, neckY + 2, 24, 1);
        ctx.fillStyle = '#1F4E86'; ctx.beginPath(); ctx.ellipse(x, top + 3, 11, 4, 0, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 9, top + 3); ctx.quadraticCurveTo(x, top - 16, x + 9, top + 3); ctx.fill();
        ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, top - 11, 3.5, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      man.x = x; man.y = (ground + top) / 2; man.r = Math.max(30, (ground - top) / 2 + 10);
    }

    // Writing in the snow with your finger (never blocks scrolling or taps)
    function groove(x0, y0, x1, y1) {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.lineCap = 'round'; mctx.lineJoin = 'round';
      mctx.strokeStyle = 'rgba(120,150,175,0.75)'; mctx.lineWidth = 9;
      mctx.beginPath(); mctx.moveTo(x0, y0); mctx.lineTo(x1, y1); mctx.stroke();
      mctx.strokeStyle = 'rgba(255,255,255,0.9)'; mctx.lineWidth = 2;
      mctx.beginPath(); mctx.moveTo(x0, y0 + 4); mctx.lineTo(x1, y1 + 4); mctx.stroke();
      kick();
    }
    const inBank = y => target > 0 && !canvas.hidden && y > innerHeight - height * 0.9;
    addEventListener('pointerdown', e => {
      const bx = e.clientX, by = e.clientY - (innerHeight - H);
      if (man.r && Math.hypot(bx - man.x, by - man.y) < man.r) {
        toast(man.label ? `${inches(man.inches)} of snow at ${man.label} so far` : `${inches(man.inches)} of snow so far`);
        Sound.crunch(); return;
      }
      if (inBank(e.clientY)) { drawing = true; last = { x: bx, y: by }; Sound.crunch(); }
    }, { passive: true });
    addEventListener('pointermove', e => {
      if (!drawing) return;
      const p = { x: e.clientX, y: e.clientY - (innerHeight - H) };
      if (last) groove(last.x, last.y, p.x, p.y);
      last = p;
    }, { passive: true });
    const stop = () => { drawing = false; last = null; };
    addEventListener('pointerup', stop, { passive: true });
    addEventListener('pointercancel', stop, { passive: true });
    return { set, snowman };
  })();

  // ---------- Weather effects behind each game's forecast ----------
  // Snow for snow games, rain streaks for rainy ones, wind streaks for gusty ones, breath puffs when it's frigid.
  // Behind the game view: the game's weather keeps going (snow, rain, hail, fog, lightning, ice, wind, glare, cold breath).
  const FX = (() => {
    const canvas = $('#gv-fx');
    const ctx = canvas.getContext('2d');
    let raf = null, sky = null, key = null, cur = null;
    function start(g, changed) {
      stop();
      cur = g;
      const W = weatherOf(g);
      key = W.key;
      if (!g.wx && !g.liveWx || g.roof === 'dome') return;
      const th = Theme.get();
      sky = makeSky(W.spec, { gold: th === 'scoreboard', lens: true, glaze: true, frostEdges: false, onThunder: () => { Sound.thunder(); Feel.thunder(); }, onHail: () => Sound.tink() });
      Sound.weatherStart(W.spec);
      if (changed) { canvas.classList.remove('wx-change'); void canvas.offsetWidth; canvas.classList.add('wx-change'); }
      if (REDUCED) { frame(performance.now() + 4000); cancelAnimationFrame(raf); raf = null; return; }
      raf = requestAnimationFrame(frame);
    }
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (!Gov.ok('fx', null, t)) return;
      const dpr = Math.min(devicePixelRatio || 1, Gov.lite() ? 1.25 : 2), W = innerWidth, H = innerHeight;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (sky) sky.step(ctx, W, H, t, 1);
    }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = null; ctx.clearRect(0, 0, canvas.width, canvas.height); Sound.weatherStop(); }
    function burst() { sky && sky.burst(); }
    function blizzard(n, windMph) { sky && sky.override(n, windMph); }
    // during a live game: if the weather changes, switch over with a short transition
    function check(g) {
      if (!cur || !g || g.id !== cur.id) return;
      const W = weatherOf(g);
      if (W.key !== key) { const before = weatherOf(cur).label; start(g, true); if (W.label !== before) toast(`Weather change at ${g.venue.name}: ${W.label.toLowerCase()}`); }
      cur = g;
    }
    return { start, stop, burst, blizzard, check, key: () => key };
  })();


  // =====================================================================================
  // ---------- Radar loop around kickoff (RainViewer, past 2 hours) ----------
  const Radar = (() => {
    const Z = 7, TILE = 256;
    let timer = null;
    const near = g => g.live || Math.abs(new Date(g.kickoff).getTime() - Date.now()) < 6 * 3600000;
    function section(g) {
      if (g.roof === 'dome' || g.venue?.lat == null || !near(g)) return '';
      return `<section class="gv-chart gv-radar">
        <h3>Live radar</h3>
        <p class="gv-sub">Snow and rain around ${esc(g.venue.name)} over the past 2 hours</p>
        <div class="radar" id="radar"><p class="radar-msg">Loading radar…</p></div>
        <p class="radar-credit">Radar: RainViewer. Map: Esri, HERE, Garmin, © OpenStreetMap contributors.</p>
      </section>`;
    }
    async function mount(g) {
      stop();
      const box = document.getElementById('radar');
      if (!box) return;
      try {
        const meta = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
        const frames = (meta.radar?.past || []).slice(-8);
        if (!frames.length) throw new Error('no frames');
        const W = box.clientWidth, H = box.clientHeight;
        const n = 2 ** Z;
        const wx = (g.venue.lon + 180) / 360 * n * TILE;
        const lr = g.venue.lat * Math.PI / 180;
        const wy = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n * TILE;
        const x0 = wx - W / 2, y0 = wy - H / 2;
        const tiles = [];
        for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx++)
          for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H) / TILE); ty++) tiles.push([tx, ty]);
        const pos = (tx, ty) => `left:${Math.round(tx * TILE - x0)}px;top:${Math.round(ty * TILE - y0)}px`;
        const sub = 'abcd';
        const esri = (layer, tx, ty) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/${Z}/${ty}/${tx}`;
        let html = tiles.map(([tx, ty]) => `<img class="rt" style="${pos(tx, ty)}" src="${esri('World_Dark_Gray_Base', tx, ty)}" alt="">`).join('');
        frames.forEach((f, i) => {
          html += `<div class="rf" data-i="${i}">` + tiles.map(([tx, ty]) => `<img class="rt" style="${pos(tx, ty)}" src="${meta.host}${f.path}/${TILE}/${Z}/${tx}/${ty}/2/1_1.png" alt="">`).join('') + '</div>';
        });
        html += `<div class="rl">` + tiles.map(([tx, ty]) => `<img class="rt" style="${pos(tx, ty)}" src="${esri('World_Dark_Gray_Reference', tx, ty)}" alt="">`).join('') + `</div>`;
        html += `<span class="radar-pin"></span><span class="radar-time"></span>`;
        box.innerHTML = html;
        const layers = [...box.querySelectorAll('.rf')], label = box.querySelector('.radar-time');
        let i = 0;
        const show = () => {
          layers.forEach((l, k) => l.classList.toggle('on', k === i));
          label.textContent = new Date(frames[i].time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (i === frames.length - 1 ? ' (latest)' : '');
        };
        show();
        if (REDUCED) { i = frames.length - 1; show(); return; }
        const step = () => { i = (i + 1) % frames.length; show(); timer = setTimeout(step, i === frames.length - 1 ? 1600 : 550); };
        timer = setTimeout(step, 550);
      } catch (e) {
        box.innerHTML = '<p class="radar-msg">Radar isn\'t available right now.</p>';
      }
    }
    function stop() { clearTimeout(timer); timer = null; }
    return { section, mount, stop };
  })();

  // ---------- Share card: a wintery image of the forecast for texting friends ----------
  async function shareCard(g) {
    const btn = $('#share-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Making your card…'; }
    try {
      const theme = Theme.get();
      await Promise.all([
        document.fonts?.load('900 100px "Big Shoulders Display"'),
        document.fonts?.load('800 40px "Big Shoulders Display"'),
        document.fonts?.load('500 34px "Public Sans"'),
        document.fonts?.load('600 34px "Public Sans"'),
        theme === 'retro' && document.fonts?.load('40px "VT323"'),
        theme === 'scoreboard' && document.fonts?.load('900 40px "Doto"')
      ].filter(Boolean)).catch(() => {});
      const W = 1080, H = 1350;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      const w = g.wx, level = g.level, live = g.live;
      const S = SHARE_THEMES[theme] || SHARE_THEMES.night;

      // shrink a line until it fits the card
      const fitText = (t, px, py, o) => {
        let size = o.size; x.font = S.font(o.kind, size, o.weight);
        while (x.measureText(o.kind === 'body' ? t.toUpperCase() : t).width > W - 110 && size > 14) { size -= 1; x.font = S.font(o.kind, size, o.weight); }
        S.text(x, t, px, py, { ...o, size });
      };
      S.background(x, W, H, g);
      // snowfall (bulbs don't fall on the scoreboard; it gets its own lit flakes)
      for (let i = 0; i < S.flakes; i++) {
        const z = Math.random();
        x.globalAlpha = 0.25 + z * 0.6; x.fillStyle = S.flake;
        x.beginPath(); x.arc(Math.random() * W, Math.random() * H, 1.2 + z * z * 5, 0, 6.283); x.fill();
      }
      x.globalAlpha = 1;
      // header
      const mark = await loadImg(themeLogo(theme).mark);
      if (mark) x.drawImage(mark, 70, 62, 72, 72);
      x.textBaseline = 'middle';
      S.text(x, 'SNOW GAME RADAR', 156, 100, { size: 44, kind: 'head', color: S.ink });
      // logos
      const [la, lh] = await Promise.all([loadImg(maskUrl(logoUrl(g.away)), true), loadImg(maskUrl(logoUrl(g.home)), true)]);
      const drawLogo = (img, team, cx) => {
        if (img) { S.logo ? S.logo(x, img, cx - 115, 190, 230) : x.drawImage(img, cx - 115, 190, 230, 230); }
        else { x.fillStyle = team?.color || '#2B4566'; x.beginPath(); x.arc(cx, 305, 105, 0, 6.283); x.fill(); x.fillStyle = '#fff'; x.font = '700 64px "Public Sans", sans-serif'; x.textAlign = 'center'; x.fillText(team?.abbr || '', cx, 308); x.textAlign = 'left'; }
      };
      drawLogo(la, g.away, 330); drawLogo(lh, g.home, 750);
      x.textAlign = 'center';
      S.text(x, 'at', 540, 305, { size: 56, kind: 'head', color: S.sub, weight: 600 });
      // title, with snow settled on it for snow games
      const title = S.upper ? `${g.away.name} at ${g.home.name}`.toUpperCase() : `${g.away.name} at ${g.home.name}`;
      let fs = S.titleSize;
      x.font = S.font('title', fs);
      while (x.measureText(title).width > W - 140 && fs > 50) { fs -= 4; x.font = S.font('title', fs); }
      x.textBaseline = 'alphabetic';
      S.text(x, title, 540, 540, { size: fs, kind: 'title', color: S.ink });
      if (level > 0 || snowingLive(g)) {
        const m = document.createElement('canvas'); m.width = W; m.height = 600;
        const mc = m.getContext('2d'); mc.font = x.font; mc.textAlign = 'center'; mc.fillText(title, 540, 540);
        x.drawImage(heapSnow(m, { unit: fs, snow: glow(g), seedVal: seed(title), min: 4 }), 0, 0);
      }
      fitText(`${fmtWhen(g.kickoff)}${g.broadcast ? ' on ' + g.broadcast : ''}`, 540, 605, { size: 36, kind: 'body', color: S.sub });
      fitText(g.venue.name + (g.venue.city ? ', ' + g.venue.city : ''), 540, 652, { size: 36, kind: 'body', color: S.sub });
      // the verdict
      let verdict, tone, big, bigLabel;
      if (g.final) { verdict = 'FINAL'; tone = 'plain'; big = `${g.score?.away ?? ''}–${g.score?.home ?? ''}`; bigLabel = w ? `${inches(w.snowIn)} of snow was forecast for this one` : 'final score'; }
      else if (live) { verdict = `LIVE: ${g.status || 'In progress'}`; tone = 'hot'; big = g.score ? `${g.score.away}–${g.score.home}` : '–'; bigLabel = snowingLive(g) ? `${inches(g.liveWx.snowSoFarIn)} of snow since kickoff` : liveNow(g); }
      else if (!w) { verdict = g.roof === 'dome' ? 'Dome game' : 'Forecast coming soon'; tone = 'muted'; big = g.roof === 'dome' ? '0″' : '?'; bigLabel = g.roof === 'dome' ? 'weather stays outside' : 'check back closer to kickoff'; }
      else { verdict = level === 2 ? 'SNOW GAME WARNING' : level === 1 ? 'SNOW GAME WATCH' : 'NO SNOW EXPECTED'; tone = level === 2 ? 'hot' : level === 1 ? 'cool' : 'muted'; big = inches(w.snowIn); bigLabel = 'snow during the game'; }
      const color = S.tones[tone];
      S.pill(x, verdict.toUpperCase(), 540, 740, color);
      x.textBaseline = 'alphabetic';
      S.text(x, big, 540, 1010, { size: S.bigSize, kind: 'big', color: tone === 'muted' || tone === 'plain' ? S.ink : color, glow: tone === 'hot' });
      fitText(bigLabel, 540, 1065, { size: 36, kind: 'body', color: S.sub });
      if (w && !live) {
        const facts = [`${w.lowF}° low`, `feels ${w.feelsLowF}°`, `${w.coldPrecipChance || w.precipChance}% precip`, `gusts ${w.gustMph} mph`];
        fitText(facts.join('    '), 540, 1130, { size: 34, kind: 'body', color: S.ink, weight: 600 });
        const extra = [w.models?.length ? `${w.agree} of ${w.models.length} forecast models show snow` : '', badges(g).map(b => b[1]).join(', ')].filter(Boolean).join('  ·  ');
        if (extra) fitText(extra, 540, 1180, { size: 30, kind: 'body', color: S.muted });
      }
      // snowdrift along the bottom
      x.beginPath(); x.moveTo(0, H);
      for (let px2 = 0; px2 <= W; px2 += 6) x.lineTo(px2, H - 70 - 26 * Math.sin(px2 / 140 + 1) - 14 * Math.sin(px2 / 47));
      x.lineTo(W, H); x.closePath();
      const dg = x.createLinearGradient(0, H - 120, 0, H); dg.addColorStop(0, '#FFFFFF'); dg.addColorStop(1, '#B6CFE2');
      x.fillStyle = dg; x.fill();
      if (S.overlay) S.overlay(x, W, H);
      x.textAlign = 'left';
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const file = new File([blob], `snow-game-${g.away.abbr}-${g.home.abbr}.png`.toLowerCase(), { type: 'image/png' });
      const text = live ? `${g.short} is live${snowingLive(g) ? ' and it\'s snowing' : ''}!` : w ? `${g.short}: ${level === 2 ? 'Snow Game Warning' : level === 1 ? 'Snow Game Watch' : 'no snow expected'} (${inches(w.snowIn)} during the game).` : g.short;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Snow Game Radar', text }).catch(() => {});
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast('Card saved to your downloads.');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Share this forecast'; }
    }
  }

  // ---------- Share card looks, one per theme ----------
  const SHARE_THEMES = (() => {
    const BS = (w, s) => `${w} ${s}px "Big Shoulders Display", sans-serif`;
    const PS = (w, s) => `${w} ${s}px "Public Sans", sans-serif`;
    // the original: night sky under the stadium lights
    const night = {
      ink: '#E9F1F7', sub: '#B9C8D6', muted: '#93A8BC', flake: '#EEF5FA', flakes: 260, titleSize: 112, bigSize: 230,
      tones: { hot: '#F5B841', cool: '#8EC5E8', muted: '#93A8BC', plain: '#E9F1F7' },
      font(kind, s, wt) { return kind === 'body' ? PS(wt || 500, s) : kind === 'head' ? BS(wt || 800, s) : BS(900, s); },
      background(x, W, H) {
        const sky = x.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#1C3A5C'); sky.addColorStop(0.55, '#0F1C2E'); sky.addColorStop(1, '#0B1626');
        x.fillStyle = sky; x.fillRect(0, 0, W, H);
        for (const sx of [0, W]) {
          const gl = x.createRadialGradient(sx, 40, 0, sx, 40, 520);
          gl.addColorStop(0, 'rgba(255,228,170,0.35)'); gl.addColorStop(1, 'rgba(255,228,170,0)');
          x.fillStyle = gl; x.fillRect(0, 0, W, H);
        }
      },
      text(x, t, px, py, o) {
        x.font = this.font(o.kind, o.size, o.weight); x.fillStyle = o.color;
        if (o.glow) { x.shadowColor = o.color; x.shadowBlur = 40; }
        x.fillText(t, px, py); x.shadowBlur = 0;
      },
      pill(x, t, cx, cy, color) {
        x.font = BS(800, 46); const vw = x.measureText(t).width + 80;
        x.fillStyle = color; roundRectPath(x, cx - vw / 2, cy - 40, vw, 76, 38); x.fill();
        x.fillStyle = '#0B1626'; x.textBaseline = 'middle'; x.fillText(t, cx, cy);
      }
    };
    // On the Field: looking down at the grass, dusted with snow
    const field = {
      ...night, flakes: 180,
      background(x, W, H, g) {
        for (let i = 0; i * 108 < H; i++) { x.fillStyle = i % 2 ? '#2F6B35' : '#367A3C'; x.fillRect(0, i * 108, W, 108); }
        x.strokeStyle = 'rgba(244,247,242,0.75)'; x.lineWidth = 6;
        for (let i = 1; i * 108 < H; i++) { x.beginPath(); x.moveTo(0, i * 108); x.lineTo(W, i * 108); x.stroke(); }
        x.fillStyle = 'rgba(244,247,242,0.5)';
        for (let i = 1; i * 108 < H; i++) for (let k = 0; k < 4; k++) x.fillRect(W * 0.33 + (k % 2) * W * 0.34 - 3, i * 108 + 22 + Math.floor(k / 2) * 40, 6, 18);
        const snow = Math.min(1, ((g.live && g.liveWx ? g.liveWx.snowSoFarIn : g.wx?.snowIn) || 0) / 2);
        if (snow > 0 || g.level > 0) {
          for (let i = 0; i < 1400 * Math.max(0.25, snow); i++) { const r = 4 + Math.random() * 22; x.fillStyle = `rgba(244,249,252,${0.15 + Math.random() * 0.4})`; x.beginPath(); x.arc(Math.random() * W, Math.random() * H, r, 0, 6.283); x.fill(); }
        }
        const shade = x.createLinearGradient(0, 0, 0, H);
        shade.addColorStop(0, 'rgba(6,16,10,0.75)'); shade.addColorStop(0.5, 'rgba(6,16,10,0.45)'); shade.addColorStop(1, 'rgba(6,16,10,0.7)');
        x.fillStyle = shade; x.fillRect(0, 0, W, H);
      },
      text(x, t, px, py, o) {
        x.shadowColor = 'rgba(0,0,0,0.85)'; x.shadowBlur = 14; x.shadowOffsetY = 3;
        x.font = this.font(o.kind, o.size, o.weight); x.fillStyle = o.color; x.fillText(t, px, py);
        x.shadowBlur = 0; x.shadowOffsetY = 0;
        if (o.glow) { x.shadowColor = o.color; x.shadowBlur = 36; x.fillText(t, px, py); x.shadowBlur = 0; }
      }
    };
    // Retro TV: a 70s–80s broadcast graphic on a curved picture tube
    const RET = (s) => `${s}px "VT323", monospace`;
    const retro = {
      ink: '#F6E9CC', sub: '#E3C99A', muted: '#CDAE80', flake: '#F6EEDC', flakes: 200, titleSize: 104, bigSize: 260, upper: false,
      tones: { hot: '#FFC94A', cool: '#F0B13C', muted: '#CDAE80', plain: '#F6E9CC' },
      font(kind, s, wt) { return kind === 'body' ? RET(Math.round(s * 1.08)) : kind === 'big' ? RET(s) : `italic ${wt || 900} ${s}px "Big Shoulders Display", sans-serif`; },
      background(x, W, H) {
        const bg = x.createRadialGradient(W / 2, H * 0.2, 50, W / 2, H * 0.4, H);
        bg.addColorStop(0, '#4A2C16'); bg.addColorStop(0.6, '#20140C'); bg.addColorStop(1, '#0E0906');
        x.fillStyle = bg; x.fillRect(0, 0, W, H);
        // 70s stripes behind the header
        ['#E8642A', '#F0B13C', '#F6E9CC'].forEach((col, i) => { x.fillStyle = col; x.fillRect(0, 150 + i * 14, W, 10); });
      },
      text(x, t, px, py, o) {
        x.font = this.font(o.kind, o.size, o.weight);
        const txt = o.kind === 'body' ? t.toUpperCase() : t;
        if (o.kind === 'title' || o.kind === 'head') {   // a little color bleed, like an old broadcast
          x.fillStyle = 'rgba(255,40,60,0.55)'; x.fillText(txt, px - 3, py);
          x.fillStyle = 'rgba(0,200,255,0.5)'; x.fillText(txt, px + 3, py);
        }
        if (o.kind === 'big' || o.glow) { x.shadowColor = '#FFB020'; x.shadowBlur = 30; }
        x.fillStyle = o.kind === 'big' ? '#FFC94A' : o.color; x.fillText(txt, px, py); x.shadowBlur = 0;
      },
      pill(x, t, cx, cy, color) {
        // a tilted chyron with the stripe block
        x.save(); x.translate(cx, cy); x.transform(1, 0, -0.18, 1, 0, 0);
        x.font = `italic 900 50px "Big Shoulders Display", sans-serif`;
        const vw = x.measureText(t).width + 130;
        x.fillStyle = '#000'; x.fillRect(-vw / 2 + 10, -38 + 10, vw, 80);
        const gr = x.createLinearGradient(0, -40, 0, 40); gr.addColorStop(0, '#6A3E1A'); gr.addColorStop(1, '#3A2210');
        x.fillStyle = gr; x.fillRect(-vw / 2, -40, vw, 80);
        x.strokeStyle = '#F6E9CC'; x.lineWidth = 4; x.strokeRect(-vw / 2, -40, vw, 80);
        ['#E8642A', '#F0B13C', '#F6E9CC'].forEach((col, i) => { x.fillStyle = col; x.fillRect(-vw / 2 + 18, -22 + i * 15, 40, 12); });
        x.fillStyle = color; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(t, 30, 2);
        x.restore();
      },
      overlay(x, W, H) {
        x.fillStyle = 'rgba(0,0,0,0.22)';
        for (let yy = 0; yy < H; yy += 4) x.fillRect(0, yy, W, 1.5);    // scanlines
        const v = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.78);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.75)');
        x.fillStyle = v; x.fillRect(0, 0, W, H);
        // rounded picture-tube corners
        x.save(); x.globalCompositeOperation = 'destination-in'; x.fillStyle = '#000'; roundRectPath(x, 0, 0, W, H, 70); x.fill(); x.restore();
        x.save(); x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.restore();
        x.font = `italic 900 46px "Big Shoulders Display", sans-serif`; x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillStyle = 'rgba(255,255,255,0.6)';
        x.fillText('SGR', W - 120, H - 108);
        x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 4; x.beginPath(); x.arc(W - 86, H - 110, 26, 0, 6.283); x.stroke();
        x.textAlign = 'center'; x.font = `italic 900 36px "Big Shoulders Display", sans-serif`; x.fillText('7', W - 86, H - 108);
      }
    };
    // 80s NFL Theme: the scoreboard, everything in glowing bulbs
    const DOTO = (s) => `900 ${s}px "Doto", "Courier New", monospace`;
    const board = {
      ink: '#F3D58C', sub: '#D9B66E', muted: '#B99559', flake: '#FFE7B0', flakes: 120, titleSize: 84, bigSize: 230, upper: true,
      tones: { hot: '#FF8B3D', cool: '#F6C453', muted: '#B99559', plain: '#F3D58C' },
      font(kind, s) { return kind === 'body' ? PS(600, s) : DOTO(s); },
      background(x, W, H) {
        x.fillStyle = '#050403'; x.fillRect(0, 0, W, H);
        x.fillStyle = 'rgba(242,195,90,0.10)';
        for (let yy = 6; yy < H; yy += 12) for (let xx = 6; xx < W; xx += 12) { x.beginPath(); x.arc(xx, yy, 2.2, 0, 6.283); x.fill(); }
        // a frame of bulbs around the board
        x.fillStyle = '#F6C453'; x.shadowColor = 'rgba(255,190,80,0.9)'; x.shadowBlur = 10;
        for (let xx = 30; xx < W - 20; xx += 24) { x.beginPath(); x.arc(xx, 26, 4, 0, 6.283); x.fill(); x.beginPath(); x.arc(xx, H - 26, 4, 0, 6.283); x.fill(); }
        for (let yy = 50; yy < H - 40; yy += 24) { x.beginPath(); x.arc(26, yy, 4, 0, 6.283); x.fill(); x.beginPath(); x.arc(W - 26, yy, 4, 0, 6.283); x.fill(); }
        x.shadowBlur = 0;
      },
      text(x, t, px, py, o) {
        x.font = this.font(o.kind, o.size);
        const txt = o.kind === 'body' ? t : t.toUpperCase();
        x.shadowColor = o.kind === 'body' ? 'transparent' : 'rgba(255,190,80,0.85)'; x.shadowBlur = o.kind === 'body' ? 0 : (o.glow ? 36 : 14);
        x.fillStyle = o.color; x.fillText(txt, px, py); x.shadowBlur = 0;
      },
      pill(x, t, cx, cy, color) {
        x.font = DOTO(46); const vw = x.measureText(t).width + 70;
        x.fillStyle = '#070504'; x.fillRect(cx - vw / 2, cy - 40, vw, 80);
        x.fillStyle = color; x.shadowColor = color; x.shadowBlur = 8;
        for (let xx = cx - vw / 2; xx <= cx + vw / 2; xx += 14) { x.beginPath(); x.arc(xx, cy - 40, 3, 0, 6.283); x.fill(); x.beginPath(); x.arc(xx, cy + 40, 3, 0, 6.283); x.fill(); }
        for (let yy = cy - 26; yy < cy + 40; yy += 14) { x.beginPath(); x.arc(cx - vw / 2, yy, 3, 0, 6.283); x.fill(); x.beginPath(); x.arc(cx + vw / 2, yy, 3, 0, 6.283); x.fill(); }
        x.shadowBlur = 16; x.textBaseline = 'middle'; x.fillText(t, cx, cy + 2); x.shadowBlur = 0;
      },
      // the logo rebuilt from glowing bulbs
      logo(x, img, l, t, size) {
        try {
          const n = 46, cell = size / n;
          const off = document.createElement('canvas'); off.width = off.height = n;
          const o = off.getContext('2d', { willReadFrequently: true });
          const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
          const k = Math.min(n / iw, n / ih);
          o.drawImage(img, (n - iw * k) / 2, (n - ih * k) / 2, iw * k, ih * k);
          const d = o.getImageData(0, 0, n, n).data;
          x.save(); x.shadowBlur = 8;
          for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const p = (j * n + i) * 4; if (d[p + 3] < 60) continue;
            const r = Math.min(255, d[p] * 1.6 + 30), gg = Math.min(255, d[p + 1] * 1.6 + 30), b = Math.min(255, d[p + 2] * 1.6 + 30);
            x.fillStyle = x.shadowColor = `rgb(${r | 0},${gg | 0},${b | 0})`;
            x.beginPath(); x.arc(l + (i + 0.5) * cell, t + (j + 0.5) * cell, cell * 0.4, 0, 6.283); x.fill();
          }
          x.restore();
        } catch (e) { x.drawImage(img, l, t, size, size); }
      }
    };
    // 90s NFL Theme: a pregame-show title card that looks like a video game
    const BUN = s => `${s}px "Bungee", "Impact", sans-serif`, PIX = s => `${s}px "Press Start 2P", monospace`;
    const star = (x, cx, cy, r) => { x.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); };
    const ninety = {
      ink: '#FFFFFF', sub: '#C9D6FF', muted: '#9DB4E8', flake: '#FFFFFF', flakes: 140, titleSize: 92, bigSize: 210, upper: true,
      tones: { hot: '#E8202E', cool: '#2F5BFF', muted: '#9DB4E8', plain: '#FFFFFF' },
      font(kind, s, wt) { return kind === 'body' ? PS(700, s) : kind === 'label' ? PIX(s) : BUN(s); },
      background(x, W, H) {
        const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0B1A5C'); bg.addColorStop(0.75, '#08113D'); bg.addColorStop(1, '#050A28');
        x.fillStyle = bg; x.fillRect(0, 0, W, H);
        x.fillStyle = 'rgba(255,255,255,0.05)'; star(x, W * 0.78, H * 0.3, 360); x.fill();
        for (let i = 0; i < 60; i++) { x.globalAlpha = 0.3 + Math.random() * 0.6; x.fillStyle = '#fff'; star(x, Math.random() * W, Math.random() * H * 0.8, 3 + Math.random() * 6); x.fill(); }
        x.globalAlpha = 1;
        x.fillStyle = '#2541B8'; x.fillRect(0, H - 150, W, 36); x.fillStyle = '#7C9BF0'; x.fillRect(0, H - 114, W, 10); x.fillStyle = '#16297A'; x.fillRect(0, H - 104, W, 104);
      },
      text(x, t, px, py, o) {
        const txt = o.kind === 'body' ? t : t.toUpperCase();
        x.font = this.font(o.kind, o.size, o.weight);
        if (o.kind === 'body') { x.fillStyle = o.color; x.fillText(txt, px, py); return; }
        // chunky letters: navy drop shadow, thick white outline, red or blue fill with stars inside
        x.lineJoin = 'round';
        x.fillStyle = '#050B2A'; x.fillText(txt, px + o.size * 0.06, py + o.size * 0.06);
        x.lineWidth = Math.max(4, o.size * 0.12); x.strokeStyle = '#fff'; x.strokeText(txt, px, py);
        const fill = o.color === '#FFFFFF' || o.color === '#C9D6FF' ? '#2F5BFF' : o.color;
        x.fillStyle = fill; x.fillText(txt, px, py);
        if (o.size >= 80) {   // little white stars across the letters
          x.save(); x.globalCompositeOperation = 'source-atop';
          const w = x.measureText(txt).width, left = x.textAlign === 'center' ? px - w / 2 : px;
          x.fillStyle = '#fff';
          for (let sx = left + o.size * 0.25; sx < left + w; sx += o.size * 0.48) { star(x, sx, py - o.size * 0.38, o.size * 0.1); x.fill(); }
          x.restore();
        }
      },
      pill(x, t, cx, cy, color) {
        x.font = PIX(30); const vw = x.measureText(t).width + 70;
        x.fillStyle = '#050B2A'; roundRectPath(x, cx - vw / 2 + 8, cy - 38 + 8, vw, 76, 12); x.fill();
        x.fillStyle = color === '#9DB4E8' ? '#2541B8' : color; roundRectPath(x, cx - vw / 2, cy - 38, vw, 76, 12); x.fill();
        x.lineWidth = 5; x.strokeStyle = '#fff'; x.stroke();
        x.fillStyle = 'rgba(255,255,255,0.25)'; roundRectPath(x, cx - vw / 2 + 6, cy - 34, vw - 12, 22, 8); x.fill();
        x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(t, cx, cy + 3);
      },
      logo(x, img, l, t, size) {
        x.save();
        for (const [ox, oy] of [[-5, 0], [5, 0], [0, -5], [0, 5], [-4, -4], [4, 4], [-4, 4], [4, -4]]) { x.filter = 'brightness(0) invert(1)'; x.drawImage(img, l + ox, t + oy, size, size); }
        x.filter = 'none'; x.drawImage(img, l, t, size, size);
        x.restore();
      },
      overlay(x, W, H) {
        x.font = PIX(22); x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillStyle = '#FFE14D';
        x.fillText('PRESS START', W - 60, H - 132);
      }
    };
    return { night, field, retro, scoreboard: board, ninety };
  })();

  function loadImg(src, cors) {
    return new Promise(res => {
      if (!src) return res(null);
      const i = new Image(); if (cors) i.crossOrigin = 'anonymous';
      i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
      setTimeout(() => res(i.complete && i.naturalWidth ? i : null), 5000);
    });
  }
  function roundRectPath(x, l, t, w, h, r) {
    x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath();
  }

  // ---------- Forecast history chart (how the snow forecast changed day by day) ----------
  function historyChart(g) {
    const h = g.hist;
    if (!h || h.length < 2) return '';
    const W = 320, H = 110, pl = 36, pr = 34, pt = 14, pb = 22;
    const max = Math.max(0.5, ...h.map(p => p.s)) * 1.15;
    const X = i => pl + (W - pl - pr) * (h.length === 1 ? 0.5 : i / (h.length - 1));
    const Y = v => pt + (H - pt - pb) * (1 - v / max);
    const day = d => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)).toLocaleDateString([], { weekday: 'short' });
    const pts = h.map((p, i) => `${X(i)},${Y(p.s)}`).join(' ');
    const last = h[h.length - 1];
    return `<section class="gv-chart">
      <h3>How the forecast has changed</h3>
      <p class="gv-sub">Snow forecast during the game, as predicted each day (inches)</p>
      <svg class="hist-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Snow forecast by day: ${h.map(p => day(p.d) + ' ' + p.s + ' inches').join(', ')}">
        <line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" class="ch-grid"/>
        <line x1="${pl}" x2="${W - pr}" y1="${Y(max / 1.15)}" y2="${Y(max / 1.15)}" class="ch-grid"/>
        <text x="${pl - 6}" y="${Y(0) + 4}" text-anchor="end" class="ch-axis">0″</text>
        <text x="${pl - 6}" y="${Y(max / 1.15) + 4}" text-anchor="end" class="ch-axis">${(max / 1.15).toFixed(1)}″</text>
        <polyline points="${pts}" fill="none" stroke="${C1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${h.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.s)}" r="4" fill="${C1}" stroke="#13253B" stroke-width="2"/>`).join('')}
        <text x="${X(h.length - 1) + 8}" y="${Y(last.s) + 4}" class="ch-end">${last.s}″</text>
        ${h.map((p, i) => `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="ch-axis">${day(p.d)}</text>`).join('')}
      </svg>
    </section>`;
  }

  // ---------- Forecast confidence: what each weather model says ----------
  function modelsSection(g) {
    const m = g.wx?.models;
    if (!m || !m.length) return '';
    const max = Math.max(0.5, ...m.map(x => x.snowIn));
    const a = g.wx.agree || 0;
    const lead = a === m.length ? 'All the models agree on snow.' : a === 0 ? 'None of the models show snow during the game.' : `The models are split: ${a} of ${m.length} show snow.`;
    return `<section class="gv-chart">
      <h3>Forecast confidence</h3>
      <p class="gv-sub">${lead} Snow during the game by model, with each model's low.</p>
      <div class="models">${m.map(x => `
        <div class="model-row">
          <span class="model-name">${esc(x.name)}</span>
          <span class="model-bar"><i style="width:${Math.max(2, x.snowIn / max * 100)}%"></i></span>
          <span class="model-val">${inches(x.snowIn)}, ${x.lowF}°</span>
        </div>`).join('')}
      </div>
    </section>`;
  }

  // =====================================================================================
  // ---------- Weather-service-style advisories ----------
  function advisoryName(g) {
    if (g.live && snowingLive(g)) return (g.liveWx.snowSoFarIn >= 1.5 || g.liveWx.lastHourIn >= 0.6) ? 'Heavy Snow Warning' : 'Snow Game in Progress';
    if (g.final || !g.wx || g.roof === 'dome') return null;
    return g.level === 2 ? 'Snow Game Warning' : g.level === 1 ? 'Snow Game Watch' : null;
  }
  const advisoryCls = name => !name ? '' : /Warning/.test(name) ? 'warning' : /Progress/.test(name) ? 'progress' : 'watch';
  const alertIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z" fill="currentColor"/><path d="M12 10v5M12 17.6v.4" stroke="#0B1626" stroke-width="2.2" stroke-linecap="round"/></svg>';

  function advisoryBanner(g) {
    const name = advisoryName(g);
    if (!name) {
      if (g.final) return '';
      if (g.roof === 'dome') return `<p class="gv-verdict">Indoors: no weather in play</p>`;
      return g.wx ? `<p class="gv-verdict">No snow expected</p>` : '';
    }
    const w = g.wx || {};
    const issued = new Date(state.data.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    let body;
    if (g.live) {
      const lw = g.liveWx;
      body = `Snow is falling at ${esc(g.venue.name)}. ${inches(lw.snowSoFarIn)} has fallen since kickoff, ${lw.lastHourIn.toFixed(2)}″ in the last hour. Now ${lw.f}°, wind ${lw.w} mph gusting to ${lw.g}.`;
    } else {
      const peak = (w.timeline || []).filter(x => x.inGame && x.s > 0).sort((a, b) => b.s - a.s)[0];
      body = `In effect for ${esc(g.venue.name)} from kickoff ${esc(fmtWhen(g.kickoff))} through the fourth quarter. `
        + (w.snowIn > 0 ? `${inches(w.snowIn)} of snow expected during the game${peak ? `, heaviest around ${esc(fmtHour(peak.t))}` : ''}. ` : `Temperatures near freezing with a ${w.coldPrecipChance}% chance of precipitation. `)
        + `Low ${w.lowF}°, gusts to ${w.gustMph ?? w.windMph} mph.`
        + (g.roof === 'retractable' ? ' The roof may be closed.' : '');
    }
    return `<div class="advisory ${advisoryCls(name)}" role="note">
      <div class="adv-head">${alertIcon}<span>${name}</span></div>
      <p class="adv-body">${body}</p>
      <p class="adv-foot">Issued ${esc(issued)} by Snow Game Radar</p>
    </div>`;
  }

  // ---------- Watch links (official apps for each network) ----------
  const WATCH = [
    [/^cbs/i, 'Paramount+', 'https://www.paramountplus.com/live-tv/'],
    [/^fox/i, 'FOX One', 'https://www.foxone.com/'],
    [/^(nbc|peacock)/i, 'Peacock', 'https://www.peacocktv.com/sports/nfl'],
    [/^(espn|abc)/i, 'ESPN', 'https://www.espn.com/watch/'],
    [/prime|amazon/i, 'Prime Video', 'https://www.primevideo.com/'],
    [/netflix/i, 'Netflix', 'https://www.netflix.com/'],
    [/nfl ?net|nfln/i, 'NFL+', 'https://www.nfl.com/plus/'],
    [/youtube/i, 'YouTube TV', 'https://tv.youtube.com/']
  ];
  function watchLink(g) {
    if (g.final || !g.broadcast) return null;
    const hit = WATCH.find(([re]) => re.test(g.broadcast));
    return hit ? { service: hit[1], url: hit[2] } : null;
  }
  const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
  function watchBlock(g) {
    const w = watchLink(g);
    if (!w) return '';
    const soon = g.live || new Date(g.kickoff).getTime() - Date.now() < 3 * 3600000;
    return `<div class="watch">
      <a class="watch-btn${soon ? ' hot' : ''}" href="${esc(w.url)}" target="_blank" rel="noopener">${playIcon}Watch on ${esc(w.service)}</a>
      <span class="watch-note">${esc(g.broadcast)}${w.service !== 'NFL+' ? ` · or <a href="https://www.nfl.com/plus/" target="_blank" rel="noopener">NFL+</a> on your phone` : ''}</span>
    </div>`;
  }

  // ---------- Score banner for live and finished games ----------
  function scoreBanner(g) {
    if (!g.live && !g.final) return '';
    const lw = g.liveWx;
    return `<div class="gv-live${g.final ? ' final' : ''}${snowingLive(g) ? ' snowing' : ''}">
      <div class="gv-live-top">${g.live ? '<span class="live-dot">Live</span>' : '<span class="final-tag">Final</span>'}<span>${esc(g.live ? (g.status || 'In progress') : '')}</span></div>
      <div class="gv-live-score"><span>${esc(g.away.name)}</span><b>${g.score?.away ?? '–'}</b><span class="lc-dash">–</span><b>${g.score?.home ?? '–'}</b><span>${esc(g.home.name)}</span></div>
      ${g.live ? `<div class="gv-live-cond">${esc(liveNow(g, true))}</div>` : ''}
      ${g.live && lw && lw.snowSoFarIn > 0 ? `<div class="gv-live-snow"><b>${inches(lw.snowSoFarIn)}</b> since kickoff, <b>${lw.lastHourIn.toFixed(2)}″</b> in the last hour</div>` : ''}
    </div>`;
  }

  // ---------- Snow by quarter (like a box score) ----------
  // Quarter windows in minutes after kickoff, allowing for halftime and stoppages
  const QUARTERS = [['Q1', 0, 50], ['Q2', 50, 100], ['Q3', 120, 170], ['Q4', 170, 220]];
  function byQuarter(g) {
    const tl = g.wx?.timeline;
    if (!tl) return null;
    const k = new Date(g.kickoff).getTime();
    return QUARTERS.map(([q, a, b]) => {
      let snow = 0, tSum = 0, tW = 0, pMax = 0;
      for (const h of tl) {
        const hs = (new Date(h.t).getTime() - k) / 60000, he = hs + 60;
        const ov = Math.max(0, Math.min(b, he) - Math.max(a, hs));
        if (!ov) continue;
        snow += h.s * ov / 60; tSum += h.f * ov; tW += ov; pMax = Math.max(pMax, h.p);
      }
      return { q, snow: Math.round(snow * 100) / 100, temp: tW ? Math.round(tSum / tW) : null, p: pMax };
    });
  }
  function quartersSection(g) {
    const qs = byQuarter(g);
    if (!qs) return '';
    const max = Math.max(...qs.map(x => x.snow));
    const any = max > 0;
    return `<section class="gv-chart">
      <h3>Snow by quarter</h3>
      <p class="gv-sub">${any ? 'Forecast snowfall in each quarter, with the average temperature' : 'No snow in any quarter; average temperature and precipitation chance'}</p>
      <div class="box-score">
        ${qs.map(x => `<div class="bs-cell${any && x.snow === max ? ' peak' : ''}">
          <span class="bs-q">${x.q}</span>
          <b class="bs-snow">${any ? (x.snow >= 0.05 ? x.snow.toFixed(1) + '″' : 'Trace') : x.p + '%'}</b>
          <span class="bs-temp">${x.temp ?? '–'}°</span>
        </div>`).join('')}
        <div class="bs-cell total"><span class="bs-q">Game</span><b class="bs-snow">${any ? inches(g.wx.snowIn) : g.wx.precipChance + '%'}</b><span class="bs-temp">${g.wx.lowF}–${g.wx.highF}°</span></div>
      </div>
    </section>`;
  }

  // ---------- Field conditions + stadium facts ----------
  function fieldConditions(g) {
    const f = g.venue.facts || {};
    const grass = f.surface !== 'turf';
    if (g.roof === 'dome') return { text: 'Indoors, so a fast, dry track', tone: 'dry' };
    const w = g.wx;
    if (!w) return null;
    const snow = (g.live && g.liveWx ? g.liveWx.snowSoFarIn : 0) + (w.snowDepthIn || 0) + (g.live ? 0 : w.snowIn);
    if (snow >= 2) return { text: `Snow-covered${grass ? ' grass' : ' turf'}. Expect crews clearing the yard lines between plays`, tone: 'deep' };
    if (snow >= 0.5) return { text: `Snow-covered by halftime. Footing gets slick and the lines disappear`, tone: 'snow' };
    if (snow > 0 || g.level > 0) return { text: `A dusting of snow on the ${grass ? 'grass' : 'turf'}, mostly cosmetic`, tone: 'dust' };
    if ((w.rainHours || 0) > 0 && w.precipChance >= 40) return grass ? { text: 'Wet and muddy grass. Expect sliding and torn-up turf between the hashes', tone: 'mud' } : { text: 'Wet and slick turf. Fast, but tricky footing', tone: 'wet' };
    if (w.lowF <= 25) return { text: grass ? (f.heated ? 'Frigid, but the heated field stays playable' : 'Frozen, rock-hard grass') : 'Frigid, stiff turf', tone: 'frozen' };
    if ((w.gustMph || 0) >= 30) return { text: 'Dry field, but the wind will steal the show', tone: 'wind' };
    return { text: `Dry ${grass ? 'grass' : 'turf'}, fast conditions`, tone: 'dry' };
  }
  function factsSection(g) {
    const f = g.venue.facts || {};
    const fc = fieldConditions(g);
    const rows = [];
    if (f.surface) rows.push(['Surface', (f.surface === 'turf' ? 'Artificial turf' : 'Natural grass') + (f.heated ? ', heated' : '')]);
    rows.push(['Roof', g.roof === 'dome' ? 'Dome' : g.roof === 'retractable' ? 'Retractable' : 'Open air']);
    if (f.opened) rows.push(['Opened', String(f.opened)]);
    if (f.capacity) rows.push(['Capacity', 'About ' + f.capacity.toLocaleString()]);
    if (f.elevationFt != null) rows.push(['Elevation', f.elevationFt.toLocaleString() + ' ft']);
    const rk = rankFor(g);
    if (rk) rows.push(['Snowiest', `#${rk.rank} of ${rk.of} outdoor stadiums`]);
    return `<section class="gv-chart facts">
      <h3>${esc(g.venue.name)}</h3>
      <p class="gv-sub">${esc(g.venue.city || '')}${f.note ? '. ' + esc(f.note) : ''}</p>
      ${fc ? `<div class="field-cond ${fc.tone}"><span class="fc-label">Field conditions</span><b>${esc(fc.text)}</b></div>` : ''}
      <dl class="facts-grid">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    </section>`;
  }

  // ---------- Snow history at the stadium ----------
  function historySection(g) {
    if (g.roof === 'dome' || !g.wx) return '';
    const h = g.venue.history;
    if (!h) return `<section class="gv-chart"><h3>Snow history</h3><p class="gv-sub">Twenty seasons of weather records for ${esc(g.venue.name)} are being compiled. Check back in a day or two.</p></section>`;
    const when = new Date(g.kickoff).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const maxDate = h.max?.date ? new Date(h.max.date + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    const odds = h.weekPct >= 25 ? 'Snow is common here this time of year.' : h.weekPct >= 10 ? 'Snow here this time of year is not unusual.' : h.weekPct > 0 ? 'Snow here this time of year is rare.' : 'It has essentially never snowed here this time of year.';
    return `<section class="gv-chart">
      <h3>Snow history</h3>
      <p class="gv-sub">Days with measurable snow (0.1″ or more) at ${esc(g.venue.name)}, ${esc(h.years)}. ${odds}</p>
      <div class="hist-stats">
        <div><b>${h.weekPct}%</b><span>of days in the weeks around ${esc(when)}</span></div>
        <div><b>${h.monthPct}%</b><span>of all ${esc(h.monthName)} days</span></div>
        ${h.max?.in > 0 ? `<div><b>${h.max.in.toFixed(1)}″</b><span>biggest ${esc(h.monthName)} snowfall in one day${maxDate ? ', ' + esc(maxDate) : ''}</span></div>` : ''}
      </div>
    </section>`;
  }

  // ---------- Snowiest stadiums ranking ----------
  function rankFor(g) {
    const r = state.data?.ranking;
    if (!r || !r.list?.length || r.ready < r.total) return null;
    const i = r.list.findIndex(x => x.name === g.venue.name);
    return i === -1 ? null : { rank: i + 1, of: r.total || r.list.length };
  }
  function renderRanking() {
    const r = state.data?.ranking;
    const box = $('#ranking');
    if (!r || !r.list?.length) {
      box.innerHTML = r && r.total ? `<h2 class="section-head">Snowiest stadiums</h2><p class="empty">Crunching ${r.total} stadiums' worth of snow history. ${r.ready} done so far.</p>` : '';
      return;
    }
    const thisWeek = new Set(state.data.games.filter(g => !g.final).map(g => g.venue.name));
    const top = r.list.slice(0, 10), max = top[0].pct || 1;
    const teamsOf = x => x.teams.map(a => logo({ abbr: a, name: a })).join('');
    box.innerHTML = `
      <h2 class="section-head">Snowiest stadiums</h2>
      <p class="rank-sub">Share of November to January days with measurable snow, ${esc(r.years || '')}${r.ready < r.total ? `. ${r.ready} of ${r.total} stadiums so far` : ''}.</p>
      <ol class="rank-list">${top.map((x, i) => `
        <li class="rank-row${thisWeek.has(x.name) ? ' this-week' : ''}">
          <span class="rank-n">${i + 1}</span>
          <span class="rank-teams">${teamsOf(x)}</span>
          <span class="rank-name"><b>${esc(x.name)}</b><small>${esc(x.city)}${thisWeek.has(x.name) ? ' · <em>Game this week</em>' : ''}${x.roof === 'retractable' ? ' · Retractable roof' : ''}</small></span>
          <span class="rank-bar"><i style="width:${Math.max(3, x.pct / max * 100)}%"></i></span>
          <span class="rank-pct">${x.pct}%</span>
        </li>`).join('')}
      </ol>`;
  }

  // =====================================================================================
  // ---------- The official word, team weather records, and the weather box score (all from /game) ----------
  const Extras = (() => {
    const inUS = g => g.venue?.lat != null && g.venue.lat > 18 && g.venue.lat < 50 && g.venue.lon < -66 && g.venue.lon > -125;
    const official = g => !g.final && g.roof !== 'dome' && inUS(g);
    const CATS = { snow: 'Snow', freezing: 'Freezing', frigid: 'Frigid', wind: 'Wind', rain: 'Rain' };
    const CAT_HINT = { snow: 'snow fell during the game', freezing: '32° or colder at kickoff', frigid: '15° or colder at kickoff', wind: '15+ mph wind or 30+ mph gusts', rain: 'a tenth of an inch or more of rain' };
    const ago = t => { const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} hr ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
    const day = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const rec = c => c ? `${c[0]}-${c[1]}${c[2] ? '-' + c[2] : ''}` : '–';

    function alertsSlot(g) {
      if (!official(g)) return '';
      const pre = (g.nws || []).filter(a => a.snowy || a.cold);
      return `<div class="nws-alerts" id="gv-nws-alerts">${pre.map(a => `<div class="nws-alert${a.snowy ? ' snowy' : ' cold'}"><b>${esc(a.event)}</b>${a.ends ? `<span>until ${esc(fmtWhen(a.ends))}</span>` : ''}</div>`).join('')}</div>`;
    }
    const notesSection = g => official(g) ? `<section class="gv-chart nws-notes" id="gv-nws-notes" hidden></section>` : '';
    const recordsSection = () => `<section class="gv-chart wxrec" id="gv-wxrec"><h3>Built for the weather?</h3><p class="gv-sub">Looking up how both teams play in weather…</p></section>`;
    const boxSection = g => g.final && g.roof !== 'dome' ? `<section class="gv-chart wxbox" id="gv-wxbox"><h3>Weather box score</h3><p class="gv-sub">Adding it up…</p></section>` : '';

    function fill(g, d) {
      if (!d) return;
      alerts(g, d.nws);
      notes(g, d.nws);
      records(g, d.records);
      box(g, d.box);
    }

    // ----- National Weather Service alerts, right under the matchup -----
    function alerts(g, nws) {
      const el = document.getElementById('gv-nws-alerts'); if (!el || !nws) return;
      const list = (nws.alerts || []).filter(a => { const k = new Date(g.kickoff).getTime(); return (!a.starts || new Date(a.starts).getTime() < k + 4 * 3600000) && (!a.ends || new Date(a.ends).getTime() > Math.min(Date.now(), k - 3 * 3600000)); });
      el.innerHTML = list.map(a => `<div class="nws-alert${a.snowy ? ' snowy' : a.cold ? ' cold' : ''}">
        <b>${esc(a.event)}</b>${a.ends ? `<span>until ${esc(fmtWhen(a.ends))}</span>` : ''}
        ${a.text ? `<details><summary>What it says</summary><p>${esc(a.text).replace(/\n/g, '<br>')}</p><small>${esc(a.from || 'National Weather Service')}</small></details>` : ''}
      </div>`).join('');
    }

    // ----- the forecasters' own notes (the Area Forecast Discussion) -----
    function notes(g, nws) {
      const el = document.getElementById('gv-nws-notes'); if (!el) return;
      const dsc = nws?.discussion;
      if (!dsc || (!dsc.summary?.length && !dsc.mentions?.length)) { el.hidden = true; return; }
      el.hidden = false;
      const bullets = (dsc.summary || []).map(p => `<li>${esc(p.replace(/^[-*•]\s*/, ''))}</li>`).join('');
      el.innerHTML = `<h3>What the forecasters are saying</h3>
        <p class="gv-sub">National Weather Service ${esc(dsc.office || '')} forecast discussion${dsc.issued ? `, written ${esc(ago(dsc.issued))}` : ''}${dsc.title ? ` · ${esc(dsc.title)}` : ''}</p>
        ${bullets ? `<ul class="nws-sum">${bullets}</ul>` : ''}
        ${(dsc.mentions || []).length ? `<div class="nws-quotes">${dsc.mentions.map(m => `<blockquote><small>${esc(m.section)}</small>${esc(m.text)}</blockquote>`).join('')}</div>` : ''}
        <a class="nws-link" href="${esc(dsc.url)}" target="_blank" rel="noopener">Read the full discussion</a>`;
    }

    // ----- how each team plays in weather -----
    function records(g, r) {
      const el = document.getElementById('gv-wxrec'); if (!el) return;
      if (!r) { el.innerHTML = `<h3>Built for the weather?</h3><p class="gv-sub">Team weather records aren't available for this game.</p>`; return; }
      const building = !r.ready || (r.progress && !r.progress.ready);
      const prog = r.progress ? `${r.progress.done} of ${r.progress.total} weeks gathered` : '';
      if (!r.home?.games && !r.away?.games) {
        el.innerHTML = `<h3>Built for the weather?</h3><p class="gv-sub">Gathering every outdoor game since ${r.from} and the weather it was played in${prog ? ` (${prog})` : ''}. Check back soon.</p>`;
        Season.nudge();
        return;
      }
      const main = r.cats.includes('snow') ? 'snow' : r.cats.includes('frigid') ? 'frigid' : r.cats.includes('freezing') ? 'freezing' : r.cats[0];
      const label = n => n >= 75 ? 'Built for this' : n >= 60 ? 'Ready for it' : n >= 45 ? 'Should be fine' : n >= 30 ? 'Could struggle' : 'Out of their element';
      const card = side => {
        const s = r[side], t = g[side]; if (!s) return '';
        const best = s.best?.[main];
        const chips = Object.keys(CATS).filter(k => s.cats?.[k]).map(k => `<span class="wr-chip${r.cats.includes(k) ? ' on' : ''}" title="${esc(CAT_HINT[k])}">${CATS[k]} <b>${rec(s.cats[k])}</b></span>`).join('');
        return `<div class="wr-team">
          <div class="wr-top">${logo(t)}<span><b>${esc(t.name)}</b><small>${s.home === 'dome' ? 'Indoor home' : s.home === 'warm' ? 'Warm-weather home' : s.home === 'cold' ? 'Cold-weather home' : 'Outdoor home'}</small></span>
            ${s.rating != null ? `<span class="wr-score"><b>${s.rating}</b><small>${label(s.rating)}</small></span>` : ''}</div>
          ${s.rating != null ? `<div class="wr-bar"><i style="width:${s.rating}%"></i></div>` : ''}
          ${s.reasons?.length ? `<ul class="wr-why">${s.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${chips ? `<div class="wr-chips">${chips}</div>` : `<p class="gv-sub">No weather games on record since ${r.from}.</p>`}
          ${best ? `<p class="wr-best">Signature ${CATS[main].toLowerCase()} game: ${best.us > best.them ? 'W' : best.us < best.them ? 'L' : 'T'} ${best.us}-${best.them} ${best.home ? 'vs' : 'at'} ${esc(best.opp)}, ${esc(day(best.t))} (${main === 'snow' ? `${best.sn}″ of snow` : main === 'wind' ? `gusts to ${best.gu} mph` : main === 'rain' ? `${best.rn}″ of rain` : `${best.kf}° at kickoff`})</p>` : ''}
        </div>`;
      };
      const flag = r.flag ? `<p class="wr-flag">${esc(g[r.flag.abbr === g.away.abbr ? 'away' : 'home'].name)}: a ${r.flag.kind === 'dome' ? 'dome' : 'warm-weather'} team heading out into the cold.</p>` : '';
      el.innerHTML = `<h3>Built for the weather?</h3>
        <p class="gv-sub">${r.cats.length ? `This one looks like a ${r.cats.map(k => CATS[k].toLowerCase()).join(', ')} game. ` : ''}Records in every outdoor weather game since ${r.from}${building ? ` (still gathering: ${prog})` : ''}.</p>
        ${flag}<div class="wr-grid">${card('away')}${card('home')}</div>
        <p class="gv-source">The weather rating mixes each team's record in this kind of weather, how often it runs the ball this season, and where it plays its home games. Snow = ${CAT_HINT.snow}; freezing = ${CAT_HINT.freezing}; wind = ${CAT_HINT.wind}.</p>`;
      if (building) Season.nudge();
    }

    // ----- after the game: the forecast vs. what actually happened -----
    async function box(g, b) {
      const el = document.getElementById('gv-wxbox'); if (!el) return;
      if (!b) { el.innerHTML = `<h3>Weather box score</h3><p class="gv-sub">The weather box score for this game isn't available.</p>`; return; }
      const f = b.forecast, a = b.actual;
      const row = (label, fc, ac, fmt, close) => `<tr><th>${label}</th><td>${fc == null ? '–' : fmt(fc)}</td><td><b>${fmt(ac)}</b></td><td class="${close ? 'ok' : 'off'}">${fc == null ? '' : close ? 'Nailed it' : 'Off'}</td></tr>`;
      const rows = [
        row('Snow', f?.snowIn, a.snowIn, v => inches(v), f && Math.abs(f.snowIn - a.snowIn) <= 0.3),
        row('Low temp', f?.lowF, a.lowF, v => `${v}°`, f && Math.abs(f.lowF - a.lowF) <= 3),
        row('Wind', f?.windAvgMph, a.windAvgMph, v => `${v} mph`, f && f.windAvgMph != null && Math.abs(f.windAvgMph - a.windAvgMph) <= 4),
        row('Gusts', f?.gustMph, a.gustMph, v => `${v} mph`, f && f.gustMph != null && Math.abs(f.gustMph - a.gustMph) <= 6)
      ].join('');
      const verdict = !f ? 'No forecast was saved before kickoff, so there\'s no grade for this one.'
        : a.snowIn - f.snowIn > 0.3 ? `More snow fell than forecast: ${inches(a.snowIn)} vs ${inches(f.snowIn)}.`
        : f.snowIn - a.snowIn > 0.3 ? `Less snow than forecast: ${inches(a.snowIn)} fell, ${inches(f.snowIn)} was expected.`
        : Math.abs(f.lowF - a.lowF) > 5 ? `It ran ${a.lowF < f.lowF ? 'colder' : 'warmer'} than forecast, bottoming out at ${a.lowF}°.`
        : 'The forecast held up.';
      const extremes = [a.snowIn >= 0.1 ? `${inches(a.snowIn)} of snow` : '', `${a.lowF}° low (felt like ${a.feelsLowF}°)`, a.gustMph >= 20 ? `gusts to ${a.gustMph} mph` : '', a.rainIn >= 0.05 ? `${a.rainIn.toFixed(2)}″ of rain` : '', a.visYd != null && a.visYd < 1000 ? `visibility down to ${a.visYd} yards` : ''].filter(Boolean).join(', ');
      el.innerHTML = `<h3>Weather box score</h3>
        <p class="gv-sub">What the last forecast before kickoff said, and what the game actually got at ${esc(b.venue || g.venue.name)}.</p>
        <div class="wb-head">${b.grade ? `<span class="wb-grade g-${b.grade.letter[0]}"><b>${esc(b.grade.letter)}</b><small>Forecast grade</small></span>` : ''}<p>${esc(verdict)} The game got ${esc(extremes)}.</p></div>
        <table class="wb-table"><thead><tr><th></th><th>Forecast</th><th>Actual</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <div class="wb-kicks" id="wb-kicks">${b.kicks?.length ? '<p class="gv-sub">Checking the kicks…</p>' : '<p class="gv-sub">No field goals tried in this one.</p>'}</div>`;
      if (!b.kicks?.length) return;
      // every field goal, against what the model would have given the kicker in that wind
      const inf = await Kicker.load(g).catch(() => null);
      const kEl = document.getElementById('wb-kicks'); if (!kEl) return;
      const careerOf = abbr => { const ks = inf?.kickers || {}; return (ks.home?.team === abbr ? ks.home : ks.away?.team === abbr ? ks.away : abbr === g.home.abbr ? ks.home : ks.away)?.career || null; };
      let exp = 0, made = 0;
      const items = b.kicks.map(k => {
        const pts = Kicker.fly({ F: k.f ?? a.kickF, wet: !!k.snow || a.rainIn > 0.05, maxYd: 75 });
        const p = k.yd ? Kicker.chance(careerOf(k.team), k.yd, Kicker.NORMAL / Math.max(20, Kicker.rangeOf(pts)), 0) * (1 - Math.min(0.25, Math.max(0, (k.g || 0) - 12) / 80)) : null;
        if (p != null) exp += p; if (k.made) made++;
        const tag = p == null ? '' : k.made && p < 0.55 ? 'Beat the odds' : !k.made && p > 0.8 ? 'Tough miss' : k.made ? 'As expected' : 'Expected trouble';
        return `<li class="${k.made ? 'made' : 'miss'}"><span class="wb-k-q">Q${k.q ?? '?'} ${esc(k.clock || '')}</span><span class="wb-k-main"><b>${esc(k.team || '')} ${k.yd ? k.yd + ' yd' : ''} · ${k.made ? 'Good' : k.blocked ? 'Blocked' : 'No good'}</b><small>${k.w != null ? `${k.w} mph wind${k.g > k.w ? `, gusting ${k.g}` : ''}${k.d != null ? ` from the ${compass(k.d)}` : ''}, ` : ''}${k.f ?? a.kickF}°${k.snow ? ', snowing' : ''}</small></span>${p != null ? `<span class="wb-k-p"><b>${Math.round(p * 100)}%</b><small>${tag}</small></span>` : ''}</li>`;
      });
      kEl.innerHTML = `<h4>The kicks</h4><p class="gv-sub">Kickers went ${made} for ${b.kicks.length}${exp ? `; the model expected about ${exp.toFixed(1)} makes in that weather` : ''}.</p><ul class="wb-k">${items.join('')}</ul>`;
    }
    return { alertsSlot, notesSection, recordsSection, boxSection, fill };
  })();

  // ---------- Snow season tracker (home screen) ----------
  const Season = (() => {
    let nudging = false;
    // the backend builds the weather log a week at a time; while the app is open it helps it along
    async function nudge() {
      if (DEMO || nudging || state.data?.ledger?.ready) return;
      nudging = true;
      try {
        for (let i = 0; i < 12; i++) {
          const r = await (await fetch(API + '/ledger?build=1', { cache: 'no-store' })).json();
          if (r && r.total) state.data.ledger = { done: r.done, total: r.total, ready: r.ready, from: r.from };
          if (!r || r.error || r.complete || r.ready) break;
          await new Promise(res => setTimeout(res, r.busy ? 15000 : 1200));
        }
        const s = await (await fetch(API + '/season', { cache: 'no-store' })).json();
        if (s && s.season) { state.data.season = s; render(); }
      } catch (e) { /* next time */ }
      nudging = false;
    }
    const short = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const line = (x, val) => `<li><span class="ss-teams">${logo({ abbr: x.a, name: x.a })}${logo({ abbr: x.h, name: x.h })}</span><span class="ss-game"><b>${esc(x.a)} ${x.as}, ${esc(x.h)} ${x.hs}</b><small>${esc(x.v)} · ${esc(short(x.t))}</small></span><span class="ss-val">${val}</span></li>`;
    function render() {
      const box = $('#season'); if (!box) return;
      const s = state.data?.season, L = state.data?.ledger;
      const yr = s?.season || new Date().getFullYear() - (new Date().getMonth() < 5 ? 1 : 0);
      if (!s || !s.games) {
        box.innerHTML = L && !L.ready ? `<h2 class="section-head">Snow season ${yr}</h2><p class="empty">Building this season's weather log, game by game (${L.done} of ${L.total} weeks of data gathered since ${L.from}).</p>` : '';
        if (L && !L.ready) nudge();
        return;
      }
      const c = s.counts || {};
      const chip = (n, label, cls) => `<span class="ss-count ${cls}"><b>${n}</b><small>${label}</small></span>`;
      const card = (title, list, val, empty) => `<div class="ss-card"><h3>${title}</h3>${list?.length ? `<ol>${list.map(x => line(x, val(x))).join('')}</ol>` : `<p class="empty">${empty}</p>`}</div>`;
      const top = (s.stadiums || []).slice(0, 6);
      box.innerHTML = `<h2 class="section-head">Snow season ${s.season}</h2>
        <p class="rank-sub">All ${s.games} outdoor games so far this season, and the weather they were played in.</p>
        <div class="ss-counts">${chip(c.snow || 0, `snow game${c.snow === 1 ? '' : 's'}`, 'snow')}${chip(c.freezing || 0, 'freezing kickoffs', 'cold')}${chip(c.wind || 0, 'wind games', 'wind')}${chip(c.rain || 0, 'rain games', 'rain')}</div>
        <div class="ss-grid">
          ${card('Snowiest', s.snowiest, x => inches(x.sn), 'No snow games yet. The season\'s first one is coming.')}
          ${card('Coldest', s.coldest, x => `${x.kf}°`, 'Nothing cold yet.')}
          ${card('Windiest', s.windiest, x => `${x.gu} mph`, 'Nothing windy yet.')}
        </div>
        ${top.length ? `<h3 class="ss-sub">Stadium weather leaderboard</h3><ol class="rank-list ss-stadiums">${top.map((x, i) => `<li class="rank-row"><span class="rank-n">${i + 1}</span><span class="rank-name"><b>${esc(x.name)}</b><small>${[x.snow ? `${x.snow} snow` : '', x.freezing ? `${x.freezing} freezing` : '', x.wind ? `${x.wind} windy` : '', x.rain ? `${x.rain} rainy` : ''].filter(Boolean).join(' · ')}${x.coldest != null ? ` · coldest ${x.coldest}°` : ''}</small></span><span class="rank-pct">${x.snowIn ? inches(x.snowIn) : `${x.games} gm`}</span></li>`).join('')}</ol>` : ''}
        ${L && !L.ready ? `<p class="rank-sub">Still gathering past seasons for the team records (${L.done} of ${L.total} weeks).</p>` : ''}`;
      if (L && !L.ready) nudge();
    }
    return { render, nudge };
  })();

  // ---------- Game stats (score by quarter, leaders, team stats) ----------
  const Stats = (() => {
    let timer = null, currentId = null;
    function section(g) {
      return `<section class="gv-chart gamestats" id="gv-gamestats">${render(g, null)}</section>`;
    }
    function render(g, d) {
      const pre = !g.live && !g.final && (!d || d.state === 'pre');
      const parts = [];
      // line score
      const lines = d?.teams?.length ? Object.fromEntries(d.teams.map(t => [t.abbr, t.lines])) : g.lines ? { [g.away.abbr]: g.lines.away, [g.home.abbr]: g.lines.home } : null;
      if (!pre && lines && (lines[g.away.abbr]?.length || lines[g.home.abbr]?.length)) {
        const n = Math.max(4, lines[g.away.abbr]?.length || 0, lines[g.home.abbr]?.length || 0);
        const head = Array.from({ length: n }, (_, i) => `<th>${i < 4 ? i + 1 : 'OT'}</th>`).join('');
        const row = (t, score) => `<tr><td class="ls-team">${logo(t)}${esc(t.abbr)}</td>${Array.from({ length: n }, (_, i) => `<td>${lines[t.abbr]?.[i] ?? ''}</td>`).join('')}<td class="ls-total">${score ?? ''}</td></tr>`;
        parts.push(`<table class="linescore"><thead><tr><th></th>${head}<th>T</th></tr></thead>
          <tbody>${row(g.away, g.score?.away)}${row(g.home, g.score?.home)}</tbody></table>`);
      }
      // records
      const rec = abbr => (d?.teams?.find(t => t.abbr === abbr)?.record || []);
      const recText = t => { const r = rec(t.abbr); const total = r.find(x => /total|overall/i.test(x.type)) || r[0]; return total?.summary || t.record || ''; };
      if (pre) {
        parts.push(`<div class="records">${[g.away, g.home].map(t => `<div>${logo(t)}<b>${esc(t.name)}</b><span>${esc(recText(t)) || '–'}</span></div>`).join('')}</div>`);
      }
      // leaders
      const leaders = d?.leaders?.length ? d.leaders : (g.leaders || []).map(l => ({ team: l.team, cat: l.cat, name: l.name, line: l.line }));
      if (leaders.length) {
        const byTeam = {};
        for (const l of leaders) (byTeam[l.team || '—'] ||= []).push(l);
        const order = [g.away.abbr, g.home.abbr, ...Object.keys(byTeam).filter(k => k !== g.away.abbr && k !== g.home.abbr)];
        parts.push(`<div class="leaders">${order.filter(k => byTeam[k]).map(k => `
          <div class="ld-team"><p class="ld-head">${esc(k === '—' ? 'Leaders' : (k === g.away.abbr ? g.away.name : k === g.home.abbr ? g.home.name : k))}</p>
          ${byTeam[k].map(l => `<div class="ld-row"><span class="ld-cat">${esc(shortCat(l.cat))}</span><span class="ld-name">${esc(l.name)}</span><span class="ld-line">${esc(l.line)}</span></div>`).join('')}</div>`).join('')}
        </div>`);
      }
      // team stats
      const ts = d?.teamStats;
      if (!pre && ts?.length === 2) {
        const [a, h] = [ts.find(t => t.abbr === g.away.abbr) || ts[0], ts.find(t => t.abbr === g.home.abbr) || ts[1]];
        const keys = ['totalYards', 'netPassingYards', 'rushingYards', 'firstDowns', 'thirdDownEff', 'turnovers', 'possessionTime'].filter(k => a.stats[k] || h.stats[k]);
        if (keys.length) parts.push(`<table class="team-stats"><thead><tr><th>${esc(g.away.abbr)}</th><th></th><th>${esc(g.home.abbr)}</th></tr></thead><tbody>
          ${keys.map(k => `<tr><td>${esc(a.stats[k]?.value ?? '–')}</td><th>${esc((a.stats[k] || h.stats[k]).label)}</th><td>${esc(h.stats[k]?.value ?? '–')}</td></tr>`).join('')}</tbody></table>`);
      }
      const title = pre ? 'Tale of the tape' : g.final ? 'Final stats' : 'Game stats';
      const sub = pre ? 'Records and season leaders' : g.final ? 'Score by quarter and game leaders' : 'Updating live';
      if (!parts.length) parts.push(`<p class="gv-sub">${d ? 'Stats will appear here closer to kickoff.' : 'Loading stats…'}</p>`);
      return `<h3>${title}</h3><p class="gv-sub">${sub}</p>${parts.join('')}`;
    }
    const shortCat = c => String(c || '').replace(/ Yards$/i, '').replace(/^passingYards$/i, 'Passing').replace(/^rushingYards$/i, 'Rushing').replace(/^receivingYards$/i, 'Receiving').replace(/^PASS$/i, 'Passing').replace(/^RUSH$/i, 'Rushing').replace(/^REC$/i, 'Receiving');
    async function load(g) {
      stop();
      currentId = g.id;
      const box = () => document.getElementById('gv-gamestats');
      const fetchOnce = async () => {
        let d = null;
        try { d = DEMO ? demoStats(g) : await (await fetch(API + '/game?id=' + encodeURIComponent(g.id), { cache: 'no-store' })).json(); } catch (e) { d = null; }
        if (currentId !== g.id || !box()) return;
        const fresh = state.data.games.find(x => String(x.id) === String(g.id)) || g;
        box().innerHTML = render(fresh, d && !d.error ? d : null);
        Extras.fill(fresh, d && !d.error ? d : null);
        Bingo.update(fresh, d && !d.error ? d : null);
      };
      await fetchOnce();
      if (g.live) timer = setInterval(() => { if (document.visibilityState === 'visible') fetchOnce(); }, 60000);
    }
    function stop() { clearInterval(timer); timer = null; currentId = null; }
    return { section, load, stop };
  })();

  // ---------- Stadium photo behind the game (Night Game theme) ----------
  const Photo = (() => {
    const mem = new Map();
    async function load(g) {
      const box = $('#gv-photo');
      box.style.backgroundImage = ''; box.classList.remove('on');
      const credit = document.getElementById('photo-credit');
      if (credit) credit.textContent = '';
      if (DEMO || !g.venue?.name) return;
      let p = mem.get(g.venue.name) || store.get('photo:' + g.venue.name, null);
      if (!p) {
        try { p = await (await fetch(API + '/photo?v=' + encodeURIComponent(g.venue.name))).json(); } catch (e) { p = null; }
        if (p) { mem.set(g.venue.name, p); if (p.url) store.set('photo:' + g.venue.name, p); }
      }
      if (!p || !p.url || GameView.current()?.id !== g.id) return;
      const img = new Image();
      img.onload = () => {
        if (GameView.current()?.id !== g.id) return;
        box.style.backgroundImage = `url("${p.url}")`;
        box.classList.add('on');
        const c = document.getElementById('photo-credit');
        if (c) c.innerHTML = `Stadium photo: <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.artist)}</a>, ${esc(p.license)}, via Wikimedia Commons.`;
      };
      img.src = p.url;
    }
    return { load };
  })();

  // ---------- Loading screen ----------
  const Splash = (() => {
    const el = $('#splash');
    const started = performance.now();
    let raf = null, done = false;
    const c = $('#splash-snow'), ctx = c.getContext('2d');
    const flakes = [];
    function frame() {
      const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      if (flakes.length < 140) flakes.push({ x: Math.random() * W, y: -10, r: 0.8 + Math.random() * 2.6, v: 0.6 + Math.random() * 1.6, ph: Math.random() * 6 });
      ctx.fillStyle = '#EEF5FA';
      for (const f of flakes) {
        f.y += f.v; f.ph += 0.02;
        if (f.y > H + 5) { f.y = -10; f.x = Math.random() * W; }
        ctx.globalAlpha = 0.35 + f.r / 4; ctx.beginPath(); ctx.arc(f.x + Math.sin(f.ph) * 6, f.y, f.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    if (!REDUCED) raf = requestAnimationFrame(frame);
    const lines = ['Checking the forecast', 'Reading the radar', 'Scouting the stadiums', 'Shoveling the yard lines'];
    let li = 0;
    const lineTimer = setInterval(() => { const s = $('#splash-sub'); if (s) s.textContent = lines[++li % lines.length]; }, 900);
    function hide() {
      if (done) return; done = true;
      const wait = Math.max(0, (REDUCED ? 400 : 1300) - (performance.now() - started));
      setTimeout(() => {
        el.classList.add('out');
        clearInterval(lineTimer);
        setTimeout(() => { el.hidden = true; cancelAnimationFrame(raf); }, 500);
      }, wait);
    }
    setTimeout(hide, 9000); // never get stuck
    return { hide };
  })();

  // =====================================================================================
  // ---------- Themes ----------
  const themeLogo = t => !t || t === 'night'
    ? { badge: 'icons/logo-badge.png', mark: 'icons/mark-mini-96.png', fav: 'icons/favicon-32.png' }
    : { badge: `icons/logo-badge-${t}.png`, mark: `icons/mark-${t}-96.png`, fav: `icons/favicon-${t}-32.png` };
  const Theme = (() => {
    const get = () => store.get('theme', 'night');
    function apply(t) {
      document.documentElement.dataset.theme = t;
      // each theme has its own version of the logo
      const L = themeLogo(t);
      const hm = document.getElementById('header-mark'); if (hm && !hm.src.endsWith(L.mark)) hm.src = L.mark;
      const sl = document.getElementById('splash-logo'); if (sl && !sl.src.endsWith(L.badge)) sl.src = L.badge;
      const fv = document.getElementById('favicon'); if (fv) fv.href = L.fav;
      document.querySelectorAll('[data-theme-pick]').forEach(b => b.classList.toggle('on', b.dataset.themePick === t));
      Turf.enable(t === 'field');
      if (t === 'field') Turf.set(GameView.isOpen() ? turfFor(GameView.current()) : homeTurf());
    }
    function set(t) {
      const was = get(); store.set('theme', t);
      if (t === 'retro' && was !== 'retro') Retro.bars();
      // the scoreboard bulbs flicker on
      if (t === 'ninety' && was !== 'ninety' && !REDUCED) NinetyWipe();
      if (t === 'scoreboard' && was !== 'scoreboard' && !REDUCED) { document.documentElement.classList.add('sb-on'); setTimeout(() => document.documentElement.classList.remove('sb-on'), 1200); }
      apply(t); Sound.crunch();
    }
    return { get, set, apply, field: () => get() === 'field' };
  })();
  function turfFor(g) {
    if (!g) return {};
    const w = g.wx || {};
    const f = g.venue?.facts || {};
    const live = g.live && g.liveWx;
    return {
      surface: f.surface || 'grass',
      snow: g.roof === 'dome' ? 0 : (live ? g.liveWx.snowSoFarIn : (w.snowIn || 0)) + (w.snowDepthIn || 0),
      rain: g.roof !== 'dome' && (w.rainHours || 0) > 0 && (w.precipChance || 0) >= 40 && g.level === 0,
      wind: g.roof === 'dome' ? 0 : Math.min(1, Math.max(0, ((live ? g.liveWx.g : w.gustMph) || 0) - 14) / 22),
      night: w.night !== false,
      dome: g.roof === 'dome'
    };
  }
  function homeTurf() {
    const f = state.featured || [];
    const games = state.data?.games || [];
    const g = f[0] || games.filter(x => x.wx && !x.final).sort((a, b) => a.wx.lowF - b.wx.lowF)[0];
    return turfFor(g);
  }

  // ---------- On the Field: a football field that shows the weather ----------
  // Grass (or turf) with mowing stripes, yard lines and numbers. Rain makes it dark, glossy and muddy;
  // snow dusts it, covers it, and in deep snow the crews have plowed the yard lines clear.
  // Wind sends waves across the grass or blows snow across the field.
  const Turf = (() => {
    const canvas = $('#turf');
    const ctx = canvas.getContext('2d');
    let on = false, cond = null, base = null, raf = null, last = 0, W = 0, H = 0, dpr = 1, parts = [], ripples = [], t0 = performance.now();
    const rnd = (a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; });

    function grassTile(turf) {
      const t = document.createElement('canvas'); t.width = t.height = 192;
      const g = t.getContext('2d'), r = rnd(turf ? 11 : 7);
      g.fillStyle = turf ? '#2F7A3A' : '#2E6E2F'; g.fillRect(0, 0, 192, 192);
      if (turf) {
        for (let i = 0; i < 2600; i++) { g.fillStyle = `hsla(${125 + r() * 12},${45 + r() * 15}%,${26 + r() * 14}%,0.9)`; g.fillRect(r() * 192, r() * 192, 1, 2 + r() * 2); }
        for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(15,15,15,0.55)'; g.fillRect(r() * 192, r() * 192, 1.2, 1.2); }   // rubber infill
      } else {
        for (let i = 0; i < 5200; i++) {
          const x = r() * 192, y = r() * 192, len = 3 + r() * 6, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
          g.strokeStyle = `hsla(${95 + r() * 30},${40 + r() * 25}%,${18 + r() * 26}%,${0.55 + r() * 0.4})`;
          g.lineWidth = 0.6 + r() * 0.9;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
        }
      }
      return t;
    }

    // Plowing: a snow-free copy of the field shows through wherever you've swiped
    let bare = null, plow = null, rim = null, plowTmp = null, plowAt = null, plowHinted = store.get('plowHint', false);
    function build() {
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      W = innerWidth; H = innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      const c = cond || {};
      base = paint(c);
      bare = (c.snow || 0) >= 0.5 ? paint({ ...c, snow: 0, wind: 0 }) : null;
      const mk = () => { const x = document.createElement('canvas'); x.width = W * dpr; x.height = H * dpr; return x; };
      plow = bare ? mk() : null; rim = bare ? mk() : null; plowTmp = bare ? mk() : null;
      if (bare && !plowHinted && !REDUCED) { plowHinted = true; store.set('plowHint', true); setTimeout(() => toast('Deep snow! Swipe the field to plow it.'), 3500); }
    }
    function paint(c) {
      const out = document.createElement('canvas'); out.width = W * dpr; out.height = H * dpr;
      const b = out.getContext('2d'); b.scale(dpr, dpr);
      const turf = c.surface === 'turf';
      const r = rnd(42);
      const L = 64;                       // 5 yards
      const side = 14;
      const snow = c.snow || 0;
      const deep = snow >= 2, cover = Math.min(1, snow / 1.4);

      // grass + mowing stripes
      b.fillStyle = b.createPattern(grassTile(turf), 'repeat'); b.fillRect(0, 0, W, H);
      for (let y = -L; y < H + L; y += L) {
        const i = Math.floor(y / L);
        b.fillStyle = i % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
        b.fillRect(0, y, W, L);
      }
      const drawLines = (alpha) => {
        b.save(); b.globalAlpha = alpha;
        b.fillStyle = '#F4F7F2';
        b.fillRect(side - 4, 0, 5, H); b.fillRect(W - side - 1, 0, 5, H);                 // sidelines
        for (let y = 0, i = 0; y < H + L; y += L, i++) {
          b.fillRect(side, y - 1.5, W - side * 2, 3);                                         // yard lines
          for (let k = 1; k < 5; k++) {                                                        // hash marks
            const hy = y + k * L / 5;
            b.fillRect(side + 2, hy - 0.8, 9, 1.6); b.fillRect(W - side - 11, hy - 0.8, 9, 1.6);
            b.fillRect(W * 0.4 - 5, hy - 0.8, 10, 1.6); b.fillRect(W * 0.6 - 5, hy - 0.8, 10, 1.6);
          }
          if (i % 2 === 0) {                                                                    // numbers every 10 yards
            const n = [10, 20, 30, 40, 50, 40, 30, 20, 10][i / 2 % 9] || 50;
            b.font = '700 28px "Big Shoulders Display", sans-serif'; b.textAlign = 'center'; b.textBaseline = 'middle';
            b.save(); b.translate(side + 34, y); b.rotate(Math.PI / 2); b.fillText(String(n), 0, 0); b.restore();
            b.save(); b.translate(W - side - 34, y); b.rotate(-Math.PI / 2); b.fillText(String(n), 0, 0); b.restore();
          }
        }
        b.restore();
      };
      drawLines(1);

      // rain: dark, glossy, muddy (grass) or slick (turf)
      if (c.rain && !snow) {
        b.fillStyle = 'rgba(8,20,12,0.35)'; b.fillRect(0, 0, W, H);
        if (!turf) {
          // churned-up mud between the hashes, where most of the plays happen
          for (let i = 0; i < 70; i++) {
            const cx = W * (0.28 + r() * 0.44) + (r() - 0.5) * 40, cy = r() * H;
            const rx = 10 + r() * 34, ry = 4 + r() * 12;
            b.save(); b.translate(cx, cy); b.rotate((r() - 0.5) * 0.9); b.scale(1, ry / rx);
            const g = b.createRadialGradient(0, 0, 0, 0, 0, rx);
            g.addColorStop(0, `rgba(${70 + r() * 22},${48 + r() * 12},${28 + r() * 8},${0.32 + r() * 0.22})`);
            g.addColorStop(0.7, `rgba(${80 + r() * 18},${56 + r() * 10},${32 + r() * 8},0.14)`);
            g.addColorStop(1, 'rgba(80,56,32,0)');
            b.fillStyle = g; b.beginPath(); b.arc(0, 0, rx, 0, 6.283); b.fill();
            b.restore();
          }
          for (let i = 0; i < 260; i++) {   // cleat marks
            b.strokeStyle = `rgba(60,40,22,${0.15 + r() * 0.2})`; b.lineWidth = 1 + r() * 1.5;
            const x = W * (0.25 + r() * 0.5), y = r() * H, a = (r() - 0.5) * 1.4, l = 3 + r() * 7;
            b.beginPath(); b.moveTo(x, y); b.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); b.stroke();
          }
        }
        for (let i = 0; i < (turf ? 6 : 10); i++) {                                           // puddles
          const cx = side + r() * (W - side * 2), cy = r() * H, rx = 16 + r() * 34, ry = rx * (0.35 + r() * 0.2);
          const g = b.createRadialGradient(cx, cy - ry * 0.4, 0, cx, cy, rx);
          g.addColorStop(0, 'rgba(150,175,195,0.35)'); g.addColorStop(0.7, 'rgba(40,60,70,0.45)'); g.addColorStop(1, 'rgba(40,60,70,0)');
          b.fillStyle = g; b.beginPath(); b.ellipse(cx, cy, rx, ry, 0, 0, 6.283); b.fill();
          ripples.push({ x: cx, y: cy, rx, ry });
        }
        const sheen = b.createLinearGradient(0, 0, W, H);
        sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.45, 'rgba(220,235,255,0.10)'); sheen.addColorStop(0.55, 'rgba(220,235,255,0.02)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
        b.fillStyle = sheen; b.fillRect(0, 0, W, H);
      }

      // snow: a dusting, then full cover, then plowed yard lines in deep snow
      if (snow > 0) {
        const snowLayer = document.createElement('canvas'); snowLayer.width = W * dpr; snowLayer.height = H * dpr;
        const s = snowLayer.getContext('2d'); s.scale(dpr, dpr);
        if (cover < 1) {
          // dusting: speckles that get denser as snow builds; grass shows through
          const n = Math.floor(W * H / 22 * cover);
          for (let i = 0; i < n; i++) { s.fillStyle = `rgba(245,249,252,${0.5 + r() * 0.5})`; const x = r() * W, y = r() * H, z = 0.8 + r() * 2.2; s.fillRect(x, y, z, z); }
          s.fillStyle = `rgba(236,243,248,${cover * 0.55})`; s.fillRect(0, 0, W, H);
        } else {
          s.fillStyle = '#EEF4F8'; s.fillRect(0, 0, W, H);
          for (let i = 0; i < 90; i++) {                                                     // soft drifts
            const x = r() * W, y = r() * H, rad = 40 + r() * 120;
            const g = s.createRadialGradient(x, y, 0, x, y, rad);
            g.addColorStop(0, r() > 0.5 ? 'rgba(255,255,255,0.7)' : 'rgba(170,195,215,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            s.fillStyle = g; s.fillRect(x - rad, y - rad, rad * 2, rad * 2);
          }
          for (let i = 0; i < W * H / 60; i++) { s.fillStyle = `rgba(185,205,222,${r() * 0.35})`; s.fillRect(r() * W, r() * H, 1.5, 1.5); }
        }
        b.drawImage(snowLayer, 0, 0, W, H);
        if (cover >= 1 && !deep) drawLines(0.22);                                             // lines barely visible under snow
        if (deep) {
          // plowed yard lines: a cleared strip of grass with banks of snow on both sides
          for (let y = 0; y < H + L; y += L) {
            const strip = 9;
            b.save();
            b.beginPath(); b.rect(side, y - strip, W - side * 2, strip * 2); b.clip();
            b.fillStyle = b.createPattern(grassTile(turf), 'repeat'); b.fillRect(side, y - strip, W - side * 2, strip * 2);
            b.fillStyle = 'rgba(0,0,0,0.18)'; b.fillRect(side, y - strip, W - side * 2, strip * 2);
            b.fillStyle = '#F4F7F2'; b.fillRect(side, y - 1.5, W - side * 2, 3);
            b.restore();
            for (const dir of [-1, 1]) {                                                       // snow banks
              const by = y + dir * strip;
              const g = b.createLinearGradient(0, by, 0, by + dir * 14);
              g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(225,236,245,0.9)'); g.addColorStop(1, 'rgba(160,185,205,0)');
              b.fillStyle = g; b.fillRect(side, Math.min(by, by + dir * 14), W - side * 2, 14);
              b.fillStyle = 'rgba(70,95,120,0.35)'; b.fillRect(side, by - (dir < 0 ? 0 : 2), W - side * 2, 2);
              b.fillStyle = '#FFFFFF';
              b.beginPath(); b.moveTo(side, by);
              for (let x = side; x <= W - side; x += 6) b.lineTo(x, by - dir * (2 + Math.abs(Math.sin(x * 0.09 + y)) * 3));
              b.lineTo(W - side, by); b.closePath(); b.fill();
            }
          }
        }
      }

      // lighting: night game under the lights, or a gray winter afternoon
      if (c.night !== false || c.dome) {
        b.fillStyle = `rgba(4,10,20,${snow > 0 ? 0.34 : 0.5})`; b.fillRect(0, 0, W, H);
        for (const x of [0, W]) {
          const g = b.createRadialGradient(x, 0, 0, x, 0, Math.max(W, H) * 0.75);
          g.addColorStop(0, 'rgba(255,236,190,0.32)'); g.addColorStop(1, 'rgba(255,236,190,0)');
          b.fillStyle = g; b.fillRect(0, 0, W, H);
        }
      } else {
        b.fillStyle = 'rgba(20,32,44,0.38)'; b.fillRect(0, 0, W, H);
      }
      const vig = b.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.8);
      vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.45)');
      b.fillStyle = vig; b.fillRect(0, 0, W, H);
      // extra shade behind the reading area so text stays crisp over bright snow
      if (snow > 0) { b.fillStyle = `rgba(6,14,26,${0.06 + cover * 0.08})`; b.fillRect(0, 0, W, H); }
      return out;
    }

    function composite() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base, 0, 0);
      if (bare && plow) {
        ctx.drawImage(rim, 0, 0);                                     // banks of snow along the plowed path
        const t = plowTmp.getContext('2d');
        t.globalCompositeOperation = 'copy'; t.drawImage(plow, 0, 0);
        t.globalCompositeOperation = 'source-in'; t.drawImage(bare, 0, 0);
        t.globalCompositeOperation = 'source-over';
        ctx.drawImage(plowTmp, 0, 0);
      }
      if (plowAt && performance.now() - plowAt.t < 700) drawPlow(plowAt.x, plowAt.y, plowAt.a);
    }
    function drawPlow(x, y, a) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-14, -9, 30, 20);
      ctx.fillStyle = '#F5B841'; ctx.fillRect(-16, -11, 22, 22);                // body
      ctx.fillStyle = '#2B3A4A'; ctx.fillRect(-12, -8, 9, 16);                  // cab window
      ctx.fillStyle = '#D9DEE3'; ctx.beginPath(); ctx.moveTo(8, -15); ctx.lineTo(14, -15); ctx.lineTo(16, 15); ctx.lineTo(8, 15); ctx.closePath(); ctx.fill();   // blade
      ctx.fillStyle = '#FF8A3D'; ctx.fillRect(-10, -13, 4, 3);                  // beacon
      ctx.restore();
    }
    function plowLine(x0, y0, x1, y1) {
      if (!plow) return;
      const pc = plow.getContext('2d'), rc = rim.getContext('2d');
      for (const [g, w, col] of [[rc, 46, 'rgba(255,255,255,0.95)'], [rc, 36, 'rgba(150,175,198,0.55)'], [pc, 30, '#000']]) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = col; g.lineWidth = w;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      plowAt = { x: x1, y: y1, a: Math.atan2(y1 - y0, x1 - x0), t: performance.now() };
      Sound.scrape();
      if (REDUCED || !raf) composite();
    }
    let plowing = null;
    addEventListener('pointerdown', e => { if (on && bare && !e.target.closest('button, a, input, .theme-pop, dialog')) plowing = { x: e.clientX, y: e.clientY }; }, { passive: true });
    addEventListener('pointermove', e => {
      if (!plowing) return;
      if (Math.hypot(e.clientX - plowing.x, e.clientY - plowing.y) < 4) return;
      plowLine(plowing.x, plowing.y, e.clientX, e.clientY);
      plowing = { x: e.clientX, y: e.clientY };
    }, { passive: true });
    addEventListener('pointerup', () => { plowing = null; }, { passive: true });
    addEventListener('pointercancel', () => { plowing = null; }, { passive: true });

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return;   // ~30 fps is plenty for a background
      last = now;
      if (!base) return;
      const c = cond || {};
      const t = (now - t0) / 1000;
      composite();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wind = c.wind || 0;
      // wind waves across grass: bright bands rolling with the gusts
      if (wind > 0 && (c.snow || 0) < 1.4 && !c.dome) {
        for (let k = 0; k < 3; k++) {
          const pos = ((t * (40 + wind * 90) + k * W * 0.7) % (W * 2.2)) - W * 0.6;
          const g = ctx.createLinearGradient(pos - 120, 0, pos + 120, 0);
          g.addColorStop(0, 'rgba(210,240,190,0)'); g.addColorStop(0.5, `rgba(210,240,190,${0.05 + wind * 0.09})`); g.addColorStop(1, 'rgba(210,240,190,0)');
          ctx.fillStyle = g; ctx.fillRect(pos - 120, 0, 240, H);
        }
      }
      // blowing snow across the field
      if (wind > 0.15 && (c.snow || 0) > 0) {
        if (parts.length < 70 * wind) parts.push({ x: -40, y: Math.random() * H, v: 3 + Math.random() * 5 * wind, len: 20 + Math.random() * 60, a: 0.15 + Math.random() * 0.3 });
        ctx.lineCap = 'round';
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]; p.x += p.v; p.y += Math.sin((p.x + p.len) * 0.02) * 0.4;
          if (p.x - p.len > W) { parts.splice(i, 1); continue; }
          ctx.strokeStyle = `rgba(245,250,253,${p.a})`; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len, p.y + 1.5); ctx.stroke();
        }
      }
      // raindrops landing in puddles
      if (c.rain && !c.snow) {
        for (let k = 0; k < 2; k++) {
          const pd = ripples[Math.floor(Math.random() * ripples.length)];
          if (pd && Math.random() < 0.5) (pd.r ||= []).push({ x: pd.x + (Math.random() - 0.5) * pd.rx, y: pd.y + (Math.random() - 0.5) * pd.ry, age: 0 });
        }
        for (const pd of ripples) for (let i = (pd.r || []).length - 1; i >= 0; i--) {
          const q = pd.r[i]; q.age += 0.04;
          if (q.age > 1) { pd.r.splice(i, 1); continue; }
          ctx.strokeStyle = `rgba(200,220,235,${0.5 * (1 - q.age)})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(q.x, q.y, 2 + q.age * 12, (2 + q.age * 12) * 0.45, 0, 0, 6.283); ctx.stroke();
        }
      }
      // sparkles on snow
      if ((c.snow || 0) >= 0.5) {
        for (let k = 0; k < 18; k++) {
          const x = (Math.sin(k * 91.7) * 0.5 + 0.5) * W, y = (Math.sin(k * 47.3 + 1) * 0.5 + 0.5) * H;
          const a = Math.pow(Math.max(0, Math.sin(t * 1.6 + k * 2.1)), 16);
          if (a > 0.03) { ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`; ctx.fillRect(x - 0.5, y - 3, 1, 6); ctx.fillRect(x - 3, y - 0.5, 6, 1); }
        }
      }
    }

    function enable(v) {
      on = v;
      canvas.hidden = !v;
      if (v && !raf && !REDUCED) raf = requestAnimationFrame(frame);
      if (!v && raf) { cancelAnimationFrame(raf); raf = null; }
    }
    function set(c) {
      const key = JSON.stringify(c || {});
      if (cond && JSON.stringify(cond) === key && base && W === innerWidth && H === innerHeight) return;
      cond = c || {}; parts = []; ripples = [];
      const go = () => { build(); if (REDUCED || !raf) composite(); };
      (document.fonts?.ready || Promise.resolve()).then(go);
    }
    addEventListener('resize', () => { if (on && cond) { const c = cond; cond = null; set(c); } });
    document.addEventListener('visibilitychange', () => {
      if (!on || REDUCED) return;
      if (document.visibilityState === 'hidden' && raf) { cancelAnimationFrame(raf); raf = null; }
      else if (document.visibilityState === 'visible' && !raf) raf = requestAnimationFrame(frame);
    });
    return { enable, set };
  })();

  // =====================================================================================
  // ---------- Official team wordmarks ----------
  const Wordmarks = (() => {
    let map = (store.get('wordmarks', null) || {}).map || {};
    async function load() {
      const cached = store.get('wordmarks', null);
      if (cached && Date.now() - cached.at < 7 * 86400000 && Object.keys(cached.map || {}).length) { map = cached.map; return; }
      if (DEMO) return;
      try {
        const r = await (await fetch(API + '/wordmarks')).json();
        if (r && r.map) { map = r.map; store.set('wordmarks', { at: Date.now(), map }); if (state.data) { render(); capSoon(document); GameView.refresh(); } }
      } catch (e) { /* names in text instead */ }
    }
    const fullName = t => t?.full || (t?.location && t?.name ? `${t.location} ${t.name}` : '');
    const url = t => map[fullName(t)]?.url || null;
    return { load, url, fullName };
  })();

  // Logo + official wordmark for one team. Falls back to the team name in our display type.
  function teamLine(t, size = 'sm') {
    if (!t) return '';
    const u = Wordmarks.url(t);
    const fallback = `<span class="wm-text">${snowy(t.name)}</span>`;
    const clean = u && WMClean.cached(u);
    const mark = u
      ? `<span class="capped wm-cap"><img class="wordmark${clean ? ' ready' : ''}" src="${esc(clean || u)}" data-orig="${esc(u)}"${clean ? ' data-clean="done"' : ''} alt="${esc(t.name)}" loading="lazy" data-fallback="${esc(fallback)}"></span>`
      : fallback;
    return `<span class="team-line tl-${size}">${logo(t)}${mark}</span>`;
  }
  function matchupStack(g, size = 'sm', extra = '') {
    return `<span class="matchup-stack ms-${size}">${teamLine(g.away, size)}<span class="ms-at">at</span>${teamLine(g.home, size)}${extra}</span>`;
  }

  // ---------- Two-week Snow Game Outlook ----------
  function ring(p, cls = '') {
    const r = 34, c = 2 * Math.PI * r;
    return `<svg class="ring ${cls}" viewBox="0 0 84 84" role="img" aria-label="${p}% chance of a snow game">
      <circle cx="42" cy="42" r="${r}" class="ring-bg"/>
      <circle cx="42" cy="42" r="${r}" class="ring-fg" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 42 42)"/>
      <text x="42" y="47" text-anchor="middle" class="ring-txt">${p}%</text>
    </svg>`;
  }
  const basisText = { forecast: 'Detailed forecast', ensemble: 'Ensemble forecasts + history', history: 'Stadium snow history' };
  function renderOutlook() {
    const o = state.data?.outlook;
    const box = $('#outlook');
    if (!o || !o.items?.length) {
      box.innerHTML = state.data && !DEMO ? `<h2 class="section-head">Snow Game Outlook</h2><p class="empty">Building the two-week outlook…</p>` : '';
      ensureOutlook();
      return;
    }
    const [best, ...rest] = o.items;
    const when = it => new Date(it.kickoff).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const tr = it => it.trend ? `<span class="trend ${it.trend}">${arrow(it.trend)}${it.trend === 'up' ? 'Rising' : it.trend === 'down' ? 'Falling' : 'Steady'}</span>` : '';
    const hol = it => holidayTag(it.kickoff);
    box.innerHTML = `
      <h2 class="section-head">Snow Game Outlook</h2>
      <p class="rank-sub">The best chances of a snow game over the next two weeks.</p>
      <button class="outlook-best" data-outlook="${esc(best.id)}" style="--snow:${Math.min(1, best.p / 80).toFixed(2)}" data-snowgame>
        <span class="ob-head"><span class="ob-label">${flakeIcon}Best bet</span><span>${esc(when(best))}${hol(best)}</span></span>
        <span class="ob-body">
          ${ring(best.p, best.p >= 50 ? 'hot' : '')}
          <span class="ob-teams">${matchupStack(best, 'md')}</span>
        </span>
        <span class="ob-foot"><span>${esc(best.venue.name)}</span><span class="conf conf-${best.confidence.toLowerCase()}">${best.confidence} confidence</span>${tr(best)}</span>
        <span class="ob-detail">${esc(basisText[best.basis] || '')}: ${esc(best.detail)}</span>
      </button>
      ${rest.length ? `<ol class="outlook-list">${rest.slice(0, 4).map((it, i) => `
        <li><button class="ol-row" data-outlook="${esc(it.id)}">
          <span class="ol-rank">${i + 2}</span>
          <span class="ol-main">${matchupStack(it, 'xs')}<small>${esc(when(it))} · ${esc(it.venue.name)}${hol(it)}</small></span>
          <span class="ol-p"><b>${it.p}%</b><small class="conf-${it.confidence.toLowerCase()}">${it.confidence}</small></span>
        </button></li>`).join('')}</ol>` : ''}`;
  }

  // ---------- Tilt your phone: the snow drifts that way ----------
  const Tilt = (() => {
    let x = 0, target = 0;
    addEventListener('deviceorientation', e => {
      if (e.gamma == null) return;
      target = Math.max(-1, Math.min(1, e.gamma / 35));   // left/right tilt
    });
    (function tick() { x += (target - x) * 0.08; requestAnimationFrame(tick); })();
    return { get x() { return REDUCED ? 0 : x; } };
  })();

  // ---------- Snow Game Passport: a stamp for every live snow game you follow ----------
  const STADIUM_LIST = [
    ['Highmark Stadium', 'Orchard Park, NY', 'BUF'], ['Lambeau Field', 'Green Bay, WI', 'GB'], ['Soldier Field', 'Chicago, IL', 'CHI'],
    ['Huntington Bank Field', 'Cleveland, OH', 'CLE'], ['Acrisure Stadium', 'Pittsburgh, PA', 'PIT'], ['Empower Field at Mile High', 'Denver, CO', 'DEN'],
    ['Gillette Stadium', 'Foxborough, MA', 'NE'], ['MetLife Stadium', 'East Rutherford, NJ', 'NYG'], ['GEHA Field at Arrowhead', 'Kansas City, MO', 'KC'],
    ['Paycor Stadium', 'Cincinnati, OH', 'CIN'], ['Lincoln Financial Field', 'Philadelphia, PA', 'PHI'], ['M&T Bank Stadium', 'Baltimore, MD', 'BAL'],
    ['Northwest Stadium', 'Landover, MD', 'WSH'], ['Lumen Field', 'Seattle, WA', 'SEA'], ['Nissan Stadium', 'Nashville, TN', 'TEN'],
    ['Bank of America Stadium', 'Charlotte, NC', 'CAR'], ["Levi's Stadium", 'Santa Clara, CA', 'SF'], ['EverBank Stadium', 'Jacksonville, FL', 'JAX'],
    ['Raymond James Stadium', 'Tampa, FL', 'TB'], ['Hard Rock Stadium', 'Miami Gardens, FL', 'MIA'], ['Lucas Oil Stadium', 'Indianapolis, IN', 'IND'],
    ['AT&T Stadium', 'Arlington, TX', 'DAL'], ['NRG Stadium', 'Houston, TX', 'HOU'], ['Mercedes-Benz Stadium', 'Atlanta, GA', 'ATL'],
    ['State Farm Stadium', 'Glendale, AZ', 'ARI']
  ];
  const Passport = (() => {
    const get = () => store.get('passport', {});
    function stamp(g) {
      if (!g?.venue?.name || !snowingLive(g)) return;
      const book = get();
      const isNew = !book[g.venue.name];
      const entry = book[g.venue.name] || { first: new Date().toISOString(), games: [] };
      if (!entry.games.find(x => x.id === g.id)) entry.games.push({ id: g.id, short: g.short, date: new Date().toISOString(), inches: g.liveWx?.snowSoFarIn || 0 });
      entry.best = Math.max(entry.best || 0, g.liveWx?.snowSoFarIn || 0);
      book[g.venue.name] = entry;
      store.set('passport', book);
      if (isNew) setTimeout(() => { toast(`New passport stamp: ${g.venue.name}!`); Sound.crunch(); if (navigator.vibrate) navigator.vibrate([30, 40, 30]); }, 2800);
    }
    function stampSvg(name, entry, abbr, i) {
      const got = !!entry;
      const date = got ? new Date(entry.first).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' }) : '';
      const rot = got ? ((i * 37) % 17) - 8 : 0;
      const id = 'st' + i;
      return `<div class="stamp${got ? ' got' : ''}" style="--rot:${rot}deg" title="${esc(name)}${got ? ', stamped ' + esc(date) : ''}">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <defs><path id="${id}" d="M20 60 A40 40 0 0 1 100 60"/></defs>
          <circle cx="60" cy="60" r="55" class="st-ring"/><circle cx="60" cy="60" r="47" class="st-ring2"/>
          <text class="st-arc"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(name.replace(/ at Mile High| Stadium| Field/g, '').toUpperCase().slice(0, 18))}</textPath></text>
          <g transform="translate(60 64)" class="st-flake"><path d="M0-14V14M-12.1-7 12.1 7M-12.1 7 12.1-7"/></g>
          <text x="60" y="98" text-anchor="middle" class="st-date">${got ? esc(date.toUpperCase()) : esc(abbr)}</text>
        </svg>
      </div>`;
    }
    function open() {
      const book = get();
      const count = Object.keys(book).length;
      $('#passport-body').innerHTML = `
        <p class="sheet-status">${count ? `${count} of ${STADIUM_LIST.length} stadiums stamped.` : 'No stamps yet.'} Open a game while it's a live snow game to earn that stadium's stamp.</p>
        <div class="stamps">${STADIUM_LIST.map(([n, , a], i) => stampSvg(n, book[n], a, i)).join('')}</div>`;
      $('#passport').showModal();
      $('#passport').scrollTop = 0;
    }
    return { stamp, open, count: () => Object.keys(get()).length };
  })();

  // =====================================================================================
  // ---------- Holiday visitors ----------
  // Thanksgiving week: a turkey in a knit hat waddles across with a football.
  // Christmas week: Santa's sleigh and reindeer fly across the sky.
  // New Year's week: Jack Frost drifts in and frosts the screen; snowflake fireworks at midnight.
  function thanksgivingDay(y) { const d = new Date(y, 10, 1); const first = (4 - d.getDay() + 7) % 7; return new Date(y, 10, 1 + first + 21); }
  function activeHoliday(now = new Date()) {
    const mode = store.get('holiday', 'auto');
    if (mode === 'off') return null;
    if (mode !== 'auto') return mode;
    const y = now.getFullYear(), day = new Date(y, now.getMonth(), now.getDate());
    const tg = thanksgivingDay(y);
    if (day >= new Date(y, 10, tg.getDate() - 6) && day <= tg) return 'thanksgiving';
    if (day >= new Date(y, 11, 18) && day <= new Date(y, 11, 25)) return 'christmas';
    if ((now.getMonth() === 11 && now.getDate() >= 26) || (now.getMonth() === 0 && now.getDate() === 1)) return 'newyear';
    return null;
  }
  function holidayTag(kickoff) {
    const k = new Date(kickoff), y = k.getFullYear();
    const same = (a, b) => a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(k, thanksgivingDay(y))) return ' <span class="hol-tag">Thanksgiving</span>';
    if (same(k, new Date(y, 11, 25))) return ' <span class="hol-tag">Christmas Day</span>';
    if (same(k, new Date(y, 0, 1)) || (k.getMonth() === 11 && k.getDate() === 31 && k.getHours() >= 18)) return ' <span class="hol-tag">New Year\'s</span>';
    return '';
  }

  const ART = {
    turkey: `<svg viewBox="0 0 140 130" class="hv-art" aria-hidden="true">
      <g class="tk-tail">${[-70, -48, -26, -4, 18, 40, 62].map((a, i) => `<ellipse cx="78" cy="38" rx="11" ry="34" transform="rotate(${a} 78 72)" fill="${['#B5532A', '#E08A2E', '#8E3B1E', '#F2B33D', '#8E3B1E', '#E08A2E', '#B5532A'][i]}" stroke="#5A2A12" stroke-width="1.5"/>`).join('')}</g>
      <ellipse cx="70" cy="84" rx="32" ry="27" fill="#7A4526" stroke="#4A2612" stroke-width="2"/>
      <path d="M48 80 Q62 98 86 88" stroke="#5A2F17" stroke-width="2" fill="none"/>
      <g class="tk-legs" stroke="#E08A2E" stroke-width="4" stroke-linecap="round"><path d="M62 108v16M58 124h9"/><path d="M80 108v16M76 124h9"/></g>
      <ellipse cx="38" cy="58" rx="13" ry="15" fill="#8C5634" stroke="#4A2612" stroke-width="2"/>
      <path d="M26 58 L14 62 L26 64Z" fill="#F2B33D" stroke="#9A6A12" stroke-width="1"/>
      <path d="M27 63 q-4 10 2 14 q5 -4 1 -14z" fill="#D8343A"/>
      <circle cx="34" cy="54" r="3.2" fill="#fff"/><circle cx="33.4" cy="54" r="1.8" fill="#111"/>
      <path d="M26 48 Q38 30 52 46 Z" fill="#E08A2E" stroke="#9A4F14" stroke-width="1.5"/>
      <path d="M25 47 Q38 42 53 46" stroke="#F3EAD3" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="40" cy="31" r="5" fill="#F3EAD3"/>
      <path d="M30 70 Q42 76 52 70 L52 76 Q42 82 30 76Z" fill="#1F4E86"/><path d="M48 74 l6 14 l5 -2 l-5 -13z" fill="#1F4E86"/>
      <g transform="translate(70 92) rotate(-25)"><path d="M-15 0 Q0 -9 15 0 Q0 9 -15 0Z" fill="#7A4526" stroke="#3A1E0C" stroke-width="1.4"/><path d="M-5 -0.5h10M-3 -2.5v4M0 -2.5v4M3 -2.5v4" stroke="#F4EFE6" stroke-width="1.2"/></g>
      <path d="M58 86 Q70 80 84 88" stroke="#5A2F17" stroke-width="2.5" fill="#6A391C"/>
    </svg>`,
    sleigh: `<svg viewBox="0 0 420 120" class="hv-art" aria-hidden="true">
      ${[0, 1, 2, 3].map(i => {
        const x = 300 - i * 62 + 0, y = 44 + (i % 2) * 6;
        return `<g transform="translate(${x + 60} ${y})"><g class="rd rd-${i}">
          <path d="M-6 -22 l-6 -12 m6 12 l2 -14 m-2 14 l-10 -6" stroke="#6B4A2E" stroke-width="2.4" fill="none" stroke-linecap="round"/>
          <path d="M4 -22 l4 -12 m-4 12 l8 -8" stroke="#6B4A2E" stroke-width="2.4" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="-14" rx="8" ry="7" fill="#8C5634"/><circle cx="7" cy="-13" r="2.2" fill="#2A1A10"/>
          <ellipse cx="-16" cy="2" rx="22" ry="10" fill="#8C5634"/>
          <path d="M-4 -8 Q-6 -2 -2 2" stroke="#8C5634" stroke-width="7"/>
          <path class="leg-a" d="M-4 8 l6 12 M-28 8 l-8 10" stroke="#5A3A22" stroke-width="3" stroke-linecap="round"/>
          <path class="leg-b" d="M-10 9 l-2 13 M-32 6 l2 14" stroke="#5A3A22" stroke-width="3" stroke-linecap="round"/>
        </g></g>`; }).join('')}
      <path d="M84 70 Q190 40 330 44" stroke="#C9A24A" stroke-width="1.5" fill="none" opacity="0.8"/>
      <g transform="translate(14 46)">
        <path d="M6 44 Q2 58 22 60 H104 Q118 60 120 50" stroke="#E2B341" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M10 14 H80 Q96 14 98 34 L94 46 H14 Q4 46 6 30Z" fill="#C8232C" stroke="#7E1218" stroke-width="2"/>
        <path d="M12 22 Q50 30 92 22" stroke="#E2B341" stroke-width="3" fill="none"/>
        <circle cx="18" cy="6" r="14" fill="#5B3A9A"/><path d="M8 0 l6 -12 l8 10z" fill="#E2B341"/>
        <circle cx="62" cy="2" r="12" fill="#C8232C"/>
        <ellipse cx="62" cy="10" rx="10" ry="7" fill="#F4F1EA"/>
        <circle cx="64" cy="-4" r="6" fill="#F2C9A7"/><circle cx="66" cy="-5" r="1.2" fill="#222"/>
        <path d="M56 -6 Q63 -22 74 -8 Z" fill="#C8232C"/><circle cx="76" cy="-9" r="3" fill="#F4F1EA"/><path d="M56 -6 H72" stroke="#F4F1EA" stroke-width="3"/>
        <path d="M58 0 Q64 12 70 0" fill="#F4F1EA"/>
        <path d="M70 6 Q86 0 96 -2" stroke="#C8232C" stroke-width="5" stroke-linecap="round"/>
      </g>
    </svg>`,
    frost: `<svg viewBox="0 0 160 170" class="hv-art" aria-hidden="true">
      <defs><linearGradient id="jf-robe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8F5FD"/><stop offset="1" stop-color="#8EC5E8" stop-opacity="0.15"/></linearGradient>
        <radialGradient id="jf-face" cx="45%" cy="40%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#BFE0F4"/></radialGradient></defs>
      <path d="M44 74 Q30 120 50 166 Q74 150 84 166 Q100 146 116 160 Q112 112 92 74Z" fill="url(#jf-robe)" class="jf-robe"/>
      <path d="M58 92 L74 116 L90 92" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="0.8"/>
      <g fill="#E9F6FF" stroke="#9CCBEA" stroke-width="1.5" stroke-linejoin="round">
        <path d="M42 46 L26 18 L50 36 L50 8 L62 32 L72 2 L78 30 L92 6 L92 34 L114 16 L102 46Z"/>
      </g>
      <ellipse cx="72" cy="56" rx="28" ry="26" fill="url(#jf-face)" stroke="#9CCBEA" stroke-width="1.5"/>
      <path d="M44 52 l-12 -6 l10 12z M100 52 l12 -6 l-10 12z" fill="#D7EEFB" stroke="#9CCBEA"/>
      <path d="M56 50 q6 -4 12 0 M76 50 q6 -4 12 0" stroke="#3B6E95" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <circle cx="62" cy="54" r="2.4" fill="#1E4A6E"/><circle cx="82" cy="54" r="2.4" fill="#1E4A6E"/>
      <ellipse cx="72" cy="68" rx="6" ry="5" fill="#5D97C2" class="jf-mouth"/>
      <circle cx="56" cy="64" r="5" fill="#AED8F2" opacity="0.7"/><circle cx="88" cy="64" r="5" fill="#AED8F2" opacity="0.7"/>
      <path d="M52 78 Q72 96 92 78 Q86 104 72 112 Q58 104 52 78Z" fill="#F4FBFF" stroke="#9CCBEA" stroke-width="1.2"/>
      <path d="M60 86 l2 12 M72 90 l0 16 M84 86 l-2 12" stroke="#BFE0F4" stroke-width="1.5"/>
    </svg>`
  };

  const Holiday = (() => {
    const layer = $('#holiday');
    let timer = null, current = null, nyTimer = null;
    function apply() {
      const h = activeHoliday();
      if (h === current) return;
      current = h;
      clearTimeout(timer); clearInterval(nyTimer);
      layer.innerHTML = ''; layer.hidden = !h;
      document.documentElement.dataset.holiday = h || '';
      if (!h) return;
      if (h === 'christmas') layer.insertAdjacentHTML('beforeend', `<div class="lights-string" aria-hidden="true">${Array.from({ length: 26 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>`);
      const first = REDUCED ? 600 : 2200;
      timer = setTimeout(visit, first);
      if (h === 'newyear') nyTimer = setInterval(newYearCheck, 1000);
    }
    function visit() {
      if (!current || document.visibilityState === 'hidden') { timer = setTimeout(visit, 8000); return; }
      const kind = current === 'thanksgiving' ? 'turkey' : current === 'christmas' ? 'sleigh' : 'frost';
      const el = document.createElement('button');
      el.className = 'hv hv-' + kind;
      el.setAttribute('aria-label', kind === 'turkey' ? 'Turkey (tap me)' : kind === 'sleigh' ? "Santa's sleigh (tap me)" : 'Jack Frost (tap me)');
      el.innerHTML = ART[kind];
      layer.appendChild(el);
      const dur = kind === 'turkey' ? 14000 : kind === 'sleigh' ? 9000 : 12000;
      const W = innerWidth;
      let anim;
      if (REDUCED) {
        el.style.cssText = kind === 'sleigh' ? `left:${W / 2 - 140}px;top:${110}px` : `left:${W - 150}px;bottom:calc(${getComputedStyle(document.documentElement).getPropertyValue('--bank') || '0px'} + 8px)`;
      } else if (kind === 'turkey') {
        anim = el.animate([{ transform: `translateX(${W + 20}px)` }, { transform: 'translateX(-160px)' }], { duration: dur, easing: 'linear' });
      } else if (kind === 'sleigh') {
        anim = el.animate([{ transform: 'translate(-460px, 30px) rotate(-4deg)' }, { transform: `translate(${W * 0.15}px, -10px) rotate(3deg)`, offset: 0.5 }, { transform: `translate(${W + 40}px, 20px) rotate(-4deg)` }], { duration: dur, easing: 'ease-in-out' });
      } else {
        anim = el.animate([{ transform: 'translate(-170px, 0)', opacity: 0 }, { transform: 'translate(20px, -10px)', opacity: 1, offset: 0.25 },
          { transform: 'translate(40px, 10px)', opacity: 1, offset: 0.7 }, { transform: 'translate(-170px, 0)', opacity: 0 }], { duration: dur, easing: 'ease-in-out' });
        setTimeout(() => frostBreath(el), dur * 0.3);
      }
      el.addEventListener('click', () => react(kind, el));
      const remove = () => el.remove();
      if (anim) anim.onfinish = remove; else setTimeout(remove, 12000);
      timer = setTimeout(visit, dur + (REDUCED ? 60000 : 16000 + Math.random() * 14000));
    }
    function react(kind, el) {
      const r = el.getBoundingClientRect();
      if (kind === 'turkey') {
        Sound.gobble();
        el.classList.add('hop'); setTimeout(() => el.classList.remove('hop'), 500);
        for (let i = 0; i < 6; i++) sprite(r.left + r.width * 0.6, r.top + r.height * 0.3, 'feather');
        toast('Gobble gobble! Happy Thanksgiving week.');
      } else if (kind === 'sleigh') {
        Sound.bells();
        for (let i = 0; i < 5; i++) setTimeout(() => sprite(r.left + 40 + Math.random() * 80, r.top + 60, 'gift'), i * 140);
        toast('Ho ho ho! Merry Christmas week.');
      } else {
        frostBreath(el, true);
        toast('Jack Frost says: Happy New Year!');
      }
      if (navigator.vibrate) navigator.vibrate(25);
    }
    function sprite(x, y, type) {
      const s = document.createElement('span');
      s.className = 'hv-sprite ' + type;
      s.style.left = x + 'px'; s.style.top = y + 'px';
      if (type === 'gift') s.style.setProperty('--c', ['#C8232C', '#1F7A44', '#E2B341', '#2E6EB5'][Math.floor(Math.random() * 4)]);
      layer.appendChild(s);
      const dx = (Math.random() - 0.5) * 140, dy = type === 'gift' ? innerHeight - y : 60 + Math.random() * 80;
      s.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) rotate(${(Math.random() - 0.5) * 540}deg)`, opacity: type === 'gift' ? 1 : 0 }],
        { duration: type === 'gift' ? 1400 : 1600, easing: type === 'gift' ? 'cubic-bezier(.4,0,.9,.6)' : 'ease-out' }).onfinish = () => s.remove();
    }
    // Jack Frost blows a swirl of frost across the screen
    function frostBreath(el, big) {
      Sound.whoosh();
      if (!GameView.isOpen()) { Frost.set(true, big ? 0.85 : 0.6); setTimeout(() => { if (!GameView.isOpen()) homeWinter(); }, big ? 6000 : 4500); }
      const r = el.getBoundingClientRect();
      for (let i = 0; i < (big ? 40 : 24); i++) {
        const s = document.createElement('span');
        s.className = 'hv-sprite sparkle';
        s.style.left = (r.left + r.width * 0.55) + 'px'; s.style.top = (r.top + r.height * 0.4) + 'px';
        layer.appendChild(s);
        const dx = 120 + Math.random() * innerWidth * 0.8, dy = (Math.random() - 0.5) * 260;
        s.animate([{ transform: 'translate(0,0) scale(.4)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(1.2)`, opacity: 0 }],
          { duration: 1400 + Math.random() * 900, delay: i * 25, easing: 'ease-out' }).onfinish = () => s.remove();
      }
    }
    // New Year's Eve: countdown in the header area, then snowflake fireworks at midnight
    let lastShown = '';
    function newYearCheck() {
      const now = new Date();
      const midnight = new Date(now.getFullYear() + (now.getMonth() === 11 ? 1 : 0), 0, 1);
      const ms = midnight - now;
      let el = document.getElementById('ny-count');
      if (now.getMonth() === 11 && now.getDate() === 31 && ms > 0) {
        if (!el) { el = document.createElement('div'); el.id = 'ny-count'; el.className = 'ny-count'; layer.appendChild(el); }
        const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
        const t = `${midnight.getFullYear()} in ${h ? h + 'h ' : ''}${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
        if (t !== lastShown) { el.textContent = t; lastShown = t; }
      } else if (el) {
        el.remove();
        if (now.getMonth() === 0 && now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() < 2) fireworks();
      }
    }
    function fireworks() {
      for (let b = 0; b < 6; b++) setTimeout(() => {
        const cx = innerWidth * (0.2 + Math.random() * 0.6), cy = innerHeight * (0.2 + Math.random() * 0.3);
        for (let i = 0; i < 26; i++) {
          const s = document.createElement('span'); s.className = 'hv-sprite flake'; s.style.left = cx + 'px'; s.style.top = cy + 'px';
          layer.appendChild(s);
          const a = i / 26 * 6.283, d = 80 + Math.random() * 60;
          s.animate([{ transform: 'translate(0,0) scale(.3)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d + 30}px) scale(1)`, opacity: 0 }], { duration: 1600, easing: 'ease-out' }).onfinish = () => s.remove();
        }
        Sound.crunch();
      }, b * 450);
      toast(`Happy New Year! Welcome to ${new Date().getFullYear()}.`);
    }
    function preview(kind) { store.set('holiday', kind); current = undefined; apply(); }
    return { apply, preview, fireworks, current: () => current };
  })();


  // =====================================================================================
  // ---------- Wordmark cleanup: knock out a solid background (some files have a white box) ----------
  const WMClean = (() => {
    const done = new Map();   // original url -> cleaned data url (or the same url when nothing to remove)
    function process(img) {
      const orig = img.dataset.orig || img.getAttribute('src');
      if (img.dataset.clean) return;
      if (done.has(orig)) { finish(img, done.get(orig)); return; }
      const src = new Image();
      src.crossOrigin = 'anonymous';
      src.onload = () => {
        let out = orig;
        try {
          const W = src.naturalWidth, H = src.naturalHeight;
          if (W && H && W * H < 4e6) {
            const c = document.createElement('canvas'); c.width = W; c.height = H;
            const x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(src, 0, 0);
            const im = x.getImageData(0, 0, W, H), d = im.data;
            const corners = [0, W - 1, (H - 1) * W, H * W - 1].map(i => i * 4);
            const opaque = corners.filter(i => d[i + 3] > 200);
            if (opaque.length >= 3) {
              // background color = average of the opaque corners
              const bg = [0, 1, 2].map(k => opaque.reduce((a, i) => a + d[i + k], 0) / opaque.length);
              const dist = i => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
              const seen = new Uint8Array(W * H), stack = [];
              for (let px = 0; px < W; px++) stack.push(px, (H - 1) * W + px);
              for (let py = 0; py < H; py++) stack.push(py * W, py * W + W - 1);
              while (stack.length) {
                const p = stack.pop();
                if (seen[p]) continue;
                const i = p * 4, dd = dist(i);
                if (d[i + 3] < 10 || dd > 120) continue;
                seen[p] = 1;
                // soft edge: near-background pixels vanish, in-between pixels fade
                d[i + 3] = dd < 40 ? 0 : Math.round(d[i + 3] * (dd - 40) / 80);
                if (dd >= 70) continue;   // stop at the lettering's edge
                const px = p % W;
                if (px > 0) stack.push(p - 1);
                if (px < W - 1) stack.push(p + 1);
                if (p >= W) stack.push(p - W);
                if (p < W * (H - 1)) stack.push(p + W);
              }
              // enclosed holes (the inside of an O or a D) that are still the background color:
              // clear blobs, but keep thin strokes like a white outline around the letters
              const comp = new Int32Array(W * H).fill(-1);
              for (let p0 = 0; p0 < W * H; p0++) {
                if (comp[p0] !== -1 || seen[p0]) continue;
                const i0 = p0 * 4;
                if (d[i0 + 3] < 200 || dist(i0) > 45) continue;
                const members = [p0]; comp[p0] = p0;
                let edge = 0;
                for (let q = 0; q < members.length; q++) {
                  const p = members[q], px = p % W;
                  let border = false;
                  for (const nb of [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, p >= W ? p - W : -1, p < W * (H - 1) ? p + W : -1]) {
                    if (nb < 0) { border = true; continue; }
                    const j = nb * 4;
                    if (comp[nb] === -1 && !seen[nb] && d[j + 3] >= 200 && dist(j) <= 45) { comp[nb] = p0; members.push(nb); }
                    else if (comp[nb] !== p0) border = true;
                  }
                  if (border) edge++;
                }
                // a hole is a solid blob: lots of inside pixels for its outline
                if (members.length >= 24 && members.length / Math.max(1, edge) >= 2.2) {
                  for (const p of members) { const i = p * 4; const dd = dist(i); d[i + 3] = dd < 25 ? 0 : Math.round(d[i + 3] * (dd - 25) / 20); }
                }
              }
              x.putImageData(im, 0, 0);
              out = c.toDataURL('image/png');
            }
          }
        } catch (e) { /* can't read the pixels: keep the original */ }
        done.set(orig, out);
        finish(img, out);
      };
      src.onerror = () => { done.set(orig, orig); finish(img, orig); };
      src.src = orig;
    }
    function finish(img, url) {
      img.dataset.clean = 'done';
      if (url !== img.getAttribute('src')) {
        img.addEventListener('load', () => img.dispatchEvent(new Event('wmclean')), { once: true });
        img.src = url;
      } else img.dispatchEvent(new Event('wmclean'));
      img.classList.add('ready');
    }
    document.addEventListener('load', e => {
      const img = e.target;
      if (img && img.classList && img.classList.contains('wordmark') && !img.dataset.clean) process(img);
    }, true);
    return { cached: url => done.get(url) };
  })();

  // =====================================================================================
  // ---------- Football weather: no snow, but the weather is part of the story ----------
  function footballWeather(g) {
    const w = g.wx;
    if (!w || g.roof !== 'open' || g.live || g.final) return null;
    const out = [];
    let score = 0;
    const feels = w.feelsLowF ?? w.lowF;
    if (feels <= 20 || w.lowF <= 28) { out.push(['frigid', `Frigid: feels like ${feels}°`]); score += 3 + Math.max(0, 20 - feels) / 6; }
    else if (w.lowF <= 38) { out.push(['cold', `Cold: ${w.lowF}°`]); score += 1.5; }
    if ((w.gustMph || 0) >= 28 || (w.windMph || 0) >= 17) { out.push(['wind', `Windy: gusts to ${w.gustMph} mph`]); score += 2 + Math.max(0, (w.gustMph || 0) - 28) / 8; }
    if ((w.rainHours || 0) >= 1 && w.precipChance >= 50) { out.push(['rain', `Rain: ${w.precipChance}% chance`]); score += 2 + w.rainHours / 2; }
    else if (w.precipChance >= 60 && w.lowF > 34) { out.push(['rain', `Showers: ${w.precipChance}% chance`]); score += 1; }
    if (!out.length || score < 2) return null;
    return { score, tags: out };
  }
  const fwIcon = { frigid: '❄', cold: '🌡', wind: '💨', rain: '☂' };
  function weatherCard(g, fw) {
    const when = new Date(g.kickoff).toLocaleDateString([], { weekday: 'short' }) + ' ' + fmtTime(g.kickoff);
    return `<button class="weather-card" data-open="${esc(g.id)}" aria-label="Open forecast for ${esc(g.away.name)} at ${esc(g.home.name)}">
      <span class="wc-top"><span class="wc-kicker">Football weather</span><span class="fc-when">${favMark(g)}${esc(when)}</span></span>
      <span class="wc-teams">${matchupStack(g, 'sm')}</span>
      <span class="wc-tags">${fw.tags.map(([k, t]) => `<span class="wtag wtag-${k}"><i aria-hidden="true">${fwIcon[k]}</i>${esc(t)}</span>`).join('')}</span>
      <span class="wc-foot">${esc(g.venue.name)}${holidayTag(g.kickoff)}</span>
    </button>`;
  }
  function renderWeatherGames(games, featured) {
    const list = games.filter(g => !featured.includes(g) && g !== state.wotw).map(g => [g, footballWeather(g)]).filter(([, f]) => f)
      .sort((a, b) => b[1].score - a[1].score || new Date(a[0].kickoff) - new Date(b[0].kickoff));
    state.weatherGames = list.map(([g]) => g);
    $('#weather-games').innerHTML = list.length ? `
      <h2 class="section-head">Football weather</h2>
      <p class="rank-sub section-sub">No snow in the forecast, but cold, wind, or rain will be part of the story.</p>
      <div class="feature-grid">${list.map(([g, f]) => weatherCard(g, f)).join('')}</div>` : '';
  }

  // =====================================================================================
  // ---------- Lake-effect band tracker (Buffalo, Cleveland, Chicago) ----------
  // Lake-effect snow needs very cold air (at about 5,000 ft) passing over a much warmer lake, and a wind
  // that carries the band from the lake to the stadium. Lake temperatures are typical values for the month.
  const LAKES = {
    'Highmark Stadium': { lake: 'Lake Erie', bearing: 250, aim: [232, 285], temps: { 9: 70, 10: 62, 11: 52, 12: 42, 1: 35, 2: 33, 3: 34 }, iceMonth: 2 },
    'Huntington Bank Field': { lake: 'Lake Erie', bearing: 340, aim: [295, 25], temps: { 9: 72, 10: 63, 11: 53, 12: 43, 1: 36, 2: 34, 3: 35 }, iceMonth: 2 },
    'Soldier Field': { lake: 'Lake Michigan', bearing: 80, aim: [5, 100], temps: { 9: 68, 10: 59, 11: 50, 12: 42, 1: 37, 2: 35, 3: 36 } }
  };
  const compass = d => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
  const inArc = (d, [a, b]) => a <= b ? d >= a && d <= b : d >= a || d <= b;
  function lakeSetup(g) {
    const L = LAKES[g.venue?.name];
    const w = g.wx;
    if (!L || !w || g.roof === 'dome') return null;
    const dir = w.dir850 ?? w.windDir;
    if (dir == null || w.t850F == null) return { L, missing: true };
    const month = new Date(g.kickoff).getMonth() + 1;
    const lakeF = L.temps[month];
    if (lakeF == null) return { L, offSeason: true };
    const dT = Math.round((lakeF - w.t850F) * 5 / 9);   // degrees C, the way forecasters measure it
    const cold = dT >= 13, strong = dT >= 18;
    const aimed = inArc(dir, L.aim);
    const light = (w.windAvgMph ?? w.windMph) < 6;
    const iced = L.iceMonth && month === L.iceMonth;
    let status, tone;
    if (!cold) { status = `Too warm aloft for lake-effect snow (the air needs to be about 13°C colder than the lake; it's ${Math.max(dT, 0)}°C colder).`; tone = 'off'; }
    else if (aimed && !light) { status = `${strong ? 'Strong' : 'Moderate'} lake-effect setup with the wind aimed right at the stadium. Bands off ${L.lake} could bury this one.`; tone = 'aimed'; }
    else if (aimed) { status = `Cold enough for lake-effect, but winds are light, so bands may wander or fall apart.`; tone = 'maybe'; }
    else { status = `Cold enough for lake-effect, but wind from the ${compass(dir)} sends the bands away from the stadium.`; tone = 'miss'; }
    if (iced && cold) status += ` ${L.lake} is often partly frozen by now, which weakens the bands.`;
    return { L, dir, dT, lakeF, aimed, cold, strong, tone, status };
  }
  function lakeSection(g) {
    const s = lakeSetup(g);
    if (!s) return '';
    if (s.missing || s.offSeason) return '';
    const R = 120, cx = 150, cy = 130;
    const rad = deg => (deg - 90) * Math.PI / 180;
    const lx = cx + Math.cos(rad(s.L.bearing)) * 66, ly = cy + Math.sin(rad(s.L.bearing)) * 66;
    // the band starts over the lake and runs downwind (wind direction is where it comes FROM)
    const down = s.dir + 180;
    const len = 210;
    const bx = lx + Math.cos(rad(down)) * len, by = ly + Math.sin(rad(down)) * len;
    const strength = s.cold ? Math.min(1, 0.45 + (s.dT - 13) / 12) : 0.12;
    const lakeShape = `<ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="40" ry="19" transform="rotate(${s.L.bearing + 90} ${lx.toFixed(1)} ${ly.toFixed(1)})" class="lk-lake"/>`;
    const arrows = [-40, 0, 40].map(off => {
      const ax = cx + Math.cos(rad(s.dir)) * 112 + Math.cos(rad(s.dir + 90)) * off, ay = cy + Math.sin(rad(s.dir)) * 112 + Math.sin(rad(s.dir + 90)) * off;
      return `<g transform="translate(${ax.toFixed(1)} ${ay.toFixed(1)}) rotate(${down})" class="lk-arrow"><path d="M0 -12 V12 M-5 6 L0 12 L5 6"/></g>`;
    }).join('');
    const tick = deg => { const a = rad(deg); return `<line x1="${cx + Math.cos(a) * (R - 6)}" y1="${cy + Math.sin(a) * (R - 6)}" x2="${cx + Math.cos(a) * R}" y2="${cy + Math.sin(a) * R}"/>`; };
    return `<section class="gv-chart lake-fx lk-${s.tone}">
      <h3>Lake-effect tracker</h3>
      <p class="gv-sub">${esc(s.L.lake)}, during the game</p>
      <div class="lk-wrap">
        <svg viewBox="0 0 300 260" class="lk-svg" role="img" aria-label="${esc(s.status)}">
          <defs>
            <clipPath id="lk-clip"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
            <linearGradient id="lk-band" gradientUnits="userSpaceOnUse" x1="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}">
              <stop offset="0" stop-color="#E9F1F7" stop-opacity="${(strength * 0.9).toFixed(2)}"/><stop offset="1" stop-color="#E9F1F7" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <circle cx="${cx}" cy="${cy}" r="${R}" class="lk-disc"/>
          <g class="lk-ticks">${[0, 45, 90, 135, 180, 225, 270, 315].map(tick).join('')}</g>
          <text x="${cx}" y="${cy - R + 18}" class="lk-n">N</text>
          <g clip-path="url(#lk-clip)">
            ${lakeShape}
            <line x1="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="url(#lk-band)" stroke-width="${(18 + strength * 22).toFixed(0)}" stroke-linecap="round" class="lk-band"/>
            ${s.cold ? `<line x1="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" class="lk-flow" style="opacity:${strength.toFixed(2)}"/>` : ''}
            ${arrows}
          </g>
          <g transform="translate(${cx} ${cy})" class="lk-stadium"><circle r="${s.tone === 'aimed' ? 9 : 7}"/><circle r="3" class="core"/></g>
          <text x="${cx}" y="${cy + 28}" class="lk-label halo">Stadium</text>
          <text x="${(lx + Math.cos(rad(s.L.bearing)) * 4).toFixed(1)}" y="${(ly + (Math.sin(rad(s.L.bearing)) > -0.3 ? 34 : -26)).toFixed(1)}" class="lk-lake-label halo">${esc(s.L.lake)}</text>
        </svg>
        <div class="lk-facts">
          <div class="lk-verdict">${s.tone === 'aimed' ? 'Band aimed at the stadium' : s.tone === 'miss' ? 'Bands aimed elsewhere' : s.tone === 'maybe' ? 'Weak, wandering bands' : 'No lake-effect setup'}</div>
          <p>${esc(s.status)}</p>
          <dl>
            <div><dt>Wind from</dt><dd>${s.dir}° (${compass(s.dir)})</dd></div>
            <div><dt>Lake water</dt><dd>about ${s.lakeF}°F</dd></div>
            <div><dt>Air at 5,000 ft</dt><dd>${g.wx.t850F}°F</dd></div>
            <div><dt>Lake vs. air</dt><dd>${s.dT}°C ${s.cold ? '(enough)' : '(not enough)'}</dd></div>
          </dl>
        </div>
      </div>
      <p class="gv-source">A schematic, not radar. Bands are narrow and can shift by a few miles, which can mean a foot of snow or none.</p>
    </section>`;
  }

  // =====================================================================================
  // ---------- End zones the way you see them on TV ----------
  // The main broadcast camera sits up in the press box on one sideline. Press boxes are usually built on
  // the side that keeps the afternoon sun (in the southwest) behind them, so the camera looks roughly
  // northeast-ish across the field. From that view, one end zone is on the left of your TV and one on the right.
  // If a stadium is the other way around, "Flip to match your TV" swaps them (remembered per stadium).
  function tvEnds(g, axis) {
    const a = axis ?? 0;
    const ang = (x, y) => Math.abs(((x - y + 540) % 360) - 180);
    let view = ang(a + 90, 45) <= ang(a - 90, 45) ? a + 90 : a - 90;
    if (store.get('tvflip:' + (g?.venue?.name || ''), false)) view += 180;
    const left = ((view - 90) % 360 + 360) % 360;
    return [left, (left + 180) % 360];   // [left end zone heading, right end zone heading]
  }
  const tvName = i => i ? 'right end zone' : 'left end zone';
  function tvFlip(g) {
    const k = 'tvflip:' + (g?.venue?.name || '');
    store.set(k, !store.get(k, false));
    Sound.crunch();
    toast('Swapped. Left and right now match the other side of the field.');
    Kicker.refresh(g); QB.refresh(g);
  }
  const flipBtn = () => `<button class="text-btn tv-flip" data-tvflip>Doesn't match your TV? Flip left and right</button>`;

  // ---------- Kick simulator: a field goal at this stadium, in the wind blowing there right now ----------
  // Ball flight from basic physics (wind, cold, altitude). The wind comes from the stadium's current
  // conditions, gusting kick to kick; the field direction comes from the stadium itself, so you pick
  // which end zone to kick toward. Drag the ball to set the distance and where it sits between the hashes.
  // =====================================================================================
  // ---------- Console cam: the real stadium and weather, drawn like an early-2000s console football game ----------
  // Shared by the QB view and the kick simulator. Field coordinates in yards: x across (+ is right),
  // y down the field from the offense's own goal line (the far goal line is 100), z up.
  const Arena = (() => {
    const SIDE = 26.67, HASH = 3.08, NEAR = 0.4;
    const cssVar = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || d;
    function camera(W, H, cx, cy, cz, pitchDeg, fovDeg) {
      const th = pitchDeg * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
      const f = (W / 2) / Math.tan(fovDeg * Math.PI / 360), mid = H * 0.5;
      const toCam = (x, y, z) => { const dx = x - cx, dy = y - cy, dz = z - cz; return [dx, dy * sn + dz * cs, dy * cs - dz * sn]; };
      const proj = ([X, Y, Z]) => [W / 2 + f * X / Z, mid - f * Y / Z, Z];
      const P = (x, y, z = 0) => { const c = toCam(x, y, z); return c[2] < NEAR ? null : proj(c); };
      return { P, toCam, proj, f, horizon: mid - f * Math.tan(th), W, H, cx, cy, cz };
    }
    // polygons and lines are clipped at the camera so the near field can run off the bottom of the screen
    function clip(cam, pts) {
      const c = pts.map(p => cam.toCam(p[0], p[1], p[2] || 0)), out = [];
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i + 1) % c.length], ia = a[2] >= NEAR, ib = b[2] >= NEAR;
        if (ia) out.push(a);
        if (ia !== ib) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
      }
      return out.map(cam.proj);
    }
    function poly(ctx, cam, pts, fill) {
      const s = clip(cam, pts);
      if (s.length < 3) return null;
      ctx.beginPath(); s.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      return s;
    }
    function seg(ctx, cam, a, b, width, color) {
      let A = cam.toCam(a[0], a[1], a[2] || 0), B = cam.toCam(b[0], b[1], b[2] || 0);
      if (A[2] < NEAR && B[2] < NEAR) return;
      if (A[2] < NEAR || B[2] < NEAR) { const t = (NEAR - A[2]) / (B[2] - A[2]); const C = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, NEAR]; if (A[2] < NEAR) A = C; else B = C; }
      const p = cam.proj(A), q = cam.proj(B), z = (A[2] + B[2]) / 2;
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.6, width * cam.f / z);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
    // draw something flat on the grass (numbers, end zone names, the midfield logo): a 100 x 100 box, centered
    function onGround(ctx, cam, x, y, wYd, hYd, draw) {
      const c0 = cam.P(x, y), px = cam.P(x + wYd / 2, y), py = cam.P(x, y + hYd / 2);
      if (!c0 || !px || !py) return;
      ctx.save();
      ctx.transform((px[0] - c0[0]) / 50, (px[1] - c0[1]) / 50, -(py[0] - c0[0]) / 50, -(py[1] - c0[1]) / 50, c0[0], c0[1]);
      draw(ctx);
      ctx.restore();
    }
    const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    const shade = (hex, k) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex || '#335';
      const n = parseInt(m[1], 16), f = v => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
      return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
    };

    // ----- the stadium around the field -----
    function stadium(ctx, cam, o) {
      const { W, H } = cam, hz = cam.horizon;
      const sky = ctx.createLinearGradient(0, 0, 0, Math.max(10, hz));
      if (o.night) { sky.addColorStop(0, '#03050B'); sky.addColorStop(1, '#141C2B'); }
      else if (o.gray) { sky.addColorStop(0, '#5D6976'); sky.addColorStop(1, '#A9B3BD'); }
      else { sky.addColorStop(0, '#2F74C7'); sky.addColorStop(1, '#AED4F2'); }
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, Math.max(0, hz) + 4);
      const deck = o.night ? '#161C27' : '#3C4552', deck2 = o.night ? '#1E2633' : '#4A5563';
      const crowdCols = [o.home || '#2A4D8F', '#EDEDED', shade(o.home, -0.4), o.away || '#8B1E2B', '#C9A76A', '#5E6B78'];
      const stand = (pts, base, n, seed) => {
        const s = poly(ctx, cam, pts, base); if (!s) return;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, y] of s) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        ctx.save(); ctx.clip();
        const sz = Math.max(1, Math.min(3.2, (y1 - y0) / 26));
        for (let i = 0; i < n; i++) { ctx.fillStyle = crowdCols[(i * 7 + seed) % crowdCols.length]; ctx.globalAlpha = o.night ? 0.55 : 0.8; ctx.fillRect(x0 + rnd(i + seed) * (x1 - x0), y0 + rnd(i * 3.1 + seed) * (y1 - y0), sz, sz); }
        // flashbulbs and phone lights in the crowd at night
        if (o.night) for (let i = 0; i < 10; i++) if (rnd(i + seed + Math.floor(o.t / 220)) > 0.72) { ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9; ctx.fillRect(x0 + rnd(i * 9 + seed) * (x1 - x0), y0 + rnd(i * 5 + seed) * (y1 - y0), sz, sz); }
        ctx.restore(); ctx.globalAlpha = 1;
      };
      // upper and lower decks around the far end and both sidelines
      stand([[-90, 128, 7], [90, 128, 7], [90, 150, 30], [-90, 150, 30]], deck2, 420, 3);
      stand([[-80, 118, 0], [80, 118, 0], [80, 128, 7], [-80, 128, 7]], deck, 260, 11);
      for (const sd of [-1, 1]) {
        stand([[sd * 40, -60, 7], [sd * 40, 128, 7], [sd * 64, 128, 30], [sd * 64, -60, 30]], deck2, 520, sd > 0 ? 17 : 29);
        stand([[sd * 33, -60, 0], [sd * 33, 120, 0], [sd * 40, 120, 7], [sd * 40, -60, 7]], deck, 300, sd > 0 ? 41 : 53);
        // the wall along the sideline, in the home team's colors
        poly(ctx, cam, [[sd * 33, -60, 0], [sd * 33, 120, 0], [sd * 33, 120, 1.1], [sd * 33, -60, 1.1]], shade(o.home, -0.25));
      }
      poly(ctx, cam, [[-80, 118, 0], [80, 118, 0], [80, 118, 1.1], [-80, 118, 1.1]], shade(o.home, -0.25));
      // light towers
      if (o.night) for (const [x, y] of [[-48, 135], [48, 135], [-52, 40], [52, 40]]) {
        const p = cam.P(x, y, 42); if (!p) continue;
        const R = Math.max(14, 900 / p[2]);
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
        g.addColorStop(0, 'rgba(255,250,232,0.95)'); g.addColorStop(0.18, 'rgba(255,240,205,0.35)'); g.addColorStop(1, 'rgba(255,240,205,0)');
        ctx.fillStyle = g; ctx.fillRect(p[0] - R, p[1] - R, R * 2, R * 2);
      }
    }

    // ----- the field -----
    function field(ctx, cam, o) {
      const turfA = o.night ? '#24572C' : '#2E6E35', turfB = o.night ? '#2B6634' : '#378040';
      poly(ctx, cam, [[-33, -60], [33, -60], [33, 118], [-33, 118]], o.night ? '#1E4A26' : '#285F2F');
      for (let y = 0; y < 100; y += 5) poly(ctx, cam, [[-SIDE, y], [SIDE, y], [SIDE, y + 5], [-SIDE, y + 5]], (y / 5) % 2 ? turfA : turfB);
      const ez = shade(o.home, -0.15);
      for (const y0 of [-10, 100]) poly(ctx, cam, [[-SIDE, y0], [SIDE, y0], [SIDE, y0 + 10], [-SIDE, y0 + 10]], ez);
      const la = o.lineA ?? 1, white = `rgba(246,248,243,${0.92 * la})`;
      ctx.lineCap = 'butt';
      for (let y = 0; y <= 100; y += 5) seg(ctx, cam, [-SIDE, y], [SIDE, y], y % 50 === 0 ? 0.16 : 0.11, white);
      for (const x of [-SIDE, SIDE]) seg(ctx, cam, [x, -10], [x, 110], 0.22, white);
      for (const y of [-10, 110]) seg(ctx, cam, [-SIDE, y], [SIDE, y], 0.22, white);
      for (let y = 1; y < 100; y++) if (y % 5) for (const x of [-HASH, HASH, -SIDE + 0.35, SIDE - 0.35]) seg(ctx, cam, [x - 0.33, y], [x + 0.33, y], 0.11, white);
      const font = cssVar('--display', 'sans-serif');
      // yard numbers, read from the sidelines
      for (let y = 10; y <= 90; y += 10) for (const sd of [-1, 1]) {
        if (Math.abs(y - cam.cy) > 75) continue;
        onGround(ctx, cam, sd * (SIDE - 11.3), y, 3.2, 3.2, c => {
          c.rotate(sd * Math.PI / 2); c.fillStyle = white; c.font = `900 64px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(String(y <= 50 ? y : 100 - y), 0, 2);
        });
      }
      // end zone names and the logo at midfield
      const name = String(o.homeName || '').toUpperCase();
      if (name) for (const [y0, flip] of [[105, false], [-5, true]]) onGround(ctx, cam, 0, y0, 44, 7, c => {
        if (flip) c.rotate(Math.PI);
        c.fillStyle = `rgba(255,255,255,${0.95 * la})`; c.font = `italic 900 70px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.save(); c.scale(Math.min(1, 96 / Math.max(1, c.measureText(name).width)), 1.25); c.fillText(name, 0, 2); c.restore();
      });
      if (o.logo && o.logo.complete && o.logo.naturalWidth) onGround(ctx, cam, 0, 50, 9, 9, c => { c.globalAlpha = 0.9 * la; c.drawImage(o.logo, -50, -50, 100, 100); });
      // snow lying on the field, or a wet sheen
      if (o.snowIn > 0) {
        const cover = Math.min(0.78, Math.pow(Math.min(1, o.snowIn / 1.3), 0.7));
        poly(ctx, cam, [[-36, -60], [36, -60], [36, 118], [-36, 118]], `rgba(236,242,247,${cover})`);
        // footprints and drag marks around the ball
        if (o.los != null && cover > 0.2) for (let i = 0; i < 40; i++) {
          const x = (rnd(i) - 0.5) * 16, y = o.los + (rnd(i * 2.3) - 0.6) * 12, p = cam.P(x, y); if (!p) continue;
          ctx.fillStyle = `rgba(120,150,120,${cover * 0.35})`; ctx.beginPath(); ctx.ellipse(p[0], p[1], Math.max(1, 6 / p[2]), Math.max(0.5, 2.5 / p[2]), 0, 0, 6.283); ctx.fill();
        }
      } else if (o.wet > 0.25) {
        const hz = Math.max(0, cam.horizon), g = ctx.createLinearGradient(0, hz, 0, cam.H);
        g.addColorStop(0, 'rgba(190,210,230,0.32)'); g.addColorStop(0.5, 'rgba(190,210,230,0.08)'); g.addColorStop(1, 'rgba(190,210,230,0.2)');
        ctx.fillStyle = g; ctx.fillRect(0, hz, cam.W, cam.H - hz);
      }
      // the TV lines: line of scrimmage and first down
      if (o.los != null) seg(ctx, cam, [-SIDE, o.los, 0.02], [SIDE, o.los, 0.02], 0.3, 'rgba(70,140,255,0.9)');
      if (o.first != null && o.first < 100) seg(ctx, cam, [-SIDE, o.first, 0.02], [SIDE, o.first, 0.02], 0.3, 'rgba(255,214,40,0.92)');
    }

    // ----- goalposts at the end line, with ribbons that show the wind -----
    function goalpost(ctx, cam, y, o) {
      const Y = o.toward ? y : y, back = y + (y > 50 ? 1.6 : -1.6), top = 3.33 + 10;
      const gold = '#F2CC2E';
      ctx.lineCap = 'round';
      seg(ctx, cam, [0, back, 0], [0, back, 2.9], 0.25, gold);
      seg(ctx, cam, [0, back, 2.9], [0, Y, 3.33], 0.22, gold);
      seg(ctx, cam, [-HASH, Y, 3.33], [HASH, Y, 3.33], 0.16, gold);
      for (const x of [-HASH, HASH]) seg(ctx, cam, [x, Y, 3.33], [x, Y, top], 0.13, gold);
      poly(ctx, cam, [[-0.35, back - 0.35, 0], [0.35, back - 0.35, 0], [0.35, back - 0.35, 2.1], [-0.35, back - 0.35, 2.1]], shade(o.home, -0.2));
      // ribbons: blown by the wind (cross = across the screen, tail = away from the camera)
      const len = Math.min(1, (o.wind || 0) / 18) * 1.6, flap = Math.sin(o.t / 90) * 0.18;
      const ux = o.wind ? o.cross / Math.max(1, o.wind) : 0, uy = o.wind ? o.tail / Math.max(1, o.wind) : 0;
      for (const x of [-HASH, HASH]) {
        const a = cam.P(x, Y, top), b = cam.P(x + ux * len, Y + uy * len, top - 0.35 + flap - (o.wind ? 0 : 1)), d = cam.P(x, Y, top - 0.55);
        if (!a || !b || !d) continue;
        ctx.fillStyle = '#E8591C'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
      }
    }

    // ----- a player: low-poly, team colors, number on the jersey -----
    function player(ctx, cam, x, y, o) {
      const tall = o.kneel ? 1.15 : o.crouch ? 1.55 : 2.0;
      const feet = cam.P(x, y, 0), head = cam.P(x, y, tall);
      if (!feet || !head) return null;
      const h = feet[1] - head[1];
      if (h < 3) { ctx.fillStyle = o.color; ctx.fillRect(feet[0] - 1, feet[1] - 3, 2, 3); return [feet[0], feet[1] - 2, h]; }
      const w = h * (o.kneel ? 0.5 : 0.36), cx = feet[0], top = head[1];
      const at = f => top + h * f;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(cx, feet[1], w * 0.85, Math.max(1, h * 0.06), 0, 0, 6.283); ctx.fill();
      const jersey = o.color, dark = shade(o.color, -0.35), pants = o.pants || '#E8E5DA', sock = o.sock || o.color;
      const sw = Math.sin(o.phase || 0) * w * 0.22;
      if (o.kneel) {
        ctx.fillStyle = pants; ctx.fillRect(cx - w * 0.45, at(0.62), w * 0.9, h * 0.2);
        ctx.fillStyle = sock; ctx.fillRect(cx - w * 0.5, at(0.82), w * 0.35, h * 0.14);
        ctx.fillStyle = '#111'; ctx.fillRect(cx + w * 0.15, at(0.9), w * 0.4, h * 0.08);
      } else {
        // legs, socks, cleats
        for (const sd of [-1, 1]) {
          const lx = cx + sd * w * 0.2 + sd * sw;
          ctx.fillStyle = pants; ctx.fillRect(lx - w * 0.16, at(0.55), w * 0.32, h * 0.2);
          ctx.fillStyle = sock; ctx.fillRect(lx - w * 0.13, at(0.75), w * 0.26, h * 0.19);
          ctx.fillStyle = '#121212'; ctx.fillRect(lx - w * 0.16, at(0.94), w * 0.34, h * 0.06);
        }
        ctx.fillStyle = pants; ctx.fillRect(cx - w * 0.4, at(0.5), w * 0.8, h * 0.12);
      }
      // jersey over shoulder pads
      const g = ctx.createLinearGradient(cx - w * 0.6, 0, cx + w * 0.6, 0);
      g.addColorStop(0, dark); g.addColorStop(0.35, jersey); g.addColorStop(0.65, jersey); g.addColorStop(1, dark);
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(cx - w * 0.62, at(0.2)); ctx.lineTo(cx + w * 0.62, at(0.2)); ctx.lineTo(cx + w * 0.42, at(0.52)); ctx.lineTo(cx - w * 0.42, at(0.52)); ctx.closePath(); ctx.fill();
      // arms
      ctx.fillStyle = jersey; ctx.fillRect(cx - w * 0.74, at(0.21), w * 0.18, h * 0.14); ctx.fillRect(cx + w * 0.56, at(0.21), w * 0.18, h * 0.14);
      ctx.fillStyle = '#2B2723'; ctx.fillRect(cx - w * 0.72, at(0.35) - sw * 0.3, w * 0.14, h * 0.15); ctx.fillRect(cx + w * 0.58, at(0.35) + sw * 0.3, w * 0.14, h * 0.15);
      if (o.num && h > 20) { ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = `800 ${Math.round(h * 0.16)}px ${cssVar('--display', 'sans-serif')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.num, cx, at(0.35)); }
      // helmet
      const hr = h * 0.095, hy = at(0.1);
      ctx.fillStyle = o.helmet || jersey; ctx.beginPath(); ctx.arc(cx, hy, hr, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(cx - hr * 0.35, hy - hr * 0.35, hr * 0.35, 0, 6.283); ctx.fill();
      if (o.toward) { ctx.strokeStyle = '#C9CDD2'; ctx.lineWidth = Math.max(0.8, hr * 0.22); ctx.beginPath(); ctx.moveTo(cx - hr * 0.6, hy + hr * 0.15); ctx.lineTo(cx + hr * 0.6, hy + hr * 0.15); ctx.moveTo(cx - hr * 0.45, hy + hr * 0.55); ctx.lineTo(cx + hr * 0.45, hy + hr * 0.55); ctx.stroke(); }
      else { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(cx - hr * 0.12, hy - hr, hr * 0.24, hr * 1.6); }
      // snow collecting on the helmet and shoulders
      if (o.snow) { ctx.fillStyle = 'rgba(250,252,255,0.85)'; ctx.beginPath(); ctx.ellipse(cx, hy - hr * 0.8, hr * 0.7, hr * 0.3, 0, 0, 6.283); ctx.fill(); ctx.fillRect(cx - w * 0.6, at(0.19), w * 1.2, Math.max(1, h * 0.025)); }
      // breath in the cold
      if (o.breath && h > 12) {
        const p = ((o.t / 1400) + (x * 0.37 + y * 0.11)) % 1;
        if (p < 0.55) { ctx.fillStyle = `rgba(240,246,250,${0.5 * (1 - p / 0.55)})`; ctx.beginPath(); ctx.arc(cx + (o.toward ? 0 : hr * 0.4), hy + hr * (o.toward ? 0.9 + p : -0.2 - p * 1.4), hr * (0.5 + p * 1.2), 0, 6.283); ctx.fill(); }
      }
      return [cx, at(0.35), h];
    }

    function football(ctx, cam, x, y, z, t, trail) {
      const p = cam.P(x, y, z), s = cam.P(x, y, 0);
      if (s) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(s[0], s[1], Math.max(1.2, 0.25 * cam.f / s[2]), Math.max(0.6, 0.1 * cam.f / s[2]), 0, 0, 6.283); ctx.fill(); }
      if (!p) return;
      if (trail && trail.length > 1) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]); ctx.beginPath(); trail.forEach(([a, b, c2], i) => { const q = cam.P(a, b, c2); if (q) i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke(); ctx.setLineDash([]); }
      const r = Math.max(2.2, 0.2 * cam.f / p[2]);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(t / 55);
      ctx.fillStyle = '#7B3F1D'; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.45, r, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(0.6, r * 0.18); ctx.beginPath(); ctx.moveTo(-r * 0.5, 0); ctx.lineTo(r * 0.5, 0); ctx.stroke();
      ctx.restore();
    }

    // ----- fog and falling weather in the distance -----
    function visibility(ctx, cam, vis, col) {
      if (vis >= 2500) return;
      const y = d => { const p = cam.P(0, cam.cy + d, 0); return p ? p[1] : cam.H; };
      const hz = Math.max(0, cam.horizon), yv = y(Math.max(6, vis)), yn = y(Math.max(4, vis * 0.35));
      const g = ctx.createLinearGradient(0, 0, 0, cam.H), at = v => Math.max(0, Math.min(1, v / cam.H));
      g.addColorStop(0, `rgba(${col},0.97)`); g.addColorStop(at(hz), `rgba(${col},0.95)`);
      g.addColorStop(Math.max(at(hz) + 0.001, at(yv)), `rgba(${col},0.82)`);
      g.addColorStop(Math.max(at(yv) + 0.002, at(yn)), `rgba(${col},0.4)`);
      g.addColorStop(1, `rgba(${col},${vis < 300 ? 0.15 : 0})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, cam.W, cam.H);
    }

    // ----- the on-screen graphics -----
    const hudFont = (px, w = 900) => `italic ${w} ${px}px ${cssVar('--display', 'sans-serif')}`;
    function plate(ctx, x, y, w, h, fill, edge) {
      ctx.beginPath(); ctx.moveTo(x + h * 0.25, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - h * 0.25, y + h); ctx.lineTo(x, y + h); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
    }
    function scorebug(ctx, W, g, right) {
      const s = Math.max(0.8, Math.min(1.25, W / 380)), h = 20 * s, y = 8 * s;
      let x = 8 * s;
      const team = (t, sc) => {
        plate(ctx, x, y, 58 * s, h, shade(t.color || '#334', -0.15), 'rgba(255,255,255,0.35)');
        ctx.fillStyle = '#fff'; ctx.font = hudFont(12 * s); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(t.abbr, x + 9 * s, y + h / 2 + 0.5);
        ctx.textAlign = 'right'; ctx.fillText(String(sc ?? 0), x + 50 * s, y + h / 2 + 0.5);
        x += 56 * s;
      };
      team(g.away, g.score?.away); team(g.home, g.score?.home);
      const mid = (g.live || g.final) ? String(g.status || '').toUpperCase().slice(0, 14) : new Date(g.kickoff).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }).toUpperCase();
      plate(ctx, x, y, 84 * s, h, 'rgba(10,14,22,0.82)', 'rgba(255,255,255,0.3)');
      ctx.fillStyle = cssVar('--amber', '#F5B841'); ctx.font = hudFont(10.5 * s, 800); ctx.textAlign = 'center'; ctx.fillText(mid, x + 42 * s, y + h / 2 + 0.5);
      if (right) {
        ctx.font = hudFont(11 * s, 800); const tw = ctx.measureText(right).width + 22 * s;
        plate(ctx, W - tw - 8 * s, y, tw, h, 'rgba(10,14,22,0.82)', 'rgba(255,255,255,0.3)');
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(right, W - tw / 2 - 8 * s, y + h / 2 + 0.5);
      }
    }
    function windBadge(ctx, x, y, r, mph, relDeg, label) {
      ctx.fillStyle = 'rgba(10,14,22,0.78)'; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      if (mph > 0 && relDeg != null) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(relDeg * Math.PI / 180);
        ctx.fillStyle = cssVar('--ice', '#8FD3FF'); ctx.beginPath(); ctx.moveTo(0, -r * 0.72); ctx.lineTo(r * 0.36, -r * 0.05); ctx.lineTo(r * 0.12, -r * 0.05); ctx.lineTo(r * 0.12, r * 0.62); ctx.lineTo(-r * 0.12, r * 0.62); ctx.lineTo(-r * 0.12, -r * 0.05); ctx.lineTo(-r * 0.36, -r * 0.05); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#fff'; ctx.font = hudFont(Math.round(r * 0.55)); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(label || (mph ? `${Math.round(mph)} MPH` : 'CALM'), x, y + r + 3);
    }
    // the big slanted result banner that sweeps across the screen
    function banner(ctx, W, H, text, sub, age, color) {
      if (age < 0 || age > 2.6) return;
      const inK = Math.min(1, age / 0.22), outK = age > 2.2 ? (age - 2.2) / 0.4 : 0;
      const x = (1 - inK) * -W + outK * W, cy = H * 0.42, bh = Math.max(36, H * 0.17);
      ctx.save(); ctx.translate(x, 0);
      ctx.fillStyle = 'rgba(8,10,18,0.82)'; ctx.beginPath(); ctx.moveTo(W * 0.06, cy - bh / 2); ctx.lineTo(W, cy - bh / 2); ctx.lineTo(W * 0.94, cy + bh / 2); ctx.lineTo(0, cy + bh / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = color; ctx.fillRect(0, cy - bh / 2 - 3, W, 3); ctx.fillRect(0, cy + bh / 2, W, 3);
      ctx.fillStyle = '#fff'; ctx.font = hudFont(Math.round(bh * 0.5)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fillText(text, W / 2, cy - (sub ? bh * 0.1 : 0)); ctx.shadowBlur = 0;
      if (sub) { ctx.fillStyle = color; ctx.font = hudFont(Math.round(bh * 0.2), 800); ctx.fillText(sub, W / 2, cy + bh * 0.3); }
      ctx.restore();
    }
    // a numbered button over a receiver's head
    function icon(ctx, x, y, n, color, pulse) {
      const r = 9 + pulse * 1.5;
      ctx.fillStyle = 'rgba(8,10,18,0.85)'; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 6.283); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#0B0E16'; ctx.font = hudFont(12); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), x, y + 0.5);
    }
    const ICON_COLORS = ['#3DDC84', '#FF5A5F', '#4EA8FF', '#FFC83D'];
    // retro looks for the themes that have them
    function themeFinish(ctx, W, H) {
      const th = Theme.get();
      if (th === 'retro') { ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1); }
      if (th === 'ninety') { ctx.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = 0; y < H; y += 2) ctx.fillRect(0, y, W, 1); }
      if (th === 'scoreboard') { const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    }
    const logos = new Map();
    function logoImg(url) { if (!url) return null; if (!logos.has(url)) { const i = new Image(); i.src = url; logos.set(url, i); } return logos.get(url); }
    return { SIDE, HASH, camera, poly, seg, onGround, stadium, field, goalpost, player, football, visibility, scorebug, windBadge, banner, icon, ICON_COLORS, plate, hudFont, themeFinish, logoImg, shade, cssVar };
  })();

  const Kicker = (() => {
    const YD = 0.9144, FT = 0.3048, MPH = 0.44704, BAR = 3.05, HALF = 9.25;   // uprights and hashes are both 18'6" apart
    const rhoAt = (F, elevFt) => { const T = (F - 32) * 5 / 9 + 273.15; const P = 101325 * Math.pow(1 - 2.25577e-5 * (elevFt || 0) * 0.3048, 5.25588); return P / (287.05 * T); };
    // A good NFL kick: about 63 mph off the foot at 37°. Air drag on a tumbling ball; wind measured relative to the ball.
    // z0 = where the ball is held, in feet from the middle of the field (+ is the kicker's right); it's aimed at the middle of the uprights.
    function fly({ tail = 0, cross = 0, F = 60, elevFt = 0, wet = false, maxYd = 80, z0 = 0, dist = 45, vmul = 1, angErr = 0, aimFt = 0, arcDeg = 37 }) {
      const v0 = 28 * (1 - 0.0006 * Math.max(0, 60 - F)) * (wet ? 0.985 : 1) * vmul * (1 + (37 - arcDeg) * 0.004), a = arcDeg * Math.PI / 180;
      const k = 0.5 * rhoAt(F, elevFt) * 0.004 / 0.41;
      const aim = Math.atan2(aimFt - z0, dist * 3) + angErr * Math.PI / 180;
      let x = 0, y = 0, z = z0 * FT, vx = v0 * Math.cos(a) * Math.cos(aim), vy = v0 * Math.sin(a), vz = v0 * Math.cos(a) * Math.sin(aim);
      const pts = [[0, 0, z0]];
      for (let i = 0; i < 900; i++) {
        const dt = 0.01, rx = vx - tail, rz = vz - cross, sp = Math.hypot(rx, vy, rz);
        vx -= k * sp * rx * dt; vy -= (9.81 + k * sp * vy) * dt; vz -= k * sp * rz * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        if (i % 3 === 0) pts.push([x / YD, y, z / FT]);   // yards downfield, meters up, feet sideways
        if (y < 0 || x / YD > maxYd) break;
      }
      return pts;
    }
    const heightAt = (pts, yd) => { for (let i = 1; i < pts.length; i++) if (pts[i][0] >= yd) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (yd - x0) / (x1 - x0); } return -1; };
    const sideAt = (pts, yd) => { for (let i = 1; i < pts.length; i++) if (pts[i][0] >= yd) return pts[i][2]; return pts[pts.length - 1][2]; };
    const rangeOf = pts => { let best = 0; for (const [x, y] of pts) if (y >= BAR + 0.3) best = x; return Math.floor(best); };
    const NORMAL = rangeOf(fly({}));

    // ----- backend: field direction, both kickers, and the wind at the stadium right now -----
    const info = {};
    async function loadInfo(g) {
      if (info[g.id]) return info[g.id];
      if (DEMO) return (info[g.id] = demoKicking(g));
      try { info[g.id] = await (await fetch(API + '/kicking?id=' + encodeURIComponent(g.id))).json(); } catch (e) { info[g.id] = {}; }
      return info[g.id];
    }
    function demoKicking(g) {
      const k = (name, team, b, long) => ({ name, team, career: { made: b.reduce((a, x) => a + x[2], 0), att: b.reduce((a, x) => a + x[3], 0), long, buckets: b.map(([lo, hi, made, att]) => ({ lo, hi, made, att })) } });
      return { axis: 20, now: { f: 31, w: 17, g: 31, d: 255, snow: true, at: new Date().toISOString() }, kickers: {
        home: k('Home Kicker', g.home.abbr, [[1, 19, 1, 1], [20, 29, 45, 46], [30, 39, 52, 57], [40, 49, 48, 60], [50, 99, 25, 38]], 61),
        away: k('Away Kicker', g.away.abbr, [[1, 19, 2, 2], [20, 29, 38, 39], [30, 39, 41, 45], [40, 49, 30, 39], [50, 99, 9, 17]], 56) } };
    }

    // ----- make probability: career by distance (blended with league average), stretched by the weather -----
    const LEAGUE = [[19, 0.99], [25, 0.985], [35, 0.93], [45, 0.83], [53, 0.70], [58, 0.55], [63, 0.30], [68, 0.08], [72, 0.01]];
    function curve(career) {
      const pts = LEAGUE.map(p => [...p]);
      for (const b of career?.buckets || []) {
        if (!b.att) continue;
        const mid = b.hi >= 99 ? 53 : (b.lo + b.hi) / 2;
        const i = pts.findIndex(p => Math.abs(p[0] - mid) <= 3);
        if (i === -1) continue;
        pts[i][1] = (b.made + 8 * pts[i][1]) / (b.att + 8);
      }
      if (career?.long) for (const p of pts) if (p[0] > career.long + 2) p[1] *= Math.max(0.15, 1 - (p[0] - career.long) / 12);
      return pts;
    }
    function chance(career, yd, factor = 1, miss = 0) {
      const pts = curve(career), d = yd * factor;
      let p = pts[pts.length - 1][1];
      if (d <= pts[0][0]) p = pts[0][1];
      else for (let i = 1; i < pts.length; i++) if (d <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; p = y0 + (y1 - y0) * (d - x0) / (x1 - x0); break; }
      // wind pushing the ball off its line costs accuracy
      p *= 1 - Math.min(0.6, (Math.abs(miss) / HALF) ** 2 * 0.3);
      return Math.max(0, Math.min(0.995, p));
    }
    const pct = p => Math.round(p * 100) + '%';
    const careerLine = c => {
      if (!c) return 'Career record unavailable';
      const fifty = (c.buckets || []).find(b => b.lo >= 50);
      return `${c.att ? `${c.made}/${c.att} career (${Math.round(c.made / c.att * 100)}%)` : ''}${fifty ? `, ${fifty.made}/${fifty.att} from 50+` : ''}${c.long ? `, long ${c.long}` : ''}`;
    };

    // ----- weather -----
    // the simulator: what's blowing at the stadium right now (live game readings during a game)
    function windNow(g) {
      const elevFt = g.venue?.facts?.elevationFt || 0;
      if (g.roof === 'dome') return { F: 72, w: 0, g: 0, dir: null, wet: false, elevFt, indoor: true, label: 'Indoors' };
      const lw = g.live && g.liveWx, nw = info[g.id]?.now;
      const src = lw ? { f: lw.f, w: lw.w, g: lw.g, d: lw.d, wet: snowingLive(g) } : nw ? { f: nw.f, w: nw.w, g: nw.g, d: nw.d, wet: nw.snow || nw.wet } : null;
      if (src && Number.isFinite(src.f)) return { F: src.f, w: Math.round((src.w || 0) * 0.75), g: Math.round((src.g || src.w || 0) * 0.75), dir: src.d ?? null, wet: !!src.wet, elevFt, label: lw ? 'Live' : 'Right now' };
      const w = g.wx || {};
      return { F: Math.round(((w.lowF ?? 55) + (w.highF ?? w.lowF ?? 55)) / 2), w: Math.round((w.windAvgMph ?? w.windMph ?? 0) * 0.75), g: Math.round((w.gustMph ?? 0) * 0.75), dir: w.windDir ?? null, wet: (w.snowIn || 0) > 0 || (w.rainHours || 0) > 0, elevFt, label: 'Kickoff forecast' };
    }
    // the kicker profiles: the weather for the game itself
    function windDay(g) {
      if (g.roof === 'dome') return { F: 72, w: 0, dir: null, wet: false, elevFt: g.venue?.facts?.elevationFt || 0, indoor: true };
      if (g.live && g.liveWx) return windNow(g);
      const w = g.wx;
      if (!w) return { F: 55, w: 0, dir: null, wet: false, elevFt: g.venue?.facts?.elevationFt || 0, noForecast: true };
      return { F: Math.round((w.lowF + w.highF) / 2), w: Math.round((w.windAvgMph ?? w.windMph ?? 0) * 0.75), dir: w.windDir ?? null, wet: (w.snowIn || 0) > 0 || (w.rainHours || 0) > 0, elevFt: g.venue?.facts?.elevationFt || 0 };
    }
    // wind split into along-the-kick and across-the-kick parts (m/s), for a kick toward compass heading h
    function split(mph, dir, h) {
      if (dir == null || h == null || !mph) return { tail: 0, cross: 0 };
      const rel = ((dir + 180 - h) * Math.PI) / 180;   // wind blows toward dir + 180
      return { tail: mph * MPH * Math.cos(rel), cross: mph * MPH * Math.sin(rel) };
    }
    const along = (c, h) => { const p = split(c.w, c.dir, h); if (!c.w) return 'calm'; if (Math.abs(p.tail) < Math.abs(p.cross) * 0.6) return 'crosswind'; return p.tail > 0 ? 'wind at his back' : 'into the wind'; };

    // ----- the section -----
    function section(g) {
      return `<section class="gv-chart kicker" id="kicker">
        <h3>Kick simulator</h3>
        <div class="kick-live" id="kick-live"></div>
        <p class="gv-sub" id="kick-now">Checking the wind at ${esc(g.venue.name)}…</p>
        <div class="seg kick-end" role="group" aria-label="Which end zone to kick toward" id="kick-end"></div>
        <div class="seg kick-whois" role="group" aria-label="Kicker" id="kick-whois"></div>
        <div class="seg ks-cam-pick" role="group" aria-label="Camera" id="ks-cam-pick"><button data-kcam="cam">Kick cam</button><button data-kcam="map">Overhead</button></div>
        <div class="ks-stage">
          <canvas class="ks-gl" aria-hidden="true"></canvas>
          <canvas class="ks-canvas" aria-label="Behind the kicker. Tap to swing, drag sideways to aim, drag up or down to change the arc."></canvas>
          <svg class="ks-field" viewBox="0 0 340 210" role="img" aria-label="Field goal from above. Drag the ball to move it."></svg>
          <svg class="ks-side" viewBox="0 0 340 86" aria-hidden="true"></svg>
          <div class="kick-result" aria-live="polite"></div>
        </div>
        <p class="ks-last" id="ks-last" aria-live="polite"></p>
        <div class="ks-controls">
          <div class="seg ks-hash" role="group" aria-label="Ball position between the hashes">
            <button data-hash="-1">Left hash</button><button data-hash="0" aria-pressed="true">Middle</button><button data-hash="1">Right hash</button>
          </div>
          <div class="seg ks-arc" role="group" aria-label="Arc" id="ks-arc"><button data-arc="31">Low arc</button><button data-arc="38">Normal</button><button data-arc="45">High arc</button></div>
          <div class="ks-dist" role="group" aria-label="Kick distance"><button data-dy="-1" aria-label="Move closer">−</button><span id="ks-dist-txt">45 yd</span><button data-dy="1" aria-label="Move back">+</button></div>
          <button class="ks-kick" id="ks-kick">Kick it</button>
        </div>
        <div class="kc" id="kc"><button class="kc-start" id="kc-start">Kicking Combine</button><span class="kc-info" id="kc-info">10 kicks in the real wind here, moving back 5 yards after every make.</span></div>
        <div class="ks-read" id="ks-read"></div>
        <p class="ks-hint">Drag the ball to move it back or across the hashes. Each kick gets its own gust, so no two are the same.</p>
        <div class="kick-people" id="kick-people"></div>
        <p class="gv-source">An estimate from ball flight physics using the stadium's wind, temperature, and altitude, and each kicker's career record by distance. Wind inside the bowl is assumed lighter than the open-air reading. Sideways distances are stretched on the field drawing so the drift is visible.</p>
      </section>`;
    }

    let cur = null, endIdx = 0, yd = 45, z0 = 0, who = 'home', ends = [0, 180], axisKnown = false, userMoved = false;
    let raf = null, streaks = [], flight = null, lastKick = null, lastT = 0, gustT = 0, gustNow = 0;
    // ----- Kicking Combine: 10 kicks, back 5 yards after each make, best score saved for each stadium -----
    let combine = null;
    const bestKey = () => 'combine:' + (cur?.venue?.name || '');
    function startCombine() {
      combine = { n: 0, made: 0, score: 0, long: 0 };
      yd = 30; z0 = 0; userMoved = true; lastKick = null; camY = null; aimFt = 0;
      toast('Kicking Combine: 10 kicks. Good luck!'); Sound.whistle ? Sound.whistle() : Sound.crunch();
      layout(); combineInfo();
    }
    function combineResult(good) {
      if (!combine) return;
      combine.n++;
      if (good) { combine.made++; combine.score += yd; combine.long = Math.max(combine.long, yd); yd = Math.min(70, yd + 5); }
      z0 = [-HALF, 0, HALF][Math.floor(Math.random() * 3)];   // a new spot between the hashes each time
      if (combine.n >= 10) return endCombine();
      camY = null; layout(); combineInfo();
    }
    function endCombine(quit) {
      const c = combine; combine = null;
      if (c && !quit) {
        const best = store.get(bestKey(), null);
        const isBest = !best || c.score > best.score;
        if (isBest) store.set(bestKey(), { score: c.score, made: c.made, long: c.long, at: new Date().toISOString() });
        toast(isBest ? `New stadium record: ${c.score} points (${c.made} of 10, long ${c.long || 0})!` : `Combine over: ${c.score} points, ${c.made} of 10. Record here: ${best.score}.`);
        if (isBest && navigator.vibrate) navigator.vibrate([30, 40, 30, 40, 60]);
      }
      combineInfo();
    }
    function combineInfo() {
      const el = document.getElementById('kc-info'), btn = document.getElementById('kc-start'), kb = document.getElementById('ks-kick');
      if (!el || !cur) return;
      const best = store.get(bestKey(), null);
      if (combine) {
        el.innerHTML = `Kick <b>${combine.n + 1}</b> of 10 · <b>${yd}</b> yds · Score <b>${combine.score}</b> (${combine.made} made)${best ? ` · Record <b>${best.score}</b>` : ''}`;
        btn.textContent = 'Quit'; if (kb) kb.textContent = `Kick ${combine.n + 1} of 10`;
      } else {
        el.innerHTML = `10 kicks in the real wind here, moving back 5 yards after every make. Score = yards made.${best ? ` Your record at ${esc(cur.venue.name)}: <b>${best.score}</b> (${best.made} of 10).` : ''}`;
        btn.textContent = 'Kicking Combine'; if (kb) kb.textContent = mode === 'cam' ? 'Swing' : 'Kick it';
      }
    }

    // ----- kick cam: behind the kicker, console style, with a three-tap swing meter -----
    // tap 1 starts the swing, tap 2 sets the power on the way up, tap 3 sets the accuracy on the way down
    let mode = store.get('kickcam', 'cam'), meter = { phase: 'idle' }, aimFt = 0, camY = null, camZ = 5.2, kSky = null, bannerAt = null, bannerTxt = null;
    const LINE = 0.12;
    function meterDiff() {
      const c = windNow(cur);
      return { speed: 1 + (c.wet ? 0.3 : 0) + (c.F < 25 ? 0.12 : 0) + Math.min(0.25, (c.g || c.w || 0) / 60),
        zone: 0.055 / (1 + (c.wet ? 0.4 : 0) + Math.min(0.3, (c.w || 0) / 40)) };
    }
    function meterVal(now) {
      const d = meterDiff();
      if (meter.phase === 'up') return Math.min(1, (now - meter.t0) / 1000 * d.speed / 0.9);
      if (meter.phase === 'down') return meter.from - (now - meter.t0) / 1000 * d.speed / 0.7;
      return meter.m ?? 0;
    }
    function tapMeter() {
      if (!cur || flight) return;
      const now = performance.now();
      if (meter.phase === 'idle' || meter.phase === 'done') { meter = { phase: 'up', t0: now }; Sound.crunch(); }
      else if (meter.phase === 'up') { const m = meterVal(now); meter = { phase: 'down', t0: now, from: m, power: m }; Sound.crunch(); }
      else if (meter.phase === 'down') swing(meterVal(now));
    }
    function swing(m) {
      const d = meterDiff(), err = (m - LINE) / d.zone, power = meter.power ?? 0.9;
      meter = { phase: 'done', m, power, err };
      // overswinging into the red costs control; missing the line hooks or slices it
      const over = power > 0.92 ? (Math.random() - 0.5) * (power - 0.92) * 40 : 0;
      const angErr = Math.max(-7, Math.min(7, err * 1.5)) + over + (Math.random() - 0.5) * 0.4;
      kickAt = performance.now();
      kick({ vmul: 0.58 + 0.47 * power, angErr, swing: { power, err } });
    }
    function arcButtons() { for (const b of document.querySelectorAll('#ks-arc [data-arc]')) b.setAttribute('aria-pressed', Math.abs(+b.dataset.arc - arc) <= 3); }
    function applyMode() {
      const root = document.getElementById('kicker'); if (!root) return;
      root.classList.toggle('cam', mode === 'cam');
      for (const b of root.querySelectorAll('[data-kcam]')) b.setAttribute('aria-pressed', b.dataset.kcam === mode);
      const hint = root.querySelector('.ks-hint');
      if (hint) hint.textContent = mode === 'cam'
        ? 'Aim: drag sideways. Arc: drag up or down (or use the arc buttons); a low kick cuts through wind, a high one clears the rush but carries less. Kick: tap to start, tap to set the power, then tap as the marker crosses the line for accuracy. Bad weather speeds up the meter and shrinks the sweet spot.'
        : 'Drag the ball to move it back or across the hashes. Each kick gets its own gust, so no two are the same.';
      const kb = document.getElementById('ks-kick'); if (kb && !combine) kb.textContent = mode === 'cam' ? 'Swing' : 'Kick it';
      meter = { phase: 'idle' }; camY = null;
    }
    function camSetup(cv) {
      let down = null, moved = false;
      cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, aim: aimFt, arc }; moved = false; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', e => {
        if (!down || flight || meter.phase === 'up' || meter.phase === 'down') return;
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
        if (!moved) return;
        aimFt = Math.max(-15, Math.min(15, down.aim + dx / Math.max(200, cv.clientWidth) * 32));
        arc = Math.max(28, Math.min(50, Math.round(down.arc - dy / 6)));
      });
      cv.addEventListener('pointerup', () => { if (down && !moved) tapMeter(); else if (moved) { store.set('kickarc', arc); arcButtons(); } down = null; });
      cv.addEventListener('pointercancel', () => { down = null; });
    }

    // ----- the 3D scene (loaded on demand; the 2D drawing stays as the fallback) -----
    let k3 = null, k3Key = '', arc = store.get('kickarc', 38), replay = null, kickAt = null;
    const GL_OK = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
    async function load3d(g) {
      if (!GL_OK || REDUCED) return;
      const cv = document.querySelector('#kicker .ks-gl'); if (!cv) return;
      try {
        const mod = await (window.__sim3d ||= import('./sim3d.js'));
        if (cur !== g || !cv.isConnected) return;
        k3?.dispose();
        k3 = mod.makeWorld(cv, { lite: Gov.lite(), font: Arena.cssVar('--display', 'sans-serif') });
        k3Key = '';
        cv.closest('.ks-stage').classList.add('gl');
      } catch (e) { k3 = null; }
    }
    function sceneCfg(g, h, q) {
      return { home: { color: g.home.color, name: g.home.name, abbr: g.home.abbr }, away: { color: g.away.color, name: g.away.name, abbr: g.away.abbr }, score: g.score,
        night: !q.indoor && q.sun.el <= 0, dome: q.indoor, sun: { el: q.sun.el, rel: ((q.sun.az - h + 540) % 360) - 180 }, cloud: q.cloud,
        snow: q.indoor ? 0 : q.s.snow || 0, rain: q.indoor ? 0 : Math.max(q.s.rain || 0, q.s.thunder ? 0.7 : 0), fog: q.s.fog || 0, vis: q.vis,
        snowCover: q.indoor ? 0 : Math.min(0.85, Math.pow(Math.min(1, q.snowIn / 1.3), 0.7)), wet: q.wet, logo: maskUrl(g.home.logo) };
    }

    function drawCam(t) {
      const cv = document.querySelector('#kicker .ks-canvas');
      if (!cv || !cur) return;
      const busy = flight || replay || meter.phase === 'up' || meter.phase === 'down' || (bannerAt && t - bannerAt < 2700) || (kickAt && t - kickAt < 600);
      if (!busy && !Gov.ok('kickcam', cv, t)) return;
      const ctx = cv.getContext('2d'), dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth || 340, H = Math.round(W * 0.62);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = windNow(cur), h = ends[endIdx], q = QB.conds(cur);
      if (t > gustT) { gustT = t + 1200 + Math.random() * 2600; gustNow = Math.random() < 0.35 ? 1 : 0; }
      const mph = c.indoor ? 0 : c.w + (Math.max(c.g, c.w) - c.w) * gustNow;
      const wv = split(mph || 0, c.dir, h);
      if (meter.phase === 'up' && meterVal(t) >= 1) meter = { phase: 'down', t0: t, from: 1, power: 1 };
      if (meter.phase === 'down' && meterVal(t) < -0.15) swing(-0.15 - 0.3);
      const yh = 110 - yd, bx = z0 / 3, los = yh + 7;
      const w3 = p => [p[2] / 3, yh + p[0], Math.max(0, p[1] / 0.9144)];
      // the ball in the air (or the replay from behind the uprights)
      const showFlight = flight || (lastKick && lastKick.endT && t - lastKick.endT < 1500 && !replay ? lastKick : null);
      let ballW = null; const trail = [];
      if (showFlight) {
        const k = flight ? Math.min(1, (t - flight.t0) / flight.dur) : 1;
        const n = Math.max(2, Math.round(showFlight.pts.length * k));
        ballW = w3(showFlight.pts[Math.min(n, showFlight.pts.length) - 1]);
        for (let i = Math.max(0, n - 40); i < n; i += 2) trail.push(w3(showFlight.pts[i]));
        if (flight && k >= 1) { flight.endT = t; finishFlight(); if (k3) replay = { t0: t + 300, pts: lastKick.pts }; }
      }
      let rp = null;
      if (replay) {
        const k = (t - replay.t0) / 2200;
        if (k > 1) replay = null;
        else if (k >= 0) { const n = replay.pts.length, i = Math.min(n - 1, Math.floor(n * (0.35 + 0.65 * k))); rp = w3(replay.pts[i]); for (let j = Math.max(0, i - 40); j <= i; j += 2) trail.push(w3(replay.pts[j])); }
      }
      // the camera starts behind the holder and rides along behind the ball
      const wantY = ballW ? Math.min(ballW[1] - 10, 110 - 17) : yh - 11.5, wantZ = ballW ? 4.4 + ballW[2] * 0.35 : 4.6;
      if (camY == null) camY = wantY;
      camY += (wantY - camY) * (ballW ? 0.16 : 0.1); camZ += (wantZ - camZ) * 0.12;
      const night = c.indoor || q.sun.el <= 0;
      const kTeam = cur[who] || cur.home, dTeam = cur[who === 'home' ? 'away' : 'home'] || cur.away;
      // where the kicker is in his approach
      const contact = kickAt ? Math.min(1, (t - kickAt) / 450) : 0;
      const step = flight || replay || meter.phase === 'done' ? 1 : meter.phase === 'down' ? 0.5 + Math.min(0.45, (t - meter.t0) / 900) : meter.phase === 'up' ? Math.min(0.45, (t - meter.t0) / 1800) : 0;
      const kx = bx - 1.5 + 1.15 * Math.min(1, step), ky = yh - 2.5 + 1.9 * Math.min(1, step);
      if (k3) {
        if (k3Key !== cur.id + ':' + endIdx + ':' + Theme.get()) { k3.configure(sceneCfg(cur, h, q)); k3Key = cur.id + ':' + endIdx + ':' + Theme.get(); }
        const players = [];
        for (let i = -3; i <= 3; i++) players.push({ id: 'ol' + i, x: i * 1.05, y: los - 0.7, color: kTeam.color, num: String(60 + Math.abs(i) * 3 + (i < 0 ? 1 : 0)), pose: flight || replay ? 'block' : 'stance3', phase: t / 200 + i, face: 0 });
        for (const sd of [-1, 1]) players.push({ id: 'w' + sd, x: sd * 4.3, y: los - 1.4, color: kTeam.color, num: sd < 0 ? '85' : '88', pose: flight || replay ? 'block' : 'crouch', phase: t / 220, face: sd * -20 });
        const rush = flight || replay ? Math.min(1, contact * 1.5) : 0;
        for (let i = -4; i <= 4; i++) players.push({ id: 'dl' + i, x: i * 1.15 + 0.4, y: los + 0.9 - rush * 1.0, color: dTeam.color, num: String(90 + ((i + 4) % 9)), pose: flight || replay ? (Math.abs(i) <= 1 ? 'jump' : 'rush') : 'stance3', phase: t / 160 + i, face: 180 });
        players.push({ id: 'holder', x: bx + 0.7, y: yh + 0.1, color: kTeam.color, num: '4', pose: 'kneel', face: -70 });
        const kickPhase = flight || replay || meter.phase === 'done' ? 0.55 + 0.45 * contact : step * 0.55;
        players.push({ id: 'kicker', x: kx, y: ky, color: kTeam.color, num: '3', pose: 'kick', phase: kickPhase, face: 32 });
        players.forEach(p => { p.snow = !c.indoor && q.s.snow > 0.3; p.breath = !c.indoor && c.F < 34; });
        // the aim arrow and the start of the kick's path in calm air
        const tx = aimFt / 3, dx = tx - bx, dy = 110 - yh, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
        let preview = null;
        if (!showFlight && !replay) {
          const pts = fly({ F: c.F, elevFt: c.elevFt, z0, dist: yd, maxYd: Math.min(yd, 28), aimFt, arcDeg: arc });
          preview = pts.map(w3);
        }
        const camPos = rp ? [0, 117.5, 4.2] : ballW ? [bx * 0.6, camY, camZ] : [bx - 1.2, yh - 7.2, 2.6];
        const look = rp ? [bx * 0.4, yh + 25, 3.5] : ballW ? [bx * 0.3 + (ballW[0] - bx) * 0.6, camY + 32, 2 + ballW[2] * 0.35] : [bx + (tx - bx) * 0.2, yh + 30, 1.6];
        if (!ballW && !rp) { camY = yh - 7.2; camZ = 2.6; }
        const B = rp || ballW;
        k3.frame({ t, cam: { pos: camPos, look, fov: rp ? 46 : ballW ? 50 : 46 }, players, lines: { los },
          ball: B ? { x: B[0], y: B[1], z: B[2], spin: true } : { x: bx, y: yh, z: 0.2, yaw: Math.PI / 2 },
          trail: B ? trail : null, aim: showFlight || replay ? null : [[bx + ux * 1.2, yh + uy * 1.2], [bx + ux * 8, yh + uy * 8]], preview,
          wind: { cross: wv.cross / MPH, tail: wv.tail / MPH } });
        ctx.clearRect(0, 0, W, H);
      } else {
        // 2D fallback
        const cam = Arena.camera(W, H, bx * 0.6, camY, camZ, 8.5, 58);
        Arena.stadium(ctx, cam, { night, gray: !c.indoor && (q.cloud > 0.6 || q.s.rain || q.s.snow), home: cur.home.color, away: cur.away.color, t });
        Arena.field(ctx, cam, { night, home: cur.home.color, homeName: cur.home.name, logo: Arena.logoImg(cur.home.logo), snowIn: q.snowIn, wet: q.wet, lineA: Math.max(0.18, 1 - q.snowIn / 1.1), los });
        if (!showFlight) {
          const tx = aimFt / 3, ty = 110, L = 8, dx = tx - bx, dy = ty - yh, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
          const a = [bx + ux * 1.2, yh + uy * 1.2], b = [bx + ux * L, yh + uy * L], nx = -uy * 0.7, ny = ux * 0.7;
          Arena.poly(ctx, cam, [[a[0] + nx * 0.4, a[1] + ny * 0.4, 0.03], [b[0] + nx * 0.4, b[1] + ny * 0.4, 0.03], [b[0] + nx, b[1] + ny, 0.03], [b[0] + ux * 2, b[1] + uy * 2, 0.03], [b[0] - nx, b[1] - ny, 0.03], [b[0] - nx * 0.4, b[1] - ny * 0.4, 0.03], [a[0] - nx * 0.4, a[1] - ny * 0.4, 0.03]], 'rgba(255,214,40,0.78)');
        }
        Arena.goalpost(ctx, cam, 110, { home: cur.home.color, wind: mph, cross: wv.cross / MPH, tail: wv.tail / MPH, t });
        const ppl = [];
        const rushK = flight ? Math.min(1, (t - flight.t0) / 700) : 0;
        for (let i = -3; i <= 3; i++) ppl.push([i * 1.05, los - 0.7 - rushK * 0.5, { color: kTeam.color, crouch: !flight, num: String(60 + Math.abs(i) * 3 + (i < 0 ? 1 : 0)) }]);
        for (const sd of [-1, 1]) ppl.push([sd * 4.3, los - 1.4, { color: kTeam.color, crouch: !flight, num: sd < 0 ? '85' : '88' }]);
        for (let i = -4; i <= 4; i++) ppl.push([i * 1.15 + 0.4, los + 0.9 - rushK * 1.1, { color: dTeam.color, toward: true, crouch: !flight, num: String(90 + ((i + 4) % 9)), phase: flight ? t / 80 : 0 }]);
        ppl.push([bx + 0.6, yh - 0.1, { color: kTeam.color, kneel: true, num: '4' }]);
        ppl.push([kx, ky, { color: kTeam.color, phase: step > 0 && step < 1 ? t / 70 : 0, num: '3' }]);
        ppl.sort((a, b) => b[1] - a[1]);
        const common = { t, snow: !c.indoor && q.s.snow > 0.3, breath: !c.indoor && c.F < 32, pants: '#E9E6DC' };
        for (const [x, y, o] of ppl) Arena.player(ctx, cam, x, y, { ...common, ...o });
        if (ballW) Arena.football(ctx, cam, ballW[0], ballW[1], ballW[2], t, trail);
        else Arena.football(ctx, cam, bx, yh, 0.14, 0);
        if (q.vis < 2500) Arena.visibility(ctx, cam, q.vis, q.s.snow ? '232,238,243' : q.s.fog ? '205,211,217' : night ? '70,80,92' : '150,160,172');
        if (!kSky || kSky.key !== weatherOf(cur).key + Theme.get()) { kSky = makeSky({ ...q.s, sun: 0, cloud: 0, fog: 0, frigid: 0, heat: 0 }, { gold: Theme.get() === 'scoreboard' }); kSky.key = weatherOf(cur).key + Theme.get(); }
        if (!c.indoor) kSky.step(ctx, W, H, t, 1);
      }
      // ----- on-screen graphics -----
      Arena.scorebug(ctx, W, cur, rp ? 'REPLAY' : `${yd} YD FG`);
      // how long the attempt is, and where the ball is snapped from
      if (!showFlight && !replay && !(bannerAt && t - bannerAt < 2600)) {
        const spot = yd - 17, line = spot === 50 ? 'MIDFIELD' : `${spot < 50 ? 'OPP' : 'OWN'} ${spot < 50 ? spot : 100 - spot}`;
        ctx.font = Arena.hudFont(15); const t1 = `${yd}-YARD ATTEMPT`, tw = Math.max(ctx.measureText(t1).width, 90) + 26;
        Arena.plate(ctx, 8, 34, tw, 24, 'rgba(10,14,22,0.85)', Arena.cssVar('--amber', '#F5B841'));
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t1, 20, 46.5);
        ctx.font = Arena.hudFont(9.5, 800); ctx.fillStyle = Arena.cssVar('--amber', '#F5B841'); ctx.fillText(`FROM THE ${line} · ARC ${arc}°`, 14, 68);
      }
      Arena.windBadge(ctx, 26, H - 44, 15, mph, c.dir == null ? null : c.dir + 180 - h, c.indoor ? 'INDOORS' : null);
      const k = info[cur.id]?.kickers?.[who];
      ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.font = Arena.hudFont(11, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      if (k && !rp) { ctx.textAlign = 'right'; ctx.font = Arena.hudFont(9.5, 800); ctx.fillText(String(k.name).toUpperCase(), W - 50, 42); }
      if (!rp) { drawMeter(ctx, W, H, t); drawArc(ctx, W, H); }
      if (!flight && !replay && (meter.phase === 'idle' || meter.phase === 'done') && !(bannerAt && t - bannerAt < 2600)) {
        const msg = combine ? `COMBINE · KICK ${combine.n + 1} OF 10 · TAP TO KICK` : 'TAP TO KICK';
        ctx.font = Arena.hudFont(12); const tw = ctx.measureText(msg).width + 26;
        Arena.plate(ctx, W / 2 - tw / 2, H - 28, tw, 21, 'rgba(10,14,22,0.82)', 'rgba(255,255,255,0.35)');
        ctx.fillStyle = (Math.sin(t / 260) + 1) / 2 > 0.3 ? '#fff' : Arena.cssVar('--amber', '#F5B841'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(msg, W / 2, H - 17);
      }
      if (bannerAt) Arena.banner(ctx, W, H, bannerTxt[0], bannerTxt[1], (t - bannerAt) / 1000, bannerTxt[2]);
      Arena.themeFinish(ctx, W, H);
    }
    // the arc (launch angle) gauge next to the meter
    function drawArc(ctx, W, H) {
      const x = W - 62, y = H - 26, r = 18;
      ctx.fillStyle = 'rgba(8,10,18,0.8)'; ctx.beginPath(); ctx.moveTo(x - r - 4, y + 4); ctx.arc(x, y, r + 4, Math.PI, 0); ctx.lineTo(x + r + 4, y + 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, Math.PI, 0); ctx.stroke();
      const a = -arc * Math.PI / 180;
      ctx.strokeStyle = Arena.cssVar('--ice', '#8FD3FF'); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - r * 0.9, y); ctx.lineTo(x - r * 0.9 + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 1.5); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = Arena.hudFont(8, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText('ARC', x + 6, y - 4);
    }

    function drawMeter(ctx, W, H, t) {
      const d = meterDiff(), x = W - 30, top = H * 0.2, mh = H * 0.56, mw = 13;
      const Y = m => top + mh * (1 - (m + 0.15) / 1.15);
      ctx.fillStyle = 'rgba(8,10,18,0.85)'; ctx.fillRect(x - 4, top - 16, mw + 8, mh + 24);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x - 4, top - 16, mw + 8, mh + 24);
      const g = ctx.createLinearGradient(0, Y(1), 0, Y(0));
      g.addColorStop(0, '#FF3B30'); g.addColorStop(0.08, '#FF9F0A'); g.addColorStop(0.45, '#FFD60A'); g.addColorStop(1, '#34C759');
      ctx.fillStyle = g; ctx.fillRect(x, Y(1), mw, Y(0) - Y(1));
      ctx.fillStyle = '#26303D'; ctx.fillRect(x, Y(0), mw, Y(-0.15) - Y(0));
      // the sweet spot (narrower in bad weather)
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(x - 3, Y(LINE + d.zone), mw + 6, Y(LINE - d.zone) - Y(LINE + d.zone));
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 4, Y(LINE) - 1, mw + 8, 2);
      if (meter.power != null) { ctx.fillStyle = Arena.cssVar('--amber', '#F5B841'); ctx.fillRect(x - 6, Y(meter.power) - 1.5, mw + 12, 3); }
      const live = meter.phase === 'up' || meter.phase === 'down';
      if (live || meter.phase === 'done') {
        const m = live ? meterVal(t) : meter.m, y = Y(Math.max(-0.15, Math.min(1, m)));
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 10, y - 5); ctx.lineTo(x - 2, y); ctx.lineTo(x - 10, y + 5); ctx.closePath(); ctx.fill();
        ctx.fillRect(x, y - 1.5, mw, 3);
      }
      ctx.fillStyle = '#fff'; ctx.font = Arena.hudFont(8, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('KICK', x + mw / 2, top - 5);
      if (live) { ctx.font = Arena.hudFont(10, 900); ctx.textAlign = 'right'; ctx.fillText(meter.phase === 'up' ? 'POWER' : 'ACCURACY', x - 12, meter.phase === 'up' ? top + 8 : Y(LINE) + 4); }
    }
    function finishFlight() {
      const f = flight, out = document.querySelector('#kicker .kick-result');
      const msg = f.text + ` (${Math.round(f.wv.mph)} mph gust${f.wv.dir != null ? ` from the ${compass(f.wv.dir)}` : ''})`;
      const last = document.getElementById('ks-last');
      if (mode === 'cam' && last) { last.textContent = msg; last.className = 'ks-last ' + (f.good ? 'good' : 'miss'); }
      else if (out) { out.textContent = msg; out.className = 'kick-result show ' + (f.good ? 'good' : 'miss'); }
      if (f.good && navigator.vibrate) navigator.vibrate(20);
      bannerAt = performance.now(); bannerTxt = f.banner;
      if (f.good) Sound.jingle ? Sound.jingle(Theme.get()) : null; else Sound.crunch();
      const wasGood = f.good;
      flight = null;
      setTimeout(() => { if (meter.phase === 'done') meter = { phase: 'idle' }; }, 1600);
      if (combine) setTimeout(() => combineResult(wasGood), 700);
    }

    async function mount(g) {
      stop();
      const root = document.getElementById('kicker');
      if (!root) return;
      cur = g; endIdx = 0; yd = 45; z0 = 0; userMoved = false; lastKick = null; flight = null;
      who = 'home';
      root.querySelector('#kick-end').addEventListener('click', e => { const b = e.target.closest('[data-end]'); if (!b) return; endIdx = +b.dataset.end; lastKick = null; layout(); Sound.crunch(); });
      root.querySelector('#kick-whois').addEventListener('click', e => { const b = e.target.closest('[data-who]'); if (!b) return; who = b.dataset.who; layout(); Sound.crunch(); });
      root.querySelector('.ks-hash').addEventListener('click', e => { const b = e.target.closest('[data-hash]'); if (!b) return; z0 = +b.dataset.hash * HALF; userMoved = true; lastKick = null; layout(); });
      root.querySelector('#ks-kick').addEventListener('click', () => mode === 'cam' ? tapMeter() : kick());
      root.querySelector('#kc-start').addEventListener('click', () => combine ? endCombine(true) : startCombine());
      root.querySelector('#ks-cam-pick').addEventListener('click', e => { const b = e.target.closest('[data-kcam]'); if (!b) return; mode = b.dataset.kcam; store.set('kickcam', mode); applyMode(); Sound.crunch(); });
      root.querySelector('.ks-dist').addEventListener('click', e => { const b = e.target.closest('[data-dy]'); if (!b || flight) return; yd = Math.max(18, Math.min(70, yd + +b.dataset.dy)); userMoved = true; lastKick = null; camY = null; layout(); Sound.crunch(); });
      combine = null; combineInfo();
      aimFt = 0; meter = { phase: 'idle' }; bannerAt = null; kSky = null;
      dragSetup(root.querySelector('.ks-field'));
      camSetup(root.querySelector('.ks-canvas'));
      root.querySelector('#ks-arc').addEventListener('click', e => { const b = e.target.closest('[data-arc]'); if (!b || flight) return; arc = +b.dataset.arc; store.set('kickarc', arc); arcButtons(); layout(); Sound.crunch(); });
      arcButtons(); replay = null; kickAt = null;
      applyMode();
      load3d(g);
      layout();
      raf = requestAnimationFrame(frame);
      await loadInfo(g);
      if (cur !== g) return;
      // during a game, start with the team that has the ball
      const s = g.live ? g.situation : null;
      if (s?.poss === g.away.abbr) who = 'away';
      layout();
    }
    function refresh(g) {
      if (!cur || !g || g.id !== cur.id || !document.getElementById('kicker')) return;
      cur = g;
      if (g.live && g.situation?.poss && !userMoved) who = g.situation.poss === g.away.abbr ? 'away' : 'home';
      layout();
    }
    function stop() { cancelAnimationFrame(raf); raf = null; flight = null; }

    function layout() {
      const g = cur, inf = info[g.id] || {}, c = windNow(g);
      axisKnown = inf.axis != null;
      ends = tvEnds(g, axisKnown ? inf.axis : null);
      // live: put the ball where the offense is
      const s = g.live ? g.situation : null;
      if (s?.toGoal != null && !userMoved) yd = Math.max(18, Math.min(70, s.toGoal + 17));
      const live = document.getElementById('kick-live');
      if (live) live.innerHTML = g.live && s?.poss ? `<span class="live-dot">Live</span><span><b>${esc(s.poss)} ball</b>${s.text ? `, ${esc(s.text)}` : ''}${s.toGoal != null ? `. A field goal from here would be <b>${s.toGoal + 17} yards</b>.` : ''}</span>` : '';
      const now = document.getElementById('kick-now');
      if (now) now.textContent = c.indoor ? `${g.venue.name} has a roof, so there's no wind to fight. Normal indoor conditions.`
        : `${c.label === 'Live' ? 'Live' : c.label === 'Right now' ? 'Right now' : 'Kickoff forecast'} at ${g.venue.name}: ${c.w ? `${c.w} mph wind in the bowl${c.dir != null ? ` from the ${compass(c.dir)}` : ''}${c.g > c.w ? `, gusting to ${c.g}` : ''}` : 'calm'}, ${c.F}°${c.elevFt > 3000 ? `, thin air at ${c.elevFt.toLocaleString()} ft` : ''}${c.wet ? ', slick footing' : ''}.${axisKnown ? ` On TV, the left end zone is the ${compass(ends[0])} end.` : ''}`;
      const endBox = document.getElementById('kick-end');
      if (endBox) {
        endBox.hidden = !!c.indoor;
        endBox.innerHTML = ends.map((h, i) => `<button data-end="${i}" aria-pressed="${i === endIdx}">Kick toward the ${tvName(i)}<small>${esc(along(c, h))}</small></button>`).join('') + flipBtn();
      }
      const whoBox = document.getElementById('kick-whois');
      if (whoBox) {
        const ks = inf.kickers || {};
        const opts = ['away', 'home'].filter(sd => ks[sd]);
        whoBox.hidden = !opts.length;
        if (opts.length && !ks[who]) who = opts[0];
        whoBox.innerHTML = opts.map(sd => `<button data-who="${sd}" aria-pressed="${sd === who}">${esc(ks[sd].name)}<small>${esc(cur[sd].name)}</small></button>`).join('');
      }
      for (const b of document.querySelectorAll('#kicker [data-hash]')) b.setAttribute('aria-pressed', Math.abs(+b.dataset.hash * HALF - z0) < 0.5);
      const dt = document.getElementById('ks-dist-txt'); if (dt) dt.textContent = `${yd} yd`;
      readout();
      people();
    }

    // the make chance from here: many kicks, each with its own gust, through this kicker's record
    function samples(n = 36) {
      const c = windNow(cur), h = ends[endIdx];
      let seedv = 7;
      const rnd = () => (seedv = (seedv * 9301 + 49297) % 233280) / 233280;
      const out = [];
      for (let i = 0; i < n; i++) out.push(windSample(c, h, rnd));
      return { c, h, out };
    }
    function windSample(c, h, rnd = Math.random) {
      const mph = c.w + Math.max(0, (c.g || c.w) - c.w) * Math.pow(rnd(), 2);
      const dir = c.dir == null ? null : c.dir + (rnd() - 0.5) * 24;
      return { mph, dir, ...split(mph, dir, h) };
    }
    function flyWith(c, wv, maxYd, o = {}) { return fly({ F: c.F, elevFt: c.elevFt, wet: c.wet, tail: wv.tail, cross: wv.cross, z0, dist: yd, maxYd: maxYd || Math.max(yd + 6, 40), vmul: o.vmul ?? 1, angErr: o.angErr ?? 0, aimFt: o.aimFt ?? 0, arcDeg: o.arcDeg ?? (mode === 'cam' ? arc : 37) }); }
    function readout() {
      const box = document.getElementById('ks-read'); if (!box || !cur) return;
      const k = info[cur.id]?.kickers?.[who];
      const { c, out } = samples();
      let p = 0, makes = 0;
      for (const wv of out) {
        const pts = flyWith(c, wv, 75);
        const factor = NORMAL / Math.max(20, rangeOf(pts)) * (mode === 'cam' ? 1 + Math.abs(arc - 38) * 0.004 : 1);
        p += chance(k?.career, yd, factor, sideAt(pts, yd));
        if (heightAt(pts, yd) >= BAR && Math.abs(sideAt(pts, yd)) <= HALF) makes++;
      }
      p /= out.length;
      const calm = chance(k?.career, yd, 1, 0);
      box.innerHTML = `<div class="ks-p"><b>${pct(p)}</b><span>${k ? esc(k.name) : 'An average NFL kicker'} from ${yd} yards${Math.abs(z0) > 1 ? `, ${z0 > 0 ? 'right' : 'left'} hash` : ''}</span></div>
        <div class="ks-p muted"><b>${pct(calm)}</b><span>on a calm 60° day</span></div>
        <div class="ks-p muted"><b>${Math.round(makes / out.length * 100)}%</b><span>of gusts let a perfect kick through</span></div>`;
    }

    // ----- drag the ball -----
    // the drawing: goalposts at x = 330, 4 px per yard downfield, 4 px per foot across (stretched)
    const PX = 4, POST = 330, MID = 105;
    const holdX = () => POST - yd * PX, holdY = () => MID + z0 * PX;
    function dragSetup(svg) {
      let dragging = false;
      const toPoint = e => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * 340 / r.width, y: (e.clientY - r.top) * 210 / r.height }; };
      const move = e => {
        const p = toPoint(e);
        yd = Math.max(18, Math.min(70, Math.round((POST - p.x) / PX)));
        z0 = Math.max(-HALF, Math.min(HALF, (p.y - MID) / PX));
        if (Math.abs(z0) < 1.2) z0 = 0; else if (HALF - Math.abs(z0) < 1.2) z0 = Math.sign(z0) * HALF;
        userMoved = true; lastKick = null;
      };
      svg.addEventListener('pointerdown', e => {
        const p = toPoint(e);
        if (Math.hypot(p.x - holdX(), p.y - holdY()) > 34 && !(e.pointerType === 'mouse')) { /* tap elsewhere: move the ball there */ }
        dragging = true; svg.setPointerCapture(e.pointerId); move(e); flight = null;
      });
      svg.addEventListener('pointermove', e => { if (dragging) move(e); });
      const end = () => { if (!dragging) return; dragging = false; layout(); Sound.crunch(); };
      svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    }

    // ----- kick! -----
    function kick(o = {}) {
      if (!cur || flight) return;
      const c = windNow(cur), h = ends[endIdx];
      const wv = windSample(c, h);
      const pts = flyWith(c, wv, null, { ...o, aimFt: mode === 'cam' ? aimFt : 0 });
      const hgt = heightAt(pts, yd), side = sideAt(pts, yd);
      let text, good = false, banner;
      const sw = o.swing, leg = sw && sw.power < 0.6 ? ' Not enough leg on it.' : '', hook = sw && Math.abs(sw.err) > 1.2 ? ` He ${sw.err > 0 ? 'pushed' : 'pulled'} it off his swing.` : '';
      if (hgt < BAR) { text = (hgt < 0 ? 'Short. It never got there.' : `Short. Under the crossbar by ${((BAR - hgt) * 3.28).toFixed(0)} ft.`) + leg; banner = ['NO GOOD', 'SHORT', '#FF5A5F']; }
      else if (Math.abs(side) > HALF) { text = `No good. Wide ${side > 0 ? 'right' : 'left'} by ${(Math.abs(side) - HALF).toFixed(0)} ft.` + hook; banner = ['NO GOOD', `WIDE ${side > 0 ? 'RIGHT' : 'LEFT'}`, '#FF5A5F']; }
      else { good = true; text = Math.abs(side) > 3 ? `Good! The wind moved it ${Math.abs(side).toFixed(0)} ft but it stayed inside.` : `Good! Cleared the bar by ${((hgt - BAR) * 3.28).toFixed(0)} ft.`; banner = ["IT'S GOOD!", `${yd}-YARD FIELD GOAL`, '#3DDC84']; }
      flight = { pts, t0: performance.now(), dur: REDUCED ? 1 : mode === 'cam' ? Math.max(1400, pts.length * 26) : 1900, good, text, wv, banner };
      lastKick = flight;
      const out = document.querySelector('#kicker .kick-result'); if (out) out.className = 'kick-result';
      Sound.whoosh();
    }

    // ----- drawing: the field from above with the wind blowing across it, and the arc from the side -----
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (mode === 'cam') return drawCam(t);
      const svg = document.querySelector('#kicker .ks-field'), side = document.querySelector('#kicker .ks-side');
      if (!svg || !cur) return;
      if (!flight && !Gov.ok('kick', svg, t)) return;
      const dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
      const c = windNow(cur), h = ends[endIdx];
      // the wind gusts and lulls on its own
      if (t > gustT) { gustT = t + 1200 + Math.random() * 2600; gustNow = Math.random() < 0.35 ? 1 : 0; }
      const mph = c.w + (Math.max(c.g, c.w) - c.w) * gustNow;
      const wv = split(mph || 0, c.dir, h);
      const sx = wv.tail / MPH, sy = wv.cross / MPH;   // mph along and across, in screen terms
      // streaks blowing across the field
      const want = c.indoor || !mph ? 0 : Math.round(Math.min(46, 10 + mph * 1.4));
      while (streaks.length < want) streaks.push({ x: Math.random() * 340, y: Math.random() * 210, l: 0.4 + Math.random() * 0.6 });
      if (streaks.length > want) streaks.length = want;
      const vlen = Math.hypot(sx, sy) || 1;
      for (const s of streaks) {
        s.x += sx * dt * 6; s.y += sy * dt * 6;
        if (s.x > 350) s.x = -10; if (s.x < -10) s.x = 350; if (s.y > 220) s.y = -10; if (s.y < -10) s.y = 220;
      }
      const showFlight = flight || lastKick;
      let n = 0, ballP = null;
      if (showFlight) {
        const k = flight ? Math.min(1, (t - flight.t0) / flight.dur) : 1;
        n = Math.max(2, Math.round(showFlight.pts.length * k));
        ballP = showFlight.pts[Math.min(n, showFlight.pts.length) - 1];
        if (flight && k >= 1) { flight.endT = t; finishFlight(); }
      }
      const X = yds => holdX() + yds * PX, Y = ft => MID + ft * PX;
      // the field itself only needs drawing once
      if (!svg.querySelector('.ks-dyn')) {
      let body = '';
      // grass, end zone, yard lines and numbers (counted to the goal line), hash marks
      body += `<rect x="0" y="0" width="340" height="210" class="ks-grass"/><rect x="${POST - 40}" y="0" width="${340 - POST + 40}" height="210" class="ks-ez"/>`;
      for (let yl = 0; yl <= 80; yl += 5) {
        const x = POST - 40 - yl * PX; if (x < 0) break;
        body += `<line x1="${x}" y1="0" x2="${x}" y2="210" class="ks-yl${yl % 10 ? ' thin' : ''}"/>`;
        if (yl % 10 === 0 && yl > 0) body += `<text x="${x}" y="200" class="ks-num">${yl > 50 ? 100 - yl : yl}</text><text x="${x}" y="18" class="ks-num">${yl > 50 ? 100 - yl : yl}</text>`;
      }
      for (let yl = 1; yl < 80; yl++) { const x = POST - 40 - yl * PX; if (x < 0) break; body += `<line x1="${x}" y1="${Y(-HALF) - 3}" x2="${x}" y2="${Y(-HALF) + 3}" class="ks-hashm"/><line x1="${x}" y1="${Y(HALF) - 3}" x2="${x}" y2="${Y(HALF) + 3}" class="ks-hashm"/>`; }
      body += `<g class="ks-post"><line x1="${POST}" y1="${Y(-HALF)}" x2="${POST}" y2="${Y(HALF)}"/><circle cx="${POST}" cy="${Y(-HALF)}" r="3.2"/><circle cx="${POST}" cy="${Y(HALF)}" r="3.2"/><line x1="${POST}" y1="${MID}" x2="${POST + 8}" y2="${MID}"/></g>`;
      svg.innerHTML = `<g class="ks-static">${body}</g><g class="ks-dyn"></g>`;
      }
      let body = '';
      // wind streaks
      if (want) body += `<g class="ks-wind">${streaks.map(s => `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${(s.x - sx / vlen * 14 * s.l).toFixed(1)}" y2="${(s.y - sy / vlen * 14 * s.l).toFixed(1)}" style="opacity:${(0.2 + s.l * 0.5 * (gustNow ? 1.3 : 1)).toFixed(2)}"/>`).join('')}</g>`;
      // the line from the hold to the middle of the uprights
      body += `<line x1="${holdX()}" y1="${holdY()}" x2="${POST}" y2="${MID}" class="ks-aim"/>`;
      // the flight: a shadow on the grass and the ball up in the air
      if (showFlight) {
        const pts = showFlight.pts.slice(0, n).filter(p => p[1] >= -0.1);
        body += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[2]).toFixed(1)}`).join('')}" class="ks-shadow-path"/>`;
        body += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${(Y(p[2]) - p[1] * 2.2).toFixed(1)}`).join('')}" class="ks-trail" style="stroke:${C1}"/>`;
        if (ballP && ballP[1] >= -0.1) {
          const bx = X(ballP[0]), by = Y(ballP[2]);
          body += `<ellipse cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" rx="${3 + ballP[1] * 0.1}" ry="${1.6 + ballP[1] * 0.05}" class="ks-shadow"/>`;
          body += `<g transform="translate(${bx.toFixed(1)} ${(by - ballP[1] * 2.2).toFixed(1)}) rotate(${(t / 2) % 360})"><ellipse rx="${4 + ballP[1] * 0.18}" ry="${2.6 + ballP[1] * 0.1}" class="k-ball"/></g>`;
        }
      }
      // the holder's spot (drag it)
      if (!flight) body += `<g class="ks-hold" transform="translate(${holdX()} ${holdY()})"><circle r="13" class="ks-grab"/><path d="M-6 0 Q0 -4 6 0 Q0 4 -6 0Z" class="k-ball"/></g>`;
      // compass and wind readout
      const nAng = (-h - 90) * Math.PI / 180;   // where north is on the drawing (kick goes to the right)
      const nx = 28 + Math.cos(nAng + Math.PI / 2) * 12, ny = 186 + Math.sin(nAng + Math.PI / 2) * 12;
      body += `<g class="ks-compass"><circle cx="28" cy="186" r="15"/><line x1="28" y1="186" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"/><text x="${(28 + (nx - 28) * 1.9).toFixed(1)}" y="${(186 + (ny - 186) * 1.9 + 3).toFixed(1)}">N</text></g>`;
      body += `<text x="334" y="204" class="ks-windtxt">${c.indoor ? 'Indoors' : mph ? `${Math.round(mph)} mph${gustNow && c.g > c.w ? ' gust' : ''}` : 'Calm'}</text>`;
      svg.querySelector('.ks-dyn').innerHTML = body;

      // side view of the arc
      if (side) {
        const Wd = 340, G = 74, span = Math.max(yd + 6, 40), SX = v => 10 + v / span * (Wd - 20);
        const pts = showFlight ? showFlight.pts : flyWith(c, wv);
        const maxH = Math.max(12, ...pts.map(p => p[1])) * 1.15, SY = m => G - Math.max(0, m) / maxH * (G - 6);
        let sb = `<line x1="0" y1="${G}" x2="${Wd}" y2="${G}" class="k-ground"/>`;
        const gx = SX(yd);
        sb += `<g class="k-post"><line x1="${gx}" y1="${G}" x2="${gx}" y2="${SY(BAR)}"/><line x1="${gx - 4}" y1="${SY(BAR)}" x2="${gx + 4}" y2="${SY(BAR)}"/><line x1="${gx}" y1="${SY(BAR)}" x2="${gx}" y2="${SY(BAR + 9)}"/></g>`;
        const shown = showFlight ? pts.slice(0, n) : pts;
        sb += `<path d="${shown.map((p, i) => `${i ? 'L' : 'M'}${SX(p[0]).toFixed(1)} ${SY(p[1]).toFixed(1)}`).join('')}" class="${showFlight ? 'k-today' : 'k-calm'}" style="${showFlight ? `stroke:${C1}` : ''}"/>`;
        sb += `<text x="${Wd - 6}" y="12" class="k-wind-t">${showFlight ? 'Side view' : 'Side view: the kick in this gust'}</text>`;
        side.innerHTML = sb;
      }
    }

    // ----- both kickers: career record, and estimates for the game's weather -----
    function people() {
      const box = document.getElementById('kick-people');
      const inf = info[cur?.id];
      if (!box) return;
      if (!inf) { box.innerHTML = `<p class="kp-head">Looking up the kickers…</p>`; return; }
      if (!inf.kickers || (!inf.kickers.home && !inf.kickers.away)) { box.innerHTML = `<p class="kp-head">Kicker records aren't available for this game yet.</p>`; return; }
      const c = windDay(cur);
      const dirs = c.indoor || c.noForecast || !c.w ? [{ tail: 0, cross: 0 }] : ends.map(hh => split(c.w, c.dir, hh));
      const flights = dirs.map(d => fly({ F: c.F, elevFt: c.elevFt, wet: c.wet, tail: d.tail, cross: d.cross, maxYd: 75 }));
      const est = (k, d) => {
        const ps = flights.map(pts => chance(k.career, d, NORMAL / Math.max(20, rangeOf(pts)), sideAt(pts, d)));
        return { avg: ps.reduce((a, b) => a + b, 0) / ps.length, lo: Math.min(...ps), hi: Math.max(...ps) };
      };
      const ranges = flights.map(rangeOf);
      const s = cur.live ? cur.situation : null;
      const card = sd => {
        const k = inf.kickers[sd]; if (!k) return '';
        const on = s?.poss && s.poss === cur[sd].abbr;
        const rows = [30, 40, 50, 55].map(d => {
          const e = est(k, d), calm = chance(k.career, d, 1, 0);
          return `<tr><th>${d} yd</th><td class="kp-today"><b>${pct(e.avg)}</b>${e.hi - e.lo > 0.06 ? `<small>${pct(e.lo)}–${pct(e.hi)}</small>` : ''}</td><td>${pct(calm)}</td></tr>`;
        }).join('');
        const buckets = (k.career?.buckets || []).filter(b => b.att).map(b => `<span>${b.hi >= 99 ? `${b.lo}+` : `${b.lo}–${b.hi}`}: <b>${b.made}/${b.att}</b></span>`).join('');
        return `<div class="kp${on ? ' on' : ''}">
          <div class="kp-top">${logo(cur[sd])}<span class="kp-main"><b>${esc(k.name)}</b><small>${esc(cur[sd].name)} kicker${on ? ' · has the ball' : ''}</small></span></div>
          <p class="kp-career">${esc(careerLine(k.career))}</p>
          ${buckets ? `<div class="kp-buckets">${buckets}</div>` : ''}
          <table class="kp-table"><thead><tr><th></th><th>${cur.live ? 'Now' : 'Game day'}</th><th>Calm day</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="kp-range">Estimated range: <b>${Math.min(...ranges) === Math.max(...ranges) ? `${ranges[0]} yd` : `${Math.min(...ranges)}–${Math.max(...ranges)} yd`}</b> depending on the end${k.career?.long ? ` (career long ${k.career.long})` : ''}</p>
        </div>`;
      };
      box.innerHTML = `<p class="kp-head">The kickers${c.indoor ? ' (indoors)' : c.noForecast ? ' (typical weather until the forecast is in)' : cur.live ? ' (current conditions)' : " (game day forecast, both ends' range shown)"}</p>${card('away')}${card('home')}`;
    }

    return { section, mount, stop, refresh, fly, chance, info: g => info[g.id], load: loadInfo, NORMAL, rangeOf, sideAt };
  })();


  // ---------- Two-week outlook: ask the backend to build it if it isn't there yet ----------
  let outlookAsked = false;
  async function ensureOutlook() {
    if (DEMO || outlookAsked || state.data?.outlook?.items?.length) return;
    outlookAsked = true;
    try {
      const o = await (await fetch(API + '/outlook?build=1', { cache: 'no-store' })).json();
      if (o && o.items) { state.data.outlook = o; renderOutlook(); capSoon($('#outlook')); }
    } catch (e) { /* try again next time the app opens */ }
  }


  // =====================================================================================
  // ---------- Blizzard mode: the app's snowfall matches the real snowfall rate during a live game ----------
  const Blizzard = (() => {
    const haze = $('#whiteout');
    let cur = 0;
    const rateOf = g => g && g.live && g.liveWx ? Math.max(g.liveWx.lastHourIn || 0, g.liveWx.snowNow || 0) : 0;
    function level(rate) {
      if (rate >= 1) return { n: 4, label: 'Whiteout', flakes: 620, haze: 0.34 };
      if (rate >= 0.6) return { n: 3, label: 'Heavy snow', flakes: 440, haze: 0.16 };
      if (rate >= 0.25) return { n: 2, label: 'Moderate snow', flakes: 290, haze: 0.05 };
      if (rate >= 0.05) return { n: 1, label: 'Light snow', flakes: 170, haze: 0 };
      if (rate > 0) return { n: 0.5, label: 'Flurries', flakes: 95, haze: 0 };
      return null;
    }
    // home screen: the heaviest snow game in progress; game view: that game
    function apply(g, where) {
      const rate = rateOf(g), L = level(rate);
      cur = L ? L.n : 0;
      const windMph = g?.liveWx?.g || g?.liveWx?.w || 0;
      if (where === 'home') Snow.blizzard(L ? L.flakes : 0, windMph);
      else FX.blizzard(L ? L.flakes : 0, windMph);
      const h = L && !REDUCED ? L.haze : 0;
      haze.style.opacity = h;
      haze.classList.toggle('on', h > 0);
      Soundscape.level(L ? Math.min(1, 0.25 + L.n * 0.19) : null);
      return L;
    }
    function off() { cur = 0; Snow.blizzard(0); FX.blizzard(0); haze.style.opacity = 0; haze.classList.remove('on'); }
    const label = g => { const L = level(rateOf(g)); return L ? `${L.label}, ${rateOf(g).toFixed(2)}″/hr` : ''; };
    return { apply, off, label, level: () => cur, rateOf };
  })();

  // =====================================================================================
  // ---------- Field cam: the yard lines disappear as snow piles up; the grounds crew plows them back ----------
  const FieldCam = (() => {
    let cv = null, ctx = null, raf = null, g = null, base = null, snowTex = null, W = 0, H = 0, dpr = 1;
    let inches = 0, rate = 0, mode = 'live', series = [], qIndex = 0, clear = {}, plow = null, lastT = 0, autoT = 0, heated = false;
    const LINES = []; for (let yd = 0; yd <= 100; yd += 5) LINES.push(yd);
    function section(game) {
      if (!game || game.roof === 'dome' || !game.wx) return '';
      const liveSnow = game.live && snowingLive(game);
      const forecastSnow = !game.live && !game.final && game.level > 0 && game.wx.timeline?.some(h => h.inGame && h.s > 0);
      if (!liveSnow && !forecastSnow) return '';
      const heat = game.venue?.facts?.heated;
      return `<section class="gv-chart fieldcam" id="fieldcam">
        <h3>Field cam</h3>
        <p class="gv-sub">${liveSnow ? 'Live: the field right now, from the snow that has fallen since kickoff' : 'Forecast: how the field could look as the game goes on'}${heat ? '. The field is heated, which helps melt light snow.' : ''}</p>
        <div class="fc-stage"><canvas class="fc-canvas"></canvas><div class="fc-badge" id="fc-badge"></div></div>
        ${liveSnow ? '' : `<div class="seg fc-q" role="group" aria-label="Game time">${['Kickoff', '1st', '2nd', '3rd', '4th', 'Final'].map((q, i) => `<button data-q="${i}" aria-pressed="${i === 0}">${q}</button>`).join('')}</div>`}
        <div class="fc-row"><span id="fc-depth"></span><button class="secondary fc-crew" id="fc-crew">Send the grounds crew</button></div>
      </section>`;
    }
    function mount(game) {
      stop();
      const root = document.getElementById('fieldcam');
      if (!root) return;
      g = game; cv = root.querySelector('canvas'); ctx = cv.getContext('2d');
      heated = !!g.venue?.facts?.heated;
      clear = {}; plow = null; autoT = performance.now() + 6000;
      if (g.live && snowingLive(g)) { mode = 'live'; inches = g.liveWx.snowSoFarIn; rate = Blizzard.rateOf(g); }
      else {
        mode = 'forecast';
        // cumulative snow at kickoff and the end of each quarter (4 game hours ≈ 4 quarters)
        const inGame = g.wx.timeline.filter(h => h.inGame);
        let run = 0; series = [run];   // crews clear the field before kickoff
        for (let q = 0; q < 4; q++) { run += inGame[Math.min(q, inGame.length - 1)]?.s || 0; series.push(run); }
        series.push(run);
        qIndex = 0; inches = series[0]; rate = inGame[0]?.s || 0;
        root.querySelector('.fc-q').addEventListener('click', e => {
          const b = e.target.closest('[data-q]'); if (!b) return;
          qIndex = +b.dataset.q; inches = series[qIndex]; rate = inGame[Math.min(Math.max(qIndex - 1, 0), inGame.length - 1)]?.s || 0;
          for (const x of root.querySelectorAll('[data-q]')) x.setAttribute('aria-pressed', x === b);
          clear = {}; info(); Sound.crunch();
        });
      }
      root.querySelector('#fc-crew').addEventListener('click', () => { sendCrew(); Sound.crunch(); });
      build(); info();
      addEventListener('resize', onResize);
      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function onResize() { if (cv) build(); }
    function stop() { cancelAnimationFrame(raf); raf = null; removeEventListener('resize', onResize); cv = null; }
    function refresh(game) {
      if (!cv || !game || game.id !== g?.id || mode !== 'live' || !game.liveWx) return;
      g = game; inches = game.liveWx.snowSoFarIn; rate = Blizzard.rateOf(game); info();
    }
    // snow that "sticks" on the field: heated fields melt light snow
    const eff = () => Math.max(0, heated ? inches - 0.3 : inches);
    function info() {
      const d = document.getElementById('fc-depth');
      const e = eff();
      if (d) d.innerHTML = `<b>${inches.toFixed(1)}″</b> ${mode === 'live' ? 'since kickoff' : qIndex === 0 ? 'on the field at kickoff' : 'by then'}${e >= 0.6 ? ', yard lines buried' : e >= 0.2 ? ', lines fading' : ''}`;
    }
    function build() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = Math.round(W * 0.46);
      cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
      // field with stripes, end zones, yard lines and numbers
      base = document.createElement('canvas'); base.width = cv.width; base.height = cv.height;
      const b = base.getContext('2d'); b.scale(dpr, dpr);
      const ez = W * 0.075, fx = yd => ez + (W - 2 * ez) * yd / 100;
      for (let i = 0; i < 20; i++) { b.fillStyle = i % 2 ? '#2F6B35' : '#367A3C'; b.fillRect(fx(i * 5), 0, fx(5) - fx(0) + 1, H); }
      b.fillStyle = '#24502A'; b.fillRect(0, 0, ez, H); b.fillRect(W - ez, 0, ez, H);
      b.strokeStyle = '#F4F7F2'; b.fillStyle = '#F4F7F2';
      b.lineWidth = 2; b.strokeRect(1, 1, W - 2, H - 2);
      for (const yd of LINES) { b.lineWidth = yd % 10 === 0 ? 2.2 : 1.4; b.beginPath(); b.moveTo(fx(yd), 2); b.lineTo(fx(yd), H - 2); b.stroke(); }
      b.font = `800 ${Math.max(10, H * 0.11)}px ${getComputedStyle(document.body).getPropertyValue('--display') || 'sans-serif'}`;
      b.textAlign = 'center';
      for (let yd = 10; yd <= 90; yd += 10) { const n = yd > 50 ? 100 - yd : yd; b.fillText(String(n), fx(yd), H * 0.24); b.save(); b.translate(fx(yd), H * 0.82); b.rotate(Math.PI); b.fillText(String(n), 0, 0); b.restore(); }
      // hash marks
      for (let yd = 1; yd < 100; yd++) { b.fillRect(fx(yd) - 0.5, H * 0.38, 1, 4); b.fillRect(fx(yd) - 0.5, H * 0.62 - 4, 1, 4); }
      b.save(); b.globalAlpha = 0.18; b.font = `900 ${H * 0.16}px sans-serif`; b.translate(ez / 2, H / 2); b.rotate(-Math.PI / 2); b.fillText('SNOW', 0, H * 0.05); b.restore();
      // a snow layer with drifts and texture
      snowTex = document.createElement('canvas'); snowTex.width = cv.width; snowTex.height = cv.height;
      const s = snowTex.getContext('2d'); s.scale(dpr, dpr);
      s.fillStyle = '#EEF4F8'; s.fillRect(0, 0, W, H);
      let seedv = seed(String(g?.id || 'x'));
      const rnd = () => (seedv = (seedv * 9301 + 49297) % 233280) / 233280;
      for (let i = 0; i < 260; i++) { const x = rnd() * W, y = rnd() * H, r = 6 + rnd() * 26; const gr = s.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rnd() > 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(196,214,228,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); s.fillStyle = gr; s.fillRect(x - r, y - r, r * 2, r * 2); }
      for (let i = 0; i < 900; i++) { s.fillStyle = `rgba(160,184,204,${0.15 + rnd() * 0.25})`; s.fillRect(rnd() * W, rnd() * H, 1, 1); }
      // footprints/tracks across the middle of the field
      s.strokeStyle = 'rgba(150,175,198,0.35)'; s.lineWidth = 3;
      for (let i = 0; i < 6; i++) { s.beginPath(); let x = rnd() * W, y = rnd() * H; s.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 80; y += (rnd() - 0.5) * 40; s.lineTo(x, y); } s.stroke(); }
    }
    function sendCrew() {
      if (plow || eff() < 0.2) { if (eff() < 0.2) toast('The lines are still clear. No need for the crew yet.'); return; }
      // plow the lines from one end of the field to the other, then the crew heads off
      plow = { idx: 0, t: 0 };
    }
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (!cv || !base || !Gov.ok('fcam', cv, t)) return;
      const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
      const e = eff();
      // coverage of the field and how visible the painted lines are under it
      const cover = Math.min(0.97, Math.pow(Math.min(1, e / 0.9), 0.7));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(base, 0, 0);
      ctx.globalAlpha = cover; ctx.drawImage(snowTex, 0, 0); ctx.globalAlpha = 1;
      const ez = W * 0.075, fx = yd => (ez + (W - 2 * ez) * yd / 100) * dpr;
      // plowed lines: re-cut the snow over each cleared line, with a little bank of snow along each side
      const refill = (rate || 0.15) * (mode === 'live' ? 0.08 : 0.04);   // how fast they fill back in
      for (const yd of LINES) {
        const c = clear[yd] || 0;
        if (c <= 0) continue;
        const x = fx(yd), w = (yd % 10 === 0 ? 5 : 4) * dpr;
        ctx.globalAlpha = c;
        ctx.drawImage(base, x - w / 2, 0, w, cv.height, x - w / 2, 0, w, cv.height);
        ctx.globalAlpha = 1;
        if (!REDUCED) clear[yd] = Math.max(0, c - refill * dt);
      }
      // the plow working its way down the field
      if (plow) {
        const yd = LINES[plow.idx];
        plow.t += dt * (REDUCED ? 50 : 2.4);
        const p = Math.min(1, plow.t);
        const x = fx(yd), y = p * cv.height;
        const w = (yd % 10 === 0 ? 5 : 4) * dpr;
        ctx.drawImage(base, x - w / 2, 0, w, y, x - w / 2, 0, w, y);
        // the plow: a little orange tractor
        ctx.save(); ctx.translate(x, y); ctx.scale(dpr, dpr);
        ctx.fillStyle = '#E8862A'; ctx.fillRect(-6, -14, 12, 12);
        ctx.fillStyle = '#1B1B1B'; ctx.fillRect(-7, -12, 3, 5); ctx.fillRect(4, -12, 3, 5);
        ctx.fillStyle = '#BFC7CE'; ctx.fillRect(-9, -2, 18, 3);
        ctx.fillStyle = '#FFE58A'; ctx.globalAlpha = 0.6 + Math.sin(t / 90) * 0.4; ctx.fillRect(-2, -16, 4, 2);
        ctx.restore();
        if (p >= 1) { clear[yd] = 1; plow.idx++; plow.t = 0; if (plow.idx >= LINES.length) { plow = null; toast('Grounds crew cleared the yard lines.'); } }
      }
      // falling snow on the camera
      if (!REDUCED && e > 0 && rate > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        const n = Math.min(120, 20 + rate * 120);
        for (let i = 0; i < n; i++) { const k = (i * 7919) % 1000 / 1000, x = ((k * W + t * 0.02 * (1 + k)) % W) * dpr, y = (((i * 104729) % 997) / 997 * H + t * 0.04 * (0.6 + k)) % H * dpr; ctx.fillRect(x, y, (1 + k * 1.5) * dpr, (1 + k * 1.5) * dpr); }
      }
      // live games: the crew comes out on its own once the lines are buried
      if (mode === 'live' && !plow && e >= 0.6 && t > autoT) {
        const visible = LINES.filter(yd => (clear[yd] || 0) > 0.3).length;
        if (visible < 4) { plow = { idx: 0, t: 0 }; autoT = t + 45000; }
      }
      const badge = document.getElementById('fc-badge');
      if (badge) { const txt = plow ? 'Grounds crew on the field' : e >= 0.6 ? 'Lines buried' : e >= 0.2 ? 'Lines fading' : 'Lines clear'; if (badge.textContent !== txt) badge.textContent = txt; }
    }
    return { section, mount, stop, refresh };
  })();

  // =====================================================================================
  // ---------- Snow game soundscape: muffled crowd, wind and the odd whistle, heavier with the snow ----------
  const Soundscape = (() => {
    let ctx = null, nodes = null, want = null, timer = null;
    function ac() { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; if (!ctx) ctx = new C(); if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    function brown(c) {
      const len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      return buf;
    }
    function start(level) {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = brown(c); src.loop = true;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
      const crowd = c.createGain(); crowd.gain.value = 0;
      // the crowd breathes: a slow swell
      const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 0.02; lfo.connect(lg).connect(crowd.gain);
      src.connect(lp).connect(crowd).connect(c.destination);
      // the wind howling through the bowl, as strong as the real wind
      const wsrc = c.createBufferSource(); wsrc.buffer = brown(c); wsrc.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.9;
      const windG = c.createGain(); windG.gain.value = 0;
      const wl = c.createOscillator(); wl.frequency.value = 0.13; const wlg = c.createGain(); wlg.gain.value = 90; wl.connect(wlg).connect(bp.frequency);
      wsrc.connect(bp).connect(windG).connect(c.destination);
      wsrc.start(t); wl.start(t);
      src.start(t); lfo.start(t);
      nodes = { src, lp, crowd, lfo, wsrc, bp, windG, wl };
      set(level, true);
      schedule();
    }
    function set(level, now) {
      if (!nodes || !ctx) return;
      const t = ctx.currentTime;
      // heavier snow: quieter, more muffled crowd
      nodes.lp.frequency.setTargetAtTime(700 - level * 380, t, now ? 0.01 : 1.5);
      nodes.crowd.gain.setTargetAtTime(0.055 - level * 0.015, t, now ? 0.4 : 2);
      nodes.windG.gain.setTargetAtTime(Math.min(0.16, windMph / 30 * 0.11), t, now ? 0.4 : 2);
    }
    let windMph = 0;
    function wind(mph) { windMph = mph || 0; if (nodes) set(want ?? 0.3); }
    // a gust: the howl swells and rises in pitch
    function gust(k) {
      if (!nodes || !ctx) return; const t = ctx.currentTime, g = nodes.windG.gain, f = nodes.bp.frequency;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(Math.min(0.32, g.value + 0.08 + k * 0.14), t + 0.5); g.linearRampToValueAtTime(Math.min(0.16, windMph / 30 * 0.11), t + 2.6);
      f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.linearRampToValueAtTime(420 + k * 380, t + 0.5); f.linearRampToValueAtTime(420, t + 2.6);
    }
    // the crowd erupts (a real score during a live game)
    function roar(big) {
      if (!nodes || !ctx) return; const t = ctx.currentTime, g = nodes.crowd.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(big ? 0.3 : 0.2, t + 0.6); g.linearRampToValueAtTime(0.06, t + (big ? 6 : 4));
      nodes.lp.frequency.setValueAtTime(nodes.lp.frequency.value, t); nodes.lp.frequency.linearRampToValueAtTime(1500, t + 0.6); nodes.lp.frequency.linearRampToValueAtTime(600, t + 5);
    }
    // now and then: a roar from the crowd, or a whistle muffled by the snow
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!nodes || !ctx || document.visibilityState === 'hidden') return schedule();
        const t = ctx.currentTime;
        if (Math.random() < 0.6) {
          const g = nodes.crowd.gain; g.cancelScheduledValues(t);
          g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.16, t + 1.2); g.linearRampToValueAtTime(0.05, t + 4);
          nodes.lp.frequency.setValueAtTime(nodes.lp.frequency.value, t); nodes.lp.frequency.linearRampToValueAtTime(1100, t + 1.2); nodes.lp.frequency.linearRampToValueAtTime(500, t + 4);
        } else whistle(t);
        schedule();
      }, 9000 + Math.random() * 14000);
    }
    function whistle(t) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2600;
      const trill = ctx.createOscillator(); trill.frequency.value = 38; const tg = ctx.createGain(); tg.gain.value = 120; trill.connect(tg).connect(o.frequency);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.03); g.gain.setValueAtTime(0.03, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(lp).connect(g).connect(ctx.destination); o.start(t); trill.start(t); o.stop(t + 0.75); trill.stop(t + 0.75);
    }
    function stop() {
      clearTimeout(timer); want = null;
      if (!nodes || !ctx) return;
      const n = nodes; nodes = null;
      const t = ctx.currentTime;
      n.crowd.gain.cancelScheduledValues(t); n.crowd.gain.setTargetAtTime(0, t, 0.4);
      n.windG.gain.cancelScheduledValues(t); n.windG.gain.setTargetAtTime(0, t, 0.4);
      setTimeout(() => { try { n.src.stop(); n.lfo.stop(); n.wsrc.stop(); n.wl.stop(); } catch (e) {} }, 1500);
    }
    // level 0..1 (null = off). Plays only with sound effects on, in a snow game's view.
    function level(l) {
      want = l;
      if (l == null || !store.get('sound', false) || !GameView.isOpen()) { if (nodes) stop(); return; }
      if (!nodes) start(l); else set(l);
    }
    return { level, stop, wind, gust, roar };
  })();

  // =====================================================================================
  // ---------- Retro TV: a snow game on a 1970s–80s television ----------
  // 90s: a star wipe across the screen, like a game changing levels
  function NinetyWipe() {
    const el = document.createElement('div');
    el.className = 'ninety-wipe';
    el.innerHTML = `<span>SNOW GAME RADAR</span><b>PRESS START</b>`;
    document.body.appendChild(el);
    Sound.whoosh();
    setTimeout(() => el.classList.add('off'), 950);
    setTimeout(() => el.remove(), 1500);
  }
  const Retro = (() => {
    function bars() {
      if (REDUCED) return;
      const el = document.createElement('div');
      el.className = 'retro-bars';
      el.innerHTML = `<div class="rb-top">${['#C0C0C0', '#C0C000', '#00C0C0', '#00C000', '#C000C0', '#C00000', '#0000C0'].map(c => `<i style="background:${c}"></i>`).join('')}</div>
        <div class="rb-mid">${['#0000C0', '#131313', '#C000C0', '#131313', '#00C0C0', '#131313', '#C0C0C0'].map(c => `<i style="background:${c}"></i>`).join('')}</div>
        <div class="rb-bot"><i style="background:#00214C"></i><i style="background:#FFFFFF"></i><i style="background:#32006A"></i><i style="background:#131313"></i></div>
        <div class="rb-card"><b>SNOW GAME RADAR</b><span>PLEASE STAND BY</span></div>`;
      document.body.appendChild(el);
      tone();
      setTimeout(() => el.classList.add('off'), 1100);
      setTimeout(() => el.remove(), 1700);
    }
    // the classic 1 kHz test tone, briefly
    function tone() {
      if (!store.get('sound', false)) return;
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      const c = new C(), o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 1000; g.gain.value = 0.03; o.connect(g).connect(c.destination);
      o.start(); o.stop(c.currentTime + 0.9); setTimeout(() => c.close(), 1200);
    }
    return { bars };
  })();


  // =====================================================================================
  // ---------- What the weather will be (or is, or was) for a game ----------
  // From the game-time forecast, live readings during the game, or the recorded hours after it.
  // Each kind gets a strength from 0 to 1 so effects can mix: a windy, frigid, snowy night, say.
  const RAIN_CODES = { 51: 0.2, 53: 0.25, 55: 0.3, 61: 0.35, 63: 0.6, 65: 0.9, 80: 0.45, 81: 0.7, 82: 1 };
  function weatherOf(g) {
    const none = { spec: { night: true, clearNight: true }, primary: 'dome', label: 'Indoors', key: 'dome' };
    if (!g || g.roof === 'dome') return none;
    const w = g.wx, lw = g.live && g.liveWx;
    if (!w && !lw) return { spec: { night: true, clearNight: true, cloud: 0.2 }, primary: 'unknown', label: 'Forecast coming', key: 'unknown' };
    const codes = lw ? [lw.c] : (w.hours || []).map(h => h.c);
    const n = Math.max(1, codes.length);
    const share = test => codes.filter(test).length / n;
    const max = (f, base = 0) => codes.reduce((m, c) => Math.max(m, f(c) ?? base), base);
    const low = lw ? lw.f : w.lowF, high = lw ? lw.f : w.highF, feels = lw ? lw.fl : (w.feelsLowF ?? w.lowF);
    const gust = lw ? lw.g : (w.gustMph || 0);
    const s = {};
    s.night = w ? w.night !== false : true;
    s.rain = max(c => RAIN_CODES[c]);
    if (!lw && w && (w.rainHours || 0) > 0 && w.precipChance >= 40) s.rain = Math.max(s.rain, 0.3);
    s.thunder = share(c => c >= 95) > 0 ? Math.min(1, 0.5 + share(c => c >= 95)) : 0;
    s.hail = codes.some(c => c === 96 || c === 99) ? 0.8 : 0;
    s.ice = codes.some(c => [56, 57, 66, 67].includes(c)) ? 0.8 : (s.rain > 0 && low <= 34 ? 0.4 : 0);
    const liveSnow = snowingLive(g) ? Math.min(1, 0.35 + Blizzard.rateOf(g) * 1.2) : 0;
    s.snow = Math.max(liveSnow, g.level > 0 && w ? Math.min(1, 0.3 + (w.snowIn || 0) / 2.2) : 0, share(c => c >= 71 && c <= 86 && c !== 80 && c !== 81 && c !== 82) > 0 ? 0.4 : 0);
    s.fog = share(c => c === 45 || c === 48) > 0 ? Math.min(1, 0.5 + share(c => c === 45 || c === 48)) : 0;
    const overcast = share(c => c === 3), partly = share(c => c === 1 || c === 2), clear = share(c => c === 0);
    s.cloud = Math.min(1, overcast + partly * 0.45 + (s.rain || s.snow || s.thunder ? 0.6 : 0));
    s.sun = !s.night && !s.rain && !s.snow && !s.fog && !s.thunder ? Math.min(1, clear + partly * 0.6) : 0;
    s.frigid = feels != null && feels <= 22 ? Math.min(1, (32 - feels) / 32) : 0;
    s.wind = gust >= 20 ? Math.min(1, (gust - 14) / 26) : 0;
    s.heat = high != null && high >= 84 ? Math.min(1, (high - 78) / 16) : 0;
    s.clearNight = s.night && !s.rain && !s.snow && !s.fog && !s.thunder && s.cloud < 0.5;
    // the headline, strongest first
    const order = [['snow', s.snow, s.snow > 0.7 ? 'Heavy snow' : 'Snow'], ['ice', s.ice >= 0.8 ? 1 : 0, 'Freezing rain'], ['hail', s.hail, 'Hail'], ['thunder', s.thunder, 'Thunderstorms'],
      ['rain', s.rain, s.rain > 0.6 ? 'Heavy rain' : 'Rain'], ['ice', s.ice, 'Sleet'], ['fog', s.fog, 'Fog'], ['wind', s.wind >= 0.5 ? s.wind : 0, 'Windy'], ['frigid', s.frigid >= 0.5 ? s.frigid : 0, 'Frigid'],
      ['heat', s.heat, 'Hot'], ['sun', s.sun > 0.5 ? s.sun : 0, 'Sunny'], ['night', s.clearNight ? 1 : 0, 'Clear night'], ['cloud', s.cloud > 0.4 ? s.cloud : 0, 'Cloudy']];
    const top = order.find(o => o[1] > 0) || ['cloud', 0.3, 'Mild'];
    const key = Object.entries(s).filter(([, v]) => typeof v === 'number' && v > 0).map(([k, v]) => k + Math.round(v * 3)).sort().join(',');
    return { spec: s, primary: top[0], label: top[2], key };
  }

  // ---------- The weather engine: draws any mix of weather onto a canvas ----------
  // Used for the game intros, behind the game view, on the Weather Game of the Week card, and in the replay.
  function makeSky(spec, opt = {}) {
    const S = { rain: 0, snow: 0, hail: 0, ice: 0, fog: 0, cloud: 0, sun: 0, thunder: 0, frigid: 0, wind: 0, heat: 0, ...spec };
    const parts = { rain: [], snow: [], hail: [], splash: [], drops: [], gust: [], leaf: [], puff: [], cloud: [], fog: [] };
    let flash = 0, nextBolt = 900 + Math.random() * 1600, bolt = null, lastPuff = 0, t0 = null, lastT = 0, swirl = 0, glaze = null, frost = null;
    const over = { snowN: 0, wind: 0 };
    const gold = !!opt.gold;
    const col = (c, a) => gold ? `rgba(255,214,130,${a})` : `rgba(${c},${a})`;
    function bgPaint(ctx, W, H) {
      let top, bot;
      if (S.night) {
        top = S.rain || S.thunder ? '#121A24' : S.fog ? '#3B4550' : '#0B1626'; bot = S.rain || S.thunder ? '#1E2A38' : S.fog ? '#59636D' : '#17304D';
        if (S.frigid > 0.5) { top = '#0E2236'; bot = '#2B5674'; }
      } else if (S.thunder || S.rain > 0.5) { top = '#2A3442'; bot = '#4E5D6E'; }
      else if (S.rain || S.cloud > 0.6) { top = '#56687D'; bot = '#9AAABA'; }
      else if (S.fog) { top = '#8D99A3'; bot = '#C3CBD1'; }
      else if (S.heat > 0.3) { top = '#3F8FDB'; bot = '#F0C987'; }
      else if (S.frigid > 0.5) { top = '#7FB2D8'; bot = '#E4F1FA'; }
      else { top = '#3E86D6'; bot = '#A8D2F2'; }
      if (S.snow && !S.night) { top = '#7E93A8'; bot = '#C9D6E1'; }
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bot);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    function makeGlaze(W, H, s) {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      const edge = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      edge.addColorStop(0, 'rgba(200,230,250,0)'); edge.addColorStop(1, 'rgba(200,230,250,0.45)');
      x.fillStyle = edge; x.fillRect(0, 0, W, H);
      x.strokeStyle = 'rgba(240,250,255,0.75)'; x.lineCap = 'round';
      const crack = (px, py, ang, len, depth) => {
        if (depth > 4 || len < 6 * s) return;
        const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
        x.lineWidth = Math.max(0.6, (4 - depth) * 0.5 * s); x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
        const n = 1 + (Math.random() < 0.6);
        for (let i = 0; i < n; i++) crack(ex, ey, ang + (Math.random() - 0.5) * 1.3, len * (0.55 + Math.random() * 0.3), depth + 1);
      };
      for (let i = 0; i < 9; i++) { const side = i % 4, px = side === 0 ? 0 : side === 1 ? W : Math.random() * W, py = side === 2 ? 0 : side === 3 ? H : Math.random() * H; crack(px, py, Math.atan2(H / 2 - py, W / 2 - px) + (Math.random() - 0.5), Math.min(W, H) * 0.22, 0); }
      return c;
    }
    function makeFrost(W, H, s) {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      const band = Math.min(W, H) * 0.22;
      for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) { const g = x.createRadialGradient(cx, cy, 0, cx, cy, band * 1.6); g.addColorStop(0, 'rgba(236,246,252,0.6)'); g.addColorStop(1, 'rgba(236,246,252,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
      x.strokeStyle = 'rgba(245,251,255,0.7)'; x.lineCap = 'round';
      const fern = (px, py, ang, len, d) => { if (d > 3 || len < 4 * s) return; const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len; x.lineWidth = Math.max(0.5, (3 - d) * 0.6 * s); x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke(); for (let k = 1; k <= 3; k++) { const f = k / 4, bx = px + (ex - px) * f, by = py + (ey - py) * f; fern(bx, by, ang + 0.9, len * 0.35, d + 1); fern(bx, by, ang - 0.9, len * 0.35, d + 1); } };
      for (let i = 0; i < 14; i++) { const corner = i % 4, cx = corner % 2 ? W : 0, cy = corner > 1 ? H : 0; fern(cx + (corner % 2 ? -1 : 1) * Math.random() * band, cy + (corner > 1 ? -1 : 1) * Math.random() * band, Math.atan2(H / 2 - cy, W / 2 - cx) + (Math.random() - 0.5) * 1.2, band * (0.5 + Math.random() * 0.5), 0); }
      return c;
    }
    function step(ctx, W, H, now, s = 1) {
      if (t0 == null) t0 = now;
      const Q = Gov.lite() ? 0.45 : 1;   // fewer particles in Battery saver
      const t = now - t0, dt = Math.min(0.05, (now - lastT) / 1000 || 0.016); lastT = now;
      swirl *= 0.985;
      const windX = ((S.wind || 0) * 5 + 0.4 + Math.max(0, over.wind) * 2 + swirl * 3 + (typeof Tilt !== 'undefined' ? Tilt.x * 1.4 : 0)) * s;
      if (opt.bg) bgPaint(ctx, W, H);
      // ---- sun: glow, slow rays and a little lens flare
      if (S.sun > 0 || (S.heat > 0 && !S.rain && !S.thunder)) {
        const a = Math.max(S.sun, S.rain || S.thunder ? 0 : S.heat * 0.8), sx = W * 0.82, sy = H * 0.1;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.55);
        g.addColorStop(0, `rgba(255,246,214,${0.75 * a})`); g.addColorStop(0.25, `rgba(255,230,160,${0.25 * a})`); g.addColorStop(1, 'rgba(255,230,160,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(t / 9000);
        for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.fillStyle = `rgba(255,245,210,${0.06 * a})`; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-W * 0.05, -Math.max(W, H)); ctx.lineTo(W * 0.05, -Math.max(W, H)); ctx.fill(); }
        ctx.restore();
        for (const [f, r, al] of [[0.35, 26, 0.12], [0.55, 12, 0.18], [0.8, 40, 0.07]]) { ctx.fillStyle = `rgba(255,240,200,${al * a})`; ctx.beginPath(); ctx.arc(sx + (W / 2 - sx) * f * 2, sy + (H / 2 - sy) * f * 2, r * s, 0, 6.283); ctx.fill(); }
      }
      // ---- stadium lights switching on, bank by bank (clear nights)
      if (opt.lights && S.clearNight) {
        for (const side of [0, 1]) {
          const bx = side ? W * 0.84 : W * 0.16, by = H * 0.08;
          for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
            const i = r * 4 + c, on = t > 120 + i * 70 + side * 40;
            if (!on) continue;
            const x = bx + (c - 1.5) * 12 * s, y = by + r * 10 * s;
            ctx.fillStyle = 'rgba(255,248,225,0.95)'; ctx.beginPath(); ctx.arc(x, y, 3.2 * s, 0, 6.283); ctx.fill();
          }
          if (t > 1000) { const g = ctx.createLinearGradient(bx, by, side ? W * 0.45 : W * 0.55, H); g.addColorStop(0, 'rgba(255,240,200,0.35)'); g.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(bx - 20 * s, by); ctx.lineTo(bx + 20 * s, by); ctx.lineTo(side ? W * 0.3 : W * 0.95, H); ctx.lineTo(side ? W * 0.05 : W * 0.7, H); ctx.fill(); }
        }
      }
      // ---- clouds drifting across the top
      if (S.cloud > 0.15) {
        const want = Math.round(3 + S.cloud * 6);
        while (parts.cloud.length < want) parts.cloud.push({ x: Math.random() * W, y: Math.random() * H * 0.35, r: (40 + Math.random() * 70) * s, v: 0.2 + Math.random() * 0.4 });
        const dark = S.rain || S.thunder ? '120,132,146' : '245,248,252';
        for (const c of parts.cloud) {
          c.x += (c.v * s + windX * 0.15) * dt * 60; if (c.x - c.r * 2 > W) c.x = -c.r * 2;
          for (const [ox, oy, rr] of [[0, 0, 1], [0.7, 0.15, 0.75], [-0.7, 0.2, 0.7], [0.2, -0.3, 0.6]]) {
            const x = c.x + ox * c.r, y = c.y + oy * c.r, R = c.r * rr;
            const g = ctx.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, `rgba(${dark},${0.32 * S.cloud})`); g.addColorStop(1, `rgba(${dark},0)`);
            ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2);
          }
        }
      }
      // ---- lightning
      if (S.thunder > 0) {
        if (t > nextBolt) {
          nextBolt = t + 1800 + Math.random() * 3200 / S.thunder; flash = 1;
          const pts = [[W * (0.2 + Math.random() * 0.6), 0]];
          while (pts[pts.length - 1][1] < H * 0.65) { const [px, py] = pts[pts.length - 1]; pts.push([px + (Math.random() - 0.5) * 60 * s, py + (20 + Math.random() * 40) * s]); }
          bolt = { pts, life: 1 };
          opt.onThunder && opt.onThunder();
        }
        if (bolt && bolt.life > 0) {
          ctx.strokeStyle = gold ? `rgba(255,220,140,${bolt.life})` : `rgba(235,240,255,${bolt.life})`; ctx.lineWidth = 2.6 * s; ctx.shadowColor = '#cfe0ff'; ctx.shadowBlur = 18 * s;
          ctx.beginPath(); bolt.pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.stroke(); ctx.shadowBlur = 0;
          bolt.life -= dt * 7;
        }
      }
      // ---- fog banks
      if (S.fog > 0) {
        ctx.fillStyle = `rgba(214,220,226,${0.28 * S.fog})`; ctx.fillRect(0, 0, W, H);
        while (parts.fog.length < 4) parts.fog.push({ x: Math.random() * W, y: H * (0.2 + parts.fog.length * 0.2), w: W * (0.8 + Math.random() * 0.6), v: (0.15 + Math.random() * 0.25) * s });
        for (const f of parts.fog) {
          f.x += f.v * dt * 60; if (f.x - f.w / 2 > W) f.x = -f.w / 2;
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.w / 2); g.addColorStop(0, `rgba(230,234,238,${0.42 * S.fog})`); g.addColorStop(1, 'rgba(230,234,238,0)');
          ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1, 0.32); ctx.translate(-f.x, -f.y); ctx.fillStyle = g; ctx.fillRect(f.x - f.w / 2, f.y - f.w / 2, f.w, f.w); ctx.restore();
        }
      }
      // ---- rain: streaks, splashes, and drops running down the glass
      const rainA = Math.max(S.rain || 0, S.thunder ? 0.6 : 0, S.ice ? 0.35 : 0);
      if (rainA > 0) {
        const want = Math.round((40 + rainA * 320) * Q);
        for (let k = 0; k < 8 && parts.rain.length < want; k++) parts.rain.push({ x: Math.random() * (W + 200 * s) - 100 * s, y: -Math.random() * H * 0.3, v: (14 + Math.random() * 9) * s, l: (12 + Math.random() * 18) * s, z: Math.random() });
        ctx.strokeStyle = S.ice ? col('225,240,252', 0.65) : col('195,215,235', 0.5); ctx.lineWidth = 1.1 * s;
        ctx.beginPath();
        for (let i = parts.rain.length - 1; i >= 0; i--) {
          const p = parts.rain[i]; p.y += p.v * dt * 60; p.x += windX * 0.8 * dt * 60;
          if (p.y > H) { if (Math.random() < 0.3) parts.splash.push({ x: p.x, y: H - Math.random() * H * 0.12, r: 1, life: 1 }); p.y = -20; p.x = Math.random() * (W + 200 * s) - 100 * s; }
          ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - windX * 1.4, p.y - p.l);
        }
        ctx.stroke();
        ctx.strokeStyle = col('210,228,244', 0.5); ctx.lineWidth = 1 * s;
        for (let i = parts.splash.length - 1; i >= 0; i--) { const sp = parts.splash[i]; sp.r += dt * 26 * s; sp.life -= dt * 3; if (sp.life <= 0) { parts.splash.splice(i, 1); continue; } ctx.globalAlpha = sp.life; ctx.beginPath(); ctx.ellipse(sp.x, sp.y, sp.r * 1.8, sp.r * 0.5, 0, 0, 6.283); ctx.stroke(); }
        ctx.globalAlpha = 1;
        if (rainA > 0.3 && opt.lens !== false && Q === 1) {
          while (parts.drops.length < Math.round(rainA * 16)) parts.drops.push({ x: Math.random() * W, y: Math.random() * H, r: (3 + Math.random() * 8) * s, v: Math.random() < 0.4 ? (0.5 + Math.random() * 2) * s : 0, life: 2 + Math.random() * 4 });
          for (let i = parts.drops.length - 1; i >= 0; i--) {
            const d = parts.drops[i]; d.life -= dt; d.y += d.v * dt * 60; if (Math.random() < 0.004) d.v = (1 + Math.random() * 3) * s;
            if (d.life <= 0 || d.y > H + 20) { parts.drops.splice(i, 1); continue; }
            const g = ctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.4, 0, d.x, d.y, d.r);
            g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, 'rgba(210,228,244,0.12)'); g.addColorStop(1, 'rgba(160,190,215,0.3)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
            if (d.v) { ctx.strokeStyle = 'rgba(210,228,244,0.18)'; ctx.lineWidth = d.r * 0.6; ctx.beginPath(); ctx.moveTo(d.x, d.y - d.r); ctx.lineTo(d.x, d.y - d.r - 30 * s); ctx.stroke(); }
          }
        }
      }
      // ---- hail: ice pellets that bounce
      if (S.hail > 0) {
        const want = Math.round(S.hail * 110 * Q);
        for (let k = 0; k < 4 && parts.hail.length < want; k++) parts.hail.push({ x: Math.random() * W, y: -10, vy: (12 + Math.random() * 8) * s, vx: windX * 0.4, r: (1.8 + Math.random() * 2.6) * s, b: 0 });
        ctx.fillStyle = col('240,248,255', 0.95);
        for (let i = parts.hail.length - 1; i >= 0; i--) {
          const h = parts.hail[i]; h.vy += 0.6 * s; h.y += h.vy * dt * 60; h.x += h.vx * dt * 60;
          const floor = H - 6 * s;
          if (h.y > floor) { if (h.b >= 2) { parts.hail.splice(i, 1); continue; } h.y = floor; h.vy = -h.vy * 0.32; h.vx += (Math.random() - 0.5) * 3 * s; h.b++; if (h.b === 1 && Math.random() < 0.08) opt.onHail && opt.onHail(); }
          ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, 6.283); ctx.fill();
        }
      }
      // ---- snow
      const snowN = Math.round(Math.max(Math.round((S.snow || 0) * 260), over.snowN) * Q);
      if (snowN > 0) {
        for (let k = 0; k < 6 && parts.snow.length < snowN; k++) { const z = Math.random(); parts.snow.push({ x: Math.random() * W, y: parts.snow.length < snowN * 0.6 ? Math.random() * H : -8, r: (0.8 + z * z * 3.4) * s, v: (0.5 + z * 1.6) * s, ph: Math.random() * 6.28, a: 0.35 + z * 0.6 }); }
        if (parts.snow.length > snowN + 10) parts.snow.length = snowN;
        ctx.fillStyle = gold ? '#FFD98A' : '#EEF5FA';
        for (const f of parts.snow) {
          f.ph += 0.015 + swirl * 0.08; f.y += (f.v * (1 - swirl * 0.6) + Math.sin(f.ph * 2) * swirl * 3) * dt * 60; f.x += (windX * f.v / s * 0.6 + Math.sin(f.ph) * (0.4 + swirl * 4) * s) * dt * 60;
          if (f.y > H + 10) { f.y = -8; f.x = Math.random() * W; } if (f.x > W + 10) f.x = -10; else if (f.x < -10) f.x = W + 10;
          ctx.globalAlpha = f.a; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // ---- wind: gust lines, and leaves when it's dry
      if (S.wind > 0) {
        if (Math.random() < 0.02 + S.wind * 0.05 && parts.gust.length < 7) parts.gust.push({ x: -200 * s, y: Math.random() * H * 0.9, len: (120 + Math.random() * 220) * s, v: (8 + Math.random() * 8) * s, amp: (6 + Math.random() * 14) * s, ph: Math.random() * 6 });
        ctx.strokeStyle = col('220,234,244', 0.22); ctx.lineWidth = 1.3 * s;
        for (let i = parts.gust.length - 1; i >= 0; i--) {
          const g = parts.gust[i]; g.x += g.v * dt * 60; if (g.x - g.len > W) { parts.gust.splice(i, 1); continue; }
          ctx.beginPath(); for (let k = 0; k <= g.len; k += 8 * s) { const x = g.x - k, y = g.y + Math.sin(x / (60 * s) + g.ph) * g.amp; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
        }
        if (!S.rain && !S.snow && S.wind > 0.4) {
          while (parts.leaf.length < Math.round(S.wind * 14)) parts.leaf.push({ x: -20 * s - Math.random() * W, y: H * (0.3 + Math.random() * 0.65), r: Math.random() * 6.28, v: (5 + Math.random() * 6) * s, ph: Math.random() * 6, c: ['#A8642A', '#C98A2E', '#7A4A1E'][Math.floor(Math.random() * 3)] });
          for (const l of parts.leaf) {
            l.x += l.v * dt * 60; l.ph += 0.1; l.r += 0.15; l.y += Math.sin(l.ph) * 1.2 * s; if (l.x > W + 20) { l.x = -20; l.y = H * (0.3 + Math.random() * 0.65); }
            ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.r); ctx.fillStyle = gold ? '#FFD98A' : l.c; ctx.beginPath(); ctx.ellipse(0, 0, 5 * s, 2.4 * s, 0, 0, 6.283); ctx.fill(); ctx.restore();
          }
        }
      }
      // ---- heat shimmer along the bottom
      if (S.heat > 0) {
        ctx.fillStyle = `rgba(255,190,90,${0.1 * S.heat})`; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = `rgba(255,250,235,${0.12 * S.heat})`; ctx.lineWidth = 2 * s;
        for (let k = 0; k < 7; k++) { const y0 = H * (0.7 + k * 0.04); ctx.beginPath(); for (let x = 0; x <= W; x += 10 * s) { const y = y0 + Math.sin(x / (30 * s) + t / 260 + k) * 3 * s; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
      }
      // ---- ice: the glass glazes over and cracks
      if (S.ice > 0 && opt.glaze !== false) {
        if (!glaze || glaze.width !== W) glaze = makeGlaze(W, H, s);
        ctx.globalAlpha = Math.min(1, t / 1400) * S.ice; ctx.drawImage(glaze, 0, 0); ctx.globalAlpha = 1;
      }
      // ---- frigid: frost creeping in from the corners, and breath clouds
      if (S.frigid > 0) {
        if (opt.frostEdges !== false) { if (!frost || frost.width !== W) frost = makeFrost(W, H, s); ctx.globalAlpha = Math.min(1, t / 1600) * S.frigid; ctx.drawImage(frost, 0, 0); ctx.globalAlpha = 1; }
        if (t - lastPuff > 1500 / (0.5 + S.frigid)) { lastPuff = t; parts.puff.push({ x: W * (0.15 + Math.random() * 0.7), y: H * (0.62 + Math.random() * 0.3), age: 0 }); }
        for (let i = parts.puff.length - 1; i >= 0; i--) {
          const p = parts.puff[i]; p.age += dt; if (p.age > 2.4) { parts.puff.splice(i, 1); continue; }
          const r = (10 + p.age * 34) * s, a = 0.24 * Math.sin(Math.min(1, p.age / 2.4) * Math.PI), y = p.y - p.age * 26 * s;
          const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, r); g.addColorStop(0, `rgba(240,247,252,${a})`); g.addColorStop(1, 'rgba(240,247,252,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x + p.age * 8 * s, y, r, 0, 6.283); ctx.fill();
        }
      }
      // ---- the lightning flash lights up everything
      if (flash > 0) { ctx.fillStyle = `rgba(235,242,255,${flash * 0.55})`; ctx.fillRect(0, 0, W, H); flash -= dt * 4; }
    }
    return {
      step, spec: S,
      burst() { swirl = 1; for (let i = 0; i < 160; i++) parts.snow.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: 1.4 + Math.random() * 3, v: 0.4 + Math.random() * 1.4, ph: Math.random() * 6, a: 0.8 }); },
      override(n, windMph) { over.snowN = n || 0; over.wind = Math.min(2.6, (windMph || 0) / 14); }
    };
  }

  // =====================================================================================
  // ---------- Weather Game of the Week: the wildest weather that isn't snow ----------
  function weatherScore(g) {
    if (!g || g.roof !== 'open' || g.final || !g.wx) return 0;
    const s = weatherOf(g).spec;
    return (s.rain || 0) * 3 + (s.thunder || 0) * 3.2 + (s.hail || 0) * 3.4 + (s.ice || 0) * 3.4 + (s.fog || 0) * 2.8 + (s.wind || 0) * 2.6 + (s.frigid || 0) * 2.5 + (s.heat || 0) * 2;
  }
  let wotwSky = null, wotwRaf = null;
  function renderWOTW(games, featured) {
    const box = $('#wotw');
    const pick = games.filter(g => !featured.includes(g) && !g.live).map(g => [g, weatherScore(g)]).filter(([, v]) => v >= 1.4).sort((a, b) => b[1] - a[1])[0];
    state.wotw = pick ? pick[0] : null;
    cancelAnimationFrame(wotwRaf);
    if (!pick) { box.innerHTML = ''; return; }
    const g = pick[0], W = weatherOf(g), w = g.wx;
    const when = new Date(g.kickoff).toLocaleDateString([], { weekday: 'short' }) + ' ' + fmtTime(g.kickoff);
    const facts = [`${w.lowF}–${w.highF}°`, w.gustMph ? `gusts ${w.gustMph} mph` : '', w.precipChance >= 30 ? `${w.precipChance}% precip` : ''].filter(Boolean).join(' · ');
    box.innerHTML = `<h2 class="section-head">Weather Game of the Week</h2>
      <button class="wotw-card${g.level > 0 ? ' snowy' : ''}" data-open="${esc(g.id)}" aria-label="Open forecast for ${esc(g.away.name)} at ${esc(g.home.name)}">
        <canvas class="wotw-sky" aria-hidden="true"></canvas>
        <span class="wotw-body">
          <span class="wotw-top"><span class="wotw-kind">${esc(W.label)}</span><span class="fc-when">${favMark(g)}${esc(when)}</span></span>
          <span class="wc-teams">${matchupStack(g, 'md')}</span>
          <span class="wotw-facts">${esc(facts)}</span>
          <span class="meta-row">${badgeHtml(g)}${holidayTag(g.kickoff)}</span>
          <span class="wc-foot">${esc(g.venue.name)}</span>
        </span>
      </button>`;
    const cv = box.querySelector('.wotw-sky'), cx = cv.getContext('2d');
    let skyTheme = Theme.get();
    const newSky = () => makeSky(W.spec, { bg: true, lights: true, lens: false, frostEdges: Theme.get() !== 'ninety', gold: Theme.get() === 'scoreboard' });
    wotwSky = newSky();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const loop = now => {
      if (!cv.isConnected) return;
      if (Theme.get() !== skyTheme) { skyTheme = Theme.get(); wotwSky = newSky(); }
      const Wd = cv.clientWidth, Hd = cv.clientHeight;
      if (cv.width !== Wd * dpr) { cv.width = Wd * dpr; cv.height = Hd * dpr; }
      if (document.visibilityState === 'visible' && !GameView.isOpen() && Gov.ok('wotw', cv, now)) { cx.setTransform(1, 0, 0, 1, 0, 0); wotwSky.step(cx, cv.width, cv.height, now, dpr); }
      if (!REDUCED) wotwRaf = requestAnimationFrame(loop);
    };
    wotwRaf = requestAnimationFrame(loop);
  }

  // =====================================================================================
  // ---------- Snow Game Replay: the whole game, snow and score together, as a time-lapse ----------
  const Replay = (() => {
    let cur = null, data = null, raf = null, playing = false, pos = 0, last = 0, cv = null, ctx = null, sky = null;
    const GAME_MIN = 195;   // a game runs about 3 hours 15 minutes on the clock on the wall
    const has = g => g && g.roof !== 'dome' && g.wx && (g.final || g.live) && ((g.wx.snowIn || 0) > 0 || snowingLive(g) || (g.wx.timeline || []).some(h => h.inGame && h.s > 0));
    function section(g) {
      if (!has(g)) return '';
      return `<section class="gv-chart replay" id="replay">
        <h3>Snow Game Replay</h3>
        <p class="gv-sub">${g.live ? 'The game so far' : 'The whole game'}: the snow and the score, hour by hour</p>
        <div class="rp-stage"><canvas class="rp-canvas"></canvas><div class="rp-bug" id="rp-bug"></div><div class="rp-snow" id="rp-snow"></div></div>
        <div class="rp-controls"><button class="rp-play" id="rp-play" aria-label="Play">▶</button><input type="range" id="rp-scrub" min="0" max="1000" value="0" aria-label="Game time"></div>
        <ol class="rp-plays" id="rp-plays"><li class="rp-loading">Loading the scoring plays…</li></ol>
      </section>`;
    }
    // when each score happened, on the wall clock: from ESPN's timestamp if there is one, otherwise from the quarter and clock
    function playTime(p) {
      if (p.wall) return new Date(p.wall).getTime();
      const [m, s2] = String(p.clock || '0:00').split(':').map(Number);
      const q = p.q || 1, gameMin = (q - 1) * 15 + (15 - (m || 0) - (s2 || 0) / 60);
      return new Date(cur.kickoff).getTime() + (gameMin * 3 + (q > 2 ? 15 : 0)) * 60000;   // about 3 real minutes per game minute, plus halftime
    }
    const span = () => { const k = new Date(cur.kickoff).getTime(); const end = cur.live ? Date.now() : k + GAME_MIN * 60000; return [k, Math.max(k + 30 * 60000, end)]; };
    // snow fallen by time T, and how hard it was coming down, from the hourly record
    function snowAt(T) {
      const tl = (cur.wx.timeline || []).filter(h => h.inGame);
      const k = new Date(cur.kickoff).getTime();
      let total = 0, rate = 0;
      for (const h of tl) {
        const hs = new Date(h.t).getTime(), he = hs + 3600000;
        if (T >= he) total += h.s;
        else if (T > hs) { total += h.s * (T - hs) / 3600000; rate = h.s; }
      }
      if (T < k) rate = 0;
      if (cur.live && cur.liveWx && T >= Date.now() - 60000) { total = Math.max(total, cur.liveWx.snowSoFarIn); rate = Blizzard.rateOf(cur); }
      return { total, rate, f: (tl.find(h => T >= new Date(h.t).getTime() && T < new Date(h.t).getTime() + 3600000) || tl[tl.length - 1] || {}).f };
    }
    async function mount(g) {
      stop();
      const root = document.getElementById('replay');
      if (!root) return;
      cur = g; pos = 0; playing = false;
      cv = root.querySelector('.rp-canvas'); ctx = cv.getContext('2d');
      sky = makeSky({ snow: 0.4, wind: weatherOf(g).spec.wind }, { lens: false, glaze: false, frostEdges: false });
      root.querySelector('#rp-play').addEventListener('click', () => { playing = !playing; if (playing && pos >= 999) pos = 0; root.querySelector('#rp-play').textContent = playing ? '❚❚' : '▶'; Sound.crunch(); });
      root.querySelector('#rp-scrub').addEventListener('input', e => { pos = +e.target.value; playing = false; root.querySelector('#rp-play').textContent = '▶'; });
      root.querySelector('#rp-plays').addEventListener('click', e => { const li = e.target.closest('[data-at]'); if (!li) return; const [a, b] = span(); pos = Math.round((+li.dataset.at - a) / (b - a) * 1000); playing = false; root.querySelector('#rp-play').textContent = '▶'; });
      try { data = DEMO ? demoStats(g) : await (await fetch(API + '/game?id=' + encodeURIComponent(g.id))).json(); } catch (e) { data = null; }
      if (cur !== g) return;
      listPlays();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function listPlays() {
      const ol = document.getElementById('rp-plays'); if (!ol) return;
      const plays = (data?.scoringPlays || []).map(p => ({ ...p, at: playTime(p) })).sort((a, b) => a.at - b.at);
      data && (data._plays = plays);
      if (!plays.length) { ol.innerHTML = `<li class="rp-loading">${data ? 'No scores yet.' : "Couldn't load the scoring plays."}</li>`; return; }
      ol.innerHTML = plays.map(p => { const sn = snowAt(p.at); return `<li data-at="${p.at}"><span class="rp-q">Q${p.q || '?'} ${esc(p.clock || '')}</span><span class="rp-txt"><b>${esc(p.team || '')} ${esc(p.kind || 'Score')}</b> ${esc(p.text || '')}</span><span class="rp-tag">${sn.rate >= 0.05 ? `${flakeIcon}${sn.rate.toFixed(2)}″/hr` : sn.total > 0 ? 'snow paused' : 'before the snow'}<small>${sn.total.toFixed(1)}″ down · ${p.away ?? '–'}–${p.home ?? '–'}</small></span></li>`; }).join('');
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!cv || !cv.isConnected) return stop();
      if (!playing && !Gov.ok('replay', cv, now)) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (playing) { pos = Math.min(1000, pos + dt * 1000 / 14); if (pos >= 1000) { playing = false; const b = document.getElementById('rp-play'); if (b) b.textContent = '▶'; } const sc = document.getElementById('rp-scrub'); if (sc) sc.value = pos; }
      const [a, b] = span(), T = a + (b - a) * pos / 1000;
      const sn = snowAt(T);
      const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = Math.round(W * 0.5);
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // the field from above, covered by the snow that has fallen by now
      const ez = W * 0.075, fx = yd => ez + (W - 2 * ez) * yd / 100;
      for (let i = 0; i < 20; i++) { ctx.fillStyle = i % 2 ? '#2F6B35' : '#367A3C'; ctx.fillRect(fx(i * 5), 0, fx(5) - fx(0) + 1, H); }
      ctx.fillStyle = '#24502A'; ctx.fillRect(0, 0, ez, H); ctx.fillRect(W - ez, 0, ez, H);
      const lines = Math.max(0, 1 - sn.total / 0.9);
      ctx.strokeStyle = `rgba(244,247,242,${0.25 + 0.7 * lines})`; ctx.lineWidth = 1.5;
      for (let yd = 0; yd <= 100; yd += 10) { ctx.beginPath(); ctx.moveTo(fx(yd), 2); ctx.lineTo(fx(yd), H - 2); ctx.stroke(); }
      const cover = Math.min(0.96, Math.pow(Math.min(1, sn.total / 1.2), 0.7));
      ctx.fillStyle = `rgba(238,244,248,${cover})`; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(255,255,255,${cover * 0.5})`;
      for (let i = 0; i < 60; i++) { const x = (i * 97) % W, y = (i * 53) % H; ctx.beginPath(); ctx.arc(x, y, 6 + (i % 5) * 4, 0, 6.283); ctx.fill(); }
      // and it's snowing as hard as it was then
      sky.spec.snow = Math.min(1, sn.rate * 1.4);
      sky.step(ctx, W, H, now, 1);
      // score bug and snow readout
      const plays = data?._plays || [];
      const done = plays.filter(p => p.at <= T).pop();
      const q = T >= b - 60000 && !cur.live ? 'Final' : (() => { const rm = (T - a) / 60000; if (rm < 0) return 'Pregame'; if (rm >= 90 && rm < 105) return 'Halftime'; const gm = (rm >= 105 ? rm - 15 : rm) / 3; return `Q${Math.min(4, Math.floor(gm / 15) + 1)}`; })();
      const bug = document.getElementById('rp-bug');
      const txt = `${cur.away.abbr} ${done?.away ?? 0}  ·  ${cur.home.abbr} ${done?.home ?? 0}  ·  ${q}  ·  ${new Date(T).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      if (bug && bug.textContent !== txt) bug.textContent = txt;
      const snb = document.getElementById('rp-snow');
      const st = `${sn.total.toFixed(1)}″ on the field · ${sn.rate >= 0.05 ? `${sn.rate.toFixed(2)}″/hr` : 'not snowing'}${sn.f != null ? ` · ${sn.f}°` : ''}`;
      if (snb && snb.textContent !== st) snb.textContent = st;
      document.querySelectorAll('#rp-plays [data-at]').forEach(li => li.classList.toggle('done', +li.dataset.at <= T));
    }
    function stop() { cancelAnimationFrame(raf); raf = null; }
    return { section, mount, stop, has };
  })();

  // =====================================================================================
  // ---------- Snow Game Report: a radio-style rundown of the week, read aloud ----------
  const Report = (() => {
    const intros = {
      night: ['Good evening, and welcome to the Snow Game Report.', "Here's your weather rundown for the week in football."],
      field: ['From the sideline, this is the Snow Game Report.', "Let's check the field conditions around the league."],
      retro: ["You're tuned to the Snow Game Report, coming to you live from the weather desk.", 'Stay with us, folks.'],
      scoreboard: ['Ladies and gentlemen, the Snow Game Report is on the board.', 'Here are the conditions around the league.'],
      ninety: ["Welcome to the Snow Game Report! Let's get ready to rumble!", 'Here comes the weather!']
    };
    const outros = { night: "That's the report. Stay warm out there.", field: "That's the report from the field. See you at kickoff.", retro: "That's all for now. We'll see you next week, same time, same channel.", scoreboard: "That's the final from the board. Drive home safe.", ninety: 'Game over! Thanks for playing. Press start for more.' };
    const voiceStyle = { night: [1, 1], field: [1.03, 1], retro: [0.92, 0.85], scoreboard: [0.95, 0.9], ninety: [1.12, 1.15] };
    const when = g => new Date(g.kickoff).toLocaleDateString([], { weekday: 'long' }) + ' at ' + fmtTime(g.kickoff);
    function script() {
      const th = Theme.get(), d = state.data;
      const lines = [...(intros[th] || intros.night)];
      if (!d) return [...lines, 'The forecast is still loading. Check back in a moment.'];
      const games = d.games || [];
      const live = games.filter(g => g.live && snowingLive(g));
      for (const g of live) lines.push(`Live right now: it's snowing at ${g.venue.name}, where the ${g.away.name} and ${g.home.name} are playing. ${inches(g.liveWx.snowSoFarIn).replace('″', ' inches')} has fallen since kickoff, and the score is ${g.score?.away ?? 0} to ${g.score?.home ?? 0}.`);
      const snow = (state.featured || []);
      if (snow.length) {
        lines.push(snow.length === 1 ? 'We have one snow game on the radar this week.' : `We have ${snow.length} games with a chance of snow this week.`);
        snow.slice(0, 4).forEach((g, i) => {
          const amt = g.wx.snowIn > 0 ? `about ${g.wx.snowIn.toFixed(1)} inches during the game` : 'a chance of snow';
          lines.push(`${i === 0 ? 'Leading off' : 'Also'}, the ${g.away.name} at the ${g.home.name}, ${when(g)}. ${g.level === 2 ? 'That one is a Snow Game Warning' : 'That one is a Snow Game Watch'}, with ${amt} and a low of ${g.wx.lowF} degrees.`);
        });
      } else lines.push("No snow games on the radar this week, but let's look at the rest of the weather.");
      if (state.wotw) { const g = state.wotw, W = weatherOf(g); lines.push(`Our Weather Game of the Week: the ${g.away.name} at the ${g.home.name}, ${when(g)}. Look for ${W.label.toLowerCase()}, with temperatures from ${g.wx.lowF} to ${g.wx.highF} degrees${g.wx.gustMph >= 20 ? ` and gusts up to ${g.wx.gustMph} miles per hour` : ''}.`); }
      const cold = games.filter(g => g.wx && g.roof === 'open' && !g.final && !snow.includes(g) && g !== state.wotw && (g.wx.feelsLowF ?? 99) <= 20).slice(0, 2);
      for (const g of cold) lines.push(`Bundle up in ${g.venue.city || g.venue.name}: it will feel like ${g.wx.feelsLowF} degrees for the ${g.away.name} and ${g.home.name}.`);
      const best = d.outlook?.items?.find(it => !games.some(g => String(g.id) === String(it.id)));
      if (best) lines.push(`Looking ahead, our best bet for a snow game next week is the ${best.away.name} at the ${best.home.name}, at ${best.p} percent.`);
      lines.push(outros[th] || outros.night);
      return lines;
    }
    let speaking = false;
    function open() {
      const lines = script();
      const dlg = $('#report');
      $('#report-lines').innerHTML = lines.map((l, i) => `<p data-i="${i}">${esc(l)}</p>`).join('');
      dlg.showModal();
      if (!('speechSynthesis' in window)) { $('#report-status').textContent = "Your browser can't read aloud, so here's the report to read."; return; }
      speak(lines);
    }
    function speak(lines) {
      const synth = speechSynthesis; synth.cancel();
      const th = Theme.get(), [rate, pitch] = voiceStyle[th] || [1, 1];
      const voices = synth.getVoices().filter(v => /^en(-|_)/i.test(v.lang));
      const voice = voices.find(v => /en-US/i.test(v.lang) && /google|natural|premium|enhanced/i.test(v.name)) || voices.find(v => /en-US/i.test(v.lang)) || voices[0];
      speaking = true; $('#report-status').textContent = 'Now playing';
      Sound.on() && Sound.jingle(th);
      lines.forEach((l, i) => {
        const u = new SpeechSynthesisUtterance(l);
        if (voice) u.voice = voice; u.rate = rate; u.pitch = pitch;
        u.onstart = () => { document.querySelectorAll('#report-lines p').forEach(p => p.classList.toggle('on', +p.dataset.i === i)); document.querySelector(`#report-lines p[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
        if (i === lines.length - 1) u.onend = () => { speaking = false; $('#report-status').textContent = 'Finished. Tap play to hear it again.'; };
        synth.speak(u);
      });
    }
    function stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); speaking = false; }
    return { open, stop, replay: () => speak(script()) };
  })();


  if (DEMO) window.__sgr = { makeSky, weatherOf };   // sample-data mode only: lets the preview page draw each kind of weather
  // =====================================================================================
  // ---------- QB View: what the quarterback sees, in this stadium's weather ----------
  // A first-person look down the field from the pocket: visibility from the forecast (or live readings),
  // snow on the field, rain on the visor, the sun's real position against the way the field runs,
  // stadium lights at night, and the wind on the goalpost flag. Snap it and throw to a receiver.
  function sunPos(date, lat, lon) {
    const rad = Math.PI / 180, d = new Date(date);
    const start = Date.UTC(d.getUTCFullYear(), 0, 0), doy = (d - start) / 86400000;
    const g = 2 * Math.PI / 365 * (doy - 1 + (d.getUTCHours() - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = d.getUTCHours() * 60 + d.getUTCMinutes() + eqt + 4 * lon;
    const ha = (tst / 4 - 180) * rad, la = lat * rad;
    const cz = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
    const zen = Math.acos(Math.max(-1, Math.min(1, cz)));
    let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(la) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(la) * Math.sin(zen))))) / rad;
    az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
    return { el: 90 - zen / rad, az };
  }

  const QB = (() => {
    const EYE = 3.2, HASH = 3.08, SIDE = 26.67;   // yards: eye height, hash marks and sidelines from the middle
    let cur = null, cv = null, ctx = null, raf = null, sky = null, endIdx = 0, toGoal = 75, snapT = null, throwT = null, ball = null, result = null, userMoved = false, tick = 0;

    // ----- the conditions on the field -----
    function conds(g) {
      const inf = Kicker.info(g) || {};
      const W = weatherOf(g), s = W.spec;
      const indoor = g.roof === 'dome';
      const lw = g.live && g.liveWx;
      const hr = (g.wx?.timeline || []).find(h => h.inGame) || {};
      const wind = indoor ? 0 : Math.round((lw ? lw.w : hr.w ?? g.wx?.windMph ?? 0) * 0.75);
      const gust = indoor ? 0 : Math.round((lw ? lw.g : hr.g ?? g.wx?.gustMph ?? 0) * 0.75);
      const dir = indoor ? null : lw ? lw.d : hr.d ?? g.wx?.windDir ?? null;
      const F = indoor ? 72 : lw ? lw.f : hr.f ?? g.wx?.lowF ?? 55;
      // visibility: the reported number, but never better than what heavy snow, fog or rain allow
      let est = 3000;
      if (s.snow > 0.75) est = 110; else if (s.snow > 0.45) est = 260; else if (s.snow > 0) est = 700;
      if (s.fog > 0.5) est = Math.min(est, 140); else if (s.fog > 0) est = Math.min(est, 400);
      if (s.rain > 0.6 || s.thunder) est = Math.min(est, 500); else if (s.rain > 0.3) est = Math.min(est, 1200);
      const rep = indoor ? null : lw ? lw.vis : hr.v ?? g.wx?.visYd ?? null;
      const vis = indoor ? 5000 : Math.max(25, Math.min(rep ?? est, est));
      // the sun at kickoff (or right now during the game)
      const when = g.live ? new Date() : new Date(new Date(g.kickoff).getTime() + 30 * 60000);
      const sun = g.venue?.lat != null ? sunPos(when, g.venue.lat, g.venue.lon) : { el: -10, az: 0 };
      const snowIn = lw ? lw.snowSoFarIn : (g.wx?.snowIn || 0) * (g.final ? 1 : 0.5) + (g.wx?.snowDepthIn || 0) * 0.3;
      return { W, s, indoor, wind, gust, dir, F, vis, sun, cloud: s.cloud || 0, snowIn: indoor ? 0 : snowIn, wet: indoor ? 0 : Math.max(s.rain || 0, s.snow || 0, s.ice || 0), axis: inf.axis, axisKnown: inf.axis != null };
    }
    const ends = c => tvEnds(cur, c.axisKnown ? c.axis : null);
    const rel = (deg, h) => ((deg - h + 540) % 360) - 180;   // -180..180, 0 = straight ahead
    function windParts(c, h) { if (!c.wind || c.dir == null) return { tail: 0, cross: 0 }; const r = (c.dir + 180 - h) * Math.PI / 180; return { tail: c.wind * Math.cos(r), cross: c.wind * Math.sin(r) }; }
    function glare(c, h) {
      if (c.indoor || c.sun.el <= 0) return 0;
      const a = Math.abs(rel(c.sun.az, h));
      if (a > 70) return 0;
      const low = c.sun.el < 30 ? 1 - c.sun.el / 30 : 0;
      return Math.max(0, (1 - a / 70) * (0.35 + low * 0.65) * (1 - c.cloud * 0.85));
    }

    // ----- section -----
    function section(g) {
      return `<section class="gv-chart qbv" id="qbv">
        <h3>QB view</h3>
        <p class="gv-sub" id="qb-sub">What the quarterback sees at ${esc(g.venue.name)}</p>
        <div class="seg qb-cam" role="group" aria-label="Camera" id="qb-cam"><button data-qcam="tv">Broadcast cam</button><button data-qcam="eye">Helmet cam</button></div>
        <div class="seg qb-end" role="group" aria-label="Which end zone the offense is facing" id="qb-end"></div>
        <div class="seg qb-play" role="group" aria-label="Play call" id="qb-play">${PLAYS.map((pl, i) => `<button data-play="${i}">${esc(pl.name)}</button>`).join('')}</div>
        <div class="qb-stage"><canvas class="qb-gl" aria-hidden="true"></canvas><canvas class="qb-canvas" aria-label="The view down the field"></canvas><div class="qb-result" id="qb-result" aria-live="polite"></div></div>
        <div class="qb-controls">
          <label class="qb-los"><span id="qb-los-txt"></span><input type="range" min="5" max="95" value="75" id="qb-los" aria-label="Line of scrimmage"></label>
          <button class="ks-kick qb-snap" id="qb-snap">Snap</button>
        </div>
        <div class="seg qb-throw" role="group" aria-label="Throw to" id="qb-throw" hidden></div>
        <div class="qb-read" id="qb-read"></div>
        <p class="ks-hint">Pick a play, snap the ball, then tap a receiver (or his number) to throw. Keep the drive going: the wind, the visibility, the sun, and the footing all play a part.</p>
      </section>`;
    }
    async function mount(g) {
      stop();
      const root = document.getElementById('qbv'); if (!root) return;
      cur = g; endIdx = 0; snapT = throwT = null; ball = result = null; userMoved = false;
      cv = root.querySelector('.qb-canvas'); ctx = cv.getContext('2d');
      const s = g.live ? g.situation : null;
      toGoal = s?.toGoal ?? 75;
      if (s?.down) drive = { down: Math.min(4, s.down), togo: s.distance || 10 };
      root.querySelector('#qb-end').addEventListener('click', e => { const b = e.target.closest('[data-end]'); if (!b) return; endIdx = +b.dataset.end; reset(); layout(); Sound.crunch(); });
      root.querySelector('#qb-los').addEventListener('input', e => { toGoal = 100 - +e.target.value; userMoved = true; drive = { down: 1, togo: 10 }; reset(); layout(); });
      root.querySelector('#qb-cam').addEventListener('click', e => { const b = e.target.closest('[data-qcam]'); if (!b) return; camMode = b.dataset.qcam; store.set('qbcam', camMode); camUI(); Sound.crunch(); });
      root.querySelector('#qb-play').addEventListener('click', e => { const b = e.target.closest('[data-play]'); if (!b || (snapT != null && throwT == null) || ball) return; play = +b.dataset.play; ROUTES = PLAYS[play].routes; store.set('qbplay', play); reset(); camUI(); Sound.crunch(); });
      drive = { down: 1, togo: 10 }; bannerQ = null; camFollow = 0; tvSky = null; camUI();
      load3d(g);
      root.querySelector('#qb-snap').addEventListener('click', snap);
      root.querySelector('#qb-throw').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) throwTo(+b.dataset.r); });
      cv.addEventListener('pointerdown', e => {
        if (snapT == null || throwT != null) { if (snapT == null) snap(); return; }
        const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        let best = -1, bd = 60;
        lastRecv.forEach((p, i) => { const d = Math.hypot(p.sx - x, p.sy - y); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) throwTo(best);
      });
      await Kicker.load(g);
      if (cur !== g) return;
      layout();
      raf = requestAnimationFrame(frame);
    }
    function refresh(g) { if (!cur || g?.id !== cur.id) return; cur = g; if (g.live && g.situation?.toGoal != null && !userMoved && snapT == null) toGoal = g.situation.toGoal; layout(); }
    function stop() { cancelAnimationFrame(raf); raf = null; }
    function reset() { snapT = throwT = null; ball = result = null; const t = document.getElementById('qb-throw'); if (t) t.hidden = true; const r = document.getElementById('qb-result'); if (r) r.className = 'qb-result'; }

    function layout() {
      const g = cur, c = conds(g), E = ends(c), h = E[endIdx];
      sky = makeSky({ ...c.s, sun: 0, heat: c.s.heat * 0.5, cloud: 0, fog: 0, frigid: 0 }, { lens: true, glaze: true, frostEdges: false, gold: Theme.get() === 'scoreboard', onThunder: () => Sound.thunder() });
      const eb = document.getElementById('qb-end');
      if (eb) { eb.hidden = c.indoor; eb.innerHTML = E.map((hh, i) => { const gl = glare(c, hh), wp = windParts(c, hh); const note = [gl > 0.35 ? 'sun in his eyes' : '', c.wind >= 6 ? (Math.abs(wp.tail) >= Math.abs(wp.cross) * 0.6 ? (wp.tail > 0 ? 'wind at his back' : 'into the wind') : 'crosswind') : ''].filter(Boolean).join(', ') || 'no trouble'; return `<button data-end="${i}" aria-pressed="${i === endIdx}">Facing the ${tvName(i)}<small>${esc(note)}</small></button>`; }).join('') + flipBtn(); }
      const los = document.getElementById('qb-los'); if (los) los.value = 100 - toGoal;
      const lt = document.getElementById('qb-los-txt'); if (lt) lt.innerHTML = `Ball on the <b>${toGoal > 50 ? `own ${100 - toGoal}` : toGoal === 50 ? '50' : `opponent's ${toGoal}`}</b>`;
      // the readout
      const gl = glare(c, h), wp = windParts(c, h);
      const visTxt = c.indoor ? 'Perfect' : c.vis >= 2000 ? 'Clear, a mile or more' : c.vis >= 400 ? `About ${Math.round(c.vis / 50) * 50} yards` : `Only about ${Math.round(c.vis / 10) * 10} yards`;
      const windTxt = c.indoor ? 'None, indoors' : !c.wind ? 'Calm' : `${c.wind} mph${c.gust > c.wind + 3 ? ` (gusts ${c.gust})` : ''}, ${Math.abs(wp.tail) >= Math.abs(wp.cross) * 0.6 ? (wp.tail > 0 ? 'mostly at his back' : 'mostly in his face') : `across, from the ${wp.cross > 0 ? 'left' : 'right'}`}`;
      const sunTxt = c.indoor ? 'Dome lights' : c.sun.el <= 0 ? 'Night, under the lights' : gl > 0.55 ? `Low sun right in his eyes (${Math.round(c.sun.el)}° up)` : gl > 0.2 ? 'Some glare looking downfield' : rel(c.sun.az, h) > 110 || rel(c.sun.az, h) < -110 ? 'Sun behind him' : c.cloud > 0.6 ? 'Overcast' : 'Sun off to the side';
      const footTxt = c.indoor ? 'Fast and dry' : c.s.ice ? 'Icy, treacherous' : c.snowIn >= 1 ? `${c.snowIn.toFixed(1)}″ of snow, slow and slick` : c.snowIn > 0 ? 'A coating of snow' : c.s.rain > 0.3 ? 'Wet and sloppy' : 'Good';
      const hard = (c.vis < 150 ? 3 : c.vis < 400 ? 2 : c.vis < 1000 ? 1 : 0) + Math.min(3, c.wind / 8) + gl * 2.5 + c.wet * 2 + (c.F < 20 ? 1 : 0);
      const rating = hard >= 6 ? ['Brutal', 'brutal'] : hard >= 3.5 ? ['Tough', 'tough'] : hard >= 1.5 ? ['Tricky', 'tricky'] : ['Easy', 'easy'];
      const rd = document.getElementById('qb-read');
      if (rd) rd.innerHTML = `<div class="qb-rate qb-${rating[1]}"><span>Throwing conditions</span><b>${rating[0]}</b></div>
        <dl><div><dt>Visibility</dt><dd>${esc(visTxt)}</dd></div><div><dt>Wind</dt><dd>${esc(windTxt)}</dd></div><div><dt>Sun</dt><dd>${esc(sunTxt)}</dd></div><div><dt>Footing</dt><dd>${esc(footTxt)}</dd></div></dl>`;
      const sub = document.getElementById('qb-sub');
      if (sub) sub.textContent = `What the quarterback sees at ${g.venue.name}${g.live ? ' right now' : g.final ? ' during the game' : ' at kickoff'}${c.W.label && !c.indoor ? `: ${c.W.label.toLowerCase()}` : ''}.`;
    }


    // ----- broadcast cam: up behind the offense, console style -----
    let camMode = store.get('qbcam', 'tv'), drive = { down: 1, togo: 10 }, bannerQ = null, camFollow = 0, tvSky = null;
    const ORD = ['1ST', '2ND', '3RD', '4TH'];
    const side = t => { const s = cur.live ? cur.situation : null; const off = s?.poss === cur.away.abbr ? cur.away : cur.home; return t === 'off' ? off : off === cur.home ? cur.away : cur.home; };
    function resolve(now, ts, c) {
      if (ball && result && now >= result.at && !result.shown) {
        result.shown = true;
        const el = document.getElementById('qb-result'), rr = result; if (el) { el.textContent = result.text; el.className = 'qb-result'; setTimeout(() => { if (snapT == null || result === rr) el.className = 'qb-result show ' + (rr.caught ? 'good' : 'miss'); }, 2300); }
        if (result.caught && navigator.vibrate) navigator.vibrate(20);
        const td = result.caught && result.gain >= toGoal;
        bannerQ = { at: now, txt: td ? ['TOUCHDOWN!', `${result.gain}-YARD SCORE`, '#3DDC84'] : result.caught ? ['COMPLETE', `+${result.gain} YARDS`, '#3DDC84'] : result.kind === 'int' ? ['INTERCEPTED!', 'TURNOVER', '#FF5A5F'] : result.kind === 'drop' ? ['DROPPED', 'TOO SLICK', '#FFC83D'] : ['INCOMPLETE', result.kind === 'lost' ? 'LOST IT IN THE WEATHER' : result.kind === 'wind' ? 'THE WIND TOOK IT' : '', '#FFC83D'] };
        if (td && Sound.jingle) Sound.jingle(Theme.get());
        const r = result;
        setTimeout(() => { if (result === r) { snapT = null; throwT = null; ball = null; result = null; advance(r); } }, td ? 2600 : 1900);
      } else if (!ball && snapT != null && ts > 4.2) {
        const loss = c.snowIn >= 1 ? 8 : 6;
        const el = document.getElementById('qb-result'); if (el) { el.textContent = c.snowIn >= 1 ? 'Sacked! He slipped in the snow holding it too long.' : 'Sacked! Held it too long.'; el.className = 'qb-result'; setTimeout(() => { if (snapT == null) el.className = 'qb-result show miss'; }, 2300); }
        bannerQ = { at: now, txt: ['SACKED', `-${loss} YARDS`, '#FF5A5F'] };
        snapT = null; const tb = document.getElementById('qb-throw'); if (tb) tb.hidden = true;
        advance({ kind: 'sack', gain: -loss });
      }
    }
    // keep the drive going: downs, distance, and back to the 25 after a score or a turnover
    function advance(r) {
      const gain = r.gain || 0;
      if (r.kind === 'int' || (r.caught && gain >= toGoal)) { toGoal = 75; drive = { down: 1, togo: 10 }; }
      else {
        toGoal = Math.max(1, Math.min(99, toGoal - gain));
        if (gain >= drive.togo) drive = { down: 1, togo: Math.min(10, toGoal) };
        else {
          drive = { down: drive.down + 1, togo: drive.togo - gain };
          if (drive.down > 4) { bannerQ = { at: performance.now(), txt: ['TURNOVER', 'ON DOWNS', '#FF5A5F'] }; toGoal = 75; drive = { down: 1, togo: 10 }; }
        }
      }
      userMoved = true; layout();
    }

    // ----- the 3D broadcast cam -----
    let q3 = null, q3Key = '';
    async function load3d(g) {
      if (REDUCED) return;
      try { const c = document.createElement('canvas'); if (!(c.getContext('webgl2') || c.getContext('webgl'))) return; } catch (e) { return; }
      const gl = document.querySelector('#qbv .qb-gl'); if (!gl) return;
      try {
        const mod = await (window.__sim3d ||= import('./sim3d.js'));
        if (cur !== g || !gl.isConnected) return;
        q3?.dispose();
        q3 = mod.makeWorld(gl, { lite: Gov.lite(), font: Arena.cssVar('--display', 'sans-serif') });
        q3Key = '';
      } catch (e) { q3 = null; }
    }
    const faceOf = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
    function drawBroadcast3D(now) {
      const c = conds(cur), E = ends(c), h = E[endIdx];
      const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = Math.round(W * 0.66);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const los = 100 - toGoal, ts = snapT != null ? (now - snapT) / 1000 : 0, sp = speedOf(c), live = snapT != null;
      let bk = null;
      if (ball) { const k = Math.min(1, (now - throwT) / 1000 / ball.T); bk = { x: ball.from[0] + (ball.to[0] - ball.from[0]) * k, y: ball.from[1] + (ball.to[1] - ball.from[1]) * k, z: 1.8 + Math.sin(k * Math.PI) * ball.peak }; }
      const want = bk ? Math.max(0, bk.y - 9) * 0.6 : result?.shown && result.caught ? camFollow : 0;
      camFollow += (want - camFollow) * 0.06;
      const off = side('off'), dfn = side('def');
      const key = cur.id + ':' + endIdx + ':' + Theme.get();
      if (q3Key !== key) {
        q3.configure({ home: { color: cur.home.color, name: cur.home.name, abbr: cur.home.abbr }, away: { color: cur.away.color, name: cur.away.name, abbr: cur.away.abbr }, score: cur.score,
          night: !c.indoor && c.sun.el <= 0, dome: c.indoor, sun: { el: c.sun.el, rel: rel(c.sun.az, h) }, cloud: c.cloud,
          snow: c.indoor ? 0 : c.s.snow || 0, rain: c.indoor ? 0 : Math.max(c.s.rain || 0, c.s.thunder ? 0.7 : 0), fog: c.s.fog || 0, vis: c.vis,
          snowCover: c.indoor ? 0 : Math.min(0.85, Math.pow(Math.min(1, c.snowIn / 1.3), 0.7)), wet: c.wet, logo: maskUrl(cur.home.logo) });
        q3Key = key;
      }
      const P = [], run = now / 75, cold = !c.indoor && c.F < 34, snow = !c.indoor && c.s.snow > 0.3;
      const add = o => P.push({ breath: cold, snow, ...o });
      [-2.2, -1.1, 0, 1.1, 2.2].forEach((x, i) => add({ id: 'ol' + i, x, y: los - 0.8 - Math.min(1.3, ts * 0.45), color: off.color, num: String([77, 65, 60, 66, 71][i]), pose: live ? 'block' : 'stance3', phase: now / 210 + i, face: 0 }));
      const qbY = los - 5 - Math.min(2, ts * 1.6), throwing = throwT != null ? Math.min(1, (now - throwT) / 380 + 0.5) : null;
      add({ id: 'qb', x: 0, y: qbY, color: off.color, num: '12', pose: throwing != null ? 'throw' : live && ts < 1.25 ? 'back' : 'set', phase: throwing != null ? throwing : now / 85, face: 0 });
      add({ id: 'rb', x: 1.6 + Math.min(9, ts * 3), y: los - 6.5 + Math.min(3, ts * 1.1), color: off.color, num: '28', pose: live && ts < 3 ? 'run' : 'crouch', phase: run, face: live ? 70 : 0 });
      [-3.2, -1.1, 1.1, 3.2].forEach((x, i) => add({ id: 'dl' + i, x: x + (ts ? Math.sin(now / 150 + i) * 0.15 : 0), y: los + 0.8 - Math.min(2.2, ts * 0.6), color: dfn.color, num: String([91, 97, 93, 99][i]), pose: live ? 'rush' : 'stance3', phase: now / 140 + i, face: 180 }));
      [-4.5, 4.5].forEach((x, i) => add({ id: 'lb' + i, x, y: los + 5 + Math.min(4, ts * 1.3), color: dfn.color, num: String([54, 52][i]), pose: live && ts < 3 ? 'back' : 'crouch', phase: run, face: 180 }));
      [-9, 9].forEach((x, i) => add({ id: 's' + i, x: x * (1 - Math.min(0.3, ts * 0.08)), y: los + 13 + Math.min(7, ts * 1.6), color: dfn.color, num: String([21, 32][i]), pose: live && ts < 4 ? 'back' : 'crouch', phase: run, face: 180 }));
      const heads = [];
      ROUTES.forEach((r, i) => {
        const a = routePos(r, ts, sp), b = routePos(r, ts + 0.15, sp), [dx, dy] = routePos(r, Math.max(0, ts - 0.35), sp * 0.97);
        const moving = live && Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01;
        add({ id: 'cb' + i, x: dx + (r.start[0] < 0 ? 1.2 : -1.2), y: los + dy + 2.2, color: dfn.color, num: String([24, 26, 31][i]), pose: moving ? (ts < 0.7 ? 'back' : 'run') : 'crouch', phase: run + 1, face: ts < 0.7 ? 180 : faceOf(a, b) });
        add({ id: 'wr' + i, x: a[0], y: los + a[1], color: off.color, num: String([11, 84, 17][i]), pose: moving ? 'run' : 'crouch', phase: run + i, face: moving ? faceOf(a, b) : 0 });
        heads[i] = [a[0], los + a[1]];
      });
      let B;
      if (bk) B = { x: bk.x, y: los + bk.y, z: bk.z, spin: true };
      else if (result?.shown && result.caught && result.i != null) { const [x, y] = routePos(ROUTES[result.i], ts, sp); B = { x: x + 0.25, y: los + y, z: 1.2 }; }
      else if (live) B = { x: 0.3, y: qbY + 0.1, z: 1.75 };
      else B = { x: 0, y: los, z: 0.12, yaw: Math.PI / 2 };
      const wp = windParts(c, h);
      q3.frame({ t: now, cam: { pos: [0, los - 10 + camFollow, 5.4 + camFollow * 0.05], look: [0, los + 14 + camFollow, 0], fov: 50 }, players: P, ball: B,
        lines: { los, first: los + Math.min(drive.togo, toGoal) },
        routes: live ? [] : ROUTES.map((r, i) => ({ pts: [r.start, ...r.pts].map(([x, y]) => [x, los + y]), color: Arena.ICON_COLORS[i] })),
        wind: { cross: wp.cross, tail: wp.tail } });
      // receiver buttons over their heads
      lastRecv = [];
      heads.forEach(([x, y], i) => { const p = q3.project(x, y, 2.4); if (p) lastRecv[i] = { sx: p[0], sy: p[1] + 14, h: 0 }; });
      if (live && throwT == null) lastRecv.forEach((p, i) => p && Arena.icon(ctx, p.sx, p.sy - 14, i + 1, Arena.ICON_COLORS[i], (Math.sin(now / 180) + 1) / 2));
      resolve(now, ts, c);
      Arena.scorebug(ctx, W, cur, `${ORD[drive.down - 1] || '4TH'} & ${drive.togo >= toGoal ? 'GOAL' : drive.togo}`);
      Arena.windBadge(ctx, 26, H - 44, 15, c.wind, c.dir == null ? null : c.dir + 180 - h, c.indoor ? 'INDOORS' : null);
      if (!live && !(bannerQ && now - bannerQ.at < 2400)) {
        const msg = `${PLAYS[play].name.toUpperCase()} · TAP TO SNAP`;
        ctx.font = Arena.hudFont(12); const tw = ctx.measureText(msg).width + 26;
        Arena.plate(ctx, W / 2 - tw / 2, H - 30, tw, 22, 'rgba(10,14,22,0.82)', 'rgba(255,255,255,0.35)');
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(msg, W / 2, H - 18.5);
      }
    }

    function drawBroadcast(now) {
      const c = conds(cur), E = ends(c), h = E[endIdx];
      const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = Math.round(W * 0.66);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const los = 100 - toGoal, ts = snapT != null ? (now - snapT) / 1000 : 0, sp = speedOf(c);
      let bk = null;
      if (ball) { const k = Math.min(1, (now - throwT) / 1000 / ball.T); bk = { x: ball.from[0] + (ball.to[0] - ball.from[0]) * k, y: ball.from[1] + (ball.to[1] - ball.from[1]) * k, z: 1.8 + Math.sin(k * Math.PI) * ball.peak }; }
      // the camera drifts downfield to follow a deep ball
      const want = bk ? Math.max(0, bk.y - 9) * 0.6 : result?.shown && result.caught ? camFollow : 0;
      camFollow += (want - camFollow) * 0.06;
      const cam = Arena.camera(W, H, 0, los - 11.5 + camFollow, 7.4 + camFollow * 0.04, 21, 54);
      const night = c.indoor || c.sun.el <= 0, off = side('off'), dfn = side('def');
      Arena.stadium(ctx, cam, { night, gray: !c.indoor && (c.cloud > 0.6 || c.s.rain || c.s.snow), home: cur.home.color, away: cur.away.color, t: now });
      Arena.field(ctx, cam, { night, home: cur.home.color, homeName: cur.home.name, logo: Arena.logoImg(cur.home.logo), snowIn: c.snowIn, wet: c.wet, lineA: Math.max(0.18, 1 - c.snowIn / 1.1), los, first: los + Math.min(drive.togo, toGoal) });
      const wp = windParts(c, h);
      Arena.goalpost(ctx, cam, 110, { home: cur.home.color, wind: c.wind, cross: wp.cross, tail: wp.tail, t: now });
      // play art before the snap
      if (snapT == null) ROUTES.forEach((r, i) => {
        const pts = [r.start, ...r.pts].map(([x, y]) => [x, los + y, 0.03]), col = Arena.ICON_COLORS[i];
        ctx.lineCap = 'round';
        for (let j = 1; j < pts.length; j++) Arena.seg(ctx, cam, pts[j - 1], pts[j], 0.3, col);
        const a = cam.P(...pts[pts.length - 2]), b = cam.P(...pts[pts.length - 1]);
        if (a && b) { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = 7; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(b[0] + Math.cos(ang) * s, b[1] + Math.sin(ang) * s); ctx.lineTo(b[0] + Math.cos(ang + 2.4) * s, b[1] + Math.sin(ang + 2.4) * s); ctx.lineTo(b[0] + Math.cos(ang - 2.4) * s, b[1] + Math.sin(ang - 2.4) * s); ctx.closePath(); ctx.fill(); }
      });
      // everyone on the field
      const list = [], crouch = snapT == null, run = ts ? now / 75 : 0;
      [-2.2, -1.1, 0, 1.1, 2.2].forEach((x, i) => list.push([x, los - 0.8 - Math.min(1.3, ts * 0.45), { color: off.color, crouch, num: String([77, 65, 60, 66, 71][i]) }]));
      list.push([0, los - 5 - Math.min(2, ts * 1.6), { color: off.color, num: '12', phase: ts && ts < 1.3 ? now / 80 : 0 }]);
      list.push([1.6 + Math.min(9, ts * 3), los - 6.5 + Math.min(3, ts * 1.1), { color: off.color, num: '28', phase: run }]);
      [-3.2, -1.1, 1.1, 3.2].forEach((x, i) => list.push([x + (ts ? Math.sin(now / 150 + i) * 0.15 : 0), los + 0.8 - Math.min(2.2, ts * 0.6), { color: dfn.color, toward: true, crouch, num: String([91, 97, 93, 99][i]), phase: ts ? now / 90 : 0 }]));
      [-4.5, 4.5].forEach((x, i) => list.push([x, los + 5 + Math.min(4, ts * 1.3), { color: dfn.color, toward: true, num: String([54, 52][i]), phase: run }]));
      [-9, 9].forEach((x, i) => list.push([x * (1 - Math.min(0.3, ts * 0.08)), los + 13 + Math.min(7, ts * 1.6), { color: dfn.color, toward: true, num: String([21, 32][i]), phase: run }]));
      ROUTES.forEach((r, i) => {
        const [x, y] = routePos(r, ts, sp), [dx, dy] = routePos(r, Math.max(0, ts - 0.35), sp * 0.97);
        list.push([dx + (r.start[0] < 0 ? 1.2 : -1.2), los + dy + 2.2, { color: dfn.color, toward: true, num: String([24, 26, 31][i]), phase: run }]);
        list.push([x, los + y, { color: off.color, num: String([11, 84, 17][i]), phase: run, recv: i }]);
      });
      list.sort((a, b) => b[1] - a[1]);
      lastRecv = [];
      const common = { t: now, snow: !c.indoor && c.s.snow > 0.3, breath: !c.indoor && c.F < 32, pants: '#E9E6DC' };
      for (const [x, y, o] of list) { const p = Arena.player(ctx, cam, x, y, { ...common, ...o }); if (o.recv != null && p) lastRecv[o.recv] = { sx: p[0], sy: p[1], h: p[2] }; }
      if (bk) Arena.football(ctx, cam, bk.x, los + bk.y, bk.z, now);
      else if (result?.shown && result.caught && result.i != null) { const [x, y] = routePos(ROUTES[result.i], ts, sp); Arena.football(ctx, cam, x + 0.3, los + y, 1.2, 0); }
      if (snapT != null && throwT == null) lastRecv.forEach((p, i) => p && Arena.icon(ctx, p.sx, p.sy - p.h * 0.75 - 10, i + 1, Arena.ICON_COLORS[i], (Math.sin(now / 180) + 1) / 2));
      resolve(now, ts, c);
      // the weather between the camera and the far end
      if (c.vis < 2500) Arena.visibility(ctx, cam, c.vis, c.s.snow ? '232,238,243' : c.s.fog ? '205,211,217' : night ? '70,80,92' : '150,160,172');
      const gl = glare(c, h);
      if (!c.indoor && c.sun.el > 0) {
        const a = rel(c.sun.az, h);
        if (Math.abs(a) < 70) {
          const sx = W / 2 + cam.f * Math.tan(a * Math.PI / 180) * 0.7, sy = cam.horizon - cam.f * Math.tan(Math.min(50, c.sun.el) * Math.PI / 180) * 0.7;
          const R = W * (0.15 + gl * 0.5), al = Math.max(0.2, gl) * (1 - c.cloud * 0.7);
          const g3 = ctx.createRadialGradient(sx, sy, 0, sx, sy, R); g3.addColorStop(0, `rgba(255,252,236,${Math.min(1, 0.9 * al + 0.1)})`); g3.addColorStop(0.25, `rgba(255,240,190,${0.45 * al})`); g3.addColorStop(1, 'rgba(255,240,190,0)');
          ctx.fillStyle = g3; ctx.fillRect(0, 0, W, H);
        }
      }
      if (!tvSky || tvSky.key !== c.W.key + Theme.get()) { tvSky = makeSky({ ...c.s, sun: 0, cloud: 0, fog: 0, frigid: 0, heat: 0 }, { gold: Theme.get() === 'scoreboard', onThunder: () => Sound.thunder() }); tvSky.key = c.W.key + Theme.get(); }
      if (!c.indoor) tvSky.step(ctx, W, H, now, 1);
      // on-screen graphics
      Arena.scorebug(ctx, W, cur, `${ORD[drive.down - 1] || '4TH'} & ${drive.togo >= toGoal ? 'GOAL' : drive.togo}`);
      Arena.windBadge(ctx, 26, H - 44, 15, c.wind, c.dir == null ? null : c.dir + 180 - h, c.indoor ? 'INDOORS' : null);
      if (snapT == null && !(bannerQ && now - bannerQ.at < 2400)) {
        const msg = `${PLAYS[play].name.toUpperCase()} · TAP TO SNAP`;
        ctx.font = Arena.hudFont(12); const tw = ctx.measureText(msg).width + 26;
        Arena.plate(ctx, W / 2 - tw / 2, H - 30, tw, 22, 'rgba(10,14,22,0.82)', 'rgba(255,255,255,0.35)');
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(msg, W / 2, H - 18.5);
      }
    }
    const PLAYS = [
      { name: 'Slant Out Post', routes: [
        { name: 'Slant', start: [-12, 0], pts: [[-12, 4], [-2, 12], [8, 18]] },
        { name: 'Out', start: [11, 0], pts: [[11, 11], [24, 11], [26, 11]] },
        { name: 'Post', start: [5, 0], pts: [[5, 11], [-4, 30], [-10, 45]] }] },
      { name: 'Curl Flat Seam', routes: [
        { name: 'Curl', start: [-13, 0], pts: [[-13, 12], [-12, 10.5]] },
        { name: 'Flat', start: [5, -1], pts: [[8, 2], [18, 3], [25, 3]] },
        { name: 'Seam', start: [9, 0], pts: [[9, 20], [8, 55]] }] },
      { name: 'Four Verticals', routes: [
        { name: 'Go', start: [-15, 0], pts: [[-15, 65]] },
        { name: 'Dig', start: [6, 0], pts: [[6, 14], [-10, 15], [-18, 15]] },
        { name: 'Fade', start: [14, 0], pts: [[17, 18], [20, 60]] }] }
    ];
    let play = store.get('qbplay', 0) % PLAYS.length;
    let ROUTES = PLAYS[play].routes;
    function camUI() {
      const root = document.getElementById('qbv'); if (!root) return;
      root.classList.toggle('tv', camMode === 'tv');
      for (const b of root.querySelectorAll('[data-qcam]')) b.setAttribute('aria-pressed', b.dataset.qcam === camMode);
      for (const b of root.querySelectorAll('[data-play]')) b.setAttribute('aria-pressed', +b.dataset.play === play);
      const tb = document.getElementById('qb-throw');
      if (tb) tb.innerHTML = ROUTES.map((r, i) => `<button data-r="${i}"><i style="background:${Arena.ICON_COLORS[i]}">${i + 1}</i>${esc(r.name)}</button>`).join('');
    }

    function routePos(r, t, speed) {
      let d = Math.max(0, t) * speed, [x, y] = r.start;
      for (const [px, py] of r.pts) { const L = Math.hypot(px - x, py - y); if (d <= L) return [x + (px - x) * d / L, y + (py - y) * d / L]; d -= L; x = px; y = py; }
      return [x, y];
    }
    const speedOf = c => 7.5 * (c.snowIn >= 1 ? 0.82 : c.snowIn > 0 ? 0.9 : 1) * (c.s.rain > 0.3 ? 0.93 : 1) * (c.s.ice ? 0.8 : 1);

    function snap() {
      if (snapT != null && throwT == null) return;
      reset(); snapT = performance.now(); Sound.crunch();
      const t = document.getElementById('qb-throw'); if (t) t.hidden = false;
    }
    function throwTo(i) {
      if (snapT == null || throwT != null) return;
      const c = conds(cur), h = ends(c)[endIdx], now = performance.now(), ts = (now - snapT) / 1000;
      const sp = speedOf(c), r = ROUTES[i];
      // lead the receiver: where he'll be when the ball gets there
      let [tx, ty] = routePos(r, ts + 0.8, sp);
      const qb = [0, -6], dist = Math.hypot(tx - qb[0], ty - qb[1]), T = 0.35 + dist / 21;
      [tx, ty] = routePos(r, ts + T, sp);
      const wp = windParts(c, h), gust = c.wind ? 1 + (Math.max(c.gust, c.wind) / Math.max(1, c.wind) - 1) * Math.random() : 1;
      const k = 0.489 * T * T;   // mph to yards of drift over the flight
      const ex = wp.cross * gust * k * 0.15 + (Math.random() - 0.5) * (0.9 + c.wet * 1.2 + (c.F < 25 ? 0.4 : 0));
      const ey = wp.tail * gust * k * 0.1 + (Math.random() - 0.5) * (0.9 + c.wet * 0.8);
      const lx = tx + ex, ly = ty + ey, miss = Math.hypot(ex, ey);
      const gl = glare(c, h), lost = dist > c.vis * 0.85;
      let p = Math.max(0.15, 0.93 - dist * 0.007) * (1 - c.wet * 0.13) * (c.F < 25 ? 0.94 : 1) * (1 - gl * 0.25) * (lost ? 0.55 : 1);
      if (miss > 2.4) p *= 0.12; else if (miss > 1.5) p *= 0.55;
      const caught = Math.random() < p;
      let text, kind = 'inc';
      if (caught) { kind = 'catch'; text = miss > 1.2 ? `Caught! A tough grab, the ${wp.cross ? 'wind' : 'throw'} moved it ${Math.round(miss * 3)} ft.` : `Complete! ${Math.round(dist)} yards on the ${r.name.toLowerCase()}.`; }
      else if (lost) { kind = 'lost'; text = c.s.snow ? 'Incomplete. He lost it in the snow.' : c.s.fog ? 'Incomplete. He never saw it come out of the fog.' : 'Incomplete. Lost it in the rain.'; }
      else if (gl > 0.45 && Math.random() < 0.5) { kind = 'lost'; text = 'Incomplete. The receiver lost it in the sun.'; }
      else if (miss > 2.4) { kind = 'wind'; text = `Incomplete. ${Math.abs(ex) > Math.abs(ey) ? `The wind pushed it ${Math.round(Math.abs(ex) * 3)} ft ${ex > 0 ? 'right' : 'left'}` : ey < 0 ? 'Short, the wind knocked it down' : 'Overthrown, the wind carried it'}.`; }
      else if (c.wet > 0.3 && Math.random() < 0.6) { kind = 'drop'; text = 'Dropped! The ball was too slick.'; }
      else { const pick = Math.random() < 0.18; kind = pick ? 'int' : 'inc'; text = pick ? 'Intercepted! A defender jumped the route.' : 'Incomplete. Broken up at the last second.'; }
      const yac = caught ? Math.round((1 + Math.random() * 6) * (c.snowIn >= 1 ? 0.5 : 1)) : 0;
      throwT = now; ball = { from: qb, to: [lx, ly], T, peak: 2.5 + dist * 0.07 }; result = { text, caught, at: now + T * 1000, kind, i, gain: caught ? Math.max(1, Math.round(ly) + yac) : 0 };
      const tb = document.getElementById('qb-throw'); if (tb) tb.hidden = true;
      Sound.whoosh();
    }

    // ----- drawing -----
    let lastRecv = [];
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!cv || !cv.isConnected) return stop();
      if (!ball && snapT == null && !(bannerQ && now - bannerQ.at < 2700) && !Gov.ok('qb', cv, now)) return;
      const gl3 = camMode === 'tv' && q3;
      cv.closest('.qb-stage')?.classList.toggle('gl', !!gl3);
      if (gl3) drawBroadcast3D(now); else if (camMode === 'tv') drawBroadcast(now); else drawHelmet(now);
      if (bannerQ) { const dpr = Math.min(devicePixelRatio || 1, 2); Arena.banner(ctx, cv.width / dpr, cv.height / dpr, bannerQ.txt[0], bannerQ.txt[1], (now - bannerQ.at) / 1000, bannerQ.txt[2]); if (now - bannerQ.at > 2700) bannerQ = null; }
      if (camMode === 'tv') Arena.themeFinish(ctx, cv.width / Math.min(devicePixelRatio || 1, 2), cv.height / Math.min(devicePixelRatio || 1, 2));
    }
    function drawHelmet(now) {
      const c = conds(cur), E = ends(c), h = E[endIdx];
      const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = Math.round(W * 0.66);
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const camY = -12, hz = H * 0.12, F = W * 0.42, FV = W * 0.8;   // looking slightly down the field from just behind the pocket
      const P = (x, y, z = 0) => { const D = y - camY; return D <= 0.6 ? null : [W / 2 + F * x / D, hz + FV * (EYE - z) / D, D]; };
      const night = c.indoor || c.sun.el <= 0;
      // sky and stands
      const sk = ctx.createLinearGradient(0, 0, 0, hz);
      if (night) { sk.addColorStop(0, '#05070D'); sk.addColorStop(1, '#16202E'); }
      else if (c.cloud > 0.6 || c.s.rain || c.s.snow) { sk.addColorStop(0, '#6C7A89'); sk.addColorStop(1, '#AEB8C2'); }
      else { sk.addColorStop(0, '#3E86D6'); sk.addColorStop(1, '#B8DCF5'); }
      ctx.fillStyle = sk; ctx.fillRect(0, 0, W, hz + 2);
      // the stands across the far end and up the sides
      const standTop = Math.max(2, hz - H * 0.1);
      ctx.fillStyle = night ? '#1B2330' : '#4A5461'; ctx.fillRect(0, standTop, W, hz - standTop + 2);
      ctx.fillStyle = night ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)';
      for (let i = 0; i < 220; i++) { const x = (i * 137.5) % W, y = standTop + ((i * 61) % 100) / 100 * (hz - standTop); ctx.fillRect(x, y, 1.6, 1.6); }
      // field: grass in 5-yard bands, the end zone, out to the end line
      const far = toGoal + 10, side = SIDE + 3;
      const quad = (y1, y2, col, x1 = -side, x2 = side) => { const a = P(x1, y1), b = P(x2, y1), cc = P(x2, y2), d = P(x1, y2); if (!a || !d) return; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(cc[0], cc[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill(); };
      quad(camY + 0.7, far + 6, '#24502A');
      for (let y = Math.floor((camY + 1) / 5) * 5; y < toGoal; y += 5) quad(Math.max(camY + 0.7, y), Math.min(toGoal, y + 5), Math.round(y / 5) % 2 ? '#2F6B35' : '#3A8442', -SIDE, SIDE);
      quad(toGoal, far, '#1F4F7A', -SIDE, SIDE);   // end zone
      // painted lines, buried by snow
      const lineA = Math.max(0.08, 1 - c.snowIn / 1.1);
      ctx.strokeStyle = `rgba(245,248,242,${0.9 * lineA})`;
      for (let y = Math.ceil((camY + 1) / 5) * 5; y <= far; y += 5) { const a = P(-SIDE, y), b = P(SIDE, y); if (!a) continue; ctx.lineWidth = Math.max(0.6, 5 / a[2]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      for (const sx of [-SIDE, SIDE]) { const a = P(sx, camY + 0.8), b = P(sx, far); if (a && b) { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
      for (let y = Math.ceil(camY + 1); y < toGoal; y++) for (const hx of [-HASH, HASH]) { const a = P(hx - 0.35, y), b = P(hx + 0.35, y); if (a) { ctx.lineWidth = Math.max(0.5, 3 / a[2]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
      // line of scrimmage and first-down markers
      { const a = P(-SIDE, 0), b = P(SIDE, 0); if (a) { ctx.strokeStyle = 'rgba(80,150,255,0.85)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
      { const fd = Math.min(toGoal, 10), a = P(-SIDE, fd), b = P(SIDE, fd); if (a) { ctx.strokeStyle = 'rgba(255,220,60,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
      // snow on the field
      if (c.snowIn > 0) {
        const cover = Math.min(0.92, Math.pow(Math.min(1, c.snowIn / 1.3), 0.7));
        const a = P(-side, camY + 0.7), b = P(side, camY + 0.7), cc = P(side, far + 6), d = P(-side, far + 6);
        ctx.fillStyle = `rgba(238,244,248,${cover})`; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(cc[0], cc[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
      } else if (c.s.rain > 0.3) {   // a wet sheen
        const gr = ctx.createLinearGradient(0, hz, 0, H); gr.addColorStop(0, 'rgba(180,200,220,0.25)'); gr.addColorStop(1, 'rgba(180,200,220,0)'); ctx.fillStyle = gr; ctx.fillRect(0, hz, W, H - hz);
      }
      // goalposts at the back of the end zone, with a flag showing the wind
      const gp = toGoal + 10;
      { const base = P(0, gp, 0), bar = P(0, gp, 3.33), l = P(-HASH, gp, 3.33), r = P(HASH, gp, 3.33), lt = P(-HASH, gp, 10), rt = P(HASH, gp, 10);
        if (base) { ctx.strokeStyle = '#F5D23B'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, 8 / base[2]);
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(bar[0], bar[1]); ctx.moveTo(l[0], l[1]); ctx.lineTo(r[0], r[1]); ctx.moveTo(l[0], l[1]); ctx.lineTo(lt[0], lt[1]); ctx.moveTo(r[0], r[1]); ctx.lineTo(rt[0], rt[1]); ctx.stroke();
          if (c.wind) { const wp = windParts(c, h), len = Math.min(1, c.wind / 18) * 2.2, flap = Math.sin(now / 90) * 0.25; const tip = P(HASH + wp.cross / Math.max(1, c.wind) * len, gp + wp.tail / Math.max(1, c.wind) * len * 0.6, 9.6 + flap); if (tip) { ctx.fillStyle = '#E8202E'; ctx.beginPath(); ctx.moveTo(rt[0], rt[1]); ctx.lineTo(tip[0], tip[1]); const lo = P(HASH, gp, 9.1); ctx.lineTo(lo[0], lo[1]); ctx.closePath(); ctx.fill(); } }
        } }
      // the players: three receivers and the defenders on them
      const ts = snapT != null ? (now - snapT) / 1000 : 0, sp = speedOf(c);
      const col = cur.home?.color || '#1F4E86', dcol = cur.away?.color || '#C8232C';
      const person = (x, y, color, label) => {
        const feet = P(x, y, 0), head = P(x, y, 2); if (!feet) return null;
        const hgt = feet[1] - head[1], w = hgt * 0.32;
        ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(feet[0] - w / 2, head[1] + hgt * 0.2, w, hgt * 0.55, w * 0.2) : ctx.rect(feet[0] - w / 2, head[1] + hgt * 0.2, w, hgt * 0.55); ctx.fill();
        ctx.fillStyle = '#F4F1EA'; ctx.fillRect(feet[0] - w * 0.4, head[1] + hgt * 0.72, w * 0.8, hgt * 0.26);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(feet[0], head[1] + hgt * 0.12, w * 0.42, 0, 6.283); ctx.fill();
        if (label) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = `700 ${Math.max(8, Math.min(12, hgt * 0.35))}px ${getComputedStyle(document.body).getPropertyValue('--body') || 'sans-serif'}`; ctx.textAlign = 'center'; ctx.fillText(label, feet[0], head[1] - 3); }
        return [feet[0], (feet[1] + head[1]) / 2];
      };
      lastRecv = [];
      ROUTES.map((r, i) => [r, i, routePos(r, ts, sp)]).sort((a, b) => b[2][1] - a[2][1]).forEach(([r, i, [x, y]]) => {
        const [dx, dy] = routePos(r, Math.max(0, ts - 0.35), sp * 0.97);
        person(dx + (r.start[0] < 0 ? 1.2 : -1.2), dy + 2.2, dcol);
        const p = person(x, y, col, snapT != null && throwT == null ? r.name : '');
        if (p) lastRecv[i] = { sx: p[0], sy: p[1] };
      });
      // the ball in the air
      if (ball) {
        const k = Math.min(1, (now - throwT) / 1000 / ball.T);
        const x = ball.from[0] + (ball.to[0] - ball.from[0]) * k, y = ball.from[1] + (ball.to[1] - ball.from[1]) * k, z = 1.8 + Math.sin(k * Math.PI) * ball.peak;
        const p = P(x, y, z), sh = P(x, y, 0);
        if (p) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sh[0], sh[1], Math.max(1.5, 10 / sh[2]), Math.max(0.8, 4 / sh[2]), 0, 0, 6.283); ctx.fill();
          ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(now / 60); ctx.fillStyle = '#7A3E1C'; ctx.beginPath(); ctx.ellipse(0, 0, Math.max(2, 14 / p[2]), Math.max(1.2, 8 / p[2]), 0, 0, 6.283); ctx.fill(); ctx.restore(); }
      }
      resolve(now, ts, c);
      // visibility: everything beyond it fades into the weather
      if (c.vis < 2500) {
        const fogCol = c.s.snow ? '232,238,243' : c.s.fog ? '205,211,217' : night ? '70,80,92' : '150,160,172';
        const yv = hz + FV * EYE / Math.max(5, c.vis), yn = hz + FV * EYE / Math.max(4, c.vis * 0.35);
        const fg = ctx.createLinearGradient(0, 0, 0, H);
        fg.addColorStop(0, `rgba(${fogCol},0.97)`);
        fg.addColorStop(Math.min(0.99, yv / H), `rgba(${fogCol},0.9)`);
        fg.addColorStop(Math.min(0.995, Math.max(yv / H + 0.001, yn / H)), `rgba(${fogCol},0.45)`);
        fg.addColorStop(1, `rgba(${fogCol},${c.vis < 300 ? 0.15 : 0})`);
        ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
      }
      // stadium lights at night
      if (night) for (const lx of [0.08, 0.92]) { const g2 = ctx.createRadialGradient(W * lx, standTop - 6, 0, W * lx, standTop - 6, W * 0.3); g2.addColorStop(0, 'rgba(255,246,220,0.85)'); g2.addColorStop(0.15, 'rgba(255,240,200,0.25)'); g2.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H); }
      // the sun, where it really is relative to the way he's facing
      const gl = glare(c, h);
      if (!c.indoor && c.sun.el > 0) {
        const a = rel(c.sun.az, h);
        if (Math.abs(a) < 80) {
          const sx = W / 2 + F * Math.tan(a * Math.PI / 180) * 0.55, sy = hz - F * Math.tan(Math.min(60, c.sun.el) * Math.PI / 180) * 0.55;
          const R = W * (0.18 + gl * 0.6), al = Math.max(0.25, gl) * (1 - c.cloud * 0.7);
          const g3 = ctx.createRadialGradient(sx, sy, 0, sx, sy, R); g3.addColorStop(0, `rgba(255,252,236,${Math.min(1, 0.95 * al + 0.1)})`); g3.addColorStop(0.2, `rgba(255,240,190,${0.5 * al})`); g3.addColorStop(1, 'rgba(255,240,190,0)');
          ctx.fillStyle = g3; ctx.fillRect(0, 0, W, H);
          if (gl > 0.3) { ctx.fillStyle = `rgba(255,250,230,${gl * 0.25})`; ctx.fillRect(0, 0, W, H); }
        }
      }
      // weather in front of his eyes: rain on the visor, snow, hail
      if (sky) sky.step(ctx, W, H, now, 1);
      // facemask edges
      ctx.strokeStyle = 'rgba(20,24,30,0.65)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(W * 0.18, H + 4); ctx.quadraticCurveTo(W * 0.5, H * 0.9, W * 0.82, H + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W * 0.5, H * 0.92); ctx.lineTo(W * 0.5, H + 4); ctx.stroke();
      if (c.F < 25 && !c.indoor) { const p = (Math.sin(now / 700) + 1) / 2; const g4 = ctx.createRadialGradient(W * 0.5, H, 0, W * 0.5, H, H * 0.5); g4.addColorStop(0, `rgba(240,247,252,${0.35 * p})`); g4.addColorStop(1, 'rgba(240,247,252,0)'); ctx.fillStyle = g4; ctx.fillRect(0, 0, W, H); }   // breath
    }
    return { section, mount, stop, refresh, conds };
  })();

  // =====================================================================================
  // ---------- Easter eggs ----------
  const Eggs = (() => {
    function found(k) { const e = store.get('eggs', {}); if (!e[k]) { e[k] = Date.now(); store.set('eggs', e); } }
    // 1. Tap the logo in the header 10 times: a secret blizzard
    let taps = 0, tapT = 0;
    $('#header-mark').addEventListener('click', () => {
      const now = Date.now(); taps = now - tapT < 900 ? taps + 1 : 1; tapT = now;
      if (taps < 10) return;
      taps = 0;
      toast('You found the secret blizzard!'); found('blizzard');
      Sound.whoosh();
      const haze = $('#whiteout');
      Snow.blizzard(700, 40); Snow.burst(); haze.style.opacity = 0.35; haze.classList.add('on');
      setTimeout(() => { Blizzard.off(); haze.style.opacity = 0; haze.classList.remove('on'); if (!GameView.isOpen()) homeWinter(); }, 12000);
    });
    // 2. The classic cheat code (arrow keys + B A, or swipes then two taps): golden snow
    const CODE = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a'];
    let seq = [], sx = 0, sy = 0, st = 0;
    const push = k => {
      seq.push(k); seq = seq.slice(-10);
      if (seq.length === 10 && seq.every((v, i) => v === CODE[i] || (i >= 8 && v === 'tap'))) { seq = []; golden(); }
    };
    addEventListener('keydown', e => { const m = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', b: 'b', B: 'b', a: 'a', A: 'a' }[e.key]; if (m) push(m); });
    addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
    addEventListener('touchend', e => {
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st > 700) return;
      if (Math.hypot(dx, dy) < 25) { push('tap'); return; }
      if (Math.abs(dx) > Math.abs(dy) * 1.4) push(dx > 0 ? 'right' : 'left'); else if (Math.abs(dy) > Math.abs(dx) * 1.4) push(dy > 0 ? 'down' : 'up');
    }, { passive: true });
    function golden() {
      const on = document.documentElement.classList.toggle('golden');
      toast(on ? 'Cheat code accepted: golden snow!' : 'Golden snow off.');
      Sound.jingle(Theme.get());
      if (on) found('golden');
      if (on) for (let i = 0; i < 60; i++) { const s = document.createElement('span'); s.className = 'confetti'; s.style.left = Math.random() * 100 + 'vw'; s.style.setProperty('--c', ['#F5B841', '#FFE08A', '#fff', '#E8202E', '#2F5BFF'][i % 5]); s.style.animationDelay = Math.random() * 0.6 + 's'; document.body.appendChild(s); setTimeout(() => s.remove(), 2600); }
    }
    // 3. Shake for a flurry three times in a row: an avalanche
    let flurries = [];
    function onFlurry() {
      const now = Date.now(); flurries = [...flurries.filter(t => now - t < 7000), now];
      if (flurries.length < 3) return;
      flurries = [];
      const el = document.createElement('div'); el.className = 'avalanche';
      found('avalanche');
      el.innerHTML = '<span>AVALANCHE!</span><small>Swipe to dig out</small>';
      document.body.appendChild(el);
      Sound.whoosh(); Sound.thunder(); if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
      let dug = 0;
      const dig = () => { dug++; el.style.setProperty('--dug', Math.min(1, dug / 12)); if (dug >= 12) clear(); Sound.scrape(); };
      const clear = () => { el.classList.add('melt'); setTimeout(() => el.remove(), 700); };
      el.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') dig(); });
      el.addEventListener('click', dig);
      setTimeout(clear, 9000);
    }
    return { onFlurry, found };
  })();


  // =====================================================================================
  // ---------- Version, what's new, and the welcome tour ----------
  const APP_VERSION = '2026.11.8';
  const WHATS_NEW = [
    ['Feel the stadium', "During a game, your screen takes on the stadium's real weather: gusts push the cards, cold fogs the glass (wipe it with your finger), rain beads and runs, and the phone buzzes with gusts and thunder."],
    ['Snow Game Bingo', 'A card of weather moments for every weather game. Some squares mark themselves from the live weather and scoring; tap the rest when you see them on TV.'],
    ['Weather in your room', "Open the camera and the stadium's snow or rain falls over your living room at the real rate. Snap a picture to share."],
    ['Compared to you', 'Your weather right now vs. the stadium, explained with things you have at home.'],
    ['Stadium sound', 'With sound on, the wind howls as hard as the real wind, swells with each gust, and the crowd goes up when somebody scores.'],
    ['3D kick simulator', "Full 3D: modeled players, a lit stadium, shadows from the real sun, and the game's forecast weather falling on the field. Set the arc, aim, power, and accuracy of every kick, and see how long the attempt is."],
    ['Official weather alerts', 'National Weather Service warnings for each stadium, plus what the local forecasters are saying in their own notes.'],
    ['Built for the weather?', "Every team's record in snow, cold, wind, and rain since 2022, and a rating for how ready each team is for this game's weather."],
    ['Weather box score', 'After each game: what the forecast said vs. what actually happened, a forecast grade, and every field goal against the odds.'],
    ['Snow season tracker', "This season's snow games, coldest kickoffs, windiest games, and a stadium leaderboard, on the home screen."],
    ['Live snow alerts', 'A push the moment snow starts falling during a game, at every inch that piles up, and when it turns heavy.']
  ];
  function whatsNew(force) {
    const box = $('#whatsnew');
    if (!force && (store.get('seenVersion', null) === APP_VERSION || !store.get('tourDone', false))) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="wn-head"><b>What's new</b><button class="text-btn" id="wn-close" aria-label="Dismiss">Got it</button></div>
      <ul>${WHATS_NEW.map(([t, d]) => `<li><b>${esc(t)}</b> ${esc(d)}</li>`).join('')}</ul>`;
    box.querySelector('#wn-close').onclick = () => { store.set('seenVersion', APP_VERSION); box.hidden = true; Sound.crunch(); };
  }

  const Tour = (() => {
    const slides = () => [
      { art: `<img src="${themeLogo(Theme.get()).badge}" alt="">`, t: 'Welcome to Snow Game Radar', d: 'Every NFL game this week, with the snow games up top. Tap any game for the full weather story.' },
      { art: '<span class="tour-emoji">🎬</span>', t: 'Every game plays its weather', d: 'Opening a game plays its forecast: snow, rain, fog, wind, sun. Inside, try the kick simulator, the field cam, and the replay.' },
      { art: '<span class="tour-emoji">👆</span>', t: 'Hidden things to try', d: 'Write in the snowbank with your finger. Shake your phone for a flurry. Tilt to drift the snow. Scrape the frost. Drag the ball in the kick simulator. And there are a few secrets to find.' },
      { art: '<span class="tour-emoji">🎨</span>', t: 'Make it yours', d: 'Pick a theme from the palette button, choose your teams, and turn on snow alerts in Settings.', actions: true }
    ];
    let i = 0;
    function draw() {
      const S = slides(), s = S[i];
      $('#tour-slides').innerHTML = `<div class="tour-slide"><div class="tour-art">${s.art}</div><h2 id="tour-title">${esc(s.t)}</h2><p>${esc(s.d)}</p>
        ${s.actions ? `<div class="tour-quick"><button class="secondary" data-tq="theme">Pick a theme</button><button class="secondary" data-tq="settings">Open Settings</button></div>` : ''}</div>`;
      $('#tour-dots').innerHTML = S.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
      $('#tour-next').textContent = i === S.length - 1 ? "Let's go" : 'Next';
    }
    function open() { i = 0; draw(); $('#tour').showModal(); }
    function done() { store.set('tourDone', true); store.set('seenVersion', APP_VERSION); $('#tour').close(); whatsNew(); }
    $('#tour-next').addEventListener('click', () => { if (i >= slides().length - 1) return done(); i++; draw(); Sound.crunch(); });
    $('#tour-skip').addEventListener('click', done);
    $('#tour-slides').addEventListener('click', e => {
      const b = e.target.closest('[data-tq]'); if (!b) return;
      done();
      if (b.dataset.tq === 'theme') $('#theme-btn').click(); else openSheet();
    });
    return { open, maybe: () => { if (!store.get('tourDone', false)) setTimeout(open, 1600); } };
  })();

  // ---------- Settings extras: theme buttons, battery saver, records, eggs, status ----------
  const EGGS = [['blizzard', 'Secret blizzard', 'Something happens if you keep tapping the logo.'], ['golden', 'Golden snow', 'Old video game players might know a certain code.'], ['avalanche', 'Avalanche', 'What happens if you keep shaking?']];
  function settingsExtras() {
    const th = Theme.get();
    for (const b of document.querySelectorAll('[data-settheme]')) b.setAttribute('aria-pressed', b.dataset.settheme === th);
    $('#low-power').checked = store.get('lowpower', false);
    $('#haptics-on').checked = store.get('haptics', true);
    const bt = Bingo.tally();
    $('#bingo-record').textContent = bt.bingos ? `${bt.bingos} Bingo${bt.bingos > 1 ? 's' : ''} in ${bt.games.length} game${bt.games.length > 1 ? 's' : ''}${bt.blackouts ? `, ${bt.blackouts} blackout${bt.blackouts > 1 ? 's' : ''}` : ''}` : 'No Bingos yet. Cards go live at kickoff.';
    $('#slow-note').textContent = Gov.slow() && !store.get('lowpower', false) ? 'Your phone seemed busy, so the app is already easing off a little.' : '';
    // Kicking Combine records, from every stadium you've tried
    const recs = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('sgr:combine:')) recs.push([k.slice(12), JSON.parse(localStorage.getItem(k))]); } } catch (e) {}
    recs.sort((a, b) => b[1].score - a[1].score);
    $('#combine-records').innerHTML = recs.length ? recs.slice(0, 8).map(([n, r]) => `<div class="set-row"><span>${esc(n)}</span><b>${r.score}</b><small>${r.made} of 10, long ${r.long || 0}</small></div>`).join('') : '<p class="sheet-note">No records yet. Try the Kicking Combine in any game\'s kick simulator.</p>';
    const eggs = store.get('eggs', {});
    $('#eggs-count').textContent = `${EGGS.filter(([k]) => eggs[k]).length} of ${EGGS.length}`;
    $('#eggs-list').innerHTML = EGGS.map(([k, name, hint]) => `<div class="set-row${eggs[k] ? ' got' : ''}"><span>${eggs[k] ? '✓ ' + esc(name) : '? ? ?'}</span><small>${eggs[k] ? 'Found ' + new Date(eggs[k]).toLocaleDateString([], { month: 'short', day: 'numeric' }) : esc(hint)}</small></div>`).join('');
    $('#app-version').textContent = `Version ${APP_VERSION}`;
    appStatus();
  }
  async function appStatus() {
    const box = $('#app-status');
    const row = (ok, name, detail) => `<div class="set-row status-${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}"><span>${ok === true ? '●' : ok === false ? '●' : '●'} ${esc(name)}</span><small>${esc(detail)}</small></div>`;
    const ago = m => m == null ? 'never' : m < 2 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} hours ago`;
    const rows = [];
    rows.push(row(navigator.onLine, 'Internet', navigator.onLine ? 'Connected' : 'No connection; showing the last forecast'));
    if (DEMO) { rows.push(row(null, 'Backend', 'Sample data (no backend URL in config.js)')); box.innerHTML = rows.join(''); return; }
    try {
      const s = await (await fetch(API + '/status', { cache: 'no-store' })).json();
      rows.push(row(true, 'Backend', 'Responding'));
      rows.push(row(s.games.minutesOld != null && s.games.minutesOld < 90 && s.games.count > 0, 'Games and forecasts', `${s.games.count} games, updated ${ago(s.games.minutesOld)}${s.games.espnDays ? ` · ESPN ${s.games.espnOk} of ${s.games.espnDays} days` : ''}`));
      rows.push(row(s.outlook.lastError ? false : s.outlook.minutesOld != null && s.outlook.minutesOld < 8 * 60, 'Two-week outlook', s.outlook.lastError ? `Last build failed: ${s.outlook.lastError}` : `${s.outlook.items} games, updated ${ago(s.outlook.minutesOld)}`));
      rows.push(row(s.history.ready >= s.history.total && s.history.total > 0 ? true : null, 'Stadium snow history', `${s.history.ready} of ${s.history.total} stadiums ready`));
      rows.push(row(s.wordmarks.count > 25 ? true : null, 'Team name logos', `${s.wordmarks.count} of 32 found`));
      if (s.ledger) rows.push(row(s.ledger.ready ? true : null, 'Team weather records', s.ledger.ready ? `Every outdoor game since ${s.ledger.from}` : `Gathering: ${s.ledger.done} of ${s.ledger.total} weeks (fills in over a day or so)`));
      const sub = pushSupported ? await currentSub().catch(() => null) : null;
      rows.push(row(s.alerts.vapid && !!sub ? true : s.alerts.vapid ? null : false, 'Snow alerts', !s.alerts.vapid ? 'Backend keys missing' : sub ? `On for this phone (${s.alerts.phones} phone${s.alerts.phones === 1 ? '' : 's'} signed up)` : 'Off for this phone'));
    } catch (e) {
      rows.push(row(false, 'Backend', "Couldn't reach it. Check your connection or the Worker."));
    }
    box.innerHTML = rows.join('');
  }

  // =====================================================================================
  // ---------- Game-day mode: when games are on, the top of the home screen becomes a live board ----------
  function renderGameDay(games) {
    const box = $('#gameday');
    const live = games.filter(g => g.live);
    const now = Date.now();
    const soon = games.filter(g => !g.live && !g.final && new Date(g.kickoff).getTime() - now < 4 * 3600000 && new Date(g.kickoff).getTime() > now - 600000);
    document.body.classList.toggle('game-day', live.length > 0);
    if (!live.length && !soon.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    // a ticker of what the weather is doing at every stadium right now
    const items = live.map(g => {
      const lw = g.liveWx, W = weatherOf(g);
      if (g.roof === 'dome') return `${g.away.abbr} ${g.score?.away ?? 0}–${g.score?.home ?? 0} ${g.home.abbr}: indoors`;
      const bits = [snowingLive(g) ? `${Blizzard.rateOf(g).toFixed(2)}″/hr snow, ${inches(lw.snowSoFarIn)} down` : W.label.toLowerCase(), lw ? `${lw.f}°` : '', lw && lw.g >= 20 ? `gusts ${lw.g}` : ''].filter(Boolean);
      return `${g.away.abbr} ${g.score?.away ?? 0}–${g.score?.home ?? 0} ${g.home.abbr} (${esc(g.status || '')}): ${esc(bits.join(', '))}`;
    });
    for (const g of soon.slice(0, 4)) { const W = weatherOf(g); items.push(`Up next: ${g.away.abbr} at ${g.home.abbr}, ${fmtTime(g.kickoff)}: ${esc(W.label.toLowerCase())}${g.wx ? `, ${g.wx.lowF}°` : ''}`); }
    const text = items.join('   ❄   ');
    box.innerHTML = `<div class="gd-head"><span class="live-dot">${live.length ? 'Game day' : 'Today'}</span><span>${live.length ? `${live.length} game${live.length > 1 ? 's' : ''} on now` : `Kickoffs in the next few hours`}</span></div>
      <div class="gd-ticker" aria-label="Weather around the league"><div class="gd-track" style="--dur:${Math.max(18, text.length / 7)}s"><span>${text}</span><span aria-hidden="true">${text}</span></div></div>`;
  }

  // ---------- How fresh is the forecast? And a saved copy for when there's no signal ----------
  function freshness() {
    const el = $('#fresh'); if (!el || !state.data) return;
    const m = Math.round((Date.now() - new Date(state.data.updated).getTime()) / 60000);
    const when = m < 2 ? 'just now' : m < 90 ? `${m} min ago` : new Date(state.data.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.className = 'fresh' + (state.offline ? ' offline' : m > 180 ? ' stale' : '');
    el.textContent = state.offline ? `No connection. Showing the forecast saved ${when}.` : `Forecast updated ${when}${(state.data.games || []).some(g => g.live) ? ' · live games refresh every minute' : ''}`;
  }
  setInterval(freshness, 60000);
  addEventListener('online', () => { if (state.offline) load(true); });


  // ---------- Wiring ----------
  $('#theme-btn').addEventListener('click', e => {
    e.stopPropagation();
    const pop = $('#theme-pop'), open = pop.hidden;
    pop.hidden = !open; $('#theme-btn').setAttribute('aria-expanded', String(open));
  });
  $('#theme-pop').addEventListener('click', e => {
    const b = e.target.closest('[data-theme-pick]');
    if (!b) return;
    Theme.set(b.dataset.themePick);
    $('#theme-pop').hidden = true; $('#theme-btn').setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('click', e => {
    if (!$('#theme-pop').hidden && !e.target.closest('#theme-pop')) { $('#theme-pop').hidden = true; $('#theme-btn').setAttribute('aria-expanded', 'false'); }
  });
  $('#ranking').addEventListener('click', () => {});

  $('#featured').addEventListener('click', e => {
    const card = e.target.closest('[data-open]');
    if (card) GameView.open(card.dataset.open);
  });

  $('#list').addEventListener('click', e => {
    const btn = e.target.closest('.game');
    if (btn) GameView.open(btn.dataset.id);
  });
  $('#favs').addEventListener('click', e => {
    const btn = e.target.closest('.game');
    if (btn) GameView.open(btn.dataset.id);
  });
  $('#live-now').addEventListener('click', e => {
    const card = e.target.closest('[data-open]');
    if (card) GameView.open(card.dataset.open);
  });
  $('#team-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-team]');
    if (!b) return;
    const on = Favs.toggle(b.dataset.team);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    $('#only-favs').disabled = !Favs.list().length;
    Sound.crunch();
    render(); capSoon(document);
  });
  $('#sound-on').addEventListener('change', e => {
    store.set('sound', e.target.checked);
    if (e.target.checked) { Sound.unlock(); Sound.crunch(); }
    else { Sound.windStop(true); Soundscape.stop(); }
  });
  $('#only-favs').addEventListener('change', e => { store.set('onlyFavs', e.target.checked); syncPrefs(); });
  $('#hero-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-open]');
    if (btn) GameView.open(btn.dataset.open);
  });

  $('#refresh').addEventListener('click', () => load(true));
  $('#bell').addEventListener('click', () => openSheet());
  $('#sheet-close').addEventListener('click', () => $('#sheet').close());
  $('#wotw').addEventListener('click', e => { const c = e.target.closest('[data-open]'); if (c) GameView.open(c.dataset.open); });
  $('#report-btn').addEventListener('click', () => Report.open());
  $('#report-close').addEventListener('click', () => { Report.stop(); $('#report').close(); });
  $('#report-again').addEventListener('click', () => Report.replay());
  $('#report').addEventListener('close', () => Report.stop());
  $('#weather-games').addEventListener('click', e => {
    const card = e.target.closest('[data-open]');
    if (card) GameView.open(card.dataset.open);
  });
  $('#outlook').addEventListener('click', e => {
    const b = e.target.closest('[data-outlook]');
    if (!b) return;
    const id = b.dataset.outlook;
    if (state.data.games.find(x => String(x.id) === String(id))) GameView.open(id);
    else { Sound.crunch(); toast('The full forecast opens 7 days before kickoff.'); }
  });
  $('#holiday-pick').addEventListener('click', e => {
    const b = e.target.closest('[data-holiday]');
    if (!b) return;
    Holiday.preview(b.dataset.holiday);
    for (const x of document.querySelectorAll('[data-holiday]')) x.setAttribute('aria-pressed', x === b);
    Sound.crunch();
  });
  $('#set-theme').addEventListener('click', e => {
    const b = e.target.closest('[data-settheme]'); if (!b) return;
    Theme.set(b.dataset.settheme);
    for (const x of document.querySelectorAll('[data-settheme]')) x.setAttribute('aria-pressed', x === b);
  });
  $('#haptics-on').addEventListener('change', e => { store.set('haptics', e.target.checked); if (e.target.checked && navigator.vibrate) navigator.vibrate(30); });
  $('#low-power').addEventListener('change', e => { store.set('lowpower', e.target.checked); document.documentElement.classList.toggle('lowpower', e.target.checked); toast(e.target.checked ? 'Battery saver on' : 'Battery saver off'); settingsExtras(); });
  $('#replay-tour').addEventListener('click', () => { $('#sheet').close(); Tour.open(); });
  $('#show-whatsnew').addEventListener('click', () => { $('#sheet').close(); whatsNew(true); $('#whatsnew').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  $('#gameday').addEventListener('click', () => { const l = $('#live-now'); if (l.innerHTML) l.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#open-passport').addEventListener('click', () => { $('#sheet').close(); Passport.open(); });
  $('#passport-close').addEventListener('click', () => $('#passport').close());
  $('#passport').addEventListener('click', e => { if (e.target === $('#passport')) $('#passport').close(); });
  $('#sheet').addEventListener('click', e => { if (e.target === $('#sheet')) $('#sheet').close(); });

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.data && !GameView.isOpen()) load(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(refreshBell).catch(() => {});
  }
  Theme.apply(Theme.get());
  Snow.start();
  Holiday.apply();
  setInterval(Holiday.apply, 15 * 60000);
  Wordmarks.load();
  document.documentElement.classList.toggle('lowpower', store.get('lowpower', false));
  load().then(() => Tour.maybe());
})();
