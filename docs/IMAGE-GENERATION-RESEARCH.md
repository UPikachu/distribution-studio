# 配图 API 调研与接入建议

调研日期：2026-09-09。本文保留最初选型与后续能力规划；当前已接入三家文字生图服务，使用说明见 [生图配置](IMAGE-GENERATION.md)。

## 结论

直接调用官方生图 API 适合当前桌面客户端。首批申请火山方舟与阿里云百炼，MiniMax 可作为低成本对照。使用独立生图模型，不把普通聊天或视觉理解模型当作生图接口。

文章封面、概念插画和背景交给模型；准确中文标题、步骤、品牌信息交给 HTML/SVG 模板；流程图使用 Mermaid/SVG；软件介绍使用真实截图。不同平台优先复用视觉素材并重新排版，不逐平台重新生成整套图片。

## 国内候选及公开价格

以下为人民币成功输出图片单价，不包含参考图输入、重试产生的新图片或其他费用。阿里云采用北京地域价格。最终以开通地域和控制台账单为准。

| 服务 | 模型 | 输出价格 | 建议测试方向 |
| --- | --- | --- | --- |
| 火山方舟 | Seedream 5.0 Lite | 0.22 元/张 | 常规封面、概念插画、参考图改图 |
| 火山方舟 | Seedream 5.0 Pro | ≤2.61 百万像素 0.30 元/张；更高 0.60 元/张 | 较复杂编辑、较高分辨率输出 |
| 阿里云百炼 | qwen-image-3.0 | 1K/2K 均 0.18 元/张 | 中文图卡、教程插画、参考图编辑 |
| 阿里云百炼 | qwen-image-3.0-pro | 1K 0.25 元/张；2K 0.50 元/张 | 复杂构图对照 |
| MiniMax | image-01、image-01-live | 0.025 元/张 | 低成本背景和插画对照 |

Seedream Pro 首张输入图免费，后续输入图 0.02 元/张。Qwen 上述模型输入图 0.02 元/张；其 1K/2K 计价按实际像素面积分档，详见 API 文档。这里只比较公开成本，不据此推断画质高低。

官方来源：

- [火山方舟模型定价](https://docs.volcengine.com/docs/82379/1544106?lang=zh)
- [火山引擎模型目录](https://ai.volcengine.com/model)
- [阿里云模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)
- [Qwen Image 3.0 生成与编辑 API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
- [MiniMax 按量价格](https://platform.minimaxi.com/docs/guides/pricing-paygo)
- [MiniMax 生图 API](https://platform.minimaxi.com/docs/api-reference/image-generation-t2i)

## 海外对照

OpenAI GPT Image 和 Google Gemini 的 Nano Banana 系列均提供官方图片生成/编辑 API，可作为后续质量对照。首轮不必为了覆盖供应商而全部开通。

- [OpenAI 图片生成指南](https://developers.openai.com/api/docs/guides/image-generation)
- [Google Gemini 图片生成指南](https://ai.google.dev/gemini-api/docs/image-generation)

## 接入设计建议

1. 从主稿提取配图位置、要表达的知识点、视觉描述和禁止误导的细节。
2. 使用统一供应商接口，能力声明区分文字生图、参考图编辑、尺寸与批量数量。
3. 生成背景或插画后，使用确定性模板叠加标题、注释、品牌信息。
4. 导出平台比例与尺寸，人工预览后纳入现有分发流程。
5. 将图片及时下载到本地素材库。Qwen 返回的图片链接有有效期，不能当永久文章地址。
6. 保存提示词、模型版本、参考图、生成参数、任务状态和实际使用量，支持重试与复用；重试产生新输出可能再次计费。
7. 内部使用将密钥保存到系统安全存储；对外客户端采用用户自带密钥或服务端代理，不内置公司统一密钥。

## API Key 申请清单

- 火山方舟：开通 Seedream 图像模型调用权限，准备 API Key 与可调用模型标识。
- 阿里云百炼：优先北京地域，开通 Qwen Image 3.0，准备 API Key、工作空间 ID 和对应地域。新工作空间域名及接口需按官方文档匹配。
- MiniMax（可选）：普通按量计费 API Key，确认图片模型额度；不要把 Token Plan/Coding 订阅直接视为图片额度。

密钥通过后续本地配置输入，不写入仓库或文档。

## 验收方案

选择 10 个真实选题，覆盖链上概念封面、系列插画、ToC 场景背景、中文图卡和参考图改图。各供应商采用等价提示词，每题生成 2 张，记录可用率、中文错误、知识表达错误、风格一致性、耗时、费用及人工修改时间。以每张可用图片的总成本选默认模型。

付费 API 不等于任何生成内容均可无条件商用。正式上线前还需核对所选服务当时的输出使用条款、素材授权和生成内容标识要求；本轮未完成全面条款审查。
