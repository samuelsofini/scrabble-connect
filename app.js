const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
const $ = id => document.getElementById(id);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
let signup = false, me = null, profs = {}, games = [], gp = [], online = new Set(), sel = new Set();
let sub = 'chat', myRack = [], pend = [], selIdx = null;
let tab = 'chat', gid = null, cur = { box: null, g: null }, chans = [];
const name = id => (profs[id] && profs[id].username) || 'Joueur';
const ICON = { joined: '✅', invited: '⏳', declined: '❌' };
const STATUS = { waiting: 'En attente de joueurs', active: 'En cours', finished: 'Terminée' };

/* ---------- Connexion ---------- */
$('toggle').onclick = () => {
  signup = !signup;
  $('username').style.display = signup ? 'block' : 'none';
  $('go').textContent = signup ? 'Créer mon compte' : 'Se connecter';
  $('toggle').textContent = signup ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? Créer un compte';
  $('err').textContent = '';
};
$('go').onclick = async () => {
  $('err').textContent = '';
  const email = $('email').value.trim(), password = $('password').value;
  let res;
  if (signup) {
    const username = $('username').value.trim();
    if (username.length < 3 || username.length > 20) return $('err').textContent = 'Pseudo : 3 à 20 caractères.';
    res = await sb.auth.signUp({ email, password, options: { data: { username } } });
    if (!res.error && !res.data.session) return $('err').textContent = 'Compte créé. Confirme ton e-mail puis connecte-toi.';
  } else res = await sb.auth.signInWithPassword({ email, password });
  if (res.error) $('err').textContent = res.error.message;
};
$('logout').onclick = () => sb.auth.signOut();
sb.auth.onAuthStateChange((_e, s) => { if (s) start(s.user); else stop(); });

/* ---------- Démarrage ---------- */
async function start(u) {
  if (me && me.id === u.id) return;
  me = u;
  $('auth').style.display = 'none'; $('app').style.display = 'flex';
  await loadProfs(); await loadAll();
  $('me').textContent = name(me.id);
  setView('chat');
  const refresh = async () => { await loadAll(); renderLists(); if (gid) renderGame(); };
  chans.push(
    sb.channel('db')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async p => {
        if (!profs[p.new.user_id]) await loadProfs();
        if (p.new.game_id === cur.g) addMsg(cur.box, p.new);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, refresh)
      .subscribe()
  );
  const lobby = sb.channel('lobby', { config: { presence: { key: me.id } } });
  lobby.on('presence', { event: 'sync' }, () => { online = new Set(Object.keys(lobby.presenceState())); renderPlayers(); })
    .subscribe(s => { if (s === 'SUBSCRIBED') lobby.track({ t: Date.now() }); });
  chans.push(lobby);
}
function stop() {
  me = null; chans.forEach(c => sb.removeChannel(c)); chans = [];
  $('app').style.display = 'none'; $('auth').style.display = 'block';
}
async function loadProfs() {
  const { data } = await sb.from('profiles').select('id,username');
  (data || []).forEach(p => profs[p.id] = p);
}
async function loadAll() {
  const [g, p] = await Promise.all([
    sb.from('games').select('*').order('created_at', { ascending: false }),
    sb.from('game_players').select('*')
  ]);
  games = g.data || []; gp = p.data || [];
}

/* ---------- Navigation ---------- */
function setView(t, g = null) {
  tab = t; gid = g;
  $('v-chat').hidden = !(t === 'chat' && !g);
  $('v-games').hidden = !(t === 'games' && !g);
  $('v-players').hidden = t !== 'players';
  $('v-game').hidden = !g;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  if (t === 'chat' && !g) openChat($('v-chat'), null);
  if (g) {
    myRack = []; pend = []; selIdx = null;
    const gm = games.find(x => x.id === g);
    sub = gm && gm.status !== 'waiting' ? 'board' : 'chat';
    openChat($('gMsgs'), g); renderGame();
  }
  showSub();
  renderLists();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => setView(b.dataset.t));

function showSub() {
  const inG = !!gid;
  $('gBoard').hidden = !(inG && sub === 'board');
  $('gMsgs').hidden = !(inG && sub === 'chat');
  $('send').style.display = ((tab === 'chat' && !inG) || (inG && sub === 'chat')) ? 'flex' : 'none';
}

