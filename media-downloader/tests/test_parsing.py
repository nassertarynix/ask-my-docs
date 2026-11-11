import json
import math
from pathlib import Path

import pytest

from downloader import (DoneEvent, PostprocessEvent, ProgressEvent, normalize_format, normalize_info, parse_output_line)
from options import SEP

FIX = Path(__file__).parent / "fixtures"


def line(*fields):
    return SEP.join(str(f) for f in fields)


# ---- progress lines (shapes captured from the real yt-dlp) -----------------------------------------------------------------------------
def test_a_download_line_is_parsed():
    ev = parse_output_line(line("PROG", "downloading", 130048, 188129, "NA", 34033870.755, 0, "NA", "NA", "clip"))
    assert ev == ProgressEvent("downloading", 130048.0, 188129.0, 34033870.755, 0.0, None, None, "clip")


def test_an_estimated_total_is_used_when_the_exact_one_is_unknown():
    ev = parse_output_line(line("PROG", "downloading", 1000, "NA", 5000, 100.5, 12, 3, 10, "Part three"))
    assert (ev.total, ev.index, ev.count, ev.eta, ev.title) == (5000.0, 3, 10, 12.0, "Part three")


def test_unknown_values_become_none_and_never_crash():
    ev = parse_output_line(line("PROG", "downloading", "NA", "NA", "NA", "NA", "NA", "NA", "NA", "NA"))
    assert ev == ProgressEvent("downloading", None, None, None, None, None, None, "")


@pytest.mark.parametrize("junk", ["nan", "inf", "-inf", "1e999", "abc", "", "None"])
def test_non_numbers_and_non_finite_numbers_are_none(junk):
    ev = parse_output_line(line("PROG", "downloading", junk, junk, junk, junk, junk, junk, junk, "t"))
    assert ev.downloaded is None and ev.speed is None and ev.index is None


def test_a_postprocess_line():
    assert parse_output_line(line("PP", "started", "ExtractAudio", "NA", "NA", "clip")) == PostprocessEvent("started", "ExtractAudio", None, None, "clip")
    assert parse_output_line(line("PP", "finished", "MoveFiles", 2, 5, "x")).index == 2


def test_the_done_line_keeps_the_whole_path_even_with_spaces_and_unicode():
    assert parse_output_line(line("DONE", "/home/me/Videos/Test feed/001 - 進撃 [id].mp4")) == DoneEvent("/home/me/Videos/Test feed/001 - 進撃 [id].mp4")


@pytest.mark.parametrize("other", ["", "[download] Destination: x.mp4", "[download]  42.0% of 1MiB at 1MiB/s ETA 00:01", "PROG", "PROG\x1fdownloading", "PP\x1fstarted",
                                   "DONE", "DONE\x1f", "WARNING: something", "random\x1fseparated\x1ftext"])
def test_other_lines_are_ignored(other):
    assert parse_output_line(other) is None


def test_the_real_captured_lines_all_parse():
    captured = ["PROG\x1fdownloading\x1f1024\x1f188129\x1fNA\x1fNA\x1fNA\x1fNA\x1fNA\x1fclip", "PROG\x1ffinished\x1f188129\x1f188129\x1fNA\x1f26550141.898250338\x1fNA\x1fNA\x1fNA\x1fclip",
                "PP\x1fstarted\x1fExtractAudio\x1fNA\x1fNA\x1fclip", "PP\x1ffinished\x1fMoveFiles\x1fNA\x1fNA\x1fclip", "DONE\x1f/tmp/out/clip [clip].mp3"]
    assert all(parse_output_line(c) is not None for c in captured)
    assert math.isfinite(parse_output_line(captured[1]).speed)


# ---- the information shown before downloading ------------------------------------------------------------------------------------------------
def test_a_real_youtube_video_is_normalised():
    info = normalize_info(json.loads((FIX / "youtube_single.json").read_text()))
    assert info["is_playlist"] is False and info["title"].startswith("Big Buck Bunny") and info["duration"] == 635 and info["license"].startswith("Creative Commons")
    assert info["uploader"] == "Blender" and info["thumbnail"].startswith("https://")
    assert not [f for f in info["formats"] if f["format_id"].startswith("sb")], "storyboards are not downloadable media"
    assert info["available_heights"] == sorted(info["available_heights"], reverse=True) and info["available_heights"][0] >= 1080
    assert info["has_audio_only"] is True


