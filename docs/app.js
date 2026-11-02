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
      state.data = DEMO ? demoData() : await (await fetch(API + '/games' + (fresh ? '?fresh=1' : ''), { cache: 'no-store' })).json();
      if (!state.data || !Array.isArray(state.data.games)) throw new Error(state.data && state.data.error || 'Bad response');
      render();
      capSoon(document);
      GameView.refresh();
      Splash.hide();
      const m = location.hash.match(/^#game-(.+)$/);
      if (m && !GameView.isOpen()) GameView.open(m[1], true);
    } catch (err) {
      $('#hero-body').innerHTML = '<p class="hero-quiet">No forecast to show right now.</p>';
      $('#list').innerHTML = `<div class="error">Couldn't reach the forecast service. Check your connection, then try again.<br><button id="retry">Try again</button></div>`;
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

    renderWeatherGames(games, featured);
    const more = featured.slice(1);
    $('#featured').innerHTML = more.length ? `
      <h2 class="section-head">More snow on the radar</h2>
      <div class="feature-grid">${more.map(featureCard).join('')}</div>` : '';

    // Your teams' other games next
    const weather = state.weatherGames || [];
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
    if (!GameView.isOpen()) homeWinter();
    tickCountdowns();

    const updated = new Date(state.data.updated);
    $('#footnote').textContent = (DEMO ? 'Sample data shown. Add your backend URL in config.js to see real games. ' : '')
      + `Forecast updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. `
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
        if (!meters[i].c.isConnected) meters.splice(i, 1); else draw(meters[i], t);
      }
      raf = meters.length ? requestAnimationFrame(loop) : null;
    }

    function mulberry(a) {
      return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }

    function draw(m, t) {
      const { c, ctx, s } = m;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = c.clientWidth || 320;
      if (m.w !== W) { m.w = W; c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const top = 10, base = H - 2, goal = W * 0.84;
      // field strip with yard lines and an end zone
      ctx.save();
      roundRect(ctx, 0.5, top, W - 1, base - top, 10);
      ctx.fillStyle = '#12304A'; ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(233, 241, 247, 0.13)'; ctx.lineWidth = 1;
      for (let i = 1; i < 10; i++) { const x = Math.round(goal * i / 10) + 0.5; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, base); ctx.stroke(); }
      ctx.fillStyle = 'rgba(233, 241, 247, 0.07)'; ctx.fillRect(goal, top, W - goal, base - top);
      ctx.fillStyle = 'rgba(233, 241, 247, 0.55)'; ctx.fillRect(goal, top, 2, base - top);
      ctx.font = '800 14px "Big Shoulders Display", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(233, 241, 247, 0.7)'; ctx.fillText('SNOW', (goal + W) / 2 + 1, top + (base - top) * 0.42);

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
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.55, '#E3EEF6'); g.addColorStop(1, '#9DBDD6');
      ctx.fillStyle = g; ctx.fill();
      // bright crust along the surface
      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) { const y = surf(x) + 0.8; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'; ctx.lineWidth = 1.4; ctx.stroke();
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
      ctx.fillStyle = '#F4F9FD';
      for (let i = m.flakes.length - 1; i >= 0; i--) {
        const f = m.flakes[i]; f.y += f.vy; f.ph += 0.05; const x = f.x + Math.sin(f.ph) * 1.5;
        if (f.y >= surf(x)) { m.flakes.splice(i, 1); continue; }
        ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(x, f.y, f.r, 0, 6.283); ctx.fill();
      }
      for (let i = m.drift.length - 1; i >= 0; i--) {
        const d = m.drift[i]; d.x += d.vx; d.y += d.vy; d.vy += 0.012; d.life -= 0.018;
        if (d.life <= 0 || d.x > W) { m.drift.splice(i, 1); continue; }
        ctx.globalAlpha = d.life * 0.8; ctx.beginPath(); ctx.arc(d.x, d.y, 1.1, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      roundRect(ctx, 0.5, top, W - 1, base - top, 10);
      ctx.strokeStyle = 'rgba(233, 241, 247, 0.35)'; ctx.lineWidth = 1; ctx.stroke();
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
      if (flakes.length < target) flakes.push(make(false), make(false));
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
        wx(k6, [79, 80, 80, 78], [0, 0, 0, 0], [1, 2, 2, 1], [10, 10, 15, 10], 12), 0, 'CBS'),
      g('d7', T('HOU', 'Texans', '#03202F'), T('IND', 'Colts', '#002C5F'), k7, V('Lucas Oil Stadium', 'Indianapolis, IN', 39.7601, -86.1639), 'retractable',
        withModels(wx(k7, [34, 33, 33, 32], [0, 0.1, 0.1, 0], [3, 71, 71, 3], [40, 50, 50, 40], 14), models(0.2, 0.1, 0)), 1, 'CBS'),
      g('d8', T('PHI', 'Eagles', '#004C54'), T('JAX', 'Jaguars', '#006778'), k8, V('Tottenham Hotspur Stadium', 'London, England', 51.6, -0.07), 'open',
        wx(k8, [46, 45, 45, 44], [0, 0, 0, 0], [61, 61, 3, 3], [60, 55, 30, 20], 13), 0, 'NFL Network', true)
    ];
    for (const x of games) if (x.wx && x.wx.night == null) x.wx.night = new Date(x.kickoff).getHours() >= 17;

    // a game that finished earlier today
    const kf = new Date(Date.now() - 6 * 3600000).toISOString();
    const fin = g('df', T('TB', 'Buccaneers', '#D50A0A'), T('CHI', 'Bears', '#0B162A'), kf, V('Soldier Field', 'Chicago, IL', 41.8623, -87.6167), 'open',
      wx(kf, [36, 35, 35, 34], [0, 0, 0, 0], [3, 3, 3, 3], [10, 10, 10, 10], 12), 0, 'NBC');
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
    return { updated: new Date().toISOString(), daysAhead: 7, ranking, outlook, games: games.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff)) };
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
      teamStats: pre ? [] : [{ abbr: g.away.abbr, stats: st('248', '161', '87', '1', '21:04') }, { abbr: g.home.abbr, stats: st('301', '178', '123', '0', '23:41') }]
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
      Sound.crunch();
      body.innerHTML = renderGame(g);
      view.classList.toggle('is-day', !!g.wx && g.wx.night === false);
      view.classList.toggle('is-snow', g.level > 0 || snowingLive(g));
      body.style.setProperty('--snow', glow(g));
      if (g.level > 0) body.setAttribute('data-snowgame', ''); else body.removeAttribute('data-snowgame');
      capSoon(body);
      Stats.load(g);
      Photo.load(g);
      Passport.stamp(g);
      Kicker.mount(g);
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
      else { Blizzard.off(); Soundscape.level(snowGame && g.roof !== 'dome' ? 0.3 + g.level * 0.2 : null); }
      FieldCam.mount(g);
      $('#gv-back').focus({ preventScroll: true });
    }

    function close(fromHistory) {
      if (view.hidden) return;
      Intro.stop();
      FX.stop();
      Radar.stop();
      Stats.stop();
      Kicker.stop();
      FieldCam.stop();
      Soundscape.stop();
      Sound.windStop();
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
        <div class="meta-row">${countdown(g)}${w ? trendHtml(g) + agreeHtml(g) + badgeHtml(g) : ''}</div>`;
      const share = `<button class="share-btn" id="share-btn">Share this forecast</button>`;

      const credit = `<p class="gv-source" id="photo-credit"></p>`;
      if (g.roof === 'dome') return head + `<p class="gv-summary">${esc(g.venue.name)} is a dome, so the weather won't touch this one.</p>` + share + Kicker.section(g) + Stats.section(g) + factsSection(g) + credit;
      if (!w) return head + `<p class="gv-summary">This game is past the forecast range. Check back a few days before kickoff.</p>` + share + Kicker.section(g) + Stats.section(g) + factsSection(g) + historySection(g) + credit;

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
        ${quartersSection(g)}
        ${FieldCam.section(g)}
        <div class="gv-stats">
          ${stat(inches(w.snowIn), 'snow during the game')}
          ${stat(inches(w.snowBefore24In ?? 0), 'snow in the 24 hours before')}
          ${stat(inches(w.snowDepthIn ?? 0), 'snow on the ground at kickoff')}
          ${stat(`${w.lowF}–${w.highF}°`, 'game temperature')}
          ${stat(`${w.feelsLowF ?? w.lowF}°`, 'coldest feels-like')}
          ${stat(`${w.gustMph ?? w.windMph} mph`, 'strongest gusts')}
        </div>
        ${lakeSection(g)}
        ${Kicker.section(g)}
        ${share}
        ${Radar.section(g)}
        ${Stats.section(g)}
        ${factsSection(g)}
        ${historySection(g)}
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
        </section>
        ${credit}
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

    body.addEventListener('click', e => {
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
          const banner = snowy ? 'SNOW GAME!' : g.live ? 'GAME ON!' : 'KICKOFF!';
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
    if (w.feelsLowF <= 0) out.push(['ice', 'Ice Bowl']);
    else if (w.feelsLowF <= 20) out.push(['tundra', 'Frozen Tundra']);
    if ((w.gustMph || 0) >= 30 || (w.windMph || 0) >= 20) out.push(['wind', 'Wind Game']);
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
    return { crunch, scrape, whoosh, gobble, bells, windStart, windStop, on, unlock: () => on() && ac() };
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
  const FX = (() => {
    const canvas = $('#gv-fx');
    const ctx = canvas.getContext('2d');
    let raf = null, mode = null, parts = [], puffs = [], gusts = [], swirl = 0, lastPuff = 0;
    function start(g) {
      stop();
      const w = g.wx;
      if (!w || g.roof === 'dome') return;
      const liveSnow = snowingLive(g) ? 1 : 0;
      mode = {
        snow: Math.max(g.level, liveSnow ? 2 : 0),
        rain: (w.rainHours || 0) > 0 && w.precipChance >= 40 && g.level === 0,
        wind: (w.gustMph || 0) >= 25,
        breath: (w.feelsLowF ?? 99) <= 25,
        windSpeed: Math.min(2, (w.gustMph || w.windMph || 0) / 18)
      };
      parts = []; puffs = []; gusts = [];
      if (REDUCED) return;
      loop(performance.now());
    }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = null; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    function burst() { swirl = 1; for (let i = 0; i < 160; i++) parts.push(flake(true, true)); }
    const bliz = { n: 0, wind: 0 };
    function blizzard(n, windMph) { bliz.n = n || 0; bliz.wind = Math.min(2.6, (windMph || 0) / 14); }
    function flake(anywhere, big) {
      const z = Math.random();
      return { kind: 'snow', x: Math.random() * innerWidth, y: anywhere ? Math.random() * innerHeight : -8, r: (big ? 1.4 : 0.8) + z * z * 3, vy: 0.4 + z * 1.4, ph: Math.random() * 6.28, a: 0.35 + z * 0.55 };
    }
    function loop(t) {
      raf = requestAnimationFrame(loop);
      const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const m = mode || {};
      const snowTarget = Math.max([m.breath ? 18 : 0, 70, 150][m.snow || 0] || 0, bliz.n);
      const snowCount = parts.filter(p => p.kind === 'snow').length;
      if (snowCount < snowTarget) parts.push(flake(snowCount < snowTarget * 0.6));
      if (m.rain && parts.length < 140) parts.push({ kind: 'rain', x: Math.random() * (W + 200) - 100, y: -20, vy: 11 + Math.random() * 6, len: 12 + Math.random() * 14 });
      if (m.wind && Math.random() < 0.035 && gusts.length < 5) gusts.push({ x: -200, y: Math.random() * H * 0.9, len: 120 + Math.random() * 200, v: 6 + Math.random() * 6, amp: 6 + Math.random() * 14, ph: Math.random() * 6 });
      if (m.breath && t - lastPuff > 1700) { lastPuff = t; puffs.push({ x: W * (0.15 + Math.random() * 0.7), y: H * (0.62 + Math.random() * 0.3), age: 0 }); }
      swirl *= 0.985;
      const wind = (bliz.n ? Math.max(m.windSpeed || 0.2, bliz.wind) : (m.windSpeed || 0.2)) + swirl * 2 + Tilt.x * 1.4;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.kind === 'snow') {
          p.ph += 0.015 + swirl * 0.08;
          p.y += p.vy * (1 - swirl * 0.6) + Math.sin(p.ph * 2) * swirl * 3;
          p.x += wind * p.vy * 0.7 + Math.sin(p.ph) * (0.4 + swirl * 4);
          if (p.y > H + 10 || p.x > W + 20 || p.x < -20) { if (parts.length > snowTarget + 10) { parts.splice(i, 1); continue; } Object.assign(p, flake(false)); if (p.x > W) p.x = -10; }
          ctx.globalAlpha = p.a; ctx.fillStyle = '#EEF5FA';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        } else {
          p.y += p.vy; p.x += wind * 1.5;
          if (p.y > H) { parts.splice(i, 1); continue; }
          ctx.globalAlpha = 0.35; ctx.strokeStyle = '#A9C7E0'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - wind * 2.5, p.y - p.len); ctx.stroke();
        }
      }
      for (let i = gusts.length - 1; i >= 0; i--) {
        const g = gusts[i]; g.x += g.v;
        if (g.x - g.len > W) { gusts.splice(i, 1); continue; }
        ctx.globalAlpha = 0.18; ctx.strokeStyle = '#DCEAF4'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let k = 0; k <= g.len; k += 8) { const x = g.x - k, y = g.y + Math.sin((x / 60) + g.ph) * g.amp; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i]; p.age += 1 / 60;
        if (p.age > 2.4) { puffs.splice(i, 1); continue; }
        const r = 10 + p.age * 34, a = 0.22 * Math.sin(Math.min(1, p.age / 2.4) * Math.PI);
        const g = ctx.createRadialGradient(p.x, p.y - p.age * 26, 0, p.x, p.y - p.age * 26, r);
        g.addColorStop(0, `rgba(240,247,252,${a})`); g.addColorStop(1, 'rgba(240,247,252,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x + p.age * 8, p.y - p.age * 26, r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    return { start, stop, burst, blizzard };
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
    const list = games.filter(g => !featured.includes(g)).map(g => [g, footballWeather(g)]).filter(([, f]) => f)
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
  // ---------- Kicker report: an animated field goal in this game's conditions ----------
  // Ball flight from basic physics (wind, cold, altitude). With the stadium's field direction, the real
  // wind direction, the kicker's career record and (during the game) where the ball is, it becomes live.
  const Kicker = (() => {
    const YD = 0.9144, MPH = 0.44704, BAR = 3.05;
    const rhoAt = (F, elevFt) => { const T = (F - 32) * 5 / 9 + 273.15; const P = 101325 * Math.pow(1 - 2.25577e-5 * (elevFt || 0) * 0.3048, 5.25588); return P / (287.05 * T); };
    // A good NFL kick: about 63 mph off the foot at 37°. Air drag on a tumbling ball; wind measured relative to the ball.
    function fly({ tail = 0, cross = 0, F = 60, elevFt = 0, wet = false, maxYd = 80 }) {
      const v0 = 28 * (1 - 0.0006 * Math.max(0, 60 - F)) * (wet ? 0.985 : 1), a = 37 * Math.PI / 180;
      const k = 0.5 * rhoAt(F, elevFt) * 0.004 / 0.41;
      let x = 0, y = 0, z = 0, vx = v0 * Math.cos(a), vy = v0 * Math.sin(a), vz = 0;
      const pts = [[0, 0, 0]];
      for (let i = 0; i < 900; i++) {
        const dt = 0.01, rx = vx - tail, rz = vz - cross, sp = Math.hypot(rx, vy, rz);
        vx -= k * sp * rx * dt; vy -= (9.81 + k * sp * vy) * dt; vz -= k * sp * rz * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        if (i % 3 === 0) pts.push([x / YD, y, z / 0.3048]);   // yards downfield, meters up, feet sideways
        if (y < 0 || x / YD > maxYd) break;
      }
      return pts;
    }
    const heightAt = (pts, yd) => { for (let i = 1; i < pts.length; i++) if (pts[i][0] >= yd) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (yd - x0) / (x1 - x0); } return -1; };
    const driftAt = (pts, yd) => { for (let i = 1; i < pts.length; i++) if (pts[i][0] >= yd) return pts[i][2]; return pts[pts.length - 1][2]; };
    const rangeOf = pts => { let best = 0; for (const [x, y] of pts) if (y >= BAR + 0.3) best = x; return Math.floor(best); };
    const NORMAL = rangeOf(fly({}));

    // ----- live data from the backend: field direction and both kickers -----
    const info = {};     // game id -> { axis, kickers }
    async function loadInfo(g) {
      if (info[g.id] || DEMO) return info[g.id] || (DEMO ? (info[g.id] = demoKicking(g)) : null);
      try { info[g.id] = await (await fetch(API + '/kicking?id=' + encodeURIComponent(g.id))).json(); } catch (e) { info[g.id] = {}; }
      return info[g.id];
    }
    function demoKicking(g) {
      const k = (name, team, b, long) => ({ name, team, career: { made: b.reduce((a, x) => a + x[2], 0), att: b.reduce((a, x) => a + x[3], 0), long, buckets: b.map(([lo, hi, made, att]) => ({ lo, hi, made, att })) } });
      return { axis: 20, kickers: {
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
        pts[i][1] = (b.made + 8 * pts[i][1]) / (b.att + 8);   // career rate, steadied toward the league rate
      }
      // a kicker whose long is short of 58 is unlikely beyond it
      if (career?.long) for (const p of pts) if (p[0] > career.long + 2) p[1] *= Math.max(0.15, 1 - (p[0] - career.long) / 12);
      return pts;
    }
    function chance(career, yd, factor = 1, drift = 0) {
      const pts = curve(career), d = yd * factor;
      let p = pts[pts.length - 1][1];
      if (d <= pts[0][0]) p = pts[0][1];
      else for (let i = 1; i < pts.length; i++) if (d <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; p = y0 + (y1 - y0) * (d - x0) / (x1 - x0); break; }
      // crosswind pushing the ball sideways costs accuracy
      p *= 1 - Math.min(0.45, (Math.abs(drift) / 9.25) ** 2 * 0.3);
      return Math.max(0, Math.min(0.995, p));
    }
    const pct = p => Math.round(p * 100) + '%';
    const careerLine = c => {
      if (!c) return 'Career record unavailable';
      const fifty = (c.buckets || []).find(b => b.lo >= 50);
      return `${c.att ? `${c.made}/${c.att} career (${Math.round(c.made / c.att * 100)}%)` : ''}${fifty ? `, ${fifty.made}/${fifty.att} from 50+` : ''}${c.long ? `, long ${c.long}` : ''}`;
    };

    // ----- the weather for kicking: live readings during the game -----
    function conditions(g) {
      if (g.roof === 'dome') return { F: 72, windMph: 0, gust: 0, dir: null, wet: false, elevFt: g.venue?.facts?.elevationFt || 0, indoor: true };
      const w = g.wx || {}, lw = g.live && g.liveWx;
      if (!g.wx && !lw) return { F: 55, windMph: 0, gust: 0, dir: null, wet: false, elevFt: g.venue?.facts?.elevationFt || 0, noForecast: true };
      const F = lw ? lw.f : Math.round(((w.lowF ?? 60) + (w.highF ?? w.lowF ?? 60)) / 2);
      const windMph = Math.round((lw ? lw.w : (w.windAvgMph ?? w.windMph ?? 0)) * 0.75);   // lighter inside the bowl
      const gust = lw ? lw.g : w.gustMph;
      const dir = lw ? lw.d : w.windDir;
      const wet = (w.snowIn || 0) > 0 || (w.rainHours || 0) > 0 || snowingLive(g);
      return { F, windMph, gust, dir: dir ?? null, wet, elevFt: g.venue?.facts?.elevationFt || 0 };
    }
    // wind split into along-the-field and across-the-field parts, for a kick toward compass heading h
    function parts(c, h) {
      const ms = c.windMph * MPH;
      if (c.dir == null || h == null) return null;
      const rel = ((c.dir + 180 - h) * Math.PI) / 180;      // wind blows toward dir + 180
      return { tail: ms * Math.cos(rel), cross: ms * Math.sin(rel) };
    }
    const endName = h => `${compass(h)} end zone`;

    function section(g) {
      return `<section class="gv-chart kicker" id="kicker">
        <h3>Kicker report</h3>
        <div class="kick-live" id="kick-live"></div>
        <p class="gv-sub" id="kick-sub"></p>
        <div class="kick-range" id="kick-range"></div>
        <div class="seg kick-dir" role="group" aria-label="Kick direction" id="kick-dir"></div>
        <div class="kick-stage"><svg class="kick-svg" viewBox="0 0 340 190" role="img" aria-label="Animated field goal attempt"></svg><div class="kick-result" aria-live="polite"></div></div>
        <div class="seg kick-view" role="group" aria-label="View"><button data-kview="side" aria-pressed="true">Side view</button><button data-kview="top" aria-pressed="false">Overhead</button></div>
        <label class="kick-dist"><span>Field goal from <b id="kick-yd">45</b> yards</span><input type="range" min="18" max="70" step="1" value="45" id="kick-slider"></label>
        <div class="kick-people" id="kick-people"></div>
        <div class="legend"><span><i class="line" style="background:${C1}"></i>Today</span><span><i class="line dashed"></i>Calm 60° day</span></div>
        <p class="gv-source">An estimate from ball flight physics using the wind, temperature, and altitude, and each kicker's career record by distance. Real kicks vary with the hold, the snap, and gusts.</p>
      </section>`;
    }

    let raf = null, cur = null, dir = null, view = 'side', yd = 45, ends = null, userMoved = false;
    async function mount(g) {
      stop();
      const root = document.getElementById('kicker');
      if (!root) return;
      cur = g; view = 'side'; userMoved = false;
      root.querySelector('#kick-dir').addEventListener('click', e => {
        const b = e.target.closest('[data-kdir]'); if (!b) return;
        dir = b.dataset.kdir;
        for (const x of root.querySelectorAll('[data-kdir]')) x.setAttribute('aria-pressed', x === b);
        people(); play();
      });
      root.querySelector('.kick-view').addEventListener('click', e => {
        const b = e.target.closest('[data-kview]'); if (!b) return;
        view = b.dataset.kview;
        for (const x of root.querySelectorAll('[data-kview]')) x.setAttribute('aria-pressed', x === b);
        play();
      });
      const slider = root.querySelector('#kick-slider');
      slider.addEventListener('input', () => { userMoved = true; yd = +slider.value; root.querySelector('#kick-yd').textContent = yd; people(); play(true); });
      slider.addEventListener('change', () => play());
      root.querySelector('.kick-stage').addEventListener('click', () => play());
      layout();
      const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); play(); } }, { threshold: 0.4 });
      io.observe(root);
      draw(null, null, 0);
      await loadInfo(g);
      if (cur !== g) return;
      layout(); play(true);
    }
    // called when a live game refreshes
    function refresh(g) {
      if (!cur || !g || g.id !== cur.id || !document.getElementById('kicker')) return;
      cur = g; layout(true);
    }
    function stop() { cancelAnimationFrame(raf); raf = null; }

    // work out the directions to offer, the live situation, and fill in the text
    function layout(soft) {
      const g = cur, c = conditions(g), inf = info[g.id] || {};
      const axis = inf.axis;
      ends = axis != null && c.dir != null && c.windMph > 0 ? [axis, (axis + 180) % 360] : null;
      // direction buttons: the two real end zones when we know which way the field runs, otherwise into / with / across the wind
      const opts = ends
        ? ends.map((h, i) => { const p = parts(c, h); const along = Math.abs(p.tail) < 1 ? 'crosswind' : p.tail > 0 ? 'wind at his back' : 'into the wind'; return [`e${i}`, `Toward the ${endName(h)}`, along]; })
        : [['head', 'Into the wind'], ['tail', 'With the wind'], ['cross', 'Crosswind']];
      if (!dir || !opts.find(o => o[0] === dir)) dir = opts[0][0];
      // live: the offense's kicker and the distance from where the ball is
      const s = g.live ? g.situation : null;
      const offense = s?.poss ? (s.poss === g.home.abbr ? 'home' : s.poss === g.away.abbr ? 'away' : null) : null;
      if (s?.toGoal != null && !userMoved) { yd = Math.max(18, Math.min(70, s.toGoal + 17)); const sl = document.getElementById('kick-slider'); if (sl) { sl.value = yd; document.getElementById('kick-yd').textContent = yd; } }
      const box = document.getElementById('kick-dir');
      if (box) box.hidden = !!(c.indoor || c.noForecast);
      if (box) box.innerHTML = opts.map(([k, label, sub]) => `<button data-kdir="${k}" aria-pressed="${k === dir}">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`).join('');
      const kk = inf.kickers?.[offense];
      const live = document.getElementById('kick-live');
      if (live) live.innerHTML = g.live && s?.poss ? `<span class="live-dot">Live</span><span><b>${esc(s.poss)} ball</b>${s.text ? `, ${esc(s.text)}` : ''}${s.toGoal != null ? `. A field goal from here would be <b>${s.toGoal + 17} yards</b>${s.toGoal + 17 > 65 ? ' (out of range)' : ''}.` : ''}</span>${kk ? `<span class="kick-who">${esc(kk.name)} would kick it.</span>` : ''}` : '';
      const sub = document.getElementById('kick-sub');
      const head = rangeOf(fly({ F: c.F, elevFt: c.elevFt, wet: c.wet, tail: -c.windMph * MPH }));
      const verdict = head <= NORMAL - 8 ? 'A tough day to kick' : head <= NORMAL - 4 ? 'Kicks will be affected' : rangeOf(fly({ F: c.F, elevFt: c.elevFt, wet: c.wet })) > NORMAL + 1 ? 'A good day to kick' : 'Close to normal kicking weather';
      if (sub && (c.indoor || c.noForecast)) sub.textContent = c.indoor ? `${g.venue.name} has a roof, so the weather stays out. These are normal indoor kicking numbers.` : 'No forecast yet, so these use typical conditions. They update with the real weather a few days before kickoff.';
      else if (sub) sub.textContent = `${verdict}. ${c.windMph} mph wind in the bowl${c.dir != null ? ` from the ${compass(c.dir)}` : ''}${c.gust ? ` (gusts to ${c.gust})` : ''}, ${c.F}°${c.elevFt > 3000 ? `, thin air at ${c.elevFt.toLocaleString()} ft` : ''}${c.wet ? ', slick footing' : ''}.${ends ? ` The field runs ${compass(ends[0])}–${compass(ends[1])}.` : ''}`;
      const rangeBox = document.getElementById('kick-range');
      if (rangeBox) {
        const cells = ends
          ? ends.map(h => { const p = parts(c, h); return [rangeOf(fly({ F: c.F, elevFt: c.elevFt, wet: c.wet, tail: p.tail, cross: p.cross })), `yd range toward the ${endName(h)}`]; })
          : [[head, 'yd range into the wind'], [rangeOf(fly({ F: c.F, elevFt: c.elevFt, wet: c.wet, tail: c.windMph * MPH })), 'yd range with the wind']];
        const drift = Math.abs(driftAt(fly({ F: c.F, elevFt: c.elevFt, wet: c.wet, cross: c.windMph * MPH }), 45));
        rangeBox.innerHTML = cells.map(([v, l]) => `<div><b>${v}</b><span>${esc(l)}</span></div>`).join('')
          + `<div><b>${drift.toFixed(0)} ft</b><span>drift on a 45-yarder in a full crosswind</span></div><div class="muted"><b>${NORMAL}</b><span>yd range on a calm 60° day</span></div>`;
      }
      people();
      if (soft) play(true);
    }
    // both kickers: career record, and estimates for today's weather at common distances
    function people() {
      const box = document.getElementById('kick-people');
      const inf = info[cur?.id];
      if (!box) return;
      if (!inf) { box.innerHTML = `<p class="kp-head">Looking up the kickers…</p>`; return; }
      if (!inf.kickers || (!inf.kickers.home && !inf.kickers.away)) { box.innerHTML = `<p class="kp-head">Kicker records aren't available for this game yet.</p>`; return; }
      const c = conditions(cur), ms = c.windMph * MPH;
      // the ways a kick can go today: the two real end zones, or into and with the wind
      const dirs = c.indoor || c.noForecast || !c.windMph ? [{ tail: 0, cross: 0 }]
        : ends ? ends.map(h => parts(c, h)) : [{ tail: -ms, cross: 0 }, { tail: ms, cross: 0 }];
      const flights = dirs.map(d => ({ ...d, pts: fly({ F: c.F, elevFt: c.elevFt, wet: c.wet, tail: d.tail, cross: d.cross, maxYd: 75 }) }));
      const est = (k, yd2) => {
        const ps = flights.map(f => chance(k.career, yd2, NORMAL / Math.max(20, rangeOf(f.pts)), driftAt(f.pts, yd2)));
        return { avg: ps.reduce((a2, p2) => a2 + p2, 0) / ps.length, lo: Math.min(...ps), hi: Math.max(...ps) };
      };
      const ranges = flights.map(f => rangeOf(f.pts));
      // the kick on screen right now
      const p = paths();
      const nowFactor = NORMAL / Math.max(20, rangeOf(p.today)), nowDrift = driftAt(p.today, yd);
      const s = cur.live ? cur.situation : null;
      const card = side => {
        const k = inf.kickers[side]; if (!k) return '';
        const on = s?.poss && s.poss === cur[side].abbr;
        const now = chance(k.career, yd, nowFactor, nowDrift);
        const rows = [30, 40, 50, 55].map(d => {
          const e = est(k, d), calm = chance(k.career, d, 1, 0);
          const spread = e.hi - e.lo > 0.06 ? `<small>${pct(e.lo)}–${pct(e.hi)}</small>` : '';
          return `<tr><th>${d} yd</th><td class="kp-today"><b>${pct(e.avg)}</b>${spread}</td><td>${pct(calm)}</td></tr>`;
        }).join('');
        const bucketRows = (k.career?.buckets || []).filter(b2 => b2.att).map(b2 => `<span>${b2.hi >= 99 ? `${b2.lo}+` : `${b2.lo}–${b2.hi}`}: <b>${b2.made}/${b2.att}</b></span>`).join('');
        return `<div class="kp${on ? ' on' : ''}">
          <div class="kp-top">${logo(cur[side])}<span class="kp-main"><b>${esc(k.name)}</b><small>${esc(cur[side].name)} kicker${on ? ' · has the ball' : ''}</small></span>
            <span class="kp-p"><b>${pct(now)}</b><small>from ${yd}, ${esc(dirLabel() || 'today')}</small></span></div>
          <p class="kp-career">${esc(careerLine(k.career))}</p>
          ${bucketRows ? `<div class="kp-buckets">${bucketRows}</div>` : ''}
          <table class="kp-table"><thead><tr><th></th><th>Today</th><th>Calm day</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="kp-range">Estimated range today: <b>${Math.min(...ranges) === Math.max(...ranges) ? `${ranges[0]} yd` : `${Math.min(...ranges)}–${Math.max(...ranges)} yd`}</b>${k.career?.long ? ` (career long ${k.career.long})` : ''}</p>
        </div>`;
      };
      box.innerHTML = `<p class="kp-head">The kickers${c.indoor ? ' (indoors)' : flights.length > 1 ? ': today is the average of both directions, with the range between them' : ''}</p>${card('away')}${card('home')}`;
    }
    const dirLabel = () => { const c = cur && conditions(cur); if (c && (c.indoor || c.noForecast || !c.windMph)) return ''; return dirLabel2(); };
    const dirLabel2 = () => dir === 'head' ? 'into the wind' : dir === 'tail' ? 'with the wind' : dir === 'cross' ? 'in a crosswind' : ends ? `toward the ${endName(ends[+dir.slice(1)])}` : '';

    function paths() {
      const c = conditions(cur), ms = c.windMph * MPH;
      let tail = 0, cross = 0;
      if (dir === 'head') tail = -ms; else if (dir === 'tail') tail = ms; else if (dir === 'cross') cross = ms;
      else if (ends) { const p = parts(c, ends[+dir.slice(1)]); tail = p.tail; cross = p.cross; }
      const opt = { F: c.F, elevFt: c.elevFt, wet: c.wet, tail, cross, maxYd: Math.max(yd + 6, 40) };
      return { today: fly(opt), calm: fly({ maxYd: opt.maxYd }), c, tail, cross };
    }
    function result(pts) {
      const h = heightAt(pts, yd);
      if (h < BAR) return { good: false, text: h < 0 ? 'Short. It never got there.' : `Short. Under the crossbar by ${((BAR - h) * 3.28).toFixed(0)} ft.` };
      const z = driftAt(pts, yd);
      if (Math.abs(z) > 9.25) return { good: false, text: `No good. Wide ${z > 0 ? 'right' : 'left'} by ${(Math.abs(z) - 9.25).toFixed(0)} ft.` };
      return { good: true, text: Math.abs(z) > 3 ? `Good! Drifted ${Math.abs(z).toFixed(0)} ft but stayed inside.` : `Good! Cleared the bar by ${((h - BAR) * 3.28).toFixed(0)} ft.` };
    }

    // side view, or overhead to see the sideways drift
    function draw(pp, upto, ballT) {
      const svg = document.querySelector('#kicker .kick-svg');
      if (!svg || !cur) return;
      const W = 340, H = 190, L = 18, Rt = 14, top = 14, ground = 160;
      const span = Math.max(yd + 8, 40);
      const X = v => L + v / span * (W - L - Rt);
      const p = pp || paths();
      const mph = Math.round(Math.hypot(p.tail, p.cross) / MPH);
      const tailMph = Math.round(p.tail / MPH), crossMph = Math.round(p.cross / MPH);
      const overhead = view === 'top' || dir === 'cross';
      let body = '';
      const n = upto == null ? p.today.length : upto;
      const b = p.today[Math.min(n, p.today.length) - 1];
      if (!overhead) {
        const maxH = Math.max(12, ...p.calm.map(q => q[1]), ...p.today.map(q => q[1])) * 1.18;
        const Y = m => ground - Math.max(0, m) / maxH * (ground - top);
        const line = (pts, k) => pts.slice(0, k).map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join('');
        for (let v = 10; v < span; v += 10) body += `<line x1="${X(v)}" y1="${ground}" x2="${X(v)}" y2="${ground + 8}" class="k-yard"/><text x="${X(v)}" y="${ground + 22}" class="k-yd">${v}</text>`;
        body += `<line x1="0" y1="${ground}" x2="${W}" y2="${ground}" class="k-ground"/>`;
        const gx = X(yd);
        body += `<g class="k-post"><line x1="${gx}" y1="${ground}" x2="${gx}" y2="${Y(BAR)}"/><line x1="${gx - 4}" y1="${Y(BAR)}" x2="${gx + 4}" y2="${Y(BAR)}"/><line x1="${gx}" y1="${Y(BAR)}" x2="${gx}" y2="${Y(BAR + 9)}"/></g>`;
        body += `<path d="${line(p.calm, p.calm.length)}" class="k-calm"/><path d="${line(p.today, n)}" class="k-today" style="stroke:${C1}"/>`;
        if (b) body += `<g transform="translate(${X(b[0]).toFixed(1)} ${Y(b[1]).toFixed(1)}) rotate(${(ballT * 900) % 360})"><ellipse rx="6" ry="3.8" class="k-ball"/><path d="M-2.5 0h5" class="k-lace"/></g>`;
        if (Math.abs(tailMph) >= 1) {
          const right = tailMph > 0;
          body += `<g class="k-wind">${[0.2, 0.5, 0.8].map((f, i) => `<g transform="translate(${W * f} ${top + 10 + (i % 2) * 10})"><path d="${right ? 'M-14 0H10M5 -4L10 0L5 4' : 'M14 0H-10M-5 -4L-10 0L-5 4'}" class="k-wind-a" style="animation-delay:${i * -0.3}s"/></g>`).join('')}</g>`;
        }
        body += `<text x="${W - 6}" y="${top + 4}" class="k-wind-t">${mph ? `${Math.abs(tailMph)} mph ${tailMph > 0 ? 'tailwind' : tailMph < 0 ? 'headwind' : ''}${Math.abs(crossMph) >= 2 ? `, ${Math.abs(crossMph)} across` : ''}` : 'Calm'}</text>`;
      } else {
        const mid = 95, ftScale = 3.2, Z = ft => mid + ft * ftScale;
        const line = (pts, k) => pts.slice(0, k).filter(([, y]) => y >= -0.1).map(([x, , z], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Z(z).toFixed(1)}`).join('');
        for (let v = 10; v < span; v += 10) body += `<line x1="${X(v)}" y1="20" x2="${X(v)}" y2="170" class="k-yardline"/><text x="${X(v)}" y="184" class="k-yd">${v}</text>`;
        const gx = X(yd);
        body += `<g class="k-post"><line x1="${gx}" y1="${Z(-9.25)}" x2="${gx}" y2="${Z(9.25)}"/><circle cx="${gx}" cy="${Z(-9.25)}" r="3"/><circle cx="${gx}" cy="${Z(9.25)}" r="3"/></g>`;
        body += `<path d="${line(p.calm, p.calm.length)}" class="k-calm"/><path d="${line(p.today, n)}" class="k-today" style="stroke:${C1}"/>`;
        if (b && b[1] >= 0) body += `<g transform="translate(${X(b[0]).toFixed(1)} ${Z(b[2]).toFixed(1)}) rotate(${(ballT * 900) % 360})"><ellipse rx="${4 + Math.min(4, b[1] / 4)}" ry="${2.6 + Math.min(2.6, b[1] / 6)}" class="k-ball"/></g>`;
        if (Math.abs(crossMph) >= 1) body += `<g class="k-wind">${[0.25, 0.55, 0.85].map((f, i) => `<g transform="translate(${W * f} 30) rotate(${crossMph > 0 ? 0 : 180})"><path d="M0 -10V12M-4 7L0 12L4 7" class="k-wind-a v" style="animation-delay:${i * -0.3}s"/></g>`).join('')}</g>`;
        body += `<text x="${W - 6}" y="14" class="k-wind-t">${Math.abs(crossMph) >= 1 ? `${Math.abs(crossMph)} mph crosswind from the ${crossMph > 0 ? 'left' : 'right'}` : 'No crosswind'}</text><text x="${L}" y="14" class="k-wind-t start">Overhead view</text>`;
      }
      svg.innerHTML = body;
    }
    function play(instant) {
      if (!cur) return;
      stop();
      const p = paths();
      const res = result(p.today);
      const out = document.querySelector('#kicker .kick-result');
      if (instant || REDUCED) { draw(p, null, 0); if (out) { out.textContent = res.text; out.className = 'kick-result show ' + (res.good ? 'good' : 'miss'); } return; }
      if (out) out.className = 'kick-result';
      const total = p.today.length, dur = 1800, t0 = performance.now();
      Sound.whoosh();
      const step = now => {
        const k = Math.min(1, (now - t0) / dur);
        draw(p, Math.max(2, Math.round(total * k)), k);
        if (k < 1) raf = requestAnimationFrame(step);
        else if (out) { out.textContent = res.text; out.className = 'kick-result show ' + (res.good ? 'good' : 'miss'); if (res.good && navigator.vibrate) navigator.vibrate(20); }
      };
      raf = requestAnimationFrame(step);
    }
    return { section, mount, stop, refresh, fly };
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
      if (!cv || !base) return;
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
      src.start(t); lfo.start(t);
      nodes = { src, lp, crowd, lfo };
      set(level, true);
      schedule();
    }
    function set(level, now) {
      if (!nodes || !ctx) return;
      const t = ctx.currentTime;
      // heavier snow: quieter, more muffled crowd
      nodes.lp.frequency.setTargetAtTime(700 - level * 380, t, now ? 0.01 : 1.5);
      nodes.crowd.gain.setTargetAtTime(0.055 - level * 0.015, t, now ? 0.4 : 2);
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
      setTimeout(() => { try { n.src.stop(); n.lfo.stop(); } catch (e) {} }, 1500);
    }
    // level 0..1 (null = off). Plays only with sound effects on, in a snow game's view.
    function level(l) {
      want = l;
      if (l == null || !store.get('sound', false) || !GameView.isOpen()) { if (nodes) stop(); return; }
      if (!nodes) start(l); else set(l);
    }
    return { level, stop };
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
  load();
})();
