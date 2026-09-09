import { type ImageConfig, type ImageRequest } from "../src/image-domain";
import { validateEndpoint } from "./image-config";
const MAX_IMAGE = 12 * 1024 * 1024;
export function buildImageRequest(config: ImageConfig, request: ImageRequest) {
  const p = config.providers[request.provider];
  const base = validateEndpoint(request.provider, p.baseUrl);
  const common = { model: p.model, prompt: request.prompt };
  if (request.provider === "ark")
    return {
      url: base + "/images/generations",
      body: {
        ...common,
        size: { "1:1": "2048x2048", "16:9": "2560x1440", "3:4": "1536x2048" }[
          request.aspect
        ],
        response_format: "url",
        watermark: true,
      },
    };
  if (request.provider === "aliyun")
    return {
      url: base + "/services/aigc/multimodal-generation/generation",
      body: {
        model: p.model,
        input: {
          messages: [{ role: "user", content: [{ text: request.prompt }] }],
        },
        parameters: {
          n: 1,
          size: { "1:1": "1024*1024", "16:9": "1536*864", "3:4": "864*1152" }[
            request.aspect
          ],
          watermark: true,
        },
      },
    };
  return {
    url: base + "/image_generation",
    body: {
      ...common,
      n: 1,
      aspect_ratio: request.aspect,
      response_format: "base64",
      aigc_watermark: true,
    },
  };
}
export function responseImages(
  id: ImageRequest["provider"],
  data: any,
): string[] {
  if (
    data.error ||
    data.code ||
    (data.base_resp?.status_code && data.base_resp.status_code !== 0)
  )
    throw Error("服务返回失败");
  if (id === "ark")
    return (data.data ?? []).flatMap((x: any) =>
      x.url
        ? [x.url]
        : x.b64_json
          ? ["data:image/png;base64," + x.b64_json]
          : [],
    );
  if (id === "aliyun")
    return (data.output?.choices ?? []).flatMap((x: any) =>
      (x.message?.content ?? []).flatMap((c: any) =>
        typeof c.image === "string" ? [c.image] : [],
      ),
    );
  return (
    data.data?.image_base64?.map((x: string) =>
      x.startsWith("data:") ? x : "data:image/png;base64," + x,
    ) ??
    data.data?.image_urls ??
    []
  );
}
async function limitedBytes(response: Response, limit: number) {
  if (
    !response.body ||
    Number(response.headers.get("content-length") || 0) > limit
  )
    throw Error("返回内容超过大小限制。");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error("返回内容超过大小限制。");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
export async function generateImage(
  config: ImageConfig,
  request: ImageRequest,
  fetcher: typeof fetch = fetch,
) {
  const p = config.providers[request.provider];
  if (!p.apiKey) throw Error("请先在设置中配置该服务的 API Key。");
  const { url, body } = buildImageRequest(config, request);
  const signal = AbortSignal.timeout(180000);
  let stage = "generation";
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${p.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal,
    });
    const raw = (await limitedBytes(response, 20 * 1024 * 1024)).toString(
      "utf8",
    );
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      throw Error(`服务返回非 JSON 响应（HTTP ${response.status}）。`);
    }
    if (
      !response.ok ||
      data.error ||
      data.code ||
      (data.base_resp?.status_code && data.base_resp.status_code !== 0)
    ) {
      // Error bodies may echo prompts or credentials. Only expose a bounded code.
      const code = String(
        data.error?.code ??
          data.code ??
          data.base_resp?.status_code ??
          response.status,
      )
        .split(p.apiKey)
        .join("[redacted]")
        .replace(/[^a-zA-Z0-9_.-]/g, "")
        .slice(0, 70);
      const hint =
        code === "ModelNotOpen"
          ? "请在火山方舟控制台开通当前 Seedream 模型，或在设置中填写已开通的模型 ID。"
          : response.status === 401 ||
              response.status === 403 ||
              code === "1004"
            ? "检查 API Key 与模型权限。"
            : code === "1008"
              ? "账户余额不足。"
              : "检查模型是否已开通、账户余额和参数。";
      throw Error(`生图服务失败（HTTP ${response.status} / ${code}）。${hint}`);
    }
    const images = responseImages(request.provider, data);
    if (!images.length)
      throw Error("服务未返回图片，请检查内容审核或模型响应。");
    stage = "download";
    const first = images[0];
    let buffer: Buffer;
    if (first.startsWith("data:")) {
      const match = first.match(
        /^data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/=\r\n]+)$/,
      );
      if (!match) throw Error("图片编码格式不支持。");
      buffer = Buffer.from(match[1], "base64");
    } else {
      const u = new URL(first);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.port ||
        u.hostname === "localhost" ||
        !/^[a-z][a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)
      )
        throw Error("图片下载地址不安全。");
      // Never forward the API authorization header to the image CDN.
      const image = await fetcher(u.href, { signal, redirect: "error" });
      if (!image.ok) throw Error("生成成功，但下载图片失败。");
      buffer = await limitedBytes(image, MAX_IMAGE);
    }
    if (!buffer.length || buffer.length > MAX_IMAGE)
      throw Error("图片超过本地素材库 12 MB 限制。");
    return buffer;
  } catch (e) {
    if (
      e instanceof Error &&
      /^(生图服务失败|服务返回非|服务未返回|返回内容|图片|生成成功)/.test(
        e.message,
      )
    )
      throw e;
    throw Error(
      stage === "download"
        ? "生成可能已计费，但下载失败。请检查网络；重新生成可能再次计费。"
        : "请求超时或网络不可用；服务可能已计费，未自动重试。",
    );
  }
}
