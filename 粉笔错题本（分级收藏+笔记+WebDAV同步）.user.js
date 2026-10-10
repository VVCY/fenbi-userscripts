// ==UserScript==
// @name         粉笔错题本（分级收藏 + 笔记 + WebDAV 同步）
// @namespace    local.fenbi.mistakes
// @version      1.0.0
// @description  粉笔网页版一键收藏题目，按自定义错误原因分组，本地缓存 + WebDAV 同步（ETag 乐观锁 / 冲突自动重试 / 连接诊断），独立错题本页面（#/mistakes）；收藏分组支持最多四级树形（可新建子分组），错题本页面「显示收藏分类」移植粉笔官网错题本分类样式（白底卡片内纵向堆叠单行 flex 节点：箭头方块 + 分类名 + 题数 + 「⋯」编辑按钮，子分组缩进，点箭头方块展开 / 收起下级，点分类名筛选该分组含全部子分组的题，激活分组蓝色高亮）；支持导入/导出 JSON 文件（与现有收藏/分组数据结构兼容，合并到现有列表），点「返回刷题」跳转到刷题指南目录（/spa/tiku/guide/catalog）；v1.0.0：拖拽手柄仅限三点可拖，空分组提示改为 toast，水印移至 WebDAV 信息后
// @author       vvcy
// @match        *://spa.fenbi.com/*
// @match        *://www.fenbi.com/spa/*
// @include      *://spa.fenbi.com/*
// @include      *://www.fenbi.com/spa/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      dav.jianguoyun.com
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  /* =====================================================
   * 0. 存储兼容层：GM_* 优先，退回 localStorage
   *    修复旧版缺陷：原 gm.get 用 localStorage.getItem(k) || d，
   *    会把 '' / '0' 这类合法存量误判成「没存过」而返回默认值；
   *    另补齐 GM_deleteValue（清空配置需要）。
   * ===================================================== */
  const gmv = {
    get(k, d) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue(k, null);
          if (v !== null && v !== undefined) return String(v);
        }
      } catch (e) { /* 未授权 / 被禁用时退回 localStorage */ }
      try {
        const lv = localStorage.getItem(k);
        if (lv !== null && lv !== undefined) return String(lv);
      } catch (e) { /* 隐私模式等场景读失败 */ }
      return d;
    },
    set(k, v) {
      const s = String(v); let ok = false;
      try { if (typeof GM_setValue === 'function') { GM_setValue(k, s); ok = true; } } catch (e) { /* ignore */ }
      try { localStorage.setItem(k, s); ok = true; } catch (e) { /* ignore */ }
      return ok;
    },
    remove(k) {
      try { if (typeof GM_deleteValue === 'function') GM_deleteValue(k); } catch (e) { /* ignore */ }
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    }
  };
  const menu = (typeof GM_registerMenuCommand === 'function') ? GM_registerMenuCommand : () => {};

  /* =====================================================
   * 0.1 配置区：粉笔页面结构如果变了，优先调这里的选择器
   *     （2026-10 已按 spa.fenbi.com 真实 DOM 校准）
   * ===================================================== */
  const SEL = {
    questionRoot: ['.questions-single-container'],
    stem:         ['.question-choice-container app-format-html'],
    option: [
      'ul.choice-radios > li.choice-radio',
      'ul.choice-radios > li',
      '.choice-radios > li',
      'ul.option-list > li',
      'ul.questions-options > li',
      'li.choice-radio',
      'li.option-item',
      'li.option',
      'div.choice-item',
      '.choice-item',
      '.option-item'
    ],
    correctMark:  ['li.choice-radio.correct', 'li.choice-radio.right', 'li.choice-radio.is-right', 'li.choice-radio.success'],
    yourMark:     ['input.option-radio:checked'],
    titleBar:     ['ul.title-right'],
    titleIndex:   ['.title-index'],
  };
  const STORE_KEY = 'fenbi_mistakes_state_v1';
  const JUMP_KEY = 'fenbi_mistakes_jump_v1';   // 「打开原题」待定位记录：跨页面传递目标题标识   // 业务数据（已剥离 WebDAV 凭据，见下方迁移逻辑）

  const DEFAULT_GROUPS = [
    { id: 'politics',   name: '政治理论', builtin: true },
    { id: 'language',   name: '言语理解', builtin: true },
    { id: 'logic',      name: '逻辑判断', builtin: true },
    { id: 'numeracy',   name: '数量关系', builtin: true },
    { id: 'analysis',   name: '资料分析', builtin: true },
  ];

  /* =====================================================
   * 1. 状态读写（含旧数据迁移 + 删除墓碑）
   * ===================================================== */
  let state = { groups: DEFAULT_GROUPS.map(g => Object.assign({}, g)), items: [], deleted: {} };

  function emptyState() {
    return { groups: DEFAULT_GROUPS.map(g => Object.assign({}, g)), items: [], deleted: {} };
  }

  function loadState() {
    let s = null;
    try { s = JSON.parse(gmv.get(STORE_KEY, 'null')); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = emptyState();
    if (!Array.isArray(s.groups) || !s.groups.length) s.groups = DEFAULT_GROUPS.map(g => Object.assign({}, g));
    if (!Array.isArray(s.items)) s.items = [];
    if (!s.deleted || typeof s.deleted !== 'object') s.deleted = {};

    // 迁移：旧版本把 WebDAV 凭据混在业务数据里（会随数据一起上传 / 导出，属安全隐患）。
    // 这里把它挪到独立配置键，并从业务数据中彻底剥离。
    if (s.webdav && typeof s.webdav === 'object') {
      try {
        if (!gmv.get(DAV_CFG_KEY, '')) gmv.set(DAV_CFG_KEY, JSON.stringify(s.webdav));
      } catch (e) { /* ignore */ }
      delete s.webdav;
    }
    state = s;
    normalizeGroups();
    persist();
  }

  function persist() { gmv.set(STORE_KEY, JSON.stringify(state)); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function findItemByQid(qid) { return state.items.find(i => i.qid === qid); }

  /* 记录删除墓碑：让「在 A 端删掉的题」同步后不会在 B 端复活 */
  function markDeleted(id) {
    if (!id) return;
    state.deleted[id] = Date.now();
    trimTombstones();
  }
  function trimTombstones() {
    const keys = Object.keys(state.deleted);
    if (keys.length <= DAV_TOMB_MAX) return;
    keys.sort((a, b) => (state.deleted[a] || 0) - (state.deleted[b] || 0));
    keys.slice(0, keys.length - DAV_TOMB_MAX).forEach(k => { delete state.deleted[k]; });
  }

  /* =====================================================
   * 2. WebDAV 同步层
   *    本层按参考脚本 fenbi-word-hover-v3.user.js 的「WebDAV 收藏同步」
   *    实现重写，保留其核心机制：
   *      a) 统一请求出口 davRequest：GM_xmlhttpRequest 优先（免 CORS），
   *         缺失时退回 fetch，且带单次请求超时（避免无限挂起）；
   *      b) HTTP Basic 认证，账号密码先转 UTF-8 字节再 base64，
   *         中文 / 特殊字符不会再让 btoa 抛 InvalidCharacterError；
   *      c) ETag 乐观锁：写已有文件带 If-Match，确认新建带 If-None-Match:*，
   *         412 / 428 冲突自动重读重试（最多 2 次）；
   *      d) 失败按状态码分层提示（401/403 / 404/405 / 409 / 412/428）；
   *      e) 目录探测结果缓存，避免每次同步都发一串 MKCOL；
   *      f) 远端快照（内容 + ETag），重复同步时少一次 GET 往返；
   *      g) 请求诊断日志（只记路径与耗时，绝不记账号密码）。
   *    与参考脚本的差异：错题本同步的是整份 JSON 文档（groups + items + deleted），
   *    因此写入采用「读远端 → 合并 → 整体回写」，而不是 Markdown 词块追加。
   * ===================================================== */
  const DAV_CFG_KEY    = 'fenbi_mistakes_webdav_v1';        // WebDAV 配置（独立存储，绝不随错题数据上传 / 导出）
  const DAV_SNAP_KEY   = 'fenbi_mistakes_webdav_snap_v1';   // 远端文件快照（内容 + ETag）
  const DAV_PATH_DEF   = 'fenbi/mistakes/index.json';       // 默认远端路径（相对 WebDAV 根目录）
  const DAV_JGY_ROOT   = '我的坚果云';                       // 坚果云 WebDAV 虚拟服务根下唯一的真实目录
  const DAV_TIMEOUT_MS = 12000;                             // 单次 WebDAV 请求超时
  const DAV_MAX_RETRY  = 2;                                 // 乐观锁冲突最大重试次数
  const DAV_SNAP_MAX   = 1024 * 1024;                       // 快照体积上限：超过则只留内存、不落本地存储
  const DAV_REQ_LOG_MAX = 12;                               // 诊断日志：保留最近多少次请求
  const DAV_TOMB_MAX   = 3000;                              // 删除墓碑上限
  const DAV_JGY_RE     = /(^|\.)jianguoyun\.com(:\d+)?(\/|$)/i;

  let davState = { cfg: null, snap: undefined, dirsOk: {}, log: [] };
  let davBusy = false, davPending = false;

  function davLog(msg, extra) {
    try { if (typeof console !== 'undefined' && console && console.log) console.log('[粉笔错题本·同步]', msg, extra === undefined ? '' : extra); } catch (e) { /* ignore */ }
  }
  function davWarn(msg, extra) {
    try { if (typeof console !== 'undefined' && console && console.warn) console.warn('[粉笔错题本·同步]', msg, extra === undefined ? '' : extra); } catch (e) { /* ignore */ }
  }
  function errText(e) { return String(e && e.message ? e.message : (e == null ? '未知错误' : e)); }
  function errCode(e) { const m = /HTTP\s*(\d+)/.exec(errText(e)); return m ? m[1] : ''; }
  function davFormatTime(d) {
    const x = (d instanceof Date) ? d : new Date();
    const p = n => (n < 10 ? '0' : '') + n;
    return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + ' ' +
      p(x.getHours()) + ':' + p(x.getMinutes()) + ':' + p(x.getSeconds());
  }
  function davPageUrl() {
    try { if (typeof location !== 'undefined' && location && location.href) return String(location.href); } catch (e) { /* ignore */ }
    return '';
  }

  /* ---------------- 配置读写与规整 ---------------- */
  function davNormHost(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
    if (!s) return '';
    // 坚果云 WebDAV 固定入口是 https://dav.jianguoyun.com/dav，漏填 /dav 时自动补齐
    if (DAV_JGY_RE.test(s) && !/\/dav$/i.test(s)) s += '/dav';
    return s;
  }
  // 保存路径规整：坚果云 dav/ 是「虚拟服务根」，根目录不可写（往根下 PUT 裸文件名会 404），
  // 只填裸文件名（无目录层级）且地址指向坚果云时，自动补上最外层真实目录「我的坚果云」。
  function davNormPath(rawPath, host) {
    const p = String(rawPath == null ? '' : rawPath).trim().replace(/^\/+/, '') || DAV_PATH_DEF;
    if (p.indexOf('/') === -1 && p !== DAV_JGY_ROOT && DAV_JGY_RE.test(String(host == null ? '' : host))) {
      return DAV_JGY_ROOT + '/' + p;
    }
    return p;
  }
  function davNormCfg(raw) {
    const c = (raw && typeof raw === 'object') ? raw : {};
    const host = davNormHost(c.host);
    return {
      host,
      user: String(c.user == null ? '' : c.user).trim(),
      pass: String(c.pass == null ? '' : c.pass),
      path: davNormPath(c.path, host)
    };
  }
  function davGetCfg() {
    if (davState.cfg) return davState.cfg;
    let parsed = null;
    try { parsed = JSON.parse(gmv.get(DAV_CFG_KEY, '') || 'null'); } catch (e) { parsed = null; }
    davState.cfg = davNormCfg(parsed);
    return davState.cfg;
  }
  function davSaveCfg(cfg) {
    const next = davNormCfg(cfg);
    davState.cfg = next;
    const ok = gmv.set(DAV_CFG_KEY, JSON.stringify(next));
    davSnapDrop();   // 配置一改，旧的远端快照与目录探测结果全部作废
    davLog('已保存 WebDAV 配置', '地址=' + (next.host || '(空)') + ' 账号=' + (next.user || '(空)') + ' 保存路径=' + next.path + ' 持久化=' + (ok ? '成功' : '失败'));
    return ok;
  }
  function davClearCfg() {
    davState.cfg = davNormCfg(null);
    gmv.remove(DAV_CFG_KEY);
    davSnapDrop();
    davLog('已清空 WebDAV 配置（远端已同步的文件不受影响）');
  }
  // 「已配置」判定：地址 + 账号必填；密码允许留空（留空且服务端要求认证时会以 401 明确提示检查密码）
  function davIsConfigured(cfg) {
    const c = cfg || davGetCfg();
    return !!(c.host && c.user);
  }

  /* ---------------- URL / 认证（WebDAV 一律走 HTTP Basic） ---------------- */
  function davJoin(base, seg) {
    const b = String(base == null ? '' : base).trim().replace(/\/+$/, '');
    const s = String(seg == null ? '' : seg).replace(/^\/+/, '');
    return s ? b + '/' + s : b + '/';
  }
  function davEncPath(p) {
    return String(p == null ? '' : p).split('/').map(seg => encodeURIComponent(seg)).join('/');
  }
  function davFileUrl(cfg) { return davJoin(cfg.host, davEncPath(cfg.path)); }
  function davDirUrl(cfg) {
    const segs = String(cfg.path || '').split('/').filter(s => !!s);
    segs.pop();
    const u = davJoin(cfg.host, davEncPath(segs.join('/')));
    return /\/$/.test(u) ? u : u + '/';
  }
  // 账号密码可能含中文 / 特殊字符，先转 UTF-8 字节再 base64（替代已废弃且有坑的 unescape 写法）
  function davUtf8Base64(str) {
    const s = String(str == null ? '' : str);
    try {
      if (typeof TextEncoder === 'function' && typeof btoa === 'function') {
        const bytes = new TextEncoder().encode(s); let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      }
    } catch (e) { /* 退回下面的老办法 */ }
    try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return btoa(s); }
  }
  function davAuthHeader(cfg) { return 'Basic ' + davUtf8Base64(cfg.user + ':' + cfg.pass); }
  function davEtag(rawHeaders) {
    const m = /^etag:\s*(.+)$/im.exec(String(rawHeaders == null ? '' : rawHeaders));
    return m ? m[1].trim() : null;
  }

  /* ---------------- 请求出口：GM_xmlhttpRequest 优先（免 CORS），退回 fetch ---------------- */
  function davRequest(method, url, headers, body) {
    const h = Object.assign({}, headers || {});
    const hasBody = !(body === undefined || body === null);
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        let settled = false; const t0 = Date.now();
        const ok = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
        try {
          GM_xmlhttpRequest({
            method: method, url: url, headers: h, data: hasBody ? body : undefined,
            timeout: DAV_TIMEOUT_MS, responseType: 'text',
            onload(res) {
              const st = (res && typeof res.status === 'number') ? res.status : 0;
              const ms = Date.now() - t0;
              davNoteReq(method, url, st, ms, 'GM_xmlhttpRequest');
              ok(resolve, {
                status: st,
                statusText: (res && res.statusText) || '',
                text: (res && res.responseText != null) ? String(res.responseText) : '',
                headers: (res && res.responseHeaders) || '',
                via: 'GM_xmlhttpRequest',
                ms: ms
              });
            },
            onerror(res) {
              const e = new Error('网络错误（GM_xmlhttpRequest）' + (res && res.error ? '：' + res.error : ''));
              e.ms = Date.now() - t0;
              davNoteReq(method, url, 0, e.ms, 'GM_xmlhttpRequest（网络错误）');
              ok(reject, e);
            },
            ontimeout() {
              const e = new Error('请求超时（超过 ' + DAV_TIMEOUT_MS + 'ms）');
              e.ms = Date.now() - t0;
              davNoteReq(method, url, 0, e.ms, 'GM_xmlhttpRequest（超时）');
              ok(reject, e);
            },
            onabort() { ok(reject, new Error('请求被中止')); }
          });
        } catch (e) { ok(reject, e); }
      });
    }
    const t0 = Date.now();
    return fetch(url, {
      method: method, headers: h,
      body: hasBody ? body : undefined,
      credentials: 'omit',   // 不要把粉笔的 Cookie 带到 WebDAV 服务器上去
      cache: 'no-store'
    }).then(res => res.text().then(t => {
      const ms = Date.now() - t0;
      davNoteReq(method, url, res.status, ms, 'fetch');
      return { status: res.status, statusText: res.statusText || '', text: String(t == null ? '' : t), headers: '', via: 'fetch', ms: ms };
    })).catch(e => {
      throw new Error('请求失败（' + errText(e) + '）；当前环境没有 GM_xmlhttpRequest，浏览器会以 CORS 拦截跨域 WebDAV 请求');
    });
  }

  /* ---------------- 诊断：请求出口 / 状态码 / 耗时（只记路径，不记账号密码） ---------------- */
  function davUrlPath(url) {
    const m = /^[a-z]+:\/\/[^/]+(\/[^?#]*)?/i.exec(String(url == null ? '' : url));
    return m ? (m[1] || '/') : String(url == null ? '' : url);
  }
  function davNoteReq(method, url, status, ms, via) {
    try {
      const d = new Date(), p2 = n => (n < 10 ? '0' : '') + n;
      davState.log.push({
        at: p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()),
        method: String(method || '').toUpperCase(),
        path: davUrlPath(url), status: status, ms: ms, via: via || ''
      });
      if (davState.log.length > DAV_REQ_LOG_MAX) davState.log = davState.log.slice(davState.log.length - DAV_REQ_LOG_MAX);
    } catch (e) { /* 诊断失败绝不影响主流程 */ }
  }
  function davReqBrief() {
    const l = davState.log;
    const r = (l && l.length) ? l[l.length - 1] : null;
    if (!r) return '';
    return r.method + ' ' + (r.status || '未响应') + ' · ' + (r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + 's' : r.ms + 'ms');
  }
  function davDiagText() {
    const cfg = davGetCfg();
    const snap = davSnapGet(cfg);
    const lines = [];
    lines.push('【粉笔错题本 · WebDAV 同步诊断】脚本 v0.3.0');
    lines.push('页面：' + davPageUrl());
    lines.push('配置状态：' + (davIsConfigured(cfg) ? '已配置' : '未配置'));
    lines.push('  服务器：' + (cfg.host || '(空)'));
    lines.push('  账号：' + (cfg.user ? '已填（' + cfg.user.length + ' 位）' : '(空)'));
    lines.push('  密码：' + (cfg.pass ? '已填（' + cfg.pass.length + ' 位）' : '(空)'));
    lines.push('  远程路径：' + cfg.path);
    lines.push('  目标 URL：' + (cfg.host ? davFileUrl(cfg) : '(未配置)'));
    lines.push('请求出口：' + (typeof GM_xmlhttpRequest === 'function' ? 'GM_xmlhttpRequest（免 CORS，推荐）' : 'fetch（浏览器同源策略可能拦截跨域 WebDAV）'));
    lines.push('单次请求超时：' + DAV_TIMEOUT_MS + 'ms；冲突最大重试：' + DAV_MAX_RETRY + ' 次');
    lines.push('本机数据：' + state.items.length + ' 道题 / ' + state.groups.length + ' 个分组 / ' + Object.keys(state.deleted).length + ' 条删除墓碑');
    lines.push('远端快照：' + (snap ? (snap.at + ' · ' + snap.content.length + ' 字节 · ETag ' + (snap.etag ? '有' : '无')) : '无（下次读远端会重新建立）'));
    lines.push('最近 ' + davState.log.length + ' 次请求（新 → 旧）：');
    for (let i = davState.log.length - 1; i >= 0; i--) {
      const r = davState.log[i];
      lines.push('  ' + r.at + '  ' + r.method + ' ' + r.path + ' → ' + (r.status || '未响应') +
        ' · ' + (r.ms >= 1000 ? (r.ms / 1000).toFixed(2) + 's' : r.ms + 'ms') + (r.via ? ' · ' + r.via : ''));
    }
    if (!davState.log.length) lines.push('  （还没有发出过 WebDAV 请求）');
    lines.push('提示：401/403 = 账号或应用密码不对；404/405 = 保存路径不可写；409 = 上级目录不存在；超时 = 网络或代理拦截了 dav.jianguoyun.com。');
    return lines.join('\n');
  }

  /* ---------------- 远端快照：省掉「每次同步都先 GET 一遍」的往返 ---------------- */
  function davCfgKey(cfg) { return String((cfg && cfg.host) || '') + '|' + String((cfg && cfg.path) || ''); }
  function davSnapGet(cfg) {
    if (davState.snap === undefined) {
      let raw = '', parsed = null;
      try { raw = gmv.get(DAV_SNAP_KEY, '') || ''; } catch (e) { raw = ''; }
      try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
      davState.snap = (parsed && typeof parsed === 'object') ? parsed : null;
    }
    const sn = davState.snap;
    if (!sn || sn.key !== davCfgKey(cfg) || typeof sn.content !== 'string') return null;
    return sn;
  }
  function davSnapSave(cfg, content, etag) {
    const text = String(content == null ? '' : content);
    const sn = { key: davCfgKey(cfg), content: text, etag: etag || null, at: davFormatTime(new Date()) };
    davState.snap = sn;
    try { if (text.length <= DAV_SNAP_MAX) gmv.set(DAV_SNAP_KEY, JSON.stringify(sn)); } catch (e) { /* 体积过大只留内存 */ }
    return sn;
  }
  function davSnapDrop(cfg) {
    davState.snap = null;
    try { gmv.remove(DAV_SNAP_KEY); } catch (e) { /* ignore */ }
    if (cfg) davState.dirsOk[davCfgKey(cfg)] = false;
  }

  /* ---------------- 读写远端文件 ---------------- */
  // 读取远端文件（不存在不算错误，返回 exists:false）
  function davGetFile(cfg) {
    return davRequest('GET', davFileUrl(cfg), {
      'Authorization': davAuthHeader(cfg),
      'Accept': 'application/json, text/plain, */*',
      'Cache-Control': 'no-cache'
    }).then(res => {
      // 404：目标文件不存在；409（坚果云返回 AncestorsNotFound）：上级目录不存在
      // → 与 404 一并按「不存在」处理，交给上游建目录流程，避免被误判成「读取失败」直接中断。
      if (res.status === 404 || res.status === 409) {
        davSnapDrop(cfg);
        return { exists: false, content: '', etag: null, status: res.status, ms: res.ms };
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码（坚果云须用「应用密码」）');
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error('读取远端文件失败（HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '）');
      }
      const etag = davEtag(res.headers);
      davSnapSave(cfg, res.text, etag);
      return { exists: true, content: res.text, etag: etag, status: res.status, ms: res.ms };
    });
  }
  // 整体回写：cond.etag → If-Match（已有文件，乐观锁）；cond.create → If-None-Match:*（确认不存在时新建）
  function davPutFile(cfg, content, cond) {
    cond = cond || {};
    const headers = { 'Authorization': davAuthHeader(cfg), 'Content-Type': 'application/json; charset=utf-8' };
    if (cond.etag) headers['If-Match'] = cond.etag;
    else if (cond.create) headers['If-None-Match'] = '*';
    return davRequest('PUT', davFileUrl(cfg), headers, content);
  }
  // 尽力创建保存路径上的各级目录（已存在 / 服务端不支持时静默跳过，真正的问题交给 PUT 报错）
  function davEnsureDirs(cfg, force) {
    const dirsKey = davCfgKey(cfg);
    // 同一配置下目录只需探测一次（已存在时服务端多半回 405），省掉每次同步的 MKCOL 往返；
    // 写入真遇到 404/405/409 时会带 force 重探一次，避免「用户手动删了目录后一直 409」。
    if (!force && davState.dirsOk[dirsKey]) return Promise.resolve(false);
    const segs = String(cfg.path || '').split('/').filter(s => !!s);
    if (segs.length <= 1) return Promise.resolve(false);
    let created = false, chain = Promise.resolve();
    const makeStep = i => () => {
      const dirUrl = davJoin(cfg.host, davEncPath(segs.slice(0, i + 1).join('/')));
      return davRequest('MKCOL', dirUrl, { 'Authorization': davAuthHeader(cfg) })
        .then(res => { if (res.status >= 200 && res.status < 300) created = true; })
        .catch(() => { /* 目录已存在或服务端不支持 MKCOL，继续 */ });
    };
    for (let i = 0; i < segs.length - 1; i++) chain = chain.then(makeStep(i));
    return chain.then(() => { davState.dirsOk[dirsKey] = true; return created; });
  }

  /* ---------------- 文档合并（双向并集 + 删除墓碑，可离线单测） ---------------- */
  function buildDoc() {
    return {
      app: 'fenbi-mistakes-notebook',
      schema: 2,
      exportedAt: new Date().toISOString(),
      groups: state.groups,
      items: state.items,
      deleted: state.deleted || {}
    };
  }
  // 把远端文档合并进本地：分组 / 题目按 id 取 updatedAt 更新的一方；删除墓碑按时间取最新
  function mergeDocs(remote) {
    if (!remote || typeof remote !== 'object') return { items: 0, groups: 0 };
    // 1) 删除墓碑：先合，后面过滤题目要用
    const del = Object.assign({}, state.deleted || {});
    const rdel = (remote.deleted && typeof remote.deleted === 'object') ? remote.deleted : {};
    Object.keys(rdel).forEach(id => { const t = Number(rdel[id]) || 0; if (!(del[id] >= t)) del[id] = t; });

    // 2) 分组：并集（保留本地独有分组，避免被远端整表覆盖后丢失）
    const gmap = new Map(state.groups.map(g => [g.id, g]));
    (Array.isArray(remote.groups) ? remote.groups : []).forEach(rg => {
      if (!rg || !rg.id) return;
      // 分组墓碑：本机删掉的分组（含其子分组）不因远端仍存在而复活
      if (del[rg.id] !== undefined && del[rg.id] >= (rg.updatedAt || 0)) return;
      const lg = gmap.get(rg.id);
      if (!lg) gmap.set(rg.id, Object.assign({}, rg));
      else if ((rg.updatedAt || 0) > (lg.updatedAt || 0)) gmap.set(rg.id, Object.assign({}, lg, rg));
    });

    // 3) 题目：并集 + 墓碑过滤
    const imap = new Map(state.items.map(i => [i.id, i]));
    (Array.isArray(remote.items) ? remote.items : []).forEach(ri => {
      if (!ri || !ri.id) return;
      if (del[ri.id] !== undefined && del[ri.id] >= (ri.updatedAt || 0)) return;
      const li = imap.get(ri.id);
      if (!li) imap.set(ri.id, Object.assign({}, ri));
      else if ((ri.updatedAt || 0) > (li.updatedAt || 0)) imap.set(ri.id, Object.assign({}, li, ri));
    });

    state.groups = [...gmap.values()].filter(g => !(del[g.id] !== undefined && del[g.id] >= (g.updatedAt || 0)));
    state.items = [...imap.values()].filter(i => !(del[i.id] !== undefined && del[i.id] >= (i.updatedAt || 0)));
    state.deleted = del;
    trimTombstones();
    return { items: state.items.length, groups: state.groups.length };
  }
  function parseDoc(text) {
    try { const d = JSON.parse(String(text == null ? '' : text)); return (d && typeof d === 'object') ? d : null; }
    catch (e) { return null; }
  }

  /* ---------------- 失败文案：按 HTTP 状态码分层提示 ---------------- */
  function davStatusHint(status, cfg) {
    const code = String(status == null ? '' : status).replace(/[^0-9]/g, '');
    const path = String((cfg && cfg.path) || DAV_PATH_DEF);
    if (code === '401' || code === '403') {
      return '账号或密码没有通过认证。坚果云的账号要填「注册邮箱」，密码必须用「账户信息 → 安全选项 → 添加应用」生成的「应用密码」，填登录密码会一直 401。';
    }
    if (code === '404' || code === '405') {
      return '服务器地址或保存路径不对（该路径不可写）。坚果云地址固定为 https://dav.jianguoyun.com/dav；保存路径「' + path +
        '」只有裸文件名时脚本会自动补成「' + DAV_JGY_ROOT + '/' + path + '」（dav/ 是虚拟服务根，根目录不可写）。';
    }
    if (code === '409') {
      return '服务端报告上级目录不存在或状态冲突，请确认保存路径「' + path + '」的上级目录已存在（脚本会自动尝试创建，失败时可在坚果云网页端手动建好）。';
    }
    if (code === '412' || code === '428') {
      return '远端文件确实正被其它端改写（ETag 乐观锁校验未通过），稍后重试即可。';
    }
    return '请稍后重试；若持续失败，可在 WebDAV 设置面板点「诊断信息」查看详情。';
  }
  function davWriteFailText(action, cfg, conflict) {
    const m = /HTTP\s*(\d+)/.exec(String(conflict == null ? '' : conflict));
    return action + '失败，自动重试 ' + DAV_MAX_RETRY + ' 次仍未成功（' + (conflict || '未知原因') + '）。' + davStatusHint(m ? m[1] : '', cfg);
  }

  /* ---------------- 上传（读远端 → 合并本地改动 → 整体回写，ETag 乐观锁） ---------------- */
  function davPush(reason) {
    const cfg = davGetCfg();
    if (!davIsConfigured(cfg)) return Promise.resolve({ skipped: true, reason: '未配置' });
    if (davBusy) { davPending = true; return Promise.resolve({ queued: true }); }
    davBusy = true;
    const finish = (fn) => {
      davBusy = false;
      if (davPending) { davPending = false; setTimeout(() => scheduleUpload('auto'), 400); }
      return fn;
    };
    let conflict = '', attempt = 0;
    const retry = () => {
      attempt++;
      if (attempt > DAV_MAX_RETRY) throw new Error(davWriteFailText('同步', cfg, conflict));
      return step();
    };
    const step = () => davGetFile(cfg).then(cur => {
      const remote = cur.exists ? parseDoc(cur.content) : null;
      if (remote) mergeDocs(remote);   // 先把远端改动合进来，避免「最后写入者」直接覆盖别端内容
      persist();
      const text = JSON.stringify(buildDoc());
      return davPutFile(cfg, text, cur.exists ? { etag: cur.etag } : { create: true }).then(res => {
        if (res.status === 412 || res.status === 428) {
          conflict = 'HTTP ' + res.status;
          davWarn('WebDAV 写入冲突，重新读取后再试', conflict + ' 第 ' + (attempt + 1) + ' 次');
          return retry();
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码（坚果云须用「应用密码」）');
        }
        if (res.status === 404 || res.status === 405 || res.status === 409) {
          return davEnsureDirs(cfg, true).then(created => {
            conflict = 'HTTP ' + res.status + (created ? '（已尝试创建上级目录）' : '');
            davWarn('WebDAV 写入失败，尝试创建上级目录后重试', conflict + ' 第 ' + (attempt + 1) + ' 次');
            return retry();
          });
        }
        if (res.status < 200 || res.status >= 300) {
          throw new Error('上传远端文件失败（HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '）');
        }
        if (cur.exists && !cur.etag) davWarn('远端文件未返回 ETag，本次写入退化为「最后写入者胜」');
        davSnapSave(cfg, text, davEtag(res.headers) || (cur.etag || null));   // 写入成功即留快照
        davLog('同步完成', '题目 ' + state.items.length + ' 条 · ' + (res.via || '') + ' · ' + (res.ms || 0) + 'ms');
        return { ok: true, count: state.items.length, groups: state.groups.length, created: !cur.exists, via: res.via, ms: res.ms };
      });
    });
    return davEnsureDirs(cfg)
      .then(step)
      .then(r => finish(r), e => finish(Promise.reject(e)));
  }

  /* ---------------- 拉取（GET → 合并 → 持久化 → 重渲染） ---------------- */
  function davPull(silent) {
    const cfg = davGetCfg();
    if (!davIsConfigured(cfg)) {
      if (!silent) toast('未配置 WebDAV，请先在「WebDAV 设置」里填写');
      return Promise.resolve({ skipped: true });
    }
    return davGetFile(cfg).then(cur => {
      if (!cur.exists) {
        if (!silent) toast('远端还没有同步文件（首次同步时脚本会自动创建）');
        return { exists: false };
      }
      const remote = parseDoc(cur.content);
      if (!remote) throw new Error('远端文件不是合法的 JSON（可能被其它内容覆盖，请检查保存路径）');
      const stat = mergeDocs(remote);
      persist();
      refreshBadge();
      refreshFavButtons();
      if (renderNotebook) renderNotebook();
      if (!silent) toast('已从 WebDAV 拉取最新数据（' + stat.items + ' 道题）');
      return { exists: true, items: stat.items };
    }).catch(e => {
      davWarn('拉取失败', errText(e));
      if (!silent) toast('同步失败：' + errText(e));
      throw e;
    });
  }

  let uploadTimer = null;
  function scheduleUpload(reason) {
    if (!davIsConfigured()) return;
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => {
      davPush(reason || 'auto').then(r => {
        if (!r || r.skipped || r.queued) return;
        if (reason === 'manual') toast('已同步到 WebDAV（' + r.count + ' 道题）');
      }, e => {
        toast('WebDAV 上传失败：' + errText(e), 6000);
      });
    }, 1200);
  }

  /* ---------------- 连接测试：① 探测服务与账号（OPTIONS，不支持则退化 PROPFIND）② 读目标文件现状 ---------------- */
  function davTestConnection(cfg) {
    const c = davNormCfg(cfg || davGetCfg());
    if (!c.host) return Promise.reject(new Error('请先填写 WebDAV 服务器地址（坚果云固定为 https://dav.jianguoyun.com/dav）'));
    if (!c.user) return Promise.reject(new Error('请先填写 WebDAV 账号（坚果云为注册邮箱）'));
    const auth = { 'Authorization': davAuthHeader(c) };
    const dirUrl = davDirUrl(c);
    return davRequest('OPTIONS', dirUrl, Object.assign({ 'Accept': '*/*' }, auth)).then(probe => {
      if (probe.status === 405 || probe.status === 501) {
        return davRequest('PROPFIND', dirUrl,
          Object.assign({ 'Depth': '0', 'Content-Type': 'application/xml; charset=utf-8' }, auth),
          '<?xml version=\'1.0\' encoding=\'utf-8\'?><d:propfind xmlns:d=\'DAV:\'><d:prop><d:resourcetype/></d:prop></d:propfind>');
      }
      return probe;
    }).then(probe => {
      if (probe.status === 401 || probe.status === 403) {
        throw new Error('连接失败（HTTP ' + probe.status + '）：' + davStatusHint(probe.status, c));
      }
      if (probe.status < 200 || probe.status >= 300) {
        throw new Error('连接失败（HTTP ' + probe.status + (probe.statusText ? ' ' + probe.statusText : '') + '）：' + davStatusHint(probe.status, c));
      }
      const dav = /^dav:\s*(.+)$/im.exec(String(probe.headers || ''));
      return davGetFile(c).then(file => ({
        status: probe.status, via: probe.via,
        dav: dav ? dav[1].trim() : '',
        path: c.path, fileExists: file.exists, bytes: file.exists ? file.content.length : 0
      }));
    });
  }
  function davConsoleTest() {
    if (!davIsConfigured()) { openWebdavModal(); return Promise.reject(new Error('未配置 WebDAV')); }
    const cfg = davGetCfg();
    toast('正在测试 WebDAV 连接…', 15000);
    return davTestConnection(cfg).then(r => {
      davLog('连接成功', r);
      toast('WebDAV 连接成功（HTTP ' + r.status + '，通道 ' + r.via + '）；目标文件' +
        (r.fileExists ? '已存在（' + r.bytes + ' 字节）' : '尚不存在，首次同步时自动创建'), 4000);
      return r;
    }, e => {
      davWarn('连接测试失败', errText(e));
      toast('连接失败：' + errText(e), 6000, '去配置', openWebdavModal);
      throw e;
    });
  }

  /* =====================================================
   * 3. 题目抓取
   * ===================================================== */
  function firstMatch(scope, sels) {
    for (const s of sels) { const n = scope.querySelector(s); if (n) return n; }
    return null;
  }
  function textOf(scope, sels) {
    for (const s of sels) {
      const n = scope.querySelector(s);
      if (n) { const t = (n.innerText || n.textContent || '').trim(); if (t) return t; }
    }
    return '';
  }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // v0.3.29：保留粉笔页下划线标签（<u> / <ins> / <span class="underline">），
  // 剥离 style / class / on* / href / src 等属性防 XSS，保留纯文本 + 下划线
  function stripHTML(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, function (match) {
      const lower = match.toLowerCase();
      if (/^<\/?u\b|<\/?ins\b/i.test(lower)) return match;
      if (/<span[\s>]/i.test(lower) && /\bunderline\b/i.test(lower)) return match;
      return '';
    });
  }

  function hashKey(s) {
    let h = 5381;
    const str = String(s == null ? '' : s);
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36);
  }
  function qidFromAttrs(root) {
    if (!root || !root.getAttribute) return '';
    const prefer = ['data-qid', 'data-question-id', 'data-questionid', 'qid', 'questionid', 'data-id'];
    const hit = function (el, allowId) {
      if (!el || !el.getAttribute) return '';
      for (let i = 0; i < prefer.length; i++) {
        const v = el.getAttribute(prefer[i]);
        if (v) { const m = /(\d{4,})/.exec(v); if (m) return m[1]; }
      }
      if (allowId) {
        const v2 = el.getAttribute('id');
        if (v2) { const m2 = /(\d{4,})/.exec(v2); if (m2) return m2[1]; }
      }
      return '';
    };
    let el = root, steps = 0;
    while (el && steps < 5) {
      const v = hit(el, true);
      if (v) return v;
      const parent = el.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      let cnt = 99;
      try { cnt = parent.querySelectorAll(SEL.stem.join(',')).length; } catch (e) { cnt = 99; }
      if (cnt > 1) break;
      el = parent; steps++;
    }
    let inner = [];
    try { inner = Array.prototype.slice.call(root.querySelectorAll('[data-qid],[data-question-id],[data-questionid],[qid],[questionid],[data-id]')); } catch (e) { inner = []; }
    for (let i = 0; i < inner.length && i < 60; i++) {
      const v = hit(inner[i], false);
      if (v) return v;
    }
    return '';
  }
  function qidFromHtml(root) {
    const html = String((root && root.outerHTML) || '');
    if (!html) return '';
    const pats = [
      /question_?id["'\]]?\s*[:=]\s*["']?(\d{4,})/i,
      /"(?:questionId|qid|question_id)"\s*:\s*(\d{4,})/i,
      /data-[a-z0-9-]*id=["']?(\d{4,})/i
    ];
    for (const p of pats) { const m = p.exec(html); if (m) return m[1]; }
    return '';
  }
  function qidFromAngular(root) {
    const ngCand = function (el) {
      try {
        const ctx = el && el.__ngContext__;
        const arr = Array.isArray(ctx) ? ctx : null;
        if (!arr) return '';
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          if (!v || typeof v !== 'object') continue;
          const cand = v.id || v.questionId || v.qid || (v.question && (v.question.id || v.question.qid));
          if (cand != null && /^\d{3,}$/.test(String(cand))) return String(cand);
        }
      } catch (e) { /* ignore */ }
      return '';
    };
    try {
      let el = root, steps = 0;
      while (el && steps < 6) {
        const cand = ngCand(el);
        if (cand) return cand;
        const parent = el.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) break;
        let cnt = 99;
        try { cnt = parent.querySelectorAll(SEL.stem.join(',')).length; } catch (e) { cnt = 99; }
        if (cnt > 1) break;
        el = parent; steps++;
      }
    } catch (e) { /* ignore */ }
    return '';
  }
  function qidFromUrl() {
    try {
      let multi = 0;
      try { multi = document.querySelectorAll(SEL.stem.join(',')).length; } catch (e) { multi = 0; }
      if (multi > 1) return '';
      const href = String(location.href || '');
      const q = /[?&#](?:questionId|question_id|qid|questionid|id)=(\d{3,})/i.exec(href);
      if (q) return q[1];
      const p = /\/(?:question|questions|detail|practice|tiku)\/(\d{3,})/i.exec(href);
      if (p) return p[1];
      const any = /(\d{6,})/.exec(href);
      if (any) return any[1];
    } catch (e) { /* ignore */ }
    return '';
  }
  function extractQid(root, stem) {
    const found = qidFromAttrs(root) || qidFromAngular(root) || qidFromHtml(root) || qidFromUrl();
    if (found) return found;
    const base = norm(stem || '') || norm((root && (root.innerText || root.textContent)) || '');
    return base ? hashKey(base) : '';
  }
  function optionLetter(index) { return String.fromCharCode(65 + index); }

  function fbOrder(a, b) {
    if (a === b) return 0;
    try { return (a.compareDocumentPosition(b) & 4) ? -1 : 1; } catch (e) { return 0; }
  }
  function dedupeOpts(nodes) {
    const uniq = [];
    (nodes || []).forEach(n => { if (n && uniq.indexOf(n) < 0) uniq.push(n); });
    const kept = uniq.filter(n => !uniq.some(o => o !== n && o.contains(n)));
    return kept.sort(fbOrder);
  }
  function collectOptionEls(root) {
    const scopes = [root, document];
    for (let i = 0; i < scopes.length; i++) {
      const sc = scopes[i];
      if (!sc || !sc.querySelectorAll) continue;
      for (let j = 0; j < SEL.option.length; j++) {
        let nodes;
        try { nodes = Array.prototype.slice.call(sc.querySelectorAll(SEL.option[j])); } catch (e) { nodes = []; }
        nodes = dedupeOpts(nodes.filter(n => n && norm(n.innerText || n.textContent)));
        if (nodes.length) return nodes;
      }
      let rows = Array.prototype.slice.call(sc.querySelectorAll('input[type=radio]'))
        .map(x => x.closest('li') || x.parentElement).filter(Boolean);
      rows = dedupeOpts(rows.filter(r => r && norm(r.innerText || r.textContent)));
      if (rows.length) return rows;
      const dots = Array.prototype.slice.call(sc.querySelectorAll('.input-radio')).filter(Boolean);
      const rowOfDot = function (d) {
        let cur = d.closest('li, .choice-item, .option-item, .choice-radio') || d.parentElement;
        for (let k = 0; k < 3 && cur; k++) {
          if (norm(cur.innerText || cur.textContent).length > 1) break;
          const up = cur.parentElement;
          if (!up || up.querySelectorAll('.input-radio').length !== 1) break;
          cur = up;
        }
        return cur;
      };
      rows = dedupeOpts(dots.map(rowOfDot).filter(r => r && norm(r.innerText || r.textContent)));
      if (rows.length >= 2) return rows;
      if (dots.length >= 2) {
        const self = dedupeOpts(dots.map(d => d.parentElement || d));
        return self.length >= 2 ? self : dots;
      }
    }
    return [];
  }

  // 采集该题的稳定定位标识（供「打开原题」落地后定位到题号使用）：
  // app-ti[data-question-key] > 题目标题 id（.title / .title-index 的 id） > 原生锚点 a[name^="anchor-ques"]
  function questionKeysOf(root) {
    const out = { qkey: '', anchorId: '', anchorName: '' };
    try {
      const ti = root && root.querySelector ? ((root.matches && root.matches('app-ti')) ? root : root.querySelector('app-ti')) : null;
      if (ti && ti.getAttribute) out.qkey = String(ti.getAttribute('data-question-key') || '');
    } catch (e) { /* ignore */ }
    try {
      const t = root && root.querySelector ? (root.querySelector('.title') || root.querySelector('.title-index')) : null;
      if (t && t.id) out.anchorId = String(t.id);
    } catch (e) { /* ignore */ }
    try {
      const a = root && root.querySelector ? root.querySelector('a[name^="anchor-ques"]') : null;
      if (a && a.getAttribute) out.anchorName = String(a.getAttribute('name') || '');
    } catch (e) { /* ignore */ }
    return out;
  }

  /* v0.3.12：抓取题目来源（试卷名 + 题号，如「2018年广西选调生考试《行测》试题（网友回忆版）第18题」）。
   * 顺序：常见来源条类名 -> 题根内文本以「第N题」结尾的叶子（拆开结构时上溯父容器补全试卷名）-> 兜底空字符串。 */
  function extractSource(root) {
    try {
      if (!root || !root.querySelectorAll) return '';
      // 收藏按钮注入时的 root 可能是 .question-choice-container（题干容器），
      // 而来源条（试卷名+题号）挂在题根 .questions-single-container 内，先上溯到题根再抓取。
      // v0.3.25：资料分析小题 root 在组 .ti 内（.questions-container > app-ti），
      // closest('.questions-single-container') 为 null；再上溯到组 .ti，来源条挂在组内。
      const scope = (root.closest &&
        (root.closest('.questions-single-container') || root.closest('.ti'))) || root;
      if (!scope || !scope.querySelectorAll) return '';
      const isGroup = !!(scope.classList && scope.classList.contains('ti'));
      // 组 .ti 内材料区没有来源条，扫描时跳过，避免误命中材料正文
      function skipMat(el) { try { return isGroup && !!(el.closest && el.closest('.materials-container')); } catch (e) { return false; } }
      const cands = scope.querySelectorAll('.question-source, .source-info, .exam-name, .paper-source, .exam-info, .question-info, .paper-title, .title-info, .question-src, .source-text, .header-title');
      for (let i = 0; i < cands.length; i++) {
        if (skipMat(cands[i])) continue;
        const txt = norm(cands[i].innerText || cands[i].textContent);
        if (txt && /第\s*\d+\s*题/.test(txt)) return txt.slice(0, 200);
      }
      const leaves = scope.querySelectorAll('div, p, span, h1, h2, h3, h4, h5, li');
      for (let i = 0; i < leaves.length; i++) {
        const el = leaves[i];
        if (skipMat(el)) continue;
        let hasChild = false;
        try { hasChild = !!(el.children && el.children.length); } catch (e) { hasChild = false; }
        if (hasChild) continue;
        const txt = norm(el.innerText || el.textContent);
        // v0.3.25：兼容资料分析组来源条带题号区间（如「第21-25题」）
        if (txt && /第\s*\d+\s*(?:[-—~～至和、,，]\s*\d+\s*)?题\s*$/.test(txt) && txt.length <= 200) {
          let box = el;
          for (let k = 0; k < 2 && box.parentElement; k++) {
            box = box.parentElement;
            // v0.3.25：资料分析组内上溯到含材料区的容器（组 .ti）时，来源叶子文本已含试卷名+题号，
            // 直接返回，避免把「材料+题干+选项」整组文本误判为来源。
            if (isGroup) {
              let hasMat = false;
              try { hasMat = !!box.querySelectorAll && !!box.querySelectorAll('.materials-container').length; } catch (e) { hasMat = false; }
              if (hasMat) break;
            }
            const boxTxt = norm(box.innerText || box.textContent);
            if (boxTxt && boxTxt.length <= 300 && /《|试题|考试|真题|模拟|联考|测验|试卷|卷/.test(boxTxt)) return boxTxt;
            if (boxTxt && boxTxt.length > 300) break;
          }
          return txt;
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  /* =====================================================
   * v0.3.16：题干 / 选项图片转 base64（方案 A）。
   * 同步阶段：data: 直接取 src；同源且已加载完成的图用 canvas 绘制 toDataURL('image/png')。
   * 未就绪 / 跨域图：返回空并登记异步补救任务（crossOrigin=anonymous 重载后绘制），
   * 失败兜底为空并提示，绝不阻塞收藏流程。多图以 '|||' 连接，渲染端按段拆出多个 <img>。
   * ===================================================== */
  function collectImgBase64(scopeEl, key, tasks) {
    try {
      if (!scopeEl || !scopeEl.querySelectorAll) return '';
      const imgs = scopeEl.querySelectorAll('img');
      if (!imgs.length) return '';
      const parts = [];
      for (let i = 0; i < imgs.length; i++) {
        const imgEl = imgs[i];
        let src = '';
        try { src = String(imgEl.getAttribute('src') || imgEl.src || ''); } catch (e) { src = ''; }
        if (!src) continue;
        if (/^data:/i.test(src)) { parts.push(src); continue; }
        let drawn = false;
        try {
          const sameOrigin = (function () {
            try { return (new URL(src, location.href)).origin === location.origin; } catch (e) { return false; }
          })();
          if (sameOrigin && imgEl.complete && imgEl.naturalWidth > 0) {
            const c = document.createElement('canvas');
            c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight;
            const ctx = c.getContext && c.getContext('2d');
            if (ctx) { ctx.drawImage(imgEl, 0, 0); const d = c.toDataURL('image/png'); if (d && d.length > 20) { parts.push(d); drawn = true; } }
          }
        } catch (e) { drawn = false; }
        if (!drawn && tasks && Array.isArray(tasks)) tasks.push({ el: imgEl, key: key });
      }
      return parts.join('|||');
    } catch (e) { return ''; }
  }

  // 异步补救：跨域或未就绪图片设置 crossOrigin=anonymous 重载后绘制 base64；失败返回空字符串
  function imgToDataURLAsync(imgEl) {
    return new Promise(function (resolve) {
      try {
        const src = String((imgEl && (imgEl.getAttribute('src') || imgEl.src)) || '');
        if (!src || /^data:/i.test(src)) { resolve(''); return; }
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () {
          try {
            if (!im.naturalWidth) { resolve(''); return; }
            const c = document.createElement('canvas');
            c.width = im.naturalWidth; c.height = im.naturalHeight;
            const ctx = c.getContext && c.getContext('2d');
            if (!ctx) { resolve(''); return; }
            ctx.drawImage(im, 0, 0);
            const d = c.toDataURL('image/png');
            resolve((d && d.length > 20) ? d : '');
          } catch (e) { resolve(''); }
        };
        im.onerror = function () { resolve(''); };
        im.src = src;
      } catch (e) { resolve(''); }
    });
  }

  // 按 key 把异步补救结果写回 item 字段：'stemImage' / 'options.<i>.image' / 'materialImages'
  function setItemImgField(item, key, b64) {
    try {
      if (!item || !key || !b64) return false;
      if (key === 'stemImage') { item.stemImage = b64; return true; }
      if (key === 'materialImages') { item.materialImages = b64; return true; }
      const m = /^options\.(\d+)\.image$/.exec(key);
      if (m && Array.isArray(item.options) && item.options[+m[1]]) { item.options[+m[1]].image = b64; return true; }
    } catch (e) { /* ignore */ }
    return false;
  }

  // v0.3.16：资料分析材料板块抓取。root 为小题根，向上定位组 div.ti，
  // 组内 .materials-container > .material-body > .material-content 即材料正文（<p> 段落）。
  // 材料图片按现有 base64 方案转存（key='materialImages'，多图以 '|||' 连接）；无材料时返回空对象，不影响普通题。
  function extractMaterial(root, tasks) {
    try {
      let ti = null;
      if (root && root.closest) ti = root.closest('.ti');
      if (!ti || !ti.querySelector) return { text: '', images: '', tasks: tasks || [] };
      const content = ti.querySelector('.materials-container .material-content') ||
        ti.querySelector('.materials-container .material-body .material-content') ||
        ti.querySelector('.material-content');
      if (!content) return { text: '', images: '', tasks: tasks || [] };
      let text = '';
      // v0.3.25：防材料文字重复。若材料 DOM 存在 p 嵌套 p（或同一段文字被外层 p 与内层 p 各取一次），
      // 直接收集全部 p 会把同一段汉字抓两遍；这里优先取直接子级 p，并对规范化文本去重兜底。
      const seen = {};
      const arr = [];
      function pushP(p) {
        const t = norm(p.innerText || p.textContent);
        if (!t || seen[t]) return;
        seen[t] = 1;
        arr.push(t);
      }
      const directPs = [];
      try {
        for (let i = 0; i < content.children.length; i++) {
          const c = content.children[i];
          if (c && c.tagName && c.tagName.toLowerCase() === 'p') directPs.push(c);
        }
      } catch (e) { /* ignore */ }
      if (directPs.length) {
        directPs.forEach(pushP);
      } else {
        const ps = content.querySelectorAll('p');
        ps.forEach(pushP);
        if (!arr.length) {
          const t = norm(content.innerText || content.textContent);
          if (t) arr.push(t);
        }
      }
      text = arr.join('\n');
      const images = collectImgBase64(content, 'materialImages', tasks);
      return { text: text.slice(0, 12000), images: images, tasks: tasks || [] };
    } catch (e) { return { text: '', images: '', tasks: tasks || [] }; }
  }

  function getQuestion(rootArg) {
    const root = rootArg || firstMatch(document, SEL.questionRoot) || document;
    if (!root) return null;
    const stemEl = firstMatch(root, SEL.stem);
    const stem = stemEl ? stripHTML(stemEl.innerHTML) : '';
    if (!stem) return null;

    const imgTasks = [];
    const stemImage = collectImgBase64(stemEl, 'stemImage', imgTasks);

    // v0.3.16：资料分析小题所在组若有材料板块（.materials-container），一并抓取正文与图片
    const materialInfo = extractMaterial(root, imgTasks);

    const lis = collectOptionEls(root);
    const options = [];
    let yourAnswer = '';
    lis.forEach((li, i) => {
      const letterTxt = norm(textOf(li, ['.input-radio', '.choice-letter', '.option-letter', '.letter', '.choice-index', '.choice-no']));
      const dotLetter = /^[A-Za-z]$/.test(letterTxt.slice(0, 1)) ? letterTxt.slice(0, 1).toUpperCase() : '';
      const letter = dotLetter || optionLetter(i);

      let row = li;
      for (let k = 0; k < 3; k++) {
        if (norm(row.innerText || row.textContent).length > 1) break;
        const up = row.closest('li, .choice-item, .option-item, .choice-radio') || row.parentElement;
        if (!up || up === row) break;
        if (up.querySelectorAll('.input-radio').length > 1) break;
        row = up;
      }

      let label = textOf(row, ['.input-text', '.choice-label', '.option-content', '.choice-content', '.option-text', '.answer-text', 'label']);
      if (!label) {
        let clone = null;
        try { clone = row.cloneNode(true); } catch (e) { clone = null; }
        if (clone) {
          try {
            clone.querySelectorAll('.input-radio, .choice-letter, .option-letter, .letter, .choice-index, .choice-no').forEach(x => { if (x.parentNode) x.parentNode.removeChild(x); });
          } catch (e) { /* ignore */ }
          label = norm(clone.innerText || clone.textContent);
        }
      }
      if (!label) label = norm(row.innerText || row.textContent);
      label = label.replace(/^\s*[A-Za-z]\s*[.、．)）:：]?\s*/, '');
      if (!label) label = norm(row.innerText || row.textContent);

      const cls = ((row.className && row.className.toString()) || '') + ' ' + ((li.className && li.className.toString()) || '');
      let innerCls = '';
      try {
        row.querySelectorAll('.input-radio, .choice-letter, .option-letter').forEach(b => {
          innerCls += ' ' + ((b.className && b.className.toString()) || '');
        });
      } catch (e) { /* ignore */ }
      const clsAll = (cls + ' ' + innerCls).toLowerCase();
      const isCorrect = row.matches(SEL.correctMark.join(',')) ||
        li.matches(SEL.correctMark.join(',')) ||
        !!row.querySelector('.correct, .correctLost, .right, .is-right, .success') ||
        /(^|[\s])(correct|correctlost|right|is-right|success)($|[\s])/.test(clsAll);
      const checked = !!row.querySelector('input:checked') || !!li.querySelector('input:checked') ||
        /(^|[\s])(checked|selected|active|choose|chosen|picked)($|[\s])/.test(clsAll);
      if (checked) yourAnswer += letter;
      options.push({ letter: letter, label: label.slice(0, 300), correct: isCorrect, chosen: checked, image: collectImgBase64(row, 'options.' + options.length + '.image', imgTasks) });
    });

    let correctAnswer = options.filter(o => o.correct).map(o => o.letter).join('');
    if (!correctAnswer) {
      const cBox = firstMatch(document, ['.overall-item-value.correct-answer', '.correct-answer']);
      const cTxt = cBox ? norm(cBox.innerText || cBox.textContent) : '';
      const cm = (cTxt.match(/[A-Ea-e]/g) || []).join('').toUpperCase();
      if (cm) correctAnswer = cm;
      else {
        const m = String((root.innerText || document.body.innerText) || '').match(/正确答案[是为:：]\s*([A-Ea-e][A-Ea-e、,，\s]*)/);
        if (m) correctAnswer = (m[1].match(/[A-Ea-e]/g) || []).join('').toUpperCase();
      }
    }
    if (!yourAnswer) {
      const yBox = firstMatch(document, ['.overall-item-value.your-answer', '.your-answer', '.overall-item-value.wrong-answer']);
      const yTxt = yBox ? norm(yBox.innerText || yBox.textContent) : '';
      const ym = (yTxt.match(/[A-Ea-e]/g) || []).join('').toUpperCase();
      if (ym) yourAnswer = ym;
    }

    const idx = norm(textOf(root, SEL.titleIndex));
    const qid = extractQid(root, stem);
    const keys = questionKeysOf(root);

    return {
      qid: qid,
      qkey: keys.qkey,
      anchorId: keys.anchorId,
      anchorName: keys.anchorName,
      stemHash: hashKey(stem),
      stem: stem.slice(0, 4000),
      source: extractSource(root),
      options: options,
      correctAnswer: correctAnswer,
      yourAnswer: yourAnswer,
      title: idx || stem.slice(0, 40),
      stemImage: stemImage,
      material: materialInfo.text,
      materialImages: materialInfo.images,
      _imgTasks: imgTasks,
      url: (function () { try { return String(location.href); } catch (e) { return ''; } })()
    };
  }

  /* =====================================================
   * 4. 收藏按钮 + 分组选择弹窗
   * ===================================================== */
  /* ---------------- 4.0 分组树（最多四级） ----------------
   * 数据结构：{ id, name, parentId, builtin, updatedAt }；parentId 为空即顶级（第 1 级）。
   * 级别上限 MAX_GROUP_DEPTH = 4，新建子分组时校验，超出直接拒绝。
   * 口径说明：题数统计与筛选均为「含后代」，父分组可一眼看到子分组的题。
   */
  const MAX_GROUP_DEPTH = 4;

  function groupById(id) { return state.groups.find(g => g.id === id) || null; }
  // 层级（1 起，带环检测；异常数据按 1 级处理）
  function groupLevel(g) {
    let lv = 1, cur = g, seen = {};
    while (cur && cur.parentId && !seen[cur.id]) {
      seen[cur.id] = 1;
      cur = groupById(cur.parentId);
      if (!cur) break;
      lv++;
    }
    return lv;
  }
  // 顶级 -> 自身的分组链（面包屑 / 路径文案）
  function groupChain(g) {
    const arr = []; let cur = g, seen = {};
    while (cur && !seen[cur.id]) { seen[cur.id] = 1; arr.unshift(cur); cur = cur.parentId ? groupById(cur.parentId) : null; }
    return arr;
  }
  function groupPathText(g) { return g ? groupChain(g).map(x => x.name).join(' / ') : ''; }
  // 直接子分组
  function childGroups(id) { return state.groups.filter(g => (g.parentId || '') === (id || '')); }
  // 含自身的全部后代 id
  function groupSelfAndDescendants(id) {
    const out = [id]; let i = 0;
    while (i < out.length) {
      const pid = out[i];
      state.groups.forEach(g => { if (g.parentId === pid && out.indexOf(g.id) < 0) out.push(g.id); });
      i++;
    }
    return out;
  }
  function groupItemCount(id) {
    const ids = groupSelfAndDescendants(id);
    return state.items.filter(i => ids.indexOf(i.group) >= 0).length;
  }
  // 迁移 / 自愈：补 parentId；孤儿（父不存在）降为顶级；超深链路回退到顶级，保证最多四级
  function normalizeGroups() {
    const ids = {};
    state.groups.forEach(g => { if (g && g.id) ids[g.id] = g; });
    state.groups.forEach(g => {
      if (!g || !g.id) return;
      if (!('parentId' in g)) g.parentId = null;
      if (g.parentId && (!ids[g.parentId] || g.parentId === g.id)) g.parentId = null;
    });
    state.groups.forEach(g => { if (g.parentId && groupLevel(g) > MAX_GROUP_DEPTH) g.parentId = null; });
  }

  /* ---------------- v0.3.30 分组树拖拽（跨层级移动 + 同级排序） ----------------
   * 交互约定：分组行可整体拖动（光标为 grab）。
   *   拖到某行的上 / 下 1/3   → 插入为该行的前 / 后兄弟（同级排序，父级不变）；
   *   拖到某行的中间 1/3     → 成为该行的子分组（跨层级移动，受 MAX_GROUP_DEPTH 限制）；
   *   拖到「全部」行或树空白处 → 移到根级末尾。
   * 拖拽中行位置以蓝线（前/后）或蓝框（成为子分组）提示；拖到自己或自己的后代、层级超限时拒绝。
   * 落盘逻辑与重命名 / 新建一致：persist + renderNotebook + scheduleUpload（WebDAV 合并按 updatedAt 取新）。
   */
  let dragGid = '';              // 正在拖拽的分组 id（模块级，跨行 / 容器共享）
  const DRAG_MID_RATIO = 0.34;   // 行内上下 1/3 为同级前后，中间 1/3 为成为子分组

  // 一组 id 中的最大层级（用于拖拽后子树是否会超深）
  function groupMaxLevel(ids) {
    let max = 0;
    ids.forEach(id => { const g = groupById(id); if (g) max = Math.max(max, groupLevel(g)); });
    return max;
  }
  // 清空树内所有拖拽指示标记（before / after / inside / 禁止）
  function clearGroupDropMarks(root) {
    if (!root) return;
    root.querySelectorAll('.fb-mk-kp-row.fb-mk-drop-top,.fb-mk-kp-row.fb-mk-drop-bottom,.fb-mk-kp-row.fb-mk-drop-inside,.fb-mk-kp-row.fb-mk-drop-no')
      .forEach(r => r.classList.remove('fb-mk-drop-top', 'fb-mk-drop-bottom', 'fb-mk-drop-inside', 'fb-mk-drop-no'));
    if (root.classList) root.classList.remove('fb-mk-drop-root');
  }
  // 校验拖拽目标是否合法：不能拖到自己 / 自己后代；成为子分组时不能超过 MAX_GROUP_DEPTH；
  // targetId 为空表示根级末尾（总是合法）
  function groupDropValid(srcId, mode, targetId) {
    const src = groupById(srcId);
    if (!src) return false;
    if (!targetId) return true;
    const t = groupById(targetId);
    if (!t) return false;
    const moveIds = groupSelfAndDescendants(srcId);
    if (moveIds.indexOf(targetId) >= 0) return false;   // 拖到自己或自己的后代里
    if (mode !== 'inside') return true;                 // 同级前 / 后：父级不变，无层级风险
    if (groupLevel(t) >= MAX_GROUP_DEPTH) return false; // 目标已是最深一级
    const srcLv = groupLevel(src), tgtLv = groupLevel(t);
    if (groupMaxLevel(moveIds) + (tgtLv + 1 - srcLv) > MAX_GROUP_DEPTH) return false; // 整棵子树会超深
    return true;
  }
  // 执行拖拽落盘：把 srcId 整棵子树（含后代）移到目标位，返回是否成功
  // mode: 'before' | 'after'（targetId 的兄弟前后，parentId 跟随 target 的 parentId）
  //       'inside'（targetId 的直接子分组，插到其现有子分组最后；targetId 为空 = 根级末尾）
  function applyGroupDrop(srcId, mode, targetId) {
    const src = groupById(srcId);
    if (!src || !groupDropValid(srcId, mode, targetId)) return false;
    const moveIds = groupSelfAndDescendants(srcId);
    const moved = state.groups.filter(g => moveIds.indexOf(g.id) >= 0);
    const rest = state.groups.filter(g => moveIds.indexOf(g.id) < 0);
    const t = targetId ? groupById(targetId) : null;
    // 1) 改父子关系：inside → 挂到 target；before / after → 跟随 target 的父级；根级 → 顶级
    if (mode === 'inside') src.parentId = targetId || null;
    else src.parentId = t ? (t.parentId || null) : null;
    src.updatedAt = Date.now();
    // 2) 定位插入点（rest 中保持其它节点原有相对顺序）
    let at;
    if (!targetId) {                     // 根级末尾
      at = rest.length;
    } else if (mode === 'inside') {      // target 的最后一个直接子分组之后
      const kids = rest.filter(g => (g.parentId || '') === targetId);
      const lastKid = kids.length ? kids[kids.length - 1] : null;
      at = lastKid ? rest.indexOf(lastKid) + 1 : rest.indexOf(t) + 1;
    } else if (mode === 'before') {      // target 之前
      at = rest.indexOf(t);
      if (at < 0) at = rest.length;
    } else {                             // after：target 之后
      at = rest.indexOf(t) + 1;
    }
    rest.splice(at, 0, ...moved);
    state.groups = rest;
    return true;
  }
  // 拖拽落盘的统一收尾：持久化 + 重渲染 + WebDAV 同步
  function commitGroupDrag(msg) {
    persist();
    if (renderNotebook) renderNotebook();
    scheduleUpload();
    if (msg) toast(msg);
  }


  // 兜底分组：默认「知识盲区」，若该分组已被删除则退回当前存在的第一个分组
  function fallbackGroupId() {
    if (groupById('blind')) return 'blind';
    return (state.groups[0] && state.groups[0].id) || 'blind';
  }

  /* 分组结构变更（重命名 / 新建子分组 / 删除）统一收尾：落盘 + 刷新错题本页面 + 触发 WebDAV 同步 */
  function commitGroupChange(msg) {
    persist();
    if (renderNotebook) renderNotebook();
    scheduleUpload();
    if (msg) toast(msg);
  }

  // 新建分组（收藏弹窗与分类编辑弹窗共用）：同级不允许同名，深度不超过 MAX_GROUP_DEPTH
  function createGroup(name, parentId) {
    const nm = norm(name);
    if (!nm) return { ok: false, msg: '请先填分组名称' };
    if (nm.length > 30) return { ok: false, msg: '分组名称请控制在 30 个字以内' };
    const pid = parentId || null;
    const p = pid ? groupById(pid) : null;
    if (pid && !p) return { ok: false, msg: '上级分组不存在（可能已被删除）' };
    if (p && groupLevel(p) >= MAX_GROUP_DEPTH) return { ok: false, msg: '最多支持 ' + MAX_GROUP_DEPTH + ' 级分组，该分组已到最深一级' };
    const dup = childGroups(pid).find(g => norm(g.name) === nm);
    if (dup) return { ok: false, dup: dup.id, msg: '同级已有同名分组：' + groupPathText(dup) };
    const gid = 'g' + uid();
    state.groups.push({ id: gid, name: nm, parentId: pid, builtin: false, updatedAt: Date.now() });
    return { ok: true, id: gid, name: nm };
  }

  // 重命名分组：只改名称，id / parentId 不变，题目归属与同步关系不受影响
  function renameGroup(id, name) {
    const g = groupById(id);
    if (!g) return { ok: false, msg: '分组不存在（可能已被删除）' };
    const nm = norm(name);
    if (!nm) return { ok: false, msg: '名称不能为空' };
    if (nm.length > 30) return { ok: false, msg: '分组名称请控制在 30 个字以内' };
    if (nm === g.name) return { ok: true, name: nm, unchanged: true };
    const dup = childGroups(g.parentId || null).find(x => x.id !== g.id && norm(x.name) === nm);
    if (dup) return { ok: false, msg: '同级已有同名分组：' + groupPathText(dup) };
    g.name = nm; g.updatedAt = Date.now();
    return { ok: true, name: nm };
  }

  // 删除影响评估：将被移除的分组数（含子分组）、会被重新挂载的题数、以及删除后的落点分组
  function groupDeleteInfo(id) {
    const g = groupById(id);
    const ids = g ? groupSelfAndDescendants(id) : [id];
    const parent = (g && g.parentId) ? groupById(g.parentId) : null;
    const moved = state.items.filter(it => ids.indexOf(it.group) >= 0).length;
    const rest = state.groups.length - ids.length;
    const target = parent ? ('「' + parent.name + '」') : '未分组';
    return {
      removed: ids.length,
      moved: moved,
      rest: rest,
      allowed: rest >= 1,
      targetName: parent ? parent.name : '',
      tip: '删除后本机与其它设备上的该分类都会消失（不可恢复）；组内错题不会被删除' + (moved ? '，其中 ' + moved + ' 道题会移到' + target : ''),
      confirm: (ids.length > 1 ? '将同时删除 ' + (ids.length - 1) + ' 个子分类；' : '') + (moved ? moved + ' 道错题将移到' + target + '。' : '')
    };
  }

  /* 删除分组（含其全部子分组）：错题保留，改挂到最近存活的上层分组，无上层则转为未分组；
     被删分组 id 写入删除墓碑（与题目删除同一套墓碑机制），WebDAV 拉取时不会把已删分组从远端复活 */
  function deleteGroup(id) {
    const g = groupById(id);
    if (!g) return { ok: false, msg: '分组不存在（可能已被删除）' };
    const ids = groupSelfAndDescendants(id);
    if (state.groups.length - ids.length < 1) return { ok: false, msg: '至少要保留一个分组，不能全部删完' };
    const parent = g.parentId ? groupById(g.parentId) : null;
    const fallbackId = parent ? parent.id : '';
    const now = Date.now();
    let moved = 0;
    state.items.forEach(it => {
      if (ids.indexOf(it.group) >= 0) { it.group = fallbackId; it.updatedAt = now; moved++; }
    });
    state.groups = state.groups.filter(x => ids.indexOf(x.id) < 0);
    ids.forEach(x => { state.deleted[x] = now; });
    trimTombstones();
    return { ok: true, name: g.name, removed: ids.length, moved: moved, fallbackId: fallbackId, fallbackName: parent ? groupPathText(parent) : '' };
  }

  function isSaved(q) { return !!(q && q.qid && findItemByQid(q.qid)); }

  function saveItem(q, groupId) {
    if (!q || !q.qid) { toast('抓取题目失败：没拿到题号，请刷新页面后重试'); return false; }
    if (isSaved(q)) { toast('这道题已经在错题本里了'); return false; }
    const imgTasks = (q && Array.isArray(q._imgTasks)) ? q._imgTasks : [];
    state.items.unshift({
      id: q.qid, qid: q.qid, group: groupId || fallbackGroupId(),
      stem: q.stem, options: q.options,
      correctAnswer: q.correctAnswer, yourAnswer: q.yourAnswer,
      title: q.title, stemHash: q.stemHash,
      qkey: q.qkey, anchorId: q.anchorId, anchorName: q.anchorName,
      source: q.source || '',
      note: '', // v0.3.18：每题笔记（随 JSON 导出/导入、WebDAV 同步、mergeDocs 合并天然携带）
      stemImage: q.stemImage || '',
      material: q.material || '',
      materialImages: q.materialImages || '',
      url: q.url, createdAt: Date.now(), updatedAt: Date.now()
    });
    delete state.deleted[q.qid];
    persist(); refreshBadge(); refreshFavButtons(); if (renderNotebook) renderNotebook();
    scheduleUpload();
    // v0.3.16：未同步转好的图片（跨域/未加载）异步补救，失败兜底为空并提示，不阻塞收藏流程
    if (imgTasks.length) {
      const savedItem = state.items[0];
      let done = 0, fail = 0;
      imgTasks.forEach(t => {
        if (!t || !t.el) { done++; return; }
        imgToDataURLAsync(t.el).then(b64 => {
          done++;
          if (b64 && state.items.indexOf(savedItem) >= 0 && setItemImgField(savedItem, t.key, b64)) {
            persist(); if (renderNotebook) renderNotebook();
          } else {
            fail++;
            if (done === imgTasks.length && fail > 0) toast('部分题目图片未能转换为 base64，已跳过（不影响收藏）', 3600);
          }
        });
      });
    }
    const g = groupById(groupId || fallbackGroupId());
    toast('已加入错题本：' + (g ? groupPathText(g) : '未分组') + '（共 ' + state.items.length + ' 道题）');
    return true;
  }

  /* ---------------- 「打开原题」→ 定位到该题的题号 ----------------
   * 实测（spa.fenbi.com）：背题 / 解析页把整卷题目一次性渲染在同一页，URL 只有
   * routecs / examcatid 这类渠道参数，不带题号（index= 之类参数无效，加 hash 又可能与
   * 页面的 hash 路由 #/mistakes 冲突）。页面自身切题靠 JS 平滑滚动到该题偏移。
   * 因此这里的做法是：点「打开原题」时把目标题的稳定标识写进一条「待定位记录」，
   * 再跳转；落地页由本脚本轮询找到该题并滚动过去 + 高亮，可容忍 Angular 晚渲染。
   * 定位键优先级：data-question-key > 标题 id > 锚点 name > 题干指纹 > 题号文本。
   */
  const JUMP_TTL = 5 * 60 * 1000;    // 待定位记录有效期，超时视为过期
  function normTitle(t) { return norm(String(t == null ? '' : t)).replace(/[.．、:：\s]/g, ''); }

  function jumpSave(rec) {
    try { localStorage.setItem(JUMP_KEY, JSON.stringify(rec)); } catch (e) { /* ignore */ }
  }
  function jumpTake() {
    let rec = null;
    try {
      const raw = localStorage.getItem(JUMP_KEY);
      if (raw) { try { localStorage.removeItem(JUMP_KEY); } catch (e) { /* ignore */ } rec = JSON.parse(raw); }
    } catch (e) { rec = null; }
    if (!rec || !rec.ts || (Date.now() - rec.ts) > JUMP_TTL) return null;
    return rec;
  }
  function questionRoots() {
    const out = [];
    try {
      const nodes = document.querySelectorAll(SEL.questionRoot.join(','));
      for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
    } catch (e) { /* ignore */ }
    return out;
  }
  function toQuestionRoot(el) {
    if (!el) return null;
    try { return (el.closest && el.closest('.questions-single-container')) || el; } catch (e) { return el; }
  }
  // 打开原题时的落点 URL：剥掉错题本自身的 hash 路由，避免落地又停在错题本上
  function jumpTargetUrl(url) {
    return norm(String(url == null ? '' : url)).replace(/#\/mistakes\b.*$/i, '');
  }
  function findQuestionByRec(rec) {
    if (!rec) return null;
    const roots = questionRoots();
    if (rec.qkey) {
      try {
        const ti = document.querySelector('app-ti[data-question-key="' + rec.qkey + '"]');
        if (ti) return toQuestionRoot(ti);
      } catch (e) { /* ignore */ }
    }
    if (rec.anchorId) {
      const el = document.getElementById(rec.anchorId);
      if (el) return toQuestionRoot(el);
    }
    if (rec.anchorName) {
      try { const a = document.getElementsByName(rec.anchorName)[0]; if (a) return toQuestionRoot(a); } catch (e) { /* ignore */ }
    }
    if (rec.stemHash) {
      for (let i = 0; i < roots.length; i++) {
        const el = firstMatch(roots[i], SEL.stem);
        const txt = el ? norm(el.innerText || el.textContent) : '';
        if (txt && hashKey(txt) === rec.stemHash) return roots[i];
      }
    }
    const want = normTitle(rec.title);
    if (want) {
      for (let i = 0; i < roots.length; i++) {
        if (normTitle(norm(textOf(roots[i], SEL.titleIndex))) === want) return roots[i];
      }
    }
    return null;
  }
  let jumpTimer = null;
  function jumpToEl(el) {
    try {
      if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else {
        const y = el.getBoundingClientRect().top + (window.pageYOffset || 0) - 90;
        window.scrollTo(0, Math.max(0, y));
      }
    } catch (e) { /* ignore */ }
    // 平滑滚动可能被页面自身渲染 / 定位打断，稍后再校正一次
    setTimeout(() => {
      try {
        const y = el.getBoundingClientRect().top + (window.pageYOffset || 0) - 90;
        if (Math.abs(y) > 4) window.scrollTo(0, Math.max(0, y));
      } catch (e) { /* ignore */ }
    }, 450);
    try {
      el.classList.add('fb-mk-jump-hl');
      setTimeout(() => { try { el.classList.remove('fb-mk-jump-hl'); } catch (e) { /* ignore */ } }, 3200);
    } catch (e) { /* ignore */ }
  }
  // 轮询等待题目渲染（Angular 晚于首帧），找到即滚动定位
  function tryPendingJump() {
    const rec = jumpTake();
    if (!rec) return false;
    let tries = 0;
    if (jumpTimer) { clearInterval(jumpTimer); jumpTimer = null; }
    const step = () => {
      tries++;
      const el = findQuestionByRec(rec);
      if (el) {
        if (jumpTimer) { clearInterval(jumpTimer); jumpTimer = null; }
        jumpToEl(el);
        toast('已定位到' + (normTitle(rec.title) ? ('第 ' + normTitle(rec.title) + ' 题') : '该题'));
        return;
      }
      if (tries >= 40) {
        if (jumpTimer) { clearInterval(jumpTimer); jumpTimer = null; }
        toast('未能定位到该题（题号 ' + (normTitle(rec.title) || '-') + '）：题目可能已下架或页面结构变化');
      }
    };
    step();
    if (!jumpTimer) jumpTimer = setInterval(step, 400);
    return true;
  }

  let pickerEl = null;
  function closePicker() { if (pickerEl && pickerEl.parentNode) pickerEl.parentNode.removeChild(pickerEl); pickerEl = null; }

  /* 底部抽屉式分组选择器
   * 参照 sheet-preview demo：mask + 底部 sheet（62% 高），两列树、按层级缩进、名称 + 计数，
   * 点击分组名即收藏到该分组；点行内「+」把该分组设为当前节点，可在其下新建子分组。
   */
  function openPicker(q) {
    closePicker();
    let parentId = null;   // 当前选中节点（底部「新建子分组」的挂载点）
    const mask = document.createElement('div');
    mask.className = 'fb-mk-mask fb-mk-mask-sheet';
    const sheet = document.createElement('div');
    sheet.className = 'fb-mk-sheet';
    sheet.appendChild(mkEl('div', 'fb-mk-handle'));

    const head = document.createElement('div');
    head.className = 'fb-mk-sheet-head';
    const titleRow = document.createElement('div');
    titleRow.className = 'fb-mk-sheet-title-row';
    titleRow.appendChild(mkEl('div', 'fb-mk-sheet-title', isSaved(q) ? '已在错题本（可换分组）' : '收藏到哪个分组？'));
    const closeBtn = mkEl('button', 'fb-mk-gbtn fb-mk-sheet-close', '取消');
    closeBtn.addEventListener('click', closePicker);
    titleRow.appendChild(closeBtn);
    head.appendChild(titleRow);
    const stem = norm(q && q.stem ? q.stem : '') || '(题干缺失)';
    head.appendChild(mkEl('div', 'fb-mk-sheet-stem', stem.length > 90 ? stem.slice(0, 90) + '…' : stem));
    head.appendChild(mkEl('div', 'fb-mk-sheet-tip', '点分组名 = 收藏到该分组；点右侧「+」选中为当前节点，可在其下新建子分组（最多 ' + MAX_GROUP_DEPTH + ' 级）'));
    sheet.appendChild(head);

    const tree = document.createElement('div');
    tree.className = 'fb-mk-tree';
    const colL = mkEl('div', 'fb-mk-col'), colR = mkEl('div', 'fb-mk-col');
    tree.appendChild(colL); tree.appendChild(colR);
    sheet.appendChild(tree);

    const addRow = document.createElement('div');
    addRow.className = 'fb-mk-addbar';
    const inp = document.createElement('input');
    inp.className = 'fb-mk-input';
    const addBtn = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-main', '新建并收藏');
    addRow.appendChild(inp); addRow.appendChild(addBtn);
    sheet.appendChild(addRow);

    if (isSaved(q)) {
      const foot = document.createElement('div');
      foot.className = 'fb-mk-sheet-foot';
      const delBtn = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-danger', '从错题本移除');
      delBtn.addEventListener('click', () => { removeItem(q.qid); closePicker(); });
      foot.appendChild(delBtn);
      sheet.appendChild(foot);
    }

    function renderGroupNodes(nodes, depth, parent) {
      nodes.forEach(g => {
        const kids = childGroups(g.id);
        const row = document.createElement('div');
        row.className = 'fb-mk-node' + (parentId === g.id ? ' on' : '');
        row.style.paddingLeft = (10 + depth * 14) + 'px';
        row.appendChild(mkEl('span', 'fb-mk-node-arrow', kids.length ? '▼' : '·'));
        row.appendChild(mkEl('span', 'fb-mk-node-name', g.name));
        row.appendChild(mkEl('span', 'fb-mk-node-count', String(groupItemCount(g.id))));
        if (kids.length) {
          const sub = mkEl('span', 'fb-mk-node-sub', kids.length + ' 子');
          row.appendChild(sub);
        }
        if (groupLevel(g) < MAX_GROUP_DEPTH) {
          const plus = mkEl('span', 'fb-mk-node-add', '+');
          plus.title = '选中它，可在其下新建子分组';
          plus.addEventListener('click', ev => {
            try { ev.stopPropagation(); } catch (e) { /* ignore */ }
            parentId = (parentId === g.id) ? null : g.id;
            refreshTree();
            if (parentId) setTimeout(() => { try { inp.focus(); } catch (e) { /* ignore */ } }, 0);
          });
          row.appendChild(plus);
        }
        row.addEventListener('click', () => { commitPick(q, g.id); });
        parent.appendChild(row);
        if (kids.length) renderGroupNodes(kids, depth + 1, parent);
      });
    }

    function refreshTree() {
      colL.innerHTML = ''; colR.innerHTML = '';
      const roots = state.groups.filter(g => !g.parentId);
      const half = Math.ceil(roots.length / 2);
      renderGroupNodes(roots.slice(0, half), 0, colL);
      renderGroupNodes(roots.slice(half), 0, colR);
      const p = parentId ? groupById(parentId) : null;
      if (p && groupLevel(p) >= MAX_GROUP_DEPTH) {
        inp.disabled = true; addBtn.disabled = true;
        inp.placeholder = '「' + p.name + '」已是第 ' + MAX_GROUP_DEPTH + ' 级，不能再建子分组';
      } else {
        inp.disabled = false; addBtn.disabled = false;
        inp.placeholder = p ? ('+ 在「' + p.name + '」下新建子分组') : '+ 新建顶级分组，例如：立体几何';
      }
    }

    addBtn.addEventListener('click', () => {
      const res = createGroup(inp.value, parentId);
      if (!res.ok) {
        if (res.dup) { toast('同级已有同名分组，直接收藏到「' + groupPathText(groupById(res.dup)) + '」'); commitPick(q, res.dup); return; }
        toast(res.msg); return;
      }
      commitPick(q, res.id);
    });
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { try { ev.preventDefault(); } catch (e) { /* ignore */ } addBtn.click(); } });

    refreshTree();
    mask.appendChild(sheet);
    mask.addEventListener('click', e => { if (e.target === mask) closePicker(); });
    document.body.appendChild(mask);
    pickerEl = mask;
  }

  function commitPick(q, gid) {
    if (isSaved(q)) {
      const it = findItemByQid(q.qid);
      it.group = gid; it.updatedAt = Date.now();
      persist(); refreshBadge(); if (renderNotebook) renderNotebook(); scheduleUpload();
      const g = groupById(gid);
      toast('已改为分组：' + (g ? groupPathText(g) : gid));
    } else {
      saveItem(q, gid);
    }
    closePicker();
  }

  function removeItem(id) {
    let changed = false;
    const rest = [];
    state.items.forEach(i => {
      const key = i.id || i.qid;
      if (key === id || i.qid === id) { changed = true; markDeleted(key); } else rest.push(i);
    });
    if (!changed) return false;
    state.items = rest;
    persist(); refreshBadge(); refreshFavButtons(); if (renderNotebook) renderNotebook(); scheduleUpload();
    toast('已从错题本移除（共 ' + state.items.length + ' 道题）');
    return true;
  }

  /* v0.3.18：删除二次确认——弹层明确展示将删除该题，确认才执行 removeItem，取消则关闭不删 */
  function askRemoveItem(it) {
    const key = it.id || it.qid;
    const oldMask = document.querySelector('.fb-mk-mask.fb-mk-del');
    if (oldMask && oldMask.parentNode) oldMask.parentNode.removeChild(oldMask);
    const mask = document.createElement('div');
    mask.className = 'fb-mk-mask fb-mk-del';
    const card = document.createElement('div');
    card.className = 'fb-mk-card';
    card.appendChild(mkEl('div', 'fb-mk-title', '删除错题'));
    const stemShort = String(it.stem || '(题干缺失)');
    card.appendChild(mkEl('div', 'fb-mk-tip', '确定删除这道错题吗？删除后本机与其它设备同步后都会移除，且不可恢复。'));
    card.appendChild(mkEl('div', 'fb-mk-tip', '题目：' + stemShort.slice(0, 80) + (stemShort.length > 80 ? '…' : '')));
    const btns = document.createElement('div');
    btns.className = 'fb-mk-item-acts';
    const cancel = mkEl('button', 'fb-mk-gbtn', '取消');
    cancel.addEventListener('click', () => { if (mask.parentNode) mask.parentNode.removeChild(mask); });
    const yes = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-danger', '确认删除');
    yes.addEventListener('click', () => {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      removeItem(key);
    });
    btns.appendChild(cancel); btns.appendChild(yes);
    card.appendChild(btns);
    mask.appendChild(card);
    document.body.appendChild(mask);
    return mask;
  }

  function favButtonHtml() {
    return '收藏错题';
  }
  function questionRoots() {
    const out = [];
    let stems = [];
    try { stems = Array.prototype.slice.call(document.querySelectorAll(SEL.stem.join(','))); } catch (e) { stems = []; }
    stems.forEach(function (n) {
      const r = n.closest('.questions-single-container, .question-choice-container, app-question-choice') || n.parentElement;
      if (r && out.indexOf(r) < 0) out.push(r);
    });
    if (out.length) return out;
    try { return Array.prototype.slice.call(document.querySelectorAll(SEL.questionRoot.join(','))); } catch (e) { return []; }
  }

  /* 题目标题盒子：div.title#title-0-x-0（内含 .title-left 与 ul.title-right） */
  function favTitleBox(root) {
    if (!root) return null;
    if (root.classList && root.classList.contains('title')) return root;
    if (!root.querySelector) return null;
    let t = null;
    try { t = root.querySelector('.title[id^="title-"]'); } catch (e) { t = null; }
    if (!t) { try { t = root.querySelector('.title'); } catch (e) { t = null; } }
    return t;
  }
  /* 按钮挂进题目最大盒子 .ti 里，靠绝对定位停在盒子外部左上角：
     按钮 right 边贴 .ti 左边缘、top 边与 .ti 顶边齐平 => 按钮右上角与 .ti 左上角重合。
     v0.3.16：资料分析组（.ti 内含 .materials-container）= 1 材料 + 5 小题，
     若仍挂在组 .ti 顶，5 个按钮会绝对定位到同一点完全重叠；
     故此类组内按钮宿主/定位锚点改取每个小题自己的容器（app-ti / .questions-container），每题一按钮、各归其位。 */
  function favHostBox(root, anchor) {
    let host = null;
    if (anchor && anchor.closest) host = anchor.closest('.ti');
    if (!host && anchor && anchor.classList && anchor.classList.contains('ti')) host = anchor;
    if (!host && root) {
      host = (root.classList && root.classList.contains('ti')) ? root
        : (root.closest ? root.closest('.ti') : null);
    }
    if (host && host.querySelector && host.querySelector('.materials-container')) {
      let sub = null;
      if (anchor && anchor.closest) sub = anchor.closest('app-ti, .questions-container') || null;
      if (!sub && root && root.closest) sub = root.closest('app-ti, .questions-container') || null;
      if (!sub && anchor && anchor.closest) sub = anchor.closest('app-question-choice') || null;
      if (!sub && root && root.closest) sub = root.closest('app-question-choice') || null;
      if (sub && sub !== host) host = sub;
    }
    return host || anchor || root;
  }
  function placeFavInTitleBox(el, root, anchor) {
    const host = favHostBox(root, anchor);
    if (!host) return;
    if (el.parentNode !== host || host.firstElementChild !== el) {
      host.insertBefore(el, host.firstElementChild);
    }
    /* 若宿主原本是 static，补一层相对定位，保证按钮以该盒子为定位参照 */
    try {
      const cs = window.getComputedStyle(host);
      if (cs && cs.position === 'static' && host.classList) host.classList.add('fb-mk-ti-host');
    } catch (e) { /* ignore */ }
    /* v0.3.17：资料分析小题宿主（组 .ti 内的 app-ti/.questions-container）改流内样式。
       absolute right:100% 会把按钮顶到小题容器左侧外部，被 .questions-container/app-resizable
       等祖先 overflow 裁剪 → 按钮完全消失；流内内嵌则始终位于小题容器顶部、可见可点。
       普通题宿主仍是 .ti 本身（绝对定位贴 .ti 左上角），维持原行为不变。 */
    let groupTi = null;
    try { groupTi = host.closest ? host.closest('.ti') : null; } catch (e) { groupTi = null; }
    const isSubHost = !!(groupTi && groupTi !== host && groupTi.querySelector && groupTi.querySelector('.materials-container'));
    if (el.classList) {
      if (isSubHost) el.classList.add('fb-mk-fav-standalone');
      else el.classList.remove('fb-mk-fav-standalone');
    }
    if (isSubHost && host.classList) host.classList.add('fb-mk-ti-host');
  }

  let lastRootsSig = '';
  function injectFavButton() {
    // v0.3.11 性能修复：题目根集合未变化时跳过全量注入（站点其它 DOM 变动不再反复遍历/搬移整页题目）
    const roots = questionRoots();
    let sig = '';
    try {
      const first = roots[0];
      const last = roots.length ? roots[roots.length - 1] : null;
      sig = roots.length + '|' +
        (first ? String((first.getAttribute && first.getAttribute('data-question-key')) || '') : '') + '|' +
        (last ? String((last.getAttribute && last.getAttribute('data-question-key')) || '') : '');
    } catch (e) { /* ignore */ }
    if (sig && sig === lastRootsSig) {
      /* v0.3.17：快速路径只跳过「全量重注」；若某题根的按钮已被站点重渲染清掉，仍需补注 */
      let allInjected = true;
      for (let i = 0; i < roots.length; i++) {
        const h = favHostBox(roots[i], favTitleBox(roots[i]));
        if (!h || !h.querySelector('.fb-mk-fav')) { allInjected = false; break; }
      }
      if (allInjected) {
        refreshFavButtons();
        return;
      }
    }
    lastRootsSig = sig;
    const rows = [];
    roots.forEach(function (root) {
      const anchor = favTitleBox(root);
      /* v0.3.17：按钮宿主可能被降级到 root 的祖先（资料分析小题 app-ti），
         root.querySelector 找不到已注入按钮会造成重复注入；改从宿主范围查找 */
      const host = favHostBox(root, anchor);
      let wrap = host ? host.querySelector('.fb-mk-fav') : null;
      if (!wrap) {
        const el = document.createElement('div');
        el.className = 'fb-mk-fav';
        const inner = document.createElement('button');
        inner.className = 'fb-mk-fav-btn';
        inner.textContent = favButtonHtml();
        inner.addEventListener('click', function (e) {
          try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* ignore */ }
          injectFavButton();
          const q = getQuestion(root);
          if (!q) { toast('没识别到当前题目，请确认已打开题目详情'); return; }
          if (wrap.dataset.qid && wrap.dataset.stem === q.stemHash) q.qid = wrap.dataset.qid;
          if (isSaved(q)) { toast('已收藏，可在错题本中调整分组'); }
          openPicker(q);
        });
        el.appendChild(inner);
        placeFavInTitleBox(el, root, anchor);
        wrap = el;
      } else {
        /* 旧版可能挂在 ul.title-right 里：改造成独立元素并搬进标题盒子内最前面 */
        if (wrap.tagName === 'LI') {
          const d = document.createElement('div');
          d.className = 'fb-mk-fav';
          if (wrap.dataset) {
            if (wrap.dataset.qid) d.dataset.qid = wrap.dataset.qid;
            if (wrap.dataset.stem) d.dataset.stem = wrap.dataset.stem;
          }
          while (wrap.firstChild) d.appendChild(wrap.firstChild);
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          wrap = d;
        }
        placeFavInTitleBox(wrap, root, anchor);
      }
      rows.push({ root: root, wrap: wrap, q: null });
    });

    rows.forEach(function (r) { r.q = getQuestion(r.root); });
    rows.forEach(function (r) {
      const h = r.q ? r.q.stemHash : '';
      if (h && r.wrap.dataset.stem !== h) { r.wrap.dataset.stem = h; r.wrap.dataset.qid = ''; }
    });
    const pool = {};
    rows.forEach(function (r) {
      const id = r.wrap.dataset.qid || (r.q && r.q.qid) || '';
      if (id) pool[id] = (pool[id] || 0) + 1;
    });
    rows.forEach(function (r) {
      if (!r.q || !r.q.qid) return;
      let qid = r.q.qid;
      if ((pool[qid] || 0) > 1) qid = r.q.stemHash || qid;
      if (r.wrap.dataset.qid !== qid) r.wrap.dataset.qid = qid;
    });
    refreshFavButtons();
  }
  function refreshFavButtons() {
    const btns = document.querySelectorAll('.fb-mk-fav-btn');
    if (!btns.length) return;
    btns.forEach(function (b) {
      const wrap = b.closest ? b.closest('.fb-mk-fav') : b.parentNode;
      const qid = (wrap && wrap.dataset) ? wrap.dataset.qid : '';
      const txt = (qid && findItemByQid(qid)) ? '已收藏 · 改分组' : favButtonHtml();
      if (b.textContent !== txt) b.textContent = txt;
    });
  }
  function qidProbe() {
    return questionRoots().map(function (r) {
      const q = getQuestion(r);
      /* v0.3.17：按钮宿主可能被降级到 root 的祖先（资料分析小题 app-ti），统一从宿主范围找 */
      const w = (favHostBox(r, favTitleBox(r)) || r).querySelector('.fb-mk-fav');
      return { qid: q && q.qid, stemHash: q && q.stemHash, domQid: w ? (w.dataset.qid || '') : '(未注入)', stem: q ? q.stem.slice(0, 60) : '' };
    });
  }
  function favDiag() {
    const out = [];
    document.querySelectorAll('.fb-mk-fav').forEach(function (w, i) {
      const b = w.querySelector('.fb-mk-fav-btn');
      const qid = w.dataset.qid || '';
      const host = w.parentNode;
      const hostIsTi = !!(host && host.classList && host.classList.contains('ti'));
      const hostPos = (host && window.getComputedStyle) ? window.getComputedStyle(host).position : '';
      const hostOv = (host && window.getComputedStyle) ? window.getComputedStyle(host).overflow : '';
      let gapRight = null, gapTop = null;
      if (host && w.getBoundingClientRect) {
        const hr = host.getBoundingClientRect(), wr = w.getBoundingClientRect();
        gapRight = Math.round((hr.left - wr.right) * 10) / 10;   /* 期望 0：按钮右边缘贴盒子左边缘 */
        gapTop = Math.round((wr.top - hr.top) * 10) / 10;        /* 期望 0：按钮上边缘与盒子顶边齐平 */
      }
      out.push({
        index: i, qid: qid, stem: w.dataset.stem || '', text: b ? b.textContent : '',
        saved: !!(qid && findItemByQid(qid)),
        tag: w.tagName,
        parent: host ? (host.tagName + '.' + String(host.className || '').split(' ')[0]) : '',
        parentIsTiBox: hostIsTi,
        hostPosition: hostPos,
        hostOverflow: hostOv,
        isFirstChild: !!(host && host.firstElementChild === w),
        gapRight: gapRight,
        gapTop: gapTop
      });
    });
    return out;
  }

  function optionProbe() {
    const root = firstMatch(document, SEL.questionRoot) || questionRoots()[0] || document;
    const q = getQuestion(root);
    const rows = collectOptionEls(root);
    return {
      rootTag: root && root.tagName,
      rootCls: String((root && root.className) || ''),
      optionCount: rows.length,
      options: rows.map(function (r) {
        return { tag: r.tagName, cls: String(r.className || ''), text: norm(r.innerText || r.textContent).slice(0, 120) };
      }),
      parsed: q ? q.options : null
    };
  }


  /* =====================================================
   * 5. 错题本页