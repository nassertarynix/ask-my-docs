import os
from pathlib import Path

import pytest

import options as o
from options import OptionError, SEP

Y = ["yt-dlp"]


# ---- URLs ---------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("raw,expected", [("https://youtu.be/abc", "https://youtu.be/abc"), ("  http://example.com/a?b=c#d  ", "http://example.com/a?b=c#d"),
                                          ("youtube.com/watch?v=abc", "https://youtube.com/watch?v=abc"), ("www.example.org", "https://www.example.org")])
def test_good_urls_are_accepted_and_a_missing_scheme_is_added(raw, expected):
    assert o.validate_url(raw) == expected


@pytest.mark.parametrize("bad", [None, "", "   ", "-o /etc/passwd", "--exec rm -rf ~", "file:///etc/passwd", "ftp://host/x", "javascript:alert(1)", "http://",
                                 "https:///path", "https://a b.com", "https://x.com/\nsecond", "data:text/html,hi", "hello world", "http://" + "a" * 3000,
                                 "https://x.com/\x00", "‮https://x.com"])
def test_bad_urls_are_rejected(bad):
    with pytest.raises(OptionError) as err:
        o.validate_url(bad)
    assert err.value.code == "invalid_url"


# ---- argument injection -----------------------------------------------------------------------------------------------------------
def test_the_url_always_follows_a_double_dash_and_is_the_last_argument(tmp_path):
    url = "https://example.com/watch?v=1"
    for cmd in (o.info_command(Y, url, o.Options()), o.download_command(Y, url, o.Options(), format_selection="b", output_dir=tmp_path, temp_dir=tmp_path,
                                                                      extract_audio=False, audio_format="mp3")):
        assert cmd[-2:] == ["--", url] and cmd.count("--") == 1


def test_every_user_controlled_value_is_one_argument_in_flag_equals_value_form(tmp_path):
    opts = o.build_options({"proxy": "socks5://user:pw@127.0.0.1:1080", "user_agent": "My Agent 1.0 (X11; Linux)", "cookies_from_browser": "chrome:Profile 1",
                            "playlist_items": "1-3,5", "container": "mkv"})
    cmd = o.download_command(Y, "https://x.com/v", opts, format_selection="bv*[height<=1080]+ba/b", output_dir=tmp_path / "my dir", temp_dir=tmp_path,
                             extract_audio=True, audio_format="flac")
    for needle in ("--proxy=socks5://user:pw@127.0.0.1:1080", "--user-agent=My Agent 1.0 (X11; Linux)", "--cookies-from-browser=chrome:Profile 1",
                   "--playlist-items=1-3,5", "--format=bv*[height<=1080]+ba/b", f"--paths=home:{tmp_path / 'my dir'}", "--audio-format=flac"):
        assert needle in cmd, needle
    # nothing a user typed appears as its own argument
    assert not [a for a in cmd if a in ("socks5://user:pw@127.0.0.1:1080", "My Agent 1.0 (X11; Linux)", "chrome:Profile 1")]


@pytest.mark.parametrize("fmt", ["bv*+ba/b", "best", "bv*[height<=1080]+ba/b[height<=1080]", "137+140", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                                 "bv*[fps>30]+ba", "b[format_id~='^av01']"])
def test_real_format_expressions_are_accepted(fmt):
    assert o.validate_format_selection(fmt, "x") == fmt


@pytest.mark.parametrize("bad", ["best; rm -rf /", "best\n--exec id", "-f best", "a b", "$(whoami)x`", "best" + "x" * 400, "best\x00", "b{a}", "b\\n"])
def test_dangerous_format_strings_are_rejected(bad):
    with pytest.raises(OptionError):
        o.validate_format_selection(bad, "x")


def test_a_format_that_starts_with_a_dash_cannot_become_a_flag(tmp_path):
    with pytest.raises(OptionError):
        o.validate_format_selection("--exec=id", "x")  # '=' is allowed in selectors, but this also fails: it is not a format
    cmd = o.download_command(Y, "https://x.com/v", o.Options(), format_selection="-best", output_dir=tmp_path, temp_dir=tmp_path, extract_audio=False, audio_format="mp3")
    assert "--format=-best" in cmd and "-best" not in cmd  # even if a value starts with '-', it is one --format=... argument


def test_no_command_line_ever_contains_an_exec_option(tmp_path):
    cmd = o.download_command(Y, "https://x.com/v", o.build_options({}), format_selection="b", output_dir=tmp_path, temp_dir=tmp_path, extract_audio=False, audio_format="mp3")
    assert "--ignore-config" in cmd and not [a for a in cmd if "exec" in a.lower()]


# ---- the other fields --------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("raw,expected", [("http://127.0.0.1:8080", "http://127.0.0.1:8080"), ("socks5://u:p@host:1080", "socks5://u:p@host:1080"),
                                          ("proxy.local:3128", "http://proxy.local:3128"), ("", "")])
def test_proxies(raw, expected):
    assert o.validate_proxy(raw) == expected


@pytest.mark.parametrize("bad", ["ftp://host:21", "http://", "http://host:99999", "http://host :80", "socks5://host\n--exec", "x" * 400, "javascript://x"])
def test_bad_proxies_are_rejected(bad):
    with pytest.raises(OptionError):
        o.validate_proxy(bad)


def test_user_agent_rules():
    assert o.validate_user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36") and o.validate_user_agent("") == ""
    for bad in ("agent\nHeader: x", "a" * 301, "café", "\x00"):
        with pytest.raises(OptionError):
            o.validate_user_agent(bad)


