# SightFlow.dev

<img width="1201" height="495" alt="image" src="https://github.com/user-attachments/assets/99a7cfec-eb22-4f65-8a76-a6974e46bcf0" />

Official website： [https://sightflow.dev](https://sightflow.dev/)

# 招募共建开发者

我们相信Agent Computer Use 会是未来10年重要AI革命的基建，如果你也希望参与到这个项目迭代，欢迎联系\

[加入Discord](https://discord.com/invite/8H6KpbXq3t)

## 🔑 AI 模型配置 (API Key / SK Key)

本项目依赖大语言模型/视觉模型（Vision Language Model）驱动 RPA。
视觉定位由应用内的视觉模型配置负责；聊天回复由聊天服务配置负责。两者分别配置自己的 API Key、模型名称和 Base URL，互不复用。聊天回复能力也可以通过独立 Provider 接入。
当前仓库内置了一个基于**火山引擎方舟 / 豆包 (Doubao)** 的聊天 Provider 示例。

### SK Key 的用途

1. **智能对话回复**：由于项目涉及类似微信等的自动抓取，模型会分析聊天界面的截图并生成自然的回复内容（带防止自我循环对话机制）。
2. **VLM 视觉定位引导**：基于屏幕截图和特定 Prompt，让模型自动检测屏幕上的 UI 控件，并返回需要点击的坐标，从而驱动纯视觉的 RPA 流程。

### 如何配置

1. 请前往 [火山引擎控制台 - 方舟原生接口](https://console.volcengine.com/ark) 开通相关服务（如 doubao-seed-2-0-lite），并生成/获取你的 API Key。
2. 在项目启动后，点击页面上的**设置 (Settings)** 选项。
3. 分别填写视觉配置和聊天服务的 API Key、模型名称、Base URL，即可开始测试对应 AI 功能及自动回复。默认模型为 `doubao-seed-2-0-lite-260215`，默认 Base URL 为 `https://ark.cn-beijing.volces.com/api/v3`，都可以按实际服务修改。

## 聊天 Provider

SightFlow 桌面端把“截图分析并生成回复”的聊天能力抽象为独立 Provider。Provider 通过 `manifest.json` 声明配置结构，通过 bundle 入口接收聊天截图并返回 `reply_text`、`skip`、`error` 等事件。

项目整体架构、运行链路、IPC、RPA、框选模式、打包和调试说明见：[SightFlow Desktop Agent 项目文档](./docs/project.md)。

外部接入说明见：[聊天 Provider 接入文档](./docs/provider.md)。

当前仓库内置了一个 Doubao / 火山方舟 Provider 示例：

```text
resources/providers/volcengine-ark/manifest.json
resources/providers/volcengine-ark/provider.bundle.js
```

## 🚀 快速开始 (Project Setup)

### 1. 安装依赖

```bash
npm install
```

### 2. 本地开发运行

```bash
npm run dev
```

> **提示**：启动后，应用将打开主界面。请记得先去设置填入 skkey 再进行后续测试。

## 📦 打包构建 (Build)

```bash
# 构建 Windows 版本
npm run build:win

# 构建 macOS 版本
npm run build:mac

```

## 开发环境推荐配置

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
