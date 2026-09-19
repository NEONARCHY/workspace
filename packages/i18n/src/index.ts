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

type Translation = Readonly<{ uz_cyrl: string; uz_latn: string }>;

/**
 * Shared product vocabulary. JSX is routed through this catalogue, so labels,
 * aria text, placeholders, tooltips, dialogs and transient banners use the
 * same wording instead of maintaining screen-specific copies.
 */
export const productMessages: Readonly<Record<string, Translation>> = {
  "Настройки": { uz_cyrl: "Созламалар", uz_latn: "Sozlamalar" },
  "Русский": { uz_cyrl: "Рус тили", uz_latn: "Rus tili" },
  "Ўзбекча": { uz_cyrl: "Ўзбекча", uz_latn: "O‘zbekcha" },
  "O‘zbekcha": { uz_cyrl: "Ўзбекча", uz_latn: "O‘zbekcha" },
  "Язык интерфейса": { uz_cyrl: "Интерфейс тили", uz_latn: "Interfeys tili" },
  "Выберите язык интерфейса. Настройка сохранится для всех ваших устройств.": { uz_cyrl: "Интерфейс тилини танланг. Созлама барча қурилмаларингизда сақланади.", uz_latn: "Interfeys tilini tanlang. Sozlama barcha qurilmalaringizda saqlanadi." },
  "Язык": { uz_cyrl: "Тил", uz_latn: "Til" },
  "Меню": { uz_cyrl: "Меню", uz_latn: "Menyu" },
  "CRM": { uz_cyrl: "CRM", uz_latn: "CRM" },
  "Задачи": { uz_cyrl: "Вазифалар", uz_latn: "Vazifalar" },
  "Заявки на оплату": { uz_cyrl: "Тўлов аризалари", uz_latn: "To‘lov arizalari" },
  "Лента": { uz_cyrl: "Лента", uz_latn: "Lenta" },
  "Список проектов": { uz_cyrl: "Лойиҳалар рўйхати", uz_latn: "Loyihalar ro‘yxati" },
  "Согласование поездок": { uz_cyrl: "Сафарларни келишиш", uz_latn: "Safarlarni kelishish" },
  "Мессенджер": { uz_cyrl: "Мессенжер", uz_latn: "Messenjer" },
  "Календарь": { uz_cyrl: "Тақвим", uz_latn: "Taqvim" },
  "Zoom-конференции": { uz_cyrl: "Zoom-конференциялар", uz_latn: "Zoom konferensiyalari" },
  "Отсутствия": { uz_cyrl: "Йўқликлар", uz_latn: "Yo‘qliklar" },
  "Работа с членами": { uz_cyrl: "Аъзолар билан ишлаш", uz_latn: "A’zolar bilan ishlash" },
  "Сотрудники": { uz_cyrl: "Ходимлар", uz_latn: "Xodimlar" },
  "Уведомления": { uz_cyrl: "Билдиришномалар", uz_latn: "Bildirishnomalar" },
  "Поиск и быстрый переход": { uz_cyrl: "Қидирув ва тез ўтиш", uz_latn: "Qidiruv va tez o‘tish" },
  "Основная навигация": { uz_cyrl: "Асосий навигация", uz_latn: "Asosiy navigatsiya" },
  "Перейти к содержимому": { uz_cyrl: "Мазмунга ўтиш", uz_latn: "Mazmunga o‘tish" },
  "Развернуть меню": { uz_cyrl: "Менюни очиш", uz_latn: "Menyuni ochish" },
  "Свернуть меню": { uz_cyrl: "Менюни йиғиш", uz_latn: "Menyuni yig‘ish" },
  "Изменить порядок меню": { uz_cyrl: "Меню тартибини ўзгартириш", uz_latn: "Menyu tartibini o‘zgartirish" },
  "Аккаунт и безопасность": { uz_cyrl: "Ҳисоб ва хавфсизлик", uz_latn: "Hisob va xavfsizlik" },
  "Звук": { uz_cyrl: "Овоз", uz_latn: "Ovoz" },
  "Защита": { uz_cyrl: "Ҳимоя", uz_latn: "Himoya" },
  "Пароль": { uz_cyrl: "Парол", uz_latn: "Parol" },
  "Устройства": { uz_cyrl: "Қурилмалар", uz_latn: "Qurilmalar" },
  "Доступ сотрудников": { uz_cyrl: "Ходимлар рухсати", uz_latn: "Xodimlar ruxsati" },
  "Пароли сотрудников": { uz_cyrl: "Ходимлар пароллари", uz_latn: "Xodimlar parollari" },
  "Обновления": { uz_cyrl: "Янгиланишлар", uz_latn: "Yangilanishlar" },
  "Сменить фото": { uz_cyrl: "Суратни алмаштириш", uz_latn: "Suratni almashtirish" },
  "Загрузка…": { uz_cyrl: "Юкланмоқда…", uz_latn: "Yuklanmoqda…" },
  "Закрыть": { uz_cyrl: "Ёпиш", uz_latn: "Yopish" },
  "Сохранить": { uz_cyrl: "Сақлаш", uz_latn: "Saqlash" },
  "Отмена": { uz_cyrl: "Бекор қилиш", uz_latn: "Bekor qilish" },
  "Удалить": { uz_cyrl: "Ўчириш", uz_latn: "O‘chirish" },
  "Изменить": { uz_cyrl: "Ўзгартириш", uz_latn: "O‘zgartirish" },
  "Редактировать": { uz_cyrl: "Таҳрирлаш", uz_latn: "Tahrirlash" },
  "Добавить": { uz_cyrl: "Қўшиш", uz_latn: "Qo‘shish" },
  "Создать": { uz_cyrl: "Яратиш", uz_latn: "Yaratish" },
  "Обновить данные": { uz_cyrl: "Маълумотларни янгилаш", uz_latn: "Ma’lumotlarni yangilash" },
  "Повторить": { uz_cyrl: "Қайта уриниш", uz_latn: "Qayta urinish" },
  "Назад": { uz_cyrl: "Орқага", uz_latn: "Orqaga" },
  "Далее": { uz_cyrl: "Кейинги", uz_latn: "Keyingi" },
  "Поиск": { uz_cyrl: "Қидирув", uz_latn: "Qidiruv" },
  "Все": { uz_cyrl: "Барчаси", uz_latn: "Barchasi" },
  "В работе": { uz_cyrl: "Жараёнда", uz_latn: "Jarayonda" },
  "Завершённые": { uz_cyrl: "Якунланган", uz_latn: "Yakunlangan" },
  "Новая заявка": { uz_cyrl: "Янги ариза", uz_latn: "Yangi ariza" },
  "Новый проект": { uz_cyrl: "Янги лойиҳа", uz_latn: "Yangi loyiha" },
  "Новая командировка": { uz_cyrl: "Янги хизмат сафари", uz_latn: "Yangi xizmat safari" },
  "Конструктор маршрутов": { uz_cyrl: "Маршрут конструктори", uz_latn: "Marshrut konstruktori" },
  "Текущие заявки": { uz_cyrl: "Жорий аризалар", uz_latn: "Joriy arizalar" },
  "Текущие поездки": { uz_cyrl: "Жорий сафарлар", uz_latn: "Joriy safarlar" },
  "Канбан": { uz_cyrl: "Канбан", uz_latn: "Kanban" },
  "Список": { uz_cyrl: "Рўйхат", uz_latn: "Ro‘yxat" },
  "Нет данных": { uz_cyrl: "Маълумот йўқ", uz_latn: "Ma’lumot yo‘q" },
  "Нет задач": { uz_cyrl: "Вазифалар йўқ", uz_latn: "Vazifalar yo‘q" },
  "Нет проектов": { uz_cyrl: "Лойиҳалар йўқ", uz_latn: "Loyihalar yo‘q" },
  "Нет поездок": { uz_cyrl: "Сафарлар йўқ", uz_latn: "Safarlar yo‘q" },
  "Подтвердить": { uz_cyrl: "Тасдиқлаш", uz_latn: "Tasdiqlash" },
  "Отклонить": { uz_cyrl: "Рад этиш", uz_latn: "Rad etish" },
  "Согласовать": { uz_cyrl: "Келишиш", uz_latn: "Kelishish" },
  "Вернуть": { uz_cyrl: "Қайтариш", uz_latn: "Qaytarish" },
  "Отправить": { uz_cyrl: "Юбориш", uz_latn: "Yuborish" },
  "Ответить": { uz_cyrl: "Жавоб бериш", uz_latn: "Javob berish" },
  "Участники": { uz_cyrl: "Иштирокчилар", uz_latn: "Ishtirokchilar" },
  "Описание": { uz_cyrl: "Тавсиф", uz_latn: "Tavsif" },
  "Название": { uz_cyrl: "Номи", uz_latn: "Nomi" },
  "Статус": { uz_cyrl: "Ҳолат", uz_latn: "Holat" },
  "Срок": { uz_cyrl: "Муддат", uz_latn: "Muddat" },
  "Ответственный": { uz_cyrl: "Масъул", uz_latn: "Mas’ul" },
  "Исполнитель": { uz_cyrl: "Ижрочи", uz_latn: "Ijrochi" },
  "Проект": { uz_cyrl: "Лойиҳа", uz_latn: "Loyiha" },
  "Пригласить сотрудника": { uz_cyrl: "Ходимни таклиф қилиш", uz_latn: "Xodimni taklif qilish" },
  "Сменить свой пароль": { uz_cyrl: "Паролни ўзгартириш", uz_latn: "Parolni o‘zgartirish" },
  "Новый пароль": { uz_cyrl: "Янги парол", uz_latn: "Yangi parol" },
  "Сохранить новый пароль": { uz_cyrl: "Янги паролни сақлаш", uz_latn: "Yangi parolni saqlash" },
  "Двухфакторная защита": { uz_cyrl: "Икки босқичли ҳимоя", uz_latn: "Ikki bosqichli himoya" },
  "Включена": { uz_cyrl: "Ёқилган", uz_latn: "Yoqilgan" },
  "Не включена": { uz_cyrl: "Ёқилмаган", uz_latn: "Yoqilmagan" },
  "Активные устройства": { uz_cyrl: "Фаол қурилмалар", uz_latn: "Faol qurilmalar" },
  "Текущее устройство": { uz_cyrl: "Жорий қурилма", uz_latn: "Joriy qurilma" },
  "Выйти": { uz_cyrl: "Чиқиш", uz_latn: "Chiqish" },
  "Завершить": { uz_cyrl: "Якунлаш", uz_latn: "Yakunlash" },
  "Звук и устройства": { uz_cyrl: "Овоз ва қурилмалар", uz_latn: "Ovoz va qurilmalar" },
  "Для голосовых сообщений. Системный режим автоматически следует за настройками устройства.": { uz_cyrl: "Овозли хабарлар учун. Тизим режими қурилма созламаларига автоматик амал қилади.", uz_latn: "Ovozli xabarlar uchun. Tizim rejimi qurilma sozlamalariga avtomatik amal qiladi." },
  "Микрофон": { uz_cyrl: "Микрофон", uz_latn: "Mikrofon" },
  "Системный микрофон — автоматически": { uz_cyrl: "Тизим микрофони — автоматик", uz_latn: "Tizim mikrofoni — avtomatik" },
  "Вывод звука": { uz_cyrl: "Овоз чиқиши", uz_latn: "Ovoz chiqishi" },
  "Системные динамики — автоматически": { uz_cyrl: "Тизим динамиклари — автоматик", uz_latn: "Tizim dinamiklari — avtomatik" },
  "Список устройств обновлён.": { uz_cyrl: "Қурилмалар рўйхати янгиланди.", uz_latn: "Qurilmalar ro‘yxati yangilandi." },
  "Проверить и обновить": { uz_cyrl: "Текшириш ва янгилаш", uz_latn: "Tekshirish va yangilash" },
  "После сохранения вы войдёте заново. Другие устройства также выйдут из аккаунта.": { uz_cyrl: "Сақлангандан сўнг қайта кирасиз. Бошқа қурилмалардаги сеанслар ҳам якунланади.", uz_latn: "Saqlangandan so‘ng qayta kirasiz. Boshqa qurilmalardagi seanslar ham yakunlanadi." },
  "Не менее 12 символов: заглавные и строчные буквы, цифра и специальный знак.": { uz_cyrl: "Камида 12 та белги: катта ва кичик ҳарфлар, рақам ва махсус белги.", uz_latn: "Kamida 12 ta belgi: katta va kichik harflar, raqam va maxsus belgi." },
  "Одноразовый шестизначный код при каждом новом входе.": { uz_cyrl: "Ҳар бир янги киришда бир марталик олти хонали код.", uz_latn: "Har bir yangi kirishda bir martalik olti xonali kod." },
  "Настроить TOTP": { uz_cyrl: "TOTP ни созлаш", uz_latn: "TOTP ni sozlash" },
  "Можно завершить любую сессию, включая текущую.": { uz_cyrl: "Исталган сеансни, жумладан жорий сеансни ҳам якунлаш мумкин.", uz_latn: "Istalgan seansni, jumladan joriy seansni ham yakunlash mumkin." },
  "Код действует 48 часов и принимается только один раз.": { uz_cyrl: "Код 48 соат амал қилади ва фақат бир марта қабул қилинади.", uz_latn: "Kod 48 soat amal qiladi va faqat bir marta qabul qilinadi." },
  "Имя сотрудника": { uz_cyrl: "Ходим исми", uz_latn: "Xodim ismi" },
  "Логин": { uz_cyrl: "Логин", uz_latn: "Login" },
  "Роль": { uz_cyrl: "Роль", uz_latn: "Rol" },
  "Сотрудник": { uz_cyrl: "Ходим", uz_latn: "Xodim" },
  "Руководитель": { uz_cyrl: "Раҳбар", uz_latn: "Rahbar" },
  "Администратор": { uz_cyrl: "Администратор", uz_latn: "Administrator" },
  "Должность": { uz_cyrl: "Лавозим", uz_latn: "Lavozim" },
  "Не назначена": { uz_cyrl: "Тайинланмаган", uz_latn: "Tayinlanmagan" },
  "Создать приглашение": { uz_cyrl: "Таклиф яратиш", uz_latn: "Taklif yaratish" },
  "Сменить пароль сотрудника": { uz_cyrl: "Ходим паролини ўзгартириш", uz_latn: "Xodim parolini o‘zgartirish" },
  "Без кода сброса. После сохранения все устройства сотрудника выйдут из аккаунта.": { uz_cyrl: "Тиклаш кодисиз. Сақлангандан сўнг ходимнинг барча қурилмаларидаги сеанслар якунланади.", uz_latn: "Tiklash kodisiz. Saqlangandan so‘ng xodimning barcha qurilmalaridagi seanslar yakunlanadi." },
  "Выберите сотрудника": { uz_cyrl: "Ходимни танланг", uz_latn: "Xodimni tanlang" },
  "Сменить пароль": { uz_cyrl: "Паролни ўзгартириш", uz_latn: "Parolni o‘zgartirish" },
  "Администратор может менять пароли сотрудников и руководителей; суперадминистратор — всех.": { uz_cyrl: "Администратор ходимлар ва раҳбарлар паролини, суперадминистратор эса барчаникини ўзгартира олади.", uz_latn: "Administrator xodimlar va rahbarlar parolini, superadministrator esa barchanikini o‘zgartira oladi." },
  "Восстановить доступ": { uz_cyrl: "Киришни тиклаш", uz_latn: "Kirishni tiklash" },
  "Код действует 2 часа; после смены пароля все старые сессии закроются.": { uz_cyrl: "Код 2 соат амал қилади; парол ўзгартирилгандан сўнг барча эски сеанслар ёпилади.", uz_latn: "Kod 2 soat amal qiladi; parol o‘zgartirilgandan so‘ng barcha eski seanslar yopiladi." },
  "Логин сотрудника": { uz_cyrl: "Ходим логини", uz_latn: "Xodim logini" },
  "Также сбросить двухфакторную защиту": { uz_cyrl: "Икки босқичли ҳимояни ҳам тиклаш", uz_latn: "Ikki bosqichli himoyani ham tiklash" },
  "Создать код сброса": { uz_cyrl: "Тиклаш кодини яратиш", uz_latn: "Tiklash kodini yaratish" },
};

let activeLocale: Locale = "ru";

export function setInterfaceLocale(locale: Locale): void {
  activeLocale = locales.includes(locale) ? locale : "ru";
  if (typeof document !== "undefined") document.documentElement.lang = activeLocale.replace("_", "-");
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("yuksalish:locale", { detail: activeLocale }));
}

export function getInterfaceLocale(): Locale { return activeLocale; }

export function translateText(value: string, locale: Locale = activeLocale): string {
  if (locale === "ru" || !/[А-Яа-яЁёЎўҚқҒғҲҳ]/u.test(value)) return value;
  const leading = value.match(/^\s*/u)?.[0] ?? "";
  const trailing = value.match(/\s*$/u)?.[0] ?? "";
  const core = value.slice(leading.length, value.length - trailing.length);
  return `${leading}${productMessages[core]?.[locale] ?? core}${trailing}`;
}
