#!/usr/bin/env node
// Build the digest site: reads ~/.follow-builders/digests/YYYY-MM-DD.md and
// emits ~/.follow-builders/site/index.html — calendar heatmap on top, all
// digests below, heatmap cells link to each day's article. No dependencies.

import { readdir, readFile, writeFile, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve paths relative to this script so the build runs both locally
// (~/.follow-builders/site = repo root) and inside GitHub Actions (repo
// checkout): digests/ and index.html live next to this file.
const scriptDir = dirname(fileURLToPath(import.meta.url)); // repo root
const DIGEST_DIR = join(scriptDir, 'digests');
const OUT = join(scriptDir, 'index.html');

// ---------- markdown-lite renderer (headings / bold / italic / links / hr) ----------

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  const links = [];
  let out = escapeHtml(s);
  // markdown links -> placeholders first so their URLs are not re-linked
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => {
    links.push(`<a href="${url}" target="_blank" rel="noopener">${text}</a>`);
    return `\u0001${links.length - 1}\u0001`;
  });
  // bare URLs
  out = out.replace(/(^|[\s（【>（])(https?:\/\/[^\s<）】\u0001]+)/g, (m, pre, url) => {
    links.push(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
    return `${pre}\u0001${links.length - 1}\u0001`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\u0001])\*([^*\n\u0001]+)\*(?!\*)/g, '$1<em>$2</em>');
  // auto-bold impactful numbers (76%, 30¢, 40 亿, 1 亿美元, $100M, 1B+, 4 billion...)
  // never inside link placeholders or manually bolded keywords
  const numRe = /(\d+(?:\.\d+)?)(\s?(?:%|¢|亿美元|亿|万美元|万|倍))/g;
  const numReEn = /(\$\d+(?:\.\d+)?[MB]?|\d+(?:\.\d+)?\s?(?:billion|million)|\d+(?:\.\d+)?[MB]\+)/g;
  out = out
    .split(/(\u0001\d+\u0001|<strong>.*?<\/strong>)/)
    .map((p) => (/^(?:\u0001\d+\u0001|<strong>.*?<\/strong>)$/.test(p)
      ? p
      : p.replace(numRe, '<strong class="num">$1$2</strong>').replace(numReEn, '<strong class="num">$1</strong>')))
    .join('');
  out = out.replace(/\u0001(\d+)\u0001/g, (_, i) => links[Number(i)]);
  return out;
}

// A bare-URL line becomes a compact "source" chip instead of a raw link paragraph.
const ICON_LINK =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z"></path></svg>';

// Parse the metadata lines at the top of a day's body (keywords / headline /
// deck / quote / quoteBy) and return them with the stripped body.
function parseKeywords(md) {
  const grab = (re) => {
    const m = md.match(re);
    return m ? m[1].trim() : '';
  };
  const meta = {
    kw: grab(/^keywords:\s*(.+)\s*$/m).split('|').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    headline: grab(/^headline:\s*(.+)\s*$/m),
    deck: grab(/^deck:\s*(.+)\s*$/m),
    quote: grab(/^quote:\s*(.+)\s*$/m),
    quoteBy: grab(/^quoteBy:\s*(.+)\s*$/m),
  };
  const body = md.replace(/^(?:keywords|headline|deck|quote|quoteBy):[^\n]*\n?/gm, '').replace(/^\n+/, '');
  return { ...meta, body };
}

// snowflake id -> 发帖时间的北京时间字符串（MM-DD HH:MM）
function tweetBjTime(id) {
  try {
    const d = new Date(Number((BigInt(id) >> 22n) + 1288834974657n) + 8 * 3600e3);
    return d.toISOString().slice(5, 10).replace('-', '月') + '日 ' + d.toISOString().slice(11, 16);
  } catch { return ''; }
}

function srcChip(url) {
  let label = '原文';
  let tweetAttr = '';
  let timeHtml = '';
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (/^(x|twitter)\.com$/.test(h)) {
      label = 'X 原文';
      // status links open in the in-page source panel; keep href as fallback
      const st = url.match(/\/[^/]+\/status(?:es)?\/(\d+)/);
      if (st) {
        tweetAttr = ` data-tweet="${st[1]}"`;
        // 展示发帖时间对应的北京时间
        const bj = tweetBjTime(st[1]);
        if (bj) timeHtml = `<span class="src-time">${bj}</span>`;
      }
    }
    else if (h.includes('youtu')) label = 'YouTube';
    else if (h === 'github.com') label = 'GitHub';
    else label = h;
  } catch {}
  return `<div class="src"><a class="src-link"${tweetAttr} href="${url}" target="_blank" rel="noopener" title="${url}">${ICON_LINK}<span>${label}</span>${timeHtml}</a></div>`;
}

