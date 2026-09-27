import {
  Button,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Spinner,
  Tooltip,
} from "@fluentui/react-components";
import {
  ArrowLeft24Regular,
  BookQuestionMark24Regular,
  Dismiss24Regular,
  Reward24Regular,
} from "@fluentui/react-icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import type {
  EmployeeAchievement,
  EmployeeRecognitionProfile,
  EmployeeReward,
  EmployeeRewardCatalogItem,
  EmployeeRewardInput,
  EmployeeEfficiency,
  WorkspacePerson,
} from "@yuksalish/contracts";
import { ProfileAvatar } from "./ProfileAvatar";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { RecognitionBadgeArtwork } from "./RecognitionBadgeArtwork";
import { RecognitionGuide } from "./RecognitionGuide";
import {
  issueEmployeeReward,
  loadEmployeeRecognitionProfile,
  loadWorkspaceEfficiency,
} from "./workspace-api";

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

interface RewardGroup {
  readonly iconKey: string;
  readonly title: string;
  readonly description: string;
  readonly issuances: readonly EmployeeReward[];
}

function groupRewards(rewards: readonly EmployeeReward[], catalog: readonly EmployeeRewardCatalogItem[]): RewardGroup[] {
  const catalogByIcon = new Map<string, EmployeeRewardCatalogItem>(
    catalog.map((item) => [item.iconKey, item]),
  );
  const groups = new Map<string, RewardGroup>();
  for (const reward of rewards) {
    const current = groups.get(reward.iconKey);
    if (current) {
      groups.set(reward.iconKey, { ...current, issuances: [...current.issuances, reward] });
    } else {
      const preset = catalogByIcon.get(reward.iconKey);
      groups.set(reward.iconKey, {
        iconKey: reward.iconKey,
        title: preset?.title ?? reward.title,
        description: preset?.description ?? reward.description,
        issuances: [reward],
      });
    }
  }
  return [...groups.values()];
}

function issuedAt(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function countLabel(value: number, forms: readonly [string, string, string]): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  return `${value} ${mod100 >= 11 && mod100 <= 14 ? forms[2] : mod10 === 1 ? forms[0] : mod10 >= 2 && mod10 <= 4 ? forms[1] : forms[2]}`;
}

function countWord(value: number, forms: readonly [string, string, string]): string {
  return countLabel(value, forms).replace(/^\d+ /, "");
}

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
    <span><RecognitionBadgeArtwork iconKey={iconKey} /></span>
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
    className={`achievement-card recognition-holographic-card recognition-rarity-${achievement.tier} ${achievement.unlocked ? "is-unlocked" : "is-locked"}`}
    style={holographicStyle}
    onPointerMove={achievement.unlocked ? onPointerMove : undefined}
    onPointerLeave={achievement.unlocked ? onPointerLeave : undefined}
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

