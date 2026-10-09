// ==UserScript==
// @name         粉笔评论查看器（可收藏优质评论）
// @namespace    https://github.com/local/fenbi-comment-viewer
// @version      2.8.3
// @description  在粉笔网站题目页注入「查看评论」按钮，直接调用粉笔评论接口展示精选评论，可收藏优质评论。
// @author       local
// @match        https://www.fenbi.com/spa/tiku/*
// @match        https://spa.fenbi.com/ti/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      *
// @noframes
// ==/UserScript==

/*
 * v1.3.0（本次改动，仅修复背题页 /ti/memorize/ 不注入按钮，其余逻辑保持不变）：
 *  a) 题号顺序优先取映射请求 URL 参数：tiku_episodes_with_multi_type?tiku_ids=...&tiku_prefix=...，
 *       按 tiku_ids 原顺序建序；原 solution / questionIds / exercises 响应提取降为兜底，
 *       并补齐 exercise / getExercise / getMeta 等拦截关键字（背题页题目接口实际为
 *       tiku.fenbi.com/combine/exercise/getExercise（单数），旧子串 exercises 匹配不到）。
 *  b) 评论接口前缀改为以拦截到的请求 URL 参数 tiku_prefix 实际值优先（背题页实测 xingce），
 *       不再默认用 gwy / sydw 猜测；原候选降级链保留在实测值之后。
 *  c) 恢复按钮注入门槛：仅当该题已取到 episodeId（即该题存在解析视频）时才注入按钮，
 *       无解析不注入（覆盖上文 v1.2.0 的 b) 项策略）。
 *
 * v1.5.0（本次改动，仅调整「查看评论」按钮的挂载点与定位，功能 / 文案 / 样式全部不变）：
 *  a) 挂载点由题卡内部的 .title-right / 题号区域，改为题卡整体盒子（.ti / .question /
 *       fb-local-question / fb-recitatation-question / .solution-item）的外层容器
 *       （即题卡的父节点），按钮不再位于题卡内部。
 *  b) 定位方式改为 position:absolute，相对题卡左边缘 left:-1cm（1cm≈37.8px），
 *       纵向优先对齐题号行（依次尝试 .title-right / span.index / .options-title），
 *       若题卡内找不到明确题号元素，则以题卡顶部为基准。
 *  c) 外层容器统一加 .fcv-question-mount（position:relative; overflow:visible），
 *       确保按钮落在题卡盒子外部且不被卡片容器 overflow 裁切。
 *  d) 兼容背题页（/ti/memorize/）、普通练习页、个人中心 / 练习报告页三类结构。
 *
 * v1.6.0（本次改动，仅调整「查看评论」按钮的位置与样式，功能 / 点击逻辑 / 已读未读状态 / 悬浮交互全部不变）：
 *  a) 按钮在 v1.5.0 基础上再向左侧移动 1cm：相对题卡左边缘的偏移由 -1cm 改为 -2cm
 *       （2cm ≈ 75.6px），常量 EXTERNAL_BTN_OFFSET_PX 同步由 37.8 改为 75.6，
 *       CSS 兜底值同步写为 left:-2cm。
 *  b) 按钮外观改为橙色填充：实心橙底（#ff8a00）+ 白色文字，去掉原蓝色半透明描边 / 透明底风格；
 *       （配色已于 v2.0.0 改为黑底白字：背景 #000、文字 #fff、悬浮 #222）
 *       为避免改变按钮盒模型尺寸（进而影响既有定位），保留 1px 边框但取与底色同色。
 *  c) 按钮文案由「💬 查看评论」改为纯文本「查看评论」，移除左侧气泡 / 评论图标。
 *  d) 样式覆盖一律使用 element.style.setProperty / removeProperty 局部写入（配合 CSS 变量），
 *       严禁 style.cssText 整体赋值——那会清空 left / top 等定位内联样式导致按钮错位。
 *
 * v1.7.0（本次改动，仅调整「查看评论」按钮的位置与外形，功能 / 点击逻辑 / 已读未读状态 /
 *        悬浮交互全部不变）：
 *  a) 定位策略改为「优先锚定题卡右下角『退出』按钮的正下方」：在题卡内按可见文本 / title /
 *       aria-label 含「退出」（兼容英文 exit / quit）匹配，并兼顾 exit / quit / close / back
 *       等常见类名与右下角悬浮按钮；命中多个时取最靠右下角者，再上溯到真正可点击的盒子作为基准。
 *       水平在锚点下方居中（并做贴边保护，避免越出外层容器可视宽度），垂直间隔 7px（6~8px 区间）。
 *  b) 兜底：题卡内找不到「退出」锚点时，完整沿用 v1.6.0 的定位（题卡左外侧 2cm、纵向对齐题号行），
 *       不报错、不隐藏按钮；命中模式记录在按钮 data-fcv-anchor（exit / external-left）便于排查。
 *  c) 外形改为正方形：56×56（box-sizing:border-box，常量 EXTERNAL_BTN_SIZE_PX），
 *       橙色填充 #ff8a00 + 白字、圆角 14px 与原有悬浮态（hover 加深为 #f07900）保持不变。
 *       （配色已于 v2.0.0 改为黑底白字 #000/#fff、悬浮 #222；圆角与外形尺寸不变）
 *  d) 文案由单行「查看评论」拆成两行「查看」/「评论」，两个 span 纵向居中排列
 *       （flex-direction:column + justify-content:center），重复注入时按标记跳过重建。
 *
 * v1.8.0（本次改动，仅调整「查看评论」按钮的锚点与位置，功能 / 点击逻辑 / 已读未读状态 /
 *        悬浮交互 / 外观尺寸全部不变）：
 *  a) 锚点改为「题干 + 选项整体盒子」：按优先级 canvas#draft → canvas.pen → [draftdirective]
 *       → canvas 匹配（先题卡内、再页面范围），取该元素的 bounding rect 作为基准盒子；
 *       不可见（宽高为 0）的候选跳过，命中的页面级 canvas 需与本题卡位置相关才采用。
 *  b) 定位到基准盒子**外面的右下角**：水平方向按钮右边缘与盒子右边缘对齐
 *       （left = box.right − 按钮宽），垂直方向落在盒子下边缘之下、间隔 8px
 *       （top = box.bottom + DRAFT_BOX_GAP_PX，7~8px 区间），整体位于盒子外部；
 *       仍做贴边保护，避免越出外层容器可视宽度被裁切。
 *  c) 兜底链：找不到该 canvas 时，回退 v1.7.0 的「退出」按钮下方 →
 *       再回退 v1.6.0 的「题卡左外侧 2cm、纵向对齐题号行」，全程不报错、不隐藏按钮；
 *       命中模式记录在按钮 data-fcv-anchor（draft-box / exit / external-left）便于排查。
 *  d) 同一 canvas 只承载一个按钮（多题共享页面级 canvas 时，其余题卡按钮走兜底链），
 *       避免多个按钮重叠在同一位置。
 *
 * v1.9.0（本次改动，仅调整「查看评论」按钮的落点偏移，锚点 / 外形 / 兜底链 / 点击逻辑 /
 *        已读未读状态 / 悬浮交互全部不变）：
 *  a) 在 v1.8.0 落点（整体盒子外的右下角）基础上，把按钮**整体上移 2cm、右移 2cm**：
 *       left = box.right − 按钮宽 + NUDGE_RIGHT_PX（+75.6px）；
 *       top  = box.bottom + DRAFT_BOX_GAP_PX − NUDGE_UP_PX（−75.6px）。
 *  b) 为让这 2cm 位移精确生效，**取消该落点的贴边夹取**（不再把 left 夹回外层容器可视宽度内），
 *       否则按钮贴到容器 / 视口边缘时位移会被夹回、实际落点与预期不符。
 *       兜底链（「退出」按钮下方 → 题卡左外侧 2cm）沿用原实现与其原有夹取行为，不做改动。
 *
 * v2.0.0（本次改动，仅调整「查看评论」按钮的落点微调量与配色，锚点 / 外形 / 兜底链 /
 *        点击逻辑 / 已读未读状态 / 悬浮交互全部不变）：
 *  a) 在 v1.9.0 落点基础上，把按钮**再上移 1cm、再左移 0.3cm**
 *       （1cm ≈ 37.8px、0.3cm ≈ 11.34px）：
 *       left = box.right − 按钮宽 + NUDGE_RIGHT_PX − NUDGE_LEFT_EXTRA_PX；
 *       top  = box.bottom + DRAFT_BOX_GAP_PX − NUDGE_UP_PX − NUDGE_UP_EXTRA_PX。
 *       合并后净位移为「右移 64.26px（约 1.7cm）、上移 113.4px（约 3cm）」。
 *  b) 该落点继续**不做贴边夹取**（v1.9.0 已取消），保证上述位移量精确生效。
 *  c) 配色由橙色填充改为**黑底白字**：背景 #000、文字 #fff、悬浮态加深为 #222（不再使用
 *       #ff8a00 / #f07900）；仍由 CSS 变量 --fcv-btn-bg / --fcv-btn-bg-hover / --fcv-btn-fg
 *       经 style.setProperty 注入，边框取与底色同色以保持盒模型尺寸不变。
 *  d) 样式覆盖一律使用 element.style.setProperty / removeProperty 局部写入，
 *       严禁 style.cssText 整体赋值——那会清空 left / top 等定位内联样式导致按钮错位。
 *
 * v2.1.0（本次改动，仅调整「查看评论」按钮的首选锚点与落点，外形 / 配色 / 三级兜底链 /
 *        点击逻辑 / 已读未读状态 / 悬浮交互全部不变）：
 *  a) 首选锚点由 canvas#draft.pen 改为现场实测的「题干 + 选项盒子」：
 *       CHOICE_BOX_SELECTORS = ['.question-choice-container', 'app-question-choice']，
 *       即外层 <app-question-choice>、内层 <div class="question-choice-container">；
 *       查找顺序：题卡内命中 → 页面级同名（要求与本题卡纵向相关，容差
 *       DRAFT_BOX_CARD_TOLERANCE_PX）→ 仍无则降级到下一级兜底；不可见（宽高为 0）候选跳过；
 *       并保留「一盒子一按钮」去重（同一盒子已被别的按钮锚定时本次放弃）。
 *  b) 落点改为按钮**左下角**与盒子**右下角**精确重合：
 *       left = box.right（相对外层容器的偏移 = box.right − container.left + scrollLeft，
 *                          **不减按钮宽**）；
 *       top  = box.bottom − 按钮高（按钮高 56）。
 *  c) 该分支**取消全部位移增量与贴边夹取**：v1.9.0 的 +75.6 / −75.6、v2.0.0 的 −37.8 /
 *       −11.34 以及 clampLeft 夹取均不再作用于该分支，保证两点严格重合；
 *       clampLeft 仅保留在「退出」按钮兜底分支（D10 静态约束可回归验证）。
 *  d) 原 canvas#draft.pen 落点降为第二级兜底（其位移量与不夹取行为原样保留），
 *       其后依次为「退出」按钮正下方 → 题卡左外侧 2cm；全程不报错、不隐藏按钮。
 *  e) 样式写入方式、按钮尺寸（56×56）、圆角 14px、黑底白字与 hover #222 均与 v2.0.0 一致，
 *       窗口 resize 仍自动重算定位。
 *
 * v2.2.0（历史记录：曾把首选定位从「一次性算死绝对坐标」改为「盒子内挂载 + CSS 自动跟随」，
 *         该挂载方式已于 v2.3.0 回退 —— 按钮必须位于盒子外部，详见文末 v2.3.0 条目）：
 *  a) 首选命中「题干 + 选项盒子」时，按钮不再用 JS 算 left/top，而是**作为该盒子的子元素挂载**：
 *       盒子若为 static 则补 position:relative（记为临时修改，可还原），按钮用 position:absolute
 *       以盒子**右下角**为基准（仍保证「按钮左下角 == 盒子右下角」）：
 *         left: calc(100% + var(--fcv-anchor-dx))，--fcv-anchor-dx = 盒子 border-right 宽
 *         top:  calc(100% + var(--fcv-anchor-dy))，--fcv-anchor-dy = 盒子 border-bottom 宽 − 按钮高
 *       注意：绝对定位的包含块就是该盒子的 padding box，故 100% 已经包含 padding，
 *       补偿值只需补 border 宽（再叠加 padding 反而会与盒子右/下边缘错位）。
 *       这样盒子移动 / 变形 / 页面滚动时按钮由 CSS 自动跟随，**不再需要任何重算**，也就不会再脱节。
 *  b) 防裁切（最小侵入）：从盒子起向上遍历祖先链，只把**确实会裁到按钮**（按钮矩形越出其 padding box）
 *       且 overflow 非 visible 的容器临时改为 overflow:visible；原内联值会被记录，
 *       退出该模式（降级到兜底链）时还原。
 *  c) 兜底同步：ResizeObserver（文档根 + 各锚点盒子）+ 捕获阶段 scroll + 全局 MutationObserver
 *       统一走**节流**校验（verifyInboxAnchors，最小间隔 100ms、同一时刻只挂一个定时器），
 *       发现「父节点变了 / 定位祖先变了 / 两角不再重合」才重新定位；脚本自身写入被过滤，
 *       且校验在正常情况下只读不写，因此不会自触发、也不会在同帧反复抖动。
 *  d) 降级到 canvas#draft.pen / 「退出」按钮 / 题卡左外侧这几级兜底时，会退出盒子内挂载模式
 *       （还原临时样式并把按钮搬回外层容器），旧的绝对定位公式与位移量原样保留。
 *  e) 锚点选择器优先级、外形配色、三级兜底链、点击与已读/未读逻辑、setProperty 写入方式均不变。
 *
 * v2.3.0（本次改动：纠正 v2.2.0 的挂载位置 —— 按钮必须在盒子**外部**，同时保留动态跟随能力）：
 *  a) 挂载点回退到题卡外层容器（.fcv-question-mount / 题卡父节点）：按钮**不再**挂在
 *     .question-choice-container / app-question-choice 内部。升级时 v2.2.0 的盒子内挂载残留
 *     （fcv-btn-inbox 类、盒子被临时改的 position、祖先被临时放开的 overflow、--fcv-anchor-dx/dy 变量）
 *     由 migrateLegacyInboxButton 一次性还原并搬回外层容器，随后按新规则重新落坐标。
 *  b) 落点不变：仍是「按钮左下角 == 盒子右下角」——
 *       left = box.right − 外层容器 left (+ 容器滚动量)
 *       top  = box.bottom − 外层容器 top (+ 容器滚动量) − 按钮高(56)
 *     该分支不叠加任何 nudge 位移增量、也不做贴边夹取，保证两点严格重合。
 *  c) 动态跟随（本次核心）：不再依赖 CSS 相对定位，改为四种信号 + requestAnimationFrame 节流实时重算：
 *     ① ResizeObserver 观察文档根 / 文档体与每个命中的锚点盒子（盒子尺寸变化 = 内容重排）；
 *     ② 捕获阶段 scroll —— 滚动事件不冒泡，捕获阶段才能同时收到 window 与任意内部滚动容器；
 *     ③ MutationObserver（childList + style/class）—— 切题、展开解析、框架重渲染；
 *     ④ window resize。四路信号统一经 rAF 合帧（无 rAF 时退化为 16ms 定时器），
 *        同一帧内的多次触发只重算一次；写回前与上次 left/top 比对去重，
 *        既省去无谓的样式写入，也切断「写样式 → MutationObserver 自触发」的回环。
 *  d) 其余保持 v2.1.0/v2.2.0 行为：锚点优先级（.question-choice-container → app-question-choice →
 *     页面级同名 → canvas#draft.pen → 「退出」按钮下方 → 题卡左外侧 2cm）、外形（56×56、黑底白字、
 *     两行「查看/评论」、圆角 14px、hover #222）、点击与已读/未读逻辑、setProperty 局部写入方式均不变；
 *     废弃的 .view-comments-btn--inbox 规则已删除。
 *
 * v2.4.0（本次改动：新增评论级「复制」/「收藏」按钮 + WebDAV 配置，既有定位/挂载/拦截逻辑零改动）：
 *  a) 复制：每条评论的 footer 里新增「复制」按钮，点击复制该条评论正文
 *     （navigator.clipboard.writeText 优先，失败回退「临时 textarea + execCommand」），成功后按钮短暂显示「已复制」。
 *  b) 收藏（WebDAV 追加写）：每条评论新增「收藏」按钮，点击把该条评论以 Markdown 记录写入远端文件：
 *     先 GET 远端已有内容 → 按题目聚合合并 → 整体 PUT 回写；用 ETag 做乐观锁（If-Match / 新建时 If-None-Match:*），
 *     命中 412/409/428 时重读重试（最多 FAV_MAX_REMOTE_RETRY 次），避免覆盖其它端刚写入的内容；
 *     上级目录不存在时用 MKCOL 尽力创建；每条记录带隐藏标记 <!-- fcv:comment:ID --> 作为判重依据。
 *     v2.5.0 起不再「整文件末尾追加单条」，改为「按题目聚合」（见下方 v2.5.0 说明）。
 *  c) 配置：服务器地址 / 账号 / 密码 / 保存路径，GM_setValue 优先、localStorage 兜底；
 *     入口为油猴菜单、评论弹窗右上角齿轮、控制台 __fenbiCV.webdav.settings()；面板内含填写示例、连接测试、清空配置。
 *  d) 未配置时点「收藏」：明确提示「请先配置 WebDAV 地址和账号」并给「去配置」按钮直达面板；
 *     已收藏的评论显示「已收藏」标记并阻止重复写入（本机 ID 集合 + 远端隐藏标记双重判重）。
 *  e) 运行环境：为解决跨域写 WebDAV 与油猴菜单，脚本改为显式声明 GM_* 授权（不再是 @grant none）。
 *     为不破坏既有拦截能力，XHR / fetch 改写统一改为操作「页面真实 window」（PAGE_WINDOW，unsafeWindow 优先），
 *     displayComments / createModal / 按钮注入 / 动态跟随等既有逻辑除追加按钮外一字未改。
 *
 * v2.5.1（本次改动：只修「选项提取错位」，定位 / 挂载 / 评论拉取 / 复制 / 配置面板 / 写入事务逻辑零改动）：
 *  选项取材改为「只取最内层真实选项 + 字母读真实前缀并剥离 + 按字母去重排序」，详见下方 e) 与 h)。
 *
 * v2.5.0（本次改动：仅重构「收藏到 WebDAV」的文件格式与写入逻辑，评论拉取 / 按钮定位 / 复制 / 配置面板框架零改动）：
 *  a) 收藏文件结构改为**按题目聚合**：每道题一个区块，区块自顶向下为
 *       <!-- fcv:question:<题目唯一ID> -->  →  题目标题（第 N 题）→  题干  →  选项（A/B/C/D 逐行）→ 「收藏的评论」列表。
 *     同一道题的多条收藏评论都落在同一个区块的评论区里（新评论插到该区末尾），不同题目各自成块。
 *  b) 评论条目只保留两项：`> 收藏时间：YYYY-MM-DD HH:mm:ss` 与正文引用（blockquote 多行）；
 *     昵称 / 评分 / 点赞 / 地区 / 评论时间 / 评论 ID 行 / episodeId 行 / 来源页等展示字段全部去除。
 *  c) 隐藏标记：每条评论 <!-- fcv:comment:<评论ID> -->（判重依据，逻辑与 v2.4.0 一致）；
 *     每个题目区块 <!-- fcv:question:<题目唯一ID> -->（聚合依据）。两者的正则都带
 *     `(?!\s*\.\.\.)` 负向断言，确保文件头里的示例占位 `<!-- fcv:comment:... -->` / `<!-- fcv:question:... -->`
 *     不会被计入统计，也不会被当成真实区块。
 *  d) 写入逻辑（mergeFavoriteIntoMarkdown）：读远端 → ① 该评论标记已存在则判重跳过；
 *     ② 该题区块已存在 → 把评论块插到「该题区块」评论区末尾（下一个题目标记之前）；
 *     ③ 该题区块不存在 → 在文件末尾新建完整题目区块。随后整体回写，ETag 乐观锁与 412/409/428 重试完全保留。
 *  e) 题目信息取材：resolveQuestionCard() 按注入序号反查题卡（评论按钮 closest 反查优先，题卡列表下标 /
 *     题号文本换算兜底），extractQuestionMetaFromCard() 从题卡 DOM 里取题干（不属于「最内层真实选项」的
 *     第一个 app-format-html / .format-html，另有 .question-stem 等兜底选择器）与选项（app-choice-radio /
 *     .choice-radio / .option-item / li.choice / .choice-item）。
 *     v2.5.1 选项取材规则：
 *       ① 只取最内层真实选项节点 —— 用 hasInnerChoiceNode() 丢掉「内部还包含候选节点」的外层容器
 *          （容器的 textContent 是全部选项拼接，会被当成一个选项，是本次错位的根因）；
 *       ② 字母以节点文本开头的真实字母为准（parseChoiceText() 支持「A 举棋不定」「A. / A、/（A）/ A：」等，
 *          解析后剥离前缀，杜绝「B. A 举棋不定」式字母重复；解析不到才用 withChoiceLetter() 按顺序兜底）；
 *       ③ 过滤空项与整组拼接文本项（looksLikeConcatenatedChoices() 兜底识别 3 个以上「字母+内容」片段）；
 *       ④ 按字母去重（同字母保留首次出现）并排序；无字母项按 DOM 顺序排在末尾后统一兜底补字母。
 *     题干归属判断同步改用 isInsideRealChoice()（沿 closest 向上跳过容器、只认「最内层真实选项」），
 *     与选项取材保持同一口径。
 *     任一环节取不到都只返回空值并记一条日志，收藏照常写入（题干 / 选项处显示「（未取到题干）」等占位），不报错、不阻断。
 *  f) 题目唯一 ID（聚合键）优先取 state.solutionIds[index]（题目 ID），退回 `episode-<episodeId>`；两者都没有时用 `unknown`。
 *  g) 文件头 FAV_FILE_HEADER 同步改写成新结构的说明；配置面板「写入方式」说明与连接测试结果（题目区块数 / 收藏条数）同步更新；
 *     控制台新增 __fenbiCV.webdav.mergeFavorite / countQuestionBlocks / extractQuestionMeta 便于自查格式。
 *  h) v2.5.1 修复「选项提取错位」：同一题库题目真实选项为「A 举棋不定 / B 扑朔迷离 / C 众说纷纭 / D 悬而未决」，
 *     v2.5.0 却写出「A. A 举棋不定 B 扑朔迷离 C 众说纷纭 D 悬而未决 / B. A 举棋不定 / C. B 扑朔迷离 /
 *     D. C 众说纷纭 / E. D 悬而未决」。根因是选项容器与容器内子项被同时选中、且字母按计数递推。
 *     现按 e) 的 ①②③④ 规则取材，并把 extractQuestionMetaFromCard 内部的选项解析拆成可单测的纯函数
 *     （hasInnerChoiceNode / isInsideRealChoice / parseChoiceText / looksLikeConcatenatedChoices），
 *     便于离线用假 DOM 回归。
 *
 * v2.6.5（本次改动：给评论「收藏」按钮补上「取消收藏」，评论拉取 / 按钮定位 / 复制 / 配置面板框架零改动）：
 *  a) 已收藏的评论再次点击「收藏」按钮即取消收藏：removeFavoriteFromWebdav(cfg, commentMarker) 沿用
 *     「读远端 → 改 → 整体回写」事务与 ETag 乐观锁（412/409/428 重读重试、404/405 建目录后重试），
 *     与 appendCommentToWebdav 是同一套并发控制，不做「删除后重排文件」之类的高危改动。
 *  b) 移除规则由纯函数 removeFavoriteFromMarkdown(existingText, commentMarker) 决定（可离线单测）：
 *     ① 该评论标记不存在 → removed:false，内容原样返回，远端文件绝不被改动；
 *     ② 该题区块下仍有其它收藏 → 只摘掉这条评论块（标记行 + 其后的引用行），题目区块与其它收藏保持不动；
 *     ③ 该题区块下已无其它收藏 → 整个题目区块（题目标题 / 题干 / 选项 / 收藏的评论）一并移除，
 *        并把区块之间的多余空行收拢为「区块之间一个空行、文件末尾一个换行」；
 *     ④ 评论标记不在任何题目区块内（异常格式）→ 只摘评论块，绝不删题目区块与文件头。
 *  c) 按钮状态与文案同步：未收藏「收藏」/ 已收藏「已收藏」（悬浮时切换为「取消收藏」，标题提示可点击取消）
 *     / 操作中「收藏中」「取消中」（data-fcv-busy 拦截重复点击）；取消成功后本机已收藏 ID 集合同步移除
 *     （unmarkFavLocally），失败则回滚为「已收藏」并提示原因。
 *  d) 远端无记录（文件不存在 / 没有这条评论）时以「本机标记同步清除 + 明确提示」收尾，不覆盖远端内容。
 *  e) 控制台新增 __fenbiCV.webdav.removeFavorite(existingText, commentMarker) / favMarker(commentId)，便于离线演练移除结果。
 *
 * v2.7.0（本次改动：新增「我的收藏」入口与收藏列表面板；既有收藏 / 取消收藏写入逻辑、按钮定位、评论拉取零改动）：
 *  a) 入口按钮：ensureFavoritesEntryButton() 在 document.body 上注入一个固定定位的「★ 我的收藏」按钮
 *     （id=fcv-fav-entry，右上角，z-index 2147482000 与题卡评论按钮同级、低于脚本自身弹窗 / 遮罩层，
 *     弹窗打开时被遮罩覆盖），由 initializeCommentButtons() 与 syncCommentButtons() 双处幂等调用，
 *     页面重渲染后会自动补回；点击打开收藏面板，不进题卡、不改动「查看评论」按钮的任何定位逻辑。
 *  b) 收藏面板：openFavoritesPanel() 复用 createModal()（评论弹窗的模态框骨架 + 主题适配 + Esc / 遮罩关闭），
 *     额外在标题栏下方插一条工具条（视图切换 + 状态文字）、在内容区下方插一条底栏
 *     （连接测试 / WebDAV 设置 / 刷新列表 + 结果区）；面板自身用 overflow 滚动，不改变页面布局。
 *     同一时刻只保留一个面板（favPanelRef），重复点击入口时只是刷新列表。
 *  c) 解析链路（纯函数，可离线单测）：parseFavoritesMarkdown(text) 用 findQuestionMarkerOffsets 切题目区块，
 *     逐块解析题目标题（## 行）、题干（**题干** 段）、选项（**选项** 段的行首 - 项）与评论区
 *     （**收藏的评论** 段），评论区再按 <!-- fcv:comment:ID --> 标记切条，条内取 `> 收藏时间：…` 与引用正文；
 *     collectFavoriteComments(parsed) 把评论区扁平化并附上所属题目信息，按收藏时间倒序（无时间 / 同时间保持文件顺序）；
 *     favPreviewLine(text, max) 生成单行预览。文件头里的示例占位标记仍被 `(?!\s*\.\.\.)` 断言排除。
 *  d) 渲染：评论视图每条一行（收藏时间 + 题号标签 + 「展开」「删除」），「展开」在同一行下方展开
 *     题号 / 题目 / 题干 / 选项 / 完整正文（正文超长时收起态只显示预览）；题目视图按题成组，
 *     「展开」显示题干 / 选项 + 该题下的收藏评论列表（每条带独立删除按钮）。
 *     所有用户内容一律走 textContent 写入，不用 innerHTML 拼接，避免评论正文里的 HTML 影响面板。
 *  e) 删除：handlePanelDelete() 行内二次点击确认（4s 内未确认自动还原），确认后调用既有的
 *     removeFavoriteFromWebdav(cfg, favMarker(commentId))（不复制粘贴写入逻辑、不改事务），
 *     成功则 unmarkFavLocally(commentId) + reloadFavorites() 刷新列表（该题仅剩一条时题块被整块移除、
 *     远端文件不存在 / 已无这条记录等分支均有对应提示），失败则还原按钮并提示原因。
 *  f) 状态与空态：未配置 WebDAV → 「去配置」引导；读取失败 → 显示原因 + 重试 / 连接测试；
 *     暂无收藏 → 空状态说明（含保存路径与本机「已收藏」计数）；列表底部状态行显示
 *     收藏评论数 / 题目区块数 / 远端文件路径。
 *  g) 入口补挂：油猴菜单新增「★ 我的收藏」；控制台新增 __fenbiCV.webdav.parseFavorites(text) /
 *     listFavorites() / openFavorites() / deleteFavorite(commentId)，便于离线自查与手动管理。
 */

