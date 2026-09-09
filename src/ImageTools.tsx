import { imagePriceHint, imagePriceDetails } from "./image-pricing";
import React, { useEffect, useState } from "react";
import {
  providerIds,
  imageModels,
  providerLabels,
  type ProviderId,
  type ImageConfigView,
  type ImageConfig,
  type ImageRequest,
} from "./image-domain";
const failure = (e: unknown) => String(e).replace(/^Error:.*?Error: /, "");
export function ImageSettings() {
  const [view, setView] = useState<ImageConfigView>();
  const [config, setConfig] = useState<ImageConfig>();
  const [clearKeys, setClearKeys] = useState<ProviderId[]>([]);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function populate(v: ImageConfigView) {
    setView(v);
    setClearKeys([]);
    setConfig({
      version: 1,
      defaultProvider: v.defaultProvider,
      providers: Object.fromEntries(
        providerIds.map((id) => [
          id,
          {
            baseUrl: v.providers[id].baseUrl,
            model: v.providers[id].model,
            apiKey: "",
          },
        ]),
      ) as ImageConfig["providers"],
    });
  }
  useEffect(() => {
    window.studio
      .imageConfig({ type: "get" })
      .then(populate)
      .catch((e) => setMessage(failure(e)));
  }, []);
  async function run(action: "save" | "import" | "export") {
    if (!config) return;
    setBusy(true);
    setMessage("");
    try {
      if (action === "export") {
        await window.studio.imageConfig({ type: "save", config, clearKeys });
        populate(
          await window.studio.imageConfig({ type: "export", includeSecrets }),
        );
        setMessage("配置已保存；导出以文件对话框的完成结果为准。");
      } else {
        populate(
          await window.studio.imageConfig(
            action === "save"
              ? { type: "save", config, clearKeys }
              : { type: "import" },
          ),
        );
        setMessage(action === "save" ? "生图配置已保存。" : "已读取当前配置。");
      }
    } catch (e) {
      setMessage(failure(e));
    } finally {
      setBusy(false);
    }
  }
  function patch(
    id: ProviderId,
    field: "baseUrl" | "model" | "apiKey",
    value: string,
  ) {
    setConfig(
      (c) =>
        c && {
          ...c,
          providers: {
            ...c.providers,
            [id]: { ...c.providers[id], [field]: value },
          },
        },
    );
  }
  return (
    <section className="settings-card image-settings">
      <h2>AI 生图服务</h2>
      <p>
        密钥由系统安全存储加密，保存在独立用户配置中；文章备份不包含这些密钥。
      </p>
      {config && view && (
        <>
          <label>
            默认生图服务
            <select
              aria-label="默认生图服务"
              value={config.defaultProvider}
              onChange={(e) =>
                setConfig({
                  ...config,
                  defaultProvider: e.target.value as ProviderId,
                })
              }
            >
              {providerIds.map((id) => (
                <option key={id} value={id}>
                  {providerLabels[id]}
                </option>
              ))}
            </select>
          </label>
          <div className="provider-grid">
            {providerIds.map((id) => (
              <fieldset key={id} disabled={busy}>
                <legend>
                  {providerLabels[id]} ·{" "}
                  {view.providers[id].configured ? "已配置密钥" : "未配置"}
                </legend>
                <label>
                  API 地址
                  <input
                    aria-label={`${providerLabels[id]} API 地址`}
                    value={config.providers[id].baseUrl}
                    onChange={(e) => patch(id, "baseUrl", e.target.value)}
                  />
                </label>
                <label>
                  模型 ID
                  <input
                    aria-label={`${providerLabels[id]} 模型`}
                    value={config.providers[id].model}
                    onChange={(e) => patch(id, "model", e.target.value)}
                  />
                </label>
                <label>
                  API Key
                  <input
                    aria-label={`${providerLabels[id]} API Key`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={config.providers[id].apiKey}
                    placeholder={
                      view.providers[id].configured
                        ? "已保存，留空保留原密钥"
                        : "输入 API Key"
                    }
                    onChange={(e) => patch(id, "apiKey", e.target.value)}
                  />
                </label>
                <label className="inline-choice">
                  <input
                    type="checkbox"
                    checked={clearKeys.includes(id)}
                    onChange={(e) =>
                      setClearKeys((v) =>
                        e.target.checked
                          ? [...v, id]
                          : v.filter((x) => x !== id),
                      )
                    }
                  />
                  清除此服务密钥
                </label>
              </fieldset>
            ))}
          </div>
          <code>{view.configPath}</code>
          <label className="inline-choice">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
            />
            导出包含明文密钥（仅用于自己的设备迁移，请妥善保管）
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy}
              onClick={() => run("save")}
            >
              保存生图配置
            </button>
            <button disabled={busy} onClick={() => run("export")}>
              导出生图配置
            </button>
            <button disabled={busy} onClick={() => run("import")}>
              导入生图配置
            </button>
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function ImageGenerator() {
  const [view, setView] = useState<ImageConfigView>();
  const [provider, setProvider] = useState<ProviderId>("ark");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<ImageRequest["aspect"]>("16:9");
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    window.studio
      .imageConfig({ type: "get" })
      .then((v) => {
        setView(v);
        setProvider(v.defaultProvider);
      })
      .catch((e) => setMessage(failure(e)));
  }, []);
  async function select(provider: ProviderId, model?: string) {
    setSelecting(true);
    try {
      const next = await window.studio.imageConfig({
        type: "select",
        provider,
        model,
      });
      setView(next);
      setProvider(next.defaultProvider);
      setMessage("");
    } catch (e) {
      setMessage(failure(e));
    } finally {
      setSelecting(false);
    }
  }
  async function generate() {
    setBusy(true);
    setMessage("正在生成，通常需要几十秒，请保持客户端打开。");
    try {
      const r = await window.studio.generateImage({ provider, prompt, aspect });
      setMessage(
        `图片已加入素材库 · ${providerLabels[r.provider]} · ${(r.elapsedMs / 1000).toFixed(1)} 秒`,
      );
    } catch (e) {
      setMessage(failure(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card image-generator">
      <h2>生成文章配图</h2>
      <p>
        每次生成 1
        张，按服务商规则计费。平台与各平台上次使用的模型会自动记住，重启后保留。
      </p>
      <fieldset disabled={busy || selecting || !view}>
        <div className="button-row">
          <label>
            生图服务
            <select
              aria-label="生图服务"
              value={provider}
              onChange={(e) => void select(e.target.value as ProviderId)}
            >
              {providerIds.map((id) => (
                <option value={id} key={id}>
                  {providerLabels[id]}
                  {view?.providers[id].configured ? "" : "（未配置）"}
                </option>
              ))}
            </select>
          </label>
          <label>
            生图模型
            <select
              aria-label="生图模型"
              value={view?.providers[provider].model ?? ""}
              onChange={(e) => void select(provider, e.target.value)}
            >
              {!view && <option value="">正在读取…</option>}
              {view &&
                !imageModels[provider].some(
                  (m) => m.id === view.providers[provider].model,
                ) && (
                  <option value={view.providers[provider].model}>
                    {view.providers[provider].model}（自定义）
                  </option>
                )}
              {imageModels[provider].map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            画面比例
            <select
              aria-label="画面比例"
              value={aspect}
              onChange={(e) =>
                setAspect(e.target.value as ImageRequest["aspect"])
              }
            >
              <option value="16:9">横版 16:9</option>
              <option value="1:1">方形 1:1</option>
              <option value="3:4">竖版 3:4</option>
            </select>
          </label>
        </div>
        <label>
          配图描述
          <textarea
            aria-label="配图描述"
            maxLength={1500}
            rows={4}
            value={prompt}
            placeholder="例如：链上交易概念插画，钱包与账本通过箭头连接，青绿色，简洁扁平风格，左上留出标题空间，不包含文字。"
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <div className="button-row">
          <button
            className="primary"
            disabled={!prompt.trim() || !view?.providers[provider].configured}
            onClick={generate}
          >
            {busy ? "生成中…" : "生成 1 张配图"}
          </button>
          {view && (
            <span className="image-price-hint" title={imagePriceDetails}>
              {imagePriceHint(
                provider,
                view.providers[provider].model,
                view.providers[provider].baseUrl,
              )}
              <span className="image-price-note"> · 以实际账单为准</span>
            </span>
          )}
        </div>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
