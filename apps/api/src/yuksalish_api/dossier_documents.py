"""Fill the sanitized owner-approved OOXML, without a second Word layout engine."""

import re
from copy import deepcopy
from datetime import date
from io import BytesIO
from pathlib import Path

# Serialization only; XML parsing below uses defusedxml.
from xml.etree import ElementTree as ET  # nosec B405
from zipfile import ZIP_DEFLATED, ZipFile

from defusedxml.ElementTree import fromstring
from PIL import Image, ImageOps, UnidentifiedImageError

from .dossier_schemas import DossierDetail

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
TEMPLATE = Path(__file__).with_name("hr_assets") / "dossier-template.docx"
CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MONTHS = ("январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август",
          "сентябрь", "октябрь", "ноябрь", "декабрь")


def _replace(root: ET.Element, values: dict[str, str]) -> None:
    for parent in root.iter():
        for node in list(parent):
            if node.tag != f"{{{W}}}t" or not node.text:
                continue
            node.text = re.sub(r"\{\{(\w+)\}\}", lambda match: (
                values[match[1]] or "—" if match[1] in values else match[0]
            ), node.text)
            # Word ignores newline characters in w:t; preserve user's line breaks.
            lines = node.text.splitlines()
            if len(lines) > 1:
                node.text = lines[0]
                index = list(parent).index(node) + 1
                for line in lines[1:]:
                    parent.insert(index, ET.Element(f"{{{W}}}br"))
                    following = ET.Element(f"{{{W}}}t")
                    following.text = line
                    parent.insert(index + 1, following)
                    index += 2
            node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")


def portrait_jpeg(content: bytes) -> bytes:
    if len(content) > 15 * 1024 * 1024:
        raise ValueError("Фотография превышает допустимый размер")
    try:
        with Image.open(BytesIO(content)) as source:
            if source.width * source.height > 20_000_000:
                raise ValueError("Фотография слишком большая")
            oriented = ImageOps.exif_transpose(source).convert("RGBA")
            scaled = ImageOps.contain(oriented, (600, 800))
            portrait = Image.new("RGB", (600, 800), "white")
            portrait.paste(scaled, ((600 - scaled.width) // 2, (800 - scaled.height) // 2),
                           scaled.getchannel("A"))
            output = BytesIO()
            portrait.save(output, "JPEG", quality=95)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("Фотография профиля не прочитана") from error


def _date(value: date | None) -> str:
    return value.strftime("%d.%m.%Y") + " й." if value else "—"


def render_dossier_docx(record: DossierDetail, photo: bytes | None = None) -> bytes:
    fields = record.fields
    institutions = []
    for row in fields.education:
        years = "\u2013".join(str(year) for year in (row.start_year, row.graduation_year) if year)
        institutions.append(f"{years} й., {row.institution}" if years else row.institution)
    appointment = fields.appointment_date
    values = {
        "fullName": record.full_name, "jobTitle": record.job_title or "—",
        "appointmentDate": (f"{appointment.year} йил {appointment.day} "
                            f"{MONTHS[appointment.month - 1]}дан:" if appointment else "—"),
        "birthDate": _date(fields.birth_date), "birthPlace": fields.birth_place,
        "nationality": fields.nationality, "partyMembership": fields.party_membership,
        "educationLevel": fields.education_level, "institutions": "\n".join(institutions),
        "specialties": "\n".join(" · ".join(filter(None, (r.specialty, r.qualification)))
                                 for r in fields.education),
        "academicDegree": fields.academic_degree, "academicTitle": fields.academic_title,
        "languages": fields.languages, "militaryRank": fields.military_rank,
        "awards": fields.awards, "electedMembership": fields.elected_membership,
    }
    with ZipFile(TEMPLATE) as template:
        root = fromstring(template.read("word/document.xml"))
        # No namespace prefix declarations are necessary for an unused Ignorable hint.
        root.attrib.pop("{http://schemas.openxmlformats.org/markup-compatibility/2006}Ignorable",
                        None)
        body = root.find("w:body", NS)
        if body is None:
            raise ValueError("Шаблон объективки не содержит основного раздела")
        _replace(root, values)
        work, relatives = body.findall("w:tbl", NS)
        work_pattern = work.findall("w:tr", NS)[13]
        work.remove(work_pattern)
        for job in fields.employment:
            entry = deepcopy(work_pattern)
            period = job.period
            if not period and job.start_date:
                period = (f"{job.start_date.year}-{job.end_date.year} йй." if job.end_date
                          else f"{job.start_date.year} й.-ҳ.в.")
            _replace(entry, {"workPeriod": period,
                             "workDash": "-",
                             "workPosition": " · ".join(filter(None, (
                                 job.organization, job.position,
                             )))})
            work.append(entry)
        if not fields.employment:
            entry = deepcopy(work_pattern)
            _replace(entry, {"workPeriod": "—", "workDash": "-", "workPosition": "—"})
            work.append(entry)
        relative_pattern = relatives.findall("w:tr", NS)[1]
        relatives.remove(relative_pattern)
        for relative in fields.relatives:
            entry = deepcopy(relative_pattern)
            birth = ", ".join(filter(None, (
                f"{relative.birth_year} йил" if relative.birth_year else "", relative.birth_place,
            )))
            _replace(entry, dict(zip((f"relative{i}" for i in range(5)), (
                relative.relationship, relative.full_name, birth,
                relative.workplace_position, relative.address,
            ), strict=True)))
            relatives.append(entry)
        if not fields.relatives:
            entry = deepcopy(relative_pattern)
            _replace(entry, {f"relative{i}": "—" for i in range(5)})
            relatives.append(entry)
        if fields.additional_info:
            # Optional content has no source slot; insert before the relatives section.
            paragraph = deepcopy(work_pattern.find("w:tc/w:p", NS))
            if paragraph is None:
                raise ValueError("Шаблон не содержит образца строки")
            _replace(paragraph, {"workPeriod": fields.additional_info})
            body.insert(1, paragraph)
        output = BytesIO()
        with ZipFile(output, "w", ZIP_DEFLATED) as archive:
            for item in template.infolist():
                content = template.read(item.filename)
                if item.filename == "word/document.xml":
                    content = ET.tostring(root, encoding="utf-8", xml_declaration=True)
                elif item.filename == "word/media/image1.jpeg" and photo is not None:
                    content = portrait_jpeg(photo)
                archive.writestr(item.filename, content)
    return output.getvalue()
