import os
import pathlib
import subprocess
import time
from typing import Any, TextIO, List, Dict
from .types import EvalMetadata, EvalOutput
import pandas as pd
import json
from typing import Callable, Awaitable
from tqdm import tqdm
from autoagent.logger import MetaChainLogger, LoggerManager
import multiprocessing as mp
import psutil
import traceback
import socket
import queue  # 添加这行导入

def make_metadata(
    model: str,
    dataset_name: str,
    agent_func: str,
    eval_note: str | None,
    eval_output_dir: str,
    data_split: str | None = None,
    details: dict[str, Any] | None = None,
    port: int | None = None,
    container_name: str | None = None,
    git_clone: bool = False,
    test_pull_name: str | None = None,
) -> EvalMetadata:
    eval_note = f'_N_{eval_note}' if eval_note else ''

    eval_output_path = os.path.join(
        eval_output_dir,
        dataset_name,
        agent_func.replace('get_', ''),
        f'{model}_maxiter{eval_note}',
    )

    pathlib.Path(eval_output_path).mkdir(parents=True, exist_ok=True)
    pathlib.Path(os.path.join(eval_output_path, 'logs')).mkdir(
        parents=True, exist_ok=True
    )

    metadata = EvalMetadata(
        agent_func=agent_func,
        model=model,
        eval_output_dir=eval_output_path,
        start_time=time.strftime('%Y-%m-%d %H:%M:%S'),
        dataset=dataset_name,
        data_split=data_split,
        details=details,
        port=port,
        container_name=container_name,
        git_clone=git_clone,
        test_pull_name=test_pull_name,
    )
    metadata_json = metadata.model_dump_json()
    with open(os.path.join(eval_output_path, 'metadata.json'), 'w') as f:
        f.write(metadata_json)

    return metadata

def prepare_dataset(
    dataset: pd.DataFrame,
    output_file: str,
    eval_n_limit: int,
    eval_ids: list[str] | None = None,
    skip_num: int | None = None,
):
    assert (
        'instance_id' in dataset.columns
    ), "Expected 'instance_id' column in the dataset. You should define your own unique identifier for each instance and use it as the 'instance_id' column."
    logger = LoggerManager.get_logger()
    id_column = 'instance_id'
    logger.info(f'Writing evaluation output to {output_file}')
    finished_ids: set[str] = set()
    if os.path.exists(output_file):
        with open(output_file, 'r') as f:
            for line in f:
                data = json.loads(line)
                finished_ids.add(str(data[id_column]))
        logger.info(
            f'\nOutput file {output_file} already exists. Loaded {len(finished_ids)} finished instances.', title='Warning', color='red'
        )

    if eval_ids:
        eval_ids_converted = [dataset[id_column].dtype.type(id) for id in eval_ids]
        dataset = dataset[dataset[id_column].isin(eval_ids_converted)]
        logger.info(f'Limiting evaluation to {len(eval_ids)} specific instances.')
    elif skip_num and skip_num >= 0:
        skip_num = min(skip_num, len(dataset))
        dataset = dataset.iloc[skip_num:]
        logger.info(
            f'Starting evaluation with skipping first {skip_num} instances ({len(dataset)} instances to run).'
        )
        if eval_n_limit and eval_n_limit > 0:
            dataset = dataset.head(eval_n_limit)
            logger.info(f'Limiting evaluation to {eval_n_limit} instances.')
    elif eval_n_limit and eval_n_limit > 0:
        dataset = dataset.head(eval_n_limit)
        logger.info(f'Limiting evaluation to first {eval_n_limit} instances.')

    new_dataset = [
        instance
        for _, instance in dataset.iterrows()
        if str(instance[id_column]) not in finished_ids
    ]
    logger.info(
        f'Finished instances: {len(finished_ids)}, Remaining instances: {len(new_dataset)}'
    )

    return pd.DataFrame(new_dataset)
