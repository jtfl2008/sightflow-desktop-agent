# Provider 安全校验

Provider 生产安装必须通过本地安全门禁。门禁同时验证 manifest 签名、publisher 信任状态、bundle sha256、入口路径、权限声明和安装来源协议。

## 机器可读验证

使用仓库脚本验证单个 fixture 或 Provider 包：

```bash
npm run provider-verify -- \
  --manifest fixtures/provider-security/trusted/manifest.json \
  --publishers fixtures/provider-security/trusted-publishers.json \
  --source-url https://fixtures.local/trusted/manifest.json
```

输出固定为 JSON，包含 `status`、`reasonCodes`、`productionInstallAllowed`、`debugRunAllowed`、`trustLevel`、`signatureStatus` 和 `artifactHashes`。`status = PASS` 只表示允许生产安装；未签名或未知 publisher 的 Provider 即使可调试运行，也会以 `FAIL` 返回并给出原因码。

## Fixture 矩阵

`fixtures/provider-security/fixture-index.json` 是可执行清单：

- `trusted`：签名、publisher、artifact hash、权限与 HTTPS 来源均有效，期望 `PASS`。
- `debug_only` / `unsigned`：缺少签名，期望 `FAIL` 与 `provider.security.missing_signature`。
- `tampered` / `signature-invalid`：签名后修改 manifest，期望 `provider.security.signature_invalid`。
- `sha256-mismatch`：bundle 内容与 manifest hash 不一致，期望 `provider.security.artifact_hash_mismatch`。
- `permission-diff`：声明未允许权限，期望 `provider.security.permission_denied`。
- `insecure-transport`：HTTP 来源，期望 `provider.security.insecure_transport`。
- `revoked-publisher`：publisher 已撤销，期望 `provider.security.revoked_publisher`。
- `unknown-publisher`：publisher/key 不在信任清单，期望 `provider.security.unknown_publisher`。

验证全部 fixture：

```bash
npx ts-node src/main/provider-security/provider-security-verifier.mock-test.ts
```

## 隐私与密钥边界

Fixture 只包含测试公钥、manifest、bundle hash 与最小测试 bundle。不得在 fixture、报告或日志中写入 secret、token、API key、bundle secret、真实 Provider 配置、webhook body、用户聊天内容或 `deployment_manifest`。本门禁服务 Electron desktop_app/local_store 发布，不生成 Cloudflare deployment manifest。
