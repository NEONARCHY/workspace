// Synthetic read-only API snapshots for the production-App visual harness.
module.exports = (user, people) => {
  const report = (i, month = "2026-11-01") => ({ id: `monthly-${month}-${i}`, month, userId: people[i % people.length].id,
    revision: 1, comment: "Подготовлены материалы региональных встреч и сводка выполненных задач.", submittedAt: "2026-11-25T10:00:00Z",
    files: [{ id: `file-${i}`, name: "Итоги работы подразделения.docx", size: 28672 }] });
  const monthly = { today: "2026-11-26", activeMonth: "2026-11-01", dashboardVisible: false,
    canReview: true, canAuthorize: true, canConfigure: false, reminderMonth: null, payrollNotice: null, payrollNoticeId: null,
    reports: [{ ...report(0), userId: user.id }],
    cycles: ["2026-11-01", "2026-10-01"].map(month => ({ month, reminderOn: month === "2026-11-01" ? "2026-11-25" : "2026-10-28",
      total: people.length, submitted: Math.ceil(people.length / 2), authorizedAt: null, authorizedByName: null, comment: "", canSubmit: true,
      members: people.map((p, i) => ({ userId: p.id, name: p.name, department: "Региональные программы", report: i % 2 ? null : report(i, month) })) })) };
  const reports = Array.from({ length: 24 }, (_, i) => ({ id: `hisobot-${i}`, userId: people[i % people.length].id,
    telegramId: String(10001 + i), employeeKey: `qa-${i}`, fullName: people[i % people.length].name, position: "Координатор региональных программ",
    reportScope: i % 3 ? "central" : "hudud", regionName: i % 3 ? null : "Самарканд", reportDate: "2026-11-25",
    content: "Подготовлены материалы региональной встречи.\nПроверены документы и согласован план работы подразделения.",
    submittedAt: "2026-11-25T12:00:00Z", isLate: false, source: i % 2 ? "telegram" : "workspace" }));
  const profile = { telegramId: "10001", fullName: user.name, position: "Руководитель подразделения", reportScope: "central", regionName: null,
    reportRequired: true, managementAccess: true, absenceKind: null, today: "2026-11-26", canSubmit: true, windowOpensAt: "12:00",
    windowClosesAt: "21:00", deadlineAt: "18:30", isOverdue: false, todayReport: null,
    activityDraft: { reportDate: "2026-11-26", generatedAt: "2026-11-26T09:00:00Z", seenAt: "2026-11-26T09:00:00Z",
      activityCount: 3, omittedCount: 0, content: "1. Подготовлена программа региональной встречи.\n2. Проверены материалы проекта.\n3. Согласован план работы команды." } };
  const efficiency = { period: "2026-11", timezone: "Asia/Tashkent", methodologyVersion: "EFF-2.0", trackingStartedAt: "2026-09-01T00:00:00Z", currentUserId: user.id,
    employees: people.map((p, i) => ({ userId: p.id, name: p.name, jobTitle: "Координатор региональных программ", period: "2026-11", timezone: "Asia/Tashkent",
      percentage: i % 5 === 4 ? null : 80, onTimeCount: i % 5 === 4 ? 0 : 8, eligibleCount: i % 5 === 4 ? 0 : 10,
      overdueCount: i % 5 === 4 ? 0 : 2, awaitingReviewCount: 1, noDueDateCount: 3, returnedForRevisionCount: 1, excludedCount: 1,
      sampleSize: 10, smallSample: false, historyCompleteness: "complete", methodologyVersion: "EFF-2.0", trackingStartedAt: "2026-09-01T00:00:00Z",
      history: [60, 75, 80].map((percentage, index) => ({ period: `2026-${String(9 + index).padStart(2, "0")}`, percentage,
        onTimeCount: percentage / 5, eligibleCount: 20, historyCompleteness: "complete" })) })) };
  return { monthly, hisobot: { profile, reports }, efficiency };
};
