// ==UserScript==
// @name         粉笔错题本（分级收藏 + 笔记 + WebDAV 同步）
// @namespace    local.fenbi.mistakes
// @version      1.0.16
// @description  粉笔网页版一键收藏题目，按自定义错误原因分组，本地缓存 + WebDAV 同步（ETag 乐观锁 / 冲突自动重试 / 连接诊断），独立错题本页面（#/mistakes）；收藏分组支持最多四级树形（可新建子分组），错题本页面「显示收藏分类」移植粉笔官网错题本分类样式（白底卡片内纵向堆叠单行 flex 节点：箭头方块 + 分类名 + 题数 + 「⋯」编辑按钮，子分组缩进，点箭头方块展开 / 收起下级，点分类名筛选该分组含全部子分组的题，激活分组蓝色高亮）；支持导入/导出 JSON 文件（导入分「替换」与「合并」两种模式，均二次确认、覆盖前自动本地备份，导出不含 WebDAV 密码），点「返回刷题」跳转到刷题指南；v1.0.8：显示/隐藏答案后停留在当前题不再跳回顶部；选项 ABCD 后顿号改为英文小数点；错题本工具栏新增「字体」设置——题干与选项字号分开调节（localStorage 持久化）；v1.0.7 新增默认收藏分组：背题页「错题本」按钮下方显示当前默认分组、点击可随时更改；错题本页「收藏设置」可开关「默认分组直存」——开启后第一个弹窗记好笔记点确定即直接存入默认分组（跳过分组选择弹窗），关闭则保持原流程目录（/spa/tiku/guide/catalog）；v1.0.6：点击收藏立即快速抓取（不等待三项齐全），弹窗中来源/正确答案/你的答案均可自行编辑，正确答案与你的答案限定 ABCD 单选，缺失可点选补充；v1.0.4：轮询采集窗口缩短至8秒，未做完题也允许收藏；弹窗新增笔记输入框，笔记随收藏一起保存；v1.0.3：点击收藏时从按钮实时重定位题根，修复背题页做完题后 SPA 重建 DOM 导致「没识别到当前题目」的问题；v1.0.0：拖拽手柄仅限三点可拖，空分组提示改为 toast，水印移至 WebDAV 信息后
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
  const DAV_TIMEOUT_MS = 60000;                             // 单次 WebDAV 请求超时（GET / OPTIONS / MKCOL / PROPFIND）
  const DAV_PUT_TIMEOUT_MS = 180000;                        // 整体回写（PUT）超时：全量 JSON 可达数十 MB，NAS 写入慢
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
  function davByteLen(s) {
    try {
      const str = String(s == null ? '' : s);
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(str).length;
      return unescape(encodeURIComponent(str)).length;   // 粗略估算，仅用于诊断展示
    } catch (e) { return 0; }
  }
  function davFmtBytes(n) {
    const v = Number(n) || 0;
    if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + 'MB';
    if (v >= 1024) return (v / 1024).toFixed(0) + 'KB';
    return v + 'B';
  }
  function davRequest(method, url, headers, body, timeoutMs) {
    const h = Object.assign({}, headers || {});
    const hasBody = !(body === undefined || body === null);
    const tmo = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : DAV_TIMEOUT_MS;
    const bodyBytes = hasBody ? davByteLen(body) : 0;
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        let settled = false; const t0 = Date.now();
        const ok = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
        try {
          GM_xmlhttpRequest({
            method: method, url: url, headers: h, data: hasBody ? body : undefined,
            timeout: tmo, responseType: 'text',
            onload(res) {
              const st = (res && typeof res.status === 'number') ? res.status : 0;
              const ms = Date.now() - t0;
              davNoteReq(method, url, st, ms, 'GM_xmlhttpRequest', bodyBytes);
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
              davNoteReq(method, url, 0, e.ms, 'GM_xmlhttpRequest（网络错误）', bodyBytes);
              ok(reject, e);
            },
            ontimeout() {
              const e = new Error('请求超时（超过 ' + tmo + 'ms' + (bodyBytes ? '，本次提交 ' + davFmtBytes(bodyBytes) : '') + '）');
              e.ms = Date.now() - t0;
              e.davTimeout = true;
              davNoteReq(method, url, 0, e.ms, 'GM_xmlhttpRequest（超时）', bodyBytes);
              ok(reject, e);
            },
            onabort() { ok(reject, new Error('请求被中止')); }
          });
        } catch (e) { ok(reject, e); }
      });
    }
    const t0 = Date.now();
    const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch (e) {} }, tmo) : null;
    return fetch(url, {
      method: method, headers: h,
      body: hasBody ? body : undefined,
      credentials: 'omit',   // 不要把粉笔的 Cookie 带到 WebDAV 服务器上去
      cache: 'no-store',
      signal: ctl ? ctl.signal : undefined
    }).then(res => res.text().then(t => {
      if (timer) clearTimeout(timer);
      const ms = Date.now() - t0;
      davNoteReq(method, url, res.status, ms, 'fetch', bodyBytes);
      return { status: res.status, statusText: res.statusText || '', text: String(t == null ? '' : t), headers: '', via: 'fetch', ms: ms };
    })).catch(e => {
      if (timer) clearTimeout(timer);
      if (e && (e.name === 'AbortError' || e.code === 20)) {
        const te = new Error('请求超时（超过 ' + tmo + 'ms' + (bodyBytes ? '，本次提交 ' + davFmtBytes(bodyBytes) : '') + '）');
        te.davTimeout = true; te.ms = Date.now() - t0;
        davNoteReq(method, url, 0, te.ms, 'fetch（超时）', bodyBytes);
        throw te;
      }
      throw new Error('请求失败（' + errText(e) + '）；当前环境没有 GM_xmlhttpRequest，浏览器会以 CORS 拦截跨域 WebDAV 请求');
    });
  }

  /* ---------------- 诊断：请求出口 / 状态码 / 耗时（只记路径，不记账号密码） ---------------- */
  function davUrlPath(url) {
    const m = /^[a-z]+:\/\/[^/]+(\/[^?#]*)?/i.exec(String(url == null ? '' : url));
    return m ? (m[1] || '/') : String(url == null ? '' : url);
  }
  function davNoteReq(method, url, status, ms, via, bytes) {
    try {
      const d = new Date(), p2 = n => (n < 10 ? '0' : '') + n;
      davState.log.push({
        at: p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()),
        method: String(method || '').toUpperCase(),
        path: davUrlPath(url), status: status, ms: ms, via: via || '', bytes: Number(bytes) || 0
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
    lines.push('【粉笔错题本 · WebDAV 同步诊断】脚本 v1.0.14');
    lines.push('页面：' + davPageUrl());
    lines.push('配置状态：' + (davIsConfigured(cfg) ? '已配置' : '未配置'));
    lines.push('  服务器：' + (cfg.host || '(空)'));
    lines.push('  账号：' + (cfg.user ? '已填（' + cfg.user.length + ' 位）' : '(空)'));
    lines.push('  密码：' + (cfg.pass ? '已填（' + cfg.pass.length + ' 位）' : '(空)'));
    lines.push('  远程路径：' + cfg.path);
    lines.push('  目标 URL：' + (cfg.host ? davFileUrl(cfg) : '(未配置)'));
    lines.push('请求出口：' + (typeof GM_xmlhttpRequest === 'function' ? 'GM_xmlhttpRequest（免 CORS，推荐）' : 'fetch（浏览器同源策略可能拦截跨域 WebDAV）'));
    lines.push('单次请求超时：' + DAV_TIMEOUT_MS + 'ms（读/探测）；整体回写超时：' + DAV_PUT_TIMEOUT_MS + 'ms（PUT）；冲突最大重试：' + DAV_MAX_RETRY + ' 次');
    lines.push('本机数据：' + state.items.length + ' 道题 / ' + state.groups.length + ' 个分组 / ' + Object.keys(state.deleted).length + ' 条删除墓碑');
    try {
      const docSize = davByteLen(JSON.stringify(buildDoc()));
      lines.push('待上传体积：' + davFmtBytes(docSize) + (docSize > 8 * 1024 * 1024 ? '（偏大，NAS/WebDAV 写入会明显变慢）' : ''));
    } catch (e) { /* 体积估算失败不影响诊断 */ }
    lines.push('远端快照：' + (snap ? (snap.at + ' · ' + snap.content.length + ' 字节 · ETag ' + (snap.etag ? '有' : '无')) : '无（下次读远端会重新建立）'));
    lines.push('最近 ' + davState.log.length + ' 次请求（新 → 旧）：');
    for (let i = davState.log.length - 1; i >= 0; i--) {
      const r = davState.log[i];
      lines.push('  ' + r.at + '  ' + r.method + ' ' + r.path + ' → ' + (r.status || '未响应') +
        ' · ' + (r.ms >= 1000 ? (r.ms / 1000).toFixed(2) + 's' : r.ms + 'ms') +
        (r.bytes ? ' · ' + davFmtBytes(r.bytes) : '') + (r.via ? ' · ' + r.via : ''));
    }
    if (!davState.log.length) lines.push('  （还没有发出过 WebDAV 请求）');
    lines.push('提示：401/403 = 账号或密码不对（坚果云用应用密码；极空间等私有 WebDAV 须用该服务单独开通的账号并确认目录读写权限）；404/405 = 保存路径不可写；409 = 上级目录不存在；超时 = 网络慢或待上传数据过大（看上面「待上传体积」）。');
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
        davAuthDebug(cfg, res);
        // 401 有两种含义：账号密码错 / 路径不存在或无权限（极空间对二者一律回 401）。
        // 再对 WebDAV 根发一次 PROPFIND 区分：根能通 → 密码是对的，问题在保存路径。
        return davDiagnose401(cfg).then(kind => {
          if (kind === 'path') {
            const dir = String(cfg.path || '').split('/').filter(Boolean).slice(0, -1).join('/');
            throw new Error('账号密码正确（WebDAV 根目录可访问），但保存路径「' + cfg.path + '」不可用（HTTP ' + res.status + '）。' +
              '极空间对「不存在 / 无权限」的路径同样回 401：请先在极空间里手动创建目录「' + (dir || '（根目录）') + '」，并确认该账号对它有读写权限。');
          }
          throw new Error('WebDAV 认证失败（HTTP ' + res.status + '）。服务器不接受当前账号密码：' +
            '极空间/群晖等 NAS 要填该机「登录账号（一般手机号）+ 登录密码」，坚果云要填「注册邮箱 + 应用密码」。详见控制台 [粉笔错题本·同步] 认证诊断。');
        });
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
    return davRequest('PUT', davFileUrl(cfg), headers, content, DAV_PUT_TIMEOUT_MS);
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
  // 「替换」语义导入：用文件内容整体替换本地，而不是并集追加。
  // 本地有、文件里没有的题/分组要写进删除墓碑，否则下次 WebDAV 合并会被远端旧数据复活。
  function replaceDocs(doc) {
    const now = Date.now();
    const del = Object.assign({}, state.deleted || {});
    const newItems = (Array.isArray(doc.items) ? doc.items : []).filter(i => i && i.id);
    const newGroups = (Array.isArray(doc.groups) ? doc.groups : []).filter(g => g && g.id);
    const keepItem = new Set(newItems.map(i => i.id));
    const keepGroup = new Set(newGroups.map(g => g.id));
    (state.items || []).forEach(i => { if (i && i.id && !keepItem.has(i.id)) del[i.id] = now; });
    (state.groups || []).forEach(g => { if (g && g.id && !keepGroup.has(g.id)) del[g.id] = now; });
    // 文件里的条目若正好在本机墓碑中，必须抹掉墓碑，否则导入后立刻被过滤掉
    keepItem.forEach(id => { delete del[id]; });
    keepGroup.forEach(id => { delete del[id]; });
    state.items = newItems.map(i => Object.assign({}, i));
    state.groups = newGroups.map(g => Object.assign({}, g));
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
      return '账号或密码没有通过认证（HTTP ' + code + '）。坚果云要填「注册邮箱」+「应用密码」；自建/极空间等私有 WebDAV 要填该服务单独开通的 WebDAV 账号，用 NAS 登录账号常常不通，且需在服务端确认该账号对目标目录有读写权限。';
    }
    if (code === '404' || code === '405') {
      return '服务器地址或保存路径不对（该路径不可写）。坚果云地址固定为 https://dav.jianguoyun.com/dav；极空间为 http://NAS地址:5005 （注意不带 /dav，根下直接是 sharetome、共享文件、sata13-手机号、nvme12-手机号、public 这些存储池目录，保存路径要带存储池前缀）。保存路径「' + path +
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
  /* ---------------- 认证失败诊断：把服务器挑战原样打出来（不含明文密码） ---------------- */
  function davAuthDebug(cfg, res) {
    try {
      davState.authFailAt = Date.now();
      const u = String((cfg && cfg.user) || '');
      const masked = u.length <= 4 ? u : u.slice(0, 3) + '***' + u.slice(-2);
      console.warn('[粉笔错题本·同步] 认证诊断', {
        目标URL: davFileUrl(cfg),
        账号: masked + '（' + u.length + ' 位）',
        密码位数: String((cfg && cfg.pass) || '').length,
        认证头长度: davAuthHeader(cfg).length,
        服务器挑战: String((res && res.headers) || '').trim() || '(未暴露响应头)',
        服务器返回: String((res && res.text) || '').slice(0, 200),
        出口: (res && res.via) || ''
      });
    } catch (e) { /* 诊断失败不影响主流程 */ }
  }
  // WebDAV 根地址（去掉末尾多余斜杠后补一个）：用于认证与路径的二分诊断
  function davRootUrl(cfg) {
    return String((cfg && cfg.host) || '').replace(/\/+$/, '') + '/';
  }
  // 401 归因：根目录 PROPFIND 通 → 'path'（密码对，路径不可用）；否则 → 'auth'（密码错）
  function davDiagnose401(cfg) {
    const BODY = '<?xml version="1.0" encoding="utf-8"?>' +
      '<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>';
    return davRequest('PROPFIND', davRootUrl(cfg), {
      'Authorization': davAuthHeader(cfg),
      'Depth': '0',
      'Content-Type': 'application/xml; charset=utf-8'
    }, BODY).then(p => {
      const ok = p.status >= 200 && p.status < 300;
      try {
        console.warn('[粉笔错题本·同步] 401 归因', {
          根目录URL: davRootUrl(cfg),
          根目录状态: p.status,
          结论: ok ? '密码正确 / 路径不可用' : '账号或密码不正确',
          目标路径: String((cfg && cfg.path) || '')
        });
      } catch (e) { /* ignore */ }
      return ok ? 'path' : 'auth';
    }).catch(() => 'auth');
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
      .catch(e => {
        if (e && e.davTimeout) {
          const t = '同步超时：单次请求超过 ' + Math.round(DAV_PUT_TIMEOUT_MS / 1000) + ' 秒仍未完成。本机 '+ state.items.length +
            ' 道题（含图片 base64）体积较大，NAS 写入慢时容易触发；可先在网络空闲时手动同步一次，或减少带图题目的收藏。';
          davWarn('同步超时', errText(e));
          throw new Error(t);
        }
        throw e;
      })
      .then(r => finish(r), e => finish(Promise.reject(e)));
  }

  /* ---------------- 拉取（GET → 合并 → 持久化 → 重渲染） ---------------- */
  function davPull(silent) {
    const cfg = davGetCfg();
    // 自动拉取（silent）在认证失败后冷却 10 分钟，避免每开一个页面就刷一串 401；手动操作不受限
    if (silent && davState.authFailAt && (Date.now() - davState.authFailAt) < 10 * 60 * 1000) {
      return Promise.resolve({ skipped: true, reason: '认证失败冷却中' });
    }
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

  // v1.0.0-fix：正确答案/你的答案兜底盒子的查找必须限定在当前题目及其题组范围内，
  // 严禁直接 firstMatch(document, ...) —— 多题页面（资料分析组题/整页多题）时
  // 所有题都会取到页面第一个答案盒子，导致正确答案固定识别成同一个字母。
  // 查找顺序：当前题容器 root 内 -> 最近的题组容器（.ti / app-ti / .questions-container）内 ->
  // 仅当整页只有一个题目容器时才允许回退 document（防串题）。
  function answerBoxNear(root, sels) {
    try {
      let el = firstMatch(root, sels);
      if (el) return el;
      let node = root && root.parentElement;
      for (let i = 0; i < 5 && node; i++) {
        if (node.matches && node.matches('.ti, app-ti, .questions-container, .question-multiple, .question-list')) {
          try {
            if (node.querySelectorAll(SEL.questionRoot.join(',')).length <= 1) {
              el = firstMatch(node, sels);
              if (el) return el;
            }
          } catch (e) { /* ignore */ }
        }
        node = node.parentElement;
      }
      // 多题页面：答案条（app-solution-overall / .question-overall-container）常紧随题目容器，
      // 作为兄弟节点紧邻其后；只查紧随兄弟，且兄弟内不包含其它题目容器，防止串题。
      let sib = root && root.nextElementSibling;
      for (let i = 0; i < 3 && sib; i++) {
        if (!sib.querySelectorAll || !sib.matches) break;
        try {
          if (sib.querySelectorAll(SEL.questionRoot.join(',')).length <= 1) {
            el = firstMatch(sib, sels);
            if (el) return el;
          }
        } catch (e) { /* ignore */ }
        sib = sib.nextElementSibling;
      }
      try {
        if (document.querySelectorAll(SEL.questionRoot.join(',')).length <= 1) {
          el = firstMatch(document, sels);
          if (el) return el;
        }
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
    return null;
  }

  // 与 answerBoxNear 同范围的文本收集（供「正确答案：X」正则兜底使用，避免 document.body 串题）
  function scopeTextNear(root) {
    const texts = [];
    try {
      if (root) { const t = norm(root.innerText || root.textContent); if (t) texts.push(t); }
      let node = root && root.parentElement;
      for (let i = 0; i < 5 && node; i++) {
        if (node.matches && node.matches('.ti, app-ti, .questions-container, .question-multiple, .question-list')) {
          const t = norm(node.innerText || node.textContent);
          if (t) { texts.push(t); break; }
        }
        node = node.parentElement;
      }
    } catch (e) { /* ignore */ }
    return texts.join(' ');
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
    // v1.0.10：数字题号途径全部落空时，优先用 questionKeysOf 的 qkey/anchorId/anchorName 组合生成稳定 qid，
    // 避免同模板题干（如图形推理「从所给的四个选项中…」）在不同试卷中 hash 撞车导致串题
    const keys = questionKeysOf(root);
    const parts = [keys.qkey, keys.anchorId, keys.anchorName].filter(Boolean);
    if (parts.length) return 'q' + hashKey(parts.join('|'));
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
   * 顺序：常见来源条类名 -> 题根内文本以「第N题」结尾的叶子（拆开结构时上溯父容器补全试卷名）-> 兜底空字符串。
   * v1.0.0-fix：来源条若挂在题根 .questions-single-container 外层（组 .ti 顶部，资料分析组题常见），
   * 题根内扫描无果时必须继续上溯到组 .ti 内查找，否则来源识别为空；组内扫描跳过材料区防误命中。 */
  function extractSource(root) {
    function scan(scope, isGroup) {
      if (!scope || !scope.querySelectorAll) return '';
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
      return '';
    }
    try {
      if (!root || !root.querySelectorAll) return '';
      // 收藏按钮注入时的 root 可能是 .question-choice-container（题干容器），
      // 而来源条（试卷名+题号）挂在题根 .questions-single-container 内，先上溯到题根再抓取。
      const rootScope = (root.closest && root.closest('.questions-single-container')) || root;
      // v1.0.0-fix：题根内无来源条时（组 .ti 顶部来源条，资料分析组题常见），再上溯到组 .ti 内查找。
      const groupScope = (root.closest && root.closest('.ti')) || null;
      const scopes = [];
      if (rootScope && rootScope.querySelectorAll) scopes.push(rootScope);
      if (groupScope && groupScope !== rootScope && groupScope.querySelectorAll) scopes.push(groupScope);
      for (let si = 0; si < scopes.length; si++) {
        const scope = scopes[si];
        const isGroup = !!(scope.classList && scope.classList.contains('ti'));
        const found = scan(scope, isGroup);
        if (found) return found;
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

  /* v1.0.1：收藏前等待解析区渲染（背题页 40 题整页渲染，但来源条/答题区可能晚于题干与选项挂载；
     此时抓取会导致 source 与 correctAnswer 为空、只剩 yourAnswer。轮询不阻塞页面渲染，超时后照常抓取尽力而为） */
  function waitParseAreaReady(root, timeoutMs) {
    const fullRoot = (root && root.closest && root.closest('.questions-single-container')) || root || document;
    const limit = timeoutMs || 2000;
    return new Promise(function (resolve) {
      const t0 = Date.now();
      (function probe() {
        try {
          if (!fullRoot || !fullRoot.isConnected) return resolve(false);
          if (fullRoot.querySelector('.question-overall-container, .result-common-container, .overall-item-value')) return resolve(true);
        } catch (e) { return resolve(false); }
        if (Date.now() - t0 >= limit) return resolve(false);
        setTimeout(probe, 200);
      })();
    });
  }

  /* v1.0.3：从收藏按钮实时定位所属题根。
     粉笔 SPA 在作答完成后会重建题目 DOM，注入时捕获的 root 会失联（isConnected=false），
     必须从仍存活的按钮元素向上实时重定位，避免 getQuestion 拿不到题干。
     优先命中题根容器（.questions-single-container / app-ti 等），避免组题 .ti 容器串题；
     .ti 仅在找不到更精确题根时作为兜底（普通题 .ti 恰为单题根，安全）。 */
  function favRootFromBtn(btn) {
    if (!btn || !btn.closest) return null;
    try {
      const r = btn.closest('.questions-single-container, app-ti, .question-choice-container, app-question-choice, .questions-container');
      if (r) return r;
      return btn.closest('.ti') || null;
    } catch (e) { return null; }
  }

  /* v1.0.2：点击收藏后轮询抓取，直到 来源/正确答案/你的答案 三项全部非空（或超时）。
     每次探测从按钮实时重定位题根（v1.0.3），保证拿到解析区渲染完成后、且未被 SPA 重建替换的最新数据。
     超时返回最近一次结果（含缺失项），由弹窗提示，不阻塞收藏。 */
  function pollCapture(btnOrRoot, timeoutMs) {
    const limit = timeoutMs || 2000;
    return new Promise(function (resolve) {
      const t0 = Date.now();
      (function probe() {
        let root = null;
        try {
          if (btnOrRoot && btnOrRoot.classList && btnOrRoot.classList.contains('fb-mk-fav-btn')) {
            root = favRootFromBtn(btnOrRoot);
          } else if (btnOrRoot && btnOrRoot.isConnected) {
            root = btnOrRoot;
          } else if (btnOrRoot && btnOrRoot.closest) {
            root = favRootFromBtn(btnOrRoot);
          }
        } catch (e) { root = null; }
        if (!root) {
          if (Date.now() - t0 >= limit) return resolve(null);
          setTimeout(probe, 300);
          return;
        }
        try {
          const q = getQuestion(root);
          if (q && q.stem) return resolve(q); // v1.0.6：抓到题干即可返回，其余缺失由用户在弹窗补充
          if (Date.now() - t0 >= limit) return resolve(q); // 超时：返回最近一次结果，缺失项由弹窗补充
        } catch (e) { /* ignore */ }
        if (Date.now() - t0 >= limit) return resolve(null);
        setTimeout(probe, 300);
      })();
    });
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
      // 粉笔 SPA：用户选中态不体现在 input 上（一律 disabled + checked=false），
      // 而是体现为选项字母盒 div.input-radio 的 class：wrong=用户选的错误答案，correct=用户选对。
      const checked = !!row.querySelector('input:checked') || !!li.querySelector('input:checked') ||
        !!(row.querySelector('.input-radio.wrong, .choice-radio.wrong, .option-radio.wrong, .input-radio.correct, .choice-radio.correct, .option-radio.correct')) ||
        !!(li.querySelector('.input-radio.wrong, .choice-radio.wrong, .option-radio.wrong, .input-radio.correct, .choice-radio.correct, .option-radio.correct')) ||
        /(^|[\s])(checked|selected|active|choose|chosen|picked|wrong|correct)($|[\s])/.test(clsAll);
      if (checked) yourAnswer += letter;
      options.push({ letter: letter, label: label.slice(0, 300), correct: isCorrect, chosen: checked, image: collectImgBase64(row, 'options.' + options.length + '.image', imgTasks) });
    });

    let correctAnswer = options.filter(o => o.correct).map(o => o.letter).join('');
    if (!correctAnswer) {
      const cBox = answerBoxNear(root, ['.overall-item-value.correct-answer', '.correct-answer']);
      const cTxt = cBox ? norm(cBox.innerText || cBox.textContent) : '';
      const cm = (cTxt.match(/[A-Ea-e]/g) || []).join('').toUpperCase();
      if (cm) correctAnswer = cm;
      else {
        const m = scopeTextNear(root).match(/正确答案[是为:：]\s*([A-Ea-e][A-Ea-e、,，\s]*)/);
        if (m) correctAnswer = (m[1].match(/[A-Ea-e]/g) || []).join('').toUpperCase();
      }
    }
    if (!yourAnswer) {
      // 兜底①：答案条里「你的答案」盒子（错题才有，值在 .your-answer-wrong 子元素内）
      const yBox = answerBoxNear(root, ['.your-answer-wrong', '.overall-item-value.your-answer', '.your-answer', '.overall-item-value.wrong-answer']);
      const yTxt = yBox ? norm(yBox.innerText || yBox.textContent) : '';
      const ym = (yTxt.match(/[A-Ea-e]/g) || []).join('').toUpperCase();
      if (ym) yourAnswer = ym;
    }
    // 兜底②：从选项选中态反推（wrong=用户选的错误项，correct=用户选对项，均视为你的答案）
    if (!yourAnswer) {
      const chosenLetters = options.filter(o => o.chosen).map(o => o.letter).join('');
      if (chosenLetters) yourAnswer = chosenLetters;
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

  // v1.0.10：跨域/未加载图片异步补救统一入口（新建与覆盖更新共用）。
  // savedItem 为待写回的条目；inItems 传入 state.items 时校验条目仍存活。
  function applyImgTasks(savedItem, imgTasks, inItems) {
    if (!savedItem || !imgTasks || !imgTasks.length) return;
    let done = 0, fail = 0;
    imgTasks.forEach(t => {
      if (!t || !t.el) { done++; return; }
      imgToDataURLAsync(t.el).then(b64 => {
        done++;
        const alive = !inItems || inItems.indexOf(savedItem) >= 0;
        if (b64 && alive && setItemImgField(savedItem, t.key, b64)) {
          persist(); if (renderNotebook) renderNotebook();
        } else {
          fail++;
          if (done === imgTasks.length && fail > 0) toast('部分题目图片未能转换为 base64，已跳过（不影响收藏）', 3600);
        }
      });
    });
  }

  // v1.0.12：收藏入库成功后，把页面按钮的 data-qid 同步为实际入库的 qid。
  // 背景：v1.0.10 调整 extractQid 后，收藏时 pollCapture 新抓的 qid（q+hash 组合）可能与
  // 页面加载时注入按钮的旧 data-qid 不一致；refreshFavButtons 用按钮 data-qid 查 findItemByQid，
  // 查不到就永远显示「收藏错题」。按 stemHash 精准匹配同题按钮后同步 qid，收藏完按钮立即变已收藏。
  function syncFavBtnQid(q) {
    if (!q || !q.qid) return;
    try {
      document.querySelectorAll('.fb-mk-fav').forEach(function (w) {
        if (!w || !w.dataset) return;
        if (!q.stemHash || !w.dataset.stem) return;         // 缺 stemHash 无法安全定位，跳过
        if (w.dataset.stem !== q.stemHash) return;          // 不是同一题，跳过
        if (w.dataset.qid !== q.qid) w.dataset.qid = q.qid; // 同步 qid，供 refreshFavButtons 判定
      });
    } catch (e) { /* ignore */ }
  }

  function saveItem(q, groupId) {
    if (!q || !q.qid) { toast('抓取题目失败：没拿到题号，请刷新页面后重试'); return false; }
    // v1.0.11：已收藏题允许重复入库为独立条目（再收藏一份，笔记/分组各自独立）。
    // id 唯一化避免与旧条目 id 相同；qid 保留原始值用于「已收藏」按钮状态判定。
    const uniqId = q.qid + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const imgTasks = (q && Array.isArray(q._imgTasks)) ? q._imgTasks : [];
    state.items.unshift({
      id: uniqId, qid: q.qid, group: (groupId === undefined || groupId === null) ? fallbackGroupId() : groupId,
      stem: q.stem, options: q.options,
      correctAnswer: q.correctAnswer, yourAnswer: q.yourAnswer,
      title: q.title, stemHash: q.stemHash,
      qkey: q.qkey, anchorId: q.anchorId, anchorName: q.anchorName,
      source: q.source || '',
      note: q.note || '', // v0.3.18：每题笔记（随 JSON 导出/导入、WebDAV 同步、mergeDocs 合并天然携带）；v1.0.5：新题插入带上弹窗输入的 q.note
      stemImage: q.stemImage || '',
      material: q.material || '',
      materialImages: q.materialImages || '',
      url: q.url, createdAt: Date.now(), updatedAt: Date.now()
    });
    delete state.deleted[q.qid];
    syncFavBtnQid(q); // v1.0.12：先把按钮 data-qid 同步为新入库 qid，refreshFavButtons 才能命中已收藏
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

  /* v1.0.6：抓取结果确认弹窗——点击收藏快速抓取（不等待三项齐全），
     来源/正确答案/你的答案 三项均可自行编辑，正确答案与你的答案限定 ABCD 单选（未抓到可点选补充），
     笔记与错题本页面共用 item.note。确认后进入分组收藏（openPicker）。 */
  function showCaptureVerify(q, onConfirm, onCancel) {     closePicker();
    const mask = document.createElement('div');
    mask.className = 'fb-mk-mask fb-mk-mask-sheet';
    const card = document.createElement('div');
    card.className = 'fb-mk-card fb-mk-verify';
    card.appendChild(mkEl('div', 'fb-mk-title', '收藏本题（信息可自行补充）'));
    const stem = norm(q && q.stem ? q.stem : '') || '(题干缺失)';
    card.appendChild(mkEl('div', 'fb-mk-sheet-stem', stem.length > 90 ? stem.slice(0, 90) + '…' : stem));

    /* 来源：可编辑文本框，抓不到也能手填 */
    const srcRow = document.createElement('div');
    srcRow.className = 'fb-mk-verify-field';
    srcRow.appendChild(mkEl('span', 'fb-mk-verify-label', '来源'));
    const srcInp = document.createElement('input');
    srcInp.className = 'fb-mk-verify-input';
    srcInp.placeholder = '如：2026年国考《行测》题（网友回忆版）第23题';
    srcInp.value = (q && q.source) || '';
    srcRow.appendChild(srcInp);
    card.appendChild(srcRow);

    /* 正确答案 / 你的答案：ABCD 单选按钮组，抓到自动预选，未抓到可点选修改 */
    function abcdRow(label, current) {
      const row = document.createElement('div');
      row.className = 'fb-mk-verify-field';
      row.appendChild(mkEl('span', 'fb-mk-verify-label', label));
      const group = document.createElement('div');
      group.className = 'fb-mk-verify-abcd';
      const cur = norm(current || '').replace(/[^A-Da-d]/g, '').slice(0, 1).toUpperCase();
      ['A', 'B', 'C', 'D'].forEach(function (lt) {
        const lab = document.createElement('label');
        lab.className = 'fb-mk-verify-opt' + (cur === lt ? ' on' : '');
        lab.textContent = lt;
        lab.addEventListener('click', function () {
          group.querySelectorAll('.fb-mk-verify-opt').forEach(function (o) { o.classList.remove('on'); });
          lab.classList.add('on');
        });
        group.appendChild(lab);
      });
      row.appendChild(group);
      row._get = function () {
        const on = group.querySelector('.fb-mk-verify-opt.on');
        return on ? on.textContent : '';
      };
      return row;
    }
    const correctRow = abcdRow('正确答案', q && q.correctAnswer);
    const yourRow = abcdRow('你的答案', q && q.yourAnswer);
    card.appendChild(correctRow);
    card.appendChild(yourRow);

    /* 笔记：与错题本页面共用 item.note；v1.0.11：重复收藏时笔记独立，不再预填旧条目笔记 */
    const noteRow = document.createElement('div');
    noteRow.className = 'fb-mk-verify-note-row';
    noteRow.appendChild(mkEl('label', 'fb-mk-verify-note-label', '笔记'));
    const noteArea = document.createElement('textarea');
    noteArea.className = 'fb-mk-verify-note';
    noteArea.rows = 3;
    noteArea.placeholder = '在此添加笔记（考试来源、思路分析、易错点等）';
    if (q && q.note) noteArea.value = q.note;
    noteRow.appendChild(noteArea);
    card.appendChild(noteRow);

    const foot = document.createElement('div');
    foot.className = 'fb-mk-verify-foot';
    const cancelBtn = mkEl('button', 'fb-mk-gbtn', '取消');
    cancelBtn.addEventListener('click', function () { if (onCancel) onCancel(); });
    foot.appendChild(cancelBtn);
    const okBtn = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-main', '确认收藏');
    okBtn.addEventListener('click', function () {
      if (onConfirm) onConfirm({
        source: srcInp.value,
        correctAnswer: correctRow._get(),
        yourAnswer: yourRow._get(),
        note: noteArea.value
      });
    });
    foot.appendChild(okBtn);
    card.appendChild(foot);
    mask.appendChild(card);
    mask.addEventListener('click', function (e) { if (e.target === mask && onCancel) onCancel(); });
    document.body.appendChild(mask);
    pickerEl = mask;
  }

  /* 底部抽屉式分组选择器
   * 参照 sheet-preview demo：mask + 底部 sheet（62% 高），两列树、按层级缩进、名称 + 计数，
   * 点击分组名即收藏到该分组；点行内「+」把该分组设为当前节点，可在其下新建子分组。
   */
  /* v1.0.7：设置默认收藏分组——点分组名即设为默认；选「未分组」则默认存未分组 */
  function openDefaultGroupPicker() {
    closePicker();
    const mask = document.createElement('div');
    mask.className = 'fb-mk-mask fb-mk-mask-sheet';
    const sheet = document.createElement('div');
    sheet.className = 'fb-mk-sheet';
    sheet.appendChild(mkEl('div', 'fb-mk-handle'));
    const head = document.createElement('div');
    head.className = 'fb-mk-sheet-head';
    const titleRow = document.createElement('div');
    titleRow.className = 'fb-mk-sheet-title-row';
    titleRow.appendChild(mkEl('div', 'fb-mk-sheet-title', '默认收藏分组'));
    const closeBtn = mkEl('button', 'fb-mk-gbtn fb-mk-sheet-close', '取消');
    closeBtn.addEventListener('click', closePicker);
    titleRow.appendChild(closeBtn);
    head.appendChild(titleRow);
    head.appendChild(mkEl('div', 'fb-mk-sheet-tip', '收藏时将直接存入该分组（可在错题本「收藏设置」关闭直存）。当前默认：' + defaultGroupLabel()));
    sheet.appendChild(head);
    const tree = document.createElement('div');
    tree.className = 'fb-mk-tree';
    const colL = mkEl('div', 'fb-mk-col'), colR = mkEl('div', 'fb-mk-col');
    tree.appendChild(colL); tree.appendChild(colR);
    sheet.appendChild(tree);
    const ungRow = document.createElement('div');
    ungRow.className = 'fb-mk-node' + (getDefaultGroupId() === '' ? ' on' : '');
    ungRow.style.paddingLeft = '10px';
    ungRow.appendChild(mkEl('span', 'fb-mk-node-arrow', '·'));
    ungRow.appendChild(mkEl('span', 'fb-mk-node-name', '未分组'));
    ungRow.appendChild(mkEl('span', 'fb-mk-node-count', String(state.items.filter(function (i) { return !i.group; }).length)));
    ungRow.addEventListener('click', function () { setDefaultGroupId(''); closePicker(); toast('默认收藏分组已设为「未分组」'); });
    colL.appendChild(ungRow);
    function renderDgNodes(nodes, depth, parent) {
      nodes.forEach(function (g) {
        const kids = childGroups(g.id);
        const row = document.createElement('div');
        row.className = 'fb-mk-node' + (getDefaultGroupId() === g.id ? ' on' : '');
        row.style.paddingLeft = (10 + depth * 14) + 'px';
        row.appendChild(mkEl('span', 'fb-mk-node-arrow', kids.length ? '▼' : '·'));
        row.appendChild(mkEl('span', 'fb-mk-node-name', g.name));
        row.appendChild(mkEl('span', 'fb-mk-node-count', String(groupItemCount(g.id))));
        row.addEventListener('click', function () { setDefaultGroupId(g.id); closePicker(); toast('默认收藏分组已设为「' + defaultGroupLabel() + '」'); });
        parent.appendChild(row);
        if (kids.length) renderDgNodes(kids, depth + 1, parent);
      });
    }
    const roots = state.groups.filter(function (g) { return !g.parentId; });
    const half = Math.ceil(roots.length / 2);
    renderDgNodes(roots.slice(0, half), 0, colL);
    renderDgNodes(roots.slice(half), 0, colR);
    mask.appendChild(sheet);
    mask.addEventListener('click', function (e) { if (e.target === mask) closePicker(); });
    document.body.appendChild(mask);
    pickerEl = mask;
  }

  /* v1.0.7：错题本收藏设置——是否开启「默认分组直存」 + 更改默认分组 */
  function openCollectSetting() {
    closePicker();
    const mask = document.createElement('div');
    mask.className = 'fb-mk-mask fb-mk-mask-sheet';
    const sheet = document.createElement('div');
    sheet.className = 'fb-mk-sheet';
    sheet.appendChild(mkEl('div', 'fb-mk-handle'));
    const head = document.createElement('div');
    head.className = 'fb-mk-sheet-head';
    const titleRow = document.createElement('div');
    titleRow.className = 'fb-mk-sheet-title-row';
    titleRow.appendChild(mkEl('div', 'fb-mk-sheet-title', '收藏设置'));
    const closeBtn = mkEl('button', 'fb-mk-gbtn fb-mk-sheet-close', '关闭');
    closeBtn.addEventListener('click', closePicker);
    titleRow.appendChild(closeBtn);
    head.appendChild(titleRow);
    sheet.appendChild(head);
    const body = document.createElement('div');
    body.className = 'fb-mk-settings';
    const row1 = document.createElement('div');
    row1.className = 'fb-mk-settings-row';
    row1.appendChild(mkEl('span', 'fb-mk-settings-label', '默认分组直存'));
    const tog = mkEl('button', 'fb-mk-settings-toggle' + (useDefaultGroup() ? ' on' : ''), useDefaultGroup() ? '已开启' : '已关闭');
    tog.title = '开启后：收藏时在第一个弹窗记好笔记，点确定直接存入默认分组，不再弹分组选择';
    tog.addEventListener('click', function () {
      const next = !useDefaultGroup();
      setUseDefaultGroup(next);
      tog.textContent = next ? '已开启' : '已关闭';
      tog.className = 'fb-mk-settings-toggle' + (next ? ' on' : '');
      desc1.textContent = next ? '开启中：点收藏 → 记笔记 → 确定后直接存入「' + defaultGroupLabel() + '」' : '已关闭：沿用原流程（收藏时弹分组选择）';
    });
    row1.appendChild(tog);
    body.appendChild(row1);
    const desc1 = mkEl('div', 'fb-mk-settings-desc', useDefaultGroup() ? '开启中：点收藏 → 记笔记 → 确定后直接存入「' + defaultGroupLabel() + '」' : '已关闭：沿用原流程（收藏时弹分组选择）');
    body.appendChild(desc1);
    const row2 = document.createElement('div');
    row2.className = 'fb-mk-settings-row';
    row2.appendChild(mkEl('span', 'fb-mk-settings-label', '默认分组'));
    const dgBtn = mkEl('button', 'fb-mk-gbtn', defaultGroupLabel());
    dgBtn.title = '更改默认收藏分组';
    dgBtn.addEventListener('click', openDefaultGroupPicker);
    row2.appendChild(dgBtn);
    body.appendChild(row2);
    body.appendChild(mkEl('div', 'fb-mk-settings-desc', '收藏直存的目标分组，随时可改；背题页「错题本」按钮下方也可直接更改。'));
    sheet.appendChild(body);
    mask.appendChild(sheet);
    mask.addEventListener('click', function (e) { if (e.target === mask) closePicker(); });
    document.body.appendChild(mask);
    pickerEl = mask;
  }

  /* v1.0.8：错题本字体设置——题干与选项字号分开调节，localStorage 持久化 */
  const LS_FONT_STEM = 'fb_mk_font_stem';
  const LS_FONT_OPT = 'fb_mk_font_opt';
  function getFontStem() { try { const v = parseInt(localStorage.getItem(LS_FONT_STEM), 10); return isNaN(v) ? 16 : v; } catch (e) { return 16; } }
  function getFontOpt() { try { const v = parseInt(localStorage.getItem(LS_FONT_OPT), 10); return isNaN(v) ? 15 : v; } catch (e) { return 15; } }
  function setFontStem(v) { try { localStorage.setItem(LS_FONT_STEM, String(v)); } catch (e) { /* ignore */ } }
  function setFontOpt(v) { try { localStorage.setItem(LS_FONT_OPT, String(v)); } catch (e) { /* ignore */ } }
  // 将已保存字号应用为 CSS 变量（错题本页面样式读取 --fb-mk-font-stem / --fb-mk-font-opt）
  function applyFontSetting() {
    const root = document.documentElement;
    root.style.setProperty('--fb-mk-font-stem', getFontStem() + 'px');
    root.style.setProperty('--fb-mk-font-opt', getFontOpt() + 'px');
  }
  function openFontSetting() {
    closePicker();
    const mask = document.createElement('div');
    mask.className = 'fb-mk-mask fb-mk-mask-sheet';
    const sheet = document.createElement('div');
    sheet.className = 'fb-mk-sheet';
    sheet.appendChild(mkEl('div', 'fb-mk-handle'));
    const head = document.createElement('div');
    head.className = 'fb-mk-sheet-head';
    const titleRow = document.createElement('div');
    titleRow.className = 'fb-mk-sheet-title-row';
    titleRow.appendChild(mkEl('div', 'fb-mk-sheet-title', '字体设置'));
    const closeBtn = mkEl('button', 'fb-mk-gbtn fb-mk-sheet-close', '关闭');
    closeBtn.addEventListener('click', closePicker);
    titleRow.appendChild(closeBtn);
    head.appendChild(titleRow);
    sheet.appendChild(head);
    const body = document.createElement('div');
    body.className = 'fb-mk-settings';
    // 题干字号
    const rowStem = document.createElement('div');
    rowStem.className = 'fb-mk-settings-row';
    rowStem.appendChild(mkEl('span', 'fb-mk-settings-label', '题干字号'));
    const stemInput = document.createElement('input');
    stemInput.type = 'number';
    stemInput.min = 12; stemInput.max = 30; stemInput.step = 1;
    stemInput.value = getFontStem();
    stemInput.style.cssText = 'width:80px;font-size:14px;padding:4px 8px;border:1px solid #c9d4e6;border-radius:6px;';
    rowStem.appendChild(stemInput);
    body.appendChild(rowStem);
    body.appendChild(mkEl('div', 'fb-mk-settings-desc', '题干（含材料）文字大小，单位 px'));
    // 选项字号
    const rowOpt = document.createElement('div');
    rowOpt.className = 'fb-mk-settings-row';
    rowOpt.appendChild(mkEl('span', 'fb-mk-settings-label', '选项字号'));
    const optInput = document.createElement('input');
    optInput.type = 'number';
    optInput.min = 11; optInput.max = 28; optInput.step = 1;
    optInput.value = getFontOpt();
    optInput.style.cssText = 'width:80px;font-size:14px;padding:4px 8px;border:1px solid #c9d4e6;border-radius:6px;';
    rowOpt.appendChild(optInput);
    body.appendChild(rowOpt);
    body.appendChild(mkEl('div', 'fb-mk-settings-desc', 'ABCD 选项文字大小，单位 px'));
    // 保存按钮
    const foot = document.createElement('div');
    foot.className = 'fb-mk-settings-foot';
    foot.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px';
    const resetBtn = mkEl('button', 'fb-mk-gbtn', '恢复默认');
    resetBtn.addEventListener('click', function () {
      stemInput.value = 16; optInput.value = 15;
    });
    foot.appendChild(resetBtn);
    const saveBtn = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-main', '保存');
    saveBtn.addEventListener('click', function () {
      let s = parseInt(stemInput.value, 10);
      let o = parseInt(optInput.value, 10);
      if (isNaN(s)) s = 16;
      if (isNaN(o)) o = 15;
      s = Math.max(12, Math.min(30, s));
      o = Math.max(11, Math.min(28, o));
      setFontStem(s); setFontOpt(o); applyFontSetting();
      toast('字体已更新：题干 ' + s + 'px / 选项 ' + o + 'px');
      closePicker();
    });
    foot.appendChild(saveBtn);
    body.appendChild(foot);
    sheet.appendChild(body);
    mask.appendChild(sheet);
    mask.addEventListener('click', function (e) { if (e.target === mask) closePicker(); });
    document.body.appendChild(mask);
    pickerEl = mask;
  }

  // v1.0.11：mode='move' 为错题本「改分组」（移动条目，保留 id/图片/笔记）；默认 collect 为解析页收藏（已收藏也新建独立条目）
  function openPicker(q, mode) {
    closePicker();
    mode = mode || 'collect';
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
    titleRow.appendChild(mkEl('div', 'fb-mk-sheet-title', mode === 'move' ? '移动到哪个分组？' : (isSaved(q) ? '已收藏，仍要收藏（将新增一份）' : '收藏到哪个分组？')));
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
      // v1.0.11：move 模式下底部「从错题本移除」按 _key 精确删除当前条目，避免按 qid 误删同 qid 的所有副本
      const delBtn = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-danger', '从错题本移除');
      delBtn.addEventListener('click', () => { removeItem(mode === 'move' ? (q._key || q.qid) : q.qid); closePicker(); });
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
        row.addEventListener('click', () => { commitPick(q, g.id, mode); });
        parent.appendChild(row);
        if (kids.length) renderGroupNodes(kids, depth + 1, parent);
      });
    }

    function refreshTree() {
      colL.innerHTML = ''; colR.innerHTML = '';
      // v0.3.32：收藏/改分组弹窗顶部提供「未分组」选项（对应 group 为空）
      const ungRow = document.createElement('div');
      ungRow.className = 'fb-mk-node';
      ungRow.style.paddingLeft = '10px';
      ungRow.appendChild(mkEl('span', 'fb-mk-node-arrow', '·'));
      ungRow.appendChild(mkEl('span', 'fb-mk-node-name', '未分组'));
      ungRow.appendChild(mkEl('span', 'fb-mk-node-count', String(state.items.filter(i => !i.group).length)));
      ungRow.addEventListener('click', () => { commitPick(q, '', mode); });
      colL.appendChild(ungRow);
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
        if (res.dup) { toast('同级已有同名分组，直接收藏到「' + groupPathText(groupById(res.dup)) + '」'); commitPick(q, res.dup, mode); return; }
        toast(res.msg); return;
      }
      commitPick(q, res.id, mode);
    });
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { try { ev.preventDefault(); } catch (e) { /* ignore */ } addBtn.click(); } });

    refreshTree();
    mask.appendChild(sheet);
    mask.addEventListener('click', e => { if (e.target === mask) closePicker(); });
    document.body.appendChild(mask);
    pickerEl = mask;
  }

  // v1.0.7：默认分组直存设置（localStorage 持久化）
  const LS_USE_DEFAULT = 'fb_mk_use_default_group';
  const LS_DEFAULT_GID = 'fb_mk_default_group';
  function useDefaultGroup() { try { return localStorage.getItem(LS_USE_DEFAULT) === '1'; } catch (e) { return false; } }
  function setUseDefaultGroup(v) { try { localStorage.setItem(LS_USE_DEFAULT, v ? '1' : '0'); } catch (e) { /* ignore */ } }
  function getDefaultGroupId() {
    try {
      const id = localStorage.getItem(LS_DEFAULT_GID);
      if (id === null || id === undefined || id === '') return '';
      return groupById(id) ? id : ''; // 分组已被删除 → 回退未分组
    } catch (e) { return ''; }
  }
  function setDefaultGroupId(id) { try { localStorage.setItem(LS_DEFAULT_GID, id || ''); } catch (e) { /* ignore */ } refreshDefaultGroupBar(); }
  function defaultGroupLabel() {
    const id = getDefaultGroupId();
    const g = id ? groupById(id) : null;
    return g ? groupPathText(g) : '未分组';
  }
  function refreshDefaultGroupBar() {
    const bar = document.querySelector('.fb-mk-entry-dg');
    if (bar) bar.textContent = '默认 → ' + defaultGroupLabel();
  }
  /* v1.0.7：跳过分组选择弹窗，直接按指定分组收藏（默认分组直存模式） */
  function commitPickDirect(q, gid) {
    // v1.0.11：已收藏题也一律新建独立条目（可再收藏到别的分组），不再改分组
    saveItem(q, gid);
  }

  // v1.0.11：commitPick 区分两种语义——
  //   collect（解析页收藏）：已收藏题也一律新建独立条目（可再收藏到别的分组），不删除原条目；
  //   move（错题本改分组）：按 _key 精确定位原条目，仅更新其 group，条目本体（题干/图片/笔记）随分组自然迁移，原分组不再保留该条。
  function commitPick(q, gid, mode) {
    if (mode === 'move') {
      const key = q && q._key ? q._key : (q && q.qid ? q.qid : '');
      let target = null;
      for (let i = 0; i < state.items.length; i++) {
        const it = state.items[i];
        if ((it.id && it.id === key) || (it.qid && it.qid === key)) { target = it; break; }
      }
      if (!target) { toast('未找到该条目，可能已被删除'); closePicker(); return; }
      if ((target.group || '') === (gid || '')) { toast('已在该分组，无需移动'); closePicker(); return; }
      target.group = gid || '';
      target.updatedAt = Date.now();
      persist(); refreshBadge(); if (renderNotebook) renderNotebook(); scheduleUpload();
      const g = gid ? groupById(gid) : null;
      toast('已移动到「' + (g ? groupPathText(g) : '未分组') + '」');
      closePicker();
      return;
    }
    // v1.0.11：已收藏题也一律新建独立条目（可再收藏到别的分组），不再改分组
    saveItem(q, gid);
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
      // v0.3.32：删除后保持右栏列表滚动位置，避免整页重建跳回第一题
      const list = document.querySelector('.fb-mk-question-list');
      const savedTop = list ? list.scrollTop : 0;
      removeItem(key);
      const list2 = document.querySelector('.fb-mk-question-list');
      if (list2) list2.scrollTop = savedTop;
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
          // v1.0.3：轮询内部通过按钮实时重定位题根，不再依赖注入时捕获的 root（SPA 重建后可能失联）
          // v1.0.2：点击收藏立即开始轮询抓取，直到 来源/正确答案/你的答案 三项齐全后弹窗确认，
          // 解决背题模式解析区渲染时序导致的 source/correctAnswer 空值问题。
          if (inner.dataset.collecting === '1') { toast('正在抓取本题，请稍候…'); return; }
          function startCollect() {
            inner.dataset.collecting = '1';
            const oldTxt = inner.textContent;
            inner.textContent = '抓取中…';
            inner.classList.add('fb-mk-fav-btn-loading');
            function finish() {
              inner.dataset.collecting = '';
              inner.textContent = oldTxt;
              inner.classList.remove('fb-mk-fav-btn-loading');
            }
            pollCapture(inner, 600).then(function (q) {
              if (!q || !q.stem) { finish(); toast('没识别到当前题目，请确认已打开题目详情'); return; }
              if (!q.qid && wrap.dataset.qid && wrap.dataset.stem === q.stemHash) q.qid = wrap.dataset.qid;
              showCaptureVerify(q, function (result) {
                // v1.0.6：来源/正确答案/你的答案/笔记全部从弹窗回传，后续 openPicker + saveItem 能拿到
                if (result) {
                  if (result.source !== undefined) q.source = (result.source || '').trim();
                  if (result.correctAnswer !== undefined) q.correctAnswer = result.correctAnswer;
                  if (result.yourAnswer !== undefined) q.yourAnswer = result.yourAnswer;
                  if (result.note !== undefined) q.note = result.note;
                }
                finish();
                // v1.0.7：开启默认分组直存时，跳过分组选择弹窗，直接存入默认分组
                if (useDefaultGroup()) {
                  commitPickDirect(q, getDefaultGroupId());
                  closePicker();
                } else {
                  openPicker(q);
                }
              }, function () {
                finish(); closePicker();
              });
            });
          }
          startCollect();
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
      // v1.0.10：已收藏按钮改为「仍要收藏」，允许重新入库不同分组
      const txt = (qid && findItemByQid(qid)) ? '已收藏 · 仍要收藏' : favButtonHtml();
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
   * 5. 错题本页面（#/mistakes）+ 悬浮入口 + 徽章
   * ===================================================== */
  let renderNotebook = null;

  // 错题本是否处于打开状态（用内存标志，不依赖站点路由 hash，
  // 避免 hash 被题库自身路由抢回去导致「点了没反应」）
  let notebookOpen = false;

  function clickLog(step, extra) {
    try {
      const arr = window.__fbMkClickLog || (window.__fbMkClickLog = []);
      arr.push({ t: Date.now(), step: step, extra: extra === undefined ? null : String(extra).slice(0, 200) });
      if (arr.length > 40) arr.shift();
    } catch (e) { /* ignore */ }
  }

  function openNotebook() {
    clickLog('openNotebook:enter');
    try {
      notebookOpen = true;
      mountNotebook();
      clickLog('openNotebook:done', document.querySelector('.fb-mk-page') ? 'page=1' : 'page=0');
      return true;
    } catch (e) {
      clickLog('openNotebook:error', errText(e));
      try { toast('打开错题本失败：' + errText(e), 6000); } catch (_) { /* ignore */ }
      return false;
    }
  }

  /* ---------------- 6.1 分类编辑弹窗（重命名 / 新增子分类 / 删除） ----------------
   * 入口：错题本页面每个分组按钮右侧的「⋯」。变更只涉及 state.groups 与错题归属，
   * 复用现有持久化（persist）、页面重渲染（renderNotebook）与 WebDAV 同步（scheduleUpload + 分组墓碑）。
   */
  let groupEditorEl = null;
  function closeGroupEditor() {
    if (groupEditorEl && groupEditorEl.parentNode) groupEditorEl.parentNode.removeChild(groupEditorEl);
    groupEditorEl = null;
  }

  function openGroupEditor(gid) {
    closeGroupEditor();
    if (gid !== '' && !groupById(gid)) { toast('分组不存在（可能已被删除）'); return; }
    const mask = document.createElement('div');
    mask.className = 'fb-mk-mask fb-mk-editor';
    const card = document.createElement('div');
    card.className = 'fb-mk-card';
    mask.appendChild(card);
    mask.addEventListener('click', ev => { if (ev.target === mask) closeGroupEditor(); });

    const rootGid = gid === '' ? '' : gid;
    const rootName = gid === '' ? '全部' : groupPathText(groupById(gid));

    function render() {
      card.textContent = '';
      const g = gid === '' ? null : groupById(gid);
      if (gid !== '' && !g) { closeGroupEditor(); return; }
      card.appendChild(mkEl('div', 'fb-mk-title', '编辑分类'));
      card.appendChild(mkEl('div', 'fb-mk-sub', '当前：' + rootName + (gid !== '' ? ' · 第 ' + groupLevel(g) + ' 级 · 含子分组共 ' + groupItemCount(g.id) + ' 题' : '（根下）')));

      // (1) 重命名（非根节点才显示）
      if (gid !== '') {
        const r1 = document.createElement('div');
        r1.className = 'fb-mk-formrow';
        r1.appendChild(mkEl('label', 'fb-mk-label', '重命名'));
        const row1 = document.createElement('div');
        row1.className = 'fb-mk-newline';
        const nameInp = mkEl('input', 'fb-mk-input');
        nameInp.value = g.name;
        nameInp.maxLength = 30;
        const nameBtn = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-main', '保存名称');
        nameBtn.addEventListener('click', () => {
          const res = renameGroup(gid, nameInp.value);
          if (!res.ok) { toast(res.msg); return; }
          if (res.unchanged) { toast('名称没有变化'); return; }
          commitGroupChange('已重命名为「' + res.name + '」');
          render();
        });
        nameInp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { try { ev.preventDefault(); } catch (e) { /* ignore */ } nameBtn.click(); } });
        row1.appendChild(nameInp); row1.appendChild(nameBtn);
        r1.appendChild(row1);
        card.appendChild(r1);
      }

      // (2) 新增子分类
      const deepest = gid === ''
        ? childGroups('').some(c => groupLevel(c) + 1 >= MAX_GROUP_DEPTH)
        : groupLevel(g) >= MAX_GROUP_DEPTH;
      const r2 = document.createElement('div');
      r2.className = 'fb-mk-formrow';
      r2.appendChild(mkEl('label', 'fb-mk-label', '新增子分类'));
      const row2 = document.createElement('div');
      row2.className = 'fb-mk-newline';
      const subInp = mkEl('input', 'fb-mk-input');
      const subBtn = mkEl('button', 'fb-mk-gbtn', '新建子分类');
      if (deepest) {
        subInp.disabled = true; subBtn.disabled = true;
        subInp.placeholder = '已是第 ' + MAX_GROUP_DEPTH + ' 级，不能再建子分类';
      } else {
        subInp.placeholder = '子分类名称，例如：三角函数';
        subBtn.addEventListener('click', () => {
          const res = createGroup(subInp.value, gid);
          if (!res.ok) { toast(res.msg); return; }
          commitGroupChange('已新建子分类「' + res.name + '」');
          render();
        });
        subInp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { try { ev.preventDefault(); } catch (e) { /* ignore */ } subBtn.click(); } });
      }
      row2.appendChild(subInp); row2.appendChild(subBtn);
      r2.appendChild(row2);
      r2.appendChild(mkEl('div', 'fb-mk-tip', deepest ? ('「' + (gid === '' ? '全部' : g.name) + '」已是第 ' + MAX_GROUP_DEPTH + ' 级，不能再建子分类') : ('同级不允许同名；最多 ' + MAX_GROUP_DEPTH + ' 级')));
      card.appendChild(r2);

      // (3) 删除分类（二次确认，避免误删）
      const info = groupDeleteInfo(gid);
      const r3 = document.createElement('div');
      r3.className = 'fb-mk-formrow';
      r3.appendChild(mkEl('label', 'fb-mk-label', '删除分类'));
      const row3 = document.createElement('div');
      row3.className = 'fb-mk-newline';
      const delBtn = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-danger',
        info.allowed ? ('删除该分类' + (info.removed > 1 ? '（含 ' + (info.removed - 1) + ' 个子分类）' : '')) : '不能删除（至少保留一个分组）');
      // v0.3.27：根节点"全部"不允许删除
      if (gid === '') { delBtn.disabled = true; }
      if (!info.allowed) delBtn.disabled = true;
      const confirmBox = document.createElement('div');
      confirmBox.className = 'fb-mk-newline fb-mk-hide';
      const warn = mkEl('div', 'fb-mk-tip', '确认删除「' + (gid === '' ? '全部' : g.name) + '」？' + info.confirm);
      const yes = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-danger', '确认删除');
      const no = mkEl('button', 'fb-mk-gbtn', '取消');
      delBtn.addEventListener('click', () => {
        if (!info.allowed || gid === '') return;
        delBtn.classList.add('fb-mk-hide');
        confirmBox.classList.remove('fb-mk-hide');
      });
      no.addEventListener('click', () => { confirmBox.classList.add('fb-mk-hide'); delBtn.classList.remove('fb-mk-hide'); });
      yes.addEventListener('click', () => {
        const hitActive = !!activeGroup && groupSelfAndDescendants(gid).indexOf(activeGroup) >= 0;
        const res = deleteGroup(gid);
        if (!res.ok) { toast(res.msg); return; }
        if (hitActive) activeGroup = res.fallbackId || UNGROUPED_KEY;
        closeGroupEditor();
        commitGroupChange('已删除分类「' + res.name + '」' + (res.moved ? '，' + res.moved + ' 道题已移到' + (res.fallbackName ? '「' + res.fallbackName + '」' : '未分组') : ''));
      });
      row3.appendChild(delBtn);
      confirmBox.appendChild(warn); confirmBox.appendChild(yes); confirmBox.appendChild(no);
      r3.appendChild(row3);
      r3.appendChild(confirmBox);
      r3.appendChild(mkEl('div', 'fb-mk-tip', info.allowed ? info.tip : '至少要保留一个分组，请先新建或保留其它分组。'));
      card.appendChild(r3);

      const foot = document.createElement('div');
      foot.className = 'fb-mk-foot';
      const close = mkEl('button', 'fb-mk-gbtn', '关闭');
      close.addEventListener('click', closeGroupEditor);
      foot.appendChild(close);
      card.appendChild(foot);
    }

    render();
    document.body.appendChild(mask);
    groupEditorEl = mask;
  }

  function mountNotebook() {
    // 与站点路由解耦：页面不存在就创建，已存在就重渲染，绝不因路由变化而放弃挂载
    let page = document.querySelector('.fb-mk-page');
    if (!page) {
      page = document.createElement('div');
      page.className = 'fb-mk-page';
      document.body.appendChild(page);
    }
    if (renderNotebook) renderNotebook();
  }

  function closeNotebook() {
    notebookOpen = false;
    try { closeGroupEditor(); } catch (e) { /* ignore */ }
    const p = document.querySelector('.fb-mk-page');
    if (p && p.parentNode) p.parentNode.removeChild(p);
    clickLog('closeNotebook');
  }

  renderNotebook = function () {
    const page = document.querySelector('.fb-mk-page');
    if (!page) return;
    page.innerHTML = '';
    // v0.3.24：每次重渲染先复位列布局标记（两栏布局分支会重新加上，避免切回双列时残留）
    page.classList.remove('fb-mk-page-cols');
    const box = document.createElement('div');
    box.className = 'fb-mk-wrap';

    const head = document.createElement('div');
    head.className = 'fb-mk-head';
    head.appendChild(mkEl('h2', 'fb-mk-h2', '我的错题本（' + state.items.length + '）'));
    const tools = document.createElement('div');
    tools.className = 'fb-mk-tools';
    const bFont = mkEl('button', 'fb-mk-gbtn', '字体');
    bFont.title = '调节题干与选项字体大小（分开设置）';
    bFont.addEventListener('click', openFontSetting);
    const bAns = mkEl('button', 'fb-mk-gbtn' + (showAnswers ? ' fb-mk-gbtn-on' : ''), showAnswers ? '隐藏答案' : '显示答案');
    bAns.title = showAnswers ? '隐藏正确答案 / 你的答案与选项高亮' : '显示正确答案 / 你的答案与选项高亮';
    bAns.addEventListener('click', () => {
      // v1.0.8：显示/隐藏答案后停留在当前题，不跳回顶部——先记住滚动位置，重渲染后恢复
      const sc = page.querySelector('.fb-mk-three-col .fb-mk-question-list') || page;
      const top = sc.scrollTop;
      showAnswers = !showAnswers;
      renderNotebook();
      requestAnimationFrame(() => {
        const p2 = document.querySelector('.fb-mk-page');
        if (!p2) return;
        const sc2 = p2.querySelector('.fb-mk-three-col .fb-mk-question-list') || p2;
        sc2.scrollTop = top;
      });
    });
    const bExport = mkEl('button', 'fb-mk-gbtn', '导出 JSON');
    bExport.addEventListener('click', exportJson);
    const bSync = mkEl('button', 'fb-mk-gbtn', '立即同步');
    bSync.addEventListener('click', () => { scheduleUpload('manual'); });
    const bPull = mkEl('button', 'fb-mk-gbtn', '从远端拉取');
    bPull.addEventListener('click', () => { davPull(false).catch(() => {}); });
    const bCfg = mkEl('button', 'fb-mk-gbtn', 'WebDAV 设置');
    bCfg.addEventListener('click', openWebdavModal);
    const bBack = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-main', '返回刷题');
    bBack.addEventListener('click', () => { try { closeNotebook(); } catch (e) { toast('关闭失败'); } });
    const bImport = mkEl('button', 'fb-mk-gbtn', '替换导入 JSON');
    bImport.addEventListener('click', function () { importJson('replace'); });
    const bMerge = mkEl('button', 'fb-mk-gbtn', '合并导入 JSON');
    bMerge.addEventListener('click', function () { importJson('merge'); });
    // v0.3.26：已移除双列/两栏切换按钮，错题本固定两栏排版
    tools.appendChild(bFont); tools.appendChild(bAns); tools.appendChild(bExport); tools.appendChild(bImport); tools.appendChild(bMerge);
    tools.appendChild(bSync); tools.appendChild(bPull); tools.appendChild(bCfg);
tools.appendChild(bBack);
    head.appendChild(tools);
    box.appendChild(head);

    const cfgLine = mkEl('div', 'fb-mk-sub', davIsConfigured() ?
      ('WebDAV：' + davGetCfg().host + ' · 路径 ' + davGetCfg().path + (davReqBrief() ? ' · 最近请求 ' + davReqBrief() : '')) :
      'WebDAV：未配置（点「WebDAV 设置」）');
    box.appendChild(cfgLine);
    const watermark = document.createElement('span');
    watermark.style.cssText = 'font-size:11px;color:#999;font-style:italic;margin-left:8px;user-select:none;';
    watermark.textContent = '粉笔脚本君出品';
    cfgLine.appendChild(watermark);

    // v0.3.23：显示收藏分类——移植粉笔官网「错题本分类」keypoint-tree 样式
    // 每个分组节点为单行 flex：箭头方块 → 分类名 → 题数 → 「⋯」编辑按钮；子分组左侧缩进；
    // 交互保留（v0.3.7 语义）：点箭头方块 = 展开 / 收起下级；点分类名 = 只筛选该分组（含全部后代）；
    // 点「⋯」= 打开分类编辑（重命名 / 新增子分类 / 删除）；「全部」入口 + 一键展开/收起开关 + 激活分组蓝色高亮保留
    const filter = document.createElement('div');
    filter.className = 'fb-mk-filter fb-mk-kp-tree';
    const active = activeGroup || '';
    // 保证当前激活分组在树中可见：自动展开其祖先链
    (function ensureExpanded() {
      let g = active ? groupById(active) : null;
      while (g && g.parentId) { expandedGroups[g.parentId] = true; g = groupById(g.parentId); }
    })();

    // 分类分组「一键展开 / 收起」开关：切换所有分组展开/收起状态，默认全部展开（置于分类卡片右上角）
    const toggleCol = document.createElement('div');
    toggleCol.className = 'fb-mk-kp-head';
    const toggleBtn = mkEl('button', 'fb-mk-tag', allExpanded ? '收起子分组' : '展开子分组');
    toggleBtn.title = allExpanded ? '一键收起所有子分组' : '一键展开所有子分组';
    toggleBtn.addEventListener('click', () => { allExpanded = !allExpanded; expandedGroups = {}; renderNotebook(); });
    toggleCol.appendChild(toggleBtn);
    filter.appendChild(toggleCol);

    // 「全部」入口：粉笔原生行样式（占位箭头方块置灰 + 分类名 + 总题数）
    const allRow = document.createElement('div');
    allRow.className = 'fb-mk-kp-row' + (active ? '' : ' on');
    allRow.appendChild(mkEl('span', 'fb-mk-kp-arrow off', '·'));
    // 2026-10：「全部」= 所有错题（含未分组），未分组作为「全部」的下一层子项
    const groupedCount = state.items.length;
    const allName = mkEl('span', 'fb-mk-kp-name', '全部');
    allName.title = '查看全部错题（共 ' + groupedCount + ' 道，含未分组；点下方分组可只看该分类）';
    allName.addEventListener('click', () => { activeGroup = ''; renderNotebook(); });
    allRow.appendChild(allName);
    allRow.appendChild(mkEl('span', 'fb-mk-kp-num', groupedCount + ' 道'));
    // v0.3.27：「全部」入口旁加编辑按钮，用于在根下新建子分类
    const allOp = mkEl('button', 'fb-mk-kp-more', '⋯');
    allOp.title = '编辑「全部」：新增子分类 / 删除子分类';
    allOp.addEventListener('click', ev => {
      try { ev.stopPropagation(); ev.preventDefault(); } catch (e) { /* ignore */ }
      openGroupEditor('');
    });
    allRow.appendChild(allOp);
    // v0.3.30：把分组拖到「全部」行 = 移到根级末尾（不改变其原有子分组关系）
    allRow.addEventListener('dragover', ev => {
      try {
        if (!dragGid) return;
        ev.preventDefault(); ev.stopPropagation();
        ev.dataTransfer.dropEffect = 'move';
        clearGroupDropMarks(filter);
        allRow.classList.add('fb-mk-drop-inside');
      } catch (e) { /* ignore */ }
    });
    allRow.addEventListener('drop', ev => {
      try {
        ev.preventDefault(); ev.stopPropagation();
        if (!dragGid) return;
        const srcName = groupById(dragGid) ? groupById(dragGid).name : '';
        applyGroupDrop(dragGid, 'inside', null);
        dragGid = '';
        clearGroupDropMarks(filter);
        commitGroupDrag('已把分组移到根级：' + srcName);
      } catch (e) { /* ignore */ }
    });
    filter.appendChild(allRow);

    // v0.3.32：未分组入口——无分组（group 为空）的题自动归集到这里，不再混在「全部」；
    // 2026-10：作为「全部」的下一层子项展示（包 .fb-mk-kp-children 缩进一级），结构为 全部 → 未分组
    const ungCount = state.items.filter(i => !i.group).length;
    const ungRow = document.createElement('div');
    ungRow.className = 'fb-mk-kp-row' + (activeGroup === UNGROUPED_KEY ? ' on' : '');
    ungRow.appendChild(mkEl('span', 'fb-mk-kp-arrow off', '·'));
    const ungName = mkEl('span', 'fb-mk-kp-name', '未分组');
    ungName.title = '未归入任何分类的错题（共 ' + ungCount + ' 道）';
    ungName.addEventListener('click', () => { activeGroup = UNGROUPED_KEY; renderNotebook(); });
    ungRow.appendChild(ungName);
    ungRow.appendChild(mkEl('span', 'fb-mk-kp-num', ungCount + ' 道'));
    const ungBox = document.createElement('div');
    ungBox.className = 'fb-mk-kp-children';
    ungBox.appendChild(ungRow);
    filter.appendChild(ungBox);

    // 分组树（粉笔原生样式）：每行 = 箭头方块 + 分类名 + 题数 + 「⋯」编辑按钮；有子分组可点箭头展开/收起；子分组递归缩进
    function buildKpNode(g, depth) {
      const wrap = document.createElement('div');
      wrap.className = 'fb-mk-kp-node';
      const row = document.createElement('div');
      row.className = 'fb-mk-kp-row' + (!!activeGroup && activeGroup === g.id ? ' on' : '');
      const kids = childGroups(g.id);
      const expanded = isExpanded(g.id);
      const cnt = groupItemCount(g.id);
      const arrow = mkEl('span', 'fb-mk-kp-arrow' + (kids.length ? '' : ' off'), kids.length ? (expanded ? '▾' : '▸') : '·');
      if (kids.length) {
        arrow.title = (expanded ? '收起子分组：' : '展开子分组：') + g.name;
        arrow.addEventListener('click', ev => {
          try { ev.stopPropagation(); ev.preventDefault(); } catch (e) { /* ignore */ }
          expandedGroups[g.id] = !isExpanded(g.id);
          renderNotebook();
        });
      }
      row.appendChild(arrow);
      const name = mkEl('span', 'fb-mk-kp-name', g.name);
      name.title = groupPathText(g) + ' · 含子分组共 ' + cnt + ' 题';
      name.addEventListener('click', () => { activeGroup = g.id; renderNotebook(); });
      row.appendChild(name);
      row.appendChild(mkEl('span', 'fb-mk-kp-num', cnt + ' 道'));
      // 分类编辑入口（胶囊按钮）
      const op = mkEl('button', 'fb-mk-kp-more', '⋯');
      op.title = '编辑「' + g.name + '」：重命名 / 新增子分类 / 删除';
      op.addEventListener('click', ev => {
        try { ev.stopPropagation(); ev.preventDefault(); } catch (e) { /* ignore */ }
        openGroupEditor(g.id);
      });
      row.appendChild(op);
      // v0.3.30：分组树拖拽——拖拽手柄（行内三点拖拽图标），只通过手柄触发 dragstart
      // 放在「⋯」编辑按钮之前，箭头/分类名/题数之后
      const handle = mkEl('span', 'fb-mk-drag-handle', '⠿');
      handle.title = '拖拽分组排序/重排';
      handle.style.cursor = 'grab';
      handle.style.marginLeft = '8px';
      handle.style.flexShrink = '0';
      // v0.3.31：只有手柄本身可拖，整行禁拖
      row.draggable = false;
      handle.draggable = true;
      row.insertBefore(handle, op);
      row.addEventListener('dragstart', ev => {
        try {
          const t = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target ? ev.target.parentElement : null);
          if (!t || !t.closest('.fb-mk-drag-handle')) { ev.preventDefault(); return; }
          if (t.closest('button')) { ev.preventDefault(); return; } // 从「⋯」编辑按钮上不启动拖拽
          dragGid = g.id;
          row.classList.add('fb-mk-dragging');
          ev.dataTransfer.effectAllowed = 'move';
          try { ev.dataTransfer.setData('text/plain', g.id); } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
      });
      row.addEventListener('dragover', ev => {
        try {
          if (!dragGid) return;
          ev.preventDefault(); ev.stopPropagation();
          ev.dataTransfer.dropEffect = 'move';
          clearGroupDropMarks(filter);
          const rect = row.getBoundingClientRect();
          const y = rect.height > 0 ? (ev.clientY - rect.top) / rect.height : 0;
          const mode = y < DRAG_MID_RATIO ? 'before' : (y > 1 - DRAG_MID_RATIO ? 'after' : 'inside');
          if (!groupDropValid(dragGid, mode, g.id)) { row.classList.add('fb-mk-drop-no'); return; }
          row.classList.add(mode === 'before' ? 'fb-mk-drop-top' : (mode === 'after' ? 'fb-mk-drop-bottom' : 'fb-mk-drop-inside'));
        } catch (e) { /* ignore */ }
      });
      row.addEventListener('drop', ev => {
        try {
          ev.preventDefault(); ev.stopPropagation();
          if (!dragGid) return;
          const rect = row.getBoundingClientRect();
          const y = rect.height > 0 ? (ev.clientY - rect.top) / rect.height : 0;
          const mode = y < DRAG_MID_RATIO ? 'before' : (y > 1 - DRAG_MID_RATIO ? 'after' : 'inside');
          if (!groupDropValid(dragGid, mode, g.id)) { clearGroupDropMarks(filter); dragGid = ''; toast('不能拖到该位置：会拖到自身分组内或超过 4 级上限'); return; }
          const srcName = groupById(dragGid) ? groupById(dragGid).name : '';
          applyGroupDrop(dragGid, mode, g.id);
          dragGid = '';
          clearGroupDropMarks(filter);
          commitGroupDrag('已移动分组：' + srcName);
        } catch (e) { /* ignore */ }
      });
      row.addEventListener('dragend', () => {
        try { dragGid = ''; clearGroupDropMarks(filter); } catch (e) { /* ignore */ }
      });
      wrap.appendChild(row);
      if (kids.length && expanded) {
        const kidBox = document.createElement('div');
        kidBox.className = 'fb-mk-kp-children';
        kids.forEach(k => kidBox.appendChild(buildKpNode(k, depth + 1)));
        wrap.appendChild(kidBox);
      }
      return wrap;
    }
    // 2026-10：层级结构调整——顶层只有「全部」一个节点，所有真实分组（含根级）都是「全部」的下一层，
    // 与「未分组」同级缩进；未分组为哨兵行（无 ⋯ 编辑按钮），不可删除。
    const rootKids = document.createElement('div');
    rootKids.className = 'fb-mk-kp-children';
    childGroups('').forEach(g => rootKids.appendChild(buildKpNode(g, 0)));
    filter.appendChild(rootKids);
    // v0.3.30：拖到分组树空白处 = 移到根级末尾（行内已 stopPropagation，这里的 closest 兜底防误判）
    filter.addEventListener('dragover', ev => {
      try {
        if (!dragGid) return;
        if (ev.target && ev.target.closest && ev.target.closest('.fb-mk-kp-row')) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        clearGroupDropMarks(filter);
        filter.classList.add('fb-mk-drop-root');
      } catch (e) { /* ignore */ }
    });
    filter.addEventListener('drop', ev => {
      try {
        if (ev.target && ev.target.closest && ev.target.closest('.fb-mk-kp-row')) return;
        ev.preventDefault();
        if (!dragGid) return;
        const srcName = groupById(dragGid) ? groupById(dragGid).name : '';
        applyGroupDrop(dragGid, 'inside', null);
        dragGid = '';
        clearGroupDropMarks(filter);
        commitGroupDrag('已把分组移到根级：' + srcName);
      } catch (e) { /* ignore */ }
    });
    box.appendChild(filter);

    const activeIds = active ? groupSelfAndDescendants(active) : null;
    // 2026-10：「全部」= 所有错题（含未分组）；未分组作为「全部」的下一层子项，点「未分组」只看未分组题
    let listItems;
    if (active === UNGROUPED_KEY) {
      listItems = state.items.filter(i => !i.group);
    } else if (!active) {
      listItems = state.items.slice();
    } else {
      listItems = state.items.filter(i => !!i.group && activeIds.indexOf(i.group) >= 0);
    }
    // 2026-10：列表统一按收藏时间倒序（后添加的在前）
    listItems.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!listItems.length) {
      if (active === UNGROUPED_KEY) {
        toast('还没有未分组的错题');
      } else if (active) {
        toast('当前分组（含子分组）还没有错题');
      } else {
        box.appendChild(mkEl('div', 'fb-mk-empty', '这里还没有错题。去刷题页面点右上角「收藏错题」试试。'));
      }
    }
    // v0.3.11 性能修复：卷内序号改为渲染前一次性构建索引（旧版保留，v0.3.27 打开原题按钮已移除但 volIndex 不再使用）
    const volIndex = null;
    // v0.3.19：页面左右两列卡片流——外层 Grid 容器统一包裹所有卡片（双列 1fr 1fr，窄屏回退单列）
    const grid = document.createElement('div');
    grid.className = 'fb-mk-grid';
    listItems.forEach(it => {
      const g = state.groups.find(x => x.id === it.group);
      const cardEl = document.createElement('div');
      // v0.3.18：隐藏答案状态给卡片加 fb-mk-answers-off（选项绿色/红色高亮由 CSS 统一隐藏）
      cardEl.className = 'fb-mk-item' + (showAnswers ? '' : ' fb-mk-answers-off');
      // v0.3.19：页面左右两列卡片流——外层 .fb-mk-grid 双列 Grid，卡片自身完整（题干/选项/笔记/操作不拆）
      const meta = mkEl('div', 'fb-mk-item-meta',
        (g ? groupPathText(g) : '未分组') +
        (it.source ? ' · ' + it.source : '') +
        ' · ' + davFormatTime(new Date(it.createdAt || Date.now())) +
        (showAnswers && it.correctAnswer ? ' · 正确答案 ' + it.correctAnswer : '') +
        (showAnswers && it.yourAnswer ? ' · 你的答案 ' + it.yourAnswer : ''));
      cardEl.appendChild(meta);
      // v0.3.26：题干/选项（含材料）与笔记左右并排——qmain 为 flex 容器，
      // 左列 qbody 放材料+题干+选项，右列 note 放笔记（见下方笔记区块）
      const qmain = document.createElement('div');
      qmain.className = 'fb-mk-qmain';
      const qbody = document.createElement('div');
      qbody.className = 'fb-mk-qbody';
      // v0.3.16：资料分析收藏题展示组内材料板块（正文 + base64 图片），置于题干之前
      if (it.material || it.materialImages) {
        const matDiv = mkEl('div', 'fb-mk-material', it.material || '');
        appendBase64Imgs(matDiv, it.materialImages, 'fb-mk-img');
        qbody.appendChild(matDiv);
      }
      const stemDiv = document.createElement('div');
      stemDiv.className = 'fb-mk-stem';
      stemDiv.innerHTML = stripHTML(it.stem || '(题干缺失)');
      appendBase64Imgs(stemDiv, it.stemImage, 'fb-mk-img');
      qbody.appendChild(stemDiv);
      const opts = document.createElement('div');
      opts.className = 'fb-mk-opts';
      (it.options || []).forEach(o => {
        // v0.3.18：隐藏答案时同时去掉 ✓ / ✗ 正确错误标记字符
        const note = (showAnswers ? (o.correct ? ' ✓' : '') + (o.chosen && !o.correct ? ' ✗' : '') : '');
        const txt = o.letter + '. ' + (o.label ? o.label : '(正文缺失)') + note;
        const optEl = document.createElement('div');
        optEl.className = 'fb-mk-opt' + (o.correct ? ' right' : '') + (o.chosen && !o.correct ? ' wrong' : '');
        optEl.appendChild(mkEl('span', 'fb-mk-opt-txt', txt));
        appendBase64Imgs(optEl, o.image, 'fb-mk-img');
        opts.appendChild(optEl);
      });
      qbody.appendChild(opts);
      qmain.appendChild(qbody);
      // v0.3.26：笔记板块置于题干与选项右侧并排（qmain 右列），不再放在题干/选项下方
      // v0.3.27：笔记占满右侧空白（flex:1），不再固定 400px
      {
        const noteBox = document.createElement('div');
        noteBox.className = 'fb-mk-note';
        noteBox.appendChild(mkEl('div', 'fb-mk-note-label', '笔记'));
        const noteTa = document.createElement('textarea');
        noteTa.className = 'fb-mk-note-input';
        noteTa.placeholder = '记录本题的思路、易错点…';
        noteTa.value = it.note || '';
        noteBox.appendChild(noteTa);
        const noteRow = document.createElement('div');
        noteRow.className = 'fb-mk-note-row';
        const noteSave = mkEl('button', 'fb-mk-gbtn', '保存笔记');
        noteSave.addEventListener('click', () => {
          const val = (noteTa.value || '').trim();
          if ((it.note || '') === val) { toast('笔记内容未变化'); return; }
          it.note = val;
          it.updatedAt = Date.now();
          persist(); scheduleUpload();
          toast('笔记已保存');
        });
        noteRow.appendChild(noteSave);
        // 与"保存笔记"同行：改分组 + 删除
        const mv = mkEl('button', 'fb-mk-gbtn', '改分组');
        // v1.0.11：错题本「改分组」= 移动——携带完整字段（题干/图片/材料/选项/答案/笔记）与条目唯一 id，
        // 以 move 模式打开分组弹窗：commitPick 仅改目标条目的 group，图片等随条目迁移，原分组不再保留
        mv.addEventListener('click', () => {
          openPicker({
            qid: it.qid, _key: (it.id || it.qid), stem: it.stem, stemImage: it.stemImage,
            material: it.material, materialImages: it.materialImages,
            options: it.options, correctAnswer: it.correctAnswer, yourAnswer: it.yourAnswer,
            url: it.url, qkey: it.qkey, anchorId: it.anchorId, anchorName: it.anchorName,
            stemHash: it.stemHash, note: it.note, subject: it.subject
          }, 'move');
        });
        const rm = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-danger', '删除');
        rm.addEventListener('click', () => { askRemoveItem(it); });
        noteRow.appendChild(mv);
        noteRow.appendChild(rm);
        noteBox.appendChild(noteRow);
        qmain.appendChild(noteBox);
      }
      cardEl.appendChild(qmain);
      // acts 不再需要（按钮已移入 noteRow），仅保留容器用于将来扩展
      // acts.className = 'fb-mk-item-acts';
      // acts.appendChild(mv); acts.appendChild(rm);
      // cardEl.appendChild(acts);
      grid.appendChild(cardEl);
    });

    // v0.3.24：两栏布局包裹（左分组树 + 右题目列表；独立右侧笔记面板已移除，笔记直接在卡片内编辑）
    // v0.3.26：两栏为唯一排版，双列卡片流（grid）与切换按钮已移除，无条件走两栏分支
    // v0.3.24：两栏模式下页面不再整页滚动：外层容器切换为“列布局”样式（flex 纵向铺满视口），
    // 两栏容器高度由 flex:1 自适应视口剩余，彻底规避固定 calc(100vh - 220px) 与页面实际内容叠加造成的底部空白
    page.classList.add('fb-mk-page-cols');
    box.classList.add('fb-mk-wrap-cols');
    const threeCol = document.createElement('div');
    threeCol.className = 'fb-mk-three-col';
    // v0.3.21：读取持久化的左栏宽度（默认 200，未存过或损坏时回退默认；兼容旧 {left,right} 存储）
    const cw = loadColWidths();
    // 左栏：分组树（独立滚动）
    const groupPanel = document.createElement('div');
    groupPanel.className = 'fb-mk-group-panel';
    groupPanel.style.width = cw.left + 'px';
    groupPanel.style.flexBasis = cw.left + 'px';
    groupPanel.appendChild(filter);
    threeCol.appendChild(groupPanel);
    // v0.3.21：左-右分隔条（拖拽调节左栏宽度，双击恢复默认；两栏布局仅保留这一个分隔条）
    threeCol.appendChild(makeColDivider('left'));
    // 右栏：题目列表（每道题完整卡片：题干/选项/卡片内笔记/操作按钮，独立滚动）
    const questionList = document.createElement('div');
    questionList.className = 'fb-mk-question-list';
    questionList.appendChild(grid);
    threeCol.appendChild(questionList);
    box.appendChild(threeCol);
    page.appendChild(box);
  };
  let activeGroup = '';
  // v0.3.32：未分组筛选哨兵（不会与真实分组 id 冲突，真实 id 以 'g' 开头或为 builtin 英文 id）
  const UNGROUPED_KEY = '__ungrouped__';
  // v0.3.18：错题本「显示答案 / 隐藏答案」开关，默认显示
  let showAnswers = true;
  let expandedGroups = {};
  let allExpanded = true;
  // 单节点是否展开：优先取该节点本轮的显式覆盖，未覆盖则跟随全局开关（默认全部展开）
  function isExpanded(id) {
    return Object.prototype.hasOwnProperty.call(expandedGroups, id) ? !!expandedGroups[id] : allExpanded;
  }

  /* v0.3.24：独立右侧笔记面板与 updateNotePanel / savePanelNote 已移除，
     笔记直接在每道题卡片内编辑（见 renderNotebook 卡片渲染区） */

  /* =====================================================
   * 5.1 v0.3.21：两栏宽度拖拽调节
   *    v0.3.24：三栏合并为两栏，仅保留左栏宽度 140-480px（默认 200），右栏自适应剩余；
   *    宽度持久化到 localStorage（键 fb-mk-col-widths，兼容旧 {left, right} 存储，right 忽略），
   *    双击分隔条恢复默认；拖拽用 mousedown + document mousemove/mouseup，
   *    mouseup 后解绑防止拖出窗口卡死。
   * ===================================================== */
  const COL_WIDTHS_KEY = 'fb-mk-col-widths';
  const COL_MIN = { left: 140 };
  const COL_MAX = { left: 480 };
  const COL_DEF = { left: 238 }; // v0.3.29：默认左栏宽 200px + 1cm（≈38px）

  function loadColWidths() {
    const w = { left: COL_DEF.left };
    try {
      const v = JSON.parse(gmv.get(COL_WIDTHS_KEY, ''));
      if (v && typeof v === 'object') {
        if (typeof v.left === 'number' && v.left >= COL_MIN.left && v.left <= COL_MAX.left) {
          // v0.3.29：旧持久化宽度（未带 ver 标记）一次性 +1cm（38px）迁移，避免重复累加
          if (v.ver === 2) {
            w.left = Math.round(v.left);
          } else {
            w.left = Math.min(COL_MAX.left, Math.round(v.left) + 38);
            saveColWidths(w.left);
          }
        }
      }
    } catch (e) { /* 存储损坏时回退默认 */ }
    return w;
  }
  function saveColWidths(left) {
    try { gmv.set(COL_WIDTHS_KEY, JSON.stringify({ left: Math.round(left), ver: 2 })); } catch (e) { /* ignore */ }
  }
  function applyColWidths(left) {
    const threeCol = document.querySelector('.fb-mk-three-col');
    if (!threeCol) return;
    const gp = threeCol.querySelector('.fb-mk-group-panel');
    if (gp) { gp.style.width = left + 'px'; gp.style.flexBasis = left + 'px'; }
  }
  function makeColDivider(side) {
    const d = document.createElement('div');
    d.className = 'fb-mk-divider';
    d.dataset.side = side;
    d.title = '拖拽调节宽度，双击恢复默认';
    d.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const threeCol = d.closest('.fb-mk-three-col');
      if (!threeCol) return;
      const w = loadColWidths();
      const startX = e.clientX;
      let curLeft = w.left, moved = false;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
      d.classList.add('fb-mk-divider-dragging');
      function onMove(ev) {
        const dx = ev.clientX - startX;
        curLeft = Math.min(COL_MAX.left, Math.max(COL_MIN.left, w.left + dx));
        applyColWidths(curLeft);
        moved = true;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = prevUserSelect;
        d.classList.remove('fb-mk-divider-dragging');
        if (moved) saveColWidths(curLeft);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    d.addEventListener('dblclick', () => {
      applyColWidths(COL_DEF.left);
      saveColWidths(COL_DEF.left);
      toast('已恢复默认栏宽（左栏 238px）');
    });
    return d;
  }

  /* =====================================================
   * 6. WebDAV 配置弹窗
   * ===================================================== */
  function openWebdavModal() {
    const old = document.querySelector('.fb-mk-mask.fb-mk-dav');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const c = davGetCfg();
    const mask = document.createElement('div');
    mask.className = 'fb-mk-mask fb-mk-dav';
    const card = document.createElement('div');
    card.className = 'fb-mk-card fb-mk-card-dav';
    card.appendChild(mkEl('div', 'fb-mk-title', 'WebDAV 同步设置'));

    const fields = [
      { k: 'host', label: '服务器地址', ph: 'https://dav.jianguoyun.com/dav', tip: '坚果云固定用这个地址' },
      { k: 'user', label: '账号', ph: '你的坚果云注册邮箱', tip: '' },
      { k: 'pass', label: '密码', ph: '坚果云「应用密码」', tip: '坚果云必须在 账户信息 → 安全选项 → 添加应用 生成应用密码，填登录密码会一直 401', type: 'password' },
      { k: 'path', label: '保存路径', ph: DAV_PATH_DEF, tip: '相对 WebDAV 根目录的路径；只填文件会按坚果云规则自动补成 ' + DAV_JGY_ROOT + '/文件名' }
    ];
    const inputs = {};
    fields.forEach(f => {
      const row = document.createElement('div');
      row.className = 'fb-mk-formrow';
      row.appendChild(mkEl('label', 'fb-mk-label', f.label));
      const inp = document.createElement('input');
      inp.className = 'fb-mk-input';
      inp.type = f.type || 'text';
      inp.placeholder = f.ph;
      inp.value = c[f.k] || '';
      inputs[f.k] = inp;
      row.appendChild(inp);
      if (f.tip) row.appendChild(mkEl('div', 'fb-mk-tip', f.tip));
      card.appendChild(row);
    });

    const msg = mkEl('div', 'fb-mk-sub', '');
    card.appendChild(msg);

    const foot = document.createElement('div');
    foot.className = 'fb-mk-foot fb-mk-foot-wrap';
    const readForm = () => ({
      host: inputs.host.value, user: inputs.user.value,
      pass: inputs.pass.value, path: inputs.path.value
    });

    const bTest = mkEl('button', 'fb-mk-gbtn', '测试连接');
    bTest.addEventListener('click', () => {
      msg.textContent = '正在测试…';
      davTestConnection(readForm()).then(r => {
        msg.textContent = '连接成功（HTTP ' + r.status + '，通道 ' + r.via + '）；目标文件' +
          (r.fileExists ? '已存在，' + r.bytes + ' 字节' : '尚不存在，首次同步会自动创建');
      }, e => {
        msg.textContent = '连接失败：' + errText(e);
      });
    });

    const bSave = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-main', '保存并同步');
    bSave.addEventListener('click', () => {
      const ok = davSaveCfg(readForm());
      if (!ok) { msg.textContent = '配置已应用，但写入本地存储失败（可能是隐私模式或存储配额已满）'; }
      refreshBadge();
      if (!davIsConfigured()) { msg.textContent = '地址和账号为必填项'; return; }
      msg.textContent = '已保存，正在同步…';
      davPush('manual').then(r => {
        msg.textContent = '同步完成：' + r.count + ' 道题' + (r.created ? '（远端文件已新建）' : '');
        toast('已同步到 WebDAV（' + r.count + ' 道题）');
      }, e => {
        msg.textContent = '同步失败：' + errText(e);
      });
    });

    const bPull = mkEl('button', 'fb-mk-gbtn', '从远端拉取');
    bPull.addEventListener('click', () => {
      davSaveCfg(readForm()); refreshBadge();
      msg.textContent = '正在拉取…';
      davPull(false).then(r => {
        msg.textContent = r.exists ? ('拉取完成：当前 ' + r.items + ' 道题') : '远端还没有文件';
      }, e => { msg.textContent = '拉取失败：' + errText(e); });
    });

    const bDiag = mkEl('button', 'fb-mk-gbtn', '诊断信息');
    bDiag.addEventListener('click', () => {
      msg.textContent = '诊断信息已打印到浏览器控制台（F12 → Console）';
      davLog(davDiagText());
    });

    const bClear = mkEl('button', 'fb-mk-gbtn fb-mk-gbtn-danger', '清空配置');
    bClear.addEventListener('click', () => {
      davClearCfg();
      inputs.host.value = ''; inputs.user.value = ''; inputs.pass.value = ''; inputs.path.value = DAV_PATH_DEF;
      msg.textContent = '已清空配置（远端已同步的文件不会删）';
      refreshBadge();
    });

    const bJgy = mkEl('button', 'fb-mk-gbtn', '一键导入坚果云地址');
    bJgy.addEventListener('click', () => {
      inputs.host.value = 'https://dav.jianguoyun.com/dav/';
      msg.textContent = '已填入坚果云服务器地址（https://dav.jianguoyun.com/dav/）；账号填注册邮箱，密码请填坚果云「账户信息 → 安全选项 → 第三方应用管理」中生成的应用密码（非登录密码）';
    });

    const bClose = mkEl('button', 'fb-mk-gbtn', '关闭');
    bClose.addEventListener('click', () => { if (mask.parentNode) mask.parentNode.removeChild(mask); });

    [bTest, bSave, bPull, bDiag, bClear, bJgy, bClose].forEach(b => foot.appendChild(b));
    card.appendChild(foot);
    mask.appendChild(card);
    mask.addEventListener('click', e => { if (e.target === mask && mask.parentNode) mask.parentNode.removeChild(mask); });
    document.body.appendChild(mask);
  }

  /* =====================================================
   * 7. 导出 / 导入 JSON（配置不含在内，避免密码外泄）
   * ===================================================== */
  function exportJson() {
    const doc = buildDoc();
    const text = JSON.stringify(doc, null, 2);
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'fenbi-mistakes-' + davFormatTime(new Date()).replace(/[: ]/g, '-') + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
      toast('已导出 ' + state.items.length + ' 道题（不含 WebDAV 密码）');
    } catch (e) {
      toast('导出失败：' + errText(e));
    }
  }

  function importJson(mode) {
    // mode: 'replace' = 整表替换；'merge' = 与本地并集合并（较新覆盖较旧）
    var isReplace = (mode !== 'merge');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', function (ev) {
      var f = input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var doc = parseDoc(e.target.result);
          if (!doc) { toast('导入失败：无法解析 JSON'); return; }
          if (!doc.groups || !doc.items) { toast('导入失败：JSON 格式不兼容（缺少 groups/items）'); return; }
          var oldItems = state.items.length, oldGroups = state.groups.length;
          var inItems = (doc.items || []).filter(function (x) { return x && x.id; }).length;
          var inGroups = (doc.groups || []).filter(function (x) { return x && x.id; }).length;

          if (isReplace) {
            // 替换：本地数据整体清空，以文件内容为准（不是并集追加）
            var okReplace = window.confirm(
              '【替换导入】会用文件内容覆盖本地数据，不是追加。\n\n' +
              '现有：' + oldItems + ' 道题 / ' + oldGroups + ' 个分组（将被清空）\n' +
              '文件：' + inItems + ' 道题 / ' + inGroups + ' 个分组\n\n' +
              '覆盖前会自动留一份本地快照。确定替换？'
            );
            if (!okReplace) { toast('已取消导入'); return; }
            // 覆盖前自动留一份本地快照，误替换可回滚（不含 WebDAV 密码，密码在独立存储键）
            try { gmv.set('fbMistakes.bak.beforeImport', JSON.stringify(state)); } catch (e0) { /* 备份失败不阻断 */ }
            var st = replaceDocs(doc);
            persist();
            if (typeof refreshBadge === 'function') refreshBadge();
            if (typeof refreshFavButtons === 'function') refreshFavButtons();
            if (renderNotebook) renderNotebook();
            scheduleUpload('import');
            toast('已替换：' + st.items + ' 道题 / ' + st.groups + ' 个分组');
            return;
          }

          // 合并：保留本地数据，按 id 取并集，同 id 取 updatedAt 较新者
          var okMerge = window.confirm(
            '【合并导入】会把文件内容并入本地，本地已有数据不会丢失。\n\n' +
            '本地：' + oldItems + ' 道题 / ' + oldGroups + ' 个分组\n' +
            '文件：' + inItems + ' 道题 / ' + inGroups + ' 个分组\n\n' +
            '同 id 的题以更新时间较新的为准。确定合并？'
          );
          if (!okMerge) { toast('已取消导入'); return; }
          try { gmv.set('fbMistakes.bak.beforeImport', JSON.stringify(state)); } catch (e1) { /* 备份失败不阻断 */ }
          var mst = mergeDocs(doc);
          persist();
          if (typeof refreshBadge === 'function') refreshBadge();
          if (typeof refreshFavButtons === 'function') refreshFavButtons();
          if (renderNotebook) renderNotebook();
          scheduleUpload('import');
          toast('已合并：共 ' + mst.items + ' 道题 / ' + mst.groups + ' 个分组（导入前 ' + oldItems + ' 道）');
        } catch (err) {
          toast('导入失败：' + errText(err));
        }
      };
      reader.readAsText(f);
    });
    input.click();
  }

  /* =====================================================
   * 8. 悬浮入口 / 徽章 / 全局样式
   * ===================================================== */
  function refreshBadge() {
    // 2026-10-10：移除错题数小红点徽标；同时清理旧版脚本残留的徽标元素
    const b = document.querySelector('.fb-mk-entry-count');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function ensureEntry() {
    let wrap = document.querySelector('.fb-mk-entry');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'fb-mk-entry';
      const btn = document.createElement('button');
      btn.className = 'fb-mk-entry-btn';
      btn.textContent = '错题本';
      btn.addEventListener('click', function () { clickLog('btn:own-click'); openNotebook(); });
      const dragHandle = document.createElement('span');
      dragHandle.className = 'fb-mk-entry-drag';
      dragHandle.textContent = '⠿';
      dragHandle.title = '拖动调整位置';
      const syncBtn = document.createElement('button');
      syncBtn.className = 'fb-mk-entry-sync';
      syncBtn.textContent = '同步';
      syncBtn.style.display = 'none'; // 隐藏同步按钮
      syncBtn.addEventListener('click', () => {
        if (!davIsConfigured()) { openWebdavModal(); return; }
        toast('正在同步…', 15000);
        davPush('manual').then(r => { toast('已同步（' + r.count + ' 道题）'); }, e => { toast('同步失败：' + errText(e), 6000); });
      });
      wrap.appendChild(btn);
      // v1.0.7：错题本按钮下方 收藏设置 + 默认分组快捷栏
      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex'; btnRow.style.flexDirection = 'column'; btnRow.style.alignItems = 'center';
      // 收藏设置按钮（在默认分组栏前面）
      const bDgSetBtn = document.createElement('button');
      bDgSetBtn.className = 'fb-mk-entry-dg-set';
      bDgSetBtn.textContent = '收藏设置';
      bDgSetBtn.title = '默认分组直存开关与默认分组更改';
      bDgSetBtn.addEventListener('click', function (ev) { try { ev.stopPropagation(); } catch (e) { /* ignore */ } openCollectSetting(); });
      btnRow.appendChild(bDgSetBtn);
      // 默认分组快捷栏
      const dgBar = document.createElement('div');
      dgBar.className = 'fb-mk-entry-dg';
      dgBar.style.display = 'none';
      dgBar.title = '当前默认收藏分组（点击更改）';
      dgBar.addEventListener('click', function (ev) { try { ev.stopPropagation(); } catch (e) { /* ignore */ } openDefaultGroupPicker(); });
      btnRow.appendChild(dgBar);
      wrap.appendChild(btnRow);
      wrap.appendChild(dragHandle); wrap.appendChild(syncBtn);
      document.body.appendChild(wrap);
    } else if (!wrap.querySelector('.fb-mk-entry-drag')) {
      // 2026-10-10：旧版 DOM 无拖拽手柄，补建
      const dragHandle = document.createElement('span');
      dragHandle.className = 'fb-mk-entry-drag';
      dragHandle.textContent = '⠿';
      dragHandle.title = '拖动调整位置';
      wrap.appendChild(dragHandle);
    } else if (!wrap.querySelector('.fb-mk-entry-dg')) {
      // v1.0.7：旧版 DOM 补建 收藏设置 + 默认分组栏
      const btnRowP = document.createElement('div');
      btnRowP.style.display = 'flex'; btnRowP.style.flexDirection = 'column'; btnRowP.style.alignItems = 'center';
      const bDgSetBtnP = document.createElement('button');
      bDgSetBtnP.className = 'fb-mk-entry-dg-set';
      bDgSetBtnP.textContent = '收藏设置';
      bDgSetBtnP.title = '默认分组直存开关与默认分组更改';
      bDgSetBtnP.addEventListener('click', function (ev) { try { ev.stopPropagation(); } catch (e) { /* ignore */ } openCollectSetting(); });
      btnRowP.appendChild(bDgSetBtnP);
      const dgBarP = document.createElement('div');
      dgBarP.className = 'fb-mk-entry-dg';
      dgBarP.style.display = 'none';
      dgBarP.title = '当前默认收藏分组（点击更改）';
      dgBarP.addEventListener('click', function (ev) { try { ev.stopPropagation(); } catch (e) { /* ignore */ } openDefaultGroupPicker(); });
      btnRowP.appendChild(dgBarP);
      const btnElP = wrap.querySelector('.fb-mk-entry-btn');
      if (btnElP && btnElP.nextSibling) wrap.insertBefore(btnRowP, btnElP.nextSibling);
      else wrap.appendChild(btnRowP);
    }
    // 2026-10-10：清理旧版脚本已注入的红点徽标残留
    const oldCnt = wrap.querySelector('.fb-mk-entry-count');
    if (oldCnt && oldCnt.parentNode) oldCnt.parentNode.removeChild(oldCnt);
    // 固定左上角浮动 + 恢复记忆位置
    positionEntry(wrap);
    setupEntryDrag(wrap);
    refreshBadge(); refreshDefaultGroupBar();
  }

  // 兜底：即使按钮被 header 内其它层覆盖导致自身 click 收不到，也用捕获阶段的委托点击兜住
  if (!window.__fbMkEntryDelegate) {
    window.__fbMkEntryDelegate = true;
    document.addEventListener('click', function (ev) {
      const t = ev.target;
      if (!t || !t.closest) return;
      const btn = t.closest('.fb-mk-entry-btn');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      clickLog('delegate:capture-hit');
      try { openNotebook(); } catch (e) { clickLog('delegate:error', errText(e)); }
    }, true);
  }

  // 两个矩形是否相交（任一为空/不可见时视为不相交）
  function rectsOverlap(a, b) {
    if (!a || !b || !a.width || !a.height || !b.width || !b.height) return false;
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }

  function entryToFloat(wrap) {
    wrap.classList.add('fb-mk-entry-float');
    if (wrap.parentNode !== document.body) document.body.appendChild(wrap);
  }

  // 重写网页原生 back-btn（<a class="back-btn">）：不删除不隐藏，拦截默认跳转改为跳转目录
  (function hijackBackBtn() {
    const backBtn = document.querySelector('.back-btn');
    if (!backBtn) return;
    if (!backBtn._fbBackHandler) {
      const newHandler = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        try { location.href = 'https://www.fenbi.com/spa/tiku/guide/catalog'; } catch (e) { /* ignore */ }
      };
      newHandler._fbIsHijack = true;
      backBtn._fbBackHandler = newHandler;
      backBtn.addEventListener('click', newHandler, true);
    }
  })();

  // 2026-10-10：入口按钮改为左上角固定浮动，位置可拖拽记忆。
  // 不再做 header-left/back-btn/标题归位，避免与标题重叠；刷新后按 localStorage 恢复上次位置。
  function positionEntry(wrap) {
    try {
      if (wrap.parentNode !== document.body) document.body.appendChild(wrap);
      wrap.classList.add('fb-mk-entry-float');
      applySavedEntryPos(wrap);
    } catch (e) { /* ignore */ }
  }

  function applySavedEntryPos(wrap) {
    let left = 18, top = 18;
    try {
      const raw = localStorage.getItem('fb_mk_entry_pos');
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p.left === 'number' && typeof p.top === 'number') { left = p.left; top = p.top; }
      }
    } catch (e) { /* ignore */ }
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const w = wrap.offsetWidth || 120, h = wrap.offsetHeight || 40;
    left = Math.max(4, Math.min(left, vw - w - 4));
    top = Math.max(4, Math.min(top, vh - h - 4));
    wrap.style.left = left + 'px';
    wrap.style.top = top + 'px';
  }

  // 2026-10-10：拖拽手柄移动浮动按钮，松手后把位置写入 localStorage
  function setupEntryDrag(wrap) {
    if (wrap._fbDragBound) return;
    wrap._fbDragBound = true;
    const handle = wrap.querySelector('.fb-mk-entry-drag');
    if (!handle) return;
    let sx = 0, sy = 0, sl = 0, st = 0, dragging = false;
    handle.addEventListener('pointerdown', function (ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      const r = wrap.getBoundingClientRect();
      sx = ev.clientX; sy = ev.clientY; sl = r.left; st = r.top;
      dragging = true;
      try { handle.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    });
    handle.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      ev.preventDefault();
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const w = wrap.offsetWidth || 120, h = wrap.offsetHeight || 40;
      wrap.style.left = Math.max(4, Math.min(sl + dx, vw - w - 4)) + 'px';
      wrap.style.top = Math.max(4, Math.min(st + dy, vh - h - 4)) + 'px';
    });
    const endDrag = function () {
      if (!dragging) return;
      dragging = false;
      try {
        const r = wrap.getBoundingClientRect();
        localStorage.setItem('fb_mk_entry_pos', JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
      } catch (e) { /* ignore */ }
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  // v0.3.16：把 base64 图片段（'|||' 分隔，多图）渲染为 <img> 追加到容器，max-width 由 CSS 限制
  function appendBase64Imgs(parent, b64Str, cls) {
    if (!parent || !b64Str) return;
    const parts = String(b64Str).split('|||');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      try {
        const img = document.createElement('img');
        img.className = cls || 'fb-mk-img';
        img.src = p;
        img.alt = '';
        parent.appendChild(img);
      } catch (e) { /* ignore */ }
    }
  }

  function mkEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function toast(msg, ms, actionText, action) {
    try {
      let box = document.querySelector('.fb-mk-toast');
      if (!box) { box = document.createElement('div'); box.className = 'fb-mk-toast'; document.body.appendChild(box); }
      box.textContent = '';
      const span = mkEl('span', 'fb-mk-toast-text', msg);
      box.appendChild(span);
      if (actionText && typeof action === 'function') {
        const b = mkEl('button', 'fb-mk-toast-act', actionText);
        b.addEventListener('click', () => { try { action(); } catch (e) { /* ignore */ } if (box.parentNode) box.parentNode.removeChild(box); });
        box.appendChild(b);
      }
      box.classList.add('on');
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { box.classList.remove('on'); }, ms || 2600);
    } catch (e) { davLog(msg); }
  }

  const CSS = [
    '.fb-mk-entry{display:inline-flex;align-items:center;gap:6px;font-size:13px;margin:0;align-self:center;vertical-align:middle;position:relative;z-index:2147483000;pointer-events:auto}',
    '.fb-mk-entry-block{display:flex;width:100%;box-sizing:border-box;margin:6px 0 0}',
    /* 2026-10-10：默认左上角固定浮动，位置可拖拽记忆（localStorage 持久化） */
    '.fb-mk-entry-float{position:fixed;left:18px;top:18px;z-index:2147483000;margin:0;align-self:auto;cursor:grab;user-select:none;touch-action:none}',
    '.fb-mk-entry-drag{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(47,107,255,.12);color:#2f6bff;font-size:13px;line-height:1;cursor:grab;user-select:none;flex:0 0 auto}',
    '.fb-mk-entry-btn,.fb-mk-entry-sync{border:1px solid #0052D9;border-radius:18px;padding:8px 14px;background:#fff;color:#0052D9;cursor:pointer;font-weight:400;font-size:13px}',
    '.fb-mk-entry-sync{background:#20a464}',
    '.fb-mk-fav{position:absolute;right:100%;top:0;display:inline-flex;align-items:center;margin:0;z-index:5}',
    '.fb-mk-fav-btn{border:1px solid #2f6bff;border-radius:6px;background:#fff;color:#2f6bff;padding:3px 8px;font-size:12px;line-height:1.2;white-space:nowrap;cursor:pointer}',
    '.fb-mk-fav-btn-loading{opacity:.55;cursor:wait;pointer-events:none}',
    /* 宿主若原本是 static，补相对定位以承载按钮的 absolute（普通题 .ti 与资料分析小题 app-ti/.questions-container 均适用） */
    '.fb-mk-ti-host{position:relative}',
    /* v0.3.17：资料分析小题按钮的流内样式——降级宿主（app-ti/.questions-container）若把 absolute 按钮顶到容器左侧外部，
       会被 .questions-container/app-resizable 等祖先的 overflow 裁剪导致完全消失；改用流内 inline-flex 内嵌到小题容器顶部，
       不依赖 absolute 贴边定位，保证每道小题旁都可见可点 */
    '.fb-mk-fav-standalone{position:relative;right:auto;top:auto;display:inline-flex;align-items:center;margin:6px 8px 0 0;z-index:6;vertical-align:middle}',
    '.fb-mk-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483200;display:flex;align-items:center;justify-content:center}',
    '.fb-mk-card{background:#fff;border-radius:12px;padding:18px;min-width:340px;max-width:min(560px,92vw);max-height:86vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.25);font-size:14px;color:#222}',
    '.fb-mk-card-dav{min-width:420px}',
    '.fb-mk-title{font-size:16px;font-weight:600;margin-bottom:12px}',
    '.fb-mk-list{display:flex;flex-wrap:wrap;gap:8px;max-height:240px;overflow:auto}',
    '.fb-mk-gbtn{border:1px solid #d6dce8;background:#f7f9fc;color:#243;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:13px}',
    '.fb-mk-gbtn:hover{background:#eef3fb}',
    '.fb-mk-gbtn-main{background:#2f6bff;border-color:#2f6bff;color:#fff}',
    '.fb-mk-gbtn-danger{background:#fff2f2;border-color:#ffc9c9;color:#c22}',
    '.fb-mk-newline{display:flex;gap:8px;margin-top:12px}',
    '.fb-mk-input{flex:1;border:1px solid #d6dce8;border-radius:8px;padding:7px 10px;font-size:13px;outline:none}',
    '.fb-mk-input:focus{border-color:#2f6bff}',
    '.fb-mk-foot{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}',
    '.fb-mk-foot-wrap{flex-wrap:wrap}',
    '.fb-mk-formrow{margin-bottom:12px}',
    '.fb-mk-label{display:block;font-size:12px;color:#66718a;margin-bottom:4px}',
    '.fb-mk-tip{font-size:11px;color:#96a0b5;margin-top:4px;line-height:1.5}',
    '.fb-mk-sub{font-size:12px;color:#66718a;margin-top:6px;line-height:1.6;word-break:break-all}',
    '.fb-mk-page{position:fixed;inset:0;background:#f4f6fb;z-index:2147483100;overflow:auto}',
    '.fb-mk-wrap{max-width:none;width:100%;margin:0 auto;padding:24px 20px 80px;box-sizing:border-box}',
    '.fb-mk-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}',
    '.fb-mk-h2{font-size:20px;margin:0;color:#1b2540}',
    '.fb-mk-tools{display:flex;gap:8px;flex-wrap:wrap}',
    '.fb-mk-filter{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}',
    '.fb-mk-tag{border:1px solid #d6dce8;background:#fff;border-radius:999px;padding:5px 12px;font-size:12px;cursor:pointer;color:#44506b}',
    '.fb-mk-tag.on{background:#2f6bff;border-color:#2f6bff;color:#fff}',
    '.fb-mk-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}',
    // v0.3.26：卡片内题干/选项（含材料）与笔记左右并排
    '.fb-mk-qmain{display:flex;gap:14px;align-items:flex-start}',
    '.fb-mk-qbody{flex:1 1 auto;min-width:0}',
    '@media (max-width:1100px){.fb-mk-qmain{flex-direction:column}.fb-mk-qmain .fb-mk-note{flex:1 1 auto;max-width:none;width:100%}}',
    '.fb-mk-item{background:#fff;border-radius:10px;padding:14px 16px;box-shadow:0 2px 10px rgba(30,50,90,.06);display:flex;flex-direction:column;gap:12px;min-width:0}',
    '@media (max-width:960px){.fb-mk-grid{grid-template-columns:1fr}}',
    '.fb-mk-item-meta{font-size:12px;color:#8c97ad;margin-bottom:6px}',
    '.fb-mk-material{font-size:13px;line-height:1.6;color:#4a5670;background:#f6f8fc;border:1px solid #e4e9f2;border-radius:6px;padding:10px 12px;margin:0 0 8px;white-space:pre-wrap;word-break:break-word}',
    '.fb-mk-stem{font-size:16px;line-height:1.8;color:#1b2540;white-space:pre-wrap;word-break:break-word}',
    '.fb-mk-img{display:block;max-width:100%;height:auto;margin:6px 0;border-radius:4px}',
    '.fb-mk-opts{display:block;margin:8px 0}',
    '.fb-mk-opt{display:block;margin:2px 0;line-height:1.6;border:1px solid #e2e7f0;border-radius:6px;padding:2px 8px;font-size:13px;color:#5b6580;word-break:break-word}',
    '.fb-mk-opt.right{border-color:#20a464;color:#20a464}',
    '.fb-mk-opt.wrong{border-color:#ff5a5f;color:#ff5a5f}',
    '.fb-mk-answers-off .fb-mk-opt.right,.fb-mk-answers-off .fb-mk-opt.wrong{border-color:#e2e7f0;color:#5b6580}',
    // v0.3.26：笔记为题干右侧固定宽列，v0.3.27：固定 400px、textarea 占满可用高度不可拉伸
    '.fb-mk-note{flex:0 0 calc(400px - 3cm);min-width:calc(400px - 3cm);box-sizing:border-box;background:#f6f8fc;border:1px solid #e4e9f2;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column}',
    '.fb-mk-note-label{font-size:12px;font-weight:600;color:#44506b;margin-bottom:6px}',
    '.fb-mk-note-input{width:100%;min-height:140px;box-sizing:border-box;border:1px solid #d6dce8;border-radius:6px;padding:8px 10px;font-size:13px;line-height:1.6;color:#1b2540;resize:none;background:#fff;font-family:inherit;flex:1 1 auto}',
    '.fb-mk-note-input:focus{outline:none;border-color:#2f6bff}',
    '.fb-mk-note-row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}',
    '.fb-mk-gbtn-on{background:#2f6bff;border-color:#2f6bff;color:#fff}',
    '.fb-mk-item-acts{display:flex;gap:8px;justify-content:flex-end}',
    '.fb-mk-empty{background:#fff;border-radius:10px;padding:28px;text-align:center;color:#8c97ad}',
    '.fb-mk-mask-sheet{align-items:flex-start;justify-content:center}',
    '.fb-mk-sheet{width:100%;max-width:900px;background:#fff;border-radius:0;display:flex;flex-direction:column;box-shadow:0 -8px 40px rgba(0,0,0,.25);animation:fbMkDown .2s ease}',
    '@keyframes fbMkDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}',
    '.fb-mk-handle{width:40px;height:4px;background:#ddd;border-radius:2px;margin:10px auto 0;flex:0 0 auto}',
    '.fb-mk-sheet-head{padding:12px 20px;border-bottom:1px solid #f0f0f0;flex:0 0 auto}',
    '.fb-mk-sheet-title-row{display:flex;justify-content:space-between;align-items:center;gap:10px}',
    '.fb-mk-sheet-title{font-weight:600;font-size:15px;color:#1b2540}',
    '.fb-mk-sheet-close{padding:4px 10px;font-size:12px}',
    '.fb-mk-sheet-stem{font-size:12px;color:#999;margin-top:4px;line-height:1.5;max-height:36px;overflow:hidden}',
    '.fb-mk-sheet-tip{font-size:11px;color:#b3bbcc;margin-top:4px;line-height:1.5}',
    '.fb-mk-tree{flex:1;min-height:0;overflow-y:auto;padding:4px 0;display:flex}',
    '.fb-mk-col{flex:1;min-width:0;overflow-y:auto}',
    '.fb-mk-node{display:flex;align-items:center;gap:4px;padding:6px 16px;cursor:pointer;font-size:12px;color:#333;line-height:1.3}',
    '.fb-mk-node:hover{background:#f5f7fa}',
    '.fb-mk-node.on{background:#eef3fb;box-shadow:inset 2px 0 0 #2f6bff}',
    '.fb-mk-node-arrow{width:12px;flex:0 0 12px;color:#bbb;font-size:8px;text-align:center}',
    '.fb-mk-node-name{flex:1;word-break:break-word}',
    '.fb-mk-node-count{font-size:10px;color:#8c97ad;background:#f0f0f0;border-radius:8px;padding:0 6px;min-width:18px;text-align:center}',
    '.fb-mk-node-sub{font-size:10px;color:#a9b3c6;flex:0 0 auto}',
    '.fb-mk-node-add{flex:0 0 auto;width:18px;height:18px;line-height:16px;text-align:center;border:1px solid #d6dce8;border-radius:6px;color:#2f6bff;font-size:12px;background:#fff;cursor:pointer}',
    '.fb-mk-node-add:hover{background:#eef3fb}',
    '.fb-mk-addbar{display:flex;gap:8px;padding:12px 20px;border-top:1px solid #f0f0f0;flex:0 0 auto}',
    '.fb-mk-sheet-foot{display:flex;gap:8px;justify-content:flex-end;padding:0 20px 14px;flex:0 0 auto}',
    '.fb-mk-tree{align-items:flex-start;row-gap:16px}',
    /* v0.3.23：显示收藏分类——粉笔官网「错题本分类」keypoint-tree 样式移植（行内 flex 单行节点 + 箭头方块 + 题数 + 胶囊按钮 + 子分组缩进） */
    '.fb-mk-kp-tree{display:flex;flex-direction:column;margin:14px 0;padding:0 0 30px;background:#fff;border:1px solid #eef1f6;border-radius:12px;box-shadow:0 6px 30px rgba(60,70,79,.06);min-width:0}',
    '.fb-mk-kp-head{display:flex;justify-content:flex-end;padding:12px 20px 0;flex:0 0 auto}',
    '.fb-mk-kp-node{display:block}',
    '.fb-mk-kp-row{display:flex;align-items:center;padding:12px 20px;cursor:default;min-width:0}',
    '.fb-mk-kp-row:hover{background:#fafbfe}',
    '.fb-mk-kp-row.on{background:#eef3fb;box-shadow:inset 3px 0 0 #2f6bff}',
    '.fb-mk-kp-arrow{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:4px;background:#f0f2f6;margin:0 14px 0 0;font-size:13px;line-height:1;color:#6b7482;cursor:pointer;flex:0 0 auto;user-select:none}',
    '.fb-mk-kp-arrow:hover{background:#dbe6ff;color:#2f6bff}',
    '.fb-mk-kp-arrow.off{color:#c3cad8;cursor:default}',
    '.fb-mk-kp-arrow.off:hover{background:#f0f2f6;color:#c3cad8}',
    '.fb-mk-kp-name{font-size:16px;font-weight:700;color:#3c464f;cursor:pointer;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.fb-mk-kp-name:hover{color:#2f6bff}',
    '.fb-mk-kp-num{font-size:13px;font-weight:400;color:#8a9095;margin-left:10px;flex:0 0 auto}',
    '.fb-mk-kp-more{border:1px solid #dee2ea;background:#fff;color:#636e92;border-radius:16px;font-size:12px;line-height:16px;padding:5px 12px;cursor:pointer;margin-left:auto;flex:0 0 auto}',
    '.fb-mk-kp-more:hover{background:#eef3fb;border-color:#2f6bff;color:#2f6bff}',
    '.fb-mk-kp-children{padding-left:38px;min-width:0}',
    // v0.3.30 分组树拖拽：拖拽手柄（三点图标，鼠标放上去出现 grab 手势）、拖拽中半透明、位置指示
    '.fb-mk-drag-handle{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;line-height:16px;border-radius:4px;font-size:14px;color:#8c97ad;background:transparent;cursor:grab;margin-right:6px;flex-shrink:0;user-select:none}',
    '.fb-mk-drag-handle:hover{color:#2f6bff;background:#eef3fb}',
    '.fb-mk-drag-handle:active{cursor:grabbing}',
    '.fb-mk-kp-row.fb-mk-dragging{opacity:.45}',
    '.fb-mk-kp-row.fb-mk-drop-top{box-shadow:inset 0 2px 0 0 #2f6bff}',
    '.fb-mk-kp-row.fb-mk-drop-bottom{box-shadow:inset 0 -2px 0 0 #2f6bff}',
    '.fb-mk-kp-row.fb-mk-drop-inside{background:#e8f1ff;box-shadow:inset 0 0 0 2px #2f6bff}',
    '.fb-mk-kp-row.fb-mk-drop-no{opacity:.55}',
    '.fb-mk-kp-tree.fb-mk-drop-root{box-shadow:inset 0 -3px 0 0 #2f6bff}',
    /* v0.3.23：两栏模式下左栏分组面板适配（窄栏紧凑布局） */
    '.fb-mk-three-col .fb-mk-group-panel .fb-mk-kp-tree{padding:6px 0;border:none;border-radius:0;box-shadow:none;margin:0}',
    '.fb-mk-three-col .fb-mk-group-panel .fb-mk-kp-head{padding:6px 10px 2px}',
    '.fb-mk-three-col .fb-mk-group-panel .fb-mk-kp-row{padding:7px 10px}',
    '.fb-mk-three-col .fb-mk-group-panel .fb-mk-kp-arrow{width:20px;height:20px;margin:0 8px 0 0}',
    '.fb-mk-three-col .fb-mk-group-panel .fb-mk-kp-name{font-size:13px}',
    '.fb-mk-three-col .fb-mk-group-panel .fb-mk-kp-num{font-size:11px;margin-left:6px}',
    '.fb-mk-three-col .fb-mk-group-panel .fb-mk-kp-more{padding:2px 8px;font-size:11px}',
    '.fb-mk-three-col .fb-mk-group-panel .fb-mk-kp-children{padding-left:22px}',
    '.fb-mk-tree-col{display:flex;flex-direction:column;gap:6px;flex:0 0 auto;max-width:300px}',
    '.fb-mk-branch-row{display:flex;align-items:center;gap:3px}',
    '.fb-mk-tri{display:inline-block;width:13px;text-align:center;margin-right:1px;border-radius:4px;color:#8c97ad;font-size:10px;cursor:pointer}',
    '.fb-mk-tri:hover{background:#dbe6ff;color:#2f6bff}',
    '.fb-mk-tri.off{color:#c9d2e0;cursor:inherit}',
    '.fb-mk-op{flex:0 0 auto;border:1px solid #dfe5ef;background:#fff;color:#8c97ad;border-radius:6px;padding:1px 5px;font-size:12px;line-height:16px;cursor:pointer}',
    '.fb-mk-op:hover{background:#eef3fb;border-color:#2f6bff;color:#2f6bff}',
    '.fb-mk-hide{display:none}',
    '.fb-mk-editor .fb-mk-card{min-width:min(360px,92vw)}',
    '.fb-mk-elbow{color:#c3cad8;font-size:12px;flex:0 0 auto;font-family:Menlo,Consolas,monospace}',
    '.fb-mk-kids{display:flex;flex-direction:column;gap:6px;margin:2px 0 0 12px;padding-left:10px;border-left:1px dashed #cdd6e6}',
    '.fb-mk-tag-d1{font-size:12px}',
    '.fb-mk-tag-d2{font-size:11px;padding:4px 10px}',
    '.fb-mk-tag-d3{font-size:11px;padding:4px 10px;color:#7b869c}',
    '.fb-mk-jump-hl{outline:2px solid #2f6bff;outline-offset:6px;border-radius:10px;box-shadow:0 0 0 6px rgba(47,107,255,.12)}',
    '.fb-mk-entry-dg{display:flex;align-items:center;justify-content:center;min-width:96px;margin-top:6px;padding:4px 10px;border:1px dashed #b9c4d6;border-radius:6px;font-size:12px;color:#44506b;background:#fff;cursor:pointer;user-select:none}',
    '.fb-mk-entry-dg-set{display:flex;align-items:center;justify-content:center;margin-top:6px;padding:4px 12px;border:1px solid #d6dce8;border-radius:6px;font-size:12px;cursor:pointer;color:#44506b;background:#fff;user-select:none}',
    '.fb-mk-entry-dg-set:hover{border-color:#2f6bff;color:#2f6bff}',
    '.fb-mk-entry-dg:hover{border-color:#2f6bff;color:#2f6bff}',
    '.fb-mk-settings{padding:4px 16px 16px}',
    '.fb-mk-settings-row{display:flex;align-items:center;gap:10px;margin-top:12px}',
    '.fb-mk-settings-label{flex:0 0 120px;font-size:13px;font-weight:600;color:#44506b}',
    '.fb-mk-settings-desc{font-size:12px;color:#7b869c;margin-top:4px;line-height:1.6}',
    '.fb-mk-settings-toggle{padding:5px 14px;border-radius:14px;border:1px solid #d6dce8;font-size:13px;cursor:pointer;background:#f5f7fa;color:#44506b}',
    '.fb-mk-settings-toggle.on{background:#2f6bff;border-color:#2f6bff;color:#fff}',
    '.fb-mk-verify-field{display:flex;align-items:center;gap:10px;margin-top:8px}',
    '.fb-mk-verify-field .fb-mk-verify-label{flex:0 0 70px}',
    '.fb-mk-verify-input{flex:1;min-width:0;box-sizing:border-box;border:1px solid #d6dce8;border-radius:6px;padding:7px 10px;font-size:13px;color:#1b2540;background:#fff;font-family:inherit}',
    '.fb-mk-verify-input:focus{outline:none;border-color:#2f6bff}',
    '.fb-mk-verify-abcd{display:flex;gap:8px}',
    '.fb-mk-verify-opt{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:1px solid #d6dce8;background:#fff;font-size:14px;font-weight:600;color:#44506b;cursor:pointer;user-select:none;transition:all .15s}',
    '.fb-mk-verify-opt.on{background:#2f6bff;border-color:#2f6bff;color:#fff}',
    '.fb-mk-verify-note{width:100%;min-height:64px;box-sizing:border-box;border:1px solid #d6dce8;border-radius:6px;padding:8px 10px;font-size:13px;line-height:1.6;color:#1b2540;resize:none;background:#fff;font-family:inherit;margin-top:6px}',
    '.fb-mk-verify-note:focus{outline:none;border-color:#2f6bff}',
    '.fb-mk-verify-note-row{margin-top:10px}',
    '.fb-mk-verify-note-label{font-size:12px;font-weight:600;color:#44506b;margin-bottom:4px;display:block}',
    '.fb-mk-verify-rows{margin-top:10px}',
    '.fb-mk-verify-row{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0}',
    '.fb-mk-verify-row.miss{color:#c22}',
    '.fb-mk-verify-label{flex:0 0 70px;font-size:13px;color:#6b7482;text-align:right;line-height:1.6}',
    '.fb-mk-verify-val{flex:1;font-size:13px;line-height:1.6;word-break:break-word}',
    '.fb-mk-verify-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}',
    '.fb-mk-toast{position:fixed;left:50%;bottom:40px;transform:translate(-50%,20px);background:rgba(20,28,48,.92);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:2147483600;opacity:0;transition:all .22s;display:flex;align-items:center;gap:10px;max-width:80vw}',
    '.fb-mk-toast.on{opacity:1;transform:translate(-50%,0)}',
    '.fb-mk-toast-act{border:0;background:#2f6bff;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer}',
    /* v0.3.20：两栏布局 CSS（v0.3.24：三栏合并为两栏） */
    /* v0.3.24：底部空白修复——不再使用固定 calc(100vh - 220px)。
       两栏模式下页面本身不滚动（.fb-mk-page-cols overflow:hidden），
       .fb-mk-wrap-cols 用 flex 纵向铺满视口（height:100%），
       两栏容器 .fb-mk-three-col 由 flex:1 + min-height:0 自适应视口剩余高度，
       左/右两栏各自 overflow-y:auto 独立滚动，不会与页面高度叠加产生底部空白 */
    '.fb-mk-page.fb-mk-page-cols{overflow:hidden}',
    '.fb-mk-wrap.fb-mk-wrap-cols{display:flex;flex-direction:column;height:100%;min-height:0;padding:16px 20px 0}',
    '.fb-mk-three-col{display:flex;gap:0;flex:1;min-height:0;margin-top:10px;align-items:stretch}',
    '.fb-mk-three-col .fb-mk-group-panel{width:238px;flex:0 0 238px;border-right:1px solid #e4e9f2;padding:8px 0;overflow-y:auto}',
    // v0.3.26：平板端优先保证左侧完整显示——左栏自适应加宽、分类名不截断
    // v0.3.28：平板/Via 适配——左栏自适应完整显示（允许收缩、限占比、缩字号、容器防横向溢出），笔记缩为 200px 并保持与题干并排
    '@media (max-width:1024px){.fb-mk-three-col{overflow:hidden}.fb-mk-three-col .fb-mk-group-panel{width:auto!important;flex:0 1 auto!important;min-width:218px;max-width:42vw;overflow-x:hidden}.fb-mk-three-col .fb-mk-group-panel .fb-mk-kp-name{white-space:normal;word-break:break-all;font-size:12px!important}.fb-mk-three-col .fb-mk-question-list{min-width:0}.fb-mk-qmain{flex-direction:row!important}.fb-mk-qmain .fb-mk-note{flex:0 0 calc(400px - 3cm)!important;min-width:calc(400px - 3cm)!important;max-width:calc(400px - 3cm)!important;width:calc(400px - 3cm)!important}}',
    '.fb-mk-three-col .fb-mk-question-list{flex:1;min-width:0;padding:0 12px;overflow-y:auto}',
    '.fb-mk-three-col .fb-mk-question-list .fb-mk-grid{display:block!important;gap:0!important}',
    '.fb-mk-three-col .fb-mk-question-list .fb-mk-grid .fb-mk-item{margin-bottom:12px;border-bottom:1px solid #f0f0f0;padding-bottom:12px}',
    '.fb-mk-three-col .fb-mk-question-list .fb-mk-grid .fb-mk-item:last-child{border-bottom:none;padding-bottom:0;margin-bottom:0}',
    /* v0.3.21：三栏分隔条（拖拽调节栏宽，hover 高亮） */
    '.fb-mk-divider{width:6px;flex:0 0 6px;cursor:col-resize;background:transparent;transition:background .15s;position:relative;z-index:5}',
    '.fb-mk-divider:hover,.fb-mk-divider.fb-mk-divider-dragging{background:#d6e2ff}',
    /* v0.3.20：题干字体调大（仅错题本页面）；v1.0.8：字号走 CSS 变量，可在「字体」设置里单独调节（v1.0.9 修复：#fb-mk-style 为 style 标签 id，后代选择器匹配不到元素，改直接选择器） */
    '.fb-mk-stem{font-size:var(--fb-mk-font-stem,16px)!important}',
    /* v0.3.20：选项字体调大（仅错题本页面）；v1.0.8：字号走 CSS 变量（同上修复） */
    '.fb-mk-opt{font-size:var(--fb-mk-font-opt,15px)!important}',
    /* v0.3.24：选中高亮样式已随三栏合并移除（卡片内直接编辑笔记，无需选中态） */
    '.fb-mk-item{cursor:default}'
  ].join('\n');

  function injectCss() {
    if (document.querySelector('#fb-mk-style')) return;
    const s = document.createElement('style');
    s.id = 'fb-mk-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* =====================================================
   * 9. 启动
   * ===================================================== */
  function route() {
    injectCss();
    applyFontSetting();
    ensureEntry();
    if (notebookOpen || String(location.hash || '').indexOf('#/mistakes') === 0) {
      notebookOpen = true;
      mountNotebook();
    } else {
      const p = document.querySelector('.fb-mk-page');
      if (p && p.parentNode) p.parentNode.removeChild(p);
      injectFavButton();
      refreshFavButtons();
    }
  }

  let pulledOnce = false;
  function start() {
    loadState();   // 必须先读本地存量，再决定是否拉远端（否则会被默认状态覆盖）
    injectCss();
    applyFontSetting();
    ensureEntry();
    injectFavButton();
    refreshFavButtons();
    route();
    // 页面本身还在加载时按钮可能被后渲染的 DOM 覆盖，这里补一次
    setTimeout(route, 1500);

    if (davIsConfigured() && !pulledOnce) {
      pulledOnce = true;
      davPull(true).then(() => { refreshFavButtons(); if (renderNotebook) renderNotebook(); }, () => { /* 静默失败，等用户手动同步 */ });
    }

    menu('打开错题本', openNotebook);
    menu('WebDAV 设置', openWebdavModal);
    menu('立即同步（上传）', () => { scheduleUpload('manual'); });
    menu('从远端拉取', () => { davPull(false).catch(() => {}); });
    menu('测试 WebDAV 连接', () => { davConsoleTest().catch(() => {}); });
    menu('导出错题 JSON', exportJson);

    // 若上一页点过「打开原题」，落地后定位到该题的题号
    tryPendingJump();
  }

  let moQueued = false;
  let moLastRun = 0;
  // v0.3.11 性能修复：外部 DOM 变化触发的注入/归位增加最小间隔（ms）。
  // 站点高频变更（Angular 渲染、懒加载、轮播等）不再每帧执行整轮全页重活，改为低频合并执行。
  const MO_REFRESH_GAP = 400;
  function scheduleExternalRefresh() {
    if (moQueued) return;
    moQueued = true;
    const run = () => {
      moQueued = false;
      const now = Date.now();
      if (now - moLastRun < MO_REFRESH_GAP) {
        // 距上次执行太近：延后补齐剩余间隔，保证不漏刷新
        setTimeout(run, MO_REFRESH_GAP - (now - moLastRun));
        return;
      }
      moLastRun = now;
      try {
        if (document.querySelector('.fb-mk-page')) return;
        injectFavButton();
        refreshFavButtons();
        ensureEntry(); // header-title 后渲染完成后，把按钮归位到其前面
      } catch (e) { /* ignore */ }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 200);
  }

  let lastHref = '';
  function boot() {
    start();
    setInterval(() => {
      const h = String(location.href || '');
      if (h !== lastHref) {
        lastHref = h;
        try { route(); } catch (e) { davWarn('路由切换处理异常', errText(e)); }
        try { tryPendingJump(); } catch (e) { /* ignore */ }
      }
    }, 800);
    try {
      const mo = new MutationObserver(records => {
        for (let i = 0; i < records.length; i++) {
          const t = records[i].target;
          const el = t && t.nodeType === 1 ? t : (t ? t.parentElement : null);
          if (el && el.closest && el.closest('.fb-mk-page,.fb-mk-toast,.fb-mk-mask,.fb-mk-fav')) return;
        }
        scheduleExternalRefresh();
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* 观察器不可用时降级为定时器 */ }
  }

  // 暴露少量调试 / 集成接口（与参考脚本 window.__fwFav 同风格）
  try {
    window.__fbMk = {
      version: '0.3.24',
      openNotebook: openNotebook,
      closeNotebook: closeNotebook,
      clickLog() { return (window.__fbMkClickLog || []).slice(); },
      pageProbe() {
        const p = document.querySelector('.fb-mk-page');
        const cs = p ? getComputedStyle(p) : null;
        return {
          notebookOpen: notebookOpen,
          hasPage: !!p,
          pageInDom: !!(p && p.isConnected),
          pageParent: p && p.parentNode ? p.parentNode.tagName : null,
          pageDisplay: cs ? cs.display : null,
          pageZ: cs ? cs.zIndex : null,
          pageChildren: p ? p.children.length : 0,
          pageRect: p ? (function (b) { return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(p.getBoundingClientRect()) : null,
          pageAtCenter: (function () {
            if (!p) return null;
            const b = p.getBoundingClientRect();
            if (!b.width || !b.height) return null;
            const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return el ? (el.tagName + '.' + String(el.className || '').slice(0, 60)) : null;
          })(),
          itemCount: state.items.length,
          hash: String(location.hash || '')
        };
      },
      qidProbe: qidProbe,
      jumpProbe() {
        let pending = null;
        try { pending = JSON.parse(localStorage.getItem(JUMP_KEY) || 'null'); } catch (e) { pending = null; }
        const roots = questionRoots();
        return {
          pending: pending,
          roots: roots.length,
          rootsKeys: roots.slice(0, 3).map(r => questionKeysOf(r)),
          titles: roots.slice(0, 3).map(r => norm(textOf(r, SEL.titleIndex))),
          matched: pending ? !!findQuestionByRec(pending) : false
        };
      },
      tryJump: tryPendingJump,
      entryProbe() {
        const wrap = document.querySelector('.fb-mk-entry');
        const title = document.querySelector('.header-title');
        const hl = document.querySelector('.header-left');
        const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
        return {
          hasWrap: !!wrap,
          wrapParent: wrap && wrap.parentNode ? wrap.parentNode.tagName + '.' + String(wrap.parentNode.className).slice(0, 60) : null,
          wrapPrevSib: wrap && wrap.previousElementSibling ? wrap.previousElementSibling.tagName + '.' + String(wrap.previousElementSibling.className).slice(0, 40) : null,
          wrapClass: wrap ? wrap.className : null,
          wrapRect: r(wrap),
          hlRect: r(hl),
          hlParent: hl && hl.parentNode ? hl.parentNode.tagName + '.' + String(hl.parentNode.className).slice(0, 60) : null,
          wrapParentIsHlParent: !!(wrap && hl && wrap.parentNode === hl.parentNode),
          wrapRightAfterHl: !!(wrap && hl && wrap.parentNode === hl.parentNode && wrap.previousElementSibling === hl),
          titleRect: r(title),
          titleParent: title && title.parentNode ? title.parentNode.tagName + '.' + String(title.parentNode.className).slice(0, 60) : null,
          titleParentPos: title && title.parentNode ? getComputedStyle(title.parentNode).position : null,
          titleParentDisplay: title && title.parentNode ? getComputedStyle(title.parentNode).display : null,
          titlePos: title ? getComputedStyle(title).position : null,
          overlap: (() => {
            const a = wrap && wrap.getBoundingClientRect(), b = title && title.getBoundingClientRect();
            if (!a || !b || !a.width || !b.width) return false;
            return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
          })()
        };
      },
      favDiag: favDiag,
      optionProbe: optionProbe,
      getState() { return JSON.parse(JSON.stringify(state)); },
      getConfig() { const c = davGetCfg(); return { host: c.host, user: c.user, path: c.path, hasPass: !!c.pass }; },
      saveConfig(cfg) { return davSaveCfg(cfg); },
      testConnection(cfg) { return davTestConnection(cfg); },
      syncNow(reason) { return davPush(reason || 'manual'); },
      pullNow() { return davPull(false); },
      diag() { return davDiagText(); },
      probe() { const root = firstMatch(document, SEL.questionRoot); const attrs = []; if (root && root.attributes) { for (let i = 0; i < root.attributes.length; i++) attrs.push(root.attributes[i].name + '=' + String(root.attributes[i].value).slice(0, 40)); } const chain = []; let el = root, d = 0; while (el && d < 6) { chain.push(el.tagName + (el.className ? '.' + String(el.className).slice(0, 50) : '')); el = el.parentElement; d++; } const stemEl = firstMatch(root || document, SEL.stem); return { hasRoot: !!root, rootAttrs: attrs, upChain: chain, href: String(location.href), qidAttrs: qidFromAttrs(root), qidNg: qidFromAngular(root), qidHtml: qidFromHtml(root), qidUrl: qidFromUrl(), finalQid: extractQid(root, stemEl ? norm(stemEl.innerText || stemEl.textContent) : ''),
      optionDiag: (function () {
        const counts = SEL.option.map(s => { try { return s + ':' + document.querySelectorAll(s).length; } catch (e) { return s + ':ERR'; } });
        const rows = collectOptionEls(firstMatch(document, SEL.questionRoot) || document);
        return { counts: counts, rows: rows.length, radio: document.querySelectorAll('input[type=radio]').length, inputRadio: document.querySelectorAll('.input-radio').length, sample: rows.length ? String(rows[0].outerHTML || '').slice(0, 500) : '' };
      })(),
      parsed: (function () { const q = getQuestion(); return q ? { stem: q.stem.slice(0, 60), options: q.options, correctAnswer: q.correctAnswer, yourAnswer: q.yourAnswer } : null; })() }; },
      groupProbe() { return { maxDepth: MAX_GROUP_DEPTH, total: state.groups.length, groups: state.groups.map(g => ({ id: g.id, name: g.name, parentId: g.parentId || null, level: groupLevel(g), path: groupPathText(g), count: groupItemCount(g.id) })) }; },
      exportJson: exportJson,
      reload() { loadState(); refreshBadge(); if (renderNotebook) renderNotebook(); }
    };
  } catch (e) { /* ignore */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
