import { loadLessons, validateLessons } from "./content-lib.mjs";

const lessons = await loadLessons();
const errors = validateLessons(lessons);
if (errors.length) {
  console.error(`Content validation failed (${errors.length})`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}
console.log(`Validated ${lessons.length} lessons.`);
