import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
let client: ElectronApplication, page: Page, data: string;
async function launch() {
  client = await electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
    timeout: 45000,
  });
  page = await client.firstWindow();
  await expect(page.getByText("本地工作区已连接")).toBeVisible();
}
test.beforeEach(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-e2e-"));
  await launch();
});
test.afterEach(async () => {
  await client?.close();
  fs.rmSync(data, { recursive: true, force: true });
});
test("编辑、平台稿、图片、重启与导出备份", async () => {
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("文章标题").fill("链上说明书：一份主稿，多平台表达");
  await page
    .getByLabel("文章正文")
    .fill(
      "## 为什么保留主稿？\n\n核心事实保持一致，表达可以不同。\n\n```js\nconst draft = true;\n```",
    );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存 · v1")).toBeVisible();
  await page.getByRole("button", { name: "平台稿", exact: true }).click();
  await page.getByLabel("文章标题").fill("公众号的专用标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "基础主稿", exact: true }).click();
  await expect(page.getByLabel("文章标题")).toHaveValue(
    "链上说明书：一份主稿，多平台表达",
  );
  await expect(page.locator(".preview-paper h2")).toHaveText(
    "公众号的专用标题",
  );
  await page.screenshot({ path: "test-results/editor.png", fullPage: true });
  // Native file dialog is stubbed; the actual main-process importer and filesystem are exercised.
  const imagePath = path.join(data, "pixel.png");
  fs.writeFileSync(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await client.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, imagePath);
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await page
    .getByRole("button", { name: "导入图片", exact: true })
    .first()
    .click();
  await expect(page.getByText("pixel.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "插入当前稿件" }).click();
  await expect(page.getByLabel("文章正文")).toHaveValue(/asset:\/\//);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const zipPath = path.join(data, "bundle.zip");
  await client.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, zipPath);
  await page.getByRole("button", { name: "导出分发包" }).click();
  await expect.poll(() => fs.existsSync(zipPath)).toBe(true);
  const { unzipSync, strFromU8 } = await import("fflate");
  const zip = unzipSync(fs.readFileSync(zipPath));
  expect(Object.keys(zip).filter((k) => k.endsWith("article.md"))).toHaveLength(
    10,
  );
  expect(strFromU8(zip["wechat/article.md"])).toContain("公众号的专用标题");
  expect(Object.keys(zip).some((k) => k.startsWith("assets/"))).toBe(true);
  const backupPath = path.join(data, "backup.json");
  await client.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, backupPath);
  await page.getByRole("button", { name: "设置与备份", exact: true }).click();
  await page.getByRole("button", { name: "导出完整备份" }).click();
  await expect.poll(() => fs.existsSync(backupPath)).toBe(true);
  expect(
    JSON.parse(fs.readFileSync(backupPath, "utf8")).state.articles,
  ).toHaveLength(1);
  await client.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, backupPath);
  await page.getByRole("button", { name: "从备份恢复" }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.settings
          .queuePaused,
    )
    .toBe(true);
  await client.close();
  await launch();
  await expect(page.getByLabel("文章标题")).toHaveValue(
    "链上说明书：一份主稿，多平台表达",
  );
  await expect(page.getByLabel("文章正文")).toHaveValue(/asset:\/\//);
});
test("真实 Electron 窗口：队列填充、重复拦截与人工登记", async () => {
  await page.getByRole("button", { name: "平台账号", exact: true }).click();
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await page.getByLabel("账号平台").selectOption("zhihu");
  await page.getByLabel("账号名称").fill("本地验收账号");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加账号", exact: true })
    .click();
  const account = (await page.evaluate(() => window.studio.bootstrap())).state
    .accounts[0];
  await client.evaluate(
    ({ session }, { id }) => {
      session
        .fromPartition(`persist:account-${id}`)
        .protocol.handle(
          "https",
          () =>
            new Response(
              '<!doctype html><meta charset="utf-8"><style>textarea{width:500px;height:50px}.public-DraftEditor-content{min-height:400px;border:1px solid #ccc}</style><textarea placeholder="请输入标题"></textarea><div class="public-DraftEditor-content" contenteditable="true"></div><button id="publish">发布</button><script>window.publishClicks=0;document.querySelector("button").onclick=()=>window.publishClicks++;</script>',
              { headers: { "content-type": "text/html" } },
            ),
        );
    },
    { id: account.id },
  );
  await page.getByRole("button", { name: "内容工作台", exact: true }).click();
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("文章标题").fill("平台填充验收");
  await page
    .getByLabel("文章正文")
    .fill("## 完整正文\n\n测试强调 **内容** 与列表。\n\n- 第一步\n- 第二步");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "分发", exact: true }).click();
  await page.getByRole("button", { name: "创建 1 个任务" }).click();
  await expect(page.getByText("待检查发布", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const remote = client.windows().find((p) => p !== page)!;
  expect(
    await client.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) =>
        w.getTitle().includes("本地验收账号"),
      ),
    ),
  ).toBe(true);
  await expect(remote.locator("textarea")).toHaveValue("平台填充验收");
  await expect(remote.locator("[contenteditable]")).toContainText("第一步");
  expect(
    await remote.evaluate(() => ({
      node: typeof (window as any).require,
      bridge: typeof (window as any).studio,
      clicks: (window as any).publishClicks,
    })),
  ).toEqual({ node: "undefined", bridge: "undefined", clicks: 0 });
  const dataState = (await page.evaluate(() => window.studio.bootstrap()))
    .state;
  const err = await page.evaluate(
    async ({ id, accountId }) => {
      try {
        await window.studio.command({
          type: "queue.add",
          articleId: id,
          accountIds: [accountId],
          scheduledAt: null,
        });
        return "";
      } catch (e) {
        return String(e);
      }
    },
    { id: dataState.articles[0].id, accountId: account.id },
  );
  expect(err).toContain("相同");
  await page.getByRole("button", { name: "登记已发布" }).click();
  await page
    .getByLabel("已发布文章链接")
    .fill("https://zhuanlan.zhihu.com/p/123");
  await page.getByRole("button", { name: "确认登记" }).click();
  await expect(page.getByText("已人工确认发布", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/tasks.png", fullPage: true });
});
test("已有草稿不覆盖", async () => {
  const state = await page.evaluate(async () => {
    const a = await window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "冲突测试",
    });
    return a;
  });
  const account = state.accounts[0];
  await client.evaluate(({ session }, id) => {
    session
      .fromPartition(`persist:account-${id}`)
      .protocol.handle(
        "https",
        () =>
          new Response(
            '<meta charset="utf-8"><textarea placeholder="标题">不能覆盖的原稿</textarea><div class="public-DraftEditor-content" contenteditable="true" style="height:200px">旧正文</div>',
            { headers: { "content-type": "text/html" } },
          ),
      );
  }, account.id);
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("文章标题").fill("新的标题");
  await page.getByLabel("文章正文").fill("新的正文");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "分发", exact: true }).click();
  await page.getByRole("button", { name: "创建 1 个任务" }).click();
  await expect(
    page.getByText("标题栏已有其他内容，未覆盖。", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const remote = client.windows().find((p) => p !== page)!;
  await expect(remote.locator("textarea")).toHaveValue("不能覆盖的原稿");
  await expect(remote.locator("[contenteditable]")).toHaveText("旧正文");
});

