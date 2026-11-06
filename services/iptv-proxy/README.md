# 🚀 IPTV & OrsayCast Media Proxy Server

A lightweight, zero-overhead Python Flask and FFmpeg proxy server designed to bridge modern IPTV streams (HLS, m3u8, TS), web video casting (OrsayCast via yt-dlp), and media assets with legacy Samsung Orsay Smart TVs and future applications.

---

## 🏗️ Architecture & Modular Structure

The proxy follows a **modular Flask Blueprint** design. Each route domain lives in its own file under `routes/`, while shared system operations, process lifecycle management, state management, and configurations reside under `core/`.

```text
services/iptv-proxy/
├── core/
│   ├── config.py         # Paths, cache directories, port and host configuration
│   ├── process.py        # Subprocess tracking, process group killing, Linux malloc_trim & GC
│   └── cast_manager.py   # OrsayCast single-stream state machine, threading locks & yt-dlp extraction
├── routes/
│   ├── __init__.py       # Blueprint registry (register_routes)
│   ├── stream.py         # GET /stream.ts (IPTV FFmpeg MPEG-TS live splicing & low-delay proxy)
│   ├── logo.py           # GET /logo (Two-tier disk caching & 2MB-capped image proxy)
│   ├── health.py         # GET /health (Diagnostic health check & active stream metrics)
│   └── cast.py           # POST /cast, GET /status, POST /stop, GET /cast_stream.ts (OrsayCast)
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

### 📲 OrsayCast Endpoints (Phase 1)
1. **Initiate Cast (`POST /cast`)**:
   - **Body:** `{"url": "https://..."}`
   - **Status:** 202 Accepted `{"message": "Extraction started"}`
   - Resets any previous stream, updates state to `'extracting'`, and launches a background thread to extract stream metadata with `yt-dlp` (strictly `download=False`, pre-muxed $\le$ 720p).
2. **Poll Status (`GET /status`)**:
   - **Idle:** Returns HTTP `204 No Content`.
   - **Active:** Returns JSON with current state (e.g. `{"status": "ready", "original_url": "..."}`).
3. **Stop Cast (`POST /stop`)**:
   - Terminates running FFmpeg processes, clears state, resets to `'idle'`, and triggers glibc heap trim.
4. **Casting Video Stream (`GET /cast_stream.ts`)**:
   - Pipes the extracted direct URL through FFmpeg into raw MPEG-TS with unbuffered `read1(65536)` streaming.

---

## 🧠 Memory & Process Management Details (512MB RAM VPS Optimization)

Running long-term streaming proxies on resource-constrained servers (like a 512MB RAM cloud VPS or Raspberry Pi) requires aggressive cleanup:
- **No Video Downloads:** yt-dlp only fetches stream URLs (`download=False`).
- **Process Groups:** On Linux, FFmpeg subprocesses run in dedicated process groups (`start_new_session=True`). Disconnections invoke `os.killpg()` to eliminate orphan threads.
- **stderr to DEVNULL:** Suppressing stderr prevents buffer leaks that trigger OOM crashes.
- **glibc Memory Trimming:** Python invokes `ctypes.CDLL(libc).malloc_trim(0)` on stream termination, forcing the Linux kernel to reclaim free heap memory immediately.
