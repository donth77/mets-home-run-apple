export type StadiumCelebrationKind = "HOME_RUN" | "METS_WIN";

export function stadiumCelebrationKind(label: string): StadiumCelebrationKind | null {
  const normalizedLabel = label.trim().toUpperCase();
  if (normalizedLabel.includes("FINAL")) return null;
  if (normalizedLabel.includes("METS WIN")) return "METS_WIN";
  if (normalizedLabel.includes("HOME RUN") || normalizedLabel.includes("HR CONFIRMED")) return "HOME_RUN";
  return null;
}
