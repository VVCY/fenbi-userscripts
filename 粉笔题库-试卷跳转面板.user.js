// ==UserScript==
// @name         粉笔题库 - 试卷跳转面板
// @namespace    http://tampermonkey.net/
// @version      1.0.5
// @description  在粉笔行测题库页右上角悬浮展示年份/季/类别面板，季选项直接标注当前类别完成情况（依据接口 exercise.finishCount 真实完成次数），选择后跳转到对应试卷
// @author       Marvis Browser Agent
// @match        *://www.fenbi.com/spa/tiku/guide/realTest/xingce/xingce*
// @match        *://www.fenbi.com/spa/tiku/guide/realTest/shenlun/shenlun*
// @match        *://www.fenbi.com/spa/tiku/guide/realTest/shuaxin/shuaxin*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  var CATS = ['地市级', '行政执法类', '副省级'];
  var CATID = '1000371';
  var LIST_URL = 'https://tiku.fenbi.com/api/xingce/papers/v2?labelId=2972&toPage=';
  var EXER_URL = 'https://tiku.fenbi.com/api/xingce/exercises?app=web&kav=131&av=134&hav=128&version=3.0.0.0&deviceId=&gav=2&apcId=0&examcatid=' + CATID;
  var DEF_Y = '2027', DEF_S = '三十六', DEF_C = '行政执法类';

  var css = '#fb-jump-panel{position:fixed;top:16px;right:16px;z-index:2147483647;width:300px;background:#fff;border:1px solid #e3e6eb;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.16);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;color:#1f2329;overflow:hidden}'
    + '#fb-jump-panel .fb-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#1f7cf6;color:#fff;font-size:14px;font-weight:600;user-select:none}'
    + '#fb-jump-panel .fb-min{cursor:pointer;border:none;background:rgba(255,255,255,.22);color:#fff;border-radius:6px;padding:2px 8px;font-size:12px;line-height:18px}'
    + '#fb-jump-panel .fb-bd{padding:12px 14px 14px}'
    + '#fb-jump-panel .fb-row{display:flex;align-items:center;margin-bottom:10px}'
    + '#fb-jump-panel .fb-lb{width:52px;color:#646a73;flex:0 0 auto}'
    + '#fb-jump-panel select{flex:1 1 auto;height:32px;border:1px solid #dcdfe6;border-radius:8px;padding:0 8px;background:#fff;font-size:13px;color:#1f2329;outline:none;cursor:pointer}'
    + '#fb-jump-panel select:focus{border-color:#1f7cf6}'
    + '#fb-jump-panel .fb-btn{width:100%;height:36px;border:none;border-radius:8px;background:#1f7cf6;color:#fff;font-size:14px;font-weight:600;cursor:pointer;margin-top:2px}'
    + '#fb-jump-panel .fb-btn:hover{background:#3d8ef7}'
    + '#fb-jump-panel .fb-btn:disabled{background:#c9cdd4;cursor:not-allowed}'
    + '#fb-jump-panel .fb-st{margin-top:9px;font-size:12px;color:#8a9099;min-height:16px;line-height:16px;word-break:break-all}'
    + '#fb-jump-panel.fb-collapsed .fb-bd{display:none}';

  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var box = document.createElement('div');
  box.id = 'fb-jump-panel';
  box.innerHTML = '<div class="fb-hd"><span>粉笔试卷跳转</span><button class="fb-min" id="fb-min">收起</button></div>'
    + '<div class="fb-bd">'
    + '<div class="fb-row"><div class="fb-lb">年份</div><select id="fb-year"></select></div>'
    + '<div class="fb-row"><div class="fb-lb">第几季</div><select id="fb-season"></select></div>'
    + '<div class="fb-row"><div class="fb-lb">类别</div><select id="fb-cat"></select></div>'
    + '<button class="fb-btn" id="fb-go" disabled>跳转试卷</button>'
    + '<div class="fb-st" id="fb-status">正在加载试卷数据...</div>'
    + '</div>';
  document.body.appendChild(box);

  var yearSel = box.querySelector('#fb-year');
  var seasonSel = box.querySelector('#fb-season');
  var catSel = box.querySelector('#fb-cat');
  var goBtn = box.querySelector('#fb-go');
  var statusEl = box.querySelector('#fb-status');
  function setStatus(t){ statusEl.textContent = t; }

  box.querySelector('#fb-min').onclick = function(){
    box.className = box.className.indexOf('fb-collapsed') >= 0 ? '' : 'fb-collapsed';
    this.textContent = box.className.indexOf('fb-collapsed') >= 0 ? '展开' : '收起';
  };

  // 中文数字转换（1~99）
  var CN = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  var CN_D = ['零','一','二','三','四','五','六','七','八','九'];
  function cn2n(s){
    if (!s) return 0;
    if (s.indexOf('十') >= 0){
      var p = s.split('十');
      var t = p[0] ? (CN[p[0]] || 0) : 1;
      var o = p[1] ? (CN[p[1]] || 0) : 0;
      return t * 10 + o;
    }
    return CN[s] || 0;
  }
  function n2cn(n){
    if (n <= 0) return '零';
    if (n < 10) return CN_D[n];
    if (n < 20) return '十' + (n % 10 ? CN_D[n % 10] : '');
    var t = Math.floor(n / 10), o = n % 10;
    return CN_D[t] + '十' + (o ? CN_D[o] : '');
  }
  function doneLabel(done){
    if (done <= 0) return '未完成';
    return '完成' + n2cn(done) + '次';
  }

  var index = {};
  var years = [];

  function build(all){
    for (var i=0;i<all.length;i++){
      var it = all[i];
      var n = it.name || '';
      var year = null, season = null, cat = null;
      var m = n.match(/^(\d{4})年国考第(.+?)季行测模考大赛（(.+?)）$/);
      if (m){ year = m[1]; season = m[2]; cat = m[3]; }
      else {
        var m2 = n.match(/^(\d{4})年国考终极行测模考大赛（(.+?)）$/);
        if (m2){ year = m2[1]; season = '终极'; cat = m2[2]; }
      }
      if (!year || CATS.indexOf(cat) < 0) continue;
      if (!index[year]) { index[year] = {}; years.push(year); }
      if (!index[year][season]) index[year][season] = {};
      if (!index[year][season][cat]) index[year][season][cat] = [];
      index[year][season][cat].push(it);
    }
    years.sort(function(a,b){ return Number(b) - Number(a); });
  }

  // 统计某年/某季/某类别的真实完成次数
  // 依据接口 papers/v2 返回的 exercise.finishCount：交卷完成才累加；
  // 仅点开创建练习记录（exercise.key 存在但 status=0 / finishCount=0）不计入。
  function countDone(year, season, cat){
    var arr = index[year] && index[year][season] ? index[year][season][cat] : null;
    if (!arr) return 0;
    var done = 0;
    for (var i=0;i<arr.length;i++){
      var ex = arr[i].exercise;
      var fc = (ex && typeof ex.finishCount === 'number') ? ex.finishCount : 0;
      if (fc > 0) done += fc;
    }
    return done;
  }

  function seasonText(season){
    return season === '终极' ? '终极模考' : ('第' + season + '季');
  }

  function fillSeasons(){
    var y = yearSel.value;
    var c = catSel.value;
    var prev = seasonSel.value;
    var seasons = index[y] ? Object.keys(index[y]) : [];
    seasons.sort(function(a,b){
      if (a === '终极') return 1;
      if (b === '终极') return -1;
      return cn2n(b) - cn2n(a);
    });
    seasonSel.innerHTML = '';
    for (var i=0;i<seasons.length;i++){
      var s = seasons[i];
      var done = (c && CATS.indexOf(c) >= 0) ? countDone(y, s, c) : 0;
      var o = document.createElement('option');
      o.value = s;
      o.textContent = seasonText(s) + '（' + doneLabel(done) + '）';
      seasonSel.appendChild(o);
    }
    if (prev && seasons.indexOf(prev) >= 0) seasonSel.value = prev;
    else if (seasons.indexOf(DEF_S) >= 0) seasonSel.value = DEF_S;
  }

  yearSel.onchange = function(){ fillSeasons(); };
  catSel.onchange = function(){ fillSeasons(); };

  goBtn.onclick = function(){
    var y = yearSel.value, s = seasonSel.value, c = catSel.value;
    var arr = (index[y] && index[y][s]) ? index[y][s][c] : null;
    var paper = (arr && arr.length) ? arr[0] : null;
    if (!paper){ setStatus('未找到该组合的试卷'); return; }
    if (paper.exercise && paper.exercise.key){
      setStatus('正在跳转：' + paper.name);
      location.href = 'https://spa.fenbi.com/ti/exam/exercise/' + paper.exercise.key + '?routecs=xingce&examcatid=' + CATID;
      return;
    }
    setStatus('正在创建试卷（' + paper.name + '）...');
    goBtn.disabled = true;
    fetch(EXER_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'type=1&paperId=' + paper.id + '&exerciseTimeMode=2'
    }).then(function(r){ return r.json(); }).then(function(j){
      goBtn.disabled = false;
      if (j && j.key){
        setStatus('正在跳转：' + paper.name);
        location.href = 'https://spa.fenbi.com/ti/exam/exercise/' + j.key + '?routecs=xingce&examcatid=' + CATID;
      } else { setStatus('创建试卷失败，请重试'); }
    }).catch(function(e){ goBtn.disabled = false; setStatus('创建试卷失败：' + e.message); });
  };

  function init(){
    var all = [];
    function pageUrl(p){ return LIST_URL + p + '&pageSize=100&app=web&examcatid=' + CATID; }
    fetch(pageUrl(0), {credentials:'include'})
      .then(function(r){ return r.json(); })
      .then(function(j0){
        all = j0.list || [];
        var tp = (j0.pageInfo && j0.pageInfo.totalPage) || 1;
        var chain = Promise.resolve();
        for (var p=1;p<tp;p++){
          (function(pp){
            chain = chain.then(function(){
              return fetch(pageUrl(pp), {credentials:'include'})
                .then(function(r){ return r.json(); })
                .then(function(j){ if (j && j.list) all = all.concat(j.list); });
            });
          })(p);
        }
        return chain;
      })
      .then(function(){
        build(all);
        // 年份
        yearSel.innerHTML = '';
        for (var i=0;i<years.length;i++){
          var o = document.createElement('option');
          o.value = years[i]; o.textContent = years[i] + '年';
          yearSel.appendChild(o);
        }
        if (years.indexOf(DEF_Y) >= 0) yearSel.value = DEF_Y;
        // 类别（先就位，供季度标注统计使用）
        catSel.innerHTML = '';
        for (var c=0;c<CATS.length;c++){
          var oc = document.createElement('option');
          oc.value = CATS[c]; oc.textContent = CATS[c];
          catSel.appendChild(oc);
        }
        catSel.value = DEF_C;
        // 季度（带完成情况标注）
        fillSeasons();
        goBtn.disabled = false;
        setStatus('就绪：共 ' + all.length + ' 份试卷');
      })
      .catch(function(e){ setStatus('加载失败：' + e.message); });
  }

  if (document.readyState === 'complete') {
    setTimeout(init, 800);
  } else {
    window.addEventListener('load', function(){ setTimeout(init, 800); });
  }

})();
