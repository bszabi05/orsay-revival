"""IPTV Proxy Server - Main Application Controller.

Orchestrates Flask application initialization, route blueprint registration,
custom logging filters for high-frequency polling endpoints, and server startup.
"""
import logging
import os
import re
import sys
import threading
import time
from pathlib import Path
from flask import Flask

# Ensure services/iptv-proxy root is on sys.path for direct script execution
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.config import SERVER_HOST, SERVER_PORT
from routes import register_routes


class PollingLogFilter(logging.Filter):
    """Filters out routine, high-frequency polling requests from console logs.

    Instead of printing individual lines every second, aggregates them
    and prints a single summary line periodically (every 60 seconds).
    Non-200/204 responses (errors) are always logged immediately.
    """

    POLL_PATTERN = re.compile(r'"GET /(status|queue|health)[^"]*"\s+(200|204)\b')

    def __init__(self, aggregate_interval_seconds: int = 60) -> None:
        super().__init__()
        self.lock = threading.Lock()
        self.count = 0
        self.last_log_time = time.time()
        self.interval = aggregate_interval_seconds

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()

        # Check if this record is a successful polling request
        if self.POLL_PATTERN.search(msg):
            with self.lock:
                self.count += 1
                now = time.time()
                if now - self.last_log_time >= self.interval:
                    count_snapshot = self.count
                    self.count = 0
                    self.last_log_time = now
                    print(f"[IPTV Proxy] Polling aggregated: {count_snapshot} requests handled (/status, /queue)")
            return False

        return True


def configure_logging() -> None:
    """Attach the polling aggregator filter to the Werkzeug logger."""
    werkzeug_logger = logging.getLogger("werkzeug")
    if not any(isinstance(f, PollingLogFilter) for f in werkzeug_logger.filters):
        werkzeug_logger.addFilter(PollingLogFilter())


def create_app() -> Flask:
    """Application factory for the IPTV Proxy server."""
    configure_logging()
    app = Flask(__name__)

    # Register modular route blueprints
    register_routes(app)

    return app


app = create_app()

if __name__ == '__main__':
    print(f"Starting IPTV Proxy on http://{SERVER_HOST}:{SERVER_PORT}")
    app.run(host=SERVER_HOST, port=SERVER_PORT)
