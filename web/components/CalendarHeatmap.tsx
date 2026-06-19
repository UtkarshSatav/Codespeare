// GitHub-style activity heatmap: 7 rows (Sun-Sat) × ~26 weeks.

function intensity(n: number): string {
  if (n === 0) return "bg-bg/40";
  if (n === 1) return "bg-accent/30";
  if (n <= 3) return "bg-accent/60";
  if (n <= 6) return "bg-accent/80";
  return "bg-accent";
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function CalendarHeatmap({
  activity,
}: {
  activity: Record<string, number>;
}) {
  const today = new Date();
  // Show the last 26 weeks ending on the current week.
  const days: Date[] = [];
  const start = new Date(today);
  start.setDate(start.getDate() - 26 * 7 + 1);
  // Move start back to Sunday.
  start.setDate(start.getDate() - start.getDay());
  for (let i = 0; i < 26 * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  // group into columns of 7 (one per week)
  const columns: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) columns.push(days.slice(i, i + 7));

  const total = Object.values(activity).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-2 text-xs text-muted">
        {total} submissions in the last 26 weeks
      </div>
      <div className="flex gap-[3px]">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {col.map((d, ri) => {
              const key = ymd(d);
              const n = activity[key] ?? 0;
              return (
                <div
                  key={ri}
                  title={`${key}: ${n} submissions`}
                  className={`h-3 w-3 rounded-sm ${intensity(n)}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