(function () {
  'use strict';

  // ============================ 常量与状态 ============================
  const DEFAULT_AVATAR = 'https://static.fenbi.com/res/avatar/default.png';
  const COMMENT_BTN_CLASS = 'view-comments-btn';
  const COMMENT_FEATURE_VERSION = '2.7.0';
  // v2.8.3：脚本发布版本号。COMMENT_FEATURE_VERSION 只代表「评论接口/功能」版本，
  // 它长期停在 2.7.0，**不能**用来判断浏览器里装的是哪一版脚本（曾因此误判「已更新」）。
  // 判断是否装到新版：控制台执行 __fenbiCV.version 或 __fenbiCV.collect().scriptVersion，
  // 或看 <html data-fenbi-comment-viewer="x.y.z">。此处必须与文件头 @version 保持一致。
  const SCRIPT_VERSION = '2.8.3';
  // v1.6.0：按钮外部定位常量。2cm ≈ 75.6px（CSS 里也可直接写 left:-2cm），
  // 这里用 px 便于 JS 精确对齐题号行、并避免不同 DPR 下的换算误差。
  const EXTERNAL_BTN_OFFSET_PX = 75.6;
  // v2.6.2：cm → px 的唯一换算口径（CSS 标准 96dpi）：px = cm × 96 ÷ 2.54 ≈ cm × 37.795px。
  // 与既有 1cm ≈ 37.8px、2cm ≈ 75.6px 完全一致；新增位移量一律由此常量推算，
  // 禁止再引用 cmPerInch 之类脚本里并不存在的变量（曾导致脚本初始化即抛错、按钮不注入）。
  const PX_PER_CM = 96 / 2.54;
  // v1.7.0：按钮改为正方形（56×56，与 CSS 兜底值保持一致）；
  // v2.6.0：缩小一半至 28×28，浅灰底（#d8d8d8），hover #c4c4c4；
  // 并优先定位到题卡右下角「退出」按钮正下方，垂直间隔 EXIT_ANCHOR_GAP_PX（6~8px 区间，取 7px）。
  const EXTERNAL_BTN_SIZE_PX = 28;
  const EXIT_ANCHOR_GAP_PX = 7;
  // v1.8.0：按钮首选锚点改为「题干 + 选项整体盒子」——页面上的 canvas#draft.pen
  // （<canvas id="draft" class="pen" draftdirective …>），按「具体 → 宽泛」优先级逐级匹配。
  // 取该元素的 bounding rect 作为基准盒子，按钮放到盒子**外面的右下角**：
  // 右边缘与盒子右边缘对齐，下边缘落在盒子 bottom 之下、间隔 DRAFT_BOX_GAP_PX（7~8px 区间，取 8px）。
  const DRAFT_BOX_SELECTORS = ['canvas#draft', 'canvas.pen', '[draftdirective]', 'canvas'];
  const DRAFT_BOX_GAP_PX = 8;
  // v1.8.0：页面级 canvas 命中时，允许与本题卡纵向相差的容差（px）。
  // 画布常挂在题目区域外层 / 页面级容器里，与题卡并非严格包含关系，故用容差判断「是否属于本题」。
  const DRAFT_BOX_CARD_TOLERANCE_PX = 200;
  // v1.9.0：按钮落点的固定位移量（微调落点用）——在 v1.8.0 落点基础上整体右移 2cm、上移 2cm。
  // 2cm ≈ 75.6px（与 EXTERNAL_BTN_OFFSET_PX 同一换算口径），只在「整体盒子外的右下角」这一级生效。
  const NUDGE_RIGHT_PX = 75.6;
  const NUDGE_UP_PX = 75.6;
  // v2.0.0：在上述落点上再叠加的位移量——再上移 1cm、再左移 0.3cm。
  // 1cm ≈ 37.8px、0.3cm ≈ 11.34px（与 2cm ≈ 75.6px 同一换算口径）。
  // 仅作用于「整体盒子外的右下角」这一级，合并后净位移为右移 64.26px、上移 113.4px。
  const NUDGE_UP_EXTRA_PX = 37.8;
  const NUDGE_LEFT_EXTRA_PX = 11.34;
  // v2.1.0：首选锚点改为「题干 + 选项盒子」——外层 <app-question-choice>、
  // 内层 <div class="question-choice-container">（内含题干 app-format-html 与选项 app-choice-radio）。
  // 按「具体 → 宽泛」优先级匹配：先 .question-choice-container、再 app-question-choice。
  // 落点：按钮**左下角**与该盒子**右下角**精确重合
  // （left = box.right；top = box.bottom − 按钮高），本级不再使用任何位移增量、也不做贴边夹取。
  const CHOICE_BOX_SELECTORS = ['.question-choice-container', 'app-question-choice'];
  // v2.3.0：按钮**始终挂在盒子外部**（题卡外层容器 .fcv-question-mount），坐标由 JS 实时重算；
  // 动态跟随不再依赖「盒子内挂载 + CSS 相对定位」，而是四路信号统一经 requestAnimationFrame 节流：
  //   ResizeObserver（文档根 + 每个锚点盒子）+ 捕获阶段 scroll（window 与内部滚动容器）
  //   + MutationObserver（childList + style/class）+ window resize → 重算 left/top 并写回。
  // 写回前与上次值比对去重：既省无谓的样式写入，也切断「写样式 → MutationObserver 自触发」的回环。
  const LEGACY_INBOX_CLASS = 'fcv-btn-inbox';    // v2.2.0 遗留的「盒子内挂载」标记类（仅用于升级迁移清理）
  const FOLLOW_MAX_BOXES = 300;                  // 同时纳入 ResizeObserver 的锚点盒子上限（防失控）
  const FOLLOW_RAF_FALLBACK_MS = 16;             // 环境无 requestAnimationFrame 时的兜底节流间隔（约一帧）
  // v1.7.0：题卡内「退出」按钮的识别规则：
  // 可见文本 / title / aria-label 含「退出」（兼容英文 exit / quit），并兼顾常见类名 exit / quit / close / back。
  const EXIT_TEXT_RE = /退出|exit|quit/i;
  const EXIT_CLASS_RE = /exit|quit|close|back/i;
  const EXIT_CANDIDATE_SELECTOR = 'button,[role="button"],a,i,em,span,div,' +
    '[class*="exit"],[class*="quit"],[class*="close"],[class*="back"],[title],[aria-label]';
  const QUESTION_MOUNT_CLASS = 'fcv-question-mount';

  // v2.4.0：页面真实 window。本次为「跨域写 WebDAV」和「油猴菜单」显式声明了 GM_* 授权，
  // 在油猴沙箱下直接改写 window.XMLHttpRequest / window.fetch 未必落到页面对象上，
  // 故统一经 PAGE_WINDOW（unsafeWindow 存在时优先）取到真实页面 window，
  // 保证既有的 XHR / fetch 拦截与评论拉取逻辑在「页面上下文」和「油猴沙箱」两种运行环境下都照常生效。
  const PAGE_WINDOW = (function () {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.XMLHttpRequest) return unsafeWindow;
    } catch (e) { /* 无 unsafeWindow（例如 @grant none）时退回页面 window */ }
    return window;
  })();

  // v2.4.0：评论「收藏」用到的 WebDAV 常量
  const WEBDAV_STORE_KEY = 'fcv_webdav_config_v1';  // 配置持久化键（服务器地址 / 账号 / 密码 / 保存路径）
  const FAV_STORE_KEY = 'fcv_fav_comment_ids_v1';   // 本机已收藏评论 ID 列表（用于「已收藏」状态标记）
  const DEFAULT_WEBDAV_FILE = 'fenbi-comments.md';  // 保存路径默认值（相对 WebDAV 根目录）
  const JIANGUOYUN_ROOT_DIR = '我的坚果云';         // 坚果云 WebDAV 虚拟服务根下唯一的真实挂载目录（保存路径只填文件名时自动补全）
  const WEBDAV_TIMEOUT_MS = 30000;                  // 单次 WebDAV 请求超时（毫秒）
  const FAV_MAX_REMOTE_RETRY = 2;                   // 远端并发冲突（412 等）时的最大重试次数
  const FAV_ID_KEEP_MAX = 5000;                     // 本机记录的已收藏 ID 上限（超出后丢弃最早的）
  const FAV_MARKER_HEAD = '<!-- fcv:comment:';      // 远端文件里每条收藏评论的隐藏标记（判重依据）
  const FAV_MARKER_TAIL = ' -->';
  // v2.5.0：题目区块的隐藏标记（同一道题的收藏评论聚合到同一区块，靠它定位）
  const FAV_Q_MARKER_HEAD = '<!-- fcv:question:';
  // 远端文件不存在时写入的文件头（仅首次创建时使用）
  const FAV_FILE_HEADER = [
    '# 粉笔评论收藏（Fenbi Comment Viewer）',
    '',
    '> 本文件由「粉笔评论查看器」油猴脚本自动维护，按**题目聚合**：每道题一个区块，',
    '> 区块内自上而下为题目标题（第 N 题）→ 题干 → 选项（A/B/C/D 逐行）→ 收藏的评论。',
    '> 同一道题再收藏新评论时，评论会并入该题区块的「收藏的评论」区末尾，不会新建重复区块。',
    '> 每条评论只保留两项：收藏时间、评论正文（引用格式）。',
    '> 取消收藏时，本文件会移除该条评论；若该题区块下已无其它收藏，题目区块会一并移除。',
    '> 写入方式为「先读取本文件已有内容 → 并入该题区块（没有该题区块则在末尾新建）→ 整体回写」，',
    '> 并用 WebDAV ETag 乐观锁防止覆盖并发改动。',
    '> 请勿删除两类隐藏标记：题目区块标记（形如 `<!-- fcv:question:... -->`）是题目区块的聚合依据，',
    '> 评论标记（形如 `<!-- fcv:comment:... -->`）是评论判重依据（脚本靠它避免重复写入同一条评论）。',
    '',
  ].join('\n');

  // episode 映射接口的 tiku_type 候选值（实测 tiku_prefix 必须与 tiku_type 配对，
  // 如 sydw<->5、gwy<->1，用错组合会返回 {"code":-1,"msg":"tiku_prefix 错误"}）
  const EPISODE_TIKU_TYPES = [5, 1, 3, 2, 4];

  const state = {
    solutionIds: [],              // 当前页面题目 ID 列表（有序）
    episodeIds: [],               // 与 solutionIds 一一对应的 episodeId
    // 评论接口路径前缀：初始种子值仅在「未拦截到任何带 tiku_prefix 的请求」时兜底，
    // 实际值一律以拦截到的请求 URL 参数 tiku_prefix 为准（背题页 /ti/memorize/ 实测为 xingce）
    currentTikuPrefix: 'xingce',
    episodeDataBySolutionId: {},  // solutionId -> 原始 episode 数据桶
  };

  // ============================ 运行时诊断（v1.2.0 新增） ============================
  // 设计目标：把「拦截到了什么 / 抓到几个题号 / 映射到几个 episodeId / 当前 prefix /
  // 注入了几个按钮」全部变成可观测数据，既输出到 console，也渲染到右下角自检浮标。
  const LOG_PREFIX = '[FenbiComment]';
  const MAX_XHR_KEEP = 40;    // 请求列表最多保留条数
  const MAX_LOG_KEEP = 60;    // 日志最多保留条数
  const STATIC_ASSET_RE = /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|mp4|m3u8)(\?|$)/i;

  const diag = {
    startedAt: new Date(),
    xhrSeen: [],         // 页面发出的非静态请求: {at, method, url, matched[]}
    xhrMatchedCount: 0,  // 命中拦截 pattern 的请求条数
    logs: [],            // 关键阶段日志: {at, level, text}
    lastError: null,     // {at, text, stack}
  };

  function diagTs() {
    const d = new Date();
    const p = (n, w) => String(n).padStart(w, '0');
    return p(d.getHours(), 2) + ':' + p(d.getMinutes(), 2) + ':' + p(d.getSeconds(), 2) + '.' + p(d.getMilliseconds(), 3);
  }

  function diagFormat(v) {
    if (v == null) return String(v);
    if (v instanceof Error) return v.message;
    // 兼容跨 realm / 非 Error 实例的错误对象（例如 iframe、扩展注入环境抛出的异常）
    if (isObj(v) && typeof v.message === 'string' && v.message) return v.message;
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  function isErrorLike(v) {
    return v instanceof Error || (isObj(v) && typeof v.message === 'string' && typeof v.name === 'string');
  }

  function pushLog(level, args) {
    const text = args.map(diagFormat).join(' ');
    diag.logs.push({ at: diagTs(), level: level, text: text });
    if (diag.logs.length > MAX_LOG_KEEP) diag.logs.shift();
    return text;
  }

  function logInfo() { console.log(LOG_PREFIX, pushLog('info', Array.prototype.slice.call(arguments))); }
  function logWarn() { console.warn(LOG_PREFIX, pushLog('warn', Array.prototype.slice.call(arguments))); }
  function logError() {
    const args = Array.prototype.slice.call(arguments);
    const err = args.find((x) => isErrorLike(x));
    diag.lastError = { at: diagTs(), text: pushLog('error', args), stack: err && err.stack ? err.stack : '' };
    console.error.apply(console, [LOG_PREFIX].concat(args));
  }

  function shortenUrl(u) {
    return String(u == null ? '' : u).replace(/^https?:\/\//, '').slice(0, 150);
  }

  // 记录页面发出的请求（只观测，不改变行为），用于回答「为什么没拦住」
  function recordRequest(method, url) {
    const u = String(url == null ? '' : url);
    if (!u || u.startsWith('data:') || u.startsWith('blob:') || STATIC_ASSET_RE.test(u)) return;
    let matched = [];
    try {
      matched = interceptors.filter((ic) => u.indexOf(ic.pattern) !== -1).map((ic) => ic.pattern);
    } catch (e) { matched = []; }
    if (matched.length) diag.xhrMatchedCount++;
    diag.xhrSeen.push({ at: diagTs(), method: method || 'GET', url: u.slice(0, 220), matched: matched });
    if (diag.xhrSeen.length > MAX_XHR_KEEP) diag.xhrSeen.shift();
    if (matched.length) logInfo('拦截命中', matched.join(' + '), shortenUrl(u));
    return matched;
  }

  function countQuestionAnchors() {
    const sels = [
      '.tis-container .ti', '.ti .title-right', '.solution-detail .question',
      // v2.8.2：资料分析题组内每题一个 app-ti（诊断时用于确认题组是否已按小题展开）
      'app-ti',
      'fb-local-question, fb-recitatation-question', '#app-report-ques-solution .solution-item',
    ];
    const out = {};
    sels.forEach((s) => { out[s] = document.querySelectorAll(s).length; });
    return out;
  }

  function episodeMappedCount() {
    if (!Array.isArray(state.episodeIds)) return 0;
    return state.episodeIds.filter((v) => v != null).length;
  }

  // 汇总当前全部可观测中间态（浮标 / 诊断弹窗 / console 共用）
  function collectDiagnostics() {
    let profileRoute = null;
    try { profileRoute = isProfileRoute(); } catch (e) { profileRoute = null; }
    return {
      // v2.8.3：自检报告/浮标统一展示真实脚本版本（旧版这里显示固定的 2.7.0，无法判断是否已更新）
      version: SCRIPT_VERSION,
      scriptVersion: SCRIPT_VERSION,
      commentFeatureVersion: COMMENT_FEATURE_VERSION,
      page: location.href,
      isProfileRoute: profileRoute,
      currentTikuPrefix: state.currentTikuPrefix,
      solutionIdsCount: state.solutionIds.length,
      solutionIdSample: state.solutionIds.slice(0, 5),
      episodeMappedCount: episodeMappedCount(),
      episodeBuckets: Object.keys(state.episodeDataBySolutionId).length,
      buttonsInjected: document.querySelectorAll('.' + COMMENT_BTN_CLASS).length,
      xhrMatchedCount: diag.xhrMatchedCount,
      xhrSeenCount: diag.xhrSeen.length,
      questionAnchors: countQuestionAnchors(),
      startedAt: diagTs(),
    };
  }

  // 生成纯文本诊断报告（供复制粘贴反馈）
  function buildDiagnosticText() {
    const d = collectDiagnostics();
    const lines = [];
    lines.push('==== 粉笔评论查看器 自检报告 v' + d.version + ' ====');
    lines.push('时间: ' + new Date().toLocaleString());
    Object.keys(d).forEach((k) => lines.push('  ' + k + ': ' + diagFormat(d[k])));
    lines.push('-- 已捕获请求（保留 ' + diag.xhrSeen.length + ' 条，命中 ' + diag.xhrMatchedCount + ' 条） --');
    diag.xhrSeen.forEach((x) => {
      lines.push('  [' + x.at + '] ' + x.method + ' ' + x.url + (x.matched.length ? '   <= 命中: ' + x.matched.join(',') : ''));
    });
    lines.push('-- 关键日志（最近 ' + diag.logs.length + ' 条） --');
    diag.logs.forEach((l) => lines.push('  [' + l.at + '] ' + l.level + ' ' + l.text));
    if (diag.lastError) {
      lines.push('-- 最近错误 --');
      lines.push('  [' + diag.lastError.at + '] ' + diag.lastError.text);
      if (diag.lastError.stack) lines.push(diag.lastError.stack);
    }
    return lines.join('\n');
  }

  function copyDiagnostics() {
    const text = buildDiagnosticText();
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        logInfo('诊断信息已复制（fallback）');
      } catch (e) { logWarn('复制失败，请在控制台执行 __fenbiCV.dump()', e && e.message ? e.message : String(e)); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => logInfo('诊断信息已复制到剪贴板'), fallback);
    } else fallback();
  }

  // ============================ 基础工具 ============================
  function isObj(v) { return typeof v === 'object' && v !== null; }

  function deepGet(obj, path) {
    let cur = obj;
    for (const k of path) {
      if (!isObj(cur)) return undefined;
      cur = cur[k];
    }
    return cur;
  }

  function firstString() {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(v) {
    if (typeof v !== 'string' || !v.trim()) return DEFAULT_AVATAR;
    const u = v.startsWith('//') ? 'https:' + v : v;
    try {
      const url = new URL(u, location.origin);
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : DEFAULT_AVATAR;
    } catch (e) { return DEFAULT_AVATAR; }
  }

  function formatTime(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date(n < 0xe8d4a51000 ? n * 1000 : n);
    if (Number.isNaN(d.getTime())) return '';
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }

  // ============================ XHR 拦截 ============================
  const interceptors = [];
  let interceptorInitialized = false;

  function addInterceptor(pattern, cb) {
    interceptors.push({ pattern: pattern, cb: cb });
    logInfo('注册拦截器', pattern, '（当前共 ' + interceptors.length + ' 个）');
  }

  function initInterceptor() {
    if (interceptorInitialized) return;
    interceptorInitialized = true;

    // v2.4.0：改写目标改为「页面真实 window」上的 XMLHttpRequest（声明 GM_* 授权后同样能落到页面对象上）
    const XHRProto = PAGE_WINDOW.XMLHttpRequest.prototype;
    const XHR_DONE = PAGE_WINDOW.XMLHttpRequest.DONE;
    const origOpen = XHRProto.open;
    const origSend = XHRProto.send;

    XHRProto.open = function (method, url) {
      this.__fenbiHelperUrl = String(url);
      this.__fenbiHelperMethod = String(method || 'GET').toUpperCase();
      return origOpen.apply(this, arguments);
    };

    XHRProto.send = function () {
      const xhr = this;
      const url = xhr.__fenbiHelperUrl;
      if (url) {
        // 无论是否命中 pattern，都记录到诊断面板（便于排查"为什么没拦截到"）
        const matched = recordRequest(xhr.__fenbiHelperMethod || 'GET', url);
        const registeredCbs = [];
        for (const ic of interceptors) {
          if (matched.indexOf(ic.pattern) !== -1 || (url + '').indexOf(ic.pattern) !== -1) {
            if (matched.indexOf(ic.pattern) === -1) diag.xhrMatchedCount++;
            // v1.3.0：同一回调可能被多个 pattern 命中（如 exercise / exercises / getExercise），只注册一次
            if (registeredCbs.indexOf(ic.cb) !== -1) continue;
            registeredCbs.push(ic.cb);
            xhr.addEventListener('readystatechange', function () {
              if (xhr.readyState === XHR_DONE) {
                logInfo('拦截响应返回', ic.pattern, 'status=' + xhr.status, shortenUrl(url));
                try { ic.cb(url, xhr.responseText); }
                catch (e) { logWarn('拦截回调失败', e); }
              }
            });
          }
        }
      }
      return origSend.apply(this, arguments);
    };

    // fetch 仅观测记录，不改变行为：用于判断页面是否改用 fetch 拉取题库数据
    if (typeof PAGE_WINDOW.fetch === 'function' && !PAGE_WINDOW.__fenbiCVFetchPatched) {
      PAGE_WINDOW.__fenbiCVFetchPatched = true;
      const origFetch = PAGE_WINDOW.fetch;
      PAGE_WINDOW.fetch = function (input, init) {
        try {
          const u = typeof input === 'string' ? input : (input && input.url ? input.url : '');
          const method = (init && init.method) || (input && input.method) || 'GET';
          if (u) recordRequest(method, u);
        } catch (e) { /* 观测失败不影响业务 */ }
        return origFetch.apply(this, arguments);
      };
    }
  }

  // ============================ 数据提取 ============================
  const ID_KEYS = ['id', 'questionId', 'question_id', 'solutionId', 'solution_id'];
  const NESTED_KEYS = ['solutions', 'solution', 'questions', 'question', 'datas', 'data', 'items', 'list', 'results'];

  // 从响应中提取题目 ID 列表
  function extractQuestionIds(root) {
    const out = [];
    const seen = new Set();
    const push = (v) => {
      const num = Number(v);
      const id = Number.isFinite(num) ? num : (typeof v === 'string' ? v : null);
      if (id == null || id === '') return;
      if (seen.has(String(id))) return;
      seen.add(String(id));
      out.push(id);
    };
    const walk = (node, depth) => {
      if (node == null || depth > 4) return;
      if (Array.isArray(node)) {
        if (node.length && node.every((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)))) {
          node.forEach(push);
          return;
        }
        node.forEach((x) => walk(x, depth + 1));
        return;
      }
      if (!isObj(node)) return;
      ['questionIds', 'ids', 'results', 'data'].forEach((k) => walk(node[k], depth + 1));
      const v = ID_KEYS.map((k) => node[k]).find((x) => x != null && x !== '');
      if (v !== undefined) push(v);
    };
    walk(root, 0);
    return out;
  }

  // 从 episode 数据桶中递归提取 episodeId
  function extractEpisodeIdFromBucket(bucket, depth) {
    depth = depth || 0;
    if (!bucket || depth > 3) return null;
    if (Array.isArray(bucket)) {
      for (const item of bucket) {
        const r = extractEpisodeIdFromBucket(item, depth + 1);
        if (r) return r;
      }
      return null;
    }
    if (!isObj(bucket)) return null;
    const stat = isObj(bucket.episodeStat) ? bucket.episodeStat : null;
    const direct = (stat && (stat.episodeId || stat.episode_id)) || bucket.episodeId || bucket.episode_id || bucket.id;
    if (typeof direct === 'string' || typeof direct === 'number') return direct;

    const keys = Object.keys(bucket).filter((k) => /^\d+$/.test(k));
    ['episodes', 'episode', 'episodeStat', 'datas', 'data', 'items', 'list'].forEach((k) => {
      if (bucket[k] !== undefined && keys.indexOf(k) === -1) keys.push(k);
    });
    for (const k of keys) {
      const r = extractEpisodeIdFromBucket(bucket[k], depth + 1);
      if (r) return r;
    }
    return null;
  }

  function mergeEpisodeData(data) {
    if (!isObj(data)) return;
    const before = Object.keys(state.episodeDataBySolutionId).length;
    state.episodeDataBySolutionId = Object.assign({}, state.episodeDataBySolutionId, data);
    const keys = Object.keys(data);
    logInfo('合并 episode 数据桶', '新增 ' + keys.length + ' 个', '样例题号 ' + JSON.stringify(keys.slice(0, 3)),
      '累计 ' + before + ' → ' + Object.keys(state.episodeDataBySolutionId).length);
  }

  function getEpisodeIdForSolution(solutionId) {
    const bucket = state.episodeDataBySolutionId[solutionId] || state.episodeDataBySolutionId[String(solutionId)];
    return extractEpisodeIdFromBucket(bucket);
  }

  // 明显不是题库前缀的路径片段（避免把 /spa/tiku/profile/ 之类误当成 prefix）
  const PREFIX_STOP = new Set([
    'v1', 'v2', 'v3', 'v4', 'v5', 'api', 'web', 'android', 'ipad', 'iphone',
    'profile', 'report', 'wrong', 'collect', 'note', 'exam', 'practice', 'error',
    'recitation', 'questions', 'question', 'solution', 'exercises', 'tiku', 'ti', 'spa',
  ]);

  function pickPrefix(candidates) {
    for (const c of candidates) {
      if (typeof c !== 'string') continue;
      const v = c.trim();
      if (!v || PREFIX_STOP.has(v.toLowerCase())) continue;
      if (!/^[a-z][a-z0-9_-]{1,32}$/i.test(v)) continue;
      return v;
    }
    return null;
  }

  // 个人中心 / 练习报告页路由里的 tiku_prefix，如
  //   /exam/error/practice/{primaryPrefix}/{tikuPrefix}/{categoryId}/{type}
  //   /report/questions/solution/{primaryPrefix}/{tikuPrefix}/{categoryId}/{type}
  function parseProfileRoute() {
    const m = location.pathname.match(/\/(?:exam\/(?:error|recitation|practice)|report\/questions\/solution)\/[^/]+\/([^/?#]+)\//);
    return m ? pickPrefix([m[1]]) : null;
  }

  function extractTikuPrefix(url, data) {
    const fromData = [];
    if (isObj(data)) {
      fromData.push(data.tiku_prefix, data.tikuPrefix);
      ['tiku_prefix', 'tikuPrefix', 'prefix'].forEach((k) => fromData.push(deepGet(data, ['data', k])));
    }
    const fromUrl = [];
    try {
      const u = new URL(String(url || ''), location.href);
      ['tiku_prefix', 'tikuPrefix', 'prefix', 'tiku', 'k'].forEach((k) => fromUrl.push(u.searchParams.get(k)));
      const pm = u.pathname.match(/\/(?:android|ipad|iphone|web|tikuApi)\/([^/]+)\//) ||
        u.pathname.match(/\/(?:tiku|ti)\/([^/?#]+)\//);
      if (pm) fromUrl.push(pm[1]);
    } catch (e) { /* ignore */ }
    return pickPrefix(fromData) || pickPrefix(fromUrl) || parseProfileRoute();
  }

  // v1.3.0：题号顺序优先取映射请求 URL 上的 tiku_ids 参数（逗号分隔，保持原始顺序）。
  // 背题页 /ti/memorize/ 的映射请求形如：
  //   .../tiku_episodes_with_multi_type?tiku_ids=2577965,19283923,...&tiku_prefix=xingce&tiku_type=5
  // 直接以该参数为建序依据，避免依赖题目接口命名差异。
  function extractTikuIdsFromUrl(url) {
    let raw = '';
    try {
      const u = new URL(String(url || ''), location.href);
      raw = u.searchParams.get('tiku_ids') || '';
    } catch (e) { return []; }
    if (!raw) return [];
    const out = [];
    const seen = {};
    raw.split(',').forEach((seg) => {
      const v = String(seg).trim();
      if (!v || seen[v]) return;
      seen[v] = 1;
      out.push(/^\d+$/.test(v) ? Number(v) : v);
    });
    return out;
  }

  // ============================ 拦截器注册 ============================
  function setupInterceptors() {
    // 1) episode 映射接口
    addInterceptor('tiku_episodes_with_multi_type', function (url, text) {
      // v1.3.0：题号顺序优先取本请求 URL 的 tiku_ids 参数（背题页的题号顺序完全依赖它）
      const urlIds = extractTikuIdsFromUrl(url);
      if (urlIds.length) setQuestionIds(urlIds, 'url');
      let json;
      try { json = JSON.parse(text); } catch (e) { logWarn('映射接口响应不是合法 JSON', shortenUrl(url)); return; }
      const data = isObj(json) && isObj(json.data) ? json.data : json;
      logInfo('映射接口响应', 'code=' + (isObj(json) ? json.code : '?'),
        'buckets=' + (isObj(data) ? Object.keys(data).length : 0), shortenUrl(url));
      mergeEpisodeData(data);
      const prefix = extractTikuPrefix(url, json);
      if (prefix) state.currentTikuPrefix = prefix;
      updateEpisodeIdsAndButtons();
    });

    // 2) 题目/解析列表接口
    addInterceptor('solution', function (url, text) {
      let json;
      try { json = JSON.parse(text); } catch (e) { logWarn('题目接口响应不是合法 JSON', shortenUrl(url)); return; }
      const ids = extractQuestionIds(json);
      logInfo('题目接口响应', '解析出题号 ' + ids.length + ' 个', shortenUrl(url));
      if (ids.length) setQuestionIds(ids);
      const prefix = extractTikuPrefix(url, json);
      if (prefix) state.currentTikuPrefix = prefix;
      updateEpisodeIdsAndButtons();
    });

    const questionHandler = function (url, text) {
      let json;
      try { json = JSON.parse(text); } catch (e) { logWarn('题目列表接口响应不是合法 JSON', shortenUrl(url)); return; }
      const ids = extractQuestionIds(json);
      logInfo('题目列表接口响应', '解析出题号 ' + ids.length + ' 个', shortenUrl(url));
      if (ids.length) setQuestionIds(ids);
      const prefix = extractTikuPrefix(url, json);
      if (prefix) state.currentTikuPrefix = prefix;
      updateEpisodeIdsAndButtons();
    };
    addInterceptor('questionIds', questionHandler);
    addInterceptor('exercises', questionHandler);
    // v1.3.0：背题页(/ti/memorize/)的题目接口实际为
    //   tiku.fenbi.com/combine/exercise/getExercise（单数）与 combine/question/getMeta，
    // 旧子串 exercises 匹配不到，这里补齐常见命名；题号顺序仍以 tiku_ids 参数为优先。
    addInterceptor('exercise', questionHandler);
    addInterceptor('getExercise', questionHandler);
    addInterceptor('getMeta', questionHandler);
    logInfo('拦截器注册完成', 'pattern 列表：' + interceptors.map((ic) => ic.pattern).join(', '));
  }

  // v1.3.0：题号来源优先级标志。'url' 表示已由映射请求 URL 的 tiku_ids 参数确定顺序，
  // 此时后续从响应体提取的题号只作兜底、不再覆盖，保证背题页题号与页面顺序一致。
  let questionIdsSource = '';

  function setQuestionIds(ids, source) {
    if (!Array.isArray(ids) || !ids.length) return;
    const src = source || 'response';
    if (questionIdsSource === 'url' && src !== 'url') {
      logInfo('忽略响应体提取的题号（题号顺序已由 tiku_ids 参数确定）', '本次解析出 ' + ids.length + ' 个');
      return;
    }
    const changed = ids.length !== state.solutionIds.length ||
      ids.some((v, i) => String(v) !== String(state.solutionIds[i]));
    state.solutionIds = ids;
    questionIdsSource = src;
    if (changed) logInfo('捕获题号列表', '共 ' + ids.length + ' 个', '来源 ' + src, '样例 ' + JSON.stringify(ids.slice(0, 5)));
  }

  let lastSyncSignature = '';

  function updateEpisodeIdsAndButtons() {
    if (Array.isArray(state.solutionIds) && state.solutionIds.length) {
      state.episodeIds = state.solutionIds.map((id) => getEpisodeIdForSolution(id));
    }
    try { syncCommentButtons(); } catch (e) { logWarn('按钮同步失败', e); }
    const mapped = episodeMappedCount();
    const btnCount = document.querySelectorAll('.' + COMMENT_BTN_CLASS).length;
    const sig = state.solutionIds.length + '/' + mapped + '/' + btnCount + '/' + state.currentTikuPrefix;
    if (sig !== lastSyncSignature) {
      lastSyncSignature = sig;
      logInfo('状态同步', '题号=' + state.solutionIds.length, 'episodeId 映射=' + mapped,
        '已注入按钮=' + btnCount, 'prefix=' + state.currentTikuPrefix);
    }
  }

  // ============================ 评论接口 ============================
  function buildCommentApiUrls(episodeId, start) {
    // v1.3.0：候选链首位固定为拦截到的请求 URL 参数 tiku_prefix 实际值（背题页实测 xingce），
    // 不再默认用 gwy / sydw 猜测；gwy 仅作为后缀降级候选保留。
    const prefix = encodeURIComponent(state.currentTikuPrefix || 'gwy');
    const urls = [];
    urls.push('https://ke.fenbi.com/android/' + prefix + '/v3/comments/episodes/' + episodeId + '?start=' + start);
    urls.push('https://ke.fenbi.com/android/gwy/v3/comments/episodes/' + episodeId + '?start=' + start);
    const params = new URLSearchParams({
      system: '12.4.7', inhouse: '0', app: 'gwy', ua: 'iPad',
      av: '44', version: '6.11.3', kav: '22', len: '600', start: String(start),
    });
    urls.push('https://ke.fenbi.com/ipad/gwy/v3/comments/episodes/' + episodeId + '?' + params.toString());
    return urls.filter((u, i) => urls.indexOf(u) === i);
  }

  // 非 2xx、HTML 响应、空 body 分别抛出，避免把错误响应当成"没有评论"
  async function readJson(res, label) {
    if (!res.ok) throw new Error(label + ' HTTP ' + res.status);
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (trimmed.charAt(0) === '<') throw new Error(label + ' 返回了 HTML，可能是接口域名或登录态异常');
    try { return JSON.parse(text); }
    catch (e) { throw new Error(label + ' JSON 解析失败: ' + (e && e.message ? e.message : e)); }
  }

  async function fetchCommentsJson(episodeId, start) {
    const urls = buildCommentApiUrls(episodeId, start);
    let lastErr = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json, text/plain, */*' },
        });
        const json = await readJson(res, '评论接口');
        if (json) return json;
      } catch (e) {
        lastErr = e;
        logWarn('评论接口候选失败，尝试下一个', url, e);
      }
    }
    throw lastErr || new Error('没有可用的评论接口');
  }

  function parseCommentResponse(json) {
    if (!isObj(json) || !Array.isArray(json.datas)) return null;
    return {
      datas: json.datas.filter(isObj),
      totalCount: typeof json.totalCount === 'number' ? json.totalCount : undefined,
      code: typeof json.code === 'number' ? json.code : undefined,
    };
  }

  function hasCommentsInResponse(json) {
    const parsed = parseCommentResponse(json);
    return !!parsed && parsed.datas.length > 0;
  }

  // ============================ 评论字段解析 ============================
  function normalizeComment(e) {
    const likeCount = Number(e.likeCount);
    return {
      id: (typeof e.id === 'string' || typeof e.id === 'number') ? e.id : null,
      nickname: firstString(
        e.nickName, e.nickname,
        deepGet(e, ['user', 'nickname']), deepGet(e, ['user', 'nickName']),
        deepGet(e, ['user', 'name']), deepGet(e, ['user', 'userName']),
        e.userName, e.username, e.authorName, e.creatorName,
        deepGet(e, ['userInfo', 'nickname']), deepGet(e, ['userInfo', 'name']),
        deepGet(e, ['author', 'nickname']), deepGet(e, ['author', 'name'])
      ) || '匿名用户',
      avatar: safeUrl(
        e.avatar || e.avatarUrl ||
        deepGet(e, ['user', 'avatar']) || deepGet(e, ['user', 'avatarUrl']) ||
        e.userAvatar || e.headImg || e.headUrl ||
        deepGet(e, ['userInfo', 'avatar']) || deepGet(e, ['author', 'avatar'])
      ),
      province: firstString(
        e.ipLocation, e.ipLocationName, e.province, e.location,
        deepGet(e, ['user', 'province']), deepGet(e, ['user', 'location']),
        deepGet(e, ['userInfo', 'province'])
      ),
      content: typeof e.comment === 'string' ? e.comment : '',
      createdTime: e.createdTime,
      likeCount: Number.isFinite(likeCount) ? Math.max(0, Math.trunc(likeCount)) : 0,
      liked: e.liked === true,
      rating: extractRating(e),
    };
  }

  function extractRating(e) {
    const candidates = [
      e.fiveGradeScore, e.rate, e.rating, e.star, e.stars, e.score, e.videoRate, e.videoRating, e.evaluateScore,
      deepGet(e, ['evaluate', 'rate']), deepGet(e, ['evaluate', 'score']), deepGet(e, ['evaluate', 'star']),
    ];
    for (const c of candidates) {
      const n = Number(c);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (n <= 5) return Math.round(n * 10) / 10;
      if (n <= 10) return Math.round((n / 2) * 10) / 10;
    }
    return 0;
  }

  function renderStars(rating) {
    if (!rating) return '';
    const n = Math.max(0, Math.min(5, Math.round(rating)));
    return '<span class="rating-stars">' + '★'.repeat(n) + '☆'.repeat(5 - n) + '</span>';
  }

  function renderLikeIcon(liked) {
    const path = '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>';
    if (liked) {
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="like-icon-svg" aria-hidden="true">' + path + '</svg>';
    }
    return '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="like-icon-svg" aria-hidden="true">' + path + '</svg>';
  }

  async function toggleLike(commentId, el) {
    if (el.dataset.loading === 'true') return;
    el.dataset.loading = 'true';
    const liked = el.classList.contains('liked');
    const action = liked ? 'like/cancel' : 'like';
    const url = 'https://ke.fenbi.com/android/' + state.currentTikuPrefix + '/v3/comments/' + encodeURIComponent(commentId) + '/' + action;
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'include' });
      const json = await res.json();
      if (!json || json.code !== 1) throw new Error((json && json.msg) || '点赞接口返回异常');
      const countEl = el.querySelector('.like-count');
      const iconEl = el.querySelector('.like-icon-container');
      if (!countEl || !iconEl) throw new Error('点赞控件结构不完整');
      const cur = parseInt(countEl.textContent, 10) || 0;
      el.classList.toggle('liked', !liked);
      iconEl.innerHTML = renderLikeIcon(!liked);
      countEl.textContent = String(liked ? Math.max(0, cur - 1) : cur + 1);
    } catch (e) {
      logError('点赞失败', e);
      el.classList.add('shake-error');
      setTimeout(() => el.classList.remove('shake-error'), 500);
    } finally {
      el.dataset.loading = 'false';
    }
  }

  // ============================ v2.4.0：评论「复制」/「收藏」 ============================
  // 需求：① 每条评论带「复制」按钮 → 点击复制该条评论正文并给出成功/失败提示；
  //      ② 每条评论带「收藏」按钮 → 通过用户自建的 WebDAV（如极空间 NAS）把该条评论**追加**保存到远端文件。
  // 关键约定：
  //  a) 追加而非覆盖：写入前先 GET 远端已有内容，末尾追加后整体 PUT 回写；并用 WebDAV 标准 ETag 做乐观锁
  //     （已有文件用 If-Match，新建用 If-None-Match:*），命中 412 / 409 / 428 等并发冲突时重新读取后重试，
  //     避免把其它端刚写入的内容覆盖掉；服务端未返回 ETag 时退化为「最后写入者胜」并记一条日志。
  //  b) 跨域：本次为「跨域写 WebDAV」和「油猴菜单」声明了 GM_* 授权，请求统一走 webdavRequest() ——
  //     有 GM_xmlhttpRequest 就用它（不受浏览器 CORS 限制），否则退回 fetch（受 CORS 限制，失败时给出明确提示）。
  //  c) 配置持久化：GM_setValue / GM_getValue 优先（两个 @match 域名共享），退回 localStorage。
  //  d) 未配置时点「收藏」→ 明确提示「请先配置 WebDAV 地址和账号」并给「去配置」入口；
  //     已收藏的评论显示「已收藏」标记并阻止重复写入（本机 ID 集合 + 远端隐藏标记双重判重）。
  //  e) 配置面板入口三处：油猴菜单、评论弹窗右上角齿轮、控制台 __fenbiCV.webdav.settings()。

  // v2.4.0：WebDAV 运行时状态（配置缓存 / 已收藏 ID 集合缓存），避免每次点击都重读存储
  const webdavState = { config: null, favIds: null };

  // ---------------- 配置读写（GM 存储优先，退回 localStorage） ----------------
  function storageGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(key, null);
        if (v !== null && v !== undefined) return String(v);
      }
    } catch (e) { /* 未授权 / 被禁用时退回 localStorage */ }
    try {
      const v = localStorage.getItem(key);
      if (v !== null && v !== undefined) return String(v);
    } catch (e) { /* 隐私模式等场景读失败 */ }
    return fallback;
  }

  function storageSet(key, value) {
    const s = String(value);
    let ok = false;
    try { if (typeof GM_setValue === 'function') { GM_setValue(key, s); ok = true; } } catch (e) { /* ignore */ }
    try { localStorage.setItem(key, s); ok = true; } catch (e) { /* ignore */ }
    return ok;
  }

  function storageRemove(key) {
    try { if (typeof GM_deleteValue === 'function') GM_deleteValue(key); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // v2.8.0：保存路径规整 —— 坚果云等「虚拟服务根」型 WebDAV 的根目录不可写（坚果云 dav/ 即虚拟服务根，
  // 往根下 PUT 裸文件名会返回 404 ObjectNotFound），若只填了文件名（没有任何目录层级）且地址指向坚果云，
  // 自动补上最外层真实目录「我的坚果云」。极空间 / 群晖等自建 WebDAV 不受影响（路径自带目录层级时原样保留）。
  function normalizeWebdavFilePath(filePath, url) {
    const p = String(filePath == null ? '' : filePath).trim().replace(/^\/+/, '') || DEFAULT_WEBDAV_FILE;
    if (p.indexOf('/') === -1 && p !== JIANGUOYUN_ROOT_DIR
      && /(^|\.)jianguoyun\.com(:\d+)?(\/|$)/i.test(String(url == null ? '' : url).trim())) {
      return JIANGUOYUN_ROOT_DIR + '/' + p;
    }
    return p;
  }

  function normalizeWebdavConfig(raw) {
    const c = isObj(raw) ? raw : {};
    const url = String(c.url == null ? '' : c.url).trim();
    return {
      url: url,
      username: String(c.username == null ? '' : c.username).trim(),
      password: String(c.password == null ? '' : c.password),
      filePath: normalizeWebdavFilePath(c.filePath, url),
    };
  }

  function getWebdavConfig() {
    if (webdavState.config) return webdavState.config;
    let parsed = null;
    try { parsed = JSON.parse(storageGet(WEBDAV_STORE_KEY, '') || 'null'); } catch (e) { parsed = null; }
    webdavState.config = normalizeWebdavConfig(parsed);
    return webdavState.config;
  }

  function saveWebdavConfig(cfg) {
    const next = normalizeWebdavConfig(cfg);
    webdavState.config = next;
    const ok = storageSet(WEBDAV_STORE_KEY, JSON.stringify(next));
    logInfo('已保存 WebDAV 配置', '地址=' + (next.url ? shortenUrl(next.url) : '(空)'),
      '账号=' + (next.username || '(空)'), '保存路径=' + next.filePath, '持久化=' + (ok ? '成功' : '失败'));
    return ok;
  }

  function clearWebdavConfig() {
    webdavState.config = normalizeWebdavConfig(null);
    storageRemove(WEBDAV_STORE_KEY);
    logInfo('已清空 WebDAV 配置（远端已收藏的文件不受影响）');
  }

  // 「已配置」判定：地址 + 账号必填；密码允许留空（留空时若服务端要求认证，写入会以 401 明确提示检查密码）
  function isWebdavConfigured() {
    const c = getWebdavConfig();
    return !!(c.url && c.username);
  }

  // ---------------- URL / 认证 ----------------（极空间等自建 WebDAV 一律走 HTTP Basic 认证）
  function joinWebdavUrl(base, seg) {
    const b = String(base == null ? '' : base).trim().replace(/\/+$/, '');
    const s = String(seg == null ? '' : seg).replace(/^\/+/, '');
    return s ? b + '/' + s : b + '/';
  }

  function encodeWebdavPath(p) {
    return String(p == null ? '' : p).split('/').map((seg) => encodeURIComponent(seg)).join('/');
  }

  function buildWebdavFileUrl(cfg) {
    return joinWebdavUrl(cfg.url, encodeWebdavPath(cfg.filePath));
  }

  // 目标文件所在目录（用于连接测试，统一以「/」结尾表示集合）
  function buildWebdavDirUrl(cfg) {
    const segs = String(cfg.filePath || '').split('/').filter((s) => !!s);
    segs.pop();
    const dirUrl = joinWebdavUrl(cfg.url, encodeWebdavPath(segs.join('/')));
    return /\/$/.test(dirUrl) ? dirUrl : dirUrl + '/';
  }

  // 账号密码可能含中文 / 特殊字符，先转 UTF-8 字节再 base64，避免 btoa 抛 InvalidCharacterError
  function utf8ToBase64(str) {
    const s = String(str == null ? '' : str);
    try {
      if (typeof TextEncoder === 'function' && typeof btoa === 'function') {
        const bytes = new TextEncoder().encode(s);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      }
    } catch (e) { /* 退回下面的老办法 */ }
    try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return btoa(s); }
  }

  function buildWebdavAuthHeader(cfg) {
    return 'Basic ' + utf8ToBase64(cfg.username + ':' + cfg.password);
  }

  function extractEtag(rawHeaders) {
    const m = /^etag:\s*(.+)$/im.exec(String(rawHeaders == null ? '' : rawHeaders));
    return m ? m[1].trim() : null;
  }

  // ---------------- 请求出口：GM_xmlhttpRequest 优先（免 CORS），退回 fetch ----------------
  function webdavRequest(method, url, headers, body) {
    const h = Object.assign({}, headers || {});
    const hasBody = !(body === undefined || body === null);
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        let settled = false;
        const ok = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
        try {
          GM_xmlhttpRequest({
            method: method,
            url: url,
            headers: h,
            data: hasBody ? body : undefined,
            timeout: WEBDAV_TIMEOUT_MS,
            responseType: 'text',
            onload: (res) => ok(resolve, {
              status: res && typeof res.status === 'number' ? res.status : 0,
              statusText: (res && res.statusText) || '',
              text: res && res.responseText != null ? String(res.responseText) : '',
              headers: (res && res.responseHeaders) || '',
              via: 'GM_xmlhttpRequest',
            }),
            onerror: (res) => ok(reject, new Error('网络错误（GM_xmlhttpRequest）' + (res && res.error ? '：' + res.error : ''))),
            ontimeout: () => ok(reject, new Error('请求超时（超过 ' + WEBDAV_TIMEOUT_MS + 'ms）')),
            onabort: () => ok(reject, new Error('请求被中止')),
          });
        } catch (e) { ok(reject, e); }
      });
    }
    return fetch(url, {
      method: method,
      headers: h,
      body: hasBody ? body : undefined,
      credentials: 'omit',   // 不要把粉笔的 Cookie 带到 NAS 上去
      cache: 'no-store',
    }).then((res) => res.text().then((t) => ({
      status: res.status,
      statusText: res.statusText || '',
      text: String(t == null ? '' : t),
      headers: '',
      via: 'fetch',
    }))).catch((e) => {
      throw new Error('请求失败（' + diagFormat(e) + '）；当前环境没有 GM_xmlhttpRequest，浏览器会以 CORS 拦截跨域 WebDAV 请求');
    });
  }

  // ---------------- 远端文件读写 ----------------
  // 读取远端已有文件（不存在不算错误，返回 exists:false）
  function webdavGetFile(cfg) {
    return webdavRequest('GET', buildWebdavFileUrl(cfg), {
      'Authorization': buildWebdavAuthHeader(cfg),
      'Accept': 'text/markdown, text/plain, */*',
      'Cache-Control': 'no-cache',
    }).then((res) => {
      // 404：目标文件不存在；409（坚果云等返回 AncestorsNotFound / Conflict）：上级目录不存在
      // → 与 404 一并按「不存在」处理，交给上游建目录流程，避免被误判成「读取失败」直接中断。
      if (res.status === 404 || res.status === 409) return { exists: false, content: '', etag: null, status: res.status };
      if (res.status === 401 || res.status === 403) throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码');
      if (res.status < 200 || res.status >= 300) throw new Error('读取远端文件失败（HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '）');
      return { exists: true, content: res.text, etag: extractEtag(res.headers), status: res.status };
    });
  }

  // 整体回写：cond.etag → If-Match（已有文件，乐观锁）；cond.create → If-None-Match:*（确认不存在时新建）
  function webdavPutFile(cfg, content, cond) {
    cond = cond || {};
    const headers = {
      'Authorization': buildWebdavAuthHeader(cfg),
      'Content-Type': 'text/markdown; charset=utf-8',
    };
    if (cond.etag) headers['If-Match'] = cond.etag;
    else if (cond.create) headers['If-None-Match'] = '*';
    return webdavRequest('PUT', buildWebdavFileUrl(cfg), headers, content);
  }

  // 尽力创建保存路径上的各级目录（已存在 / 服务端不支持时静默跳过，真正的问题交给 PUT 报错）
  function ensureWebdavCollections(cfg) {
    const segs = String(cfg.filePath || '').split('/').filter((s) => !!s);
    // 只有文件名（无目录层级）时确实没有可建目录：这类路径在坚果云下已在 normalizeWebdavFilePath
    // 里自动补上「我的坚果云/」；仍然出现单段路径说明是自建 WebDAV，原样返回、由上层的 404 提示兜底。
    if (segs.length <= 1) return Promise.resolve(false);
    let created = false;
    let chain = Promise.resolve();
    for (let i = 0; i < segs.length - 1; i++) {
      const dirUrl = joinWebdavUrl(cfg.url, encodeWebdavPath(segs.slice(0, i + 1).join('/')));
      chain = chain.then(() => webdavRequest('MKCOL', dirUrl, { 'Authorization': buildWebdavAuthHeader(cfg) })
        .then((res) => { if (res.status >= 200 && res.status < 300) created = true; })
        .catch(() => { /* 目录已存在或服务端不支持 MKCOL，继续 */ }));
    }
    return chain.then(() => created);
  }

  function favMarker(commentId) {
    return FAV_MARKER_HEAD + String(commentId) + FAV_MARKER_TAIL;
  }

  // 统计已收藏条数：只认真实标记，排除文件说明头里形如 <!-- fcv:comment:... --> 的示例占位
  function countFavMarkers(text) {
    const m = String(text == null ? '' : text).match(/<!--\s*fcv:comment:(?!\s*\.\.\.)[^>]*?-->/g);
    return m ? m.length : 0;
  }

  // v2.8.0：重试耗尽后的失败文案 —— 不再一律谎称「远端文件正被其它端修改」，
  // 而是回显真实 HTTP 状态码，并对 404/405（路径不可写）、409（父目录缺失）、
  // 412/428（乐观锁冲突）、401/403（无权限）分别给出对症提示。
  function formatWebdavWriteFailure(action, cfg, conflict) {
    const status = String(conflict == null ? '' : conflict);
    const m = /HTTP\s*(\d+)/.exec(status);
    const code = m ? m[1] : '';
    const path = String(cfg && cfg.filePath || '');
    const bare = path.indexOf('/') === -1;
    let tip;
    if (code === '404' || code === '405') {
      tip = bare
        ? '保存路径「' + path + '」只有文件名、缺少目录层级，而这类 WebDAV 的根目录通常不可写'
          + '（坚果云 dav/ 是虚拟服务根，文件必须放在「我的坚果云」下）——请把保存路径改成'
          + '「' + JIANGUOYUN_ROOT_DIR + '/子目录/' + path + '」这种带目录的形式。'
        : '服务端不接受写入该路径，请确认「' + path + '」所在目录已存在、且该账号有写入权限。';
    } else if (code === '409') {
      tip = '服务端报告上级目录不存在或状态冲突，请确认保存路径「' + path + '」的上级目录已存在'
        + '（脚本会自动尝试创建目录，失败时可先在 WebDAV 网页端手动建好）。';
    } else if (code === '412' || code === '428') {
      tip = '远端文件确实正被其它端改写（乐观锁校验未通过），稍后重试即可。';
    } else if (code === '401' || code === '403') {
      tip = '账号或密码无写入权限，请检查 WebDAV 账号 / 密码（坚果云需使用「应用密码」）。';
    } else {
      tip = '请稍后重试；若持续失败，可在配置面板点「连接测试」查看详情。';
    }
    return action + '失败，重试 ' + FAV_MAX_REMOTE_RETRY + ' 次仍未成功（' + (status || '未知原因') + '）。' + tip;
  }

  // 写入一条收藏：读远端 → 判重 / 并入该题区块（或新建区块）→ 整体回写（并发冲突自动重读重试）
  // item 由 buildFavoriteItem() 组装（含两类隐藏标记、题目区块全文与评论块）
  async function appendCommentToWebdav(cfg, item) {
    let conflict = '';
    // v2.8.0：进循环前先主动确保保存路径的上级目录存在。原先只有 PUT 返回 404/405 才去建目录，
    // 而循环第一步的 GET 在父目录缺失时就已经抛错（坚果云返回 409），建目录兜底永远走不到。
    await ensureWebdavCollections(cfg);
    for (let attempt = 0; attempt <= FAV_MAX_REMOTE_RETRY; attempt++) {
      const cur = await webdavGetFile(cfg);
      const base = cur.exists ? cur.content : FAV_FILE_HEADER;
      const merged = mergeFavoriteIntoMarkdown(base, item);
      if (merged.duplicated) {
        return {
          duplicated: true,
          created: false,
          count: countFavMarkers(base),
          questions: countQuestionBlocks(base),
        };
      }
      const res = await webdavPutFile(cfg, merged.text, cur.exists ? { etag: cur.etag } : { create: true });
      if (res.status === 412 || res.status === 428) {
        conflict = 'HTTP ' + res.status;
        logWarn('WebDAV 写入冲突，重新读取后再试', conflict, '第 ' + (attempt + 1) + ' 次');
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码');
      }
      // 404 / 405：目标路径不可写；409：父目录不存在（v2.8.0 从「并发冲突重读」拆出）
      // → 统一走「建目录后重试」，不再把父目录缺失误报成「远端文件正被其它端修改」。
      if (res.status === 404 || res.status === 405 || res.status === 409) {
        const created = await ensureWebdavCollections(cfg);
        conflict = 'HTTP ' + res.status + (created ? '（已尝试创建上级目录）' : '');
        logWarn('WebDAV 写入失败，尝试创建上级目录后重试', conflict, '第 ' + (attempt + 1) + ' 次');
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error('写入远端文件失败（HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '）');
      }
      if (cur.exists && !cur.etag) logWarn('远端文件未返回 ETag，本次写入退化为「最后写入者胜」');
      return {
        duplicated: false,
        created: !cur.exists,
        createdQuestion: !!merged.createdQuestion,
        count: countFavMarkers(merged.text),
        questions: countQuestionBlocks(merged.text),
        via: res.via,
      };
    }
    throw new Error(formatWebdavWriteFailure('收藏', cfg, conflict));
  }

  // v2.6.5：取消收藏 —— 读远端 → 按评论标记摘掉该条（该题已无其它收藏时整块删题）→ 整体回写
  // 并发冲突处理与 appendCommentToWebdav 完全一致（412/409/428 重读重试；404/405 建目录后重试）
  async function removeFavoriteFromWebdav(cfg, commentMarker) {
    let conflict = '';
    for (let attempt = 0; attempt <= FAV_MAX_REMOTE_RETRY; attempt++) {
      const cur = await webdavGetFile(cfg);
      if (!cur.exists) {
        // 远端文件都不存在 → 没有任何记录可删，直接交回调用方（本机标记由调用方清掉）
        return {
          removed: false, noFile: true, noComment: false, questionDeleted: false,
          remainingInQuestion: 0, count: 0, questions: 0,
        };
      }
      const next = removeFavoriteFromMarkdown(cur.content, commentMarker);
      if (!next.removed) {
        return {
          removed: false, noFile: false, noComment: true, questionDeleted: false,
          remainingInQuestion: next.remainingInQuestion,
          count: next.count, questions: next.questions,
        };
      }
      const res = await webdavPutFile(cfg, next.text, cur.etag ? { etag: cur.etag } : {});
      if (res.status === 412 || res.status === 428) {
        conflict = 'HTTP ' + res.status;
        logWarn('WebDAV 写入冲突，重新读取后再试', conflict, '第 ' + (attempt + 1) + ' 次');
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('WebDAV 认证失败（HTTP ' + res.status + '），请检查账号和密码');
      }
      // 404 / 405：目标路径不可写；409：父目录不存在（v2.8.0 从「并发冲突重读」拆出）
      // → 统一走「建目录后重试」，不再把父目录缺失误报成「远端文件正被其它端修改」。
      if (res.status === 404 || res.status === 405 || res.status === 409) {
        const created = await ensureWebdavCollections(cfg);
        conflict = 'HTTP ' + res.status + (created ? '（已尝试创建上级目录）' : '');
        logWarn('WebDAV 写入失败，尝试创建上级目录后重试', conflict, '第 ' + (attempt + 1) + ' 次');
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error('写入远端文件失败（HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + '）');
      }
      if (!cur.etag) logWarn('远端文件未返回 ETag，本次写入退化为「最后写入者胜」');
      return {
        removed: true, noFile: false, noComment: false,
        questionDeleted: !!next.questionDeleted,
        remainingInQuestion: next.remainingInQuestion,
        count: next.count,
        questions: next.questions,
        via: res.via,
      };
    }
    throw new Error(formatWebdavWriteFailure('取消收藏', cfg, conflict));
  }

  // 连接测试：① 探测 WebDAV 服务与账号（OPTIONS，不支持时退化为 PROPFIND）② 读取目标文件现状
  async function testWebdavConnection(cfg) {
    const c = normalizeWebdavConfig(cfg || getWebdavConfig());
    if (!c.url) throw new Error('请先填写 WebDAV 服务器地址');
    const auth = { 'Authorization': buildWebdavAuthHeader(c) };
    const dirUrl = buildWebdavDirUrl(c);
    let probe = await webdavRequest('OPTIONS', dirUrl, Object.assign({ 'Accept': '*/*' }, auth));
    if (probe.status === 405 || probe.status === 501) {
      probe = await webdavRequest('PROPFIND', dirUrl,
        Object.assign({ 'Depth': '0', 'Content-Type': 'application/xml; charset=utf-8' }, auth),
        '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>');
    }
    if (probe.status === 401 || probe.status === 403) throw new Error('认证失败（HTTP ' + probe.status + '），请检查账号和密码');
    if (probe.status < 200 || probe.status >= 300) {
      throw new Error('连接失败（HTTP ' + probe.status + (probe.statusText ? ' ' + probe.statusText : '') + '），请检查服务器地址与端口');
    }
    const dav = /^dav:\s*(.+)$/im.exec(String(probe.headers || ''));
    const file = await webdavGetFile(c);
    return {
      status: probe.status,
      via: probe.via,
      dav: dav ? dav[1].trim() : '',
      filePath: c.filePath,
      fileExists: file.exists,
      fileCount: countFavMarkers(file.content),
      fileQuestions: countQuestionBlocks(file.content),
    };
  }

  // ---------------- 本机「已收藏」记录（用于状态标记与阻止重复收藏） ----------------
  function getFavIdSet() {
    if (webdavState.favIds) return webdavState.favIds;
    let arr = [];
    try {
      const parsed = JSON.parse(storageGet(FAV_STORE_KEY, '') || '[]');
      if (Array.isArray(parsed)) arr = parsed;
    } catch (e) { arr = []; }
    webdavState.favIds = new Set(arr.map((x) => String(x)));
    return webdavState.favIds;
  }

  function markFavLocally(commentId) {
    if (commentId === null || commentId === undefined) return;
    const set = getFavIdSet();
    set.add(String(commentId));
    let arr = Array.from(set);
    if (arr.length > FAV_ID_KEEP_MAX) arr = arr.slice(arr.length - FAV_ID_KEEP_MAX);
    storageSet(FAV_STORE_KEY, JSON.stringify(arr));
  }

  function isFavLocally(commentId) {
    if (commentId === null || commentId === undefined) return false;
    return getFavIdSet().has(String(commentId));
  }

  // v2.6.5：取消收藏成功后同步清掉本机「已收藏」标记（与 markFavLocally 对应）
  function unmarkFavLocally(commentId) {
    if (commentId === null || commentId === undefined) return;
    const set = getFavIdSet();
    if (!set.has(String(commentId))) return;
    set.delete(String(commentId));
    storageSet(FAV_STORE_KEY, JSON.stringify(Array.from(set)));
  }

  // ---------------- 收藏记录（Markdown 按题目聚合块，v2.5.0） ----------------
  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatFavTime(d) {
    const dt = d instanceof Date ? d : new Date();
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()) + ' ' +
      pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()) + ':' + pad2(dt.getSeconds());
  }

  // 题目区块的隐藏标记（聚合依据）：<!-- fcv:question:<题目唯一ID> -->
  function favQuestionMarker(questionId) {
    return FAV_Q_MARKER_HEAD + String(questionId) + FAV_MARKER_TAIL;
  }

  // 统计题目区块数：只认真实标记，排除文件说明头里形如 <!-- fcv:question:... --> 的示例占位
  function countQuestionBlocks(text) {
    const m = String(text == null ? '' : text).match(/<!--\s*fcv:question:(?!\s*\.\.\.)[^>]*?-->/g);
    return m ? m.length : 0;
  }

  // 题目唯一 ID（聚合键）：题目 ID（solutionId）优先 → 评论集 episodeId → unknown
  // 题目 ID 依次从 state.solutionIds[index]、注入按钮的 data-fenbi-solution-id 取（两处都不行再看 episodeId）
  function buildQuestionId(index, episodeId) {
    const idx = Number(index);
    let solutionId = null;
    let btnEpisodeId = null;
    if (Number.isFinite(idx) && idx >= 0) {
      const ids = state.solutionIds || [];
      if (ids[idx] !== null && ids[idx] !== undefined && String(ids[idx]) !== '') solutionId = String(ids[idx]);
      if (!solutionId) {
        try {
          const btn = document.querySelector('.' + COMMENT_BTN_CLASS + '[data-fenbi-index="' + idx + '"]');
          if (btn && btn.dataset) {
            const fromBtn = String(btn.dataset.fenbiSolutionId == null ? '' : btn.dataset.fenbiSolutionId).trim();
            const fromBtnEp = String(btn.dataset.fenbiEpisodeId == null ? '' : btn.dataset.fenbiEpisodeId).trim();
            if (fromBtn) solutionId = fromBtn;
            if (fromBtnEp) btnEpisodeId = fromBtnEp;
          }
        } catch (e) { /* 取不到就用 episodeId 兜底 */ }
      }
    }
    if (solutionId) return solutionId;
    const ep = episodeId !== null && episodeId !== undefined && String(episodeId) !== '' ? String(episodeId) : btnEpisodeId;
    if (ep) return 'episode-' + ep;
    return 'unknown';
  }

  // ---------------- v2.5.0：题干 / 选项取材（题卡 DOM 优先；取不到只降级留空，绝不抛错） ----------------
  const CHOICE_ITEM_SELECTOR = 'app-choice-radio, .choice-radio, .option-item, li.choice, .choice-item';
  const STEM_FALLBACK_SELECTORS = ['.question-stem', '.stem', '.subject', '.ti-title', '.question-content'];
  const CHOICE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function normalizeDomText(el) {
    const raw = el && typeof el.textContent === 'string' ? el.textContent : '';
    return String(raw).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // 给选项补 A. / B. 这种字母前缀（文本里已带字母前缀的保持原样，不重复添加）
  function withChoiceLetter(text, i) {
    const t = String(text == null ? '' : text).trim();
    const letter = CHOICE_LETTERS[i] || String(i + 1);
    if (!t) return '';
    if (/^[（(]?\s*[A-Za-z]\s*[)）.、．:：]/.test(t)) return t;
    return letter + '. ' + t;
  }

  // 选项节点是否为「容器」：内部还包含其它候选节点即视为容器（v2.5.1：只取最内层的真实选项，
  // 否则外层容器会把「A 举棋不定 B 扑朔迷离 C 众说纷纭 D 悬而未决」整组文本当成一个选项）
  function hasInnerChoiceNode(el) {
    try {
      if (!el || typeof el.querySelector !== 'function') return false;
      return !!el.querySelector(CHOICE_ITEM_SELECTOR);
    } catch (e) { return false; }
  }

  // 该元素是否落在「最内层真实选项」内部（用于把选项文字排除在题干候选之外）
  function isInsideRealChoice(el) {
    try {
      if (!el || typeof el.closest !== 'function') return false;
      let node = el.closest(CHOICE_ITEM_SELECTOR);
      while (node) {
        if (!hasInnerChoiceNode(node)) return true;   // 最近的真实选项节点 → 这段文字属于选项
        node = node.parentElement ? node.parentElement.closest(CHOICE_ITEM_SELECTOR) : null;
      }
      return false;
    } catch (e) { return false; }
  }

  // 解析选项文本开头的真实字母：返回 { letter, text }（letter 为 null 表示解析不到，交给顺序兜底）
  // 支持「A 举棋不定」「A. xxx」「A、xxx」「（A）xxx」「A：xxx」等；字母后必须跟分隔符或空白，
  // 避免把英文正文（如「ABC company」）误当作字母前缀；同时剥离前缀，杜绝「B. A 举棋不定」式重复
  function parseChoiceText(text) {
    const t = String(text == null ? '' : text).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return { letter: null, text: '' };
    let m = /^[（(\[【]\s*([A-Za-z])\s*[)）\]】]\s*[.．、,:：·\-—]?\s*([\s\S]*)$/.exec(t);
    if (!m) m = /^([A-Za-z])\s*[.．、,:：·\-—]\s*([\s\S]*)$/.exec(t);
    if (!m) m = /^([A-Za-z])\s+([\s\S]+)$/.exec(t);
    if (!m) m = /^[（(\[【]?\s*([A-Za-z])\s*[)）\]】]?\s*$/.exec(t);
    if (!m) return { letter: null, text: t };
    return {
      letter: m[1].toUpperCase(),
      text: String(m[2] == null ? '' : m[2]).trim(),
    };
  }

  // 整组拼接文本兜底识别：形如「A 举棋不定 B 扑朔迷离 C 众说纷纭 D 悬而未决」——
  // 出现 3 个以上「字母 + 内容」片段的文本一律不作为单个选项（防止容器节点漏网）
  function looksLikeConcatenatedChoices(text) {
    const t = String(text == null ? '' : text);
    const re = /(?:^|[\s；;，,])([A-Za-z])\s*[.．、,:：)）]?\s+(?=\S)/g;
    const letters = [];
    let m = re.exec(t);
    while (m !== null) {
      const L = m[1].toUpperCase();
      if (letters.indexOf(L) === -1) letters.push(L);
      if (letters.length >= 3) return true;
      if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;   // 防零宽匹配死循环
      m = re.exec(t);
    }
    return false;
  }

  // 从题卡 DOM 提取「题干 + 选项」；任一环节失败都只返回空值（收藏流程据此降级）
  function extractQuestionMetaFromCard(card) {
    const meta = { stem: '', choices: [] };
    try {
      if (!card || typeof card.querySelector !== 'function') return meta;
      const box = card.querySelector('.question-choice-container') || card.querySelector('app-question-choice') || card;
      // 题干：取第一个「不属于任何选项」且有文字的 app-format-html / .format-html
      let stem = '';
      const fmtEls = box.querySelectorAll('app-format-html, .format-html');
      for (let i = 0; i < fmtEls.length; i++) {
        const el = fmtEls[i];
        if (isInsideRealChoice(el)) continue;
        const t = normalizeDomText(el);
        if (t) { stem = t; break; }
      }
      if (!stem) {
        for (let i = 0; i < STEM_FALLBACK_SELECTORS.length && !stem; i++) {
          const el = box.querySelector(STEM_FALLBACK_SELECTORS[i]);
          if (!el) continue;
          if (isInsideRealChoice(el)) continue;
          stem = normalizeDomText(el);
        }
      }
      meta.stem = stem;
      // 选项（v2.5.1）：
      //  ① 只取最内层的真实选项节点 —— 丢掉「内部还包含候选节点」的外层容器（否则容器文本 =
      //     全部选项拼接，会被当成一个选项）；
      //  ② 字母以节点文本开头的真实字母为准（解析后剥离前缀，避免「B. A 举棋不定」重复），
      //     解析不到时才按顺序兜底；
      //  ③ 过滤空项与整组拼接文本项；④ 按字母去重（同字母保留首次出现）并排序。
      const rawEls = box.querySelectorAll(CHOICE_ITEM_SELECTOR);
      const withLetter = [];
      const noLetter = [];
      const usedLetters = {};
      for (let i = 0; i < rawEls.length; i++) {
        const el = rawEls[i];
        if (!el) continue;
        if (hasInnerChoiceNode(el)) continue;            // ① 外层容器
        const t = normalizeDomText(el);
        if (!t) continue;                                 // ③ 空项
        if (looksLikeConcatenatedChoices(t)) continue;     // ③ 整组拼接文本兜底
        const parsed = parseChoiceText(t);
        if (parsed.letter) {
          if (usedLetters[parsed.letter]) continue;        // ④ 同字母去重
          if (!parsed.text) continue;                      // 只有字母、没有内容 → 空项
          usedLetters[parsed.letter] = true;
          withLetter.push({ letter: parsed.letter, text: parsed.text });
        } else if (parsed.text) {
          noLetter.push({ letter: null, text: parsed.text });
        }
      }
      withLetter.sort((a, b) => (a.letter < b.letter ? -1 : (a.letter > b.letter ? 1 : 0)));   // ④ 按字母排序
      const ordered = withLetter.concat(noLetter);        // 无字母项按 DOM 顺序排在后面，统一顺序兜底
      const choices = [];
      for (let i = 0; i < ordered.length; i++) {
        const o = ordered[i];
        choices.push(o.letter ? (o.letter + '. ' + o.text) : withChoiceLetter(o.text, i));   // ② 用真实字母
      }
      meta.choices = choices;
    } catch (e) {
      logWarn('题干 / 选项取材失败，本次收藏降级为空', diagFormat(e));
    }
    return meta;
  }

  // v2.8.2：题组容器「一大带多小」下钻。
  // 背景（资料分析题只显示第 1 题评论的根因）：资料分析题组整组只渲染 1 个 .ti
  //（class 含 only-one-tis，内含材料 + 5 道小题），小题各自为 app-ti.question-multiple；
  // 按 .ti 逐题循环时整组只命中 1 个锚点，于是整组只有 1 个按钮，且固定指向第 1 小题。
  // 规则：容器内含多个小题锚点（app-ti）→ 展开为各小题；否则保持容器本身。
  // 判定口径必须与 cardForElement 完全一致，否则题号下标会与 solutionIds 错位。
  function expandQuestionGroupCards(containers) {
    const out = [];
    (containers || []).forEach((el) => {
      if (!el) return;
      let subs = [];
      try { subs = el.querySelectorAll ? el.querySelectorAll('app-ti') : []; } catch (e) { subs = []; }
      if (subs.length > 1) Array.from(subs).forEach((s) => out.push(s));
      else out.push(el);
    });
    return out;
  }

  // 由题卡内任意子元素（题号 .title-index / span.index、.title-right 等）反推
  //「与 queryQuestionCards 同源」的题卡锚点：题组取小题（app-ti），普通题取 .ti 本身。
  function cardForElement(el) {
    if (!el || !el.closest) return el || null;
    const appTi = el.closest('app-ti');
    const ti = el.closest('.ti');
    if (appTi) {
      if (!ti) return appTi;
      let subs = [];
      try { subs = ti.querySelectorAll('app-ti'); } catch (e) { subs = []; }
      if (subs.length > 1) return appTi;   // 题组容器：小题才是锚点
      return ti;                            // 普通题：外层 .ti 即锚点
    }
    return ti || el;
  }

  // 供各处观察器使用：对容器集合展开后，按「全页题卡列表」的下标注入。
  // 不能使用观察器回调里的局部下标 i —— 题组内多个子元素会互相覆盖同一个按钮的题号。
  function injectButtonsForContainers(containers) {
    const all = queryQuestionCards();
    if (!all.length) return;
    expandQuestionGroupCards(containers).forEach((card) => {
      const idx = all.indexOf(card);
      if (idx >= 0) injectButton(card, idx);
    });
  }

  // 题卡列表（选择器与按钮注入处保持同源，保证下标与 solutionIds 对齐；取不到时返回空数组）
  // v2.8.2：普通路由改为「容器 → 小题」展开，资料分析题组内 5 道小题分别对齐 0~4 号题号。
  function queryQuestionCards() {
    try {
      if (isProfileRoute()) {
        return Array.from(document.querySelectorAll(
          'fb-local-question, fb-recitatation-question, #app-report-ques-solution .solution-item'));
      }
      return expandQuestionGroupCards(
        Array.from(document.querySelectorAll('.tis-container .ti, .solution-detail .question, .ti')));
    } catch (e) { return []; }
  }

  // 按注入序号反查题卡：① 评论按钮缓存的 _fcvCard ② 按钮 closest 反查 ③ 题卡列表下标 ④ 题号文本换算
  function resolveQuestionCard(index) {
    const idx = Number(index);
    if (!Number.isFinite(idx) || idx < 0) return null;
    const cards = queryQuestionCards();
    try {
      const btn = document.querySelector('.' + COMMENT_BTN_CLASS + '[data-fenbi-index="' + idx + '"]');
      if (btn) {
        if (btn._fcvCard) return btn._fcvCard;
        if (typeof btn.closest === 'function') {
          const card = btn.closest('.ti') || btn.closest('.question') ||
            btn.closest('fb-local-question, fb-recitatation-question, #app-report-ques-solution .solution-item');
          if (card) return card;
        }
      }
    } catch (e) { /* 选择器异常时走下面的兜底 */ }
    if (cards[idx]) return cards[idx];
    if (isProfileRoute()) {
      for (let i = 0; i < cards.length; i++) {
        try { if (getProfileQuestionIndex(cards[i], i) === idx) return cards[i]; } catch (e) { /* ignore */ }
      }
    }
    return null;
  }

  // 收藏前再确认一次题目信息：context 里已取到就用现成的，否则当场从题卡 DOM 补取，仍取不到只记日志
  function ensureQuestionMeta(ctx) {
    if (!ctx) return ctx;
    if ((ctx.stem && ctx.stem.length) || (ctx.choices && ctx.choices.length)) return ctx;
    if (ctx.card) {
      const meta = extractQuestionMetaFromCard(ctx.card);
      if (meta.stem || meta.choices.length) {
        return Object.assign({}, ctx, { stem: meta.stem, choices: meta.choices });
      }
    }
    logWarn('未取到题干 / 选项（题卡 DOM 结构可能已变化），本次收藏按降级格式写入', ctx.label || '');
    return ctx;
  }

  // ---------------- v2.5.0：收藏 Markdown 组装（题目区块 + 评论条目） ----------------
  // 题目区块：题目标题 / 题干 / 选项在上，「收藏的评论」区在下（新评论插到该区末尾）
  function buildQuestionSection(ctx, commentBlock) {
    const c = ctx || {};
    const lines = [];
    lines.push(favQuestionMarker(c.questionId));
    lines.push('## ' + (c.label ? String(c.label) : '题目'));
    lines.push('');
    lines.push('**题干**');
    lines.push('');
    lines.push(c.stem ? String(c.stem) : '（未取到题干）');
    lines.push('');
    lines.push('**选项**');
    lines.push('');
    if (c.choices && c.choices.length) c.choices.forEach((t) => lines.push('- ' + t));
    else lines.push('（未取到选项）');
    lines.push('');
    lines.push('**收藏的评论**');
    lines.push('');
    lines.push(commentBlock);
    return lines.join('\n');
  }

  // 单条评论：只保留「收藏时间 + 正文引用」，隐藏标记仍在（判重依据）
  function buildCommentBlock(c, at) {
    const lines = [];
    lines.push(favMarker(c.id));
    lines.push('> 收藏时间：' + at);
    lines.push('>');
    const body = String(c.content == null ? '' : c.content).replace(/\s+$/, '');
    const bodyLines = body === '' ? [] : body.split(/\r?\n/);
    if (!bodyLines.length) lines.push('>');
    else bodyLines.forEach((ln) => lines.push(ln === '' ? '>' : '> ' + ln));
    return lines.join('\n');
  }

  // 组装一条待写入的收藏（题目区块 + 评论条目 + 两类标记），写入前一次成型便于复用 / 调试
  function buildFavoriteItem(c, ctx) {
    const at = formatFavTime(new Date());
    const commentBlock = buildCommentBlock(c, at);
    const meta = ctx || {};
    const questionMarker = favQuestionMarker(meta.questionId);
    return {
      at: at,
      commentMarker: favMarker(c.id),
      commentBlock: commentBlock,
      questionMarker: questionMarker,
      questionSection: buildQuestionSection(meta, commentBlock),
    };
  }

  // 合并一条收藏到已有 Markdown 文本（纯函数，供 appendCommentToWebdav 读写之间调用）
  //  - 该评论标记已存在 → duplicated（内容原样返回，不重复写入）
  //  - 该题区块已存在   → 把评论块插到「该题区块」评论区末尾（下一个题目区块之前）
  //  - 该题区块不存在   → 在文件末尾新建完整题目区块
  function mergeFavoriteIntoMarkdown(existingText, item) {
    const text = String(existingText == null ? '' : existingText);
    if (!item || !item.commentBlock || !item.questionSection) throw new Error('收藏内容为空，无法写入');
    if (item.commentMarker && text.indexOf(item.commentMarker) !== -1) {
      return { text: text, duplicated: true, createdQuestion: false };
    }
    const qIdx = item.questionMarker ? text.indexOf(item.questionMarker) : -1;
    if (qIdx === -1) {
      const trimmed = text.replace(/\s+$/, '');
      const sep = trimmed === '' ? '' : '\n\n';
      return { text: trimmed + sep + item.questionSection + '\n', duplicated: false, createdQuestion: true };
    }
    // 该题区块的范围：[题目标记, 下一个题目标记) —— 没有下一个题目则到文件末尾
    const headEnd = qIdx + item.questionMarker.length;
    const nextRel = text.slice(headEnd).search(/<!--\s*fcv:question:(?!\s*\.\.\.)[^>]*?-->/);
    const blockEnd = nextRel === -1 ? text.length : headEnd + nextRel;
    const before = text.slice(0, blockEnd).replace(/\s+$/, '');
    const tail = text.slice(blockEnd).replace(/^\s+/, '');
    const merged = before + '\n\n' + item.commentBlock + '\n';
    return { text: tail ? merged + '\n' + tail : merged, duplicated: false, createdQuestion: false };
  }

  // ---------------- v2.6.5：取消收藏（从收藏 Markdown 文本里移除一条收藏） ----------------
  function favTrimEnd(s) { return String(s == null ? '' : s).replace(/[ \t\r\n]+$/, ''); }
  function favTrimStart(s) { return String(s == null ? '' : s).replace(/^[ \t\r\n]+/, ''); }

  // 一条评论块的范围：[标记起点, 块尾) —— 块 = 标记所在行 + 紧随其后的引用行（`> ...`，含只写 `>` 的空行）；
  // 评论区之后要么是空行、要么是下一个区块，因此「第一行不以 > 开头」即为块尾。
  function favCommentBlockRange(text, markerIdx) {
    const lineEnd = text.indexOf('\n', markerIdx);
    let end = lineEnd === -1 ? text.length : lineEnd;
    while (end < text.length) {
      const nl = text.indexOf('\n', end + 1);
      const cur = nl === -1 ? text.length : nl;
      if (!/^[ \t]*>/.test(text.slice(end + 1, cur))) break;
      end = cur;
    }
    return { start: markerIdx, end: end };
  }

  // 全文所有题目区块标记的位置（排除文件头里的示例占位 `<!-- fcv:question:... -->`）
  function findQuestionMarkerOffsets(text) {
    const out = [];
    const re = /<!--\s*fcv:question:(?!\s*\.\.\.)[^>]*?-->/g;
    let m = re.exec(text);
    while (m !== null) {
      out.push({ head: m.index, tail: m.index + m[0].length });
      if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;   // 防零宽匹配死循环
      m = re.exec(text);
    }
    return out;
  }

  // 从收藏 Markdown 文本里移除一条收藏（纯函数，供 removeFavoriteFromWebdav 在读写之间调用）
  //  - 找不到该评论标记            → removed:false（内容原样返回，绝不动远端文件）
  //  - 该题区块下仍有其它收藏      → 只摘掉这条评论块，题目区块（题干 / 选项 / 其它收藏）保持不动
  //  - 该题区块下已无其它收藏      → 把整个题目区块（题目标题 / 题干 / 选项 / 收藏的评论）一并移除
  //  - 评论标记不在任何题目区块内  → 只摘评论块，绝不删题目区块与文件头（防误删）
  // 输出统一收尾为「区块之间一个空行 + 文件末尾一个换行」，保证反复收藏 / 取消后文件格式稳定。
  function removeFavoriteFromMarkdown(existingText, commentMarker) {
    const text = String(existingText == null ? '' : existingText);
    const marker = String(commentMarker == null ? '' : commentMarker);
    if (!marker || marker.indexOf('fcv:comment:') === -1) throw new Error('评论标记为空，无法取消收藏');
    const cIdx = text.indexOf(marker);
    if (cIdx === -1) {
      return {
        text: text, removed: false, questionDeleted: false, remainingInQuestion: 0,
        count: countFavMarkers(text), questions: countQuestionBlocks(text),
      };
    }
    const cut = favCommentBlockRange(text, cIdx);
    // 这条评论所属的题目区块 = 位置在它之前的最后一个题目区块标记
    const qs = findQuestionMarkerOffsets(text);
    let curQ = -1;
    let nextQ = -1;
    for (let i = 0; i < qs.length; i++) {
      if (qs[i].head < cIdx) { curQ = qs[i].head; nextQ = i + 1 < qs.length ? qs[i + 1].head : -1; }
    }
    let others = 0;
    if (curQ !== -1) {
      const inBlock = text.slice(curQ, nextQ === -1 ? text.length : nextQ);
      const all = inBlock.match(/<!--\s*fcv:comment:(?!\s*\.\.\.)[^>]*?-->/g);
      others = (all ? all.length : 0) - 1;
      if (others < 0) others = 0;
    }
    let out;
    let questionDeleted = false;
    if (curQ !== -1 && others === 0) {
      // 该题下已无其它收藏 → 整个题目区块（连同前后分隔空行）一并移除
      const pre = favTrimEnd(text.slice(0, curQ));
      const post = favTrimStart(text.slice(nextQ === -1 ? text.length : nextQ));
      out = (pre && post) ? (pre + '\n\n' + post) : (pre + post);
      questionDeleted = true;
    } else {
      // 该题还有别的收藏（或标记不在任何题块内）→ 只摘掉这条评论块
      const pre = favTrimEnd(text.slice(0, cut.start));
      const post = favTrimStart(text.slice(cut.end));
      out = (pre && post) ? (pre + '\n\n' + post) : (pre + post);
    }
    out = out ? (favTrimEnd(out) + '\n') : FAV_FILE_HEADER;
    return {
      text: out, removed: true, questionDeleted: questionDeleted,
      remainingInQuestion: questionDeleted ? 0 : others,
      count: countFavMarkers(out), questions: countQuestionBlocks(out),
    };
  }

  // ---------------- 轻提示（toast） ----------------
  // 兜底确保样式已注入（正常流程由 onDomReady 注入；此处保证从油猴菜单提前打开面板时也有样式）
  function ensureFcvStyles() {
    try { if (typeof injectStyles === 'function') injectStyles(); } catch (e) { /* 样式注入失败不影响功能 */ }
  }

  function ensureToastHost() {
    ensureFcvStyles();
    let host = document.getElementById('fcv-toast-host');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'fcv-toast-host';
    host.className = 'fcv-toast-host';
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  function showToast(message, opts) {
    opts = opts || {};
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = 'fcv-toast fcv-toast--' + (opts.type || 'info');
    const text = document.createElement('span');
    text.className = 'fcv-toast-text';
    text.textContent = String(message);
    el.appendChild(text);
    let timer = null;
    const dismiss = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      el.classList.add('fcv-toast--out');
      setTimeout(() => el.remove(), 220);
    };
    if (opts.actionText && typeof opts.onAction === 'function') {
      const act = document.createElement('button');
      act.type = 'button';
      act.className = 'fcv-toast-action';
      act.textContent = opts.actionText;
      act.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dismiss();
        try { opts.onAction(); } catch (e) { logWarn('提示操作失败', e); }
      });
      el.appendChild(act);
    }
    el.addEventListener('click', dismiss);
    host.appendChild(el);
    timer = setTimeout(dismiss, opts.duration || (opts.actionText ? 9000 : 2800));
    return dismiss;
  }

  // ---------------- 复制该条评论 ----------------
  function legacyCopyText(s) {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', 'readonly');
      ta.style.setProperty('position', 'fixed');
      ta.style.setProperty('top', '-1000px');
      ta.style.setProperty('left', '-1000px');
      ta.style.setProperty('opacity', '0');
      (document.body || document.documentElement).appendChild(ta);
      ta.focus();
      ta.select();
      try { ta.setSelectionRange(0, s.length); } catch (e) { /* 部分环境不支持 */ }
      const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
      ta.remove();
      return !!ok;
    } catch (e) { return false; }
  }

  function copyTextToClipboard(text) {
    const s = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(s).then(() => true).catch(() => legacyCopyText(s));
      }
    } catch (e) { /* 退回下面的老办法 */ }
    return Promise.resolve(legacyCopyText(s));
  }

  function handleCopyComment(c, btn) {
    const text = String((c && c.content) || '');
    if (!text) { showToast('这条评论没有可复制的正文', { type: 'warn' }); return; }
    const reset = () => {
      if (!btn) return;
      setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('fcv-act--done'); }, 1500);
    };
    copyTextToClipboard(text).then((ok) => {
      if (ok) {
        if (btn) { btn.textContent = '已复制'; btn.classList.add('fcv-act--done'); }
        showToast('已复制这条评论', { type: 'success' });
      } else {
        showToast('复制失败：浏览器拒绝了剪贴板写入，请手动选中评论内容复制', { type: 'error' });
      }
      reset();
    }).catch((e) => {
      logWarn('复制评论失败', e);
      showToast('复制失败：' + diagFormat(e), { type: 'error' });
      reset();
    });
  }

  // ---------------- 收藏 / 取消收藏该条评论 ----------------
  // v2.6.5：收藏按钮三态文案 —— 未收藏「收藏」、已收藏「已收藏」（悬浮切「取消收藏」）、操作中「收藏中」「取消中」
  const FAV_BTN_TEXT = {
    normal: '收藏',
    favorited: '已收藏',
    unfavoriteHint: '取消收藏',
    busyAdd: '收藏中',
    busyRemove: '取消中',
  };

  // 写按钮文案：hoverText 非空时写成「常态文案 + 悬浮文案」两层，由 CSS 在 hover 时切换
  function setFavLabel(btn, text, hoverText) {
    if (!btn) return;
    if (!hoverText) { btn.textContent = text; return; }
    btn.textContent = '';
    const idle = document.createElement('span');
    idle.className = 'fcv-fav-label';
    idle.textContent = text;
    const hint = document.createElement('span');
    hint.className = 'fcv-fav-hint';
    hint.textContent = hoverText;
    btn.appendChild(idle);
    btn.appendChild(hint);
  }

  function setFavButtonState(btn, state, c, opts) {
    if (!btn) return;
    opts = opts || {};
    if (state === 'busy') {
      btn.dataset.fcvBusy = 'true';
      btn.dataset.fcvAction = opts.action === 'remove' ? 'remove' : 'add';
      btn.classList.add('fcv-act--busy');
      btn.textContent = opts.action === 'remove' ? FAV_BTN_TEXT.busyRemove : FAV_BTN_TEXT.busyAdd;
      btn.setAttribute('title', opts.action === 'remove' ? '正在从 WebDAV 取消收藏…' : '正在收藏到 WebDAV…');
      return;
    }
    btn.dataset.fcvBusy = 'false';
    btn.dataset.fcvAction = 'none';
    btn.classList.remove('fcv-act--busy');
    if (state === 'favorited') {
      btn.classList.add('fcv-act--favorited');
      btn.setAttribute('title', '已收藏到 WebDAV（' + (getWebdavConfig().filePath || DEFAULT_WEBDAV_FILE) + '），再次点击可取消收藏');
      setFavLabel(btn, FAV_BTN_TEXT.favorited, FAV_BTN_TEXT.unfavoriteHint);
      return;
    }
    btn.classList.remove('fcv-act--favorited');
    setFavLabel(btn, FAV_BTN_TEXT.normal, '');
    const hasId = !!(c && c.id !== null && c.id !== undefined);
    btn.setAttribute('title', hasId
      ? ('收藏这条评论到 WebDAV（' + (getWebdavConfig().filePath || DEFAULT_WEBDAV_FILE) + '）')
      : '这条评论缺少评论 ID，无法收藏');
  }

  // v2.6.5：取消收藏该条评论（「已收藏」状态下再点一次按钮）
  // 走与收藏同一条事务：读远端 → 摘掉这条（该题已无其它收藏则整块删题）→ 整体回写（ETag 乐观锁）
  function handleUnfavoriteComment(c, btn) {
    if (!c || c.id === null || c.id === undefined) {
      showToast('这条评论缺少评论 ID，无法取消收藏', { type: 'warn' });
      return;
    }
    if (btn && btn.dataset.fcvBusy === 'true') return;
    if (!isWebdavConfigured()) {
      logWarn('点击取消收藏但尚未配置 WebDAV，已提示用户前往配置面板');
      showToast('尚未配置 WebDAV，无法取消收藏。请先填写 WebDAV 地址和账号。', {
        type: 'warn', actionText: '去配置', onAction: openWebdavSettings, duration: 9000,
      });
      return;
    }
    const cfg = getWebdavConfig();
    setFavButtonState(btn, 'busy', c, { action: 'remove' });
    // 返回 Promise，便于调用方 / 单测等待整条「读-改-写」事务结束
    return removeFavoriteFromWebdav(cfg, favMarker(c.id)).then((r) => {
      // 远端已无这条记录（文件不存在 / 文件里没有这条）→ 本机标记一并清掉，避免「本机以为已收藏」的假状态
      unmarkFavLocally(c.id);
      setFavButtonState(btn, 'normal', c);
      if (r && r.noFile) {
        showToast('远端收藏文件还不存在，已清除本机的「已收藏」标记', { type: 'info', duration: 4000 });
      } else if (r && r.noComment) {
        showToast('远端文件里没有这条评论的记录，已同步清除本机的「已收藏」标记', { type: 'info', duration: 4000 });
      } else if (r && r.questionDeleted) {
        showToast('已取消收藏；该题下已无其它收藏，题目区块已一并移除（' + cfg.filePath + '）', { type: 'success', duration: 4000 });
      } else {
        showToast('已取消收藏（' + cfg.filePath + '，该题下还有 ' + ((r && r.remainingInQuestion) || 0) + ' 条收藏）', { type: 'success', duration: 4000 });
      }
    }).catch((e) => {
      logError('取消收藏（WebDAV）失败', e);
      setFavButtonState(btn, 'favorited', c);
      showToast('取消收藏失败：' + diagFormat(e), { type: 'error', duration: 8000 });
    });
  }

  function handleFavoriteComment(c, btn, ctx) {
    if (!c || c.id === null || c.id === undefined) {
      showToast('这条评论缺少评论 ID，无法收藏', { type: 'warn' });
      return;
    }
    if (btn && btn.dataset.fcvBusy === 'true') return;
    if (isFavLocally(c.id)) {
      // v2.6.5：已收藏状态再点一次 = 取消收藏（远端移除该条；该题无其它收藏则整块删题）
      setFavButtonState(btn, 'favorited', c);
      handleUnfavoriteComment(c, btn);
      return;
    }
    // 未配置 WebDAV：明确提示 + 给「去配置」入口
    if (!isWebdavConfigured()) {
      logWarn('点击收藏但尚未配置 WebDAV，已提示用户前往配置面板');
      showToast('尚未配置 WebDAV，无法收藏。请先填写 WebDAV 地址和账号。', {
        type: 'warn', actionText: '去配置', onAction: openWebdavSettings, duration: 9000,
      });
      return;
    }
    const cfg = getWebdavConfig();
    // v2.5.0：按题目聚合写入 —— 题目信息（ID / 题干 / 选项）在此再确认一次，取不到就降级为空、不阻断收藏
    const item = buildFavoriteItem(c, ensureQuestionMeta(ctx));
    setFavButtonState(btn, 'busy', c, { action: 'add' });
    return appendCommentToWebdav(cfg, item).then((r) => {
      markFavLocally(c.id);
      setFavButtonState(btn, 'favorited', c);
      if (r && r.duplicated) {
        showToast('远端文件里已有这条评论的记录，已标记为已收藏', { type: 'info', duration: 4000 });
      } else {
        showToast((r && r.created ? '已新建并收藏到 ' : '已收藏到 ') + cfg.filePath +
          (r && r.createdQuestion ? '（新建了该题区块）' : '（已并入该题区块）'),
        { type: 'success', duration: 4000 });
      }
    }).catch((e) => {
      logError('收藏评论到 WebDAV 失败', e);
      setFavButtonState(btn, 'normal', c);
      showToast('收藏失败：' + diagFormat(e), { type: 'error', duration: 8000 });
    });
  }

  // ---------------- WebDAV 配置面板 ----------------
  function isWebdavSettingsOpen() { return !!document.querySelector('.fcv-settings-overlay'); }

  function closeWebdavSettings() {
    const overlay = document.querySelector('.fcv-settings-overlay');
    if (!overlay) return;
    if (overlay.__fcvOnKeydown) document.removeEventListener('keydown', overlay.__fcvOnKeydown, true);
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 200);
  }

  function openWebdavSettings() {
    closeWebdavSettings();
    ensureFcvStyles();
    const cfg = getWebdavConfig();
    const overlay = document.createElement('div');
    overlay.className = 'fcv-settings-overlay' + (detectDarkMode() ? ' dark' : '');
    const panel = document.createElement('div');
    panel.className = 'fcv-settings-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML =
      '<div class="fcv-settings-head">' +
        '<h3>WebDAV 收藏设置</h3>' +
        '<button type="button" class="fcv-settings-close" aria-label="关闭设置">&times;</button>' +
      '</div>' +
      '<div class="fcv-settings-body">' +
        '<div class="fcv-field">' +
          '<label for="fcv-wd-url">服务器地址（WebDAV 根地址）</label>' +
          '<input id="fcv-wd-url" class="fcv-input fcv-wd-url" type="text" spellcheck="false" autocomplete="off" placeholder="https://nas.example.com:5006/webdav 或 https://dav.jianguoyun.com/dav/">' +
          '<div class="fcv-field-tip">填到 WebDAV 根路径这一级即可，末尾带不带「/」都可以。坚果云固定为 https://dav.jianguoyun.com/dav/。</div>' +
        '</div>' +
        '<div class="fcv-field">' +
          '<label for="fcv-wd-user">账号</label>' +
          '<input id="fcv-wd-user" class="fcv-input fcv-wd-user" type="text" spellcheck="false" autocomplete="off" placeholder="WebDAV 登录账号">' +
        '</div>' +
        '<div class="fcv-field">' +
          '<label for="fcv-wd-pass">密码</label>' +
          '<input id="fcv-wd-pass" class="fcv-input fcv-wd-pass" type="password" autocomplete="off" placeholder="WebDAV 登录密码">' +
        '</div>' +
        '<div class="fcv-field">' +
          '<label for="fcv-wd-path">保存路径（相对 WebDAV 根目录）</label>' +
          '<input id="fcv-wd-path" class="fcv-input fcv-wd-path" type="text" spellcheck="false" autocomplete="off" placeholder="我的坚果云/fenbi/fenbi-comments.md">' +
          '<div class="fcv-field-tip">留空默认 ' + DEFAULT_WEBDAV_FILE + '；文件或上级目录不存在会自动创建。注意这类 WebDAV 的根目录往往是「虚拟服务根」、不能直接放文件，路径要带目录层级——坚果云最外层固定是「我的坚果云」，只填文件名时会自动补上「我的坚果云/」。</div>' +
        '</div>' +
        '<div class="fcv-settings-actions">' +
          '<button type="button" class="fcv-settings-btn fcv-settings-save">保存配置</button>' +
          '<button type="button" class="fcv-settings-btn fcv-settings-test">测试连接</button>' +
          '<button type="button" class="fcv-settings-btn fcv-settings-clear">清空配置</button>' +
        '</div>' +
        '<div class="fcv-settings-result" hidden></div>' +
        '<div class="fcv-settings-help">' +
          '<div class="fcv-settings-help-title">填写示例与说明</div>' +
          '<div class="fcv-settings-help-row"><b>服务器地址</b>极空间形如 https://你的设备:5006/webdav —— 请在「系统设置 → 文件服务 / WebDAV」中开启服务，并以该页面显示的地址和端口为准（填错通常报 HTTP 404 或 401）；坚果云为固定地址 https://dav.jianguoyun.com/dav/。</div>' +
          '<div class="fcv-settings-help-row"><b>账号 / 密码</b>访问该 WebDAV 的账号密码。极空间一般就是登录账号与密码；坚果云账号为登录邮箱，密码必须用「账户信息 → 安全选项 → 添加应用」生成的<b>应用密码</b>（填登录密码会报 HTTP 401）。</div>' +
          '<div class="fcv-settings-help-row"><b>保存路径</b>相对 WebDAV 根目录的路径（如 marvis/fenbi-comments.md）；不存在的目录会自动创建，已有内容不会被覆盖。注意这类 WebDAV 的「根」通常是虚拟服务根、不能直接放文件，路径必须带目录层级：坚果云最外层固定为「我的坚果云」，例如 我的坚果云/fenbi/fenbi-comments.md（只填文件名时会自动补上「我的坚果云/」）。</div>' +
          '<div class="fcv-settings-help-row"><b>写入方式</b>按题目聚合。先读取远端已有内容 → 这道题已有区块就把评论并入该题「收藏的评论」区末尾，没有就在文件末尾新建题目区块（题目标题 / 题干 / 选项 + 收藏的评论）→ 整体回写，并用 ETag 乐观锁防并发覆盖；同一条评论只写入一次（靠评论隐藏标记判重，题目区块靠题目隐藏标记聚合）。取消收藏走同一条「读远端 → 改 → 整体回写」链路：先按评论隐藏标记摘掉该条评论，该题下已无其它收藏则把整个题目区块一并移除，ETag 乐观锁与冲突重试保持一致。</div>' +
          '<div class="fcv-settings-help-row"><b>收藏内容</b>每条评论只保留「收藏时间 + 评论正文（引用格式）」；题干与选项从题卡页面直接取材，页面结构变化时可能取不到（此时留空占位，不影响收藏）。</div>' +
          '<div class="fcv-settings-help-row"><b>请求通道</b>' + (typeof GM_xmlhttpRequest === 'function'
            ? 'GM_xmlhttpRequest（不受浏览器跨域限制，推荐）'
            : 'fetch（受浏览器跨域限制；若连接失败，请确认脚本已获得 GM_xmlhttpRequest 授权）') + '</div>' +
          '<div class="fcv-settings-help-row fcv-settings-help-warn"><b>隐私提示</b>地址 / 账号 / 密码只保存在本机（油猴存储或浏览器 localStorage，密码为明文），仅发送给你填写的 WebDAV 服务器，不会上传到其它任何地方；公用电脑请谨慎保存。</div>' +
        '</div>' +
      '</div>';
    overlay.appendChild(panel);
    (document.body || document.documentElement).appendChild(overlay);

    const urlEl = panel.querySelector('.fcv-wd-url');
    const userEl = panel.querySelector('.fcv-wd-user');
    const passEl = panel.querySelector('.fcv-wd-pass');
    const pathEl = panel.querySelector('.fcv-wd-path');
    const resultEl = panel.querySelector('.fcv-settings-result');
    const testBtn = panel.querySelector('.fcv-settings-test');
    urlEl.value = cfg.url;
    userEl.value = cfg.username;
    passEl.value = cfg.password;
    pathEl.value = cfg.filePath;

    const readForm = () => ({ url: urlEl.value, username: userEl.value, password: passEl.value, filePath: pathEl.value });
    const showResult = (html, type) => {
      resultEl.hidden = false;
      resultEl.className = 'fcv-settings-result fcv-settings-result--' + (type || 'info');
      resultEl.innerHTML = html;
    };

    panel.querySelector('.fcv-settings-close').addEventListener('click', closeWebdavSettings);

    panel.querySelector('.fcv-settings-save').addEventListener('click', () => {
      const okSave = saveWebdavConfig(readForm());
      showResult(okSave
        ? '配置已保存（服务器地址 / 账号 / 密码 / 保存路径）。现在可以直接在评论上点「收藏」了。'
        : '配置已在本次会话生效，但写入本机存储失败（可能是隐私模式或存储被禁用），刷新页面后可能需要重新填写。',
        okSave ? 'ok' : 'warn');
    });

    testBtn.addEventListener('click', () => {
      const testCfg = normalizeWebdavConfig(readForm());
      if (!testCfg.url || !testCfg.username) {
        showResult('请先填写「服务器地址」与「账号」，再测试连接。', 'err');
        return;
      }
      saveWebdavConfig(testCfg);   // 顺手保存，避免测完还要再点一次「保存配置」
      const oldText = testBtn.textContent;
      testBtn.disabled = true;
      testBtn.textContent = '测试中…';
      showResult('正在连接 ' + escapeHtml(testCfg.url) + ' …', 'info');
      testWebdavConnection(testCfg).then((r) => {
        showResult('连接成功：HTTP ' + r.status + '，通道 ' + r.via + (r.dav ? '，DAV: ' + escapeHtml(r.dav) : '') + '。<br>' +
          '目标文件 ' + escapeHtml(r.filePath) + '：' + (r.fileExists
            ? ('已存在，其中题目区块 ' + r.fileQuestions + ' 个、收藏评论 ' + r.fileCount + ' 条')
            : '不存在（首次收藏时会自动创建）'), 'ok');
      }).catch((e) => {
        logWarn('WebDAV 连接测试失败', e);
        showResult('连接失败：' + escapeHtml(diagFormat(e)) +
          '<br>请依次检查：① 服务器地址与端口是否正确（极空间：系统设置 → 文件服务 / WebDAV）；② 账号密码；③ WebDAV 服务是否已开启。', 'err');
      }).then(() => {
        testBtn.disabled = false;
        testBtn.textContent = oldText;
      });
    });

    panel.querySelector('.fcv-settings-clear').addEventListener('click', () => {
      // 仅清空本机保存的配置（不触碰远端文件），清空前二次确认防误点
      let okClear = true;
      try {
        okClear = typeof window.confirm === 'function'
          ? window.confirm('确认清空本机保存的 WebDAV 配置？\n（远端文件里已收藏的评论不会受影响）')
          : true;
      } catch (e) { okClear = true; }
      if (!okClear) return;
      clearWebdavConfig();
      urlEl.value = '';
      userEl.value = '';
      passEl.value = '';
      pathEl.value = DEFAULT_WEBDAV_FILE;
      showResult('已清空本机保存的 WebDAV 配置（远端已收藏的文件不受影响）。', 'warn');
    });

    const onKeydown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      closeWebdavSettings();
    };
    overlay.__fcvOnKeydown = onKeydown;
    document.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWebdavSettings(); });
    requestAnimationFrame(() => overlay.classList.add('active'));
    try { urlEl.focus(); } catch (e) { /* 焦点失败无碍 */ }
    logInfo('已打开 WebDAV 收藏设置面板', '当前配置=' + (isWebdavConfigured() ? '已配置' : '未配置'));
    return overlay;
  }

  // ==================== v2.7.0：「我的收藏」入口 + 收藏列表面板 ====================
  // 目标：既有「收藏 / 取消收藏」写入逻辑一行不动，只新增「读 + 展示 + 复用删除链路」的只读面板：
  //   ① 页面顶部固定注入「★ 我的收藏」入口按钮（不进题卡、不改动「查看评论」按钮定位）；
  //   ② 点开用模态框承载（复用评论弹窗骨架 / 主题 / Esc 与遮罩关闭），默认按「收藏的评论」视图逐条列出
  //      （收藏时间 + 正文），每条行尾「展开」看该题题号 / 题目 / 题干 / 选项，「删除」移除该条；
  //   ③ 顶部可切换到「题目区块」视图（按题成组看题干 / 选项 / 该题收藏的评论）；
  //   ④ 面板底部提供连接测试 / WebDAV 设置入口，未配置 / 读取失败 / 暂无收藏各有空状态。
  const FAV_ENTRY_ID = 'fcv-fav-entry';
  const FAV_ROW_PREVIEW_MAX = 150;      // 评论视图单行正文预览字数（展开后显示全文）
  const FAV_DELETE_CONFIRM_MS = 4000;   // 行内「删除」需二次点击确认的有效期

  let favPanelRef = null;               // 当前打开的收藏面板（同一时刻只保留一个）

  // ---- 纯函数：解析收藏 Markdown（无 DOM 依赖，可离线单测）----
  // 把「**收藏的评论**」段的文本行解析成 [{commentId, marker, time, body}]
  function parseFavCommentsFromLines(lines) {
    const out = [];
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const body = cur.bodyLines.slice();
      while (body.length && String(body[0]).trim() === '') body.shift();
      while (body.length && String(body[body.length - 1]).trim() === '') body.pop();
      cur.body = body.join('\n');
      delete cur.bodyLines;
      out.push(cur);
      cur = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const raw = String(lines[i] == null ? '' : lines[i]);
      const mm = /<!--\s*fcv:comment:\s*([^>]*?)\s*-->/.exec(raw);
      if (mm) {
        flush();
        const cid = mm[1].trim();
        cur = { commentId: cid, marker: favMarker(cid), time: '', body: '', bodyLines: [] };
        continue;
      }
      if (!cur) continue;
      const qm = /^[ \t]*>(.*)$/.exec(raw);
      if (!qm) continue;                          // 非引用行（空行 / 区块收尾）不计入正文
      const inner = qm[1];
      const tm = /^\s*收藏时间：\s*(.*)$/.exec(inner);
      if (tm) { cur.time = tm[1].trim(); continue; }
      cur.bodyLines.push(inner.replace(/^ /, ''));
    }
    flush();
    return out;
  }

  // 把整份收藏文件解析成 [{questionId, marker, label, stem, choices, comments}]
  function parseFavoritesMarkdown(text) {
    const src = String(text == null ? '' : text);
    const marks = findQuestionMarkerOffsets(src);
    const questions = [];
    for (let i = 0; i < marks.length; i++) {
      const head = marks[i].head;
      const tail = marks[i].tail;
      const end = i + 1 < marks.length ? marks[i + 1].head : src.length;
      const markerText = src.slice(head, tail);
      const idMatch = /fcv:question:\s*([^>]*?)\s*-->/.exec(markerText);
      const q = {
        questionId: idMatch ? idMatch[1].trim() : '',
        marker: markerText,
        label: '',
        stem: '',
        choices: [],
        comments: [],
      };
      const lines = src.slice(tail, end).split(/\r?\n/);
      const stemLines = [];
      const commentLines = [];
      let section = '';
      for (let j = 0; j < lines.length; j++) {
        const t = String(lines[j] == null ? '' : lines[j]).trim();
        const lm = q.label ? null : /^##\s+(.+)$/.exec(t);
        if (lm) { q.label = lm[1].trim(); continue; }
        if (t === '**题干**') { section = 'stem'; continue; }
        if (t === '**选项**') { section = 'choices'; continue; }
        if (t === '**收藏的评论**') { section = 'comments'; continue; }
        if (section === 'stem') { if (t) stemLines.push(t); continue; }
        if (section === 'choices') {
          const cm = /^[-*]\s+(.+)$/.exec(t);
          if (cm) q.choices.push(cm[1].trim());
          continue;
        }
        if (section === 'comments') commentLines.push(lines[j]);
      }
      q.stem = stemLines.join(' ');
      q.comments = parseFavCommentsFromLines(commentLines);
      questions.push(q);
    }
    let commentCount = 0;
    for (let i = 0; i < questions.length; i++) commentCount += questions[i].comments.length;
    return { questions: questions, questionCount: questions.length, commentCount: commentCount };
  }

  // 评论优先的扁平视图：每条收藏评论 + 所属题目信息；按收藏时间倒序（无时间 / 同时间保持文件顺序）
  function collectFavoriteComments(parsed) {
    const flat = [];
    const qs = (parsed && parsed.questions) || [];
    for (let qi = 0; qi < qs.length; qi++) {
      const q = qs[qi];
      const cs = q.comments || [];
      for (let ci = 0; ci < cs.length; ci++) {
        flat.push({
          commentId: cs[ci].commentId,
          marker: cs[ci].marker,
          time: cs[ci].time,
          body: cs[ci].body,
          questionId: q.questionId,
          label: q.label,
          stem: q.stem,
          choices: q.choices,
          questionIndex: qi,
          order: flat.length,
        });
      }
    }
    flat.sort((a, b) => {
      const ta = String(a.time || '');
      const tb = String(b.time || '');
      if (ta === tb) return a.order - b.order;
      if (!ta) return 1;
      if (!tb) return -1;
      return ta < tb ? 1 : -1;      // 「YYYY-MM-DD HH:mm:ss」同格式，可直接字符串比较
    });
    return flat;
  }

  function favPreviewLine(text, max) {
    const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const n = max || FAV_ROW_PREVIEW_MAX;
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // ---- 顶部入口按钮 ----
  function ensureFavoritesEntryButton() {
    try {
      if (!document.body) return null;
      const exist = document.getElementById(FAV_ENTRY_ID);
      if (exist) return exist;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = FAV_ENTRY_ID;
      btn.className = 'fcv-fav-entry';
      btn.textContent = '★ 我的收藏';
      btn.title = '查看 / 管理已收藏的评论（保存在 WebDAV）';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFavoritesPanel();
      });
      document.body.appendChild(btn);
      logInfo('已注入「我的收藏」入口按钮', 'id=' + FAV_ENTRY_ID);
      return btn;
    } catch (e) {
      logWarn('注入「我的收藏」入口按钮失败', e);
      return null;
    }
  }

  function isFavoritesPanelOpen() {
    return !!(favPanelRef && !favPanelRef.isClose());
  }

  // ---- 面板：骨架（工具条 + 内容区 + 底栏）----
  function openFavoritesPanel() {
    if (isFavoritesPanelOpen()) {
      reloadFavorites(favPanelRef);
      return favPanelRef;
    }
    ensureFcvStyles();
    const m = createModal('我的收藏');
    m.modal.classList.add('fcv-fav-modal');
    m.favView = 'comments';
    m.favParsed = null;
    m.favLoading = false;
    m.favError = '';
    m.favNeedsConfig = false;
    m.favFileExists = false;
    m.favFilePath = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'fcv-fav-toolbar';
    toolbar.innerHTML =
      '<div class="fcv-fav-tabs">' +
        '<button type="button" class="fcv-fav-tab fcv-fav-tab--active" data-fcv-view="comments">收藏的评论</button>' +
        '<button type="button" class="fcv-fav-tab" data-fcv-view="questions">题目区块</button>' +
      '</div>' +
      '<div class="fcv-fav-status">正在读取远端收藏…</div>';
    m.modal.insertBefore(toolbar, m.content);
    m.favToolbar = toolbar;
    m.favStatusEl = toolbar.querySelector('.fcv-fav-status');
    toolbar.querySelectorAll('.fcv-fav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const view = tab.getAttribute('data-fcv-view');
        if (m.favView === view || m.isClose()) return;
        m.favView = view;
        toolbar.querySelectorAll('.fcv-fav-tab').forEach((x) => {
          x.classList.toggle('fcv-fav-tab--active', x === tab);
        });
        renderFavoritesPanel(m);
      });
    });

    const footer = document.createElement('div');
    footer.className = 'fcv-fav-footer';
    footer.innerHTML =
      '<div class="fcv-fav-result" hidden></div>';
    m.modal.appendChild(footer);
    m.favResultEl = footer.querySelector('.fcv-fav-result');

    m.registerCleanup(() => { if (favPanelRef === m) favPanelRef = null; });
    favPanelRef = m;
    showModalMessage(m, '<div class="loading-spinner"></div><div>正在从 WebDAV 读取收藏内容…</div>');
    reloadFavorites(m);
    return m;
  }

  function setFavStatus(m, text) {
    if (m.isClose() || !m.favStatusEl) return;
    m.favStatusEl.textContent = String(text);
  }

  // ---- 读取远端收藏并渲染 ----
  function reloadFavorites(m) {
    if (m.isClose()) return Promise.resolve();
    if (!isWebdavConfigured()) {
      m.favLoading = false;
      m.favError = '';
      m.favNeedsConfig = true;
      m.favParsed = null;
      renderFavoritesPanel(m);
      return Promise.resolve();
    }
    const cfg = getWebdavConfig();
    m.favNeedsConfig = false;
    m.favLoading = true;
    m.favFilePath = cfg.filePath || DEFAULT_WEBDAV_FILE;
    setFavStatus(m, '正在读取远端收藏…');
    showModalMessage(m, '<div class="loading-spinner"></div><div>正在从 WebDAV 读取收藏内容…</div>');
    return webdavGetFile(cfg).then((res) => {
      if (m.isClose()) return;
      m.favLoading = false;
      m.favError = '';
      m.favFileExists = !!(res && res.exists);
      m.favParsed = parseFavoritesMarkdown(res && res.exists ? res.content : '');
      renderFavoritesPanel(m);
    }).catch((e) => {
      logWarn('读取远端收藏失败', e);
      if (m.isClose()) return;
      m.favLoading = false;
      m.favParsed = null;
      m.favError = diagFormat(e);
      renderFavoritesPanel(m);
    });
  }

  function renderFavoritesPanel(m) {
    if (m.isClose() || m.favLoading) return;
    if (m.favNeedsConfig) { renderFavoritesNeedConfig(m); return; }
    if (m.favError) { renderFavoritesError(m); return; }
    const parsed = m.favParsed || parseFavoritesMarkdown('');
    if (parsed.commentCount === 0 && parsed.questionCount === 0) { renderFavoritesEmpty(m, parsed); return; }
    const list = document.createElement('div');
    list.className = 'fcv-fav-list';
    if (m.favView === 'questions') renderFavQuestionRows(m, list, parsed);
    else renderFavCommentRows(m, list, parsed);
    m.content.innerHTML = '';
    m.content.appendChild(list);
    setFavStatus(m, '共 ' + parsed.commentCount + ' 条收藏评论 · ' + parsed.questionCount + ' 个题目区块 · ' + m.favFilePath);
  }

  // ---- 评论视图 ----
  function renderFavCommentRows(m, list, parsed) {
    const items = collectFavoriteComments(parsed);
    if (items.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'fcv-fav-hint-row';
      hint.textContent = '收藏文件里还没有评论记录（题目区块 ' + parsed.questionCount + ' 个），可切到「题目区块」视图查看。';
      list.appendChild(hint);
      return;
    }
    items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'fcv-fav-row';
      row.setAttribute('data-comment-id', it.commentId);

      const head = document.createElement('div');
      head.className = 'fcv-fav-row-head';
      const timeEl = document.createElement('span');
      timeEl.className = 'fcv-fav-time';
      timeEl.textContent = it.time || '（未记录收藏时间）';
      const tag = document.createElement('span');
      tag.className = 'fcv-fav-qtag';
      tag.textContent = (it.label || '题目') + (it.questionId ? ' · 题号 ' + it.questionId : '');
      const spacer = document.createElement('span');
      spacer.className = 'fcv-fav-spacer';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'fcv-fav-toggle';
      toggle.textContent = '展开';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'fcv-fav-del';
      del.textContent = '删除';
      del.title = '从远端收藏文件里删除这条评论';
      head.appendChild(timeEl);
      head.appendChild(tag);
      head.appendChild(spacer);
      head.appendChild(toggle);
      head.appendChild(del);

      const bodyText = it.body || '';
      const textEl = document.createElement('div');
      textEl.className = 'fcv-fav-text';
      textEl.textContent = bodyText ? favPreviewLine(bodyText) : '（这条收藏没有正文）';

      const detail = buildFavQuestionDetail(it, bodyText);
      detail.hidden = true;

      toggle.addEventListener('click', () => {
        const willOpen = detail.hidden;
        detail.hidden = !willOpen;
        toggle.textContent = willOpen ? '收起' : '展开';
        toggle.classList.toggle('fcv-fav-toggle--open', willOpen);
        textEl.textContent = (willOpen || !bodyText) ? (bodyText || '（这条收藏没有正文）') : favPreviewLine(bodyText);
      });
      del.addEventListener('click', () => { handlePanelDelete(m, it.commentId, del); });

      row.appendChild(head);
      row.appendChild(textEl);
      row.appendChild(detail);
      list.appendChild(row);
    });
  }

  // ---- 题目区块视图 ----
  function renderFavQuestionRows(m, list, parsed) {
    parsed.questions.forEach((q) => {
      const row = document.createElement('div');
      row.className = 'fcv-fav-row fcv-fav-qrow';

      const head = document.createElement('div');
      head.className = 'fcv-fav-row-head';
      const tag = document.createElement('span');
      tag.className = 'fcv-fav-qtag';
      tag.textContent = (q.label || '题目') + (q.questionId ? ' · 题号 ' + q.questionId : '');
      const count = document.createElement('span');
      count.className = 'fcv-fav-count';
      count.textContent = '收藏 ' + q.comments.length + ' 条';
      const spacer = document.createElement('span');
      spacer.className = 'fcv-fav-spacer';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'fcv-fav-toggle';
      toggle.textContent = '展开';
      head.appendChild(tag);
      head.appendChild(count);
      head.appendChild(spacer);
      head.appendChild(toggle);

      const stemLine = document.createElement('div');
      stemLine.className = 'fcv-fav-text';
      stemLine.textContent = q.stem ? favPreviewLine(q.stem, 80) : '（未取到题干）';

      const detail = document.createElement('div');
      detail.className = 'fcv-fav-detail';
      detail.hidden = true;
      detail.appendChild(buildFavDetailRow('题号', q.questionId || '未知'));
      detail.appendChild(buildFavDetailStem(q.stem));
      detail.appendChild(buildFavDetailChoices(q.choices));
      if (q.comments.length === 0) {
        detail.appendChild(buildFavDetailRow('收藏的评论', '（该区块下没有评论记录）'));
      } else {
        q.comments.forEach((c) => {
          const box = document.createElement('div');
          box.className = 'fcv-fav-cbox';
          const cHead = document.createElement('div');
          cHead.className = 'fcv-fav-cbox-head';
          const cTime = document.createElement('span');
          cTime.className = 'fcv-fav-cbox-time';
          cTime.textContent = c.time || '（未记录收藏时间）';
          const cSpacer = document.createElement('span');
          cSpacer.className = 'fcv-fav-spacer';
          const cDel = document.createElement('button');
          cDel.type = 'button';
          cDel.className = 'fcv-fav-del';
          cDel.textContent = '删除';
          cDel.title = '从远端收藏文件里删除这条评论';
          cDel.addEventListener('click', () => { handlePanelDelete(m, c.commentId, cDel); });
          cHead.appendChild(cTime);
          cHead.appendChild(cSpacer);
          cHead.appendChild(cDel);
          const cBody = document.createElement('div');
          cBody.className = 'fcv-fav-cbox-body';
          cBody.textContent = c.body || '（这条收藏没有正文）';
          box.appendChild(cHead);
          box.appendChild(cBody);
          detail.appendChild(box);
        });
      }

      toggle.addEventListener('click', () => {
        const willOpen = detail.hidden;
        detail.hidden = !willOpen;
        toggle.textContent = willOpen ? '收起' : '展开';
        toggle.classList.toggle('fcv-fav-toggle--open', willOpen);
      });

      row.appendChild(head);
      row.appendChild(stemLine);
      row.appendChild(detail);
      list.appendChild(row);
    });
  }

  function buildFavDetailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'fcv-fav-detail-row';
    const b = document.createElement('b');
    b.textContent = label;
    const span = document.createElement('span');
    span.textContent = String(value == null ? '' : value);
    row.appendChild(b);
    row.appendChild(span);
    return row;
  }

  function buildFavDetailStem(stem) {
    return buildFavDetailRow('题干', stem || '（未取到题干）');
  }

  function buildFavDetailChoices(choices) {
    if (!choices || !choices.length) return buildFavDetailRow('选项', '（未取到选项）');
    const row = document.createElement('div');
    row.className = 'fcv-fav-detail-row fcv-fav-detail-choices';
    const b = document.createElement('b');
    b.textContent = '选项';
    const ul = document.createElement('ul');
    choices.forEach((c) => {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    });
    row.appendChild(b);
    row.appendChild(ul);
    return row;
  }

  // 评论视图展开块：题号 / 题目 / 题干 / 选项 / 完整正文
  function buildFavQuestionDetail(it, body) {
    const box = document.createElement('div');
    box.className = 'fcv-fav-detail';
    box.appendChild(buildFavDetailRow('题号', it.questionId || '未知'));
    box.appendChild(buildFavDetailRow('题目', it.label || '题目'));
    box.appendChild(buildFavDetailStem(it.stem));
    box.appendChild(buildFavDetailChoices(it.choices));
    box.appendChild(buildFavDetailRow('评论正文', body || '（这条收藏没有正文）'));
    return box;
  }

  // ---- 空状态 / 未配置 / 读取失败 ----
  function buildFavEmptyBox(icon, title, tip, actions) {
    const box = document.createElement('div');
    box.className = 'fcv-fav-empty';
    const i = document.createElement('div');
    i.className = 'fcv-fav-empty-icon';
    i.textContent = icon;
    const t = document.createElement('div');
    t.className = 'fcv-fav-empty-title';
    t.textContent = title;
    const tipEl = document.createElement('div');
    tipEl.className = 'fcv-fav-empty-tip';
    tipEl.textContent = tip;
    box.appendChild(i);
    box.appendChild(t);
    box.appendChild(tipEl);
    if (actions && actions.length) {
      const wrap = document.createElement('div');
      wrap.className = 'fcv-fav-empty-actions';
      actions.forEach((a) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fcv-fav-empty-btn';
        btn.textContent = a.text;
        btn.addEventListener('click', a.onClick);
        wrap.appendChild(btn);
      });
      box.appendChild(wrap);
    }
    return box;
  }

  function renderFavoritesNeedConfig(m) {
    m.content.innerHTML = '';
    setFavStatus(m, '尚未配置 WebDAV');
    m.content.appendChild(buildFavEmptyBox('☆', '尚未配置 WebDAV',
      '收藏内容保存在你自己的 WebDAV 服务器上。填好服务器地址、账号与保存路径后，这里会列出全部已收藏的评论。',
      [
        { text: '去配置 WebDAV', onClick: () => { openWebdavSettings(); } },
        { text: '刷新列表', onClick: () => { reloadFavorites(m); } },
      ]));
  }

  function renderFavoritesError(m) {
    m.content.innerHTML = '';
    setFavStatus(m, '读取失败：' + m.favError);
    m.content.appendChild(buildFavEmptyBox('!', '读取收藏失败',
      '原因：' + m.favError + '\n请确认 WebDAV 地址 / 账号 / 保存路径可用，或点「连接测试」查看详细返回。',
      [
        { text: '重试', onClick: () => { reloadFavorites(m); } },
        { text: '连接测试', onClick: () => { runFavoritesConnectionTest(m); } },
        { text: 'WebDAV 设置', onClick: () => { openWebdavSettings(); } },
      ]));
  }

  function renderFavoritesEmpty(m, parsed) {
    m.content.innerHTML = '';
    const localCount = getFavIdSet().size;
    setFavStatus(m, '共 0 条收藏评论 · 0 个题目区块 · ' + m.favFilePath);
    let tip = '在题目的评论弹窗里点某条评论右侧的「收藏」，就会写入远端文件 ' + m.favFilePath + '；'
      + (m.favFileExists ? '当前远端文件已存在，但里面还没有收藏记录。' : '当前远端文件还不存在，第一次收藏时会自动创建。');
    if (localCount > 0) tip += '\n注意：本机记录已收藏 ' + localCount + ' 条，但远端文件里没有对应内容，可用「刷新列表」重试或在「题目区块」视图确认。';
    if (parsed && parsed.questionCount > 0) tip += '\n远端文件里有 ' + parsed.questionCount + ' 个题目区块，但其中没有评论记录，可切到「题目区块」视图查看。';
    m.content.appendChild(buildFavEmptyBox('☆', '还没有收藏任何评论', tip,
      [
        { text: '刷新列表', onClick: () => { reloadFavorites(m); } },
        { text: 'WebDAV 设置', onClick: () => { openWebdavSettings(); } },
      ]));
  }

  // ---- 删除（行内二次确认 → 复用既有 removeFavoriteFromWebdav）----
  function handlePanelDelete(m, commentId, btn) {
    if (!commentId) {
      showToast('这条收藏缺少评论 ID，无法删除', { type: 'warn' });
      return;
    }
    if (btn.dataset.fcvBusy === 'true') return;
    if (btn.dataset.fcvConfirm !== 'true') {
      btn.dataset.fcvConfirm = 'true';
      btn.dataset.fcvOldText = btn.textContent;
      btn.textContent = '确认删除';
      btn.classList.add('fcv-fav-del--confirm');
      if (btn.__fcvConfirmTimer) clearTimeout(btn.__fcvConfirmTimer);
      btn.__fcvConfirmTimer = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.dataset.fcvConfirm = 'false';
        btn.textContent = btn.dataset.fcvOldText || '删除';
        btn.classList.remove('fcv-fav-del--confirm');
      }, FAV_DELETE_CONFIRM_MS);
      return;
    }
    if (btn.__fcvConfirmTimer) clearTimeout(btn.__fcvConfirmTimer);
    if (!isWebdavConfigured()) {
      showToast('尚未配置 WebDAV，无法删除收藏。请先填写 WebDAV 地址和账号。', {
        type: 'warn', actionText: '去配置', onAction: openWebdavSettings, duration: 9000,
      });
      return;
    }
    const cfg = getWebdavConfig();
    btn.dataset.fcvBusy = 'true';
    btn.dataset.fcvConfirm = 'false';
    btn.classList.remove('fcv-fav-del--confirm');
    btn.textContent = '删除中';
    logInfo('从收藏列表删除评论', 'commentId=' + commentId);
    removeFavoriteFromWebdav(cfg, favMarker(commentId)).then((r) => {
      unmarkFavLocally(commentId);
      if (r && r.noFile) showToast('远端收藏文件不存在，已清除本机的「已收藏」标记', { type: 'info', duration: 4000 });
      else if (r && r.noComment) showToast('远端文件里已没有这条收藏，列表已刷新', { type: 'info', duration: 4000 });
      else if (r && r.questionDeleted) showToast('已删除这条收藏；该题下已无其它收藏，题目区块一并移除', { type: 'success', duration: 4000 });
      else showToast('已删除这条收藏（该题下还剩 ' + ((r && r.remainingInQuestion) || 0) + ' 条）', { type: 'success', duration: 4000 });
      return reloadFavorites(m);
    }).catch((e) => {
      logError('删除收藏失败', e);
      if (btn.isConnected) {
        btn.dataset.fcvBusy = 'false';
        btn.textContent = btn.dataset.fcvOldText || '删除';
      }
      showToast('删除失败：' + diagFormat(e), { type: 'error', duration: 8000 });
    });
  }

  // ---- 面板内连接测试（复用 testWebdavConnection）----
  function runFavoritesConnectionTest(m) {
    const resultEl = m.favResultEl;
    const showFavResult = (html, type) => {
      if (m.isClose() || !resultEl) return;
      resultEl.hidden = false;
      resultEl.className = 'fcv-fav-result fcv-fav-result--' + (type || 'info');
      resultEl.innerHTML = html;
    };
    const cfg = getWebdavConfig();
    if (!cfg.url || !cfg.username) {
      showFavResult('请先在「WebDAV 设置」里填写服务器地址与账号，再测试连接。', 'warn');
      return Promise.resolve();
    }
    showFavResult('正在连接 ' + escapeHtml(cfg.url) + ' …', 'info');
    return testWebdavConnection(cfg).then((r) => {
      showFavResult('连接成功：HTTP ' + r.status + '，通道 ' + escapeHtml(r.via) +
        (r.dav ? '，DAV: ' + escapeHtml(r.dav) : '') + '。<br>目标文件 ' + escapeHtml(r.filePath) + '：' +
        (r.fileExists
          ? ('已存在，题目区块 ' + r.fileQuestions + ' 个、收藏评论 ' + r.fileCount + ' 条')
          : '不存在（首次收藏时会自动创建）'), 'ok');
    }).catch((e) => {
      showFavResult('连接失败：' + escapeHtml(diagFormat(e)), 'err');
    });
  }

  // ---------------- 油猴菜单 ----------------
  function registerFenbiMenuCommands() {
    try {
      if (typeof GM_registerMenuCommand !== 'function') {
        logInfo('当前环境没有 GM_registerMenuCommand，可用弹窗右上角齿轮或控制台 __fenbiCV.webdav.settings() 打开配置面板');
        return;
      }
      GM_registerMenuCommand('⚙ WebDAV 收藏设置', () => onDomReady(openWebdavSettings));
      GM_registerMenuCommand('⭐ 已收藏评论数', () => {
        const n = getFavIdSet().size;
        const file = getWebdavConfig().filePath || DEFAULT_WEBDAV_FILE;
        showToast('本机记录已收藏 ' + n + ' 条评论（远端文件：' + file + '）', {
          type: 'info', actionText: '打开设置', onAction: () => onDomReady(openWebdavSettings),
        });
      });
      GM_registerMenuCommand('★ 我的收藏', () => onDomReady(openFavoritesPanel));
      GM_registerMenuCommand('🔍 评论功能自检', () => onDomReady(() => openDiagnosticModal('从油猴菜单手动打开')));
      logInfo('已注册油猴菜单命令', 'WebDAV 收藏设置 / 已收藏评论数 / 我的收藏 / 评论功能自检');
    } catch (e) { logWarn('注册油猴菜单命令失败', e); }
  }

  // ============================ 评论弹窗 ============================
  function detectDarkMode() {
    const classes = ['dark', 'dark-mode', 'is-dark', 'theme-night', 'theme-dark', 'night', 'night-mode'];
    const attrs = ['data-theme', 'data-mode', 'data-color-mode', 'data-skin'];
    const roots = [document.documentElement, document.body].filter(Boolean);
    for (const el of roots) {
      if (classes.some((c) => el.classList && el.classList.contains(c))) return true;
      if (attrs.some((a) => (el.getAttribute(a) || '').toLowerCase().indexOf('dark') >= 0 || (el.getAttribute(a) || '').toLowerCase() === 'night')) return true;
    }
    return false;
  }

  function createModal(title) {
    const dark = detectDarkMode();
    const overlay = document.createElement('div');
    overlay.className = 'comment-modal-overlay' + (dark ? ' dark' : '');
    overlay.setAttribute('data-fenbi-theme', dark ? 'dark' : 'light');

    const modal = document.createElement('div');
    modal.className = 'comment-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'comment-modal-header';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'comment-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '关闭评论');
    closeBtn.innerHTML = '&times;';
    // v2.4.0：标题栏新增齿轮按钮，作为 WebDAV 收藏设置的常驻入口（未配置时点「收藏」也会引导到这里）
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'comment-modal-settings';
    settingsBtn.type = 'button';
    settingsBtn.setAttribute('aria-label', 'WebDAV 收藏设置');
    settingsBtn.title = 'WebDAV 收藏设置';
    settingsBtn.textContent = '⚙';
    settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openWebdavSettings();
    });
    const headerActions = document.createElement('div');
    headerActions.className = 'comment-modal-header-actions';
    headerActions.appendChild(settingsBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(h3);
    header.appendChild(headerActions);

    const content = document.createElement('div');
    content.className = 'comment-modal-content';
    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const prevOverflow = document.body.style.overflow || '';
    const cleanups = [];
    let closed = false;

    // 「我的收藏」按钮（评论弹窗内，设置按钮之前）
    const favBtn = document.createElement('button');
    favBtn.className = 'comment-modal-fav';
    favBtn.type = 'button';
    favBtn.title = '我的收藏';
    favBtn.textContent = '★ 我的收藏';
    favBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onDomReady(openFavoritesPanel);
    });
    headerActions.insertBefore(favBtn, settingsBtn);

    function close() {
      if (closed) return;
      closed = true;
      cleanups.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
      modal.classList.remove('open');
      overlay.classList.remove('active');
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeydown, true);
      setTimeout(() => overlay.remove(), 300);
    }
    function onKeydown(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // v2.4.0：WebDAV 设置面板打开时，Esc 只关设置面板，不连带关掉评论弹窗
      if (isWebdavSettingsOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKeydown, true);

    // 进入动画
    modal.classList.add('center');
    void modal.offsetHeight;
    requestAnimationFrame(() => {
      modal.classList.add('open');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    });

    return {
      overlay: overlay,
      modal: modal,
      content: content,
      closed: false,
      isClose: () => closed,
      close: close,
      registerCleanup: (fn) => { if (closed) { fn(); return; } cleanups.push(fn); },
      currentStart: 0,
      currentId: undefined,
      isLoading: false,
      hasMore: true,
      lastDataCount: undefined,
    };
  }

  function showModalMessage(m, html) {
    if (m.isClose()) return;
    m.content.innerHTML = '<div class="loading-wrapper">' + html + '</div>';
  }

  function displayComments(json, m) {
    if (m.isClose()) return;
    const parsed = parseCommentResponse(json);
    if (!parsed || parsed.datas.length === 0) {
      if (m.currentStart === 0) {
        showModalMessage(m, '<div style="font-size:40px;margin-bottom:10px;">📭</div><div>还没有人发表评论哦</div>');
      } else {
        m.hasMore = false;
      }
      return;
    }

    let container = m.content.querySelector('.comments-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'comments-container';
      m.content.innerHTML = '';
      m.content.appendChild(container);
    }
    // 移除"更多评论正在路上"提示
    m.content.querySelectorAll('.loading-more').forEach((el) => el.remove());

    // v2.5.0：收藏上下文（聚合键 + 题目标题 / 题干 / 选项），每题解析一次后复用
    const qIdxRaw = m.modal && m.modal.dataset ? m.modal.dataset.fenbiQuestionIndex : undefined;
    const qIdx = Number(qIdxRaw);
    const hasQIdx = Number.isFinite(qIdx) && qIdx >= 0;
    let questionCtx = null;
    const buildQuestionCtx = () => {
      if (questionCtx) return questionCtx;
      if (!hasQIdx) {
        questionCtx = { label: '', questionId: '', episodeId: null, card: null, stem: '', choices: [] };
        return questionCtx;
      }
      const card = resolveQuestionCard(qIdx);
      const meta = extractQuestionMetaFromCard(card);
      questionCtx = {
        label: '第 ' + (qIdx + 1) + ' 题',
        questionId: buildQuestionId(qIdx, m.currentId),
        episodeId: m.currentId,
        card: card,
        stem: meta.stem,
        choices: meta.choices,
      };
      return questionCtx;
    };

    const box = document.createElement('div');
    parsed.datas.forEach((raw, idx) => {
      const c = normalizeComment(raw);
      // 每批评论渲染时复用同一份题目上下文（题干 / 选项只取一次，避免逐条重取）
      const ctx = buildQuestionCtx();
      ctx.episodeId = m.currentId;
      const item = document.createElement('div');
      item.className = 'comment-item';
      const likeHtml = renderLikeIcon(c.liked);
      item.innerHTML =
        '<div class="comment-user-info">' +
          '<img class="comment-avatar" src="' + escapeHtml(c.avatar) + '" alt="">' +
          '<div class="comment-meta">' +
            '<div class="comment-nickname">' + escapeHtml(c.nickname) + '</div>' +
            '<div class="comment-sub-meta">' +
              renderStars(c.rating) +
              '<span class="comment-time">' + escapeHtml(formatTime(c.createdTime)) + '</span>' +
              (c.province ? '<span class="comment-province">· ' + escapeHtml(c.province) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="comment-text">' + escapeHtml(c.content) + '</div>' +
        '<div class="comment-footer">' +
          '<div class="comment-actions">' +
            // v2.4.0：每条评论的「复制」/「收藏」按钮（状态与事件在下方绑定）
            '<span class="fcv-comment-act fcv-copy-act" role="button" tabindex="0" title="复制这条评论的正文">复制</span>' +
            '<span class="fcv-comment-act fcv-fav-act" role="button" tabindex="0">收藏</span>' +
            '<div class="like-count-wrapper' + (c.liked ? ' liked' : '') + '"' + (c.id === null ? '' : ' data-id="' + escapeHtml(c.id) + '"') + '>' +
              '<span class="like-icon-container">' + likeHtml + '</span>' +
              '<span class="like-count">' + c.likeCount + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      const likeWrapper = item.querySelector('.like-count-wrapper');
      if (likeWrapper && c.id !== null) {
        likeWrapper.addEventListener('click', () => toggleLike(c.id, likeWrapper));
      }
      // v2.4.0：评论级「复制」/「收藏」事件；已收藏的评论渲染时即带「已收藏」标记，阻止重复收藏
      const copyAct = item.querySelector('.fcv-copy-act');
      if (copyAct) {
        const onCopy = (ev) => { if (ev) ev.stopPropagation(); handleCopyComment(c, copyAct); };
        copyAct.addEventListener('click', onCopy);
        copyAct.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onCopy(ev); }
        });
      }
      const favAct = item.querySelector('.fcv-fav-act');
      if (favAct) {
        setFavButtonState(favAct, isFavLocally(c.id) ? 'favorited' : 'normal', c);
        const onFav = (ev) => { if (ev) ev.stopPropagation(); handleFavoriteComment(c, favAct, ctx); };
        favAct.addEventListener('click', onFav);
        favAct.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onFav(ev); }
        });
      }
      box.appendChild(item);
    });
    container.appendChild(box);

    m.hasMore = parsed.datas.length > 0;
    m.lastDataCount = parsed.datas.length;
  }

  function fetchComments(episodeId, start, m) {
    start = Math.max(0, Number(start) || 0);
    if (m.isClose()) return;
    if (m.isLoading || m.pendingCommentStart === start) return;

    let container = m.content.querySelector('.comments-container');
    if (start === 0) {
      showModalMessage(m, '<div class="loading-spinner"></div><div>正在寻找这道题的评论...</div>');
      m.hasMore = false;
      m.lastDataCount = undefined;
    } else if (container) {
      if (!container.querySelector('.loading-more')) {
        const tip = document.createElement('div');
        tip.className = 'loading-more';
        tip.textContent = '更多评论正在路上...';
        container.appendChild(tip);
      }
    }
    m.currentId = episodeId;
    m.currentStart = start;
    m.isLoading = true;
    m.pendingCommentStart = start;

    fetchCommentsJson(episodeId, start).then((json) => {
      if (m.isClose()) return;
      m.isLoading = false;
      m.pendingCommentStart = null;
      displayComments(json, m);
      if (!hasCommentsInResponse(json) && start > 0) m.hasMore = false;
    }).catch((e) => {
      if (m.isClose()) return;
      m.isLoading = false;
      m.pendingCommentStart = null;
      m.content.querySelectorAll('.loading-more').forEach((el) => el.remove());
      if (start === 0) {
        showModalMessage(m, '<div style="font-size:40px;margin-bottom:10px;">😕</div><div>加载评论失败了，请稍后再试</div>');
      } else {
        m.hasMore = false;
      }
      logError('请求或解析评论数据失败', e);
    });
  }

  function bindScrollLoad(m, episodeId) {
    m.content.addEventListener('scroll', () => {
      const c = m.content;
      if (c.scrollTop + c.clientHeight < c.scrollHeight - 50) return;
      if (!m.hasMore || m.isLoading || m.currentId === undefined) return;
      const nextStart = m.currentStart + (m.lastDataCount || 10);
      fetchComments(m.currentId, nextStart, m);
    }, true);
  }

  // 兜底：用题号主动请求 episode 映射接口。
  // 请求示例：
  //   https://ke.fenbi.com/api/gwy/v3/episodes/tiku_episodes_with_multi_type
  //     ?tiku_ids={solutionId}&tiku_prefix={route.tikuPrefix}&tiku_type=5
  // 注意：必须保留 /api 段；tiku_type 需与 tiku_prefix 配对（测试：sydw<->5 可用，gwy+5 报 "tiku_prefix 错误"）。
  function buildEpisodeMappingUrls(solutionId) {
    const prefixes = [];
    [parseProfileRoute(), state.currentTikuPrefix, 'sydw', 'gwy'].forEach((p) => {
      if (p && prefixes.indexOf(p) === -1) prefixes.push(p);
    });
    const urls = [];
    const types = EPISODE_TIKU_TYPES.slice(0, 3);
    for (const type of types) {
      for (const p of prefixes) {
        const params = new URLSearchParams({
          tiku_ids: String(solutionId),
          tiku_prefix: p,
          tiku_type: String(type),
        });
        const u = 'https://ke.fenbi.com/api/gwy/v3/episodes/tiku_episodes_with_multi_type?' + params.toString();
        if (urls.indexOf(u) === -1) urls.push(u);
      }
    }
    return urls;
  }

  function resolveEpisodeIdForQuestion(index) {
    if (state.episodeIds && state.episodeIds[index] != null) {
      logInfo('命中已有映射', 'index=' + index, 'episodeId=' + state.episodeIds[index]);
      return Promise.resolve(state.episodeIds[index]);
    }
    const solutionId = state.solutionIds[index];
    if (solutionId == null) {
      logWarn('题号缺失，无法兜底解析', 'index=' + index,
        '当前 solutionIds 共 ' + state.solutionIds.length + ' 个');
      return Promise.resolve(null);
    }

    const urls = buildEpisodeMappingUrls(solutionId);
    logInfo('启动兜底映射解析', '题号=' + solutionId, '候选接口 ' + urls.length + ' 个');
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) {
        logWarn('所有映射候选接口均未取到 episodeId', '题号=' + solutionId, '已尝试 ' + urls.length + ' 个');
        return Promise.resolve(null);
      }
      const url = urls[i++];
      logInfo('发起映射请求', '[' + i + '/' + urls.length + ']', shortenUrl(url));
      return fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json, text/plain, */*' },
      })
        .then((r) => r.json())
        .then((json) => {
          if (!isObj(json) || Number(json.code) !== 1) {
            logWarn('映射请求返回不可用', 'code=' + (isObj(json) ? json.code : '?'),
              'msg=' + (isObj(json) ? json.msg : ''), shortenUrl(url));
            return tryNext();
          }
          const data = isObj(json.data) ? json.data : json;
          mergeEpisodeData(data);
          const bucket = data[solutionId] || data[String(solutionId)];
          if (!isObj(bucket) || Object.keys(bucket).length === 0) {
            logWarn('映射响应中没有该题号的桶', '题号=' + solutionId, shortenUrl(url));
            return tryNext();
          }
          updateEpisodeIdsAndButtons();
          return getEpisodeIdForSolution(solutionId) || tryNext();
        })
        .catch((e) => {
          logWarn('episode 映射候选接口失败', url, e);
          return tryNext();
        });
    };
    return tryNext();
  }

  async function openCommentsForQuestion(index) {
    logInfo('点击查看评论', 'index=' + index,
      'solutionId=' + (state.solutionIds[index] == null ? 'null' : state.solutionIds[index]),
      'episodeId=' + (state.episodeIds && state.episodeIds[index] != null ? state.episodeIds[index] : 'null'));
    const m = createModal('精选评论');
    m.modal.dataset.fenbiQuestionIndex = String(index);
    showModalMessage(m, '<div class="loading-spinner"></div><div>正在寻找这道题的评论...</div>');
    let episodeId = null;
    let failure = null;
    try {
      episodeId = await resolveEpisodeIdForQuestion(index);
    } catch (e) {
      failure = e;
    }
    if (m.isClose()) return;
    if (failure || episodeId == null) {
      // v1.2.0：映射缺失不再只给一句"没找到"，而是弹出完整诊断（中间态 + 请求列表 + 日志）
      const reason = failure
        ? ('解析过程抛出异常：' + (failure.message || failure))
        : (state.solutionIds[index] == null
          ? ('按钮序号 ' + index + ' 在已捕获的题号列表中不存在（solutionIds 共 ' + state.solutionIds.length + ' 个，可能未拦截到题目列表或序号错位）')
          : ('题号 ' + state.solutionIds[index] + ' 未取到评论集 episodeId（映射接口未返回可用数据）'));
      logWarn('映射缺失，弹出诊断面板', reason);
      showDiagnosticPanel(m, reason, index);
      return;
    }
    logInfo('映射成功', 'index=' + index, 'episodeId=' + episodeId);
    bindScrollLoad(m, episodeId);
    fetchComments(episodeId, 0, m);
  }

  // 在评论弹窗内渲染自检面板：中间态表格 + 请求列表 + 关键日志 + 复制/重试
  function showDiagnosticPanel(m, reason, index) {
    if (m.isClose()) return;
    const d = collectDiagnostics();
    const rows = Object.keys(d).map((k) =>
      '<tr><th>' + escapeHtml(k) + '</th><td>' + escapeHtml(diagFormat(d[k])) + '</td></tr>').join('');
    const xhrList = diag.xhrSeen.length
      ? diag.xhrSeen.slice(-12).reverse().map((x) =>
        '<li>' + (x.matched.length ? '<b>[命中 ' + escapeHtml(x.matched.join(',')) + ']</b> ' : '') +
        escapeHtml(x.method + ' ' + x.url) + '</li>').join('')
      : '<li>未捕获到任何非静态请求（脚本可能在页面请求之后才注入）</li>';
    const logList = diag.logs.slice(-18).map((l) =>
      '<li>[' + escapeHtml(l.at) + '] ' + escapeHtml(l.text) + '</li>').join('') || '<li>暂无日志</li>';
    m.content.innerHTML =
      '<div class="fcv-report">' +
        '<div class="fcv-report-reason"><b>评论集映射未建立：</b>' + escapeHtml(reason) + '</div>' +
        '<div class="fcv-report-sec">当前中间态</div>' +
        '<table class="fcv-report-table">' + rows + '</table>' +
        '<div class="fcv-report-sec">页面已发出的请求（最近 12 条）</div>' +
        '<ul class="fcv-report-list">' + xhrList + '</ul>' +
        '<div class="fcv-report-sec">关键日志（最近 18 条）</div>' +
        '<ul class="fcv-report-list">' + logList + '</ul>' +
        '<div class="fcv-report-actions">' +
          '<button type="button" class="fcv-report-btn fcv-report-copy">复制完整诊断信息</button>' +
          '<button type="button" class="fcv-report-btn fcv-report-retry">重试解析</button>' +
        '</div>' +
        '<div class="fcv-report-tip">把「复制」得到的文本发给助手即可定位；也可在控制台执行 __fenbiCV.dump()。</div>' +
      '</div>';
    const copyBtn = m.content.querySelector('.fcv-report-copy');
    if (copyBtn) copyBtn.addEventListener('click', copyDiagnostics);
    const retryBtn = m.content.querySelector('.fcv-report-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => retryMapping(index, m));
  }

  // 用户在诊断面板点「重试解析」
  async function retryMapping(index, m) {
    if (m.isClose()) return;
    showModalMessage(m, '<div class="loading-spinner"></div><div>正在重新解析评论集映射...</div>');
    logInfo('用户触发重试解析', 'index=' + index);
    let episodeId = null;
    try { episodeId = await resolveEpisodeIdForQuestion(index); }
    catch (e) { logWarn('重试解析异常', e && e.message ? e.message : String(e)); }
    if (m.isClose()) return;
    if (episodeId == null) { showDiagnosticPanel(m, '重试后仍未取到 episodeId', index); return; }
    bindScrollLoad(m, episodeId);
    fetchComments(episodeId, 0, m);
  }

  // ============================ 按钮注入 ============================
  function isProfileRoute() {
    return /\/spa\/tiku\/(?:profile|report|wrong|collect|note)/.test(location.pathname) ||
      !!document.querySelector('fb-local-question, fb-recitatation-question');
  }

  // v1.5.0：为题卡分配稳定 uid，用于在外层容器（可能被多个题卡共享）中唯一定位按钮
  const cardUids = new WeakMap();
  let cardUidSeq = 0;
  function getCardUid(card) {
    let uid = cardUids.get(card);
    if (!uid) { uid = 'fcv-card-' + (++cardUidSeq); cardUids.set(card, uid); }
    return uid;
  }

  // v2.8.2：按钮挂载点 —— 题组内的小题锚点（app-ti）向上提升到题组容器（.ti 的父节点，
  // 即 .tis-container），与旧版「以 .ti 为锚点」时的挂载点保持一致，
  // 避免按钮落进更深的题目列表容器后被中间层级的 overflow 裁切。
  function resolveMountOuter(card) {
    if (!card) return card;
    const isAppTi = card.tagName && card.tagName.toLowerCase() === 'app-ti';
    if (isAppTi && card.closest) {
      const ti = card.closest('.ti');
      if (ti && ti.parentElement) return ti.parentElement;
    }
    return card.parentElement || card;
  }

  function createQuestionCommentButton(card, index) {
    // v1.3.0 策略（恢复注入门槛，覆盖 v1.2.0 的「识别到锚点即注入」）：
    // 仅当该题已取到 episodeId（即该题存在解析视频）时才注入按钮；未取到映射的题不注入。
    // 背题页(/ti/memorize/)首屏在映射响应到达前可能暂无按钮，映射合并落地后由
    // updateEpisodeIdsAndButtons → syncCommentButtons 统一补注；自检浮标与诊断日志保留。
    const episodeId = state.episodeIds && state.episodeIds[index] != null ? state.episodeIds[index] : null;
    if (episodeId == null) return null;
    // v1.5.0：按钮挂到题卡的外层容器，按题卡 uid 查找，避免共享容器内串号
    // v2.8.2：挂载点统一由 resolveMountOuter 决定（题组小题上提到 .tis-container）
    const outer = resolveMountOuter(card);
    const uid = getCardUid(card);
    // v2.2.0：盒子内挂载的按钮会被搬进「题干 + 选项盒子」，该盒子可能是页面级元素（不在题卡子树内），
    // 故查找范围由「外层容器」扩展为「外层容器优先 + 整篇文档兜底」，避免找不到已有按钮而重复创建。
    const uidSelector = '.' + COMMENT_BTN_CLASS + '[data-fenbi-card-uid="' + uid + '"]';
    let btn = outer.querySelector(uidSelector) || document.querySelector(uidSelector);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = COMMENT_BTN_CLASS;
      btn.dataset.fenbiHelperComments = SCRIPT_VERSION;
      btn.dataset.fenbiCardUid = uid;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openCommentsForQuestion(index);
      });
    }
    const solutionId = state.solutionIds[index];
    btn.dataset.fenbiIndex = String(index);
    btn.dataset.fenbiSolutionId = solutionId == null ? '' : String(solutionId);
    btn.dataset.fenbiEpisodeId = episodeId == null ? '' : String(episodeId);
    btn.classList.toggle('view-comments-btn--pending', episodeId == null);
    btn.title = episodeId != null
      ? ('题号 ' + solutionId + ' → 评论集 ' + episodeId)
      : ('尚未取到该题的评论集映射（题号 ' + (solutionId == null ? '未知' : solutionId) + '），点击查看诊断');
    return btn;
  }

  // v1.7.0：在题卡内查找右下角「退出」按钮，作为评论按钮的定位锚点
  // （定位与兜底策略的调用入口见下方 alignExternalButton）。
  // 匹配依据：元素可见文本 / title / aria-label 含「退出」（兼容英文 exit / quit），
  // 并兼顾 exit / quit / close / back 等常见类名；命中多个时取最靠右下角者（题卡右下角悬浮按钮优先）。
  // 找不到时返回 null，由调用方回退到 v1.6.0 的左外侧定位——不报错、不隐藏按钮。
  // 从命中元素向上回溯到真正可点击的盒子（button / a / [role=button]），
  // 避免拿图标或文字子节点当定位基准导致偏移。
  function toClickableBox(el, card) {
    let cur = el;
    while (cur && cur !== card) {
      const tag = cur.tagName ? cur.tagName.toLowerCase() : '';
      if (tag === 'button' || tag === 'a' || cur.getAttribute('role') === 'button') return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  function findExitAnchor(card, ownBtn) {
    if (!card || !card.querySelectorAll) return null;
    const cardRect = card.getBoundingClientRect();
    const cardArea = Math.max(1, cardRect.width * cardRect.height);
    const cands = card.querySelectorAll(EXIT_CANDIDATE_SELECTOR);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < cands.length; i++) {
      const el = cands[i];
      // 跳过评论按钮自身（含其子节点），避免自我锚定
      if (ownBtn && (el === ownBtn || (ownBtn.contains && ownBtn.contains(el)))) continue;
      if (el.closest && el.closest('.' + COMMENT_BTN_CLASS)) continue;
      // 文本判定：优先取直接文本节点（廉价），仅在无直接文本且子元素较少时回退整体 textContent
      // （覆盖「退」「出」被拆进多个 span 的情况）；长度上限 12 字，避免把题干 / 正文误判为按钮。
      let textLabel = '';
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) textLabel += n.nodeValue;
      }
      textLabel = textLabel.trim();
      if (!textLabel && el.childElementCount && el.childElementCount <= 8) {
        textLabel = (el.textContent || '').trim();
      }
      const textHit = textLabel.length > 0 && textLabel.length <= 12 && EXIT_TEXT_RE.test(textLabel);
      const attrLabel = ((el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
      const attrHit = attrLabel.length > 0 && attrLabel.length <= 24 && EXIT_TEXT_RE.test(attrLabel);
      const cls = typeof el.className === 'string' ? el.className : '';
      const clsHit = EXIT_CLASS_RE.test(cls);
      if (!textHit && !attrHit && !clsHit) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) continue; // 不可见 / 未布局（display:none 等）
      if (rect.width * rect.height > cardArea * 0.5) continue; // 容器级元素不作为锚点
      // 评分：文本 / 标签命中优先于纯类名命中；同权重下取更靠右下角者
      const score = (textHit ? 1000000 : (attrHit ? 100000 : 0)) + rect.right + rect.bottom;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best ? toClickableBox(best, card) : null;
  }

  // v1.8.0：在给定作用域内按选择器优先级找出第一个「可见」的候选元素（宽或高为 0 视为不可见）。
  // 返回 { el, rect }；找不到返回 null。rect 复用给后续定位计算，避免重复触发重排。
  function queryFirstVisibleBox(scope, selectors) {
    if (!scope) return null;
    for (let i = 0; i < selectors.length; i++) {
      let list;
      try {
        list = scope.querySelectorAll(selectors[i]);
      } catch (e) { continue; }
      for (let j = 0; j < list.length; j++) {
        const el = list[j];
        const rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) continue; // 不可见 / 未布局（display:none 等）
        return { el: el, rect: rect };
      }
    }
    return null;
  }

  // v2.1.0：定位「题干 + 选项盒子」——外层 <app-question-choice> / 其内 <div class="question-choice-container">
  //（优先级见 CHOICE_BOX_SELECTORS：.question-choice-container → app-question-choice）。
  // 查找顺序：① 题卡内命中（正常情况：盒子就在题卡里）；② 题卡内没有时退到页面范围，
  // 但要求该盒子与本题卡位置相关（与题卡纵向有交集、或相距在 DRAFT_BOX_CARD_TOLERANCE_PX 内），
  // 避免把别题的盒子当成自己的锚点；不可见（宽高为 0）的候选一律跳过。
  // 再做「一盒子一按钮」去重：同一盒子已被别的按钮锚定时本次放弃（走兜底链），防止按钮重叠。
  function findChoiceBoxAnchor(card, ownBtn) {
    let hit = queryFirstVisibleBox(card, CHOICE_BOX_SELECTORS);
    if (!hit) {
      for (let i = 0; i < CHOICE_BOX_SELECTORS.length && !hit; i++) {
        let list;
        try {
          list = document.querySelectorAll(CHOICE_BOX_SELECTORS[i]);
        } catch (e) { continue; }
        for (let j = 0; j < list.length; j++) {
          const el = list[j];
          const rect = el.getBoundingClientRect();
          if (!rect.width && !rect.height) continue;
          if (card) {
            const cRect = card.getBoundingClientRect();
            const near = rect.bottom >= cRect.top - DRAFT_BOX_CARD_TOLERANCE_PX &&
              rect.top <= cRect.bottom + DRAFT_BOX_CARD_TOLERANCE_PX;
            if (!near) continue;
          }
          hit = { el: el, rect: rect };
          break;
        }
      }
    }
    if (!hit) return null;
    const peers = document.querySelectorAll('.' + COMMENT_BTN_CLASS + '--external');
    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i];
      if (peer !== ownBtn && peer._fcvChoiceBox === hit.el && peer.isConnected) return null;
    }
    return hit;
  }

  // v1.8.0：定位「题干 + 选项整体盒子」——canvas#draft.pen（优先级见 DRAFT_BOX_SELECTORS）。
  // 查找顺序：① 题卡内命中；② 题卡内没有时退到页面范围，但要求该画布与本题卡位置相关
  //（与题卡纵向有交集、或相距在 DRAFT_BOX_CARD_TOLERANCE_PX 内），
  // 避免把其它题目 / 其它区域的画布当成自己的锚点；不可见候选一律跳过。
  // 再做「一画布一按钮」去重：同一画布已被别的按钮锚定时本次放弃（走兜底链），防止按钮重叠。
  function findDraftBoxAnchor(card, ownBtn) {
    let hit = queryFirstVisibleBox(card, DRAFT_BOX_SELECTORS);
    if (!hit) {
      for (let i = 0; i < DRAFT_BOX_SELECTORS.length && !hit; i++) {
        let list;
        try {
          list = document.querySelectorAll(DRAFT_BOX_SELECTORS[i]);
        } catch (e) { continue; }
        for (let j = 0; j < list.length; j++) {
          const el = list[j];
          const rect = el.getBoundingClientRect();
          if (!rect.width && !rect.height) continue;
          if (card) {
            const cRect = card.getBoundingClientRect();
            const near = rect.bottom >= cRect.top - DRAFT_BOX_CARD_TOLERANCE_PX &&
              rect.top <= cRect.bottom + DRAFT_BOX_CARD_TOLERANCE_PX;
            if (!near) continue;
          }
          hit = { el: el, rect: rect };
          break;
        }
      }
    }
    if (!hit) return null;
    const peers = document.querySelectorAll('.' + COMMENT_BTN_CLASS + '--external');
    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i];
      if (peer !== ownBtn && peer._fcvDraftBox === hit.el && peer.isConnected) return null;
    }
    return hit;
  }

  // ====================== v2.3.0：盒子外挂载 + 实时重算动态跟随（rAF 节流） ======================
  // 背景：v2.2.0 曾把按钮挂成「题干 + 选项盒子」的子元素、用 CSS calc(100% + 变量) 自动跟随；
  // 但按钮落进盒子内部会污染盒子自身布局（还要临时改盒子的 position、放开祖先 overflow），
  // 与「按钮落在题卡外部」的既有设计不符。
  // v2.3.0 纠正为：按钮**挂回盒子外部**（题卡外层容器 .fcv-question-mount），
  // 落点仍是「按钮左下角 == 盒子右下角」，由 JS 实时重算 left/top 来保证动态跟随：
  //   left = box.right  − container.left (+ container 滚动量)
  //   top  = box.bottom − container.top  (+ container 滚动量) − 按钮高(56)
  // 本分支不叠加任何 nudge 位移增量、也不做贴边夹取，保证两点严格重合。

  // v2.6.1：按钮往右 0.5cm、往下 1cm（仅对「按钮左下角 == 盒子右下角」首选分支生效，
  // 历史 v2.0.x 分支不叠加，避免历史分支被误加偏移）。
  // v2.6.3：把该分支的下移量由 1cm 收紧为 0.3cm —— 按钮相对盒子右下角整体上抬 0.7cm
  //   （下移常量 38px → 11px）；右移 0.5cm(19px)、锚点优先级、防遮挡逻辑、z-index
  //   与其余参数一律不变。
  // v2.6.2 修复（「按钮消失」根因）：原写法为 `Math.round(0.5 * cmPerInch * 2.54)`，
  //   ① 引用了脚本中并不存在的变量 cmPerInch（应为统一换算口径 PX_PER_CM）；
  //   ② 常量名 NUDGE_RIGHT_PX 与上方 v1.9.0 的顶层同名常量重复声明。
  //   ② 会让整份脚本在解析阶段直接报 SyntaxError（Identifier has already been declared），
  //   ① 会让脚本在 IIFE 初始化阶段抛 ReferenceError —— 两种都会导致脚本整体不执行、
  //   按钮完全不注入，也就是「查看评论按钮从页面消失」现象。
  //   现改用独立常量名 + 统一口径 PX_PER_CM（px = cm × 96 ÷ 2.54）：
  //   0.5cm ≈ 19px；下移量 v2.6.1 为 1.0cm ≈ 38px，v2.6.3 起为 0.3cm ≈ 11px。
  const CHOICE_BOX_NUDGE_RIGHT_PX = Math.round(0.5 * PX_PER_CM);   // 0.5cm ≈ 19px
  const CHOICE_BOX_NUDGE_DOWN_PX  = Math.round(0.3 * PX_PER_CM);   // 0.3cm ≈ 11px

  // v2.3.0：纯数学换算（不碰 DOM）——把「按钮左下角 == 盒子右下角」写成可离线单测的不变量。
  // v2.6.1→v2.6.3：在该基准点上再叠加右移 0.5cm、下移 0.3cm 的微调量（见上方常量）。
  function computeChoiceBoxLeftTop(boxRect, outerRect, scrollLeft, scrollTop, btnH) {
    const h = btnH || EXTERNAL_BTN_SIZE_PX;
    return {
      left: Math.round(boxRect.right - outerRect.left + (scrollLeft || 0)) + CHOICE_BOX_NUDGE_RIGHT_PX,
      top: Math.round(boxRect.bottom - outerRect.top + (scrollTop || 0) - h) + CHOICE_BOX_NUDGE_DOWN_PX,
    };
  }

  // v2.6.2：按钮矩形与题卡内「退出」按钮矩形的**防遮挡**（纯数学、不碰 DOM，便于离线单测）。
  // 背景：首选分支把按钮钉在「题干 + 选项盒子」右下角，题卡内的「退出」按钮也常悬浮在
  // 题卡右下角，二者矩形可能相交 —— 相交时既不能盖住「退出」按钮、也不能被它盖住。
  // 策略（按序尝试，取第一个可用结果）：
  //   ① 原位不重叠 → 原样返回；
  //   ② 让到「退出」按钮**正下方**（间隔 EXIT_ANCHOR_GAP_PX）；
  //   ③ 正下方会把按钮顶出可视区下沿（limitBottom，调用方传视口高）→ 改为让到其**正右侧**。
  // 入参 / 返回值同为「相对外层容器」的 left、top（与 computeChoiceBoxLeftTop 同一坐标系），
  // exitRect 为「退出」按钮的 getBoundingClientRect()（视口坐标）。
  function resolveExitOverlap(pos, btnW, btnH, outerRect, scrollLeft, scrollTop, exitRect, limitBottom) {
    const sl = scrollLeft || 0;
    const st = scrollTop || 0;
    const ox = outerRect.left || 0;
    const oy = outerRect.top || 0;
    const vpLeft = pos.left + ox - sl;
    const vpTop = pos.top + oy - st;
    const hit = (l, t) => l < exitRect.right && l + btnW > exitRect.left &&
      t < exitRect.bottom && t + btnH > exitRect.top;
    if (!hit(vpLeft, vpTop)) return { left: pos.left, top: pos.top, moved: '' };
    // ② 让到「退出」按钮正下方（正下方必然纵向不相交，落点与「退出」按钮底边间隔固定 gap）
    const belowTop = exitRect.bottom + EXIT_ANCHOR_GAP_PX;
    const bottomLimit = (limitBottom == null || !isFinite(limitBottom)) ? Infinity : limitBottom;
    if (belowTop + btnH <= bottomLimit) {
      return { left: pos.left, top: Math.round(belowTop - oy + st), moved: 'below' };
    }
    // ③ 正下方会顶出可视区 → 让到「退出」按钮正右侧
    const rightLeft = exitRect.right + EXIT_ANCHOR_GAP_PX;
    return { left: Math.round(rightLeft - ox + sl), top: pos.top, moved: 'right' };
  }

  // v2.6.2：「退出」按钮锚点的**带缓存查找** —— realignFollowedButton 会随滚动 / 尺寸变化
  // 每帧重算，不能每帧都全卡扫一遍候选元素；命中结果按按钮缓存，元素脱离文档时才重扫。
  // 未命中同样缓存 1s：既避开「退出」按钮尚未渲染时的连续重扫，又能在它稍后出现时重新命中。
  const EXIT_ANCHOR_MISS_TTL_MS = 1000;
  function getExitAnchorFor(card, btn, now) {
    if (!card || !btn) return null;
    const cached = btn._fcvExitEl;
    if (cached && cached.isConnected && (!card.contains || card.contains(cached))) return cached;
    const t = now == null ? Date.now() : now;
    // 未命中记录用 -1 表示「无未命中记录」；否则同一毫秒内（t 可能为 0）会绕过 TTL 判定
    if (!cached && btn._fcvExitMissAt >= 0 && (t - btn._fcvExitMissAt) < EXIT_ANCHOR_MISS_TTL_MS) return null;
    const found = findExitAnchor(card, btn);
    btn._fcvExitEl = found || null;
    btn._fcvExitMissAt = found ? -1 : t;
    return btn._fcvExitEl;
  }

  // v2.6.2：把「防遮挡」套用到一组已算好的坐标上（含「退出」按钮不可见 / 不存在时的直通）。
  // 返回最终写回用的 left/top；命中避让时顺带把 mode 标记成 xxx+exit-avoid，便于排查。
  function applyExitOverlapGuard(btn, card, outer, outerRect, left, top, btnW, btnH) {
    const exitEl = getExitAnchorFor(card, btn);
    if (!exitEl) return { left: left, top: top, avoided: false };
    let eRect;
    try { eRect = exitEl.getBoundingClientRect(); } catch (e) { return { left: left, top: top, avoided: false }; }
    if (!eRect.width && !eRect.height) return { left: left, top: top, avoided: false };
    // limitBottom 取视口高：让位后若落到首屏之外（看不见）就改用「右侧」方案
    const limitBottom = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : Infinity;
    const fixed = resolveExitOverlap({ left: left, top: top }, btnW, btnH, outerRect,
      outer.scrollLeft, outer.scrollTop, eRect, limitBottom);
    return { left: fixed.left, top: fixed.top, avoided: !!fixed.moved };
  }

  // v2.3.0：写回坐标 —— 与上次写入值相同则跳过。既省去无谓的样式写入，
  // 也切断「写 left/top → MutationObserver 触发 → 再重算」的自触发回环。
  function writeButtonPosition(btn, left, top) {
    if (btn._fcvLastLeft === left && btn._fcvLastTop === top) return false;
    btn.style.setProperty('left', left + 'px');
    btn.style.setProperty('top', top + 'px');
    btn._fcvLastLeft = left;
    btn._fcvLastTop = top;
    return true;
  }

  let followResizeObserver = null;
  let followMutationObserver = null;
  let followObserversBound = false;
  let followRafHandle = null;
  const observedChoiceBoxes = new Set();

  // v2.3.0：rAF 节流调度 —— ResizeObserver / 捕获阶段 scroll / MutationObserver / window resize
  // 四路信号都走这里：同一帧内的多次触发合并为一次重算（无 requestAnimationFrame 时退化为 16ms 定时器）。
  function scheduleFollowRealign() {
    if (followRafHandle !== null) return; // 已排期，合帧
    if (typeof requestAnimationFrame === 'function') {
      followRafHandle = requestAnimationFrame(() => {
        followRafHandle = null;
        realignAllExternalButtons();
      });
    } else {
      followRafHandle = setTimeout(() => {
        followRafHandle = null;
        realignAllExternalButtons();
      }, FOLLOW_RAF_FALLBACK_MS);
    }
  }

  // v2.3.0：把锚点盒子纳入 ResizeObserver —— 题干/选项重排、字体或图片加载、解析展开等
  // 盒子自身尺寸变化都会触发重算（上限 FOLLOW_MAX_BOXES，防页面极端情况下观察集合失控）。
  function observeChoiceBox(boxEl) {
    if (!boxEl || !followResizeObserver) return;
    if (observedChoiceBoxes.has(boxEl)) return;
    if (observedChoiceBoxes.size >= FOLLOW_MAX_BOXES) return;
    try {
      followResizeObserver.observe(boxEl);
      observedChoiceBoxes.add(boxEl);
    } catch (e) { /* 单个盒子观察失败不影响其它 */ }
  }

  // v2.3.0：清理已脱离文档的锚点盒子，避免观察集合无限增长
  function pruneObservedChoiceBoxes() {
    if (!observedChoiceBoxes.size) return;
    observedChoiceBoxes.forEach((el) => {
      if (el && el.isConnected) return;
      try { if (followResizeObserver) followResizeObserver.unobserve(el); } catch (e) { /* 忽略 */ }
      observedChoiceBoxes.delete(el);
    });
  }

  function onFollowScroll() { scheduleFollowRealign(); }
  function onFollowWindowResize() { scheduleFollowRealign(); }

  // v2.3.0：MutationObserver 自触发过滤 —— 跳过脚本自己造成的变动
  // （按钮自身的 class / 脚本打的挂载类与 data-* 标记），其余一律排期重算。
  function mutationTouchesLayout(records) {
    if (!records || !records.length) return false;
    for (let i = 0; i < records.length; i += 1) {
      const t = records[i] && records[i].target;
      if (!t || t.nodeType !== 1) continue;
      if (t.classList && (t.classList.contains(COMMENT_BTN_CLASS) ||
          t.classList.contains(QUESTION_MOUNT_CLASS))) continue;
      if (t.getAttribute && (t.getAttribute('data-fcv-anchor') || t.getAttribute('data-fcv-pos'))) continue;
      return true;
    }
    return false;
  }

  // v2.3.0：注册全局跟随观察器（幂等，只挂一次）
  //   ① 捕获阶段 scroll：滚动事件不冒泡，捕获阶段才能同时收到 window 与任意内部滚动容器；
  //   ② window resize：沿用 v2.1.0「尺寸变化即重算」的行为；
  //   ③ ResizeObserver：观察文档根 + 文档体 + 各命中锚点盒子（盒子尺寸变化 = 内容重排）；
  //   ④ MutationObserver：class/style 与 DOM 结构变动（切换题目、展开解析、重新渲染）。
  function ensureFollowObservers() {
    pruneObservedChoiceBoxes();
    if (followObserversBound) return;
    followObserversBound = true;
    // 捕获阶段同时挂 window 与 document（部分容器滚动只在 document 上冒泡阶段可见）
    window.addEventListener('scroll', onFollowScroll, true);
    document.addEventListener('scroll', onFollowScroll, true);
    window.addEventListener('resize', onFollowWindowResize);
    try {
      if (typeof ResizeObserver !== 'undefined') {
        followResizeObserver = new ResizeObserver(() => scheduleFollowRealign());
        followResizeObserver.observe(document.documentElement);
        if (document.body) followResizeObserver.observe(document.body);
      }
    } catch (e) { followResizeObserver = null; }
    try {
      if (typeof MutationObserver !== 'undefined' && document.documentElement) {
        followMutationObserver = new MutationObserver((records) => {
          if (!mutationTouchesLayout(records)) return; // 只为脚本自身写入 → 无需重算
          scheduleFollowRealign();
        });
        followMutationObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class'],
        });
      }
    } catch (e) { /* 忽略：仍保留 scroll / resize / ResizeObserver 三层兜底 */ }
  }

  // v2.3.0：升级迁移（一次性）—— 若按钮仍是 v2.2.0 遗留的「盒子内挂载」状态
  // （挂着 fcv-btn-inbox 类，或残留 --fcv-anchor-dx/dy 与 _fcvInboxBox 记录），
  // 则还原它对盒子与祖先做的临时改动（position / overflow），并把按钮搬回盒子外层容器。
  // 之后由 alignExternalButton 按 v2.3.0 规则重新落绝对坐标。未经历过 v2.2.0 时是空操作。
  function migrateLegacyInboxButton(btn, outer) {
    if (!btn) return;
    const legacy = btn.classList.contains(LEGACY_INBOX_CLASS) || !!btn._fcvInboxBox || !!btn._fcvInboxCssVars;
    if (!legacy) return;
    try {
      const restores = btn._fcvInboxRestore;
      if (restores) {
        restores.forEach((r) => {
          if (!r || !r.el) return;
          if (r.value) r.el.style.setProperty(r.prop, r.value);
          else r.el.style.removeProperty(r.prop);
        });
      }
      const patches = btn._fcvOverflowPatches;
      if (patches) {
        patches.forEach((p) => {
          if (!p || !p.el) return;
          if (p.value) p.el.style.setProperty(p.prop, p.value);
          else p.el.style.removeProperty(p.prop);
          p.el.removeAttribute('data-fcv-inbox-patch');
        });
      }
      btn.classList.remove(LEGACY_INBOX_CLASS);
      btn.classList.remove('view-comments-btn--inbox');
      btn.classList.add('view-comments-btn--external');
      btn.style.removeProperty('--fcv-anchor-dx');
      btn.style.removeProperty('--fcv-anchor-dy');
      const target = btn._fcvOuter || outer;
      if (target && target.isConnected && btn.parentElement !== target) target.appendChild(btn);
    } catch (e) { logWarn('迁移 v2.2.0 盒子内挂载残留失败', e); }
    btn._fcvInboxBox = null;
    btn._fcvInboxRestore = null;
    btn._fcvInboxCssVars = false;
    btn._fcvOverflowPatches = null;
  }

  // v2.3.0：重算单个按钮 —— 优先沿用上次命中的锚点盒子（避免每次重算都重扫 DOM）；
  // 锚点失效（脱离文档 / 尺寸归零）时才回到 alignExternalButton 重走完整锚点优先级链。
  function realignFollowedButton(btn) {
    if (!btn || !btn.isConnected) return;
    const card = btn._fcvCard || btn.parentElement;
    const outer = btn._fcvOuter || btn.parentElement;
    if (!card || !outer || !outer.isConnected) return;
    const boxEl = btn._fcvChoiceBox;
    if (boxEl && boxEl.isConnected) {
      const boxRect = boxEl.getBoundingClientRect();
      if (boxRect.width || boxRect.height) {
        const outerRect = outer.getBoundingClientRect();
        const btnW = btn.offsetWidth || EXTERNAL_BTN_SIZE_PX;
        const btnH = btn.offsetHeight || EXTERNAL_BTN_SIZE_PX;
        const pos = computeChoiceBoxLeftTop(boxRect, outerRect,
          outer.scrollLeft, outer.scrollTop, btnH);
        // v2.6.2：跟随重算是热路径，「退出」按钮的防遮挡也必须在这里做，
        // 否则下一帧就会把按钮拉回与「退出」按钮重叠的位置。
        const safe = applyExitOverlapGuard(btn, card, outer, outerRect, pos.left, pos.top, btnW, btnH);
        writeButtonPosition(btn, safe.left, safe.top);
        const mode = safe.avoided ? 'choice-box+exit-avoid' : 'choice-box';
        if (btn.dataset.fcvAnchor !== mode) btn.dataset.fcvAnchor = mode;
        observeChoiceBox(boxEl);
        return;
      }
    }
    alignExternalButton(btn, card, outer);
  }

  // v2.3.0：重算全部外部按钮（承接 v1.5.0 的 window resize 重算，现为统一跟随入口）——
  // 每个按钮优先用已命中的锚点盒子实时重算坐标，并顺带完成 v2.2.0 遗留状态的迁移。
  function realignAllExternalButtons() {
    let all = [];
    try { all = document.querySelectorAll('.' + COMMENT_BTN_CLASS + '--external'); } catch (e) { all = []; }
    all.forEach((btn) => {
      if (!btn.isConnected) return;
      const outer = btn._fcvOuter || (btn._fcvCard && btn._fcvCard.parentElement) || btn.parentElement;
      // v2.3.0：按钮必须在盒子外部 —— 若仍是 v2.2.0 的盒子内挂载，先搬出来再算坐标
      migrateLegacyInboxButton(btn, outer);
      realignFollowedButton(btn);
    });
    pruneObservedChoiceBoxes();
  }

  // v1.5.0：把按钮绝对定位到题卡外侧；v1.6.0 左外侧偏移定为 2cm；v1.7.0 改为「退出」按钮正下方。
  // v1.8.0：定位优先级（前一级不可用才降级，全程不报错、不隐藏按钮）：
  //   ① v2.1.0 起（首选）锚定「题干 + 选项盒子」（CHOICE_BOX_SELECTORS）的**右下角**，把按钮**左下角**
  //      与该点精确重合：left = box.right − container.left（+ 滚动量）；
  //      top = box.bottom − container.top（+ 滚动量）− 按钮高（56）。
  //      本分支**不叠加任何位移增量、也不做贴边夹取**，保证两点严格重合
  //      （v1.9.0 的 +75.6 / −75.6、v2.0.0 的 −37.8 / −11.34 均只作用于下一级兜底）。
  //      v2.2.0 曾把按钮挂进盒子内部用 CSS 跟随；v2.3.0 已纠正为**仍在盒子外部**（题卡外层容器
  //      .fcv-question-mount），改由 JS 实时重算坐标实现动态跟随：ResizeObserver（文档根 + 锚点盒子）
  //      + 捕获阶段 scroll（window 与内部滚动容器）+ MutationObserver + window resize 四路信号
  //      经 requestAnimationFrame 节流后统一重算 left/top（见 computeChoiceBoxLeftTop /
  //      scheduleFollowRealign），盒子移动、重排、滚动、切换题目时都严丝合缝贴着盒子右下角。
  //      升级遗留：v2.2.0 挂在盒子内部的按钮（fcv-btn-inbox）会在此被迁回外层容器并还原临时样式。
  //   ② 找不到该盒子时，回退 v1.8.0/v2.0.0 的「画布整体盒子（canvas#draft.pen）外的右下角」：
  //      left = box.right − 按钮宽 + NUDGE_RIGHT_PX − NUDGE_LEFT_EXTRA_PX；
  //      top = box.bottom + DRAFT_BOX_GAP_PX − NUDGE_UP_PX − NUDGE_UP_EXTRA_PX（行为原样保留，不夹取）。
  //   ③ 再回退 v1.7.0 的「题卡右下角『退出』按钮正下方（水平居中、间隔 7px）」。
  //   ④ 最后回退 v1.6.0 的「题卡左外侧 2cm、纵向对齐题号行」。
  // left/top 一律相对外层容器（.fcv-question-mount，position:relative）换算并计入滚动量，
  // 因此锚点无论是题卡内元素还是页面级元素，都能换算出正确位置。
  function alignExternalButton(btn, card, outer) {
    try {
      const cardRect = card.getBoundingClientRect();
      const outerRect = outer.getBoundingClientRect();
      if (!cardRect.width && !cardRect.height) return; // 元素不可见时不定位，留待下次同步
      // v2.2.0：记住本次的绝对定位基准容器，供「盒子内挂载」模式下的退路 / 重算使用
      btn._fcvOuter = outer;
      const btnW = btn.offsetWidth || EXTERNAL_BTN_SIZE_PX;
      const btnH = btn.offsetHeight || EXTERNAL_BTN_SIZE_PX;
      // 贴边保护：保证按钮完整落在外层容器可视宽度内，避免越出右边界被裁切
      const minLeft = Math.round(outer.scrollLeft);
      const maxLeft = Math.round(outerRect.width + outer.scrollLeft - btnW);
      const clampLeft = (v) => (v > maxLeft ? maxLeft : (v < minLeft ? minLeft : v));
      const choiceBox = findChoiceBoxAnchor(card, btn);
      const draftBox = choiceBox ? null : findDraftBoxAnchor(card, btn);
      const exitAnchor = (choiceBox || draftBox) ? null : findExitAnchor(card, btn);
      let mode = 'external-left';
      let left;
      let top;
      // v2.3.0：按钮必须在「题干 + 选项盒子」**外部** —— 先把 v2.2.0 遗留的盒子内挂载状态
      //（盒子被临时改的 position、祖先被放开的 overflow、按钮自身的 fcv-btn-inbox 类与
      // --fcv-anchor-dx/dy 变量）清理还原，并把按钮搬回外层容器，再按下面的链重新落点。
      migrateLegacyInboxButton(btn, outer);
      if (choiceBox) {
        // ① v2.3.0（首选）：按钮在盒子**外部**（挂在题卡外层容器上），用绝对定位把「按钮左下角」
        //    钉到「盒子右下角」；本分支不叠加任何 nudge 位移、也不做 clampLeft 贴边夹取，
        //    保证两点严格重合。盒子移动 / 变形 / 滚动 / 重排 / 切题时，由 ResizeObserver +
        //    捕获阶段 scroll + MutationObserver + resize 经 rAF 节流实时重算坐标
        //（见 realignFollowedButton），因此不会脱节。
        const bRect = choiceBox.rect;
        const pos = computeChoiceBoxLeftTop(bRect, outerRect, outer.scrollLeft, outer.scrollTop, btnH);
        left = pos.left;
        top = pos.top;
        mode = 'choice-box';
        // 注册跟随机制（幂等）并把该盒子纳入 ResizeObserver
        ensureFollowObservers();
        observeChoiceBox(choiceBox.el);
      } else if (draftBox) {
        // ② v1.8.0：整体盒子外的右下角——右边缘对齐 + 下边缘外 8px
        //    v1.9.0：在此基础上整体右移 2cm、上移 2cm（left +75.6px、top −75.6px）。
        //    v2.0.0：再上移 1cm、再左移 0.3cm（top 再 −37.8px、left 再 −11.34px）。
        //    本分支不再走 clampLeft 贴边夹取：夹取会把越界的位移拉回容器内，导致位移失效。
        const bRect = draftBox.rect;
        left = Math.round(bRect.right - outerRect.left + outer.scrollLeft - btnW + NUDGE_RIGHT_PX - NUDGE_LEFT_EXTRA_PX);
        top = Math.round(bRect.bottom - outerRect.top + outer.scrollTop + DRAFT_BOX_GAP_PX - NUDGE_UP_PX - NUDGE_UP_EXTRA_PX);
        mode = 'draft-box';
      } else if (exitAnchor) {
        // ③ v1.7.0 兜底：水平在「退出」按钮正下方居中，垂直间隔 EXIT_ANCHOR_GAP_PX（7px）
        const aRect = exitAnchor.getBoundingClientRect();
        left = clampLeft(Math.round(aRect.left - outerRect.left + outer.scrollLeft + (aRect.width - btnW) / 2));
        top = Math.round(aRect.bottom - outerRect.top + outer.scrollTop + EXIT_ANCHOR_GAP_PX);
        mode = 'exit';
      } else {
        // ④ v1.6.0 兜底：题卡左边缘外 2cm，纵向优先对齐题号行
        left = Math.round(cardRect.left - outerRect.left + outer.scrollLeft - EXTERNAL_BTN_OFFSET_PX);
        const titleEl = card.querySelector('.title-right, span.index, .options-title');
        if (titleEl) {
          const tRect = titleEl.getBoundingClientRect();
          top = Math.round(tRect.top - outerRect.top + outer.scrollTop + Math.max(0, (tRect.height - btnH) / 2));
        } else {
          top = Math.round(cardRect.top - outerRect.top + outer.scrollTop);
        }
      }
      // v2.6.2：防遮挡 —— 「题干 + 选项盒子」右下角 / 画布盒子右下角这两级落点都可能与
      // 题卡内悬浮的「退出」按钮相交，相交时按 resolveExitOverlap 让到其正下方（再不行让到右侧）。
      // 「③ 退出按钮正下方」这一级本身就锚定「退出」、天然不重叠；「④ 左外侧」这级
      // 说明卡内根本没有「退出」按钮，都无需再查（也避免多余的 DOM 扫描）。
      if (choiceBox || draftBox) {
        const safe = applyExitOverlapGuard(btn, card, outer, outerRect, left, top, btnW, btnH);
        left = safe.left;
        top = safe.top;
        if (safe.avoided) mode += '+exit-avoid';
      }
      // v1.6.0：定位同样走 style.setProperty 局部写入，避免整体赋值误伤其它内联样式；
      // v2.3.0：改由 writeButtonPosition 写入，并与上次值比对去重（同值不重复写，切断自触发回环）
      writeButtonPosition(btn, left, top);
      // v1.8.0：记录本次命中的定位模式（choice-box / draft-box / exit / external-left）与锚定元素，
      // 便于排查问题、并为「一锚点一按钮」去重提供依据（不影响功能）
      btn.dataset.fcvAnchor = mode;
      btn._fcvChoiceBox = choiceBox ? choiceBox.el : null;
      btn._fcvDraftBox = draftBox ? draftBox.el : null;
    } catch (e) { logWarn('按钮定位失败', e); }
  }

  // v1.5.0：窗口尺寸变化后重算全部外部按钮的定位（题卡位置 / 宽度可能改变）。
  // v2.3.0：实现上移为统一跟随入口 realignAllExternalButtons（见上方跟随区块），此处只保留初始化入口。
  function bindExternalResizeHandler() {
    // v2.3.0：resize / 捕获阶段 scroll / ResizeObserver / MutationObserver 四种跟随信号
    // 统一由 ensureFollowObservers 注册（幂等）；任何信号都经 rAF 节流重算全部按钮坐标。
    ensureFollowObservers();
    scheduleFollowRealign(); // 初始化即对齐一次，无需等待观察器首次触发
  }

  // v1.7.0：按钮文案拆成两行「查看」/「评论」（各占一行、在正方形内居中）。
  // 用 DOM 构建两个 span 而非 innerHTML；重复调用（每次同步都会走 injectButton）时命中标记直接返回，
  // 避免反复重建节点造成闪烁与无谓开销。
  function applySquareLabel(btn) {
    if (!btn) return;
    if (btn.dataset.fcvLabelLines === '2' && btn.querySelectorAll('.fcv-btn-line').length === 2) return;
    while (btn.firstChild) btn.removeChild(btn.firstChild);
    ['查看', '评论'].forEach((text) => {
      const line = document.createElement('span');
      line.className = 'fcv-btn-line';
      line.textContent = text;
      btn.appendChild(line);
    });
    btn.dataset.fcvLabelLines = '2';
  }

  function injectButton(card, index) {
    if (!card) return;
    const btn = createQuestionCommentButton(card, index);
    if (!btn) return;
    btn.classList.remove('fenbi-helper-inline-comment');
    btn.removeAttribute('aria-label');
    // v1.7.0：文案改为两行「查看」/「评论」（v1.6.0 为单行「查看评论」纯文本，
    // 再之前为 '💬 查看评论'，气泡 / 评论图标已于 v1.6.0 移除）
    applySquareLabel(btn);
    btn.classList.add('view-comments-btn--external');
    // v1.6.0：实心填充 + 白字（去掉原蓝色半透明描边 / 透明底）；v2.0.0：配色改为黑底白字
    // （背景 #000、文字 #fff、悬浮加深为 #222）。
    // 一律用 style.setProperty / removeProperty 局部覆盖：先清掉可能残留的颜色类内联样式，
    // 再以 CSS 变量注入新配色（由 .view-comments-btn--external 及其 :hover 规则消费），
    // 全程不触碰 left / top 等定位内联样式。严禁 style.cssText 整体赋值——那会清空全部内联样式。
    ['background', 'background-color', 'color', 'border', 'border-color', 'border-style', 'border-width']
      .forEach((prop) => btn.style.removeProperty(prop));
    btn.style.setProperty('--fcv-btn-bg', '#d8d8d8');
    btn.style.setProperty('--fcv-btn-bg-hover', '#c4c4c4');
    btn.style.setProperty('--fcv-btn-fg', '#333');
    // 外层容器 = 题卡的父节点（题卡整体盒子的外层容器），保证按钮落在题卡外部、
    // 不被题卡自身的 overflow 裁切；再统一设 position:relative + overflow:visible。
    // v2.8.2：挂载点统一由 resolveMountOuter 决定（题组小题上提到 .tis-container）
    const outer = resolveMountOuter(card);
    if (!outer.classList.contains(QUESTION_MOUNT_CLASS)) outer.classList.add(QUESTION_MOUNT_CLASS);
    // v2.3.0：按钮**始终挂在盒子外部** —— 这里无条件把它归位到外层容器（题卡父节点），
    // 保证它绝不会成为 .question-choice-container / app-question-choice 的子元素；
    // v2.2.0 遗留的盒子内挂载会被一并搬出，其临时样式 / 防裁切补丁由 migrateLegacyInboxButton 还原。
    if (btn.parentElement !== outer) {
      if (btn.parentElement) btn.parentElement.removeChild(btn);
      outer.appendChild(btn);
    }
    // 记录按钮所属题卡（供窗口尺寸变化时重算定位；生命周期与按钮一致）
    btn._fcvCard = card;
    alignExternalButton(btn, card, outer);
    logInfo('注入查看评论按钮', 'index=' + index,
      '题号=' + (state.solutionIds[index] == null ? 'null' : state.solutionIds[index]),
      'episodeId=' + (state.episodeIds && state.episodeIds[index] != null ? state.episodeIds[index] : 'null'),
      '待映射=' + (state.episodeIds && state.episodeIds[index] != null ? '否' : '是'));
  }

  function syncButtonsIn(rootSelector, itemSelector, callback) {
    const roots = document.querySelectorAll(rootSelector);
    if (!roots.length) return;
    roots.forEach((root) => {
      const items = root.querySelectorAll(itemSelector);
      items.forEach((el, i) => {
        const target = callback ? callback(el, i) : el;
        if (target) injectButton(target, i);
      });
    });
  }

  function syncNormalQuestionCommentButtons() {
    if (isProfileRoute()) return;

    // v1.5.0：以「题卡整体盒子」为锚点（原为卡片内部的 .title-right / 题号区域），
    // 用合并选择器统一编号，避免分组 forEach 各从 0 开始导致序号错位
    // v2.8.2：改用 queryQuestionCards()（资料分析题组已下钻为各小题），下标与 solutionIds 严格对齐
    const cards = queryQuestionCards();
    if (cards.length) {
      cards.forEach((el, i) => injectButton(el, i));
    } else {
      // 兜底：页面结构不含上述题卡时，退回以题号 span.index 的父级为锚点
      document.querySelectorAll('.ti span.index').forEach((el, i) => {
        const parent = el.parentElement;
        if (parent) injectButton(parent, i);
      });
    }
  }

  function syncCommentButtons() {
    ensureFavoritesEntryButton();   // v2.7.0：页面重渲染后补回「我的收藏」入口（已存在则跳过）
    if (isProfileRoute()) {
      // 个人中心/练习报告页：以题目卡片为锚点注入（下标改用卡片上显示的题号）
      // v1.5.0：按钮挂到卡片外层容器，故不再用 el.querySelector 判重，统一交给 injectButton 内部按题卡 uid 去重
      document.querySelectorAll('fb-local-question, fb-recitatation-question, #app-report-ques-solution .solution-item').forEach((el, i) => {
        injectButton(el, getProfileQuestionIndex(el, i));
      });
      return;
    }
    syncNormalQuestionCommentButtons();
  }

  // 题卡上 .options-title 的文本即题号，减一为下标；
  // 直接用 forEach 的 i 会在多容器混排时与 solutionIds 错位，导致点 A 题去查 B 题的 episodeId。
  function getProfileQuestionIndex(el, fallback) {
    const titleEl = el && el.querySelector ? el.querySelector('.options-title') : null;
    const n = parseInt(titleEl ? titleEl.textContent : '', 10);
    const total = Math.max(state.solutionIds.length, document.querySelectorAll('fb-local-question, fb-recitatation-question').length);
    if (Number.isFinite(n) && n > 0 && n <= total) return n - 1;
    return fallback;
  }

  // ============================ 观察器 ============================
  function observeElements(rootSelector, itemSelector, callback, debounceTime) {
    const root = document.querySelector(rootSelector);
    if (!root) return null;
    const seen = new WeakSet();
    let timer = null;

    const process = () => {
      Array.from(root.querySelectorAll(itemSelector)).forEach((el, i) => {
        if (seen.has(el)) return;
        seen.add(el);
        try { callback(el, i); } catch (e) { logError('处理元素失败', e); }
      });
    };
    process();
    const mo = new MutationObserver((records) => {
      const changed = records.some((r) => (r.type === 'childList' && (r.addedNodes.length || r.removedNodes.length)));
      if (!changed) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(process, debounceTime || 300);
    });
    mo.observe(root, { childList: true, subtree: true });
    return { stop: () => { if (timer !== null) clearTimeout(timer); mo.disconnect(); } };
  }

  function onDomReady(fn) {
    const run = () => {
      if (!document.body) { setTimeout(run, 50); return; }
      fn();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  }

  function initializeCommentButtons() {
    document.documentElement.setAttribute('data-fenbi-comment-viewer', SCRIPT_VERSION);

    observeElements('body', '.tis-container, .solution-detail, .ti', () => setTimeout(syncCommentButtons, 0), 200);
    // v1.5.0：观察器锚点由卡片内部（.title-right / span.index）改为「题卡整体盒子」，
    // 按钮统一由 injectButton 挂到题卡外层容器并绝对定位到盒子左外侧 2cm（v1.6.0）。
    // v2.8.2：一律经 injectButtonsForContainers 注入 —— 资料分析题组会被下钻为各小题，
    // 下标取「全页题卡列表」位置（原实现用局部 i，会让题组内多个子锚点互相覆盖同一个按钮）。
    observeElements('.tis-container', '.ti', (el) => injectButtonsForContainers([el]), 200);
    observeElements('.solution-detail', '.question', (el) => injectButtonsForContainers([el]), 200);
    observeElements('.ti', '.title-right', (el) => {
      const card = cardForElement(el);
      if (card) injectButtonsForContainers([card]);
    }, 200);
    observeElements('.ti', 'span.index', (el) => {
      const card = cardForElement(el) || el.parentElement;
      if (card) injectButtonsForContainers([card]);
    }, 200);

    // profile / 报告页
    observeElements('body', 'fb-local-question, fb-recitatation-question, #app-report-ques-solution .solution-item',
      (el, i) => injectButton(el, getProfileQuestionIndex(el, i)), 150);

    // v1.5.0：窗口尺寸变化后重算外部按钮定位
    bindExternalResizeHandler();

    syncCommentButtons();
  }

  // 供控制台调用：__fenbiCV.showDiagnostics() 打开同一套诊断弹窗
  function openDiagnosticModal(reason) {
    const m = createModal('评论功能自检');
    showDiagnosticPanel(m, reason || '手动查看诊断信息', -1);
    return m;
  }

  // ============================ 样式 ============================
  function injectStyles() {
    if (document.getElementById('fenbi-comment-viewer-style')) return;
    const style = document.createElement('style');
    style.id = 'fenbi-comment-viewer-style';
    style.textContent = `
      .view-comments-btn{display:inline-flex;align-items:center;gap:4px;margin:0 6px;padding:3px 10px;
        font-size:10px;line-height:1.4;color:#3b7cff;background:rgba(59,124,255,.08);
        border:1px solid rgba(59,124,255,.35);border-radius:7px;cursor:pointer;
        transition:background .2s,color .2s;font-family:inherit;vertical-align:middle}
      .view-comments-btn:hover{background:rgba(59,124,255,.18)}
      .comment-modal-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,0);
        display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .25s,background .25s}
      .comment-modal-overlay.active{opacity:1;background:rgba(0,0,0,.45)}
      .comment-modal{width:min(560px,92vw);max-height:80vh;background:#fff;border-radius:12px;
        box-shadow:0 12px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;
        transform:translateY(12px);transition:transform .25s}
      .comment-modal.open{transform:translateY(0)}
      .comment-modal-header{display:flex;align-items:center;justify-content:space-between;
        padding:14px 18px;border-bottom:1px solid #eee}
      .comment-modal-header h3{margin:0;font-size:16px;font-weight:600;color:#222}
      .comment-modal-close{border:none;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#999}
      .comment-modal-close:hover{color:#333}
      .comment-modal-content{flex:1;overflow-y:auto;padding:8px 0}
      .loading-wrapper{padding:48px 20px;text-align:center;color:#888;font-size:14px}
      .loading-spinner{width:28px;height:28px;margin:0 auto 12px;border:3px solid #e5e5e5;
        border-top-color:#3b7cff;border-radius:50%;animation:fenbi-spin .8s linear infinite}
      @keyframes fenbi-spin{to{transform:rotate(360deg)}}
      .comments-container{padding:0 16px}
      .comment-item{padding:12px 0;border-bottom:1px solid #f2f2f2}
      .comment-item:last-child{border-bottom:none}
      .comment-user-info{display:flex;gap:10px;align-items:center}
      .comment-avatar{width:36px;height:36px;border-radius:50%;object-fit:cover;background:#f0f0f0}
      .comment-meta{flex:1;min-width:0}
      .comment-nickname{font-size:13px;font-weight:600;color:#333}
      .comment-sub-meta{display:flex;align-items:center;gap:6px;font-size:11px;color:#999;margin-top:2px}
      .rating-stars{color:#ffb400;letter-spacing:-1px}
      .comment-text{margin:8px 0 6px;font-size:13px;line-height:1.6;color:#333;word-break:break-word;white-space:pre-wrap}
      .comment-footer{display:flex;justify-content:flex-end}
      .like-count-wrapper{display:inline-flex;align-items:center;gap:4px;color:#999;cursor:pointer;
        font-size:10px;padding:2px 6px;border-radius:10px;transition:color .2s,background .2s}
      .like-count-wrapper:hover{background:#f5f5f5}
      .like-count-wrapper.liked{color:#e64545}
      .like-count-wrapper.shake-error{animation:fenbi-shake .4s}
      @keyframes fenbi-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
      .no-more-comments{padding:14px;text-align:center;color:#bbb;font-size:12px}
      .loading-more{padding:14px;text-align:center;color:#bbb;font-size:12px}
      .comment-modal-overlay.dark .comment-modal{background:#1f1f1f}
      .comment-modal-overlay.dark .comment-modal-header{border-bottom-color:#333}
      .comment-modal-overlay.dark .comment-modal-header h3{color:#eee}
      .comment-modal-overlay.dark .comment-text,.comment-modal-overlay.dark .comment-nickname{color:#ddd}
      .comment-modal-overlay.dark .comment-item{border-bottom-color:#2a2a2a}
      .comment-modal-overlay.dark .like-count-wrapper:hover{background:#2a2a2a}
      /* 待映射态按钮（灰虚线，点击弹诊断） */
      .view-comments-btn--pending{opacity:.72;border-style:dashed;border-color:#c8ccd4;background:transparent;color:#8a9099}
      /* v1.5.0：题卡外层容器——相对定位 + 溢出可见，保证按钮落在题卡盒子外部且不被裁切 */
      .fcv-question-mount{position:relative!important;overflow:visible!important}
      /* v1.5.0：外部定位按钮——绝对定位到题卡边缘外侧，实际坐标由脚本实时计算并内联写入 */
      /* v1.6.0：偏移由 1cm 改为 2cm（2cm≈75.6px），兜底值与 EXTERNAL_BTN_OFFSET_PX 保持一致；
         颜色走 CSS 变量（--fcv-btn-*），由 JS 用 style.setProperty 局部注入，便于统一换肤且不影响 left/top */
      /* v1.7.0：默认定位改为题卡右下角「退出」按钮正下方（坐标由 JS 内联写入 left/top）；
         v1.8.0：首选锚点再改为「题干 + 选项整体盒子」（canvas#draft.pen）外的右下角；
         v1.9.0：该落点整体再上移 2cm、右移 2cm（top −75.6px、left +75.6px，见 NUDGE_* 常量）；
         v2.0.0：该落点再上移 1cm、左移 0.3cm（top 再 −37.8px、left 再 −11.34px，见 NUDGE_*_EXTRA_PX 常量）；
         这里的 left:-2cm 仅作为「① 找不到该 canvas → ② 找不到退出锚点」两级兜底都落空时的左外侧兜底值；
         外形改为正方形 56×56（box-sizing:border-box），覆盖基类的内外边距与横向 flex 排列，
         文案两行「查看」/「评论」纵向居中；圆角 14px 与悬浮态过渡沿用既有规则 */
      .view-comments-btn--external{position:absolute;left:-2cm;top:0;margin:0;z-index:2147482000;white-space:nowrap;
        width:56px;height:56px;box-sizing:border-box;padding:0;
        display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
        font-size:15px;line-height:1.15;text-align:center;vertical-align:middle;
        color:var(--fcv-btn-fg,#333);
        background:linear-gradient(135deg,#bfdbfe 0%,#f1f5f9 80%,#f1f5f9 100%);
        border:1px solid #cbd5e1;border-radius:7px;transition:background .2s,filter .2s}
      /* v2.6.5：淡蓝到浅灰渐变，hover 加亮 */
      .view-comments-btn--external:hover{background:linear-gradient(135deg,#93c5fd 0%,#e2e8f0 80%,#e2e8f0 100%);
        border-color:#cbd5e1}
      /* v2.3.0：按钮一律使用上面的 --external 规则（绝对定位 + JS 实时重算的内联 left/top px）。
         v2.2.0 的 .view-comments-btn--inbox（盒子内挂载、calc(100% + 补偿变量) 相对定位）已废弃删除；
         升级后残留的 fcv-btn-inbox 类与 --fcv-anchor-dx/dy 变量由 migrateLegacyInboxButton 清理。 */
      /* v1.2.0：弹窗内的诊断报告 */
      .fcv-report{text-align:left;font-size:10px;color:#333}
      .fcv-report-reason{padding:8px 10px;border-radius:6px;background:#fff6f6;border:1px solid #ffd9d9;
        color:#b03030;line-height:1.6;word-break:break-word}
      .fcv-report-sec{margin:10px 0 4px;font-weight:600;color:#666}
      .fcv-report-table{width:100%;border-collapse:collapse}
      .fcv-report-table th{width:118px;text-align:left;font-weight:400;color:#888;vertical-align:top;
        padding:2px 6px 2px 0}
      .fcv-report-table td{padding:2px 0;word-break:break-all;color:#333}
      .fcv-report-list{margin:0;padding-left:18px;max-height:150px;overflow:auto;color:#555}
      .fcv-report-list li{margin:2px 0;word-break:break-all}
      .fcv-report-list b{color:#c47f00}
      .fcv-report-actions{display:flex;gap:8px;margin:12px 0 6px}
      .fcv-report-btn{flex:1;border:1px solid #d5d9e0;background:#f7f8fa;color:#333;border-radius:6px;
        padding:6px 8px;cursor:pointer;font-size:12px}
      .fcv-report-btn:hover{background:#eef1f6}
      .fcv-report-tip{color:#aaa;font-size:11px;line-height:1.6}
      /* ===== v2.4.0：评论级「复制 / 收藏」按钮 + 收藏状态标记 ===== */
      .comment-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px}
      .fcv-comment-act{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#999;
        padding:2px 8px;border-radius:10px;cursor:pointer;user-select:none;white-space:nowrap;
        transition:color .2s,background .2s}
      .fcv-comment-act:hover{background:#f5f5f5;color:#3b7cff}
      .fcv-comment-act.fcv-act--done{color:#2e9e5b}
      .fcv-comment-act.fcv-act--busy{color:#999;cursor:progress;opacity:.75}
      .fcv-comment-act.fcv-act--favorited{color:#e6a700;background:rgba(230,167,0,.10)}
      .comment-modal-overlay.dark .fcv-comment-act:hover{background:#2a2a2a}
      .comment-modal-overlay.dark .fcv-comment-act.fcv-act--favorited{background:rgba(230,167,0,.16)}
      /* v2.6.5：已收藏按钮悬浮时把「已收藏」换成「取消收藏」，提示可点击取消 */
      .fcv-comment-act.fcv-fav-act .fcv-fav-hint{display:none}
      .fcv-comment-act.fcv-fav-act.fcv-act--favorited:hover .fcv-fav-label{display:none}
      .fcv-comment-act.fcv-fav-act.fcv-act--favorited:hover .fcv-fav-hint{display:inline}
      /* v2.4.0：弹窗标题栏的齿轮（打开 WebDAV 收藏设置） */
      .comment-modal-header-actions{display:flex;align-items:center;gap:6px}
      .comment-modal-settings{border:none;background:transparent;font-size:16px;line-height:1;cursor:pointer;
        color:#999;padding:2px 4px}
      .comment-modal-settings:hover{color:#3b7cff}
      .comment-modal-fav{border:1px solid rgba(59,124,255,.35);background:rgba(59,124,255,.08);color:#3b7cff;font-size:12px;padding:2px 8px;border-radius:6px;cursor:pointer;transition:background .2s,color .2s;font-family:inherit;line-height:1.4}
      .comment-modal-fav:hover{background:rgba(59,124,255,.18)}
      /* v2.7.0：右上角悬浮收藏按钮现在冗余（评论弹窗标题栏已有入口），隐藏掉 */
      .fcv-fav-entry{display:none !important}
      /* v2.4.0：轻提示（复制 / 收藏的成败提示，未配置时带「去配置」按钮） */
      .fcv-toast-host{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:2147483200;
        display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
      .fcv-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;max-width:min(560px,88vw);
        padding:9px 14px;border-radius:10px;background:rgba(23,23,23,.94);color:#fff;font-size:13px;
        line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.28);animation:fcv-toast-in .2s ease-out}
      .fcv-toast--out{opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s}
      .fcv-toast--success{background:rgba(31,122,71,.96)}
      .fcv-toast--error{background:rgba(158,44,44,.96)}
      .fcv-toast--warn{background:rgba(150,102,16,.96)}
      .fcv-toast-text{word-break:break-word}
      .fcv-toast-action{border:1px solid rgba(255,255,255,.6);background:transparent;color:#fff;
        border-radius:8px;padding:3px 10px;font-size:10px;cursor:pointer;white-space:nowrap}
      .fcv-toast-action:hover{background:rgba(255,255,255,.16)}
      @keyframes fcv-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      /* v2.4.0：WebDAV 配置面板（独立于评论弹窗，自带遮罩与 Esc 处理） */
      .fcv-settings-overlay{position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,0);
        display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s,background .2s}
      .fcv-settings-overlay.active{opacity:1;background:rgba(0,0,0,.5)}
      .fcv-settings-panel{width:min(640px,94vw);max-height:86vh;background:#fff;border-radius:12px;
        box-shadow:0 12px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden}
      .fcv-settings-head{display:flex;align-items:center;justify-content:space-between;
        padding:14px 18px;border-bottom:1px solid #eee}
      .fcv-settings-head h3{margin:0;font-size:16px;font-weight:600;color:#222}
      .fcv-settings-close{border:none;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#999}
      .fcv-settings-close:hover{color:#333}
      .fcv-settings-body{flex:1;overflow-y:auto;padding:16px 18px;font-size:13px;color:#333}
      .fcv-field{margin-bottom:12px}
      .fcv-field label{display:block;font-size:10px;font-weight:600;color:#555;margin-bottom:5px}
      .fcv-input{width:100%;box-sizing:border-box;padding:8px 10px;font-size:13px;color:#222;
        border:1px solid #d5d9e0;border-radius:8px;background:#fbfcfe;outline:none;font-family:inherit}
      .fcv-input:focus{border-color:#3b7cff;background:#fff}
      .fcv-field-tip{font-size:11px;color:#999;margin-top:4px;line-height:1.5}
      .fcv-settings-actions{display:flex;gap:8px;margin:14px 0 10px}
      .fcv-settings-btn{flex:1;border:1px solid #d5d9e0;background:#f7f8fa;color:#333;border-radius:8px;
        padding:8px 10px;cursor:pointer;font-size:13px}
      .fcv-settings-btn:hover{background:#eef1f6}
      .fcv-settings-btn[disabled]{opacity:.6;cursor:default}
      .fcv-settings-btn.fcv-settings-save{background:#3b7cff;border-color:#3b7cff;color:#fff}
      .fcv-settings-btn.fcv-settings-save:hover{background:#2f6ae6}
      .fcv-settings-result{margin:10px 0;padding:9px 11px;border-radius:8px;font-size:10px;line-height:1.7;
        word-break:break-word;background:#f7f8fa;border:1px solid #e6e9ef;color:#333}
      .fcv-settings-result--ok{background:#f1fbf4;border-color:#cbead6;color:#1f7a47}
      .fcv-settings-result--err{background:#fff6f6;border-color:#ffd9d9;color:#b03030}
      .fcv-settings-result--warn{background:#fffaf0;border-color:#ffe6bd;color:#8a6100}
      .fcv-settings-help{margin-top:12px;padding-top:10px;border-top:1px dashed #e6e9ef;font-size:10px;
        color:#666;line-height:1.7}
      .fcv-settings-help-title{font-weight:600;color:#444;margin-bottom:4px}
      .fcv-settings-help-row{margin:4px 0;word-break:break-word}
      .fcv-settings-help-row b{color:#333;margin-right:6px}
      .fcv-settings-help-warn{color:#a06a00}
      .fcv-settings-overlay.dark .fcv-settings-panel{background:#1f1f1f}
      .fcv-settings-overlay.dark .fcv-settings-head{border-bottom-color:#333}
      .fcv-settings-overlay.dark .fcv-settings-head h3{color:#eee}
      .fcv-settings-overlay.dark .fcv-settings-body{color:#ddd}
      .fcv-settings-overlay.dark .fcv-field label{color:#bbb}
      .fcv-settings-overlay.dark .fcv-input{background:#2a2a2a;border-color:#3a3a3a;color:#eee}
      .fcv-settings-overlay.dark .fcv-settings-result{background:#242424;border-color:#333;color:#ddd}
      .fcv-settings-overlay.dark .fcv-settings-help{border-top-color:#333;color:#aaa}
      /* ===== v2.7.0：「我的收藏」入口按钮 + 收藏列表面板 ===== */
      .fcv-fav-entry{position:fixed;top:8px;right:14px;z-index:2147482000;display:inline-flex;align-items:center;
        gap:4px;padding:5px 12px;font-size:12px;line-height:1.4;color:#8a6100;background:rgba(255,251,235,.96);
        border:1px solid rgba(230,167,0,.55);border-radius:999px;cursor:pointer;font-family:inherit;
        box-shadow:0 2px 8px rgba(0,0,0,.12);transition:background .2s,color .2s,box-shadow .2s}
      .fcv-fav-entry:hover{background:#fff3cf;color:#6d4c00;box-shadow:0 4px 14px rgba(0,0,0,.18)}
      .comment-modal.fcv-fav-modal{width:min(680px,94vw);max-height:84vh}
      .fcv-fav-toolbar{display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid #f0f0f0;
        flex-wrap:wrap}
      .fcv-fav-tabs{display:inline-flex;border:1px solid #e2e6ee;border-radius:999px;overflow:hidden;background:#f7f8fa}
      .fcv-fav-tab{border:none;background:transparent;color:#666;font-size:12px;padding:5px 12px;cursor:pointer;
        font-family:inherit}
      .fcv-fav-tab:hover{color:#3b7cff}
      .fcv-fav-tab--active{background:#3b7cff;color:#fff}
      .fcv-fav-status{flex:1;min-width:0;font-size:10px;color:#999;text-align:right;word-break:break-all}
      .fcv-fav-list{padding:6px 16px 12px}
      .fcv-fav-row{padding:10px 0;border-bottom:1px solid #f2f2f2}
      .fcv-fav-row:last-child{border-bottom:none}
      .fcv-fav-row-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .fcv-fav-time{font-size:11px;color:#999;font-variant-numeric:tabular-nums}
      .fcv-fav-qtag{font-size:10px;color:#3b7cff;background:rgba(59,124,255,.08);border-radius:6px;padding:1px 6px}
      .fcv-fav-count{font-size:10px;color:#999}
      .fcv-fav-spacer{flex:1}
      .fcv-fav-toggle,.fcv-fav-del{border:1px solid #d5d9e0;background:#f7f8fa;color:#333;border-radius:6px;
        padding:2px 9px;font-size:10px;cursor:pointer;font-family:inherit;white-space:nowrap}
      .fcv-fav-toggle:hover{background:#eef1f6;color:#3b7cff}
      .fcv-fav-del{color:#b03030;border-color:#f0d0d0;background:#fff7f7}
      .fcv-fav-del:hover{background:#ffecec}
      .fcv-fav-del--confirm{background:#e64545;border-color:#e64545;color:#fff}
      .fcv-fav-text{margin:6px 0 4px;font-size:13px;line-height:1.6;color:#333;word-break:break-word;white-space:pre-wrap}
      .fcv-fav-detail{margin:6px 0 2px;padding:8px 10px;border-radius:8px;background:#f8f9fc;border:1px solid #e6e9ef;
        font-size:12px;color:#333;line-height:1.6}
      .fcv-fav-detail-row{margin:3px 0;word-break:break-word}
      .fcv-fav-detail-row b{color:#888;font-weight:600;margin-right:6px}
      .fcv-fav-detail-choices ul{margin:2px 0 0;padding-left:18px}
      .fcv-fav-cbox{margin:6px 0 0;padding:6px 8px;border-radius:6px;background:#fff;border:1px solid #eef0f4}
      .fcv-fav-cbox-head{display:flex;align-items:center;gap:8px}
      .fcv-fav-cbox-time{font-size:10px;color:#999}
      .fcv-fav-cbox-body{margin-top:4px;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
      .fcv-fav-hint-row{padding:18px 4px;text-align:center;color:#999;font-size:12px;line-height:1.7}
      .fcv-fav-footer{border-top:1px solid #f0f0f0;padding:8px 16px 10px}
      .fcv-fav-foot-actions{display:flex;gap:8px;flex-wrap:wrap}
      .fcv-fav-foot-btn{border:1px solid #d5d9e0;background:#f7f8fa;color:#333;border-radius:8px;padding:6px 12px;
        font-size:12px;cursor:pointer;font-family:inherit}
      .fcv-fav-foot-btn:hover{background:#eef1f6}
      .fcv-fav-result{margin-top:8px;padding:8px 10px;border-radius:8px;font-size:11px;line-height:1.7;
        word-break:break-word;background:#f7f8fa;border:1px solid #e6e9ef;color:#333}
      .fcv-fav-result--ok{background:#f1fbf4;border-color:#cbead6;color:#1f7a47}
      .fcv-fav-result--err{background:#fff6f6;border-color:#ffd9d9;color:#b03030}
      .fcv-fav-result--warn{background:#fffaf0;border-color:#ffe6bd;color:#8a6100}
      .fcv-fav-empty{padding:32px 24px;text-align:center;color:#666}
      .fcv-fav-empty-icon{font-size:34px;color:#e6a700;margin-bottom:8px}
      .fcv-fav-empty-title{font-size:14px;font-weight:600;color:#333;margin-bottom:6px}
      .fcv-fav-empty-tip{font-size:12px;color:#888;line-height:1.8;word-break:break-word;white-space:pre-wrap}
      .fcv-fav-empty-actions{display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap}
      .fcv-fav-empty-btn{border:1px solid #d5d9e0;background:#f7f8fa;color:#333;border-radius:8px;padding:6px 12px;
        font-size:12px;cursor:pointer;font-family:inherit}
      .fcv-fav-empty-btn:hover{background:#eef1f6}
      .comment-modal-overlay.dark .fcv-fav-toolbar,.comment-modal-overlay.dark .fcv-fav-footer{border-color:#333}
      .comment-modal-overlay.dark .fcv-fav-tabs{background:#262626;border-color:#3a3a3a}
      .comment-modal-overlay.dark .fcv-fav-tab{color:#bbb}
      .comment-modal-overlay.dark .fcv-fav-status,.comment-modal-overlay.dark .fcv-fav-time{color:#999}
      .comment-modal-overlay.dark .fcv-fav-row{border-bottom-color:#2a2a2a}
      .comment-modal-overlay.dark .fcv-fav-text{color:#ddd}
      .comment-modal-overlay.dark .fcv-fav-detail{background:#242424;border-color:#333;color:#ddd}
      .comment-modal-overlay.dark .fcv-fav-cbox{background:#1f1f1f;border-color:#333}
      .comment-modal-overlay.dark .fcv-fav-cbox-body{color:#ddd}
      .comment-modal-overlay.dark .fcv-fav-toggle{background:#2a2a2a;border-color:#3a3a3a;color:#ddd}
      .comment-modal-overlay.dark .fcv-fav-del{background:#2a2020;border-color:#4a3030;color:#ffb3b3}
      .comment-modal-overlay.dark .fcv-fav-foot-btn,.comment-modal-overlay.dark .fcv-fav-empty-btn{background:#2a2a2a;
        border-color:#3a3a3a;color:#ddd}
      .comment-modal-overlay.dark .fcv-fav-empty-title{color:#eee}
      .comment-modal-overlay.dark .fcv-fav-result{background:#242424;border-color:#333;color:#ddd}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ============================ 启动 ============================
  function init() {
    logInfo('脚本启动 v' + SCRIPT_VERSION, '评论接口 v' + COMMENT_FEATURE_VERSION + ' / 页面=' + shortenUrl(location.href));
    initInterceptor();
    // v2.4.0：注册油猴菜单（WebDAV 收藏设置 / 已收藏评论数 / 评论功能自检）
    registerFenbiMenuCommands();
    setupInterceptors();
    window.addEventListener('hashchange', () => {
      logInfo('路由变化', shortenUrl(location.href));
      setTimeout(syncCommentButtons, 100);
    });
    onDomReady(() => {
      injectStyles();
      updateEpisodeIdsAndButtons();
      initializeCommentButtons();
      ensureFavoritesEntryButton();
      const d = collectDiagnostics();
      logInfo('初始化完成', '题号=' + d.solutionIdsCount, 'episodeId 映射=' + d.episodeMappedCount,
        '按钮=' + d.buttonsInjected, 'prefix=' + d.currentTikuPrefix);
    });
  }

  // 控制台入口（便于用户自行取证 / 反馈）
  function exposeConsoleApi() {
    try {
      const api = {
        // v2.8.3：version 自本版起返回真实脚本版本（旧版此处返回固定的 2.7.0）
        version: SCRIPT_VERSION,
        commentFeatureVersion: COMMENT_FEATURE_VERSION,
        state: state,
        diag: diag,
        collect: collectDiagnostics,
        dump: () => { const t = buildDiagnosticText(); console.log(t); return t; },
        copy: copyDiagnostics,
        showDiagnostics: openDiagnosticModal,
        sync: () => { updateEpisodeIdsAndButtons(); },
        // v2.4.0：WebDAV 收藏（配置读写 / 连接测试 / 打开设置面板 / 本机已收藏列表）
        webdav: {
          getConfig: getWebdavConfig,
          setConfig: (cfg) => saveWebdavConfig(cfg),
          clearConfig: clearWebdavConfig,
          isConfigured: isWebdavConfigured,
          test: (cfg) => testWebdavConnection(cfg),
          settings: openWebdavSettings,
          favorites: () => Array.from(getFavIdSet()),
          // v2.5.0：按题目聚合的格式自查入口
          //  mergeFavorite(existingText, item)  用假数据演练「并入该题区块 / 新建区块 / 判重」三种结果
          //  countQuestionBlocks(text)          统计文本里的题目区块数
          //  buildQuestionId(index, episodeId)  查看某题的聚合键（题目 ID）
          //  extractQuestionMeta(index)         从该题题卡 DOM 现场取题干 / 选项，验证取材是否成功
          // v2.5.1：选项字母解析自查入口
          //  parseChoiceText(text)              解析「A 举棋不定 / B. xxx /（C）xxx」等前缀，返回 { letter, text }
          mergeFavorite: (existingText, item) => mergeFavoriteIntoMarkdown(existingText, item),
          countQuestionBlocks: (text) => countQuestionBlocks(text),
          buildQuestionId: (index, episodeId) => buildQuestionId(index, episodeId),
          extractQuestionMeta: (index) => extractQuestionMetaFromCard(resolveQuestionCard(index)),
          parseChoiceText: (text) => parseChoiceText(text),
          // v2.6.5：取消收藏自查入口
          //  removeFavorite(existingText, commentMarker)  演练「摘掉一条评论 / 该题无其它收藏则整块删题」两种结果
          //  favMarker(commentId)                         生成某条评论的隐藏标记（与远端文件里的标记一致）
          removeFavorite: (existingText, commentMarker) => removeFavoriteFromMarkdown(existingText, commentMarker),
          favMarker: (commentId) => favMarker(commentId),
          // v2.7.0：「我的收藏」自查 / 手动管理入口
          //  parseFavorites(text)         把一段收藏 Markdown 解析成 {questions, questionCount, commentCount}
          //  listFavorites()              读取远端收藏文件并返回解析结果（不打开面板）
          //  openFavorites()              打开「我的收藏」面板
          //  deleteFavorite(commentId)    直接删掉远端文件里的某条收藏（与面板删除同一链路）
          parseFavorites: (text) => parseFavoritesMarkdown(text),
          listFavorites: () => webdavGetFile(getWebdavConfig()).then((res) => ({
            exists: !!res.exists,
            filePath: (getWebdavConfig().filePath || DEFAULT_WEBDAV_FILE),
            parsed: parseFavoritesMarkdown(res.exists ? res.content : ''),
          })),
          openFavorites: () => onDomReady(openFavoritesPanel),
          deleteFavorite: (commentId) => {
            if (!isWebdavConfigured()) return Promise.reject(new Error('尚未配置 WebDAV'));
            return removeFavoriteFromWebdav(getWebdavConfig(), favMarker(commentId)).then((r) => {
              unmarkFavLocally(commentId);
              if (isFavoritesPanelOpen()) reloadFavorites(favPanelRef);
              return r;
            });
          },
        },
      };
      // v2.4.0：挂到页面真实 window（声明 GM_* 授权后沙箱内的 window 未必等同于页面 window）
      PAGE_WINDOW.__fenbiCV = api;
      if (PAGE_WINDOW !== window) { try { window.__fenbiCV = api; } catch (e) { /* 沙箱内写全局失败无碍 */ } }
      logInfo('已暴露控制台接口 window.__fenbiCV', '可用方法：dump / copy / showDiagnostics / sync / webdav.* / webdav.openFavorites');
    } catch (e) { logWarn('暴露控制台接口失败', e); }
  }

  injectStyles.safe = true;
  exposeConsoleApi();
  try { init(); }
  catch (e) { logError('初始化失败', e); }
})();