function RewardCard({ group, onOpenHistory, people, token, onOpenIssuer }: {
  readonly group: RewardGroup;
  readonly onOpenHistory: () => void;
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly onOpenIssuer: (userId: string) => void;
}) {
  const [elementRef, onPointerMove, onPointerLeave] = useHolographicMotion<HTMLButtonElement>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const historyRequested = useRef(false);
  const previewCloseTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { if (previewCloseTimer.current) window.clearTimeout(previewCloseTimer.current); }, []);
  const keepPreviewOpen = () => {
    historyRequested.current = false;
    if (previewCloseTimer.current) window.clearTimeout(previewCloseTimer.current);
    setPreviewOpen(true);
  };
  const closePreviewSoon = () => {
    previewCloseTimer.current = window.setTimeout(() => setPreviewOpen(false), 140);
  };
  const preview = <div className="reward-history-tooltip">
    <strong>{group.title} · {countLabel(group.issuances.length, ["выдача", "выдачи", "выдач"])}</strong>
    {group.issuances.slice(0, 3).map((reward) => {
      const issuer = people.find((person) => person.id === reward.issuerUserId);
      return <div className="reward-history-preview-entry" key={reward.id}>
        <span>Кто выдал:</span>
        <button type="button" className="reward-issuer-link" aria-label={reward.issuerName} onClick={() => onOpenIssuer(reward.issuerUserId)}>
          {issuer ? <ProfileAvatar person={issuer} token={token} size={24} /> : <span className="reward-issuer-fallback" aria-hidden="true">{reward.issuerName.slice(0, 1)}</span>}
          <strong>{reward.issuerName}</strong>
        </button>
        <time dateTime={reward.createdAt}>{issuedAt(reward.createdAt)}</time>
        {reward.contextNote ? <small>{reward.contextNote}</small> : null}
      </div>;
    })}
    {group.issuances.length > 3 ? <em>Все выдачи — в истории награды</em> : null}
  </div>;
  return <Popover open={previewOpen} onOpenChange={(_, data) => { if (!historyRequested.current) setPreviewOpen(data.open); }} positioning="above" trapFocus={false}>
    <PopoverTrigger disableButtonEnhancement>
    <button
      type="button"
      ref={elementRef}
      className="employee-reward-card recognition-holographic-card recognition-rarity-prism"
      data-reward-icon={group.iconKey}
      style={holographicStyle}
      onPointerMove={onPointerMove}
      onPointerEnter={keepPreviewOpen}
      onPointerLeave={() => { onPointerLeave(); closePreviewSoon(); }}
      onClick={() => { historyRequested.current = true; setPreviewOpen(false); onOpenHistory(); }}
      aria-label={`${group.title}: ${countLabel(group.issuances.length, ["награда", "награды", "наград"])}. Открыть историю выдач`}
    >
      <span className="recognition-card-surface" aria-hidden="true">
        <span className="recognition-card-foil" />
        <span className="recognition-card-glare" />
      </span>
      <span className="recognition-card-content">
        <RecognitionEmblem iconKey={group.iconKey} compact />
        <span className="recognition-card-details">
          <strong className="reward-card-title">{group.title}</strong>
          <span className="reward-card-description">{group.description}</span>
          <small>Наведите или откройте историю</small>
        </span>
        <span className="reward-count" aria-hidden="true">×{group.issuances.length}</span>
      </span>
    </button>
    </PopoverTrigger>
    <PopoverSurface className="reward-history-popover" onPointerEnter={keepPreviewOpen} onPointerLeave={closePreviewSoon}>{preview}</PopoverSurface>
  </Popover>;
}

