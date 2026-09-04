#!/usr/bin/env node
/**
 * 用 Gemini（開啟 Google Search grounding）查證 verification/places.json 裡的地點資訊。
 *
 * 兩種用法：
 *   A. Gemini App 模式（預設） node scripts/verify-with-gemini.mjs --prompt-only
 *                            → 產生 verification/prompts/*.md 貼進 gemini.google.com
 *                            → 把回覆存成檔案後：--apply-answer <檔案...>
 *                            用 Gemini Pro 訂閱，不會另外產生費用
 *   B. API 模式（自動）      GEMINI_API_KEY=xxx node scripts/verify-with-gemini.mjs
 *                            注意：訂閱不含 API 額度，是另一套計費
 *
 * 常用選項：
 *   --kind spot|ticket|parking|all   只驗某一類（預設 all）
 *   --day "Day 3"                    只驗某一天
 *   --id spot-32[,spot-33]           只驗指定項目
 *   --model gemini-2.5-pro           指定模型
 *   --concurrency 3                  API 併發數
 *   --limit 5                        先試跑幾筆
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLACES = join(ROOT, 'verification', 'places.json');
const OUT_DIR = join(ROOT, 'verification');
const PROMPT_DIR = join(OUT_DIR, 'prompts');

const TRIP = '2026/09/19（六）～2026/09/25（五）';
const TRIP_CONTEXT = `這是一趟 ${TRIP} 的九州自駕行程（2 人、自駕）。
注意：2026/9/19–9/23 是日本「白銀週 5 連休」（9/21 敬老日、9/22 國民休日、9/23 秋分日），營業時間可能與平日不同。
另外請把 2026/7/28 熊本地震（M7.1）與 2026/8/14 阿蘇噴火警戒等級 3 的最新復原／管制狀況一併納入查證。`;

// ---------- CLI ----------
function parseArgs(argv) {
  const args = { kind: 'all', model: process.env.GEMINI_MODEL || 'gemini-2.5-pro', concurrency: 3 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt-only') args.promptOnly = true;
    else if (a === '--apply-answer') args.applyAnswer = true;
    else if (a === '--kind') args.kind = argv[++i];
    else if (a === '--day') args.day = argv[++i];
    else if (a === '--id') args.ids = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else rest.push(a);
  }
  args.files = rest;
  return args;
}
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^\/\*\*?/, ''));
  process.exit(0);
}

// ---------- 載入待驗項目 ----------
if (!existsSync(PLACES)) {
  console.error(`找不到 ${PLACES}，請先執行： node scripts/extract-places.mjs`);
  process.exit(1);
}
const db = JSON.parse(readFileSync(PLACES, 'utf8'));
let records = db.records;
if (args.kind && args.kind !== 'all') records = records.filter((r) => r.kind === args.kind);
if (args.day) records = records.filter((r) => (r.day || '').includes(args.day));
if (args.ids) records = records.filter((r) => args.ids.includes(r.id));
if (args.limit) records = records.slice(0, args.limit);

if (!records.length) {
  console.error('篩選後沒有任何待驗項目。');
  process.exit(1);
}

// ---------- Prompt ----------
const ANSWER_SCHEMA = `[
  {
    "id": "對應下方項目的 id，原樣抄回",
    "status": "ok | mismatch | outdated | not_found | closed",
    "confidence": "high | medium | low",
    "official_name_ja": "官方日文名稱（查不到填 \\"\\"）",
    "verified_address": "查證後的正確地址（郵遞區號 + 日文地址）",
    "verified_phone": "查證後的電話",
    "verified_hours": "最新營業時間",
    "closed_days": "公休日",
    "verified_fee": "最新票價／費率（非收費項目填 \\"\\"）",
    "trip_date_note": "針對 2026/09/19–25 白銀週連假期間的特別營業／臨時休業／管制資訊",
    "issues": ["我文件裡寫錯或過期的地方，一條一句，明確指出錯在哪、正確是什麼"],
    "sources": ["實際查到的來源網址，優先官方網站"]
  }
]`;

const RULES = `查證規則：
1. **一定要用 Google 搜尋實際查證**，不要憑記憶回答。找不到就誠實填 status="not_found"，不要臆測。
2. 優先採用官方網站、Google Maps 商家資訊、官方社群公告；轉載型部落格只能當輔助。
3. 名稱、地址、電話、營業時間、公休日、費用，逐項比對我提供的內容。
4. 只要有任何一項與我寫的不同 → status 設 "mismatch"（資訊過期用 "outdated"，已歇業／永久關閉用 "closed"）。全部相符才給 "ok"。
5. issues 只寫「真的有出入」的項目；沒有出入就給空陣列。
6. sources 一定要放實際網址，不要寫「官方網站」四個字交差。
7. 最後**只輸出一個 JSON 陣列**，用 \\\`\\\`\\\`json 包起來，不要有其他說明文字。`;

function recordBlock(r) {
  const lines = [`### ${r.id}（${r.kind}）`];
  if (r.day) lines.push(`- 行程日：${r.day}${r.day_title ? ` ${r.day_title}` : ''}`);
  if (r.name_zh) lines.push(`- 名稱（中）：${r.name_zh}`);
  if (r.name_ja) lines.push(`- 名稱（日）：${r.name_ja}`);
  if (r.name_en) lines.push(`- 名稱（英）：${r.name_en}`);
  if (r.lot) lines.push(`- 停車場：${r.lot}`);
  if (r.address) lines.push(`- 我文件寫的地址：${r.address}`);
  if (r.phone) lines.push(`- 我文件寫的電話：${r.phone}`);
  if (r.hours) lines.push(`- 我文件寫的營業時間：${r.hours}`);
  if (r.claimed_fee) lines.push(`- 我文件寫的費用：${r.claimed_fee.replace(/\n/g, ' / ')}`);
  if (r.claimed_note) lines.push(`- 我文件寫的備註：${r.claimed_note.replace(/\n/g, ' / ')}`);
  return lines.join('\n');
}

function buildPrompt(batch) {
  return `你是日本九州在地旅遊資訊查證員。請用 Google 搜尋查證下列地點資訊是否正確且為最新。

${TRIP_CONTEXT}

${RULES}

回覆格式（JSON 陣列，每個待驗項目一個物件）：
\`\`\`json
${ANSWER_SCHEMA}
\`\`\`

---

## 待驗項目（共 ${batch.length} 筆）

${batch.map(recordBlock).join('\n\n')}
`;
}

// ---------- 模式 B：產生貼給 Gemini App 的 prompt ----------
if (args.promptOnly) {
  mkdirSync(PROMPT_DIR, { recursive: true });
  const groups = { spot: [], ticket: [], parking: [] };
  for (const r of records) (groups[r.kind] ||= []).push(r);
  const order = [
    ['spot', '01-spots'],
    ['ticket', '02-tickets'],
    ['parking', '03-parking'],
  ];
  const written = [];
  for (const [kind, name] of order) {
    const batch = groups[kind];
    if (!batch?.length) continue;
    const file = join(PROMPT_DIR, `${name}.md`);
    writeFileSync(file, buildPrompt(batch));
    written.push([file, batch.length]);
  }
  console.log('已產生可貼進 gemini.google.com 的 prompt：');
  for (const [f, n] of written) console.log(`  ${f}（${n} 筆）`);
  console.log('\n步驟：');
  console.log('  1. 在 Gemini（Pro / 2.5 Pro 模型）開新對話，貼上其中一個檔案的全文');
  console.log('  2. 把 Gemini 回覆的 json 區塊整段存成檔案，例如 verification/answers/spots.json');
  console.log('  3. node scripts/verify-with-gemini.mjs --apply-answer verification/answers/*.json');
  process.exit(0);
}

// ---------- 解析 Gemini 回覆 ----------
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('回覆裡找不到 JSON 陣列');
  return JSON.parse(body.slice(start, end + 1));
}

// ---------- 報告 ----------
const STATUS = {
  ok: { icon: '✅', label: '一致' },
  mismatch: { icon: '⚠️', label: '有出入' },
  outdated: { icon: '🕒', label: '資訊過期' },
  closed: { icon: '❌', label: '已歇業／關閉' },
  not_found: { icon: '❓', label: '查不到' },
  error: { icon: '💥', label: '查證失敗' },
};

function renderReport(results, model) {
  const byId = Object.fromEntries(db.records.map((r) => [r.id, r]));
  const rank = ['closed', 'outdated', 'mismatch', 'not_found', 'error', 'ok'];
  const sorted = [...results].sort(
    (a, b) => rank.indexOf(a.status || 'error') - rank.indexOf(b.status || 'error')
  );
  const counts = sorted.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  const out = [];
  out.push('# 🔎 Gemini 地點資訊查證報告');
  out.push('');
  out.push(`> 查證模型：\`${model}\`（已開啟 Google 搜尋）`);
  out.push(`> 查證時間：${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  out.push(`> 行程日期：${TRIP}｜資料來源：README.md`);
  out.push('');
  out.push('## 總覽');
  out.push('');
  out.push('| 狀態 | 筆數 |');
  out.push('|---|---|');
  for (const key of rank) {
    if (!counts[key]) continue;
    out.push(`| ${STATUS[key].icon} ${STATUS[key].label} | ${counts[key]} |`);
  }
  out.push(`| **合計** | **${sorted.length}** |`);
  out.push('');

  const needsAction = sorted.filter((r) => r.status && r.status !== 'ok');
  out.push('## 需要處理的項目');
  out.push('');
  if (!needsAction.length) {
    out.push('本次查證全部一致，沒有需要修改的地方。');
  } else {
    for (const r of needsAction) {
      const src = byId[r.id] || {};
      const s = STATUS[r.status] || STATUS.error;
      out.push(`### ${s.icon} ${src.name_zh || r.id}（\`${r.id}\`・${s.label}）`);
      out.push('');
      const dayLabel = src.day ? (/^Day/.test(src.day) ? src.day : `Day ${src.day}`) : '';
      if (src.readme_line) out.push(`- README.md:${src.readme_line}${dayLabel ? `｜${dayLabel}` : ''}`);
      if (r.confidence) out.push(`- Gemini 信心度：${r.confidence}`);
      const rows = [
        ['官方名稱', '', r.official_name_ja],
        ['地址', src.address, r.verified_address],
        ['電話', src.phone, r.verified_phone],
        ['營業時間', src.hours, r.verified_hours],
        ['公休', '', r.closed_days],
        ['費用', src.claimed_fee, r.verified_fee],
      ].filter(([, , after]) => after && String(after).trim());
      if (rows.length) {
        out.push('');
        out.push('| 項目 | 文件現況 | Gemini 查證 |');
        out.push('|---|---|---|');
        for (const [k, before, after] of rows) {
          const b = String(before || '—').replace(/\n/g, ' / ').replace(/\|/g, '\\|');
          const a = String(after).replace(/\n/g, ' / ').replace(/\|/g, '\\|');
          out.push(`| ${k} | ${b} | ${a} |`);
        }
      }
      if (r.trip_date_note) {
        out.push('');
        out.push(`- 🗓️ 連假期間：${r.trip_date_note}`);
      }
      if (r.issues?.length) {
        out.push('');
        out.push('**問題點**');
        for (const issue of r.issues) out.push(`- ${issue}`);
      }
      if (r.error) {
        out.push('');
        out.push(`**錯誤**：${r.error}`);
      }
      if (r.sources?.length) {
        out.push('');
        out.push('**來源**');
        for (const u of r.sources) out.push(`- ${u}`);
      }
      out.push('');
    }
  }

  const okOnes = sorted.filter((r) => r.status === 'ok');
  if (okOnes.length) {
    out.push('## ✅ 查證一致（不需修改）');
    out.push('');
    for (const r of okOnes) {
      const src = byId[r.id] || {};
      const link = r.sources?.[0] ? ` [來源](${r.sources[0]})` : '';
      out.push(`- \`${r.id}\` ${src.name_zh || ''}${link}`);
    }
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('> ⚠️ Gemini 也可能查錯。**動到錢、時間、預約的項目（票價、營業時間、公休日、末班接駁）請以官方網站或電話為準**，改 README 前先自己再點一次來源連結。');
  out.push('');
  return out.join('\n');
}

function writeResults(results, model) {
  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = join(OUT_DIR, 'gemini-report.json');
  const mdPath = join(OUT_DIR, 'gemini-report.md');
  writeFileSync(
    jsonPath,
    JSON.stringify({ model, verified_at: new Date().toISOString(), trip: TRIP, results }, null, 2) + '\n'
  );
  writeFileSync(mdPath, renderReport(results, model));
  console.log(`\n報告已輸出：\n  ${mdPath}\n  ${jsonPath}`);
  const bad = results.filter((r) => r.status && r.status !== 'ok');
  console.log(`\n共 ${results.length} 筆，其中 ${bad.length} 筆需要人工確認。`);
}

// ---------- 模式 B2：吃 Gemini App 貼回來的答案 ----------
if (args.applyAnswer) {
  if (!args.files.length) {
    console.error('用法：node scripts/verify-with-gemini.mjs --apply-answer <Gemini 回覆檔...>');
    process.exit(1);
  }
  const results = [];
  for (const f of args.files) {
    const parsed = extractJson(readFileSync(f, 'utf8'));
    results.push(...parsed);
  }
  writeResults(results, 'gemini（手動貼上）');
  process.exit(0);
}

// ---------- 模式 A：直接打 Gemini API ----------
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!API_KEY) {
  console.error(`找不到 GEMINI_API_KEY。

  ▶ 建議改走 Gemini App（用 Gemini Pro 訂閱，不會另外產生費用）：

       node scripts/verify-with-gemini.mjs --prompt-only
       # 把產生的 prompt 貼進 gemini.google.com（選 2.5 Pro），回覆存檔後：
       node scripts/verify-with-gemini.mjs --apply-answer <回覆檔>

  ▶ 真的要走 API（注意：Gemini Pro 訂閱不含 API 額度，是另一套計費，
    且本流程有開 Google Search grounding，可能另計費）：

       export GEMINI_API_KEY=xxx      # https://aistudio.google.com/apikey
       node scripts/verify-with-gemini.mjs`);
  process.exit(1);
}

const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

async function callGemini(prompt, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(ENDPOINT(args.model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0 },
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        // 4xx（key 錯、模型名稱錯）重試沒有意義
        if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`${res.status} ${body.slice(0, 300)}`), { fatal: true });
        throw new Error(`${res.status} ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || '')
        .join('')
        .trim();
      if (!text) throw new Error('Gemini 回了空內容');
      return text;
    } catch (err) {
      if (err.fatal) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

async function verifyOne(record) {
  const prompt = buildPrompt([record]);
  try {
    const text = await callGemini(prompt);
    const parsed = extractJson(text);
    const hit = parsed.find((p) => p.id === record.id) || parsed[0] || {};
    return { ...hit, id: record.id };
  } catch (err) {
    return { id: record.id, status: 'error', error: err.message };
  }
}

async function runPool(items, worker, size) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await worker(items[i]);
        done++;
        const s = STATUS[results[i].status] || STATUS.error;
        console.log(`[${String(done).padStart(2)}/${items.length}] ${s.icon} ${items[i].id} ${items[i].name_zh || ''}`);
      }
    })
  );
  return results;
}

console.log(`用 ${args.model} 查證 ${records.length} 筆（併發 ${args.concurrency}）…\n`);
const results = await runPool(records, verifyOne, args.concurrency);
writeResults(results, args.model);
