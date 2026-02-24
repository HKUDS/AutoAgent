import atexit
import base64
import io
import json
import multiprocessing
import time
import uuid

import browsergym.core  # noqa F401 (we register the openended task as a gym environment)
import gymnasium as gym
import html2text
import numpy as np
import tenacity
from browsergym.utils.obs import flatten_dom_to_str
from PIL import Image
from autoagent.util import debug_print
from autoagent.logger import LoggerManager
import inspect
import textwrap

from .shutdown_listener import should_continue, should_exit
from .tenacity_stop import stop_if_should_exit
from datetime import datetime
from pathlib import Path
from browsergym.core.action.functions import goto, page, get_elem_by_bid, demo_mode, tab_focus
import os
from typing import Dict, Union, cast, Literal
from playwright.sync_api import Page, Download
from autoagent.io_utils import read_file
from autoagent.environment.mdconvert import _get_page_markdown
from autoagent.environment.browser_cookies import convert_cookies_to_python
from autoagent.environment.cookies_data import COOKIES_LIST
# from constant import DOCKER_WORKPLACE_NAME, LOCAL_ROOT
from functools import update_wrapper
from inspect import signature
import types    
import sys
import tempfile
VIEWPORT = {"width": 1280, "height": 720}

BROWSER_EVAL_GET_GOAL_ACTION = 'GET_EVAL_GOAL'
BROWSER_EVAL_GET_REWARDS_ACTION = 'GET_EVAL_REWARDS'
class BrowserInitException(Exception):
    def __init__(self, message='Failed to initialize browser environment'):
        super().__init__(message)
def _local_to_docker(local_path: str):
    """
    Convert a local path to a docker path
    local_path: the local path to convert, like `{local_workplace}/downloads/xxx`
    docker_path: the docker path to convert, like `{docker_workplace}/downloads/xxx`

    Examples:
        _local_to_docker('/Users/tangjiabin/Documents/reasoning/autoagent/workplace_gaia_eval/downloads/xxx')
    """
    local_workplace = None
    docker_workplace = None
    assert local_workplace in local_path, f"local_path must contain {local_workplace}"
    return local_path.replace(local_workplace, docker_workplace)
