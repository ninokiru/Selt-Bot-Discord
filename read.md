# Lumina Selfbot

Gateway selfbot cho Discord — voice · stream · afk · snipe · RPC · session-based.

---

## ⚠️ Cảnh báo

Đây là **selfbot** — dùng user token, vi phạm Discord Terms of Service.
- Tài khoản có thể bị ban tạm thời hoặc vĩnh viễn
- Chỉ dùng với tài khoản phụ hoặc tài khoản chấp nhận rủi ro
- Không bật mass DM, auto-reply, spam — dễ bị flag
- Session khuyến nghị: 2-6 giờ, sau đó nghỉ

---

## Yêu cầu

- **Node.js >= 22.12** — bắt buộc, vì `@discordjs/voice` 0.19 dùng DAVE (E2EE)
- **ffmpeg có libx264** — `npm install` cài `ffmpeg-static` (optional); hoặc cài ffmpeg vào PATH
- **Windows / Linux / macOS**
- Token Discord user account — đọc từ biến môi trường `DISCORD_TOKEN` hoặc `tokens.txt`
- (Tùy chọn) Discord Developer Application — để dùng RPC assets + buttons

---

## Cài đặt

```bash
cd "Selt-Bot-Discord-Beta"
npm install
```

`npm install` có thể lâu hơn bình thường vì `ffmpeg-static` tải binary ffmpeg (optional — nếu fail vẫn cài được, khi đó cần ffmpeg trong PATH).

> `package-lock.json` trong repo được tạo từ bản cũ (voice 0.18). Chạy `npm install` một lần để npm tự đồng bộ lock với `package.json` hiện tại (voice 0.19.2).

### Bước 1 — Token

Tạo `tokens.txt` ở root project:

```
MTIzNDU2Nzg5.MTk4NzY1NDM.WXYZ...
```

- Mỗi dòng 1 token, dòng bắt đầu `#` bị bỏ qua
- Selfbot đọc **token đầu tiên** trong file
- `tokens.txt` đã nằm trong `.gitignore` — không commit

Hoặc dùng biến môi trường — ưu tiên hơn file:

```bash
# Windows PowerShell
$env:DISCORD_TOKEN="MTIz..."

# Linux / macOS
export DISCORD_TOKEN="MTIz..."
```

Tên biến đổi được qua `config.json` → `tokenEnv`.

### Bước 2 — Config

Xem section **Config** bên dưới.

### Bước 3 — Chạy

```bash
npm start
```

Selfbot khởi động. Có TTY → dashboard TUI; không có TTY hoặc `dashboard: false` → chạy headless, log ra stdout.

---

## Cấu trúc thư mục

```
Selt-Bot-Discord-Beta/
├── src/
│   ├── index.js                Entry point — load config, login, orchestrate
│   ├── client.js               Gateway wrapper (discord.js-selfbot-v13)
│   ├── dashboard.js            TUI — Session / Stats / Commands / Log (có headless)
│   ├── logger.js               Log với ANSI levels
│   ├── shutdown.js             Global shutdown flag
│   ├── session.js              Session timer + log end
│   ├── stats.js                Counter runtime (messages, cmds, voice, stream, rpc...)
│   ├── config.js               Load config + defaults + validate/clamp
│   ├── voiceSession.js         Join/leave voice + auto reconnect
│   ├── stream.js               Go Live — capture màn hình + native stream connection
│   ├── voiceConfirm.js         Trạng thái chờ xác nhận yes/no (scoped theo channel)
│   ├── rpc.js                  Rich Presence — template, hot reload, external assets
│   ├── afk.js                  AFK state, cooldown, template, persist
│   ├── snipe.js                Lưu tin bị xoá / bị sửa theo channel (+ TTL, LRU)
│   ├── messageCache.js         Cache nội dung tin (30 phút, tối đa 2000, LRU)
│   ├── utils.js                Helpers (sleep, randInt, readJson, typing delay...)
│   └── commands/
│       ├── index.js            Registry + dispatcher + console + rate limit
│       ├── cmd.js              .cmd
│       ├── ping.js             .ping
│       ├── uptime.js           .uptime
│       ├── voice.js            .voice
│       ├── stream.js           .stream
│       ├── rpc.js              .rpc
│       ├── afk.js              .afk
│       ├── snipe.js            .snipe + .editsnipe
│       └── exit.js             .exit (hidden)
│
├── config.json                 Config chính
├── rpc.json                    Rich Presence config
├── channel.txt                 Whitelist channel IDs
├── tokens.txt                  Token (gitignore)
├── .afk.json                   AFK state (auto-gen, gitignore)
├── session.log                 Log JSON mỗi session (auto-gen, gitignore)
└── package.json
```

