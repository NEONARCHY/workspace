"""A synthetic tone, native MediaRecorder and intercepted API; no real microphone or Gemini."""

import base64
from pathlib import Path

from playwright.sync_api import expect, sync_playwright  # type: ignore[import-not-found]

OUT = Path(__file__).resolve().parents[3] / "tmp" / "assistant-voice"
OUT.mkdir(parents=True, exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

RECORDER = """
window.voiceStopped = 0;
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  getUserMedia: async () => {
    const context = new AudioContext();
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator();
    oscillator.connect(destination); // Never connected to speakers or a real microphone.
    oscillator.start();
    const track = destination.stream.getAudioTracks()[0];
    const stop = track.stop.bind(track);
    track.stop = () => { window.voiceStopped++; stop(); oscillator.stop(); context.close(); };
    return destination.stream;
  }
}});
"""

INTERCEPT = """
window.voiceRequests = [];
window.voicePrompt = 'Создай задачу проверить отчёт, исполнитель я';
window.voiceFail = false;
const fallback = window.fetch.bind(window);
window.fetch = async (url, options) => {
  const path = new URL(String(url), location.href).pathname;
  if (path.endsWith('/assistant/transcribe')) throw new Error('Legacy transcription used');
  if (path.endsWith('/assistant/messages') && options?.method === 'POST') {
    const body = JSON.parse(options.body); window.voiceRequests.push(body);
    if (window.voiceFail) {
      window.voiceFail = false;
      return new Response(JSON.stringify({detail:'Тестовый отказ'}),
        {status:502, headers:{'Content-Type':'application/json'}});
    }
    const voice = body.attachment?.as_prompt;
    return new Response(JSON.stringify({id:crypto.randomUUID(), role:'assistant', model:body.model,
      content:voice ? 'Стенд: голосовая команда обработана' : 'Стенд: выполнено текстовое задание',
      createdAt:new Date().toISOString(),
      ...(voice ? {voicePrompt:window.voicePrompt,
        actionDraft:{kind:'task', ready:true, fields:{title:'Проверить отчёт',assignee:'я'}}} : {})
    }), {headers:{'Content-Type':'application/json'}});
  }
  return fallback(url, options);
};
"""


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=EDGE, headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(RECORDER)

    def open_preview() -> None:
        page.goto("http://127.0.0.1:5177/qa/assistant-actions.html")
        page.evaluate(INTERCEPT)
        page.get_by_role("button", name="Открыть ассистента Yuksalish").click()
        expect(page.get_by_role("textbox", name="Сообщение ассистенту")).to_be_visible()
        expect(page.get_by_role("button", name="Голосовой ввод")).to_be_enabled()

    def record() -> None:
        page.get_by_role("button", name="Голосовой ввод").click()
        expect(page.get_by_role("button", name="Остановить запись")).to_be_enabled()
        page.wait_for_timeout(400)  # Native encoder must receive frames of the synthetic tone.
        page.get_by_role("button", name="Остановить запись").click()
        expect(page.locator(".assistant-file-chip")).to_contain_text("Голосовое сообщение.webm")
        expect(page.get_by_role("button", name="Отправить сообщение")).to_be_enabled()

    open_preview()
    record()
    expect(page.get_by_role("textbox", name="Сообщение ассистенту")).to_have_value("")
    assert page.evaluate("voiceRequests.length") == 0
    player = page.get_by_label("Прослушать голосовое сообщение")
    player.evaluate("audio => audio.play()")
    page.wait_for_function("document.querySelector('.assistant-voice-preview').currentTime > 0")
    player.evaluate("audio => audio.pause()")
    for width, height, zoom in ((1440, 900, 1), (1024, 768, 1), (360, 640, 1), (1440, 900, 2)):
        page.set_viewport_size({"width": width, "height": height})
        page.evaluate("zoom => document.documentElement.style.zoom = zoom", zoom)
        page.get_by_role("button", name="Отправить сообщение").scroll_into_view_if_needed()
        expect(page.get_by_role("button", name="Отправить сообщение")).to_be_in_viewport()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
        page.screenshot(path=str(OUT / f"voice-{width}-zoom-{zoom}.png"))
    page.evaluate("document.documentElement.style.zoom = 1")
    page.set_viewport_size({"width": 1440, "height": 900})
    page.get_by_role("button", name="Отправить сообщение").click()
    expect(page.get_by_text("Стенд: голосовая команда обработана")).to_be_visible()
    body = page.evaluate("voiceRequests[0]")
    assert body["message"] == "" and body["attachment"]["as_prompt"] is True
    assert base64.b64decode(body["attachment"]["data_base64"]).startswith(b"\x1a\x45\xdf\xa3")
    assert page.evaluate("voiceStopped") > 0
    assert body["chat_id"] == "qa-forms"
    page.evaluate("voicePrompt = 'Открывай форму'")
    record()
    page.get_by_role("button", name="Отправить сообщение").click()
    expect(page.get_by_label("Название задачи", exact=True)).to_have_value("Проверить отчёт")
    # No save button is clicked; the real form is merely opened and checked.

    open_preview()
    record()
    editor = page.get_by_role("textbox", name="Сообщение ассистенту")
    editor.fill("Расшифруй эту запись")
    page.evaluate("voiceFail = true")
    page.get_by_role("button", name="Отправить сообщение").click()
    expect(page.get_by_text("Тестовый отказ")).to_be_visible()
    expect(editor).to_have_value("Расшифруй эту запись")
    expect(page.locator(".assistant-file-chip")).to_contain_text("Голосовое сообщение.webm")
    page.get_by_role("button", name="Отправить сообщение").click()
    expect(page.get_by_text("Стенд: выполнено текстовое задание")).to_be_visible()
    body = page.evaluate("voiceRequests[1]")
    assert body["message"] == "Расшифруй эту запись"
    assert body["attachment"]["as_prompt"] is False
    assert page.get_by_label("Название задачи", exact=True).count() == 0
    assert not errors, errors
    print("PASS: voice request, explicit text, retry, form handoff, 3 sizes and 200% zoom")
    browser.close()
