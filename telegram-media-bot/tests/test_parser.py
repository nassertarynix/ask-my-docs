import datetime
import random
import string

import pytest

from parser import complete_metadata, normalize_resolution, normalize_type, parse_caption

TODAY = datetime.date(2026, 6, 1)
SPEC_EXAMPLE = '---\ntitle: "Attack on Titan"\ntype: "Anime"\nyear: 2013\nseason: 1\nepisode: 1\nresolution: "1080p"\ngenres: ["Action", "Fantasy"]\n---'


def test_the_example_from_the_specification_parses_to_database_fields():
    assert parse_caption(SPEC_EXAMPLE, TODAY) == {
        "title": "Attack on Titan", "type": "Anime", "release_year": 2013, "season_number": 1, "episode_number": 1,
        "quality_resolution": "1080p", "genre": "Action, Fantasy"}


def test_a_yaml_block_can_sit_inside_other_text_and_a_code_fence():
    caption = "New upload!\n```yaml\n---\ntitle: Dune\ntype: movie\nyear: 2021\nresolution: 4k\n---\n```\nEnjoy #SciFi"
    assert parse_caption(caption, TODAY) == {"title": "Dune", "type": "Movie", "release_year": 2021, "quality_resolution": "4K", "genre": "SciFi"}


def test_plain_key_value_lines_and_hashtags_still_work():
    caption = "Title: Breaking Bad\nType: Show\nYear: 2008\nSeason: 2\nEpisode: 5\nResolution: 720P\n#Crime #Drama"
    assert parse_caption(caption, TODAY) == {"title": "Breaking Bad", "type": "Show", "release_year": 2008, "season_number": 2,
                                             "episode_number": 5, "quality_resolution": "720p", "genre": "Crime, Drama"}


def test_hashtags_fill_in_when_the_yaml_block_has_no_genre():
    meta = parse_caption("---\ntitle: X\ntype: Movie\n---\n#Horror #Thriller", TODAY)
    assert meta["genre"] == "Horror, Thriller"


def test_the_yaml_genre_wins_over_hashtags():
    assert parse_caption("---\ntitle: X\ntype: Movie\ngenre: Comedy\n---\n#Horror", TODAY)["genre"] == "Comedy"


@pytest.mark.parametrize("raw,expected", [("1080P", "1080p"), ("1080", "1080p"), (1080, "1080p"), ("4k", "4K"), ("4K", "4K"), (" 720p ", "720p"),
                                          ("1080p Dub", "1080p Dub"), ("", None), (None, None), ("x" * 100, "x" * 32)])
def test_resolutions_are_normalised(raw, expected):
    assert normalize_resolution(raw) == expected


@pytest.mark.parametrize("raw,expected", [("movie", "Movie"), ("FILM", "Movie"), ("Anime", "Anime"), ("tv", "Show"), ("TV Series", "Show"),
                                          ("show", "Show"), ("documentary", None), ("", None), (None, None), (5, None)])
def test_types_are_normalised(raw, expected):
    assert normalize_type(raw) == expected


@pytest.mark.parametrize("year,kept", [(1879, False), (1880, True), (2013, True), (2031, True), (2032, False), ("2013", True), ("20x3", False), (True, False), (20.5, False)])
def test_years_are_range_checked(year, kept):
    from parser import _normalize
    assert ("release_year" in _normalize({"title": "T", "year": year}, TODAY)) is kept


@pytest.mark.parametrize("value,kept", [(1, 1), ("2", 2), (0, 0), (-1, None), (1000, None), (True, None), ("one", None), (1.0, 1), (1.5, None), ("3 4", None)])
def test_seasons_are_whole_numbers_in_range(value, kept):
    from parser import _normalize
    assert _normalize({"title": "T", "season": value}).get("season_number") == kept


def test_titles_are_cleaned():
    from parser import _normalize
    assert _normalize({"title": '  “The   Matrix”  '})["title"] == "The Matrix"
    assert len(_normalize({"title": "x" * 500})["title"]) == 200
    assert "title" not in _normalize({"title": "   "})
    assert "title" not in _normalize({"title": ["a"]})


def test_alternative_key_names_are_accepted_and_the_first_spelling_wins():
    meta = parse_caption("---\nName: Foo\nKind: tv\nS: 2\nEp: 7\nQuality: 1080\n---", TODAY)
    assert meta == {"title": "Foo", "type": "Show", "season_number": 2, "episode_number": 7, "quality_resolution": "1080p"}
    assert parse_caption("---\ntitle: First\nname: Second\n---", TODAY)["title"] == "First"


def test_a_title_with_a_colon_in_a_broken_block_is_still_found():
    assert parse_caption("---\nTitle: Star Trek: Voyager\nType: Show\n---", TODAY) == {"title": "Star Trek: Voyager", "type": "Show"}


def test_broken_yaml_falls_back_to_plain_lines():
    caption = "---\ntitle: [unclosed\n---\nTitle: Fallback Title\nType: Movie"
    assert parse_caption(caption, TODAY) == {"title": "Fallback Title", "type": "Movie"}


def test_the_first_usable_block_is_used():
    caption = "---\nnot: useful\n---\ntext\n---\ntitle: Real\ntype: Movie\n---"
    assert parse_caption(caption, TODAY)["title"] == "Real"


def test_a_hostile_yaml_payload_is_data_not_code():
    caption = "---\ntitle: !!python/object/apply:os.system ['echo pwned > /tmp/pwned']\n---"
    assert parse_caption(caption, TODAY) == {}


@pytest.mark.parametrize("caption", [None, "", "   ", "just a sentence", 42, b"bytes", ["title: x"], "---\n---", "---\n- a\n- b\n---"])
def test_nothing_useful_gives_an_empty_dict(caption):
    assert parse_caption(caption, TODAY) == {}


def test_windows_line_endings_work():
    assert parse_caption("---\r\ntitle: A\r\ntype: Movie\r\n---", TODAY) == {"title": "A", "type": "Movie"}


def test_non_latin_titles_are_kept():
    meta = parse_caption("---\ntitle: 進撃の巨人\ntype: Anime\n---", TODAY)
    assert meta["title"] == "進撃の巨人"
    assert parse_caption("Title: الملك\nType: Movie", TODAY)["title"] == "الملك"


def test_the_parser_never_raises_on_random_input():
    rng = random.Random(1)
    alphabet = string.printable + "—“” 進"
    for _ in range(400):
        text = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 200)))
        assert isinstance(parse_caption(text, TODAY), dict)
        assert isinstance(parse_caption("---\n" + text + "\n---", TODAY), dict)


def test_a_title_is_required():
    assert complete_metadata({"type": "Movie"}) == (None, ["no title"])


def test_a_missing_type_is_inferred_and_reported_but_anime_is_never_guessed():
    assert complete_metadata({"title": "A"})[0]["type"] == "Movie"
    meta, notes = complete_metadata({"title": "A", "season_number": 1})
    assert meta["type"] == "Show" and any("assumed Show" in n for n in notes)


def test_an_episode_without_a_season_goes_in_season_one():
    meta, notes = complete_metadata({"title": "A", "type": "Anime", "episode_number": 4})
    assert meta["season_number"] == 1 and notes


def test_a_movie_never_has_season_or_episode():
    meta, _ = complete_metadata({"title": "A", "type": "Movie", "season_number": 1, "episode_number": 1})
    assert "season_number" not in meta and "episode_number" not in meta
