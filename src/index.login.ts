// Entry point for the login edition (GitHub release / Developer ID
// build). Bun compiles this file specifically — see scripts/build-sidecar.sh
// — into the "zhidang-server" sidecar the Tauri app spawns.
import { z } from "zod";
import { createServer, listen } from "./server.js";
import { LoginContentSource } from "./source/login.js";
import { fetchViaFrontend, waitForFrontendRequest, submitFrontendResult } from "./frontendBridge.js";

const app = createServer({
  edition: "login",
  credentialField: "urlToken",
  createSource: (urlToken) => new LoginContentSource(urlToken, fetchViaFrontend),
  // Only this edition needs the login-window relay: requests queued by
  // LoginContentSource are drained by the frontend (see public/app.js's
  // relayFrontendFetches) and run as fetch() inside the Tauri login
  // window's own page context (src-tauri/src/lib.rs's do_zhihu_fetch).
  registerExtraRoutes(app) {
    app.get("/api/frontend-fetch-request", async (_req, res) => {
      const next = await waitForFrontendRequest(25000);
      res.json(next);
    });
    app.post("/api/frontend-fetch-result", (req, res) => {
      const parsed = z.object({ id: z.number(), status: z.number(), body: z.string() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      submitFrontendResult(parsed.data.id, parsed.data.status, parsed.data.body);
      res.json({ ok: true });
    });
  },
});
listen(app);
