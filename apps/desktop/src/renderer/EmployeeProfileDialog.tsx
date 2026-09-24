import {
  Button,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Spinner,
  Textarea,
} from "@fluentui/react-components";
import {
  BookQuestionMark24Regular,
  CheckmarkCircle24Regular,
  Dismiss24Regular,
  Flash24Regular,
  Lightbulb24Regular,
  Mail24Regular,
  Money24Regular,
  News24Regular,
  PeopleTeam24Regular,
  PersonHeart24Regular,
  Reward24Regular,
  ShieldCheckmark24Regular,
  Sparkle24Regular,
  Star24Regular,
  Video24Regular,
} from "@fluentui/react-icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import type {
  EmployeeAchievement,
  EmployeeRecognitionProfile,
  EmployeeReward,
  EmployeeRewardInput,
} from "@yuksalish/contracts";
import { ProfileAvatar } from "./ProfileAvatar";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import {
  issueEmployeeReward,
  loadEmployeeRecognitionProfile,
} from "./workspace-api";

const achievementIcons: Readonly<Record<string, ReactNode>> = {
  check: <CheckmarkCircle24Regular />,
  layers: <Reward24Regular />,
  compass: <Flash24Regular />,
  signal: <PeopleTeam24Regular />,
  spark: <PersonHeart24Regular />,
  pulse: <ShieldCheckmark24Regular />,
  orbit: <Sparkle24Regular />,
  gem: <Star24Regular />,
  camera: <Video24Regular />,
  mail: <Mail24Regular />,
  megaphone: <News24Regular />,
  receipt: <Money24Regular />,
  target: <CheckmarkCircle24Regular />,
};

const tierLabels: Readonly<Record<EmployeeAchievement["tier"], string>> = {
  bronze: "Бронза",
  silver: "Серебро",
  gold: "Золото",
  platinum: "Платина",
  sapphire: "Сапфир",
  amethyst: "Аметист",
  prism: "Призма",
  cosmic: "Космос",
};

const rewardIcons: Readonly<Record<string, ReactNode>> = {
  appreciation: <PersonHeart24Regular />,
  leadership: <Star24Regular />,
  rescue: <Flash24Regular />,
  mentorship: <PeopleTeam24Regular />,
  innovation: <Lightbulb24Regular />,
  reliability: <ShieldCheckmark24Regular />,
};

const rewardOptions: readonly {
  readonly key: EmployeeRewardInput["iconKey"];
  readonly label: string;
  readonly detail: string;
}[] = [
  { key: "appreciation", label: "Благодарность", detail: "За помощь и человеческую поддержку" },
  { key: "leadership", label: "Лидерство", detail: "За ясное направление и ответственность" },
  { key: "rescue", label: "Спасение срока", detail: "За решающий вклад в критический момент" },
  { key: "mentorship", label: "Наставничество", detail: "За развитие и поддержку коллег" },
  { key: "innovation", label: "Новаторство", detail: "За идею, улучшившую рабочий процесс" },
  { key: "reliability", label: "Надёжность", detail: "За устойчивый результат, на который можно опереться" },
];

type HolographicStyle = CSSProperties & {
  "--recognition-active": string;
  "--recognition-light-x": string;
  "--recognition-light-y": string;
  "--recognition-rx": string;
  "--recognition-ry": string;
  "--recognition-foil-x": string;
  "--recognition-foil-y": string;
  "--recognition-foil-angle": string;
  "--recognition-icon-x": string;
  "--recognition-icon-y": string;
};

const holographicStyle: HolographicStyle = {
  "--recognition-active": "0",
  "--recognition-light-x": "50%",
  "--recognition-light-y": "50%",
  "--recognition-rx": "0deg",
  "--recognition-ry": "0deg",
  "--recognition-foil-x": "0%",
  "--recognition-foil-y": "0%",
  "--recognition-foil-angle": "0deg",
  "--recognition-icon-x": "0px",
  "--recognition-icon-y": "0px",
};

