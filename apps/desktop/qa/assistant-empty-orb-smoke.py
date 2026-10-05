"""Visual QA for the real assistant orb with synthetic, read-only chat data."""
from pathlib import Path

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[3] / "tmp" / "assistant-empty-orb"
OUT.mkdir(parents=True, exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=EDGE,
        headless=True,
        args=["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5174/qa/assistant-empty-orb.html")
    launcher = page.get_by_role("button", name="Открыть ассистента Yuksalish")
    launcher.locator("canvas").wait_for()
    page.wait_for_timeout(250)
    launcher_orb = launcher.locator(".gradient-orb")
    launcher_shadow = launcher_orb.evaluate("element => getComputedStyle(element).filter")
    assert "drop-shadow" in launcher_shadow, launcher_shadow
    launcher_box = launcher.bounding_box()
    assert launcher_box
    page.screenshot(path=str(OUT / "header-launcher.png"), clip={
        "x": launcher_box["x"] - 20, "y": launcher_box["y"] - 12,
        "width": 120, "height": 78,
    })
    launcher.click()
    page.locator(".assistant-empty h2").wait_for()
    orb = page.locator(".assistant-empty > .gradient-orb.assistant-empty-orb")
    orb.locator("canvas").wait_for()
    panel = page.get_by_role("dialog", name="Ассистент Yuksalish")
    page.wait_for_timeout(500)
    header_icon = panel.locator(".assistant-header-icon")
    header_size = header_icon.bounding_box()
    assert header_size and header_size["width"] == 46, header_size
    panel.locator(".assistant-header").screenshot(path=str(OUT / "panel-header.png"))
    mini_size = orb.bounding_box()
    assert mini_size and 72 <= mini_size["width"] <= 80, mini_size
    mini_shadow = orb.evaluate("element => getComputedStyle(element).filter")
    assert "drop-shadow" in mini_shadow, mini_shadow
    orb.screenshot(path=str(OUT / "frame-1.png"))
    page.wait_for_timeout(350)
    orb.screenshot(path=str(OUT / "frame-2.png"))
    with Image.open(OUT / "frame-1.png") as first, Image.open(OUT / "frame-2.png") as second:
        changed = ImageChops.difference(first.convert("RGB"), second.convert("RGB")).getbbox()
        assert changed, "Orb animation is frozen"
    panel.screenshot(path=str(OUT / "mini.png"))

    page.get_by_role("button", name="Развернуть окно").click()
    page.wait_for_timeout(550)
    full_size = orb.bounding_box()
    assert full_size and 90 <= full_size["width"] <= 98, full_size
    assert orb.locator("canvas").count() == 1
    panel.screenshot(path=str(OUT / "expanded.png"))
    page.screenshot(path=str(OUT / "detail.png"), clip={
        "x": full_size["x"] - 243, "y": full_size["y"] - 40,
        "width": 580, "height": 250,
    })

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(350)
    mobile_size = orb.bounding_box()
    assert mobile_size and mobile_size["width"] <= 94, mobile_size
    page.screenshot(path=str(OUT / "mobile.png"))
    page.set_viewport_size({"width": 360, "height": 760})
    narrow_header = header_icon.bounding_box()
    assert narrow_header and narrow_header["width"] == 36, narrow_header
    print({"header": header_size, "mini": mini_size, "expanded": full_size, "mobile": mobile_size,
           "shadow": mini_shadow, "header_shadow": launcher_shadow,
           "errors": errors, "screenshots": str(OUT)})
    assert not errors, errors
    browser.close()
