// Entry point for the App-Store-safe official-API edition. Bun compiles
// this file specifically — see scripts/build-sidecar.sh — into the
// "zhidang-server" sidecar for that build.
//
// Unlike the direct edition, this one talks to Zhihu's official Data Open
// Platform (developer.zhihu.com) with a plain bearer-token Access Secret —
// no login window, no page-context fetch relay. The secret itself lives in
// the macOS Keychain (src-tauri/src/lib.rs, "appstore" feature) and is
// handed to this process once per export request, never persisted here.
import { createServer, listen } from "./server.js";
import { OfficialApiContentSource, fetchOfficialQuota } from "./source/official.js";

const app = createServer({
  edition: "official",
  credentialField: "accessSecret",
  createSource: (accessSecret) => new OfficialApiContentSource(accessSecret),
  // Quota lookups don't consume the daily allowance (per the open platform's
  // own docs), so the UI can call this as often as it wants to show "今日
  // 剩余 N 次" — accessSecret travels as a query param since this endpoint,
  // like the rest of the server, only ever accepts connections from
  // 127.0.0.1.
  registerExtraRoutes(app) {
    app.get("/api/official/quota", async (req, res) => {
      const secret = String(req.query.accessSecret || "");
      if (!secret) return res.status(400).json({ error: "缺少 accessSecret" });
      try {
        const quota = await fetchOfficialQuota(secret);
        res.json({ quota });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  },
});
listen(app);
