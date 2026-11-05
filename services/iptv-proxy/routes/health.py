import sys
from flask import Blueprint, jsonify

from core.process import get_active_pids

health_bp = Blueprint('health', __name__)


@health_bp.route('/health')
def health():
    """Diagnostic health check returning active process count and status."""
    active_pids = get_active_pids()
    return jsonify({
        "status": "ok",
        "active_stream_count": len(active_pids),
        "active_pids": active_pids,
        "python_version": sys.version
    })

