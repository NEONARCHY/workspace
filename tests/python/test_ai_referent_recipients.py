"""Address-book search remains usable across Cyrillic and Latin input."""

from yuksalish_api.ai_referent_recipient_service import RecipientEntry, search_recipients


def test_recipient_search_is_compact_and_transliterated() -> None:
    entries = [
        RecipientEntry(
            id="ministry", name="Министерство финансов", category_key="ministries",
            addresses=["FIN-001"], route="exat", address_book_organization="Минфин",
        ),
        RecipientEntry(
            id="agency", name="Агентство развития", category_key="agencies",
            addresses=["AG-002"], route="exat",
        ),
    ]
    page, total = search_recipients(entries, "finans", "", 0, 8)
    assert total == 1
    assert [entry.id for entry in page] == ["ministry"]
    page, total = search_recipients(entries, "", "ministries", 0, 8)
    assert total == 1
    assert page[0].addresses == ["FIN-001"]
    assert search_recipients(entries, "", "", 1, 1)[0][0].id == "agency"
