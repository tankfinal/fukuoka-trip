#!/usr/bin/env node
/**
 * 從 README.md 抽出所有「需要向外部查證」的事實，輸出 verification/places.json。
 *
 * 抽三種紀錄：
 *   spot    — 每日行程表的景點（名稱／地址／電話／營業時間）
 *   ticket  — 門票表的價格與開放時間
 *   parking — 停車場一覽的費率與注意事項
 *
 * README 永遠是唯一資料來源，這個檔案只做投影，不維護第二份資料。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const OUT = join(ROOT, 'verification', 'places.json');

const lines = readFileSync(README, 'utf8').split('\n');

const clean = (s) =>
  s.replace(/<br\s*\/?>/g, '\n').replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const isRow = (line) => line.trim().startsWith('|');
const isSeparator = (line) => /^\|[\s:|-]+\|$/.test(line.trim());

/** 收集從 startIdx 開始的整張表格（含表頭），回傳 { header, rows, next } */
function readTable(startIdx) {
  const header = splitRow(lines[startIdx]);
  let i = startIdx + 1;
  if (i < lines.length && isSeparator(lines[i])) i++;
  const rows = [];
  for (; i < lines.length && isRow(lines[i]); i++) {
    if (isSeparator(lines[i])) continue;
    rows.push({ cells: splitRow(lines[i]), line: i + 1 });
  }
  return { header, rows, next: i };
}

/** 從 Spot 欄抽出中／日／英三個名字 */
function parseSpotName(cell) {
  const text = clean(cell);
  const ja = text.match(/🇯🇵\s*([^\n]+)/);
  const en = text.match(/🇬🇧\s*([^\n]+)/);
  const zh = text.split('\n')[0].replace(/^[^\p{L}\p{N}]*/u, '').trim();
  return {
    name_zh: zh,
    name_ja: ja ? ja[1].trim() : '',
    name_en: en ? en[1].trim() : '',
  };
}

/** 從地址欄抽出地址／電話／營業時間 */
function parseAddressCell(cell) {
  const text = clean(cell);
  const parts = text.split('\n').map((s) => s.trim()).filter(Boolean);
  let address = '';
  let phone = '';
  let hours = '';
  for (const part of parts) {
    if (part.startsWith('📞')) {
      const body = part.replace('📞', '').trim();
      const [tel, ...rest] = body.split('｜');
      // 電話後面常接「（旅館步行 2 分）」之類的補充，只留號碼本體
      phone = (tel.match(/[+\d][\d\-() ]*\d/) || [tel])[0].trim();
      if (rest.length) hours = rest.join('｜').trim();
      continue;
    }
    if (!address && !part.startsWith('🇬🇧')) address = part.replace('🇯🇵', '').trim();
    else if (/\d{1,2}[:：]\d{2}/.test(part) && !hours) hours = part;
  }
  if (!address && parts.length) address = parts[0];
  return { address, phone, hours, raw: text };
}

const records = [];
let id = 0;
const nextId = (prefix) => `${prefix}-${String(++id).padStart(2, '0')}`;

let currentDay = null;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const day = line.match(/^###\s*(Day\s*\d)｜(.+)$/);
  if (day) {
    currentDay = { key: day[1].replace(/\s+/g, ' ').trim(), title: clean(day[2]) };
    continue;
  }
  if (/^##\s/.test(line)) {
    // 離開每日行程區塊後就不再標記 day
    if (!/每日行程/.test(line)) currentDay = null;
  }
  if (!isRow(line)) continue;

  const header = splitRow(line);

  // 每日行程的景點表
  if (currentDay && header[0] === '順序' && header[1] === 'Spot') {
    const { rows, next } = readTable(i);
    for (const row of rows) {
      const [order, spotCell, addrCell] = row.cells;
      if (!spotCell) continue;
      const { address, phone, hours, raw } = parseAddressCell(addrCell || '');
      records.push({
        id: nextId('spot'),
        kind: 'spot',
        day: currentDay.key,
        day_title: currentDay.title,
        order: clean(order),
        ...parseSpotName(spotCell),
        address,
        phone,
        hours,
        raw_address_cell: raw,
        readme_line: row.line,
      });
    }
    i = next - 1;
    continue;
  }

  // 門票表
  if (header[0] === '景點' && header[1] === '門票') {
    const { rows, next } = readTable(i);
    for (const row of rows) {
      const [spot, fee, note] = row.cells;
      records.push({
        id: nextId('ticket'),
        kind: 'ticket',
        name_zh: clean(spot),
        claimed_fee: clean(fee),
        claimed_note: clean(note || ''),
        readme_line: row.line,
      });
    }
    i = next - 1;
    continue;
  }

  // 停車場表
  if (header[0] === 'Day' && header[1] === '地點' && header[2] === '停車場') {
    const { rows, next } = readTable(i);
    let lastPlace = '';
    let lastDays = '';
    for (const row of rows) {
      const [days, place, lot, fee, note] = row.cells;
      const rawPlace = clean(place);
      // 「↳ 備案」的列沿用上一列的地點與 Day
      const isAlt = /^↳/.test(rawPlace) || !rawPlace;
      const placeName = isAlt ? lastPlace : rawPlace;
      if (!isAlt) {
        lastPlace = rawPlace;
        lastDays = clean(days);
      }
      records.push({
        id: nextId('parking'),
        kind: 'parking',
        day: clean(days) || lastDays,
        alternative: isAlt,
        name_zh: placeName,
        lot: clean(lot || ''),
        claimed_fee: clean(fee || ''),
        claimed_note: clean(note || ''),
        readme_line: row.line,
      });
    }
    i = next - 1;
    continue;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: 'README.md',
      extracted_at: new Date().toISOString().slice(0, 10),
      trip_dates: '2026-09-19 ~ 2026-09-25',
      count: records.length,
      records,
    },
    null,
    2
  ) + '\n'
);

const byKind = records.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] || 0) + 1 }), {});
console.log(`已寫入 ${OUT}`);
console.log(`共 ${records.length} 筆：`, byKind);
