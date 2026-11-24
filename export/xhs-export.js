/* ============================================================
   小红书导出 — 纯 Canvas 排版，1080×1440 PNG，无第三方依赖
   第 1 页：今日标题 + 今日洞察 + TOP 3 热点
   第 2 页起：今日全部资讯（自动分页）
   ============================================================ */
(function () {
  'use strict';

  var PAGE_W = 1080, PAGE_H = 1440;
  var M = 84, CW = PAGE_W - M * 2;
  var INK = '#1a1918', SOFT = '#45423c', GRAY = '#74716b', LINE = '#e0ddd5';
  var RED = '#e02d1b', RED_DEEP = '#b32112', PAPER = '#f7f6f2';
  var SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",Georgia,serif';
  var SANS = '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",sans-serif';
  var WD = ['日', '一', '二', '三', '四', '五', '六'];
  var FOOT_RULE = 1362, CONTENT_BOTTOM = 1328;

  function f(size, weight, family) {
    return (weight || 400) + ' ' + size + 'px ' + (family || SANS);
  }

  function setFont(ctx, size, weight, family) {
    ctx.font = f(size, weight, family);
  }

  function textWidth(ctx, text, size, weight, family) {
    setFont(ctx, size, weight, family);
    return ctx.measureText(text).width;
  }

  function drawText(ctx, text, x, y, size, weight, color, family) {
    setFont(ctx, size, weight, family);
    ctx.fillStyle = color || INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, x, y);
  }

  function drawCentered(ctx, text, cx, y, size, weight, color, family) {
    setFont(ctx, size, weight, family);
    ctx.fillStyle = color || INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(text, cx, y);
    ctx.textAlign = 'left';
  }

  function drawRight(ctx, text, x, y, size, weight, color, family) {
    setFont(ctx, size, weight, family);
    ctx.fillStyle = color || INK;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  }

  function drawTracked(ctx, text, x, y, size, weight, color, tracking, family) {
    setFont(ctx, size, weight, family);
    ctx.fillStyle = color || GRAY;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    var cx = x, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + tracking;
    }
    return cx - x;
  }

  function rule(ctx, x1, y, x2, w, color) {
    ctx.fillStyle = color || LINE;
    ctx.fillRect(x1, y, x2 - x1, w || 1);
  }

  // ---------- CJK-aware wrapping ----------
  var CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

  function tokenize(text) {
    var out = [], buf = '', i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (ch === '\n' || ch === '\t' || ch === ' ') {
        if (buf) { out.push(buf); buf = ''; }
        if (ch !== '\n') out.push(' ');
      } else if (CJK.test(ch)) {
        if (buf) { out.push(buf); buf = ''; }
        out.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  var NO_START = '，。、；：？！）〕］｝〉》」』】…·,.;:?!%”’';

  function wrap(ctx, text, maxW, size, weight, family) {
    var toks = tokenize(String(text || ''));
    var lines = [], line = [], w = 0, i, t, tw;
    for (i = 0; i < toks.length; i++) {
      t = toks[i];
      if (t === ' ') {
        if (line.length) { line.push(t); w += textWidth(ctx, ' ', size, weight, family); }
        continue;
      }
      tw = textWidth(ctx, t, size, weight, family);
      if (w + tw > maxW && line.length) {
        // 标点不落行首：宁可让这一行多挂一个字，也不让「，」「；」打头
        if (NO_START.indexOf(t) !== -1) {
          line.push(t);
          lines.push(line);
          line = []; w = 0;
          continue;
        }
        while (line.length && line[line.length - 1] === ' ') { line.pop(); }
        lines.push(line);
        line = []; w = 0;
      }
      line.push(t); w += tw;
    }
    while (line.length && line[line.length - 1] === ' ') { line.pop(); }
    if (line.length) lines.push(line);
    return lines.map(function (ls) { return ls.join(''); });
  }

  function clampLines(ctx, lines, maxLines, maxW, size, weight, family, endAtClause) {
    if (lines.length <= maxLines) return { lines: lines, cut: false };
    var kept = lines.slice(0, maxLines);
    var last = (kept[maxLines - 1] || '').replace(/[，、；：,;:\s]+$/, '');
    while (last.length && textWidth(ctx, last + '…', size, weight, family) > maxW) {
      last = last.slice(0, -1);
    }
    if (endAtClause) {
      // TOP 3 的说明宁可在一句话结束，也不要停在“复…”这种半个词上
      var cut = -1;
      for (var i = last.length - 1; i >= 0; i--) {
        if ('，。；：、'.indexOf(last.charAt(i)) !== -1) { cut = i; break; }
      }
      if (cut >= last.length * 0.45 && cut > 4) {
        kept[maxLines - 1] = last.slice(0, cut) + '。';
        return { lines: kept, cut: true };
      }
    }
    kept[maxLines - 1] = last + '…';
    return { lines: kept, cut: true };
  }

  function drawLines(ctx, lines, x, y, lh, size, weight, color, family) {
    setFont(ctx, size, weight, family);
    ctx.fillStyle = color || INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lh);
    return lines.length * lh;
  }

  // ---------- read the visible day from the DOM ----------
  function pick(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function cleanInsight(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^(核心洞察|今日洞察|Core insight|Daily insight)\s*[:：]?\s*/i, '');
    t = t.replace(/[\s。；]*TOP\s*3\s*热点话题[\s\S]*$/i, '');
    return t.trim();
  }

  function extract() {
    var all = Array.prototype.slice.call(document.querySelectorAll('article.day'));
    var art = document.querySelector('article.day.active') || all[0];
    if (!art) return null;
    var zh = art.querySelector('.lang-zh') || art.querySelector('.lang-en');
    if (!zh) return null;

    var key = String(art.id || '').replace(/^d-/, '');
    var dt = new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));
    var valid = !isNaN(dt.getTime());
    var date = key.replace(/-/g, '.') + (valid ? ' 周' + WD[dt.getDay()] : '');
    var issue = all.length - all.indexOf(art);

    var title = pick(zh.querySelector('.story-title')) || key;
    var deck = pick(zh.querySelector('.story-deck'));
    var tags = Array.prototype.map.call(zh.querySelectorAll('.kw-row .kw'), function (n) {
      return pick(n);
    }).filter(Boolean);

    // 旧版日报的洞察没有 .callout 类，只能按「核心洞察」开头找段落
    var callout = zh.querySelector('.callout');
    if (!callout) {
      var ps = zh.querySelectorAll('p');
      for (var pi = 0; pi < ps.length; pi++) {
        if (/^(核心洞察|今日洞察|Core insight)/i.test(pick(ps[pi]))) { callout = ps[pi]; break; }
      }
    }
    var insight = callout ? cleanInsight(pick(callout)) : '';
    if (!insight) insight = deck;

    var top3 = [];
    Array.prototype.forEach.call(zh.querySelectorAll('ol li'), function (li) {
      var s = li.querySelector('strong');
      var head = s ? pick(s) : '';
      if (!head) return;
      var whole = pick(li);
      var desc = whole.indexOf(head) === 0 ? whole.slice(head.length) : whole;
      desc = desc.replace(/^\s*[—–\-:：]\s*/, '').trim();
      top3.push({ head: head, desc: desc });
    });
    top3 = top3.slice(0, 3);

    var items = [];
    Array.prototype.forEach.call(zh.querySelectorAll('p.has-avatar'), function (p) {
      var s = p.querySelector('strong');
      var name = s ? pick(s) : 'AI News';
      var text = pick(p);
      if (name && text.indexOf(name) === 0) text = text.slice(name.length).trim();
      if (!text) return;
      items.push({ name: name || 'AI News', text: text });
    });

    return {
      key: key, date: date, issue: issue, title: title, deck: deck,
      tags: tags, insight: insight, top3: top3, items: items
    };
  }

  function buildCaption(d) {
    var out = [];
    out.push('今日 AI 速递｜' + d.title);
    out.push('');
    if (d.deck) { out.push(d.deck); out.push(''); }
    if (d.insight) out.push(d.insight);
    if (d.top3.length) {
      out.push('');
      out.push('🔥 今日 TOP 3');
      d.top3.forEach(function (t, i) {
        out.push((i + 1) + '. ' + t.head + (t.desc ? '：' + t.desc : ''));
      });
    }
    out.push('');
    out.push('关注我，每天 3 分钟看完全球 AI 圈。');
    out.push('完整版：zhaoqingxia06.github.io/AINews');
    out.push('');
    out.push('#AI日报 #AI资讯 #人工智能 #AI工具 #科技前沿 #大模型');
    return out.join('\n');
  }

  // ---------- card chrome ----------
  function createPage() {
    var c = document.createElement('canvas');
    c.width = PAGE_W; c.height = PAGE_H;
    var ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    return { canvas: c, ctx: ctx };
  }

  function masthead(ctx, d) {
    drawText(ctx, 'AI News', M, 50, 40, 900, INK, SERIF);
    var w = textWidth(ctx, 'AI News', 40, 900, SERIF);
    ctx.fillStyle = RED;
    ctx.fillRect(M + w + 3, 77, 8, 8);
    drawRight(ctx, '每日 AI 电讯', PAGE_W - M, 54, 13, 600, GRAY);
    drawRight(ctx, '第 ' + d.issue + ' 期 · ' + d.date, PAGE_W - M, 75, 15, 600, INK);
    rule(ctx, M, 116, PAGE_W - M, 2, INK);
  }

  function footer(ctx, index, total, d) {
    rule(ctx, M, FOOT_RULE, PAGE_W - M, 1, LINE);
    drawText(ctx, 'AI News · zhaoqingxia06.github.io/AINews', M, 1382, 14, 500, GRAY);
    drawRight(ctx, (index < 10 ? '0' : '') + index + ' / ' + (total < 10 ? '0' : '') + total, PAGE_W - M, 1382, 14, 700, GRAY);
  }

  function drawTags(ctx, tags, x, y) {
    var cx = x, i, tag, rest, hashW, w;
    for (i = 0; i < tags.length; i++) {
      tag = tags[i];
      rest = tag.replace(/^#+/, '');
      if (!rest) continue;
      setFont(ctx, 22, 600, SANS);
      hashW = ctx.measureText('#').width;
      w = hashW + ctx.measureText(rest).width;
      if (cx + w > x + CW) break;
      ctx.fillStyle = RED;
      ctx.fillText('#', cx, y);
      ctx.fillStyle = GRAY;
      ctx.fillText(rest, cx + hashW, y);
      cx += w + 26;
    }
  }

  // ---------- page 1: insight ----------
  function measureTop3(ctx, top3, maxDescLines) {
    var rows = [], total = 0;
    top3.forEach(function (t) {
      var headLines = clampLines(ctx, wrap(ctx, t.head, CW - 78, 29, 700, SANS), 1, CW - 78, 29, 700, SANS);
      var descLines = clampLines(ctx, wrap(ctx, t.desc, CW - 78, 21.5, 400, SANS), maxDescLines, CW - 78, 21.5, 400, SANS, true);
      var h = 38 + 6 + descLines.lines.length * 32 + 24;
      rows.push({ head: headLines.lines[0] || '', desc: descLines.lines, h: h });
      total += h;
    });
    return { rows: rows, h: 62 + total };
  }

  function fitTitle(ctx, text) {
    // 能一行放下就用一行（不小于 70px），杂志式大标题比断出一个孤字好看
    var one = 84;
    while (one >= 70 && wrap(ctx, text, CW, one, 900, SERIF).length > 1) one -= 2;
    if (one >= 70) return { size: one, lines: [text] };

    // 多行时避免最后一行只剩一两个字
    for (var size = 84; size >= 62; size -= 2) {
      var ls = wrap(ctx, text, CW, size, 900, SERIF);
      if (ls.length > 3) continue;
      var maxLen = 0;
      ls.forEach(function (l) { maxLen = Math.max(maxLen, l.length); });
      var lastLen = ls[ls.length - 1].length;
      if (ls.length === 1 || lastLen >= Math.max(4, maxLen * 0.35)) return { size: size, lines: ls };
    }
    var fallback = wrap(ctx, text, CW, 62, 900, SERIF);
    return { size: 62, lines: clampLines(ctx, fallback, 3, CW, 62, 900, SERIF).lines };
  }

  function renderInsight(d) {
    var p = createPage(), ctx = p.ctx;
    masthead(ctx, d);

    var y = 166;
    var titleFit = fitTitle(ctx, d.title);
    var size = titleFit.size;
    var lh = Math.round(size * 1.16);
    drawLines(ctx, titleFit.lines, M, y, lh, size, 900, INK, SERIF);
    y += titleFit.lines.length * lh + 28;

    ctx.fillStyle = RED;
    ctx.fillRect(M, y, 76, 8);
    y += 8;

    if (d.deck) {
      y += 28;
      var deckFit = clampLines(ctx, wrap(ctx, d.deck, CW - 20, 28, 400, SANS), 2, CW - 20, 28, 400, SANS);
      drawLines(ctx, deckFit.lines, M, y, 45, 28, 400, '#57544e', SANS);
      y += deckFit.lines.length * 45;
    }

    if (d.tags.length) {
      y += 24;
      drawTags(ctx, d.tags, M, y);
      y += 30;
    }

    var hasTop3 = d.top3.length > 0;
    var hasInsight = !!d.insight;

    var t3 = hasTop3 ? measureTop3(ctx, d.top3, 2) : { rows: [], h: 0 };
    var topStart = hasTop3 ? CONTENT_BOTTOM - t3.h : CONTENT_BOTTOM;
    var labelY = y + 34;
    var bodyY = labelY + 70;
    var avail = topStart - 36 - bodyY;

    var insSize = 29, insLh = Math.round(insSize * 1.72);
    var insLines = hasInsight ? clampLines(ctx, wrap(ctx, d.insight, CW, insSize, 400, SANS), 99, CW, insSize, 400, SANS).lines : [];
    if (hasInsight && insLines.length * insLh > avail) {
      t3 = hasTop3 ? measureTop3(ctx, d.top3, 1) : t3;
      topStart = hasTop3 ? CONTENT_BOTTOM - t3.h : CONTENT_BOTTOM;
      labelY = y + 34;
      bodyY = labelY + 70;
      avail = topStart - 36 - bodyY;
    }

    // 没有 TOP 3 的旧版日报：把洞察整体居中，避免下半页空一块
    if (hasInsight && !hasTop3) {
      var room = CONTENT_BOTTOM - 36 - y;
      var shown = Math.min(insLines.length, Math.floor((room - 70) / insLh));
      var blockH = 70 + shown * insLh;
      labelY = y + Math.max(40, Math.floor((room - blockH) / 2));
      bodyY = labelY + 70;
      avail = CONTENT_BOTTOM - 36 - bodyY;
    }
    var maxLines = Math.max(1, Math.floor(avail / insLh));
    var insFit = hasInsight ? clampLines(ctx, insLines, maxLines, CW, insSize, 400, SANS) : { lines: [] };

    // 轮播提示：把洞察与 TOP 3 之间的留白变成一次「左滑」引导
    if (d.items.length) {
      var hintY = topStart - 40;
      var insEnd = hasInsight ? bodyY + insFit.lines.length * insLh : y;
      if (hintY > insEnd + 16) {
        var shownCount = d._shown || d.items.length;
        var hintText = shownCount < d.items.length
          ? '左滑查看今日精选 ' + shownCount + ' 条资讯 →'
          : '左滑查看今日全部 ' + shownCount + ' 条资讯 →';
        drawRight(ctx, hintText, PAGE_W - M, hintY, 17, 600, RED_DEEP);
      }
    }

    if (hasInsight) {
      ctx.fillStyle = RED;
      ctx.fillRect(M, labelY + 2, 6, 52);
      drawText(ctx, '今日洞察', M + 22, labelY - 2, 34, 700, INK, SERIF);
      var labW = textWidth(ctx, '今日洞察', 34, 700, SERIF);
      drawTracked(ctx, 'DAILY INSIGHT', M + 22 + labW + 16, labelY + 12, 11, 700, GRAY, 2);
      drawLines(ctx, insFit.lines, M, bodyY, insLh, insSize, 400, SOFT, SANS);
    }

    if (hasTop3) {
      drawText(ctx, 'TOP 3 热点', M, topStart, 24, 700, INK);
      drawRight(ctx, '今日时间线 · ' + d.top3.length + ' 个焦点', PAGE_W - M, topStart + 6, 12, 500, GRAY);
      rule(ctx, M, topStart + 38, PAGE_W - M, 1, LINE);

      var ry = topStart + 58;
      t3.rows.forEach(function (row, i) {
        if (i > 0) rule(ctx, M + 78, ry - 12, PAGE_W - M, 1, '#ebe8e1');
        drawText(ctx, '0' + (i + 1), M, ry - 2, 24, 900, RED, SERIF);
        drawText(ctx, row.head, M + 78, ry, 29, 700, INK);
        if (row.desc.length) {
          drawLines(ctx, row.desc, M + 78, ry + 44, 32, 21.5, 400, GRAY, SANS);
        }
        ry += row.h;
      });
    }

    return p.canvas;
  }

  // ---------- page 2+: all stories ----------
  function renderStories(d, out, opts) {
    var items = d.items;
    if (!items.length) return out;
    var threeUp = !!(opts && opts.threeUp);

    // threeUp：固定 2 页资讯，最多保留 12 条（保证每页至少 2 行），用于「一篇笔记 3 张图」
    var shown = threeUp ? Math.min(12, items.length) : items.length;
    var totalPages = threeUp
      ? Math.max(1, Math.min(2, shown))
      : Math.max(1, Math.ceil(items.length / 5));
    var base = Math.floor(shown / totalPages);
    var extra = shown % totalPages;
    var cursor = 0;

    for (var pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      var count = base + (pageIndex < extra ? 1 : 0);
      if (count <= 0) continue;
      var p = createPage(), ctx = p.ctx;
      masthead(ctx, d);
      drawText(ctx, '今日资讯', M, 158, 56, 900, INK, SERIF);
      var tw = textWidth(ctx, '今日资讯', 56, 900, SERIF);
      drawTracked(ctx, 'ALL STORIES', M + tw + 20, 184, 11, 700, GRAY, 2);
      var countLabel = threeUp && shown < items.length
        ? '精选 ' + shown + ' / 共 ' + items.length + ' 条'
        : '共 ' + items.length + ' 条';
      drawRight(ctx, countLabel, PAGE_W - M, 176, 14, 600, GRAY);
      rule(ctx, M, 244, PAGE_W - M, 2, INK);

      var y = 274;
      var slice = items.slice(cursor, cursor + count);
      var usable = CONTENT_BOTTOM - y;
      var chrome = count * 72; // 作者行 + 间距 + 分隔线
      var maxLines = Math.max(2, Math.min(8, Math.floor((usable - chrome) / (count * 42))));

      slice.forEach(function (item, j) {
        var globalIndex = cursor + j;
        var linesFit = clampLines(ctx, wrap(ctx, item.text, CW - 64, 26, 400, SANS), maxLines, CW - 64, 26, 400, SANS);
        drawText(ctx, (globalIndex < 9 ? '0' : '') + (globalIndex + 1), M, y + 2, 20, 900, RED, SERIF);
        drawText(ctx, item.name, M + 64, y, 26, 700, INK);
        drawLines(ctx, linesFit.lines, M + 64, y + 40, 42, 26, 400, SOFT, SANS);
        y += 40 + 8 + linesFit.lines.length * 42 + 24;
        if (j < slice.length - 1) rule(ctx, M + 64, y - 18, PAGE_W - M, 1, '#ebe8e1');
      });

      // 末页收个尾，避免底部留下突兀的空白
      if (pageIndex === totalPages - 1 && y + 56 < CONTENT_BOTTOM) {
        rule(ctx, PAGE_W / 2 - 24, y + 24, PAGE_W / 2 + 24, 1, '#c9c5bb');
        var endText = shown < items.length ? '今日精选 ' + shown + ' 条 · 全文见网站' : '今日 ' + items.length + ' 条 · 已全部收录';
        drawCentered(ctx, endText, PAGE_W / 2, y + 40, 12, 500, GRAY);
      }

      cursor += count;
      out.push(p.canvas);
    }
    return out;
  }

  function makePages(d, opts) {
    d._shown = (opts && opts.threeUp) ? Math.min(12, d.items.length) : d.items.length;
    var pages = [renderInsight(d)];
    renderStories(d, pages, opts);
    pages.forEach(function (c, i) { footer(c.getContext('2d'), i + 1, pages.length, d); });
    return pages;
  }

  // ---------- modal ----------
  var state = { pages: [], data: null, caption: '', busy: false };
  var lastFocus = null;
  var MODAL_HTML = [
    '<div class="xhs" id="xhsModal" hidden>',
    '  <div class="xhs-mask" data-xhs-close></div>',
    '  <div class="xhs-panel" role="dialog" aria-modal="true" aria-labelledby="xhsTitle">',
    '    <header class="xhs-head">',
    '      <div>',
    '        <div class="xhs-kicker">XIAOHONGSHU KIT</div>',
    '        <h2 id="xhsTitle">导出小红书卡片</h2>',
    '      </div>',
    '      <button class="xhs-close" type="button" data-xhs-close aria-label="关闭">×</button>',
    '    </header>',
    '    <div class="xhs-body">',
    '      <div class="xhs-pages" id="xhsPages"></div>',
    '      <aside class="xhs-side">',
    '        <div class="xhs-meta" id="xhsMeta"></div>',
    '        <label class="xhs-label" for="xhsCaption">配文（可编辑后复制）</label>',
    '        <textarea class="xhs-caption" id="xhsCaption" spellcheck="false"></textarea>',
    '        <div class="xhs-actions">',
    '          <button class="xhs-btn primary" type="button" id="xhsDownloadAll">下载全部图片</button>',
    '          <button class="xhs-btn" type="button" id="xhsCopy">复制配文</button>',
    '        </div>',
    '        <p class="xhs-hint">1080×1440 · 3:4 竖版。第 1 张是今日洞察封面，往后是今日全部资讯，可整组发小红书图文。浏览器若询问「允许下载多个文件」，选择允许即可。</p>',
    '        <p class="xhs-status" id="xhsStatus" role="status"></p>',
    '      </aside>',
    '    </div>',
    '  </div>',
    '</div>',
    '<div class="xhs-light" id="xhsLight" hidden><img id="xhsLightImg" alt="卡片预览"></div>'
  ].join('\n');

  function $(id) { return document.getElementById(id); }

  function ensureModal() {
    if ($('xhsModal')) return;
    var holder = document.createElement('div');
    holder.innerHTML = MODAL_HTML;
    document.body.appendChild(holder);

    holder.querySelectorAll('[data-xhs-close]').forEach(function (el) {
      el.addEventListener('click', close);
    });
    $('xhsDownloadAll').addEventListener('click', downloadAll);
    $('xhsCopy').addEventListener('click', copyCaption);
    $('xhsPages').addEventListener('click', function (e) {
      var dl = e.target.closest('[data-xhs-dl]');
      if (dl) {
        downloadPage(+dl.getAttribute('data-xhs-dl'));
        return;
      }
      var img = e.target.closest('img[data-xhs-preview]');
      if (img) openLight(+img.getAttribute('data-xhs-preview'));
    });
    $('xhsLight').addEventListener('click', closeLight);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('xhsLight').hidden) { closeLight(); return; }
      if (!$('xhsModal').hidden) close();
    });
  }

  function setStatus(msg) { var el = $('xhsStatus'); if (el) el.textContent = msg || ''; }

  function previewURL(canvas) {
    var c = document.createElement('canvas');
    c.width = 540; c.height = 720;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, 540, 720);
    return c.toDataURL('image/jpeg', 0.86);
  }

  function labelFor(i) {
    if (i === 0) return '今日洞察';
    return '今日资讯 ' + i + '/' + (state.pages.length - 1);
  }

  function paintModal() {
    var pagesEl = $('xhsPages');
    var html = state.pages.map(function (c, i) {
      return '<figure class="xhs-card">' +
        '<img data-xhs-preview="' + i + '" src="' + previewURL(c) + '" alt="' + labelFor(i) + '">' +
        '<figcaption><span><b>' + String(i + 1).padStart(2, '0') + '</b> · ' + labelFor(i) + '</span>' +
        '<button class="xhs-dl" type="button" data-xhs-dl="' + i + '">下载</button></figcaption>' +
        '</figure>';
    }).join('');
    pagesEl.innerHTML = html;
    var d = state.data;
    $('xhsMeta').innerHTML = '第 <b>' + d.issue + '</b> 期 · ' + d.date + ' · 共 <b>' + state.pages.length + '</b> 张';
    $('xhsCaption').value = state.caption;
    setStatus('');
    pagesEl.scrollLeft = 0;
  }

  function renderModal() {
    if (state.busy) return;
    var d = extract();
    if (!d) {
      $('xhsPages').innerHTML = '<div class="xhs-error">这一天还没有内容，先选一个有日报的日期再导出。</div>';
      return;
    }
    state.busy = true;
    state.data = d;
    state.caption = buildCaption(d);
    $('xhsPages').innerHTML = '<div class="xhs-loading"><div class="xhs-spinner"></div>正在排版今日卡片…</div>';
    $('xhsMeta').textContent = '第 ' + d.issue + ' 期 · ' + d.date;
    setStatus('');

    var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    var fontsDone = false;
    function paint() {
      if (fontsDone) return;
      fontsDone = true;
      try {
        state.pages = makePages(d);
        state.busy = false;
        paintModal();
      } catch (err) {
        state.busy = false;
        $('xhsPages').innerHTML = '<div class="xhs-error">排版失败：' + String(err && err.message || err) + '</div>';
      }
    }
    // 字体加载慢或被墙时不能一直空转，2.5 秒后直接用回退字体排版
    Promise.race([fonts, new Promise(function (r) { setTimeout(r, 2500); })]).then(paint).catch(paint);
  }

  function open() {
    lastFocus = document.activeElement;
    ensureModal();
    $('xhsModal').hidden = false;
    document.body.classList.add('xhs-lock');
    renderModal();
    var closeBtn = document.querySelector('#xhsModal .xhs-close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function close() {
    var m = $('xhsModal');
    if (!m || m.hidden) return;
    m.hidden = true;
    document.body.classList.remove('xhs-lock');
    closeLight();
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function openLight(i) {
    var c = state.pages[i];
    if (!c) return;
    var light = $('xhsLight');
    $('xhsLightImg').src = c.toDataURL('image/jpeg', 0.92);
    light.hidden = false;
  }

  function closeLight() {
    var light = $('xhsLight');
    if (light && !light.hidden) {
      light.hidden = true;
      $('xhsLightImg').removeAttribute('src');
    }
  }

  function filename(i) {
    var key = (state.data && state.data.key) || 'export';
    return 'AI-News-' + key + '-' + String(i + 1).padStart(2, '0') + '.png';
  }

  function downloadPage(i) {
    var c = state.pages[i];
    if (!c) return;
    var name = filename(i);
    if (c.toBlob) {
      c.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      }, 'image/png');
    } else {
      var a2 = document.createElement('a');
      a2.href = c.toDataURL('image/png'); a2.download = name;
      document.body.appendChild(a2); a2.click(); a2.remove();
    }
  }

  function downloadAll() {
    if (!state.pages.length) return;
    setStatus('开始下载 ' + state.pages.length + ' 张图片…');
    var i = 0;
    (function next() {
      if (i >= state.pages.length) {
        setStatus('已下载 ' + state.pages.length + ' 张 · 按图片顺序发布即可');
        return;
      }
      downloadPage(i);
      i++;
      setTimeout(next, 500);
    })();
  }

  function copyCaption() {
    var text = $('xhsCaption').value;
    function done() { setStatus('配文已复制'); setTimeout(function () { setStatus(''); }, 2400); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      ta.remove();
    }
  }

  function boot() {
    var btns = document.querySelectorAll('.xhs-open');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', open);
    });
  }

  // 自动化入口：导出工作流直接拿 PNG dataURL，不依赖按钮和浏览器下载事件
  window.AINewsExport = {
    render: function (opts) {
      var d = extract();
      if (!d) return Promise.reject(new Error('no-article'));
      var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
      var done = false;
      return Promise.race([fonts, new Promise(function (r) { setTimeout(r, 2500); })]).then(function () {
        if (done) return null;
        done = true;
        var pages = makePages(d, opts || {});
        return {
          key: d.key,
          issue: d.issue,
          date: d.date,
          title: d.title,
          deck: d.deck,
          insight: d.insight,
          tags: d.tags,
          top3: d.top3,
          items: d.items,
          shownItems: d._shown || d.items.length,
          caption: buildCaption(d),
          images: pages.map(function (c) { return c.toDataURL('image/png'); })
        };
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
