"""The public assistant choices must remain on the budget Flash family."""

from yuksalish_api.assistant_service import MODELS
from yuksalish_api.routers.assistant import AskRequest


def test_default_choice_uses_flash_lite() -> None:
    assert AskRequest(message="Здравствуйте").model == "flash-lite"
    assert MODELS == {
        "flash-lite": "gemini-3.5-flash-lite",
        "flash": "gemini-3.5-flash",
        "pro": "gemini-3.8-flash",
    }
