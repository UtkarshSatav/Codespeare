import type { Difficulty } from "@/lib/problems";

const STYLES: Record<Difficulty, string> = {
  Easy:   "text-ok",
  Medium: "text-warn",
  Hard:   "text-bad",
};

export default function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <span className={`font-medium ${STYLES[difficulty]}`}>{difficulty}</span>;
}
