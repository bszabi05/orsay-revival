"""Route blueprints for IPTV Proxy."""
from flask import Flask

from .health import health_bp
from .logo import logo_bp
from .stream import stream_bp

ALL_BLUEPRINTS = [
    stream_bp,
    logo_bp,
    health_bp,
]


def register_routes(app: Flask) -> None:
    """Register all route blueprints onto the Flask application instance."""
    for bp in ALL_BLUEPRINTS:
        app.register_blueprint(bp)

