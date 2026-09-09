import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import { makePreview, cleanHtml, htmlDocument } from "../electron/content";
import { parseCommand } from "../electron/commands";
import { newArticle, allowedPlatformUrl, platformIds } from "../src/domain";
const dirs: string[] = [];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-unit-"));
  dirs.push(dir);
  const store = new Store(dir);
  const article = newArticle();
  article.title = "教程与示例";
  article.markdown = "## 步骤\n\n正文 **重点**\n\n```js\nconst a = 1;\n```";
  store.save(article);
  store.change((s) =>
    s.accounts.push({
      id: randomUUID(),
      platform: "zhihu",
      name: "测试号",
      status: "unknown",
    }),
  );
  return {
    store,
    article: store.article(article.id),
    account: store.state.accounts[0],
    dir,
  };
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
describe("持久化和版本", () => {
  it("重启后恢复文章、账号和版本", () => {
    const { store, article, dir } = setup();
    store.save({ ...article, title: "更新标题" });
    const reopened = new Store(dir);
    expect(reopened.article(article.id).title).toBe("更新标题");
    expect(reopened.article(article.id).history[0].title).toBe("教程与示例");
    expect(fs.existsSync(path.join(dir, "workspace.json.bak"))).toBe(true);
  });
  it("拒绝陈旧版本覆盖", () => {
    const { store, article } = setup();
    store.save({ ...article, title: "新稿" });
    expect(() => store.save({ ...article, title: "旧稿" })).toThrow("更新");
    expect(store.article(article.id).title).toBe("新稿");
  });
  it("坏数据不会被默默重置", () => {
    const { dir } = setup();
    fs.writeFileSync(path.join(dir, "workspace.json"), "broken");
    expect(() => new Store(dir)).toThrow();
    expect(fs.readFileSync(path.join(dir, "workspace.json"), "utf8")).toBe(
      "broken",
    );
  });
  it("中断任务恢复为待检查，禁止自动重放", () => {
    const { store, article, account, dir } = setup();
    store.enqueue(article.id, [account.id], null);
    store.updateJob(store.state.jobs[0].id, { status: "running" }, "执行中");
    const reopened = new Store(dir);
    expect(reopened.state.jobs[0].status).toBe("needs_attention");
  });
  it("无效事务不污染内存与磁盘", () => {
    const { store, dir } = setup();
    const before = fs.readFileSync(path.join(dir, "workspace.json"), "utf8");
    expect(() =>
      store.change((s) => {
        s.accounts[0].name = "";
      }),
    ).toThrow();
    expect(store.state.accounts[0].name).toBe("测试号");
    expect(fs.readFileSync(path.join(dir, "workspace.json"), "utf8")).toBe(
      before,
    );
  });
});
describe("任务快照与去重", () => {
  it("修改主稿不改变队列内容", () => {
    const { store, article, account } = setup();
    store.enqueue(article.id, [account.id], null);
    store.save({ ...article, markdown: "后来修改" });
    expect(store.state.jobs[0].snapshot.markdown).toBe(article.markdown);
  });
  it("相同内容重复提交被拒绝，取消后可重建", () => {
    const { store, article, account } = setup();
    store.enqueue(article.id, [account.id], null);
    expect(() => store.enqueue(article.id, [account.id], null)).toThrow("相同");
    store.updateJob(store.state.jobs[0].id, { status: "cancelled" }, "取消");
    store.enqueue(article.id, [account.id], null);
    expect(store.state.jobs).toHaveLength(2);
  });
  it("批量创建发生错误时原子回滚", () => {
    const { store, article, account } = setup();
    expect(() =>
      store.enqueue(article.id, [account.id, randomUUID()], null),
    ).toThrow();
    expect(store.state.jobs).toHaveLength(0);
  });
  it("预约时间必须在未来", () => {
    const { store, article, account } = setup();
    expect(() =>
      store.enqueue(article.id, [account.id], "2020-01-01"),
    ).toThrow();
    store.enqueue(
      article.id,
      [account.id],
      new Date(Date.now() + 60000).toISOString(),
    );
    expect(store.state.jobs[0].scheduledAt).not.toBeNull();
  });
  it("小红书不直接接受未适配主稿", () => {
    const { store, article, account } = setup();
    store.change((s) => {
      s.accounts[0].platform = "xiaohongshu";
    });
    expect(() => store.enqueue(article.id, [account.id], null)).toThrow(
      "独立短稿",
    );
  });
  it("正式发布必须由待检查状态登记同平台链接", () => {
    const { store, article, account } = setup();
    store.enqueue(article.id, [account.id], null);
    const id = store.state.jobs[0].id;
    expect(() => store.confirm(id, "https://zhuanlan.zhihu.com/p/123")).toThrow(
      "当前",
    );
    store.updateJob(id, { status: "awaiting_review" }, "待检查");
    expect(() => store.confirm(id, "https://example.com")).toThrow("平台");
    store.confirm(id, "https://zhuanlan.zhihu.com/p/123");
    expect(store.job(id).status).toBe("published");
  });
});
describe("内容适配与隔离", () => {
  it("平台独立稿不会修改主稿", async () => {
    const { store, article } = setup();
    const a = {
      ...article,
      overrides: {
        zhihu: { title: "为什么这样做？", markdown: "知乎专用正文" },
      },
    };
    expect((await makePreview(a, "zhihu", [], () => "")).title).toBe(
      "为什么这样做？",
    );
    expect((await makePreview(a, "web", [], () => "")).title).toBe(
      article.title,
    );
  });
  it("代码块与表格保留，公众号增加内联排版", async () => {
    const a = newArticle();
    a.markdown =
      '```js\nconst a = "<script>";\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    const p = await makePreview(a, "wechat", [], () => "");
    expect(p.html).toContain("<table");
    expect(p.html).toContain("style=");
    expect(p.html).toContain("&lt;script&gt;");
    expect(p.html).not.toContain("<script>");
  });
  it("脚本、事件、危险协议和 SVG 不进入预览", () => {
    const html = cleanHtml(
      '<script>alert(1)</script><img src="data:image/svg+xml;base64,xxx" onerror="alert(1)"><a href="javascript:alert(1)">a</a><iframe src="file:///etc/passwd"></iframe>',
    );
    expect(html).not.toMatch(/script|onerror|svg|iframe|javascript|file:/);
  });
  it("缺失本地图片给出明确提示", async () => {
    const a = newArticle();
    a.markdown = `![image](asset://${"a".repeat(64)})`;
    expect((await makePreview(a, "web", [], () => "")).warnings).toContain(
      "有本地图片缺失，请重新导入。",
    );
  });
  it("小红书长稿提示不会截断内容", async () => {
    const a = newArticle();
    a.title = "长标题".repeat(10);
    a.markdown = "长正文".repeat(500);
    const p = await makePreview(a, "xiaohongshu", [], () => "");
    expect(p.markdown).toBe(a.markdown);
    expect(p.warnings.length).toBeGreaterThanOrEqual(4);
  });
  it.each(platformIds)("%s 可以生成预览", async (p) => {
    const a = newArticle();
    a.title = "测试";
    a.markdown = "测试正文";
    const v = await makePreview(a, p, [], () => "");
    expect(v.text).toBe("测试正文");
  });
  it("导出标题不会执行 HTML", () => {
    expect(
      htmlDocument("<img src=x onerror=alert(1)>", "<p>ok</p>"),
    ).not.toContain("onerror");
  });
});
describe("图片与请求边界", () => {
  it("图片按内容去重", () => {
    const { store } = setup();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const a = store.addAsset(png, "a.png");
    const b = store.addAsset(png, "b.png");
    expect(a.id).toBe(b.id);
    expect(store.state.assets).toHaveLength(1);
    expect(store.assetData(a)).toMatch(/^data:image\/png;base64,/);
  });
  it("拒绝伪图片和路径文件名", () => {
    const { store } = setup();
    expect(() =>
      store.addAsset(Buffer.from("<script>bad</script>"), "a.png"),
    ).toThrow("支持");
  });
  it.each([
    "file:///tmp/a",
    "javascript:alert(1)",
    "https://zhihu.com.evil.com/a",
    "http://zhihu.com",
    "https://user:pass@zhihu.com",
  ])("拒绝不安全平台链接 %s", (url) => {
    expect(allowedPlatformUrl("zhihu", url)).toBe(false);
  });
  it("接受正确子域", () => {
    expect(allowedPlatformUrl("zhihu", "https://zhuanlan.zhihu.com/p/1")).toBe(
      true,
    );
  });
  it("拒绝未知 IPC 和额外字段", () => {
    expect(() => parseCommand({ type: "run.shell", cmd: "test" })).toThrow();
    expect(() => parseCommand({ type: "data.open", path: "/etc" })).toThrow();
  });
});

