# Lumina Tools

2 tool độc lập cho Discord, dùng chung launcher ở root.

```
┌─────────────────────────────────────────┐
│  [1] Farm Quest   Auto-complete quests  │
│  [2] Selfbot      Voice + music + RPC   │
│  [3] Exit                                │
└─────────────────────────────────────────┘
```

---

## ⚠️ Cảnh báo

Cả 2 tool đều là **selfbot** — dùng user token, vi phạm Discord Terms of Service.
- Tài khoản có thể bị ban tạm thời hoặc vĩnh viễn
- Chỉ dùng với tài khoản phụ hoặc tài khoản chấp nhận rủi ro
- Không share token, không commit lên git, không paste công khai

---

## Yêu cầu

- **Node.js >= 20**
- **Windows / Linux / macOS**
- Discord user token
- (Tùy chọn) Proxy cho Quest tool
- (Tùy chọn) Discord Developer Application — cho RPC assets

---

## Cài đặt

### Cài tất cả

```bash
cd "Selt Bot Discord"
npm run install:all
```

Lệnh này sẽ chạy:
1. `npm install` — root (không deps, chỉ tạo lock)
2. `npm install` — `Auto Quest Completer Discord/`
3. `npm install` — `Self Bot/`

### Cài lẻ từng tool

```bash
npm run install:quest    # chỉ cài deps cho Quest
npm run install:selfbot  # chỉ cài deps cho Selfbot
```

---

## Cấu trúc thư mục

```
Selt Bot Discord/
├── index.js                    Launcher menu [1] [2] [3]
├── package.json                Script root
├── tokens.txt                  Token (dùng chung 2 tool)
├── proxies.txt                 Proxy (chỉ Quest dùng)
├── .gitignore
├── README.md                   ← file này
│
├── Auto Quest Completer Discord/
│   ├── config.json
│   ├── .state.json             State (auto-gen)
│   ├── assets/logo.txt         Custom logo (tùy chọn)
│   ├── src/
│   ├── package.json
│   └── README.md               Hướng dẫn chi tiết Quest
│
└── Self Bot/
    ├── config.json
    ├── rpc.json                Rich Presence config
    ├── channel.txt             Whitelist channel IDs
    ├── session.log             Session log (auto-gen)
    ├── bin/yt-dlp.exe          Binary extract audio
    ├── src/
    ├── package.json
    └── README.md               Hướng dẫn chi tiết Selfbot
```

---

## File chia sẻ

### `tokens.txt`

Cả 2 tool đọc chung. Mỗi dòng 1 token:

```
MTIzNDU2Nzg5.MTk4NzY1NDM.WXYZ...
OTg3NjU0MzIx.MTc2NTQzMjE.ABCD...
```

- Dòng bắt đầu `#` → comment
- Quest: chạy tuần tự **tất cả** token
- Selfbot: chỉ dùng **token đầu tiên**

### `proxies.txt`

Chỉ Quest dùng. Selfbot kết nối direct.

```
US|http://user:pass@1.2.3.4:8080
JP|socks5://user:pass@5.6.7.8:1080
VN|9.10.11.12:3128
```

Format:
- `LABEL|url` — LABEL là mã nước (US, JP, VN...)
- `url` — `protocol://user:pass@host:port`
- Không label → tự detect country
- Không protocol → mặc định `http://`

Để trống → Quest tự tải proxy free (nếu `autoDownloadProxies: true`).

---

## Chạy

### Cách 1 — Launcher (khuyến nghị)

```bash
cd "Selt Bot Discord"
npm start
```

Menu hiện ra:

```
  ╔═══════════════════════════════════════════════╗
  ║         LUMINA TOOLS LAUNCHER                 ║
  ╚═══════════════════════════════════════════════╝

  [1]  Farm Quest    Auto-accept + complete Discord quests

  [2]  Selfbot       Gateway selfbot · voice · music (direct)

  [3]  Exit

  Chọn [1-3]:
```

Chọn `1` hoặc `2` → tool spawn, chiếm màn hình, khi exit → quay về menu.

**Ctrl+C ở menu** → thoát sạch.
**Ctrl+C khi tool đang chạy** → kill cả process tree (Windows: `taskkill /T`, Unix: kill process group).

### Cách 2 — Chạy trực tiếp

```bash
# Quest
npm run quest

# Selfbot
npm run selfbot
```

Hoặc:
```bash
cd "Auto Quest Completer Discord" && npm start
cd "Self Bot" && npm start
```

### Cách 3 — Chạy song song

