import { useEffect, useMemo, useState } from "react";

import type {
  ChatSummary,
  CreateChatInput,
  DirectoryBootstrap,
  DirectoryEmployee,
  WorkspacePerson,
  WorkspacePosition,
  WorkspaceRole,
} from "@yuksalish/contracts";
import { Avatar, Button, Checkbox, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Select, Spinner, useRestoreFocusTarget } from "@fluentui/react-components";
import { Add24Regular, Chat24Regular, Dismiss20Regular, MoreHorizontal20Regular, PeopleTeam24Regular, PersonEdit24Regular, Search20Regular } from "@fluentui/react-icons";
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
  readonly onCreateChat?: (input: CreateChatInput) => Promise<ChatSummary>;
  readonly onChatCreated?: (chatId: string) => void;
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

export function EmployeesView({ token, currentUser, onInvite, onCreateChat, onChatCreated }: EmployeesViewProps) {
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
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkPanel, setBulkPanel] = useState<"position" | "role" | "chat" | null>(null);
  const [bulkPositionId, setBulkPositionId] = useState("__choose__");
  const [bulkRole, setBulkRole] = useState<Exclude<WorkspaceRole, "superadmin"> | "">("");
  const [chatTitle, setChatTitle] = useState("");
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

  const selectedEmployees = useMemo(
    () => directory?.employees.filter((employee) => selectedEmployeeIds.has(employee.id)) ?? [],
    [directory, selectedEmployeeIds],
  );
  const selectedColleagues = selectedEmployees.filter((employee) => employee.id !== currentUser.id && employee.status === "active");
  const editableSelectedEmployees = selectedEmployees.filter((employee) => employee.role !== "superadmin");
  const roleEditableSelectedEmployees = editableSelectedEmployees.filter((employee) => employee.id !== currentUser.id);

  const selectEmployee = (employee: DirectoryEmployee) => {
    setSelectedEmployeeId(employee.id);
    if (employee.role !== "superadmin") setEmployeeRole(employee.role);
    setEmployeePositionId(employee.positionId ?? "");
    setPanel("employee");
  };

  const toggleEmployee = (employeeId: string, selected: boolean) => {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (selected) next.add(employeeId); else next.delete(employeeId);
      return next;
    });
  };

  const toggleEmployees = (employeeIds: readonly string[], selected: boolean) => {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      employeeIds.forEach((employeeId) => selected ? next.add(employeeId) : next.delete(employeeId));
      return next;
    });
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

  const saveBulkAccess = async (kind: "position" | "role") => {
    const targets = kind === "role" ? roleEditableSelectedEmployees : editableSelectedEmployees;
    if (busy || !canManage || directory === undefined || !targets.length
      || kind === "position" && bulkPositionId === "__choose__" || kind === "role" && !bulkRole) return;
    setBusy(true);
    const results = await Promise.allSettled(targets.map((employee) => updateEmployeeAccess(
      token,
      employee.id,
      kind === "role" ? bulkRole as Exclude<WorkspaceRole, "superadmin"> : employee.role as Exclude<WorkspaceRole, "superadmin">,
      kind === "position" ? bulkPositionId || undefined : employee.positionId ?? undefined,
    )));
    const saved = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failedIds = new Set(targets.filter((_, index) => results[index]?.status === "rejected").map((employee) => employee.id));
    setDirectory((current) => saved.reduce((next, employee) => replaceEmployee(next, employee), current ?? directory));
    setSelectedEmployeeIds((current) => new Set([...current].filter((id) => failedIds.has(id))));
    setBulkPanel(null);
    setFeedback(failedIds.size
      ? `Обновлено: ${saved.length}. Не удалось обновить: ${failedIds.size}. Повторите операцию для оставшихся сотрудников.`
      : `${kind === "position" ? "Должность" : "Роль"} обновлена для ${saved.length} сотрудников.`);
    setBusy(false);
  };

  const createSelectedChat = async () => {
    if (busy || onCreateChat === undefined || !selectedColleagues.length) return;
    if (selectedColleagues.length > 1 && !chatTitle.trim()) {
      setChatTitle(`Рабочая группа · ${selectedColleagues.slice(0, 2).map((employee) => employee.name.split(" ")[0]).join(", ")}`);
      setBulkPanel("chat");
      return;
    }
    setBusy(true);
    try {
      const input: CreateChatInput = selectedColleagues.length === 1
        ? { kind: "direct", title: "", description: "", memberIds: [selectedColleagues[0]!.id] }
        : { kind: "group", title: chatTitle.trim(), description: "Группа создана из списка сотрудников.", memberIds: selectedColleagues.map((employee) => employee.id) };
      const chat = await onCreateChat(input);
      setSelectedEmployeeIds(new Set());
      setBulkPanel(null);
      setChatTitle("");
      onChatCreated?.(chat.id);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось создать чат");
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
  const selectedVisibleCount = visibleEmployees.filter((employee) => selectedEmployeeIds.has(employee.id)).length;
  const visibleSelection = selectedVisibleCount === 0 ? false : selectedVisibleCount === visibleEmployees.length ? true : "mixed";

  return (
    <section className={`workspace-view employees-view${selectedEmployeeIds.size ? " has-selection" : ""}`} aria-label="Сотрудники">
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
      <EmployeeRecords
        employees={visibleEmployees}
        filterKey={`${employeeQuery}:${roleFilter}:${statusFilter}`}
        selectedIds={selectedEmployeeIds}
        onOpen={selectEmployee}
        onToggle={toggleEmployee}
        onTogglePage={toggleEmployees}
      />
      {selectedEmployeeIds.size ? (
        <aside className="employee-selection-bar" aria-label="Действия с выбранными сотрудниками">
          <div className="employee-selection-summary" role="status" aria-live="polite">
            <span>{selectedEmployeeIds.size}</span>
            <div><strong>Выбрано сотрудников</strong><small>Действия применятся только к отмеченным строкам</small></div>
          </div>
          <div className="employee-selection-actions">
            {canManage ? (
              <Button
                icon={<PersonEdit24Regular />}
                disabled={!editableSelectedEmployees.length || busy}
                onClick={() => { setBulkPositionId("__choose__"); setBulkPanel("position"); }}
              >
                Изменить должность
              </Button>
            ) : null}
            <Button
              appearance="primary"
              icon={<Chat24Regular />}
              disabled={!selectedColleagues.length || busy || onCreateChat === undefined}
              title={!selectedColleagues.length ? "Выберите хотя бы одного активного коллегу" : undefined}
              onClick={() => void createSelectedChat()}
            >
              {selectedColleagues.length === 1 ? "Открыть чат" : "Создать чат"}
            </Button>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button icon={<MoreHorizontal20Regular />}>Действия</Button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {canManage ? <MenuItem disabled={!roleEditableSelectedEmployees.length} onClick={() => { setBulkRole(""); setBulkPanel("role"); }}>Изменить роль доступа</MenuItem> : null}
                  <MenuItem disabled={selectedEmployees.length !== 1} onClick={() => selectedEmployees[0] && selectEmployee(selectedEmployees[0])}>Открыть карточку сотрудника</MenuItem>
                  <MenuItem icon={<Dismiss20Regular />} onClick={() => setSelectedEmployeeIds(new Set())}>Снять выделение</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
          <div className="employee-selection-scope">
            <Checkbox
              checked={visibleSelection}
              disabled={!visibleEmployees.length}
              label={`Выбрать всех (${visibleEmployees.length})`}
              onChange={(_, data) => toggleEmployees(visibleEmployees.map((employee) => employee.id), data.checked === true)}
            />
            <small>Показано: {selectedVisibleCount} из {visibleEmployees.length}</small>
          </div>
        </aside>
      ) : null}
      <Dialog open={panel !== null} onOpenChange={(_, data) => { if (!data.open && !busy && data.type === "escapeKeyDown") setPanel(null); }}>
        <DialogSurface className="directory-record-dialog" aria-label={panel === "employee" ? "Карточка сотрудника" : "Справочник должностей"}>
        <div className="record-dialog-close">
          <Button
            className="record-dialog-close-button"
            disabled={busy}
            appearance="subtle"
            icon={<Dismiss20Regular />}
            aria-label={panel === "employee" ? "Закрыть карточку сотрудника" : "Закрыть справочник должностей"}
            title="Закрыть"
            onClick={() => setPanel(null)}
          />
        </div>
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
      {bulkPanel ? <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy && data.type === "escapeKeyDown") setBulkPanel(null); }}>
        <DialogSurface className="employee-bulk-dialog" aria-label="Действие с выбранными сотрудниками">
          <DialogBody>
            <DialogTitle>
              {bulkPanel === "position" ? "Изменить должность" : bulkPanel === "role" ? "Изменить роль доступа" : "Создать группу"}
            </DialogTitle>
            <DialogContent>
              <p className="employee-bulk-lead">
                {bulkPanel === "chat"
                  ? `В группу войдут ${selectedColleagues.length} коллег и вы станете её владельцем.`
                  : `Изменение будет применено к ${bulkPanel === "role" ? roleEditableSelectedEmployees.length : editableSelectedEmployees.length} сотрудникам.`}
              </p>
              {bulkPanel === "position" ? (
                <Field label="Новая должность">
                  <Select aria-label="Новая должность для выбранных сотрудников" value={bulkPositionId} disabled={busy} onChange={(event) => setBulkPositionId(event.target.value)}>
                    <option value="__choose__" disabled>Выберите должность</option>
                    <option value="">Не назначена</option>
                    {directory.positions.filter((position) => position.isActive).map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
                  </Select>
                </Field>
              ) : null}
              {bulkPanel === "role" ? (
                <Field label="Новая роль">
                  <Select aria-label="Новая роль для выбранных сотрудников" value={bulkRole} disabled={busy} onChange={(event) => setBulkRole(event.target.value as typeof bulkRole)}>
                    <option value="" disabled>Выберите роль</option>
                    {directory.roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                  </Select>
                </Field>
              ) : null}
              {bulkPanel === "chat" ? (
                <Field label="Название группы" required>
                  <Input aria-label="Название новой группы" maxLength={240} value={chatTitle} disabled={busy} onChange={(_, data) => setChatTitle(data.value)} />
                </Field>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                disabled={busy || bulkPanel === "chat" && !chatTitle.trim() || bulkPanel === "position" && bulkPositionId === "__choose__" || bulkPanel === "role" && !bulkRole}
                onClick={() => bulkPanel === "chat" ? void createSelectedChat() : bulkPanel && void saveBulkAccess(bulkPanel)}
              >
                {busy ? "Сохраняем…" : bulkPanel === "chat" ? "Создать и открыть" : "Применить"}
              </Button>
              <Button disabled={busy} onClick={() => setBulkPanel(null)}>Отмена</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog> : null}
      {feedback && !panel ? <div className="directory-feedback" role="status">{feedback}</div> : null}
    </section>
  );
}
