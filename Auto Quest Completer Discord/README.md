# Discord Quest Auto-Completer

Auto-accept và auto-complete Discord quests. Multi-token, multi-region proxy, session-based.

Reward Discord **tự grant** sau khi complete — tool **không claim** (endpoint claim dùng hCaptcha, không bypass).

---

## ⚠️ Cảnh báo

Đây là **selfbot** — dùng user token, vi phạm Discord Terms of Service.
- Tài khoản có thể bị ban tạm thời hoặc vĩnh viễn
- Chỉ dùng với tài khoản phụ hoặc tài khoản chấp nhận rủi ro
- Quest có thể bị Discord flag nếu request quá nhanh hoặc pattern bất thường
- Tool có cơ chế anti-detection nhưng không đảm bảo 100%

---

## Yêu cầu

- **Node.js >= 20**
- **Windows / Linux / macOS**
- Token Discord user account (không phải bot token)
- (Tùy chọn) Proxy — residential/mobile khuyến nghị

---

## Cài đặt

### Cách 1 — qua launcher root (khuyến nghị)

```bash
cd "Selt Bot Discord"
npm run install:all
npm start
# → chọn [1] Farm Quest
```

### Cách 2 — chạy trực tiếp

```bash
cd "Selt Bot Discord/Auto Quest Completer Discord"
npm install
npm start
```

### Bước 1 — Token

Token nằm ở **root** `Selt Bot Discord/tokens.txt`:

```
MTIzNDU2Nzg5.MTk4NzY1NDM.WXYZ...
OTg3NjU0MzIx.MTc2NTQzMjE.ABCD...
```

- Mỗi dòng 1 token
- Dòng bắt đầu `#` bị bỏ qua
- Tool chạy tuần tự từng token

### Bước 2 — Proxy (tùy chọn)

Proxy nằm ở **root** `Selt Bot Discord/proxies.txt`:

```
US|http://user:pass@1.2.3.4:8080
JP|socks5://user:pass@5.6.7.8:1080
VN|9.10.11.12:3128
```

**Format:**
- `LABEL|url` — label là mã nước (US, JP, VN...)
- `url` — `protocol://user:pass@host:port`
- Nếu không có label → tool tự detect country qua `ipwho.is`
- Nếu không có protocol → mặc định `http://`

**Để trống file** → tool tự tải proxy free (nếu `autoDownloadProxies: true`).

### Bước 3 — Config

Xem section **Config** bên dưới.

### Bước 4 — Chạy

```bash
npm start
```

Dashboard hiện ra:
```
[1] Scan & complete quests
[2] Exit
```

Bấm `1` để chạy flow hoàn chỉnh.

---

## Cấu trúc thư mục

```
Auto Quest Completer Discord/
├── assets/
│   └── logo.txt                Custom logo cho dashboard (tùy chọn)
│
├── src/
│   ├── index.js                Entry point — orchestrate toàn bộ
│   ├── api.js                  DiscordAPI class — HTTP client + retry + timezone
│   ├── builder.js              Super properties + headers + timezone map
│   ├── cooldown.js             Cooldown + CooldownRegistry — share per-proxy
│   ├── dashboard.js            TUI blessed — logo, stats, menu, log
│   ├── logger.js               Log ANSI levels + NO_COLOR support
│   ├── proxydl.js              Auto-download proxy free từ GitHub
│   ├── quest.js                Parse quest object + estimate + classify
│   ├── shutdown.js             Global shutdown flag
│   ├── splash.js               ASCII art LUMINA khi khởi động
│   ├── useragent.js            UA + client info + auto-update
│   ├── utils.js                Helpers: read/write, parse proxy, detect country
│   ├── voice.js                Pick activity channel cho PLAY_ACTIVITY
│   │
│   └── completer/
│       ├── video.js            WATCH_VIDEO + WATCH_VIDEO_ON_MOBILE
│       └── heartbeat.js        PLAY_ON_DESKTOP(_V2) + STREAM + PLAY_ACTIVITY
│
├── config.json                 Config chính
├── .state.json                 State — quest đã complete (auto-gen)
├── package.json
├── .gitignore
└── README.md
```

---

## Menu & Thao tác