def _process_and_queue(process_instance_func, instance, metadata, use_mp, max_retries, queue):
    """包装函数，将结果放入队列"""
    try:
        result = _process_instance_wrapper(
            process_instance_func, instance, metadata, use_mp, max_retries
        )
        queue.put(result)
    except Exception as e:
        print(f"Error processing instance {instance.get('instance_id', 'unknown')}: {str(e)}")
        traceback.print_exc()
        # 在发生错误时也要把错误结果放入队列，避免主进程等待
        queue.put(None)  # 或者放入一个表示错误的特殊值
    # finally:
    #     # 确保子进程中的资源被释放
    #     queue.close()
    
def run_evaluation(
    dataset: pd.DataFrame,
    metadata: EvalMetadata | None,
    output_file: str,
    num_workers: int,
    process_instance_func: Callable[
        [pd.Series, EvalMetadata, bool], Awaitable[EvalOutput]
    ],
    max_retries: int = 3,  # number of retries for each instance
):
    logger = LoggerManager.get_logger()
    use_multiprocessing = num_workers > 1

    if metadata is not None:
        logger.info(
            f'Evaluation started with Agent {metadata.agent_func}\n'
        )
    else:
        logger.info('Running evaluation without metadata.', title='Warning', color='red')
        logger.info(f'Evaluation started with {num_workers} workers.')

    total_instances = len(dataset)
    pbar = tqdm(total=total_instances, desc='Instances processed')
    output_fp = open(output_file, 'a')

    try:
        if use_multiprocessing:
            # 使用队列来收集结果
            results_queue = mp.Queue()
            active_processes = []
            instances_iter = dataset.iterrows()
            instances_completed = 0
            
            while instances_completed < total_instances:
                # 启动新进程，直到达到worker数量限制
                while len(active_processes) < num_workers and instances_completed < total_instances:
                    try:
                        _, instance = next(instances_iter)
                        # 创建非守护进程
                        p = mp.Process(
                            target=_process_and_queue,
                            args=(process_instance_func, instance, metadata, True, max_retries, results_queue),
                            daemon=False  # 关键：设置为非守护进程
                        )
                        p.start()
                        time.sleep(3)
                        active_processes.append((p, time.time()))  # 记录进程启动时间
                    except StopIteration:
                        break

                # 检查完成的进程
                for p, start_time in active_processes[:]:
                    if not p.is_alive():
                        try:
                            # 给进程1分钟时间来清理资源
                            p.join(timeout=60)
                            if p.is_alive():
                                logger.warning(f"Process {p.pid} cleanup timeout, force terminating...")
                                p.terminate()
                                p.join(timeout=5)
                                if p.is_alive():
                                    p.kill()
                        except Exception as e:
                            logger.warning(f"Error cleaning up process {p.pid}: {str(e)}")
                            p.kill()
                        finally:
                            active_processes.remove((p, start_time))

                # 处理队列中的结果
                try:
                    while not results_queue.empty():
                        result = results_queue.get_nowait()
                        update_progress(result, pbar, output_fp)
                        instances_completed += 1
                except Exception as e:
                    logger.error(f"Error processing results: {str(e)}")

                time.sleep(0.1)  # 避免过度占用CPU

            # 清理剩余进程
            logger.info("Cleaning up remaining processes...")
            for p, _ in active_processes:
                try:
                    # 给进程一个较短的超时时间
                    p.join(timeout=5)
                    if p.is_alive():
                        p.terminate()
                        p.join(timeout=1)
                        if p.is_alive():
                            p.kill()
                except Exception as e:
                    logger.info(f"Error cleaning up process {p.pid}: {str(e)}", title='warning', color='red')
                    try:
                        p.kill()
                    except:
                        pass

            # 快速清空队列
            try:
                while True:
                    try:
                        result = results_queue.get_nowait()
                        update_progress(result, pbar, output_fp)
                        instances_completed += 1
                    except queue.Empty:
                        break
            except Exception as e:
                logger.info(f"Error processing final results: {str(e)}", title='Warning', color='red')
        else:
            for _, instance in dataset.iterrows():
                result = _process_instance_wrapper(
                    process_instance_func=process_instance_func,
                    instance=instance,
                    metadata=metadata,
                    use_mp=False,
                    max_retries=max_retries,
                )
                update_progress(result, pbar, output_fp)

    except KeyboardInterrupt:
        print('\nKeyboardInterrupt received. Cleaning up...\n')
        if use_multiprocessing:
            for p, _ in active_processes:
                try:
                    p.terminate()
                    p.join(timeout=1)
                except Exception:
                    p.kill()
        cleanup()
    finally:
        # 确保资源被释放
        output_fp.close()
        if use_multiprocessing:
            results_queue.close()
            results_queue.join_thread()

    logger.info('\nEvaluation finished.\n')
