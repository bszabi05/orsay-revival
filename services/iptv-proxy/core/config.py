import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = BASE_DIR / "cache"
LOGOS_CACHE_DIR = CACHE_DIR / "logos"

# Ensure cache directories exist
LOGOS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Server network settings
SERVER_PORT = int(os.environ.get("SERVER_PORT", 7833))
SERVER_HOST = os.environ.get("SERVER_HOST", "0.0.0.0")

