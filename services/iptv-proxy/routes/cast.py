"""OrsayCast Routes Blueprint.

Provides network endpoints for the mobile casting controller and TV client:
- POST /cast: Receives target media URL (video/music) from mobile and initiates cast or queues it.
- GET /queue: Inspect the full playlist queue.
- POST /queue: Add a video or music track to the playlist queue.
- POST /queue/clear, DELETE /queue: Clear the playlist queue.
- DELETE /queue/<id>: Remove an item from the queue.
- POST, GET /next: Skip to next media item in queue.
- POST, GET /previous: Go back to previous media item in queue.
- POST, GET /play: Resume playback.
- POST, GET /pause: Pause playback.
- POST, GET /playpause: Toggle play/pause.
- GET /status: Polling endpoint for TV and mobile controller (includes lyrics, artist, media_type).
- GET, POST /stop: Terminates current playback.
- GET /cast_stream.ts: Remuxes the extracted stream into MPEG-TS (audio-only -vn for music).
"""
import os
import subprocess
from flask import Blueprint, Response, jsonify, request

from core.cast_manager import cast_manager
from core.process import get_ffmpeg_binary

cast_bp = Blueprint('cast', __name__)


@cast_bp.route('/cast', methods=['POST'])
def cast():
    """Start extraction and prepare cast for the given URL.

    JSON payload:
    {
        "url": "https://...",
        "type": "video" | "music",   (default: "video")
        "title": "Optional title",
        "play_now": true | false     (default: true)
    }
    """
    payload = request.get_json(silent=True) or {}
    url = payload.get('url')
    if not url or not isinstance(url, str):
        return jsonify({"error": "Missing or invalid 'url' in JSON body"}), 400

    url = url.strip()
    if not url:
        return jsonify({"error": "Empty 'url' provided"}), 400

    # Read media type ('video' default, or 'music')
    media_type = payload.get('type') or payload.get('media_type') or 'video'
    if media_type not in ('video', 'music'):
        media_type = 'video'

    title = payload.get('title')
    mode = payload.get('mode', '')
    play_now = payload.get('play_now', mode != 'queue')

    item = cast_manager.add_to_queue(
        url,
        play_now=bool(play_now),
        title=title,
        media_type=media_type
    )
    msg = "Extraction started" if play_now else "Added to queue"
    return jsonify({
        "message": msg,
        "type": media_type,
        "item": item.to_dict(),
        "queue_index": cast_manager.queue_index,
        "queue_count": len(cast_manager.queue),
    }), 202


@cast_bp.route('/queue', methods=['GET'])
def get_queue():
    """Return the entire playlist queue with items and current index."""
    return jsonify(cast_manager.get_queue_info()), 200


@cast_bp.route('/queue', methods=['POST'])
def add_queue():
    """Explicit endpoint to append an item to the playlist queue."""
    payload = request.get_json(silent=True) or {}
    url = payload.get('url')
    if not url or not isinstance(url, str):
        return jsonify({"error": "Missing or invalid 'url' in JSON body"}), 400

    url = url.strip()
    if not url:
        return jsonify({"error": "Empty 'url' provided"}), 400

    media_type = payload.get('type') or payload.get('media_type') or 'video'
    if media_type not in ('video', 'music'):
        media_type = 'video'

    title = payload.get('title')
    play_now = bool(payload.get('play_now', False))

    item = cast_manager.add_to_queue(
        url,
        play_now=play_now,
        title=title,
        media_type=media_type
    )
    return jsonify({
        "message": "Added to queue",
        "type": media_type,
        "item": item.to_dict(),
        "queue_count": len(cast_manager.queue),
    }), 201


@cast_bp.route('/queue/clear', methods=['POST', 'GET'])
@cast_bp.route('/queue', methods=['DELETE'])
def clear_queue():
    """Clear all items from the playlist queue and stop playback."""
    cast_manager.clear_queue()
    return jsonify({"message": "Queue cleared", "status": "idle"}), 200


