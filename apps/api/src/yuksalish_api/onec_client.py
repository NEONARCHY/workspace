"""Read-only 1C OData discovery. No ledger writes or inferred project attribution."""

from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import quote, urlsplit, urlunsplit

import httpx
from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from pydantic import SecretStr

_MAX_METADATA_BYTES = 8 * 1024 * 1024


class OneCError(Exception):
    """Only a stable code and status may leave the transport; never response bodies."""

    def __init__(self, code: str, status_code: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class OneCConnection:
    infobase_url: str
    username: str | None = field(default=None, repr=False)
    password: SecretStr = field(default_factory=lambda: SecretStr(""), repr=False)

    def __post_init__(self) -> None:
        try:
            parsed = urlsplit(self.infobase_url)
            port = parsed.port
        except ValueError:
            raise OneCError("invalid_configuration") from None
        if (
            parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or port == 0 or any(part in {".", ".."} for part in parsed.path.split("/"))
            or "%" in parsed.path or "\\" in self.infobase_url
            or any(ord(char) < 32 or char.isspace() for char in self.infobase_url)
            or (self.username is not None and (not self.username or ":" in self.username))
        ):
            raise OneCError("invalid_configuration")
        object.__setattr__(self, "infobase_url", urlunsplit((
            parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", "",
        )))

    @property
    def odata_root(self) -> str:
        return f"{self.infobase_url}/odata/standard.odata/"


@dataclass(frozen=True, slots=True)
class OneCProperty:
    name: str
    type: str


@dataclass(frozen=True, slots=True)
class OneCEntity:
    name: str
    entity_type: str
    properties: tuple[OneCProperty, ...]


def parse_metadata(content: bytes) -> tuple[OneCEntity, ...]:
    if len(content) > _MAX_METADATA_BYTES:
        raise OneCError("response_too_large")
    try:
        root = ElementTree.fromstring(content, forbid_dtd=True)
    except (ElementTree.ParseError, DefusedXmlException, ValueError):
        raise OneCError("invalid_metadata") from None
    if root.tag != "{http://schemas.microsoft.com/ado/2007/06/edmx}Edmx":
        raise OneCError("invalid_metadata")
    types: dict[str, tuple[OneCProperty, ...]] = {}
    sets: dict[str, str] = {}
    for schema in root.iter():
        if schema.tag.rsplit("}", 1)[-1] != "Schema":
            continue
        namespace = schema.get("Namespace", "")
        for entity in schema:
            if entity.tag.rsplit("}", 1)[-1] == "EntityType":
                name = entity.get("Name", "")
                types[f"{namespace}.{name}"] = tuple(
                    OneCProperty(prop.get("Name", ""), prop.get("Type", ""))
                    for prop in entity
                    if prop.tag.rsplit("}", 1)[-1] in {"Property", "NavigationProperty"}
                )
            elif entity.tag.rsplit("}", 1)[-1] == "EntityContainer":
                for entity_set in entity:
                    if entity_set.tag.rsplit("}", 1)[-1] != "EntitySet":
                        continue
                    name = entity_set.get("Name", "")
                    type_name = entity_set.get("EntityType", "")
                    if not name or name in sets or not name.replace("_", "").isalnum():
                        raise OneCError("invalid_metadata")
                    sets[name] = type_name
    if not sets:
        raise OneCError("no_published_objects")
    if any(name not in types for name in sets.values()):
        raise OneCError("incomplete_metadata")
    return tuple(OneCEntity(name, kind, types[kind]) for name, kind in sorted(sets.items()))


class OneCReadClient:
    """GET only. Credentials stay on one HTTPS origin; redirects are never followed."""

    def __init__(
        self, connection: OneCConnection, *, transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._connection = connection
        self._client = httpx.AsyncClient(
            auth=httpx.BasicAuth(connection.username, connection.password.get_secret_value())
            if connection.username is not None else None,
            timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=False, trust_env=False,
            transport=transport,
        )

    async def __aenter__(self) -> OneCReadClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._client.aclose()

    async def _get(self, resource: str) -> bytes:
        url = self._connection.odata_root + quote(resource, safe="$")
        try:
            async with self._client.stream("GET", url, headers={"Accept": "application/xml"}) as r:
                if r.status_code != 200:
                    code = {
                        401: "authentication_required", 403: "access_denied",
                        404: "odata_not_found", 429: "rate_limited",
                    }.get(r.status_code, "redirect_refused" if r.is_redirect else "upstream_error")
                    raise OneCError(code, r.status_code)
                content = bytearray()
                async for chunk in r.aiter_bytes(chunk_size=65536):
                    content.extend(chunk)
                    if len(content) > _MAX_METADATA_BYTES:
                        raise OneCError("response_too_large")
                return bytes(content)
        except httpx.TimeoutException:
            raise OneCError("timeout") from None
        except httpx.HTTPError:
            raise OneCError("connection_failed") from None

    async def metadata(self) -> tuple[OneCEntity, ...]:
        return parse_metadata(await self.metadata_xml())

    async def metadata_xml(self) -> bytes:
        return await self._get("$metadata")
