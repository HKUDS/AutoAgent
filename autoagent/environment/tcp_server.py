import socket
import subprocess
import json
import argparse
import hmac

parser = argparse.ArgumentParser()
parser.add_argument("--workplace", type=str, default=None)
parser.add_argument("--conda_path", type=str, default=None)
parser.add_argument("--port", type=int, default=None)
parser.add_argument("--token", type=str, default=None)
args = parser.parse_args()


def receive_all(conn, buffer_size=4096):
    data = b""
    while True:
        part = conn.recv(buffer_size)
        data += part
        if len(part) < buffer_size:
            # 如果接收的数据小于缓冲区大小，可能已经接收完毕
            break
    return data.decode()


def parse_command_request(raw_request: str, expected_token: str) -> str:
    try:
        request = json.loads(raw_request)
    except json.JSONDecodeError as exc:
        raise ValueError("command request must be JSON") from exc
    if not isinstance(request, dict):
        raise ValueError("command request must be a JSON object")
    token = request.get("token")
    command = request.get("command")
    if not isinstance(token, str) or not hmac.compare_digest(token, expected_token):
        raise PermissionError("valid command token required")
    if not isinstance(command, str) or not command:
        raise ValueError("command must be a non-empty string")
    return command


if __name__ == "__main__":
    assert args.workplace is not None, "Workplace is not specified"
    assert args.conda_path is not None, "Conda path is not specified"
    assert args.port is not None, "Port is not specified"
    assert args.token is not None and args.token, "Command token is not specified"
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("0.0.0.0", args.port))
    server.listen(1)

    print(f"Listening on port {args.port}...")
    while True:
        conn, addr = server.accept()
        print(f"Connection from {addr}")
        while True:
            raw_request = receive_all(conn)
            if not raw_request:
                break
            try:
                command = parse_command_request(raw_request, args.token)
            except Exception as e:
                error_response = {
                    "type": "final",
                    "status": -1,
                    "result": f"Rejected command request: {str(e)}"
                }
                conn.send(json.dumps(error_response).encode() + b"\n")
                break

            # Execute the command
            try:
                modified_command = f"/bin/bash -c 'source {args.conda_path}/etc/profile.d/conda.sh && conda activate autogpt && cd /{args.workplace} && {command}'"
                process = subprocess.Popen(modified_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                output = ''
                while True:
                    line = process.stdout.readline()
                    if not line and process.poll() is not None:
                        break
                    output += line
                    # 立即发送每一行输出
                    chunk_response = {
                        "type": "chunk",
                        "data": line
                    }
                    conn.send(json.dumps(chunk_response).encode() + b"\n")  # 添加换行符作为分隔符

                # 发送最终的完整响应
                final_response = {
                    "type": "final",
                    "status": process.poll(),
                    "result": output
                }
                conn.send(json.dumps(final_response).encode() + b"\n")
            except Exception as e:
                error_response = {
                    "type": "final",
                    "status": -1,
                    "result": f"Error running command: {str(e)}"
                }
                conn.send(json.dumps(error_response).encode() + b"\n")

        conn.close()
