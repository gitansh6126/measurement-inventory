// Entry file for the Hostinger Node.js app. Runs the TypeScript sources through tsx (the API
// already runs that way in production) after forcing production mode for Next.js.
import { register } from "tsx/esm/api";

process.env.NODE_ENV ??= "production";
register();
await import("./server.ts");
