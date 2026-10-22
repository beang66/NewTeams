import time

import pytest

from newteam.config import settings


@pytest.fixture(autouse=True)
def isolated_data(tmp_path):
    original = settings.data_dir
    settings.data_dir = tmp_path
    settings.ensure_dirs()
    yield tmp_path
    settings.data_dir = original


@pytest.fixture
def store(isolated_data):
    from newteam.db import Store

    return Store(settings.db_path)


@pytest.fixture
def runner(store):
    from newteam.engine.runner import Runner

    r = Runner(store)
    yield r
    r.pool.shutdown(wait=True)


def wait_for(store, run_id, statuses=("waiting", "completed", "failed", "paused", "cancelled"), timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = store.get("runs", run_id)
        if run["status"] in statuses:
            return run
        time.sleep(0.05)
    raise AssertionError(f"timeout: {store.get('runs', run_id)['status']}")
