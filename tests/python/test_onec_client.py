"""1C discovery uses synthetic metadata and an intercepted transport; no live writes."""

import base64
from dataclasses import asdict

import httpx
import pytest
from pydantic import SecretStr

from yuksalish_api.onec_client import (
    OneCConnection,
    OneCError,
    OneCReadClient,
    parse_metadata,
)

METADATA = b'''<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0">
 <edmx:DataServices>
  <Schema xmlns="http://schemas.microsoft.com/ado/2009/11/edm" Namespace="StandardODATA">
   <EntityType Name="Catalog_Projects">
    <Key><PropertyRef Name="Ref_Key"/></Key>
    <Property Name="Ref_Key" Type="Edm.Guid"/>
    <Property Name="Description" Type="Edm.String"/>
    <NavigationProperty Name="Owner" Type="StandardODATA.Catalog_Organizations"/>
   </EntityType>
   <EntityContainer Name="StandardODATA" IsDefaultEntityContainer="true">
    <EntitySet Name="Catalog_Projects" EntityType="StandardODATA.Catalog_Projects"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>'''


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_discovery_reports_property_types_but_does_not_infer_financial_meaning() -> None:
    entities = parse_metadata(METADATA)
    assert len(entities) == 1
    assert asdict(entities[0]) == {
        "name": "Catalog_Projects", "entity_type": "StandardODATA.Catalog_Projects",
        "properties": (
            {"name": "Ref_Key", "type": "Edm.Guid"},
            {"name": "Description", "type": "Edm.String"},
            {"name": "Owner", "type": "StandardODATA.Catalog_Organizations"},
        ),
    }


@pytest.mark.parametrize("url", [
    "http://one-c.example/Base", "file:///Base", "https://",
    "https://user:secret@one-c.example/Base", "https://one-c.example/Base?token=secret",
    "https://one-c.example/Base#token", "https://one-c.example:wrong/Base",
    "https://one-c.example:0/Base", "https://one-c.example/Base/../Other",
    "https://one-c.example/Base/%2e%2e/Other", "https://one-c.example/\\Other",
    "https://one-c.example/Base\n", "https://one-c.example/Base Name",
])
def test_invalid_connection_is_rejected_before_sending_credentials(url: str) -> None:
    with pytest.raises(OneCError, match="invalid_configuration"):
        OneCConnection(url)


def test_connection_masks_credentials_and_normalizes_only_the_trailing_slash() -> None:
    connection = OneCConnection("https://one-c.example/Base/", "operator", SecretStr("secret"))
    assert connection.odata_root == "https://one-c.example/Base/odata/standard.odata/"
    assert "secret" not in repr(connection)
    assert "operator" not in repr(connection)
    with pytest.raises(OneCError, match="invalid_configuration"):
        OneCConnection("https://one-c.example/Base", "wrong:username")


@pytest.mark.parametrize("content", [
    b"<html>Sign in</html>", b"not xml", b"<edmx:Edmx", b"<Edmx/>",
    b'<!DOCTYPE Edmx [<!ENTITY leak SYSTEM "file:///secret">]><Edmx>&leak;</Edmx>',
])
def test_malformed_and_unsafe_metadata_is_rejected(content: bytes) -> None:
    with pytest.raises(OneCError, match="invalid_metadata"):
        parse_metadata(content)


def test_partial_metadata_is_not_reported_as_a_working_integration() -> None:
    with pytest.raises(OneCError, match="incomplete_metadata"):
        parse_metadata(METADATA.replace(b"StandardODATA.Catalog_Projects\"/>", b"Missing\"/>"))
    with pytest.raises(OneCError, match="invalid_metadata"):
        parse_metadata(METADATA.replace(
            b"</EntityContainer>",
            b'<EntitySet Name="Catalog_Projects" EntityType="Another"/></EntityContainer>',
        ))


def test_empty_publication_is_distinguished_from_network_or_password_failure() -> None:
    empty = b'''<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
      <edmx:DataServices><Schema xmlns="http://schemas.microsoft.com/ado/2009/11/edm"
        Namespace="StandardODATA"><ComplexType Name="TypeDescription"/>
        <EntityContainer Name="EnterpriseV8"/></Schema></edmx:DataServices></edmx:Edmx>'''
    with pytest.raises(OneCError, match="no_published_objects"):
        parse_metadata(empty)


@pytest.mark.anyio
async def test_anonymous_discovery_sends_exactly_one_get_without_credentials() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=METADATA)

    async with OneCReadClient(OneCConnection("https://one-c.example/Base"),
                             transport=httpx.MockTransport(handler)) as client:
        assert len(await client.metadata()) == 1
    assert len(seen) == 1
    assert seen[0].method == "GET"
    assert seen[0].url.path == "/Base/odata/standard.odata/$metadata"
    assert seen[0].content == b""
    assert "Authorization" not in seen[0].headers


@pytest.mark.anyio
async def test_cyrillic_credentials_use_utf8_and_are_not_in_urls_or_results() -> None:
    username = "Оператор"
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=METADATA)

    connection = OneCConnection("https://one-c.example/Base", username, SecretStr("secret"))
    async with OneCReadClient(connection, transport=httpx.MockTransport(handler)) as client:
        result = await client.metadata()
    authorization = seen[0].headers["Authorization"].removeprefix("Basic ")
    assert base64.b64decode(authorization).decode("utf-8") == f"{username}:secret"
    assert "secret" not in str(seen[0].url) + repr(result)


@pytest.mark.anyio
@pytest.mark.parametrize(("status", "code"), [
    (301, "redirect_refused"), (302, "redirect_refused"), (307, "redirect_refused"),
    (401, "authentication_required"), (403, "access_denied"), (404, "odata_not_found"),
    (429, "rate_limited"), (500, "upstream_error"), (503, "upstream_error"),
])
async def test_errors_are_sanitized_without_redirects_or_repeated_logins(
    status: int, code: str,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, headers={"Location": "https://other.example/steal"},
                              text="private upstream details and secret")

    async with OneCReadClient(OneCConnection("https://one-c.example/Base", "operator",
                                           SecretStr("secret")),
                             transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(OneCError) as caught:
            await client.metadata()
    assert caught.value.code == code
    assert caught.value.status_code == status
    assert str(caught.value) == code
    assert len(seen) == 1
    assert seen[0].url.host == "one-c.example"


@pytest.mark.anyio
@pytest.mark.parametrize(("error_type", "code"), [
    (httpx.ReadTimeout, "timeout"), (httpx.ConnectError, "connection_failed"),
])
async def test_network_failure_is_not_reported_as_an_empty_success(
    error_type: type[httpx.RequestError], code: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error_type("private diagnostic secret", request=request)

    async with OneCReadClient(OneCConnection("https://one-c.example/Base"),
                             transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(OneCError, match=code):
            await client.metadata()


@pytest.mark.anyio
async def test_response_size_is_bounded_in_transport_and_parser(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("yuksalish_api.onec_client._MAX_METADATA_BYTES", 32)
    with pytest.raises(OneCError, match="response_too_large"):
        parse_metadata(METADATA)
    transport = httpx.MockTransport(lambda _: httpx.Response(200, content=METADATA))
    async with OneCReadClient(OneCConnection("https://one-c.example/Base"),
                             transport=transport) as client:
        with pytest.raises(OneCError, match="response_too_large"):
            await client.metadata()
