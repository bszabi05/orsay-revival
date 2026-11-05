# 🚀 IPTV & Media Proxy Server

A lightweight, zero-overhead Python Flask and FFmpeg proxy server designed to bridge modern IPTV streams (HLS, m3u8, TS) and media assets with legacy Samsung Orsay Smart TVs and future applications.

---

## 🏗️ Architecture & Modular Structure

The proxy follows a **modular Flask Blueprint** design. Each route domain lives in its own file under `routes/`, while shared system operations, process lifecycle management, and configurations reside under `core/`.

```text
services/iptv-proxy/
├── core/
│   ├── config.py         # Paths, cache directories, port and host configuration
│   └── process.py        # Subprocess tracking, process group killing, Linux malloc_trim & GC
├── routes/
│   ├── __init__.py       # Blueprint registry (register_routes)
│   ├── stream.py         # GET /stream.ts (FFmpeg MPEG-TS live splicing & low-delay proxy)
│   ├── logo.py           # GET /logo (Two-tier disk caching & 2MB-capped image proxy)
│   └── health.py         # GET /health (Diagnostic health check & active stream metrics)
├── server.py             # Main entry point & application controller (create_app factory)
└── requirements.txt      # Python dependencies (Flask)
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

### 1. Live Video Stream (`GET /stream.ts?b64=...`)
- **Query Parameter:** `b64` (Base64-encoded stream URL, e.g. HLS `.m3u8` or raw stream).
- **MIME Type:** `video/MP2T`
- **Features:**
  - FFmpeg remuxing directly to raw MPEG-TS with zero re-encoding CPU overhead (`-c:v copy -c:a copy`).
  - Low-latency probing (`-probesize 1MB`, `-analyzeduration 1.5s`, `-fflags +nobuffer+flush_packets+fastseek`).
  - `read1(65536)` unbuffered packet flushing so the TV starts playing instantly without waiting for a full 64KB buffer.
  - Automatic stream termination and memory cleanup via `Response.call_on_close()` and generator teardown.

### 2. Channel Logo Proxy & Cache (`GET /logo?b64=...`)
- **Query Parameter:** `b64` (Base64-encoded original image URL).
- **Features:**
  - Disk-backed two-tier caching under `cache/logos/` (`.img` and `.meta` files).
  - Subsequent requests return `X-Cache: HIT` with `Cache-Control: public, max-age=604800` (7 days).
  - 2MB download limit guard against malicious or oversized assets.
  - Fallback to a transparent 1×1 GIF if the remote source fails or times out.

### 3. Health & Diagnostics (`GET /health`)
- **Returns:** JSON object containing:
  ```json
  {
    "status": "ok",
    "active_stream_count": 0,
    "active_pids": [],
    "python_version": "3.13.5 ..."
  }
  ```

---

## 🔌 How to Add New Routes for Future Applications

To add endpoints for a new application or feature:

1. Create a new file in `routes/`, e.g. `routes/my_feature.py`:
   ```python
   from flask import Blueprint, jsonify

   my_feature_bp = Blueprint('my_feature', __name__)

   @my_feature_bp.route('/my-endpoint')
   def my_endpoint():
       return jsonify({"message": "Hello from new app!"})
   ```

2. Register the blueprint in `routes/__init__.py`:
   ```python
   from .my_feature import my_feature_bp

   ALL_BLUEPRINTS = [
       stream_bp,
       logo_bp,
       health_bp,
       my_feature_bp,  # <-- Added here
   ]
   ```

3. The main `server.py` will automatically register the new routes upon startup without modifying core server logic.

---

## 🧠 Memory & Process Management Details

Running long-term streaming proxies on resource-constrained servers (like a 512MB RAM cloud VPS or Raspberry Pi) requires aggressive cleanup:
- **Process Groups:** On Linux, FFmpeg subprocesses run in dedicated process groups (`start_new_session=True`). When a viewer disconnects, `os.killpg(os.getpgid(proc.pid), SIGTERM)` tears down all underlying FFmpeg threads, avoiding zombie processes.
- **glibc Memory Trimming:** Python does not automatically return freed heap memory to the Linux kernel. `core/process.py` invokes `ctypes.CDLL(libc).malloc_trim(0)` on connection close, ensuring memory drops back to baseline after streaming sessions.

