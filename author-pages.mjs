// author-pages.mjs — per-builder timeline pages for the AI News site.
// Each tracked builder gets u/<handle>.html: every archived post by that
// person, newest first, rendered in the same paper-and-red editorial language
// as index.html. Kept out of build.mjs so the layout can be iterated on alone.

import { readFileSync } from 'fs';


const CSS = readFileSync(new URL('./author-pages.css', import.meta.url), 'utf-8');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// date keys are calendar days, so do all arithmetic in UTC to dodge DST
function utc(key) {
  const p = key.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}
function keyOf(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function dayMeta(key, lang) {
  const d = utc(key);
  const p = key.split('-').map(Number);
  const wd = d.getUTCDay();
  return lang === 'zh'
    ? { short: p[1] + '.' + p[2], long: p[0] + ' 年 ' + p[1] + ' 月 ' + p[2] + ' 日', wd: '周' + WD_ZH[wd] }
    : { short: MONTHS[p[1] - 1] + ' ' + p[2], long: MONTHS[p[1] - 1] + ' ' + p[2] + ', ' + p[0], wd: WD_EN[wd] };
}

// the calendar day of "now" in the reader's own timezone — not UTC, which
// would put the marker on the wrong square east of Greenwich after midnight
function todayKey() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

// the field is drawn full width: 48 week-columns of 12px squares + 3px gaps
// fills the 760px sheet exactly, and it grows further for long timelines or
// when today sits beyond the end of that span.
const FIELD_WEEKS = 48;

// one square per calendar day, GitHub-style: weeks as columns, Mon..Sun rows.
// The field never stops at the last post — it runs through today and on into
// the unmarked future, so the sheet has no dead space on the right.
function sparkColumns(dayKeys, today) {
  const days = dayKeys.slice().sort();
  if (!days.length) return [];
  const firstKey = days[0];
  const lastKey = days[days.length - 1];
  const start = utc(firstKey);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));

  const horizon = new Date(start.getTime() + (FIELD_WEEKS * 7 - 1) * 864e5);
  let end = horizon;
  for (const bound of [utc(today), utc(lastKey)]) if (bound > end) end = bound;
  end = new Date(end.getTime());
  end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7))); // snap to Sunday

  const cols = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor);
      d.setUTCDate(d.getUTCDate() + i);
      const k = keyOf(d);
      // before this person's first post / after today / a day they could post on
      const state = k < firstKey ? 'pad' : (k > today ? 'fut' : 'day');
      col.push({ key: k, state: state, today: k === today });
    }
    cols.push(col);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return cols;
}

// one square per day: red where they posted, paper-grey where they didn't,
// and a paler grey for the days still ahead — the GitHub contribution rule
function level(n) {
  if (!n) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n <= 4) return 3;
  return 4;
}

