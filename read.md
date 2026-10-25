# Lumina Selfbot

Gateway selfbot cho Discord — voice · afk · snipe · RPC · session-based.

---

## ⚠️ Cảnh báo

Đây là **selfbot** — dùng user token, vi phạm Discord Terms of Service.
- Tài khoản có thể bị ban tạm thời hoặc vĩnh viễn
- Chỉ dùng với tài khoản phụ hoặc tài khoản chấp nhận rủi ro
- Không bật mass DM, auto-reply, spam — dễ bị flag
- Session khuyến nghị: 2-6 giờ, sau đó nghỉ

---

## Yêu cầu

- **Node.js >= 20**
- **Windows / Linux / macOS**
- Token Discord user account
- (Tùy chọn) Discord Developer Application — để dùng RPC assets + buttons

---

## Cài đặt

```bash
cd "Selt-Bot-Discord-Beta"
npm install
```

### Bước 1 — Token

Tạo `tokens.txt` ở root project:

```
MTIzNDU2Nzg5.MTk4NzY1NDM.WXYZ...
```

- Mỗi dòng 1 token, dòng bắt đầu `#` bị bỏ qua
- Selfbot đọc **token đầu tiên** trong file
- `tokens.txt` đã nằm trong `.gitignore` — không commit

### Bước 2 — Config

Xem section **Config** bên dưới.

### Bước 3 — Chạy

```bash
npm start
```

Selfbot khởi động, dashboard hiện ra.

---

## Cấu trúc thư mục

```
Selt-Bot-Discord-Beta/
├── src/
│   ├── index.js                Entry point — load config, login, orchestrate
│   ├── client.js               Gateway wrapper (discord.js-selfbot-v13)
│   ├── dashboard.js            TUI — panel Session / Stats / Commands / Log
│   ├── logger.js               Log với ANSI levels
│   ├── shutdown.js             Global shutdown flag
│   ├── session.js              Session timer + log end
│   ├── stats.js                Counter runtime (messages, cmds, voice...)
│   ├── voiceSession.js         Join/leave voice + auto reconnect
│   ├── voiceConfirm.js         Trạng thái chờ xác nhận yes/no
│   ├── rpc.js                  Rich Presence — đọc từ rpc.json
│   ├── afk.js                  AFK state, cooldown, template, persist
│   ├── snipe.js                Lưu tin bị xoá / bị sửa theo channel
│   ├── messageCache.js         Cache nội dung tin (30 phút, tối đa 2000)
│   ├── utils.js                Helpers (sleep, randInt, readJson, typing delay...)
│   └── commands/
│       ├── index.js            Registry + dispatcher + console + rate limit
│       ├── cmd.js              .cmd
│       ├── ping.js             .ping
│       ├── uptime.js           .uptime
│       ├── voice.js            .voice
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
| `.ping` | `.ping` | Gateway latency (ms) |
| `.uptime` | `.uptime` | Thời gian chạy + phần trăm session |
| `.exit` | `.exit` | Dừng selfbot (hidden — không show trong `.cmd`) |

### Voice

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.voice <channel_id>` | `.voice 1234567890` | Vào voice channel (tool tự tìm guild chứa channel) |
| `.voice` | `.voice` | Hỏi xác nhận rời voice channel hiện tại |

`.voice` không có ID → selfbot hỏi lại. Trả lời **yes** để rời, **no** để ở lại (hết hạn sau 30s).

**Lấy channel_id:**
- Bật Developer Mode trong Discord → Settings → Advanced → Developer Mode
- Chuột phải voice channel → Copy ID

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

Chỉ `.editsnipe` có alias `.esnipe`. Các command khác gọi bằng tên đầy đủ.

---

## Config — `config.json`

```json
{
  "sessionMaxMinutes": 360,
  "sessionWarnMinutes": 300,
  "sessionAutoStop": true,
  "sessionLogFile": "session.log",

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
| `sessionLogFile` | File ghi log cuối mỗi session |

**Status + commands:**

| Field | Ý nghĩa |
|-------|---------|
| `status.type` | `PLAYING` / `LISTENING` / `WATCHING` / `STREAMING` / `COMPETING` — set 1 lần khi ready |
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

---

## RPC — `rpc.json`

Rich Presence config riêng, đọc 1 lần khi ready.

```json
{
  "enabled": true,
  "applyOnReady": true,
  "status": "online",

  "application_id": "1100000000000000000",
  "application_name": "Visual Studio Code",
  "type": "PLAYING",

  "details": "Editing",
  "details_url": "",
  "state": "index.js",
  "state_url": "",

  "stream_url": "",

  "party_current": 0,
  "party_max": 0,
  "party_id": "",

  "large_image": "",
  "large_text": "",
  "large_url": "",

  "small_image": "",
  "small_text": "",
  "small_url": "",

  "button1_label": "",
  "button1_url": "",
  "button2_label": "",
  "button2_url": "",

  "timestamp_mode": "start",
  "start_timestamp": "now",
  "end_timestamp": 0
}
```

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

**Lưu ý:** URL phải là **direct link** (kết thúc `.png`/`.jpg`/`.webp`).

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

**UDP:** RTP packet qua UDP hole punching.

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
  buttons: [{ label, url }],
  party: { id, size: [current, max] },
  application_id,
  ...
}
```

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

File `session.log` — JSON Lines format. Mỗi session 1 dòng:

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

### `Không có token trong ...tokens.txt`
- Tạo `tokens.txt` ở root project, mỗi dòng 1 token
- Bỏ dòng trống và comment (`#`)

### Voice timeout 30s
- Firewall block UDP → mở port hoặc tắt firewall tạm
- VPN đang bật → tắt
- Thử voice channel khác

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

### Session không tự dừng
- `sessionAutoStop: true` trong config?
- Timer check mỗi 60s — có thể trễ tối đa 1 phút

---

## License

Private use. Not for redistribution.

## Credits

Built by Lumina