def _visit_page(url: str): 
    """
    Visit a page, including downloading files based on the url

    Examples:
        _visit_page('https://archive.org/download/higpt_stage2/instruct_ds_dblp.tar.gz')
    """
    # def _local_to_docker(local_path: str):
    #     """
    #     Convert a local path to a docker path
    #     local_path: the local path to convert, like `{LOCAL_ROOT}/{DOCKER_WORKPLACE_NAME}/downloads/xxx`
    #     docker_path: the docker path to convert, like `/{DOCKER_WORKPLACE_NAME}/downloads/xxx`
    #     """
    #     assert LOCAL_ROOT in local_path, f"local_path must contain {LOCAL_ROOT}"
    #     return local_path.replace(LOCAL_ROOT, '')
    try:
        # 尝试作为普通网页访问
        page.context.add_cookies(COOKIES_LIST)
        # goto(url)
        page.set_extra_http_headers({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
        })
        page.goto(url, timeout=6000)
        if page.get_by_text("Verify you are human by completing the action below.").count() > 0:
            _checkMeetChallenge()
            # 等待页面完全加载
            # 增加等待时间，确保页面完全加载
            page.wait_for_load_state("networkidle", timeout=3000)
        # page.wait_for_timeout(3000)
        
    except Exception as e_outer:
        # 处理文件下载情况
        if "net::ERR_ABORTED" in str(e_outer):
            import os
            import requests
            import base64
            downloads_folder = f"{local_workplace}/downloads"
            
            os.makedirs(downloads_folder, exist_ok=True)
            filename = os.path.basename(url)
            filepath = os.path.join(downloads_folder, filename)
            filepath = os.path.abspath(filepath)
            try:
                # 使用requests下载文件
                response = requests.get(url, stream=True)
                response.raise_for_status()
                
                with open(filepath, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                
                # 显示下载成功页面
                message = f"""<body style="margin: 20px;">
                    <h1>Successfully downloaded '{filename}' to local path:
                    <br><br>{_local_to_docker(filepath)}</h1></body>"""
                    
                goto(
                    "data:text/html;base64," + 
                    base64.b64encode(message.encode("utf-8")).decode("utf-8")
                )
                
                # 触发pageshow事件
                page.evaluate("""
                    const event = new Event('pageshow', {
                        bubbles: true,
                        cancelable: false
                    });
                    window.dispatchEvent(event);
                """)
                
            except Exception as e:
                raise Exception(f"Download error: {str(e)}")
        else:
            raise e_outer
        
# def _click_id(bid: str, button: Literal["left", "middle", "right"] = "left"):
#     """
#     Clicks the mouse on the target with the given element bid.

#     Examples:
#         _click_id('12')
#         _click_id('12', button='left')
#     """
#     from typing import Dict, Union, cast
#     try:
#         elem = get_elem_by_bid(page, bid, demo_mode != "off")
#         box = cast(Dict[str, Union[int, float]], elem.bounding_box())
#         # 如果既不是下载也不是新页面，在当前页面处理
#         page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, button=button)
#         try:
#             page.wait_for_load_state("networkidle", timeout=5000)
#         except:
#             pass
#         return
                
#     except Exception as e:
#         raise Exception(f"Click error: {str(e)}")


def _click_id(bid: str, button: Literal["left", "middle", "right"] = "left"):
    """
    Clicks the mouse on the target with the given element bid.

    Examples:
        _click_id('12')
        _click_id('12', button='left')
    """
    # def _local_to_docker(local_path: str):
    #     """
    #     Convert a local path to a docker path
    #     local_path: the local path to convert, like `{LOCAL_ROOT}/{DOCKER_WORKPLACE_NAME}/downloads/xxx`
    #     docker_path: the docker path to convert, like `/{DOCKER_WORKPLACE_NAME}/downloads/xxx`
    #     """
    #     assert LOCAL_ROOT in local_path, f"local_path must contain {LOCAL_ROOT}"
    #     return local_path.replace(LOCAL_ROOT, '')
    from typing import Dict, Union, cast
    import time
    import base64
    import os
    from playwright._impl._api_types import TimeoutError as playwright_TimeoutError
    try:
        global page
        elem = get_elem_by_bid(page, bid, demo_mode != "off")
        box = cast(Dict[str, Union[int, float]], elem.bounding_box())
        
        # 获取当前页面URL
        current_url = page.url
        page.context.add_cookies(COOKIES_LIST)
        # goto(url)
        page.set_extra_http_headers({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
        })
        
        # 执行点击并等待下载
        try:
            with page.expect_download(timeout=5000) as download_info:  # 增加到30秒
                page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, button=button)
                download = download_info.value
                print(f"Downloading file: {download.suggested_filename}")
                # 确保下载目录存在
                
                download_path = f"{local_workplace}/downloads"
                os.makedirs(download_path, exist_ok=True)
                # 保存文件
                filepath = os.path.join(download_path, download.suggested_filename)
                filepath = os.path.abspath(filepath)
                download.save_as(filepath)
                # 显示下载成功页面
                
                message = f"""<body style="margin: 20px;">
                    <h1>Successfully downloaded '{download.suggested_filename}' to local path:
                    <br><br>{_local_to_docker(filepath)}</h1></body>"""
                    
                goto(
                    "data:text/html;base64," + 
                    base64.b64encode(message.encode("utf-8")).decode("utf-8")
                )
                
                # 触发pageshow事件
                page.evaluate("""
                    const event = new Event('pageshow', {
                        bubbles: true,
                        cancelable: false
                    });
                    window.dispatchEvent(event);
                """)
                return
        except playwright_TimeoutError:
            # print("Download timeout, trying alternative approach...")
            # # 如果超时，尝试获取PDF直接URL并下载
            # if "arxiv.org" in current_url:
            #     paper_id = current_url.split("/")[-1]
            #     pdf_url = f"https://arxiv.org/pdf/{paper_id}.pdf"
            #     _visit_page(pdf_url)
            #     return
            pass
                
        # 等待可能的新标签页或导航
        time.sleep(1)
        
        # 检查是否有新标签页
        pages_after = len(page.context.pages)
        if pages_after > 1:
            # 切换到最新的标签页
            page = page.context.pages[-1]
            page.bring_to_front()
        elif page.url != current_url:
            # URL改变了，说明发生了导航
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
                if page.get_by_text("Verify you are human by completing the action below.").count() > 0:
                    _checkMeetChallenge()
                    # 等待页面完全加载
                    # 增加等待时间，确保页面完全加载
                    page.wait_for_load_state("networkidle", timeout=3000)
            except Exception:
                pass
            
        return
                
    except Exception as e:
        raise Exception(f"Click error: {str(e)}, {type(e)}")
