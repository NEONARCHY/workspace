import type { WorkspacePerson } from "@yuksalish/contracts";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { TaskPersonAvatar } from "./TaskPersonAvatar";

export function GrantParticipant({ person, label, token, size = 32 }: {
  readonly person?: WorkspacePerson;
  readonly label: string;
  readonly token: string;
  readonly size?: 28 | 32 | 48;
}) {
  return <EmployeeProfileLink userId={person?.id} personName={person?.name ?? "Сотрудник недоступен"} className="grant-participant">
    <TaskPersonAvatar person={person} token={token} size={size} />
    <span><small>{label}</small><strong>{person?.name ?? "Сотрудник недоступен"}</strong></span>
  </EmployeeProfileLink>;
}
