import base64
import os
import subprocess
from flask import Blueprint, Response, request

from core.process import (
    get_ffmpeg_binary,
    register_stream,
    unregister_stream,
)

stream_bp = Blueprint('stream', __name__)


@stream_bp.route('/stream.ts')
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

