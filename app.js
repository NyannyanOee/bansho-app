/*
 * 万象書庫 画面の動き（app.js）
 *
 * データの読み書きは、すべて storage.js の BanshoStorage を通します。
 * このファイルは、保存先がどこかを知りません。
 * 画面の移動は、アドレスの # 以降（#/list など）で管理します。
 * iPhoneの「戻る」スワイプも、これで自然に動きます。
 */
(function () {
  'use strict';

  var store = window.BanshoStorage;
  var state = { items: [], cats: [], q: '', fcat: '', rv: 0, cur: null, edit: null };
  var toastTimer = null;

  /* ---------- 小さな道具 ---------- */
  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function linkify(s) {
    return esc(s).replace(/https?:\/\/[^\s<>"'）)」。、]+/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>';
    });
  }
  function norm(s) {
    // 全角半角、大文字小文字、空白、ひらがな/カタカナの違いをならして比べる
    return String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '')
      .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  }
  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) { if (state.items[i].id === id) return state.items[i]; }
    return null;
  }
  function catName(id) {
    for (var i = 0; i < state.cats.length; i++) { if (state.cats[i].id === id) return state.cats[i].name; }
    return '';
  }
  function countOf(catId) {
    return state.items.filter(function (it) { return it.category_id === catId; }).length;
  }
  function similar(a, b) {
    var x = norm(a), y = norm(b);
    return x !== y && (x.indexOf(y) > -1 || y.indexOf(x) > -1);
  }
  function msg(e) { return (e && e.message) ? e.message : '保存できませんでした。もう一度お試しください。'; }

  function refresh() {
    return Promise.all([store.listItems(), store.listCategories()]).then(function (r) {
      state.items = r[0]; state.cats = r[1];
    });
  }

  /* ---------- 画面の切り替え ---------- */
  var TABOF = { home: 'home', list: 'list', detail: 'list', edit: 'edit', review: 'review', backup: 'backup' };
  function show(name) {
    ['home', 'edit', 'list', 'detail', 'review', 'backup'].forEach(function (n) { $('#s-' + n).hidden = (n !== name); });
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.getAttribute('data-tab') === TABOF[name]) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    closeSheet();
    window.scrollTo(0, 0);
  }
  function go(path) {
    var target = '#/' + path;
    if (location.hash === target) route(); else location.hash = target;
  }
  function route() {
    var p = location.hash.replace(/^#\/?/, '').split('/');
    var name = p[0] || 'home';
    var id = p[1] ? decodeURIComponent(p[1]) : '';
    switch (name) {
      case 'list': show('list'); renderList(); break;
      case 'item':
        if (!findItem(id)) { go('list'); return; }
        state.cur = id; show('detail'); renderDetail(); break;
      case 'edit':
        if (id !== 'new' && !findItem(id)) { go('list'); return; }
        openEdit(id === 'new' ? null : id); break;
      case 'review': show('review'); renderReview(); break;
      case 'backup': show('backup'); renderBackup(); break;
      default: show('home'); renderHome();
    }
  }
  function toast(text) {
    var t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }
  function openSheet(html) {
    $('#sheet').innerHTML = html; $('#scrim').hidden = false;
    var f = $('#sheet input, #sheet select, #sheet button'); if (f) f.focus();
  }
  function closeSheet() { $('#scrim').hidden = true; $('#sheet').innerHTML = ''; }

  /* ---------- ホーム ---------- */
  function buildShelf() {
    var cols = ['var(--red)', 'var(--gold)', 'var(--paper-2)', 'var(--red-deep)', 'var(--gold-lt)', 'var(--dark-bg)'];
    var hs = [58, 72, 50, 66, 54, 76, 60, 68, 52, 74, 62, 56, 70, 48, 64, 76, 54, 60, 66, 52, 72, 58, 64];
    var ws = [14, 12, 16, 13, 15, 12, 14, 16, 12, 14, 13, 15, 12, 16, 14, 12, 15, 13, 14, 12, 16, 13, 15];
    var segs = [[6, 82], [142, 236], [300, 394]];
    var out = '', k = 0;
    segs.forEach(function (sg) {
      var x = sg[0];
      while (x + ws[k % ws.length] <= sg[1]) {
        var w = ws[k % ws.length], h = hs[k % hs.length], y = 92 - h, c = cols[k % cols.length];
        out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="1.5" style="fill:' + c + ';stroke:var(--po)" stroke-width=".8"/>';
        out += '<rect x="' + (x + 1) + '" y="' + (y + 7) + '" width="' + (w - 2) + '" height="2" style="fill:var(--gold-lt)" opacity=".85"/>';
        out += '<rect x="' + (x + 1) + '" y="' + (y + h - 12) + '" width="' + (w - 2) + '" height="1.5" style="fill:var(--gold-lt)" opacity=".7"/>';
        x += w + 1.5; k++;
      }
    });
    out += '<rect x="0" y="92" width="400" height="9" style="fill:var(--wood)"/><rect x="0" y="101" width="400" height="1.5" style="fill:var(--gold)" opacity=".6"/>';
    out += '<use href="#p-read" x="86" y="44" width="48" height="48"/>';
    out += '<use href="#p-bamboo" x="240" y="44" width="48" height="48"/>';
    $('#shelf').innerHTML = out;
  }
  function renderHome() {
    $('#home-foot').textContent = store.persistent
      ? ''
      : '仮保存版 ・ 画面を閉じるとデータは消えます';
  }

  /* ---------- 一覧 ---------- */
  function renderList() {
    var h = '<button type="button" class="chip" data-act="chip" data-v="" aria-pressed="' + (state.fcat === '' ? 'true' : 'false') + '">すべて</button>';
    state.cats.forEach(function (c) {
      h += '<button type="button" class="chip" data-act="chip" data-v="' + esc(c.id) + '" aria-pressed="' + (state.fcat === c.id ? 'true' : 'false') + '">' + esc(c.name) + ' <small>' + countOf(c.id) + '</small></button>';
    });
    $('#list-chips').innerHTML = h;
    renderResults();
  }
  function renderResults() {
    var nq = norm(state.q);
    var res = state.items.filter(function (it) {
      if (state.fcat && it.category_id !== state.fcat) return false;
      if (!nq) return true;
      return norm(it.title).indexOf(nq) > -1 || norm(it.meaning).indexOf(nq) > -1 || norm(it.memo || '').indexOf(nq) > -1;
    });
    var body = $('#list-body'), cnt = $('#list-count');
    if (!state.items.length) {
      cnt.textContent = '';
      body.innerHTML = '<div class="empty"><svg viewBox="0 0 80 48" aria-hidden="true"><use href="#p-sleep" width="80" height="48"/></svg><h3>書庫はまだ空です</h3><p>最初の知識を1件登録してみましょう。タイトルと意味・説明だけで保存できます。</p><a class="btn primary" href="#/edit/new">知識を登録する</a></div>';
      return;
    }
    if (!res.length) {
      cnt.textContent = '0件';
      var parts = [];
      if (state.q) parts.push('「' + esc(state.q) + '」');
      if (state.fcat) parts.push('カテゴリー：' + esc(catName(state.fcat)));
      body.innerHTML = '<div class="empty"><svg class="sq" viewBox="0 0 64 64" aria-hidden="true"><use href="#p-read" width="64" height="64"/></svg><h3>見つかりませんでした</h3><p>' + parts.join('（') + (parts.length > 1 ? '）' : '') + 'に合う知識はありません。言葉を変えるか、絞り込みを外してみてください。</p><button type="button" class="btn" data-act="clear-filter">検索と絞り込みを解除</button></div>';
      return;
    }
    cnt.textContent = (state.q || state.fcat) ? res.length + '件が見つかりました' : '新しい順 ・ ' + res.length + '件';
    body.innerHTML = '<div class="list">' + res.map(function (it) {
      var cn = catName(it.category_id);
      return '<a class="item" href="#/item/' + encodeURIComponent(it.id) + '"><h3>' + esc(it.title) + '</h3><p>' + esc(it.meaning) + '</p><div class="meta">' + (cn ? '<span class="tag">' + esc(cn) + '</span>' : '') + '<span>' + fmtDate(it.created_at) + '</span></div></a>';
    }).join('') + '</div>';
  }

  /* ---------- 詳細 ---------- */
  function sec(label, text, isMemo) {
    if (!text) return '';
    var inner = '<h4>' + label + '</h4><p class="txt">' + (isMemo ? linkify(text) : esc(text)) + '</p>';
    return isMemo ? '<div class="sec memo">' + inner + '</div>' : '<div class="sec">' + inner + '</div>';
  }
  function renderDetail() {
    var it = findItem(state.cur);
    if (!it) { go('list'); return; }
    var cn = catName(it.category_id);
    var dates = fmtDate(it.created_at) + ' 登録' + (fmtDate(it.updated_at) !== fmtDate(it.created_at) ? ' ・ ' + fmtDate(it.updated_at) + ' 更新' : '');
    $('#detail-body').innerHTML =
      '<h3 class="d-title">' + esc(it.title) + '</h3>' +
      '<div class="d-meta">' + (cn ? '<span class="tag">' + esc(cn) + '</span>' : '<span>カテゴリーなし</span>') + '<span>' + dates + '</span></div>' +
      sec('意味・説明', it.meaning) + sec('具体例', it.example) + sec('補足説明', it.supplement) + sec('自由メモ', it.memo, true) +
      '<div class="row-btns"><a class="btn" href="#/edit/' + encodeURIComponent(it.id) + '">編集する</a><button type="button" class="btn ghost" data-act="delete-ask">削除する</button></div>';
  }

  /* ---------- 登録・編集 ---------- */
  function openEdit(id) {
    var it = id ? findItem(id) : null;
    state.edit = { id: id, cat: it ? (it.category_id || '') : '', pending: [], seq: 0 };
    $('#edit-title').textContent = it ? '知識を編集する' : '知識を登録する';
    $('#f-title').value = it ? it.title : '';
    $('#f-meaning').value = it ? it.meaning : '';
    $('#f-example').value = it ? (it.example || '') : '';
    $('#f-supp').value = it ? (it.supplement || '') : '';
    $('#f-memo').value = it ? (it.memo || '') : '';
    ['#e-title', '#e-meaning', '#e-cat', '#e-save'].forEach(function (s) { $(s).hidden = true; });
    $('#addbox').hidden = true; $('#cat-warn').hidden = true; $('#f-newcat').value = '';
    renderCatChips();
    show('edit');
  }
  function allEditCats() {
    return state.cats.map(function (c) { return { id: c.id, name: c.name }; }).concat(state.edit.pending);
  }
  function renderCatChips() {
    var e = state.edit;
    var h = '<button type="button" class="chip" data-act="cat-pick" data-v="" aria-pressed="' + (e.cat === '' ? 'true' : 'false') + '">なし</button>';
    allEditCats().forEach(function (c) {
      h += '<button type="button" class="chip" data-act="cat-pick" data-v="' + esc(c.id) + '" aria-pressed="' + (e.cat === c.id ? 'true' : 'false') + '">' + esc(c.name) + '</button>';
    });
    h += '<button type="button" class="chip add" data-act="cat-add-toggle">＋ 追加</button>';
    $('#cat-chips').innerHTML = h;
  }
  function tryAddCat(force) {
    var name = $('#f-newcat').value.trim(), er = $('#e-cat'), w = $('#cat-warn');
    er.hidden = true; w.hidden = true;
    if (!name) { er.textContent = 'カテゴリー名を入力してください。'; er.hidden = false; return; }
    var dup = null, sim = [];
    allEditCats().forEach(function (c) {
      if (norm(c.name) === norm(name)) dup = c;
      else if (similar(c.name, name)) sim.push(c);
    });
    if (dup) {
      state.edit.cat = dup.id; renderCatChips();
      er.textContent = '「' + dup.name + '」はすでにあります。そのカテゴリーを選びました。'; er.hidden = false;
      return;
    }
    if (sim.length && !force) {
      var h = '<div>「' + esc(name) + '」に似たカテゴリーがあります。表記がばらばらにならないよう、既存のものを使うこともできます。</div><div class="row-btns">';
      sim.forEach(function (c) { h += '<button type="button" class="btn" data-act="cat-use" data-v="' + esc(c.id) + '">「' + esc(c.name) + '」を使う</button>'; });
      h += '<button type="button" class="btn ghost" data-act="cat-force">「' + esc(name) + '」のまま追加する</button></div>';
      w.innerHTML = h; w.hidden = false; return;
    }
    var tmp = { id: 'new:' + (++state.edit.seq), name: name };
    state.edit.pending.push(tmp);
    state.edit.cat = tmp.id;
    $('#addbox').hidden = true; w.hidden = true; $('#f-newcat').value = '';
    renderCatChips();
  }
  function saveForm() {
    var t = $('#f-title').value.trim(), m = $('#f-meaning').value.trim();
    $('#e-title').hidden = !!t; $('#e-meaning').hidden = !!m; $('#e-save').hidden = true;
    if (!t) { $('#f-title').focus(); return; }
    if (!m) { $('#f-meaning').focus(); return; }
    var e = state.edit, sel = e.cat;
    var chain = Promise.resolve(sel);
    if (sel && sel.indexOf('new:') === 0) {
      var pend = e.pending.filter(function (p) { return p.id === sel; })[0];
      chain = store.saveCategory({ name: pend.name }).then(function (c) { return c.id; });
    }
    chain.then(function (catId) {
      return store.saveItem({
        id: e.id, title: t, meaning: m,
        example: $('#f-example').value, supplement: $('#f-supp').value, memo: $('#f-memo').value,
        category_id: catId || null
      });
    }).then(function (saved) {
      return refresh().then(function () {
        toast(store.persistent ? '保存しました' : '保存しました（仮保存：画面を閉じると消えます）');
        go('item/' + encodeURIComponent(saved.id));
      });
    }).catch(function (err) {
      $('#e-save').textContent = msg(err); $('#e-save').hidden = false;
    });
  }
  function cancelEdit() {
    var id = state.edit && state.edit.id;
    go(id ? 'item/' + encodeURIComponent(id) : 'home');
  }

  /* ---------- 復習（見た目だけ・仕組みは保留） ---------- */
  function renderReview() {
    var list = state.items, b = $('#review-body');
    if (!list.length) {
      b.innerHTML = '<div class="empty"><svg viewBox="0 0 80 48" aria-hidden="true"><use href="#p-sleep" width="80" height="48"/></svg><h3>復習する知識がありません</h3><p>知識を登録すると、ここで読み返せるようになります。</p><a class="btn primary" href="#/edit/new">知識を登録する</a></div>';
      return;
    }
    if (state.rv >= list.length) state.rv = list.length - 1;
    if (state.rv < 0) state.rv = 0;
    var it = list[state.rv], cn = catName(it.category_id), dots = '';
    for (var i = 0; i < list.length && i < 40; i++) { dots += '<i class="' + (i === state.rv ? 'on' : '') + '"></i>'; }
    b.innerHTML =
      '<p class="note"><span class="badge">保留</span>復習の仕組みや出題方法はまだ決まっていません。今は、保存した知識を前後に読み返すだけの仮の画面です。</p>' +
      '<article class="rcard">' + (cn ? '<div><span class="tag">' + esc(cn) + '</span></div>' : '') +
      '<h3>' + esc(it.title) + '</h3>' +
      '<div><p class="lab">意味・説明</p><p class="txt">' + esc(it.meaning) + '</p></div>' +
      (it.example ? '<div><p class="lab">具体例</p><p class="txt">' + esc(it.example) + '</p></div>' : '') +
      '</article>' +
      '<div class="dots" aria-hidden="true">' + dots + '</div>' +
      '<div class="pager"><button type="button" class="btn" data-act="rv-prev"' + (state.rv === 0 ? ' disabled' : '') + '>前へ</button><span class="pos">' + (state.rv + 1) + ' / ' + list.length + '</span><button type="button" class="btn" data-act="rv-next"' + (state.rv === list.length - 1 ? ' disabled' : '') + '>次へ</button></div>' +
      '<a class="btn text block" href="#/item/' + encodeURIComponent(it.id) + '">この知識の詳細を見る</a>';
  }

  /* ---------- 設定・バックアップ ---------- */
  function renderBackup() {
    $('#st-kind').textContent = store.label;
    $('#st-note').textContent = store.persistent
      ? ''
      : '保存先はまだ決めていません。いまは画面の確認用に、一時的にメモリ上に置いているだけです。画面を閉じる・再読み込みすると、登録したものは消えます。';
    $('#cat-list').innerHTML = state.cats.length
      ? state.cats.map(function (c) {
        return '<div class="catrow"><span>' + esc(c.name) + '</span><span class="rt"><span>' + countOf(c.id) + '件</span><button type="button" class="mini" data-act="rename-open" data-id="' + esc(c.id) + '">名前を変える</button></span></div>';
      }).join('')
      : '<p class="hint">カテゴリーはまだありません。知識の登録画面から追加できます。</p>';
    $('#merge-btn').disabled = state.cats.length < 2;
  }
  function openRename(id) {
    var c = state.cats.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    openSheet('<h3>カテゴリー名を変える</h3>' +
      '<div class="field"><label for="r-name">新しい名前</label><input type="text" id="r-name" autocomplete="off" value="' + esc(c.name) + '" data-id="' + esc(id) + '"></div>' +
      '<p class="err" id="r-err" hidden></p><div class="warn" id="r-warn" hidden></div>' +
      '<div class="row-btns"><button type="button" class="btn ghost" data-act="sheet-close">やめる</button><button type="button" class="btn primary" data-act="rename-do">変更する</button></div>');
  }
  function doRename(force) {
    var inp = $('#r-name'), id = inp.getAttribute('data-id'), name = inp.value.trim();
    var er = $('#r-err'), w = $('#r-warn'); er.hidden = true; w.hidden = true;
    if (!name) { er.textContent = 'カテゴリー名を入力してください。'; er.hidden = false; return; }
    var others = state.cats.filter(function (c) { return c.id !== id; });
    if (others.some(function (c) { return norm(c.name) === norm(name); })) {
      er.textContent = '同じ名前のカテゴリーがすでにあります。'; er.hidden = false; return;
    }
    var sim = others.filter(function (c) { return similar(c.name, name); });
    if (sim.length && !force) {
      w.innerHTML = '<div>「' + esc(sim.map(function (c) { return c.name; }).join('」「')) + '」に似ています。表記がばらばらにならないか、確認してください。似ているものを1つにまとめたい場合は、あとで統合もできます。</div><div class="row-btns"><button type="button" class="btn ghost" data-act="rename-force">このまま変更する</button></div>';
      w.hidden = false; return;
    }
    store.saveCategory({ id: id, name: name }).then(refresh).then(function () {
      closeSheet(); renderBackup(); toast('カテゴリー名を変更しました');
    }).catch(function (err) { er.textContent = msg(err); er.hidden = false; });
  }
  function openMerge() {
    var cs = state.cats, a = cs[0], b = cs[1];
    outer: for (var i = 0; i < cs.length; i++) {
      for (var j = 0; j < cs.length; j++) {
        if (i !== j && similar(cs[i].name, cs[j].name)) {
          // 長いほう（表記ゆれ側）を「なくす」側の初期値にする
          if (cs[i].name.length <= cs[j].name.length) { a = cs[i]; b = cs[j]; } else { a = cs[j]; b = cs[i]; }
          break outer;
        }
      }
    }
    function opts(sel) {
      return cs.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.name) + '（' + countOf(c.id) + '件）</option>'; }).join('');
    }
    openSheet('<h3>カテゴリーを統合する</h3>' +
      '<div class="field"><label for="m-from">なくすカテゴリー</label><select id="m-from">' + opts(a.id) + '</select></div>' +
      '<div class="field"><label for="m-to">残すカテゴリー</label><select id="m-to">' + opts(b.id) + '</select></div>' +
      '<p id="m-prev"></p>' +
      '<div class="row-btns"><button type="button" class="btn ghost" data-act="sheet-close">やめる</button><button type="button" class="btn primary" id="m-go" data-act="merge-do">統合する</button></div>');
    updateMerge();
  }
  function updateMerge() {
    var f = $('#m-from').value, t = $('#m-to').value, p = $('#m-prev'), g = $('#m-go');
    if (f === t) { p.textContent = '別々のカテゴリーを選んでください。'; g.disabled = true; return; }
    p.textContent = '「' + catName(f) + '」の' + countOf(f) + '件が「' + catName(t) + '」に移り、「' + catName(f) + '」は一覧から消えます。内容をよく見て決めてください。';
    g.disabled = false;
  }

  /* ---------- 操作の受け付け ---------- */
  document.addEventListener('click', function (e) {
    if (e.target.id === 'scrim') { closeSheet(); return; }
    var el = e.target.closest('[data-act]'); if (!el) return;
    var a = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    switch (a) {
      case 'chip': state.fcat = v; renderList(); break;
      case 'clear-filter': state.q = ''; state.fcat = ''; $('#q').value = ''; renderList(); break;
      case 'edit-cancel': cancelEdit(); break;
      case 'cat-pick': state.edit.cat = v; renderCatChips(); break;
      case 'cat-add-toggle':
        var ab = $('#addbox'); ab.hidden = !ab.hidden; $('#cat-warn').hidden = true; $('#e-cat').hidden = true;
        if (!ab.hidden) $('#f-newcat').focus(); break;
      case 'cat-add-do': tryAddCat(false); break;
      case 'cat-force': tryAddCat(true); break;
      case 'cat-use': state.edit.cat = v; $('#addbox').hidden = true; $('#cat-warn').hidden = true; $('#f-newcat').value = ''; renderCatChips(); break;
      case 'delete-ask':
        var it = findItem(state.cur); if (!it) break;
        openSheet('<h3>この知識を削除しますか？</h3><div class="quote">' + esc(it.title) + '</div><p>削除すると、一覧から見えなくなります。削除した日時は記録され、データそのものは完全には消しません。</p><div class="row-btns"><button type="button" class="btn ghost" data-act="sheet-close">やめる</button><button type="button" class="btn danger" data-act="delete-do">削除する</button></div>');
        break;
      case 'delete-do':
        store.softDeleteItem(state.cur).then(refresh).then(function () { state.cur = null; toast('削除しました'); closeSheet(); go('list'); })
          .catch(function (err) { toast(msg(err)); });
        break;
      case 'sheet-close': closeSheet(); break;
      case 'rv-prev': state.rv--; renderReview(); break;
      case 'rv-next': state.rv++; renderReview(); break;
      case 'rename-open': openRename(el.getAttribute('data-id')); break;
      case 'rename-do': doRename(false); break;
      case 'rename-force': doRename(true); break;
      case 'merge-open': openMerge(); break;
      case 'merge-do':
        var f = $('#m-from').value, t = $('#m-to').value; if (f === t) break;
        var fn = catName(f), tn = catName(t);
        store.mergeCategories(f, t).then(refresh).then(function () {
          if (state.fcat === f) state.fcat = '';
          closeSheet(); renderBackup(); toast('「' + fn + '」を「' + tn + '」に統合しました');
        }).catch(function (err) { toast(msg(err)); });
        break;
      case 'demo-empty':
        store.clearAll().then(refresh).then(function () { state.q = ''; state.fcat = ''; $('#q').value = ''; toast('データを空にしました'); go('list'); }); break;
      case 'demo-reset':
        store.resetSample().then(refresh).then(function () { state.q = ''; state.fcat = ''; state.rv = 0; $('#q').value = ''; toast('架空データに戻しました'); renderBackup(); }); break;
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'm-from' || e.target.id === 'm-to') updateMerge();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheet();
    if (e.key === 'Enter' && e.target && e.target.id === 'r-name') { e.preventDefault(); doRename(false); }
  });
  $('#q').addEventListener('input', function (e) { state.q = e.target.value; renderResults(); });
  $('#form').addEventListener('submit', function (e) { e.preventDefault(); saveForm(); });
  $('#f-newcat').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tryAddCat(false); } });
  window.addEventListener('hashchange', route);

  /* ---------- 起動 ---------- */
  buildShelf();
  refresh().then(route).catch(function () {
    document.body.insertAdjacentHTML('afterbegin', '<p style="padding:24px">データを読み込めませんでした。ページを開き直してください。</p>');
  });
})();
