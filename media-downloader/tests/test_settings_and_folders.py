import json
import os
import stat

import pytest

from downloader import list_directories
from options import OptionError
from settings import SettingsStore, mask_proxy

COOKIES = "# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t0\tname\tvalue\n"


@pytest.fixture
def store(tmp_path):
    return SettingsStore(tmp_path / "data")


def test_defaults_when_nothing_is_saved(store):
    pub = store.public()
    assert pub["proxy"] == "" and pub["cookies_uploaded"] is False and pub["default_output_dir"].endswith("Downloads") and pub["embed_metadata"] is True


def test_saving_and_loading_round_trip(store, tmp_path):
    store.update({"user_agent": "UA/1.0", "container": "mkv", "default_output_dir": str(tmp_path / "vids"), "embed_metadata": False})
    again = SettingsStore(tmp_path / "data").public()
    assert (again["user_agent"], again["container"], again["embed_metadata"]) == ("UA/1.0", "mkv", False) and (tmp_path / "vids").is_dir()


def test_the_settings_file_is_private(store):
    store.update({"proxy": "http://u:secret@127.0.0.1:8080"})
    assert stat.S_IMODE(os.stat(store.path).st_mode) == 0o600


def test_proxy_passwords_are_never_returned(store):
    pub = store.update({"proxy": "socks5://user:hunter2@127.0.0.1:1080"})
    assert "hunter2" not in json.dumps(pub) and pub["proxy"] == "socks5://***@127.0.0.1:1080"
    assert "hunter2" in store.path.read_text()  # but it is saved, so downloads can use it


def test_sending_the_masked_proxy_back_keeps_the_saved_one(store):
    store.update({"proxy": "socks5://user:hunter2@127.0.0.1:1080"})
    store.update({"proxy": "socks5://***@127.0.0.1:1080", "user_agent": "x"})
    assert store.options_layer()["proxy"] == "socks5://user:hunter2@127.0.0.1:1080"
    store.update({"proxy": ""})
    assert store.options_layer()["proxy"] == ""


def test_mask_proxy():
    assert mask_proxy("") == "" and mask_proxy("http://host:80") == "http://host:80" and mask_proxy("http://a:b@h:1/p") == "http://***@h:1/p"


def test_an_invalid_value_saves_nothing(store):
    store.update({"user_agent": "good"})
    with pytest.raises(OptionError):
        store.update({"user_agent": "changed", "proxy": "ftp://nope"})
    assert store.public()["user_agent"] == "good"


def test_unknown_keys_in_an_update_are_ignored_not_saved(store):
    store.update({"exec": "rm -rf ~", "user_agent": "ok"})
    assert "exec" not in store.load()


def test_a_cookies_file_can_be_uploaded_then_removed(store):
    pub = store.save_cookie_file(COOKIES.encode())
    assert pub["cookies_uploaded"] is True and stat.S_IMODE(os.stat(store.cookies_path).st_mode) == 0o600
    assert store.options_layer()["cookies_file"] == str(store.cookies_path)
    pub = store.delete_cookie_file()
    assert pub["cookies_uploaded"] is False and not store.cookies_path.exists() and store.options_layer().get("cookies_file", "") == ""


@pytest.mark.parametrize("content", [b"just some text", b"\xff\xfe\x00binary", b"", b"x" * (2 * 1024 * 1024 + 10)])
def test_files_that_are_not_cookie_files_are_refused(store, content):
    with pytest.raises(OptionError):
        store.save_cookie_file(content)
    assert not store.cookies_path.exists()


def test_a_cookie_file_without_the_header_is_accepted_if_the_lines_look_right(store):
    store.save_cookie_file(b".example.com\tTRUE\t/\tFALSE\t0\tname\tvalue\n")
    assert store.cookies_path.exists()


def test_choosing_browser_cookies_replaces_an_uploaded_file_and_the_other_way_round(store):
    store.save_cookie_file(COOKIES.encode())
    store.update({"cookies_from_browser": "firefox"})
    assert store.options_layer().get("cookies_file", "") == "" and store.options_layer()["cookies_from_browser"] == "firefox"
    store.save_cookie_file(COOKIES.encode())
    assert store.options_layer()["cookies_from_browser"] == ""


# ---- the folder browser --------------------------------------------------------------------------------------------------------------------------
def test_listing_a_folder_shows_only_sub_folders_sorted_and_hides_dot_folders(tmp_path):
    for name in ("beta", "Alpha", ".hidden", "gamma"):
        (tmp_path / name).mkdir()
    (tmp_path / "file.txt").write_text("x")
    listing = list_directories(str(tmp_path))
    assert [e["name"] for e in listing["entries"]] == ["Alpha", "beta", "gamma"] and listing["parent"] == str(tmp_path.parent) and listing["writable"] is True
    assert ".hidden" in [e["name"] for e in list_directories(str(tmp_path), show_hidden=True)["entries"]]


def test_a_path_that_does_not_exist_falls_back_to_the_nearest_folder(tmp_path):
    assert list_directories(str(tmp_path / "no" / "such" / "dir"))["path"] == str(tmp_path)


def test_a_file_path_lists_its_folder_and_relative_paths_start_at_home(tmp_path):
    f = tmp_path / "f.txt"
    f.write_text("x")
    assert list_directories(str(f))["path"] == str(tmp_path)
    assert list_directories("relative/thing")["path"] == list_directories("")["path"]


def test_the_root_has_no_parent():
    assert list_directories("/")["parent"] is None


def test_a_very_large_folder_is_capped(tmp_path):
    for i in range(30):
        (tmp_path / f"d{i:02d}").mkdir()
    assert len(list_directories(str(tmp_path), limit=10)["entries"]) == 10
