import { useMemo, useState } from "react";

import type { MemberDirectoryItem, MembersRegistry } from "@yuksalish/contracts";
import { Avatar, Badge, Button, Input, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular, Search20Regular } from "@fluentui/react-icons";

import { RecordTablePager, SortHeading, tableCollator, useTablePage, type TableSort } from "./RecordTableTools";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";

interface MembersViewProps {
  readonly registry?: MembersRegistry;
  readonly loading: boolean;
  readonly error?: string;
  readonly onRefresh: () => void;
}

const genderLabel: Record<string, string> = { male: "Мужской", female: "Женский" };
const displayName = (member: MemberDirectoryItem) =>
  [member.firstName, member.lastName].filter(Boolean).join(" ") || member.username || `Член №${member.id}`;
const dateText = (value?: string | null) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(value)) : "—";

function MembersRecords({ members, filterKey, onOpen }: {
  readonly members: readonly MemberDirectoryItem[];
  readonly filterKey: string;
  readonly onOpen: (member: MemberDirectoryItem) => void;
}) {
  const [sort, setSort] = useState<TableSort>({ key: "createdAt", descending: true });
  const sorted = useMemo(() => [...members].sort((left, right) => {
    const value = (member: MemberDirectoryItem) => {
      if (sort.key === "region") return member.regionNameRu ?? "";
      if (sort.key === "sphere") return member.sphereNameRu ?? "";
      if (sort.key === "gender") return genderLabel[member.gender ?? ""] ?? "";
      if (sort.key === "status") return member.status;
      if (sort.key === "createdAt") return member.createdAt;
      return displayName(member);
    };
    return tableCollator.compare(value(left), value(right)) * (sort.descending ? -1 : 1);
  }), [members, sort]);
  const paging = useTablePage(sorted.length, `${filterKey}:${sort.key}:${sort.descending}`);
  const pageMembers = sorted.slice(paging.start, paging.start + paging.size);
  const changeSort = (key: string) => setSort({ key, descending: sort.key === key && !sort.descending });
  return <div className="record-table-frame members-records">
    <div className="record-table-scroll" role="region" aria-label="Реестр членов" tabIndex={0}>
      <table className="record-table members-record-table" aria-label="Члены организации">
        <thead><tr>
          {[['name', 'Член'], ['region', 'Регион'], ['sphere', 'Сфера'], ['gender', 'Пол'], ['createdAt', 'Регистрация'], ['status', 'Статус']].map(([column, label]) =>
            <SortHeading key={column} column={column!} sort={sort} onSort={changeSort}>{label}</SortHeading>)}
        </tr></thead>
        <tbody>{pageMembers.map((member) => <tr key={member.id} className="record-row member-row">
          <td><span className="record-person"><Avatar name={displayName(member)} size={36} color="colorful" aria-hidden="true" /><span><button type="button" className="record-open" onClick={() => onOpen(member)}><strong>{displayName(member)}</strong></button><small>{member.username ? `@${member.username}` : `ID ${member.id}`}</small></span></span></td>
          <td>{member.regionNameRu ?? "Не указан"}</td>
          <td>{member.sphereNameRu ?? "Не указана"}</td>
          <td>{genderLabel[member.gender ?? ""] ?? "Не указан"}</td>
          <td className="record-deadline">{dateText(member.createdAt)}</td>
          <td><Badge appearance="tint" color={member.status === "active" ? "success" : "subtle"}>{member.status === "active" ? "Активен" : member.status}</Badge></td>
        </tr>)}</tbody>
      </table>
      {!members.length ? <div className="record-table-empty"><strong>Члены не найдены</strong><span>Измените условия поиска или фильтры.</span></div> : null}
    </div>
    <RecordTablePager total={sorted.length} paging={paging} label="члены" />
  </div>;
}

