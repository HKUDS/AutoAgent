import torch
from datasets import load_dataset
from tqdm import tqdm
import multiprocessing
import random
import requests
from functools import partial
import argparse
from pathlib import Path    
import yaml
from metachain.agents.math.math_solver_agent import get_math_solver_agent
from metachain import MetaChain
from metachain.workflows.math_solver_workflow_flow import majority_voting
import importlib
import os
import asyncio
from evaluation.math500.prompts import MATH_COT_PROMPT


def save_yaml(path: Path, data, sort_keys=True):
    with open(path, "w") as f:
        yaml.dump(data, f, sort_keys=sort_keys)

async def run_inference(item, save_dir, workflow):

    outpath = save_dir / f"{item['id']}.yaml"
    if outpath.exists():
        return

    prompt = MATH_COT_PROMPT + f"\n\nProblem:\n{item['problem']}\n\nYour task is to solve this problem."
    prompt += "Please given your final answer (answer ONLY) within the format of `Final Answer: The final answer is <answer>. I hope it is correct.` after your reasoning \n"
    prompt += "For example: According to ...\nFinal Answer: The final answer is $24$. I hope it is correct.\n"

    if workflow == "majority_voting":
        answer = await majority_voting(prompt)
    elif workflow is None:
        agent = get_math_solver_agent(model="deepseek/deepseek-chat")
        client = MetaChain()
        messages = [
            {"role": "user", "content": prompt},
        ]
        context_variables = {
        }

        response = await client.run_async(agent, messages, context_variables)
        answer = response.messages[-1]['content']
    else: raise ValueError(f"Unknown workflow: {workflow}")

    out = {
        "prompt": prompt,
        "question": item["problem"],
        "answer": answer,
        "gt_answer": item["answer"],
    }

    save_yaml(outpath, out)


async def main(args):

    test_dataset = list(
        load_dataset(
            "HuggingFaceH4/MATH-500", "default", split="test", trust_remote_code=True
        )
    )

    print(f"Number of test items: {len(test_dataset)}")

    random.seed(12345)


    for i, data in enumerate(test_dataset):
        data["id"] = i

    random.shuffle(test_dataset)

    if args.limit is not None:
        limit = args.limit
    else:
        limit = len(test_dataset)

    if args.stride is not None:
        stride = args.stride
    else:
        stride = 1

    if args.offset is not None:
        offset = args.offset
    else:
        offset = 0

    test_dataset = test_dataset[offset:limit:stride]

    print(f"Total number of items to process: {len(test_dataset)}")

    if args.workflow is None:
        save_dir = os.path.join(args.save_dir, "math_solver")
        save_dir = Path(save_dir)
        save_dir.mkdir(parents=True, exist_ok=True)

    else:
        save_dir = os.path.join(args.save_dir, args.workflow)
        save_dir = Path(save_dir)
        save_dir.mkdir(parents=True, exist_ok=True)

    

    predictions = []
    for item in tqdm(test_dataset):
        predictions.append(await run_inference(item, save_dir, args.workflow))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--num_few_shot", type=int, default=2)
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--stride", type=int, default=1)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--save_dir", type=str, default="evaluation_results/math500")
    parser.add_argument("--workflow", type=str, default=None)
    args = parser.parse_args()
    asyncio.run(main(args))