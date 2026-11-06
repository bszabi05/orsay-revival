"""Route blueprints for IPTV Proxy and OrsayCast."""
from flask import Flask

from .cast import cast_bp
from .health import health_bp
from .logo import logo_bp
from .stream import stream_bp

ALL_BLUEPRINTS = [
    stream_bp,
    logo_bp,
    health_bp,
    cast_bp,
]


def register_routes(app: Flask) -> None:
    """Register all route blueprints onto the Flask application instance."""
    for bp in ALL_BLUEPRINTS:
        app.register_blueprint(bp)
