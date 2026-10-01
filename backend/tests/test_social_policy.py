try:
    from app.services.social_policy import normalize_chat_text
except ModuleNotFoundError:
    normalize_chat_text = None


def test_normalize_chat_text_removes_controls_and_preserves_emoji():
    assert callable(normalize_chat_text)
    assert normalize_chat_text("  Hola\x00 👨‍👩‍👧‍👦\x7f \t") == "Hola 👨‍👩‍👧‍👦"