test("九个平台夹具与 CSDN 跨域 iframe：同一任务链路", async () => {
  const setup = await page.evaluate(async () => {
    await window.studio.command({ type: "queue.pause", paused: true });
    const platformIds = [
      "wechat",
      "zhihu",
      "csdn",
      "xiaohongshu",
      "baijiahao",
      "sohu",
      "toutiao",
      "netease",
      "jianshu",
    ] as const;
    let s;
    for (const platform of platformIds)
      s = await window.studio.command({
        type: "account.add",
        platform,
        name: platform + " 验收",
      });
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    await window.studio.command({
      type: "article.save",
      article: {
        id,
        title: "九平台兼容检查",
        markdown: "## 一个步骤\n\n正文与 **重点**。",
        collection: "其他",
        tags: [],
        createdAt: now,
        updatedAt: now,
        revision: 1,
        history: [],
        overrides: {
          xiaohongshu: {
            title: "短稿配图检查",
            markdown:
              "一段清晰的短稿。\n\n![配图](https://example.com/image.png)",
          },
        },
      },
    });
    return { accounts: s!.accounts, id };
  });
  for (const a of setup.accounts)
    await client.evaluate(({ session }, a) => {
      session
        .fromPartition(`persist:account-${a.id}`)
        .protocol.handle("https", (request) => {
          const title =
            '<textarea id="title" placeholder="请输入标题" style="width:500px;height:50px"></textarea>';
          let body =
            '<div class="ProseMirror" contenteditable="true" style="height:300px"></div>';
          if (a.platform === "zhihu")
            body =
              '<div class="public-DraftEditor-content" contenteditable="true" style="height:300px"></div>';
          if (a.platform === "sohu" || a.platform === "netease")
            body =
              '<div class="ql-editor" contenteditable="true" style="height:300px"></div>';
          if (a.platform === "jianshu")
            body =
              '<textarea id="content" style="height:300px;width:500px"></textarea>';
          if (a.platform === "csdn") {
            if (request.url.includes("editor.csdn.net"))
              return new Response(
                '<meta charset="utf-8"><body contenteditable="true" style="min-height:300px"></body>',
                { headers: { "content-type": "text/html" } },
              );
            body =
              '<iframe src="https://editor.csdn.net/editor" style="height:400px;width:600px"></iframe>';
          }
          return new Response('<meta charset="utf-8">' + title + body, {
            headers: { "content-type": "text/html" },
          });
        });
    }, a);
  await page.evaluate(async (setup) => {
    await window.studio.command({
      type: "queue.add",
      articleId: setup.id,
      accountIds: setup.accounts.map((a) => a.id),
      scheduledAt: null,
    });
    await window.studio.command({ type: "queue.pause", paused: false });
  }, setup);
  await expect
    .poll(
      async () => {
        const s = (await page.evaluate(() => window.studio.bootstrap())).state;
        return s.jobs.map((j) => [j.platform, j.status]).sort();
      },
      { timeout: 45000 },
    )
    .toEqual(setup.accounts.map((a) => [a.platform, "awaiting_review"]).sort());
  const csdn = client.windows().find((p) => p.url().includes("mp.csdn.net"))!;
  await expect(csdn.frameLocator("iframe").locator("body")).toContainText(
    "正文与",
  );
});

