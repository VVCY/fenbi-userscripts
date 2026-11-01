// ==UserScript==
// @name         粉笔自动全开草稿
// @namespace    marvis.fenbi.enhance
// @version      2.9.23
// @description  页面加载后自动打开全部题的草稿；每题注入 ABCD 字母选择盒（D 后带「下一题」），草稿画布锁定为题干+选项高度；新增「笔刷设置」面板（黑/蓝/红笔色切换 + 粗细无级调节）；MutationObserver 适配 SPA 增量渲染，按题目作用域去重；同步 canvas#draft 绘图缓冲区尺寸为容器显示尺寸，修复退出草稿重开后笔迹被垂直压缩；新增 ABCD 点击按钮本身变色（背题对错 / 做题选中），修复判分重建选项节点后 ABCD 按钮不变色；退出重进后按页面既有作答状态自动回填 ABCD 按钮颜色（做题选中深蓝 / 背题对错绿红）；修复做题模式退出重进后 ABCD 按钮空白不回填：选中态改多信号识别（checked 属性 / aria / class），MutationObserver 增补属性级监听并按题精准同步，定时补偿改为前 30 秒持续扫描 + pageshow/visibilitychange/focus 兜底；新增资料分析「一拖五」支持：每个子题独立注入字母盒与草稿画布（tab 切换即就位），「下一题」优先推进组内子题，材料区配独立草稿画布（可完全打开、五题共享、笔迹存 localStorage 退出重进重放），隐藏会吞掉全组指针事件的组级原生草稿；新增性能护栏：草稿与画布只在题目接近视口时才自动创建，低配环境不再 110 个画布全开卡死；平板 Apple Pencil 笔迹改 Catmull-Rom 样条消除折线，原生草稿路径加合并采样还原/防切笔/收笔兜底；新增局域网自动更新地址；v2.8.11 修平板笔迹「一条笔画成两条交错的线」：Apple Pencil 会同时产生 pen 与 touch 两路指针事件，此前两路被一起喂进同一点序导致来回重描，现按 pointerId/pointerType 锁定本笔指针并对同一采样坐标去重。v2.8.12 笔迹管线去浏览器化：跨 world 实例守卫（DOM 属性标记，防重复注入）；会话期间原生草稿画布静音（画者独占，治「两个画者各画一遍」）；归属判定不再依赖 pointerType（避免第三方 WebView 壳里把笔画整段切掉）；采样去重放宽到 0.5px 并新增回访检测（治重复/乱序投递导致的重描）；自适应「触控笔被报成 touch」的设备（把触摸当笔接管）；新增胶囊面板「笔迹自检」（采集指针流分布/采样密度/原生画布像素变化，跨 world 可读）。v2.8.13 依据真机自检数据（Via 报 pen 但采样时没开书写会话）重做笔迹稳健性：原生补密改为幂等（按已投递坐标+区间投影判定，杜绝同一物理采样被补投两遍导致粉笔画出两条交错的线）；归属判定允许浏览器在一笔之内更换 pointerId（不再把笔画截断成直线）；采样去重改为 1px 距离判定；原生画布静音改为只在「可书写」态生效（修 pass 态手指写不了原生草稿的回归）；自检新增指针生命周期台账/事件时间线/自绘笔台账/重复投递嫌疑判定与 captureValid 标志。v2.8.14 依据 Via 真机「有效采样」自检数据修掉「一条笔画成两条交错的线」的真正成因：原生补密的已投递坐标表在每次事件后重建时被丢弃，幂等防线只在单个事件内生效、跨帧完全失效，于是浏览器已经独立投递过的同一批真实采样又被补投一遍（铁证：同一批 14 个采样在相隔 1ms 的两个时间戳里各出现一次；补投 441 点而幂等只挡下 57 点）；现 sent 随笔画继承并把保留上限提到 800，同时补记原生路径的合并采样密度、时间线区分合成事件与原始事件、自检新增「补投/采样」比值指标。v2.8.15：胶囊面板里的「笔迹自检」入口默认隐藏（功能代码全部保留，需要时把 PENDIAG_ROW_VISIBLE 改回 true，或直接调用 __MARVIS_FENBI_PEN__()）。v2.8.16 笔迹快照：撤销/反撤/清空后粉笔会把全部笔迹按当前笔色单色重画（笔画数据里没有颜色字段，多色是本脚本 ctx hook 画时改写的），现每笔收笔后拍画布位图快照入档，检测到粉笔重绘（轮询对比内容，实测其重绘晚到约 0.5s）就把对应时刻的彩色位图原样贴回，多色笔迹在撤销/清空后不再塌成一种颜色。v2.8.17 防闪遮罩：粉笔的重绘晚到约 0.5s，期间画布先是单色再被贴回彩色 → 用户看到闪一下别的颜色；现点击撤销/反撤的瞬间就把目标状态截图盖在画布上方（veil，pointer-events:none），粉笔的单色重绘被完全遮住，快照贴好后摘掉，全程无闪。v2.9.2 修分栏草稿三个致命问题：① 组壳自己带着行内 !important（width:100%/left:auto）把样式表压死，组壳停在静态位置、宽 1905px，右栏连带滑块被推出视口 —— 用户看到的「右面被裁剪」「没有拖动按钮」都是它；现改用行内 setProperty 把 left/right/width 钉在视口上，看门狗每 700ms 按一次。② 画布原来铺满整栏还吃事件，右边选项点不动、手指也滚不动；现画布 pointer-events:none，事件改挂滚动容器：手指=原生滚动/点选，笔=写字（仅在本会话见过 pointerType=pen 时区分），抬笔后 420ms 内的 click 一律吞掉防误点。③ 顶部草稿栏补回笔色三圆点与粗细 A−/A+（原笔色面板在页面 header 上被顶栏盖住），右栏内容加 max-width:100% 治横向撑破，滑块 7px→12px 并加 26px 透明热区，不能滚时也显示淡色轨道。v2.9.3 分栏列宽自适应：不再写死左右比例，按「屏幕宽度 + 这一组内容」现算——屏越窄越把空间让给题目（<720 给右栏 60%），材料里有图/表左边加权，选项被折成多行右边加权，夹在 30%~60% 之间并保每侧最小宽；转屏/改窗口自动重算。分隔条手拖过就记住比例（localStorage），顶栏新增「⇔」按钮一键回到自适应（手动态按钮变橙色提示）。v2.9.4 修分栏草稿「触摸冲突 + 笔断触」：① 手指一律完全交还原生——不再用接触面宽度去猜笔，实测 CDP 与部分 WebView 把手指 width 也报成 1~2px，猜错的代价是手指滑动被 preventDefault 吃掉、页面 body 反而滚了 385px 而两栏纹丝不动，还顺手画出一道线；现在只有 pointerType=pen（或显式开 localStorage[marvis-app-touchpen]=1）才写字。② 进入分栏时锁住 html/body 滚动并给两栏加 overscroll-behavior:contain，栏内滚到底不再链式带动页面。③ 断触根因是收笔严格比对 pointerId，浏览器一笔内换 id 或手掌触发 pointercancel 就永久漏收，此后每一笔都被「已有笔画」挡掉；现按指针类型收尾并允许一笔内换 id。④ 合并采样补点（getCoalescedEvents 逐点 0.5px 去重），快速运笔不再出现折角与空隙。⑤ 抬笔后吞 click 改为「只吞落在刚写的笔画 bbox 上」的，用笔点选项不会再点不动；单点（笔点选项）不再被当成一笔。v2.9.5 胶囊面板里的「分栏草稿 APP式」改为默认打开（只有显式关过才记成关闭），不再需要先去面板里翻开关。v2.9.6 修 v2.9.4 带进来的两个回归（同根）：① 两栏的 touch-action 从 pan-y pinch-zoom 改回 auto —— touch-action 在 pointerdown 之前就替浏览器承诺了「这个手势是平移」，之后 preventDefault 收不回来；iPad 上 Apple Pencil 拖动本身就是可滚动手势，于是笔一落就被拿去滚屏、pointer 流随即 pointercancel、笔画只剩 1 个点被丢弃，用户看到的正是「用笔写也变成触摸的了」；同一份声明还会让 iOS 在 -webkit-overflow-scrolling:touch 的内层容器上整块失效，手指划不动、只剩拖滚动条。② 新增两条兜底：笔写期间把栏位 scrollTop 钉住（任内核把笔当滚动也退回去），手指滚动走「原生优先 + 失效接管」——先观察原生是否真的滚，只有连续 140ms 手指移动而 scrollTop 不动时才由脚本自己算 scrollTop 并补惯性，原生正常的设备一根手指都不碰。v2.9.7 按「笔只写字、绝不拖页面」这条底层语义重做手势分工：两栏内容区 touch-action 改为 none （浏览器在这些容器上彻底不做手势滚动，笔的 pointer 流不会再被抢走导致 pointercancel 断笔），手指滚动改由脚本全权负责（1:1 跟手 + 抬手惯性，移动不足 8px 仍算点击所以选项照常点得动，笔及其 touch 兼容流一律不参与），两个滚动条的拖动不受影响、手指和笔都能拖；另加兜底：个别不认 touch-action 的内核若原生仍在滚，检测到 scrollTop 被外部改走就立刻交还控制权，绝不与原生抢。v2.9.8 补「手指不许穿透」：分栏草稿展开后是一张盖在题目上的纸，笔在上面写、手指只负责滚（含拖两侧滚动条），不该顺手点到下面那一层的选项 / 收藏错题 / 子题 tab —— 之前把手指完全交还原生，等于纸是透明的，手掌一搭就把答案改了；现在在滚动容器捕获阶段断掉触摸的 pointerdown 与随后合成的 click，笔与鼠标一律放行（笔点选项照常有效），顶栏与两颗滚动条不受影响；同时把 setPointerCapture 从 pointerdown 推迟到「真的开始画」之后——指针捕获会把随后合成 click 的 target 改成滚动容器，导致笔点选项永远点不中（这是 v2.9.4 起就存在的隐蔽问题）。v2.9.9 按「草稿打开后手和笔完全一样」重定稿：不再按 pointerType 分流 —— 落在内容区的任何指针（手指、笔、鼠标左键）一律写成笔迹，pointerdown 与合成 click 都在滚动容器捕获层截住，下面的选项 / 收藏错题 / 子题 tab 一个也收不到；内容区彻底没有手势滚动（touch-action:none + touchmove 兜底），滚动只剩两个入口：左右两侧的滚动条，手指和笔都能拖。同步把「触摸当笔」开关、手指滚动接管（跟手/惯性/原生判定）整段删掉，改为单一语义，并保留 Apple Pencil 双路指针去重（pen 一到就丢弃先到的 touch 笔画，避免两条交错的线）。v2.9.10 修分栏草稿「书写断触」：① 每 700ms 的看门狗在笔写期间不再量画布尺寸、不再整屏重绘 —— appSizeSide 会把画布高度临时压成 0 去量内容高，栏位 scrollHeight 一抖、scrollTop 被夹回去，iPadOS 看到滚动就把笔的指针流 pointercancel 掉；而 appRedraw 又会清空画布重画，那时正在写的这一笔还没进 acts，等于把写到一半的墨迹抹掉。② 重绘时把「正在写的这一笔」一并补画，任何一次重绘都不再吃掉在写墨迹。③ pointercancel 不再当抬笔：系统 cancel 之后常用新的 pointerdown 把笔交回来，以前一 cancel 就收笔、新 down 又开一笔，一条连续的线被切成一段一段；现在 cancel 只摘滚动手闸并标成孤儿笔，下一次 down 落在上一笔落点 48px 内就续着画同一笔，离得远才收尾。④ 去掉「多指只认主指」的准入 —— 手掌在屏上时它会误挡笔，而「笔接管触摸笔画」那条规则已经足够拒绝第二支指针。v2.9.11 分栏草稿的答题按钮全部搬进顶栏：分栏打开后内容区就是一张纸，里面的 ABCD 字母盒与 标记/草稿/收藏 三个图标全被自家的纸挡住点不动，现顶栏加一颗题号按钮（自动跟随右栏滚动显示当前子题，如「117.▾」），点开是答题面板——本组五道题各一行，行内直接点 A/B/C/D 作答（走原生 label 路径，判分对错与重选回填口径不变）、点题号把右栏滚到那道题、行尾带 标记 与 收藏 两个图标代点原生按钮；点字母只改答案不跳画面，点空白处收起。内容区里那排失效的字母盒与三个图标在分栏模式下一并隐藏（退出分栏自动恢复）；资料分析组内的「下一题」按钮去掉（五题堆在同一栏靠滚动翻，普通单选题照旧保留）。为了让面板代点的原生 click 能穿过自家的纸，新增 appClickBypass 放行计数。v2.9.12 ① 分栏草稿里把每道题的 ABCD 字母盒放回内容区并让它真能点 —— v2.9.11 为了「搬到顶栏」把它整排藏了，用户反馈「这里连按钮都没有了」；字母盒是脚本自己注入的 UI，现在进纸的白名单（appInOwnUI），点头母只作答不落笔，合成 click 走 appAllowOnce 双层放行，按钮也放大到 30px 好按。顶栏题号面板照旧保留（标记/收藏仍在面板里）。② 修「点左上角叉退出后被送回第一题」：进分栏时把 html/body 的 overflow 锁成 hidden，WebKit 顺手把文档滚回 0，而五道子题在展平模式下是页面上顺排的，一退出页面就停在最上面。现在退出前记住正在看的那道子题，退出后按它的绝对位置把页面滚回去（原生 tab 模式则切回对应 tab 并滚容器）。v2.9.13 分栏草稿里把 ABCD 字母盒与标记/草稿/收藏三个图标彻底隐藏，并把「笔写到题目左上角就断」修掉：v2.9.12 把字母盒放回内容区还给到 z-index:260，它盖在画布（z-index:5）上面 —— 笔落上去时命中盒子、被判成「点了自家的 UI」而不落笔，从旁边写过来的墨迹又被它整片遮住，看着就是笔一触到那块就断；现在字母盒用 display:none 完全退出布局与命中，画布 z-index 提到 60（题内任何注入元素都压不住墨迹），纸的白名单只留顶栏/两颗滚动条/答题面板，并把内容区里的原生控件统一设成 pointer-events:none —— 笔落在题目里的任何位置（题号、题干、选项、图标原位）都是写字。答题改走顶栏题号按钮弹出的面板（点字母作答、点题号跳题、行尾标记/收藏）。v2.9.14 把「分栏默认打开」真正落到实处：以前只是开关默认开，实际还得手动点题旁的笔图标才会进分栏，用户以为开着、其实在写粉笔原生草稿 —— 原生草稿只覆盖它自己那一小块，写到别处就断，看着就是「这块没有草稿覆盖着」；现在资料分析组一进视口就自动进分栏（用户点 × 主动关掉的组本次页面会话不再自动进，刷新后恢复；结构不支持或打开抛错只试一次并 toast 报错），另外看门狗发现顶栏被页面重渲染干掉时会自动重建，不再出现「分栏还在、按钮没了」。v2.9.15 修分栏草稿里「那块区域写不出 / 写的字像被什么挡住」—— 真凶是粉笔页面上常驻的透明覆盖层：实测在选项上做 elementFromPoint，命中的是 div.modal-overlay 这类铺满区域的空壳（z-index 动辄 1000+）。① 落笔监听从「滚动容器」提到 document 捕获层，落点只按坐标归属到左栏/右栏 —— 覆盖层盖在哪儿都拦不住，以前这类区域 pointerdown 的传播路径绕开了滚动容器，我们根本收不到事件，那块地方怎么写都不出墨；② 画布 z-index 60 → 2147483100（组壳已把整块钉在 2400 这一档，画布在组内取最高），任何页面覆盖层都压不住墨迹，以前墨迹被透明/半透明覆盖层整片遮住，看着就是「有东西挡住我的字」；③ 画布高度改量「真实内容最底部」（一路往最后一个可见后代钻）而不是宿主的 scrollHeight —— 宿主在 flex 布局里会被压成一屏高，内容溢出却不撑高 scrollHeight，画布只铺一屏，往下滚到第 117/118 题再写就落在画布外面；同时按边长自动把 dpr 降到 1，避开 iOS canvas 16.7M 像素上限。v2.9.16 按用户要求收掉三处冗余：① 取消「资料分析组一进视口就自动进分栏」—— 这是 v2.9.14 自作主张加的，现在回到「点题旁的笔图标才进分栏」；② 胶囊设置面板里的「资料分析 · 1拖5」开关已隐藏（板块恒为开启，存量存过 0 的会被清掉，免得面板里没有开关、板块却静悄悄不工作）；③ 分栏顶栏的「笔」「橡皮」两颗按钮隐藏 —— 橡皮从未实现（disabled、点了没反应），笔是唯一模式、恒亮，两者都是空操作；列宽自适应按钮与粗细数值照旧保留。v2.9.17 把「答题入口 + 草稿纸」并成一层：顶栏原来那颗「117.▾」按钮和它弹出的五行面板整个删掉，改成五颗题号按钮（一道题一颗，segmented 紧凑样式，竖屏 768/810 也放得下）——点谁滚到谁，并弹出那道题专属的草稿纸；纸是半透明白（约 90%）的浮层，纸头一行就是这题的 ABCD / 标记 / 收藏，×收起、拖纸头移动、右下角拉大小（位置大小存 localStorage，换题不重置）。每题的笔迹分开存（localStorage 里 sheets[题号]），撤销/反撤/清空作用于「眼前这张纸」；纸收起时仍按旧语义作用于左右两栏。纸跟着当前题走：滚动到下一题，纸就换成下一题的（笔写期间有滚动闸，不会滚）。v2.9.18 纸头再添两颗：①「调大小」—— 点一下进入调整模式，纸的四角与四边中点长出 8 个手柄，拖任一手柄自由改大小（对角锚定，最小 340x220），再点一次完成并存盘；默认尺寸同时放大（1180 屏 542x492 → 661x542）；②「不透明度」—— 点一下换一档 85% → 70% → 55% → 42%，默认由 90% 降到 70%（用户嫌 90% 不够透），档位存 localStorage。v2.9.17 存下的尺寸若等于当年的默认值（说明没人手动调过）会自动换成新默认，手动调过的一律原样保留。v2.9.19 尺寸从「拖手柄自由调」改成三档（用户定稿：默认最大档铺满屏幕，另有中档、小档），纸头那颗调大小图标换成「小 中 大」三颗分段按钮 —— 点哪档就换哪档，当前档高亮，档位存 localStorage（默认「大」）；大档铺满顶栏下方整块并去掉圆角边框，中档 = v2.9.18 的默认尺寸，小档再小一圈；v2.9.18 的 8 个手柄与右下角三角整套删除（两套并存会互相打架）；拖纸头仍可移动，且每档各记一个位置。v2.9.20 纸头两行 + 三颗笔迹键 + 做题状态可见：① 撤销/反撤/清空 搬进纸头的第二行（以前只能伸手去顶栏按，写到最后一行够不着），没得撤时自动置灰；② 纸头分成两行——第一行「题号 + ABCD + ×」，第二行「小中大 | 不透明度 | 撤销 反撤 清空 | 标记 收藏」，小档 380px 也放得下；③ 标记 / 收藏 已开时图标填成实心并转成蓝色（原生 li 上挂 .active，纸头读它同步），点完不再「没有一点互动的感觉」；④ 修「点开 125 号题的纸、顶栏题号却亮着 123」：滚到底时当前题认作最后一道，且纸开着时顶栏高亮跟着纸上那一道走。v2.9.21 纸头按需折行 + 蓝色框线 + 两套撤销彻底分家：① 工具条不再硬折两行——h1（题号+ABCD）与 h2（三档/透明度/撤销反撤清空/标记收藏/×）是 flex-wrap 的两个子项，装得下就一行、装不下才落到第二行（小档才需要），中档宽度同时放宽到 0.58vw（最小 430）；② 纸头所有框线统一成蓝色（字母框、三档分段、图标描边都对 #2F5BEA），跟顶栏一致；③ 顶栏那三颗（撤销/反撤/删除）从此只控制左右两栏那张大画布，纸头那三颗只控制眼前这张纸，两套历史各算各的（此前纸一开、顶栏三颗也跟着改指纸）。 v2.9.22 修「点开 125 的纸却显示 123」：根因是我自己加的「纸跟着当前题走」——开纸后的滚动/尺寸重算把「当前题」算回上一道，纸被悄悄换掉（连带顶栏改号）。现在纸只由点题号决定，不再被自动改写；顶栏高亮改成按题号字符串匹配（Angular 换节点也不丢），且开纸时先刷高亮再刷纸头（纸头刷新抛错也不会把高亮留在旧题上）。另外修「纸开着 A 题、在 B 题的位置点 B 题被当成点自己而收纸」——现在正常换纸。 v2.9.23 防误触（默认只认笔 + 一颗手写开关）：手掌/手指落在纸面或两栏上不再落墨 —— 默认只有 Apple Pencil（和鼠标左键）能写，手指碰纸仍然什么都不透过去，但纸头按钮、拖纸头、两颗滚动条、顶栏照旧用手指按；要手指写字就点顶栏那颗 ✋（橘色=已打开，选择记住）。同时修掉一个老毛病：笔正在写时手掌在 0.7 秒后落下会把这一笔截断、还另画一道 —— 现在笔写期间手指/手掌一律让路，既不落墨也不打断。
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
//     的 bottom 相对 .ti 顶部），top 固定 0，解析展开时 .ti 变高不拉伸画布；
//     每次扫描幂等校准高度，退出重开草稿后自动恢复锁定高度。
//  ④ 页面加载后自动批量打开所有题的草稿（点击 li.draft.tool）；
//     自动打开每题只尝试一次，用户手动关闭后不会被重新打开。
//  ⑤ 「笔刷设置」面板：笔色黑（默认）/蓝/红三色切换 + 粗细滑块（0.4×~4× 无级）；
//     默认内联显示在页面顶部「设置」按钮左侧（锚点 app-setting，插到其前一个兄弟位置，
//     与工具栏同一行）；锚点始终缺失时才兜底为左下角 fixed（答题卡 z-index 500 会遮挡，
//     故 fixed 不作常驻位置），锚点出现后自动挪回工具栏。
//     通过 hook CanvasRenderingContext2D 的 strokeStyle / fillStyle / lineWidth / arc
//     作用于 canvas#draft，改写时保留原有 alpha（预览 0.1 / 终稿 1）；
//     只影响绘制调用，不写页面状态、不改动上面 ①~④ 的任何逻辑。
//  ⑥ ABCD 按钮本身变色：点击后按判分结果显示绿/红（背题），做题模式无判分时显示深蓝。
//  ⑦ 退出重进回填：页面重新渲染时按 DOM 既有状态给按钮补色——
//     已判分看 div.input-radio 的 correct/correctLost/wrong；未判分（做题选中）多信号识别：
//     input.checked 属性 / checked 内容属性 / aria-checked / div.input-radio 与 label 的
//     selected 类。粉笔选中样式是 input:checked + .input-radio 兄弟选择器、本身不加 class，
//     但重进恢复可能走 setAttribute / class / aria 等路径（property 赋值不产生 childList
//     变化，childList-only 的 MutationObserver 完全看不到——做题模式不回填的根因），
//     因此补：setter hook + change 捕获 + MO 属性级监听（checked/class/aria，按题精准同步）
//     + 前 30s 持续定时补偿 + pageshow / visibilitychange / focus 生命周期兜底。
//  ⑧ 资料分析「一拖五」支持（v2.3.0，基于 2026-10-23 实测结构）：
//     组 = 一个 div.ti，内部 app-resizable 左右分栏：左 .left-section > app-materials
//     （材料，页面无草稿入口）；右 .questions-anchors（a.tab#nav0..4 受控 tab）
//     + .questions-container（5 个 app-ti.question-multiple 预渲染堆叠、容器滚动切换，
//     tab 点击只切 active 类、不滚动容器）。子题不是 .ti，旧版「一个 .ti = 一道题」
//     的假设在组上全面失效（盒只装第一个子题 / 按钮映射错题 / 下一题跳过组内子题 /
//     组级原生草稿 absolute 覆盖全组、吃掉全部指针事件——「不可用」的直接原因）。
//     现按组作用域重构：
//       - 每个子题独立注入字母盒（含下一题）与草稿画布，tab 切换即就位；
//       - 「下一题」优先推进组内下一个 tab（并自行滚动 questions-container），组末才进下一题；
//       - 材料区配独立草稿画布（B2）：absolute 覆盖整个材料、可完全打开、五题共享，
//         笔迹按归一化坐标存 localStorage、退出重进自动重放；带「演算/穿透」切换
//         （穿透模式下可选中/复制材料文字）与两步确认的「清空」；
//       - 组级原生草稿直接隐藏（实测无副作用；粉笔重载会自动恢复打开，故每次扫描都压制）。
//  ⑨ 性能护栏（v2.3.0）：110 题全开画布在低配/软件渲染环境 tile 内存超限卡死（实测复现）。
//     草稿与自制画布改为只在题目接近视口（上 0.6 / 下 1.6 屏）时才自动创建，滚动即按需补开；
//     字母盒与回填（廉价）仍保持全量就绪。控制台 __MARVIS_FENBI_OPEN_ALL__() 可强制全开。
//  ⑩ 材料智能适应（v2.4.0 引入缩放；v2.7.0 升级为三层自适应）：
//     材料画布工具条「适应」按钮 = 一键让整块材料一屏完整显示、文字尽量大：
//       L1 缩放：CSS zoom 布局级缩放 + 宽度补偿，可读性下限 55%；
//       L2 宽度：缩放低于 GOOD(0.82) 时自动收窄材料栏（直接设左栏宽度，实测 Angular
//         不重置）——图表 max-width:100% 随栏变矮、材料整体变矮，从而在 100%（或更高
//         缩放倍率）下完整显示；正文文字不缩只重排。分隔条本就可供用户手动拖，此处是
//         程序化代拖；
//       L3 兜底：最窄栏(420px) + 下限缩放，仍装不下则提示滚动查看剩余部分。
//     关键修复（旧版量错地方白点）：真实高度锁在内层 .material-body（固定高 +
//     overflow:auto，内容 901px 裁在 572px 盒里），宿主 scrollHeight 被内层裁成盒高
//     → 算出缩放比 ≥1 直接不缩（用户反馈「点了没反应」的根因）。现在先解锁内层滚动盒
//     再量（取子树最大 scrollHeight）；锁态布局下还会连带把该组高度链展平让内容能流动，
//     还原时若展平由适应触发（用户关了全局展平）则一并收回。
//     另一修复：zoom 继承会二次缩放子孙 px 长度（实测 computed 1751px 渲染成 1051px），
//     画布 CSS 高度改按 视觉高/zoom 设置，缩放态下画布仍满覆盖材料。
//     缩放/栏宽偏好按组存 localStorage，切题重进自动恢复并重新断言。
//  ⑪ 一拖五「解锁盒子」（v2.6.x，按用户澄清迭代）：痛点本源是盒子高度写死 70vh
//     （.resizable-container / .nz-resizable.left 内联 height:70vh），5 道子题只能盒内
//     滚动翻题。做法（v2.6.2 定稿）：**保持左右两栏**（材料在左向下延伸、题目在右向下
//     延伸，页面整体滚动），只解锁高度（relaxCol：height auto / max-height none，
//     仅 absolute/fixed 层连带解锁宽度/偏移）；两栏宽度不动（左栏 615px、分隔条保留
//     可拖）；tab 栏隐藏；questions-container overflow visible；子题逐层解锁宽度
//     （relaxEl，原始 style 存 data-marvis-relax 供还原）；expandScrollBoxes 解除组内
//     残留内滚盒子；expandAncestorBoxes（v2.6.3）把组外祖先滚动壳一并解除——SPA 的
//     滚动可能发生在任意祖先层，只展开组内仍会被外层壳兜住；body/html overflow
//     hidden 时显式放开。材料画布/子题画布照常，「下一题」组内推进 = 页面滚动。
//     默认开启；控制台 __MARVIS_FENBI_FLATTEN__() 切换（持久化），__MARVIS_FENBI_DIAG__()
//     输出结构自检（含祖先壳链路）。
//  ⑫ 脚本总开关（v2.6.6）：底部水印条样式的胶囊（「粉笔自动全开草稿 / 粉笔脚本君出品 /
//     脚本 开 · v版本」三段同字体同字号 15px，蓝／灰／绿三色），点按 = 整个脚本开/关
//     （刷新生效；关闭态不注入任何功能，胶囊是唯一重新入口）。
//     画布默认模式按类型且不记忆（v2.7.6 起）——材料默认「当前可书写」（写写画画），
//     子题默认「当前可触摸」（题目区常需滚动/点选），每次打开/刷新都按此重置；
//     「穿透」改名「当前可触摸」；两档按钮文案均为短词，
//     用户切到「当前可书写」时顶部弹全句提示：材料=「材料区域草稿已打开，当前可书写，
//     不可触摸。」，子题=「第N题的题目区域草稿已打开，当前可书写，不可触摸。」；
//     切到「当前可触摸」同样弹（…已让位，当前可触摸，不可书写。）；
//     胶囊字体 15px → 7.5px（用户要求减半，v2.6.7）；v2.6.8 曾对齐水印栏改回 15px
//     （状态+版本文字缩为 10px）；v2.7.3 用户反馈「占的地方太大」再次减半——主文字
//     7.5px、状态+版本 5px，padding 6px 12px→3px 6px、gap 10px→5px、圆角 10px→5px
//     等比缩，占地约 350×34 → ~172×18；画布工具按钮字号保持 12px。
//  ⑬ 材料工具条改顶部通栏 band + 左栏吸顶（v2.7.1，用户两个实测痛点）：
//     痛点1「左边三个按钮把材料文字挡了」：材料工具条（当前可书写/适应/清空）从
//     悬浮右上角改为钉在材料顶部的通栏 band（白底+下边框），材料内容用
//     .marvis-mat-host .material-body 的 padding-top 让位——按钮有独立一行，不再压字；
//     痛点2「滚右侧小题时材料要一直完整贴在左边」：两栏延伸形态下左栏
//     position:sticky（top=固定页头高+8），align-self:flex-start 中和 flex 拉伸
//     （否则左栏被拉到右栏等高、sticky 无行程），max-height 收进视口、装不下时
//     栏内 overflow-y:auto 自滚；滚过组内最后一题（分栏容器底边过去）后自然释放
//     随页面滚走。配套修复：cvMeasure 量尺寸时不再无脑 removeProperty('align-self')
//     （会把吸顶样式抹掉），改为原样写回；expandScrollBoxes 跳过吸顶栏。
//  ⑭ 修复「材料显示不全」（v2.7.2，用户实测：图片/文字都显示不全）：
//     根因（真机 CDP 去因实验定位）：v2.7.1 为打断 flex 拉伸链给材料链五层写了
//     flex:0 0 auto + align-self:flex-start——flex-basis:auto 让各层按内容
//     max-content 宽度排布，材料文字 max-content 1664px 时整条链被撑到 1704px，
//     而左栏只有 996px，overflow-x:hidden 把右半全部裁掉（文字横切、表格/图片横切）。
//     修复：链上各层显式 width:100%（宿主按当前 zoom 补偿 100/s%，且不用 !important，
//     cvZoomApply 的补偿值要能覆盖）+ min-width:0 + box-sizing:border-box——横向恒等
//     栏宽（拖分隔条/适应收窄时跟随重排），纵向拉伸链修复不受影响；另加 CSS 规则
//     .materials-container img/table/svg{max-width:100%} 让超宽素材收缩适应
//     （覆盖 Angular 动态渲染的新素材）；cvZoomApply 还原时 width 固定回 100%
//     （置空会退回 max-content 排布再次撑爆）。
//     同批修复（真机实测）：① cvMeasure 量尺寸时宿主宽度也不能置空（同样触发
//     max-content：文字材料整块不换行塌成一行，1196px 被量成 ~250px → 误判「装得下」
//     不缩放），固定 100% 量可见排版下的真实高度；② 被栏宽钳制的媒体(图片/表格，
//     渲染宽≈栏宽)缩放会被宽度补偿抵消（媒体随补偿放大回原尺寸）——这类材料优先走
//     L2 收窄（往往 100% 装下），必须缩放时不做补偿，让缩放真正生效。
//     二批修复（v2.7.2 收尾，真机 CDP 定位）：③ L2 收窄档位去重写反（w<=lastW
//     continue）——档位比值递减，第一档之后全部被跳过，高图材料只量一档就收尾、
//     最优窄档永远摸不到；改为「没有变得更窄才跳」。④ 补偿三处复活路径封死：
//     stickLeftCol 每次重扫都按 zoom 重算补偿（不认媒体标记会把 '100%' 覆盖回
//     100/s%，图被横向裁出栏外 271px）；cvFitRestoreState 在适应成功后被
//     cvToast 触发的全量重扫二次施加（此时 zoom 已生效，探测器坐标系不一致会假阴性）
//     ——加「已在目标状态不重复断言」门（含拖栏采纳新宽）+ 用户拖动分隔条后采纳
//     新栏宽不被还原；cvHasWidthBoundMedia 改 zoom 归一（测量前临时摘 zoom），
//     任何调用时机可跑，自愈路径随之闭合（刷新后图片才到达：先按文字口径补状态，
//     图到位后自愈撤补偿、补标记，不再横向裁切）。
//  ⑮ 左下角「答题卡」折叠把手全透明（v2.7.4，用户反馈小白卡挡题面文字）：
//     白卡不是背景色而是 .answer-card-tag 内 SVG path 的 fill/stroke（另有一条
//     ::after 白条），只能 CSS 褪；折叠/展开是 fixed 容器 transform 位移——不增删
//     节点不挂类（MutationObserver 无声），三态类名又完全相同，没有状态类可钩；
//     且展开态下该 tag 就是答题卡面板头部，一概全透会穿帮。故按容器位置
//     （rect.top ≥ 视口高 = 折叠态）打 .marvis-ac-clear 类只透折叠态：
//     scan() 内调用 + 400ms 轮询兜底。该把手是全页唯一答题卡入口，只褪色不隐藏。
//  ⑯ 资料分析「适应」按钮默认就是适应而非百分之百（v2.7.5，用户要求）：
//     原来每次扫描都从 localStorage 恢复上次的缩放/收窄，打开资料分析题（含切题
//     重渲染）按钮直接显「100%」、材料被自动缩放。cvFitRestoreState 改为不再恢复：
//     打开即原始 100%，要缩放用户自己点；按钮文字只按 DOM 实际状态校正（点了适应
//     再被 cvToast 触发的全量重扫时文字不能错）；顺手清掉旧版遗留的持久化键。
//  ⑰ 资料分析子题「整页草稿纸」（v2.7.7，用户要求：可书写区从题目框扩到整页，
//     且明确只在资料分析生效，别的题型不许变）：
//     子题画布锚在题目框里、书写区只有「单选题这一篇」。fpEligible 的画布
//     （仅资料分析组内子题——普通题走粉笔原生草稿、材料画布本就通栏，都不动）
//     切到「当前可书写」时展开 body 级透明全屏层，整页即这道题的草稿纸。
//     机制（真机 CDP 实验 4/4 验证，tools/cdp-research-fp.js）：
//       ① 层 fixed inset:0 + pointer-events:none——对 HitTesting 完全隐身，
//          手指滚动/点击/选答案全部原生直达页面（实测轻点穿透到
//          choice-radio-label、拖动 scrollY 0→235）；
//       ② window 捕获层监听 pointerdown：笔/鼠标落笔时 setPointerCapture 到层内
//          canvas（捕获可打在 pointer-events:none 元素上，move/up 照达——实测
//          pen/mouse 均全程出字）+ preventDefault/stopPropagation 抢在原生处理器前；
//       ③ 鼠标点到按钮(button/label/radio…)不捕获→原生点击；笔在按钮上轻点
//          (短按小位移)转发一次 click 并丢掉该点——平板上用笔点答案不误画；
//       ④ 我们自己的悬浮控件(工具条/笔刷面板/胶囊/答题卡) closest 排除，保持可点。
//     工具条收进右上角常驻胶囊（题目工具条会随滚动离开视口，退出/清空要随时够得着）。
//     笔迹按题独立存储（复用 sub-<key>，归一化到视口），刷新保留、模式照旧不记忆；
//     旧版题目框坐标系的笔迹首次展开时按框位置重映射进视口坐标系，老笔迹不丢。
//  ⑱ 修复「适应后材料右侧仍被裁」+ 画布模式不再记忆（v2.7.6，用户实测反馈）：
//     问题A（裁剪根因，真机 CDP 定位）：v2.7.2 给缩放加的宽度补偿 100/s% 是错的——
//     Blink 的 zoom 模型里百分比宽度在被缩放元素的自身坐标系解析：探针实测（父 600px）
//     width:100%+zoom:0.858 视觉宽恰 600px（本已铺满），width:116.55%+zoom:0.858
//     视觉宽 699px=600/0.858。补偿让宿主视觉宽=栏宽/s，右侧溢出 (1/s-1)×栏宽 被
//     .left-section 的 overflow-x:hidden 裁掉（真机：s=0.858 时视觉 1161px vs
//     栏宽 996px，右 165px 被裁——即用户报「材料图片还是会被裁剪」）。修复：
//     cvZoomApply/stickLeftCol 缩放时宽度恒 100%，补偿与 CV_NOCOMP_ATTR 机制
//     整体删除（cvHasWidthBoundMedia 保留：媒体布局宽被钳在栏宽/zoom 上，视觉尺寸
//     恒由栏宽决定、zoom 缩不动它——「优先 L2 收窄」的策略结论不变）。
//     问题B（模式记忆）：画布模式原来从 localStorage 恢复（用户切过一次就记住）。
//     改为不读不依：材料画布恒默认「当前可书写」，题目画布恒默认「当前可触摸」，
//     每次打开/刷新都按类型重置（笔迹存取不受影响）。
//  ⑲ 整页草稿态锁定滚动 + 删材料区草稿 + 删红框提示 + 笔迹落盘坐标修正（v2.7.8）：
//     ① 整页草稿打开时，笔书写和手指滚动冲突（写写画画时页面被带着滚）。
//        定稿：可书写态 = 纯书写状态，页面不许滚。实现上**不用** html/body
//        overflow:hidden——文档滚动容器一消失 Chrome 会把 scrollY 钳回 0，
//        用户正在看的那道题瞬间跳走（真机实测 42934→0）；而且粉笔自己的 JS
//        还会把 html 行内 style 重写成「overflow-y:auto !important」盖回来。
//        改为 document 捕获层拦 touchmove + wheel（passive:false），页面停在原位、
//        手指拖不动、滚轮也不滚；笔的 pointer 流不受影响（书写照常），轻点也
//        不受影响。弹窗文案同步改为「当前整个页面都可书写，页面滚动已锁定」。
//     ② 材料区的「可书写/可触摸」按钮 + 画布整个删除（整页草稿已覆盖材料书写，
//        按钮无用）；「适应」是独立功能保留，材料工具条只剩「适应」一个按钮。
//     ③ 草稿范围淡红框提示删除（用户觉得没用）：fpHintRect/fpHintViewport/
//        fpHintSub/fpScanHints 及 CSS 全部移除。
//     ④ 修 v2.7.7 的笔迹落盘 bug（真机 E2E 才发现）：fpFinish 把 [x,y] 数组当
//        对象读（p.x/p.y → NaN → JSON 存成 null），结果「当次会话看得见、刷新后
//        全丢」；这些 null 再被 fpMigrate 迁移会压成同一个常量点，整笔退化成一点。
//        修正为下标读取；存储版本升到 v=2 标记「已迁移到视口坐标」（原先迁移标记
//        只在内存，刷新即丢 → 每次重开又迁一次、笔迹越跑越偏）；加载时
//        cvSanitize 清洗历史坏数据（丢 null 点、丢所有点重合的坏笔）。
//  ⑳ 整页草稿两态化 + 工具条不再飞右上角（v2.7.9，用户 iPad 实测反馈）：
//     ① 工具条留在原地：用户「非得把当前可触摸这个按钮移动再点击变成当前可书写后，
//        就要飞到右上角吗？我觉得停留在原地就挺好的」——右上角常驻胶囊(pill)整体
//        删除，toggle/清空永远留在题目工具条原位。书写态滚动已锁、按钮必在视口内，
//        不需要再靠胶囊兜「够得着」。
//     ② 可触摸 = 锁定态而非退出：会话仍然开着（笔迹照旧显示），但页面只放行
//        这道题的 ABCD + 下一题 + 清空 + 本切换按钮，其余点击一律吃掉
//        （用户：「别的按钮应该都覆盖掉」）。实现用 document 捕获层 click 过滤
//        （放行我们自己注入的 .marvis-lbox/.marvis-lbtn/.marvis-next 与工具条），
//        不遮罩、不改布局、不影响滚动；只拦可信(isTrusted)的真实点击，页面
//        自己的程序化点击照常。
//     ③ 可书写态手指点按无效并提示「当前不可触摸」（用户要求）：pointerdown +
//        touchstart 双保险拦掉手指（preventDefault touchstart 才能确保不合成
//        click），只有工具条（切换/清空）放行——否则退不出去。
//     ④ 退出会话：长按切换按钮 650ms，或点「下一题」（换题即退出）。退出后
//        页面完全恢复普通态，笔迹已落盘，回来点「当前可触摸」可再开。
//  ㉑ 草稿竖条：切换/清空/退出收进「原生草稿工具条」形态（v2.8.0，用户 iPad 反馈）：
//     用户原话「把『当前可触摸』和『当前可书写』集成到原生那个草稿按钮吧，然后清空
//     也集成到原生的这个草稿按钮中；当前可书写时弹出『当前不可触摸』这个弹窗没用，
//     取消掉」。实测（tools/cdp-probe-native-draft*.js）：资料分析组的原生草稿是
//     **整组一条**（.ti > .draft-container > app-draft > canvas#draft + .tools-container，
//     撤销/反撤/橡皮/清空/退出），且被本脚本整体隐藏（组级画布会吃掉全组指针事件）；
//     每道子题自己的「草稿」入口是 .title-right > li.draft.tool（笔图标）。
//     所以：
//     ① 子题宿主不再挂任何悬浮小白按钮（toggle/清空全删），改为一条与原生同款
//       （#3c464f 深色、竖排、贴屏幕右边缘、12px 圆角、20px 描边图标 + 11px 白字）
//       的「草稿竖条」#marvis-fp-dock，只放这套草稿真正用得上的三项：
//         当前可书写 / 当前可触摸（切换）· 清空（两步确认）· 退出
//       竖条 position:fixed 右侧居中——原生那条是绝对定位钉在题目顶部的，长题滚下去
//       就够不着了，钉屏幕才能随时按。
//     ② 入口 = 原生草稿笔图标（li.draft.tool，每道子题一个）：点它打开这道题的整页
//       草稿（document 捕获层拦掉粉笔自己的组级草稿逻辑），再点一次即退出；会话所属
//       那道题的图标高亮（.marvis-fp-pen-on）。普通题的笔图标完全不动（照旧开原生草稿）。
//     ③ 可书写态手指点按从「拦截 + 弹提示」改为**静默拦截**（用户：弹窗没用，取消掉）。
//     ④ 锁定态白名单扩到：ABCD / 下一题 / 竖条 / 本题草稿图标；别处点击照旧吃掉并
//       提示「当前只可点 ABCD / 下一题 / 右侧草稿按钮」。
//     ⑤ 出口变明确：竖条「退出」按钮（替代 v2.7.9 的长按 650ms）、再点草稿图标、
//       或点「下一题」，三条路都退出会话并立即落盘。
//  ㉒ v2.8.1 修 v2.8.0 的越界（用户：这功能只能在一拖五用，别把别的题也改了）：
//     `app-ti.question-multiple` 是**全站题目**的组件名——普通单题也是它（真机实测
//     第 1~8 题全是），v2.8.0 用 `closest('app-ti.question-multiple')` 当子题判据，
//     结果普通题一按草稿笔图标也被拽进整页草稿 + 冒出一条右侧竖条。
//     现在唯一判据是 fpGroupOfSub()：所在的 .ti 必须含 .materials-container /
//     .questions-anchors（与 processTi 建画布口径完全一致），并且
//     fpPenEntry / fpToggleSession / ensureSubCanvas 三处都上这道闸；
//     scan() 还会自愈清掉 v2.8.0 误建在普通题上的 fpEligible 画布（cvPurgeStrayFp）。
//  ㉓ v2.8.2 右下角胶囊改成**可展开的设置面板**（用户：「帮我做一个可以展开的……再给我
//     加一个选项，就是我可以停掉资料分析这种 1 拖 5 类似的板块的功能」「再搞一个全部
//     关闭」）：点胶囊 = 展开/收起（不再点一下就刷新），面板两行开关：
//       ① 资料分析 · 1拖5 → localStorage `marvis-fb-group`，关掉 = 该板块完全不介入
//          （processTi 组分支直接 return：不隐藏原生组草稿、不展平、不加字母盒、
//          不建材料画布；fpGroupOfSub 同时返回 null，整页草稿/竖条/笔图标一律不受理）；
//       ② 全部题目 → `marvis-fb-enabled`（原总开关 =「全部关闭」）。
//     两个开关都走刷新生效（半途拆装会留下内联样式/属性残渣）；胶囊状态串会显示
//     「脚本 开 · 分析关 · v2.8.2」，一眼能看出当前是部分关闭。
//  适配：MutationObserver（childList + 属性级 checked/class/aria）+ rAF 节流与按题精准同步，
//        覆盖 SPA 增量渲染与属性级作答恢复；
//        注入以「题号 + 版本戳」为 key 去重，元素复用渲染新题、脚本升级时自动重建。
//
(function () {
  'use strict';
  // ---------- 脚本总开关 + 分栏草稿开关 ----------
  // 右下角胶囊 = 设置入口（v2.8.2 起不再「点一下就刷新」）：点它展开/收起面板。
  // 面板现在只有两行可见开关：
  //   ① 全部题目：关掉 = 整套脚本不注入（原来的总开关，也就是「全部关闭」）；
  //   ② 分栏草稿 APP式：关掉 = 不进左右分栏，回到粉笔原生草稿。
  // v2.9.16：「资料分析 · 1拖5」那一行已隐藏（用户：这个开关已经没用了）——
  //   行还留在 DOM 里（display:none）以便老结构对齐，但点了不做任何事，
  //   groupEnabled() 恒返回 true，存量 `marvis-fb-group=0` 会被清掉。
  var MASTER_LS = 'marvis-fb-enabled';
  var GROUP_LS  = 'marvis-fb-group';    // v2.8.2：资料分析（1拖5）板块开关（v2.9.16 起恒开）
  var SCRIPT_VER = '2.9.23';

  /* v2.8.15：胶囊面板里「笔迹自检」那一行的显示开关。
     平时=false（面板里看不到这一行），但功能代码一行没删：
       · 控制台/地址栏调 __MARVIS_FENBI_PEN__() 照样能出诊断 JSON
       · 需要重新露出来时，把这里改成 true 即可（不用动别处） */
  var PENDIAG_ROW_VISIBLE = false;

  /* ---------- v2.8.12 跨世界实例守卫 ----------
     问题的来源：Via 这类「自带脚本注入器」的浏览器（iOS 版 = WKWebView 壳），
     注入语义和 Tampermonkey 不同：
       · 可能把用户脚本注入到**独立的 content world**（JS 全局不与页面共享，
         但 DOM 共享）→ 我们在 window 上装的捕获监听与页面里的粉笔原生草稿
         **互不可见**，stopPropagation 也拦不住对方 → 同一次书写被两个画者
         各画一遍 → 屏幕上就是「两条交错的线」；
       · 也可能在同一次页面加载里**重复注入**两次 → 两个实例各建一层画布、
         各抢各的 fpPen → 笔画被拆到不同画布上。
     修法：守卫标记写在 **DOM 属性**上（DOM 跨 content world 共享，JS 全局不共享），
     同版本重复注入直接退出，保证「页面上永远只有一个实例、一个画者」。 */
  var INST_ATTR = 'data-marvis-fb-inst';
  try {
    var _instRoot = document.documentElement;
    if (_instRoot) {
      if (_instRoot.getAttribute(INST_ATTR) === SCRIPT_VER) {
        return; // 同版本已有实例在跑 → 本次注入直接退出
      }
      _instRoot.setAttribute(INST_ATTR, SCRIPT_VER);
    }
  } catch (e) {}
  function masterEnabled() {
    try { return localStorage.getItem(MASTER_LS) !== '0'; } catch (e) { return true; }
  }
  /* v2.9.16：胶囊面板里的「资料分析 · 1拖5」开关已隐藏（用户：这个开关已经没用了）。
     板块因此恒为开启。存量里存过 '0' 的一并清掉 —— 面板里已经没有这个开关了，
     再让那个 0 生效就是「明明什么都没关、资料分析却什么增强都没有」的隐形故障。
     真要退回去用粉笔原生：关「全部题目」（MASTER_LS）或关「分栏草稿 APP式」。 */
  function groupEnabled() {
    try {
      if (localStorage.getItem(GROUP_LS) === '0') localStorage.removeItem(GROUP_LS);
    } catch (e) {}
    return true;
  }
  function chipReload() {
    try { location.reload(); } catch (e) {}
  }
  // 面板里一行开关的样式/文案同步（浅绿=开，灰=关，整行无效时压暗）
  function chipSetRow(row, on, effective) {
    if (!row) return;
    var sw = row.querySelector('.mv-sw');
    if (sw) {
      sw.textContent = on ? '开' : '关';
      sw.style.background = on ? '#E8F5E9' : '#F1F3F5';
      sw.style.color = on ? '#3B6D11' : '#8A9099';
    }
    row.style.opacity = effective ? '1' : '.45';
    row.style.pointerEvents = effective ? 'auto' : 'none';
  }
  function chipSync(el) {
    var on = masterEnabled();
    var t3 = el.querySelector('.mv-t3');
    if (t3) {
      /* v2.9.16：不再有「分析关」这个状态（板块开关已隐藏、板块恒开） */
      var txt = (on ? '脚本 开' : '脚本 关') + ' · v' + SCRIPT_VER;
      if (t3.textContent !== txt) t3.textContent = txt;
      t3.style.color = on ? '#3B6D11' : '#9AA0A8';
      t3.style.fontWeight = '600';
    }
    var p = el.querySelector('#marvis-flat-panel');
    if (p) {
      chipSetRow(p.querySelector('.mv-row[data-k="all"]'), on, true);
      chipSetRow(p.querySelector('.mv-row[data-k="appmode"]'), appModeOn(), on);
    }
    el.title = '点按展开/收起设置：可关闭「分栏草稿 APP式」，或全部关闭';
  }
  /* v2.9.5：面板结构版本号。每次改面板行（增删）就改一下这里。
     原因：masterChip 以前「已有 #marvis-flat-chip 就直接复用」，但复用只拿到旧 DOM ——
     同一页面里先跑过一次脚本（脚本热更新 / 旧实例残留 / SPA 未刷新）时，
     后来新增的行（分栏草稿、笔迹自检）就永远不会出现在面板里，用户翻不到开关。 */
  var CHIP_STRUCT = 'r5';   // r5（v2.9.16）：隐藏「资料分析 · 1拖5」行
  function masterChip() {
    var el = document.getElementById('marvis-flat-chip');
    if (el && el.getAttribute('data-mchip') !== CHIP_STRUCT) {
      try { el.remove(); } catch (e) {
        try { el.parentNode && el.parentNode.removeChild(el); } catch (e2) {}
      }
      el = null;
    }
    if (!el) {
      if (!document.body) { // document-start 兜底：等 body 就绪再挂
        if (document.addEventListener) document.addEventListener('DOMContentLoaded', masterChip);
        return;
      }
      el = document.createElement('div');
      el.id = 'marvis-flat-chip';
      el.setAttribute('data-mchip', CHIP_STRUCT);
      // 样式对齐粉笔底部水印条：「粉笔一页成卷 / 粉笔脚本君出品」那条的观感
      // v2.8.2：胶囊尺寸/字号保持原样（面板是它的绝对定位子元素，不撑大胶囊）
      el.style.cssText = 'position:fixed;right:10px;bottom:66px;z-index:2147483000;' +
        'display:inline-flex;align-items:center;gap:5px;max-width:calc(100vw - 20px);' +
        'padding:3px 6px;border-radius:5px;background:rgba(248,249,250,.97);' +
        'border:1px solid #E4E6EB;box-shadow:0 2px 10px rgba(0,0,0,.08);' +
        'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;' +
        'font-size:10.5px;font-weight:600;line-height:1.3;letter-spacing:.01em;' +
        'cursor:pointer;user-select:none;-webkit-user-select:none;';
      el.innerHTML =
        '<span class="mv-t1" style="color:#2F5BEA;font-weight:700;">粉笔自动全开草稿</span>' +
        '<span class="mv-t2" style="color:#9AA0A8;font-weight:500;">粉笔脚本君出品</span>' +
        '<span class="mv-t3" style="font-size:8px;"></span>' +
        '<span class="mv-caret" style="font-size:9px;color:#9AA0A8;margin-left:1px;">▾</span>' +
        // 展开面板：向上弹（胶囊贴在屏幕右下，下面没有空间）
        '<div id="marvis-flat-panel" style="position:absolute;right:0;bottom:100%;margin-bottom:5px;' +
          'display:none;flex-direction:column;min-width:158px;padding:4px 6px 3px;border-radius:6px;' +
          'background:#fff;border:1px solid #E4E6EB;box-shadow:0 6px 18px rgba(0,0,0,.14);' +
          'font-size:12px;font-weight:600;color:#2B2F36;cursor:default;text-align:left;' +
          'user-select:none;-webkit-user-select:none;">' +
          '<div class="mv-row" data-k="group" style="display:none;align-items:center;' +
            'justify-content:space-between;gap:10px;padding:3px 0;line-height:1.5;">' +
            '<span class="mv-lbl" style="white-space:nowrap;">资料分析 · 1拖5</span>' +
            '<span class="mv-sw" style="min-width:16px;text-align:center;border-radius:999px;' +
              'padding:0 5px;font-size:11px;font-weight:700;line-height:15px;">开</span>' +
          '</div>' +
          '<div class="mv-row" data-k="all" style="display:flex;align-items:center;' +
            'justify-content:space-between;gap:10px;padding:3px 0;line-height:1.5;' +
            'border-top:1px solid #F1F3F5;">' +
            '<span class="mv-lbl" style="white-space:nowrap;">全部题目</span>' +
            '<span class="mv-sw" style="min-width:16px;text-align:center;border-radius:999px;' +
              'padding:0 5px;font-size:11px;font-weight:700;line-height:15px;">开</span>' +
          '</div>' +
          '<div class="mv-row" data-k="appmode" style="display:flex;align-items:center;' +
            'justify-content:space-between;gap:10px;padding:3px 0;line-height:1.5;' +
            'border-top:1px solid #F1F3F5;">' +
            '<span class="mv-lbl" style="white-space:nowrap;">分栏草稿 APP式</span>' +
            '<span class="mv-sw" style="min-width:16px;text-align:center;border-radius:999px;' +
              'padding:0 5px;font-size:11px;font-weight:700;line-height:15px;">关</span>' +
          '</div>' +
          '<div class="mv-row" data-k="pendiag" style="' +
            (PENDIAG_ROW_VISIBLE ? 'display:flex;' : 'display:none;') + 'align-items:center;' +
            'justify-content:space-between;gap:10px;padding:3px 0;line-height:1.5;' +
            'border-top:1px solid #F1F3F5;">' +
            '<span class="mv-lbl" style="white-space:nowrap;">笔迹自检</span>' +
            '<span class="mv-sw" style="min-width:16px;text-align:center;border-radius:999px;' +
              'padding:0 5px;font-size:11px;font-weight:700;line-height:15px;' +
              'background:#F1F3F5;color:#2F5BEA;">查看</span>' +
          '</div>' +
          '<div class="mv-tip" style="font-size:10px;font-weight:500;color:#9AA0A8;' +
            'padding-top:3px;border-top:1px solid #F1F3F5;line-height:1.4;">' +
            '关闭后刷新页面生效</div>' +
        '</div>';
      // 点胶囊本体 = 展开/收起面板（旧版是「点一下就关脚本」，v2.8.2 改成入口）
      el.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var p = el.querySelector('#marvis-flat-panel');
        if (!p) return;
        var open = p.style.display === 'flex';
        p.style.display = open ? 'none' : 'flex';
        var caret = el.querySelector('.mv-caret');
        if (caret) caret.textContent = open ? '▾' : '▴';
        el.setAttribute('data-open', open ? '0' : '1');
      });
      // 面板两行：各自独立的开关，改完刷新
      [].slice.call(el.querySelectorAll('.mv-row')).forEach(function (row) {
        row.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var k = row.getAttribute('data-k');
          if (k === 'pendiag') {
            // v2.8.12：笔迹自检（不改任何设置，只弹诊断面板）
            try { penDiagOverlay(); } catch (e) { /* 诊断失败不惊动页面 */ }
            return;
          }
          if (k === 'group') return;   // v2.9.16：这一行已隐藏（板块恒开），点了不做任何事
          if (k === 'appmode') {
            // v2.9.0：分栏草稿开关——即改即生效，不用刷新
            if (!masterEnabled()) return;
            try { localStorage.setItem(APP_LS, appModeOn() ? '0' : '1'); } catch (e) {}
            if (!appModeOn() && appCur) appClose(true);
            chipSync(el);
            return;
          }
          // 剩下只有「全部题目」（总开关）：关掉 = 整套脚本不注入
          try { localStorage.setItem(MASTER_LS, masterEnabled() ? '0' : '1'); } catch (e) {}
          chipReload();
        });
      });
      // 点空白处收起（capture：整页点击过滤器 stopPropagation 也挡不住它）
      if (!document.__marvisChipOutside) {
        document.__marvisChipOutside = 1;
        document.addEventListener('click', function (ev) {
          var c = document.getElementById('marvis-flat-chip');
          var p = c && c.querySelector('#marvis-flat-panel');
          if (!p || !c || c.contains(ev.target)) return;
          if (p.style.display === 'flex') {
            p.style.display = 'none';
            var caret = c.querySelector('.mv-caret');
            if (caret) caret.textContent = '▾';
            c.setAttribute('data-open', '0');
          }
        }, true);
      }
      document.body.appendChild(el);
    }
    chipSync(el);
  }
  // 自检/单测入口：按当前 localStorage 重画胶囊与面板开关状态（不注入任何功能）
  window.__MARVIS_FENBI_CHIP__ = masterChip;
  if (!masterEnabled()) { masterChip(); return; } // 关闭态：不注入任何功能，只留设置入口
  if (window.__MARVIS_FENBI_ENHANCE__) return;
  window.__MARVIS_FENBI_ENHANCE__ = true;
  masterChip();

  var DLOCK_ATTR = 'data-marvis-dlock';
  var AUTO_ATTR  = 'data-marvis-autoopen';
  var BOX_ATTR   = 'data-marvis-boxkey';
  var BOXVER_ATTR = 'data-marvis-boxver'; // 盒子结构版本戳：升级换代时强制重建
  var BOX_VER    = '2';                   // v2：下一题支持组内子题推进
  var CV_ATTR    = 'data-marvis-cv';      // 自制画布标记（材料/子题）
  var CV_VER     = '1';
  var HIDE_ATTR  = 'data-marvis-hidden';  // 被本脚本压制（组级原生草稿）
  var FPGRP_ATTR = 'data-marvis-fpgroup'; // 一拖五组（整页草稿会话的作用域标记）

  /* ---------- 样式 ---------- */
  var STYLE_ID = 'marvis-fenbi-enhance-style';
  // 版本戳：脚本升级（无刷新重注入 / 旧版残留）时样式也要跟着换，
  // 否则新 CSS 被 ID 守卫跳过——曾因此丢掉 .marvis-pen 的 position:absolute，
  // 画布退化成 flex 项把宿主撑爆、高度滚雪球（E2E 实测复现）。
  var STYLE_VER_ATTR = 'data-marvis-style-ver';
  var oldStyle = document.getElementById(STYLE_ID);
  if (oldStyle && oldStyle.getAttribute(STYLE_VER_ATTR) === SCRIPT_VER) {
    // 同版本已注入，跳过
  } else {
    if (oldStyle) oldStyle.remove(); // 旧版残留：整块换掉
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.setAttribute(STYLE_VER_ATTR, SCRIPT_VER);
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
      /* 修复：草稿画布 .draft-container(z-index:130) 绝对定位会盖住右上角工具条，
         导致「标记 / 收藏 / 草稿」按钮不可点击；把 ul.title-right 层级提到画布之上(140) */
      'ul.title-right{position:relative;z-index:140;}',
      '.draft-tool .draft-tool-mark{display:none!important;}',
      /* ⑤ 笔刷设置面板 */
      '.marvis-brush-panel{position:fixed;left:20px;bottom:20px;z-index:400;display:flex;align-items:center;gap:5px;',
      'box-sizing:border-box;padding:2px 5px;border-radius:8px;background:rgba(255,255,255,.96);',
      'border:1px solid rgba(0,0,0,.12);box-shadow:0 2px 10px rgba(0,0,0,.15);',
      'font-size:12px;line-height:1;color:#333;font-family:inherit;user-select:none;}',
      /* inline 模式：插在顶部 app-setting 之前（header-right 行容器），覆盖 fixed 定位 */
      '.marvis-brush-panel.mbp-inline{position:static;display:flex;align-items:center;gap:5px;flex:0 0 auto;align-self:center;height:30px;margin-right:8px;white-space:nowrap;box-shadow:none;border:1px solid rgba(0,0,0,.1);padding:2px 5px;}',
      '.marvis-brush-panel .mbp-dot{box-sizing:border-box;width:15px;height:15px;padding:0;border-radius:50%;',
      'border:2px solid transparent;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18);cursor:pointer;}',
      '.marvis-brush-panel .mbp-dot-on{border-color:#3b6ef0;box-shadow:0 0 0 2px rgba(59,110,240,.25);}',
      '.marvis-brush-panel .mbp-range{width:70px;margin:0;cursor:pointer;}',
      '.marvis-brush-panel .mbp-val{min-width:30px;text-align:right;color:#666;}',
      /* ⑥ ABCD 点击反馈按钮本身变色 */
      'button.marvis-feedback-correct{background:#00a05a!important;color:#fff!important;border-color:#00a05a!important;}',
      'button.marvis-feedback-wrong{background:#e02020!important;color:#fff!important;border-color:#e02020!important;}',
      'button.marvis-feedback-selected{background:#1a3f8f!important;color:#fff!important;border-color:#1a3f8f!important;}',
      /* ⑧ 自制画布（材料草稿 / 子题草稿）：z-index 130 与原生草稿同级，
         字母盒 260、题目工具条 140 仍在其上；touch-action 避免触摸绘制时滚动页面 */
      '.marvis-pen{position:absolute;left:0;top:0;z-index:130;touch-action:none;}',
      '.marvis-cv-tools{position:absolute;right:8px;z-index:260;display:flex;gap:6px;user-select:none;}',
      /* 材料工具条：通栏 band 钉在材料顶部（不再悬浮压住材料文字），
         材料内容用 .marvis-mat-host .material-body 的 padding-top 让位 */
      '.marvis-cv-tools-top{top:0;left:0;right:0;height:auto;justify-content:flex-end;',
      'background:#fff;border-bottom:1px solid #e8e8e8;padding:4px 8px;box-sizing:border-box;}',
      '.marvis-mat-host .material-body{padding-top:34px !important;}',
      /* v2.7.2：材料内超宽素材(图片/表格/SVG)收缩到栏宽——栏宽由分隔条拖动或
         「适应」收窄决定，素材不收缩就会被左栏 overflow-x:hidden 裁掉右半
         （实测：表格/图片/文字全部显示不全的根因之一）。用规则而非行内样式，
         Angular 动态渲染出来的新素材同样生效 */
      '.materials-container img,.materials-container table,.materials-container svg{max-width:100%!important;}',
      '.materials-container img{height:auto!important;}',
      /* v2.7.4：左下角「答题卡」折叠把手全透明（用户反馈小白卡挡题面文字）。
         白卡不是背景色，是 .answer-card-tag 内 SVG path 用 fill/stroke 画的，
         另有一条 ::after 白条——三处都要褪。只褪折叠态（JS 按容器位置打
         .marvis-ac-clear 类）：展开态这个 tag 就是答题卡面板的头部，必须保持原样。
         该把手是全页唯一答题卡入口，只褪色、不隐藏、不拦点击 */
      '.marvis-ac-clear .answer-card-tag .answer-card-tag-icon path{fill:transparent!important;stroke:transparent!important;}',
      '.marvis-ac-clear .answer-card-tag .answer-card-tag-icon{filter:none!important;}',
      '.marvis-ac-clear .answer-card-tag::after{background:transparent!important;}',
      '.marvis-cv-tools-bottom{bottom:6px;}',
      '.marvis-cv-tools .marvis-cvbtn{box-sizing:border-box;width:auto;min-height:22px;margin:0;padding:3px 8px;',
      'border-radius:4px;border:1px solid #3b6ef0;background:#fff;color:#3b6ef0;',
      'font-size:12px;line-height:1.35;text-align:center;cursor:pointer;white-space:normal;max-width:300px;',
      /* v2.7.9：切换按钮要长按退出，禁掉长按选中/系统菜单（iPad 上长按文字会弹菜单） */
      'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;}',
      '.marvis-cv-tools .marvis-cvbtn:hover{background:#3b6ef0;color:#fff;}',
      '.marvis-cv-tools .marvis-cvbtn-on{background:#3b6ef0;color:#fff;}',
      '.marvis-cv-tools .marvis-cvbtn-warn{background:#e02020;border-color:#e02020;color:#fff;}',
      /* v2.7.7 整页草稿层（仅资料分析子题）：透明全屏层对 HitTesting 隐身，
         只靠 window 捕获层 + setPointerCapture 收笔/鼠标。
         v2.7.9：右上角胶囊(pill)整体删除——工具条留在题目原地不再飞走。 */
      '#marvis-fp-layer{position:fixed;inset:0;z-index:2147481000;pointer-events:none;}',
      '#marvis-fp-layer canvas{position:absolute;left:0;top:0;width:100%;height:100%;touch-action:none;}',
      /* v2.8.0 整页草稿「草稿竖条」：仿粉笔原生草稿工具条（撤销/橡皮/清空/退出那条）的
         深色竖排样式，贴屏幕右边居中常驻。用户要求把「当前可触摸 / 当前可书写」和
         「清空」都收进草稿按钮区，不要另外两个悬浮小白按钮。 */
      '#marvis-fp-dock{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482000;',
      'display:none;flex-direction:column;width:64px;box-sizing:border-box;padding:6px 0;',
      'border-radius:12px 0 0 12px;background:#3c464f;box-shadow:0 2px 12px rgba(0,0,0,.3);',
      'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;}',
      '#marvis-fp-dock.on{display:flex;}',
      '#marvis-fp-dock .marvis-fpd-item{display:flex;flex-direction:column;align-items:center;gap:2px;',
      'width:100%;margin:0;padding:7px 2px;border:0;background:transparent;cursor:pointer;',
      'color:rgba(255,255,255,.62);font-family:-apple-system,"PingFang SC",sans-serif;',
      'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;}',
      '#marvis-fp-dock .marvis-fpd-item+.marvis-fpd-item{border-top:1px solid rgba(255,255,255,.08);}',
      '#marvis-fp-dock .marvis-fpd-item:active{background:rgba(255,255,255,.1);}',
      '#marvis-fp-dock .marvis-fpd-item.on{color:#fff;}',
      '#marvis-fp-dock .marvis-fpd-item.warn{color:#ff8b7d;}',
      '#marvis-fp-dock .fpd-ico{display:block;width:20px;height:20px;}',
      '#marvis-fp-dock .fpd-name{display:block;font-size:11px;line-height:13px;letter-spacing:0;',
      'white-space:nowrap;text-align:center;}',
      /* 会话归属提示：当前这道题的草稿笔图标高亮（再点一次即退出整页草稿） */
      'li.draft.tool.marvis-fp-pen-on{color:#3b6ef0!important;}',
      'li.draft.tool.marvis-fp-pen-on svg{fill:#3b6ef0!important;}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* 页面整体左右各缩 20px */
  if (!document.getElementById('marvis-page-pad')) {
    var pp = document.createElement('style');
    pp.id = 'marvis-page-pad';
    pp.textContent = '.ti{margin:0 40px!important}';
    document.head.appendChild(pp);
  }

  /* ---------- ⑤ 笔刷设置：笔色 + 粗细 ---------- */
  /* 原理：粉笔在每一笔绘制前都会实时写入 ctx.strokeStyle / fillStyle / lineWidth，
     主路径的粗细由 arc() 半径决定；因此 hook 这些 setter / arc 即可在不改页面状态、
     不碰 strokeStack 与 sessionStorage 的前提下控制笔色与粗细。
     风险：颜色不落库，切换笔色后旧笔迹会在下次重绘时同步变色（无法逐笔分色）。 */
  var BRUSH_LS_KEY = 'marvis-fenbi-brush';
  var brushColor = '#000000';   // 默认黑色（页面自带浅色主题默认笔色为红）
  var brushWidth = 1;           // 粗细倍率：lineWidth 与 arc 半径共用

  try {
    var savedBrush = JSON.parse(localStorage.getItem(BRUSH_LS_KEY) || 'null');
    if (savedBrush) {
      if (typeof savedBrush.color === 'string' && /^#[0-9a-f]{6}$/i.test(savedBrush.color)) brushColor = savedBrush.color;
      if (typeof savedBrush.width === 'number' && isFinite(savedBrush.width)) {
        brushWidth = Math.min(4, Math.max(0.4, savedBrush.width));
      }
    }
  } catch (e) { /* 隐私模式等场景下 localStorage 不可用，忽略即可 */ }

  function saveBrush() {
    try { localStorage.setItem(BRUSH_LS_KEY, JSON.stringify({ color: brushColor, width: brushWidth })); } catch (e) {}
  }

  // 仅作用于草稿画布：id 为 draft 或带 pen 类（廉价判断，避免拖慢书写）
  function isDraftCtx(ctx) {
    var c = ctx && ctx.canvas;
    if (!c) return false;
    return c.id === 'draft' || (c.classList && c.classList.contains('pen'));
  }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    if (isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // 只替换 RGB，保留原值的 alpha（预览 0.1 / 终稿 1）；无法识别的值（如渐变对象）原样放行
  function brushPaint(v) {
    if (typeof v !== 'string') return v;
    var alpha = 1;
    var m = /^rgba?\(([^)]+)\)/i.exec(v.trim());
    if (m) {
      var parts = m[1].split(',');
      if (parts.length >= 4) {
        var a = parseFloat(parts[3]);
        if (!isNaN(a)) alpha = a;
      }
    } else if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v.trim())) {
      return v;
    }
    var rgb = hexToRgb(brushColor);
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
  }

  function installBrushHook() {
    var P = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
    if (!P || P.__marvisBrushHooked) return;
    try {
      P.__marvisBrushHooked = true;

      // 颜色：strokeStyle / fillStyle 必须成对 hook，否则预览段（fillStyle）会花斑
      ['strokeStyle', 'fillStyle'].forEach(function (name) {
        var d = Object.getOwnPropertyDescriptor(P, name);
        if (!d || !d.get || !d.set) return;
        Object.defineProperty(P, name, {
          configurable: true,
          enumerable: d.enumerable,
          get: function () { return d.get.call(this); },
          set: function (v) {
            d.set.call(this, isDraftCtx(this) ? brushPaint(v) : v);
          }
        });
      });

      // 粗细（短笔画路径）：只对画笔量级的线宽（页面硬编码 0.4）缩放，避开橡皮等其它用途
      var dLW = Object.getOwnPropertyDescriptor(P, 'lineWidth');
      if (dLW && dLW.get && dLW.set) {
        Object.defineProperty(P, 'lineWidth', {
          configurable: true,
          enumerable: dLW.enumerable,
          get: function () { return dLW.get.call(this); },
          set: function (v) {
            var out = v;
            if (isDraftCtx(this) && brushWidth !== 1 && typeof v === 'number' && v > 0 && v <= 1.5) {
              out = v * brushWidth;
            }
            dLW.set.call(this, out);
          }
        });
      }

      // 粗细（主路径）：粉笔用 arc() 逐点画圆，半径 = clamp(pressure*ratio, 2, 4)/2，即 1~2px；
      // 只缩放这一量级的半径，避免误伤橡皮/清空等大半径 arc 调用
      var oArc = P.arc;
      P.arc = function (x, y, r) {
        if (brushWidth !== 1 && isDraftCtx(this) && typeof r === 'number' && r > 0 && r <= 3) {
          var args = Array.prototype.slice.call(arguments);
          args[2] = r * brushWidth;
          return oArc.apply(this, args);
        }
        return oArc.apply(this, arguments);
      };
    } catch (e) { /* hook 失败不影响原有功能 */ }
  }

  installBrushHook();

  /* ---------- v2.8.16 笔迹快照：撤销/反撤/清空后还原每笔颜色 ----------
     根因（research/fenbi-draft-class.pretty.js 逆向确认）：粉笔的笔画对象只有
     {points, lineWidth, strokeType, lineWidthRatio}——【没有颜色字段】；绘制时的颜色
     由主题写死（浅色 rgba(255,0,0,·)）。笔刷面板的多色全靠我们的 ctx hook 在
     「画的时候」改写，所以像素一旦落盘就是对的；但撤销/反撤/清空后撤销会让粉笔把
     strokeStack 里的笔迹【全部按当前笔色重画一遍】→ 多色笔迹塌成一种颜色。
     拿不到草稿组件实例（生产构建 __ngContext__ 只是模块私有 Map 的 LView id，
     webpack require 也不暴露），所以不碰粉笔内部，改用位图快照：
       · 每笔画完（含橡皮）拍一张 PNG 快照按顺序存 hist；首个 pointerdown 再拍 base
       · 撤销 → cursor--；反撤 → cursor++；清空 → 截断后 push 空白（对齐粉笔栈语义）
       · 粉笔重绘完成后（下下帧）把 hist[cursor]（或 base）贴回画布——粉笔的
         strokeStack/stackPointer 完全不动，对它来说什么都没发生；每笔颜色回来了
     安全阀：
       · 只有「粉笔真的重绘了画布」（轮询对比快照内容）才贴；没动静就什么都不动
       · 书写中、画布尺寸变了、快照缺失（刷新前的旧笔迹）→ 不贴，保持粉笔的结果
       · 只管 app-draft 里的原生 canvas#draft；整页草稿层/材料画布不参与 */
  var SNAP_RING_MAX = 12;
  var SNAP_PUSH_DELAY = 300;  // 收笔后延迟拍快照：toDataURL 有 10~30ms 开销，不占书写路径
  var snapMap = (typeof WeakMap === 'function') ? new WeakMap() : null;

  function snapIsNative(cv) {
    return !!(cv && cv.id === 'draft' && cv.closest && cv.closest('app-draft'));
  }
  function snapRec(cv, create) {
    if (!snapMap) return null;
    var r = snapMap.get(cv);
    if (!r && create) {
      r = { hist: [], cursor: -1, base: null, live: false, moved: false,
            armed: null, armSeq: 0, veil: null };
      snapMap.set(cv, r);
    }
    return r || null;
  }
  function snapShoot(cv) {
    try { return cv.toDataURL('image/png'); } catch (e) { return null; }
  }
  function snapPush(cv, rec) {
    var url = snapShoot(cv);
    if (!url) return;
    if (rec.cursor >= 0 && rec.hist[rec.cursor] === url) return;  // 内容没变（点按等）不入档
    rec.hist = rec.hist.slice(0, rec.cursor + 1);   // 撤销后写新笔 = 粉笔截断栈，语义对齐
    rec.hist.push(url);
    if (rec.hist.length > SNAP_RING_MAX) rec.hist.shift();
    rec.cursor = rec.hist.length - 1;
  }
  function snapApply(cv, rec) {
    if (!cv.isConnected || rec.live) return;
    if (rec.cursor < -1 || rec.cursor >= rec.hist.length) return;
    var url = rec.cursor >= 0 ? rec.hist[rec.cursor] : rec.base;
    if (!url) return;
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    var img = new Image();
    img.onload = function () {
      snapVeilHide(rec);                            // 结果已落定（贴或放弃）→ 摘遮罩
      if (!cv.isConnected || rec.live) return;      // 用户已开始写新一笔 → 不贴
      if (img.width !== cv.width || img.height !== cv.height) return;  // 画布变尺寸 → 不贴
      try {
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0);
      } catch (e) { /* 贴失败就保持粉笔的结果 */ }
    };
    img.src = url;
  }
  /* v2.8.17 防闪遮罩（veil）：粉笔的撤销/反撤重绘晚到约 0.5s，期间画布先是单色的，
     等我们贴回彩色快照才恢复 → 用户看到「闪一下别的颜色」。
     现在点击的瞬间就把目标状态的截图 <img> 盖在画布正上方（pointer-events:none，
     不挡任何操作），粉笔的单色重绘被完全遮住；等我们的快照贴好再摘掉。 */
  function snapVeilShow(cv, rec, url) {
    if (!url) return;
    try {
      var host = cv.parentElement;
      if (!host) return;
      var img = document.createElement('img');
      img.setAttribute('data-marvis-snap-veil', '1');
      img.style.cssText = 'position:absolute;pointer-events:none;border:0;margin:0;padding:0;';
      host.appendChild(img);
      var cz = parseInt((cv.style && cv.style.zIndex) || getComputedStyle(cv).zIndex, 10);
      img.style.zIndex = (isNaN(cz) ? 0 : cz) + 1;
      var op = img.offsetParent || host;            // absolute 的包含块
      var orp = op.getBoundingClientRect();
      var r = cv.getBoundingClientRect();
      img.style.left = (r.left - orp.left) + 'px';
      img.style.top = (r.top - orp.top) + 'px';
      img.style.width = r.width + 'px';
      img.style.height = r.height + 'px';
      img.src = url;
      if (rec.veil && rec.veil.parentNode) rec.veil.parentNode.removeChild(rec.veil);
      rec.veil = img;
    } catch (e) { /* 盖不上就退回老路：闪一下但结果正确 */ }
  }
  function snapVeilHide(rec) {
    var v = rec.veil;
    if (v && v.parentNode) { try { v.parentNode.removeChild(v); } catch (e) {} }
    rec.veil = null;
  }
  function snapOnTool(it) {
    var host = it.closest('app-draft');
    var cv = host && host.querySelector('canvas#draft');
    if (!cv) return;
    var kind = it.classList.contains('undo') ? 'undo'
             : it.classList.contains('redo') ? 'redo'
             : it.classList.contains('empty') ? 'clear' : null;
    if (!kind) return;
    if (kind === 'undo' && it.classList.contains('cant-undo')) return;
    if (kind === 'redo' && it.classList.contains('cant-redo')) return;
    var rec = snapRec(cv, false);
    if (!rec) return;                               // 会话里没写过字 → 无档可还，维持现状
    /* v2.8.17：点击瞬间把目标状态预览成 veil 盖在画布上——只取画面，【不动游标】。
       游标仍按 v2.8.16 的语义在「确认粉笔动手了」之后移动：粉笔的重绘晚到约 0.5s，
       若点击时就移游标、而粉笔把动作排到了下一次点击之后，游标会漂移（E2E 实测踩过）。 */
    var target = null;
    if (kind === 'undo') {
      if (rec.cursor >= 1) target = rec.hist[rec.cursor - 1];
      else if (rec.cursor === 0 && rec.base) target = rec.base;
      // 深过快照档（cursor<0）：没有可预告的画面 → 不盖，走老路收编粉笔的单色结果
    } else if (kind === 'redo') {
      if (rec.cursor + 1 < rec.hist.length) target = rec.hist[rec.cursor + 1];
    }
    if (target) snapVeilShow(cv, rec, target);
    rec.armed = kind;
    var mySeq = ++rec.armSeq;
    /* 实测（ego-browser 真机 E2E）：粉笔的撤销重绘【不是同步的】——点击后 200ms 画布还是
       原样，400~600ms 才把 strokeStack 按单色重画完。所以不能「等一拍」就下结论，
       改成轮询对比画布内容：变了 = 粉笔动手了，2 秒还没变 = 它没理这次点击。 */
    var preUrl = snapShoot(cv);
    var tries = 0;
    var poll = function () {
      if (rec.armSeq !== mySeq) return;             // 更新的点击已接管
      if (rec.live) { rec.armed = null; snapVeilHide(rec); return; }   // 用户落笔了 → 放弃本次
      var nowUrl = snapShoot(cv);
      if (tries++ < 20 && nowUrl === preUrl) { setTimeout(poll, 100); return; }
      rec.armed = null;
      if (nowUrl === preUrl) { snapVeilHide(rec); return; }   // 粉笔没动手 → 只摘遮罩
      if (kind === 'clear') { snapPush(cv, rec); snapApply(cv, rec); return; }
      if (kind === 'undo') rec.cursor--;
      else if (kind === 'redo') rec.cursor++;
      if (rec.cursor < -1) {
        // 撤销已深过快照档（动到会话开始前的旧笔迹）：粉笔刚画好的结果几何是对的，
        // 把它收编为新 base（旧笔迹变单色无解），cursor 归位，之后继续一致
        var now = snapShoot(cv);
        if (now) rec.base = now;
        rec.cursor = -1;
        return;
      }
      snapApply(cv, rec);                           // 贴完（或放弃）时在 onload 里摘 veil
    };
    setTimeout(poll, 120);
  }
  function snapBind() {
    if (!snapMap) return;
    // 工具条按钮（撤销/反撤/清空）：捕获阶段先记账，粉笔的处理器随后自己跑
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var it = t && t.closest ? t.closest('app-draft .tool-item') : null;
      if (it) { try { snapOnTool(it); } catch (e) { /* 不惊动页面 */ } }
    }, true);
    // 落笔：建档 + 标记书写中（首笔前顺带拍 base，只发生一次）
    window.addEventListener('pointerdown', function (e) {
      var c = e.target;
      if (!c || c.tagName !== 'CANVAS' || !snapIsNative(c)) return;
      var rec = snapRec(c, true);
      if (!rec) return;
      if (rec.veil) snapVeilHide(rec);              // 用户接着写 → 立刻摘掉预览遮罩
      if (rec.live) return;
      rec.live = true;
      rec.moved = false;
      if (!rec.hist.length && rec.cursor === -1 && !rec.base) rec.base = snapShoot(c);
    }, true);
    // 移动：有位移才算真笔画（点按会被粉笔丢弃，不入档，否则游标错位）
    window.addEventListener('pointermove', function (e) {
      var c = e.target;
      if (!c || c.tagName !== 'CANVAS') return;
      var rec = snapMap.get(c);
      if (rec && rec.live) rec.moved = true;
    }, true);
    // 收笔：粉笔在 pointerup 处理器里同步画完最后一小段 → 稍后拍快照入档
    function up(e) {
      var c = e.target;
      if (!c || c.tagName !== 'CANVAS') return;
      var rec = snapMap.get(c);
      if (!rec || !rec.live) return;
      rec.live = false;
      var hadMoved = rec.moved;
      setTimeout(function () {
        if (rec.live || rec.armed || !hadMoved) return;  // 撤销在途/点按 → 不入档
        snapPush(c, rec);
      }, SNAP_PUSH_DELAY);
    }
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }
  snapBind();

  /* ---------- v2.8.9 平板笔迹「合并还原 + 补密 + 防切笔」（治「平板用笔只能画折线」） ----------
     背景（全部逆向自粉笔前端 chunk-Q3SELT5A.js 的 Draft 组件源码，逐字核对，非猜测）：
       ① 粉笔画笔迹 = 一串采样点，每个采样点画一个半径 1px 的圆（arc），
          点数 ≥4 时每 4 点一组做基数样条（cardinal spline）细分后连成曲线；
          点数 <4 时走 drawLine()（moveTo + 逐点 lineTo）= **纯直线**。
       ② 全站 chunk 搜不到 pointerType：粉笔完全不区分笔 / 手，
          二者唯一差别是【采样密度】+【有没有隐式指针捕获】。
       ③ 触摸指针有隐式捕获（Pointer Events 规范）→ 全程不触发 pointerout → 笔画不会被切；
          笔没有隐式捕获 → 一旦掠过画布上的覆盖元素（脚本注入的 ABCD 盒、粉笔工具条），
          pointerout 会冒泡到 app-draft → finishCurStroke() → 这一笔被【切成短段】，
          每段点数 <4 → 整段只剩直线（这才是「只会画直线」）。
     修法（全部在 window 捕获阶段做，不改粉笔的画法；笔迹仍由粉笔自己画，
           橡皮 / 撤销 / 笔色 / 落笔缓存全部照旧）：
       A. 合并还原：pointermove 里取 e.getCoalescedEvents()——浏览器因主线程繁忙而
          「合并」掉的中间采样全在里面。页面越重（一页成卷把版面撑大）合并越多，
          这一步直接把采样还原回手指级别，不用猜。
       B. 切线补密：没有合并事件（或合并后仍稀疏）时，沿行笔切线用二次贝塞尔补中间点，
          间距 ≈3 缓冲像素（粉笔圆点半径 1px），把「折线段」还原成「曲线」。
       C. 防切笔：笔在草稿范围内的 pointerout 一律拦下，笔画不再被切成短段；
          笔在草稿外抬笔时补发一个合成 pointerup，避免粉笔 pointerEventId 卡死。
     只处理 pen（鼠标采样本来就密；手指有隐式捕获，本来就不受影响）。 */
  var PEN_SYNTH = '__marvisSynth';
  var penTrack = null;        // {id, x, y, px, py, hasP, cv, n}：上一笔采样位置与方向
  var penStrokeCv = null;     // 当前笔画所在的原生草稿画布（防切笔 / 收笔兜底用）
  var penSynthN = 0;          // 本笔已补点数（总量护栏）
  var PEN_SYNTH_MAX = 40;     // 单个事件最多补多少点
  var PEN_STROKE_MAX = 800;   // 单笔最多补多少点（极端快速书写时防爆量）

  /* ---------- v2.8.12 笔迹事实采集（诊断用） ----------
     教训：同一份代码在 Safari 正常、在 Via 异常，说明**不能再靠猜浏览器怎么上报
     指针事件**。于是把事实采下来：
       · 每一路指针流（pointerType + pointerId）的 down/move/up 与采样点数
         —— 直接回答「到底有几路流同时在动、我们吃的是哪一路」
       · 合并采样密度（getCoalescedEvents 每次能拿回多少真实采样）
         —— 直接回答「这一笔到底采到几个点」
       · 各类丢弃计数（归属不符 / 重复点 / 回访点）
       · **原生草稿画布在我们书写期间像素有没有变** —— 直接回答
         「是不是两个画者同时在画」（像素跨 content world 共享，一定测得到）
       · 环境指纹：UA / maxTouchPoints / pointer 媒体查询 / 有没有见过 pen 事件
     出口有三处，保证在 Via 里也拿得到：
       ① window.__MARVIS_FENBI_PEN__()（脚本与页面同 world 时）
       ② <html data-marvis-pen-diag="...">（DOM 属性，跨 world 必定可读）
       ③ 胶囊面板「笔迹自检」浮层（用户点一下截图即可） */
  var penStat = {
    streams: {},        // 'type:id' -> {type, id, down, move, up, pts, ev}
    coalescedMax: 0, coalescedSum: 0, coalescedN: 0,
    rejected: 0, dup: 0, retrace: 0, pts: 0,
    strokes: 0, penSeen: false, mouseSeen: false, touchSeen: false,
    nativeChanged: null, nativeCanvases: 0,
    instMark: null, layerCount: 0, worldGuess: null,
    /* v2.8.13 新增（都是为了把「浏览器到底怎么投递指针事件」变成可读数据）：
       life     —— 指针生命周期台账：每次 pointerdown→pointerup 记一条
                   {id, type, t0, t1, n, x0,y0, x1,y1}
                   → 两段生命周期若起止点都几乎重合 = 同一物理笔画被投递了两次
                   （这是「一条笔画画成两条交错的线」的头号嫌疑）
       timeline —— 最近若干个指针事件的原始投递顺序（type/id/事件类型/坐标/时间戳）
       downIds  —— 已经 down 过的 pointerId 集合（用于判断「浏览器中途换了 pointerId」）
       synth / synthSkip —— 原生补密：实际补投了几个 / 因重复或陈旧被跳过几个
       fpLedger —— 我们自己画的每一笔的台账（点数、起止、时长） */
    life: [], timeline: [], downIds: {}, fpLedger: [],
    synth: 0, synthSkip: 0, tickSkip: 0, tailSkip: 0   // v2.8.14：tickSkip = 因「浏览器正在逐点投递」不补；tailSkip = 因「合并列表末尾不是当前事件」整批不补
  };
  var PEN_LIFE_MAX = 24;      // 生命周期台账条数
  var PEN_TIMELINE_MAX = 260; // 时间线事件条数
  var PEN_LEDGER_MAX = 16;    // 自绘笔台账条数

  function penStatStream(e) {
    if (!e) return null;
    var t = e.pointerType || 'unknown';
    var id = (e.pointerId === undefined || e.pointerId === null) ? 'x' : e.pointerId;
    var k = t + ':' + id;
    var s = penStat.streams[k];
    if (!s) { s = penStat.streams[k] = { type: t, id: id, down: 0, move: 0, up: 0, pts: 0, ev: 0 }; }
    if (t === 'pen') penStat.penSeen = true;
    else if (t === 'mouse') penStat.mouseSeen = true;
    else if (t === 'touch') penStat.touchSeen = true;
    return s;
  }

  // 原生草稿画布的像素指纹（24×24 降采样哈希）。
  // 跨 content world 也能测——像素是共享的，JS 全局不是。
  function penNativeFingerprint() {
    var out = {};
    var cvs = [];
    try { cvs = Array.prototype.slice.call(document.querySelectorAll('app-draft canvas')); } catch (e) { return out; }
    var tmp = null;
    for (var i = 0; i < cvs.length; i++) {
      var cv = cvs[i];
      if (cv.classList && cv.classList.contains('marvis-pen')) continue;
      var r = null;
      try { r = cv.getBoundingClientRect(); } catch (e2) {}
      if (!r || r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > (window.innerHeight || 0) ||
          r.right < 0 || r.left > (window.innerWidth || 0)) continue; // 只看视口内可见的
      var h = 0;
      try {
        if (!tmp) tmp = document.createElement('canvas');
        tmp.width = 24; tmp.height = 24;
        var tc = tmp.getContext('2d');
        if (!tc) continue;
        tc.clearRect(0, 0, 24, 24);
        tc.drawImage(cv, 0, 0, 24, 24);
        var d = tc.getImageData(0, 0, 24, 24).data;
        for (var k = 0; k < d.length; k += 4) {
          h = (h * 31 + d[k] + d[k + 1] * 3 + d[k + 2] * 7 + d[k + 3] * 11) | 0;
        }
      } catch (e3) { continue; }
      out[(cv.id || 'cv') + '#' + i] = h;
    }
    penStat.nativeCanvases = Object.keys(out).length;
    return out;
  }

  function penNativeDelta(a, b) {
    var changed = [];
    for (var k in b) { if (a[k] !== undefined && a[k] !== b[k]) changed.push(k); }
    for (var k2 in a) { if (b[k2] === undefined) changed.push(k2 + '(gone)'); }
    return changed;
  }

  // 只认粉笔自己的原生草稿画布；我们自建的 canvas.marvis-pen 不在其列（它自己走贝塞尔平滑）
  function isNativeDraftCanvas(el) {
    if (!el || el.tagName !== 'CANVAS') return false;
    if (el.classList && el.classList.contains('marvis-pen')) return false;
    if (el.id === 'draft') return true;
    try { return !!(el.closest && (el.closest('app-draft') || el.closest('.draft-container'))); }
    catch (e) { return false; }
  }

  // 组级原生草稿（一拖五）被脚本隐藏 → 那块由我们自建画布接管，不参与原生补密
  function draftCanvasUsable(cv) {
    if (!cv || cv.tagName !== 'CANVAS') return false;
    if (cv.classList && cv.classList.contains('marvis-pen')) return false;
    try {
      var dc = cv.closest ? cv.closest('.draft-container') : null;
      if (dc && dc.getAttribute(HIDE_ATTR) === '1') return false;
    } catch (e) {}
    return true;
  }

  // 事件目标 → 粉笔原生草稿画布。
  // 目标可能是画布本身，也可能是压在画布上的覆盖元素（我们注入的 ABCD 盒、粉笔工具条）：
  // 那种情况下 pointermove 仍然冒泡到 app-draft，粉笔照常画线（坐标按 canvas 换算），
  // 所以补密也必须继续做，否则一跨过覆盖元素就又变回采样稀疏的折线。
  function resolveDraftCanvas(el) {
    if (!el || el.nodeType !== 1) return null;
    var cv = null;
    if (isNativeDraftCanvas(el)) {
      cv = el;
    } else {
      var host = null;
      try { host = el.closest ? el.closest('app-draft') : null; } catch (e) {}
      if (!host) return null;
      try { cv = host.querySelector('canvas#draft') || host.querySelector('canvas'); } catch (e2) {}
    }
    return draftCanvasUsable(cv) ? cv : null;
  }

  // 指针是否还落在画布范围内（用来判断「只是掠过覆盖元素」还是「真的离开草稿区」）
  function pointerInCanvas(cv, e) {
    try {
      var r = cv.getBoundingClientRect();
      if (!r || !r.width || !r.height) return false;
      return e.clientX >= r.left - 1 && e.clientX <= r.right + 1 &&
             e.clientY >= r.top - 1 && e.clientY <= r.bottom + 1;
    } catch (err) { return false; }
  }

  // 合成一个指针事件（优先用原生 PointerEvent；无则退回普通 Event 补属性）
  function mkSynthPointer(type, opts) {
    var ev = null;
    try {
      if (typeof window.PointerEvent === 'function') {
        ev = new window.PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          pointerId: opts.pointerId, pointerType: opts.pointerType,
          clientX: opts.clientX, clientY: opts.clientY,
          screenX: opts.screenX, screenY: opts.screenY,
          pressure: opts.pressure, tiltX: opts.tiltX, tiltY: opts.tiltY,
          isPrimary: opts.isPrimary
        });
      }
    } catch (e) { ev = null; }
    if (!ev) {
      try {
        ev = document.createEvent('Event');
        ev.initEvent(type, true, true);
      } catch (e2) { return null; }
      for (var k in opts) { try { ev[k] = opts[k]; } catch (e3) {} }
    }
    try { ev[PEN_SYNTH] = true; } catch (e4) {}
    return ev;
  }

  // 把合成事件派发回原生草稿画布（冒泡到 app-draft → 粉笔的 onPointerMove 收到）
  function sendSynth(cv, type, e, x, y, pressure) {
    var ev = mkSynthPointer(type, {
      pointerId: e.pointerId, pointerType: 'pen',
      clientX: x, clientY: y,
      screenX: e.screenX, screenY: e.screenY,
      pressure: pressure, tiltX: e.tiltX, tiltY: e.tiltY,
      isPrimary: e.isPrimary === undefined ? true : e.isPrimary
    });
    if (!ev) return false;
    try { cv.dispatchEvent(ev); } catch (e2) { return false; }
    return true;
  }

  function penOnDown(e) {
    if (!e || e.pointerType !== 'pen') return;
    if (e[PEN_SYNTH]) return;
    var cv = resolveDraftCanvas(e.target);
    if (!cv) return;
    penTrack = {
      id: e.pointerId, x: e.clientX, y: e.clientY, px: 0, py: 0, hasP: false, cv: cv, n: 0,
      sent: [],   // v2.8.13：这一笔里「原生画布已经收到过的坐标」——补密幂等的依据
      t: (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0   // v2.8.14：逐点投递判据
    };
    penSentAdd(penTrack, e.clientX, e.clientY);   // 起笔点原生会自己收到
    penSynthN = 0;
    penStrokeCv = cv;
  }

  /* ---------- v2.8.13 原生补密幂等化 ----------
     旧写法（v2.8.7 起）假定「getCoalescedEvents() 返回的最后一个元素就是当前事件本身」，
     于是只补投 co[0..len-2]。这条假定只对 Safari / Chrome 成立。
     第三方 WebView 壳（Via = iOS 上的 WKWebView 壳）返回的列表可能是
       · 包含**已经作为独立事件投递过**的样本（旧版 WebKit 的已知行为），或
       · 顺序与 Safari 不同（当前事件不在末尾）
     → 我们把同一批物理采样**再投一遍**给原生画布 → 粉笔的 stroke.points 变成
       A,A,B,B,C,C → paint() 的 4 点滑动窗口沿原路折返 → 屏幕上就是
       「一条笔画画成两条几乎平行、局部交叉的线」。
     修法：**不再依赖任何浏览器语义**。只补「还没投过、且确实落在上一次事件与本次
     事件之间」的样本：
       ① 当前事件的位置先登记为「已投递」（原生会自己收到它）；
       ② 候选样本若与已投递坐标过近 → 跳过（已经投过了）；
       ③ 候选样本若不落在「上次位置→本次位置」的区间内 → 跳过（陈旧或超前，绝不乱序）。
     这样无论浏览器怎么返回合并列表，原生画布都只会收到每个物理采样**一次**。 */
  var PEN_SENT_MAX = 800;    // 一笔内保留多少个「已投递坐标」：必须覆盖整笔（一笔可到 400+ 点）
  var PEN_SENT_SCAN = 240;   // 去重只回看最近这么多条：重复必然发生在最近，避免每帧 O(n) 全扫
  var PEN_TICK_GAP = 5;      // v2.8.14：相邻两个原始事件间隔小于 5ms = 浏览器正在把这一帧的
                             // 采样**逐个**投递（Via 实测：14 个采样挤在 1ms 内）→ 这些点
                             // 原生马上会自己收到，此时绝不能再补投，否则就是「投两遍」。
  function penSentAdd(tr, x, y) {
    if (!tr) return;
    if (!tr.sent) tr.sent = [];
    tr.sent.push({ x: x, y: y });
    if (tr.sent.length > PEN_SENT_MAX) tr.sent.shift();
  }
  function penSentHas(tr, x, y, r) {
    if (!tr || !tr.sent) return false;
    var rr = (r || 1) * (r || 1);
    var n = tr.sent.length;
    var from = n > PEN_SENT_SCAN ? n - PEN_SENT_SCAN : 0;
    for (var i = n - 1; i >= from; i--) {   // 从最近的开始回看
      var q = tr.sent[i];
      var dx = x - q.x, dy = y - q.y;
      if (dx * dx + dy * dy < rr) return true;
    }
    return false;
  }

  /* v2.8.14 再收紧：判定三道闸（与浏览器怎么返回列表无关）：
       ① 已经投递过的坐标 → 跳过（否则原生会把同一条轨迹画两遍）
       ② 不落在「上次位置→本次位置」区间内 → 跳过（陈旧/超前，绝不乱序）
       ③ pointerId 不符 → 跳过（别的指针的采样）
       ④ 列表末尾必须就是当前事件本身 → 否则整批不补（见下）
     返回 { list: 可补投的样本, skip: 被跳过的个数, tail: 是否因 ④ 整批放弃 }

     ④ 的来历（Via 真机自检）：Via 会把同一帧的 14 个采样**逐个作为独立 pointermove
     投递**，而每个事件的 getCoalescedEvents() 又把这一帧 14 个**原样返回**。于是帧内
     第一个事件（P1）的列表末尾是 P14 而不是 P1 —— 列表里全是「浏览器随后会自己送到」
     的未来采样；照补就是把这一帧画两遍。Safari/Chrome 的正常形态则是
     「列表末尾 = 当前事件」（中间点在前、当前点在末），此时补前面的点才安全。
     宁可少补（采样稀一点，cardinal 样条照样平滑），绝不能补出重复（那是两条交错的线）。 */
  function penPickCoalesced(tr, co, ax, ay, bx, by, pid) {
    var list = [], skip = 0;
    if (!co || !co.length) return { list: list, skip: skip };
    var tail = co[co.length - 1];
    if (tail && isFinite(tail.clientX) && isFinite(tail.clientY)) {
      var ddx = tail.clientX - bx, ddy = tail.clientY - by;
      if (ddx * ddx + ddy * ddy > 1) return { list: list, skip: co.length, tail: true };  // ④
    }
    var pdx = bx - ax, pdy = by - ay;
    var plen2 = pdx * pdx + pdy * pdy;
    for (var i = 0; i < co.length; i++) {
      var ce = co[i];
      if (!ce) { skip++; continue; }
      if (ce.pointerId !== undefined && pid !== undefined && ce.pointerId !== pid) { skip++; continue; }
      var gx = ce.clientX, gy = ce.clientY;
      if (!isFinite(gx) || !isFinite(gy)) { skip++; continue; }
      if (penSentHas(tr, gx, gy, 1)) { skip++; continue; }              // ① 已投递过
      if (plen2 > 0.01) {                                             // ② 必须落在区间内
        var tt = ((gx - ax) * pdx + (gy - ay) * pdy) / plen2;
        if (tt < 0.02 || tt > 1.05) { skip++; continue; }
      }
      list.push({ x: gx, y: gy, pressure: ce.pressure });
    }
    return { list: list, skip: skip };
  }

  // 收笔：这一笔结束，清空跟踪状态（pointerout 不在此列——它可能只是掠过覆盖元素）
  function penOnEnd(e) {
    if (!e) return;
    if (penTrack && penTrack.id === e.pointerId) penTrack = null;
  }

  /* 粉笔把 pointerout 也绑到了 finishCurStroke：笔只要掠过画布上的任何覆盖元素
     （我们注入的 ABCD 字母盒 / 粉笔工具条…）就会把这一笔【切成两段】，
     每段累计点数不足 4 → paint() 走 drawLine() → 只画直线（就是「画不了弧线」）。
     手指没这问题：触摸指针有隐式捕获，全程不触发 pointerout。
     修法：笔还在草稿范围内时的 pointerout 一律拦下（不传给粉笔），笔画保持为一整笔。
     兜底：笔在画布外抬笔时（真实 pointerup 落不到 app-draft 上），补发一个合成
     pointerup 给画布，否则粉笔的 pointerEventId 会一直占着、下笔直接被忽略（画布卡死）。 */
  function penOnOut(e) {
    if (!e || e.pointerType !== 'pen') return;
    if (e[PEN_SYNTH]) return;
    var cv = resolveDraftCanvas(e.target);
    if (!cv) {
      // 目标已经是覆盖元素了（上一跳就被我们放行过一次）→ 仍按当前笔画的画布判断
      cv = (penTrack && penTrack.cv) || penStrokeCv;
      if (!cv) return;
    }
    penStrokeCv = cv;
    if (pointerInCanvas(cv, e)) {
      try { e.stopPropagation(); } catch (err) {}   // 只掠过覆盖元素 → 不切笔
    } else {
      penTrack = null;                              // 真的离开草稿区 → 这一笔到此为止
    }
  }

  function penOnUp(e) {
    if (!e || e.pointerType !== 'pen') return;
    if (e[PEN_SYNTH]) return;
    var cv = penStrokeCv;
    penStrokeCv = null;
    if (!cv) return;
    if (e.target === cv) return;                     // 抬笔就在画布上 → 粉笔自己会收到
    var host = null;
    try { host = cv.closest ? cv.closest('app-draft') : null; } catch (e1) {}
    if (host && e.target && e.target.nodeType === 1) {
      try { if (host.contains(e.target)) return; } catch (e2) {}   // 仍在草稿内 → 粉笔自己会收到
    }
    // 抬笔在草稿之外 → 补发合成 pointerup，防止粉笔 pointerEventId 卡住
    if (!sendSynth(cv, 'pointerup', e, e.clientX, e.clientY, 0)) return;
  }

  function penDensify(e) {
    if (!e || e.pointerType !== 'pen') return;
    if (e[PEN_SYNTH]) return;
    var cv = null;
    // 指针可能压在覆盖元素上（此时 target 不是画布），但只要还在画布范围内就继续补密
    if (penTrack && penTrack.id === e.pointerId && penTrack.cv && pointerInCanvas(penTrack.cv, e)) {
      cv = penTrack.cv;
    }
    if (!cv) cv = resolveDraftCanvas(e.target);
    if (!cv) return;
    var last = penTrack;
    var now = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    if (!last || last.id !== e.pointerId || last.cv !== cv) {
      penTrack = { id: e.pointerId, x: e.clientX, y: e.clientY, px: 0, py: 0, hasP: false, cv: cv, n: 0,
        sent: [], t: now };
      penSentAdd(penTrack, e.clientX, e.clientY);   // 新的一笔：当前点原生会自己收到
      penSynthN = 0;
      return;
    }
    var ax = last.x, ay = last.y;
    var bx = e.clientX, by = e.clientY;

    /* v2.8.14 第二道闸 —— 「逐点投递」识别：
       Via 真机自检的时间线显示，同一帧的 14 个真实采样会被浏览器**逐个作为独立
       pointermove 投递**（14 条挤在同一个毫秒里），而每个事件的 getCoalescedEvents()
       又把这 14 个**原样返回**。于是第一个事件刚把 P2..P14 补投出去，浏览器紧接着就把
       P2..P14 自己投递一遍 → 原生画布每个点收到两次 → 两条交错的线。
       判据与浏览器语义无关：相邻两个原始事件间隔 < 5ms = 同一帧内的连续投递 →
       这些点原生马上会自己收到，一律不补。Safari/Chrome 的正常形态是「每帧一个事件」
       （间隔 16~60ms），不受影响。 */
    // hasP=false 表示上一个是 pointerdown（落笔瞬间与第一个 move 可能同一毫秒），
    // 那种情况下不做「逐点投递」判定，否则会把落笔后的第一次补密也误杀。
    var gap = (last.hasP && last.t && now) ? (now - last.t) : 999;
    var ticking = gap < PEN_TICK_GAP;   // 浏览器正在逐点投递

    /* ① 合并还原（v2.8.13 幂等版）：浏览器因主线程繁忙，把中间的采样合并进这一个
          pointermove，getCoalescedEvents() 能把它们全部拿回来。
          【v2.8.13 的关键修正】旧写法假定「列表最后一个 = 当前事件本身」，只补
          co[0..len-2]——这条假定只对 Safari/Chrome 成立。第三方 WebView 壳（Via）
          返回的列表可能把**已经投递过的样本**也包含进来（或顺序不同）→ 我们再投一遍
          → 粉笔的 stroke.points 变成 A,A,B,B,C,C → paint() 的 4 点窗口沿原路折返 →
          屏幕上就是「一条笔画画成两条几乎平行、局部交叉的线」。
          现在只补「还没投过、且确实落在上次位置与本次位置之间」的样本：
            ① 当前事件的位置先登记为「已投递」（原生会自己收到它）；
            ② 与已投递坐标过近 → 跳过；
            ③ 不落在区间内 → 跳过（陈旧/超前，绝不乱序投递）。 */
    var co = null;
    try { co = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null; } catch (err) {}
    // v2.8.14：原生路径也要记合并密度。以前只在整页草稿路径（fpOnMove）记，于是
    // Via 的诊断里 coalesced 恒为 {max:0,avg:0,events:0} —— 差点据此误判「Via 没有合并采样」。
    if (co && co.length) {
      penStat.coalescedN++;
      penStat.coalescedSum += co.length;
      if (co.length > penStat.coalescedMax) penStat.coalescedMax = co.length;
    }
    penSentAdd(last, bx, by);   // 当前事件原生会自己收到 → 先登记
    var pick = { list: [], skip: 0 };
    if (ticking) {
      penStat.tickSkip++;                 // 浏览器正在逐点投递 → 一个都不补（补了就是投两遍）
    } else {
      pick = penPickCoalesced(last, co, ax, ay, bx, by, e.pointerId);
      if (pick.tail) penStat.tailSkip++;  // ④ 列表末尾不是当前事件 → 整批放弃
      penStat.synthSkip += pick.skip;
      for (var pi = 0; pi < pick.list.length; pi++) {
        if (penSynthN >= PEN_STROKE_MAX) break;
        var ps = pick.list[pi];
        if (!sendSynth(cv, 'pointermove', e, ps.x, ps.y, ps.pressure)) break;
        penSynthN++;
        penStat.synth++;
        penSentAdd(last, ps.x, ps.y);
        ax = ps.x; ay = ps.y;
      }
    }

    /* ② 粉笔自己的画法（cardinal spline，4 点窗口）本身就是平滑曲线：
          采样再稀也只是「形状粗一点」，不会变成折线——所以这里【不再做插值重建】
          （切线重建反而会在采样点处留下折角，见 tests/fenbi-kink-sim.js 的量化对比）。
          只有浏览器给出的真实合并采样（①）才值得补回去：那是笔的真实轨迹。 */
    /* v2.8.14 关键修复 —— 这一行漏掉 sent 就是 Via「两条交错线」的直接成因：
       v2.8.13 在这里重建 penTrack 时**没有把 last.sent 带过来**，于是「已投递坐标」
       每个事件都从空数组重新开始 —— 幂等防线只在「单个事件内部」生效，跨事件/跨帧
       完全失效。Via 实测（v2.8.13 自检 JSON）的铁证：
         · timeline 里同一批 14 个采样在相隔 1ms 的两个时间戳里各出现一次
           （t=...611025 与 t=...611026 的坐标序列完全相同）→ 真实采样被投了两遍；
         · synth = {sent:441, skip:57} → 补投了 441 个、幂等只挡下 57 个。
       浏览器（Via）既把这一帧的采样**作为独立 pointermove 投递**、又在
       getCoalescedEvents() 里**原样返回同一批**，于是我们把已经画过的点又补投一遍
       → 粉笔 stroke.points 变成 A,A,B,B,C,C → paint() 的 4 点窗口沿原路折返
       → 屏幕上两条交错的线。
       sent 继承后：浏览器独立投递过的坐标已登记在案 → coalesced 里再出现就被 ① 挡掉
       → 「已经独立投递过就不补」与「跨帧不重复补」两个问题一并解决。 */
    penTrack = { id: e.pointerId, x: bx, y: by, px: ax, py: ay, hasP: true, cv: cv, n: last.n + 1,
      sent: last.sent, t: now };
  }

  function installPenDensifier() {
    if (typeof window.addEventListener !== 'function') return;
    try {
      window.addEventListener('pointerdown', penOnDown, true);
      window.addEventListener('pointermove', penDensify, true);
      window.addEventListener('pointerout', penOnOut, true);
      window.addEventListener('pointerup', penOnUp, true);
      window.addEventListener('pointerup', penOnEnd, true);
      window.addEventListener('pointercancel', penOnEnd, true);
      // v2.8.12：全局旁观所有指针事件（不分类型）——用来回答「这台设备到底会不会
      // 报 pointerType=pen」。Via（iOS WKWebView 壳）很可能把触控笔降级成 touch，
      // 那时我们就必须自己认得出「这是笔」而不是靠 pointerType。
      window.addEventListener('pointerdown', penStatWatch, true);
      window.addEventListener('pointermove', penStatWatch, true);
      window.addEventListener('pointerup', penStatWatch, true);      // v2.8.13：收笔也要计数
      window.addEventListener('pointercancel', penStatWatch, true);
    } catch (e) { /* 装不上不影响原有功能 */ }
  }

  /* v2.8.13：全局旁观所有指针事件——这是「浏览器到底怎么投递指针事件」的唯一事实来源。
     v2.8.12 只挂 pointerdown/pointermove，且 down/move/up 三个计数只在我们的 fp 路径里
     自增 → 上一版诊断里出现过「ev=349 但 down/move/up 全是 0」的矛盾（因为那次采样时
     整页草稿会话没开，我们的路径根本没跑）。现在三个计数一律由旁观器自己记，
     与我们的落笔路径无关，任何时候都能读出浏览器的真实投递形态。 */
  function penStatWatch(e) {
    if (!e) return;
    var s = penStatStream(e);
    if (!s) return;
    s.ev = (s.ev || 0) + 1;
    var ty = e.type || '';
    var now = Date.now();
    var x = Math.round(e.clientX || 0), y = Math.round(e.clientY || 0);
    if (ty === 'pointerdown') {
      s.down = (s.down || 0) + 1;
      try { penStat.downIds[e.pointerId] = true; } catch (e2) {}
      // 开一条生命周期台账
      penStat.life.push({
        id: e.pointerId, type: e.pointerType || 'unknown', t0: now, t1: 0, n: 0,
        x0: x, y0: y, x1: x, y1: y, open: true
      });
      if (penStat.life.length > PEN_LIFE_MAX) penStat.life.shift();
    } else if (ty === 'pointermove') {
      s.move = (s.move || 0) + 1;
    } else if (ty === 'pointerup' || ty === 'pointercancel') {
      s.up = (s.up || 0) + 1;
    }
    // 生命周期收尾：给该指针最后一条未闭合的台账补上终点
    if (ty === 'pointerup' || ty === 'pointercancel') {
      for (var i = penStat.life.length - 1; i >= 0; i--) {
        var L = penStat.life[i];
        if (L.open && L.id === e.pointerId) {
          L.open = false; L.t1 = now; L.x1 = x; L.y1 = y; L.n = s.ev || 0;
          break;
        }
      }
    }
    // 原始投递顺序（最近 N 条）——跨 world 也能从 DOM 属性里读到
    try {
      // v2.8.14：syn 标记区分「浏览器投的」与「我们补投的合成事件」——上一版诊断里
      // 两者混在一条时间线上，只能靠时间戳差 1ms 去猜哪批是我们投的（Via 实测正是如此）
      penStat.timeline.push({ t: now, ty: ty, id: e.pointerId, pt: e.pointerType || '', x: x, y: y,
        syn: e[PEN_SYNTH] ? 1 : 0 });
      if (penStat.timeline.length > PEN_TIMELINE_MAX) penStat.timeline.shift();
    } catch (e3) {}
  }

  installPenDensifier();

  /* ---------- ⑤ 笔刷设置面板（ensure 建 DOM / place 定位，每轮扫描均可调用） ---------- */
  var brushPanelEl = null; // 模块级面板引用：place 逻辑不依赖 getElementById

  // ensureBrushPanel：创建面板 DOM、绑定事件并接入文档树（已存在则直接返回，可重复调用）
  function ensureBrushPanel() {
    try {
      if (!document.body) return;
      if (brushPanelEl && brushPanelEl.isConnected) return; // 已创建且仍在文档树中
      var existed = document.getElementById('marvis-brush-panel'); // 兜底：DOM 中已有同 id 节点
      if (existed) { brushPanelEl = existed; return; }

      var panel = document.createElement('div');
      panel.id = 'marvis-brush-panel';
      panel.className = 'marvis-brush-panel';
      panel.title = '笔刷设置';

      [['#000000', '黑'], ['#1e5eff', '蓝'], ['#e02020', '红']].forEach(function (pair) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'mbp-dot';
        dot.setAttribute('data-color', pair[0]);
        dot.title = pair[1] + '色';
        dot.style.background = pair[0];
        dot.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          brushColor = pair[0];
          saveBrush();
          syncBrushPanel();
        });
        panel.appendChild(dot);
      });

      var range = document.createElement('input');
      range.type = 'range';
      range.className = 'mbp-range';
      range.min = '0.4';
      range.max = '4';
      range.step = '0.1';
      range.value = String(brushWidth);
      range.title = '笔画粗细（0.4×~4×）';
      range.addEventListener('input', function (ev) {
        ev.stopPropagation();
        var v = parseFloat(range.value);
        if (!isNaN(v)) {
          brushWidth = v;
          saveBrush();
          syncBrushPanel();
        }
      });
      panel.appendChild(range);

      var val = document.createElement('span');
      val.className = 'mbp-val';
      panel.appendChild(val);

      // 事件在创建时统一绑定一次（inline / fixed 两种模式共用），避免冒泡干扰页面与草稿画布的 pointer 事件
      ['pointerdown', 'mousedown', 'click', 'dblclick', 'touchstart', 'keydown', 'wheel'].forEach(function (t) {
        panel.addEventListener(t, function (ev) { ev.stopPropagation(); });
      });

      // 关键：先接入文档树，placeBrushPanel 才能取到并把面板搬到目标位置
      brushPanelEl = panel;
      document.body.appendChild(panel);

      syncBrushPanel();
    } catch (e) { /* 面板构建失败不影响 scan() 中后续题目处理 */ }
  }

  // placeBrushPanel：把已存在的面板放到正确位置，每次扫描都执行
  function placeBrushPanel() {
    try {
      var panel = brushPanelEl || document.getElementById('marvis-brush-panel');
      if (!panel || !document.body) return;

      /* 锚点：app-setting（父级为顶部 header-right flex 行容器），插到它的前一个兄弟位置 */
      var appSetting = document.querySelector('app-setting');
      if (appSetting && appSetting.parentElement) {
        if (panel.parentElement !== appSetting.parentElement || panel.nextElementSibling !== appSetting) {
          appSetting.parentElement.insertBefore(panel, appSetting); // insertBefore 会自动搬移已存在节点
        }
        panel.classList.add('mbp-inline');
        return;
      }

      /* 兜底：锚点始终缺失时才回到左下角 fixed 模式；后续扫描一旦锚点出现仍会挪过去 */
      panel.classList.remove('mbp-inline');
      if (panel.parentElement !== document.body) document.body.appendChild(panel);
    } catch (e) { /* 定位失败不影响 scan() 中后续题目处理 */ }
  }

  function syncBrushPanel() {
    var panel = brushPanelEl || document.getElementById('marvis-brush-panel');
    if (!panel) return;
    var dots = panel.querySelectorAll('.mbp-dot');
    for (var i = 0; i < dots.length; i++) {
      var on = String(dots[i].getAttribute('data-color')).toLowerCase() === String(brushColor).toLowerCase();
      dots[i].className = 'mbp-dot' + (on ? ' mbp-dot-on' : '');
    }
    var r = panel.querySelector('.mbp-range');
    if (r) r.value = String(brushWidth);
    var v = panel.querySelector('.mbp-val');
    if (v) v.textContent = brushWidth.toFixed(1) + '×';
  }

  /* ---------- 工具 ---------- */
  function tis() {
    return [].slice.call(document.querySelectorAll('.ti'));
  }

  // 题目作用域 key：题号（SPA 复用同一 .ti 元素渲染新题时 key 会变化）；
  // 无题号时退化为 data-question-key（子题兜底）
  function tiKey(ti) {
    var i = ti.querySelector('.title-index');
    var t = i ? (i.textContent || '').trim() : '';
    return t || (ti.getAttribute && ti.getAttribute('data-question-key')) || '';
  }

  // 「题干+选项」区域相对 .ti 顶部的高度
  function measureTi(ti) {
    var qc = ti.querySelector('app-question-choice');
    if (!qc) return null;
    var tiR = ti.getBoundingClientRect();
    var r = qc.getBoundingClientRect();
    var h = Math.round(r.bottom - tiR.top);
    return h > 0 ? h : null;
  }

  // 锁定目标高度 = 题干+选项区底边相对 .ti 顶部 + 48（与 lockDraft 同一口径）
  function draftTargetHeight(ti) {
    var h = measureTi(ti);
    return h ? h + 48 : null;
  }

  /* ---------- ⑧ 资料分析「一拖五」组识别（2026-10-23 实测） ---------- */
  // 组 = 含 .materials-container / .questions-anchors 的 .ti；其子题为
  // app-ti.question-multiple（无 ti class，旧版完全没覆盖到）。
  function isGroupTi(ti) {
    return !!(ti.querySelector('.materials-container') || ti.querySelector('.questions-anchors'));
  }
  function subsOf(group) {
    return [].slice.call(group.querySelectorAll('app-ti.question-multiple')).filter(function (st) {
      return typeof st.closest === 'function' && st.closest('.ti') === group;
    });
  }
  // 元素所属的「题目作用域」：子题优先，否则所在的 .ti（组本身不是作用域）
  function questionScopeOf(el) {
    if (!el || typeof el.closest !== 'function') return null;
    var sub = el.closest('app-ti.question-multiple');
    if (sub) return sub;
    var ti = el.closest('.ti');
    return ti && !isGroupTi(ti) ? ti : null;
  }
  // 全量作用域列表：组展开为各个子题，普通题即自身
  function allScopes() {
    var out = [];
    tis().forEach(function (ti) {
      if (isGroupTi(ti)) subsOf(ti).forEach(function (s) { out.push(s); });
      else out.push(ti);
    });
    return out;
  }
  // 组的稳定 key：优先子题 data-question-key 的公共前缀（3_1_ijsk5..9 → 3_1_ijsk），
  // 退化用材料文本哈希（同一份材料重进后一致）。
  // 撞名保护（v2.7.0 修复存量 bug）：题号是三十六进制计数器，相邻两组的公共前缀
  // 可能相同（3_1_ijsi4~8 与 3_1_ijsi9~ijsid 前缀都是 3_1_ijsi）——旧版因此让相邻组
  // 的材料画布共享同一份 localStorage（笔迹/缩放串组，真机实测复现）。
  // 现按文档序先到先得（旧 key 不变、老笔迹不丢），撞名的组追加首道子题完整 key。
  function hashText(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  var groupKeyClaims = {}; // base → 首道子题 data-question-key（稳定身份）
  function groupKeyOf(group) {
    var subs = subsOf(group);
    var keys = subs.map(function (s) { return s.getAttribute('data-question-key') || ''; }).filter(Boolean);
    var base = '';
    if (keys.length) {
      var prefix = keys[0].replace(/\d+$/, '');
      base = (prefix && keys.every(function (k) { return k.indexOf(prefix) === 0; })) ? prefix : keys[0];
    } else {
      var mc = group.querySelector('.material-content') || group.querySelector('.materials-container');
      base = 'h' + hashText((mc && mc.textContent || '').replace(/\s+/g, ' ').slice(0, 400));
      var t0 = subs[0] ? (subs[0].querySelector('.title-index') || { textContent: '' }).textContent : '';
      var idx = (t0 || '').replace(/[^\w.]/g, '');
      if (idx) base += '-' + idx; // 文本哈希也可能撞（空材料）：追加入组内首道子题题号
    }
    var ident = keys[0] || ''; // 组的稳定身份（Angular 重建元素后仍一致）
    if (ident) {
      var owner = groupKeyClaims[base];
      if (owner && owner !== ident) {
        base = base + '-' + ident;
        if (groupKeyClaims[base] && groupKeyClaims[base] !== ident) base += '-' + hashText(ident);
      }
      groupKeyClaims[base] = ident;
    }
    return base;
  }

  /* ---------- ⑨ 性能护栏：视口附近才自动开草稿/建画布 ---------- */
  // 110 题全开画布在低配/软件渲染环境 tile 内存超限（实测卡死渲染进程）。
  // 只有接近视口的题才做「重活」（开原生草稿 / 建画布）；字母盒与回填保持全量。
  function nearViewport(ti) {
    try {
      var r = ti.getBoundingClientRect();
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var top = r.top + y, bottom = r.bottom + y;
      return bottom > y - vh * 0.6 && top < y + vh * 1.6;
    } catch (e) { return true; }
  }

  // 修复「退出草稿重开后笔迹被压缩到最上」的根因：
  // 页面重开草稿时会重建 canvas#draft，并按整个 .ti（含已展开的解析区）高度设置
  // 绘图缓冲区（height attribute），而容器 CSS 高度被本脚本锁定为「题干+选项」高度，
  // 缓冲区高度远大于显示高度 → 笔迹被垂直压缩（实测约 26%）。
  // 这里在粉笔设置 canvas.height/width 的瞬间把缓冲区尺寸改写为容器显示尺寸：
  // 此刻画布刚创建、内容为空，改写不会丢笔迹；之后粉笔重放/书写都落在正确尺寸上，
  // 显示即 1:1。宽度仅在确实失配时改写（避免无谓触发 canvas 清空）。
  function installDraftSizeHook() {
    var P = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
    if (!P || P.__marvisDraftSizeHooked) return;
    try {
      P.__marvisDraftSizeHooked = true;
      var dW = Object.getOwnPropertyDescriptor(P, 'width');
      var dH = Object.getOwnPropertyDescriptor(P, 'height');

      function syncSetter(kind) {
        var d = kind === 'height' ? dH : dW;
        if (!d || !d.get || !d.set) return null;
        return function (v) {
          var target = null;
          if (this && this.id === 'draft' && typeof this.closest === 'function') {
            var dc = this.closest('.draft-container');
            if (kind === 'height') {
              var ti = dc && typeof dc.closest === 'function' ? dc.closest('.ti') : null;
              // 一拖五组的原生草稿会被整体隐藏（见 neutralizeGroupDraft），不锁定其尺寸
              target = ti && !isGroupTi(ti) ? draftTargetHeight(ti) : null;
            } else if (dc) {
              target = dc.clientWidth || null;
            }
          }
          if (target && Math.abs(target - v) > 1) {
            d.set.call(this, target);
            return;
          }
          d.set.call(this, v);
        };
      }

      var setW = syncSetter('width');
      var setH = syncSetter('height');
      if (setW) {
        Object.defineProperty(P, 'width', {
          configurable: true,
          enumerable: dW.enumerable,
          get: function () { return dW.get.call(this); },
          set: setW
        });
      }
      if (setH) {
        Object.defineProperty(P, 'height', {
          configurable: true,
          enumerable: dH.enumerable,
          get: function () { return dH.get.call(this); },
          set: setH
        });
      }
    } catch (e) { /* 拦截失败不影响原有功能 */ }
  }
  installDraftSizeHook();

  /* ---------- ③ 草稿尺寸锁定 ---------- */
  function lockDraft(ti) {
    var dc = ti.querySelector('.draft-container');
    if (!dc) return;
    var h = measureTi(ti);
    if (!h) return;
    var target = (h + 48) + 'px';
    if (dc.style.getPropertyValue('height') !== target) {
      dc.style.setProperty('height', target, 'important');
      dc.style.setProperty('top', '0px', 'important');
    }
    dc.setAttribute(DLOCK_ATTR, '1');
  }

  /* ---------- ④ 自动打开草稿 ---------- */
  function clickDraftTool(ti) {
    if (ti.querySelector('.draft-container')) return; // 已开
    var tool = ti.querySelector('li.draft.tool');
    if (tool) tool.click();
  }

  // 自动打开：每题只尝试一次（key = 题号），避免重扫时把用户手动关掉的草稿又打开
  function autoOpenDraft(ti) {
    var key = tiKey(ti);
    if (ti.getAttribute(AUTO_ATTR) === key) return;
    ti.setAttribute(AUTO_ATTR, key);
    clickDraftTool(ti);
  }

  // 把目标题目滚动到视口垂直居中位置。
  // 题目高度不超过一屏时整题居中；题目高于一屏时改为「顶部保留可见余量」，
  // 保证题干头部与首行选项不会被顶出屏幕外。
  function centerTi(ti) {
    if (!ti) return;
    var r = ti.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var target;
    if (r.height <= vh) {
      target = y + r.top + r.height / 2 - vh / 2;           // 常规题：整题中心对齐视口中心
    } else {
      var pad = Math.min(Math.round(vh / 6), 120);           // 超高题：顶部留出约 1/6 屏空白（上限 120px）
      target = y + r.top - pad;
    }
    var maxTop = Math.max(0, (document.documentElement.scrollHeight || 0) - vh);
    if (target < 0) target = 0;
    if (target > maxTop) target = maxTop;                    // 末尾题目滚不到目标位时贴底，避免超界空白
    window.scrollTo({ top: Math.round(target), behavior: 'smooth' });
  }

  /* ---------- ①② ABCD 字母盒 + 下一题 ---------- */

  /* ⑥ ABCD 点击反馈按钮本身变色 */
  function clearFeedback(ti) {
    var btns = ti.querySelectorAll('.marvis-lbtn');
    [].slice.call(btns).forEach(function (b) {
      b.classList.remove('marvis-feedback-correct', 'marvis-feedback-wrong', 'marvis-feedback-selected');
    });
  }

  function applyFeedback(ti, cr) {
    // 动态索引映射：ti 内 li.choice-radio 顺序 = .marvis-lbox 内 .marvis-lbtn 顺序。
    // Angular 判分会重建 li 节点，按钮不随重建丢失，按顺序动态查找即可上色。
    var lbox = ti.querySelector('.marvis-lbox');
    var radios = [].slice.call(ti.querySelectorAll('li.choice-radio'));
    var btns = lbox ? [].slice.call(lbox.querySelectorAll('.marvis-lbtn')) : [];
    function btnOf(li) {
      var idx = radios.indexOf(li);
      return idx > -1 ? btns[idx] : null;
    }
    var correctEls = ti.querySelectorAll('li.choice-radio div.input-radio.correct, li.choice-radio div.input-radio.correctLost');
    var wrongEls = ti.querySelectorAll('li.choice-radio div.input-radio.wrong');
    if (correctEls.length > 0 || wrongEls.length > 0) {
      [].slice.call(correctEls).forEach(function (el) {
        var btn = btnOf(el.closest('li.choice-radio'));
        if (btn) btn.classList.add('marvis-feedback-correct');
      });
      [].slice.call(wrongEls).forEach(function (el) {
        var btn = btnOf(el.closest('li.choice-radio'));
        if (btn) btn.classList.add('marvis-feedback-wrong');
      });
    } else if (cr) {
      var b = btnOf(cr);
      if (b) b.classList.add('marvis-feedback-selected');
    }
  }

  // 单选选中态识别（做题模式）。粉笔选中样式是 input[type=radio]:checked + .input-radio
  // 的兄弟选择器，选中时 div.input-radio 本身不加 class（页面 CSS 里只有 correct/wrong），
  // 理论上 input.checked 是唯一标识；但不同入口（重进恢复）可能走 setAttribute / aria /
  // class 等路径，这里多信号并取，任一命中即视为已选，避免漏判导致按钮空白。
  function isRadioSelected(li) {
    var inp = li.querySelector('input.option-radio') || li.querySelector('input[type="radio"]');
    if (inp) {
      if (inp.checked) return true;                                   // property（主路径）
      if (inp.hasAttribute && inp.hasAttribute('checked')) return true; // setAttribute 恢复
      if (inp.getAttribute && inp.getAttribute('aria-checked') === 'true') return true;
    }
    // class 兜底：只信 div.input-radio / label（页面自身 CSS 从不给这两个加 selected 类，
    // 一旦出现基本就是状态标记）；li 不查，避免容器级 class 误伤。
    var marks = [li.querySelector('div.input-radio'), li.querySelector('label')];
    for (var i = 0; i < marks.length; i++) {
      var el = marks[i];
      if (!el || !el.classList) continue;
      if (el.classList.contains('checked') || el.classList.contains('selected') ||
          el.classList.contains('chosen') || el.classList.contains('active')) return true;
      if (el.getAttribute && el.getAttribute('aria-checked') === 'true') return true;
    }
    return false;
  }

  /* ⑦ 按页面既有作答状态回填按钮颜色（重进页面 / 答案异步回填 / Angular 重建选项节点均适用） */
  function syncFeedback(ti) {
    if (!ti || !ti.isConnected) return;
    if (isGroupTi(ti)) return; // 组不是题目作用域：其子题各自同步（见 allScopes）
    // 刚点过按钮的题在短时间内交给点击回调着色，避免判分 class 尚未落地时被清空造成闪烁
    if (ti.__marvisClickTs && Date.now() - ti.__marvisClickTs < 1200) return;

    var lbox = ti.querySelector('.marvis-lbox');
    if (!lbox) return;
    var radios = [].slice.call(ti.querySelectorAll('li.choice-radio'));
    var btns = [].slice.call(lbox.querySelectorAll('.marvis-lbtn'));
    if (!radios.length || !btns.length) return;

    var target = {};
    var judged = false;
    // ① 已判分（背题 / 交卷后）：correct、correctLost 上绿，wrong 上红
    radios.forEach(function (li, i) {
      var ir = li.querySelector('div.input-radio');
      if (!ir) return;
      if (ir.classList.contains('correct') || ir.classList.contains('correctLost')) {
        target[i] = 'marvis-feedback-correct';
        judged = true;
      } else if (ir.classList.contains('wrong')) {
        target[i] = 'marvis-feedback-wrong';
        judged = true;
      }
    });
    // ② 未判分（做题模式）：选中态走 isRadioSelected 多信号识别
    if (!judged) {
      radios.forEach(function (li, i) {
        if (isRadioSelected(li)) target[i] = 'marvis-feedback-selected';
      });
    }

    // 幂等写入：仅在 class 与目标不一致时改动，避免每次扫描都触发重绘
    btns.forEach(function (b, i) {
      var want = target[i] || '';
      var has = b.classList.contains('marvis-feedback-correct') ? 'marvis-feedback-correct'
              : b.classList.contains('marvis-feedback-wrong') ? 'marvis-feedback-wrong'
              : b.classList.contains('marvis-feedback-selected') ? 'marvis-feedback-selected' : '';
      if (has === want) return;
      b.classList.remove('marvis-feedback-correct', 'marvis-feedback-wrong', 'marvis-feedback-selected');
      if (want) b.classList.add(want);
    });
  }

  // 同一帧内合并多次同步请求（key 按元素唯一分配，避免子题与普通题题号相撞时互相吞掉）
  var syncKeySeq = 0;
  var syncPendingKey = {};
  function syncKeyOf(ti) {
    if (!ti.__marvisSyncKey) ti.__marvisSyncKey = 's' + (++syncKeySeq);
    return ti.__marvisSyncKey;
  }
  function scheduleSync(ti) {
    if (!ti) return;
    var key = syncKeyOf(ti);
    if (syncPendingKey[key]) return;
    syncPendingKey[key] = true;
    requestAnimationFrame(function () {
      syncPendingKey[key] = false;
      syncFeedback(ti);
    });
  }

  // 重进页面后作答数据异步回填时，Angular 只对 input.checked 做 property 赋值：
  // 不新增节点（MutationObserver 观察不到）、也不挂 class，因此 hook setter 精准触发回填。
  function installCheckedHook() {
    var P = window.HTMLInputElement && window.HTMLInputElement.prototype;
    if (!P || P.__marvisCheckedHooked) return;
    try {
      var d = Object.getOwnPropertyDescriptor(P, 'checked');
      if (!d || !d.get || !d.set) return;
      P.__marvisCheckedHooked = true;
      Object.defineProperty(P, 'checked', {
        configurable: true,
        enumerable: d.enumerable,
        get: function () { return d.get.call(this); },
        set: function (v) {
          d.set.call(this, v);
          try {
            if (this.classList && this.classList.contains('option-radio')) {
              // 子题内的 radio：作用域是子题本身（不是外层组 .ti）
              var scope = questionScopeOf(this);
              if (scope) scheduleSync(scope);
            }
          } catch (e) {}
        }
      });
    } catch (e) { /* hook 失败时仍有 change 事件与定时补偿兜底 */ }
  }
  installCheckedHook();

  // 兜底：用户点选后浏览器会改 checked 且派发 change，捕获阶段统一同步
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.classList || !t.classList.contains('option-radio')) return;
    var scope = questionScopeOf(t);
    if (scope) scheduleSync(scope);
  }, true);

  // 兜底：页面加载初期 / 重进恢复时作答数据可能晚于按钮注入才落地。
  // 早期只一次性补偿到 6s，且恢复若走属性级路径（setAttribute/class/aria）不会被触发，会漏；
  // 改为前 30s 每秒一次的全量补偿（syncFeedback 幂等，无变化不写 DOM，空转开销可忽略），
  // 之后交给 MO 属性监听 / setter hook / change 捕获持续兜底。
  // 组要展开成子题同步（组本身不是作用域）。
  function syncAllFeedback() {
    allScopes().forEach(syncFeedback);
  }
  window.__MARVIS_FENBI_SYNC__ = syncAllFeedback; // 控制台手动补偿：__MARVIS_FENBI_SYNC__()
  setTimeout(syncAllFeedback, 0);
  var sweepLeft = 30;
  var sweepTimer = setInterval(function () {
    syncAllFeedback();
    if (--sweepLeft <= 0) clearInterval(sweepTimer);
  }, 1000);

  // 生命周期兜底：bfcache 恢复 / 切回标签页 / 窗口聚焦时立即补偿一次
  window.addEventListener('pageshow', syncAllFeedback);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) cvFlushAll();      // ⑧ 离页前把自制画布笔迹落盘
    else syncAllFeedback();
  });
  window.addEventListener('focus', syncAllFeedback);
  window.addEventListener('pagehide', cvFlushAll);

  function buildBox(ti) {
    var tl = ti.querySelector('.title-left');
    if (!tl) return;
    var key = tiKey(ti);
    var old = tl.querySelector('.marvis-lbox');
    if (old) {
      // 同一题且结构版本一致才跳过；版本戳变化（脚本升级）时强制重建，
      // 例如 v2.3.0 起「下一题」要支持组内子题推进，旧盒子的闭包 handler 必须换掉。
      if (old.getAttribute(BOX_ATTR) === key && old.getAttribute(BOXVER_ATTR) === BOX_VER) return;
      clearFeedback(ti);                               // 旧反馈 class 不残留到新题
      old.remove();                                    // 元素复用渲染新题，重建
    }

    var box = document.createElement('div');
    box.className = 'marvis-lbox';
    box.setAttribute(BOX_ATTR, key);
    box.setAttribute(BOXVER_ATTR, BOX_VER);

    var radios = [].slice.call(ti.querySelectorAll('li.choice-radio'));
    var letters = ['A', 'B', 'C', 'D'];

    radios.forEach(function (cr, i) {
      var letter = letters[i];
      if (!letter) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'marvis-lbtn';
      b.setAttribute('data-letter', letter);
      b.textContent = letter;
      cr.__marvisBtn = b; // 兼容旧引用；判分重建后新 li 无此属性，上色以 applyFeedback 动态索引为准
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        ti.__marvisClickTs = Date.now();                  // 短暂锁定：此期间同步逻辑不覆盖点击着色
        clearFeedback(ti);                               // 先清旧反馈
        // Angular 判分会重建 li.choice-radio，闭包旧 cr 会失效；
        // 点击时按 ti 内 li 顺序动态取与按钮同序的当前 li，再取 label 触发原生判分
        var liNow = [].slice.call(ti.querySelectorAll('li.choice-radio'))[i] || cr;
        var lab = liNow.querySelector('label.choice-radio-label') || liNow.querySelector('label');
        // v2.7.9：锁定态（可触摸）下合成 click 走放行计数，否则会被自己的点击过滤器吃掉
        // v2.9.12：分栏模式下还要过 appShieldClick 那关 → 两层放行一起开
        if (lab) appAllowOnce(function () {
          fpAllowOnce(function () { lab.click(); });
        }); // 触发原生选项选择
        setTimeout(function () { applyFeedback(ti, liNow); }, 250); // 等原生对错 class 落地后着色
      });
      box.appendChild(b);
    });

    /* v2.9.11：资料分析组内的子题不再要「下一题」——
       五题本来就堆在同一栏里靠滚动翻，这个按钮只是噪音（用户明确要求去掉）。
       普通单选题照旧保留（跳下一题是常用操作）。 */
    var gti = (typeof ti.closest === 'function') ? ti.closest('.ti') : null;
    if (gti && isGroupTi(gti)) { tl.appendChild(box); return; }

    var nb = document.createElement('button');
    nb.type = 'button';
    nb.className = 'marvis-next';
    nb.textContent = '下一题';
    nb.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      fpExit();            // v2.7.9：换题即退出整页草稿（新题自己再决定要不要写）
      // 组内推进要合成点 tab，同样走放行计数（否则被锁定态的点击过滤器吃掉）
      fpAllowOnce(function () { goNextFrom(ti); });
    });
    box.appendChild(nb);

    tl.appendChild(box); // 追加到 .title-left 末尾，避免负 left 被父级 overflow 裁切
  }

  /* ---------- ⑧ 组内导航：tab 工具与容器滚动 ---------- */
  // 实测：tab 是 app-expand 内 .tabs-content > a.tab#nav0..4，与子题一一对应；
  // 点击只切 active 类、不滚动 questions-container（滚动需自行处理）。
  function groupTabs(group) {
    return [].slice.call(group.querySelectorAll('.tabs-content a.tab'));
  }
  function activateGroupTab(group, idx) {
    var tabs = groupTabs(group);
    if (tabs.length === subsOf(group).length && tabs[idx]) {
      tabs[idx].click();
      return true;
    }
    return false;
  }
  // 把子题滚进 questions-container 可视区（顶部对齐留 12px；超高子题同样适用）
  function ensureSubVisible(group, sub) {
    try {
      var qc = group.querySelector('.questions-container');
      if (!qc) return;
      var qcr = qc.getBoundingClientRect();
      var r = sub.getBoundingClientRect();
      var delta = r.top - qcr.top - 12;
      if (delta < 0 || r.bottom > qcr.bottom - 8) {
        qc.scrollTop = Math.max(0, qc.scrollTop + delta);
      }
    } catch (e) {}
  }

  // 「下一题」统一入口：子题优先推进组内下一个 tab（组末才进下一道 .ti）；
  // 进入组时复位到第一个子题；普通题保持原行为（滚动居中 + 强制开草稿）。
  function goNextFrom(scope) {
    var group = scope && typeof scope.closest === 'function' ? scope.closest('.ti') : null;
    var inGroup = group && isGroupTi(group);
    if (inGroup) {
      var subs = subsOf(group);
      var i = subs.indexOf(scope);
      if (i > -1 && i < subs.length - 1) {
        activateGroupTab(group, i + 1);
        if (group.getAttribute(FLAT_ATTR) === '1') centerTi(subs[i + 1]); // 展平：页面滚动
        else ensureSubVisible(group, subs[i + 1]);                        // 原生：容器滚动
        return;
      }
    }
    var all = tis();
    var idx = all.indexOf(inGroup ? group : scope);
    var next = idx > -1 ? all[idx + 1] : null;
    if (!next) return;
    centerTi(next);
    if (isGroupTi(next)) activateGroupTab(next, 0); // 进入组时从第一个子题开始
    processTi(next, { force: true, sync: true });   // 草稿/画布立即就位（不等滚动扫描）
    if (!isGroupTi(next)) {
      clickDraftTool(next);                         // 用户主动：强制打开原生草稿
      setTimeout(function () { lockDraft(next); }, 450);
    }
  }

  // 组级原生草稿：absolute top:0 覆盖整个 .ti（含材料与 tab 栏），吃掉全部指针事件，
  // 是「一拖五草稿不可用」的直接原因；粉笔重载还会自动恢复打开，故每次扫描都压制。
  // 实测 display:none 无副作用（不影响 tab 切换与页面其它交互）。
  function neutralizeGroupDraft(group) {
    // v2.8.12：标记「这一组由我们的整页草稿接管」——会话期间据此让组内原生草稿
    // 画布彻底收不到指针事件（见 fpQuietOn）。
    try { group.setAttribute(FPGRP_ATTR, '1'); } catch (e) {}
    [].slice.call(group.children).forEach(function (ch) {
      if (!ch.classList || !ch.classList.contains('draft-container')) return;
      if (ch.getAttribute(HIDE_ATTR) === '1') return;
      ch.style.setProperty('display', 'none', 'important');
      ch.setAttribute(HIDE_ATTR, '1');
    });
  }

  /* ---------- ⑪ 一拖五「解锁盒子」（v2.6.x，按用户澄清迭代） ---------- */
  // 需求本源：盒子高度被写死 70vh（.resizable-container / .nz-resizable.left 内联 height:70vh），
  // 5 道子题只能在盒子内滚动翻题。要的不是打散重组，而是**把盒子做高**：
  //   - 保持左右两栏（材料在左、题目在右，双双向下延伸，页面整体滚动）；
  //   - 全部高度锁（70vh）解锁 → height auto；questions-container overflow visible；
  //   - 两栏宽度一个不动（左栏 615px 定宽保留、分隔条保留仍可拖宽材料栏）；
  //   - tab 栏隐藏（整列延伸后无意义）；子题逐层解锁宽度（relaxEl，原始 style
  //     存 data-marvis-relax 供还原）；通用兜底 expandScrollBoxes 解除任何残留内滚盒子；
  //   - 材料共享画布保留、子题画布照常、「下一题」组内推进 = 页面滚动到下一子题。
  // 子题节点原地不动（Angular 无感）；每次扫描幂等重断言（MO 兜底粉笔重渲染）。
  // 默认开启；控制台 __MARVIS_FENBI_FLATTEN__() 切换（持久化），关掉回原生分栏。
  // v2.6.1：开关状态换新 key（旧 key 可能被逃生门持久化成 '0' 导致"改了没效果"）；
  // 页面右下角加可见状态胶囊（展开 开/关/失败 · 版本号，点按即切换），
  // 展开异常时胶囊变红并在控制台给出原因；__MARVIS_FENBI_DIAG__() 输出结构自检。
  // v2.6.3：解锁范围扩展到组的祖先滚动壳（整页外层 overflow 滚动壳不解锁的话，
  // 组内撑开了仍被外层兜住——「依然没有向下延伸」的根因）；body/html overflow
  // hidden 时显式放开；DIAG 增加祖先壳链路信息。
  var FLAT_ATTR = 'data-marvis-flat';
  var FLAT_BOX = 'data-marvis-flatbox';
  // v2.6.1：换新 key——旧 key 可能因用户跑过逃生门 __MARVIS_FENBI_FLATTEN__(false)
  // 被持久化成 '0'，导致每次打开都是原生分栏（这正是「改了没效果」的真凶）。
  var FLAT_LS = 'marvis-fb-flatten2';
  var FLAT_LS_OLD = 'marvis-fb-flatten';
  try { localStorage.removeItem(FLAT_LS_OLD); } catch (e) {} // 一次性清掉旧 key

  function flattenEnabled() {
    try { return localStorage.getItem(FLAT_LS) !== '0'; } catch (e) { return true; }
  }

  // 通用兜底：组内任何仍有内滚的盒子（overflow auto/scroll 且内容超高）一律解除
  // 限制、整页向下拓展——不依赖白名单，粉笔改版多套一层容器也能展开。
  // 计算样式判定天然幂等（展开后 overflowY=visible 不再命中）；每次扫描都跑，代价 O(组内节点数)。
  function expandScrollBoxes(group) {
    var els = [group].concat([].slice.call(group.querySelectorAll('*')));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.tagName === 'CANVAS') continue;           // 画布 absolute 覆盖，永远不滚
      if (el.hasAttribute(STICKY_ATTR)) continue;      // 吸顶左栏：overflow/高度是吸顶机制的一部分，不能解锁
      var cs = null;
      try { cs = getComputedStyle(el); } catch (e) {}
      var oy = (cs && cs.overflowY) ? cs.overflowY : el.style.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
        el.style.overflowY = 'visible';
        el.style.height = 'auto';
        el.style.maxHeight = 'none';
        el.setAttribute(FLAT_BOX, '1');
      }
    }
  }

  // v2.6.3 关键补漏：组外面的祖先滚动容器也要解锁——70vh 盒子只在组内，
  // 整个题目列表外层很可能还有一层 overflow:auto/hidden 的滚动壳（截图里贯穿全屏的
  // 滚动条就是它）；只展开组内的话内容撑开了还是被外层壳兜住，用户看到的仍是"没延伸"。
  // 祖先链逐层上溯到 body：内容真实超高（scrollHeight > clientHeight）才解锁，
  // 记入 flatAncestors 供关展平还原；body/html 只修 overflow（hidden→auto），不动高度。
  var flatAncestors = [];

  function unlockScroller(el) {
    if (!el || !el.style || el.tagName === 'CANVAS') return;
    if (el.hasAttribute(FLAT_BOX)) return;
    var cs = null;
    try { cs = getComputedStyle(el); } catch (e) {}
    var oy = (cs && cs.overflowY) ? cs.overflowY : el.style.overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'hidden') && el.scrollHeight > el.clientHeight + 2) {
      if (!el.hasAttribute(RELAX_ATTR)) el.setAttribute(RELAX_ATTR, el.getAttribute('style') || '');
      el.style.setProperty('overflow-y', 'visible', 'important');
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      el.setAttribute(FLAT_BOX, '1');
      if (flatAncestors.indexOf(el) === -1) flatAncestors.push(el);
    }
  }

  function expandAncestorBoxes(group) {
    var el = group.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      unlockScroller(el);
      el = el.parentElement;
    }
    // 顶层兜底：SPA 常把 body/html 设 overflow:hidden、改用内层滚动壳——
    // 内层解锁后若 body 不能滚，页面会整页卡死，这里显式放开
    [document.body, document.documentElement].forEach(function (el) {
      if (!el) return;
      var cs = null;
      try { cs = getComputedStyle(el); } catch (e) {}
      if (cs && cs.overflowY === 'hidden') el.style.setProperty('overflow-y', 'auto', 'important');
    });
  }

  // 逐层解锁布局：记下原始 style（data-marvis-relax）供关展平精确还原，然后：
  // 宽度/max-width 100%、min-width 0、left/right auto、margin/float 归零、transform none；
  // absolute/fixed 转 relative（脱离分栏偏移锚定，同时保住绝对定位子元素的包含块）。
  var RELAX_ATTR = 'data-marvis-relax';

  function relaxEl(el, keepPosition) {
    if (!el || !el.style) return;
    var first = !el.hasAttribute(RELAX_ATTR);
    if (first) el.setAttribute(RELAX_ATTR, el.getAttribute('style') || '');
    el.style.setProperty('width', '100%', 'important');
    el.style.setProperty('max-width', '100%', 'important');
    el.style.setProperty('min-width', '0', 'important');
    el.style.setProperty('left', 'auto', 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('margin-left', '0', 'important');
    el.style.setProperty('margin-right', '0', 'important');
    el.style.setProperty('float', 'none', 'important');
    el.style.setProperty('box-sizing', 'border-box', 'important');
    el.style.setProperty('transform', 'none', 'important');
    if (first && !keepPosition) {
      var cs = null;
      try { cs = getComputedStyle(el); } catch (e) {}
      if (cs && (cs.position === 'absolute' || cs.position === 'fixed')) {
        el.style.setProperty('position', 'relative', 'important');
      }
    }
  }

  // 高度解锁：盒子高度锁（70vh 等）→ auto（含 max-height），记 style 供还原
  function relaxHeight(el) {
    if (!el || !el.style) return;
    if (!el.hasAttribute(RELAX_ATTR)) el.setAttribute(RELAX_ATTR, el.getAttribute('style') || '');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-height', 'none', 'important');
  }

  // 子题内容层拉满整宽（只解锁祖先链，不动题意/选项自身的内联样式）
  function relaxSubLayout(sub) {
    relaxEl(sub, true);
    sub.style.setProperty('display', 'block', 'important');
    var probe = sub.querySelector('app-question-choice') || sub.querySelector('.ti-container') || sub.firstElementChild;
    var el = probe;
    while (el && el !== sub) {
      relaxEl(el);
      el = el.parentElement;
    }
  }

  // v2.7.1 左栏吸顶（两栏延伸形态）：滚动右侧小题时材料始终钉在左侧完整可见，
  // 滚过组内最后一题（.resizable-container 底边过去）后自然释放、随页面滚走。
  // 三个要点：
  //   ① align-self:flex-start——resizable-container 默认 align-items:stretch
  //      会把左栏拉到右栏题目等高，sticky 就没有行程可走；
  //   ② max-height 收进视口（扣除固定页头），装不下时栏内 overflow-y:auto 自滚；
  //   ③ 每次扫描重断言（Angular 重渲染会重置左栏行内样式）。
  var STICKY_ATTR = 'data-marvis-sticky';
  var stickyTopOff = 0;
  function stickyTopOffset() {
    if (stickyTopOff) return stickyTopOff;
    var off = 8; // 没有固定页头时的回退
    try {
      var els = document.querySelectorAll('body *');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el || !el.tagName) continue;
        var cs = getComputedStyle(el);
        if (cs.position === 'fixed') {
          var r = el.getBoundingClientRect();
          if (r.top < 4 && r.height >= 20 && r.height <= 240 && r.width > 300) {
            off = Math.round(r.height) + 8;
            break;
          }
        }
      }
    } catch (e) {}
    stickyTopOff = off;
    return off;
  }
  function stickLeftCol(group) {
    var left = group.querySelector('.nz-resizable.left') || group.querySelector('.left');
    if (!left || !left.style) return;
    var top = stickyTopOffset();
    left.style.setProperty('position', 'sticky', 'important');
    left.style.setProperty('top', top + 'px', 'important');
    left.style.setProperty('align-self', 'flex-start', 'important');
    left.style.setProperty('max-height', 'calc(100vh - ' + (top + 8) + 'px)', 'important');
    left.style.setProperty('overflow-x', 'hidden', 'important');
    left.style.setProperty('overflow-y', 'auto', 'important');
    left.setAttribute(STICKY_ATTR, '1');
    // 打断 flex 拉伸链（v2.7.1 实测修复）：栏被 max-height 收进视口后，若链条继续
    // align-items:stretch，每层都被拉成栏高——材料多出的部分被 .left-section 的
    // overflow:hidden 裁掉，且栏内滚动失效（scrollHeight 被锁成栏高：实测材料
    // 901px 只露出 776px、scrollTop 置 300 也弹回 0）。让链上各层按内容高度排
    // （flex:0 0 auto），溢出统一交给栏内 overflow-y:auto。
    // 原始 style 记 RELAX_ATTR，关展平时随还原链路一起恢复。
    ['.left-section', '.left-part', 'app-materials', '.materials-container', '.material-body'].forEach(function (sel) {
      var el = group.querySelector(sel);
      if (!el || !el.style) return;
      if (!el.hasAttribute(RELAX_ATTR)) el.setAttribute(RELAX_ATTR, el.getAttribute('style') || '');
      el.style.setProperty('align-self', 'flex-start', 'important');
      el.style.setProperty('flex', '0 0 auto', 'important');
      // v2.7.2 修复（真机实测定位）：flex-basis:auto + align-self:flex-start 会让链上
      // 各层按内容的 max-content 宽度排布——材料文字 max-content 1664px 时整条链被撑到
      // 1704px，而左栏只有 996px，overflow-x:hidden 把右半全部裁掉：文字被横切、
      // 表格/图片被横切（用户报「图片显示不全、文字也显示不全」）。显式 width 压住
      // max-content：横向恒等栏宽（拖分隔条/适应收窄时跟随重排），纵向仍靠
      // flex:0 0 auto 按内容高度流式排布（拉伸链修复不受影响）。
      // 宿主 .materials-container 是 cvZoomApply 的缩放对象：宽度恒 100%——
      // v2.7.6 实测：zoom 坐标系里 width:100% 的视觉宽本就等于栏宽（百分比在
      // 元素自身坐标系解析），补偿 100/s% 反而溢出 (1/s-1)×栏宽 被裁。
      // 宿主缩放时 stickLeftCol 不得按 zoom 改宽度，只保留 100%。
      el.style.setProperty('width', '100%');
      el.style.setProperty('min-width', '0', 'important');
      el.style.setProperty('box-sizing', 'border-box', 'important');
    });
  }
  try { window.addEventListener('resize', function () { stickyTopOff = 0; }); } catch (e) {}

  function flattenGroup(group) {
    if (group.getAttribute(FLAT_ATTR) !== '1') {
      relaxEl(group);
      relaxHeight(group);
      // 分栏骨架：只解锁高度——两栏布局原样保留（材料在左向下延伸、题目在右向下延伸，
      // 页面整体滚动）；宽度一个不动（左栏 615px 定宽、分隔条都还能拖）。
      // 例外：某层若是 absolute/fixed 定位（分栏偏移锚定），才连带解锁宽度与偏移。
      function relaxCol(el) {
        if (!el) return;
        relaxHeight(el);
        var cs = null;
        try { cs = getComputedStyle(el); } catch (e) {}
        if (cs && (cs.position === 'absolute' || cs.position === 'fixed')) relaxEl(el);
      }
      relaxCol(group.querySelector('.resizable-container'));
      relaxCol(group.querySelector('app-resizable'));
      ['.nz-resizable.left', '.left', '.left-section', '.left-part', 'app-materials'].forEach(function (sel) {
        relaxCol(group.querySelector(sel));
      });
      var mat = group.querySelector('.materials-container');
      if (mat) relaxHeight(mat);
      var mb = group.querySelector('.material-body');
      if (mb) relaxHeight(mb);
      ['.right', '.right-section', '.right-part'].forEach(function (sel) {
        relaxCol(group.querySelector(sel));
      });
      var qc = group.querySelector('.questions-container');
      if (qc) {
        relaxCol(qc);
        qc.style.setProperty('overflow', 'visible', 'important');
      }
      // tab 栏隐藏（整列延伸后无意义）；分隔条保留（仍可拖宽材料栏）
      var anchors = group.querySelector('.questions-anchors');
      if (anchors) anchors.style.setProperty('display', 'none', 'important');
      [].slice.call(group.querySelectorAll('a.label-tab')).forEach(function (el) {
        el.style.setProperty('display', 'none', 'important');
      });
      group.setAttribute(FLAT_ATTR, '1');
    }
    // 左栏吸顶（幂等重断言： Angular 重渲染会重置左栏行内样式）
    stickLeftCol(group);
    // 子题逐层解锁宽度（幂等；重渲染后 Angular 可能重置，扫描时重断言）
    subsOf(group).forEach(relaxSubLayout);
    // 材料大图/表格不超出所在栏
    [].slice.call(group.querySelectorAll('.material-body img, .material-body table')).forEach(function (el) {
      el.style.setProperty('max-width', '100%', 'important');
    });
    expandScrollBoxes(group);
    expandAncestorBoxes(group); // 组外的祖先滚动壳同样解锁（v2.6.3 关键补漏）
  }

  // 关闭展平（控制台切换）：还原内联样式（relax 记录的原始 style 优先，最后写回）
  function unflattenGroup(group) {
    if (group.getAttribute(FLAT_ATTR) !== '1') return;
    [].slice.call(group.querySelectorAll('[' + STICKY_ATTR + ']')).forEach(function (el) {
      el.removeAttribute(STICKY_ATTR); // 行内样式由下方 RELAX_ATTR 还原链路恢复
    });
    ['.nz-resizable-handle', '.nz-resize-handle', '.questions-anchors'].forEach(function (sel) {
      var el = group.querySelector(sel);
      if (el) el.style.display = '';
    });
    [].slice.call(group.querySelectorAll('a.label-tab')).forEach(function (el) { el.style.display = ''; });
    [].slice.call(group.querySelectorAll('[' + FLAT_BOX + ']')).forEach(function (el) {
      el.style.overflowY = '';
      el.style.height = '';
      el.style.maxHeight = '';
      el.removeAttribute(FLAT_BOX);
    });
    // 还原组外被解锁的祖先滚动壳（v2.6.3）
    flatAncestors.forEach(function (el) {
      if (!el || !el.isConnected) return;
      var saved = el.getAttribute(RELAX_ATTR);
      el.setAttribute('style', saved || '');
      if (!saved) el.removeAttribute('style');
      el.removeAttribute(FLAT_BOX);
      el.removeAttribute(RELAX_ATTR);
    });
    flatAncestors.length = 0;
    var relaxed = [group].concat([].slice.call(group.querySelectorAll('[' + RELAX_ATTR + ']')));
    relaxed.forEach(function (el) {
      var saved = el.getAttribute(RELAX_ATTR);
      el.setAttribute('style', saved || '');
      if (!saved) el.removeAttribute('style');
      el.removeAttribute(RELAX_ATTR);
    });
    group.removeAttribute(FLAT_ATTR);
  }

  /* ---------- ⑧ B2 自制画布：材料草稿 + 子题草稿 ---------- */
  // 为什么自制：粉笔 web 端材料区没有草稿入口；子题的 li.draft.tool 实测点击无效
  // （草稿由组级托管，且组级草稿会覆盖全组）。因此材料与每个子题各挂一个自制画布：
  //   - absolute 覆盖宿主（材料=整个材料区；子题=题干+选项区），z-index 130 与原生草稿同级，
  //     字母盒 260 / 工具条 140 仍在其上；
  //   - 模式两档循环：演算（手/笔皆可写）↔ 穿透（画布不挡指针）；
  //   - 笔迹按归一化坐标（0~1）存 localStorage，退出重进自动重放，容器尺寸变化不失真；
  //   - 笔画用 arc 逐点画圆（与粉笔同款渲染路径），笔色/粗细走⑤笔刷 hook（class 含 pen）。
  var CV_LS_PREFIX = 'marvis-fb-cv-';
  var CV_MAX_STROKES = 300;   // 单画布笔画数上限（超出丢最旧）
  var CV_MAX_POINTS = 1200;   // 单笔画点数上限
  var CV_MAX_BYTES = 200000;  // 单 key 存储上限（约 200KB）
  var CV_ZOOM_MIN = 0.55;     // 材料自适应缩小的可读性下限
                              // （材料含被栏宽钳制的图片/表格时 zoom 缩不动媒体，
                              //  收窄也装不下就缩到下限、剩余滚动查看）
  var CV_MODES = ['draw', 'pass']; // 演算(全写，默认) ↔ 穿透，点按循环
  var cvRegistry = [];        // 所有存活画布（pagehide 时统一落盘）
  var cvSaveTimers = {};
  var cvStorageOk = true;

  function cvLoad(key) {
    try {
      var raw = localStorage.getItem(CV_LS_PREFIX + key);
      if (!raw) return null;
      var d = JSON.parse(raw);
      return d && Array.isArray(d.strokes) ? d : null;
    } catch (e) { return null; }
  }

  // 笔画统一用归一化坐标 [x, y]（0~1，相对画布尺寸）存储，分辨率无关
  function cvCap(strokes) {
    var out = strokes.slice(-CV_MAX_STROKES);
    for (var i = 0; i < out.length; i++) {
      if (out[i] && out[i].length > CV_MAX_POINTS) out[i] = out[i].slice(-CV_MAX_POINTS);
    }
    return out;
  }

  // v2.7.8：清洗笔迹——旧版 fpFinish 的坐标 bug（把 [x,y] 数组当对象读）会往存储里
  // 写一堆 null；这些 null 再被 fpMigrate 迁移会压成同一个常量点（整笔退化成一个点，
  // 画出来什么都没有）。加载时直接丢弃「非法点」和「所有点重合」的坏笔。
  function cvSanitize(strokes) {
    var out = [];
    for (var i = 0; i < strokes.length; i++) {
      var s = strokes[i];
      if (!s || !s.length) continue;
      var pts = [];
      for (var j = 0; j < s.length; j++) {
        var p = s[j];
        if (!p || p.length < 2) continue;
        var x = +p[0], y = +p[1];
        if (!isFinite(x) || !isFinite(y)) continue;
        pts.push([x, y]);
      }
      if (pts.length < 2) continue;  // 单点笔迹不算笔（tap 本来就不落笔）
      var degenerate = true;
      for (var k = 1; k < pts.length; k++) {
        if (Math.abs(pts[k][0] - pts[0][0]) > 1e-6 || Math.abs(pts[k][1] - pts[0][1]) > 1e-6) {
          degenerate = false; break;
        }
      }
      if (!degenerate) out.push(pts);
    }
    return out;
  }

  function cvSave(key, strokes, mode, coordVer) {
    if (!cvStorageOk) return;
    try {
      // v2.7.8：v=2 表示「视口归一化坐标」（整页草稿层）；v=1 是旧版题目框坐标。
      // 记录版本是为了让刷新后的新 cv 知道笔迹已迁移过——否则每次重开都会把
      // 视口坐标当框坐标再迁移一次，笔迹越跑越偏（真机 E2E 实测：刷新后重开
      // 笔迹数据还在但画到视口外、看不见）。
      var ver = coordVer === 2 ? 2 : 1;
      var capped = cvCap(strokes);
      var payload = JSON.stringify({ v: ver, mode: mode || 'draw', strokes: capped });
      if (payload.length > CV_MAX_BYTES) {
        payload = JSON.stringify({ v: ver, mode: mode || 'draw', strokes: capped.slice(-40) });
      }
      localStorage.setItem(CV_LS_PREFIX + key, payload);
    } catch (e) {
      cvStorageOk = false; // 配额溢出等：本会话不再落盘（内存笔迹不受影响）
    }
  }

  function cvScheduleSave(cv) {
    var key = cv.key;
    if (cvSaveTimers[key]) clearTimeout(cvSaveTimers[key]);
    cvSaveTimers[key] = setTimeout(function () {
      cvSaveTimers[key] = 0;
      cvSave(key, cv.strokes, cv.mode, cv.coordVer);
    }, 500);
  }

  function cvFlushAll() {
    Object.keys(cvSaveTimers).forEach(function (k) {
      if (cvSaveTimers[k]) { clearTimeout(cvSaveTimers[k]); cvSaveTimers[k] = 0; }
    });
    cvRegistry.forEach(function (cv) { cvSave(cv.key, cv.strokes, cv.mode, cv.coordVer); });
  }

  function penPoint(canvas, e) {
    var r = canvas.getBoundingClientRect();
    var sx = r.width ? canvas.width / r.width : 1;
    var sy = r.height ? canvas.height / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  // 平板 / 触控笔快速书写时，浏览器会把一次笔程里的多个点合并进同一个 pointermove
  // 事件（coalesced events）。若只取 e.clientX/Y 就会丢掉中间点 → 采样过稀 →
  // 曲线被近似成折线、圆圈变成多边形（典型「画不了弧线」症状）。展开被合并的
  // 中间点，笔迹才平滑。无该 API 的环境（旧 Safari 等）回退到单点，行为不变。
  function penCoalesce(e) {
    try {
      if (typeof e.getCoalescedEvents === 'function') {
        var list = e.getCoalescedEvents();
        if (list && list.length) return list;
      }
    } catch (err) {}
    return [e];
  }

  function penDot(ctx, x, y) {
    if (!ctx) return;
    if (!isFinite(x) || !isFinite(y)) return; // 防御：历史坏数据里的 null/NaN 不画
    ctx.fillStyle = brushColor; // 笔刷 hook 统一改写为当前笔色（保留 alpha）
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2); // 半径 2 量级，落在 hook 的缩放区间内
    ctx.fill();
  }

  function penReplay(canvas, strokes) {
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) {}
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var w = canvas.width, h = canvas.height;
    for (var i = 0; i < strokes.length; i++) {
      var s = strokes[i];
      if (!s || !s.length) continue;
      var px = [];
      for (var j = 0; j < s.length; j++) px.push({ x: s[j][0] * w, y: s[j][1] * h });
      penStrokePath(ctx, px);
    }
  }

  // 笔迹统一笔刷样式：色走笔刷 hook（已在 Fenbi 草稿 canvas 上强制为当前笔色、保留 alpha），
  // 线宽 = 4×笔宽（与旧点阵直径一致：旧点半径 2、hook 再乘笔宽 → 直径 4×笔宽）。
  function penStrokeStyle(ctx) {
    if (!ctx) return;
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = 4 * brushWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  /* 笔迹绘制：Catmull-Rom 样条（与粉笔原生画笔同族：cardinal spline，tension 0.5）
     转三次贝塞尔逐段描。
     为什么不用「中点二次贝塞尔」：那条曲线虽然平滑，但**不经过采样点**——
     采样一稀（平板主线程卡、pointermove 被浏览器合并）形状就走样成折线；
     Catmull-Rom 从前后邻点取切线，既没有尖角、又贴着笔的真实轨迹，
     视觉上与粉笔原生草稿画出来的完全一致。
     done：已画到第几段（增量调用时只补画新段，不全量重绘）。 */
  function penAdvance(ctx, pts, done) {
    if (!ctx) return done || 0;
    var n = pts.length, d = done || 0;
    while (d + 2 <= n - 1) {             // 需要 pts[d+2] 才能定右切线，缺就等下一个点
      var p0 = d > 0 ? pts[d - 1] : pts[d];
      var p1 = pts[d], p2 = pts[d + 1];
      var p3 = d + 2 <= n - 1 ? pts[d + 2] : pts[d + 1];
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
      ctx.stroke();
      d++;
    }
    return d;
  }

  // 收尾：补最后一段（末端用沿末段方向的虚拟点，曲线不留尖角）；2 点笔画则直接连线。
  function penFinalize(ctx, pts) {
    if (!ctx) return;
    var n = pts.length;
    if (n < 2) return;
    if (n === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      return;
    }
    var p0 = pts[n - 3], p1 = pts[n - 2], p2 = pts[n - 1];
    var p3 = { x: p2.x + (p2.x - p1.x), y: p2.y + (p2.y - p1.y) };
    var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
    ctx.stroke();
  }

  // 整笔（用于重放）：单点画圆点，多点点阵平滑成曲线。
  function penStrokePath(ctx, pts) {
    if (!ctx || !pts || !pts.length) return;
    if (pts.length === 1) { penDot(ctx, pts[0].x, pts[0].y); return; }
    penStrokeStyle(ctx);
    penAdvance(ctx, pts, 0);
    penFinalize(ctx, pts);
  }

  // 找元素向上最近的「真滚动容器」（内容超高且 overflow 可滚）；找不到返回 null = 滚页面
  function scrollerOf(el) {
    var n = el;
    for (var i = 0; n && i < 12; i++) {
      try {
        if (n.scrollHeight - n.clientHeight > 4) {
          var win = n.ownerDocument && n.ownerDocument.defaultView;
          var oy = (win || window).getComputedStyle(n).overflowY;
          if (oy === 'auto' || oy === 'scroll') return n;
        }
      } catch (e) {}
      n = n.parentElement;
    }
    return null;
  }

  function attachPen(canvas, cv) {
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) {}
    var drawing = false, pts = [], last = null, done = 0;
    var stroke = null;   // v2.8.11：本笔所属指针 + 已收坐标（防两路指针流把笔画画两遍）
    cv.__drawing = false;
    cv.__abort = function () { // 模式切换/重建时中断进行中的书写
      drawing = false; pts = []; last = null; done = 0; cv.__drawing = false; stroke = null;
    };
    canvas.addEventListener('pointerdown', function (e) {
      if (cv.mode === 'pass') return; // 穿透模式 pointer-events:none，理论收不到，兜底
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drawing = true;
      cv.__drawing = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      last = penPoint(canvas, e);
      pts = [last]; done = 0;
      stroke = { pointerId: e.pointerId, pointerType: e.pointerType, seen: {}, seenKeys: [],
                 // v2.8.13：与 fp 路径同一套归属语义（允许中途换 id，只拒绝自己 down 过的指针）
                 ids: (function () { var m = {}; m[e.pointerId] = true; return m; })(),
                 downIds: penStat.downIds };
      fpStrokeDup(stroke, last);
      penDot(ctx, last.x, last.y);
      penStrokeStyle(ctx);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      // v2.8.11：只收本笔所属指针的事件；同一物理坐标不收两遍
      if (!fpStrokeOwns(stroke, e)) return;
      var evs = penCoalesce(e);
      for (var k = 0; k < evs.length; k++) {
        var p = penPoint(canvas, evs[k]);
        var dx = p.x - last.x, dy = p.y - last.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= 0.35) {             // 只收有意义的位移；阈值调细（一页成卷下主线程卡、采样稀），贝塞尔曲线更顺
          if (fpStrokeDup(stroke, p)) continue;
          pts.push(p);
          last = p;
        }
      }
      done = penAdvance(ctx, pts, done); // 增量补画新段，不全量重绘
      e.preventDefault();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) {
      canvas.addEventListener(t, function (e) {
        if (!drawing) return;
        // v2.8.11/v2.8.13：别的指针收笔不动本笔（只认本笔认领过的指针）
        if (e && !fpStrokeEnds(stroke, e)) return;
        drawing = false;
        cv.__drawing = false;
        if (pts.length >= 2) penFinalize(ctx, pts);
        if (pts.length >= 1) {
          var w = canvas.width || 1, h = canvas.height || 1;
          cv.strokes.push(pts.map(function (p) { return [p.x / w, p.y / h]; }));
          cvScheduleSave(cv);
        }
        pts = []; last = null; done = 0; stroke = null;
      });
    });
  }

  // 模式全句提示（弹窗用）：材料=材料区域；子题=第 N 题的题目区域
  function cvSubNo(cv) {
    var idx = cv.host && cv.host.querySelector ? cv.host.querySelector('.title-index') : null;
    return idx ? (idx.textContent || '').replace(/[^\d]/g, '') : '';
  }

  function drawLabel(cv) {
    if (cv.key && cv.key.indexOf('mat-') === 0) return '材料区域草稿已打开，当前可书写，不可触摸。';
    var no = cvSubNo(cv);
    return (no ? '第' + no + '题的题目区域' : '题目区域') + '草稿已打开，当前可书写，不可触摸。';
  }

  function passLabel(cv) {
    if (cv.key && cv.key.indexOf('mat-') === 0) return '材料区域草稿已让位，当前可触摸，不可书写。';
    var no = cvSubNo(cv);
    return (no ? '第' + no + '题的题目区域' : '题目区域') + '草稿已让位，当前可触摸，不可书写。';
  }

  // v2.7.8 整页草稿提示：整页都可写、滚动已锁定（用户 iPad 实测书写/滚动冲突后定稿）
  // v2.7.9：两态化——可触摸不再是「退出」，而是「只放行 ABCD/下一题」的锁定态
  // v2.8.0：入口改成题目右上角的原生草稿笔图标，出口在右侧草稿竖条上
  function fpDrawLabel(cv) {
    var no = cvSubNo(cv);
    return (no ? '第' + no + '题' : '本题') +
      '整页草稿已打开：整个页面都可书写（滚动已锁定）；写完点右侧草稿栏的「当前可触摸」答题。';
  }

  function fpPassLabel(cv) {
    var no = cvSubNo(cv);
    return (no ? '第' + no + '题' : '本题') +
      '当前可触摸：只可点 ABCD / 下一题 / 右侧草稿栏，其余按钮已锁定；点「当前可书写」可继续写。';
  }

  function fpExitLabel() {
    return '已退出整页草稿：页面恢复正常，笔迹已保存；再点这道题的草稿笔图标可继续写。';
  }

  /* ---- v2.7.8 整页草稿态锁定滚动 ----
     用户 iPad 实测：整页草稿开着时笔在写、手指一碰页面就滚，两个手势互相打架。
     定稿：可书写态 = 纯书写状态，页面不许滚。
     实现选择（真机两次实测对比后定）：
       ① 不用 html/body overflow:hidden 锁——文档滚动容器一消失，Chrome 会把
          scrollY 钳回 0（实测：43k 高的文档一开层就从 42934 跳回顶部，用户正在
          看的那道题瞬间「跳走」）；且粉笔自己的 JS 还会把 html 行内 style 重写成
          「overflow-y:auto !important」覆盖我们的样式，要不停补锁；
       ② 改为拦输入事件：document 捕获层 touchmove / wheel preventDefault——
          页面停在原位，手指拖不动、滚轮也滚不动；笔的 pointer 流不受影响
          （书写照常），轻点（tap）也不受影响（只拦 move，我们自己的按钮照常点）。
     fpClose 移除监听即恢复。 */
  var fpScrollLock = null;
  function fpLockScroll() {
    if (fpScrollLock) return;
    fpScrollLock = {
      touch: function (e) { e.preventDefault(); },  // 手指/笔的拖动手势一律不给页面
      wheel: function (e) { e.preventDefault(); }   // 桌面滚轮/触控板同样不滚
    };
    document.addEventListener('touchmove', fpScrollLock.touch, { capture: true, passive: false });
    document.addEventListener('wheel', fpScrollLock.wheel, { capture: true, passive: false });
  }

  function fpUnlockScroll() {
    if (!fpScrollLock) return;
    document.removeEventListener('touchmove', fpScrollLock.touch, { capture: true });
    document.removeEventListener('wheel', fpScrollLock.wheel, { capture: true });
    fpScrollLock = null;
  }

  // 全句提示弹窗（顶部居中淡入淡出，不打断操作；仅用户切到演算态时弹出）
  var cvToastTimer = 0;
  function cvToast(msg) {
    if (!document.body) return;
    var el = document.getElementById('marvis-cv-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'marvis-cv-toast';
      el.style.cssText = 'position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:2147483000;' +
        'padding:10px 18px;border-radius:10px;background:rgba(28,32,38,.88);color:#fff;' +
        'font:600 15px/1.5 -apple-system,"PingFang SC",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
        'pointer-events:none;opacity:0;transition:opacity .25s;max-width:80vw;text-align:center;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(cvToastTimer);
    cvToastTimer = setTimeout(function () { el.style.opacity = '0'; }, 2600);
  }

  function applyCvMode(cv) {
    if (!cv) return;
    if (cv.fpEligible) {
      // v2.8.0：整页草稿是一个「会话」，会话内两态：可书写(draw) ↔ 可触摸(pass)。
      // 未开会话时（__fpSess=false）什么也不做：不建层、不锁滚动、不拦点击。
      if (!cv.__fpSess) { cvSyncBtn(cv); return; }
      if (cv.mode === 'draw') fpOpen(cv);   // 可书写：开层 + 锁滚动 + 手指点按无效
      else fpEnterPass(cv);                 // 可触摸：层留着（笔迹可见）+ 解锁滚动 + 只放行 ABCD
      fpQuietSync();                        // v2.8.13：静音跟着模式走（可触摸态要能用手写原生草稿）
      cvSyncBtn(cv);
      return;
    }
    if (!cv.canvas) return;
    cv.canvas.style.pointerEvents = cv.mode === 'pass' ? 'none' : 'auto';
    cvSyncBtn(cv);
    if (cv.__abort) cv.__abort(); // 模式切换即中断进行中的书写/滚动手势
  }

  function cvSyncBtn(cv) {
    // v2.8.0：资料分析子题没有自己的悬浮按钮，状态同步全交给右侧草稿竖条
    if (cv && cv.fpEligible) { fpDockSync(); return; }
    if (!cv || !cv.toggleBtn) return;
    var meta = {
      draw: ['当前可书写', '演算中：手/笔皆可书写；点按切到「当前可触摸」'],
      pass: ['当前可触摸', '画布不挡指针：可滚动/选中/点击下方内容；点按切回「当前可书写」']
    }[cv.mode] || ['当前可书写', ''];
    cv.toggleBtn.textContent = meta[0];
    cv.toggleBtn.title = meta[1];
    cv.toggleBtn.className = 'marvis-cvbtn' + (cv.mode === 'pass' ? '' : ' marvis-cvbtn-on');
  }

  /* ---------- v2.7.7 整页草稿层（仅资料分析子题，fpEligible） ---------- */
  // 展开态：body 级透明层(fixed inset:0, pointer-events:none)盖住视口，笔/鼠标经
  // window 捕获层 + setPointerCapture 在层内 canvas 上书写；层对 HitTesting 隐身，
  // 页面本体的滚动/点击照旧。任何时候最多一层。
  // v2.7.9：会话两态（可书写 / 可触摸·锁定），工具条不再飞右上角。
  var FP_LAYER_ID = 'marvis-fp-layer';
  var FP_DOCK_ID = 'marvis-fp-dock';    // v2.8.0 草稿竖条（替代原来的两个悬浮按钮）
  var FP_PILL_ID = 'marvis-fp-pill';    // 仅用于清理旧版残留的右上角胶囊
  // 我们自己的悬浮控件：落在上面一律放行（保持原生点击），绝不当成笔迹
  var FP_CTRL_SEL = '#marvis-fp-dock, #marvis-flat-chip, .marvis-brush-panel, ' +
    '.answer-card-container, #marvis-cv-toast, #marvis-fp-pill';
  // 书写态手指唯一可点的东西：草稿竖条（切换/清空/退出都在里面，必须够得着）
  // v2.8.12：加 #marvis-pen-diag-box —— 笔迹自检浮层必须能点（复制/关闭）
  var FP_TOUCH_SEL = '#marvis-fp-dock, #marvis-flat-chip, .marvis-brush-panel, #marvis-cv-toast, #marvis-pen-diag-box';
  // 触摸态唯一可点的东西：上面这些 + 本题字母盒（ABCD + 下一题）+ 本子的草稿笔图标
  var FP_CLICK_SEL = FP_TOUCH_SEL + ', .marvis-lbox, .marvis-lbtn, .marvis-next, li.draft.tool';
  // 页面可交互元素：鼠标落上去放行（点选项=点击）；笔落上去轻点则转发点击
  var FP_BTN_SEL = 'button, a[href], input, select, textarea, label, [role="button"], ' +
    '[role="radio"], [role="checkbox"], [nz-radio], nz-radio-group, li.choice-radio, .marvis-lbtn, ' +
    'li.draft.tool';
  var fpOwner = null;   // 会话归属画布（draw/pass 两态都算会话开着）
  var fpPen = null;     // 层内 canvas（全局唯一，随层创建）
  var fpDown = null;    // 进行中的笔势 { pts, last, t0, target, cv }
  var fpTipAt = 0;      // 「当前不可触摸 / 已锁定」提示节流时间戳

  function fpHitSel(el, sel) {
    return !!(el && typeof el.closest === 'function' && el.closest(sel));
  }

  /* v2.8.1：整页草稿的唯一准入判据 =「一拖五」资料分析组内子题。
     `app-ti.question-multiple` 是全站题目的组件名（普通单题也用它，2026-10-26
     真机实测：题 1~8 全是 app-ti.question-multiple），所以它**绝不能**当子题判据
     ——v2.8.0 就栽在这里：普通题点草稿笔图标也被拽进整页草稿 + 右侧竖条。
     真判据只有一个，与 processTi 建画布的口径完全一致：所在的 .ti 是组
     （含 .materials-container / .questions-anchors）。 */
  function fpInGroup(sub) {          // 纯结构判定（不看开关）
    if (!sub || typeof sub.closest !== 'function') return null;
    var ti = sub.closest('.ti');
    if (!ti) return null;
    return isGroupTi(ti) ? ti : null;
  }

  // 决策版（三道闸都用它）：v2.8.2 起再叠一层「板块开关」——用户可以在右下角
  // 胶囊面板里把「资料分析 · 1拖5」单独关掉，那时整页草稿一律不受理。
  function fpGroupOfSub(sub) {
    if (!groupEnabled()) return null;
    return fpInGroup(sub);
  }

  // 自愈：清掉 v2.8.0 在普通题（非组内子题）上误建的 fpEligible 画布。
  // 只认「被我们打过 CV_ATTR 的 app-ti」，正常资料分析子题原样保留。
  function cvPurgeStrayFp() {
    var tagged;
    try { tagged = document.querySelectorAll('app-ti.question-multiple[' + CV_ATTR + ']'); } catch (e) { return; }
    for (var i = 0; i < tagged.length; i++) {
      var sub = tagged[i];
      var cv = sub.__marvisCv;
      if (!cv || !cv.fpEligible) continue;      // 不是整页草稿画布，不动
      if (fpInGroup(sub)) continue;             // 结构上确实是（一拖五）子题：保留
      if (fpOwner === cv) fpExit();
      try { delete sub.__marvisCv; } catch (e2) { sub.__marvisCv = null; }
      try { sub.removeAttribute(CV_ATTR); } catch (e3) {}
      var junk = sub.querySelectorAll('canvas.marvis-pen, .marvis-cv-tools');
      for (var j = 0; j < junk.length; j++) junk[j].remove();
    }
  }

  function fpIsInteractive(el) {
    return fpHitSel(el, FP_BTN_SEL);
  }

  // 指针分流总闸（纯函数，单测直接打表）：这一笔到底抓不抓
  // 笔(pen)的走向：
  //   - 普通单题（fpOwner 为空）→ 此处直接 false，笔与手指一样落粉笔原生草稿（原生画曲线）
  //   - 一拖五/一页成卷组（fpOwner 存在）→ 原生组级草稿被 neutralizeGroupDraft 隐藏
  //     （它本是盖住整组的透明层、会吃掉所有点击，不能复活），故笔被脚本接管、走自建
  //     整页草稿层；该层自 v2.8.5 起已用二次贝塞尔平滑，v2.8.6 又把采样阈值调细，曲线更顺。
  //   结论：两种情况笔都不再画折线；若仍见折线，几乎必然是 Tampermonkey 仍是旧版未更新。
  function fpGate(e) {
    if (!fpOwner || fpOwner.mode !== 'draw') return false;
    if (e.pointerType === 'touch') return false;                       // 手指不接管 → 落原生草稿（画曲线）
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return false;
    var t = e.target;
    if (fpHitSel(t, FP_CTRL_SEL)) return false;
    if (e.pointerType === 'mouse' && fpIsInteractive(t)) return false; // 鼠标点按钮=点击
    return true;
  }

  // 提示节流：手指连点时不要把 toast 刷成闪烁
  function fpTip(msg, gap) {
    var now = Date.now();
    if (now - fpTipAt < (gap || 1500)) return;
    fpTipAt = now;
    cvToast(msg);
  }

  /* 书写态：手指点按一律无效（纯书写状态，笔写/手指滚动手势不能打架）。
     pointerdown 的 preventDefault 在部分浏览器仍会合成 click，故再拦一层
     touchstart（preventDefault 掉 touchstart 可确保不合成 click）。两者都只在
     我们自己的控件（右侧草稿竖条）上放行——否则连「切回可触摸/退出」都按不了。
     v2.8.0：用户「当前可书写时弹出『当前不可触摸』这个弹窗没用，取消掉」——
     静默拦截，不再弹提示。 */
  function fpTouchStart(e) {
    if (!fpOwner || fpOwner.mode !== 'draw') return;
    if (fpHitSel(e.target, FP_TOUCH_SEL)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  /* 触摸态（锁定）：只放行 ABCD / 下一题 / 草稿竖条 / 本题草稿图标，其余点击全部吃掉
     （用户：「别的按钮应该都覆盖掉」）。用捕获层 click 过滤而不是遮罩层：
     不改布局、不影响滚动、也不影响笔迹重放。
     我们自己为了「点 ABCD 就等于点原生选项」而合成的 click（label.click()）走
     fpAllowOnce 记数放行，否则会被自己拦掉、选项永远选不上。 */
  var fpClickBypass = 0;
  function fpAllowOnce(fn) {
    fpClickBypass++;
    try { fn(); } finally { fpClickBypass--; }
  }

  function fpPassClick(e) {
    if (!fpOwner || fpOwner.mode !== 'pass') return;
    if (fpClickBypass > 0) return;                    // 我们自己的合成点击
    if (fpHitSel(e.target, FP_CLICK_SEL)) return;      // 白名单：ABCD/下一题/竖条/草稿图标
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    fpTip('当前只可点 ABCD / 下一题 / 右侧草稿按钮');
  }

  /* ---------- v2.8.0 草稿竖条（仿粉笔原生草稿工具条） ----------
     用户要求：「把『当前可触摸』和『当前可书写』集成到原生那个草稿按钮，清空也集成进去」。
     实测结构（tools/cdp-probe-native-draft*.js）：资料分析组的原生草稿是**整组一条**
     （.ti > .draft-container > app-draft > canvas#draft + .tools-container），而且被本
     脚本整体隐藏（组成员画布会给全组指针事件兜底，见 neutralizeGroupDraft）——没地方
     直接塞按钮，也不该复活它。所以做一条与它同款（#3c464f 深色、竖排、贴右边缘、
     12px 圆角、20px 图标 + 11px 白字、activate 高亮）的竖条，只放这套草稿真正用得上的
     三项：书写/触摸 切换 · 清空（两步确认）· 退出。
     入口用**原生那个草稿笔图标**（li.draft.tool，每道子题各有一个）——点它就打开/收起
     这道题的整页草稿，和原生草稿按钮的操作感一致，不用再多一个悬浮小按钮。 */
  var fpDock = null;
  var FP_ICO = {
    draw: '<svg class="fpd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14.5 6.5l4 4"/></svg>',
    touch: '<svg class="fpd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12V6a1.5 1.5 0 013 0v6"/><path d="M12 11V5a1.5 1.5 0 013 0v7"/><path d="M15 12V7.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1.1a5 5 0 01-3.8-1.8L5.9 16a1.6 1.6 0 012.4-2.1L9 14.6"/></svg>',
    clear: '<svg class="fpd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9.5 7V4.8a.8.8 0 01.8-.8h3.4a.8.8 0 01.8.8V7"/><path d="M6.2 7l.9 12.2a.9.9 0 00.9.8h8a.9.9 0 00.9-.8L17.8 7"/><path d="M10.2 11v6M13.8 11v6"/></svg>',
    exit: '<svg class="fpd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'
  };

  function fpDockItem(ico, name, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'marvis-fpd-item' + (cls ? ' ' + cls : '');
    b.innerHTML = ico + '<span class="fpd-name">' + name + '</span>';
    return b;
  }

  function fpDockEnsure() {
    if (fpDock && fpDock.el.isConnected) return fpDock;
    var old = document.getElementById(FP_DOCK_ID);
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = FP_DOCK_ID;
    var toggle = fpDockItem(FP_ICO.draw, '当前可书写', 'fpd-toggle');
    var clear = fpDockItem(FP_ICO.clear, '清空', 'fpd-clear');
    var exit = fpDockItem(FP_ICO.exit, '退出', 'fpd-exit');
    el.appendChild(toggle);
    el.appendChild(clear);
    el.appendChild(exit);
    document.body.appendChild(el);
    fpDock = { el: el, toggle: toggle, clear: clear, exit: exit };
    toggle.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation(); fpDockToggle();
    });
    clear.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation(); fpDockClear();
    });
    exit.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation(); fpExit(); cvToast(fpExitLabel());
    });
    return fpDock;
  }

  // 竖条状态同步（会话开关 / 两态文案 / 清空二次确认 / 归属题图标高亮）
  function fpDockSync() {
    var d = fpDock;
    if (!d) return;
    var cv = fpOwner;
    var on = !!cv;
    d.el.classList.toggle('on', on);
    var draw = on && cv.mode === 'draw';
    var name = d.toggle.querySelector('.fpd-name');
    if (name) name.textContent = draw ? '当前可书写' : '当前可触摸';
    d.toggle.classList.toggle('on', draw);
    d.toggle.title = draw
      ? '整页书写中（页面滚动已锁定、手指点按无效）：点按切到「当前可触摸」答题'
      : '点按切回「当前可书写」，继续在这道题上写';
    var armed = !!(on && cv.clearArmed && (Date.now() - cv.clearArmed) < 3000);
    var cname = d.clear.querySelector('.fpd-name');
    if (cname) cname.textContent = armed ? '确认清空' : '清空';
    d.clear.classList.toggle('warn', armed);
    d.clear.title = '清空这道题的整页草稿笔迹（两步确认）';
    d.exit.title = '退出整页草稿：页面恢复普通态，笔迹已保存';
    // 归属提示：会话所属那道题的草稿笔图标高亮，再点它一次即可退出
    try {
      var lit = document.querySelectorAll('li.draft.tool.marvis-fp-pen-on');
      for (var i = 0; i < lit.length; i++) lit[i].classList.remove('marvis-fp-pen-on');
      var sub = on && cv.host && cv.host.closest ? cv.host.closest('app-ti.question-multiple') : null;
      var pen = sub ? sub.querySelector('li.draft.tool') : null;
      if (pen) pen.classList.add('marvis-fp-pen-on');
    } catch (e) {}
  }

  function fpDockToggle() {
    var cv = fpOwner;
    if (!cv) return;
    cv.mode = cv.mode === 'draw' ? 'pass' : 'draw';
    applyCvMode(cv);
    cvSave(cv.key, cv.strokes, cv.mode, cv.coordVer);
    cvToast(cv.mode === 'draw' ? fpDrawLabel(cv) : fpPassLabel(cv));
  }

  function fpDockClear() {
    var cv = fpOwner;
    if (!cv) return;
    var now = Date.now();
    if (cv.clearArmed && now - cv.clearArmed < 3000) {
      cv.strokes.splice(0, cv.strokes.length); // 原地清空：canvas.__marvisStrokes 引用保持有效
      if (cv.canvas) penReplay(cv.canvas, cv.strokes);
      cvSave(cv.key, cv.strokes, cv.mode, cv.coordVer);
      cv.clearArmed = 0;
      fpDockSync();
      cvToast('已清空本题整页草稿');
    } else {
      cv.clearArmed = now;
      fpDockSync();
      cvToast('再点一次「清空」确认（3 秒内）');
      var stamp = now;
      setTimeout(function () {
        if (cv.clearArmed === stamp) { cv.clearArmed = 0; fpDockSync(); }
      }, 3000);
    }
  }

  // 原生草稿笔图标 = 整页草稿开关（仅资料分析子题；普通题照旧开粉笔自己的草稿）
  function fpToggleSession(cv) {
    if (!cv || !cv.fpEligible) return;
    // v2.8.1：双保险——宿主必须是一拖五资料分析组内子题，别的一概不受理
    if (!fpGroupOfSub(cv.host)) return;
    if (fpOwner === cv) { fpExit(); cvToast(fpExitLabel()); return; }
    cv.mode = 'draw';         // 每次都从「可书写」进（状态不记忆）
    cv.__fpSess = true;
    applyCvMode(cv);
    cvSave(cv.key, cv.strokes, cv.mode, cv.coordVer);
    cvToast(fpDrawLabel(cv));
  }

  // 文档捕获层：抢在粉笔自己的草稿处理器之前接管图标点击（**仅一拖五组内子题**）
  function fpPenEntry(e) {
    if (e.__marvisPenDone) return;    // window/document 两层都挂，同一个事件只处理一次
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    var pen = t.closest('li.draft.tool');
    if (!pen) return;
    var sub = pen.closest('app-ti.question-multiple');
    if (!sub) return;
    // v2.8.1：普通单题的草稿图标 → 一律交还原生（它的组件名同样是 question-multiple）
    if (!fpGroupOfSub(sub)) return;
    // v2.9.0：面板开了「分栏草稿 APP式」→ 走左右分栏那一套（整组一张纸）
    if (appModeOn()) {
      e.__marvisPenDone = 1;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      appToggle(sub.closest('.ti'));
      return;
    }
    var cv = sub.__marvisCv;
    if (!cv && typeof ensureSubCanvas === 'function') {
      try { cv = ensureSubCanvas(sub, true); } catch (e0) {}   // 视口门控跳过时补建
    }
    if (!cv || !cv.fpEligible) return;
    e.__marvisPenDone = 1;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    fpToggleSession(cv);
  }

  function fpEnsureLayer() {
    // 旧版（≤v2.7.8）留下的右上角胶囊：工具条已不再飞过去，见到就清掉
    var oldPill = document.getElementById(FP_PILL_ID);
    if (oldPill) oldPill.remove();
    if (fpPen && fpPen.isConnected) return fpPen;
    // 旧版本/重复注入可能留下同名层：先清再建，避免两层叠着
    var oldLayer = document.getElementById(FP_LAYER_ID);
    if (oldLayer) oldLayer.remove();
    var layer = document.createElement('div');
    layer.id = FP_LAYER_ID;
    layer.style.display = 'none'; // 会话未开时收起：可书写/可触摸两态才显示笔迹层
    var cv = document.createElement('canvas');
    cv.className = 'marvis-pen pen';
    layer.appendChild(cv);
    document.body.appendChild(layer);
    fpPen = cv;
    fpSizeCanvas();
    window.addEventListener('resize', fpSizeCanvas);
    // 起笔/移动/收笔全挂 window 捕获层：不依赖 setPointerCapture 一定成功
    // （捕获只是让事件重定向到 canvas；即使失败，窗口级监听照样收得到整段笔程，
    //   iPad Safari 等环境也有兜底）。指针事件在捕获阶段最先到达 window。
    window.addEventListener('pointerdown', fpOnDown, true);
    window.addEventListener('pointermove', fpOnMove, true);
    ['pointerup', 'pointercancel'].forEach(function (t) {
      window.addEventListener(t, fpFinish, true);
    });
    // v2.7.9：两个态的门禁常驻（内部按 fpOwner.mode 判态，无需随开关增删）
    document.addEventListener('touchstart', fpTouchStart, { capture: true, passive: false });
    document.addEventListener('click', fpPassClick, true);
    return cv;
  }

  function fpCtx(cv) {
    try { return cv.getContext('2d'); } catch (e) { return null; }
  }

  function fpSizeCanvas() {
    if (!fpPen) return;
    var w = window.innerWidth || 0, h = window.innerHeight || 0;
    if (!w || !h) return;
    if (fpPen.width !== w || fpPen.height !== h) {
      fpPen.width = w;
      fpPen.height = h;
      if (fpOwner) penReplay(fpPen, fpOwner.strokes); // 归一化坐标按新尺寸重放，笔迹不丢
    }
  }

  /* ---------- v2.8.11 一笔之内的收点归属（治「一条笔画变成两条交错的线」） ----------
     iPad 上 Apple Pencil 的接触会同时产生【两路指针事件】：
       · pointerType='pen'   的指针流（带 getCoalescedEvents 的真实采样）
       · pointerType='touch' 的指针流（iOS 的触摸兼容流，同一批物理采样、不同的 pointerId）
     v2.8.10 的 fpOnMove 挂在 window 捕获层、且对来者不拒 → 两路事件被一起喂进同一个
     点序，点序变成 A,B,A,B… → 样条沿同一条轨迹来回重描；而每次重描时 Catmull-Rom 的
     切线邻域（p0/p3）已被重复点污染 → 两次描出的曲线形状略有差异 →
     屏幕上就是「一条笔画画成两条几乎平行、局部交叉的线」。
     修法（两道闸）：
       1) fpStrokeOwns：一笔只认一个指针（pointerId + pointerType 都要匹配），另一路丢弃；
       2) fpStrokeDup：同一物理坐标只收一次 —— 防 Safari 把同一批 coalesced 采样点重复投递。
     两者都是纯函数，tests/pen-dual-stream-sim.js 直接抽取本文件的实现做离线仿真。 */
  /* v2.8.12：归属判定去掉 pointerType 硬排除。
     之前用「pointerType 必须一致」来隔开 Apple Pencil 的双路指针流，出发点没问题，
     但它隐含假设「同一路事件在整笔里 pointerType 不变」——这条假设在第三方 WebView
     壳里不成立：pointerdown 可能报 'pen'、后续 move 报 'touch'（或反过来）。
     一旦被判成「不是本笔」，整段事件被丢弃 → 笔画被切成几截，每截只剩 1~2 个点 →
     我们只能画直线 → 又是「折线」。
     现在只认 pointerId（指针身份的唯一硬指标）；类型差异交给「采样去重 + 回访检测」
     处理——那两路流报的是同一批物理采样，去重层会天然把重复的那一路吃掉。 */
  /* v2.8.13：归属判定再放宽一步——**允许浏览器在一笔之内更换 pointerId**。
     v2.8.12 只认 pointerId，一旦浏览器中途换了 id（第三方 WebView 壳常见：同一支笔
     的接触被拆成两段不同 id 的生命周期），后续事件全部被判「不是本笔」→ 笔画被截断成
     起笔点那一两个点 → 只能画直线（折线）。
     新规则：
       · 本笔已绑定的 id → 收；
       · 另一个 id，但**它没有自己 down 过**（浏览器中途换 id）→ 收，并改绑到它；
       · 另一个 id，且**它自己 down 过**（真·第二指针：手掌 / 另一支笔）→ 拒绝。
     down 过哪些 id 由全局旁观器记录（penStat.downIds），与我们的落笔路径无关。 */
  function fpStrokeOwns(stroke, e) {
    if (!stroke) return false;
    if (!e) return true;
    var id = e.pointerId;
    if (id === undefined || id === null) return true;
    if (!stroke.ids) stroke.ids = {};
    if (stroke.ids[id]) return true;                 // 本笔已认领的指针
    if (stroke.downIds && stroke.downIds[id]) return false;  // 自己 down 过的第二指针 → 拒绝
    stroke.ids[id] = true;                            // 中途换 id → 认领并改绑
    stroke.pointerId = id;
    return true;
  }

  /* v2.8.13：收笔判定与「移动」判定分开。
     移动：允许浏览器中途换 pointerId（见 fpStrokeOwns）——不收的话笔画会被截断成直线。
     收笔：**只认本笔已认领的指针**。别的指针抬笔（触摸兼容流先抬笔、手掌离开）
     不能把本笔提前收掉。 */
  function fpStrokeEnds(stroke, e) {
    if (!stroke) return false;
    if (!e) return true;
    var id = e.pointerId;
    if (id === undefined || id === null) return true;
    if (!stroke.ids) return id === stroke.pointerId;
    return !!stroke.ids[id];
  }

  // 同一物理采样点是否已经收过（v2.8.13：量化去重只当快速路径，真正的判定改成距离）
  // 亚像素抖动（重复投递时坐标常有 0.2~1px 偏差）抓不住 → 去重失效 → 样条沿同一条
  // 轨迹来回重描 → 一条笔画分成两条交错的线。故：距离 1px 内一律判重（只比最近 256 点）。
  function fpStrokeDup(stroke, p) {
    if (!stroke || !p) return false;
    if (!stroke.seen) { stroke.seen = {}; stroke.seenKeys = []; }
    var k = Math.round(p.x * 4) + ',' + Math.round(p.y * 4);
    if (stroke.seen[k]) return true;
    var n = stroke.pts ? stroke.pts.length : 0;
    var from = n - 256; if (from < 0) from = 0;
    for (var i = from; i < n; i++) {
      var q = stroke.pts[i];
      var dx = p.x - q.x, dy = p.y - q.y;
      if (dx * dx + dy * dy < 1) { stroke.seen[k] = 1; return true; }   // 1px 内 = 同一个物理点
    }
    stroke.seen[k] = 1;
    stroke.seenKeys.push(k);
    if (stroke.seenKeys.length > 512) {
      try { delete stroke.seen[stroke.seenKeys.shift()]; } catch (e) {}
    }
    return false;
  }

  /* v2.8.12 回访检测：新采样点若离「已经走过的某个旧点」很近，说明这是被
     重复/乱序投递的旧采样，而不是笔真的又走了一遍。放行它 = 样条沿原路折返 →
     屏幕上就是一条笔画分叉成两条。
     两档判定（量化去重是 O(1) 快速路径，但抓不住亚像素抖动，这里用距离兜底）：
       · 离**当前位置** < 0.6px  → 只是抖动重复，丢掉；
       · 离**更早的点** < 1.2px  → 回访，丢掉（只比最近 64 个点，且跳过紧邻的上一点，
         避免误杀正常的回头路与打勾）。 */
  function fpStrokeRetrace(stroke, p) {
    if (!stroke || !p || !stroke.pts || !stroke.pts.length) return false;
    var n = stroke.pts.length;
    var last = stroke.pts[n - 1];
    var ldx = p.x - last.x, ldy = p.y - last.y;
    if (ldx * ldx + ldy * ldy < 0.36) return true;   // 0.6px：当前位置的抖动重复
    var from = n - 64; if (from < 0) from = 0;
    for (var i = from; i < n - 1; i++) {
      var q = stroke.pts[i];
      var dx = p.x - q.x, dy = p.y - q.y;
      if (dx * dx + dy * dy < 1.44) return true;   // 1.2px：回访旧点
    }
    return false;
  }

  function fpOnDown(e) {
    // v2.8.0：可书写态手指点按静默无效（用户不要「当前不可触摸」弹窗）——
    // 一律不惊动页面。触摸态(pass)手指完全放行：答案靠点击、滚动靠手指，
    // 由 fpPassClick 把关只放行 ABCD/下一题/竖条。
    var touchAsPen = false;
    if (e.pointerType === 'touch') {
      if (!fpOwner || fpOwner.mode !== 'draw') return;
      if (fpHitSel(e.target, FP_TOUCH_SEL)) return;   // 竖条上的切换/清空/退出必须能按
      if (penStat.penSeen) {
        // 这台设备会报 pointerType=pen → 这次的 touch 就是手指/手掌，挡掉（防误触/防掌心）
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // v2.8.12 自适应：本会话从没见过 pointerType='pen' —— 说明这台浏览器根本不把
      // 触控笔报成 pen（Via 的 WKWebView 壳就是这种），于是「触控笔」会以 touch 到达。
      // 这时把 touch 当笔接管（= 用户说的「统一当成是手写的」），否则笔根本写不出字。
      touchAsPen = true;
    }
    if (!touchAsPen && !fpGate(e)) return;
    e.preventDefault();
    e.stopPropagation(); // 抢在原生草稿/页面处理器之前，书写不惊动页面
    var cv = fpEnsureLayer();
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    var p = penPoint(cv, e);
    fpDown = {
      pts: [{ x: p.x, y: p.y }], last: p, done: 0, t0: Date.now(),
      target: e.target, cv: cv,
      // v2.8.11：记下本笔所属指针 —— 另一路（触摸兼容流）的事件一律不收
      pointerId: e.pointerId, pointerType: e.pointerType,
      // v2.8.13：ids = 本笔认领过的指针集合（允许浏览器中途换 id 时改绑）；
      // downIds = 全局记录「哪些 id 自己 down 过」（用来分辨真·第二指针 vs 中途换 id）
      ids: (function () { var m = {}; m[e.pointerId] = true; return m; })(),
      downIds: penStat.downIds,
      seen: {}, seenKeys: [], rejected: 0,
      // v2.8.12：起笔瞬间给原生草稿画布拍个像素指纹，收笔时再拍一次对比 ——
      // 若期间有像素变化，说明**原生也在画**，即「两个画者」同时落笔（跨 world 也能测）
      fp0: penNativeFingerprint()
    };
    var st0 = penStatStream(e); if (st0) { st0.pts++; }   // down 计数交给全局旁观器（与本路径无关）
    fpStrokeDup(fpDown, p); // 起笔点登记进「已收坐标」
    penDot(fpCtx(cv), p.x, p.y);
    penStrokeStyle(fpCtx(cv));
  }

  function fpOnMove(e) {
    if (!fpDown) return;
    if (e && e.__marvisSynth) return;   // v2.8.7：原生草稿补密用的合成事件，别二次落笔
    // v2.8.11/v2.8.12：只收本笔所属指针的事件（Apple Pencil 会同时冒出 touch 指针流）
    var st = penStatStream(e);
    if (!fpStrokeOwns(fpDown, e)) { fpDown.rejected++; penStat.rejected++; return; }
    var cv = fpDown.cv;
    var ctx = fpCtx(cv);
    var evs = penCoalesce(e);
    penStat.coalescedN++;
    penStat.coalescedSum += evs.length;
    if (evs.length > penStat.coalescedMax) penStat.coalescedMax = evs.length;
    for (var k = 0; k < evs.length; k++) {
      var p = penPoint(cv, evs[k]);
      var last = fpDown.last;
      var dx = p.x - last.x, dy = p.y - last.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= 0.35) {             // 只收有意义的位移；阈值调细（一页成卷下主线程卡、采样稀），贝塞尔曲线更顺，无需直线插值
        if (fpStrokeDup(fpDown, p)) { fpDown.rejected++; penStat.dup++; continue; }  // v2.8.11：同一采样点不收两遍
        // v2.8.12：回访点（重复/乱序投递的旧采样）也不收——放行它会让样条沿原路折返
        if (fpStrokeRetrace(fpDown, p)) { fpDown.rejected++; penStat.retrace++; continue; }
        fpDown.pts.push({ x: p.x, y: p.y });
        fpDown.last = p;
        penStat.pts++;
        if (st) st.pts++;
      }
    }
    fpDown.done = penAdvance(ctx, fpDown.pts, fpDown.done); // 增量补画新段
    e.preventDefault();
    e.stopPropagation(); // 笔程不带给页面（防选中文字/触发页面滚动手势）
  }

  function fpFinish(e) {
    if (!fpDown) return;
    // v2.8.11/v2.8.13：别的指针收笔不动本笔（触摸兼容流先抬笔时不能把笔的笔画提前收掉）
    if (e && !fpStrokeEnds(fpDown, e)) return;
    var d = fpDown;
    fpDown = null;
    var owner = fpOwner;
    if (!owner) return;
    // v2.8.13：up 计数交给全局旁观器（与本路径无关，任何时候都能读到浏览器的真实投递）
    // v2.8.12：收笔时再拍一次原生草稿画布指纹 → 有变化 = 原生也在画（= 两个画者）
    if (d.fp0) {
      var fp1 = penNativeFingerprint();
      var delta = penNativeDelta(d.fp0, fp1);
      penStat.nativeChanged = delta;
    }
    var maxMove = 0;
    for (var i = 1; i < d.pts.length; i++) {
      var dx = d.pts[i].x - d.pts[0].x, dy = d.pts[i].y - d.pts[0].y;
      var m = Math.sqrt(dx * dx + dy * dy);
      if (m > maxMove) maxMove = m;
    }
    var isTap = d.pts.length <= 2 && maxMove < 8 && (Date.now() - d.t0) < 400;
    if (isTap) {
      // 轻点不成笔迹：统一重放擦掉起笔那个点（否则画布上会留一个擦不掉的墨点）
      penReplay(d.cv, owner.strokes);
      // 落在按钮上（笔点答案/翻页）→ 转发一次原生点击，平板上用笔也能选答案。
      // 转发目标取「落点处最深的那个元素」（等价于原生点击的 target），而不是
      // closest 出来的外层按钮：粉笔的选项外层是 li，点多层标签时真正承接点击的是
      // 里面的 label/input，打在外层 li 上的合成 click 不会触发选中。
      if (fpIsInteractive(d.target)) {
        var p0 = d.pts[0];
        var hit = null;
        try {
          hit = (p0 && typeof document.elementFromPoint === 'function')
            ? document.elementFromPoint(Math.round(p0.x), Math.round(p0.y)) : null;
        } catch (e3) {}
        var btn = hit || d.target.closest(FP_BTN_SEL) || d.target;
        if (btn && btn.dispatchEvent) {
          try {
            btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          } catch (e2) {}
        }
      }
      return;
    }
    if (d.pts.length >= 1) {
      if (d.pts.length >= 2) penFinalize(fpCtx(d.cv), d.pts);
      var w = d.cv.width || 1, h = d.cv.height || 1;
      // d.pts 里是 {x, y} 对象（笔迹按 Catmull-Rom 样条平滑渲染，存储仍是归一化坐标点序列）
      owner.strokes.push(d.pts.map(function (p) { return [p.x / w, p.y / h]; }));
      cvScheduleSave(owner);
      penStat.strokes++;
      // v2.8.13：自绘笔台账（点数/起止/时长/被拒事件数）——用来核对「一笔到底收了多少点」
      penStat.fpLedger.push({
        id: d.pointerId, type: d.pointerType, pts: d.pts.length,
        x0: Math.round(d.pts[0].x), y0: Math.round(d.pts[0].y),
        x1: Math.round(d.pts[d.pts.length - 1].x), y1: Math.round(d.pts[d.pts.length - 1].y),
        dur: Date.now() - d.t0, rejected: d.rejected
      });
      if (penStat.fpLedger.length > PEN_LEDGER_MAX) penStat.fpLedger.shift();
    }
  }

  // 旧版（v2.7.6 及之前）子题笔迹存在题目框坐标系；首次展开整页层时按框的当前位置
  // 重映射到视口坐标系——老笔迹不丢、不错位（框被滚出视口时原样保留归一化值）。
  // v2.7.8：迁移状态随存储版本 v=2 持久化（原先是内存标记，刷新即丢，重开又迁移
  // 一次 → 笔迹越迁越偏、画到视口外看不见；真机 E2E 实测）。
  function fpMigrate(cv) {
    if (cv.__fpMigrated || !cv.strokes.length) return;
    var host = cv.host;
    if (!host || typeof host.getBoundingClientRect !== 'function') return;
    var r = host.getBoundingClientRect();
    var vw = window.innerWidth || 1, vh = window.innerHeight || 1;
    // 题框量不到（还没排版/被滚出文档流）就原样保留、不标已迁移：
    // 标了就会把旧框坐标当视口坐标直接画，笔迹整体错位
    if (!r.width || !r.height) return;
    cv.__fpMigrated = true;
    cv.coordVer = 2;
    cv.strokes = cv.strokes.map(function (s) {
      return s.map(function (p) {
        return [(r.left + p[0] * r.width) / vw, (r.top + p[1] * r.height) / vh];
      });
    });
    // 立即落盘（含 v=2 标记）：不等 500ms 防抖，避免「迁移完立刻刷新」又迁一遍
    cvSave(cv.key, cv.strokes, cv.mode, 2);
  }

  // 开会话 / 切到「可书写」态：层显示、笔迹重放、滚动锁定、手指点按变无效
  /* ---------- v2.8.12 画者独占：会话期间让原生草稿「闭嘴」 ----------
     为什么必须做这一步：我们的捕获监听 + stopPropagation 只能拦住**同一个 JS world**
     里的监听器。Via 这类自带脚本注入器的浏览器（iOS 版 = WKWebView 壳）可能把用户
     脚本注入到独立 content world —— 此时我们与页面里的粉笔原生草稿互不可见，
     同一笔会被「我们」和「原生」各画一遍：两套不同的平滑算法（Catmull-Rom vs
     粉笔的 cardinal spline）画同一段轨迹，形状略有差异 → 屏幕上就是两条交错的线。
     结构性解法：**会话期间让原生草稿画布收不到任何指针事件**（pointer-events:none），
     这样不论几个 world、几个实例，都只有一个画者。
     作用域只限一拖五组（[data-marvis-fpgroup]），普通单题的原生草稿（用户还要用
     手指在上面写）完全不受影响。 */
  var QUIET_ID = 'marvis-fp-quiet';
  function fpQuietOn() {
    try {
      if (document.getElementById(QUIET_ID)) return;
      var st = document.createElement('style');
      st.id = QUIET_ID;
      st.textContent = '[' + FPGRP_ATTR + '] app-draft canvas{pointer-events:none !important;}';
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }
  function fpQuietOff() {
    try {
      var st = document.getElementById(QUIET_ID);
      if (st) st.remove();
    } catch (e) {}
  }
  /* v2.8.13：静音只在「可书写(draw)」态生效。
     v2.8.12 把静音挂在**会话开关**上（会话一开就静默、退出才恢复），于是会话内切到
     「可触摸(pass)」后，组内原生草稿仍然收不到指针事件 → 用户用手指在原生草稿上
     写字时**根本写不了**（v2.8.12 引入的回归）。
     正确语义：可书写态 = 整页层接管书写，原生必须闭嘴（否则两个画者各画一遍）；
               可触摸态 = 层让开，原生草稿要能正常用手写 → 必须放开。 */
  function fpQuietSync() {
    try {
      if (fpOwner && fpOwner.mode === 'draw') fpQuietOn();
      else fpQuietOff();
    } catch (e) {}
  }

  function fpOpen(cv) {
    // v2.8.2：板块被「部分关闭」时一律不开层（双保险，正常路径在 fpToggleSession 就挡了）
    if (!cv || !fpGroupOfSub(cv.host)) return;
    if (fpOwner !== cv) {
      if (fpOwner) fpClose();       // 一层制：上一个会话先整体退出（落盘 + 解滚动）
      var cvEl = fpEnsureLayer();
      fpMigrate(cv);
      fpOwner = cv;
      cv.canvas = cvEl;
      fpSizeCanvas();
      penReplay(cvEl, cv.strokes);
    }
    cv.__fpSess = true;
    var layer = document.getElementById(FP_LAYER_ID);
    if (layer) layer.style.display = '';
    fpQuietSync(); // v2.8.13：只有「可书写」态才让原生草稿闭嘴
    // v2.8.0：草稿竖条常驻右侧（切换/清空/退出都在里面，滚动锁了也够得着）
    fpDockEnsure();
    fpDockSync();
    fpLockScroll(); // v2.7.8：可书写态 = 纯书写，页面不许滚（笔写/手指滚动冲突）
  }

  // 会话内切到「可触摸」态：层不退（笔迹还看得见）、页面恢复滚动，
  // 点击由 fpPassClick 把关（只放行 ABCD/下一题/竖条/本子草稿图标）
  function fpEnterPass(cv) {
    if (fpOwner !== cv) fpOpen(cv);
    fpUnlockScroll();
  }

  // 退出整个会话：落盘、解滚动、收层、竖条收起
  function fpExit() {
    if (fpDown) fpDown = null;
    var owner = fpOwner;
    fpOwner = null;
    fpUnlockScroll(); // v2.7.8：恢复滚动
    if (owner) {
      owner.__fpSess = false;
      owner.canvas = null;
      owner.mode = 'pass';   // 下次点开从「可书写」进（用户：状态不记忆）
      owner.clearArmed = 0;
      cvSave(owner.key, owner.strokes, owner.mode, owner.coordVer); // 立即落盘，不等防抖
    }
    var layer = document.getElementById(FP_LAYER_ID);
    if (layer) layer.style.display = 'none';
    fpQuietOff(); // v2.8.12：退出会话 → 恢复原生草稿的正常交互
    var pill = document.getElementById(FP_PILL_ID);
    if (pill) pill.remove();
    fpDockSync();   // 会话已空：竖条收起 + 清掉草稿图标高亮
  }

  // 兼容旧调用点（重渲染/宿主报废一律整体退出会话）——fpClose 即 fpExit
  function fpClose() {
    fpExit();
  }

  // 宿主被 Angular 重渲染/切题销毁 → 旧画布报废，它占用的整页层必须收掉
  function fpCloseIfStale() {
    if (fpOwner && (!fpOwner.host || !fpOwner.host.isConnected)) fpClose();
  }

  /* ---------- v2.9.0 资料分析「APP 式分栏草稿」（仿粉笔 APP，用户要求） ----------
     形态：顶部一条草稿栏（关闭 / 笔 / 橡皮 / 撤销 / 反撤 / 清空），下面左右两栏
     各自独立滚动——左栏材料、右栏 5 道子题（共用这一张纸）。
     笔迹落在「内容坐标系」：画在左栏的随材料滚、画在右栏的随题目滚，两侧互不带动
     （用户定稿：左右各一张独立画布）。每侧贴一条可拖的滚动滑块，拖动它滚动、
     不会碰到画布。
     与现有「整页草稿」并存：面板多一行开关，开了以后点子题的草稿笔图标进这个模式。
     笔迹自管（不碰粉笔组级草稿，它仍被 neutralizeGroupDraft 隐藏）；橡皮按用户
     要求先不做，按钮占位禁用。 */
  var APP_LS = 'marvis-fp-appmode';       // 面板开关：1 = 草稿笔图标走 APP 式分栏
  var APP_ATTR = 'data-marvis-app';       // 组壳标记（CSS 全靠它）
  var APP_BAR_ID = 'marvis-app-bar';
  var APP_SHEET_ID = 'marvis-app-sheet';  // v2.9.17：每题一张的草稿纸（替代 v2.9.11 的答题面板）
  var APP_SHEET_RECT_LS = 'marvis-app-sheet-rect';  // v2.9.18 的旧存档，v2.9.19 起只读它把位置迁到中档
  var APP_SHEET_ALPHA_LS = 'marvis-app-sheet-alpha'; // v2.9.18：纸的不透明度
  /* v2.9.18：不透明度四档。用户原话「现在还是有点不够透明」—— 默认从 .90 降到 .70，
     再往下还有 .52 / .34（.34 时下面的题干基本看得清，写字仍够用）。 */
  var SHEET_ALPHAS = [0.85, 0.70, 0.55, 0.42];
  var SHEET_ALPHA_DEF = 0.70;
  var APP_SHEET_SIZE_LS = 'marvis-app-sheet-size';   // v2.9.19：尺寸档位（l / m / s）
  var APP_SHEET_POS_LS = 'marvis-app-sheet-pos';     // v2.9.19：每档各自记住一个位置
  /* v2.9.19：尺寸从「拖手柄自由调」改成三档（用户原话「改成档位吧，默认是最大档，
     铺满屏幕，还有中档和小档」）。l = 铺满，m = 原来的默认，s = 更小一点。 */
  var SHEET_SIZE_TXT = { s: '小', m: '中', l: '大' };
  var SHEET_MIN_W = 380, SHEET_MIN_H = 220;   // 纸头：题号 + ABCD + 小中大 + 4 颗图标所需宽度
  var APP_STYLE_ID = 'marvis-app-style';
  var APP_BAR_H = 46;
  var appCur = null;

  function appModeOn() {
    /* v2.9.5：默认开。只有用户显式关过（存了 '0'）才视为关闭 ——
       以前是「没存过 = 关」，等于这个功能默认藏起来，用户得先翻面板才能用。 */
    try {
      var v = localStorage.getItem(APP_LS);
      return v === null ? true : v !== '0';
    } catch (e) { return true; }
  }
  /* v2.9.9 分栏的唯一交互语义（用户定稿，别再改回去）：
       「不管手和笔，草稿一打开就只能在纸上写字，不能滑动 / 点击下面那一层内容。」
     所以两栏内容区的 touch-action 必须是 none：
       · auto（v2.9.6）= 内核仍可能把笔的拖动当滚动手势 → 笔一落就 pointercancel，
         笔画只剩 1 个点被丢弃，用户看到的就是「用笔写也变成触摸的了」；
       · pan-y（v2.9.4）= 更糟，既替浏览器承诺了平移又收不回来，笔和手指一起废；
       · none = 浏览器在这个容器上完全不做手势滚动，指针流不会被抢走；
       · 也正因为是 none，内容区不存在任何手势滚动 —— 滚动只有两个入口：
         左右两侧那两颗滚动条（手指、笔都能拖）。
     落上来的指针不分 pen / touch / mouse，一律写成笔迹；pointerdown 与合成 click
     都在滚动容器捕获层截住，下面的选项 / 收藏错题 / 子题 tab 一个也收不到。 */
  function appStyle() {
    if (document.getElementById(APP_STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = APP_STYLE_ID;
    st.textContent = [
      /* 组壳：整块钉在顶栏下方，左右两栏各自滚动，不再跟页面滚 */
      '.ti[data-marvis-app]{position:fixed!important;left:0!important;right:0!important;',
      'top:' + APP_BAR_H + 'px!important;bottom:0!important;height:auto!important;width:auto!important;',
      'margin:0!important;z-index:2147482400!important;background:#fff!important;',
      'display:flex!important;flex-direction:column!important;min-height:0!important;}',
      '.ti[data-marvis-app]>app-resizable{display:block!important;flex:1 1 auto!important;min-height:0!important;',
      'height:auto!important;position:relative!important;}',
      /* 用绝对定位铺满：flex 项的高度不是「确定尺寸」，子元素 height:100% 不生效
         （真机实测：容器算出来是内容高 1650 而不是 817） */
      '.ti[data-marvis-app] .resizable-container{display:flex!important;align-items:stretch!important;',
      'position:absolute!important;left:0!important;top:0!important;right:0!important;bottom:0!important;',
      'height:auto!important;min-height:0!important;}',
      /* 左栏：材料，独立滚动 */
      '.ti[data-marvis-app] .nz-resizable.left{position:static!important;height:auto!important;',
      'max-height:none!important;align-self:stretch!important;overflow-y:auto!important;',
      'overflow-x:hidden!important;-webkit-overflow-scrolling:auto;',
      'overscroll-behavior:contain!important;touch-action:none!important;}',
      '.ti[data-marvis-app] .left-section{position:relative!important;min-height:100%!important;',
      'height:auto!important;overflow:visible!important;}',
      '.ti[data-marvis-app] .left-part,.ti[data-marvis-app] app-materials,',
      '.ti[data-marvis-app] .materials-container,.ti[data-marvis-app] .material-body{',
      'height:auto!important;max-height:none!important;overflow:visible!important;}',
      /* 右栏：5 道子题顺排，共用一张纸，独立滚动 */
      '.ti[data-marvis-app] .right{height:auto!important;align-self:stretch!important;',
      'overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:auto;',
      'overscroll-behavior:contain!important;touch-action:none!important;}',
      '.ti[data-marvis-app] .right-section,.ti[data-marvis-app] .right-part{',
      'position:relative!important;min-height:100%!important;height:auto!important;overflow:visible!important;}',
      /* 我们自己的两张纸
         v2.9.2：pointer-events:none —— 纸只负责显示，不吃任何事件。
         这样手指能原生滚动两栏、能直接点右边选项，笔由 scroller 上的捕获监听接走。
         （v2.9.0/2.9.1 踩的坑：纸铺满整栏又吃事件 → 选项点不动、手也滚不动） */
      '.ti[data-marvis-app] canvas.marvis-app-ink{position:absolute!important;left:0!important;top:0!important;',
      /* v2.9.13：z-index 5 → 60。以前题内的注入元素（字母盒 z-index:260）会盖在画布上，
         笔从旁边写过去，墨迹被整片遮住，看着就是「笔触到那儿就断了」。
         v2.9.15：60 → 2147483100 —— 粉笔页面上常驻的透明覆盖层（.modal-overlay /
         .tooltip-container / sticky 吸顶条）动辄 z-index 1000+，只要有一层压在题目上，
         墨迹就被整片挡住（用户说的「有东西把我写的字挡住了」）。
         取 3100 这一档：低于顶栏(3200) / 滚动条(3150) / 答题面板(3300)，高于页面一切元素。 */
      'pointer-events:none!important;touch-action:none!important;z-index:2147483100;}',
      /* v2.9.13：内容区里的原生控件一个都不参与命中 —— 笔落到题目里的任何位置都是写字。
         以前落点撞上原生按钮/链接/图标，hit-test 就跑到它们身上，落笔被它们吃掉。 */
      '.ti[data-marvis-app] .left-section *,.ti[data-marvis-app] .right-section *{',
      'pointer-events:none!important;}',
      /* 两栏内容不许横向撑破（治「右面被裁剪」：右栏 cw 380 而内容 sw 466，
         多出来的 86px 被 overflow-x:hidden 切掉） */
      '.ti[data-marvis-app] .left-section,.ti[data-marvis-app] .right-section,',
      '.ti[data-marvis-app] .right-part,.ti[data-marvis-app] .left-part{',
      'width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;',
      'touch-action:none!important;}',
      '.ti[data-marvis-app] .left-section *,.ti[data-marvis-app] .right-section *{',
      'max-width:100%!important;min-width:0!important;box-sizing:border-box!important;}',
      '.ti[data-marvis-app] .right,.ti[data-marvis-app] .nz-resizable.left{min-width:0!important;}',
      /* 旧的单题/材料悬浮画布与原生组级草稿：这个模式下全部让位 */
      '.ti[data-marvis-app] canvas.marvis-pen{display:none!important;}',
      '.ti[data-marvis-app] .marvis-cv-tools{display:none!important;}',
      '.ti[data-marvis-app] .draft-container{display:none!important;}',
      /* 顶部草稿栏 */
      '#marvis-app-bar{position:fixed;left:0;right:0;top:0;height:' + APP_BAR_H + 'px;',
      'z-index:2147483200;display:flex;align-items:center;gap:4px;padding:0 8px;',
      'background:#fff;border-bottom:1px solid #E3E6EA;box-shadow:0 1px 3px rgba(0,0,0,.05);}',
      '#marvis-app-bar .mab-btn{display:flex;align-items:center;justify-content:center;',
      'width:40px;height:36px;border:0;border-radius:9px;background:transparent;color:#3C464F;padding:0;}',
      '#marvis-app-bar .mab-btn:active{background:#EFF2F5;}',
      '#marvis-app-bar .mab-btn.on{color:#2F5BEA;background:#EEF3FF;}',
      '#marvis-app-bar .mab-btn[disabled]{color:#C6CBD2;}',
      '#marvis-app-bar .mab-btn svg{width:22px;height:22px;display:block;}',
      '#marvis-app-bar .mab-sp{flex:1 1 auto;}',
      '#marvis-app-bar .mab-sep{width:1px;height:22px;background:#E7EAEE;margin:0 3px;}',
      /* 笔色圆点（v2.9.2：原来的笔色面板在页面 header 上，被这条栏整个盖住了） */
      '#marvis-app-bar .mab-dot{width:24px;height:24px;border-radius:50%;border:2px solid transparent;',
      'padding:0;margin:0 2px;box-sizing:border-box;box-shadow:inset 0 0 0 1px rgba(0,0,0,.10);flex:0 0 auto;}',
      '#marvis-app-bar .mab-dot.on{border-color:#2F5BEA;box-shadow:0 0 0 2px rgba(47,91,234,.20);}',
      /* 粗细：- / 倍率 / + */
      '#marvis-app-bar .mab-w{min-width:40px;height:32px;border:0;border-radius:8px;background:transparent;',
      'color:#3C464F;font:600 12px/1 -apple-system,"PingFang SC",sans-serif;padding:0 4px;flex:0 0 auto;}',
      '#marvis-app-bar .mab-w:active{background:#EFF2F5;}',
      '#marvis-app-bar .mab-btn.manual{color:#C9701A;background:#FFF4E8;}',
      /* v2.9.23：手写开关（防误触例外态）—— 橘色提醒「手掌/手指现在也会落墨」 */
      '#marvis-app-bar .mab-btn.hand.on{color:#C9701A;background:#FFF4E8;}',
      '#marvis-app-bar .mab-wv{min-width:34px;text-align:center;font:600 12px/1 -apple-system,"PingFang SC",sans-serif;',
      'color:#8A929B;flex:0 0 auto;}',
      /* 每侧可拖的滚动滑块（v2.9.2：7px→12px，并加 26px 透明热区，手指才按得住） */
      '.marvis-app-thumb{position:fixed;width:12px;border-radius:6px;background:rgba(60,70,79,.30);',
      'z-index:2147483150;touch-action:none;display:none;box-sizing:border-box;}',
      '.marvis-app-thumb::before{content:"";position:absolute;left:-5px;right:-5px;top:-3px;bottom:-3px;}',
      '.marvis-app-thumb.on{display:block;}',
      '.marvis-app-thumb.track{background:rgba(60,70,79,.16);}',
      '.marvis-app-thumb .mab-grip{position:absolute;left:3px;right:3px;top:50%;margin-top:-1px;height:2px;',
      'border-radius:1px;background:rgba(255,255,255,.9);}',
      /* v2.9.13：字母盒在分栏里**彻底隐藏**（用户定稿：那块区域要能写字）。
         v2.9.12 曾把它放回来并给了 z-index:260 —— 它盖在画布（z-index:5）上面，
         两个后果：① 笔落在这块上命中它、不走书写分支，起笔就写不出；
         ② 从旁边写过来的墨迹被它整片遮住，看着就是「笔触到那儿就断了」。
         答题入口统一走顶栏题号按钮弹出的面板（#marvis-app-qpop）。
         粉笔原生的三个工具图标（标记 / 草稿 / 收藏）同样藏起来。 */
      '.ti[data-marvis-app] .marvis-lbox{display:none!important;}',
      /* v2.9.17：题号从「一颗 ▾ 按钮 + 五行的下拉面板」改成「五颗题号按钮」——
         一道题一颗，点谁滚到谁、并把这道题专属的草稿纸浮出来。
         做成紧凑分段控件：竖屏 iPad（768/810）也放得下。 */
      '#marvis-app-bar .mab-qgrp{display:flex;align-items:center;flex:0 0 auto;',
      'border:0.5px solid #D8DEE6;border-radius:9px;background:#fff;overflow:hidden;}',
      '#marvis-app-bar .mab-qn{min-width:34px;height:32px;padding:0 6px;border:0;border-radius:0;',
      'background:transparent;color:#5F6670;font:600 11.5px/1 -apple-system,"PingFang SC",sans-serif;',
      'display:flex;align-items:center;justify-content:center;flex:0 0 auto;}',
      '#marvis-app-bar .mab-qn+.mab-qn{border-left:0.5px solid #E7EAEE;}',
      '#marvis-app-bar .mab-qn.on{background:#EEF3FF;color:#2F5BEA;}',
      '#marvis-app-bar .mab-qn:active{background:#EFF2F5;}',
      /* v2.9.17 草稿纸：浮在右栏上，半透明白；v2.9.18 起不透明度可调（--mas-a / --mas-ha） */
      '#' + APP_SHEET_ID + '{position:fixed;z-index:2147483080;display:none;flex-direction:column;',
      '--mas-a:.70;--mas-ha:.80;box-sizing:border-box;',
      'background:rgba(255,255,255,var(--mas-a));border:1px solid rgba(60,70,79,.18);border-radius:12px;',
      'box-shadow:0 8px 26px rgba(24,32,45,.16);overflow:hidden;}',
      '#' + APP_SHEET_ID + '.on{display:flex;}',
      /* v2.9.19：大档 = 铺满，此时去掉圆角、边框、阴影，看着就是一张整纸 */
      '#' + APP_SHEET_ID + '.mas-full{border:0;border-radius:0;box-shadow:none;}',
      '#' + APP_SHEET_ID + '.mas-full .mas-head{padding-left:14px;}',
      '#' + APP_SHEET_ID + '.mas-full .mas-body{border-radius:0;}',
      /* v2.9.21：纸头改成「一行装得下就一行，装不下才换行」——
         用户原话「小中大/透明度/撤销/反撤/删除/收藏标记这一排为什么换行了？
         除了最小的那个放不开，中和大应该都放得开呀」。
         v2.9.20 是硬写死两行，中/大档明明有地方也被折成两行。
         现在：h1（题号 + ABCD）与 h2（工具条）都是 head 的 flex 子项 + flex-wrap，
         h2 的 min-content 装得下就跟在 h1 后面（一行），装不下才落到第二行（只有小档会）。
         × 放在 h2 末尾 —— 一行时它就在最右边，两行时落在第二行右端。 */
      '#' + APP_SHEET_ID + ' .mas-head{display:flex;flex-wrap:wrap;align-items:center;',
      'column-gap:3px;row-gap:0;flex:0 0 auto;padding:4px 4px 4px 10px;',
      'background:rgba(255,255,255,var(--mas-ha));',
      'border-bottom:1px solid rgba(60,70,79,.10);touch-action:none;}',
      '#' + APP_SHEET_ID + ' .mas-h1{display:flex;align-items:center;gap:3px;height:32px;flex:0 0 auto;}',
      '#' + APP_SHEET_ID + ' .mas-h2{display:flex;align-items:center;gap:3px;height:32px;',
      'flex:1 1 auto;min-width:0;}',
      '#' + APP_SHEET_ID + ' .mas-vs{width:1px;height:15px;flex:0 0 auto;margin:0 1px;',
      'background:#D3DDF2;}',
      '#' + APP_SHEET_ID + ' .mas-t:disabled{opacity:.32;}',
      '#' + APP_SHEET_ID + ' .mas-num{font:600 12px/1 -apple-system,"PingFang SC",sans-serif;',
      'color:#3C464F;margin-right:1px;flex:0 0 auto;}',
      /* v2.9.21：纸头上的框线统一成蓝色（用户：以前是蓝色框线，跟顶栏一致更好看） */
      '#' + APP_SHEET_ID + ' .mas-l{width:28px;height:26px;flex:0 0 auto;padding:0;border-radius:6px;',
      'border:1.5px solid #BFD0F4;background:#fff;color:#2F5BEA;',
      'font:600 13px/1 -apple-system,"PingFang SC",sans-serif;}',
      '#' + APP_SHEET_ID + ' .mas-l.sel{background:#1B3A82;border-color:#1B3A82;color:#fff;}',
      '#' + APP_SHEET_ID + ' .mas-l.ok{background:#2E9E5B;border-color:#2E9E5B;color:#fff;}',
      '#' + APP_SHEET_ID + ' .mas-l.bad{background:#E24B4A;border-color:#E24B4A;color:#fff;}',
      '#' + APP_SHEET_ID + ' .mas-l:active{transform:scale(.94);}',
      '#' + APP_SHEET_ID + ' .mas-t{width:25px;height:26px;flex:0 0 auto;padding:0;border:0;border-radius:7px;',
      'background:transparent;color:#2F5BEA;display:flex;align-items:center;justify-content:center;}',
      '#' + APP_SHEET_ID + ' .mas-t:active{background:#E4ECFF;}',
      '#' + APP_SHEET_ID + ' .mas-t svg{width:18px;height:18px;display:block;}',
      '#' + APP_SHEET_ID + ' .mas-sp{flex:1 1 auto;min-width:0;}',
      '#' + APP_SHEET_ID + ' .mas-body{position:relative;flex:1 1 auto;overflow:hidden;',
      'border-radius:0 0 12px 12px;}',
      '#' + APP_SHEET_ID + ' canvas.mas-ink{position:absolute;left:0;top:0;width:100%;height:100%;',
      'pointer-events:none;touch-action:none;display:block;}',
      /* v2.9.19：尺寸三档（小 / 中 / 大）—— 分段控件，跟顶栏题号那颗同一种做法 */
      '#' + APP_SHEET_ID + ' .mas-sz{display:flex;align-items:center;flex:0 0 auto;',
      'border:0.5px solid #BFD0F4;border-radius:7px;background:#fff;overflow:hidden;}',
      '#' + APP_SHEET_ID + ' .mas-szb{width:21px;height:24px;padding:0;border:0;border-radius:0;',
      'background:transparent;color:#2F5BEA;',
      'font:600 11.5px/1 -apple-system,"PingFang SC",sans-serif;}',
      '#' + APP_SHEET_ID + ' .mas-szb+.mas-szb{border-left:0.5px solid #D3DDF2;}',
      '#' + APP_SHEET_ID + ' .mas-szb.on{background:#EEF3FF;color:#2F5BEA;}',
      '#' + APP_SHEET_ID + ' .mas-szb:active{background:#E4ECFF;}',
      '#' + APP_SHEET_ID + ' .mas-t.on{background:#EEF3FF;color:#2F5BEA;}',
      /* v2.9.20：标记 / 收藏 一旦「已标记 / 已收藏」就把图标填成实心 ——
         用户原话「点了以后没有一点互动的感觉，应该填充成实心的，就算是我标记上了」。
         原生 li.mark.tool / li.collect.tool 上会挂 .active（chunk-EYRW5JFG：
         _e("active", ques.marked_ / ques.collected_)），纸头按它同步这个 .on。 */
      '#' + APP_SHEET_ID + ' .mas-t.on svg path{fill:currentColor;}',
      /* 内容区里那三个图标（标记/草稿/收藏）在分栏里也点不动，一起收进面板 */
      '.ti[data-marvis-app] li.mark.tool,.ti[data-marvis-app] li.draft.tool,',
      '.ti[data-marvis-app] li.collect.tool{display:none!important;}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- 笔迹存储 ----
     两套历史，互不干扰：
       · `acts`   = 左右两栏那张纸（同一条撤销栈，v2.9.x 老语义，别动）
       · `sheets` = v2.9.17 每题一张的草稿纸，键是题号（"116."），各自独立撤销栈 ——
         不分开的话，在 117 的纸上点撤销会撤掉 116 的一笔（看不见），用户会以为撤销坏了。 */
  function appStoreKey(key) { return 'marvis-app-draft:' + key; }
  function appLoad(key) {
    try {
      var raw = JSON.parse(localStorage.getItem(appStoreKey(key)) || 'null');
      if (raw && raw.acts && typeof raw.acts.length === 'number') {
        var sheets = {};
        if (raw.sheets && typeof raw.sheets === 'object') {
          for (var k in raw.sheets) {
            if (!raw.sheets.hasOwnProperty(k)) continue;
            var sh = raw.sheets[k];
            if (sh && sh.acts && typeof sh.acts.length === 'number') {
              sheets[k] = { acts: sh.acts, at: Math.max(0, Math.min(sh.acts.length, sh.at | 0)) };
            }
          }
        }
        return { acts: raw.acts, at: Math.max(0, Math.min(raw.acts.length, raw.at | 0)), sheets: sheets };
      }
    } catch (e) {}
    return { acts: [], at: 0, sheets: {} };
  }
  function appSaveSoon() {
    if (!appCur) return;
    if (appCur.saveTimer) clearTimeout(appCur.saveTimer);
    appCur.saveTimer = setTimeout(function () {
      if (!appCur) return;
      try {
        localStorage.setItem(appStoreKey(appCur.key), JSON.stringify({
          acts: appCur.acts, at: appCur.at, sheets: appCur.sheets || {}
        }));
      } catch (e) {}
    }, 400);
  }

  /* ---- 画法：Catmull-Rom 转三次贝塞尔（与整页草稿同一套平滑口径） ---- */
  function appSeg(ctx, p0, p1, p2, p3) {
    var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
    ctx.stroke();
  }
  function appStroke(ctx, pts, color, w) {
    var n = pts.length;
    if (n < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (n < 4) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      return;
    }
    for (var j = 0; j + 1 < n; j++) {
      appSeg(ctx, pts[j > 0 ? j - 1 : 0], pts[j], pts[j + 1], pts[j + 2 < n ? j + 2 : n - 1]);
    }
  }
  function appRenderSide(side) {
    var s = appCur && appCur.sides[side];
    if (!s || !s.cv) return;
    var cv = s.cv, ctx = s.ctx, dpr = s.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (var i = 0; i < appCur.at; i++) {
      var a = appCur.acts[i];
      if (a.t === 'clear') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        continue;
      }
      if (a.side !== side) continue;
      appStroke(ctx, a.pts, a.color, a.w);
    }
    /* v2.9.10：正在写的这一笔还没进 acts，重绘必须把它一起补上 ——
       否则任何一次重绘（画布尺寸变化、页面重渲染）都会把「写到一半的笔迹」整条抹掉，
       用户看到的就是笔迹消失、剩下的半截像是断触。 */
    var live = appCur.stroke;
    if (live && !live.dead && live.side === side && live.pts && live.pts.length > 1) {
      appStroke(ctx, live.pts, live.color, live.w);
    }
  }
  /* v2.9.17：每题草稿纸的历史（键 = 题号）。没有就现建一个空栈。 */
  function appSheetHist(num) {
    if (!appCur) return null;
    var k = num || appCur.sheetSub;
    if (!k) return null;
    if (!appCur.sheets) appCur.sheets = {};
    if (!appCur.sheets[k]) appCur.sheets[k] = { acts: [], at: 0 };
    return appCur.sheets[k];
  }
  function appRenderSheet() {
    var s = appCur && appCur.sides.sheet;
    if (!s || !s.cv || !appCur.sheetOpen) return;
    var cv = s.cv, ctx = s.ctx, dpr = s.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var h = appSheetHist();
    if (h) {
      for (var i = 0; i < h.at; i++) {
        var a = h.acts[i];
        if (!a) continue;
        if (a.t === 'clear') {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          continue;
        }
        appStroke(ctx, a.pts, a.color, a.w);
      }
    }
    var live = appCur.stroke;   // 在写的这一笔也要补上（同 v2.9.10 的老坑）
    if (live && !live.dead && live.side === 'sheet' && live.pts && live.pts.length > 1) {
      appStroke(ctx, live.pts, live.color, live.w);
    }
  }
  function appRedraw() {
    if (!appCur) return;
    appRenderSide('left');
    appRenderSide('right');
    appRenderSheet();
  }

  /* ---- 尺寸（内容坐标系：画布铺满整段可滚内容） ----
     v2.9.15：真凶找到了 —— 高度一直量的是「宿主那一层」，而宿主在粉笔这套 flex 布局里
     会被压成一屏高（height:auto + flex-shrink:1，内容溢出但不撑高 scrollHeight）。
     于是画布只有一屏高：第一屏能写，往下滚到第 117/118 题再写，点全都落在画布外面，
     墨迹根本不显示 —— 用户看到的就是「那块没有草稿覆盖 / 像被什么挡住了」。
     现在改成量「真实内容最底部」：一路往最后一个可见后代钻，取它的 bottom。 */
  function appContentBottom(host, skip) {
    if (!host) return 0;
    var base;
    try { base = host.getBoundingClientRect().top; } catch (e) { return 0; }
    var el = host, guard = 0, next;
    while (el && guard++ < 80) {
      next = null;
      for (var i = el.children.length - 1; i >= 0; i--) {
        var c = el.children[i];
        if (c === skip) continue;
        if (c.classList && c.classList.contains('marvis-app-ink')) continue;
        if (c.classList && c.classList.contains('marvis-app-thumb')) continue;
        var r;
        try { r = c.getBoundingClientRect(); } catch (e2) { continue; }
        if (r && r.height > 0.5) { next = c; break; }
      }
      if (!next) break;
      el = next;
    }
    var rb;
    try { rb = el.getBoundingClientRect(); } catch (e3) { return 0; }
    /* bottom 是相对视口的，减掉宿主 top 就是「相对画布原点」的偏移；
       两者一起滚动，所以这个差值不受 scrollTop 影响。底部再留 80px 空白区，
       最后一行下面照样能写。 */
    return Math.max(0, Math.round(rb.bottom - base + 80));
  }
  function appSizeSide(side) {
    var s = appCur && appCur.sides[side];
    if (!s || !s.cv || !s.host) return;
    var w = Math.max(1, Math.round(s.host.offsetWidth || s.host.getBoundingClientRect().width));
    var prevH = s.cv.style.height;
    s.cv.style.height = '0px';
    var need = appContentBottom(s.host, s.cv);
    /* 高度上限：防某个 position:fixed 的后代把「内容底部」撑到天上去 */
    need = Math.min(need, 20000);
    var h = Math.max(1, Math.round(Math.max(
      need,                                    // 真实内容最底部（v2.9.15 主口径）
      s.host.scrollHeight || 0,
      s.host.offsetHeight || 0,
      s.scroller ? s.scroller.clientHeight : 0,
      s.scroller ? (s.scroller.scrollHeight || 0) : 0
    )));
    s.cv.style.height = prevH;
    /* iOS/Safari 的 canvas 面积上限约 16.7M 像素，超了整个位图会被静默丢弃（画布全白）。
       画布现在铺满整段内容，长题很容易逼近上限 → 超了就退回 1x。 */
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    while (dpr > 1 && w * dpr * h * dpr > 12e6) dpr = dpr > 1.5 ? 1.5 : 1;
    var cw = Math.round(w * dpr), chh = Math.round(h * dpr);
    if (s.cv.width === cw && s.cv.height === chh && s.cv.style.width === w + 'px') return;
    s.dpr = dpr;
    s.cv.width = cw;
    s.cv.height = chh;
    s.cv.style.width = w + 'px';
    s.cv.style.height = h + 'px';
    appRenderSide(side);          // 改尺寸会清空位图 → 重画
  }
  function appSizeAll() {
    if (!appCur) return;
    appSizeSide('left');
    appSizeSide('right');
  }

  /* ---- v2.9.3 自适应列宽 ----
     不写死比例，按「屏幕宽度 + 这一组内容长什么样」现算：
       · 屏越窄越把空间让给题目（iPad 竖屏是最挤的场景）
       · 材料里有图/表 → 左边多给一点（图表挤窄了就得左右滚）
       · 选项文字被折成很多行 → 右边多给一点（选项一长，少一行就是少滚半屏）
     用户在分隔条上手拖过就记住手拖的比例（localStorage），不再自动，
     想回到自动就点顶栏的「⇔」按钮。 */
  var APP_COLS_LS = 'marvis-app-cols';

  function appColsManual() {
    try {
      var v = parseFloat(localStorage.getItem(APP_COLS_LS) || '');
      if (!isNaN(v) && v > 0.2 && v < 0.8) return v;
    } catch (e) {}
    return 0;
  }

  /* 右栏「最长的那条选项」在宽度 Wr 下会折成几行。
     不量渲染高度（li 带内边距，量出来恒偏大），而是用一个 nowrap 探针量这段文字的
     【自然单行宽度】，再除以可用宽度 —— 结果只取决于「文字」和「给定宽度」，
     与当前实际列宽无关，所以不会出现「越调越宽/越窄」的反馈漂移。 */
  function appOptNeedLines(R, Wr) {
    var lis = R.querySelectorAll('app-choice-radio li.choice-radio, .question-choice-container li');
    if (!lis.length) return 0;
    var longest = '';
    for (var i = 0; i < lis.length && i < 8; i++) {
      var t = (lis[i].innerText || '').replace(/\s+/g, ' ').trim();
      if (t.length > longest.length) longest = t;
    }
    if (!longest) return 0;
    var probe = document.createElement('span');
    probe.textContent = longest;
    probe.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:nowrap;' +
                          'visibility:hidden;font:inherit;letter-spacing:inherit;';
    R.appendChild(probe);
    var w = 0;
    try { w = probe.getBoundingClientRect().width; } catch (e) {}
    probe.remove();
    if (!w) return 0;
    var avail = Math.max(60, Wr - 46);        // 减掉 ABCD 标号那一列
    return w / avail;
  }

  /* 材料里有没有「真的占地方的」图表：跳过 20px 的格式小图标 */
  function appMaterialHasFigure(L) {
    var els = L.querySelectorAll('img, svg, table');
    for (var i = 0; i < els.length && i < 40; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 120 && r.height > 60) return true;
    }
    return false;
  }

  function appAutoRatio(W, L, R) {
    var r = W < 720 ? 0.40 : (W < 900 ? 0.43 : (W < 1200 ? 0.46 : 0.48));
    try {
      if (appMaterialHasFigure(L)) r += 0.04;                  // 图表类材料要给宽
      if (L.querySelector('table')) r += 0.02;                 // 表格最怕窄
    } catch (e) {}
    if (r < 0.30) r = 0.30;
    if (r > 0.60) r = 0.60;
    // 第二遍：按「r 对应的右栏宽度」估算最长选项要折几行，太挤就再让一点
    var lines = 0;
    try { lines = appOptNeedLines(R, W - Math.round(W * r) - 4); } catch (e) {}
    if (lines >= 3.4) r -= 0.05;
    else if (lines >= 2.4) r -= 0.03;
    if (r < 0.30) r = 0.30;
    if (r > 0.60) r = 0.60;
    return r;
  }

  function appApplyCols() {
    if (!appCur) return;
    var g = appCur.group;
    var cont = g.querySelector('.resizable-container');
    var L = g.querySelector('.nz-resizable.left');
    var R = g.querySelector('.right');
    if (!cont || !L || !R) return;
    var W = cont.clientWidth || Math.round(cont.getBoundingClientRect().width);
    if (W < 240) return;
    var ratio = appCur.manualCol || appAutoRatio(W, L, R);
    var gap = 4;                                  // 两栏之间的分隔条
    var minSide = Math.max(200, Math.min(Math.round(W * 0.28), 380));
    var lw = Math.round(W * ratio);
    if (lw < minSide) lw = minSide;
    if (W - lw - gap < minSide) lw = W - minSide - gap;
    var rw = W - lw - gap;
    if (rw < 120) return;
    appCur.colW = { l: lw, r: rw };
    // 粉笔给左栏写过 width:1143px 这类行内值（按它自己 1905 宽的桌面容器算的），
    // 必须用行内 !important 压回去，否则用我们的 px 会被它盖掉
    L.style.setProperty('width', lw + 'px', 'important');
    L.style.setProperty('flex', '0 0 ' + lw + 'px', 'important');
    R.style.setProperty('width', rw + 'px', 'important');
    R.style.setProperty('flex', '0 0 ' + rw + 'px', 'important');
    R.style.setProperty('min-width', '0px', 'important');
  }

  /* 列宽算好后尺寸会变 → 画布、滑块都要重算 */
  function appFitCols() {
    if (!appCur) return;
    appApplyCols();
    appSizeAll();
    appRedraw();
    appSyncThumbs();
  }

  /* 手拖分隔条 → 记住比例（之后不再自动，直到点「⇔」） */
  function appWatchSplitter() {
    if (!appCur || appCur.splitBound) return;
    var handle = appCur.group.querySelector('.nz-resizable-handle') ||
                 appCur.group.querySelector('.resizable-container > i') ||
                 appCur.group.querySelector('[class*="resizable-handle"]');
    if (!handle) return;
    appCur.splitBound = true;
    handle.addEventListener('pointerup', function () {
      if (!appCur) return;
      var cont = appCur.group.querySelector('.resizable-container');
      var L = appCur.group.querySelector('.nz-resizable.left');
      if (!cont || !L) return;
      var W = cont.clientWidth;
      var lw = Math.round(L.getBoundingClientRect().width);
      if (W > 240 && lw > 0) {
        var ratio = Math.max(0.2, Math.min(0.8, lw / W));
        appCur.manualCol = ratio;
        try { localStorage.setItem(APP_COLS_LS, String(Math.round(ratio * 1000) / 1000)); } catch (e) {}
        appCur.colW = null;      // 让看门狗按新宽度重新认一遍
      }
    }, true);
  }

  /* 回到自动列宽 */
  function appColsAuto() {
    try { localStorage.removeItem(APP_COLS_LS); } catch (e) {}
    if (appCur) { appCur.manualCol = 0; appCur.colW = null; }
    appFitCols();
    appBarSync();          // 按钮要从橙色「手动」变回普通态
  }

  /* ---- 左栏的行内 !important 只能由 JS 覆盖（样式表 !important 打不过行内 !important） ----
     实测：粉笔会在 800ms 内把 position:sticky 等再写回去，所以除了开机时改一次，
     还挂一条 MutationObserver 盯着 style 属性，被改回就立刻按住。 */
  function appInlineNeedFix(L) {
    return L.style.getPropertyValue('position') !== 'static' ||
           L.style.getPropertyValue('align-self') !== 'stretch' ||
           L.style.getPropertyValue('max-height') !== 'none' ||
           L.style.getPropertyValue('overflow-y') !== 'auto';
  }
  function appGroupNeedFix(g) {
    return g.style.getPropertyValue('left') !== '0px' ||
           g.style.getPropertyValue('right') !== '0px' ||
           g.style.getPropertyValue('width') !== 'auto';
  }
  function appInlineFix() {
    if (!appCur) return;
    var g = appCur.group;
    /* v2.9.2：组壳自己也被页面写了行内 !important（实测是
       width:100%!important; left:auto!important; right:auto!important）。
       行内 !important 只有行内 !important 打得过，样式表那套全部失效 →
       组壳留在 static 位置（实测 left:122.5px / 宽 1905px），
       整个右栏连带滑块被推出视口：这就是「右面被裁剪 + 看不到拖动按钮」。
       每次都写一遍 setProperty，页面改回也会被下一次看门狗按回去。 */
    if (appGroupNeedFix(g)) {
      var pin = {
        position: 'fixed', left: '0px', right: '0px',
        top: APP_BAR_H + 'px', bottom: '0px',
        width: 'auto', height: 'auto',
        'max-width': 'none', 'min-width': '0px', 'min-height': '0px',
        margin: '0px', transform: 'none', 'box-sizing': 'border-box',
        'overflow-x': 'hidden', float: 'none'
      };
      for (var k in pin) { if (pin.hasOwnProperty(k)) g.style.setProperty(k, pin[k], 'important'); }
    }
    var L = g.querySelector('.nz-resizable.left');
    var LS = g.querySelector('.left-section');
    if (L && appInlineNeedFix(L)) {
      // 页面给左栏写死了 position:sticky / max-height:calc(...) / align-self:flex-start，
      // 不放开就永远只有「内容高」，滚不起来、画布也铺不满
      L.style.setProperty('position', 'static', 'important');
      L.style.setProperty('top', 'auto', 'important');
      L.style.setProperty('max-height', 'none', 'important');
      L.style.setProperty('align-self', 'stretch', 'important');
      L.style.setProperty('height', 'auto', 'important');
      L.style.setProperty('overflow-y', 'auto', 'important');
      L.style.setProperty('overflow-x', 'hidden', 'important');
    }
    if (LS) {
      if (LS.style.getPropertyValue('align-self') !== 'stretch') LS.style.setProperty('align-self', 'stretch', 'important');
      if (LS.style.getPropertyValue('min-height') !== '100%') LS.style.setProperty('min-height', '100%', 'important');
      if (LS.style.getPropertyValue('height') !== 'auto') LS.style.setProperty('height', 'auto', 'important');
    }
  }
  function appWatchInline() {
    if (!appCur || typeof MutationObserver !== 'function') return;
    var L = appCur.group.querySelector('.nz-resizable.left');
    if (!L) return;
    if (appCur.mo) { try { appCur.mo.disconnect(); } catch (e) {} appCur.mo = null; }
    appCur.mo = new MutationObserver(function () {
      if (!appCur) return;
      if (appInlineNeedFix(L)) { appInlineFix(); appSizeAll(); appSyncThumbs(); }
    });
    appCur.mo.observe(L, { attributes: true, attributeFilter: ['style'] });
  }

  function appEnter() {
    return !!appCur;
  }

  /* ---- 内容区没有任何手势滚动（v2.9.9）----
     草稿打开后就是盖在题目上的一张纸：手和笔一模一样，落上来只写字，
     谁也别想把这张纸拖走、更别想点到纸下面那一层。滚动只有两个入口 ——
     左右两侧那两颗滚动条（手指、笔都能拖）。
     这里只剩一条兜底：个别内核不认 touch-action:none、仍把触摸当滚动手势时，
     把 touchmove 的默认动作掐掉，免得整页 / 整栏被拖走。 */
  function appBindScrollTouch(side, scroller) {
    function onTouchMove(e) {
      if (!appCur) return;
      if (e.touches && e.touches.length > 1) return;   // 双指缩放留给浏览器
      e.preventDefault();                              // 内容区不许滚（滚动请拖滚动条）
    }
    scroller.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    /* 退出分栏要能把这条摘干净：否则每进一次就叠一层 */
    return function () {
      try { scroller.removeEventListener('touchmove', onTouchMove, { capture: true }); } catch (e) {}
    };
  }

  /* ---- 每侧一张纸 ---- */
  function appBuildSide(side, scroller, host) {
    if (!host) return null;
    var cv = document.createElement('canvas');
    cv.className = 'marvis-app-ink';
    cv.setAttribute('data-marvis-app-ink', side);
    host.appendChild(cv);
    var thumb = document.createElement('div');
    thumb.className = 'marvis-app-thumb';
    thumb.setAttribute('data-marvis-app-thumb', side);
    thumb.innerHTML = '<span class="mab-grip"></span>';
    document.body.appendChild(thumb);
    var s = { cv: cv, ctx: cv.getContext('2d'), host: host, scroller: scroller, thumb: thumb, dpr: 1 };
    cv.__appSide = side;
    /* v2.9.2：监听挂在 scroller 上（画布本身 pointer-events:none）。
       这样手指的 pointerdown/touch 一路直达原生内容 → 手指能滚、能点选项；
       只有笔会被我们在这里拦下来写成笔迹。 */
    scroller.__appSide = side;
    /* v2.9.15：落笔与阻挡改挂 document 捕获层（见 appShieldDown / appSideAt）——
       挂在这里的话，只要页面上有一层透明覆盖物盖住这块区域，事件就绕开滚动容器，
       那块地方「怎么写都写不出」。document 层按坐标归属，盖什么都拦不住。 */
    scroller.addEventListener('scroll', function () {
      appSyncThumb(side);
      /* v2.9.15：滚到没画布的地方就等于「那块没有草稿」—— 滚动后按真实内容底部补量一次。
         正在写字时绝不量（量尺寸会重设画布位图，把在写的墨迹抹掉，v2.9.10 的老坑）。 */
      if (!s.__sizeRaf && !(appCur && appCur.stroke)) {
        s.__sizeRaf = requestAnimationFrame(function () {
          s.__sizeRaf = 0;
          if (!appCur || appCur.stroke) return;
          appSizeSide(side);
        });
      }
      /* v2.9.11：右栏滚动 → 顶栏题号跟着换，面板里的当前行也跟着亮 */
      if (side === 'right' && !appQScrollRaf) {
        appQScrollRaf = requestAnimationFrame(function () {
          appQScrollRaf = 0;
          appQBarSync();
          appSheetSyncStates();
        });
      }
    }, { passive: true });
    s.detachTouch = appBindScrollTouch(side, scroller);   // v2.9.6：原生滚不动时由我们接管
    thumb.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      /* v2.9.7：把指针捕获在这颗滑块上 —— 笔/手指拖得快、拖出 12px 的窄条时
         pointermove 仍然送到 window，滚动不会半路断掉。 */
      try { thumb.setPointerCapture(ev.pointerId); } catch (e) {}
      appThumbDrag(side, ev);
    }, true);
    return s;
  }

  function appSyncThumb(side) {
    var s = appCur && appCur.sides[side];
    if (!s || !s.thumb || !s.scroller) return;
    var el = s.scroller, r = el.getBoundingClientRect();
    var ch = el.clientHeight, sh = el.scrollHeight, th = s.thumb;
    if (r.height < 40 || r.width < 40) { th.classList.remove('on'); return; }
    /* v2.9.2：以前只有「需要滚」才显示滑块，内容一旦被内层裁住就静默消失，
       用户以为没有拖动按钮。现在只要这一栏在，就显示一条轨道；
       不能滚时滑块占满整条且颜色更淡（track 样式），能滚才是实心滑块。 */
    var canScroll = sh > ch + 6;
    var h = canScroll ? Math.max(48, Math.round(r.height * ch / sh)) : r.height;
    var maxScroll = sh - ch;
    var ratio = (canScroll && maxScroll > 0) ? Math.max(0, Math.min(1, el.scrollTop / maxScroll)) : 0;
    th.classList.add('on');
    if (canScroll) th.classList.remove('track'); else th.classList.add('track');
    /* 贴右边缘，且夹在视口内（组壳偏出去时滑块会跟着跑出屏，等于没有） */
    var vw = window.innerWidth || document.documentElement.clientWidth || r.right;
    th.style.left = Math.round(Math.max(0, Math.min(r.right - 16, vw - 16))) + 'px';
    th.style.top = Math.round(r.top + ratio * (r.height - h)) + 'px';
    th.style.height = Math.round(h) + 'px';
  }
  function appSyncThumbs() {
    appSyncThumb('left');
    appSyncThumb('right');
  }
  function appThumbDrag(side, ev) {
    var s = appCur && appCur.sides[side];
    if (!s || !s.scroller) return;
    var el = s.scroller;
    var r = el.getBoundingClientRect();
    var ch = el.clientHeight, sh = el.scrollHeight;
    var h = Math.max(48, Math.round(r.height * ch / sh));
    var span = Math.max(1, r.height - h);
    var maxScroll = sh - ch;
    var startY = ev.clientY, startTop = el.scrollTop;
    function mv(e2) {
      var next = startTop + ((e2.clientY - startY) / span) * maxScroll;
      el.scrollTop = Math.max(0, Math.min(maxScroll, next));
      appSyncThumb(side);
    }
    function up() {
      window.removeEventListener('pointermove', mv, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      appSyncThumb(side);
    }
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }

  /* ---- 书写 ---- */
  var appInkBox = null;          // 刚收笔那一笔的屏幕 bbox：只有落在笔画上的 click 才吞

  function appPenClickGuard(ev) {
    if (!appCur || !appInkBox) return;
    if (appClickBypass > 0) return;          // v2.9.11：面板代点的 click 不算「写完顺手点选项」
    if (Date.now() - appInkBox.t > 600) return;
    var x = ev.clientX, y = ev.clientY;
    if (x < appInkBox.x1 - 10 || x > appInkBox.x2 + 10 ||
        y < appInkBox.y1 - 10 || y > appInkBox.y2 + 10) return;   // 不在刚写的笔画附近 → 放行
    var t = ev.target;
    if (appInOwnUI(t)) return;               // 顶栏 / 滑块 / 纸头按钮 —— 它们本来就要能点
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    ev.preventDefault();
  }
  /* v2.9.9：草稿是一张纸，纸下面那层谁也碰不到 —— 手、笔、鼠标一视同仁。
     v2.9.8 只挡手指、放行笔，是为了让「笔还能点选项」；用户明确不要这种区别：
     草稿一打开就是纯书写，要改答案先关草稿。
     放行的只有我们自己的 UI：顶栏与两颗滚动条。 */
  function appInOwnUI(t) {
    /* v2.9.13：白名单只留「真的要用手/笔点」的三样 —— 顶栏、两颗滚动条、答题面板。
       字母盒（.marvis-lbox）已经在分栏里彻底隐藏，不再是点击目标，也就不再让路；
       更要紧的是：它以前在名单里，笔一落到题目左上角那块就被判成「点 UI」而不落笔，
       正是用户说的「笔触到那儿就断」。 */
    return !!(t && typeof t.closest === 'function' &&
              t.closest('#' + APP_BAR_ID + ', .marvis-app-thumb, ' +
                       '#' + APP_SHEET_ID + ' .mas-head, ' +
                       '#' + APP_SHEET_ID + ' .mas-sz'));
  }
  /* ---- v2.9.15：落笔监听从「滚动容器」提到 document 捕获层 ----
     粉笔页面上常驻一批透明覆盖层（.modal-overlay / .tooltip-container / sticky 吸顶条 …
     实测在选项 B 上做 elementFromPoint，命中的就是 div.modal-overlay）。它们一旦盖住某块区域，
     pointerdown 的传播路径就绕开了滚动容器 —— 我们收不到事件，那块区域「怎么都写不出字」，
     在用户眼里就是「这块没有草稿覆盖」，而画布其实是好的。
     现在落点只按【坐标】归属到左栏/右栏，谁盖在上面都拦不住。 */
  /* v2.9.17：草稿纸浮在两栏之上，落点必须先归它 —— 否则纸上的笔会被判成「右栏」，
     墨迹画到纸下面那张画布上，看起来就是「在纸上写，字却出现在题目上」。 */
  function appSheetBox() {
    var sh = appCur && appCur.sheetOpen && appCur.sides && appCur.sides.sheet;
    if (!sh || !sh.el) return null;
    var r;
    try { r = sh.el.getBoundingClientRect(); } catch (e) { return null; }
    if (!r || r.width < 2 || r.height < 2) return null;
    return { r: r, side: sh, headBottom: r.top + (sh.headH || 40) };
  }
  function appSheetHit(x, y) {
    var b = appSheetBox();
    if (!b) return null;
    if (x < b.r.left || x > b.r.right || y < b.r.top || y > b.r.bottom) return null;
    return y < b.headBottom ? 'head' : 'body';
  }
  function appSideAt(x, y) {
    if (!appCur) return null;
    var b = appSheetBox();
    if (b && x >= b.r.left && x <= b.r.right && y >= b.headBottom && y <= b.r.bottom) return b.side;
    var order = ['right', 'left'];
    for (var i = 0; i < order.length; i++) {
      var s = appCur.sides[order[i]];
      if (!s || !s.cv || !s.scroller) continue;
      var r;
      try { r = s.scroller.getBoundingClientRect(); } catch (e) { continue; }
      if (!r || r.width < 2 || r.height < 2) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s;
    }
    return null;
  }
  /* ---- v2.9.23 防误触：默认只认笔 ----
     用户定稿（本版）：「只认笔 + 一颗手写开关」，纸和两栏用同一套规则。
     v2.9.9 那条「手和笔完全一样」的初衷是「手不许穿透到下面的题目」，
     副作用是手掌/皮肤一碰纸面就落墨 —— 手写时掌心、撑手、握笔的指节全在纸上。
     现在：
       · 默认只有 pointerType='pen'（以及鼠标左键）落墨；
       · 手指碰纸仍然什么都不透过去（下面那层选项照旧碰不到），只是不落墨；
       · 手指照样能按纸头按钮、拖纸头、拖两颗滚动条、按顶栏 —— 那些都是自家的 UI；
       · 真要手指写字，点顶栏那颗 ✋（橘色=已打开），选择记在 localStorage。 */
  var APP_HAND_LS = 'marvis-app-handwrite';
  function appHandWrite() {
    try { return localStorage.getItem(APP_HAND_LS) === '1'; } catch (e) { return false; }
  }
  function appSetHandWrite(on) {
    try { localStorage.setItem(APP_HAND_LS, on ? '1' : '0'); } catch (e) {}
  }
  /* 这一次 pointerdown 能不能落笔 */
  function appPointerWrites(e) {
    var t = e && e.pointerType;
    if (t === 'pen' || t === 'mouse') return true;      // 笔 / 鼠标左键
    if (!appHandWrite()) return false;                  // 默认：手指/手掌不落墨
    /* 手写开关打开时也保让笔优先：笔正在写，手指/手掌一律让路 ——
       既不落墨，也不许像以前那样把这一笔截断（v2.9.9 起的老毛病）。 */
    var st = appCur && appCur.stroke;
    if (st && !st.dead && st.ptype === 'pen') return false;
    return true;
  }
  function appShieldDown(e) {
    if (!appCur) return;
    if (appInOwnUI(e.target)) return;            // 顶栏 / 两颗滚动条 / 纸头按钮 —— 放行
    /* 纸头 = 拖动纸的手柄，不是写字。**不能 stopPropagation** ——
       纸头的 pointerdown 还要交给它自己的拖动处理器，一停就拖不动了。
       事件目标是纸头本身（纸在最上层），下面那层本来也收不到。 */
    if (appSheetHit(e.clientX, e.clientY) === 'head') return;
    var s = appSideAt(e.clientX, e.clientY);
    if (!s) return;                              // 落在两栏之外（页面别处）→ 放行
    /* 到这里 = 落在这张纸上：下面那一层（选项 / 收藏 / 子题 tab / 页面滚动）一个事件都别收 */
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (appCur.mode !== 'pen') return;
    if (e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) return;
    appBeginStroke(s, e);
  }
  function appShieldClick(e) {
    if (!appCur) return;
    if (appClickBypass > 0) return;              // v2.9.11：面板代点的原生 click，放行
    if (appInOwnUI(e.target)) return;
    if (appSheetHit(e.clientX, e.clientY)) {     // 纸上任何位置的 click 都不许穿透
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    if (!appSideAt(e.clientX, e.clientY)) return;
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.preventDefault();
  }
  function appPt(cv, e) {
    var r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  /* v2.9.6：笔写期间把栏位钉住。
     有些内核（iPadOS 的 Safari/WKWebView）会把笔的拖动同时当成滚动手势。即便 CSS 已经
     回到 touch-action:auto，这里再兜一层：只要这一笔还没抬起来，滚动位移一律原样退回。
     写的这几百毫秒里用户不可能同时用手指滚这一栏，代价可以忽略。 */
  function appScrollGuard(scroller, stroke) {
    if (stroke.guard) return;                 // v2.9.10：同一笔续写时不重复挂
    var top = scroller.scrollTop, left = scroller.scrollLeft;
    var fn = function () {
      if (scroller.scrollTop !== top) scroller.scrollTop = top;
      if (scroller.scrollLeft !== left) scroller.scrollLeft = left;
    };
    scroller.addEventListener('scroll', fn, { passive: true });
    stroke.guard = fn;
    stroke.guardEl = scroller;
  }

  /* v2.9.15：真正的落笔入口。谁在上面盖着都不影响 —— 由 appShieldDown 按坐标挑好这一侧再进来。 */
  function appBeginStroke(s, e) {
    if (!appCur || appCur.mode !== 'pen') return;
    if (!s || !s.cv) return;
    /* v2.9.23：防误触的总闸 —— 手指/手掌默认不落墨（见 appPointerWrites）。
       放在最前面：连「旧笔画收尾/接管」都不参与，笔正在写时手掌落下也动不了这一笔。 */
    if (!appPointerWrites(e)) return;
    var sc = s.scroller;
    var side = s.cv.__appSide || (s === appCur.sides.left ? 'left' : 'right');

    /* v2.9.9：不分区「谁能写」的老规矩见上；v2.9.23 起默认只认笔，
       手指/手掌要写必须先在顶栏把 ✋ 打开（appPointerWrites 已经把关）。 */

    var old = appCur.stroke;
    if (old) {
      var pt = appPt(s.cv, e);
      var last = old.pts[old.pts.length - 1];
      var near = !!last && Math.abs(pt[0] - last[0]) <= 48 && Math.abs(pt[1] - last[1]) <= 48;
      if (e.pointerType === 'pen' && old.ptype !== 'pen') {
        /* Apple Pencil 会同时产生 pen 与 touch 两路指针。touch 先到就先建了笔画（点数少、位置粗），
           笔一到就把这条 touch 笔画丢掉、整笔由 pen 重画 —— 否则两条线交错（v2.8.11 同款问题）。 */
        old.dead = true;
        appEndStroke(false);
      } else if (old.ptype === e.pointerType && near && !old.dead) {
        /* v2.9.10：同一支指针「断了一下又接着来」不算新的一笔。
           真机上系统会在书写途中发 pointercancel（手掌压屏、内核手势仲裁、页面滚动），
           紧接着用一次新的 pointerdown 把笔交回来。以前 cancel 就收笔、新 down 再开一笔，
           一条连续的线被切成一段一段 —— 这正是用户说的「断触」。
           判据只看落点：接着上一笔的落点（≤48px）就续着画，别的什么都不管。 */
        old.pid = e.pointerId;
        old.orphan = false;
        appScrollGuard(sc, old);
        e.preventDefault();
        window.addEventListener('pointermove', appOnMove, true);
        window.addEventListener('pointerup', appOnUp, true);
        window.addEventListener('pointercancel', appOnUp, true);
        return;
      } else if (old.orphan) {
        appEndStroke(true);                  // 上一笔是被 cancel 打断的孤儿 → 就地收尾
      } else if (Date.now() - (old.ts || 0) < 700) {
        return;                              // 另一支指针乱入，不打断当前笔画
      } else {
        appEndStroke(true);                  // 悬挂的旧笔画（断触残留）→ 收尾再开新的
      }
    }

    e.preventDefault();
    /* 不在这里 setPointerCapture：捕获会把随后合成 click 的 target 改成这个滚动容器，
       而且单击时根本不需要捕获。改到真正开始画之后（appOnMove）再锁。 */
    var stroke = { t: 'stroke', side: side, color: brushColor,
                   w: Math.max(1.4, 1.6 * brushWidth), pts: [appPt(s.cv, e)],
                   pid: e.pointerId, ptype: e.pointerType, ts: Date.now() };
    if (side === 'sheet') stroke.sub = appCur.sheetSub;   // 这一笔记在哪道题的纸上
    appCur.stroke = stroke;
    appScrollGuard(sc, stroke);              // 这一笔没抬起来之前，栏位不许滚走（手、笔都一样）
    var ctx = s.ctx;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    window.addEventListener('pointermove', appOnMove, true);
    window.addEventListener('pointerup', appOnUp, true);
    window.addEventListener('pointercancel', appOnUp, true);
  }
  function appOnMove(e) {
    var st = appCur && appCur.stroke;
    if (!st || st.dead) return;
    if (e.pointerId !== st.pid) {
      if (st.orphan) return;                     // v2.9.10：孤儿笔不许被别的指针续上（手掌乱扫会画歪）
      if (e.pointerType !== st.ptype) return;    // 另一路指针（手/另一支笔）的 move，忽略
      st.pid = e.pointerId;                      // 浏览器在一笔之内换了 pointerId → 认下来（v2.8.13 同款）
    }
    var s = appCur.sides[st.side];
    if (!s) return;
    /* v2.9.4：合并采样补点。
       浏览器会把一帧里的多个物理采样合并成一个 pointermove —— 只取事件本身的话，
       快速运笔时相邻点距会拉到几十像素，样条被拉直、出现折角，看着就像「断了一下」。
       逐点过 0.5px 去重：已经完全投递过的采样会被自然跳过，
       所以不会出现 v2.8.11 那种「同一批采样喂两遍 → 两条交错线」。 */
    var seq = [e];
    try {
      if (e.getCoalescedEvents) {
        var ce = e.getCoalescedEvents();
        if (ce && ce.length) {
          seq = [];
          for (var c = 0; c < ce.length; c++) seq.push(ce[c]);
          seq.push(e);                    // e 一定是最新位置；与列表尾部重复的会被去重挡掉
        }
      }
    } catch (err) { seq = [e]; }
    for (var k = 0; k < seq.length; k++) {
      var pk = (seq[k] === e) ? appPt(s.cv, e) : appPt(s.cv, seq[k]);
      var pts = st.pts;
      var last = pts[pts.length - 1];
      var dx = pk[0] - last[0], dy = pk[1] - last[1];
      if (dx * dx + dy * dy < 0.25) continue;      // 亚像素抖动 / 重复采样不记
      pts.push(pk);
      var n = pts.length;
      if (n === 2) {
        /* 真正开始画了才锁指针（v2.9.8）：单击走原生路径（笔点选项才点得中），拖动才需要捕获 */
        try { s.scroller.setPointerCapture(st.pid); st.captured = true; } catch (err) {}
        s.ctx.beginPath();
        s.ctx.moveTo(pts[0][0], pts[0][1]);
        s.ctx.lineTo(pts[1][0], pts[1][1]);
        s.ctx.stroke();
      } else {
        var i = n - 1;
        appSeg(s.ctx, pts[i - 2] || pts[i - 1], pts[i - 1], pts[i], pts[i]);
      }
    }
    st.ts = Date.now();
    e.preventDefault();
  }
  function appOnUp(e) {
    var st = appCur && appCur.stroke;
    if (!st || st.dead) return;
    /* v2.9.10：pointercancel 不是抬笔。
       iPadOS 会在书写途中 cancel 掉笔的指针流（手掌压屏 / 手势仲裁 / 栏位滚动），
       随后再用一次 pointerdown 把笔交回来。这里若按抬笔收尾，一笔就被切成两段 ——
       用户反馈的「断触」正是它。所以 cancel 只做两件事：摘掉滚动手闸（否则挂着的笔画
       会让滚动条失灵），并把它标成孤儿笔，等下一次 down 决定「续写」还是「收尾」。 */
    if (e.type === 'pointercancel') {
      st.orphan = true;
      if (st.guard && st.guardEl) {
        try { st.guardEl.removeEventListener('scroll', st.guard, { passive: true }); } catch (e2) {}
        st.guard = null; st.guardEl = null;
      }
      return;
    }
    /* v2.9.4：以前这里严格比对 pointerId，一旦浏览器换 id（或手掌触发 pointercancel 用了
       另一个 id），笔画就收不了尾 → appCur.stroke 永久挂着 → 之后每一笔都被
       「已有笔画」挡掉。这就是用户遇到的断触。同类型指针一律当本笔的收尾。
       v2.9.9 收细一点：同类型但 id 不同、且这一笔刚刚还在动（<260ms），多半是另一根手指抬起，
       不该把主指的笔画截断；真悬挂的笔画由 appBeginStroke 的 700ms 接管兜住。 */
    if (e.pointerId !== st.pid) {
      if (e.pointerType !== st.ptype) return;
      if (Date.now() - (st.ts || 0) < 260) return;
    }
    appEndStroke(true);
  }
  function appEndStroke(commit) {
    var st = appCur && appCur.stroke;
    if (!st) return;
    appCur.stroke = null;
    if (st.guard && st.guardEl) {
      try { st.guardEl.removeEventListener('scroll', st.guard, { passive: true }); } catch (e) {}
      st.guard = null; st.guardEl = null;
    }
    window.removeEventListener('pointermove', appOnMove, true);
    window.removeEventListener('pointerup', appOnUp, true);
    window.removeEventListener('pointercancel', appOnUp, true);
    if (!commit || st.dead) return;
    /* 只点了一下（用笔点选项、点按钮）→ 不建笔画，也绝不能记 bbox。
       v2.9.4 第一版在这里就设了 appInkBox，结果「笔点选项」等于把 box 设在选项上，
       紧接着的 click 被自己吞掉 —— 笔就永远点不动选项了。 */
    if (st.pts.length < 2) return;
    /* 记下这一笔的屏幕 bbox：抬笔后 600ms 内、落点压在这条笔画上的 click 才吞掉
       （防「写完顺手把选项点了」）。以前是「抬笔后 420ms 内吞掉所有 click」，
       用笔点选项时会被误吞。 */
    try {
      var r = appCur.sides[st.side].cv.getBoundingClientRect();
      var x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      for (var i = 0; i < st.pts.length; i++) {
        var p = st.pts[i];
        if (p[0] < x1) x1 = p[0];
        if (p[0] > x2) x2 = p[0];
        if (p[1] < y1) y1 = p[1];
        if (p[1] > y2) y2 = p[1];
      }
      /* 拉出一点长度才算「写字」，抖动式的两三点不算 */
      if (x2 - x1 > 8 || y2 - y1 > 8) {
        appInkBox = { x1: r.left + x1, y1: r.top + y1, x2: r.left + x2, y2: r.top + y2, t: Date.now() };
      }
    } catch (err) {}
    /* v2.9.17：纸上的笔进这道题自己的历史，不进分栏那条撤销栈 */
    if (st.side === 'sheet') {
      var h = appSheetHist(st.sub);
      if (h) {
        h.acts.length = h.at;                  // 撤销后写新笔 = 截断重做栈
        h.acts.push(st);
        h.at = h.acts.length;
        if (h.acts.length > 400) { h.acts.shift(); h.at--; }
      }
      appSaveSoon();
      appBarSync();
      return;
    }
    appCur.acts.length = appCur.at;            // 撤销后写新笔 = 截断重做栈
    appCur.acts.push(st);
    appCur.at = appCur.acts.length;
    if (appCur.acts.length > 600) { appCur.acts.shift(); appCur.at--; }
    appSaveSoon();
    appBarSync();
  }

  /* ---- 撤销 / 反撤 / 清空 ----
     v2.9.21：两套彻底独立（用户定稿）——
       · 顶栏那三颗 = 左右两栏那张大画布（`appCur`），始终是它，跟纸开没开无关；
       · 纸头那三颗 = 眼前这张纸（`appCur.sheets[题号]`）。
     v2.9.17~v2.9.20 的写法是「纸一开，顶栏三颗也改指向纸」—— 那等于顶栏那三颗
     忽然换了控制对象，用户看到的正是「外面的大按钮也在撤纸上的字」。 */
  function appHistFor(sheet) {
    if (sheet) return (appCur && appCur.sheetSub) ? appSheetHist(appCur.sheetSub) : null;
    return appCur;
  }
  function appActiveHist() { return appCur; }
  function appUndo(sheet) {
    var h = appHistFor(sheet);
    if (!h || h.at <= 0) return;
    h.at--;
    appRedraw();
    appSaveSoon();
    appBarSync();
  }
  function appRedo(sheet) {
    var h = appHistFor(sheet);
    if (!h || h.at >= h.acts.length) return;
    h.at++;
    appRedraw();
    appSaveSoon();
    appBarSync();
  }
  function appClear(sheet) {
    if (!appCur) return;
    var h = appHistFor(sheet);
    if (!h) return;
    h.acts.length = h.at;
    h.acts.push({ t: 'clear' });
    h.at = h.acts.length;
    appRedraw();
    appSaveSoon();
    appBarSync();
  }

  /* ---- 顶部草稿栏 ---- */
  /* ---- v2.9.11 答题面板：五道题的 ABCD / 标记 / 收藏 都搬到顶栏 ----
     为什么非搬不可：v2.9.9 起分栏就是「一张盖在题目上的纸」，内容区的 pointerdown 与
     合成 click 都在滚动容器捕获层被整个吃掉 —— 内容区里那排 `marvis-lbox`（ABCD+下一题）
     和 标记/收藏/草稿 三个图标全都是死的（jsdom 探针实测：不进分栏点 A 能选中，进分栏后
     同一个按钮点不动）。顶栏与面板是我们自己的 UI（appInOwnUI 放行），所以只能在这里做。 */
  var appClickBypass = 0;       // 面板合成的原生点击要放行，否则被自己的纸吃掉
  var appPopBuilding = false;
  var appQScrollRaf = 0;
  function appAllowOnce(fn) {
    appClickBypass++;
    try { fn(); } finally { appClickBypass--; }
  }
  function appSubs() {
    if (!appCur || !appCur.group) return [];
    return subsOf(appCur.group);
  }
  function appSubNum(sub, i) {
    var el = sub && sub.querySelector('.title-index');
    var t = el ? String(el.textContent || '').replace(/\s+/g, '') : '';
    return t || ((i + 1) + '.');
  }
  /* 每道子题每个字母的状态：sel=已选 / ok=对 / bad=错（判定口径与 syncFeedback 完全一致） */
  function appSubStates(sub) {
    var out = [], judged = false;
    var radios = [].slice.call(sub.querySelectorAll('li.choice-radio'));
    radios.forEach(function (li, i) {
      var ir = li.querySelector('div.input-radio');
      if (!ir) return;
      if (ir.classList.contains('correct') || ir.classList.contains('correctLost')) { out[i] = 'ok'; judged = true; }
      else if (ir.classList.contains('wrong')) { out[i] = 'bad'; judged = true; }
    });
    if (!judged) radios.forEach(function (li, i) { if (isRadioSelected(li)) out[i] = 'sel'; });
    return out;
  }
  /* 右栏里「正在看的那道题」= 顶边已经越过视口顶部的最后一题 */
  function appCurrentSub() {
    var s = appCur && appCur.sides.right;
    if (!s || !s.scroller) return null;
    var subs = appSubs();
    if (!subs.length) return null;
    var sc = s.scroller;
    /* v2.9.20：已经滚到底时，「正在看的」就是最后一道。
       用户点 125 号题号 → 125 滚到顶 → 但内容到 125 就结束了、滚不动那么远，
       按「顶边越过视口顶」算出来的仍是 123 —— 用户截图里的「点开 125 的纸，
       顶栏却亮着 123」就是这条。到底了就把当前题认成最后一道。 */
    var maxTop = 0, top0 = 0;
    try { maxTop = (sc.scrollHeight || 0) - (sc.clientHeight || 0); top0 = sc.scrollTop || 0; } catch (e) {}
    if (maxTop > 8 && maxTop - top0 <= 6) return subs[subs.length - 1];
    var top = s.scroller.getBoundingClientRect().top + 10;
    /* 取「顶边已越过视口顶部」里最靠下的那道；几道题顶边重合时算第一道
       （首次进入还没滚动时不会误判成最后一道） */
    var best = subs[0], bestTop = -1e9;
    for (var i = 0; i < subs.length; i++) {
      var t = subs[i].getBoundingClientRect().top;
      if (t <= top && t > bestTop) { best = subs[i]; bestTop = t; }
    }
    return best;
  }
  function appSubScrollTo(sub) {
    var s = appCur && appCur.sides.right;
    if (!s || !s.scroller || !sub) return;
    var sc = s.scroller;
    var top = sub.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 8;
    sc.scrollTop = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, top));
    appQBarSync();
  }
  /* ---- v2.9.17：五颗题号按钮 + 每题一张草稿纸 ----
     用户定稿：「做 5 个按钮，一道题一个草稿按钮」，并且把 v2.9.11 那颗「117.▾」下拉面板
     整个并进来 —— 点题号 = 滚到这道题 + 弹出这道题自己的纸；纸头一行就是这题的
     ABCD / 标记 / 收藏。原来那颗按钮和五行的面板都删掉。

     为什么纸要按题分开：草稿纸是演算用的，116 的算式留在 116 上才有意义；
     共用一张纸的话，滚到下一题得先擦掉上一题的推导过程。 */
  function appSubIndex(sub) {
    var subs = appSubs();
    for (var i = 0; i < subs.length; i++) if (subs[i] === sub) return i;
    return -1;
  }
  function appQButtons(host, subs) {
    if (!host) return;
    host.innerHTML = '';
    (subs || []).forEach(function (sub, i) {
      var num = String(appSubNum(sub, i) || '');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mab-qn';
      b.setAttribute('data-k', 'qn');
      b.setAttribute('data-num', num);
      b.textContent = num.replace(/\.$/, '');
      b.title = '第 ' + (i + 1) + ' 题：点一下滚到这道题并弹出它的草稿纸；再点收起';
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        /* 按【序号】取当前 DOM 里的那道题：Angular 重渲染会把子题节点换掉，
           闭包里抓住的旧节点早就游离了，拿它去滚等于什么都不做。 */
        appJumpSub(appSubs()[i]);
      }, true);
      host.appendChild(b);
    });
  }
  function appQBarSync() {
    var bar = document.getElementById(APP_BAR_ID);
    if (!bar || !appCur) return;
    var grp = bar.querySelector('.mab-qgrp');
    if (!grp) return;
    var subs = appSubs();
    if (grp.children.length !== subs.length) appQButtons(grp, subs);
    var cur = appCurrentSub();
    var curKey = cur ? appSubNum(cur, appSubIndex(cur)) : null;
    /* v2.9.22：高亮一律按【题号字符串】比，不按 DOM 节点比 ——
       Angular 重渲染会把子题节点整批换掉，节点身份一失配就整排不亮或亮错。
       纸开着时高亮就取纸上那道（纸头写 125、顶栏亮 123 的观感问题从根上断掉）；
       纸收起时才按滚动位置算。 */
    var hiKey = (appCur.sheetOpen && appCur.sheetSub) ? appCur.sheetSub : curKey;
    for (var i = 0; i < grp.children.length; i++) {
      var num = grp.children[i].getAttribute('data-num');
      var cls = 'mab-qn' + (num && num === hiKey ? ' on' : '');
      if (grp.children[i].className !== cls) grp.children[i].className = cls;
    }
    /* v2.9.22：删掉「纸跟着当前题走」的自动改写（这是我 v2.9.17 自己加的，不是你要求的）。
       它害了两次：点开 125 的纸 → 开纸后的滚动 / 尺寸重算让「当前题」算回 123
       → 纸被悄悄换成 123 的（顶栏也跟着变 123），用户看到的就是「我点的是 125，显示 123」。
       现在纸只由【点题号】决定：点哪道就是哪道，直到你点另一道。
       （appCurrentSub 仍算，只是不再拿它改纸。） */
    appCur.qCurKey = curKey;
    appBarSync();
  }
  /* 点一颗题号：滚过去 + 开这题的纸。点的是「这张纸已经开着的那道」→ 收起 */
  function appJumpSub(sub) {
    if (!appCur || !sub) return;
    if (appCur.stroke) appEndStroke(true);
    var idx = appSubIndex(sub);
    /* v2.9.22：判据从「滚到哪 == 点的那道」改成「纸现在是不是就开着这道」——
       纸开着 116 而你在 125 的位置点 125，以前会被判成「点自己 → 收起」，
       结果是收纸而不是换纸。 */
    var wasCur = !!appCur.sheetOpen && appCur.sheetSub === appSubNum(sub, idx < 0 ? 0 : idx);
    appSubScrollTo(sub);
    if (wasCur) { appSheetClose(); return; }
    appSheetOpenFor(sub);
  }
  function appSheetSubObj() {
    if (!appCur || !appCur.sheetSub) return null;
    var subs = appSubs();
    for (var i = 0; i < subs.length; i++) {
      if (appSubNum(subs[i], i) === appCur.sheetSub) return subs[i];
    }
    return null;
  }

  /* ---- 纸的位置 / 大小 ----
     v2.9.19：尺寸改成三档（用户定稿：「改成档位吧，默认是最大档，铺满屏幕，
     还有中档和小档」）。v2.9.18 那套「点按钮进调整模式 + 8 个手柄 + 右下角三角」
     全部作废 —— 两套并存会互相打架（拖完手柄再点档位又变回去），留着只会让人困惑。
     现在：
       · 大 = 铺满屏幕（顶栏下方整块，圆角边框都去掉），默认就是这一档；
       · 中 = v2.9.18 的默认大小；
       · 小 = 再小一圈，方便对照题干。
     位置仍然可以拖纸头移动，并且**每档各记一个位置** —— 从中档拖到左上角、
     再切小档，小档不会跟着跑；切回中档还在左上角。 */
  function appVW() { return window.innerWidth || document.documentElement.clientWidth || 1024; }
  function appVH() { return window.innerHeight || document.documentElement.clientHeight || 768; }

  function appSheetSizeSaved() {
    try {
      var v = localStorage.getItem(APP_SHEET_SIZE_LS);
      if (v && SHEET_SIZE_TXT[v]) return v;
    } catch (e) {}
    return 'l';                     // 默认最大档
  }
  function appSheetSizeApplySave(size) {
    try { localStorage.setItem(APP_SHEET_SIZE_LS, size); } catch (e) {}
  }

  /* 每档的位置（拖纸头才会写）。老版本只有一份 l/t，迁过来当中档的位置用。 */
  function appSheetPosAll() {
    try {
      var o = JSON.parse(localStorage.getItem(APP_SHEET_POS_LS) || '{}');
      if (o && typeof o === 'object') return o;
    } catch (e) {}
    return {};
  }
  function appSheetPosGet(size) {
    var all = appSheetPosAll();
    var p = all[size];
    if (p && typeof p.l === 'number' && typeof p.t === 'number') return p;
    if (size === 'm') {             // v2.9.18 的旧位置 → 中档
      try {
        var r = JSON.parse(localStorage.getItem(APP_SHEET_RECT_LS) || 'null');
        if (r && typeof r.l === 'number' && typeof r.t === 'number') return { l: r.l, t: r.t };
      } catch (e) {}
    }
    return null;
  }
  function appSheetPosSave(size, l, t) {
    var all = appSheetPosAll();
    all[size] = { l: Math.round(l), t: Math.round(t) };
    try { localStorage.setItem(APP_SHEET_POS_LS, JSON.stringify(all)); } catch (e) {}
  }

  /* 一档对应的整块尺寸。大档忽略存下来的位置（铺满就是铺满）。 */
  function appSheetBoxFor(size) {
    var vw = appVW(), vh = appVH();
    if (size === 'l') return { l: 0, t: APP_BAR_H, w: vw, h: Math.max(240, vh - APP_BAR_H) };
    var maxH = Math.max(200, vh - APP_BAR_H - 8);
    var w, h;
    if (size === 's') {
      w = Math.round(Math.min(470, Math.max(SHEET_MIN_W, vw * 0.40)));
      h = Math.round(Math.max(SHEET_MIN_H, Math.min(vh * 0.44, maxH)));
    } else {
      /* v2.9.21：中档略放宽（0.56 → 0.60，最小 430）—— 纸头工具条要一行放得下，
         768 宽的 iPad 上 430 是刚好卡住的宽度，多给 15px 才稳。 */
      w = Math.round(Math.min(720, Math.max(430, vw * 0.60)));
      h = Math.round(Math.max(320, Math.min(vh * 0.74, maxH)));
    }
    var p = appSheetPosGet(size);
    var l = p ? p.l : vw - w - 20;
    var t = p ? p.t : APP_BAR_H + 40;
    l = Math.max(4, Math.min(l, Math.max(4, vw - w - 4)));
    t = Math.max(APP_BAR_H + 4, Math.min(t, Math.max(APP_BAR_H + 4, vh - h - 4)));
    return { l: Math.round(l), t: Math.round(t), w: w, h: h };
  }
  function appSheetPaint(box) {
    var s = appCur && appCur.sides && appCur.sides.sheet;
    if (!s || !s.el) return;
    appCur.sheetRect = box;
    s.el.style.left = Math.round(box.l) + 'px';
    s.el.style.top = Math.round(box.t) + 'px';
    s.el.style.width = Math.round(box.w) + 'px';
    s.el.style.height = Math.round(box.h) + 'px';
    s.el.classList.toggle('mas-full', appCur.sheetSize === 'l');
    /* v2.9.20：纸头变两行 72px。落笔归属按「纸头顶边到纸头底边 = 纸头」判，
       这里量一次真实高度（jsdom 里量不到就退回 72），否则第一行的按钮会被当成纸面。 */
    var hd = s.el.querySelector('.mas-head');
    if (hd) {
      var hh = 0;
      try { hh = Math.round(hd.getBoundingClientRect().height || hd.offsetHeight || 0); } catch (e) { hh = 0; }
      if (hh > 20) s.headH = hh;
    }
    appSheetSize(true);
  }
  /* 按当前档位重排（开纸、转屏都走这里） */
  function appSheetApplySize(size) {
    if (!appCur) return;
    if (size && SHEET_SIZE_TXT[size]) appCur.sheetSize = size;
    appSheetPaint(appSheetBoxFor(appCur.sheetSize));
  }
  function appSheetSetSize(size) {
    var s = appCur && appCur.sides && appCur.sides.sheet;
    if (!appCur || !s || !s.el || !SHEET_SIZE_TXT[size]) return;
    if (appCur.stroke) appEndStroke(true);          // 切档别把正在写的笔画切成两截
    if (appCur.sheetSize === size) { appSheetSyncTools(); return; }
    appCur.sheetSize = size;
    appSheetSizeApplySave(size);
    appSheetApplySize(size);
    appSheetSyncTools();
    cvToast('草稿纸：' + SHEET_SIZE_TXT[size] + (size === 'l' ? '（铺满屏幕）' : ''));
  }
  /* 拖纸头只改位置（大档铺满，拖不动） */
  function appSheetMoveTo(l, t) {
    if (!appCur || appCur.sheetSize === 'l') return;
    var b = appCur.sheetRect || appSheetBoxFor(appCur.sheetSize);
    var vw = appVW(), vh = appVH();
    var nl = Math.max(4, Math.min(l, Math.max(4, vw - b.w - 4)));
    var nt = Math.max(APP_BAR_H + 4, Math.min(t, Math.max(APP_BAR_H + 4, vh - b.h - 4)));
    appSheetPaint({ l: Math.round(nl), t: Math.round(nt), w: b.w, h: b.h });
  }
  function appSheetSavePos() {
    if (!appCur || !appCur.sheetRect || appCur.sheetSize === 'l') return;
    appSheetPosSave(appCur.sheetSize, appCur.sheetRect.l, appCur.sheetRect.t);
  }

  /* ---- v2.9.18：不透明度（存 localStorage，全组共用一份） ---- */
  function appSheetAlphaSaved() {
    try {
      var v = parseFloat(localStorage.getItem(APP_SHEET_ALPHA_LS));
      if (isFinite(v) && v >= 0.2 && v <= 1) return v;
    } catch (e) {}
    return SHEET_ALPHA_DEF;
  }
  function appSheetAlphaApply(a) {
    var s = appCur && appCur.sides && appCur.sides.sheet;
    if (!s || !s.el) return;
    var v = Math.max(0.2, Math.min(1, a));
    appCur.sheetAlpha = v;
    /* 纸头比纸面稍微实一点，不然标题和字母按钮会跟着淡到看不清 */
    s.el.style.setProperty('--mas-a', String(v));
    /* toFixed：0.7 + 0.1 在浮点里是 0.7999999999999999，写进样式太难看 */
    s.el.style.setProperty('--mas-ha', (Math.min(1, v + 0.10)).toFixed(2));
    appSheetSyncTools();
  }
  function appSheetAlphaStep() {
    if (!appCur) return;
    var cur = appCur.sheetAlpha || SHEET_ALPHA_DEF;
    /* 找「比当前更透明的下一档」，到最淡一档再回到最实一档 */
    var next = SHEET_ALPHAS[0];
    for (var i = 0; i < SHEET_ALPHAS.length; i++) {
      if (SHEET_ALPHAS[i] < cur - 0.02) { next = SHEET_ALPHAS[i]; break; }
    }
    appSheetAlphaApply(next);
    try { localStorage.setItem(APP_SHEET_ALPHA_LS, String(next)); } catch (e) {}
    cvToast('草稿纸不透明度 ' + Math.round(next * 100) + '%');
  }

  /* 纸头控件状态：三档里当前那档高亮 + 不透明度提示 + 撤销栈状态 + 标记/收藏是否已开 */
  function appSheetSyncTools() {
    var s = appCur && appCur.sides && appCur.sides.sheet;
    if (!s || !s.el) return;
    var size = (appCur && appCur.sheetSize) || 'l';
    [].slice.call(s.el.querySelectorAll('.mas-szb')).forEach(function (b) {
      var cls = 'mas-szb' + (b.getAttribute('data-sz') === size ? ' on' : '');
      if (b.className !== cls) b.className = cls;
    });
    var bop = s.el.querySelector('[data-t="alpha"]');
    if (bop) {
      var pct = Math.round((appCur.sheetAlpha || SHEET_ALPHA_DEF) * 100);
      bop.title = '不透明度：' + pct + '%（点一下换下一档）';
      bop.setAttribute('data-pct', String(pct));
    }
    /* v2.9.20：撤销 / 反撤 / 清空 —— 没得撤就置灰，看着就知道「到底撤掉了没」。
       v2.9.21：这三颗只看【这张纸】的栈，跟顶栏那三颗（两栏大画布）各算各的。 */
    var hist = appHistFor(true);
    var bu = s.el.querySelector('[data-t="undo"]');
    var br = s.el.querySelector('[data-t="redo"]');
    var bc = s.el.querySelector('[data-t="clear"]');
    if (bu) bu.disabled = !hist || hist.at <= 0;
    if (br) br.disabled = !hist || hist.at >= hist.acts.length;
    if (bc) bc.disabled = !hist || !hist.acts.length;
    /* v2.9.20：标记 / 收藏 已开就填实心（读原生 li 上的 .active） */
    var sub = appSheetSubObj();
    [['mark', '标记 / 错题'], ['collect', '收藏']].forEach(function (tr) {
      var b = s.el.querySelector('[data-t="' + tr[0] + '"]');
      if (!b) return;
      var src = sub && sub.querySelector('li.' + tr[0] + '.tool');
      /* 原生的 active 挂在 li 上（Angular 的 _e("active", ques.marked_)）；
         个别版本会挂到里面的 svg 容器上，两种都认。 */
      var on = !!(src && (src.classList.contains('active') || src.querySelector('.active')));
      var cls = 'mas-t' + (on ? ' on' : '');
      if (b.className !== cls) b.className = cls;
      var tip = tr[1] + (on ? '（已开，点一下取消）' : '（点一下打开）');
      if (b.title !== tip) b.title = tip;
    });
  }
  function appSheetSize(force) {
    var s = appCur && appCur.sides && appCur.sides.sheet;
    if (!s || !s.cv || !s.host) return;
    var w = Math.max(1, Math.round(s.host.clientWidth || 0));
    var h = Math.max(1, Math.round(s.host.clientHeight || 0));
    if (w < 2 || h < 2) return;
    var dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (w * dpr * h * dpr > 12e6) dpr = 1;      // iOS canvas 像素上限（同 v2.9.15 的护栏）
    if (!force && s.w === w && s.h === h && s.dpr === dpr) return;
    s.w = w; s.h = h; s.dpr = dpr;
    s.cv.width = Math.round(w * dpr);
    s.cv.height = Math.round(h * dpr);
    s.cv.style.width = w + 'px';
    s.cv.style.height = h + 'px';
    appRenderSheet();
  }

  function appSheetBuild() {
    var old = document.getElementById(APP_SHEET_ID);
    if (old) old.remove();
    if (!appCur) return null;
    var el = document.createElement('div');
    el.id = APP_SHEET_ID;
    el.innerHTML =
      '<div class="mas-head">' +
        '<div class="mas-h1">' +
          '<span class="mas-num"></span>' +
          '<span class="mas-ls" style="display:flex;align-items:center;gap:3px;"></span>' +
        '</div>' +
        '<div class="mas-h2">' +
          '<span class="mas-sz" data-t="sizes">' +
            '<button type="button" class="mas-szb" data-sz="s" title="小档：纸小一点，方便对照题干">小</button>' +
            '<button type="button" class="mas-szb" data-sz="m" title="中档：默认大小的一半屏">中</button>' +
            '<button type="button" class="mas-szb" data-sz="l" title="大档：铺满屏幕">大</button>' +
          '</span>' +
          '<button type="button" class="mas-t" data-t="alpha" title="不透明度"></button>' +
          '<span class="mas-vs"></span>' +
          '<button type="button" class="mas-t" data-t="undo" title="撤销这张纸上的一笔"></button>' +
          '<button type="button" class="mas-t" data-t="redo" title="反撤（撤销撤销）"></button>' +
          '<button type="button" class="mas-t" data-t="clear" title="清空这张纸"></button>' +
          '<span class="mas-sp"></span>' +
          '<span class="mas-vs"></span>' +
          '<button type="button" class="mas-t" data-t="mark" title="标记 / 错题"></button>' +
          '<button type="button" class="mas-t" data-t="collect" title="收藏"></button>' +
          '<button type="button" class="mas-t" data-t="close" title="收起草稿纸"></button>' +
        '</div>' +
      '</div>' +
      '<div class="mas-body"><canvas class="mas-ink"></canvas></div>';
    document.body.appendChild(el);

    var head = el.querySelector('.mas-head');
    var body = el.querySelector('.mas-body');
    var cv = el.querySelector('canvas.mas-ink');
    cv.__appSide = 'sheet';
    var side = { el: el, cv: cv, ctx: cv.getContext('2d'), host: body, scroller: body, dpr: 1, headH: 72 };
    appCur.sides.sheet = side;

    el.querySelector('[data-t="alpha"]').innerHTML = APP_ICON.alpha;
    el.querySelector('[data-t="close"]').innerHTML = APP_ICON.close;
    /* v2.9.20：撤销 / 反撤 / 清空 搬进纸头 —— 只作用于【眼前这张纸】；
       v2.9.21 起跟顶栏那三颗彻底分家（顶栏恒管两栏那张大画布）。 */
    [['undo', 'undo', function () { appUndo(true); }],
     ['redo', 'redo', function () { appRedo(true); }],
     ['clear', 'trash', function () { appClear(true); }]].forEach(function (tr) {
      var btn = el.querySelector('[data-t="' + tr[0] + '"]');
      btn.innerHTML = APP_ICON[tr[1]] || '';
      btn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (btn.disabled) return;
        tr[2]();
      }, true);
    });
    [].slice.call(el.querySelectorAll('.mas-szb')).forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        appSheetSetSize(b.getAttribute('data-sz'));
      }, true);
    });
    el.querySelector('[data-t="alpha"]').addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      appSheetAlphaStep();
    }, true);
    el.querySelector('[data-t="close"]').addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      appSheetClose();
    }, true);
    [['mark', 'bookmark', '标记 / 错题'], ['collect', 'star', '收藏']].forEach(function (tr) {
      var btn = el.querySelector('[data-t="' + tr[0] + '"]');
      btn.innerHTML = APP_ICON[tr[1]] || '';
      btn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var sub = appSheetSubObj();
        var src = sub && sub.querySelector('li.' + tr[0] + '.tool');
        if (!src) { cvToast(tr[2] + '：这题没有这个按钮'); return; }
        appAllowOnce(function () { src.click(); });   // 走原生按钮，状态回填全沿用
        /* 原生的 marked_ / collected_ 是接口回来之后才翻的（rebuild 一个 tick 后），
           所以这里多刷几次；刷完图标就填实心了，用户能看到「已经标上」。 */
        appSheetSyncTools();
        [180, 420, 900].forEach(function (d) { setTimeout(appSheetSyncTools, d); });
      }, true);
    });

    /* 拖纸：只能拽纸头空白处（按钮在 appInOwnUI 白名单里，不会误触发拖动） */
    head.addEventListener('pointerdown', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('button')) return;
      ev.preventDefault(); ev.stopPropagation();
      try { el.setPointerCapture(ev.pointerId); } catch (e) {}
      if (appCur.sheetSize === 'l') return;      // 大档铺满，没有可拖的余地
      var r0 = el.getBoundingClientRect();
      var ox = ev.clientX - r0.left, oy = ev.clientY - r0.top;
      function mv(e2) {
        appSheetMoveTo(e2.clientX - ox, e2.clientY - oy);
      }
      function up() {
        document.removeEventListener('pointermove', mv, true);
        document.removeEventListener('pointerup', up, true);
        document.removeEventListener('pointercancel', up, true);
        appSheetSavePos();
      }
      document.addEventListener('pointermove', mv, true);
      document.addEventListener('pointerup', up, true);
      document.addEventListener('pointercancel', up, true);
    }, true);

    /* v2.9.18：不透明度先按存下来的值铺上 */
    appCur.sheetAlpha = appCur.sheetAlpha || appSheetAlphaSaved();

    return el;
  }

  function appSheetSyncHead(force) {
    var s = appCur && appCur.sides && appCur.sides.sheet;
    if (!s || !s.el) return;
    var el = s.el;
    var numEl = el.querySelector('.mas-num');
    var numTxt = appCur.sheetSub || '';
    if (numEl && numEl.textContent !== numTxt) numEl.textContent = numTxt;
    var sub = appSheetSubObj();
    var ls = el.querySelector('.mas-ls');
    /* 除了题号变化，子题节点被重渲染（同一题号、新 DOM）也要重建字母，
       否则按钮还指着已经游离的那个 <li>，点了没反应。 */
    if (ls && (force || s.headFor !== appCur.sheetSub || s.headEl !== sub)) {
      s.headEl = sub;
      s.headFor = appCur.sheetSub;
      ls.innerHTML = '';
      if (sub) {
        [].slice.call(sub.querySelectorAll('li.choice-radio')).forEach(function (li, k) {
          var letter = 'ABCD'.charAt(k);
          if (!letter) return;
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'mas-l';
          b.setAttribute('data-letter', letter);
          b.textContent = letter;
          b.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            sub.__marvisClickTs = Date.now();
            var liNow = [].slice.call(sub.querySelectorAll('li.choice-radio'))[k] || li;
            var lab = liNow.querySelector('label.choice-radio-label') || liNow.querySelector('label');
            if (lab) appAllowOnce(function () { lab.click(); });
            appSheetSyncStates();
            setTimeout(appSheetSyncStates, 260);   // 等原生对错 class 落地再刷一次
          }, true);
          ls.appendChild(b);
        });
      }
    }
    appSheetSyncStates();
    appSheetSyncTools();     // v2.9.20：换题后标记/收藏要重新读一遍（每题各一份）
  }
  function appSheetSyncStates() {
    var s = appCur && appCur.sides && appCur.sides.sheet;
    if (!s || !s.el) return;
    var sub = appSheetSubObj();
    var st = sub ? appSubStates(sub) : [];
    [].slice.call(s.el.querySelectorAll('.mas-l')).forEach(function (b, k) {
      var cls = 'mas-l' + (st[k] ? ' ' + st[k] : '');
      if (b.className !== cls) b.className = cls;
    });
  }
  function appSheetOpenFor(sub) {
    var s = appCur && appCur.sides && appCur.sides.sheet;
    if (!s || !s.el) return;
    var idx = appSubIndex(sub);
    appCur.sheetSub = appSubNum(sub, idx < 0 ? 0 : idx);
    appCur.sheetOpen = true;
    s.el.classList.add('on');
    appCur.sheetSize = appCur.sheetSize || appSheetSizeSaved();
    appSheetAlphaApply(appCur.sheetAlpha || appSheetAlphaSaved());
    appSheetApplySize(appCur.sheetSize);
    /* v2.9.22：顶栏高亮先刷 —— 以前它排在纸头刷新之后，
       纸头刷新一旦抛错（重渲染拿到游离节点等）后面的高亮就整段被跳过，
       顶栏会停在点之前亮着的那道题上。 */
    appQBarSync();
    try { appSheetSyncHead(true); appSheetSyncTools(); } catch (e) {}
    appBarSync();
    /* 再补两拍：开纸后的尺寸重算 / Angular 重渲染都在一两帧内发生，
       晚一点再按纸上的题号刷一次高亮，免得停在旧节点上。 */
    setTimeout(appQBarSync, 60);
    setTimeout(appQBarSync, 320);
  }
  function appSheetClose() {
    if (!appCur) return;
    if (appCur.stroke) appEndStroke(true);
    appCur.sheetOpen = false;
    var s = appCur.sides && appCur.sides.sheet;
    if (s && s.el) s.el.classList.remove('on');
    appBarSync();
    appQBarSync();
  }
  function appSheetTeardown() {
    var el = document.getElementById(APP_SHEET_ID);
    if (el) el.remove();
    if (appCur && appCur.sides) appCur.sides.sheet = null;
  }

  var APP_ICON = {
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M4 20.5l1-4.2 9.7-9.7 2.7 2.7-9.7 9.7-3.7 1.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14.2 7.1l2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    eraser: '<svg viewBox="0 0 24 24"><path d="M5.2 14.6l6.6-6.6a1.6 1.6 0 012.3 0l3.1 3.1a1.6 1.6 0 010 2.3l-3.6 3.6H9.3l-4.1-1.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M7.6 8.8H13a4.9 4.9 0 010 9.8h-2.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10.5 5.4L7.1 8.8l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="M16.4 8.8H11a4.9 4.9 0 000 9.8h2.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M13.5 5.4l3.4 3.4-3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4.8 7h14.4M9.4 7V4.8h5.2V7M6.6 7l.9 12.2h9l.9-12.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cols: '<svg viewBox="0 0 24 24"><path d="M12 4.6v14.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.6 2.2"/><path d="M7.4 8.6L4 12l3.4 3.4M16.6 8.6L20 12l-3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24"><path d="M8.2 4.8h7.6v14.4l-3.8-3-3.8 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 8.4L4.2 6.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 4.6l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    /* v2.9.18：不透明度（半填充圆） */
    alpha: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 4.6a7.4 7.4 0 010 14.8z" fill="currentColor"/></svg>',
    /* v2.9.23：手写开关（手） */
    hand: '<svg viewBox="0 0 24 24"><path d="M9.1 11.4V6.3a1.45 1.45 0 012.9 0v4.3M12 10.6V5.4a1.45 1.45 0 012.9 0v5.2M14.9 10.8V7.1a1.45 1.45 0 012.9 0v6.9c0 3.3-2.4 5.6-5.6 5.6-2 0-3.3-.7-4.5-2.3l-2.4-3.2a1.5 1.5 0 012.4-1.8l1.4 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>'
  };
  function appBarSync() {
    var bar = document.getElementById(APP_BAR_ID);
    if (!bar || !appCur) return;
    var undo = bar.querySelector('[data-k="undo"]');
    var redo = bar.querySelector('[data-k="redo"]');
    var hist = appActiveHist();
    if (undo) undo.disabled = !hist || hist.at <= 0;
    if (redo) redo.disabled = !hist || hist.at >= hist.acts.length;
    var dots = bar.querySelectorAll('.mab-dot');
    for (var i = 0; i < dots.length; i++) {
      var on = String(dots[i].getAttribute('data-color')).toLowerCase() === String(brushColor).toLowerCase();
      dots[i].className = 'mab-dot' + (on ? ' on' : '');
    }
    var wv = bar.querySelector('[data-k="wv"]');
    if (wv) wv.textContent = brushWidth.toFixed(1) + '×';
    var cf = bar.querySelector('[data-k="colfit"]');
    /* v2.9.23：手写开关的状态 —— 橘色 = 手指也会落墨（防误触关闭） */
    var hw = bar.querySelector('[data-k="handwrite"]');
    if (hw) {
      var hwOn = appHandWrite();
      hw.className = 'mab-btn hand' + (hwOn ? ' on' : '');
      hw.title = hwOn ? '手指也能写（橘色 = 防误触已关，点一下改回只认笔）'
                      : '只认笔：手掌/手指不落墨（点一下让手指也能写）';
    }
    if (cf) {
      var man = !!appCur.manualCol;
      cf.className = 'mab-btn colfit' + (man ? ' manual' : '');
      cf.title = man ? '列宽：手动（点此恢复自适应）' : '列宽：自适应';
    }
    /* v2.9.20：纸头那三颗（撤销/反撤/清空）跟着同一条历史走，状态一起刷 */
    appSheetSyncTools();
  }
  function appBar() {
    var old = document.getElementById(APP_BAR_ID);
    if (old) old.remove();
    var bar = document.createElement('div');
    bar.id = APP_BAR_ID;
    function mk(k, icon, title, fn, extra) {
      var b = document.createElement('button');
      b.className = 'mab-btn' + (extra || '');
      b.setAttribute('data-k', k);
      b.title = title;
      b.innerHTML = APP_ICON[icon] || icon;
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (b.disabled) return;
        fn();
      }, true);
      bar.appendChild(b);
      return b;
    }
    mk('close', 'close', '关闭草稿', function () { appClose(); });
    /* v2.9.16：这里原来有「笔」「橡皮」两颗按钮，现按用户要求隐藏 ——
       橡皮从未实现（title 写着「暂未实现」，disabled，点了没有任何反应）；
       笔是分栏草稿的唯一模式（appCur.mode 恒为 'pen'，没有别的可切），
       所以那颗「笔」永远亮着、点它等于空操作。两颗都是纯装饰，收掉。
       APP_ICON.pen / APP_ICON.eraser 保留，将来真做橡皮时直接接回来。 */

    /* v2.9.17：五颗题号按钮（一道题一颗）—— 点谁滚到谁，并弹出那道题专属的草稿纸。
       内容区的 ABCD 在分栏里是死的，答题改在纸头那一行（纸 = 这题的面板）。 */
    var qg = document.createElement('div');
    qg.className = 'mab-qgrp';
    qg.setAttribute('data-k', 'qgrp');
    bar.appendChild(qg);
    appQButtons(qg, appSubs());

    /* v2.9.2：笔色 / 粗细搬进这条栏。
       原来的笔色圆点在页面 header 上（app-setting 那一排），进分栏就被顶栏盖住，
       用户以为「换颜色没有了」——其实是看不见，不是没有。 */
    function sep() {
      var d = document.createElement('span');
      d.className = 'mab-sep';
      bar.appendChild(d);
    }
    sep();
    [['#000000', '黑'], ['#1e5eff', '蓝'], ['#e02020', '红']].forEach(function (pair) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'mab-dot';
      d.setAttribute('data-k', 'color');
      d.setAttribute('data-color', pair[0]);
      d.title = pair[1] + '色';
      d.style.background = pair[0];
      d.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        brushColor = pair[0];
        saveBrush();
        if (typeof syncBrushPanel === 'function') { try { syncBrushPanel(); } catch (e) {} }
        appBarSync();
      }, true);
      bar.appendChild(d);
    });
    sep();
    function wk(k, text, title, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mab-w';
      b.setAttribute('data-k', k);
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        fn();
        appBarSync();
      }, true);
      bar.appendChild(b);
      return b;
    }
    wk('wdec', 'A−', '细一点', function () {
      brushWidth = Math.max(0.4, Math.round((brushWidth - 0.2) * 10) / 10);
      saveBrush();
    });
    var wv = document.createElement('span');
    wv.className = 'mab-wv';
    wv.setAttribute('data-k', 'wv');
    bar.appendChild(wv);
    wk('winc', 'A+', '粗一点', function () {
      brushWidth = Math.min(4, Math.round((brushWidth + 0.2) * 10) / 10);
      saveBrush();
    });
    mk('colfit', 'cols', '列宽按内容自适应', function () {
      appColsAuto();
      cvToast('列宽已按内容自适应');
    }, ' colfit');
    /* v2.9.23：手写开关。放在顶栏而不是纸头 ——
       ① 它要同时管「两栏大画布」，纸收起来时纸头根本不在；
       ② 大档铺满时纸从顶栏下沿开始，顶栏一直都在，伸手就够得到；
       ③ 纸头已经挤了 9 个控件（小档还得折行）。 */
    mk('handwrite', 'hand', '只认笔：手掌/手指不落墨（点一下让手指也能写）', function () {
      var on = !appHandWrite();
      appSetHandWrite(on);
      /* 切回只认笔时，正在写的如果是手指那一笔就收掉（已经画上的留着手动撤） */
      var st = appCur && appCur.stroke;
      if (on === false && st && st.ptype !== 'pen' && st.ptype !== 'mouse') appEndStroke(true);
      appBarSync();
      cvToast(on ? '手指也能写（防误触已关）' : '只认笔：手指不落墨');
    }, ' hand');

    var sp = document.createElement('span');
    sp.className = 'mab-sp';
    bar.appendChild(sp);
    mk('undo', 'undo', '撤销', appUndo);
    mk('redo', 'redo', '反撤', appRedo);
    mk('clear', 'trash', '清空', appClear);
    document.body.appendChild(bar);
    return bar;
  }

  /* ---- 进 / 出 ---- */
  function appOpen(group, opts) {
    opts = opts || {};
    if (!group || !isGroupTi(group) || !groupEnabled()) return false;
    if (appCur) appClose(true);
    if (fpOwner) { try { fpExit(); } catch (e) {} }
    appStyle();
    var key = 'app-' + groupKeyOf(group);
    var scrollerL = group.querySelector('.nz-resizable.left') || group.querySelector('.left-section');
    var hostL = group.querySelector('.left-section');
    var scrollerR = group.querySelector('.right');
    var hostR = group.querySelector('.right-section') || group.querySelector('.right-part');
    if (!scrollerL || !hostL || !scrollerR || !hostR) {
      /* v2.9.14：页面还没渲染完时结构可能缺一块 —— 自动打开走静默，稍后重试，
         不要一句「不支持」把一次渲染竞态定成永久失败。 */
      if (!opts.quiet) cvToast('这题的结构不支持分栏草稿');
      return false;
    }
    group.setAttribute(APP_ATTR, '1');
    var saved = appLoad(key);
    appCur = { group: group, key: key, acts: saved.acts, at: saved.at, mode: 'pen', stroke: null,
               sides: {}, savedStyle: [], manualCol: appColsManual(), colW: null,
               /* v2.9.17：每题一张草稿纸（sheets[题号] = {acts, at}），纸默认收起 */
               sheets: saved.sheets || {}, sheetSub: null, sheetOpen: false,
               sheetAlpha: appSheetAlphaSaved(), sheetSize: appSheetSizeSaved(),
               sheetRect: null };
    appInkBox = null;      // 换组了，上一组的「刚写完那笔」不能继续吞 click
    // 记下要改行内样式的元素原貌（退出时原样还回去）
    // v2.9.3 起列宽也走行内 !important，右栏必须一起存，否则退出后宽度会留在页面上
    [group, group.querySelector('.nz-resizable.left'), group.querySelector('.left-section'),
     group.querySelector('.right')].forEach(function (el) {
      if (el) appCur.savedStyle.push({ el: el, css: el.getAttribute('style') });
    });
    /* v2.9.4：整屏已经被组壳占满，页面本身不该再滚。
       以前没锁 body，手指在栏里滑的时候真正滚的是被盖在下面的页面（实测 385px）——
       视觉上就是「两栏怎么都不动」。这里锁住，栏内滚到底也不会链式带动页面。 */
    [document.documentElement, document.body].forEach(function (el) {
      if (!el) return;
      appCur.savedStyle.push({ el: el, css: el.getAttribute('style') });
      try {
        el.style.setProperty('overflow', 'hidden', 'important');
        el.style.setProperty('overflow-x', 'hidden', 'important');
        el.style.setProperty('overflow-y', 'hidden', 'important');
        el.style.setProperty('overscroll-behavior', 'none', 'important');
      } catch (e) {}
    });
    appInlineFix();
    appWatchInline();
    appCur.sides.left = appBuildSide('left', scrollerL, hostL);
    appCur.sides.right = appBuildSide('right', scrollerR, hostR);
    appBar();
    appSheetBuild();       // v2.9.17：草稿纸的 DOM 先建好（收起态），点题号才显示
    appQBarSync();         // 五颗题号按钮先标出当前这一题
    appFitCols();          // v2.9.3：列宽按屏幕+内容现算
    appWatchSplitter();
    appBarSync();
    /* v2.9.15：落笔 / 阻挡挂在 document 捕获层（不是滚动容器）——
       页面上任何透明覆盖层都拦不住我们。同函数同 capture 重复 add 不会叠加。 */
    document.addEventListener('pointerdown', appShieldDown, true);
    document.addEventListener('click', appShieldClick, true);
    appCur.timer = setInterval(function () {
      if (!appCur) return;
      if (!appCur.group.isConnected) { appClose(true); return; }
      /* v2.9.14：页面重渲染可能把顶栏整条干掉（分栏还在、按钮没了）→ 补回来 */
      if (!document.getElementById(APP_BAR_ID)) {
        try { appBar(); appQBarSync(); appBarSync(); } catch (e) {}
      }
      appInlineFix();          // Angular 重渲染会重写行内样式，定期按住
      // 切题/重渲染可能把画布从 DOM 里摘掉：挂回去再按新尺寸重画
      ['left', 'right'].forEach(function (side) {
        var s2 = appCur && appCur.sides[side];
        if (s2 && s2.cv && s2.host && (!s2.cv.isConnected || s2.cv.parentElement !== s2.host)) {
          try { s2.host.appendChild(s2.cv); } catch (e) {}
        }
      });
      // 页面可能把列宽写回它自己的值（实测 800ms 内会动行内 style）→ 发现被改回就重算
      var Lnow = appCur.group.querySelector('.nz-resizable.left');
      if (appCur.colW && Lnow && Math.abs(Lnow.getBoundingClientRect().width - appCur.colW.l) > 6) {
        if (!appCur.manualCol) appCur.colW = null;
        appApplyCols();
      }
      /* v2.9.10：笔在写的时候不许量尺寸、不许重绘 ——
         appSizeSide 会把画布高度临时压成 0 去量内容高，这一下会让栏位 scrollHeight 抖动、
         scrollTop 被夹回去；iPadOS 只要看到滚动发生就把笔的指针流 pointercancel 掉，
         笔画当场断一次。而 appRedraw 又会清空画布重画（那时这一笔还没进 acts）。
         两件事都在每 700ms 的看门狗里，正好对应「写字时每半秒断一下」。 */
      /* v2.9.10：cancel 之后一直没等到笔交回来 → 1.5s 后当它已抬笔收尾，
         否则孤儿笔会一直挂着（看门狗也会跟着不重绘）。 */
      if (appCur.stroke && appCur.stroke.orphan &&
          Date.now() - (appCur.stroke.ts || 0) > 1500) appEndStroke(true);
      if (!appCur.stroke) { appSizeAll(); appRedraw(); }
      appSyncThumbs();
    }, 700);
    window.addEventListener('resize', appOnResize);
    window.addEventListener('click', appPenClickGuard, true);
    /* v2.9.12：这句提示还是 v2.9.7 的语义（手指滑=滚动），跟现在的「手和笔都只写字」不符 */
    /* v2.9.17：提示语跟着新入口改 —— 答题/标记/收藏都在纸头，不在下拉面板里了 */
    cvToast('分栏草稿：点顶栏题号开这题的草稿纸；手和笔都只管写字；滚动用两侧滑块');
    return true;
  }

  function appOnResize() {
    if (!appCur) return;
    appFitCols();          // 转屏/改窗口 → 重新算一遍列宽
    /* v2.9.17：草稿纸也要重新夹回视口（转屏后可能有一半在屏幕外） */
    if (appCur.sheetOpen) appSheetApplySize(appCur.sheetSize);
  }

  function appClose(silent) {
    if (!appCur) return;
    var cur = appCur;
    /* v2.9.12：退出前先记住「正在看的那一道子题」。
       分栏里五道子题是顺排的（共用一张纸），退出后粉笔恢复成一次只显示一道、
       tab 索引还停在第一个 → 用户被送回第一题。记住它，退出后再复位回去。 */
    var backSub = null;
    try { backSub = appCurrentSub(); } catch (e) {}
    appCur = null;
    if (cur.saveTimer) clearTimeout(cur.saveTimer);
    if (cur.timer) clearInterval(cur.timer);
    if (cur.mo) { try { cur.mo.disconnect(); } catch (e) {} cur.mo = null; }
    /* v2.9.10：还有一笔没落账（笔还按着 / cancel 留下的孤儿笔）→ 退出前先入库，不能丢 */
    if (cur.stroke && !cur.stroke.dead && cur.stroke.pts && cur.stroke.pts.length > 1) {
      cur.acts.length = cur.at;
      cur.acts.push(cur.stroke);
      cur.at = cur.acts.length;
      cur.stroke = null;
    }
    try {
      localStorage.setItem(appStoreKey(cur.key), JSON.stringify({
        acts: cur.acts, at: cur.at, sheets: cur.sheets || {}
      }));
    } catch (e) {}
    window.removeEventListener('resize', appOnResize);
    window.removeEventListener('click', appPenClickGuard, true);
    window.removeEventListener('pointermove', appOnMove, true);
    window.removeEventListener('pointerup', appOnUp, true);
    window.removeEventListener('pointercancel', appOnUp, true);
    document.removeEventListener('pointerdown', appShieldDown, true);   // v2.9.15
    document.removeEventListener('click', appShieldClick, true);        // v2.9.15
    /* v2.9.6：把还挂着的笔画滚动手闸和触摸滚动监听一起摘掉 */
    if (cur.stroke && cur.stroke.guard && cur.stroke.guardEl) {
      try { cur.stroke.guardEl.removeEventListener('scroll', cur.stroke.guard, { passive: true }); } catch (e) {}
    }
    var bar = document.getElementById(APP_BAR_ID);
    if (bar) bar.remove();
    appSheetTeardown();               // v2.9.17：草稿纸跟着退场（笔画已随组存盘）
    ['left', 'right'].forEach(function (side) {
      var s = cur.sides[side];
      if (!s) return;
      if (s.cv) s.cv.remove();
      if (s.thumb) s.thumb.remove();
      if (s.detachTouch) { try { s.detachTouch(); } catch (e) {} s.detachTouch = null; }
    });
    (cur.savedStyle || []).forEach(function (rec) {
      try {
        if (rec.css === null) rec.el.removeAttribute('style');
        else rec.el.setAttribute('style', rec.css);
      } catch (e) {}
    });
    try { cur.group.removeAttribute(APP_ATTR); } catch (e) {}
    /* v2.9.12：退出后把「刚才在看的那一道」复位回去（否则会被送回第一题）。
       两条路：展平模式下是页面滚动 → 居中到那道；原生 tab 模式下是切 tab + 容器滚动。
       Angular 恢复布局要一两拍，所以补两次。 */
    if (backSub && cur.group && isGroupTi(cur.group)) {
      var backGroup = cur.group;
      var backFn = function () {
        try {
          if (!backGroup.isConnected || !backSub.isConnected) return;
          if (!backGroup.getAttribute(APP_ATTR)) {
            if (backGroup.getAttribute(FLAT_ATTR) === '1') {
              /* 展平模式：五道子题排在页面上，退出时页面滚回「刚才那道」的顶部。
                 不能只靠恢复 scrollY —— 进分栏时把 html/body 的 overflow 锁成 hidden，
                 WebKit 常常顺手把文档滚回 0，所以必须按当前这道题的绝对位置重算。 */
              var absTop = backSub.getBoundingClientRect().top + (window.pageYOffset || 0) - 8;
              var vh = window.innerHeight || document.documentElement.clientHeight || 0;
              var docH = document.documentElement.scrollHeight || 0;
              var ty = Math.max(0, Math.round(absTop));
              if (docH > 0 && vh > 0) ty = Math.min(ty, Math.max(0, docH - vh));   // 量不到文档高就不夹
              window.scrollTo(0, ty);
            } else {
              var bsubs = subsOf(backGroup), bi = bsubs.indexOf(backSub);
              if (bi > 0) activateGroupTab(backGroup, bi);
              ensureSubVisible(backGroup, backSub);
            }
          }
        } catch (e) {}
      };
      setTimeout(backFn, 60);
      setTimeout(backFn, 320);
    }
    if (!silent) cvToast('已退出分栏草稿');
  }

  // 同一个组再点一次草稿笔图标 = 退出
  function appToggle(group) {
    if (appCur && appCur.group === group) { appClose(); return; }
    appOpen(group);
  }
  /* v2.9.16：整段删掉「组一进视口就自动进分栏」（v2.9.14 加的，用户没有要过）。
     分栏只由用户点题旁的原生笔图标进入（见 fpPenEntry → appToggle）。
     教训记在这里，别再自作主张加回来：草稿是用户手上的纸，什么时候铺、铺哪张，
     必须由用户自己决定 —— 自动铺纸的代价是他在做题时突然被换掉一层界面。 */


  /* ---- v2.7.7 草稿范围淡红框提示已删（v2.7.8 用户反馈没用） ---- */

  // —— 材料智能适应 v2.7.0（仅材料画布挂「适应」按钮）——
  // 点一次 = 整块材料一屏完整显示、文字尽量大。三层杠杆（扰动从小到大）：
  //   L1 缩放：CSS zoom 布局级缩放（高度真实变矮、无需滚动），宽度恒 100%
  //        （v2.7.6：zoom 坐标系里 100% 视觉宽即栏宽，补偿反而溢出被裁）；
  //   L2 宽度：缩放低于 FIT_GOOD 时收窄材料栏——图表 max-width:100% 随栏变矮，材料整体
  //     变矮，从而在 100%（或更高倍率）下完整显示；正文不缩只重排。分隔条本就可手拖，
  //     这里是程序化代拖（直接设左栏宽度，实测 Angular 不会重置，扫描时重复断言）；
  //   L3 兜底：最窄栏 + 下限缩放，仍装不下提示滚动查看。
  // 旧版 bug：真实高度锁在内层 .material-body（固定高 + overflow:auto），宿主
  // scrollHeight 被内层裁成盒高 → 缩放比算成 ≥1 直接不缩。现在先解锁内层再量。
  var FIT_GOOD = 0.82;        // 缩放可接受线：≥此值直接用缩放，不动布局
  var FIT_MIN_W = 420;        // 材料栏收窄下限（px）
  var FIT_W_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5]; // 收窄档位（相对当前栏宽）
  var FIT_BOX = 'data-marvis-fitbox';   // 适应临时解锁的内层盒标记
  var FIT_W_ATTR = 'data-marvis-fitw';  // 适应收窄栏宽时保存的原始 style
  var fitGroups = {};         // key → true：该组因适应而被展平（关全局展平时也保持）

  // 用 CSS zoom 做布局级缩放（高度真实变矮、无需滚动），宽度恒 100%。
  // v2.7.6（真机实测定论）：旧版在缩放时把宽度补偿成 100/s%「让文字铺满栏宽」——
  // 但 Blink 的 zoom 模型里，百分比宽度是在**被缩放元素的自身坐标系**里解析的：
  // 探针实测（父 600px）width:100%+zoom:0.858 → 视觉宽恰 600px（已铺满，无需补偿）；
  // width:116.55%+zoom:0.858 → 视觉宽 699px = 600/0.858，溢出 (1/s-1)×栏宽。
  // 补偿让宿主视觉宽 = 栏宽/s，右半被 .left-section 的 overflow-x:hidden 裁掉
  // （真机：s=0.858 时视觉 1161px vs 栏宽 996px，右 165px 被裁——用户报
  // 「材料图片还是会被裁剪」）。故补偿整体删除，zoom 时宽度恒 100%。
  // 画布在宿主内绝对定位、坐标归一化存储，缩放后重放不失真。
  function cvZoomApply(host, s) {
    if (s && s < 1) {
      host.style.zoom = String(s);
      host.style.width = '100%';
    } else {
      host.style.zoom = '';
      // v2.7.2：不能置空——吸顶展平态下宿主带 flex:0 0 auto，width 置空会按内容
      // max-content 排布把整条链撑爆（文字/表格被裁）。固定回 100% 恒等栏宽。
      host.style.width = '100%';
    }
  }

  function cvZoomOf(host) {
    var z = parseFloat(host.style.zoom);
    return z > 0 && z < 1 ? z : 0;
  }

  // 材料里是否存在「被栏宽钳制的媒体」——图片/表格/SVG 的渲染宽≈宿主宽
  // （max-width:100% 生效，或其自身 width:100%）。这类内容的渲染尺寸由栏宽决定：
  // 其布局宽被钳在「宿主本地宽 = 栏宽/zoom」上，视觉宽恒等于栏宽、视觉高也恒定
  // （宽高比随钳制宽走）——zoom 再大也缩不动它，纯缩放档会白给（v2.7.6 实测：
  // 补偿删除后此结论不变，媒体仍随栏宽而非 zoom 收缩）。此时应优先收窄栏宽(L2)。
  // zoom 归一（v2.7.2）：zoom 会改变 rect 与 clientWidth 的坐标系（实测同一盒子
  // rect 报布局宽、clientWidth 报另一口径，比值永远判不准），故测量前临时摘掉
  // zoom、量完写回——探测器由此可在任何调用时机（含缩放已生效后）安全运行。
  function cvHasWidthBoundMedia(host) {
    if (!host || !host.querySelectorAll) return false;
    var prevZoom = host.style.zoom;
    if (prevZoom) host.style.zoom = '';
    try {
      var els = host.querySelectorAll('img, table, svg');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.closest && el.closest('.marvis-cv-tools')) continue; // 工具条图标不算
        var cs = getComputedStyle(el);
        if (cs.position === 'absolute' || cs.position === 'fixed') continue;
        // 钳制宽度 = 父元素的内容宽（max-width:100% 的参照）；宿主自身可能带内边距
        var p = el.parentElement;
        if (!p) continue;
        var pcs = getComputedStyle(p);
        var bound = p.clientWidth - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
        if (bound <= 0) { // 父元素量不到宽度时退回宿主宽（兜底）
          var hr0 = host.getBoundingClientRect();
          bound = hr0.width || 0;
        }
        if (bound <= 0) continue;
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.width >= bound - 10) return true;
      }
    } catch (e) {}
    finally {
      if (prevZoom) host.style.zoom = prevZoom;
    }
    return false;
  }

  // 左栏（.nz-resizable.left）是粉笔的宽度属主；收窄它 = 代用户拖分隔条
  function cvLeftCol(group) {
    return group ? (group.querySelector('.nz-resizable.left') || group.querySelector('.left')) : null;
  }

  function cvFitSetWidth(cv, w) {
    var group = cv.host && cv.host.closest ? cv.host.closest('.ti') : null;
    var left = cvLeftCol(group);
    if (!left) return;
    if (!left.hasAttribute(FIT_W_ATTR)) left.setAttribute(FIT_W_ATTR, left.getAttribute('style') || '');
    left.style.setProperty('width', w + 'px', 'important');
  }

  // 还原栏宽：只清理自己设过的（FIT_W_ATTR 在）；没设过就一个像素都不动
  // （不能 removeProperty——那会把粉笔自己写在行内的宽度也抹掉）
  function cvFitClearWidth(cv) {
    var group = cv.host && cv.host.closest ? cv.host.closest('.ti') : null;
    var left = cvLeftCol(group);
    if (!left || !left.hasAttribute(FIT_W_ATTR)) return;
    left.setAttribute('style', left.getAttribute(FIT_W_ATTR) || '');
    left.removeAttribute(FIT_W_ATTR);
  }

  function cvFitActive(cv) {
    if (cvZoomOf(cv.host)) return true;
    var group = cv.host && cv.host.closest ? cv.host.closest('.ti') : null;
    var left = cvLeftCol(group);
    return !!(left && left.hasAttribute(FIT_W_ATTR));
  }

  // 解锁材料内部的滚动盒：.material-body 固定高 + overflow:auto 是真实高度锁，
  // 不解锁它宿主 scrollHeight 永远等于盒高、量不到内容真实高度。
  // 展平已解锁过的（FLAT_BOX）跳过；解锁样式存 RELAX_ATTR 供还原。
  function cvUnlockInner(group) {
    var mat = group.querySelector('.materials-container');
    if (!mat) return;
    var els = [mat].concat([].slice.call(mat.querySelectorAll('*')));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.tagName === 'CANVAS') continue;
      if (el.hasAttribute(FLAT_BOX) || el.hasAttribute(FIT_BOX)) continue;
      var cs = null;
      try { cs = getComputedStyle(el); } catch (e) {}
      var oy = (cs && cs.overflowY) ? cs.overflowY : el.style.overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') {
        if (el.scrollHeight > el.clientHeight + 2) {
          if (!el.hasAttribute(RELAX_ATTR)) el.setAttribute(RELAX_ATTR, el.getAttribute('style') || '');
          el.style.setProperty('overflow', 'visible', 'important');
          el.style.setProperty('height', 'auto', 'important');
          el.style.setProperty('max-height', 'none', 'important');
          el.setAttribute(FIT_BOX, '1');
        }
      }
    }
  }

  // 确保材料内容能流动：解锁内层滚动盒 +（锁态布局下）把该组高度链展平。
  // 返回组元素；展平由适应触发时记 fitGroups + __fitOwned，还原时收回。
  function cvEnsureFlow(cv) {
    var host = cv.host;
    var group = host && host.closest ? host.closest('.ti') : null;
    if (!group) return null;
    cvUnlockInner(group);
    if (group.getAttribute(FLAT_ATTR) !== '1') {
      try { flattenGroup(group); } catch (e) {}
      fitGroups[groupKeyOf(group)] = true;
      cv.__fitOwned = true;
    }
    return group;
  }

  // 量材料自然高度（zoom=1）与可用高度：
  //   natural = 宿主内容高（解拉伸后）+ 内层滚动盒内容高的较大者；
  //   avail   = 内层滚动盒 → 盒高；页面滚动 → 视口高减材料顶部位移（装进视口即完整）。
  // 两个坑（真机实测）：
  //   ① flex 拉伸：resizable-container 是 flex 行容器，align-items:stretch 会把左栏
  //      （连同材料）拉到右栏题目等高——短材料被题目高度撑爆，自然高度虚高
  //      （实测短文本材料被撑到 1421px，真实内容仅 229px）。量前给链上各层
  //      align-self:flex-start 中和，量完移除；
  //   ② 画布 absolute 但高度是 px：stale 高度会溢出污染宿主 scrollHeight，
  //      量前先同步一次画布尺寸。
  function cvMeasure(cv) {
    var host = cv.host;
    if (!host) return null;
    var prevZoom = host.style.zoom, prevWidth = host.style.width;
    host.style.zoom = '';
    // v2.7.2：宽度不能置空——宿主带 flex:0 0 auto，置空后按内容 max-content 排布，
    // 文字材料整块不换行、塌成一行，natural 被量成一行高（真机实测 1196px 材料量成
    // ~250px）→ 误判「装得下」不缩放。固定 100%（=栏宽）量得的自然高度才是用户
    // 可见排版下的高度；L2 收窄后重量的口径也随之正确。
    host.style.width = '100%';
    var chain = [];
    var n = host;
    while (n) {
      chain.push(n);
      if (n.classList && n.classList.contains('resizable-container')) break;
      n = n.parentElement;
    }
    // 记下链上原有的行内 align-self（吸顶左栏自带 flex-start），量完原样写回——
    // 早先直接 removeProperty 会把吸顶样式抹掉，左栏重新被拉伸、吸顶失效（v2.7.1）
    var prevAligns = [];
    for (var i = 0; i < chain.length; i++) {
      if (chain[i].style) {
        prevAligns.push(chain[i].style.getPropertyValue('align-self'));
        chain[i].style.setProperty('align-self', 'flex-start', 'important');
      } else prevAligns.push('');
    }
    try { syncCanvasSize(cv); } catch (e) {}
    var rect = host.getBoundingClientRect();
    // natural = 子树最大 scrollHeight（宿主自身也在列——解拉伸后它就是内容高；
    // 不从 rect.height 取：那可能是被拉伸/固定的盒高，jsdom 桩也会误判）
    var natural = 0;
    var els = [host].concat([].slice.call(host.querySelectorAll('*')));
    for (var j = 0; j < els.length; j++) {
      var el = els[j];
      if (el.tagName === 'CANVAS') continue;
      var cs = null;
      try { cs = getComputedStyle(el); } catch (e) {}
      if (cs && (cs.position === 'absolute' || cs.position === 'fixed')) continue; // 覆盖层不算
      try { if (el.scrollHeight > natural) natural = el.scrollHeight; } catch (e) {}
    }
    var top = rect.top || 0;
    var vh = window.innerHeight || 0;
    var sc = scrollerOf(host);
    var isPage = !sc || sc === document.body || sc === document.documentElement;
    var avail = isPage ? Math.max(0, vh - Math.max(0, top)) : (sc.clientHeight || vh);
    for (var k = 0; k < chain.length; k++) {
      if (!chain[k].style) continue;
      if (prevAligns[k]) chain[k].style.setProperty('align-self', prevAligns[k]);
      else chain[k].style.removeProperty('align-self');
    }
    host.style.zoom = prevZoom;
    // 宽度写回：有 zoom 时连补偿值一起还原；无 zoom 也保证不为空（空 → max-content 撑爆）
    host.style.width = prevWidth || '100%';
    if (!natural || avail < 120) return null;
    return { natural: natural, avail: avail, width: Math.round(rect.width || host.clientWidth || 0) };
  }

  // 应用适应结果：{s: 缩放比(1=不缩), w: 栏宽px(0=还原)} + 持久化 + 按钮文案
  function cvFitApply(cv, r) {
    var host = cv.host;
    cvZoomApply(host, r.s);
    if (r.w) cvFitSetWidth(cv, r.w);
    else cvFitClearWidth(cv);
    try {
      if (r.s && r.s < 1) localStorage.setItem(CV_LS_PREFIX + 'zoom-' + cv.key, String(r.s));
      else localStorage.removeItem(CV_LS_PREFIX + 'zoom-' + cv.key);
      if (r.w) localStorage.setItem(CV_LS_PREFIX + 'fitw-' + cv.key, String(r.w));
      else localStorage.removeItem(CV_LS_PREFIX + 'fitw-' + cv.key);
    } catch (e) {}
    syncCanvasSize(cv);
    if (cv.zoomBtn) cv.zoomBtn.textContent = (r.s && r.s < 1) || r.w ? '100%' : '适应';
  }

  // 还原：缩放 100% + 栏宽还原 +（展平由适应触发时）收回展平
  function cvFitRestore(cv) {
    cvFitApply(cv, { s: 1, w: 0 });
    if (cv.__fitOwned) {
      var group = cv.host && cv.host.closest ? cv.host.closest('.ti') : null;
      if (group) {
        try { unflattenGroup(group); } catch (e) {}
        delete fitGroups[groupKeyOf(group)];
      }
      cv.__fitOwned = false;
    }
  }

  // 智能适应主流程：返回 {s, w, msg}；null = 量不出尺寸（布局未就绪）
  function cvSmartFit(cv) {
    var host = cv.host;
    var group = host && host.closest ? host.closest('.ti') : null;
    if (!group) return null;
    // 材料不在合理视口位置时先滚到顶：点「适应」= 要一屏看整块材料，滚动是预期行为
    // （工具按钮就在材料顶部，正常点击时材料本就在视口里，不会触发滚动）
    try {
      var top0 = group.getBoundingClientRect().top || 0;
      if (top0 < -40 || top0 > (window.innerHeight || 0) - 120) group.scrollIntoView({ block: 'start' });
    } catch (e) {}
    group = cvEnsureFlow(cv) || group;
    if (!group) return null;
    var m = cvMeasure(cv);
    if (!m) return null;
    // 本来就装得下：全部还原
    if (m.natural <= m.avail + 2) {
      cvFitApply(cv, { s: 1, w: 0 });
      return { s: 1, w: 0, msg: '材料已完整显示' };
    }
    var s0 = m.avail / m.natural;
    // 被栏宽钳制的媒体(图片/表格)：渲染尺寸由栏宽决定，zoom 缩不动它（布局宽被钳在
    // 栏宽/zoom 上，视觉宽恒为栏宽）——优先走 L2 收窄，媒体随栏变矮，往往能 100%
    // 完整装下且不用缩放
    var mediaBound = cvHasWidthBoundMedia(host);
    // L1：缩放就够读 → 不动布局
    if (s0 >= FIT_GOOD && !(mediaBound && s0 < 1)) {
      var s1 = Math.round(s0 * 1000) / 1000;
      cvFitApply(cv, { s: s1, w: 0 });
      return { s: s1, w: 0, msg: '材料已缩放至 ' + Math.round(s1 * 100) + '%，一屏完整显示' };
    }
    // L2：宽度自适应——逐档收窄，图表随栏变矮；争取 100% 完整显示，其次更高缩放比
    // 注意去重方向：档位比值递减，只有「没有变得更窄」的档（被 FIT_MIN_W 钳住）
    // 才跳过；写反成 w<=lastW 会把第一档之后的所有档全部跳过（真机实测：高图
    // 材料只量了 840 一档就收尾，最优的 467 档永远摸不到）。
    var chosen = null, best = { w: 0, s: s0 }, lastW = 0;
    for (var i = 0; i < FIT_W_STEPS.length; i++) {
      var w = Math.max(FIT_MIN_W, Math.round(m.width * FIT_W_STEPS[i]));
      if (lastW > 0 && w >= lastW) continue; // 档位递减去重
      lastW = w;
      cvFitSetWidth(cv, w);
      var mm = cvMeasure(cv);
      if (!mm) break;
      if (mm.natural <= mm.avail + 2) { chosen = { w: w, s: 1 }; break; } // 100% 装下！
      var s = mm.avail / mm.natural;
      if (s > best.s) best = { w: w, s: s };
      // 媒体钳制时不能因 s>=GOOD 就选缩放档——zoom 缩不动被钳制的媒体，白收窄；只认 100% 档
      if (!mediaBound && s >= FIT_GOOD) { chosen = { w: w, s: Math.round(s * 1000) / 1000 }; break; }
    }
    if (!chosen) {
      if (mediaBound) {
        // 收窄也装不下：缩放兜底（缩得动文字部分；媒体部分随收窄后的栏宽，
        // 视觉尺寸已比原栏宽小，不会被裁——宽度恒 100%，无补偿溢出）
        chosen = { w: best.w || 0, s: Math.max(best.s, CV_ZOOM_MIN) };
      } else {
        chosen = best;
        if (chosen.s < CV_ZOOM_MIN) chosen.s = CV_ZOOM_MIN; // L3：可读性下限
      }
      chosen.s = Math.round(chosen.s * 1000) / 1000;
    }
    cvFitApply(cv, chosen);
    var msg = chosen.s >= 1
      ? '材料栏收窄至 ' + chosen.w + 'px，材料 100% 完整显示'
      : (chosen.w
        ? '材料栏收窄至 ' + chosen.w + 'px + 缩放 ' + Math.round(chosen.s * 100) + '%，一屏完整显示'
        : '材料已缩放至 ' + Math.round(chosen.s * 100) + '%' + (chosen.s <= CV_ZOOM_MIN ? '（可读性下限），剩余部分滚动查看' : '，一屏完整显示'));
    return { s: chosen.s, w: chosen.w, msg: msg };
  }

  // 恢复持久化的适应状态（切题重进 / Angular 重渲染后重新断言）
  // v2.7.5：用户要求「每个资料分析的适应按钮默认就是适应，而不是百分之百」——
  // 打开资料分析题（含切题重渲染 / MutationObserver 全量重扫）一律以原始 100% 呈现，
  // 不再从 localStorage 恢复上次的缩放/收窄；要缩放用户自己点「适应」。
  // 按钮文字只按当前 DOM 实际状态校正：已缩放态显「100%」（点了适应再被重扫时
  // 文字不能错），未缩放态恒「适应」——这就是用户要的默认态。
  // 顺手清掉旧版本遗留的持久化键（存在才删，避免无谓写）。
  function cvFitRestoreState(cv) {
    if (cv.zoomBtn) cv.zoomBtn.textContent = cvFitActive(cv) ? '100%' : '适应';
    try {
      if (localStorage.getItem(CV_LS_PREFIX + 'zoom-' + cv.key) !== null) localStorage.removeItem(CV_LS_PREFIX + 'zoom-' + cv.key);
      if (localStorage.getItem(CV_LS_PREFIX + 'fitw-' + cv.key) !== null) localStorage.removeItem(CV_LS_PREFIX + 'fitw-' + cv.key);
    } catch (e) {}
  }

  // 校准画布尺寸（布局变化 / 解析展开 / 窗宽变化时调用；幂等）
  // zoom 口径：宿主 zoom 会继承缩放子孙 px 长度（实测 computed 1751px 渲染成 1051px），
  // 故视觉高 rh 对应的 CSS 高度要除以 zoom，缩放态下画布仍满覆盖材料。
  function syncCanvasSize(cv) {
    var host = cv.host, canvas = cv.canvas;
    if (!host || !canvas) return;
    var w = 0, rh = 0;
    try {
      var r = host.getBoundingClientRect(); // 用 rect 口径：zoom 缩放下 clientWidth 不稳
      w = r.width || 0;
      rh = r.height || 0;
    } catch (e) {}
    if (!w) w = host.clientWidth || 0;
    if (!w) return;
    // 高度：子题用「题干+选项+48」口径；取不到时退化为宿主全高，避免画布裸奔成 300×150
    var h = cv.heightFn ? (cv.heightFn(host) || rh || host.clientHeight || 0) : (rh || host.clientHeight || 0);
    if (!h) return;
    var z = cvZoomOf(host) || 1;
    var cssH = z < 1 ? Math.round(h / z) : h; // CSS 高度（布局口径）= 视觉高 / zoom
    if (canvas.width !== Math.round(w) || canvas.height !== Math.round(h)) {
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      penReplay(canvas, cv.strokes); // 归一化坐标 → 按新尺寸重放，笔迹不丢
    }
    canvas.style.width = '100%';
    canvas.style.height = cssH + 'px';
  }

  // 在宿主上挂画布 + 工具按钮（幂等：CV_ATTR+CV_VER + 元素上的引用双保险）
  // heightFn(host) → 画布像素高度；传 null 表示覆盖整个宿主。
  // opts.fpEligible（v2.7.7，仅资料分析组内子题）：不在宿主里建画布——「可书写」
  // 时展开的是 body 级整页草稿层（fpOpen 把 cv.canvas 指向层内 canvas），宿主里
  // 只留工具条。其他画布（材料/普通题）一律不走这条路径，行为零改动。
  function ensureOverlayCanvas(host, key, heightFn, toolsPos, opts) {
    opts = opts || {};
    var fpEligible = !!opts.fpEligible;
    if (!host) return null;
    var isMat = toolsPos === 'top';
    // 材料画布（toolsPos=top）：工具条是顶部通栏 band，宿主打标记让 CSS 把
    // .material-body 内容压到 band 下方——按钮不再悬浮遮住材料文字（v2.7.1）；
    // v2.7.8 起 band 里只有「适应」按钮，不再有画布
    if (isMat && host.classList) host.classList.add('marvis-mat-host');
    var existing = host.__marvisCv;
    // 不仅要属性/引用对得上，还要画布与工具仍在文档中：Angular 局部重渲染可能只销毁
    // 子节点（canvas/tools 没了但宿主属性还在），此时必须自愈重建，否则用户看不到画布。
    // fpEligible 画布收起态没有 canvas（整页层未展开），材料 cv（v2.7.8）本就无 canvas，
    // v2.8.0 起 fpEligible 也不再在宿主里挂工具条（改用右侧草稿竖条），都不能因此判定失效而反复重建。
    if (existing && host.getAttribute(CV_ATTR) === CV_VER &&
        (existing.fpEligible || (existing.tools && existing.tools.isConnected)) &&
        (existing.canvas ? existing.canvas.isConnected
                         : (!!existing.fpEligible || !!existing.matToolsOnly))) {
      if (!existing.fpEligible && !existing.matToolsOnly) syncCanvasSize(existing);
      return existing;
    }
    // v2.7.7：宿主被 Angular 重渲染/切题销毁 → 旧画布报废，它占用的整页层先收掉
    if (fpOwner && fpOwner.host === host) fpClose();
    host.setAttribute(CV_ATTR, CV_VER);
    // 重建前清掉残留的旧画布/旧工具（Angular 重渲染或版本升级换代），
    // 否则旧工具的闭包绑在已销毁的 cv 上，会出现「双工具按钮、清空写错对象」
    var stale = host.querySelectorAll('canvas.marvis-pen, .marvis-cv-tools');
    [].slice.call(stale).forEach(function (el) { el.remove(); });

    var saved = cvLoad(key);
    // v2.7.8：材料区（toolsPos=top）不再建草稿画布/切换/清空（用户要求删除——
    // 整页草稿已覆盖材料书写，按钮无用）；「适应」是独立功能保留，工具条只剩它。
    // 材料的 cv 只服务适应逻辑（zoomBtn/cvFit*），无笔迹无模式切换。
    var cv = {
      key: key, host: host, canvas: null, tools: null, toggleBtn: null, clearBtn: null, zoomBtn: null,
      strokes: !isMat && saved ? cvSanitize(cvCap(saved.strokes)) : [],
      // 默认模式按画布类型，且不记忆（v2.7.6，用户要求）：子题画布恒「当前可触摸」
      // （题目区常需要滚动/点选）；localStorage 里的 mode 只写不读——每次打开/刷新
      // 都按类型重置。材料区 v2.7.8 起无画布无模式，此处仅占位。
      mode: isMat ? 'draw' : 'pass',
      heightFn: heightFn, clearArmed: 0,
      // v2.7.7：资料分析子题标记——「可书写」展开整页草稿层而非题目框画布
      fpEligible: fpEligible,
      // v2.7.8：坐标系版本（2=视口归一化，整页草稿层用）；saved.v>=2 说明旧笔迹
      // 已迁移过，不能再迁（否则每次重开都把视口坐标当框坐标再变换一次）
      coordVer: fpEligible ? 2 : 1,
      __fpMigrated: !!(fpEligible && saved && saved.v >= 2),
      // v2.7.8：材料 cv 无画布标记（幂等检查用）
      matToolsOnly: isMat
    };

    // v2.8.0：fpEligible（资料分析子题）宿主里不再挂任何悬浮按钮——「当前可触摸 /
    // 当前可书写」「清空」「退出」全部收进右侧草稿竖条（#marvis-fp-dock），
    // 入口用题目右上角的原生草稿笔图标。材料 cv 只有「适应」。
    var tools = null;
    if (!fpEligible) {
      tools = document.createElement('div');
      tools.className = 'marvis-cv-tools ' + (toolsPos === 'bottom' ? 'marvis-cv-tools-bottom' : 'marvis-cv-tools-top');
    }

    var toggle = null;
    if (!isMat && !fpEligible) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'marvis-cvbtn';
      toggle.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var idx = CV_MODES.indexOf(cv.mode);
        cv.mode = CV_MODES[(idx < 0 ? 0 : idx + 1) % CV_MODES.length];
        applyCvMode(cv);
        cvSave(cv.key, cv.strokes, cv.mode, cv.coordVer);
        if (cv.mode === 'draw') cvToast(drawLabel(cv));
        else cvToast(passLabel(cv));
      });
    }

    var clear = null;
    if (!isMat && !fpEligible) {
      clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'marvis-cvbtn';
      clear.textContent = '清空';
      clear.title = '清空本画布笔迹（两步确认）';
      clear.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var now = Date.now();
        if (now - cv.clearArmed < 3000) {
          cv.strokes.splice(0, cv.strokes.length); // 原地清空：canvas.__marvisStrokes 引用保持有效
          if (cv.canvas) penReplay(cv.canvas, cv.strokes); // fp 收起态 canvas=null，跳过重放
          cvSave(cv.key, cv.strokes, cv.mode, cv.coordVer);
          cv.clearArmed = 0;
          clear.textContent = '清空';
          clear.classList.remove('marvis-cvbtn-warn');
        } else {
          cv.clearArmed = now;
          clear.textContent = '确认清空';
          clear.classList.add('marvis-cvbtn-warn');
          setTimeout(function () {
            if (cv.clearArmed === now) {
              cv.clearArmed = 0;
              clear.textContent = '清空';
              clear.classList.remove('marvis-cvbtn-warn');
            }
          }, 3000);
        }
      });
    }

    // 材料（toolsPos=top）挂「适应」：一键智能适应（缩放/收窄栏宽），再点还原。
    // v2.7.8 起这是材料工具条的唯二内容（另一个是容器本身）——材料区再无草稿功能
    var zoomBtn = null;
    if (toolsPos === 'top') {
      zoomBtn = document.createElement('button');
      zoomBtn.type = 'button';
      zoomBtn.className = 'marvis-cvbtn';
      zoomBtn.textContent = '适应';
      zoomBtn.title = '材料智能适应：整块材料一屏完整显示——优先缩放，不够时自动收窄材料栏（图表随栏变矮）；再点一次还原 100%';
      zoomBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (cvFitActive(cv)) {
          cvFitRestore(cv);
          cvToast('材料已还原 100%');
        } else {
          var r = cvSmartFit(cv);
          if (!r) return; // 量不出尺寸（布局未就绪），不动
          if (r.msg) cvToast(r.msg);
        }
      });
      cv.zoomBtn = zoomBtn;
      // v2.7.5：默认就是「适应」——不恢复上次的缩放/收窄（用户要求打开即原始 100%）
      cvFitRestoreState(cv);
    }

    if (tools && toggle) tools.appendChild(toggle);
    if (tools && zoomBtn) tools.appendChild(zoomBtn);
    if (tools && clear) tools.appendChild(clear);
    if (tools) host.appendChild(tools);

    cv.tools = tools;
    cv.toggleBtn = toggle;
    cv.clearBtn = clear;
    host.__marvisCv = cv;
    cvRegistry.push(cv);

    if (fpEligible) {
      // v2.7.7：子题画布 = 整页草稿层（展开时 cv.canvas 才指向层内 canvas），
      // 宿主里不建 canvas、不挂框内笔事件；默认「可触摸」即收起态。
      applyCvMode(cv);
      return cv;
    }

    if (isMat) {
      // v2.7.8：材料区无画布无笔事件——cv 只服务「适应」按钮
      return cv;
    }

    var canvas = document.createElement('canvas');
    canvas.className = 'marvis-pen pen'; // pen → ⑤笔刷 hook 生效
    canvas.setAttribute('data-marvis-cvkey', key);
    canvas.__marvisStrokes = cv.strokes; // 测试/排障挂钩
    host.appendChild(canvas);

    cv.canvas = canvas;
    syncCanvasSize(cv);
    applyCvMode(cv);
    attachPen(canvas, cv);
    penReplay(canvas, cv.strokes);

    // 宿主尺寸变化（材料栏拖拽 / 窗口缩放 / 解析展开）时按归一化坐标重放
    if (typeof window.ResizeObserver === 'function') {
      try {
        var ro = new window.ResizeObserver(function () { syncCanvasSize(cv); });
        ro.observe(host);
        cv.ro = ro;
      } catch (e) {}
    }
    return cv;
  }

  function ensureMaterialCanvas(group) {
    var host = group.querySelector('.materials-container');
    if (!host) return null;
    var cv = ensureOverlayCanvas(host, 'mat-' + groupKeyOf(group), null, 'top');
    // 画布已存在（重渲染/切题重扫）时也校正按钮文字：v2.7.5 起默认不恢复持久化
    // 缩放（用户要求每个资料分析组默认就是「适应」），只按 DOM 实际状态校正文字
    if (cv) cvFitRestoreState(cv);
    return cv;
  }

  // fpEligible：仅资料分析组内子题传 true（v2.7.7，用户明确要求别的题型不变）——
  // 普通题走粉笔原生草稿、材料画布本就通栏，都不碰整页层。
  function ensureSubCanvas(sub, fpEligible) {
    // v2.8.1：整页草稿只给「一拖五」组内子题；其它宿主一律不建（防止 v2.8.0 那种
    // 把普通题当子题的误建，普通题继续走粉笔原生草稿）
    if (fpEligible && !fpGroupOfSub(sub)) return null;
    var qkey = sub.getAttribute('data-question-key');
    var key = qkey
      ? 'sub-' + qkey
      : 'sub-h' + hashText((sub.querySelector('.title-index') || { textContent: '' }).textContent || '');
    // 高度口径与普通题一致：题干+选项区 + 48；工具按钮放下方留白区，避开题目工具条
    return ensureOverlayCanvas(sub, key, draftTargetHeight, 'bottom', { fpEligible: fpEligible });
  }
  /* ---------- 单题 / 组处理 ---------- */
  // opts.force：用户主动触发（下一题 / 强制全开），无视视口门控；
  // opts.sync：是否同步回填；缺省时随视口门控（滚动扫描只同步视口附近的题）。
  function processTi(ti, opts) {
    opts = opts || {};
    var near = opts.force || nearViewport(ti);
    var doSync = opts.sync === undefined ? near : opts.sync;
    if (isGroupTi(ti)) {
      // v2.8.2：右下角胶囊面板可「部分关闭」——资料分析（1拖5）板块整体不介入，
      // 完全交还粉笔原生：不隐藏组级草稿、不展平、不加字母盒、不建材料画布、
      // 没有整页草稿与草稿竖条。普通题照常。
      if (!groupEnabled()) return;
      neutralizeGroupDraft(ti); // 组级原生草稿：覆盖全组、吃掉指针事件，持续压制
      try {
        // 展平门控：全局开 或 该组有进行中的适应（适应会自己展平锁态组）
        if (flattenEnabled() || fitGroups[groupKeyOf(ti)]) flattenGroup(ti);
        else unflattenGroup(ti);
      } catch (e) {
        // 展开失败不静默：控制台给原因（胶囊已改为脚本总开关，不再承载展开状态）
        if (window.console && console.warn) console.warn('[marvis] 展开失败：', e && e.message);
      }
      var subs = subsOf(ti);
      subs.forEach(function (sub) {
        buildBox(sub);
        if (doSync) syncFeedback(sub);
      });
      if (near) {
        ensureMaterialCanvas(ti); // 解锁盒子后材料仍可见（整宽排在题目上方），共享画布保留
        // v2.7.7：组内子题 = 资料分析专属整页草稿（fpEligible）；材料画布与
        // 普通题的原生草稿都不走这条路径
        subs.forEach(function (s) { ensureSubCanvas(s, true); });
        /* v2.9.16：不再自动进分栏（v2.9.14 的 appMaybeAutoOpen 已删） */
      }
      return;
    }
    buildBox(ti);
    if (doSync) syncFeedback(ti);   // 页面重进 / 元素复用后按既有作答状态回填按钮颜色
    if (near) {
      autoOpenDraft(ti);
      lockDraft(ti);
    }
  }

  /* ---------- v2.7.4 答题卡折叠把手透明化 ---------- */
  // 页面左下角「答题卡 13/130」小白卡（.answer-card-tag）挡题面文字，用户要求全透明。
  // 三个事实决定实现方式：① 白卡是 SVG path 的 fill/stroke（不是背景色），只能 CSS 褪；
  // ② 折叠/展开是 fixed 容器的 transform 位移——不增删节点、不挂类，
  //     MutationObserver 完全无声，且三态容器类名一模一样、没有状态类可钩；
  // ③ 展开态下这个 tag 就是答题卡面板的头部，一概全透会让面板头部穿帮。
  // 故按容器位置判定（rect.top >= 视口高 = 已缩到视口外 = 折叠态）打 .marvis-ac-clear 类，
  // 只透折叠态。scan() 内调一次（DOM 变化即同步）+ 400ms 轮询兜底（位移无事件）。
  // 该把手是全页唯一答题卡入口：只褪色、不隐藏、不拦点击。
  var AC_CLEAR_CLS = 'marvis-ac-clear';
  function acWatch() {
    // 整体 try/catch：这是装饰性同步，任何环境缺桩（如单测的极简 document）都只能静默跳过，
    // 绝不能把 scan() 带崩（brush-test 的 document 桩就没有 querySelector）
    try {
      var c = document.querySelector('.answer-card-container');
      if (!c || !c.classList) return;
      var collapsed = c.getBoundingClientRect().top >= ((window && window.innerHeight) || 0) - 2;
      if (c.classList.contains(AC_CLEAR_CLS) !== collapsed) {
        c.classList.toggle(AC_CLEAR_CLS, collapsed);
      }
    } catch (e) {}
  }

  /* ---------- 全量扫描 ---------- */
  function scan(force) {
    ensureBrushPanel();
    placeBrushPanel();
    acWatch();
    fpCloseIfStale();   // v2.7.7：切题/重渲染后旧画布报废，它占的整页层随之收回
    cvPurgeStrayFp();   // v2.8.1：清掉误建在普通题上的整页草稿画布（旧版本残留）
    // v2.7.9：只有「可书写」态才需要补锁滚动；可触摸态是真·滚动状态，不能锁
    if (fpOwner && fpOwner.mode === 'draw') fpLockScroll();
    var list = tis();
    for (var i = 0; i < list.length; i++) processTi(list[i], force ? { force: true, sync: true } : null);
  }

  /* ---------- SPA 增量渲染适配 ---------- */
  // 除 childList 外必须监听属性级变化：粉笔重进恢复作答时可能只写 checked 属性 / 切 class，
  // 不增删节点，childList-only 观察者完全无声（做题模式 ABCD 按钮不回填的根因之一）。
  var MO_ATTRS = ['checked', 'class', 'aria-checked', 'aria-selected', 'aria-pressed'];
  var pending = false;
  var mo = new MutationObserver(function (records) {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      // 属性变化只影响按钮回填：按 mutation 目标向上找 .ti 精准同步，避免全量重扫；
      // 目标不在任何 .ti 内（如题目列表容器新增子节点）说明结构变了，走完整 scan。
      var targets = [];
      var needFull = false;
      for (var i = 0; i < records.length; i++) {
        var t = records[i].target;
        var ti = t && typeof t.closest === 'function' ? t.closest('.ti') : null;
        if (ti) {
          if (targets.indexOf(ti) === -1) targets.push(ti);
        } else {
          needFull = true;
        }
      }
      if (needFull || !targets.length) {
        scan();
      } else {
        // 属性变化只影响按钮回填：按 mutation 目标向上找 .ti 精准同步（组会展开到子题），
        // 避免全量重扫；sync 显式开启，不随视口门控（交互刚发生，必须立即上色）。
        for (var j = 0; j < targets.length; j++) processTi(targets[j], { sync: true });
      }
    });
  });
  function startMO() {
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: MO_ATTRS
    });
  }

  // ⑨ 滚动即按需补开视口附近的草稿/画布（rAF 节流；passive 不拦滚动）
  var scrollPending = false;
  window.addEventListener('scroll', function () {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(function () {
      scrollPending = false;
      scan();
    });
  }, { passive: true });

  // v2.8.0：资料分析子题的原生草稿笔图标 = 整页草稿开关。
  // 文档捕获层注册得比 fpPassClick 早 → 锁定态下也能先被我们接管（不会被白名单以外吃掉）
  // v2.9.0（真机实测）：粉笔自己在 **window 捕获层** 就把 click 截停了（探针：win-cap 有、
  // doc-cap 没有），挂在 document 上根本收不到 → 改挂 window 捕获层（比 document 更早），
  // document 那份保留作兜底，靠事件上的 __marvisPenDone 去重防止一次点击触发两回。
  window.addEventListener('click', fpPenEntry, true);
  document.addEventListener('click', fpPenEntry, true);

  if (document.body) {
    scan();
    startMO();
  } else {
    document.addEventListener('DOMContentLoaded', function () { scan(); startMO(); });
  }

  // 草稿层动态插入后补偿锁定一次
  setTimeout(function () { scan(); }, 800);

  // v2.7.4：答题卡折叠/展开是 transform 位移（无 MutationObserver 事件可搭），
  // 轮询兜底同步 .marvis-ac-clear 类；容器不存在时每次只是一次 querySelector，可忽略
  setInterval(acWatch, 400);

  window.__MARVIS_FENBI_SCAN__ = scan;
  // 逃生门：强制全开所有题的草稿与画布（视口门控只影响「自动」打开）
  window.__MARVIS_FENBI_OPEN_ALL__ = function () { scan(true); };
  // 一拖五展开开关：__MARVIS_FENBI_FLATTEN__() 无参切换；传 true/false 显式设置；返回新状态
  window.__MARVIS_FENBI_FLATTEN__ = function (on) {
    if (on === undefined) on = !flattenEnabled();
    try {
      localStorage.setItem(FLAT_LS, on ? '1' : '0');
      localStorage.removeItem(FLAT_LS_OLD); // 清掉旧 key，避免旧状态继续误导
    } catch (e) {}
    scan(true);
    return on;
  };
  // 结构自检：返回每组的层级/内联样式/计算样式/滚动尺寸，排查「没生效」时先跑这个
  window.__MARVIS_FENBI_DIAG__ = function () {
    var groups = tis().filter(isGroupTi);
    var out = { version: SCRIPT_VER, flattenEnabled: flattenEnabled(), groups: groups.length, detail: [] };
    groups.forEach(function (g) {
      var rc = g.querySelector('.resizable-container');
      var left = g.querySelector('.nz-resizable.left');
      var qc = g.querySelector('.questions-container');
      var cs = function (el, k) { try { return el ? getComputedStyle(el)[k] : null; } catch (e) { return null; } };
      // 祖先滚动壳链（排查「没延伸」先看这里：谁在 overflow auto/scroll/hidden 且内容超高）
      var ancestors = [];
      var anc = g.parentElement;
      while (anc && anc !== document.body && anc !== document.documentElement) {
        ancestors.push({
          el: anc.tagName.toLowerCase() + (anc.className && typeof anc.className === 'string' ? '.' + anc.className.split(' ').slice(0, 2).join('.') : ''),
          pos: cs(anc, 'position'),
          oy: cs(anc, 'overflowY'),
          h: cs(anc, 'height'),
          sh: anc.scrollHeight,
          ch: anc.clientHeight
        });
        anc = anc.parentElement;
      }
      out.detail.push({
        flat: g.getAttribute(FLAT_ATTR),
        rcInlineH: rc ? rc.style.height : null,
        rcComputedH: cs(rc, 'height'),
        leftInlineW: left ? left.style.width : null,
        leftComputedW: cs(left, 'width'),
        qcInlineOverflow: qc ? qc.style.overflow : null,
        qcComputedOverflowY: cs(qc, 'overflowY'),
        qcScrollH: qc ? qc.scrollHeight : null,
        qcClientH: qc ? qc.clientHeight : null,
        subs: g.querySelectorAll('app-ti.question-multiple').length,
        ancestors: ancestors
      });
    });
    if (window.console && console.log) console.log('[marvis] diag', out);
    return out;
  };
  /* ---------- v2.8.12 笔迹自检 ----------
     同一份代码在 Safari 正常、在 Via 异常 → 说明不能再靠猜浏览器怎么上报指针事件，
     必须把事实采下来。这里把事实打包，并**直接给出结论判定**，三个出口保证拿得到：
       ① window.__MARVIS_FENBI_PEN__()  ② <html data-marvis-pen-diag> ③ 面板浮层 */
  window.__MARVIS_FENBI_PEN__ = function () {
    var streams = penStat.streams;
    var types = {};
    var nStream = 0;     // 真正落过笔的流（有采样点）
    var nAll = 0;        // 页面里出现过的所有流
    for (var k in streams) {
      nAll++;
      if (streams[k].pts > 0) {
        nStream++;
        types[streams[k].type] = (types[streams[k].type] || 0) + streams[k].pts;
      }
    }
    /* v2.8.13：生命周期台账 → 「同一物理笔画被投递两次」的嫌疑检测。
       浏览器把一次落笔拆成两段不同 pointerId 的生命周期时，两段的起点与终点都会
       几乎重合 —— 这正是「一条笔画画成两条交错的线」的头号嫌疑。 */
    var life = penStat.life || [];
    var dupLife = [];
    for (var li = 1; li < life.length; li++) {
      var LA = life[li - 1], LB = life[li];
      if (!LA || !LB || LA.type !== LB.type) continue;
      var d0 = Math.sqrt((LA.x0 - LB.x0) * (LA.x0 - LB.x0) + (LA.y0 - LB.y0) * (LA.y0 - LB.y0));
      var d1 = Math.sqrt((LA.x1 - LB.x1) * (LA.x1 - LB.x1) + (LA.y1 - LB.y1) * (LA.y1 - LB.y1));
      if (d0 < 10 && d1 < 14) {
        dupLife.push({ from: LA.id, to: LB.id, type: LB.type,
          dStart: Math.round(d0), dEnd: Math.round(d1), gapMs: LB.t0 - LA.t0 });
      }
    }
    // 是否真的采到了一次书写（pen 指针留下明显位移）
    var wrote = false;
    for (var wi = 0; wi < life.length; wi++) {
      var LW = life[wi];
      if (!LW || LW.type !== 'pen') continue;
      var dw = Math.sqrt((LW.x1 - LW.x0) * (LW.x1 - LW.x0) + (LW.y1 - LW.y0) * (LW.y1 - LW.y0));
      if (dw > 20) { wrote = true; break; }
    }
    var findings = [];
    if (penStat.nativeChanged && penStat.nativeChanged.length) {
      findings.push('原生草稿画布在书写期间像素发生变化 → 存在第二个画者（原生与我们同时落笔）');
    }
    if (dupLife.length) {
      findings.push('疑似同一物理笔画被投递了 ' + dupLife.length + ' 次（相邻两段生命周期起止点几乎重合）→ ' + JSON.stringify(dupLife));
    }
    if (nStream > 1) {
      findings.push('本次会话出现过 ' + nStream + ' 路指针流（' + JSON.stringify(types) + '）');
    }
    if (penStat.rejected) findings.push('归属不符被丢弃 ' + penStat.rejected + ' 个事件');
    if (penStat.dup) findings.push('重复采样点被丢弃 ' + penStat.dup + ' 个');
    if (penStat.retrace) findings.push('回访（重复/乱序投递）点被丢弃 ' + penStat.retrace + ' 个');
    if (!penStat.penSeen) findings.push('本会话从未出现 pointerType=pen —— 该浏览器可能不把触控笔报告为 pen');
    if (penStat.synthSkip) findings.push('原生补密跳过 ' + penStat.synthSkip + ' 个重复/陈旧样本（幂等防线生效）');
    // v2.8.14：补投/采样比值 —— 唯一能直接判定「有没有重复投递」的指标。
    // 正常情况每个合并采样最多被补投一次（当前点还会被 ① 挡掉）→ 比值应明显 < 1；
    // 比值接近或超过 1 就说明同一批采样被投了不止一遍（v2.8.13 在 Via 上就是这个状态）。
    if (penStat.tickSkip) {
      findings.push('浏览器正在把同一帧的采样逐个投递（' + penStat.tickSkip +
        ' 个事件间隔 <5ms）→ 这些点已整体跳过补密（补了就是投两遍）');
    }
    if (penStat.tailSkip) {
      findings.push('有 ' + penStat.tailSkip +
        ' 个事件的合并列表末尾不是当前事件（浏览器随后会自己把这些采样送到）→ 整批放弃补密');
    }
    if (penStat.synth && penStat.coalescedSum) {
      var sr = penStat.synth / penStat.coalescedSum;
      findings.push('原生补密：补投 ' + penStat.synth + ' 点 / 合并采样 ' + penStat.coalescedSum +
        ' 点 → 比值 ' + sr.toFixed(2) + (sr > 0.95 ? '（⚠ 偏高，疑似重复投递）' : '（正常）'));
    }
    if (!wrote && !(penStat.fpLedger && penStat.fpLedger.length)) {
      findings.push('⚠ 本次采样没有采到任何书写（没有 pen 指针留下位移）——这份数据说明不了笔迹问题；' +
        '请先在草稿区用笔写一笔，再点本按钮重新自检');
    }
    var layers = 0, pens = 0, chips = 0;
    try {
      layers = document.querySelectorAll('#marvis-fp-layer').length;
      pens = document.querySelectorAll('canvas.marvis-pen').length;
      chips = document.querySelectorAll('#marvis-flat-chip').length;
    } catch (e) {}
    if (layers > 1 || chips > 1) findings.push('检测到重复注入（层 ' + layers + ' 个 / 胶囊 ' + chips + ' 个）');
    var out = {
      version: SCRIPT_VER,
      captureValid: !!(wrote || (penStat.fpLedger && penStat.fpLedger.length)),
      findings: findings,
      ua: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      pointerFine: !!(window.matchMedia && matchMedia('(pointer: fine)').matches),
      pointerCoarse: !!(window.matchMedia && matchMedia('(pointer: coarse)').matches),
      hasPointerEvent: typeof PointerEvent !== 'undefined',
      hasCoalesced: typeof PointerEvent !== 'undefined' && !!PointerEvent.prototype.getCoalescedEvents,
      penSeen: penStat.penSeen, mouseSeen: penStat.mouseSeen, touchSeen: penStat.touchSeen,
      streams: streams, streamCount: nStream, streamCountAll: nAll,
      coalesced: {
        max: penStat.coalescedMax,
        avg: penStat.coalescedN ? +(penStat.coalescedSum / penStat.coalescedN).toFixed(2) : 0,
        events: penStat.coalescedN
      },
      dropped: { rejected: penStat.rejected, dup: penStat.dup, retrace: penStat.retrace },
      // v2.8.13：原生补密幂等统计（sent=实际补投数，skip=因重复/陈旧被跳过数）
      // v2.8.14：tick = 因「浏览器正在逐点投递」而整体不补密的事件数
      synth: { sent: penStat.synth, skip: penStat.synthSkip, tick: penStat.tickSkip },
      // v2.8.13：三个取证台账
      life: life,                 // 指针生命周期（down→up）：起止点/时长/类型
      // 原始事件投递顺序（只带最近 120 条：够看清形态，又不至于让 JSON 大到没法粘贴）
      timeline: penStat.timeline.slice(Math.max(0, penStat.timeline.length - 120)),
      fpLedger: penStat.fpLedger, // 我们自己画的每一笔（点数/起止/时长/被拒数）
      dupLife: dupLife,           // 疑似重复投递的相邻生命周期
      pts: penStat.pts, strokes: penStat.strokes,
      nativeCanvases: penStat.nativeCanvases,
      nativeChanged: penStat.nativeChanged,
      layerOpen: !!fpOwner, mode: fpOwner ? fpOwner.mode : null,
      down: !!fpDown,
      curPointerId: fpDown ? fpDown.pointerId : null,
      curPointerType: fpDown ? fpDown.pointerType : null,
      curPts: fpDown ? fpDown.pts.length : 0,
      layers: layers, penCanvases: pens, chips: chips,
      instMark: (document.documentElement && document.documentElement.getAttribute(INST_ATTR)) || null,
      now: new Date().toString()
    };
    var json = JSON.stringify(out, null, 1);
    try { document.documentElement.setAttribute('data-marvis-pen-diag', json); } catch (e) {}
    if (window.console && console.log) console.log('[marvis] pen', out);
    return out;
  };

  // 面板浮层：用户点一下「笔迹自检」就能看到并复制 JSON（不需要能开开发者工具）
  function penDiagOverlay() {
    var out = window.__MARVIS_FENBI_PEN__();
    var json = JSON.stringify(out, null, 1);
    var old = document.getElementById('marvis-pen-diag-box');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'marvis-pen-diag-box';
    box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;bottom:8px;z-index:2147483100;' +
      'background:#fff;border:1px solid #E4E6EB;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);' +
      'display:flex;flex-direction:column;color:#2B2F36;' +
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",monospace;';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #F1F3F5;';
    var title = document.createElement('span');
    title.textContent = '笔迹自检 · v' + SCRIPT_VER;
    title.style.cssText = 'font-weight:700;font-size:12px;';
    var copy = document.createElement('button');
    copy.textContent = '复制 JSON';
    copy.style.cssText = 'font:inherit;font-size:12px;padding:3px 8px;border:1px solid #E4E6EB;border-radius:5px;background:#F8F9FA;';
    copy.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(json);
          copy.textContent = '已复制';
        } else {
          var ta = document.createElement('textarea');
          ta.value = json; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (e2) {}
          ta.remove(); copy.textContent = '已复制';
        }
      } catch (e3) { copy.textContent = '复制失败'; }
    });
    var close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText = 'font:inherit;font-size:12px;padding:3px 8px;border:1px solid #E4E6EB;border-radius:5px;background:#F8F9FA;margin-left:auto;';
    close.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); box.remove(); });
    bar.appendChild(title); bar.appendChild(copy); bar.appendChild(close);
    var pre = document.createElement('pre');
    pre.textContent = json;
    pre.style.cssText = 'flex:1;overflow:auto;margin:0;padding:8px;white-space:pre-wrap;word-break:break-all;' +
      'font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;';
    box.appendChild(bar); box.appendChild(pre);
    document.body.appendChild(box);
    return out;
  }
  window.__MARVIS_FENBI_PEN_OVERLAY__ = penDiagOverlay;
})();