---

## Commands

Prefix mặc định `.` (đổi được trong `config.json` → `commands.prefix`).

Chạy từ **3 nguồn**:
- **Console** — gõ trực tiếp trong terminal
- **DM self** — nhắn tin cho chính tài khoản selfbot
- **Channel whitelist** — chỉ channel có ID trong `channel.txt`

**Không nhận từ người khác.** Code check `msg.author.id === client.user.id` — mọi tin nhắn từ account khác bị ignore hoàn toàn.

### System

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.cmd` | `.cmd` | List tất cả command khả dụng |
| `.cmd <name>` | `.cmd rpc` | Chi tiết 1 command (usage, alias, mô tả) |
| `.ping` | `.ping` | Gateway latency (ms) |
| `.uptime` | `.uptime` | Thời gian chạy + phần trăm session |
| `.exit` | `.exit` | Dừng selfbot (hidden — không show trong `.cmd`) |

### Voice

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.voice <channel_id>` | `.voice 1234567890` | Vào voice channel (tool tự tìm guild chứa channel) |
| `.voice` | `.voice` | Hỏi xác nhận rời voice channel hiện tại |
| `.voice leave` | `.voice leave` | Hỏi xác nhận rời (tường minh) |
| `.voice status` | `.voice status` | Trạng thái voice + reconnect attempts + lỗi cuối |
| `.voice list [guild_id]` | `.voice list` | Liệt kê voice channel có thể join |

`.voice` không có ID → selfbot hỏi lại. Trả lời **yes** để rời, **no** để ở lại (hết hạn sau 30s).
Xác nhận chỉ có hiệu lực trong **đúng channel** đã gửi lời hỏi — tin "yes"/"no" ở channel khác bị bỏ qua.
Gõ từ **console** thì không có channel để hỏi — `.voice` / `.voice leave` rời voice ngay.

**Lấy channel_id:**
- Bật Developer Mode trong Discord → Settings → Advanced → Developer Mode
- Chuột phải voice channel → Copy ID

### Stream (Go Live)

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.stream` | `.stream` | Stream màn hình vào voice channel hiện tại |
| `.stream <channel_id>` | `.stream 1234567890` | Vào channel đó rồi stream |
| `.stream status` | `.stream status` | Trạng thái stream (viewer, thời lượng, lỗi cuối) |
| `.stream stop` | `.stream stop` | Dừng stream + khôi phục voice (nếu `restoreVoice`) |

- Stream dùng **native voice stack** của lib để tạo Go Live, nên tạm rời `@discordjs/voice`; khi stop sẽ join lại channel cũ (nếu `restoreVoice: true`).
- Trong lúc stream, `.voice` bị chặn — dừng stream trước khi đổi voice.
- Capture mặc định: toàn màn hình (Windows `gdigrab`), 1280×720 @ 30fps, 2500 kbps.
- Video được ép `yuv420p` + keyframe 2s để tránh màn hình đen.

**DAVE/E2EE (quan trọng):** từ 03/2026 Discord bắt buộc DAVE cho voice + Go Live.
`@discordjs/voice` 0.19.2 đã hỗ trợ DAVE nên `.voice` hoạt động bình thường.
Native stack của `discord.js-selfbot-v13` **chưa hỗ trợ DAVE**, nên `.stream` có thể bị Discord từ chối (join fail/timeout) — khi đó code sẽ báo lỗi kèm gợi ý DAVE.

### Presence

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.rpc` / `.rpc status` | `.rpc status` | Xem trạng thái RPC hiện tại |
| `.rpc reload` / `.rpc on` | `.rpc reload` | Đọc lại `rpc.json` và áp dụng ngay |
| `.rpc off` | `.rpc off` | Tắt RPC tạm thời (quay về `status` trong config) |

