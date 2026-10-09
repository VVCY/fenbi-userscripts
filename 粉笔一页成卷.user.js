// ==UserScript==
// @name         粉笔一页成卷
// @namespace    marvis/fenbi-inpage-typeset
// @version      1.1.1
// @description  在粉笔网页版题目页就地套用《粉笔试卷排版打印》的版式：宋体（默认字号 24px / 行高 1.6，均在面板上用 −/＋ 加减调整）（本机宋体优先，安卓平板/iPad 缺宋体时自动联网补思源宋体，可关）、题干首行缩进 2em 与段间距 0.5em、题号悬挂缩进（固定 2em）、选项 flex 排布（列数默认自动，可切 1/2/4 列；列距 18px、行距 0.5em、上距 0.3em）、图片限幅（题干 max-width 100%、选项 140x100）、表格规则、题间距（默认 18px，面板用 −/＋ 调整）。只调样式：不打印、不生成 A4、不浮层、不改动题目文本与原有交互。
// @author       Marvis File Agent
// @match        *://spa.fenbi.com/*
// @match        *://www.fenbi.com/spa/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * 设计说明：与《粉笔试卷排版打印》的对应关系
 * ---------------------------------------------------------------------------
 * 原脚本的链路是「提取 -> buildHtml 重排 -> paginate 分页 -> 打印」，本质是
 * 另造一份文档再印出来。本脚本只借用它的版式数值与构造思想，在粉笔原生页面上
 * 就地覆盖 CSS 视觉表现（不生成页面、不打印、不改 DOM 结构）。
 *
 *   原脚本                                                    本脚本
 *   ------------------------------------------------------    ------------------------------------------------------
 *   body{font-size:15px;line-height:1.6}                       :root 上的 --fp-ts-fs / --fp-ts-lh
 *   .fp-stem{padding-left:var(--hang)}                         [data-fp-ts] .fp-ts-stem 同款悬挂列
 *   .fp-num{float:left;margin-left:-hang;width:hang}            [data-fp-ts] .fp-ts-num 同款负边距顶出
 *   .fp-stem p{margin:0 0 .5em;justify;text-align-last:left}    题干/材料段落同款
 *   .fp-opts{flex-wrap;column-gap:18px;row-gap:.5em;margin-top:.3em}
 *                                                              [data-fp-ts] .fp-ts-opts 同款 flex 换行
 *   .fp-opts.grid-N>.fp-opt{flex:0 0 calc((100% - gap*(N-1))/N)}
 *                                                              用 --fp-ts-optw 表达同一套列宽公式
 *   layoutFor()：18px 列距 / 140px 图片上限 / 70px 小图估算     pickCols() 按真实可用宽算 4/2/1
 *   .fp-opt img{max-width:140px;max-height:100px;object-fit:contain}
 *                                                              选项图同款限幅；题干图 max-width:100%
 *   .fp-mat table{width:100%;border-collapse}                  表格同款规则（字号比正文小 1px）
 *
 * 与打印版的刻意差异（详见交付说明的「已知限制」）：
 *   1. 不做 tex 行内公式图等比缩放（原脚本按 fontSize/18 缩放，本次明确不在范围内）。
 *   2. 不重写题目文本（blankify 填空线、flattenOpt 拆盒都不做）；选项内部块级外壳用
 *      CSS :has() 守卫做行内化，从而不移动任何节点。
 *   3. 选项字母悬挂放在每个选项自身（列内缩进），而不是整组统一 padding —— 4 列时
 *      字母不会越出自己的列、压到左列文字上。
 *   4. JS 只做两件事：探测卡片并打标记 + 按固定悬挂量写 --fp-ts-hang，其余全部由 CSS 变量驱动。
 *
 * 跨端宋体（v1.9.0）：
 *   字体链写全各端真实字体名（Windows SimSun / macOS·iPad Songti SC / 安卓 Noto Serif CJK），
 *   并按「本机优先、缺了才下载」的顺序，把思源宋体（Noto Serif SC）的 webfont 排在链尾：
 *   本机出得来宋体就绝不联网；安卓平板、无宋体的 iPad 浏览器则由 webfont 接力，实现跨端显示一致。
 *   字体来源与命中情况在面板底部单独一行实时显示，便于一眼确认到底有没有生效。
 *
 * 选项字母（v1.9.1）：
 *   字母盒取消上下居中（vertical-align:middle -> top，并显式 margin-top:0），字母靠行顶；
 *   每个字母后用样式层 :after 补一个英文句号，呈现为 A. B. C. D.（不改动页面 DOM 文本）。
 *
 * 选项字母定位（v1.9.2）：
 *   真相：原生把字母盒的父级做成了 flex 居中，父级的 align-items 会盖掉子项的 vertical-align，
 *   所以前几版只改 vertical-align 一律「没变化」。改为从子项侧下手：
 *     · 竖直：align-self:flex-start 顶开父级居中，再用上边距 = 行盒半行距 (行高-1)/2 em，
 *       让字母盒与选项正文第一行落在同一条基线上（既不居中、也不过高）。
 *     · 水平：text-align:left 让字母靠盒左缘；字母后那个空格用负 word-spacing 回收，
 *       句号与正文之间自然留出呼吸位（回收量见 v1.9.3）。
 *   同一组声明在 JS 里再写一份内联 !important 兜底（原生的选择器权重/内联样式都压不过它），
 *   并在停用时按名单逐个摘除。
 *
 * 选项字母定位微调（v1.9.3）：
 *   只调「字母后那个空格」的回收量：word-spacing 由 -.5em 放宽到 -.25em，
 *   句号相对字母右移约 0.25em（15px 字号下约 3~4px），起步离开字母、不再贴脸；
 *   字母仍 text-align:left 靠盒左缘，竖直基线与 v1.9.2 完全一致，未动其余任何属性。
 *
 * 题干左边缘对齐（v1.9.4）：
 *   问题：题干吃的是「悬挂列」内缩（--fp-ts-hang，固定 2em），而选项字母贴的是选项行左边界
 *   （选项行 padding-left 里只有 --fp-ts-optindent 这一小段），两者起点天生不同，
 *   表现就是题干整体比 ABCD 偏右十几像素。
 *   做法：不猜数值，直接量。用 Range 取题干首个文字块的左边缘、第一个选项字母的左边缘，
 *   把像素残差写进本卡的 --fp-ts-stemfix（叠加在题干 padding-left 里），迭代收敛；
 *   同时把题干容器原生的水平外边距清零，避免「缩进 + 外边距」两份偏移叠加。
 *   字体晚到、窗口缩放等引起的位移，由既有的 remeasure 流程重排卡片后自动重新量正。
 *
 * 题干对齐「打开不生效、点一下面板才生效」修复（v1.9.5）：
 *   现象：打开题目页题干仍比 ABCD 偏右，手动点一下面板里的「选项列数」才对齐。
 *   真因：首帧（React 水合中）题干还是零宽，Range 量出的两侧左缘都是 0，残差 0 被当成
 *        「已对齐」直接返回；此后卡片签名没变、标记仍在，handleCard 一路早退，错位就此固化，
 *        只有 force 重排（点面板改设置）才会重新量。
 *   修法：① 宽度不合法（≤1px）时绝不判定对齐，一律挂 remeasure 等布局稳定后复量；
 *        ② 卡片首次上妆后强制挂一次延迟复量，避免首帧巧合量到 0 后被永久早退跳过。
 *   关键补丁（否则前面两条都会空转）：加 data-fp-ts-stemfix-pending 记号，「待重量」的卡片
 *   在 handleCard 里不参与「签名相同 → 早退」的短路，remeasure 重排时才真能重算 stemfix；
 *   量准即摘记号，恢复正常早退，不会自旋。
 */

