import random
import string

import pytest

import menus
from menus import decode, encode


@pytest.mark.parametrize("args", [("s", "ab12", 3), ("m", 5), ("t", 12, None, 0), ("t", 12, 2, 4), ("e", 1, 2, 3), ("e", 1, None, None), ("q", 99999)])
def test_callbacks_round_trip(args):
    action, *parts = args
    assert decode(encode(action, *parts)) == (action, tuple(parts))


def test_callback_data_is_ascii_and_within_telegrams_64_byte_limit_even_for_big_ids():
    data = encode("e", 999_999_999_999, 9999, 999999)
    assert data.isascii() and len(data.encode()) <= 64
    with pytest.raises(ValueError):
        encode("s", "x" * 70, 1)


@pytest.mark.parametrize("bad", [None, "", b"", "m", "m:", "m:abc", "m:-1", "m:1:2", "q:1;DROP", "t:1:2", "t:1:x:3", "e:1:2:x", "s:UPPER:1", "z:1",
                                 "m:" + "9" * 40, b"\xff\xfe", "m:\u0661", "x:1", " m:1", "m:1 "])
def test_malformed_or_forged_callbacks_are_rejected(bad):
    assert decode(bad) is None


def test_label_only_buttons_decode_to_a_no_op():
    assert decode("x") == ("x", ())


def test_decode_never_raises_on_random_input():
    rng = random.Random(3)
    for _ in range(2000):
        text = "".join(rng.choice(string.printable + ":\u0661") for _ in range(rng.randint(0, 30)))
        decode(text)
        decode(text.encode("utf-8", "ignore"))


def test_html_in_titles_and_queries_is_escaped():
    assert menus.esc("<b>x</b> & *y* _z_") == "&lt;b&gt;x&lt;/b&gt; &amp; *y* _z_"
    text, kb = menus.search_screen("<script>", [{"id": 1, "title": "<i>t</i>", "type": "Movie", "release_year": None}], 1, "a", 0, 8)
    assert "<script>" not in text and "&lt;script&gt;" in text


def test_search_screen_with_no_results_has_no_buttons():
    text, kb = menus.search_screen("zzz", [], 0, "a", 0, 8)
    assert "No titles" in text and kb == []


def test_search_screen_shows_pages_only_when_needed():
    rows = [{"id": i, "title": f"T{i}", "type": "Anime", "release_year": 2000 + i} for i in range(8)]
    _, one_page = menus.search_screen("t", rows[:3], 3, "a", 0, 8)
    assert [b for row in one_page for b in row if b[1].startswith("s:")] == []
    _, first = menus.search_screen("t", rows, 20, "a", 0, 8)
    _, middle = menus.search_screen("t", rows, 20, "a", 1, 8)
    _, last = menus.search_screen("t", rows, 20, "a", 2, 8)
    assert [b[0] for b in first[-1]] == ["1/3", "Next \u203a"]
    assert [b[0] for b in middle[-1]] == ["\u2039 Prev", "2/3", "Next \u203a"]
    assert [b[0] for b in last[-1]] == ["\u2039 Prev", "3/3"]
    assert all(decode(data) for row in middle for _, data in row)


def test_long_titles_are_shortened_in_buttons():
    _, kb = menus.search_screen("t", [{"id": 1, "title": "x" * 300, "type": "Movie", "release_year": 2020}], 1, "a", 0, 8)
    assert len(kb[0][0][0]) <= 60


def test_season_names():
    media = {"id": 1, "title": "Show", "type": "Show", "release_year": 2008, "genre": "Drama"}
    text, kb = menus.seasons_screen(media, [{"season_number": 0, "episodes": 2, "files": 2}, {"season_number": 1, "episodes": 7, "files": 9},
                                            {"season_number": None, "episodes": 0, "files": 1}], "s:a:0")
    labels = [b[0] for row in kb for b in row]
    assert labels[:3] == ["Specials \u00b7 2", "Season 1 \u00b7 7", "Episodes \u00b7 1"] and labels[-1] == "\u2039 Back to results"
    assert "Show (2008)" in text and "Drama" in text


def test_episode_grid_has_five_per_row_and_never_exceeds_telegrams_button_limit():
    media = {"id": 1, "title": "Long", "type": "Anime", "release_year": None}
    episodes = [{"episode_number": n, "files": 1} for n in range(1, 51)]
    _, kb = menus.episodes_screen(media, 1, episodes, 1200, 0, 50, True)
    assert all(len(row) <= 5 for row in kb[:-2]) and sum(len(r) for r in kb) <= menus.MAX_BUTTONS
    assert [b[0] for b in kb[-2]] == ["1/24", "Next \u203a"] and kb[-1][0][0] == "\u2039 Back to seasons"
    assert kb[-2][-1][1] == "t:1:1:1"


def test_season_less_episode_list_says_file_and_goes_back_plainly():
    media = {"id": 1, "title": "X", "type": "Show", "release_year": None}
    _, kb = menus.episodes_screen(media, None, [{"episode_number": None, "files": 2}], 1, 0, 50, False)
    assert kb[0][0][0] == "File" and kb[-1][0][0] == "\u2039 Back"


def test_quality_labels_are_numbered_when_repeated_and_back_goes_up_one_level():
    media = {"id": 4, "title": "X", "type": "Show", "release_year": None}
    files = [{"id": 1, "quality_resolution": "1080p"}, {"id": 2, "quality_resolution": "1080p"}, {"id": 3, "quality_resolution": None}]
    text, kb = menus.qualities_screen(media, 1, 5, files)
    assert [b[0] for b in kb[0]] == ["1080p", "1080p (2)", "File"] and kb[-1][0][1] == "t:4:1:0" and "S1E5" in text
    _, movie_kb = menus.qualities_screen(media, None, None, files)
    assert movie_kb[-1][0][1] == "m:4"


def test_file_captions():
    assert menus.file_caption({"title": "Dune", "release_year": 2021, "season_number": None, "episode_number": None, "quality_resolution": "4K"}) == "Dune (2021) \u00b7 4K"
    assert menus.file_caption({"title": "A <b>", "release_year": None, "season_number": 1, "episode_number": 3, "quality_resolution": None}) == "A &lt;b&gt; \u00b7 S01E03"
    assert menus.file_caption({"title": "A", "release_year": None, "season_number": None, "episode_number": 7, "quality_resolution": None}) == "A \u00b7 E7"
