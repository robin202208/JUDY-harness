# contracts/ —— 上游契约快照

这里存的是**你依赖的上游接口面**，不是上游代码。升级前拿新版本快照来 diff，比读 CHANGELOG 可靠：
CHANGELOG 写的是"加了什么"，这里回答的是"什么没了 / 什么改了签名"。

## 快照里有什么

| 字段 | 内容 | 为什么它会影响你 |
|---|---|---|
| `packages` | 每个 `@deepseek-ai/*` 的版本 | 解析失败、peer 不匹配的直接原因 |
| `clientModules` | 声明了 `dsh.client` 的包及其 `inject` 边 | 你的品牌包依赖这些模块先加载；`inject` 少了就是加载顺序变了 |
| `bundlePatches` | 声明了 `dsh.bundle.patch` 的包和文件名 | 你的 profile 靠这些层叠配置 |
| `rowIds` | 所有可被 patch 命中的 Loader 行 id | **你最脆弱的依赖**：row id 改名，你的 override 静默失效 |
| `slots` | 所有 UI slot 名 | 品牌包、自定义面板靠它挂载；改名等于你的 UI 消失 |
| `envVars` | 代码里读的 `DSH_*` 开关 | 灰度、遥测、目录位置都靠它 |

## 文件

```
contracts/
├── baseline.json                         # 你当前运行的版本（升级对比的基准，必须提交）
├── dsh-0.2.0-rc.2.json                   # 由安装包生成的参考快照
├── reports/<version>.md                  # 每次 check 生成的体检报告
└── fixtures/simulated-0.3.0-rc.1.json    # 演示用的"下一版"，含五类刻意改动
```

## 用法

```bash
# 1. 从安装包取快照（不用构建、不用启动）
tsx scripts/contracts.ts snapshot --asar "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar" \
  --out contracts/dsh-0.3.0-rc.1.json

# 2. 和基准对比；有 breaking 就退出码 1（可直接当 CI 门禁）
tsx scripts/contracts.ts diff contracts/baseline.json contracts/dsh-0.3.0-rc.1.json \
  --out contracts/reports/0.3.0-rc.1.md --fail-on breaking

# 3. 或者一条命令
tsx scripts/upgrade.ts check --asar "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
```

`--fail-on` 可选 `breaking`（默认）/ `warning` / `none`。

## 先升级基准，还是先看报告？

顺序是：**先看报告，再动手**。`baseline.json` 只在你真的完成一次升级后才更新 —— 否则你会用"未来"的标准去解释"现在"的行为。

```bash
cp contracts/dsh-0.3.0-rc.1.json contracts/baseline.json   # 升级并验收之后再执行
```

## 已知边界

- 只认识**显式写出来的**契约：`dsh.client` / `dsh.bundle` / `process.env.DSH_*` / patch 里的 `- id:` / 客户端 bundle 里的 slot 名。通过辅助函数间接读取的配置（例如 `resolveDshHome()` 内部的 `~/.dsh`）不会出现在快照里。
- 客户端 slot 名是从构建产物里 grep 的，压缩或改名会漏。快照对**删减**敏感，对**重命名**只能报"少了一个、多了一个"。
- `repo` 模式需要已构建的 `lib/client.js`；源码模式下 slots 与 env 会偏少，以 `asar` 模式为准。