test("未登录时可暂停、继续，账号会话彼此隔离", async () => {
  const s = await page.evaluate(async () => {
    await window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "账号 A",
    });
    return window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "账号 B",
    });
  });
  for (const a of s.accounts)
    await client.evaluate(({ session }, id) => {
      session.fromPartition(`persist:account-${id}`).protocol.handle(
        "https",
        () =>
          new Response("<h1>请登录</h1>", {
            headers: { "content-type": "text/html" },
          }),
      );
    }, a.id);
  await client.evaluate(async ({ session }, accounts) => {
    await session
      .fromPartition(`persist:account-${accounts[0].id}`)
      .cookies.set({
        url: "https://zhuanlan.zhihu.com",
        name: "test-session",
        value: "account-a",
      });
  }, s.accounts);
  expect(
    await client.evaluate(
      async ({ session }, id) =>
        (
          await session
            .fromPartition(`persist:account-${id}`)
            .cookies.get({ name: "test-session" })
        ).length,
      s.accounts[1].id,
    ),
  ).toBe(0);
  const id = await page.evaluate(async (accountId) => {
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    await window.studio.command({
      type: "article.save",
      article: {
        id,
        title: "登录恢复测试",
        markdown: "正文",
        collection: "其他",
        tags: [],
        createdAt: now,
        updatedAt: now,
        revision: 1,
        history: [],
        overrides: {},
      },
    });
    await window.studio.command({
      type: "queue.add",
      articleId: id,
      accountIds: [accountId],
      scheduledAt: null,
    });
    return id;
  }, s.accounts[0].id);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .status,
      { timeout: 25000 },
    )
    .toBe("needs_attention");
  const remote = client.windows().find((p) => p !== page)!;
  await remote.setContent(
    '<textarea placeholder="标题"></textarea><div class="public-DraftEditor-content" contenteditable="true" style="height:200px"></div>',
  );
  await page.evaluate(async () => {
    const s = (await window.studio.bootstrap()).state;
    await window.studio.command({ type: "queue.pause", paused: true });
    await window.studio.command({ type: "job.retry", id: s.jobs[0].id });
  });
  await page.waitForTimeout(2000);
  expect(
    (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0].status,
  ).toBe("queued");
  await page.evaluate(() =>
    window.studio.command({ type: "queue.pause", paused: false }),
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .status,
      { timeout: 15000 },
    )
    .toBe("awaiting_review");
  await expect(remote.locator("textarea")).toHaveValue("登录恢复测试");
});

test("正文冲突预检不先改标题；框架回滚不能误报成功", async () => {
  const s = await page.evaluate(() =>
    window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "回读测试",
    }),
  );
  const a = s.accounts[0];
  await client.evaluate(({ session }, id) => {
    session
      .fromPartition(`persist:account-${id}`)
      .protocol.handle(
        "https",
        () =>
          new Response(
            '<meta charset="utf-8"><textarea placeholder="标题"></textarea><div class="public-DraftEditor-content" contenteditable="true" style="height:200px">原有正文</div>',
            { headers: { "content-type": "text/html" } },
          ),
      );
  }, a.id);
  await page.evaluate(async (accountId) => {
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    await window.studio.command({
      type: "article.save",
      article: {
        id,
        title: "新标题",
        markdown: "新正文",
        collection: "其他",
        tags: [],
        createdAt: now,
        updatedAt: now,
        revision: 1,
        history: [],
        overrides: {},
      },
    });
    await window.studio.command({
      type: "queue.add",
      articleId: id,
      accountIds: [accountId],
      scheduledAt: null,
    });
  }, a.id);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .status,
      { timeout: 15000 },
    )
    .toBe("needs_attention");
  const remote = client.windows().find((p) => p !== page)!;
  await expect(remote.locator("textarea")).toHaveValue("");
  await remote.evaluate(() => {
    const el = document.querySelector("[contenteditable]")!;
    el.textContent = "";
    el.addEventListener("input", () =>
      setTimeout(() => (el.textContent = ""), 50),
    );
  });
  await page.evaluate(async () => {
    const s = (await window.studio.bootstrap()).state;
    await window.studio.command({ type: "job.retry", id: s.jobs[0].id });
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .message,
      { timeout: 15000 },
    )
    .toContain("填充回读未通过");
});