def _checkMeetChallenge():
    """
    check if meet challenge

    Examples:
        _checkMeetChallenge()
    """
    global page
    def tryToClickChallenge(this_page):
        try:
            # 尝试定位并点击验证框架中的复选框
            frame = this_page.frame_locator("iframe[title*='challenge']")
            if frame:
                checkbox = frame.locator("input[type='checkbox']")
                if checkbox.is_visible():
                    checkbox.click()
                    return True
                
            # 尝试点击验证按钮 (同时支持中英文)
            verify_texts = ["请完成以下操作，验证您是真人。", "Verify you are human by completing the action below."]
            for text in verify_texts:
                verify_button = this_page.get_by_text(text)
                if verify_button.is_visible():
                    verify_button.click()
                    return True
                
            # 尝试点击任何可见的验证按钮
            challenge_buttons = this_page.locator("button[class*='challenge']")
            if challenge_buttons.count() > 0:
                challenge_buttons.first.click()
                return True
                
        except Exception as e:
            print(f"尝试点击验证失败: {str(e)}")
        return False

    check_count = 1
    max_attempts = 6
    while check_count <= max_attempts:
        # 检查是否存在验证页面的特征 (同时支持中英文)
        if (page.get_by_text("请完成以下操作，验证您是真人。").count() == 0 and 
            page.get_by_text("Verify you are human by completing the action below.").count() == 0):
            print("验证已完成")
            break
            
        print(f"检测到 Cloudflare 验证页面，尝试处理... (第 {check_count}/{max_attempts} 次)")
        
        # 尝试处理验证
        if tryToClickChallenge(page):
            print("已尝试点击验证按钮，等待响应...")
        
        # 等待验证结果
        try:
            # 等待验证页面消失或出现新内容
            page.wait_for_function("""
                () => !document.querySelector("div#challenge-stage") || 
                      (!document.body.textContent.includes("请完成以下操作，验证您是真人。") &&
                       !document.body.textContent.includes("Verify you are human by completing the action below."))
            """, timeout=20000)
        except Exception:
            print("等待验证超时")
        
        # 检查是否仍在验证页面
        if check_count >= max_attempts:
            if (page.get_by_text("请完成以下操作，验证您是真人。").count() > 0 or
                page.get_by_text("Verify you are human by completing the action below.").count() > 0):
                raise Exception("cannot pass challenge, need to restart")
        
        check_count += 1
        page.wait_for_timeout(5000)  # 短暂等待后再次检查

