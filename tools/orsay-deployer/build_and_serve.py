"""Package and serve the Samsung Orsay widget for Developer Mode IP Sync.

The Orsay synchronizer downloads a ZIP archive. It does not install a
directory URL, so this script deliberately puts the widget files at the root
of the archive:

    config.xml
    widget.info
    index.html
    ...

The generated server_root directory contains both files that the TV needs:

    server_root/widgetlist.xml
    server_root/orsay_tv_app.zip

Run from the repository root:

    python tools/orsay-deployer/build_and_serve.py

Stop the server with Ctrl+C.
"""

from __future__ import annotations

import argparse
import socket
import sys
import zipfile
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEPLOYER_ROOT = REPOSITORY_ROOT / "tools" / "orsay-deployer"
WIDGET_DIR = REPOSITORY_ROOT / "apps" / "iptv-client"
SERVER_ROOT = DEPLOYER_ROOT / "server_root"
WIDGETLIST_NAME = "widgetlist.xml"
ARCHIVE_NAME = "orsay_tv_app.zip"


def get_local_ip() -> str:
    """Auto-detect the most likely local LAN IPv4 address."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            # Connecting to a public UDP address does not send packets
            # but allows OS route table to determine outgoing interface IP.
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def build_archive(archive_path: Path) -> None:
    """Create an Orsay archive whose files are stored at the ZIP root."""
    if not WIDGET_DIR.is_dir():
        raise FileNotFoundError(f"Widget directory does not exist: {WIDGET_DIR}")

    required_files = (
        "config.xml",
        "widget.info",
        "icon.png",
        "index.html",
        "main.js",
    )
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
                if (
                    source_path.name == WIDGETLIST_NAME
                    or source_path.name.endswith(".json.example")
                    or source_path.name.endswith(".js.example")
                    or source_path.suffix.lower() == ".md"
                ):
                    continue
                archive_name = source_path.relative_to(WIDGET_DIR).as_posix()
                archive.write(source_path, archive_name)


def generate_widgetlist(archive_path: Path, output_path: Path, server_ip: str, port: int) -> None:
    """Write the strict Orsay IP Sync response with the ZIP byte size and dynamic server IP."""
    zip_size = archive_path.stat().st_size
    port_suffix = f":{port}" if port != 80 else ""
    download_url = f"http://{server_ip}{port_suffix}/{ARCHIVE_NAME}"
    icon_url = f"http://{server_ip}{port_suffix}/icon.png"

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rsp stat="ok">
  <list>
    <widget id="legacy.tv.app">
      <title>Legacy TV</title>
      <compression size="{zip_size}" type="zip" />
      <description>Legacy TV - HLS/m3u8 IPTV widget</description>
      <icon>{icon_url}</icon>
      <download>{download_url}</download>
    </widget>
  </list>
</rsp>
"""
    output_path.write_text(xml, encoding="utf-8", newline="\n")


def prepare_server_root(server_ip: str, port: int) -> Path:
    """Build the ZIP and generate the dynamic IP Sync list in server_root."""
    SERVER_ROOT.mkdir(parents=True, exist_ok=True)
    archive_path = SERVER_ROOT / ARCHIVE_NAME
    build_archive(archive_path)
    generate_widgetlist(archive_path, SERVER_ROOT / WIDGETLIST_NAME, server_ip, port)

    icon_src = WIDGET_DIR / "icon.png"
    if not icon_src.is_file():
        raise FileNotFoundError(f"Widget icon does not exist: {icon_src}")
    shutil.copy2(icon_src, SERVER_ROOT / "icon.png")
    return archive_path


class OrsaySyncHandler(SimpleHTTPRequestHandler):
    """HTTP handler with clear client IP logging for Samsung TV sync debugging."""
    def log_message(self, format, *args):
        client_ip = self.client_address[0]
        sys.stdout.write(f"[{client_ip}] {format % args}\n")
        sys.stdout.flush()


def serve(server_root: Path, host: str, port: int, server_ip: str) -> None:
    """Serve the prepared files until interrupted by the user."""
    handler = partial(OrsaySyncHandler, directory=str(server_root))
    server = ThreadingHTTPServer((host, port), handler)
    port_suffix = f":{port}" if port != 80 else ""

    print("📺 SAMSUNG ORSAY DEVELOPER IP SYNC SERVER")
    print(f" Enter this IP on the TV (IP Setting): {server_ip}")
    print(f" Serving from directory:               {server_root}")
    print(f" Manifest URL:                         http://{server_ip}{port_suffix}/{WIDGETLIST_NAME}")
    print(f" Package ZIP URL:                      http://{server_ip}{port_suffix}/{ARCHIVE_NAME}")
    print("Waiting for TV request... (Press Ctrl+C to stop)\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


def parse_args() -> argparse.Namespace:
    detected_ip = get_local_ip()
    parser = argparse.ArgumentParser(
        description="Package and serve the Samsung Orsay widget."
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Bind address for the local web server (default: all interfaces 0.0.0.0).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=80,
        help="HTTP port (default: 80, Samsung Orsay requires port 80).",
    )
    parser.add_argument(
        "--ip",
        default=detected_ip,
        help=f"Server IP address advertised to the TV (default auto-detected: {detected_ip}).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        archive_path = prepare_server_root(args.ip, args.port)
        serve(SERVER_ROOT, args.host, args.port, args.ip)
    except OSError as error:
        print(f"Packaging/server error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
