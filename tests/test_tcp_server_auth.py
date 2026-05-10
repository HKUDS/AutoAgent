import json
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def _connect(port: int, timeout: float = 5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            return socket.create_connection(("127.0.0.1", port), timeout=0.5)
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("tcp server did not start")


def _read_all(sock: socket.socket) -> str:
    data = b""
    while True:
        chunk = sock.recv(65535)
        if not chunk:
            break
        data += chunk
    return data.decode(errors="replace")


def test_environment_tcp_server_requires_command_token(tmp_path):
    conda = tmp_path / "conda"
    profile = conda / "etc" / "profile.d"
    profile.mkdir(parents=True)
    (profile / "conda.sh").write_text("conda(){ return 0; }\n")
    workplace = tmp_path / "workplace"
    workplace.mkdir()
    marker = tmp_path / "unauthorized_marker"
    port = 19191
    server = Path(__file__).resolve().parents[1] / "autoagent" / "environment" / "tcp_server.py"
    proc = subprocess.Popen(
        [
            sys.executable,
            str(server),
            "--workplace",
            str(workplace).lstrip("/"),
            "--conda_path",
            str(conda),
            "--port",
            str(port),
            "--token",
            "expected-token",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        sock = _connect(port)
        sock.sendall(f"echo bad > {marker}".encode())
        sock.shutdown(socket.SHUT_WR)
        response = _read_all(sock)
        assert "valid command token required" in response or "command request must be JSON" in response
        assert not marker.exists()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_environment_tcp_server_accepts_valid_command_token(tmp_path):
    conda = tmp_path / "conda"
    profile = conda / "etc" / "profile.d"
    profile.mkdir(parents=True)
    (profile / "conda.sh").write_text("conda(){ return 0; }\n")
    workplace = tmp_path / "workplace"
    workplace.mkdir()
    marker = tmp_path / "authorized_marker"
    port = 19192
    server = Path(__file__).resolve().parents[1] / "autoagent" / "environment" / "tcp_server.py"
    proc = subprocess.Popen(
        [
            sys.executable,
            str(server),
            "--workplace",
            str(workplace).lstrip("/"),
            "--conda_path",
            str(conda),
            "--port",
            str(port),
            "--token",
            "expected-token",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        sock = _connect(port)
        sock.sendall(json.dumps({"token": "expected-token", "command": f"echo ok > {marker}"}).encode())
        sock.shutdown(socket.SHUT_WR)
        response = _read_all(sock)
        assert '"status": 0' in response
        assert marker.read_text().strip() == "ok"
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
