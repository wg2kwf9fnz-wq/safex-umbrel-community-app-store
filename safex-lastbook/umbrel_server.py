#!/usr/bin/env python3
"""Umbrel adapter for Lastbook's upstream browser library server.

The authenticated Umbrel app proxy is the only network entry point; the app
container does not publish a host port. The adapter keeps Lastbook's normal
host/origin checks for direct clients and trusts private-network proxy requests
carrying X-Forwarded-For.
"""
from __future__ import annotations

import ipaddress
import os
import sys
import threading
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import server  # noqa: E402
from engine import paths  # noqa: E402
from engine.setup import api as setup_api  # noqa: E402

SETTINGS_DIR = Path(os.environ.get("XDG_CONFIG_HOME", "/data/config")) / "Lastbook"
SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
paths.DATA.mkdir(parents=True, exist_ok=True)
(paths.DATA / 'derived').mkdir(parents=True, exist_ok=True)
INIT_LOCK = threading.Lock()
INITIALIZED = False


def library_ready() -> bool:
    return (paths.LIB / "catalog.json").is_file()


def ensure_engine() -> None:
    global INITIALIZED
    if INITIALIZED:
        return
    with INIT_LOCK:
        if not INITIALIZED:
            server.init()
            INITIALIZED = True


# Complete any library activation staged by a previous setup run before the
# engine opens files. LASTBOOK_DATA remains pinned to the persistent volume.
data, note = setup_api.startup(SETTINGS_DIR, only=paths.DATA)
if note:
    setup_api.opened(SETTINGS_DIR, data or paths.DATA, note)

if library_ready():
    setup_api.configure(
        mode="manage",
        settings_dir=SETTINGS_DIR,
        default_parent=paths.DATA.parent,
        current=paths.DATA,
    )
    ensure_engine()
else:
    # The upstream first-run screen chooses a pack and downloads it into
    # /data/LastbookData. This is its native setup workflow, not a fake shell.
    setup_api.configure(
        mode="first-run",
        settings_dir=SETTINGS_DIR,
        default_parent=paths.DATA.parent,
        current=None,
        on_finish=lambda folder: None,
    )


# The upstream server normally accepts only localhost/IP Host headers and uses
# a one-time LAN key. In Umbrel, the authenticated app_proxy is the boundary:
# it reaches this container over a private Docker network and supplies XFF.
_original_host_ok = server.Handler.host_ok
_original_lan_ok = server.Handler.lan_ok


def _private_proxy_request(handler) -> bool:
    if os.environ.get("LASTBOOK_UMBREL_PROXY_AUTH") != "1":
        return False
    if not handler.headers.get("X-Forwarded-For"):
        return False
    try:
        peer = ipaddress.ip_address(handler.client_address[0])
    except ValueError:
        return False
    return peer.is_private or peer.is_loopback


def _host_ok(handler) -> bool:
    if _private_proxy_request(handler):
        return True
    return _original_host_ok(handler)


def _lan_ok(handler):
    if _private_proxy_request(handler):
        return True
    return _original_lan_ok(handler)


server.Handler.host_ok = _host_ok
server.Handler.lan_ok = _lan_ok


_original_get = server.Handler.do_GET


def _get(handler) -> None:
    path = urlsplit(handler.path).path
    if path in ("/", "/index.html"):
        if library_ready():
            ensure_engine()
        else:
            handler.path = "/ui/setup.html"
    elif library_ready() and not path.startswith("/api/setup/"):
        ensure_engine()
    return _original_get(handler)


server.Handler.do_GET = _get


# The desktop shell normally relaunches itself after setup. Do the same inside
# the container so startup applies the verified, staged pack atomically.
_original_finish = setup_api.Setup.finish


def _finish(self):
    result = _original_finish(self)
    if result.get("ok"):
        def restart() -> None:
            os.execv(sys.executable, [sys.executable, str(ROOT / "umbrel_server.py"), *sys.argv[1:]])
        threading.Timer(1.0, restart).start()
    return result


setup_api.Setup.finish = _finish

# Bind on the container interface. No host port is published by compose;
# browser traffic arrives through Umbrel's authenticated reverse proxy.
server.serve(8890, lan=True)
