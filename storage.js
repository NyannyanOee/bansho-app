/*
 * 万象書庫 保存の受け口（storage.js）
 *
 * 画面（app.js）は、ここに定義した関数だけを通してデータを読み書きします。
 * 保存先がどこかを画面は知りません。
 *
 * 【現在の状態：B-1段階】
 * この端末（iPhone）の中の IndexedDB に保存します。
 *   データベース名：bansho-shoko   （検証ページ bansho-verify* とは別）
 *   保存の入れ物 ：items（知識） / categories（カテゴリー） / meta（予備）
 * 画面を閉じても、再読み込みしても、データは残ります。
 * ただし、この端末の中にあるだけです。バックアップ（JSON書き出し）は次の手順で追加します。
 *
 * 【データの形】
 * 知識  : id, title, reading（タイトルのよみ・任意・検索専用）, meaning, example, supplement, memo, category_id,
 *         created_at, updated_at, deleted_at（削除していなければ null）
 * カテゴリー: id, name, created_at, updated_at, deleted_at
 *
 * 1つの知識に付けるカテゴリーは、今は1つだけ（category_id）。
 * 複数カテゴリーにするかは保留のため、確定ではありません。
 *
 * 削除は論理削除です。deleted_at に日時を記録し、データ自体は消しません。
 * 一覧などには deleted_at が null のものだけを返します。
 *
 * 【安全のための決まり】
 * ・登録や更新は、1回の取引（トランザクション）で行う。途中で失敗したら、すべて取り消される。
 * ・データベースを削除する処理（deleteDatabase）は、このアプリには存在しない。
 * ・全件を消す処理は、このファイルにはない（実データを守るため）。
 * ・保存先を開けなかったときは、メモリ上に切り替えず、エラーにする（消える保存に黙って切り替えない）。
 * ・読み込み（復元）は「追加だけ」。今のデータの上書き・削除済みの復活はしない。
 *   ファイルを検証 → 差分を作る → 確認後に1回の取引で追加（途中で失敗したらすべて取り消し）。
 */
