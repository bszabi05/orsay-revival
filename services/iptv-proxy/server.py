import subprocess
import base64
from flask import Flask, request, Response

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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)