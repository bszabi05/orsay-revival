# 🚀 IPTV & OrsayCast Media Proxy Server

A lightweight, zero-overhead Python Flask and FFmpeg proxy server designed to bridge modern IPTV streams (HLS, m3u8, TS), web video & music casting with playlist queuing and synchronized lyrics (OrsayCast via yt-dlp & LRCLIB), and media assets with legacy Samsung Orsay Smart TVs and future applications.

---

## 🏗️ Architecture & Modular Structure

The proxy follows a **modular Flask Blueprint** design. Each route domain lives in its own file under `routes/`, while shared system operations, process lifecycle management, state management, and configurations reside under `core/`.

```text
services/iptv-proxy/
├── core/
│   ├── config.py         # Paths, cache directories, port and host configuration
│   ├── process.py        # Subprocess tracking, process group killing, Linux malloc_trim & GC
│   └── cast_manager.py   # OrsayCast playlist queue, state machine, LRCLIB lyrics & yt-dlp extraction
├── routes/
│   ├── __init__.py       # Blueprint registry (register_routes)
│   ├── stream.py         # GET /stream.ts (IPTV FFmpeg MPEG-TS live splicing & low-delay proxy)
│   ├── logo.py           # GET /logo (Two-tier disk caching & 2MB-capped image proxy)
│   ├── health.py         # GET /health (Diagnostic health check & active stream metrics)
│   └── cast.py           # /cast, /queue, /next, /previous, /play, /pause, /status, /cast_stream.ts
├── server.py             # Main entry point & application controller (create_app factory)
└── requirements.txt      # Python dependencies (Flask, yt-dlp)
```

---

## ⚡ Getting Started

### 1. Requirements
- Python 3.8+
- `ffmpeg` installed in system PATH (or `ffmpeg.exe` placed in the `services/iptv-proxy/` folder on Windows)

### 2. Installation
```bash
pip install -r services/iptv-proxy/requirements.txt
```

### 3. Running the Server

#### Development:
From the repository root or the proxy directory:
```bash
python services/iptv-proxy/server.py
```

#### Custom Port and Host (Environment Variables):
```bash
SERVER_HOST=0.0.0.0 SERVER_PORT=7833 python services/iptv-proxy/server.py
```

#### Production (Linux VPS / Systemd / Gunicorn):
```bash
gunicorn -w 4 -b 0.0.0.0:7833 "server:app"
```

---

## 📡 API Endpoints

### 📺 IPTV Endpoints
1. **Live Video Stream (`GET /stream.ts?b64=...`)**:
   - Remuxes input stream into raw MPEG-TS with zero re-encoding.
2. **Channel Logo Proxy & Cache (`GET /logo?b64=...`)**:
   - Disk-backed two-tier caching under `cache/logos/` with 2MB security cap.
3. **Health & Diagnostics (`GET /health`)**:
   - Active streams and system status check.

### 📲 OrsayCast Endpoints (Video & Music Casting, Playlists & Lyrics)
1. **Initiate Cast / Queue (`POST /cast`)**:
   - **Body:**
     ```json
     {
       "url": "https://...",
       "type": "video" | "music",
       "play_now": true | false,
       "title": "Optional"
     }
     ```
   - **Status:** 202 Accepted.
   - **`type: "video"` (default):** Extracts $\le$ 720p H.264 video + AAC audio.
   - **`type: "music"`:** Extracts pure audio-only stream (`bestaudio[ext=m4a]/bestaudio/b`), metadata (artist, title, thumbnail), and fetches synchronized LRC lyrics from the open LRCLIB API.
2. **Playlist Queue Management**:
   - `GET /queue`: Returns full queue list, item IDs, and current index.
   - `POST /queue`: Add an item (`{"url": "...", "title": "...", "type": "video"|"music"}`).
   - `POST /queue/clear` or `DELETE /queue`: Clears the queue.
   - `DELETE /queue/<item_id>`: Removes a specific item by ID.
3. **Track Navigation**:
   - `POST /next` (or `GET /next`): Skips to the next video/song in the queue.
   - `POST /previous` (or `GET /previous`): Returns to previous track (or restarts track 0).
4. **Playback Control**:
   - `POST /play` (or `GET /play`): Sets playback state to `'playing'`.
   - `POST /pause` (or `GET /pause`): Sets playback state to `'paused'`.
   - `POST /playpause` (or `GET /playpause`, `/toggle`): Toggles between play and pause.
5. **Poll Status (`GET /status`)**:
   - **Idle:** Returns HTTP `204 No Content` when idle and queue is empty.
   - **Active:** Returns JSON containing:
     ```json
     {
       "status": "ready",
       "playback_state": "playing",
       "media_type": "music",
       "title": "Bohemian Rhapsody",
       "artist": "Queen",
       "thumbnail": "https://...",
       "lyrics": "[00:00.00] ...",
       "queue_index": 0,
       "queue_count": 3,
       "has_next": true,
       "has_prev": false
     }
     ```
6. **Stop Cast (`POST /stop`, `GET /stop`)**:
   - Terminates running FFmpeg process without erasing the queue.
7. **Casting Video / Audio Stream (`GET /cast_stream.ts`)**:
   - **Video Mode:** Pipes stream through FFmpeg with `-c:v copy -c:a copy -f mpegts`.
   - **Music Mode:** Drops video track with `-vn` (`-i <audio_url> -vn -c:a copy -f mpegts`) for a lightweight, black-screen audio-only MPEG-TS stream.

---

## 🧠 Memory & Process Management Details (512MB RAM VPS Optimization)

Running long-term streaming proxies on resource-constrained servers (like a 512MB RAM cloud VPS or Raspberry Pi) requires aggressive cleanup:
- **No Video Downloads:** yt-dlp only fetches stream URLs (`download=False`).
- **Lazy Extraction:** Only the currently playing item is extracted to conserve CPU and RAM.
- **Pure Remuxing (Zero Transcoding):** Audio-only tracks are remuxed with `-vn -c:a copy` requiring virtually 0% CPU.
- **Process Groups:** On Linux, FFmpeg subprocesses run in dedicated process groups (`start_new_session=True`). Disconnections invoke `os.killpg()` to eliminate orphan threads.
- **stderr to DEVNULL:** Suppressing stderr prevents buffer leaks that trigger OOM crashes.
- **glibc Memory Trimming:** Python invokes `ctypes.CDLL(libc).malloc_trim(0)` on stream termination, forcing the Linux kernel to reclaim free heap memory immediately.
