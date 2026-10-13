// ==UserScript==
// @name         学习通自动答题助手 Next
// @namespace    https://github.com/Lithum-12/chaoxing-answer-helper
// @version      6.0.0
// @description  抓取学习通作业 / 考试 / 章节测验题目，调用多家 AI 大模型自动作答。支持按题型选模型、逐题 / 会话 / 整卷批量模式、font-cxsecret 字体反爬解码、答题记录导入导出与 Token 用量统计，配可拖动悬浮工具球与实时日志。
// @homepageURL  https://github.com/Lithum-12/chaoxing-answer-helper
// @supportURL   https://github.com/Lithum-12/chaoxing-answer-helper/issues
// @updateURL    https://cdn.jsdelivr.net/gh/Lithum-12/chaoxing-answer-helper@main/chaoxing-answer.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/Lithum-12/chaoxing-answer-helper@main/chaoxing-answer.user.js
// @match        *://*.chaoxing.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_openInTab
// @connect      api.deepseek.com
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      dashscope.aliyuncs.com
// @connect      open.bigmodel.cn
// @connect      api.moonshot.cn
// @connect      api.minimax.chat
// @connect      cdn.jsdelivr.net
// @inject-into  page
// @noframes
// @run-at       document-body
// @license      MIT
// ==/UserScript==