describe("素材删除保护", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  it("未引用素材移入回收目录，重启后不再出现在素材库", () => {
    const { store, dir } = setup();
    const asset = store.addAsset(png, "image.png");
    store.deleteAsset(asset.id);
    expect(new Store(dir).state.assets).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "assets", asset.id))).toBe(false);
    const files = fs.readdirSync(path.join(dir, "deleted-assets"));
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, "deleted-assets", files[0]))).toEqual(
      png,
    );
  });
  it("主稿、独立平台稿、历史版本、任务快照中的引用都阻止删除", () => {
    for (const kind of ["main", "override", "history", "job"]) {
      const { store, article } = setup();
      const asset = store.addAsset(png, "image.png");
      const markdown = `![图](asset://${asset.id})`;
      store.change((s) => {
        const a = s.articles[0];
        if (kind === "main") a.markdown = markdown;
        if (kind === "override")
          a.overrides.zhihu = { title: "平台稿", markdown };
        if (kind === "history")
          a.history.push({
            revision: 1,
            title: "旧稿",
            markdown,
            at: new Date().toISOString(),
          });
      });
      if (kind === "job") {
        // Exercise a real queued snapshot via the existing store API.
        const a = structuredClone(store.article(article.id));
        a.markdown = markdown;
        store.save(a);
        store.enqueue(a.id, [store.state.accounts[0].id], null);
        store.change((s) => {
          s.articles[0].markdown = "";
          s.articles[0].history = [];
        });
      }
      expect(() => store.deleteAsset(asset.id)).toThrow(/引用/);
      expect(store.state.assets).toHaveLength(1);
      expect(store.assetBuffer(asset)).toEqual(png);
    }
  });
});
