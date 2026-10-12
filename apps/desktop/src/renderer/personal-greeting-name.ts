/** The directory stores one display string: short names are name/surname,
 * formal three-or-more-part names are surname/name/patronymic. */
export function personalGreetingName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const surnameFirst = parts.length >= 3 || /(?:ов|ова|ев|ева|ёв|ёва|ov|ova|ev|eva)$/iu.test(parts[0] ?? "");
  return parts[surnameFirst && parts.length > 1 ? 1 : 0] ?? "коллега";
}
