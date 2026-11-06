"""OrsayCast State and Extraction Manager.

Handles single-stream state machine ('idle', 'extracting', 'ready', 'playing', 'error'),
thread-safe transitions via threading.Lock(), background yt-dlp metadata extraction
without downloading, and FFmpeg subprocess lifecycle management optimized for
512MB RAM VPS environments.
"""
import threading
from typing import Any, Dict, List, Optional

from core.process import kill_process, release_os_memory


class CastManager:
    """Thread-safe singleton state manager for OrsayCast."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.status: str = 'idle'  # 'idle' | 'extracting' | 'ready' | 'playing' | 'error'
        self.original_url: Optional[str] = None
        self.direct_stream_url: Optional[str] = None
        self.direct_audio_url: Optional[str] = None
        self.media_title: Optional[str] = None
        self.duration: Optional[int] = None
        self.active_process: Optional[Any] = None
        self.error_message: Optional[str] = None

    def get_status(self) -> Dict[str, Any]:
        """Return the current cast state dictionary."""
        with self.lock:
            state: Dict[str, Any] = {
                "status": self.status,
                "original_url": self.original_url,
            }
            if self.media_title:
                state["title"] = self.media_title
            if self.duration:
                state["duration"] = self.duration
            if self.error_message:
                state["error"] = self.error_message
            return state

    def get_direct_stream_url(self) -> Optional[str]:
        """Return the primary direct stream URL if available."""
        with self.lock:
            return self.direct_stream_url

    def get_stream_inputs(self) -> List[str]:
        """Return list of input stream URLs for FFmpeg (video + optional separate audio)."""
        with self.lock:
            inputs = []
            if self.direct_stream_url:
                inputs.append(self.direct_stream_url)
            if self.direct_audio_url:
                inputs.append(self.direct_audio_url)
            return inputs

    def is_ready_or_playing(self) -> bool:
        """Check if a direct stream is ready for playback."""
        with self.lock:
            return self.status in ('ready', 'playing') and bool(self.direct_stream_url)

    def set_active_process(self, proc: Any) -> None:
        """Set the active FFmpeg process and update status to 'playing'."""
        with self.lock:
            self.active_process = proc
            self.status = 'playing'

    def stop_cast(self) -> None:
        """Completely terminate the active stream, clear variables, and return to 'idle'."""
        with self.lock:
            proc = self.active_process
            self.active_process = None
            self.status = 'idle'
            self.original_url = None
            self.direct_stream_url = None
            self.direct_audio_url = None
            self.media_title = None
            self.duration = None
            self.error_message = None

        if proc is not None:
            kill_process(proc)

        release_os_memory()

    def start_cast(self, url: str) -> None:
        """Stop any active cast, set status to 'extracting', and launch background worker."""
        with self.lock:
            proc = self.active_process
            self.active_process = None
            self.status = 'extracting'
            self.original_url = url
            self.direct_stream_url = None
            self.direct_audio_url = None
            self.media_title = None
            self.duration = None
            self.error_message = None

        if proc is not None:
            kill_process(proc)

        # Launch extraction in background thread to avoid blocking Flask HTTP worker
        worker = threading.Thread(
            target=self._extract_worker,
            args=(url,),
            name="OrsayCast-Extractor",
            daemon=True
        )
        worker.start()

    def _extract_worker(self, url: str) -> None:
        """Background worker executing yt-dlp metadata extraction without downloading."""
        try:
            import yt_dlp

            # Format selector hierarchy:
            # 1. Pre-muxed <=720p MP4 (single file)
            # 2. H.264 (avc1) <=720p video + AAC (mp4a) audio (remuxed by FFmpeg on the fly)
            # 3. Any <=720p video + any audio
            # 4. Fallback best
            # This guarantees compatibility with modern YouTube videos (which only serve separate streams)
            # and native hardware decoding on 2015 Samsung Smart TVs (Orsay OS).
            format_selector = (
                'best[height<=720][ext=mp4]/'
                'bestvideo[height<=720][vcodec^=avc1]+bestaudio[acodec^=mp4a]/'
                'bestvideo[height<=720]+bestaudio/'
                'best'
            )

            ydl_opts = {
                'format': format_selector,
                'quiet': True,
                'no_warnings': True,
                'noplaylist': True,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if not info:
                    raise ValueError("yt-dlp returned empty metadata")

                title = info.get('title')
                duration = info.get('duration')
                direct_v_url = None
                direct_a_url = None

                # Check if separate video and audio streams were extracted (e.g. YouTube DASH)
                requested_formats = info.get('requested_formats')
                if requested_formats and len(requested_formats) >= 2:
                    direct_v_url = requested_formats[0].get('url')
                    direct_a_url = requested_formats[1].get('url')
                elif requested_formats and len(requested_formats) == 1:
                    direct_v_url = requested_formats[0].get('url')
                else:
                    direct_v_url = info.get('url')
                    if not direct_v_url and 'formats' in info and len(info['formats']) > 0:
                        direct_v_url = info['formats'][-1].get('url')
                    if not direct_v_url and 'entries' in info and len(info['entries']) > 0:
                        first = info['entries'][0]
                        if isinstance(first, dict):
                            direct_v_url = first.get('url')

                if not direct_v_url:
                    raise ValueError("No direct media stream URL could be extracted")

                with self.lock:
                    # Guard: verify another request didn't overwrite this extraction while running
                    if self.status == 'extracting' and self.original_url == url:
                        self.direct_stream_url = direct_v_url
                        self.direct_audio_url = direct_a_url
                        self.media_title = title
                        self.duration = duration
                        self.status = 'ready'
                        self.error_message = None
                        print(f"[OrsayCast] Successfully extracted {url} (title={title}, dual_input={bool(direct_a_url)})")

        except Exception as e:
            print(f"[OrsayCast] Extraction error for {url}: {e}")
            with self.lock:
                if self.status == 'extracting' and self.original_url == url:
                    self.status = 'error'
                    self.error_message = str(e)
                    self.direct_stream_url = None
                    self.direct_audio_url = None
        finally:
            release_os_memory()


# Global singleton instance
cast_manager = CastManager()
