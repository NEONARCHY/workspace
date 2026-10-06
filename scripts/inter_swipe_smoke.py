"""Synthetic visual fixture only: never reads or writes production business data."""

import asyncio
import json
from pathlib import Path

from playwright.async_api import Browser, async_playwright


async def check_touch(browser: Browser, output: Path) -> None:
    context = await browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    try:
        page = await context.new_page()
        await page.route("**/api/**", lambda route: route.abort())
        await page.goto("http://127.0.0.1:5177/qa/inter-swipe.html")
        row = page.locator(".notification-row").first
        await row.scroll_into_view_if_needed()
        await page.wait_for_timeout(300)
        cdp = await context.new_cdp_session(page)

        async def gesture(dx: float, dy: float) -> None:
            box = await row.bounding_box()
            assert box
            x, y = box["x"] + box["width"] * 0.85, box["y"] + box["height"] * 0.55
            await cdp.send(
                "Input.dispatchTouchEvent",
                {
                    "type": "touchStart",
                    "touchPoints": [{"x": x, "y": y}],
                },
            )
            for step in range(1, 13):
                await cdp.send(
                    "Input.dispatchTouchEvent",
                    {
                        "type": "touchMove",
                        "touchPoints": [
                            {
                                "x": x + dx * step / 12,
                                "y": y + dy * step / 12,
                            }
                        ],
                    },
                )
                await page.wait_for_timeout(20)
            await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            await page.wait_for_timeout(300)

        box = await row.bounding_box()
        assert box
        await gesture(-box["width"] * 0.8, 0)
        assert await page.get_by_text("Согласовать документы поездки", exact=True).count() == 0
        await page.get_by_role("button", name="Вернуть", exact=True).click()
        await row.scroll_into_view_if_needed()
        positions = """element => {
            const result = [];
            for (let current = element; current; current = current.parentElement) {
                result.push(current.scrollTop);
            }
            return result;
        }"""
        before = await row.evaluate(positions)
        await gesture(0, 90)
        after = await row.evaluate(positions)
        assert any(end < start - 20 for start, end in zip(before, after, strict=True)), (before, after)
        assert await page.get_by_role("button", name="Вернуть", exact=True).count() == 0
        assert await page.locator(".notification-swipe.is-open").count() == 0
        await page.screenshot(path=str(output / "touch-scroll.png"))
    finally:
        await context.close()


