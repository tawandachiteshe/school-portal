import pytest

from app.ocr.national_id import decode, expected_letter

DISTRICTS = {"08": "Bulawayo", "63": "Harare", "29": "Gweru"}


@pytest.mark.parametrize(
    ("reg", "serial", "letter"),
    [("08", "2047823", "Q"), ("63", "1222666", "S")],  # published samples
)
def test_known_samples(reg, serial, letter):
    assert expected_letter(reg, serial) == letter


@pytest.mark.parametrize("raw", ["08-2047823Q29", "082047823Q29", "08-2047823-Q-29", "08 2047823 q 29"])
def test_accepts_common_written_forms(raw):
    d = decode(raw, DISTRICTS)
    assert d is not None
    assert d.normalized == "08-2047823 Q 29"
    assert d.check_letter_valid
    assert (d.reg_district, d.origin_district) == ("Bulawayo", "Gweru")


def test_flags_wrong_check_letter():
    d = decode("63-2047823 P 29", DISTRICTS)
    assert d is not None
    assert not d.check_letter_valid
    assert d.expected_letter == "C"


def test_fixes_ocr_letter_o_in_digits():
    d = decode("O8-2O47823-Q-29")
    assert d is not None and d.normalized == "08-2047823 Q 29" and d.check_letter_valid


def test_unknown_district_is_informational_only():
    d = decode("08-2047823Q99", DISTRICTS)
    assert d is not None and d.check_letter_valid and d.origin_district is None


def test_returns_none_without_an_id():
    assert decode("no id here") is None