(function () {
    'use strict';

    /* ==================================================================
     * 0. 常量：排版基准值取自《粉笔试卷排版打印》，不另创一套
     * ================================================================ */

    var VERSION = '1.1.0';
    var STYLE_ID = 'fp-ts-style';               // 排版样式（停用时整体失效）
    var PANEL_STYLE_ID = 'fp-ts-panel-style';   // 面板样式（不受停用影响）
    var PANEL_ID = 'fp-ts-panel';
    var STORE_KEY = 'fenbi_inpage_typeset_v1';

    /* 正文宋体链（按平台逐个命中，写全各端真实字体名）：
     *   Windows  SimSun / 宋体
     *   macOS    STSong / Songti SC
     *   iOS/iPad Songti SC（STSongti-SC-Regular）
     *   Android  多数 ROM 不带中文衬线 → 交给下面的联网补字（思源宋体 / Noto Serif SC）
     * 浏览器是按字形逐个回退的：本机能出宋体就绝不会去下载网络字体。 */
    var FONT_CHAIN = '"SimSun","宋体","STSong","Songti SC","STSongti-SC-Regular","Noto Serif CJK SC",' +
        '"Noto Serif SC","Source Han Serif SC","Source Han Serif CN","Source Han Serif SC VF","思源宋体",serif';
    // 题号字体：与原脚本 .fp-num 一致，Times New Roman 打头
    var NUM_FONT = '"Times New Roman",' + FONT_CHAIN;
    // 已知的黑体链：只用于「到底命中宋体没有」的自检对照
    var SANS_CHAIN = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Heiti SC",sans-serif';

    /* 联网补字：本机没有宋体时按顺序试这些源，前一个失败（被墙 / 404 / 超时）自动换下一个。
     * 前三个是同一份 Noto Serif SC（思源宋体简中版）的 Google Fonts 及其国内可用镜像，
     * 后两个是「中文网字计划」打包的思源宋体可变字体，走 jsDelivr。
     * 这些 CSS 都切成上千个 unicode-range 分片，浏览器只下载页面真正用到的字，不是整包几 MB。 */
    var WEBFONT_PROVIDERS = [
        { family: 'Noto Serif SC', url: 'https://fonts.googleapis.cn/css2?family=Noto+Serif+SC:wght@400;700&display=swap' },
        { family: 'Noto Serif SC', url: 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap' },
        { family: 'Noto Serif SC', url: 'https://fonts.loli.net/css2?family=Noto+Serif+SC:wght@400;700&display=swap' },
        { family: 'Source Han Serif SC VF', url: 'https://cdn.jsdelivr.net/npm/cn-fontsource-source-han-serif-sc-vf/font.css' },
        { family: 'Source Han Serif SC VF', url: 'https://fastly.jsdelivr.net/npm/cn-fontsource-source-han-serif-sc-vf/font.css' }
    ];
    var WEBFONT_TIMEOUT = 5000;                 // 单个源的最长等待（ms），超时即换源

    var HANG_FALLBACK = 2.0;   // 题号悬挂宽度（em），固定值，容纳三位数题号
    var O_HANG_FALLBACK = 1.0; // 选项字母列宽（em）：字母与内容间距的唯一定量，调小=更近
    var COL_GAP = 18;          // 选项列间距（px），与 CSS column-gap 一致
    var OPT_IMG_W = 140;       // 选项图限幅宽（px）
    var OPT_IMG_H = 100;       // 选项图限幅高（px）
    var TEX_SMALL_W = 70;      // 无 width 属性的小图（行内公式图）估算宽（px）
    var NUM_SLACK = 6;         // 列宽余量（px），避免卡边界时刚好换行

    var LIMITS = {
        fontSize: [10, 30],
        lineHeight: [1.2, 2.4],
        qSpacing: [0, 120]
    };
    var DEFAULTS = {
        enabled: true,
        fontSize: 24,
        lineHeight: 1.6,
        cols: 'auto',             // 恢复默认时列数自动
        qSpacing: 18,
        webFont: true             // 本机缺宋体时联网补一份思源宋体（安卓平板 / 部分 iPad 浏览器需要）
    };

    /* ==================================================================
     * 1. 小工具
     * ================================================================ */

    function $$(sel, root) {
        var scope = root || document;
        return Array.prototype.slice.call(scope.querySelectorAll(sel));
    }

    function num(v, def, key) {
        var n = parseFloat(v);
        if (!isFinite(n)) return def;
        var range = LIMITS[key];
        if (!range) return n;
        return Math.min(range[1], Math.max(range[0], n));
    }

    function addClass(el, cls) {
        if (el && !el.classList.contains(cls)) el.classList.add(cls);
    }

    // 只写不同值：避免无谓的 DOM 写入触发自身的 MutationObserver 循环
    function setVar(el, name, value) {
        if (!el) return;
        if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
    }

    function setAttr(el, name, value) {
        if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
    }

    // 文本宽度（px）：canvas 实测（Times New Roman 打头）
    // 环境无 canvas（少数内嵌 webview / 无头环境）时返回 0，选项列宽估算随之保守
    var _ctx = null;
    function textWidthPx(s, fs, family) {
        if (!s || _ctx === false) return 0;
        try {
            if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
            if (!_ctx || typeof _ctx.measureText !== 'function') { _ctx = false; return 0; }
            _ctx.font = fs + 'px ' + (family || NUM_FONT);
            return _ctx.measureText(s).width || 0;
        } catch (e) {
            _ctx = false;
            return 0;
        }
    }
    /* ==================================================================
     * 2. 设置持久化
     * ================================================================ */

    var cfg = {};
    var cfgStamp = 0;           // 设置每变一次 +1，参与卡片处理签名

    function readSettings() {
        var s = {}, raw = {};
        try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { raw = {}; }
        Object.keys(DEFAULTS).forEach(function (k) {
            if (!(k in raw)) raw[k] = DEFAULTS[k];
        });
        s.enabled = !!raw.enabled;
        s.fontSize = num(raw.fontSize, DEFAULTS.fontSize, 'fontSize');
        s.lineHeight = num(raw.lineHeight, DEFAULTS.lineHeight, 'lineHeight');
        s.qSpacing = num(raw.qSpacing, DEFAULTS.qSpacing, 'qSpacing');
        s.cols = ['auto', '1', '2', '4'].indexOf(String(raw.cols)) >= 0 ? String(raw.cols) : DEFAULTS.cols;
        s.webFont = ('webFont' in raw) ? !!raw.webFont : DEFAULTS.webFont;
        return s;
    }

    function saveSettings() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* 隐私模式等忽略 */ }
    }

    /* ==================================================================
     * 3. 排版样式：CSS 变量驱动（停用时整体失效，不改页面原生内联样式）
     * ================================================================ */

    var CSS = [
        ':root{',
        '  --fp-ts-fs:15px;',
        '  --fp-ts-lh:1.6;',
        '  --fp-ts-hang:2em;',
        '  --fp-ts-ohang:1em;',
        '  --fp-ts-optindent:1cm;',
        '  --fp-ts-colgap:18px;',
        '  --fp-ts-rowgap:.5em;',
        '  --fp-ts-optgap:.3em;',
        '  --fp-ts-qgap:18px;',
        '  --fp-ts-optw:100%;',
        '  --fp-ts-font:' + FONT_CHAIN + ';',
        '}',

        /* -------- 卡片本体：只吃「题与题之间」的间距 -------- */
        '[data-fp-ts]{margin-bottom:var(--fp-ts-qgap)!important}',

        /* -------- 字体：只作用于题干/材料/选项文字，不碰工具条与按钮 -------- */
        '[data-fp-ts] .fp-ts-stem,',
        '[data-fp-ts] .fp-ts-mat,',
        '[data-fp-ts] .fp-ts-opt,',
        '[data-fp-ts] .fp-ts-stem :not(img):not(svg):not(canvas):not(button):not(input):not(select):not(textarea):not([class*=icon]):not(.fp-ts-num),',
        '[data-fp-ts] .fp-ts-mat :not(img):not(svg):not(canvas):not(button):not(input):not([class*=icon]),',
        '[data-fp-ts] .fp-ts-opt :not(img):not(svg):not(canvas):not(button):not(input):not([class*=icon]):not(.fp-ts-ol){',
        '  font-family:var(--fp-ts-font)!important;',
        '  font-size:var(--fp-ts-fs)!important;',
        '  line-height:var(--fp-ts-lh)!important;',
        '}',

        /* -------- 题干容器：悬挂列（题号占道，正文各行统一左对齐） -------- */
        '[data-fp-ts] .fp-ts-stem{',
        '  display:block!important;',
        '  box-sizing:border-box!important;',
        '  max-width:100%!important;',
        /* v1.9.4：悬挂列 = 题号列宽(--fp-ts-hang) + 实测对齐补偿(--fp-ts-stemfix)，
           补偿量由 JS 量「题干首个文字左边缘 vs 第一个选项字母左边缘」的像素残差写入，
           使题干正文左边缘与 ABCD 字母左边缘严格落在同一条竖线上（此前题干整体偏右）。 */
        '  padding-left:calc(var(--fp-ts-hang) + var(--fp-ts-stemfix,0px))!important;',
        '  margin-left:0!important;',
        '  margin-right:0!important;',
        '  margin-bottom:.4em!important;',
        '}',

        /* -------- 题干/材料段落：首行缩进 2em、justify、段间距 .5em --------
           只给「叶子块」加缩进（:not(:has(块级子元素))），块级容器一律去缩进，
           避免原生页面里 p/div 套娃时父子缩进叠加成 4em、6em。 */
        '[data-fp-ts] .fp-ts-stem :is(p,div,li):not(.fp-ts-np):not(.fp-ts-opt):not(.fp-ts-opts):not([style*=center]):not([style*=right]):not(:has(p,div,li)),',
        '[data-fp-ts] .fp-ts-mat :is(p,div,li):not(.fp-ts-np):not(.fp-ts-opt):not(.fp-ts-opts):not([style*=center]):not([style*=right]):not(:has(p,div,li)){',
        '  margin:0 0 .5em!important;',
        '  padding:0!important;',
        '  text-indent:2em!important;',
        '  text-align:justify!important;',
        '  text-align-last:left!important;',
        '  line-height:var(--fp-ts-lh)!important;',
        '}',
        /* 容器块：保留行高，但绝不吃缩进，也不额外加段间距 */
        '[data-fp-ts] .fp-ts-stem :is(p,div,li):has(p,div,li):not(.fp-ts-opt):not(.fp-ts-opts),',
        '[data-fp-ts] .fp-ts-mat :is(p,div,li):has(p,div,li):not(.fp-ts-opt):not(.fp-ts-opts){',
        '  text-indent:0!important;',
        '  line-height:var(--fp-ts-lh)!important;',
        '}',
        /* 页面原本就居中/居右的段落：不吃首行缩进 */
        '[data-fp-ts] .fp-ts-stem :is(p,div,li)[style*=center],',
        '[data-fp-ts] .fp-ts-stem :is(p,div,li)[style*=right],',
        '[data-fp-ts] .fp-ts-mat :is(p,div,li)[style*=center],',
        '[data-fp-ts] .fp-ts-mat :is(p,div,li)[style*=right]{text-indent:0!important}',
        /* 题号所在的那一段：题号本身就是行首标记，不叠首行缩进（对应原脚本 .fp-first） */
        '[data-fp-ts] .fp-ts-stem .fp-ts-np{',
        '  margin:0 0 .5em!important;',
        '  padding:0!important;',
        '  text-indent:0!important;',
        '  text-align:left!important;',
        '  line-height:var(--fp-ts-lh)!important;',
        '}',

        /* -------- 题号悬挂：float + 负边距顶到正文左边界外 -------- */
        '[data-fp-ts] .fp-ts-num{',
        '  float:left!important;',
        '  width:var(--fp-ts-hang)!important;',
        '  margin:0 0 0 calc(-1 * var(--fp-ts-hang))!important;',
        '  padding:0!important;',
        '  text-indent:0!important;',
        '  text-align:left!important;',
        '  font-family:' + NUM_FONT + '!important;',
        '  font-size:var(--fp-ts-fs)!important;',
        '  line-height:var(--fp-ts-lh)!important;',
        '  font-weight:400!important;',
        '  color:inherit!important;',
        '  background:none!important;',
        '  border:0!important;',
        '  box-shadow:none!important;',
        '  white-space:nowrap!important;',
        '}',
        /* 题号与题干不在同一个盒子（粉笔常见的「标题行 + 正文块」结构）时的兜底：
           标题行塌成 0 高、溢出可见，题号自然落到题干第一行的左侧栏里。
           只在 JS 判定「该行只有题号、没有别的文字」时才加这个标记。 */
        '[data-fp-ts][data-fp-ts-num=row] .fp-ts-numrow{',
        '  height:0!important;min-height:0!important;max-height:0!important;',
        '  margin:0!important;padding:0!important;border:0!important;background:none!important;',
        '  overflow:visible!important;',
        '}',
        '[data-fp-ts][data-fp-ts-num=row] .fp-ts-numrow .fp-ts-num{',
        '  float:none!important;display:block!important;',
        '  width:var(--fp-ts-hang)!important;margin:0!important;',
        '}',
        /* 标题行里除了题号还有别的内容（题型标签等）→ 不动行高，题号只做成定宽块 */
        '[data-fp-ts][data-fp-ts-num=keep] .fp-ts-num{',
        '  float:none!important;display:inline-block!important;',
        '  width:var(--fp-ts-hang)!important;margin:0!important;',
        '}',

        /* -------- 选项组：flex 换行，列距 18px / 行距 .5em / 上距 .3em --------
           原生日志样式（display:block / 带 !important 的覆盖）在这里一律用 !important 压回
           row+wrap；JS 另外还会把同一组声明写成元素内联 !important（内联 + !important
           是层叠里的最高优先级，任何页面样式表都压不掉）。 */
        '[data-fp-ts] .fp-ts-opts{',
        '  display:flex!important;',
        '  flex-direction:row!important;',
        '  flex-wrap:wrap!important;',
        '  align-items:flex-start!important;',
        '  justify-content:flex-start!important;',
        '  column-gap:var(--fp-ts-colgap)!important;',
        '  row-gap:var(--fp-ts-rowgap)!important;',
        '  margin:var(--fp-ts-optgap) 0 0 0!important;',
        '  padding:0!important;',
        '  list-style:none!important;',
        '  width:100%!important;',
        '  max-width:100%!important;',
        '  box-sizing:border-box!important;',
        '  background:none!important;',
        '  border:0!important;',
        '  float:none!important;',
        '  text-indent:0!important;',
        '}',
        /* 容器原生是 ul/ol 时：清掉列表符号与默认缩进（含 -webkit-padding-start） */
        '[data-fp-ts] ul.fp-ts-opts,',
        '[data-fp-ts] ol.fp-ts-opts{',
        '  list-style:none!important;',
        '  padding-left:0!important;',
        '  margin-left:0!important;',
        '}',
        /* 选项行（容器直接子节点）：不给内生宽度套路留任何机会 */
        '[data-fp-ts] .fp-ts-opts>*{min-width:0!important;box-sizing:border-box!important}',
        /* 同一道题列数一致：JS 在卡片上写 data-fp-ts-cols，整套列宽公式与原脚本 grid-N 等价 */
        '[data-fp-ts][data-fp-ts-cols="4"] .fp-ts-opts{--fp-ts-optw:calc((100% - var(--fp-ts-colgap) * 3) / 4)}',
        '[data-fp-ts][data-fp-ts-cols="2"] .fp-ts-opts{--fp-ts-optw:calc((100% - var(--fp-ts-colgap)) / 2)}',
        '[data-fp-ts][data-fp-ts-cols="1"] .fp-ts-opts{--fp-ts-optw:100%}',
        '[data-fp-ts] .fp-ts-opts .fp-ts-opt{',
        '  display:block!important;',
        '  flex:0 0 var(--fp-ts-optw,100%)!important;',
        '  flex-grow:0!important;',
        '  flex-shrink:0!important;',
        '  flex-basis:var(--fp-ts-optw,100%)!important;',
        '  width:var(--fp-ts-optw,100%)!important;',
        '  max-width:var(--fp-ts-optw,100%)!important;',
        '  min-width:0!important;',
        '  box-sizing:border-box!important;',
        '  float:none!important;',
        '  clear:none!important;',
        '  margin:0!important;',
        '  padding-left:calc(var(--fp-ts-ohang) + var(--fp-ts-optindent))!important;',
        '  list-style:none!important;',
        '  text-indent:0!important;',
        '  line-height:var(--fp-ts-lh)!important;',
        '  word-break:normal!important;',
        '  overflow-wrap:break-word!important;',
        '  break-inside:avoid!important;page-break-inside:avoid!important;',
        '}',
        /* 选项字母：定宽列（宽 = 父级 padding-left）+ 负 margin 自身悬挂：
           字母贴 li 左边界、正文紧接其后；字体/字号/行高与内容完全一致，基线自然对齐。
           位置两条硬约束（v1.9.2）：
             ① 竖直：原生把字母盒的父级做成了 flex 居中，vertical-align 会被父级的 align-items 吃掉
                （所以前几版改 vertical-align 都「没变化」）。这里用 align-self:flex-start 从子项侧
                强制顶对齐，再用上边距 = 行盒半行距 (行高-1)/2 em 把字母盒压到与正文首行同一基线。
             ② 水平：text-align:left 让字母靠盒左缘；DOM 里字母后常带一个空格，用负 word-spacing
                回收它——-.25em 只吃掉大半格，句号停在字母右侧一点点，后面仍留呼吸位（v1.9.3）。 */
        '[data-fp-ts] .fp-ts-opt .fp-ts-ol{',
        '  float:none!important;',
        '  display:inline-block!important;',
        '  align-self:flex-start!important;',
        '  width:var(--fp-ts-ohang)!important;',
        '  min-width:0!important;',
        '  max-width:100%!important;',
        '  margin:calc((var(--fp-ts-lh) - 1) * .5em) 1px 0 calc(-1 * var(--fp-ts-ohang))!important;',
        '  padding:0!important;',
        '  box-sizing:border-box!important;',
        '  height:var(--fp-ts-lh)!important;',
        '  font-family:var(--fp-ts-font)!important;',
        '  font-size:var(--fp-ts-fs)!important;',
        '  font-weight:400!important;',
        '  line-height:1!important;',
        '  color:inherit!important;',
        '  text-align:left!important;',
        '  text-indent:0!important;',
        '  white-space:nowrap!important;',
        '  word-spacing:-.25em!important;',
        '  vertical-align:top!important;',
        '  position:static!important;',
        '  top:auto!important;',
        '  left:auto!important;',
        '  transform:none!important;',
        '  overflow:visible!important;',
        '}',
        /* 小圆圈：app-choice-radio 是伪元素空圈（display:none），.input-radio/.input-check 是字母盒只去外观 */
        '[data-fp-ts] .fp-ts-opts app-choice-radio{',
        '  display:none!important;',
        '}',
        /* 字母盒：去边框圆角底色阴影，保留字母本体 */
        '[data-fp-ts] .fp-ts-opts .input-radio,',
        '[data-fp-ts] .fp-ts-opts .input-check{',
        '  border:0!important;',
        '  border-radius:0!important;',
        '  background:transparent!important;',
        '  background-image:none!important;',
        '  box-shadow:none!important;',
        '  outline:none!important;',
        '}',
        /* 圈的另一来源：原生 radio/checkbox 控件本体，直接抹掉 */
        '[data-fp-ts] .fp-ts-opts input[type="radio"],',
        '[data-fp-ts] .fp-ts-opts input[type="checkbox"]{',
        '  -webkit-appearance:none!important;',
        '  appearance:none!important;',
        '  display:none!important;',
        '  width:0!important;',
        '  height:0!important;',
        '  margin:0!important;',
        '  padding:0!important;',
        '}',
        /* 圈的另一来源：选项行/字母盒上的伪元素装饰圈 */
        '[data-fp-ts] .fp-ts-opt::before,',
        '[data-fp-ts] .fp-ts-opt::after,',
        '[data-fp-ts] .fp-ts-opt .input-radio::before,',
        '[data-fp-ts] .fp-ts-opt .input-radio::after,',
        '[data-fp-ts] .fp-ts-opt .input-check::before,',
        '[data-fp-ts] .fp-ts-opt .input-check::after,',
        '[data-fp-ts] .fp-ts-opt label::before,',
        '[data-fp-ts] .fp-ts-opt label::after,',
        '[data-fp-ts] .fp-ts-opt li::before,',
        '[data-fp-ts] .fp-ts-opt li::after,',
        '[data-fp-ts] .fp-ts-opt .choice-radio-label::before,',
        '[data-fp-ts] .fp-ts-opt .choice-radio-label::after{',
        '  content:none!important;',
        '  display:none!important;',
        '  border:0!important;',
        '  background:none!important;',
        '  width:0!important;',
        '  height:0!important;',
        '}',
        /* 去底后字母改随正文色；对错态按粉笔语义还原：
           .correct=选对、.correctLost=正确答案但未选（绿）；.wrong=选错（红） */
        '[data-fp-ts] .fp-ts-opt .fp-ts-ol{ color:inherit!important; }',
        '[data-fp-ts] .fp-ts-opt .fp-ts-ol.correct,',
        '[data-fp-ts] .fp-ts-opt .fp-ts-ol.correctLost{ color:#16a34a!important; }',
        '[data-fp-ts] .fp-ts-opt .fp-ts-ol.wrong{ color:#dc2626!important; }',
        /* 状态类落到选项行（li/wrapper）而不是字母盒时的兼容：
           选对/正确未选 → 绿；选错 → 红。字母盒本身没状态时按行上的状态着色 */
        '[data-fp-ts] .fp-ts-opt.correct .fp-ts-ol,',
        '[data-fp-ts] .fp-ts-opt.correctLost .fp-ts-ol{ color:#16a34a!important; }',
        '[data-fp-ts] .fp-ts-opt.wrong .fp-ts-ol{ color:#dc2626!important; }',
        /* 字母后补英文句号（样式层注入，不改 DOM 文本）：显示为 A. B. C. D.。
           放在上面 content:none 兜底之后，源序在后即可覆盖该 !important。 */
        '[data-fp-ts] .fp-ts-opt .fp-ts-ol::after{',
        '  content:"."!important;',
        '  display:inline!important;',
        '  border:0!important;',
        '  background:none!important;',
        '  width:auto!important;',
        '  height:auto!important;',
        '  margin:0!important;',
        '  padding:0!important;',
        '  color:inherit!important;',
        '  font:inherit!important;',
        '}',

        /* 选项内部的块级外壳行内化：让「字母 + 内容」待在同一个行内流。
           带图/表格的分支不参与（:has 守卫），免得把图片表格压扁。 */
        '[data-fp-ts] .fp-ts-opt :is(div,p,span,section,article,label,app-format-html,app-choice-radio)',
        ':not(.fp-ts-ol):not(:has(img,table,svg,canvas,ul,ol)){',
        '  display:inline!important;',
        '  margin:0!important;',
        '  padding:0!important;',
        '  text-indent:0!important;',
        '}',

        /* -------- 图片：题干图限宽居中，选项图等比限幅 140x100 -------- */
        '[data-fp-ts] .fp-ts-stem img,',
        '[data-fp-ts] .fp-ts-mat img{',
        '  max-width:100%!important;height:auto!important;',
        '  vertical-align:middle!important;object-fit:contain!important;',
        '}',
        '[data-fp-ts] .fp-ts-opt img{',
        '  max-width:' + OPT_IMG_W + 'px!important;',
        '  max-height:' + OPT_IMG_H + 'px!important;',
        '  height:auto!important;',
        '  vertical-align:middle!important;',
        '  object-fit:contain!important;',
        '}',

        /* -------- 表格：宽 100%、1px 边框、居中、字号比正文小 1px -------- */
        '[data-fp-ts] table{width:100%!important;border-collapse:collapse!important;margin:14px 0!important}',
        '[data-fp-ts] th,',
        '[data-fp-ts] td{',
        '  border:1px solid #333!important;',
        '  padding:7px 9px!important;',
        '  text-align:center!important;',
        '  font-size:calc(var(--fp-ts-fs) - 1px)!important;',
        '  line-height:1.5!important;',
        '}',
        '[data-fp-ts] th{background:#f4f4f4!important;font-weight:700!important}',
        '[data-fp-ts] .fp-ts-stem img,',
        '[data-fp-ts] .fp-ts-mat img,',
        '[data-fp-ts] .fp-ts-opt img{border:0!important;box-shadow:none!important;background:transparent!important}'
    ].join('\n');

    /* ==================================================================
     * 4. 参数面板样式（与排版样式分离，停用排版后仍可操作面板）
     * ================================================================ */

    var PANEL_CSS = [
        '#' + PANEL_ID + '{',
        '  position:fixed;right:16px;bottom:16px;z-index:2147483000;width:250px;',
        '  font:12px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
        '  color:#0f172a;background:rgba(255,255,255,.97);border:1px solid #d5dae3;',
        '  border-radius:10px;box-shadow:0 6px 20px rgba(15,23,42,.18);overflow:hidden;',
        '}',
        '#' + PANEL_ID + ' .fp-ts-head{display:flex;align-items:center;justify-content:space-between;',
        '  padding:8px 10px;background:#f1f4f9;border-bottom:1px solid #e2e6ee;',
        '  font-weight:600;color:#2563eb}',
        '#' + PANEL_ID + ' .fp-ts-fold{width:22px;height:22px;padding:0;line-height:1;',
        '  border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;color:#475569;font-size:14px}',
        '#' + PANEL_ID + ' .fp-ts-body{padding:8px 10px 10px}',
        '#' + PANEL_ID + '.fp-ts-collapsed .fp-ts-body{display:none}',
        '#' + PANEL_ID + ' .fp-ts-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 7px}',
        '#' + PANEL_ID + ' .fp-ts-row>span{color:#475569;white-space:nowrap}',
        '#' + PANEL_ID + ' .fp-ts-row input[type=number],#' + PANEL_ID + ' .fp-ts-row select{',
        '  width:100px;padding:3px 6px;border:1px solid #cbd5e1;border-radius:6px;',
        '  font-size:12px;background:#fff;color:#0f172a;box-sizing:border-box}',
        '#' + PANEL_ID + ' .fp-ts-row input[type=checkbox]{width:14px;height:14px;margin:0}',
        '#' + PANEL_ID + ' .fp-ts-stepbox{display:flex;align-items:center;gap:3px;width:100px}',
        '#' + PANEL_ID + ' .fp-ts-stepbtn{width:24px;height:22px;padding:0;flex:0 0 auto;',
        '  border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;',
        '  font-size:13px;line-height:1;color:#334155;box-sizing:border-box}',
        '#' + PANEL_ID + ' .fp-ts-stepbtn:hover:not(:disabled){background:#eff6ff;border-color:#93c5fd}',
        '#' + PANEL_ID + ' .fp-ts-stepbtn:active:not(:disabled){background:#dbeafe}',
        '#' + PANEL_ID + ' .fp-ts-stepbtn:disabled{background:#f1f5f9;color:#cbd5e1;border-color:#e2e8f0;cursor:default}',
        '#' + PANEL_ID + ' .fp-ts-stepval{flex:1 1 auto;text-align:center;font-size:12px;',
        '  color:#0f172a;font-variant-numeric:tabular-nums;user-select:none}',
        '#' + PANEL_ID + ' .fp-ts-stepbox-off .fp-ts-stepval{color:#94a3b8}',
        '#' + PANEL_ID + ' .fp-ts-sub{padding-left:12px}',
        '#' + PANEL_ID + ' .fp-ts-row input:disabled{background:#f1f5f9;color:#94a3b8}',
        '#' + PANEL_ID + ' .fp-ts-btns{display:flex;gap:8px;margin:2px 0 6px}',
        '#' + PANEL_ID + ' .fp-ts-btns button{flex:1;padding:4px 0;border:1px solid #cbd5e1;',
        '  border-radius:6px;background:#fff;cursor:pointer;font-size:12px;color:#334155}',
        '#' + PANEL_ID + ' .fp-ts-btns button:hover{background:#f1f5f9}',
        '#' + PANEL_ID + ' .fp-ts-status{color:#64748b;font-size:11px;line-height:1.5;word-break:break-all}'
    ].join('\n');

    function ensureStyle(id, text) {
        var el = document.getElementById(id);
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            el.textContent = text;
            (document.head || document.documentElement).appendChild(el);
        } else if (el.textContent !== text) {
            el.textContent = text;
        }
        return el;
    }

    var styleEl = null;
    function injectStyles() {
        styleEl = ensureStyle(STYLE_ID, CSS);
        ensureStyle(PANEL_STYLE_ID, PANEL_CSS);
    }

    // 把当前设置写到 :root 的 CSS 变量上（变量驱动，不往页面元素上写内联样式）
    function pushRootVars() {
        var r = document.documentElement.style;
        var map = {
            '--fp-ts-fs': cfg.fontSize + 'px',
            '--fp-ts-lh': String(cfg.lineHeight),
            '--fp-ts-hang': HANG_FALLBACK + 'em',
            '--fp-ts-ohang': O_HANG_FALLBACK + 'em',
            '--fp-ts-colgap': COL_GAP + 'px',
            '--fp-ts-rowgap': '.5em',
            '--fp-ts-optgap': '.3em',
            '--fp-ts-qgap': cfg.qSpacing + 'px',
            '--fp-ts-font': FONT_CHAIN
        };
        Object.keys(map).forEach(function (k) {
            if (r.getPropertyValue(k) !== map[k]) r.setProperty(k, map[k]);
        });
    }

    var ROOT_VARS = ['--fp-ts-fs', '--fp-ts-lh', '--fp-ts-hang', '--fp-ts-ohang', '--fp-ts-colgap', '--fp-ts-rowgap',
        '--fp-ts-optgap', '--fp-ts-qgap', '--fp-ts-font'];

    // 停用时把写在 <html> 内联样式上的变量也一并摘掉，做到「完全还原」
    function clearRootVars() {
        var r = document.documentElement.style;
        ROOT_VARS.forEach(function (k) {
            if (r.getPropertyValue(k)) r.removeProperty(k);
        });
    }

    /* ==================================================================
     * 4b. 联网补字：本机缺宋体时（安卓平板、iPad、部分国产浏览器）自动补一份思源宋体
     *     思路是「本机优先，缺了才下载」——字体链里本机宋体名排在网络字体前面，
     *     本机出得来宋体就不会触发下载；只有整条链都没衬线时，浏览器才会去取网络字体。
     * ================================================================ */

    var webFontState = 'idle';   // idle | loading | ok | failed | off
    var webFontFamily = '';

    function hasWebFontLink() {
        return !!document.querySelector('link[data-fp-ts-webfont]');
    }

    function setupWebFont() {
        if (!cfg.webFont) {
            webFontState = 'off';
            refreshFontStatus();
            return;
        }
        if (hasWebFontLink() && webFontState === 'ok') { refreshFontStatus(); return; }
        webFontState = 'loading';
        refreshFontStatus();
        tryProvider(0);
    }

    function tryProvider(i) {
        if (i >= WEBFONT_PROVIDERS.length) {
            webFontState = 'failed';
            refreshFontStatus();
            return;
        }
        var p = WEBFONT_PROVIDERS[i];
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute('data-fp-ts-webfont', '1');
        link.href = p.url;
        var settled = false;
        var timer = setTimeout(function () {          // 被墙 / 一直挂着：不等了，换下一个源
            if (settled) return;
            settled = true;
            link.remove();
            tryProvider(i + 1);
        }, WEBFONT_TIMEOUT);
        link.onerror = function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            link.remove();
            tryProvider(i + 1);
        };
        link.onload = function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            verifyProvider(p, i);                     // 链接进来还不算数，得真能取到字形
        };
        (document.head || document.documentElement).appendChild(link);
    }

    // 用 Font Loading API 实探：这份字体真的能加载出汉字字形吗？不能就换源
    function verifyProvider(p, i) {
        if (!document.fonts || typeof document.fonts.load !== 'function') {
            webFontState = 'ok';                      // 老浏览器无法探测：样式已进来，按可用计
            webFontFamily = p.family;
            onWebFontReady();
            return;
        }
        document.fonts.load('15px "' + p.family + '"', '宋体测试题目').then(function (faces) {
            if (faces && faces.length) {
                webFontState = 'ok';
                webFontFamily = p.family;
                onWebFontReady();
            } else {
                tryProvider(i + 1);
            }
        }, function () {
            tryProvider(i + 1);
        });
    }

    function onWebFontReady() {
        refreshFontStatus();
        // 字体换了 → 字宽变了 → 列宽判定与题号悬挂都要按新度量重算一次
        if (cfg.enabled) applyAll(true);
    }

    function clearWebFontLinks() {
        $$('link[data-fp-ts-webfont]').forEach(function (n) { n.remove(); });
    }

    function setWebFont(on) {
        cfg.webFont = !!on;
        cfgStamp++;
        saveSettings();
        clearWebFontLinks();
        if (on) {
            setupWebFont();
        } else {
            webFontState = 'off';
            refreshFontStatus();
            if (cfg.enabled) applyAll(true);
        }
    }

    // 自检：同一串汉字分别用「宋体链」和「已知黑体链」量宽度。
    // 宽度不同 = 命中了衬线字体；完全相同 = 大概率两串都落到了系统默认黑体（即没宋体）。
    function serifHit() {
        var w1 = textWidthPx('国题', 100, FONT_CHAIN);
        var w2 = textWidthPx('国题', 100, SANS_CHAIN);
        if (!w1 || !w2) return null;                  // canvas 不可用 → 不猜
        return Math.abs(w1 - w2) > 0.5;
    }

    function fontSourceText() {
        if (webFontState === 'ok') return '思源宋体（联网补字·' + webFontFamily + '）';
        if (webFontState === 'loading') return '本机字体（正在尝试联网补字…）';
        if (webFontState === 'failed') return '本机字体（联网补字失败，可换网络后重排）';
        if (webFontState === 'off') return '本机字体（已关闭联网补字）';
        return '本机字体';
    }

    // 字体状态单独一行显示，不和「已排版 N 道题」互相覆盖
    function refreshFontStatus() {
        if (!fontStatusEl) return;
        if (!cfg.enabled) { fontStatusEl.textContent = '字体：已停用'; return; }
        var hit = serifHit();
        fontStatusEl.textContent = '字体：' + fontSourceText() + ' · ' +
            (hit === null ? '无法自检' : (hit ? '已命中宋体' : '未命中宋体（回退黑体）'));
    }

    /* ==================================================================
     * 5. 探测：卡片 / 题干 / 题号 / 选项（辨认不出的卡片一律安全跳过）
     * ================================================================ */

    var CARD_SELECTORS = ['app-ti', '.ti-item', '.question-item'];

    function findCards() {
        var out = [];
        CARD_SELECTORS.forEach(function (sel) {
            $$(sel).forEach(function (el) {
                if (out.some(function (c) { return c === el || c.contains(el); })) return;  // 只保留最外层匹配
                out.push(el);
            });
        });
        return out;
    }

    // 题干：取第一个「不在答案区里」的 app-format-html（与 pickStem 同一判定），
    // 取不到再退到 article.content，再退到卡内第一个 app-format-html
    function findStem(card) {
        var stem = null;
        $$('app-format-html', card).forEach(function (n) {
            if (!stem && !n.closest('app-result-common')) stem = n;
        });
        if (stem) return stem;
        stem = card.querySelector('article.content');
        if (stem) return stem;
        return card.querySelector('app-format-html');
    }

    function findNumEl(card) {
        var el = card.querySelector('.title-index');
        if (el) return el;
        // 兜底：纯数字的短文本节点（排除答案区与交互控件）
        var cands = $$('span,div,i,em,b,strong', card);
        for (var i = 0; i < cands.length; i++) {
            var n = cands[i];
            if (n.children.length) continue;
            if (n.closest('app-result-common,button,a,label')) continue;
            var t = (n.textContent || '').trim();
            if (!/^\d{1,3}\s*[.、．]?$/.test(t)) continue;
            var w = 0;
            try { w = n.getBoundingClientRect().width; } catch (e) { w = 0; }
            if (w >= 0 && w < 60) return n;
        }
        return null;
    }

    function findOptions(card) {
        var items = $$('li[class*=choice],.option-item', card);
        if (items.length < 2) {
            // 背题页常见结构：li > app-choice-radio（字母与内容都在里面）
            // 优先把 li 外壳当作选项单元，这样选项组容器才能正确定位到外层 ul
            var radios = $$('app-choice-radio', card);
            if (radios.length >= 2) {
                items = radios.map(function (r) {
                    var p = r.parentElement;
                    return (p && p.tagName === 'LI') ? p : r;
                });
            }
        }
        if (items.length < 2) {
            items = $$('.choice-radio-label', card).map(function (l) { return l.parentElement; })
                .filter(function (p) { return !!p && !!p.querySelector('.input-radio,.choice-radio-label'); });
        }
        // 去重 + 只留最外层，避免 li 与嵌在里面的 app-choice-radio 被重复计数
        return items.filter(function (el, i) {
            return items.indexOf(el) === i && !items.some(function (o) { return o !== el && o.contains(el); });
        });
    }

    // 选项们最深的共同父节点（不含卡片自身）：夹了中间层 wrapper 时，它就是真正的选项组容器
    function deepestCommonParent(items, card) {
        if (!items.length) return null;
        var p = items[0].parentElement;
        while (p && p !== card) {
            var holds = true;
            for (var i = 1; i < items.length; i++) {
                if (!p.contains(items[i])) { holds = false; break; }
            }
            if (holds) return p;
            p = p.parentElement;
        }
        return null;
    }

    // 选项组容器：优先选项们最深的共同父节点；取不到再退到「直接子节点里选项最多」的候选
    function findOptGroup(card, items) {
        if (!items.length) return null;
        var deep = deepestCommonParent(items, card);
        if (deep) return deep;
        var best = null, bestDirect = 0;
        $$('ul,ol,app-question-choice,app-choice-radio,[class*=choice-container],[class*=choices],[class*=options]', card)
            .forEach(function (c) {
                var direct = items.filter(function (o) { return o.parentElement === c; }).length;
                if (direct < 2) return;
                if (direct > bestDirect || (direct === bestDirect && best && c.contains(best))) {
                    best = c;
                    bestDirect = direct;
                }
            });
        return best;
    }

    // 选项行单元：正常情况就是选项自身；若容器与选项之间还夹着 wrapper（容器的直接子节点里
    // 一个选项都没有），向下递归一层，把「只容纳一个选项」的直接子节点认作选项行来打标记。
    // 这样既不会把 wrapper 当成选项，也不会让 wrapper 层把 flex 多列压成一列。
    function resolveOptUnits(groupEl, items) {
        var plain = items.map(function (o) { return { el: o, opt: o, wrapped: false }; });
        if (!groupEl || !items.length) return plain;
        var direct = items.filter(function (o) { return o.parentElement === groupEl; });
        if (direct.length >= 2) return plain;

        var units = [];
        Array.prototype.slice.call(groupEl.children).forEach(function (k) {
            var inside = items.filter(function (o) { return k.contains(o); });
            if (inside.length === 1) units.push({ el: k, opt: inside[0], wrapped: true });
        });
        return units.length >= 2 ? units : plain;
    }

    // 材料块（背题页/申论页可能出现）：标题与正文规则同题干，但不吃悬挂
    function findMaterials(card) {
        var mats = $$('.material-content,.material-body', card);
        if (!mats.length) mats = $$('app-materials .material', card);
        return mats.filter(function (el, i) {
            return mats.indexOf(el) === i && !mats.some(function (o) { return o !== el && o.contains(el); });
        });
    }

    function probe(card) {
        var stemEl = findStem(card);
        var numEl = findNumEl(card);
        var options = findOptions(card);
        var groupEl = findOptGroup(card, options);
        var units = resolveOptUnits(groupEl, options);
        var matEls = findMaterials(card);
        return {
            cardEl: card, stemEl: stemEl, numEl: numEl, options: options,
            groupEl: groupEl, units: units, matEls: matEls
        };
    }

    // 题号所在的那一段（直接是 stem 的子块），用于取消该段首行缩进
    function numBlock(numEl, stemEl) {
        if (!numEl || !stemEl) return null;
        var el = numEl;
        while (el && el.parentElement && el.parentElement !== stemEl) el = el.parentElement;
        return (el && el.parentElement === stemEl) ? el : null;
    }

    /* ==================================================================
     * 6. 选项列数：按真实可用宽自适应 4 / 2 / 1（对应原脚本 layoutFor）
     * ================================================================ */

    var needRemeasure = false;      // 有卡片首帧量不到可用宽 → 稍后按真实宽度重测一次

    // canvas 不可用（少数内嵌 webview / 无头环境）时的兜底估宽：CJK 按 1 字宽，其余按 0.55
    function estTextPx(s, fs) {
        var cjk = 0, other = 0;
        for (var i = 0; i < s.length; i++) {
            if (/[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(s.charAt(i))) cjk++;
            else other++;
        }
        return cjk * fs + other * fs * 0.55;
    }

    // 选项内容自然宽（px）：文字实测（口径同原脚本 maxUnits*fontSize + fontSize*2.5），
    // 图片选项按渲染限幅估算
    function optionNeedPx(o, hangPx) {
        var clone = o.cloneNode(true);
        $$('.input-radio', clone).forEach(function (e) { e.remove(); });
        var txt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        var textW = txt ? textWidthPx(txt, cfg.fontSize, FONT_CHAIN) : 0;
        if (!textW && txt) textW = estTextPx(txt, cfg.fontSize);
        var textNeed = txt ? textW + cfg.fontSize * 2.5 : 0;

        var imgW = 0, hasImg = false;
        $$('img', o).forEach(function (img) {
            hasImg = true;
            var w = parseInt(img.getAttribute('width') || '', 10);
            var cur = (isFinite(w) && w > 0) ? Math.min(w, OPT_IMG_W) : 0;
            if (cur > imgW) imgW = cur;
        });
        // 纯图选项且拿不到可读宽度（行内公式小图）→ 按固定值反推，避免被误判成一行一个
        if (hasImg && imgW === 0) imgW = TEX_SMALL_W;
        var imgNeed = hasImg ? (Math.min(imgW, OPT_IMG_W) + hangPx + cfg.fontSize * 0.5) : 0;
        return Math.max(textNeed, imgNeed, NUM_SLACK);
    }

    // 可用宽（px）：选项容器 → 题干 → 题目卡片，逐级回退；都量不到返回 0（交给重测）
    function usableWidthPx(info) {
        var cands = [info.groupEl, info.stemEl, info.cardEl];
        for (var i = 0; i < cands.length; i++) {
            var el = cands[i];
            if (!el) continue;
            var w = 0;
            try { w = el.clientWidth || 0; } catch (e) { w = 0; }
            if (!w) { try { w = Math.round(el.getBoundingClientRect().width) || 0; } catch (e) { w = 0; } }
            if (w > 0) return w;
        }
        return 0;
    }

    // 列宽表达式（与原脚本 .fp-opts.grid-N > .fp-opt 的 flex-basis 公式等价）
    function optWidthExpr(cols) {
        var k = parseInt(cols, 10) || 1;
        return k <= 1 ? '100%' : 'calc((100% - ' + (COL_GAP * (k - 1)) + 'px) / ' + k + ')';
    }

    // 列宽实值：量得到可用宽就算成像素（不依赖 calc，量到的就是真实可用宽）；
    // 量不到才退回 calc 表达式，由重测修正
    function optWidthCss(info, cols) {
        var k = parseInt(cols, 10) || 1;
        var gw = usableWidthPx(info);
        if (gw) {
            var avail = gw - 2 * cfg.fontSize;
            if (avail <= 0) avail = gw;
            var px = k <= 1 ? avail : (avail - COL_GAP * (k - 1)) / k;
            if (px > 0) return Math.floor(px) + 'px';
        }
        return optWidthExpr(cols);
    }

    function pickCols(info, hangEm) {
        if (cfg.cols !== 'auto') return String(cfg.cols);      // 手动档：用户定死，不再自适应
        var n = info.units.length || info.options.length;
        if (n < 2) return '1';

        var maxK = n >= 4 ? 4 : 2;                             // 选项不足 4 个时不摆 4 列
        var hangPx = hangEm * cfg.fontSize;
        var need = 0;
        info.units.forEach(function (u) { need = Math.max(need, optionNeedPx(u.opt, hangPx)); });

        var gw = usableWidthPx(info);
        if (!gw) {
            // 首帧还没布局（clientWidth=0）：先按选项数给积极档位并登记重测，
            // 不要一上来就退回「一行一个」把多列判死
            needRemeasure = true;
            return String(maxK);
        }
        var avail = gw - 2 * cfg.fontSize;                     // 扣掉正文 2em 首行缩进
        if (avail <= 0) avail = gw;

        var list = maxK === 4 ? [4, 2] : [2];
        for (var i = 0; i < list.length; i++) {
            var k = list[i];
            var colW = (avail - COL_GAP * (k - 1)) / k;
            if (need <= colW) return String(k);                // 放得下就取更宽的列数（4 → 2）
        }
        return '1';
    }

    // 实测校验：标了 N 列但实际仍竖排（原生样式把 flex 压掉、列宽没生效）→ 逐级降档
    function countLefts(units) {
        var seen = {}, measured = 0;
        units.forEach(function (u) {
            var r = null;
            try { r = u.el.getBoundingClientRect(); } catch (e) { r = null; }
            if (!r || !r.width) return;
            measured++;
            seen[Math.round(r.left)] = 1;
        });
        return { lefts: Object.keys(seen).length, measured: measured };
    }

    function verifyCols(info, cols) {
        if (cfg.cols !== 'auto' || cols === '1') return cols;   // 手动档 / 单列：无需校验
        if (!info.groupEl) return cols;
        var gw = 0; try { gw = info.groupEl.clientWidth || 0; } catch (e) { gw = 0; }
        if (!gw) return cols;                                   // 还没布局，不做判断
        var chain = cols === '4' ? ['4', '2'] : ['2'];
        for (var i = 0; i < chain.length; i++) {
            var m = countLefts(info.units);
            if (m.measured < 2) return chain[i];                // 量不到实际尺寸：保持当前档
            if (m.lefts >= 2) return chain[i];                  // 真的排成了多列
            if (i < chain.length - 1) setAttr(info.cardEl, 'data-fp-ts-cols', chain[i + 1]);
        }
        setAttr(info.cardEl, 'data-fp-ts-cols', '1');
        return '1';
    }

    /* ------------------------------------------------------------------
     * 6.1 内联 !important 兜底
     * 样式表里的 !important 仍可能被「页面样式表 !important + 更高特异性」改写；
     * 元素内联样式 + !important 是层叠最高优先级，写上去就没有任何页面样式能压掉。
     * 只写列布局相关的属性，还原时按同一属性名单逐个摘除，不碰页面原生内联样式。
     * ---------------------------------------------------------------- */

    var HARD_PROPS = ['display', 'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink',
        'flex-basis', 'align-items', 'align-self', 'justify-content', 'column-gap', 'row-gap',
        'margin', 'margin-top', 'padding', 'padding-left', 'padding-right', 'list-style', 'width',
        'max-width', 'min-width', 'box-sizing', 'float', 'clear', 'text-indent',
        // 字母盒专用：位置/对齐必须从内联层压过原生样式
        'text-align', 'word-spacing', 'vertical-align', 'position', 'top', 'left', 'transform'];

    // 幂等写入：按元素缓存最近写入值，而不是回读 style 来比较。
    // 回读会被引擎的规范化/简写展开（padding 拆成 padding-*、var() 值被丢弃）干扰，
    // 造成同一值反复重写、DOM 抖动；缓存比较可彻底消除这类无谓写入。
    function setImp(el, prop, val) {
        if (!el || !el.style) return;
        var cache = el.__fpTsImp || (el.__fpTsImp = {});
        if (cache[prop] === val) return;
        cache[prop] = val;
        el.style.setProperty(prop, val, 'important');
    }

    function unstyledOpts(root) {
        if (!root) return;
        $$('.fp-ts-opts,.fp-ts-opt,.fp-ts-ol', root).forEach(function (n) {
            HARD_PROPS.forEach(function (p) {
                if (n.style.getPropertyValue(p)) n.style.removeProperty(p);
            });
            n.__fpTsImp = null;     // 摘除后清缓存，下次重新排版才会重新写入
        });
    }

    function hardenOpts(info, cols) {
        var g = info.groupEl;
        if (!g) return;
        setImp(g, 'display', 'flex');
        setImp(g, 'flex-direction', 'row');
        setImp(g, 'flex-wrap', 'wrap');
        setImp(g, 'align-items', 'flex-start');
        setImp(g, 'justify-content', 'flex-start');
        setImp(g, 'column-gap', COL_GAP + 'px');
        setImp(g, 'row-gap', '.5em');
        setImp(g, 'margin', '.3em 0 0 0');
        setImp(g, 'padding', '0');
        setImp(g, 'list-style', 'none');
        setImp(g, 'width', '100%');
        setImp(g, 'max-width', '100%');
        setImp(g, 'box-sizing', 'border-box');
        setImp(g, 'float', 'none');
        setImp(g, 'text-indent', '0');

        var w = optWidthCss(info, cols);
        info.units.forEach(function (u) {
            var el = u.el;
            setImp(el, 'display', 'block');
            setImp(el, 'float', 'none');
            setImp(el, 'clear', 'none');
            setImp(el, 'flex', '0 0 ' + w);
            setImp(el, 'flex-grow', '0');
            setImp(el, 'flex-shrink', '0');
            setImp(el, 'flex-basis', w);
            setImp(el, 'width', w);
            setImp(el, 'max-width', w);
            setImp(el, 'min-width', '0');
            setImp(el, 'box-sizing', 'border-box');
            setImp(el, 'margin', '0');
            setImp(el, 'padding-left', 'calc(var(--fp-ts-ohang) + var(--fp-ts-optindent))');
            setImp(el, 'list-style', 'none');
            setImp(el, 'text-indent', '0');

            // 字母盒：位置与对齐写进内联 !important。原生若把字母盒的父级设成 flex 居中，
            // 父级 align-items 会盖掉 vertical-align（改了几版都「没变化」就是这个原因），
            // 所以这里从子项侧用 align-self:flex-start 顶开，再用上边距压到正文首行基线；
            // text-align:left + 负 word-spacing(-.25em) 负责「字母靠左、句号略离字母、后面留白」。
            var ol = el.querySelector('.fp-ts-ol') || (u.opt && u.opt.querySelector('.fp-ts-ol'));
            if (ol) {
                setImp(ol, 'margin', 'calc((var(--fp-ts-lh) - 1) * .5em) 1px 0 calc(-1 * var(--fp-ts-ohang))');
                setImp(ol, 'align-self', 'flex-start');
                setImp(ol, 'vertical-align', 'top');
                setImp(ol, 'text-align', 'left');
                setImp(ol, 'word-spacing', '-.25em');
                setImp(ol, 'position', 'static');
                setImp(ol, 'top', 'auto');
                setImp(ol, 'transform', 'none');
            }
        });
    }

    /* ---------------- v1.9.4 题干左边缘对齐：题干正文推到与选项字母同一起点 ----------------
     * 只量不猜：题干首个文字块的左边缘（Range 取文字本身的墨迹左缘，不是盒左缘）、
     * 第一个选项字母的左边缘，两者的像素残差写进本卡 --fp-ts-stemfix。
     * 残差是线性的（padding 加多少、文字就移多少），所以迭代两三次即归零；
     * 量不到文字（纯图题干等）就原样不动，绝不改动页面结构。 */

    // 取「第一个非空文字节点」的左边缘（px）；skipSel 里的元素（题号等）不参与
    function firstTextLeft(root, skipSel) {
        if (!root || !document.createTreeWalker) return null;
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
            if (!/\S/.test(node.nodeValue || '')) continue;
            var p = node.parentElement;
            if (!p) continue;
            if (skipSel && p.closest && p.closest(skipSel)) continue;
            try {
                var r = document.createRange();
                r.selectNodeContents(node);
                var rects = r.getClientRects();
                for (var i = 0; i < rects.length; i++) {
                    if (rects[i] && rects[i].width > 0.5) return rects[i].left;
                }
                var b = r.getBoundingClientRect();
                if (b && b.width > 0.5) return b.left;
            } catch (e) { /* 已卸载节点 / 跨文档：跳过 */ }
        }
        return null;
    }

    // 题干正文左边缘（跳过题号与材料图，避免量到悬挂列里那个题号）
    function stemTextLeft(stemEl) {
        return firstTextLeft(stemEl, '.fp-ts-num,.fp-ts-numrow,.fp-ts-mat');
    }

    // 第一个选项字母的左边缘
    function firstOlLeft(info) {
        for (var i = 0; i < info.units.length; i++) {
            var u = info.units[i];
            var ol = u.el.querySelector('.fp-ts-ol') || (u.opt && u.opt.querySelector('.fp-ts-ol'));
            if (!ol) continue;
            var left = firstTextLeft(ol, null);
            if (left == null) left = ol.getBoundingClientRect().left;
            if (left != null) return left;
        }
        return null;
    }

    /* v1.9.5：题干预点「待重量」记号。
     * 挂着这个记号的卡片，即便签名未变、标记完整，handleCard 也不会早退跳过，
     * 保证 remeasure 重排时真能重新量一次 --fp-ts-stemfix；量准后立即摘掉，恢复正常早退。 */
    function markStemFixPending(card) { setAttr(card, 'data-fp-ts-stemfix-pending', '1'); }
    function clearStemFixPending(card) {
        if (card.hasAttribute('data-fp-ts-stemfix-pending')) card.removeAttribute('data-fp-ts-stemfix-pending');
    }

    function alignStemToOptions(card, info) {
        if (!info.stemEl || !info.groupEl || !info.units || !info.units.length) return;

        /* v1.9.5：首帧量测不可信。
         * 打开页面时粉笔的卡片还在 React 水合/布局中，题干可能还是零宽（或被隐藏），
         * 这时 Range 量出来的两侧左缘都是 0 —— 残差 0，被当成「已对齐」直接 return。
         * 而此后卡片签名没变、标记还在，handleCard 一律早退，错位就永久固化，
         * 直到手动点一下面板（force 重排）才量正。这就是「打开页面错位、点一下才对齐」的真因。
         * 修法：宽度不合法时绝不判定对齐，挂上 pending 记号 + remeasure，等布局稳定后复量。 */
        var stemW = 0;
        try { stemW = info.stemEl.getBoundingClientRect().width; } catch (e) { stemW = 0; }
        if (!(stemW > 1)) { markStemFixPending(card); needRemeasure = true; return; }

        var fix = parseFloat(card.style.getPropertyValue('--fp-ts-stemfix')) || 0;
        for (var k = 0; k < 3; k++) {
            var stemLeft = stemTextLeft(info.stemEl);
            var olLeft = firstOlLeft(info);
            if (stemLeft == null || olLeft == null) {           // 首帧还没排出来（文字量不到）
                markStemFixPending(card);                       // 挂个记号，等 remeasure 重排后再量
                needRemeasure = true;
                return;
            }
            var delta = olLeft - stemLeft;
            if (Math.abs(delta) < 0.5) { clearStemFixPending(card); return; }   // 已到像素级对齐
            var next = fix + delta;
            if (next > 48) next = 48;                           // 防异常量测把题干推出卡片
            if (next < -48) next = -48;
            if (Math.abs(next - fix) < 0.25) { clearStemFixPending(card); return; }   // 调不动了，避免自旋
            fix = next;
            card.style.setProperty('--fp-ts-stemfix', fix.toFixed(2) + 'px');
        }
        // 兜底：三轮还没归零，交给 remeasure 再走一轮（重排上限 7 次，不会自旋）
        markStemFixPending(card);
        needRemeasure = true;
    }

    /* ==================================================================
     * 7. 应用 / 还原
     * ================================================================ */

    var sigMap = new WeakMap();     // 卡片 -> 上次处理签名（DOM 与设置都没变就跳过重算）
    // 本脚本打标过的卡片根节点集合。框架重建卡片内部时会抹掉标记类与属性，
    // 但卡片根这个 DOM 节点往往还在——靠节点身份才能认出「这是自己排版过的卡」，
    // 从而在标记被抹的第一时间就地补回排版（而不是等去抖计时器）。
    var appliedRoots = new WeakSet();
    var applying = false;           // 自身写入引发 observer 时的重入保护
    var remeasureTimer = null, remeasureTries = 0;

    function clearCard(card) {
        unstyledOpts(card);         // 先摘内联兜底样式，再摘标记类/属性
        var stem = card.querySelector('.fp-ts-stem');
        if (stem) {                 // 题干首/末 p 的对齐、缩进内联样式一并摘除（只摘本脚本写过的）
            var clPs = $$('p', stem);
            var clTg = clPs.length === 1 ? [clPs[0]] : [clPs[0], clPs[clPs.length - 1]];
            clTg.forEach(function (p) {
                var cache = p.__fpTsImp;
                if (cache && cache['text-align']) p.style.removeProperty('text-align');
                if (cache && cache['text-indent']) p.style.removeProperty('text-indent');
                p.__fpTsImp = null;
            });
        }
        ['data-fp-ts', 'data-fp-ts-cols', 'data-fp-ts-num', 'data-fp-ts-stemfix-pending'].forEach(function (a) {
            if (card.hasAttribute(a)) card.removeAttribute(a);
        });
        if (card.style.getPropertyValue('--fp-ts-hang')) card.style.removeProperty('--fp-ts-hang');
        if (card.style.getPropertyValue('--fp-ts-stemfix')) card.style.removeProperty('--fp-ts-stemfix');
        appliedRoots.delete(card);
    }

    // 只拆本脚本加的、以 fp-ts- 开头的类（页面原生类名一律不碰）
    // 面板自身也用 fp-ts- 前缀类名，但它不属于「页面标记」：清残留必须跳过，否则停用时面板控件会掉样式
    function inPanel(node) {
        return !!(node && node.closest && node.closest('#' + PANEL_ID));
    }

    function stripMarkers(root) {
        $$('[class*=fp-ts-]', root || document).forEach(function (el) {
            if (inPanel(el)) return;
            var cls = [];
            Array.prototype.slice.call(el.classList).forEach(function (c) {
                if (c.indexOf('fp-ts-') === 0) cls.push(c);
            });
            cls.forEach(function (c) { el.classList.remove(c); });
        });
    }

    function restoreAll() {
        // 无痕迹：零改动直接返回（面板自身的类不计入，否则永远走全量清）
        var traces = $$('[data-fp-ts],[class*=fp-ts-]').filter(function (el) { return !inPanel(el); });
        if (!traces.length) return;
        $$('[data-fp-ts]').forEach(clearCard);
        stripMarkers(document);     // 兜底：SPA 切页后属性已被框架重建时，按类名清残留
    }

    /* ---------------- 排版自检：框架重建后自动复原 ----------------
     * 粉笔点击选项会重渲染卡片内部，把本脚本写入的标记类/内联样式清掉；
     * 而卡片签名（题号·选项数·宽度）没变，早退逻辑会让排版一直停在默认样式上
     * （表现：选完选项，排版「变回默认」）。所以每次处理前先自检标记在不在，
     * 不在就摘掉残留、整卡重排一次。 */

    function hasFpClass(el) {
        if (!el || !el.classList) return false;
        for (var i = 0; i < el.classList.length; i++) {
            if (el.classList[i].indexOf('fp-ts-') === 0) return true;
        }
        return false;
    }

    // 标记是否完好：本脚本写过的关键标记只要丢一个，就认定卡片被重建过
    function markersIntact(card, info) {
        if (!card || !card.hasAttribute('data-fp-ts')) return false;
        info = info || probe(card);
        if (info.stemEl && !hasFpClass(info.stemEl)) return false;
        var i;
        for (i = 0; i < info.matEls.length; i++) {
            if (!hasFpClass(info.matEls[i])) return false;
        }
        if (info.numEl && !hasFpClass(info.numEl)) return false;
        if (info.groupEl && info.units.length >= 2) {
            if (!hasFpClass(info.groupEl)) return false;
            if (!card.hasAttribute('data-fp-ts-cols')) return false;
            var cache = info.groupEl.__fpTsImp;
            if (!cache || cache['display'] !== 'flex') return false;   // 内联兜底样式也被清掉了
            for (i = 0; i < info.units.length; i++) {
                if (!hasFpClass(info.units[i].el)) return false;
                var ol = info.units[i].el.querySelector('.input-radio') ||
                         info.units[i].opt.querySelector('.input-radio');
                if (ol && !hasFpClass(ol)) return false;
            }
        }
        return true;
    }

    // 同一张卡片在短时间内被反复抹掉时不再硬顶，避免和页面互相刷（限流窗口 4s / 10 次）
    var repairLog = new WeakMap();
    var REPAIR_WINDOW = 4000, REPAIR_MAX = 10;

    function repairAllowed(card) {
        var now = Date.now();
        var rec = repairLog.get(card);
        if (!rec || now - rec.t0 > REPAIR_WINDOW) rec = { t0: now, n: 0 };
        rec.n++;
        repairLog.set(card, rec);
        return rec.n <= REPAIR_MAX;
    }

    function handleCard(card) {
        var info = probe(card);
        // 认不出题目结构的卡片：安全跳过，绝不做任何改动
        if (!info.stemEl && !info.options.length && !info.matEls.length) return false;

        var numEl = info.numEl;
        var numText = numEl ? (numEl.textContent || '').replace(/\s+/g, '').trim() : '';

        // 签名 = 题号文字 + 选项数(原始/拆分后) + 可用宽 + 设置版本，都没变就不重复算
        var gw = 0;
        try {
            gw = info.groupEl ? info.groupEl.clientWidth : (info.stemEl ? info.stemEl.clientWidth : 0);
        } catch (e) { gw = 0; }
        var sig = [numText, info.options.length, info.units.length, Math.round(gw), cfgStamp].join('|');

        // 签名相同 + 标记仍在 → 真的没变化，跳过；
        // 签名相同但标记被框架抹掉 → 必须重排（这正是「选完选项排版回退」的根因）
        var intact = markersIntact(card, info);
        var sigSame = (sigMap.get(card) === sig);
        // v1.9.5：挂着「题干预点待重量」记号的卡片，即便签名没变也不能早退——
        // 否则 remeasure 重排后会因签名相同被跳过，--fp-ts-stemfix 永远得不到重算，
        // 打开页面时的错位就此固化，只有手动 force 重排（点面板）才解得开。
        var pendFix = card.hasAttribute('data-fp-ts-stemfix-pending');
        if (sigSame && intact && !pendFix) return true;
        if (sigSame && !repairAllowed(card)) return true;   // 与页面互相覆盖时先放手，不自旋
        sigMap.set(card, sig);
        var wasApplied = appliedRoots.has(card);             // v1.9.5：判断是不是「首次上妆」
        if (!intact) clearCard(card);                        // 先摘干净残留，再整卡重排，避免两套样式叠加

        setAttr(card, 'data-fp-ts', '1');
        appliedRoots.add(card);

        // 悬挂宽度：固定 2em
        var hangEm = HANG_FALLBACK;
        setVar(card, '--fp-ts-hang', hangEm.toFixed(3) + 'em');

        // 题干 / 材料
        if (info.stemEl) addClass(info.stemEl, 'fp-ts-stem');
        
        // 题干盒内：仅首个 p 与末个 p 左对齐，中间段落不动
        if (info.stemEl) {
            var stemPs = $$('p', info.stemEl);
            var stemTg = stemPs.length === 1 ? [stemPs[0]] : [stemPs[0], stemPs[stemPs.length - 1]];
            stemTg.forEach(function (p) {
                setImp(p, 'text-indent', '0');
                setImp(p, 'text-align', 'left');
            });
        }
        
        info.matEls.forEach(function (m) { addClass(m, 'fp-ts-mat'); });

        // 题号定位方式三态：inline（与题干同盒）/ row（独占标题行）/ keep（标题行还有别的内容）
        if (numEl) {
            addClass(numEl, 'fp-ts-num');
            if (info.stemEl && info.stemEl.contains(numEl)) {
                card.setAttribute('data-fp-ts-num', 'inline');
                var blk = numBlock(numEl, info.stemEl);
                if (blk) addClass(blk, 'fp-ts-np');     // 题号所在段落不再叠首行缩进
            } else {
                var row = numEl.parentElement;
                var rowText = row ? (row.textContent || '').replace(/\s+/g, '').trim() : '';
                if (row && row !== card && rowText === numText && row.children.length <= 1) {
                    card.setAttribute('data-fp-ts-num', 'row');
                    addClass(row, 'fp-ts-numrow');
                } else {
                    card.setAttribute('data-fp-ts-num', 'keep');
                }
            }
        } else if (card.hasAttribute('data-fp-ts-num')) {
            card.removeAttribute('data-fp-ts-num');
        }

        // 选项组 + 列数（同一道题列数一致）
        if (info.groupEl && info.units.length >= 2) {
            addClass(info.groupEl, 'fp-ts-opts');
            info.units.forEach(function (u) {
                addClass(u.el, 'fp-ts-opt');                  // 选项行（夹 wrapper 时标在 wrapper 上）
                var ol = u.el.querySelector('.input-radio') || u.opt.querySelector('.input-radio');
                if (ol) addClass(ol, 'fp-ts-ol');
            });
            var cols = pickCols(info, hangEm);
            hardenOpts(info, cols);                          // 内联 !important 兜底，防被原生样式压掉
            setAttr(card, 'data-fp-ts-cols', cols);
            // 实测校验：标了多列却仍被排成一列时逐级降档，避免「设置写了、视觉没变」
            var verified = verifyCols(info, cols);
            if (verified !== cols) {
                hardenOpts(info, verified);
                setAttr(card, 'data-fp-ts-cols', verified);
            }
        } else if (card.hasAttribute('data-fp-ts-cols')) {
            card.removeAttribute('data-fp-ts-cols');
        }

        // v1.9.4：把题干正文左边缘实测对齐到第一个选项字母的左边缘（写 --fp-ts-stemfix）
        if (info.stemEl && info.groupEl && info.units.length >= 1) {
            alignStemToOptions(card, info);
        }
        /* v1.9.5：首次排版时字体/布局还没稳定，首帧那次量测得到的残差可能是错的
         * （甚至巧合为 0，被当成已对齐）。而「签名没变 + 标记仍在」会让后续回调直接早退，
         * 于是错位固化到用户手动点面板为止。所以首次上妆后强制挂一次延迟复量，
         * 等布局稳定后再校一遍（remeasure 上限 7 次、120ms 起，不会自旋）。 */
        if (!wasApplied) { markStemFixPending(card); needRemeasure = true; }
        return true;
    }

    // 首帧量不到可用宽时的补救：隔几拍按真实布局重算（最多 7 次，避免无谓轮询）
    function clearRemeasure() {
        if (remeasureTimer) { clearTimeout(remeasureTimer); remeasureTimer = null; }
        remeasureTries = 0;
    }

    function scheduleRemeasure() {
        if (remeasureTimer || !cfg.enabled) return;
        if (remeasureTries >= 7) return;
        remeasureTries++;
        remeasureTimer = setTimeout(function () {
            remeasureTimer = null;
            if (!cfg.enabled) return;
            needRemeasure = false;
            sigMapClear();                 // 尺寸变了，旧签名一律作废
            applyAll(false);
        }, remeasureTries <= 3 ? 120 : 400);
    }

    function applyAll(force) {
        if (!cfg.enabled) return;
        if (force) sigMapClear();
        needRemeasure = false;
        applying = true;
        var seen = [];
        var cards = findCards();
        try {
            cards.forEach(function (card) { if (handleCard(card)) seen.push(card); });
            // 清理已从页面消失/不再识别的卡片残留
            $$('[data-fp-ts]').forEach(function (card) {
                if (seen.indexOf(card) < 0) clearCard(card);
            });
        } finally {
            applying = false;
        }
        setStatus('已排版 ' + seen.length + ' 道题 · ' + (cfg.cols === 'auto' ? '列数自动' : cfg.cols + ' 列'));
        if (needRemeasure) scheduleRemeasure();
    }

    function sigMapClear() {
        // WeakMap 无法清空，直接换一个实例即可
        sigMap = new WeakMap();
    }

    function clearAllMarkers() {
        clearRemeasure();
        restoreAll();
        sigMapClear();
    }

    function setEnabled(on) {
        cfg.enabled = !!on;
        saveSettings();
        if (styleEl) styleEl.disabled = !cfg.enabled;
        if (cfg.enabled) {
            pushRootVars();
            applyAll(true);
        } else {
            clearAllMarkers();
            clearRootVars();
            setStatus('已停用：页面样式已还原');
        }
        syncPanel();
    }

    /* ==================================================================
     * 8. 参数面板
     * ================================================================ */

    var panel = null, statusEl = null, fontStatusEl = null, ctrl = {};

    function el(tag, props, kids) {
        var n = document.createElement(tag);
        if (props) Object.keys(props).forEach(function (k) {
            if (k === 'style') n.setAttribute('style', props[k]);
            else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), props[k]);
            else if (k === 'text') n.textContent = props[k];
            else n.setAttribute(k, props[k]);
        });
        (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
        return n;
    }

    function row(label, control, extraClass) {
        return el('div', { 'class': 'fp-ts-row' + (extraClass ? ' ' + extraClass : '') },
            [el('span', { text: label }), control]);
    }

    // 加减步进控件：左「−」右「＋」，中间显示当前值；连点按 step 递增/递减，超界自动夹在 LIMITS 内
    function stepper(key, step, digits) {
        var box = el('div', { 'class': 'fp-ts-stepbox' });
        var val = el('span', { 'class': 'fp-ts-stepval' });
        var minus = el('button', { type: 'button', 'class': 'fp-ts-stepbtn', text: '\u2212' });
        var plus = el('button', { type: 'button', 'class': 'fp-ts-stepbtn', text: '\uff0b' });

        function fmt(v) {
            var n = parseFloat(v);
            if (!isFinite(n)) n = cfg[key];
            return String(digits ? parseFloat(n.toFixed(digits)) : Math.round(n));
        }
        function show(v) { val.textContent = fmt(v); }
        function nudge(dir) {
            if (!cfg.enabled) { show(cfg[key]); return; }
            var next = parseFloat(num(parseFloat(cfg[key]) + step * dir, cfg[key], key).toFixed(4));
            if (next === cfg[key]) { show(cfg[key]); return; }
            setCfg(key, next);
        }
        minus.addEventListener('click', function () { nudge(-1); });
        plus.addEventListener('click', function () { nudge(1); });

        box.appendChild(minus);
        box.appendChild(val);
        box.appendChild(plus);

        return {
            root: box,
            setValue: show,
            setDisabled: function (off) {
                minus.disabled = off;
                plus.disabled = off;
                box.classList.toggle('fp-ts-stepbox-off', !!off);
            }
        };
    }

    function setCfg(key, value) {
        cfg[key] = value;
        cfgStamp++;
        saveSettings();
        pushRootVars();
        applyAll(true);
        syncPanel();
    }

    function buildPanel() {
        if (panel) return;
        panel = el('div', { id: PANEL_ID });

        var fold = el('button', {
            'class': 'fp-ts-fold', type: 'button', text: '\u2212',
            onmousedown: function (e) { e.stopPropagation(); },
            onclick: function () {
                panel.classList.toggle('fp-ts-collapsed');
                fold.textContent = panel.classList.contains('fp-ts-collapsed') ? '+' : '\u2212';
            }
        });
        var head = el('div', { 'class': 'fp-ts-head' },
            [el('span', { text: '粉笔一页成卷 v' + VERSION }), fold]);

        // 启停
        var sw = el('input', {
            type: 'checkbox', onchange: function () { setEnabled(sw.checked); }
        });
        ctrl.sw = sw;
        var toggleRow = row('启用页面内排版', sw);

        // 联网补字：安卓平板、iPad 这类没装宋体的设备靠它兜底
        var wf = el('input', {
            type: 'checkbox', onchange: function () { setWebFont(wf.checked); }
        });
        ctrl.webFont = wf;
        var webFontRow = row('缺宋体时联网补字', wf);

        // 字号 / 行高（加减调整）
        ctrl.fontSize = stepper('fontSize', 1, 0);
        ctrl.lineHeight = stepper('lineHeight', 0.05, 2);

        // 选项列数
        ctrl.cols = el('select', {
            onchange: function () { setCfg('cols', ctrl.cols.value); }
        }, [
            el('option', { value: 'auto', text: '自动（4/2/1）' }),
            el('option', { value: '1', text: '1 列' }),
            el('option', { value: '2', text: '2 列' }),
            el('option', { value: '4', text: '4 列' })
        ]);

        ctrl.qSpacing = stepper('qSpacing', 1, 0);

        var btns = el('div', { 'class': 'fp-ts-btns' }, [
            el('button', { type: 'button', text: '恢复默认', onclick: function () { resetCfg(); } }),
            el('button', { type: 'button', text: '重新排版', onclick: function () { applyAll(true); } })
        ]);

        statusEl = el('div', { 'class': 'fp-ts-status', text: '' });
        fontStatusEl = el('div', { 'class': 'fp-ts-status fp-ts-fontstatus', text: '' });

        var body = el('div', { 'class': 'fp-ts-body' }, [
            toggleRow,
            webFontRow,
            row('正文字号 (px)', ctrl.fontSize.root),
            row('正文行高', ctrl.lineHeight.root),
            row('选项列数', ctrl.cols),
            row('题间距 (px)', ctrl.qSpacing.root),
            btns, statusEl, fontStatusEl
        ]);

        panel.appendChild(head);
        panel.appendChild(body);
        panel.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        panel.addEventListener('click', function (e) { e.stopPropagation(); });
        document.body.appendChild(panel);
        syncPanel();
    }

    function resetCfg() {
        cfg = JSON.parse(JSON.stringify(DEFAULTS));
        cfgStamp++;
        saveSettings();
        if (cfg.webFont) setupWebFont();
        else { clearWebFontLinks(); webFontState = 'off'; }
        if (styleEl) styleEl.disabled = !cfg.enabled;
        if (cfg.enabled) {
            pushRootVars();
            applyAll(true);
        } else {
            clearAllMarkers();
            clearRootVars();
        }
        syncPanel();
    }

    function syncPanel() {
        if (!panel) return;
        ctrl.sw.checked = cfg.enabled;
        ctrl.webFont.checked = cfg.webFont;
        ctrl.fontSize.setValue(cfg.fontSize);
        ctrl.lineHeight.setValue(cfg.lineHeight);
        ctrl.qSpacing.setValue(cfg.qSpacing);
        ctrl.cols.value = cfg.cols;
        ['fontSize', 'lineHeight', 'qSpacing'].forEach(function (k) { ctrl[k].setDisabled(!cfg.enabled); });
        ctrl.cols.disabled = !cfg.enabled;
        refreshFontStatus();
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    /* ==================================================================
     * 9. 页面变化监听（SPA 切题 / 异步加载新卡片）
     * ================================================================ */

    var pending = null;
    var mo = null;
    var APPLY_DELAY = 250;      // 常规（切题 / 新增卡片）去抖
    var REPAIR_DELAY = 80;      // 抢修被限流挡下时的兜底重试

    function scheduleApply(delay) {
        if (pending) return;
        pending = setTimeout(function () {
            pending = null;
            applyAll(false);
        }, typeof delay === 'number' ? delay : APPLY_DELAY);
    }

    // 从节点向上找「本脚本排版过的卡片根」：标记被框架抹了也照样认得出（靠节点身份）
    function nearestApplied(node) {
        for (var n = node; n && n.nodeType === 1; n = n.parentElement) {
            if (appliedRoots.has(n)) return n;
        }
        return null;
    }

    /* 就地抢修（本版消除「闪一下默认排版」的关键）
     * MutationObserver 回调是在当前任务的微任务阶段执行的，早于浏览器绘制。
     * 只要在这里（而不是去抖计时器里）把排版补回去，浏览器就根本画不到
     * 「默认排版」那一帧，闪一下自然消失。
     * 抢修走 handleCard：标记被抹会自动先 clearCard 再整卡重排，
     * 反复互刷的限流也统一由它内部的 repairAllowed 把关。 */
    function repairNow(card) {
        if (!card || !card.isConnected) return;
        applying = true;
        try {
            handleCard(card);
        } finally {
            applying = false;
        }
    }

    // 观察器只负责「页面换了」这件事：新增/删除题目、SPA 切题、卡片被框架重建。
    // 本脚本自己对卡片写的 class / style / data-fp-ts* 一律忽略（标记完好即视为自己人），
    // 否则每次排版都会再触发一次回调，白白重排一轮。
    var OWN_ATTRS = { 'class': 1, 'style': 1, 'data-fp-ts': 1, 'data-fp-ts-cols': 1, 'data-fp-ts-num': 1 };

    // 新插入的节点是否像一道题（切题 / 追加题目时用来判断要不要抢在绘制前排版）
    var CARD_HINT = 'app-ti, .ti-item, .question-item, .choice-radio';
    function looksLikeCard(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.matches && node.matches(CARD_HINT)) return true;
        return !!(node.querySelector && node.querySelector(CARD_HINT));
    }

    function startObserver() {
        if (mo || !document.body) return;
        mo = new MutationObserver(function (muts) {
            if (!cfg.enabled || applying) return;
            var need = false;
            var eager = false;           // 新题卡插入 → 同样抢在绘制前排版
            var cand = [];               // 本轮疑似被框架重建的卡片（去重后统一自检）
            for (var i = 0; i < muts.length; i++) {
                var m = muts[i];
                var t = m.target;
                if (!t || t.nodeType !== 1 || !t.closest) { need = true; continue; }
                if (t.closest('#' + PANEL_ID)) continue;                        // 面板自身的增删改
                var host = nearestApplied(t);
                if (host) {                                                     // 变化发生在已排版卡片内部
                    if (cand.indexOf(host) < 0) cand.push(host);
                    // 卡内真的增删了节点（解析区、材料、选项被追加…）：除了抢修，照旧再走一轮
                    // 全量重扫，把新增的子结构也识别进去（签名没变时这一步是空跑，代价可忽略）
                    if (m.type === 'childList') need = true;
                    continue;
                }
                if (m.type === 'childList' && m.addedNodes) {
                    for (var k = 0; k < m.addedNodes.length; k++) {
                        if (looksLikeCard(m.addedNodes[k])) { eager = true; break; }
                    }
                }
                need = true;                                                    // 卡片外的变化照旧走一轮（签名兜底）
            }
            if (cand.length) {
                var didRepair = false, retry = false;
                for (var j = 0; j < cand.length; j++) {
                    var c = cand[j];
                    if (!c.isConnected || markersIntact(c)) continue;            // 标记完好 = 自己人写的，无视
                    repairNow(c);                                               // 同步补回，赶在绘制之前
                    didRepair = true;
                    if (!markersIntact(c)) retry = true;                         // 被限流 / 又被抹 → 稍后再兜一次
                }
                if (didRepair && pending) { clearTimeout(pending); pending = null; }
                if (retry) scheduleApply(REPAIR_DELAY);
            }
            if (eager) applyAll(false);       // 新题卡：当场排，别等去抖（否则会闪一帧默认版式）
            else if (need) scheduleApply();
        });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    }

    /* ==================================================================
     * 10. 启动
     * ================================================================ */

    function boot() {
        cfg = readSettings();
        injectStyles();
        if (styleEl) styleEl.disabled = !cfg.enabled;
        buildPanel();
        setupWebFont();          // 本机没宋体就联网补一份（异步，不影响首屏）
        startObserver();
        // 窗口尺寸变化会改变可用宽 → 重新判定列数（去抖，走同一条 scheduleApply 通道）
        window.addEventListener('resize', function () {
            if (cfg.enabled) scheduleApply();
        });
        if (cfg.enabled) {
            pushRootVars();
            applyAll(true);
        } else {
            clearRootVars();
            setStatus('已停用：页面样式已还原');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
