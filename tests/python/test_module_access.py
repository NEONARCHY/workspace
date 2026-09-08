from yuksalish_api.access_control import normalize_permissions, request_module_action


def test_permission_normalization_preserves_safe_dependencies() -> None:
    assert normalize_permissions(
        {"view": False, "create": True, "edit": False, "approve": False, "admin": False}
    ) == {
        "view": True,
        "create": True,
        "edit": False,
        "approve": False,
        "admin": False,
    }
    assert all(
        normalize_permissions(
            {"view": False, "create": False, "edit": False, "approve": False, "admin": True}
        ).values()
    )
    assert not any(normalize_permissions({}).values())


def test_request_paths_map_to_server_enforced_module_actions() -> None:
    assert request_module_action("/api/v1/workspace/bootstrap", "GET") is None
    assert request_module_action("/api/v1/directory", "GET") == ("employees", "view")
    assert request_module_action("/api/v1/directory/departments", "POST") == (
        "employees",
        "admin",
    )
    assert request_module_action("/api/v1/tasks", "POST") == ("tasks", "create")
    assert request_module_action("/api/v1/tasks/task-id", "PATCH") == ("tasks", "edit")
    assert request_module_action(
        "/api/v1/approval-requests/request-id/actions", "POST"
    ) == ("payment_requests", "view")
    assert request_module_action("/api/v1/tasks/id/accept-result", "POST") == (
        "tasks",
        "approve",
    )
    assert request_module_action("/api/v1/auth/invitations", "POST") == (
        "employees",
        "admin",
    )
    assert request_module_action("/api/v1/approval-templates/id/publish", "POST") == (
        "payment_requests",
        "admin",
    )
