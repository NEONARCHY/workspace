"""Render synthetic trip orders for local, read-only visual QA. No database or signatures."""

from datetime import date
from pathlib import Path

from yuksalish_api.trip_order_pdf import order_pdf


def main() -> None:
    output = Path("output/pdf")
    output.mkdir(parents=True, exist_ok=True)
    content = order_pdf(
        order_number=None, issued=date(2026, 10, 22),
        purpose="Проведение консультаций в рамках юридической клиники",
        destination="Кашкадарьинская область", start=date(2026, 10, 22),
        end=date(2026, 10, 22), employees=[("Testov Xodim", "mutaxassis")],
        expense_source="", requester="Testov Xodim", chair="Testov Rais", signature=None,
    )
    path = output / "trip-order-preview-corrected.pdf"
    path.write_bytes(content)
    print(path.resolve())


if __name__ == "__main__":
    main()
