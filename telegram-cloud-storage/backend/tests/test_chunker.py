import hashlib
import os

import pytest

from backend import chunker as ck
from backend.chunker import Chunk, ChunkMeta, IntegrityError, Reassembler

CS = ck.MIN_CHUNK_SIZE


def make(tmp_path, size, name="f.bin", seed=1):
    path = tmp_path / name
    data = bytes((i * seed) % 251 for i in range(size))
    path.write_bytes(data)
    return path, data


def test_hash_file_matches_hashlib_and_reports_progress(tmp_path):
    path, data = make(tmp_path, 3 * ck.HASH_BLOCK + 17)
    seen = []
    digest, size = ck.hash_file(path, lambda d, t: seen.append((d, t)))
    assert digest == hashlib.sha256(data).hexdigest() and size == len(data)
    assert seen[-1] == (len(data), len(data)) and [d for d, _ in seen] == sorted(d for d, _ in seen)


@pytest.mark.parametrize("size,expected", [(0, 0), (1, 1), (CS, 1), (CS + 1, 2), (3 * CS, 3), (3 * CS + 5, 4)])
def test_chunk_count(size, expected):
    assert ck.chunk_count(size, CS) == expected


def test_chunks_are_fixed_size_except_the_last_and_cover_the_file(tmp_path):
    path, data = make(tmp_path, 2 * CS + 123)
    chunks = list(ck.iter_chunks(path, CS))
    assert [c.size for c in chunks] == [CS, CS, 123]
    assert [c.index for c in chunks] == [0, 1, 2] and [c.offset for c in chunks] == [0, CS, 2 * CS]
    assert b"".join(c.data for c in chunks) == data
    assert all(c.sha256 == hashlib.sha256(c.data).hexdigest() for c in chunks)


def test_empty_file_has_no_chunks(tmp_path):
    path, _ = make(tmp_path, 0)
    assert list(ck.iter_chunks(path, CS)) == []


def test_read_chunk_matches_iter_chunks_and_rejects_past_the_end(tmp_path):
    path, _ = make(tmp_path, 2 * CS + 1)
    assert ck.read_chunk(path, 1, CS) == list(ck.iter_chunks(path, CS))[1]
    with pytest.raises(IndexError):
        ck.read_chunk(path, 3, CS)


@pytest.mark.parametrize("bad", [0, 1024, ck.MAX_CHUNK_SIZE + 1])
def test_chunk_size_bounds(bad):
    with pytest.raises(ValueError):
        ck.check_chunk_size(bad)


def reassemble(tmp_path, chunks, sha, size, n, dest="out.bin"):
    r = Reassembler(tmp_path / dest, sha, size, n)
    for c in chunks:
        r.add(c.index, c.data, c.size)
    return r.finish()


def test_round_trip_is_byte_identical(tmp_path):
    path, data = make(tmp_path, 3 * CS + 9)
    sha = hashlib.sha256(data).hexdigest()
    out = reassemble(tmp_path, list(ck.iter_chunks(path, CS)), sha, len(data), 4)
    assert out.read_bytes() == data
    assert not (tmp_path / "out.bin.part").exists()


def test_empty_file_round_trip(tmp_path):
    out = reassemble(tmp_path, [], hashlib.sha256(b"").hexdigest(), 0, 0)
    assert out.read_bytes() == b""


def test_one_flipped_bit_is_caught_and_leaves_no_file(tmp_path):
    path, data = make(tmp_path, 2 * CS)
    sha = hashlib.sha256(data).hexdigest()
    chunks = list(ck.iter_chunks(path, CS))
    tampered = bytearray(chunks[1].data)
    tampered[10] ^= 1
    chunks[1] = Chunk(1, CS, CS, "x", bytes(tampered))
    with pytest.raises(IntegrityError, match="checksum"):
        reassemble(tmp_path, chunks, sha, len(data), 2)
    assert not (tmp_path / "out.bin").exists() and not (tmp_path / "out.bin.part").exists()


def test_swapped_missing_or_short_chunks_are_caught(tmp_path):
    path, data = make(tmp_path, 3 * CS)
    sha, chunks = hashlib.sha256(data).hexdigest(), list(ck.iter_chunks(path, CS))
    with pytest.raises(IntegrityError, match="expected"):
        reassemble(tmp_path, [chunks[1], chunks[0], chunks[2]], sha, len(data), 3)
    with pytest.raises(IntegrityError, match="got 2 chunks"):
        reassemble(tmp_path, chunks[:2], sha, len(data), 3)
    short = Chunk(2, 2 * CS, CS - 1, "x", chunks[2].data[:-1])
    r = Reassembler(tmp_path / "z.bin", sha, len(data), 3)
    r.add(0, chunks[0].data), r.add(1, chunks[1].data)
    with pytest.raises(IntegrityError, match="bytes"):
        r.add(2, short.data, CS)
    r.abort()
    assert not (tmp_path / "z.bin.part").exists()


def test_abort_removes_the_partial_file_and_is_repeatable(tmp_path):
    r = Reassembler(tmp_path / "q.bin", "0" * 64, 1, 1)
    r.add(0, b"x")
    r.abort()
    r.abort()
    assert not (tmp_path / "q.bin.part").exists()


def meta(**kw):
    base = dict(uid="u" * 32, index=2, total=5, file_sha256="a" * 64, chunk_sha256="b" * 64, name="holiday photos.jpg", size=123456, mime="image/jpeg")
    return ChunkMeta(**{**base, **kw})


def test_caption_round_trip_including_unicode():
    m = meta(name="تقرير 2026 ✓.pdf")
    assert ck.parse_caption(ck.build_caption(m)) == m


def test_caption_is_compact_json_with_the_recovery_fields():
    import json
    d = json.loads(ck.build_caption(meta()))
    assert d["app"] == "tgcs" and (d["fid"], d["i"], d["n"], d["sha"], d["csha"]) == ("u" * 32, 2, 5, "a" * 64, "b" * 64)


def test_the_longest_allowed_name_fits_without_trimming():
    text = ck.build_caption(meta(name="é" * 255))
    assert len(text) <= ck.CAPTION_LIMIT and ck.parse_caption(text).name == "é" * 255


def test_an_absurdly_long_name_is_trimmed_so_the_caption_always_fits():
    text = ck.build_caption(meta(name="é" * 3000))  # safety net: clean_name caps real names at 255
    assert len(text) <= ck.CAPTION_LIMIT
    parsed = ck.parse_caption(text)
    assert parsed is not None and parsed.uid == "u" * 32 and 0 < len(parsed.name) < 3000


@pytest.mark.parametrize("bad", [None, "", "hello", "{", "[]", '{"app":"other","v":1}', '{"app":"tgcs","v":99}',
                                 '{"app":"tgcs","v":1,"fid":"x","i":"a","n":1,"sha":"","csha":""}',
                                 '{"app":"tgcs","v":1,"fid":"x","i":5,"n":2,"sha":"%s","csha":"%s"}' % ("a" * 64, "b" * 64),
                                 '{"app":"tgcs","v":1,"fid":"x","i":0,"n":1,"sha":"short","csha":"b"}'])
def test_foreign_or_damaged_captions_are_ignored(bad):
    assert ck.parse_caption(bad) is None


def test_chunking_does_not_load_the_whole_file(tmp_path):
    path, _ = make(tmp_path, 4 * CS)
    gen = ck.iter_chunks(path, CS)
    first = next(gen)
    assert first.size == CS and os.path.getsize(path) == 4 * CS  # generator is lazy: only one chunk read so far
