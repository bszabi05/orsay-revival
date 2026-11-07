"""Package and serve Samsung Orsay widgets for Developer Mode IP Sync.

The Orsay synchronizer downloads a ZIP archive for each widget.
This script packages all selected widgets and generates a unified widgetlist.xml
manifest so the Samsung Smart TV can sync and install multiple apps at once:

    server_root/widgetlist.xml
    server_root/iptv_client.zip
    server_root/cast_client.zip
    server_root/Widget/iptv_client.zip
    server_root/Widget/cast_client.zip

Run from the repository root:

    python tools/orsay-deployer/build_and_serve.py                  # Serves all apps (both iptv-client & cast_client)
    python tools/orsay-deployer/build_and_serve.py -app all        # Serves all apps
    python tools/orsay-deployer/build_and_serve.py -app cast_client
    python tools/orsay-deployer/build_and_serve.py -app iptv-client

Stop the server with Ctrl+C.
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import sys
import xml.etree.ElementTree as ET
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEPLOYER_ROOT = REPOSITORY_ROOT / "tools" / "orsay-deployer"
APPS_ROOT = REPOSITORY_ROOT / "apps"
SERVER_ROOT = DEPLOYER_ROOT / "server_root"
WIDGETLIST_NAME = "widgetlist.xml"
DEFAULT_ARCHIVE_NAME = "orsay_tv_app.zip"


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


def list_available_apps() -> list[str]:
    """Scan the apps directory for valid Samsung Orsay widgets."""
    if not APPS_ROOT.is_dir():
        return []
    return [
        p.name
        for p in sorted(APPS_ROOT.iterdir())
        if p.is_dir() and (p / "config.xml").is_file()
    ]


def resolve_app_dir(app_arg: str) -> Path:
    """Resolve a single app directory from user argument (name, hyphen/underscore, or path)."""
    # 1. Direct path check (relative or absolute)
    direct_path = Path(app_arg).resolve()
    if direct_path.is_dir() and (direct_path / "config.xml").is_file():
        return direct_path

    # 2. Check directly inside apps/
    target = APPS_ROOT / app_arg
    if target.is_dir() and (target / "config.xml").is_file():
        return target.resolve()

    # 3. Check with hyphen <-> underscore variants (e.g. cast_client <-> cast-client)
    variant_underscore = APPS_ROOT / app_arg.replace("-", "_")
    if variant_underscore.is_dir() and (variant_underscore / "config.xml").is_file():
        return variant_underscore.resolve()

    variant_hyphen = APPS_ROOT / app_arg.replace("_", "-")
    if variant_hyphen.is_dir() and (variant_hyphen / "config.xml").is_file():
        return variant_hyphen.resolve()

    available = list_available_apps()
    avail_str = ", ".join(available) if available else "(none found)"
    raise FileNotFoundError(
        f"Widget application '{app_arg}' not found under '{APPS_ROOT}'. Available apps: {avail_str}"
    )


def resolve_app_dirs(app_arg: str) -> list[Path]:
    """Resolve one or more app directories. 'all' or empty returns all discovered apps."""
    if not app_arg or app_arg.strip().lower() == "all":
        all_app_names = list_available_apps()
        if not all_app_names:
            raise FileNotFoundError(f"No valid widget apps found under '{APPS_ROOT}'")
        return [APPS_ROOT / name for name in all_app_names]

    parts = [part.strip() for part in app_arg.split(",") if part.strip()]
    if not parts:
        return resolve_app_dirs("all")

    resolved: list[Path] = []
    for part in parts:
        resolved.append(resolve_app_dir(part))
    return resolved


def get_widget_metadata(widget_dir: Path) -> dict[str, str]:
    """Extract widget metadata (id, title, description, icon) from config.xml."""
    metadata = {
        "id": widget_dir.name.replace("-", "_"),
        "title": widget_dir.name,
        "description": f"Samsung Orsay widget - {widget_dir.name}",
        "icon": "icon.png",
    }
    config_file = widget_dir / "config.xml"
    if config_file.is_file():
        try:
            tree = ET.parse(config_file)
            root = tree.getroot()
            w_id = root.findtext("widgetid")
            w_title = root.findtext("widgetname")
            w_desc = root.findtext("description")
            w_icon = root.findtext("icon")

            if w_id and w_id.strip():
                metadata["id"] = w_id.strip()
            if w_title and w_title.strip():
                metadata["title"] = w_title.strip()
            if w_desc and w_desc.strip():
                metadata["description"] = w_desc.strip()
            if w_icon and w_icon.strip():
                metadata["icon"] = w_icon.strip()
        except Exception as err:
            sys.stderr.write(f"Warning: Could not parse config.xml for {widget_dir.name} ({err})\n")
    return metadata


def build_archive(widget_dir: Path, archive_path: Path) -> None:
    """Create an Orsay archive whose files are stored directly at the ZIP root."""
    if not widget_dir.is_dir():
        raise FileNotFoundError(f"Widget directory does not exist: {widget_dir}")

    required_files = ("config.xml", "widget.info", "icon.png", "index.html")
    missing_files = [
        name for name in required_files if not (widget_dir / name).is_file()
    ]
    if missing_files:
        names = ", ".join(missing_files)
        raise FileNotFoundError(f"Widget '{widget_dir.name}' is missing required files: {names}")

    archive_path.parent.mkdir(parents=True, exist_ok=True)
    if archive_path.exists():
        archive_path.unlink()

    with zipfile.ZipFile(
        archive_path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
    ) as archive:
        for source_path in sorted(widget_dir.rglob("*")):
            if source_path.is_file():
                if (
                    source_path.name == WIDGETLIST_NAME
                    or source_path.name.endswith(".json.example")
                    or source_path.name.endswith(".js.example")
                    or source_path.suffix.lower() == ".md"
                ):
                    continue
                archive_name = source_path.relative_to(widget_dir).as_posix()
                archive.write(source_path, archive_name)


def generate_widgetlist(
    widgets: list[dict[str, str | int]],
    output_path: Path,
) -> None:
    """Write the strict Orsay IP Sync manifest matching the SammyWidgets / SamyGO schema."""
    widget_items = []
    for w in widgets:
        item = f"""    <widget id="{w['id']}">
      <title>{w['title']}</title>
      <compression size="{w['zip_size']}" type="zip"/>
      <description>{w['description']}</description>
      <download>{w['download_url']}</download>
    </widget>"""
        widget_items.append(item)

    widgets_xml = "\n".join(widget_items)
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rsp stat="ok">
  <list>
{widgets_xml}
  </list>
</rsp>
"""
    output_path.write_text(xml, encoding="utf-8", newline="\n")


