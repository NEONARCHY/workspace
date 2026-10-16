import { Avatar as FluentAvatar, type AvatarProps } from "@fluentui/react-components";
import { employeeInitials } from "./employee-display-name";

/** Employee initials follow given name, then surname, regardless of directory order. */
export function EmployeeAvatar(props: AvatarProps) {
  return <FluentAvatar {...props} initials={props.initials ?? employeeInitials(props.name ?? "")} />;
}
