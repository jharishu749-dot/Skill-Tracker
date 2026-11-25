(function () {
    /* ---------- storage (localStorage with in-memory fallback) ---------- */
    var mem = {};
    function get(k, d) { try { var v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } catch (e) { } return (k in mem) ? mem[k] : d; }
    function set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
    function del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { } }
    var $ = function (id) { return document.getElementById(id); };

    var user = null, links = [], sems = [], logs = [], base = 0, dsa = { easy: 0, medium: 0, hard: 0, topics: [] }, comp = [], friends = [], linked = [], incoming = [], outgoing = [], lc = { user: '', base: '', solved: 0, last: '' };

    /* ---------- date helpers (all local time) ---------- */
    function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }

    /* ---------- session / shell ---------- */
    function show(loggedIn) {
        $('login').classList.toggle('hidden', loggedIn);
        $('app').classList.toggle('hidden', !loggedIn);
    }
    /* ---------- backend connection ---------- */
    var API = 'http://localhost:4000';            // change to your deployed backend URL later
    var DEFAULT_LC = API + '/api/leetcode';
    var token = get('token', null);

    function api(path, method, body) {
        var opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
        if (token) opts.headers.Authorization = 'Bearer ' + token;
        if (body) opts.body = JSON.stringify(body);
        return fetch(API + path, opts).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) { var e = new Error(j.error || ('Server error ' + r.status)); e.status = r.status; throw e; }
                return j;
            });
        });
    }

    function hydrate(d) {
        d = d || {};
        links = d.links || []; sems = d.sems || []; logs = d.logs || []; base = d.base || 0;
        dsa = d.dsa || { easy: 0, medium: 0, hard: 0, topics: [] };
        comp = d.comp || []; friends = d.friends || [];
        lc = d.lc || { user: '', base: DEFAULT_LC, solved: 0, last: '' };
        if (!lc.base || /:3000\/?$/.test(lc.base)) lc.base = DEFAULT_LC;
    }
    // one-time import of data saved by the old browser-only version
    function localData(email) {
        var key = 'user:' + email + ':', d = {}, found = false;
        ['links', 'sems', 'logs', 'base', 'dsa', 'comp', 'friends', 'lc'].forEach(function (k) {
            var v = get(key + k, null); if (v !== null) { d[k] = v; found = true; }
        });
        return found ? d : null;
    }

    function load(d) {
        hydrate(d);
        $('lcUser').value = lc.user; $('lcBase').value = lc.base;
        $('lcStatus').textContent = lc.last ? 'Last synced: ' + lc.last : 'Not synced yet.';
        var n = user.email.split('@')[0].replace(/[._-]+/g, ' ');
        $('name').textContent = n.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        $('mail').textContent = user.email;
        $('avatar').textContent = n.charAt(0).toUpperCase();
        $('saveState').textContent = '';
        renderLinks(); renderSems(); renderActivity(); renderStats(); renderCompete(); switchTab('profile'); show(true);
        loadSocial(); save();
    }

    var saveTimer = null;
    function save() {
        if (!user) return;
        $('saveState').textContent = 'Saving…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            api('/api/data', 'PUT', { links: links, sems: sems, logs: logs, base: base, dsa: dsa, comp: comp, friends: friends, lc: lc, summary: mySummary() })
                .then(function () { $('saveState').textContent = 'Saved'; })
                .catch(function (err) {
                    if (err.status === 401) { signOut(); $('loginErr').textContent = 'Session expired. Please sign in again.'; }
                    else $('saveState').textContent = 'Not saved (server unreachable)';
                });
        }, 400);
    }

    /* ---------- sign in / sign up / sign out ---------- */
    function signOut() { del('session'); del('token'); token = null; user = null; linked = []; incoming = []; outgoing = []; show(false); }

    function authenticate(path) {
        var e = $('email').value.trim().toLowerCase(), p = $('pw').value;
        if (!/^\S+@\S+\.\S+$/.test(e)) { $('loginErr').textContent = 'Enter a valid email address.'; return; }
        if (p.length < 4) { $('loginErr').textContent = 'Password must be at least 4 characters.'; return; }
        $('loginErr').textContent = '';
        $('loginBtn').disabled = $('signupBtn').disabled = true;
        api(path, 'POST', { email: e, password: p })
            .then(function (res) {
                token = res.token; set('token', token);
                user = { email: res.email }; set('session', user); $('pw').value = '';
                return api('/api/me').then(function (me) {
                    var d = me.data || {}, migrated = false;
                    if (!Object.keys(d).length) { var old = localData(user.email); if (old) { d = old; migrated = true; } }
                    load(d); if (migrated) save();
                });
            })
            .catch(function (err) {
                $('loginErr').textContent = err instanceof TypeError ? 'Can’t reach the server at ' + API + '. Is it running?' : err.message;
            })
            .then(function () { $('loginBtn').disabled = $('signupBtn').disabled = false; });
    }
    $('loginBtn').onclick = function () { authenticate('/api/login'); };
    $('signupBtn').onclick = function () { authenticate('/api/register'); };
    ['email', 'pw'].forEach(function (id) { $(id).addEventListener('keydown', function (ev) { if (ev.key === 'Enter') $('loginBtn').click(); }); });
    $('logout').onclick = signOut;

    /* ---------- tabs ---------- */
    function switchTab(name) {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
        $('tab-profile').classList.toggle('hidden', name !== 'profile');
        $('tab-activity').classList.toggle('hidden', name !== 'activity');
        $('tab-stats').classList.toggle('hidden', name !== 'stats');
        if (name === 'activity') renderActivity();
        $('tab-compete').classList.toggle('hidden', name !== 'compete');
        if (name === 'stats') renderStats();
        if (name === 'compete') { renderCompete(); loadSocial(); }
    }
    document.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { switchTab(t.dataset.tab); }; });

    /* ---------- coding platform links ---------- */
    function renderLinks() {
        var ul = $('links'); ul.innerHTML = '';
        if (!links.length) { var p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No links yet. Add your first platform above.'; ul.appendChild(p); return; }
        links.forEach(function (l, i) {
            var li = document.createElement('li'), box = document.createElement('div');
            var a = document.createElement('a'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = l.name;
            var s = document.createElement('span'); s.className = 'url'; s.textContent = l.url;
            box.appendChild(a); box.appendChild(s);
            var x = document.createElement('button'); x.className = 'x'; x.setAttribute('aria-label', 'Remove ' + l.name); x.textContent = '×';
            x.onclick = function () { links.splice(i, 1); save(); renderLinks(); renderActivity(); };
            li.appendChild(box); li.appendChild(x); ul.appendChild(li);
        });
    }
    $('addLink').onclick = function () {
        var n = $('pName').value.trim(), u = $('pUrl').value.trim();
        if (!n || !u) { $('linkErr').textContent = 'Enter a platform name and a link.'; return; }
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        try { new URL(u); } catch (e) { $('linkErr').textContent = 'That link doesn’t look valid.'; return; }
        $('linkErr').textContent = '';
        links.push({ name: n, url: u }); save(); renderLinks(); renderActivity();
        $('pName').value = ''; $('pUrl').value = '';
    };

    /* ---------- academic record ---------- */
    var sel = $('sSem');
    for (var i = 1; i <= 8; i++) { var o = document.createElement('option'); o.value = i; o.textContent = 'Semester ' + i; sel.appendChild(o); }

    function renderSems() {
        var box = $('sems'); box.innerHTML = '';
        sems.sort(function (a, b) { return a.sem - b.sem; });
        if (!sems.length) { $('avgVal').textContent = '–'; $('avgLbl').textContent = 'Add a semester to see your average'; var p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No semesters saved yet.'; box.appendChild(p); return; }
        var sum = sems.reduce(function (t, s) { return t + s.cgpa; }, 0);
        $('avgVal').textContent = (sum / sems.length).toFixed(2);
        $('avgLbl').textContent = 'average across ' + sems.length + (sems.length === 1 ? ' semester' : ' semesters');
        sems.forEach(function (s, i) {
            var r = document.createElement('div'); r.className = 'sem';
            var l = document.createElement('span'); l.textContent = 'Sem ' + s.sem;
            var t = document.createElement('div'); t.className = 'track'; var f = document.createElement('div'); f.className = 'fill'; f.style.width = (s.cgpa * 10) + '%'; t.appendChild(f);
            var v = document.createElement('span'); v.className = 'val'; v.textContent = s.cgpa.toFixed(2);
            var x = document.createElement('button'); x.className = 'x'; x.setAttribute('aria-label', 'Remove semester ' + s.sem); x.textContent = '×';
            x.onclick = function () { sems.splice(i, 1); save(); renderSems(); };
            r.appendChild(l); r.appendChild(t); r.appendChild(v); r.appendChild(x); box.appendChild(r);
        });
    }
    $('addSem').onclick = function () {
        var n = parseInt(sel.value, 10), c = parseFloat($('sCg').value);
        if (isNaN(c) || c < 0 || c > 10) { $('semErr').textContent = 'Enter a CGPA between 0 and 10.'; return; }
        $('semErr').textContent = '';
        sems = sems.filter(function (s) { return s.sem !== n; });
        sems.push({ sem: n, cgpa: c }); save(); renderSems(); $('sCg').value = '';
        sel.value = Math.min(n + 1, 8);
    };

    /* ---------- activity: stats + heatmap ---------- */
    function dailyMap() {
        var m = {};
        logs.forEach(function (l) { m[l.date] = (m[l.date] || 0) + l.count; });
        return m;
    }
    function level(n) { return n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4; }

    function calcStreaks(m) {
        var today = new Date(); today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        // current streak: still alive if you solved today OR yesterday
        var d = m[fmt(today)] > 0 ? today : addDays(today, -1), cur = 0;
        while (m[fmt(d)] > 0) { cur++; d = addDays(d, -1); }
        // longest streak
        var keys = Object.keys(m).filter(function (k) { return m[k] > 0; }).sort(), max = 0, run = 0, prev = null;
        keys.forEach(function (k) {
            var dt = parse(k);
            run = (prev && fmt(addDays(prev, 1)) === k) ? run + 1 : 1;
            if (run > max) max = run;
            prev = dt;
        });
        return { cur: cur, max: max, days: keys.length };
    }

    function renderActivity() {
        var m = dailyMap(), st = calcStreaks(m);
        var total = totalSolved();
        var today = new Date(); today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        var yearStart = addDays(today, -364), yearSum = 0;
        Object.keys(m).forEach(function (k) { if (parse(k) >= yearStart) yearSum += m[k]; });
        $('stTotal').textContent = total; $('stCur').textContent = st.cur; $('stMax').textContent = st.max;
        $('stDays').textContent = st.days; $('stYear').textContent = yearSum;

        // heatmap: start on the Sunday on/before 52 weeks ago so rows = weekdays
        var start = addDays(today, -364 - today.getDay() + (today.getDay() === 0 ? 0 : 0));
        start = addDays(start, -start.getDay());
        var heat = $('heat'), months = $('months'); heat.innerHTML = ''; months.innerHTML = '';
        var lastMonth = -1, col = 0;
        for (var d = new Date(start); d <= today; d = addDays(d, 1)) {
            var key = fmt(d), n = m[key] || 0;
            var c = document.createElement('i'); c.className = 'c l' + level(n) + (key === fmt(today) ? ' today' : '');
            c.title = n + (n === 1 ? ' question' : ' questions') + ' on ' + d.toDateString();
            heat.appendChild(c);
            if (d.getDay() === 0) {
                col = Math.round((d - start) / 604800000);
                if (d.getMonth() !== lastMonth && d.getDate() <= 7) {
                    var s = document.createElement('span'); s.style.left = (col * 16) + 'px';
                    s.textContent = d.toLocaleString('en', { month: 'short' }); months.appendChild(s);
                    lastMonth = d.getMonth();
                }
            }
        }
        heat.parentNode.scrollLeft = heat.parentNode.scrollWidth;

        // platform dropdown (from the user's saved links)
        var ps = $('lPlat'), keep = ps.value; ps.innerHTML = '';
        links.map(function (l) { return l.name; }).concat(['Other']).forEach(function (name) {
            var o = document.createElement('option'); o.value = name; o.textContent = name; ps.appendChild(o);
        });
        if (keep) ps.value = keep;
        if (!$('lDate').value) $('lDate').value = fmt(today);
        $('lDate').max = fmt(today);
        if (base) $('base').value = base;

        // recent entries
        var ul = $('recent'); ul.innerHTML = '';
        var recent = logs.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; }).slice(0, 6);
        if (!recent.length) { var p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nothing logged yet.'; ul.appendChild(p); return; }
        recent.forEach(function (l) {
            var li = document.createElement('li'), box = document.createElement('div');
            var b = document.createElement('strong'); b.textContent = l.count + (l.count === 1 ? ' question' : ' questions');
            var s = document.createElement('span'); s.className = 'url'; s.textContent = l.plat + ' · ' + parse(l.date).toDateString();
            box.appendChild(b); box.appendChild(s);
            var x = document.createElement('button'); x.className = 'x'; x.setAttribute('aria-label', 'Delete entry'); x.textContent = '×';
            x.onclick = function () { logs = logs.filter(function (e) { return e.id !== l.id; }); save(); renderActivity(); };
            li.appendChild(box); li.appendChild(x); ul.appendChild(li);
        });
    }

    $('addLog').onclick = function () {
        var date = $('lDate').value, count = parseInt($('lCount').value, 10);
        if (!date) { $('logErr').textContent = 'Pick a date.'; return; }
        if (parse(date) > new Date()) { $('logErr').textContent = 'You can’t log a future date.'; return; }
        if (isNaN(count) || count < 1) { $('logErr').textContent = 'Enter at least 1 question.'; return; }
        $('logErr').textContent = '';
        logs.push({ id: Date.now(), date: date, plat: $('lPlat').value || 'Other', count: count });
        save(); renderActivity(); $('lCount').value = 1;
    };
    $('saveBase').onclick = function () {
        var v = parseInt($('base').value, 10);
        base = isNaN(v) || v < 0 ? 0 : v; save(); renderActivity();
    };

    /* ---------- stats: DSA + competitive ---------- */
    function num(id) { var v = parseInt($(id).value, 10); return isNaN(v) || v < 0 ? 0 : v; }

    function renderStats() {
        var tot = dsa.easy + dsa.medium + dsa.hard;
        $('dTotal').textContent = tot;
        ['easy', 'medium', 'hard'].forEach(function (k) {
            document.querySelector('.stack .' + k).style.width = tot ? (dsa[k] / tot * 100) + '%' : '0%';
        });
        $('dE').value = dsa.easy; $('dM').value = dsa.medium; $('dH').value = dsa.hard;

        var box = $('topicList'); box.innerHTML = '';
        var topics = dsa.topics.slice().sort(function (a, b) { return b.count - a.count; });
        if (!topics.length) { var p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No topics yet.'; box.appendChild(p); }
        var top = topics.length ? topics[0].count || 1 : 1;
        topics.forEach(function (t) {
            var r = document.createElement('div'); r.className = 'topic';
            var l = document.createElement('span'); l.textContent = t.name; l.title = t.name;
            var tr = document.createElement('div'); tr.className = 'track'; var f = document.createElement('div'); f.className = 'fill'; f.style.width = (t.count / top * 100) + '%'; tr.appendChild(f);
            var v = document.createElement('span'); v.className = 'val'; v.textContent = t.count;
            var x = document.createElement('button'); x.className = 'x'; x.setAttribute('aria-label', 'Remove ' + t.name); x.textContent = '×';
            x.onclick = function () { dsa.topics = dsa.topics.filter(function (e) { return e.name !== t.name; }); save(); renderStats(); };
            r.appendChild(l); r.appendChild(tr); r.appendChild(v); r.appendChild(x); box.appendChild(r);
        });

        var ul = $('compList'); ul.innerHTML = '';
        if (!comp.length) { var q = document.createElement('p'); q.className = 'empty'; q.textContent = 'No platform stats yet.'; ul.appendChild(q); return; }
        comp.forEach(function (c) {
            var li = document.createElement('li'), b = document.createElement('div');
            var n = document.createElement('strong'); n.textContent = c.plat;
            var d = document.createElement('span'); d.className = 'url';
            d.textContent = ['Peak ' + c.peak, c.contests + ' contests', c.rank].filter(Boolean).join(' · ');
            b.appendChild(n); b.appendChild(d);
            var rt = document.createElement('span'); rt.className = 'rate'; rt.textContent = c.rating;
            var x = document.createElement('button'); x.className = 'x'; x.setAttribute('aria-label', 'Remove ' + c.plat); x.textContent = '×';
            x.onclick = function () { comp = comp.filter(function (e) { return e.id !== c.id; }); save(); renderStats(); };
            li.appendChild(b); li.appendChild(rt); li.appendChild(x); ul.appendChild(li);
        });
    }

    $('saveDsa').onclick = function () { dsa.easy = num('dE'); dsa.medium = num('dM'); dsa.hard = num('dH'); save(); renderStats(); };
    $('addTopic').onclick = function () {
        var n = $('tName').value.trim(), c = parseInt($('tCount').value, 10);
        if (!n || isNaN(c) || c < 0) { $('topicErr').textContent = 'Enter a topic and how many you solved.'; return; }
        $('topicErr').textContent = '';
        dsa.topics = dsa.topics.filter(function (t) { return t.name.toLowerCase() !== n.toLowerCase(); });
        dsa.topics.push({ name: n, count: c }); save(); renderStats();
        $('tName').value = ''; $('tCount').value = '';
    };
    $('addComp').onclick = function () {
        var plat = $('cPlat').value.trim(), rating = parseInt($('cRating').value, 10);
        if (!plat || isNaN(rating) || rating < 0) { $('compErr').textContent = 'Enter a platform and your current rating.'; return; }
        $('compErr').textContent = '';
        var peak = Math.max(rating, num('cPeak'));
        comp = comp.filter(function (c) { return c.plat.toLowerCase() !== plat.toLowerCase(); });
        comp.push({ id: Date.now(), plat: plat, rating: rating, peak: peak, contests: num('cCont'), rank: $('cRank').value.trim() });
        save(); renderStats();
        ['cPlat', 'cRating', 'cPeak', 'cCont', 'cRank'].forEach(function (id) { $(id).value = ''; });
    };

    /* ---------- compete: leaderboard + head to head ---------- */
    var metric = 'score';
    var METRICS = { score: 'Overall score', solved: 'Total solved', cur: 'Current streak', max: 'Longest streak', rating: 'Top rating' };
    var KEYS = ['solved', 'cur', 'max', 'rating'];

    function mySummary() {
        var st = calcStreaks(dailyMap());
        return { solved: totalSolved(), cur: st.cur, max: st.max, rating: comp.reduce(function (t, c) { return Math.max(t, c.peak); }, 0) };
    }
    function people() {
        var all = [Object.assign({ me: true, id: 'me', name: 'You' }, mySummary())]
            .concat(linked.map(function (f) {
                var s = f.summary || {};
                return { id: 'u:' + f.email, email: f.email, linked: true, name: f.name, solved: s.solved || 0, cur: s.cur || 0, max: s.max || 0, rating: s.rating || 0 };
            })).concat(friends.map(function (f) { return { id: f.id, name: f.name, solved: f.solved, cur: f.cur, max: f.max, rating: f.rating }; }));
        var mx = {};
        KEYS.forEach(function (k) { mx[k] = Math.max.apply(null, all.map(function (p) { return p[k]; })); });
        all.forEach(function (p) {
            p.score = Math.round(KEYS.reduce(function (t, k) { return t + (mx[k] ? p[k] / mx[k] : 0); }, 0) / KEYS.length * 100);
        });
        return all;
    }
    function gapText(d) { return d > 0 ? 'You’re ' + d + ' behind' : d < 0 ? 'You’re ' + (-d) + ' ahead' : 'Tied with you'; }

    function renderCompete() {
        renderRequests();
        var all = people(), me = all[0];
        var sorted = all.slice().sort(function (a, b) { return b[metric] - a[metric] || (a.me ? -1 : b.me ? 1 : a.name.localeCompare(b.name)); });
        var pos = sorted.indexOf(me) + 1;

        var sm = $('cSummary');
        if (all.length === 1) sm.textContent = 'Add a friend to start comparing.';
        else {
            var parts = ['You’re #' + pos + ' of ' + all.length + ' by ' + METRICS[metric].toLowerCase() + '.'];
            var above = sorted[pos - 2], below = sorted[pos];
            if (above) { var da = above[metric] - me[metric]; parts.push(da > 0 ? da + ' behind ' + above.name + '.' : 'Tied with ' + above.name + '.'); }
            if (below) { var db = me[metric] - below[metric]; parts.push(db > 0 ? db + ' ahead of ' + below.name + '.' : 'Tied with ' + below.name + '.'); }
            sm.textContent = parts.join(' ');
        }

        var top = Math.max.apply(null, sorted.map(function (p) { return p[metric]; })) || 1;
        var box = $('board'); box.innerHTML = '';
        sorted.forEach(function (p, i) {
            var row = document.createElement('div'); row.className = 'lb-row' + (p.me ? ' me' : '');
            var ps = document.createElement('span'); ps.className = 'pos' + (i < 3 ? ' top' : ''); ps.textContent = i + 1;
            var mid = document.createElement('div');
            var nl = document.createElement('div'); nl.className = 'lb-name';
            var nm = document.createElement('strong'); nm.textContent = p.name; nl.appendChild(nm);
            if (p.linked) {
                var bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = 'linked'; nl.appendChild(bd);
                var xl = document.createElement('button'); xl.className = 'x'; xl.textContent = '×'; xl.setAttribute('aria-label', 'Disconnect from ' + p.name);
                xl.onclick = function () { if (confirm('Disconnect from ' + p.name + '?')) socialCall('/api/friends/' + encodeURIComponent(p.email), 'DELETE'); };
                nl.appendChild(xl);
            } else if (!p.me) {
                var ed = document.createElement('button'); ed.className = 'x'; ed.textContent = 'edit'; ed.setAttribute('aria-label', 'Edit ' + p.name);
                ed.onclick = function () {
                    $('manualBox').open = true; $('fName').value = p.name; $('fSolved').value = p.solved; $('fCur').value = p.cur; $('fMax').value = p.max; $('fRating').value = p.rating;
                    $('fName').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('fName').focus();
                };
                var x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove ' + p.name);
                x.onclick = function () { friends = friends.filter(function (f) { return f.id !== p.id; }); save(); renderCompete(); };
                nl.appendChild(ed); nl.appendChild(x);
            }
            var tr = document.createElement('div'); tr.className = 'track'; var f = document.createElement('div'); f.className = 'fill'; f.style.width = (p[metric] / top * 100) + '%'; tr.appendChild(f);
            var g = document.createElement('div'); g.className = 'lb-gap';
            if (p.me) g.textContent = 'That’s you';
            else { var d = p[metric] - me[metric]; g.textContent = gapText(d); g.className += d > 0 ? ' down' : d < 0 ? ' up' : ''; }
            mid.appendChild(nl); mid.appendChild(tr); mid.appendChild(g);
            var v = document.createElement('span'); v.className = 'lb-val'; v.textContent = p[metric];
            row.appendChild(ps); row.appendChild(mid); row.appendChild(v); box.appendChild(row);
        });

        // head to head
        var sel = $('h2hSel'), keep = sel.value; sel.innerHTML = '';
        all.slice(1).forEach(function (pp) { var o = document.createElement('option'); o.value = pp.id; o.textContent = pp.name; sel.appendChild(o); });
        if (keep) sel.value = keep;
        var wrap = $('h2h'); wrap.innerHTML = '';
        var other = all.filter(function (p) { return String(p.id) === sel.value; })[0];
        if (!other) { var e = document.createElement('p'); e.className = 'empty'; e.textContent = 'Add a friend to compare.'; wrap.appendChild(e); return; }
        var t = document.createElement('table'); t.className = 'h2h';
        t.innerHTML = '<thead><tr><th></th><th>You</th><th></th><th>Gap</th></tr></thead>';
        t.querySelector('th:nth-child(3)').textContent = other.name;
        var tb = document.createElement('tbody');
        ['solved', 'cur', 'max', 'rating', 'score'].forEach(function (k) {
            var tr2 = document.createElement('tr'), diff = me[k] - other[k];
            [[METRICS[k], ''], [me[k], diff > 0 ? 'win' : ''], [other[k], diff < 0 ? 'win' : ''], [diff === 0 ? 'Tied' : (diff > 0 ? '+' : '−') + Math.abs(diff), diff > 0 ? 'win' : '']].forEach(function (c) {
                var td = document.createElement('td'); td.textContent = c[0]; if (c[1]) td.className = c[1]; tr2.appendChild(td);
            });
            tb.appendChild(tr2);
        });
        t.appendChild(tb); wrap.appendChild(t);
    }

    document.querySelectorAll('#seg button').forEach(function (b) {
        b.onclick = function () {
            metric = b.dataset.m;
            document.querySelectorAll('#seg button').forEach(function (o) { o.classList.toggle('on', o === b); });
            renderCompete();
        };
    });
    $('h2hSel').onchange = renderCompete;
    $('addFriend').onclick = function () {
        var n = $('fName').value.trim();
        if (!n) { $('friendErr').textContent = 'Enter your friend’s name or ID.'; return; }
        $('friendErr').textContent = '';
        var old = friends.filter(function (f) { return f.name.toLowerCase() === n.toLowerCase(); })[0];
        friends = friends.filter(function (f) { return f !== old; });
        friends.push({ id: old ? old.id : Date.now(), name: n, solved: num('fSolved'), cur: num('fCur'), max: Math.max(num('fMax'), num('fCur')), rating: num('fRating') });
        save(); renderCompete();
        ['fName', 'fSolved', 'fCur', 'fMax', 'fRating'].forEach(function (id) { $(id).value = ''; });
    };

    /* ---------- connected friends (accounts) ---------- */
    function loadSocial() {
        api('/api/friends').then(function (r) {
            linked = r.friends || []; incoming = r.incoming || []; outgoing = r.outgoing || [];
            renderCompete();
        }).catch(function () { });
    }
    function socialCall(path, method, email) {
        return api(path, method || 'POST', email ? { email: email } : null)
            .then(function () { $('socialMsg').textContent = ''; loadSocial(); })
            .catch(function (err) { $('socialMsg').textContent = err.message; });
    }
    function renderRequests() {
        var box = $('reqBox'); box.innerHTML = '';
        function addRow(text, actions) {
            var li = document.createElement('li'), sp = document.createElement('span'); sp.textContent = text; li.appendChild(sp);
            var w = document.createElement('div'); w.className = 'req-actions';
            actions.forEach(function (a) {
                var b = document.createElement('button'); b.className = 'btn small' + (a.ghost ? ' ghost' : ''); b.textContent = a.label;
                b.onclick = function () { socialCall(a.path, 'POST', a.email); }; w.appendChild(b);
            });
            li.appendChild(w); box.appendChild(li);
        }
        incoming.forEach(function (r) {
            addRow(r.name + ' (' + r.email + ') wants to connect', [
                { label: 'Accept', path: '/api/friends/accept', email: r.email },
                { label: 'Decline', path: '/api/friends/decline', email: r.email, ghost: true }]);
        });
        outgoing.forEach(function (r) {
            addRow('Request sent to ' + r.email, [{ label: 'Cancel', path: '/api/friends/cancel', email: r.email, ghost: true }]);
        });
    }
    $('sendReq').onclick = function () {
        var e = $('fEmail').value.trim().toLowerCase();
        if (!e) { $('socialMsg').textContent = 'Enter your friend’s email.'; return; }
        api('/api/friends/request', 'POST', { email: e }).then(function (r) {
            $('socialMsg').textContent = r.status === 'connected' ? 'You’re now connected!' : 'Request sent. They need to accept it.';
            $('fEmail').value = ''; loadSocial();
        }).catch(function (err) { $('socialMsg').textContent = err.message; });
    };

    /* ---------- LeetCode sync ---------- */
    // total = starting total + LeetCode's own solved count + manual (non-LeetCode) log entries
    function totalSolved() {
        return base + (lc.solved || 0) + logs.filter(function (l) { return l.plat !== 'LeetCode'; })
            .reduce(function (t, l) { return t + l.count; }, 0);
    }
    function setStatus(msg) { $('lcStatus').textContent = msg; }

    $('lcSync').onclick = function () {
        var u = $('lcUser').value.trim(), b = $('lcBase').value.trim().replace(/\/+$/, '');
        if (!u || !b) { setStatus('Enter your LeetCode username and the API address.'); return; }
        setStatus('Syncing…');
        fetch(b + '/' + encodeURIComponent(u))
            .then(function (r) { if (!r.ok) throw new Error('The API answered with HTTP ' + r.status + '.'); return r.json(); })
            .then(function (d) {
                var e = d.easySolved, m = d.mediumSolved, h = d.hardSolved;
                if (d.status === 'error' || [e, m, h].some(function (v) { return typeof v !== 'number'; })) {
                    throw new Error(d.message || 'Unexpected response. Check the username and the API.');
                }
                // 1) DSA difficulty counts
                dsa.easy = e; dsa.medium = m; dsa.hard = h;
                lc.solved = typeof d.totalSolved === 'number' ? d.totalSolved : e + m + h;
                // 2) daily calendar -> heatmap + streaks (timestamps are UTC midnight)
                var cal = d.submissionCalendar || {};
                if (typeof cal === 'string') cal = JSON.parse(cal);
                logs = logs.filter(function (l) { return l.plat !== 'LeetCode'; });
                var stamp = Date.now();
                Object.keys(cal).forEach(function (ts, i) {
                    var n = parseInt(cal[ts], 10);
                    if (n > 0) logs.push({ id: stamp + i, date: new Date(+ts * 1000).toISOString().slice(0, 10), plat: 'LeetCode', count: n });
                });
                lc.user = u; lc.base = b; lc.last = new Date().toLocaleString();
                save(); renderStats(); renderActivity(); renderCompete();
                setStatus('Synced ' + lc.solved + ' solved · last synced ' + lc.last);
            })
            .catch(function (err) {
                setStatus((err instanceof TypeError ? 'Couldn’t reach ' + b + '. Is the API running (and allowing CORS)?' : err.message));
            });
    };

    /* ---------- boot ---------- */
    var s = get('session', null);
    if (s && s.email && token) {
        user = s;
        api('/api/me').then(function (me) { load(me.data || {}); }).catch(function (err) {
            user = null; show(false);
            if (err.status !== 401) $('loginErr').textContent = 'Can’t reach the server at ' + API + '. Is it running?';
        });
    } else show(false);
})();