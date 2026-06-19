export default function StatusIcon({ status }: { status: "AC" | "TRIED" | null }) {
  if (status === "AC") {
    return (
      <span title="Solved" className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ok/20 text-ok">
        ✓
      </span>
    );
  }
  if (status === "TRIED") {
    return (
      <span title="Attempted" className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-warn/20 text-warn">
        •
      </span>
    );
  }
  return <span className="inline-block h-4 w-4" />;
}
