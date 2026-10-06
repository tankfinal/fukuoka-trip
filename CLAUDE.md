# fukuoka-trip — Claude working notes

2026/9/19–9/25 福岡進出、九州自駕 7 日行程。

- `README.md`：行程內容本體（每日行程、住宿、租車、停車、門票、交通）
- `index.html`：GitHub Pages 網頁版，獨立手刻，不是由 README 產生
- Remote：`tankfinal/fukuoka-trip`

行程已走完。README 與 index.html 的規劃內容是出發前的版本，**原樣保留不改**；實際走法、採買、跟原計畫的差異只寫在 README「✅ 實際行程（含採買）」段與 index.html 的「✅ 實際行程」tab（`id="actual"`）。

## 分工：Claude 查詢與改檔，Google 驗證由使用者手動

| 工作類型 | 誰做 |
|---|---|
| 景點、營業時間／公休、門票、停車場、店家、餐廳、天候／火山／道路封閉等現況 | **Claude** 用 WebSearch / WebFetch 查 |
| 需要 Google Maps 或 Google 搜尋才能確認的：車程、距離、路線、只在 Google Maps 上有的地標名稱 | **使用者**手動查；Claude 列出要查的項目，不要自己估 |
| `index.html` 的版面、樣式、JS 功能（天氣、匯率、互動）與 README 排版 | **Claude** 直接做 |

### 查詢規則

- 每個事實附**具體來源頁 URL**（官方頁、tabelog 店舖頁、觀光協會頁），不能只給網域。
- 以查詢當天網路上的最新資料為準，不要用記憶作答；只找得到舊年份資料就標 ⚠️ 並寫出年份。
- 查不到就標 ⚠️，不要猜。
- 地點附 Google Maps 連結，格式跟 README 一致：`https://www.google.com/maps/dir/<地點1>/<地點2>/...`（英文名稱加地址，空白改成 `+`）。

### 查詢結果寫進檔案之前

- **會影響當天動線的**（營業時間、公休、封路、停車、票價、噴火警戒）要有具體來源頁才改；來源只有網域或前後矛盾時，列給使用者確認，不要改檔。
- 能用公式算的數字自己算：日落時間用 NOAA 公式算。
- 回報時分三類列出：改了什麼、依據的來源、還是 ⚠️ 的項目。

## 改檔

- 行程內容有異動時，`README.md` 和 `index.html` 兩邊都要同步改。
- Commit message 沿用既有風格：`feat(guide): ...`、`fix(itinerary): ...`，subject 寫為什麼改。
