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
 * ・全件を消す処理は、実データがあるため無効にしてある（clearAll / resetSample）。
 * ・保存先を開けなかったときは、メモリ上に切り替えず、エラーにする（消える保存に黙って切り替えない）。
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
          Promise.resolve(fn(t, fail)).then(function (v) { result = v; }, fail);
        });
      });
    }

    function cleanItem(it) { return JSON.parse(JSON.stringify(it)); }

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

      /* 画面確認用の全件操作は、実データがあるため無効にしてある */
      resetSample: function () { return Promise.reject(new Error('実データがあるため、この操作は使えません。')); },
      clearAll: function () { return Promise.reject(new Error('実データがあるため、この操作は使えません。')); }
    };
  }

  window.BanshoStorage = createIdbStorage();
})();
