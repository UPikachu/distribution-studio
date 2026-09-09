import { test, expect, _electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
test("生图设置加密、导出导入与生成图片插入文章", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-image-e2e-"));
  const app = await _electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("本地工作区已连接")).toBeVisible();
    await page.getByRole("button", { name: "新建文章", exact: true }).click();
    await page.getByLabel("文章标题").fill("生成图片验收");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText(/已保存 · v/)).toBeVisible();
    await page.getByRole("button", { name: "设置与备份", exact: true }).click();
    await page.getByLabel("MiniMax API Key").fill("mock-private-key");
    await page.getByLabel("默认生图服务").selectOption("minimax");
    await page
      .getByRole("button", { name: "保存生图配置", exact: true })
      .click();
    await expect(
      page.getByText("生图配置已保存。", { exact: true }),
    ).toBeVisible();
    expect(
      fs.readFileSync(path.join(data, "image-providers.user.json"), "utf8"),
    ).not.toContain("mock-private-key");
    expect(
      JSON.stringify(
        await page.evaluate(() => window.studio.imageConfig({ type: "get" })),
      ),
    ).not.toContain("mock-private-key");
    const dest = path.join(data, "export.user.json");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, dest);
    await page
      .getByRole("button", { name: "导出生图配置", exact: true })
      .click();
    await expect.poll(() => fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, "utf8")).not.toContain("mock-private-key");
    await page.getByLabel("导出包含明文密钥", { exact: false }).check();
    await page
      .getByRole("button", { name: "导出生图配置", exact: true })
      .click();
    await expect
      .poll(() => fs.readFileSync(dest, "utf8").includes("mock-private-key"))
      .toBe(true);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, dest);
    await page
      .getByRole("button", { name: "导入生图配置", exact: true })
      .click();
    await expect(
      page.getByText("已读取当前配置。", { exact: true }),
    ).toBeVisible();
    await app.evaluate(() => {
      globalThis.fetch = async (_input, init) => {
        if (!(init?.headers as any)?.Authorization) throw Error("Missing auth");
        return new Response(
          JSON.stringify({
            base_resp: { status_code: 0 },
            data: {
              image_base64: [
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
              ],
            },
          }),
        );
      };
    });
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await expect(page.locator(".image-price-hint")).toContainText(
      "约 ¥0.025 / 张",
    );
    await page.getByLabel("配图描述").fill("青绿色钱包概念图");
    await page
      .getByRole("button", { name: "生成 1 张配图", exact: true })
      .click();
    await expect(
      page.getByText("图片已加入素材库", { exact: false }),
    ).toBeVisible();
    await expect(page.locator(".asset-card img")).toHaveCount(1);
    await page
      .getByRole("button", { name: "插入当前稿件", exact: true })
      .click();
    await expect(page.getByLabel("文章正文")).toHaveValue(/asset:\/\//);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText(/已保存 · v/)).toBeVisible();
    const workspace = JSON.stringify(
      (await page.evaluate(() => window.studio.bootstrap())).state,
    );
    expect(workspace).not.toContain("mock-private-key");
    expect(fs.readdirSync(path.join(data, "image-history"))).toHaveLength(1);
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test("生图平台与每个平台的模型：未生成也保存，切页和重启后恢复", async () => {
  const data = fs.mkdtempSync(
    path.join(os.tmpdir(), "studio-image-selection-"),
  );
  const launch = () =>
    _electron.launch({
      args: ["."],
      env: { ...process.env, STUDIO_DATA_DIR: data },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await expect(page.getByLabel("生图服务", { exact: true })).toBeEnabled();
    await page.getByLabel("生图服务", { exact: true }).selectOption("ark");
    await expect(page.getByLabel("生图模型")).toBeEnabled();
    await page
      .getByLabel("生图模型")
      .selectOption("doubao-seedream-4-5-251128");
    await expect(page.getByLabel("生图模型")).toHaveValue(
      "doubao-seedream-4-5-251128",
    );
    await page.getByLabel("生图服务", { exact: true }).selectOption("aliyun");
    await expect(page.getByLabel("生图模型")).toHaveValue("qwen-image-3.0");
    await page.getByLabel("生图模型").selectOption("qwen-image-3.0-pro");
    await expect(page.getByLabel("生图模型")).toHaveValue("qwen-image-3.0-pro");
    await expect(page.locator(".image-price-hint")).toContainText(
      "约 ¥0.25 / 张",
    );
    await page.getByLabel("生图服务", { exact: true }).selectOption("ark");
    await expect(page.getByLabel("生图模型")).toHaveValue(
      "doubao-seedream-4-5-251128",
    );
    await page
      .getByLabel("生图模型")
      .selectOption("doubao-seedream-5-0-260128");
    await expect(page.getByLabel("生图模型")).toHaveValue(
      "doubao-seedream-5-0-260128",
    );
    await page.getByRole("button", { name: "设置与备份", exact: true }).click();
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await expect(page.getByLabel("生图服务", { exact: true })).toHaveValue(
      "ark",
    );
    await expect(page.getByLabel("生图模型")).toHaveValue(
      "doubao-seedream-5-0-260128",
    );
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await expect(page.getByLabel("生图服务", { exact: true })).toHaveValue(
      "ark",
    );
    await expect(page.getByLabel("生图模型")).toHaveValue(
      "doubao-seedream-5-0-260128",
    );
    await page.getByLabel("生图服务", { exact: true }).selectOption("aliyun");
    await expect(page.getByLabel("生图模型")).toHaveValue("qwen-image-3.0-pro");
    await expect(page.locator(".image-price-hint")).toContainText(
      "约 ¥0.25 / 张",
    );
    const v = await page.evaluate(() =>
      window.studio.imageConfig({ type: "get" }),
    );
    expect(v.defaultProvider).toBe("aliyun");
    expect(v.providers.ark.model).toBe("doubao-seedream-5-0-260128");
    expect(v.providers.aliyun.model).toBe("qwen-image-3.0-pro");
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test("图片放大、原始尺寸、Esc 关闭与确认删除", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-assets-ui-"));
  const app = await _electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    const file = path.join(data, "preview.png");
    fs.writeFileSync(
      file,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await page
      .getByRole("button", { name: "导入图片", exact: true })
      .first()
      .click();
    const thumb = page.getByRole("button", {
      name: "放大查看 preview.png",
      exact: true,
    });
    await thumb.click();
    const preview = page.getByRole("dialog", { name: "图片预览" });
    await expect(preview).toBeVisible();
    await page.getByRole("button", { name: "原始尺寸", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "适应窗口", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(thumb).toBeFocused();
    await thumb.click();
    await page
      .getByRole("button", { name: "关闭图片预览", exact: true })
      .click();
    await expect(preview).toHaveCount(0);
    await thumb.click();
    await page.locator('.image-lightbox-canvas').click({ position: { x: 3, y: 3 } });
    await expect(preview).toHaveCount(0);
    page.once("dialog", (d) => d.dismiss());
    await page
      .getByRole("button", { name: "删除图片 preview.png", exact: true })
      .click();
    await expect(thumb).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "删除图片 preview.png", exact: true })
      .click();
    await expect(thumb).toHaveCount(0);
    await expect(page.getByText("图片已删除", { exact: true })).toBeVisible();
    expect(
      (await page.evaluate(() => window.studio.bootstrap())).state.assets,
    ).toHaveLength(0);
    expect(fs.readdirSync(path.join(data, "deleted-assets"))).toHaveLength(1);
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
