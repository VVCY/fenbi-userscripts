// ==UserScript==
// @name         粉笔自由折叠
// @namespace    http://tampermonkey.net/
// @version      3.0.3
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
    const PANEL_POS_KEY = 'fh_panel_pos_v1';  // 面板拖拽位置记忆的 localStorage 键
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

        // 展开：所有解析容器一起显示；收起：一起隐藏
        var els = resEls(item);
        for (var i = 0; i < els.length; i++) {
            els[i].style.display = open ? '' : 'none';
        }

        // 关键：解开/压回粉笔自己的折叠容器高度，否则正文仍被裁成空白
        setResBox(item, open);

        if (item.__fenbiResBtn) {
            item.__fenbiResBtn.textContent = open ? '解析 ▾' : '解析 ▸';
        }
        if (open) hideExtras(item);
    }

    /* ---------- 隐藏无关项：考点 / 来源 / 笔记 / 题型标识 ---------- */

    // 需要整块隐藏的栏目（按标题文字匹配，不依赖具体 class）
    var HIDE_SECTIONS = ['考点', '来源', '笔记', '考察能力', '考察知识点'];

    // class 里的"独立词"匹配：resource 不会命中 source，避免误伤解析容器
    function hasClassToken(el, token) {
        var cn = el.getAttribute ? (el.getAttribute('class') || '') : '';
        if (!cn) return false;
        var parts = cn.toLowerCase().split(/\s+/);
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (!p) continue;
            if (p === token) return true;
            if (p.indexOf(token + '-') === 0 || p.indexOf(token + '_') === 0) return true;
            if (p.indexOf('-' + token) !== -1 || p.indexOf('_' + token) !== -1) return true;
        }
        return false;
    }

    // 元素（含其内部）是否装着解析正文——这类块任何情况下都不许隐藏
    function isSolutionCore(el) {
        if (!el) return false;
        var tag = (el.tagName || '').toUpperCase();
        if (tag === 'APP-RESULT-COMMON' || tag === 'APP-SOLUTION-CONTENT' ||
            tag === 'APP-RESULT') return true;
        if (hasClassToken(el, 'solution-container')) return true;
        if (!el.querySelector) return false;
        return !!el.querySelector('app-result-common, app-solution-content, app-result, ' +
            '.solution-container, .solution-text, .solution-body, .answer-text, ' +
            '.analysis-content, .solution-content');
    }

    // 往上层扩块时的刹车：父容器里除 keep 之外还有别的实质内容，就别再往上吞
    function hasForeignContent(parent, keep) {
        var kids = parent.children;
        for (var i = 0; i < kids.length; i++) {
            var k = kids[i];
            if (k === keep) continue;
            if (k.id === TIP_ID || k.id === BTN_ID) continue;
            if (isSolutionCore(k)) return true;
            if ((k.textContent || '').replace(/\s+/g, '').length > 20) return true;
        }
        return false;
    }

    // 解析可能是懒渲染：展开那一刻容器还不存在或内容为空，
    // 就替用户点一下原生的解析开关把它唤出来。
    // 允许重复尝试（最多 3 次）：滚动加载出的新题首次点开时容器往往还没建好，
    // 只点一次会造成"有的题解析展不开 / 展开不完整"
    function ensureResRendered(item) {
        var el = resEl(item);
        var txt = el ? (el.textContent || '').replace(/\s+/g, '') : '';
        if (txt.length > 20) { item.__fenbiNativeTries = 0; return; }   // 已有内容
        if ((item.__fenbiNativeTries || 0) >= 3) return;
        item.__fenbiNativeTries = (item.__fenbiNativeTries || 0) + 1;
        var btns = item.querySelectorAll('button, [role="button"], a');
        for (var i = 0; i < btns.length; i++) {
            var t = (btns[i].textContent || '').replace(/\s+/g, '');
            if (t.indexOf('解析') !== -1 && t.length <= 10) {
                try { btns[i].click(); } catch (err) { /* 忽略 */ }
                return;
            }
        }
    }

    function hideExtras(item) {
        // 1) 题型标识（"单选题"等）
        var typeNames = item.querySelectorAll('.title-type-name, .questions-single-container');
        for (var i = 0; i < typeNames.length; i++) {
            typeNames[i].style.display = 'none';
        }

        // 2) "添加笔记"输入框
        var note = item.querySelector('textarea[placeholder="添加笔记"]');
        if (note) note.style.display = 'none';

        // 3) 解析标题旁的折叠箭头按钮
        var resTitle = item.querySelector('.solution-title-container, app-solution-title');
        if (resTitle) {
            var btns = resTitle.querySelectorAll('button, span[role="button"], [role="button"], [aria-expanded]');
            for (var b = 0; b < btns.length; b++) {
                var btxt = (btns[b].textContent || '').trim();
                if (btxt.indexOf('解析') === -1 && btxt.length < 10) {
                    btns[b].style.display = 'none';
                }
            }
        }

        // 4) 按标题文字定位「考点 / 来源 / 笔记」三个大项，整块隐藏。
        //    只认"标题型"元素（自身文字很短），最多向上扩 2 层；
        //    一旦上层混入了别的实质内容就立刻停手，绝不碰解析正文所在块。
        var cands = item.querySelectorAll('div, span, p, h1, h2, h3, h4, dt, section');
        for (var c = 0; c < cands.length; c++) {
            var el = cands[c];
            var txt = (el.textContent || '').replace(/\s+/g, '');
            if (!txt || txt.length > 8) continue;
            var isLabel = false;
            for (var k = 0; k < HIDE_SECTIONS.length; k++) {
                if (txt === HIDE_SECTIONS[k]) { isLabel = true; break; }
            }
            if (!isLabel) continue;

            var box = el;
            for (var up = 0; up < 2; up++) {
                var p = box.parentElement;
                if (!p || p === item) break;
                var pTag = (p.tagName || '').toUpperCase();
                if (pTag === 'APP-RESULT-COMMON' || pTag === 'APP-TI') break;
                if (hasForeignContent(p, box)) break;
                box = p;
            }
            // 最终护栏：只要这块里装着解析正文，一律不动
            if (isSolutionCore(box)) continue;
            box.style.display = 'none';
            box.__fenbiHidden = true;
        }

        // 5) 按 class 词精确隐藏 来源 / 笔记 / 考点 相关块
        //    注意用"独立词"匹配，避免 resource 被 source 误命中（这是解析被吞的元凶）
        var byClass = item.querySelectorAll('[class]');
        for (var s = 0; s < byClass.length; s++) {
            var e2 = byClass[s];
            if (e2.id === TIP_ID || e2.id === BTN_ID) continue;
            if (isSolutionCore(e2)) continue;
            // 装着题干/选项的块也不许动
            if (e2.querySelector && e2.querySelector(
                    '.solution-choice-container, .choice-item, .question-stem')) continue;
            // 只认"考点/来源/笔记"的精确 class 词：
            // 裸 point 会命中 question-point / key-point 之类，把题干整块吞掉
            if (hasClassToken(e2, 'source') || hasClassToken(e2, 'note') ||
                hasClassToken(e2, 'exam-point') || hasClassToken(e2, 'knowledge-point') ||
                hasClassToken(e2, 'test-point')) {
                e2.style.display = 'none';
                e2.__fenbiHidden = true;
            }
        }

        // 5b) 隐藏来源盒子：每道解析下面那一行"2026下半年省考第二十八季行测模考大赛（上海卷）第xxx题"
        // ⚠️ 解析正文与来源行同为 section.result-common-section、内部结构一致，
        // 严禁按"文本含省考/模考大赛"整块删除：解析正文里出现这两个词的题会被连根删掉，
        // 表现为"点开解析是空白"（移除后刷新也不会恢复）。只能认来源盒子自身的标识。
        var srcBoxes = item.querySelectorAll('section.result-common-section');
        for (var si = 0; si < srcBoxes.length; si++) {
            var srcBox = srcBoxes[si];
            if (srcBox.__fenbiHidden) continue;
            if (isSolutionCore(srcBox)) continue;                  // 装着解析正文的块永不隐藏
            var isSourceBox = (srcBox.id || '').indexOf('section-source-') === 0;
            if (!isSourceBox) {
                // 无来源 id 时保守兜底：只认"短行 + 以第N题结尾"，长文本一律不碰
                var srcDiv = srcBox.querySelector('.content > app-format-html > div');
                if (!srcDiv) continue;
                var srcText = (srcDiv.textContent || '').replace(/\s+/g, '');
                if (srcText.length > 80 || !/第\s*\d+\s*题$/.test(srcText)) continue;
            }
            srcBox.style.display = 'none';
            srcBox.__fenbiHidden = true;
        }
    }

    function processItem(item) {
        // Angular 重建过这块 DOM 的话，之前挂在旧节点上的标记会失效，
        // 表现为"按钮没了 / 点了没反应"，所以发现按钮已不在树里就重做一遍
        if (item.__fenbiFoldDone && item.__fenbiResBtn &&
            !item.contains(item.__fenbiResBtn)) {
            item.__fenbiFoldDone = false;
            item.__fenbiResBtn = null;
        }
        if (item.__fenbiFoldDone) return;

        const noEl = item.querySelector('.title-index');
        if (!noEl) return;
        // 还没渲染出来时先跳过，等下一轮轮询；
        // 只要有题干区或解析区其一，就认为这一题可以绑定了
        // （尾部题目结构可能与前面不同，不能被单一选择器挡住）
        if (!item.querySelector('.solution-choice-container') &&
            !resEl(item)) return;

        item.__fenbiFoldDone = true;

        const rate = getRate(item);
        const answer = getAnswer(item);
        const n = toNum(rate);

        // 题号着色
        if (!isNaN(n) && n <= VERIFY_LOW) {
            noEl.style.color = '#e5e500';  // ≤25% → 黄色
            noEl.style.fontWeight = 'bold';
        } else if (!isNaN(n) && n < RED_LIMIT) {
            noEl.style.color = '#d93025';
            noEl.style.fontWeight = 'bold';
        }

        // 该题数据挂到题号上，供键盘切换时复用
        noEl.__fenbiRate = rate;
        noEl.__fenbiAnswer = answer;

        // 题号上的监听器只绑一次：DOM 被重建后重入时不能再叠加，
        // 否则点一下会翻两次，等于"点了没反应"
        if (!noEl.__fenbiBound) {
            noEl.__fenbiBound = true;

            // 点题号：展开/收起题干、选项、统计信息，并把这道题顶到页面最上方
            noEl.style.cursor = 'pointer';
            noEl.addEventListener('click', function () {
                BODY_MODE = null;   // 单题手动开合 → 退出全局题目模式，否则会被 3 秒轮询覆盖回去
                setBody(item, !isBodyOpen(item));
                scrollItemToTop(item);
            });

            // 悬浮题号：显示正确率与正确答案
            noEl.addEventListener('mouseenter', function () {
                // 键盘切题的滚动过程中，静止的鼠标会"掠过"题号而误触发本事件，
                // 必须忽略，否则选中项被拽回去，表现为高亮框上下跳
                if (_fenbiByKeyboard) return;
                // 键盘刚切过题（1.5s 内）同样忽略鼠标：页面滚动会让指针下方的
                // 题号不断变化并触发本事件，锚点被抢走后再按 ↓ 就会"隔一题跳"
                if (Date.now() - _kbLastKeyTime < 1500) return;
                highlightActive(noEl);
                _fenbiActiveIndex = getNavNos().indexOf(noEl);
                showTip(noEl, rate, answer);
            });
            noEl.addEventListener('mouseleave', removeTip);
        }

        // 题号右侧的「解析」开关（独立于题号点击）
        if (item.__fenbiResBtn && item.contains(item.__fenbiResBtn)) {
            // 重建后按钮还在，只同步文字状态
            item.__fenbiResBtn.textContent = isResOpen(item) ? '解析 ▾' : '解析 ▸';
            if (item.__fenbiRateSpan) {
                item.__fenbiRateSpan.textContent = '全站正确率：' + rate;
                if (!isNaN(n)) {
                    if (n <= VERIFY_LOW) item.__fenbiRateSpan.style.color = '#d8a0ff';
                    else if (n < RED_LIMIT) item.__fenbiRateSpan.style.color = '#ff8080';
                } else {
                    item.__fenbiRateSpan.style.color = '#999';
                }
            }
        } else {
            const resBtn = document.createElement('span');
            resBtn.textContent = isResOpen(item) ? '解析 ▾' : '解析 ▸';
            resBtn.style.cssText = 'margin-left:10px;font-size:12px;color:#0066cc;' +
                'cursor:pointer;user-select:none;';
            resBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                markResManual(item);   // 单题手动开合 → 只有这一题脱离全局解析模式，其他题不受影响
                setRes(item, !isResOpen(item));
            });
            noEl.insertAdjacentElement('afterend', resBtn);
            item.__fenbiResBtn = resBtn;

            // 在解析按钮前面插入全站正确率（顺序：题号 → 正确率 → 解析按钮）
            const rateSpan = document.createElement('span');
            rateSpan.className = 'fh-item-rate';
            rateSpan.textContent = '全站正确率：' + rate;
            rateSpan.style.cssText = 'margin-left:10px;font-size:12px;';
            if (!isNaN(n)) {
                if (n <= VERIFY_LOW) rateSpan.style.color = '#d8a0ff';
                else if (n < RED_LIMIT) rateSpan.style.color = '#ff8080';
            } else {
                rateSpan.style.color = '#999';
            }
            resBtn.insertAdjacentElement('beforebegin', rateSpan);
            item.__fenbiRateSpan = rateSpan;
        }

        /* ---------- 隐藏无关项：让页面紧凑 ---------- */
        hideExtras(item);
    }

    /* ---------- 键盘浏览：↑/↓ 切题，Enter / 右键 打开解析 ---------- */

    var _fenbiActiveIndex = -1;
    var _fenbiActiveNo = null;
    var _fenbiByKeyboard = false;   // 键盘切题期间的滚动抑制窗口
    var _kbHoverTimer = null;
    var _kbCorrectTimer = null;     // 兜底校正定时器（只保留最新一次）
    var _kbLastKeyTime = 0;         // 上次切题时间，用于判断是否连按

    // 高亮"当前题号"，让键盘浏览时一眼看到自己在哪道题
    function highlightActive(no) {
        if (_fenbiActiveNo && _fenbiActiveNo !== no) {
            _fenbiActiveNo.style.outline = '';
            _fenbiActiveNo.style.outlineOffset = '';
        }
        _fenbiActiveNo = no;
        if (no) {
            no.style.outline = '2px solid #0066cc';
            no.style.outlineOffset = '3px';
            no.style.borderRadius = '3px';
        }
    }

    // 题号是否真的能被看到（隐藏的套题组 / 折叠块里的题号不算）
    function isVisibleNo(no) {
        if (!no || !no.getClientRects || !no.getClientRects().length) return false;
        var cs = getComputedStyle(no);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        var r = no.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    // 参与键盘浏览的题号：按文档顺序，剔除看不见的
    function getNavNos() {
        var all = getAllNos();
        var vis = all.filter(isVisibleNo);
        return vis.length ? vis : all;   // 兜底：全被判为隐藏时不做过滤
    }

    // 鼠标最近是否真的动过。键盘操作时鼠标常静止停在某个旧题号上，
    // 若直接把":hover"当作用户意图，锚点会被那个静止题号抢走，
    // 表现就是"按了不动"或"隔一个往后跳"
    var _lastMouseMove = 0;
    document.addEventListener('mousemove', function () { _lastMouseMove = Date.now(); }, true);

    function mouseIsFresh() {
        return (Date.now() - _lastMouseMove) < 1500;
    }

    // 当前锚点题号（键盘推进的起点）：
    //   0) 键盘连续浏览期间（1.5s 内刚切过题）完全忽略鼠标：鼠标停在某道题号上
    //      不动时，若还让鼠标当锚点，键盘每前进一步都会被拽回鼠标那道题，
    //      表现就是"按不动"或来回跳
    //   1) 鼠标确实指在某题号上、且最近真的动过鼠标、且键盘已停手 → 用鼠标那道
    //   2) 脚本上次切到的题号（还在 DOM 里、仍可见、没被滚出视野太远）→ 最稳
    //   3) 用户手动滚过页面 → 取视口里最上面那道看得见的题
    function anchorNo() {
        var nos = getNavNos();
        if (!nos.length) return null;

        var kbIdle = (Date.now() - _kbLastKeyTime) > 1500;
        if (kbIdle && mouseIsFresh()) {
            for (var i = 0; i < nos.length; i++) {
                if (nos[i].matches(':hover')) return nos[i];
            }
        }

        if (_fenbiActiveNo && document.contains(_fenbiActiveNo) &&
            isVisibleNo(_fenbiActiveNo)) {
            var r = _fenbiActiveNo.getBoundingClientRect();
            var vh = window.innerHeight || document.documentElement.clientHeight;
            if (r.bottom > -vh * 0.5 && r.top < vh * 1.5) return _fenbiActiveNo;
        }

        for (var j = 0; j < nos.length; j++) {
            var rr = nos[j].getBoundingClientRect();
            if (rr.bottom > 0 && rr.top < window.innerHeight) return nos[j];
        }
        return nos[0];
    }

    // 按文档顺序取相邻题号；已经在首/尾就返回自己（停住，不回环乱跳）
    function neighborNo(cur, dir) {
        var nos = getNavNos();
        if (!nos.length || !cur) return null;

        var i = nos.indexOf(cur);
        if (i === -1) {
            // 锚点不在可视集合里（被隐藏或已被回收）：按文档位置就近取一个
            for (var k = 0; k < nos.length; k++) {
                if (cur.compareDocumentPosition(nos[k]) & Node.DOCUMENT_POSITION_FOLLOWING) {
                    return dir > 0 ? nos[k] : (k > 0 ? nos[k - 1] : nos[0]);
                }
            }
            return dir > 0 ? nos[nos.length - 1] : nos[0];
        }
        var ni = i + dir;
        if (ni < 0) return nos[0];
        if (ni >= nos.length) return nos[nos.length - 1];
        return nos[ni];
    }

    // 顶部固定栏（导航/标题条）的高度，滚动时要给它让位，否则题号会被压在栏下
    function getTopOffset() {
        var off = 0;
        var cands = document.querySelectorAll(
            'header, nav, [class*="navbar"], [class*="header"], [class*="sticky"], [class*="fixed"]');
        for (var i = 0; i < cands.length; i++) {
            var el = cands[i];
            if (el.id === TIP_ID || el.id === BTN_ID) continue;
            var cs = getComputedStyle(el);
            if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
            var r = el.getBoundingClientRect();
            if (r.height <= 0 || r.height > 200) continue;
            if (r.top > 40) continue;                  // 必须贴在页面顶端
            off = Math.max(off, r.bottom);
        }
        return off + 8;
    }

    // 找出元素外侧最近的"真正能滚动的容器"。
    // 粉笔按每 5 题一组，组内往往有独立的滚动区，
    // 只滚 window 的话那个滚轮根本不动，切题就会"不知道跑哪去了"
    function getScrollParent(el) {
        var p = el && el.parentElement;
        while (p && p !== document.body && p !== document.documentElement) {
            var oy = getComputedStyle(p).overflowY;
            if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
                p.scrollHeight - p.clientHeight > 2) {
                return p;
            }
            p = p.parentElement;
        }
        return null;
    }

    // 把某道题的整个容器顶到页面最上方（顶部固定栏以下），
    // 让这道题的题干、选项、解析尽量在一屏里完整露出。
    // instant=true 时不做平滑动画，用于兜底校正。
    function scrollItemToTop(item, instant) {
        if (!item) return;

        // 1) 先把所有内部滚动容器对齐（逐层向外，含题目所在的套题组）
        var sp = getScrollParent(item);
        var guard = 0;
        while (sp && guard++ < 10) {
            var rect = item.getBoundingClientRect();
            var spRect = sp.getBoundingClientRect();
            sp.scrollTop = Math.max(0, sp.scrollTop + (rect.top - spRect.top) - 4);
            sp = getScrollParent(sp.parentElement);
        }

        // 2) 再让整页把这道题顶到固定栏下方
        var y = item.getBoundingClientRect().top + window.pageYOffset - getTopOffset();
        window.scrollTo({ top: Math.max(0, y), behavior: instant ? 'auto' : 'smooth' });
    }

    // 切到指定题号：把该题滚到页面顶部（让整道题连同解析完整露出）
    // + 高亮题号 + 显示悬浮提示。
    // 浏览器不允许脚本移动真实鼠标指针，所以改用"滚动 + 提示跟随 + 高亮"，
    // 保证键盘切题时目标题一定出现在眼前。
    function activateNoEl(no) {
        if (!no) return;

        var nos = getNavNos();
        var i = nos.indexOf(no);
        if (i >= 0) _fenbiActiveIndex = i;

        highlightActive(no);
        showTip(no, no.__fenbiRate || '无数据', no.__fenbiAnswer || '无数据');

        // 滚动会让静止的鼠标"掠过"新题号并触发 mouseenter，把选中项拽回去。
        // 切题后短暂屏蔽鼠标悬停，等滚动落定再交还控制权。
        _fenbiByKeyboard = true;
        clearTimeout(_kbHoverTimer);
        _kbHoverTimer = setTimeout(function () { _fenbiByKeyboard = false; }, 900);

        // 题目容器整块的顶端（不是题号本身），这样题干从顶部开始完整显示
        var box = no.closest('app-ti') || no;

        // 连续按键（700ms 内）不做平滑动画：多段滚动动画互相叠加会让页面
        // 停在旧题上，表现就是"按了没反应"或"隔一题跳"
        var nowTs = Date.now();
        var rapid = (nowTs - _kbLastKeyTime) < 700;
        _kbLastKeyTime = nowTs;
        scrollItemToTop(box, rapid);

        // 兜底校正：只保留最后一次切题的定时器。旧定时器若也去滚自己的题目，
        // 会把刚跳到的题又甩回旧位置，表现为"按不动""隔一题往后跳"
        clearTimeout(_kbCorrectTimer);
        _kbCorrectTimer = setTimeout(function () {
            if (_fenbiActiveNo !== no) return;   // 期间又切题了，交给新的校正
            var r = no.getBoundingClientRect();
            if (r.top < -2 || r.bottom > window.innerHeight + 2) {
                scrollItemToTop(box, true);
                var r2 = no.getBoundingClientRect();
                if (r2.top < -2 || r2.bottom > window.innerHeight + 2) {
                    try { no.scrollIntoView({ block: 'start', behavior: 'auto' }); }
                    catch (err) { /* 忽略 */ }
                }
            }
        }, 380);
    }

    document.addEventListener('keydown', function (e) {
        var isNext = (e.key === 'ArrowDown' || e.keyCode === 40);
        var isPrev = (e.key === 'ArrowUp' || e.keyCode === 38);
        var isOpen = (e.key === 'Enter' || e.keyCode === 13 ||
                      e.key === 'ArrowRight' || e.keyCode === 39);
        if (!isNext && !isPrev && !isOpen) return;

        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
            t.tagName === 'SELECT' || t.isContentEditable)) return;

        var cur = anchorNo();
        if (!cur) return;

        // 拦住默认行为：避免 Enter 被浏览器当成"再点一次当前聚焦的按钮"，
        // 也避免 ↑/↓ 把页面自己滚走（滚动统一由脚本控制）
        e.preventDefault();
        e.stopPropagation();

        if (isNext || isPrev) {
            // 以"锚点题号"为准按文档顺序走一格：不用序号取题，
            // 就不会因题目增删 / 可见性变化而错位或跳题
            var target = neighborNo(cur, isNext ? 1 : -1);
            if (target && target !== cur) activateNoEl(target);
        } else {
            // Enter / 右键：切换当前这道题的解析（打开或关闭）
            var item = cur.closest('app-ti');
            if (item) { markResManual(item); setRes(item, !isResOpen(item)); }
        }
    }, true);

    /* ---------- 右键：在题号上点右键，直接打开该题解析 ---------- */

    document.addEventListener('contextmenu', function (e) {
        var no = e.target && e.target.closest ? e.target.closest('.title-index') : null;
        if (!no) return;
        var item = no.closest('app-ti');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        highlightActive(no);
        _fenbiActiveIndex = getNavNos().indexOf(no);
        _kbLastKeyTime = Date.now();     // 右键后键盘从这道题接着走，别被鼠标抢走
        markResManual(item);
        setRes(item, !isResOpen(item));
    }, true);

    /* ---------- 单题手动开合解析：脱离全局强制态，不被 3 秒轮询压回去 ---------- */

    // 全局「解析 已关」会由轮询把每道题压回关闭；但用户手动动过的题必须尊重用户。
    // 用户手动动过的题打上 __fenbiResManual，轮询只校准它的真实态、不再强制收合，
    // 直到用户下次点全局「解析」按钮（批量动作重新接管全部题目）。
    var _fhProgResClick = false;   // 标记"这次 .toggle-btn 点击是脚本自己触发的"

    function markResManual(item) {
        if (item) item.__fenbiResManual = true;
    }

    // 点粉笔原生的「解析」折叠按钮 / 解析标题栏，都算用户手动
    document.addEventListener('click', function (e) {
        if (_fhProgResClick) return;
        var t = e.target;
        if (!t || !t.closest) return;
        var item = t.closest('app-ti');
        if (!item) return;
        var hit = !!t.closest('.toggle-btn, [class*="toggle"]');
        if (!hit) {
            // 解析标题栏：自身文本很短且以「解析」开头
            var s = (t.textContent || '').replace(/\s+/g, '');
            hit = s.length > 0 && s.length <= 12 && s.indexOf('解析') === 0;
        }
        if (hit) markResManual(item);
    }, true);

    // 平滑滚动过程中，提示实时跟随题号位置
    window.addEventListener('scroll', placeTip, true);

    /* ---------- 卷名标题 → 点击跳 B 站搜这套模考 ---------- */

    // 在页面顶部找到含「模考」的最内层短标题，绑点击事件去 B 站搜索
    // 同时在标题右边追加一个 B站搜索引导胶囊标签
    function linkExamTitle() {
        var prev = document.__fenbiTitleEl;
        if (prev && document.body.contains(prev) && prev.__fenbiTitleLinked) return;

        var cands = document.querySelectorAll(
            'h1, h2, h3, h4, a, span, div, [class*="title"], [class*="exam"]');
        var best = null;
        for (var i = 0; i < cands.length; i++) {
            var el = cands[i];
            if (el.id === TIP_ID || el.id === BTN_ID || el.__fenbiTitleLinked) continue;
            var txt = (el.textContent || '').replace(/\s+/g, '');
            if (txt.indexOf('模考') === -1) continue;
            if (txt.length > 40) continue;                 // 太长说明是整块容器，不是标题
            var inner = el.querySelector('h1, h2, h3, h4, a, span, div');
            if (inner && (inner.textContent || '').replace(/\s+/g, '') === txt) continue; // 取最内层
            var r = el.getBoundingClientRect();
            if (!best || r.top < best.getBoundingClientRect().top) best = el;
        }
        if (!best) return;

        document.__fenbiTitleEl = best;

        /* ---- 标题右边加 B 站搜索引导胶囊标签 ---- */
        if (document.getElementById('fenbi-bilibili-tag')) return;
        var kw = (best.textContent || '').replace(/\s+/g, ' ').trim();
        var tag = document.createElement('span');
        tag.id = 'fenbi-bilibili-tag';
        tag.textContent = '点我去B站搜这套';
        tag.style.cssText =
            'display:inline-block;border-radius:16px;background:#f0f6ff;color:#0066cc;font-size:12px;' +
            'padding:3px 10px;border:1px solid #c9e0ff;cursor:pointer;margin-left:8px;user-select:none;' +
            'vertical-align:middle;';
        tag.title = '点击到 B 站搜索这套模考';
        tag.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            window.open('https://search.bilibili.com/all?keyword=' +
                encodeURIComponent(kw), '_blank');
        });
        best.appendChild(tag);
    }

    /* ---------- 每 5 题一大题：把题组内部空间放大到一屏，少滚滚轮 ---------- */

    var GROUP_ROOM_ON = false;  // 一屏高方案已停用（改用材料折叠）；需要时改回 true

    function isScrollBox(el) {
        var oy = getComputedStyle(el).overflowY;
        if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
        return el.scrollHeight - el.clientHeight > 2;
    }

    function nearestCommonAncestor(a, b) {
        var chain = [];
        var p = a.parentElement;
        while (p) { chain.push(p); p = p.parentElement; }
        var q = b.parentElement;
        while (q) {
            if (chain.indexOf(q) >= 0) return q;
            q = q.parentElement;
        }
        return null;
    }

    function commonAncestorOfAll(items) {
        var anc = items[0];
        for (var i = 1; i < items.length && anc; i++) {
            if (anc === items[i] || anc.contains(items[i])) continue;  // 已收敛就别再往上找
            anc = nearestCommonAncestor(anc, items[i]);
        }
        return anc;
    }

    // 每 5 题一组的容器：取相邻两题的最近公共祖先，去掉"包住整份卷子"的那层
    function groupBoxes(items) {
        if (items.length < 2) return [];
        var whole = commonAncestorOfAll(items);
        var out = [];
        for (var i = 0; i + 1 < items.length; i++) {
            var anc = nearestCommonAncestor(items[i], items[i + 1]);
            if (!anc || anc === whole) continue;
            if (anc === document.body || anc === document.documentElement) continue;
            if (anc.querySelectorAll('app-ti').length > 12) continue;  // 太宽，不是一组
            if (out.indexOf(anc) === -1) out.push(anc);
        }
        return out;
    }

    // 题组里"自己带滚动条"的最内层容器：粉笔每组内部各有一个滚动区，
    // 高度被压得很矮，解析一展开就得反复滑滚轮
    function groupScrollBoxes(items) {
        var cands = [];
        for (var i = 0; i < items.length; i++) {
            var p = items[i].parentElement;
            while (p && p !== document.body && p !== document.documentElement) {
                var cnt = p.querySelectorAll('app-ti').length;
                if (cnt >= 2 && cnt <= 12 && isScrollBox(p) && cands.indexOf(p) === -1) {
                    cands.push(p);
                }
                p = p.parentElement;
            }
        }
        // 只留最内层，避免把外层大容器也撑成一屏、套出两个滚动条
        return cands.filter(function (c) {
            return !cands.some(function (o) { return o !== c && c.contains(o); });
        });
    }

    // 抬下限 + 解上限：不再被粉笔压成矮窗口，展开解析后能占满一屏
    function loosenHeight(el, h) {
        if (el.__fenbiRoomH === h) return;
        el.__fenbiRoomH = h;
        el.style.setProperty('min-height', h + 'px', 'important');
        el.style.setProperty('max-height', 'none', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
    }

    function enlargeGroups() {
        if (!GROUP_ROOM_ON) return;
        var items = getItems();
        if (items.length < 2) return;

        var off = getTopOffset();
        var vh = window.innerHeight || document.documentElement.clientHeight;
        // 顶栏高度让出来，剩下的整块给一组题，基本就是"一屏一组"
        var room = Math.max(360, Math.round(vh - off - 16));

        groupScrollBoxes(items).forEach(function (box) { loosenHeight(box, room); });

        groupBoxes(items).forEach(function (box) { loosenHeight(box, room); });
    }

    /* ---------- 大题材料折叠：以页面自带的「材料」标签为开关 ---------- */

    var MATERIAL_FOLD_ON = false;  // 材料区已整体移除（见下方「材料分栏展平」模块），折叠不再需要；要恢复材料功能时改回 true
    var MAT_MIN_LEN = 20;          // 材料正文最小字数，低于此值不当材料看
    var MAT_IMG_MIN = 60;          // 材料图的最小边长(px)，防把图标当材料

    function inItem(el) {
        return !!(el.closest && el.closest('app-ti'));
    }

    function plainLen(el) {
        return (el.textContent || '').replace(/\s+/g, '').length;
    }

    // 材料里的大图（图片材料没有文字，不能只看字数）
    function hasBigMedia(el) {
        var media = [];
        if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'CANVAS') media.push(el);
        if (el.querySelectorAll) {
            var inner = el.querySelectorAll('img, video, canvas, svg');
            for (var i = 0; i < inner.length; i++) media.push(inner[i]);
        }
        for (var j = 0; j < media.length; j++) {
            var m = media[j];
            var w = m.naturalWidth || m.width || m.clientWidth || 0;
            var h = m.naturalHeight || m.height || m.clientHeight || 0;
            if (Math.max(w, h) >= MAT_IMG_MIN) return true;
        }
        // 背景图也算（取有尺寸的）
        var bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none' && bg.indexOf('url(') >= 0) {
            var bw = el.clientWidth || el.offsetWidth || 0;
            if (bw >= MAT_IMG_MIN) return true;
        }
        return false;
    }

    // 材料块：文字够多，或者里面有一张像样的图
    function isMaterialLike(el) {
        if (plainLen(el) >= MAT_MIN_LEN) return true;
        return hasBigMedia(el);
    }

    // 文档序判断：b 相对 a 的位置
    function afterDoc(a, b) { return !!(a.compareDocumentPosition(b) & 2); }   // a 在 b 之后
    function beforeDoc(a, b) { return !!(a.compareDocumentPosition(b) & 4); }  // a 在 b 之前

    function ensureMatStyle() {
        if (document.getElementById('fenbi-mat-style')) return;
        var st = document.createElement('style');
        st.id = 'fenbi-mat-style';
        st.textContent =
            '.fenbi-mat-anchor::after{content:" ▸";color:#2b6cd4;}' +
            '.fenbi-mat-open::after{content:" ▾";}';
        (document.head || document.documentElement).appendChild(st);
    }

    // 材料开关 = 页面自带 <a class="label-tab">材料</a>
    function findMaterialAnchors() {
        var out = [];
        var cands = document.querySelectorAll('.label-tab');
        var i, t;
        for (i = 0; i < cands.length; i++) {
            var el = cands[i];
            if (inItem(el)) continue;
            if (el.__fenbiMatAnchor) { out.push(el); continue; }
            t = (el.textContent || '').replace(/\s+/g, '');
            if (t.length <= 6 && t.indexOf('材料') === 0) out.push(el);
        }
        if (out.length) return out;
        // 兜底：没有 label-tab 时，找只有「材料」二字的短标签
        var all = document.querySelectorAll('a, span, h3, h4, p');
        for (i = 0; i < all.length; i++) {
            var e2 = all[i];
            if (inItem(e2) || e2.children.length) continue;
            t = (e2.textContent || '').replace(/\s+/g, '');
            if (/^材料[一二三四五六七八九十]?$/.test(t)) out.push(e2);
        }
        return out;
    }

    // 开关之后最近的一道题（材料正文的右边界）
    function nextItemAfter(anchor) {
        var items = getItems(), best = null;
        for (var i = 0; i < items.length; i++) {
            if (!afterDoc(items[i], anchor)) continue;
            if (!best || beforeDoc(items[i], best)) best = items[i];
        }
        return best;
    }

    // 材料正文范围：本开关之后 → 下一道题（或下一个「材料」开关）之前
    function materialBound(anchor, anchors) {
        var best = nextItemAfter(anchor);
        for (var i = 0; i < anchors.length; i++) {
            var o = anchors[i];
            if (o === anchor || !afterDoc(o, anchor)) continue;
            if (!best || beforeDoc(o, best)) best = o;
        }
        return best;
    }

    function materialContentOf(anchor, anchors) {
        var bound = materialBound(anchor, anchors);
        var all = document.querySelectorAll('*');
        var out = [];
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el === anchor || el.contains(anchor)) continue;   // 不能把开关自己折进去
            if (inItem(el) || el.querySelector('app-ti')) continue;
            if (!isMaterialLike(el)) continue;
            if (!afterDoc(el, anchor)) continue;
            if (bound && !beforeDoc(el, bound)) continue;
            var covered = false;
            for (var m = 0; m < out.length; m++) {
                if (out[m].contains(el)) { covered = true; break; }
            }
            if (covered) continue;
            out = out.filter(function (x) { return !el.contains(x); });
            out.push(el);
        }
        return out;
    }

    function bindMaterialAnchor(anchor, blocks) {
        ensureMatStyle();
        anchor.__fenbiMatAnchor = true;
        anchor.classList.add('fenbi-mat-anchor');

        if (!anchor.__fenbiMatOn) {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                var st = anchor.__fenbiMatState;
                if (!st) return;
                st.open = !st.open;
                st.render();
            }, true);                                    // 捕获阶段，先于页面自身逻辑
            anchor.__fenbiMatOn = true;
        }

        var state = { open: false, blocks: blocks };
        state.render = function () {
            blocks.forEach(function (b) {
                if (state.open) b.style.removeProperty('display');
                else b.style.setProperty('display', 'none', 'important');
            });
            anchor.classList.toggle('fenbi-mat-open', !!state.open);
            if (state.open) homeSplitLeft();   // 材料展开后左栏要恢复宽度
        };
        anchor.__fenbiMatState = state;
        anchor.__fenbiMatBound = blocks;
        state.render();
    }

    function foldMaterials() {
        if (!MATERIAL_FOLD_ON) return;
        if (!getItems().length) return;
        var anchors = findMaterialAnchors();
        if (!anchors.length) return;
        anchors.forEach(function (a) {
            var bound = a.__fenbiMatBound;
            if (bound && bound.length &&
                bound.every(function (b) { return b.isConnected; })) {
                return;                                  // 已绑好，保持用户当前开合状态
            }
            var blocks = materialContentOf(a, anchors);
            if (!blocks.length) return;
            bindMaterialAnchor(a, blocks);
        });
    }

    /* ---------- 材料分栏展平：把每 5 题一组的分栏题组拆成一道道独立单题 ---------- */

    // 材料区整体移除，组内题目与前面的普通题完全一致：全宽、无分栏、无拖拽分隔条。
    // 只改样式 / 加类名，不动原 DOM 结构；要恢复材料与分栏时把 FLATTEN_ON 改回 false
    var FLATTEN_ON = true;
    var FLAT_GAP = 48;             // 展平后组内相邻题的间距，对齐普通题的 48px

    function ensureFlatStyle() {
        if (document.getElementById('fenbi-flat-style')) return;
        var st = document.createElement('style');
        st.id = 'fenbi-flat-style';
        st.textContent =
            // 分栏容器：取消 flex 与固定高度（原 70vh），否则内容撑不出容器、各组会互相压叠
            '.fenbi-flat{display:block !important;height:auto !important;min-height:0 !important;' +
            'max-height:none !important;overflow:visible !important;}' +
            // 左栏（材料区）与拖拽手柄：整体不要了
            '.fenbi-flat > .nz-resizable.left,.fenbi-flat .nz-resizable-handle{display:none !important;}' +
            // 右栏（题目区）：吃满整宽，去掉原来的 4px 左边距与滚动限制
            '.fenbi-flat > .right{width:100% !important;max-width:none !important;margin-left:0 !important;' +
            'height:auto !important;max-height:none !important;overflow:visible !important;}' +
            '.fenbi-flat .right-section{width:100% !important;max-width:none !important;}' +
            // 组内题目：全宽 + 补上普通题才有的题间距
            '.fenbi-flat app-ti.question-multiple{width:100% !important;max-width:none !important;' +
            'margin-bottom:' + FLAT_GAP + 'px !important;}' +
            '.fenbi-flat app-ti.question-multiple:last-of-type{margin-bottom:0 !important;}' +
            // 题组自带的「组内题号导航条」（106题 107题…）：材料题组专属，展平后不要了，普通题没有这个
            '.fenbi-flat .questions-anchors{display:none !important;}' +
            // 组内首题上方补 12px，使「上一题 → 本组首题」的间距与普通题的 48px 对齐
            '.fenbi-flat .questions-container{padding-top:12px !important;}' +
            // 上层包裹：app-resizable 原为 inline（不认 width），必须块化
            '.fenbi-flat-up{display:block !important;width:100% !important;max-width:none !important;}';
        (document.head || document.documentElement).appendChild(st);
    }

    function flattenGroups() {
        if (!FLATTEN_ON) return;
        var boxes = document.querySelectorAll('div.resizable-container');
        if (!boxes.length) return;
        ensureFlatStyle();
        for (var i = 0; i < boxes.length; i++) {
            var box = boxes[i];
            box.classList.add('fenbi-flat');
            // 往上两层：app-resizable（原 inline）与 div.ti 也要放开宽度
            var p1 = box.parentElement;
            if (p1 && (p1.tagName || '').toUpperCase() === 'APP-RESIZABLE') {
                p1.classList.add('fenbi-flat-up');
                var p2 = p1.parentElement;
                if (p2 && (p2.tagName || '').toUpperCase() === 'DIV') p2.classList.add('fenbi-flat-up');
            }
            // 旧的分隔条逻辑可能给左栏压过宽度，清掉，免得残留
            var left = box.querySelector('.nz-resizable.left');
            if (left) {
                left.style.removeProperty('width');
                left.style.removeProperty('display');
            }
        }
    }

    /* ---------- 显示模块：可自由勾选「隐藏哪部分」 ----------
       设计要点：每个模块的显隐只由 body 上的一个 class 决定，
       勾选动作是幂等的、可任意组合，不存在模式互斥，也不依赖任何状态机。
       勾选结果写 localStorage，刷新后保留。 */

    var HIDE_STYLE_ID = 'fh-hide-style';
    var HIDE_STORE_KEY = 'fh_hide_opts_v1';
    var HIDE_ITEMS = [
        { key: 'answer', cls: 'fh-hide-answer', mark: 'fh-m-answer', label: '正确答案' },
        { key: 'yours',  cls: 'fh-hide-yours',  mark: 'fh-m-yours',  label: '你的答案' },
        { key: 'rate',   cls: 'fh-hide-rate',   mark: 'fh-m-rate',   label: '全站正确率' },
        { key: 'prone',  cls: 'fh-hide-prone',  mark: 'fh-m-prone',  label: '易错项' },
        { key: 'color',  cls: 'fh-hide-color',  mark: '',            label: '选项对错颜色' },
        { key: 'time',   cls: 'fh-hide-time',   mark: 'fh-m-time',   label: '答题用时' }
    ];

    // 按钮带状态文字：展开 → "展开 [开]" / 收起 → "收起 [关]"，背景色提示
    var BTN_OPEN_STY = 'background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7';
    var BTN_CLOSE_STY = 'background:#fbe9e7;color:#c62828;border-color:#ef9a9a';

    // 答题用时盒子：答案收起时一并隐藏
    function getTimeBox(item) {
        var boxes = item.querySelectorAll('.overall-item');
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].textContent.indexOf('答题用时') !== -1) return boxes[i];
        }
        return null;
    }

    function markTimeBox(item) {
        var box = getTimeBox(item);
        if (box) { box.classList.add('fh-m-time'); box.__fenbiTimeBox = true; }
    }

    function setHideTime(item, hide) {
        var box = getTimeBox(item);
        if (box) box.style.display = hide ? 'none' : '';
    }

    // 用时盒子的期望态：全局答案关 或 单独存了 time=true 时隐藏；轮询里重贴，抵消 Angular 重渲染
    function syncTimeState(item) {
        var hide = (HIDE_MODE === 'close') || (loadHideOpts()['time'] === true);
        setHideTime(item, hide);
    }

    function loadHideOpts() {
        try {
            var raw = localStorage.getItem(HIDE_STORE_KEY);
            if (!raw) return {};
            var o = JSON.parse(raw);
            return (o && typeof o === 'object') ? o : {};
        } catch (e) { return {}; }
    }
    function saveHideOpts(o) {
        try { localStorage.setItem(HIDE_STORE_KEY, JSON.stringify(o)); } catch (e) { /* 忽略 */ }
    }

    // 一次性注入样式：所有隐藏规则都由 body class 前缀控制
    function ensureHideStyle() {
        if (document.getElementById(HIDE_STYLE_ID)) return;
        var css = [];
        HIDE_ITEMS.forEach(function (it) {
            if (it.mark) css.push('body.' + it.cls + ' .' + it.mark + '{display:none !important;}');
        });
        // 「你的答案」在个别题型里是独立于统计盒的红字元素，除了盒级标记再补一条元素级规则
        css.push('body.fh-hide-yours .your-answer{display:none !important;}');
        // 选项对错颜色压平：真实高亮只作用于 div.input-radio，状态 class 为 .correct / .wrong / .correctLost
        css.push(
            'body.fh-hide-color .solution-choice-container .input-radio,',
            'body.fh-hide-color .solution-choice-container .input-radio.correct,',
            'body.fh-hide-color .solution-choice-container .input-radio.wrong,',
            'body.fh-hide-color .solution-choice-container .input-radio.correctLost,',
            'body.fh-hide-color .solution-choice-container .choice-radio-label input[type="radio"]:checked + .input-radio,',
            'body.fh-hide-color .solution-choice-container .choice-radio-label input[type="radio"]:checked + .input-radio.correct,',
            'body.fh-hide-color .solution-choice-container .choice-radio-label input[type="radio"]:checked + .input-radio.wrong,',
            'body.fh-hide-color .solution-choice-container .choice-radio-label input[type="radio"]:checked + .input-radio.correctLost{',
            '  background-color:#fff !important;border-color:#e9eef7 !important;color:#868ea8 !important;',
            '}'
        );
        var st = document.createElement('style');
        st.id = HIDE_STYLE_ID;
        st.textContent = css.join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // 应用（或取消）某个隐藏模块；只改 class，可反复调用
    function setHide(key, on) {
        var it = null;
        for (var i = 0; i < HIDE_ITEMS.length; i++) if (HIDE_ITEMS[i].key === key) it = HIDE_ITEMS[i];
        if (!it) return;
        ensureHideStyle();
        document.body.classList.toggle(it.cls, !!on);
        var opts = loadHideOpts();
        opts[key] = !!on;
        saveHideOpts(opts);
        // 答题用时：只在 'time' key 上生效，不依赖 body class
        if (key === 'time') {
            getItems().forEach(function (item) { setHideTime(item, !!on); });
        }
    }

    // 给统计盒的每个小项打标记（只打标记，显隐交给 CSS，避免和 setBody 抢 inline style）
    // 结构：.overall-item > .overall-item-title + .overall-item-value
    // 易错项没有固定 class，用标题文本兜底
    function markOverallItems(item) {
        var boxes = item.querySelectorAll('.overall-item');
        for (var i = 0; i < boxes.length; i++) {
            var box = boxes[i];
            var titleEl = box.querySelector('.overall-item-title');
            var title = titleEl ? (titleEl.textContent || '').replace(/\s+/g, '') : '';
            // 值元素选择器与 getRate/getAnswer 保持一致（已在页面上验证过），标题文本兜底
            var isAnswer = !!box.querySelector('.correct-answer') || title.indexOf('正确答案') === 0;
            var isYours  = !!box.querySelector('.your-answer')    || title.indexOf('你的答案') === 0;
            var isRate   = !!box.querySelector('.correct-rate')   || title.indexOf('全站正确率') === 0;
            var isProne  = !!box.querySelector('.error-prone')    || title.indexOf('易错项') === 0;
            box.classList.toggle('fh-m-answer', !!isAnswer);
            box.classList.toggle('fh-m-yours',  !!isYours);
            box.classList.toggle('fh-m-rate',   !!isRate);
            box.classList.toggle('fh-m-prone',  !!isProne);
        }
    }

    /* ---------- 解析开合：单一期望值 + 全量应用（真正能开能关） ---------- */

    // 解析期望态由顶部 RES_MODE 统一表达：'open' / 'close' / null（不干预，每题各按自己的开关）
    function applyResMode(mode) {
        RES_MODE = (mode === 'open') ? 'open' : 'close';
        getItems().forEach(function (item) {
            item.__fenbiResManual = false;   // 全局批量动作重新接管，覆盖单题手动例外
            processItem(item);
            setRes(item, RES_MODE === 'open');
        });
    }

    /* ---------- 题目开合：题干 + 选项 + 统计信息 ---------- */

    // 'open' = 展开所有题的题干/选项；'close' = 收起，只留题号
    function applyBodyMode(mode) {
        BODY_MODE = (mode === 'open') ? 'open' : 'close';
        getItems().forEach(function (item) {
            processItem(item);
            setBody(item, BODY_MODE === 'open');
        });
    }

    // SPA 重渲染后按当前题目期望态重新贴一次
    function syncBodyState(item) {
        if (BODY_MODE === null) return;
        setBody(item, BODY_MODE === 'open');
    }

    /* ---------- 答案信息开合：五个模块合并为一组开关 ---------- */

    // 'open' = 显示正确答案/你的答案/全站正确率/易错项/选项对错颜色
    // 'close' = 全部隐藏（即原先"仅显示题目"里的隐藏部分）
    function applyHideMode(mode) {
        HIDE_MODE = (mode === 'open') ? 'open' : 'close';
        var hide = (mode !== 'open');
        ['answer', 'yours', 'rate', 'prone', 'color'].forEach(function (k) {
            setHide(k, hide);
        });
    }

    // SPA 重渲染后 DOM 上的显示状态会被还原成默认值，
    // 按"当前期望"重新贴一次，否则表现为"点了没反应 / 自己又弹回来"
    function syncResState(item) {
        // 用户手动动过这一题：不强制收合，只把真实态记回来（供按钮文字与键盘判断用）
        if (item.__fenbiResManual) {
            item.__fenbiResOpen = readRealResOpen(item);
            if (item.__fenbiResBtn) {
                item.__fenbiResBtn.textContent = item.__fenbiResOpen ? '解析 ▾' : '解析 ▸';
            }
            return;
        }
        if (RES_MODE === 'open') { setRes(item, true); return; }
        if (RES_MODE === 'close') { setRes(item, false); return; }
        if (typeof item.__fenbiResOpen !== 'boolean') return;
        var els = resEls(item);
        if (!els.length) return;
        for (var i = 0; i < els.length; i++) {
            els[i].style.display = item.__fenbiResOpen ? '' : 'none';
        }
        // 折叠容器的高度也要跟着贴回来：Angular 重建 DOM 后内联 height:0 会重新出现
        paintResBox(item, item.__fenbiResOpen);
        if (item.__fenbiResBtn) {
            item.__fenbiResBtn.textContent = item.__fenbiResOpen ? '解析 ▾' : '解析 ▸';
        }
    }

    /* ---------- 错题过滤：只保留做错的题 ---------- */

    // 期望态：'open' = 只看错题（隐藏做对的题）；'close' = 全部显示（默认）
    var WRONG_MODE = 'close';

    // 错题判定（v2.15.1 修正）
    // 真页面事实：粉笔对「未作答」的题根本不渲染「你的答案」盒子（整体只有 4 个 overall-item），
    // 旧版把这种情况与"统计信息还没懒加载出来"混为一谈，一律当未就绪保留可见，
    // 导致整卷未作答的题全部留在页面上，看起来像"错题开关没生效"。
    // 返回：true = 做错；false = 做对或未作答（非错题）；null = 统计区未就绪，暂不判定
    function isWrong(item) {
        // 判据优先级：先看统计区是否就绪 —— 每题都带 .correct-answer，没有它才说明这块还没渲染
        var right = readOverall(item, '正确答案', '.correct-answer');
        if (!right) return null;
        var yours = readOverall(item, '你的答案', '.your-answer');
        if (!yours || yours === '未作答') return false;   // 统计已就绪但没有作答记录 = 未作答
        var a = yours.replace(/\s+/g, '').toUpperCase();
        var b = right.replace(/\s+/g, '').toUpperCase();
        return a !== b;
    }

    // 整题的显示/隐藏（作用于 app-ti 本体，与题目内部元素显隐互不干扰）
    function setWrong(item, show) {
        if (!item) return;
        item.style.display = show ? '' : 'none';
    }

    // 全局应用错题过滤：先让懒渲染的统计信息就位，再逐题判定
    // 开启后只保留「明确做错」的题：做对的、未作答的一律隐藏；统计区尚未渲染的题先保持可见，
    // 等 3 秒轮询补齐后再判，避免把"还没加载出来"错杀成"没做对"
    function applyWrongMode(mode) {
        WRONG_MODE = (mode === 'open') ? 'open' : 'close';
        getItems().forEach(function (item) {
            processItem(item);
            setWrong(item, WRONG_MODE === 'close' || isWrong(item) !== false);
        });
        updateAllBtns();
    }

    // SPA 重渲染 / 新题加载后按当前期望态重新贴一次
    function syncWrongState(item) {
        if (WRONG_MODE !== 'open') { setWrong(item, true); return; }
        setWrong(item, isWrong(item) !== false);
    }

    // 重置 = 四组全部回到"展开/不过滤"：题干/选项可见、答案信息可见、解析全展开、错题过滤关闭
    function resetAll() {
        HIDE_ITEMS.forEach(function (it) { document.body.classList.remove(it.cls); });
        saveHideOpts({});
        applyResMode('open');
        applyBodyMode('open');
        applyHideMode('open');
        applyWrongMode('close');
        getItems().forEach(function (item) { setHideTime(item, false); });
        updateAllBtns();
    }

    /* ---------- 常驻展示面板 ---------- */
    // 全局引用，供 updateAllBtns 使用
    var _fhRowRes = null, _fhRowBody = null, _fhRowHide = null, _fhRowWrong = null, _fhRateRow = null;
    var _fhRateVisible = true;   // 正确率开关当前是否开启（控制题号右侧全站正确率文本显隐）

    /* ---------- 面板拖拽位置记忆（localStorage） ---------- */

    function loadPanelPos() {
        try {
            var raw = localStorage.getItem(PANEL_POS_KEY);
            if (!raw) return null;
            var p = JSON.parse(raw);
            if (p && typeof p.left === 'number' && typeof p.top === 'number') return p;
        } catch (e) { /* 忽略 */ }
        return null;
    }

    function savePanelPos(left, top) {
        try { localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left: left, top: top })); }
        catch (e) { /* 忽略 */ }
    }

    // 页面加载时把面板恢复到上次拖动的位置（无记录则保持默认右上角）
    function applyPanelPos(group) {
        var p = loadPanelPos();
        if (!p) return;
        group.style.right = 'auto';
        group.style.left = p.left + 'px';
        group.style.top = p.top + 'px';
    }

    // 按住「拖动面板」按钮移动整个面板（鼠标 + 触屏共用同一套拖动逻辑），松手后写入 localStorage
    function bindPanelDrag(dragBtn, group) {
        var dragState = null;

        // 按下：记录起点（鼠标或触摸点都换算成 clientX/clientY）
        function startDrag(clientX, clientY) {
            dragState = {
                startX: clientX,
                startY: clientY,
                origLeft: group.getBoundingClientRect().left,
                origTop: group.getBoundingClientRect().top,
                moved: false
            };
        }

        function moveDrag(clientX, clientY) {
            if (!dragState) return;
            var nx = Math.max(0, dragState.origLeft + (clientX - dragState.startX));
            var ny = Math.max(0, dragState.origTop + (clientY - dragState.startY));
            nx = Math.min(nx, window.innerWidth - 60);
            ny = Math.min(ny, window.innerHeight - 30);
            group.style.right = 'auto';
            group.style.left = nx + 'px';
            group.style.top = ny + 'px';
            dragState.moved = true;
        }

        // 松手：确实拖过才记忆位置
        function endDrag() {
            if (dragState && dragState.moved) {
                savePanelPos(parseFloat(group.style.left), parseFloat(group.style.top));
            }
            dragState = null;
        }

        // ---- 桌面鼠标拖动 ----
        dragBtn.addEventListener('mousedown', function (e) {
            e.preventDefault();
            startDrag(e.clientX, e.clientY);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
        function onMouseMove(ev) {
            ev.preventDefault();
            moveDrag(ev.clientX, ev.clientY);
        }
        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            endDrag();
        }

        // ---- 触屏拖动（平板 Via 浏览器等）----
        // 触摸点坐标在 ev.touches[0].clientX/clientY；touchend 时手指已离开，无需取坐标。
        // touchmove 必须 preventDefault 阻止页面滚动，否则拖不动面板还会整页滚动；
        // passive:false 是 preventDefault 生效的前提（现代浏览器 touchmove 默认 passive）。
        dragBtn.addEventListener('touchstart', function (e) {
            if (!e.touches || !e.touches.length) return;
            e.preventDefault();
            startDrag(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });

        dragBtn.addEventListener('touchmove', function (e) {
            if (!e.touches || !e.touches.length) return;
            e.preventDefault();
            moveDrag(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });

        dragBtn.addEventListener('touchend', function (e) {
            e.preventDefault();
            endDrag();
        }, { passive: false });

        dragBtn.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    function createToggleBtn() {
        if (document.getElementById('fh-btn-group')) return;

        var group = document.createElement('div');
        group.id = 'fh-btn-group';
        group.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;' +
            'display:flex;flex-direction:column;gap:3px;align-items:flex-end;' +
            'font-family:-apple-system,"PingFang SC",Arial,sans-serif;';

        var btnStyle = 'border-radius:16px;font-size:11px;' +
            'padding:4px 10px;border:1px solid #c9e0ff;cursor:pointer;user-select:none;' +
            'box-shadow:0 1px 3px rgba(0,0,0,0.08);line-height:1.5;white-space:nowrap;';

        // 一行 = 标签 + 单个来回切换按钮；点一次切一次，切完立刻按真实态重画
        function makeRow(label, getOn, setOn) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:6px;align-items:center;';
            var lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'flex:0 0 auto;color:#666;font-size:12px;';
            row.appendChild(lbl);

            var btn = document.createElement('button');
            btn.style.cssText = btnStyle + 'background:#f0f6ff;color:#0066cc;border:1px solid #c9e0ff;';
            btn.addEventListener('click', function () {
                setOn(!getOn());
                btn.blur();
                updateAllBtns();
            });

            row.appendChild(btn);
            return { row: row, btn: btn, label: lbl };
        }

        // 题目
        _fhRowBody = makeRow('题目',
            function () { return BODY_MODE !== 'close'; },
            function (v) { if (v) applyBodyMode('open'); else applyBodyMode('close'); });

        // 答案
        _fhRowHide = makeRow('答案',
            function () { return HIDE_MODE !== 'close'; },
            function (v) { if (v) { applyHideMode('open'); setHide('time', false); } else { applyHideMode('close'); setHide('time', true); } });

        // 解析
        _fhRowRes = makeRow('解析',
            function () { return RES_MODE !== 'close'; },
            function (v) { if (v) applyResMode('open'); else applyResMode('close'); });

        // 错题（开启后只保留做错的题，隐藏做对的题；默认关闭）
        _fhRowWrong = makeRow('仅错题',
            function () { return WRONG_MODE === 'open'; },
            function (v) { applyWrongMode(v ? 'open' : 'close'); });

        // 正确率（控制所有题号右侧的全站正确率文本显隐；默认开启）
        _fhRateRow = makeRow('正确率',
            function () { return _fhRateVisible; },
            function (v) {
                _fhRateVisible = v;
                getItems().forEach(function (item) {
                    var span = item.__fenbiRateSpan;
                    if (span) span.style.display = v ? '' : 'none';
                });
            });

        // 折叠按钮：点击切换五个功能项的展开/收起
        var foldBtn = document.createElement('button');
        foldBtn.textContent = '展开';
        foldBtn.title = '展开/收起功能按钮';
        foldBtn.style.cssText = 'border-radius:16px;font-size:11px;' +
            'padding:4px 10px;border:1px solid #c9e0ff;background:#f0f6ff;color:#0066cc;cursor:pointer;user-select:none;';
        var foldState = false;
        foldBtn.addEventListener('click', function () {
            foldState = !foldState;
            foldBtn.textContent = foldState ? '收起' : '展开';
            _fhRowBody.row.style.display = foldState ? '' : 'none';
            _fhRowHide.row.style.display = foldState ? '' : 'none';
            _fhRowRes.row.style.display = foldState ? '' : 'none';
            _fhRowWrong.row.style.display = foldState ? '' : 'none';
            _fhRateRow.row.style.display = foldState ? '' : 'none';
        });

        // 折叠：所有功能项默认隐藏
        _fhRowBody.row.style.display = 'none';
        _fhRowHide.row.style.display = 'none';
        _fhRowRes.row.style.display = 'none';
        _fhRowWrong.row.style.display = 'none';
        _fhRateRow.row.style.display = 'none';

        // 挂载顺序即面板从上到下的显示顺序：展开按钮 → 题目 → 答案 → 解析 → 仅错题 → 正确率 → 重置 → 拖动面板
        group.appendChild(foldBtn);
        group.appendChild(_fhRowBody.row);
        group.appendChild(_fhRowHide.row);
        group.appendChild(_fhRowRes.row);
        group.appendChild(_fhRowWrong.row);
        group.appendChild(_fhRateRow.row);

        // 底部重置按钮和拖动面板按钮紧挨着
        var br = document.createElement('button');
        br.textContent = '重置';
        br.style.cssText = 'border-radius:16px;font-size:11px;' +
            'padding:4px 10px;border:1px solid #ddd;background:#f7f7f7;' +
            'color:#555;cursor:pointer;user-select:none;';
        br.addEventListener('click', function () { resetAll(); });
        group.appendChild(br);

        var dragBtn = document.createElement('button');
        dragBtn.textContent = '拖动面板';
        dragBtn.title = '按住可拖动面板，松手后记忆位置，刷新后保持';
        dragBtn.style.cssText = 'border-radius:16px;font-size:11px;' +
            'padding:4px 10px;border:1px dashed #bbb;background:#fafafa;' +
            'color:#666;cursor:move;user-select:none;touch-action:none;';
        bindPanelDrag(dragBtn, group);
        group.appendChild(dragBtn);

        group.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;' +
            'display:flex;flex-direction:column;gap:3px;align-items:flex-end;' +
            'font-family:-apple-system,"PingFang SC",Arial,sans-serif;';

        // 刷新后恢复上次拖拽位置（无记录则保持默认右上角）
        applyPanelPos(group);

        document.body.appendChild(group);

        // 按上次的勾选恢复
        var opts = loadHideOpts();
        HIDE_ITEMS.forEach(function (it) {
            document.body.classList.toggle(it.cls, !!opts[it.key]);
        });
        if (opts['time']) { getItems().forEach(function (item) { setHideTime(item, true); }); }

        // 更新按钮文字
        updateAllBtns();
        updateResRateSpan();
    }

    // 单个按钮按真实状态重画：文字（已开/已关）+ 配色
    function paintRow(row, on) {
        if (!row || !row.btn) return;
        row.btn.style.setProperty('background', on ? '#0066cc' : '#f0f6ff');
        row.btn.style.setProperty('color', on ? '#fff' : '#0066cc');
        row.btn.style.setProperty('border-color', on ? '#0066cc' : '#c9e0ff');
        row.btn.textContent = on ? '已开' : '已关';
    }

    // 解析行「全站正确率」常驻文本更新：优先显示当前高亮题正确率，没有则显示最后一题
    function updateResRateSpan() {
        var span = document.getElementById('fh-res-rate');
        if (!span) return;
        var rate = '—';
        if (_fenbiActiveNo && _fenbiActiveNo.__fenbiRate) {
            rate = _fenbiActiveNo.__fenbiRate;
        } else {
            var items = getItems();
            if (items.length) {
                var last = items[items.length - 1];
                var noEl = last.querySelector('.title-index');
                if (noEl && noEl.__fenbiRate) rate = noEl.__fenbiRate;
            }
        }
        span.textContent = '全站正确率：' + rate;
    }

    // 按当前真实状态刷新四个按钮（点完立即调，轮询里也调，保证文字实时跟随）
    function updateAllBtns() {
        if (!_fhRowRes || !_fhRowBody || !_fhRowHide || !_fhRowWrong || !_fhRateRow) return;
        paintRow(_fhRowRes,  RES_MODE  !== 'close');
        paintRow(_fhRowBody, BODY_MODE !== 'close');
        paintRow(_fhRowHide, HIDE_MODE !== 'close' && loadHideOpts()['time'] !== true);
        paintRow(_fhRowWrong, WRONG_MODE === 'open');
        paintRow(_fhRateRow, _fhRateVisible);
    }

    /* ---------- 初始化（SPA 轮询兜底） ---------- */

    function init() {
        createToggleBtn();
        linkExamTitle();
        getItems().forEach(function (item) {
            processItem(item);
            syncResState(item);
            syncBodyState(item);
            syncTimeState(item);
            markOverallItems(item);
            syncWrongState(item);
        });
        enlargeGroups();
        foldMaterials();
        homeSplitLeft();
        flattenGroups();

        // 本次页面加载的初始态：题目 / 答案 / 解析 / 错题 四组开关一律「已关」。
        // 只在首个 init 里下发一次，之后用户手动切换的态由期望态变量维持，不再被这里覆盖。
        if (!window.__fhDefaultClosed) {
            window.__fhDefaultClosed = true;
            applyResMode('close');    // 解析：全部收起
            applyBodyMode('close');   // 题目：题干/选项收起，只留题号
            applyHideMode('close');   // 答案：正确答案/你的答案/正确率/易错项/对错颜色全隐藏
            setHide('time', true);    // 答题用时一并隐藏（与答案组同开关）
            updateAllBtns();
        }
        updateResRateSpan();
    }


    /* ---------- 组内拖拽分隔条：默认顶到最左边 ---------- */

    var HSCROLL_HOME_ON = false;   // 分栏已展平、分隔条已移除，不再需要摆位置；要恢复分栏时改回 true
    var SPLIT_LEFT_MIN = 8;        // 材料收起时，左栏压到的最小宽度（px）
    var SPLIT_LEFT_OPEN = 830;     // 材料展开时，左栏恢复的宽度（px）

    // 沿 DOM 上溯，找到这个元素所属的「左栏」（nz-resizable left）
    function leftOf(node) {
        var el = node;
        while (el && el.nodeType === 1) {
            if (el.classList && el.classList.contains('nz-resizable') &&
                el.classList.contains('left')) return el;
            el = el.parentElement;
        }
        return null;
    }

    // 全页所有左栏（每个材料题组一个）
    function leftPanes() {
        var out = [];
        function push(el) {
            if (el && el.nodeType === 1 && out.indexOf(el) === -1) out.push(el);
        }
        Array.prototype.slice.call(document.querySelectorAll('.nz-resizable.left')).forEach(push);
        // 兜底：类名变了就取 resizable-container 的第一个可拖拽子元素
        Array.prototype.slice.call(document.querySelectorAll('div.resizable-container')).forEach(function (box) {
            var first = box.firstElementChild;
            if (first && first.classList && first.classList.contains('nz-resizable')) push(first);
        });
        return out;
    }

    // 该左栏所在的组里，材料是否正被展开
    function materialOpened(left) {
        var scope = (left.closest ? left.closest('div.resizable-container') : null) ||
                    left.parentElement || left;
        var anchors = scope.querySelectorAll('.fenbi-mat-anchor');
        for (var i = 0; i < anchors.length; i++) {
            var st = anchors[i].__fenbiMatState;
            if (st && st.open) return true;
        }
        return false;
    }

    function setLeftWidth(left, w) {
        var cur = parseFloat(left.style.width);
        if (!isNaN(cur) && Math.abs(cur - w) < 0.5) return;
        left.style.width = w + 'px';
    }

    // 用户一旦自己拖过分隔条，这一组就不再被自动摆正
    function guardSplitDrag() {
        if (guardSplitDrag.__on) return;
        guardSplitDrag.__on = true;
        function mark(e) {
            var t = e.target;
            while (t && t.nodeType === 1) {
                if (t.classList && t.classList.contains('nz-resizable-handle')) {
                    var left = leftOf(t);
                    if (left) left.__fenbiUserResized = true;
                    return;
                }
                t = t.parentElement;
            }
        }
        document.addEventListener('pointerdown', mark, true);
        document.addEventListener('mousedown', mark, true);
    }

    // 把每组的分隔条摆到最左边：左栏压窄；材料一旦展开则恢复原宽
    function homeSplitLeft() {
        if (!HSCROLL_HOME_ON) return;
        guardSplitDrag();
        leftPanes().forEach(function (left) {
            if (left.__fenbiUserResized) return;
            setLeftWidth(left, materialOpened(left) ? SPLIT_LEFT_OPEN : SPLIT_LEFT_MIN);
        });
    }

    init();
    setTimeout(init, 1200);
    setTimeout(init, 3000);
    setInterval(function () {
        linkExamTitle();
        getItems().forEach(function (item) {
            processItem(item);
            markOverallItems(item);
            syncResState(item);
            syncBodyState(item);
            syncTimeState(item);
            syncWrongState(item);
        });
        enlargeGroups();
        foldMaterials();
        homeSplitLeft();
        flattenGroups();
        updateAllBtns();
    }, 3000);
})();
