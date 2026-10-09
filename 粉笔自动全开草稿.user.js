// ==UserScript==
// @name         粉笔自动全开草稿
// @namespace    marvis.fenbi.enhance
// @version      2.2.5
// @description  页面加载后自动打开全部题的草稿；每题注入 ABCD 字母选择盒（D 后带「下一题」），草稿画布锁定为题干+选项高度；新增「笔刷设置」面板（黑/蓝/红笔色切换 + 粗细无级调节）；MutationObserver 适配 SPA 增量渲染，按题目作用域去重。
// @match        *://spa.fenbi.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// 功能清单
//  ① 每道题 .title-left 内追加 .marvis-lbox，内含 A/B/C/D 四个字母按钮，
//     点击即选中该题对应选项（label.click()）；盒子 z-index:260 高于草稿画板 130。
//  ② 盒子内 D 之后追加「下一题」按钮，点击滚动到下一题并强制打开该题草稿；
//     点击后目标题滚动到视口垂直居中位置（不再贴顶）；
//     题目高于一屏时改为顶部留白对齐，保证题干头部可见；
//     按钮样式与 ABCD 字母按钮保持一致（白底蓝字蓝边，hover/active 实心蓝白字）。
//  ③ 每个 .draft-container 高度锁定为「题干+选项」区域高度（app-question-choice
//     的 bottom 相对 .ti 顶部），top 固定 0，解析展开时 .ti 变高不拉伸画布。
//  ④ 页面加载后自动批量打开所有题的草稿（点击 li.draft.tool）；
//     自动打开每题只尝试一次，用户手动关闭后不会被重新打开。
//  ⑤ 「笔刷设置」面板：笔色黑（默认）/蓝/红三色切换 + 粗细滑块（0.4×~4× 无级）；
//     默认内联显示在页面顶部「设置」按钮左侧（锚点 app-setting，插到其前一个兄弟位置，
//     与工具栏同一行）；锚点始终缺失时才兜底为左下角 fixed（答题卡 z-index 500 会遮挡，
//     故 fixed 不作常驻位置），锚点出现后自动挪回工具栏。
//     通过 hook CanvasRenderingContext2D 的 strokeStyle / fillStyle / lineWidth / arc
//     作用于 canvas#draft，改写时保留原有 alpha（预览 0.1 / 终稿 1）；
//     只影响绘制调用，不写页面状态、不改动上面 ①~④ 的任何逻辑。
//  适配：MutationObserver + rAF 节流，覆盖 SPA 增量渲染；
//        注入以「题号」为 key 去重，元素复用渲染新题时会自动重建。
//
(function () {
  'use strict';
  if (window.__MARVIS_FENBI_ENHANCE__) return;
  window.__MARVIS_FENBI_ENHANCE__ = true;

  var DLOCK_ATTR = 'data-marvis-dlock';
  var AUTO_ATTR  = 'data-marvis-autoopen';
  var BOX_ATTR   = 'data-marvis-boxkey';

  /* ---------- 样式 ---------- */
  var STYLE_ID = 'marvis-fenbi-enhance-style';
  if (!document.getElementById(STYLE_ID)) {
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.marvis-lbox{display:flex;align-items:center;gap:15px;margin-left:10px;position:relative;z-index:260;}',
      '.marvis-lbox .marvis-lbtn{box-sizing:border-box;width:22px;height:22px;padding:0;border-radius:4px;',
      'border:1px solid #3b6ef0;background:#fff;color:#3b6ef0;font-size:12px;line-height:20px;text-align:center;cursor:pointer;}',
      '.marvis-lbox .marvis-lbtn:hover{background:#3b6ef0;color:#fff;}',
      '.marvis-lbox .marvis-lbtn:active{background:#2b55c8;color:#fff;}',
      '.marvis-lbox .marvis-next{box-sizing:border-box;height:22px;margin-left:0;padding:0 8px;border-radius:4px;',
      'border:1px solid #3b6ef0;background:#fff;color:#3b6ef0;font-size:12px;line-height:20px;text-align:center;cursor:pointer;white-space:nowrap;}',
      '.marvis-lbox .marvis-next:hover{background:#3b6ef0;color:#fff;}',
      '.marvis-lbox .marvis-next:active{background:#2b55c8;color:#fff;}',
      '.draft-container{background:transparent!important;}',
      '.draft-container{outline:1px solid rgba(0,0,0,0.12);outline-offset:-1px;}',
      '.ti, .draft-container{--color-bg-draft:transparent!important;}',
      '.draft-tool .draft-tool-mark{display:none!important;}',
      /* ⑤ 笔