Alias: `.presence`.

### AFK

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.afk <reason>` | `.afk đang ngủ` | Bật AFK kèm lý do |
| `.afk` | `.afk` | Bật AFK không lý do (gọi lần 2 = tắt) |
| `.afk off` | `.afk off` | Tắt AFK |
| `.afk status` | `.afk status` | Xem trạng thái + thống kê ping |
| `.afk list` | `.afk list` | Ai đã ping trong lúc AFK |
| `.afk silent on/off` | `.afk silent on` | Chỉ react emoji, không reply |

Khi AFK:
- Ai mention / reply / ping role → selfbot reply (hoặc react nếu silent mode)
- Cooldown mặc định 60s / user (`afk.cooldownMode`: `per_user` | `global` | `none`)
- Tự tắt AFK khi chính cậu gửi tin nhắn, và thông báo "đã trở lại" vào channel cuối cùng có ping

### Snipe

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.snipe` | `.snipe` | Tin bị xoá gần nhất trong channel |
| `.snipe <n>` | `.snipe 3` | Tin bị xoá thứ n |
| `.snipe list` | `.snipe list` | Danh sách tin bị xoá |
| `.snipe @user` | `.snipe @someone` | Tin bị xoá của user |
| `.snipe stats` | `.snipe stats` | Thống kê cache |
| `.snipe clear` | `.snipe clear` | Xoá cache snipe của channel |
| `.editsnipe` | như trên | Tin bị sửa (alias `.esnipe`) |

Giới hạn 10 tin / channel. Tin gửi trước khi selfbot online sẽ không có nội dung (chỉ còn metadata).

### Aliases

- `.editsnipe` → `.esnipe`
- `.rpc` → `.presence`

Các command khác gọi bằng tên đầy đủ.

---

## Config — `config.json`

```json
{
  "sessionMaxMinutes": 360,
  "sessionWarnMinutes": 300,
  "sessionAutoStop": true,
  "sessionLogFile": "session.log",
  "dashboard": true,
  "tokenEnv": "DISCORD_TOKEN",

  "status": {
    "type": "PLAYING",
    "text": "quests"
  },

  "commands": {
    "prefix": ".",
    "dmSelfEnabled": true,
    "channelEnabled": true,
    "consoleEnabled": true,
    "rateLimit": {
      "enabled": true,
      "windowMs": 60000,
      "maxCommands": 10,
      "cooldownMs": 1500,
      "ignoreDuplicateMs": 3000,
      "silentOnLimit": true
    }
  },

  "typingDelay": {
    "baseMinMs": 500,
    "baseMaxMs": 1200,
    "perCharMs": 15,
    "maxMs": 3500,
    "jitterMinMs": 0,
    "jitterMaxMs": 800
  },

  "antiDetection": {
    "reactDelayMinMs": 200,
    "reactDelayMaxMs": 800
  },

  "voice": {
    "autoReconnect": true,
    "reconnectMaxAttempts": 3,
    "selfDeaf": true,
    "selfMute": false
  },

  "stream": {
    "enabled": true,
    "width": 1280,
    "height": 720,
    "fps": 30,
    "bitrateKbps": 2500,
    "preset": "faster",
    "captureSource": "",
    "captureCursor": true,
    "restoreVoice": true
  },

  "afk": {
    "cooldownMs": 60000,
    "cooldownMode": "per_user",
    "maxReasonLen": 200,
    "replyTemplate": "Đang AFK: {reason} ({duration})",
    "noReasonTemplate": "Đang AFK — sẽ trả lời sau ({duration})",
    "backTemplate": "Đã trở lại — cảm ơn đã ping",
    "reactEmoji": "💤",
    "autoDisableOnActivity": true,
    "announceBack": true,
    "dmReply": false,
    "ignoreBots": true,
    "ignoreUsers": [],
    "ignoreChannels": [],
    "silentMode": false,
    "persist": true
  },

  "debug": false
}
```