function RewardCatalogOption({ option, selected, onSelect }: {
  readonly option: EmployeeRewardCatalogItem;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const [elementRef, onPointerMove, onPointerLeave] = useHolographicMotion<HTMLButtonElement>();
  return <button
    ref={elementRef}
    type="button"
    aria-pressed={selected}
    className={`recognition-holographic-card reward-catalog-option${selected ? " is-active" : ""}`}
    data-reward-icon={option.iconKey}
    style={holographicStyle}
    onPointerMove={onPointerMove}
    onPointerLeave={onPointerLeave}
    onClick={onSelect}
  >
    <span className="recognition-card-surface" aria-hidden="true"><span className="recognition-card-foil" /><span className="recognition-card-glare" /></span>
    <span className="recognition-card-content"><RecognitionEmblem iconKey={option.iconKey} compact /><span><strong>{option.title}</strong><small>{option.description}</small></span></span>
  </button>;
}

function RewardHistoryContent({ group, onBack, people, token, onOpenIssuer }: {
  readonly group: RewardGroup;
  readonly onBack: () => void;
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly onOpenIssuer: (userId: string) => void;
}) {
  return <DialogBody>
        <DialogTitle action={<Button autoFocus appearance="subtle" icon={<ArrowLeft24Regular />} aria-label="Вернуться к профилю" onClick={onBack} />}>
          {group.title}
        </DialogTitle>
        <DialogContent>
          <div className="reward-history-content">
            <header><RecognitionBadgeArtwork iconKey={group.iconKey} /><div><span>ПРИЗНАНИЕ КОЛЛЕГ</span><h2>{group.title}</h2><p>{group.description}</p><strong>{countLabel(group.issuances.length, ["выдача", "выдачи", "выдач"])}</strong></div></header>
            <ol>{group.issuances.map((reward) => {
              const issuer = people.find((person) => person.id === reward.issuerUserId);
              return <li key={reward.id}>
              <div><span className="reward-history-issuer-label">Кто выдал:</span><button type="button" className="reward-issuer-link" aria-label={reward.issuerName} onClick={() => onOpenIssuer(reward.issuerUserId)}>{issuer ? <ProfileAvatar person={issuer} token={token} size={24} /> : <span className="reward-issuer-fallback" aria-hidden="true">{reward.issuerName.slice(0, 1)}</span>}<strong>{reward.issuerName}</strong></button><time dateTime={reward.createdAt}>{issuedAt(reward.createdAt)}</time></div>
              {reward.contextNote ? <p>Повод: {reward.contextNote}</p> : null}
              {reward.title !== group.title ? <p>Ранее называлась: {reward.title}</p> : null}
              {reward.description !== group.description ? <p>Ранее указано: {reward.description}</p> : null}
            </li>;
            })}</ol>
          </div>
        </DialogContent>
      </DialogBody>;
}

export function EmployeeProfileDialog({
  token,
  userId,
  open,
  onOpenChange,
  people = [],
  onOpenPersonProfile,
}: {
  readonly token: string;
  readonly userId?: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly people?: readonly WorkspacePerson[];
  readonly onOpenPersonProfile?: (userId: string) => void;
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
  const profileContentRef = useRef<HTMLDivElement>(null);
  const profileScrollRef = useRef(0);
  const guideTriggerRef = useRef<HTMLButtonElement>(null);
  const returnRewardIconRef = useRef<string | null>(null);
  const returnFocusRef = useRef<"guide" | "history" | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [rewardIcon, setRewardIcon] = useState<EmployeeRewardInput["iconKey"]>("appreciation");
  const [rewardContext, setRewardContext] = useState("");
  const [selectedRewardIcon, setSelectedRewardIcon] = useState<string>();
  const [rewardBusy, setRewardBusy] = useState(false);
  const [efficiencyState, setEfficiencyState] = useState<{ readonly userId: string; readonly value?: EmployeeEfficiency }>();
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

  useEffect(() => {
    if (!open || !userId) return;
    let active = true;
    void loadWorkspaceEfficiency(token).then((overview) => {
      if (active) setEfficiencyState({ userId, value: overview.employees.find((employee) => employee.userId === userId) });
    }).catch(() => {
      if (active) setEfficiencyState({ userId });
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
  const rewardGroups = useMemo(
    () => profile ? groupRewards(profile.rewards, profile.rewardCatalog) : [],
    [profile],
  );
  const selectedRewardGroup = rewardGroups.find((group) => group.iconKey === selectedRewardIcon);
  const efficiency = efficiencyState?.userId === userId ? efficiencyState?.value : undefined;
  const openIssuerProfile = (issuerId: string) => {
    setSelectedRewardIcon(undefined);
    setGuideOpen(false);
    onOpenPersonProfile?.(issuerId);
  };

  useEffect(() => {
    if (guideOpen || selectedRewardIcon || !returnFocusRef.current) return;
    const target = returnFocusRef.current;
    const rewardIconToFocus = returnRewardIconRef.current;
    returnFocusRef.current = null;
    returnRewardIconRef.current = null;
    const restoreScroll = () => {
      if (profileContentRef.current) profileContentRef.current.scrollTop = profileScrollRef.current;
    };
    const frame = requestAnimationFrame(() => {
      restoreScroll();
    });
    const timer = window.setTimeout(() => {
      const rewardCard = [...document.querySelectorAll<HTMLButtonElement>(".employee-reward-card")]
        .find((card) => card.dataset.rewardIcon === rewardIconToFocus);
      (target === "guide" ? guideTriggerRef.current : rewardCard)
        ?.focus({ preventScroll: true });
      restoreScroll();
    }, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [guideOpen, selectedRewardIcon]);

  const returnFromGuide = () => {
    returnFocusRef.current = "guide";
    setGuideOpen(false);
  };
  const returnFromHistory = () => {
    returnFocusRef.current = "history";
    returnRewardIconRef.current = selectedRewardIcon ?? null;
    setSelectedRewardIcon(undefined);
  };
  const openGuide = () => {
    profileScrollRef.current = profileContentRef.current?.scrollTop ?? 0;
    setGuideOpen(true);
  };
  const openRewardHistory = (iconKey: string) => {
    profileScrollRef.current = profileContentRef.current?.scrollTop ?? 0;
    setSelectedRewardIcon(iconKey);
  };

  const submitReward = async () => {
    if (!profile || !profile.rewardCatalog.some((item) => item.iconKey === rewardIcon)) return;
    setRewardBusy(true);
    setErrorState(undefined);
    try {
      const reward = await issueEmployeeReward(token, profile.person.id, {
        iconKey: rewardIcon,
        contextNote: rewardContext.trim() || null,
      });
      setProfileState({
        userId: profile.person.id,
        profile: { ...profile, rewards: [reward, ...profile.rewards] },
      });
      setRewardOpen(false);
      setRewardContext("");
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
        setGuideOpen(false);
        setSelectedRewardIcon(undefined);
        returnFocusRef.current = null;
        returnRewardIconRef.current = null;
      }
      onOpenChange(data.open);
    }}>
      <DialogSurface className="employee-profile-dialog" aria-label="Публичный профиль сотрудника">
        <DialogBody>
          <DialogTitle
            action={<Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть профиль" onClick={() => onOpenChange(false)} />}
          >Профиль сотрудника</DialogTitle>
          <DialogContent ref={profileContentRef}>
            {!profile && !error ? <div className="employee-profile-loading"><Spinner label="Загружаем профиль" /></div> : null}
            {error && !profile ? <div className="employee-profile-error" role="alert">{error}</div> : null}
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
                    <strong>{profile.rewards.length}</strong>
                    <span>{countWord(profile.rewards.length, ["награда", "награды", "наград"])} от коллег</span>
                    <small>{countLabel(unlocked.length, ["достижение", "достижения", "достижений"])}</small>
                  </div>
                </header>

                <nav className="employee-profile-tabs" aria-label="Навигация по профилю">
                  {(["overview", "rewards", "achievements"] as const).map((key) => <button
                    type="button"
                    key={key}
                    className={tab === key ? "is-active" : ""}
                    aria-pressed={tab === key}
                    aria-controls={`employee-profile-${key}`}
                    onClick={() => navigateTo(key)}
                  >{{ overview: "Обзор", rewards: "Награды", achievements: "Достижения" }[key]}</button>)}
                </nav>
              </div>

              <section ref={overviewRef} id="employee-profile-overview" className="employee-profile-overview" aria-label="Обзор">
                <article><span>Стаж работы</span><strong>{serviceLabel(profile)}</strong>{profile.employmentDate ? <small>с {new Date(`${profile.employmentDate}T00:00:00`).toLocaleDateString("ru-RU")}</small> : null}</article>
                <article><span>Активные задачи</span><strong>{profile.activeTaskCount == null ? "Скрыто" : profile.activeTaskCount}</strong><small>{profile.activeTaskCountVisible ? "Видно всем сотрудникам" : "Видимость отключена администратором"}</small></article>
                <article><span>Награды коллег</span><strong>{profile.rewards.length}</strong><small>{rewardGroups.length} видов · выдаются сотрудниками</small></article>
                <article className="employee-profile-efficiency"><span>Выполнение задач в срок</span><strong>{efficiency?.percentage == null ? "Нет данных" : `${Math.round(efficiency.percentage)}%`}</strong><div className="employee-profile-efficiency-track" role="meter" aria-label="Эффективность выполнения задач в срок" aria-valuemin={0} aria-valuemax={100} aria-valuenow={efficiency?.percentage == null ? undefined : Math.round(efficiency.percentage)}><i style={{ width: `${Math.min(100, Math.max(0, efficiency?.percentage ?? 0))}%` }} /></div><small>{efficiency ? `${efficiency.onTimeCount} из ${efficiency.eligibleCount} задач в срок · ${efficiency.period}` : "Показатель появится после подтверждённых задач"}</small></article>
                <div className="employee-profile-highlight">
                  <div><h3>Последние достижения</h3><p>Автоматически подтверждены рабочими событиями</p></div>
                  <div className="employee-profile-emblem-row">
                    {unlocked.slice(-4).reverse().map((item) => <Tooltip key={item.code} content={item.title} relationship="label" positioning="above"><button type="button" className="employee-profile-latest-achievement" aria-label={item.title} onClick={() => navigateTo("achievements")}><RecognitionEmblem iconKey={item.iconKey} tier={item.tier} compact /></button></Tooltip>)}
                    {!unlocked.length ? <span>Первые достижения появятся после выполнения критериев.</span> : null}
                  </div>
                </div>
              </section>

              <section ref={rewardsRef} id="employee-profile-rewards" className="employee-rewards-section">
                <header><div><h3>Награды от коллег</h3><p>Личное признание важнее автоматического счётчика</p></div><div className="reward-heading-actions"><Button ref={guideTriggerRef} appearance="subtle" icon={<BookQuestionMark24Regular />} onClick={openGuide}>Как это работает</Button>{profile.canIssueReward ? <Button appearance="primary" icon={<Reward24Regular />} disabled={rewardBusy} onClick={() => { setErrorState(undefined); setRewardOpen((value) => !value); }}>Выдать награду</Button> : null}</div></header>
                {rewardOpen ? <div className="reward-composer">
                  <div className="reward-composer-heading"><strong>Выберите готовую награду</strong><span>Название и смысл награды одинаковы для всех сотрудников.</span></div>
                  <div className="reward-icon-picker" role="group" aria-label="Вид награды">
                    {profile.rewardCatalog.map((option) => <RewardCatalogOption key={option.iconKey} option={option} selected={rewardIcon === option.iconKey} onSelect={() => setRewardIcon(option.iconKey)} />)}
                  </div>
                  <Field label="Повод · необязательно" hint="Например, после завершения проекта или конкретной задачи"><Input maxLength={240} value={rewardContext} onChange={(_, data) => setRewardContext(data.value)} placeholder="Что хочется отметить именно сейчас?" /></Field>
                  {error ? <p className="reward-composer-error" role="alert">{error}</p> : null}
                  <div className="reward-composer-actions"><Button disabled={rewardBusy} onClick={() => { setRewardOpen(false); setErrorState(undefined); }}>Отмена</Button><Button appearance="primary" disabled={rewardBusy || !profile.rewardCatalog.some((item) => item.iconKey === rewardIcon)} onClick={() => void submitReward()}>{rewardBusy ? "Сохраняем…" : "Выдать награду"}</Button></div>
                </div> : null}
                <div className="employee-reward-list">
                  {rewardGroups.length ? rewardGroups.map((group) => <RewardCard key={group.iconKey} group={group} people={people} token={token} onOpenIssuer={openIssuerProfile} onOpenHistory={() => openRewardHistory(group.iconKey)} />) : <p className="recognition-empty">Наград пока нет. Коллеги смогут отметить вклад сотрудника здесь.</p>}
                </div>
              </section>

              <section ref={achievementsRef} id="employee-profile-achievements" className="employee-achievements-section">
                <header><div><h3>Достижения системы</h3><p>Прогресс строится только на подтверждённых данных Workspace</p></div></header>
                <h4>Получено</h4>
                <div className="achievement-grid">
                  {unlocked.length ? unlocked.map((item) => <AchievementCard key={item.code} achievement={item} />) : <p className="recognition-empty">Пока нет открытых достижений.</p>}
                </div>
                {nextAchievements.length ? <><h4>Следующие цели</h4><div className="achievement-grid">{nextAchievements.map((item) => <AchievementCard key={item.code} achievement={item} />)}</div></> : null}
              </section>
            </div> : null}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
    <Dialog open={open && guideOpen} onOpenChange={(_, data) => { if (!data.open) returnFromGuide(); }}><DialogSurface className="recognition-guide-dialog" aria-label="Как работают награды и достижения"><RecognitionGuide onBack={returnFromGuide} achievements={profile?.achievements ?? []} rewardCatalog={profile?.rewardCatalog ?? []} /></DialogSurface></Dialog>
    <Dialog open={open && Boolean(selectedRewardGroup)} onOpenChange={(_, data) => { if (!data.open) returnFromHistory(); }}><DialogSurface className="reward-history-dialog" aria-label="История награды">{selectedRewardGroup ? <RewardHistoryContent group={selectedRewardGroup} onBack={returnFromHistory} people={people} token={token} onOpenIssuer={openIssuerProfile} /> : null}</DialogSurface></Dialog>
  </>;
}
