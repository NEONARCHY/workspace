import { memo } from "react";
import type { HrProfile } from "@yuksalish/contracts";
import { Badge, Button } from "@fluentui/react-components";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { SkeletonTableRows } from "./LoadingSkeleton";
import { RecordMobileLabel, RecordTablePager, useTablePage } from "./RecordTableTools";

export const HrStaffTable = memo(function HrStaffTable({ profiles, filterKey, loading, loaded, canEdit, onTerminate }: {
  profiles: readonly HrProfile[]; filterKey: string; loading: boolean; loaded: boolean; canEdit: boolean;
  onTerminate: (profile: HrProfile) => void;
}) {
  const paging = useTablePage(profiles.length, filterKey);
  return <div className="record-table-frame hr-records">
    <div className="hr-table-wrap" role="region" aria-label="Кадровые карточки" tabIndex={0} aria-busy={loading}>
      <table className="record-table hr-table hr-record-table"><thead><tr><th>Сотрудник</th><th>Должность</th><th>Дата приёма</th><th>Стаж</th><th>Надбавка</th><th>Статус</th><th /></tr></thead>
        {loading ? <SkeletonTableRows columns={7} rows={7} label="Загружаем HR…" /> : <tbody>{profiles.slice(paging.start, paging.start + paging.size).map(item =>
          <tr key={item.id} className="record-row hr-row"><td className="record-title"><EmployeeProfileLink userId={item.userId ?? undefined} personName={item.fullName}><strong>{item.fullName}</strong></EmployeeProfileLink></td>
            <td><RecordMobileLabel>Должность</RecordMobileLabel>{item.jobTitle ?? "—"}</td><td><RecordMobileLabel>Дата приёма</RecordMobileLabel>{item.employmentDate}</td><td><RecordMobileLabel>Стаж</RecordMobileLabel>{item.serviceYears} г. {item.serviceMonths} мес. {item.serviceDays} дн.</td>
            <td><RecordMobileLabel>Надбавка</RecordMobileLabel><Badge color={item.allowancePercent ? "success" : "subtle"}>{item.allowancePercent}%</Badge></td>
            <td><RecordMobileLabel>Статус</RecordMobileLabel>{item.employmentStatus === "active" ? "Активен" : `Уволен ${item.terminatedOn}`}</td>
            <td>{canEdit && item.employmentStatus === "active" ? <Button appearance="subtle" onClick={() => onTerminate(item)}>Уволить</Button> : null}</td>
          </tr>
        )}</tbody>}
      </table>
      {loaded && !profiles.length ? <p className="hr-empty">Пока нет кадровых карточек. HR добавляет сотрудника и подтверждённый стаж на контрольную дату.</p> : null}
    </div>
    {loaded ? <RecordTablePager total={profiles.length} paging={paging} label="кадровые карточки" /> : null}
  </div>;
});
