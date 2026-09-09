import fs from "node:fs";
import path from "node:path";
import {
  imageConfigSchema,
  defaultImageConfig,
  providerIds,
  type ImageConfig,
  type ImageConfigView,
  type ProviderId,
} from "../src/image-domain";
export interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export function validateEndpoint(id: ProviderId, value: string) {
  const u = new URL(value);
  const valid =
    id === "ark"
      ? u.hostname === "ark.cn-beijing.volces.com" &&
        u.pathname.replace(/\/$/, "") === "/api/v3"
      : id === "minimax"
        ? ["api.minimax.cn", "api.minimaxi.com", "api.minimax.io"].includes(
            u.hostname,
          ) && u.pathname.replace(/\/$/, "") === "/v1"
        : (["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"].includes(
            u.hostname,
          ) ||
            /^[a-z0-9-]+\.(cn-beijing|ap-southeast-1|eu-central-1|ap-northeast-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(
              u.hostname,
            )) &&
          u.pathname.replace(/\/$/, "") === "/api/v1";
  if (
    !valid ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash
  )
    throw Error(
      "请填写该服务的官方 API 地址（百炼使用 DashScope /api/v1 地址）。",
    );
  return u.href.replace(/\/$/, "");
}
export class ImageConfigStore {
  readonly file: string;
  private value: ImageConfig;
  constructor(
    directory: string,
    private secrets: SecretStorage,
  ) {
    this.file = path.join(directory, "image-providers.user.json");
    this.value = defaultImageConfig();
    if (fs.existsSync(this.file)) {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw.format !== "distribution-studio-image-config-encrypted")
        throw Error("生图配置格式不正确，请使用设置中的导入功能。");
      for (const id of providerIds) {
        const key = raw.config?.providers?.[id]?.apiKey;
        if (typeof key === "string" && key)
          raw.config.providers[id].apiKey = this.secrets.decryptString(
            Buffer.from(key, "base64"),
          );
      }
      this.value = this.validate(raw.config);
    }
  }
  private validate(input: unknown) {
    const next = imageConfigSchema.parse(input);
    for (const id of providerIds)
      next.providers[id].baseUrl = validateEndpoint(
        id,
        next.providers[id].baseUrl,
      );
    return next;
  }
  get() {
    return structuredClone(this.value);
  }
  view(): ImageConfigView {
    const v = this.get();
    return {
      version: 1,
      defaultProvider: v.defaultProvider,
      configPath: this.file,
      providers: Object.fromEntries(
        providerIds.map((id) => {
          const { apiKey, ...p } = v.providers[id];
          return [id, { ...p, configured: !!apiKey }];
        }),
      ) as ImageConfigView["providers"],
    };
  }
  save(input: unknown, clearKeys: ProviderId[] = []) {
    const next = this.validate(input);
    for (const id of providerIds) {
      if (clearKeys.includes(id)) next.providers[id].apiKey = "";
      else if (!next.providers[id].apiKey)
        next.providers[id].apiKey = this.value.providers[id].apiKey;
    }
    if (
      providerIds.some((id) => next.providers[id].apiKey) &&
      !this.secrets.isEncryptionAvailable()
    )
      throw Error("系统安全存储不可用，未保存密钥。");
    const disk = structuredClone(next);
    for (const id of providerIds)
      if (disk.providers[id].apiKey)
        disk.providers[id].apiKey = this.secrets
          .encryptString(disk.providers[id].apiKey)
          .toString("base64");
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        { format: "distribution-studio-image-config-encrypted", config: disk },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.file);
    this.value = next;
    return this.view();
  }
  select(provider: ProviderId, model?: string) {
    const next = this.get();
    next.defaultProvider = provider;
    if (model !== undefined) next.providers[provider].model = model;
    return this.save(next);
  }
  export(includeSecrets: boolean) {
    const config = this.get();
    if (!includeSecrets)
      for (const id of providerIds) config.providers[id].apiKey = "";
    return JSON.stringify(
      { format: "distribution-studio-image-config", config },
      null,
      2,
    );
  }
  import(text: string) {
    const raw = JSON.parse(text);
    if (raw.format !== "distribution-studio-image-config")
      throw Error("请选择生图服务配置导出文件。");
    return this.save(raw.config);
  }
}
