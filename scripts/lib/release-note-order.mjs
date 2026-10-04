// Existing preview numbers must not change when another note is appended.
export function assertAppendedNoteNames(existing, current) {
  const known = new Set(existing);
  const last = [...known].sort().at(-1);
  const misplaced = current.filter((name) => !known.has(name) && last && name <= last);
  if (misplaced.length) {
    throw new Error(`new notes must sort after ${last}: ${misplaced.join(", ")}. Use YYYYMMDD-zHHMMSS-topic.json; do not rename historical notes.`);
  }
}