def prepare_server_root(widget_dirs: list[Path], server_ip: str, port: int) -> list[dict[str, str | int]]:
    """Build ZIPs and generate the dynamic IP Sync list for all target widgets."""
    SERVER_ROOT.mkdir(parents=True, exist_ok=True)
    widget_subdir = SERVER_ROOT / "Widget"
    widget_subdir.mkdir(parents=True, exist_ok=True)
    port_suffix = f":{port}" if port != 80 else ""

    prepared_widgets: list[dict[str, str | int]] = []

    for index, widget_dir in enumerate(widget_dirs):
        metadata = get_widget_metadata(widget_dir)
        # Avoid hyphens in zip filenames for Samsung BusyBox shell compatibility
        clean_name = widget_dir.name.replace("-", "_")
        archive_filename = f"{clean_name}.zip"
        archive_path = SERVER_ROOT / archive_filename

        # Build ZIP package directly at root
        build_archive(widget_dir, archive_path)
        zip_size = archive_path.stat().st_size

        # Also place in Widget/ subfolder for TV firmware expecting /Widget/ path
        shutil.copy2(archive_path, widget_subdir / archive_filename)

        # Copy icon to server root
        icon_source_name = metadata.get("icon", "icon.png")
        icon_src = widget_dir / icon_source_name
        if not icon_src.is_file():
            icon_src = widget_dir / "icon.png"

        server_icon_filename = f"{clean_name}_icon.png"
        if icon_src.is_file():
            shutil.copy2(icon_src, SERVER_ROOT / server_icon_filename)
            shutil.copy2(icon_src, widget_subdir / server_icon_filename)
            if not (SERVER_ROOT / "icon.png").is_file() or index == 0:
                shutil.copy2(icon_src, SERVER_ROOT / "icon.png")

        # Copy any icon/ subfolder contents
        icon_dir = widget_dir / "icon"
        if icon_dir.is_dir():
            server_icon_dir = SERVER_ROOT / "icon"
            server_icon_dir.mkdir(parents=True, exist_ok=True)
            for icon_file in icon_dir.glob("*.png"):
                shutil.copy2(icon_file, server_icon_dir / icon_file.name)
                shutil.copy2(icon_file, SERVER_ROOT / icon_file.name)

        # Also maintain orsay_tv_app.zip for single app legacy compatibility
        if index == 0:
            shutil.copy2(archive_path, SERVER_ROOT / DEFAULT_ARCHIVE_NAME)

        prepared_widgets.append({
            "id": metadata.get("id", clean_name),
            "title": metadata.get("title", clean_name),
            "description": metadata.get("description", "Samsung Orsay Widget"),
            "zip_size": zip_size,
            "archive_filename": archive_filename,
            "download_url": f"http://{server_ip}{port_suffix}/{archive_filename}",
            "dir_name": widget_dir.name,
        })

    # Generate unified widgetlist.xml containing all widgets
    generate_widgetlist(prepared_widgets, SERVER_ROOT / WIDGETLIST_NAME)

    return prepared_widgets