class BrowserEnv:
    def __init__(self, browsergym_eval_env: str | None = None, local_root: str | None = None, workplace_name: str | None = None):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_dir = Path(f"logs/res_{timestamp}")
        log_dir.mkdir(parents=True, exist_ok=True)  # recursively create all necessary parent directories
        log_path = str(log_dir / "browser_env.log")
        self.log_path = log_path
        # self.logger = LoggerManager.get_logger()
        self.html_text_converter = self.get_html_text_converter()
        self.eval_mode = False
        self.eval_dir = ''
        self.local_workplace = os.path.join(local_root, workplace_name)
        self.docker_workplace = f"/{workplace_name}"

        # EVAL only: browsergym_eval_env must be provided for evaluation
        self.browsergym_eval_env = browsergym_eval_env
        self.eval_mode = bool(browsergym_eval_env)

        # Initialize browser environment process
        multiprocessing.set_start_method('spawn', force=True)
        self.browser_side, self.agent_side = multiprocessing.Pipe()

        # tmp_env = gym.make(self.browsergym_eval_env,tags_to_mark='all') if self.eval_mode else gym.make('browsergym/openended',task_kwargs={'start_url': 'about:blank', 'goal': 'PLACEHOLDER_GOAL'},
        #         wait_for_user_message=False,
        #         headless=True,
        #     disable_env_checker=True,
        #     tags_to_mark='all'
        # )
        # obs, info = tmp_env.reset()
        # self.viewport = tmp_env.env.viewport if tmp_env.env.viewport else tmp_env.env.task.viewport
        # tmp_env.close()
        self.init_browser()
        
        atexit.register(self.close)

    def get_html_text_converter(self):
        html_text_converter = html2text.HTML2Text()
        # ignore links and images
        html_text_converter.ignore_links = False
        html_text_converter.ignore_images = True
        # use alt text for images
        html_text_converter.images_to_alt = True
        # disable auto text wrapping
        html_text_converter.body_width = 0
        return html_text_converter

    @tenacity.retry(
        wait=tenacity.wait_fixed(1),
        stop=tenacity.stop_after_attempt(5) | stop_if_should_exit(),
        retry=tenacity.retry_if_exception_type(BrowserInitException),
    )
    def init_browser(self):
        debug_print(True, "Starting browser env...", title = "Browser Env", log_path=self.log_path)
        # self.logger.info("Starting browser env...", title="Browser Env", color="green")
        try:
            self.process = multiprocessing.Process(target=self.browser_process)
            self.process.start()
        except Exception as e:
            debug_print(True, f'Failed to start browser process: {e}', title = "Browser Env", log_path=self.log_path)
            # self.logger.info(f'Failed to start browser process: {e}', title="Browser Env", color="red")
            raise

        if not self.check_alive():
            self.close()
            raise BrowserInitException('Failed to start browser environment.')

    def browser_process(self):
        if self.eval_mode:
            assert self.browsergym_eval_env is not None
            debug_print(True, 'Initializing browser env for web browsing evaluation.', title = "Browser Env", log_path=self.log_path)
            # self.logger.info('Initializing browser env for web browsing evaluation.', title="Browser Env", color="green")
            if 'webarena' in self.browsergym_eval_env:
                import browsergym.webarena  # noqa F401 register webarena tasks as gym environments
            elif 'miniwob' in self.browsergym_eval_env:
                import browsergym.miniwob  # noqa F401 register miniwob tasks as gym environments
            else:
                raise ValueError(
                    f'Unsupported browsergym eval env: {self.browsergym_eval_env}'
                )
            env = gym.make(
                self.browsergym_eval_env,
                tags_to_mark='all',
            )
        else:
            from browsergym.core.action.highlevel import HighLevelActionSet
            def _local_to_docker(local_path: str):
                """
                Convert a local path to a docker path
                local_path: the local path to convert, like `{local_workplace}/downloads/xxx`
                docker_path: the docker path to convert, like `{docker_workplace}/downloads/xxx`

                Examples:
                    _local_to_docker('/Users/tangjiabin/Documents/reasoning/autoagent/workplace_gaia_eval/downloads/xxx')
                """
                local_workplace = None
                docker_workplace = None
                assert local_workplace in local_path, f"local_path must contain {local_workplace}"
                return local_path.replace(local_workplace, docker_workplace)
            source = inspect.getsource(_local_to_docker)
            normalized_source = textwrap.dedent(source)
            normalized_source = normalized_source.replace('local_workplace = None', f'local_workplace = {repr(self.local_workplace)}')
            normalized_source = normalized_source.replace('docker_workplace = None', f'docker_workplace = {repr(self.docker_workplace)}')

            action_set = HighLevelActionSet(subsets = ["chat", "infeas", "bid", "nav", "tab", "custom"], custom_actions = [_visit_page, _click_id, _get_page_markdown, _checkMeetChallenge])
