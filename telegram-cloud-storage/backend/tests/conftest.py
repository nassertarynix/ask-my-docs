import pytest

from backend.config import Settings
from backend.database import Database
from backend.telegram_client import LocalDirBackend

SMALL_CHUNK = 64 * 1024  # the smallest allowed, so tests need only a few hundred KB to span many chunks
TOKEN = "t" * 24


@pytest.fixture
async def db(tmp_path):
    database = await Database(tmp_path / "index.db").open()
    yield database
    await database.close()


@pytest.fixture
async def backend(tmp_path):
    b = LocalDirBackend(tmp_path / "channel")
    await b.connect()
    return b


@pytest.fixture
def settings(tmp_path):
    s = Settings(data_dir=tmp_path / "data", backend="local", local_dir=tmp_path / "channel", token=TOKEN, chunk_size=SMALL_CHUNK)
    s.max_upload_bytes = 5 * 1024 * 1024
    return s
