import subprocess
import base64
import hashlib
import os
import shutil
from pathlib import Path
from flask import Flask, request, Response
import urllib.request

app = Flask(__name__)

CACHE_DIR = Path(__file__).resolve().parent / "cache" / "logos"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


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
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-i', url,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-f', 'mpegts',
        '-flush_packets', '1',
        '-mpegts_flags', 'resend_headers',
        'pipe:1'
    ]

    def generate():

        process = subprocess.Popen(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            while True:

                data = process.stdout.read(65536)
                if not data:
                    break
                yield data
        finally:
            process.terminate()
            process.wait()

    response = Response(generate(), mimetype='video/MP2T', direct_passthrough=True)
    response.headers['Content-Disposition'] = 'inline; filename="stream.ts"'
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.headers['X-Accel-Buffering'] = 'no'

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

    # Fetch from remote source
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            image_data = response.read()
            content_type = response.headers.get('Content-Type', 'image/jpeg').split(';')[0].strip()

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

if __name__ == '__main__':
    port = int(os.environ.get("SERVER_PORT", 7833))
    app.run(host='0.0.0.0', port=port)
