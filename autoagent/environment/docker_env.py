import os
import os.path as osp
import subprocess
from constant import BASE_IMAGES, AI_USER, GITHUB_AI_TOKEN
import time
import socket
import json
import secrets
from pathlib import Path
import shutil
wd = Path(__file__).parent.resolve()
from dataclasses import dataclass, field
from typing import Optional, Union, Dict
from functools import update_wrapper
from inspect import signature
@dataclass
class DockerConfig: 
    container_name: str
    workplace_name: str 
    communication_port: int # 12345
    conda_path: str # /root/miniconda3
    test_pull_name: str = field(default='main')
    task_name: Optional[str] = field(default=None)
    git_clone: bool = field(default=False)
    setup_package: Optional[str] = field(default=None)
    local_root: str = field(default=os.getcwd())
    

class DockerEnv:
    def __init__(self, config: Union[DockerConfig, Dict]):
        if isinstance(config, Dict):
            config = DockerConfig(**config)
        self.workplace_name = config.workplace_name
        self.local_workplace = osp.join(config.local_root, config.workplace_name)
        self.docker_workplace = f"/{config.workplace_name}"
        self.container_name = config.container_name
        self.test_pull_name = config.test_pull_name
        self.task_name = config.task_name
        self.git_clone = config.git_clone
        self.setup_package = config.setup_package
        self.communication_port = config.communication_port
        self.command_token = secrets.token_hex(32)
        self.conda_path = config.conda_path
        
    def init_container(self):
        container_check_command = ["docker", "ps", "-a", "--filter", f"name={self.container_name}", "--format", "{{.Names}}"]
        existing_container = subprocess.run(container_check_command, capture_output=True, text=True)
        os.makedirs(self.local_workplace, exist_ok=True)
        
        if not osp.exists(osp.join(self.local_workplace, 'tcp_server.py')):
            shutil.copy(osp.join(wd, 'tcp_server.py'), self.local_workplace)
            assert osp.exists(osp.join(self.local_workplace, 'tcp_server.py')), "Failed to copy tcp_server.py to the local workplace"
        if self.setup_package is not None:
            unzip_command = ["tar", "-xzvf", f"packages/{self.setup_package}.tar.gz", "-C", self.local_workplace]
            subprocess.run(unzip_command)
        if self.git_clone:
            if not os.path.exists(os.path.join(self.local_workplace, 'AutoAgent')):
                git_command = ["cd", self.local_workplace, "&&", "git", "clone", "-b", self.test_pull_name, f"https://{AI_USER}:{GITHUB_AI_TOKEN}@github.com/HKUDS/AutoAgent.git"]
                print(git_command)
                git_command = " ".join(git_command)
                
                result = subprocess.run(git_command, shell=True)
                if result.returncode != 0:
                    raise Exception(f"Failed to clone the repository. The error is: {result.stdout}")
                copy_env_command = f"cp .env {self.local_workplace}/AutoAgent"
                result = subprocess.run(copy_env_command, shell=True, capture_output=True, text=True)
                if result.returncode != 0:
                    raise Exception(f"Failed to copy .env file to the AutoAgent directory. Error: {result.stderr}")
                # create a new branch
            new_branch_name = f"{self.test_pull_name}_{self.task_name}"
            create_branch_command = f"cd {self.local_workplace}/AutoAgent && git checkout -b {new_branch_name}"
            result = subprocess.run(create_branch_command, shell=True, capture_output=True, text=True)
            if result.returncode != 0:
                print(Exception(f"Failed to create and switch to new branch. Error: {result.stderr}"))
                switch_branch_command = f"cd {self.local_workplace}/AutoAgent && git checkout {new_branch_name}"
                result = subprocess.run(switch_branch_command, shell=True, capture_output=True, text=True)
                if result.returncode != 0:
                    raise Exception(f"Failed to switch to new branch. Error: {result.stderr}")
                else:
                    print(f"Successfully switched to new branch: {new_branch_name}")
            else:
                print(f"Successfully created and switched to new branch: {new_branch_name}")

        if existing_container.stdout.strip() == self.container_name:
            # check if the container is running
            running_check_command = ["docker", "ps", "--filter", f"name={self.container_name}", "--format", "{{.Names}}"]
            running_container = subprocess.run(running_check_command, capture_output=True, text=True)

            if running_container.stdout.strip() == self.container_name:
                print(f"Container '{self.container_name}' is already running. Skipping creation.")
                return  # container is already running, skip creation
            else:
                # container exists but is not running, start it
                start_command = ["docker", "start", self.container_name]
                subprocess.run(start_command)
                print(f"Container '{self.container_name}' has been started.")
                return
        
        # if the container does not exist, create and start a new container
        docker_command = [
            "docker", "run", "-d", "--name", self.container_name, "--user", "root",
            "-v", f"{self.local_workplace}:{self.docker_workplace}",
            "-w", f"{self.docker_workplace}", "-p", f"{self.communication_port}:{self.communication_port}", BASE_IMAGES,
            "/bin/bash", "-c", 
            f"python3 {self.docker_workplace}/tcp_server.py --workplace {self.workplace_name} --conda_path {self.conda_path} --port {self.communication_port} --token {self.command_token}"
        ]
        # execute the docker command
        result = subprocess.run(docker_command, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Failed to start container: {result.stderr}")
        if self.wait_for_container_ready(timeout=60):
            print(f"Container '{self.container_name}' has been created and started.")
    def wait_for_container_ready(self, timeout=30):
        """using subprocess to check if the container is running"""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            result = subprocess.run(
                ["docker", "inspect", "--format", "{{.State.Running}}", self.container_name],
                capture_output=True,
                text=True
            )
            
            if result.returncode == 0 and "true" in result.stdout.lower():
                # 额外检查 tcp_server 是否运行
                try:
                    port_info = check_container_ports(self.container_name)
                    assert port_info and (port_info[0] == port_info[1])
                    available_port = port_info[0]
                    self.communication_port = available_port
                    result = self.run_command('ps aux')
                    if "tcp_server.py" in result['result']:
                        return True
                except Exception as e:
                    pass
                
            time.sleep(1)
            
        raise TimeoutError(f"Container {self.container_name} failed to start within {timeout} seconds")
    def stop_container(self):
        stop_command = ["docker", "stop", self.container_name]
        result = subprocess.run(stop_command, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Failed to stop container: {result.stderr}")
    
    def run_command(self, command, stream_callback=None):
        """
        communicate with docker container and execute command, support stream output
        
        Args:
            command: the command to execute
            stream_callback: optional callback function, for handling stream output
                            the function signature should be callback(text: str)
        
        Returns:
            dict: the complete JSON result returned by the docker container
        """
        hostname = 'localhost'
        port = self.communication_port
        buffer_size = 4096
        
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.connect((hostname, port))
            payload = json.dumps({"token": self.command_token, "command": command})
            s.sendall(payload.encode())
            
            partial_line = ""
            while True:
                chunk = s.recv(buffer_size)
                if not chunk:
                    break
                    
                # add new received data to the unfinished data
                data = partial_line + chunk.decode('utf-8')
                lines = data.split('\n')
                
                # except the last line, process all complete lines
                for line in lines[:-1]:
                    if line:
                        try:
                            response = json.loads(line)
                            if response['type'] == 'chunk':
                                # process stream output
                                if stream_callback:
                                    stream_callback(response['data'])
                            elif response['type'] == 'final':
                                # return the final result
                                return {
                                    'status': response['status'],
                                    'result': response['result']
                                }
                        except json.JSONDecodeError:
                            print(f"Invalid JSON: {line}")
                
                # save the possibly unfinished last line
                partial_line = lines[-1]
                
        # if the loop ends normally without receiving a final response
        return {
            'status': -1,
            'result': 'Connection closed without final response'
        }
    
def with_env(env: DockerEnv):
    """将env注入到工具函数中的装饰器"""
    def decorator(func):
        def wrapped(*args, **kwargs):
            return func(env=env, *args, **kwargs)
        
        # 保留原始函数的所有属性
        update_wrapper(wrapped, func)
        # 修改signature，移除env参数
        wrapped.__signature__ = signature(func).replace(
            parameters=[p for p in signature(func).parameters.values() if p.name != 'env']
        )
        if func.__doc__:
            try:
                if '{docker_workplace}' in func.__doc__:
                    wrapped.__doc__ = func.__doc__.format(docker_workplace=env.docker_workplace)
                else:
                    wrapped.__doc__ = func.__doc__
                if '{local_workplace}' in func.__doc__:
                    wrapped.__doc__ = func.__doc__.format(local_workplace=env.local_workplace)
                else:
                    wrapped.__doc__ = func.__doc__
            except (KeyError, IndexError, ValueError):
                # 如果格式化失败（没有占位符），保持原始文档
                wrapped.__doc__ = func.__doc__
        return wrapped
    return decorator

def check_container_ports(container_name: str):
    """
    check if the container has port mapping
    return format:
    - if the container exists and has port mapping: '0.0.0.0:12345->12345/tcp'
    - if the container does not exist or does not have port mapping: None
    """
    # use docker ps to check the container and get the port information
    container_check_command = [
        "docker", "ps", "-a",
        "--filter", f"name={container_name}",
        "--format", "{{.Ports}}"
    ]
    
    result = subprocess.run(container_check_command, capture_output=True, text=True)
    ports_info = result.stdout.strip()
    
    if not ports_info:
        return None
        
    # only process the mapped ports
    for mapping in ports_info.split(','):
        mapping = mapping.strip()
        if '->' in mapping:
            # parse '0.0.0.0:12345->12345/tcp' to (12345, 12345)
            host_part, container_part = mapping.split('->')
            host_port = host_part.split(':')[1]  # get '12345' from '0.0.0.0:12345'
            container_port = container_part.split('/')[0]  # get '12345' from '12345/tcp'
            return (int(host_port), int(container_port))  # convert to integers
    return None

def check_container_exist(container_name: str):
    container_check_command = [
        "docker", "ps", "-a",
        "--filter", f"name={container_name}",
        "--format", "{{.Names}}"
    ]
    result = subprocess.run(container_check_command, capture_output=True, text=True)
    return container_name in result.stdout.strip()

def check_container_running(container_name: str):
    container_check_command = [
        "docker", "ps",
        "--filter", f"name={container_name}",
        "--format", "{{.Names}}"
    ]
    result = subprocess.run(container_check_command, capture_output=True, text=True)
    return container_name in result.stdout.strip()
