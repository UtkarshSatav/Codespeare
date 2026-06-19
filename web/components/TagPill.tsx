export default function TagPill({
  tag,
  active = false,
  onClick,
}: {
  tag: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const cls =
    "inline-block rounded-full px-2.5 py-0.5 text-xs " +
    (active
      ? "bg-accent/20 text-accent border border-accent/60"
      : "bg-bg/60 text-muted border border-border hover:text-white");
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {tag}
    </button>
  ) : (
    <span className={cls}>{tag}</span>
  );
}
