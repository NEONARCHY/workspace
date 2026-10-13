"""Safety checks shared by online and offline DOCX attachment uploads."""

from urllib.parse import urlsplit
from zipfile import ZipFile

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import ParseError

_HYPERLINK_RELATIONSHIP_TYPES = {
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
    "http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink",
}
_SAFE_HYPERLINK_SCHEMES = {"http", "https", "mailto"}


def has_disallowed_external_relationships(package: ZipFile) -> bool:
    """Allow web/email hyperlinks, but not externally loaded DOCX resources."""
    for item in package.infolist():
        if not item.filename.lower().endswith(".rels"):
            continue
        try:
            relationships = ElementTree.fromstring(package.read(item))
        except (ParseError, DefusedXmlException):
            return True
        for relationship in relationships:
            if relationship.attrib.get("TargetMode", "").lower() != "external":
                continue
            if relationship.attrib.get("Type") not in _HYPERLINK_RELATIONSHIP_TYPES:
                return True
            try:
                scheme = urlsplit(relationship.attrib.get("Target", "")).scheme.lower()
            except ValueError:
                return True
            if scheme not in _SAFE_HYPERLINK_SCHEMES:
                return True
    return False
