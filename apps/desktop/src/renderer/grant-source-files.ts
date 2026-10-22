export const GRANT_SOURCE_FILES_HINT = "До 20 файлов; до 25 МБ каждый и 100 МБ суммарно. Отправятся вместе с заявкой.";

export function validateGrantSourceFiles(files: readonly File[]): void {
  if (files.length > 20) throw new Error("Можно выбрать не больше 20 файлов.");
  if (files.some((file) => !file.size)) throw new Error("Пустые файлы прикрепить нельзя.");
  if (files.some((file) => file.size > 25 * 1024 * 1024)) throw new Error("Каждый файл должен быть не больше 25 МБ.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) throw new Error("Общий размер файлов должен быть не больше 100 МБ.");
}