/* ---------- Chat (général ou d'une partie) ---------- */
async function openChat(box, g) {
  cur = { box, g }; box.innerHTML = '';
  let q = sb.from('messages').select('*').order('created_at', { ascending: false }).limit(50);
  q = g ? q.eq('game_id', g) : q.is('game_id', null);
  const { data } = await q;
  if (cur.box !== box) return;
  if ((data || []).some(m => !profs[m.user_id])) await loadProfs();
  (data || []).reverse().forEach(m => addMsg(box, m));
}
function addMsg(box, m) {
  const d = el('div', 'm' + (m.user_id === me.id ? ' me' : ''));
  const t = new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  d.append(el('span', 'u', name(m.user_id)), el('small', '', ' ' + t), el('div', '', m.content));
  box.appendChild(d); box.scrollTop = box.scrollHeight;
}
$('send').onsubmit = async e => {
  e.preventDefault();
  const content = $('text').value.trim();
  if (!content) return;
  $('text').value = '';
  const { error } = await sb.from('messages').insert({ user_id: me.id, content, game_id: cur.g });
  if (error) alert(error.message);
};

/* ---------- Listes ---------- */
function renderLists() { renderGames(); renderPlayers(); }

function renderGames() {
  const inv = gp.filter(x => x.user_id === me.id && x.status === 'invited').length;
  $('badge').textContent = inv; $('badge').hidden = !inv;
  const box = $('v-games'); box.innerHTML = '';
  box.append(el('h2', '', 'Mes parties'));
  if (!games.length) box.append(el('div', 'sub', 'Aucune partie. Va dans Joueurs pour défier des amis.'));
  games.forEach(g => {
    const ps = gp.filter(x => x.game_id === g.id), mine = ps.find(x => x.user_id === me.id);
    const c = el('div', 'card'), r = el('div', 'row');
    r.append(el('b', '', 'Partie de ' + name(g.created_by)));
    if (mine && mine.status === 'invited') r.append(el('span', 'tag', 'Invitation'));
    c.append(r, el('div', 'sub', ps.map(p => ICON[p.status] + ' ' + name(p.user_id)).join('  ')),
      el('div', 'sub', STATUS[g.status] + ' · ' + g.max_players + ' joueurs'));
    c.onclick = () => setView('games', g.id);
    box.append(c);
  });
}

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
    const b = el('button', '', 'Défier ' + sel.size + ' joueur' + (sel.size > 1 ? 's' : '') + ' (partie à ' + (sel.size + 1) + ')');
    b.style.cssText = 'width:100%;position:sticky;bottom:0;margin-top:8px';
    b.onclick = createGame; box.append(b);
  }
}

async function createGame() {
  const { data: g, error } = await sb.from('games').insert({ created_by: me.id, max_players: sel.size + 1 }).select().single();
  if (error) return alert(error.message);
  const rows = [{ game_id: g.id, user_id: me.id, status: 'joined' }, ...[...sel].map(u => ({ game_id: g.id, user_id: u, status: 'invited' }))];
  const r = await sb.from('game_players').insert(rows);
  if (r.error) return alert(r.error.message);
  sel.clear(); await loadAll(); setView('games', g.id);
}

/* ---------- Détail d'une partie ---------- */
function renderGame() {
  const g = games.find(x => x.id === gid);
  if (!g) return setView('games');
  const ps = gp.filter(x => x.game_id === g.id), mine = ps.find(x => x.user_id === me.id);
  const box = $('gInfo'); box.innerHTML = '';
  const top = el('div', 'row'), back = el('button', 'ghost', '← Retour');
  back.onclick = () => setView('games');
  top.append(back, el('span', 'sub', STATUS[g.status]));
  box.append(top, el('h2', '', 'Partie de ' + name(g.created_by)));
  ps.forEach(p => box.append(el('div', 'sub', (g.status !== 'waiting' && p.status === 'joined'
    ? (g.status === 'active' && p.seat === g.current_seat ? '▶ ' : '• ') + name(p.user_id) + ' : ' + p.score + ' pts'
    : ICON[p.status] + ' ' + name(p.user_id)) + (p.user_id === g.created_by ? ' (créateur)' : ''))));
  if (g.status === 'waiting') box.append(el('div', 'sub', 'Le créateur lance la partie quand au moins 2 joueurs ont accepté.'));
  const b = el('div', 'btns');
  if (mine && mine.status === 'invited') {
    const ok = el('button', '', 'Accepter'), no = el('button', 'red', 'Refuser');
    ok.onclick = () => answer('joined'); no.onclick = () => answer('declined');
    b.append(ok, no);
  }
  if (g.created_by === me.id && g.status === 'waiting') {
    const del = el('button', 'red', 'Supprimer la partie');
    del.onclick = async () => {
      if (!confirm('Supprimer cette partie ?')) return;
      const { error } = await sb.from('games').delete().eq('id', g.id);
      if (error) return alert(error.message);
      await loadAll(); setView('games');
    };
    b.append(del);
  }
  if (b.children.length) box.append(b);
  if (g.created_by === me.id && g.status === 'waiting') {
    const nj = ps.filter(p => p.status === 'joined').length;
    const st = el('button', '', nj >= 2 ? 'Lancer la partie (' + nj + ' joueurs)' : 'En attente d’au moins 2 joueurs');
    st.disabled = nj < 2; st.style.cssText = 'width:100%;margin-top:10px';
    st.onclick = async () => {
      const { error } = await sb.rpc('start_game', { p_game: g.id });
      if (error) return alert(error.message);
      await loadAll(); setView('games', g.id);
    };
    box.append(st);
  }
  if (g.status !== 'waiting') {
    const tb = el('div', 'btns'), a = el('button', sub === 'board' ? '' : 'ghost', '🎲 Plateau'), cb = el('button', sub === 'chat' ? '' : 'ghost', '💬 Chat');
    a.onclick = () => { sub = 'board'; showSub(); renderGame(); };
    cb.onclick = () => { sub = 'chat'; showSub(); renderGame(); };
    tb.append(a, cb); box.append(tb);
    loadRack().then(renderBoard);
  }
}

