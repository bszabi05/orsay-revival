"""Core utilities and configurations for IPTV Proxy."""
from .config import BASE_DIR, CACHE_DIR, LOGOS_CACHE_DIR, SERVER_HOST, SERVER_PORT
from .process import (
    active_streams,
    get_active_pids,
    get_ffmpeg_binary,
    kill_process,
    register_stream,
    release_os_memory,
    streams_lock,
    unregister_stream,
)

