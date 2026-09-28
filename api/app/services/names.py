import re


def name_words(s: str | None) -> set[str]:
    """The words of a name as documents print it, for comparing an ID, a certificate and a slip:
    upper case, with hyphens and apostrophes as breaks ("Chiweshe-Moyo" → {"CHIWESHE", "MOYO"})."""
    return set(re.sub(r"[^A-Z ]", " ", (s or "").upper()).split())
