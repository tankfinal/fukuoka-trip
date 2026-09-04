---
name: verify-places
description: 用 Gemini（開 Google 搜尋）查證行程文件裡的地點資訊 — 店名、地址、電話、營業時間、公休日、票價、停車費、是否歇業或管制中。規劃或修改 README.md／index.html 的任何地點事實之前都要先跑一次；使用者說「查一下這家店」「這個時間對不對」「驗證地點」時也用這個流程。
---

# 用 Gemini 查證地點資訊

## 什麼時候用

新增或修改**任何地點事實**之前 —— 店名、地址、電話、營業時間、公休日、L.O.、最終入園、門票、停車費、歇業／臨時休館／災害管制。
純行程調度（誰幾點出發、車程估算、預算加總、排版）不用跑。

## 流程

### 1. 抽出待驗項目

```bash
node scripts/extract-places.mjs
```

從 `README.md` 掃出三類紀錄寫進 `verification/places.json`：
`spot`（每日行程表的景點）、`ticket`（門票表）、`parking`（停車場一覽）。
README 永遠是唯一資料來源，這個 JSON 只是投影，不要手改它——改 README 再重跑。

### 2. 丟給 Gemini 查證

> 💰 **使用者是 Gemini Pro 訂閱制，預設走 App 路線（A），不要主動叫他去辦 API key。**
> 訂閱和 Gemini API 是分開計費的兩套東西，訂閱**不含任何 API 額度**；
> API 免費層雖然不開帳單就不會被扣款，但涵蓋哪些模型會變動，且 Google Search
> grounding 另外算錢。只有使用者自己明講要用 API key 時才走 B。

**A. 預設 —— 走 Gemini App（用使用者已經在付的訂閱，零額外成本）**

```bash
node scripts/verify-with-gemini.mjs --prompt-only              # 全部
node scripts/verify-with-gemini.mjs --prompt-only --day "Day 3" # 只驗某一天
```

產生 `verification/prompts/01-spots.md`、`02-tickets.md`、`03-parking.md`。
接著：

1. 請使用者在 gemini.google.com 開新對話、選 2.5 Pro，把 prompt 整份貼上。
   檔案可以用 SendUserFile 傳給他，手機上比較好複製。
2. 使用者把 Gemini 的回覆**貼回對話**（不必自己存檔），你再寫進
   `verification/answers/<名稱>.json`，然後：

```bash
node scripts/verify-with-gemini.mjs --apply-answer verification/answers/spots.json
```

`--apply-answer` 吃得下整段含說明文字的回覆，會自己抓出 ```json 區塊，
一次可以吃多個檔案。

改動小的時候用 `--day` / `--id` 縮小範圍，不要每次都叫使用者貼 48 筆。

**B. 只有在使用者明講要用 API key 時 —— 自動跑**

```bash
node scripts/verify-with-gemini.mjs                    # 全部 48 筆
node scripts/verify-with-gemini.mjs --day "Day 3"      # 只驗某一天
node scripts/verify-with-gemini.mjs --id spot-32       # 只驗單一項目
node scripts/verify-with-gemini.mjs --kind ticket      # 只驗票價
node scripts/verify-with-gemini.mjs --limit 3          # 試跑
```

每筆送一次請求、開 `google_search` grounding、`temperature: 0`，預設併發 3。
模型預設 `gemini-2.5-pro`，可用 `--model` 或 `GEMINI_MODEL` 換。
跑之前先提醒使用者這條路可能產生費用。

### 3. 讀報告

`verification/gemini-report.md`（另有 `.json` 給程式用）。狀態：

| 狀態 | 意思 | 該做什麼 |
|---|---|---|
| ✅ ok | 全部相符 | 不動 |
| ⚠️ mismatch | 有欄位對不上 | 開來源確認 → 改 README |
| 🕒 outdated | 資訊過期（例如漲價） | 開來源確認 → 改 README + 補校正紀錄 |
| ❌ closed | 已歇業／永久關閉 | 通知使用者，提備案，不要自己決定換哪家 |
| ❓ not_found | 查不到 | 保留原內容，標「待確認」 |
| 💥 error | 呼叫失敗 | 重跑該筆 |

### 4. 改文件

**不要把 Gemini 的回答直接當事實抄進 README。**

- ⚠️🕒❌ 的項目：先讀報告裡的 `sources` 連結（用 WebFetch 實際打開看），確認得了才改。
- `confidence: high` + 官方網站來源 → 可以直接改。
- 其他情況 → 在 README 該處標「**待電話確認**」，並在回覆裡告訴使用者要打哪支電話問什麼。
- 改完在 README「🔍 重大資訊校正紀錄」表補一列（原稿 → 更正），來源網址加進「資料來源」。
- `README.md` 改了，`index.html` 對應的地方也要改。

### 5. 回報使用者

講清楚三件事：**幾筆查了、哪幾筆真的改了、哪幾筆還要他自己打電話確認**。
不要把「Gemini 說 ok」講成「已確認正確」——查證有信心度，講話也要有。

## 注意

- Gemini 對「今天是哪天」沒有可靠概念，prompt 裡已經寫死行程日期 2026/09/19–25 與白銀週連假、熊本地震、阿蘇噴火警戒的背景，改 prompt 時不要拿掉這段。
- 日本店家的營業時間在連假常有特別安排，報告的 `trip_date_note` 欄專門放這個，別忽略。
- 全部 48 筆跑一次大約 48 次 API 呼叫；只改一天的行程就用 `--day` 或 `--id`，不要每次全掃。
- App 路線同理：一次叫使用者貼 48 筆很煩，改一天就只給那一天的 prompt。
