import { describe, expect, it } from "vitest";
import { editedTripBriefError, tripBriefError, tripBriefPreview } from "./trip-brief-generator";

const facts = {
  destination: "Қашқадарё вилояти, Деҳқонобод тумани",
  startDate: "2026-10-22",
  endDate: "2026-10-22",
  purpose: "Юридик клиника иштирокчилари Қалтаминор маҳалласида сайёр қабул ўтказади",
  expenseSource: "лойиҳа маблағлари",
};

describe("structured trip brief preview", () => {
  it("shows the supplied facts in a one-day Latin-script letter", () => {
    expect(tripBriefError(facts)).toBeUndefined();
    const preview = tripBriefPreview(facts);
    expect(preview).toContain("2026-yil 22-oktabr kuni");
    expect(preview).toContain("Qashqadaryo viloyati, Dehqonobod tumani");
    expect(preview).toContain("Safar xarajatlarini qoplash manbai: loyiha mablagʻlari.");
  });

  it("rejects placeholders and reversed dates before saving", () => {
    expect(tripBriefError({ ...facts, purpose: "test" })).toMatch(/Основание|мероприятие|Опишите/u);
    expect(tripBriefError({ ...facts, expenseSource: "https://example.com" })).toMatch(/источник/u);
    expect(tripBriefError({ ...facts, endDate: "2026-10-21" })).toMatch(/Дата окончания/u);
  });

  it("requires meaningful employee edits without links", () => {
    expect(editedTripBriefError(tripBriefPreview(facts))).toBeUndefined();
    expect(editedTripBriefError("test ".repeat(40))).toMatch(/Проверьте текст/u);
    expect(editedTripBriefError(`${tripBriefPreview(facts)} https://example.com`)).toMatch(/Проверьте текст/u);
  });
});
