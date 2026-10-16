import type { WorkspacePerson } from "@yuksalish/contracts";

const surnameSuffix = /(?:ов|ова|ев|ева|ёв|ёва|ov|ova|ev|eva)$/iu;

function nameParts(fullName: string): string[] {
  return fullName.trim().split(/\s+/u).filter(Boolean);
}

function isSurnameFirst(parts: readonly string[]): boolean {
  return parts.length >= 3 || surnameSuffix.test(parts[0] ?? "");
}

/** Keep the stored full name intact; this is only for ordinary workspace labels. */
export function employeeDisplayName(fullName: string): string {
  const parts = nameParts(fullName);
  if (parts.length < 2) return parts[0] ?? "";
  return isSurnameFirst(parts) ? `${parts[1]} ${parts[0]}` : `${parts[0]} ${parts[1]}`;
}

/** Directory names with three parts are surname, given name, patronymic. */
export function employeeInitials(fullName: string): string {
  const parts = nameParts(fullName);
  const surnameFirst = isSurnameFirst(parts);
  const givenName = parts[surnameFirst && parts.length > 1 ? 1 : 0] ?? "";
  const surname = parts[surnameFirst ? 0 : 1] ?? "";
  return `${givenName[0] ?? ""}${surname[0] ?? ""}`.toLocaleUpperCase("ru-RU");
}

export function employeeDisplayPerson(person: WorkspacePerson): WorkspacePerson {
  return { ...person, name: employeeDisplayName(person.name), initials: employeeInitials(person.name) };
}
