# verification/ — Gemini 地點查證

行程文件裡的地點事實（地址、電話、營業時間、票價、停車費）在寫進 `README.md` 之前，
要先過一次 Gemini（開 Google 搜尋）查證。完整規則見根目錄 `CLAUDE.md`。

| 檔案 | 內容 | 進版控 |
|---|---|---|
| `places.json` | 從 `README.md` 抽出的待驗項目（spot / ticket / parking） | ✅ 自動產生 |
| `prompts/*.md` | 貼進 gemini.google.com 用的查證 prompt | ✅ 自動產生 |
| `gemini-report.md` / `.json` | 查證報告 | ✅ 有跑才有 |
| `answers/` | 從 Gemini App 貼回來的原始回覆 | ❌ 已 gitignore |

```bash
node scripts/extract-places.mjs                                  # 重新抽項目
node scripts/verify-with-gemini.mjs --prompt-only --day "Day 3"  # 產生 prompt → 貼進 Gemini App
node scripts/verify-with-gemini.mjs --apply-answer answers/x.json # 回覆轉成報告
```

預設走 Gemini App（用 Gemini Pro 訂閱，零額外成本）。
API 模式（`GEMINI_API_KEY=xxx node scripts/verify-with-gemini.mjs`）是另一套計費，
訂閱不含 API 額度，需要時再用。
