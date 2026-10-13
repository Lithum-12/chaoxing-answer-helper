/* Build cx-font-decoder.user.js: header + logic + inlined base64 hash map */
const fs = require("fs");
const path = require("path");
const DIR = __dirname;
const mapB64 = fs.readFileSync(path.join(DIR, "cx_font_map.b64"), "utf8").trim();

const LOGIC = String.raw`
(function () {
    var W = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;
    if (W.__cxFontDecode) return;

    var VERSION = "1.0.0";
    var MAP_B64 = "__MAP_B64__";

    /* ---- MD5 (RFC1321, K table computed from sin to avoid transcription errors) ---- */
    var md5 = (function () {
        var K = [];
        for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
        var S = [7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
                 5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
                 4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
                 6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21];
        function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
        function add(x, y) { var l = (x & 0xFFFF) + (y & 0xFFFF); var m = (x >>> 16) + (y >>> 16) + (l >>> 16); return (m << 16) | (l & 0xFFFF); }
        return function (str) {
            var bytes = []; for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xFF);
            var ml = bytes.length * 8;
            bytes.push(0x80);
            while (bytes.length % 64 !== 56) bytes.push(0);
            for (var b = 0; b < 8; b++) bytes.push((ml / Math.pow(2, 8 * b)) & 0xFF);
            var a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;
            for (var off = 0; off < bytes.length; off += 64) {
                var M = []; for (var j = 0; j < 16; j++) M[j] = bytes[off + j*4] | (bytes[off + j*4 + 1] << 8) | (bytes[off + j*4 + 2] << 16) | (bytes[off + j*4 + 3] << 24);
                var A = a0, B = b0, C = c0, D = d0;
                for (var k = 0; k < 64; k++) {
                    var F, g;
                    if (k < 16) { F = (B & C) | (~B & D); g = k; }
                    else if (k < 32) { F = (D & B) | (~D & C); g = (5 * k + 1) % 16; }
                    else if (k < 48) { F = B ^ C ^ D; g = (3 * k + 5) % 16; }
                    else { F = C ^ (B | ~D); g = (7 * k) % 16; }
                    F = add(add(add(F, A), add(M[g], K[k])), 0);
                    A = D; D = C; C = B; B = add(B, rotl(F, S[k]));
                }
                a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
            }
            function out(w) { var s = "", h = "0123456789abcdef"; for (var i = 0; i < 4; i++) s += h.charAt((w >> (i * 8 + 4)) & 0xF) + h.charAt((w >> (i * 8)) & 0xF); return s; }
            return out(a0) + out(b0) + out(c0) + out(d0);
        };
    })();

    /* ---- Kangxi radicals -> CJK ---- */
    var KX_A = "一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夊夕大女子寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走足身車辛辰辵邑酉采里金長門阜隶隹雨青非面革韋韭音頁風飛食首香馬骨髟鬥鬯鬲鬼魚鳥鹵鹿麥麻黃黍黑黹黽鼎鼓鼠鼻齊齒龍龜龠";
    var KX_B = "一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈户手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色草虍虫血行衣襾见角言谷豆豕豸贝赤走足身车辛辰辵邑酉采里金长门阜隶隹雨青非面革韦韭音页风飞食首香马骨髟斗鬲鬲鬼鱼鸟卤鹿麦麻黄黍黑黾鼎鼓鼠鼻齐齿龙龟龠";
    var KX = {}; (function(){ for (var i=0;i<KX_A.length;i++){ var a=KX_A.charCodeAt(i); if (a>=0x2E80 && a<=0x2FDF) KX[KX_A[i]] = KX_B[i] || KX_A[i]; } })();

    /* ---- build hash->cp map from base64 blob ---- */
    var HASHMAP = null, ENTRIES = 0;
    function ensureMap() {
        if (HASHMAP) return;
        HASHMAP = new Map();
        var bin = b64ToBytes(MAP_B64);
        for (var i = 0; i + 10 <= bin.length; i += 10) {
            var h = bytesToHex(bin, i, 8);
            var cp = (bin[i + 8] << 8) | bin[i + 9];
            if (!HASHMAP.has(h)) HASHMAP.set(h, cp);
        }
        ENTRIES = HASHMAP.size;
    }
    function b64ToBytes(b64) {
        var s = atob(b64), a = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
        return a;
    }
    function bytesToHex(b, off, len) { var s = ""; for (var i = 0; i < len; i++) s += ("0" + b[off + i].toString(16)).slice(-2); return s; }

    /* ---- TTF parse ---- */
    function parseTables(buf) {
        var num = dv(buf, 4, 16); var t = {};
        for (var i = 0; i < num; i++) { var o = 12 + i * 16; t[str4(buf, o)] = { offset: dv(buf, o + 8, 32) }; }
        return t;
    }
    function dv(buf, o, bits) {
        if (bits === 16) return (buf[o] << 8) | buf[o + 1];
        if (bits === 32) return ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
        return buf[o];
    }
    function ds(buf, o) { return (buf[o] << 8) | buf[o + 1], (buf[o] << 24 >> 16) | buf[o + 1]; }
    function s16(buf, o) { var v = (buf[o] << 8) | buf[o + 1]; return v >= 0x8000 ? v - 0x10000 : v; }
    function str4(buf, o) { return String.fromCharCode(buf[o], buf[o+1], buf[o+2], buf[o+3]); }

    function parseCmap(buf, tables) {
        var c = tables.cmap.offset, n = dv(buf, c + 2, 16), best = -1;
        for (var i = 0; i < n; i++) { var r = c + 4 + i * 8, p = dv(buf, r, 16), e = dv(buf, r + 2, 16), off = dv(buf, r + 4, 32);
            if (p === 3 && (e === 1 || e === 10)) best = c + off; }
        if (best < 0) return {};
        var map = {}, fmt = dv(buf, best, 16);
        if (fmt === 4) {
            var subEnd = best + dv(buf, best + 2, 16); // 子表末尾，越界的 glyphIdArray 读取按 0 处理
            var segX2 = 0, ends = 0;
            var cands = [6, 8];
            for (var ci = 0; ci < cands.length; ci++) {
                var sx = dv(buf, best + cands[ci], 16);
                if (sx > 0 && sx % 2 === 0) { var le = dv(buf, best + 14 + (sx / 2 - 1) * 2, 16); if (le === 0xffff) { segX2 = sx; ends = best + 14; break; } }
            }
            if (!segX2) { segX2 = dv(buf, best + 8, 16); ends = best + 16; }
            var seg = segX2 / 2, starts = ends + segX2, deltas = starts + segX2, ranges = deltas + segX2;
            for (var s = 0; s < seg; s++) {
                var end = dv(buf, ends + s * 2, 16), start = dv(buf, starts + s * 2, 16), delta = s16(buf, deltas + s * 2), ro = dv(buf, ranges + s * 2, 16);
                if (start > end) continue;
                for (var cp = start; cp <= end && cp !== 0xffff; cp++) {
                    var gid;
                    if (ro === 0) gid = (cp + delta) & 0xffff;
                    else { var gi = ranges + s * 2 + ro + (cp - start) * 2; if (gi + 1 >= subEnd) continue; var g = dv(buf, gi, 16); gid = g === 0 ? 0 : (g + delta) & 0xffff; }
                    if (gid) map[cp] = gid;
                }
            }
        } else if (fmt === 12) {
            var groups = dv(buf, best + 12, 32);
            for (var gi2 = 0; gi2 < groups; gi2++) { var g0 = best + 16 + gi2 * 12, sc = dv(buf, g0, 32), ec = dv(buf, g0 + 4, 32), sg = dv(buf, g0 + 8, 32);
                for (var cp2 = sc; cp2 <= ec; cp2++) map[cp2] = sg + (cp2 - sc); }
        }
        return map;
    }

    function glyfHash(buf, tables, gid) {
        var numGlyphs = dv(buf, tables.maxp.offset + 4, 16);
        if (!(gid >= 0 && gid < numGlyphs)) return null;
        var locFmt = s16(buf, tables.head.offset + 50), loca = tables.loca.offset, g1 = gid + 1, off, end;
        if (locFmt === 0) { off = dv(buf, loca + gid * 2, 16) * 2; end = dv(buf, loca + g1 * 2, 16) * 2; }
        else { off = dv(buf, loca + gid * 4, 32); end = dv(buf, loca + g1 * 4, 32); }
        if (off === end) return md5("");
        var base = tables.glyf.offset + off, nc = s16(buf, base);
        if (nc < 0) return md5("");
        var nPoints = dv(buf, base + 10 + (nc - 1) * 2, 16) + 1, p = base + 10 + nc * 2;
        var instr = dv(buf, p, 16); p += 2 + instr;
        var flags = new Uint8Array(nPoints), i = 0;
        while (i < nPoints) { var fl = buf[p++]; flags[i++] = fl; if (fl & 8) { var v = buf[p++]; for (var r = 0; r < v && i < nPoints; r++) flags[i++] = fl; } }
        var coords = [], x = 0;
        for (i = 0; i < nPoints; i++) { var f = flags[i]; if (f & 2) { var d = buf[p++]; x += (f & 16) ? d : -d; } else { if (!(f & 16)) { x += s16(buf, p); p += 2; } } coords.push([x, 0, f & 1]); }
        var y = 0;
        for (i = 0; i < nPoints; i++) { var f2 = flags[i], dy = 0; if (f2 & 4) { var d2 = buf[p++]; dy = (f2 & 32) ? d2 : -d2; } else { if (!(f2 & 32)) { dy = s16(buf, p); p += 2; } } y += dy; coords[i][1] = y; }
        var s = "", last = 0;
        for (var cc = 0; cc < nc; cc++) { var e = dv(buf, base + 10 + cc * 2, 16); for (var j = last; j <= e; j++) s += coords[j][0] + "" + coords[j][1] + "" + coords[j][2]; last = e + 1; }
        return md5(s);
    }

    /* ---- decode cache per font ---- */
    var LAST_FONT = null, LAST_CPMAP = null;
    function dataUrlToBytes(url) {
        var comma = url.indexOf(",");
        return b64ToBytes(url.slice(comma + 1).replace(/\s+/g, ""));
    }
    function buildCpMap(fontBytes) {
        ensureMap();
        var tables = parseTables(fontBytes), cmap = parseCmap(fontBytes, tables), cpMap = {};
        for (var cp in cmap) {
            var gid = cmap[cp], h = glyfHash(fontBytes, tables, gid);
            if (!h) continue;
            var real = HASHMAP.get(h.slice(0, 16));
            if (real != null) cpMap[cp] = real;
        }
        return cpMap;
    }

    function decode(text, fontDataUrl) {
        try {
            if (!fontDataUrl) return text;
            if (fontDataUrl !== LAST_FONT) { LAST_FONT = fontDataUrl; LAST_CPMAP = buildCpMap(dataUrlToBytes(fontDataUrl)); }
            var cm = LAST_CPMAP, out = "";
            for (var i = 0; i < text.length; i++) {
                var cp = text.codePointAt(i), r = cm[cp], ch;
                if (r != null) { ch = String.fromCodePoint(r); if (cp > 0xFFFF) i++; }
                else ch = text[i];
                out += (KX[ch] || ch);
            }
            return out;        } catch (e) { return text; }
    }

    W.__cxFontDecode = decode;
    W.__cxFontDecoderInfo = { version: VERSION, ready: true };
    ensureMap();
    W.__cxFontDecoderInfo.entries = ENTRIES;
})();
`;

const header = `// ==UserScript==
// @name         学习通字体解码器（chaoxing-answer 配套）
// @namespace    https://github.com/Lithum-12/chaoxing-answer-helper
// @version      1.0.0
// @description  为「学习通自动答题助手 Next」解码 font-cxsecret 字体反爬题目（课程内章节小测）。独立安装，主脚本检测到加密题时调用。
// @match        *://*.chaoxing.com/*
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// @license      MIT
// ==/UserScript==
`;

const out = header + LOGIC.replace("__MAP_B64__", mapB64) + "\n";
fs.writeFileSync(path.join(DIR, "cx-font-decoder.user.js"), out);
console.log("wrote cx-font-decoder.user.js bytes:", out.length, "map b64 chars:", mapB64.length);
