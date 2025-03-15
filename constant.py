import os
from dotenv import load_dotenv
import platform
# utils:
load_dotenv()  # 加载.env文件
def str_to_bool(value):
    """convert string to bool"""
    true_values = {'true', 'yes', '1', 'on', 't', 'y'}
    false_values = {'false', 'no', '0', 'off', 'f', 'n'}

    if isinstance(value, bool):
        return value

    if value == None:
        return None

    value = str(value).lower().strip()
    if value in true_values:
        return True
    if value in false_values:
        return False
    return True  # default return True


DOCKER_WORKPLACE_NAME = os.getenv('DOCKER_WORKPLACE_NAME', 'workplace')
GITHUB_AI_TOKEN = os.getenv('GITHUB_AI_TOKEN', None)
AI_USER = os.getenv('AI_USER', "tjb-tech")
LOCAL_ROOT = os.getenv('LOCAL_ROOT', os.getcwd())

# Add Ollama configuration settings
OLLAMA_ENABLED = str_to_bool(os.getenv('OLLAMA_ENABLED', False))
OLLAMA_BASE_URL = os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'llama3')

# Add local storage settings
LOCAL_STORAGE_ENABLED = str_to_bool(os.getenv('LOCAL_STORAGE_ENABLED', True))
LOCAL_STORAGE_PATH = os.getenv('LOCAL_STORAGE_PATH', './workspace')

DEBUG = str_to_bool(os.getenv('DEBUG', False))

DEFAULT_LOG = str_to_bool(os.getenv('DEFAULT_LOG', False))
LOG_PATH = os.getenv('LOG_PATH', None)
EVAL_MODE = str_to_bool(os.getenv('EVAL_MODE', False))
BASE_IMAGES = os.getenv('BASE_IMAGES', None)

def get_architecture():
    machine = platform.machine().lower()
    if 'x86' in machine or 'amd64' in machine or 'i386' in machine:
        return "tjbtech1/metachain:amd64_latest"
    elif 'arm' in machine:
        return "tjbtech1/metachain:latest"
    else:
        return "tjbtech1/metachain:latest"
if BASE_IMAGES is None:
    BASE_IMAGES = get_architecture()

COMPLETION_MODEL = os.getenv('COMPLETION_MODEL', "claude-3-5-sonnet-20241022")
EMBEDDING_MODEL = os.getenv('EMBEDDING_MODEL', "text-embedding-3-small")

MC_MODE = str_to_bool(os.getenv('MC_MODE', True))

# add Env for function call and non-function call

FN_CALL = str_to_bool(os.getenv('FN_CALL', None))
API_BASE_URL = os.getenv('API_BASE_URL', None)
ADD_USER = str_to_bool(os.getenv('ADD_USER', None))



NOT_SUPPORT_SENDER = ["mistral", "groq"]
MUST_ADD_USER = ["deepseek-reasoner", "o1-mini", "deepseek-r1"]

NOT_SUPPORT_FN_CALL = ["o1-mini", "deepseek-reasoner", "deepseek-r1", "llama", "grok-2"]
NOT_USE_FN_CALL = [ "deepseek-chat"] + NOT_SUPPORT_FN_CALL

if ADD_USER is None:
    ADD_USER = False
    for model in MUST_ADD_USER:
        if model in COMPLETION_MODEL:
            ADD_USER = True
            break

if FN_CALL is None:
    FN_CALL = True
    for model in NOT_USE_FN_CALL:
        if model in COMPLETION_MODEL:
            FN_CALL = False
            break

NON_FN_CALL = False
for model in NOT_SUPPORT_FN_CALL:
    if model in COMPLETION_MODEL:
        NON_FN_CALL = True
        break


if EVAL_MODE:
    DEFAULT_LOG = False

# print(FN_CALL, NON_FN_CALL, ADD_USER)
