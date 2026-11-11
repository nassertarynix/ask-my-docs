"""A tiny local web server for tests: real video files (made with ffmpeg), a feed that works as a playlist, a throttled route so
a download lasts long enough to be cancelled, and routes that fail on purpose. Nothing here touches the internet."""
from __future__ import annotations

import subprocess
import threading
import time
from urllib.parse import urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def make_video(path: Path, seconds: int, size: str = "640x360", crf: int = 18) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=25:duration={seconds}", "-f", "lavfi",
                    "-i", f"sine=frequency=440:duration={seconds}", "-c:v", "libx264", "-preset", "ultrafast", "-crf", str(crf), "-pix_fmt",
                    "yuv420p", "-c:a", "aac", "-shortest", str(path)], check=True)


class MediaServer:
    def __init__(self, root: Path, throttle_bps: int = 150_000) -> None:
        self.root, self.throttle_bps = root, throttle_bps
        self.clip = (root / "clip.mp4").read_bytes()
        self.slow = (root / "slow.mp4").read_bytes()
        self.flaky_failures = 0  # how many of the next /flaky.mp4 requests to drop
        self.proxied = 0  # requests that arrived as proxy requests (absolute URLs), so this server also works as a tiny forward proxy
        self.hits: dict[str, int] = {}
        self.headers_seen: dict[str, dict[str, str]] = {}  # the request headers of the latest request per path
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # silence
                pass

            def _send(self, code: int, body: bytes, ctype: str) -> None:
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):  # noqa: N802
                if self.path.startswith("http://"):
                    outer.proxied += 1
                path = urlsplit(self.path).path
                outer.hits[path] = outer.hits.get(path, 0) + 1
                outer.headers_seen[path] = {k.lower(): v for k, v in self.headers.items()}
                if path == "/clip.mp4" or path.startswith("/v/"):  # /v/<any name>.mp4 is the same clip under a nicer title
                    return self._send(200, outer.clip, "video/mp4")
                if path == "/slow.mp4" or path.startswith("/s/"):  # /s/<any name>.mp4: the throttled one
                    self.send_response(200)
                    self.send_header("Content-Type", "video/mp4")
                    self.send_header("Content-Length", str(len(outer.slow)))
                    self.end_headers()
                    chunk = max(1, outer.throttle_bps // 10)
                    try:
                        for i in range(0, len(outer.slow), chunk):
                            self.wfile.write(outer.slow[i:i + chunk])
                            self.wfile.flush()
                            time.sleep(0.1)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                    return
                if path == "/flaky.mp4":
                    if outer.flaky_failures > 0:
                        outer.flaky_failures -= 1
                        self.connection.close()  # drop the connection mid-request: a network failure
                        return
                    return self._send(200, outer.clip, "video/mp4")
                if path in ("/feed.xml", "/evil.xml", "/halfbad.xml"):
                    titles = {"/feed.xml": ["First clip", "Second clip"], "/evil.xml": ["<img src=x onerror=window.__pwned=1>", "<b>bold</b> & more"],
                              "/halfbad.xml": ["Good one", "Broken one", "Another good one"]}[path]
                    items = "".join(f'<item><title>{t.replace("&", "&amp;").replace("<", "&lt;")}</title><enclosure url="http://{self.headers["Host"]}/{"missing.mp4" if t == "Broken one" else "clip.mp4"}" type="video/mp4"/></item>' for t in titles)
                    return self._send(200, f'<?xml version="1.0"?><rss version="2.0"><channel><title>Test feed</title>{items}</channel></rss>'.encode(), "application/rss+xml")
                self._send(404, b"not found", "text/plain")

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def start(self) -> "MediaServer":
        self.thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"
