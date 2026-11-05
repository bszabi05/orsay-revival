import subprocess
import base64
import hashlib
import os
import shutil
import signal
import gc
import ctypes
import ctypes.util
import threading
from pathlib import Path
from flask import Flask, request, Response
import urllib.request

app = Flask(__name__)

CACHE_DIR = Path(__file__).resolve().parent / "cache" / "logos"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Process tracking per connection
streams_lock = threading.Lock()
active_streams = set()


def release_os_memory():
    """Trigger Python GC and force glibc malloc_trim to return free memory to the Linux kernel."""
    gc.collect()
    try:
        libc_name = ctypes.util.find_library('c')
        if libc_name:
            libc = ctypes.CDLL(libc_name)
            if hasattr(libc, 'malloc_trim'):
                libc.malloc_trim(0)
    except Exception:
        pass


def kill_process(proc):
    """Safely, completely, and aggressively terminate a subprocess and its process group."""
    if proc is None:
        return
    try:
        if proc.poll() is None:
            # On Linux/macOS, kill the entire process group to eliminate any child threads
            if os.name != 'nt' and hasattr(os, 'killpg') and hasattr(os, 'getpgid'):
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except Exception:
                    proc.terminate()
            else:
                proc.terminate()

            # Wait up to 1.5 seconds for graceful exit
            try:
                proc.wait(timeout=1.5)
            except subprocess.TimeoutExpired:
                # Force kill if not exited gracefully
                if os.name != 'nt' and hasattr(os, 'killpg') and hasattr(os, 'getpgid'):
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    except Exception:
                        proc.kill()
                else:
                    proc.kill()
                try:
                    proc.wait(timeout=1.0)
                except Exception:
                    pass
    except Exception as e:
        print(f"Error terminating process {getattr(proc, 'pid', 'unknown')}: {e}")
    finally:
        if proc.stdout:
            try:
                proc.stdout.close()
            except Exception:
                pass
        release_os_memory()


def register_stream(proc):
    with streams_lock:
        # Reap any already dead processes to prevent lingering references
        dead = [p for p in active_streams if p.poll() is not None]
        for p in dead:
            active_streams.discard(p)
            try:
                if p.stdout:
                    p.stdout.close()
            except Exception:
                pass
        active_streams.add(proc)


def unregister_stream(proc):
    with streams_lock:
        active_streams.discard(proc)
    kill_process(proc)


def get_ffmpeg_binary():
    """Detect ffmpeg binary across Linux/macOS and Windows environments."""
    local_exe = Path(__file__).resolve().parent / "ffmpeg.exe"
    if os.name == "nt" and local_exe.is_file():
        return str(local_exe)
    return shutil.which("ffmpeg") or "ffmpeg"


@app.route('/stream.ts')
def stream():
    b64_url = request.args.get('b64')
    if not b64_url:
        return "Missing URL", 400

    try:
        url = base64.b64decode(b64_url).decode('utf-8')
    except Exception:
        return "Invalid Base64", 400

    print(f"Splicing and proxying: {url}")

    ffmpeg_cmd = [
        get_ffmpeg_binary(),
        '-hide_banner',
        '-loglevel', 'error',
        '-rw_timeout', '15000000',
        '-timeout', '15000000',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '4',
        '-reconnect_on_http_error', '4xx,5xx',
        '-probesize', '1048576',
        '-analyzeduration', '1500000',
        '-fflags', '+nobuffer+flush_packets+fastseek',
        '-flags', 'low_delay',
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-i', url,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-map', '0:v:0?',
        '-map', '0:a?',
        '-avoid_negative_ts', 'make_zero',
        '-f', 'mpegts',
        '-flush_packets', '1',
        '-max_delay', '500000',
        '-mpegts_flags', '+resend_headers+initial_discontinuity',
        'pipe:1'
    ]

    popen_kwargs = {
        'stdout': subprocess.PIPE,
        'stderr': subprocess.DEVNULL
    }
    # On Linux, create a dedicated process group so all child threads can be killed together
    if os.name != 'nt':
        popen_kwargs['start_new_session'] = True

    proc = subprocess.Popen(ffmpeg_cmd, **popen_kwargs)
    register_stream(proc)

    cleaned_up = [False]

    def cleanup():
        if cleaned_up[0]:
            return
        cleaned_up[0] = True
        unregister_stream(proc)

    def generate():
        # Use read1 to return immediately when the first packet headers arrive,
        # rather than waiting to accumulate a full 64KB before sending to the client!
        read_chunk = getattr(proc.stdout, 'read1', proc.stdout.read)
        try:
            while True:
                data = read_chunk(65536)
                if not data:
                    break
                yield data
        except GeneratorExit:
            # Client closed the connection
            pass
        finally:
            cleanup()

    response = Response(generate(), mimetype='video/MP2T')
    # call_on_close guarantees cleanup even if the generator is terminated abruptly by the WSGI server
    response.call_on_close(cleanup)
    response.headers['Content-Disposition'] = 'inline; filename="stream.ts"'
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.headers['X-Accel-Buffering'] = 'no'
    response.headers['Accept-Ranges'] = 'none'

    return response


