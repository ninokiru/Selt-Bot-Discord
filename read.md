# Lumina Selfbot

Gateway selfbot cho Discord — voice · music · RPC · session-based.

Chạy song song với `Auto Quest Completer Discord` hoặc độc lập. Dùng chung `tokens.txt` ở root.

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

### Cách 1 — qua launcher root (khuyến nghị)

```bash
cd "Selt Bot Discord"
npm run install:all
npm start
# → chọn [2] Selfbot
```

### Cách 2 — chạy trực tiếp

```bash
cd "Selt Bot Discord/Self Bot"
npm install
npm start
```

### Bước 1 — Chuẩn bị yt-dlp

Tải `yt-dlp.exe` (Windows) hoặc `yt-dlp` (Unix):

```
https://github.com/yt-dlp/yt-dlp/releases/latest
```

Đặt vào `Self Bot/bin/`:

```
Self Bot/
└── bin/
    └── yt-dlp.exe      ← Windows
    └── yt-dlp          ← Linux/Mac
```

Verify:
```bash
bin/yt-dlp.exe --version
# Phải in version, ví dụ: 2024.11.04
```

yt-dlp tự update khi cần — chạy `bin/yt-dlp.exe -U` định kỳ.

### Bước 2 — Token

Token nằm ở root `Selt Bot Discord/tokens.txt`:

```
MTIzNDU2Nzg5.MTk4NzY1NDM.WXYZ...
```

Selfbot đọc **token đầu tiên** trong file.

### Bước 3 — Config

Xem section **Config** bên dưới.

### Bước 4 — Chạy

```bash
npm start
```

Selfbot khởi động, dashboard hiện ra.

---

## Cấu trúc thư mục

```
Self Bot/
├── bin/
│   └── yt-dlp.exe              Binary extract audio (17-30MB)
│
├── src/
│   ├── index.js                Entry point — load config, login, orchestrate
│   ├── client.js               Gateway wrapper (discord.js-selfbot-v13)
│   ├── dashboard.js            TUI — 3 panel (Session / Stats / Commands)
│   ├── logger.js               Log với ANSI levels
│   ├── shutdown.js             Global shutdown flag
│   ├── session.js              Session timer + log end
│   ├── stats.js                Counter runtime (messages, cmds, voice...)
│   ├── voiceSession.js         Join/leave voice channel
│   ├── music.js                Music queue + spawn yt-dlp + ffmpeg
│   ├── rpc.js                  Rich Presence — đọc từ rpc.json
│   ├── utils.js                Helpers (sleep, randInt, readJson...)
│   └── commands/
│       ├── index.js            Registry + dispatcher + console + rate limit
│       ├── cmd.js              .cmd — list commands
│       ├── join.js             .join — vào voice channel
│       ├── leave.js            .leave — rời voice channel
│       ├── ping.js             .ping — gateway latency
│       ├── uptime.js           .uptime — session uptime
│       ├── exit.js             .exit — dừng selfbot (hidden)
│       └── music/
│           ├── play.js         .play — phát nhạc
│           ├── skip.js         .skip — bỏ qua bài
│           ├── resume.js       .resume — tiếp tục/tạm dừng (toggle)
│           ├── stop.js         .stop — dừng + xóa queue
│           ├── queue.js        .queue (hidden)
│           └── volume.js       .volume (hidden)
│
├── config.json                 Config chính (session, music, voice, commands)
├── rpc.json                    Rich Presence config riêng
├── channel.txt                 Whitelist channel IDs
├── session.log                 Log JSON mỗi session (auto-gen)
├── package.json
├── .gitignore
└── README.md
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
| `.join` | `.join <guild_id> <voice_channel_id>` | Vào voice channel |
| `.leave` | `.leave` | Rời voice channel hiện tại |

**Lấy guild_id + channel_id:**
- Bật Developer Mode trong Discord → Settings → Advanced → Developer Mode
- Chuột phải guild → Copy ID
- Chuột phải voice channel → Copy ID

### Music

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.play` | `.play <link YouTube>` | Phát nhạc — hỗ trợ YouTube, SoundCloud, 1000+ site |
| `.stop` | `.stop` | Dừng nhạc + xóa toàn bộ queue |
| `.skip` | `.skip` | Bỏ qua bài đang phát |
| `.resume` | `.resume` | Toggle pause/resume |
| `.queue` | `.queue` | Xem queue (hidden) |
| `.volume` | `.volume <0-100>` | Set âm lượng (hidden) |

**Nguồn nhạc hỗ trợ (từ yt-dlp):**
- YouTube + YouTube Music
- SoundCloud
- Bandcamp
- Twitch (VOD, live không)
- Vimeo
- Dailymotion
- Mixcloud
- 1000+ site khác

**Spotify không hỗ trợ stream trực tiếp** — yt-dlp không extract được vì DRM. Nếu cần, phải dùng Spotify API lấy metadata → search YouTube.

### Aliases

