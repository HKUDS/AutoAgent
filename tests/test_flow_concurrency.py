import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path


FLOW_DIR = Path(__file__).resolve().parents[1] / "autoagent" / "flow"
_TEST_PACKAGE = "_autoagent_flow_core_test"
_package = types.ModuleType(_TEST_PACKAGE)
_package.__path__ = [str(FLOW_DIR)]
sys.modules[_TEST_PACKAGE] = _package
_spec = importlib.util.spec_from_file_location(
    f"{_TEST_PACKAGE}.core", FLOW_DIR / "core.py"
)
_flow_core = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _flow_core
_spec.loader.exec_module(_flow_core)
EventEngineCls = _flow_core.EventEngineCls


class EventConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_max_async_events_limits_total_in_flight_events(self):
        engine = EventEngineCls()
        state = {"active": 0, "peak": 0}

        async def run_child(delay):
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
            try:
                await asyncio.sleep(delay)
            finally:
                state["active"] -= 1

        @engine.make_event
        async def start(event_input, global_ctx):
            return "start"

        @engine.listen_group([start])
        async def fast_child(event_input, global_ctx):
            await run_child(0.01)
            return "fast"

        @engine.listen_group([start])
        async def slow_child(event_input, global_ctx):
            await run_child(0.10)
            return "slow"

        @engine.listen_group([start])
        async def third_child(event_input, global_ctx):
            await run_child(0.03)
            return "third"

        @engine.listen_group([start])
        async def fourth_child(event_input, global_ctx):
            await run_child(0.03)
            return "fourth"

        results = await engine.invoke_event(
            start, global_ctx={}, max_async_events=2
        )

        self.assertEqual(len(results), 5)
        self.assertLessEqual(state["peak"], 2)


if __name__ == "__main__":
    unittest.main()
