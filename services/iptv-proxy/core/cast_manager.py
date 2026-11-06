"""OrsayCast State, Queue, and Extraction Manager.

Handles:
- Playlist queue management (chaining URLs, next, previous, remove, clear)
- Thread-safe state transitions ('idle', 'extracting', 'ready', 'playing', 'error')
- Playback state control ('playing', 'paused')
- Lazy background yt-dlp metadata extraction without downloading (pre-muxed / H.264+AAC)
- FFmpeg subprocess lifecycle management optimized for 512MB RAM VPS environments.
"""
import threading
from typing import Any, Dict, List, Optional, Tuple

from core.process import kill_process, release_os_memory


class QueueItem:
    """Represents a single media item in the playback queue."""

    def __init__(self, item_id: int, url: str, title: Optional[str] = None) -> None:
        self.id: int = item_id
        self.url: str = url
        self.title: str = title or url
        self.direct_stream_url: Optional[str] = None
        self.direct_audio_url: Optional[str] = None
        self.duration: Optional[int] = None
        self.status: str = 'pending'  # 'pending' | 'extracting' | 'ready' | 'playing' | 'played' | 'error'
        self.error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert queue item to dictionary representation."""
        return {
            "id": self.id,
            "url": self.url,
            "title": self.title,
            "status": self.status,
            "duration": self.duration,
            "has_audio": bool(self.direct_audio_url or self.direct_stream_url),
            "error": self.error,
        }


class CastManager:
    """Thread-safe singleton state and playlist manager for OrsayCast."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.queue: List[QueueItem] = []
        self.queue_index: int = -1
        self.item_counter: int = 0
        self.status: str = 'idle'  # 'idle' | 'extracting' | 'ready' | 'playing' | 'error'
        self.playback_state: str = 'playing'  # 'playing' | 'paused'
        self.active_process: Optional[Any] = None
        self.error_message: Optional[str] = None

    def current_item(self) -> Optional[QueueItem]:
        """Return the current queue item, or None if queue is empty/unselected."""
        if 0 <= self.queue_index < len(self.queue):
            return self.queue[self.queue_index]
        return None

    def get_status(self) -> Dict[str, Any]:
        """Return the current cast state dictionary for polling."""
        with self.lock:
            curr = self.current_item()
            state: Dict[str, Any] = {
                "status": self.status,
                "playback_state": self.playback_state,
                "original_url": curr.url if curr else None,
                "title": curr.title if curr else None,
                "duration": curr.duration if curr else None,
                "queue_index": self.queue_index,
                "queue_count": len(self.queue),
                "has_next": self.queue_index + 1 < len(self.queue),
                "has_prev": self.queue_index > 0,
            }
            if self.error_message:
                state["error"] = self.error_message
            elif curr and curr.error:
                state["error"] = curr.error
            return state

    def get_queue_info(self) -> Dict[str, Any]:
        """Return full playlist queue metadata."""
        with self.lock:
            return {
                "current_index": self.queue_index,
                "count": len(self.queue),
                "items": [item.to_dict() for item in self.queue],
            }

    def get_stream_inputs(self) -> List[str]:
        """Return list of stream inputs for FFmpeg (video + optional audio)."""
        with self.lock:
            curr = self.current_item()
            if not curr:
                return []
            inputs = []
            if curr.direct_stream_url:
                inputs.append(curr.direct_stream_url)
            if curr.direct_audio_url:
                inputs.append(curr.direct_audio_url)
            return inputs

    def is_ready_or_playing(self) -> bool:
        """Check if a direct stream is ready for playback."""
        with self.lock:
            curr = self.current_item()
            return bool(curr and curr.direct_stream_url and self.status in ('ready', 'playing'))

    def set_active_process(self, proc: Any) -> None:
        """Set the active FFmpeg process and update status to 'playing'."""
        with self.lock:
            self.active_process = proc
            self.status = 'playing'
            curr = self.current_item()
            if curr:
                curr.status = 'playing'

    def stop_active_stream(self) -> None:
        """Terminate the active FFmpeg process without resetting the whole queue."""
        proc = None
        with self.lock:
            if self.active_process is not None:
                proc = self.active_process
                self.active_process = None
            if self.status == 'playing':
                self.status = 'idle'
                curr = self.current_item()
                if curr and curr.status == 'playing':
                    curr.status = 'played'

        if proc is not None:
            kill_process(proc)

        release_os_memory()

    def stop_cast(self) -> None:
        """Completely stop current playback and reset state to 'idle'."""
        self.stop_active_stream()
        with self.lock:
            self.status = 'idle'
            self.playback_state = 'playing'
            self.error_message = None

    def clear_queue(self) -> None:
        """Clear the entire queue and stop any running streams."""
        self.stop_active_stream()
        with self.lock:
            self.queue.clear()
            self.queue_index = -1
            self.status = 'idle'
            self.playback_state = 'playing'
            self.error_message = None

    def remove_queue_item(self, item_id: int) -> bool:
        """Remove an item from the queue by its ID."""
        with self.lock:
            target_idx = -1
            for idx, item in enumerate(self.queue):
                if item.id == item_id:
                    target_idx = idx
                    break

            if target_idx == -1:
                return False

            # If removing currently active item
            if target_idx == self.queue_index:
                del self.queue[target_idx]
                if target_idx < len(self.queue):
                    self._play_item_at_index_locked(target_idx)
                elif self.queue:
                    self._play_item_at_index_locked(len(self.queue) - 1)
                else:
                    self.queue_index = -1
                    self.status = 'idle'
            else:
                if target_idx < self.queue_index:
                    self.queue_index -= 1
                del self.queue[target_idx]

            return True

    def add_to_queue(self, url: str, play_now: bool = False, title: Optional[str] = None) -> QueueItem:
        """Add a video URL to the queue.

        If play_now is True, or if the queue is empty / currently idle,
        the stream switches immediately to this item.
        """
        worker_task = None
        with self.lock:
            self.item_counter += 1
            item = QueueItem(self.item_counter, url, title)
            self.queue.append(item)

            should_start = play_now or self.status == 'idle' or self.queue_index == -1

            if should_start:
                target_idx = len(self.queue) - 1
                worker_task = self._prepare_play_item_locked(target_idx)

        # Launch background extraction outside the lock if needed
        if worker_task:
            item_id, item_url = worker_task
            worker = threading.Thread(
                target=self._extract_worker,
                args=(item_id, item_url),
                name=f"OrsayCast-Extract-{item_id}",
                daemon=True
            )
            worker.start()

        return item

    def start_cast(self, url: str) -> None:
        """Backward-compatible shortcut to play a URL immediately."""
        self.add_to_queue(url, play_now=True)

    def next_track(self) -> Tuple[bool, Optional[QueueItem]]:
        """Advance playback to the next track in the queue."""
        worker_task = None
        next_item = None
        has_next = False

        with self.lock:
            if self.queue_index + 1 < len(self.queue):
                has_next = True
                curr = self.current_item()
                if curr and curr.status == 'playing':
                    curr.status = 'played'

                target_idx = self.queue_index + 1
                worker_task = self._prepare_play_item_locked(target_idx)
                next_item = self.queue[target_idx]
            else:
                # End of playlist reached
                curr = self.current_item()
                if curr and curr.status == 'playing':
                    curr.status = 'played'
                self.status = 'idle'

        if worker_task:
            item_id, item_url = worker_task
            worker = threading.Thread(
                target=self._extract_worker,
                args=(item_id, item_url),
                name=f"OrsayCast-Extract-{item_id}",
                daemon=True
            )
            worker.start()

        return (has_next, next_item)

    def previous_track(self) -> Tuple[bool, Optional[QueueItem]]:
        """Go back to the previous track or restart the current track."""
        worker_task = None
        target_item = None
        has_prev = False

        with self.lock:
            if self.queue_index > 0:
                has_prev = True
                target_idx = self.queue_index - 1
                worker_task = self._prepare_play_item_locked(target_idx)
                target_item = self.queue[target_idx]
            elif self.queue_index == 0:
                # Replay first track from beginning
                has_prev = True
                worker_task = self._prepare_play_item_locked(0)
                target_item = self.queue[0]

        if worker_task:
            item_id, item_url = worker_task
            worker = threading.Thread(
                target=self._extract_worker,
                args=(item_id, item_url),
                name=f"OrsayCast-Extract-{item_id}",
                daemon=True
            )
            worker.start()

        return (has_prev, target_item)

    def play(self) -> bool:
        """Set playback state to 'playing' or resume current track."""
        worker_task = None
        with self.lock:
            self.playback_state = 'playing'
            if self.status == 'idle' and self.queue:
                idx = max(0, self.queue_index)
                if idx < len(self.queue):
                    worker_task = self._prepare_play_item_locked(idx)

        if worker_task:
            item_id, item_url = worker_task
            worker = threading.Thread(
                target=self._extract_worker,
                args=(item_id, item_url),
                name=f"OrsayCast-Extract-{item_id}",
                daemon=True
            )
            worker.start()

        return True

    def pause(self) -> bool:
        """Set playback state to 'paused'."""
        with self.lock:
            self.playback_state = 'paused'
            return True

    def toggle_play_pause(self) -> str:
        """Toggle between 'playing' and 'paused'."""
        with self.lock:
            if self.playback_state == 'playing':
                self.playback_state = 'paused'
                return 'paused'

        self.play()
        return 'playing'

    def _prepare_play_item_locked(self, index: int) -> Optional[Tuple[int, str]]:
        """Internal helper: prepare item for playback under lock.

        Returns (item_id, url) tuple if background extraction is needed.
        """
        old_proc = self.active_process
        self.active_process = None

        if old_proc is not None:
            kill_process(old_proc)

        self.queue_index = index
        item = self.queue[index]

        # If already extracted and valid, switch directly to ready
        if item.status == 'ready' and item.direct_stream_url:
            self.status = 'ready'
            self.playback_state = 'playing'
            self.error_message = None
            return None

        # Needs extraction
        item.status = 'extracting'
        item.error = None
        self.status = 'extracting'
        self.playback_state = 'playing'
        self.error_message = None
        return (item.id, item.url)

    def _extract_worker(self, item_id: int, url: str) -> None:
        """Background worker executing yt-dlp metadata extraction without downloading."""
        try:
            import yt_dlp

            # Format selector hierarchy:
            # 1. Pre-muxed <=720p MP4 (single file)
            # 2. H.264 (avc1) <=720p video + AAC (mp4a) audio (remuxed by FFmpeg on the fly)
            # 3. Any <=720p video + any audio
            # 4. Fallback best
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
                    # Find item by ID to avoid race conditions
                    target_item = None
                    for it in self.queue:
                        if it.id == item_id:
                            target_item = it
                            break

                    if target_item:
                        target_item.direct_stream_url = direct_v_url
                        target_item.direct_audio_url = direct_a_url
                        if title:
                            target_item.title = title
                        target_item.duration = duration
                        target_item.status = 'ready'
                        target_item.error = None

                    # If this item is currently selected, update manager status
                    curr = self.current_item()
                    if curr and curr.id == item_id:
                        self.status = 'ready'
                        self.error_message = None
                        print(f"[OrsayCast] Queue item #{item_id} ready: {title} (dual_input={bool(direct_a_url)})")

        except Exception as e:
            print(f"[OrsayCast] Extraction error for #{item_id} ({url}): {e}")
            with self.lock:
                target_item = None
                for it in self.queue:
                    if it.id == item_id:
                        target_item = it
                        break

                if target_item:
                    target_item.status = 'error'
                    target_item.error = str(e)

                curr = self.current_item()
                if curr and curr.id == item_id:
                    self.status = 'error'
                    self.error_message = str(e)
        finally:
            release_os_memory()


# Global singleton instance
cast_manager = CastManager()