(function () {
  'use strict';

  var DB_NAME = 'bansho-shoko';
  var DB_VERSION = 1;
  var STORES = ['items', 'categories', 'meta'];

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function now() { return new Date().toISOString(); }
  function normName(s) {
    // 全角半角・大文字小文字・空白の違いを無視して比べる
    return String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  }
  function reqP(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  function createIdbStorage() {
    /* ---- データベースを開く ---- */
    var dbPromise = null;
    function openDb() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (res, rej) {
        if (!window.indexedDB) {
          rej(new Error('この環境では、端末内の保存が使えません。'));
          return;
        }
        var r;
        try { r = indexedDB.open(DB_NAME, DB_VERSION); }
        catch (e) { rej(new Error('端末内の保存を開けませんでした。')); return; }
        r.onupgradeneeded = function () {
          var db = r.result;
          STORES.forEach(function (name) {
            if (!db.objectStoreNames.contains(name)) {
              db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
            }
          });
        };
        r.onblocked = function () { rej(new Error('ほかの画面で開いているため、保存先を開けません。開いている画面を閉じてください。')); };
        r.onerror = function () { rej(new Error('端末内の保存を開けませんでした。')); };
        r.onsuccess = function () {
          var db = r.result;
          // 同じ名前の別のデータベースがあった場合に備えて、中身の形を確かめる（壊さずに止める）
          var ok = STORES.every(function (n) { return db.objectStoreNames.contains(n); });
          if (!ok) {
            db.close();
            rej(new Error('保存先の形が想定と違うため、安全のため停止しました。'));
            return;
          }
          // 別の画面がバージョン変更を求めた場合は、接続を閉じて譲る
          db.onversionchange = function () { db.close(); dbPromise = null; };
          res(db);
        };
      });
      // 開けなかったときは、次回また試せるようにする
      dbPromise.catch(function () { dbPromise = null; });
      return dbPromise;
    }

    // 1回の取引にまとめて実行する。途中で失敗したら、すべて取り消される
    function tx(stores, mode, fn) {
      return openDb().then(function (db) {
        return new Promise(function (res, rej) {
          var t, result;
          try { t = db.transaction(stores, mode); }
          catch (e) { rej(new Error('保存できませんでした。ページを開き直してください。')); return; }
          t.oncomplete = function () { res(result); };
          t.onerror = function () { rej(t.error || new Error('保存できませんでした。')); };
          t.onabort = function () { rej(t.error || (t._appError) || new Error('保存を中止しました。既存のデータは変わっていません。')); };
          function fail(err) { t._appError = err; try { t.abort(); } catch (e) { /* すでに終了 */ } }
          var ret;
          try { ret = fn(t, fail); } catch (e) { fail(e); return; } // 途中で例外が出ても、取引ごと取り消す
          Promise.resolve(ret).then(function (v) { result = v; }, fail);
        });
      });
    }

    function cleanItem(it) { return JSON.parse(JSON.stringify(it)); }

    // 全件（削除したものを含む）と、最後の保存操作の日時を読む
    function readAll() {
      return tx(['items', 'categories', 'meta'], 'readonly', function (t) {
        return Promise.all([
          reqP(t.objectStore('items').getAll()),
          reqP(t.objectStore('categories').getAll()),
          reqP(t.objectStore('meta').get('last_export')),
          reqP(t.objectStore('meta').get('restored_at'))
        ]).then(function (r) {
          return { items: r[0], cats: r[1], last: r[2] ? r[2].value : null, restored: r[3] ? r[3].value : null };
        });
      });
    }

    /* ---- 復元（読み込み）の部品 ---- */
    var MAX_FILE_CHARS = 50 * 1024 * 1024;
    var ITEM_KEYS = ['id', 'title', 'reading', 'meaning', 'example', 'supplement', 'memo', 'category_id', 'created_at', 'updated_at', 'deleted_at'];
    var CAT_KEYS = ['id', 'name', 'created_at', 'updated_at', 'deleted_at'];
    var TEXT_KEYS = ['reading', 'example', 'supplement', 'memo'];
    function isIso(s) { return typeof s === 'string' && !isNaN(Date.parse(s)); }
    function pick(o, keys) { var r = {}; keys.forEach(function (k) { r[k] = o[k] === undefined ? null : o[k]; }); return r; }
    // 内容が同じか（null と空文字は同じ扱い）
    function sameRec(a, b, keys) {
      return keys.every(function (k) { return (a[k] == null ? '' : a[k]) === (b[k] == null ? '' : b[k]); });
    }

    // ファイルの中身を検証する。1つでも不正があれば、何も読み込まずに止める
    function parseBackup(text) {
      if (typeof text !== 'string') return { ok: false, errors: ['ファイルを読み込めませんでした。'] };
      if (text.length > MAX_FILE_CHARS) return { ok: false, errors: ['ファイルが大きすぎます。'] };
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      var doc;
      try { doc = JSON.parse(text); }
      catch (e) { return { ok: false, errors: ['JSONとして読めません。万象書庫のバックアップファイルを選んでください。'] }; }
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, errors: ['形式が違います。'] };
      var errs = [];
      if (doc.format !== 'bansho-backup') errs.push('万象書庫のバックアップファイルではありません。');
      if (doc.schema_version !== 1) errs.push('未対応の版です（schema_version: ' + String(doc.schema_version) + '）。');
      if (!Array.isArray(doc.items)) errs.push('知識（items）の形式が違います。');
      if (!Array.isArray(doc.categories)) errs.push('カテゴリー（categories）の形式が違います。');
      if (errs.length) return { ok: false, errors: errs };

      var catIds = {}, seenC = {}, seenI = {}, cats = [], items = [];
      doc.categories.forEach(function (c, i) {
        var p = 'カテゴリー' + (i + 1) + '：';
        if (!c || typeof c !== 'object' || Array.isArray(c)) { errs.push(p + '形式が違います。'); return; }
        if (typeof c.id !== 'string' || !c.id || c.id.length > 200) { errs.push(p + 'IDが不正です。'); return; }
        if (seenC[c.id]) { errs.push(p + 'IDが重複しています。'); return; }
        seenC[c.id] = true; catIds[c.id] = true;
        if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 1000) errs.push(p + '名前が不正です。');
        if (!isIso(c.created_at) || !isIso(c.updated_at)) errs.push(p + '日時の形式が不正です。');
        if (c.deleted_at != null && !isIso(c.deleted_at)) errs.push(p + '削除日時の形式が不正です。');
        cats.push(pick(c, CAT_KEYS));
      });
      doc.items.forEach(function (it, i) {
        var p = '知識' + (i + 1) + '：';
        if (!it || typeof it !== 'object' || Array.isArray(it)) { errs.push(p + '形式が違います。'); return; }
        if (typeof it.id !== 'string' || !it.id || it.id.length > 200) { errs.push(p + 'IDが不正です。'); return; }
        if (seenI[it.id]) { errs.push(p + 'IDが重複しています。'); return; }
        seenI[it.id] = true;
        if (typeof it.title !== 'string' || !it.title.trim() || it.title.length > 10000) errs.push(p + 'タイトルが不正です。');
        if (typeof it.meaning !== 'string' || !it.meaning.trim()) errs.push(p + '意味・説明が不正です。');
        TEXT_KEYS.forEach(function (k) { if (it[k] != null && typeof it[k] !== 'string') errs.push(p + k + 'が不正です。'); });
        if (it.category_id != null && (typeof it.category_id !== 'string' || !catIds[it.category_id])) errs.push(p + 'カテゴリーが見つかりません。');
        if (!isIso(it.created_at) || !isIso(it.updated_at)) errs.push(p + '日時の形式が不正です。');
        if (it.deleted_at != null && !isIso(it.deleted_at)) errs.push(p + '削除日時の形式が不正です。');
        var rec = pick(it, ITEM_KEYS);
        TEXT_KEYS.forEach(function (k) { if (rec[k] === null) rec[k] = ''; });
        items.push(rec);
      });
      if (errs.length) {
        if (errs.length > 10) { var n = errs.length - 10; errs = errs.slice(0, 10); errs.push('ほかにも' + n + '件あります。'); }
        return { ok: false, errors: errs };
      }
      return { ok: true, errors: [], doc: { exported_at: isIso(doc.exported_at) ? doc.exported_at : null, items: items, categories: cats } };
    }

    // どう扱うかを決める。決まりは次のとおり（自動で上書き・復活はしない）
    //   今のデータにない        → 追加
    //   内容が同じ              → 何もしない
    //   今は削除済み・ファイルでは有効 → 削除済みのまま（復活させない）
    //   それ以外で内容が違う    → 今のデータを残す
    function planFrom(doc, li, lc) {
      var LI = {}, LC = {}, names = {};
      li.forEach(function (x) { LI[x.id] = x; });
      lc.forEach(function (x) { LC[x.id] = x; if (!x.deleted_at) names[normName(x.name)] = true; });
      var res = {
        items: { add: [], same: 0, keep: [], keepDeleted: [] },
        cats: { add: [], same: 0, keep: [], keepDeleted: [] }
      };
      function decide(b, l, keys, bucket, label) {
        if (!l) return false;
        if (sameRec(l, b, keys)) bucket.same++;
        else if (l.deleted_at && !b.deleted_at) bucket.keepDeleted.push({ label: label });
        else bucket.keep.push({ label: label, reason: (!l.deleted_at && b.deleted_at) ? 'backup-deleted' : 'differs' });
        return true;
      }
      doc.categories.forEach(function (b) {
        if (decide(b, LC[b.id], CAT_KEYS, res.cats, b.name)) return;
        res.cats.add.push({ rec: b, label: b.name, dupName: !b.deleted_at && !!names[normName(b.name)] });
      });
      doc.items.forEach(function (b) {
        if (decide(b, LI[b.id], ITEM_KEYS, res.items, b.title)) return;
        res.items.add.push({ rec: b, label: b.title });
      });
      return res;
    }
    function labelsOf(list) {
      return list.map(function (x) {
        return { label: x.label, dupName: !!x.dupName, reason: x.reason || '', deleted: !!(x.rec && x.rec.deleted_at) };
      });
    }

    return {
      kind: 'indexeddb',
      label: 'この端末の中（IndexedDB）',
      persistent: true,

      /* 知識 */
      listItems: function () {
        return tx(['items'], 'readonly', function (t) {
          return reqP(t.objectStore('items').getAll());
        }).then(function (all) {
          var list = all.filter(function (i) { return !i.deleted_at; });
          list.sort(function (a, b) { return b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0; });
          return list;
        });
      },
      saveItem: function (input) {
        var title = String(input.title || '').trim();
        var meaning = String(input.meaning || '').trim();
        if (!title || !meaning) return Promise.reject(new Error('タイトルと意味・説明は必須です。'));
        var fields = {
          title: title, meaning: meaning,
          reading: String(input.reading || '').trim(),
          example: String(input.example || '').trim(),
          supplement: String(input.supplement || '').trim(),
          memo: String(input.memo || '').trim(),
          category_id: input.category_id || null
        };
        return tx(['items'], 'readwrite', function (t, fail) {
          var os = t.objectStore('items');
          var at = now();
          var p = input.id ? reqP(os.get(input.id)) : Promise.resolve(null);
          return p.then(function (cur) {
            var it;
            if (cur) {
              it = Object.assign({}, cur, fields, { updated_at: at });
            } else {
              it = Object.assign({ id: input.id || uid(), created_at: at, updated_at: at, deleted_at: null }, fields);
            }
            os.put(it);
            return cleanItem(it);
          });
        });
      },
      softDeleteItem: function (id) {
        return tx(['items'], 'readwrite', function (t, fail) {
          var os = t.objectStore('items');
          return reqP(os.get(id)).then(function (cur) {
            if (!cur) { fail(new Error('知識が見つかりません。')); return; }
            var at = now();
            cur.deleted_at = at; cur.updated_at = at;
            os.put(cur);
          });
        });
      },

      /* カテゴリー */
      listCategories: function () {
        return tx(['categories'], 'readonly', function (t) {
          return reqP(t.objectStore('categories').getAll());
        }).then(function (all) { return all.filter(function (c) { return !c.deleted_at; }); });
      },
      saveCategory: function (input) {
        var name = String(input.name || '').trim();
        if (!name) return Promise.reject(new Error('カテゴリー名を入力してください。'));
        return tx(['categories'], 'readwrite', function (t, fail) {
          var os = t.objectStore('categories');
          return reqP(os.getAll()).then(function (all) {
            var n = normName(name);
            var dup = all.some(function (c) { return !c.deleted_at && c.id !== input.id && normName(c.name) === n; });
            if (dup) { fail(new Error('同じ名前のカテゴリーがすでにあります。')); return; }
            var at = now();
            var cur = input.id ? all.filter(function (c) { return c.id === input.id; })[0] : null;
            var c;
            if (cur) { c = Object.assign({}, cur, { name: name, updated_at: at }); }
            else { c = { id: uid(), name: name, created_at: at, updated_at: at, deleted_at: null }; }
            os.put(c);
            return cleanItem(c);
          });
        });
      },
      // fromId のカテゴリーを toId に統合する。ユーザーが選んだときだけ呼ぶ（自動統合はしない）
      // 知識の付け替えとカテゴリーの削除印を、1回の取引でまとめて行う（片方だけ反映されることはない）
      mergeCategories: function (fromId, toId) {
        if (!fromId || !toId || fromId === toId) {
          return Promise.reject(new Error('統合するカテゴリーを正しく選んでください。'));
        }
        return tx(['items', 'categories'], 'readwrite', function (t, fail) {
          var cs = t.objectStore('categories'), is = t.objectStore('items');
          return Promise.all([reqP(cs.get(fromId)), reqP(cs.get(toId)), reqP(is.getAll())]).then(function (r) {
            var from = r[0], to = r[1], all = r[2];
            if (!from || !to) { fail(new Error('統合するカテゴリーを正しく選んでください。')); return; }
            var at = now();
            all.forEach(function (i) {
              if (i.category_id === fromId) { i.category_id = toId; i.updated_at = at; is.put(i); }
            });
            from.deleted_at = at; from.updated_at = at;
            cs.put(from);
          });
        });
      },

      /* バックアップ（書き出し）。読み取りだけで、データは変えない */
      // 削除したものも含めて、すべてのデータを1つのJSON文字列にまとめる
      exportSnapshot: function () {
        return readAll().then(function (r) {
          var at = now();
          var obj = {
            format: 'bansho-backup',
            schema_version: 1,
            exported_at: at,
            items: r.items,
            categories: r.cats
          };
          var stamp = at.replace(/[-:]/g, '').slice(0, 15).replace('T', '-'); // 例：20261107-213000
          return {
            text: JSON.stringify(obj),
            filename: 'bansho-backup-' + stamp + '.json',
            itemCount: r.items.length,
            catCount: r.cats.length
          };
        });
      },
      // 最後に「保存操作」を確認した日時と、それ以降に変更があるかを返す
      // ※ iCloud Drive に保存されたかは、アプリからは確認できない
      backupStatus: function () {
        return readAll().then(function (r) {
          var all = r.items.concat(r.cats);
          var unsaved = r.last === null
            ? all.length > 0
            : all.some(function (x) { return (x.updated_at || '') > r.last; });
          // 読み込み（復元）で追加があった場合も、そのあとに書き出していなければ「未保存」とする
          if (r.restored && (r.last === null || r.restored > r.last)) unsaved = true;
          return { last: r.last, unsaved: unsaved };
        });
      },
      /* 復元（読み込み） */
      // ファイルの検証だけ。データは変えない
      parseBackup: function (text) {
        var r = parseBackup(text);
        return r.ok ? { ok: true, errors: [], exported_at: r.doc.exported_at } : r;
      },
      // 差分の一覧を作る。読み取りだけで、データは変えない
      planRestore: function (text) {
        var r = parseBackup(text);
        if (!r.ok) return Promise.reject(new Error(r.errors.join('\n')));
        return readAll().then(function (cur) {
          var p = planFrom(r.doc, cur.items, cur.cats);
          return {
            exported_at: r.doc.exported_at,
            items: { add: labelsOf(p.items.add), same: p.items.same, keep: labelsOf(p.items.keep), keepDeleted: labelsOf(p.items.keepDeleted) },
            cats: { add: labelsOf(p.cats.add), same: p.cats.same, keep: labelsOf(p.cats.keep), keepDeleted: labelsOf(p.cats.keepDeleted) }
          };
        });
      },
      // 追加するものだけを、1回の取引で反映する。途中で失敗したら、すべて取り消される。
      // 既存のデータは上書きしない（追加は add を使うため、同じIDがあれば失敗して取り消される）。
      applyRestore: function (text) {
        var r = parseBackup(text);
        if (!r.ok) return Promise.reject(new Error(r.errors.join('\n')));
        return tx(['items', 'categories', 'meta'], 'readwrite', function (t) {
          var is = t.objectStore('items'), cs = t.objectStore('categories'), ms = t.objectStore('meta');
          return Promise.all([reqP(is.getAll()), reqP(cs.getAll())]).then(function (cur) {
            var p = planFrom(r.doc, cur[0], cur[1]);
            p.cats.add.forEach(function (x) { cs.add(x.rec); });
            p.items.add.forEach(function (x) { is.add(x.rec); });
            if (p.cats.add.length + p.items.add.length > 0) ms.put({ key: 'restored_at', value: now() });
            return { items: p.items.add.length, cats: p.cats.add.length };
          });
        });
      },
      // 保存操作を確認したときだけ呼ぶ
      markExported: function (at) {
        return tx(['meta'], 'readwrite', function (t) {
          return reqP(t.objectStore('meta').put({ key: 'last_export', value: at }));
        });
      }
    };
  }

  window.BanshoStorage = createIdbStorage();
})();
