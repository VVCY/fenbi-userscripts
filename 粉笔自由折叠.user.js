// ==UserScript==
// @name         粉笔自由折叠
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  右上角常驻「显示设置」面板：三组切换按钮，各自显示当前状态（已开/已关）——题目（一键开合所有题干/选项）、答案（一键显隐「正确答案/你的答案/全站正确率/易错项/选项对错颜色」与「答题用时」）、解析（一键开合所有解析）；材料分栏题组已展平：材料区整体移除，每 5 题一组的分栏题拆成一道道独立单题（与前面的普通题同宽同距）；点击题号折叠/展开题干并把该题顶到页首；点击「解析」折叠/展开解析；悬浮题号显示正确答案与全站正确率；题号按正确率着色；面板第四组「错题」开关：开启后只保留做错的题（做对与未作答的题一并隐藏）；↑/↓ 切题，Enter/右键 开关解析；卷名可点击跳 B 站搜索；隐藏考点/来源/笔记/箭头/题型标识等无关项
// @author       You
// @match        *://spa.fenbi.com/*
// @match        *://www.fenbi.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 防重复运行：同一份脚本被安装成多个副本（或与内容相同的旧脚本同时启用）时，
    // document 级 keydown / contextmenu / scroll 会被绑定多次，表现为
    // "↓ 一次跳两题"、"Enter/右键打开解析后立刻又被关掉"。这里只允许第一个实例生效。
    if (window.__fenbiFoldV2Loaded) {
        console.warn('[粉笔折叠查看] 检测到重复运行，本实例已退出');
        return;
    }
    window.__fenbiFoldV2Loaded = true;

    const TIP_ID = 'fenbi-fold-tip';
    const BTN_ID = 'fenbi-fold-toggle-btn';
    const PANEL_ID = 'fh-panel';          // 右上角「显示设置」面板
    var RES_MODE = null;                  // 解析期望态：'open' / 'close' / null（不干预）
    var BODY_MODE = null;                 // 题目（题干+选项）期望态：'open' / 'close' / null（不干预）
    var HIDE_MODE = null;                 // 答案类信息（含答题用时）期望态：'open' / 'close' / null（不干预）

    const VERIFY_LOW = 25;   // <=25%   紫色
    const RED_LIMIT = 80;    // <80%    红色

    // 每题中"内容区"的几块（题干 / 选项 / 统计信息），点题号统一显示或隐藏
    const SEL_BODY = ['app-question-choice', 'app-choice-radio', 'app-solution-overall'];

    /* ---------- 题目集合 ---------- */

    function getItems() {
        let items = Array.from(document.querySelectorAll('app-ti.question-multiple'));
        if (!items.length) items = Array.from(document.querySelectorAll('app-ti'));
        if (!items.length) items = Array.from(document.querySelectorAll('.ti-container'));
        return items;
    }

    /* ---------- 题号集合 ---------- */

    function getAllNos() {
        return Array.from(document.querySelectorAll('app-ti .title-index'));
    }

    /* ---------- 数据读取（按标题文本定位，不依赖通用类名） ---------- */

    function readOverall(item, key, cls) {
        const boxes = item.querySelectorAll('.overall-item');
        for (let i = 0; i < boxes.length; i++) {
            const t = boxes[i].querySelector('.overall-item-title');
            if (!t || t.textContent.indexOf(key) === -1) continue;
            const v = boxes[i].querySelector(cls);
            if (!v) continue;
            return v.textContent.trim();
        }
        return '';
    }

    function getRate(item) {
        let t = readOverall(item, '全站正确率', '.correct-rate').replace(/\s+/g, '');
        if (t && !/%$/.test(t)) t += '%';
        return t || '无数据';
    }

    function getAnswer(item) {
        return readOverall(item, '正确答案', '.correct-answer') || '无数据';
    }

    function toNum(s) {
        const m = String(s || '').match(/\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
    }

    /* ---------- 悬浮提示 ---------- */

    var _tipAnchor = null;

    function removeTip() {
        const t = document.getElementById(TIP_ID);
        if (t) t.remove();
        _tipAnchor = null;
    }

    // 把提示定位到锚点元素下方（滚动过程中会被反复调用，实现"跟随"）
    function placeTip() {
        const tip = document.getElementById(TIP_ID);
        if (!tip || !_tipAnchor) return;
        const r = _tipAnchor.getBoundingClientRect();
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        let left = r.left;
        let top = r.bottom + 6;
        if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
        if (top + th > window.innerHeight - 8) top = r.top - th - 6;
        tip.style.left = Math.max(8, left) + 'px';
        tip.style.top = Math.max(8, top) + 'px';
    }

    function showTip(anchor, rate, answer) {
        removeTip();

        const tip = document.createElement('div');
        tip.id = TIP_ID;
        tip.style.cssText = 'position:fixed;z-index:2147483647;background:rgba(30,30,30,.96);' +
            'color:#fff;font-size:13px;line-height:1.8;padding:8px 12px;border-radius:6px;' +
            'font-family:Menlo,Consolas,monospace;white-space:nowrap;pointer-events:none;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.25);';

        const n = toNum(rate);

        const l1 = document.createElement('div');
        l1.textContent = '全站正确率：' + rate;
        l1.style.fontWeight = 'bold';
        if (!isNaN(n) && n <= VERIFY_LOW) l1.style.color = '#d8a0ff';
        else if (!isNaN(n) && n < RED_LIMIT) l1.style.color = '#ff8080';
        tip.appendChild(l1);

        const l2 = document.createElement('div');
        l2.textContent = '正确答案：' + answer;
        tip.appendChild(l2);

        document.body.appendChild(tip);
        _tipAnchor = anchor;
        placeTip();
    }

    /* ---------- 显隐控制（只改 display，不动 DOM 结构） ---------- */

    function bodyEls(item) {
        return SEL_BODY.map(function (s) { return item.querySelector(s); }).filter(Boolean);
    }

    // 解析可能被拆在多个容器里（不同题型结构不一样），
    // 必须把所有命中的容器都收进来一起控制，只认第一个会漏掉半截
    var RES_SELECTORS = ['app-result-common', 'app-solution-content',
                         '.solution-container', 'app-result'];

    function resEls(item) {
        var out = [];
        for (var i = 0; i < RES_SELECTORS.length; i++) {
            var nodes = item.querySelectorAll(RES_SELECTORS[i]);
            for (var j = 0; j < nodes.length; j++) {
                if (out.indexOf(nodes[j]) === -1) out.push(nodes[j]);
            }
        }
        return out;
    }

    function resEl(item) {
        var els = resEls(item);
        return els.length ? els[0] : null;
    }

    function isBodyOpen(item) {
        const els = bodyEls(item);
        if (!els.length) return true;
        return els[0].style.display !== 'none';
    }

    function isResOpen(item) {
        // 优先用脚本自己记的状态：解析区可能是懒创建的，
        // 此时 DOM 查不到容器，不能据此判定"已展开"
        if (typeof item.__fenbiResOpen === 'boolean') return item.__fenbiResOpen;
        // 粉笔默认把整块解析折叠：只看 section 的 display 会误判成"已展开"，
        // 必须以外层折叠容器的高为准
        var box = resBoxes(item)[0];
        if (box) {
            item.__fenbiResOpen = !isBoxCollapsed(box);
            return item.__fenbiResOpen;
        }
        const el = resEl(item);
        item.__fenbiResOpen = el ? el.style.display !== 'none' : true;
        return item.__fenbiResOpen;
    }

    // 纯读：这一题的解析当下是不是真的展开（只看折叠容器高度，不改任何状态）
    function readRealResOpen(item) {
        var box = resBoxes(item)[0];
        if (box) return !isBoxCollapsed(box);
        var el = resEl(item);
        if (el) return el.style.display !== 'none';
        return typeof item.__fenbiResOpen === 'boolean' ? item.__fenbiResOpen : true;
    }

    function setBody(item, open) {
        bodyEls(item).forEach(function (el) {
            el.style.display = open ? '' : 'none';
        });
        hideExtras(item);
    }

    /* ---------- 解析折叠容器：粉笔自己的 height:0 裁剪 ---------- */
    // 粉笔把整块解析（标题+正文+考点/来源/笔记）塞进 div.result-common-container，
    // 折叠态是内联 style="height:0px;overflow:hidden"——正文被裁掉，视觉上只剩「解析」标题，
    // 这就是"解析空白"的真正原因。解析正文一直在 DOM 里、文本非空，
    // 所以只改 section 的 display 完全无效，必须解开这一层的高度。

    function resBoxes(item) {
        return item.querySelectorAll('.result-common-container');
    }

    function isBoxCollapsed(box) {
        var st = box.style;
        if (!st) return false;
        return st.height === '0px' || st.height === '0';
    }

    // 只写内联样式（轮询同步用，不点原生按钮，避免反复触发动画抖动）
    function paintResBox(item, open) {
        var boxes = resBoxes(item);
        for (var i = 0; i < boxes.length; i++) {
            var st = boxes[i].style;
            if (!st) continue;
            if (open) {
                st.removeProperty('height');
                st.removeProperty('overflow');
            } else {
                st.height = '0px';
                st.overflow = 'hidden';
            }
        }
    }

    // 切换时用：若当前折叠态与目标不符，先点一次原生折叠按钮，
    // 让 Angular 内部状态真正翻过去（否则变更检测会把 height:0 写回来），
    // 再补内联样式，保证动画期间视觉立刻正确
    function setResBox(item, open) {
        var boxes = resBoxes(item);
        for (var i = 0; i < boxes.length; i++) {
            if (isBoxCollapsed(boxes[i]) === !!open) {
                var tb = boxes[i].querySelector('.toggle-btn');
                if (tb) {
                    try {
                        _fhProgResClick = true;   // 脚本自己点的，别算作"用户手动"
                        tb.click();
                    } catch (err) { /* 忽略 */ }
                    finally { _fhProgResClick = false; }
                }
            }
        }
        paintResBox(item, open);
    }

    function setRes(item, open) {
        open = !!open;
        item.__fenbiResOpen = open;

        // 解析区可能是懒创建的：展开时容器还不存在、或内容是空的，
        // 先替用户点一下原生的解析开关，把它唤出来
        if (open) ensureResRendered(item);

      