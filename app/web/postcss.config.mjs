import path from "node:path";
import { fileURLToPath } from "node:url";

// Absolute config path so Tailwind works even when Next is started from another directory.
const dir = path.dirname(fileURLToPath(import.meta.url));
export default { plugins: { tailwindcss: { config: path.join(dir, "tailwind.config.js") }, autoprefixer: {} } };
