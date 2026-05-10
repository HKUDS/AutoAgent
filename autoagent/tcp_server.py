import argparse
import hmac
import json
import socket
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--workplace", type=str, default=None)
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
    assert args.token is not None and args.token, "Command token is not specified"
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("0.0.0.0", 12345))
    server.listen(1)

    print("Listening on port 12345...")
    while True:
        conn, addr = server.accept()
        print(f"Connection from {addr}")
        while True:
            raw_request = receive_all(conn)
            if not raw_request:
                break
            try:
                command = parse_command_request(raw_request, args.token)
                modified_command = f"/bin/bash -c 'source /home/user/micromamba/etc/profile.d/conda.sh && conda activate autogpt && cd /{args.workplace} && {command}'"
                process = subprocess.Popen(modified_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                output = ''
                while True:
                    line = process.stdout.readline()
                    if not line and process.poll() is not None:
                        break
                    output += line
                    print(line, end='')

                exit_code = process.wait()
            except Exception as e:
                exit_code = -1
                output = f"Rejected or failed command request: {str(e)}"

            # Create a JSON response
            response = {
                "status": exit_code,
                "result": output
            }

            # Send the JSON response
            conn.send(json.dumps(response).encode())
        conn.close()
