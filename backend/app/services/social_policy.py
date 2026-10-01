"""Pure validation and normalization rules for social room features."""

from unicodedata import category


REACTION_IDS = frozenset(
    {"laugh", "cry", "angry", "cool", "shocked", "heart", "applause"}
)
GIFT_IDS = frozenset({"rose", "tomato", "applause", "confetti", "heart", "fire"})
DICE_SKIN_IDS = frozenset({"classic", "brass", "jade", "midnight"})
PIECE_SKIN_IDS = frozenset({"classic", "porcelain", "walnut", "glow"})


def normalize_chat_text(text: str) -> str:
    """Remove Unicode control/surrogate code points and trim outer whitespace.

    Format characters such as the zero-width joiner are intentionally retained
    so emoji sequences and scripts that use them render correctly.
    """
    if not isinstance(text, str):
        return ""
    return "".join(character for character in text if category(character) not in {"Cc", "Cs"}).strip()
