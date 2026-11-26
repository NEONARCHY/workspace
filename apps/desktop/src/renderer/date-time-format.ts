const formatters = new Map<string, Intl.DateTimeFormat>();
const maximumFormatters = 32;

/** Reuse ICU formatters across rows and renders; bound dynamic timezone choices. */
export function russianDateTimeFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options, Object.keys(options).sort());
  const existing = formatters.get(key);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("ru-RU", options);
  if (formatters.size >= maximumFormatters) formatters.delete(formatters.keys().next().value!);
  formatters.set(key, formatter);
  return formatter;
}
