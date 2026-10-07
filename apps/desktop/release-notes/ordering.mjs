const unique = (values) => [...new Set(values)];

/** Stable published prefix, then main's introduction order, then provisional PR notes. */
export function orderNoteNames(current, frozen, merged) {
  if (unique(current).length !== current.length) throw new Error("Release note filenames must be unique");
  if (unique(frozen).length !== frozen.length) throw new Error("Frozen release note order must be unique");
  const available = new Set(current);
  const missing = frozen.filter((name) => !available.has(name));
  if (missing.length) throw new Error(`Historical release notes cannot disappear: ${missing.join(", ")}`);
  const ordered = unique([...frozen, ...merged.filter((name) => available.has(name))]);
  const known = new Set(ordered);
  return [...ordered, ...current.filter((name) => !known.has(name)).sort()];
}

/** Independent additions may have any date; existing history must survive archiving. */
export function assertRetainedNoteNames(existing, current) {
  const available = new Set(current);
  const missing = unique(existing).filter((name) => !available.has(name));
  if (missing.length) throw new Error(`Do not remove or rename historical notes: ${missing.join(", ")}`);
}
