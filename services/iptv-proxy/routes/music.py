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


@music_bp.route('/related', methods=['GET'])
@music_bp.route('/radio', methods=['GET'])
def related_music():
    """Fetch similar/recommended tracks for a given videoId using YouTube Music Radio.

    Query parameters:
    - videoId / v: Target YouTube/YouTube Music video ID (e.g. /api/music/related?videoId=zlJ0Aj9y67c)
    - limit: Maximum number of recommended tracks to return (default: 15, max: 30)

    Returns:
    JSON array of pruned similar tracks:
    [
      {
        "videoId": "Obim8BYGnOE",
        "title": "Till I Collapse",
        "artist": "Eminem",
        "thumbnail": "https://..."
      }
    ]
    """
    video_id = request.args.get('videoId') or request.args.get('v') or request.args.get('q')
    if not video_id or not video_id.strip():
        return jsonify({"error": "Missing or empty query parameter 'videoId' (or 'v')"}), 400

    video_id = video_id.strip()

    try:
        limit_param = request.args.get('limit', '15')
        try:
            limit = min(30, max(1, int(limit_param)))
        except ValueError:
            limit = 15

        ytmusic = get_ytmusic()
        watch_playlist = ytmusic.get_watch_playlist(videoId=video_id, limit=limit + 5)
        raw_tracks = watch_playlist.get('tracks') or []

        cleaned_recommendations: List[Dict[str, str]] = []
        for item in raw_tracks:
            item_vid = item.get('videoId')
            if not item_vid or not isinstance(item_vid, str):
                continue

            # Skip the seed track itself so we only return new recommendations
            if item_vid == video_id and len(cleaned_recommendations) == 0:
                continue

            # 1. Primary artist extraction
            artist_name = ''
            artists = item.get('artists')
            if artists and isinstance(artists, list) and len(artists) > 0:
                artist_name = artists[0].get('name', '')
            elif isinstance(item.get('artist'), str):
                artist_name = item.get('artist', '')

            # 2. Highest resolution thumbnail extraction (thumbnail can be list or dict)
            thumbs = item.get('thumbnail') or item.get('thumbnails') or []
            best_thumb_url = ''
            if isinstance(thumbs, list) and thumbs:
                best_thumb = max(
                    thumbs,
                    key=lambda t: (t.get('width') or 0) * (t.get('height') or 0),
                    default=thumbs[-1]
                )
                best_thumb_url = best_thumb.get('url', '') if isinstance(best_thumb, dict) else ''
            elif isinstance(thumbs, dict):
                best_thumb_url = thumbs.get('url', '')

            cleaned_recommendations.append({
                "videoId": item_vid,
                "title": item.get('title') or '',
                "artist": artist_name,
                "thumbnail": best_thumb_url,
            })

            if len(cleaned_recommendations) >= limit:
                break

        return jsonify(cleaned_recommendations), 200

    except Exception as e:
        print(f"[OrsayCast Music Related] Error fetching recommendations for '{video_id}': {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_os_memory()

