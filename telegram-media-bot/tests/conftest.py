import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from bot import LibraryBot  # noqa: E402
from config import Config  # noqa: E402
from database import Database  # noqa: E402
from fakes import CHANNEL, FakeClient  # noqa: E402


@pytest.fixture
async def db(tmp_path):
    database = await Database(tmp_path / "library.db").open()
    yield database
    await database.close()


@pytest.fixture
def config(tmp_path):
    return Config(api_id=1, api_hash="h" * 32, bot_token="1:abc", storage_channel_id=CHANNEL, db_path=tmp_path / "library.db",
                  admin_ids=frozenset({99}), send_cooldown=0.0, reindex_gap=250)


@pytest.fixture
def client():
    return FakeClient()


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def bot(client, db, config, clock):
    async def no_sleep(_):
        return None

    return LibraryBot(client, db, config, sleep=no_sleep, clock=clock)
