interface ParsedReleaseVersion {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

function parseReleaseVersion(version: string): ParsedReleaseVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (!left.length || !right.length) return left.length ? -1 : right.length ? 1 : 0;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
    if (leftNumber !== undefined || rightNumber !== undefined) return leftNumber !== undefined ? -1 : 1;
    return leftPart.localeCompare(rightPart, "en");
  }
  return 0;
}

/** Compares release versions from oldest to newest. */
export function compareReleaseVersions(left: string, right: string): number {
  const parsedLeft = parseReleaseVersion(left);
  const parsedRight = parseReleaseVersion(right);
  if (!parsedLeft || !parsedRight) return left.localeCompare(right, "en", { numeric: true });
  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    const difference = parsedLeft.core[index]! - parsedRight.core[index]!;
    if (difference) return difference;
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

/** Numbers successive test updates without changing the published app version. */
export function nextUpdateVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid published version: ${version}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch) || patch > 999) {
    throw new Error(`Invalid published version: ${version}`);
  }
  if (patch === 999) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** A note keeps its number when it moves from pending to a released folder. */
export function numberUpdateNotes<T extends { readonly id: string; readonly fileName: string }>(
  notes: readonly T[], lastGroupedVersion: string, fileOrder?: readonly string[],
): (T & { version: string })[] {
  const compareKeys = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  if (fileOrder && (new Set(fileOrder).size !== fileOrder.length
    || notes.some((note) => !fileOrder.includes(note.fileName)))) {
    throw new Error("Release note order must be complete and unique");
  }
  const positions = fileOrder ? new Map(fileOrder.map((name, index) => [name, index])) : undefined;
  const sorted = [...notes].sort((left, right) => positions
    ? positions.get(left.fileName)! - positions.get(right.fileName)!
    : compareKeys(left.fileName, right.fileName) || compareKeys(left.id, right.id));
  if (new Set(sorted.map((note) => note.id)).size !== sorted.length) {
    throw new Error("Numbered release note IDs must be unique");
  }
  if (new Set(sorted.map((note) => note.fileName)).size !== sorted.length) {
    throw new Error("Numbered release note filenames must be unique");
  }
  let version = lastGroupedVersion;
  return sorted.map((note) => {
    version = nextUpdateVersion(version);
    return { ...note, version };
  }).reverse();
}
