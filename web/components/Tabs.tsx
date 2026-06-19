import { ReactNode } from "react";

export interface TabSpec {
  key: string;
  label: ReactNode;
}

export default function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabSpec[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={
            "px-3 py-2 text-sm border-b-2 -mb-px transition-colors " +
            (active === t.key
              ? "border-accent text-white"
              : "border-transparent text-muted hover:text-white")
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
