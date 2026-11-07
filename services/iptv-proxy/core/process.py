import ctypes
import ctypes.util
import gc
import os
import shutil
import signal
import subprocess
import threading

from core.config import BASE_DIR

# Process tracking per connection
streams_lock = threading.Lock()
active_streams = set()


def release_os_memory():
    """Trigger Python GC and force glibc malloc_trim to return free memory to the Linux kernel."""
    try:
        if gc is not None and hasattr(gc, 'collect'):
            gc.collect()
        if ctypes and hasattr(ctypes, 'util') and hasattr(ctypes.util, 'find_library'):
            libc_name = ctypes.util.find_library('c')
            if libc_name:
                libc = ctypes.CDLL(libc_name)
                if hasattr(libc, 'malloc_trim'):
                    libc.malloc_trim(0)
    except Exception:
        pass


def kill_process(proc):
    """Safely, completely, and aggressively terminate a subprocess and its process group."""
    if proc is None:
        return
    try:
        if proc.poll() is None:
            # On Linux/macOS, kill the entire process group to eliminate any child threads
            if os.name != 'nt' and hasattr(os, 'killpg') and hasattr(os, 'getpgid'):
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except Exception:
                    proc.terminate()
            else:
                proc.terminate()

            # Wait up to 1.5 seconds for graceful exit
            try:
                proc.wait(timeout=1.5)
            except subprocess.TimeoutExpired:
                # Force kill if not exited gracefully
                if os.name != 'nt' and hasattr(os, 'killpg') and hasattr(os, 'getpgid'):
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    except Exception:
                        proc.kill()
                else:
                    proc.kill()
                try:
                    proc.wait(timeout=1.0)
                except Exception:
                    pass
    except Exception as e:
        print(f"Error terminating process {getattr(proc, 'pid', 'unknown')}: {e}")
    finally:
        if proc.stdout:
            try:
                proc.stdout.close()
            except Exception:
                pass
        release_os_memory()


def register_stream(proc):
    with streams_lock:
        # Reap any already dead processes to prevent lingering references
        dead = [p for p in active_streams if p.poll() is not None]
        for p in dead:
            active_streams.discard(p)
            try:
                if p.stdout:
                    p.stdout.close()
            except Exception:
                pass
        active_streams.add(proc)


def unregister_stream(proc):
    with streams_lock:
        active_streams.discard(proc)
    kill_process(proc)


def get_active_pids():
    """Return a list of currently active process PIDs."""
    with streams_lock:
        return [p.pid for p in active_streams if p.poll() is None]


def get_ffmpeg_binary():
    """Detect ffmpeg binary across Linux/macOS and Windows environments."""
    local_exe = BASE_DIR / "ffmpeg.exe"
    if os.name == "nt" and local_exe.is_file():
        return str(local_exe)
    return shutil.which("ffmpeg") or "ffmpeg"

