import type { WorkspaceDepartment } from "@yuksalish/contracts";
import {
  Briefcase20Regular, Building20Regular, Document20Regular,
  Globe20Regular, Money20Regular, PeopleTeam20Regular,
} from "@fluentui/react-icons";

export const departmentIconChoices = [
  { key: "building", label: "Подразделение" },
  { key: "team", label: "Команда" },
  { key: "briefcase", label: "Работа" },
  { key: "document", label: "Документы" },
  { key: "globe", label: "Регион" },
  { key: "finance", label: "Финансы" },
] as const;

export function DepartmentIcon({ iconKey = "building" }: { readonly iconKey?: WorkspaceDepartment["iconKey"] }) {
  switch (iconKey) {
    case "team": return <PeopleTeam20Regular aria-hidden="true" />;
    case "briefcase": return <Briefcase20Regular aria-hidden="true" />;
    case "document": return <Document20Regular aria-hidden="true" />;
    case "globe": return <Globe20Regular aria-hidden="true" />;
    case "finance": return <Money20Regular aria-hidden="true" />;
    default: return <Building20Regular aria-hidden="true" />;
  }
}