@cast_bp.route('/queue/<int:item_id>', methods=['DELETE', 'POST'])
def remove_queue_item(item_id: int):
    """Remove a specific item from the playlist queue by ID."""
    removed = cast_manager.remove_queue_item(item_id)
    if not removed:
        return jsonify({"error": f"Item #{item_id} not found in queue"}), 404
    return jsonify({"message": f"Item #{item_id} removed from queue", "queue_count": len(cast_manager.queue)}), 200


@cast_bp.route('/next', methods=['POST', 'GET'])
def next_item():
    """Advance to the next track in the playlist queue."""
    has_next, next_item = cast_manager.next_track()
    if has_next and next_item:
        return jsonify({
            "message": "Switched to next track",
            "status": cast_manager.status,
            "item": next_item.to_dict(),
            "queue_index": cast_manager.queue_index,
        }), 200
    return jsonify({
        "message": "End of queue reached",
        "status": "idle",
        "queue_index": cast_manager.queue_index,
    }), 200


@cast_bp.route('/previous', methods=['POST', 'GET'])
def previous_item():
    """Go back to the previous track or restart current track."""
    has_prev, prev_item = cast_manager.previous_track()
    if has_prev and prev_item:
        return jsonify({
            "message": "Switched to previous track",
            "status": cast_manager.status,
            "item": prev_item.to_dict(),
            "queue_index": cast_manager.queue_index,
        }), 200
    return jsonify({
        "message": "Already at the start of queue",
        "status": cast_manager.status,
        "queue_index": cast_manager.queue_index,
    }), 200


@cast_bp.route('/play', methods=['POST', 'GET'])
def play():
    """Resume playback."""
    cast_manager.play()
    return jsonify({
        "message": "Playback set to play",
        "playback_state": "playing",
        "status": cast_manager.status,
    }), 200


@cast_bp.route('/pause', methods=['POST', 'GET'])
def pause():
    """Pause playback."""
    cast_manager.pause()
    return jsonify({
        "message": "Playback paused",
        "playback_state": "paused",
        "status": cast_manager.status,
    }), 200


@cast_bp.route('/playpause', methods=['POST', 'GET'])
@cast_bp.route('/toggle', methods=['POST', 'GET'])
def toggle_playpause():
    """Toggle between play and pause."""
    new_state = cast_manager.toggle_play_pause()
    return jsonify({
        "message": f"Playback toggled to {new_state}",
        "playback_state": new_state,
        "status": cast_manager.status,
    }), 200


@cast_bp.route('/status', methods=['GET'])
def status():
    """Return the current casting state for TV/controller polling.

    Returns HTTP 204 No Content when status is 'idle' and queue is empty.
    Returns JSON state when active or queue is populated.
    """
    state = cast_manager.get_status()
    if state.get("status") == "idle" and state.get("queue_count", 0) == 0:
        return ("", 204)
    return jsonify(state), 200


@cast_bp.route('/stop', methods=['GET', 'POST'])
def stop():
    """Stop current streaming playback without clearing the queue."""
    cast_manager.stop_cast()
    return jsonify({"message": "Cast stopped", "status": "idle"}), 200


@cast_bp.route('/cast_stream.ts', methods=['GET'])
def cast_stream():
    """Remux the extracted stream URL(s) directly into MPEG-TS for the Orsay TV player."""
    inputs = cast_manager.get_stream_inputs()
    if not inputs or not cast_manager.is_ready_or_playing():
        return "No stream ready to cast", 400

    media_type = cast_manager.get_media_type()
    print(f"[OrsayCast] Remuxing stream (type={media_type}, inputs={len(inputs)}): {inputs[0]}")

    ffmpeg_cmd = [
        get_ffmpeg_binary(),
        '-hide_banner',
        '-loglevel', 'error',
    ]

    # Supports single pre-muxed/audio-only streams or dual DASH streams
    for inp in inputs:
        ffmpeg_cmd.extend(['-i', inp])

    if media_type == 'music':
        # Music mode: Drop video with -vn for a lightweight, black-screen audio-only MPEG-TS stream
        ffmpeg_cmd.extend([
            '-vn',
            '-c:a', 'copy',
            '-f', 'mpegts',
            '-flush_packets', '1',
            'pipe:1'
        ])
    else:
        # Video mode: Remux video and audio tracks
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
        cast_manager.stop_active_stream()

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
