# JUDY 私有化一键部署

用 Docker Compose 在任意 Linux 服务器上部署 JUDY，一条命令起服务，镜像构建完成后**离线可用**（依赖全部打进镜像）。支持 DeepSeek 官方 API，也支持接入**本地/国产模型**（Ollama、vLLM 等 OpenAI 兼容端点），适合内网/私有化场景。

## 环境要求

- Linux 服务器（或任意支持 Docker 的机器）
- Docker ≥ 20.10 与 Docker Compose v2
- 服务器至少 4 GB 内存、20 GB 磁盘（镜像构建需要）

## 快速开始

```sh
# 1. 克隆仓库
git clone https://github.com/robin202208/JUDY-harness.git
cd JUDY-harness

# 2. 配置模型密钥
cp deploy/.env.example deploy/.env
#   编辑 deploy/.env，填入 DEEPSEEK_API_KEY（DeepSeek 官方 API 密钥）
#   或按下方「模型配置」接入本地/国产模型

# 3. 一键构建并启动（首次构建约 10~20 分钟）
docker compose -f deploy/docker-compose.yml up -d --build

# 4. 打开浏览器
#   http://<服务器IP>:3080
```

## 模型配置

### 方式一：DeepSeek 官方 API

```sh
DEEPSEEK_API_KEY=sk-你的密钥
DEEPSEEK_BASE_URL=        # 留空即可
```

### 方式二：完全本地 / 国产模型（Ollama）

```sh
# 1. 启动 ollama 服务（compose 中默认未启用，加 --profile）
docker compose -f deploy/docker-compose.yml --profile local-model up -d

# 2. 拉取模型（如通义千问、智谱 GLM 等）
docker exec judy-ollama ollama pull qwen2.5:7b

# 3. 在 deploy/.env 中配置：
DEEPSEEK_API_KEY=ollama                          # 本地推理无需真实密钥
DEEPSEEK_BASE_URL=http://ollama:11434/v1         # 指向 compose 内的 ollama 服务

# 4. 重启 judy 服务使其生效
docker compose -f deploy/docker-compose.yml up -d
```

启动后在 JUDY 界面 → 模型设置中，选择已拉取的模型（如 `qwen2.5:7b`）作为默认模型。

### 方式三：内网 OpenAI 兼容服务（vLLM 等）

```sh
DEEPSEEK_API_KEY=任意非空值
DEEPSEEK_BASE_URL=http://<vllm-host>:8000/v1
```

## 数据持久化

- 会话、设置、Agent 预设、profile 都保存在 `judy-data` 卷（挂载到容器 `/data/dsh`）；
- 删除/重建容器不丢数据；彻底清理请手动删除卷：`docker volume rm <项目名>_judy-data`。

## 升级

```sh
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

## 安全说明

- **应用默认只监听容器内 `127.0.0.1`**（上游刻意禁用 `--host 0.0.0.0`——Agent 能执行代码，绑定全网会暴露远程代码执行面），对外访问由 Docker 端口映射提供，这是刻意保留的安全默认值；
- 生产环境建议在 JUDY 前加一层 HTTPS 反向代理（nginx/caddy），并只暴露 443；
- 修改对外端口：把 compose 里 `ports` 的 `"3080:3080"` 改为 `"80:3080"` 等；
- 会话数据默认不加密，请通过卷的备份策略保护。

## 常见问题

- **首次打开页面空白/接口报错**：检查 `docker compose logs judy` 中是否有模型配置错误；
- **模型调用失败**：确认 `DEEPSEEK_BASE_URL` 指向的端点可访问、模型名正确；
- **想换端口**：改 compose 的 `ports` 映射后 `docker compose up -d`；
- **想用 GPU 跑本地模型**：Ollama 镜像需配置 GPU（`gpus: all`，需 nvidia-container-toolkit），见 [ollama/ollama](https://github.com/ollama/ollama) 文档。
