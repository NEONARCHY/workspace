"""Read-only visual checks for assistant navigation, shortcuts and floating menus."""
from pathlib import Path

from playwright.sync_api import sync_playwright  # type: ignore[import-not-found]

OUT = Path(__file__).resolve().parents[3] / "tmp" / "assistant-sidebar-popups"
OUT.mkdir(parents=True, exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def verify(condition: object, message: object) -> None:
    if not condition:
        raise RuntimeError(message)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=EDGE,
        headless=True,
        args=["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5175/qa/assistant-empty-orb.html")
    page.get_by_role("button", name="Открыть ассистента Yuksalish").click()
    panel = page.get_by_role("dialog", name="Ассистент Yuksalish")
    panel.locator(".assistant-empty h2").wait_for()
    page.wait_for_timeout(400)
    picker = page.get_by_role("combobox", name="Чат ассистента")
    picker.click()
    page.get_by_role("option", name="План рабочей недели").wait_for()
    page.wait_for_timeout(250)
    panel.screenshot(path=str(OUT / "mini-picker.png"))
    page.keyboard.press("Escape")
    verify(panel.is_visible(), "Picker Escape closed the whole assistant")
    page.get_by_role("button", name="Быстрые действия").click()
    page.wait_for_timeout(220)
    presets = panel.locator(".assistant-presets-list button")
    verify(presets.count() == 8, "Some shortcuts are missing")
    verify(presets.evaluate_all("""buttons => buttons.every(button => {
      const box = button.getBoundingClientRect();
      const frame = button.closest('.assistant-panel').getBoundingClientRect();
      return box.top >= frame.top && box.bottom <= frame.bottom;
    })"""), "Mini shortcuts are clipped")
    panel.screenshot(path=str(OUT / "mini-actions.png"))
    page.get_by_role("button", name="Развернуть окно").click()
    page.wait_for_timeout(500)
    page.get_by_role("button", name="Быстрые действия").click()
    page.wait_for_timeout(220)
    sidebar = page.get_by_role("navigation", name="Список чатов ассистента")
    verify(sidebar.is_visible(), "Expanded chat sidebar is missing")
    panel.screenshot(path=str(OUT / "expanded-actions.png"))
    page.get_by_role("textbox").fill("Черновик для проверки переключения")
    sidebar.get_by_role("button", name="План рабочей недели Диалог").click()
    answer = panel.locator(".assistant-message.is-assistant")
    answer.wait_for()
    verify(page.get_by_role("textbox").input_value() == "", "Draft leaked to another chat")
    answer.click(button="right", position={"x": 90, "y": 30})
    popup = panel.get_by_role("menu")
    popup.wait_for()
    motion = popup.evaluate("element => getComputedStyle(element).animationName")
    verify(motion == "ws-floating-menu-enter", motion)
    intermediate_opacity = popup.evaluate("""element => {
      const animation = element.getAnimations().find(item =>
        item.animationName === 'ws-floating-menu-enter');
      animation.pause(); animation.currentTime = 70;
      const opacity = Number(getComputedStyle(element).opacity);
      animation.finish();
      return opacity;
    }""")
    verify(0 < intermediate_opacity < 1, "Popup has no intermediate appearance frame")
    page.wait_for_timeout(220)
    panel.screenshot(path=str(OUT / "expanded-reply-menu.png"))
    page.get_by_role("menuitem", name="Ответить").click()
    verify(panel.locator(".assistant-reply-target").is_visible(), "Reply action is broken")
    sidebar.get_by_role("button", name="Новый чат Основной чат").click()
    panel.locator(".assistant-empty h2").wait_for()
    verify(page.get_by_role("textbox").input_value() == "Черновик для проверки переключения",
           "Switching discarded the draft")
    for width, height in [(1024, 768), (640, 480), (390, 844)]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(350)
        page.get_by_role("button", name="Быстрые действия").click()
        page.wait_for_timeout(220)
        verify(page.locator("body").evaluate(
            "element => element.scrollWidth <= innerWidth"), "Page overflows horizontally")
        page.screenshot(path=str(OUT / f"responsive-{width}.png"))
        verify(presets.evaluate_all("""buttons => buttons.every(button => {
          const box = button.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight;
        })"""), "Responsive shortcuts overflow the window")
        page.keyboard.press("Escape")
        verify(panel.is_visible(), "Shortcuts Escape closed the assistant")
        if width <= 760:
            verify(not sidebar.count(), "Sidebar crowds a compact window")
            verify(picker.is_visible(), "Compact chat picker is missing")
    page.emulate_media(reduced_motion="reduce")
    picker.click()
    page.get_by_role("option", name="План рабочей недели").click()
    answer.wait_for()
    answer.click(button="right", position={"x": 50, "y": 25})
    popup.wait_for()
    verify(popup.evaluate("element => getComputedStyle(element).animationName") == "none",
           "Reduced motion did not disable popup animation")
    page.keyboard.press("Escape")
    page.emulate_media(reduced_motion="no-preference", forced_colors="active")
    answer.click(button="right", position={"x": 50, "y": 25})
    popup.wait_for()
    verify(popup.evaluate("element => getComputedStyle(element).animationName") == "none",
           "Forced colors did not disable popup animation")
    page.keyboard.press("Escape")
    page.emulate_media(forced_colors="none")
    page.set_viewport_size({"width": 1440, "height": 900})
    page.evaluate("document.documentElement.style.zoom = '2'")
    page.wait_for_timeout(350)
    page.get_by_role("button", name="Быстрые действия").click()
    page.wait_for_timeout(220)
    verify(presets.evaluate_all("""buttons => buttons.every(button => {
      const box = button.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    })"""), "Zoomed shortcuts are outside the viewport")
    page.screenshot(path=str(OUT / "zoom-200.png"))
    verify(not errors, errors)
    print({"screenshots": str(OUT), "popup_motion": motion,
           "intermediate_opacity": intermediate_opacity, "errors": errors})
    browser.close()
