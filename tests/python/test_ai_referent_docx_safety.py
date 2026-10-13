"""DOCX relationship checks for AI Referent letter uploads."""

from io import BytesIO
from zipfile import ZipFile

import pytest

from yuksalish_api.ai_referent_docx_safety import has_disallowed_external_relationships

_RELATIONSHIP_PREFIX = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _package(*relationships: tuple[str, str, str]) -> ZipFile:
    content = BytesIO()
    with ZipFile(content, "w") as package:
        package.writestr("word/document.xml", "<document />")
        for index, (location, kind, target) in enumerate(relationships):
            package.writestr(
                location,
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
                'relationships"><Relationship Id="rId'
                f'{index}" Type="{_RELATIONSHIP_PREFIX}/{kind}" '
                f'Target="{target}" TargetMode="External" /></Relationships>',
            )
    content.seek(0)
    return ZipFile(content)


def test_web_and_email_hyperlinks_are_allowed_in_body_and_footer():
    with _package(
        ("word/_rels/document.xml.rels", "hyperlink", "https://example.org"),
        ("word/_rels/footer2.xml.rels", "hyperlink", "mailto:office@example.org"),
    ) as package:
        assert not has_disallowed_external_relationships(package)


@pytest.mark.parametrize(
    ("kind", "target"),
    [
        ("image", "https://example.org/image.png"),
        ("hyperlink", "file:///C:/private.txt"),
        ("hyperlink", "javascript:alert(1)"),
        ("hyperlink", "\\\\server\\share\\file.docx"),
    ],
)
def test_external_resources_and_unsafe_hyperlinks_remain_blocked(kind, target):
    with _package(("word/_rels/document.xml.rels", kind, target)) as package:
        assert has_disallowed_external_relationships(package)


def test_malformed_relationships_are_blocked():
    content = BytesIO()
    with ZipFile(content, "w") as package:
        package.writestr("word/_rels/document.xml.rels", "<Relationships")
    content.seek(0)
    with ZipFile(content) as package:
        assert has_disallowed_external_relationships(package)
