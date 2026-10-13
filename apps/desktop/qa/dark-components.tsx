// Additional real component coverage; synthetic data and local state only.
import { useState } from "react";
import { Badge, Button, Checkbox, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Popover, PopoverSurface, PopoverTrigger, Spinner, Switch, Textarea, Tooltip } from "@fluentui/react-components";
import type { DirectoryBootstrap } from "@yuksalish/contracts";
import { ColorThemeSettings } from "../src/renderer/ColorThemeSettings";
import { WorkspaceDateTimePicker } from "../src/renderer/WorkspaceDateTimePicker";
import { PersonPicker } from "../src/renderer/PersonPicker";
import { WorkspaceSelect } from "../src/renderer/WorkspaceSelect";
import { WorkspaceFileDropzone } from "../src/renderer/WorkspaceFileDropzone";
import { WorkspaceDialog } from "../src/renderer/WorkspaceDialog";
import { SpatialBoard, SpatialCard, SpatialLane } from "../src/renderer/SpatialBoard";
import { WorkflowStageColorPicker } from "../src/renderer/WorkflowStageColorPicker";
import { DepartmentManagement } from "../src/renderer/DepartmentManagement";
import { ModuleAccessManagement } from "../src/renderer/ModuleAccessManagement";
import { TeamDashboardView } from "../src/renderer/TeamDashboardView";
import { PersonalHomeView } from "../src/renderer/PersonalHomeView";
import { LoginView } from "../src/renderer/LoginView";
import { SurveyAnalyticsView } from "../src/renderer/SurveyAnalyticsView";
import { ProjectsView } from "../src/renderer/ProjectsView";
import { ThinkingOrb } from "../src/renderer/components/ui/thinking-orbs";
import { homeFixture } from "../src/renderer/test-fixtures/personal-home-fixture";
import { people, initialTasks } from "../src/renderer/test-fixtures/demo-data";