```
┌─ Menu  chọn số tương ứng hoặc enter ──────────────────────────┐
│  [1] Scan & complete quests       [2] Exit                    │
└───────────────────────────────────────────────────────────────┘
```

### `[1] Scan & complete quests`

Flow hoàn chỉnh:
1. **Action start delay** — chờ 3-8s (mô phỏng user)
2. **Scan phase** — xoay proxy, fetch quest, auto-accept
3. **Delay 2-5s** giữa scan và complete
4. **Complete phase** — complete quest đã enrolled
5. **Account switch delay** — chờ 5-10s trước token kế
6. Lặp lại cho từng token

### `[2] Exit`

Thoát sạch. Session đang chạy (nếu có) bị hủy.

### Phím tắt

| Phím | Tác dụng |
|------|----------|
| `1` | Chọn Scan & complete |
| `2` | Chọn Exit |
| `Enter` | Xác nhận menu item đang highlight |
| `q` / `Esc` | Graceful quit (đợi quest hiện tại) |
| `Ctrl+C` | Graceful quit lần 1, force lần 2 |
| `PgUp` / `PgDn` | Scroll log |

---

## Config — `config.json`

```json
{
  "proxyCooldownMs": 20000,
  "proxyCooldownJitterMs": 6000,
  "enrollCooldownMinMs": 25000,
  "enrollCooldownMaxMs": 40000,
  "accountSwitchDelayMinMs": 5000,
  "accountSwitchDelayMaxMs": 10000,
  "actionStartDelayMinMs": 3000,
  "actionStartDelayMaxMs": 8000,
  "requestJitterMinMs": 200,
  "requestJitterMaxMs": 1500,

  "useProxies": true,
  "allowDirectFallback": true,
  "warnIfNoProxies": true,
  "detectProxyCountry": true,

  "autoDownloadProxies": true,
  "autoDownloadCountries": ["VN", "SG", "TH", "ID", "PH", "MY", "JP", "KR", "US", "GB"],
  "proxiesPerCountry": 1,
  "maxTotalProxies": 200,
  "proxyVerifyTimeoutMs": 5000,
  "proxyVerifyConcurrency": 80,
  "proxyFallbackPoolSize": 5000,

  "pollInterval": 60,
  "heartbeatIntervalGame": 60,
  "heartbeatIntervalStream": 30,
  "videoSpeed": 7,
  "videoMaxFuture": 10,
  "videoIntervalSec": 12,
  "progressLogEvery": 5,

  "autoAccept": true,
  "autoUpdateClientVersion": true,
  "concurrency": 1,
  "debug": false,

  "jitterMs": [5000, 30000],

  "retry": {
    "maxAttempts": 3,
    "baseDelayMs": 2000
  },

  "clientVersion": "1.0.9175",
  "electronVersion": "32.2.7",
  "chromeVersion": "128.0.6613.186",
  "osVersion": "10.0.26100",
  "nativeBuildNumber": 59498,

  "proxyCheckConcurrency": 100,
  "countryDetectConcurrency": 30
}
```

### Field reference

**Timing & cooldown:**

| Field | Ý nghĩa |
|-------|---------|
| `proxyCooldownMs` | Chờ tối thiểu giữa các request khi xoay proxy |
| `proxyCooldownJitterMs` | Random thêm 0-X ms → cooldown thực = `proxyCooldownMs` + random(0, jitter) |
| `enrollCooldownMinMs` / `MaxMs` | Random chờ giữa các enroll |
| `accountSwitchDelayMinMs` / `MaxMs` | Random chờ giữa các token |
| `actionStartDelayMinMs` / `MaxMs` | Random chờ trước khi bắt đầu action |
| `requestJitterMinMs` / `MaxMs` | Random delay mọi request HTTP (200-1500ms) |

**Proxy:**

| Field | Ý nghĩa |
|-------|---------|
| `useProxies` | `false` → chạy IP máy |
| `allowDirectFallback` | `true` → fallback IP máy khi hết proxy sống |
| `warnIfNoProxies` | In warning khi không có proxy |
| `detectProxyCountry` | Tự detect country nếu proxy thiếu label |
| `autoDownloadProxies` | Tự tải proxy free khi file trống / parse fail / chết hết |
| `autoDownloadCountries` | Danh sách mã nước ưu tiên |
| `proxiesPerCountry` | Số proxy tối đa mỗi nước |
| `maxTotalProxies` | Trần tổng |
| `proxyVerifyTimeoutMs` | Timeout verify 1 proxy |
| `proxyVerifyConcurrency` | Số proxy verify song song |
| `proxyFallbackPoolSize` | Pool fallback khi Databay miss |

