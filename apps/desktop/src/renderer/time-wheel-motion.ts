const ROW = 34;
export function createTimeWheelMotion(wheel: HTMLDivElement, staticMode = false) {
  const digits = Array.from(wheel.querySelectorAll<HTMLElement>(".ws-time-digit"));
  let frame = 0, target = wheel.scrollTop, position = target, velocity = 0, lastTime = 0;
  const effects = () => {
    const index = wheel.scrollTop / ROW;
    const first = Math.max(0, Math.floor(index) - 3), last = Math.min(digits.length - 1, Math.ceil(index) + 3);
    for (let i = first; i <= last; i += 1) {
      const blur = staticMode ? 0 : Math.min(1.8, Math.max(0, Math.abs(i - index) - .55) * .8);
      const value = `${blur.toFixed(2)}px`;
      if (digits[i]!.style.getPropertyValue("--ws-time-blur") !== value) digits[i]!.style.setProperty("--ws-time-blur", value);
    }
  };
  const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; velocity = 0; lastTime = 0; };
  const tick = (time: number) => {
    const dt = lastTime ? Math.min(.032, Math.max(.001, (time - lastTime) / 1000)) : 1 / 60;
    lastTime = time;
    // Critically damped motion keeps its velocity when a new digit is selected.
    velocity += ((target - position) * 240 - velocity * 31) * dt;
    position = Math.max(0, Math.min((digits.length - 1) * ROW, position + velocity * dt));
    if (Math.abs(target - position) < .12 && Math.abs(velocity) < 2) {
      wheel.scrollTop = target; frame = 0; velocity = 0; lastTime = 0; effects(); return;
    }
    wheel.scrollTop = position; effects(); frame = requestAnimationFrame(tick);
  };
  const onScroll = () => { if (!frame) effects(); };
  const onVisibility = () => { if (document.visibilityState === "hidden") { stop(); wheel.scrollTop = target; effects(); } };
  wheel.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  effects();
  return {
    moveTo(top: number, immediate = false) {
      target = Math.max(0, Math.min((digits.length - 1) * ROW, top));
      if (immediate || staticMode || document.visibilityState === "hidden") {
        stop(); wheel.scrollTop = target; effects(); return;
      }
      if (!frame) { position = wheel.scrollTop; lastTime = 0; frame = requestAnimationFrame(tick); }
    },
    stop,
    setStatic(value: boolean) {
      staticMode = value;
      if (value) { stop(); wheel.scrollTop = target; digits.forEach((digit) => digit.style.removeProperty("--ws-time-blur")); }
      effects();
    },
    dispose() {
      stop(); wheel.removeEventListener("scroll", onScroll); document.removeEventListener("visibilitychange", onVisibility);
      digits.forEach((digit) => digit.style.removeProperty("--ws-time-blur"));
    },
  };
}
