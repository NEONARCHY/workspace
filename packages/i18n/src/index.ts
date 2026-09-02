export const locales = ["ru", "uz_cyrl", "uz_latn"] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Readonly<Record<Locale, string>> = {
  ru: "Русский",
  uz_cyrl: "Ўзбекча",
  uz_latn: "O‘zbekcha",
};

const messages = {
  ru: {
    workspace: "Рабочее пространство",
    foundation: "Фундамент платформы",
    placeholder: "Модуль готовится",
    apiOnline: "Сервер доступен",
    apiOffline: "Локальный режим",
  },
  uz_cyrl: {
    workspace: "Иш майдони",
    foundation: "Платформа асоси",
    placeholder: "Модул тайёрланмоқда",
    apiOnline: "Сервер ишлаяпти",
    apiOffline: "Локал режим",
  },
  uz_latn: {
    workspace: "Ish maydoni",
    foundation: "Platforma asosi",
    placeholder: "Modul tayyorlanmoqda",
    apiOnline: "Server ishlayapti",
    apiOffline: "Lokal rejim",
  },
} as const;

export type MessageKey = keyof (typeof messages)["ru"];

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
