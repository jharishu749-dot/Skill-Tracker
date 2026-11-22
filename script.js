(function () {
    var mem = {};
    function get(k, d) { try { var v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } catch (e) { } return (k in mem) ? mem[k] : d; }
    function set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
    function del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { } }
    var $ = function (id) { return document.getElementById(id); };
    var user = null, links = [], sems = [];

    function show(loggedIn) {
        $('login').classList.toggle('hidden', loggedIn);
        $('app').classList.toggle('hidden', !loggedIn);
    }
    function load() {
        var key = 'user:' + user.email;
        links = get(key + ':links', []);
        sems = get(key + ':sems', []);
        var n = user.email.split('@')[0].replace(/[._-]+/g, ' ');
        $('name').textContent = n.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        $('mail').textContent = user.email;
        $('avatar').textContent = n.charAt(0).toUpperCase();
        renderLinks(); renderSems(); show(true);
    }

    $('loginBtn').onclick = function () {
        var e = $('email').value.trim().toLowerCase(), p = $('pw').value;
        if (!/^\S+@\S+\.\S+$/.test(e)) { $('loginErr').textContent = 'Enter a valid email address.'; return; }
        if (p.length < 4) { $('loginErr').textContent = 'Password must be at least 4 characters.'; return; }
        $('loginErr').textContent = '';
        user = { email: e }; set('session', user); $('pw').value = ''; load();
    };
    ['email', 'pw'].forEach(function (id) { $(id).addEventListener('keydown', function (ev) { if (ev.key === 'Enter') $('loginBtn').click(); }); });
    $('logout').onclick = function () { del('session'); user = null; show(false); };

    function save() { set('user:' + user.email + ':links', links); set('user:' + user.email + ':sems', sems); }

    function renderLinks() {
        var ul = $('links'); ul.innerHTML = '';
        if (!links.length) { var p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No links yet. Add your first platform above.'; ul.appendChild(p); return; }
        links.forEach(function (l, i) {
            var li = document.createElement('li'), box = document.createElement('div');
            var a = document.createElement('a'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = l.name;
            var s = document.createElement('span'); s.className = 'url'; s.textContent = l.url;
            box.appendChild(a); box.appendChild(s);
            var x = document.createElement('button'); x.className = 'x'; x.setAttribute('aria-label', 'Remove ' + l.name); x.textContent = '×';
            x.onclick = function () { links.splice(i, 1); save(); renderLinks(); };
            li.appendChild(box); li.appendChild(x); ul.appendChild(li);
        });
    }
    $('addLink').onclick = function () {
        var n = $('pName').value.trim(), u = $('pUrl').value.trim();
        if (!n || !u) { $('linkErr').textContent = 'Enter a platform name and a link.'; return; }
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        try { new URL(u); } catch (e) { $('linkErr').textContent = 'That link doesn’t look valid.'; return; }
        $('linkErr').textContent = '';
        links.push({ name: n, url: u }); save(); renderLinks();
        $('pName').value = ''; $('pUrl').value = '';
    };

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

    var s = get('session', null);
    if (s && s.email) { user = s; load(); } else show(false);
})();
