import { useEffect, useMemo, useState } from "react";

import type {
  ChatSummary,
  CreateChatInput,
  DirectoryBootstrap,
  DirectoryEmployee,
  ModuleAccessRule,
  ModuleAccessSubject,
  ManagedEmployeeStatus,
  WorkspacePerson,
  WorkspaceDepartment,
  WorkspacePosition,
  WorkspaceRole,
  RecognitionSettings,
} from "@yuksalish/contracts";
import { Avatar, Button, Checkbox, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Spinner, Switch, Textarea, useRestoreFocusTarget } from "@fluentui/react-components";
import { Add24Regular, Chat24Regular, Delete24Regular, Dismiss20Regular, MoreHorizontal20Regular, PeopleTeam24Regular, PersonEdit24Regular, Search20Regular } from "@fluentui/react-icons";
import { EmployeeRecords, employeeRoleLabels, employeeStatusLabel } from "./EmployeeRecords";
import { DepartmentManagement } from "./DepartmentManagement";
import { ModuleAccessManagement } from "./ModuleAccessManagement";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { AdministrativeChatInspectionView } from "./AdministrativeChatInspection";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { EmployeeProfileLink } from "./EmployeeProfileLink";

import {
  createPosition,
  deletePosition,
  loadDirectory,
  loadRecognitionSettings,
  updateRecognitionSettings,
  updateEmployeeAccess,
  updateEmployeeStatus,
  updatePosition,
} from "./workspace-api";

interface EmployeesViewProps {
  readonly token: string;
  readonly currentUser: WorkspacePerson;
  readonly allowAdministration?: boolean;
  readonly allowChatAdministration?: boolean;
  readonly onInvite?: () => void;
  readonly onCreateChat?: (input: CreateChatInput) => Promise<ChatSummary>;
  readonly onChatCreated?: (chatId: string) => void;
}