function renderSpark(dayKeys, counts, lang) {
  const today = todayKey();
  const cols = sparkColumns(dayKeys, today);
  const cells = cols.map((col) => {
    const inner = col.map((c) => {
      const n = counts[c.key] || 0;
      if (c.state === 'fut') return '<span class="spark-cell fut" aria-hidden="true"></span>';
      if (c.state === 'pad') return '<span class="spark-cell" aria-hidden="true"></span>';
      const cls = 'spark-cell lv' + level(n);
      const m = dayMeta(c.key, lang);
      if (c.today) {
        const label = m.long + ' · ' + (lang === 'zh' ? '今天' : 'today') + (n ? ' · ' + n + (lang === 'zh' ? ' 条' : '') : '');
        return '<span class="' + cls + ' is-today" aria-label="' + esc(label) + '" title="' + esc(label) + '"></span>';
      }
      if (!n) return '<span class="' + cls + '" aria-hidden="true" title="' + c.key + '"></span>';
      const label = esc(m.long + ' · ' + n);
      return '<a class="' + cls + '" href="#d-' + c.key + '" title="' + label + '" aria-label="' + label + '"></a>';
    }).join('');
    return '<div class="spark-col">' + inner + '</div>';
  }).join('');

  const ramp = [1, 2, 3, 4].map((n) => '<i class="spark-cell lv' + n + '"></i>').join('');
  return '<div class="spark-head">'
    + '<span class="spark-range">' + esc(dayKeys[0]) + ' → ' + esc(dayKeys[dayKeys.length - 1]) + '</span>'
    + '<div class="spark-legend">'
    + '<span class="lg-lab"><span class="lang-zh">少</span><span class="lang-en">Less</span></span>'
    + ramp
    + '<span class="lg-lab"><span class="lang-zh">多</span><span class="lang-en">More</span></span>'
    + '</div>'
    + '</div>'
    + '<div class="spark-grid">' + cells + '</div>';
}
export function renderAuthorPage(a) {
  const posts = a.posts;
  const total = posts.length;
  const dayCount = Object.keys(a.dayCounts).length;
  const first = dayMeta(a.firstKey, 'zh');
  const last = dayMeta(a.lastKey, 'zh');
  const firstEn = dayMeta(a.firstKey, 'en');
  const lastEn = dayMeta(a.lastKey, 'en');
  const dayKeys = Object.keys(a.dayCounts).sort();

  // month chapters: newest month first, sticky, so long timelines stay legible
  const months = [];
  const byMonth = new Map();
  for (const p of posts) {
    const mk = p.key.slice(0, 7);
    if (!byMonth.has(mk)) { byMonth.set(mk, []); months.push(mk); }
    byMonth.get(mk).push(p);
  }

  const rail = months.map((mk) => {
    const list = byMonth.get(mk);
    const my = mk.split('-').map(Number);
    const head = '<li class="month">'
      + '<span class="m-lab"><span class="lang-zh">' + my[0] + ' 年 ' + my[1] + ' 月</span><span class="lang-en">' + MONTHS[my[1] - 1] + ' ' + my[0] + '</span></span>'
      + '<span class="m-cnt"><span class="lang-zh">' + list.length + ' 条</span><span class="lang-en">' + list.length + ' post' + (list.length > 1 ? 's' : '') + '</span></span>'
      + '</li>';

    const groups = new Map();
    for (const p of list) {
      if (!groups.has(p.key)) groups.set(p.key, []);
      groups.get(p.key).push(p);
    }
    const days = [...groups.entries()].map((entry) => {
      const key = entry[0];
      const items = entry[1];
      const mz = dayMeta(key, 'zh');
      const me = dayMeta(key, 'en');
      const cards = items.map((p) => {
        const en = p.enHtml
          ? '<div class="post-body lang-en">' + p.enHtml + '</div>'
          : '<div class="post-body lang-en">' + p.zhHtml
            + '<span class="zh-badge">中文摘要 · no English summary</span></div>';
        return '<article class="post">'
          + '<div class="post-body lang-zh">' + p.zhHtml + '</div>'
          + en
          + (p.chips ? '<div class="post-src">' + p.chips + '</div>' : '')
          + '</article>';
      }).join('');
      const cnt = items.length;
      return '<li class="day" id="d-' + key + '">'
        + '<div class="day-date">'
        + '<time datetime="' + key + '"><span class="lang-zh">' + mz.short + '</span><span class="lang-en">' + me.short + '</span></time>'
        + '<span class="day-wd"><span class="lang-zh">' + mz.wd + '</span><span class="lang-en">' + me.wd + '</span></span>'
        + '<a class="day-link" href="../index.html#d-' + key + '"><span class="lang-zh">查看本期</span><span class="lang-en">View issue</span></a>'
        + '</div>'
        + '<div class="day-main">' + cards + '</div>'
        + '</li>';
    }).join('');

    return head + days;
  }).join('');

  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n'
    + '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>' + esc(a.name) + ' · AI News</title>\n'
    + '<meta name="description" content="' + esc(a.name + ' (@' + a.handle + ') — 往期发言时间线，共 ' + total + ' 条。') + '">\n'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    + '<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700;900&display=swap" rel="stylesheet">\n'
    + '<style>\n' + CSS + '</style>\n</head>\n<body id="top" data-lang="zh">\n'
    + '<div class="lang-switch" role="group" aria-label="语言 / Language">'
    + '<button class="sw-btn" type="button" data-lang="zh">中文</button>'
    + '<button class="sw-btn" type="button" data-lang="en">EN</button></div>\n'
    + '<div class="wrap">\n'
    + '<nav class="crumb"><a class="back" href="../index.html">← <span class="lang-zh">全部期号</span><span class="lang-en">All issues</span></a></nav>\n'
    + '<header class="who">\n'
    + '<img class="who-ava" src="../avatars/' + esc(a.avatar) + '" alt="" onerror="this.src=\'../avatars/fallback.png\'">\n'
    + '<div class="who-id">\n'
    + '<div class="who-kicker"><span class="lang-zh">人物时间线</span><span class="lang-en">Timeline</span></div>\n'
    + '<h1 class="who-name">' + esc(a.name) + '</h1>\n'
    + '<div class="who-handle">@' + esc(a.handle) + '</div>\n'
    + '<div class="who-stats">'
    + '<span class="lang-zh">' + total + ' 条摘录 · ' + dayCount + ' 天 · ' + first.long + ' → ' + last.long + '</span>'
    + '<span class="lang-en">' + total + ' posts · ' + dayCount + ' days · ' + firstEn.long + ' → ' + lastEn.long + '</span>'
    + '</div>\n</div>\n'
    + '<a class="who-x" href="https://x.com/' + esc(a.handle) + '" target="_blank" rel="noopener">'
    + '<span class="lang-zh">在 X 打开</span><span class="lang-en">Open on X</span> ↗</a>\n'
    + '</header>\n'
    + '<section class="spark-wrap" aria-label="发文节奏 / Posting rhythm">' + renderSpark(dayKeys, a.dayCounts, 'zh') + '</section>\n'
    + '<ol class="tl">' + rail + '</ol>\n'
    + '<footer class="site">'
    + '<a href="../index.html"><span class="lang-zh">返回 AI News</span><span class="lang-en">Back to AI News</span></a>'
    + ' · <a href="#top"><span class="lang-zh">回到顶部</span><span class="lang-en">Top</span></a>'
    + '</footer>\n'
    + '</div>\n'
    + '<script>\n' + TOGGLE_JS + '\n</script>\n</body>\n</html>\n';
}

