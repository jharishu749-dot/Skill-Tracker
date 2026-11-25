const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DB_FILE = path.join(__dirname, 'data.json');

/* ---------- tiny JSON-file "database" (swap for a real DB later) ---------- */
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { return { users: {} }; }
}
function writeDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

/* ---------- app setup ---------- */
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

const validEmail = (e) => typeof e === 'string' && /^\S+@\S+\.\S+$/.test(e);
const sign = (email) => jwt.sign({ email }, SECRET, { expiresIn: '7d' });

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try { req.email = jwt.verify(token, SECRET).email; next(); }
  catch (e) { res.status(401).json({ error: 'Please sign in again.' }); }
}

/* ---------- health ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true }));

/* ---------- auth ---------- */
app.post('/api/register', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  const db = readDB();
  if (db.users[email]) return res.status(409).json({ error: 'That email is already registered.' });
  db.users[email] = { passwordHash: await bcrypt.hash(password, 10), data: {} };
  writeDB(db);
  res.json({ token: sign(email), email });
});

app.post('/api/login', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const user = readDB().users[email];
  const ok = user && await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Wrong email or password.' });
  res.json({ token: sign(email), email });
});

/* ---------- user data (links, semesters, logs, stats, friends...) ---------- */
const ARRAYS = ['links', 'sems', 'logs', 'comp', 'friends'];
const OTHERS = ['base', 'dsa', 'lc'];

app.get('/api/me', auth, (req, res) => {
  const user = readDB().users[req.email];
  if (!user) return res.status(401).json({ error: 'Account not found.' });
  res.json({ email: req.email, data: user.data });
});

app.put('/api/data', auth, (req, res) => {
  const body = req.body || {};
  const clean = {};
  for (const k of ARRAYS) if (Array.isArray(body[k])) clean[k] = body[k];
  for (const k of OTHERS) if (body[k] !== undefined) clean[k] = body[k];
  const db = readDB();
  if (!db.users[req.email]) return res.status(401).json({ error: 'Account not found.' });
  db.users[req.email].data = Object.assign({}, db.users[req.email].data, clean);
  // public summary that connected friends can see (numbers only)
  if (body.summary && typeof body.summary === 'object') {
    const nn = (v) => Math.max(0, Math.min(1000000, Math.floor(Number(v) || 0)));
    const s = body.summary;
    db.users[req.email].summary = { solved: nn(s.solved), cur: nn(s.cur), max: nn(s.max), rating: nn(s.rating), updated: new Date().toISOString().slice(0, 10) };
  }
  writeDB(db);
  res.json({ saved: true });
});

/* ---------- friends (requests must be accepted before stats are shared) ---------- */
const nameOf = (e) => e.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const without = (arr, x) => arr.filter((e) => e !== x);
const emailFrom = (req) => String((req.body || {}).email || '').trim().toLowerCase();
function social(u) { if (!u.social) u.social = { friends: [], incoming: [], outgoing: [] }; return u.social; }

app.get('/api/friends', auth, (req, res) => {
  const db = readDB(), s = social(db.users[req.email]);
  const info = (e) => ({ email: e, name: nameOf(e) });
  res.json({
    friends: s.friends.filter((e) => db.users[e]).map((e) => Object.assign(info(e), { summary: db.users[e].summary || null })),
    incoming: s.incoming.map(info),
    outgoing: s.outgoing.map(info)
  });
});