async def main() -> None:
    output = Path("tmp/inter-swipe")
    output.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            headless=True,
        )
        try:
            page = await browser.new_page(viewport={"width": 1440, "height": 900})
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.route("**/api/**", lambda route: route.abort())
            await page.goto("http://127.0.0.1:5177/qa/inter-swipe.html")
            await page.get_by_text("Согласовать документы поездки", exact=True).wait_for()
            await page.evaluate("document.fonts.ready")
            report["fontFamily"] = await page.locator(".notification-open").first.evaluate(
                "element => getComputedStyle(element).fontFamily"
            )
            assert "Inter" in str(report["fontFamily"])
            cdp = await page.context.new_cdp_session(page)
            await cdp.send("DOM.enable")
            await cdp.send("CSS.enable")
            document = await cdp.send("DOM.getDocument")
            node = await cdp.send(
                "DOM.querySelector",
                {
                    "nodeId": document["root"]["nodeId"],
                    "selector": ".notification-open > b",
                },
            )
            report["actualCyrillicFonts"] = await cdp.send(
                "CSS.getPlatformFontsForNode",
                {
                    "nodeId": node["nodeId"],
                },
            )
            assert all(
                font["isCustomFont"] and "Inter" in font["familyName"]
                for font in report["actualCyrillicFonts"]["fonts"]
            )
            await page.screenshot(path=str(output / "notifications-inter.png"))

            async def drag(selector: str, fraction: float) -> None:
                await page.locator(selector).first.scroll_into_view_if_needed()
                box = await page.locator(selector).first.bounding_box()
                assert box
                start = box["x"] + box["width"] * 0.85
                y = box["y"] + box["height"] * 0.45
                await page.mouse.move(start, y)
                await page.mouse.down()
                await page.mouse.move(start - box["width"] * fraction, y, steps=12)
                await page.mouse.up()
                await page.wait_for_timeout(300)

            await drag(".notification-swipe .swipe-row-surface", 0.11)
            assert await page.locator(".notification-swipe.is-open").count() == 1
            await page.screenshot(path=str(output / "notification-swipe-open.png"))
            await page.get_by_role(
                "button", name="Удалить: Согласовать документы поездки", exact=True
            ).click()
            await page.get_by_role("button", name="Вернуть", exact=True).click()
            assert await page.get_by_text("Согласовать документы поездки", exact=True).count() == 1

            await drag(".notification-swipe .swipe-row-surface", 0.8)
            assert await page.get_by_text("Согласовать документы поездки", exact=True).count() == 0
            await page.screenshot(path=str(output / "notification-undo.png"))
            await (
                page.locator(".qa-swipe-toolbar")
                .get_by_role("button", name="Мессенджер", exact=True)
                .click()
            )
            assert await page.get_by_role("button", name="Вернуть", exact=True).count() == 1
            await page.get_by_role("button", name="Вернуть", exact=True).click()
            source = await page.locator('[data-chat-id="baxtiyor"]').bounding_box()
            target = await page.locator('[data-chat-id="finance"]').bounding_box()
            assert source and target
            await page.mouse.move(source["x"] + 50, source["y"] + source["height"] / 2)
            await page.mouse.down()
            await page.mouse.move(source["x"] + 50, target["y"] + target["height"] * 0.75, steps=16)
            await page.mouse.up()
            await page.wait_for_timeout(300)
            assert (
                await page.locator('[data-pinned="true"]').first.get_attribute("data-chat-id")
                == "finance"
            ), "Vertical pinned reorder must remain usable beside swipe"
            await drag('[data-chat-id="baxtiyor"] .swipe-row-surface', 0.8)
            await page.get_by_role("dialog", name="Удалить личный чат?").wait_for()
            await page.screenshot(path=str(output / "chat-deletion-choice.png"))
            await page.get_by_role("button", name="Удалить у меня", exact=False).click()  # noqa: RUF001
            assert await page.locator('[data-chat-id="baxtiyor"]').count() == 0
            await page.get_by_role("button", name="Вернуть", exact=True).click()
            assert await page.locator('[data-chat-id="baxtiyor"]').count() == 1

            await page.get_by_role("button", name="Ошибка сервера: выкл", exact=True).click()
            await drag('[data-chat-id="baxtiyor"] .swipe-row-surface', 0.8)
            await page.get_by_role("button", name="Удалить у обоих", exact=False).click()  # noqa: RUF001
            await (
                page.get_by_role("alert").filter(has_text="Тестовый отказ").wait_for(timeout=8_000)
            )
            assert await page.locator('[data-chat-id="baxtiyor"]').count() == 1
            await page.get_by_role("button", name="Закрыть ошибку удаления", exact=True).click()
            await page.get_by_role("button", name="Ошибка сервера: вкл", exact=True).click()

            await page.get_by_role("button", name="Ещё", exact=False).click()
            await page.get_by_role("menuitem", name="Чаты поездок", exact=False).click()
            protected = page.locator('[data-chat-id="active-trip"]')
            assert await protected.locator(".swipe-row-action").count() == 0
            await drag('[data-chat-id="active-trip"] .swipe-row-surface', 0.8)
            assert await page.get_by_role("dialog").count() == 0
            await drag('[data-chat-id="finished-trip"] .swipe-row-surface', 0.8)
            await page.get_by_role("dialog", name="Выйти из группы?").wait_for()
            await page.get_by_role("button", name="Выйти", exact=True).click()
            await page.get_by_role("button", name="Вернуть", exact=True).click()
            assert await page.locator('[data-chat-id="finished-trip"]').count() == 1

            for width, height in [(1440, 900), (1024, 768), (640, 480), (390, 844)]:
                await page.set_viewport_size({"width": width, "height": height})
                await page.get_by_role("button", name="Уведомления", exact=True).click()
                await page.wait_for_timeout(300)
                overflow = await page.evaluate(
                    "document.documentElement.scrollWidth > innerWidth + 1"
                )
                assert not overflow, f"Horizontal overflow at {width}"
                clipped = await page.locator(
                    ".notification-header, .notification-head-actions, .notification-row"
                ).evaluate_all("""elements => elements.some(element => {
                    const rect = element.getBoundingClientRect();
                    return rect.left < -1 || rect.right > innerWidth + 1;
                })""")
                assert not clipped, f"Clipped notification controls at {width}"
                await page.screenshot(path=str(output / f"notifications-{width}.png"))
                if width == 390:
                    await page.locator(".notification-row").first.scroll_into_view_if_needed()
                    exposed = await page.locator(".notification-row").first.evaluate("""element => {
                        const box = element.getBoundingClientRect();
                        return element.contains(document.elementFromPoint(
                            box.x + box.width / 2, box.y + box.height / 2
                        ));
                    }""")
                    assert exposed, "Notification settings must not overlap swipe rows"
                    await page.screenshot(path=str(output / "notifications-390-rows.png"))
            await page.set_viewport_size({"width": 1024, "height": 768})
            await page.evaluate("document.documentElement.style.zoom = '2'")
            await page.screenshot(path=str(output / "zoom-200.png"))
            await page.evaluate("document.documentElement.style.zoom = ''")
            await page.emulate_media(reduced_motion="reduce", forced_colors="active")
            await drag(".notification-swipe .swipe-row-surface", 0.8)
            await page.get_by_role("button", name="Вернуть", exact=True).click()
            await page.screenshot(path=str(output / "forced-colors.png"))
            report["pageErrors"] = errors
            await check_touch(browser, output)
            report["checks"] = [
                "real mouse swipe",
                "native touch swipe/undo and vertical pan",
                "full swipe",
                "undo",
                "cross-section undo",
                "vertical pinned reorder beside horizontal swipe",
                "direct self/both selection",
                "error restore",
                "protected trip",
                "finished trip leave/undo",
                "responsive",
                "200%",
                "reduced/forced",
            ]
            assert not errors, errors
            (output / "report.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(json.dumps(report, ensure_ascii=False))
        finally:
            await browser.close()


asyncio.run(main())
