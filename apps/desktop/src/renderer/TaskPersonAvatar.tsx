import type { WorkspacePerson } from "@yuksalish/contracts";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { ProfileAvatar } from "./ProfileAvatar";

type TaskAvatarSize = 24 | 28 | 32 | 36 | 40 | 48;

export function TaskPersonAvatar({ person, token, size, fallbackName = "Сотрудник" }: {
  readonly person?: WorkspacePerson;
  readonly token?: string;
  readonly size: TaskAvatarSize;
  readonly fallbackName?: string;
}) {
  return person
    ? <ProfileAvatar person={person} token={token} size={size} aria-hidden />
    : <EmployeeAvatar name={fallbackName} size={size} color="colorful" aria-hidden />;
}