### Field reference

**Session:**

| Field | Ý nghĩa |
|-------|---------|
| `sessionMaxMinutes` | Thời gian session tối đa (phút) — tự dừng khi hết |
| `sessionWarnMinutes` | Cảnh báo khi đạt (phút) |
| `sessionAutoStop` | `true` → tự dừng khi hết session |
| `sessionLogFile` | File ghi log cuối mỗi session (đường dẫn tương đối tính từ root project) |
| `dashboard` | `false` → chạy headless (chỉ log ra stdout; cũng tự bật khi không có TTY) |
| `tokenEnv` | Tên biến môi trường chứa token (mặc định `DISCORD_TOKEN`) |

**Status + commands:**

| Field | Ý nghĩa |
|-------|---------|
| `status.type` | `PLAYING` / `LISTENING` / `WATCHING` / `STREAMING` / `COMPETING` / `CUSTOM` — set 1 lần khi ready (bị RPC ghi đè nếu RPC bật) |
| `status.text` | Nội dung status |
| `commands.prefix` | Ký tự prefix — mặc định `.` |
| `commands.dmSelfEnabled` | Nhận lệnh từ DM self |
| `commands.channelEnabled` | Nhận lệnh từ channel whitelist |
| `commands.consoleEnabled` | Nhận lệnh từ console |
| `commands.rateLimit.enabled` | Bật rate limit |
| `commands.rateLimit.windowMs` | Cửa sổ thời gian (ms) |
| `commands.rateLimit.maxCommands` | Số lệnh tối đa trong window |
| `commands.rateLimit.cooldownMs` | Cooldown giữa 2 lệnh (ms) |
| `commands.rateLimit.ignoreDuplicateMs` | Bỏ qua lệnh trùng trong X ms |
| `commands.rateLimit.silentOnLimit` | `true` → không reply khi bị limit |

**Delay:**

| Field | Ý nghĩa |
|-------|---------|
| `typingDelay.baseMinMs` / `baseMaxMs` | Delay nền trước khi gửi reply (random trong khoảng) |
| `typingDelay.perCharMs` | Cộng thêm theo độ dài tin nhắn |
| `typingDelay.maxMs` | Trần phần cộng theo độ dài |
| `typingDelay.jitterMinMs` / `jitterMaxMs` | Jitter cộng thêm |
| `antiDetection.reactDelayMinMs` / `reactDelayMaxMs` | Delay trước khi reply trong dispatcher |

**Voice + AFK:**

| Field | Ý nghĩa |
|-------|---------|
| `voice.autoReconnect` | Tự reconnect khi mất kết nối voice |
| `voice.reconnectMaxAttempts` | Số lần thử reconnect tối đa |
| `voice.selfDeaf` | Tự deaf khi vào voice |
| `voice.selfMute` | Tự mute khi vào voice |
| `stream.enabled` | `false` → chặn `.stream` |
| `stream.width` / `height` | Độ phân giải output (mặc định 1280×720) |
| `stream.fps` | Frame rate (5-60, mặc định 30) |
| `stream.bitrateKbps` | Bitrate video (500-8000) |
| `stream.preset` | Preset libx264: `ultrafast` … `veryslow` |
| `stream.captureSource` | Nguồn capture. Windows: `desktop`, `title=Tên cửa sổ`, `hwnd=0x...`; Linux: `:0.0`; macOS: `1:none` |
| `stream.captureCursor` | Hiện con trỏ chuột trong stream |
| `stream.restoreVoice` | `true` → join lại voice cũ sau khi stop stream |
| `afk.cooldownMs` | Cooldown giữa 2 lần reply cho cùng người ping |
| `afk.cooldownMode` | `per_user` / `global` / `none` |
| `afk.maxReasonLen` | Độ dài lý do tối đa |
| `afk.replyTemplate` | Template khi có lý do — biến: `{user}` `{tag}` `{reason}` `{duration}` `{pings}` |
| `afk.noReasonTemplate` | Template khi không có lý do |
| `afk.backTemplate` | Tin nhắn "đã trở lại" — biến: `{duration}` |
| `afk.reactEmoji` | Emoji react khi có ping (rỗng = không react) |
| `afk.autoDisableOnActivity` | Tự tắt AFK khi cậu gửi tin nhắn |
| `afk.announceBack` | Gửi tin "đã trở lại" vào channel cuối có ping |
| `afk.dmReply` | Reply cả DM không mention |
| `afk.ignoreBots` | Bỏ qua ping từ bot |
| `afk.ignoreUsers` / `ignoreChannels` | Danh sách ID bỏ qua |
| `afk.silentMode` | Chỉ react, không reply |
| `afk.persist` | Lưu AFK state vào `.afk.json` (khôi phục sau restart, tối đa 24h) |
| `debug` | `true` → in log debug |

