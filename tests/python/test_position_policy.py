from yuksalish_api.position_policy import (
    EXECUTIVE_LEADER_POSITION_NAME,
    is_executive_leader,
)


def test_executive_leader_position_is_matched_exactly_and_safely() -> None:
    assert is_executive_leader(EXECUTIVE_LEADER_POSITION_NAME)
    assert is_executive_leader(f"  {EXECUTIVE_LEADER_POSITION_NAME.upper()}  ")
    assert not is_executive_leader(None)
    assert not is_executive_leader("Руководитель отдела")
    assert not is_executive_leader("Yuksalish harakati raisi")
