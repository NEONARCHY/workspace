import { useEffect, useMemo, useState } from "react";

import type {
  DirectoryBootstrap,
  DirectoryEmployee,
  WorkspacePerson,
  WorkspacePosition,
  WorkspaceRole,
} from "@yuksalish/contracts";
import { Avatar, Button, Checkbox, DialogSurface, Field, Input, Select, Spinner, useRestoreFocusTarget } from "@fluentui/react-components";
import { Add24Regular, PeopleTeam24Regular, Search20Regular } from "@fluentui/react-icons";
import { EmployeeRecords, employeeRoleLabels, employeeStatusLabel } from "./EmployeeRecords";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";

import {
  createPosition,
  loadDirectory,
  updateEmployeeAccess,
  updatePosition,
} from "./workspace-api";

interface EmployeesViewProps {
  readonly token: string;
  readonly currentUser: WorkspacePerson;
  readonly onInvite?: () => void;
}

function replaceEmployee(
  directory: DirectoryBootstrap,
  employee: DirectoryEmployee,
): DirectoryBootstrap {
  return {
    ...directory,
    employees: directory.employees.map((item) => (item.id === employee.id ? employee : item)),
  };
}

function replacePosition(
  directory: DirectoryBootstrap,
  position: WorkspacePosition,
): DirectoryBootstrap {
  return {
    ...directory,
    positions: directory.positions.map((item) => (item.id === position.id ? position : item)),
    employees: directory.employees.map(employee => employee.positionId === position.id ? { ...employee, jobTitle: position.name } : employee),
  };
}