function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let para = [];
  let list = [];
  let firstH1Skipped = false;
  const flush = () => {
    if (!para.length) return;
    // pure-URL lines (trailing or standalone) become source chips, not text
    const urls = [];
    while (para.length && /^https?:\/\/\S+$/.test(para[para.length - 1])) {
      urls.unshift(para.pop());
    }
    if (para.length) {
      let html = `<p>${inline(para.join(' '))}</p>`;
      // paragraphs led by a short bold label with content after it
      // ("**一句话要点**：..." / "**The takeaway**: ...") become callouts
      if (/^<p><strong>[^<]{2,16}<\/strong>[：:]\S/.test(html)) {
        html = `<p class="callout">${html.slice(3)}`;
      }
      out.push(html);
    }
    out.push(...urls.map(srcChip));
    para = [];
  };
  const flushList = () => {
    if (list.length) {
      out.push(`<ol>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`);
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); flushList(); continue; }
    const m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      flush(); flushList();
      if (m[1].length === 1 && !firstH1Skipped) { firstH1Skipped = true; continue; }
      const h = Math.min(m[1].length + 1, 5);
      out.push(`<h${h}>${inline(m[2])}</h${h}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flush(); flushList();
      out.push('<hr>');
    } else if (/^>\s?/.test(line)) {
      flush(); flushList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
    } else if (/^\d+\.\s+/.test(line)) {
      flush();
      list.push(line.replace(/^\d+\.\s+/, ''));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flush();
  flushList();
  return out.join('\n');
}

// ---------- calendar data ----------
// The 7-day sliding window is rendered client-side; we only embed the data.

const fmtKey = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

// ---------- assemble ----------

// Split a monthly digest file into per-day bodies keyed by 'YYYY-MM-DD'.
// Day sections start with a '## YYYY-MM-DD' line; every other '##' line
// (insights, 𝕏/TWITTER, PODCASTS) belongs to the current day's content.
function splitMonthly(md) {
  const days = new Map();
  let cur = null;
  let buf = [];
  const flush = () => {
    if (cur) days.set(cur, buf.join('\n').replace(/^\n+/, '').replace(/\s+$/, ''));
  };
  for (const line of md.split('\n')) {
    const m = line.match(/^## (\d{4}-\d{2}-\d{2})\s*$/);
    if (m) {
      flush();
      cur = m[1];
      buf = [];
    } else if (cur) {
      buf.push(line);
    }
  }
  flush();
  return days;
}

// ---------- avatars ----------

// tracked builder name (lowercase) -> X handle; file avatars/<handle>.jpg|png
const AVATARS = {
  'andrej karpathy': 'karpathy', 'swyx': 'swyx', 'josh woodward': 'joshwoodward',
  'boris cherny': 'bcherny', 'thibault sottiaux': 'thsottiaux', 'peter yang': 'petergyang',
  'nan yu': 'thenanyu', 'madhu guru': 'realmadhuguru', 'amanda askell': 'amandaaskell',
  'cat wu': '_catwu', 'thariq': 'trq212', 'google labs': 'googlelabs',
  'amjad masad': 'amasad', 'guillermo rauch': 'rauchg', 'alex albert': 'alexalbert__',
  'aaron levie': 'levie', 'ryo lu': 'ryolu_', 'garry tan': 'garrytan',
  'matt turck': 'mattturck', 'zara zhang': 'zarazhangrui', 'nikunj kothari': 'nikunj',
  'peter steinberger': 'steipete', 'dan shipper': 'danshipper',
  'aditya agarwal': 'adityaag', 'sam altman': 'sama',
  'claude blog': 'claudeai', 'anthropic engineering': 'anthropicai',
};

// ---------- product knowledge base (click a product -> info card) ----------
const PRODUCT_KB = {
  muse:      { name: 'Muse', desc: 'Meta 推出的个人 AI Agent 应用，可跨 App 替用户执行任务，被视为 ChatGPT 之外最有力的入口级 agent 竞争者。' },
  chatgpt:   { name: 'ChatGPT', desc: 'OpenAI 的对话式 AI 助手，全球用户量最大的 AI 产品，正从聊天扩展到代理执行、个人金融助手等场景。' },
  siri:      { name: 'Siri', desc: 'Apple 的语音助手，正被重构为大模型驱动的个人 agent，但迭代速度常被认为太慢。' },
  x402:      { name: 'X402', desc: 'Coinbase 孵化、后捐给 Linux 基金会的 agent 支付协议：让 AI agent 用 stablecoin 按请求在线付费。' },
  toshi:     { name: 'Toshi', desc: 'Coinbase 内部的 agent harness，把团队的事故记录、规范等「大脑」喂给 agent，实现代码改动的递归自我改进。' },
  capy:      { name: 'Capy', desc: 'capydotai 推出的 agentic 编程工具，擅长多步工作流追踪与大型 PR 自动化，被 Garry Tan 称为快过 Codex/Claude Code 的秘密武器。' },
  astra:     { name: 'Astra', desc: '一款可完成可验证端到端任务的 agent，投资人 Nikunj Kothari 评价：给它足够难的任务，它直接起飞。' },
  codex:     { name: 'Codex', desc: 'OpenAI 的 AI 编程 agent 与云服务，可自主完成编码任务，其团队已宣告「代码冻结」时代结束。' },
  grok:      { name: 'Grok', desc: 'xAI 的大模型，Vercel CEO 实测其逆向工程能力后评价：解得非常漂亮，而且快得惊人。' },
  openclaw:  { name: 'OpenClaw', desc: 'Peter Steinberger 参与的开源个人 agent 项目（代号 claw），Meta 的自研 agent 曾被传「使用 OpenClaw」，实为受其启发。' },
  instinct:  { name: 'Instinct', desc: '零配置、面向普通用户的手机 agent 应用，被视作「人人都能用的 agent」的范例。' },
  vercel:    { name: 'Vercel', desc: 'Guillermo Rauch 创办的前端云平台，AI Gateway 让各家模型通过 HTTP 直接调用。' },
  replit:    { name: 'Replit', desc: 'Amjad Masad 领导的在线开发平台，主打人人可造软件，AI agent 深度融入产品。' },
  box:       { name: 'Box', desc: 'Aaron Levie 领导的企业内容管理平台，agent 可对其数千万份企业文件随问随答。' },
  blacksmith:{ name: 'Blacksmith', desc: '高性能 CI 服务商，OpenClaw 项目的赞助商。' },
  typesafe:  { name: 'TypeSafe AI', desc: 'ChatGPT 联合创造者 Diogo Almeida 创办的 AI 初创公司，主打「机器原生 AI」与 System One 模型 Jev，已获 4000 万美元种子轮。' },
  jev:       { name: 'Jev', desc: 'TypeSafe AI 发布的首个 System One 模型。' },
  'diogo almeida': { name: 'Diogo Almeida', desc: 'TypeSafe AI 联合创始人兼 CEO，OpenAI 时期参与创造 ChatGPT、RLHF 与 InstructGPT。' },
  'claude in chrome': { name: 'Claude in Chrome', desc: 'Anthropic 的浏览器扩展，让 Claude 直接在 Chrome 内替用户操作网页，已正式发布。' },
  openai:    { name: 'OpenAI', desc: 'ChatGPT 与 Codex 的缔造者，AGI 研发的头部公司。' },
  meta:      { name: 'Meta', desc: 'Facebook 与 Instagram 的母公司，自研个人 agent Muse。' },
  apple:     { name: 'Apple', desc: 'Siri 的缔造者，个人 agent 入口之争的重要玩家。' },
};
const PRODUCT_RULES = Object.entries(PRODUCT_KB)
  .sort((a, b) => b[1].name.length - a[1].name.length)
  .map(([key, p]) => [key, new RegExp('(<[^>]*>)|\\b(' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\$&') + ')\\b', 'g')]);

// 每个产品在同一期内只标注首次出现，避免满屏下划线
function wrapProducts(html, used) {
  const masks = [];
  let h = html.replace(/<div class="kw-row">[\s\S]*?<\/div>/g, (m) => { masks.push(m); return '\u0001' + (masks.length - 1) + '\u0001'; });
  for (const [key, rx] of PRODUCT_RULES) {
    if (used.has(key)) continue;
    h = h.replace(rx, (m, tag, word) => {
      if (tag) return m;
      used.add(key);
      return '<span class="prod" data-prod="' + key + '">' + word + '</span>';
    });
  }
  h = h.replace(/\u0001(\d+)\u0001/g, (m, i) => masks[Number(i)]);
  return h;
}

async function loadAvatarFiles() {
  const files = new Map(); // handle -> filename with extension
  try {
    for (const f of await readdir(join(scriptDir, 'avatars'))) {
      const m = f.match(/^(.+)\.(jpe?g|png)$/i);
      if (m) files.set(m[1].toLowerCase(), f);
    }
  } catch {}
  return files;
}

// Prepend the author's avatar to paragraphs that start with a bold name.
// No real avatar available -> use avatars/fallback.png illustration instead.
function injectAvatars(html, avatarFiles) {
  return html.replace(/<p>(<strong>[^<]{1,80}<\/strong>)/g, (m, strong) => {
    const plain = strong.replace(/<[^>]+>/g, '').toLowerCase();
    if (/[^\x00-\x7f]/.test(plain)) return m; // skip CJK labels like 核心洞察
    const img = (file) => `<img class="avatar" src="avatars/${file}" alt="" loading="lazy" onerror="this.onerror=null;this.src='avatars/fallback.png'">`;
    for (const [name, handle] of Object.entries(AVATARS)) {
      if (plain.includes(name)) {
        return `<p class="has-avatar">` + img(avatarFiles.has(handle) ? avatarFiles.get(handle) : 'fallback.png') + strong;
      }
    }
    return `<p class="has-avatar">` + img('fallback.png') + strong;
  });
}

// ---------- generative cover art & section icons ----------

const H3_ICONS = {
  insight: '<svg class="h3-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>',
  x: '<svg class="h3-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 2.5l11 11M13.5 2.5l-11 11"/></svg>',
  blog: '<svg class="h3-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="1.8" width="10" height="12.4" rx="1"/><path d="M5.5 5h5M5.5 8h5M5.5 11h3"/></svg>',
  pod: '<svg class="h3-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.8" y="1.8" width="4.4" height="7" rx="2.2"/><path d="M3.2 7.5a4.8 4.8 0 0 0 9.6 0M8 12.2v2M5.8 14.2h4.4"/></svg>',
};

// Swap the emoji-lead section h3s for icon + tracked-spacing labels.
function decorateH3(html) {
  return html.replace(/<h3>([^<]*)<\/h3>/g, (m, t) => {
    const txt = t.trim();
    if (txt.startsWith('🧭')) return `<h3 class="ins-h">${H3_ICONS.insight}<span>${txt.replace(/^🧭\s*/, '')}</span></h3>`;
    if (txt.startsWith('𝕏')) return `<h3>${H3_ICONS.x}<span>${txt.replace(/^𝕏\s*\/?\s*/, '')}</span></h3>`;
    if (txt.startsWith('🎙')) return `<h3>${H3_ICONS.pod}<span>${txt.replace(/^🎙\s*/, '')}</span></h3>`;
    if (txt.startsWith('📰')) return `<h3>${H3_ICONS.blog}<span>${txt.replace(/^📰\s*/, '')}</span></h3>`;
    return m;
  });
}

async function main() {
  // digests are stored monthly: YYYY-MM.zh.md / YYYY-MM.en.md, one
  // '## YYYY-MM-DD' section per day — fewer files than per-day storage.
  const byDate = new Map();
  for (const f of await readdir(DIGEST_DIR)) {
    const m = f.match(/^(\d{4}-\d{2})\.(zh|en)\.md$/);
    if (!m) continue;
    const md = await readFile(join(DIGEST_DIR, f), 'utf-8');
    for (const [day, body] of splitMonthly(md)) {
      const rec = byDate.get(day) || {};
      rec[m[2]] = { md: body, bytes: Buffer.byteLength(body, 'utf-8') };
      byDate.set(day, rec);
    }
  }
  const entries = [...byDate.entries()]
    .map(([key, langs]) => ({ key, ...langs }))
    .sort((a, b) => b.key.localeCompare(a.key)); // newest first

  const dates = new Map(entries.map((e) => [e.key, e.zh?.bytes || e.en?.bytes || 0]));
  // NOTE: "today" must be computed in local time — UTC would mislabel the cell
  // for anything east of Greenwich before 08:00 local.
  const now = new Date();
  const todayKey = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const datesJson = JSON.stringify(Object.fromEntries(dates));
  const latestKey = entries[0]?.key || '';
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const zhDate = `${+todayKey.slice(0, 4)} 年 ${+todayKey.slice(5, 7)} 月 ${+todayKey.slice(8, 10)} 日`;
  const enDate = `${MONTHS_EN[+todayKey.slice(5, 7) - 1]} ${+todayKey.slice(8, 10)}, ${todayKey.slice(0, 4)}`;

  const kwChips = (md) => parseKeywords(md).kw.map((k) => `<span class="kw">#${escapeHtml(k)}</span>`).join('');
  const avatarFiles = await loadAvatarFiles();
  const langDiv = (l, rec, dayKey) => {
    if (!rec) return '';
    const { kw, headline, deck, body } = parseKeywords(rec.md);
    const langZh = l === 'zh';
    const title = headline || (langZh ? `${dayKey} 简报` : `Briefing · ${dayKey}`);
    const plain = body.replace(/https?:\/\/\S+/g, '').replace(/\s/g, '');
    const minutes = Math.max(1, Math.round(plain.length / 600));
    const readTime = langZh ? `阅读约 ${minutes} 分钟` : `A ${minutes}-min read`;
    const WD_ZH = ['日', '一', '二', '三', '四', '五', '六'];
    const MS_EN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dt = new Date(+dayKey.slice(0, 4), +dayKey.slice(5, 7) - 1, +dayKey.slice(8, 10));
    const dateStr = langZh
      ? `${+dayKey.slice(5, 7)} 月 ${+dayKey.slice(8, 10)} 日 · 周${WD_ZH[dt.getDay()]}`
      : `${MS_EN3[+dayKey.slice(5, 7) - 1]} ${+dayKey.slice(8, 10)}, ${dayKey.slice(0, 4)}`;
    const storyHead = `
      <div class="story-head">
        <h1 class="story-title">${escapeHtml(title)}</h1>
        ${deck ? `<div class="story-deck">${escapeHtml(deck)}</div>` : ''}
        <div class="story-meta">${dateStr} · ${readTime} · Follow Builders</div>
      </div>
    `;
    const kwRow = `<div class="kw-row">${kw.map((k) => `<span class="kw">#${escapeHtml(k)}</span>`).join('')}</div>`;
    let html = `${storyHead}${kwRow}${injectAvatars(mdToHtml(body), avatarFiles)}`;
    const used = new Set();
    html = decorateH3(wrapProducts(html, used));
    // 只保留 标题 + 核心洞察：TOP 3 与正文重复，不再渲染
    html = html.replace(/<p class="callout"><strong>(?:TOP ?3|Top ?3)[^<]*<\/strong>[^<]*<\/p>\s*<ol>[\s\S]*?<\/ol>\s*/g, '');
    return `<div class="lang lang-${l}">${html}</div>`;
  };

  // "today's hot topics" chips were removed from the page head by user request;
  // parseKeywords still feeds the per-article chip rows.
  const articles = entries.map((e) => `
    <article id="d-${e.key}" class="day ${e.en ? '' : 'no-en'}${e.zh ? '' : ' no-zh'}">
      ${langDiv('zh', e.zh, e.key)}
      ${langDiv('en', e.en, e.key)}
      <div class="lang-note">This day has no English version yet — showing the Chinese digest.</div>
      <div class="lang-note note-zh">此日暂无中文版 — 显示英文原版。</div>
    </article>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI News · AI builders 每日电讯</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700;900&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #f7f6f2;
    --sheet: #ffffff;
    --ink: #1a1918;
    --gray: #74716b;
    --line: #e6e4de;
    --red: #e02d1b;
    --red-deep: #b32112;
    --red-tint: #fbece8;
    --serif: "Noto Serif SC", "Songti SC", "STSong", Georgia, "Times New Roman", serif;
    --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: var(--sans);
    font-size: 16px; line-height: 1.9;
    -webkit-font-smoothing: antialiased;
  }
  ::selection { background: var(--red); color: #fff; }
  :focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 22px 36px 90px; }
  @media (max-width: 640px) { .wrap { padding: 14px 18px 72px; } }

  /* ---------- masthead: folio line, serif nameplate, double rule ---------- */
  .mast-folio {
    display: flex; justify-content: space-between; gap: 12px;
    border-top: 2px solid var(--ink);
    padding: 9px 2px 10px;
    font-size: 12.5px; color: var(--gray);
    letter-spacing: 0.03em; font-variant-numeric: tabular-nums;
  }
  .mast-title {
    margin: 34px 0 0; text-align: center;
    font-family: var(--serif); font-weight: 900;
    font-size: clamp(42px, 6vw, 58px); line-height: 1.05; letter-spacing: 0.01em;
    color: var(--ink);
  }
  .mast-title .dot { color: var(--red); }
  .mast-sub {
    margin: 14px 0 0; text-align: center;
    font-size: 13px; color: var(--gray); letter-spacing: 0.02em;
  }
  .mast-rule { margin-top: 24px; border-top: 3px solid var(--ink); }
  .mast-rule::after { content: ""; display: block; border-top: 1px solid var(--ink); margin-top: 3px; }

  /* ---------- layout ---------- */
  .layout {
    display: grid; grid-template-columns: minmax(0, 1fr) 268px;
    gap: 34px; align-items: start; margin-top: 34px;
  }
  .main { min-width: 0; }
  .side { position: sticky; top: 22px; }
  @media (max-width: 800px) {
    .layout { grid-template-columns: 1fr; gap: 22px; }
    .side { position: static; }
  }

  /* ---------- calendar: quiet sheet with red heat scale ---------- */
  .side .card {
    background: var(--sheet);
    border: 1px solid var(--line); border-radius: 12px;
    padding: 18px 16px 12px;
  }
  .cal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .cal-title { font-size: 13.5px; font-weight: 700; white-space: nowrap; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }
  .cal-nav { display: flex; gap: 4px; }
  .cal-btn {
    font-size: 12px; line-height: 1.2; color: var(--gray);
    background: transparent; border: none; border-radius: 6px;
    padding: 5px 9px; cursor: pointer; transition: color 0.15s ease, background 0.15s ease;
  }
  .cal-btn:hover:not(:disabled) { color: var(--red-deep); background: var(--red-tint); }
  .cal-btn:disabled { opacity: 0.3; cursor: default; }
  .cal-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 6px; }
  .cal-week span { text-align: center; font-size: 11px; color: var(--gray); }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .cal-cell {
    display: block; text-align: center; text-decoration: none;
    border: none; border-radius: 7px; padding: 7px 0;
    background: transparent; transition: background 0.15s ease;
  }
  .cal-cell .dn { display: block; font-size: 12.5px; font-weight: 500; color: #a3a09a; font-variant-numeric: tabular-nums; }
  .cal-cell.out { opacity: 0.35; }
  a.cal-cell:hover { background: var(--red-tint); }
  .cal-cell.c1 { background: #f9e3dd; } .cal-cell.c1 .dn { color: #8c3b2b; }
  .cal-cell.c2 { background: #f1bfb3; } .cal-cell.c2 .dn { color: #7e291a; }
  .cal-cell.c3 { background: #e2795f; } .cal-cell.c3 .dn { color: #53140a; }
  .cal-cell.c4 { background: #c62312; } .cal-cell.c4 .dn { color: #fff; font-weight: 600; }
  .cal-cell.today { box-shadow: inset 0 0 0 2px var(--red); }
  .cal-cell.sel { background: var(--ink); }
  .cal-cell.sel .dn { color: #fff; font-weight: 600; }
  .cal-note {
    margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line);
    text-align: center; font-size: 11px; color: var(--gray); letter-spacing: 0.02em;
  }
  .cal-sw { display: inline-flex; gap: 2px; margin-right: 7px; vertical-align: -1px; }
  .cal-sw i { width: 12px; height: 8px; border-radius: 2px; display: block; }
  .cal-sw i:nth-child(1) { background: #f9e3dd; }
  .cal-sw i:nth-child(2) { background: #f1bfb3; }
  .cal-sw i:nth-child(3) { background: #e2795f; }
  .cal-sw i:nth-child(4) { background: #c62312; }

  /* ---------- story head ---------- */
  .story-head { margin: 2px 0 4px; }
  .story-head::before { content: ""; display: block; width: 46px; border-top: 3px solid var(--red); margin-bottom: 20px; }
  .story-title {
    font-family: var(--serif); font-weight: 700;
    font-size: clamp(26px, 3.4vw, 33px); line-height: 1.5;
    letter-spacing: 0.01em; margin: 0 0 12px; color: var(--ink);
  }
  .story-deck { font-size: 15.5px; color: var(--gray); line-height: 1.9; }
  .story-meta { font-size: 12.5px; color: var(--gray); margin-top: 14px; letter-spacing: 0.03em; font-variant-numeric: tabular-nums; }

  /* ---------- topic chips: quiet outline ---------- */
  .kw-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-start; margin: 16px 0 10px; }
  .kw {
    display: inline-block; font-size: 12.5px; line-height: 1;
    padding: 7px 14px; border-radius: 999px;
    border: 1px solid var(--line); background: transparent;
    color: var(--ink); font-weight: 500; letter-spacing: 0.01em;
    transition: border-color 0.15s ease, color 0.15s ease;
  }
  .kw:hover { border-color: var(--red); color: var(--red-deep); }

  /* ---------- article sheet ---------- */
  article.day { display: none; }
  article.day.active { display: block; margin-top: 0; scroll-margin-top: 16px; }
  .day-empty {
    margin-top: 0; background: var(--sheet);
    border: 1px solid var(--line); border-radius: 12px;
    padding: 56px 24px; text-align: center; color: var(--gray);
  }
  article {
    background: var(--sheet); border: 1px solid var(--line); border-radius: 12px;
    padding: 38px 44px 44px; margin-top: 0;
    scroll-margin-top: 16px; font-size: 16px; line-height: 1.95;
  }
  @media (max-width: 640px) { article { padding: 26px 20px 30px; } }
  article h3 {
    display: flex; align-items: center; gap: 9px;
    font-size: 15.5px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink);
    margin: 2.1em 0 0.85em; padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  article h3 .h3-ico { color: var(--red); width: 15px; height: 15px; flex: none; }
  article h4 { font-size: 16.5px; font-weight: 700; margin: 1.6em 0 0.4em; line-height: 1.6; color: var(--ink); }
  article p { margin: 0.8em 0; text-align: justify; }
  article p.callout {
    background: var(--red-tint); border-left: 4px solid var(--red);
    border-radius: 0 8px 8px 0; padding: 14px 18px; margin: 1.2em 0;
    text-align: left;
  }
  article strong { font-weight: 650; color: var(--ink); }
  strong.num { color: var(--red-deep); font-weight: 700; font-style: normal; }
  article ol { margin: 0.4em 0 0.9em; padding-left: 22px; }
  article ol li { margin: 0.5em 0; }
  article ol li::marker { color: var(--red); font-weight: 700; }
  article em { color: var(--gray); }
  blockquote { margin: 0.8em 0; padding: 2px 16px; border-left: 2px solid var(--red); color: var(--gray); }

  /* ---------- links & source chips ---------- */
  a { color: inherit; text-decoration: none; }
  article a {
    color: var(--ink);
    border-bottom: 1px solid rgba(224, 45, 27, 0.45);
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  article a:hover { color: var(--red-deep); border-bottom-color: var(--red-deep); }
  .src { display: inline-block; margin: 0 10px 0.4em 0; }
  article a.src-link {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 12px; line-height: 1.5; color: var(--gray);
    background: transparent; border: 1px solid var(--line); border-radius: 999px;
    padding: 3px 11px; text-decoration: none;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  article a.src-link:hover, article a.src-link.active {
    color: var(--red-deep); border-color: var(--red); background: transparent;
  }
  .src-link svg { flex: none; }
  .src-link span { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .src-time { color: var(--gray); font-weight: 400; max-width: none !important; }

  /* ---------- avatars ---------- */
  p.has-avatar { display: flow-root; }
  .avatar {
    float: left; width: 46px; height: 46px; border-radius: 50%;
    margin: 8px 14px 4px 0;
    border: 1px solid var(--line); background: var(--paper);
  }

  /* ---------- product knowledge panel ---------- */
  .prod {
    border-bottom: 1.5px dotted rgba(224, 45, 27, 0.6);
    cursor: pointer; transition: background 0.15s ease;
  }
  .prod:hover, .prod.active { background: var(--red-tint); }
  .prod-panel {
    position: fixed; z-index: 70; width: 330px;
    background: var(--sheet);
    border: 1px solid var(--line); border-radius: 12px;
    padding: 16px 18px;
    box-shadow: 0 14px 40px rgba(26, 25, 24, 0.14);
  }
  .prod-panel[hidden] { display: none; }
  .pp-close {
    position: absolute; top: 8px; right: 12px; border: none; background: transparent;
    font-size: 18px; line-height: 1; color: var(--gray); cursor: pointer;
  }
  .pp-close:hover { color: var(--ink); }
  .pp-name { font-family: var(--serif); font-weight: 700; font-size: 15.5px; margin-bottom: 6px; padding-right: 14px; }
  .pp-desc { font-size: 13px; line-height: 1.8; color: #55524d; }
  @media (max-width: 800px) {
    .prod-panel { left: 12px; right: 12px; top: auto; bottom: 90px; width: auto; }
  }

  /* ---------- source card: original post under the calendar ---------- */
  .src-link[data-tweet] { cursor: pointer; }
  .src-card {
    margin-top: 14px;
    background: var(--sheet);
    border: 1px solid var(--line); border-radius: 12px;
    padding: 12px 12px 4px;
    scroll-margin-top: 100px;
  }
  .sc-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 4px 8px;
  }
  .sc-title {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12.5px; font-weight: 700; color: var(--gray);
  }
  .sc-title svg { width: 12px; height: 12px; color: var(--ink); flex: none; }
  .sc-close {
    border: none; background: transparent; cursor: pointer;
    font-size: 18px; line-height: 1; color: var(--gray);
    padding: 2px 6px; border-radius: 6px; transition: background 0.15s ease;
  }
  .sc-close:hover { color: var(--ink); background: var(--paper); }
  .sc-body { overflow: hidden; border-radius: 9px; }
  .sc-body .twitter-tweet { margin: 0 !important; }
  .sc-body iframe { max-width: 100%; }
  @media (min-width: 801px) {
    /* the sticky sidebar must stay within the viewport once the source card
       grows it past one screen — scroll inside the column instead */
    .side:has(.src-card:not([hidden])) {
      max-height: calc(100vh - 44px);
      overflow-y: auto; scrollbar-width: thin;
    }
  }
  .sk {
    border: 1px solid var(--line); border-radius: 9px; padding: 14px;
  }
  .sk-row, .sk-ava {
    background: linear-gradient(90deg, #edede8 25%, #f6f5f1 45%, #edede8 65%);
    background-size: 200% 100%;
    animation: skshine 1.3s infinite linear;
  }
  .sk-row { height: 11px; border-radius: 6px; margin-bottom: 10px; }
  .sk-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .sk-ava { width: 40px; height: 40px; border-radius: 50%; flex: none; }
  @keyframes skshine { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  .sp-error {
    border: 1px solid var(--line); border-radius: 9px; padding: 18px 14px;
    text-align: center; color: var(--gray); font-size: 12.5px; line-height: 1.75;
  }
  .sp-error .btns { display: flex; gap: 8px; justify-content: center; margin-top: 12px; flex-wrap: wrap; }
  .sp-btn {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 12.5px; font-weight: 600; line-height: 1.4;
    padding: 6px 15px; border-radius: 999px; cursor: pointer;
    color: #fff; background: var(--ink); border: none;
    text-decoration: none; transition: background 0.15s ease;
  }
  .sp-btn:hover { background: var(--red-deep); }
  .sp-btn.ghost { color: var(--ink); background: transparent; border: 1px solid var(--line); }
  .sp-btn.ghost:hover { background: var(--red-tint); color: var(--red-deep); border-color: var(--red); }
  @media (prefers-reduced-motion: reduce) {
    .sk-row, .sk-ava { animation: none; }
  }

  /* ---------- language toggle: fixed pill on wide screens, in flow below ---------- */
  body[data-lang="zh"] .lang-en { display: none; }
  body[data-lang="en"] .lang-zh { display: none; }
  body[data-lang="zh"] article.no-zh .lang-en { display: block; }
  body[data-lang="en"] article.no-en .lang-zh { display: block; }
  .lang-note {
    display: none; margin: 0 0 14px; padding: 10px 14px; font-size: 12.5px;
    color: var(--gray); background: var(--paper); border: 1px solid var(--line); border-radius: 9px;
  }
  body[data-lang="en"] article.no-en .lang-note:not(.note-zh) { display: block; }
  body[data-lang="zh"] article.no-zh .lang-note.note-zh { display: block; }
  .lang-switch {
    position: fixed; top: 16px; right: 16px; z-index: 50;
    display: flex; gap: 2px; padding: 3px;
    background: var(--sheet);
    border: 1px solid var(--line); border-radius: 999px;
    box-shadow: 0 2px 10px rgba(26, 25, 24, 0.06);
  }
  @media (max-width: 1360px) {
    /* below this width the fixed pill would cover the folio line — flow it */
    .lang-switch { position: static; margin: 14px auto 0; width: max-content; box-shadow: none; }
  }
  .sw-btn {
    border: none; background: transparent; cursor: pointer;
    font-size: 12.5px; line-height: 1.3;
    padding: 4px 14px; border-radius: 999px; color: var(--gray);
    transition: color 0.15s ease;
  }
  .sw-btn:hover:not(.on) { color: var(--ink); }
  .sw-btn.on { background: var(--ink); color: #fff; }

  footer.site {
    margin-top: 52px; padding-top: 20px; border-top: 1px solid var(--line);
    text-align: center; font-size: 12px; color: var(--gray); line-height: 2;
  }
  footer.site a { color: var(--gray); border-bottom: 1px solid rgba(224, 45, 27, 0.45); }
  footer.site a:hover { color: var(--red-deep); border-bottom-color: var(--red-deep); }
</style>
</head>
<body id="top" data-lang="zh">
<div class="lang-switch" role="group" aria-label="语言 / Language">
  <button class="sw-btn" type="button" data-lang="zh">中文</button>
  <button class="sw-btn" type="button" data-lang="en">EN</button>
</div>
<div class="wrap">
  <header class="mast">
    <div class="mast-folio">
      <span><span class="lang-zh">第 ${entries.length} 期</span><span class="lang-en">Issue ${entries.length}</span></span>
      <span><span class="lang-zh">${zhDate} · 北京</span><span class="lang-en">${enDate} · Beijing</span></span>
    </div>
    <h1 class="mast-title">AI News<span class="dot">.</span></h1>
    <div class="mast-sub"><span class="lang-zh">追踪 AI builders 的每日电讯 — X 动态 · 播客 · 官方博客 · 每天多次更新</span><span class="lang-en">A daily wire on AI builders — X posts · podcasts · official blogs · updated several times a day</span></div>
    <div class="mast-rule"></div>
  </header>

  <div class="layout">
    <main class="main">
      ${articles}
      <div class="day-empty" id="dayEmpty" hidden>
        <span class="lang-zh">这一天没有摘要</span><span class="lang-en">No digest for this day</span>
      </div>
    </main>
    <aside class="side">
      <div class="card">
    <div class="cal-head">
      <div class="cal-nav">
        <button class="cal-btn" id="calPrevYear" type="button" aria-label="上一年">«</button>
        <button class="cal-btn" id="calPrev" type="button" aria-label="上一月">‹</button>
      </div>
      <div class="cal-title" id="calTitle"></div>
      <div class="cal-nav">
        <button class="cal-btn" id="calTodayBtn" type="button"><span class="lang-zh">今天</span><span class="lang-en">Today</span></button>
        <button class="cal-btn" id="calNext" type="button" aria-label="下一月">›</button>
        <button class="cal-btn" id="calNextYear" type="button" aria-label="下一年">»</button>
      </div>
    </div>
    <div class="cal-week">
      <span class="lang-zh">一</span><span class="lang-en">Mo</span>
      <span class="lang-zh">二</span><span class="lang-en">Tu</span>
      <span class="lang-zh">三</span><span class="lang-en">We</span>
      <span class="lang-zh">四</span><span class="lang-en">Th</span>
      <span class="lang-zh">五</span><span class="lang-en">Fr</span>
      <span class="lang-zh">六</span><span class="lang-en">Sa</span>
      <span class="lang-zh">日</span><span class="lang-en">Su</span>
    </div>
    <div class="cal-grid" id="calGrid"></div>
    <div class="cal-note"><span class="cal-sw"><i></i><i></i><i></i><i></i></span><span class="lang-zh">色深 ≈ 当日信息量</span><span class="lang-en">Darker = bigger digest</span></div>
      </div>
      <div class="src-card" id="srcCard" hidden>
        <div class="sc-head">
          <span class="sc-title"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg><span class="lang-zh">原帖</span><span class="lang-en">Original post</span></span>
          <button class="sc-close" id="spClose" type="button" aria-label="关闭 / Close">×</button>
        </div>
        <div class="sc-body" id="spBody"></div>
      </div>
    </aside>
  </div>

  <aside class="prod-panel" id="prodPanel" hidden>
    <button class="pp-close" id="ppClose" type="button" aria-label="关闭">×</button>
    <div class="pp-name" id="ppName"></div>
    <div class="pp-desc" id="ppDesc"></div>
  </aside>
  <footer class="site"><span class="lang-zh">每天 06:00 / 08:00 / 15:30 / 20:00（北京时间）自动更新</span><span class="lang-en">Auto-refreshed daily at 06:00 / 08:00 / 15:30 / 20:00 (GMT+8)</span> · Generated through the Follow Builders skill · <a href="https://github.com/zarazhangrui/follow-builders">zarazhangrui/follow-builders</a></footer>
</div>
<script>
const DIGEST_DATES = ${datesJson};
const TODAY_KEY = ${JSON.stringify(todayKey)};
const PRODUCT_KB = ${JSON.stringify(PRODUCT_KB)};
const LATEST_KEY = ${JSON.stringify(latestKey)};

// month calendar grid + one-day-at-a-time view
(function () {
  var grid = document.getElementById('calGrid');
  if (!grid) return;
  var title = document.getElementById('calTitle');
  var prevBtn = document.getElementById('calPrev');
  var prevYearBtn = document.getElementById('calPrevYear');
  var nextBtn = document.getElementById('calNext');
  var nextYearBtn = document.getElementById('calNextYear');
  var todayBtn = document.getElementById('calTodayBtn');
  var dayEmpty = document.getElementById('dayEmpty');
  var MS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function parseKey(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function key(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function level(bytes) {
    if (!bytes) return 0;
    if (bytes < 4000) return 1;
    if (bytes < 7000) return 2;
    if (bytes < 11000) return 3;
    return 4;
  }

  var today = parseKey(TODAY_KEY);
  var view = { y: today.getFullYear(), m: today.getMonth() };
  var selKey = TODAY_KEY;

  function render() {
    grid.innerHTML = '';
    var first = new Date(view.y, view.m, 1);
    var start = new Date(view.y, view.m, 1 - ((first.getDay() + 6) % 7));
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var k = key(d);
      var bytes = DIGEST_DATES[k] || 0;
      var el = document.createElement('a');
      el.href = '#d-' + k;
      el.dataset.day = k;
      if (bytes) el.title = k + ' · ' + (bytes / 1024).toFixed(1) + ' KB';
      el.className = 'cal-cell' +
        (bytes ? ' c' + level(bytes) : '') +
        (k === TODAY_KEY ? ' today' : '') +
        (k === selKey ? ' sel' : '') +
        (d.getMonth() !== view.m ? ' out' : '');
      el.innerHTML = '<span class="dn">' + d.getDate() + '</span>';
      el.addEventListener('click', (function (kk) {
        return function (ev) { ev.preventDefault(); selectDay(kk); };
      })(k));
      grid.appendChild(el);
    }
    title.innerHTML = '<span class="lang-zh">' + view.y + '年' + (view.m + 1) + '月</span>' +
      '<span class="lang-en">' + MS_EN[view.m] + ' ' + view.y + '</span>';
    var atCur = view.y === today.getFullYear() && view.m === today.getMonth();
    nextBtn.disabled = atCur;
    nextYearBtn.disabled = view.y >= today.getFullYear();
  }


  function markSel(k) {
    document.querySelectorAll('#calGrid .cal-cell').forEach(function (c) {
      c.classList.toggle('sel', c.dataset.day === k);
    });
  }

  function showDay(k) {
    document.querySelectorAll('article.day').forEach(function (a) {
      a.classList.toggle('active', a.id === 'd-' + k);
    });
    dayEmpty.hidden = true;
    markSel(k);
  }

  function showEmpty(k) {
    document.querySelectorAll('article.day').forEach(function (a) { a.classList.remove('active'); });
    dayEmpty.hidden = false;
    markSel(k);
  }

  function shiftMonth(n) {
    var m = view.m + n, y = view.y;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    if (y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth())) return;
    view = { y: y, m: m };
    render();
  }

  function selectDay(k) {
    selKey = k;
    var d = parseKey(k);
    view = { y: d.getFullYear(), m: d.getMonth() };
    render();
    if (DIGEST_DATES[k]) showDay(k); else showEmpty(k);
    try { history.replaceState(null, '', '#d-' + k); } catch (e) {}
  }

  // initial=true accepts falling back to the latest digest when the hash is
  // absent or not a date; later hashchange events with non-date hashes keep
  // the current view untouched.
  function route(initial) {
    // [0-9] not \d — backslashes don't survive this template literal
    var m = location.hash.match(/^#d-([0-9]{4}-[0-9]{2}-[0-9]{2})$/);
    var k;
    if (m) k = m[1];
    else {
      if (!initial) return;
      k = LATEST_KEY;
    }
    if (!k) { showEmpty(TODAY_KEY); return; }
    selectDay(k);
  }

  prevBtn.addEventListener('click', function () { shiftMonth(-1); });
  nextBtn.addEventListener('click', function () { shiftMonth(1); });
  prevYearBtn.addEventListener('click', function () { shiftMonth(-12); });
  nextYearBtn.addEventListener('click', function () { shiftMonth(12); });
  todayBtn.addEventListener('click', function () { selectDay(TODAY_KEY); });
  window.addEventListener('hashchange', function () { route(false); });
  route(true);
})();

// product knowledge panel (click underlined product -> right info card)
(function () {
  var panel = document.getElementById('prodPanel');
  if (!panel) return;
  var nameEl = document.getElementById('ppName');
  var descEl = document.getElementById('ppDesc');
  function mark(key) {
    var all = document.querySelectorAll('.prod');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('active', all[i].getAttribute('data-prod') === key);
    }
  }
  function place(anchor) {
    var r = anchor.getBoundingClientRect();
    var w = panel.offsetWidth || 330;
    panel.style.maxWidth = Math.min(330, window.innerWidth - 24) + 'px';
    var left = Math.min(Math.max(12, r.left), Math.max(12, window.innerWidth - w - 12));
    var top = r.bottom + 10;
    var h = panel.offsetHeight;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 10);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }
  function open(key, anchor) {
    var p = PRODUCT_KB[key];
    if (!p) return;
    nameEl.textContent = p.name;
    descEl.textContent = p.desc;
    panel.hidden = false;
    if (anchor) place(anchor); else { panel.style.left = '16px'; panel.style.top = '104px'; }
    mark(key);
  }
  function close() {
    panel.hidden = true;
    mark('');
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t.classList && !t.classList.contains('prod') && t !== document.body) t = t.parentNode;
    if (t && t.classList && t.classList.contains('prod')) { open(t.getAttribute('data-prod'), t); return; }
    if (!panel.hidden && !(t && t.closest && t.closest('#prodPanel'))) close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  document.getElementById('ppClose').addEventListener('click', close);
})();

// source card: open the original X post under the calendar in the sidebar
// instead of leaving the page. Renders the official embed via widgets.js (the
// syndication JSON API is CORS-locked to platform.twitter.com, so embeds are
// the only client-side option). Falls back to an "open on X" card when
// unreachable.
(function () {
  var card = document.getElementById('srcCard');
  if (!card) return;
  var body = document.getElementById('spBody');
  var loadSeq = 0;   // guards stale async results after switching tweets
  var lastId = '';
  var lastUrl = '';

  var ZH = {
    netfail: '暂时无法连接到 X，请检查网络（或代理）后重试。',
    fail: '原帖加载失败，可能已被删除或设置了访问限制。',
    retry: '重试',
    open: '在 X 打开'
  };
  var EN = {
    netfail: 'Could not reach X right now — check your network (or proxy) and retry.',
    fail: 'Could not load this post — it may have been deleted or made private.',
    retry: 'Retry',
    open: 'Open on X'
  };
  function t(key) { return (document.body.dataset.lang === 'en' ? EN : ZH)[key]; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mark(id) {
    var all = document.querySelectorAll('.src-link[data-tweet]');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('active', all[i].getAttribute('data-tweet') === id);
    }
  }

  function show() {
    if (!card.hidden) return;
    card.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function close() {
    if (card.hidden) return;
    card.hidden = true;
    mark('');
    body.innerHTML = '';
  }

  // ---- widgets.js loader: injected once, on first use ----
  var wjsState = 0; // 0 idle, 1 loading, 2 ready, 3 failed
  var wjsWaiters = [];
  function ensureWidgets() {
    if (wjsState === 2) return Promise.resolve();
    if (wjsState === 3) return Promise.reject(new Error('widgets.js unavailable'));
    return new Promise(function (resolve, reject) {
      wjsWaiters.push([resolve, reject]);
      if (wjsState === 1) return;
      wjsState = 1;
      var s = document.createElement('script');
      s.id = 'sp-wjs';
      s.src = 'https://platform.twitter.com/widgets.js';
      s.async = true;
      s.charset = 'utf-8';
      s.onload = function () {
        if (!window.twttr || !window.twttr.widgets) { settle(3); return; }
        settle(2);
      };
      s.onerror = function () { settle(3); };
      document.head.appendChild(s);
      setTimeout(function () { if (wjsState === 1) settle(3); }, 12000);
      function settle(state) {
        if (wjsState === 2 || wjsState === 3) return;
        wjsState = state;
        wjsWaiters.forEach(function (w) { state === 2 ? w[0]() : w[1](new Error('widgets.js unavailable')); });
        wjsWaiters = [];
      }
    });
  }

  function skeleton() {
    var row = '<div class="sk-row"></div>';
    return '<div class="sk">'
      + '<div class="sk-head"><span class="sk-ava"></span><span class="sk-row" style="flex:1;margin:0"></span></div>'
      + row + row + '<div class="sk-row" style="width:72%"></div>'
      + '<div class="sk-row" style="height:120px;border-radius:10px;margin-top:14px"></div>'
      + '</div>';
  }

  function errorHtml(msgKey) {
    return '<div class="sp-error"><div>' + esc(t(msgKey)) + '</div><div class="btns">'
      + '<button type="button" class="sp-btn" id="spRetry">' + esc(t('retry')) + '</button>'
      + '<a class="sp-btn ghost" href="' + esc(lastUrl || ('https://x.com/i/web/status/' + lastId)) + '" target="_blank" rel="noopener">' + esc(t('open')) + ' ↗</a>'
      + '</div></div>';
  }

  function load(id, url) {
    if (!/^[0-9]+$/.test(id)) return;
    lastId = id;
    if (url) lastUrl = url;
    var seq = ++loadSeq;
    mark(id);
    show();
    body.scrollTop = 0;
    body.innerHTML = skeleton();
    if (wjsState === 3) wjsState = 0; // retry may follow a network recovery
    ensureWidgets().then(function () {
      if (seq !== loadSeq) return;
      var holder = document.createElement('div');
      body.innerHTML = '';
      body.appendChild(holder);
      var settled = false;
      var opts = {
        conversation: 'none',
        dnt: true,
        align: 'center',
        theme: 'light',
        lang: document.body.dataset.lang === 'en' ? 'en' : 'zh-cn',
        width: Math.min(550, Math.max(200, (body.clientWidth || 236) - 2))
      };
      try {
        var p = window.twttr.widgets.createTweet(id, holder, opts);
        if (p && typeof p.then === 'function') {
          p.then(function () { settled = true; }).catch(function () {
            if (seq === loadSeq) body.innerHTML = errorHtml('fail');
          });
        }
      } catch (e) {
        body.innerHTML = errorHtml('fail');
        return;
      }
      setTimeout(function () {
        if (seq !== loadSeq || settled) return;
        // an iframe exists as soon as createTweet runs; only a real render
        // gives it height. Still 0-height after 12s = stuck or unreachable:
        // append a recovery card but keep watching — a late render removes it.
        var f = holder.querySelector('iframe');
        if (!f || f.getBoundingClientRect().height < 40) {
          var err = document.createElement('div');
          err.innerHTML = errorHtml('netfail');
          body.appendChild(err);
          var watch = setInterval(function () {
            if (seq !== loadSeq || !err.parentNode) { clearInterval(watch); return; }
            var ff = holder.querySelector('iframe');
            if (ff && ff.getBoundingClientRect().height >= 40) { err.remove(); clearInterval(watch); }
          }, 800);
        }
      }, 12000);
    }).catch(function () {
      if (seq === loadSeq) body.innerHTML = errorHtml('netfail');
    });
  }

  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!(el && el.closest)) return;
    var chip = el.closest('a.src-link[data-tweet]');
    if (chip) {
      e.preventDefault();
      load(chip.getAttribute('data-tweet'), chip.getAttribute('href'));
      return;
    }
    if (el.closest('#spClose')) { close(); return; }
    if (el.closest('#spRetry')) { load(lastId, lastUrl); return; }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();

(function () {
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
})();

</script>
</body>
</html>
`;

  // 原子写入：先写临时文件再改名，避免构建期间被请求读到半截文件
  await writeFile(OUT + '.tmp', html, 'utf-8');
  await rename(OUT + '.tmp', OUT);
  console.log(`OK ${OUT} — ${entries.length} digest(s), latest: ${entries[0]?.key || 'none'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
