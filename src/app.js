/* ============================================================================
   Polski — czasowniki
   The drill engine, the progress store, the verb browser and every page
   behaviour. Progress lives in this browser's localStorage under
   "polski.verbs.progress.v1". It follows a learner between devices through a
   sync code: a random key naming one row of a D1 database behind
   /api/progress. Saves merge item by item, so two devices' answers add up
   instead of overwriting, and the copy on the device is always kept. The
   progress page can also export the store to a file and load one back, which
   works with no code and no network.
   ========================================================================== */
(function () {
  'use strict';

  var CAT = window.POLSKI_VERBS;
  var EXTRA = window.POLSKI_VERB_EXTRAS || {};
  if (!CAT) { console.error('verb catalog missing'); return; }

  var CHAPTERS = CAT.chapters;
  var ORDER = CHAPTERS.map(function (c) { return c.id; });
  var byId = {};
  CHAPTERS.forEach(function (c) { byId[c.id] = c; });

  /* ------------------------------------------------------------------ store */

  var KEY = 'polski.verbs.progress.v1';

  function blank() {
    return {
      v: 1,
      items: {},      // itemId -> {box, ok, seen, lastOk, due, ms}
      attempts: 0,
      correct: 0,
      days: {},
      cards: {},
      plan: {},
      sets: {},
      verbs: {}       // lemma -> seen count, for the verb browser
    };
  }

  var store = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var o = JSON.parse(raw);
      var b = blank();
      for (var k in b) if (!(k in o)) o[k] = b[k];
      o.v = 1;
      return o;
    } catch (e) {
      return blank();
    }
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 150);
  }
  function flush() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { console.warn('could not save progress', e); }
  }
  window.addEventListener('beforeunload', flush);

  function today(d) {
    d = d || new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return today(d);
  }

  var WAIT = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

  function gradeItem(item, ok, ms) {
    var s = store.items[item.id] || { box: 0, ok: 0, seen: 0, streak: 0 };
    var before = s.box || 0;
    s.seen++;
    if (ok) {
      s.box = Math.min(5, before + 1);
      s.streak = (s.streak || 0) + 1;
      s.ok++;
    } else {
      s.box = 1;
      s.streak = 0;
    }
    s.lastOk = ok ? 1 : 0;
    s.due = addDays(today(), WAIT[s.box] || 1);
    s.ms = ms || null;
    store.items[item.id] = s;

    store.attempts++;
    if (ok) store.correct++;

    var d = today();
    if (!store.days[d]) store.days[d] = { n: 0, ok: 0 };
    store.days[d].n++;
    if (ok) store.days[d].ok++;

    save();
    schedulePush();
  }

  function bestOf(setKey) { return store.sets[setKey] || null; }

  function saveBest(setKey, right, total) {
    var b = store.sets[setKey];
    if (!b || right / total > b.best / b.total) {
      store.sets[setKey] = { best: right, total: total, runs: (b ? b.runs : 0) + 1, last: today() };
    } else {
      b.runs++;
      b.last = today();
    }
    save();
  }

  function chapterScore(chapterId) {
    var c = byId[chapterId];
    var known = 0;
    var total = c.count;
    c.sets.forEach(function (set) {
      set.items.forEach(function (it) {
        var s = store.items[it.id];
        if (s && s.box >= 3) known++;
      });
    });
    return { known: known, total: total };
  }

  function dueFor(chapterId) {
    var c = byId[chapterId];
    var d = today();
    var n = 0;
    c.sets.forEach(function (set) {
      set.items.forEach(function (it) {
        var s = store.items[it.id];
        if (s && s.due && s.due <= d) n++;
      });
    });
    return n;
  }

  function dayStreak() {
    var day = today();
    var n = 0;
    if (!store.days[day]) day = addDays(day, -1);
    while (store.days[day] && store.days[day].n > 0) {
      n++;
      day = addDays(day, -1);
    }
    return n;
  }

  /* -------------------------------------------------------------- utilities */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function norm(s) {
    return String(s).toLowerCase().trim()
      .replace(/[.,!?;:„”"()]/g, '')
      .replace(/\s+/g, ' ');
  }
  function deacc(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
  }

  // A partner is shown only when it is a real partner verb. The state verbs
  // that have none store "—" in the data, so it is read, not guessed.
  function shortPartnerJs(p) {
    if (!p || p === '—') return '—';
    return p;
  }

  // The question text: [[...]] marks a filled gap, ___ an empty one, ((..)) a gloss.
  // The drill bank may also mark Polish words as <span class="pl">…</span>, and
  // <i>/<b> for emphasis. Those are escaped first, then unstripped, so nothing
  // else in the text can inject markup.
  var LATIN = 'A-Za-zÀ-žąćęłńóśźżĄĆĘŁŃÓŚŹŻ';

  function renderInline(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // the drill bank marks Polish words as <span class="pl"> or <span class='pl'>;
      // quotes are not escaped above, so accept both forms
      .replace(/&lt;span class=(?:"pl"|'pl'|pl)&gt;/g, '<span class="pl">')
      .replace(/&lt;span class=(?:"[a-z-]+"|'[a-z-]+')[^&]*?&gt;/g, '')
      .replace(/&lt;\/span&gt;/g, '</span>')
      .replace(/&lt;i&gt;/g, '<i>')
      .replace(/&lt;\/i&gt;/g, '</i>')
      .replace(/&lt;b&gt;/g, '<b>')
      .replace(/&lt;\/b&gt;/g, '</b>');
  }

  function renderQuestion(item) {
    var q = renderInline(item.q)
      .replace(/___/g, '<span class="gap"></span>')
      .replace(/\[\[(.*?)\]\]/g, '<span class="gap">$1</span>')
      .replace(/\(\((.*?)\)\)/g, '<span class="tr">($1)</span>');
    return q;
  }

  // True when two short texts say the same thing, so a line is not shown twice.
  function sameWords(a, b) {
    function n(s) { return String(s || '').toLowerCase().replace(/[^a-ząćęłńóśźż0-9]+/gi, ' ').trim(); }
    var x = n(a), y = n(b);
    return !!x && x === y;
  }

  function splitHint(q) {
    var m = /^(.*?)\s*\((?:[^()]*)\)\s*$/.exec(String(q));
    return m ? m[1] : q;
  }

  /* ----------------------------------------------------------------- theme */

  function initTheme() {
    var btn = $('#themeBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = cur ? (cur === 'dark' ? 'light' : 'dark') : (sysDark ? 'light' : 'dark');
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('polski.theme', next); } catch (e) {}
    });
  }

  /* ------------------------------------------------------- scroll + nav */

  function initScroll() {
    var bar = $('#scrollbar');
    function onScroll() {
      if (!bar) return;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function initNav() {
    var nav = $('#nav');
    if (!nav) return;
    var main = $('main');
    if (!main) return;
    var links = [];
    $$('section', main).forEach(function (sec) {
      var h2 = $('h2', sec);
      if (!h2) return;
      if (!sec.id) sec.id = 's-' + links.length;
      var a = el('a', null, escapeHtml(h2.textContent.trim()));
      a.href = '#' + sec.id;
      nav.appendChild(a);
      links.push(a);
    });
    if (!links.length) { nav.style.display = 'none'; return; }

    var targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            links.forEach(function (l) {
              l.classList.toggle('on', l.getAttribute('href') === '#' + e.target.id);
            });
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      targets.forEach(function (t) { io.observe(t); });
    }
  }

  function initChapterSwitch() {
    var sw = $('[data-chapswitch]');
    if (!sw) return;
    var btn = $('button', sw);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = sw.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function () {
      sw.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        sw.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------------------------------------------------------- drill engine */

  var activeRun = null;

  function makeRun(opts) {
    return {
      title: opts.title,
      ask: opts.ask,
      setKey: opts.setKey,
      items: opts.items,
      i: 0,
      right: 0,
      misses: [],
      answered: false,
      onDone: opts.onDone
    };
  }

  function mountRunner(root, run) {
    activeRun = run;
    root.innerHTML = '';

    var wrap = el('div', 'runner on');
    wrap.innerHTML =
      '<div class="rhead">' +
        '<span class="ttl"></span>' +
        '<span class="cnt"></span>' +
        '<span class="sp"></span>' +
        '<span class="score"></span>' +
        '<button class="xbtn" data-quit>Change set</button>' +
      '</div>' +
      '<div class="pbar"><i></i></div>' +
      '<div class="ask"></div>' +
      '<p class="qsay"></p>' +
      '<p class="q"></p>' +
      '<p class="qhint"></p>' +
      '<div class="opts"></div>' +
      '<div class="typebox" style="display:none">' +
        '<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your answer">' +
        '<button class="btn primary" data-check>Check</button>' +
      '</div>' +
      '<div class="fb" aria-live="polite"></div>' +
      '<div class="rfoot">' +
        '<button class="btn primary" data-next disabled>Next</button>' +
        '<span class="sp"></span>' +
        '<button class="xbtn" data-skip>Skip?</button>' +
      '</div>';
    root.appendChild(wrap);

    var q = {
      ttl: $('.ttl', wrap), cnt: $('.cnt', wrap), score: $('.score', wrap),
      fill: $('.pbar i', wrap), ask: $('.ask', wrap), say: $('.qsay', wrap),
      text: $('.q', wrap), hint: $('.qhint', wrap), opts: $('.opts', wrap),
      typebox: $('.typebox', wrap), input: $('input', wrap), check: $('[data-check]', wrap),
      fb: $('.fb', wrap), next: $('[data-next]', wrap), skip: $('[data-skip]', wrap),
      quit: $('[data-quit]', wrap)
    };

    q.ttl.textContent = run.title;
    q.ask.textContent = run.ask || '';
    q.quit.style.display = run.onDone ? '' : 'none';
    q.quit.textContent = run.onDone ? 'Back' : 'Leave';

    var shownAt = Date.now();

    function render() {
      var item = run.items[run.i];
      run.answered = false;
      shownAt = Date.now();
      q.fb.className = 'fb';
      q.fb.innerHTML = '';
      q.next.disabled = true;
      q.next.textContent = run.i + 1 >= run.items.length ? 'Finish' : 'Next';
      q.skip.style.display = '';
      q.input.classList.remove('right', 'wrong');
      q.input.value = '';
      q.input.disabled = false;
      q.check.disabled = false;

      q.cnt.textContent = (run.i + 1) + ' / ' + run.items.length;
      q.score.textContent = run.right + ' correct';
      q.fill.style.width = (run.i / run.items.length * 100) + '%';

      var say = item.ask || '';
      if (sameWords(say, run.ask || '')) say = '';
      q.say.textContent = say;
      q.say.style.display = say ? '' : 'none';

      var hint = item.hint || '';
      if (!hint || sameWords(hint, say) || sameWords(hint, run.ask || '')) hint = '';
      q.hint.textContent = hint ? 'Hint: ' + hint : '';

      q.text.innerHTML = renderQuestion(item);

      if (item.kind === 'choice') {
        q.typebox.style.display = 'none';
        q.opts.style.display = 'grid';
        q.opts.innerHTML = '';
        shuffle(item.opts.slice()).forEach(function (o, i) {
          var b = el('button', 'opt',
            '<span class="k">' + (i + 1) + '</span><span>' + renderInline(o) + '</span>');
          b.dataset.val = o;
          b.addEventListener('click', function () { pick(b, item); });
          q.opts.appendChild(b);
        });
      } else {
        q.opts.style.display = 'none';
        q.typebox.style.display = 'flex';
        setTimeout(function () { q.input.focus(); }, 40);
      }
    }

    function markChoices(item) {
      $$('.opt', q.opts).forEach(function (b) {
        b.disabled = true;
        if (b.dataset.val === item.a) b.classList.add('right');
      });
    }

    function pick(btn, item) {
      if (btn.disabled) return;
      var ok = btn.dataset.val === item.a;
      if (!ok) btn.classList.add('wrong');
      markChoices(item);
      finish(ok, item.a, item, false);
    }

    function checkTyped() {
      var item = run.items[run.i];
      var val = q.input.value;
      if (!val.trim()) { q.input.focus(); return; }
      var n = norm(val);
      var ok = false;
      var accentOnly = false;
      (item.accept || []).forEach(function (c) {
        if (n === norm(c)) ok = true;
        else if (deacc(n) === deacc(norm(c))) accentOnly = true;
      });
      q.input.disabled = true;
      q.check.disabled = true;
      q.input.classList.add(ok || accentOnly ? 'right' : 'wrong');
      finish(ok, (item.accept || []).join(' · '), item, accentOnly);
    }

    function finish(ok, correct, item, accentOnly) {
      if (run.answered) return;
      run.answered = true;
      var ms = Date.now() - shownAt;
      if (ok) run.right++;
      else run.misses.push(run.i);
      gradeItem(item, ok, ms);
      q.score.textContent = run.right + ' correct';

      q.fb.className = 'fb on ' + (ok ? 'ok' : 'no');
      var head = ok ? (accentOnly ? 'Right — but mind the diacritics' : 'Correct')
                    : (accentOnly ? 'Nearly — the diacritics count' : 'Not quite');
      q.fb.innerHTML =
        '<div class="v">' + head + '</div>' +
        (ok ? '' : '<div class="a">' + renderInline(correct) + '</div>') +
        '<div class="why">' + (item.why || '') + '</div>' +
        (item.src ? '<div class="srcline">Source: ' + item.src + '</div>' : '');

      q.next.disabled = false;
      q.skip.style.display = 'none';
      updateMeters();
      q.next.focus();
    }

    function next() {
      if (run.i + 1 >= run.items.length) { end(); return; }
      run.i++;
      render();
    }

    function end() {
      if (run.setKey) saveBest(run.setKey, run.right, run.items.length);
      var total = run.items.length;
      var pct = Math.round(run.right / total * 100);
      var msg;
      if (pct === 100) msg = 'Clean sweep. Move on to the next set, or come back tomorrow — spacing is what makes this stick.';
      else if (pct >= 80) msg = 'Solid. Reread the explanations for the ones you missed, then run them again.';
      else if (pct >= 50) msg = 'The pattern is there but not automatic yet. Run the misses again now, and the whole set tomorrow.';
      else msg = 'Go back to the section this set drills, read the table once more, then retry. Nothing here is worth memorising blind.';

      var sum = el('div', 'summary on');
      sum.innerHTML = '<div class="big">' + run.right + ' / ' + total + '</div><p>' + msg + '</p>';
      var cta = el('div', 'cta');
      cta.style.justifyContent = 'center';

      if (run.misses.length) {
        var again = el('button', 'btn primary',
          'Review ' + run.misses.length + ' mistake' + (run.misses.length > 1 ? 's' : ''));
        again.addEventListener('click', function () {
          var items = run.misses.map(function (i) { return run.items[i]; });
          mountRunner(root, makeRun({
            title: run.title + ' — mistakes',
            ask: 'Reviewing your mistakes',
            setKey: run.setKey,
            items: items,
            onDone: run.onDone
          }));
        });
        cta.appendChild(again);
      }

      var rerun = el('button', 'btn ghost', 'Run it again');
      rerun.addEventListener('click', function () {
        mountRunner(root, makeRun({
          title: run.title, ask: run.ask, setKey: run.setKey,
          items: shuffle(run.items.slice()), onDone: run.onDone
        }));
      });
      cta.appendChild(rerun);

      if (run.onDone) {
        var back = el('button', 'btn ghost', 'Back');
        back.addEventListener('click', run.onDone);
        cta.appendChild(back);
      }
      sum.appendChild(cta);
      root.innerHTML = '';
      root.appendChild(sum);
      updateMeters();
      save();
    }

    q.next.addEventListener('click', next);
    q.check.addEventListener('click', checkTyped);
    q.quit.addEventListener('click', function () {
      if (run.onDone) run.onDone();
      else root.innerHTML = '';
      activeRun = null;
    });
    q.skip.addEventListener('click', function () {
      var item = run.items[run.i];
      if (item.kind === 'choice') markChoices(item);
      else {
        q.input.value = (item.accept || [])[0] || '';
        q.input.disabled = true;
        q.check.disabled = true;
        q.input.classList.add('wrong');
      }
      finish(false, (item.accept || []).length ? item.accept[0] : item.a, item, false);
    });
    q.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (q.input.disabled) next(); else checkTyped();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (!document.body.contains(wrap)) return;
      if (e.target === q.input) return;
      var item = run.items[run.i];
      if (!item) return;
      if (item.kind === 'choice' && e.key >= '1' && e.key <= '9') {
        var b = q.opts.children[Number(e.key) - 1];
        if (b && !b.disabled) b.click();
      }
      if (e.key === 'Enter' && !q.next.disabled) {
        e.preventDefault();
        next();
      }
    });

    render();
  }

  /* --------------------------------------------------------- chapter drills */

  function initChapterDrills() {
    var root = $('#drillRoot');
    if (!root) return;
    var chapterId = root.dataset.chapter;
    var c = byId[chapterId];
    if (!c) return;

    function grid() {
      activeRun = null;
      root.innerHTML = '';
      var box = el('div', 'drills');
      var sc = chapterScore(chapterId);
      var head = el('div', 'chips');
      head.innerHTML = '<span class="chip">' + c.sets.length + ' sets · ' + c.count + ' items</span>' +
        '<span class="chip">Known: <b>' + sc.known + ' / ' + sc.total + '</b></span>' +
        '<span class="chip">Due now: <b>' + dueFor(chapterId) + '</b></span>';
      box.appendChild(head);

      var g = el('div', 'setgrid');
      c.sets.forEach(function (set) {
        var key = chapterId + '/' + set.id;
        var b = bestOf(key);
        var btn = el('button', 'setcard',
          '<div class="t">' + renderInline(set.title) + '</div>' +
          '<div class="m">' + set.items.length + ' items</div>' +
          (b ? '<div class="best">best ' + b.best + ' / ' + b.total + ' · ' + b.runs + ' run' + (b.runs > 1 ? 's' : '') + '</div>' : ''));
        btn.addEventListener('click', function () {
          mountRunner(root, makeRun({
            title: set.title, ask: set.ask, setKey: key,
            items: shuffle(set.items.slice()), onDone: grid
          }));
        });
        g.appendChild(btn);
      });
      box.appendChild(g);

      var cta = el('div', 'cta');
      cta.style.marginTop = '16px';
      var due = dueFor(chapterId);
      if (due > 0) {
        var rd = el('button', 'btn primary', 'Review the ' + due + ' due');
        rd.addEventListener('click', function () {
          var items = [];
          c.sets.forEach(function (set) {
            set.items.forEach(function (it) {
              var s = store.items[it.id];
              if (s && s.due && s.due <= today()) items.push(it);
            });
          });
          mountRunner(root, makeRun({
            title: c.en + ' — due for review',
            ask: 'What the schedule says you owe',
            setKey: null,
            items: shuffle(items).slice(0, 30),
            onDone: grid
          }));
        });
        cta.appendChild(rd);
      }
      var all = el('button', 'btn ghost', 'Drill all ' + c.count);
      all.addEventListener('click', function () {
        var items = [];
        c.sets.forEach(function (set) { items = items.concat(set.items); });
        mountRunner(root, makeRun({
          title: c.en + ' — all items',
          ask: 'Every item in this chapter, shuffled',
          setKey: null,
          items: shuffle(items),
          onDone: grid
        }));
      });
      cta.appendChild(all);
      box.appendChild(cta);
      root.appendChild(box);
    }

    grid();
  }

  /* --------------------------------------------------------- verb browser */

  // Every verb table on the site comes from this data, which the build wrote
  // from Wiktionary's inflection tables. Opening a row shows what that page
  // states, form for form.
  function initVerbBrowser() {
    var body = $('#verbBody');
    if (!body) return;
    var data = EXTRA.verbs || {};
    var site = EXTRA.verbMeta || {};
    var input = $('#verbSearch');
    var count = $('#verbCount');
    var chips = $$('#verbChips button');
    var pairsOnly = $('#verbPairsOnly');
    var filter = 'all';
    var open = null;

    var rows = Object.keys(data).sort(function (a, b) {
      return a.localeCompare(b, 'pl');
    });

    function detailHtml(v) {
      var meta = site[v.lemma] || {};
      var presentLabel = v.presentIsFuture ? 'Future (a perfective verb has no present)' : 'Present';
      var parts = [];
      parts.push('<div class="vdblock"><div class="h">' + presentLabel + '</div><div class="v">' +
        v.present.map(function (r) { return r.form; }).join(' · ') + '</div></div>');
      parts.push('<div class="vdblock"><div class="h">Past (on / ona)</div><div class="v">' +
        [v.past.filter(function (r) { return r.label === 'on'; })[0],
         v.past.filter(function (r) { return r.label === 'ona'; })[0]]
          .filter(Boolean).map(function (r) { return r.form; }).join(' · ') + '</div></div>');
      if (v.participles.act) parts.push('<div class="vdblock"><div class="h">Participle</div><div class="v">' +
        v.participles.act + (v.participles.adv ? ' · ' + v.participles.adv : '') + '</div></div>');
      parts.push('<div class="vdblock"><div class="h">Aspect</div><div class="v">' + v.aspect +
        (v.partner && shortPartnerJs(v.partner) !== '—' ? ' · pair: ' + v.partner
          : (v.nearSynonym ? ' · nearest: ' + v.nearSynonym : '')) + '</div></div>');
      var note = meta.note ? '<div class="src">' + meta.note + '</div>' : '';
      var pnote = meta.partnerNote ? '<div class="src">Partner: ' + meta.partnerNote + '</div>' : '';
      return '<div class="vdgrid">' + parts.join('') + '</div>' +
        '<div class="src">Every form on this card is from the inflection table at ' +
        '<a href="' + v.source + '" rel="noopener" target="_blank">Wiktionary</a>.</div>' + pnote + note;
    }

    function render() {
      var q = deacc(String(input.value || '').toLowerCase().trim());
      var html = '';
      var n = 0;
      rows.forEach(function (lemma) {
        var v = data[lemma];
        var meta = site[lemma] || {};
        if (filter !== 'all' && v.aspect !== filter) return;
        if (pairsOnly && pairsOnly.checked && !(v.partner && v.partner !== '—')) return;
        var hay = deacc([lemma, v.gloss, meta.note || '', v.partner || ''].join(' ').toLowerCase());
        if (q && hay.indexOf(q) === -1) return;
        n++;
        var isOpen = open === lemma;
        html += '<tr class="verbrow" data-lemma="' + escapeHtml(lemma) + '">' +
          '<td>' + escapeHtml(lemma) + '</td>' +
          '<td class="small">' + escapeHtml(v.gloss) + '</td>' +
          '<td class="small">' + (v.aspect === 'perfective' ? 'pf' : 'impf') + '</td>' +
          '<td class="pl">' + escapeHtml(shortPartnerJs(v.partner)) + '</td>' +
          '<td class="small">' + (isOpen ? '▾' : '▸') + '</td>' +
        '</tr>';
        if (isOpen) {
          html += '<tr class="verbdetail"><td colspan="5">' + detailHtml(v) + '</td></tr>';
        }
      });
      body.innerHTML = html;
      if (count) count.textContent = n + ' of ' + rows.length;
      $$('.verbrow', body).forEach(function (tr) {
        tr.addEventListener('click', function () {
          var lemma = tr.dataset.lemma;
          open = open === lemma ? null : lemma;
          render();
        });
      });
    }

    input.addEventListener('input', render);
    if (pairsOnly) pairsOnly.addEventListener('change', render);
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on');
        filter = chip.dataset.vf;
        render();
      });
    });
    render();
  }

  /* ------------------------------------------------------------- flashcards */

  function initCards() {
    var grid = $('#fcGrid');
    if (!grid) return;
    var chapterId = grid.dataset.chapter;
    var cards = (EXTRA[chapterId] && EXTRA[chapterId].cards) || [];
    var knownEl = $('#fcKnown');
    var totalEl = $('#fcTotal');

    function knownSet() { return store.cards[chapterId] || []; }

    function render() {
      var known = knownSet();
      var html = '';
      cards.forEach(function (c) {
        var isKnown = known.indexOf(c.p) !== -1;
        html += '<div class="fc' + (isKnown ? ' known' : '') + '" data-p="' + escapeHtml(c.p) + '">' +
          '<span class="lv">' + escapeHtml(c.lv) + '</span>' +
          '<div class="p">' + c.p + '</div>' +
          '<div class="hint">click to turn over</div>' +
          '<div class="m">' + c.m + '</div>' +
          '<div class="exm">' + c.ex + '</div>' +
          '<div class="fcbtns"><button data-yes>✔ I know it</button><button data-no>↻ Again</button></div>' +
        '</div>';
      });
      grid.innerHTML = html;
      $$('.fc', grid).forEach(function (card) {
        card.addEventListener('click', function (ev) {
          var t = ev.target;
          if (t.hasAttribute && (t.hasAttribute('data-yes') || t.hasAttribute('data-no'))) {
            var set = knownSet();
            var p = card.getAttribute('data-p');
            if (t.hasAttribute('data-yes')) {
              if (set.indexOf(p) === -1) set.push(p);
            } else {
              var ix = set.indexOf(p);
              if (ix !== -1) set.splice(ix, 1);
            }
            store.cards[chapterId] = set;
            save();
            render();
            return;
          }
          card.classList.toggle('flipped');
        });
      });
      if (knownEl) knownEl.textContent = known.length;
      if (totalEl) totalEl.textContent = cards.length;
      updateMeters();
    }
    render();
  }

  /* ------------------------------------------------------------------ plan */

  function initPlan() {
    var root = $('#planRoot');
    if (!root) return;
    var chapterId = root.dataset.chapter;
    var plan = (EXTRA[chapterId] && EXTRA[chapterId].plan) || [];
    var saved = store.plan[chapterId] || {};
    var html = '';
    plan.forEach(function (day) {
      html += '<div class="plan-day"><div class="dt">' + day.t + '</div>';
      day.items.forEach(function (it) {
        html += '<label><input type="checkbox" data-k="' + it.k + '"' + (saved[it.k] ? ' checked' : '') +
          '><span>' + it.en + '</span></label>';
      });
      html += '</div>';
    });
    root.innerHTML = html;
    $$('input[type=checkbox]', root).forEach(function (box) {
      box.addEventListener('change', function () {
        var s = store.plan[chapterId] || {};
        s[box.dataset.k] = box.checked;
        store.plan[chapterId] = s;
        save();
        updateMeters();
      });
    });
  }

  /* --------------------------------------------------------- today + mixed */

  function allItems(chapterId) {
    var c = byId[chapterId];
    var out = [];
    c.sets.forEach(function (s) {
      s.items.forEach(function (it) {
        var copy = {};
        for (var k in it) copy[k] = it[k];
        copy.ask = it.ask || s.ask;
        copy.setTitle = s.title;
        out.push(copy);
      });
    });
    return out;
  }

  function dueItems() {
    var out = [];
    ORDER.forEach(function (id) {
      byId[id].sets.forEach(function (set) {
        set.items.forEach(function (it) {
          var s = store.items[it.id];
          if (s && s.due && s.due <= today()) out.push(it);
        });
      });
    });
    return out;
  }

  function focusChapter() {
    for (var i = 0; i < ORDER.length; i++) {
      var id = ORDER[i];
      var sc = chapterScore(id);
      if (sc.known < sc.total * 0.6) return id;
    }
    return ORDER[0];
  }

  function initToday() {
    var root = $('#todayRoot');
    if (!root) return;
    var focus = focusChapter();
    var c = byId[focus];
    var due = shuffle(dueItems()).slice(0, 8);
    var seen = {};
    due.forEach(function (i) { seen[i.id] = 1; });

    var fresh = shuffle(allItems(focus).filter(function (i) { return !seen[i.id]; }));
    var picks = due.concat(fresh.slice(0, Math.max(0, 12 - due.length)));
    shuffle(picks);

    var sc = chapterScore(focus);
    root.innerHTML =
      '<div class="chips">' +
        '<span class="chip">Chapter in focus: <b>' + c.en + '</b></span>' +
        '<span class="chip">Known: <b>' + sc.known + ' / ' + sc.total + '</b></span>' +
        '<span class="chip">Review first: <b>' + due.length + '</b></span>' +
        '<span class="chip">' + today() + '</span>' +
      '</div>';

    var box = el('div');
    box.style.marginTop = '16px';
    var start = el('button', 'btn primary', 'Start the ' + picks.length + ' items');
    start.addEventListener('click', function () {
      mountRunner(root, makeRun({
        title: 'Today · ' + c.en,
        ask: 'Twelve items, review first',
        setKey: null,
        items: picks,
        onDone: function () { location.reload(); }
      }));
    });
    box.appendChild(start);
    root.appendChild(box);
  }

  function initMixed() {
    var root = $('#mixedRoot');
    if (!root) return;
    var btn = $('#mixedStart');
    if (!btn) return;
    function run(n) {
      var due = shuffle(dueItems()).slice(0, Math.floor(n / 2));
      var rest = [];
      due.forEach(function (i) { rest.push(i.id); });
      var pool = [];
      ORDER.forEach(function (id) {
        allItems(id).forEach(function (it) { if (rest.indexOf(it.id) === -1) pool.push(it); });
      });
      var picks = due.concat(shuffle(pool).slice(0, n - due.length));
      mountRunner(root, makeRun({
        title: 'Mixed · all twelve chapters',
        ask: 'Review first, then random',
        setKey: null,
        items: shuffle(picks),
        onDone: function () { location.reload(); }
      }));
    }
    btn.addEventListener('click', function () { run(20); });
  }

  /* -------------------------------------------------------------- progress */

  function initProgress() {
    var root = $('#progressRoot');
    if (!root) return;

    var stats = '<div class="stats">' +
      '<div class="stat"><div class="v">' + store.attempts + '</div><div class="l">drills answered</div></div>' +
      '<div class="stat"><div class="v">' + (store.attempts ? Math.round(store.correct / store.attempts * 100) + '%' : '—') + '</div><div class="l">correct</div></div>' +
      '<div class="stat"><div class="v">' + dayStreak() + '</div><div class="l">day streak</div></div>' +
      '<div class="stat"><div class="v">' + dueItems().length + '</div><div class="l">due for review</div></div>' +
    '</div>';

    var rows = ORDER.map(function (id) {
      var c = byId[id];
      var sc = chapterScore(id);
      var pct = Math.round(sc.known / sc.total * 100);
      return '<tr>' +
        '<td><a href="/' + id + '/">' + c.en + '</a></td>' +
        '<td class="small">' + c.pl + '</td>' +
        '<td class="small">' + sc.known + ' / ' + sc.total + '</td>' +
        '<td style="min-width:160px"><div class="bar" style="height:6px;border-radius:99px;background:var(--line2);overflow:hidden"><i style="display:block;height:100%;width:' + pct + '%;background:var(--green)"></i></div></td>' +
        '<td class="small">' + dueFor(id) + '</td>' +
        '<td><a class="small" href="/' + id + '/#drills">Drill</a></td>' +
      '</tr>';
    }).join('');

    root.innerHTML = stats +
      '<div class="tw"><table><thead><tr><th>Chapter</th><th>In Polish</th><th>Known</th><th></th><th>Due</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="small">“Known” counts items you answered right at least twice in a row — box 3 or higher.</p>';

    var due = dueItems();
    var dueRoot = $('#dueRoot');
    if (dueRoot) {
      if (!due.length) {
        dueRoot.innerHTML = '<p>Nothing is due. Open a set, or come back tomorrow — the schedule will fill up.</p>';
      } else {
        var list = due.slice(0, 12).map(function (it) {
          return '<li>' + escapeHtml(splitHint(it.q)) + (it.hint ? ' <span class="small">— ' + escapeHtml(it.hint) + '</span>' : '') + '</li>';
        }).join('');
        dueRoot.innerHTML = '<p>' + due.length + ' items are due. The oldest of them:</p><ul>' + list + '</ul>';
      }
    }

    var reset = $('#resetProgress');
    if (reset) reset.addEventListener('click', function () {
      if (!reset.dataset.sure) {
        reset.dataset.sure = '1';
        reset.textContent = 'Press again to clear everything';
        setTimeout(function () {
          if (reset.dataset.sure) {
            delete reset.dataset.sure;
            reset.textContent = 'Clear all progress';
          }
        }, 5000);
        return;
      }
      store = blank();
      flush();
      location.reload();
    });
  }

  /* ------------------------------------------- sharing progress between devices */

  // Progress follows the learner through a sync code: a random 12-character key
  // that names one row in the site's D1 database. Nothing else is uploaded, and
  // the copy in this browser is always kept, so a database that cannot be
  // reached never costs an answer. A code is a private key, not a password:
  // whoever holds it can read and write that one record, and nothing else.
  //
  // Two devices cannot both be right about the same drill item, and the store
  // carries no per-item clock, so a save never overwrites: every save reads the
  // other side first and merges, item by item, keeping the better side. A miss
  // on one device cannot wipe out a box the other earned, and neither device
  // loses an answer.
  var SYNC_KEY = 'polski.verbs.sync.v1';
  var PORTABLE = 'polski.verbs.progress';

  // A code is 12 characters from a 32-letter alphabet: 60 bits, far beyond
  // guessing, and no character pair that is easy to confuse — no I, L, O or U.
  // It is shown in three groups of four, which is how a person reads it aloud
  // and copies it across. Crockford's forgiving spellings are accepted on the
  // way in: O reads as 0, I and L read as 1.
  var CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

  function cleanCode(s) {
    return String(s || '').toUpperCase()
      .replace(/[^0-9A-Z]/g, '')
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1');
  }
  function groupCode(code) { return code.replace(/(.{4})(?=.)/g, '$1 '); }

  function loadSync() {
    try {
      var o = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
      if (!o || typeof o !== 'object' || !CODE_RE.test(o.code || '')) return { code: null };
      return { code: o.code, rev: o.rev || 0, at: o.at || null, error: null };
    } catch (e) {
      return { code: null };
    }
  }
  function saveSync() {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) {}
  }

  var sync = loadSync();

  function syncUrl(code) { return '/api/progress' + (code ? '/' + code : ''); }

  function apiJson(res) {
    return res.text().then(function (t) {
      var body = null;
      try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
      return { ok: res.ok, status: res.status, body: body };
    });
  }

  // What to tell the learner when a call fails. A browser that cannot reach
  // the server says nothing useful on its own, and the copy on the device is
  // always intact, so it is said plainly rather than shown as an error.
  function syncError(err) {
    var m = String((err && err.message) || err || '');
    if (!m || /failed to fetch|networkerror|load failed|the internet connection/i.test(m)) {
      return 'the server could not be reached — your progress is still saved on this device';
    }
    return m;
  }

  function syncServerMissing(r) {
    return !r.body || (r.body && r.body.enabled === false);
  }

  /* ------------------------------------------------------------ merging */

  function laterDate(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return a > b ? a : b;
  }
  function olderDate(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return a < b ? a : b;
  }

  function mergeItem(x, y) {
    // "More seen" stands in for "later", since nothing stamps a time per item.
    var newer = (y.seen || 0) > (x.seen || 0) ? y : x;
    return {
      box: Math.max(x.box || 0, y.box || 0),
      ok: Math.max(x.ok || 0, y.ok || 0),
      seen: Math.max(x.seen || 0, y.seen || 0),
      streak: Math.max(x.streak || 0, y.streak || 0),
      lastOk: newer.lastOk || 0,
      due: laterDate(x.due, y.due),
      ms: newer.ms === undefined ? null : newer.ms
    };
  }

  function mergeProgress(a, b) {
    var out = blank();
    var k, i;

    var ids = {};
    for (k in a.items) ids[k] = 1;
    for (k in b.items) ids[k] = 1;
    for (k in ids) {
      var x = a.items[k], y = b.items[k];
      if (!x) out.items[k] = y;
      else if (!y) out.items[k] = x;
      else out.items[k] = mergeItem(x, y);
    }

    // Every answer lands in exactly one item's `seen`, so these are the real
    // totals and they add up across devices. The stored counters are kept as a
    // floor in case a store ever carries counts from an older shape.
    var seenSum = 0, okSum = 0;
    for (k in out.items) {
      seenSum += out.items[k].seen || 0;
      okSum += out.items[k].ok || 0;
    }
    out.attempts = Math.max(seenSum, a.attempts || 0, b.attempts || 0);
    out.correct = Math.max(okSum, a.correct || 0, b.correct || 0);

    var days = {};
    for (k in a.days) days[k] = 1;
    for (k in b.days) days[k] = 1;
    for (k in days) {
      var d1 = a.days[k] || { n: 0, ok: 0 }, d2 = b.days[k] || { n: 0, ok: 0 };
      out.days[k] = { n: Math.max(d1.n || 0, d2.n || 0), ok: Math.max(d1.ok || 0, d2.ok || 0) };
    }

    // Flashcards: "I know it" is a marker on this device, so knowing on either
    // side counts. Plan ticks likewise — a tick is work done, and work done is
    // never undone by a device that had not seen it.
    var chapters = {};
    for (k in a.cards) chapters[k] = 1;
    for (k in b.cards) chapters[k] = 1;
    for (k in chapters) {
      var set = (a.cards[k] || []).slice();
      (b.cards[k] || []).forEach(function (p) { if (set.indexOf(p) === -1) set.push(p); });
      if (set.length) out.cards[k] = set;
    }

    var plans = {};
    for (k in a.plan) plans[k] = 1;
    for (k in b.plan) plans[k] = 1;
    for (k in plans) {
      var pa = a.plan[k] || {}, pb = b.plan[k] || {}, merged = {};
      for (i in pa) merged[i] = pa[i];
      for (i in pb) merged[i] = merged[i] || pb[i];
      out.plan[k] = merged;
    }

    // A best run is a score: the better of the two, with the total number of
    // runs added up and the later date kept.
    var sets = {};
    for (k in a.sets) sets[k] = 1;
    for (k in b.sets) sets[k] = 1;
    for (k in sets) {
      var s1 = a.sets[k], s2 = b.sets[k];
      if (!s1) { out.sets[k] = s2; continue; }
      if (!s2) { out.sets[k] = s1; continue; }
      var better = (s2.best / s2.total) > (s1.best / s1.total) ? s2 : s1;
      out.sets[k] = {
        best: better.best,
        total: better.total,
        runs: Math.max(s1.runs || 0, s2.runs || 0),
        last: laterDate(s1.last, s2.last)
      };
    }

    var verbs = {};
    for (k in a.verbs) verbs[k] = 1;
    for (k in b.verbs) verbs[k] = 1;
    for (k in verbs) out.verbs[k] = Math.max(a.verbs[k] || 0, b.verbs[k] || 0);

    return out;
  }

  // Two documents are the same when they hold the same thing, whatever order
  // the keys were built in — otherwise every load would look like a change.
  function stable(doc) {
    if (doc === null || typeof doc !== 'object') return JSON.stringify(doc);
    if (Array.isArray(doc)) return '[' + doc.map(stable).join(',') + ']';
    var keys = Object.keys(doc).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + stable(doc[k]);
    }).join(',') + '}';
  }
  function sameProgress(a, b) { return stable(a) === stable(b); }

  // Take a merged document as this device's own, without asking for a push.
  function adopt(merged) {
    store = merged;
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
  }

  /* ------------------------------------------------------- talking to D1 */

  var pushTimer = null;
  var pushing = null;

  function schedulePush() {
    if (!sync.code) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushProgress(true); }, 1200);
  }

  // Read, merge, then write: the server stamps the revision, so a device with
  // a wrong clock cannot make an old save win, and neither device's answers
  // are thrown away when both answered while apart. The write names the
  // revision it read; if the other device saved in between the server answers
  // 409 and this merges again, once, against whatever landed.
  function pushProgress(quiet) {
    if (!sync.code) return Promise.resolve(false);
    if (pushing) return pushing;

    function attempt(retries) {
      return fetch(syncUrl(sync.code), { headers: { accept: 'application/json' } })
        .then(apiJson)
        .then(function (r) {
          var remote = r.ok && r.body && typeof r.body.data === 'object' ? r.body.data : null;
          var doc = remote ? mergeProgress(store, remote) : store;
          if (remote && !sameProgress(doc, store)) adopt(doc);
          return fetch(syncUrl(sync.code), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: doc, baseRev: (r.body && r.body.rev) || 0 })
          })
            .then(apiJson)
            .then(function (w) {
              if (w.status === 409 && retries > 0) return attempt(retries - 1);
              return w;
            });
        });
    }

    pushing = attempt(1)
      .then(function (r) {
        if (!r.ok || !r.body) throw new Error((r.body && r.body.error) || 'the server did not save it');
        sync.rev = r.body.rev;
        sync.at = r.body.updatedAt;
        sync.error = null;
        saveSync();
        if (!quiet) paintSync();
        updateMeters();
        return true;
      })
      .catch(function (err) {
        sync.error = syncError(err);
        saveSync();
        if (!quiet) paintSync();
        return false;
      })
      .then(function (v) { pushing = null; return v; });

    return pushing;
  }

  // What the other device has, merged in. Called on every page load when a
  // code exists, so a page always starts from the newest combined state.
  function pullProgress() {
    if (!sync.code) return Promise.resolve(false);

    return fetch(syncUrl(sync.code), { headers: { accept: 'application/json' } })
      .then(apiJson)
      .then(function (r) {
        if (r.status === 404) return pushProgress(true);   // nothing saved yet
        if (!r.ok || !r.body || typeof r.body.data !== 'object') {
          throw new Error((r.body && r.body.error) || 'the server gave no progress');
        }
        var merged = mergeProgress(store, r.body.data);
        var changed = !sameProgress(merged, store);
        adopt(merged);
        sync.rev = r.body.rev || sync.rev;
        sync.at = laterDate(sync.at, r.body.updatedAt);
        sync.error = null;
        saveSync();
        if (changed) {
          updateMeters();
          paintSync();
        }
        return changed;
      })
      .catch(function (err) {
        sync.error = syncError(err);
        saveSync();
        paintSync();
        return false;
      });
  }

  /* -------------------------------------------------------------- the file */

  // A file still moves progress with no code and no network: download here,
  // load there. It replaces what the other device holds rather than merging.
  function portableProgress() {
    return {
      app: PORTABLE,
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: store
    };
  }

  function downloadProgress() {
    var data = JSON.stringify(portableProgress(), null, 1);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'polski-czasowniki-progress-' + today() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // A file is accepted only if it is this site's own export and carries the
  // shape progress has; anything else is refused with a reason, not merged.
  function readProgressFile(file, done) {
    var reader = new FileReader();
    reader.onerror = function () { done(new Error('that file could not be read')); };
    reader.onload = function () {
      var j;
      try { j = JSON.parse(String(reader.result)); }
      catch (e) { return done(new Error('that file is not JSON — pick the file this site exported')); }
      if (!j || j.app !== PORTABLE || !j.progress || typeof j.progress !== 'object') {
        return done(new Error('that is not a progress file from this site'));
      }
      var b = blank();
      var given = j.progress;
      for (var k in b) if (!(k in given)) given[k] = b[k];
      given.v = 1;
      done(null, given);
    };
    reader.readAsText(file);
  }

  /* -------------------------------------------------------------- the panel */

  function whenWas(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms) || ms < 0) return 'just now';
    var min = Math.round(ms / 60000);
    if (min < 1) return 'just now';
    if (min === 1) return 'a minute ago';
    if (min < 60) return min + ' minutes ago';
    var h = Math.round(min / 60);
    if (h === 1) return 'an hour ago';
    if (h < 24) return h + ' hours ago';
    var d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }

  function syncStatus() {
    if (sync.error) return sync.error + '.';
    if (sync.at) return 'Last saved to the cloud ' + whenWas(sync.at) + '.';
    return 'Not saved to the cloud yet.';
  }

  function fileBlock() {
    return '<details class="syncfile"><summary>Or move progress with a file</summary>' +
      '<p class="small">Download everything as a JSON file, or load one back. This needs no code and ' +
      'no network, but a loaded file replaces what the browser holds.</p>' +
      '<div class="cta">' +
      '<button class="btn ghost" id="progDownload">Download my progress</button>' +
      '<button class="btn ghost" id="progUpload">Load a progress file</button>' +
      '<input type="file" id="progFile" accept="application/json,.json" style="display:none">' +
      '</div>' +
      '<p class="small" id="progMsg"></p></details>';
  }

  function statsChips() {
    var answered = 0;
    for (var id in store.items) answered += store.items[id].seen || 0;
    var n = Object.keys(store.items).length;
    var plan = Object.keys(store.plan).length;
    return '<div class="chips">' +
      '<span class="chip">' + answered + ' answer' + (answered === 1 ? '' : 's') + ' recorded</span>' +
      '<span class="chip">' + n + ' item' + (n === 1 ? '' : 's') + ' seen</span>' +
      '<span class="chip">' + plan + ' chapter' + (plan === 1 ? '' : 's') + ' with plan ticks</span>' +
      '</div>';
  }

  function paintSync() {
    var root = $('#syncRoot');
    if (!root) return;

    if (sync.code) {
      root.innerHTML =
        '<p>This device is connected. Every answer is saved here and to your sync code, and the two ' +
        'copies merge, so nothing recorded on another device is lost.</p>' +
        statsChips() +
        '<div class="syncbox">' +
        '<div class="small">Your sync code — enter it on your other devices</div>' +
        '<code id="syncCode">' + groupCode(sync.code) + '</code>' +
        '<div class="cta">' +
        '<button class="btn primary" id="syncCopy">Copy the code</button>' +
        '<button class="btn ghost" id="syncNow">Save now</button>' +
        '<button class="btn ghost" id="syncStop">Stop syncing on this device</button>' +
        '</div></div>' +
        '<p class="small" id="syncMsg">' + escapeHtml(syncStatus()) + '</p>' +
        fileBlock();
    } else {
      root.innerHTML =
        '<p>Progress can follow you between devices. Create a sync code here, then enter it on your ' +
        'phone or another computer: both devices save to the same place, and what each one learned ' +
        'is merged rather than overwritten.</p>' +
        statsChips() +
        '<div class="cta"><button class="btn primary" id="syncCreate">Create a sync code</button></div>' +
        '<div class="syncjoin">' +
        '<label class="small" for="syncInput">Already have a code from this site? Paste it here.</label>' +
        '<div class="cta">' +
        '<input id="syncInput" type="text" autocomplete="off" spellcheck="false" maxlength="16" ' +
        'placeholder="XXXX XXXX XXXX">' +
        '<button class="btn ghost" id="syncJoin">Use this code</button>' +
        '</div></div>' +
        '<p class="small" id="syncMsg">' + escapeHtml(syncStatus()) + '</p>' +
        fileBlock();
    }

    function msg(t, bad) {
      var m = $('#syncMsg');
      if (!m) return;
      m.textContent = t;
      m.style.color = bad ? 'var(--accent)' : '';
    }

    var create = $('#syncCreate');
    if (create) create.addEventListener('click', function () {
      create.disabled = true;
      msg('Asking the server for a code…');
      fetch(syncUrl(null), { headers: { accept: 'application/json' } })
        .then(apiJson)
        .then(function (r) {
          if (syncServerMissing(r)) throw new Error('this copy of the site has no sync server');
          if (!r.ok || !r.body || !r.body.code) throw new Error((r.body && r.body.error) || 'no code came back');
          sync = { code: cleanCode(r.body.code), rev: 0, at: null, error: null };
          saveSync();
          return pushProgress(true);
        })
        .then(function () { paintSync(); })
        .catch(function (err) {
          sync = { code: null, error: syncError(err) };
          saveSync();
          paintSync();
        });
    });

    var join = $('#syncJoin');
    var input = $('#syncInput');
    function joinCode() {
      var code = cleanCode(input && input.value);
      if (!CODE_RE.test(code)) {
        msg('A sync code is 12 letters and digits — copy all three groups from the other device.', true);
        return;
      }
      msg('Looking for progress under that code…');
      fetch(syncUrl(code), { headers: { accept: 'application/json' } })
        .then(apiJson)
        .then(function (r) {
          if (r.status === 404) return null;
          if (!r.ok || !r.body || typeof r.body.data !== 'object') {
            throw new Error((r.body && r.body.error) || 'that code could not be read');
          }
          return r.body;
        })
        .then(function (remote) {
          sync = { code: code, rev: remote ? remote.rev : 0, at: remote ? remote.updatedAt : null, error: null };
          saveSync();
          if (remote) adopt(mergeProgress(store, remote.data));
          sync.empty = !remote;
          return pushProgress(true);
        })
        .then(function () {
          var empty = sync.empty;
          delete sync.empty;
          saveSync();
          paintSync();
          msg(empty
            ? 'That code had nothing saved yet, so this device’s progress became its first save.'
            : 'Connected. What this device had is merged with what the code held.');
          updateMeters();
        })
        .catch(function (err) {
          sync = { code: null, error: syncError(err) };
          saveSync();
          paintSync();
        });
    }
    if (join) join.addEventListener('click', joinCode);
    if (input) input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); joinCode(); }
    });

    var copy = $('#syncCopy');
    if (copy) copy.addEventListener('click', function () {
      var text = groupCode(sync.code);
      var done = function (ok) {
        msg(ok ? 'Code copied. Paste it into the other device.' : 'Copy it by hand: ' + text, !ok);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    });

    var now = $('#syncNow');
    if (now) now.addEventListener('click', function () {
      now.disabled = true;
      msg('Saving…');
      pushProgress(true).then(function (ok) {
        paintSync();
        if (ok) msg('Saved to the cloud ' + whenWas(sync.at) + '.');
      });
    });

    var stop = $('#syncStop');
    if (stop) stop.addEventListener('click', function () {
      if (!stop.dataset.sure) {
        stop.dataset.sure = '1';
        stop.textContent = 'Press again to disconnect';
        setTimeout(function () {
          if (stop.dataset.sure) { delete stop.dataset.sure; stop.textContent = 'Stop syncing on this device'; }
        }, 5000);
        return;
      }
      sync = { code: null };
      saveSync();
      paintSync();
      msg('Disconnected. Your progress stays on this device and on the code — enter the code again to reconnect.');
    });

    var d = $('#progDownload');
    if (d) d.addEventListener('click', function () {
      downloadProgress();
      var m = $('#progMsg');
      if (m) m.textContent = 'Downloaded. Load it on the other device from this same panel.';
    });

    var up = $('#progUpload');
    var file = $('#progFile');
    if (up && file) {
      up.addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        readProgressFile(f, function (err, loaded) {
          var m = $('#progMsg');
          if (err) { if (m) m.textContent = String(err.message || err); file.value = ''; return; }
          store = loaded;
          flush();
          if (m) m.textContent = 'Progress loaded — ' + Object.keys(loaded.items).length + ' items. Reloading…';
          setTimeout(function () { location.reload(); }, 700);
        });
      });
    }
  }

  function initSync() {
    paintSync();
    if (sync.code) pullProgress();
  }

  /* --------------------------------------------------------------- meters */

  function updateMeters() {
    $$('[data-chapter-card]').forEach(function (card) {
      var id = card.dataset.chapterCard;
      var sc = chapterScore(id);
      var pct = Math.round(sc.known / sc.total * 100);
      var bar = $('[data-chapter-bar]', card);
      var lbl = $('[data-chapter-lbl]', card);
      if (bar) bar.style.width = pct + '%';
      if (lbl) lbl.textContent = sc.known ? pct + '% known' : 'not started';
    });
    var drills = $('[data-stat="drills"]');
    if (drills) {
      $('[data-stat="drills"]').textContent = store.attempts;
      $('[data-stat="acc"]').textContent = store.attempts ? Math.round(store.correct / store.attempts * 100) + '%' : '—';
      $('[data-stat="due"]').textContent = dueItems().length;
      $('[data-stat="day"]').textContent = dayStreak();
    }
    var dp = $('#drillProgress');
    if (dp) {
      var cid = dp.dataset.chapter;
      var csc = chapterScore(cid);
      dp.innerHTML = ['Known: <b>' + csc.known + ' / ' + csc.total + '</b>',
        'Due now: <b>' + dueFor(cid) + '</b>']
        .map(function (b) { return '<span class="chip">' + b + '</span>'; }).join('');
    }
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    initTheme();
    initScroll();
    initNav();
    initChapterSwitch();
    initChapterDrills();
    initVerbBrowser();
    initCards();
    initPlan();
    initToday();
    initMixed();
    initProgress();
    initSync();
    updateMeters();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