function replaceEmployee(
  directory: DirectoryBootstrap,
  employee: DirectoryEmployee,
): DirectoryBootstrap {
  const previous = directory.employees.find((item) => item.id === employee.id);
  return {
    ...directory,
    employees: directory.employees.map((item) => (item.id === employee.id ? employee : item)),
    departments: directory.departments.map((department) => ({
      ...department,
      assignedUsersCount: department.assignedUsersCount
        - (previous?.departmentId === department.id ? 1 : 0)
        + (employee.departmentId === department.id ? 1 : 0),
    })),
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

function replaceDepartment(
  directory: DirectoryBootstrap,
  department: WorkspaceDepartment,
): DirectoryBootstrap {
  const exists = directory.departments.some((item) => item.id === department.id);
  return {
    ...directory,
    departments: exists
      ? directory.departments.map((item) => item.id === department.id ? department : item)
      : [...directory.departments, department],
  };
}

export function EmployeesView({ token, currentUser, allowAdministration, allowChatAdministration, onInvite, onCreateChat, onChatCreated }: EmployeesViewProps) {
  const [directory, setDirectory] = useState<DirectoryBootstrap>();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [employeeRole, setEmployeeRole] = useState<Exclude<WorkspaceRole, "superadmin">>("employee");
  const [employeePositionId, setEmployeePositionId] = useState("");
  const [employeeDepartmentId, setEmployeeDepartmentId] = useState("");
  const [directManagerUserId, setDirectManagerUserId] = useState("");
  const [positionName, setPositionName] = useState("");
  const [positionActive, setPositionActive] = useState(true);
  const [newPositionName, setNewPositionName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPositionDelete, setPendingPositionDelete] = useState<WorkspacePosition>();
  const [roleFilter, setRoleFilter] = useState<WorkspaceRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "invited" | "inactive">("all");
  const [panel, setPanel] = useState<"employee" | "positions" | null>(null);
  const [departmentsOpen, setDepartmentsOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [chatControlOpen, setChatControlOpen] = useState(false);
  const [employeeStatusAction, setEmployeeStatusAction] = useState<ManagedEmployeeStatus>();
  const [employeeStatusReason, setEmployeeStatusReason] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkPanel, setBulkPanel] = useState<"position" | "role" | "chat" | null>(null);
  const [bulkPositionId, setBulkPositionId] = useState("__choose__");
  const [bulkRole, setBulkRole] = useState<Exclude<WorkspaceRole, "superadmin"> | "">("");
  const [chatTitle, setChatTitle] = useState("");
  const positionFocusTarget = useRestoreFocusTarget();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [recognitionSettings, setRecognitionSettings] = useState<RecognitionSettings>();
  const [recognitionSettingsBusy, setRecognitionSettingsBusy] = useState(false);
  const canManage = allowAdministration ?? ["admin", "superadmin"].includes(currentUser.role);
  const canManageDepartments = canManage
    || currentUser.role === "manager"
    || (currentUser.jobTitle ?? "").toLocaleLowerCase("uz").includes("kadr")
    || (currentUser.jobTitle ?? "").includes("Yuksalish");

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void loadRecognitionSettings(token)
      .then((loaded) => { if (active) setRecognitionSettings(loaded); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [canManage, token]);

  useEffect(() => {
    let active = true;
    void loadDirectory(token)
      .then((loaded) => {
        if (!active) return;
        const normalized: DirectoryBootstrap = {
          ...loaded,
          departments: loaded.departments ?? [],
          modules: loaded.modules ?? [],
          accessRules: loaded.accessRules ?? [],
        };
        setDirectory(normalized);
        const firstEmployee = normalized.employees[0];
        const firstPosition = normalized.positions[0];
        setSelectedEmployeeId(firstEmployee?.id ?? "");
        if (firstEmployee !== undefined && firstEmployee.role !== "superadmin") {
          setEmployeeRole(firstEmployee.role);
          setEmployeePositionId(firstEmployee.positionId ?? "");
          setEmployeeDepartmentId(firstEmployee.departmentId ?? "");
          setDirectManagerUserId(firstEmployee.directManagerUserId ?? "");
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
    setEmployeeDepartmentId(employee.departmentId ?? "");
    setDirectManagerUserId(employee.directManagerUserId ?? "");
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
        employeeDepartmentId || undefined,
        directManagerUserId || undefined,
      );
      setDirectory(replaceEmployee(directory, saved));
      setFeedback("Роль, подразделение и должность сотрудника сохранены. Изменение записано в аудит.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось сохранить сотрудника");
    } finally {
      setBusy(false);
    }
  };

  const saveEmployeeStatus = async () => {
    if (busy || !canManage || directory === undefined || selectedEmployee === undefined || employeeStatusAction === undefined || employeeStatusReason.trim().length < 12) return;
    setBusy(true);
    try {
      const saved = await updateEmployeeStatus(
        token,
        selectedEmployee.id,
        employeeStatusAction,
        employeeStatusReason.trim(),
      );
      setDirectory(replaceEmployee(directory, saved));
      setEmployeeStatusAction(undefined);
      setEmployeeStatusReason("");
      setFeedback(
        saved.status === "active"
          ? `${saved.name}: доступ восстановлен.`
          : `${saved.name}: статус «${employeeStatusLabel(saved.status)}» сохранён, активные сеансы отозваны.`,
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось изменить состояние сотрудника");
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

  const removePosition = async () => {
    if (busy || !canManage || directory === undefined || selectedPosition === undefined) return;
    setPendingPositionDelete(selectedPosition);
  };

  const confirmPositionDelete = async () => {
    if (busy || !canManage || directory === undefined || pendingPositionDelete === undefined) return;
    setBusy(true);
    try {
      await deletePosition(token, pendingPositionDelete.id);
      const remaining = directory.positions.filter((position) => position.id !== pendingPositionDelete.id);
      setDirectory({
        ...directory,
        positions: remaining,
        employees: directory.employees.map((employee) => employee.positionId === pendingPositionDelete.id
          ? { ...employee, positionId: null, jobTitle: null }
          : employee),
      });
      const next = remaining[0];
      setSelectedPositionId(next?.id ?? "");
      setPositionName(next?.name ?? "");
      setPositionActive(next?.isActive ?? true);
      setEmployeePositionId((current) => current === pendingPositionDelete.id ? "" : current);
      setFeedback(`Должность «${pendingPositionDelete.name}» удалена. Связь с сотрудниками снята.`);
      setPendingPositionDelete(undefined);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось удалить должность");
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
      employee.departmentId ?? undefined,
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
    `${employee.name} ${employee.username} ${employee.jobTitle ?? ""} ${directory.departments.find((department) => department.id === employee.departmentId)?.name ?? ""}`.toLocaleLowerCase("ru").includes(search)
      && (roleFilter === "all" || employee.role === roleFilter)
      && (statusFilter === "all" || statusFilter === "active" && employee.status === "active"
        || statusFilter === "invited" && ["pending", "invited"].includes(employee.status)
        || statusFilter === "inactive" && !["active", "pending", "invited"].includes(employee.status)));
  const selectedVisibleCount = visibleEmployees.filter((employee) => selectedEmployeeIds.has(employee.id)).length;
  const visibleSelection = selectedVisibleCount === 0 ? false : selectedVisibleCount === visibleEmployees.length ? true : "mixed";

  const mergeAccessRule = (rule: ModuleAccessRule) => {
    setDirectory((current) => current === undefined ? current : {
      ...current,
      accessRules: [
        ...current.accessRules.filter((item) => !(item.subjectType === rule.subjectType && item.subjectKey === rule.subjectKey && item.moduleKey === rule.moduleKey)),
        rule,
      ],
    });
  };

  const removeAccessRule = (subjectType: ModuleAccessSubject, subjectKey: string, moduleKey: string) => {
    setDirectory((current) => current === undefined ? current : {
      ...current,
      accessRules: current.accessRules.filter((item) => !(item.subjectType === subjectType && item.subjectKey === subjectKey && item.moduleKey === moduleKey)),
    });
  };

  return (
    <section className={`workspace-view employees-view${selectedEmployeeIds.size ? " has-selection" : ""}`} aria-label="Сотрудники">
      <header className="section-toolbar">
        <div>
          <h1>Сотрудники</h1>
          <p>{directory.employees.length} учётных записей · {directory.positions.filter((item) => item.isActive).length} активных должностей</p>
        </div>
        <div className="toolbar-actions">
          {canManage && recognitionSettings ? <Switch
            checked={recognitionSettings.activeTaskCountVisible}
            disabled={recognitionSettingsBusy}
            label="Активные задачи в профилях"
            title="Управляет видимостью количества активных задач для всех сотрудников"
            onChange={(_, data) => {
              setRecognitionSettingsBusy(true);
              setFeedback("");
              void updateRecognitionSettings(token, data.checked)
                .then(setRecognitionSettings)
                .catch((cause: unknown) => setFeedback(cause instanceof Error ? cause.message : "Не удалось изменить видимость"))
                .finally(() => setRecognitionSettingsBusy(false));
            }}
          /> : null}
          {canManageDepartments ? <Button onClick={() => setDepartmentsOpen(true)}>Отделы и подразделения</Button> : null}
          {canManage ? <Button onClick={() => setAccessOpen(true)}>Права модулей</Button> : null}
          {allowChatAdministration ? <Button onClick={() => setChatControlOpen(true)}>Контроль чатов</Button> : null}
          <Button {...positionFocusTarget} icon={<PeopleTeam24Regular />} onClick={() => setPanel("positions")}>Должности</Button>
          {canManage && onInvite && <Button appearance="primary" icon={<Add24Regular />} onClick={onInvite}>Пригласить сотрудника</Button>}
        </div>
      </header>

      <div className="record-list-controls">
        <Input className="employee-search" contentBefore={<Search20Regular />} aria-label="Поиск сотрудников" placeholder="Имя, логин, должность или подразделение" value={employeeQuery} onChange={(_, data) => setEmployeeQuery(data.value)} />
        <label>Роль<Select aria-label="Фильтр по роли сотрудника" value={roleFilter} onChange={event => setRoleFilter(event.target.value as typeof roleFilter)}><option value="all">Все роли</option>{Object.entries(employeeRoleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
        <label>Состояние<Select aria-label="Фильтр состояния сотрудников" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Все сотрудники</option><option value="active">Активные</option><option value="invited">Приглашённые</option><option value="inactive">Неактивные</option></Select></label>
        {(search || roleFilter !== "all" || statusFilter !== "all") && <Button appearance="subtle" onClick={() => { setEmployeeQuery(""); setRoleFilter("all"); setStatusFilter("all"); }}>Сбросить фильтры</Button>}
      </div>
      <EmployeeRecords
        employees={visibleEmployees}
        departments={directory.departments}
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
                  {canManage ? <MenuItem
                    icon={<Delete24Regular />}
                    disabled={selectedEmployees.length !== 1 || selectedEmployees[0]?.status !== "active" || selectedEmployees[0]?.id === currentUser.id || selectedEmployees[0]?.role === "superadmin"}
                    onClick={() => {
                      const employee = selectedEmployees[0];
                      if (!employee) return;
                      selectEmployee(employee);
                      setEmployeeStatusAction("archived");
                    }}
                  >Уволить сотрудника</MenuItem> : null}
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
                <EmployeeProfileLink userId={selectedEmployee.id} personName={selectedEmployee.name}><Avatar name={selectedEmployee.name} size={56} color="colorful" /></EmployeeProfileLink>
                <EmployeeProfileLink userId={selectedEmployee.id} personName={selectedEmployee.name}>
                <div>
                  <span>Карточка сотрудника</span>
                  <h2>{selectedEmployee.name}</h2>
                  <p>@{selectedEmployee.username} · {employeeStatusLabel(selectedEmployee.status)}</p>
                </div>
                </EmployeeProfileLink>
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
                <Field label="Подразделение" hint="Определяет структуру команды и наследуемые права.">
                  <Select
                    aria-label="Подразделение"
                    disabled={busy || !canManage || selectedEmployee.role === "superadmin"}
                    value={employeeDepartmentId}
                    onChange={(event) => setEmployeeDepartmentId(event.target.value)}
                  >
                    <option value="">Не назначено</option>
                    {directory.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                  </Select>
                </Field>
                <Field label="Непосредственный руководитель" hint="Получает заявки на отпуск, отгул, опоздание и больничный.">
                  <Select disabled={busy || !canManage || selectedEmployee.role === "superadmin"} value={directManagerUserId} onChange={(event) => setDirectManagerUserId(event.target.value)}>
                    <option value="">Не назначен</option>
                    {directory.employees.filter((employee) => employee.id !== selectedEmployee.id && employee.status === "active").map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                  </Select>
                </Field>
              </div>
              {canManage ? (
                <div className="employee-admin-actions">
                  <Button
                    appearance="primary"
                    disabled={busy || selectedEmployee.role === "superadmin"}
                    onClick={() => void saveEmployee()}
                  >
                    Сохранить сотрудника
                  </Button>
                  {selectedEmployee.id !== currentUser.id
                    && (selectedEmployee.role !== "superadmin" || currentUser.role === "superadmin")
                    && (selectedEmployee.role !== "admin" || currentUser.role === "superadmin") ? <div className="employee-status-actions" aria-label="Управление состоянием сотрудника">
                      {selectedEmployee.status === "blocked" || selectedEmployee.status === "archived" ? <Button disabled={busy} onClick={() => { setEmployeeStatusAction("active"); setEmployeeStatusReason(""); setFeedback(""); }}>Восстановить доступ</Button> : null}
                      {selectedEmployee.status === "active" ? <Button disabled={busy} onClick={() => { setEmployeeStatusAction("blocked"); setEmployeeStatusReason(""); setFeedback(""); }}>Заблокировать</Button> : null}
                      {selectedEmployee.status !== "archived" ? <Button className="employee-archive-button" disabled={busy} onClick={() => { setEmployeeStatusAction("archived"); setEmployeeStatusReason(""); setFeedback(""); }}>Архивировать</Button> : null}
                    </div> : null}
                </div>
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
              <div className="position-editor-actions">
                <Button disabled={busy || !positionName.trim()} onClick={() => void savePosition()}>
                  Сохранить должность
                </Button>
                <Button
                  appearance="subtle"
                  icon={<Delete24Regular />}
                  className="position-delete-button"
                  disabled={busy}
                  onClick={() => void removePosition()}
                >
                  Удалить должность
                </Button>
              </div>
            </div>
          ) : null}
        </aside>}
        </DialogSurface>
      </Dialog>
      {departmentsOpen ? <Dialog open onOpenChange={(_, data) => { if (!data.open && data.type === "escapeKeyDown") setDepartmentsOpen(false); }}>
        <DialogSurface className="directory-management-dialog" aria-label="Подразделения">
          <div className="record-dialog-close"><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть подразделения" onClick={() => setDepartmentsOpen(false)} /></div>
          <DepartmentManagement token={token} departments={directory.departments} employees={directory.employees} onChanged={(department) => setDirectory((current) => current ? {
            ...replaceDepartment(current, department),
            employees: current.employees.map((employee) => ({
              ...employee,
              departmentId: department.memberIds?.includes(employee.id)
                ? department.id
                : employee.departmentId === department.id ? null : employee.departmentId,
            })),
          } : current)} />
        </DialogSurface>
      </Dialog> : null}
      {accessOpen ? <Dialog open onOpenChange={(_, data) => { if (!data.open && data.type === "escapeKeyDown") setAccessOpen(false); }}>
        <DialogSurface className="directory-management-dialog access-dialog" aria-label="Права модулей">
          <div className="record-dialog-close"><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть права модулей" onClick={() => setAccessOpen(false)} /></div>
          <ModuleAccessManagement token={token} directory={directory} onRuleChanged={mergeAccessRule} onRuleDeleted={removeAccessRule} />
        </DialogSurface>
      </Dialog> : null}
      {chatControlOpen ? <Dialog open onOpenChange={(_, data) => { if (!data.open && data.type === "escapeKeyDown") setChatControlOpen(false); }}>
        <DialogSurface className="admin-chat-dialog" aria-label="Контроль чатов">
          <AdministrativeChatInspectionView token={token} onClose={() => setChatControlOpen(false)} />
        </DialogSurface>
      </Dialog> : null}
      {employeeStatusAction && selectedEmployee ? <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy && data.type === "escapeKeyDown") setEmployeeStatusAction(undefined); }}>
        <DialogSurface className="employee-status-dialog" aria-label="Изменение состояния сотрудника">
          <DialogBody>
            <DialogTitle>{employeeStatusAction === "active" ? "Восстановить доступ" : employeeStatusAction === "blocked" ? "Заблокировать сотрудника" : "Уволить сотрудника"}</DialogTitle>
            <DialogContent>
              <p className="employee-status-lead">
                {employeeStatusAction === "active"
                  ? `${selectedEmployee.name} снова сможет войти в Workspace. Исторические задачи и переписка останутся без изменений.`
                  : employeeStatusAction === "blocked"
                    ? `Доступ ${selectedEmployee.name} будет остановлен немедленно, а все активные сеансы — отозваны. Учётная запись останется в списке.`
                    : `${selectedEmployee.name} будет перемещён в архив и потеряет доступ. Задачи, согласования и история сохранятся.`}
              </p>
              <Field label="Основание" required hint="Минимум 12 символов. Причина будет записана в аудит.">
                <Textarea aria-label="Основание изменения состояния сотрудника" resize="vertical" maxLength={500} value={employeeStatusReason} disabled={busy} onChange={(_, data) => setEmployeeStatusReason(data.value)} />
              </Field>
              {feedback ? <div className="admin-chat-error" role="alert">{feedback}</div> : null}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={busy || employeeStatusReason.trim().length < 12} onClick={() => void saveEmployeeStatus()}>{busy ? "Сохраняем…" : "Подтвердить"}</Button>
              <Button disabled={busy} onClick={() => setEmployeeStatusAction(undefined)}>Отмена</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog> : null}
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
      <ConfirmActionDialog
        open={pendingPositionDelete !== undefined}
        title="Удалить должность?"
        message={`Должность «${pendingPositionDelete?.name ?? ""}» будет удалена.${pendingPositionDelete?.assignedUsersCount ? ` Она будет снята у ${pendingPositionDelete.assignedUsersCount} ${pendingPositionDelete.assignedUsersCount === 1 ? "сотрудника" : "сотрудников"}.` : ""}`}
        busy={busy}
        onCancel={() => setPendingPositionDelete(undefined)}
        onConfirm={confirmPositionDelete}
      />
    </section>
  );
}
