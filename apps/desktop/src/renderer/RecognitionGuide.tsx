import { Button, DialogBody, DialogContent, DialogTitle } from "@fluentui/react-components";
import { ArrowLeft24Regular } from "@fluentui/react-icons";
import type { EmployeeAchievement, EmployeeRewardCatalogItem, RecognitionTier } from "@yuksalish/contracts";
import { RecognitionBadgeArtwork } from "./RecognitionBadgeArtwork";

const tierLabels: Readonly<Record<RecognitionTier, string>> = {
  bronze: "Бронза",
  silver: "Серебро",
  gold: "Золото",
  platinum: "Платина",
  sapphire: "Сапфир",
  amethyst: "Аметист",
  prism: "Призма",
  cosmic: "Космос",
};

function achievementLadders(achievements: readonly EmployeeAchievement[]) {
  const groups = new Map<string, EmployeeAchievement[]>();
  for (const achievement of achievements) {
    const key = achievement.code.replace(/_\d+$/, "");
    groups.set(key, [...(groups.get(key) ?? []), achievement]);
  }
  return [...groups.entries()].flatMap(([key, levels]) => {
    const first = levels[0];
    if (!first) return [];
    return [{
      key,
      iconKey: first.iconKey,
      title: key === "tenure" ? "Стаж в команде" : first.title.replace(/ · \d+$/, ""),
      description: first.description,
      levels,
    }];
  });
}

export function RecognitionGuide({ onBack, achievements, rewardCatalog }: {
  readonly onBack: () => void;
  readonly achievements: readonly EmployeeAchievement[];
  readonly rewardCatalog: readonly EmployeeRewardCatalogItem[];
}) {
  const ladders = achievementLadders(achievements);
  return <DialogBody>
        <DialogTitle action={<Button autoFocus appearance="subtle" icon={<ArrowLeft24Regular />} aria-label="Вернуться к профилю" onClick={onBack} />}>
          Награды и достижения
        </DialogTitle>
        <DialogContent>
          <div className="recognition-guide-content">
            <header className="recognition-guide-hero">
              <span>ПРИЗНАНИЕ В WORKSPACE</span>
              <h2>Вклад замечают люди.<br />Результат подтверждает система.</h2>
              <p>Награды от коллег показываются в профиле первыми. Достижения считаются по рабочим событиям автоматически.</p>
              <div className="recognition-guide-hero-stats">
                <strong>{rewardCatalog.length} <small>готовых наград</small></strong>
                <strong>{ladders.length} <small>линеек достижений</small></strong>
              </div>
            </header>

            <section className="recognition-guide-section" aria-labelledby="guide-rewards-heading">
              <div className="recognition-guide-section-title"><span>01 · ОТ КОЛЛЕГ</span><h3 id="guide-rewards-heading">Личные награды</h3><p>Любой сотрудник может отметить другого. Выберите готовую награду; повод, задачу или проект можно указать по желанию.</p></div>
              <div className="recognition-guide-reward-grid">
                {rewardCatalog.map((item) => <article key={item.iconKey}>
                  <RecognitionBadgeArtwork iconKey={item.iconKey} />
                  <div><strong>{item.title}</strong><p>{item.description}</p></div>
                </article>)}
              </div>
              <div className="recognition-guide-rules">
                <span>Одинаковую награду можно выдавать повторно: в профиле растёт счётчик, а каждая выдача сохраняется в истории.</span>
                <span>До 12 выдач от одного автора за календарный месяц. Себя наградить нельзя.</span>
              </div>
            </section>

            <section className="recognition-guide-section" aria-labelledby="guide-achievements-heading">
              <div className="recognition-guide-section-title"><span>02 · ОТ СИСТЕМЫ</span><h3 id="guide-achievements-heading">Карта достижений</h3><p>Пороги ниже берутся из действующих правил профиля. Завершённые уровни остаются яркими, следующие цели приглушены.</p></div>
              <div className="recognition-guide-ladder-grid">
                {ladders.map((ladder) => <article key={ladder.key}>
                  <div className="recognition-guide-ladder-head"><RecognitionBadgeArtwork iconKey={ladder.iconKey} /><div><strong>{ladder.title}</strong><p>{ladder.description}</p></div></div>
                  <div className="recognition-guide-levels">
                    {ladder.levels.map((level) => <span key={level.code} className={level.unlocked ? "is-earned" : ""} title={`${tierLabels[level.tier]}: ${level.target}${ladder.key === "tenure" || ladder.key.startsWith("efficiency") ? " мес." : ""}`}>
                      <b>{level.target}</b><small>{tierLabels[level.tier]}</small>
                    </span>)}
                  </div>
                </article>)}
              </div>
            </section>

            <section className="recognition-guide-fairness" aria-label="Как защищён прогресс">
              <strong>Что считается подтверждением?</strong>
              <p>Задача должна быть завершена, проект — успешно завершён, поездка — согласована, письмо — действительно отправлено. Для эффективности нужен месяц от 90% при выборке минимум из пяти задач; для стажа — дата, подтверждённая кадровой службой.</p>
              <p>Личные чаты один на один, удалённые сообщения, собственные реакции, неудачные Zoom-встречи и письма без подтверждения отправки прогресс не увеличивают.</p>
            </section>
          </div>
        </DialogContent>
      </DialogBody>;
}
