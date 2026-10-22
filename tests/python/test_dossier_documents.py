from datetime import date
from io import BytesIO
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from defusedxml.ElementTree import fromstring
from PIL import Image
from pydantic import ValidationError

from yuksalish_api.dossier_documents import NS, TEMPLATE, render_dossier_docx
from yuksalish_api.dossier_import import parse_dossier
from yuksalish_api.dossier_schemas import DossierDetail, DossierFields, DossierPermissions


def sample_record() -> DossierDetail:
    return DossierDetail(
        user_id=uuid4(), full_name="Тестовый Сотрудник Полное ФИО", job_title="Тестовая должность",
        revision=1, status="saved", updated_at=None,
        permissions=DossierPermissions(can_view=True, can_edit=True),
        fields=DossierFields(
            birth_date=date(1991, 5, 12), birth_place="Тестовый город",
            appointment_date=date(2025, 3, 14), nationality="Тестовое значение",
            party_membership="Тестовое значение", education_level="олий",
            education=[{"institution": "Тестовый университет", "startYear": 2008,
                        "graduationYear": 2013, "specialty": "Тестовая специальность",
                        "qualification": "Бакалавр"}],
            academic_degree="Тестовое значение", academic_title="Тестовое значение",
            military_rank="Тестовое значение", languages="Ўзбекча, русский",
            awards="Тестовое значение", elected_membership="Тестовое значение",
            employment=[{"organization": "Тестовая организация", "position": "Специалист",
                         "startDate": f"{2010 + i * 2}-01-01",
                         "endDate": f"{2011 + i * 2}-12-31" if i < 5 else None}
                        for i in range(6)],
            relatives=[{"relationship": "Тестовое родство", "fullName": f"Тестовый Родственник {i}",
                        "birthYear": 1960 + i, "birthPlace": "Тестовый город",
                        "workplacePosition": "Тестовая работа", "address": "Тестовый адрес"}
                       for i in range(9)],
        ),
    )


def xml(content: bytes):
    with ZipFile(BytesIO(content)) as document:
        return fromstring(document.read("word/document.xml"))


def test_template_keeps_owner_layout_and_is_anonymous():
    with ZipFile(TEMPLATE) as template:
        root = fromstring(template.read("word/document.xml"))
        assert len(root.findall(".//w:sectPr", NS)) == 2
        sections = root.findall(".//w:sectPr", NS)
        for section in sections:
            assert section.find("w:pgSz", NS).attrib == {
                f"{{{NS['w']}}}w": "11906", f"{{{NS['w']}}}h": "16838",
            }
        text = " ".join(node.text or "" for node in root.findall(".//w:t", NS))
        assert "{{fullName}}" in text and "{{relative4}}" in text
        assert not any(char.isdigit() for char in text.replace("relative", "").translate(
            str.maketrans("", "", "01234")))
        for name in ("docProps/core.xml", "docProps/app.xml"):
            assert not list(fromstring(template.read(name)))
        # No original portrait survives in a neutral template.
        photo = template.read("word/media/image1.jpeg")
        assert len(photo) < 4000
        with Image.open(BytesIO(photo)) as image:
            assert image.getextrema() == ((255, 255), (255, 255), (255, 255))


def test_word_contains_all_saved_fields_and_repeats_rows_without_original_values():
    record = sample_record()
    content = render_dossier_docx(record)
    root = xml(content)
    text = " ".join(n.text or "" for n in root.findall(".//w:t", NS))
    assert "{{" not in text
    for value in (record.full_name, "12.05.1991", "14 мартдан", "Тестовый университет",
                  "2008\u20132013", "Тестовая специальность", "Бакалавр", "Тестовый адрес"):
        assert value in text
    work, relatives = root.findall("w:body/w:tbl", NS)
    assert len(work.findall("w:tr", NS)) == 19
    assert len(relatives.findall("w:tr", NS)) == 10
    assert relatives.find("w:tr/w:trPr/w:tblHeader", NS) is not None
    assert relatives.find("w:tblPr/w:tblpPr", NS) is None
    assert "йўқ" not in text  # Never infer an absence from an empty field.


def test_values_are_xml_escaped_and_template_markers_in_data_are_not_evaluated():
    record = sample_record()
    record.fields.birth_place = '<script>& {{fullName}}\n' + 'Тестовый город'
    record.fields.additional_info = "Дополнение & проверка"
    root = xml(render_dossier_docx(record))
    text = " ".join(n.text or "" for n in root.findall(".//w:t", NS))
    assert '<script>& {{fullName}}' in text
    assert "Дополнение & проверка" in text
    assert root.find(".//w:br", NS) is not None
    for bad in ("bad\x00text", "bad\x1btext", "bad\ud800text"):
        with pytest.raises(ValidationError):
            DossierFields(birth_place=bad)
    with pytest.raises(ValidationError):
        DossierFields(education=[{"institution": "QA", "startYear": 2020,
                                  "graduationYear": 2010}])
    with pytest.raises(ValidationError):
        DossierFields(relatives=[{"relationship": "QA", "fullName": "QA", "birthYear": 2100}])


