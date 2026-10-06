"""Check real layout geometry without business API requests."""

from pathlib import Path

from playwright.sync_api import Page, sync_playwright  # type: ignore[import-not-found]

OUT = Path(__file__).resolve().parents[3] / "tmp" / "team-layout"
OUT.mkdir(parents=True, exist_ok=True)
URL = "http://127.0.0.1:5176/qa/team-layout.html"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def verify_layout(page: Page, label: str) -> None:
    page.locator(".team-dash-flow-legend button").first.wait_for()
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(350)
    result = page.locator(".team-dash-flow-legend").evaluate("""legend => {
      const boxes = [...legend.querySelectorAll('button')].map(button => {
        const r = button.getBoundingClientRect(), s = getComputedStyle(button);
        const label = button.querySelector('span'), count = button.querySelector('strong');
        return {x:r.x, y:r.y, w:r.width, h:button.offsetHeight, direction:s.flexDirection,
          labelRight:label.getBoundingClientRect().right,
          countLeft:count.getBoundingClientRect().left,
          overflow:label.scrollWidth > label.clientWidth,
          needed:Math.max(34, Math.max(label.offsetHeight, count.offsetHeight)
            + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom)
            + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth)),
          size:getComputedStyle(button.querySelector('strong')).fontSize};
      });
      const valid = boxes.length === 4 && Math.abs(boxes[0].y-boxes[1].y) < 1
        && Math.abs(boxes[2].y-boxes[3].y) < 1 && boxes[2].y > boxes[0].y
        && Math.abs(boxes[0].x-boxes[2].x) < 1
        && Math.abs(boxes[1].x-boxes[3].x) < 1
        && boxes.every((b, index) => Math.abs(b.w-boxes[0].w) < 1
          && b.h <= Math.max(...boxes.slice(index-index%2, index-index%2+2)
            .map(other => other.needed)) + 1
          && b.direction === 'row' && b.size === '14px'
          && !b.overflow && b.labelRight <= b.countLeft - 3)
        && legend.scrollWidth <= legend.clientWidth + 1;
      return {valid, boxes};
    }""")
    if not result["valid"]:
        raise RuntimeError(f"Counter grid is not compact and symmetric: {label}: {result['boxes']}")
    page.locator(".team-dash-flow-overview").screenshot(path=str(OUT / f"flow-{label}.png"))
    switches = page.locator(".employee-scope-switch")
    centered = switches.evaluate_all("""groups => groups.every(group =>
      [...group.querySelectorAll('button')].every(button => {
        const range = document.createRange(); range.selectNodeContents(button);
        const text = range.getBoundingClientRect(), box = button.getBoundingClientRect();
        return Math.abs((text.left+text.right-box.left-box.right)/2) < 2
          && Math.abs((text.top+text.bottom-box.top-box.bottom)/2) < 2;
      }))""")
    if not centered:
        raise RuntimeError(f"Scope label is not centered: {label}")
    tree = page.locator(".department-tree")
    tree.screenshot(path=str(OUT / f"structure-{label}.png"))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=EDGE, headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("**/api/**", lambda route: route.abort())
    page.goto(URL)
    for width, height in [
        (1440, 900),
        (1024, 768),
        (780, 800),
        (740, 800),
        (640, 700),
        (390, 700),
        (320, 700),
    ]:
        page.set_viewport_size({"width": width, "height": height})
        verify_layout(page, str(width))
    page.set_viewport_size({"width": 1024, "height": 768})
    page.evaluate("document.documentElement.style.zoom = '2'")
    verify_layout(page, "zoom-200")
    page.evaluate("document.documentElement.style.zoom = '1'")
    page.set_viewport_size({"width": 390, "height": 700})
    page.locator(".team-dash-flow-legend strong").evaluate_all(
        "counts => counts.forEach(count => count.textContent = '12 345')"
    )
    verify_layout(page, "long-counts")
    page.reload()
    page.set_viewport_size({"width": 1024, "height": 768})
    for scope in ["Регионы", "Центральный аппарат"]:
        group = page.get_by_role("group", name="Тип подразделений")
        group.get_by_role("button", name=scope, exact=True).click()
        verify_layout(page, "regional" if scope == "Регионы" else "central")
        if (
            group.get_by_role("button", name=scope, exact=True).get_attribute("aria-pressed")
            != "true"
        ):
            raise RuntimeError("Scope selection stopped working")
    if errors:
        raise RuntimeError(errors)
    print({"layout": "passed", "screenshots": str(OUT), "errors": errors})
    browser.close()