def _process_instance_wrapper_mp(args):
    """Wrapper for multiprocessing, especially for imap_unordered."""
    return _process_instance_wrapper(*args)

def _process_instance_wrapper(
    process_instance_func: Callable[[pd.Series, EvalMetadata, bool], EvalOutput],
    instance: pd.Series,
    metadata: EvalMetadata,
    use_mp: bool,
    max_retries: int = 5,
) -> EvalOutput:
    """Wrap the process_instance_func to handle retries and errors.

    Retry an instance up to max_retries times if it fails (e.g., due to transient network/runtime issues).
    """
    if use_mp:
        log_path = os.path.join(metadata.eval_output_dir, 'logs', f'agent_{metadata.model}_did_{instance["instance_id"]}.log')
        logger = MetaChainLogger(log_path)
    else:
        logger = LoggerManager.get_logger()
    for attempt in range(max_retries + 1):
        try:
            result = process_instance_func(instance, metadata, logger)
            return result
        except Exception as e:
            error = str(e)
            stacktrace = traceback.format_exc()
            if attempt == max_retries:
                logger.info(error, title='Error', color='red')
                msg = (
                    '-' * 10
                    + '\n'
                    + f'Error in instance [{instance.instance_id}]: {error}. Stacktrace:\n{stacktrace}'
                    + '\n'
                    + f'[Encountered after {max_retries} retries. Please check the logs and report the issue.]'
                    + '-' * 10
                )
                # Raise an error after all retries & stop the evaluation
                logger.info(error, title='Error', color='red')
                raise RuntimeError(
                    f'Maximum error retries reached for instance {instance.instance_id}'
                ) from e
            msg = (
                '-' * 10
                + '\n'
                + f'Error in instance [{instance.instance_id}]: {error}. Stacktrace:\n{stacktrace}'
                + '\n'
                + '-' * 10
                + f'[The above error occurred. Retrying... (attempt {attempt + 1} of {max_retries})]'
                + '-' * 10
                + '\n'
            )
            logger.info(msg, title='Error', color='red')
            if use_mp:
                print(msg)  # use print to directly print to console
            time.sleep(5)

def update_progress(
    result: EvalOutput,
    pbar: tqdm,
    output_fp: TextIO,
):
    """Update the progress bar and write the result to the output file."""
    logger = LoggerManager.get_logger()
    pbar.update(1)
    pbar.set_description(f'Instance {result.instance_id}')
    pbar.set_postfix_str(f'Test Result: {str(result.test_result)[:300]}...')
    logger.info(
        f'Finished evaluation for instance {result.instance_id}: {str(result.test_result)[:300]}...\n'
    )
    output_fp.write(json.dumps(result.model_dump()) + '\n')
    output_fp.flush()

def cleanup():
    print('Cleaning up child processes...')
    for process in mp.active_children():
        print(f'Terminating child process: {process.name}')
        process.terminate()
        process.join()


def check_port_available(port):
    """check if the port is available"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            # set the port reuse option
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            # try to bind the port
            s.bind(('0.0.0.0', port))
            # immediately close the connection
            s.close()
            return True  # the port is available
        except socket.error:
            return False  # the port is not available

def clean_msg(msg: List[Dict[str, Any]]): 
    new_msg = []
    for m in msg:
        msg_content = m['content']
        if isinstance(msg_content, str):
            m['content'] = msg_content
            new_msg.append(m.copy())
        elif isinstance(msg_content, List):
            new_content = []
            for c in msg_content:
                if c['type'] == 'text':
                    new_content.append(c.copy())
                elif c['type'] == 'image_url':
                    new_content.append({'type': 'image_url', 'image_url': 'placeholder'})
            m['content'] = new_content
            new_msg.append(m.copy())
    return new_msg