Config được **validate + clamp** khi load: giá trị sai kiểu/ngoài khoảng sẽ bị thay bằng mặc định và log cảnh báo (`Config: ...`). Field thiếu được bù từ defaults trong `src/config.js`.

---

## RPC — `rpc.json`

Rich Presence config riêng. Áp dụng khi ready, **hot reload** khi file thay đổi, và refresh định kỳ.

```json
{
  "enabled": true,
  "applyOnReady": true,
  "hotReload": true,
  "refreshInterval": 60,
  "templates": true,
  "status": "online",

  "application_id": "1100000000000000000",
  "application_name": "Visual Studio Code",
  "type": "PLAYING",

  "details": "Editing",
  "state": "index.js",

  "stream_url": "",

  "party_current": 0,
  "party_max": 0,
  "party_id": "",

  "large_image": "",
  "large_text": "",

  "small_image": "",
  "small_text": "",

  "buttons": [
    { "label": "GitHub", "url": "https://github.com/" }
  ],
  "button1_label": "",
  "button1_url": "",
  "button2_label": "",
  "button2_url": "",

  "timestamp_mode": "start",
  "start_timestamp": "now",
  "end_timestamp": 0
}
```

**Cơ chế:**

| Field | Ý nghĩa |
|-------|---------|
| `enabled` | `false` → tắt RPC, dùng `status` trong `config.json` (`.rpc on` bật tạm, bỏ qua cờ này) |
| `applyOnReady` | `false` → không áp dụng lúc khởi động (vẫn dùng được `.rpc reload`) |
| `hotReload` | `true` → tự reload khi `rpc.json` đổi (debounce) |
| `refreshInterval` | Giây giữa các lần refresh; tối thiểu 15, mặc định 60; `0` = tắt |
| `templates` | `true` → render biến trong text (xem bên dưới) |

**Template variables** — dùng trong `details`, `state`, `large_text`, `small_text`, `party_id`, `stream_url`, `button*_label`:

| Biến | Giá trị |
|------|---------|
| `{user}` | Username |
| `{tag}` | Tag đầy đủ |
| `{id}` | User ID |
| `{guilds}` | Số guild |
| `{ping}` | Gateway ping (ms) |
| `{uptime}` | Thời gian selfbot chạy |
| `{clock}` | Giờ hiện tại `HH:MM` |
| `{date}` | Ngày hiện tại `YYYY-MM-DD` |
| `{status}` | Trạng thái online/idle/dnd |

**Buttons:** hỗ trợ tối đa 2 nút. Có thể dùng mảng `buttons: [{ label, url }]`, hoặc 2 cặp `button1_label`/`button1_url`, `button2_label`/`button2_url`. URL phải là `http(s)://`.

Các field `details_url`, `state_url`, `large_url`, `small_url` **không còn được hỗ trợ** — gateway của selfbot không serialize chúng, nên đã bỏ khỏi config mẫu.

Text dùng font "fancy" (mathematical/fullwidth) sẽ bị Discord ẩn — tool tự strip các ký tự đó.

