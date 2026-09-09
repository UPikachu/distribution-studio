import type { ProviderId } from "./image-domain";

// Single-image text-to-image list prices, verified 2026-09-09.
// Aliyun: Beijing, current output sizes in image-api.ts are all in the 1K tier.
// Recheck this table when changing model IDs, region support or output sizes.
// Sources: docs.volcengine.com/docs/82379/1544106;
// help.aliyun.com/zh/model-studio/model-pricing;
// platform.minimaxi.com/docs/guides/pricing-paygo.
const prices: Record<ProviderId, Record<string, number>> = {
  ark: {
    "doubao-seedream-5-0-260128": 0.22,
    "doubao-seedream-4-5-251128": 0.25,
    "doubao-seedream-4-0-250828": 0.2,
  },
  aliyun: { "qwen-image-3.0": 0.18, "qwen-image-3.0-pro": 0.25 },
  minimax: { "image-01": 0.025, "image-01-live": 0.025 },
};
export function imagePriceHint(
  provider: ProviderId,
  model: string,
  baseUrl: string,
) {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return "价格待确认";
  }
  const knownRegion =
    provider === "ark"
      ? host === "ark.cn-beijing.volces.com"
      : provider === "aliyun"
        ? host === "dashscope.aliyuncs.com" ||
          /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(host)
        : ["api.minimax.cn", "api.minimaxi.com"].includes(host);
  const price = prices[provider][model];
  if (!knownRegion || typeof price !== "number") return "价格待确认";
  return `约 ¥${price < 0.1 ? price.toFixed(3) : price.toFixed(2)} / 张`;
}
export const imagePriceDetails =
  "当前尺寸下单张文生图的公开参考价；未扣除赠送额度或优惠。价格核对于 2026-09-09，以服务商实际账单为准。";
