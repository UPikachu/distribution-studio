import { z } from "zod";
export const providerIds = ["ark", "aliyun", "minimax"] as const;
export const providerIdSchema = z.enum(providerIds);
export type ProviderId = z.infer<typeof providerIdSchema>;
export const providerLabels = {
  ark: "火山方舟",
  aliyun: "阿里云百炼",
  minimax: "MiniMax",
};
export const imageModels: Record<ProviderId, { id: string; name: string }[]> = {
  ark: [
    { id: "doubao-seedream-5-0-260128", name: "Seedream 5.0 Lite" },
    { id: "doubao-seedream-4-5-251128", name: "Seedream 4.5" },
    { id: "doubao-seedream-4-0-250828", name: "Seedream 4.0" },
  ],
  aliyun: [
    { id: "qwen-image-3.0", name: "Qwen Image 3.0" },
    { id: "qwen-image-3.0-pro", name: "Qwen Image 3.0 Pro" },
  ],
  minimax: [
    { id: "image-01", name: "image-01" },
    { id: "image-01-live", name: "image-01-live" },
  ],
};
export const providerSchema = z
  .object({
    baseUrl: z.string().url().max(300),
    model: z.string().trim().min(1).max(120),
    apiKey: z.string().trim().max(2000),
  })
  .strict();
export const imageConfigSchema = z
  .object({
    version: z.literal(1),
    defaultProvider: providerIdSchema,
    providers: z
      .object({
        ark: providerSchema,
        aliyun: providerSchema,
        minimax: providerSchema,
      })
      .strict(),
  })
  .strict();
export type ImageConfig = z.infer<typeof imageConfigSchema>;
export type ImageConfigView = Omit<ImageConfig, "providers"> & {
  providers: Record<
    ProviderId,
    Omit<ImageConfig["providers"]["ark"], "apiKey"> & { configured: boolean }
  >;
  configPath: string;
};
export const defaultImageConfig = (): ImageConfig => ({
  version: 1,
  defaultProvider: "ark",
  providers: {
    ark: {
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seedream-5-0-260128",
      apiKey: "",
    },
    aliyun: {
      baseUrl: "https://dashscope.aliyuncs.com/api/v1",
      model: "qwen-image-3.0",
      apiKey: "",
    },
    minimax: {
      baseUrl: "https://api.minimax.cn/v1",
      model: "image-01",
      apiKey: "",
    },
  },
});
export const imageRequestSchema = z
  .object({
    provider: providerIdSchema,
    prompt: z.string().trim().min(1).max(1500),
    aspect: z.enum(["1:1", "16:9", "3:4"]),
  })
  .strict();
export type ImageRequest = z.infer<typeof imageRequestSchema>;
export type ImageResult = {
  assetId: string;
  model: string;
  provider: ProviderId;
  elapsedMs: number;
};
export type ImageAction =
  | { type: "get" }
  | { type: "select"; provider: ProviderId; model?: string }
  | { type: "save"; config: ImageConfig; clearKeys?: ProviderId[] }
  | { type: "export"; includeSecrets: boolean }
  | { type: "import" };