function useHolographicMotion<T extends HTMLElement>() {
  const elementRef = useRef<T>(null);
  const motionRef = useRef({ x: 0, y: 0, active: 0, targetX: 0, targetY: 0, targetActive: 0, frame: 0 });

  useEffect(() => () => cancelAnimationFrame(motionRef.current.frame), []);

  const renderFrame = () => {
    const state = motionRef.current;
    const element = elementRef.current;
    if (!element) return;
    state.x += (state.targetX - state.x) * 0.12;
    state.y += (state.targetY - state.y) * 0.12;
    state.active += (state.targetActive - state.active) * 0.1;
    element.style.setProperty("--recognition-active", state.active.toFixed(3));
    element.style.setProperty("--recognition-light-x", `${50 + state.x * 40}%`);
    element.style.setProperty("--recognition-light-y", `${50 + state.y * 40}%`);
    element.style.setProperty("--recognition-rx", `${-state.y * 6}deg`);
    element.style.setProperty("--recognition-ry", `${state.x * 8}deg`);
    element.style.setProperty("--recognition-foil-x", `${state.x * 15}%`);
    element.style.setProperty("--recognition-foil-y", `${state.y * 15}%`);
    element.style.setProperty("--recognition-foil-angle", `${state.x * 20}deg`);
    element.style.setProperty("--recognition-icon-x", `${state.x * 3}px`);
    element.style.setProperty("--recognition-icon-y", `${state.y * 3}px`);
    const moving = Math.abs(state.targetX - state.x) > 0.002
      || Math.abs(state.targetY - state.y) > 0.002
      || Math.abs(state.targetActive - state.active) > 0.002;
    state.frame = moving ? requestAnimationFrame(renderFrame) : 0;
  };

  const scheduleFrame = () => {
    if (!motionRef.current.frame) motionRef.current.frame = requestAnimationFrame(renderFrame);
  };
  const onPointerMove = (event: PointerEvent<T>) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const state = motionRef.current;
    state.targetX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    state.targetY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    state.targetActive = 1;
    scheduleFrame();
  };
  const onPointerLeave = () => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const state = motionRef.current;
    state.targetX = 0;
    state.targetY = 0;
    state.targetActive = 0;
    scheduleFrame();
  };
  return [elementRef, onPointerMove, onPointerLeave] as const;
}

function RecognitionEmblem({
  iconKey,
  tier = "prism",
  unlocked = true,
  compact = false,
}: {
  readonly iconKey: string;
  readonly tier?: EmployeeAchievement["tier"];
  readonly unlocked?: boolean;
  readonly compact?: boolean;
}) {
  return <span
    className={`recognition-emblem recognition-${tier}${unlocked ? " is-unlocked" : " is-locked"}${compact ? " is-compact" : ""}`}
    aria-hidden="true"
  >
    <span>{achievementIcons[iconKey] ?? rewardIcons[iconKey] ?? <Reward24Regular />}</span>
  </span>;
}

function serviceLabel(profile: EmployeeRecognitionProfile): string {
  if (profile.serviceYears == null || profile.serviceMonths == null || profile.serviceDays == null) {
    return "Стаж пока не заполнен кадровой службой";
  }
  return `${profile.serviceYears} г. ${profile.serviceMonths} мес. ${profile.serviceDays} дн.`;
}

function AchievementCard({ achievement }: { readonly achievement: EmployeeAchievement }) {
  const percent = Math.min(100, Math.round(achievement.progress / achievement.target * 100));
  const [elementRef, onPointerMove, onPointerLeave] = useHolographicMotion<HTMLElement>();
  return <article
    ref={elementRef}
    className={`achievement-card recognition-holographic-card recognition-rarity-${achievement.tier}${achievement.unlocked ? " is-unlocked" : ""}`}
    style={holographicStyle}
    onPointerMove={onPointerMove}
    onPointerLeave={onPointerLeave}
  >
    <div className="recognition-card-surface" aria-hidden="true">
      <span className="recognition-card-foil" />
      <span className="recognition-card-glare" />
    </div>
    <div className="recognition-card-content">
      <RecognitionEmblem
        iconKey={achievement.iconKey}
        tier={achievement.tier}
        unlocked={achievement.unlocked}
      />
      <div className="recognition-card-details">
        <span className="achievement-tier">{tierLabels[achievement.tier]}</span>
        <h3>{achievement.title}</h3>
        <p>{achievement.description}</p>
        <small>{achievement.unlocked ? "Получено" : `${achievement.progress} из ${achievement.target}`}</small>
        <div className="achievement-progress" aria-label={`Прогресс: ${achievement.progress} из ${achievement.target}`}>
          <i style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  </article>;
}

