from app.services.names import name_words


def test_names_compare_the_same_on_every_document():
    assert name_words("Chiweshe-Moyo") == name_words("CHIWESHE MOYO") == {"CHIWESHE", "MOYO"}
    assert name_words("O'Brien  Tariro") == {"O", "BRIEN", "TARIRO"}
    assert name_words(None) == set()
