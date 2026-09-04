# 福岡九州自駕行程 — 協作規則

這個 repo 是一份會被真的拿去日本用的行程文件（`README.md` 是唯一資料來源，`index.html` 是同一份資料的手機版網頁）。
寫錯營業時間、票價或地址，代價是當天站在門口吃閉門羹，所以有一條硬規則：

## 🔴 硬規則：地點資訊一律先給 Gemini 查證，再寫進文件

**只要新增或修改任何「地點事實」，寫進 `README.md` / `index.html` 之前必須先跑一次 Gemini 查證。**

「地點事實」指：

- 店名／景點名（中・日・英）、地址、電話
- 營業時間、公休日、最後點餐（L.O.）、最終入園時間
- 門票、停車費、共通券價格
- 是否歇業、臨時休館、災害或火山管制中

不算地點事實、不用查證的：行程時間安排、車程估算、行李清單、預算加總、文件排版。

### 怎麼跑

```bash
node scripts/extract-places.mjs                                 # README → verification/places.json
node scripts/verify-with-gemini.mjs --prompt-only --day "Day 3" # 產生 prompt，貼進 Gemini App
node scripts/verify-with-gemini.mjs --apply-answer <回覆檔>      # 把 Gemini 的回覆轉成報告
```

**預設走 Gemini App（`--prompt-only`），不要主動叫使用者去辦 API key。**
使用者是 Gemini Pro **訂閱制**，訂閱與 Gemini API 是分開計費、訂閱不含 API 額度；
API 免費層不開帳單雖然不會被扣款，但涵蓋的模型會變動、Google Search grounding 另計費。
只有使用者自己明講要用 API key 時，才改跑不帶 `--prompt-only` 的自動模式。

詳細流程與篩選選項見 `.claude/skills/verify-places/SKILL.md`。

### 查證結果怎麼用

1. 報告在 `verification/gemini-report.md`，狀態分成 ✅ 一致 / ⚠️ 有出入 / 🕒 過期 / ❌ 歇業 / ❓ 查不到。
2. **Gemini 說什麼就照抄是錯的做法**。它會查錯，也會把舊資料當成新的。
   凡是 ⚠️🕒❌ 的項目，要點開報告裡的 `sources` 連結自己看過官方頁面，確認後才改 README。
3. 只有 `confidence: high` 且來源是官方網站的更正，才可以直接改。
   其餘的在 README 對應位置標上「**待電話確認**」，不要假裝已經確認。
4. 改完在 README 的「🔍 重大資訊校正紀錄」表補一列（原稿 → 更正），並把來源加進「資料來源」。
5. 查不到（❓）的不要刪掉原本內容，標記成待確認即可。

## 其他慣例

- 文件語言：繁體中文為主，地點附 🇯🇵 日文 / 🇬🇧 英文對照（給導航和問路用）。
- `README.md` 與 `index.html` 內容要同步；改了一邊就要改另一邊。
- 訂位代號、確認碼、PIN 碼不寫進 repo（這是公開的 GitHub Pages）。
- `verification/answers/` 是貼回來的 Gemini 原始回覆，不進版控。
