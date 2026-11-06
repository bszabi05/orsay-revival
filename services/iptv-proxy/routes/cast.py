"""OrsayCast Routes Blueprint.

Provides network endpoints for the mobile casting controller and TV client:
- POST /cast: Receives target video URL from mobile and initiates background extraction.
- GET /status: Polling endpoint for the TV (returns 204 when idle, state JSON otherwise).
- GET/POST /stop: Terminates casting session and releases memory.
- GET /cast_stream.ts: Remuxes the extracted video into raw MPEG-TS for Orsay OS.
"""
import os
import subprocess
from flask import Blueprint, Response, jsonify, request

from core.cast_manager import cast_manager
from core.process import get_ffmpeg_binary

cast_bp = Blueprint('cast', __name__)


@cast_bp.route('/cast', methods=['POST'])
def cast():
    """Start video extraction and prepare cast for the given URL."""
    payload = request.get_json(silent=True) or {}
    url = payload.get('url')
    if not url or not isinstance(url, str):
        return jsonify({"error": "Missing or invalid 'url' in JSON body"}), 400

    url = url.strip()
    if not url:
        return jsonify({"error": "Empty 'url' provided"}), 400

    cast_manager.start_cast(url)
    return jsonify({"message": "Extraction started"}), 202


@cast_bp.route('/status', methods=['GET'])
def status():
    """Return the current casting state for TV/controller polling.

    Returns HTTP 204 No Content when status is 'idle'.
    Returns JSON state when 'extracting', 'ready', 'playing', or 'error'.
    """
    state = cast_manager.get_status()
    if state.get("status") == "idle":
        return ("", 204)
    return jsonify(state), 200


@cast_bp.route('/stop', methods=['GET', 'POST'])
def stop():
    """Stop casting, kill FFmpeg subprocess, and reset state to 'idle'."""
    cast_manager.stop_cast()
    return jsonify({"message": "Cast stopped", "status": "idle"}), 200


@cast_bp.route('/cast_stream.ts', methods=['GET'])
def cast_stream():
    """Remux the extracted stream URL(s) directly into MPEG-TS for the Orsay TV player."""
    inputs = cast_manager.get_stream_inputs()
    if not inputs or not cast_manager.is_ready_or_playing():
        return "No stream ready to cast", 400

    print(f"[OrsayCast] Remuxing stream (inputs={len(inputs)}): {inputs[0]}")

    ffmpeg_cmd = [
        get_ffmpeg_binary(),
        '-hide_banner',
        '-loglevel', 'error',
    ]

    # Supports both single pre-muxed streams and dual DASH streams (video + audio)
    for inp in inputs:
        ffmpeg_cmd.extend(['-i', inp])

    ffmpeg_cmd.extend([
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-f', 'mpegts',
        '-flush_packets', '1',
        'pipe:1'
    ])

    popen_kwargs = {
        'stdout': subprocess.PIPE,
        'stderr': subprocess.DEVNULL  # Critical: Prevents OOM memory leak from pipe buffers
    }
    if os.name != 'nt':
        popen_kwargs['start_new_session'] = True

    proc = subprocess.Popen(ffmpeg_cmd, **popen_kwargs)
    cast_manager.set_active_process(proc)

    cleaned_up = [False]

    def cleanup():
        if cleaned_up[0]:
            return
        cleaned_up[0] = True
        cast_manager.stop_cast()

    def generate():
        read_chunk = getattr(proc.stdout, 'read1', proc.stdout.read)
        try:
            while True:
                data = read_chunk(65536)
                if not data:
                    break
                yield data
        except GeneratorExit:
            pass
        finally:
            cleanup()

    response = Response(generate(), mimetype='video/MP2T', direct_passthrough=True)
    response.call_on_close(cleanup)
    response.headers['Content-Disposition'] = 'inline; filename="cast_stream.ts"'
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.headers['X-Accel-Buffering'] = 'no'
    response.headers['Accept-Ranges'] = 'none'

    return response
