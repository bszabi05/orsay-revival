"""YouTube Music Search Blueprint for Orsay TV Client.

Provides a lightweight, unauthenticated music search API using ytmusicapi.
The search results are strictly filtered ('filter=songs') and aggressively pruned
to a minimal memory-friendly JSON payload for 2015 Samsung Smart TVs and 512MB RAM VPS.
"""
import threading
from typing import Any, Dict, List, Optional
from flask import Blueprint, jsonify, request
from ytmusicapi import YTMusic

from core.process import release_os_memory

music_bp = Blueprint('music', __name__, url_prefix='/api/music')

# Thread-safe lazy singleton for YTMusic client
_ytmusic_instance: Optional[YTMusic] = None
_ytmusic_lock = threading.Lock()


def get_ytmusic() -> YTMusic:
    """Return a shared singleton instance of YTMusic without credentials."""
    global _ytmusic_instance
    if _ytmusic_instance is None:
        with _ytmusic_lock:
            if _ytmusic_instance is None:
                _ytmusic_instance = YTMusic()
    return _ytmusic_instance


@music_bp.route('/search', methods=['GET'])
def search_music():
    """Search YouTube Music for playable tracks.

    Query parameters:
    - q: Search keyword string (e.g. /api/music/search?q=Eminem)

    Returns:
    JSON array of up to 15 pruned tracks:
    [
      {
        "videoId": "zlJ0Aj9y67c",
        "title": "Lose Yourself",
        "artist": "Eminem",
        "thumbnail": "https://..."
      }
    ]
    """
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({"error": "Missing or empty query parameter 'q'"}), 400

    try:
        ytmusic = get_ytmusic()
        raw_results: List[Dict[str, Any]] = ytmusic.search(query, filter="songs")

        cleaned_tracks: List[Dict[str, str]] = []
        for item in raw_results[:15]:
            video_id = item.get('videoId')
            if not video_id or not isinstance(video_id, str):
                continue

            # 1. Primary artist extraction
            artist_name = ''
            artists = item.get('artists')
            if artists and isinstance(artists, list) and len(artists) > 0:
                artist_name = artists[0].get('name', '')
            elif isinstance(item.get('artist'), str):
                artist_name = item.get('artist', '')

            # 2. Highest resolution thumbnail extraction
            thumbnails = item.get('thumbnails') or []
            best_thumb_url = ''
            if thumbnails and isinstance(thumbnails, list):
                best_thumb = max(
                    thumbnails,
                    key=lambda t: (t.get('width') or 0) * (t.get('height') or 0),
                    default=None
                )
                best_thumb_url = (best_thumb or thumbnails[-1]).get('url', '')

            cleaned_tracks.append({
                "videoId": video_id,
                "title": item.get('title') or '',
                "artist": artist_name,
                "thumbnail": best_thumb_url,
            })

        return jsonify(cleaned_tracks), 200

    except Exception as e:
        print(f"[OrsayCast Music Search] Error searching for '{query}': {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        # Free memory back to the Linux kernel immediately after JSON response generation
        release_os_memory()