@app.route('/logo')
def proxy_logo():
    b64_url = request.args.get('b64')
    if not b64_url:
        return "Missing URL", 400

    try:
        url = base64.b64decode(b64_url).decode('utf-8')
    except Exception:
        return "Invalid Base64", 400

    cache_key = hashlib.sha256(url.encode('utf-8')).hexdigest()
    img_path = CACHE_DIR / f"{cache_key}.img"
    meta_path = CACHE_DIR / f"{cache_key}.meta"

    # Serve from disk cache if already cached
    if img_path.is_file() and meta_path.is_file():
        try:
            with open(img_path, 'rb') as f:
                image_data = f.read()
            with open(meta_path, 'r', encoding='utf-8') as f:
                content_type = f.read().strip() or 'image/jpeg'

            cached_response = Response(image_data, mimetype=content_type)
            cached_response.headers['Cache-Control'] = 'public, max-age=604800'
            cached_response.headers['X-Cache'] = 'HIT'
            return cached_response
        except Exception as cache_read_err:
            print(f"Cache read error for {url}: {cache_read_err}")

    # Fetch from remote source with strict limits
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            # Guard against huge downloads (max 2 MB for a logo)
            content_length = response.headers.get('Content-Length')
            if content_length and int(content_length) > 2 * 1024 * 1024:
                raise ValueError("Logo exceeds maximum allowed size (2MB)")

            image_data = response.read(2 * 1024 * 1024 + 1)
            if len(image_data) > 2 * 1024 * 1024:
                raise ValueError("Logo data exceeds 2MB limit")

            raw_ct = response.headers.get('Content-Type', 'image/jpeg').split(';')[0].strip()
            content_type = raw_ct if raw_ct.startswith('image/') else 'image/jpeg'

            # Save to disk cache
            try:
                with open(img_path, 'wb') as f:
                    f.write(image_data)
                with open(meta_path, 'w', encoding='utf-8') as f:
                    f.write(content_type)
            except Exception as write_err:
                print(f"Cache write error for {url}: {write_err}")

            proxy_response = Response(image_data, mimetype=content_type)
            proxy_response.headers['Cache-Control'] = 'public, max-age=604800'
            proxy_response.headers['X-Cache'] = 'MISS'
            return proxy_response

    except Exception as e:
        print(f"Error fetching logo ({url}): {e}")
        transparent_pixel = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
        fail_response = Response(transparent_pixel, mimetype='image/gif')
        fail_response.headers['Cache-Control'] = 'public, max-age=300'
        return fail_response


@app.route('/health')
def health():
    """Diagnostic health check returning active process count and status."""
    import sys
    with streams_lock:
        active_pids = [p.pid for p in active_streams if p.poll() is None]
    return {
        "status": "ok",
        "active_stream_count": len(active_pids),
        "active_pids": active_pids,
        "python_version": sys.version
    }


if __name__ == '__main__':
    port = int(os.environ.get("SERVER_PORT", 7833))
    app.run(host='0.0.0.0', port=port)