(function() {
    "use strict";

    /* 防止同一页面多次加载 */
    if (document.documentElement.getAttribute("data-cx-helper-loaded")) return;
    document.documentElement.setAttribute("data-cx-helper-loaded", "1");

    console.log("[学习通助手] 脚本开始加载");



    /* 脚本版本号：每次改动在此递增，并在 @version 头同步 */
    var VERSION = "6.0.0";

    var DELAY_MS = parseInt(GM_getValue("cx_delay", 1500), 10);
    var MAX_TOKENS = parseInt(GM_getValue("cx_maxtokens", 2048), 10);
    var TEMP = parseFloat(GM_getValue("cx_temp", 0.3));
    /* 答题模式：independent(逐题独立) | session(累积会话) | batch(整卷批量) */
    var SESSION_MODE = GM_getValue("cx_session_mode", "independent");
    var SESSION_MODEL = GM_getValue("cx_session_model", "deepseek-chat");
    /* 整卷批量：即使一次拿到全部答案，也按答题间隔逐题填写（默认开，模拟人工、避免瞬间填完） */
    var BATCH_STAGGER = GM_getValue("cx_batch_stagger", true) !== false;
    var SESSION = { messages: null };
    var isRunning = false;
    var answeredCount = 0;
    var totalQuestions = 0;
    var currentRequest = null;
    var panel = null;

    /* 所有供应商配置 */
    var PROVIDER_CONFIG = {
        "deepseek": { name: "DeepSeek", base: "https://api.deepseek.com/v1" },
        "openai":   { name: "OpenAI", base: "https://api.openai.com/v1" },
        "anthropic":{ name: "Anthropic", base: "https://api.anthropic.com/v1" },
        "google":   { name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta" },
        "qwen":     { name: "通义千问", base: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
        "zhipu":    { name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4" },
        "moonshot": { name: "月之暗面", base: "https://api.moonshot.cn/v1" },
        "minimax":  { name: "MiniMax", base: "https://api.minimax.chat/v1" }
    };
    /* 模型 → 供应商映射（2026-10 更新；ID 以聚合网关实际支持为准） */
    var MODEL_PROVIDER_MAP = {
        /* DeepSeek */
        "deepseek-chat":"deepseek","deepseek-reasoner":"deepseek","deepseek-v3.2":"deepseek","deepseek-v4-pro":"deepseek","deepseek-v4-flash":"deepseek","deepseek-v41-flash":"deepseek",
        /* OpenAI GPT（5.5 及以上） */
        "gpt-5.5":"openai","gpt-5.5-pro":"openai","gpt-5.6-sol":"openai","gpt-5.6-luna":"openai","gpt-6-sol":"openai","gpt-6-luna":"openai","gpt-6-astra":"openai","gpt-6.1-sol":"openai",
        /* Anthropic Claude（4.5 及以上，含 Fable 系列） */
        "claude-sonnet-4-5":"anthropic","claude-opus-4-5":"anthropic","claude-haiku-4-5":"anthropic","claude-sonnet-4-6":"anthropic","claude-opus-4-6":"anthropic","claude-opus-5":"anthropic","claude-opus-5-1":"anthropic","claude-sonnet-5":"anthropic","claude-sonnet-5-5":"anthropic","claude-haiku-5-5":"anthropic","claude-opus-5-5":"anthropic","claude-fable-5":"anthropic","claude-fable-5-1":"anthropic",
        /* Google Gemini */
        "gemini-2.5-pro":"google","gemini-2.5-flash":"google","gemini-3.1-pro-preview":"google","gemini-3.5-flash":"google","gemini-3.6-flash":"google","gemini-3.7-flash":"google","gemini-3.8-flash":"google",
        /* 通义千问 Qwen（含 3.6 / 3.7 / 3.8 系列 + flash） */
        "qwen3.6-plus":"qwen","qwen3.6-flash":"qwen","qwen3.7-max":"qwen","qwen3.7-plus":"qwen","qwen3.7-flash":"qwen","qwen3.8-max":"qwen","qwen3.8-flash":"qwen","qwen-plus":"qwen","qwen-max":"qwen","qwen-turbo":"qwen","qwen-flash":"qwen",
        /* 智谱 GLM */
        "glm-4.5":"zhipu","glm-4.6":"zhipu","glm-5":"zhipu","glm-5.2":"zhipu","glm-5.3":"zhipu","glm-5.3-flash":"zhipu",
        /* 月之暗面 Kimi / Moonshot */
        "kimi-k2.5":"moonshot","kimi-k2.6":"moonshot","kimi-k2.8-preview":"moonshot","kimi-k3":"moonshot",
        /* MiniMax */
        "MiniMax-M2.5":"minimax","MiniMax-M2.7":"minimax","MiniMax-M3":"minimax","MiniMax-M3.1-preview":"minimax"
    };
    /* 供应商 ID 列表（按展示顺序） */
    var PROVIDER_ORDER = ["deepseek","openai","anthropic","google","qwen","zhipu","moonshot","minimax"];

    /* 按题型模型配置 */
    var MODEL_LIST = Object.keys(MODEL_PROVIDER_MAP);
    var TYPE_MODELS = {};
    function loadTypeModels() {
        var types = ["单选题","多选题","判断题","填空题","简答题"];
        types.forEach(function(t) {
            TYPE_MODELS[t] = GM_getValue("model_type_" + t, "deepseek-chat");
        });
    }
    loadTypeModels();

    /* 题目存储 */
    var _currentCourse = "";
    var _currentAssignment = "";
    function detectCourseInfo() {
        /* 课程名 — 从页面标题提取最可靠 */
        var title = document.title;
        var course = "", assign = "";

        /* 标题优先：尝试多种格式 */
        /* 格式1: 《课程名》作业名 */
        var m1 = title.match(/[《]([^》]+)[》]\s*(.+)/);
        if (m1) { course = m1[1].trim(); assign = m1[2].trim(); }
        /* 格式2: 课程名-作业名-学习通 或 课程名_作业名 */
        if (!course) {
            var parts = title.split(/[-—_―]/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
            if (parts.length >= 2 && parts[parts.length-1] !== "学习通" && parts[parts.length-1] !== "超星") {
                /* 最后一个是非平台名的部分可能是作业；第一个是课程 */
                var last = parts[parts.length-1];
                if (last === "学习通" || last === "超星") parts.pop();
                if (parts.length >= 2) {
                    course = parts[0];
                    assign = parts.slice(1).join(" - ");
                } else if (parts.length === 1) {
                    assign = parts[0];
                }
            } else {
                assign = title;
            }
        }
        /* 格式3: 纯作业名（无课程） */
        if (!course) {
            /* 尝试从页面 DOM 找课程名 */
            var cEl = document.querySelector(".courseName, .course-name, .courseTitle, .course-title, .crumb-1, .breadcrumb li:first-child a, .breadcrumb li:first-child, .nav-item.active, .cur, .main-title, .top-title, .head-title, [class*=course_], [class*=course-], .course_info .name, .teach-title, .class-name, .className, .course .name, .curriculum, .cla-name, .clazz-name");
            if (cEl) course = cEl.textContent.trim();
        }
        if (!course) {
            /* URL courseId 匹配页面脚本 */
            var cid = (location.search.match(/[?&]courseId[=:](\d+)/) || [])[1];
            if (cid) {
                var allScripts = document.querySelectorAll("script");
                for (var si = 0; si < allScripts.length; si++) {
                    var sc = allScripts[si].textContent;
                    var mc = sc.match(/course[Name\s]*[:=]\s*["']([^"']+)["']/i);
                    if (mc && sc.indexOf(cid) > -1) { course = mc[1]; break; }
                }
            }
        }
        if (!course) course = GM_getValue("cx_last_course", "");

        /* 作业名：如果标题没提取到，从 DOM 提取 */
        if (!assign) {
            var aEl = document.querySelector(".Zy_TItle, .title, .paperTitle, .assignmentName, .testName, .examName, .crumb-2, .breadcrumb li:last-child, .breadcrumb li:last-child a, .prompt, .mark_name, .colorShallow, h1, h2, h3");
            if (aEl) {
                var t = aEl.textContent.trim();
                /* 排除长度过长的（可能是题目文本） */
                if (t.length < 60) assign = t;
            }
        }
        if (!assign) assign = title.replace(/[《》]/g, "").trim();

        _currentCourse = course;
        _currentAssignment = assign || "未命名作业";
        if (course) GM_setValue("cx_last_course", course);
        log("检测到课程: " + (_currentCourse || "未识别") + " / 作业: " + _currentAssignment);
    }

    function saveAnsweredQuestion(qData, answer, model) {
        var list = GM_getValue("saved_questions", []);
        list.push({
            time: new Date().toLocaleString(),
            course: _currentCourse,
            assignment: _currentAssignment,
            question: qData.question,
            options: qData.options,
            type: qData.question_type,
            images: qData.images.length,
            answer: answer,
            model: model
        });
        if (list.length > 500) list = list.slice(-500);
        GM_setValue("saved_questions", list);
    }
    function getSavedQuestions() {
        return GM_getValue("saved_questions", []);
    }

    /* ===== 注入样式 ===== */
    function injectStyles() {
        var style = document.createElement("style");
        style.textContent = [
            /* 设计令牌 · 原插件蓝灰配色（弹窗用） */
            "#cx-launcher,#cx-stats-modal{--cx-brand:#58a6ff;--cx-brand-t:#7cb8f0;--cx-brand-rgb:88,166,255;--cx-alt:#3fb950;--cx-alt-t:#56d364;--cx-alt-rgb:63,185,80;--cx-pop:#f85149;--cx-pop-t:#ff7b72;--cx-pop-rgb:248,81,73;--cx-purple:#bc8cff;--cx-gold:#d29922;--cx-panel:#0d1117;--cx-panel-2:#161b22;--cx-panel-deep:#161b22;--cx-ink:#e6edf3;--cx-ink-2:#8b949e;--cx-mut:#8b949e;--cx-line:#30363d;--cx-line-soft:#21262d;--cx-brand-tint:rgba(88,166,255,.12);--cx-brand-line:rgba(88,166,255,.4);--cx-alt-tint:rgba(63,185,80,.12);--cx-alt-line:rgba(63,185,80,.4);--cx-r:10px;--cx-r-sm:8px;--cx-r-xs:6px;--cx-sans:-apple-system,'PingFang SC','Microsoft YaHei',system-ui,sans-serif;--cx-serif:var(--cx-sans);--cx-mono:var(--cx-sans);}",
            /* 悬浮按钮 · 向下整块弹出 */
            "#cx-launcher{position:fixed;top:80px;right:20px;z-index:999999;color-scheme:light;font-family:var(--cx-sans);display:block;}",
            "#cx-launcher *{box-sizing:border-box;margin:0;}",
            "#cx-fab{width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#4A90D9,#357ABD);color:#fff;display:flex;align-items:center;justify-content:center;cursor:grab;box-shadow:0 6px 18px rgba(53,122,189,.4);position:relative;user-select:none;flex-shrink:0;transition:transform .18s;}",
            "#cx-fab:hover{transform:translateY(-2px);}",
            "#cx-fab:active{cursor:grabbing;}",
            "#cx-fab-ico{display:flex;}",
            "#cx-fab-ico svg{width:26px;height:26px;display:block;}",
            "#cx-badge{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#e74c3c;color:#fff;font-size:11px;line-height:20px;text-align:center;font-weight:700;box-shadow:0 0 0 2px #fff;}",
            "#cx-dot{position:absolute;bottom:2px;right:2px;width:12px;height:12px;border-radius:50%;background:#ffc107;border:2px solid #fff;}",
            "#cx-dot.ok{background:#28a745;}#cx-dot.warn{background:#ffc107;}#cx-dot.err{background:#e74c3c;}",
            "#cx-launcher.running #cx-dot{animation:cx-pulse 1.6s infinite;}",
            "@keyframes cx-pulse{0%{box-shadow:0 0 0 0 rgba(74,144,217,.5)}70%{box-shadow:0 0 0 8px rgba(74,144,217,0)}100%{box-shadow:0 0 0 0 rgba(74,144,217,0)}}",
            "#cx-menu{display:none;position:absolute;right:0;top:calc(100% + 8px);width:218px;background:#fff;border:1px solid #e6eaf0;border-radius:14px;box-shadow:0 14px 38px rgba(20,40,70,.18);padding:8px;color:#334;}",
            "#cx-menu::before{content:'';position:absolute;left:0;right:0;top:-10px;height:10px;}",
            "#cx-launcher.up #cx-menu::before{top:auto;bottom:-10px;}",
            "#cx-launcher.up #cx-menu{top:auto;bottom:calc(100% + 8px);}",
            "#cx-launcher.open #cx-menu,#cx-launcher.pinned #cx-menu{display:block;animation:cx-menu-in .16s ease;}",
            "#cx-launcher.up #cx-menu{animation-name:cx-menu-in-up;}",
            "@keyframes cx-menu-in-up{from{opacity:0;transform:translateY(6px)}}",
            "@keyframes cx-menu-in{from{opacity:0;transform:translateY(-6px)}}",
            "#cx-menu .m-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px 8px;margin-bottom:4px;border-bottom:1px solid #eef1f5;}",
            "#cx-menu .m-title{font-size:12.5px;font-weight:700;color:#2b3440;letter-spacing:.02em;}",
            "#cx-menu .m-prog{font-size:11px;color:#8a94a6;font-variant-numeric:tabular-nums;}",
            "#cx-status{display:block;padding:2px 8px 8px;font-size:11.5px;font-weight:600;color:#856404;}#cx-status.ok{color:#155724;}#cx-status.warn{color:#856404;}#cx-status.err{color:#721c24;}",
            ".cx-btn{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:#3a4250;border-radius:10px;padding:7px 8px;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;margin-bottom:2px;}",
            ".cx-btn:last-child{margin-bottom:0;}",
            ".cx-btn .b-ico{width:30px;height:30px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#eef3f9;color:#4A90D9;border:1px solid #e2e9f2;transition:.15s;}",
            ".cx-btn .b-ico svg{width:16px;height:16px;display:block;}",
            ".cx-btn:hover{background:#f2f6fb;border-color:#e2e9f2;}",
            ".cx-btn:hover .b-ico{background:#4A90D9;color:#fff;border-color:#4A90D9;}",
            ".cx-btn:active{transform:scale(.99);}",
            ".cx-btn:disabled{opacity:.45;cursor:not-allowed;}",
            ".cx-btn:disabled:hover{background:transparent;border-color:transparent;}",
            ".cx-btn:disabled:hover .b-ico{background:#eef3f9;color:#4A90D9;border-color:#e2e9f2;}",
            ".cx-btn.primary{color:#2b6cb0;}",
            ".cx-btn.primary .b-ico{background:#4A90D9;color:#fff;border-color:#4A90D9;}",
            ".cx-btn.primary:hover .b-ico{background:#357ABD;border-color:#357ABD;}",
            ".cx-btn.danger{color:#c0392b;}",
            ".cx-btn.danger .b-ico{background:#fdeceb;color:#e74c3c;border-color:#f6d7d4;}",
            ".cx-btn.danger:hover:not(:disabled){background:#fdf3f2;border-color:#f6d7d4;}",
            ".cx-btn.danger:hover:not(:disabled) .b-ico{background:#e74c3c;color:#fff;border-color:#e74c3c;}",
            "#cx-logbox{position:fixed;bottom:20px;right:20px;z-index:999998;width:320px;max-height:42vh;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:var(--cx-sans);color-scheme:dark;display:none;flex-direction:column;overflow:hidden;}",
            "#cx-logbox.show{display:flex;}",
            "#cx-logbox .lb-hd{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#161b22;border-bottom:1px solid #21262d;font-size:13px;font-weight:700;}",
            "#cx-logbox .lb-close{cursor:pointer;color:#8b949e;font-size:18px;line-height:1;padding:0 2px;}",
            "#cx-logbox .lb-close:hover{color:#f85149;}",
            "#cx-logbox .lb-bd{padding:8px 12px;overflow-y:auto;font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:1.6;}",
            "#cx-logbox .lb-bd div{padding:2px 0;border-bottom:1px solid rgba(33,38,45,.5);word-break:break-all;}",
            "#cx-logbox .lb-bd .lb-time{color:#8b949e;margin-right:6px;}",
            ".cx-highlight{outline:2px solid #4A90D9 !important;outline-offset:2px;}",
            ".cx-done{outline:2px solid #28a745 !important;outline-offset:2px;}",
            "#cx-tip{position:fixed;z-index:2147483647;max-width:260px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:7px 10px;font-size:12px;line-height:1.6;box-shadow:0 6px 20px rgba(0,0,0,.45);pointer-events:none;opacity:0;transition:opacity .12s;white-space:normal;color-scheme:dark;}",
            "#cx-tip.show{opacity:1;}",
            "#cx-tip .tp-t{font-weight:700;margin-bottom:2px;}",
            "#cx-tip .tp-r{display:flex;justify-content:space-between;gap:14px;}",
            "#cx-tip .tp-r span:last-child{color:#8b949e;font-variant-numeric:tabular-nums;}",
        ].join(" ");
        document.head.appendChild(style);
    }

    /* ===== 工具函数 ===== */
    var LOG_BUFFER = [];
    var LOGBOX_DISABLED = (function(){ try { return GM_getValue("cx_logbox_disabled", false) === true; } catch(e){ return false; } })();
    function makeLogLine(t, plain) {
        var line = document.createElement("div");
        line.innerHTML = '<span class="lb-time">[' + t + ']</span>';
        line.appendChild(document.createTextNode(plain));
        return line;
    }
    /* 统一自绘浮窗：ⓘ 注释与图表 hover 共用 */
    function showTip(html, x, y) {
        var tip = document.getElementById("cx-tip");
        if (!tip) { tip = document.createElement("div"); tip.id = "cx-tip"; document.body.appendChild(tip); }
        tip.innerHTML = html;
        tip.classList.add("show");
        var r = tip.getBoundingClientRect();
        var left = x + 14, top = y + 16;
        if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
        if (top + r.height > window.innerHeight - 8) top = y - r.height - 12;
        tip.style.left = Math.max(8, left) + "px";
        tip.style.top = Math.max(8, top) + "px";
    }
    function hideTip() { var tip = document.getElementById("cx-tip"); if (tip) tip.classList.remove("show"); }
    function log(msg) {
        var plain = String(msg).replace(/<[^>]+>/g, "");
        var t = new Date().toLocaleTimeString();
        console.log("[学习通助手] " + plain);
        var fab = document.getElementById("cx-fab");
        if (fab) fab.setAttribute("title", "学习通答题助手 [" + t + "] " + plain);
        LOG_BUFFER.push({ t: t, m: plain });
        if (LOG_BUFFER.length > 300) LOG_BUFFER.shift();
        /* 右下角浮窗 */
        var box = document.getElementById("cx-logbox");
        if (box && !LOGBOX_DISABLED) {
            var bd = box.querySelector(".lb-bd");
            bd.appendChild(makeLogLine(t, plain));
            while (bd.children.length > 300) bd.removeChild(bd.firstChild);
            box.classList.add("show");
            bd.scrollTop = bd.scrollHeight;
        }
        /* 控制台标签页 */
        var cb = document.getElementById("cx-console-bd");
        if (cb) {
            cb.appendChild(makeLogLine(t, plain));
            while (cb.children.length > 300) cb.removeChild(cb.firstChild);
            cb.scrollTop = cb.scrollHeight;
        }
    }

    function setStatus(text, type) {
        type = type || "warn";
        var s = document.getElementById("cx-status");
        if (s) { s.textContent = text; s.className = type; }
        var dot = document.getElementById("cx-dot");
        if (dot) dot.className = type;
    }

    function updateProgress() {
        var el = document.getElementById("cx-progress");
        if (el) el.textContent = answeredCount + " / " + totalQuestions;
        var b = document.getElementById("cx-badge");
        if (b) b.textContent = answeredCount + "/" + totalQuestions;
    }

    /* ===== Token 用量统计 ===== */
    function getUsage() {
        var d = GM_getValue("cx_usage_data");
        return d || { prompt:0, completion:0, questions:0, sessions:0, total_questions:0 };
    }
    function saveUsage(p, c) {
        var d = getUsage();
        d.prompt = (d.prompt || 0) + p;
        d.completion = (d.completion || 0) + c;
        d.questions = (d.questions || 0) + 1;
        d.total_questions = (d.total_questions || 0) + 1;
        d.last_time = Date.now();
        GM_setValue("cx_usage_data", d);
    }
    function saveModelUsage(model, p, c) {
        var mu = GM_getValue("model_usage", {});
        if (!mu[model]) mu[model] = { prompt:0, completion:0 };
        mu[model].prompt += p;
        mu[model].completion += c;
        GM_setValue("model_usage", mu);
    }
    function saveUsageLog(model, p, c) {
        var logs = GM_getValue("usage_logs", []);
        logs.push({ time: Date.now(), prompt: p, completion: c, model: model });
        if (logs.length > 200) logs = logs.slice(-200);
        GM_setValue("usage_logs", logs);
    }
    function resetUsage() {
        var d = getUsage();
        d.sessions = (d.sessions || 0) + 1;
        d.prompt = 0;
        d.completion = 0;
        d.questions = 0;
        d.last_time = Date.now();
        GM_setValue("cx_usage_data", d);
    }
    function formatTime(ts) {
        if (!ts) return "暂无";
        var d = new Date(ts);
        return d.toLocaleString();
    }

/* ===== 悬浮按钮创建 ===== */
    function createPanel() {
        if (document.getElementById("cx-launcher")) return;

        panel = document.createElement("div");
        panel.id = "cx-launcher";
        panel.innerHTML =
            '<div id="cx-fab" title="学习通答题助手">' +
                '<span id="cx-fab-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2.5 9 2.5 12 0v-5"/></svg></span>' +
                '<span id="cx-badge">0/0</span>' +
                '<span id="cx-dot" class="warn"></span>' +
            '</div>' +
            '<div id="cx-menu">' +
                '<div class="m-hd"><span class="m-title">答题助手 Next</span><span class="m-prog" id="cx-progress">0 / 0</span></div>' +
                '<div id="cx-status" class="warn">就绪</div>' +
                '<button id="cx-start" class="cx-btn primary" title="开始答题"><span class="b-ico"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span>开始答题</span></button>' +
                '<button id="cx-stop" class="cx-btn danger" disabled title="停止答题"><span class="b-ico"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg></span><span>停止</span></button>' +
                '<button id="cx-debug" class="cx-btn" title="调试题目识别"><span class="b-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg></span><span>调试</span></button>' +
                '<button id="cx-stats" class="cx-btn" title="设置 / 统计"><span class="b-ico"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94a7 7 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.74 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7 7 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96a7 7 0 0 0 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg></span><span>更多 / 设置</span></button>' +
            '</div>';

        document.body.appendChild(panel);
        console.log("[学习通助手] 悬浮按钮已添加");

        /* 右下角实时日志浮窗 */
        if (!document.getElementById("cx-logbox")) {
            var lb = document.createElement("div");
            lb.id = "cx-logbox";
            lb.innerHTML =
                '<div class="lb-hd"><span>运行日志</span><span class="lb-close" id="cx-lb-close" title="关闭">&times;</span></div>' +
                '<div class="lb-bd"></div>';
            document.body.appendChild(lb);
            lb.querySelector("#cx-lb-close").onclick = function() { lb.classList.remove("show"); };
        }

        /* 恢复保存的位置（right/top 锚定，展开时按钮不跳动） */
        var saved = GM_getValue("cx_launcher_pos", null);
        if (saved && saved.top != null) {
            panel.style.right = saved.right + "px";
            panel.style.top = saved.top + "px";
            panel.style.left = "auto";
        }

        document.getElementById("cx-start").onclick = startAnswering;
        document.getElementById("cx-stop").onclick = stopAnswering;
        document.getElementById("cx-debug").onclick = debugQuestions;
        document.getElementById("cx-stats").onclick = openStatsPage;

        /* ===== 拖拽（圆形按钮为手柄）；未移动则点击钉住展开 ===== */
        (function() {
            var fab = document.getElementById("cx-fab");
            fab.addEventListener("mousedown", function(e) {
                var moved = false, startX = e.clientX, startY = e.clientY;
                var rect = panel.getBoundingClientRect();
                var startRight = window.innerWidth - rect.right;
                var startTop = rect.top;
                function onMove(ev) {
                    var dx = ev.clientX - startX, dy = ev.clientY - startY;
                    if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
                    if (!moved) return;
                    var nr = Math.max(0, Math.min(window.innerWidth - 60, startRight - dx));
                    var nt = Math.max(0, Math.min(window.innerHeight - 60, startTop + dy));
                    panel.style.right = nr + "px";
                    panel.style.top = nt + "px";
                    panel.style.left = "auto";
                }
                function onUp() {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    if (moved) {
                        GM_setValue("cx_launcher_pos", {
                            right: parseInt(panel.style.right, 10),
                            top: parseInt(panel.style.top, 10)
                        });
                    } else {
                        panel.classList.toggle("pinned");
                    }
                }
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
                e.preventDefault();
            });
        })();

        /* ===== 悬停展开；下方空间不足时向上弹出；带关闭延迟便于划过间隙 ===== */
        (function() {
            var MENU_H = 260, closeTimer = null;
            function evalFlip() {
                var r = panel.getBoundingClientRect();
                if (r.bottom + MENU_H > window.innerHeight && r.top > MENU_H) panel.classList.add("up");
                else panel.classList.remove("up");
            }
            function openMenu() {
                if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
                evalFlip();
                panel.classList.add("open");
            }
            function scheduleClose() {
                if (panel.classList.contains("pinned")) return;
                if (closeTimer) clearTimeout(closeTimer);
                closeTimer = setTimeout(function() { panel.classList.remove("open"); closeTimer = null; }, 260);
            }
            panel.addEventListener("mouseenter", openMenu);
            panel.addEventListener("mouseleave", scheduleClose);
            /* 钉住或拖拽后也校正方向 */
            panel.addEventListener("mouseup", function() { if (panel.classList.contains("pinned")) evalFlip(); });
        })();

        log("脚本加载成功");
    }

    /* ===== 生成按厂商分组的 <option> 列表（供会话模型下拉复用） ===== */
    function makeModelOptions(current) {
        var out = "";
        for (var pi = 0; pi < PROVIDER_ORDER.length; pi++) {
            var pid = PROVIDER_ORDER[pi];
            var pname = PROVIDER_CONFIG[pid] ? PROVIDER_CONFIG[pid].name : pid;
            var models = MODEL_LIST.filter(function(m) { return (MODEL_PROVIDER_MAP[m] || "deepseek") === pid; });
            if (!models.length) continue;
            out += '<optgroup label="' + pname + '">';
            for (var mi = 0; mi < models.length; mi++) {
                out += '<option value="' + models[mi] + '"' + (models[mi] === current ? " selected" : "") + '>' + models[mi] + '</option>';
            }
            out += '</optgroup>';
        }
        return out;
    }

    /* ===== 生成题型模型选择 HTML（按厂商分组，厂商高亮） ===== */
    function makeTypeSelects() {
        var out = "";
        var tlist = ["单选题","多选题","判断题","填空题","简答题"];
        for (var ti = 0; ti < tlist.length; ti++) {
            var t = tlist[ti];
            var cur = GM_getValue("model_type_" + t, "deepseek-chat");
            var curProvId = MODEL_PROVIDER_MAP[cur] || "deepseek";
            var curProvName = PROVIDER_CONFIG[curProvId] ? PROVIDER_CONFIG[curProvId].name : curProvId;
            out += '<div class="ms-row">'
                + '<span class="l">' + t + '</span>'
                + '<span class="prov-chip" data-type="' + t + '">' + curProvName + '</span>'
                + '<select class="type-model" data-type="' + t + '">';
            for (var pi = 0; pi < PROVIDER_ORDER.length; pi++) {
                var pid = PROVIDER_ORDER[pi];
                var pname = PROVIDER_CONFIG[pid] ? PROVIDER_CONFIG[pid].name : pid;
                var models = MODEL_LIST.filter(function(m){ return (MODEL_PROVIDER_MAP[m] || "deepseek") === pid; });
                if (!models.length) continue;
                out += '<optgroup label="' + pname + '">';
                for (var mi = 0; mi < models.length; mi++) {
                    out += '<option value="' + models[mi] + '"' + (models[mi] === cur ? ' selected' : '') + '>' + models[mi] + '</option>';
                }
                out += '</optgroup>';
            }
            out += '</select>'
                + '</div>';
        }
        return out;
    }

    /* ===== 统计页面（站内弹层） ===== */
    function openStatsPage() {
        function escHtml(s) {
            return String(s == null ? "" : s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }
        function csvEsc(s) {
            return '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
        }
        function makeProviderKeyInputs() {
            var h = '<div class="mk-grid">';
            for (var pi = 0; pi < PROVIDER_ORDER.length; pi++) {
                var pid = PROVIDER_ORDER[pi];
                var pc = PROVIDER_CONFIG[pid];
                var savedKey = GM_getValue("cx_key_" + pid, "") || (pid === "deepseek" ? (GM_getValue("deepseek_key", "") || "") : "");
                var hasVal = savedKey ? ' has-val' : '';
                h += '<div class="mk-card">'
                    + '<div class="mk-card-h"><span class="n">' + pc.name + '</span><span class="s">' + pc.base.replace(/^https?:\/\//,'') + '</span></div>'
                    + '<div class="mk-card-b">'
                    + '<input class="prov-key-s' + hasVal + '" data-prov="' + pid + '" type="password" value="' + savedKey.replace(/"/g,"&quot;") + '" placeholder="' + (hasVal ? '••••••••' : '输入 API Key') + '" />'
                    + '<button class="bt prov-test-s" data-prov="' + pid + '">测试</button>'
                    + '</div></div>';
            }
            h += '</div>';
            return h;
        }

        var old = document.getElementById("cx-stats-modal");
        if (old) { old.style.display = "flex"; return; }

        var d = getUsage();
        var totalTk = (d.prompt || 0) + (d.completion || 0);
        var costInput = ((d.prompt || 0) / 1000000) * 0.5;
        var costOutput = ((d.completion || 0) / 1000000) * 2;
        var costTotal = costInput + costOutput;
        var pctIn = totalTk > 0 ? ((d.prompt || 0) / totalTk * 100).toFixed(1) : "0.0";
        var pctOut = totalTk > 0 ? ((d.completion || 0) / totalTk * 100).toFixed(1) : "0.0";
        var avgIn = d.questions > 0 ? ((d.prompt || 0) / d.questions).toFixed(0) : "0";
        var avgOut = d.questions > 0 ? ((d.completion || 0) / d.questions).toFixed(0) : "0";
        var avgCost = d.questions > 0 ? (costTotal / d.questions).toFixed(4) : "0.0000";
        var savedQs = getSavedQuestions();
        var modelSelectHtml = makeTypeSelects();

        if (!document.getElementById("cx-stats-style")) {
            var st = document.createElement("style");
            st.id = "cx-stats-style";
            st.textContent = [
                "#cx-stats-modal{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center}",
                "#cx-stats-modal *{box-sizing:border-box}",
                "#cx-stats-modal .w{position:relative;width:min(1100px,96vw);height:min(760px,92vh);background:var(--cx-panel);color:var(--cx-ink);border:1px solid var(--cx-line);border-radius:var(--cx-r);display:flex;flex-direction:column;overflow:hidden;color-scheme:dark;font-family:var(--cx-sans);box-shadow:0 24px 70px rgba(0,0,0,.5);animation:cx-modal-in .28s cubic-bezier(.2,.7,.3,1)}",
                "@keyframes cx-modal-in{from{opacity:0;transform:translateY(16px) scale(.98)}}",
                "#cx-stats-modal select option{background:var(--cx-panel-deep);color:var(--cx-ink)}",
                "#cx-stats-modal .h{height:56px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--cx-line-soft);background:var(--cx-panel-2)}",
                "#cx-stats-modal .h .t{font-family:var(--cx-serif);font-size:18px;font-weight:700;color:var(--cx-ink);letter-spacing:.02em}",
                "#cx-stats-modal .x{width:30px;height:30px;border:1px solid var(--cx-line);background:var(--cx-panel-deep);color:var(--cx-mut);font-size:16px;line-height:1;border-radius:var(--cx-r-xs);cursor:pointer;transition:.18s}",
                "#cx-stats-modal .x:hover{color:var(--cx-brand-t);border-color:var(--cx-brand)}",
                "#cx-stats-modal .b{flex:1;display:flex;min-height:0}",
                "#cx-stats-modal .nav{width:184px;border-right:1px solid var(--cx-line-soft);background:var(--cx-panel-2);padding:10px}",
                "#cx-stats-modal .ni{position:relative;padding:9px 12px;border-radius:var(--cx-r-sm);color:var(--cx-mut);cursor:pointer;font-size:13px;font-weight:600;margin-bottom:4px;border:1px solid transparent;transition:.18s}",
                "#cx-stats-modal .ni:hover{background:var(--cx-brand-tint);color:var(--cx-ink);transform:translateX(2px)}",
                "#cx-stats-modal .ni.on{background:var(--cx-brand-tint);border-color:var(--cx-brand-line);color:var(--cx-brand-t)}",
                "#cx-stats-modal .ni.on::before{content:'';position:absolute;left:-1px;top:22%;bottom:22%;width:3px;background:var(--cx-brand);border-radius:2px}",
                "#cx-stats-modal .main{flex:1;min-width:0;min-height:0;overflow:auto;padding:16px}",
                "#cx-stats-modal .main::-webkit-scrollbar{width:8px}",
                "#cx-stats-modal .main::-webkit-scrollbar-thumb{background:rgba(203,203,203,.28);border-radius:4px}",
                "#cx-stats-modal .tab{display:none}",
                "#cx-stats-modal .tab.on{display:block}",
                "#cx-stats-modal .gr{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:14px}",
                "#cx-stats-modal .cd{background:var(--cx-panel-deep);border:1px solid var(--cx-line);border-radius:var(--cx-r);padding:12px}",
                "#cx-stats-modal .lb{font-family:var(--cx-mono);font-size:11px;letter-spacing:.06em;color:var(--cx-mut);margin-bottom:4px}",
                "#cx-stats-modal .nm{font-family:var(--cx-serif);font-size:24px;font-weight:700;color:var(--cx-ink)}",
                "#cx-stats-modal .pn{background:var(--cx-panel-deep);border:1px solid var(--cx-line);border-radius:var(--cx-r);margin-bottom:12px;overflow:hidden}",
                "#cx-stats-modal .ph{padding:10px 14px;border-bottom:1px solid var(--cx-line-soft);font-size:14px;font-weight:700;color:var(--cx-ink)}",
                "#cx-stats-modal .pb{padding:12px 14px}",
                "#cx-stats-modal .sr{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--cx-line-soft)}",
                "#cx-stats-modal .sr:last-child{border-bottom:none}",
                "#cx-stats-modal .srr{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:11px 0;border-bottom:1px solid var(--cx-line-soft)}",
                "#cx-stats-modal .srr:last-child{border-bottom:none}",
                "#cx-stats-modal .srr .lab{font-size:13px;font-weight:600;color:var(--cx-ink)}",
                "#cx-stats-modal .srr .d{font-size:11px;color:var(--cx-mut);margin-top:2px}",
                "#cx-stats-modal .rec{display:inline;color:var(--cx-mut);font-size:12px;margin-left:3px;cursor:help;vertical-align:baseline;transition:color .15s}",
                "#cx-stats-modal .rec:hover{color:var(--cx-brand-t)}",
                "#cx-stats-modal .sw{position:relative;display:inline-block;width:46px;height:26px;flex:none;cursor:pointer}",
                "#cx-stats-modal .sw input{position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;background:transparent;border:none;opacity:0;cursor:pointer;z-index:2}",
                "#cx-stats-modal .sw .sl{position:absolute;left:0;right:0;top:0;bottom:0;background:#2a3038;border:1px solid var(--cx-line);border-radius:26px;transition:background .22s,border-color .22s}",
                "#cx-stats-modal .sw .sl:before{content:'';position:absolute;left:3px;top:50%;width:18px;height:18px;margin-top:-9px;border-radius:50%;background:#8b949e;transition:transform .22s,background .22s;box-shadow:0 1px 3px rgba(0,0,0,.4)}",
                "#cx-stats-modal .sw input:checked + .sl{background:#4A90D9;border-color:#4A90D9}",
                "#cx-stats-modal .sw input:checked + .sl:before{transform:translateX(20px);background:#fff}",
                "#cx-stats-modal .srr .ctl{flex:none;display:flex;align-items:center;gap:8px}",
                "#cx-stats-modal .srr select,#cx-stats-modal .srr input{background:var(--cx-panel-deep);color:var(--cx-ink);border:1px solid var(--cx-line);border-radius:var(--cx-r-sm);padding:7px 10px;font-family:var(--cx-sans);font-size:13px}",
                "#cx-stats-modal .srr select:focus,#cx-stats-modal .srr input:focus{border-color:var(--cx-brand);outline:none;box-shadow:0 0 0 3px var(--cx-brand-tint)}",
                "#cx-stats-modal .srr input[type=number]{width:120px}",
                "#cx-stats-modal .fx{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}",
                "#cx-stats-modal button.bt{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--cx-line);background:var(--cx-panel-deep);color:var(--cx-ink-2);border-radius:var(--cx-r-sm);padding:7px 13px;font-family:var(--cx-sans);font-size:12.5px;font-weight:600;cursor:pointer;transition:.16s}",
                "#cx-stats-modal button.bt svg{width:14px;height:14px;display:block}",
                "#cx-stats-modal button.bt:hover{color:var(--cx-brand-t);border-color:var(--cx-brand);background:var(--cx-brand-tint);transform:translateY(-1px)}",
                "#cx-stats-modal button.bt:active{transform:translateY(0)}",
                "#cx-stats-modal button.bt.primary{background:var(--cx-brand);border-color:var(--cx-brand);color:#fff}",
                "#cx-stats-modal button.bt.primary:hover{background:var(--cx-brand-t);border-color:var(--cx-brand-t);color:#fff}",
                "#cx-stats-modal button.bt.ok{color:var(--cx-alt-t);border-color:var(--cx-alt-line)}",
                "#cx-stats-modal button.bt.ok:hover{background:var(--cx-alt);border-color:var(--cx-alt);color:#fff}",
                "#cx-stats-modal button.bt.red{color:var(--cx-pop-t);border-color:rgba(248,81,73,.45)}",
                "#cx-stats-modal button.bt.red:hover{background:var(--cx-pop);border-color:var(--cx-pop);color:#fff}",
                "#cx-stats-modal .qi{padding:10px 0;border-bottom:1px solid var(--cx-line-soft)}",
                "#cx-stats-modal .qi:last-child{border-bottom:none}",
                "#cx-stats-modal .qm{font-size:12px;color:var(--cx-mut);margin-top:4px}",
                "#cx-stats-modal #cx-console-bd{height:540px;overflow-y:auto;padding:10px 14px;font-family:var(--cx-mono);font-size:12px;line-height:1.7;color:var(--cx-ink)}",
                "#cx-stats-modal #cx-console-bd div{padding:2px 0;border-bottom:1px solid var(--cx-line-soft);word-break:break-all}",
                "#cx-stats-modal #cx-console-bd .lb-time{color:var(--cx-mut);margin-right:6px}",
                "#cx-stats-modal .ta{width:100%;min-height:100px;background:var(--cx-panel-deep);color:var(--cx-ink);border:1px solid var(--cx-line);border-radius:var(--cx-r-sm);padding:10px;font-family:var(--cx-mono);font-size:12px;resize:vertical}",
                "#cx-stats-modal table{width:100%;border-collapse:collapse;font-size:13px}",
                "#cx-stats-modal th,#cx-stats-modal td{padding:8px;border-bottom:1px solid var(--cx-line-soft);text-align:left;color:var(--cx-ink-2)}",
                "#cx-stats-modal th{font-family:var(--cx-serif);color:var(--cx-ink)}",
                "#cx-stats-modal th:last-child,#cx-stats-modal td:last-child{text-align:right}",
                "#cx-stats-modal .mk-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
                "#cx-stats-modal .mk-card{background:var(--cx-panel-deep);border:1px solid var(--cx-line);border-radius:var(--cx-r-sm);padding:10px 12px;transition:border-color .2s}",
                "#cx-stats-modal .mk-card:hover{border-color:var(--cx-brand-line)}",
                "#cx-stats-modal .mk-card.ok{background:rgba(63,185,80,.12);border-color:rgba(63,185,80,.55)}",
                "#cx-stats-modal .mk-card.err{background:rgba(248,81,73,.12);border-color:rgba(248,81,73,.55)}",
                "#cx-stats-modal .mk-card.ok .mk-card-h .n{color:#56d364}",
                "#cx-stats-modal .mk-card.err .mk-card-h .n{color:#ff7b72}",
                "#cx-stats-modal .mk-card-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}",
                "#cx-stats-modal .mk-card-h .n{font-size:13px;font-weight:600;color:var(--cx-ink)}",
                "#cx-stats-modal .mk-card-h .s{font-family:var(--cx-mono);font-size:10px;color:var(--cx-mut)}",
                "#cx-stats-modal .mk-card-b{display:flex;gap:6px}",
                "#cx-stats-modal .mk-card-b input{flex:1;min-width:0;padding:6px 10px;font-size:13px;background:var(--cx-panel);color:var(--cx-ink);border:1px solid var(--cx-line);border-radius:var(--cx-r-xs);outline:none;transition:border-color .2s}",
                "#cx-stats-modal .mk-card-b input:focus{border-color:var(--cx-brand);box-shadow:0 0 0 3px var(--cx-brand-tint)}",
                "#cx-stats-modal .mk-card-b input.has-val{border-color:var(--cx-alt-line)}",
                "#cx-stats-modal .mk-card-b .bt{padding:5px 14px;font-size:12px;white-space:nowrap;border:1px solid var(--cx-line);background:var(--cx-panel);color:var(--cx-ink-2);border-radius:var(--cx-r-xs);cursor:pointer;transition:.15s}",
                "#cx-stats-modal .mk-card-b .bt:hover{border-color:var(--cx-brand);color:var(--cx-brand-t)}",
                "#cx-stats-modal .mk-card-b .bt.ok{border-color:var(--cx-alt);color:var(--cx-alt-t)}",
                "#cx-stats-modal .ms-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-bottom:1px solid var(--cx-line-soft);border-radius:var(--cx-r-sm);transition:background .15s}",
                "#cx-stats-modal .ms-row:hover{background:var(--cx-panel-2)}",
                "#cx-stats-modal .ms-row:last-child{border-bottom:none}",
                "#cx-stats-modal .ms-row .l{font-size:13px;font-weight:600;color:var(--cx-ink);min-width:52px}",
                "#cx-stats-modal .prov-chip{flex:none;min-width:72px;text-align:center;font-size:12px;font-weight:700;color:var(--cx-brand-t);background:var(--cx-brand-tint);border:1px solid var(--cx-brand-line);border-radius:999px;padding:3px 10px;white-space:nowrap}",
                "#cx-stats-modal .ms-row select{flex:1;min-width:0;padding:7px 28px 7px 10px;font-size:13px;background:var(--cx-panel-deep);color:var(--cx-ink);border:1px solid var(--cx-line);border-radius:var(--cx-r-sm);outline:none;cursor:pointer;transition:border-color .2s;-webkit-appearance:none;appearance:none;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b949e' d='M6 8L1 3h10z'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 9px center}",
                "#cx-stats-modal .ms-row select:focus{border-color:var(--cx-brand);box-shadow:0 0 0 3px var(--cx-brand-tint)}",
                "#cx-stats-modal .ms-row optgroup{background:var(--cx-panel-2);color:var(--cx-brand-t);font-weight:700;font-style:normal}",
                "#cx-stats-modal .ms-row option{background:var(--cx-panel-deep);color:var(--cx-ink)}"
            ].join("");
            document.head.appendChild(st);
        }

        var questionRows = "";
        if (savedQs.length === 0) {
            questionRows = '<div style="padding:24px 0;text-align:center;color:var(--cx-mut)">暂无题目记录</div>';
        } else {
            for (var qi = savedQs.length - 1; qi >= 0; qi--) {
                var q = savedQs[qi];
                var courseTag = q.course ? ' <span style="color:var(--cx-brand-t)">' + escHtml(q.course) + '</span>' : '';
                var assignTag = q.assignment ? ' <span style="color:var(--cx-mut)">› ' + escHtml(q.assignment) + '</span>' : '';
                questionRows += '<div class="qi"><div>[' + (qi + 1) + '] [' + escHtml(q.type || "") + '] '
                    + escHtml((q.question || "").substring(0, 100)) + '</div>'
                    + '<div class="qm">' + escHtml(q.time || "") + courseTag + assignTag
                    + ' · ' + escHtml(q.model || "")
                    + ' · 答案: ' + escHtml((q.answer || "").substring(0, 60)) + '</div></div>';
            }
        }

        var modal = document.createElement("div");
        modal.id = "cx-stats-modal";
        modal.innerHTML = ''
            + '<div class="w">'
            + '<div class="h"><div class="t">答题助手 Next v' + VERSION + '</div><button class="x" id="cx-sm-close">×</button></div>'
            + '<div class="b">'
            + '<div class="nav">'
            + '<div class="ni on" data-tab="dash">仪表盘</div>'
            + '<div class="ni" data-tab="token">Token 分析</div>'
            + '<div class="ni" data-tab="questions">题目管理</div>'
            + '<div class="ni" data-tab="models">模型配置</div>'
            + '<div class="ni" data-tab="settings">系统设置</div>'
            + '<div class="ni" data-tab="console">控制台</div>'
            + '<div class="ni" data-tab="info">脚本信息</div>'
            + '</div>'
            + '<div class="main">'
            + '<div class="tab on" id="cx-tab-dash">'
            + '<div class="gr">'
            + '<div class="cd"><div class="lb">总 Token</div><div class="nm">' + totalTk.toLocaleString() + '</div></div>'
            + '<div class="cd"><div class="lb">本轮题数</div><div class="nm">' + (d.questions || 0) + '</div></div>'
            + '<div class="cd"><div class="lb">累计题数</div><div class="nm">' + (d.total_questions || 0) + '</div></div>'
            + '<div class="cd"><div class="lb">预估费用</div><div class="nm">¥' + costTotal.toFixed(4) + '</div></div>'
            + '</div>'
            + '<div style="display:flex;gap:12px;flex-wrap:wrap">'
            + '<div class="pn" style="flex:1;min-width:240px"><div class="ph" style="font-size:13px">Token 占比</div><div class="pb" style="text-align:center;padding:8px"><canvas id="cx-pie-chart" width="280" height="200"></canvas></div></div>'
            + '<div class="pn" style="flex:2;min-width:300px"><div class="ph" style="font-size:13px">各题 Token 消耗</div><div class="pb" style="text-align:center;padding:8px"><canvas id="cx-line-chart" width="460" height="200"></canvas></div></div>'
            + '</div>'
            + '</div>'
            + '<div class="tab" id="cx-tab-token">'
            + '<div class="pn"><div class="ph">Token 详情</div><div class="pb"><table><tr><th>项目</th><th>值</th></tr>'
            + '<tr><td>本轮输入</td><td>' + (d.prompt || 0).toLocaleString() + '</td></tr>'
            + '<tr><td>本轮输出</td><td>' + (d.completion || 0).toLocaleString() + '</td></tr>'
            + '<tr><td>本轮总计</td><td>' + totalTk.toLocaleString() + '</td></tr>'
            + '<tr><td>平均输入/次</td><td>' + avgIn + '</td></tr>'
            + '<tr><td>平均输出/次</td><td>' + avgOut + '</td></tr>'
            + '<tr><td>平均费用/题</td><td>¥' + avgCost + '</td></tr>'
            + '</table></div></div>'
            + '</div>'
            + '<div class="tab" id="cx-tab-questions">'
            + '<div class="pn"><div class="ph">已保存题目（' + savedQs.length + '）</div><div class="pb">'
            + '<div class="fx">'
            + '<span style="font-size:12px;color:var(--cx-mut);align-self:center;margin-right:2px">生成格式</span>'
            + '<button class="bt" id="cx-exp-json"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M6 3h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>JSON</button>'
            + '<button class="bt" id="cx-exp-csv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M6 3h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>CSV</button>'
            + '<button class="bt" id="cx-exp-txt"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M6 3h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>TXT</button>'
            + '<button class="bt" id="cx-exp-html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M6 3h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>HTML</button>'
            + '</div>'
            + '<div class="fx">'
            + '<span style="font-size:12px;color:var(--cx-mut);align-self:center;margin-right:2px">操作</span>'
            + '<button class="bt primary" id="cx-exp-save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>保存文件</button>'
            + '<button class="bt" id="cx-exp-copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>复制</button>'
            + '<button class="bt" id="cx-imp-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/></svg>导入</button>'
            + '<input type="file" id="cx-imp-file" accept="application/json,.json" style="display:none" />'
            + '<button class="bt red" id="cx-clear-qs"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>清空</button>'
            + '</div>'
            + '<textarea class="ta" id="cx-exp-box" placeholder="先点上方格式生成内容，再点「保存文件」下载或「复制」到剪贴板"></textarea>'
            + '<div style="margin-top:10px">' + questionRows + '</div>'
            + '</div></div>'
            + '</div>'
            + '<div class="tab" id="cx-tab-models">'
            + '<div class="pn" style="margin-bottom:8px"><div class="ph" style="padding:8px 14px;font-size:13px">API 密钥</div><div class="pb" style="padding:8px 14px">'
            + makeProviderKeyInputs()
            + '<div class="fx" style="margin-top:8px"><button class="bt primary" id="cx-save-keys">保存 Key</button></div>'
            + '</div></div>'
            + '<div class="pn"><div class="ph" style="padding:8px 14px;font-size:13px">按题型选择模型 <span class="rec" data-tip="为每种题型分别指定模型；仅在“逐题独立”模式下生效。判断题/单选题可用便宜模型，简答题用更强的模型">ⓘ</span></div><div class="pb" style="padding:8px 14px" id="cx-model-wrap">' + modelSelectHtml + '</div></div>'
            + '<div class="pn"><div class="ph" style="padding:8px 14px;font-size:13px">会话模型 <span class="rec" data-tip="累积会话 / 整卷批量模式下整卷统一用这一个模型（缓存按模型分，需固定）">ⓘ</span></div><div class="pb" style="padding:8px 14px"><div class="ms-row"><span class="l">整卷统一</span><select id="cx-s-sessmodel">' + makeModelOptions(SESSION_MODEL) + '</select></div></div></div>'
            + '<div class="pn"><div class="ph" style="padding:8px 14px;font-size:13px">接口说明</div><div class="pb" style="padding:10px 14px;font-size:12px;line-height:1.8;color:var(--cx-mut)">'
            + '• 本脚本按 <b style="color:var(--cx-ink)">OpenAI 兼容格式</b>（<code style="color:var(--cx-alt-t)">/chat/completions</code>）调用。<br>'
            + '• DeepSeek / OpenAI / 通义千问 / 智谱 / 月之暗面 官方即兼容，可直接填官方 Key。<br>'
            + '• <b style="color:var(--cx-pop-t)">Anthropic(Claude) / Google Gemini / MiniMax</b> 官方接口格式不同，官方直连会失败；如需使用请走 OpenAI 兼容聚合网关。<br>'
            + '• 模型 ID 以你所用网关或官方实际支持为准。</div></div>'
            + '</div>'
            + '<div class="tab" id="cx-tab-settings">'
            + '<div class="pn" style="margin-bottom:8px"><div class="ph" style="font-size:13px">系统参数</div><div class="pb">'
            + '<div class="srr"><div><div class="lab">答题间隔 <span class="rec" data-tip="建议 1500–3000 毫秒：太快容易被平台限流，太慢耗时">ⓘ</span></div><div class="d">答完一题后，等待多久再做下一题</div></div><div class="ctl"><input type="number" id="cx-s-delay" min="500" max="10000" step="100" value="' + DELAY_MS + '"></div></div>'
            + '<div class="srr"><div><div class="lab">最大 Token <span class="rec" data-tip="建议 2048；简答题等长答案可提高到 4096">ⓘ</span></div><div class="d">AI 单次回答的最大长度，设太小答案会被截断</div></div><div class="ctl"><input type="number" id="cx-s-maxtokens" min="256" max="8192" step="128" value="' + MAX_TOKENS + '"></div></div>'
            + '<div class="srr"><div><div class="lab">温度 Temperature <span class="rec" data-tip="建议 0.3：数值越低回答越稳定确定，越高越发散有创意">ⓘ</span></div><div class="d">控制回答的随机性，答题建议用低值</div></div><div class="ctl"><input type="number" id="cx-s-temp" min="0" max="2" step="0.1" value="' + TEMP + '"></div></div>'
            + '<div class="srr"><div><div class="lab">批量逐题填写 <span class="rec" data-tip="整卷批量模式下，即使模型一次性返回全部答案，也按「答题间隔」逐题填入，模拟人工、避免瞬间填完。建议保持开启，非必要不要关闭。">ⓘ</span></div><div class="d">仅在「整卷批量」模式生效</div></div><div class="ctl"><label class="sw"><input type="checkbox" id="cx-s-batchstagger" ' + (BATCH_STAGGER ? "checked" : "") + ' /><span class="sl"></span></label></div></div>'
            + '<div class="srr"><div><div class="lab">答题模式 <span class="rec" data-tip="逐题独立=每题新会话；累积会话=整卷共用一条对话，缓存命中高、风格统一；整卷批量=一次请求答完整卷。后两者锁定单一模型">ⓘ</span></div><div class="d">影响缓存命中率与跨题风格一致性</div></div><div class="ctl"><select id="cx-s-mode"><option value="independent"' + (SESSION_MODE === "independent" ? " selected" : "") + '>逐题独立</option><option value="session"' + (SESSION_MODE === "session" ? " selected" : "") + '>累积会话</option><option value="batch"' + (SESSION_MODE === "batch" ? " selected" : "") + '>整卷批量</option></select></div></div>'
            + '<div class="srr"><div><div class="lab">当前课程 <span class="rec" data-tip="留空则自动从页面标题识别课程名">ⓘ</span></div><div class="d">答题记录归到哪门课，可手动指定</div></div><div class="ctl"><input type="text" id="cx-s-course" value="' + (GM_getValue("cx_last_course", "") || "").replace(/"/g,"&quot;") + '" placeholder="自动检测" style="min-width:160px" /></div></div>'
            + '<div class="srr"><div><div class="lab">恢复默认参数</div><div class="d">把间隔 / 最大 Token / 温度 改回初始值</div></div><div class="ctl"><button class="bt" id="cx-reset-defaults">恢复默认参数</button></div></div>'
            + '<div class="srr"><div><div class="lab">重置统计数据</div><div class="d">清空 Token 用量与图表记录，不影响已保存的题目</div></div><div class="ctl"><button class="bt red" id="cx-reset-stats">重置统计</button></div></div>'
            + '</div></div>'
            + '<div class="pn"><div class="ph" style="font-size:13px">提示词设置</div><div class="pb">'
            + '<textarea id="cx-s-prompt" style="width:100%;min-height:90px;background:var(--cx-panel-deep);color:var(--cx-ink);border:1px solid var(--cx-line);border-radius:var(--cx-r-sm);padding:8px;font-size:12px;font-family:var(--cx-mono);resize:vertical;box-sizing:border-box">' + (GM_getValue("system_prompt", "") || getDefaultPrompt()).replace(/</g,"&lt;").replace(/>/g,"&gt;") + '</textarea>'
            + '<div class="fx" style="margin-top:6px"><button class="bt primary" id="cx-save-sprompt">保存提示词</button><button class="bt" id="cx-reset-prompt">恢复默认提示词</button></div>'
            + '</div></div>'
            + '</div>'
            + '<div class="tab" id="cx-tab-console">'
            + '<div class="pn"><div class="ph" style="font-size:13px;display:flex;align-items:center;justify-content:space-between">运行日志<span style="display:flex;gap:6px"><button class="bt" id="cx-console-clear" style="padding:3px 10px;font-size:11px">清屏</button><button class="bt" id="cx-logbox-toggle" style="padding:3px 10px;font-size:11px">' + (LOGBOX_DISABLED ? "开启迷你面板" : "关闭迷你面板") + '</button></span></div><div class="pb" style="padding:0">'
            + '<div id="cx-console-bd"></div>'
            + '</div></div>'
            + '</div>'
            + '<div class="tab" id="cx-tab-info">'
            + '<div class="pn"><div class="ph" style="font-size:13px">脚本信息</div><div class="pb" style="font-size:13px;line-height:1.9">'
            + '<div class="sr"><span style="color:var(--cx-mut)">名称</span><span style="color:var(--cx-ink);font-weight:600">学习通自动答题助手 Next</span></div>'
            + '<div class="sr"><span style="color:var(--cx-mut)">当前版本</span><span style="color:var(--cx-brand-t);font-weight:700">v' + VERSION + '</span></div>'
            + '<div class="sr"><span style="color:var(--cx-mut)">许可证</span><span style="color:var(--cx-ink)">MIT</span></div>'
            + '<div class="sr"><span style="color:var(--cx-mut)">已配置供应商</span><span style="color:var(--cx-ink)">' + (function(){ var n=0; for(var i=0;i<PROVIDER_ORDER.length;i++){ if(getProviderKey(PROVIDER_ORDER[i])) n++; } return n + " / " + PROVIDER_ORDER.length; })() + '</span></div>'
            + '<div class="sr"><span style="color:var(--cx-mut)">可用模型</span><span style="color:var(--cx-ink)">' + MODEL_LIST.length + ' 个</span></div>'
            + '<div class="sr"><span style="color:var(--cx-mut)">答题模式</span><span style="color:var(--cx-ink)">' + (SESSION_MODE === "batch" ? "整卷批量" : (SESSION_MODE === "session" ? "累积会话" : "逐题独立")) + '</span></div>'
            + '<div class="sr"><span style="color:var(--cx-mut)">项目地址</span><a href="https://github.com/Lithum-12/chaoxing-answer-helper" target="_blank" rel="noopener" style="color:var(--cx-brand-t);text-decoration:none">GitHub ↗</a></div>'
            + (function(){
                var di = null; try { di = (typeof unsafeWindow !== "undefined" && unsafeWindow.__cxFontDecoderInfo) || window.__cxFontDecoderInfo || null; } catch (e) {}
                if (di) {
                    return '<div class="pn" style="margin-top:8px"><div class="ph" style="font-size:13px">扩展脚本信息</div><div class="pb" style="font-size:13px;line-height:1.9">'
                        + '<div class="sr"><span style="color:var(--cx-mut)">字体解码器</span><span style="color:var(--cx-alt-t);font-weight:600">已安装 · v' + (di.version || "?") + '</span></div>'
                        + '<div class="sr"><span style="color:var(--cx-mut)">字形映射表</span><span style="color:var(--cx-ink)">' + (di.entries || "?") + ' 条</span></div>'
                        + '<div class="sr"><span style="color:var(--cx-mut)">状态</span><span style="color:var(--cx-ink)">' + (di.ready ? "就绪（可解码 font-cxsecret 加密题）" : "加载中") + '</span></div>'
                        + '</div></div>';
                }
                return '<div class="sr"><span style="color:var(--cx-mut)">字体解码器</span><span style="color:var(--cx-pop-t)">未安装（课程内章节小测等加密页无法答题）</span></div>';
            })()
            + '<div style="margin-top:12px;padding:10px 12px;background:var(--cx-panel-2);border:1px solid var(--cx-line-soft);border-radius:var(--cx-r-sm);color:var(--cx-mut);font-size:12px;line-height:1.8"><b style="color:var(--cx-pop-t)">免责声明：</b>本脚本仅供个人学习与技术研究使用，请遵守所在学校及超星平台的相关规定。API Key 仅保存在本地浏览器，不会上传到任何第三方服务器。因使用本脚本产生的一切后果由使用者自行承担。</div>'
            + '</div></div>'
            + '</div>'
            + '</div></div></div>';

        document.body.appendChild(modal);

        /* ⓘ 注释与图表共用自绘浮窗 */
        modal.addEventListener("mouseover", function(e) {
            var t = e.target.closest && e.target.closest("[data-tip]");
            if (t) showTip(t.getAttribute("data-tip"), e.clientX, e.clientY);
        });
        modal.addEventListener("mousemove", function(e) {
            var t = e.target.closest && e.target.closest("[data-tip]");
            if (t) showTip(t.getAttribute("data-tip"), e.clientX, e.clientY);
            else if (!(e.target && e.target.tagName === "CANVAS")) hideTip();
        });
        modal.addEventListener("mouseleave", hideTip);

        /* 控制台页：填充历史日志缓冲 + 清空 */
        var consoleBd = modal.querySelector("#cx-console-bd");
        if (consoleBd) {
            LOG_BUFFER.forEach(function(it) { consoleBd.appendChild(makeLogLine(it.t, it.m)); });
            consoleBd.scrollTop = consoleBd.scrollHeight;
            var cClear = modal.querySelector("#cx-console-clear");
            if (cClear) cClear.onclick = function() { consoleBd.innerHTML = ""; LOG_BUFFER.length = 0; var lb = document.getElementById("cx-logbox"); if (lb) { var lbb = lb.querySelector(".lb-bd"); if (lbb) lbb.innerHTML = ""; } };
            var lbToggle = modal.querySelector("#cx-logbox-toggle");
            if (lbToggle) lbToggle.onclick = function() {
                LOGBOX_DISABLED = !LOGBOX_DISABLED;
                try { GM_setValue("cx_logbox_disabled", LOGBOX_DISABLED); } catch (e) {}
                var lb = document.getElementById("cx-logbox");
                if (LOGBOX_DISABLED) { if (lb) { lb.classList.remove("show"); } lbToggle.textContent = "开启迷你面板"; }
                else { lbToggle.textContent = "关闭迷你面板"; if (lb && lb.querySelector(".lb-bd").children.length) lb.classList.add("show"); }
            };
        }

        function switchTab(tab) {
            modal.querySelectorAll(".ni").forEach(function(el) { el.classList.toggle("on", el.getAttribute("data-tab") === tab); });
            modal.querySelectorAll(".tab").forEach(function(el) { el.classList.toggle("on", el.id === "cx-tab-" + tab); });
            var main = modal.querySelector(".main");
            if (main) main.scrollTop = 0;
        }

        modal.querySelectorAll(".ni").forEach(function(el) {
            el.addEventListener("click", function() { switchTab(this.getAttribute("data-tab")); });
        });
        modal.querySelector("#cx-sm-close").addEventListener("click", function() { modal.remove(); });
        modal.addEventListener("click", function(e) { if (e.target === modal) modal.remove(); });

        var expBox = modal.querySelector("#cx-exp-box");
        var lastFmt = "txt";
        var FMT_EXT = { json: "json", csv: "csv", txt: "txt", html: "html" };
        var FMT_MIME = { json: "application/json", csv: "text/csv", txt: "text/plain", html: "text/html" };
        function doExport(fmt) {
            if (!expBox) return;
            if (fmt === "json") {
                expBox.value = JSON.stringify(savedQs, null, 2);
            } else if (fmt === "csv") {
                var header = "时间,课程,作业,题型,题目,选项,答案,模型\n";
                var rows = savedQs.map(function(q) {
                    return [csvEsc(q.time), csvEsc(q.course || ""), csvEsc(q.assignment || ""), csvEsc(q.type), csvEsc(q.question), csvEsc((q.options || []).join("; ")), csvEsc(q.answer), csvEsc(q.model)].join(",");
                }).join("\n");
                expBox.value = header + rows;
            } else if (fmt === "html") {
                expBox.value = buildHTMLExport(savedQs, d);
            } else {
                expBox.value = savedQs.map(function(q, i) {
                    return "#" + (i + 1) + " [" + (q.type || "") + "]"
                        + "\n课程: " + (q.course || "-") + " / 作业: " + (q.assignment || "-")
                        + "\n题目: " + (q.question || "")
                        + "\n选项: " + ((q.options || []).join(" | ")) + "\n答案: " + (q.answer || "")
                        + "\n模型: " + (q.model || "") + "\n时间: " + (q.time || "") + "\n---";
                }).join("\n");
            }
            lastFmt = fmt;
            expBox.focus();
            expBox.select();
        }
        function buildHTMLExport(qs, stats) {
            var totalTk = (stats.prompt || 0) + (stats.completion || 0);
            var now = new Date().toLocaleString();

            /* 按课程 > 作业分层 */
            var tree = {};
            qs.forEach(function(q) {
                var c = q.course || "未分类";
                var a = q.assignment || "未命名作业";
                if (!tree[c]) tree[c] = {};
                if (!tree[c][a]) tree[c][a] = [];
                tree[c][a].push(q);
            });

            function esc(s) { return escHtml(s); }

            function buildCard(q, idx) {
                var opts = (q.options && q.options.length) ? '<div class="opts">' + q.options.map(function(o) { return '<div class="opt">' + esc(o) + '</div>'; }).join("") + '</div>' : '';
                var imgs = q.images ? '<span class="tag img-tag">' + q.images + ' 张图片</span>' : '';
                var ans = q.answer ? '<div class="ans"><span class="al">答案</span><span class="av">' + esc(q.answer) + '</span></div>' : '';
                return '<div class="card"><div class="ch"><span class="ci">#' + idx + '</span><span class="ct tag ' + (q.type || 'unk') + '">' + esc(q.type || "未知") + '</span>' + imgs + '<span class="cm">' + esc(q.model || "") + '</span></div><div class="cq">' + esc(q.question) + '</div>' + opts + ans + '<div class="ctm"><span class="tm">' + esc(q.time || "") + '</span></div></div>';
            }

            function buildSection(courseName, assignments) {
                var total = 0;
                var html = '';
                var aNames = Object.keys(assignments);
                aNames.forEach(function(aName) {
                    var items = assignments[aName];
                    total += items.length;
                    html += '<details class="asection" open><summary class="ash"><span class="asn">' + esc(aName) + '</span><span class="asc">' + items.length + ' 题</span></summary>';
                    items.forEach(function(q, i) { html += buildCard(q, i + 1); });
                    html += '</details>';
                });
                return '<div class="csection"><div class="csh"><span class="csn">' + esc(courseName) + '</span><span class="csc">' + total + ' 题</span></div>' + html + '</div>';
            }

            var bodyContent = '';
            var cNames = Object.keys(tree);
            if (cNames.length === 0) {
                bodyContent = '<div class="empty">暂无答题记录</div>';
            } else {
                cNames.forEach(function(cName) { bodyContent += buildSection(cName, tree[cName]); });
            }

            return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>学习通答题记录</title><style>'
                + '*,*:before,*:after{box-sizing:border-box;margin:0;padding:0}'
                + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#0d1117;color:#e6edf3;padding:32px 24px;max-width:900px;margin:0 auto}'
                + '.hdr{margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #21262d}'
                + '.hdr h1{font-size:24px;font-weight:800;margin-bottom:8px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}'
                + '.hdr .sub{font-size:13px;color:#8b949e;display:flex;gap:20px;flex-wrap:wrap}'
                + '.csection{margin-bottom:24px}'
                + '.csh{display:flex;align-items:center;gap:12px;padding:12px 16px;background:linear-gradient(135deg,rgba(59,130,246,.08),rgba(139,92,246,.05));border:1px solid rgba(59,130,246,.15);border-radius:10px;margin-bottom:10px}'
                + '.csn{font-size:16px;font-weight:700;color:#e6edf3}'
                + '.csc{font-size:12px;color:#8b949e;background:#0d1117;padding:2px 10px;border-radius:12px;border:1px solid #21262d}'
                + '.asection{background:#161b22;border:1px solid #21262d;border-radius:10px;margin-bottom:10px;overflow:hidden}'
                + '.asection[open]{padding-bottom:8px}'
                + '.ash{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;list-style:none;user-select:none}'
                + '.ash::-webkit-details-marker{display:none}'
                + '.ash:before{content:"▶";font-size:10px;color:#8b949e;transition:transform .2s;margin-right:2px}'
                + 'details[open]>.ash:before{transform:rotate(90deg)}'
                + '.asn{font-size:14px;font-weight:600;color:#e6edf3;flex:1}'
                + '.asc{font-size:11px;color:#8b949e;background:#0d1117;padding:1px 8px;border-radius:10px}'
                + '.card{background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:14px 16px;margin:6px 10px;transition:border-color .15s}'
                + '.card:hover{border-color:#30363d}'
                + '.ch{display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap}'
                + '.ci{font-size:12px;font-weight:600;color:#8b949e;min-width:24px}'
                + '.tag{display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:600}'
                + '.tag.单选题{background:rgba(59,130,246,.12);color:#60a5fa}'
                + '.tag.多选题{background:rgba(139,92,246,.12);color:#a78bfa}'
                + '.tag.判断题{background:rgba(16,185,129,.12);color:#34d399}'
                + '.tag.填空题{background:rgba(245,158,11,.12);color:#fbbf24}'
                + '.tag.简答题{background:rgba(239,68,68,.12);color:#f87171}'
                + '.img-tag{background:rgba(236,72,153,.12);color:#f472b6}'
                + '.cm{font-size:10px;color:#8b949e;margin-left:auto}'
                + '.cq{font-size:14px;line-height:1.6;margin-bottom:8px;color:#f0f6fc}'
                + '.opts{margin-bottom:8px}'
                + '.opt{padding:6px 10px;margin:3px 0;background:#0d1117;border:1px solid rgba(33,38,45,.6);border-radius:5px;font-size:12px;line-height:1.5;color:#e6edf3}'
                + '.ans{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.15);border-radius:6px;margin-bottom:4px}'
                + '.al{font-size:10px;font-weight:700;color:#34d399;text-transform:uppercase;letter-spacing:.5px}'
                + '.av{font-size:13px;color:#e6edf3}'
                + '.ctm{font-size:10px;color:#8b949e;margin-top:4px}'
                + '.empty{padding:60px 0;text-align:center;color:#8b949e;font-size:16px}'
                + '</style></head><body>'
                + '<div class="hdr"><h1>学习通答题记录</h1><div class="sub"><span>📚 共 ' + qs.length + ' 题</span><span>📊 ' + totalTk.toLocaleString() + ' Token</span><span>📁 ' + Object.keys(tree).length + ' 个课程</span><span>🕐 ' + now + '</span></div></div>'
                + bodyContent
                + '</body></html>';
        }
        function downloadFile(filename, content, mimeType) {
            var blob = new Blob([content], { type: mimeType + ";charset=utf-8" });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
        }

        var btnJson = modal.querySelector("#cx-exp-json");
        var btnCsv = modal.querySelector("#cx-exp-csv");
        var btnTxt = modal.querySelector("#cx-exp-txt");
        var btnHtml = modal.querySelector("#cx-exp-html");
        if (btnJson) btnJson.onclick = function() { doExport("json"); };
        if (btnCsv) btnCsv.onclick = function() { doExport("csv"); };
        if (btnTxt) btnTxt.onclick = function() { doExport("txt"); };
        if (btnHtml) btnHtml.onclick = function() { doExport("html"); };

        var saveBtn = modal.querySelector("#cx-exp-save");
        if (saveBtn) saveBtn.onclick = function() {
            if (!expBox || !expBox.value.trim()) { log("请先生成导出内容"); setStatus("请先生成内容", "warn"); return; }
            downloadFile("学习通答题记录." + (FMT_EXT[lastFmt] || "txt"), expBox.value, FMT_MIME[lastFmt] || "text/plain");
            log("已保存为 " + lastFmt.toUpperCase() + " 文件");
            setStatus("文件已下载 ✓", "ok");
        };
        var copyBtn = modal.querySelector("#cx-exp-copy");
        if (copyBtn) copyBtn.onclick = function() {
            if (!expBox || !expBox.value.trim()) { log("暂无可复制内容"); setStatus("暂无内容", "warn"); return; }
            expBox.focus(); expBox.select();
            var ok = false;
            try { ok = document.execCommand("copy"); } catch (e) {}
            if (!ok && navigator.clipboard) { navigator.clipboard.writeText(expBox.value).then(function(){ setStatus("已复制 ✓", "ok"); log("导出内容已复制"); }, function(){ expBox.select(); setStatus("请手动 Ctrl+C 复制", "warn"); }); return; }
            setStatus(ok ? "已复制 ✓" : "复制失败", ok ? "ok" : "err");
            if (ok) log("导出内容已复制到剪贴板");
        };

        var clearQsBtn = modal.querySelector("#cx-clear-qs");
        if (clearQsBtn) clearQsBtn.onclick = function() {
            if (!confirm("确定清空所有题目记录？")) return;
            GM_setValue("saved_questions", []);
            log("题目记录已清空");
            modal.remove();
            openStatsPage();
            switchTab("questions");
        };

        /* 题目导入：读取之前导出的 JSON，合并入库 */
        var impBtn = modal.querySelector("#cx-imp-btn");
        var impFile = modal.querySelector("#cx-imp-file");
        if (impBtn && impFile) {
            impBtn.onclick = function() { impFile.click(); };
            impFile.onchange = function() {
                var file = impFile.files && impFile.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function() {
                    var parsed;
                    try { parsed = JSON.parse(reader.result); } catch (e) { alert("导入失败：文件不是有效的 JSON"); return; }
                    var arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.data) ? parsed.data : null);
                    if (!arr) { alert("导入失败：未找到题目数组"); return; }
                    var norm = arr.filter(function(it) { return it && (it.question || it.answer); }).map(function(it) {
                        return {
                            time: it.time || new Date().toLocaleString(),
                            course: it.course || "", assignment: it.assignment || "",
                            question: String(it.question || ""), options: Array.isArray(it.options) ? it.options : [],
                            type: it.type || "", images: (typeof it.images === "number" ? it.images : (Array.isArray(it.images) ? it.images.length : 0)),
                            answer: String(it.answer || ""), model: it.model || ""
                        };
                    });
                    if (!norm.length) { alert("导入失败：没有可识别的题目"); return; }
                    var list = GM_getValue("saved_questions", []);
                    var seen = new Set(list.map(function(q) { return (q.course || "") + "|" + (q.question || "") + "|" + (q.answer || ""); }));
                    var added = 0;
                    norm.forEach(function(q) {
                        var key = (q.course || "") + "|" + q.question + "|" + q.answer;
                        if (seen.has(key)) return;
                        seen.add(key); list.push(q); added++;
                    });
                    if (list.length > 2000) list = list.slice(-2000);
                    GM_setValue("saved_questions", list);
                    log("导入完成：新增 " + added + " 条（共 " + norm.length + " 条）");
                    modal.remove();
                    openStatsPage();
                    switchTab("questions");
                };
                reader.onerror = function() { alert("导入失败：无法读取文件"); };
                reader.readAsText(file);
                impFile.value = "";
            };
        }

        /* API Keys 保存 & 测试 */
        var saveKeysBtn = modal.querySelector("#cx-save-keys");
        if (saveKeysBtn) saveKeysBtn.onclick = function() {
            modal.querySelectorAll(".prov-key-s").forEach(function(inp) {
                var pid = inp.getAttribute("data-prov");
                var val = inp.value.trim();
                if (val) {
                    GM_setValue("cx_key_" + pid, val);
                    inp.classList.add("has-val");
                    inp.placeholder = "••••••••";
                } else {
                    inp.classList.remove("has-val");
                    inp.placeholder = "输入 API Key";
                }
            });
            log("所有 API Key 已保存");
        };
        modal.querySelectorAll(".prov-test-s").forEach(function(btn) {
            btn.onclick = function() {
                var pid = this.getAttribute("data-prov");
                var inp = modal.querySelector('.prov-key-s[data-prov="' + pid + '"]');
                if (inp && inp.value.trim()) GM_setValue("cx_key_" + pid, inp.value.trim());
                this.textContent = "测试中";
                testProviderKey(pid);
                var self = this;
                /* 恢复按钮文字 */
                setTimeout(function() { if (self.textContent === "测试中") self.textContent = "测试"; }, 3000);
            };
        });

        modal.querySelectorAll(".type-model").forEach(function(sel) {
            sel.addEventListener("change", function() {
                var t = this.getAttribute("data-type");
                var v = this.value;
                GM_setValue("model_type_" + t, v);
                TYPE_MODELS[t] = v;
                log(t + " 模型已设为 " + v);
                /* 更新厂商高亮芯片 */
                var row = this.closest(".ms-row");
                if (row) {
                    var provId = MODEL_PROVIDER_MAP[v] || "deepseek";
                    var provName = PROVIDER_CONFIG[provId] ? PROVIDER_CONFIG[provId].name : provId;
                    var chip = row.querySelector(".prov-chip");
                    if (chip) { chip.textContent = provName; chip.setAttribute("data-prov", provId); }
                }
            });
        });

        var delayInput = modal.querySelector("#cx-s-delay");
        if (delayInput) delayInput.addEventListener("change", function() {
            var v = parseInt(this.value, 10);
            if (isNaN(v)) return;
            DELAY_MS = v;
            GM_setValue("cx_delay", v);
            log("答题间隔已设为 " + v + "ms");
        });

        var maxTkInput = modal.querySelector("#cx-s-maxtokens");
        if (maxTkInput) maxTkInput.addEventListener("change", function() {
            var v = parseInt(this.value, 10);
            if (isNaN(v)) return;
            MAX_TOKENS = v;
            GM_setValue("cx_maxtokens", v);
            log("最大 Token 已设为 " + v);
        });

        var tempInput = modal.querySelector("#cx-s-temp");
        if (tempInput) tempInput.addEventListener("change", function() {
            var v = parseFloat(this.value);
            if (isNaN(v)) return;
            v = Math.max(0, Math.min(2, v));
            TEMP = v;
            GM_setValue("cx_temp", v);
            log("温度已设为 " + v);
        });

        var bsInput = modal.querySelector("#cx-s-batchstagger");
        if (bsInput) bsInput.addEventListener("change", function() {
            BATCH_STAGGER = this.checked;
            GM_setValue("cx_batch_stagger", BATCH_STAGGER);
            log(BATCH_STAGGER ? "批量已设为按间隔逐题填写" : "批量已设为一次性填写（不建议关闭）");
        });

        /* 答题模式 */
        var modeSel = modal.querySelector("#cx-s-mode");
        if (modeSel) modeSel.addEventListener("change", function() {
            SESSION_MODE = this.value;
            GM_setValue("cx_session_mode", SESSION_MODE);
            var ml = { independent: "逐题独立", session: "累积会话", batch: "整卷批量" };
            log("答题模式已切换为：" + (ml[SESSION_MODE] || SESSION_MODE));
        });

        /* 会话模型 */
        var sessSel = modal.querySelector("#cx-s-sessmodel");
        if (sessSel) sessSel.addEventListener("change", function() {
            SESSION_MODEL = this.value;
            GM_setValue("cx_session_model", SESSION_MODEL);
            log("会话模型已设为：" + SESSION_MODEL + "（" + (MODEL_PROVIDER_MAP[SESSION_MODEL] || "deepseek") + "）");
        });

        var resetBtn = modal.querySelector("#cx-reset-stats");
        if (resetBtn) resetBtn.onclick = function() {
            if (!confirm("确定重置所有统计数据？")) return;
            GM_setValue("cx_usage_data", { prompt:0, completion:0, questions:0, sessions:(d.sessions || 0) + 1, total_questions:0, last_time:Date.now() });
            GM_setValue("model_usage", {});
            GM_setValue("usage_logs", []);
            log("统计数据已重置");
            modal.remove();
            openStatsPage();
            switchTab("settings");
        };

        /* 课程名手动设置 */
        var courseInput = modal.querySelector("#cx-s-course");
        if (courseInput) courseInput.addEventListener("change", function() {
            var v = this.value.trim();
            if (v) { _currentCourse = v; GM_setValue("cx_last_course", v); log("课程名已设为: " + v); }
        });

        /* 保存提示词 */
        var spBtn = modal.querySelector("#cx-save-sprompt");
        if (spBtn) spBtn.onclick = function() {
            var v = modal.querySelector("#cx-s-prompt").value.trim();
            if (v) { GM_setValue("system_prompt", v); log("提示词已保存"); setStatus("提示词已保存 ✓", "ok"); }
        };

        /* 恢复默认提示词 */
        var rpBtn = modal.querySelector("#cx-reset-prompt");
        if (rpBtn) rpBtn.onclick = function() {
            GM_setValue("system_prompt", "");
            var ta = modal.querySelector("#cx-s-prompt");
            if (ta) ta.value = getDefaultPrompt();
            log("提示词已恢复默认");
        };

        /* 恢复默认参数（间隔 / 最大 Token / 温度） */
        var rdBtn = modal.querySelector("#cx-reset-defaults");
        if (rdBtn) rdBtn.onclick = function() {
            if (!confirm("恢复默认参数？（间隔 1500ms / 最大 Token 2048 / 温度 0.3）")) return;
            DELAY_MS = 1500; MAX_TOKENS = 2048; TEMP = 0.3;
            GM_setValue("cx_delay", 1500); GM_setValue("cx_maxtokens", 2048); GM_setValue("cx_temp", 0.3);
            log("参数已恢复默认");
            modal.remove();
            openStatsPage();
            switchTab("settings");
        };

        /* 绘制图表 */
        function drawCharts() {
            var pieCanvas = modal.querySelector("#cx-pie-chart");
            var lineCanvas = modal.querySelector("#cx-line-chart");
            if (!pieCanvas || !lineCanvas) return;

            /* ---- 饼形图（环形图） ---- */
            (function() {
                var ctx = pieCanvas.getContext("2d");
                var W = 280, H = 200, cx = 140, cy = 85, outerR = 65, innerR = 32;
                var data = [
                    { label: "输入", value: d.prompt || 0, color: "#c06a69", sub: (d.prompt || 0).toLocaleString() },
                    { label: "输出", value: d.completion || 0, color: "#589a99", sub: (d.completion || 0).toLocaleString() }
                ];
                var total = data[0].value + data[1].value;
                ctx.clearRect(0, 0, W, H);
                if (total === 0) {
                    ctx.fillStyle = "#cbcbcb"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
                    ctx.fillText("暂无数据", cx, cy + 5);
                    pieCanvas._hit = null;
                    return;
                }
                /* 外圈发光 */
                ctx.shadowColor = "rgba(192,106,105,0.15)";
                ctx.shadowBlur = 12;
                var startAngle = -Math.PI / 2;
                var slices = [];
                data.forEach(function(d) {
                    var sliceAngle = (d.value / total) * 2 * Math.PI;
                    slices.push({ a0: startAngle, a1: startAngle + sliceAngle, d: d, pct: ((d.value / total) * 100).toFixed(1) });
                    ctx.beginPath();
                    ctx.moveTo(cx + innerR * Math.cos(startAngle), cy + innerR * Math.sin(startAngle));
                    ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
                    ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
                    ctx.closePath();
                    ctx.fillStyle = d.color;
                    ctx.fill();
                    /* 描边分割线 */
                    ctx.strokeStyle = "#121212"; ctx.lineWidth = 2;
                    ctx.stroke();
                    startAngle += sliceAngle;
                });
                ctx.shadowBlur = 0;
                pieCanvas._hit = { cx: cx, cy: cy, innerR: innerR, outerR: outerR, slices: slices, total: total };
                /* 中心文字 */
                ctx.fillStyle = "#fefefe"; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText(total.toLocaleString(), cx, cy - 6);
                ctx.fillStyle = "#cbcbcb"; ctx.font = "10px sans-serif";
                ctx.fillText("总 Token", cx, cy + 12);
                /* 图例 */
                var lx = 22, ly = 162;
                data.forEach(function(d) {
                    var pct = ((d.value / total) * 100).toFixed(1);
                    /* 彩色圆点 */
                    ctx.beginPath(); ctx.arc(lx + 5, ly + 5, 5, 0, 2 * Math.PI); ctx.fillStyle = d.color; ctx.fill();
                    ctx.fillStyle = "#fefefe"; ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
                    var label = d.label + " " + pct + "%";
                    ctx.fillText(label, lx + 14, ly + 5);
                    lx += ctx.measureText(label).width + 24;
                });
            })();

            /* ---- 折线图 ---- */
            (function() {
                var logs = GM_getValue("usage_logs", []);
                var ctx = lineCanvas.getContext("2d");
                var W = 460, H = 200;
                var pad = { t: 18, r: 12, b: 24, l: 42 };
                var cw = W - pad.l - pad.r;
                var ch = H - pad.t - pad.b;
                ctx.clearRect(0, 0, W, H);
                var pts = logs.slice(-20);
                if (pts.length < 2) {
                    ctx.fillStyle = "#cbcbcb"; ctx.font = "13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                    ctx.fillText(pts.length === 0 ? "暂无数据" : "数据不足", pad.l + cw / 2, pad.t + ch / 2);
                    return;
                }
                var vals = pts.map(function(p) { return (p.prompt || 0) + (p.completion || 0); });
                var maxVal = Math.max.apply(null, vals);
                if (maxVal === 0) maxVal = 1;
                var roundTo = maxVal > 1000 ? 100 : (maxVal > 100 ? 10 : 1);
                var yMax = Math.ceil(maxVal / roundTo) * roundTo;
                /* 网格线（极淡） */
                ctx.strokeStyle = "rgba(203,203,203,0.08)"; ctx.lineWidth = 1;
                for (var gy = 0; gy <= 4; gy++) {
                    var y = pad.t + (gy / 4) * ch;
                    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
                    ctx.fillStyle = "#cbcbcb"; ctx.font = "9px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
                    ctx.fillText(Math.round(yMax * (1 - gy / 4)), pad.l - 5, y);
                }
                /* 面积渐变 */
                var stepX = pts.length > 1 ? cw / (pts.length - 1) : cw;
                var grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
                grad.addColorStop(0, "rgba(192,106,105,0.22)");
                grad.addColorStop(1, "rgba(192,106,105,0.01)");
                ctx.beginPath();
                ctx.moveTo(pad.l, pad.t + ch);
                vals.forEach(function(v, i) {
                    var x = pad.l + i * stepX;
                    var y = pad.t + ch * (1 - v / yMax);
                    i === 0 ? ctx.lineTo(x, y) : ctx.lineTo(x, y);
                });
                ctx.lineTo(pad.l + (pts.length - 1) * stepX, pad.t + ch);
                ctx.closePath();
                ctx.fillStyle = grad;
                ctx.fill();
                /* 折线 */
                ctx.beginPath();
                ctx.strokeStyle = "#c06a69"; ctx.lineWidth = 2.5;
                ctx.lineJoin = "round"; ctx.lineCap = "round";
                vals.forEach(function(v, i) {
                    var x = pad.l + i * stepX;
                    var y = pad.t + ch * (1 - v / yMax);
                    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                });
                ctx.stroke();
                /* 数据点 */
                lineCanvas._pts = [];
                vals.forEach(function(v, i) {
                    var x = pad.l + i * stepX;
                    var y = pad.t + ch * (1 - v / yMax);
                    lineCanvas._pts.push({ x: x, y: y, rec: pts[i], val: v, idx: i });
                    ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI);
                    ctx.fillStyle = "#c06a69"; ctx.fill();
                    ctx.strokeStyle = "#121212"; ctx.lineWidth = 2;
                    ctx.stroke();
                });
                /* X 轴标签 */
                ctx.fillStyle = "#cbcbcb"; ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
                var labelStep = Math.max(1, Math.floor(pts.length / 6));
                for (var i = 0; i < pts.length; i++) {
                    if (i === 0 || i === pts.length - 1 || i % labelStep === 0) {
                        ctx.fillText("#" + (i + 1), pad.l + i * stepX, pad.t + ch + 4);
                    }
                }
                /* X 轴线 */
                ctx.strokeStyle = "rgba(203,203,203,0.18)"; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ch); ctx.lineTo(W - pad.r, pad.t + ch); ctx.stroke();
            })();

            /* 绑定 hover 命中检测（仅一次） */
            if (!pieCanvas._bound) {
                pieCanvas.addEventListener("mousemove", function(e) {
                    var hit = pieCanvas._hit; if (!hit) { hideTip(); return; }
                    var rect = pieCanvas.getBoundingClientRect();
                    var mx = (e.clientX - rect.left) * (pieCanvas.width / rect.width);
                    var my = (e.clientY - rect.top) * (pieCanvas.height / rect.height);
                    var dx = mx - hit.cx, dy = my - hit.cy, r = Math.sqrt(dx * dx + dy * dy);
                    if (r < hit.innerR || r > hit.outerR) { hideTip(); return; }
                    var ang = Math.atan2(dy, dx); if (ang < -Math.PI / 2) ang += 2 * Math.PI;
                    var sl = null;
                    for (var i = 0; i < hit.slices.length; i++) { if (ang >= hit.slices[i].a0 && ang < hit.slices[i].a1) { sl = hit.slices[i]; break; } }
                    if (!sl) { hideTip(); return; }
                    showTip('<div class="tp-t">' + sl.d.label + " Token</div>"
                        + '<div class="tp-r"><span>数量</span><span>' + sl.d.value.toLocaleString() + "</span></div>"
                        + '<div class="tp-r"><span>占比</span><span>' + sl.pct + "%</span></div>", e.clientX, e.clientY);
                });
                pieCanvas.addEventListener("mouseleave", hideTip);
                pieCanvas._bound = true;
            }
            if (!lineCanvas._bound) {
                lineCanvas.addEventListener("mousemove", function(e) {
                    var pts = lineCanvas._pts; if (!pts || !pts.length) { hideTip(); return; }
                    var rect = lineCanvas.getBoundingClientRect();
                    var mx = (e.clientX - rect.left) * (lineCanvas.width / rect.width);
                    var my = (e.clientY - rect.top) * (lineCanvas.height / rect.height);
                    var best = null, bd = 12 * 12;
                    for (var i = 0; i < pts.length; i++) { var ddx = pts[i].x - mx, ddy = pts[i].y - my, dd = ddx * ddx + ddy * ddy; if (dd < bd) { bd = dd; best = pts[i]; } }
                    if (!best) { hideTip(); return; }
                    var rec = best.rec || {};
                    showTip('<div class="tp-t">第 ' + (best.idx + 1) + " 题</div>"
                        + '<div class="tp-r"><span>输入</span><span>' + (rec.prompt || 0).toLocaleString() + "</span></div>"
                        + '<div class="tp-r"><span>输出</span><span>' + (rec.completion || 0).toLocaleString() + "</span></div>"
                        + '<div class="tp-r"><span>合计</span><span>' + best.val.toLocaleString() + "</span></div>"
                        + (rec.model ? '<div class="tp-r"><span>模型</span><span>' + rec.model + "</span></div>" : ""), e.clientX, e.clientY);
                });
                lineCanvas.addEventListener("mouseleave", hideTip);
                lineCanvas._bound = true;
            }
        }

        /* 切到仪表盘时重绘图表 */
        var origSwitch = switchTab;
        switchTab = function(tab) {
            origSwitch(tab);
            if (tab === "dash") setTimeout(drawCharts, 50);
        };
        /* 初始绘制 */
        setTimeout(drawCharts, 100);
    }

    function getDefaultPrompt() {
        return "你是答题助手。根据题目只输出答案，不要任何解释、说明、分析。\n"
            + "单选题 → 只输出字母 A/B/C/D\n"
            + "多选题 → 只输出字母逗号分隔 A,B,C\n"
            + "判断题 → 只输出 正确 或 错误\n"
            + "填空题 → 只输出答案文本\n"
            + "简答题 → 只输出答案正文，不要附加说明";
    }

    function getSystemPrompt() {
        var saved = GM_getValue("system_prompt", "");
        if (saved) return saved;
        /* stats 页面中的提示词编辑框 */
        var ta = document.getElementById("cx-s-prompt");
        if (ta && ta.value.trim()) return ta.value.trim();
        return getDefaultPrompt();
    }

    /* ===== API Key 多供应商 ===== */
    function getProviderKey(providerId) {
        /* 优先从 stats 页面的输入框读取（未保存时） */
        var statsInput = document.querySelector('.prov-key-s[data-prov="' + providerId + '"]');
        if (statsInput) {
            var v = statsInput.value.trim();
            if (v) return v;
        }
        var saved = GM_getValue("cx_key_" + providerId, "");
        if (saved) return saved;
        if (providerId === "deepseek") return GM_getValue("deepseek_key", "") || "";
        return "";
    }

    function getProviderBase(providerId) {
        var pc = PROVIDER_CONFIG[providerId];
        return pc ? pc.base : "https://api.deepseek.com/v1";
    }

    function getModelProvider(modelName) {
        return MODEL_PROVIDER_MAP[modelName] || "deepseek";
    }

    function testProviderKey(providerId) {
        var key = getProviderKey(providerId);
        var pc = PROVIDER_CONFIG[providerId];
        if (!pc) { setStatus("未知供应商", "err"); return; }
        if (!key) { setStatus("请先输入 " + pc.name + " 的 Key", "err"); return; }
        setStatus("测试 " + pc.name + "...", "warn");
        var base = pc.base;
        /* 用该厂商自己的模型测试，而非写死 deepseek-chat */
        var testModel = "deepseek-chat";
        for (var mi = 0; mi < MODEL_LIST.length; mi++) {
            if (MODEL_PROVIDER_MAP[MODEL_LIST[mi]] === providerId) { testModel = MODEL_LIST[mi]; break; }
        }
        var testBtn = document.querySelector('.prov-test-s[data-prov="' + providerId + '"]');
        var card = testBtn ? testBtn.closest(".mk-card") : null;
        function mark(state) { if (card) { card.classList.remove("ok", "err"); if (state) card.classList.add(state); } }
        if (testBtn) { testBtn.textContent = "···"; testBtn.classList.remove("ok"); }
        mark(null);
        GM_xmlhttpRequest({
            method: "POST",
            url: base + "/chat/completions",
            headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
            data: JSON.stringify({ model: testModel, messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
            timeout: 15000,
            onload: function(r) {
                var ok = r.status >= 200 && r.status < 300;
                if (ok) {
                    setStatus(pc.name + " ✓", "ok"); log(pc.name + " API 连接正常"); mark("ok");
                    if (testBtn) { testBtn.textContent = "✓"; setTimeout(function() { if (testBtn.textContent === "✓") testBtn.textContent = "测试"; }, 2000); }
                } else {
                    setStatus(pc.name + " 失败: " + r.status, "err"); log(pc.name + " API 测试失败: " + r.status); mark("err");
                    if (testBtn) testBtn.textContent = "测试";
                }
            },
            onerror: function(r) {
                setStatus(pc.name + " 连接失败: " + r.status, "err"); log(pc.name + " API 测试失败(网络/被拦截): " + r.status); mark("err");
                if (testBtn) testBtn.textContent = "测试";
            },
            ontimeout: function() {
                setStatus(pc.name + " 超时", "err"); log(pc.name + " API 测试超时"); mark("err");
                if (testBtn) testBtn.textContent = "测试";
            }
        });
    }

    function sleep(ms) {
        return new Promise(function(resolve) {
            var interval = 100;
            var elapsed = 0;
            var timer = setInterval(function() {
                elapsed += interval;
                if (!isRunning || elapsed >= ms) {
                    clearInterval(timer);
                    resolve();
                }
            }, interval);
        });
    }

    /* ===== 题目抓取 ===== */
    /* ===== 跨同源 iframe 文档收集（脚本仅在顶层运行，主动递归进入同源 iframe） ===== */
    function collectDocs() {
        var docs = [document];
        (function walk(doc) {
            var frames;
            try { frames = doc.querySelectorAll("iframe, frame"); } catch (e) { return; }
            Array.prototype.forEach.call(frames, function(f) {
                var d = null;
                try { d = f.contentDocument || (f.contentWindow && f.contentWindow.document); } catch (e) { d = null; }
                if (d && d !== doc && docs.indexOf(d) === -1) { docs.push(d); walk(d); }
            });
        })(document);
        return docs;
    }
    function queryAllDeep(sel) {
        var out = [];
        collectDocs().forEach(function(d) {
            try { Array.prototype.forEach.call(d.querySelectorAll(sel), function(el) { out.push(el); }); } catch (e) {}
        });
        return out;
    }

    function getQuestionType(el) {
        /* 1) 题型标签：newTiMu 的【单选题】在 .newZy_TItle；兼容 colorShallow / mark_name */
        var labels = el.querySelectorAll(".newZy_TItle, .colorShallow, .mark_name");
        for (var i = 0; i < labels.length; i++) {
            var t = labels[i].textContent || "";
            if (/单选|A1\s*型/.test(t)) return "单选题";
            if (/多选|X\s*型/.test(t)) return "多选题";
            if (/判断/.test(t)) return "判断题";
            if (/填空/.test(t)) return "填空题";
            if (/简答|论述|名词解释|计算|主观|问答/.test(t)) return "简答题";
        }
        /* 2) data / qtype 编码：.TiMu[data] 或 li[qtype] */
        var timu = (el.classList && el.classList.contains("TiMu")) ? el : el.querySelector(".TiMu");
        var code = timu ? timu.getAttribute("data") : null;
        if (code == null) { var qe = el.querySelector("[qtype]"); if (qe) code = qe.getAttribute("qtype"); }
        if (code != null && code !== "" && !isNaN(parseInt(code, 10))) {
            var c = parseInt(code, 10);
            if (c === 1) return "多选题";
            if (c === 2) return "填空题";
            if (c === 3) return "简答题";
            if (c === 0) {
                var lis = el.querySelectorAll(".Zy_ulTop li, .Cy_ulTop li");
                if (lis.length === 2 && /对|错|正确|错误/.test(lis[0].textContent + lis[1].textContent)) return "判断题";
                return "单选题";
            }
        }
        /* 3) 兜底：输入控件 */
        if (el.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length > 0) return "多选题";
        var radios = el.querySelectorAll('input[type="radio"], [role="radio"]');
        if (radios.length > 0) return radios.length <= 2 ? "判断题" : "单选题";
        var tas = el.querySelectorAll("textarea");
        if (tas.length > 0) return (el.textContent.indexOf("___") !== -1 || el.textContent.indexOf("（）") !== -1 || el.textContent.indexOf("()") !== -1) ? "填空题" : "简答题";
        return "未知";
    }

    /* ===== 字体反爬解码：依赖配套解码器脚本 cx-font-decoder 暴露的 __cxFontDecode ===== */
    var CX_FONT_URL = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
    function cxDecoder() {
        try { if (typeof unsafeWindow !== "undefined" && unsafeWindow.__cxFontDecode) return unsafeWindow.__cxFontDecode; } catch (e) {}
        if (window.__cxFontDecode) return window.__cxFontDecode;
        return null;
    }
    function getSecFontUrl(doc) {
        if (CX_FONT_URL && CX_FONT_URL.has(doc)) return CX_FONT_URL.get(doc);
        var url = "";
        try {
            var styles = doc.querySelectorAll("style");
            for (var i = 0; i < styles.length; i++) {
                var t = styles[i].textContent || "";
                var m = t.match(/font-cxsecret[^}]*?url\(\s*["']?(data:[^"')]+)/i);
                if (m) { url = m[1]; break; }
            }
        } catch (e) {}
        if (CX_FONT_URL) CX_FONT_URL.set(doc, url);
        return url;
    }
    function elObfuscated(el) {
        try { var d = el.ownerDocument || document; return !!(d.querySelector && d.querySelector(".font-cxsecret")); } catch (e) { return false; }
    }
    function cxDecode(el, text) {
        if (!text) return text;
        var dec = cxDecoder(); if (!dec) return text;
        var url = getSecFontUrl(el.ownerDocument || document); if (!url) return text;
        try { return dec(text, url); } catch (e) { return text; }
    }
    var DECODER_INSTALL_URL = "https://cdn.jsdelivr.net/gh/Lithum-12/chaoxing-answer-helper@main/cx-font-decoder.user.js";
    var _decoderPrompted = false;
    /* 检测到字体加密题但没装配套解码器时，提示安装 */
    function checkDecoderMissing(questions) {
        if (cxDecoder()) return false;
        var obf = questions.some(function(q) { return elObfuscated(q.element); });
        if (!obf) return false;
        if (!_decoderPrompted) {
            _decoderPrompted = true;
            log("检测到字体加密题目，需安装配套「字体解码器」才能正确作答");
            try {
                GM_notification({
                    title: "学习通助手：需要字体解码器",
                    text: "本页题目被字体加密，请安装配套解码器脚本后刷新重试。",
                    timeout: 8000
                });
            } catch (e) {}
            if (confirm("检测到学习通字体加密题目，当前未安装配套「字体解码器」，无法正确读取题干。\n\n点「确定」打开发码器安装页面，安装后刷新本页再答题。")) {
                try { GM_openInTab(DECODER_INSTALL_URL, { active: true }); } catch (e) { window.open(DECODER_INSTALL_URL, "_blank"); }
            }
        }
        return true;
    }

    function getQuestionText(el) {
        var sels = [".Zy_TItle", ".Cy_TItle .clearfix", ".qtContent", "h3", ".mark_name"];
        for (var i = 0; i < sels.length; i++) {
            var e = el.querySelector(sels[i]);
            if (e && e.textContent.trim()) {
                var t = e.textContent.replace(/\s+/g, " ").trim();
                var b = e.querySelector(".colorShallow, .newZy_TItle");
                if (b) t = t.replace(b.textContent.replace(/\s+/g, " ").trim(), " ");
                t = t.replace(/【[^】]*】/g, " ").replace(/^\s*\d+\s*[\.、\)）]?\s*/, "").trim();
                if (t) return t;
            }
        }
        return el.textContent.replace(/【[^】]*】/g, " ").replace(/\s+/g, " ").trim();
    }

    function getOptions(el) {
        var opts = [];
        /* 简答题、填空题不抓选项 */
        var type = getQuestionType(el);
        if (type === "简答题" || type === "填空题") return opts;
        var items = el.querySelectorAll(".answerBg, .Zy_ulTop li, .Cy_ulTop li, .mark_letter li, .Zy_ulBottom li, .qtDetail li");
        if (items.length > 0) {
            items.forEach(function(it) {
                var letter = it.querySelector(".num_option, .num_option_dx");
                var text = it.querySelector(".answer_p, .ctTk, .ctKt, a.after, .fl.after");
                var lt = letter ? letter.textContent.trim() : "";
                if (text && text.textContent.trim()) {
                    opts.push((lt ? lt + " " : "") + text.textContent.replace(/\s+/g, " ").trim());
                } else if (it.textContent.trim()) {
                    var full = it.textContent.replace(/\s+/g, " ").trim();
                    opts.push(lt && full.indexOf(lt) !== 0 ? (lt + " " + full) : full);
                }
            });
            if (opts.length > 0) return opts;
        }
        el.querySelectorAll("label").forEach(function(l) { if (l.textContent.trim()) opts.push(l.textContent.trim()); });
        if (opts.length > 0) return opts;
        el.querySelectorAll("li").forEach(function(l) { if (l.textContent.trim()) opts.push(l.textContent.trim()); });
        return opts;
    }

    function extractImages(el) {
        var urls = [];
        el.querySelectorAll("img").forEach(function(img) {
            var src = img.src || img.getAttribute("data-original") || "";
            if (src && src.indexOf("data:") !== 0) {
                if (src.indexOf("//") === 0) src = "https:" + src;
                urls.push(src);
            }
        });
        return urls;
    }

    function scrapeAll() {
        var items = [];
        /* 优先用 questionLi，没有再用 TiMu；跨同源 iframe 收集 */
        var qlis = queryAllDeep(".questionLi");
        var tmus = queryAllDeep(".TiMu");
        var seen = new Set();
        /* 收集所有 questionLi */
        qlis.forEach(function(el) {
            var key = el.textContent.substring(0, 50);
            if (!seen.has(key)) { seen.add(key); items.push(el); }
        });
        /* 补充没有被 questionLi 覆盖的 TiMu */
        tmus.forEach(function(el) {
            var hasQli = el.querySelector(".questionLi");
            if (!hasQli) {
                var key = el.textContent.substring(0, 50);
                if (!seen.has(key)) { seen.add(key); items.push(el); }
            }
        });
        return items.map(function(el, i) {
            return {
                index: i,
                element: el,
                question: cxDecode(el, getQuestionText(el) || ("第" + (i + 1) + "题")),
                options: getOptions(el).map(function(o) { return cxDecode(el, o); }),
                question_type: getQuestionType(el),
                images: extractImages(el)
            };
        });
    }

    /* ===== 答案清洗 ===== */
    function cleanAnswer(raw, qType) {
        var a = raw.trim();
        if (qType === "单选题" || qType === "判断题") {
            /* 单选/判断：只取第一个字母或关键词 */
            var m = a.match(/^[A-D正确错误对错]/);
            if (m) return m[0];
        } else if (qType === "多选题") {
            /* 多选：只取所有 ABCD 字母（忽略大小写） */
            var ms = a.toUpperCase().match(/[A-D]/g);
            if (ms) { return ms.join(","); }
            log("cleanAnswer 多选题未匹配到字母，原始: " + a.substring(0, 50));
        } else if (qType === "填空题") {
            return a;
        }
        /* 简答题：原样返回，让 AI 自己控制输出 */
        return a;
    }
    function imgToBase64(url) {
        return new Promise(function(resolve) {
            GM_xmlhttpRequest({
                method: "GET", url: url, responseType: "blob", timeout: 10000,
                onload: function(r) {
                    var fr = new FileReader();
                    fr.onloadend = function() { resolve(fr.result); };
                    fr.readAsDataURL(r.response);
                },
                onerror: function() { resolve(null); },
                ontimeout: function() { resolve(null); }
            });
        });
    }

    /* ===== AI 调用 ===== */
    /* ===== 底层聊天请求 ===== */
    function rawChat(useModel, messages, maxTokens) {
        return new Promise(function(resolve, reject) {
            var providerId = getModelProvider(useModel);
            var key = getProviderKey(providerId);
            if (!key) { reject(new Error("未配置 " + (PROVIDER_CONFIG[providerId] ? PROVIDER_CONFIG[providerId].name : providerId) + " 的 API Key")); return; }
            var baseUrl = getProviderBase(providerId);
            var req = GM_xmlhttpRequest({
                method: "POST",
                url: baseUrl + "/chat/completions",
                headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
                data: JSON.stringify({
                    model: useModel,
                    messages: messages,
                    max_tokens: maxTokens || MAX_TOKENS,
                    temperature: TEMP
                }),
                timeout: 120000,
                onload: function(r) {
                    currentRequest = null;
                    try {
                        var j = JSON.parse(r.responseText);
                        if (j.error) { reject(new Error(j.error.message)); return; }
                        if (j.usage) {
                            var pt = j.usage.prompt_tokens || 0;
                            var ct = j.usage.completion_tokens || 0;
                            saveUsage(pt, ct);
                            saveModelUsage(useModel, pt, ct);
                            saveUsageLog(useModel, pt, ct);
                        }
                        resolve({ answer: j.choices[0].message.content.trim(), model: useModel });
                    } catch(e) { reject(new Error("解析响应失败: " + e.message)); }
                },
                onerror: function(r) { currentRequest = null; reject(new Error("网络错误: " + r.status)); },
                ontimeout: function() { currentRequest = null; reject(new Error("请求超时")); }
            });
            currentRequest = req;
        });
    }

    /* 构建单题 user 内容（纯文本→字符串；带图→数组，兼容严格厂商） */
    function buildUserContent(qData) {
        var textContent = "题目：" + qData.question;
        if (qData.options.length > 0) textContent += "\n选项：\n" + qData.options.join("\n");
        textContent += "\n题型：" + qData.question_type + "\n请给出正确答案。";
        if (!qData.images.length) return Promise.resolve(textContent);
        return Promise.all(qData.images.map(imgToBase64)).then(function(b64s) {
            var parts = [{ type: "text", text: textContent }];
            var hasImg = false;
            b64s.forEach(function(b) { if (b) { hasImg = true; parts.push({ type: "image_url", image_url: { url: b } }); } });
            return hasImg ? parts : textContent;
        });
    }

    function activeModel(qData) {
        return SESSION_MODE === "independent" ? (TYPE_MODELS[qData.question_type] || "deepseek-chat") : SESSION_MODEL;
    }

    /* ===== 单题调用（independent / session 模式） ===== */
    function callAI(qData) {
        var useModel = activeModel(qData);
        return buildUserContent(qData).then(function(userContent) {
            if (SESSION_MODE === "session") {
                if (!SESSION.messages) SESSION.messages = [{ role: "system", content: getSystemPrompt() }];
                SESSION.messages.push({ role: "user", content: userContent });
                return rawChat(useModel, SESSION.messages.slice()).then(function(res) {
                    SESSION.messages.push({ role: "assistant", content: res.answer });
                    return res;
                }, function(err) { SESSION.messages.pop(); throw err; });
            }
            return rawChat(useModel, [
                { role: "system", content: getSystemPrompt() },
                { role: "user", content: userContent }
            ]);
        });
    }

    /* ===== 整卷批量（batch 模式） ===== */
    function callAIBatch(questions) {
        var useModel = SESSION_MODEL;
        var lines = questions.map(function(q, i) {
            var s = (i + 1) + ". [" + q.question_type + "] " + q.question;
            if (q.options.length) s += "\n   选项：" + q.options.join(" | ");
            return s;
        }).join("\n\n");
        var sys = getSystemPrompt() + "\n\n批量作答规则：按题目序号逐行输出，每行格式为「序号. 答案」，序号必须与题目一致，不要输出多余解释。";
        var userMsg = "请依次回答以下 " + questions.length + " 道题：\n\n" + lines;
        return rawChat(useModel, [
            { role: "system", content: sys },
            { role: "user", content: userMsg }
        ], Math.max(MAX_TOKENS, questions.length * 200)).then(function(res) {
            return { answers: parseBatch(res.answer, questions.length), model: useModel, raw: res.answer };
        });
    }

    function parseBatch(text, n) {
        var out = [];
        for (var k = 0; k < n; k++) out.push("");
        var re = /(^|\n)[ \t]*(\d+)[ \t]*[\.、:：\)）][ \t]*/g;
        var marks = [], m;
        while ((m = re.exec(text))) {
            marks.push({ num: parseInt(m[2], 10), begin: m.index + m[1].length, content: m.index + m[0].length });
        }
        for (var i = 0; i < marks.length; i++) {
            var idx = marks[i].num - 1;
            if (idx < 0 || idx >= n) continue;
            var cend = (i + 1 < marks.length) ? marks[i + 1].begin : text.length;
            var seg = text.slice(marks[i].content, cend).trim();
            if (!out[idx]) out[idx] = seg;
        }
        return out;
    }

    /* ===== 强力触发事件 ===== */
    function fireEvents(el) {
        var evts = ["mousedown", "mouseup", "click", "change", "input"];
        evts.forEach(function(name) {
            try { el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true })); } catch(e) {}
        });
        /* jQuery 触发 */
        try { if (typeof unsafeWindow.$ !== "undefined") { unsafeWindow.$(el).trigger("click").trigger("change"); } } catch(e) {}
        try { if (typeof $ !== "undefined") { $(el).trigger("click").trigger("change"); } } catch(e) {}
    }

    /* ===== 通用填入逻辑 ===== */
    function fillTextInput(el, values) {
        /* 尝试多方式填入 */
        var allInputs = el.querySelectorAll('input[type="text"], input:not([type])');
        if (allInputs.length > 0) {
            log("找到 " + allInputs.length + " 个 input");
            allInputs.forEach(function(inp, i) {
                inp.value = values[i] || values[0] || "";
                inp.style.display = "";
                inp.style.visibility = "visible";
                fireEvents(inp);
            });
            return;
        }
        /* contenteditable */
        var ces = el.querySelectorAll('[contenteditable="true"]');
        if (ces.length > 0) {
            var best = ces[ces.length - 1];
            best.innerHTML = (values[0] || "").replace(/\n/g, "<br>");
            fireEvents(best);
            log("通过 contentEditable 填入");
            return;
        }
        /* iframe */
        fillIframeBody(el, values[0] || "");
    }

    /* ===== iframe编辑器填入 ===== */
    function fillIframeBody(el, content) {
        var ifs = el.querySelectorAll("iframe");
        for (var fi = 0; fi < ifs.length; fi++) {
            var f = ifs[fi];
            try {
                var fDoc = f.contentDocument || f.contentWindow.document;
                if (fDoc) {
                    var fBody = fDoc.querySelector("body");
                    if (fBody) {
                        fBody.innerHTML = content.replace(/\n/g, "<br>");
                        log("通过 iframe[" + (f.id || fi) + "] body 填入");
                        return;
                    }
                }
            } catch(e) {}
        }
        log("未找到填入位置");
    }

    /* ===== 检测并填入 UEditor + 撑开高度 ===== */
    function fillUEditor(el, content) {
        var tas = el.querySelectorAll("textarea");
        var filled = false;
        tas.forEach(function(ta) {
            var taId = ta.id;
            if (!taId) return;
            try {
                var editor = null;
                try { editor = window.UE && window.UE.getEditor && window.UE.getEditor(taId); } catch(e) {}
                if (!editor) {
                    try {
                        if (window.UE && window.UE.instances && window.UE.instances[taId]) {
                            editor = window.UE.instances[taId];
                        }
                    } catch(e) {}
                }
                if (editor && typeof editor.setContent === "function") {
                    editor.setContent(content);
                    log("通过 UEditor[" + taId + "] 填入");
                    filled = true;
                }
            } catch(e) { log("UEditor 填入失败: " + e.message); }
        });
        if (!filled) {
            fillIframeBody(el, content);
        }
        /* 吃完内容后强制撑开编辑器高度 */
        setTimeout(function() {
            autoExpandEditor(el);
        }, 300);
    }

    /* ===== 强制撑开编辑器 ===== */
    function autoExpandEditor(el) {
        var ifrs = el.querySelectorAll("iframe[id^=ueditor], iframe[id^=cke], iframe");
        ifrs.forEach(function(f) {
            try {
                var fDoc = f.contentDocument || f.contentWindow.document;
                if (!fDoc) return;
                var fBody = fDoc.querySelector("body") || fDoc.body;
                if (!fBody) return;
                /* 获取内容真实高度 */
                var contentH = Math.max(fBody.scrollHeight, 200);
                /* 1. iframe body 设为自动 */
                fBody.style.cssText = (fBody.style.cssText || "") + ";height:auto !important;min-height:" + contentH + "px !important;overflow:visible !important;";
                fBody.style.height = "auto";
                fBody.style.minHeight = contentH + "px";
                fBody.style.overflow = "visible";
                /* 2. iframe 本身设高度 */
                f.style.height = contentH + "px";
                f.setAttribute("height", contentH);
                /* 3. iframe 父容器 */
                if (f.parentElement) {
                    f.parentElement.style.height = contentH + "px";
                    f.parentElement.style.overflow = "visible";
                    /* 4. 编辑器最外层容器 */
                    var outer = f.parentElement.parentElement || f.parentElement;
                    outer.style.height = "auto";
                    outer.style.minHeight = contentH + "px";
                    outer.style.overflow = "visible";
                    var outer2 = outer.parentElement;
                    if (outer2) {
                        outer2.style.height = "auto";
                        outer2.style.overflow = "visible";
                    }
                }
                log("编辑器已撑开至 " + contentH + "px");
            } catch(e) { log("撑开高度失败: " + e.message); }
        });
    }

    /* ===== 答案填入 ===== */
    function fillAnswer(el, answer, type) {
        log("填入: " + (type === "简答题" ? answer.substring(0, 80) + "..." : answer));
        var a = answer.trim();
        switch (type) {
            case "单选题": {
                var letter = a.toUpperCase();
                var options = el.querySelectorAll(".answerBg, .Cy_ulTop li, .Zy_ulTop li, .mark_letter li, .Zy_ulBottom li");
                options.forEach(function(opt) {
                    var txt = opt.textContent.trim();
                    if (txt.indexOf(letter) === 0 || txt.indexOf(letter + ".") === 0 || txt.indexOf(letter + "、") === 0) {
                        fireEvents(opt);
                        try { opt.click(); } catch (e) {}
                        var radio = opt.querySelector('input[type="radio"]');
                        if (radio) { radio.checked = true; fireEvents(radio); try { radio.click(); } catch (e) {} }
                        var label = opt.querySelector("label");
                        if (label) { fireEvents(label); try { label.click(); } catch (e) {} }
                        try { if (typeof unsafeWindow !== "undefined" && typeof unsafeWindow.$ !== "undefined") unsafeWindow.$(opt).trigger("click"); } catch(e){}
                    }
                });
                /* 后备：直接操作 radio */
                el.querySelectorAll('input[type="radio"]').forEach(function(r, i) {
                    if (String.fromCharCode(65 + i) === letter) {
                        r.checked = true;
                        fireEvents(r);
                        (r.closest("label") || r.parentElement || r).click();
                    }
                });
                break;
            }
            case "多选题": {
                var letters = a.toUpperCase().split(/[,，、\s]+/).filter(function(s) { return s; });
                letters.forEach(function(letter) {
                    /* 仿照单选题逻辑：按文本匹配选项容器 */
                    var options = el.querySelectorAll(".answerBg, .Cy_ulTop li, .Zy_ulTop li, .mark_letter li, .Zy_ulBottom li");
                    var matched = false;
                    options.forEach(function(opt) {
                        var txt = opt.textContent.trim();
                        if (txt.indexOf(letter) === 0 || txt.indexOf(letter + ".") === 0 || txt.indexOf(letter + "、") === 0) {
                            matched = true;
                            fireEvents(opt); opt.click();
                            var cb = opt.querySelector('input[type="checkbox"]');
                            if (cb) { cb.checked = true; fireEvents(cb); }
                            var label = opt.querySelector("label");
                            if (label) { fireEvents(label); label.click(); }
                            try { if (typeof unsafeWindow !== "undefined" && typeof unsafeWindow.$ !== "undefined") unsafeWindow.$(opt).trigger("click"); } catch(e){}
                        }
                    });
                    /* 后备：按索引操作 */
                    if (!matched) {
                        el.querySelectorAll('input[type="checkbox"]').forEach(function(c, i) {
                            if (String.fromCharCode(65 + i) === letter) {
                                c.checked = true; fireEvents(c);
                                (c.closest("label") || c.parentElement || c).click();
                            }
                        });
                    }
                });
                break;
            }
            case "判断题": {
                var isTrue = a.indexOf("正确") !== -1 || a.indexOf("对") !== -1 || a === "A" || a.toLowerCase() === "true";
                el.querySelectorAll(".answerBg, .Cy_ulTop li, .Zy_ulTop li").forEach(function(opt) {
                    var txt = opt.textContent;
                    if ((isTrue && (txt.indexOf("正确") !== -1 || txt.indexOf("对") !== -1)) ||
                        (!isTrue && (txt.indexOf("错误") !== -1 || txt.indexOf("错") !== -1))) {
                        fireEvents(opt);
                        try { opt.click(); } catch (e) {}
                        var radio = opt.querySelector('input[type="radio"]');
                        if (radio) { radio.checked = true; fireEvents(radio); try { radio.click(); } catch (e) {} }
                        var label = opt.querySelector("label");
                        if (label) { fireEvents(label); try { label.click(); } catch (e) {} }
                        try { if (typeof unsafeWindow !== "undefined" && typeof unsafeWindow.$ !== "undefined") unsafeWindow.$(opt).trigger("click"); } catch(e){}
                    }
                });
                el.querySelectorAll('input[type="radio"]').forEach(function(r) {
                    var t = (r.closest("label") || r.parentElement).textContent;
                    if ((isTrue && (t.indexOf("正确") !== -1 || t.indexOf("对") !== -1)) ||
                        (!isTrue && (t.indexOf("错误") !== -1 || t.indexOf("错") !== -1))) {
                        r.checked = true;
                        fireEvents(r);
                        (r.closest("label") || r.parentElement || r).click();
                    }
                });
                break;
            }
            case "填空题": {
                var vals = a.replace(/[（）()]/g, "").split(/[,，、;；]/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
                log("填空题答案: " + vals.join(" | "));
                setTimeout(function() {
                    fillTextInput(el, vals);
                }, 300);
                break;
            }
            case "简答题": {
                log("填入简答题答案...");
                setTimeout(function() {
                    fillUEditor(el, a);
                }, 300);
                break;
            }
        }
    }

    /* ===== 逐题处理 ===== */
    async function processOne(q) {
        log("第" + (q.index + 1) + "题 [" + q.question_type + "]");
        try {
            var result = await callAI(q);
            var answer = cleanAnswer(result.answer, q.question_type);
            log("答案: " + answer.substring(0, 100) + (answer.length > 100 ? "..." : ""));
            fillAnswer(q.element, answer, q.question_type);
            q.element.classList.remove("cx-highlight", "cx-done");
            saveAnsweredQuestion(q, answer, result.model);
            answeredCount++;
            updateProgress();
            return true;
        } catch (e) {
            log("失败: " + e.message);
            q.element.classList.remove("cx-highlight");
            return false;
        }
    }

    /* ===== 主流程 ===== */
    async function startAnswering() {
        if (isRunning) return;
        detectCourseInfo();
        /* 检测至少有一个供应商配置了 Key */
        var hasAnyKey = false;
        for (var pi = 0; pi < PROVIDER_ORDER.length; pi++) {
            if (getProviderKey(PROVIDER_ORDER[pi])) { hasAnyKey = true; break; }
        }
        if (!hasAnyKey) { setStatus("请先输入至少一个供应商的 API Key", "err"); return; }

        document.getElementById("cx-start").disabled = true;
        document.getElementById("cx-stop").disabled = false;
        isRunning = true;
        answeredCount = 0;
        if (panel) panel.classList.add("running");

        var questions = scrapeAll();
        totalQuestions = questions.length;
        updateProgress();

        if (totalQuestions === 0) {
            log("未找到题目");
            setStatus("未找到题目", "err");
            isRunning = false;
            if (panel) panel.classList.remove("running");
            document.getElementById("cx-start").disabled = false;
            document.getElementById("cx-stop").disabled = true;
            return;
        }

        if (checkDecoderMissing(questions)) {
            setStatus("需安装字体解码器", "err");
            isRunning = false;
            if (panel) panel.classList.remove("running");
            document.getElementById("cx-start").disabled = false;
            document.getElementById("cx-stop").disabled = true;
            return;
        }

        var modeLabel = SESSION_MODE === "batch" ? "整卷批量" : (SESSION_MODE === "session" ? "累积会话" : "逐题独立");
        log("找到 " + totalQuestions + " 题，开始答题（" + modeLabel + "）");
        setStatus("答题中...", "ok");
        resetUsage();
        SESSION.messages = null; /* 每轮开始重置会话上下文 */

        /* 批量模式：整卷一次请求 */
        if (SESSION_MODE === "batch") {
            try {
                var batchRes = await callAIBatch(questions);
                for (var bi = 0; bi < questions.length; bi++) {
                    if (!isRunning) break;
                    var bq = questions[bi];
                    var bans = cleanAnswer(batchRes.answers[bi] || "", bq.question_type);
                    log("第" + (bi + 1) + "题答案: " + bans.substring(0, 80) + (bans.length > 80 ? "..." : ""));
                    fillAnswer(bq.element, bans, bq.question_type);
                    bq.element.classList.remove("cx-highlight", "cx-done");
                    saveAnsweredQuestion(bq, bans, batchRes.model);
                    answeredCount++;
                    updateProgress();
                    if (BATCH_STAGGER && bi < questions.length - 1) await sleep(DELAY_MS);
                }
            } catch (e) {
                log("批量答题失败: " + e.message);
                setStatus("批量失败: " + e.message, "err");
            }
            if (isRunning) {
                log("批量完成！");
                setStatus("完成 ✓", "ok");
                try { GM_notification({ title: "学习通答题完成", text: "已完成 " + answeredCount + "/" + totalQuestions + " 题", timeout: 5000 }); } catch(e) {}
            }
            isRunning = false;
            if (panel) panel.classList.remove("running");
            document.getElementById("cx-start").disabled = false;
            document.getElementById("cx-stop").disabled = true;
            return;
        }

        for (var i = 0; i < questions.length; i++) {
            if (!isRunning) break;
            document.querySelectorAll(".cx-highlight").forEach(function(e) { e.classList.remove("cx-highlight"); });
            await processOne(questions[i]);
            if (i < questions.length - 1) await sleep(DELAY_MS);
        }

        if (isRunning) {
            log("全部完成！");
            setStatus("完成 ✓", "ok");
            try { GM_notification({ title: "学习通答题完成", text: "已完成 " + answeredCount + "/" + totalQuestions + " 题", timeout: 5000 }); } catch(e) {}
        }
        isRunning = false;
        if (panel) panel.classList.remove("running");
        document.getElementById("cx-start").disabled = false;
        document.getElementById("cx-stop").disabled = true;
    }

    function stopAnswering() {
        isRunning = false;
        if (panel) panel.classList.remove("running");
        if (currentRequest && typeof currentRequest.abort === "function") {
            try { currentRequest.abort(); } catch(e) {}
            currentRequest = null;
        }
        /* 清除所有高亮 */
        document.querySelectorAll(".cx-highlight, .cx-done").forEach(function(e) {
            e.classList.remove("cx-highlight", "cx-done");
        });
        setStatus("已停止", "warn");
        log("已手动停止");
        document.getElementById("cx-start").disabled = false;
        document.getElementById("cx-stop").disabled = true;
    }

    /* ===== 调试 ===== */
    function debugQuestions() {
        var used = scrapeAll();
        log("调试：检测到 " + used.length + " 道题");
        used.forEach(function(q, i) {
            log("题" + (i + 1) + " [" + q.question_type + "] 选项" + q.options.length + " 图" + q.images.length + (elObfuscated(q.element) ? " ·字体加密" : "") + " · " + (q.question || "").substring(0, 30));
        });
        setStatus("调试完成", "ok");
    }

    /* ===== 初始化 ===== */
    function init() {
        console.log("[学习通助手] 开始初始化");
        try {
            injectStyles();
            createPanel();
            function scan(hint) {
                var n = queryAllDeep(".questionLi, .TiMu").length;
                if (n > 0) { log("检测到 " + n + " 道题" + (hint ? "（含 iframe）" : "")); setStatus("已检测 " + n + " 题", "ok"); }
                else { log("未检测到题目，请在考试/作业页面使用"); }
                return n;
            }
            if (scan(false) === 0) {
                /* iframe 内容常异步加载，延迟再探测一次 */
                setTimeout(function() { scan(true); }, 2000);
            }
        } catch (e) {
            console.error("[学习通助手] 初始化失败:", e);
        }
    }

    /* document-body 下 body 已存在，直接初始化 */
    init();
    console.log("[学习通助手] 脚本初始化完成");

    // 控制台使用说明
    function showUsageGuide() {
        console.log('%c📚 学习通自动答题助手 Next 使用说明 v' + VERSION, 'color: #165DFF; font-size: 18px; font-weight: bold; padding: 8px 0;');
        console.log('%c----------------------------------------', 'color: #E5E7EB;');
        
        console.group('%c🔧 核心功能', 'color: #36D399; font-size: 15px; font-weight: bold;');
        console.log('%c✅ 支持 8 家主流供应商（DeepSeek/OpenAI/Anthropic/Gemini/通义/智谱/Kimi/MiniMax）', 'color: #333; line-height: 1.6;');
        console.log('%c✅ 自动识别课程/作业信息，支持手动覆盖', 'color: #333; line-height: 1.6;');
        console.log('%c✅ 单/多/判断/填空/简答自动识别填写，兼容同源 iframe 与 newTiMu 页面', 'color: #333; line-height: 1.6;');
        console.log('%c✅ 支持独立/会话/整卷批量三种模式，提升缓存命中与风格一致', 'color: #333; line-height: 1.6;');
        console.log('%c✅ 答题记录按课程>作业分类导出（JSON/CSV/TXT/HTML）', 'color: #333; line-height: 1.6;');
        console.log('%c✅ 答题统计可视化（环形图/折线图）', 'color: #333; line-height: 1.6;');
        console.groupEnd();
        
        console.group('%c📖 使用方法', 'color: #F59E0B; font-size: 15px; font-weight: bold;');
        console.log('%c1. 配置API：悬停右上角悬浮按钮 → 更多 → 模型配置 → 填写供应商 Key', 'color: #333; line-height: 1.6;');
        console.log('%c2. 启动答题：进入学习通作业页面 → 悬停悬浮按钮 → 「开始答题」', 'color: #333; line-height: 1.6;');
        console.log('%c3. 查看统计：悬停悬浮按钮 → 「更多」→ 仪表盘 / 控制台', 'color: #333; line-height: 1.6;');
        console.log('%c4. 导出记录：更多 → 题目导出 → 选择格式 → 自动下载', 'color: #333; line-height: 1.6;');
        console.groupEnd();
        
        console.group('%c⚠️ 注意事项', 'color: #EF4444; font-size: 15px; font-weight: bold;');
        console.log('%c• 请遵守学校及平台使用规定，合理使用', 'color: #333; line-height: 1.6;');
        console.log('%c• 多选题请确认答案选项完整，避免漏选', 'color: #333; line-height: 1.6;');
        console.log('%c• 课程信息可在「系统设置」中手动修改', 'color: #333; line-height: 1.6;');
        console.groupEnd();
        
        console.group('%c⌨️ 控制台快捷命令', 'color: #8B5CF6; font-size: 15px; font-weight: bold;');
        console.log('%c• chaoxingHelp()：再次查看本使用说明', 'color: #333; line-height: 1.6;');
        console.log('%c• chaoxingVersion：查看当前脚本版本', 'color: #333; line-height: 1.6;');
        console.groupEnd();
        
        console.log('%c----------------------------------------', 'color: #E5E7EB;');
        console.log('%c💡 如有问题，请检查控制台报错或联系开发者', 'color: #666; font-style: italic;');
    }

    // 脚本加载时自动显示一次说明
    setTimeout(showUsageGuide, 1000);

    // 暴露快捷命令到页面控制台
    window.chaoxingHelp = showUsageGuide;
    window.chaoxingVersion = function() {
        console.log('%c当前版本：v' + VERSION, 'color: #165DFF; font-weight: bold;');
    };

})();
