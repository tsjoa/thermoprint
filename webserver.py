#!/usr/bin/env python3
"""
Minimal local web page for printing text labels to the BLE thermal printer.

Takes the same plain text input as `thermoprint label "<text>"` on the
command line, and runs that exact command as a subprocess.
"""

import json
import os
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8420
REPO_DIR = os.path.dirname(os.path.abspath(__file__))
UV_BIN = shutil.which("uv") or os.path.expanduser("~/.local/bin/uv")
PRINTER_ADDRESS = "5E:55:09:26:72:D3"  # P12_Z72D3_BLE

PAGE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Thermoprint</title>
<style>
  body { font-family: sans-serif; max-width: 420px; margin: 40px auto; }
  textarea { width: 100%; font-size: 1.1rem; padding: 8px; box-sizing: border-box; }
  button { margin-top: 10px; padding: 8px 16px; font-size: 1rem; }
  #status { margin-top: 12px; white-space: pre-wrap; font-family: monospace; }
</style>
</head>
<body>
  <h2>Print a label</h2>
  <textarea id="text" rows="3" placeholder="Label text"></textarea>
  <br>
  <button id="printBtn">Print</button>
  <div id="status"></div>
  <script>
    document.getElementById('printBtn').onclick = async () => {
      const text = document.getElementById('text').value;
      const status = document.getElementById('status');
      status.textContent = 'Printing...';
      try {
        const res = await fetch('/print', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({text})
        });
        const data = await res.json();
        status.textContent = data.ok ? 'Printed!' : ('Error: ' + data.error);
      } catch (e) {
        status.textContent = 'Error: ' + e;
      }
    };
  </script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            body = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/print":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)

        try:
            data = json.loads(raw or b"{}")
            text = (data.get("text") or "").strip()
            if not text:
                raise ValueError("Text is empty")

            result = subprocess.run(
                [UV_BIN, "run", "thermoprint", "label", text, "-a", PRINTER_ADDRESS],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0:
                raise RuntimeError((result.stdout + result.stderr).strip())

            response = {"ok": True}
        except Exception as e:
            response = {"ok": False, "error": str(e)}

        body = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


def main():
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Thermoprint web UI running at http://0.0.0.0:{PORT} (reachable on the LAN)")
    server.serve_forever()


if __name__ == "__main__":
    main()