app.post('/api/friends/request', auth, (req, res) => {
  const target = emailFrom(req), db = readDB();
  if (!validEmail(target)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (target === req.email) return res.status(400).json({ error: 'That’s your own email.' });
  const other = db.users[target];
  if (!other) return res.status(404).json({ error: 'No account with that email yet. Ask them to sign up first.' });
  const a = social(db.users[req.email]), b = social(other);
  if (a.friends.includes(target)) return res.status(409).json({ error: 'You’re already connected.' });
  if (a.incoming.includes(target)) {            // they already asked you, so connect right away
    a.incoming = without(a.incoming, target); b.outgoing = without(b.outgoing, req.email);
    a.friends.push(target); b.friends.push(req.email);
    writeDB(db); return res.json({ status: 'connected' });
  }
  if (a.outgoing.includes(target)) return res.status(409).json({ error: 'Request already sent.' });
  a.outgoing.push(target); b.incoming.push(req.email);
  writeDB(db); res.json({ status: 'sent' });
});

app.post('/api/friends/accept', auth, (req, res) => {
  const target = emailFrom(req), db = readDB(), other = db.users[target];
  const a = social(db.users[req.email]);
  if (!other || !a.incoming.includes(target)) return res.status(404).json({ error: 'No such request.' });
  const b = social(other);
  a.incoming = without(a.incoming, target); b.outgoing = without(b.outgoing, req.email);
  if (!a.friends.includes(target)) a.friends.push(target);
  if (!b.friends.includes(req.email)) b.friends.push(req.email);
  writeDB(db); res.json({ status: 'connected' });
});

app.post('/api/friends/decline', auth, (req, res) => {      // reject a request sent to you
  const target = emailFrom(req), db = readDB();
  const a = social(db.users[req.email]);
  a.incoming = without(a.incoming, target);
  if (db.users[target]) { const b = social(db.users[target]); b.outgoing = without(b.outgoing, req.email); }
  writeDB(db); res.json({ ok: true });
});

app.post('/api/friends/cancel', auth, (req, res) => {       // withdraw a request you sent
  const target = emailFrom(req), db = readDB();
  const a = social(db.users[req.email]);
  a.outgoing = without(a.outgoing, target);
  if (db.users[target]) { const b = social(db.users[target]); b.incoming = without(b.incoming, req.email); }
  writeDB(db); res.json({ ok: true });
});

app.delete('/api/friends/:email', auth, (req, res) => {     // disconnect (both sides)
  const target = String(req.params.email || '').trim().toLowerCase(), db = readDB();
  const a = social(db.users[req.email]);
  a.friends = without(a.friends, target);
  if (db.users[target]) { const b = social(db.users[target]); b.friends = without(b.friends, req.email); }
  writeDB(db); res.json({ ok: true });
});

/* ---------- LeetCode proxy (unofficial GraphQL, cached 10 min) ---------- */
const cache = new Map();
const QUERY = `query p($username: String!) {
  matchedUser(username: $username) {
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    userCalendar { submissionCalendar }
  }
}`;

app.get('/api/leetcode/:username', async (req, res) => {
  const u = String(req.params.username || '').trim();
  if (!/^[\w-]{1,40}$/.test(u)) return res.status(400).json({ status: 'error', message: 'Invalid username.' });
  const hit = cache.get(u);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return res.json(hit.data);
  try {
    const r = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ query: QUERY, variables: { username: u } })
    });
    if (!r.ok) throw new Error('LeetCode answered with HTTP ' + r.status + '.');
    const j = await r.json();
    const m = j.data && j.data.matchedUser;
    if (!m) return res.status(404).json({ status: 'error', message: 'LeetCode user not found.' });
    const by = {};
    m.submitStatsGlobal.acSubmissionNum.forEach((x) => { by[x.difficulty] = x.count; });
    const out = {
      totalSolved: by.All || 0,
      easySolved: by.Easy || 0,
      mediumSolved: by.Medium || 0,
      hardSolved: by.Hard || 0,
      submissionCalendar: JSON.parse((m.userCalendar && m.userCalendar.submissionCalendar) || '{}')
    };
    cache.set(u, { t: Date.now(), data: out });
    res.json(out);
  } catch (e) {
    res.status(502).json({ status: 'error', message: e.message || 'Could not reach LeetCode.' });
  }
});

app.listen(PORT, () => console.log('Backend running on port ' + PORT));