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