#             action_set.python_includes = \
# f"""
# {repr(read_file('autoagent/environment/markdown_browser/mdconvert.py'))}

# """ + action_set.python_includes

            action_set.python_includes = f"""\
{convert_cookies_to_python()}
""" + action_set.python_includes
            action_set.python_includes = f"""\
def _local_to_docker(local_path: str):
    local_workplace = {repr(self.local_workplace)}
    docker_workplace = {repr(self.docker_workplace)}
    assert local_workplace in local_path
    return local_path.replace(local_workplace, docker_workplace)

""" + action_set.python_includes
            action_set.python_includes = f"local_workplace = {repr(self.local_workplace)}\n" + action_set.python_includes
            
            # action_set.python_includes = f"LOCAL_ROOT = {repr(LOCAL_ROOT)}\n" + action_set.python_includes
            
            # print(action_set.python_includes)
            action_mapping = action_set.to_python_code
            env = gym.make(
                'browsergym/openended',
                task_kwargs={'start_url': 'about:blank', 'goal': 'PLACEHOLDER_GOAL'},
                wait_for_user_message=False,
                headless=True,
                disable_env_checker=True,
                tags_to_mark='all',
                action_mapping = action_mapping
            )
        
        
        obs, info = env.reset()
        
        # self.viewport = env.env.viewport if env.env.viewport else env.env.task.viewport
        # print(f"Viewport: {self.viewport}")
        # 通过管道发送viewport信息

        # EVAL ONLY: save the goal into file for evaluation
        self.eval_goal = None
        self.eval_rewards: list[float] = []
        if self.eval_mode:
            debug_print(True, f"Browsing goal: {obs['goal']}", title = "Browser Env", log_path=self.log_path)
            # self.logger.info(f"Browsing goal: {obs['goal']}", title="Browser Env", color="green")
            self.eval_goal = obs['goal']

        debug_print(True, 'Browser env started.', title = "Browser Env", log_path=self.log_path)
        # self.logger.info('Browser env started.', title="Browser Env", color="green")
        while should_continue():
            try:
                if self.browser_side.poll(timeout=0.01):
                    unique_request_id, action_data = self.browser_side.recv()

                    # shutdown the browser environment
                    if unique_request_id == 'SHUTDOWN':
                        debug_print(False, 'SHUTDOWN recv, shutting down browser env...', title = "Browser Env", log_path=self.log_path)
                        # self.logger.info('SHUTDOWN recv, shutting down browser env...', title="Browser Env", color="green")
                        env.close()
                        return
                    elif unique_request_id == 'IS_ALIVE':
                        self.browser_side.send(('ALIVE', None))
                        continue

                    # EVAL ONLY: Get evaluation info
                    if action_data['action'] == BROWSER_EVAL_GET_GOAL_ACTION:
                        self.browser_side.send(
                            (unique_request_id, {'text_content': self.eval_goal})
                        )
                        continue
                    elif action_data['action'] == BROWSER_EVAL_GET_REWARDS_ACTION:
                        self.browser_side.send(
                            (
                                unique_request_id,
                                {'text_content': json.dumps(self.eval_rewards)},
                            )
                        )
                        continue

                    action = action_data['action']
                    obs, reward, terminated, truncated, info = env.step(action)

                    # EVAL ONLY: Save the rewards into file for evaluation
                    if self.eval_mode:
                        self.eval_rewards.append(reward)

                    # add text content of the page
                    html_str = flatten_dom_to_str(obs['dom_object'])
                    obs['text_content'] = self.html_text_converter.handle(html_str)
                    # make observation serializable
                    obs['screenshot'] = self.image_to_png_base64_url(obs['screenshot'])
                    obs['active_page_index'] = obs['active_page_index'].item()
                    obs['elapsed_time'] = obs['elapsed_time'].item()
                    self.browser_side.send((unique_request_id, obs))
            except KeyboardInterrupt:
                debug_print(True, 'Browser env process interrupted by user.', title = "Browser Env", log_path=self.log_path)
                # self.logger.info('Browser env process interrupted by user.', title="Browser Env", color="green")
                try:
                    env.close()
                except Exception:
                    pass
                return

    def step(self, action_str: str, timeout: float = 30) -> dict:
        """Execute an action in the browser environment and return the observation."""
        unique_request_id = str(uuid.uuid4())
        self.agent_side.send((unique_request_id, {'action': action_str}))
        start_time = time.time()
        while True:
            if should_exit() or (time.time() - start_time > timeout and '_visit_page' not in action_str):
                raise TimeoutError('Browser environment took too long to respond.')
            if should_exit() or (time.time() - start_time > 600 and '_visit_page' in action_str):
                raise TimeoutError('Browser environment took too long to respond.')
            if self.agent_side.poll(timeout=0.01):
                response_id, obs = self.agent_side.recv()
                if response_id == unique_request_id:
                    return obs

    def check_alive(self, timeout: float = 60):
        self.agent_side.send(('IS_ALIVE', None))
        if self.agent_side.poll(timeout=timeout):
            response_id, _ = self.agent_side.recv()
            if response_id == 'ALIVE':
                return True
            debug_print(True, f'Browser env is not alive. Response ID: {response_id}', title = "Browser Env", log_path=self.log_path)
            # self.logger.info(f'Browser env is not alive. Response ID: {response_id}', title="Browser Env", color="red")

    def close(self):
        if not self.process.is_alive():
            return
        try:
            self.agent_side.send(('SHUTDOWN', None))
            self.process.join(5)  # Wait for the process to terminate
            if self.process.is_alive():
                debug_print(True, 'Browser process did not terminate, forcefully terminating...', title = "Browser Env", log_path=self.log_path)
                # self.logger.info('Browser process did not terminate, forcefully terminating...', title="Browser Env", color="red")
                self.process.terminate()
                self.process.join(5)  # Wait for the process to terminate
                if self.process.is_alive():
                    self.process.kill()
                    self.process.join(5)  # Wait for the process to terminate
            self.agent_side.close()
            self.browser_side.close()
        except Exception:
             debug_print(True, 'Encountered an error when closing browser env', exc_info=True, title = "Browser Env", log_path=self.log_path)
            # self.logger.info('Encountered an error when closing browser env', exc_info=True, title="Browser Env", color="red")

    @staticmethod
    def image_to_png_base64_url(
        image: np.ndarray | Image.Image, add_data_prefix: bool = False
    ):
        """Convert a numpy array to a base64 encoded png image url."""
        if isinstance(image, np.ndarray):
            image = Image.fromarray(image)
        if image.mode in ('RGBA', 'LA'):
            image = image.convert('RGB')
        buffered = io.BytesIO()
        image.save(buffered, format='PNG')

        image_base64 = base64.b64encode(buffered.getvalue()).decode()
        return (
            f'data:image/png;base64,{image_base64}'
            if add_data_prefix
            else f'{image_base64}'
        )

    @staticmethod
    def image_to_jpg_base64_url(
        image: np.ndarray | Image.Image, add_data_prefix: bool = False
    ):
        """Convert a numpy array to a base64 encoded jpeg image url."""
        if isinstance(image, np.ndarray):
            image = Image.fromarray(image)
        if image.mode in ('RGBA', 'LA'):
            image = image.convert('RGB')
        buffered = io.BytesIO()
        image.save(buffered, format='JPEG')

        image_base64 = base64.b64encode(buffered.getvalue()).decode()
        return (
            f'data:image/jpeg;base64,{image_base64}'
            if add_data_prefix
            else f'{image_base64}'
        )
def source_to_function(source_code: str, func_name: str):
    """将源代码字符串转换为函数，支持 inspect.getsource"""
    # 创建临时文件
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
        f.write(source_code)
        temp_path = f.name
    
    try:
        # 导入临时模块
        import importlib.util
        spec = importlib.util.spec_from_file_location("temp_module", temp_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        # 获取函数
        func = getattr(module, func_name)
        return func
        
    finally:
        # 清理临时文件
        os.unlink(temp_path)

    
    