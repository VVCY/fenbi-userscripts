// ==UserScript==
// @name         粉笔题库·悬浮查词（成语/词语）
// @namespace    local.doubao.fenbi-hover-word
// @version      3.13.0
// @description  v3.13.0 修复「我的收藏」面板顶端混入两条非成语卡片（`...` 与 `<encodeURIComponent(词)>`）：远端 Markdown 文件头里的两处示例占位标记 `<!-- fw:word:... -->` 与说明文字里的字面示例 `<!-- fw:word:<encodeURIComponent(词)> -->` 被整块解析器当成真实词块起始渲染成卡片。现让 bookParseBlocks 与 favMarkerRe 共用同一套排除规则（起始标记捕获段禁用尖括号、`...` 模板占位前置否定断言），并在词名解析后加 favIsRealWord 兜底校验（空词、`...`、含尖括号、含 encodeURIComponent 一律丢弃），仅真实词块会进入面板与计数。v3.12.0 收紧「我的收藏」面板排版：面板头部与卡片外边距/内边距整体缩小（卡片 margin 12/20→8/14、头部 padding 10/14→7/12、正文行高 1.7→1.55、字段/元信息间距同步收紧），并把「取消收藏」按钮从卡片底部独立操作行移入卡片头部操作区、排在「展开 ▾」提示的左侧（点按钮不触发展开），每个词块更紧凑；面板头部另加「配置」按钮（直通 WebDAV 设置）。v3.11.0 修复「点收藏慢、我的收藏面板加载不出内容」：① 收藏改为在本机快照上直接合并写回（省掉每次一次 GET 往返），保存目录的探测结果缓存复用（省掉重复 MKCOL），单次请求超时 30s→12s，卡住就明确报超时；②「我的收藏」面板改为先用本机快照秒开，云端刷新失败时保留缓存内容并显示失败原因与「最近一次请求」状态，另加「诊断信息」一键自检（请求出口 / 超时 / 最近请求明细 / 快照时间），面板不再出现空白或永久加载。 粉笔网页版做逻辑填空/言语理解题时，鼠标悬浮到成语或词语上，即时显示释义、用法语境、出处、例句、近反义。成语走本地词库（秒开离线），词语走汉典在线查询并缓存。v3.10.0 把「我的收藏」面板改成「点击展开」：默认每张卡片只显示成语与释义，点某张卡片即展开该词全部字段（拼音/用法/出处/例句/近反义/来源/收藏时间），再次点击收起；并修复面板可能卡在「正在加载收藏数据…」的问题（本地 15 秒兜底超时 + 失败/超时态给「重新加载」按钮 + 已开面板时再点「我的收藏」会重新拉取）。v3.8.0 新增「我的收藏」面板：侧栏/中键栏「我的收藏」按钮弹出面板，从坚果云远端文件解析所有已收藏词块，每条渲染为独立卡片展示词名/拼音/释义/用法/出处/例句/近反义/来源/收藏时间/页面，每条卡片下方带「取消收藏」；v3.7.0 新增「一键收藏」：在悬浮窗左侧栏或中键固定栏点「收藏」，就能把当前词的释义卡片以 Markdown 词块写入坚果云（WebDAV：GM_xmlhttpRequest + HTTP Basic + ETag 乐观锁，同一个词自动去重，已收藏的词再点一次即取消收藏）；并新增 WebDAV 配置面板（油猴菜单「★ WebDAV 收藏设置」/ 控制台 window.__fwFav.open()）——地址固定 https://dav.jianguoyun.com/dav/、账号填注册邮箱、密码必须用「应用密码」。v3.6 变更：中键不再直接跳转百度汉语，改为在鼠标旁弹出 3 个按钮（百度汉语/人民网/收藏）并固定住，鼠标移过去点完即自动消失。v3.5 变更：① 悬浮窗整体贴到鼠标右侧约 3cm 处，绝不遮挡选项；② 查词按钮统一挪到悬浮窗左侧竖排——百度汉语、人民网（搜该成语的用法）、收藏。v3.4 变更：① 悬浮窗改为紧贴鼠标/所作词显示（原先挂在整个选项行中央，离鼠标很远）；② 选项里一段连续的汉字（成语尺度）一律整体取词，词库不收录就显示"未收录"，绝不从中截出"两个单独的词"（如未收录成语被拆成两个双字词）。v3.3 变更：鼠标中键查词源由汉典改为百度汉语（汉典成语收录不全），释义仍由汉典提供。v3.2 改进：① 只在 ABCD 选项区域内生效，题干不触发；② 鼠标悬浮在选项词上时，直接按鼠标中键即可打开百度汉语词条，鼠标无需移动到悬浮窗（中键监听挂在 document 层）。v3 还修复"把两个相邻的词并成一个词"的问题：取词一律以分词词表（jieba 词典）+ 成语词库判定真实词边界，绝不跨标点/跨词拼接（如"医生：患者"不会再被并成"医生患者"）。仅题目区域触发，不影响答题。
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
    favWebdavPath: 'fenbi-word-favorites.md', // 一键收藏默认保存路径（相对 WebDAV 根目录；只填裸文件名时自动补前缀「我的坚果云/」）
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
  function gmGet(key) {