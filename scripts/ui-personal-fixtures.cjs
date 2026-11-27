module.exports = (data) => ({
  profile: { ...data.recognition, person: data.user, departmentName: 'Управление региональных программ', employmentDate: '2022-03-14',
    achievements: Array.from({ length: 12 }, (_, i) => ({ ...data.recognition.achievements[0], code: `qa-achievement-${i}`, title: ['Надёжный результат', 'Работа в команде', 'Точный срок'][i % 3], unlocked: i < 5, progress: i < 5 ? 10 : 3, target: 10 })),
    rewards: Array.from({ length: 18 }, (_, i) => ({ ...data.recognition.rewards[0], id: `qa-reward-${i}`, recipientUserId: data.user.id, issuerUserId: data.people[i % data.people.length].id, issuerName: data.people[i % data.people.length].name })),
    rewardCatalog: [{ iconKey: 'appreciation', title: 'Благодарность', description: 'За помощь в совместной работе' }],
  },
  support: { mode: 'inbox', unreadResponseCount: 0, indicator: null, requests: Array.from({ length: 45 }, (_, i) => ({
    id: `qa-support-${i}`, subject: ['Не открывается документ в рабочем чате', 'Уточнение доступа к региональным проектам', 'Улучшение поиска по задачам'][i % 3] + ` · ${i + 1}`,
    authorId: data.people[i % data.people.length].id, authorName: data.people[i % data.people.length].name, authorUsername: `qa-${i}`, body: 'Описание тестового обращения',
    category: ['bug', 'comment', 'improvement'][i % 3], status: ['open', 'implemented', 'rejected'][i % 3], responseUnread: false,
    createdAt: '2026-11-25T09:00:00Z', updatedAt: '2026-11-26T09:00:00Z',
    messages: [{ id: `qa-support-message-${i}`, requestId: `qa-support-${i}`, authorId: data.people[i % data.people.length].id, authorName: data.people[i % data.people.length].name, kind: 'submission', body: 'При открытии вложения появляется сообщение об ошибке. В списке задач файл отображается. Просьба проверить доступ к документу.', createdAt: '2026-11-25T09:00:00Z' }],
  })) },
  sessions: [{ id: 'qa-current-session', current: true, deviceLabel: 'Рабочий компьютер', createdAt: '2026-11-26T04:00:00Z', lastSeenAt: '2026-11-26T09:00:00Z' }],
});