### Cách lấy `application_id` + upload ảnh

**Bắt buộc nếu muốn hiện assets (ảnh) và buttons.**

1. Vào `https://discord.com/developers/applications`
2. **New Application** → đặt tên
3. Copy **Application ID** (18-19 số) → dán vào `rpc.json` → `application_id`
4. Tab **Rich Presence** → **Art Assets** → **Add Image**
5. Upload ảnh PNG/JPG/WebP (min 512×512)
6. Đặt **key** (ví dụ `vscode`, `cross`) → dùng làm `large_image` / `small_image`
7. Đợi Discord duyệt (1-5 phút)

Hoặc dùng external URL (Imgur, GitHub raw):
```json
"large_image": "https://i.imgur.com/abc123.png"
```

Tool sẽ **upload external asset** qua Discord (`RichPresence.getExternal`) rồi dùng path trả về — cache 1 giờ cho URL thành công, 5 phút cho URL lỗi.

**Lưu ý:** URL phải là **direct link** (kết thúc `.png`/`.jpg`/`.webp`). Discord CDN URL dùng trực tiếp được; URL ngoài sẽ upload qua app đã đăng ký (cần `application_id`).

### Timestamp formats

| Input | Kết quả |
|-------|---------|
| `"now"` | Hiện tại |
| `"now - 5h30m"` | 5h30m trước |
| `"now + 2h"` | 2h sau |
| `"now - 3d"` | 3 ngày trước |
| `1730000000` | Unix seconds |
| `1730000000000` | Unix ms (tự convert) |
| `0` / `""` | Không dùng timestamp |

### Timestamp mode

| Mode | Hành vi |
|------|---------|
| `start` | Chỉ dùng `start_timestamp` — hiện "X minutes elapsed" |
| `end` | Chỉ dùng `end_timestamp` — hiện "X minutes left" |
| `both` | Dùng cả 2 |
| `none` | Không timestamp |

### Giới hạn user account

| Field | User account |
|-------|:-:|
| `name`, `type`, `url` | ✅ Luôn hiện |
| `details`, `state` | ✅ Hiện |
| `timestamps` | ✅ Hiện |
| `assets` | ⚠️ Chỉ hiện nếu `application_id` có app registered |
| `buttons` | ⚠️ Tương tự |
| `party` | ⚠️ Tương tự |

**Bot account thấy buttons**, bản thân không thấy. Đây là behavior của Discord, không phải bug.

---

## Bảo mật

### Token

- **Không commit** `tokens.txt` — `.gitignore` đã block
- **Không share** token với ai
- **Không paste** vào chat công khai
- Token bị leak → vào Discord → User Settings → My Account → **Log Out All Known Devices** → reset mật khẩu

### File permissions (Unix)

`tokens.txt` nên `chmod 600`. Selfbot tự warn nếu phát hiện permission mở.

```bash
chmod 600 tokens.txt
chmod 600 rpc.json
chmod 600 session.log
chmod 600 .afk.json
```

### Chỉ nhận lệnh từ chính mình

| Cơ chế | Chi tiết |
|--------|----------|
| **Chặn author** | Chỉ nhận lệnh từ chính selfbot user — `msg.author.id === client.user.id` |
| **Whitelist channel** | Chỉ DM self + channel có ID trong `channel.txt` |
| **Rate limit window** | 10 lệnh / 60s |
| **Cooldown** | 1.5s giữa các lệnh |
| **Duplicate filter** | Bỏ qua lệnh trùng trong 3s |
| **Silent on limit** | Không reply khi bị limit |
| **Session cap** | Tự dừng sau `sessionMaxMinutes` |

### Khi nào có thể bị flag

- Gửi nhiều lệnh liên tục (vượt rate limit)
- Mass DM / auto-reply
- Join/leave voice liên tục
- Chạy 24/7 không nghỉ

---

## API đang dùng

### Gateway Discord (qua `discord.js-selfbot-v13`)

