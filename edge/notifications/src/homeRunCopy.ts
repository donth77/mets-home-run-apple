export const HOME_RUN_NOTIFICATION_TEMPLATES = [
  "{player} hit a home run!",
  "{player} goes deep!",
  "Gone! {player} sends one out!",
  "{player} leaves the yard!",
  "Raise the Apple! {player} homers!",
  "{player} launches one!",
  "That ball is gone! {player} homers!",
  "Cue the Apple! {player} goes yard!",
  "It's outta here! {player} goes deep!",
] as const;

export function selectHomeRunNotificationTitle(player: string, roll = Math.random()): string {
  const normalizedPlayer = player.trim() || "A Met";
  const boundedRoll = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 1 - Number.EPSILON) : 0;
  const template = HOME_RUN_NOTIFICATION_TEMPLATES[Math.floor(boundedRoll * HOME_RUN_NOTIFICATION_TEMPLATES.length)];
  return template.replace("{player}", normalizedPlayer);
}