def test_empty_fields_are_blank_not_negative_and_photo_has_no_distortion_or_metadata():
    record = sample_record()
    record.fields = DossierFields()
    portrait = BytesIO()
    Image.new("RGB", (800, 400), "red").save(portrait, "PNG")
    content = render_dossier_docx(record, portrait.getvalue())
    text = " ".join(n.text or "" for n in xml(content).findall(".//w:t", NS))
    assert "йўқ" not in text and "{{" not in text
    with (ZipFile(BytesIO(content)) as document,
          Image.open(BytesIO(document.read("word/media/image1.jpeg"))) as image):
        assert image.size == (600, 800)
        assert image.getpixel((0, 0)) == (255, 255, 255)
        assert image.getpixel((300, 400))[0] > 200
        assert not image.getexif()
    with pytest.raises(ValueError, match="Фотография"):
        render_dossier_docx(record, b"not a photo")


def patch_package(content, name, replacement):
    output = BytesIO()
    with ZipFile(BytesIO(content)) as source, ZipFile(output, "w", ZIP_DEFLATED) as target:
        for entry in source.infolist():
            target.writestr(entry.filename, replacement if entry.filename == name
                            else source.read(entry.filename))
    return output.getvalue()


def test_import_preview_roundtrip_preserves_year_precision_without_mutating_identity():
    original = sample_record()
    original.fields.additional_info = "Тестовые сведения вне таблицы"
    preview = parse_dossier(render_dossier_docx(original))
    assert preview.source_full_name == original.full_name
    assert preview.source_job_title == original.job_title
    assert preview.fields.birth_date == original.fields.birth_date
    assert preview.fields.appointment_date == original.fields.appointment_date
    assert preview.fields.education == original.fields.education
    assert len(preview.fields.employment) == 6 and len(preview.fields.relatives) == 9
    assert preview.fields.employment[0].period == "2010-2011 йй."
    assert preview.fields.employment[0].start_date is None
    assert "Тестовые сведения вне таблицы" in preview.unrecognized_text
    assert "fullName" not in preview.detected_fields and "jobTitle" not in preview.detected_fields


def test_import_run_fragments_unseparated_work_and_education_years_without_spaces():
    original = sample_record()
    original.fields.education[0].start_year = 2017
    original.fields.education[0].graduation_year = 2021
    content = render_dossier_docx(original)
    with ZipFile(BytesIO(content)) as source:
        document = source.read("word/document.xml").decode()
    document = document.replace("2017\u20132021 й.,", "2017й \u2013 2021й,")
    document = document.replace("Тестовая организация · Специалист",
                                "Работа без явного разделителя")
    preview = parse_dossier(patch_package(content, "word/document.xml", document.encode()))
    assert preview.fields.education[0].start_year == 2017
    assert preview.fields.education[0].graduation_year == 2021
    assert all(row.position == "Работа без явного разделителя" and not row.organization
               for row in preview.fields.employment)


@pytest.mark.parametrize("kind", ["external", "entity", "tracked", "macro", "zip-bomb", "fake"])
def test_import_rejects_unsafe_or_invalid_word_without_execution(kind):
    content = render_dossier_docx(sample_record())
    if kind == "fake":
        content = b"This is not a DOCX"
    elif kind == "external":
        content = patch_package(content, "word/_rels/document.xml.rels", b'''
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="evil" Type="template" Target="file:///private" TargetMode="External"/>
            </Relationships>''')
    elif kind == "entity":
        content = patch_package(content, "word/document.xml", b'''
            <!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///private">]>
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>''')
    elif kind == "tracked":
        content = patch_package(content, "word/document.xml", b'''
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body><w:ins/></w:body></w:document>''')
    else:
        output = BytesIO()
        with ZipFile(output, "w", ZIP_DEFLATED) as package:
            package.writestr("word/document.xml", b"<document/>")
            package.writestr("word/vbaProject.bin" if kind == "macro" else "large.txt",
                             b"macro" if kind == "macro" else b"a" * (31 * 1024 * 1024))
        content = output.getvalue()
    with pytest.raises(ValueError):
        parse_dossier(content)


def test_import_does_not_truncate_invalid_fields_or_clear_absent_sections():
    original = sample_record()
    content = render_dossier_docx(original)
    with ZipFile(BytesIO(content)) as source:
        document = source.read("word/document.xml").decode()
    too_long = "Текст" * 100
    document = document.replace("Тестовый город", too_long)
    preview = parse_dossier(patch_package(content, "word/document.xml", document.encode()))
    assert "birthPlace" not in preview.detected_fields
    assert preview.fields.birth_place == ""
    assert too_long in preview.unrecognized_text
    assert preview.warnings
