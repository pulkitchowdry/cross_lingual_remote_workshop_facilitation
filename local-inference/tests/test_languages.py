from app.languages import FLORES_CODE, PIPER_VOICE, SUPPORTED, WHISPER_CODE, is_supported


def test_supported_languages_have_full_coverage():
    for language in SUPPORTED:
        assert language in FLORES_CODE
        assert language in WHISPER_CODE
        assert language in PIPER_VOICE


def test_is_supported():
    assert is_supported("en")
    assert not is_supported("fr")