export function MembersView({ registry, loading, error, onRefresh }: MembersViewProps) {
  const [query, setQuery] = useState("");
  const [regionId, setRegionId] = useState("all");
  const [sphereId, setSphereId] = useState("all");
  const [gender, setGender] = useState("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [selected, setSelected] = useState<MemberDirectoryItem>();
  const visible = useMemo(() => {
    if (!registry) return [];
    const needle = query.trim().toLocaleLowerCase("ru");
    return registry.members.filter((member) => {
      const searchable = `${displayName(member)} ${member.username ?? ""} ${member.phone ?? ""} ${member.telegramId ?? ""}`.toLocaleLowerCase("ru");
      const registered = member.createdAt.slice(0, 10);
      return (!needle || searchable.includes(needle))
        && (regionId === "all" || member.regionId === Number(regionId))
        && (sphereId === "all" || member.sphereId === Number(sphereId))
        && (gender === "all" || member.gender === gender)
        && (!createdFrom || registered >= createdFrom)
        && (!createdTo || registered <= createdTo);
    });
  }, [createdFrom, createdTo, gender, query, regionId, registry, sphereId]);
  const filtersApplied = Boolean(query || regionId !== "all" || sphereId !== "all" || gender !== "all" || createdFrom || createdTo);
  const clearFilters = () => { setQuery(""); setRegionId("all"); setSphereId("all"); setGender("all"); setCreatedFrom(""); setCreatedTo(""); };

  if (loading && !registry) return <section className="workspace-view members-view members-state"><Spinner label="Загружаем реестр членов…" /></section>;
  if (error && !registry) return <section className="workspace-view members-view members-state"><h1>Работа с членами</h1><p>{error}</p><Button appearance="primary" icon={<ArrowClockwise20Regular />} onClick={onRefresh}>Повторить</Button></section>;
  if (!registry?.configured) return <section className="workspace-view members-view members-state"><h1>Работа с членами</h1><p>Интеграция с реестром ещё не настроена. Администратор должен подключить защищённый read-only API на хостинге.</p></section>;

  return <section className="workspace-view members-view" aria-label="Работа с членами">
    <header className="section-toolbar members-toolbar"><div><h1>Работа с членами</h1><p>{registry.members.length.toLocaleString("ru-RU")} членов в реестре · данные обновляются безопасно с хостинга</p></div><div className="toolbar-actions"><Button icon={<ArrowClockwise20Regular />} disabled={loading} onClick={onRefresh}>{loading ? "Обновляем…" : "Обновить"}</Button></div></header>
    <div className="members-summary" aria-label="Сводка текущей выборки"><div><strong>{visible.length.toLocaleString("ru-RU")}</strong><span>в текущей выборке</span></div><div><strong>{new Set(visible.map((member) => member.regionId).filter(Boolean)).size}</strong><span>регионов</span></div><div><strong>{visible.filter((member) => member.status === "active").length.toLocaleString("ru-RU")}</strong><span>активных</span></div></div>
    <div className="record-list-controls members-controls">
      <Input className="employee-search" contentBefore={<Search20Regular />} aria-label="Поиск членов" placeholder="Имя, логин, телефон или Telegram ID" value={query} onChange={(_, data) => setQuery(data.value)} />
      <label>Регион<Select aria-label="Фильтр по региону" value={regionId} onChange={(event) => setRegionId(event.target.value)}><option value="all">Все регионы</option>{registry.regions.map((item) => <option key={item.id} value={item.id}>{item.nameRu}</option>)}</Select></label>
      <label>Сфера<Select aria-label="Фильтр по сфере" value={sphereId} onChange={(event) => setSphereId(event.target.value)}><option value="all">Все сферы</option>{registry.spheres.map((item) => <option key={item.id} value={item.id}>{item.nameRu}</option>)}</Select></label>
      <label>Пол<Select aria-label="Фильтр по полу" value={gender} onChange={(event) => setGender(event.target.value)}><option value="all">Все</option><option value="male">Мужской</option><option value="female">Женский</option></Select></label>
      <label>С даты<input aria-label="Дата регистрации с" type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} /></label>
      <label>По дату<input aria-label="Дата регистрации по" type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} /></label>
      {filtersApplied ? <Button appearance="subtle" onClick={clearFilters}>Сбросить фильтры</Button> : null}
    </div>
    <div className="members-content"><MembersRecords members={visible} filterKey={`${query}:${regionId}:${sphereId}:${gender}:${createdFrom}:${createdTo}`} onOpen={setSelected} />
      {selected ? <aside className="member-inspector" aria-label={`Карточка: ${displayName(selected)}`}><div><Avatar name={displayName(selected)} size={48} color="colorful" /><span><h2>{displayName(selected)}</h2><p>{selected.username ? `@${selected.username}` : `ID ${selected.id}`}</p></span></div><dl><dt>Регион</dt><dd>{selected.regionNameRu ?? "Не указан"}</dd><dt>Сфера</dt><dd>{selected.sphereNameRu ?? "Не указана"}</dd><dt>Пол</dt><dd>{genderLabel[selected.gender ?? ""] ?? "Не указан"}</dd><dt>Дата регистрации</dt><dd>{dateText(selected.createdAt)}</dd><dt>Телефон</dt><dd>{selected.phone ?? "Не указан"}</dd><dt>Статус</dt><dd>{selected.status === "active" ? "Активен" : selected.status}</dd></dl><Button appearance="subtle" onClick={() => setSelected(undefined)}>Закрыть карточку</Button></aside> : null}
    </div>
  </section>;
}
