import type { ApiPage, PageFetcher } from "./zhihu.js";

interface QueuedRequest { id: number; url: string }
interface PendingResolver { resolve: (page: ApiPage) => void; reject: (error: Error) => void }

let nextId = 1;
const pending = new Map<number, PendingResolver>();
const queue: QueuedRequest[] = [];
let waitingResolver: ((value: QueuedRequest | null) => void) | null = null;

export const fetchViaFrontend: PageFetcher = (url: string) =>
  new Promise<ApiPage>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const item = { id, url };
    if (waitingResolver) { const notify = waitingResolver; waitingResolver = null; notify(item); }
    else queue.push(item);
  });

export function waitForFrontendRequest(timeoutMs: number): Promise<QueuedRequest | null> {
  return new Promise((resolve) => {
    const queued = queue.shift();
    if (queued) { resolve(queued); return; }
    const timer = setTimeout(() => { waitingResolver = null; resolve(null); }, timeoutMs);
    waitingResolver = (value) => { clearTimeout(timer); resolve(value); };
  });
}

export function submitFrontendResult(id: number, status: number, body: string) {
  const resolver = pending.get(id);
  if (!resolver) return;
  pending.delete(id);
  if (status === 0) { resolver.reject(new Error(`登录窗口请求失败：${body}`)); return; }
  if (status !== 200) { resolver.reject(new Error(`知乎接口返回 ${status}：${body.slice(0, 300)}`)); return; }
  try {
    const data = JSON.parse(body);
    if (!Array.isArray(data?.data) || !data?.paging) throw new Error("shape");
    resolver.resolve(data as ApiPage);
  } catch {
    resolver.reject(new Error("知乎返回的数据格式已经变化，无法继续解析；请检查应用更新。"));
  }
}
