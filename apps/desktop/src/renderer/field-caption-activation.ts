/** Field captions name their controls, but are not an extra pointer hit area.
 * Keep native label associations for assistive technology and intentional
 * checkbox/radio/file labels. Delegation also covers Fluent portal forms.
 */
export function observeFieldCaptionActivation(doc: Document = document) {
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target
      : event.target instanceof Node ? event.target.parentElement : null;
    const label = target?.closest("label");
    const control = label?.control;
    if (!target || !label || !control) return;
    if (control instanceof HTMLInputElement && ["checkbox", "radio", "file"].includes(control.type)) return;
    if (control.matches('[role="checkbox"], [role="radio"], [role="switch"]')) return;
    // The actual field, its icons, links and help buttons remain interactive.
    if (target.closest('button, input, select, textarea, a[href], [role="button"], [role="combobox"], [contenteditable="true"]')) return;
    event.preventDefault();
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}
