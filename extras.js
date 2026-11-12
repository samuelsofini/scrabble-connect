/* Bloc 4 : échange de lettres, abandon, limite de temps (chargé après app.js) */
ICON.resigned = '🏳️';
let exchMode = false, exchSel = new Set(), timerId = null, claimAt = 0, tl = 0;
const LIMITS = [['Sans limite de temps', 0], ['2 min par coup', 120], ['10 min par coup', 600], ['1 h par coup', 3600], ['24 h par coup', 86400]];
const fmt = s => s >= 3600 ? Math.floor(s / 3600) + ' h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ' min'
  : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

function renderPlayers() {
  const box = $('v-players'); box.innerHTML = '';
  box.append(el('h2', '', 'Joueurs'));
  const list = Object.values(profs).filter(p => p.id !== me.id)
    .sort((a, b) => (online.has(b.id) - online.has(a.id)) || a.username.localeCompare(b.username));
  if (!list.length) box.append(el('div', 'sub', 'Aucun autre joueur pour l’instant. Invite tes amis !'));
  list.forEach(p => {
    const c = el('div', 'card' + (sel.has(p.id) ? ' sel' : '')), r = el('div', 'row');
    const l = el('span'); l.append(el('span', 'dot' + (online.has(p.id) ? ' on' : '')), p.username);
    r.append(l, el('span', 'sub', sel.has(p.id) ? '✔ Choisi' : (online.has(p.id) ? 'En ligne' : 'Hors ligne')));
    c.append(r);
    c.onclick = () => { if (sel.has(p.id)) sel.delete(p.id); else if (sel.size < 3) sel.add(p.id); renderPlayers(); };
    box.append(c);
  });
  if (sel.size) {
    const s = el('select');
    LIMITS.forEach(([t, v]) => { const o = el('option', '', t); o.value = v; s.append(o); });
    s.value = tl; s.onchange = () => tl = +s.value;
    s.style.cssText = 'width:100%;padding:12px;margin-top:8px;border-radius:10px;background:var(--card);color:var(--txt);border:1px solid var(--line);font-size:16px';
    const b = el('button', '', 'Défier ' + sel.size + ' joueur' + (sel.size > 1 ? 's' : '') + ' (partie à ' + (sel.size + 1) + ')');
    b.style.cssText = 'width:100%;margin-top:8px';
    b.onclick = createGame; box.append(s, b);
  }
}

async function createGame() {
  const { data: g, error } = await sb.from('games').insert({ created_by: me.id, max_players: sel.size + 1, turn_limit: tl || null }).select().single();
  if (error) return alert(error.message);
  const rows = [{ game_id: g.id, user_id: me.id, status: 'joined' }, ...[...sel].map(u => ({ game_id: g.id, user_id: u, status: 'invited' }))];
  const r = await sb.from('game_players').insert(rows);
  if (r.error) return alert(r.error.message);
  sel.clear(); await loadAll(); setView('games', g.id);
}

function startTimer(g, tm, canClaim) {
  const end = new Date(g.turn_started_at).getTime() + g.turn_limit * 1000;
  const tick = () => {
    if (!gid || sub !== 'board' || !tm.isConnected) return clearInterval(timerId);
    const left = Math.ceil((end - Date.now()) / 1000);
    tm.textContent = left > 0 ? '⏱ Il reste ' + fmt(left) : '⏱ Temps écoulé…';
    if (left <= 0 && canClaim && Date.now() - claimAt > 4000) {
      claimAt = Date.now();
      sb.rpc('claim_timeout', { p_game: g.id }).then(async () => { await loadAll(); renderGame(); });
    }
  };
  tick(); timerId = setInterval(tick, 1000);
}