@pytest.mark.parametrize("good", ["chrome", "Firefox", "chrome:Default", "firefox:default-release", "brave:Profile 2"])
def test_browsers(good):
    assert o.validate_browser(good).split(":")[0] in o.BROWSERS


@pytest.mark.parametrize("bad", ["netscape", "chrome:../../x", "chrome:a;b", "chrome:" + "x" * 80, "chrome\n--exec"])
def test_bad_browsers_are_rejected(bad):
    with pytest.raises(OptionError):
        o.validate_browser(bad)


def test_cookie_file_must_be_an_existing_absolute_readable_small_file(tmp_path):
    good = tmp_path / "c.txt"
    good.write_text("# Netscape HTTP Cookie File\n")
    assert o.validate_cookie_file(str(good)) == str(good)
    for bad in ("relative/c.txt", str(tmp_path / "missing.txt"), str(tmp_path), "bad\x00path"):
        with pytest.raises(OptionError):
            o.validate_cookie_file(bad)
    big = tmp_path / "big.txt"
    big.write_bytes(b"x" * (5 * 1024 * 1024 + 1))
    with pytest.raises(OptionError):
        o.validate_cookie_file(str(big))


@pytest.mark.parametrize("good", ["1", "1-3", "1,3,5", "1-3,7,10-", "2:5", "1-3, 5"])
def test_playlist_items(good):
    assert o.validate_playlist_items(good)


@pytest.mark.parametrize("bad", ["a", "1;2", "1-3-5", "--exec", "1,", "1 2" * 3 + "x"])
def test_bad_playlist_items(bad):
    with pytest.raises(OptionError):
        o.validate_playlist_items(bad)


def test_audio_formats_and_containers():
    assert [o.validate_audio_format(f) for f in ("MP3", "m4a", "FLAC")] == ["mp3", "m4a", "flac"] and o.validate_audio_format(None) == "mp3"
    for bad in ("exe", "mp3; rm", "../x"):
        with pytest.raises(OptionError):
            o.validate_audio_format(bad)
    assert o.validate_container("MKV") == "mkv" and o.validate_container("") == ""
    with pytest.raises(OptionError):
        o.validate_container("avi")


# ---- merging options -----------------------------------------------------------------------------------------------------------------------
def test_later_layers_win_and_an_empty_value_clears_an_earlier_one():
    merged = o.build_options({"proxy": "http://a:1", "user_agent": "UA"}, {"proxy": "http://b:2"}, {"user_agent": ""})
    assert (merged.proxy, merged.user_agent) == ("http://b:2", "")


def test_unknown_options_are_rejected_not_ignored():
    for key in ("exec", "downloader_args", "--exec", "cookies"):
        with pytest.raises(OptionError, match="Unknown option"):
            o.build_options({key: "x"})


def test_browser_cookies_and_a_cookie_file_cannot_be_combined(tmp_path):
    f = tmp_path / "c.txt"
    f.write_text("x")
    with pytest.raises(OptionError, match="either"):
        o.build_options({"cookies_from_browser": "chrome", "cookies_file": str(f)})


def test_boolean_options_accept_strings_from_forms():
    assert o.build_options({"no_playlist": "true"}).no_playlist is True and o.build_options({"embed_metadata": "no"}).embed_metadata is False


def test_command_features(tmp_path):
    base = dict(format_selection="b", output_dir=tmp_path, temp_dir=tmp_path, audio_format="mp3")
    audio = o.download_command(Y, "https://x.com/v", o.Options(), extract_audio=True, **base)
    assert "--extract-audio" in audio and "--audio-quality=0" in audio and "--embed-metadata" in audio
    lossless = o.download_command(Y, "https://x.com/v", o.Options(), extract_audio=True, **{**base, "audio_format": "flac"})
    assert "--audio-quality=0" not in lossless
    video = o.download_command(Y, "https://x.com/v", o.build_options({"container": "mp4", "embed_metadata": False}), extract_audio=False, **base)
    assert "--merge-output-format=mp4" in video and "--embed-metadata" not in video and "--extract-audio" not in video
    assert any(a.startswith("--output=") and "playlist" not in a for a in video)
    playlist = o.download_command(Y, "https://x.com/v", o.Options(), extract_audio=False, playlist=True, **base)
    assert any("playlist_title" in a for a in playlist)
    assert o.preset_format(None) == o.DEFAULT_VIDEO_FORMAT and o.preset_format(720) == "bv*[height<=?720]+ba/b[height<=?720]"


def test_output_directory_rules(tmp_path, monkeypatch):
    assert o.resolve_output_dir(str(tmp_path / "new" / "deep"), tmp_path).is_dir()
    assert o.resolve_output_dir("", tmp_path / "dflt") == (tmp_path / "dflt").resolve()
    for bad in ("relative/dir", "bad\x00"):
        with pytest.raises(OptionError):
            o.resolve_output_dir(bad, tmp_path)
    f = tmp_path / "file.txt"
    f.write_text("x")
    with pytest.raises(OptionError, match="file"):
        o.resolve_output_dir(str(f), tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert o.resolve_output_dir("~/vids", tmp_path) == (tmp_path / "vids").resolve()
    if os.geteuid() != 0:  # root can write anywhere
        ro = tmp_path / "ro"
        ro.mkdir()
        ro.chmod(0o500)
        with pytest.raises(OptionError):
            o.resolve_output_dir(str(ro / "sub"), tmp_path)
        ro.chmod(0o700)
