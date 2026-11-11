import pytest

from config import Config, ConfigError

GOOD = {"API_ID": "123", "API_HASH": "abcdef", "BOT_TOKEN": "111:token", "STORAGE_CHANNEL_ID": "-1001234567890"}


def test_a_complete_environment_loads():
    c = Config.from_env({**GOOD, "ADMIN_IDS": "1, 2;3", "ALLOWED_USER_IDS": "9", "DB_PATH": "x/y.db", "SESSION_NAME": "s"})
    assert (c.api_id, c.storage_channel_id, c.admin_ids, c.allowed_user_ids) == (123, -1001234567890, frozenset({1, 2, 3}), frozenset({9}))
    assert str(c.db_path) == "x/y.db" and c.session_name == "s"


def test_missing_settings_are_listed_together_with_the_fix():
    with pytest.raises(ConfigError) as err:
        Config.from_env({"API_ID": "1"})
    assert "API_HASH, BOT_TOKEN, STORAGE_CHANNEL_ID" in str(err.value) and ".env.example" in str(err.value)
    with pytest.raises(ConfigError):
        Config.from_env({**GOOD, "API_HASH": "   "})


@pytest.mark.parametrize("change,fragment", [({"API_ID": "abc"}, "API_ID"), ({"STORAGE_CHANNEL_ID": "abc"}, "numeric id"),
                                             ({"STORAGE_CHANNEL_ID": "-12345"}, "-100"), ({"STORAGE_CHANNEL_ID": "12345"}, "-100"),
                                             ({"BOT_TOKEN": "nocolon"}, "BOT_TOKEN"), ({"ADMIN_IDS": "1,x"}, "ADMIN_IDS"),
                                             ({"ALLOWED_USER_IDS": "@bob"}, "ALLOWED_USER_IDS")])
def test_bad_values_say_which_setting_is_wrong(change, fragment):
    with pytest.raises(ConfigError, match=fragment):
        Config.from_env({**GOOD, **change})


def test_secrets_never_appear_when_the_config_is_printed():
    text = repr(Config.from_env(GOOD))
    assert "abcdef" not in text and "111:token" not in text


def test_access_rules():
    open_library = Config.from_env(GOOD)
    assert open_library.may_use(5) and open_library.may_use(None)
    closed = Config.from_env({**GOOD, "ALLOWED_USER_IDS": "5", "ADMIN_IDS": "7"})
    assert closed.may_use(5) and closed.may_use(7) and not closed.may_use(6) and not closed.may_use(None)
    assert closed.is_admin(7) and not closed.is_admin(5) and not closed.is_admin(None)