**Quest:**

| Field | Ý nghĩa |
|-------|---------|
| `pollInterval` | Giây giữa các lần quét |
| `heartbeatIntervalGame` | Giây giữa heartbeat cho `PLAY_ON_DESKTOP` (theo client thật = 60s) |
| `heartbeatIntervalStream` | Giây giữa heartbeat cho `STREAM` + `PLAY_ACTIVITY` |
| `videoSpeed` | Giây cộng vào timestamp mỗi lần gửi video progress |
| `videoMaxFuture` | Buffer cho phép timestamp vượt thực tế |
| `videoIntervalSec` | Giây giữa các lần gửi video-progress (docs: 10-15s) |
| `progressLogEvery` | Log progress mỗi N lần (giảm spam) |

**Khác:**

| Field | Ý nghĩa |
|-------|---------|
| `autoAccept` | Tự enroll quest khi scan |
| `autoUpdateClientVersion` | Auto-fetch client version từ discord.com |
| `concurrency` | >1 → chạy nhiều token song song |
| `debug` | In log debug |

---

## Các loại quest hỗ trợ

| Task type | Complete bằng cách | Đặc điểm |
|-----------|-------------------|----------|
| `WATCH_VIDEO` | `POST /quests/{id}/video-progress` | Progress tăng theo timestamp |
| `WATCH_VIDEO_ON_MOBILE` | Giống trên | Mobile variant |
| `PLAY_ON_DESKTOP` | `POST /quests/{id}/heartbeat` | Progress ~thời gian thực |
| `PLAY_ON_DESKTOP_V2` | Giống trên | V2 variant |
| `STREAM_ON_DESKTOP` | `POST /quests/{id}/heartbeat` | Interval ngắn hơn |
| `PLAY_ACTIVITY` | `POST /quests/{id}/heartbeat` | Cần channel ID cho stream_key |

**Không hỗ trợ (bỏ qua):**

| Task type | Lý do |
|-----------|-------|
| `PLAY_ON_XBOX` | Cần console thật |
| `PLAY_ON_PLAYSTATION` | Cần console thật |
| `ACHIEVEMENT_IN_GAME` | Track bởi application, selfbot không giả được |
| `ACHIEVEMENT_IN_ACTIVITY` | Track bởi application |

---

## API đang dùng

### Discord REST (base: `https://discord.com/api/v9`)

| Endpoint | Mục đích |
|----------|----------|
| `GET /users/@me` | Validate token + lấy user info |
| `GET /quests/@me` | Fetch quest của user |
| `GET /quests/@me/claimed` | Đếm quest đã claim (log) |
| `POST /quests/{id}/enroll` | Enroll quest |
| `POST /quests/{id}/video-progress` | Update progress video |
| `POST /quests/{id}/heartbeat` | Update progress game/stream/activity |
| `GET /users/@me/channels` | Lấy DM channel cho `PLAY_ACTIVITY` |
| `GET /users/@me/guilds` | Lấy guild list cho `PLAY_ACTIVITY` |
| `GET /guilds/{id}/channels` | Lấy channel list cho `PLAY_ACTIVITY` |
| `GET /applications/public?application_ids=` | Lấy app info cho stream key |
| `GET /gateway` | Check proxy health |

### Discord Web

| Endpoint | Mục đích |
|----------|----------|
| `GET https://discord.com/app` | Fetch HTML → regex lấy JS asset hashes |
| `GET https://discord.com/assets/{hash}.js` | Fetch JS → regex lấy `buildNumber` |

### Third-party

| Endpoint | Mục đích |
|----------|----------|
| `http://ip-api.com/json/?fields=countryCode` | Detect country từ proxy IP |
| `https://ipwho.is/` | Fallback detect country |
| `https://api.country.is/` | Fallback 2 detect country |

---

## Luồng thực thi chi tiết

### Khi khởi động

