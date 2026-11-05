"""IPTV Proxy Server - Main Application Controller.

Orchestrates Flask application initialization, route blueprint registration,
and WSGI / dev server startup.
"""
import os
import sys
from pathlib import Path
from flask import Flask

# Ensure services/iptv-proxy root is on sys.path for direct script execution
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.config import SERVER_HOST, SERVER_PORT
from routes import register_routes


def create_app() -> Flask:
    """Application factory for the IPTV Proxy server."""
    app = Flask(__name__)

    # Register modular route blueprints
    register_routes(app)

    return app


app = create_app()

if __name__ == '__main__':
    print(f"Starting IPTV Proxy on http://{SERVER_HOST}:{SERVER_PORT}")
    app.run(host=SERVER_HOST, port=SERVER_PORT)
