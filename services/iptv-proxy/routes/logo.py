import base64
import hashlib
import urllib.request
from flask import Blueprint, Response, request

from core.config import LOGOS_CACHE_DIR

logo_bp = Blueprint('logo', __name__)


@logo_bp.route('/logo')
def proxy_logo():
    b64_url = request.args.get('b64')
    if not b64_url:
        return "Missing URL", 400

    try:
        url = base64.b64decode(b64_url).decode('utf-8')
    except Exception:
        return "Invalid Base64", 400

    cache_key = hashlib.sha256(url.encode('utf-8')).hexdigest()
    img_path = LOGOS_CACHE_DIR / f"{cache_key}.img"
    meta_path = LOGOS_CACHE_DIR / f"{cache_key}.meta"

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

