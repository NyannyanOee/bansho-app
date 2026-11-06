/*
 * 万象書庫 保存の受け口（storage.js）
 *
 * 画面（app.js）は、ここに定義した関数だけを通してデータを読み書きします。
 * 保存先がどこか（メモリ上・Supabase・端末内など）を画面は知りません。
 * 保存先が決まったら、このファイルの中身だけを差し替えます。
 *
 * 【現在の状態：A段階】
 * 仮保存（メモリ上）です。画面を閉じる・再読み込みすると、データはすべて消えます。
 * 実データを入れて使うものではありません。
 *
 * 【データの形】
 * 知識  : id, title, meaning, example, supplement, memo, category_id,
 *         created_at, updated_at, deleted_at（削除していなければ null）
 * カテゴリー: id, name, created_at, updated_at, deleted_at
 *
 * 1つの知識に付けるカテゴリーは、今は1つだけ（category_id）。
 * 複数カテゴリーにするかは保留のため、確定ではありません。
 *
 * 削除は論理削除です。deleted_at に日時を記録し、データ自体は消しません。
 * 一覧などには deleted_at が null のものだけを返します。
 */
(function () {
  'use strict';

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function now() { return new Date().toISOString(); }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function normName(s) {
    // 全角半角・大文字小文字・空白の違いを無視して比べる
    return String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  }

  function createMemoryStorage() {
    var items = [];
    var cats = [];

    function activeCats() { return cats.filter(function (c) { return !c.deleted_at; }); }
    function findItem(id) {
      for (var i = 0; i < items.length; i++) { if (items[i].id === id) return items[i]; }
      return null;
    }
    function findCat(id) {
      for (var i = 0; i < cats.length; i++) { if (cats[i].id === id) return cats[i]; }
      return null;
    }
    function addCat(name, at) {
      var c = { id: uid(), name: name, created_at: at, updated_at: at, deleted_at: null };
      cats.push(c);
      return c;
    }
    function assertCatNameFree(name, exceptId) {
      var n = normName(name);
      activeCats().forEach(function (c) {
        if (c.id !== exceptId && normName(c.name) === n) {
          throw new Error('同じ名前のカテゴリーがすでにあります。');
        }
      });
    }

    /* ---- 画面確認用の架空データ（A段階だけ） ---- */
    function seed() {
      items = []; cats = [];
      var names = ['数学', '哲学', '心理学', '科学', '言葉', '雑学', '心理'];
      var base = Date.UTC(2026, 9, 1, 3, 0, 0);
      var cid = {};
      names.forEach(function (n, i) { cid[n] = addCat(n, new Date(base + i * 1000).toISOString()).id; });
      var rows = [
        ['2026-10-20T09:10:00', '数学', '三角形の内角の和',
          '平面上の三角形では、3つの内角を足すと必ず180度になる。',
          '直角三角形なら、直角（90度）と残りの2つの角の合計が90度になる。',
          '球面のように曲がった面の上では、内角の和が180度を超える。「180度」は平らな面を前提にした性質。',
          '平行線の錯角を使った証明を、もう一度ノートで追いかける。\n参考：https://ja.wikipedia.org/wiki/三角形\n球面幾何学との違いも調べたい。'],
        ['2026-10-24T21:40:00', '哲学', 'ソクラテスの問答法',
          '相手に問いを重ね、その人自身の考えの矛盾や曖昧さに気づかせながら、より確かな理解へ導く対話の方法。',
          '「正義とは何か」と問い、返ってきた答えに反例を出して、定義を作り直していく。',
          '答えを教えるのではなく、問いによって相手が自分で考えることを促す点が特徴。プラトンの対話篇を通して知られている。',
          '日常の会話でも使えそうか試したい。\nhttps://ja.wikipedia.org/wiki/ソクラテス\n「産婆術」という呼び方との関係も確認する。'],
        ['2026-10-27T12:00:00', '心理学', '認知的不協和',
          '矛盾する考えや行動を同時に抱えたときに感じる不快感と、それを減らそうとする心の働き。',
          '健康に悪いと知りながら喫煙する人が、「少しなら大丈夫」と考えて不快感をやわらげる。',
          '心理学者レオン・フェスティンガーが1950年代に提唱した理論。',
          '「やめたいのにやめられない」場面にも当てはまるか、自分の例で考えてみる。\nhttps://ja.wikipedia.org/wiki/認知的不協和'],
        ['2026-10-29T08:30:00', '心理学', '確証バイアス',
          '自分の考えを支持する情報ばかり集め、反する情報を軽く見てしまう傾向。',
          '「血液型で性格が決まる」と信じていると、当てはまる例ばかり目に入る。',
          '認知バイアスの代表例。知っていても完全には避けにくいとされる。',
          '反証になる情報を、意識して探す習慣を作りたい。'],
        ['2026-10-30T19:15:00', '科学', '光合成',
          '植物などが光のエネルギーを使い、二酸化炭素と水から糖をつくり、酸素を出す反応。',
          '葉に日が当たると、気孔から入った二酸化炭素が使われて、でんぷんがつくられる。',
          '反応は主に葉緑体の中で進む。',
          '明反応とカルビン回路の違いを、あとで図にして整理する。'],
        ['2026-11-01T10:05:00', '言葉', '情けは人の為ならず',
          '人に情けをかけておけば、巡り巡って自分にも良い報いがある、という意味。',
          '道に迷った人を案内したら、後日、自分も別の場面で助けてもらった。',
          '「人のためにならない」という意味に取り違えて使われることが多い言葉。',
          '取り違えの割合を示した調査があるはず。出典を確認する。\nhttps://www.bunka.go.jp/'],
        ['2026-11-02T22:20:00', '心理', 'マジカルナンバー7±2',
          '人が短い時間に覚えていられる情報のまとまりの数は、およそ7個前後（±2）という考え方。',
          '電話番号を3〜4桁ずつ区切ると、覚えやすくなる。',
          'ジョージ・ミラーが1956年に発表。のちの研究では、まとまり（チャンク）の数は4個前後とする見方もある。',
          'チャンクの考え方をもう少し詳しく調べる。'],
        ['2026-11-04T07:45:00', '雑学', '雷紋',
          '四角い渦巻きを連続させた、中国の伝統的な幾何学文様。',
          '中華料理店の器やのれんの縁取りで見かける。',
          '古くは青銅器の装飾にも見られる。',
          'このアプリの飾りにも使う予定。']
      ];
      rows.forEach(function (r) {
        var at = new Date(r[0] + '+09:00').toISOString();
        items.push({
          id: uid(), title: r[2], meaning: r[3], example: r[4], supplement: r[5], memo: r[6],
          category_id: cid[r[1]], created_at: at, updated_at: at, deleted_at: null
        });
      });
    }
    seed();

    return {
      kind: 'memory',
      label: '仮保存（メモリ上）',
      persistent: false,

      /* 知識 */
      listItems: function () {
        var list = items.filter(function (i) { return !i.deleted_at; });
        list.sort(function (a, b) { return b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0; });
        return Promise.resolve(copy(list));
      },
      saveItem: function (input) {
        var title = String(input.title || '').trim();
        var meaning = String(input.meaning || '').trim();
        if (!title || !meaning) return Promise.reject(new Error('タイトルと意味・説明は必須です。'));
        var at = now();
        var fields = {
          title: title, meaning: meaning,
          example: String(input.example || '').trim(),
          supplement: String(input.supplement || '').trim(),
          memo: String(input.memo || '').trim(),
          category_id: input.category_id || null
        };
        var it = input.id ? findItem(input.id) : null;
        if (it) {
          Object.keys(fields).forEach(function (k) { it[k] = fields[k]; });
          it.updated_at = at;
        } else {
          it = Object.assign({ id: uid(), created_at: at, updated_at: at, deleted_at: null }, fields);
          items.push(it);
        }
        return Promise.resolve(copy(it));
      },
      softDeleteItem: function (id) {
        var it = findItem(id);
        if (!it) return Promise.reject(new Error('知識が見つかりません。'));
        var at = now();
        it.deleted_at = at; it.updated_at = at;
        return Promise.resolve();
      },

      /* カテゴリー */
      listCategories: function () { return Promise.resolve(copy(activeCats())); },
      saveCategory: function (input) {
        var name = String(input.name || '').trim();
        if (!name) return Promise.reject(new Error('カテゴリー名を入力してください。'));
        try { assertCatNameFree(name, input.id); } catch (e) { return Promise.reject(e); }
        var at = now(), c = input.id ? findCat(input.id) : null;
        if (c) { c.name = name; c.updated_at = at; }
        else { c = addCat(name, at); }
        return Promise.resolve(copy(c));
      },
      // fromId のカテゴリーを toId に統合する。ユーザーが選んだときだけ呼ぶ（自動統合はしない）
      mergeCategories: function (fromId, toId) {
        var from = findCat(fromId), to = findCat(toId);
        if (!from || !to || fromId === toId) return Promise.reject(new Error('統合するカテゴリーを正しく選んでください。'));
        var at = now();
        items.forEach(function (i) { if (i.category_id === fromId) { i.category_id = toId; i.updated_at = at; } });
        from.deleted_at = at; from.updated_at = at;
        return Promise.resolve();
      },

      /* 画面確認用（A段階だけ。保存先が決まったら外す） */
      resetSample: function () { seed(); return Promise.resolve(); },
      clearAll: function () { items = []; cats = []; return Promise.resolve(); }
    };
  }

  window.BanshoStorage = createMemoryStorage();
})();