def test_audio_only_hls_entries_with_an_empty_codec_still_count_as_audio():
    info = normalize_info(json.loads((FIX / "youtube_single.json").read_text()))
    hls = [f for f in info["formats"] if f["format_id"] in ("233", "234")]
    assert hls and all(f["has_audio"] and not f["has_video"] and f["resolution"] == "audio only" for f in hls)


def test_video_only_and_combined_formats_are_told_apart():
    info = normalize_info(json.loads((FIX / "youtube_single.json").read_text()))
    video_only = [f for f in info["formats"] if f["has_video"] and not f["has_audio"]]
    assert video_only and all(f["acodec"] == "" for f in video_only) and all(f["height"] for f in video_only)


def test_format_details_are_clean():
    f = normalize_format({"format_id": "137", "ext": "mp4", "height": 1080, "width": 1920, "fps": 30, "vcodec": "avc1.640028", "acodec": "none", "tbr": 4400.4, "filesize": 123})
    assert f == {"format_id": "137", "ext": "mp4", "height": 1080, "width": 1920, "fps": 30, "resolution": "1920x1080", "vcodec": "avc1", "acodec": "", "bitrate": 4400,
                 "filesize": 123, "note": "", "has_video": True, "has_audio": False}


def test_storyboards_are_dropped():
    assert normalize_format({"format_id": "sb0", "ext": "mhtml", "format_note": "storyboard"}) is None
    assert normalize_format({"format_id": "x", "ext": "mp4", "format_note": "Storyboard"}) is None


def test_a_plain_media_file_has_one_format_with_unknown_codecs():
    info = normalize_info({"_type": "video", "title": "clip", "ext": "mp4", "formats": [{"format_id": "mp4", "ext": "mp4"}], "webpage_url": "http://127.0.0.1/clip.mp4"})
    assert len(info["formats"]) == 1 and info["formats"][0]["has_video"] and info["formats"][0]["has_audio"] and info["available_heights"] == []


def test_a_video_without_a_formats_list_uses_the_top_level_format():
    info = normalize_info({"title": "t", "ext": "mp4", "height": 720, "width": 1280, "vcodec": "avc1", "acodec": "mp4a"})
    assert info["formats"][0]["height"] == 720 and info["available_heights"] == [720]


def test_a_playlist_is_normalised_and_unsafe_urls_are_dropped():
    info = normalize_info(json.loads((FIX / "playlist_feed.json").read_text()))
    assert info["is_playlist"] is True and info["title"] == "Test feed" and info["formats"] == []
    assert [e["title"] for e in info["entries"]] == ["First clip", "Second clip", "<img src=x onerror=1>"]  # the string entry was skipped; titles stay raw text
    assert info["entries"][0]["url"] == "http://127.0.0.1:8899/clip.mp4" and info["entries"][0]["duration"] == 12.5
    assert info["entries"][1]["url"] == ""  # javascript: URLs are never passed on
    assert info["entries"][2]["thumbnail"] == "https://e.com/big.jpg"  # the last http(s) thumbnail; ftp is skipped
    # the index is the item's real position in the playlist (what --playlist-items needs), so skipping a bad entry does not renumber the rest
    assert [e["index"] for e in info["entries"]] == [1, 2, 4]


def test_a_large_playlist_is_capped_and_flagged():
    raw = {"_type": "playlist", "title": "big", "playlist_count": 1200, "entries": [{"id": str(i), "title": f"v{i}", "url": f"https://x.com/{i}"} for i in range(600)]}
    info = normalize_info(raw, max_entries=500)
    assert len(info["entries"]) == 500 and info["truncated"] is True and info["playlist_count"] == 1200


def test_odd_values_do_not_break_normalisation():
    info = normalize_info({"title": None, "id": "abc", "thumbnail": "javascript:x", "duration": "long", "formats": [None, "x", {"format_id": None, "height": "tall"}]})
    assert info["title"] == "abc" and info["thumbnail"] == "" and info["duration"] is None and len(info["formats"]) == 1
    assert normalize_info({"_type": "playlist", "entries": None})["entries"] == []
    assert len(normalize_info({"title": "x" * 1000})["title"]) == 300
