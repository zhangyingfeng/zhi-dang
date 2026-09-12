// Entry point for the App-Store-safe key edition. Bun compiles this file
// specifically — see scripts/build-sidecar.sh — into the "zhidang-server"
// sidecar for that build.
//
// Unlike the login edition, this one talks to Zhihu's official Data Open
// Platform (developer.zhihu.com) with a plain bearer-token Access Secret —
// no login window, no page-context fetch relay. The secret itself lives in
// the macOS Keychain (src-tauri/src/lib.rs, "key" feature) and is
// handed to this process once per export request, never persisted here.
import { createServer, listen } from "./server.js";
import { KeyContentSource, fetchKeyQuota } from "./source/key.js";

const app = createServer({
  edition: "key",
  credentialField: "accessSecret",
  createSource: (accessSecret) => new KeyContentSource(accessSecret),
  // Quota lookups don't consume the daily allowance (per the open platform's
  // own docs), so the UI can call this as often as it wants to show "今日
  // 剩余 N 次" — accessSecret travels as a query param since this endpoint,
  // like the rest of the server, only ever accepts connections from
  // 127.0.0.1.
  registerExtraRoutes(app) {
    app.get("/api/key/quota", async (req, res) => {
      const secret = String(req.query.accessSecret || "");
      if (!secret) return res.status(400).json({ error: "缺少 accessSecret" });
      try {
        const quota = await fetchKeyQuota(secret);
        res.json({ quota });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  },
});
// A different port than the login edition (4317) so both editions' apps can
// run side by side for testing — see src/server.ts's listen() doc comment.
listen(app, 4318);
