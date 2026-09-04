import { useEffect, useMemo, useState } from "react";

import type {
  DirectoryBootstrap,
  DirectoryEmployee,
  WorkspacePerson,
  WorkspacePosition,
  WorkspaceRole,
} from "@yuksalish/contracts";
import { Avatar, Button, Checkbox, Field, Input, Select, Spinner } from "@fluentui/react-components";
import { Add24Regular, PeopleTeam24Regular } from "@fluentui/react-icons";

import {
  createPosition,
  loadDirectory,
  updateEmployeeAccess,
  updatePosition,
} from "./workspace-api";

interface EmployeesViewProps {
  readonly token: string;
  readonly currentUser: WorkspacePerson;
}

const roleLabels: Record<WorkspaceRole, string> = {
  superadmin: "Суперадминистратор",
  admin: "Администратор",
  manager: "Руководитель",
  employee: "Сотрудник",
};

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
  };
}

export function EmployeesView({ token, currentUser }: EmployeesViewProps) {
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
  }, [token]);

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
  };

  const selectPosition = (position: WorkspacePosition) => {
    setSelectedPositionId(position.id);
    setPositionName(position.name);
    setPositionActive(position.isActive);
  };

  const saveEmployee = async () => {
    if (directory === undefined || selectedEmployee === undefined) return;
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
    if (directory === undefined || selectedPosition === undefined || !positionName.trim()) return;
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
    if (directory === undefined || !newPositionName.trim()) return;
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
        <Spinner label="Загружаем сотрудников и должности" />
        {feedback ? <div className="directory-feedback" role="alert">{feedback}</div> : null}
      </section>
    );
  }

  const search = employeeQuery.trim().toLocaleLowerCase("ru");
  const visibleEmployees = directory.employees.filter((employee) =>
    `${employee.name} ${employee.username} ${employee.jobTitle ?? ""}`.toLocaleLowerCase("ru").includes(search));

  return (
    <section className="workspace-view employees-view" aria-label="Сотрудники">
      <header className="section-toolbar">
        <div>
          <h1>Сотрудники</h1>
          <p>{directory.employees.length} учётных записей · {directory.positions.filter((item) => item.isActive).length} активных должностей</p>
        </div>
        <div className="directory-scope-note">Роль определяет права · должность — место в организации</div>
      </header>

      <div className="directory-layout">
        <aside className="employee-list" aria-label="Список сотрудников">
          <Input className="employee-search" aria-label="Поиск сотрудников" placeholder="Имя, логин или должность" value={employeeQuery} onChange={(_, data) => setEmployeeQuery(data.value)} />
          {!visibleEmployees.length && <p className="empty-state-compact" role="status">Сотрудники не найдены</p>}
          {visibleEmployees.map((employee) => (
            <button
              key={employee.id}
              type="button"
              className={employee.id === selectedEmployeeId ? "selected" : ""}
              onClick={() => selectEmployee(employee)}
            >
              <Avatar name={employee.name} size={36} color="colorful" />
              <span>
                <strong>{employee.name}</strong>
                <small>{employee.jobTitle ?? "Должность не назначена"}</small>
              </span>
              <em>{roleLabels[employee.role]}</em>
            </button>
          ))}
        </aside>

        <main className="employee-detail">
          {selectedEmployee ? (
            <>
              <div className="directory-heading">
                <Avatar name={selectedEmployee.name} size={56} color="colorful" />
                <div>
                  <span>Карточка сотрудника</span>
                  <h2>{selectedEmployee.name}</h2>
                  <p>@{selectedEmployee.username} · {selectedEmployee.status}</p>
                </div>
              </div>
              <div className="directory-form-grid">
                <Field label="Роль доступа" hint="Влияет на разрешённые действия в системе.">
                  <Select
                    disabled={!canManage || selectedEmployee.role === "superadmin" || selectedEmployee.id === currentUser.id}
                    value={selectedEmployee.role === "superadmin" ? "admin" : employeeRole}
                    onChange={(event) => setEmployeeRole(event.target.value as typeof employeeRole)}
                  >
                    {directory.roles.map((role) => (
                      <option key={role.key} value={role.key}>{role.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Должность" hint="Выбирается из редактируемого справочника.">
                  <Select
                    disabled={!canManage || selectedEmployee.role === "superadmin"}
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
        </main>

        <aside className="position-catalog" aria-label="Справочник должностей">
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
                <Input value={positionName} onChange={(_, data) => setPositionName(data.value)} />
              </Field>
              <Checkbox
                checked={positionActive}
                label="Доступна для новых назначений"
                onChange={(_, data) => setPositionActive(data.checked === true)}
              />
              <Button disabled={busy || !positionName.trim()} onClick={() => void savePosition()}>
                Сохранить должность
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
      {feedback ? <div className="directory-feedback" role="status">{feedback}</div> : null}
    </section>
  );
}
