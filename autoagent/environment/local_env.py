import subprocess
import json
import os
from pathlib import Path
import platform
import os.path as osp
from autoagent.environment.docker_env import DockerConfig
class LocalEnv:
    def __init__(self, docker_config: DockerConfig = None):
        if docker_config is None:
            self.docker_workplace = os.getcwd()
            if self.docker_workplace.endswith("autoagent"):
                self.docker_workplace = os.path.dirname(self.docker_workplace)
            self.local_workplace = self.docker_workplace
        else:
            self.local_workplace = osp.join(docker_config.local_root, docker_config.workplace_name)
            self.docker_workplace = osp.join(docker_config.local_root, docker_config.workplace_name)
            os.makedirs(self.local_workplace, exist_ok=True)
        self.conda_sh = self._find_conda_sh()

    
    def _find_conda_sh(self) -> str:
        """
        Find conda.sh file location across different environments
        """

        # 1. Try common locations based on OS
        possible_paths = []
        home = str(Path.home())
        
        if platform.system() == "Windows":
            possible_paths.extend([
                Path(home) / "Anaconda3" / "etc" / "profile.d" / "conda.sh",
                Path(home) / "miniconda3" / "etc" / "profile.d" / "conda.sh",
                Path(home) / "micromamba" / "etc" / "profile.d" / "conda.sh",
            ])
        else:  # Linux and MacOS
            possible_paths.extend([
                Path(home) / "anaconda3" / "etc" / "profile.d" / "conda.sh",
                Path(home) / "miniconda3" / "etc" / "profile.d" / "conda.sh",
                Path(home) / "micromamba" / "etc" / "profile.d" / "conda.sh",
                Path("/opt/conda/etc/profile.d/conda.sh"),  # Docker containers
                Path("/usr/local/conda/etc/profile.d/conda.sh"),
            ])
            
            # For Linux, also check root installations
            if platform.system() == "Linux":
                possible_paths.extend([
                    Path("/opt/anaconda3/etc/profile.d/conda.sh"),
                    Path("/opt/miniconda3/etc/profile.d/conda.sh"),
                    Path("/opt/micromamba/etc/profile.d/conda.sh"),
                ])

        # Check all possible paths
        for path in possible_paths:
            if path.exists():
                return str(path)

        # 2. Try to find using conda info command
        try:
            result = subprocess.run(['conda', 'info', '--base'], 
                                 capture_output=True, 
                                 text=True)
            if result.returncode == 0:
                base_path = result.stdout.strip()
                conda_sh = Path(base_path) / "etc" / "profile.d" / "conda.sh"
                if conda_sh.exists():
                    return str(conda_sh)
        except (subprocess.SubprocessError, OSError):
            pass

        # 3. If all fails, return None and handle in run_command
        return None
    def run_command(self, command, stream_callback=None):
        assert self.conda_sh is not None, "Conda.sh not found"
        modified_command = f"/bin/bash -c 'source {self.conda_sh} && conda activate auto && cd {self.docker_workplace} && {command}'"
        process = subprocess.Popen(modified_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        output = ''
        while True:
            line = process.stdout.readline()
            if not line and process.poll() is not None:
                break
            output += line
            # 立即发送每一行输出

        # 发送最终的完整响应
        response = {
            "status": process.poll(),
            "result": output
        }
        return response
    def _convert_local_to_docker(self, path):
        return path
    
    def _convert_docker_to_local(self, path):
        return path
    
if __name__ == "__main__":
    # print(str(Path.home()))
    local_env = LocalEnv()
    print(local_env.conda_sh)
