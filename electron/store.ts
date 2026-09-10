import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  stateSchema,
  type State,
  type Article,
  type Job,
  type Asset,
  platformIds,
  allowedPlatformUrl,
} from "../src/domain";
import { adapt } from "./content";
export const emptyState = (): State => ({
  version: 1,
  articles: [],
  accounts: [],
  assets: [],
  jobs: [],
  settings: { queuePaused: false },
});
export class Store {
  state: State;
  constructor(
    public directory: string,
    private changed: (s: State) => void = () => {},
  ) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(directory, "assets"), { recursive: true });
    const file = path.join(directory, "workspace.json");
    this.state = fs.existsSync(file)
      ? stateSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")))
      : emptyState();
    if (this.state.jobs.some((j) => j.status === "running"))
      this.change((s) => {
        for (const j of s.jobs)
          if (j.status === "running") {
            j.status = "needs_attention";
            j.message =
              "上次运行意外中断，请检查平台草稿后继续；未自动重复执行。";
            j.logs.push({ at: new Date().toISOString(), message: j.message });
            j.logs = j.logs.slice(-200);
          }
      });
  }
  change(fn: (s: State) => void): State {
    const next = structuredClone(this.state);
    fn(next);
    const validated = stateSchema.parse(next);
    const file = path.join(this.directory, "workspace.json"),
      tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(validated, null, 2), { mode: 0o600 });
    // Windows requires a writable handle when flushing file buffers.
    const fd = fs.openSync(tmp, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
    fs.renameSync(tmp, file);
    this.state = validated;
    this.changed(structuredClone(validated));
    return structuredClone(validated);
  }
  article(id: string): Article {
    const a = this.state.articles.find((a) => a.id === id);
    if (!a) throw Error("文章不存在");
    return a;
  }
  job(id: string): Job {
    const j = this.state.jobs.find((j) => j.id === id);
    if (!j) throw Error("任务不存在");
    return j;
  }
  save(article: Article) {
    this.change((s) => {
      const i = s.articles.findIndex((a) => a.id === article.id),
        old = s.articles[i];
      if (old && article.revision !== old.revision)
        throw Error("文章已在其他操作中更新，请重新打开后保存。");
      const now = new Date().toISOString();
      const history = old
        ? [
            ...old.history,
            {
              revision: old.revision,
              title: old.title,
              markdown: old.markdown,
              at: old.updatedAt,
            },
          ].slice(-30)
        : [];
      const next = {
        ...article,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        revision: old ? old.revision + 1 : 1,
        history,
      };
      if (i < 0) s.articles.unshift(next);
      else s.articles[i] = next;
    });
  }
  enqueue(articleId: string, accountIds: string[], scheduledAt: string | null) {
    const a = this.article(articleId);
    if (!a.title.trim() || !a.markdown.trim())
      throw Error("请先填写主稿标题和正文。");
    if (
      scheduledAt &&
      (!Number.isFinite(Date.parse(scheduledAt)) ||
        Date.parse(scheduledAt) <= Date.now())
    )
      throw Error("预约时间必须晚于当前时间。");
    if (!accountIds.length) throw Error("请选择至少一个账号。");
    this.change((s) => {
      for (const accountId of new Set(accountIds)) {
        const account = s.accounts.find((a) => a.id === accountId);
        if (!account || account.platform === "web")
          throw Error("所选账号不存在或不能用于发布。");
        const snapshot = adapt(a, account.platform);
        if (!snapshot.title.trim() || !snapshot.markdown.trim())
          throw Error("平台稿标题和正文不能为空。");
        if (account.platform === "xiaohongshu" && !a.overrides.xiaohongshu)
          throw Error("请先为小红书保存独立短稿和配图。");
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([a.id, accountId, snapshot]))
          .digest("hex");
        if (
          s.jobs.some(
            (j) => j.fingerprint === fingerprint && j.status !== "cancelled",
          )
        )
          throw Error(
            `${account.name} 已存在相同内容的任务，请在任务中心继续处理。`,
          );
        const now = new Date().toISOString();
        s.jobs.unshift({
          id: randomUUID(),
          articleId: a.id,
          accountId,
          platform: account.platform,
          revision: a.revision,
          snapshot,
          status: "queued",
          createdAt: now,
          updatedAt: now,
          scheduledAt,
          fingerprint,
          attempts: 0,
          message: "等待执行",
          resultUrl: "",
          logs: [
            {
              at: now,
              message: "已固定本次平台稿快照，后续修改主稿不影响此任务。",
            },
          ],
        });
      }
    });
  }
  updateJob(id: string, patch: Partial<Job>, message: string) {
    this.change((s) => {
      const j = s.jobs.find((j) => j.id === id);
      if (!j) throw Error("任务不存在");
      Object.assign(j, patch, { message, updatedAt: new Date().toISOString() });
      j.logs = [...j.logs, { at: j.updatedAt, message }].slice(-200);
    });
  }
  confirm(id: string, url: string) {
    const j = this.job(id);
    if (!["awaiting_review", "needs_attention"].includes(j.status))
      throw Error("此任务当前不能确认发布。");
    if (!allowedPlatformUrl(j.platform, url))
      throw Error("请输入该平台的 HTTPS 文章链接。");
    this.updateJob(
      id,
      { status: "published", resultUrl: url },
      "用户检查平台结果后，手动确认已发布。",
    );
  }
  addAsset(buffer: Buffer, name: string): Asset {
    if (buffer.length > 12 * 1024 * 1024 || !buffer.length)
      throw Error("图片大小必须为 1 字节到 12 MB。");
    let mime: Asset["mime"];
    if (
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      mime = "image/png";
    else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
      mime = "image/jpeg";
    else if (
      buffer
        .subarray(0, 6)
        .toString()
        .match(/^GIF8[79]a$/)
    )
      mime = "image/gif";
    else if (
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP"
    )
      mime = "image/webp";
    else throw Error("仅支持 PNG、JPEG、WebP、GIF 图片。");
    const id = createHash("sha256").update(buffer).digest("hex");
    const asset = {
      id,
      name: path.basename(name).slice(0, 250),
      mime,
      size: buffer.length,
    };
    const existing = this.state.assets.find((a) => a.id === id);
    if (existing) return existing;
    fs.writeFileSync(path.join(this.directory, "assets", id), buffer, {
      mode: 0o600,
    });
    this.change((s) => s.assets.unshift(asset));
    return asset;
  }
  deleteAsset(id: string) {
    const asset = this.state.assets.find((a) => a.id === id);
    if (!asset) throw Error("图片不存在或已经删除。");
    const reference = `asset://${id}`;
    const used = this.state.articles.find(
      (a) =>
        a.markdown.includes(reference) ||
        Object.values(a.overrides).some((v) =>
          v?.markdown.includes(reference),
        ) ||
        a.history.some((v) => v.markdown.includes(reference)),
    );
    if (used)
      throw Error(
        `图片被文章「${used.title || "未命名文章"}」或其历史版本引用，暂不能删除。`,
      );
    if (this.state.jobs.some((j) => j.snapshot.markdown.includes(reference)))
      throw Error("图片被分发任务快照引用，暂不能删除。");
    // Retain a recoverable original without including deleted images in workspace backups.
    const source = path.join(this.directory, "assets", id);
    const trash = path.join(this.directory, "deleted-assets");
    fs.mkdirSync(trash, { recursive: true, mode: 0o700 });
    const target = path.join(
      trash,
      `${randomUUID()}.${asset.mime.split("/")[1]}`,
    );
    const exists = fs.existsSync(source);
    if (exists) fs.renameSync(source, target);
    try {
      this.change((s) => {
        s.assets = s.assets.filter((a) => a.id !== id);
      });
    } catch (error) {
      if (exists) fs.renameSync(target, source);
      throw error;
    }
  }
  assetData(asset: Asset) {
    return `data:${asset.mime};base64,${fs.readFileSync(path.join(this.directory, "assets", asset.id)).toString("base64")}`;
  }
  assetBuffer(asset: Asset) {
    return fs.readFileSync(path.join(this.directory, "assets", asset.id));
  }
}
