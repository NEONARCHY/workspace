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

type DateDisplay = "date" | "time" | "datetime";
const dateFields = ["weekday", "year", "month", "day"] as const;
const timeFields = ["hour", "minute", "second", "dayPeriod", "fractionalSecondDigits"] as const;
const dateTimeFields = [...dateFields, ...timeFields];
function russianDateText(date: Date, options: Intl.DateTimeFormatOptions, display: DateDisplay): string {
  // Match Date#toLocale*String, including its defaults and invalid-date result.
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  if ((display === "date" && options.timeStyle !== undefined) || (display === "time" && options.dateStyle !== undefined)) throw new TypeError("Style is incompatible with the date display");
  const fields = display === "date" ? dateFields : display === "time" ? timeFields : dateTimeFields;
  const needsDefaults = options.dateStyle === undefined && options.timeStyle === undefined && fields.every(field => options[field] === undefined);
  const normalized = needsDefaults ? { ...options,
    ...(display !== "time" ? { year: "numeric", month: "numeric", day: "numeric" } as const : {}),
    ...(display !== "date" ? { hour: "numeric", minute: "numeric", second: "numeric" } as const : {}),
  } : options;
  return russianDateTimeFormatter(normalized).format(date);
}

export function formatRussianDate(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return russianDateText(date, options, "date");
}
export function formatRussianTime(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return russianDateText(date, options, "time");
}
export function formatRussianDateTime(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return russianDateText(date, options, "datetime");
}
