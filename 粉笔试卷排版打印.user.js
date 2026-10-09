// ==UserScript==
// @name         粉笔试卷排版打印
// @namespace    http://tampermonkey.net/
// @version      11.11.9
// @description  把粉笔在线试卷（行测 / 申论）一键排版成 A4 真卷：题号悬挂缩进、屏幕直接显示 A4 分页、题目可跨页，支持直接打印或导出 PDF。本地运行，无付费、无次数限制。
// @match        *://spa.fenbi.com/*
// @match        *://www.fenbi.com/spa/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* jshint esversion: 8 */

/*
 * 粉笔试卷排版打印 · 本地自用版
 *
 * 流程：提取（读页面 DOM，产出结构化题目数据）
 *       → 渲染（数据拼成一份自包含的打印用 HTML）
 *       → 输出（新窗口打印，或下载成 .html 文件）
 *
 * 全程在浏览器本地完成，不请求任何自己的服务端；页面上不植入计数、授权、
 * 账号体系相关的任何逻辑，也没有使用次数限制。
 */

(function () {
    'use strict';

    /* ==================================================================
     * 一、配置
     * ================================================================ */

    const VERSION = '1.11.9';
    const STORE_KEY = 'fenbi_print_settings';
    const STORE_POS = 'fenbi_print_panel_pos';
    const TITLE_PLACEHOLDER = '正在读取当前试卷…';

    // ── 更新相关：这里有【两条完全不同的路】，别混 ──────────────────────────
    //
    //   ① 预览新版（previewUpdate）—— 拉全文、就地重注入。
    //      好处：立刻看到新版效果。代价：**只活在这一页**。刷新、关标签、换页都会
    //      回到油猴里装的那份。油猴脚本跑在沙箱里，document 跟页面不是同一个，
    //      所以它往 document.head 塞的 <script> 只是当次 DOM 的临时物，
    //      永远够不到油猴自己的存储 —— 这是扩展的安全设计，不是 bug。
    //
    //   ② 永久更新（installUpdate）—— 导航到 @downloadURL（.user.js 地址）。
    //      浏览器跳到该地址 → 油猴识别出是用户脚本 → 弹「安装 / 更新」窗 →
    //      用户点一下 → **油猴把新代码写进自己的存储**，此后刷新、重启都是新版。
    //      这是唯一能真正换掉版本的路。零特权：就是一句 location.href，
    //      @grant none 下照跑。
    //
    //   另外，头部已声明 @updateURL / @downloadURL，油猴会【自己】定期（默认约
    //   12~24 小时）比对 @version，发现新版就在扩展图标上提示 —— 用户不点按钮
    //   也可能收到更新。⚠️ 因此 @version 必须【每次发版都递增】：漏升号 = 油猴
    //   认为没新版 = 油猴用户永远收不到这次修改，而小书签用户拉的是最新全文、
    //   立刻就拿到了，两条路会不同步。
    //
    //   小书签不受以上任何影响：它自己硬编码三个源、每次点击都拉 main 分支最新
    //   全文，既不读 @updateURL/@downloadURL，也不比对 @version（只校验脚本里
    //   还有没有 `const VERSION =` 这个声明）。所以这两个头对小书签是透明的。
    //
    // 检查更新的版本比对源：GitHub 官方 API（浏览器内可跨域，返回 main 分支真实
    // 最新文件，无 CDN 缓存滞后）。之前用 jsDelivr @main 做比对源，该地址有缓存
    // 滞后/卡死，导致「检查更新」永远读到旧快照、报「已是最新」。仅当 GitHub API
    // 不可达时才回退到 jsDelivr 兜底（可能滞后，但总比没有强）。
    const GH_API = 'https://api.github.com/repos/zoij1033/fenbi-print/contents/fenbi-print.user.js?ref=main';
    const UPDATE_FB_URL = 'https://cdn.jsdelivr.net/gh/zoij1033/fenbi-print@main/fenbi-print.user.js';
    // 永久更新的落地地址：必须与头部 @downloadURL 【逐字一致】。
    // 统一用 cdn.jsdelivr.net 主节点（与 install 页 purge 按钮校验的节点一致，消除
    // 「purge 刷 cdn、更新却读 gcore」的口径错位）。⚠️ 教训：gcore 节点曾缓存卡死在
    // 1.8.33 长期不更新，而 purge 按钮只 purge 了 cdn 没碰 gcore，导致「作者在 install
    // 里刷缓存、油猴却仍拿到老版本」。jsDelivr 各节点缓存互相独立，选哪个节点更新，
    // 就必须 purge 哪个节点。
    const INSTALL_URL = 'https://cdn.jsdelivr.net/gh/zoij1033/fenbi-print@main/fenbi-print.user.js';

    // 题号悬挂缩进是固定排版，不提供开关
    const HANG = 2.0;      // 题干悬挂宽度（em）：没有按题计算时的兜底值，容纳三位数题号

    const DEFAULTS = {
        cover: true,           // 默认勾选：打印封面页（含缓冲页）
        // 署名是写死在卷子里的，面板不提供入口
        signature: '工具支持 小红书@火焰百合',
        margin: '15mm 15mm',
        fontFamily: 'simsun',  // 正文字体，默认宋体；存 key 不存链
        fontSize: 15,
        lineHeight: 1.6,
        qSpacing: 18,
        pagination: 'smart',
        figScale: 65,
        shenlunMode: 'none',   // none = 不留作答区；auto = 按题目字数算；fixed = 固定高度
        shenlunSpace: 8,       // 仅在 fixed 模式下生效（cm）
        qrcode: true,
        qrInline: false,       // 二维码紧贴题目（卷尾有空位就排在最后一题下面，中间空一行）。默认关，版面与旧版一致
        countdown: 10,
        autoPrint: true,
        header: false          // 打印页眉（每页顶部印试卷标题）。默认关，版面与旧版一致
    };

    // 排版相关的数值边界，防止乱填导致样式崩坏
    const LIMITS = {
        fontSize: [10, 24],
        lineHeight: [1.2, 2.4],
        qSpacing: [0, 120],
        figScale: [20, 100],
        shenlunSpace: [0, 30],
        countdown: [0, 30]
    };

    /* ==================================================================
     * 二、小工具
     * ================================================================ */

    const $ = (id) => document.getElementById(id);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // 用户输入写进 HTML 前一律转义，避免破坏生成页结构
    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ---------- 正文字体：清单 / 备选链 / 本机检测 ---------- */

    // 字体清单：第一项为默认。key 存 localStorage；chain 是 font-family 备选链（覆盖 Win/mac 别名）。
    //
    // ★ chain 与 probe 是**两件事，绝不能混为一谈**（这是 v1.9.0 检测失效的最后一层根因）：
    //
    //   chain —— 「渲染时怎么兜底」。放的是**任何能用的替代品**，允许跨到另一款字体，
    //            例如「宋体」链里可以有 Noto Serif CJK SC（本机没宋体时用它顶上）。
    //
    //   probe —— 「算不算本机已装」。只放**这款字体本体，以及真正的等价别名**。
    //            ⛔ 绝不能把「链里的替代品」也塞进来！否则——
    //              本机只有 Noto Serif CJK SC（衬线替代）→「宋体」被判已装 → 永不置灰；
    //              本机只有 Noto Sans CJK SC（同源异名）→「思源黑体」被判已装 → 永不置灰。
    //              实测就是这个问题：用户本机没有方正书宋/宋体，面板却全显示「已安装」。
    //            替代品让卷面打得出来，但**不代表用户装了这款字体**，两者必须分开判定。
    //
    // ⚠️ probe 里只能放英文族名，**绝不能放中文名**（如「方正书宋_GBK」）。
    // 中文名走的是浏览器的族名兜底，任何中文字串都能被匹配到某个中文字体，
    // 会导致「没装也判定成装了」。实测已确认中文字串恒被兜底命中。
    //
    // 注意：字体文件一律不内置（中文 CJK 字体单文件 19~27MB，内置会让脚本体积涨约 100 倍）。
    const FONTS = [
        { key: 'simsun', label: '宋体',
            // 宋体的等价别名：Windows SimSun、macOS 的宋体即 STSong / Songti SC
            chain: '"SimSun","STSong","Songti SC","Noto Serif CJK SC",serif',
            probe: ['SimSun', 'STSong', 'Songti SC'],
            // probeExtra —— FontFace local() 直查通道的额外候选（v1.11.5）。
            //   ⚠️ 中文名绝不能进 probe/canvas 通道（见下方 139 行警告），但 local() 通道
            //   查的是本机字体库的注册名、查不到就 reject，**没有任何渲染兜底歧义**，
            //   中文名在这里是安全的，而且是 Windows 中文系统上字体的真实注册名
            //   （simSun.ttc 的中文族名就叫「宋体」，英文 locale 下才注册成 SimSun）。
            probeExtra: ['宋体'] },
        { key: 'sourcehan', label: '思源黑体',
            // 思源黑体的族名：Source Han Sans 是 Adobe 名、Noto Sans CJK 是 Google 名 ——
            // **两者是同一套字**（Adobe/Google 合作开发，字形基本一致，只是发行方各自命名）。
            // 用户不想知道这层内部区别，只关心「选它能不能出黑体」。
            chain: '"Source Han Sans SC","Source Han Sans CN","Source Han Sans TC","Source Han Sans","Noto Sans SC","Noto Sans CJK SC",sans-serif',
            // probe 的**判据（v1.9.6 起调整）**：不再问「装没装思源黑体本体」，
            // 改问「这个选项在本机能不能渲染出可用的黑体」。
            //
            // 起因（用户报）：「面板上提示我思源黑体未安装，为何我在预览中调整的时候
            //   它可以选择并且变成思源黑体呢？好像可以适配到 noto …… 只要能适配到，
            //   就不显示未安装」。实测属实：本机确实没装思源黑体本体，
            //   但 CSS 链能完整回退到已装的 Noto Sans CJK SC（14 个字形全部命中），
            //   也就是**选它确实能出真正的黑体** —— 这时还报「未安装」，是提示在撒谎。
            //
            //   ⚠️ 所以 Noto Sans SC / Noto Sans CJK SC **从 v1.9.6 起纳入 probe**
            //     （v1.9.4~v1.9.5 曾刻意排除，理由是「同源替代品会让假阳性激增」）。
            //     那条老规则的前提是「probe = 装没装本体」，判据一换，它就不再成立 ——
            //     对**黑体**而言，Noto Sans CJK 不是「形似的别的字体」，而是同一套字的另一个名。
            //     不要照老注释把它删掉。
            //
            //   ⚠️ 但**别把这条规则推广到宋体 / 仿宋 / 微软雅黑**：
            //     它们回退到的是 Noto Serif CJK（衬线）和 Noto Sans CJK（无衬线），
            //     与目标字体只是「形似」而非同源。拿黑体当宋体用会把公文排版彻底带偏，
            //     所以那三条**必须继续报未安装**（有单测守着，v34_font_test 里按字体分组断言）。
            //
            //   保留的英文族名 —— Source Han Sans SC / CN、Source Han Sans SC Medium：
            //     都是本体正式族名，装任意字重（Light/Regular/Medium/Bold…）都能命中这一族名。
            //   去掉的 —— Source Han Sans TC（繁体）、Source Han Sans（无区域后缀，易误命中）、
            //     Source Han Sans HW SC（半个字宽变体）：都不是简体公文要用的那一支。
            //   中文名留两条 —— 「思源黑体 CN」（Adobe 中文包注册名）、「思源黑体 Medium」（推荐字重）。
            probe: ['Source Han Sans SC', 'Source Han Sans CN', 'Source Han Sans SC Medium',
                '思源黑体 CN', '思源黑体 Medium',
                // ↓ 同源异名（Google 发行版）。放在最后：它是「能渲染出黑体」的兜底依据，
                //   不是「本体已装」的证据。两者在用户视角下等价，故合并。
                'Noto Sans SC', 'Noto Sans CJK SC'],
            probeExtra: ['思源黑体'] },
        { key: 'yahei', label: '微软雅黑',
            chain: '"Microsoft YaHei","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",sans-serif',
            probe: ['Microsoft YaHei', 'Microsoft YaHei UI'],
            probeExtra: ['微软雅黑'] },
        { key: 'fangsong', label: '仿宋',
            // 仿宋与仿宋_GB2312 是两套字体：装了 _GB2312 不等于装了仿宋，故 probe 里不含它
            chain: '"FangSong","STFangsong","FangSong_GB2312",serif',
            probe: ['FangSong', 'STFangsong'],
            probeExtra: ['仿宋'] },
        { key: 'fsgb2312', label: '仿宋_GB2312',
            chain: '"FangSong_GB2312","FangSong","STFangsong","SimSun",serif',
            probe: ['FangSong_GB2312'],
            probeExtra: ['仿宋_GB2312'] },
        { key: 'fzssgbk', label: '方正书宋_GBK',
            chain: '"FZShuSong_GBK","FZShuSong-Z01S","FZShuSong-Z01","SimSun",serif',
            probe: ['FZShuSong_GBK', 'FZShuSong-Z01S', 'FZShuSong-Z01'],
            probeExtra: ['方正书宋_GBK'] }
    ];
    const FONT_BY_KEY = Object.fromEntries(FONTS.map((f) => [f.key, f]));
    // 未知 key 一律回退宋体 —— 杜绝 font-family:undefined 写进生成页 CSS 导致整卷崩坏
    const fontChainOf = (key) => (FONT_BY_KEY[key] || FONTS[0]).chain;
    // 安装引导的落点。**按「有没有真正的官方源」分档，不是一刀切搜搜索页**。
    //
    // 翻过六款字体的来源之后才知道：只有 2 款存在官方下载页，其余 4 款压根没有 ——
    //   思源黑体    Adobe 官方开源仓库（OFL 授权），有直链
    //   方正书宋    方正字库官网明确标注「免费字 · 可下载直接使用」，有直链
    //   微软雅黑    微软官方立场是「随系统预装，不建议从第三方下载」→ 只能给官方字体文档页
    //   宋体/仿宋   中易（ZhongYi）出品、随 Windows 内置，厂商无个人下载页
    //   仿宋_GB2312 长城电脑 1991 年做的，无官方页面；⚠️ 方正仿宋 ≠ 仿宋_GB2312，不是同一款
    //
    // 所以「能给官方直链就给，给不了就给官方支持页、再不行才落搜索页」。
    // 硬凑一个直链会跳到盗版字体站 —— 那比搜索页危险得多（恶意程序、残缺字库）。
    // 也一律不给 .ttf/.otf 文件地址：商业字体直传涉嫌侵权，脚本不碰这条线。
    const FONT_HELP = {
        // 官方开源仓库，最干净的一档
        sourcehan: {
            url: 'https://github.com/adobe-fonts/source-han-sans/tree/release/OTF/SimplifiedChinese',
            why: 'Adobe 官方开源仓库，别装错字重'
        },
        // 官方免费字，页面明确写了可直接下载使用
        fzssgbk: {
            url: 'https://www.foundertype.com/index.php/FontInfo/index/id/151.html',
            why: '方正字库官网，免费商用'
        },
        // 系统自带字体：微软官方明确不建议第三方下载，只能给官方文档页
        yahei: {
            url: 'https://learn.microsoft.com/zh-cn/typography/font-list/microsoft-yahei',
            why: '随 Windows 自带，缺失请修复系统字体'
        },
        fangsong: {
            url: 'https://learn.microsoft.com/zh-cn/typography/font-list/fangsong',
            why: '随 Windows 自带，缺失请修复系统字体'
        },
        simsun: {
            url: 'https://learn.microsoft.com/zh-cn/typography/font-list/simsun',
            why: '随 Windows 自带，缺失请修复系统字体'
        },
        // 这一款情况最差：**没有厂商官方页面**，而且容易被和「方正仿宋」搞混。
        // 落点用华南师大信息化服务页（mobile.scnu.edu.cn/life/3225/5508）——
        //   ⚠️ 这是**高校托管的实用页面，不是字体厂商的官方发布页**，性质上跟上面几档不同，
        //   诚实起见在注释和 tooltip 里都写明来源，不冒充官方。
        //   选它而不是搜索页的理由：该页有现成的「仿宋_GB2312.zip」下载链接，
        //   对本工具的用户（师生、公文场景）来说是能直接解决问题的落点，
        //   比丢一个搜索页让人自己在盗版站里挑要安全。
        //   照旧不给 .ttf/.otf 直传地址：改指「托管页面」而非「字体文件」是刻意的，
        //   既方便用户，也让脚本不碰版权文件分发这条线。
        fsgb2312: {
            url: 'https://mobile.scnu.edu.cn/life/3225/5508',
            why: '点这里下载（华南师大提供）'
        }
    };

    // 没登记的 key 一律落搜索页兜底 —— 宁可多一次搜索，也不给来路不明的直链
    function FONT_HELP_URL(key, label) {
        const h = FONT_HELP[key];
        if (h) return h.url;
        return 'https://www.bing.com/search?q=' + encodeURIComponent(label + ' 字体 官方 下载 安装');
    }

    // 下拉旁边那个「云朵」小按钮里的图标。
    // 刻意写成常量 + 纯描边 SVG（不用 emoji、不用外部图片）：
    //   · 跨平台渲染一致，不会在 Windows 变成黑白方块
    //   · 不依赖任何网络请求（脚本硬约束之一）
    //   · 描边用 currentColor，hover 变色直接跟着文字色走
    const FONT_CLOUD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M20.4 18H7a5 5 0 0 1-.6-9.96A6 6 0 0 1 17.7 7.3A5.5 5.5 0 0 1 20.4 18z"/>'
        + '<path d="M12 11v5m0 0-2-2m2 2 2-2"/>'
        + '</svg>';

    /* ---------- 本机字体检测：画布测宽法 ---------- */

    // ⚠️ 为什么不用 document.fonts.check()（实测结论，不是猜的）：
    //    该 API 只要带上字号就**恒定返回 true**，与字体是否真的存在完全无关。
    //    实测：16px "FakeFontNotExist" → true；16px "这个字体一定不存在xyz" → true。
    //    用它做检测，结果就是「所有字体都显示已安装、永不置灰」——这正是 v1.9.0 首版的真实故障。
    //
    // 改用【画布测宽 + 双样本 × 双基准交叉校验】：
    //    原理：同一串文本，用【基准族】量一次，再用【目标字体, 基准族】量一次。
    //          字体存在   → 真的用了目标字体 → 两次宽度不同
    //          字体不存在 → 回退到基准族     → 两次宽度完全相同
    //
    //    为什么必须交叉校验（v1.9.0 第二版踩到的真坑，实测复现过）：
    //      生成页 CSS 里有一句 `font-family:"Times New Roman","SimSun",serif!important`
    //      （题号 .fp-num / 公式区用），而预览面板是把生成页样式注入宿主页面渲染的。
    //      于是 "SimSun" 在页面里被声明成了一个可用族名 —— 单基准单样本探测时，
    //      样本里的拉丁字母数字落到 Times New Roman、中文落到 serif 兜底，
    //      宽度差被叠加到 1.8px，越过了 0.5px 阈值 → 本机没有宋体却被判成「已安装」。
    //      思源黑体同理，被 chain 里的 Noto 别名顶上来了。
    //
    //      两条措施一起用：
    //      ① 双样本：两串**字符集不同**的样本（S1 带拉丁字母数字、S2 以 CJK 为主且字符集不同）。
    //         污染只能让「部分字符」落到替换字体上，两串样本必然有一串露馅。
    //      ② 双基准：Arial 与 monospace 两个基准族各测一遍。
    //         真字体在两个基准下都该命中；靠兜底族蹭到的假命中只在某一个基准下命中。
    //      两条都通过才判为「已装」。
    //
    //    ⚠️ 基准族为什么不能是 serif（v1.11.4 修复，用户真机实测踩中）：
    //      旧版双基准是 serif + monospace。在**中文 Windows** 上，serif 渲染含中文的文本时
    //      会解析到**宋体**（Firefox 的 zh-CN 默认衬线字体就是宋体；Chromium 的中文
    //      per-script 回退同样落到宋体）。基准一旦就是宋体本身：
    //        · 测「SimSun」→「"SimSun", serif」与「serif」渲染同一款字体 → 宽度差恒 0 → 漏判；
    //        · 更糟的是宋体/仿宋/仿宋_GB2312/方正书宋这些中易系字体的宽度特征完全一致
    //          （汉字固定全宽 1em、ASCII 固定半宽 0.5em），同一串文本量出来的总宽分毫不差 →
    //          只要基准落到其中任何一款，**全家连带漏判**。
    //      用户真机（宋体 5.16 + 仿宋 5.01 + 仿宋_GB2312 2.00 齐全，截图为证）面板却报
    //      「宋体、仿宋未安装」，正是这个机制。开发时用 fontconfig + Chrome 模拟复现：
    //      以「宽度特征与宋体一致的字体」做基准，SimSun/FangSong 双双误判 false；
    //      换 Arial 基准后双双正确判 true，且不存在的字体/未装的雅黑仍正确判 false。
    //      （v1.9.x 的「25 个族名 0 误判」实测是在无中易字体的 Linux 上做的，
    //      只覆盖了「未装→false」路径，「已装→true」路径在真机上首次暴露。）
    //
    //      Arial 做基准为什么稳：
    //        · Windows / macOS 必装；Linux 上 fontconfig 会把 Arial 映射到同度量的
    //          Liberation Sans —— 三个平台都有着落；
    //        · 它是**西文比例字体**，拉丁字母宽窄不一，与中易系「ASCII 统一 0.5em」的
    //          固定半宽必然不同 → 混排样本的判别力永远在；
    //        · 它是具体族名，不吃 locale 泛族映射的亏（serif/sans-serif 会随语言环境变脸）。
    //      monospace 保留：等宽拉丁（Consolas / Courier New）宽度同样 ≠ 0.5em，第二道防线仍在。
    //
    //    ⚠️ v1.11.5 为什么光改基准还不够（用户真机 Firefox 复测踩中）：
    //      用户是 Firefox，v1.11.4 后宋体/仿宋/仿宋_GB2312 仍报「未安装」，而微软雅黑、
    //      思源黑体正常。canvas 差分对 SimSun 失效，要求「"SimSun", Arial」与「Arial」
    //      连**拉丁字符**都量不出差别 —— 也就是 SimSun 压根没被采纳。结合 Firefox 的
    //      font-visibility 机制（about:config 的 layout.css.font-visibility.*，
    //      1=只暴露基础系统字体白名单 / 3=全部，privacy.resistFingerprinting 会强制降到 1；
    //      白名单里有 Arial、微软雅黑等常见字体，**宋体/仿宋这类不在**）高度吻合：
    //      白名单内的雅黑正常、白名单外的中易系全部「未安装」。这类「浏览器刻意隐藏」
    //      是渲染层面的，canvas 通道原理上测不出来。于是 v1.11.5 上双通道：
    //        通道一 FontFace local() 直查（上面 _ffProbe*）：不渲染、直接查本机字体库
    //          的注册名清单，查不到就 reject，零兜底歧义；中文注册名（宋体/仿宋…）
    //          也能被问到 —— 恰好补上 canvas 通道「中文名有毒」的盲区；
    //        通道二 canvas 差分（原逻辑）：直查判「没有」时复核一遍，两道都否定才报未装。
    //      另评估过 Local Font Access API（window.queryLocalFonts）：只有 Chromium 实现、
    //      Firefox 不支持（本次用户正是 Firefox），且要弹权限框 —— 不采用。
    const FONT_PROBE_BASES = ['Arial', 'monospace'];   // 基准兜底族：具体西文字体 + 等宽（勿用 serif —— 见上）
    const FONT_PROBE_S1 = '粉笔试卷排版打印ABCabc0123（一）';   // 含拉丁 + 数字 + CJK 标点
    const FONT_PROBE_S2 = 'Wgjlq@#0189粉笔试卷';                 // 拉丁小写 + 符号 + CJK，与 S1 字符集不同
    const FONT_PROBE_PX = 72;            // 探测字号。越大，族间宽度差越显著、相对误差越小
    const FONT_PROBE_RATIO = 0.0003;     // 相对阈值：宽度差 ÷ 基准宽度。与字号无关
    const FONT_PROBE_MAX_TRIPS = 3;      // 每组最多量几次；连续结果一致才认定为「无差异」

    // ⚠️ 阈值为什么不能用「固定像素数」：
    //    最初写成 `Math.abs(w - baseW) > 0.5`，隐含假设了「目标字体一定比基准宽」。
    //    实测 URW Bookman（真实存在）比基准族**窄**，在 monospace + S2 下宽度差只有 0.472px，
    //    卡在阈值下被判成「未装」—— 窄字体（Bookman / Condensed 一类）会被系统性漏判。
    //    故改成相对阈值 difference / baseW，与字号解耦。
    //
    // ⚠️ 0.0003 这个数怎么来的（现场实测出来的一组分布，不是拍的）：
    //    72px、2 基准 × 2 样本，13 个本机真实字体取「四组里最小的那个比值」：
    //      Nimbus Roman 0.000599  ← 真实字体里最差
    //      URW Bookman  0.000617
    //      Liberation Mono / Noto Mono 0.001148
    //      其余 0.0039 ~ 0.048
    //    而 6 个不存在的族名（含中文假名、哨兵名）四组比值**全部恰好为 0.000000**。
    //
    //    注意「不存在 ⇒ 差异恒为 0」是数学必然，不是经验值：字体没装时，带与不带该族名
    //    走的是同一条字体解析路径，measureText 是纯函数，必然返回同一个数。
    //    所以约束只来自「真实字体的最差情况」= 0.000599：阈值必须明显小于它。
    //    取 0.0003 —— 距真实最差约 2 倍余量，距「不存在」的 0 亦有近 1 个数量级余量。
    //    （0.001 曾压过上面两个窄字体，是错的；调低而非调高才对。）
    //    maxTrips 里连测三次一致才当「无差异」，是为了防亚像素舍入偶发落在阈值附近而误判。

    /* ========== v1.11.5 通道一：FontFace local() 直查（异步预热） ========== */

    // 直查结果缓存：name → true(存在) / false(不存在) / null(测不了)
    const _ffProbeMap = new Map();
    let _ffProbeSupported = undefined;   // FontFace 构造器可用性，首次探测时确定

    // 测一个族名：new FontFace(临时名, 'local("族名")') 再 load()。
    //   resolve → 本机字体库里真注册着这个名字；reject → 没有。
    // 与 canvas 差分法的本质区别：**完全不做渲染**，直接查字体库的注册名清单 ——
    //   查不到就是查不到，不存在「换个字形顶上」的兜底歧义。所以：
    //     · 中文名（宋体 / 仿宋_GB2312 / 方正书宋_GBK…）在这里是安全的
    //       （canvas 通道里中文名有毒，见 FONTS 定义处的警告）；
    //     · 命中是硬证据：字体文件就在本机，Windows 中文系统上字体的中文注册名
    //       （simSun.ttc 就叫「宋体」）也能被问到 —— 这正是 canvas 通道覆盖不到的盲区。
    // 超时/异常一律 resolve(null)（测不了），由 canvas 通道兜底，绝不挂死流程。
    function _ffProbeOne(name) {
        return new Promise((resolve) => {
            if (_ffProbeSupported === false) return resolve(null);
            let ff;
            try {
                if (typeof FontFace === 'undefined') { _ffProbeSupported = false; return resolve(null); }
                ff = new FontFace('fp-probe-tmp', 'local("' + String(name).replace(/["\\]/g, '') + '")');
            } catch (e) { _ffProbeSupported = false; return resolve(null); }
            const t = setTimeout(() => resolve(null), 4000);
            ff.load().then(
                () => { clearTimeout(t); resolve(true); },
                () => { clearTimeout(t); resolve(false); }
            );
        });
    }

    // 批量预热：把所有字体的 probe + probeExtra 候选一次查完（并发，单个是微秒级字体库查询）
    async function _ffProbeWarmup() {
        if (_ffProbeSupported === false) return;
        const names = new Set();
        FONTS.forEach((f) => (f.probe || []).concat(f.probeExtra || []).forEach((n) => names.add(n)));
        await Promise.all(Array.from(names).map(async (n) => {
            _ffProbeMap.set(n, await _ffProbeOne(n));
        }));
    }

    // 复用一个 canvas 上下文（每次 new 一个 canvas 开销不小，探测要跑十几个族名）
    let _fontProbeCtxCache = undefined, _fontProbeOff = false;
    function _fontProbeCtx() {
        if (_fontProbeCtxCache !== undefined) return _fontProbeCtxCache;
        try {
            const cv = document.createElement('canvas');
            _fontProbeCtxCache = cv.getContext('2d') || null;
        } catch (e) { _fontProbeCtxCache = null; }
        if (!_fontProbeCtxCache) _fontProbeOff = true;   // 无 2d 上下文 → 检测整体降级为「无法检测」
        return _fontProbeCtxCache;
    }

    // 量一次宽度：把 fontFamily 整串交给 canvas。取不到有效宽度返回 null。
    function _measureWidth(fontFamily, sample) {
        const ctx = _fontProbeCtx();
        if (!ctx) return null;
        try {
            ctx.font = FONT_PROBE_PX + 'px ' + fontFamily;
            const w = ctx.measureText(sample).width;
            return (isFinite(w) && w > 0) ? w : null;
        } catch (e) { return null; }
    }

    // 在某基准族下，判断 name 是否真的被采纳。返回 true/false，环境不支持返回 null。
    // 用「与基准宽度不同」作判据，方向不限（宽、窄都算命中）。
    function _hitUnderBase(name, base, sample) {
        const safe = String(name).replace(/["\\]/g, '');
        const baseW = _measureWidth(base, sample);
        if (baseW === null) return null;
        const tol = baseW * FONT_PROBE_RATIO;
        let last = null;
        for (let i = 0; i < FONT_PROBE_MAX_TRIPS; i++) {
            const mixW = _measureWidth('"' + safe + '", ' + base, sample);
            if (mixW === null) return null;
            const diff = Math.abs(mixW - baseW);
            if (diff > tol) return true;              // 一次就够显著，直接判命中
            if (last !== null && Math.abs(mixW - last) > 1e-6) return true;  // 连测不一致 → 也是差异
            last = mixW;
        }
        return false;                                 // 连测数次都完全一致 → 确实没换字体
    }

    // 检测单个字体族名。返回 true=已装 / false=未装 / null=环境不支持检测
    // 判据（v1.11.5 起为双通道）：
    //   ① FontFace local() 直查（probeFonts 里异步预热好的缓存）：
    //      命中 = 本机字体库里确有此名，是硬证据 → 直接判「已装」；
    //   ② 直查说「没有」时，再走 canvas 差分复核 —— **两道都否定才定「未装」**。
    //      canvas 说「有」时仍信 canvas：local() 的名字匹配范围可能偏窄
    //      （部分浏览器只认 full/PS 名），宁可少报未装、不制造「装了却说没有」的误报；
    //   ③ 缓存还没预热完 / FontFace 不可用 → 只跑 canvas 差分（同步，v1.11.4 旧行为）。
    function isFontAvailable(name) {
        if (name === undefined || name === null || name === "") return false;
        if (_ffProbeMap.has(name)) {
            if (_ffProbeMap.get(name) === true) return true;   // ① 直查命中 —— 铁证
            if (_fontProbeOff) return false;                   // canvas 不可用，只看直查结论
            const cv = _isFontAvailableByCanvas(name);         // ② canvas 复核
            return (cv === true) ? true : false;
        }
        // ③ canvas 旧路。注意：canvas 降级（_fontProbeOff）**不能连坐直查通道** ——
        //    直查不依赖 canvas，只要预热完成就有结论（v1.11.5 单测抓到的第一个坑）。
        if (_fontProbeOff) return null;
        return _isFontAvailableByCanvas(name);
    }

    // canvas 差分法（v1.11.4 原逻辑原样抽出）：两串样本 × 两个基准族，
    // 共 4 组必须**全部**命中才认为「已装」。
    function _isFontAvailableByCanvas(name) {
        if (_fontProbeOff) return null;
        if (name === undefined || name === null || name === "") return false;
        let probed = false;
        for (const base of FONT_PROBE_BASES) {
            for (const s of [FONT_PROBE_S1, FONT_PROBE_S2]) {
                const r = _hitUnderBase(name, base, s);
                if (r === null) continue;      // 该组测不了，看别的组
                probed = true;
                if (r === false) return false; // 任一组没命中 → 判定未装
            }
        }
        return probed ? true : null;
    }

    // 逐别名探测，任一命中即算已装（抹平 Win/mac 别名差异）
    // ⚠️ 探针只放「中文名」时，检测结果可能偏乐观（中文串走字族宏观回退，更容易被命中）。
    //    所以返回时额外带一个 sour 标记：
    //      'latin'  —— 命中的是拉丁名/英文代称，检测可靠
    //      'cjk'    —— 只被中文名命中，结论偏弱，状态条里会明说「请以实际打印效果为准」
    //      'none'   —— 未命中（确认未安装）
    //      'unknown'—— 环境不支持检测（无 canvas 2d 等）
    //    按钮是否出现【只由 confirmed 决定，与 sour 无关】—— 别把两件事耦合起来。
    function isFontEntryAvailable(entry) {
        let unknown = false, cjkHit = false;
        for (const alias of entry.probe) {
            const r = isFontAvailable(alias);
            if (r === true) {
                if (/[\u3400-\u9fff]/.test(alias)) { cjkHit = true; continue; }
                return { confirmed: true, sour: 'latin' };
            }
            if (r === null) unknown = true;
        }
        // v1.11.5：FontFace 直查通道的中文候选命中 → 弱置信「已装」（sour:'cjk'，
        // 状态条会提示以实际打印效果为准）。这些中文名**不走 canvas 通道**
        // （canvas 里任何中文字串都会被渲染兜底命中，见 FONTS 定义处的警告）。
        for (const extra of (entry.probeExtra || [])) {
            if (_ffProbeMap.get(extra) === true) { cjkHit = true; break; }
        }
        if (cjkHit) return { confirmed: true, sour: 'cjk' };
        return unknown ? { confirmed: null, sour: 'unknown' } : { confirmed: false, sour: 'none' };
    }

    // 探测结果缓存（模块级，不进 localStorage —— 不同机器结果不同，不该持久化）
    // 结构：{ [key]: { confirmed: true|false|null, sour: 'latin'|'cjk'|'none'|'unknown' } }
    let _fontAvail = null, _fontProbing = null;

    // 已完成的探测结果（同步取）。未完成返回 null，供同步填 option 时用。
    function probeFontsCache() { return _fontAvail; }

    function probeFonts() {
        if (_fontAvail) return Promise.resolve(_fontAvail);
        if (_fontProbing) return _fontProbing;
        _fontProbing = (async () => {
            // 等字体系统就绪，超时 1.5s 兜底，绝不无限等（@run-at document-idle）
            try { await Promise.race([document.fonts && document.fonts.ready, sleep(1500)]); } catch (e) { /* 忽略 */ }
            // v1.11.5：先跑 FontFace local() 直查预热（批量并发，微秒级查询），
            //   再进入各字体的融合判定。直查不可用/超时的名字会自动回落 canvas 通道，不会卡住。
            await _ffProbeWarmup();
            const out = {};
            FONTS.forEach((f) => { out[f.key] = isFontEntryAvailable(f); });
            _fontAvail = out; _fontProbing = null;
            return out;
        })();
        return _fontProbing;
    }

    /* ---------- 更新相关小工具（检查更新 / 立即更新 共用） ---------- */

    // 在面板底部 #fp-update 框里显示一行状态。
    // cls 为 '' / 'busy' / 'ok' / 'err'，分别对应 CSS 中 .fp-update 及其子类的样式；
    // 空 cls 表示「发现新版本」提示态（带「立即更新」链接与忽略 ×）。
    function renderUpdate(text, cls) {
        const box = $('fp-update');
        if (!box) return;
        box.className = 'fp-update' + (cls ? ' ' + cls : '');
        box.innerHTML = text;
        box.style.display = 'flex';
    }

    // 从脚本源码里抠出版本号（const VERSION = 'x.y.z'），拿不到返回 null。
    function extractVersion(txt) {
        if (!txt) return null;
        const m = txt.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
        return m ? m[1] : null;
    }

    // 语义化版本比较：a 新于 b 返回 >0，a 旧于 b 返回 <0，相等返回 0。
    function cmpVer(a, b) {
        const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
        const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
            if ((pa[i] || 0) > (pb[i] || 0)) return 1;
            if ((pa[i] || 0) < (pb[i] || 0)) return -1;
        }
        return 0;
    }

    // 量出一段文本在当前题号字体下的宽度（em，相对字号），用于在渲染前
    // 按题号实际占宽算出每题各自的悬挂列宽，让「题号.题干」间隙恒定可控。
    // family 必须跟随正文字体：题号可能不是纯数字（normNum 只过滤字面量 "null"，
    // 不过滤中文），若题号含中文而此处仍按 "SimSun" 量，悬挂列宽会与实际渲染字体不符 → 题号错位。
    let _fpMeasureCtx = null;
    function textWidthEm(s, fs, family) {
        if (!s) return 0;
        if (!_fpMeasureCtx) _fpMeasureCtx = document.createElement('canvas').getContext('2d');
        _fpMeasureCtx.font = `${fs}px "Times New Roman",${family || '"SimSun"'},serif`;
        return _fpMeasureCtx.measureText(s).width / fs;
    }

    // 填空线：用一条 border-bottom 画出来，不再拼接全角下划线字符
    // 拼接字符会随字体不同出现重叠、断口、粗细不一，画线则永远是一整条
    const BLANK_HTML = '<span class="fp-ul"></span>';
    const BLANK_RE1 = /(?:_{4,}|＿{2,})/g;                    // ____ 或 ＿＿
    const BLANK_RE2 = /(?:&nbsp;|[\u00a0\u3000]){4,}/g;       // 连续不断行空格 / 全角空格

    // 只在标签外的文本里替换，避免把属性值里的下划线也改成标签
    function blankify(html) {
        if (!html) return html;
        return String(html).split(/(<[^>]*>)/).map((seg, i) => {
            if (i % 2 === 1) return seg;
            return seg.replace(BLANK_RE1, BLANK_HTML).replace(BLANK_RE2, BLANK_HTML);
        }).join('');
    }

    // 标记材料里「嵌在文字流中」的行内小图（1.11.2 新增）。
    //
    // 背景：生成页 CSS 有一条 .fp-mat img{display:block;margin:10px auto}，本意是让
    // 材料【独立成段】的配图（结构上几乎总是 <p><img …></p>）居中独占一行。
    // 但它无差别命中了所有材料图片 —— 粉笔材料里还有大量【嵌在文字中间】的行内图，
    // 典型就是 LaTeX 公式图：<p>…纯水分子在低于<img flag="tex" …>时才会凝结；…</p>。
    // display:block 把行内公式从句子里劈出来，变成独立居中行 —— 真机现象就是
    // 「碰到摄氏度这类小图片就换行」，一张公式图占一整行，句子断成三截。
    //
    // 这里按结构判定：图片的父块里除它之外还有别的节点（元素或非空白文本）→
    // 它嵌在内容流里 → 打 data-fp-inline 标记，由 CSS 恢复行内显示；
    // 父块里只有这张图 → 独立成段的配图，维持块级居中不变。
    // flag="tex" 的公式图无条件视为行内（公式永远是行内符号，哪怕独占一段也应
    // 跟随该段的 text-align，而不是自己变成块级）。
    //
    // 只在 buildHtml 的材料分支调用（题干/选项没有 display:block 问题，不用管）。
    // 纯字符串进、字符串出，不碰原版页面。
    function markMatInline(html) {
        if (!html || html.indexOf('<img') === -1) return html;
        const d = document.createElement('div');
        d.innerHTML = html;
        let marked = false;
        d.querySelectorAll('img').forEach((img) => {
            const p = img.parentNode;
            if (!p) return;
            if (img.getAttribute('flag') === 'tex'){ img.setAttribute('data-fp-inline', '1'); marked = true; return; }
            let hasOther = false;
            for (const n of p.childNodes){
                if (n === img) continue;
                if (n.nodeType === 1){ hasOther = true; break; }
                if (n.nodeType === 3 && n.textContent.replace(/[\s\u00a0\u3000]/g, '').length){ hasOther = true; break; }
            }
            if (hasOther){ img.setAttribute('data-fp-inline', '1'); marked = true; }
        });
        return marked ? d.innerHTML : html;
    }

    // 选项内容常常整段包在 <p> 里。把 p 解开成行内流，
    // 悬挂缩进（padding-left + 负 text-indent）才能作用在行内，
    // 换行后的文字才对得齐字母右侧；否则字母会在 p 的上一行孤零零地悬着。
    // 选项内容只要外面套了一层块级盒子（p/div/app-format-html 都算），
    // 浏览器就会在字母后面断行 —— 看上去就是「A. 一行、内容一行」。
    // 这里把纯文字的块级外壳统统拆掉，让内容跟字母待在同一个行内流里。
    const OPT_BLOCK = /^(P|DIV|SECTION|ARTICLE|APP-FORMAT-HTML|H[1-6]|LI|DD|DT)$/;
    function flattenOpt(html) {
        if (!html || html.indexOf('<') < 0) return html;
        const d = document.createElement('div');
        d.innerHTML = html;
        // 有图片/表格这类必须保持块状的，整个不动，交给 CSS 单独排
        if (d.querySelector('img, table, svg, canvas, ul, ol, dl, pre')) return html;
        const out = [];
        (function walk(node) {
            const kids = node.childNodes;
            for (let i = 0; i < kids.length; i++) {
                const c = kids[i];
                if (c.nodeType === 3) { out.push(c.nodeValue); continue; }
                if (c.nodeType !== 1) continue;
                if (c.tagName === 'BR') { out.push(' '); continue; }
                if (OPT_BLOCK.test(c.tagName)) walk(c);
                else out.push(c.outerHTML);
            }
        })(d);
        const s = out.join('').replace(/\s+/g, ' ').trim();
        return s || html;
    }

    // 数值设置：非法输入一律回退到默认值
    function num(v, def, key) {
        const n = parseFloat(v);
        if (!isFinite(n)) return def;
        const range = LIMITS[key];
        if (!range) return n;
        return Math.min(range[1], Math.max(range[0], n));
    }

    const text = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
    // 题号规范化：粉笔某些题型（材料分析、申论小题等）没有数字题号时，DOM 里偶尔出现
    // 字面量「null」占位。这里统一归零为空，避免试卷里印出「null.」这种字样。
    const normNum = (s) => { const t = (s == null ? '' : String(s)).trim(); return (/^null$/i.test(t) ? '' : t); };

    // 估算一段文本占多宽：全角字符记 1，半角（ASCII）记 0.55，单位是「字号的倍数」
    function cjkUnits(s) {
        let u = 0;
        for (let i = 0; i < s.length; i++) u += s.charCodeAt(i) < 128 ? 0.55 : 1;
        return u;
    }

    // 找到页面里真正在滚动的容器（懒加载触发点），否则退回 window
    function findScroller() {
        const sels = ['.tis-container', '.question-container', '.paper-container', '[class*="scroll"]'];
        for (const sel of sels) {
            let el = null;
            try { el = document.querySelector(sel); } catch (e) { /* 选择器异常则跳过 */ }
            if (el && el.scrollHeight > el.clientHeight + 80) return el;
        }
        let node = document.querySelector('app-ti') || document.querySelector('.chapter-container');
        while (node && node !== document.body && node !== document.documentElement) {
            try {
                const st = getComputedStyle(node);
                if (/(auto|scroll|overlay)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 80) return node;
            } catch (e) { /* 忽略 */ }
            node = node.parentElement;
        }
        if (document.documentElement.scrollHeight > window.innerHeight + 80) return window;
        return document.querySelector('.tis-container') || window;
    }

    /* ==================================================================
     * 三、设置持久化
     * ================================================================ */

    function readSettings() {
        const s = {};
        try { Object.assign(s, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { /* 忽略 */ }
        Object.keys(DEFAULTS).forEach((k) => {
            if (!(k in s)) s[k] = DEFAULTS[k];
        });
        return s;
    }

    function saveSettings() {
        const s = {};
        const ids = {
            cover: 'fp-cover', margin: 'fp-margin', fontSize: 'fp-fontSize',
            fontFamily: 'fp-fontFamily',
            lineHeight: 'fp-lineHeight', qSpacing: 'fp-qSpacing',
            pagination: 'fp-pagination', figScale: 'fp-figScale',
            shenlunMode: 'fp-shenlunMode', shenlunSpace: 'fp-shenlunSpace',
            qrcode: 'fp-qrcode', countdown: 'fp-countdown',
            autoPrint: 'fp-autoPrint', header: 'fp-header', qrInline: 'fp-qrInline'
        };
        Object.keys(ids).forEach((k) => {
            const el = $(ids[k]);
            if (!el) return;
            s[k] = el.type === 'checkbox' ? el.checked : el.value;
        });
        try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 忽略 */ }
    }

    function applySettings(s) {
        const ids = {
            cover: 'fp-cover', margin: 'fp-margin', fontSize: 'fp-fontSize',
            fontFamily: 'fp-fontFamily',
            lineHeight: 'fp-lineHeight', qSpacing: 'fp-qSpacing',
            pagination: 'fp-pagination', figScale: 'fp-figScale',
            shenlunMode: 'fp-shenlunMode', shenlunSpace: 'fp-shenlunSpace',
            qrcode: 'fp-qrcode', countdown: 'fp-countdown',
            autoPrint: 'fp-autoPrint', header: 'fp-header', qrInline: 'fp-qrInline'
        };
        Object.keys(ids).forEach((k) => {
            const el = $(ids[k]);
            if (!el) return;
            if (el.type === 'checkbox') el.checked = !!s[k];
            else el.value = s[k];
        });
    }

    // 这些都不是有效试卷名，必须过滤掉（实测三种页面状态各自的返回值）：
    //  · ''                  —— 空
    //  · 'null'/'undefined'  —— Angular 未渲染完时标题元素带 title="null" 占位属性，
    //                            getAttribute 一读到就被 || 短路当成有效值，封面印出「null」
    //  · '粉笔题库'           —— 粉笔做题页的静态 document.title（元素还没渲染时就会退到它），毫无意义
    //  · '粉笔'/'粉笔网'      —— 同类噪音
    const BAD_TITLE = new Set(['', 'null', 'undefined', '粉笔', '粉笔网', '粉笔题库']);

    // 把当前面板状态读成排版参数（带边界钳制）
    function collectOptions() {
        const s = readSettings();
        return {
            cover: !!$('fp-cover').checked,
            // 署名固定，没有面板入口，也不提供关闭开关
            signature: DEFAULTS.signature,
            margin: $('fp-margin').value,
            // 非法/空值一律回退默认宋体：杜绝 font-family:undefined 写进生成页 CSS
            fontFamily: (function () {
                const el = $('fp-fontFamily');
                const v = el ? el.value : '';
                return FONT_BY_KEY[v] ? v : DEFAULTS.fontFamily;
            })(),
            fontSize: num($('fp-fontSize').value, s.fontSize, 'fontSize'),
            lineHeight: num($('fp-lineHeight').value, s.lineHeight, 'lineHeight'),
            qSpacing: num($('fp-qSpacing').value, s.qSpacing, 'qSpacing'),
            pagination: $('fp-pagination').value,
            figScale: num($('fp-figScale').value, s.figScale, 'figScale'),
            shenlunMode: $('fp-shenlunMode').value,
            shenlunSpace: num($('fp-shenlunSpace').value, s.shenlunSpace, 'shenlunSpace'),
            qrcode: !!$('fp-qrcode').checked,
            // 二维码不单独成页：面板「设置 ▾」里的「尽量和题目排在一起」。
            // 元素缺失时按默认（关）处理 —— 关 = 与旧版完全一致。
            qrInline: (function () { var el = $('fp-qrInline'); return el ? !!el.checked : !!DEFAULTS.qrInline; })(),
            countdown: num($('fp-countdown').value, s.countdown, 'countdown'),
            autoPrint: !!$('fp-autoPrint').checked,
            // 页眉开关：面板「设置 ▾」里的「打印页眉」。元素缺失时按默认（关）处理
            header: (function () { var el = $('fp-header'); return el ? !!el.checked : !!DEFAULTS.header; })(),
            // 兜底顺序：① 面板里用户填的（或已回填的）→ ② 页面真实标题 → ③ 兜底名。
            // 拦截 'null'/'undefined'：把 null 赋给 input.value 会被 JS 强转成字符串 'null'。
            // readPaperTitle() 读不到时可返回空串，这里必须再兜一层，否则封面会印出空白。
            title: (function () {
                const v = ($('fp-title').value || '').trim();
                if (v && !BAD_TITLE.has(v)) return v;
                return readPaperTitle() || '公务员录用考试试卷';
            })()
        };
    }

    // 从页面读取当前试卷标题。读不到「有意义的名字」时返回 ''（不编造），
    // 由调用方决定是提示用户还是用兜底标题 —— 「拿不到就明说」比印个假名字好。
    function readPaperTitle() {
        const cand = [];
        for (const sel of ['.header-title', '.paper-name', '.header-center .title']) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const raw = el.getAttribute('title');
            const t = (raw == null ? '' : String(raw).trim()) || (text(el) || '').trim();
            if (t && !BAD_TITLE.has(t)) cand.push(t);
        }
        const dt = (document.title || '').trim();
        if (dt && !BAD_TITLE.has(dt)) cand.push(dt);
        return cand.length ? cand[0] : '';
    }

    function getPaperId() {
        const m = window.location.href.match(/\/exercise\/([^?&/]+)/);
        return m ? m[1] : null;
    }

    /* ==================================================================
     * 四、界面
     * ================================================================ */

    function injectStyle() {
        const css = `
#fp-mask{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);z-index:9999990;display:none;align-items:center;justify-content:center;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
#fp-mask-box{background:#181b21;border:1px solid #2e333d;border-radius:10px;padding:28px 34px;min-width:280px;max-width:380px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.7)}
.fp-spin{width:38px;height:38px;border:3px solid #2e333d;border-top-color:#4dd0e1;border-radius:50%;animation:fp-rot .8s linear infinite;margin:0 auto 14px}
@keyframes fp-rot{to{transform:rotate(360deg)}}
#fp-mask-title{font-size:15px;font-weight:700;color:#e6eaf0;margin-bottom:6px}
#fp-mask-sub{font-size:12px;color:#8b95a3;line-height:1.6;white-space:pre-line}

.fp-panel{position:fixed;top:110px;right:20px;width:302px;background:#181b21;border:1px solid #2e333d;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.55);padding:0;z-index:9999989;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#d7dce3;box-sizing:border-box;max-height:calc(100vh - 140px);overflow:hidden;display:flex;flex-direction:column}
.fp-scroll{flex:1 1 auto;min-height:0;margin:20px 0;padding:0 16px;overflow-y:auto;scrollbar-gutter:stable both-edges;scrollbar-width:thin;scrollbar-color:#333a45 transparent}
.fp-scroll::-webkit-scrollbar{width:8px}
.fp-scroll::-webkit-scrollbar-track{background:transparent}
.fp-scroll::-webkit-scrollbar-thumb{background:#333a45;border-radius:4px}
.fp-scroll::-webkit-scrollbar-thumb:hover{background:#414a58}
.fp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;cursor:move;user-select:none;border-bottom:1px solid #2e333d;padding-bottom:11px}
.fp-brand{display:flex;align-items:center;gap:8px}
.fp-emoji{font-size:18px;line-height:1}
.fp-name{font-size:15px;font-weight:700;color:#e6eaf0;letter-spacing:.3px}
.fp-mini{font-size:12px;color:#648CFC;cursor:pointer;padding:4px 9px;border-radius:6px;user-select:none;background:#22262e}
.fp-mini:hover{background:#2b323d;color:#8aa6fd}
.fp-x{font-size:18px;color:#6b7583;cursor:pointer;padding:2px 7px;border-radius:6px;line-height:1}
.fp-x:hover{color:#e6eaf0;background:#2b323d}
.fp-field{margin-bottom:12px}
.fp-label{display:block;font-size:11.5px;font-weight:600;color:#8b95a3;margin-bottom:5px;letter-spacing:.4px}
.fp-input,.fp-select{width:100%;padding:8px 10px;box-sizing:border-box;border:1px solid #3a4049;border-radius:6px;font-size:13px;color:#e6eaf0;background:#22262e;outline:none;font-family:inherit}
.fp-input::placeholder{color:#5c6674}
.fp-input:focus,.fp-select:focus{border-color:#4dd0e1;box-shadow:0 0 0 3px rgba(77,208,225,.15)}
.fp-select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,#8b95a3 50%),linear-gradient(135deg,#8b95a3 50%,transparent 50%);background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:28px}
.fp-check{display:flex;align-items:center;font-size:13px;color:#d7dce3;cursor:pointer;gap:8px;user-select:none}
.fp-check input{width:15px;height:15px;accent-color:#648CFC;margin:0;background:#22262e}
.fp-input[type=number]::-webkit-inner-spin-button,.fp-input[type=number]::-webkit-outer-spin-button{color:#648CFC;opacity:1}
.fp-hint{font-size:11px;color:#6b7583;margin-top:4px;line-height:1.5}
.fp-stat{font-size:12px;color:#8b95a3;margin-bottom:0;line-height:1.6;min-height:0}
/* 状态文字（共 X 题 / Y 份材料 等）出现时才在下方撑出间距，
   把按钮推下去；空着时不占空间，不会提前预留一块空白给提示词 */
.fp-stat:not(:empty){margin-bottom:12px}
.fp-stat b{color:#4dd0e1}
.fp-preview-btn{width:100%;padding:13px;background:#252a33;color:#a8b2bf;border:1px solid #3a4049;border-radius:8px;cursor:pointer;font-size:15px;font-weight:700;font-family:inherit;transition:background .15s;margin-bottom:14px}
.fp-preview-btn:hover{background:#2f353f;color:#d7dce3}
.fp-preview-btn:active{transform:translateY(1px)}
.fp-btns{display:flex;gap:8px;margin-bottom:12px}
.fp-btn{flex:2;background:#2F7FE0;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;transition:background .15s}
.fp-btn:hover{background:#4f9af0}
.fp-btn:active{transform:translateY(1px)}
.fp-btn:disabled{background:#3a4049;color:#6b7583;cursor:wait}
.fp-btn2{flex:1;padding:11px;background:#252a33;color:#a8b2bf;border:1px solid #3a4049;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;transition:background .15s}
.fp-btn2:hover{background:#2f353f;color:#d7dce3}
.fp-adv{display:none;margin-top:14px;padding-top:13px;border-top:1px dashed #333a45}
.fp-row{display:flex;gap:10px}
.fp-row>.fp-field{flex:1}
.fp-fontbar{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11.5px;min-height:18px}
.fp-fontbar.ok{color:#7ee2a8}
.fp-fontbar.no{color:#c9a227}
.fp-fontbar .fp-src{margin-left:4px;color:#5c6674}
/* 字体下拉旁的云朵小按钮 —— 唯一的「去装字体」入口。
   下拉本身永远保持可点选（未装也能选、会走备选链回退），所以安装引导不能挂在 option 上，
   必须独立成一个按钮；这两件事在结构上就是分开的。
   元素是 <a> 而非 <button>：安装引导本质是「跳一个页面」，要的就是原生 href 语义。
   补 text-decoration:none 是因为 <a> 默认带下划线 —— 换成 <a> 后才需要这一句。 */
.fp-fam-wrap{position:relative;display:flex;align-items:center;gap:6px}
.fp-fam-wrap .fp-select{flex:1;min-width:0}
/* ⚠️ 云朵 tooltip 与下方文字的关系（v1.9.4 → v1.9.7 → v1.11.7 三版演进，最后一代才做对）：
   tooltip 从云朵正下方展开，而它下面紧挨着状态条（.fp-fontbar）和说明（.fp-hint）。
   浮层不透明、两行文案 48~65px 高，纵向会压到那两行字。

   v1.9.4 的解法是「在下拉行与状态条之间撑开 70px，给浮层留落点」——
      方向就错了：这是把**覆盖式浮层**当成**占位元素**来伺候，代价是那块空白常驻。
   v1.9.7 把 70px 改成「仅当云朵可点（非 .done）时才撑开」，只治了已装态；
      未装态依旧常驻 70px，用户实测再报「**未安装的**提示词和菜单栏离得很远」，
      正是那一块常驻空白把「⚠ 本机未安装」推到了 70px 之外。

   v1.11.7 修法：**不再预留任何空间**（margin-bottom 恒为 0）。
      浮层本就是 position:absolute、不占文档流，页面不需要也不应该为它腾地方。
      要解决的只是「它盖住的那两行字」——改为在**云朵 hover、浮层弹出的同一时刻**，
      用 :has() 把紧随其后的状态条与说明置为 opacity:0 让位。
      一次鼠标进入同时触发「浮层出现 + 文字让位」，视觉上就是浮层原地替换了那两行，
      既没有空白，也没有叠字。
      opacity 而非 display:none：保留占位 → 面板高度不变，鼠标移开后文字原地淡回，无跳动。
      只作用于设置面板（.fp-field-font）；预览工具条（.fp-prev-ctl）的浮层盖的是下方 iframe
      预览区，那里没有文字，不需要让位，也不该为它保留任何间距。
      :has() 在 Chrome 105+ / Safari 15.4+ / Firefox 121+ 均可用，油猴脚本只跑在这三类现代浏览器上。 */
.fp-field-font .fp-fam-wrap{margin-bottom:0}
.fp-field-font .fp-fam-wrap:has(.fp-cloud:hover)~.fp-fontbar,
.fp-field-font .fp-fam-wrap:has(.fp-cloud:hover)~.fp-hint{opacity:0}
.fp-cloud{position:relative;flex:0 0 auto;width:26px;height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center;background:#252a33;color:#8aa6fd;border:1px solid #3a4049;border-radius:6px;cursor:pointer;font-family:inherit;text-decoration:none;box-sizing:border-box;transition:background .15s,color .15s,border-color .15s,opacity .15s}
.fp-cloud:hover{background:#2b323d;color:#a9bdff;border-color:#4a5361}
.fp-cloud:active{transform:translateY(1px)}
/* 已安装 → 置灰不可点。
   pointer-events:none 挡鼠标，但键盘回车仍能触发 —— 所以 renderFontCloud 里还会把 href
   整个删掉，<a> 没 href 就不进 Tab 焦点链、也不响应激活，两层一起才算真禁用。 */
.fp-cloud.done{background:#1e222a;color:#4a5361;border-color:#2e333d;cursor:default;pointer-events:none;opacity:.85}
.fp-cloud.done:hover{background:#1e222a;color:#4a5361;border-color:#2e333d}
.fp-cloud.done:active{transform:none}
/* ⚠️ v1.9.7：.done 态必须**显式**关掉浮层。
   原来只靠 pointer-events:none 挡鼠标 —— 这在实际使用里够用（鼠标进不来就 hover 不了），
   但 CSS 上 .fp-cloud:hover::after{opacity:1} 这条规则**并没有被 .done 覆盖**：
   只要有任何路径触发 :hover（CDP 强制伪态、调试器、或将来加了别的交互），
   浮层就会从一个「不可点的灰按钮」上弹出来，语义自相矛盾。
   补这一条让 .done 的语义完整：既不可点，也不弹说明。
   顺带这也让「已完成」态在几何上真正不占浮层空间 —— 与上面 margin-bottom 的按需预留是同一个判断。 */
.fp-cloud.done::after{opacity:0}
.fp-cloud.done:hover::after,.fp-cloud.done:focus-visible::after{opacity:0}
.fp-cloud svg{width:15px;height:15px;display:block;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
/* 未装时给个小黄点，让人一眼看到「这里有事要做」；已装/检测不出都不显示 */
.fp-cloud .fp-dot{display:none;position:absolute;top:-2px;right:-2px;width:7px;height:7px;border-radius:50%;background:#c9a227;border:1px solid #1b1f26}
.fp-cloud.warn .fp-dot{display:block}
/* tooltip 用 pre-line 而不是 pre：
   pre 完全不换行，配 max-width 会把超长的一行**直接裁掉**（用户实测第三行被切在半句上）。
   pre-line 保留 data-tip 里的 \n 手动换行，同时允许长行自动折行 —— 这才是想要的。

   定位：right:0 + 固定宽度，让浮层从按钮右缘**向左**展开。
   · 用 left:0 会向右长出去 —— 按钮已贴近面板右缘（面板 302px，按钮右缘到面板右边只剩约 9px），
     实测右侧溢出 203px，被面板 overflow:hidden 直接裁掉。
   · 用 right:0 向左长，面板宽 302px、减掉左边距，200px 左右正好完整落在面板内。
   · 宽度不能设 max-content：那样长文案会一直往左顶出去。固定 208px 强制折行，
     面板左右各留出余量，任何一条文案都不会溢出（实测 6 条全部落框内）。 */
.fp-cloud::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);right:0;z-index:20;background:#12161c;color:#c7cfda;border:1px solid #3a4049;border-radius:6px;padding:6px 9px;font-size:11px;line-height:1.55;white-space:pre-line;width:208px;text-align:left;pointer-events:none;opacity:0;transition:opacity .12s;box-shadow:0 8px 24px rgba(0,0,0,.6);box-sizing:border-box}
.fp-cloud:hover::after,.fp-cloud:focus-visible::after{opacity:1}
.fp-select option:disabled{color:#5b6472}
.fp-foot{margin-top:12px;padding-top:9px;font-size:11px;color:#5c6674;text-align:center;letter-spacing:1px;border-top:1px solid #2e333d}
.fp-contact{display:none;margin-top:12px;margin-bottom:8px;font-size:11px;color:#4dd0e1;text-align:center;text-decoration:none;cursor:pointer}
.fp-contact:hover{text-decoration:underline}
.fp-update{display:none;align-items:center;gap:8px;margin-top:10px;padding:9px 11px;border-radius:6px;background:#1f2731;border:1px solid #3a4049;color:#a8b2bf;font-size:12px;line-height:1.5}
.fp-update a{color:#4dd0e1;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0}
.fp-update i{margin-left:auto;font-style:normal;cursor:pointer;color:#8b95a3;padding:0 4px;flex-shrink:0}
/* 「永久更新」是主推入口（装了才换得掉版本），做成实心按钮跟旁边的文字链拉开主次 */
.fp-update a.fp-primary{background:#0e7490;color:#fff;padding:3px 9px;border-radius:4px}
.fp-update a.fp-primary:hover{background:#0891b2}
.fp-update.ok{background:#16261c;border-color:#2f5d3c;color:#7ee2a8}
.fp-update.ok a{display:none}
.fp-update.busy{background:#1f2731;border-color:#3a4049;color:#8b95a3}
.fp-update.busy a,.fp-update.busy i{display:none}
.fp-update.err{background:#2b1a1a;border-color:#6b3030;color:#f0a0a0}
.fp-update.err a{display:none}

/* ===== 调整预览浮层 ===== */
.fp-prev{position:fixed;inset:0;z-index:9999996;background:rgba(12,14,17,.94);display:none;flex-direction:column;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.fp-prev.show{display:flex}
/* ⚠️ 这一条工具条的第一目标是「全屏下一行装下全部控件」（用户 v1.9.5 的明确诉求）。
   全屏 = 1920 宽，但笔记本外接/分屏常用 1280~1440，所以按「1280 也能一行」来收。
   原来 gap 14 / padding 10·16 / 输入框 56px，实测需求净宽 886px，**1440 起才勉强一行**，
   1280 及以下必然折成两行（工具条变高、预览区被挤）。
   收的地方都只动「间距与内边距」，字号一律没往下压 —— 压字号会让控件变矮但更难读，
   而且 chrome 里 12px 输入框已经是可读下限。
   实测（工具条实际高度判行数，一行 ≈ 52px）：改前 1440 起一行，改后 1200 起一行。
   ⚠️ 数字框后来从 46px 放宽回 58px（见下面 input[type=number] 的说明），
     同时把字体下拉从 104px 收到 92px 补回空间 —— 1200 仍然守得住。 */
.fp-prev-bar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:8px 12px;background:#181b21;border-bottom:1px solid #2e333d}
.fp-prev-brand{display:flex;align-items:center;gap:5px;font-size:13px;font-weight:700;color:#e6eaf0;white-space:nowrap}
.fp-prev-brand .fp-emoji{font-size:14px}
.fp-prev-ctl{display:flex;align-items:center;gap:4px}
.fp-prev-ctl label{font-size:11px;color:#8b95a3;white-space:nowrap}
/* ⚠️ 数字框宽度不能压太狠（用户 v1.9.5 反馈「字号行距题距等的框可以稍微再长一点，快把文字挡住了，
   旁边的上下调整按钮」）。实测：46px 时内容区只剩 32px，而「14.5」要占 23px ——
   余量 9px，Chrome 数字框右侧的上下微调箭头（约 15px）会把最后一位数字压掉一半。
   58px 把内容区提到 46px（余量 23px），「14.5」「1.65」这类最长值都能完整显示。
   padding 右侧刻意只留 4px —— 那 15px 的箭头是浏览器画在内容区右侧的，
   右内边距给多了反而挤掉数字，给少了又被箭头压，58px + 右 4px 是实测的平衡点。 */
.fp-prev-ctl input[type=number]{width:58px;padding:4px 4px 4px 6px;box-sizing:border-box;border:1px solid #3a4049;border-radius:6px;font-size:12px;color:#e6eaf0;background:#22262e;outline:none;font-family:inherit}
.fp-prev-ctl input[type=number]:focus,.fp-prev-ctl select:focus{border-color:#4dd0e1;box-shadow:0 0 0 3px rgba(77,208,225,.15)}
.fp-prev-ctl select{width:auto;padding:4px 20px 4px 7px;box-sizing:border-box;border:1px solid #3a4049;border-radius:6px;font-size:12px;color:#e6eaf0;background:#22262e;outline:none;font-family:inherit;appearance:none;background-image:linear-gradient(45deg,transparent 50%,#8b95a3 50%),linear-gradient(135deg,#8b95a3 50%,transparent 50%);background-position:calc(100% - 12px) 50%,calc(100% - 7px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.fp-prev-ctl input[type=checkbox]{width:14px;height:14px;accent-color:#648CFC;margin:0}
/* 字体下拉是整条工具条里最宽的一项（原 170px，字体名长短不一撑到 231px），
   封顶后长名走省略号 —— 反正用户能从下拉里展开看全名，工具条上不必给全。
   104→92px 是为了给加宽后的数字框腾出空间（4 个数字框多占 48px），
   92px 装得下「方正书宋_GBK」的省略形式，也刚好守住「1200 也能一行」。 */
.fp-prev-ctl .fp-fam-wrap{min-width:0}
.fp-prev-ctl .fp-fam-wrap select#fpv-fam{max-width:92px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}
/* 预览面板的工具条是深色 (#181b21)，云朵按钮得换成同色系，否则那块 #252a33 会显脏。
   只改配色，尺寸/图标/tooltip 行为全部沿用主样式 —— 别在这里复制一套逻辑。 */
.fp-prev-ctl .fp-cloud{width:22px;height:22px;background:#22262e;color:#8aa6fd;border-color:#3a4049}
.fp-prev-ctl .fp-cloud:hover{background:#2b323d;color:#a9bdff;border-color:#4a5361}
/* 置灰态必须在深色工具条里重新声明：上面那条 .fp-prev-ctl .fp-cloud 优先级更高，
   不覆盖的话「已装」按钮会在这里又变回可点的亮蓝色。 */
.fp-prev-ctl .fp-cloud.done,.fp-prev-ctl .fp-cloud.done:hover{background:#1b1e25;color:#4a5361;border-color:#2b3038}
.fp-prev-ctl .fp-cloud svg{width:13px;height:13px}
.fp-prev-sp{flex:1 1 auto}
/* 三个按钮统一等宽（用户 v1.9.5 反馈「打印这边的按钮可以短一点点的没关系 可以和右边的按钮保持一致的长度」）。
   原来「打印」会被 flex 拉伸到 587px、「导出PDF」「保存并返回」各 305px，三个宽度全不一样，很难看。
   ⚠️ 光给 min-width 不够 —— flex 容器里按钮默认 flex:0 1 auto，剩余空间仍会把它撑开
     （实测 1920 下「打印」=380px、另两个 80px，屏幕越宽差得越多）。
     所以必须同时 flex:0 0 auto 锁死，把弹性空间全部让给 .fp-prev-sp 这个纯占位那个空档吃。
   80px 刚好放得下最长的「保存并返回」（5 个 13px 汉字 ≈ 68px + 左右各 6px），三个因此完全等宽。
   padding 用 6px 而不是 7px：7px 时「保存并返回」自然宽 81px、超出 min-width 1px，
   整条工具条需求变成 1201px，恰好把 1200 那一档挤成两行；收到 6px 后三者都是 80px，1200 回到一行。 */
.fp-prev-bar .fp-btn{flex:0 0 auto;background:#2F7FE0;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;padding:7px 6px;min-width:80px;text-align:center;white-space:nowrap}
.fp-prev-bar .fp-btn:hover{background:#4f9af0}
.fp-prev-bar .fp-btn2{flex:0 0 auto;background:#252a33;color:#a8b2bf;border:1px solid #3a4049;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;padding:7px 6px;min-width:80px;text-align:center;white-space:nowrap}
.fp-prev-bar .fp-btn2:hover{background:#2f353f;color:#d7dce3}
.fp-prev-x{flex:0 0 auto;font-size:17px;color:#6b7583;cursor:pointer;padding:3px 7px;border-radius:6px;line-height:1}
.fp-prev-x:hover{color:#e6eaf0;background:#2b323d}
.fp-prev-frame{flex:1 1 auto;width:100%;border:0;background:#e5e7eb}

/* ===== 自选题目导出：勾选界面（沿用面板 / 预览那套深色视觉） ===== */
.fp-pickui{position:fixed;inset:0;z-index:9999997;background:rgba(12,14,17,.94);display:none;align-items:center;justify-content:center;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.fp-pickui.show{display:flex}
.fp-pick-box{display:flex;flex-direction:column;width:min(880px,94vw);max-height:88vh;background:#1b1e25;border:1px solid #2e333d;border-radius:12px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.55)}
.fp-pick-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#181b21;border-bottom:1px solid #2e333d;flex:0 0 auto}
.fp-pick-brand{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:700;color:#e6eaf0}
.fp-pick-brand .fp-emoji{font-size:15px}
.fp-pick-x{font-size:19px;color:#6b7583;cursor:pointer;padding:2px 8px;border-radius:6px;line-height:1}
.fp-pick-x:hover{color:#e6eaf0;background:#2b323d}
.fp-pick-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid #262b34;flex:0 0 auto}
.fp-batch{background:#252a33;color:#a8b2bf;border:1px solid #3a4049;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;padding:7px 12px;white-space:nowrap;transition:background .15s}
.fp-batch:hover{background:#2f353f;color:#d7dce3}
.fp-batch-orange{background:#f59e0b;color:#1a1d23;border:1px solid #f59e0b;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;padding:7px 12px;white-space:nowrap;transition:background .15s,border-color .15s}
.fp-batch-orange:hover{background:#ff8f1f;border-color:#ff8f1f;color:#1a1d23}
.fp-batch-orange:active{background:#e08b06;border-color:#e08b06}
.fp-pick-bar .fp-pick-range{width:230px;flex:0 0 auto}
.fp-pick-cnt{margin-left:auto;font-size:12px;color:#8b95a3;white-space:nowrap}
/* 板块快捷勾选行（批量按钮行下方） */
.fp-boards{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 16px;border-bottom:1px solid #262b34;flex:0 0 auto;background:#1d2129}
.fp-boards-tt{font-size:12px;font-weight:700;color:#8b95a3;flex:0 0 auto}
.fp-boards-hint{font-size:12px;color:#6b7583}
.fp-board{display:flex;align-items:center;gap:6px;background:#252a33;border:1px solid #3a4049;border-radius:6px;padding:5px 10px;cursor:pointer;transition:background .15s,border-color .15s}
.fp-board:hover{background:#2f353f;border-color:#4a525f}
.fp-board .fp-board-cb{width:14px;height:14px;accent-color:#648CFC;margin:0;flex:0 0 auto}
.fp-board-cb:indeterminate{opacity:.8}
.fp-board-nm{font-size:12px;font-weight:600;color:#d7dce3;white-space:nowrap}
.fp-board-rg{font-size:11px;color:#8aa6fd;white-space:nowrap}
.fp-pick-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 8px;scrollbar-width:thin;scrollbar-color:#333a45 transparent}
.fp-pick-list::-webkit-scrollbar{width:8px}
.fp-pick-list::-webkit-scrollbar-thumb{background:#333a45;border-radius:4px}
.fp-pick-list::-webkit-scrollbar-thumb:hover{background:#414a58}
.fp-pick-item{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:7px;cursor:pointer;color:#d7dce3}
.fp-pick-item:hover{background:#22262e}
.fp-pick-cb{width:15px;height:15px;accent-color:#648CFC;margin:3px 0 0;flex:0 0 auto}
.fp-pick-seq{flex:0 0 auto;min-width:28px;font-size:12px;font-weight:700;color:#8aa6fd;text-align:right;line-height:1.7}
.fp-pick-no{flex:0 0 auto;font-size:11px;color:#8b95a3;background:#22262e;border:1px solid #323845;border-radius:5px;padding:1px 6px;white-space:nowrap;line-height:1.5}
.fp-pick-txt{flex:1 1 auto;font-size:13px;line-height:1.55;color:#d7dce3;word-break:break-word}
.fp-pick-empty{padding:22px;text-align:center;font-size:13px;color:#8b95a3}
.fp-pick-foot{flex:0 0 auto;border-top:1px solid #2e333d;padding:10px 16px 12px;background:#181b21}
.fp-pick-opts{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:8px}
.fp-pick-hint{font-size:11px;color:#6b7583;line-height:1.6;margin-bottom:10px}
.fp-pick-hint b{color:#a8b2bf}
.fp-pick-btns{display:flex;align-items:center;gap:10px}
.fp-pick-btns .fp-btn,.fp-pick-btns .fp-btn2{padding:10px}
`;
        const el = document.createElement('style');
        el.id = 'fp-style';
        el.textContent = css;
        document.head.appendChild(el);
    }

    function buildPanel() {
        const mask = document.createElement('div');
        mask.id = 'fp-mask';
        mask.innerHTML = `<div id="fp-mask-box"><div class="fp-spin"></div><div id="fp-mask-title">正在排版…</div><div id="fp-mask-sub">题目较多时需要十几秒，请稍候</div></div>`;
        document.body.appendChild(mask);

        const panel = document.createElement('div');
        panel.className = 'fp-panel';
        panel.id = 'fp-panel';
        panel.innerHTML = `
<div class="fp-scroll">
<div class="fp-head" id="fp-drag">
    <div class="fp-brand"><span class="fp-emoji">✨</span><span class="fp-name">试卷排版打印</span></div>
    <div><span class="fp-mini" id="fp-toggle">设置 ▾</span><span class="fp-x" id="fp-close" title="关闭（刷新页面重现）">×</span></div>
</div>

<div class="fp-field">
    <label class="fp-label">试卷标题</label>
    <!-- 占位提示走 placeholder 而不是 value：value 一留空，生成时就会实时去页面读真实
         试卷名（见 opt.title 的取值）。早先把占位文字放在 value 里，用户手快在标题回填
         之前就点生成，卷子封面上会直接印出「正在读取当前试卷…」。 -->
    <input type="text" id="fp-title" placeholder="${TITLE_PLACEHOLDER}" class="fp-input">
</div>
<div class="fp-stat" id="fp-stat"></div>

<div class="fp-btns">
    <button id="fp-print" class="fp-btn">排版并打印</button>
    <button id="fp-save" class="fp-btn2" title="导出为 PDF：浏览器会弹出打印对话框，目标选「另存为 PDF」即可保存">导出为 PDF</button>
</div>

<div class="fp-btns" style="margin-bottom:12px">
    <button id="fp-pick" class="fp-btn2" title="先提取题目，再自己勾选要导出的题；没勾的题不会印进卷子，排版、分页、打印 / 导出 PDF 逻辑与原来完全一致">自选题目导出</button>
</div>

<div class="fp-field"><label class="fp-check"><input type="checkbox" id="fp-cover" checked> 打印封面页</label>
    <div class="fp-hint">默认勾选</div>
</div>
<div class="fp-field"><label class="fp-check"><input type="checkbox" id="fp-autoPrint"> 生成后自动唤起打印</label></div>

<div class="fp-adv" id="fp-adv">
    <button id="fp-preview" class="fp-preview-btn" title="先生成可滚动预览，在预览里实时调字号 / 行距 / 间距 / 页边距，满意后再打印或导出">文本调整预览</button>
    <div class="fp-field">
        <label class="fp-label">页边距</label>
        <select id="fp-margin" class="fp-select">
            <option value="25mm 20mm">宽松</option>
            <option value="15mm 15mm">标准</option>
            <option value="10mm 10mm">紧凑</option>
        </select>
    </div>
    <div class="fp-field fp-field-font">
        <label class="fp-label">正文字体</label>
        <div class="fp-fam-wrap">
            <select id="fp-fontFamily" class="fp-select"></select>
            <a class="fp-cloud" id="fp-fonthelp" rel="noopener"></a>
        </div>
        <div class="fp-fontbar" id="fp-fontbar"></div>
        <div class="fp-hint">未安装的会标注「（未安装）」但仍可选中，会按备选链自动回退到相近字体；点右边云朵可查安装方法</div>
    </div>
    <div class="fp-row">
        <div class="fp-field"><label class="fp-label">字号</label><input type="number" id="fp-fontSize" class="fp-input"></div>
        <div class="fp-field"><label class="fp-label">行距</label><input type="number" id="fp-lineHeight" step="0.05" class="fp-input"></div>
    </div>
    <div class="fp-field"><label class="fp-label">题目间距 (px)</label><input type="number" id="fp-qSpacing" class="fp-input"></div>
    <div class="fp-field">
        <label class="fp-label">换页方式</label>
        <select id="fp-pagination" class="fp-select">
            <option value="smart">智能平衡 · 题干按段、选项整行（推荐）</option>
            <option value="ultra">极致省纸 · 单个选项也能拆</option>
            <option value="whole">整题不拆 · 页尾留白最多</option>
        </select>
        <div class="fp-hint">三档决定「页尾放不下时最小能拆到多细」：智能平衡留白最少又不会把一行四个选项劈成 3+1；极致省纸填得最满；整题不拆最整洁但会空掉一截</div>
    </div>
    <div class="fp-field">
        <label class="fp-label">大图缩放 (%)</label>
        <input type="number" id="fp-figScale" class="fp-input">
        <div class="fp-hint">只对实际宽度超过 150px 的图生效，分数公式之类的小图不动</div>
    </div>
    <div class="fp-field">
        <label class="fp-label">申论作答区</label>
        <select id="fp-shenlunMode" class="fp-select">
            <option value="none">不留作答区（默认）</option>
            <option value="auto">按题目字数自动算</option>
            <option value="fixed">固定高度</option>
        </select>
        <div class="fp-hint">仅申论生效。</div>
    </div>
    <div class="fp-field" id="fp-shenlunFixed" style="display:none">
        <label class="fp-label">作答区高度 (cm)</label>
        <input type="number" id="fp-shenlunSpace" class="fp-input">
        <div class="fp-hint">一般小题填 6～10，大作文填 20～26</div>
    </div>
    <div class="fp-field"><label class="fp-check"><input type="checkbox" id="fp-header"> 打印页眉（每页顶部印试卷标题）</label>
    </div>
    <div class="fp-field"><label class="fp-check"><input type="checkbox" id="fp-qrcode"> 末页附对答案二维码</label>
        <div class="fp-hint">需联网生成；取不到会自动隐藏，不影响正文</div>
    </div>
    <div class="fp-field" id="fp-qrInline-wrap"><label class="fp-check"><input type="checkbox" id="fp-qrInline"> 二维码紧贴题目</label>
        <div class="fp-hint">勾选后二维码排在最后一题下面，中间空一行；末页放不下时才单独成页。不勾选则始终单独成页</div>
    </div>
    <div class="fp-field">
        <label class="fp-label">关闭页面倒计时 (秒)</label>
        <input type="number" id="fp-countdown" class="fp-input">
        <div class="fp-hint">打印对话框一关闭就开始倒数，到时自动关闭页面；期间点「留在页面」可取消，填 0 则不自动关闭</div>
    </div>
    <button id="fp-reset" class="fp-btn2" style="width:100%">恢复默认设置</button>
    <button id="fp-check" class="fp-btn2" style="width:100%;margin-top:8px">检查更新</button>
</div>

<div class="fp-update" id="fp-update"></div>
    <a class="fp-contact" id="fp-contact" href="https://www.xiaohongshu.com/user/profile/6864dfd9000000001d01781a" target="_blank" rel="noopener">联系作者</a>
<div class="fp-foot">v${VERSION}</div>
</div>`;
        document.body.appendChild(panel);
        return { panel, mask };
    }

    // 申论作答区选「固定高度」时才把高度输入框显示出来
    function syncShenlunUI() {
        const sel = $('fp-shenlunMode'), box = $('fp-shenlunFixed');
        if (sel && box) box.style.display = sel.value === 'fixed' ? 'block' : 'none';
    }

    function bindPanel(panel, mask, onPrint, onSave, onPreview) {
        // 折叠
        const adv = $('fp-adv'), toggle = $('fp-toggle');
        toggle.addEventListener('click', () => {
            const willOpen = adv.style.display !== 'block';
            adv.style.display = willOpen ? 'block' : 'none';
            toggle.textContent = willOpen ? '收起 ▴' : '设置 ▾';
            // 联系作者随「设置」展开/收起：展开时显示，收起时隐藏
            const c = $('fp-contact');
            if (c) c.style.display = willOpen ? 'block' : 'none';
        });
        $('fp-close').addEventListener('click', () => { panel.style.display = 'none'; });

        // 拖动 + 位置记忆
        try {
            const pos = JSON.parse(localStorage.getItem(STORE_POS) || 'null');
            if (pos && typeof pos.top === 'number') {
                panel.style.top = pos.top + 'px';
                panel.style.left = pos.left + 'px';
                panel.style.right = 'auto';
            }
        } catch (e) { /* 忽略 */ }

        let dragging = false, sx = 0, sy = 0, ot = 0, ol = 0;
        $('fp-drag').addEventListener('mousedown', (e) => {
            if (e.target.closest('.fp-mini') || e.target.closest('.fp-x')) return;
            const r = panel.getBoundingClientRect();
            ot = r.top; ol = r.left; sx = e.clientX; sy = e.clientY;
            panel.style.right = 'auto';
            panel.style.top = ot + 'px';
            panel.style.left = ol + 'px';
            dragging = true;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const h = panel.offsetHeight;
            panel.style.top = Math.max(0, Math.min(window.innerHeight - 50, ot + e.clientY - sy)) + 'px';
            panel.style.left = Math.max(0, Math.min(window.innerWidth - 60, ol + e.clientX - sx)) + 'px';
            void h;
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            const r = panel.getBoundingClientRect();
            try { localStorage.setItem(STORE_POS, JSON.stringify({ top: Math.round(r.top), left: Math.round(r.left) })); } catch (e) { /* 忽略 */ }
        });

        // 窗口被拉窄 / 拉矮时，把面板重新夹回可视区，避免被推出屏幕（拖拽能力保留）
        const clampPanel = () => {
            if (panel.style.display === 'none') return;
            const w = panel.offsetWidth, h = panel.offsetHeight;
            const r = panel.getBoundingClientRect();
            let left = r.left, top = r.top, changed = false;
            if (left + w > window.innerWidth - 4) { left = Math.max(4, window.innerWidth - w - 4); changed = true; }
            if (left < 4) { left = 4; changed = true; }
            if (top + h > window.innerHeight - 4) { top = Math.max(4, window.innerHeight - h - 4); changed = true; }
            if (top < 4) { top = 4; changed = true; }
            if (changed) {
                panel.style.right = 'auto';
                panel.style.left = left + 'px';
                panel.style.top = top + 'px';
            }
        };
        window.addEventListener('resize', clampPanel);

        // 设置变更即存
        panel.querySelectorAll('input, select').forEach((el) => {
            el.addEventListener('input', saveSettings);
            el.addEventListener('change', saveSettings);
        });
        const sm = $('fp-shenlunMode');
        if (sm) sm.addEventListener('change', syncShenlunUI);

        // 字体菜单：先同步填 option，再异步补装/未装状态
        fillFontOptions();
        const famSel = $('fp-fontFamily');
        if (famSel) famSel.addEventListener('change', () => renderFontBar(famSel.value, _fontAvail));
        probeFonts().then(renderFontStatus).catch(() => { /* 探测失败不影响其它功能 */ });

        // 云朵按钮：切换字体时 tooltip / href / 置灰态都得跟着换，
        // 否则用户选了微软雅黑还看到宋体的说明，甚至指到一个已装字体的安装页上。
        // 面板里的按钮全量绑定过 saveSettings，这里按需补刷新。
        //
        // ⚠️ 用 click 而不是 mousedown：<a target="_blank"> 的原生跳转发生在 click 阶段，
        //    在 mousedown 里改 href 有一半概率赶不上这次跳转（浏览器已经开始解析旧地址）。
        //    这里在冒泡阶段刷新，改的是「下一次」点击要用的值，语义上正好。
        const helpBtn = $('fp-fonthelp');
        if (helpBtn) helpBtn.addEventListener('click', () => {
            renderFontCloud(helpBtn, famSel ? famSel.value : DEFAULTS.fontFamily, _fontAvail);
        });

        $('fp-reset').addEventListener('click', () => {
            applySettings(DEFAULTS);
            syncShenlunUI();
            renderFontBar(DEFAULTS.fontFamily, _fontAvail);
            saveSettings();
        });
        $('fp-check').addEventListener('click', () => checkUpdate(true));

        $('fp-print').addEventListener('click', onPrint);
        $('fp-save').addEventListener('click', onSave);
        const pv = $('fp-preview');
        if (pv) pv.addEventListener('click', onPreview);

        // 自选题目导出：与「排版并打印 / 导出为 PDF / 文本调整预览」并列的第 4 个入口。
        // openPicker 是同作用域内的函数声明（会提升），因此不必改 bindPanel 的签名与调用处。
        const pk = $('fp-pick');
        if (pk) pk.addEventListener('click', openPicker);
    }

    /* ---------- 正文字体：菜单渲染与状态条 ---------- */

    // 字体下拉的选项 HTML —— 面板与预览面板共用同一份，两处的标注/状态必须永远一致。
    //
    // ⚠️ 未安装的项**不加 disabled、保持可选中**（用户明确要求，也是刻意设计）：
    //    没装不等于不能用 —— 选中后会走 chain 备选链自动回退到最相近的可用字体。
    //    所以这里只做「事实标注」：文案加「（未安装）」，不阻止选择。
    //    若设成 disabled，用户就再也用不了回退能力，等于砍掉一个功能。
    // avail 为 null（探测未完成 / 环境不支持）时不加任何标注，保持中性。
    function fontOptionsHtml(avail) {
        return FONTS.map((f) => {
            const a = avail ? avail[f.key] : null;
            const sfx = (a && a.confirmed === false) ? '（未安装）' : '';
            return `<option value="${f.key}">${esc(f.label)}${sfx}</option>`;
        }).join('');
    }

    // 状态条文案。把「命中来源」也说出来是有意的：
    // 中文名命中（sour==='cjk'）时检测结论偏弱，如果还理直气壮写「本机已安装」，
    // 用户真机打印出来发现不对，就会认为整个检测是假的 —— 宁可先说明白。
    function fontBarInfo(key, avail) {
        const f = FONT_BY_KEY[key] || FONTS[0];
        const a = avail ? avail[key] : null;
        const c = a ? a.confirmed : null;
        if (c === true) {
            if (a.sour === 'cjk') {
                return { cls: '', icon: '⚠', txt: '检测到「' + f.label + '」但仅由中文名命中，结论可能不准，请以实际打印效果为准' };
            }
            return { cls: 'ok', icon: '✓', txt: '本机已安装' };
        }
        if (c === false) return { cls: 'no', icon: '⚠', txt: '本机未安装，将回退到相近字体' };
        return { cls: '', icon: '·', txt: '无法检测，将按备选链回退' };
    }

    // 云朵小按钮：面板与预览面板共用同一份渲染逻辑（含 tooltip 文案与黄点），
    // 保证两处行为永远一致 —— 跟 fontOptionsHtml 同样的理由。
    //
    // ⚠️ 这个元素必须是 <a> 而不是 <button>（v1.9.2 的 bug，用户实测「点了没反应」）：
    //    原先把 href/target 用 setAttribute 写在 <button> 上 —— 那两个属性只对 <a> 有意义，
    //    写在 button 上就是两个没人理的自定义属性，浏览器不会做任何跳转。
    //    tooltip 因为走 data-tip 照样能显示，所以表面看「一切正常」，唯独点击是死的。
    //    保持原生 <a> 语义还有个附带好处：不会被当成 window.open 那样拦弹窗。
    //
    // ── tooltip 文案：统一「两行式」（用户选定的 A 版）────────────────────────────
    // 第一行只说状态（装没装 / 该装哪个字重），第二行只给出路（去哪儿、别踩什么坑）。
    // 原先的第一人称「「宋体」本机未安装」里，字体名由 f.label 拼进去 —— 但那其实是废话：
    // 用户是**从这一款字体的下拉项旁边**点的云朵，本来就知道自己点的是哪一款，
    // 再念一遍字体名除了占一行宽度没有任何信息量。改为省略字体名，把省下的宽度留给第二行。
    // 文案总长刻意压在 208px 浮层内能完整显示的范围（长短两种文案都实测落在框内）。
    //
    // 三种状态，由 confirmed 决定（与 sour 无关，两者别耦合）：
    //    true  → 已装：置灰不可点（用户明确要求），tooltip 一行说清「直接用即可」
    //    false → 未装：可点，黄点，跳安装引导
    //    null  → 测不出：可点，黄点，跳安装引导（不装作知道）
    function renderFontCloud(btn, key, avail) {
        if (!btn) return;
        const f = FONT_BY_KEY[key] || FONTS[0];
        const a = avail ? avail[key] : null;
        const c = a ? a.confirmed : null;
        const h = FONT_HELP[f.key];
        // 思源黑体是唯一一款「装了但装错字重会很难看」的字体：官方仓库里 Light/Regular/Medium/
        // Bold 全都有，用户随手点第一个下很可能就是 Regular 或 Bold，跟公文排版要的 Medium 差很远。
        // 所以在「未装」和「测不出」两态都额外顶一句字重要求 —— 这是这一款字体的专属提示，
        // 别的字体没有字重歧义，不跟着加。
        const weightHint = f.key === 'sourcehan' ? ' · 请装 Medium 字重' : '';

        // 已装 → 置灰不可点。href 必须显式删掉：<a> 没有 href 时不响应点击也不进 Tab 焦点链，
        // 光靠 pointer-events:none 只挡鼠标、键盘回车照样能触发，那样等于没禁用。
        if (c === true) {
            btn.className = 'fp-cloud done';
            btn.removeAttribute('href');
            btn.removeAttribute('target');
            btn.removeAttribute('rel');
            btn.setAttribute('aria-disabled', 'true');
            btn.setAttribute('aria-label', '「' + f.label + '」已安装，无需操作');
            btn.setAttribute('data-tip', '已安装，直接用即可');
            btn.innerHTML = FONT_CLOUD_ICON + '<span class="fp-dot"></span>';
            return;
        }

        // 未装 / 测不出 → 可点
        btn.className = 'fp-cloud warn';
        btn.setAttribute('href', FONT_HELP_URL(f.key, f.label));
        btn.setAttribute('target', '_blank');
        btn.setAttribute('rel', 'noopener');
        btn.removeAttribute('aria-disabled');
        btn.setAttribute('aria-label', '查看「' + f.label + '」的安装方法');
        btn.setAttribute('data-tip', (c === false ? '本机未安装' : '检测不出是否已装') + weightHint + '\n'
            + (h ? h.why : '不装也能用，会自动回退到相近字体'));
        btn.innerHTML = FONT_CLOUD_ICON + '<span class="fp-dot"></span>';
    }

    function fontBarHtml(key, avail) {
        const i = fontBarInfo(key, avail);
        return `<span class="${i.cls}">${i.icon} ${esc(i.txt)}</span>`;
    }

    // 同步先填一遍 option（不带状态），保证异步探测完成前 select 就有值，
    // 避免用户此时点「生成」拿到空字体。云朵按钮此刻也先按「未探测」渲染。
    function fillFontOptions() {
        const sel = $('fp-fontFamily');
        if (!sel) return;
        sel.innerHTML = fontOptionsHtml(null);
        // 当前值取自已保存设置（外层没有模块级 state，只有 buildPreviewHtml 等的形参）
        const cur = readSettings().fontFamily;
        sel.value = FONT_BY_KEY[cur] ? cur : DEFAULTS.fontFamily;
        renderFontCloud($('fp-fonthelp'), sel.value, null);
    }

    // 探测结果到达后：刷新标注态 + 状态条 + 云朵按钮。
    // 只在这里重建一次 option（重建会丢用户当前展开态，且可能触发多余 change）。
    async function renderFontStatus() {
        const sel = $('fp-fontFamily');
        if (!sel) return;
        const avail = await probeFonts();
        const cur = sel.value || DEFAULTS.fontFamily;
        sel.innerHTML = fontOptionsHtml(avail);
        sel.value = FONT_BY_KEY[cur] ? cur : DEFAULTS.fontFamily;
        renderFontBar(sel.value, avail);
    }

    // 状态条 + 云朵按钮。安装引导走按钮，不再往状态条里塞文字链
    // —— 状态条只负责「说清楚现在什么情况」，动作交给按钮，各司其职。
    function renderFontBar(key, avail) {
        const bar = $('fp-fontbar');
        if (bar) {
            const cls = fontBarInfo(key, avail).cls;
            bar.className = 'fp-fontbar' + (cls ? ' ' + cls : '');
            bar.innerHTML = fontBarHtml(key, avail);
        }
        renderFontCloud($('fp-fonthelp'), key, avail);
    }

    // 任何 null/undefined 都归零为空串——否则 element.innerHTML = null 会被浏览器
    // 渲染成字面量「null」，这正是面板偶发显示「null」的根因之一。
    function setStatus(html) { const el = $('fp-stat'); if (el) el.innerHTML = (html == null ? '' : html); }
    function showMask(title, sub) {
        if (title) $('fp-mask-title').textContent = title;
        if (sub) $('fp-mask-sub').textContent = sub;
        $('fp-mask').style.display = 'flex';
    }
    function hideMask() { $('fp-mask').style.display = 'none'; }

    /* ---------- 检查更新（GitHub API 真源，无 CDN 滞后） ---------- */

    // base64 解码（兼容中文/Unicode）：GitHub API 返回的是 base64 编码的 UTF-8 文本
    function decodeBase64(b64) {
        try { return decodeURIComponent(escape(atob(b64))); }
        catch (e) { return atob(b64); }
    }

    // 解析最新脚本：主源 GitHub API（真实最新、无滞后），失败回退 jsDelivr @main 兜底。
    // 返回 { txt }：txt 为完整脚本源码，可直接就地重注入。
    function resolveLatest() {
        const t = Date.now();
        return fetch(GH_API, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function (d) {
                if (!d || !d.content) return Promise.reject(new Error('empty'));
                const txt = decodeBase64(d.content.replace(/[\s\r\n]/g, ''));
                if (!extractVersion(txt)) return Promise.reject(new Error('no-version'));
                return { txt: txt };
            })
            .catch(function (e) {
                return fetch(UPDATE_FB_URL + '?t=' + t, { cache: 'no-store' })
                    .then(function (r) { return r.ok ? r.text() : Promise.reject(e); })
                    .then(function (txt) {
                        if (!extractVersion(txt)) return Promise.reject(e);
                        return { txt: txt };
                    });
            });
    }

    // 检查更新：直接拉 GitHub API 取真实最新版（无 CDN 滞后）与本地比对。
    // manual=true：手动点「检查更新」，无论结果都给反馈；false：仅发现新版本才提示。
    function checkUpdate(manual) {
        const box = $('fp-update');
        if (manual && box) renderUpdate('正在检查更新…', 'busy');
        resolveLatest()
            .then(function (res) {
                const rv = extractVersion(res.txt);
                if (!rv) {
                    if (manual) renderUpdate('未能读取远程版本号，请稍后重试 <i id="fp-update-x">×</i>', 'err');
                    else if (box) box.style.display = 'none';
                } else if (cmpVer(rv, VERSION) > 0) {
                    // 两个入口并列：主推「永久更新」（装进油猴、刷新不掉），
                    // 次要「仅预览」（立刻看效果、但刷新就回旧版）。
                    renderUpdate('<span>发现新版本 <b>v' + esc(rv) + '</b>（当前 v' + esc(VERSION) + '）</span>' +
                        '<a id="fp-update-go" class="fp-primary" href="javascript:void(0)">永久更新</a>' +
                        '<a id="fp-update-now" href="javascript:void(0)">仅预览</a>' +
                        '<i id="fp-update-x" title="忽略">×</i>', '');
                    const go = $('fp-update-go');
                    if (go) go.addEventListener('click', function () { installUpdate(rv); });
                    const now = $('fp-update-now');
                    if (now) now.addEventListener('click', function () { previewUpdate(); });
                } else if (manual) {
                    renderUpdate('已是最新 <b>v' + esc(VERSION) + '</b> ✓ <i id="fp-update-x">×</i>', 'ok');
                } else if (box) {
                    box.style.display = 'none';
                }
                const x = $('fp-update-x');
                if (x) x.addEventListener('click', function () { box.style.display = 'none'; });
            })
            .catch(function () {
                if (manual) renderUpdate('检查失败：网络或跨域受限，请稍后重试 <i id="fp-update-x">×</i>', 'err');
                else if (box) box.style.display = 'none';
                const x = $('fp-update-x');
                if (x) x.addEventListener('click', function () { box.style.display = 'none'; });
            });
    }

    // 「仅预览」：拉取最新脚本并就地重注入。设置仍从 localStorage 读取。
    // 重注入逻辑同 1.8.1（删除固定 5 个 UI 节点后注入新版），经长期验证稳定。
    // ⚠️ 只活在这一页：刷新后油猴会重新注入它自己存的那份，回到旧版。
    function previewUpdate() {
        const box = $('fp-update');
        if (box) renderUpdate('正在从 GitHub 拉取最新版…', 'busy');
        resolveLatest()
            .then(function (res) {
                ['fp-panel', 'fp-mask', 'fp-done', 'fp-loading', 'fp-style'].forEach(function (id) {
                    const el = document.getElementById(id);
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                });
                const sc = document.createElement('script');
                sc.textContent = res.txt;
                document.head.appendChild(sc);
            })
            .catch(function () {
                if (box) renderUpdate('预览失败：网络或跨域受限 <i id="fp-update-x">×</i>', 'err');
                const x = $('fp-update-x');
                if (x) x.addEventListener('click', function () { box.style.display = 'none'; });
            });
    }

    // 「永久更新」：导航到 @downloadURL，由油猴弹窗完成真正的覆盖安装。
    //
    // 为什么必须是「导航」而不是脚本自己下载：网页脚本调不出油猴的安装窗。
    // 油猴只在【浏览器导航到一个 .user.js 地址】时才弹「安装 / 更新」。
    // 这是扩展刻意的安全设计（否则任何脚本都能静默自我替换）。
    //
    // 换成新版的意义：油猴会把新代码写进自己的存储，此后刷新 / 重启都是新版；
    // 而 previewUpdate() 那种注入是够不到油猴存储的，刷新必回旧版。
    //
    // 零特权：就是一句 location.href（@grant none 下照跑）。
    // 先给一段提示再跳，免得用户看到页面突然跳走而懵。
    function installUpdate(remoteVer) {
        const box = $('fp-update');
        if (box) {
            renderUpdate('正在打开安装页…<br>' +
                '<span style="color:#8b95a3">油猴会弹出<b>「安装 / 更新」</b>窗口，点一下即可永久更新到 v' +
                esc(remoteVer || '') + '。<br>装完刷新页面，版本就一直在了。</span>', 'busy');
        }
        // 留一点时间让上面那行提示先画出来，否则用户看不到任何反馈就跳走了
        setTimeout(function () { location.href = INSTALL_URL; }, 600);
    }

    /* ==================================================================
     * 五、提取层：页面 DOM → 结构化数据
     *
     *   统一产出 items 数组，元素形如：
     *     { kind:'chapter',  name, desc }
     *     { kind:'material', html, index }
     *     { kind:'question', num, stemHtml, options:[{letter, html}], figure, key }
     * ================================================================ */

    // 清掉页面上纯交互用的控件，避免被一起印出来
    const JUNK_SELECTOR = [
        '.tooltip-container', '.label-tab', '.material-tabs', '.material-tab',
        '.tabs', '.tabs-content', '.tab-list', '.material-nav',
        '.material-select', '.select-material', '.analysis', '.answer-wrap'
    ].join(',');

    function cleanClone(node) {
        const c = node.cloneNode(true);
        c.querySelectorAll(JUNK_SELECTOR).forEach((e) => e.remove());
        // 去掉「请选择材料」这类导航串（形如：材料一 材料二 材料三…）
        c.querySelectorAll('*').forEach((n) => {
            const t = text(n);
            if (t && /材料\s*[一二三四五六七八九十\d]+[\s\S]*材料\s*[一二三四五六七八九十\d]+/.test(t)) n.remove();
            if (n.children.length === 0 && /^请选择材料$|^选择材料$/.test(t)) n.remove();
        });
        return c;
    }

    // 给「行内公式图」（flag="tex"）锁定尺寸与对齐。
    //
    // 关键认知：公式图形态差异极大，**不能用同一条规则定尺寸**。按宽高比（粉笔内联 aspect-ratio，
    // 永远存在；data-fp-ar 兜底）分三档，实测数据（字号 18px，单位「字」）：
    //   ① 瘦高（高 ≥ 宽×1.4，如分数 20/43）：分子分母上下排布，视觉尺寸取决于**宽度**。
    //      按高度锁 1.15em 时宽度只剩 0.6 字 → 明显偏小；改按**宽度 1em**，高约 2.15 字，上下撑开，
    //      与文字观感一致。（旧版从 1.8.10 起一直按高度锁，故分数始终显得小。）
    //   ② 常规符号（宽高接近，如摄氏度 / 单字母 / 上下标，约 40/30）：视觉尺寸取决于**高度**。
    //      按高度 1.15em 最稳；若按宽度会变成 0.75 字高，偏小。
    //   ③ 长公式（宽 ≫ 高，如 200/30）：必须按**高度**锁，宽度自然撑开（实测 7.66 字）。
    //      若按宽度锁 1em，高度会塌成 0.15 字 —— 扁成一条线，完全看不清。
    // 因此：只有「瘦高」才按宽度，其余一律按高度。这样三类图各自都合适，互不影响。
    //
    // 另：尺寸一律用「内联 !important」写死 —— 脚本后写的内联 !important 天然压过粉笔的内联
    // !important 与任何样式表，不再依赖「清掉内联 + 类选择器优先级」这条脆弱链路。
    // ⚠️ 作用域警告：`applyTexSize` 定义在【生成页自己】的 <script> 里（那是另一个文档、
    //    另一个作用域），**外层这份脚本调不到它** —— v1.8.17 初版就是栽在这里，
    //    真机上直接抛 `applyTexSize is not defined`，整个生成流程中断、试卷出不来。
    //    所以下面这份逻辑必须在外层【另存一份】。改判定时**两处都要改**，
    //    行尾都标了「同步点」，可用编辑器搜索该词逐个核对。
    //
    // ============================ 尺寸模型（1.8.19 重写） ============================
    // 前面几版一直用一个「宽高比阈值」把公式图分成「分数档 / 符号档」，再各给一套尺寸。
    // 那个模型是错的 —— 它解释不了真机的现象，而且越调越乱：
    //   20/43(3/2) 判成分数、29/43(15/2) 判成符号、37/43(-2/3) 又判成符号，
    //   于是一道题里三个分数三个大小。用户的原话是「分子分母只有一位数且没有负号的就正常」，
    //   完全对上 —— 因为能落到 20/43 的恰好只有这种情况。
    //
    // 粉笔原生是怎么做的？把它的公式图逐张下载下来量，答案很干净：
    //   图片 URL 里写死 fontSize=18，所以**图片内部就是用 18px 字号渲染出来的**。
    //   粉笔的 CSS 只做一件事：**按原始像素 1:1 显示，不做任何缩放**。
    //   因为“图片内部字号”与“正文字号”本来就是同一个数，天然一样大 —— 不需要任何缩放逻辑。
    // 实测佐证（22 张真机图，字号 18）：
    //   外框高 43 的 18 张（3/2、15/2、-2/3…）内部墨迹高 36~37 —— 两行构成，是分数；
    //   外框高 20~23 的 4 张（30°、△AOD…）内部墨迹高 14 —— 单行构成，是整式/符号。
    //   而正文 18px 汉字的墨迹高也正好约 14：**整式的墨迹与正文同高**，这就是“一样大”的由来。
    //   注意分数外框 43 与整式外框 20 差了两倍多，但它们视觉上一样大 ——
    //   因为分数那 43px 里装的是**两行**，每行还是 18px 字号。**外框高根本不是判断依据**。
    //
    // 所以正确的做法只有一条：**等比缩放，让“图片内部字号”等于“当前正文字号”**。
    //   图片是按 fontSize=18 渲染的 → 缩放比 = 正文字号px / 18 → 显示尺寸 = 原始像素 × 该比值。
    //   这样无论正文用 15px 还是 25px，公式内部的字始终和旁边的正文一样大，
    //   分数、整式、长公式、多位数分数全部自动正确 —— 不再需要任何“分档”“阈值”“特判”。
    //   粉笔的原生 CSS 之所以不用缩放，只是因为它正文字号恰好也是 18。
    // 基线对齐同理：图片底边那个像素行就是基线所在（粉笔导出的图统一留了 3px 下边距），
    //   所以 `vertical-align: baseline` 就够了，同样不需要按比例算下沉量。
    // ================================================================================
    var TEX_BASE_PX = 18;    // 公式图 URL 里 fontSize 的固定值，是等比缩放的基准 —— 同步点
    // ============================ 对齐规则（1.8.23 修正）============================
    // 需求：**图片的中线与文字的中线落在同一条水平线上**（分数上下各露出一半）。
    //
    // 1.8.22 的公式本身是对的，但它**一次都没跑起来**。真机 DOM 佐证：脚本写下的
    //   vertical-align 全是 -0.17em，正是当时的兜底常量 —— 说明正常路径全部落空。
    //
    // 根因（已用无头 Chromium 复现）：tagTexFracImg 由 markTexFrac() 在**游离的 div** 上调用
    //   （d = document.createElement('div'); d.innerHTML = html;），
    //   此时 <img> 还没进文档、没有开始加载：
    //       游离节点 nw=0 complete=false ／ 插入文档同步读 nw=0 ／ 500ms 后 nw=20
    //   而 1.8.22 第一行就是 `if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return;`
    //   → 直接返回，尺寸与对齐一个都没写。
    //
    // 1.8.23 修法：**把「量不到」变成「量得到」**，公式不动。
    //   关键认知：算 va **根本不需要图片像素** ——
    //     va = 文字视觉中线/字号 − 图高(em)/2
    //   推导：设 va = V（em），图高 = H（em），则图中线在基线上方 (V + H/2)·fs。
    //         令其等于文字视觉中线 charMid，解出 V = charMid/fs − H/2。
    //   其中 charMid 由 canvas 画「国」字量得、H 由**属性**（data-fp-tex-ar 等）解析，
    //   两者都不依赖图片解码 → 游离节点里同样算得准。
    //   （1.8.22 的旧式 va = charMid/fs − H + inkMidEm 要求读图墨迹中线，
    //     才被迫等到解码；而那个等，就是它彻底失效的原因。两者数学等价，
    //     都是「让图中线落在文字中线上」，新式只是把依赖砍掉了。）
    //
    //   逐图算 va，不写死：3/2（20×43）与 15/2（29×43）比例不同、图高不同
    //   → va 必须不同（18px 下分别约 -0.685em 与 -0.351em），写死一个值必然有一类错位。
    //
    //   文字视觉中线怎么来：**运行时用 canvas 实画一个「国」字量出来**，不写常数。
    //     实测「文字墨迹中线 / 字号」比值在 0.375~0.425 之间浮动（±6%），
    //     因为汉字墨迹底边距基线的距离随字号在 1~3px 间非整数变化，写死一个 em 常数
    //     必然在某个字号区间失准（实测写死 -0.80em 时 22px 起偏差涨到 +0.8~+1.5px）。
    //     用 canvas 实测则任何字号、任何字体都准 —— 实测 16~40px 九个字号，偏差 ≤ 0.02px。
    //
    //   ⚠️ 别再退回「按底留白贴基线」（1.8.20 的做法）：那会把分数压到基线上，
    //      正是用户报的「分数比文字低一大截」。尺寸与对齐这两件事必须分开看。
    //
    //   顺序提示：设置图片尺寸会触发回流。批量处理时先把尺寸都钉死、再统一量基线，
    //     中途混着来会让先量的基线失效（实测偏差涨到 ±18px）。
    var TEX_REF_CHAR = '国';   // 度量参考字：全包围结构，墨迹范围最贴近汉字的视觉中心 —— 同步点
    var TEX_CHAR_MID_REF = 0.39;  // canvas 量不到时的兜底「文字视觉中线÷字号」—— 同步点
    // ↑ 兜底用的「文字视觉中线 ÷ 字号」。只在 canvas 量不到时用（如画布不可用）。
    //   实测该比值在 0.375~0.425 之间浮动，0.39 是中间值；正常运行走 canvas 实测，不读它。
    var texInkCache = Object.create(null);   // 图片墨迹缓存：同一张图不重复画 canvas
    var texCharMidCache = Object.create(null);  // 文字视觉中线缓存：按 字号+字体 缓存

    // 量出图片的「墨迹包围盒」——给出上下留白、墨迹高、以及**墨迹中线距图顶**。
    // 必须真读像素：粉笔导出的图没有统一的留白约定（实测 3~6px 不等），
    // 靠高度、宽高比、或者经验常数都推不出来。
    function measureTex(img) {
        var key = img.src;
        if (key in texInkCache) return texInkCache[key];
        var res = null;
        try {
            var w = img.naturalWidth, h = img.naturalHeight;
            var cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            var ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);   // 显式给目标宽高，按自然尺寸 1:1 采样
            var data = ctx.getImageData(0, 0, w, h).data;
            var top = -1, bottom = -1;
            for (var y = 0; y < h; y++) {
                var has = false;
                for (var x = 0; x < w; x++) {
                    if (data[(y * w + x) * 4 + 3] > 24) { has = true; break; }
                }
                if (has) { if (top < 0) top = y; bottom = y; }
            }
            // 全透明图（坏图）不动它，免得算出荒唐的下沉量
            if (bottom >= 0) {
                res = {
                    padBottom: h - 1 - bottom,
                    inkH: bottom - top + 1,
                    inkMid: (top + bottom + 1) / 2   // 墨迹中线距**图顶**的距离（原始像素）
                };
            }
        } catch (e) {
            // canvas 被跨域污染等情况：读不到就退回兜底值，不影响尺寸缩放
            res = null;
        }
        texInkCache[key] = res;
        return res;
    }

    // 量「文字视觉中线」在基线上方多少 px（当前字号、当前字体下）。
    // 做法：造一张 canvas，把一个「国」字按当前字号画上去，逐像素找出墨迹的上下边界，
    //       再减去基线位置 —— 汉字墨迹是上下不对称的（实测「某」上 16px、下 1px），
    //       所以视觉中线在基线上方约 0.4 个字号高，而不是行盒中心。
    function measureCharMid(fontSize, fontFamily) {
        var key = fontSize + '|' + fontFamily;
        if (key in texCharMidCache) return texCharMidCache[key];
        var res = null;
        try {
            var S = Math.ceil(fontSize * 4);          // 画布留足余量：4 倍字号
            var baseY = Math.ceil(fontSize * 2);      // 基线放在画布纵向中间偏下
            var cv = document.createElement('canvas');
            cv.width = S; cv.height = S;
            var ctx = cv.getContext('2d');
            ctx.font = fontSize + 'px ' + fontFamily;
            ctx.fillStyle = '#000';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(TEX_REF_CHAR, fontSize, baseY);
            var data = ctx.getImageData(0, 0, S, S).data;
            var top = -1, bottom = -1;
            for (var y = 0; y < S; y++) {
                var has = false;
                for (var x = 0; x < S; x++) {
                    if (data[(y * S + x) * 4 + 3] > 24) { has = true; break; }
                }
                if (has) { if (top < 0) top = y; bottom = y; }
            }
            if (bottom >= 0) {
                // 基线上方为正：墨迹顶距基线 baseY-top，墨迹底在基线下 bottom-baseY
                res = ((baseY - top) - (bottom - baseY)) / 2;
            }
        } catch (e) { res = null; }
        texCharMidCache[key] = res;
        return res;
    }

    // 按当前字号与字体，算出应写入的 vertical-align（em 字符串）。
    //
    // 两档精度（这点是 1.8.23 的关键，实测数据支撑见下）：
    //
    //   ① 图已解码（能读到墨迹）→ 用**墨迹中线**，精确：
    //        va = charMid/fs − 图高(em) + (墨迹中线距图顶 / 18)
    //   ② 图未解码（游离节点，读不到像素）→ 用**图高的一半**近似：
    //        va = charMid/fs − 图高(em)/2
    //
    //   为什么不能只用 ②：**墨迹中线并不在图的正中**。实测五张真机图，墨迹中线距图顶
    //   与「图高/2」的差：3/2 与 15/2 是 −0.5px、−2/3 与 30° 是 0、**△AOD 是 −1.5px**。
    //   直接用图高的中点，△AOD 就会低 1.5px（实测偏差 +1.53px，肉眼可见）。
    //
    //   为什么不能只用 ①：它在图片解码前算不出来，而 tagTexFracImg 恰恰跑在
    //   **游离的 div** 上（图还没开始加载）—— 1.8.22 就死在这里，一次都没生效。
    //
    //   两档配合：游离阶段先用 ② 保证「有值可用」（误差 ≤1.5px），
    //   生成页 scaleFigures 在图片解码后调 applyTexSize 用 ① 精修（偏差 ≤0.02px）。
    function texAlignEm(img, imgHEm, ink) {
        var fs = parseFloat(getComputedStyle(img).fontSize);
        if (!(fs > 0)) return null;
        var fam = getComputedStyle(img).fontFamily || 'serif';
        var charMid = measureCharMid(fs, fam);
        if (charMid === null) return null;
        var k = 1 / TEX_BASE_PX;
        // 墨迹中线距图顶（em）。读不到就用图高的中点近似。
        var inkMidEm = ink ? (ink.inkMid * k) : (imgHEm / 2);
        var v = (charMid / fs) - imgHEm + inkMidEm;
        if (!isFinite(v)) return null;
        return v.toFixed(4) + 'em';
    }

    // 解析公式图的原始宽高（px）。三个来源按可信度依次尝试 ——
    // 真机上它们会互相缺失、还会被写成 auto，必须逐项校验（1.8.16 的教训）：
    //   ① data-fp-tex-ar 属性  —— 脚本自己回写的，最可信
    //   ② data-fp-ar 属性      —— 粉笔原始标记（图片加载完成后才异步补上，常常没有）
    //   ③ 内联 aspect-ratio    —— 只有不是 "auto" 时才有效
    //   ④ naturalWidth/Height  —— 图已解码时的实际像素，最后的兜底（游离节点里为 0）
    function texNatSize(img) {
        var cands = [
            img.getAttribute('data-fp-tex-ar'),
            img.getAttribute('data-fp-ar'),
            img.style.aspectRatio,
            (img.naturalWidth > 0 && img.naturalHeight > 0)
                ? (img.naturalWidth + '/' + img.naturalHeight) : ''
        ];
        for (var i = 0; i < cands.length; i++) {
            var mm = String(cands[i] || '').match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
            if (mm) {
                var w = parseFloat(mm[1]), h = parseFloat(mm[2]);
                if (w > 0 && h > 0) return { w: w, h: h };
            }
        }
        return null;
    }

    function tagTexFracImg(img) {
        // ⚠️ 这个函数**不能在读不到 naturalWidth 时提前返回**。
        //    它由 markTexFrac() 在**游离的 div** 上调用（d.innerHTML = html），
        //    此时 <img> 还没插入文档、尚未开始加载，naturalWidth 必然是 0。
        //    1.8.22 第一行就是 `if (!(naturalWidth > 0)) return;`，
        //    于是在真机上**一次都没生效**，尺寸与对齐全部落空 —— 实测复现：
        //      游离节点 nw=0 complete=false ／ 插入文档同步读 nw=0 ／ 500ms 后 nw=20
        //    正确做法：宽高比优先从属性解析（不依赖解码），尺寸照写；
        //    只有「量墨迹」这一步才需要解码，量不到就退回按图高算 va。
        const size = texNatSize(img);
        if (!size) return;   // 四个来源全落空：不猜，留给生成页 scaleFigures 解码后补
        // —— 同步点：与生成页 applyTexSize 等价的等比缩放 ——
        const U = 'important';
        const k = 1 / TEX_BASE_PX;          // 每 1px 原始像素对应 k 个「字号单位」
        const wEm = size.w * k, hEm = size.h * k;
        img.style.setProperty('aspect-ratio', 'auto', U);
        img.style.setProperty('max-width', 'none', U);
        img.style.setProperty('max-height', 'none', U);
        img.style.setProperty('object-fit', 'contain', U);
        // 用 em 表达：em 就是当前字号，正文一变大图片自动跟着等比放大
        img.style.setProperty('width', wEm.toFixed(4) + 'em', U);
        img.style.setProperty('height', hEm.toFixed(4) + 'em', U);
        // ---- 摆正：让图的中线落在文字视觉中线上 ----
        // 图片通常还没解码（游离节点），此时 measureTex 返回 null，
        // texAlignEm 会自动退回「按图高中点」的近似值 —— 有值总比没值强，
        // 且生成页 scaleFigures 会在解码后用墨迹中线精修一次。
        const ink = measureTex(img);
        const v = texAlignEm(img, hEm, ink);
        if (v !== null) {
            img.style.setProperty('vertical-align', v, U);
        } else {
            // 连文字中线都量不到（canvas 不可用）：用实测参考值 0.39em 兜底。
            // 注意**绝不能**再用「按底留白贴基线」那套 —— 那是 1.8.20 的做法，
            // 会把分数压到基线上，正是用户报的「分数比文字低一大截」。
            img.style.setProperty('vertical-align', (TEX_CHAR_MID_REF - hEm / 2).toFixed(4) + 'em', U);
        }
        // 保留这个类只为兼容旧样式表，尺寸不再依赖它
        img.classList.remove('fp-tex-frac');
        // —— 同步点结束 ——
    }
    function markTexFrac(html) {
        const d = document.createElement('div');
        d.innerHTML = html;
        d.querySelectorAll('img[flag="tex"]').forEach(tagTexFracImg);
        return d.innerHTML;
    }

    // 题干：抓 app-format-html，取不到再退到 article.content
    //
    // ⚠️ 1.11.2 修复「申论解析页题干变成参考答案」：
    //   解析页（app-view-paper）的题目结构是 article.content（题干）+ app-result-common（答案区），
    //   而【答案区里也有 app-format-html】—— 装的是参考答案正文和试卷标题。
    //   旧写法 ti.querySelector('app-format-html') 按文档序命中答案区那个（题干 article.content
    //   反而排在它前面，但 || 短路根本轮不到它），于是「题干位置」印出去的全是参考答案，
    //   用户看到的卷子就是「只有材料和答案，没有题干问题」。
    //   修法：遍历所有 app-format-html，跳过落在答案区里的；全被跳过才退到 article.content。
    //   做题页的 app-format-html 不在 app-result-common 里，行为与旧版完全一致。
    function pickStem(ti) {
        let fmt = null;
        ti.querySelectorAll('app-format-html').forEach((n) => {
            if (!fmt && !n.closest('app-result-common')) fmt = n;
        });
        const box = fmt || ti.querySelector('article.content');
        if (!box) return '';
        // 过长的下划线/空格统一成等长填空线，避免撑破版面；
        // 行内公式图按 latex 内容补分数标记（fp-tex-frac），供渲染层单独放大、下沉对齐
        return markTexFrac(blankify(box.innerHTML));
    }

    // 参考答案：抓答案区 section-reference 里的 app-format-html（正文 + 说明同框）。
    //
    // 1.11.3 新增「申论卷第三块：参考答案」。答案区 app-result-common 里按 section 分节：
    //   section-video    → 解析视频
    //   section-reference → 参考答案（正文 + 「参考答案说明」都在同一个 app-format-html 里）
    //   section-keypoint  → 答题要点
    //   section-source    → 题目来源
    // 这里只抓 section-reference，其余节一概不要。
    //
    // ⚠️ 不走 cleanClone：cleanClone 里的 JUNK_SELECTOR 含 .analysis / .answer-wrap，
    //   若误命中参考答案结构会把正文一并删掉。这里直接 querySelector 目标节点，
    //   再走 blankify + markTexFrac（与题干同一套净化，公式图随字号缩放、对齐）。
    //   定位用 [id^="section-reference-"] 前缀匹配，鲁棒应对 id 后缀（形如 -3_2_bpcli）变化。
    function pickAnswer(ti) {
        const sec = ti.querySelector('[id^="section-reference-"]');
        if (!sec) return '';
        const fmt = sec.querySelector('app-format-html');
        const box = fmt || sec;
        return markTexFrac(blankify(box.innerHTML));
    }

    // 选项：返回 [{letter, html, units, imgW}]
    // 列数布局不在这里定 —— 那依赖字号与页边距，交给渲染层算
    function pickOptions(ti) {
        const nodes = ti.querySelectorAll('li[class*="choice"], .option-item');
        const empty = { options: [], allImage: false, hasBigImg: false, maxUnits: 0, maxImgW: 0 };
        if (!nodes.length) return empty;

        let allImage = true, hasBigImg = false, anyImg = false;
        const raw = [];

        nodes.forEach((opt, i) => {
            const labelNode = opt.querySelector('.choice-radio-label') || opt;
            const clone = labelNode.cloneNode(true);

            // 选项字母：粉笔把它放在 .input-radio 里（有时在 label 内，有时与 label 平级）。
            // 早先的做法是删掉这个节点、渲染时另起一列补一个字母 —— 两个盒子基线
            // 对不齐，看着有高度落差；而且为了去掉「重复的前导字母」去削正文，
            // 会把 "AB" 这类本身以 A 开头的选项内容削成 "B"。
            // 现在不再动正文一个字符：字母在 label 里就原样留着（只清圆圈装饰），
            // 不在 label 里、且正文开头已经是 "A." 这类写法，也一样原样留着。
            const srcLetter = opt.querySelector('.input-radio');
            let letter = srcLetter ? (srcLetter.innerText || srcLetter.textContent || '').trim() : '';
            if (!letter || letter.length > 3) letter = String.fromCharCode(65 + i);

            const ln = clone.querySelector('.input-radio');
            // 粉笔的字母节点里往往只放了一个 "A"，点号是画在别处的装饰 ——
            // 不补的话排出来就是 "A 选项内容"。凡是光秃秃的字母，统一补个点。
            let hasOwnLetter = false;
            if (ln) {
                const lt = (ln.textContent || '').trim();
                if (/^[A-Za-z]{1,2}$/.test(lt)) {
                    ln.textContent = lt + '.';
                    hasOwnLetter = true;
                } else if (lt) {
                    hasOwnLetter = true;
                }
                ln.classList.add('fp-ol');
            }

            // 只清真正的交互控件 / 装饰空标签，字母载体里面的一律不动
            clone.querySelectorAll('input, button, canvas').forEach((e) => {
                if (ln && ln.contains(e)) return;
                e.remove();
            });
            clone.querySelectorAll('i').forEach((e) => {
                if (ln && ln.contains(e)) return;
                if ((e.textContent || '').trim() === '') e.remove();
            });

            // 量正文宽度时排除字母，免得列宽被多算出一个字母
            const forText = clone.cloneNode(true);
            forText.querySelectorAll('.fp-ol').forEach((e) => e.remove());
            const plain = (forText.innerText || '').replace(/\s+/g, '');
            const hasMedia = !!clone.querySelector('img, svg, canvas');
            if (hasMedia) anyImg = true;
            if (plain.length > 0 && !/^[A-D.、]$/.test(plain) && !hasMedia) allImage = false;

            // 记录选项里最宽的一张图，供渲染层估算列宽
            let imgW = 0;
            clone.querySelectorAll('img').forEach((img) => {
                const w = parseInt(img.getAttribute('width') || img.style.width || '', 10);
                if (isFinite(w) && w > 0) {
                    if (w > imgW) imgW = w;
                    if (w > 120) hasBigImg = true;
                }
            });

            raw.push({ clone, letter, hasOwnLetter, hasMedia, units: cjkUnits(plain), imgW });
        });

        // 兜底补字母：只有页面上确实没有字母节点、正文开头也不是 "A." 这类
        // 写法时才补。判断必须要求字母后面紧跟分隔符 —— 否则 "AB" 这种
        // 本身以 A 开头的选项内容会被误判成「已经有字母」，反过来又会
        // 被上一版的剥离逻辑削掉一个字符。
        const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        function hasOwnLetterText(holder, letter) {
            const t = (holder.textContent || '').replace(/^[\s\u00a0\u3000]+/, '');
            return new RegExp('^' + escRe(letter) + '\\s*[\\.．。、:：]').test(t);
        }

        const options = raw.map(({ clone, letter, hasOwnLetter, hasMedia, units, imgW }) => {
            const holder = document.createElement('div');
            holder.innerHTML = clone.innerHTML.trim();
            if (!hasOwnLetter && !hasOwnLetterText(holder, letter)) {
                holder.insertAdjacentHTML('afterbegin', `<span class="fp-ol">${esc(letter)}.</span>`);
            }
            holder.querySelectorAll('img[flag="tex"]').forEach(tagTexFracImg);
            return { letter: esc(letter), html: holder.innerHTML.trim(), units, imgW };
        });

        let maxUnits = 0, maxImgW = 0;
        options.forEach((o) => {
            if (o.units > maxUnits) maxUnits = o.units;
            if (o.imgW > maxImgW) maxImgW = o.imgW;
        });

        return { options, allImage, hasBigImg, anyImg, maxUnits, maxImgW };
    }

    // 题目最外层容器（只用来做「往下找 app-ti」的根，不参与任何排版计算）。
    //
    // ⚠️ 先把丑话说在前面：这个函数**不是**「课程题组抓不到」解药，别误会它。
    //   本版（1.8.33）曾一度断言「课程题组没有 .tis-container」，那是**错的** ——
    //   拿用户两次回传的真机 DOM 逐层比对，课程题组的结构是
    //     app-exercise > app-nav-header + div.exercise-main > app-tis > div.tis-container
    //   —— .tis-container 明明白白在那儿，其下 9 道题一个不少。
    //   用真机 DOM 1:1 构造页面 + 无头 Chromium 实跑复验（t30/probe_tiroot.js）：
    //     ① 课程题组（真 DOM，题目已渲染）→ 根 = .tis-container，抓到 9 题 ✅
    //     ② 课程题组（外壳都在、app-ti 尚未渲染）→ 抓到 0 题  ← 用户遇到的现场
    //     ④ 题库专项练习                    → 根 = .tis-container，抓到 5 题 ✅
    //     ⑤ 真题卷（回归对照）              → 根 = .tis-container，抓到 3 题 ✅
    //   旧代码的 document.querySelector('.tis-container') 本来就能命中，
    //   所以**选择器从来不是病根** —— 真正的原因是**时序**：
    //   课程页从 www.fenbi.com/ai-lecture/… 套 iframe 进来，题目由 Angular 异步塞进 DOM，
    //   脚本跑的时候容器（乃至 .tis-container 本身）还没生成，于是抓到 0 题。
    //
    //   那这个兜底还有没有用？有，但只对「外壳名不同」的页面有用（前几级命中即生效），
    //   对上面 ② 那种「页面里本来就没题」的时序场景**救不了** ——
    //   ② 里 app-tis 自己也没有 app-ti，循环照样跳过，一路退到 body。
    //   真正解决课程题组的是启动层的「轮询到有题为止 + 路由变化重跑」，
    //   见 runInit / startPollCount。这里保留兜底只是为将来别种外壳留一手。
    //
    //   ⚠️ 返回值的**语义**是「装着题目的那个盒子」，只用于 querySelectorAll 往下找题；
    //     不要拿它当滚动容器或量高度。真题卷下它仍返回 .tis-container，
    //     与旧行为完全一致 —— 分页表现不受影响
    //     （已跑 regress_num_clip 六档悬挂验证：页数 9、撕开次数与基线一致、
    //       题号不可见 = 0、字符守恒 = true，见 t30 实测记录）。
    function tiRoot() {
        for (const sel of ['.tis-container', 'app-tis', 'app-exercise', '.exercise-container', '.paper-container']) {
            let el = null;
            try { el = document.querySelector(sel); } catch (e) { /* 选择器异常则跳过 */ }
            if (el && el.querySelector('app-ti')) return el;
        }
        // 兜底：.ti 是课程题组的题目外框，取它的公共祖先，
        // 别把范围缩到单道题上（否则 countTis 永远只数到 1）。
        const one = document.querySelector('.ti app-ti');
        if (one) {
            const box = one.closest('.ti');
            if (box && box.parentElement) return box.parentElement;
        }
        // 返回 body 是**刻意保留**的旧行为：页面没渲染完时先按 body 找，
        // 后面的「重试一次」会再抓；返回 null 会让调用处炸在 .querySelectorAll。
        return document.body;
    }

    // ---- 行测：滚动加载后直接读取 ----
    async function extractXingce(onProgress, quick) {
        onProgress && onProgress('正在加载全部题目…');

        const scroller = findScroller();
        const isWin = scroller === window;
        // 题目容器：真题卷、课程题组、题库专项练习**都有 .tis-container**
        // （拿用户真机 DOM 实测确认过，别信「课程题组没有这个外壳」那种说法），
        // 统一走 tiRoot() 只为兜住将来别种外壳；抓不到题的真正原因是时序，
        // 靠 runInit / startPollCount 的轮询解决，不靠这里。
        const countTis = () => tiRoot().querySelectorAll('app-ti').length;

        // ⚠️ 非做题页守卫（v1.11.9）：
        //   滚动加载循环的唯一目的是「把懒加载的题目滚出来」。若页面上**一个 app-ti 都没有**，
        //   这个循环就毫无意义，只会把整个页面反复 scrollTo 到底再滚回顶。
        //   根因（用户实测「在粉笔首页/别的页面点开设置，面板就上下跳动跟疯了一样」）：
        //     · 非做题页 countTis() 恒为 0，且页面若有轮播/懒加载，scrollHeight 每轮都在变
        //       → 上页 `h===lastH` 永不成立 → stall 永远复位 → 循环一路跑满 maxIter；
        //     · 叠加 startPollCount 每 500ms 重跑一次 autoCount → extractXingce，
        //       于是页面被反复上下滚动，而面板是 position:fixed，看起来就是面板在疯狂跳动。
        //     · 「点开设置才开始跳」也对得上：展开设置把面板撑高、页面才出现滚动条，
        //       scrollTo 才有实际位移；收起时页面不滚，所以不跳。
        //   守卫后：没有题目容器就直接返回空，一次 scrollTo 都不执行。
        //   不影响做题页 —— 真题卷有 .tis-container/app-ti，countTis()>0，照旧走滚动加载；
        //   首次进页题目尚未渲染时跳过也是**对的**（那时乱滚没有意义），
        //   等 startPollCount 下一轮 DOM 就绪后再抓即可（见 5264 行的轮询死线）。
        if (countTis() === 0) return [];

        let lastH = -1, lastC = -1, stall = 0;
        const maxIter = quick ? 6 : 25;
        for (let i = 0; i < maxIter; i++) {
            try {
                if (isWin) window.scrollTo(0, document.documentElement.scrollHeight);
                else scroller.scrollTop = scroller.scrollHeight;
                window.scrollTo(0, document.documentElement.scrollHeight);
            } catch (e) { /* 忽略 */ }
            await sleep(quick ? 120 : 200);

            const h = isWin ? document.documentElement.scrollHeight : scroller.scrollHeight;
            const c = countTis();
            if (h === lastH && c === lastC) { if (++stall >= 3) break; } else { stall = 0; }
            lastH = h; lastC = c;
            if (c > 0) onProgress && onProgress(`已加载 ${c} 题…`);
        }
        try {
            if (isWin) window.scrollTo(0, 0); else scroller.scrollTop = 0;
            window.scrollTo(0, 0);
        } catch (e) { /* 忽略 */ }

        const root = tiRoot();
        const nodes = root.querySelectorAll('.chapter-container, app-materials, .material, .material-content, app-ti');

        const items = [];
        let matIndex = 0;

        nodes.forEach((el) => {
            const tag = el.tagName.toLowerCase();

            if (el.classList.contains('chapter-container')) {
                matIndex = 0;
                const name = text(el.querySelector('.chapter-name'));
                const desc = text(el.querySelector('.chapter-desc'));
                // 题型标识：页面若在章节 / 题目节点上给了 data-category / data-type / data-name 就取来，
                // 供「自选题目导出」的板块识别优先使用（比章节名可靠）；取不到是空串，行为同改动前。
                const hint = catOf(el) || catOf(el.querySelector('app-ti'));
                if (name) items.push({ kind: 'chapter', name: esc(name), desc: esc(desc), hint: esc(hint) });
                return;
            }

            if (tag === 'app-materials' || el.classList.contains('material') || el.classList.contains('material-content')) {
                // 去重：内层节点已由外层统一处理
                if (el.classList.contains('material-content') && el.closest('app-materials')) return;
                if (el.classList.contains('material-content') && el.closest('.material')) return;
                if (el.classList.contains('material') && el.closest('app-materials')) return;

                if (tag === 'app-materials') {
                    const inners = el.querySelectorAll('.material');
                    if (inners.length > 1) {
                        inners.forEach((m) => {
                            matIndex++;
                            const html = cleanClone(m).innerHTML;
                            items.push({ kind: 'material', html, index: matIndex });
                        });
                        return;
                    }
                }
                matIndex++;
                items.push({ kind: 'material', html: cleanClone(el).innerHTML, index: matIndex });
                return;
            }

            if (tag === 'app-ti') {
                const num = normNum(text(el.querySelector('.title-index')));
                const stemHtml = pickStem(el);
                const picked = pickOptions(el);
                const stemImgs = (() => {
                    const d = document.createElement('div');
                    d.innerHTML = stemHtml;
                    return d.querySelectorAll('img').length;
                })();

                items.push({
                    kind: 'question',
                    num: esc(num),
                    stemHtml,
                    options: picked.options,
                    allImage: picked.allImage,
                    anyImg: picked.anyImg,
                    maxUnits: picked.maxUnits,
                    maxImgW: picked.maxImgW,
                    figure: picked.allImage || stemImgs >= 1,
                    // 题目节点自带的题型标识（同 catOf），无章节时作为板块识别的兜底依据
                    cat: esc(catOf(el)),
                    key: el.getAttribute('data-question-key') || num || String(items.length)
                });
            }
        });

        return items;
    }

    // ---- 申论：两阶段（先逐个材料 tab，再逐个题目 tab）----
    async function extractShenlun(onProgress) {
        const click = (el) => {
            try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) { /* 忽略 */ }
            try { el.click(); } catch (e) { /* 忽略 */ }
        };
        const qTabs = () => {
            let t = document.querySelectorAll('.questions-anchors .tabs-content .tab');
            if (!t.length) t = document.querySelectorAll('.questions-anchors .tab');
            return Array.from(t);
        };
        const matTabs = () => Array.from(document.querySelectorAll('app-materials .tabs-content .tab'))
            .filter((t) => /材料\s*\d+/.test(t.innerText || ''));
        const matNow = () => document.querySelector('app-materials .material-body .material-content')
            || document.querySelector('app-materials .material-content');
        const tiNow = () => document.querySelector('.questions-objective-container app-ti') || document.querySelector('app-ti');
        const keyOf = (ti) => {
            if (!ti) return null;
            const k = ti.getAttribute('data-question-key');
            if (k) return 'k:' + k;
            const idx = ti.querySelector('.title-index');
            return idx ? 'i:' + text(idx) : null;
        };
        const waitSwitch = async (oldKey) => {
            for (let i = 0; i < 30; i++) {
                await sleep(100);
                const k = keyOf(tiNow());
                if (k && k !== oldKey) return true;
            }
            return false;
        };
        const waitMatChange = async (prev) => {
            for (let i = 0; i < 30; i++) {
                await sleep(100);
                const m = matNow();
                if (m) {
                    const t = text(m).slice(0, 200);
                    if (t && t !== prev) { await sleep(200); return matNow(); }
                }
            }
            return matNow();
        };
        const waitTabsStable = async () => {
            let last = -1, same = 0;
            for (let i = 0; i < 30; i++) {
                await sleep(100);
                const n = matTabs().length;
                if (n === last) { if (++same >= 3) return; } else { same = 0; last = n; }
            }
        };

        const items = [];
        const matMap = new Map();
        const questions = [];
        const seen = new Set();

        if (qTabs().length === 0) {
            // 没有题目 tab 的兜底：抓当前可见内容
            const m = matNow();
            if (m) items.push({ kind: 'material', html: cleanClone(m).innerHTML, index: 1 });
            const ti = tiNow();
            if (ti) {
                // 单题兜底：作答要求不起新页（紧跟材料），参考答案单独起新页
                items.push({ kind: 'chapter', name: '作答要求', desc: '', break: false });
                items.push({
                    kind: 'question', num: esc(normNum(text(ti.querySelector('.title-index')))),
                    stemHtml: pickStem(ti), answerHtml: pickAnswer(ti),
                    options: [], maxUnits: 0, maxImgW: 0,
                    allImage: false, figure: false, key: keyOf(ti) || 'q0'
                });
            }
            // 单题申论同样三块齐全：参考答案独立章节
            const qs = items.filter((x) => x.kind === 'question');
            if (qs.length) {
                items.push({ kind: 'chapter', name: '参考答案', desc: '', break: true });
                qs.forEach((q) => items.push({ kind: 'answer', num: q.num, answerHtml: q.answerHtml, key: q.key }));
            }
            return items;
        }

        // 阶段一：切到最后一题（此时左侧材料最全），逐个点材料 tab
        onProgress && onProgress('正在展开全部材料…');
        const lastTab = qTabs()[qTabs().length - 1];
        if (lastTab && !lastTab.classList.contains('active')) {
            click(lastTab);
            await waitSwitch(keyOf(tiNow()));
        } else {
            await sleep(400);
        }
        await waitTabsStable();

        const mts = matTabs();
        let prevMat = '';
        for (let j = 0; j < mts.length; j++) {
            const tab = matTabs()[j];
            if (!tab) continue;
            const mm = (tab.innerText || '').match(/材料\s*(\d+)/);
            const n = mm ? parseInt(mm[1], 10) : j + 1;
            if (matMap.has(n)) continue;
            onProgress && onProgress(`正在抓取材料 ${j + 1}/${mts.length}…`);
            click(tab);
            const m = await waitMatChange(prevMat);
            if (m) {
                prevMat = text(m).slice(0, 200);
                matMap.set(n, cleanClone(m).innerHTML);
            }
        }

        // 阶段二：逐个点题目 tab，按 data-question-key 去重
        const total = qTabs().length;
        for (let i = 0; i < total; i++) {
            const tab = qTabs()[i];
            if (!tab) continue;
            onProgress && onProgress(`正在抓取题目 ${i + 1}/${total}…`);
            const wasActive = tab.classList.contains('active');
            const oldKey = keyOf(tiNow());
            click(tab);
            if (wasActive) await sleep(400);
            else if (!(await waitSwitch(oldKey))) {
                const retry = qTabs()[i];
                if (retry) { click(retry); await waitSwitch(oldKey); }
            }
            const ti = tiNow();
            const k = keyOf(ti);
            if (ti && k && !seen.has(k)) {
                seen.add(k);
                questions.push({
                    kind: 'question',
                    num: esc(normNum(text(ti.querySelector('.title-index')))),
                    stemHtml: pickStem(ti),
                    answerHtml: pickAnswer(ti),
                    options: [],
                    maxUnits: 0,
                    maxImgW: 0,
                    allImage: false,
                    figure: false,
                    key: k
                });
            }
        }

        // 回到第一题，避免影响用户继续做题
        const first = qTabs()[0];
        if (first) { click(first); await sleep(300); }

        Array.from(matMap.keys()).sort((a, b) => a - b).forEach((n) => {
            items.push({ kind: 'material', html: matMap.get(n), index: n });
        });
        // 作答要求章节：多题（>1 题）时单独起新页，与材料断开；单题（<=1 题）时
        // 不起新页、紧跟材料之后（用户反馈：只有一题时作答要求不必单独分页）。
        const multiQ = questions.length > 1;
        if (questions.length) items.push({ kind: 'chapter', name: '作答要求', desc: '', break: multiQ });
        questions.forEach((q) => items.push(q));
        // 参考答案章节：永远单独起新页（用户要求答案单独成页，单题也不例外）
        if (questions.length) items.push({ kind: 'chapter', name: '参考答案', desc: '', break: true });
        questions.forEach((q) => items.push({ kind: 'answer', num: q.num, answerHtml: q.answerHtml, key: q.key }));

        return items;
    }

    /* ==================================================================
     * 六、渲染层：结构化数据 → 打印用 HTML
     * ================================================================ */

    const MM = 96 / 25.4;   // 96dpi 下 1mm ≈ 3.7795px

    // 页边距按 CSS 的「上 右 下 左」简写规则展开，单位 mm
    function parseMargin(m) {
        const v = String(m || '').match(/(\d+(?:\.\d+)?)/g);
        if (!v) return [15, 15, 15, 15];
        const n = v.map(parseFloat);
        if (n.length === 1) return [n[0], n[0], n[0], n[0]];
        if (n.length === 2) return [n[0], n[1], n[0], n[1]];
        if (n.length === 3) return [n[0], n[1], n[2], n[1]];
        return [n[0], n[1], n[2], n[3]];
    }

    // 先算出 A4 内容区实际有多宽（px，96dpi 下 1mm ≈ 3.7795px）
    function contentWidth(opt) {
        const m = String(opt.margin).match(/(\d+(?:\.\d+)?)mm\s+(\d+(?:\.\d+)?)mm/);
        const sideMm = m ? parseFloat(m[2]) : 15;
        return (210 - sideMm * 2) * 3.7795;
    }

    // 选项排几列：按「渲染后需要多宽」逐级降级，装不下就一行一个
    function layoutFor(q, opt) {
        const usable = contentWidth(opt) - opt.fontSize * 2;   // 减去选项区左缩进 2em
        const gap = 18;                                        // 与 CSS .fp-opts 的 column-gap 一致
        const colW = (n) => (usable - gap * (n - 1)) / n;

        // 文字需求宽（另留 "A." 与右边距）+ 图片需求宽（按缩放后计）
        // 图片需求宽用「渲染框上限 140px」封顶：选项里的小图在 CSS 里被限制在 140×100 的框内
        // （object-fit:contain），若按原图自然宽度（粉笔常给 200~300px 的 width 属性）估算，
        // 会把本可横排四个的小图误判成 grid-1，导致一行一个、且图片被拉满整行宽。
        const textNeed = q.maxUnits * opt.fontSize + (q.allImage ? 0 : opt.fontSize * 2.5);
        // 1.8.6：纯图题（粉笔公式图无 width 属性 → maxImgW=0）若直接按 maxImgW 算，
        // 会让 imgNeed=0、need=0，命中下方 need<=0 兜底 → 强制 grid-1 一行一个、页面空旷。
        // 既然 CSS 已把图锁在 140×100 渲染框内，这里对「无可读宽度的小图」按固定值反推，
        // 让 layoutFor 仍能按真实占位选 grid-2/4。有 width 属性的大图仍走原 maxImgW 路径（封顶 140）。
        // 1.8.8 修正：140 特判必须同时满足 anyImg（选项里真有 <img>）。
        // 1.8.9 修正：特判值从 140 降到 70。
        // 原值 140 对行内公式图（分数 √ 等，实际 ~35px 宽）高估了约 4 倍，
        // 页边距 ≥20mm 时就把本该一行 4 个的短选项顶成 grid-2。
        // 70px 足以容纳常见行内公式图，同时在各常用页边距下都能归到 grid-4；
        // 有 width 属性的大图仍走 Math.min(maxImgW*figScale/100, 140)，不受影响。
        const imgNeed = q.allImage && !q.hasBigImg && q.anyImg
            ? 70
            : Math.min(q.maxImgW * opt.figScale / 100, 140);
        const need = Math.max(textNeed, imgNeed);

        if (need <= 0) return 'grid-1';
        if (need <= colW(4)) return 'grid-4';
        if (need <= colW(2)) return 'grid-2';
        return 'grid-1';
    }

    // 题干里要求的作答字数：取「不超过 200 字」「1000～1200 字」里的上限
    function requiredCount(stemHtml) {
        const t = String(stemHtml || '')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;|&amp;/g, ' ')
            .replace(/[\s,，]/g, '');
        let max = 0;
        const range = t.match(/(\d{2,5})\s*[-~—～－至到]\s*(\d{2,5})\s*字/);
        if (range) max = Math.max(parseInt(range[1], 10), parseInt(range[2], 10));
        (t.match(/(\d{2,5})\s*字/g) || []).forEach((s) => {
            const n = parseInt(s, 10);
            if (n > max) max = n;
        });
        return max;
    }

    // 按字数算作答区：一行能写多少字 → 需要几行 → 行距多少。
    // 手写格子约 8mm 见方，与正文字号无关，所以按物理宽度估算每行字数，
    // 而不是按正文字号去算——字号调大不该让手写空间变少。
    function spaceSize(stemHtml, opt) {
        const grid = Math.max(30, Math.round(opt.fontSize * 2.2));    // 单行高（≈8.7mm）
        const perLine = Math.max(15, Math.floor(contentWidth(opt) / (8 * 3.7795)));
        const count = requiredCount(stemHtml) || 200;                  // 读不到字数时的兜底
        const rows = Math.max(1, Math.ceil(count / perLine) + 1);      // 多给一行余量
        return { height: rows * grid, grid, rows, count };
    }

    function buildHtml(items, opt, meta) {
        const isShenlun = meta.mode === 'shenlun';
        const qCount = meta.questionCount;

        // A4 版面尺寸：内容区 = 纸张 − 页边距；再让出页眉 + 页脚
        const mg = parseMargin(opt.margin);
        const CONTENT_W = (210 - mg[1] - mg[3]) * MM;
        const CONTENT_H = (297 - mg[0] - mg[2]) * MM;
        const PFOOTER_H = 22;
        // ★ 1.10.0：页眉是固定高度的 flex 项，一出现就吃掉正文的高度预算。
        //   算「一页能放多少正文」的 BODY_H 必须同步减掉它，否则正文可放行数照旧
        //   按整页算 → 每页都顶出页面下沿 → 打印时被 overflow:hidden 悄悄裁掉最后一行。
        //   这是最难排查的一类 bug：屏幕上不一定看得出来，一打印就少字。
        const PHEADER_H = opt.header ? 22 : 0;
        const BODY_H = CONTENT_H - PFOOTER_H - PHEADER_H;

        let html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opt.title)}</title>
<style>
*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
/* 禁用浏览器「字号调整」（也称「文字缩放」）对本页的二次放大。
   公式图尺寸写的是 em（1em / 1.15em），字号一被调整，**图片跟着一起放大**，
   而粉笔公式图本身是位图，放大就发虚、和文字不再是同一套比例。
   关掉它之后，打印页永远按脚本自己算好的 px 字号渲染，所见即所得。 */
html{-webkit-text-size-adjust:none!important;text-size-adjust:none!important}

/* 页边距放到每个 .fp-page 内部（padding），@page 外边距归零。
   否则打印对话框若选了比脚本假设更大的边距（Chrome 默认约 20mm，
   而脚本按 15mm 算高度），每页就会比可打印区高出一截，
   page-break-after:always 又强制分页 → 每页后跟着一张空白页。 */
@page{size:A4;margin:0}

html{background:#e5e7eb}
body{margin:0;padding:0;background:#fff;font-family:${fontChainOf(opt.fontFamily)};
  font-size:${opt.fontSize}px;color:#000000;line-height:${opt.lineHeight};
  orphans:2;widows:2;text-rendering:optimizeLegibility}
ul,li,ol{list-style:none;margin:0;padding:0}
p{margin:0 0 .5em}

/* ---------- 真分页 ----------
   页码不靠 @page 的 margin box —— 那东西只有打印时才画得出来，
   屏幕上完全看不到，也就没法在预览时确认版面。
   这里由脚本按 A4 内容区高度把正文切成一张张 .fp-page，
   页码是实打实写在页面上的文字：屏幕上所见即打印所得。 */
#fp-flow{width:${CONTENT_W}px;margin:0 auto;visibility:hidden}
#fp-loading{position:fixed;left:0;right:0;top:42%;text-align:center;color:#64748b;font-size:15px;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
@media print{#fp-loading{display:none!important}}
.fp-page{position:relative;display:flex;flex-direction:column;background:#fff;overflow:hidden}
/* flow-root：挡住子元素外边距往外折叠，免得每页顶部莫名空一截 */
.fp-pbody{flex:1 1 auto;overflow:visible;display:flow-root}
/* 页首页尾的 margin 归零：脚本按「相对顶边的偏移」预估页高，
   浏览器要是再在两头补上外边距，预估就会偏，内容顶出页面下沿 */
.fp-pbody>:first-child{margin-top:0!important}
.fp-pbody>:last-child{margin-bottom:0!important}
/* ---------- 页眉（可选，面板「打印页眉」控制）----------
   与页脚同样式：定高 flex 项，文字居中、下方一条细分隔线。
   高度必须与 buildHtml 里的 PHEADER_H 一致（22px），否则 BODY_H 算错。 */
.fp-pheader{flex:0 0 ${PHEADER_H}px;height:${PHEADER_H}px;
  line-height:${PHEADER_H}px;text-align:center;position:relative;
  font-size:10pt;color:#555;font-family:"SimSun","STSong",serif;
  border-bottom:1px solid #d8dde5;margin-bottom:8px;
  overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
/* 页面左上角小字：与页脚署名同款缩小的风格，保持整卷视觉统一。 */
.fp-pheader .fp-htitle{display:inline-block;max-width:100%;
  padding:0 2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
/* 页脚：页码居中，署名靠左不动。署名写死，没有面板入口。 */
.fp-pfooter{position:relative;flex:0 0 ${PFOOTER_H}px;height:${PFOOTER_H}px;
  line-height:${PFOOTER_H}px;text-align:center;
  font-size:10pt;color:#555;font-family:"SimSun","STSong",serif}
/* 署名：8.5pt → 7.5pt（小两号），#9aa3b2 → #adb5c0（白底对比度 2.55:1 → 2.07:1）。
   再小或再淡打印出来就糊了，7.5pt 是激光打印机还能稳住的下限。 */
.fp-pfooter .fp-sig{position:absolute;left:0;top:0;height:100%;
  font-size:7.5pt;color:#adb5c0;letter-spacing:.5px;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  max-width:52%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.fp-pfooter .fp-pg{display:block;white-space:nowrap}
/* 页面右下角小字：粉笔题库。与署名同步缩小减淡，否则左边轻右边重，看着不协调。 */
.fp-pfooter .fp-tag{position:absolute;right:0;top:0;height:100%;
  font-size:7.5pt;color:#adb5c0;letter-spacing:.5px;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  white-space:nowrap}

@media screen{
  body{background:#e5e7eb;padding:16px 0}
  .fp-page{width:210mm;height:297mm;margin:0 auto 14px;padding:${opt.margin};
    box-shadow:0 1px 8px rgba(15,23,42,.16)}
  .fp-sheet{background:#fff;box-shadow:0 1px 8px rgba(15,23,42,.16);margin:0 auto 14px;
    max-width:210mm;min-height:277mm;padding:14mm 12mm}
}
@media print{
  html,body{background:#fff}
  body{padding:0}
  /* 每页钉死成“整张 A4（297mm）”，可视边距由内部 padding 提供。
     这样无论用户在打印对话框里选“默认/最小/无”边距，
     每页都正好占满一张纸，page-break-after:always 只会切出刚好的分页，
     不会再因为「内容区高度 > 可打印高度」而多挤出空白页。 */
  .fp-page{width:auto;height:297mm;min-height:297mm;max-height:297mm;
    padding:${opt.margin};box-sizing:border-box;overflow:hidden;margin:0;
    box-shadow:none;page-break-after:always;break-after:page}
  .fp-page:last-child{page-break-after:auto;break-after:auto}
  .fp-pbody{min-height:${BODY_H}px;max-height:${BODY_H}px;overflow:hidden}
  .fp-sheet{box-sizing:border-box;height:297mm!important;padding:${opt.margin}!important;
    box-shadow:none;margin:0;max-width:none;min-height:0}
  #fp-flow{display:none!important}
}
/* 旧类名兼容，防止外部还引用 .fp-pnum */
.fp-pnum{display:none!important}

/* ---------- 封面 ---------- */
.fp-cover{position:relative;height:262mm;page-break-after:always;break-after:page;display:flex}
.fp-cover-side{width:34px;border-right:1px dashed #555;position:relative}
.fp-cover-side div{position:absolute;left:30%;transform:translateX(-50%) rotate(-90deg);
  display:flex;align-items:center;width:270px;white-space:nowrap;font-size:14px;letter-spacing:5px}
.fp-cover-side .t1{top:26%}
.fp-cover-side .t2{top:70%}
.fp-cover-side i{flex:1;border-bottom:1px solid #000;margin-left:8px;height:0}
.fp-cover-main{flex:1;position:relative;padding:52px 36px;text-align:center}
.fp-cover-notice{position:absolute;top:34px;right:34px;border:1px solid #333;padding:8px 10px;font-size:13px;line-height:1.6;letter-spacing:1px}
.fp-cover-tt{margin-top:92px;margin-bottom:54px}
.fp-cover-tt .l1{font-size:28px;font-weight:700;letter-spacing:2px;margin-bottom:14px;line-height:1.5}
.fp-cover-tt .l2{font-size:24px;font-weight:700;letter-spacing:2px;line-height:1.5}
.fp-cover-hr{display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;margin:0 auto 34px;width:76%}
.fp-cover-hr::before,.fp-cover-hr::after{content:'';flex:1;border-bottom:1px dashed #333;margin:0 14px}
.fp-cover-tips{text-align:left;font-size:15px;line-height:2.1;margin:0 auto;width:82%;
  font-family:"KaiTi","STKaiti","SimSun",serif}
.fp-cover-tips p{text-indent:2em;margin:10px 0}
.fp-cover-barcode{position:absolute;bottom:210px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:22px;font-size:14px;color:#000}
.fp-cover-barcode .box{width:64px;height:108px;border:1px dashed #333;display:flex;align-items:center;justify-content:center}
.fp-cover-barcode .box span{writing-mode:vertical-rl;letter-spacing:3px;font-size:13px}
.fp-cover-barcode .tip{text-align:left;line-height:1.8;font-size:13px}
.fp-cover-sign{position:absolute;bottom:18px;left:0;right:0;text-align:center;font-size:12px;color:#64748b;letter-spacing:1px}
/* 封面后的空白缓冲页（模拟真实试卷翻开后的背面空白）。
   ★ 1.11.6：高度 262mm → 297mm。
      262mm 不足一张 A4（297mm），在 Firefox 分页引擎里会因
      「内容高度 < 一页 + page-break-after:always」的组合，在缓冲页之后再
      多挤出一张空白页 —— 这正是「封面第1页、缓冲第2页、第三页异常空白」的根因。
      改成 297mm 后缓冲页正好占满一张纸，Firefox/Edge/Chrome 都稳定。
      同时去掉悬空的 page:fpblank —— 代码里从没有 @page fpblank 定义，
      Firefox 对悬空命名页可能强制额外分页。 */
.fp-blank{height:297mm;page-break-after:always;break-after:page}

/* ---------- 章节 ---------- */
.fp-chapter{text-align:left;margin-bottom:16px;page-break-after:avoid;break-after:avoid}
.fp-chapter h2{font-size:18px;font-weight:700;letter-spacing:2px;margin:0;text-align:center}
.fp-chapter p{font-size:${opt.fontSize}px;margin:10px 0 0;color:#000000;text-align:justify;
  text-align-last:left;text-indent:2em;line-height:1.7}
.fp-chapter.break{page-break-before:always;break-before:page;padding-top:26px}

/* ---------- 材料 ---------- */
.fp-mat{margin:14px 0}
.fp-mat h3{font-weight:700;font-size:${opt.fontSize + 2}px;text-align:left;margin:0 0 10px;
  page-break-after:avoid;break-after:avoid}
.fp-mat p{text-indent:2em;text-align:justify;text-align-last:left;margin:5px 0;line-height:${opt.lineHeight}}
.fp-mat p[style*="center"],.fp-mat p[style*="right"]{text-indent:0!important}
.fp-mat table{width:100%!important;border-collapse:collapse!important;margin:14px 0}
.fp-mat th,.fp-mat td{border:1px solid #333!important;padding:7px 9px!important;text-align:center!important;
  font-size:${Math.max(9, opt.fontSize - 1)}px!important;line-height:1.5!important}
.fp-mat th{background:#f4f4f4!important;font-weight:700}
.fp-mat img{max-width:100%!important;height:auto!important;display:block;margin:10px auto}
/* 1.11.2：材料里嵌在文字流中的小图必须保持行内（见 markMatInline）——
   上面那条 display:block 是给「独立成段的配图」用的；行内公式图（摄氏度等）被它
   劈成独立居中行，一句话断成三截。打标记的图恢复行内，尺寸/对齐交给
   tagTexFracImg 的内联值（tex 图）或浏览器默认基线（其他行内小图）。
   独立成段的配图（<p><img></p>）不打标记，维持块级居中不变。 */
.fp-mat img[data-fp-inline]{display:inline!important;margin:0!important}
img{border:0!important;box-shadow:none!important;background:transparent!important;
  break-inside:avoid;page-break-inside:avoid}
tr{break-inside:avoid;page-break-inside:avoid}

/* ---------- 填空线 ----------
   用一条 border-bottom 画出来。早先用连续的全角下划线字符拼接，
   字体会把它渲染成一段忽粗忽细、彼此重叠的黑杠，这里彻底换成画线。 */
.fp-ul{display:inline-block;width:5em;height:1em;border-bottom:1px solid #151515;
  vertical-align:-.16em;margin:0 .12em;text-indent:0;overflow:hidden}

/* ---------- 题目 ---------- */
.fp-q{margin-bottom:${opt.qSpacing}px;break-inside:auto;page-break-inside:auto}

/* 被撕开的题/材料壳（fp-cont）：这道题（或这段材料）在本壳之后还有续排内容，
   也就是说这个壳不是「这道题的结尾」，后面跟的是同一道题的下一截，不是新题。
   此时不能吃「题目与题目之间」的间距（${opt.qSpacing}px），否则撕开接缝处（C|D 之间）
   的间距会明显大于同壳内选项间距（A/B/C），看起来像凭空多空了一行。

   ⚠️ 1.8.25 修正：一开始这里直接写成 margin-bottom:0，结果接缝反而**偏小** ——
   用户真机反馈「C/D 的间距比 A/B/C 略小几个像素」。原因在于接缝处的间距不是
   单一来源，而是两侧各自的空隙相加：

     同壳内 A→B→C：靠 .fp-opts 的 row-gap（.5em ≈ 8px）

     C→D 跨壳时：  壳1 的 margin-bottom（当时被清零 = 0）
                 + 壳2 里 .fp-opts 自己的 margin-top（.3em ≈ 4.8px）
                 = 4.8px  ← 比 8px 小了一截

   所以正确的做法不是「清零」，而是「补齐到和 row-gap 一样」：
   把 .fp-cont 的下间距补成 (row-gap − 下一壳顶部的 margin-top)。
   .fp-opts 的 margin-top 是 .3em、row-gap 是 .5em，差值 .2em —— 用 calc 直接算，
   不手写像素数字：改行距/间距配置时这里跟着变，不会留下对不上的硬编码。

   注意只动 margin-bottom，不碰 padding —— padding 参与高度计算，
   改了会让分页器量到的页高和实际对不上。 */
.fp-q.fp-cont{margin-bottom:calc(.5em - .3em)}
.fp-mat.fp-cont{margin-bottom:calc(.5em - .3em)}

/* 题号悬挂缩进（固定排版，不提供开关）：
   题干整体右移 HANG，第一个段落再负缩进 HANG 把题号顶回左边界，
   于是题号突出在外、正文各行左边界对齐，换行也不会钻到题号底下。
   非第一段的普通段落不要首行缩进，直接和第一行文字左边界对齐。 */
.fp-stem{margin-bottom:.4em;padding-left:var(--hang,${HANG}em);orphans:2;widows:2}
.fp-stem p,.fp-stem div{margin:0 0 .5em!important;padding:0!important;text-indent:0!important;
  text-align:justify;text-align-last:left;line-height:${opt.lineHeight}}
.fp-stem p.fp-first,.fp-stem div.fp-first{text-indent:0!important}
.fp-stem p[style*="center"],.fp-stem p[style*="right"]{text-indent:0!important}
.fp-stem p.fp-first[style*="center"],.fp-stem p.fp-first[style*="right"]{text-indent:0!important}
/* 选项中的图片一律限制在 140×100 框内（object-fit:contain），
   避免某选项被误判成「文字选项」时，图片走 max-width:100% 在整行下被等比放大占半页 */
.fp-stem img,.fp-opt img{vertical-align:middle;max-width:100%;height:auto}
.fp-opt img{max-width:140px!important;max-height:100px!important;object-fit:contain}
.fp-num{float:left;margin-left:calc(-1 * var(--hang,${HANG}em));margin-right:.5em;font-family:"Times New Roman","SimSun",serif}

/* 选项与题干的悬挂位置对齐，换行后仍从字母右侧起排。
   用 flex-wrap 而不是 grid：每个 .fp-opt 是独立可搬的盒子，
   排版时才能把选项组拆到两页上，到了新页仍按同样的列宽排。 */
.fp-opts{display:flex;flex-wrap:wrap;column-gap:18px;row-gap:.5em;margin-top:.3em;padding-left:var(--ohang,${HANG}em)}
/* 选项列数由 layoutFor 按「整组最长项」统一决定（grid-1 / grid-2 / grid-4），
   整组共用同一个 class —— 因此同一道题的选项永远列数一致：
   要么都横排（4 个或 2 个一行），要么都逐行独占，绝不会出现
   「有的横排、有的折行」的参差排版。
   短组（最长项够窄）→ grid-4 一行 4 个；中组 → grid-2 一行 2 个；
   长组（任一选项长到要独占一行）→ grid-1 整组逐行。 */
.fp-opts.grid-1>.fp-opt{flex:0 0 100%}
.fp-opts.grid-2>.fp-opt{flex:0 0 calc((100% - 18px)/2)}
.fp-opts.grid-4>.fp-opt{flex:0 0 calc((100% - 54px)/4)}

/* 选项字母直接用粉笔自己的节点（.fp-ol），和正文同一个行内流，
   不再另起一列 —— 基线天然对齐，没有高度落差。
   悬挂靠 padding-left + 负 text-indent：字母顶到左边界，
   换行后的文字从 padding 边界起排，对齐到字母右侧。 */
.fp-opt{page-break-inside:avoid;break-inside:avoid;line-height:${opt.lineHeight};
  word-break:break-word;padding-left:0;text-indent:0}
.fp-opt .fp-ol{display:inline-block!important;float:left!important;margin-left:calc(-1 * var(--ohang,${HANG}em))!important;width:var(--ohang,${HANG}em)!important;
  height:auto!important;min-width:0!important;max-width:none!important;
  border:0!important;border-radius:0!important;background:none!important;
  box-shadow:none!important;padding:0!important;margin:0!important;
  font:inherit!important;font-family:"Times New Roman","SimSun",serif!important;
  font-weight:400!important;color:inherit!important;line-height:inherit!important;
  vertical-align:baseline!important;text-indent:0!important;overflow:visible!important;
  position:static!important;transform:none!important}
.fp-opt .fp-ol::before,.fp-opt .fp-ol::after{content:none!important;display:none!important}
.fp-opt p{margin:0!important;padding:0!important}
/* 兜底两层：万一还有没拆干净的块级外壳，也强制成行内，
   别再让字母和内容各占一行。text-indent 是会继承的，
   不归零的话子盒子第一行会跟着一起左移出悬挂位。 */
.fp-opt:not(.fp-opt-img)>*,
.fp-opt:not(.fp-opt-img)>*>*,
.fp-opt:not(.fp-opt-img)>*>*>*{display:inline!important;margin:0!important;padding:0!important;
  text-indent:0!important;white-space:normal}
.fp-opt:not(.fp-opt-img) img{display:inline-block!important;vertical-align:middle!important}
/* 行内公式图（flag="tex"）的**兜底**规则 —— 只在 JS 还没量出图片真实像素时生效。
   真正的尺寸与对齐由 tagTexFracImg / applyTexSize 写成内联 !important：
     尺寸 = 原始像素 ÷ 18（等比缩放，让图片内部字号等于正文字号）；
     对齐分两类 —— 单行公式贴基线、分数类用 vertical-align:middle 行内居中。
   这里刻意**不写 width/height/vertical-align**，免得与内联值打架。
   为什么兜底不预设 vertical-align？因为「分数 vs 单行」必须靠**墨迹高度**判断
   （分数 36~37px、单行 14px），CSS 读不到图片像素，任何写死的值都会有一类对不上。 */
.fp-stem img[flag="tex"],
.fp-opt:not(.fp-opt-img) img[flag="tex"]{
  max-width:none!important;max-height:none!important;
  object-fit:contain}
/* ⚠️ 这里**刻意不声明 vertical-align** —— 对齐分两类（单行贴基线 / 分数行内居中），
   而分类只能靠**墨迹高度**判定（要读图片像素，CSS 做不到）。
   任何写死的值都必然让其中一类错位；JS 每次都会把算好的值写成内联 !important，
   这里再声明一遍只会平添「谁压过谁」的麻烦（1.8.21 调试时就栽在这上面：
   本节的 vertical-align 与上面给普通配图的 middle 规则互相打架，
   结果公式图的 vertical-align 被改成了 baseline，分数居中直接失效）。 */
.fp-opt:not(.fp-opt-img) img[flag="tex"]{
  /* 重置通用规则给普通配图的 vertical-align:middle —— 公式图由 JS 内联值决定 */
  vertical-align:baseline}
.fp-stem img[flag="tex"]{/* 同上，不声明 —— 由 JS 内联值决定 */}

/* 图形选项：选项之间仍按 .fp-opts 横向排列（flex-wrap 决定 grid-1/2/4），
   只在选项内部把「字母圈 + 图」上下排列并保证顶端对齐。

   早先用 flex-wrap 排选项、flex 列排字母+图时：整组横排后按整组高度
   交叉轴对齐，图片高度不一 → 字母圈被推到图片底部、参差不齐。
   这次只动选项内部 —— display:block 让字母圈 + 图各自成行，
   align-self:start 防止外层 flex 再次把字母往下推。
   外层 .fp-opts 的横向排列保持不变 —— 不该把一行四个选项劈成纵向一列 */
.fp-opt-img{display:block;text-align:left;min-width:120px;align-self:start;
  page-break-inside:avoid;break-inside:avoid}
.fp-opt-img .fp-ol{display:block!important;margin:0 0 6px 0!important;float:none!important;width:auto!important}
.fp-opt-img>div,.fp-opt-img>span{display:block}
.fp-opt-img img{display:block;width:auto;max-width:140px!important;max-height:100px!important;height:auto;margin:0;vertical-align:top;object-fit:contain}

/* ---------- 申论作答区（格线间距由渲染层按字号内联指定） ---------- */
.fp-space{margin:10px 0 4px;border:1px solid #c8d0da;border-radius:2px;
  page-break-inside:auto;break-inside:auto}
/* 作答区跨页时，续页那几片不再重复画上边框 */
.fp-space-mid{border-top:0;border-top-left-radius:0;border-top-right-radius:0;margin:0}

/* ---------- 二维码 ---------- */
/* 独立成页（默认）：整块起新页，垂直留白多一点，像一张单独的附页 */
.fp-qr{page-break-before:always;break-before:page;text-align:center;padding-top:70px}
.fp-qr img{width:190px;height:190px;border:1px solid #ddd;padding:8px;background:#fff}
/* ★ 1.11.0 可选：二维码紧贴题目 —— 当作正文流的最后一块，排在末页题目后面，
   与题目之间空一行（margin-top 24px，约一个正文行高）。
   尺寸整体收小一号，避免为了塞一个二维码反而挤掉一整页题目。
   .fp-qr-inline 排在 .fp-pbody 里（是个普通 flex 项），不吃 page-break-before。 */
.fp-qr-inline{margin:24px auto 0;text-align:center;page-break-inside:avoid;break-inside:avoid}
.fp-qr-inline img{width:132px;height:132px;border:1px solid #ddd;padding:6px;background:#fff}
.fp-qr-inline .fp-qr-t{font-size:15px;font-weight:700;color:#2563eb;margin-bottom:4px}
.fp-qr-inline .fp-qr-s{font-size:11px;color:#666;margin-bottom:8px}

/* ---------- 分页策略 ----------
   三档都保证：单个选项不拆、图片不拆、表格行不拆、标题不落单。
   差别只在于「允许断到多细」。 */

/* 智能平衡（默认）：题目可跨页 —— 题干按段落断开，段落内部不断行；
   选项组同样可以断开，只是短选项组会尽量整组留在同一页。 */
body.pag-smart .fp-q{break-inside:auto;page-break-inside:auto}
body.pag-smart .fp-stem{break-inside:auto;page-break-inside:auto}
body.pag-smart .fp-stem p,body.pag-smart .fp-mat p{break-inside:avoid;page-break-inside:avoid}
body.pag-smart .fp-opts{break-inside:auto;page-break-inside:auto}
body.pag-smart .fp-opts.grid-2,body.pag-smart .fp-opts.grid-4{break-inside:avoid;page-break-inside:avoid}

/* 极致省纸：连段落中间都能断，页面填得最满，但可能出现半截段落 */
body.pag-ultra .fp-q,body.pag-ultra .fp-stem{break-inside:auto;page-break-inside:auto}
body.pag-ultra .fp-stem p,body.pag-ultra .fp-mat p{break-inside:auto;page-break-inside:auto;orphans:1;widows:1}
body.pag-ultra .fp-opts{break-inside:auto;page-break-inside:auto}

/* 整题不拆：每道题完整留在同一页，最整洁但留白最多 */
body.pag-whole .fp-q{break-inside:avoid;page-break-inside:avoid}
body.pag-whole .fp-mat{break-inside:avoid;page-break-inside:avoid}

/* ---------- 提示层 ---------- */
#fp-done{position:fixed;inset:0;background:rgba(15,23,42,.62);backdrop-filter:blur(4px);z-index:120;
  display:none;align-items:center;justify-content:center;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
#fp-done>div{background:#fff;border-radius:14px;padding:32px 40px;text-align:center;max-width:380px;box-shadow:0 20px 50px rgba(0,0,0,.3)}
#fp-done .ok{width:48px;height:48px;background:#16a34a;color:#fff;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 14px}
#fp-done h3{margin:0 0 8px;font-size:18px;color:#0f172a}
#fp-done p{margin:0 0 18px;font-size:13px;color:#64748b;line-height:1.6}
#fp-done button{background:#94a3b8;color:#fff;border:0;padding:10px 24px;border-radius:8px;
  font-size:14px;font-weight:700;cursor:pointer;min-width:141px}
#fp-done button[disabled]{cursor:not-allowed}
#fp-done button.on{background:#2563eb;cursor:pointer}
.fp-done-btns{display:flex;gap:12px;justify-content:center;margin-top:4px}
@media print{#fp-done{display:none!important}}
</style></head>
<body class="pag-${opt.pagination}">
<div id="fp-loading">正在按 A4 分页，题目较多时需要几秒…<br><span style="font-size:12px;color:#94a3b8">打印时请在设置里取消勾选「页眉和页脚」、选 A4 纸张；要存成文件就把目标选成「另存为 PDF」。</span></div>
<div id="fp-done"><div><div class="ok">&#10003;</div>
<h3 id="fp-done-t">正在生成文件</h3><p id="fp-done-p">另存为 PDF 需要几秒到十几秒，请稍候再关闭页面。<br>打印设置里请取消「页眉和页脚」，避免顶部出现标题/网址、底部出现日期。</p>
<div class="fp-done-btns"><button id="fp-done-stay" disabled>留在页面</button><button id="fp-done-close" class="on" disabled>关闭页面</button></div></div></div>
`;

        // ---------- 封面 ----------
        if (opt.cover) {
            html += `<div class="fp-sheet fp-cover">
<div class="fp-cover-side"><div class="t1">准考证号<i></i></div><div class="t2">姓名<i></i></div></div>
<div class="fp-cover-main">
  <div class="fp-cover-notice">粉笔内部<br>题库试卷</div>
  <div class="fp-cover-tt"><div class="l1">${esc(opt.title)}</div></div>
  <div class="fp-cover-hr">重要提示</div>
  <div class="fp-cover-tips">
    <p>为维护您的个人权益，确保考试的公平公正，请您协助我们监督考试实施工作。</p>
    <p>本场考试规定：监考老师要向本考场全体考生展示题本密封情况，并邀请两名考生代表验封签字后，方能开启试卷袋。</p>
  </div>
  <div class="fp-cover-barcode">
    <div class="box"><span>条形码粘贴处</span></div>
    <div class="tip">请将此条形码揭下，<br>贴在答题卡指定位置</div>
  </div>
  ${opt.signature ? `<div class="fp-cover-sign">${esc(opt.signature)}</div>` : ''}
</div></div>
<div class="fp-blank">&nbsp;</div>
`;
        }

        // ---------- 正文 ----------
        // 先渲染成一条连续流，等图片就位后由底部脚本切成一张张 A4（见 paginate）
        html += `<div id="fp-pages"></div><div id="fp-flow">`;

        let firstChapter = true;
        let matIndex = 0;
        let qIndex = 0;

        items.forEach((it) => {
            if (it.kind === 'chapter') {
                // 1.11.3：章节是否分页优先读显式 it.break；未指定时退回旧规则
                //   （第一个章节不分页、后续章节分页，行测的材料分析分组沿用这套）。
                //   申论三块里作答要求/参考答案都显式给了 break，故不受影响。
                const forceBreak = it.break === true ? true : (it.break === false ? false : !firstChapter);
                firstChapter = false;
                const cls = forceBreak ? 'fp-chapter break' : 'fp-chapter';
                html += `<div class="${cls}"><h2>${it.name}</h2>${it.desc ? `<p>${it.desc}</p>` : ''}</div>`;
                return;
            }

            if (it.kind === 'material') {
                matIndex++;
                const n = it.index || matIndex;
                const hasHead = /材料\s*[一二三四五六七八九十\d]+/.test(it.html);
                // 1.11.2：材料 HTML 过 markMatInline（行内小图打标记，防被块级化劈成独立行）+
                // markTexFrac（行内公式图锁尺寸/对齐 —— 以前只有题干和选项做这两步，
                // 材料里的公式图既不跟字号缩放、还会被 .fp-mat img 的 display:block 劈成独立居中行）
                const matHtml = markTexFrac(markMatInline(blankify(it.html)));
                html += `<div class="fp-mat">${hasHead ? '' : `<h3>材料${n}</h3>`}${matHtml}</div>`;
                return;
            }

            if (it.kind === 'question') {
                qIndex++;

                // 按题号实际占宽算每题各自的悬挂列宽：间隙固定 0.5em（约半个汉字），
                // 续行与选项仍对齐到同一左边界。没有题号时不设，沿用兜底值。
                const numW = it.num ? textWidthEm(it.num, opt.fontSize, fontChainOf(opt.fontFamily)) : 0;
                const hang = it.num ? Math.max(numW + 0.5, 0.8) : 0;
                const hangStyle = hang ? ` style="--hang:${hang.toFixed(3)}em;--ohang:${hang.toFixed(3)}em"` : '';

                let stem = it.stemHtml || '';
                if (it.num) {
                    // 题号塞进第一个段落，没有段落就包一个
                    const d = document.createElement('div');
                    d.innerHTML = stem;
                    const p = d.querySelector('p');
                    const mark = `<span class="fp-num">${it.num}</span>`;
                    if (p) {
                        p.innerHTML = mark + p.innerHTML;
                        p.classList.add('fp-first');
                    } else {
                        d.innerHTML = `<p class="fp-first">${mark}${d.innerHTML}</p>`;
                    }
                    stem = d.innerHTML;
                }

                const figureCls = it.figure ? ' fp-fig' : '';
                html += `<div class="fp-q${figureCls}"${hangStyle}><div class="fp-stem">${stem}</div>`;

                if (it.options && it.options.length) {
                    html += `<div class="fp-opts ${layoutFor(it, opt)}">`;
                    it.options.forEach((o) => {
                        // 字母是粉笔自己的节点，已经随 o.html 一起进来了，这里不再另加
                        const oh = flattenOpt(blankify(o.html));
                        // 仅「整题纯图 + 存在大图」才按图片选项布局（fp-opt-img block 模式）：
                        //   - 混合选项（A/B 文字 + C/D 图）：allImage=false → inline，图片与字母同行
                        //   - 纯小图题（四个都是分数公式等小尺寸 LaTeX 图）：allImage=true 但 hasBigImg=false → inline
                        //   - 纯大图题（几何图形/图表等 width>120）：allImage=true + hasBigImg=true → block
                        // 靠 CSS .fp-opt:not(.fp-opt-img) img{display:inline-block} 让 inline 选项的图片与字母同行
                        const isImgOpt = it.allImage && it.hasBigImg;
                        html += `<div class="fp-opt${isImgOpt ? ' fp-opt-img' : ''}">${oh}</div>`;
                    });
                    html += `</div>`;
                }

                // 申论作答区（默认不留；auto 按题目字数算，fixed 用固定高度）
                if (isShenlun && opt.shenlunMode && opt.shenlunMode !== 'none') {
                    let h, grid;
                    if (opt.shenlunMode === 'auto') {
                        const s = spaceSize(it.stemHtml, opt);
                        h = s.height; grid = s.grid;
                    } else {
                        grid = Math.max(30, Math.round(opt.fontSize * 2.2));
                        h = Math.round(opt.shenlunSpace * 37.8 / grid) * grid;
                    }
                    if (h > 0) {
                        html += `<div class="fp-space" data-grid="${grid}" style="height:${h}px;`
                            + `background-image:repeating-linear-gradient(to bottom,`
                            + `transparent 0,transparent ${grid - 1}px,#c8d0da ${grid - 1}px,#c8d0da ${grid}px)"></div>`;
                    }
                }

                html += `</div>`;
            }

            if (it.kind === 'answer') {
                // 参考答案（1.11.3 申论第三块）：与题干同款悬挂缩进 + 题号，但
                // 不渲染选项、不渲染作答区，只印参考答案正文 + 说明。
                const numW = it.num ? textWidthEm(it.num, opt.fontSize, fontChainOf(opt.fontFamily)) : 0;
                const hang = it.num ? Math.max(numW + 0.5, 0.8) : 0;
                const hangStyle = hang ? ` style="--hang:${hang.toFixed(3)}em;--ohang:${hang.toFixed(3)}em"` : '';

                let ans = it.answerHtml || '';
                if (it.num) {
                    const d = document.createElement('div');
                    d.innerHTML = ans;
                    const p = d.querySelector('p');
                    const mark = `<span class="fp-num">${it.num}</span>`;
                    if (p) {
                        p.innerHTML = mark + p.innerHTML;
                        p.classList.add('fp-first');
                    } else {
                        d.innerHTML = `<p class="fp-first">${mark}${d.innerHTML}</p>`;
                    }
                    ans = d.innerHTML;
                }
                html += `<div class="fp-q"${hangStyle}><div class="fp-stem">${ans}</div></div>`;
            }
        });

        // ---------- 二维码 ----------
        // ★ 1.11.0：可选的「不单独成页」。
        //   开（opt.qrInline）：二维码作为正文流里最后一块（.fp-qr-inline）拼进 #fp-flow 内，
        //       分页器 collect() 遍历 flow.children 时把它当普通块处理 ——
        //       末页放得下就跟在题目后面，放不下就顺流推到下一页，天然实现「空位够就贴、不够就翻页」。
        //       ⚠️ 必须拼在关闭 #fp-flow 的 </div>【之前】，否则落在容器外，collect 收不到。
        //   关（默认）：独立 .fp-sheet 起新页，与旧版逐字节一致，拼在 #fp-flow 关闭之后（顶层）。
        //   图用大号尺寸（200px）仍会偏大、容易独占一页，故 inline 版收成 132px。
        if (opt.qrcode && opt.qrInline) {
            const pidI = getPaperId();
            if (pidI) {
                const urlI = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data='
                    + encodeURIComponent('https://www.fenbi.com/exercise/answercard/' + pidI);
                html += `<div class="fp-qr-inline">
<div class="fp-qr-t">扫一扫，对答案</div>
<div class="fp-qr-s">用粉笔 App 扫码，提交答案后可评分并查看解析</div>
<img src="${urlI}" alt="答案二维码" onerror="this.parentNode.style.display='none'"></div>`;
            }
        }

        html += `</div>`;

        // ---------- 二维码（独立成页） ----------
        if (opt.qrcode && !opt.qrInline) {
            const pid = getPaperId();
            if (pid) {
                const url = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data='
                    + encodeURIComponent('https://www.fenbi.com/exercise/answercard/' + pid);
                html += `<div class="fp-sheet fp-qr">
<div style="font-size:16px;font-weight:700;color:#2563eb;margin-bottom:8px">扫一扫，对答案</div>
<div style="font-size:12px;color:#666;margin-bottom:20px">用粉笔 App 扫码，提交答案后可评分并查看解析</div>
<img src="${url}" alt="答案二维码" onerror="this.parentNode.style.display='none'"></div>`;
            }
        }


        // ---------- 交互脚本 ----------
        const cd = Math.max(0, Math.round(opt.countdown));
        html += `
<script>
(function(){
  var PREVIEW = ${meta.preview ? 'true' : 'false'};
  var RATIO = ${opt.figScale} / 100;
  if (!(RATIO > 0 && RATIO <= 1)) RATIO = 0.65;
  // 预览模式下不自动关页面（iframe 里 window.close 本就无效，统一置 0 更稳）
  var CD = ${meta.preview ? 0 : cd};
  // 输出方式：'print' = 点「排版并打印」，'save' = 点「导出PDF」，'preview' = 调整预览（不打印）。
  // 传入而不是事后猜 —— afterprint 只告诉你对话框关了，猜不出用户在里面选的是
  // 打印机还是「另存为 PDF」。按钮是自己点的，这个意图只有面板那一侧才知道。
  var OUT = ${JSON.stringify(meta.preview ? 'preview' : (meta.output === 'save' ? 'save' : 'print'))};

  // ---- 行内公式图的尺寸出口（1.8.19 重写：等比缩放）--------------------------
  // ⚠️ 这份代码与外层 tagTexFracImg 是**同一套逻辑的两份拷贝**，必须同步改。
  //    看似重复，但两段分属不同文档、不同作用域（外层注入粉笔页面，这里跑在生成的试卷页里），
  //    函数不通用 —— 1.8.17 曾试图「只留一份」，结果外层调不到这里的函数，真机直接抛
  //    报错「applyTexSize is not defined」，试卷整个生成不出来。所以只能各存一份。
  //    改判定时**两处都要改**，行尾都标了「同步点」，可用编辑器搜索该词逐个核对。
  //
  // 前面几版（1.8.11~1.8.18）一直用「宽高比阈值」把公式图分成「分数档 / 符号档」，各给一套尺寸。
  // 那个模型是错的，它解释不了真机现象，而且越调越乱：
  //   20/43(3/2) 判成分数、29/43(15/2) 判成符号、37/43(-2/3) 又判成符号，
  //   于是一道题里三个分数三个大小。用户的描述是「分子分母只有一位数且没有负号的就正常」，
  //   完全对上 —— 因为能落进 20/43 这个比例的，恰好只有这一种情况。
  //
  // 粉笔原生是怎么做的？把它的公式图逐张下载来量，答案很干净：
  //   图片 URL 里写死 fontSize=18，所以**图片内部就是用 18px 字号渲染出来的**。
  //   粉笔的 CSS 只做一件事：**按原始像素 1:1 显示，不做任何缩放**。
  //   因为「图片内部字号」与「正文字号」本来就是同一个数，天然一样大 —— 根本不需要缩放逻辑。
  // 实测佐证（真机 22 张图去重后）：
  //   外框高 43 的 18 张（3/2、15/2、-2/3…）内部墨迹高 36~37 —— 两行构成，是分数；
  //   外框高 20~23 的 4 张（30°、△AOD…）内部墨迹高 14 —— 单行构成，是整式/符号。
  //   而正文 18px 汉字的墨迹高也正好约 14：**整式的墨迹与正文同高**，这就是「一样大」的由来。
  //   注意分数外框 43 与整式外框 20 差了两倍多，视觉上却一样大 ——
  //   因为分数那 43px 里装的是**两行**，每行还是 18px 字号。**外框高根本不是判断依据。**
  //
  // 所以正确的做法只有一条：**等比缩放，让「图片内部字号」等于「当前正文字号」**。
  //   缩放比 = 正文字号px / 18 → 显示尺寸 = 原始像素 × 该比值。
  //   用 em 表达后，正文一变大图片自动跟着变，无需监听字号变化。
  //   分数、整式、长公式、多位数分数全部自动正确 —— 不再需要任何「分档」「阈值」「特判」。
  //   粉笔原生 CSS 之所以不用缩放，只是因为它正文字号恰好也是 18。
  // ============================ 对齐规则（1.8.23 修正）============================
  // 需求：**图片的中线与文字的中线落在同一条水平线上**（分数上下各露出一半）。
  //
  // 1.8.22 的公式本身是对的，但它**一次都没跑起来**。真机 DOM 佐证：脚本写下的
  //   vertical-align 全是 -0.17em，正是当时的兜底常量 —— 说明正常路径全部落空。
  //
  // 根因：外层 tagTexFracImg 由 markTexFrac() 在**游离的 div** 上调用，
  //   此时 <img> 还没进文档、没有开始加载（实测游离节点 nw=0，500ms 后才 nw=20），
  //   而 1.8.22 开头那句「读不到 naturalWidth 就 return」直接跳过了整个函数，
  //   尺寸与对齐一个都没写。（真正的判断见外层 tagTexFracImg 的实现。）
  //   ⚠️ 本段代码位于外层模板串内，注释里**不能出现反引号**，否则会提前闭合模板串。
  //
  // 1.8.23 修法：**把「量不到」变成「量得到」**，公式不动。
  //   关键认知：算 va **根本不需要图片像素** ——
  //     va = 文字视觉中线/字号 − 图高(em)/2
  //   推导：设 va = V（em），图高 = H（em），则图中线在基线上方 (V + H/2)·fs。
  //         令其等于文字视觉中线 charMid，解出 V = charMid/fs − H/2。
  //   charMid 由 canvas 画「国」字量得、H 来自真实像素（本函数的入参 w/h），
  //   两者都不依赖「图里墨迹在哪」→ 调早了也算得准。
  //   （旧式 va = charMid/fs − H + inkMidEm 要求读图墨迹中线，两者数学等价，
  //     都是「让图中线落在文字中线上」，新式只是把对图片像素的依赖砍掉了。）
  //
  //   逐图算 va，不写死：3/2（20×43）与 15/2（29×43）比例不同、图高不同
  //   → va 必须不同（18px 下分别约 -0.685em 与 -0.351em），写死一个值必然有一类错位。
  //
  //   文字视觉中线**运行时用 canvas 实画一个「国」字量出来**，不写常数：
  //     实测「文字墨迹中线 / 字号」比值在 0.375~0.425 间浮动（±6%），
  //     写死常数必然在某段字号失准（实测 -0.80em 时 22px 起偏差涨到 +0.8~+1.5px）。
  //     用 canvas 实测则任何字号任何字体都准 —— 实测 16~40px 九个字号，偏差 ≤ 0.02px。
  //
  //   ⚠️ 别再退回「按底留白贴基线」（1.8.20 的做法）：那会把分数压到基线上，
  //      正是用户报的「分数比文字低一大截」。尺寸与对齐这两件事必须分开看。
  var TEX_BASE_PX = 18;      // 公式图 URL 里 fontSize 的固定值，等比缩放的基准 —— 同步点
  var TEX_REF_CHAR = '国';   // 度量参考字：全包围结构，墨迹范围最贴近汉字视觉中心 —— 同步点
  var TEX_CHAR_MID_REF = 0.39;  // canvas 量不到时的兜底「文字视觉中线÷字号」—— 同步点
  var texInkCache = Object.create(null);       // 图片墨迹缓存：同一张图不重复画 canvas
  var texCharMidCache = Object.create(null);   // 文字视觉中线缓存：按 字号+字体 缓存

  // 量出图片的「墨迹包围盒」——给出上下留白、墨迹高、以及**墨迹中线距图顶**。
  // 必须真读像素：粉笔导出的图没有统一的留白约定（实测 3~6px 不等），
  // 靠高度、宽高比、或者经验常数都推不出来。
  function measureTex(img){
    var key = img.src;
    if (key in texInkCache) return texInkCache[key];
    var res = null;
    try{
      var w = img.naturalWidth, h = img.naturalHeight;
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);   // 显式给目标宽高，按自然尺寸 1:1 采样
      var data = ctx.getImageData(0, 0, w, h).data;
      var top = -1, bottom = -1;
      for (var y = 0; y < h; y++){
        var has = false;
        for (var x = 0; x < w; x++){
          if (data[(y * w + x) * 4 + 3] > 24){ has = true; break; }
        }
        if (has){ if (top < 0) top = y; bottom = y; }
      }
      // 全透明图（坏图）不动它，免得算出荒唐的下沉量
      if (bottom >= 0){
        res = {
          padBottom: h - 1 - bottom,
          inkH: bottom - top + 1,
          inkMid: (top + bottom + 1) / 2   // 墨迹中线距**图顶**的距离（原始像素）
        };
      }
    }catch(e){
      // canvas 被跨域污染等情况：读不到就退回兜底值，不影响尺寸缩放
      res = null;
    }
    texInkCache[key] = res;
    return res;
  }

  // 量「文字视觉中线」在基线上方多少 px（当前字号、当前字体下）。
  // 做法：造一张 canvas，把一个「国」字按当前字号画上去，逐像素找出墨迹上下边界，
  //       再减去基线位置 —— 汉字墨迹上下不对称（实测「某」上 16px、下 1px），
  //       所以视觉中线在基线上方约 0.4 个字号高，而不是行盒中心。
  function measureCharMid(fontSize, fontFamily){
    var key = fontSize + '|' + fontFamily;
    if (key in texCharMidCache) return texCharMidCache[key];
    var res = null;
    try{
      var S = Math.ceil(fontSize * 4);          // 画布留足余量：4 倍字号
      var baseY = Math.ceil(fontSize * 2);      // 基线放在画布纵向中间偏下
      var cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      var ctx = cv.getContext('2d');
      ctx.font = fontSize + 'px ' + fontFamily;
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(TEX_REF_CHAR, fontSize, baseY);
      var data = ctx.getImageData(0, 0, S, S).data;
      var top = -1, bottom = -1;
      for (var y = 0; y < S; y++){
        var has = false;
        for (var x = 0; x < S; x++){
          if (data[(y * S + x) * 4 + 3] > 24){ has = true; break; }
        }
        if (has){ if (top < 0) top = y; bottom = y; }
      }
      if (bottom >= 0){
        // 基线上方为正：墨迹顶距基线 (baseY-top)，墨迹底在基线下 (bottom-baseY)
        res = ((baseY - top) - (bottom - baseY)) / 2;
      }
    }catch(e){ res = null; }
    texCharMidCache[key] = res;
    return res;
  }

  // 按当前字号与字体，算出应写入的 vertical-align（em 字符串）。
  // 两档精度：
  //   ① 能读到墨迹 → va = charMid/fs − 图高(em) + 墨迹中线距图顶(em)     精确
  //   ② 读不到墨迹 → va = charMid/fs − 图高(em)/2                        近似
  // 之所以要有 ②：**墨迹中线并不在图的正中**。实测五张真机图，墨迹中线距图顶与
  // 「图高/2」的差：3/2、15/2 是 −0.5px，−2/3、30° 是 0，**△AOD 是 −1.5px**
  // —— 直接用图高中点会让 △AOD 低 1.5px。所以能读像素时一定走 ①。
  // 本函数由 scaleFigures 在图片解码后调用，正常都能走 ①。
  function texAlignEm(img, imgHEm, ink){
    var fs = parseFloat(getComputedStyle(img).fontSize);
    if (!(fs > 0)) return null;
    var fam = getComputedStyle(img).fontFamily || 'serif';
    var charMid = measureCharMid(fs, fam);
    if (charMid === null) return null;
    var k = 1 / TEX_BASE_PX;
    var inkMidEm = ink ? (ink.inkMid * k) : (imgHEm / 2);
    var v = (charMid / fs) - imgHEm + inkMidEm;
    if (!isFinite(v)) return null;
    return v.toFixed(4) + 'em';
  }

  // 把一张公式图按「内部字号 = 正文字号」等比摆正。幂等：同一张图反复调用结果完全一样。
  // w / h 传入图片的真实像素；拿不到真实像素时**不要调用**，交给样式表兜底 —— 宁可暂时偏一点，也不能猜错。
  function applyTexSize(img, w, h){
    if (!(w > 0 && h > 0)) return;
    var U = 'important';
    var k = 1 / TEX_BASE_PX;   // 每 1px 原始像素对应 k 个「字号单位」—— 同步点
    var hEm = h * k;           // 图高（em），算 va 要用
    img.style.setProperty('aspect-ratio', 'auto', U);
    img.style.setProperty('max-width', 'none', U);
    img.style.setProperty('max-height', 'none', U);
    img.style.setProperty('object-fit', 'contain', U);
    // 用 em 表达：em 就是当前字号，正文一变大图片自动跟着等比放大
    img.style.setProperty('width', (w * k).toFixed(4) + 'em', U);
    img.style.setProperty('height', hEm.toFixed(4) + 'em', U);
    // ---- 摆正：让图的中线落在文字视觉中线上（读得到墨迹就用墨迹，否则按图高中点）----
    var ink = measureTex(img);
    var v = texAlignEm(img, hEm, ink);
    if (v !== null){
      img.style.setProperty('vertical-align', v, U);
    } else {
      // canvas 不可用等极端情况：用实测参考值兜底。
      // 绝不用「按底留白贴基线」—— 那会把分数压到基线上（1.8.20 的老毛病）。
      img.style.setProperty('vertical-align', (TEX_CHAR_MID_REF - hEm / 2).toFixed(4) + 'em', U);
    }
    // 这个类只为兼容旧样式表而保留，尺寸不再依赖它
    img.classList.remove('fp-tex-frac');
  }

  // 大图按比例缩小，小图不动；必须幂等，否则轮询会把图越缩越小
  function scaleFigures(){
    try{
      var list = document.querySelectorAll('.fp-fig img, .fp-mat img, .fp-stem img, .fp-opt img');
      for (var i = 0; i < list.length; i++){
        var img = list[i];
        // 先把宽高比钉死：CSS 里 height 是 auto，图片还没解码完时高度会算成 0，
        // 分页量出来的高度就偏小，等图片一到位又把内容顶出页面下沿。
        // 钉成内联样式的同时也记到属性上 —— 分页重切时克隆出来的是全新 img，
        // 还没解码、拿不到比例，得靠这个属性把比例补回去。
        // 行内公式图（flag="tex"）由 tagTexFracImg 用 em 锁死高度，这里绝不能再写 height:auto ——
        // scaleFigures 在 waitReady 里轮询执行（图片解码前会反复进来），一旦它把 auto 盖回去，
        // 公式图就退回粉笔原图像素（~43px 固定高、不随字号缩放），分数也随之错位。
        // 这正是 v1.8.13 真机仍「偏大 + 不跟字号 + 不对齐」的根因：识别对了，但尺寸被这里覆盖。
        // 另：图片「解码没完」时 naturalWidth 可能是中间值（见下面 flag="tex" 分支的详细说明），
        // 普通图同样不能拿它算比例 —— 统一用 complete 做闸门。
        var decoded = !!(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
        var isTexInline = img.getAttribute('flag') === 'tex';
        if (!isTexInline && decoded && !img.getAttribute('data-fp-ar')){
          img.style.setProperty('aspect-ratio', img.naturalWidth + ' / ' + img.naturalHeight, 'important');
          img.style.setProperty('height', 'auto', 'important');
          img.setAttribute('data-fp-ar', img.naturalWidth + '/' + img.naturalHeight);
        }
        // 行内公式图尺寸已由 tagTexFracImg 全权接管，缩放逻辑一律不碰（否则宽度被改成 px 后不再随字号走）
        if (isTexInline){
          // 关键补救：公式图在「提取阶段」往往还没解码完 —— 粉笔的图是懒加载的，抓 DOM 时
          // naturalWidth/naturalHeight 常还是 0，拿不到真实像素就没法按等比缩放摆正。
          // 这里在图片真正解码后（本函数由 waitReady 轮询调用）用真实像素补算。
          //
          // ⚠️ v1.8.17 修正过的病灶，这里继续守住：**不能相信 naturalWidth/naturalHeight 的第一次读数**。
          //   据真机证据（54 题第 2 个分数）脚本曾把 -2/3 读成 37/43 —— 高度 43 是对的，宽度多出
          //   17px。原因是浏览器把「渐进解码」和「延迟解码（loading=lazy）」的图当成 complete=true，
          //   此时 naturalWidth 先返回一个**中间值**，解码完成后才回落到真实宽度。
          //   旧代码会把中间值**永久固化**：① 写进 data-fp-ar 属性，下次进来发现「属性 == 当前读数」
          //   就判定已处理、直接跳过；② 更隐蔽的是 style.aspectRatio —— aspect-ratio 一旦有值就
          //   **参与固有尺寸计算**，naturalWidth 会被反过来钳到由它推算出的宽度上，自己把自己锁死。
          //   修法：每轮都按**当前**读数重算重设（applyTexSize 幂等，重复调用无副作用），
          //   data-fp-tex-ar 只作信息记录，**不作为「已处理」的依据** —— 读数一旦被纠正，
          //   下一轮样式自动跟上，不会被历史的错误读数绑架。
          if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0){
            applyTexSize(img, img.naturalWidth, img.naturalHeight);
            img.setAttribute('data-fp-tex-ar', img.naturalWidth + '/' + img.naturalHeight);
          }
          continue;
        }
        if (img.getAttribute('data-fp-scaled')) continue;
        var w = img.getBoundingClientRect().width;
        if (w && w > 150){
          img.style.setProperty('width', Math.round(w * RATIO) + 'px', 'important');
          img.setAttribute('data-fp-scaled', '1');
        }
      }
    }catch(e){}
  }
  // 图片加载失败要能立刻知道：坏图的 naturalWidth 一直是 0，
  // 没有 onerror 兜底的话，一张图就能把整个排版拖到超时
  function watchImages(){
    var imgs = document.images;
    for (var i = 0; i < imgs.length; i++){
      if (imgs[i].getAttribute('data-fp-w')) continue;
      imgs[i].setAttribute('data-fp-w', '1');
      imgs[i].addEventListener('error', function(){ this.setAttribute('data-fp-giveup', '1'); });
    }
  }
  function pending(){
    watchImages();
    var n = 0, imgs = document.images;
    for (var i = 0; i < imgs.length; i++){
      var im = imgs[i];
      if (im.getAttribute('data-fp-giveup')) continue;
      if (!im.complete){ n++; continue; }
      // complete 只说明字节到齐了，SVG 之类还得解码。没解码出来时
      // naturalWidth 是 0、高度也算成 0，这时候切页必然偏乐观。
      if (im.naturalWidth === 0){
        var w = parseInt(im.getAttribute('data-fp-wait') || '0', 10) + 1;
        im.setAttribute('data-fp-wait', w);
        // 等 8 轮（约 2 秒）还解不出来，按坏图处理，不再干等
        if (w > 8) im.setAttribute('data-fp-giveup', '1');
        else n++;
      }
    }
    return n;
  }

  /* ---------------- 真分页 ----------------
     页码不靠 @page 的 margin box —— 那东西只有打印时才画得出来，
     屏幕上完全看不到，也就没法在预览时确认版面。
     这里由脚本按 A4 内容区高度把正文切成一张张 .fp-page，
     页码是实打实写在页面上的文字：屏幕上所见即打印所得。 */
  var BODY_H = ${BODY_H};
  // 切页粒度由面板的「换页方式」决定（whole / smart / ultra）
  var MODE = ${JSON.stringify(opt.pagination || 'smart')};
  var SIG = ${JSON.stringify(opt.signature || '')};
  // 页眉文字（可选）。空串 = 不生成页眉节点，排版与旧版逐字节一致。
  // ★ 转义三重保险（1.8.27 曾因生成页脚本里出现字面「小于号+斜杠+script」
  //   被浏览器当场截断脚本块，整个分页逻辑没执行）：
  //   ① JSON.stringify 转义引号与反斜杠；
  //   ② 再把「<」拆成 \u003C，彻底杜绝生成页里出现能被 HTML 解析器识别的标签开头；
  //   ③ 赋值走 textContent（不是 innerHTML），标题里的标签不会被当元素渲染。
  var HEADER_TXT = ${JSON.stringify(opt.header ? String(opt.title || '') : '').replace(/</g, '\\u003C')};

  function mkPage(){
    var p = document.createElement('div');
    p.className = 'fp-page';
    var f = document.createElement('div'); f.className = 'fp-pfooter';
    var sg = document.createElement('span'); sg.className = 'fp-sig';
    var pg = document.createElement('span'); pg.className = 'fp-pg';
    var tg = document.createElement('span'); tg.className = 'fp-tag';
    sg.textContent = SIG;
    tg.textContent = '粉笔题库';
    f.appendChild(sg); f.appendChild(tg); f.appendChild(pg);
    // ★ 1.10.0 页眉（可选）必须排在正文之前，与页脚一道夹住正文。
    //   注意：一旦这里多出一个子项，页面的 firstChild 就不再是 .fp-pbody ——
    //   这正是 1.8.27 空白卷事故的根源，因此本版已把全文对 firstChild 的
    //   依赖全部换成 bodyOf()（见下方），任何新增 flex 项都不会再打乱取容器。
    if (HEADER_TXT) {
      var h = document.createElement('div'); h.className = 'fp-pheader';
      var ht = document.createElement('span'); ht.className = 'fp-htitle';
      ht.textContent = HEADER_TXT;
      h.appendChild(ht);
      p.appendChild(h);
    }
    var b = document.createElement('div'); b.className = 'fp-pbody';
    p.appendChild(b); p.appendChild(f);
    // 预挂正文容器引用：此后整条贴页流水线都走 bodyOf(p)，不再认 firstChild
    p.__fpBody = b;
    return p;
  }

  // ★ 1.10.0 前置安全改造（源自 1.8.27 空白卷事故复盘）
  //   取一页的正文容器。绝不使用 page.firstChild —— 它是个会随功能增减
  //   而漂移的指针：只要有人往 mkPage() 里加一个新 flex 项（页眉、水印…），
  //   所有依赖 firstChild 的写法都会静默地删错节点/量错高度，而且不报错。
  //   优先用 mkPage() 预挂的 __fpBody；克隆或其他来源的页面节点则按类名查。
  function bodyOf(pg){
    if (!pg) return null;
    var b = pg.__fpBody;
    // 缓存失效的情形：节点被克隆过（cloneNode 不带自有属性），或 __fpBody 已摘出文档
    if (b && b.parentNode === pg) return b;
    b = pg.querySelector('.fp-pbody');
    if (b) pg.__fpBody = b;
    return b;
  }

  // 这些标签本身不撑高度，只是把内容裹了一层。
  // 必须钻进去再拆 —— 不钻的话整个题干会变成一个巨大的原子：
  // 放不下就整块翻页（页尾空一大片），题干比一页还高时更直接顶出页面。
  var WRAP = /^(DIV|SECTION|ARTICLE|APP-FORMAT-HTML|BLOCKQUOTE|CENTER)$/;

  // 把连续流拆成「原子」——能整段搬走的最小单位
  function collect(flow){
    var out = [], qid = 0, mid = 0, i, j, k;

    function push(node, meta){
      if (!node) return;
      out.push({ node: node, qid: meta.qid || 0, slot: meta.slot,
                 fig: meta.fig, grid: meta.grid, mid: meta.mid, own: meta.own,
                 hang: meta.hang, ohang: meta.ohang });
    }
    // 容器上是否直接挂着文字（不是包在子元素里的那种）。
    // 粉笔的题干/材料大量是「<div>……最恰当的一项是：<span>____</span>。</div>」
    // 这种混排结构：文字直接挂在容器上，行内元素夹在中间。
    function hasDirectText(node){
      var ns = node.childNodes;
      for (var i = 0; i < ns.length; i++){
        var n = ns[i];
        // 纯缩进换行的空白不算内容
        if (n.nodeType === 3 && n.textContent.replace(/[\s\u3000]/g, '').length) return true;
      }
      return false;
    }

    function drill(node, meta, depth){
      if (depth > 6){ push(node, meta); return; }
      var kids = node.children;
      // 只有「纯容器」才往下钻：里面掺了表格/图片这类不能拆的东西就整块收下
      // 1.8.9：含 img 的纯容器（粉笔题干外的 <div _ngcontent> 常把「文字 p + 图片 p」裹在一起）
      // 也要往下钻，让文字段与图片段各自成独立原子 —— 否则图文焊成同一块，
      // 页尾放不下就整题（含能留下的文字）一起翻页（见现象：图文题跟图走）。
      // 仍排除 table/svg/canvas（这些硬块不能拆）；行内 img 的 <p> 自己不是 WRAP，会整段保留，不影响。
      if (kids.length && WRAP.test(node.tagName) && !node.querySelector('table,svg,canvas')){
        // 混排容器（文字与行内元素夹在一起）不能再往下钻 ——
        // 只递归元素子节点的话，挂在容器上的那截文字会被整个丢掉；
        // 拆成「文本块 + 元素块」也不行，会打断行内流，把一句话劈成两行。
        // 整块收下最保真，代价只是这一块不能跨页续排。
        if (hasDirectText(node)){ push(node, meta); return; }
        for (var t = 0; t < kids.length; t++) drill(kids[t], meta, depth + 1);
        return;
      }
      push(node, meta);
    }

    // 材料内容按「段落 / 表格」拆成独立原子：纯文本段落各自成块可续页，
    // 含图/表的节点整体保留，避免整段材料被当成一个巨块顶到下一页、留下大段留白。
    function collectMat(node, meta){
      if (!node || !node.children) return;
      if (node.tagName === 'P' || node.tagName === 'TABLE' || node.tagName === 'IMG'){
        push(node, meta); return;
      }
      // 表格本身不能拆，但表格前后的段落必须独立成原子。
      // 旧逻辑「整块含表格就整体保留」会把「长段落 + 表格」粘成一个上千像素的巨块：
      // 页尾放不下时整块翻页留一大片空白，巨块被硬塞进空白页又顶出页面，
      // 分页器为了救它收紧页高，结果全篇每一页都被压矮、留下十几行空白。
      var kids = node.children;
      // 兜底一：材料正文常常不是 <p>，而是直接包在 div.content / .material-content 里。
      // 这种「只有文本、没有元素子节点」的叶子容器必须整块收下 ——
      // 少了这一步，递归到最内层时一个原子都不产生，整段材料会在分页环节凭空消失。
      // 兜底二：文字与子元素混排的容器（<div>说明文字<p>段落</p></div>）同样整块收下，
      // 否则只递归元素子节点，容器上那截说明文字就没了。
      if (!kids.length || hasDirectText(node)){ push(node, meta); return; }
      for (var c = 0; c < kids.length; c++) collectMat(kids[c], meta);
    }

    for (i = 0; i < flow.children.length; i++){
      var top = flow.children[i];
      if (top.classList.contains('fp-mat')){
        mid++;
        for (j = 0; j < top.children.length; j++){
          var mel = top.children[j];
          if (mel.tagName === 'H3' || (mel.classList && mel.classList.contains('fp-mat-h'))){
            // 材料标题单独成块，但和紧跟的正文同块，避免标题孤悬在页尾留白
            push(mel, { qid: 0, slot: 'mat-head', mid: mid, own: top });
          } else {
            // 材料内容按段落/表格拆成原子，让段落能续页填满页尾，消除大段留白
            collectMat(mel, { qid: 0, slot: 'mat', mid: mid, own: top });
          }
        }
      } else if (top.classList.contains('fp-q')){
        qid++;
        var fig = top.classList.contains('fp-fig');
        // 每题各自的悬挂列宽（--hang/--ohang）是 buildHtml 按题号算好写在内联 style 上的，
        // 但 place() 重建 .fp-q 外壳时不会复制 style，必须把值记到每个原子上，
        // 重建时再写回，否则逐题缩进会在分页环节丢掉、退回兜底值。
        var qh = (top.style.getPropertyValue('--hang') || '').trim();
        var qo = (top.style.getPropertyValue('--ohang') || qh).trim();
        var qMeta = { qid: qid, fig: fig, own: top, hang: qh, ohang: qo };
        for (j = 0; j < top.children.length; j++){
          var e = top.children[j];
          if (e.classList.contains('fp-stem')){
            for (k = 0; k < e.children.length; k++)
              drill(e.children[k], Object.assign({}, qMeta, { slot: 'stem' }), 0);
          } else if (e.classList.contains('fp-opts')){
            var g = (e.className.match(/grid-\\d/) || ['grid-4'])[0];
            for (var m = 0; m < e.children.length; m++)
              push(e.children[m], Object.assign({}, qMeta, { slot: 'opt', grid: g }));
          } else if (e.classList.contains('fp-space')){
            push(e, Object.assign({}, qMeta, { slot: 'space' }));
          } else {
            drill(e, Object.assign({}, qMeta, { slot: 'stem' }), 0);
          }
        }
      } else {
        push(top, { qid: 0, slot: 'top', own: null });
      }
    }
    return out;
  }

  // 原子搬进页面，顺手在需要时重建 .fp-q / .fp-stem / .fp-opts / .fp-mat 外壳：
  // 一道题被拆到两页上时，两边各自仍是完整结构，悬挂缩进、列宽、材料框都不会散。
  function place(body, a, st){
    var host = body;
    if (a.slot === 'mat' || a.slot === 'mat-head'){
      if (!st.mat || st.mat.parentNode !== body || st.mid !== a.mid){
        st.mat = document.createElement('div');
        st.mat.className = 'fp-mat';
        st.mat.setAttribute('data-fp-mid', 'm' + a.mid);
        body.appendChild(st.mat);
        st.mid = a.mid;
      }
      host = st.mat;
    } else if (a.qid){
      if (st.qid !== a.qid || !st.q || st.q.parentNode !== body){
        st.q = document.createElement('div');
        st.q.className = 'fp-q' + (a.fig ? ' fp-fig' : '');
        // 记下这壳属于哪道题：装完页后要靠它判断「这壳后面还有没有同一道题的续排」
        // （见 markSplitShells）。用 data 属性而不是另立账本，好处是 unplace
        // 摘掉节点后账本天然跟着变，不会留下幽灵记录。
        st.q.setAttribute('data-fp-qid', 'q' + a.qid);
        // 把该题算好的悬挂列宽写回重建后的外壳，否则 .fp-stem/.fp-num/.fp-opts
        // 收不到自定义变量，逐题缩进会退回 CSS 兜底值
        if (a.hang) st.q.style.setProperty('--hang', a.hang);
        if (a.ohang) st.q.style.setProperty('--ohang', a.ohang);
        body.appendChild(st.q);
        st.qid = a.qid; st.stem = null; st.opts = nul