Mở **2 terminal riêng biệt**:

**Terminal 1:**
```bash
cd "Selt Bot Discord"
npm run quest
```

**Terminal 2:**
```bash
cd "Selt Bot Discord"
npm run selfbot
```

Ổn định hơn launcher vì không share stdin.

---

## Tool 1 — Farm Quest

Auto-accept và auto-complete Discord quests. Multi-token, multi-proxy.

**Đặc điểm:**
- Xoay proxy theo region — thấy quest nhiều nước
- Auto-enroll quest mới
- Complete tất cả task type selfbot làm được
- Anti-detection: jitter mọi request, shuffle proxy, cooldown chặt
- Fallback IP máy khi hết proxy
- Không claim reward (Discord dùng hCaptcha — không bypass)

**Menu:**
```
[1] Scan & complete quests
[2] Exit
```

**Chi tiết:** xem `Auto Quest Completer Discord/README.md`.

---

## Tool 2 — Selfbot

Gateway selfbot với voice + music + Rich Presence.

**Đặc điểm:**
- Session-based — tự dừng sau 2-6h
- Voice join/leave
- Music từ YouTube, SoundCloud, 1000+ site (qua yt-dlp)
- Rich Presence full (assets, buttons, timestamps)
- Chỉ nhận lệnh từ DM self + channel whitelist + console
- Anti-detection: typing delay, rate limit, silent on limit

**Commands:**
```
System:  .cmd  .ping  .uptime  .exit
Voice:   .join  .leave
Music:   .play  .stop  .skip  .resume
```

**Chi tiết:** xem `Self Bot/README.md`.

---

## Bảo mật

### Token

- **Không commit** `tokens.txt` — `.gitignore` đã block
- **Không share** token
- **Không paste** vào chat công khai
- Token bị leak → Discord → User Settings → **Log Out All Known Devices** → reset mật khẩu

### File permissions (Unix)

```bash
chmod 600 "tokens.txt"
chmod 600 "proxies.txt"
chmod 600 "Self Bot/rpc.json"
chmod 600 "Auto Quest Completer Discord/.state.json"
```

Cả 2 tool tự warn nếu phát hiện permission mở.

### `.gitignore` root

Đã block:
- `node_modules/`
- `tokens.txt`, `proxies.txt`
- `*.log`, `session.log`
- `.state.json`
- `.runtime.json`

---

## Troubleshooting

### `npm run install:all` fail
- Check Node.js version: `node --version` (cần >= 20)
- Cài lại từng tool: `npm run install:quest`, `npm run install:selfbot`

### Launcher báo "Chưa cài deps"
- Chạy `npm run install:all` từ root
- Hoặc vào folder tool chạy `npm install`

### Ctrl+C ở launcher không kill được tool con
- Windows: cần PowerShell/cmd as admin để `taskkill /T` work
- Unix: cần `detached: true` khi spawn (đã cấu hình)

### Terminal bị rác sau khi tool exit
- Đã fix trong launcher — clear alt screen buffer
- Nếu vẫn bị → chạy `clear` hoặc `cls` thủ công

### Token invalid cả 2 tool
- Kiểm tra `tokens.txt` format — mỗi dòng 1 token, không space
- Bỏ dòng trống / comment (`#`)

### 2 tool chạy cùng lúc conflict
- Chạy 2 terminal riêng thay vì dùng launcher
- Đảm bảo không share proxy hoặc token giữa 2 tool

---

## Cập nhật

### Update yt-dlp (Selfbot)
```bash
"Self Bot/bin/yt-dlp.exe" -U
```
Chạy định kỳ 1-2 tuần/lần — YouTube thay đổi API liên tục.

### Update dependencies
```bash
npm run install:quest
npm run install:selfbot
```

### Update client version (Quest)
Tự động khi khởi động (nếu `autoUpdateClientVersion: true`).

---

## Cấu trúc file config

| File | Dùng cho | Có trong git? |
|------|----------|:-:|
| `tokens.txt` | Cả 2 | ❌ (gitignore) |
| `proxies.txt` | Quest | ❌ (gitignore) |
| `Auto Quest Completer Discord/config.json` | Quest | ✅ |
| `Auto Quest Completer Discord/.state.json` | Quest | ❌ (auto-gen) |
| `Self Bot/config.json` | Selfbot | ✅ |
| `Self Bot/rpc.json` | Selfbot | ❌ (gitignore) |
| `Self Bot/channel.txt` | Selfbot | ✅ |

---

## License

Private use. Not for redistribution.

## Credits

Built by Lumina for He.