const reject = async (): Promise<never> => { throw new Error("QA: тестовый отказ"); };
export function ThemeExtraPages({ section, directory }: { section: string; directory: DirectoryBootstrap }) {
  const workspace = homeFixture("aziza", Date.now());
  if (section === "home") return <PersonalHomeView token="qa-only" workspace={workspace} canView={() => true} onOpen={() => {}} onOpenNotification={() => {}} onRefresh={async () => {}} />;
  if (section === "team") return <TeamDashboardView token="qa-only" tasks={initialTasks} people={people} departments={workspace.departments} currentUserId="aziza" efficiencyLoading={false} onSelectTask={() => {}} />;
  if (section === "departments") return <div className="workspace-view" style={{ overflow: "auto" }}><DepartmentManagement token="qa-only" departments={workspace.departments} employees={directory.employees} onChanged={() => {}} /></div>;
  if (section === "access") return <div className="workspace-view" style={{ overflow: "auto" }}><ModuleAccessManagement token="qa-only" directory={{ ...directory, departments: workspace.departments }} onRuleChanged={() => {}} onRuleDeleted={() => {}} /></div>;
  if (section === "login") return <LoginView busy={false} onLogin={reject} onAcceptInvitation={reject} onCompletePasswordReset={reject} error="QA: неверный пароль, повторите попытку" />;
  if (section === "surveys") return <SurveyAnalyticsView token="qa-only" canCreate canEdit />;
  if (section === "legacy-projects") return <ProjectsView projects={[]} people={people} currentUser={people[0]!} onCreate={reject} onUpdate={reject} onMove={reject} />;
  if (section === "components") return <ThemeComponents />;
  return null;
}
function ThemeComponents() {
  const [date, setDate] = useState("2026-10-13T14:10"), [person, setPerson] = useState("aziza"), [priority, setPriority] = useState("normal");
  const [files, setFiles] = useState<File[]>([]), [dialog, setDialog] = useState(false), [stage, setStage] = useState<string>();
  const [lane, setLane] = useState("start"), [fail, setFail] = useState(true);
  return <div className="workspace-view qa-theme-components" style={{ padding: 16, overflow: "auto", display: "grid", alignContent: "start", gap: 20 }}>
    <ColorThemeSettings userId="qa-theme" />
    <section className="account-section" style={{ display: "grid", gap: 12 }}>
      <h2>Общие состояния компонентов</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Button appearance="primary">Основное действие</Button><Button>Вторичное действие</Button><Button appearance="subtle">Тихое действие</Button>
        <Button disabled>Недоступное действие</Button><Tooltip content="Подсказка действия" relationship="description"><Button>Подсказка QA</Button></Tooltip>
        <Menu><MenuTrigger disableButtonEnhancement><Button>Меню QA</Button></MenuTrigger><MenuPopover><MenuList><MenuItem>Редактировать</MenuItem><MenuItem>Копировать</MenuItem><MenuItem>Удалить</MenuItem></MenuList></MenuPopover></Menu>
        <Popover><PopoverTrigger disableButtonEnhancement><Button>Popover QA</Button></PopoverTrigger><PopoverSurface><h3>Контекст рабочего объекта</h3><p>Текст, ссылки и доступные действия.</p><Button>Открыть объект</Button></PopoverSurface></Popover>
        <Button onClick={() => setDialog(true)}>Диалог QA</Button>
      </div>
      <Field label="Черновик QA"><Input defaultValue="Текст не должен теряться при смене темы" /></Field>
      <Field label="Описание QA"><Textarea defaultValue="Многострочное описание" /></Field>
      <Checkbox label="Выбранная опция" defaultChecked /><Switch label="Включённая настройка" defaultChecked />
      <div style={{ display: "flex", gap: 12 }}><Badge color="success">Готово</Badge><Badge color="warning">Внимание</Badge><Badge color="danger">Ошибка</Badge><Spinner size="tiny" label="Загрузка" /><ThinkingOrb /></div>
      <Field label="Дата QA"><WorkspaceDateTimePicker mode="datetime" value={date} onChange={setDate} ariaLabel="Дата QA" /></Field>
      <PersonPicker people={people} departments={homeFixture().departments} value={person} onChange={setPerson} label="Ответственный QA" />
      <WorkspaceSelect aria-label="Приоритет QA" variant="priority" value={priority} onChange={e => setPriority(e.target.value)}><option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option></WorkspaceSelect>
      <WorkspaceFileDropzone label="Документы QA" hint="Файлы для проверки оформления" actionLabel="Выбрать файл" files={files} onFiles={setFiles} accept=".txt" />
      <WorkflowStageColorPicker value={stage} usedByOtherStages={[]} onChange={setStage} />
    </section>
    <Checkbox label="QA: отказ переноса" checked={fail} onChange={(_e, data) => setFail(data.checked === true)} />
    <SpatialBoard interactionMode="payment" canDrop={(_id, target) => target === "done"} onMove={async (_id, target) => { if (fail) throw new Error("QA: переход отклонён, объект возвращён"); setLane(target); }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(180px,1fr))", gap: 12, overflowX: "auto" }}>
        {["start", "done", "blocked"].map(id => <SpatialLane key={id} id={id} className="approval-column" style={{ minHeight: 180 }}><header>{id}</header>{lane === id && <SpatialCard id="qa-card" lane={id} label="Тестовая карточка" className="approval-board-card"><div className="approval-card-open"><strong>Тестовая карточка</strong><span>Данные только внутри QA</span></div></SpatialCard>}</SpatialLane>)}
      </div>
    </SpatialBoard>
    <WorkspaceDialog open={dialog} onOpenChange={(_e, data) => setDialog(data.open)}><DialogSurface><DialogBody><DialogTitle>Диалог QA</DialogTitle><DialogContent><Field label="Ввод диалога"><Input /></Field><p>Прочитайте условия действия.</p></DialogContent><DialogActions><Button onClick={() => setDialog(false)}>Закрыть диалог QA</Button><Button appearance="primary">Подтвердить</Button></DialogActions></DialogBody></DialogSurface></WorkspaceDialog>
  </div>;
}