function RewardCard({ reward }: { readonly reward: EmployeeReward }) {
  const [elementRef, onPointerMove, onPointerLeave] = useHolographicMotion<HTMLElement>();
  return <article
    ref={elementRef}
    className="employee-reward-card recognition-holographic-card recognition-rarity-prism"
    style={holographicStyle}
    onPointerMove={onPointerMove}
    onPointerLeave={onPointerLeave}
  >
    <div className="recognition-card-surface" aria-hidden="true">
      <span className="recognition-card-foil" />
      <span className="recognition-card-glare" />
    </div>
    <div className="recognition-card-content">
      <RecognitionEmblem iconKey={reward.iconKey} compact />
      <div className="recognition-card-details">
        <h3>{reward.title}</h3>
        <p>{reward.description}</p>
        <small><EmployeeProfileLink userId={reward.issuerUserId} personName={reward.issuerName}>{reward.issuerName}</EmployeeProfileLink> · {new Date(reward.createdAt).toLocaleDateString("ru-RU")}</small>
      </div>
    </div>
  </article>;
}

function RecognitionGuide({ open, onOpenChange }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
    <DialogSurface className="recognition-guide-dialog">
      <DialogBody>
        <DialogTitle
          action={<Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть справку" onClick={() => onOpenChange(false)} />}
        >Как работают достижения</DialogTitle>
        <DialogContent>
          <div className="recognition-guide-copy">
            <p>Workspace считает только подтверждённые рабочие события. Процессные линейки проходят восемь уровней — от бронзы до космической редкости.</p>
            <h3>Что учитывается</h3>
            <ul>
              <li>принятые задачи, успешно завершённые проекты и согласованные поездки;</li>
              <li>созданные Zoom-встречи, опубликованные новости и подтверждённо отправленные письма;</li>
              <li>созданные заявки на оплату и собственные заявки, доведённые до утверждения;</li>
              <li>месяцы с эффективностью от 90% при выборке минимум из пяти задач и серии таких месяцев;</li>
              <li>подтверждённый кадровой службой стаж: 1 и 6 месяцев, затем каждый год до пяти лет;</li>
              <li>сообщения в рабочих группах и реакции коллег на групповые сообщения, комментарии задач и ленту.</li>
            </ul>
            <h3>Защита от накрутки</h3>
            <p>Личные чаты один на один и собственные реакции не учитываются. Удалённые сообщения, технически не созданные Zoom-встречи и письма без подтверждения отправки также не дают прогресс.</p>
            <h3>Награды</h3>
            <p>Награды — это человеческое признание, а не автоматический счётчик. Их выдают руководители, кадровики и администраторы. Один автор может выдать не более 12 наград в месяц; одинаковую награду одному сотруднику — не чаще раза в 30 дней.</p>
          </div>
        </DialogContent>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}

export function EmployeeProfileDialog({
  token,
  userId,
  open,
  onOpenChange,
}: {
  readonly token: string;
  readonly userId?: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [profileState, setProfileState] = useState<{
    readonly userId: string;
    readonly profile: EmployeeRecognitionProfile;
  }>();
  const [errorState, setErrorState] = useState<{ readonly userId: string; readonly message: string }>();
  const [tab, setTab] = useState<"overview" | "achievements" | "rewards">("overview");
  const overviewRef = useRef<HTMLElement>(null);
  const achievementsRef = useRef<HTMLElement>(null);
  const rewardsRef = useRef<HTMLElement>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [rewardIcon, setRewardIcon] = useState<EmployeeRewardInput["iconKey"]>("appreciation");
  const [rewardTitle, setRewardTitle] = useState("");
  const [rewardDescription, setRewardDescription] = useState("");
  const [rewardBusy, setRewardBusy] = useState(false);
  const profile = profileState && profileState.userId === userId
    ? profileState.profile
    : undefined;
  const error = errorState && errorState.userId === userId ? errorState.message : "";

  useEffect(() => {
    if (!open || !userId) return;
    let active = true;
    void loadEmployeeRecognitionProfile(token, userId)
      .then((loaded) => { if (active) setProfileState({ userId, profile: loaded }); })
      .catch((cause: unknown) => {
        if (active) setErrorState({
          userId,
          message: cause instanceof Error ? cause.message : "Не удалось открыть профиль",
        });
      });
    return () => { active = false; };
  }, [open, token, userId]);

  const unlocked = useMemo(
    () => profile?.achievements.filter((item) => item.unlocked) ?? [],
    [profile],
  );
  const nextAchievements = useMemo(() => {
    if (!profile) return [];
    const byCategory = new Map<string, EmployeeAchievement>();
    for (const item of profile.achievements) {
      if (!item.unlocked && !byCategory.has(item.category)) byCategory.set(item.category, item);
    }
    return [...byCategory.values()];
  }, [profile]);

  const submitReward = async () => {
    if (!profile || !rewardTitle.trim() || rewardDescription.trim().length < 8) return;
    setRewardBusy(true);
    setErrorState(undefined);
    try {
      const reward = await issueEmployeeReward(token, profile.person.id, {
        iconKey: rewardIcon,
        title: rewardTitle.trim(),
        description: rewardDescription.trim(),
      });
      setProfileState({
        userId: profile.person.id,
        profile: { ...profile, rewards: [reward, ...profile.rewards] },
      });
      setRewardOpen(false);
      setRewardTitle("");
      setRewardDescription("");
    } catch (cause) {
      setErrorState({
        userId: profile.person.id,
        message: cause instanceof Error ? cause.message : "Не удалось выдать награду",
      });
    } finally {
      setRewardBusy(false);
    }
  };

  const navigateTo = (section: "overview" | "achievements" | "rewards") => {
    setTab(section);
    const target = {
      overview: overviewRef.current,
      achievements: achievementsRef.current,
      rewards: rewardsRef.current,
    }[section];
    if (typeof target?.scrollIntoView !== "function") return;
    const reduceMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  return <>
    <Dialog open={open} onOpenChange={(_, data) => {
      if (!data.open) {
        setTab("overview");
        setRewardOpen(false);
      }
      onOpenChange(data.open);
    }}>
      <DialogSurface className="employee-profile-dialog" aria-label="Публичный профиль сотрудника">
        <DialogBody>
          <DialogTitle
            action={<Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть профиль" onClick={() => onOpenChange(false)} />}
          >Профиль сотрудника</DialogTitle>
          <DialogContent>
            {!profile && !error ? <div className="employee-profile-loading"><Spinner label="Загружаем профиль" /></div> : null}
            {error ? <div className="employee-profile-error" role="alert">{error}</div> : null}
            {profile ? <div className="employee-profile-shell">
              <div className="employee-profile-sticky">
                <header className="employee-profile-hero">
                  <ProfileAvatar person={profile.person} token={token} size={72} />
                  <div>
                    <span>Рабочий профиль</span>
                    <h2>{profile.person.name}</h2>
                    <p>{profile.person.jobTitle ?? "Должность не указана"}</p>
                    {profile.departmentName ? <small>{profile.departmentName}</small> : null}
                  </div>
                  <div className="employee-profile-hero-stat">
                    <strong>{unlocked.length}</strong>
                    <span>достижений</span>
                  </div>
                </header>

                <nav className="employee-profile-tabs" aria-label="Навигация по профилю">
                  {(["overview", "achievements", "rewards"] as const).map((key) => <button
                    type="button"
                    key={key}
                    className={tab === key ? "is-active" : ""}
                    aria-pressed={tab === key}
                    aria-controls={`employee-profile-${key}`}
                    onClick={() => navigateTo(key)}
                  >{{ overview: "Обзор", achievements: "Достижения", rewards: "Награды" }[key]}</button>)}
                </nav>
              </div>

              <section ref={overviewRef} id="employee-profile-overview" className="employee-profile-overview" aria-label="Обзор">
                <article><span>Стаж работы</span><strong>{serviceLabel(profile)}</strong>{profile.employmentDate ? <small>с {new Date(`${profile.employmentDate}T00:00:00`).toLocaleDateString("ru-RU")}</small> : null}</article>
                <article><span>Активные задачи</span><strong>{profile.activeTaskCount == null ? "Скрыто" : profile.activeTaskCount}</strong><small>{profile.activeTaskCountVisible ? "Видно всем сотрудникам" : "Видимость отключена администратором"}</small></article>
                <article><span>Награды коллег</span><strong>{profile.rewards.length}</strong><small>Выданы руководством и кадровой службой</small></article>
                <div className="employee-profile-highlight">
                  <div><h3>Последние достижения</h3><p>Автоматически подтверждены рабочими событиями</p></div>
                  <div className="employee-profile-emblem-row">
                    {unlocked.slice(-4).reverse().map((item) => <RecognitionEmblem key={item.code} iconKey={item.iconKey} tier={item.tier} compact />)}
                    {!unlocked.length ? <span>Первые достижения появятся после выполнения критериев.</span> : null}
                  </div>
                </div>
              </section>

              <section ref={achievementsRef} id="employee-profile-achievements" className="employee-achievements-section">
                <header><div><h3>Достижения</h3><p>Прогресс строится только на подтверждённых данных Workspace</p></div><Button icon={<BookQuestionMark24Regular />} onClick={() => setGuideOpen(true)}>Как это работает</Button></header>
                <h4>Получено</h4>
                <div className="achievement-grid">
                  {unlocked.length ? unlocked.map((item) => <AchievementCard key={item.code} achievement={item} />) : <p className="recognition-empty">Пока нет открытых достижений.</p>}
                </div>
                {nextAchievements.length ? <><h4>Следующие цели</h4><div className="achievement-grid">{nextAchievements.map((item) => <AchievementCard key={item.code} achievement={item} />)}</div></> : null}
              </section>

              <section ref={rewardsRef} id="employee-profile-rewards" className="employee-rewards-section">
                <header><div><h3>Награды</h3><p>Личное признание вклада сотрудника</p></div>{profile.canIssueReward ? <Button appearance="primary" icon={<Reward24Regular />} onClick={() => setRewardOpen((value) => !value)}>Выдать награду</Button> : null}</header>
                {rewardOpen ? <div className="reward-composer">
                  <div className="reward-icon-picker" role="radiogroup" aria-label="Вид награды">
                    {rewardOptions.map((option) => <button key={option.key} type="button" role="radio" aria-checked={rewardIcon === option.key} className={rewardIcon === option.key ? "is-active" : ""} onClick={() => setRewardIcon(option.key)}>
                      <RecognitionEmblem iconKey={option.key} compact />
                      <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                    </button>)}
                  </div>
                  <Field label="Название награды"><input maxLength={100} value={rewardTitle} onChange={(event) => setRewardTitle(event.target.value)} placeholder="Например, Сильная командная опора" /></Field>
                  <Field label="За что выдаётся"><Textarea resize="vertical" value={rewardDescription} onChange={(_, data) => setRewardDescription(data.value)} placeholder="Коротко опишите конкретный вклад сотрудника" /></Field>
                  <div className="reward-composer-actions"><Button onClick={() => setRewardOpen(false)}>Отмена</Button><Button appearance="primary" disabled={rewardBusy || rewardTitle.trim().length < 2 || rewardDescription.trim().length < 8} onClick={() => void submitReward()}>{rewardBusy ? "Сохраняем…" : "Выдать награду"}</Button></div>
                </div> : null}
                <div className="employee-reward-list">
                  {profile.rewards.length ? profile.rewards.map((reward) => <RewardCard key={reward.id} reward={reward} />) : <p className="recognition-empty">Наград пока нет.</p>}
                </div>
              </section>
            </div> : null}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
    <RecognitionGuide open={guideOpen} onOpenChange={setGuideOpen} />
  </>;
}
