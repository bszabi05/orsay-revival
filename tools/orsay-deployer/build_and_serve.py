"""Package and serve the Samsung Orsay widget for Developer Mode IP Sync.

The Orsay synchronizer downloads a ZIP archive.  It does not install a
directory URL, so this script deliberately puts the widget files at the root
of the archive:

    config.xml
    widget.info
    index.html
    ...

The generated server_root directory contains both files that the TV needs:

    server_root/widgetlist.xml
    server_root/orsay_tv_app.zip

Run from the repository root or from this directory:

    python tools/orsay-deployer/build_and_serve.py

Stop the server with Ctrl+C.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEPLOYER_ROOT = REPOSITORY_ROOT / "tools" / "orsay-deployer"
WIDGET_DIR = REPOSITORY_ROOT / "apps" / "iptv-client"
SERVER_ROOT = DEPLOYER_ROOT / "server_root"
WIDGETLIST_NAME = "widgetlist.xml"
ARCHIVE_NAME = "orsay_tv_app.zip"
DOWNLOAD_URL = "http://192.168.1.247/orsay_tv_app.zip"


def build_archive(archive_path: Path) -> None:
    """Create an Orsay archive whose files are stored at the ZIP root."""
    if not WIDGET_DIR.is_dir():
        raise FileNotFoundError(f"Widget directory does not exist: {WIDGET_DIR}")

    required_files = ("config.xml", "widget.info", "index.html", "main.js")
    missing_files = [
        name for name in required_files if not (WIDGET_DIR / name).is_file()
    ]
    if missing_files:
        names = ", ".join(missing_files)
        raise FileNotFoundError(f"Widget package is missing: {names}")

    archive_path.parent.mkdir(parents=True, exist_ok=True)
    if archive_path.exists():
        archive_path.unlink()

    with zipfile.ZipFile(
        archive_path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
    ) as archive:
        for source_path in sorted(WIDGET_DIR.rglob("*")):
            if source_path.is_file():
                # widgetlist.xml belongs to the IP Sync server root, not the
                # installed widget package. The server version is generated
                # below after the final ZIP size is known.
                if (
                    source_path.name == WIDGETLIST_NAME
                    or source_path.name.endswith(".json.example")
                ):
                    continue
                # relative_to(WIDGET_DIR) is intentional: no app directory
                # is written inside the archive.
                archive_name = source_path.relative_to(WIDGET_DIR).as_posix()
                archive.write(source_path, archive_name)


def generate_widgetlist(archive_path: Path, output_path: Path) -> None:
    """Write the strict Orsay IP Sync response with the ZIP byte size."""
    zip_size = archive_path.stat().st_size
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rsp stat="ok">
  <list>
    <widget id="legacy.tv.app">
      <title>Legacy TV</title>
      <compression size="{zip_size}" type="zip" />
      <description>Legacy TV - HLS/m3u8 IPTV widget</description>
      <download>{DOWNLOAD_URL}</download>
    </widget>
  </list>
</rsp>
"""
    output_path.write_text(xml, encoding="utf-8", newline="\n")


def prepare_server_root() -> Path:
    """Build the ZIP and generate the IP Sync list in server_root."""
    SERVER_ROOT.mkdir(parents=True, exist_ok=True)
    archive_path = SERVER_ROOT / ARCHIVE_NAME
    build_archive(archive_path)
    generate_widgetlist(archive_path, SERVER_ROOT / WIDGETLIST_NAME)
    icon_src = WIDGET_DIR / "icon.png"
    if icon_src.is_file():
        import shutil
        shutil.copy2(icon_src, SERVER_ROOT / "icon.png")
    return archive_path


def serve(server_root: Path, host: str, port: int) -> None:
    """Serve the prepared files until interrupted by the user."""
    handler = partial(SimpleHTTPRequestHandler, directory=str(server_root))
    server = ThreadingHTTPServer((host, port), handler)
    address = f"http://{host if host not in ('0.0.0.0', '::') else 'localhost'}:{port}"
    print(f"Serving {server_root}")
    print(f"Widget list: {address}/{WIDGETLIST_NAME}")
    print(f"Widget ZIP:   {address}/{ARCHIVE_NAME}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Package and serve the Samsung Orsay widget."
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Bind address for the local web server (default: all interfaces).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=80,
        help="HTTP port (default: 80).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        archive_path = prepare_server_root()
        print(f"Created {archive_path}")
        serve(SERVER_ROOT, args.host, args.port)
    except OSError as error:
        print(f"Packaging/server error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
