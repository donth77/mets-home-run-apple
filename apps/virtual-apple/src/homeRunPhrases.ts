export const HOME_RUN_PHRASE_TEMPLATES = [
  "{batter} sends one out, and the Home Run Apple is rising in center field!",
  "That ball is gone! {batter} brings the Home Run Apple to life in center field!",
  "{batter} goes deep! Time for the Home Run Apple to rise!",
  "Clear the wall and cue the Apple. {batter} has left the yard!",
  "Gone! {batter} launches one, and the Home Run Apple is on its way up!",
  "{batter} crushes one out of here. Raise that Apple!",
  "A Mets homer from {batter} means the Apple is rising at Citi Field!",
  "{batter} sends it over the fence, and up comes the Home Run Apple!",
] as const;

export function selectHomeRunPhrase(batter: string, roll = Math.random()): string {
  const normalizedBatter = batter.trim() || "A Mets hitter";
  const boundedRoll = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 1 - Number.EPSILON) : 0;
  const template = HOME_RUN_PHRASE_TEMPLATES[Math.floor(boundedRoll * HOME_RUN_PHRASE_TEMPLATES.length)];
  return template.replace("{batter}", normalizedBatter);
}
