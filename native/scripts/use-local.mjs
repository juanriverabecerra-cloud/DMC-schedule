// Points the built app at the dev server on this Mac instead of the live site, for trying
// things in the simulator:  npm run local   (then build). `npx cap sync` puts the live site back.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of ["ios/App/App/capacitor.config.json", "android/app/src/main/assets/capacitor.config.json"]) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const config = JSON.parse(fs.readFileSync(full, "utf8"));
  config.server = { ...config.server, url: process.env.DMC_LOCAL_URL || "http://localhost:8888", cleartext: true };
  if (config.ios) config.ios.limitsNavigationsToAppBoundDomains = false;
  fs.writeFileSync(full, JSON.stringify(config, null, "\t"));
  console.log(`${file} → ${config.server.url}`);
}
