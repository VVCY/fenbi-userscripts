// ==UserScript==
// @name         粉笔题库·悬浮查词（成语/词语）
// @namespace    local.doubao.fenbi-hover-word
// @version      3.18.3
// @description  v3.15.0 收藏数据格式从 Markdown 词块改为整份 JSON 文档仅题目区域触发，不影响答题。
// @author       doubao
// @match        https://fenbi.com/*
// @match        https://*.fenbi.com/*
// @match        http://fenbi.com/*
// @match        http://*.fenbi.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      zdic.net
// @connect      www.zdic.net
// @connect      hanyu.baidu.com
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      gh-proxy.com
// @connect      ghfast.top
// @connect      dav.jianguoyun.com
// @connect      *
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ================= 配置 ================= */
  var CONFIG = {
    dictStorageKey: 'fw_idiom_dict_v1',
    wordDictStorageKey: 'fw_word_boundary_v1', // 分词词表缓存（只存词，不存释义）
    wordCachePrefix: 'fw_word_cache_',
    wordCacheTtl: 30 * 24 * 60 * 60 * 1000,   // 在线查询结果缓存 30 天
    queryBase: 'https://www.zdic.net/hans/',      // 在线释义查询源（汉典，页面结构固定、已有解析器）
    jumpBase: 'https://hanyu.baidu.com/s?wd=',    // 中键跳转查词源（百度汉语，收词更全）
    rmwBase: 'http://search.people.cn/s/?keyword=', // 人民网搜索：查该成语在新闻/评论里的实际用法
    favEnabled: true,          // 一键收藏：v3.7.0 实装 —— 把当前词的释义卡片经 WebDAV 写入坚果云
    favWebdavPath: 'fenbi/word-favorites/index.json', // v3.16.0：一键收藏默认保存路径
    favNoteEnabled: true, // v3.17.0：是否启用收藏笔记功能
    favNotePlaceholder: '请输入笔记（支持多行，收藏时自动保存）', // v3.17.0：笔记输入框占位提示（相对 WebDAV 根目录），旧 .md 路径启动时自动迁移
    queryTimeout: 8000,        // 单次在线查询超时
    dictTimeout: 60000,        // 单个词库源超时
    wordDictTimeout: 60000,    // 分词词表源超时
    moveThrottle: 50,          // mousemove 节流（ms）
    stemDwell: 400,            // 题干里停留多久才联网查词（ms）
    enrichLocal: true          // 本地词库命中后，再联网补充"用法语境/近反义"
  };
  // 成语词库下载源（按实测速度排序；请求会自动携带 gzip，实际传输约 3.7MB）
  var DICT_SOURCES = [
    { url: 'https://cdn.jsdelivr.net/gh/pwxcoo/chinese-xinhua@master/data/idiom.json', tag: 'jsDelivr' },
    { url: 'https://gh-proxy.com/https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/idiom.json', tag: '国内加速1' },
    { url: 'https://ghfast.top/https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/idiom.json', tag: '国内加速2' },
    { url: 'https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/idiom.json', tag: 'GitHub 源站' }
  ];

  // 分词词表（jieba 词典，约 1.4MB / 34.9 万词，只保留 2~6 字词）：
  // 作用不是给释义，而是判定"词边界"——只有表里真实存在的词才允许被选中，
  // 从根本上杜绝"医生：患者 → 医生患者""遏制蔓延 → 遏制蔓延"这类把两个词并成一个词的错误。
  var WORD_SOURCES = [
    { url: 'https://cdn.jsdelivr.net/gh/fxsjy/jieba@master/jieba/dict.txt', tag: 'jsDelivr' },
    { url: 'https://gh-proxy.com/https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt', tag: '国内加速1' },
    { url: 'https://ghfast.top/https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt', tag: '国内加速2' },
    { url: 'https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt', tag: 'GitHub 源站' }
  ];

  /* ================= 状态 ================= */
  var dict = null;              // { 成语: {p,e,d,x} }
  var dictLoaded = false;
  var dictSkip = false;         // 用户点击"跳过"后为 true
  var dictDownloading = false;
  var lastDictPct = -1;

  var wordSet = null;           // Set<词>：分词词表，仅用于判定词边界
  var wordSetLoading = false;

  var inflight = new Map();     // word -> Promise（在途在线查询）
  var memoryCache = new Map();  // word -> 在线结果（内存缓存）

  var tipEl = null;
  var tipVisible = false;
  var currentWord = null;       // 当前 tooltip 展示的词
  var currentKind = null;       // 'option' | 'stem'
  var currentData = null;       // v3.7.0：当前展示的释义数据（收藏时直接用它，避免再查一次导致字段缺失）
  var querySeq = 0;             // 查询序号，防止异步乱序覆盖

  var pendingTimer = null;      // 题干"停留后才联网"的定时器
  var pendingWord = null;

  var lastMoveTs = 0;
  var hoverEl = null;
  var lastMX = 0, lastMY = 0;   // 最近一次鼠标位置：拿不到"词级"位置时，悬浮窗贴着鼠标显示

  var toastEl = null;
  var toastTimer = null;

  /* ================= 小工具 ================= */
  function gmGet(key) { try { return GM_getValue(key); } catch (e) { return undefined; } }
  function gmSet(key, val) { try { GM_setValue(key, val); } catch (e) { /* 存储不可用时忽略 */ } }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function isHanzi(ch) { return /[\u4e00-\u9fa5]/.test(ch); }
  var HANZI_RE = /^[\u4e00-\u9fa5]+$/;          // 纯汉字（无标点/数字/字母）
  var HANZI_WORD_RE = /^[\u4e00-\u9fa5·]+$/;    // 纯汉字（允许姓名间隔号）
  function cleanText(s) {
    return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function compactText(s) {
    return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, '').trim();
  }
  /* 词库里的"出处"常带整句书证（与例句重复），只保留到书名号结束 */
  function shortenSource(s) {
    var t = cleanText(s);
    if (t.length <= 32) return t;
    var m = t.match(/^[\s\S]{0,18}?《[^》]{1,22}》/);
    return m ? m[0] : t.slice(0, 32) + '…';
  }

  /* ================= 用法/语境抽取（纯逻辑，可单测） =================
     汉典没有独立的"用法"分区，语境信息藏在"百科"描述句与释义里，
     如"多形容新生事物正在蓬勃发展""常用来比喻……"，用提示词抓句子。
     注意：不要放裸的"指"，否则"是指……"这种句子会被误抓。 */
  var USAGE_RE = /(多用于|多形容|多指|常用于|借指|泛指|形容|比喻|含褒义|含贬义|褒义|贬义|用于)[^。；;！？]{2,50}/g;
  function usageFromText(text, max) {
    if (!text) return '';
    // 百科句常写成"…比喻眼光远大，出自《论衡》"，把"出自/语出"之后的书证切掉
    var src = String(text).split(/[，,]?\s*(?:出自|语出|源自|源出)/)[0];
    var hits = [], m, limit = max || 2;
    USAGE_RE.lastIndex = 0;
    while ((m = USAGE_RE.exec(src)) !== null && hits.length < limit) {
      var s = m[0].replace(/^[，,、\s]+/, '').trim().replace(/[，,、；;]+$/, '');
      if (s.length >= 4 && hits.indexOf(s) < 0) hits.push(s);
    }
    return hits.join('；').slice(0, 140);
  }

  /* ================= 成语词库加载 ================= */
  function loadDict() {
    if (dictLoaded) return;
    var cached = gmGet(CONFIG.dictStorageKey);
    if (cached) {
      try {
        var obj = JSON.parse(cached);
        if (obj && typeof obj === 'object' && Object.keys(obj).length > 500) {
          dict = obj;
          dictLoaded = true;
          showToast('成语词库已就绪（' + Object.keys(dict).length + ' 条，离线秒开）', 1800);
          return;
        }
      } catch (e) { /* 缓存损坏则重新下载 */ }
    }
    showToast('首次使用：正在下载成语词库（约10MB，仅一次）…下载期间悬停词语走在线查询', 0, '跳过下载', function () {
      dictSkip = true;
      hideToast();
    }, 0);
    startDictDownload(0);
  }

  function startDictDownload(idx) {
    if (idx >= DICT_SOURCES.length) { failDict(); return; }
    var src = DICT_SOURCES[idx];
    dictDownloading = true;
    lastDictPct = -1;
    GM_xmlhttpRequest({
      method: 'GET',
      url: src.url,
      timeout: CONFIG.dictTimeout,
      onload: function (res) {
        try {
          var arr = JSON.parse(res.responseText);
          if (!Array.isArray(arr) || arr.length < 500) throw new Error('bad data');
          var map = {};
          arr.forEach(function (it) {
            if (it && it.word) map[it.word] = { p: it.pinyin, e: it.explanation, d: it.derivation, x: it.example };
          });
          dict = map;
          dictLoaded = true;
          dictDownloading = false;
          try { gmSet(CONFIG.dictStorageKey, JSON.stringify(map)); } catch (e) {}
          hideToast();
          showToast(dictSkip
            ? '成语词库已在后台加载完成（' + Object.keys(map).length + ' 条），此后悬停成语秒开'
            : '成语词库加载完成（' + Object.keys(map).length + ' 条，来自' + src.tag + '）', 3000);
        } catch (e) { nextDictSource(idx); }
      },
      onerror: function () { nextDictSource(idx); },
      ontimeout: function () { nextDictSource(idx); },
      onprogress: function (e) {
        if (dictSkip) return;
        if (e && e.lengthComputable && e.total > 0) {
          var pct = Math.floor(e.loaded / e.total * 100);
          if (pct !== lastDictPct) {
            lastDictPct = pct;
            showToast('正在下载成语词库 ' + pct + '%（' + fmtMB(e.loaded) + ' / ' + fmtMB(e.total) + ' MB）…下载期间悬停词语也可查词', 0, '跳过', function () {
              dictSkip = true;
              hideToast();
            }, pct);
          }
        }
      }
    });
  }

  function nextDictSource(idx) { startDictDownload(idx + 1); }
  function fmtMB(bytes) { return (bytes / 1048576).toFixed(1); }

  function failDict() {
    dictDownloading = false;
    dictSkip = false;
    showToast('成语词库下载失败，当前使用在线查询（每个词联网取义，稍慢）', 0, '重试', function () {
      hideToast();
      startDictDownload(0);
    });
  }

  function lookupDict(word) { return (dictLoaded && dict) ? dict[word] : null; }

  /* ================= 分词词表：词边界（防"两个词并成一个词"） ================= */
  function loadWordSet() {
    if (wordSet || wordSetLoading) return;
    wordSetLoading = true;
    var cached = gmGet(CONFIG.wordDictStorageKey);
    if (cached && cached.length > 50000) {
      buildWordSet(cached);
      wordSetLoading = false;
      return;
    }
    startWordDownload(0);
  }
  function buildWordSet(joined) {
    var set = new Set();
    var arr = String(joined).split('\n');
    for (var i = 0; i < arr.length; i++) { if (arr[i]) set.add(arr[i]); }
    wordSet = set;
  }
  function startWordDownload(idx) {
    if (idx >= WORD_SOURCES.length) { wordSetLoading = false; return; } // 静默失败：退化为只认成语词库
    var src = WORD_SOURCES[idx];
    GM_xmlhttpRequest({
      method: 'GET',
      url: src.url,
      timeout: CONFIG.wordDictTimeout,
      onload: function (res) {
        try {
          var raw = res && res.responseText ? res.responseText : '';
          if (raw.length < 100000) throw new Error('bad data');
          var lines = raw.split('\n'), keep = [], seen = new Set();
          for (var i = 0; i < lines.length; i++) {
            // jieba 词典每行形如 "循序渐进 123 x"，取词列；只留 2~6 字纯汉字
            var w = lines[i].split(' ')[0];
            if (w.length >= 2 && w.length <= 6 && HANZI_RE.test(w) && !seen.has(w)) { seen.add(w); keep.push(w); }
          }
          if (keep.length < 50000) throw new Error('bad data');
          buildWordSet(keep.join('\n'));
          wordSetLoading = false;
          try { gmSet(CONFIG.wordDictStorageKey, keep.join('\n')); } catch (e) {}
          showToast('分词词表已就绪（' + keep.length + ' 词，来自' + src.tag + '）：此后按词取词，不再把两个词并成一个', 3000);
        } catch (e) { startWordDownload(idx + 1); }
      },
      onerror: function () { startWordDownload(idx + 1); },
      ontimeout: function () { startWordDownload(idx + 1); }
    });
  }

  /* 只认"真实存在的词"：成语词库优先，其次分词词表。
     返回 null 表示这不是一个词（调用方必须放弃，不得拼接）。 */
  function lookupW(word) {
    if (!word) return null;
    var loc = lookupDict(word);
    if (loc) return { word: word, local: loc };
    if (wordSet && wordSet.has(word)) return { word: word, local: null };
    return null;
  }

  /* ================= 在线查询（汉典） ================= */
  function pullOnline(word) {
    if (inflight.has(word)) return inflight.get(word);
    var p = new Promise(function (resolve) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: CONFIG.queryBase + encodeURIComponent(word),
        timeout: CONFIG.queryTimeout,
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
        onload: function (res) {
          if (!res || !res.responseText || (res.status && res.status >= 400)) { resolve(null); return; }
          resolve(parseZdic(res.responseText, word));
        },
        onerror: function () { resolve(null); },
        ontimeout: function () { resolve(null); }
      });
    });
    inflight.set(word, p);
    p.then(function () { inflight.delete(word); }, function () { inflight.delete(word); });
    return p;
  }

  /* ---------- 汉典解析：优先按 data-section 结构化取，失败再走文本兜底 ---------- */
  function parseZdic(html, word) {
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
    if (!doc || !doc.body) return null;
    var out = parseZdicStructured(doc, word);
    if (out && (out.explanation || out.usage || out.derivation)) return out;
    var legacy = parseZdicLegacy(doc, word);
    if (legacy && (legacy.explanation || legacy.example)) return legacy;
    return out;
  }

  function textOf(root, sel) {
    if (!root) return '';
    var n = root.querySelector(sel);
    return n ? cleanText(n.textContent) : '';
  }
  function allText(root, sel) {
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll(sel))
      .map(function (n) { return cleanText(n.textContent); })
      .filter(function (s) { return !!s; });
  }
  function joinSenses(list, max) {
    var out = [], total = 0;
    for (var i = 0; i < list.length && i < max; i++) {
      var s = String(list[i]).replace(/^\d+\s*[.．、]\s*/, '').trim();
      s = s.replace(/[。；;，,、\s]+$/, '');   // 避免出现"…自如。；形容…"这种叠标点
      if (!s) continue;
      if (total + s.length > 260) break;
      out.push(s); total += s.length;
    }
    return out.join('；');
  }

  function parseZdicStructured(doc, word) {
    var out = {
      word: word, source: '汉典', pinyin: '',
      explanation: '', usage: '', derivation: '', example: '', similar: '', opposite: ''
    };

    // 1) 按 data-section 归集分区（实测：词语解释 / 国语辞典 / 百科 / 近反义词 / 翻译）
    var secs = {};
    Array.prototype.forEach.call(doc.querySelectorAll('.dict-section[data-section]'), function (s) {
      var k = cleanText(s.getAttribute('data-section'));
      if (k && !secs[k]) secs[k] = s;
    });
    // 兼容旧结构（只有标题、没有 data-section）
    if (!Object.keys(secs).length) {
      Array.prototype.forEach.call(doc.querySelectorAll('.dict-section'), function (s) {
        var t = cleanText(textOf(s, '.dict-section__title'));
        if (!t) return;
        var k = t.replace(word, '').trim();
        if (k && !secs[k]) secs[k] = s;
      });
    }

    // 2) 拼音
    out.pinyin = textOf(doc, '.word-pronun-row .meta-pinyin') ||
                 textOf(doc, '.xxjs-reading__py') ||
                 textOf(doc, '.gy-reading__py');

    // 3) 释义：词语解释的多条义项全取（最多 4 条），再退国语辞典
    var defs = allText(secs['词语解释'], '.xxjs-item__def');
    if (!defs.length) defs = allText(secs['词语解释'], '.gy-sense__def');
    if (!defs.length) defs = allText(secs['国语辞典'], '.gy-sense__def');
    if (defs.length) out.explanation = joinSenses(defs, 4);

    // 3b) 部分词条没有"词语解释"，只有"成语"分区（纯文本"解释/出处"结构）
    if (secs['成语']) {
      var cyTxt = cleanText(secs['成语'].textContent).replace(/反馈[\s\S]*$/, '').trim();
      if (!out.explanation) {
        var cm1 = cyTxt.match(/解释\s*[：:]?\s*([\s\S]*?)(?=出处|示例|用法|近义|反义|拼音|$)/);
        if (cm1 && cm1[1].trim().length > 3) out.explanation = cm1[1].trim().slice(0, 220);
      }
      if (!out.derivation) {
        var cm2 = cyTxt.match(/出处\s*[：:]?\s*([\s\S]*?)(?=示例|用法|近义|反义|拼音|$)/);
        if (cm2 && cm2[1].trim().length > 3) out.derivation = cm2[1].trim().slice(0, 90);
      }
    }

    // 4) 百科描述（语境信息的主要来源）
    var wiki = '';
    var wikiBody = doc.querySelector('.wiki-block__body');
    if (wikiBody) {
      var li = wikiBody.querySelector('li, p');
      wiki = cleanText(li ? li.textContent : wikiBody.textContent);
      if (!li) wiki = wiki.replace(new RegExp('^' + escReg(word) + '\\s*'), '');
      wiki = wiki.replace(/内容来自\s*\S*百科[\s\S]*$/, '').trim();
    }

    // 5) 用法 / 语境
    out.usage = explicitUsage(doc) || usageFromText(wiki) || usageFromText(out.explanation);

    // 6) 出处 / 例句（书证）
    var cite = doc.querySelector('.xxjs-citation, .gy-sense__cit');
    if (cite) {
      var src = textOf(cite, '.xxjs-citation__source') || textOf(cite, 'cite');
      var quote = textOf(cite, '.xxjs-citation__text');
      if (!quote) {
        var item = cite.querySelector('li');
        if (item) {
          var clone = item.cloneNode(true);
          var c = clone.querySelector('cite, .xxjs-citation__source, .xxjs-citation__dash');
          if (c && c.parentNode) c.parentNode.removeChild(c);
          quote = cleanText(clone.textContent).replace(/[—－-]+\s*$/, '').trim();
        }
      }
      out.derivation = src;
      if (quote) out.example = quote + (src ? '（' + src + '）' : '');
    }
    if (!out.derivation && wiki) {
      var dm = wiki.match(/出自\s*([^。；;]{2,30})/);
      if (dm) out.derivation = dm[1].trim();
    }

    // 7) 近义 / 反义
    var synRoot = secs['近反义词'];
    if (synRoot) {
      Array.prototype.forEach.call(synRoot.querySelectorAll('.synonym-row'), function (r) {
        var lab = cleanText(textOf(r, '.synonym-label'));
        var words = Array.prototype.slice.call(r.querySelectorAll('.synonym-tag'))
          .map(function (a) { return cleanText(a.textContent); })
          .filter(function (s) { return !!s; });
        if (!words.length) return;
        if (/近义/.test(lab) && !out.similar) out.similar = words.join('、');
        if (/反义/.test(lab) && !out.opposite) out.opposite = words.join('、');
      });
    }
    if ((!out.similar || !out.opposite) && secs['国语辞典']) {
      Array.prototype.forEach.call(secs['国语辞典'].querySelectorAll('.xxjs-also'), function (b) {
        var lab = cleanText(textOf(b, '.xxjs-block-label'));
        var words = Array.prototype.slice.call(b.querySelectorAll('a, .syn-tag'))
          .map(function (a) { return cleanText(a.textContent); })
          .filter(function (s) { return !!s; });
        if (!words.length) return;
        if (/近义/.test(lab) && !out.similar) out.similar = words.join('、');
        if (/反义/.test(lab) && !out.opposite) out.opposite = words.join('、');
      });
    }

    return out;
  }

  /* 显式的"用法：xxx"标签（汉典部分词条有） */
  function explicitUsage(doc) {
    var labels = Array.prototype.slice.call(doc.querySelectorAll('.xxjs-block-label, dt, .wiki-label'));
    for (var i = 0; i < labels.length; i++) {
      if (!/^用法/.test(cleanText(labels[i].textContent))) continue;
      var sib = labels[i].nextElementSibling ||
                (labels[i].parentElement && labels[i].parentElement.querySelector('.xxjs-also__text, dd'));
      var t = cleanText(sib ? sib.textContent : '');
      if (t) return t.slice(0, 90);
    }
    return '';
  }

  /* 兜底：页面结构变化时，从各分区纯文本里做语义分段（旧逻辑，保留作为保险） */
  function parseZdicLegacy(doc, word) {
    try {
      var sections = Array.prototype.slice.call(doc.querySelectorAll('.dict-section__body'));
      var texts = sections.map(function (b) { return cleanText(b.textContent); })
        .filter(function (s) { return !!s; });
      if (!texts.length) {
        var body = doc.body ? cleanText(doc.body.textContent) : '';
        var i = body.indexOf(word);
        if (i >= 0) {
          var seg = body.slice(i + word.length, i + word.length + 240)
            .replace(/^[\s，。；、：:]+/, '').replace(/纠错反馈[\s\S]*$/, '');
          if (seg.length > 4) {
            return { word: word, source: '汉典', pinyin: '', explanation: seg, usage: '', derivation: '', example: '', similar: '', opposite: '' };
          }
        }
        return null;
      }
      var out = { word: word, source: '汉典', pinyin: '', explanation: '', usage: '', derivation: '', example: '', similar: '', opposite: '' };
      var joined = texts.join(' ');
      out.explanation = stripHead(joined, word).split(/书证|近义词|反义词|英文|英语/)[0].slice(0, 400).trim();
      out.usage = usageFromText(joined);
      var sm = joined.match(/书证\s*(.+?)(?=英文|英语|近义词|反义词|用法|反馈|$)/);
      if (sm && sm[1].trim().length > 4) out.example = sm[1].trim();
      var jm = joined.match(/近义词\s*[：:]?\s*([\u4e00-\u9fa5、，\s]{2,60}?)(?=反义词|反馈|$)/);
      if (jm) out.similar = jm[1].trim().replace(/\s+/g, '、');
      var fm = joined.match(/反义词\s*[：:]?\s*([\u4e00-\u9fa5、，\s]{2,60}?)(?=近义词|反馈|$)/);
      if (fm) out.opposite = fm[1].trim().replace(/\s+/g, '、');
      return out;
    } catch (e) { return null; }
  }

  /* 剥掉"词头 + 拼音 + 注音"前缀 */
  var PY_CLASS = 'a-zA-Z\\u00c0-\\u02af';
  function stripHead(txt, word) {
    var t = String(txt == null ? '' : txt);
    t = t.replace(new RegExp('^' + escReg(word) + '(?:\\s*' + escReg(word) + ')?\\s*'), '');
    t = t.replace(/^[（(]\s*/, '');
    t = t.replace(new RegExp('^(?:[' + PY_CLASS + ']+\\s*)+'), '');
    t = t.replace(/^(?:[\u3105-\u312f\u02c7\u02c9\u02ca\u02cb\u02d9]+\s*)+/, '');
    return t.replace(/^[\s，。；、：:）)]+/, '').trim();
  }

  /* ================= 词缓存 ================= */
  function loadWordCache(word) {
    try {
      var raw = gmGet(CONFIG.wordCachePrefix + word);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || Date.now() - obj.ts > CONFIG.wordCacheTtl) return null;
      memoryCache.set(word, obj.data);
      return obj.data;
    } catch (e) { return null; }
  }
  function saveWordCache(word, data) {
    try { gmSet(CONFIG.wordCachePrefix + word, JSON.stringify({ ts: Date.now(), data: data })); } catch (e) {}
  }

  /* ================= 区域与候选词识别 ================= */
  // 题目区：优先粉笔真实结构（app-ti / .question-multiple / .solution-choice-container ...）
  var ZONE_SEL = [
    'app-ti', '.question-multiple', '.questions-single-container', '.ti-content',
    '.solution-choice-container', '.question-choice-container', '.app-format-html',
    '[class*="question"]', '[class*="option"]', '[class*="choice"]',
    '[class*="stem"]', '[class*="material"]', '[class*="passage"]',
    '[class*="ti-container"]', '[class*="tiku"]', '[class*="exercise"]', '[class*="practice"]'
  ].join(',');
  var SKIP_SEL = 'header, nav, footer, aside, .site-header, .top-bar, .sidebar, .fw-tip-root, .fw-pin-bar';

  var OPT_LABEL_RE = /^[（(]?([A-Ha-h])[)）.．、:：]?\s*([\u4e00-\u9fa5·]{2,8})$/;
  var OPT_CLS_RE = /(^|\s)(choice-radio|choice-item|option-item|optionItem|option-radio-label)(\s|$)/;

  function inQuestionZone(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('.fw-tip-root')) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BUTTON' || tag === 'A') return false;
    if (el.closest(SKIP_SEL)) return false;
    return !!el.closest(ZONE_SEL);
  }

  /* 选项行：① 粉笔真实类名 li.choice-radio；② 文本形态兜底（"A 潜移默化"） */
  function findOptionRow(el) {
    var node = el, d = 0;
    while (node && node.nodeType === 1 && d++ < 5) {
      if (OPT_CLS_RE.test(String(node.className || ''))) return node;
      node = node.parentElement;
    }
    return null;
  }
  function findOptionRowByText(el) {
    var node = el, d = 0;
    while (node && node.nodeType === 1 && d++ < 4) {
      var t = compactText(node.textContent);
      if (t && t.length <= 12 && OPT_LABEL_RE.test(t)) return node;
      node = node.parentElement;
    }
    return null;
  }
  /* 鼠标所在的那"一段连续汉字"（被标点/字母数字切开的整段，不截断） */
  function hanziRunAt(text, offset) {
    if (!text) return null;
    var n = text.length, i = offset;
    if (i >= n || !isHanzi(text.charAt(i))) i = offset - 1;
    if (i < 0 || i >= n || !isHanzi(text.charAt(i))) return null;
    var s = i, e = i + 1;
    while (s > 0 && isHanzi(text.charAt(s - 1))) s--;
    while (e < n && isHanzi(text.charAt(e))) e++;
    return { text: text.slice(s, e), start: s, end: e };
  }

  /* "一段连续汉字"整体取词——成语不再被拆成两个词的关键：
       命中词库 → 就用它；词库没收录 → 整段原样返回（界面显示"未收录"），
       绝不在这段汉字里再截出更短的子词（"未收录成语被识别成两个单独词语"就是这么来的）。
     整段是长句（>8 字）时不属于"一个词"，返回 null 交给词边界逻辑处理。 */
  function wholeRunWord(run) {
    if (!run || !HANZI_WORD_RE.test(run)) return null;
    if (run.length < 2 || run.length > 8) return null;
    var hit = lookupW(run);
    if (hit) return { word: run, local: hit.local };
    // 词库没收录：只有"词/成语尺度"（2~4 字）才原样交给在线查询，
    // 更长的一整段（多半是句子片段）不猜、不拆；
    // 2~3 字的碎段若是虚词组合（"的了"这类）也不打扰。
    if (run.length > 4) return null;
    if (STEM_STOP[run]) return null;
    if (run.length <= 3 && FUZZY_CH_RE.test(run)) return null;
    return { word: run, local: null };
  }

  /* 从选项行里取词：只认词库里真实存在的词 + 标点边界，既不做拼接，也不做拆分。
     例："A. 医生：患者" 取到 "医生" 或 "患者"，绝不会是 "医生患者"；
         未收录的 4 字成语整段返回并显示"未收录"，绝不会被切成两个字。 */
  function rowWord(row) {
    if (!row) return null;
    var raw = cleanText(row.textContent);
    if (!raw) return null;
    var m = raw.match(OPT_LABEL_RE);
    var core = cleanText(m ? m[2] : raw);
    if (!core) return null;
    var segs = core.split(/[^\u4e00-\u9fa5·]+/).filter(function (s) { return !!s; });
    if (!segs.length) return null;

    // ① 整行就是一段连续汉字：整体取词，绝不从中间截子词
    if (segs.length === 1) {
      var whole = wholeRunWord(segs[0]);
      if (whole) return { word: whole.word, start: 0, end: whole.word.length, node: null, local: whole.local };
      // 只有"整句"（>8 字）才允许在段内取真实词；词尺度的一律不拆
      return segs[0].length > 8 ? longestWordIn(segs[0]) : null;
    }

    // ② 有标点/空格分隔：逐段整体取词，段内同样不拆
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var w = wholeRunWord(s);
      if (w) return { word: w.word, start: 0, end: w.word.length, node: null, local: w.local };
      if (s.length > 8) {
        var inner = longestWordIn(s);
        if (inner) return inner;
      }
    }
    return null;
  }

  /* 选项取词：优先按鼠标所在的那段连续汉字整体取词（长句选项再按词边界取词），
     取不到才退回"整行取词"。所有路径都只认真实词或整段，不做任何拼接/拆分。 */
  function optionWordAt(row, x, y) {
    var pos = getCaretPos(x, y);
    if (pos && pos.node && (!row.contains || row.contains(pos.node))) {
      var text = pos.node.textContent || '';
      var run = hanziRunAt(text, pos.offset);
      if (run) {
        var whole = wholeRunWord(run.text);
        if (whole) {
          // 顺带带出"词级"位置（node + 起止偏移），供悬浮窗贴着这个词显示
          return { word: whole.word, start: run.start, end: run.end, node: pos.node, local: whole.local };
        }
        if (run.text.length > 8) {   // 整段是长句：按词边界取真实词
          var hit = matchInText(text, pos.offset);
          if (hit) { hit.node = pos.node; return hit; }
        }
        return null;   // 词尺度但词库没收录：不猜、不拆，也不打扰
      }
      var loose = matchInText(text, pos.offset);
      if (loose) { loose.node = pos.node; return loose; }
      return null;
    }
    return rowWord(row);
  }

  /* ================= 题干：光标定位 ================= */
  function getCaretPos(x, y) {
    var node = null, offset = 0;
    try {
      if (document.caretRangeFromPoint) {
        var r = document.caretRangeFromPoint(x, y);
        if (r && r.startContainer && r.startContainer.nodeType === 3) {
          node = r.startContainer; offset = r.startOffset;
        }
      } else if (document.caretPositionFromPoint) {
        var cp = document.caretPositionFromPoint(x, y);
        if (cp && cp.offsetNode && cp.offsetNode.nodeType === 3) {
          node = cp.offsetNode; offset = cp.offset;
        }
      }
    } catch (e) { return null; }
    return node ? { node: node, offset: offset } : null;
  }

  /* 在文本中取"包含光标的、最长的真实词"（成语词库 + 分词词表）。
     三条硬约束，专治"两个词并成一个词"：
       ① 候选必须是词库里真实存在的词，拼不出来就返回 null，不猜；
       ② 候选不得跨标点，"医生：患者" 永远不会返回 "医生患者"；
       ③ 光标紧贴词尾时只算弱候选，右边以光标为起始边界的词优先，
          即"循序渐进|持之以恒"上悬停"持"取"持之以恒"，不会取到左边的"循序渐进"。 */
  function matchInText(text, offset) {
    if (!text) return null;
    var n = text.length, best = null;
    var lo = Math.max(0, offset - 8), hi = Math.min(n, offset + 9);
    for (var i = lo; i < hi; i++) {
      if (!isHanzi(text.charAt(i))) continue;
      var maxLen = Math.min(n - i, 8);
      for (var len = maxLen; len >= 2; len--) {
        var w = text.slice(i, i + len);
        if (!HANZI_RE.test(w)) continue;           // ② 跨标点的不算词
        var hit = lookupW(w);
        if (!hit) continue;
        var tier;
        if (i < offset && offset < i + len) tier = 3;      // 光标在词内
        else if (offset === i) tier = 3;                   // 光标压在词首
        else if (offset === i + len) tier = 2;             // 光标紧贴词尾：弱候选
        else tier = 1;
        var score = tier * 100 + len;
        if (!best || score > best.score) {
          best = { word: w, start: i, end: i + len, node: null, score: score, local: hit.local, tier: tier };
        }
        break;                                     // 以 i 为起点的最长匹配已找到
      }
    }
    // ④ 光标不在任何词内、只是"旁边恰好有个词"（tier 1）时不打扰用户，交给兜底流程
    if (best && best.tier === 1) return null;
    return best;
  }

  /* 在整段文本里找"最长的真实词"（选项行整体取词用），找不到就 null */
  function longestWordIn(text) {
    if (!text) return null;
    var n = text.length, best = null;
    for (var i = 0; i < n; i++) {
      if (!isHanzi(text.charAt(i))) continue;
      for (var len = Math.min(n - i, 8); len >= 2; len--) {
        var w = text.slice(i, i + len);
        if (!HANZI_RE.test(w)) continue;
        var hit = lookupW(w);
        if (!hit) continue;
        if (!best || len > best.word.length) best = { word: w, start: i, end: i + len, node: null, local: hit.local };
        break;
      }
    }
    return best;
  }

  /* 题干兜底：只有当光标处"标点围起来"的连续汉字段恰好是 2~3 字、
     且不含虚词字时才敢直接用；更长的段落一律放弃——宁可不显示，
     也不把"遏制蔓延""医生患者"这种两个词拼成一个词去查。 */
  var STEM_STOP = {
    '这个': 1, '那个': 1, '我们': 1, '他们': 1, '你们': 1, '什么': 1, '这样': 1, '那样': 1,
    '因为': 1, '所以': 1, '但是': 1, '如果': 1, '可以': 1, '没有': 1, '就是': 1, '已经': 1,
    '一个': 1, '不是': 1, '这些': 1, '那些': 1, '以及': 1, '并且': 1, '而且': 1, '于是': 1
  };
  var FUZZY_CH_RE = /[的了着过在是和与及或而就都也又很更最太把被对从向给让使能会要可不等中上下里时后前]/;
  function fallbackRun(text, offset) {
    if (!text) return null;
    var n = text.length;
    var hit = offset;
    if (hit >= n || !isHanzi(text.charAt(hit))) hit = offset - 1;
    if (hit < 0 || hit >= n || !isHanzi(text.charAt(hit))) return null;
    var s = hit, e = hit + 1;
    while (s > 0 && isHanzi(text.charAt(s - 1))) s--;
    while (e < n && isHanzi(text.charAt(e))) e++;
    var w = text.slice(s, e);
    if (w.length < 2 || w.length > 3) return null;
    if (FUZZY_CH_RE.test(w)) return null;
    return { word: w, start: s, end: e, node: null, local: null };
  }

  /* ================= 展示流程 ================= */
  function clearPending() {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    pendingWord = null;
  }
  function hideVisual() {
    if (tipEl) tipEl.style.display = 'none';
    tipVisible = false;
  }
  function hideTip() {
    hideVisual();
    currentWord = null;
    currentKind = null;
    clearPending();
    ++querySeq; // 使在途查询失效
  }

  function setTarget(anchor, word, kind, range) {
    if (word === currentWord && kind === currentKind) {
      if (tipVisible) showTip(anchor, range);
      return;
    }
    clearPending();
    ++querySeq;
    var seq = querySeq;
    currentWord = word;
    currentKind = kind;

    var local = lookupDict(word);
    var fallback = local ? {
      word: word, source: '成语词库', pinyin: local.p,
      explanation: local.e, derivation: shortenSource(local.d), example: local.x,
      usage: usageFromText(local.e), similar: '', opposite: ''
    } : null;

    if (fallback) {
      renderTip(word, fallback);
      showTip(anchor, range);
      if (CONFIG.enrichLocal) requestOnline(word, seq, anchor, range, 0, false, fallback);
      return;
    }
    var cached = memoryCache.get(word) || loadWordCache(word);
    if (cached) { renderTip(word, cached); showTip(anchor, range); return; }

    if (kind === 'stem') {
      // 题干：先不打扰用户，停留够了再联网；查不到就静默隐藏
      hideVisual();
      requestOnline(word, seq, anchor, range, CONFIG.stemDwell, true, null);
      return;
    }
    renderTip(word, { source: 'loading', word: word });
    showTip(anchor, range);
    requestOnline(word, seq, anchor, range, 0, false, null);
  }

  function requestOnline(word, seq, anchor, range, delay, silent, fallback) {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    pendingWord = word;
    var run = function () {
      pendingTimer = null;
      if (seq !== querySeq || currentWord !== word) return; // 已过期
      if (delay > 0) {
        renderTip(word, { source: 'loading', word: word });
        showTip(anchor, range);
      }
      pullOnline(word).then(function (data) {
        if (seq !== querySeq || currentWord !== word) return;
        // 空结果 / 页面改版拿不到内容，统一按"未收录"处理
        if (!data || (!data.explanation && !data.usage && !data.derivation && !data.example)) {
          if (silent) { hideVisual(); }
          else { renderTip(word, { source: 'none', word: word }); showTip(anchor, range); }
          return;
        }
        if (fallback) {
          if (!data.explanation) data.explanation = fallback.explanation;
          if (!data.derivation) data.derivation = fallback.derivation;
          if (!data.example) data.example = fallback.example;
          if (!data.pinyin) data.pinyin = fallback.pinyin;
          if (!data.usage) data.usage = fallback.usage;
          if (!data.similar) data.similar = fallback.similar;
          if (!data.opposite) data.opposite = fallback.opposite;
          data.source = data.source + ' + ' + fallback.source;
        }
        memoryCache.set(word, data);
        saveWordCache(word, data);
        renderTip(word, data);
        showTip(anchor, range);
      });
    };
    if (delay > 0) pendingTimer = setTimeout(run, delay);
    else run();
  }

  /* ================= Tooltip UI ================= */
  var CSS_TEXT = [
    '.fw-tip-root{position:fixed;z-index:2147483647;display:none;max-width:470px;min-width:250px;',
    'background:#fff;color:#333;border:1px solid #e2e6ea;border-radius:10px;',
    'box-shadow:0 6px 24px rgba(0,0,0,.14);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
    'font-size:13px;line-height:1.65;overflow:hidden;}',
    '.fw-tip-head{padding:9px 14px 7px;border-bottom:1px solid #f0f2f5;background:#fafbfc;}',
    '.fw-tip-word{font-size:17px;font-weight:700;color:#1f2329;margin-right:8px;}',
    '.fw-tip-py{font-size:12px;color:#86909c;}',
    '.fw-tip-body{padding:8px 14px 12px;max-height:300px;overflow-y:auto;}',
    '.fw-tip-sec{margin:6px 0;display:flex;}',
    '.fw-tip-k{flex:0 0 34px;font-weight:600;color:#165dff;}',
    '.fw-tip-v{flex:1 1 auto;color:#333;word-break:break-word;}',
    '.fw-tip-example{color:#4e5969;background:#f7f8fa;border-radius:6px;padding:4px 8px;margin-top:4px;}',
    '.fw-tip-none{color:#c0392b;}',
    '.fw-tip-foot{padding:6px 14px 8px;border-top:1px solid #f0f2f5;font-size:11px;color:#86909c;',
    'display:flex;justify-content:space-between;align-items:center;}',
    '.fw-tip-foot a{color:#165dff;text-decoration:none;}',
    /* v3.5：左侧竖排按钮栏（百度汉语 / 人民网 / 收藏），右侧为词条正文 */
    '.fw-tip-flex{display:flex;align-items:stretch;}',
    '.fw-tip-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;}',
    '.fw-tip-side{flex:0 0 96px;background:#fafbfc;border-right:1px solid #f0f2f5;',
    'padding:10px 8px;display:flex;flex-direction:column;gap:6px;}',
    '.fw-side-btn{display:block;width:100%;box-sizing:border-box;margin:0;padding:6px 4px;',
    'font-family:inherit;font-size:12px;line-height:1.3;text-align:center;text-decoration:none;',
    'background:#fff;color:#165dff;border:1px solid #e5e6eb;border-radius:7px;cursor:pointer;}',
    '.fw-side-btn:hover{background:#eef3ff;border-color:#bedaff;}',
    '.fw-side-sub{display:block;font-size:10px;line-height:1.2;color:#86909c;margin-top:1px;}',
    '.fw-side-fav.is-disabled{color:#a9aeb8;border-style:dashed;}',
    '.fw-side-fav.is-disabled:hover{background:#f7f8fa;border-color:#e5e6eb;}',
    /* v3.8.0：「我的收藏」按钮样式 */
    '.fw-side-book{background:#fff7e6;color:#92400e;border-color:#f5d89a;}',
    '.fw-side-book:hover{background:#fff0d4;color:#78350f;border-color:#f0c97a;}',
    /* v3.8.0：「我的收藏」面板 */
    '.fw-book-overlay{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}',
    '.fw-book-panel{width:min(720px,calc(100vw - 60px));max-height:calc(100vh - 80px);overflow:auto;background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.28);}',
    '.fw-book-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:12px 16px 10px;border-bottom:1px solid #f0f2f5;position:sticky;top:0;background:#fff;z-index:1;border-radius:14px 14px 0 0;}',
    '.fw-book-head h3{margin:0;margin-right:auto;font-size:16px;color:#1f2329;}',
    '.fw-book-count{font-size:12px;color:#86909c;margin-left:8px;}',
    '.fw-book-close{background:none;border:none;font-size:22px;line-height:1;color:#86909c;cursor:pointer;padding:0 8px;}',
    '.fw-book-close:hover{color:#333;}',
    '.fw-book-config{background:none;border:none;font-size:13px;line-height:1;color:#4e5969;cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #e5e6eb;margin-left:0;}',
    '.fw-book-config:hover{background:#f2f6ff;border-color:#bedaff;color:#165dff;}',
    /* v3.10.0：「我的收藏」卡片——默认只显示成语 + 释义，点击卡片展开其余字段 */
    '.fw-book-card{cursor:pointer;transition:border-color .15s,box-shadow .15s;}',
    '.fw-book-card.is-open{border-color:#c9d8ff;box-shadow:0 2px 10px rgba(22,93,255,.08);}',
    '.fw-book-card-py{display:none;} .fw-book-card.is-open .fw-book-card-py{display:inline;}',
    '.fw-book-extra{display:none;} .fw-book-card.is-open .fw-book-extra{display:block;}',
    '.fw-book-card-hint{font-size:11px;color:#86909c;user-select:none;margin-left:6px;}',
    '.fw-book-card.is-open .fw-book-card-hint{color:#165dff;}',
    '.fw-book-empty .fw-book-tip{font-size:12px;color:#a9aeb8;}',
    '.fw-book-retry{margin-top:10px;font-size:13px;padding:6px 16px;border-radius:8px;border:1px solid #c9d8ff;background:#f2f6ff;color:#165dff;cursor:pointer;}',
    '.fw-book-retry:hover{background:#e6efff;}',
    '.fw-book-diag{margin-top:10px;margin-left:8px;font-size:13px;padding:6px 16px;border-radius:8px;border:1px solid #e5e6eb;background:#fafbfc;color:#4e5969;cursor:pointer;}',
    '.fw-book-diag:hover{background:#f2f3f5;}',
    /* v3.11.0：面板顶部提示（本机缓存 / 刷新失败原因）+ 底部状态行 + 诊断输出 */
    '.fw-book-note{font-size:12px;line-height:1.6;color:#86909c;background:#f7f8fa;padding:8px 20px;border-bottom:1px solid #f0f2f5;}',
    '.fw-book-note.is-warn{color:#d4380d;background:#fff7f0;}',
    '.fw-book-note .fw-book-retry{margin-top:6px;margin-left:6px;font-size:12px;padding:4px 12px;}',
    '.fw-book-status{font-size:11px;color:#a9aeb8;padding:8px 20px;border-top:1px solid #f0f2f5;text-align:right;}',
    '.fw-book-diag-pre{margin:0;padding:12px 20px;background:#fafbfc;border-top:1px solid #f0f2f5;font-size:11px;line-height:1.6;color:#4e5969;white-space:pre-wrap;word-break:break-all;}',
    '.fw-book-empty{text-align:center;padding:32px 20px;color:#86909c;font-size:14px;} .fw-book-empty p{margin:6px 0;}',
    '.fw-book-card{margin:8px 14px;border:1px solid #e5e6eb;border-radius:10px;overflow:hidden;background:#fff;}',
    '.fw-book-card-head{display:flex;align-items:center;padding:7px 12px;border-bottom:1px solid #f0f2f5;background:#fafbfc;gap:6px;}',
    '.fw-book-card-word{font-size:15px;font-weight:700;color:#1f2329;}',
    '.fw-book-card-py{font-size:12px;color:#86909c;margin-left:2px;}',
    '.fw-book-card-body{padding:8px 12px;font-size:13px;line-height:1.55;color:#333;}',
    '.fw-book-card-sec{margin:2px 0;} .fw-book-card-sec b{color:#165dff;}',
    '.fw-book-card-sec .fw-book-card-val{color:#333;} .fw-book-card-sec .fw-book-card-val em{font-style:normal;color:#4e5969;}',
    '.fw-book-card-example{color:#4e5969;background:#f7f8fa;border-radius:6px;padding:4px 8px;margin-top:2px;}',
    '.fw-book-card-meta{margin-top:5px;padding-top:5px;border-top:1px solid #f0f2f5;font-size:11px;color:#86909c;display:flex;gap:14px;}',
    '.fw-book-card-sec-note{margin:2px 0;}',
    '.fw-book-card-actions{display:flex;align-items:center;gap:6px;margin-left:auto;}',
    '.fw-book-btn-unfav{font-size:12px;padding:3px 10px;border-radius:6px;border:1px solid #f5d89a;background:#fff7e6;color:#92400e;cursor:pointer;}',
    '.fw-book-btn-unfav:hover{background:#fff0d4;border-color:#f0c97a;}',
    '.fw-book-btn-unfav:disabled{opacity:.5;cursor:default;background:#f7f8fa;border-color:#e5e6eb;color:#a9aeb8;}',
    '.fw-book-card-note-icon{font-size:13px;margin-right:4px;cursor:pointer}',
    '.fw-book-card-note-icon:hover{transform:scale(1.15)}',
    '.fw-book-btn-unfav.is-loading{pointer-events:none;} .fw-book-btn-unfav.is-loading span{opacity:.5;}',
    /* v3.18.0：笔记编辑区 */
    '.fw-book-card-note{margin:4px 0;display:flex;align-items:flex-start;gap:6px;}',
    '.fw-book-note-edit-btn{background:none;border:1px solid #e5e6eb;border-radius:4px;padding:3px 5px;cursor:pointer;color:#86909c;transition:all .15s;display:flex;align-items:center;flex-shrink:0;margin-top:1px;}',
    '.fw-book-note-edit-btn:hover{border-color:#c9d8ff;background:#f2f6ff;color:#165dff;}',
    '.fw-book-note-edit-btn.active{border-color:#165dff;background:#e6efff;color:#165dff;}',
    '.fw-book-note-display{flex:1;min-height:0;color:#333;font-size:13px;line-height:1.5;}',
    '.fw-book-note-display:empty::after{content:"未添加笔记";color:#c0c4cc;font-style:italic;}',
    '.fw-book-note-editor{display:flex;gap:6px;margin-top:4px;flex:1;flex-wrap:wrap;}',
    '.fw-book-note-ta{flex:1;min-width:0;min-height:48px;max-height:120px;border:1px solid #e5e6eb;border-radius:6px;padding:6px 8px;font-size:13px;font-family:inherit;line-height:1.5;resize:vertical;color:#333;background:#fff;} .fw-book-note-ta:focus{outline:none;border-color:#c9d8ff;box-shadow:0 0 0 2px rgba(22,93,255,.08);}',
    '.fw-book-note-save-btn{background:#165dff;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;flex-shrink:0;transition:all .15s;} .fw-book-note-save-btn:hover{background:#0f40c9;}',
    /* v3.8.0 结束 */
    /* v3.6：中键固定按钮栏——钉在鼠标旁，鼠标移过去点完即消失 */
    '.fw-pin-bar{position:fixed;z-index:2147483647;display:flex;flex-direction:column;gap:6px;padding:8px;',
    'background:#fff;border:1px solid #e2e6ea;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);',
    'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;min-width:92px;}',
    '.fw-pin-head{font-size:11px;color:#86909c;text-align:center;padding-bottom:4px;',
    'border-bottom:1px solid #f0f2f5;max-width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.fw-toast-msg{vertical-align:middle;}',
    '.fw-toast-btn{margin-left:10px;background:#fff;color:#165dff;border:none;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;vertical-align:middle;}',
    '.fw-toast-btn:hover{background:#eef3ff;}',
    '.fw-toast-bar{height:4px;background:rgba(255,255,255,.25);border-radius:2px;margin-top:6px;overflow:hidden;}',
    '.fw-toast-bar-i{height:100%;background:#4c8dff;border-radius:2px;transition:width .3s;}',
    /* v3.7.0：一键收藏（WebDAV → 坚果云）—— 已收藏态 + 配置面板 */
    '.fw-side-fav.is-on{background:#e8f5ec;color:#1a7f4b;border-color:#a8dfc0;}',
    '.fw-side-fav.is-on:hover{background:#daf0e2;color:#15683d;border-color:#8ad3ae;}',
    '.fw-side-fav.is-on .fw-side-sub{color:#3f9a6c;}',
    '.fw-wd-overlay{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}',
    '.fw-wd-panel{width:min(560px,calc(100vw - 40px));max-height:calc(100vh - 60px);overflow:auto;background:#fff;color:#333;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.24);font-size:13px;line-height:1.6;}',
    '.fw-wd-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #f0f2f5;}',
    '.fw-wd-head h3{margin:0;font-size:15px;color:#1f2329;}',
    '.fw-wd-close{background:none;border:none;font-size:20px;line-height:1;color:#86909c;cursor:pointer;padding:0 4px;}',
    '.fw-wd-close:hover{color:#333;}',
    '.fw-wd-body{padding:12px 16px 16px;}',
    '.fw-wd-field{margin-bottom:10px;}',
    '.fw-wd-field label{display:block;font-size:12px;color:#4e5969;margin-bottom:4px;}',
    '.fw-wd-input{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #e5e6eb;border-radius:7px;font-family:inherit;font-size:13px;color:#333;background:#fff;}',
    '.fw-wd-input:focus{outline:none;border-color:#165dff;box-shadow:0 0 0 2px rgba(22,93,255,.12);}',
    '.fw-wd-tip{font-size:11px;color:#86909c;margin-top:3px;line-height:1.5;}',
    '.fw-wd-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 10px;}',
    '.fw-wd-btn{font-family:inherit;font-size:12px;padding:6px 14px;border-radius:7px;cursor:pointer;background:#fff;color:#165dff;border:1px solid #e5e6eb;}',
    '.fw-wd-btn:hover{background:#f2f6ff;border-color:#bedaff;}',
    '.fw-wd-primary{background:#165dff;color:#fff;border-color:#165dff;}',
    '.fw-wd-primary:hover{background:#0e4fd8;}',
    '.fw-wd-result{display:none;margin-top:6px;padding:8px 10px;border-radius:7px;font-size:12px;word-break:break-all;}',
    '.fw-wd-result.is-show{display:block;}',
    '.fw-wd-result.is-ok{background:#e8f5ec;color:#1a7f4b;border:1px solid #b7e2c8;}',
    '.fw-wd-note-editor{background:#fff;border-radius:14px;padding:16px;margin:auto;min-width:480px;max-width:600px;max-height:calc(100vh - 80px);overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.28);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}',
    '.fw-wd-note-editor-head{display:flex;align-items:center;justify-content:space-between;padding:8px 0 12px;border-bottom:1px solid #f0f2f5}',
    '.fw-wd-note-editor-head h3{margin:0;font-size:16px;color:#1f2329}',
    '.fw-wd-note-editor-body{padding:12px 0}',
    '.fw-note-editor-row{margin-bottom:12px;padding:8px 0;border-bottom:1px solid #f0f2f5}',
    '.fw-note-editor-row b{display:block;margin-bottom:4px}',
    '.fw-note-editor-textarea{width:100%;min-height:60px;border:1px solid #e5e6eb;border-radius:7px;padding:8px;font-family:inherit;font-size:13px;resize:vertical;box-sizing:border-box}',
    '.fw-note-editor-textarea:focus{outline:none;border-color:#165dff}',
    '.fw-note-editor-save-btn{margin-top:4px;padding:4px 12px;border-radius:6px;border:1px solid #e5e6eb;background:#fff;color:#165dff;cursor:pointer}',
    '.fw-note-editor-save-btn:hover{background:#f2f6ff}',
    '.fw-wd-result.is-err{background:#fdeceb;color:#c0392b;border:1px solid #f6c6c1;}',
    '.fw-wd-result.is-warn{background:#fff7e6;color:#95610a;border:1px solid #f5dfa8;}',
    '.fw-wd-help{margin-top:10px;font-size:11px;color:#86909c;line-height:1.7;}',
    '.fw-wd-help b{color:#4e5969;}',
    /* v3.16.0：面板工具按钮区 + WebDAV 配置状态行 + 导入确认弹窗 */
    '.fw-book-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end;}',
    '.fw-book-tool{border:1px solid #d8dce2;background:#fff;color:#1f2329;border-radius:6px;padding:5px 10px;font-size:12px;line-height:1.4;cursor:pointer;}',
    '.fw-book-tool:hover{border-color:#3478f6;color:#3478f6;}',
    '.fw-book-tool.fw-book-close{font-size:16px;padding:2px 8px;}',
    '.fw-book-cfgline{font-size:12px;color:#6b7280;padding:7px 16px;border-bottom:1px solid #f0f2f5;background:#fafbfc;flex-wrap:wrap;}',
    '.fw-import-overlay{z-index:2147483646;}',
    '.fw-import-panel{width:520px;max-width:calc(100vw - 40px);max-height:calc(100vh - 60px);overflow:auto;}',
    '.fw-import-panel h3{margin:0 0 10px;font-size:15px;color:#1f2329;}',
    '.fw-import-line{font-size:12px;color:#4b5563;margin:4px 0;padding-left:8px;}',
    '.fw-import-line b{color:#1f2329;}',
    '.fw-import-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;}',
    '.fw-import-btn{border:1px solid #d8dce2;background:#fff;color:#1f2329;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;}',
    '.fw-import-btn-main{border-color:#3478f6;background:#3478f6;color:#fff;}'
  ].join('');

  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'fw-tip-root';
    tipEl.addEventListener('mouseenter', function () { /* 鼠标进入提示框：保持显示，方便点按钮 */ });
    // 左侧"收藏"按钮：v3.7.0 实装 —— 点一次收藏该词（写入坚果云），再点一次取消收藏
    tipEl.addEventListener('click', function (e) {
      var t = e.target;
      var fav = (t && t.closest) ? t.closest('.fw-side-fav') : null;
      if (!fav) return;
      e.preventDefault();
      e.stopPropagation();
      var word = (fav.getAttribute && fav.getAttribute('data-fw-word')) || currentWord;
      favToggle(word, favDataFor(word), fav);
    }, true);
    // v3.8.0：「我的收藏」按钮 —— 打开收藏面板
    tipEl.addEventListener('click', function (e) {
      var t = e.target;
      var book = (t && t.closest) ? t.closest('.fw-side-book') : null;
      if (!book) return;
      e.preventDefault();
      e.stopPropagation();
      openBookPanel();
    }, true);
    document.documentElement.appendChild(tipEl);
    return tipEl;
  }

  /* 悬浮窗左侧竖排按钮栏：百度汉语 / 人民网（搜这个词的用法）/ 收藏（v3.7.0：写入坚果云 WebDAV） */
  function sideBarHtml(word) {
    var dictUrl = CONFIG.jumpBase + encodeURIComponent(word);
    var rmwUrl = CONFIG.rmwBase + encodeURIComponent(word);
    var html = '<div class="fw-tip-side">';
    html += '<a class="fw-side-btn fw-zdic-link" data-href="' + esc(dictUrl) + '" href="' + esc(dictUrl) +
            '" target="_blank" rel="noreferrer" title="到百度汉语查这个词">百度汉语</a>';
    html += '<a class="fw-side-btn fw-rmw-link" data-href="' + esc(rmwUrl) + '" href="' + esc(rmwUrl) +
            '" target="_blank" rel="noreferrer" title="到人民网搜索该词的用法">人民网<span class="fw-side-sub">搜用法</span></a>';
    html += favButtonHtml(word);   // v3.7.0：收藏到坚果云（未收藏 → 收藏；已收藏 → 已收藏 / 点此取消）
    html += '<button type="button" class="fw-side-btn fw-side-book" title="查看我的收藏面板" onclick="void(0)">' +
            '&#x1F4D6; 我的收藏</button>';
    html += '</div>';
    return html;
  }

  /* v3.6：中键固定按钮栏——中键点在选项词上后，把 3 个按钮钉在鼠标旁，
     鼠标可以慢慢移过去点（不用中键即刻跳转）；点任一按钮后固定栏消失。 */
  var pinBar = null;
  var pinBarWord = null;   // v3.7.0：中键固定栏当前对应的词（收藏按钮据此取词 / 显示「已收藏」）
  function removePinBar() {
    if (pinBar && pinBar.parentNode && pinBar.parentNode.removeChild) pinBar.parentNode.removeChild(pinBar);
    pinBar = null;
    pinBarWord = null;
  }
  /* v3.6：中键固定按钮栏——中键点在选项词上后，把 3 个按钮钉在鼠标旁，
     鼠标可以慢慢移过去点（不用中键即刻跳转）。
     v3.7.0：点「百度汉语 / 人民网」后固定栏消失；点「收藏」后固定栏保留（按钮自身要显示收藏/取消的实时状态）。 */
  function onPinBarClick(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    var t = e && e.target;
    var btn = (t && t.closest) ? t.closest('.fw-side-btn') : null;
    if (!btn) return;
    if (btn.classList && btn.classList.contains('fw-side-fav')) {
      // v3.7.0：收藏 / 取消收藏。注意此处不能先 removePinBar —— 按钮还要用来显示写入结果状态
      var word = (btn.getAttribute && btn.getAttribute('data-fw-word')) || pinBarWord || currentWord;
      favToggle(word, favDataFor(word), btn);
      return;
    }
    if (btn.classList && btn.classList.contains('fw-side-book')) {
      // v3.8.0：打开「我的收藏」面板，固定栏保留（用户可继续操作其它按钮）
      openBookPanel();
      return;
    }
    var href = btn.getAttribute('data-href') || btn.getAttribute('href');
    if (href) openDict(href);
    removePinBar();
  }
  function showPinBar(x, y, word) {
    removePinBar();
    pinBarWord = String(word == null ? '' : word).trim();
    var bar = document.createElement('div');
    bar.className = 'fw-pin-bar';
    var dictUrl = CONFIG.jumpBase + encodeURIComponent(word);
    var rmwUrl = CONFIG.rmwBase + encodeURIComponent(word);
    var html = '<div class="fw-pin-head" title="' + esc(word) + '">「' + esc(word) + '」</div>';
    html += '<a class="fw-side-btn fw-zdic-link" data-href="' + esc(dictUrl) + '" href="' + esc(dictUrl) +
            '" target="_blank" rel="noreferrer" title="到百度汉语查这个词">百度汉语</a>';
    html += '<a class="fw-side-btn fw-rmw-link" data-href="' + esc(rmwUrl) + '" href="' + esc(rmwUrl) +
            '" target="_blank" rel="noreferrer" title="到人民网搜索该词的用法">人民网<span class="fw-side-sub">搜用法</span></a>';
    html += favButtonHtml(word);   // v3.7.0：收藏到坚果云
    html += '<button type="button" class="fw-side-btn fw-side-book" title="查看我的收藏面板">' +
            '&#x1F4D6; 我的收藏</button>';   // v3.8.0：打开「我的收藏」面板
    bar.innerHTML = html;
    document.documentElement.appendChild(bar);

    // 钉在鼠标旁（不压住鼠标），越界就回收进视口
    var bw = bar.offsetWidth, bh = bar.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var px = x + 16, py = y - Math.round(bh / 2);
    if (px + bw > vw - 8) px = x - bw - 16;
    if (px < 8) px = 8;
    if (py + bh > vh - 8) py = vh - bh - 8;
    if (py < 8) py = 8;
    bar.style.left = px + 'px';
    bar.style.top = py + 'px';

    // 点按钮：「我的收藏」打开收藏面板；其余（跳转 / 收藏）走 onPinBarClick
    bar.addEventListener('click', function (e) {
      var t = e.target;
      var book = (t && t.closest) ? t.closest('.fw-side-book') : null;
      if (book) { e.preventDefault(); e.stopPropagation(); openBookPanel(); return; }
      onPinBarClick(e);
    }, true);

    pinBar = bar;
  }

  /* 左侧按钮栏 + 右侧词条正文 */
  function wrapTip(word, mainHtml) {
    return '<div class="fw-tip-flex">' + sideBarHtml(word) +
           '<div class="fw-tip-main">' + mainHtml + '</div></div>';
  }

  function renderTip(word, data) {
    var tip = ensureTip();
    currentData = data;   // v3.7.0：记下当前展示的释义数据，收藏时直接用它
    var main = '';
    if (data.source === 'loading') {
      main = '<div class="fw-tip-head"><span class="fw-tip-word">' + esc(word) + '</span></div>' +
             '<div class="fw-tip-body"><div class="fw-tip-sec fw-tip-none" style="color:#86909c">正在查询释义…</div></div>';
    } else if (data.source === 'none') {
      main = '<div class="fw-tip-head"><span class="fw-tip-word">' + esc(word) + '</span></div>' +
             '<div class="fw-tip-body"><div class="fw-tip-sec fw-tip-none">未收录「' + esc(word) +
             '」，可中键点击该词调出按钮，再到百度汉语、人民网查看。</div></div>';
    } else {
      main = '<div class="fw-tip-head"><span class="fw-tip-word">' + esc(word) + '</span>' +
             (data.pinyin ? '<span class="fw-tip-py">' + esc(data.pinyin) + '</span>' : '') + '</div>';
      main += '<div class="fw-tip-body">';
      // 用法若与释义重复（本地词库常把语境写在释义里）就不重复占一行
      var usage = data.usage;
      if (usage && data.explanation && data.explanation.indexOf(usage) >= 0) usage = '';
      if (data.explanation) main += '<div class="fw-tip-sec"><span class="fw-tip-k">释义</span><span class="fw-tip-v">' + esc(data.explanation) + '</span></div>';
      if (usage) main += '<div class="fw-tip-sec"><span class="fw-tip-k">用法</span><span class="fw-tip-v">' + esc(usage) + '</span></div>';
      if (data.derivation) main += '<div class="fw-tip-sec"><span class="fw-tip-k">出处</span><span class="fw-tip-v">' + esc(data.derivation) + '</span></div>';
      if (data.example) main += '<div class="fw-tip-sec"><span class="fw-tip-k">例句</span><span class="fw-tip-v"><div class="fw-tip-example">' + esc(data.example) + '</div></span></div>';
      if (data.similar || data.opposite) {
        var line = '';
        if (data.similar) line += '近义：' + esc(data.similar);
        if (data.opposite) line += (line ? '　' : '') + '反义：' + esc(data.opposite);
        main += '<div class="fw-tip-sec"><span class="fw-tip-k">辨析</span><span class="fw-tip-v">' + line + '</span></div>';
      }
      main += '</div>';
      main += '<div class="fw-tip-foot"><span>来源：' + esc(data.source || '') + '　中键点击词语可调出查词按钮</span></div>';
    }
    tip.innerHTML = wrapTip(word, main);
    favRefreshButtons(word);   // v3.7.0：按钮按本机收藏记录显示「收藏 / 已收藏」
  }

  /* 只取"词"本身的矩形：range 定位失败就返回 null，
     绝不退化成"整个选项行"的矩形（否则又会把悬浮窗挂到行中央、离鼠标很远）。 */
  function rectFromRange(range) {
    if (!range || !range.node || typeof range.start !== 'number') return null;
    try {
      var r = document.createRange();
      r.setStart(range.node, range.start);
      r.setEnd(range.node, Math.min(range.end, range.node.textContent.length));
      var rc = r.getBoundingClientRect();
      if (rc && (rc.width || rc.height)) return rc;
    } catch (e) { /* ignore */ }
    return null;
  }

  function rectOf(anchor, range) {
    var rc = rectFromRange(range);
    if (rc) return rc;
    if (anchor && anchor.nodeType === 1) {
      var b = anchor.getBoundingClientRect();
      if (b && (b.width || b.height)) return b;
    }
    return null;
  }

  /* v3.5 定位：悬浮窗贴在鼠标所在词的右侧，绝不挡选项。 */
  function showTip(anchor, range) {
    if (!tipEl) return;
    tipEl.style.visibility = 'hidden';
    tipEl.style.display = 'block';
    var tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    var GAP = 120;   // 约 3cm 间距
    var wordRect = rectFromRange(range);
    var rect = wordRect || rectOf(anchor, range);
    var tight = !!wordRect;
    var x, y;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (tight) {
      x = wordRect.right + GAP;
      y = wordRect.top - 4;
      if (x + tw > vw - 8) {
        x = wordRect.left - tw - GAP;
        if (x < 8) x = wordRect.right + GAP;
      }
      if (y + th > vh - 8) y = vh - th - 8;
      if (y < 8) y = 8;
    } else if (lastMX || lastMY) {
      x = lastMX + 14;
      y = lastMY - 4;
      if (x + tw > vw - 8) x = lastMX - tw - 14;
      if (x < 8) x = lastMX + 14;
      if (y + th > vh - 8) y = vh - th - 8;
      if (y < 8) y = 8;
    } else if (rect) {
      x = rect.right + GAP;
      y = rect.top - 4;
      if (x + tw > vw - 8) x = rect.left - tw - GAP;
      if (y + th > vh - 8) y = rect.top - th - 4;
      if (x < 8) x = 8;
      if (y < 8) y = 8;
    } else {
      tipEl.style.display = 'none'; tipVisible = false; tipEl.style.visibility = '';
      return;
    }
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
    tipEl.style.visibility = '';
    tipVisible = true;
  }

  /* ================= Toast ================= */
  function showToast(msg, ms, actionText, actionFn, progress) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;' +
        'background:rgba(0,0,0,.78);color:#fff;padding:8px 14px;border-radius:8px;' +
        'font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:340px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.2);display:none;';
      document.documentElement.appendChild(toastEl);
    }
    var html = '<span class="fw-toast-msg">' + esc(msg) + '</span>';
    if (typeof progress === 'number') {
      html += '<div class="fw-toast-bar"><div class="fw-toast-bar-i" style="width:' + Math.max(0, Math.min(100, progress)) + '%"></div></div>';
    }
    if (actionText) html += '<button class="fw-toast-btn" type="button">' + esc(actionText) + '</button>';
    toastEl.innerHTML = html;
    var btn = toastEl.querySelector('.fw-toast-btn');
    if (btn) {
      btn.onclick = function (e) {
        e.preventDefault();
        toastEl.style.display = 'none';
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        if (actionFn) actionFn();
      };
    }
    toastEl.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, ms);
  }
  function hideToast() {
    if (toastEl) toastEl.style.display = 'none';
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  }

  /* ================= 事件 ================= */
  function openDict(url) {
    if (!url) return;
    try { window.open(url, '_blank', 'noopener'); } catch (err) { /* ignore */ }
  }

  /* 鼠标中键（button===1）：v3.6 起不再直接跳转，而是在鼠标旁钉出一列按钮
     （百度汉语 / 人民网 / 收藏），鼠标可以慢慢移过去点，点完固定栏消失。
     监听挂在 document 捕获阶段，并在 mousedown 阶段 preventDefault，避免触发中键自动滚动。 */
  var lastAuxTs = 0; // 同一次中键点击可能同时触发 mousedown 与 auxclick，去重防弹两次
  function onAuxDown(e) {
    if (e.button !== 1) return;
    var now = Date.now();
    if (now - lastAuxTs < 400) return;

    var el = e.target;
    if (!el || el.nodeType !== 1) {
      el = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
    }
    if (!el || !el.closest) return;

    // 情形 1：中键点在按钮（悬浮窗左侧栏 / 中键固定栏）上 → 打开对应页面，并收掉固定栏
    var a = el.closest('.fw-zdic-link,.fw-rmw-link');
    if (a) {
      var href = a.getAttribute('data-href') || a.getAttribute('href');
      if (href && href.indexOf('javascript:') !== 0) {
        e.preventDefault();
        lastAuxTs = now;
        openDict(href);
        removePinBar();
      }
      return;
    }

    // 情形 2：鼠标悬浮在选项区的词上 → 把 3 个按钮钉在鼠标旁，等鼠标移过去点
    if (el.closest('.fw-tip-root')) return;
    var row = findOptionRow(el) || findOptionRowByText(el);
    if (!row) return;

    var word = null;
    var hit = optionWordAt(row, e.clientX, e.clientY);
    if (hit && hit.word) word = hit.word;
    else if (currentWord && currentKind === 'option') word = currentWord;
    if (!word) return;

    e.preventDefault(); // 阻止中键自动滚动
    lastAuxTs = now;
    hideTip();
    showPinBar(e.clientX, e.clientY, word);
  }

  function onPointer(e) {
    var el = e.target;
    if (typeof e.clientX === 'number') { lastMX = e.clientX; lastMY = e.clientY; }
    if (!el || el.nodeType !== 1) return;
    if (el.closest && (el.closest('.fw-tip-root') || el.closest('.fw-pin-bar'))) return; // 鼠标在提示框/中键固定栏上：不动
    hoverEl = el;

    // 只在选项区域（ABCD 盒子）里触发，题干不生效
    var row = findOptionRow(el) || findOptionRowByText(el);
    if (!row) { hideTip(); return; }

    var w = optionWordAt(row, e.clientX, e.clientY);
    if (w && w.word) {
      // 有"词级"位置就带上，悬浮窗才能贴着这个词显示（而不是挂到整行中央）
      var range = (w.node && typeof w.start === 'number')
        ? { node: w.node, start: w.start, end: w.end } : null;
      setTarget(row, w.word, 'option', range);
    } else {
      hideTip();
    }
  }

  function onMouseOver(e) { onPointer(e); }

  function onMouseMove(e) {
    var now = Date.now();
    if (typeof e.clientX === 'number') { lastMX = e.clientX; lastMY = e.clientY; }
    if (now - lastMoveTs < CONFIG.moveThrottle) return;
    lastMoveTs = now;
    if (!hoverEl) return;
    onPointer(e);
  }

  function onMouseOut(e) {
    var to = e.relatedTarget;
    if (to && to.nodeType === 1 && to.closest &&
        (to.closest('.fw-tip-root') || inQuestionZone(to))) return;
    hideTip();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { hideTip(); removePinBar(); }
  }

  function bindEvents() {
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseout', onMouseOut, true);
    // 鼠标中键：悬浮在选项词上直接跳百度汉语查词（捕获阶段，早于页面自身逻辑）
    document.addEventListener('mousedown', onAuxDown, true);
    document.addEventListener('auxclick', onAuxDown, true);
    document.addEventListener('scroll', hideTip, true);
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('.fw-tip-root')) return;   // 点悬浮窗：保持显示，方便点按钮
      if (t && t.closest && t.closest('.fw-pin-bar')) return;    // 点中键固定栏：交给它自己的处理器
      hideTip();
      removePinBar();   // 点空白处：顺带收掉中键固定栏
    }, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', hideTip);
  }

  /* ================= v3.7.0：一键收藏（WebDAV → 坚果云） =================
     目标：点悬浮窗左侧栏 / 中键固定栏的「收藏」按钮，就把当前词的释义卡片写入远端文件（坚果云 WebDAV）。
     设计要点（v3.15.0 起收藏文件为整份 JSON 文档 { words:[...], deleted:{} }，取代原 Markdown 词块）：
       a) 整份文档读写：写入前先 GET 远端已有 JSON 文档 → 双向并集合并（favMergeDocs：按词名去重、
          updatedTime 取较新、删除时间戳墓碑防复活）→ 整体 PUT 回写，并用 WebDAV 标准 ETag 做乐观锁
          （If-Match），412 / 428 冲突自动重读重试。
       b) 跨域：统一走 GM_xmlhttpRequest（免 CORS，HTTP Basic 认证）；没有该授权时退回 fetch。
       c) 未配置 WebDAV → 点「收藏」明确提示 + 给「去配置」按钮；未取到释义 → 明确提示暂不可收藏，
          绝不静默失败。
       d) 配置面板入口三处：油猴菜单 / 控制台 window.__fwFav.open() / 未配置时的引导按钮。 */

  var FAV_WEBDAV_KEY = 'fw_webdav_config_v1';        // 配置持久化键（服务器地址 / 账号 / 密码 / 保存路径）
  var FAV_WORDS_KEY = 'fw_fav_words_v1';             // 本机「已收藏的词」标记（按钮状态 + 去重）
  var FAV_FILE_DEFAULT = 'fenbi/word-favorites/index.json';  // v3.16.0：保存路径默认值（相对 WebDAV 根目录，对齐错题本目录式 .json 路径）
  var FAV_JGY_ROOT = '我的坚果云';                    // 坚果云 WebDAV 虚拟服务根下唯一的真实目录
  var FAV_TIMEOUT_MS = 12000;                        // 单次 WebDAV 请求超时（毫秒）；v3.11.0：30s → 12s（仍小于面板 15s 兜底），卡住就明确报超时
  var FAV_SNAP_KEY = 'fw_fav_snapshot_v1';           // v3.11.0：远端文件快照（内容 + ETag + 时间）——收藏时直接在快照上合并，省掉一次 GET 往返
  var FAV_LOCAL_KEY = 'fw_fav_local_v1';             // v3.16.0：本地浏览器暂存（整份 JSON 文档 words+deleted 墓碑）——离线也保留收藏，同步/拉取/导入均与它做并集
  var FAV_SNAP_MAX = 256 * 1024;                     // 快照体积上限：超过则只留内存、不落本地存储
  var FAV_REQ_LOG_MAX = 12;                          // v3.11.0：诊断用——保留最近多少次请求的状态与耗时
  var FAV_MAX_RETRY = 2;                             // 乐观锁冲突时的最大重试次数
  var FAV_WORDS_KEEP_MAX = 5000;                     // 本机记录的已收藏词上限（超出后丢最早的）
  var FAV_JGY_RE = /(^|\.)jianguoyun\.com(:\d+)?(\/|$)/i;

  var favState = { config: null, words: null, snap: undefined, dirsOk: {}, log: [] };   // 运行时缓存（配置 / 已收藏词 / 远端快照 / 目录探测 / 请求耗时诊断）
  var favPanelEl = null;                          // 当前打开的 WebDAV 配置面板
  var favLocalDoc = null;                         // v3.16.0：本地暂存文档（words + deleted），持久化到 FAV_LOCAL_KEY
  var favSyncBusy = false, favSyncPending = false; // v3.16.0：整体同步（读远端→并集合并→回写）占用标志，busy 期间再次请求则标记待续
  // （中键固定栏对应的词 pinBarWord 声明在固定栏一节，收藏按钮据此取词）

  function favLog(msg, extra) {
    try { if (typeof console !== 'undefined' && console && console.log) console.log('[FW 收藏]', msg, extra === undefined ? '' : extra); } catch (e) {}
  }
  function favWarn(msg, extra) {
    try { if (typeof console !== 'undefined' && console && console.warn) console.warn('[FW 收藏]', msg, extra === undefined ? '' : extra); } catch (e) {}
  }
  function favErrText(e) { return String(e && e.message ? e.message : (e == null ? '未知错误' : e)); }
  function favErrCode(e) {
    var m = /HTTP\s*(\d+)/.exec(favErrText(e));
    return m ? m[1] : '';
  }

  /* ---------------- 存储（GM 存储优先，退回 localStorage） ---------------- */
  function favStoreGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        var v = GM_getValue(key, null);
        if (v !== null && v !== undefined) return String(v);
      }
    } catch (e) { /* 未授权 / 被禁用时退回 localStorage */ }
    try {
      var lv = localStorage.getItem(key);
      if (lv !== null && lv !== undefined) return String(lv);
    } catch (e) { /* 隐私模式等场景读失败 */ }
    return fallback;
  }
  function favStoreSet(key, value) {
    var s = String(value), ok = false;
    try { if (typeof GM_setValue === 'function') { GM_setValue(key, s); ok = true; } } catch (e) { /* ignore */ }
    try { localStorage.setItem(key, s); ok = true; } catch (e) { /* ignore */ }
    return ok;
  }
  function favStoreRemove(key) {
    try { if (typeof GM_deleteValue === 'function') GM_deleteValue(key); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  /* ---------------- 配置读写 ---------------- */
  // 保存路径规整：坚果云 dav/ 是「虚拟服务根」，根目录不可写（往根下 PUT 裸文件名会 404），
  // 只填了裸文件名（无任何目录层级）且地址指向坚果云时，自动补上最外层真实目录「我的坚果云」。
  function favNormalizeFilePath(filePath, url) {
    var p = String(filePath == null ? '' : filePath).trim().replace(/^\/+/, '') || FAV_FILE_DEFAULT;
    if (p.indexOf('/') === -1 && p !== FAV_JGY_ROOT && FAV_JGY_RE.test(String(url == null ? '' : url).trim())) {
      return FAV_JGY_ROOT + '/' + p;
    }
    return p;
  }
  function favNormalizeConfig(raw) {
    var c = (raw && typeof raw === 'object') ? raw : {};
    var url = String(c.url == null ? '' : c.url).trim();
    return {
      url: url,
      username: String(c.username == null ? '' : c.username).trim(),
      password: String(c.password == null ? '' : c.password),
      filePath: favNormalizeFilePath(c.filePath, url)
    };
  }
  function favGetConfig() {
    if (favState.config) return favState.config;
    var parsed = null;
    try { parsed = JSON.parse(favStoreGet(FAV_WEBDAV_KEY, '') || 'null'); } catch (e) { parsed = null; }
    favState.config = favNormalizeConfig(parsed);
    // v3.16.0：旧版保存路径是 .md（如 fenbi-word-favorites.md）→ 启动自动迁移为 .json 默认路径并落盘
    if (/\.md$/i.test(String(favState.config.filePath || ''))) {
      favState.config.filePath = FAV_FILE_DEFAULT;
      try { favStoreSet(FAV_WEBDAV_KEY, JSON.stringify(favState.config)); } catch (e) { /* ignore */ }
      favLog('已迁移旧收藏保存路径（.md → .json）', FAV_FILE_DEFAULT);
    }
    return favState.config;
  }
  function favSaveConfig(cfg) {
    var next = favNormalizeConfig(cfg);
    favState.config = next;
    var ok = favStoreSet(FAV_WEBDAV_KEY, JSON.stringify(next));
    favSnapDrop();   // v3.11.0：配置一改，旧的远端快照与目录探测结果全部作废
    favLog('已保存 WebDAV 配置', '地址=' + (next.url || '(空)') + ' 账号=' + (next.username || '(空)') +
      ' 保存路径=' + next.filePath + ' 持久化=' + (ok ? '成功' : '失败'));
    return ok;
  }
  function favClearConfig() {
    favState.config = favNormalizeConfig(null);
    favStoreRemove(FAV_WEBDAV_KEY);
    favSnapDrop();   // v3.11.0：配置清空后快照一并作废
    favLog('已清空 WebDAV 配置（远端已收藏的文件不受影响）');
  }
  // 「已配置」判定：地址 + 账号必填；密码允许留空（留空且服务端要求认证时会以 401 明确提示检查密码）
  function favIsConfigured() {
    var c = favGetConfig();
    return !!(c.url && c.username);
  }

  /* ---------------- URL / 认证（WebDAV 一律走 HTTP Basic） ---------------- */
  function favJoinUrl(base, seg) {
    var b = String(base == null ? '' : base).trim().replace(/\/+$/, '');
    var s = String(seg == null ? '' : seg).replace(/^\/+/, '');
    return s ? b + '/' + s : b + '/';
  }
  function favEncodePath(p) {
    return String(p == null ? '' : p).split('/').map(function (seg) { return encodeURIComponent(seg); }).join('/');
  }
  function favFileUrl(cfg) { return favJoinUrl(cfg.url, favEncodePath(cfg.filePath)); }
  // 目标文件所在目录（连接测试用，统一以「/」结尾表示集合）
  function favDirUrl(cfg) {
    var segs = String(cfg.filePath || '').split('/').filter(function (s) { return !!s; });
    segs.pop();
    var dirUrl = favJoinUrl(cfg.url, favEncodePath(segs.join('/')));
    return /\/$/.test(dirUrl) ? dirUrl : dirUrl + '/';
  }
  // 账号密码可能含中文 / 特殊字符，先转 UTF-8 字节再 base64，避免 btoa 抛 InvalidCharacterError
  function favUtf8Base64(str) {
    var s = String(str == null ? '' : str);
    try {
      if (typeof TextEncoder === 'function' && typeof btoa === 'function') {
        var bytes = new TextEncoder().encode(s), bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      }
    } catch (e) { /* 退回下面的老办法 */ }
    try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return btoa(s); }
  }
  function favAuthHeader(cfg) { return 'Basic ' + favUtf8Base64(cfg.username + ':' + cfg.password); }
  function favExtractEtag(rawHeaders) {
    var m = /^etag:\s*(.+)$/im.exec(String(rawHeaders == null ? '' : rawHeaders));
    return m ? m[1].trim() : null;
  }

  /* ---------------- 请求出口：GM_xmlhttpRequest 优先（免 CORS），退回 fetch ---------------- */
  function favRequest(method, url, headers, body) {
    var h = Object.assign({}, headers || {});
    var hasBody = !(body === undefined || body === null);
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise(function (resolve, reject) {
        var settled = false, reqT0 = Date.now();
        var ok = function (fn, arg) { if (!settled) { settled = true; fn(arg); } };
        try {
          GM_xmlhttpRequest({
            method: method,
            url: url,
            headers: h,
            data: hasBody ? body : undefined,
            timeout: FAV_TIMEOUT_MS,
            responseType: 'text',
            onload: function (res) {
              var st = (res && typeof res.status === 'number') ? res.status : 0;
              var ms = Date.now() - reqT0;
              favNoteReq(method, url, st, ms, 'GM_xmlhttpRequest');
              ok(resolve, {
                status: st,
                statusText: (res && res.statusText) || '',
                text: (res && res.responseText != null) ? String(res.responseText) : '',
                headers: (res && res.responseHeaders) || '',
                via: 'GM_xmlhttpRequest',
                ms: ms
              });
            },
            onerror: function (res) {
              var eNet = new Error('网络错误（GM_xmlhttpRequest）' + (res && res.error ? '：' + res.error : ''));
              eNet.ms = Date.now() - reqT0;
              favNoteReq(method, url, 0, eNet.ms, 'GM_xmlhttpRequest（网络错误）');
              ok(reject, eNet);
            },
            ontimeout: function () {
              var eTo = new Error('请求超时（超过 ' + FAV_TIMEOUT_MS + 'ms）');
              eTo.ms = Date.now() - reqT0;
              favNoteReq(method, url, 0, eTo.ms, 'GM_xmlhttpRequest（超时）');
              ok(reject, eTo);
            },
            onabort: function () { ok(reject, new Error('请求被中止')); }
          });
        } catch (e) { ok(reject, e); }
      });
    }
    var fetchT0 = Date.now();
    return fetch(url, {
      method: method,
      headers: h,
      body: hasBody ? body : undefined,
      credentials: 'omit',   // 不要把粉笔的 Cookie 带到坚果云上去
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (t) {
        var ms = Date.now() - fetchT0;
        favNoteReq(method, url, res.status, ms, 'fetch');
        return { status: res.status, statusText: res.statusText || '', text: String(t == null ? '' : t), headers: '', via: 'fetch', ms: ms };
      });
    }).catch(function (e) {
      throw new Error('请求失败（' + favErrText(e) + '）；当前环境没有 GM_xmlhttpRequest，浏览器会以 CORS 拦截跨域 WebDAV 请求');
    });
  }

  /* ---------------- v3.11.0 诊断：请求出口 / 状态码 / 耗时（只记路径，不记账号密码） ---------------- */
  function favUrlPath(url) {
    var m = /^[a-z]+:\/\/[^/]+(\/[^?#]*)?/i.exec(String(url == null ? '' : url));
    return m ? (m[1] || '/') : String(url == null ? '' : url);
  }
  function favNoteReq(method, url, status, ms, via) {
    try {
      var d = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      favState.log.push({
        at: p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()),
        method: String(method || '').toUpperCase(),
        path: favUrlPath(url),
        status: status,
        ms: ms,
        via: via || ''
      });
      if (favState.log.length > FAV_REQ_LOG_MAX) favState.log = favState.log.slice(favState.log.length - FAV_REQ_LOG_MAX);
    } catch (e) { /* 诊断日志失败绝不影响主流程 */ }
  }
  function favLastReq() {
    var l = favState.log;
    return (l && l.length) ? l[l.length - 1] : null;
  }
  function favReqBrief() {
    var r = favLastReq();
    if (!r) return '';
    return r.method + ' ' + (r.status || '未响应') + ' · ' + (r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + 's' : r.ms + 'ms');
  }
  // 一键诊断文本：面板「诊断信息」按钮 / 控制台 __fwFav.diag() 共用（账号密码只回显长度，不泄露内容）
  function favDiagText() {
    var cfg = favGetConfig();
    var snap = favSnapGet(cfg);
    var lines = [];
    lines.push('【粉笔悬浮查词 · 收藏诊断】脚本 v3.13.0');
    lines.push('页面：' + favPageUrl());
    lines.push('配置状态：' + (favIsConfigured() ? '已配置' : '未配置（点「收藏」会先弹配置引导）'));
    lines.push('  服务器：' + (cfg.url || '(空)'));
    lines.push('  账号：' + (cfg.username ? '已填（' + cfg.username.length + ' 位）' : '(空)'));
    lines.push('  密码：' + (cfg.password ? '已填（' + cfg.password.length + ' 位）' : '(空)'));
    lines.push('  保存路径：' + cfg.filePath);
    lines.push('  目标 URL：' + favFileUrl(cfg));
    lines.push('请求出口：' + (typeof GM_xmlhttpRequest === 'function' ? 'GM_xmlhttpRequest（免 CORS，推荐）' : 'fetch（浏览器同源策略可能拦截跨域 WebDAV）'));
    // 收藏模块可被离线回归单独抽出（不含面板常量），这里对面板兜底超时做宽容读取
    var bookMs = (typeof BOOK_LOAD_TIMEOUT_MS === 'number') ? BOOK_LOAD_TIMEOUT_MS : 15000;
    lines.push('单次请求超时：' + FAV_TIMEOUT_MS + 'ms；面板兜底超时：' + bookMs + 'ms');
    lines.push('本机收藏标记：' + favGetWordSet().size + ' 个词');
    lines.push('远端快照：' + (snap ? (snap.at + ' · ' + favCountWords(snap.content) + ' 个词 · ETag ' + (snap.etag ? '有' : '无')) : '无（下次打开面板会重新建立）'));
    lines.push('最近 ' + favState.log.length + ' 次请求（新 → 旧）：');
    for (var i = favState.log.length - 1; i >= 0; i--) {
      var r = favState.log[i];
      lines.push('  ' + r.at + '  ' + r.method + ' ' + r.path + ' → ' + (r.status || '未响应') +
        ' · ' + (r.ms >= 1000 ? (r.ms / 1000).toFixed(2) + 's' : r.ms + 'ms') + (r.via ? ' · ' + r.via : ''));
    }
    if (!favState.log.length) lines.push('  （还没有发出过 WebDAV 请求）');
    lines.push('笔记功能：' + (CONFIG.favNoteEnabled ? '已启用' : '未启用'));
    lines.push('提示：401/403 = 账号或应用密码不对；404/405 = 保存路径不可写；409 = 上级目录不存在；超时 = 网络或代理拦截 dav.jianguoyun.com。');
    return lines.join('\n');
  }

  /* ---------------- v3.11.0 远端文件快照：省掉「每次收藏都先 GET 一遍」的往返 ---------------- */
  function favCfgKey(cfg) {
    return String((cfg && cfg.url) || '') + '|' + String((cfg && cfg.filePath) || '');
  }
  function favSnapGet(cfg) {
    if (favState.snap === undefined) {
      var raw = '', parsed = null;
      try { raw = favStoreGet(FAV_SNAP_KEY, '') || ''; } catch (e) { raw = ''; }
      try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
      favState.snap = (parsed && typeof parsed === 'object') ? parsed : null;
    }
    var sn = favState.snap;
    if (!sn || sn.key !== favCfgKey(cfg) || typeof sn.content !== 'string') return null;
    return sn;
  }
  function favSnapSave(cfg, content, etag) {
    var text = String(content == null ? '' : content);
    var sn = { key: favCfgKey(cfg), content: text, etag: etag || null, at: favFormatTime(new Date()) };
    favState.snap = sn;
    try { if (text.length <= FAV_SNAP_MAX) favStoreSet(FAV_SNAP_KEY, JSON.stringify(sn)); } catch (e) { /* 体积过大只留内存 */ }
    return sn;
  }
  function favSnapDrop(cfg) {
    favState.snap = null;
    try { favStoreRemove(FAV_SNAP_KEY); } catch (e) { /* ignore */ }
    if (cfg) favState.dirsOk[favCfgKey(cfg)] = false;   // 配置 / 目录状态可能已变，下次写入重新探测
  }

  /* ---------------- v3.11.0 快路径：有快照就直接 PUT（少一次 GET 往返） ---------------- */
  function favAppendFast(cfg, card) {
    var sn = favSnapGet(cfg);
    if (!sn) return favAppendToWebdav(cfg, card);
    // v3.15.0：快照必须是可解析的 JSON 文档；旧版 Markdown 快照一律作废，退回安全路径重读远端
    if (!favParseDoc(sn.content)) { favSnapDrop(cfg); return favAppendToWebdav(cfg, card); }
    var merged = favMergeEntry(sn.content, card.entry);
    if (merged.duplicated) {
      return Promise.resolve({ duplicated: true, created: false, count: favCountWords(merged.doc), via: '本机快照', fast: true });
    }
    if (!sn.etag) return favAppendToWebdav(cfg, card);   // 无 ETag 无法做乐观锁 → 回退安全路径
    favLog('收藏走快路径', '本机快照直接合并后 PUT（省掉一次 GET）');
    return favPutFile(cfg, merged.text, { etag: sn.etag }).then(function (res) {
      if (res.status >= 200 && res.status < 300) {
        favSnapSave(cfg, merged.text, favExtractEtag(res.headers) || sn.etag);
        if (!favExtractEtag(res.headers)) favWarn('远端未返回 ETag，本机快照后续直写可能退化为「最后写入者胜」');
        return { duplicated: false, created: false, count: favCountWords(merged.doc), via: (res.via || '') + '（本机快照直写）', fast: true, ms: res.ms };
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码（坚果云须用「应用密码」）');
      }
      // 快照过期 / 目录被改动 → 丢掉快照，退回「读 → 改 → 回写」安全路径
      favWarn('快路径写入未成功，回退安全路径重试', 'HTTP ' + res.status + ' · ' + (res.ms || 0) + 'ms');
      favSnapDrop(cfg);
      return favAppendToWebdav(cfg, card);
    });
  }
  function favRemoveFast(cfg, word) {
    var sn = favSnapGet(cfg);
    if (!sn || !sn.etag) return favRemoveFromWebdav(cfg, word);
    // v3.15.0：快照必须是可解析的 JSON 文档；旧版 Markdown 快照一律作废，退回安全路径重读远端
    if (!favParseDoc(sn.content)) { favSnapDrop(cfg); return favRemoveFromWebdav(cfg, word); }
    var next = favTombstoneEntry(sn.content, word);
    if (!next.removed) {
      return Promise.resolve({ removed: false, noFile: false, count: next.count, via: '本机快照', fast: true });
    }
    favLog('取消收藏走快路径', '本机快照直接墓碑化后 PUT（省掉一次 GET）');
    return favPutFile(cfg, next.text, { etag: sn.etag }).then(function (res) {
      if (res.status >= 200 && res.status < 300) {
        favSnapSave(cfg, next.text, favExtractEtag(res.headers) || sn.etag);
        return { removed: true, noFile: false, noEnd: false, count: next.count, via: (res.via || '') + '（本机快照直写）', fast: true, ms: res.ms };
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码（坚果云须用「应用密码」）');
      }
      favWarn('快路径取消未成功，回退安全路径重试', 'HTTP ' + res.status + ' · ' + (res.ms || 0) + 'ms');
      favSnapDrop(cfg);
      return favRemoveFromWebdav(cfg, word);
    });
  }

  /* ---------------- 远端文件读写 ---------------- */
  // 读取远端已有文件（不存在不算错误，返回 exists:false）
  function favGetFile(cfg) {
    return favRequest('GET', favFileUrl(cfg), {
      'Authorization': favAuthHeader(cfg),
      'Accept': 'application/json, text/plain, */*',
      'Cache-Control': 'no-cache'
    }).then(function (res) {
      // 404：目标文件不存在；409（坚果云等返回 AncestorsNotFound / Conflict）：上级目录不存在
      // → 与 404 一并按「不存在」处理，交给上游建目录流程，避免被误判成「读取失败」直接中断。
      if (res.status === 404 || res.status === 409) {
        favSnapDrop(cfg);   // 远端确实没有这个文件：清掉旧快照，避免下次拿过期内容直写
        return { exists: false, content: '', etag: null, status: res.status, ms: res.ms };
      }
      if (res.status === 401 || res.status === 403) throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码（坚果云须用「应用密码」）');
      if (res.status < 200 || res.status >= 300) throw new Error('读取远端文件失败（HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '）');
      var etag = favExtractEtag(res.headers);
      favSnapSave(cfg, res.text, etag);   // v3.11.0：读一次就留快照——之后再收藏不必先 GET 一遍
      return { exists: true, content: res.text, etag: etag, status: res.status, ms: res.ms };
    });
  }
  // 整体回写：cond.etag → If-Match（已有文件，乐观锁）；cond.create → If-None-Match:*（确认不存在时新建）
  function favPutFile(cfg, content, cond) {
    cond = cond || {};
    var headers = {
      'Authorization': favAuthHeader(cfg),
      'Content-Type': 'application/json; charset=utf-8'
    };
    if (cond.etag) headers['If-Match'] = cond.etag;
    else if (cond.create) headers['If-None-Match'] = '*';
    return favRequest('PUT', favFileUrl(cfg), headers, content);
  }
  // 尽力创建保存路径上的各级目录（已存在 / 服务端不支持时静默跳过，真正的问题交给 PUT 报错）
  function favEnsureDirs(cfg, force) {
    var dirsKey = favCfgKey(cfg);
    // v3.11.0：同一配置下目录只需探测一次（目录已存在时服务端多半回 405），省掉每次收藏的 MKCOL 往返；
    // 写入真遇到 404/405/409 时会带 force 重探一次，避免「用户手动删了目录后一直 409」。
    if (!force && favState.dirsOk[dirsKey]) return Promise.resolve(false);
    var segs = String(cfg.filePath || '').split('/').filter(function (s) { return !!s; });
    // 只有文件名（无目录层级）时确实没有可建目录：这类路径在 favNormalizeFilePath 里已自动补
    // 「我的坚果云/」；仍然出现单段路径说明是自建 WebDAV，原样返回、由上层 404 提示兜底。
    if (segs.length <= 1) return Promise.resolve(false);
    var created = false, chain = Promise.resolve();
    var makeStep = function (i) {
      return function () {
        var dirUrl = favJoinUrl(cfg.url, favEncodePath(segs.slice(0, i + 1).join('/')));
        return favRequest('MKCOL', dirUrl, { 'Authorization': favAuthHeader(cfg) }).then(function (res) {
          if (res.status >= 200 && res.status < 300) created = true;
        }).catch(function () { /* 目录已存在或服务端不支持 MKCOL，继续 */ });
      };
    };
    for (var i = 0; i < segs.length - 1; i++) chain = chain.then(makeStep(i));
    return chain.then(function () {
      favState.dirsOk[dirsKey] = true;   // 探测过就记下；真不可写时 PUT 会报错，届时再 force 重探
      return created;
    });
  }

  /* ---------------- v3.15.0 JSON 收藏文档纯函数（无 DOM 依赖，可离线单测） ----------------
     收藏文件 = 整份 JSON 文档 { app, schema, exportedAt, words:[{word,updatedTime,at,pinyin,...}], deleted:{词名:删除时间戳} }。
     words 按词名去重、updatedTime 取较新；deleted 为删除墓碑（时间戳只增不减），墓碑时间 >= 词条 updatedTime 时该词不复活。
     对应错题本脚本的 parseDoc / mergeDocs / buildDoc：favParseDoc / favMergeDocs / favBuildDoc。 */
  function favNormalizeWord(word) {
    return String(word == null ? '' : word).trim();
  }
  // 词名合法性校验：占位示例、含尖括号的伪词一律不算真实词
  function favIsRealWord(word) {
    var w = String(word == null ? '' : word).trim();
    if (!w) return false;
    if (w === '...' || w === '…') return false;
    if (/[<>]/.test(w)) return false;
    if (/encodeURIComponent/i.test(w)) return false;
    return true;
  }
  // 空文档：首次创建 / 合并前的基准
  function favEmptyDoc() {
    return { app: 'fenbi-word-hover', schema: 3, exportedAt: '', words: [], deleted: {} };
  }
  // 组装整份 JSON 文档（对应错题本 buildDoc）：归一化 app/schema/exportedAt/words/deleted
  // v3.18.2：序列化时统一剔除已废弃字段 page（页面链接），保证写入/合并结果不再含旧链接
  function favBuildDoc(doc) {
    var d = (doc && typeof doc === 'object') ? doc : favEmptyDoc();
    var words = Array.isArray(d.words) ? d.words : [];
    var deleted = (d.deleted && typeof d.deleted === 'object' && !Array.isArray(d.deleted)) ? d.deleted : {};
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w && typeof w === 'object' && 'page' in w) delete w.page;
    }
    return {
      app: 'fenbi-word-hover',
      schema: 3,
      exportedAt: new Date().toISOString(),
      words: words,
      deleted: deleted
    };
  }
  // 解析远端 JSON 文本（对应错题本 parseDoc）：必须是含 words 数组的合法 JSON，否则视为不可识别
  function favParseDoc(text) {
    try {
      var d = JSON.parse(String(text == null ? '' : text));
      return (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.words)) ? d : null;
    } catch (e) { return null; }
  }
  function favSerializeDoc(doc) { return JSON.stringify(favBuildDoc(doc)); }
  // v3.18.2：清理已废弃字段（页面链接 page）：解析 JSON 文本，删除 words 中各词条的 page 字段。
  // 有清理时返回清理后的 JSON 文本，无清理时返回原文本（保持 etag 语义不变）。
  function favCleanDeprecatedFields(text) {
    var doc;
    try { doc = JSON.parse(String(text == null ? '' : text)); } catch (e) { return text; }
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.words)) return text;
    var changed = false;
    for (var i = 0; i < doc.words.length; i++) {
      var w = doc.words[i];
      if (w && typeof w === 'object' && 'page' in w) { delete w.page; changed = true; }
    }
    return changed ? JSON.stringify(doc) : text;
  }
  // 已收藏词数（接受文档对象或 JSON 文本，对应旧 favCountBlocks）
  function favCountWords(docOrText) {
    var d = (typeof docOrText === 'string') ? favParseDoc(docOrText) : docOrText;
    return (d && Array.isArray(d.words)) ? d.words.length : 0;
  }
  // 双向并集合并（对应错题本 mergeDocs）：remote 与 local 两份文档合并——
  //   1) 删除墓碑按词名取最大删除时间（时间并集，只增不减）；2) words 按词名去重、updatedTime 取较新；
  //   3) 墓碑时间 >= 词条 updatedTime 的词条被过滤（删除防复活）。返回 { doc, added }。
  function favMergeDocs(remote, local) {
    if (!remote || typeof remote !== 'object' || !Array.isArray(remote.words)) remote = favEmptyDoc();
    if (!local || typeof local !== 'object' || !Array.isArray(local.words)) local = favEmptyDoc();
    var del = {};
    var rdel = (remote.deleted && typeof remote.deleted === 'object' && !Array.isArray(remote.deleted)) ? remote.deleted : {};
    var ldel = (local.deleted && typeof local.deleted === 'object' && !Array.isArray(local.deleted)) ? local.deleted : {};
    Object.keys(rdel).forEach(function (w) {
      var t = Number(rdel[w]) || 0;
      if (!(del[w] >= t)) del[w] = t;
    });
    Object.keys(ldel).forEach(function (w) {
      var t = Number(ldel[w]) || 0;
      if (!(del[w] >= t)) del[w] = t;
    });
    var map = new Map();
    (Array.isArray(local.words) ? local.words : []).forEach(function (it) {
      if (it && typeof it === 'object' && favNormalizeWord(it.word)) map.set(favNormalizeWord(it.word), it);
    });
    var added = 0;
    (Array.isArray(remote.words) ? remote.words : []).forEach(function (ri) {
      if (!ri || typeof ri !== 'object') return;
      var w = favNormalizeWord(ri.word);
      if (!w) return;
      var li = map.get(w);
      if (!li) { map.set(w, ri); added++; }
      else if ((ri.updatedTime || 0) > (li.updatedTime || 0)) map.set(w, ri);   // 较新者胜
    });
    var words = [];
    map.forEach(function (it) {
      var w = favNormalizeWord(it.word);
      if (del[w] !== undefined && del[w] >= (it.updatedTime || 0)) return;   // 墓碑不早于词条时间 → 该词已被删除，防复活
      words.push(it);
    });
    var doc = favBuildDoc({ words: words, deleted: del });
    return { doc: doc, added: added };
  }
  // 收藏：把单条词条并入已有文档（文本），同名词已存在且不比本次新 → 视为重复不覆盖。
  // 返回 { text, doc, duplicated, count }（结构兼容旧 favMergeIntoMarkdown 调用点）。
  function favMergeEntry(text, entry) {
    if (!entry || typeof entry !== 'object' || !favNormalizeWord(entry.word)) throw new Error('收藏内容为空，无法写入');
    var remote = favParseDoc(text);
    if (!remote) throw new Error('远端收藏文件不是有效的 JSON 文档（可能仍是旧版 Markdown 格式，请备份后手动转成 JSON 或删除重建）');
    var local = favEmptyDoc();
    local.words = [entry];
    var res = favMergeDocs(remote, local);
    var w = favNormalizeWord(entry.word);
    var final = null;
    for (var i = 0; i < res.doc.words.length; i++) {
      if (favNormalizeWord(res.doc.words[i].word) === w) { final = res.doc.words[i]; break; }
    }
    var remoteHad = false;
    for (var j = 0; j < remote.words.length; j++) {
      if (favNormalizeWord(remote.words[j].word) === w) { remoteHad = true; break; }
    }
    var duplicated = remoteHad && (!final || (final.updatedTime || 0) >= (entry.updatedTime || 0));
    return { text: favSerializeDoc(res.doc), doc: res.doc, duplicated: duplicated, count: res.doc.words.length };
  }
  // 取消收藏：把词从 words 摘除，并以当前时间写入 deleted 墓碑（只增不减；墓碑时间 >= 词条时间时防复活）。
  // 返回 { text, doc, removed, count, noEnd }（结构兼容旧 favRemoveFromMarkdown 调用点，noEnd 恒 false）。
  function favTombstoneEntry(text, word) {
    var doc = favParseDoc(text);
    if (!doc) throw new Error('远端收藏文件不是有效的 JSON 文档（可能仍是旧版 Markdown 格式，请备份后手动转成 JSON 或删除重建）');
    var w = favNormalizeWord(word);
    var removed = false;
    for (var i = 0; i < doc.words.length; i++) {
      if (favNormalizeWord(doc.words[i].word) === w) { doc.words.splice(i, 1); removed = true; break; }
    }
    if (removed) {
      var now = Date.now();
      if (!(doc.deleted[w] >= now)) doc.deleted[w] = now;   // 墓碑时间只增不减（时间并集）
    }
    return { text: favSerializeDoc(doc), doc: doc, removed: removed, count: doc.words.length, noEnd: false };
  }
  function favFormatTime(d) {
    var x = (d instanceof Date) ? d : new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + ' ' +
      p(x.getHours()) + ':' + p(x.getMinutes()) + ':' + p(x.getSeconds());
  }
  function favPageUrl() {
    try { if (typeof location !== 'undefined' && location && location.href) return String(location.href); } catch (e) { /* ignore */ }
    try { if (window && window.location && window.location.href) return String(window.location.href); } catch (e) { /* ignore */ }
    return '';
  }
  // 组装一个词的 JSON 收藏词条（字段：词 / 拼音 / 释义 / 用法 / 出处 / 例句 / 近义反义 / 来源 / 收藏时间 / 页面）
  function favBuildCard(word, data) {
    var w = favNormalizeWord(word);
    var d = data || {};
    var now = Date.now();
    var at = favFormatTime(new Date());
    var entry = {
      word: w,
      updatedTime: now,
      at: at,
      pinyin: d.pinyin || '',
      explanation: d.explanation || '',
      usage: d.usage || '',
      derivation: d.derivation || '',
      example: d.example || '',
      similar: d.similar || '',
      opposite: d.opposite || '',
      source: d.source || '',
      note: ''
    };
    return { word: w, at: at, updatedTime: now, entry: entry };
  }

  /* ---------------- 本机「已收藏」标记（按钮状态 + 去重） ---------------- */
  function favGetWordSet() {
    if (favState.words) return favState.words;
    var arr = [];
    try {
      var parsed = JSON.parse(favStoreGet(FAV_WORDS_KEY, '') || '[]');
      if (Array.isArray(parsed)) arr = parsed;
    } catch (e) { arr = []; }
    favState.words = new Set(arr.map(function (x) { return String(x); }));
    return favState.words;
  }
  function favMarkLocal(word) {
    var w = String(word == null ? '' : word).trim();
    if (!w) return;
    var set = favGetWordSet();
    set.add(w);
    var arr = Array.from(set);
    if (arr.length > FAV_WORDS_KEEP_MAX) arr = arr.slice(arr.length - FAV_WORDS_KEEP_MAX);
    favStoreSet(FAV_WORDS_KEY, JSON.stringify(arr));
  }
  function favUnmarkLocal(word) {
    var w = String(word == null ? '' : word).trim();
    var set = favGetWordSet();
    if (!set.has(w)) return;
    set.delete(w);
    favStoreSet(FAV_WORDS_KEY, JSON.stringify(Array.from(set)));
  }
  function favIsFavorited(word) {
    var w = String(word == null ? '' : word).trim();
    return !!w && favGetWordSet().has(w);
  }

  /* ---------------- 写入 / 移除（读 → 改 → 整体回写，ETag 乐观锁） ---------------- */
  function favAppendToWebdav(cfg, card) {
    var conflict = '';
    // 进循环前先主动确保保存路径的上级目录存在：循环第一步的 GET 在父目录缺失时就会抛错
    // （坚果云返回 409），建目录兜底永远走不到。
    return favEnsureDirs(cfg).then(function () {
      var attempt = 0;
      var step = function () {
        return favGetFile(cfg).then(function (cur) {
          var base = cur.exists ? cur.content : favSerializeDoc(favEmptyDoc());
          var merged = favMergeEntry(base, card.entry);
          if (merged.duplicated) {
            return { duplicated: true, created: false, count: favCountWords(merged.doc), via: '' };
          }
          return favPutFile(cfg, merged.text, cur.exists ? { etag: cur.etag } : { create: true }).then(function (res) {
            if (res.status === 412 || res.status === 428) {
              conflict = 'HTTP ' + res.status;
              favWarn('WebDAV 写入冲突，重新读取后再试', conflict + ' 第 ' + (attempt + 1) + ' 次');
              return retry();
            }
            if (res.status === 401 || res.status === 403) {
              throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码（坚果云须用「应用密码」）');
            }
            // 404 / 405：目标路径不可写；409：父目录不存在 → 统一走「建目录后重试」
            if (res.status === 404 || res.status === 405 || res.status === 409) {
              return favEnsureDirs(cfg, true).then(function (created) {
                conflict = 'HTTP ' + res.status + (created ? '（已尝试创建上级目录）' : '');
                favWarn('WebDAV 写入失败，尝试创建上级目录后重试', conflict + ' 第 ' + (attempt + 1) + ' 次');
                return retry();
              });
            }
            if (res.status < 200 || res.status >= 300) {
              throw new Error('写入远端文件失败（HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '）');
            }
            if (cur.exists && !cur.etag) favWarn('远端文件未返回 ETag，本次写入退化为「最后写入者胜」');
            favSnapSave(cfg, merged.text, favExtractEtag(res.headers) || (cur.etag || null));   // v3.11.0：写入成功即留快照，下次收藏可走直写
            return { duplicated: false, created: !cur.exists, count: favCountWords(merged.doc), via: res.via, ms: res.ms };
          });
        });
      };
      var retry = function () {
        attempt++;
        if (attempt > FAV_MAX_RETRY) throw new Error(favFormatWriteFailure('收藏', cfg, conflict));
        return step();
      };
      return step();
    });
  }
  function favRemoveFromWebdav(cfg, word) {
    var conflict = '';
    var attempt = 0;
    var step = function () {
      return favGetFile(cfg).then(function (cur) {
        if (!cur.exists) {
          // 远端文件都不存在 → 没有任何记录可删，直接交回调用方（本机标记由调用方清掉）
          return { removed: false, noFile: true, count: 0, via: '' };
        }
        var next = favTombstoneEntry(cur.content, word);
        if (!next.removed) return { removed: false, noFile: false, count: next.count, via: '' };
        return favPutFile(cfg, next.text, cur.etag ? { etag: cur.etag } : {}).then(function (res) {
          if (res.status === 412 || res.status === 428) {
            conflict = 'HTTP ' + res.status;
            favWarn('WebDAV 写入冲突，重新读取后再试', conflict + ' 第 ' + (attempt + 1) + ' 次');
            return retry();
          }
          if (res.status === 401 || res.status === 403) {
            throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码（坚果云须用「应用密码」）');
          }
          if (res.status === 404 || res.status === 405 || res.status === 409) {
            return favEnsureDirs(cfg, true).then(function (created) {
              conflict = 'HTTP ' + res.status + (created ? '（已尝试创建上级目录）' : '');
              favWarn('WebDAV 写入失败，尝试创建上级目录后重试', conflict + ' 第 ' + (attempt + 1) + ' 次');
              return retry();
            });
          }
          if (res.status < 200 || res.status >= 300) {
            throw new Error('写入远端文件失败（HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '）');
          }
          if (!cur.etag) favWarn('远端文件未返回 ETag，本次写入退化为「最后写入者胜」');
          favSnapSave(cfg, next.text, favExtractEtag(res.headers) || (cur.etag || null));   // v3.11.0：写入成功即留快照
          return { removed: true, noFile: false, noEnd: false, count: next.count, via: res.via, ms: res.ms };
        });
      });
    };
    var retry = function () {
      attempt++;
      if (attempt > FAV_MAX_RETRY) throw new Error(favFormatWriteFailure('取消收藏', cfg, conflict));
      return step();
    };
    return step();
  }

  /* ---------------- v3.18.1 更新词条笔记：保留词条其它字段，仅改 note/updatedTime ---------------- */
  // 快路径：读快照 → 定位词条 → 只改 note/updatedTime → PUT 写回（词条不存在或快照不可用时回退安全路径）
  function favUpdateNoteFast(cfg, word, note) {
    var sn = favSnapGet(cfg);
    if (!sn || !sn.etag) return favUpdateNoteWebdav(cfg, word, note);
    if (!favParseDoc(sn.content)) { favSnapDrop(cfg); return favUpdateNoteWebdav(cfg, word, note); }
    var doc = favParseDoc(sn.content);
    var w = favNormalizeWord(word);
    var hit = null;
    for (var i = 0; i < doc.words.length; i++) {
      if (favNormalizeWord(doc.words[i].word) === w) { hit = doc.words[i]; break; }
    }
    if (!hit) return favUpdateNoteWebdav(cfg, word, note);   // 快照里没有该词 → 回退安全路径
    hit.note = note;
    hit.updatedTime = Date.now();
    var text = favSerializeDoc(doc);
    favLog('笔记更新走快路径', '本机快照直接改 note 后 PUT（省掉一次 GET）');
    return favPutFile(cfg, text, { etag: sn.etag }).then(function (res) {
      if (res.status >= 200 && res.status < 300) {
        favSnapSave(cfg, text, favExtractEtag(res.headers) || sn.etag);
        return { ok: true, count: favCountWords(text), via: (res.via || '') + '（本机快照直写）', fast: true, ms: res.ms, text: text };
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码（坚果云须用「应用密码」）');
      }
      favWarn('快路径笔记更新未成功，回退安全路径重试', 'HTTP ' + res.status + ' · ' + (res.ms || 0) + 'ms');
      favSnapDrop(cfg);
      return favUpdateNoteWebdav(cfg, word, note);
    });
  }
  // 安全路径：GET 远端 → 定位词条 → 只改 note/updatedTime → PUT（乐观锁重试）
  function favUpdateNoteWebdav(cfg, word, note) {
    var conflict = '';
    var attempt = 0;
    var step = function () {
      return favGetFile(cfg).then(function (cur) {
        if (!cur.exists) throw new Error('远端收藏文件还不存在，无法保存笔记');
        var doc = favParseDoc(cur.content);
        if (!doc) throw new Error('远端收藏文件不是有效的 JSON 文档（可能仍是旧版 Markdown 格式，请备份后手动转成 JSON 或删除重建）');
        var w = favNormalizeWord(word);
        var hit = null;
        for (var i = 0; i < doc.words.length; i++) {
          if (favNormalizeWord(doc.words[i].word) === w) { hit = doc.words[i]; break; }
        }
        if (!hit) throw new Error('远端收藏文件里没有「' + word + '」这个词条，无法保存笔记');
        hit.note = note;
        hit.updatedTime = Date.now();
        var text = favSerializeDoc(doc);
        return favPutFile(cfg, text, cur.etag ? { etag: cur.etag } : {}).then(function (res) {
          if (res.status === 412 || res.status === 428) {
            conflict = 'HTTP ' + res.status;
            favWarn('WebDAV 写入冲突，重新读取后再试', conflict + ' 第 ' + (attempt + 1) + ' 次');
            return retry();
          }
          if (res.status === 401 || res.status === 403) {
            throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码（坚果云须用「应用密码」）');
          }
          if (res.status === 404 || res.status === 405 || res.status === 409) {
            return favEnsureDirs(cfg, true).then(function (created) {
              conflict = 'HTTP ' + res.status + (created ? '（已尝试创建上级目录）' : '');
              favWarn('WebDAV 写入失败，尝试创建上级目录后重试', conflict + ' 第 ' + (attempt + 1) + ' 次');
              return retry();
            });
          }
          if (res.status < 200 || res.status >= 300) {
            throw new Error('写入远端文件失败（HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '）');
          }
          favSnapSave(cfg, text, favExtractEtag(res.headers) || (cur.etag || null));
          return { ok: true, count: favCountWords(text), via: res.via, ms: res.ms, text: text };
        });
      });
    };
    var retry = function () {
      attempt++;
      if (attempt > FAV_MAX_RETRY) throw new Error(favFormatWriteFailure('保存笔记', cfg, conflict));
      return step();
    };
    return step();
  }

  /* ---------------- 失败文案：按 HTTP 状态码分层提示 ---------------- */
  function favStatusHint(status, cfg) {
    var code = String(status == null ? '' : status).replace(/[^0-9]/g, '');
    var path = String((cfg && cfg.filePath) || FAV_FILE_DEFAULT);
    if (code === '401' || code === '403') {
      return '账号或密码没有通过认证。坚果云的账号要填「注册邮箱」，密码必须用「账户信息 → 安全选项 → 添加应用」生成的「应用密码」，填登录密码会一直 401。';
    }
    if (code === '404' || code === '405') {
      return '服务器地址或保存路径不对（该路径不可写）。坚果云地址固定为 https://dav.jianguoyun.com/dav/；' +
        '保存路径「' + path + '」只有裸文件名时脚本会自动补成「' + FAV_JGY_ROOT + '/' + path + '」（dav/ 是虚拟服务根，根目录不可写）。';
    }
    if (code === '409') {
      return '服务端报告上级目录不存在或状态冲突，请确认保存路径「' + path + '」的上级目录已存在' +
        '（脚本会自动尝试创建，失败时可在坚果云网页端手动建好）。';
    }
    if (code === '412' || code === '428') {
      return '远端文件确实正被其它端改写（ETag 乐观锁校验未通过），稍后重试即可。';
    }
    return '请稍后重试；若持续失败，可在配置面板点「连接测试」查看详情。';
  }
  function favFormatWriteFailure(action, cfg, conflict) {
    var m = /HTTP\s*(\d+)/.exec(String(conflict == null ? '' : conflict));
    return action + '失败，自动重试 ' + FAV_MAX_RETRY + ' 次仍未成功（' + (conflict || '未知原因') + '）。' +
      favStatusHint(m ? m[1] : '', cfg);
  }

  /* ---------------- 连接测试：① 探测服务与账号（OPTIONS，不支持则退化为 PROPFIND）② 读目标文件现状 ---------------- */
  function favTestConnection(cfg) {
    var c = favNormalizeConfig(cfg || favGetConfig());
    if (!c.url) return Promise.reject(new Error('请先填写 WebDAV 服务器地址（坚果云固定为 https://dav.jianguoyun.com/dav/）'));
    if (!c.username) return Promise.reject(new Error('请先填写 WebDAV 账号（坚果云为注册邮箱）'));
    var auth = { 'Authorization': favAuthHeader(c) };
    var dirUrl = favDirUrl(c);
    return favRequest('OPTIONS', dirUrl, Object.assign({ 'Accept': '*/*' }, auth)).then(function (probe) {
      if (probe.status === 405 || probe.status === 501) {
        return favRequest('PROPFIND', dirUrl,
          Object.assign({ 'Depth': '0', 'Content-Type': 'application/xml; charset=utf-8' }, auth),
          '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>');
      }
      return probe;
    }).then(function (probe) {
      if (probe.status === 401 || probe.status === 403) {
        throw new Error('连接失败（HTTP ' + probe.status + '）：' + favStatusHint(probe.status, c));
      }
      if (probe.status < 200 || probe.status >= 300) {
        throw new Error('连接失败（HTTP ' + probe.status + (probe.statusText ? ' ' + probe.statusText : '') + '）：' +
          favStatusHint(probe.status, c));
      }
      var dav = /^dav:\s*(.+)$/im.exec(String(probe.headers || ''));
      return favGetFile(c).then(function (file) {
        return {
          status: probe.status, via: probe.via,
          dav: dav ? dav[1].trim() : '',
          filePath: c.filePath, fileExists: file.exists, blockCount: favCountWords(file.content)
        };
      });
    });
  }

  /* ---------------- 交互：按钮 / 收藏动作 ---------------- */
  function favButtonLabel(on) {
    return on ? '已收藏<span class="fw-side-sub">点此取消</span>' : '收藏<span class="fw-side-sub">到坚果云</span>';
  }
  function favButtonHtml(word) {
    var on = favIsFavorited(word);
    return '<button type="button" class="fw-side-btn fw-side-fav' + (on ? ' is-on' : '') +
      '" data-fw-word="' + esc(String(word == null ? '' : word).trim()) + '"' +
      ' title="' + (on ? '取消收藏：从坚果云的收藏文件里移除该词' : '收藏这个词到坚果云（WebDAV）') + '">' +
      favButtonLabel(on) + '</button>';
  }
  function favApplyBtnState(btn, word, on) {
    if (!btn || !btn.classList) return;
    try {
      if (on) btn.classList.add('is-on'); else btn.classList.remove('is-on');
      btn.innerHTML = favButtonLabel(on);
      if (btn.setAttribute) btn.setAttribute('title', on ? '取消收藏：从坚果云的收藏文件里移除该词' : '收藏这个词到坚果云（WebDAV）');
    } catch (e) { /* 按钮可能已被移除，忽略 */ }
  }
  // 收藏状态变化后刷新已显示的按钮（悬浮窗 + 中键固定栏），无需重渲染整个气泡
  function favRefreshButtons(word) {
    var w = word || currentWord;
    if (!w) return;
    var on = favIsFavorited(w);
    try { if (tipEl) favApplyBtnState(tipEl.querySelector('.fw-side-fav'), w, on); } catch (e) { /* ignore */ }
    try { if (pinBar) favApplyBtnState(pinBar.querySelector('.fw-side-fav'), w, on); } catch (e) { /* ignore */ }
  }
  // 取某个词当前可用的释义数据：优先"正在显示的那份"，其次内存 / 本地缓存、最后本地成语词库
  function favDataFor(word) {
    var w = String(word == null ? '' : word).trim();
    if (!w) return null;
    if (w === currentWord && currentData) return currentData;
    var cached = memoryCache.get(w) || loadWordCache(w);
    if (cached) return cached;
    var local = lookupDict(w);
    if (local) {
      return {
        word: w, source: '成语词库', pinyin: local.p, explanation: local.e,
        derivation: shortenSource(local.d), example: local.x,
        usage: usageFromText(local.e), similar: '', opposite: ''
      };
    }
    return null;
  }
  // 未配置 WebDAV：提示 + 直达配置面板
  function favPromptConfig() {
    showToast('请先配置 WebDAV 地址和账号（坚果云），再收藏', 6000, '去配置', openFavWebdavPanel);
  }

  // ================= v3.8.0：「我的收藏」面板 =================

  /* ——— 解析：从远端 JSON 收藏文档文本提取所有词条，返回词条数组（渲染层数据结构与旧版 bookParseBlocks 一致） ——— */
  function bookParseBlocks(text) {
    var doc = favParseDoc(text);
    if (!doc) return [];
    var out = [];
    var words = Array.isArray(doc.words) ? doc.words : [];
    for (var i = 0; i < words.length; i++) {
      var it = words[i];
      if (!it || typeof it !== 'object') continue;
      var word = favNormalizeWord(it.word);
      if (!favIsRealWord(word)) continue;   // 兜底：非法词名不渲染成卡片
      out.push({
        word: word,
        pinyin: it.pinyin || '',
        explanation: it.explanation || '',
        usage: it.usage || '',
        derivation: it.derivation || '',
        example: it.example || '',
        similar: it.similar || '',
        opposite: it.opposite || '',
        source: it.source || '',
        note: it.note || '',
        meta: { time: it.at || '' }
      });
    }
    return out;
  }

  /* ——— 渲染：把 JSON 收藏词条渲染为卡片 HTML ———
     v3.10.0：默认只显示「成语 + 释义」，点击卡片即展开其余字段（拼音/用法/出处/例句/近反义/来源/收藏时间） */
  function bookCardExtraCount(data) {
    var n = 0;
    if (data.pinyin) n++;
    if (data.usage) n++;
    if (data.derivation) n++;
    if (data.example) n++;
    if (data.similar) n++;
    if (data.source) n++;
    if (data.meta && data.meta.time) n++;
    return n;
  }
  function bookRenderCard(data) {
    var extraCount = bookCardExtraCount(data);
    var h = '';
    h += '<div class="fw-book-card"' + (extraCount ? ' data-book-expandable="1"' : '') + '>';
    // 卡片头部：成语恒定显示；拼音为可展开字段（默认被 CSS 隐藏）；右侧给展开提示
    h += '<div class="fw-book-card-head">';
    h += '<span class="fw-book-card-word">' + esc(data.word) + '</span>';
    if (data.pinyin) h += '<span class="fw-book-card-py">' + esc(data.pinyin) + '</span>';
    // 操作区右对齐：取消收藏在前，展开提示在后
    h += '<div class="fw-book-card-actions">';
    if (data.note) h += '<span class="fw-book-card-note-icon" title="有笔记">📝</span>';
    h += '<button type="button" class="fw-book-btn-unfav" data-book-word="' + esc(data.word) + '">取消收藏</button>';
    if (extraCount) h += '<span class="fw-book-card-hint">展开 ▾</span>';
    h += '</div>';
    h += '</div>';
    // 卡片正文：释义恒定显示；其余字段统一放进 .fw-book-extra，展开后才显示
    var extraHtml = '';
    if (data.usage) extraHtml += '<div class="fw-book-card-sec"><b>用法</b> <span class="fw-book-card-val">' + esc(data.usage) + '</span></div>';
    if (data.derivation) extraHtml += '<div class="fw-book-card-sec"><b>出处</b> <span class="fw-book-card-val">' + esc(data.derivation) + '</span></div>';
    if (data.example) extraHtml += '<div class="fw-book-card-sec"><b>例句</b> <span class="fw-book-card-val"><div class="fw-book-card-example">' + esc(data.example) + '</div></span></div>';
    if (data.similar) extraHtml += '<div class="fw-book-card-sec"><b>近反义</b> <span class="fw-book-card-val">' + esc(data.similar) + '</span></div>';
    if (data.source) extraHtml += '<div class="fw-book-card-sec"><b>来源</b> <span class="fw-book-card-val">' + esc(data.source) + '</span></div>';
    if (data.note) extraHtml += '<div class="fw-book-card-sec fw-book-card-sec-note"><b>笔记</b> <span class="fw-book-card-val">' + esc(data.note) + '</span></div>';
    if (data.meta && data.meta.time) {
      extraHtml += '<div class="fw-book-card-meta">';
      extraHtml += '<span>收藏时间：' + esc(data.meta.time) + '</span>';
      extraHtml += '</div>';
    }
    var bodyHtml = '';
    if (data.explanation) bodyHtml += '<div class="fw-book-card-sec"><b>释义</b> <span class="fw-book-card-val">' + esc(data.explanation) + '</span></div>';
    // 笔记编辑区（释义后、extraHtml 前）
    var noteWord = esc(data.word);
    var noteDisplay = '';
    if (data.note) noteDisplay = '<span class="fw-book-card-note-text">' + esc(data.note) + '</span>';
    var noteBtnHtml = data.note
      ? '<button type="button" class="fw-book-note-edit-btn" data-note-word="' + noteWord + '">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>'
      : '<button type="button" class="fw-book-note-edit-btn" data-note-word="' + noteWord + '">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>';
    bodyHtml += '<div class="fw-book-card-note">' +
      noteBtnHtml +
      '<div class="fw-book-note-display">' + noteDisplay + '</div>' +
      '<div class="fw-book-note-editor" style="display:none"><textarea class="fw-book-note-ta" rows="3" placeholder="输入笔记..."></textarea><button type="button" class="fw-book-note-save-btn" data-note-word="' + noteWord + '">保存</button></div>' +
    '</div>';
    if (extraHtml) bodyHtml += '<div class="fw-book-extra">' + extraHtml + '</div>';
    if (bodyHtml) h += '<div class="fw-book-card-body">' + bodyHtml + '</div>';
    h += '</div>';
    return h;
  }

  /* ——— 取消收藏：从收藏卡片触发 ——— */
  function bookUnfavFromCard(word) {
    if (!favIsConfigured()) { favPromptConfig(); return; }
    var cfg = favGetConfig();
    var btn = document.querySelector('.fw-book-btn-unfav[data-book-word="' + esc(word) + '"]');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    showToast('正在从坚果云移除：「' + word + '」…', 15000);
    favRemoveFromWebdav(cfg, word).then(function (r) {
      if (r.removed) {
        favUnmarkLocal(word);
        favRefreshButtons(word);
        try { favLocalTombstone(word); } catch (e2) { favWarn('本地暂存墓碑写入失败', favErrText(e2)); }   // v3.16.0：面板取消收藏同样记墓碑并落盘
        showToast('已取消收藏「' + word + '」，云端剩 ' + r.count + ' 个词', 3200);
        openBookPanel();
      } else {
        showToast('远端收藏文件里没有「' + word + '」这个词条，本机标记已清掉', 3200);
        if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
      }
    }, function (e) {
      favWarn('取消收藏失败', favErrText(e));
      showToast('取消收藏失败：' + favErrText(e), 5000);
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
    });
  }

  /* ——— 打开「我的收藏」面板 ——— */
  var bookPanelEl = null;
  var bookLastContent = '';      // 最近一次读到的远端收藏文件原文（供重渲染 / 重试）
  var bookOpenWords = {};
  var bookNoteEditorEl = null;
  function openNoteEditorPanel() {
    if (bookNoteEditorEl) return bookNoteEditorEl;
    var host = document.body || document.documentElement;
    if (!host || !host.appendChild) return;
    var overlay = document.createElement('div');
    overlay.className = 'fw-wd-overlay';
    overlay.innerHTML =
      '<div class="fw-wd-note-editor" role="dialog" aria-modal="true">' +
        '<div class="fw-wd-note-editor-head"><h3>编辑笔记</h3>' +
          '<button type="button" class="fw-wd-close" title="关闭">&times;</button>' +
        '</div>' +
        '<div class="fw-wd-note-editor-body"></div>' +
      '</div>';
    host.appendChild(overlay);
    bookNoteEditorEl = overlay;
    overlay.querySelector('.fw-wd-close').addEventListener('click', function(){
      if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
      bookNoteEditorEl = null;
    });
    var bodyEl = overlay.querySelector('.fw-wd-note-editor-body');
    var doc = api.localDoc();
    var html = '<p style="color:#86909c;font-size:12px;margin-bottom:12px">点击词条可编辑笔记，编辑后自动保存到收藏并同步远端。</p>';
    if (doc.words.length === 0) { html += '<p style="color:#a9aeb8;font-size:13px;text-align:center;margin-top:40px">当前没有收藏词条</p>'; }
    doc.words.forEach(function(w, idx) {
      html += '<div class="fw-note-editor-row" data-idx="' + idx + '">';
      html += '<b>' + esc(w.word) + '</b> ';
      html += '<textarea class="fw-note-editor-textarea" rows="3" placeholder="输入笔记...">' + esc(w.note||'') + '</textarea>';
      html += '<button type="button" class="fw-note-editor-save-btn" data-idx="' + idx + '">保存</button>';
      html += '</div>';
    });
    bodyEl.innerHTML = html;
    var saveBtns = overlay.querySelectorAll('.fw-note-editor-save-btn');
    for (var i = 0; i < saveBtns.length; i++) {
      (function(idx){
        saveBtns[i].addEventListener('click', function(){
          var ta = overlay.querySelector('.fw-note-editor-row[data-idx="' + idx + '"] textarea');
          var note = ta.value;
          var cfg = favGetConfig();
          favUpdateNoteFast(cfg, doc.words[idx].word, note).then(function(r){
            showToast('「' + doc.words[idx].word + '」笔记已保存，云端共 ' + r.count + ' 个词',3200);
            // 同步刷新收藏面板数据源，让「我的收藏-笔记」展示区保持一致
            if (r && r.text) bookLastContent = r.text;
            var body = bookPanelEl ? bookPanelEl.querySelector('.fw-book-body') : null;
            if (body) bookRefreshCards(body);
          }, function(e){ showToast('保存失败：'+favErrText(e),5000); });
        });
      })(i);
    }
  }        // 已展开的成语集合（重渲染后据此恢复展开态）

  function bookBindUnfav(bodyEl) {
    var unfavBtns = bodyEl.querySelectorAll('.fw-book-btn-unfav');
    for (var j = 0; j < unfavBtns.length; j++) {
      unfavBtns[j].addEventListener('click', function () {
        var w = this.getAttribute('data-book-word');
        bookUnfavFromCard(w);
      });
    }
  }

  /* v3.10.0：点击成语卡片 → 展开该词全部字段；再次点击收起。
     点「取消收藏」按钮时不触发展开切换。 */
  function bookCardWordOf(card) {
    if (!card || !card.querySelector) return '';
    var wEl = card.querySelector('.fw-book-card-word');
    return wEl ? String(wEl.textContent == null ? '' : wEl.textContent).trim() : '';
  }
  function bookSetCardState(card, open) {
    if (!card) return;
    if (open) card.classList.add('is-open'); else card.classList.remove('is-open');
    var hint = card.querySelector ? card.querySelector('.fw-book-card-hint') : null;
    if (hint) hint.textContent = open ? '收起 ▴' : '展开 ▾';
    var w = bookCardWordOf(card);
    if (w) { if (open) bookOpenWords[w] = true; else delete bookOpenWords[w]; }
  }
  function bookBindCards(bodyEl) {
    var cards = bodyEl.querySelectorAll('.fw-book-card');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        if (card.getAttribute('data-book-expandable') !== '1') return;   // 无可展开字段的卡片不响应点击
        card.addEventListener('click', function (ev) {
          var t = ev && ev.target;
          if (t && t.closest && t.closest('.fw-book-btn-unfav')) return;  // 取消收藏按钮：不切换展开
          var open = !card.classList.contains('is-open');
          bookSetCardState(card, open);
        });
      })(cards[i]);
    }
    // v3.18.0：笔记编辑区事件绑定
    bookBindNoteInCard(bodyEl);
  }
  /* v3.18.0：收藏卡片内笔记编辑区事件 */
  function bookBindNoteInCard(bodyEl) {
    var editBtns = bodyEl.querySelectorAll('.fw-book-note-edit-btn');
    for (var i = 0; i < editBtns.length; i++) {
      (function(btn){
        var word = btn.getAttribute('data-note-word');
        btn.addEventListener('click', function(ev){
          ev.stopPropagation();
          var noteDiv = btn.parentElement;
          var displayEl = noteDiv.querySelector('.fw-book-note-display');
          var editorEl = noteDiv.querySelector('.fw-book-note-editor');
          var ta = editorEl.querySelector('.fw-book-note-ta');
          var isEditing = btn.classList.contains('active');
          if (!isEditing) {
            // 展开编辑
            btn.classList.add('active');
            displayEl.style.display = 'none';
            editorEl.style.display = 'flex';
            var card = noteDiv.closest('.fw-book-card');
            if (card) {
              var data = bookParseBlocks(bookLastContent || '');
              for (var j = 0; j < data.length; j++) {
                if (data[j].word === word) {
                  ta.value = data[j].note || '';
                  break;
                }
              }
            }
            ta.focus();
          } else {
            // 收起编辑，恢复显示
            btn.classList.remove('active');
            displayEl.style.display = '';
            editorEl.style.display = 'none';
          }
        });
      })(editBtns[i]);
    }
    var saveBtns = bodyEl.querySelectorAll('.fw-book-note-save-btn');
    for (var i = 0; i < saveBtns.length; i++) {
      (function(btn){
        var word = btn.getAttribute('data-note-word');
        btn.addEventListener('click', function(ev){
          ev.stopPropagation();
          var noteDiv = btn.parentElement;
          var card = noteDiv.closest('.fw-book-card');
          var ta = noteDiv.querySelector('.fw-book-note-ta');
          var note = ta.value;
          var cfg = favGetConfig();
          favUpdateNoteFast(cfg, word, note).then(function(r){
            showToast('笔记已保存，云端共 ' + r.count + ' 个词', 2000);
            // 更新面板数据源并重渲染：让「我的收藏-笔记」展示区与卡片内联笔记保持同步
            if (r && r.text) bookLastContent = r.text;
            var body = bookPanelEl ? bookPanelEl.querySelector('.fw-book-body') : null;
            if (body) bookRefreshCards(body);
          }, function(e){
            showToast('保存失败：'+favErrText(e), 5000);
          });
        });
      })(saveBtns[i]);
    }
  }
  // 展开 / 收起卡片（word 传 null 表示全部；open 省略表示取反）
  function bookSetCardOpen(word, open) {
    if (!bookPanelEl) return 0;
    var body = bookPanelEl.querySelector('.fw-book-body');
    if (!body) return 0;
    var cards = body.querySelectorAll('.fw-book-card');
    var n = 0;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.getAttribute('data-book-expandable') !== '1') continue;
      var w = bookCardWordOf(card);
      if (word != null && w !== String(word)) continue;
      var willOpen = (open === undefined) ? !card.classList.contains('is-open') : !!open;
      bookSetCardState(card, willOpen);
      n++;
    }
    return n;
  }
  function bookExpandAll() { return bookSetCardOpen(null, true); }
  function bookCollapseAll() { bookOpenWords = {}; return bookSetCardOpen(null, false); }

  // 用最近一次远端原文重渲染卡片列表（保留已展开的成语）
  function bookRefreshCards(bodyEl) {
    if (!bodyEl || !bookLastContent) return;
    var blocks = bookParseBlocks(bookLastContent);
    if (!blocks.length) return;
    var html = '';
    for (var i = 0; i < blocks.length; i++) { html += bookRenderCard(blocks[i]); }
    bodyEl.innerHTML = html;
    bookBindUnfav(bodyEl);
    bookBindCards(bodyEl);
    var cards = bodyEl.querySelectorAll('.fw-book-card');
    for (var k = 0; k < cards.length; k++) {
      var w = bookCardWordOf(cards[k]);
      if (w && bookOpenWords[w]) bookSetCardState(cards[k], true);
    }
  }

  // 本地兜底超时：即使 GM_xmlhttpRequest 的 ontimeout 未触发，也能结束「正在加载」态
  var BOOK_LOAD_TIMEOUT_MS = 15000;

  function openBookPanel() {
    // 面板已打开时，再点「我的收藏」= 重新拉取一次（防止上次卡在加载态后再也出不来）
    if (bookPanelEl) {
      if (typeof bookPanelEl.__fwBookReload === 'function') bookPanelEl.__fwBookReload();
      return bookPanelEl;
    }
    if (!favIsConfigured()) { favPromptConfig(); return null; }
    var cfg = favGetConfig();
    var overlay = document.createElement('div');
    overlay.className = 'fw-book-overlay';
    overlay.innerHTML =
      '<div class="fw-book-panel" role="dialog" aria-modal="true">' +
        '<div class="fw-book-head"><h3>我的收藏 <span class="fw-book-count"></span></h3>' +
          '<div class="fw-book-tools">' +
            '<button type="button" class="fw-book-tool fw-book-export" title="导出 JSON（含统计信息，不含 WebDAV 密码）">导出 JSON</button>' +
            '<button type="button" class="fw-book-tool fw-book-import" title="导入 JSON（校验 → 合并预览 → 确认 → 并入本地暂存并同步）">导入 JSON</button>' +
            '<button type="button" class="fw-book-tool fw-book-sync" title="立即同步：读远端 → 并集合并 → 整体回写">立即同步</button>' +
            '<button type="button" class="fw-book-tool fw-book-pull" title="从远端拉取并合并到本机暂存">从远端拉取</button>' +
            '<button type="button" class="fw-book-tool fw-book-config" title="配置 WebDAV" aria-label="配置 WebDAV">WebDAV 设置</button>' +
            '<button type="button" class="fw-book-tool fw-book-note-edit" title="编辑笔记" aria-label="编辑笔记">编辑笔记</button>' +
            '<button type="button" class="fw-book-tool fw-book-close" title="关闭" aria-label="关闭">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div class="fw-book-cfgline"></div>' +
        '<div class="fw-book-body"></div>' +
        '<div class="fw-book-status"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    bookPanelEl = overlay;
    var closeBtn = overlay.querySelector('.fw-book-close');
    var bodyEl = overlay.querySelector('.fw-book-body');

    closeBtn.addEventListener('click', closeBookPanel);
    var configBtn = overlay.querySelector('.fw-book-config');
    var noteEditBtn = overlay.querySelector('.fw-book-note-edit');
    if (noteEditBtn) noteEditBtn.addEventListener('click', function() { openNoteEditorPanel(); });
    if (configBtn) configBtn.addEventListener('click', openFavWebdavPanel);
    var exportBtn = overlay.querySelector('.fw-book-export');
    if (exportBtn) exportBtn.addEventListener('click', exportJson);
    var importBtn = overlay.querySelector('.fw-book-import');
    if (importBtn) importBtn.addEventListener('click', importJson);
    var syncBtn = overlay.querySelector('.fw-book-sync');
    if (syncBtn) syncBtn.addEventListener('click', function () {
      if (!favIsConfigured()) { favPromptConfig(); return; }
      showToast('正在同步（读远端→并集合并→回写）…', 15000);
      favSyncPush('manual').then(function (r) {
        if (r && r.skipped) return;
        showToast('已同步到 WebDAV（' + r.count + ' 个词）', 3200);
        if (bookPanelEl && typeof bookPanelEl.__fwBookReload === 'function') bookPanelEl.__fwBookReload();
      }, function (e) { showToast('同步失败：' + favErrText(e), 6000); });
    });
    var pullBtn = overlay.querySelector('.fw-book-pull');
    if (pullBtn) pullBtn.addEventListener('click', function () {
      favSyncPull(false).then(function () {
        if (bookPanelEl && typeof bookPanelEl.__fwBookReload === 'function') bookPanelEl.__fwBookReload();
      }, function () { /* 失败已 toast */ });
    });
    // v3.16.0：WebDAV 配置状态行（地址 · 路径 · 最近请求；未配置则提示）
    var cfgLineEl = overlay.querySelector('.fw-book-cfgline');
    if (cfgLineEl) {
      var cNow = favGetConfig();
      cfgLineEl.textContent = favIsConfigured()
        ? ('WebDAV：' + cNow.url + ' · 路径 ' + cNow.filePath + (favReqBrief() ? ' · 最近请求 ' + favReqBrief() : ''))
        : 'WebDAV：未配置（点「WebDAV 设置」填写坚果云地址与账号）';
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeBookPanel();
    });
    document.addEventListener('keydown', onBookPanelKey, true);

    /* 失败 / 超时态统一出口：给出「重新加载」+「诊断信息」，绝不把面板留在「正在加载…」 */
    var noteHtml = '', noteWarn = false;   // 顶部提示（本机缓存 / 刷新失败原因），和卡片一起渲染，保证 .fw-book-retry 唯一
    var bindPanelButtons = function () {
      var rb = bodyEl.querySelector('.fw-book-retry');
      if (rb) rb.addEventListener('click', startLoading);
      var db = bodyEl.querySelector('.fw-book-diag');
      if (db) db.addEventListener('click', showDiag);
    };
    var showDiag = function () {
      var text = favDiagText();
      try { favLog('收藏诊断信息', '\n' + text); } catch (e) { /* ignore */ }
      bodyEl.innerHTML = String(bodyEl.innerHTML).replace(/<pre class="fw-book-diag-pre">[\s\S]*?<\/pre>/g, '') +
        '<pre class="fw-book-diag-pre">' + esc(text) + '</pre>';
      bindPanelButtons();
      showToast('诊断信息已显示在面板底部（同时输出到控制台）', 3000);
    };
    var drawBody = function (cardsHtml) {
      bodyEl.innerHTML = (noteHtml ? '<div class="fw-book-note' + (noteWarn ? ' is-warn' : '') + '">' + noteHtml + '</div>' : '') +
        (cardsHtml || '');
      bindPanelButtons();
    };
    var renderHint = function (title, lines) {
      noteHtml = ''; noteWarn = false;
      var html = '<div class="fw-book-empty"><p>' + esc(title) + '</p>';
      for (var i = 0; i < lines.length; i++) html += '<p>' + esc(lines[i]) + '</p>';
      html += '<p><button type="button" class="fw-book-retry">重新加载</button>' +
        '<button type="button" class="fw-book-diag">诊断信息</button></p></div>';
      bodyEl.innerHTML = html;
      bindPanelButtons();
    };

    /* 开始加载远端文件（v3.11.0：先用本机快照秒开，再向坚果云刷新） */
    var loadingGuard = null;
    var loadSeq = 0;                 // 每次加载一个序号，丢弃迟到 / 过期回调
    var startLoading = function () {
      var mySeq = ++loadSeq;
      if (loadingGuard) { clearTimeout(loadingGuard); loadingGuard = null; }
      var cfgNow = favGetConfig();     // v3.11.0：每次重新读配置——改过设置后无需关面板重开
      var cached = favSnapGet(cfgNow);
      var cacheHtml = '', cacheCount = 0;
      if (cached && cached.content) {
        try {
          var cb = bookParseBlocks(cached.content);
          for (var ci = 0; ci < cb.length; ci++) cacheHtml += bookRenderCard(cb[ci]);
          cacheCount = cb.length;
        } catch (e) { cacheHtml = ''; cacheCount = 0; }
      }
      noteHtml = ''; noteWarn = false;
      if (cacheHtml) {
        noteHtml = '显示的是本机缓存（上次同步 ' + esc(String(cached.at || '未知时间')) + '），正在向坚果云刷新…';
        var countEl0 = overlay.querySelector('.fw-book-count');
        if (countEl0) countEl0.textContent = '(' + cacheCount + ' 个词 · 点击卡片可展开全部字段)';
        drawBody(cacheHtml);
      } else {
        bodyEl.innerHTML = '<div class="fw-book-empty"><p>正在加载收藏数据…</p></div>';
      }
      loadingGuard = setTimeout(function () {
        loadingGuard = null;
        if (mySeq !== loadSeq) return;
        if (cacheHtml) {
          noteHtml = '坚果云在 ' + Math.round(BOOK_LOAD_TIMEOUT_MS / 1000) + ' 秒内没有响应（下面是本机缓存，可点「重新加载」再试）。' +
            '<button type="button" class="fw-book-retry">重新加载</button>' +
            '<button type="button" class="fw-book-diag">诊断信息</button>';
          noteWarn = true;
          drawBody(cacheHtml);
          return;
        }
        renderHint('收藏数据加载超时', ['坚果云在 ' + Math.round(BOOK_LOAD_TIMEOUT_MS / 1000) + ' 秒内没有响应，可能是网络不通或被代理拦截。']);
      }, BOOK_LOAD_TIMEOUT_MS);

      var done = function (draw) {
        if (mySeq !== loadSeq) return;              // 过期回调：直接丢弃
        if (loadingGuard) { clearTimeout(loadingGuard); loadingGuard = null; }
        try { draw(); }
        catch (err) {
          if (cacheHtml) {
            noteHtml = '渲染出错：' + esc(favErrText(err)) + '（下面是本机缓存）';
            noteWarn = true;
            drawBody(cacheHtml);
          } else {
            renderHint('收藏数据渲染出错', [String(favErrText(err))]);
          }
        }
      };

      favGetFile(cfgNow).then(function (file) {
        done(function () {
          var countEl = overlay.querySelector('.fw-book-count');
          if (!file.exists || !file.content) {
            bookLastContent = '';
            if (countEl) countEl.textContent = '';
            renderHint('收藏数据暂不可用', [
              '坚果云上没有找到收藏文件（HTTP ' + (file.status || 404) + '）：可能还没有成功收藏过，或保存路径不对。',
              '当前保存路径：' + cfgNow.filePath,
              '最近一次请求：' + (favReqBrief() || '无')
            ]);
            return;
          }
          var blocks = bookParseBlocks(file.content);
          bookLastContent = file.content;
          noteHtml = ''; noteWarn = false;
          if (!blocks.length) {
            if (countEl) countEl.textContent = '';
            renderHint('还没有收藏过任何词', [
              '把鼠标移到成语 / 词语上，点「收藏」即可添加到这里。',
              '最近一次请求：' + (favReqBrief() || '无')
            ]);
            return;
          }
          if (countEl) countEl.textContent = '(' + blocks.length + ' 个词 · 点击卡片可展开全部字段)';
          var html = '';
          for (var i = 0; i < blocks.length; i++) {
            html += bookRenderCard(blocks[i]);
          }
          drawBody(html);
          bookBindUnfav(bodyEl);   // 绑定取消收藏按钮
          bookBindCards(bodyEl);   // 绑定「点击卡片展开 / 收起」
          favLog('收藏面板已加载', blocks.length + ' 个词条 · 最近一次请求 ' + (favReqBrief() || '无'));
        });
      }, function (e) {
        done(function () {
          var brief = favReqBrief();
          if (cacheHtml) {
            noteHtml = '云端刷新失败：' + esc(favErrText(e)) + (brief ? '（最近一次请求 ' + esc(brief) + '）' : '') +
              ' —— 下面是本机缓存。<button type="button" class="fw-book-retry">重新加载</button>' +
              '<button type="button" class="fw-book-diag">诊断信息</button>';
            noteWarn = true;
            drawBody(cacheHtml);
            bookBindUnfav(bodyEl);
            bookBindCards(bodyEl);
            return;
          }
          renderHint('收藏数据暂不可用', [
            '网络错误：' + favErrText(e),
            '最近一次请求：' + (brief || '无'),
            '排查顺序：① 点「诊断信息」看状态码与耗时；② 401/403 = 账号或应用密码不对；③ 404/405 = 保存路径不可写；④ 超时 = 网络或代理拦截了 dav.jianguoyun.com。'
          ]);
        });
      });
    };
    overlay.__fwBookReload = startLoading;

    startLoading();
    return overlay;
  }

  /* Esc 关闭面板：用同一个函数引用注册 / 注销，避免反复开关面板累积监听器 */
  function onBookPanelKey(e) {
    if (e && e.key === 'Escape') closeBookPanel();
  }

  function closeBookPanel() {
    if (!bookPanelEl) return;
    var el = bookPanelEl;
    bookPanelEl = null;
    try { if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); } catch (e) { /* ignore */ }
    document.removeEventListener('keydown', onBookPanelKey, true);
  }

  /* ——— 收藏 / 取消收藏的统一入口（悬浮窗左侧栏按钮、中键固定栏按钮都走这里） ——— */
  function favToggle(word, data, btn) {
    var w = String(word == null ? '' : word).trim();
    if (!w) { showToast('没取到要收藏的词：把鼠标移到成语 / 词语上再点「收藏」', 3200); return; }
    if (!CONFIG.favEnabled) { showToast('一键收藏未启用（CONFIG.favEnabled = false）', 3000); return; }
    if (!favIsConfigured()) { favPromptConfig(); return; }
    var d = data || favDataFor(w);
    if (!d || d.source === 'loading') { showToast('「' + w + '」的释义还在查询中，稍等一下再点「收藏」', 3200); return; }
    if (d.source === 'none' || (!d.explanation && !d.usage && !d.derivation && !d.example)) {
      showToast('暂不可收藏：还没取到「' + w + '」的释义（词库未收录 / 在线查询未返回内容）', 3600); return;
    }
    if (favIsFavorited(w)) {
      favRunRemove(w, btn);
    } else {
      favShowNoteEditor(w, d, 'append');
    }
  }
  /* v3.17.0: 笔记编辑面板 */
  function favShowNoteEditor(word, data, mode, existingCard) {
    var host = document.body || document.documentElement;
    if (!host || !host.appendChild) { favWarn('笔记面板打不开'); return; }
    var overlay = document.createElement('div');
    overlay.className = 'fw-wd-overlay';
    overlay.innerHTML =
      '<div class="fw-wd-note-panel" role="dialog" aria-modal="true">' +
        '<div class="fw-wd-note-head"><h3>' + esc(word) + '</h3>' +
          '<button type="button" class="fw-wd-close" title="关闭" aria-label="关闭">&times;</button></div>' +
        '<div class="fw-wd-note-body">' +
          '<textarea class="fw-wd-note-textarea" placeholder="' + esc(CONFIG.favNotePlaceholder) + '" rows="6"></textarea>' +
        '</div>' +
        '<div class="fw-wd-note-actions">' +
          '<button type="button" class="fw-wd-btn" id="fw-note-cancel">' + (mode==='edit'?'取消编辑':'取消') + '</button>' +
          '<button type="button" class="fw-wd-btn fw-wd-primary" id="fw-note-save">' + (mode==='edit'?'保存笔记':'保存笔记并收藏') + '</button>' +
        '</div>' +
      '</div>';
    host.appendChild(overlay);
    var ta = overlay.querySelector('.fw-wd-note-textarea');
    overlay.querySelector('.fw-wd-close').addEventListener('click', function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay);});
    overlay.querySelector('#fw-note-cancel').addEventListener('click', function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay);});
    overlay.querySelector('#fw-note-save').addEventListener('click', function(){
      var note = ta.value;
      if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if(mode==='edit'){ favWriteNoteToCard(word,note); }
      else { var card=favBuildCard(word,data); card.entry.note=note; favRunAppendWithNote(word,card,note); }
    });
  }
  function favWriteNoteToCard(word, note) {
    var cfg = favGetConfig();
    favUpdateNoteFast(cfg, word, note).then(function(r){
      showToast('笔记已保存至「' + word + '」，云端共 ' + r.count + ' 个词',3200);
      // 同步刷新收藏面板数据源，让「我的收藏-笔记」展示区保持一致
      if (r && r.text) bookLastContent = r.text;
      var body = bookPanelEl ? bookPanelEl.querySelector('.fw-book-body') : null;
      if (body) bookRefreshCards(body);
    }, function(e){ showToast('笔记保存失败：'+favErrText(e),5000); });
  }
  function favRunAppendWithNote(word, card, note) {
    var cfg = favGetConfig();
    card.entry.note = note;
    favMarkLocal(word); favRefreshButtons(word);
    showToast('已收藏「' + word + '」，正在同步到坚果云…', 2500);
    favLog('开始收藏（含笔记）', word + ' -> ' + cfg.filePath);
    favAppendFast(cfg, card).then(function(r){
      if(r.duplicated) showToast('「' + word + '」已在收藏中，未重复写入',3200);
      else showToast('已收藏「' + word + '」，云端共 ' + r.count + ' 个词',3200);
      try{ favLocalAppendEntry(card.entry); } catch(e){ favWarn('本地暂存写入失败', favErrText(e)); }
    }, function(e){
      favUnmarkLocal(word); favRefreshButtons(word);
      showToast('收藏失败（已撤销本机标记）：'+favErrText(e),7000,'去配置',openFavWebdavPanel);
    });
  }
  function favRunAppend(word, data, btn) {
    var cfg = favGetConfig();
    var card;
    try { card = favBuildCard(word, data); } catch (e) { showToast('收藏失败：' + favErrText(e), 4000); return; }
    // v3.11.0：先本地落地 + 按钮即时反馈，再后台同步——点下去立刻有响应，不再干等网络往返
    favMarkLocal(word);
    favRefreshButtons(word);
    if (btn) favApplyBtnState(btn, word, true);
    showToast('已收藏「' + word + '」，正在同步到坚果云…', 2500);
    favLog('开始收藏', word + ' → ' + cfg.filePath + '（本机快照=' + (favSnapGet(cfg) ? '有，走直写' : '无，走完整读写') + '）');
    favAppendFast(cfg, card).then(function (r) {
      if (r.duplicated) showToast('「' + word + '」已在收藏中（远端文件里已存在，未重复写入）', 3200);
      else showToast('已收藏「' + word + '」' + (r.created ? '（已创建收藏文件）' : '') + '，云端共 ' + r.count + ' 个词' +
        (r.ms ? '，本次写入 ' + (r.ms / 1000).toFixed(1) + 's' : ''), 3200);
      try { favLocalAppendEntry(card.entry); } catch (e2) { favWarn('本地暂存写入失败', favErrText(e2)); }   // v3.16.0：收藏成功后并入本地暂存并落盘
      favLog('收藏完成', r);
    }, function (e) {
      // 同步失败：回滚本机标记与按钮，避免出现「显示已收藏、云端却没有」的假象
      favUnmarkLocal(word);
      favRefreshButtons(word);
      if (btn) favApplyBtnState(btn, word, false);
      favWarn('收藏失败（已回滚本机标记）', favErrText(e));
      showToast('收藏失败（已撤销本机标记）：' + favErrText(e), 7000, '去配置', openFavWebdavPanel);
    });
  }
  function favRunRemove(word, btn) {
    var cfg = favGetConfig();
    // v3.11.0：同样先本地即时反馈，再后台同步
    favUnmarkLocal(word);
    favRefreshButtons(word);
    if (btn) favApplyBtnState(btn, word, false);
    showToast('已取消收藏「' + word + '」，正在同步到坚果云…', 2500);
    favLog('开始取消收藏', word + ' → ' + cfg.filePath + '（本机快照=' + (favSnapGet(cfg) ? '有，走直写' : '无，走完整读写') + '）');
    favRemoveFast(cfg, word).then(function (r) {
      if (r.noFile) showToast('远端收藏文件还不存在，已取消「' + word + '」的本机收藏标记', 3200);
      else if (!r.removed) showToast('远端收藏文件里没有「' + word + '」这个词条，本机标记已清掉', 3200);
      else showToast('已取消收藏「' + word + '」，云端剩 ' + r.count + ' 个词', 3200);
      try { favLocalTombstone(word); } catch (e2) { favWarn('本地暂存墓碑写入失败', favErrText(e2)); }   // v3.16.0：取消收藏后记删除墓碑并落盘
      favLog('取消收藏完成', r);
    }, function (e) {
      favMarkLocal(word);
      favRefreshButtons(word);
      if (btn) favApplyBtnState(btn, word, true);
      favWarn('取消收藏失败（已恢复本机标记）', favErrText(e));
      showToast('取消收藏失败（本机标记已恢复）：' + favErrText(e), 7000, '去配置', openFavWebdavPanel);
    });
  }

  /* ---------------- WebDAV 配置面板（油猴菜单 / 控制台 / 未配置引导 三处入口） ---------------- */
  function closeFavWebdavPanel() {
    if (!favPanelEl) return;
    var el = favPanelEl;
    favPanelEl = null;
    try { if (el.__fwKeydown && document.removeEventListener) document.removeEventListener('keydown', el.__fwKeydown, true); } catch (e) { /* ignore */ }
    try { if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); } catch (e) { /* ignore */ }
  }
  function openFavWebdavPanel() {
    if (favPanelEl) return favPanelEl;              // 已经开着：聚焦即可
    var host = document.body || document.documentElement;
    if (!host || !host.appendChild) { favWarn('配置面板打不开：页面尚未就绪'); return null; }
    var cfg = favGetConfig();
    var overlay = document.createElement('div');
    overlay.className = 'fw-wd-overlay';
    overlay.innerHTML =
      '<div class="fw-wd-panel" role="dialog" aria-modal="true">' +
        '<div class="fw-wd-head"><h3>WebDAV 收藏设置（坚果云）</h3>' +
          '<button type="button" class="fw-wd-close" title="关闭" aria-label="关闭">&times;</button></div>' +
        '<div class="fw-wd-body">' +
          '<div class="fw-wd-field"><label>服务器地址</label>' +
            '<input class="fw-wd-input fw-wd-url" type="text" spellcheck="false" autocomplete="off" placeholder="https://dav.jianguoyun.com/dav/">' +
            '<div class="fw-wd-tip">坚果云固定填 https://dav.jianguoyun.com/dav/（到 WebDAV 根路径这一级即可，末尾带不带「/」都行）。</div></div>' +
          '<div class="fw-wd-field"><label>账号</label>' +
            '<input class="fw-wd-input fw-wd-user" type="text" spellcheck="false" autocomplete="off" placeholder="坚果云注册邮箱">' +
            '<div class="fw-wd-tip">坚果云的账号是「注册邮箱」（不是昵称 / 手机号）。</div></div>' +
          '<div class="fw-wd-field"><label>密码</label>' +
            '<input class="fw-wd-input fw-wd-pass" type="password" autocomplete="off" placeholder="应用密码">' +
            '<div class="fw-wd-tip">必须用「应用密码」：坚果云网页端 → 账户信息 → 安全选项 → 添加应用，生成后粘贴到此处；直接填登录密码会报 HTTP 401。</div></div>' +
          '<div class="fw-wd-field"><label>保存路径（相对 WebDAV 根目录）</label>' +
            '<input class="fw-wd-input fw-wd-path" type="text" spellcheck="false" autocomplete="off" placeholder="' + FAV_FILE_DEFAULT + '">' +
            '<div class="fw-wd-tip">可留空（默认 ' + FAV_FILE_DEFAULT + '）。只填裸文件名时会自动补上前缀「' + FAV_JGY_ROOT + '/」——坚果云 dav/ 是虚拟服务根、根目录不可写。</div></div>' +
          '<div class="fw-wd-actions">' +
            '<button type="button" class="fw-wd-btn fw-wd-jgy fw-wd-primary">一键导入坚果云地址</button>' +
            '<button type="button" class="fw-wd-btn fw-wd-save fw-wd-primary">保存并同步</button>' +
            '<button type="button" class="fw-wd-btn fw-wd-test">连接测试</button>' +
            '<button type="button" class="fw-wd-btn fw-wd-pull">从远端拉取</button>' +
            '<button type="button" class="fw-wd-btn fw-wd-diag">诊断信息</button>' +
            '<button type="button" class="fw-wd-btn fw-wd-clear">清空配置</button>' +
          '</div>' +
          '<div class="fw-wd-result"></div>' +
          '<div class="fw-wd-note-config">' +
            '<div class="fw-wd-field"><label><input type="checkbox" class="fw-wd-note-enabled"> 启用收藏笔记功能</label></div>' +
            '<div class="fw-wd-field"><label>笔记占位提示</label>' +
              '<input class="fw-wd-input fw-wd-note-placeholder" type="text" spellcheck="false" autocomplete="off" placeholder="笔记占位提示文本">' +
              '<div class="fw-wd-tip">收藏时笔记输入框的占位文本，可留空使用默认值。</div></div>' +
          '</div>' +
          '<div class="fw-wd-help">' +
            '<div><b>坚果云要点</b>① 地址固定 https://dav.jianguoyun.com/dav/；② 账号填注册邮箱；③ 密码必须用「应用密码」（填登录密码会 401）。</div>' +
            '<div><b>连接失败怎么查</b>401 / 403 → 账号或应用密码不对；404 / 405 → 地址或保存路径不对（根目录不可写）；409 → 上级目录不存在（脚本会自动尝试创建）；412 / 428 → 远端文件正被其它端改写，稍后重试。</div>' +
            '<div><b>隐私提示</b>地址 / 账号 / 密码只保存在本机（油猴存储或浏览器 localStorage，密码为明文），仅发送给你填写的 WebDAV 服务器；公用电脑请谨慎保存。</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    host.appendChild(overlay);

    var urlEl = overlay.querySelector('.fw-wd-url');
    var userEl = overlay.querySelector('.fw-wd-user');
    var passEl = overlay.querySelector('.fw-wd-pass');
    var pathEl = overlay.querySelector('.fw-wd-path');
    var resultEl = overlay.querySelector('.fw-wd-result');
    var saveBtn = overlay.querySelector('.fw-wd-save');
    var testBtn = overlay.querySelector('.fw-wd-test');
    var pullBtn = overlay.querySelector('.fw-wd-pull');
    var diagBtn = overlay.querySelector('.fw-wd-diag');
    var jgyBtn = overlay.querySelector('.fw-wd-jgy');
    var clearBtn = overlay.querySelector('.fw-wd-clear');
    var closeBtn = overlay.querySelector('.fw-wd-close');
    var noteEnabledCb = overlay.querySelector('.fw-wd-note-enabled');
    var notePlaceholderInput = overlay.querySelector('.fw-wd-note-placeholder');
    if (noteEnabledCb) {
      noteEnabledCb.checked = CONFIG.favNoteEnabled;
      noteEnabledCb.addEventListener('change', function(){
        CONFIG.favNoteEnabled = this.checked;
        showToast('笔记功能已' + (this.checked?'启用':'关闭'),1500);
      });
    }
    if (notePlaceholderInput) {
      notePlaceholderInput.value = CONFIG.favNotePlaceholder || '';
      notePlaceholderInput.addEventListener('change', function(){
        CONFIG.favNotePlaceholder = this.value || '';
        showToast('笔记占位提示已更新',1500);
      });
    }
    if (!urlEl || !userEl || !passEl || !pathEl || !resultEl || !saveBtn || !testBtn || !pullBtn || !diagBtn || !jgyBtn || !clearBtn || !closeBtn) {
      favWarn('配置面板结构异常，已放弃打开');
      try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) { /* ignore */ }
      return null;
    }
    urlEl.value = cfg.url || '';
    userEl.value = cfg.username || '';
    passEl.value = cfg.password || '';
    pathEl.value = cfg.filePath || FAV_FILE_DEFAULT;

    var readForm = function () {
      return { url: urlEl.value, username: userEl.value, password: passEl.value, filePath: pathEl.value };
    };
    var showResult = function (html, kind) {
      resultEl.className = 'fw-wd-result is-show is-' + (kind || 'warn');
      resultEl.innerHTML = html;
    };

    closeBtn.addEventListener('click', closeFavWebdavPanel);
    saveBtn.addEventListener('click', function () {
      var ok = favSaveConfig(readForm());
      var saved = favGetConfig();
      if (!saved.url || !saved.username) { showResult('请至少填写「服务器地址」与「账号」，再保存。', 'err'); return; }
      showResult(ok ? '配置已保存，正在同步（读远端→并集合并→回写）…' : '配置已在本次会话生效，但写入本机存储失败（隐私模式 / 存储被禁用）。', ok ? 'ok' : 'warn');
      favSyncPush('manual').then(function (r) {
        if (r && r.skipped) return;
        showResult('同步完成：云端 ' + r.count + ' 个词' + (r.created ? '（远端收藏文件已新建）' : '') + '。<br>地址 ' + esc(saved.url) + ' · 路径 ' + esc(saved.filePath), 'ok');
      }, function (e) {
        showResult('同步失败：' + esc(favErrText(e)), 'err');
      });
    });
    testBtn.addEventListener('click', function () {
      var testCfg = favNormalizeConfig(readForm());
      if (!testCfg.url || !testCfg.username) { showResult('请先填写「服务器地址」与「账号」，再测试连接。', 'err'); return; }
      favSaveConfig(testCfg);   // 顺手保存，避免测完还要再点一次「保存」
      var oldText = testBtn.textContent;
      testBtn.disabled = true;
      testBtn.textContent = '测试中…';
      showResult('正在连接 ' + esc(testCfg.url) + ' …', 'warn');
      favTestConnection(testCfg).then(function (r) {
        showResult('连接成功：HTTP ' + r.status + '，通道 ' + esc(r.via) + (r.dav ? '，DAV: ' + esc(r.dav) : '') + '。<br>' +
          '目标文件 ' + esc(r.filePath) + '：' + (r.fileExists
            ? ('已存在，其中词条 ' + r.blockCount + ' 个')
            : '不存在（首次收藏时会自动创建）'), 'ok');
      }, function (e) {
        favWarn('WebDAV 连接测试失败', favErrText(e));
        showResult('连接失败：' + esc(favErrText(e)) +
          (favErrCode(e) ? '<br>排查建议：' + esc(favStatusHint(favErrCode(e), testCfg)) : ''), 'err');
      }).then(function () {
        testBtn.disabled = false;
        testBtn.textContent = oldText;
      });
    });
    jgyBtn.addEventListener('click', function () {
      urlEl.value = 'https://dav.jianguoyun.com/dav/';
      showResult('已填入坚果云 WebDAV 地址（https://dav.jianguoyun.com/dav/）。<br>下一步：账号填「注册邮箱」，密码填「应用密码」——坚果云网页端 → 账户信息 → 安全选项 → 添加应用，生成后粘贴到密码框（填登录密码会 401）。', 'ok');
    });
    pullBtn.addEventListener('click', function () {
      var pullCfg = favNormalizeConfig(readForm());
      if (!pullCfg.url || !pullCfg.username) { showResult('请先填写「服务器地址」与「账号」，再拉取。', 'err'); return; }
      favSaveConfig(pullCfg);
      var oldText = pullBtn.textContent;
      pullBtn.disabled = true;
      pullBtn.textContent = '拉取中…';
      showResult('正在从远端拉取并合并到本地暂存…', 'warn');
      favSyncPull(true).then(function (r) {
        showResult('拉取完成：本地暂存现共 ' + r.count + ' 个词（含本次新增 ' + r.added + ' 个）。', 'ok');
      }, function (e) {
        showResult('拉取失败：' + esc(favErrText(e)), 'err');
      }).then(function () {
        pullBtn.disabled = false;
        pullBtn.textContent = oldText;
      });
    });
    diagBtn.addEventListener('click', function () {
      var text = favDiagText();
      try { favLog('收藏诊断信息', '\n' + text); } catch (e) { /* ignore */ }
      showResult('<pre style="white-space:pre-wrap;margin:0;">' + esc(text) + '</pre>', 'warn');
    });
    clearBtn.addEventListener('click', function () {
      var yes = true;
      try {
        if (typeof window.confirm === 'function') yes = window.confirm('确认清空本机保存的 WebDAV 配置？\n（远端文件里已收藏的词不受影响）');
      } catch (e) { yes = true; }
      if (!yes) return;
      favClearConfig();
      urlEl.value = '';
      userEl.value = '';
      passEl.value = '';
      pathEl.value = FAV_FILE_DEFAULT;
      showResult('已清空本机保存的 WebDAV 配置（远端已收藏的文件不受影响）。', 'warn');
    });
    var onKey = function (e) {
      if (e.key !== 'Escape') return;
      try { e.stopPropagation(); } catch (err) { /* ignore */ }
      closeFavWebdavPanel();
    };
    overlay.__fwKeydown = onKey;
    try { if (document.addEventListener) document.addEventListener('keydown', onKey, true); } catch (e) { /* ignore */ }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFavWebdavPanel(); });
    try { urlEl.focus(); } catch (e) { /* 聚焦失败无碍 */ }
    favPanelEl = overlay;
    favLog('已打开 WebDAV 收藏设置面板', favIsConfigured() ? '当前状态：已配置' : '当前状态：未配置');
    return overlay;
  }


  /* =====================================================
   * v3.16.0 本地浏览器暂存 + 整体同步 + 导入导出（对齐错题本脚本）
   *   1) 本地暂存：新增存储键 FAV_LOCAL_KEY，持久化整份 JSON 文档（words + deleted 墓碑）；
   *      启动加载、每次收藏 / 取消收藏 / 导入后落盘，离线也能保留收藏。
   *   2) 整体同步：favSyncPush（读远端→双向并集合并→整体回写，ETag 乐观锁 + 412 重试）、
   *      favSyncPull（远端并入本地暂存并落盘）、favScheduleUpload（合并式串行调度）。
   *   3) 导入导出：exportJson / validateDoc / buildImportPreview / confirmImportDoc /
   *      doImportDoc / importJson；导出附带统计信息、不含 WebDAV 密码。
   * ===================================================== */

  /* ---------- 本地暂存 ---------- */
  function favEmptyLocal() {
    return favBuildDoc(null);
  }
  function favLoadLocal() {
    var d = null;
    try { d = JSON.parse(favStoreGet(FAV_LOCAL_KEY, 'null')); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = null;
    if (d && !Array.isArray(d.words)) d = null;          // 旧版若把 .md 文本塞进暂存键：丢弃回空文档
    favLocalDoc = d || favEmptyLocal();
    if (!favLocalDoc.deleted || typeof favLocalDoc.deleted !== 'object' || Array.isArray(favLocalDoc.deleted)) favLocalDoc.deleted = {};
    favPersistLocal();
    favLog('本地暂存已加载', favCountWords(favLocalDoc) + ' 个词 / ' + Object.keys(favLocalDoc.deleted).length + ' 条墓碑');
    return favLocalDoc;
  }
  function favPersistLocal() {
    var ok = false;
    try { ok = favStoreSet(FAV_LOCAL_KEY, JSON.stringify(favBuildDoc(favLocalDoc))); } catch (e) { ok = false; }
    return ok;
  }
  // 把一份文档并入本地暂存（并集合并 + 落盘）；返回 favMergeDocs 的 { doc, added }
  function favLocalMergeDoc(doc) {
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.words)) doc = favEmptyDoc();
    var res = favMergeDocs(doc, favLocalDoc);
    favLocalDoc = res.doc;
    favPersistLocal();
    return res;
  }
  // 收藏成功后并入本地暂存（快路径 / 安全路径通用）
  function favLocalAppendEntry(entry) {
    if (!entry || typeof entry !== 'object' || !favNormalizeWord(entry.word)) return { added: 0 };
    var patch = favEmptyDoc();
    patch.words = [entry];
    var res = favMergeDocs(patch, favLocalDoc);
    favLocalDoc = res.doc;
    favPersistLocal();
    return res;
  }
  // 取消收藏成功后写入删除墓碑（时间只增不减，防远端拉回后复活）
  function favLocalTombstone(word) {
    var res = favTombstoneEntry(favSerializeDoc(favLocalDoc), word);
    favLocalDoc = res.doc;
    favPersistLocal();
    return res;
  }

  /* ---------- 整体同步（对齐错题本 davPush / davPull / scheduleUpload） ---------- */
  function favPutError(status, base) {
    if (status === 401 || status === 403) return new Error('WebDAV 认证失败（HTTP ' + status + '），请检查账号和密码（坚果云须用「应用密码」）');
    if (status === 404 || status === 405) return new Error('保存路径不可写（HTTP ' + status + '）：' + base + '，请检查「保存路径」是否包含可写目录');
    return new Error(base + '（HTTP ' + status + '）');
  }
  // 读远端 → 双向并集合并（含本地暂存与墓碑）→ 整体回写。ETag 乐观锁，412/428 冲突重读重试。
  function favSyncPush(trigger) {
    if (!favIsConfigured()) { favPromptConfig(); return Promise.reject(new Error('未配置 WebDAV')); }
    if (favSyncBusy) { favSyncPending = true; return Promise.resolve({ skipped: true, reason: 'busy' }); }
    favSyncBusy = true;
    var cfg = favGetConfig();
    favLog('开始同步', (trigger || 'auto') + ' → ' + cfg.filePath + '（本地暂存 ' + favCountWords(favLocalDoc) + ' 词 / ' + Object.keys(favLocalDoc.deleted).length + ' 墓碑）');
    var attempt = function (n) {
      return favGetFile(cfg).then(function (file) {
        var remoteDoc = file.exists ? (favParseDoc(file.content) || favEmptyDoc()) : favEmptyDoc();
        var merged = favMergeDocs(remoteDoc, favLocalDoc);   // 远端 ⊕ 本地（双向并集，墓碑防复活）
        var count = favCountWords(merged.doc);
        if (!file.exists) {
          // 远端尚不存在：确保目录后新建（If-None-Match:*）
          return favEnsureDirs(cfg).then(function () {
            return favPutFile(cfg, favSerializeDoc(merged.doc), { create: true });
          }).then(function (res) {
            if (res.status >= 200 && res.status < 300) { finishPush(cfg, merged, true, res); return { count: count, created: true, via: (res.via || '') }; }
            if (res.status === 412) throw new Error('创建冲突（HTTP 412）：远端文件刚刚被其它端创建，请稍后重试');
            throw favPutError(res.status, '写入远端文件失败');
          });
        }
        var put = (file.etag
          ? favPutFile(cfg, favSerializeDoc(merged.doc), { etag: file.etag })
          : favPutFile(cfg, favSerializeDoc(merged.doc), {}));   // 无 ETag：退化为最后写入者胜
        return put.then(function (res) {
          if (res.status >= 200 && res.status < 300) { finishPush(cfg, merged, false, res); return { count: count, created: false, via: (res.via || '') + (file.etag ? '' : '（无ETag）') }; }
          if (res.status === 412 || res.status === 428) {
            if (n < FAV_MAX_RETRY) { favWarn('同步冲突（HTTP ' + res.status + '），重读重试', (n + 1) + '/' + FAV_MAX_RETRY); return attempt(n + 1); }
            throw new Error('同步冲突（HTTP ' + res.status + '）：远端文件被其它端改写，重试 ' + FAV_MAX_RETRY + ' 次仍冲突，请稍后再试');
          }
          throw favPutError(res.status, '写入远端文件失败');
        });
      });
    };
    var finishPush = function (cfg, merged, created, res) {
      favLocalDoc = merged.doc;
      favPersistLocal();
      favSnapSave(cfg, favSerializeDoc(merged.doc), favExtractEtag(res.headers) || null);
      favLog('同步完成', (created ? '新建远端文件，' : '') + '云端 ' + favCountWords(merged.doc) + ' 个词 · 墓碑 ' + Object.keys(merged.doc.deleted).length + ' 条 · ' + (res.ms || 0) + 'ms');
    };
    return attempt(0).then(function (r) {
      favSyncBusy = false;
      if (favSyncPending) { favSyncPending = false; favScheduleUpload(); }
      return r;
    }, function (e) {
      favSyncBusy = false;
      throw e;
    });
  }
  // 从远端拉取：读取远端文档并入本地暂存（不动远端）；之后普通收藏会走快路径并集合并。
  function favSyncPull(silent) {
    if (!favIsConfigured()) { if (!silent) favPromptConfig(); return Promise.reject(new Error('未配置 WebDAV')); }
    var cfg = favGetConfig();
    favLog('开始拉取', cfg.filePath);
    return favGetFile(cfg).then(function (file) {
      if (!file.exists) {
        if (!silent) showToast('远端还没有收藏文件（HTTP ' + (file.status || 404) + '），没有可拉取的内容', 4000);
        return { count: favCountWords(favLocalDoc), added: 0 };
      }
      var remoteDoc = favParseDoc(file.content);
      if (!remoteDoc) throw new Error('远端文件不是有效的 JSON 收藏文档（可能是旧版 Markdown，请先备份后手动转换或删除重建）');
      var merged = favMergeDocs(remoteDoc, favLocalDoc);
      favLocalDoc = merged.doc;
      favPersistLocal();
      favLog('拉取完成', '本地暂存现为 ' + favCountWords(favLocalDoc) + ' 词 / ' + Object.keys(favLocalDoc.deleted).length + ' 墓碑');
      if (!silent) showToast('已从远端拉取并合并：本地暂存现共 ' + favCountWords(favLocalDoc) + ' 个词', 4000);
      return { count: favCountWords(favLocalDoc), added: merged.added };
    });
  }
  // 合并式串行调度：已在上传中则标记待续，等当前完成后自动再跑一轮（本地暂存已在每次操作后落盘，不会丢）
  function favScheduleUpload() {
    if (!favIsConfigured()) return Promise.resolve({ skipped: true });
    if (favSyncBusy) { favSyncPending = true; return Promise.resolve({ skipped: true, reason: 'busy' }); }
    return favSyncPush('auto');
  }

  /* ---------- 导入导出（对齐错题本 exportJson / validateDoc / buildImportPreview / confirmImportDoc / doImportDoc / importJson） ---------- */
  function favStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function exportJson() {
    var content;
    try {
      var doc = favBuildDoc(favLocalDoc);
      var stat = {
        app: 'fenbi-word-hover',
        words: doc.words.length,
        deleted: Object.keys(doc.deleted).length,
        exportedAt: new Date().toISOString(),
        note: '本文件不含 WebDAV 密码等敏感配置'
      };
      content = JSON.stringify(Object.assign({}, doc, { stat: stat }), null, 2);
    } catch (e) { showToast('导出失败：' + favErrText(e), 4000); return; }
    var filename = 'fenbi-word-favorites-' + favStamp() + '.json';
    var usedGm = false;
    try {
      if (typeof GM_download === 'function') {   // 油猴环境优先：保存对话框
        var blob = new Blob([content], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        GM_download({ url: url, name: filename, saveAs: true });
        usedGm = true;
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 30000);
      }
    } catch (e) { usedGm = false; }
    if (usedGm) return;
    try {   // 普通浏览器：<a download> 触发下载
      var blob2 = new Blob([content], { type: 'application/json' });
      var url2 = URL.createObjectURL(blob2);
      var a = document.createElement('a');
      a.href = url2;
      a.download = filename;
      a.click();
      setTimeout(function () { try { URL.revokeObjectURL(url2); } catch (e) {} }, 30000);
    } catch (e) {
      favWarn('导出失败', favErrText(e));
      showToast('导出失败：' + favErrText(e), 4000);
    }
  }
  // 结构校验：必须含 words 数组（deleted 缺失可自动补空）；词条须有合法 word，非法条目丢弃计数
  function validateDoc(doc) {
    var errs = [];
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, errs: ['不是有效的 JSON 对象'] };
    if (!Array.isArray(doc.words)) errs.push('缺少 words 数组');
    if (!doc.deleted || typeof doc.deleted !== 'object' || Array.isArray(doc.deleted)) errs.push('缺少 deleted 对象（将自动补空）');
    var bad = 0, wc = 0;
    if (Array.isArray(doc.words)) {
      for (var i = 0; i < doc.words.length; i++) {
        var it = doc.words[i];
        if (!it || typeof it !== 'object' || !favNormalizeWord(it.word)) bad++;
        else wc++;
      }
    }
    if (bad) errs.push(bad + ' 个词条缺少 word 字段，将被忽略');
    return { ok: errs.length === 0, errs: errs, wordCount: wc };
  }
  // 合并影响预览：以本地暂存为基线，统计 新增 / 更新 / 保留 / 新增墓碑 / 合并后总数
  function buildImportPreview(doc) {
    var src = (doc && typeof doc === 'object') ? doc : favEmptyDoc();
    var ldel = (favLocalDoc.deleted && typeof favLocalDoc.deleted === 'object') ? favLocalDoc.deleted : {};
    var rdel = (src.deleted && typeof src.deleted === 'object') ? src.deleted : {};
    var del = {};
    Object.keys(ldel).forEach(function (w) { del[w] = ldel[w]; });
    Object.keys(rdel).forEach(function (w) {
      var t = Number(rdel[w]) || 0;
      if (!(del[w] >= t)) del[w] = t;
    });
    var map = new Map();
    (Array.isArray(favLocalDoc.words) ? favLocalDoc.words : []).forEach(function (it) {
      if (it && typeof it === 'object' && favNormalizeWord(it.word)) map.set(favNormalizeWord(it.word), it);
    });
    var addN = 0, updN = 0, keepN = 0;
    (Array.isArray(src.words) ? src.words : []).forEach(function (ri) {
      if (!ri || typeof ri !== 'object') return;
      var w = favNormalizeWord(ri.word);
      if (!w) return;
      var li = map.get(w);
      if (!li) { map.set(w, ri); addN++; }
      else if ((ri.updatedTime || 0) > (li.updatedTime || 0)) { map.set(w, ri); updN++; }
      else keepN++;
    });
    var mergedWords = [];
    map.forEach(function (it) {
      var w = favNormalizeWord(it.word);
      if (del[w] !== undefined && del[w] >= (it.updatedTime || 0)) return;
      mergedWords.push(it);
    });
    var tombN = 0;
    Object.keys(rdel).forEach(function (w) { if (!(ldel[w] >= rdel[w])) tombN++; });
    return {
      add: addN, update: updN, keep: keepN, tomb: tombN,
      mergedWordCount: mergedWords.length,
      deletedCount: Object.keys(del).length,
      fileWordCount: (Array.isArray(src.words) ? src.words : []).length
    };
  }
  // 确认弹窗（复用 .fw-wd-* 基础样式 + .fw-import-*）
  function confirmImportDoc(doc, preview, onOk, onCancel) {
    var host = document.body || document.documentElement;
    if (!host || !host.appendChild) { favWarn('导入确认弹窗打不开：页面尚未就绪'); return; }
    var overlay = document.createElement('div');
    overlay.className = 'fw-wd-overlay fw-import-overlay';
    overlay.innerHTML =
      '<div class="fw-wd-panel fw-import-panel" role="dialog" aria-modal="true">' +
        '<h3>导入收藏 JSON —— 合并预览</h3>' +
        '<div class="fw-import-line">文件内词条：<b>' + preview.fileWordCount + '</b> 个</div>' +
        '<div class="fw-import-line">新增（本机没有）：<b>' + preview.add + '</b> 个</div>' +
        '<div class="fw-import-line">更新（较新覆盖）：<b>' + preview.update + '</b> 个</div>' +
        '<div class="fw-import-line">保留（与本地相同或较旧）：<b>' + preview.keep + '</b> 个</div>' +
        '<div class="fw-import-line">新增删除墓碑：<b>' + preview.tomb + '</b> 条（已删除的词不会复活）</div>' +
        '<div class="fw-import-line">合并后收藏总数：<b>' + preview.mergedWordCount + '</b> 个</div>' +
        '<div class="fw-import-acts">' +
          '<button type="button" class="fw-import-btn" data-act="cancel">取消</button>' +
          '<button type="button" class="fw-import-btn fw-import-btn-main" data-act="ok">确认合并</button>' +
        '</div>' +
      '</div>';
    host.appendChild(overlay);
    var close = function () {
      try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) { /* ignore */ }
      try { if (overlay.__k && document.removeEventListener) document.removeEventListener('keydown', overlay.__k, true); } catch (e) { /* ignore */ }
    };
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { close(); if (onCancel) onCancel(); return; }
      var act = (e.target && e.target.getAttribute) ? e.target.getAttribute('data-act') : null;
      if (act === 'cancel') { close(); if (onCancel) onCancel(); }
      else if (act === 'ok') { close(); if (onOk) onOk(); }
    });
    overlay.__k = function (e) { if (e.key === 'Escape') { close(); if (onCancel) onCancel(); } };
    try { document.addEventListener('keydown', overlay.__k, true); } catch (e) { /* ignore */ }
  }
  // 真正执行导入：并入本地暂存 → 落盘 → 同步按钮标记 → 后台同步 → 刷新面板
  function doImportDoc(doc) {
    var res = favLocalMergeDoc(doc);
    try {
      var lw = (favLocalDoc.words || []).map(function (it) { return favNormalizeWord(it && it.word); }).filter(Boolean);
      for (var i = 0; i < lw.length; i++) favMarkLocal(lw[i]);
      var dl = favLocalDoc.deleted || {};
      Object.keys(dl).forEach(function (w) { favUnmarkLocal(w); });
      favRefreshButtons(currentWord || '');
    } catch (e) { /* ignore */ }
    favLog('导入完成', '本地暂存现为 ' + favCountWords(favLocalDoc) + ' 词 / ' + Object.keys(favLocalDoc.deleted).length + ' 墓碑（新增 ' + res.added + '）');
    showToast('导入完成：本地暂存共 ' + favCountWords(favLocalDoc) + ' 个词，正在同步到坚果云…', 3200);
    favScheduleUpload();
    if (bookPanelEl && typeof bookPanelEl.__fwBookReload === 'function') bookPanelEl.__fwBookReload();
  }
  // 文件选择入口：读取 → 校验 → 预览 → 确认 → 合并
  function importJson() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var doc = JSON.parse(String(reader.result || ''));
          var v = validateDoc(doc);
          if (!v.ok) {
            showToast('导入校验失败：' + v.errs.join('；'), 6000);
            try { console.warn('[FW 收藏] 导入校验失败', v.errs); } catch (e) { /* ignore */ }
            return;
          }
          var preview = buildImportPreview(doc);
          confirmImportDoc(doc, preview, function () { doImportDoc(doc); });
        } catch (e) {
          showToast('导入失败：文件不是合法的 JSON（' + favErrText(e) + '）', 6000);
        }
      };
      try { reader.readAsText(f); } catch (e) { showToast('读取文件失败：' + favErrText(e), 4000); }
    });
    try { input.click(); } catch (e) { favWarn('导入入口触发失败', favErrText(e)); }
  }

  /* ---------------- 油猴菜单 / 控制台 API ---------------- */
  function registerFavMenus() {
    if (typeof GM_registerMenuCommand !== 'function') { favLog('当前环境没有 GM_registerMenuCommand，菜单入口不可用（可用 window.__fwFav.open()）'); return; }
    try {
      GM_registerMenuCommand('★ WebDAV 收藏设置（坚果云）', function () { openFavWebdavPanel(); });
      GM_registerMenuCommand('★ 立即同步（上传）', function () {
        if (!favIsConfigured()) { favPromptConfig(); return; }
        showToast('正在同步…', 15000);
        favSyncPush('manual').then(function (r) {
          if (r && r.skipped) return;
          showToast('已同步到 WebDAV（' + r.count + ' 个词）', 3200);
          if (bookPanelEl && typeof bookPanelEl.__fwBookReload === 'function') bookPanelEl.__fwBookReload();
        }, function (e) { showToast('同步失败：' + favErrText(e), 6000); });
      });
      GM_registerMenuCommand('★ 从远端拉取', function () { favSyncPull(false).catch(function () { /* 失败已 toast */ }); });
      GM_registerMenuCommand('★ 测试 WebDAV 连接', function () { favConsoleTest(); });
      GM_registerMenuCommand('★ 导出收藏 JSON', function () { exportJson(); });
      GM_registerMenuCommand('★ 导入收藏 JSON', function () { importJson(); });
    } catch (e) { favWarn('注册油猴菜单失败', favErrText(e)); }
  }
  function favConsoleTest() {
    if (!favIsConfigured()) { favPromptConfig(); return Promise.reject(new Error('未配置 WebDAV')); }
    var cfg = favGetConfig();
    showToast('正在测试 WebDAV 连接…', 15000);
    return favTestConnection(cfg).then(function (r) {
      favLog('连接成功', r);
      showToast('WebDAV 连接成功（HTTP ' + r.status + '，通道 ' + r.via + '）；目标文件' +
        (r.fileExists ? '已存在，其中词条 ' + r.blockCount + ' 个' : '尚不存在，首次收藏时自动创建'), 4000);
      return r;
    }, function (e) {
      favWarn('连接测试失败', favErrText(e));
      showToast('连接失败：' + favErrText(e), 6000, '去配置', openFavWebdavPanel);
      throw e;
    });
  }
  function exposeFavApi() {
    var api = {
      version: '3.16.0',
      open: openFavWebdavPanel,
      settings: openFavWebdavPanel,
      close: closeFavWebdavPanel,
      enabled: function () { return !!CONFIG.favEnabled; },
      getConfig: favGetConfig,
      saveConfig: function (cfg) { return favSaveConfig(cfg); },
      clearConfig: favClearConfig,
      test: favConsoleTest,
      isFavorited: favIsFavorited,
      list: function () { return Array.from(favGetWordSet()); },
      favorite: function (word) { favToggle(word, favDataFor(word)); },
      unfavorite: function (word) { if (favIsConfigured()) favRunRemove(word, null); else favPromptConfig(); },
      card: function (word, data) { return favBuildCard(word, data || favDataFor(word)); },
      entryJson: function (word, data) { return JSON.stringify(favBuildCard(word, data || favDataFor(word)).entry); },
      mergeEntry: favMergeEntry,
      tombstoneEntry: favTombstoneEntry,
      countWords: favCountWords,
      diag: favDiagText,                       // v3.11.0：一键诊断文本（请求状态码 / 耗时 / 出口 / 配置脱敏回显）
      requestLog: function () { return favState.log.slice(); },
      snapshot: function () { var sn = favSnapGet(favGetConfig()); return sn ? { at: sn.at, words: favCountWords(sn.content), etag: !!sn.etag, bytes: sn.content.length } : null; },
      clearSnapshot: function () { favSnapDrop(); return true; },   // 清掉本机快照，下次收藏强制走完整读写
      syncNow: function () { return favSyncPush('manual'); },       // v3.16.0：立即同步（读远端→并集合并→回写，ETag 乐观锁）
      pullNow: function () { return favSyncPull(false); },          // v3.16.0：从远端拉取并合并到本机暂存
      exportJson: exportJson,                                       // v3.16.0：导出收藏 JSON（含统计，不含 WebDAV 密码）
      importJson: importJson,                                       // v3.16.0：导入收藏 JSON（校验+预览+确认合并）
      localDoc: function () { return favLocalDoc ? JSON.parse(JSON.stringify(favLocalDoc)) : null; },  // v3.16.0：查看本地暂存文档
      loadLocal: favLoadLocal,                                      // v3.16.0：重载本地暂存
      openFavorites: openBookPanel,
      closeFavorites: closeBookPanel,
      expandCard: function (word) { return bookSetCardOpen(word, true); },   // 展开某个成语卡片（word 省略=全部）
      collapseCard: function (word) { return bookSetCardOpen(word, false); },// 收起某个成语卡片
      toggleCard: function (word) { return bookSetCardOpen(word); },         // 切换某个成语卡片展开态
      expandAllCards: bookExpandAll,           // 展开全部卡片
      collapseAllCards: bookCollapseAll,       // 收起全部卡片
      help: function () {
        var lines = [
          'window.__fwFav 用法：',
          '  .open() / .settings()      打开 WebDAV 配置面板（同油猴菜单「★ WebDAV 收藏设置」）',
          '  .getConfig() / .saveConfig({url,username,password,filePath}) / .clearConfig()',
          '  .test()                    连接测试（返回 Promise）',
          '  .favorite("掩耳盗铃") / .unfavorite("掩耳盗铃")',
          '  .isFavorited("掩耳盗铃") / .list()',
          '  .card("掩耳盗铃")        生成该词的 JSON 收藏词条（{word,updatedTime,at,pinyin,...}）',
          '  .expandCard("掩耳盗铃") / .collapseCard("掩耳盗铃") / .toggleCard("掩耳盗铃")',
          '                             「我的收藏」面板：展开 / 收起该成语卡片的全部字段（默认只显示成语与释义）',
          '  .expandAllCards() / .collapseAllCards()      收藏面板：一键展开 / 收起全部卡片',
          '  .mergeEntry(text, entry) / .tombstoneEntry(text, "掩耳盗铃") / .countWords(text)  纯函数，便于离线自查 JSON 文档格式',
          '  .diag()                    收藏诊断：请求出口 / 最近若干次请求的状态码与耗时 / 配置（脱敏）/ 快照',
          '  .snapshot() / .clearSnapshot()  查看 / 清除本机远端文件快照（本快照让收藏省掉一次 GET）',
          '  .syncNow() / .pullNow()         立即同步（读远端→并集合并→回写）/ 从远端拉取并合并',
          '  .exportJson() / .importJson()   导出 / 导入收藏 JSON（导出含统计、不含 WebDAV 密码）',
          '  .localDoc() / .loadLocal()      查看 / 重载本地暂存文档（words+deleted，离线收藏靠它）'
        ];
        favLog('帮助', '\n' + lines.join('\n'));
        return lines.join('\n');
      }
    };
    try { window.__fwFav = api; } catch (e) { favWarn('挂载 window.__fwFav 失败', favErrText(e)); }
    return api;
  }

  /* ================= 启动 ================= */
  function init() {
    var style = document.createElement('style');
    style.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(style);
    ensureTip();
    loadDict();
    loadWordSet();   // 词边界词表（约 1.4MB，首次后台下载后缓存）
    bindEvents();
    registerFavMenus();   // v3.7.0 一键收藏：油猴菜单入口（★ WebDAV 收藏设置 / 测试连接）
    favLoadLocal();       // v3.16.0：启动加载本地暂存 JSON（收藏词条 + 删除墓碑）
    exposeFavApi();       // v3.7.0 一键收藏：控制台入口 window.__fwFav（open / test / favorite / list ...）
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
