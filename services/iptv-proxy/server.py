import subprocess
import base64
from flask import Flask, request, Response
import urllib.request

app = Flask(__name__)

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
        'ffmpeg.exe',
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
        process = subprocess.Popen(ffmpeg_cmd, stdout=subprocess.PIPE)
        try:
            while True:
                data = process.stdout.read(8192)
                if not data:
                    break
                yield data
        finally:
            process.terminate()

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

        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            image_data = response.read()
            content_type = response.headers.get('Content-Type', 'image/jpeg')

            proxy_response = Response(image_data, mimetype=content_type)
            proxy_response.headers['Cache-Control'] = 'public, max-age=86400' 
            return proxy_response

    except Exception as e:
        print(f"Hiba a logó letöltésekor: {e}")
        transparent_pixel = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
        return Response(transparent_pixel, mimetype='image/gif')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)