class OrsaySyncHandler(SimpleHTTPRequestHandler):
    """HTTP handler with clear client IP logging for Samsung TV sync debugging."""
    def log_message(self, format, *args):
        client_ip = self.client_address[0]
        sys.stdout.write(f"[{client_ip}] {format % args}\n")
        sys.stdout.flush()


def serve(
    server_root: Path,
    host: str,
    port: int,
    server_ip: str,
    prepared_widgets: list[dict[str, str | int]],
) -> None:
    """Serve the prepared files until interrupted by the user."""
    handler = partial(OrsaySyncHandler, directory=str(server_root))
    server = ThreadingHTTPServer((host, port), handler)
    port_suffix = f":{port}" if port != 80 else ""

    print("=" * 65)
    print("📺 SAMSUNG ORSAY DEVELOPER IP SYNC SERVER")
    print("=" * 65)
    print(f" Serving {len(prepared_widgets)} Widget(s) simultaneously:")
    for i, w in enumerate(prepared_widgets, 1):
        print(f"   {i}. {w['title']} (ID: {w['id']})")
        print(f"      📦 Package: {w['archive_filename']} ({w['zip_size']} bytes)")
        print(f"      🔗 URL:     {w['download_url']}")
    print("-" * 65)
    print(f" Enter this IP on the TV (IP Setting): {server_ip}")
    print(f" Serving Directory:                    {server_root}")
    print(f" Manifest URL:                         http://{server_ip}{port_suffix}/{WIDGETLIST_NAME}")
    print("=" * 65)
    print("Waiting for TV request... (Press Ctrl+C to stop)\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


def parse_args() -> argparse.Namespace:
    detected_ip = get_local_ip()
    available_apps = list_available_apps()

    parser = argparse.ArgumentParser(
        description="Package and serve Samsung Orsay widgets for Developer Mode IP Sync."
    )
    parser.add_argument(
        "-app",
        "--app",
        "-a",
        dest="app",
        default="all",
        help=f"Target app(s) to serve: 'all' (default: all available apps), a specific app name, or comma-separated list. Available: {', '.join(available_apps)}",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Bind address for the local web server (default: 0.0.0.0).",
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
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Only package widget ZIPs and generate widgetlist.xml without starting the HTTP server.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        widget_dirs = resolve_app_dirs(args.app)
        prepared_widgets = prepare_server_root(widget_dirs, args.ip, args.port)
        if args.build_only:
            print(f"Successfully packaged {len(prepared_widgets)} widget(s) in {SERVER_ROOT}.")
            return 0
        serve(
            SERVER_ROOT,
            args.host,
            args.port,
            args.ip,
            prepared_widgets,
        )
    except FileNotFoundError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"Packaging/server error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
