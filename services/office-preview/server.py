"""Private Unix-socket converter. Run only in the network-less preview container."""

import os
import signal
import subprocess
import tempfile
import threading
from contextlib import suppress
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingMixIn, UnixStreamServer

SOCKET = "/run/office-preview/preview.sock"
MAX_INPUT = 25 * 1024 * 1024
MAX_OUTPUT = 40 * 1024 * 1024
SLOT = threading.BoundedSemaphore(1)
PROFILE = b"""<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting">
<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
<prop oor:name="SecureURL" oor:op="fuse"><value/></prop>
</item></oor:items>"""


def convert(content: bytes, extension: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="word-preview-") as directory:
        work = Path(directory)
        profile = work / "profile"
        (profile / "user").mkdir(parents=True)
        (profile / "user/registrymodifications.xcu").write_bytes(PROFILE)
        source = work / f"input.{extension}"
        source.write_bytes(content)
        command = [
            "/usr/bin/libreoffice",
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless",
            "--nologo",
            "--nodefault",
            "--norestore",
            "--unaccept=all",
            "--convert-to",
            'pdf:writer_pdf_Export:{"ExportFormFields":{"type":"boolean","value":"false"}}',
            "--outdir",
            str(work),
            str(source),
        ]
        process = subprocess.Popen(
            command,
            cwd=work,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            process.wait(timeout=35)
        except subprocess.TimeoutExpired:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise TimeoutError("Conversion timed out") from None
        finally:
            # Also terminate any surviving children before deleting the job directory.
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
        output = work / "input.pdf"
        if process.returncode != 0 or not output.is_file():
            raise ValueError("Document could not be converted")
        if not 0 < output.stat().st_size <= MAX_OUTPUT:
            raise ValueError("Converted document exceeds limits")
        result = output.read_bytes()
        if not result.startswith(b"%PDF-"):
            raise ValueError("Invalid conversion output")
        return result


class Handler(BaseHTTPRequestHandler):
    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, format: str, *args: object) -> None:
        # Never log employee file names, contents, paths or request bodies.
        pass

    def reply(self, status: int, body: bytes, content_type: str = "text/plain") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with suppress(BrokenPipeError, ConnectionResetError):
            self.wfile.write(body)

    def do_GET(self) -> None:
        self.reply(200 if self.path == "/ready" else 404, b"ready")

    def do_POST(self) -> None:
        if self.path not in {"/doc", "/docx"}:
            self.reply(415, b"Unsupported document")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if self.headers.get("Transfer-Encoding") or not 0 < length <= MAX_INPUT:
            self.reply(413, b"Invalid input size")
            return
        if not SLOT.acquire(blocking=False):
            self.reply(503, b"Converter busy; retry later")
            return
        try:
            content = self.rfile.read(length)
            if len(content) != length:
                self.reply(400, b"Incomplete document")
                return
            extension = self.path[1:]
            valid = (
                content.startswith(b"PK")
                if extension == "docx"
                else (
                    content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
                    or content.lstrip().startswith(b"{\\rtf")
                )
            )
            if not valid:
                self.reply(422, b"Invalid document signature")
                return
            self.reply(200, convert(content, extension), "application/pdf")
        except TimeoutError:
            self.reply(504, b"Conversion timed out")
        except ValueError:
            self.reply(422, b"Unable to convert document")
        except OSError:
            self.reply(503, b"Conversion unavailable")
        finally:
            SLOT.release()


class Server(ThreadingMixIn, UnixStreamServer):
    daemon_threads = True
    request_queue_size = 4


if __name__ == "__main__":
    socket_path = Path(SOCKET)
    if socket_path.is_socket():
        socket_path.unlink()
    with Server(SOCKET, Handler) as server:
        # Only API and converter mount this private volume. API mounts it read-only.
        socket_path.chmod(0o666)
        server.serve_forever()
