# fukuoka-trip — Claude working notes

2026/9/19–9/25 福岡進出、九州自駕 7 日行程。

- `README.md`：行程內容本體（每日行程、住宿、租車、停車、門票、交通）
- `index.html`：GitHub Pages 網頁版，獨立手刻，不是由 README 產生
- Remote：`tankfinal/fukuoka-trip`

## 分工：行程查詢給 Gemini，網頁給 Claude

| 工作類型 | 誰做 |
|---|---|
| 景點、營業時間／公休、門票、停車場、車程距離、路線、市區交通、餐廳、天候／火山／道路封閉等現況 | **Gemini**（透過 `agy` 查） |
| `index.html` 的版面、樣式、JS 功能（天氣、匯率、互動）與 README 排版 | **Claude** 直接做 |

行程類資訊以 Google 的資料最準，所以查詢一律先問 Gemini，不要用 Claude 自己的知識或 WebSearch 回答。

### 呼叫 Gemini

```bash
agy -p "$PROMPT" --mode plan --model gemini-3.1-pro-high --print-timeout 10m --output-format json
```

回傳 JSON 的 `.response` 就是答案，`.status` 應為 `SUCCESS`。

- 要查的內容（行程片段、問題）**直接寫在 prompt 裡，不要用 stdin pipe**。用 pipe 時 Gemini 會想跑 `run_command`，被 headless 模式自動擋下，最後沒有任何輸出。
- 固定加 `--mode plan`（唯讀）。**不要加 `--dangerously-skip-permissions`**。
- `~/.gemini/antigravity-cli/settings.json` 的 `permissions.allow` 要有 `read_url(*)`（寫 `read_url` 不帶括號會被判定無效）。沒有這條，headless 模式會擋掉 `read_url_content`，Gemini 只能看搜尋摘要，給的來源多半只有網域。回傳 JSON 的 `denied_actions` 不是空的，就代表有工具被擋。
- 就算 prompt 是用參數傳，Gemini 還是可能去呼叫 `run_command` 然後被擋，最後沒有任何輸出。Prompt 裡要寫明：「只能使用 search_web 與 read_url_content，不要執行終端指令、不要建立或修改檔案，結果直接寫在回覆裡」。
- `.response` 有時只有一句「已整理在 plan.md / walkthrough.md」，完整內容會在 `~/.gemini/antigravity-cli/brain/<conversation_id>/` 底下。
- `agy` 的 Gemini **沒有 Google Maps 工具**，只有 `search_web` / `read_url_content`。它給的車程和距離是從搜尋結果整理的估計值，不是 Maps 即時算的路線。
- Prompt 裡要要求 Gemini：
  - 每個事實附**具體來源頁 URL**（不能只給網域）
  - 查不到就標 ⚠️，不要猜
  - **以查詢當天網路上的最新資料為準，不要用訓練資料或記憶作答**；結論要來自這次實際打開的頁面，只找得到舊年份資料就標 ⚠️ 並寫出年份
  - 地點附 Google Maps 連結，格式跟 README 一致：`https://www.google.com/maps/dir/<地點1>/<地點2>/...`（英文名稱加地址，空白改成 `+`）
- 帶搜尋的查證一次約 1–3 分鐘，Bash timeout 設 600000。

### Gemini 的結果寫進檔案之前

- Gemini 的回答只是線索，不是結論。**會影響當天動線的**（營業時間、公休、封路、停車、票價、噴火警戒）要有具體來源頁才改；來源只有網域或前後矛盾時，列給使用者確認，不要改檔。
- 能用公式算的數字自己算，不要採用 Gemini 的答案：日落時間用 NOAA 公式算。Gemini 曾把 9/22 阿蘇日落答成 17:39，實際約 18:13。
- 回報時分三類列出：改了什麼、依據的來源、還是 ⚠️ 的項目。

## 改檔

- 行程內容有異動時，`README.md` 和 `index.html` 兩邊都要同步改。
- Commit message 沿用既有風格：`feat(guide): ...`、`fix(itinerary): ...`，subject 寫為什麼改。
