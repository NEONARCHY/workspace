import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import type { GrantAction, GrantDetail } from "@yuksalish/contracts";
import { GrantDeadlinePanel } from "./GrantDeadlinePanel";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./WorkspaceDateTimePicker", () => ({ WorkspaceDateTimePicker: ({ value, onChange, ariaLabel, disabled }: {
  value: string; onChange: (value: string) => void; ariaLabel: string; disabled: boolean;
}) => <input type="datetime-local" aria-label={ariaLabel} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} /> }));
afterEach(cleanup);
const grant: GrantDetail = {
  id: "grant", title: "Грант", description: "", initiatorUserId: "initiator", authorUserId: "author",
  assigneeId: "executor", coAssigneeIds: ["co"], leaderUserId: "leader", chairUserId: "author",
  workflowVersion: 2, launchApprovedAt: "2026-11-20T05:00:00Z", launchApprovedByUserId: "author",
  dueAt: "2099-11-01T09:00:00Z", status: "chair_review", revision: 4, checklist: [], resultText: "Готово",
  chatId: "chat", createdAt: "2026-11-20T05:00:00Z", updatedAt: "2026-11-20T05:00:00Z",
  allowedActions: ["request_deadline"], attachments: [], events: [],
};
const pending = { id: "request", requestedByUserId: "co", oldDueAt: grant.dueAt, dueAt: "2099-11-04T09:00:00Z",
  reason: "Ожидаем бюджет партнёра", status: "pending" as const, decidedByUserId: null, decisionReason: "",
  createdAt: "2026-11-24T09:00:00Z", decidedAt: null };
function show(detail = grant, onPerform = vi.fn().mockResolvedValue(grant), busy = false) {
  return render(<FluentProvider theme={workspaceTheme}><GrantDeadlinePanel detail={detail} people={[]}
    busy={busy} now={Date.parse("2026-11-24T09:00:00Z")} onPerform={onPerform} /></FluentProvider>);
}
function fill() {
  fireEvent.change(screen.getByLabelText("Новый срок гранта"), { target: { value: "2099-11-05T14:00" } });
  fireEvent.change(screen.getByLabelText("Причина продления *"), { target: { value: "Ожидаем бюджет партнёра" } });
}

it("requires a later date and reason, and writes only after explicit confirmation", async () => {
  const onPerform = vi.fn().mockResolvedValue(grant);
  show(grant, onPerform);
  fireEvent.click(screen.getByRole("button", { name: "Запросить продление" }));
  expect(onPerform).not.toHaveBeenCalled();
  const submit = screen.getByRole("button", { name: "Отправить запрос" });
  expect(submit).toBeDisabled();
  fill();
  fireEvent.change(screen.getByLabelText("Новый срок гранта"), { target: { value: "2099-10-31T14:00" } });
  expect(submit).toBeDisabled();
  fill(); fireEvent.click(submit);
  await waitFor(() => expect(onPerform).toHaveBeenCalledWith({ action: "request_deadline", expectedRevision: 4,
    dueAt: new Date("2099-11-05T14:00").toISOString(), text: "Ожидаем бюджет партнёра" }));
});

it("offers direct extension at the review stage and blocks duplicate clicks", async () => {
  const onPerform = vi.fn<(action?: GrantAction) => Promise<GrantDetail>>(() => new Promise(() => undefined));
  show({ ...grant, allowedActions: ["extend_deadline", "request_deadline"] }, onPerform);
  expect(screen.queryByRole("button", { name: "Запросить продление" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Продлить срок" })); fill();
  const form = screen.getByRole("form", { name: "Продление срока" });
  fireEvent.submit(form); fireEvent.submit(form);
  expect(onPerform).toHaveBeenCalledTimes(1);
  expect(onPerform.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ action: "extend_deadline" }));
});

it("shows a request and requires a reason for rejection", async () => {
  const onPerform = vi.fn().mockResolvedValue(grant);
  show({ ...grant, pendingDeadlineRequest: pending, allowedActions: ["approve_deadline", "reject_deadline"] }, onPerform);
  expect(screen.getByText(pending.reason)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Отклонить запрос" }));
  const submit = screen.getByRole("button", { name: "Подтвердить отклонение" });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Причина отклонения *"), { target: { value: "Срок подачи изменить нельзя" } });
  fireEvent.click(submit);
  await waitFor(() => expect(onPerform).toHaveBeenCalledWith({ action: "reject_deadline", expectedRevision: 4,
    requestId: "request", text: "Срок подачи изменить нельзя" }));
});

it("approves only the displayed request and revision", async () => {
  const onPerform = vi.fn().mockResolvedValue(grant);
  show({ ...grant, pendingDeadlineRequest: pending, allowedActions: ["approve_deadline"] }, onPerform);
  fireEvent.click(screen.getByRole("button", { name: "Одобрить продление" }));
  await waitFor(() => expect(onPerform).toHaveBeenCalledWith({ action: "approve_deadline", expectedRevision: 4, requestId: "request" }));
});

it("preserves the draft after an uncertain write and requires a state check before another submission", async () => {
  const onPerform = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(grant);
  show(grant, onPerform);
  fireEvent.click(screen.getByRole("button", { name: "Запросить продление" })); fill();
  fireEvent.click(screen.getByRole("button", { name: "Отправить запрос" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByLabelText("Причина продления *")).toHaveValue("Ожидаем бюджет партнёра");
  expect(screen.getByRole("button", { name: "Отправить запрос" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Проверить состояние" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Отправить запрос" })).toBeEnabled());
  expect(onPerform).toHaveBeenLastCalledWith(undefined);
  expect(onPerform).toHaveBeenCalledTimes(2);
});

it("never silently submits a draft against a newly received revision", () => {
  const onPerform = vi.fn().mockResolvedValue(grant);
  const view = show(grant, onPerform);
  fireEvent.click(screen.getByRole("button", { name: "Запросить продление" })); fill();
  view.rerender(<FluentProvider theme={workspaceTheme}><GrantDeadlinePanel detail={{ ...grant, revision: 5 }} people={[]} busy={false} now={Date.parse("2026-11-24T09:00:00Z")} onPerform={onPerform} /></FluentProvider>);
  expect(screen.getByText(/Заявка изменилась/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Отправить запрос" })).toBeDisabled();
  expect(onPerform).not.toHaveBeenCalled();
});

it("keeps resolved requests readable without offering actions on completed grants", () => {
  show({ ...grant, status: "completed", allowedActions: [], deadlineRequests: [{ ...pending,
    status: "rejected", decidedAt: "2026-11-24T10:00:00Z", decidedByUserId: "author", decisionReason: "Дедлайн конкурса фиксирован" }] });
  expect(screen.queryByRole("button", { name: /продлен/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("История запросов · 1"));
  expect(screen.getByText("Отклонено")).toBeVisible();
  expect(screen.getByText("Дедлайн конкурса фиксирован")).toBeVisible();
});

it("blocks approval of a proposal that has expired while keeping rejection available", () => {
  show({ ...grant, dueAt: "2026-11-20T09:00:00Z", allowedActions: ["approve_deadline", "reject_deadline"],
    pendingDeadlineRequest: { ...pending, oldDueAt: "2026-11-20T09:00:00Z", dueAt: "2026-11-23T09:00:00Z" } });
  expect(screen.getByRole("button", { name: "Одобрить продление" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Отклонить запрос" })).toBeEnabled();
  expect(screen.getByText(/Предложенный срок уже истёк/)).toBeVisible();
});