| Opcode | Sự kiện | Mục đích |
|--------|---------|----------|
| Op 2 | IDENTIFY | Kết nối ban đầu với token |
| Op 1 | HEARTBEAT | Duy trì kết nối |
| Op 6 | RESUME | Reconnect sau khi mất kết nối |

**Events lắng nghe:**
- `ready` — client khởi động xong
- `messageCreate` — filter + dispatch command, cache tin, AFK
- `messageDelete`, `messageUpdate` — snipe
- `error`, `warn` — log
- `rateLimited` — log
- `shardDisconnect`, `shardReconnecting`, `shardResume`, `shardError` — log

### Voice Gateway (qua `@discordjs/voice`)

| Opcode | Mục đích |
|--------|----------|
| Op 0 | IDENTIFY — kết nối voice |
| Op 1 | SELECT_PROTOCOL — chọn protocol (UDP) |
| Op 2 | READY — server trả về SSRC + IP + port |
| Op 3 | HEARTBEAT — ping |
| Op 4 | SESSION_DESCRIPTION — server trả về secret key |
| Op 5 | SPEAKING — đánh dấu đang nói |

**Encryption:** `aead_xchacha20_poly1305_rtpsize` (mặc định lib).

**DAVE/E2EE:** `@discordjs/voice` 0.19.2 dùng `@snazzah/davey` — bắt buộc từ 03/2026.

**UDP:** RTP packet qua UDP hole punching.

### Go Live stream (native lib)

| Bước | API |
|------|-----|
| Join voice | `client.voice.joinChannel(channel, { videoCodec: 'H264' })` |
| Tạo stream | `connection.createStreamConnection()` |
| Gửi video | `streamConnection.playVideo(source, { fps, bitrate, inputFFmpegArgs, outputFFmpegArgs })` |

Capture màn hình do ffmpeg đảm nhận (`gdigrab` / `x11grab` / `avfoundation`), encode H264 baseline, đóng gói RTP rồi gửi qua voice UDP.

### Discord Rich Presence (gateway)

Gửi qua `client.user.setPresence()`:
```js
client.user.setPresence({
  activities: [activityObject],
  status: 'online',
});
```

Activity object:
```js
{
  name, type, url,
  details, state,
  timestamps: { start, end },
  assets: { large_image, large_text, small_image, small_text },
  buttons: ['Label 1', 'Label 2'],
  metadata: { button_urls: ['https://...', 'https://...'] },
  party: { id, size: [current, max] },
  application_id,
  ...
}
```

Selfbot gateway serialize buttons dạng `labels + metadata.button_urls` (khác bot thường).

**Không dùng Local RPC** (`127.0.0.1:6463`) — chỉ cần gateway, không cần Discord desktop chạy.

---

## Rate limit — cơ chế

Config:
```json
"rateLimit": {
  "enabled": true,
  "windowMs": 60000,
  "maxCommands": 10,
  "cooldownMs": 1500,
  "ignoreDuplicateMs": 3000,
  "silentOnLimit": true
}
```

**Test:**
- Gửi `.cmd` 2 lần trong 3s → lần 2 bị ignore (duplicate)
- Gửi `.cmd` rồi `.ping` sau 1s → bị block (cooldown 1.5s)
- Gửi 15 lệnh trong 1 phút → lệnh 11+ bị block (window)
- `silentOnLimit: true` → không reply khi bị block

**Console không bị rate limit** — chỉ DM + channel.

---

## Session log

File `session.log` (đổi được qua `config.json` → `sessionLogFile`) — JSON Lines format. Mỗi session 1 dòng:

```json
{"startedAt":"2026-09-20T10:00:00.000Z","endedAt":"2026-09-20T16:00:00.000Z","durationSec":21600,"maxSec":21600}
```

- `durationSec` — thời gian thực chạy
- `maxSec` — giới hạn session cấu hình
- Nếu `durationSec < maxSec` → session dừng sớm (user tắt hoặc crash)

Xem log cũ:
```bash
type session.log
# hoặc
tail -f session.log   # Unix
```

---

## Troubleshooting

