import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ImageConfigStore, validateEndpoint } from "../electron/image-config";
import {
  buildImageRequest,
  responseImages,
  generateImage,
} from "../electron/image-api";
import { defaultImageConfig, providerIds } from "../src/image-domain";
const secrets = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s.split("").reverse().join("")),
  decryptString: (b: Buffer) => b.toString().split("").reverse().join(""),
};
describe("生图配置与密钥边界", () => {
  it("加密落盘、脱敏返回、导出迁移、留空保留和显式清除", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-config-"));
    try {
      const store = new ImageConfigStore(dir, secrets);
      const config = defaultImageConfig();
      config.providers.ark.apiKey = "secret-test-ark";
      store.save(config);
      expect(fs.readFileSync(store.file, "utf8")).not.toContain(
        "secret-test-ark",
      );
      expect(JSON.stringify(store.view())).not.toContain("secret-test-ark");
      expect(store.view().providers.ark.configured).toBe(true);
      expect(store.export(false)).not.toContain("secret-test-ark");
      expect(store.export(true)).toContain("secret-test-ark");
      const restored = new ImageConfigStore(dir, secrets);
      expect(restored.get().providers.ark.apiKey).toBe("secret-test-ark");
      restored.import(store.export(false));
      expect(restored.get().providers.ark.apiKey).toBe("secret-test-ark");
      restored.save(defaultImageConfig(), ["ark"]);
      expect(restored.view().providers.ark.configured).toBe(false);
      restored.import(store.export(true));
      expect(restored.view().providers.ark.configured).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("不能把密钥发送给其他服务或恶意导入的域名", () => {
    for (const url of [
      "https://evil.example/api/v3",
      "http://ark.cn-beijing.volces.com/api/v3",
      "https://ark.cn-beijing.volces.com.evil.example/api/v3",
      "https://user@ark.cn-beijing.volces.com/api/v3",
    ])
      expect(() => validateEndpoint("ark", url)).toThrow();
    expect(() =>
      validateEndpoint(
        "aliyun",
        "https://llm-example.cn-beijing.maas.aliyuncs.com/api/v1",
      ),
    ).not.toThrow();
    expect(() =>
      validateEndpoint(
        "aliyun",
        "https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      ),
    ).toThrow();
  });
});
describe("三家生图协议", () => {
  it("分别使用 Ark、DashScope 和 MiniMax 协议", () => {
    const config = defaultImageConfig();
    const req = { prompt: "test", aspect: "16:9" as const };
    expect(
      buildImageRequest(config, { ...req, provider: "ark" }).body,
    ).toMatchObject({ size: "2560x1440", response_format: "url" });
    expect(
      buildImageRequest(config, { ...req, provider: "aliyun" }),
    ).toMatchObject({
      url: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      body: {
        input: { messages: [{ role: "user", content: [{ text: "test" }] }] },
        parameters: { size: "1536*864", n: 1 },
      },
    });
    expect(
      buildImageRequest(config, { ...req, provider: "minimax" }).body,
    ).toMatchObject({ aspect_ratio: "16:9", n: 1 });
    expect(
      responseImages("aliyun", {
        output: {
          choices: [
            {
              message: { content: [{ image: "https://image.example/a.png" }] },
            },
          ],
        },
      }),
    ).toEqual(["https://image.example/a.png"]);
  });
  it("三家成功返回均能下载或解码，CDN 请求不含密钥", async () => {
    for (const provider of providerIds) {
      const config = defaultImageConfig();
      config.providers[provider].apiKey = "secret";
      const png = Buffer.from("image-data");
      const data =
        provider === "ark"
          ? { data: [{ url: "https://image.example/a.png" }] }
          : provider === "aliyun"
            ? {
                output: {
                  choices: [
                    {
                      message: {
                        content: [{ image: "https://image.example/a.png" }],
                      },
                    },
                  ],
                },
              }
            : {
                base_resp: { status_code: 0 },
                data: { image_base64: [png.toString("base64")] },
              };
      let calls = 0;
      const fetcher = (async (_url, options) => {
        calls++;
        if (calls === 1) {
          expect(options?.headers).toMatchObject({
            Authorization: "Bearer secret",
          });
          return new Response(JSON.stringify(data));
        }
        expect(options?.headers).toBeUndefined();
        return new Response(png);
      }) as typeof fetch;
      expect(
        await generateImage(
          config,
          { provider, prompt: "test", aspect: "1:1" },
          fetcher,
        ),
      ).toEqual(png);
    }
  });
  it("错误不泄漏密钥、不自动重试、HTTP 200 业务失败也报错", async () => {
    const config = defaultImageConfig();
    config.providers.minimax.apiKey = "private-key";
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response(
        JSON.stringify({
          base_resp: { status_code: 1004, status_msg: "private-key" },
        }),
      );
    }) as typeof fetch;
    await expect(
      generateImage(
        config,
        { provider: "minimax", prompt: "a", aspect: "1:1" },
        fetcher,
      ),
    ).rejects.toThrow("1004");
    expect(calls).toBe(1);
    const bad = (async () => {
      throw Error("private-key");
    }) as typeof fetch;
    await expect(
      generateImage(
        config,
        { provider: "minimax", prompt: "a", aspect: "1:1" },
        bad,
      ),
    ).rejects.not.toThrow("private-key");
  });
});