export function EmployeesView({ token, currentUser, onInvite }: EmployeesViewProps) {
  const [directory, setDirectory] = useState<DirectoryBootstrap>();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [employeeRole, setEmployeeRole] = useState<Exclude<WorkspaceRole, "superadmin">>("employee");
  const [employeePositionId, setEmployeePositionId] = useState("");
  const [positionName, setPositionName] = useState("");
  const [positionActive, setPositionActive] = useState(true);
  const [newPositionName, setNewPositionName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [roleFilter, setRoleFilter] = useState<WorkspaceRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "invited" | "inactive">("all");
  const [panel, setPanel] = useState<"employee" | "positions" | null>(null);
  const positionFocusTarget = useRestoreFocusTarget();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const canManage = ["admin", "superadmin"].includes(currentUser.role);

  useEffect(() => {
    let active = true;
    void loadDirectory(token)
      .then((loaded) => {
        if (!active) return;
        setDirectory(loaded);
        const firstEmployee = loaded.employees[0];
        const firstPosition = loaded.positions[0];
        setSelectedEmployeeId(firstEmployee?.id ?? "");
        if (firstEmployee !== undefined && firstEmployee.role !== "superadmin") {
          setEmployeeRole(firstEmployee.role);
          setEmployeePositionId(firstEmployee.positionId ?? "");
        }
        setSelectedPositionId(firstPosition?.id ?? "");
        setPositionName(firstPosition?.name ?? "");
        setPositionActive(firstPosition?.isActive ?? true);
      })
      .catch((error: unknown) => {
        if (active) setFeedback(error instanceof Error ? error.message : "Не удалось загрузить сотрудников");
      });
    return () => {
      active = false;
    };
  }, [token, loadAttempt]);

  const selectedEmployee = useMemo(
    () => directory?.employees.find((employee) => employee.id === selectedEmployeeId),
    [directory, selectedEmployeeId],
  );
  const selectedPosition = useMemo(
    () => directory?.positions.find((position) => position.id === selectedPositionId),
    [directory, selectedPositionId],
  );

  const selectEmployee = (employee: DirectoryEmployee) => {
    setSelectedEmployeeId(employee.id);
    if (employee.role !== "superadmin") setEmployeeRole(employee.role);
    setEmployeePositionId(employee.positionId ?? "");
    setPanel("employee");
  };

  const selectPosition = (position: WorkspacePosition) => {
    setSelectedPositionId(position.id);
    setPositionName(position.name);
    setPositionActive(position.isActive);
  };

  const saveEmployee = async () => {
    if (busy || !canManage || directory === undefined || selectedEmployee === undefined || selectedEmployee.role === "superadmin") return;
    setBusy(true);
    try {
      const saved = await updateEmployeeAccess(
        token,
        selectedEmployee.id,
        employeeRole,
        employeePositionId || undefined,
      );
      setDirectory(replaceEmployee(directory, saved));
      setFeedback("Роль и должность сотрудника сохранены. Изменение записано в аудит.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось сохранить сотрудника");
    } finally {
      setBusy(false);
    }
  };

  const savePosition = async () => {
    if (busy || !canManage || directory === undefined || selectedPosition === undefined || !positionName.trim()) return;
    setBusy(true);
    try {
      const saved = await updatePosition(token, selectedPosition.id, {
        name: positionName,
        isActive: positionActive,
      });
      setDirectory(replacePosition(directory, saved));
      setFeedback("Должность обновлена. Назначенные сотрудники сохранили связь со справочником.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось сохранить должность");
    } finally {
      setBusy(false);
    }
  };

  const addPosition = async () => {
    if (busy || !canManage || directory === undefined || !newPositionName.trim()) return;
    setBusy(true);
    try {
      const created = await createPosition(token, newPositionName.trim(), directory.positions.length * 10);
      setDirectory({ ...directory, positions: [...directory.positions, created] });
      selectPosition(created);
      setNewPositionName("");
      setFeedback("Новая должность добавлена в справочник.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось создать должность");
    } finally {
      setBusy(false);
    }
  };

  if (directory === undefined) {
    return (
      <section className="workspace-view directory-loading" aria-label="Сотрудники">
        {!feedback && <Spinner label="Загружаем сотрудников и должности" />}
        {feedback ? <div className="directory-feedback" role="alert">{feedback}</div> : null}
        {feedback && <Button onClick={() => { setFeedback(""); setLoadAttempt(value => value + 1); }}>Повторить загрузку</Button>}
      </section>
    );
  }

  const search = employeeQuery.trim().toLocaleLowerCase("ru");
  const visibleEmployees = directory.employees.filter((employee) =>
    `${employee.name} ${employee.username} ${employee.jobTitle ?? ""}`.toLocaleLowerCase("ru").includes(search)
      && (roleFilter === "all" || employee.role === roleFilter)
      && (statusFilter === "all" || statusFilter === "active" && employee.status === "active"
        || statusFilter === "invited" && ["pending", "invited"].includes(employee.status)
        || statusFilter === "inactive" && !["active", "pending", "invited"].includes(employee.status)));

  return (
    <section className="workspace-view employees-view" aria-label="Сотрудники">
      <header className="section-toolbar">
        <div>
          <h1>Сотрудники</h1>
          <p>{directory.employees.length} учётных записей · {directory.positions.filter((item) => item.isActive).length} активных должностей</p>
        </div>
        <div className="toolbar-actions"><Button {...positionFocusTarget} icon={<PeopleTeam24Regular />} onClick={() => setPanel("positions")}>Должности</Button>{canManage && onInvite && <Button appearance="primary" icon={<Add24Regular />} onClick={onInvite}>Пригласить сотрудника</Button>}</div>
      </header>

      <div className="record-list-controls">
        <Input className="employee-search" contentBefore={<Search20Regular />} aria-label="Поиск сотрудников" placeholder="Имя, логин или должность" value={employeeQuery} onChange={(_, data) => setEmployeeQuery(data.value)} />
        <label>Роль<select aria-label="Фильтр по роли сотрудника" value={roleFilter} onChange={event => setRoleFilter(event.target.value as typeof roleFilter)}><option value="all">Все роли</option>{Object.entries(employeeRoleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Состояние<select aria-label="Фильтр состояния сотрудников" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Все сотрудники</option><option value="active">Активные</option><option value="invited">Приглашённые</option><option value="inactive">Неактивные</option></select></label>
        {(search || roleFilter !== "all" || statusFilter !== "all") && <Button appearance="subtle" onClick={() => { setEmployeeQuery(""); setRoleFilter("all"); setStatusFilter("all"); }}>Сбросить фильтры</Button>}
      </div>
      <EmployeeRecords employees={visibleEmployees} filterKey={`${employeeQuery}:${roleFilter}:${statusFilter}`} onSelect={selectEmployee} />
      <Dialog open={panel !== null} onOpenChange={(_, data) => { if (!data.open && !busy) setPanel(null); }}>
        <DialogSurface className="directory-record-dialog" aria-label={panel === "employee" ? "Карточка сотрудника" : "Справочник должностей"}>
        <div className="record-dialog-close"><Button disabled={busy} appearance="subtle" onClick={() => setPanel(null)}>К списку сотрудников</Button></div>
        {feedback && <div className="directory-feedback" role="status">{feedback}</div>}
        {panel === "employee" ? <div className="employee-detail">
          {selectedEmployee ? (
            <>
              <div className="directory-heading">
                <Avatar name={selectedEmployee.name} size={56} color="colorful" />
                <div>
                  <span>Карточка сотрудника</span>
                  <h2>{selectedEmployee.name}</h2>
                  <p>@{selectedEmployee.username} · {employeeStatusLabel(selectedEmployee.status)}</p>
                </div>
              </div>
              <div className="directory-form-grid">
                <Field label="Роль доступа" hint="Влияет на разрешённые действия в системе.">
                  <Select
                    disabled={busy || !canManage || selectedEmployee.role === "superadmin" || selectedEmployee.id === currentUser.id}
                    value={selectedEmployee.role === "superadmin" ? "superadmin" : employeeRole}
                    onChange={(event) => setEmployeeRole(event.target.value as typeof employeeRole)}
                  >
                    {selectedEmployee.role === "superadmin" && <option value="superadmin">Суперадминистратор</option>}
                    {directory.roles.map((role) => (
                      <option key={role.key} value={role.key}>{role.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Должность" hint="Выбирается из редактируемого справочника.">
                  <Select
                    disabled={busy || !canManage || selectedEmployee.role === "superadmin"}
                    value={employeePositionId}
                    onChange={(event) => setEmployeePositionId(event.target.value)}
                  >
                    <option value="">Не назначена</option>
                    {directory.positions
                      .filter((position) => position.isActive || position.id === employeePositionId)
                      .map((position) => (
                        <option key={position.id} value={position.id}>{position.name}</option>
                      ))}
                  </Select>
                </Field>
              </div>
              {canManage ? (
                <Button
                  appearance="primary"
                  disabled={busy || selectedEmployee.role === "superadmin"}
                  onClick={() => void saveEmployee()}
                >
                  Сохранить сотрудника
                </Button>
              ) : null}
            </>
          ) : null}
        </div> : <aside className="position-catalog" aria-label="Справочник должностей">
          <div className="position-title">
            <PeopleTeam24Regular />
            <div>
              <h2>Должности</h2>
              <p>Справочник для новых и действующих пользователей</p>
            </div>
          </div>
          {canManage ? (
            <div className="position-create">
              <Input
                aria-label="Название новой должности"
                placeholder="Yangi lavozim"
                value={newPositionName}
                disabled={busy}
                onChange={(_, data) => setNewPositionName(data.value)}
              />
              <Button
                appearance="primary"
                icon={<Add24Regular />}
                disabled={busy || !newPositionName.trim()}
                onClick={() => void addPosition()}
              >
                Добавить
              </Button>
            </div>
          ) : null}
          <div className="position-list">
            {directory.positions.map((position) => (
              <button
                key={position.id}
                type="button"
                className={position.id === selectedPositionId ? "selected" : ""}
                disabled={busy}
                onClick={() => selectPosition(position)}
              >
                <span>{position.name}</span>
                <small>{position.assignedUsersCount} назначено{position.isActive ? "" : " · отключена"}</small>
              </button>
            ))}
          </div>
          {canManage && selectedPosition ? (
            <div className="position-editor">
              <Field label="Название должности">
                <Input disabled={busy} value={positionName} onChange={(_, data) => setPositionName(data.value)} />
              </Field>
              <Checkbox
                checked={positionActive}
                disabled={busy}
                label="Доступна для новых назначений"
                onChange={(_, data) => setPositionActive(data.checked === true)}
              />
              <Button disabled={busy || !positionName.trim()} onClick={() => void savePosition()}>
                Сохранить должность
              </Button>
            </div>
          ) : null}
        </aside>}
        </DialogSurface>
      </Dialog>
      {feedback && !panel ? <div className="directory-feedback" role="status">{feedback}</div> : null}
    </section>
  );
}
