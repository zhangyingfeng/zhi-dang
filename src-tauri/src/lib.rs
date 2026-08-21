use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

#[derive(Default)]
struct PendingFetches {
  next_id: AtomicU64,
  senders: Mutex<HashMap<u64, oneshot::Sender<(u16, String)>>>,
}

/// Opens (or focuses, if already open) the embedded Zhihu login window.
#[tauri::command]
async fn open_login_window(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(win) = app.get_webview_window("login") {
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    return Ok(());
  }
  let url = "https://www.zhihu.com/signin"
    .parse()
    .map_err(|e: url::ParseError| e.to_string())?;
  WebviewWindowBuilder::new(&app, "login", WebviewUrl::External(url))
    .inner_size(480.0, 720.0)
    .build()
    .map_err(|e| e.to_string())?;
  Ok(())
}

/// Hides the login window (used by the in-page "close this window" button).
///
/// This deliberately hides rather than destroys the window: every later
/// Zhihu API call runs as `fetch()` inside this window's own page context
/// (see `do_zhihu_fetch`), so the window — and the authenticated session
/// living in its page — has to stay alive for the lifetime of the app, even
/// though the user just wants it out of the way.
#[tauri::command]
fn close_login_window(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(win) = app.get_webview_window("login") {
    win.hide().map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Runs `fetch(url)` inside the login window's own page context (so Zhihu sees
/// a normal same-origin request) and awaits the result back in Rust via IPC.
async fn do_zhihu_fetch(
  app: &tauri::AppHandle,
  state: &PendingFetches,
  url: &str,
) -> Result<(u16, String), String> {
  let win = app
    .get_webview_window("login")
    .ok_or_else(|| "登录窗口不存在，请先打开登录窗口".to_string())?;
  let id = state.next_id.fetch_add(1, Ordering::SeqCst);
  let (tx, rx) = oneshot::channel();
  state.senders.lock().unwrap().insert(id, tx);

  let url_json = serde_json::to_string(url).map_err(|e| e.to_string())?;
  let script = format!(
    r#"(async () => {{
      try {{
        const r = await fetch({url_json}, {{
          headers: {{ accept: "application/json, text/plain, */*" }},
          credentials: "include"
        }});
        const body = await r.text();
        await window.__TAURI__.core.invoke("zhihu_fetch_result", {{ id: {id}, status: r.status, body }});
      }} catch (e) {{
        await window.__TAURI__.core.invoke("zhihu_fetch_result", {{ id: {id}, status: 0, body: String(e) }});
      }}
    }})();"#
  );
  win.eval(&script).map_err(|e| e.to_string())?;

  match tokio::time::timeout(Duration::from_secs(30), rx).await {
    Ok(Ok(result)) => Ok(result),
    Ok(Err(_)) => Err("登录窗口没有返回结果（可能已关闭）".to_string()),
    Err(_) => {
      state.senders.lock().unwrap().remove(&id);
      Err("请求知乎接口超时".to_string())
    }
  }
}

#[tauri::command]
async fn zhihu_fetch(
  app: tauri::AppHandle,
  state: tauri::State<'_, PendingFetches>,
  url: String,
) -> Result<(u16, String), String> {
  do_zhihu_fetch(&app, &state, &url).await
}

/// Called back from the page-context fetch script to deliver its result.
#[tauri::command]
fn zhihu_fetch_result(state: tauri::State<'_, PendingFetches>, id: u64, status: u16, body: String) {
  if let Some(tx) = state.senders.lock().unwrap().remove(&id) {
    let _ = tx.send((status, body));
  }
}

async fn fetch_url_token(app: &tauri::AppHandle, state: &PendingFetches) -> Result<Option<String>, String> {
  let (status, body) =
    do_zhihu_fetch(app, state, "https://www.zhihu.com/api/v4/me?include=url_token").await?;
  if status != 200 {
    return Ok(None);
  }
  Ok(
    serde_json::from_str::<serde_json::Value>(&body)
      .ok()
      .and_then(|v| v.get("url_token").and_then(|t| t.as_str().map(String::from))),
  )
}

/// Checks login status by fetching the account endpoint from inside the page.
#[tauri::command]
async fn zhihu_me(
  app: tauri::AppHandle,
  state: tauri::State<'_, PendingFetches>,
) -> Result<serde_json::Value, String> {
  let url_token = fetch_url_token(&app, &state).await?;
  Ok(serde_json::json!({ "urlToken": url_token }))
}

/// Polls the login window until Zhihu reports a logged-in account, then shows
/// a "you can close this window" banner inside it.
#[tauri::command]
async fn wait_for_login(
  app: tauri::AppHandle,
  state: tauri::State<'_, PendingFetches>,
) -> Result<serde_json::Value, String> {
  let deadline = tokio::time::Instant::now() + Duration::from_secs(300);
  loop {
    if app.get_webview_window("login").is_none() {
      return Err("登录窗口已关闭，请重新点击登录。".to_string());
    }
    if let Some(token) = fetch_url_token(&app, &state).await.unwrap_or(None) {
      if let Some(win) = app.get_webview_window("login") {
        let banner = r#"(() => {
          if (document.getElementById('zd-login-ok')) return;
          const b = document.createElement('div');
          b.id = 'zd-login-ok';
          b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#1a7f37;color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:center;gap:14px;font:600 15px -apple-system,sans-serif;z-index:2147483647;';
          const text = document.createElement('span');
          text.textContent = '登录成功，可以关闭此窗口';
          const btn = document.createElement('button');
          btn.textContent = '关闭窗口';
          btn.style.cssText = 'background:#fff;color:#1a7f37;border:0;border-radius:6px;padding:8px 14px;font:600 14px -apple-system,sans-serif;cursor:pointer;';
          btn.onclick = () => window.__TAURI__.core.invoke('close_login_window');
          b.appendChild(text);
          b.appendChild(btn);
          document.body.prepend(b);
        })();"#;
        let _ = win.eval(banner);
      }
      return Ok(serde_json::json!({ "urlToken": token }));
    }
    if tokio::time::Instant::now() >= deadline {
      return Err("等待登录超时，请重新点击登录。".to_string());
    }
    tokio::time::sleep(Duration::from_millis(1500)).await;
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .manage(PendingFetches::default())
    .invoke_handler(tauri::generate_handler![
      open_login_window,
      close_login_window,
      zhihu_fetch,
      zhihu_fetch_result,
      zhihu_me,
      wait_for_login
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