Aliases mặc định đã bỏ. Mỗi command chỉ gọi bằng tên đầy đủ.

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

  "voice": {
    "autoReconnect": true,
    "reconnectMaxAttempts": 3,
    "selfDeaf": true,
    "selfMute": false
  },

  "music": {
    "ytDlpPath": "bin/yt-dlp.exe",
    "maxQueueSize": 30,
    "defaultVolume": 50,
    "maxDurationSec": 1800,
    "searchLimit": 1,
    "audioFormat": "bestaudio"
  },

  "antiDetection": {
    "typingDelayMinMs": 300,
    "typingDelayMaxMs": 1500,
    "reactDelayMinMs": 200,
    "reactDelayMaxMs": 800
  },

  "debug": false
}
```

### Field reference

| Field | Ý nghĩa |
|-------|---------|
| `sessionMaxMinutes` | Thời gian session tối đa (phút) — tự dừng khi hết |
| `sessionWarnMinutes` | Cảnh báo khi đạt (phút) |
| `sessionAutoStop` | `true` → tự dừng khi hết session |
| `sessionLogFile` | File ghi log cuối mỗi session |
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
| `voice.autoReconnect` | Tự reconnect khi mất kết nối voice |
| `voice.selfDeaf` | Tự deaf khi vào voice |
| `voice.selfMute` | Tự mute khi vào voice |
| `music.ytDlpPath` | Path đến yt-dlp binary |
| `music.maxQueueSize` | Số bài tối đa trong queue |
| `music.defaultVolume` | Âm lượng mặc định 0-100 |
| `music.maxDurationSec` | Thời lượng bài tối đa (giây) |
| `music.searchLimit` | Số kết quả search (dùng cho `.play <query>`) |
| `music.audioFormat` | Format yt-dlp dùng (bestaudio/best) |
| `antiDetection.typingDelayMinMs` | Delay tối thiểu trước khi reply (ms) |
| `antiDetection.typingDelayMaxMs` | Delay tối đa trước khi reply (ms) |
| `debug` | `true` → in log debug |

---

## RPC — `rpc.json`

Rich Presence config riêng. Không cần restart selfbot nếu dùng `.reload` (chưa có).

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
chmod 600 "Selt Bot Discord/tokens.txt"
chmod 600 "Self Bot/rpc.json"
chmod 600 "Self Bot/session.log"
```

### Anti-detection

| Cơ chế | Chi tiết |
|--------|----------|
| **Chặn author** | Chỉ nhận lệnh từ chính selfbot user — `msg.author.id === client.user.id` |
| **Whitelist channel** | Chỉ DM self + channel có ID trong `channel.txt` |
| **Typing delay** | 300-1500ms trước khi gửi reply |
| **React delay** | 200-800ms sau khi nhận lệnh |
| **Rate limit window** | 10 lệnh / 60s |
| **Cooldown** | 1.5s giữa các lệnh |
| **Duplicate filter** | Bỏ qua lệnh trùng trong 3s |
| **Silent on limit** | Không reply khi bị limit — tránh pattern |
| **Session cap** | Tự dừng sau 2-6h |

### Khi nào có thể bị flag

- Gửi nhiều lệnh liên tục (vượt rate limit)
- Mass DM / auto-reply
- Join/leave voice liên tục
- Spam play/skip
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
- `messageCreate` — filter + dispatch command
- `error`, `warn` — log
- `rateLimited` — log + backoff
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

### yt-dlp

Binary external, spawn qua `child_process.spawn()`.

**Metadata mode:**
```bash
yt-dlp -j --no-playlist --no-warnings -f bestaudio "ytsearch1:query"
```
→ JSON metadata.

**Stream mode:**
```bash
yt-dlp -f bestaudio -o - --no-playlist --no-warnings "url"
```
→ PCM/Opus audio qua stdout → pipe vào `@discordjs/voice`.

### ffmpeg (qua `ffmpeg-static`)

`@discordjs/voice` dùng ffmpeg để transcode audio từ yt-dlp output sang Opus.

Path auto-set từ `ffmpeg-static` package:
```js
process.env.FFMPEG_PATH = ffmpegStatic;
```

### Discord Rich Presence (gateway)

Gửi qua `client.user.setPresence()`:
```js
client.user.setPresence({
  activities: [activityObject],
  status: 'online',
});
```

Activity object theo docs `docs.discord.food`:
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
- `silentOnLimit: true` → không reply khi bị block (không có dấu hiệu)

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
type "Self Bot/session.log"
# hoặc
tail -f "Self Bot/session.log"   # Unix
```

---

## Troubleshooting

### `Cannot find module 'ffmpeg-static'`
```bash
cd "Self Bot"
npm install ffmpeg-static
```

Verify:
```bash
dir node_modules\ffmpeg-static\ffmpeg.exe
```

### `yt-dlp không tồn tại: bin/yt-dlp.exe`
Tải lại binary. Đặt đúng chỗ. Đổi path trong `config.json` → `music.ytDlpPath` nếu để folder khác.

### `.play` không phát nhạc
- Đã `.join` voice chưa?
- Bot có quyền vào voice channel không?
- Kiểm tra log — có `yt-dlp exit ...` không?
- Link YouTube có hợp lệ không?

### Voice timeout 30s
- Firewall block UDP → mở port hoặc tắt firewall tạm
- VPN đang bật → tắt
- Thử voice channel khác

### `.cmd` gửi trong DM không reply
- Token đúng chưa? Login thành công chưa?
- `dmSelfEnabled: true` trong config?
- Debug: bật `debug: true`, chạy lại, xem log có `Recv:` không

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