### Thiếu deps / `Cannot find module`
```bash
npm install
```

Nếu `npm install` báo lockfile lệch (`@discordjs/voice` 0.18 vs 0.19.2), chạy lại `npm install` để npm cập nhật `package-lock.json`; không cần xoá lock.

### `Không có token — đặt DISCORD_TOKEN hoặc tạo ...tokens.txt`
- Đặt biến môi trường `DISCORD_TOKEN` (hoặc tên trong `config.tokenEnv`), hoặc
- Tạo `tokens.txt` ở root project, mỗi dòng 1 token
- Bỏ dòng trống và comment (`#`)

### Voice timeout 30s
- Firewall block UDP → mở port hoặc tắt firewall tạm
- VPN đang bật → tắt
- Thử voice channel khác
- Node < 22.12 hoặc `@discordjs/voice` < 0.19.2 → không có DAVE, Discord chặn

### Voice crash / process tự thoát
- Đã thêm listener `error` cho voice connection + bắt `unhandledRejection` / `uncaughtException`
- Nếu vẫn thoát: bật `debug: true`, chạy lại, gửi log quanh thời điểm crash
- Kiểm tra Node >= 22.12 và đã `npm install` lại sau khi update

### `.stream` báo không tìm thấy ffmpeg
- Chạy `npm install` để cài `ffmpeg-static` (optional)
- Hoặc cài ffmpeg có libx264 vào PATH, kiểm tra:
  ```bash
  ffmpeg -hide_banner -encoders | findstr libx264
  ```

### `.stream` join fail / timeout (DAVE)
- Discord bắt buộc DAVE/E2EE từ 03/2026; native stack chưa hỗ trợ → Go Live có thể bị từ chối
- `.voice` vẫn dùng `@discordjs/voice` 0.19.2 (DAVE OK), chỉ `.stream` bị ảnh hưởng

### Stream vào nhưng màn hình đen
- DRM / protected content (Netflix, app exclusive-fullscreen) → luôn đen, không sửa được
- Thử chạy app ở windowed/borderless thay vì exclusive fullscreen
- Kiểm tra `stream.captureSource` (mặc định `desktop` = toàn màn hình)
- Bật `debug: true` để xem log ffmpeg (`ffmpeg:` trong dashboard)

### `.cmd` gửi trong DM không reply
- Token đúng chưa? Login thành công chưa?
- `dmSelfEnabled: true` trong config?
- Debug: bật `debug: true`, chạy lại, xem log có `Recv:` không

### `.snipe` không có nội dung tin
- Tin đó gửi trước khi selfbot online → không có trong cache
- Cache giữ 30 phút / tối đa 2000 tin

### Console không nhận lệnh
- `consoleEnabled: true` trong config?
- Dashboard chiếm stdin — gõ lệnh trực tiếp vào terminal đang chạy, không mở terminal khác

### RPC không hiện assets
- `application_id` hợp lệ chưa (18-19 số)?
- Ảnh đã upload vào app chưa?
- Key đúng chưa (case-sensitive)?
- Đợi 1-5 phút sau khi upload
- URL ngoài Discord phải là direct link; tool upload qua `getExternal` — xem log `RPC:` nếu lỗi
- User account không tự thấy buttons của chính mình; nhờ account khác/bot kiểm tra

### `.rpc` không áp dụng
- `rpc.json` sai JSON → log `RPC: ... sai JSON`
- `enabled: false` hoặc đang `applyOnReady: false` → dùng `.rpc reload`
- Đã `.rpc off` trước đó → `.rpc on`
- `refreshInterval` < 15 sẽ bị kẹp về 15

### Dashboard không hiện
- Thiếu TTY / chạy qua pipe → tự chuyển headless (log thẳng ra stdout)
- `dashboard: false` trong config → luôn headless
- Console vẫn gõ lệnh được ở headless

### Session không tự dừng
- `sessionAutoStop: true` trong config?
- Timer check mỗi 60s — có thể trễ tối đa 1 phút

---

## License

Private use. Not for redistribution.

## Credits

Built by Lumina
