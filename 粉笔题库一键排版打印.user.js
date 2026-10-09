// ==UserScript==
// @name         粉笔题库一键排版打印（可自选题目导出）
// @namespace    http://tampermonkey.net/
// @version      70.76
// @description  粉笔网试卷一键排版打印，支持标准封面、自定义页边距、字体与分页策略
// @author       Gdz
// @match        *://spa.fenbi.com/*
// @match        *://www.fenbi.com/spa/*
// @grant        GM_xmlhttpRequest
// @connect      cloud1-8g137o5da8d5e269-1388442749.ap-shanghai.app.tcloudbase.com
// ==/UserScript==

/* jshint esversion: 8 */

(function() {
    'use strict';

    // 扩展被自动注入、工具栏点击补注入或油猴同时运行时，只保留一个控制面板。
    const existingPanel = document.getElementById('tm-panel');
    if (existingPanel) {
        existingPanel.style.display = 'block';
        return;
    }

    // 插件版本号：优先从油猴(GM_info)自动读取，书签等环境回退到默认值
const PLUGIN_VERSION = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '70.75';

    // ===== 付费墙总开关 =====
    // false = 推广期：全功能免费开放，免卡密免验证（不调后端、不扣次数），全参数可调
    // true  = 恢复收费：需输入卡密验证；Pro 卡密解锁高级参数（改回 true 即恢复原付费逻辑）
    const PAY_WALL = false;

    function getCurrentPaperTitle() {
        let inputVal = document.getElementById('tm-coverTitle')?.value;
        if (inputVal && inputVal !== "正在自动读取当前试卷..." && !inputVal.includes("2026年天津市")) {
            return inputVal;
        }

        try {
            const titleEl = document.querySelector('.header-title');
            if (titleEl) {
                let t = titleEl.getAttribute('title') || titleEl.innerText.trim();
                if (t) return t;
            }
            const otherTitle = document.querySelector('.paper-name, .header-center .title, title');
            if (otherTitle && otherTitle.innerText.trim()) {
                return otherTitle.innerText.trim();
            }
        } catch (e) {}

        return "2026年公务员录用考试《行政职业能力测验》试卷";
    }

    // 只依据粉笔页面自身的试卷标题判断地区；用户可编辑的封面名称不参与判定。
    function isGuangdongSourcePaper() {
        const titleNodes = document.querySelectorAll('.header-title, .paper-name, .header-center .title');
        const pageTitles = Array.from(titleNodes).map(node => (node.getAttribute('title') || '') + ' ' + (node.textContent || ''))
            .filter(value => value.trim());
        return /广东/.test(pageTitles.length ? pageTitles.join(' ') : (document.title || ''));
    }

    // 打印驱动会把 document.title 当作默认文件名；清理 Windows 文件名禁用字符。
    function getPrintFileName(title) {
        const cleaned = String(title || '')
            .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/[.\s]+$/g, '')
            .trim();
        return (cleaned || '粉笔试卷').slice(0, 120);
    }

    // 从练习页或查看试卷页 URL 中提取答题记录 ID，用于生成答案二维码。
    function getPaperId() {
        const match = window.location.href.match(/\/(?:exercise|view\/paper)\/([^?&#\/]+)/);
        return match ? match[1] : null;
    }

    // 生成粉笔答案二维码图片URL（使用在线二维码API）
    function getAnswerQrCodeUrl() {
        const paperId = getPaperId();
        if (!paperId) return null;
        const answerUrl = "https://www.fenbi.com/exercise/answercard/" + paperId;
        return "https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=" + encodeURIComponent(answerUrl);
    }

    const styleElem = document.createElement('style');
    styleElem.innerHTML = `
        #tm-loading-mask {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
            z-index: 9999999; display: none; align-items: center; justify-content: center;
            font-family: "Microsoft YaHei", sans-serif;
        }
        #tm-loading-box {
            background: white; padding: 30px 40px; border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3); text-align: center; max-width: 350px;
        }
        .tm-spinner {
            width: 45px; height: 45px; border: 4px solid #f3f3f3; border-top: 4px solid #1677ff;
            border-radius: 50%; animation: tm-spin 0.8s linear infinite; margin: 0 auto 15px auto;
        }
        @keyframes tm-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        #tm-loading-text { font-size: 15px; font-weight: bold; color: #333; margin-bottom: 5px; }
        #tm-loading-sub { font-size: 12px; color: #666; line-height: 1.5; }

        /* ===== 面板现代样式 ===== */
        .tm-panel { position: fixed; top: 120px; left: max(10px, calc(100vw - 308px)); width: min(288px, calc(100vw - 10px)); background: #fff; border: 1px solid #eef0f4; border-radius: 16px; box-shadow: 0 16px 48px rgba(15,23,42,0.14); padding: 16px 16px 14px; z-index: 999999; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2937; box-sizing: border-box; max-height: calc(100vh - 140px); overflow-y: auto; scrollbar-width: thin; }
        .tm-panel::-webkit-scrollbar { width: 6px; }
        .tm-panel::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        .tm-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .tm-logo { display: flex; align-items: center; gap: 8px; }
        .tm-dot { width: 10px; height: 10px; border-radius: 3px; background: linear-gradient(135deg, #2563eb, #7c3aed); }
        .tm-title { font-size: 15px; font-weight: 700; color: #0f172a; letter-spacing: 0.2px; }
        .tm-actions { display: flex; align-items: center; gap: 2px; }
        .tm-link-btn { font-size: 12px; color: #2563eb; cursor: pointer; user-select: none; padding: 4px 8px; border-radius: 8px; transition: background 0.15s; white-space: nowrap; }
        .tm-link-btn:hover { background: #eff6ff; }
        .tm-x { font-size: 18px; color: #94a3b8; cursor: pointer; user-select: none; line-height: 1; padding: 2px 7px; border-radius: 8px; transition: color 0.15s, background 0.15s; }
        .tm-x:hover { color: #0f172a; background: #f1f5f9; }
        .tm-field { margin-bottom: 12px; }
        .tm-label { display: block; font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 6px; }
        .tm-input, .tm-select { width: 100%; padding: 9px 12px; box-sizing: border-box; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 13px; color: #0f172a; background: #fff; outline: none; transition: border-color 0.15s, box-shadow 0.15s; font-family: inherit; }
        .tm-input:focus, .tm-select:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
        .tm-count-line { font-size: 12px; color: #64748b; margin-bottom: 12px; }
        .tm-count { color: #ea580c; font-weight: 700; }
        .tm-pro-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; vertical-align: 1px; margin-left: 4px; }
        .tm-pro-badge.pro { background: linear-gradient(135deg, #f59e0b, #f97316); color: #fff; }
        .tm-pro-badge.free { background: #e2e8f0; color: #64748b; }
        .tm-field.tm-locked { opacity: .45; pointer-events: none; }

        .tm-btn { width: 100%; padding: 11px; background: linear-gradient(135deg, #2563eb, #4f46e5); color: #fff; border: none; border-radius: 11px; cursor: pointer; font-size: 14px; font-weight: 700; letter-spacing: 0.5px; transition: transform 0.12s, filter 0.12s; font-family: inherit; box-shadow: 0 6px 16px rgba(37,99,235,0.25); }
        .tm-btn:hover { filter: brightness(1.05); transform: translateY(-1px); }
        .tm-btn:active { transform: translateY(0); }
        .tm-adv { display: none; margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0; }
        .tm-check { display: flex; align-items: center; font-size: 13px; color: #334155; cursor: pointer; user-select: none; gap: 8px; margin: 0; }
        .tm-check input { width: 16px; height: 16px; accent-color: #2563eb; margin: 0; }
        .tm-hint { font-size: 11px; color: #94a3b8; margin-top: 4px; line-height: 1.4; }
        .tm-vip-box { padding: 12px; background: #f8fafc; border: 1px solid #eef0f4; border-radius: 12px; }
        .tm-btn-green { width: 100%; padding: 9px; background: linear-gradient(135deg, #16a34a, #22c55e); color: #fff; border: none; border-radius: 10px; cursor: pointer; font-size: 12px; font-weight: 700; font-family: inherit; margin-top: 8px; transition: filter 0.15s; }
        .tm-btn-green:hover { filter: brightness(1.05); }
        .tm-footer { margin-top: 12px; font-size: 11px; color: #cbd5e1; text-align: center; }
        .tm-row { display: flex; gap: 8px; }
        .tm-row .tm-field { flex: 1; }

        /* ===== 自选题目导出（次级入口按钮） ===== */
        .tm-btn2 { width: 100%; margin-top: 8px; padding: 10px; background: #fff; color: #2563eb; border: 1px solid #c7d2fe; border-radius: 11px; cursor: pointer; font-size: 13px; font-weight: 700; letter-spacing: 0.3px; font-family: inherit; transition: background 0.15s, border-color 0.15s; }
        .tm-btn2:hover { background: #eff6ff; border-color: #93c5fd; }

        /* ===== 自选题目导出：勾选界面（深色，沿用 tm-* 命名） ===== */
        #tm-pickui, #tm-pickui * { box-sizing: border-box; }
        #tm-pickui button { font-family: inherit; margin: 0; letter-spacing: normal; text-transform: none; line-height: normal; min-width: 0; }
        #tm-pickui.tm-pickui { position: fixed; inset: 0; z-index: 2147483000; display: none; align-items: center; justify-content: center; background: rgba(8,10,14,0.66); font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
        #tm-pickui.tm-pickui.show { display: flex; }
        #tm-pickui .tm-pick-box { display: flex; flex-direction: column; width: min(900px, 94vw); max-height: 88vh; background: #1b1e25; border: 1px solid #2e333d; border-radius: 12px; overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,0.55); }
        #tm-pickui .tm-pick-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #181b21; border-bottom: 1px solid #2e333d; flex: 0 0 auto; }
        #tm-pickui .tm-pick-brand { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: #e6eaf0; }
        #tm-pickui .tm-pick-sub { font-size: 12px; font-weight: 400; color: #8b95a3; }
        #tm-pickui .tm-pick-x { font-size: 19px; color: #6b7583; cursor: pointer; padding: 2px 8px; border-radius: 6px; line-height: 1; }
        #tm-pickui .tm-pick-x:hover { color: #e6eaf0; background: #2b323d; }
        #tm-pickui .tm-pick-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid #262b34; flex: 0 0 auto; }
        #tm-pickui .tm-pick-batch { background: #252a33; color: #a8b2bf; border: 1px solid #3a4049; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; padding: 7px 12px; white-space: nowrap; transition: background 0.15s; }
        #tm-pickui .tm-pick-batch:hover { background: #2f353f; color: #d7dce3; }
        #tm-pickui .tm-pick-batch-orange { background: #f59e0b; color: #1a1d23; border: 1px solid #f59e0b; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 700; padding: 7px 12px; white-space: nowrap; transition: background 0.15s, border-color 0.15s; }
        #tm-pickui .tm-pick-batch-orange:hover { background: #ff8f1f; border-color: #ff8f1f; }
        #tm-pickui .tm-pick-batch-orange:active { background: #e08b06; border-color: #e08b06; }
        #tm-pickui .tm-pick-range { width: 230px; flex: 0 0 auto; padding: 7px 10px; border: 1px solid #3a4049; border-radius: 6px; font-size: 13px; color: #e6eaf0; background: #22262e; outline: none; font-family: inherit; }
        #tm-pickui .tm-pick-range::placeholder { color: #5c6674; }
        #tm-pickui .tm-pick-range:focus { border-color: #4dd0e1; box-shadow: 0 0 0 3px rgba(77,208,225,0.15); }
        #tm-pickui .tm-pick-cnt { margin-left: auto; font-size: 12px; color: #8b95a3; white-space: nowrap; }
        #tm-pickui .tm-pick-boards { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 9px 16px; border-bottom: 1px solid #262b34; flex: 0 0 auto; background: #1d2129; }
        #tm-pickui .tm-pick-boards-tt { font-size: 12px; font-weight: 700; color: #8b95a3; flex: 0 0 auto; }
        #tm-pickui .tm-pick-boards-hint { font-size: 12px; color: #6b7583; }
        #tm-pickui .tm-pick-board { display: flex; align-items: center; gap: 6px; background: #252a33; border: 1px solid #3a4049; border-radius: 6px; padding: 5px 10px; cursor: pointer; transition: background 0.15s, border-color 0.15s; margin: 0; }
        #tm-pickui .tm-pick-board:hover { background: #2f353f; border-color: #4a525f; }
        #tm-pickui .tm-pick-board input { width: 14px; height: 14px; accent-color: #648CFC; margin: 0; flex: 0 0 auto; }
        #tm-pickui .tm-pick-board-nm { font-size: 12px; font-weight: 600; color: #d7dce3; white-space: nowrap; }
        #tm-pickui .tm-pick-board-rg { font-size: 11px; color: #8aa6fd; white-space: nowrap; }
        #tm-pickui .tm-pick-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 8px; scrollbar-width: thin; }
        #tm-pickui .tm-pick-list::-webkit-scrollbar { width: 8px; }
        #tm-pickui .tm-pick-list::-webkit-scrollbar-thumb { background: #333a45; border-radius: 4px; }
        #tm-pickui .tm-pick-list::-webkit-scrollbar-thumb:hover { background: #414a58; }
        #tm-pickui .tm-pick-item { display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; border-radius: 7px; cursor: pointer; color: #d7dce3; margin: 0; }
        #tm-pickui .tm-pick-item:hover { background: #22262e; }
        #tm-pickui .tm-pick-item input { width: 15px; height: 15px; accent-color: #648CFC; margin: 3px 0 0; flex: 0 0 auto; }
        #tm-pickui .tm-pick-seq { flex: 0 0 auto; min-width: 30px; font-size: 12px; font-weight: 700; color: #8aa6fd; text-align: right; line-height: 1.7; }
        #tm-pickui .tm-pick-no { flex: 0 0 auto; font-size: 11px; color: #8b95a3; background: #22262e; border: 1px solid #323845; border-radius: 5px; padding: 1px 6px; white-space: nowrap; line-height: 1.5; }
        #tm-pickui .tm-pick-txt { flex: 1 1 auto; font-size: 13px; line-height: 1.55; color: #d7dce3; word-break: break-word; }
        #tm-pickui .tm-pick-empty { padding: 22px; text-align: center; font-size: 13px; color: #8b95a3; }
        #tm-pickui .tm-pick-foot { flex: 0 0 auto; border-top: 1px solid #2e333d; padding: 10px 16px 12px; background: #181b21; }
        #tm-pickui .tm-pick-opts { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
        #tm-pickui .tm-pick-opts label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #d7dce3; cursor: pointer; user-select: none; margin: 0; }
        #tm-pickui .tm-pick-opts input { width: 15px; height: 15px; accent-color: #648CFC; margin: 0; }
        #tm-pickui .tm-pick-hint { font-size: 11px; color: #6b7583; line-height: 1.6; margin-bottom: 10px; }
        #tm-pickui .tm-pick-hint b { color: #a8b2bf; }
        #tm-pickui .tm-pick-btns { display: flex; align-items: center; gap: 10px; }
        #tm-pickui .tm-pick-ok { flex: 2; padding: 10px; background: #2F7FE0; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 700; transition: background 0.15s; }
        #tm-pickui .tm-pick-ok:hover { background: #4f9af0; }
        #tm-pickui .tm-pick-cancel { flex: 1; padding: 10px; background: #252a33; color: #a8b2bf; border: 1px solid #3a4049; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: background 0.15s; }
        #tm-pickui .tm-pick-cancel:hover { background: #2f353f; color: #d7dce3; }
    `;
    document.head.appendChild(styleElem);

    const mask = document.createElement('div');
    mask.id = 'tm-loading-mask';
    mask.innerHTML = `
        <div id="tm-loading-box">
            <div class="tm-spinner"></div>
            <div id="tm-loading-text">正在拼命排版并生成真卷...</div>
            <div id="tm-loading-sub">大文件渲染需要几秒钟，请稍候，系统马上为您唤起打印窗口。</div>
        </div>
    `;
    document.body.appendChild(mask);

    // 1. 创建悬浮控制面板
    const panel = document.createElement('div');
    panel.id = 'tm-panel';
    panel.className = 'tm-panel';

    panel.innerHTML = `
        <div class="tm-head">
            <div class="tm-logo"><span class="tm-dot"></span><span class="tm-title">粉笔打印助手</span></div>
            <div class="tm-actions">
                <span class="tm-link-btn" id="tm-toggle">高级设置 ▾</span>
                <span class="tm-x" id="tm-close" title="关闭">×</span>
            </div>
        </div>

        <!-- 精简区（始终显示） -->
        <div class="tm-field">
            <label class="tm-label">试卷标题</label>
            <input type="text" id="tm-coverTitle" value="正在自动读取当前试卷..." class="tm-input">
        </div>
        <div class="tm-count-line">${PAY_WALL ? '剩余打印次数：<span class="tm-count" id="tm-left-count">--</span> <span class="tm-pro-badge" id="tm-pro-badge" style="display:none;"></span>' : '<span class="tm-pro-badge pro">全功能免费开放</span>'}</div>
        <button id="tm-btn" class="tm-btn">提取试卷并打印</button>
        <button id="tm-pick-btn" class="tm-btn2">自选题目导出（先勾选再排版）</button>

        ${PAY_WALL ? `<!-- 卡密（始终显示，不随高级设置折叠） -->
        <div class="tm-vip-box" style="margin-top:12px;">
            <label class="tm-label">您的卡密</label>
            <input type="text" id="tm-vip-key" placeholder="请输入卡密" class="tm-input" style="margin-bottom:0;">
            <button id="tm-buy-btn" class="tm-btn-green">购买 Pro 卡密 (0.99元/10次)</button>
        </div>` : ''}

        <!-- 高级设置区（默认收起） -->
        <div class="tm-adv" id="tm-advanced">
            <div class="tm-field">
                <label class="tm-check"><input type="checkbox" id="tm-hasCover" checked> 生成标准考试封面(含缓冲页)</label>
            </div>
            <div class="tm-field">
                <label class="tm-label">页边距</label>
                <select id="tm-margin" class="tm-select">
                    <option value="25mm 20mm" selected>标准</option>
                    <option value="15mm 15mm">窄边（推荐）</option>
                    <option value="10mm 10mm">极窄</option>
                </select>
            </div>
            <div class="tm-row">
                <div class="tm-field">
                    <label class="tm-label">字体大小 (px)</label>
                    <input type="number" id="tm-fontSize" value="16" class="tm-input">
                    <div class="tm-hint" style="color:#16a34a;margin:0 0 4px 0;">1px=0.75pt（Word 字号单位），注意换算</div>
                </div>
                <div class="tm-field">
                    <label class="tm-label">行距</label>
                    <input type="number" id="tm-lineHeight" value="1.5" min="1.1" max="2.2" step="0.05" class="tm-input">
                </div>
            </div>
            <div class="tm-field">
                <label class="tm-label">正文字体</label>
                <div class="tm-hint" style="color:#16a34a;margin:0 0 4px 0;">用仿宋建议字号:18px</div>
                <select id="tm-fontFamily" class="tm-select">
                    <option value="fangsong">仿宋1（不描边）</option>
                    <option value="fangsong2">仿宋2（打印颜色浅，换这个）</option>
                    <option value="simhei">黑体</option>
                    <option value="simsun" selected>宋体</option>
                    <option value="kaiti">楷体</option>
                    <option value="shserif-regular">思源宋体-常规</option>
                    <option value="shserif-medium">思源宋体-中等</option>
                </select>
            </div>
            <div class="tm-field">
                <label class="tm-label">题目间距 (px)</label>
                <input type="number" id="tm-spacing" value="18" class="tm-input">
            </div>
            <div class="tm-field">
                <label class="tm-check"><input type="checkbox" id="tm-indent" checked> 悬挂缩进 (题号单独一列+空格，正文左对齐)</label>
            </div>
            <div class="tm-field">
                <label class="tm-label">分页策略</label>
                <select id="tm-pagination" class="tm-select">
                    <option value="smart">智能分页（推荐）</option>
                    <option value="ultra">紧密排列</option>
                    <option value="whole" selected>整题不拆</option>
                </select>
            </div>
            <div class="tm-field">
                <label class="tm-check"><input type="checkbox" id="tm-module-new-page" checked> 模块换页</label>
                <div class="tm-hint">取消后模块顺序排列；若新模块的首题放不完整，仍会自动换页。</div>
            </div>
            <div class="tm-field" id="tm-guangdong-judgement-row" style="display:none">
                <label class="tm-check"><input type="checkbox" id="tm-guangdong-hide-judgement"> 广东判断题不显示“正确／错误”选项</label>
                <div class="tm-hint">只影响恰好含“正确、错误”两个选项的题；不隐藏题干中的作答括号。</div>
            </div>
            <div class="tm-field">
                <label class="tm-label">题目图片缩放 (%)</label>
                <input type="number" id="tm-figScale" value="70" min="20" max="100" class="tm-input">
                <div class="tm-hint">自动识别所有大图（题干/选项/资料分析图表）按此比例缩放；小图（如分数公式）不缩放</div>
            </div>
        </div>

        <div class="tm-footer">行测小助理提供 <span style="font-weight:700;color:#94a3b8;">v${PLUGIN_VERSION}</span></div>
    `;

    document.body.appendChild(panel);

    function syncGuangdongControl() {
        const row = document.getElementById('tm-guangdong-judgement-row');
        const box = document.getElementById('tm-guangdong-hide-judgement');
        if (!row || !box) return;
        const allowed = isGuangdongSourcePaper();
        row.style.display = allowed ? '' : 'none';
        if (!allowed) box.checked = false;
    }
    syncGuangdongControl();
    // 试卷标题常在面板加载后才由粉笔填入，短时复查并在点击打印时再次严格校验。
    const guangdongTitleTimer = setInterval(syncGuangdongControl, 1000);
    setTimeout(() => clearInterval(guangdongTitleTimer), 30000);

    // Edge 扩展图标可重新显示或收起面板；油猴环境没有 chrome.runtime，会自动跳过。
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
                if (!message || message.type !== 'fenbi-print-toggle-panel') return;
                const hidden = panel.style.display === 'none';
                panel.style.display = hidden ? 'block' : 'none';
                sendResponse({ visible: hidden });
            });
        }
    } catch (_) {}

    // ===== 面板拖动（标题栏拖动，位置记忆 + 缩放钳制不丢失） =====
    (function panelDrag() {
        const st = { on: false, dx: 0, dy: 0 };
        const head = panel.querySelector('.tm-head');
        if (!head) return;
        head.style.cursor = 'move';
        function clamp() {
            const w = panel.offsetWidth, h = panel.offsetHeight;
            let x = parseFloat(panel.style.left);
            let y = parseFloat(panel.style.top);
            if (isNaN(x)) x = Math.max(10, window.innerWidth - w - 20);
            if (isNaN(y)) y = 120;
            x = Math.max(0, Math.min(x, window.innerWidth - w));
            y = Math.max(0, Math.min(y, window.innerHeight - 40));
            panel.style.left = x + 'px';
            panel.style.top = y + 'px';
        }
        head.addEventListener('mousedown', (e) => {
            if (e.target && (e.target.id === 'tm-close' || e.target.id === 'tm-toggle')) return;
            const r = panel.getBoundingClientRect();
            st.on = true; st.dx = e.clientX - r.left; st.dy = e.clientY - r.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!st.on) return;
            let x = e.clientX - st.dx, y = e.clientY - st.dy;
            const w = panel.offsetWidth, h = panel.offsetHeight;
            x = Math.max(0, Math.min(x, window.innerWidth - w));
            y = Math.max(0, Math.min(y, window.innerHeight - 40));
            panel.style.left = x + 'px';
            panel.style.top = y + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!st.on) return;
            st.on = false;
            try { localStorage.setItem('fb_panel_pos', JSON.stringify({ left: panel.style.left, top: panel.style.top })); } catch (e) {}
        });
        // 恢复位置 + 窗口缩放钳制
        try {
            const s = JSON.parse(localStorage.getItem('fb_panel_pos') || '{}');
            if (s.left && s.top) { panel.style.left = s.left; panel.style.top = s.top; }
        } catch (e) {}
        clamp();
        window.addEventListener('resize', clamp);
    })();



    // 侧边栏：折叠/展开高级设置 + 关闭（刷新后自动重新出现）
    const tmAdv = document.getElementById('tm-advanced');
    const tmToggle = document.getElementById('tm-toggle');
    if (tmToggle && tmAdv) {
        tmToggle.addEventListener('click', () => {
            syncGuangdongControl();
            const hidden = tmAdv.style.display === 'none';
            tmAdv.style.display = hidden ? 'block' : 'none';
            tmToggle.innerText = hidden ? '收起设置 ▴' : '高级设置 ▾';
        });
    }
    document.getElementById('tm-close')?.addEventListener('click', () => { panel.style.display = 'none'; });

    // ===== 设置持久化：保存到本地，下次自动恢复 =====
    function collectSettings() {
        const cur = {
            hasCover: document.getElementById('tm-hasCover')?.checked ? 1 : 0,
            margin: document.getElementById('tm-margin')?.value || '',
            fontFamily: document.getElementById('tm-fontFamily')?.value || 'fangsong',
            fontSize: document.getElementById('tm-fontSize')?.value || '',
            spacing: document.getElementById('tm-spacing')?.value || '',
            lineHeight: document.getElementById('tm-lineHeight')?.value || '',
            pagination: document.getElementById('tm-pagination')?.value || '',
            moduleNewPage: document.getElementById('tm-module-new-page')?.checked ? 1 : 0,
            figScale: document.getElementById('tm-figScale')?.value || '',
            hang: document.getElementById('tm-indent')?.checked ? 1 : 0,
        };
        if (!currentPro) {
            // 免费版：锁定字段不覆盖用户保存的 Pro 设置（避免切回 Pro 后丢失自定义值）
            try {
                const old = JSON.parse(localStorage.getItem('fb_settings') || '{}');
                if (old.spacing) cur.spacing = old.spacing;
                if (old.pagination) cur.pagination = old.pagination;
                if (old.figScale) cur.figScale = old.figScale;
                if (old.hang !== undefined) cur.hang = old.hang;
            } catch (e) {}
        }
        return cur;
    }
    function saveSettings() {
        try { localStorage.setItem('fb_settings', JSON.stringify(collectSettings())); } catch (e) {}
    }    function loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem('fb_settings') || '{}');
            if (!s || !Object.keys(s).length) return;
            if (s.margin) document.getElementById('tm-margin').value = s.margin;
            if (s.fontSize) document.getElementById('tm-fontSize').value = s.fontSize;
            if (s.spacing) document.getElementById('tm-spacing').value = s.spacing;
            if (s.lineHeight) document.getElementById('tm-lineHeight').value = s.lineHeight;
            if (s.pagination) document.getElementById('tm-pagination').value = s.pagination;
            if (s.moduleNewPage !== undefined) document.getElementById('tm-module-new-page').checked = !!s.moduleNewPage;
            if (s.figScale) document.getElementById('tm-figScale').value = s.figScale;
            if (s.fontFamily) document.getElementById('tm-fontFamily').value = s.fontFamily;
            const hc = document.getElementById('tm-hasCover');
            if (hc) hc.checked = s.hasCover ? true : false;
            const ind = document.getElementById('tm-indent');
            if (ind && s.hang !== undefined) ind.checked = s.hang ? true : false;
        } catch (e) {}
    }
    ['tm-margin','tm-fontSize','tm-spacing','tm-lineHeight','tm-pagination','tm-module-new-page','tm-figScale','tm-indent','tm-fontFamily'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.addEventListener('input', saveSettings); el.addEventListener('change', saveSettings); }
    });
    const hcEl = document.getElementById('tm-hasCover');
    if (hcEl) hcEl.addEventListener('change', saveSettings);
    loadSettings();

    setTimeout(() => {
        let current = getCurrentPaperTitle();
        if(current) document.getElementById('tm-coverTitle').value = current;
        
        // 初始化
        if (!PAY_WALL) {
            // 推广期：全功能免费开放，免卡密，直接解锁
            applyProState(true);
        } else {
            // 恢复收费后：读取保存的卡密
            let savedKey = storeGet('fb_plugin_vip_key');
            if (savedKey) {
                storeSet('fb_plugin_vip_key', savedKey); // 回写，跨子域同步
                document.getElementById('tm-vip-key').value = savedKey;
                // 查询并显示剩余次数
                queryLeftCount(savedKey);
            } else {
                // 没有保存的卡密 → 自动开通免费试用（每设备3次）
                tryFreeTrial();
            }
        }
    }, 800);

    // 查询卡密剩余次数（不扣次数）

    let currentPro = false;  // 当前卡密是否为 Pro
    // Pro 状态应用：徽标 + 锁定高级功能（免费卡固定参数：间距20px/非悬挂/智能分页/图片缩放80%）
    function applyProState(pro) {
        if (!PAY_WALL) pro = true;   // 推广期：全功能解锁
        currentPro = !!pro;
        const badge = document.getElementById('tm-pro-badge');
        if (badge) {
            badge.style.display = 'inline-block';
            badge.className = 'tm-pro-badge ' + (currentPro ? 'pro' : 'free');
            badge.innerText = currentPro ? 'PRO' : '免费版';
        }
        const lockedIds = ['tm-spacing','tm-pagination','tm-indent','tm-figScale'];
        // 免费版：固定参数直接写回面板显示（与打印实际参数一致，杜绝显示值不严谨）
        if (!currentPro) {
            const fp = document.getElementById('tm-figScale');
            if (fp) fp.value = 70;
            const sp = document.getElementById('tm-spacing');
            if (sp) sp.value = 15;
            const pg = document.getElementById('tm-pagination');
            if (pg) pg.value = 'ultra';
            const ind = document.getElementById('tm-indent');
            if (ind) ind.checked = false;
        } else {
            // Pro：恢复用户自己保存的设置
            try {
                const s = JSON.parse(localStorage.getItem('fb_settings') || '{}');
                if (s.spacing) document.getElementById('tm-spacing').value = s.spacing;
                if (s.lineHeight) document.getElementById('tm-lineHeight').value = s.lineHeight;
                if (s.pagination) document.getElementById('tm-pagination').value = s.pagination;
                if (s.figScale) document.getElementById('tm-figScale').value = s.figScale;
                const ind = document.getElementById('tm-indent');
                if (ind && s.hang !== undefined) ind.checked = s.hang ? true : false;
            } catch (e) {}
        }
        lockedIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const field = el.closest('.tm-field');
            if (!field) return;
            if (currentPro) {
                field.classList.remove('tm-locked');
            } else {
                field.classList.add('tm-locked');
                let tag = field.querySelector('.tm-lock-tag');
                if (!tag) {
                    tag = document.createElement('span');
                    tag.className = 'tm-lock-tag';
                    tag.style.cssText = 'font-size:10px;color:#e10602;margin-left:6px;font-weight:600;pointer-events:auto;';
                    tag.innerText = '🔒 Pro';
                    tag.title = '购买 Pro 卡密解锁（免费版固定：紧密排列/间距15px/非悬挂/图片70%）';
                    tag.addEventListener('click', () => openPayModal());
                    field.querySelector('.tm-label')?.appendChild(tag);
                }
            }
        });
    }

    async function queryLeftCount(vipKey) {
        if (!PAY_WALL) return;   // 推广期：无卡密，不查询
        if (!vipKey) return;
        try {
            const resp = await fetch("https://cloud1-8g137o5da8d5e269-1388442749.ap-shanghai.app.tcloudbase.com/api/query-key", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: vipKey })
            });
            const res = await resp.json();
            if (res.success) {
                document.getElementById('tm-left-count').innerText = res.leftCount + ' 次';
                applyProState(res.pro);
                // 验证成功即保存卡密，避免手动输入新卡密后刷新又恢复成旧的
                storeSet('fb_plugin_vip_key', vipKey);
            } else {
                document.getElementById('tm-left-count').innerText = '卡密无效';
            }
        } catch (e) {
            document.getElementById('tm-left-count').innerText = '';
        }
    }

    // ===== 设备指纹：canvas 渲染差异 + 硬件特征 → 32位哈希（清cookie/换IP 不变，换浏览器才变） =====
    function getFingerprint() {
        try {
            var parts = [];
            var cv = document.createElement('canvas');
            cv.width = 200; cv.height = 60;
            var ctx = cv.getContext('2d');
            if (ctx) {
                ctx.textBaseline = 'top';
                ctx.font = '14px Arial';
                ctx.fillStyle = '#f60';
                ctx.fillRect(125, 1, 62, 20);
                ctx.fillStyle = '#069';
                ctx.fillText('粉笔打印助手 FENBI-PRINT 68', 2, 15);
                ctx.fillStyle = 'rgba(102,204,0,0.7)';
                ctx.fillText('FENBI-PRINT 68', 4, 17);
                var dataUrl = cv.toDataURL('image/png');
                parts.push('c:' + hashStr(dataUrl.slice(-1200)));
            }
            parts.push('hw:' + (navigator.hardwareConcurrency || '?'));
            parts.push('dm:' + (navigator.deviceMemory || '?'));
            parts.push('scr:' + (screen.width || 0) + 'x' + (screen.height || 0) + 'x' + (screen.colorDepth || 0));
            parts.push('lang:' + (navigator.language || ''));
            parts.push('tz:' + (Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : ''));
            parts.push('plat:' + (navigator.platform || ''));
            parts.push('ua:' + (navigator.userAgent || '').slice(0, 80));
            return hashStr(parts.join('|'));
        } catch (e) { return ''; }
    }
    function hashStr(str) {
        var h1 = 0xdeadbeef, h2 = 0x41c6ce57, i;
        for (i = 0; i < str.length; i++) {
            var ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        var s = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
        return ('0000000' + s).slice(-8);
    }

    // ===== 本地存储：localStorage 优先，cookie 兜底（跨页面/隐私模式更稳，防重复领试用） =====
    function storeGet(key) {
        // localStorage 优先：同一域内读写一定同步（cookie 写入可能被浏览器策略拦截，
        // 若 cookie 优先会一直读到旧值）。cookie 仅作跨子域兜底。
        try { var v = localStorage.getItem(key); if (v) return v; } catch (e) {}
        try {
            var m = document.cookie.match(new RegExp('(?:^|; )' + key + '=([^;]*)'));
            if (m && m[1]) return decodeURIComponent(m[1]);
        } catch (e) {}
        return null;
    }
    function storeSet(key, val) {
        try { localStorage.setItem(key, val); } catch (e) {}
        try { document.cookie = key + '=' + encodeURIComponent(val) + '; max-age=31536000; path=/; domain=.fenbi.com'; } catch (e) {}
    }

    // 免费试用：首次使用自动发放3次打印额度
    async function tryFreeTrial() {
        let deviceId = storeGet('fb_device_id');
        if (!deviceId) {
            deviceId = 'dev_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
            storeSet('fb_device_id', deviceId);
        }
        try {
            const resp = await fetch("https://cloud1-8g137o5da8d5e269-1388442749.ap-shanghai.app.tcloudbase.com/api/free-trial", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId, fp: getFingerprint() })
            });
            const res = await resp.json();
            if (res.success) {
                // 试用成功，自动填入卡密（免费版）
                document.getElementById('tm-vip-key').value = res.key;
                storeSet('fb_plugin_vip_key', res.key);
                applyProState(res.pro === true);   // 免费试用 → 免费版
                document.getElementById('tm-left-count').innerText = (res.count || 3) + ' 次';
                document.getElementById('tm-buy-btn').innerText = '试用已开通，用完再买 (0.99元/10次)';
            }
        } catch (e) { /* 静默失败，用户可手动购买 */ }
    }

    if (PAY_WALL) {
        // 购买卡密按钮
        document.getElementById('tm-buy-btn').addEventListener('click', () => {
            openPayModal();
        });

        // 卡密输入框变化时查询剩余次数（防抖 500ms）
        let keyInputTimer = null;
        document.getElementById('tm-vip-key').addEventListener('input', (e) => {
            const val = e.target.value.trim();
            clearTimeout(keyInputTimer);
            if (val.length < 4) {
                document.getElementById('tm-left-count').innerText = '';
                return;
            }
            // 输入即保存：刷新后立即恢复刚输入的卡密（不依赖验证完成）
            storeSet('fb_plugin_vip_key', val);
            keyInputTimer = setTimeout(() => queryLeftCount(val), 500);
        });
    }

    document.getElementById('tm-btn').addEventListener('click', async () => {
        // 推广期免费：跳过卡密验证，直接排版打印
        if (!PAY_WALL) {
            applyProState(true);
            startPrintFlow();
            return;
        }
        const vipKey = document.getElementById('tm-vip-key').value.trim();
        
        if (!vipKey) {
            if (confirm("您还没有卡密，是否立即购买？(0.99元/10次)")) {
                openPayModal();
            }
            return;
        }

        // 保存卡密到本地，下次免输入
        storeSet('fb_plugin_vip_key', vipKey);
        
        // 按钮变为 loading 状态
        const btn = document.getElementById('tm-btn');
        const originalText = btn.innerText;
        btn.innerText = "正在验证卡密...";
        btn.style.background = "#ccc";
        btn.disabled = true;

        // 【真实 API 请求】
        const API_URL = "https://cloud1-8g137o5da8d5e269-1388442749.ap-shanghai.app.tcloudbase.com";
        
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ key: vipKey })
            });
            
            const res = await response.json();
            
            // 恢复按钮状态
            btn.innerText = originalText;
            btn.style.background = "#1677ff";
            btn.disabled = false;

            if (!res.success) {
                alert("验证失败：" + res.msg);
                return;
            }

            // 验证成功，显示剩余次数
            document.getElementById('tm-left-count').innerText = `${res.leftCount} 次`;
            applyProState(res.pro === true);

            // 放行，开始原有的排版打印逻辑
            startPrintFlow();
        } catch(e) {
            btn.innerText = originalText;
            btn.style.background = "#1677ff";
            btn.disabled = false;
            alert("请求发生异常");
        }
    });

    // 「自选题目导出」入口：走与主按钮完全相同的提取/排版链路，仅在拼装前插入一次勾选过滤。
    document.getElementById('tm-pick-btn').addEventListener('click', () => {
        if (!PAY_WALL) {
            applyProState(true);
            startPrintFlow({ pick: true });
            return;
        }
        const leftText = document.getElementById('tm-left-count')?.innerText || '';
        if (!/\d+\s*次/.test(leftText)) {
            alert('请先点击「提取试卷并打印」完成卡密验证，再使用自选题目导出。');
            return;
        }
        applyProState(true);
        startPrintFlow({ pick: true });
    });

    function updatePrintProgress(reservedWin, title, detail) {
        const loadingTitle = document.getElementById('tm-loading-text');
        const loadingDetail = document.getElementById('tm-loading-sub');
        if (loadingTitle) loadingTitle.textContent = title;
        if (loadingDetail) loadingDetail.textContent = detail;
        try {
            if (reservedWin && !reservedWin.closed) {
                const popupTitle = reservedWin.document.getElementById('tm-reserved-title');
                const popupDetail = reservedWin.document.getElementById('tm-reserved-detail');
                if (popupTitle) popupTitle.textContent = title;
                if (popupDetail) popupDetail.textContent = detail;
            }
        } catch (_) {}
    }

    function showReservedLoading(reservedWin) {
        if (!reservedWin || reservedWin.closed) return;
        const isShenlunPage = window.location.href.includes('shenlun');
        let isZhyynlPage = false;
        try { isZhyynlPage = new URL(window.location.href).searchParams.get('routecs') === 'zhyynl'; } catch (_) {}
        const essayLoadingTitle = isZhyynlPage ? '正在读取综应材料' : '正在读取申论材料';
        try {
            reservedWin.document.open();
            reservedWin.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>粉笔打印助手 · 正在排版</title><style>
                *{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;place-items:center;background:radial-gradient(circle at 50% 32%,#f8fbff 0,#eef3fa 46%,#e4ebf4 100%);color:#0f172a;font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
                .card{width:min(420px,calc(100vw - 40px));padding:34px 32px;border:1px solid rgba(148,163,184,.3);border-radius:22px;background:rgba(255,255,255,.94);box-shadow:0 24px 70px rgba(15,23,42,.15);text-align:center}
                .logo{display:grid;place-items:center;width:48px;height:48px;margin:0 auto 22px;border-radius:15px;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;font-size:22px;font-weight:800;box-shadow:0 9px 24px rgba(37,99,235,.28)}
                .spinner{width:34px;height:34px;margin:0 auto 20px;border:4px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
                h1{margin:0;font-size:19px}p{margin:10px 0 0;color:#64748b;font-size:13px;line-height:1.7}.pulse{display:flex;justify-content:center;gap:5px;margin-top:20px}.pulse i{width:6px;height:6px;border-radius:50%;background:#60a5fa;animation:pulse 1.1s ease-in-out infinite}.pulse i:nth-child(2){animation-delay:.16s}.pulse i:nth-child(3){animation-delay:.32s}@keyframes pulse{0%,70%,100%{opacity:.28;transform:translateY(0)}35%{opacity:1;transform:translateY(-4px)}}
            </style></head><body><main class="card"><div class="logo">P</div><div class="spinner"></div><h1 id="tm-reserved-title">${isShenlunPage || isZhyynlPage ? essayLoadingTitle : '正在整理题目内容'}</h1><p id="tm-reserved-detail">请稍候，完成后将在此窗口显示 A4 分页预览。</p><div class="pulse"><i></i><i></i><i></i></div></main></body></html>`);
            reservedWin.document.close();
        } catch (_) {}
    }

    // 开始排版打印流程（免费开放或验证通过后调用）
    // options.pick = true 时，提取完成后先弹出「自选题目」勾选界面，其余流程完全一致。
    function startPrintFlow(options) {
        const pickMode = !!(options && options.pick);
        mask.style.display = 'flex';
        if (pickMode) {
            const pickLoadingTitle = document.getElementById('tm-loading-text');
            const pickLoadingSub = document.getElementById('tm-loading-sub');
            if (pickLoadingTitle) pickLoadingTitle.textContent = '正在提取题目数据…';
            if (pickLoadingSub) pickLoadingSub.textContent = '请稍候，马上弹出勾选界面';
        }
        // 窗口打开时机：
        //  · 普通导出：必须在用户点击的同步调用栈里预留窗口（Safari/部分 Mac 浏览器会拦截延后的 window.open）。
        //  · 自选题目导出：点击按钮时【不开任何窗口】，用户全程留在原页面勾选；
        //    直到点「确定，生成预览」时（依然是真实的用户点击手势），才同步打开预览标签页。
        //    Chrome 不允许脚本把已激活的新标签页踢回后台，所以「提前开窗再抢焦点」做不到不跳转，
        //    只能从根上不提前开窗。
        let reservedWin = null;
        if (!pickMode) {
            try { reservedWin = window.open('', '_blank'); } catch (e) { console.warn('[粉笔打印] 预览弹窗被拦截，改用页内预览。'); }
        }
        const loadingGuard = setTimeout(() => { mask.style.display = 'none'; }, 12000);
        showReservedLoading(reservedWin);
        let initialEssayTitle = '';
        try {
            const routecs = new URL(window.location.href).searchParams.get('routecs');
            initialEssayTitle = routecs === 'zhyynl' ? '正在读取综应材料' : routecs === 'shenlun' || window.location.href.includes('shenlun') ? '正在读取申论材料' : '';
        } catch (_) { initialEssayTitle = window.location.href.includes('shenlun') ? '正在读取申论材料' : ''; }
        updatePrintProgress(reservedWin, initialEssayTitle || '正在整理题目内容', '正在识别当前页面，请稍候…');
        // 微任务立即进入提取；后续异步等待由前台预览窗口驱动，避免 Edge 后台计时器节流。
        Promise.resolve().then(async () => {
            try {
                const hasCover = document.getElementById('tm-hasCover').checked;
                const coverTitle = getCurrentPaperTitle();
                document.getElementById('tm-coverTitle').value = coverTitle;

                const pageMargin = document.getElementById('tm-margin').value;
                const fontSize = parseInt(document.getElementById('tm-fontSize').value, 10);
                // 题目间距：免费版面板已固定为15，Pro 用面板值（applyProState 已保证显示一致）
                const spacing = parseInt(document.getElementById('tm-spacing').value, 10) || 15;
                await extractAndBuild(hasCover, coverTitle, pageMargin, fontSize, spacing, reservedWin, pickMode);
            } catch (e) {
                console.error('[粉笔打印] 生成预览失败：', e);
                try { if (reservedWin && !reservedWin.closed) reservedWin.close(); } catch (_) {}
                alert(e && e.userMessage ? e.userMessage : '生成打印预览失败，请刷新页面后重试。');
            } finally {
                clearTimeout(loadingGuard);
                mask.style.display = 'none';
                const loadingTitle = document.getElementById('tm-loading-text');
                const loadingDetail = document.getElementById('tm-loading-sub');
                if (loadingTitle) loadingTitle.textContent = '正在拼命排版并生成真卷...';
                if (loadingDetail) loadingDetail.textContent = '大文件渲染需要几秒钟，请稍候，系统马上为您唤起打印窗口。';
            }
        });
    }

    // ============ 购买卡密：弹窗支付 + 自动填卡密 ============
    const PAY_API_URL = "https://cloud1-8g137o5da8d5e269-1388442749.ap-shanghai.app.tcloudbase.com";
    let payPollTimer = null;

    async function openPayModal() {
        // 1. 创建订单
        let orderData;
        try {
            const resp = await fetch(PAY_API_URL + "/api/create-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            orderData = await resp.json();
            if (!orderData.success) {
                alert("创建订单失败：" + (orderData.msg || "未知错误"));
                return;
            }
        } catch (e) {
            alert("网络错误，请稍后重试");
            return;
        }

        // 2. 创建支付弹窗
        const modal = document.createElement("div");
        modal.style.cssText = `
            position:fixed; top:0; left:0; width:100vw; height:100vh;
            background:rgba(0,0,0,0.6); z-index:99999999;
            display:flex; align-items:center; justify-content:center;
            font-family:"Microsoft YaHei",sans-serif;
        `;
        modal.innerHTML = `
            <div style="background:white; padding:25px 30px; border-radius:12px; width:320px; text-align:center; box-shadow:0 10px 30px rgba(0,0,0,0.3);">
                <div style="font-size:17px; font-weight:bold; color:#333; margin-bottom:6px;">购买打印卡密</div>
                <div style="font-size:13px; color:#999; margin-bottom:20px;">0.99 元 / 10 次打印</div>
                <div id="tm-pay-qr-area" style="margin:10px 0;">
                    ${orderData.qrcode
                        ? `<img src="${orderData.qrcode}" style="width:200px; height:200px; border:1px solid #eee;" alt="支付二维码">`
                        : `<div style="padding:20px 0; color:#666; font-size:14px; line-height:1.6;">
                             ${orderData.simulate ? "演示模式" : "点击下方按钮<br>打开支付宝完成支付"}
                           </div>`
                    }
                </div>
                <div id="tm-pay-status" style="font-size:13px; color:#1677ff; margin:10px 0; min-height:18px;"></div>
                ${orderData.simulate
                    ? `<button id="tm-sim-pay-btn" style="width:100%; padding:10px; background:#52c41a; color:white; border:none; border-radius:6px; cursor:pointer; font-size:14px; font-weight:bold; margin-bottom:8px;">模拟支付成功</button>`
                    : (orderData.payUrl ? `<a href="${orderData.payUrl}" target="_blank" id="tm-pay-link" style="display:block; width:100%; padding:10px; background:#1677ff; color:white; border:none; border-radius:6px; cursor:pointer; font-size:14px; font-weight:bold; margin-bottom:8px; text-decoration:none;">打开支付页面</a>` : "")
                }
                <button id="tm-pay-close-btn" style="width:100%; padding:8px; background:#f5f5f5; color:#666; border:none; border-radius:6px; cursor:pointer; font-size:13px;">取消</button>
            </div>
        `;
        document.body.appendChild(modal);

        // 关闭弹窗
        const closeModal = () => {
            if (payPollTimer) { clearInterval(payPollTimer); payPollTimer = null; }
            modal.remove();
        };
        modal.querySelector("#tm-pay-close-btn").addEventListener("click", closeModal);
        modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

        // 模拟支付按钮
        const simBtn = modal.querySelector("#tm-sim-pay-btn");
        if (simBtn) {
            simBtn.addEventListener("click", async () => {
                simBtn.disabled = true;
                simBtn.innerText = "处理中...";
                // 模拟模式下订单已秒支付，直接查询即可拿到卡密
                await pollOrder(orderData.orderId, modal, closeModal);
            });
        }

        // 3. 轮询订单状态（真实模式自动轮询；模拟模式等用户点击后查一次）
        // 防刷：最多轮询 60 次（5 秒间隔 ≈ 5 分钟），超时自动停止；页面切后台时暂停轮询
        if (!orderData.simulate) {
            let pollCount = 0;
            const MAX_POLLS = 60;
            payPollTimer = setInterval(() => {
                pollCount++;
                if (pollCount > MAX_POLLS) {
                    if (payPollTimer) { clearInterval(payPollTimer); payPollTimer = null; }
                    const tipEl = modal.querySelector('#tm-pay-tip');
                    if (tipEl) tipEl.innerText = '支付状态查询超时，请重新打开购买弹窗';
                    return;
                }
                if (document.hidden) return;
                pollOrder(orderData.orderId, modal, closeModal);
            }, 5000);
        }
    }

    // 轮询订单，支付成功则自动填卡密
    async function pollOrder(orderId, modal, closeModal) {
        try {
            const resp = await fetch(PAY_API_URL + "/api/query-order?orderId=" + encodeURIComponent(orderId));
            const data = await resp.json();
            if (!data.success) return;

            if (data.status === "paid" && data.key) {
                if (payPollTimer) { clearInterval(payPollTimer); payPollTimer = null; }
                // 自动填入卡密并保存
                document.getElementById("tm-vip-key").value = data.key;
                storeSet("fb_plugin_vip_key", data.key);
                // 查询剩余次数
                let leftCount = 10;
                try {
                    const qr = await fetch(PAY_API_URL + "/api/query-key", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ key: data.key }),
                    });
                    const qd = await qr.json();
                    if (qd.success) leftCount = qd.leftCount;
                } catch (e) {}
                queryLeftCount(data.key);

                // 弹窗切换为支付成功视图，明确展示卡密
                const box = modal.querySelector("div");
                box.innerHTML = `
                    <div style="font-size:20px; font-weight:bold; color:#52c41a; margin-bottom:10px;">✓ 支付成功</div>
                    <div style="font-size:13px; color:#999; margin-bottom:18px;">卡密已自动填入输入框，可直接使用</div>
                    <div style="background:#f7f8fa; border:1px solid #e8e8e8; border-radius:8px; padding:15px; margin-bottom:15px;">
                        <div style="font-size:12px; color:#999; margin-bottom:6px;">您的卡密</div>
                        <div style="font-size:18px; font-weight:bold; color:#1677ff; letter-spacing:2px; font-family:'Courier New', monospace;">${data.key}</div>
                        <div style="font-size:12px; color:#666; margin-top:8px;">剩余 ${leftCount} 次打印（每点一次「排版打印」扣 1 次）</div>
                    </div>
                    <button id="tm-copy-key-btn" style="width:100%; padding:10px; background:#1677ff; color:white; border:none; border-radius:6px; cursor:pointer; font-size:14px; font-weight:bold; margin-bottom:8px;">复制卡密</button>
                    <button id="tm-pay-close-btn" style="width:100%; padding:8px; background:#f5f5f5; color:#666; border:none; border-radius:6px; cursor:pointer; font-size:13px;">关闭</button>
                `;
                // 复制卡密按钮
                modal.querySelector("#tm-copy-key-btn").addEventListener("click", async () => {
                    try {
                        await navigator.clipboard.writeText(data.key);
                        const btn = modal.querySelector("#tm-copy-key-btn");
                        btn.innerText = "已复制";
                        btn.style.background = "#52c41a";
                    } catch (e) {
                        alert("卡密：" + data.key);
                    }
                });
                // 关闭按钮
                modal.querySelector("#tm-pay-close-btn").addEventListener("click", closeModal);
            }
        } catch (e) { /* 轮询出错忽略，继续 */ }
    }

    // 此函数序列化到打印页：三种策略共用同一套 A4 预览，分页规则仍由各自 pag-* CSS 决定。
    function setupPagedPreview(pageMargin, initialFontSize, initialLineHeight, paginationMode) {
        if (!document.body.classList.contains('pag-' + paginationMode)) return;
        document.body.classList.add('tm-paged-preview');
        const ua = navigator.userAgent || '';
        const isIOSWebKit = /iPad|iPhone|iPod/i.test(ua)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOSWebKit) document.body.classList.add('tm-ios-print-fix');
        const isSmart = paginationMode === 'smart';
        const states = Array.from(document.querySelectorAll('.q-wrapper')).map(question => {
            const options = question.querySelector('.options-grid, .options-flex');
            return { question, stem: question.querySelector('.q-stem'), options,
                items: options ? Array.from(options.children) : [], opening: null };
        });
        let pending = 0;
        let preparing = false;
        let imageAdjusting = false;
        let imageSliderAdjusting = false;
        let typographyAdjusting = false;
        let renderFrame = 0;
        let renderJob = 0;
        let renderEndTimer = 0;
        let rerenderRequested = false;
        let typographyPreviewFrame = 0;
        // 预览已经完成分页时，打印直接复用现有页面。只有排版参数或图片确实变化才重建。
        let layoutDirty = true;
        let finalDividerFooterPage = -1;
        let finalDividerFooterText = '';
        const closest = (node, selector) => {
            if (!node || node.nodeType !== 1) return null;
            if (node.closest) return node.closest(selector);
            while (node) {
                const matches = node.matches || node.msMatchesSelector || node.webkitMatchesSelector;
                if (matches && matches.call(node, selector)) return node;
                node = node.parentElement;
            }
            return null;
        };
        const replaceChildren = (parent, children) => {
            while (parent.firstChild) parent.removeChild(parent.firstChild);
            children.forEach(child => parent.appendChild(child));
        };
        // 固定高度的 CSS 分栏负责真实断页；预览与打印都展示同一批列切片。
        const flow = document.createElement('div');
        flow.id = 'tm-smart-source';
        flow.className = 'tm-smart-flow';
        Array.from(document.body.children).forEach(node => {
            if (!['SCRIPT', 'STYLE'].includes(node.tagName) && !['tm-toolbar', 'save-complete-mask'].includes(node.id)) flow.appendChild(node);
        });
        document.body.appendChild(flow);
        const pages = document.createElement('div');
        pages.id = 'tm-smart-pages';
        document.body.appendChild(pages);
        const renderMask = document.createElement('div');
        renderMask.id = 'tm-render-mask';
        renderMask.setAttribute('role', 'status');
        renderMask.setAttribute('aria-live', 'polite');
        renderMask.setAttribute('aria-hidden', 'true');
        renderMask.innerHTML = '<div class="tm-render-card"><span class="tm-render-spinner"></span><span><b>正在重新分页</b><small>完成后可继续调整</small></span></div>';
        document.body.appendChild(renderMask);
        const previewStyle = document.createElement('style');
        previewStyle.textContent = `
            #tm-smart-source { position:absolute; left:-100000px; top:0; visibility:hidden; }
            .tm-smart-flow { column-fill:auto; column-gap:0; overflow:visible; }
            .tm-smart-flow img { max-height:var(--tm-page-height); object-fit:contain; }
            .tm-smart-flow .cover-page { page:auto; height:var(--tm-page-height); break-after:column; -webkit-column-break-after:always; }
            .tm-smart-flow .blank-page { page:auto; height:var(--tm-page-height); break-after:column; -webkit-column-break-after:always; }
            .tm-smart-flow [data-tm-break-before] { break-before:column !important; -webkit-column-break-before:always !important; }
            .tm-smart-flow [data-tm-break-after] { break-after:column !important; -webkit-column-break-after:always !important; }
            .tm-smart-sheet { position:relative; box-sizing:border-box; width:210mm; height:297mm; background:white; }
            .tm-smart-viewport { position:relative; overflow:hidden; width:var(--tm-page-width); height:var(--tm-page-height); }
            .tm-smart-slice { position:absolute; top:0; visibility:visible; }
            .tm-smart-slice, .tm-smart-slice * { color:#000 !important; -webkit-text-fill-color:#000 !important; }
            .tm-smart-footer { position:absolute; left:0; right:0; bottom:6mm; text-align:center; font:11px SimSun,serif; color:#000; }
            .tm-smart-final-footer { position:absolute; left:20mm; right:20mm; bottom:12mm; text-align:center; white-space:nowrap; font: normal 17px/1.15 SimHei,"Microsoft YaHei",sans-serif; color:#000; }
            body.tm-paged-preview { font-size:var(--tm-live-font-size); line-height:var(--tm-live-line-height); }
            body.tm-paged-preview .chapter-sub-desc { font-size:var(--tm-live-font-size); line-height:var(--tm-live-line-height); }
            body.tm-paged-preview .material-heading { font-size:calc(var(--tm-live-font-size) + 2px); }
            body.tm-paged-preview .material-box p { line-height:var(--tm-live-line-height); }
            body.tm-paged-preview .material-box th, body.tm-paged-preview .material-box td { font-size:calc(var(--tm-live-font-size) - 1px) !important; line-height:var(--tm-live-line-height) !important; }
            body.tm-paged-preview .q-stem { margin-bottom:var(--tm-live-stem-gap); }
            body.tm-paged-preview .q-stem p, body.tm-paged-preview .q-stem div { margin-bottom:var(--tm-live-paragraph-gap) !important; line-height:var(--tm-live-line-height); }
            body.tm-paged-preview .opt-item { line-height:var(--tm-live-line-height); }
            body.tm-paged-preview .options-grid { row-gap:var(--tm-live-option-gap); }
            #tm-render-mask { position:fixed; inset:0; z-index:1000002; display:none; align-items:center; justify-content:center; background:rgba(232,237,245,.56); font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif; }
            body.tm-preview-rendering #tm-render-mask { display:flex; }
            .tm-render-card { display:flex; align-items:center; gap:13px; padding:15px 20px; border:1px solid rgba(148,163,184,.35); border-radius:15px; color:#0f172a; background:rgba(255,255,255,.96); box-shadow:0 18px 50px rgba(15,23,42,.18); }
            .tm-render-card > span:last-child { display:flex; flex-direction:column; gap:2px; }
            .tm-render-card b { font-size:14px; }
            .tm-render-card small { color:#64748b; font-size:11px; }
            .tm-render-spinner { width:22px; height:22px; box-sizing:border-box; border:3px solid #dbeafe; border-top-color:#2563eb; border-radius:50%; animation:tm-render-spin .65s linear infinite; }
            @keyframes tm-render-spin { to { transform:rotate(360deg); } }
            @media screen {
                body.tm-paged-preview { width:100% !important; min-width:210mm; margin:0 !important; background:#e8edf5; }
                #tm-smart-pages { display:flex; flex-direction:column; align-items:center; width:100%; min-width:210mm; }
                .tm-smart-sheet { flex:0 0 auto; margin:20px 0 38px; box-shadow:0 12px 35px rgba(15,23,42,.13); outline:1px solid rgba(148,163,184,.38); }
                .tm-smart-sheet::after { content:'第 ' attr(data-page) ' 页分界'; position:absolute; top:100%; left:0; right:0; height:30px; border-top:2px dashed #3b82f6; text-align:center; color:#2563eb; font:600 12px/28px -apple-system,"Segoe UI","PingFang SC",sans-serif; }
            }
            @media print {
                @page { size:A4; margin:0; }
                body.tm-paged-preview { width:210mm !important; min-width:0 !important; margin:0 !important; padding:0 !important; background:white !important; }
                #tm-smart-source { display:none !important; }
                #tm-render-mask { display:none !important; }
                .tm-smart-sheet { height:296.99mm; margin:0; break-inside:avoid; page-break-inside:avoid; break-after:page; page-break-after:always; }
                .tm-smart-sheet:last-child { break-after:auto; page-break-after:auto; }
                /* iOS Safari 会为系统网址/日期预留打印区；完整 297mm 页面会溢出并追加空白页。
                   仅在 iPhone/iPad 打印时等比收进可打印区，并只保留旧式单一换页指令。 */
                body.tm-ios-print-fix .tm-smart-sheet {
                    height:276mm; margin:0 auto; overflow:hidden;
                    break-after:page !important;
                }
                body.tm-ios-print-fix .tm-smart-sheet:last-child { break-after:auto !important; }
                body.tm-ios-print-fix .tm-smart-viewport {
                    transform:scale(.93); transform-origin:top left;
                }
            }
        `;
        document.head.appendChild(previewStyle);
        flow.querySelectorAll('*').forEach(node => {
            const cs = getComputedStyle(node);
            if (['page', 'always'].includes(cs.breakBefore)) node.dataset.tmBreakBefore = '1';
            if (['page', 'always'].includes(cs.breakAfter)) node.dataset.tmBreakAfter = '1';
        });
        const originals = new Map();
        const visibleImageClones = new Map();
        flow.querySelectorAll('img, .tm-img-handle').forEach((node, index) => {
            node.dataset.tmImageRef = String(index);
            originals.set(String(index), node);
            if (node.tagName === 'IMG') node.scrollIntoView = options => {
                const width = parseFloat(flow.style.width);
                const column = Math.max(0, Math.floor((node.getBoundingClientRect().left - flow.getBoundingClientRect().left) / width));
                if (pages.children[column]) pages.children[column].scrollIntoView(options);
            };
        });
        function syncPreviewImages(onlyRef) {
            originals.forEach((original, ref) => {
                if (original.tagName !== 'IMG') return;
                if (onlyRef !== undefined && ref !== onlyRef) return;
                const clone = visibleImageClones.get(ref);
                if (!clone) return;
                const style = original.getAttribute('style');
                if (style) clone.setAttribute('style', style); else clone.removeAttribute('style');
            });
        }
        // 拖动期间只同步图片尺寸，不重建全部页面；松手后再重新分页。
        function beginPreviewImageResize(event, clientX) {
            const target = closest(event.target, '[data-tm-image-ref]');
            const original = target && originals.get(target.dataset.tmImageRef);
            if (!original || !target.classList.contains('tm-img-handle')) return;
            event.preventDefault();
            clearTimeout(pending);
            pending = 0;
            imageAdjusting = true;
            const previewImg = target.parentElement && target.parentElement.querySelector('img[data-tm-image-ref]');
            const imageRef = previewImg && previewImg.dataset.tmImageRef;
            const onResize = () => syncPreviewImages(imageRef);
            const onEnd = () => {
                imageAdjusting = false;
                syncPreviewImages(imageRef);
                schedule(0);
            };
            if (typeof original._tmStartResize === 'function') original._tmStartResize(clientX, onResize, onEnd);
            else {
                original.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX, clientY:event.clientY || 0, button:0 }));
                const onMove = () => onResize();
                const onUp = () => { document.removeEventListener('mousemove', onMove); onEnd(); };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp, { once:true });
            }
        }
        pages.addEventListener('mousedown', event => beginPreviewImageResize(event, event.clientX));
        pages.addEventListener('touchstart', event => {
            const touch = event.touches && event.touches[0];
            if (touch) beginPreviewImageResize(event, touch.clientX);
        }, { passive:false });
        pages.addEventListener('dblclick', event => {
            const target = closest(event.target, '[data-tm-image-ref]');
            const original = target && originals.get(target.dataset.tmImageRef);
            if (!original) return;
            event.preventDefault();
            original.dispatchEvent(new MouseEvent('dblclick', { bubbles:true, cancelable:true }));
            syncPreviewImages(target.dataset.tmImageRef);
            schedule();
        });

        function readTypography() {
            const fontControl = document.getElementById('tm-font-slider');
            const lineControl = document.getElementById('tm-line-slider');
            const font = Math.min(32, Math.max(10, parseFloat(fontControl && fontControl.value) || initialFontSize || 16));
            const line = Math.min(2.2, Math.max(1.1, parseFloat(lineControl && lineControl.value) || initialLineHeight || 1.5));
            return { font, line };
        }
        function setTypographyVars(target, values) {
            target.style.setProperty('--tm-live-font-size', values.font + 'px');
            target.style.setProperty('--tm-live-line-height', String(values.line));
            target.style.setProperty('--tm-live-stem-gap', values.line + 'px');
            target.style.setProperty('--tm-live-paragraph-gap', (values.line * 3) + 'px');
            target.style.setProperty('--tm-live-option-gap', (values.line * 6) + 'px');
        }
        // 字符数只能给出初始列数；最终要用当前字号、字体和 A4 正文宽度实际测量。
        // 四列放不下一整行时降为两列，两列仍放不下时降为一列，避免字号增大后列数反而增加。
        function adaptTextOptionColumns(root) {
            if (!root || !root.querySelectorAll) return;
            root.querySelectorAll('.options-grid.col-2:not(.img-opt), .options-grid.col-4:not(.img-opt)').forEach(grid => {
                grid.classList.remove('tm-auto-pair', 'tm-auto-single');
                const hasWrappedOption = () => Array.from(grid.children)
                    .filter(item => item.classList && item.classList.contains('opt-item'))
                    .some(item => {
                    const text = item.querySelector('.opt-text');
                    if (!text || !(text.textContent || '').trim()) return false;
                    const style = getComputedStyle(text);
                    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
                    const range = document.createRange();
                    range.selectNodeContents(text);
                    const lines = [];
                    Array.from(range.getClientRects()).forEach(rect => {
                        // 块级 p 自身也会返回一个整块矩形，只保留真实的行内文字盒。
                        if (rect.width < 0.5 || rect.height < 0.5 || rect.height >= lineHeight * 0.98) return;
                        let line = lines.find(entry => Math.abs(entry.top - rect.top) <= 1);
                        if (!line) {
                            line = { top:rect.top, left:rect.left, right:rect.right };
                            lines.push(line);
                        } else {
                            line.left = Math.min(line.left, rect.left);
                            line.right = Math.max(line.right, rect.right);
                        }
                    });
                    if (lines.length) return lines.length > 1;
                    // 少数浏览器不会为 Range 返回逐行矩形，用高度作为保底判断。
                    return text.getBoundingClientRect().height > lineHeight * 1.35;
                });
                if (!hasWrappedOption()) return;
                if (grid.classList.contains('col-4')) {
                    // 四列先降为两列；两列能完整容纳时就保持两列。
                    grid.classList.add('tm-auto-pair');
                    void grid.offsetWidth;
                    if (!hasWrappedOption()) return;
                    grid.classList.remove('tm-auto-pair');
                }
                grid.classList.add('tm-auto-single');
            });
        }
        function updateTypographyValues(values) {
            const fontValue = document.getElementById('tm-font-val');
            const lineValue = document.getElementById('tm-line-val');
            if (fontValue) fontValue.textContent = values.font.toFixed(1).replace(/\.0$/, '') + 'px';
            if (lineValue) lineValue.textContent = values.line.toFixed(2).replace(/0$/, '');
        }
        function applyTypography(previewOnly) {
            const values = readTypography();
            updateTypographyValues(values);
            // 拖动时只更新屏幕内的页片，避免隐藏测量稿和所有 A4 副本一起重排。
            if (previewOnly) {
                Array.from(pages.children).forEach(sheet => {
                    const rect = sheet.getBoundingClientRect();
                    if (rect.bottom >= -80 && rect.top <= window.innerHeight + 80) {
                        const slice = sheet.querySelector('.tm-smart-slice');
                        if (slice) setTypographyVars(slice, values);
                    }
                });
            } else {
                setTypographyVars(flow, values);
                setTypographyVars(document.body, values);
            }
            return values;
        }
        function queueTypographyPreview() {
            updateTypographyValues(readTypography());
            if (typographyPreviewFrame) return;
            const run = () => {
                typographyPreviewFrame = 0;
                applyTypography(true);
            };
            if (window.requestAnimationFrame) typographyPreviewFrame = window.requestAnimationFrame(run);
            else typographyPreviewFrame = setTimeout(run, 16);
        }
        applyTypography(false);

        function setRenderBusy(busy) {
            const wasBusy = document.body.classList.contains('tm-preview-rendering');
            if (busy === wasBusy) return;
            document.body.classList.toggle('tm-preview-rendering', busy);
            renderMask.setAttribute('aria-hidden', busy ? 'false' : 'true');
            const toolbar = document.getElementById('tm-toolbar');
            if (toolbar) toolbar.setAttribute('aria-busy', busy ? 'true' : 'false');
            document.querySelectorAll('#tm-toolbar input, #tm-toolbar button').forEach(control => {
                if (busy) {
                    control.dataset.tmWasDisabled = control.disabled ? '1' : '0';
                    control.disabled = true;
                } else {
                    control.disabled = control.dataset.tmWasDisabled === '1';
                    delete control.dataset.tmWasDisabled;
                }
            });
        }

        function queuePrepareWithFeedback() {
            if (!layoutDirty) return;
            if (preparing || renderFrame || renderJob) {
                rerenderRequested = true;
                return;
            }
            setRenderBusy(true);
            const startedAt = Date.now();
            const execute = () => {
                renderFrame = 0;
                renderJob = setTimeout(() => {
                    renderJob = 0;
                    try {
                        prepare();
                    } finally {
                        const remaining = Math.max(0, 220 - (Date.now() - startedAt));
                        clearTimeout(renderEndTimer);
                        renderEndTimer = setTimeout(() => {
                            renderEndTimer = 0;
                            const release = () => {
                                setRenderBusy(false);
                                if (rerenderRequested) {
                                    rerenderRequested = false;
                                    schedule(0);
                                }
                            };
                            if (window.requestAnimationFrame) window.requestAnimationFrame(release);
                            else release();
                        }, remaining);
                    }
                }, 0);
            };
            if (window.requestAnimationFrame) renderFrame = window.requestAnimationFrame(execute);
            else execute();
        }

        function renderPages(width, height, padding) {
            flow.style.height = height + 'px';
            flow.style.columnWidth = width + 'px';
            const count = Math.max(1, Math.ceil((flow.scrollWidth - 1) / width));
            const fragment = document.createDocumentFragment();
            const hasCover = !!flow.querySelector('.cover-page');
            for (let i = 0; i < count; i++) {
                const sheet = document.createElement('div');
                sheet.className = 'tm-smart-sheet';
                sheet.dataset.page = String(i + 1);
                sheet.style.padding = padding;
                const viewport = document.createElement('div');
                viewport.className = 'tm-smart-viewport';
                const slice = flow.cloneNode(true);
                slice.removeAttribute('id');
                slice.classList.add('tm-smart-slice');
                slice.style.left = (-i * width) + 'px';
                slice.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
                // 工具栏只操作原图，避免每张切片重复执行缩放。
                slice.querySelectorAll('[data-nat-w]').forEach(node => node.removeAttribute('data-nat-w'));
                viewport.appendChild(slice);
                sheet.appendChild(viewport);
                if (!hasCover || i >= 2) {
                    const footer = document.createElement('div');
                    footer.className = 'tm-smart-footer';
                    footer.textContent = '第 ' + (hasCover ? i - 1 : i + 1) + ' 页 / 共 ' + (hasCover ? count - 2 : count) + ' 页';
                    sheet.appendChild(footer);
                }
                if (i === finalDividerFooterPage) {
                    const finalLine = document.createElement('div');
                    finalLine.className = 'tm-smart-final-footer';
                    finalLine.textContent = finalDividerFooterText;
                    sheet.appendChild(finalLine);
                }
                fragment.appendChild(sheet);
            }
            replaceChildren(pages, [fragment]);
            pages.dataset.pageCount = String(count);
            const pageCount = document.getElementById('tm-page-count');
            if (pageCount) pageCount.textContent = count + ' 页';
            visibleImageClones.clear();
            pages.querySelectorAll('.tm-smart-sheet').forEach(sheet => {
                const viewport = sheet.querySelector('.tm-smart-viewport').getBoundingClientRect();
                sheet.querySelectorAll('img[data-tm-image-ref]').forEach(img => {
                    const rect = img.getBoundingClientRect();
                    if (rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1 && rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1) {
                        visibleImageClones.set(img.dataset.tmImageRef, img);
                    }
                });
            });
        }

        function protectInlineChapterFirstQuestions(width, height) {
            const headings = Array.from(flow.querySelectorAll('.chapter-title-box.tm-inline-chapter'));
            if (!headings.length) return;
            const flowLeft = flow.getBoundingClientRect().left;
            const flowTop = flow.getBoundingClientRect().top;
            const colOf = rect => Math.max(0, Math.floor((rect.left - flowLeft + 1) / width));
            const candidates = headings.map(heading => {
                delete heading.dataset.tmBreakBefore;
                const firstBlock = heading.nextElementSibling;
                const isQuestion = !!firstBlock?.classList.contains('q-wrapper');
                const isMaterial = !!firstBlock?.classList.contains('material-box');
                return { heading, firstBlock: isQuestion || isMaterial ? firstBlock : null, isQuestion, isMaterial,
                    blockHeight: isQuestion || isMaterial ? firstBlock.getBoundingClientRect().height : 0 };
            });
            flow.style.height = height + 'px';
            flow.style.columnWidth = width + 'px';
            for (const { heading, firstBlock, isQuestion, isMaterial, blockHeight } of candidates) {
                if (!firstBlock) continue;
                const range = document.createRange();
                range.selectNodeContents(firstBlock);
                const columns = new Set(Array.from(range.getClientRects())
                    .filter(rect => rect.width > 1 && rect.height > 1).map(colOf));
                if (!columns.size) columns.add(colOf(firstBlock.getBoundingClientRect()));
                const headingColumn = colOf(heading.getBoundingClientRect());
                // 能容纳在单页的首题不能只露出一部分；标题也不单独留在上一页。
                const questionSplit = isQuestion && blockHeight < height - 2 && columns.size > 1;
                // 材料先行的模块按首份材料判断：能整块放入一页时不截断；超长材料至少留四行起始内容。
                const remaining = height - (heading.getBoundingClientRect().bottom - flowTop);
                const line = parseFloat(getComputedStyle(heading).lineHeight) || parseFloat(getComputedStyle(heading).fontSize) * 1.5;
                const materialSplit = isMaterial && ((blockHeight < height - 2 && blockHeight + 8 > remaining)
                    || (blockHeight >= height - 2 && remaining < line * 4));
                if (questionSplit || materialSplit || !columns.has(headingColumn)) {
                    heading.dataset.tmBreakBefore = '1';
                }
            }
        }

        function avoidIsolatedFinalDivider(width) {
            const divider = flow.querySelector('.tm-module-divider-final');
            finalDividerFooterPage = -1;
            finalDividerFooterText = '';
            if (!divider || divider.parentElement !== flow) return;
            divider.style.removeProperty('display');
            const previous = divider.previousElementSibling;
            // 结束语绝不能成为下一页第一行。若正文放不下，改放在最后一题所在页的页码上方。
            if (!previous) return;
            const left = flow.getBoundingClientRect().left;
            const column = rect => Math.max(0, Math.floor((rect.left - left + 1) / width));
            const range = document.createRange();
            range.selectNodeContents(previous);
            const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 1 && rect.height > 1);
            const previousColumn = rects.length ? Math.max(...rects.map(column)) : column(previous.getBoundingClientRect());
            if (column(divider.getBoundingClientRect()) > previousColumn) {
                finalDividerFooterPage = previousColumn;
                finalDividerFooterText = divider.textContent.trim();
                divider.style.display = 'none';
            }
        }

        function prepare() {
            if (preparing) return;
            preparing = true;
            const body = document.body;
            const oldWidth = body.style.getPropertyValue('width');
            const oldPriority = body.style.getPropertyPriority('width');
            const probe = document.createElement('div');
            try {
                applyTypography(false);
                flow.style.setProperty('display', 'block', 'important');
                // CSS 自己解析 mm 和 1~4 值页边距，不按屏幕宽度或固定像素估算行数。
                probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;box-sizing:border-box;width:210mm;height:297mm;';
                probe.style.padding = pageMargin;
                body.appendChild(probe);
                const paper = probe.getBoundingClientRect();
                const margins = getComputedStyle(probe);
                const width = paper.width - parseFloat(margins.paddingLeft) - parseFloat(margins.paddingRight);
                const height = paper.height - parseFloat(margins.paddingTop) - parseFloat(margins.paddingBottom);
                if (!(width > 0 && height > 0)) return;
                document.body.style.setProperty('--tm-page-width', width + 'px');
                document.body.style.setProperty('--tm-page-height', height + 'px');
                flow.style.width = width + 'px';
                flow.style.height = 'auto';
                flow.style.columnWidth = 'auto';
                body.style.setProperty('--tm-smart-width', width + 'px');
                body.style.setProperty('width', width + 'px', 'important');

                // 每次从原节点重建，保留图片拖拽事件；反复打印不会嵌套包装或复制选项。
                if (isSmart) states.forEach(({ question, stem, options, items, opening }) => {
                    question.classList.remove('keep');
                    if (stem) {
                        stem.classList.remove('tm-smart-link-next');
                        if (opening) question.insertBefore(stem, opening);
                    }
                    if (options) {
                        options.classList.remove('tm-smart-options', 'tm-smart-continuation');
                        items.forEach(item => item.classList.remove('tm-smart-long-option'));
                        replaceChildren(options, items);
                        if (opening) question.insertBefore(options, opening);
                    }
                    if (opening) opening.remove();
                });
                adaptTextOptionColumns(flow);
                if (isSmart) states.forEach(state => {
                    const { question, stem, options, items } = state;
                    state.opening = null;
                    if (!stem) return;
                    const style = getComputedStyle(stem);
                    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
                    const stemHeight = stem.getBoundingClientRect().height;
                    const rows = [];
                    if (options && items.length) {
                        const optionStyle = getComputedStyle(options);
                        const gap = optionStyle.rowGap === 'normal' ? '0px' : optionStyle.rowGap;
                        const columnGap = optionStyle.columnGap === 'normal' ? '0px' : optionStyle.columnGap;
                        // 按实际排版后的纵坐标分行，兼容一列、两列、四列及图片选项。
                        items.forEach(item => {
                            const rect = item.getBoundingClientRect();
                            let row = rows[rows.length - 1];
                            if (!row || Math.abs(row.top - rect.top) > 1) {
                                row = { top: rect.top, items: [], widths: [], height: 0 };
                                rows.push(row);
                            }
                            row.items.push(item);
                            row.widths.push(rect.width + 'px');
                            row.height = Math.max(row.height, rect.height);
                        });
                        options.classList.add('tm-smart-options');
                        options.style.setProperty('--tm-smart-row-gap', gap);
                        rows.forEach(row => {
                            const wrapper = document.createElement('div');
                            wrapper.className = 'tm-smart-row';
                            wrapper.style.setProperty('--tm-smart-columns', row.widths.join(' '));
                            wrapper.style.setProperty('--tm-smart-column-gap', columnGap);
                            if (row.height > height - 1) {
                                wrapper.classList.add('tm-smart-long-row');
                                row.items.forEach(item => {
                                    if (item.getBoundingClientRect().height > height - 1) item.classList.add('tm-smart-long-option');
                                });
                            }
                            row.items.forEach(item => wrapper.appendChild(item));
                            options.appendChild(wrapper);
                            row.node = wrapper;
                        });
                    }

                    // 只有整题确实很短才整题保留：最多六行高度，且不超过正文页的 18%。
                    if (question.getBoundingClientRect().height <= Math.min(line * 6, height * 0.18)) {
                        question.classList.add('keep');
                        return;
                    }
                    // 长题干交给原生 orphans:4 / widows:2；不把整道长题锁在一起。
                    if (stemHeight >= line * 4 - 1 || !rows.length) return;

                    // 短题干只绑定足够的前几行选项，余下选项独立流动。
                    // 不把题距/选项间距计入四行，避免两行文字加空隙被误认为足够。
                    let contentHeight = stemHeight;
                    const headRows = [];
                    for (const row of rows) {
                        headRows.push(row);
                        contentHeight += row.height;
                        if (contentHeight >= line * 4 - 1) break;
                    }
                    const opening = document.createElement('div');
                    opening.className = 'tm-smart-opening';
                    question.insertBefore(opening, stem);
                    opening.appendChild(stem);
                    const headOptions = options.cloneNode(false);
                    headOptions.removeAttribute('id');
                    headRows.forEach(row => headOptions.appendChild(row.node));
                    opening.appendChild(headOptions);
                    state.opening = opening;
                    if (options.children.length) options.classList.add('tm-smart-continuation');
                    // 极大字号/超长单选项：开头本身超页时释放约束，保证内容能继续分页。
                    if (opening.getBoundingClientRect().height > height - 1) {
                        question.insertBefore(stem, opening);
                        headRows.slice().reverse().forEach(row => options.insertBefore(row.node, options.firstChild));
                        options.classList.remove('tm-smart-continuation');
                        opening.remove();
                        state.opening = null;
                        stem.classList.add('tm-smart-link-next');
                    }
                });
                protectInlineChapterFirstQuestions(width, height);
                avoidIsolatedFinalDivider(width);
                renderPages(width, height, pageMargin);
                layoutDirty = false;
            } finally {
                flow.style.removeProperty('display');
                probe.remove();
                if (oldWidth) body.style.setProperty('width', oldWidth, oldPriority);
                else body.style.removeProperty('width');
                preparing = false;
            }
        }
        function schedule(delay) {
            layoutDirty = true;
            if (imageAdjusting || typographyAdjusting) return;
            clearTimeout(pending);
            pending = setTimeout(() => {
                pending = 0;
                if (!imageAdjusting && !typographyAdjusting) queuePrepareWithFeedback();
            }, typeof delay === 'number' ? delay : 120);
        }
        function flush() {
            clearTimeout(pending);
            pending = 0;
            if (renderFrame && window.cancelAnimationFrame) window.cancelAnimationFrame(renderFrame);
            clearTimeout(renderJob);
            clearTimeout(renderEndTimer);
            renderFrame = 0;
            renderJob = 0;
            renderEndTimer = 0;
            rerenderRequested = false;
            setRenderBusy(false);
            if (layoutDirty) prepare();
        }
        prepare();
        // setup 在 load 后执行；字体若已经就绪，不再无条件进行第二次整份分页。
        if (document.fonts && document.fonts.ready && document.fonts.status !== 'loaded') document.fonts.ready.then(() => schedule(0));
        // 覆盖保存 PDF、Ctrl+P、重复打印及调整图片后重新打印。
        // 打印使用最后一次可见预览；有尚未完成的图片更新时同步刷新一次。
        window.tmPreparePagedPreview = flush;
        window.addEventListener('beforeprint', flush);
        window.addEventListener('resize', () => schedule(180));
        document.addEventListener('load', event => { if (event.target.tagName === 'IMG' && flow.contains(event.target)) schedule(80); }, true);
        const imageSlider = document.getElementById('tm-img-slider');
        const fontSlider = document.getElementById('tm-font-slider');
        const lineSlider = document.getElementById('tm-line-slider');
        function startImageSlider() {
            clearTimeout(pending);
            pending = 0;
            imageSliderAdjusting = true;
            imageAdjusting = true;
        }
        function finishImageSlider() {
            if (!imageSliderAdjusting) return;
            imageSliderAdjusting = false;
            imageAdjusting = false;
            syncPreviewImages();
            schedule(0);
        }
        function startTypography() {
            typographyAdjusting = true;
            clearTimeout(pending);
            pending = 0;
        }
        function finishTypography() {
            if (!typographyAdjusting) return;
            typographyAdjusting = false;
            if (typographyPreviewFrame) {
                if (window.cancelAnimationFrame) window.cancelAnimationFrame(typographyPreviewFrame);
                else clearTimeout(typographyPreviewFrame);
                typographyPreviewFrame = 0;
                applyTypography(true);
            }
            schedule(0);
        }
        const supportsPointer = 'PointerEvent' in window;
        if (imageSlider) {
            imageSlider.addEventListener(supportsPointer ? 'pointerdown' : 'mousedown', startImageSlider);
            if (!supportsPointer) imageSlider.addEventListener('touchstart', startImageSlider, { passive:true });
        }
        [fontSlider, lineSlider].forEach(control => {
            if (!control) return;
            control.addEventListener(supportsPointer ? 'pointerdown' : 'mousedown', startTypography);
            if (!supportsPointer) control.addEventListener('touchstart', startTypography, { passive:true });
            control.addEventListener('input', () => {
                layoutDirty = true;
                queueTypographyPreview();
                if (!typographyAdjusting) schedule(90);
            });
        });
        if (supportsPointer) {
            document.addEventListener('pointerup', () => { finishImageSlider(); finishTypography(); });
            document.addEventListener('pointercancel', () => { finishImageSlider(); finishTypography(); });
        } else {
            document.addEventListener('mouseup', () => { finishImageSlider(); finishTypography(); });
            document.addEventListener('touchend', () => { finishImageSlider(); finishTypography(); });
            document.addEventListener('touchcancel', () => { finishImageSlider(); finishTypography(); });
        }
        document.addEventListener('input', event => {
            if (event.target.id === 'tm-img-slider') {
                layoutDirty = true;
                syncPreviewImages();
                if (!imageAdjusting) schedule(90);
            }
        });
        document.addEventListener('click', event => {
            const stepButton = closest(event.target, '[data-tm-step]');
            if (stepButton) {
                const control = document.getElementById(stepButton.getAttribute('data-tm-target'));
                if (control) {
                    const direction = parseFloat(stepButton.getAttribute('data-tm-step')) || 0;
                    const step = parseFloat(control.step) || 1;
                    const min = parseFloat(control.min);
                    const max = parseFloat(control.max);
                    let value = (parseFloat(control.value) || 0) + direction * step;
                    if (!Number.isNaN(min)) value = Math.max(min, value);
                    if (!Number.isNaN(max)) value = Math.min(max, value);
                    control.value = String(Math.round(value * 100) / 100);
                    control.dispatchEvent(new Event('input', { bubbles:true }));
                    schedule(40);
                }
            }
            if (event.target.id === 'tm-img-reset') schedule(40);
            if (event.target.id === 'tm-layout-reset') {
                if (fontSlider) fontSlider.value = String(initialFontSize || 16);
                if (lineSlider) lineSlider.value = String(initialLineHeight || 1.5);
                applyTypography(true);
                schedule(0);
            }
        });
        if (window.MutationObserver) {
            const imageObserver = new MutationObserver(() => { if (!imageAdjusting) schedule(100); });
            flow.querySelectorAll('img').forEach(img => imageObserver.observe(img, { attributes:true, attributeFilter:['style', 'src'] }));
        }
        const hint = document.querySelector('.tm-tb-hint');
        if (hint) hint.textContent = '拖动时流畅预览，松手后锁定片刻并重新分页；打印请用 A4、100% 缩放、无边距并关闭页眉页脚。';
    }

    // ============ 自选题目导出：勾选界面 + 板块识别 + 过滤计划 ============
    // 与「提取试卷并打印」共用同一条提取/排版链路，只在拼装 newPaperHtml 前插入一次勾选过滤。
    // 原则：最小侵入，不改写原有 items / buildHtml 架构，也不改动原有按钮与参数。
    const TM_PICK_BOARDS = ['言语理解与表达', '判断推理', '资料分析'];  // 「只导出三大块」按板块名过滤，禁止按题号硬编码

    // 常见板块别名 → 标准名（顺序即优先级）
    const TM_BOARD_ALIASES = [
        { name: '政治理论', keys: ['政治理论', '政治常识', '时政', '政治'] },
        { name: '常识判断', keys: ['常识判断', '常识'] },
        { name: '言语理解与表达', keys: ['言语理解与表达', '言语理解', '言语'] },
        { name: '数量关系', keys: ['数量关系', '数量'] },
        { name: '判断推理', keys: ['判断推理', '判断'] },
        { name: '资料分析', keys: ['资料分析', '资料'] }
    ];

    function tmNormalizeBoardName(raw) {
        const s = String(raw == null ? '' : raw).replace(/[\s\u3000]+/g, '');
        if (!s) return '';
        for (const item of TM_BOARD_ALIASES) {
            for (const key of item.keys) if (s.includes(key)) return item.name;
        }
        return '';
    }

    function tmEsc(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 元素 → 题目纯文本摘要（图片占位［图］），只用于勾选列表展示
    function tmStemSummary(container, max) {
        if (!container) return '（未取到题干）';
        const holder = document.createElement('div');
        holder.innerHTML = container.innerHTML || '';
        holder.querySelectorAll('img').forEach((img) => {
            if (img.parentNode) img.parentNode.replaceChild(document.createTextNode('［图］'), img);
        });
        let text = (holder.textContent || '').replace(/[\s\u00a0\u3000]+/g, ' ').trim();
        if (!text) text = '［图］';
        if (max > 0 && text.length > max) text = text.slice(0, max) + '…';
        return text;
    }

    // 题号范围解析：支持「1-10,15,20-25」，分隔符与区间符宽容
    function tmParseRangeSpec(str) {
        const out = new Set();
        String(str == null ? '' : str).split(/[,，;；、\s]+/).forEach((seg) => {
            if (!seg) return;
            const m = seg.match(/^(\d+)\s*[-~—～至到]\s*(\d+)$/);
            if (m) {
                let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
                if (a > b) { const t = a; a = b; b = t; }
                if (b - a > 500) b = a + 500;
                for (let i = a; i <= b; i++) out.add(i);
                return;
            }
            const n = parseInt(seg, 10);
            if (isFinite(n) && n > 0) out.add(n);
        });
        return out;
    }

    // 扫描 elements，生成「题目清单 + 元素类型 + 板块」计划（供勾选界面与过滤共用）
    function tmBuildPickPlan(elements, isEssayLike, isLocalPractice, stemOf) {
        const nodes = Array.from(elements);
        const items = nodes.map(() => ({ kind: 'other', name: '' }));
        const questions = [];
        nodes.forEach((el, i) => {
            if (!el || !el.classList) return;
            const tag = (el.tagName || '').toLowerCase();
            if (el.classList.contains('chapter-container')) {
                items[i].kind = 'chapter';
                const nameNode = el.querySelector('.chapter-name');
                items[i].name = nameNode ? (nameNode.innerText || '').trim() : '';
                return;
            }
            if (tag === 'app-materials' || el.classList.contains('material') || el.classList.contains('material-content')) {
                // 与主流程保持一致：嵌套在 app-materials / .material 内部的子材料会被主流程直接跳过，这里同样不计入材料区间
                const nested = (el.classList.contains('material-content') && (el.closest('app-materials') || el.closest('.material')))
                    || (el.classList.contains('material') && el.closest('app-materials'));
                items[i].kind = nested ? 'other' : 'material';
                return;
            }
            if (tag === 'app-ti' || tag === 'fb-local-question') {
                items[i].kind = 'question';
                const isLocal = tag === 'fb-local-question';
                const numNode = isLocal ? el.querySelector('.options-title') : el.querySelector('.title-index');
                const num = numNode ? (numNode.innerText || '').replace(/\s+/g, ' ').trim() : '';
                const cat = el.getAttribute('data-category') || el.getAttribute('data-cat') || el.getAttribute('category') || '';
                let stem = '';
                try { stem = tmStemSummary(stemOf ? stemOf(el) : null, 110); } catch (_) { stem = '（未取到题干）'; }
                questions.push({ i, seq: 0, num, cat: String(cat || '').trim(), text: stem });
            }
        });
        questions.forEach((q, idx) => { q.seq = idx + 1; });
        const plan = { items, questions, boards: [], isEssayLike: !!isEssayLike, isLocalPractice: !!isLocalPractice };
        plan.boards = tmDetectBoards(plan);
        return plan;
    }

    // 板块识别：优先按章节名归一，无章节时按题目自带的 cat 归一分组；返回 [{name, idxs, lo, hi}]
    function tmDetectBoards(plan) {
        if (plan.isEssayLike) return [];
        const items = plan.items;
        const seqOf = new Map();
        plan.questions.forEach(q => seqOf.set(q.i, q.seq));
        const boards = [];
        const chapterIdx = [];
        items.forEach((it, i) => { if (it.kind === 'chapter') chapterIdx.push(i); });

        if (chapterIdx.length) {
            chapterIdx.forEach((ci, k) => {
                const end = k + 1 < chapterIdx.length ? chapterIdx[k + 1] : items.length;
                const idxs = [];
                for (let j = ci + 1; j < end; j++) if (items[j].kind === 'question') idxs.push(j);
                if (!idxs.length) return;
                const raw = items[ci].name || '';
                const name = tmNormalizeBoardName(raw) || raw || ('板块 ' + (boards.length + 1));
                const seqs = idxs.map(i => seqOf.get(i)).filter(n => typeof n === 'number');
                boards.push({ name, idxs, lo: seqs.length ? Math.min(...seqs) : 0, hi: seqs.length ? Math.max(...seqs) : 0 });
            });
            return boards;
        }

        // 无章节兜底：仅按题目自带的板块属性归并；识别不出名称时不造板块（不报错，交由范围框勾选）
        const buckets = new Map();
        plan.questions.forEach((q) => {
            const name = tmNormalizeBoardName(q.cat);
            if (!name) return;
            if (!buckets.has(name)) buckets.set(name, []);
            buckets.get(name).push(q);
        });
        buckets.forEach((list, name) => {
            const seqs = list.map(q => q.seq);
            boards.push({ name, idxs: list.map(q => q.i), lo: Math.min(...seqs), hi: Math.max(...seqs) });
        });
        return boards;
    }

    // 勾选界面：返回 { sel:Set<元素下标>, cover, material, count }，取消返回 null
    function openTmPickUI(plan, defaults) {
        return new Promise((resolve) => {
            const total = plan.questions.length;
            const sel = new Set(plan.questions.map(q => q.i));
            const old = document.getElementById('tm-pickui');
            if (old) old.remove();

            const overlay = document.createElement('div');
            overlay.id = 'tm-pickui';
            overlay.className = 'tm-pickui';
            overlay.innerHTML = `
                <div class="tm-pick-box">
                    <div class="tm-pick-head">
                        <div class="tm-pick-brand">自选题目导出<span class="tm-pick-sub">共扫描到 ${total} 题（默认全选）</span></div>
                        <span class="tm-pick-x" id="tm-pick-x" title="关闭">×</span>
                    </div>
                    <div style="text-align:left;padding:6px 16px 8px;font-size:13px;line-height:1.6;color:#2563eb;">
                        排版功能由<strong style="font-style:italic;font-weight:bold;color:#f59e0b;">行测小助理</strong>提供<br>
                        自选题目导出功能由<strong style="font-style:italic;font-weight:bold;color:#f59e0b;">粉笔脚本君</strong>提供
                    </div>
                    <div class="tm-pick-bar">
                        <button type="button" class="tm-pick-batch" data-act="all">全选</button>
                        <button type="button" class="tm-pick-batch" data-act="none">全不选</button>
                        <button type="button" class="tm-pick-batch" data-act="invert">反选</button>
                        <button type="button" class="tm-pick-batch-orange" data-act="three">只导出三大块</button>
                        <input type="text" class="tm-pick-range" id="tm-pick-range" placeholder="题号范围，如 1-10,15,20-25">
                        <button type="button" class="tm-pick-batch" data-act="range">按范围勾选</button>
                        <span class="tm-pick-cnt" id="tm-pick-cnt"></span>
                    </div>
                    <div class="tm-pick-boards" id="tm-pick-boards"></div>
                    <div class="tm-pick-list" id="tm-pick-list"></div>
                    <div class="tm-pick-foot">
                        <div class="tm-pick-opts">
                            <label><input type="checkbox" id="tm-pick-cover"> 封面页</label>
                            <label><input type="checkbox" id="tm-pick-material" checked> 材料</label>
                        </div>
                        <div class="tm-pick-hint">「只导出三大块」= 先全不选，再勾选 <b>言语理解与表达 / 判断推理 / 资料分析</b>（按板块名过滤，不依赖题号）；未识别到板块时请用范围框勾选。范围框按列表顺序序号匹配。源脚本无独立「参考答案」开关，故此处不提供该项。</div>
                        <div class="tm-pick-btns">
                            <button type="button" class="tm-pick-ok" id="tm-pick-ok">确定，生成预览</button>
                            <button type="button" class="tm-pick-cancel" id="tm-pick-cancel">取消</button>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            requestAnimationFrame(() => overlay.classList.add('show'));

            const listEl = overlay.querySelector('#tm-pick-list');
            const boardsEl = overlay.querySelector('#tm-pick-boards');
            const cntEl = overlay.querySelector('#tm-pick-cnt');
            const rangeEl = overlay.querySelector('#tm-pick-range');
            const coverCb = overlay.querySelector('#tm-pick-cover');
            const materialCb = overlay.querySelector('#tm-pick-material');
            const okBtn = overlay.querySelector('#tm-pick-ok');
            coverCb.checked = !!(defaults && defaults.cover);
            materialCb.checked = !(defaults && defaults.material === false);

            // 单题列表
            const cbAt = new Map();   // 元素下标 -> 单题复选框
            plan.questions.forEach((q) => {
                const row = document.createElement('label');
                row.className = 'tm-pick-item';
                row.innerHTML = '<input type="checkbox" checked>'
                    + '<span class="tm-pick-seq">' + q.seq + '.</span>'
                    + (q.num ? '<span class="tm-pick-no">原题号 ' + tmEsc(q.num) + '</span>' : '')
                    + '<span class="tm-pick-txt">' + tmEsc(q.text) + '</span>';
                const cb = row.querySelector('input');
                cb.addEventListener('change', syncAll);
                cbAt.set(q.i, cb);
                listEl.appendChild(row);
            });
            if (!total) {
                const empty = document.createElement('div');
                empty.className = 'tm-pick-empty';
                empty.textContent = '未扫描到题目，请确认当前页面是否为试卷作答页。';
                listEl.appendChild(empty);
            }

            // 板块区（批量按钮行下方，与单题勾选双向同步）
            const boardCbs = [];
            if (plan.boards.length) {
                boardsEl.innerHTML = '<span class="tm-pick-boards-tt">板块快捷勾选</span>';
                plan.boards.forEach((b) => {
                    const wrap = document.createElement('label');
                    wrap.className = 'tm-pick-board';
                    const rangeTxt = (b.lo && b.hi) ? (b.lo === b.hi ? String(b.lo) : b.lo + '-' + b.hi) : '';
                    wrap.innerHTML = '<input type="checkbox"><span class="tm-pick-board-nm">' + tmEsc(b.name) + '</span>'
                        + (rangeTxt ? '<span class="tm-pick-board-rg">' + rangeTxt + '</span>' : '');
                    const cb = wrap.querySelector('input');
                    const bs = { board: b, cb, on: 0, total: b.idxs.length };
                    // 注意：不可依赖 cb.checked / cb.indeterminate 判断点击后意图——
                    // 浏览器对 checkbox 的预激活行为会先翻转 checked 并清空 indeterminate。
                    // 这里只依据 syncAll 维护的受选计数 bs.on 决定：整块已全选→取消，否则→全选。
                    cb.addEventListener('click', () => {
                        const to = bs.on >= bs.total ? false : true;
                        b.idxs.forEach((i) => { const qcb = cbAt.get(i); if (qcb) qcb.checked = to; });
                        syncAll();
                    });
                    boardCbs.push(bs);
                    boardsEl.appendChild(wrap);
                });
            } else {
                boardsEl.innerHTML = '<span class="tm-pick-boards-hint">未识别到板块，请用范围框勾选</span>';
            }

            function syncAll() {
                boardCbs.forEach((bs) => {
                    const board = bs.board, cb = bs.cb;
                    let on = 0;
                    board.idxs.forEach((i) => { const qcb = cbAt.get(i); if (qcb && qcb.checked) on++; });
                    bs.on = on;
                    cb.checked = on > 0 && on === board.idxs.length;
                    cb.indeterminate = on > 0 && on < board.idxs.length;
                });
                sel.clear();
                cbAt.forEach((cb, i) => { if (cb.checked) sel.add(i); });
                cntEl.textContent = '已选 ' + sel.size + ' / ' + total + ' 题';
                const none = sel.size === 0;
                okBtn.disabled = none;
                okBtn.style.opacity = none ? '0.55' : '1';
                okBtn.style.cursor = none ? 'not-allowed' : 'pointer';
            }

            function setAll(val) { cbAt.forEach((cb) => { cb.checked = val; }); syncAll(); }

            overlay.querySelectorAll('[data-act]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const act = btn.dataset.act;
                    if (act === 'all') { setAll(true); return; }
                    if (act === 'none') { setAll(false); return; }
                    if (act === 'invert') { cbAt.forEach((cb) => { cb.checked = !cb.checked; }); syncAll(); return; }
                    if (act === 'three') {
                        cbAt.forEach((cb) => { cb.checked = false; });
                        let hit = 0;
                        plan.boards.forEach((b) => {
                            if (!TM_PICK_BOARDS.includes(b.name)) return;
                            hit++;
                            b.idxs.forEach((i) => { const qcb = cbAt.get(i); if (qcb) qcb.checked = true; });
                        });
                        syncAll();
                        if (!hit) alert('未识别到「言语理解与表达 / 判断推理 / 资料分析」板块，请改用范围框勾选。');
                        return;
                    }
                    if (act === 'range') {
                        const spec = tmParseRangeSpec(rangeEl.value);
                        if (!spec.size) { alert('请先填写题号范围，例如 1-10,15,20-25'); return; }
                        let hit = 0;
                        plan.questions.forEach((q) => {
                            if (!spec.has(q.seq)) return;
                            const qcb = cbAt.get(q.i);
                            if (qcb) { qcb.checked = true; hit++; }
                        });
                        syncAll();
                        if (!hit) alert('范围框内的题号没有匹配到题目（范围按列表顺序序号计算）。');
                    }
                });
            });

            let done = false;
            function close(result) {
                if (done) return;
                done = true;
                overlay.classList.remove('show');
                setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 150);
                document.removeEventListener('keydown', onKey, true);
                resolve(result);
            }
            function onKey(e) {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                close(null);
            }
            document.addEventListener('keydown', onKey, true);

            okBtn.addEventListener('click', () => {
                if (!sel.size) { alert('请至少勾选一道题目。'); return; }
                // 关键：在这一刻（真实的用户点击手势内）同步打开预览标签页。
                // 勾选期间全程不预开窗口，所以用户不会被切走；此处开窗仍处于用户手势中，不会被弹窗拦截。
                let previewWin = null;
                try {
                    if (defaults && typeof defaults.openPreview === 'function') previewWin = defaults.openPreview();
                } catch (_) { previewWin = null; }
                close({ sel: new Set(sel), count: sel.size, cover: coverCb.checked, material: materialCb.checked, win: previewWin });
            });
            overlay.querySelector('#tm-pick-cancel').addEventListener('click', () => close(null));
            overlay.querySelector('#tm-pick-x').addEventListener('click', () => close(null));

            syncAll();
        });
    }

    // 依据勾选结果计算「需要跳过」的 elements 下标集合
    //  · 题目：未勾选 → 跳过
    //  · 材料：行测按「该材料之后、下一份材料/章节之前」的区间归属，区间内有被选题才保留；
    //          申论/综应材料为整卷共用、无法归属到单题，有被选题时整包保留
    //  · 章节：其区间内已无任何保留的题目/材料时跳过
    function tmComputePickSkip(plan, sel, includeMaterial) {
        const items = plan.items;
        const skip = new Set();
        let picked = 0;
        items.forEach((it, i) => {
            if (it.kind !== 'question') return;
            if (sel.has(i)) picked++; else skip.add(i);
        });
        items.forEach((it, i) => {
            if (it.kind !== 'material') return;
            if (!includeMaterial) { skip.add(i); return; }
            if (plan.isEssayLike) { if (!picked) skip.add(i); return; }
            let keep = false;
            for (let j = i + 1; j < items.length; j++) {
                const kind = items[j].kind;
                if (kind === 'material' || kind === 'chapter') break;
                if (kind === 'question' && sel.has(j)) { keep = true; break; }
            }
            if (!keep) skip.add(i);
        });
        const chapterIdx = [];
        items.forEach((it, i) => { if (it.kind === 'chapter') chapterIdx.push(i); });
        chapterIdx.forEach((ci, k) => {
            const end = k + 1 < chapterIdx.length ? chapterIdx[k + 1] : items.length;
            let keep = false;
            for (let j = ci + 1; j < end; j++) {
                const kind = items[j].kind;
                if ((kind === 'question' || kind === 'material') && !skip.has(j)) { keep = true; break; }
            }
            if (!keep) skip.add(ci);
        });
        return skip;
    }

    async function extractAndBuild(hasCover, coverTitle, pageMargin, fontSize, spacing, reservedWin, pickMode) {
        // 计时器优先挂到「当前处于前台」的窗口：自选导出时原题页在前台、预览窗口在后台，
        // 用前台窗口的计时器可避开 Edge 对后台页面的定时器节流；选完题目后前台切到预览页，再改用预览页。
        const sleep = (ms) => new Promise(resolve => {
            const sourceFocused = typeof document.hasFocus === 'function' && document.hasFocus();
            let activeTimerHost;
            if (sourceFocused) activeTimerHost = window;
            else if (reservedWin && !reservedWin.closed && typeof reservedWin.setTimeout === 'function') activeTimerHost = reservedWin;
            else activeTimerHost = window;
            try { activeTimerHost.setTimeout(resolve, ms); } catch (_) { setTimeout(resolve, ms); }
        });

        // 分页策略/图片缩放/悬挂缩进/题目间距：Pro 可调；免费版固定参数
        let paginationMode = (document.getElementById('tm-pagination')?.value || 'smart');
        const moduleNewPage = !!document.getElementById('tm-module-new-page')?.checked;
        const hideGuangdongJudgement = isGuangdongSourcePaper() && !!document.getElementById('tm-guangdong-hide-judgement')?.checked;
        let figScale = Math.min(100, Math.max(20, parseInt(document.getElementById('tm-figScale')?.value, 10) || 60));
        let hangOn = !!(document.getElementById('tm-indent')?.checked);
        let lineHeight = Math.min(2.2, Math.max(1.1, parseFloat(document.getElementById('tm-lineHeight')?.value) || 1.5));
        if (!currentPro) {
            paginationMode = 'ultra';   // 免费版固定：紧密排列
            figScale = 70;              // 免费版固定：图片缩放 70%
            hangOn = false;             // 免费版固定：非悬挂缩进
        }
        const pagClass = 'pag-' + paginationMode;
        // 正文字体：按面板选择映射完整回退链（仿宋/仿宋_GB2312 等，缺失自动回退宋体）
        const FONT_MAP = {
            simsun: '"SimSun","宋体","STSong","Songti SC","Noto Serif CJK SC",serif',
            fangsong: '"FangSong","仿宋","STFangsong","华文仿宋","FangSong_GB2312","仿宋_GB2312",serif',
            simhei: '"SimHei","黑体","Microsoft YaHei","微软雅黑","Noto Sans CJK SC",sans-serif',
            kaiti: '"KaiTi","楷体","STKaiti","Kaiti SC",serif',
            // 思源宋体：macOS 上 7 个字重各自是独立字体族，必须用对应族名才能体现字重差异，不能统一回退
            'shserif-regular': '"Source Han Serif SC","思源宋体",serif',
            'shserif-medium': '"Source Han Serif SC Medium","思源宋体 Medium",serif',
        };
        // 思源宋体 Bold 不再出现在面板中，无需额外 font-weight 映射
        const FONT_WEIGHT_MAP = {};
        const selectedFont = document.getElementById('tm-fontFamily')?.value;
        const fontFamily = FONT_MAP[selectedFont === 'fangsong2' ? 'fangsong' : selectedFont] || FONT_MAP.simsun;
        const bodyFontWeight = FONT_WEIGHT_MAP[selectedFont] || 'normal';
        const useFangsongStroke = selectedFont === 'fangsong2';
        const printFileName = getPrintFileName(coverTitle);
        const printTitleHtml = printFileName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');


        // 主观题分流严格按 routecs 判断：综应独立兼容，现有申论与行测分支保持不变。
        let routeCourse = '';
        try { routeCourse = new URL(window.location.href).searchParams.get('routecs') || ''; } catch (_) {}
        const isShenlun = routeCourse === 'shenlun' || window.location.href.includes('shenlun');
        const isZhyynl = routeCourse === 'zhyynl';
        const isEssayLike = isShenlun || isZhyynl;
        const localPracticeRoot = document.querySelector('#app-local-practice') || document.querySelector('app-local-practice');
        const isLocalPractice = !!localPracticeRoot;
        let localOrderedQuestionIds = [];
        const localSolutionById = new Map();
        const localQuestionMetaById = new Map();
        let localAnswerLoadError = '';
        let elements;

        const fetchLocalPracticeJson = async (url) => {
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), 10000) : 0;
            try {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: { Accept: 'application/json' },
                    signal: controller ? controller.signal : undefined
                });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const contentType = response.headers.get('content-type') || '';
                if (!/json/i.test(contentType)) throw new Error('答案接口返回了网页而不是数据');
                return await response.json();
            } finally {
                if (timer) clearTimeout(timer);
            }
        };
        const findLocalCategoryQuestionIds = (nodes, categoryId) => {
            for (const node of Array.isArray(nodes) ? nodes : []) {
                if (String(node && node.id) === String(categoryId)) return Array.isArray(node.questionIds) ? node.questionIds : [];
                const nested = findLocalCategoryQuestionIds(node && node.children, categoryId);
                if (nested) return nested;
            }
            return null;
        };
        const loadLocalPracticeSolutions = async () => {
            const route = window.location.pathname.match(/\/error\/practice\/([^/]+)\/([^/]+)\/([^/]+)\/([^/?#]+)/);
            if (!route) throw new Error('无法识别错题/收藏网址');
            const prefix = route[2];
            const categoryId = route[3];
            const profileType = parseInt(route[4], 10);
            // 粉笔 ProfileTab：2=错题、3=笔记、4=收藏；对应 solutions type：1/3/2。
            const source = profileType === 2 ? { path: 'errors', solutionType: 1 }
                : profileType === 3 ? { path: 'notes', solutionType: 3 }
                : profileType === 4 ? { path: 'collects', solutionType: 2 }
                : null;
            if (!source) throw new Error('暂不支持当前列表类型');
            // Angular 会把 /tikuApi 改写到 tiku.fenbi.com/api；直接请求网页域名会返回 SPA 的 HTML。
            const tikuApiBase = window.location.hostname.includes('fenbilantian.cn')
                ? 'https://tiku.fenbilantian.cn/api'
                : 'https://tiku.fenbi.com/api';
            const buildTikuApiUrl = (path, params) => {
                const url = new URL(tikuApiBase + '/' + encodeURIComponent(prefix) + path);
                if (params) params.forEach((value, key) => url.searchParams.set(key, value));
                url.searchParams.set('app', 'web');
                url.searchParams.set('kav', '131');
                url.searchParams.set('av', '134');
                url.searchParams.set('hav', '128');
                url.searchParams.set('version', '3.0.0.0');
                url.searchParams.set('gav', '2');
                url.searchParams.set('apcId', '0');
                try {
                    const deviceSid = localStorage.getItem('deviceSid');
                    if (deviceSid) url.searchParams.set('deviceId', deviceSid);
                } catch (_) {}
                return url.toString();
            };

            let questionIds = [];
            try {
                if (Array.isArray(history.state && history.state.questionIds)) questionIds = history.state.questionIds.slice();
            } catch (_) {}
            if (!questionIds.length) {
                const params = new URLSearchParams(window.location.search);
                const timeRange = params.get('timeRange') || '0';
                const order = params.get('order') || 'desc';
                const treeParams = new URLSearchParams({ timeRange, order });
                if (timeRange === '-1') {
                    if (params.get('startDate')) treeParams.set('startDate', params.get('startDate'));
                    if (params.get('endDate')) treeParams.set('endDate', params.get('endDate'));
                }
                const treePayload = await fetchLocalPracticeJson(buildTikuApiUrl('/' + source.path + '/keypoint-tree', treeParams));
                const tree = Array.isArray(treePayload) ? treePayload : (treePayload && (treePayload.results || treePayload.data)) || [];
                questionIds = findLocalCategoryQuestionIds(tree, categoryId) || [];
            }
            const total = Math.max(0, parseInt(new URL(window.location.href).searchParams.get('total'), 10) || questionIds.length);
            if (total) questionIds = questionIds.slice(0, total);
            if (!questionIds.length) throw new Error('未取得题目ID');
            localOrderedQuestionIds = questionIds.map(id => String(id));

            const chunks = [];
            for (let i = 0; i < questionIds.length; i += 80) chunks.push(questionIds.slice(i, i + 80));
            const payloads = await Promise.all(chunks.map(ids => {
                const solutionParams = new URLSearchParams({
                    type: String(source.solutionType),
                    questionIds: ids.join(',')
                });
                return fetchLocalPracticeJson(buildTikuApiUrl('/universal/auth/solutions', solutionParams));
            }));
            payloads.forEach(payload => {
                const solutions = Array.isArray(payload) ? payload : (payload && (payload.solutions || payload.questions)) || [];
                solutions.forEach(solution => {
                    if (solution && solution.id != null) localSolutionById.set(String(solution.id), solution);
                });
            });
            if (!localSolutionById.size) throw new Error('答案接口未返回题目');

            // 粉笔把正确答案和全站正确率拆成两个接口：solutions 只给答案，question/meta 才给 correctRatio。
            // 正确率属于附加信息，读取失败时不能影响已经取得的答案和题目排版。
            const metaResults = await Promise.allSettled(chunks.map(ids => {
                const metaParams = new URLSearchParams({ ids: ids.join(',') });
                return fetchLocalPracticeJson(buildTikuApiUrl('/question/meta', metaParams));
            }));
            const recordLocalMeta = (id, meta) => {
                if (id == null || !meta || typeof meta !== 'object') return;
                localQuestionMetaById.set(String(id), meta);
            };
            const consumeLocalMetaPayload = payload => {
                const root = payload && payload.data != null ? payload.data : payload;
                const list = Array.isArray(root) ? root
                    : root && Array.isArray(root.metas) ? root.metas
                    : root && Array.isArray(root.results) ? root.results
                    : null;
                if (list) {
                    list.forEach(meta => recordLocalMeta(
                        meta && (meta.id != null ? meta.id : (meta.questionId != null ? meta.questionId : meta.globalId)),
                        meta
                    ));
                    return;
                }
                if (!root || typeof root !== 'object') return;
                Object.keys(root).forEach(id => {
                    const meta = root[id];
                    if (meta && typeof meta === 'object') recordLocalMeta(id, meta);
                });
            };
            metaResults.forEach(result => {
                if (result.status === 'fulfilled') consumeLocalMetaPayload(result.value);
                else console.warn('[粉笔打印] 正确率接口读取失败，答案仍可正常打印', result.reason);
            });
        };

        if (isZhyynl) {
            // ===== 综应独立提取 =====
            // 综应可能把主观题拆在多个 .ti 题组中；逐组抓材料与题目，再统一排版。
            // 不复用也不修改申论分支，避免影响已经稳定的申论与行测页面。
            const log = (...args) => console.log('[粉笔打印][综应]', ...args);
            const materialMap = new Map();
            const questionMap = new Map();
            const click = (node) => {
                try { node.click(); return; } catch (_) {}
                try { node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_) {}
            };
            const nodeSignature = (node, limit) => {
                if (!node) return '';
                const text = (node.innerText || node.textContent || '').replace(/\s+/g, '').slice(0, limit || 1200);
                const images = Array.from(node.querySelectorAll('img')).map(img => img.currentSrc || img.src || img.getAttribute('src') || '').join('|');
                return text + '|' + images;
            };
            const questionKey = (question) => {
                if (!question) return '';
                const key = question.getAttribute('data-question-key');
                const number = question.querySelector('.title-index')?.textContent.trim() || '';
                return key ? 'k:' + key : 'q:' + number + '|' + nodeSignature(question, 500);
            };
            const isVisibleQuestion = (question) => {
                if (!question || question.closest('[hidden]')) return false;
                const style = getComputedStyle(question);
                return style.display !== 'none' && style.visibility !== 'hidden';
            };
            const waitStableChange = async (getter, previous, requireChange) => {
                let last = '', stable = 0;
                for (let waitIndex = 0; waitIndex < 40; waitIndex++) {
                    await sleep(50);
                    const current = getter();
                    const signature = nodeSignature(current, 1200);
                    if (!signature || (requireChange && signature === previous)) continue;
                    if (signature === last) {
                        stable++;
                        if (stable >= 1) return current;
                    } else {
                        last = signature;
                        stable = 0;
                    }
                }
                return getter();
            };
            const getBlocks = () => {
                const blocks = Array.from(document.querySelectorAll('.tis-container .ti'));
                return blocks.length ? blocks : [document.querySelector('.tis-container') || document.body];
            };
            // Angular 可能先挂出第一组，随后才补齐其余题组/标签；等待结构安静后再锁定题组数量。
            const waitZhyStructureStable = async () => {
                const started = Date.now();
                let last = '', quietSince = Date.now();
                for (let waitIndex = 0; waitIndex < 60; waitIndex++) {
                    await sleep(50);
                    const blocks = getBlocks();
                    const signature = blocks.map(block => {
                        const questions = block.querySelectorAll('.questions-anchors .tabs-content .tab, .questions-anchors .tab').length;
                        const materials = block.querySelectorAll('app-materials .tabs-content .tab, app-materials .label-tab .tab, app-materials [role="tab"]').length;
                        return questions + ':' + materials;
                    }).join('|');
                    if (signature !== last) { last = signature; quietSince = Date.now(); }
                    const ready = document.querySelector('app-materials') && document.querySelector('app-ti');
                    if (ready && Date.now() - started >= 600 && Date.now() - quietSince >= 250) return;
                }
            };
            await waitZhyStructureStable();
            const initialBlocks = getBlocks();
            for (let blockIndex = 0; blockIndex < initialBlocks.length; blockIndex++) {
                updatePrintProgress(reservedWin, '正在读取综应材料', '题组 ' + (blockIndex + 1) + ' / ' + initialBlocks.length);
                const getBlock = () => getBlocks()[blockIndex] || initialBlocks[blockIndex];
                const getQuestionTabs = () => Array.from(getBlock().querySelectorAll('.questions-anchors .tabs-content .tab, .questions-anchors .tab'))
                    .filter((tab, index, list) => list.indexOf(tab) === index);
                const getMaterialRoot = () => getBlock().querySelector('app-materials');
                const getMaterialTabs = () => {
                    const root = getMaterialRoot();
                    if (!root) return [];
                    return Array.from(root.querySelectorAll('.tabs-content .tab, .label-tab .tab, .tab'))
                        .filter((tab, index, list) => list.indexOf(tab) === index && /(?:材料|资料)\s*[一二三四五六七八九十百零〇\d]+/.test(tab.textContent || ''));
                };
                const getMaterial = () => getMaterialRoot()?.querySelector('.material-body .material-content, .material-content') || null;
                const getQuestions = () => {
                    const all = Array.from(getBlock().querySelectorAll('.questions-objective-container app-ti, .questions-container app-ti, app-ti'));
                    const unique = all.filter((question, index, list) => list.indexOf(question) === index);
                    const visible = unique.filter(isVisibleQuestion);
                    return visible.length ? visible : unique;
                };
                const getCurrentQuestion = () => getQuestions()[0] || null;

                const questionTabs = getQuestionTabs();
                if (questionTabs.length > 1) {
                    const lastTab = getQuestionTabs()[getQuestionTabs().length - 1];
                    if (lastTab && !lastTab.classList.contains('active')) {
                        const oldSignature = nodeSignature(getCurrentQuestion(), 600);
                        click(lastTab);
                        await waitStableChange(getCurrentQuestion, oldSignature, true);
                    }
                }

                let previousMaterialSignature = '';
                const materialTabs = getMaterialTabs();
                if (materialTabs.length) {
                    for (let materialTabIndex = 0; materialTabIndex < materialTabs.length; materialTabIndex++) {
                        const tab = getMaterialTabs()[materialTabIndex];
                        if (!tab) continue;
                        click(tab);
                        const material = await waitStableChange(getMaterial, previousMaterialSignature, materialTabIndex > 0);
                        const signature = nodeSignature(material, 2000);
                        if (material && signature) {
                            previousMaterialSignature = signature;
                            if (!materialMap.has(signature)) materialMap.set(signature, material.cloneNode(true));
                        }
                    }
                } else {
                    const material = getMaterial();
                    const signature = nodeSignature(material, 2000);
                    if (material && signature && !materialMap.has(signature)) materialMap.set(signature, material.cloneNode(true));
                }

                if (questionTabs.length) {
                    for (let questionTabIndex = 0; questionTabIndex < getQuestionTabs().length; questionTabIndex++) {
                        updatePrintProgress(reservedWin, '正在整理综应作答要求', '题目 ' + (questionMap.size + 1));
                        const tab = getQuestionTabs()[questionTabIndex];
                        if (!tab) continue;
                        const oldSignature = nodeSignature(getCurrentQuestion(), 600);
                        const wasActive = tab.classList.contains('active');
                        click(tab);
                        if (!wasActive) await waitStableChange(getCurrentQuestion, oldSignature, true);
                        else await waitStableChange(getCurrentQuestion, '', false);
                        getQuestions().forEach(question => {
                            const key = questionKey(question);
                            if (key && !questionMap.has(key)) questionMap.set(key, question.cloneNode(true));
                        });
                    }
                    const firstTab = getQuestionTabs()[0];
                    if (firstTab && !firstTab.classList.contains('active')) click(firstTab);
                } else {
                    getQuestions().forEach(question => {
                        const key = questionKey(question);
                        if (key && !questionMap.has(key)) questionMap.set(key, question.cloneNode(true));
                    });
                }
            }
            elements = [...materialMap.values(), ...questionMap.values()];
            log('最终材料数:', materialMap.size, '最终题目数:', questionMap.size);
        } else if (isShenlun) {
            // ===== 申论两阶段提取 =====
            // 阶段1：点最后一个题目tab（左边会显示全部材料）→ 逐个点材料tab抓取，按tab编号去重
            // 阶段2：逐个点题目tab → 抓题干，按 data-question-key 去重
            // 输出用数组直接装，绝不用 querySelectorAll（内外层同名 class 会重复匹配）
            const log = (...a) => console.log('[粉笔打印]', ...a);
            const materialMap = new Map();   // 材料编号N -> 材料clone
            const questions = [];            // 按题号顺序的题目clone
            const seenQKeys = new Set();     // 题目去重（data-question-key）
            updatePrintProgress(reservedWin, '正在读取申论材料', '正在识别材料列表与作答要求…');

            // Angular 兼容点击：原生 click 成功后不再额外 dispatch，避免同一标签被处理两次。
            const click = (el) => {
                try { el.click(); return; } catch (e) {}
                try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
            };

            // 每次都重新查询（Angular 会销毁重建节点，不能缓存引用）
            const getQTabs = () => {
                let t = document.querySelectorAll('.questions-anchors .tabs-content .tab');
                if (t.length === 0) t = document.querySelectorAll('.questions-anchors .tab');
                return Array.from(t);
            };
            const materialLabelPattern = /材料\s*[一二三四五六七八九十百零〇\d]+/;
            const getMatTabs = () => Array.from(document.querySelectorAll('app-materials .tabs-content .tab, app-materials [role="tab"]'))
                .filter(t => materialLabelPattern.test(t.innerText || t.textContent || ''));
            const getMat = () => document.querySelector('app-materials .material-body .material-content')
                         || document.querySelector('app-materials .material-content');
            const getTi = () => document.querySelector('.questions-objective-container app-ti')
                        || document.querySelector('app-ti');

            // 题目唯一键：粉笔官方 data-question-key 优先，题号兜底
            const qKeyOf = (ti) => {
                if (!ti) return null;
                const k = ti.getAttribute('data-question-key');
                if (k) return 'k:' + k;
                const idx = ti.querySelector('.title-index');
                return idx ? 'i:' + idx.innerText.trim() : null;
            };

            const qSignatureOf = (ti) => {
                if (!ti) return '';
                const text = (ti.innerText || ti.textContent || '').replace(/\s+/g, '').slice(0, 500);
                if (!text) return '';
                return (qKeyOf(ti) || 'content') + '|' + text;
            };
            const materialSignatureOf = (material) => {
                if (!material) return '';
                const text = (material.innerText || material.textContent || '').replace(/\s+/g, '').slice(0, 1200);
                const images = Array.from(material.querySelectorAll('img')).map(img => img.currentSrc || img.src || img.getAttribute('src') || '').join('|');
                return text + '|' + images;
            };

            // 50ms 检查一次并要求连续两次稳定，兼顾异步渲染和读取速度，最长约2秒。
            const waitQReady = async (oldSignature, requireChange = true) => {
                let last = '', stable = 0;
                for (let w = 0; w < 40; w++) {
                    await sleep(50);
                    const signature = qSignatureOf(getTi());
                    if (!signature || (requireChange && signature === oldSignature)) continue;
                    if (signature === last) {
                        stable++;
                        if (stable >= 1) return true;
                    } else {
                        last = signature;
                        stable = 0;
                    }
                }
                return false;
            };

            // 等待材料内容变化并连续两次稳定，最长约2秒。
            const waitMatChange = async (previousSignature) => {
                let last = '', stable = 0;
                for (let w = 0; w < 40; w++) {
                    await sleep(50);
                    const m = getMat();
                    const signature = materialSignatureOf(m);
                    if (!signature || signature === previousSignature) continue;
                    if (signature === last) {
                        stable++;
                        if (stable >= 1) return m;
                    } else {
                        last = signature;
                        stable = 0;
                    }
                }
                return getMat();
            };

            // Angular 有时会把“材料一/题目一”保持数秒，随后才补齐其余标签。
            // 单个标签属于可疑的半成品状态，要延长观察；多个标签也要等结构真正安静后再读取。
            const waitTabsStable = async (getter, minimumWait = 600, trustSingle = false) => {
                const started = Date.now();
                let last = '', quietSince = Date.now();
                for (let w = 0; w < 160; w++) {
                    await sleep(50);
                    const tabs = getter();
                    const signature = tabs.map(tab => (tab.innerText || tab.textContent || '').replace(/\s+/g, '')).join('|');
                    if (signature !== last) { last = signature; quietSince = Date.now(); }
                    const suspiciousSingle = tabs.length === 1 && !trustSingle;
                    const requiredWait = Math.max(minimumWait, suspiciousSingle ? 3200 : 0);
                    const requiredQuiet = suspiciousSingle ? 1200 : 250;
                    if (tabs.length && Date.now() - started >= requiredWait && Date.now() - quietSince >= requiredQuiet) return tabs.length;
                }
                return getter().length;
            };

            const chineseOrdinal = (text) => {
                const digits = { '零':0, '〇':0, '一':1, '二':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9 };
                const value = String(text || '').replace(/[^零〇一二三四五六七八九十百]/g, '');
                if (!value) return 0;
                let total = 0, current = 0;
                for (const ch of value) {
                    if (ch === '百') { total += (current || 1) * 100; current = 0; }
                    else if (ch === '十') { total += (current || 1) * 10; current = 0; }
                    else current = digits[ch] ?? current;
                }
                return total + current;
            };
            const materialNumberOf = (tab, index) => {
                const label = (tab && (tab.innerText || tab.textContent) || '').trim();
                const arabic = label.match(/材料\s*(\d+)/);
                if (arabic) return parseInt(arabic[1], 10);
                return chineseOrdinal(label) || (index + 1);
            };

            let previousMaterialSignature = '';
            const collectVisibleMaterials = async (minimumWait = 0) => {
                await waitTabsStable(getMatTabs, minimumWait, true);
                const tabs = getMatTabs();
                for (let j = 0; j < tabs.length; j++) {
                    const num = materialNumberOf(tabs[j], j);
                    if (materialMap.has(num)) continue;
                    updatePrintProgress(reservedWin, '正在读取申论材料', '材料 ' + (j + 1) + ' / ' + tabs.length);
                    const tab = getMatTabs()[j];
                    if (!tab) continue;
                    click(tab);
                    const material = await waitMatChange(previousMaterialSignature);
                    if (!material) continue;
                    previousMaterialSignature = materialSignatureOf(material);
                    materialMap.set(num, material.cloneNode(true));
                    log('材料', num, '抓取成功，开头:', (material.innerText || '').trim().slice(0, 30));
                }
                return tabs.length;
            };

            const collectVisibleQuestions = async (minimumWait = 0) => {
                await waitTabsStable(getQTabs, minimumWait, true);
                const tabs = getQTabs();
                for (let i = 0; i < tabs.length; i++) {
                    updatePrintProgress(reservedWin, '正在整理作答要求', '题目 ' + (i + 1) + ' / ' + tabs.length);
                    const tab = getQTabs()[i];
                    if (!tab) continue;
                    const wasActive = tab.classList.contains('active');
                    const oldSignature = qSignatureOf(getTi());
                    if (wasActive) {
                        await waitQReady('', false);
                    } else {
                        click(tab);
                        let switched = await waitQReady(oldSignature);
                        if (!switched) {
                            const retryTab = getQTabs()[i];
                            if (retryTab) { click(retryTab); await waitQReady(oldSignature); }
                        }
                    }
                    const ti = getTi();
                    const qk = qKeyOf(ti) || ('s:' + qSignatureOf(ti));
                    if (ti && qk && !seenQKeys.has(qk)) {
                        seenQKeys.add(qk);
                        questions.push(ti.cloneNode(true));
                        log('题目抓取成功:', qk);
                    }
                    // 有些页面切到其他题目后才补出对应材料，发现新标签就立即并入材料集合。
                    if (getMatTabs().length > materialMap.size) await collectVisibleMaterials(200);
                }
                return tabs.length;
            };

            await waitTabsStable(getQTabs);
            const qTabs = getQTabs();
            log('题目tab数量:', qTabs.length);
            if (qTabs.length > 0) {
                // ===== 阶段1：抓材料 =====
                // 点最后一个题目tab（该题材料最全，通常包含全部材料）
                const lastQTab = getQTabs()[getQTabs().length - 1];
                if (!lastQTab.classList.contains('active')) {
                    const oldQSignature = qSignatureOf(getTi());
                    click(lastQTab);
                    await waitQReady(oldQSignature);
                } else {
                    await waitQReady('', false);
                }
                await waitTabsStable(getMatTabs);

                // 逐个点材料tab抓取，按tab编号去重
                const matTabs = getMatTabs();
                log('材料tab数量:', matTabs.length, matTabs.map(t => t.innerText.trim()));
                for (let pass = 0; pass < 2; pass++) {
                    await collectVisibleMaterials(pass ? 400 : 0);
                    if (materialMap.size >= getMatTabs().length) break;
                }

                // ===== 阶段2：抓题目 =====
                for (let pass = 0; pass < 2; pass++) {
                    await collectVisibleQuestions(pass ? 400 : 0);
                    if (questions.length >= getQTabs().length) break;
                }

                // 排版前做完整性核对。若标签后来继续增长，就自动补抓，不把半成品送入预览。
                updatePrintProgress(reservedWin, '正在核对申论内容', '确认材料与作答要求已经读取完整…');
                const needsDeepVerification = getQTabs().length <= 1
                    || getMatTabs().length <= 1
                    || questions.length < getQTabs().length
                    || materialMap.size < getMatTabs().length;
                if (needsDeepVerification) {
                    for (let verifyPass = 0; verifyPass < 3; verifyPass++) {
                        await waitTabsStable(getQTabs, verifyPass ? 200 : 0, true);
                        await collectVisibleQuestions(0);
                        const latestQTabs = getQTabs();
                        const latestLastTab = latestQTabs[latestQTabs.length - 1];
                        if (latestLastTab && !latestLastTab.classList.contains('active')) {
                            const oldSignature = qSignatureOf(getTi());
                            click(latestLastTab);
                            await waitQReady(oldSignature);
                        }
                        await collectVisibleMaterials(verifyPass ? 200 : 0);
                        const expectedQuestions = getQTabs().length;
                        const expectedMaterials = getMatTabs().length;
                        if (questions.length >= expectedQuestions && materialMap.size >= expectedMaterials) break;
                    }
                }

                const expectedQuestions = getQTabs().length;
                const expectedMaterials = getMatTabs().length;
                if (questions.length < expectedQuestions || materialMap.size < expectedMaterials) {
                    const incompleteError = new Error('申论内容尚未完整加载');
                    incompleteError.userMessage = '申论材料或作答要求尚未加载完整，插件已停止生成不完整预览。请等待页面内容显示完整后再试。';
                    throw incompleteError;
                }
                // 恢复到第1题
                const finalTab = getQTabs()[0];
                if (finalTab && !finalTab.classList.contains('active')) click(finalTab);
            } else {
                // 无题目tab的兜底：抓当前可见内容
                const m = getMat();
                if (m) materialMap.set(1, m.cloneNode(true));
                const ti = getTi();
                if (ti) questions.push(ti.cloneNode(true));
            }

            // 直接组装数组（不用 querySelectorAll，避免内外层同名class重复匹配）
            const sortedNums = Array.from(materialMap.keys()).sort((a, b) => a - b);
            log('最终材料数:', sortedNums.length, '最终题目数:', questions.length);
            const arr = [];
            sortedNums.forEach(n => arr.push(materialMap.get(n)));
            questions.forEach(q => arr.push(q));
            elements = arr;
        } else if (isLocalPractice) {
            // ===== 错题/收藏练习：等待异步列表并读取每个独立题目组件 =====
            // 这类页面没有 .tis-container/app-ti，题目可能在路由完成后才挂载。
            updatePrintProgress(reservedWin, '正在读取错题 / 收藏', '正在批量读取正确答案，无需逐题点击…');
            try {
                await loadLocalPracticeSolutions();
            } catch (error) {
                localAnswerLoadError = error && error.message ? error.message : '答案接口读取失败';
                console.warn('[粉笔打印] 批量读取答案失败，将使用当前页面已显示的答案', error);
            }
            let localQuestions = [];
            for (let i = 0; i < 30; i++) {
                localQuestions = Array.from(localPracticeRoot.querySelectorAll('.exam-detail fb-local-question, fb-local-question'));
                if (localQuestions.length > 0) break;
                await sleep(100);
            }
            let lastHeight = 0;
            for (let i = 0; i < 10; i++) {
                window.scrollTo(0, document.body.scrollHeight);
                await sleep(150);
                const curHeight = document.body.scrollHeight;
                localQuestions = Array.from(localPracticeRoot.querySelectorAll('.exam-detail fb-local-question, fb-local-question'));
                if (curHeight === lastHeight) break;
                lastHeight = curHeight;
            }
            window.scrollTo(0, 0);

            // 错题/收藏默认每页只渲染 10 题。按“下一页”依次克隆当前 DOM，最后回到第 1 页。
            // querySelectorAll 对逗号选择器会去重；题号加题干作为键，避免页面切换时重复收集。
            const collectedQuestions = [];
            const seenLocalQuestions = new Set();
            const localQuestionKey = (question) => {
                const number = question.querySelector('.options-title')?.textContent.trim() || '';
                const stem = question.querySelector('.question-content')?.textContent.replace(/\s+/g, '').slice(0, 120) || '';
                return number + '|' + stem;
            };
            const collectCurrentLocalPage = () => {
                localQuestions = Array.from(localPracticeRoot.querySelectorAll('.exam-detail fb-local-question, fb-local-question'));
                localQuestions.forEach(question => {
                    const key = localQuestionKey(question);
                    if (!seenLocalQuestions.has(key)) {
                        seenLocalQuestions.add(key);
                        const clone = question.cloneNode(true);
                        const printedNumber = parseInt(question.querySelector('.options-title')?.textContent || '', 10);
                        const orderedIndex = Number.isFinite(printedNumber) && printedNumber > 0 ? printedNumber - 1 : collectedQuestions.length;
                        const questionId = localOrderedQuestionIds[orderedIndex];
                        if (questionId) clone.setAttribute('data-tm-question-id', questionId);
                        collectedQuestions.push(clone);
                    }
                });
            };
            collectCurrentLocalPage();
            const firstPageKey = localQuestions[0] ? localQuestionKey(localQuestions[0]) : '';
            let totalQuestions = 0;
            try { totalQuestions = parseInt(new URL(window.location.href).searchParams.get('total'), 10) || 0; } catch (_) {}
            const expectedPages = totalQuestions > localQuestions.length && localQuestions.length > 0
                ? Math.min(100, Math.ceil(totalQuestions / localQuestions.length))
                : 1;
            updatePrintProgress(reservedWin, '正在读取错题 / 收藏', '正在读取第 1 / ' + expectedPages + ' 页，已收集 ' + collectedQuestions.length + ' 题');
            for (let pageIndex = 1; pageIndex < expectedPages; pageIndex++) {
                const nextButton = localPracticeRoot.querySelector('fb-pager .houpage')?.parentElement;
                if (!nextButton) break;
                const beforeKey = localQuestions[0] ? localQuestionKey(localQuestions[0]) : '';
                try { nextButton.click(); } catch (_) { break; }
                let changed = false;
                for (let waitIndex = 0; waitIndex < 30; waitIndex++) {
                    await sleep(50);
                    const nextFirst = localPracticeRoot.querySelector('.exam-detail fb-local-question, fb-local-question');
                    if (nextFirst && localQuestionKey(nextFirst) !== beforeKey) { changed = true; break; }
                }
                if (!changed) break;
                // 首题变化说明框架已经提交新一页；再留两个绘制帧让同页其余题目挂载。
                await sleep(40);
                collectCurrentLocalPage();
                updatePrintProgress(reservedWin, '正在读取错题 / 收藏', '正在读取第 ' + (pageIndex + 1) + ' / ' + expectedPages + ' 页，已收集 ' + collectedQuestions.length + ' 题');
            }
            const firstPageButton = Array.from(localPracticeRoot.querySelectorAll('fb-pager .item'))
                .find(button => button.textContent.trim() === '1');
            if (firstPageButton && localQuestions[0] && localQuestionKey(localQuestions[0]) !== firstPageKey) {
                try { firstPageButton.click(); } catch (_) {}
            }
            elements = collectedQuestions;
        } else {
            // ===== 行测：滚动加载全部，直接查询 =====
            const scrollContainer = document.querySelector('.tis-container') || document.querySelector('[class*="scroll"]') || window;
            let lastHeight = 0;
            for (let i = 0; i < 10; i++) {
                if (scrollContainer === window) {
                    window.scrollTo(0, document.body.scrollHeight);
                } else {
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;
                }
                await sleep(150);
                const curHeight = scrollContainer === window ? document.body.scrollHeight : scrollContainer.scrollHeight;
                if (curHeight === lastHeight) break;
                lastHeight = curHeight;
            }
            if (scrollContainer === window) window.scrollTo(0, 0);
            else scrollContainer.scrollTop = 0;

            const tisContainer = document.querySelector('.tis-container') || document.body;
            elements = tisContainer.querySelectorAll('.chapter-container, app-materials, .material, .material-content, app-ti');
        }

        if (!elements || elements.length === 0) {
            mask.style.display = 'none';
            try { if (reservedWin && !reservedWin.closed) reservedWin.close(); } catch (_) {}
            alert("未能在当前页面找到题目，请确保页面已完全加载！");
            return;
        }

        updatePrintProgress(reservedWin, '正在生成 A4 分页预览', '题目与材料已读取完成，正在计算页面位置…');

        let newPaperHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>${printTitleHtml}</title>
              <style>
                * {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }

                @media print {
                  @page {
                      size: A4;
                      margin: ${pageMargin};
                      counter-increment: page 1;
                      @bottom-center {
                          content: "第 " counter(page) " 页 / 共 " counter(pages) " 页";
                          font-family: "SimSun", serif;
                           font-size: 8.5pt;
                           font-weight: normal;
                           color: #000;
                      }
                  }
                  @page cover-blank {
                      counter-increment: page 0;
                      @bottom-center { content: none; }
                  }
                }

                body {
                    background: #fff; padding: 0; margin: 0;
                    font-family: ${fontFamily};
                    font-weight: ${bodyFontWeight};
                    font-size: ${fontSize}px; color: #000; line-height: ${lineHeight};
                    text-rendering: optimizeLegibility;
                }
                /* 仿宋2普通正文补一层轻描边；仿宋1及其他字体不描边。 */
                body.tm-fangsong-stroke .q-stem,
                body.tm-fangsong-stroke .opt-text,
                body.tm-fangsong-stroke .material-box p,
                body.tm-fangsong-stroke .material-box td,
                body.tm-fangsong-stroke .chapter-sub-desc { -webkit-text-stroke: 0.25px #000; }
                body.tm-fangsong-stroke .q-num { -webkit-text-stroke: 0; }
                ul, li { list-style: none !important; margin: 0; padding: 0; }

                /* ================= 10秒倒计时弹窗样式 ================= */
                #save-complete-mask {
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(5px);
                    z-index: 99999999; display: none; align-items: center; justify-content: center;
                    font-family: "Microsoft YaHei", sans-serif;
                }
                #save-complete-box {
                    background: white; padding: 35px 45px; border-radius: 12px;
                    box-shadow: 0 15px 35px rgba(0,0,0,0.3); text-align: center; max-width: 380px;
                }
                .success-icon {
                    width: 50px; height: 50px; background: #52c41a; color: white; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 15px auto;
                }
                .save-title { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 8px; }
                .save-desc { font-size: 13px; color: #666; line-height: 1.6; margin-bottom: 20px; }
                .save-btn {
                    background: #ccc; color: white; border: none; padding: 10px 25px;
                    font-size: 14px; border-radius: 6px; cursor: not-allowed; font-weight: bold;
                }
                .save-btn.active {
                    background: #1677ff; cursor: pointer;
                }

                @media print {
                    #save-complete-mask { display: none !important; }
                }

                .cover-page {
                    position: relative; height: 95vh; box-sizing: border-box;
                    page-break-after: always; font-family: ${fontFamily};
                    page: cover-blank; display: flex;
                }
                .cover-sidebar {
                    width: 24px; border-right: 1px solid #555; position: relative;
                }
                .sidebar-block {
                    position: absolute; left: 35%;
                    transform: translateX(-50%) rotate(-90deg);
                    display: flex; align-items: flex-end; width: 280px;
                }
                .sidebar-block.top { top: 28%; }
                .sidebar-block.bottom { top: 72%; }
                .sidebar-text { font-size: 14px; letter-spacing: 5px; color: #000; white-space: nowrap; }
                .sidebar-line { flex: 1; border-bottom: 1px solid #000; margin-left: 6px; height: 0; }

                .cover-main { flex: 1; position: relative; padding: 60px 40px; text-align: center; }
                .cover-top-notice {
                    position: absolute; top: 40px; right: 40px; border: 1px solid #333;
                    padding: 8px 12px; font-size: 13px; line-height: 1.5; text-align: center;
                }
                .cover-main-title { margin-top: 100px; margin-bottom: 60px; }
                .title-line-1 { font-size: 26px; font-weight: bold; margin-bottom: 20px; letter-spacing: 2px; }
                .title-line-2 { font-size: 22px; font-weight: bold; letter-spacing: 2px; }
                .cover-divider {
                    display: flex; align-items: center; justify-content: center;
                    color: #000; font-size: 15px; font-weight: bold; margin: 0 auto 40px auto; width: 75%;
                }
                .cover-divider::before, .cover-divider::after {
                    content: ''; flex: 1; border-bottom: 1px solid #333; margin: 0 15px;
                }
                .cover-tips-box {
                    text-align: left; padding: 0 40px; font-size: 15px; line-height: 2.2;
                    margin: 0 auto; width: 80%; font-family: "KaiTi", "STKaiti", "SimSun", serif;
                }
                .cover-tips-box p { text-indent: 2em; margin: 12px 0; }
                .cover-score-area {
                    position: absolute; bottom: 130px; left: 0; right: 0;
                    display: flex; justify-content: center; gap: 40px;
                    font-size: 16px; font-weight: bold; letter-spacing: 2px;
                }
                .cover-score-item { display: flex; align-items: flex-end; }
                .cover-score-line { border-bottom: 1px solid #000; width: 120px; margin-left: 8px; height: 1em; }
                .cover-bottom { position: absolute; bottom: 50px; left: 0; right: 0; text-align: center; font-size: 15px; font-weight: bold; letter-spacing: 2px; }
                .blank-page { page-break-after: always; height: 95vh; page: cover-blank; }

                /* 章节与资料分析 */
                .chapter-title-box { text-align: center; margin-bottom: 18px; page-break-after: avoid !important; break-after: avoid !important; }
                .chapter-title-box.tm-inline-chapter { margin-top: 0; padding-top: 0; border-top: none; break-inside: avoid; page-break-inside: avoid; }
                .tm-module-divider { display:flex; align-items:center; gap:10px; margin:20px 0 18px; font:normal 17px/1.35 SimHei,"Microsoft YaHei",sans-serif; text-align:center; white-space:nowrap; break-inside:avoid; page-break-inside:avoid; break-before:avoid; page-break-before:avoid; }
                .tm-module-divider-final { margin-top:8px; margin-bottom:0; }
                .tm-module-divider::before, .tm-module-divider::after { content:""; flex:1 1 auto; border-top:1px solid #000; }
                .tm-module-divider-text { flex:0 0 auto; }
                .chapter-main-name { font-size: 18px; font-weight: bold; letter-spacing: 2px; }
                .chapter-sub-desc { font-size: ${fontSize}px; margin-top: 12px; color: #000; text-align: justify; text-align-last: left; text-indent: 2em; font-weight: normal; line-height: 1.7; }
                .material-box { margin: 15px 0; break-inside: auto; page-break-inside: auto; }
                .material-box.shenlun-mat { margin: 0 0 24px; padding-top: 0; break-before: page !important; page-break-before: always !important; }
                .material-box.shenlun-mat .material-heading { margin-top: 0; padding-top: 0; }
                tr { break-inside: avoid; page-break-inside: avoid; }
                .material-heading { font-family: ${fontFamily}; font-weight: bold; font-size: ${fontSize + 2}px; margin-bottom: 10px; page-break-after: avoid !important; break-after: avoid !important; text-align: center; }
                .material-box p { text-indent: 2em; text-align: justify; text-align-last: left; margin: 6px 0; line-height: ${lineHeight}; }
                .material-box p[style*="center"], .material-box p[style*="right"] { text-indent: 0 !important; }
                .material-box table { width: 100% !important; border-collapse: collapse !important; margin: 15px 0; }
                .material-box th, .material-box td { border: 1px solid #333 !important; padding: 8px 10px !important; text-align: center !important; font-size: ${fontSize - 1}px !important; line-height: 1.5 !important; }
                .material-box th { background: #f5f5f5 !important; font-weight: bold; }
                img { border: none !important; box-shadow: none !important; background: transparent !important; break-inside: avoid; page-break-inside: avoid; }
                .material-box img { max-width: 100% !important; height: auto !important; display: block; margin: 10px auto; }
                .material-box img.tm-inline-formula { display: inline !important; margin: 0 2px !important; vertical-align: middle; }

                /* 题干排版 */
                .q-wrapper { margin-bottom: ${spacing}px; display: block !important; break-inside: auto; page-break-inside: auto; }
                .q-stem { margin-bottom: ${lineHeight * 1}px; orphans: 3; widows: 2; }
                .q-stem p, .q-stem div { text-indent: 2em !important; text-align: justify; text-align-last: left; margin: 0 0 ${lineHeight * 3}px 0 !important; line-height: ${lineHeight}; }
                .q-stem p[style*="center"], .q-stem p[style*="right"] { text-indent: 0 !important; }
                .q-num { font-weight: bold; margin-right: 0.5em; font-family: "Times New Roman", "SimSun", serif; }
                /* 填空横线：用文字下划线(持续实线、位于基线)替代全角下划线，避免字形断点 */
                .tm-blank { text-decoration: underline; white-space: nowrap; }
                /* 悬挂缩进：勾选 tm-indent 生效——题号单独一列悬挂，正文左对齐 */
                .tm-hang .q-stem { padding-left: 2em; }
                .tm-hang .q-stem p, .tm-hang .q-stem div { text-indent: 0 !important; }
                .tm-hang .q-num { display: inline-block; float: left; width: 2em; margin-left: -2em; margin-right: 0; text-align: right; }
                .tm-hang .options-grid, .tm-hang .options-flex { padding-left: 2em; }
                .q-stem img, .opt-text img { vertical-align: middle; max-width: 100%; height: auto; }

                /* 图形推理（图片推理）：题干图形按比例缩放，避免一页只放一两题；
                   资料分析的表格/图表走 .material-box img（保持100%），不受影响。 */
                .fig-question .q-stem img { max-width: 100% !important; height: auto !important; }
                .fig-question .opt-text img { max-width: 100% !important; height: auto !important; }

                /* 选项排版 */
                .options-grid { display: grid; row-gap: ${lineHeight * 6}px; column-gap: 20px; margin-top: ${lineHeight * 1}px; width: 100%; box-sizing:border-box; padding-left: 2em; }
                .options-grid.col-4 { grid-template-columns: repeat(4, 1fr); }
                .options-grid.col-2 { grid-template-columns: repeat(2, 1fr); }
                .options-grid.col-1 { grid-template-columns: 1fr; }
                .options-grid.tm-auto-pair { grid-template-columns: repeat(2, 1fr); }
                .options-grid.tm-auto-single { grid-template-columns: 1fr; }
                .opt-item { display: flex; align-items: flex-start; page-break-inside: avoid; break-inside: avoid; line-height: ${lineHeight}; }
                .opt-letter { margin-right: 6px; white-space: nowrap; font-family: "Times New Roman", "SimSun", serif; font-weight: bold; }
                .opt-text { flex: 1; word-break: break-word; text-align: justify; }
                .opt-text p { text-indent: 0 !important; margin: 0 !important; padding: 0 !important; }
                .options-flex { display: flex; flex-wrap: wrap; justify-content: flex-start; row-gap: 15px; column-gap: 15px; margin-top: 10px; width: 100%; box-sizing:border-box; padding-left: 2em; }
                .opt-item-img { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; text-align: center; page-break-inside: avoid; break-inside: avoid; flex: 1 1 20%; min-width: 150px; }
                .opt-item-img .opt-letter { margin-top: 8px; margin-right: 0; }
                /* 四个选项都是公式/字符小图时，字母放左侧、图片放右侧并在格内居中；大图仍沿用上图下标。 */
                .options-grid.small-img-opt .opt-item-img { flex-direction: row; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: 34px; flex: initial; }
                .options-grid.small-img-opt .opt-item-img .opt-letter { order: 0; margin: 0; flex: 0 0 auto; }
                .options-grid.small-img-opt .opt-item-img .opt-text { order: 1; display: flex; align-items: center; justify-content: center; flex: 0 1 auto; min-width: 0; text-align: center; }
                .options-grid.small-img-opt .opt-item-img .opt-text img { display: block; margin: 0 auto; }

                /* 错题/收藏没有统一答题卡 ID：从每道题自己的解析节点生成答案速查。 */
                .tm-answer-sheet { page-break-before: always; break-before: page; padding-top: 8px; }
                .tm-answer-title { text-align: center; font-size: ${fontSize + 3}px; font-weight: bold; margin: 0 0 8px; }
                .tm-answer-note { text-align: center; color: #000; font-size: ${Math.max(10, fontSize - 2)}px; margin: 0 0 18px; }
                .tm-answer-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px 10px; }
                .tm-answer-item { display: flex; align-items: baseline; gap: 6px; min-width: 0; min-height: 26px; padding: 5px 8px; border-bottom: 1px solid #d8dee8; box-sizing: border-box; break-inside: avoid; page-break-inside: avoid; }
                .tm-answer-number { min-width: 2.6em; font-family: "Times New Roman", "SimSun", serif; font-weight: bold; }
                .tm-answer-value { min-width: 0; color: #000; font-weight: bold; word-break: break-all; }
                .tm-answer-rate { margin-left: auto; color: #000; font-size: .78em; white-space: nowrap; }
                .tm-answer-missing { color: #000; font-weight: normal; font-size: .82em; }
                .tm-answer-item.tm-answer-long { grid-column: 1 / -1; align-items: flex-start; }
                .tm-answer-item.tm-answer-long .tm-answer-value { font-weight: normal; word-break: break-word; }
                @media screen and (max-width:760px) { .tm-answer-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

                /* ============ 分页策略：body 上加 pag-smart / pag-ultra / pag-whole ============ */
                body { orphans: 3; widows: 2; }

                /* 智能分页：浏览器决定实际页尾；JS 只按打印宽度保护开头和整理选项行。
                   短题完整保留，长题至少留下四行开头，随后允许在题干/选项、选项行之间分页。 */
                body.pag-smart { width: var(--tm-smart-width, auto); margin-left: auto; margin-right: auto; }
                @media print { body.pag-smart { width: auto; } }
                body.pag-smart .q-wrapper { break-inside: auto; page-break-inside: auto; }
                body.pag-smart .q-stem { break-inside: auto; page-break-inside: auto; orphans: 4; widows: 2; }
                body.pag-smart .q-stem p, body.pag-smart .q-stem div { break-inside: auto; page-break-inside: auto; display: inline; }
                /* 连续题干保留段落换行，由浏览器按实际行盒执行四行开头、两行收尾。 */
                body.pag-smart .q-stem p + p::before { content: "\\A"; white-space: pre; }
                body.pag-smart .options-grid,
                body.pag-smart .options-flex { break-inside: auto; page-break-inside: auto; }
                body.pag-smart .opt-item { break-inside: avoid; page-break-inside: avoid; }
                body.pag-smart .material-box p { break-inside: avoid; page-break-inside: avoid; }
                body.pag-smart .q-wrapper.keep,
                body.pag-smart .tm-smart-opening,
                body.pag-smart .tm-smart-row { break-inside: avoid; page-break-inside: avoid; }
                /* 将网格/弹性选项拆为独立的行：AB/CD 或 A/B/C/D 均可在行间换页。 */
                body.pag-smart .tm-smart-options { display: block; }
                body.pag-smart .tm-smart-options:empty { display: none; }
                body.pag-smart .tm-smart-row { display: grid; grid-template-columns: var(--tm-smart-columns); column-gap: var(--tm-smart-column-gap); }
                body.pag-smart .tm-smart-row + .tm-smart-row { margin-top: var(--tm-smart-row-gap); }
                body.pag-smart .tm-smart-continuation { margin-top: var(--tm-smart-row-gap); }
                /* 超过一整页的单个选项必须能继续流动，不能强制保持整块。 */
                body.pag-smart .tm-smart-long-row { display: block; break-inside: auto; page-break-inside: auto; }
                body.pag-smart .tm-smart-long-option { display: block; break-inside: auto; page-break-inside: auto; orphans: 4; widows: 2; }
                body.pag-smart .tm-smart-long-option > .opt-letter { float: left; }
                body.pag-smart .tm-smart-long-option > .opt-text { display: block; margin-left: 1.5em; orphans: 4; widows: 2; }
                body.pag-smart .tm-smart-link-next { break-after: avoid; page-break-after: avoid; }

                /* 极致省纸：题干可按段落分页，所有选项组都可在选项之间分页，最大化填满页面、最少留白。 */
                body.pag-ultra .q-wrapper { break-inside: auto; page-break-inside: auto; }
                body.pag-ultra .q-stem { break-inside: auto; page-break-inside: auto; }
                body.pag-ultra .q-stem p { break-inside: avoid; page-break-inside: avoid; }
                body.pag-ultra .options-grid,
                body.pag-ultra .options-flex { break-inside: auto; page-break-inside: auto; }

                /* 整题不拆(原版风格)：整道题保持在同一页，资料整块不拆，留白最多但最整洁。 */
                body.pag-whole .q-wrapper { break-inside: avoid; page-break-inside: avoid; }
                body.pag-whole .material-box { break-inside: avoid; page-break-inside: avoid; }

                /* ============ A4 预览工作台 & 图片调整手柄 ============ */
                #tm-toolbar { position:fixed; top:0; left:0; right:0; z-index:9999999; box-sizing:border-box; padding:10px 14px 9px; color:#eaf2ff; background:#0f172a; background:rgba(15,23,42,.96); border-bottom:1px solid rgba(148,163,184,.25); box-shadow:0 10px 28px rgba(15,23,42,.24); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; font-size:13px; }
                @supports ((-webkit-backdrop-filter:blur(12px)) or (backdrop-filter:blur(12px))) { #tm-toolbar { background:rgba(15,23,42,.90); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); } }
                #tm-toolbar * { box-sizing:border-box; }
                #tm-toolbar .tm-tb-main { display:flex; align-items:center; gap:12px; min-width:0; }
                #tm-toolbar .tm-brand { display:flex; align-items:center; gap:9px; min-width:176px; }
                #tm-toolbar .tm-brand-mark { display:grid; place-items:center; width:32px; height:32px; border-radius:10px; color:white; background:linear-gradient(145deg,#60a5fa,#2563eb 70%); box-shadow:0 6px 16px rgba(37,99,235,.36); font-weight:800; }
                #tm-toolbar .tm-brand-copy { min-width:0; }
                #tm-toolbar .tm-tb-title { display:block; color:#fff; font-size:13px; font-weight:750; line-height:1.2; white-space:nowrap; }
                #tm-toolbar .tm-tb-meta { display:flex; gap:5px; margin-top:3px; }
                #tm-toolbar .tm-chip { padding:2px 6px; border-radius:999px; color:#bfdbfe; background:rgba(59,130,246,.16); font-size:10px; line-height:1.4; white-space:nowrap; }
                #tm-toolbar .tm-controls { display:flex; align-items:stretch; gap:7px; flex:1 1 auto; min-width:0; overflow-x:auto; scrollbar-width:thin; padding-bottom:1px; }
                #tm-toolbar .tm-control { display:grid; grid-template-columns:auto 26px minmax(72px,108px) 26px 42px; align-items:center; gap:5px; flex:0 0 auto; min-height:38px; padding:4px 7px 4px 9px; border:1px solid rgba(148,163,184,.18); border-radius:11px; background:rgba(255,255,255,.07); }
                #tm-toolbar .tm-control-label { color:#cbd5e1; font-size:11px; font-weight:650; white-space:nowrap; }
                #tm-toolbar button { min-height:32px; padding:0 11px; border:1px solid rgba(148,163,184,.28); border-radius:9px; color:#e5edf8; background:rgba(255,255,255,.07); cursor:pointer; font:650 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; white-space:nowrap; }
                #tm-toolbar button:hover { background:rgba(255,255,255,.14); border-color:rgba(191,219,254,.48); }
                #tm-toolbar button:focus-visible, #tm-toolbar input:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
                #tm-toolbar .tm-step { width:26px; min-width:26px; min-height:26px; padding:0; border-radius:7px; color:#bfdbfe; font-size:18px; font-weight:500; }
                #tm-toolbar input[type=range] { width:100%; height:24px; margin:0; accent-color:#60a5fa; cursor:pointer; }
                #tm-toolbar .tm-tb-val { min-width:42px; text-align:right; color:#93c5fd; font-size:11px; font-variant-numeric:tabular-nums; font-weight:750; white-space:nowrap; }
                #tm-toolbar .tm-actions { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
                #tm-toolbar #tm-print-btn { min-width:102px; border-color:#3b82f6; color:white; background:linear-gradient(135deg,#3b82f6,#2563eb); box-shadow:0 6px 16px rgba(37,99,235,.28); }
                #tm-toolbar #tm-print-btn:hover { background:linear-gradient(135deg,#60a5fa,#2563eb); }
                #tm-toolbar .tm-tb-hint { display:block; margin-top:6px; padding-left:41px; color:#94a3b8; font-size:10px; line-height:1.35; }
                @media screen { body { padding-top:70px; } }
                @media screen {
                    body.tm-large-fast-preview { width:100% !important; min-width:210mm; margin:0 !important; background:#e8edf5; }
                    body.tm-large-fast-preview #tm-large-fast-paper {
                        box-sizing:border-box; width:210mm; min-height:297mm; margin:20px auto 38px;
                        padding:${pageMargin}; background:#fff; box-shadow:0 12px 35px rgba(15,23,42,.13);
                        outline:1px solid rgba(148,163,184,.38);
                    }
                }
                @media screen and (max-width:1460px) {
                    #tm-toolbar .tm-tb-main { flex-wrap:wrap; gap:7px; }
                    #tm-toolbar .tm-brand { min-width:160px; }
                    #tm-toolbar .tm-controls { order:3; flex-basis:100%; }
                    #tm-toolbar .tm-actions { margin-left:auto; }
                    #tm-toolbar .tm-tb-hint { padding-left:0; }
                }
                @media screen and (max-width:640px) {
                    #tm-toolbar { padding:8px; }
                    #tm-toolbar .tm-brand-mark { width:28px; height:28px; }
                    #tm-toolbar .tm-brand { min-width:138px; }
                    #tm-toolbar .tm-control { grid-template-columns:auto 26px 76px 26px 38px; }
                    #tm-toolbar .tm-action-secondary { width:32px; min-width:32px; padding:0; overflow:hidden; color:transparent; position:relative; }
                    #tm-toolbar #tm-layout-reset::after { content:'↺'; color:#e5edf8; position:absolute; inset:0; display:grid; place-items:center; font-size:18px; }
                    #tm-toolbar #tm-img-reset::after { content:'图'; color:#e5edf8; position:absolute; inset:0; display:grid; place-items:center; font-size:13px; }
                    #tm-toolbar #tm-preview-close::after { content:'×'; color:#e5edf8; position:absolute; inset:0; display:grid; place-items:center; font-size:20px; }
                }
                @media print {
                    #tm-toolbar, .tm-img-handle { display: none !important; }
                    body { padding-top: 0 !important; }
                    /* 原网页可能带有内联灰色文字；导出时统一使用纯黑。 */
                    body, body * { color: #000 !important; -webkit-text-fill-color: #000 !important; }
                    #tm-large-fast-paper { display:block !important; width:auto !important; min-height:0 !important; margin:0 !important; padding:0 !important; box-shadow:none !important; outline:0 !important; }
                }
                .tm-img-wrap { position: relative; }
                .tm-img-wrap .tm-img-handle { position: absolute; right: 0; bottom: 0; width: 28px; height: 28px; touch-action: none; background: #2563eb; border: 2px solid #fff; border-radius: 5px; cursor: nwse-resize; opacity: 0; transition: opacity .15s; z-index: 6; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
                .tm-img-wrap:hover .tm-img-handle { opacity: 1; }
                .tm-img-wrap:hover img { outline: 2px dashed rgba(37,99,235,.45); outline-offset: 2px; }
                @media print { .tm-img-wrap:hover img { outline: none !important; } }
              </style>
            </head>
            <body class="${pagClass}${hangOn ? ' tm-hang' : ''}${useFangsongStroke ? ' tm-fangsong-stroke' : ''}">
              <div id="tm-toolbar">
                <div class="tm-tb-main">
                  <div class="tm-brand">
                    <span class="tm-brand-mark">P</span>
                    <span class="tm-brand-copy">
                      <span class="tm-tb-title">粉笔打印预览</span>
                      <span class="tm-tb-meta"><span class="tm-chip">${paginationMode === 'smart' ? '智能分页' : paginationMode === 'whole' ? '整题不拆' : '紧密排列'}</span><span class="tm-chip" id="tm-page-count">计算页数…</span></span>
                    </span>
                  </div>
                  <div class="tm-controls" aria-label="排版调整">
                    <div class="tm-control">
                      <span class="tm-control-label">字号</span>
                      <button type="button" class="tm-step" data-tm-target="tm-font-slider" data-tm-step="-1" aria-label="减小字号">−</button>
                      <input type="range" id="tm-font-slider" min="10" max="32" step="0.5" value="${fontSize}" aria-label="字号">
                      <button type="button" class="tm-step" data-tm-target="tm-font-slider" data-tm-step="1" aria-label="增大字号">+</button>
                      <output id="tm-font-val" class="tm-tb-val" for="tm-font-slider">${fontSize}px</output>
                    </div>
                    <div class="tm-control">
                      <span class="tm-control-label">行距</span>
                      <button type="button" class="tm-step" data-tm-target="tm-line-slider" data-tm-step="-1" aria-label="减小行距">−</button>
                      <input type="range" id="tm-line-slider" min="1.1" max="2.2" step="0.02" value="${lineHeight}" aria-label="行距">
                      <button type="button" class="tm-step" data-tm-target="tm-line-slider" data-tm-step="1" aria-label="增大行距">+</button>
                      <output id="tm-line-val" class="tm-tb-val" for="tm-line-slider">${lineHeight}</output>
                    </div>
                    <div class="tm-control" id="tm-image-control">
                      <span class="tm-control-label">图片</span>
                      <button type="button" class="tm-step" data-tm-target="tm-img-slider" data-tm-step="-1" aria-label="缩小图片">−</button>
                      <input type="range" id="tm-img-slider" min="20" max="100" step="5" value="60" aria-label="图片大小">
                      <button type="button" class="tm-step" data-tm-target="tm-img-slider" data-tm-step="1" aria-label="放大图片">+</button>
                      <output id="tm-img-val" class="tm-tb-val" for="tm-img-slider">60%</output>
                    </div>
                  </div>
                  <div class="tm-actions">
                    <button type="button" id="tm-layout-reset" class="tm-action-secondary" title="恢复初始字号和行距">恢复排版</button>
                    <button type="button" id="tm-img-reset" class="tm-action-secondary" title="恢复默认图片大小">重置图片</button>
                    <button type="button" id="tm-preview-close" class="tm-action-secondary" title="关闭预览">关闭</button>
                    <button type="button" id="tm-print-btn">保存 PDF</button>
                  </div>
                </div>
                <span class="tm-tb-hint">拖动时即时预览，停顿或松手后自动校准分页；图片也可拖右下角手柄，双击恢复。</span>
              </div>
              <!-- 浏览器写入 PDF 的安全等待提示 -->
              <div id="save-complete-mask">
                  <div id="save-complete-box">
                      <div class="success-icon">&#10003;</div>
                      <div class="save-title" id="mask-title">正在完成 PDF 保存</div>
                      <div class="save-desc" id="mask-desc">浏览器仍在写入文件，请暂时不要打开 PDF。</div>
                      <button class="save-btn active" id="adjust-mask-btn" style="background:#16a34a;">🎨 继续调整图片大小</button>
                      <button class="save-btn" id="close-mask-btn" disabled>正在写入... (12s)</button>
                  </div>
              </div>
        `;

        if (hasCover) {
            let titleLine1 = coverTitle;
            let titleLine2 = "";
            if(coverTitle.includes("《")) {
                let parts = coverTitle.split("《");
                titleLine1 = parts[0];
                titleLine2 = "《" + parts[1];
            }

            newPaperHtml += `
                <div class="cover-page">
                    <div class="cover-sidebar">
                        <div class="sidebar-block top">
                            <div class="sidebar-text">准考证号</div>
                            <div class="sidebar-line"></div>
                        </div>
                        <div class="sidebar-block bottom">
                            <div class="sidebar-text" style="letter-spacing:15px; margin-right:-10px;">姓名</div>
                            <div class="sidebar-line"></div>
                        </div>
                    </div>
                    <div class="cover-main">
                        <div class="cover-top-notice">内部资料<br>考生专用</div>
                        <div class="cover-main-title">
                            <div class="title-line-1">${titleLine1}</div>
                            ${titleLine2 ? '<div class="title-line-2">' + titleLine2 + '</div>' : ''}
                        </div>
                        <div class="cover-divider">重要提示</div>
                        <div class="cover-tips-box">
                            <p>为维护您的个人权益，确保考试的公平公正，请您协助我们监督考试实施工作。</p>
                            <p>本场考试规定：监考老师要向本考场全体考生展示题本密封情况，并邀请两名考生代表验封签字后，方能开启试卷袋。</p>
                        </div>
                        <div class="cover-score-area">
                            <div class="cover-score-item">名字：<div class="cover-score-line"></div></div>
                            <div class="cover-score-item">分数：<div class="cover-score-line"></div></div>
                        </div>
                        <div class="cover-bottom">行测小助理提供</div>
                    </div>
                </div>
                <div class="blank-page">&nbsp;</div>
            `;
        }

        let isFirstChapter = true;
        let chapterCount = 0;
        let materialIndex = 0;  // 当前章节内的材料序号
        let lastLocalMaterialSignature = '';  // 错题/收藏中连续共用材料只输出一次
        let shenlunQHeadingAdded = false;  // 申论"作答要求"标题是否已输出
        let currentChapter = '';  // 当前章节名，用于识别"判断推理"（图形推理）这类图形题
        const localAnswerRows = [];  // 与错题/收藏题目在同一次遍历中生成，避免跨页或排序造成错配
        let localQuestionOrder = 0;
        const escapePaperText = (value) => String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const sectionName = index => {
            const names = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
            return '第' + (names[index] || String(index)) + '部分';
        };
        const moduleDividerHtml = (label, isFinal = false) => '<div class="tm-module-divider' + (isFinal ? ' tm-module-divider-final' : '') + '"><span class="tm-module-divider-text">※※※' + label + '※※※</span></div>';
        const answerTextFromHtml = (value) => {
            const container = document.createElement('div');
            container.innerHTML = String(value == null ? '' : value);
            return (container.textContent || '').replace(/\s+/g, ' ').trim();
        };
        const answerFromLocalSolution = (solution) => {
            const correctAnswer = solution && solution.correctAnswer;
            if (!correctAnswer) return '';
            if (correctAnswer.choice != null && String(correctAnswer.choice).trim()) {
                const rawChoices = Array.isArray(correctAnswer.choice)
                    ? correctAnswer.choice
                    : String(correctAnswer.choice).split(',');
                const letters = rawChoices.map(value => {
                    const normalized = String(value).trim().toUpperCase();
                    if (/^\d+$/.test(normalized)) {
                        const index = parseInt(normalized, 10);
                        return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : '';
                    }
                    return /^[A-Z]$/.test(normalized) ? normalized : '';
                }).filter(Boolean);
                if (letters.length) return Array.from(new Set(letters)).sort().join('');
            }
            if (Array.isArray(correctAnswer.blanks) && correctAnswer.blanks.length) {
                const blanks = correctAnswer.blanks.map(blank => {
                    const alternatives = Array.isArray(blank) ? blank : [blank];
                    return alternatives.map(answerTextFromHtml).filter(Boolean).join(' / ');
                }).filter(Boolean);
                if (blanks.length) return blanks.join('；');
            }
            if (correctAnswer.answer != null) return answerTextFromHtml(correctAnswer.answer);
            return '';
        };
        const extractLocalCorrectAnswer = (question, solution) => {
            const remoteAnswer = answerFromLocalSolution(solution);
            if (remoteAnswer) return remoteAnswer;
            // 粉笔 fb-ng-solution-choice 会把每个正确选项标为 right-options；多选题会有多个。
            const answers = [];
            const addAnswer = (value) => {
                const normalized = String(value || '').trim().toUpperCase();
                if (normalized && !answers.includes(normalized)) answers.push(normalized);
            };
            const rightMarkers = Array.from(question.querySelectorAll('.right-options'));
            rightMarkers.forEach(marker => {
                const option = marker.closest('li') || marker;
                const letterText = option.querySelector('.fb-radioInput span')?.textContent
                    || marker.querySelector('span')?.textContent || '';
                const letter = letterText.replace(/[.、：:\s]/g, '').toUpperCase();
                if (/^[A-H]$/.test(letter)) {
                    addAnswer(letter);
                    return;
                }
                const optionText = (option.textContent || '').replace(/\s+/g, '');
                if (/^正确$/.test(optionText) || optionText.includes('正确')) addAnswer('正确');
                else if (/^错误$/.test(optionText) || optionText.includes('错误')) addAnswer('错误');
            });
            if (answers.length) {
                const lettersOnly = answers.every(value => /^[A-H]$/.test(value));
                return lettersOnly ? answers.sort().join('') : answers.join('、');
            }

            // 兼容粉笔可能采用的显式“正确答案”字段；只接受明确答案节点，绝不从解析正文猜答案。
            const explicitNodes = question.querySelectorAll(
                '.correct-answer, .right-answer, [class*="correct-answer"], [class*="right-answer"], [data-role*="correct-answer"]'
            );
            for (const node of explicitNodes) {
                const text = (node.textContent || '').replace(/\s+/g, '');
                const choiceMatch = text.match(/(?:正确答案|参考答案|答案)?[：:]?([A-H](?:[,，、/]*[A-H])*)/i);
                if (choiceMatch) return choiceMatch[1].toUpperCase().replace(/[,，、/]/g, '');
                const trueFalseMatch = text.match(/(?:正确答案|参考答案|答案)?[：:]?(正确|错误)/);
                if (trueFalseMatch) return trueFalseMatch[1];
            }
            return '';
        };
        const extractLocalCorrectRate = (question, solution, questionMeta) => {
            // 粉笔答案详情组件读取 question.meta_.correctRatio，并用整数百分比展示。
            const candidates = [
                solution && solution.meta && solution.meta.correctRatio,
                solution && solution.meta_ && solution.meta_.correctRatio,
                solution && solution.correctRatio,
                questionMeta && questionMeta.correctRatio,
                questionMeta && questionMeta.meta && questionMeta.meta.correctRatio
            ];
            for (const value of candidates) {
                if (value == null || value === '') continue;
                const number = Number(String(value).replace('%', '').trim());
                if (Number.isFinite(number) && number >= 0 && number <= 100) return Math.round(number) + '%';
            }
            // 接口缺少统计字段时，兼容页面已经渲染出的“正确率 75%”文本。
            const text = question ? (question.innerText || question.textContent || '') : '';
            const match = text.match(/(?:全站|本题|平均)?\s*正确率\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/);
            return match ? Math.round(Number(match[1])) + '%' : '';
        };
        const toChineseMaterialNumber = (number) => {
            const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
            if (number < 10) return digits[number];
            if (number === 10) return '十';
            if (number < 20) return '十' + digits[number - 10];
            if (number < 100) return digits[Math.floor(number / 10)] + '十' + (number % 10 ? digits[number % 10] : '');
            return String(number);
        };
        const removeEmbeddedShenlunHeading = (container) => {
            if (!isEssayLike) return;
            container.querySelectorAll('*').forEach(node => {
                const text = (node.innerText || node.textContent || '').trim();
                if (node.children.length === 0 && /^材料\s*[一二三四五六七八九十百零〇\d]+[：:]?$/.test(text)) node.remove();
            });
        };
        const materialHeadingHtml = (html, index) => {
            if (isEssayLike) return '<div class="material-heading">材料' + toChineseMaterialNumber(index) + '</div>';
            return /材料\s*[一二三四五六七八九十\d]+/.test(html) ? '' : '<div class="material-heading">材料' + index + '</div>';
        };
        const markInlineMaterialFormulas = (root) => {
            // 只有前后都有正文的公式图才随文字排版；独立公式和图表仍保持居中块状排版。
            root.querySelectorAll('img[flag="tex"]').forEach(img => {
                const parent = img.parentElement;
                if (!parent || parent.tagName !== 'P') return;
                const siblings = Array.from(parent.childNodes);
                const index = siblings.indexOf(img);
                const hasText = nodes => nodes.some(node => (node.textContent || '').trim());
                if (hasText(siblings.slice(0, index)) && hasText(siblings.slice(index + 1))) {
                    img.classList.add('tm-inline-formula');
                }
            });
        };
        const shenlunSolutionSelector = (isShenlun ? [
            'fb-ng-solution-choice', 'fb-ng-solution-blank', 'fb-ng-solution-essay', 'app-solution',
            'app-result-common', 'app-solution-overall',
            '.answer', '.analysis', '.solution', '[class*="answer-analysis"]',
            '[class*="answer-content"]', '[class*="reference-answer"]', '[class*="analysis-content"]',
            '[data-role*="answer"]', '[data-role*="solution"]'
        ] : [
            'fb-ng-solution-choice', 'fb-ng-solution-blank', 'fb-ng-solution-essay', 'app-solution',
            'app-result-common', 'app-solution-overall',
            '.answer', '.analysis', '.solution', '[class*="solution"]', '[class*="answer-analysis"]',
            '[class*="answer-content"]', '[class*="reference-answer"]', '[class*="analysis-content"]',
            '[data-role*="answer"]', '[data-role*="solution"]'
        ]).join(',');
        const findShenlunStemContainer = (question) => {
            const selectors = [
                ...[
                    'app-solution-smart article.content',
                    'app-solution-blank article.content',
                    'app-solution-view-only article.content',
                    'app-solution-special-filling-blank article.content',
                    'app-solution-sketch article.content',
                    'app-solution-keyword article.content',
                    'app-solution-draw-line article.content',
                    'app-solution-choice app-question-choice app-format-html'
                ],
                'fb-ng-question-essay app-format-html',
                'fb-ng-question-blank app-format-html',
                'fb-ng-question-choice app-format-html',
                '.question-content app-format-html',
                'article.content app-format-html',
                'app-format-html',
                'article.content'
            ];
            for (const selector of selectors) {
                const match = Array.from(question.querySelectorAll(selector)).find(node => !node.closest(shenlunSolutionSelector));
                if (match) return match;
            }
            return null;
        };
        const stripShenlunAnswerTail = (root) => {
            if (!isEssayLike || !root) return;
            root.querySelectorAll(shenlunSolutionSelector).forEach(node => node.remove());
            const marker = /(?:参考答案(?:说明)?|答案解析|参考解析|标准答案|作答参考)\s*[：:]/;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const textNode = walker.currentNode;
                const match = (textNode.nodeValue || '').match(marker);
                if (!match) continue;
                const range = document.createRange();
                range.setStart(textNode, match.index);
                range.setEnd(root, root.childNodes.length);
                range.deleteContents();
                root.normalize();
                break;
            }
        };

        // ===== 自选题目导出：拼装 newPaperHtml 之前先弹出勾选界面，拿到过滤集合后再继续 =====
        let tmPickSkip = null;
        if (pickMode) {
            mask.style.display = 'none';
            // 勾选界面展示在原页面：确保预览窗口退到后台，避免遮挡勾选界面
            try { if (reservedWin && !reservedWin.closed) reservedWin.blur(); } catch (_) {}
            try { window.focus(); } catch (_) {}
            const tmPlan = tmBuildPickPlan(elements, isEssayLike, isLocalPractice, (el) => {
                let container = isEssayLike ? findShenlunStemContainer(el) : el.querySelector('app-format-html');
                if (!container && !isEssayLike) container = el.querySelector('article.content');
                if (!container) container = el.querySelector('.question-content');
                return container;
            });
            const tmPicked = await openTmPickUI(tmPlan, {
                cover: document.getElementById('tm-hasCover') ? !!document.getElementById('tm-hasCover').checked : false,
                material: true,
                // 勾选期间不预开任何窗口，用户全程留在原页面；点「确定，生成预览」时才在这里
                // 同步创建预览标签页（仍处于用户点击手势内，不会被弹窗拦截）。
                openPreview: () => {
                    try {
                        reservedWin = window.open('', '_blank');
                        showReservedLoading(reservedWin);
                    } catch (_) { reservedWin = null; }
                    return reservedWin;
                }
            });
            if (!tmPicked) {
                // 用户取消：关闭预留预览窗口，直接结束本次导出（原有按钮与流程不受影响）
                try { if (reservedWin && !reservedWin.closed) reservedWin.close(); } catch (_) {}
                return;
            }
            if (!reservedWin || reservedWin.closed) {
                try { reservedWin = (tmPicked.win && !tmPicked.win.closed) ? tmPicked.win : null; } catch (_) {}
            }
            if (typeof tmPicked.cover === 'boolean') hasCover = tmPicked.cover;
            tmPickSkip = tmComputePickSkip(tmPlan, tmPicked.sel, tmPicked.material);
            mask.style.display = 'flex';
            updatePrintProgress(reservedWin, '正在生成 A4 分页预览', '已选定 ' + tmPicked.count + ' 题，正在计算页面位置…');
            // 用户已确认：把之前压到后台的预览窗口唤回前台
            try { if (reservedWin && !reservedWin.closed) reservedWin.focus(); } catch (_) {}
        }

        elements.forEach((el, elIdx) => {
            if (tmPickSkip && tmPickSkip.has(elIdx)) return;
            if (el.classList.contains('chapter-container')) {
                materialIndex = 0;
                let nameNode = el.querySelector('.chapter-name');
                let descNode = el.querySelector('.chapter-desc');
                let chapterName = nameNode ? nameNode.innerText.trim() : '';
                let chapterDesc = descNode ? descNode.innerText.trim() : '';
                currentChapter = chapterName;  // 记录当前章节名（用于判断推理->图形题识别）

                if (chapterName) {
                    if (chapterCount) {
                        newPaperHtml += moduleDividerHtml(sectionName(chapterCount) + '结束，请继续作答' + sectionName(chapterCount + 1));
                    }
                    chapterCount++;
                    let pageBreakStyle = isFirstChapter ? 'padding-top: 10px;'
                        : moduleNewPage ? 'page-break-before: always; break-before: page;'
                        : '';
                    const inlineChapterClass = !isFirstChapter && !moduleNewPage ? ' tm-inline-chapter' : '';
                    isFirstChapter = false;

                    newPaperHtml += `
                        <div class="chapter-title-box${inlineChapterClass}" style="${pageBreakStyle}">
                            <div class="chapter-main-name">${chapterName}</div>
                            ${chapterDesc ? '<div class="chapter-sub-desc">' + chapterDesc + '</div>' : ''}
                        </div>
                    `;
                }
            }
            else if (el.tagName.toLowerCase() === 'app-materials' || el.classList.contains('material') || el.classList.contains('material-content')) {
                if (el.classList.contains('material-content') && el.closest('app-materials')) return;
                if (el.classList.contains('material-content') && el.closest('.material')) return;
                if (el.classList.contains('material') && el.closest('app-materials')) return;

                let materialClone = el.cloneNode(true);
                materialClone.querySelectorAll('.tooltip-container, .label-tab, app-ti, .material-tabs, .material-tab, .tabs, .tabs-content, .tab-list, .material-nav, .material-select, .select-material').forEach(e => e.remove());
                materialClone.querySelectorAll('*').forEach(node => {
                    const txt = (node.innerText || '').trim();
                    if (txt && /材料\s*[一二三四五六七八九十\d]+.*材料\s*[一二三四五六七八九十]+/.test(txt)) node.remove();
                });

                if (el.tagName.toLowerCase() === 'app-materials') {
                    let innerMaterials = materialClone.querySelectorAll('.material');
                    if (innerMaterials.length > 1) {
                        innerMaterials.forEach(m => {
                            let mClone = m.cloneNode(true);
                            mClone.querySelectorAll('.tooltip-container, .label-tab, app-ti, .material-tabs, .material-tab, .tabs, .tabs-content, .tab-list, .material-nav, .material-select, .select-material').forEach(e => e.remove());
                            mClone.querySelectorAll('*').forEach(node => {
                                const txt = (node.innerText || '').trim();
                                if (node.children.length === 0 && /请选择材料|选择材料/.test(txt)) node.remove();
                                if (txt && /材料\s*[一二三四五六七八九十\d]+.*材料\s*[一二三四五六七八九十]+/.test(txt)) node.remove();
                            });
                            removeEmbeddedShenlunHeading(mClone);
                            markInlineMaterialFormulas(mClone);
                            let mHtml = mClone.innerHTML;
                            materialIndex++;
                            let heading = materialHeadingHtml(mHtml, materialIndex);
                            let matClass = isShenlun ? 'material-box shenlun-mat' : 'material-box';
                            newPaperHtml += '<div class="' + matClass + '">' + heading + mHtml + '</div>';
                        });
                        return;
                    }
                }

                materialClone.querySelectorAll('*').forEach(node => {
                    const txt = (node.innerText || '').trim();
                    if (node.children.length === 0 && /请选择材料|选择材料/.test(txt)) node.remove();
                    if (txt && /材料\s*[一二三四五六七八九十\d]+.*材料\s*[一二三四五六七八九十]+/.test(txt)) node.remove();
                });
                removeEmbeddedShenlunHeading(materialClone);
                markInlineMaterialFormulas(materialClone);
                let mHtml = materialClone.innerHTML;
                materialIndex++;
                let heading = materialHeadingHtml(mHtml, materialIndex);
                let matClass = isShenlun ? 'material-box shenlun-mat' : 'material-box';
                newPaperHtml += '<div class="' + matClass + '">' + heading + mHtml + '</div>';
            }
            else if (el.tagName.toLowerCase() === 'app-ti' || el.tagName.toLowerCase() === 'fb-local-question') {
                const isLocalQuestion = el.tagName.toLowerCase() === 'fb-local-question';
                if (isLocalQuestion) localQuestionOrder++;
                if (isEssayLike && !shenlunQHeadingAdded) {
                    newPaperHtml += '<div class="material-box"><div class="material-heading" style="margin-top: 30px;">作答要求</div></div>';
                    shenlunQHeadingAdded = true;
                }

                let q = el;
                let qNumObj = isLocalQuestion ? q.querySelector('.options-title') : q.querySelector('.title-index');
                let qNumStr = qNumObj ? qNumObj.innerText.trim() : '';
                if (isLocalQuestion) {
                    const answerNumber = qNumStr || (localQuestionOrder + '.');
                    const questionId = q.getAttribute('data-tm-question-id') || '';
                    localAnswerRows.push({
                        number: answerNumber,
                        questionId,
                        answer: extractLocalCorrectAnswer(q, localSolutionById.get(questionId)),
                        correctRate: extractLocalCorrectRate(q, localSolutionById.get(questionId), localQuestionMetaById.get(questionId))
                    });
                }

                let localMaterialHtml = '';
                if (isLocalQuestion) {
                    const localMaterial = q.querySelector('fb-ng-question-material .material-content, .fb-question-material .material-content');
                    if (localMaterial) {
                        const materialClone = localMaterial.cloneNode(true);
                        materialClone.querySelectorAll('button, input, .material-nav').forEach(node => node.remove());
                        markInlineMaterialFormulas(materialClone);
                        const imageSignature = Array.from(materialClone.querySelectorAll('img')).map(img => img.currentSrc || img.src || img.getAttribute('src') || '').join('|');
                        const signature = (materialClone.innerText || materialClone.textContent || '').replace(/\s+/g, '') + '|' + imageSignature;
                        if (signature && signature !== lastLocalMaterialSignature) {
                            lastLocalMaterialSignature = signature;
                            localMaterialHtml = '<div class="material-box tm-local-material"><div class="material-heading">材料</div>' + materialClone.innerHTML + '</div>';
                        }
                    }
                }

                let stemHtml = '';
                let stemContainer = isEssayLike ? findShenlunStemContainer(q) : q.querySelector('app-format-html');
                if (!stemContainer && !isEssayLike) stemContainer = q.querySelector('article.content');
                if (!stemContainer && isLocalQuestion) {
                    stemContainer = q.querySelector('fb-ng-choice-question .question-content, fb-ng-question-blank .question-content, fb-ng-question-essay .question-content, fb-ng-solution-choice .question-content, fb-ng-solution-blank .question-content, fb-ng-solution-essay .question-content, .fb-question-options .question-content, .fb-solution-sub .question-content, .question-content');
                }
                if (stemContainer) {
                    let stemClone = stemContainer.cloneNode(true);
                    if (isEssayLike) stemClone.querySelectorAll(shenlunSolutionSelector).forEach(node => node.remove());
                    let htmlContent = stemClone.innerHTML;

                    htmlContent = htmlContent.replace(/_{6,}/g, '<span class="tm-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>');
                    htmlContent = htmlContent.replace(/(&nbsp;|\s){6,}/g, ' <span class="tm-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> ');

                    let tempDiv = document.createElement('div');
                    tempDiv.innerHTML = htmlContent;
                    stripShenlunAnswerTail(tempDiv);

                    if (qNumStr) {
                        let firstP = tempDiv.querySelector('p');
                        if (firstP) {
                            firstP.classList.add('qnum-first');
                            firstP.innerHTML = '<span class="q-num">' + qNumStr + '</span>' + firstP.innerHTML;
                        } else {
                            tempDiv.innerHTML = '<p class="qnum-first"><span class="q-num">' + qNumStr + '</span>' + tempDiv.innerHTML + '</p>';
                        }
                    }
                    stemHtml = tempDiv.innerHTML;
                }

                // 统计题干中的图片数量：用于识别"六个图形分两类"这类（选项是序号、题干是多图）的图形题
                let stemImgCount = 0;
                if (stemHtml) {
                    let tmpDiv = document.createElement('div');
                    tmpDiv.innerHTML = stemHtml;
                    stemImgCount = tmpDiv.querySelectorAll('img').length;
                }

                let optElements = isLocalQuestion
                    ? q.querySelectorAll('fb-ng-choice-question .options > li, fb-ng-solution-choice .options > li, .fb-question-options .options > li, .fb-solution-sub .options > li')
                    : q.querySelectorAll('li[class*="choice"], .option-item');
                let optsHtml = '';
                let isFigureQuestion = false;

                const optionContentOf = (opt) => {
                    if (!isLocalQuestion) return opt.querySelector('.choice-radio-label') || opt;
                    const directChildren = Array.from(opt.children || []);
                    return directChildren.find(node => node.classList && node.classList.contains('options-material'))
                        || directChildren.find(node => node.tagName === 'P' && !(node.classList && node.classList.contains('fb-radioInput')))
                        || opt.querySelector('.options-material')
                        || opt;
                };

                // 广东专用且用户主动勾选：严格限定两个纯文字选项，分别为正确、错误。
                const hideThisJudgement = hideGuangdongJudgement && optElements.length === 2
                    && (() => {
                        const labels = Array.from(optElements, opt => {
                            const clone = optionContentOf(opt).cloneNode(true);
                            clone.querySelectorAll('.input-radio, .fb-radioInput, .fb-label, input, button, i').forEach(node => node.remove());
                            if (clone.querySelector('img, svg')) return '';
                            return (clone.textContent || '').replace(/[\s.、:：]/g, '');
                        });
                        return labels.includes('正确') && labels.includes('错误');
                    })();

                if (optElements.length > 0 && !hideThisJudgement) {
                    let maxTextLen = 0;
                    let isAllPureImages = true;
                    let hasBigImg = false;

                    optElements.forEach(opt => {
                        let labelNode = optionContentOf(opt);
                        let cloneLabel = labelNode.cloneNode(true);
                        cloneLabel.querySelectorAll('.input-radio, .fb-radioInput, .fb-label, input, button, i').forEach(e => e.remove());

                        let pureText = cloneLabel.innerText.replace(/\s+/g, '');
                        // 选项里可能夹着箭头、公式等小图；只要仍有实际文字，就不能当作纯图片选项。
                        if (pureText.length > 0 && !/^[A-D\.、]$/.test(pureText)) {
                            isAllPureImages = false;
                        }
                        if (pureText.length > maxTextLen) {
                            maxTextLen = pureText.length;
                        }

                        labelNode.querySelectorAll('img').forEach(img => {
                            let w1 = img.getAttribute('width');
                            let w2 = img.style.width;
                            let renderedWidth = img.getBoundingClientRect ? img.getBoundingClientRect().width : 0;
                            if (w1 && parseInt(w1) > 120) hasBigImg = true;
                            if (w2 && parseInt(w2) > 120) hasBigImg = true;
                            if (renderedWidth > 120) hasBigImg = true;
                        });
                    });

                    // 图形推理（图片推理）：四个选项全是图片，或当前在"判断推理"章节且题干含图形
                    // （图可能是一整张合成图=1个img，也可能是多张；不再按图片张数判断）→ 定向缩放题干图形
                    isFigureQuestion = isAllPureImages || stemImgCount >= 1;

                    let containerClass = 'options-grid ';
                    if (isAllPureImages) {
                        if (hasBigImg) {
                            containerClass += 'col-2 img-opt';
                        } else {
                            containerClass += 'col-4 img-opt';
                            if (optElements.length === 4) containerClass += ' small-img-opt';
                        }
                    } else {
                        if (hasBigImg) {
                            containerClass += (maxTextLen > 15) ? 'col-1' : 'col-2';
                        } else {
                            if (maxTextLen <= 6) {
                                containerClass += 'col-4';
                            } else if (maxTextLen <= 15) {
                                containerClass += 'col-2';
                            } else {
                                containerClass += 'col-1';
                            }
                        }
                    }

                    optsHtml += '<div class="' + containerClass + '">';

                    optElements.forEach((opt, optIndex) => {
                        let letterNode = isLocalQuestion ? opt.querySelector('.fb-radioInput span') : opt.querySelector('.input-radio');
                        let letter = letterNode ? letterNode.innerText.trim() : String.fromCharCode(65 + optIndex);

                        let labelNode = optionContentOf(opt);
                        let cloneLabel = labelNode.cloneNode(true);
                        cloneLabel.querySelectorAll('.input-radio, .fb-radioInput, .fb-label, input, button, i').forEach(e => e.remove());

                        let textHtml = cloneLabel.innerHTML.trim();
                        let pt = cloneLabel.innerText.replace(/\s+/g, '');
                        if (pt === letter && !cloneLabel.querySelector('img')) {
                            textHtml = '';
                        }
                        // 去掉选项 label 里自带的单个字母（A/B/C/D，无论图形是 <img> 还是 div/svg），避免与下方 .opt-letter 重复
                        {
                            let dt = document.createElement('div');
                            dt.innerHTML = textHtml;
                            const walker = document.createTreeWalker(dt, NodeFilter.SHOW_TEXT);
                            const kills = [];
                            while (walker.nextNode()) {
                                const n = walker.currentNode;
                                if (/^[A-Da-d]$/.test((n.nodeValue || '').replace(/[\s.、:]/g, ''))) kills.push(n);
                            }
                            kills.forEach(n => n.parentNode.removeChild(n));
                            textHtml = dt.innerHTML;
                        }

                        if (isAllPureImages) {
                            optsHtml += `
                                <div class="opt-item-img">
                                    <div class="opt-text">${textHtml}</div>
                                    <div class="opt-letter">${letter}.</div>
                                </div>
                            `;
                        } else {
                            optsHtml += `
                                <div class="opt-item">
                                    <div class="opt-letter">${letter}.</div>
                                    <div class="opt-text">${textHtml}</div>
                                </div>
                            `;
                        }
                    });
                    optsHtml += '</div>';
                }

                newPaperHtml += localMaterialHtml + `
                    <div class="q-wrapper${isFigureQuestion ? " fig-question" : ""}">
                        <div class="q-stem">${stemHtml}</div>
                        ${optsHtml}
                    </div>
                `;
            }
        });

        if (chapterCount) newPaperHtml += moduleDividerHtml('全部测验到此结束', true);

        // 错题/收藏由多个来源题目组成，没有可用的单一 answercard ID；逐题附上与打印顺序绑定的答案。
        if (isLocalPractice && localAnswerRows.length) {
            const missingAnswerCount = localAnswerRows.filter(row => !row.answer).length;
            const missingCorrectRateCount = localAnswerRows.filter(row => !row.correctRate).length;
            const answerItemsHtml = localAnswerRows.map(row => {
                const answer = row.answer
                    ? '<span class="tm-answer-value">' + escapePaperText(row.answer) + '</span>'
                    : '<span class="tm-answer-value tm-answer-missing">未读取</span>';
                const correctRate = row.correctRate
                    ? '<span class="tm-answer-rate" title="全站正确率">' + escapePaperText(row.correctRate) + '</span>'
                    : '';
                const longClass = row.answer && row.answer.length > 12 ? ' tm-answer-long' : '';
                return '<div class="tm-answer-item' + longClass + '"><span class="tm-answer-number">' + escapePaperText(row.number) + '</span>' + answer + correctRate + '</div>';
            }).join('');
            let answerNote = '答案和全站正确率已从粉笔当前账号的题目数据中批量读取，并按题目ID与打印题号逐题对应。';
            if (missingAnswerCount) {
                answerNote += ' 其中 ' + missingAnswerCount + ' 题未读取到答案';
                answerNote += localAnswerLoadError ? '（' + escapePaperText(localAnswerLoadError) + '），请刷新或重新登录后再试。' : '，请确认这些题目在粉笔中可查看解析。';
            }
            if (missingCorrectRateCount) {
                answerNote += ' ' + missingCorrectRateCount + ' 题暂未取得全站正确率。';
            }
            newPaperHtml += `
                <section class="tm-answer-sheet">
                    <h2 class="tm-answer-title">答案速查</h2>
                    <p class="tm-answer-note">${answerNote}</p>
                    <div class="tm-answer-grid">${answerItemsHtml}</div>
                </section>
            `;
        }

        // 添加答案二维码区域（粉笔扫一扫对答案）
        const answerQrUrl = getAnswerQrCodeUrl();
        if (answerQrUrl) {
            newPaperHtml += `
                <div style="page-break-before: always; text-align: center; padding-top: 80px;">
                    <div style="font-size: 16px; font-weight: bold; color: #000; margin-bottom: 8px;">扫一扫，对答案</div>
                    <div style="font-size: 12px; color: #000; margin-bottom: 20px;">打开粉笔APP，扫描下方二维码，提交答案后即可评分并查看解析</div>
                    <img src="${answerQrUrl}" style="width: 200px; height: 200px; border: 1px solid #ddd; padding: 8px; background: white;" alt="答案二维码">
                    <div style="font-size: 11px; color: #000; margin-top: 15px;">本二维码由粉笔题库整理生成</div>
                </div>
            `;
        }

        // 原生“打印为 PDF”不提供文件写完事件；打印窗口关闭后给出明确的安全等待提示。
        newPaperHtml += `
            <script>
                const PRINT_FILE_NAME = ${JSON.stringify(printFileName)};
                let printRequested = false;
                let printTriggered = false;
                let countdownStarted = false;
                let saveCountdownTimer = 0;
                let sourceTitleBeforePrint = null;

                function applyPrintFileName() {
                    document.title = PRINT_FILE_NAME;
                    try {
                        if (window.frameElement && window.parent && window.parent !== window) {
                            sourceTitleBeforePrint = window.parent.document.title;
                            window.parent.document.title = PRINT_FILE_NAME;
                        }
                    } catch (_) {}
                }

                function restoreSourceTitle() {
                    try {
                        if (sourceTitleBeforePrint !== null && window.parent && window.parent !== window) {
                            window.parent.document.title = sourceTitleBeforePrint;
                        }
                    } catch (_) {}
                    sourceTitleBeforePrint = null;
                }

                document.title = PRINT_FILE_NAME;

                function showSaveWaitMask() {
                    if (!printRequested || countdownStarted) return;
                    countdownStarted = true;
                    var mask = document.getElementById('save-complete-mask');
                    var btn = document.getElementById('close-mask-btn');
                    var title = document.getElementById('mask-title');
                    var desc = document.getElementById('mask-desc');
                    if (!mask || !btn || !title || !desc) return;
                    mask.style.display = 'flex';
                    title.innerText = '正在完成 PDF 保存';
                    desc.innerText = '浏览器仍在写入文件，请暂时不要打开 PDF。';
                    btn.innerText = '正在写入... (12s)';
                    btn.classList.remove('active');
                    btn.setAttribute('disabled', 'disabled');
                    var timeLeft = 12;
                    clearInterval(saveCountdownTimer);
                    saveCountdownTimer = setInterval(function() {
                        timeLeft--;
                        if (timeLeft > 0) {
                            btn.innerText = '正在写入... (' + timeLeft + 's)';
                        } else {
                            clearInterval(saveCountdownTimer);
                            saveCountdownTimer = 0;
                            title.innerText = 'PDF 通常已写入完成';
                            desc.innerText = '现在可以尝试打开；页数很多时，浏览器可能还需要几秒。';
                            btn.innerText = '我知道了，关闭页面';
                            btn.classList.add('active');
                            btn.removeAttribute('disabled');
                        }
                    }, 1000);
                }

                // 智能缩放 + 可视化图片调整：
                // 大图（显示宽>150px）默认按面板比例缩放；每张大图右下角带拖拽手柄可单独微调、双击恢复；
                // 顶部工具栏滑块统一调整所有大图；小图（分数公式等）不缩放
                var PREVIEW_INITIALIZED = false;
                window.addEventListener('load', function() {
                    if (PREVIEW_INITIALIZED) return;
                    PREVIEW_INITIALIZED = true;
                    var DEFAULT_PCT = ${figScale};
                    var slider = document.getElementById('tm-img-slider');
                    var sliderVal = document.getElementById('tm-img-val');
                    var IS_PRO = ${currentPro};
                    var QUESTION_COUNT = document.querySelectorAll('.q-wrapper').length;
                    var QUESTION_TEXT_LENGTH = Array.from(document.querySelectorAll('.q-wrapper')).reduce(function(total, question) {
                        return total + (question.innerText || question.textContent || '').replace(/\s+/g, '').length;
                    }, 0);
                    var CONTENT_IMAGE_COUNT = document.querySelectorAll('.q-wrapper img, .material-box img').length;
                    var ESTIMATED_RENDER_LOAD = QUESTION_COUNT * (QUESTION_TEXT_LENGTH + CONTENT_IMAGE_COUNT * 800);
                    var LARGE_FAST_MODE = QUESTION_COUNT > 300 || (QUESTION_COUNT > 200 && ESTIMATED_RENDER_LOAD > 9000000);
                    if (slider) { slider.value = IS_PRO ? DEFAULT_PCT : 70; sliderVal.textContent = (IS_PRO ? DEFAULT_PCT : 70) + '%'; }
                    // 免费版：隐藏图片调整控件，图片固定 70%；字号与行距仍可在预览中微调。
                    if (!IS_PRO) {
                        var imgCtrl = document.getElementById('tm-image-control');
                        if (imgCtrl) imgCtrl.style.display = 'none';
                        var rst = document.getElementById('tm-img-reset');
                        if (rst) rst.style.display = 'none';
                        var lockHint = document.createElement('span');
                        lockHint.className = 'tm-tb-hint';
                        lockHint.style.color = '#fca5a5';
                        lockHint.innerText = '图片缩放为 Pro 功能，免费版固定 70%';
                        var toolbar = document.getElementById('tm-toolbar');
                        if (toolbar) toolbar.appendChild(lockHint);
                    }

                    var tbar = document.getElementById('tm-toolbar');
                    function fitToolbar() { if (tbar) document.body.style.paddingTop = (tbar.offsetHeight + 10) + 'px'; }
                    fitToolbar();
                    window.addEventListener('resize', fitToolbar);

                    // Pro 用户：自动滚动到第一张可调整的图片
                    if (IS_PRO && !LARGE_FAST_MODE) {
                        setTimeout(function() {
                            var imgs = document.querySelectorAll('img[data-nat-w]');
                            if (imgs.length) {
                                imgs[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }, 800);
                    }


                    function applyScale(img, pct) {
                        var nat = parseInt(img.getAttribute('data-nat-w'), 10);
                        if (!nat) return;
                        img.style.setProperty('width', Math.round(nat * pct / 100) + 'px', 'important');
                        img.style.setProperty('height', 'auto', 'important');
                    }

                    try {
                        document.querySelectorAll('.fig-question img, .material-box img').forEach(function(img) {
                            var w = img.getBoundingClientRect().width;
                            if (!(w && w > 150)) return;
                            if (!img.getAttribute('data-nat-w')) img.setAttribute('data-nat-w', Math.round(w));
                            if (IS_PRO && !LARGE_FAST_MODE && !img.parentNode.classList.contains('tm-img-wrap')) {
                                var wrap = document.createElement('span');
                                wrap.className = 'tm-img-wrap';
                                var cs = window.getComputedStyle(img);
                                if (cs && cs.display === 'block') {
                                    wrap.style.display = 'block';
                                    wrap.style.width = 'fit-content';
                                    wrap.style.margin = '10px auto';
                                    img.style.margin = '0';
                                } else {
                                    wrap.style.display = 'inline-block';
                                    wrap.style.verticalAlign = 'top';
                                }
                                wrap.style.maxWidth = '100%';
                                img.parentNode.insertBefore(wrap, img);
                                wrap.appendChild(img);
                                var handle = document.createElement('span');
                                handle.className = 'tm-img-handle';
                                handle.title = '拖动调整大小';
                                wrap.appendChild(handle);
                                function beginImageResize(startX, onResize, onEnd) {
                                    var startW = img.getBoundingClientRect().width;
                                    var finished = false;
                                    function moveTo(clientX) {
                                        var nw = Math.max(40, startW + (clientX - startX));
                                        img.style.setProperty('width', Math.round(nw) + 'px', 'important');
                                        img.style.setProperty('height', 'auto', 'important');
                                        img.setAttribute('data-custom', '1');
                                        if (onResize) onResize();
                                    }
                                    function onMouseMove(ev) { moveTo(ev.clientX); }
                                    function onTouchMove(ev) {
                                        var touch = ev.touches && ev.touches[0];
                                        if (touch) moveTo(touch.clientX);
                                    }
                                    function finish() {
                                        if (finished) return;
                                        finished = true;
                                        document.removeEventListener('mousemove', onMouseMove);
                                        document.removeEventListener('mouseup', finish);
                                        document.removeEventListener('touchmove', onTouchMove);
                                        document.removeEventListener('touchend', finish);
                                        document.removeEventListener('touchcancel', finish);
                                        if (onEnd) onEnd();
                                    }
                                    document.addEventListener('mousemove', onMouseMove);
                                    document.addEventListener('mouseup', finish);
                                    document.addEventListener('touchmove', onTouchMove, { passive:true });
                                    document.addEventListener('touchend', finish);
                                    document.addEventListener('touchcancel', finish);
                                }
                                handle._tmStartResize = beginImageResize;
                                handle.addEventListener('mousedown', function(e) {
                                    e.preventDefault();
                                    beginImageResize(e.clientX);
                                });
                                handle.addEventListener('touchstart', function(e) {
                                    var touch = e.touches && e.touches[0];
                                    if (!touch) return;
                                    e.preventDefault();
                                    beginImageResize(touch.clientX);
                                });
                                img.addEventListener('dblclick', function() {
                                    img.removeAttribute('data-custom');
                                    applyScale(img, parseInt(slider.value, 10) || DEFAULT_PCT);
                                });
                            }
                            if (!img.getAttribute('data-custom')) applyScale(img, DEFAULT_PCT);
                        });
                    } catch (e) {}

                    if (slider) slider.addEventListener('input', function() {
                        var pct = parseInt(slider.value, 10) || DEFAULT_PCT;
                        sliderVal.textContent = pct + '%';
                        document.querySelectorAll('img[data-nat-w]').forEach(function(img) {
                            if (img.getAttribute('data-custom')) return;
                            applyScale(img, pct);
                        });
                    });

                    document.getElementById('tm-img-reset').addEventListener('click', function() {
                        slider.value = DEFAULT_PCT;
                        sliderVal.textContent = DEFAULT_PCT + '%';
                        document.querySelectorAll('img[data-nat-w]').forEach(function(img) {
                            img.removeAttribute('data-custom');
                            applyScale(img, DEFAULT_PCT);
                        });
                    });

                    if (LARGE_FAST_MODE) {
                        document.body.classList.add('tm-large-fast-preview');
                        var fastPaper = document.createElement('main');
                        fastPaper.id = 'tm-large-fast-paper';
                        Array.from(document.body.children).forEach(function(node) {
                            if (!['SCRIPT', 'STYLE'].includes(node.tagName) && !['tm-toolbar', 'save-complete-mask'].includes(node.id)) fastPaper.appendChild(node);
                        });
                        document.body.appendChild(fastPaper);
                        var controls = document.querySelector('#tm-toolbar .tm-controls');
                        if (controls) controls.style.display = 'none';
                        var layoutReset = document.getElementById('tm-layout-reset');
                        var imageReset = document.getElementById('tm-img-reset');
                        if (layoutReset) layoutReset.style.display = 'none';
                        if (imageReset) imageReset.style.display = 'none';
                        var pageBadge = document.getElementById('tm-page-count');
                        if (pageBadge) pageBadge.textContent = QUESTION_COUNT + ' 题 · 极速模式';
                        var fastHint = document.querySelector('.tm-tb-hint');
                        if (fastHint) fastHint.textContent = QUESTION_COUNT > 300
                            ? '超过 300 题，已关闭 A4 实时分页和预览调整；打印时由浏览器一次分页，避免大量页面副本拖慢。'
                            : '当前 200–300 题图文内容较多，已自动关闭高消耗预览调整；打印时由浏览器一次分页。';
                        fitToolbar();
                    } else {
                        (${setupPagedPreview.toString()})(${JSON.stringify(pageMargin)},${JSON.stringify(fontSize)},${JSON.stringify(lineHeight)},${JSON.stringify(paginationMode)});
                    }

                    document.getElementById('tm-print-btn').addEventListener('click', function() {
                        printRequested = true;
                        printTriggered = false;
                        countdownStarted = false;
                        clearInterval(saveCountdownTimer);
                        applyPrintFileName();
                        if (typeof window.tmPreparePagedPreview === 'function') window.tmPreparePagedPreview();
                        window.print();
                    });
                    document.getElementById('tm-preview-close').addEventListener('click', function() {
                        if (window.frameElement) window.frameElement.remove();
                        else window.close();
                    });


                });

                window.addEventListener('afterprint', function() {
                    printTriggered = true;
                    restoreSourceTitle();
                    showSaveWaitMask();
                });

                window.addEventListener('focus', function() {
                    if (printRequested) setTimeout(function() {
                        restoreSourceTitle();
                        showSaveWaitMask();
                    }, printTriggered ? 0 : 180);
                });

                document.getElementById('close-mask-btn').addEventListener('click', function() {
                    if (!document.getElementById('close-mask-btn').hasAttribute('disabled')) {
                        window.close();
                    }
                });
                document.getElementById('adjust-mask-btn').addEventListener('click', function() {
                    clearInterval(saveCountdownTimer);
                    saveCountdownTimer = 0;
                    printRequested = false;
                    printTriggered = false;
                    countdownStarted = false;
                    document.getElementById('save-complete-mask').style.display = 'none';
                });
            <\/script>
            </body></html>
        `;

        // 首选点击时已预留的窗口；弹窗仍被拦截时，在当前页创建同源全屏 iframe。
        const createPreviewFrame = function() {
            const oldFrame = document.getElementById('tm-print-preview-frame');
            if (oldFrame) oldFrame.remove();
            const frame = document.createElement('iframe');
            frame.id = 'tm-print-preview-frame';
            frame.title = '粉笔打印预览';
            frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;background:white;z-index:2147483647;';
            document.body.appendChild(frame);
            return frame.contentWindow;
        };
        let win = reservedWin && !reservedWin.closed ? reservedWin : createPreviewFrame();
        try {
            win.document.open();
            win.document.write(newPaperHtml);
            win.document.close();
        } catch (e) {
            // 某些 Safari 版本会返回窗口对象但随后拒绝写入，再降级到当前页内嵌预览。
            try { if (reservedWin && !reservedWin.closed) reservedWin.close(); } catch (_) {}
            win = createPreviewFrame();
            win.document.open();
            win.document.write(newPaperHtml);
            win.document.close();
        }
    }

    })();