function renderBoard() {
  const g = games.find(x => x.id === gid), box = $('gBoard');
  if (!g || g.status === 'waiting') return;
  clearInterval(timerId);
  box.innerHTML = '';
  const ps = gp.filter(x => x.game_id === g.id && x.status === 'joined').sort((a, b) => a.seat - b.seat);
  const cp = ps.find(p => p.seat === g.current_seat);
  const imIn = ps.some(p => p.user_id === me.id);
  const myTurn = g.status === 'active' && cp && cp.user_id === me.id;
  const info = el('div', 'sub');
  if (g.status === 'finished') {
    const w = ps.slice().sort((a, b) => b.score - a.score)[0];
    info.textContent = '🏆 Partie terminée. Vainqueur : ' + name(w.user_id) + ' (' + w.score + ' pts)';
  } else info.textContent = (myTurn ? '👉 À toi de jouer !' : 'Tour de ' + (cp ? name(cp.user_id) : '…')) + ' · Sac : ' + g.bag_count;
  box.append(info);
  if (g.status === 'active' && g.turn_limit) {
    const tm = el('div', 'sub'); box.append(tm); startTimer(g, tm, imIn);
  }

  const grid = el('div', 'grid');
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    const key = r + ',' + c, t = g.board[key], pd = pend.find(p => p.r === r && p.c === c), cell = el('div', 'cell');
    const x = t || pd;
    if (x) {
      cell.className = 'cell tile' + (pd ? ' pend' : '') + (x.b ? ' blank' : '');
      cell.textContent = x.l;
      if (!x.b) cell.append(el('sub', '', VAL[x.l]));
    } else if (PREM[key]) { cell.classList.add('p-' + PREM[key]); cell.textContent = key === '7,7' ? '★' : PREM[key]; }
    cell.onclick = () => {
      if (exchMode) return;
      if (pd) { pend = pend.filter(p => p !== pd); renderBoard(); }
      else if (!t && selIdx !== null && myTurn) placeTile(r, c);
    };
    grid.append(cell);
  }
  box.append(grid);

  const used = new Set(pend.map(p => p.ri)), rack = el('div', 'rack');
  myRack.forEach((l, i) => {
    if (used.has(i)) return;
    const on = exchMode ? exchSel.has(i) : selIdx === i;
    const b = el('button', 'rk' + (on ? ' on' : ''), l === '?' ? '★' : l);
    b.onclick = () => {
      if (exchMode) { if (exchSel.has(i)) exchSel.delete(i); else exchSel.add(i); }
      else selIdx = selIdx === i ? null : i;
      renderBoard();
    };
    rack.append(b);
  });
  box.append(rack);

  if (g.status === 'active' && imIn) {
    const row = el('div', 'btns');
    if (exchMode) {
      const ex = el('button', '', 'Échanger (' + exchSel.size + ')'), no = el('button', 'ghost', 'Annuler');
      box.append(el('div', 'sub', 'Touche les lettres à échanger.'));
      ex.disabled = !exchSel.size;
      ex.onclick = async () => {
        const letters = [...exchSel].map(i => myRack[i]);
        const { error } = await sb.rpc('exchange_tiles', { p_game: g.id, p_letters: letters });
        if (error) return alert(error.message);
        exchMode = false; exchSel.clear(); await loadAll(); await loadRack(); renderGame();
      };
      no.onclick = () => { exchMode = false; exchSel.clear(); renderBoard(); };
      row.append(ex, no); box.append(row); return;
    }
    const ok = el('button', '', 'Valider'), un = el('button', 'ghost', 'Annuler'),
      ps2 = el('button', 'ghost', 'Passer'), sh = el('button', 'ghost', 'Mélanger');
    ok.disabled = !myTurn || !pend.length; ps2.disabled = !myTurn; un.disabled = !pend.length; sh.disabled = !!pend.length;
    ok.onclick = async () => {
      const { data, error } = await sb.rpc('play_move', { p_game: g.id, p_tiles: pend.map(({ r, c, l, b }) => ({ r, c, l, b })) });
      if (error) return alert(error.message);
      pend = []; selIdx = null; await loadAll(); await loadRack(); renderGame();
      alert('+' + data.points + ' pts : ' + data.words.join(', '));
    };
    un.onclick = () => { pend = []; selIdx = null; renderBoard(); };
    ps2.onclick = async () => {
      if (!confirm('Passer ton tour ?')) return;
      const { error } = await sb.rpc('pass_turn', { p_game: g.id });
      if (error) return alert(error.message);
      pend = []; await loadAll(); renderGame();
    };
    sh.onclick = () => { myRack = myRack.slice().sort(() => Math.random() - .5); renderBoard(); };
    row.append(ok, un, ps2, sh); box.append(row);

    const row2 = el('div', 'btns'), ex = el('button', 'ghost', 'Échanger'), ab = el('button', 'ghost', 'Abandonner');
    ex.disabled = !myTurn || !!pend.length || g.bag_count < 7;
    ex.onclick = () => { exchMode = true; exchSel.clear(); selIdx = null; renderBoard(); };
    ab.onclick = async () => {
      if (!confirm('Abandonner la partie ? Tu la perdras.')) return;
      const { error } = await sb.rpc('resign_game', { p_game: g.id });
      if (error) return alert(error.message);
      await loadAll(); renderGame();
    };
    row2.append(ex, ab); box.append(row2);
  }
}