const TOGGLE_JS = `(function () {
  var btns = document.querySelectorAll('.sw-btn');
  function setLang(l) {
    document.body.dataset.lang = l;
    try { localStorage.setItem('fb-lang', l); } catch (e) {}
    btns.forEach(function (b) { b.classList.toggle('on', b.dataset.lang === l); });
  }
  btns.forEach(function (b) { b.addEventListener('click', function () { setLang(b.dataset.lang); }); });
  var saved = 'zh';
  try { saved = localStorage.getItem('fb-lang') || 'zh'; } catch (e) {}
  setLang(saved);

  // on a narrow sheet, shed the trailing all-ahead columns so the field
  // still ends flush with the right edge instead of scrolling sideways
  var grid = document.querySelector('.spark-grid');
  if (grid) {
    var cols = [].slice.call(grid.querySelectorAll('.spark-col'));
    var fit = function () {
      cols.forEach(function (c) { c.style.display = ''; });
      for (var i = cols.length - 1; i >= 0 && grid.scrollWidth > grid.clientWidth + 1; i--) {
        var cells = cols[i].querySelectorAll('.spark-cell'), ahead = true;
        for (var k = 0; k < cells.length; k++) {
          if (cells[k].className.indexOf('fut') < 0) { ahead = false; break; }
        }
        if (!ahead) break;
        cols[i].style.display = 'none';
      }
    };
    fit();
    window.addEventListener('resize', fit);
  }
})();`;