```
main()
  ├─ Load config.json
  ├─ Audit secret files (warn permission)
  ├─ Load UA + client info
  ├─ Auto-update client version từ discord.com (nếu bật)
  ├─ Show splash LUMINA (1.5s)
  ├─ Create dashboard
  ├─ Load tokens.txt
  ├─ Load proxies.txt
  ├─ Fetch build number (discord.com assets)
  ├─ Load state (.state.json)
  └─ checkAll()
      ├─ validateProxies()
      │   ├─ Loop: proxy có → verify → sống → OK
      │   ├─ Chết hết → xoá + tải lại 1 lần → verify lại
      │   └─ Vẫn chết → fallback IP máy
      └─ validateTokens()
          ├─ Loop từng token → GET /users/@me
          └─ Loại bỏ token invalid (401/403)
```

### Khi bấm `[1]`

**Phase 1 — SCAN (per token):**

```
actionStartDelay (3-8s)
  ↓
For each token:
  ├─ Skip nếu token không validate
  ├─ Fetch claimed count (log only)
  ├─ Pick activity channel (DM hoặc voice channel)
  ├─ Shuffle proxy order
  │
  ├─ For each proxy:
  │   ├─ Cooldown wait (20-26s)
  │   ├─ GET /quests/@me (qua proxy đó)
  │   ├─ Merge quest into pool (dedup by ID)
  │   └─ For each unaccepted quest:
  │       ├─ Enroll cooldown (25-40s)
  │       ├─ POST /quests/{id}/enroll
  │       └─ Update local status
  │
  └─ Lưu cache quests vào ctx.questCacheByToken[tokenKey]
  ↓
sleepResponsive (2-5s) giữa scan → complete
```

**Phase 2 — COMPLETE (per token):**

```
For each token:
  ├─ Load quest cache
  ├─ Filter:
  │   ├─ isEnrolled
  │   ├─ !isCompleted
  │   ├─ !isClaimed
  │   └─ isCompletable (supported task type, chưa expire, đã start)
  │
  ├─ Log breakdown: cache / completed / claimed / đang dở
  ├─ Log ước lượng thời gian (dựa trên task type + target)
  ├─ Set dashboard estimate + queue
  │
  ├─ For each actionable quest:
  │   ├─ Skip nếu đã complete/claim (giữa lúc chờ)
  │   ├─ Set proxy = proxy đã tìm ra quest đó
  │   ├─ Dispatch:
  │   │   ├─ WATCH_VIDEO → completeVideo()
  │   │   ├─ PLAY_ON_DESKTOP/STREAM/ACTIVITY → completeHeartbeat()
  │   │   └─ Cập nhật estimate còn lại
  │   ├─ Save state (atomic write)
  │   ├─ Update dashboard queue progress
  │   └─ Delay 5s giữa quest
  │
  └─ Clear estimate
  ↓
accountSwitchDelay (5-10s)
```

---

## Bảo mật

### Token

- **Không commit** `tokens.txt` — `.gitignore` đã block
- **Không share** token
- **Không paste** vào chat công khai
- Token bị leak → Discord → User Settings → **Log Out All Known Devices** → reset mật khẩu

### File permissions

`tokens.txt` nên `chmod 600`. Tool tự warn nếu phát hiện permission mở.

```bash
chmod 600 "Selt Bot Discord/tokens.txt"
chmod 600 "Selt Bot Discord/Auto Quest Completer Discord/.state.json"
```

### Atomic write

`.state.json` được ghi bằng **write vào `.tmp` → rename**. Nếu process crash giữa chừng → file cũ vẫn nguyên, không bị corrupt.

### Log sanitization

`redactSecret()` strip token format trong log — tránh leak qua exception message.

### Proxy credentials

- Proxy credentials URL-encoded trong config → decode khi dùng
- Không log raw proxy credentials (chỉ log host:port)
- Không dùng proxy cho validate token đầu tiên (chỉ direct)

---

## Anti-detection