/* ---------- Plateau ---------- */
const PREM = {}, VAL = { A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:10,L:1,M:2,N:1,O:1,P:3,Q:8,R:1,S:1,T:1,U:1,V:4,W:10,X:10,Y:10,Z:10 };
const setP = (t, a) => a.forEach(([r, c]) => PREM[r + ',' + c] = t);
setP('TW', [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]]);
setP('DW', [[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],[13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10],[7,7]]);
setP('TL', [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]]);
setP('DL', [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]]);

async function loadRack() {
  const { data } = await sb.from('player_racks').select('rack').eq('game_id', gid).eq('user_id', me.id).maybeSingle();
  const r = data ? data.rack : [];
  if (JSON.stringify(r) !== JSON.stringify(myRack)) { pend = []; selIdx = null; }
  myRack = r;
}

function renderBoard() {
  const g = games.find(x => x.id === gid), box = $('gBoard');
  if (!g || g.status === 'waiting') return;
  box.innerHTML = '';
  const ps = gp.filter(x => x.game_id === g.id && x.status === 'joined').sort((a, b) => a.seat - b.seat);
  const cp = ps.find(p => p.seat === g.current_seat);
  const myTurn = g.status === 'active' && cp && cp.user_id === me.id;
  const info = el('div', 'sub');
  if (g.status === 'finished') {
    const w = ps.slice().sort((a, b) => b.score - a.score)[0];
    info.textContent = '🏆 Partie terminée. Vainqueur : ' + name(w.user_id) + ' (' + w.score + ' pts)';
  } else info.textContent = (myTurn ? '👉 À toi de jouer !' : 'Tour de ' + (cp ? name(cp.user_id) : '…')) + ' · Sac : ' + g.bag_count;
  box.append(info);

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
      if (pd) { pend = pend.filter(p => p !== pd); renderBoard(); }
      else if (!t && selIdx !== null && myTurn) placeTile(r, c);
    };
    grid.append(cell);
  }
  box.append(grid);

  const used = new Set(pend.map(p => p.ri)), rack = el('div', 'rack');
  myRack.forEach((l, i) => {
    if (used.has(i)) return;
    const b = el('button', 'rk' + (selIdx === i ? ' on' : ''), l === '?' ? '' : l);
    if (l === '?') b.textContent = '★';
    b.onclick = () => { selIdx = selIdx === i ? null : i; renderBoard(); };
    rack.append(b);
  });
  box.append(rack);

  if (g.status === 'active' && ps.some(p => p.user_id === me.id)) {
    const row = el('div', 'btns'), ok = el('button', '', 'Valider'), un = el('button', 'ghost', 'Annuler'),
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
  }
}
function placeTile(r, c) {
  let l = myRack[selIdx], b = false;
  if (l === '?') {
    const x = (prompt('Quelle lettre pour le joker ? (A à Z)') || '').trim().toUpperCase();
    if (!/^[A-Z]$/.test(x)) return;
    l = x; b = true;
  }
  pend.push({ r, c, l, b, ri: selIdx }); selIdx = null; renderBoard();
}
async function answer(status) {
  const { error } = await sb.from('game_players').update({ status }).eq('game_id', gid).eq('user_id', me.id);
  if (error) return alert(error.message);
  await loadAll(); renderGame(); renderLists();
}

/* ---------- Démarrage + PWA ---------- */
sb.auth.getSession().then(({ data }) => { if (data.session) start(data.session.user); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});