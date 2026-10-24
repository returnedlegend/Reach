import { demoData } from "../src/data/demo";
import { productionData } from "../src/data/coverage";
import { validateData } from "../src/lib/data-validation";
let failed = false;
for (const [name, data] of [
  ["fictional demo", demoData],
  ["production", productionData],
] as const) {
  const errors = validateData(data);
  if (errors.length) {
    failed = true;
    console.error(`${name}:\n${errors.join("\n")}`);
  } else
    console.log(
      `${name}: data checks passed (${data.pantries.length} pantries).`,
    );
}
if (failed) process.exitCode = 1;