| Cơ chế | Chi tiết |
|--------|----------|
| **Jitter mọi request** | 200-1500ms delay random trước mỗi HTTP request |
| **Proxy cooldown** | 20-26s giữa các lần đổi proxy |
| **Enroll cooldown** | 25-40s giữa các lần enroll |
| **Account switch** | 5-10s giữa các token |
| **Action start delay** | 3-8s trước khi bắt đầu action |
| **Shuffle proxy order** | Mỗi cycle đổi thứ tự proxy → không pattern |
| **Video interval** | 12s + jitter 0-3s (theo docs Discord: 10-15s) |
| **Heartbeat interval** | 60s cho game (đúng client thật) |
| **UA khớp client** | Share UA với builder → super properties + UA consistent |
| **Timezone khớp IP** | `X-Discord-Timezone` update theo proxy country |
| **Rate limit** | Handle 429 với `retry_after`, cap delay 60s |
| **Retry 5xx** | Exponential backoff, cap 30s |
| **Enrollment blocked** | Nếu server trả `enrollment_blocked_until` → skip auto-accept |
| **Safety timeout** | Video/heartbeat có deadline 2× target + 5 phút |

---

## Rate limit — cơ chế

### Discord rate limit

- **429 response** có field `retry_after` (giây)
- API client đọc, chờ `retry_after + 1s`, retry
- Cap 60s để tránh chờ vô hạn
- Lặp quá `maxAttempts` → return response cuối (không crash)

### 5xx retry

- **500-599** → retry exponential backoff
- Delay: `baseDelayMs × 2^(attempt-1)`, cap 30s
- Mặc định 3 attempts

### Custom rate limit (proxy)

- `Cooldown` class serialize mọi request khi đổi proxy
- `CooldownRegistry` share giữa các token chạy song song → không 2 token hit cùng proxy cùng lúc

---

## Trạng thái file

### `.state.json`

```json
{
  "completed": {
    "a1b2c3d4e5f6": ["1234567890123456789", "9876543210987654321"],
    "f6e5d4c3b2a1": ["1111111111111111111"]
  }
}
```

- Key = `sha256(token).slice(0,12)` — token identity
- Value = array quest IDs đã complete thành công
- Cap 2000 IDs / token — tránh file phình
- Write atomic — không bị corrupt khi crash

**Xoá file** → tool complete lại từ đầu (dùng khi muốn retry tất cả).

---

## Troubleshooting

### `Token không hợp lệ (401)`
- Token hết hạn / bị revoke → lấy token mới từ Discord web
- Xem hướng dẫn: Discord → F12 → Application → Local Storage → `token`

### `Token bị flag (403)`
- Tài khoản bị Discord hạn chế
- Chờ vài giờ hoặc liên hệ support
- **Không** cố bypass — có thể bị ban vĩnh viễn

### `Enroll 400 – CAPTCHA`
- Discord yêu cầu hCaptcha cho endpoint enroll
- Không tự giải được
- Bỏ qua quest đó, enroll thủ công trong Discord app

### `proxies.txt có N dòng nhưng 0 dòng parse được`
- Kiểm tra format: `LABEL|url` hoặc `url`
- Port phải là số: `1.2.3.4:8080` (không phải `1.2.3.4:abc`)
- Protocol hợp lệ: `http`, `https`, `socks4`, `socks5`

### Proxy chết hết, không fallback
- Kiểm tra `allowDirectFallback: true` trong config
- Nếu `false` → tool exit khi hết proxy sống

### Video progress lỗi liên tục
- Check log — có field `retry_after` không?
- Discord có thể chặn nếu timestamp vượt nhiều
- Giảm `videoSpeed` (7 → 5) hoặc tăng `videoIntervalSec` (12 → 15)

### Quest complete nhưng reward không có
- Discord grant reward tự động
- Nếu chưa có → vào Discord app → Quest Home → check
- Reward có thể bị giới hạn số lượng → Discord grant tier khác

### Rate limit liên tục (429)
- Tăng `proxyCooldownMs` (20000 → 30000)
- Tăng `requestJitterMinMs` (200 → 500)
- Giảm `concurrency` (nếu > 1)

---

## Debug

Bật `debug: true` trong config → log chi tiết hơn:
- HTTP request/response headers
- Proxy switch
- Chọn activity channel
- Quest filtering lý do

Log được lưu trong dashboard log panel. Không tự ghi file — nếu cần, redirect stdout:
```bash
npm start > quest.log 2>&1
```

---

## License

Private use. Not for redistribution.

## Credits

Built by Lumina for He.