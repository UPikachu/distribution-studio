import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FillRequest, FillResult } from "../../electron/inject";

let app: ElectronApplication, page: Page, directory: string;
const request: FillRequest = {
  mode: "fill",
  platform: "wechat",
  title: "公众号填充自测",
  html: "<p>正文与<strong>重点</strong>。</p>",
  text: "正文与重点。",
  markdown: "正文与**重点**。",
  images: [],
};
test.beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wechat-"));
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: directory },
  });
  page = await app.firstWindow();
  await expect(page.getByText("本地工作区已连接")).toBeVisible();
  const opened = app.waitForEvent("window");
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await win.loadURL("about:blank");
  });
  page = await opened;
});
test.afterEach(async () => {
  await app?.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
async function fixture(body: string) {
  await page.setContent('<textarea id="title"></textarea>' + body);
  await page.addScriptTag({ path: "dist-electron/inject.js" });
}
async function run(mode: FillRequest["mode"] = "fill"): Promise<FillResult> {
  return page.evaluate((r) => (window as any).StudioAdapter.run(r), {
    ...request,
    mode,
  });
}

const riskText =
  "当前使用的浏览器插件存在安全隐患，可能影响编辑器功能的正常使用，请禁用插件并联系插件开发者处理。";
const riskDialog = `<div role="dialog"><p>${riskText}</p><button>我知道了</button></div>`;
async function noticeRun(
  overrides: Partial<FillRequest> = {},
): Promise<FillResult> {
  return page.evaluate((r) => (window as any).StudioAdapter.run(r), {
    ...request,
    mode: "probe",
    runId: "notice-test",
    ...overrides,
  });
}
async function dismissOnClick() {
  await page.locator('[role="dialog"] button').evaluate((button) => {
    button.addEventListener("click", () => {
      (window as any).noticeClicks = ((window as any).noticeClicks ?? 0) + 1;
      button.closest('[role="dialog"]')!.remove();
    });
  });
}

test("公众号弹窗：准确关闭，同一任务再次出现时停止且不重复点击", async () => {
  await fixture(riskDialog);
  await dismissOnClick();
  expect((await noticeRun()).notice).toContain("确认弹窗已关闭");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(
    (html) => document.body.insertAdjacentHTML("beforeend", html),
    riskDialog,
  );
  await dismissOnClick();
  expect(await noticeRun()).toMatchObject({ blocked: true });
  expect(await page.evaluate(() => (window as any).noticeClicks)).toBe(1);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("公众号弹窗：不处理其他提示、正文中的相同内容及其他平台", async () => {
  await fixture(riskDialog.replace(riskText, "其他提示"));
  await dismissOnClick();
  expect((await noticeRun()).notice).toBeUndefined();
  await expect(page.getByRole("dialog")).toBeVisible();
  await fixture(`<div contenteditable="true">${riskDialog}</div>`);
  await dismissOnClick();
  expect((await noticeRun()).notice).toBeUndefined();
  await expect(page.getByRole("dialog")).toBeVisible();
  await fixture(riskDialog);
  await dismissOnClick();
  expect((await noticeRun({ platform: "zhihu" })).notice).toBeUndefined();
  expect((await noticeRun({ runId: undefined })).notice).toBeUndefined();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("公众号弹窗：点击后仍未关闭则停止填充，保留原稿", async () => {
  await fixture(
    riskDialog +
      '<div class="edui-body-container" contenteditable="true">原有正文</div>',
  );
  const result = await noticeRun({ mode: "fill" });
  expect(result).toMatchObject({
    blocked: true,
    titleFilled: false,
    bodyFilled: false,
  });
  expect(result.notice).toContain("未能关闭弹窗");
  await expect(page.locator("#title")).toHaveValue("");
  await expect(page.locator(".edui-body-container")).toHaveText("原有正文");
});

test("公众号弹窗：按钮不唯一时不点击并停止", async () => {
  await fixture(
    riskDialog.replace("</div>", "<button>我知道了</button></div>"),
  );
  await page.locator('[role="dialog"]').evaluate((dialog) => {
    dialog.addEventListener("click", () => dialog.remove());
  });
  expect(await noticeRun()).toMatchObject({ blocked: true });
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("公众号弹窗：填充后延迟出现时关闭，保留已填正文", async () => {
  await fixture(
    '<div class="edui-body-container" contenteditable="true" style="height:200px"></div>',
  );
  await page.locator(".edui-body-container").evaluate((body, html) => {
    body.addEventListener(
      "input",
      () => {
        setTimeout(() => {
          document.body.insertAdjacentHTML("beforeend", html);
          const dialog = document.querySelector('[role="dialog"]')!;
          dialog
            .querySelector("button")!
            .addEventListener("click", () => dialog.remove());
        }, 200);
      },
      { once: true },
    );
  }, riskDialog);
  const result = await noticeRun({ mode: "fill" });
  expect(result).toMatchObject({ titleFilled: true, bodyFilled: true });
  expect(result.notice).toContain("确认弹窗已关闭");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".edui-body-container")).toHaveText("正文与重点。");
});

test("公众号：识别 edui 正文并保留富文本，重复填充不重复插入", async () => {
  await fixture(
    '<div class="edui-body-container" contenteditable="true" style="height:200px"></div>',
  );
  expect(await run("probe")).toMatchObject({
    titleFound: true,
    bodyFound: true,
  });
  expect(await run()).toMatchObject({ titleFilled: true, bodyFilled: true });
  await expect(page.locator("strong")).toHaveText("重点");
  expect(await run()).toMatchObject({ titleFilled: true, bodyFilled: true });
  await expect(page.locator(".edui-body-container")).toHaveText("正文与重点。");
});

test("公众号：跳过带工具栏的 ueditor 外壳，填入内部正文", async () => {
  await fixture(
    '<div id="ueditor_0"><div>工具栏</div><div class="edui-body-container" contenteditable="true" style="height:200px"></div></div>',
  );
  expect(await run("inspect")).toMatchObject({
    bodyFound: true,
    conflict: false,
  });
  expect(await run()).toMatchObject({ bodyFilled: true });
  await expect(page.locator(".edui-body-container")).toHaveText("正文与重点。");
});

test("公众号：iframe 外壳不应被当成可写正文", async () => {
  await fixture('<iframe id="ueditor_0" style="height:200px"></iframe>');
  expect(await run("probe")).toMatchObject({
    titleFound: true,
    bodyFound: false,
  });
});

test("公众号新版：标题和正文同为 ProseMirror，忽略正文提示节点", async () => {
  await fixture(`<style>#title { display:none }</style>
    <div contenteditable="true" class="ProseMirror" data-placeholder="请在这里输入标题"><br></div>
    <div contenteditable="true" class="ProseMirror" id="article-body" style="min-height:300px">
      <div class="editor_content_placeholder ProseMirror-widget" contenteditable="false">从这里开始写正文</div><section><span><br></span></section>
    </div>`);
  expect(await run("probe")).toMatchObject({
    titleFound: true,
    bodyFound: true,
  });
  expect(await run("inspect")).toMatchObject({ conflict: false });
  await page.locator("#article-body").evaluate((body) => {
    body.addEventListener("paste", (event) => {
      event.preventDefault();
      document.execCommand(
        "insertText",
        false,
        (event as ClipboardEvent).clipboardData!.getData("text/plain"),
      );
    });
  });
  const filled = await run();
  expect(filled, await page.locator("#article-body").innerHTML()).toMatchObject(
    { titleFilled: true, bodyFilled: true },
  );
  await expect(page.locator('[data-placeholder*="标题"]')).toHaveText(
    "公众号填充自测",
  );
  await expect(page.locator("#article-body strong")).toHaveText("重点");
  expect(await run()).toMatchObject({ titleFilled: true, bodyFilled: true });
});

test("公众号：预检发现已有正文，保留原稿和空白标题", async () => {
  await fixture(
    '<div class="edui-body-container" contenteditable="true" style="height:200px">原有正文</div>',
  );
  expect(await run("inspect")).toMatchObject({
    bodyFound: true,
    conflict: true,
  });
  await expect(page.locator(".edui-body-container")).toHaveText("原有正文");
  await expect(page.locator("#title")).toHaveValue("");
});
