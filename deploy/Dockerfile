# syntax=docker/dockerfile:1
# JUDY 私有化部署镜像 —— 从源码构建（含 Web 前端产物），镜像构建完成后即可离线运行。
#
# 安全设计：应用保持容器内 127.0.0.1 监听（上游刻意禁用 `--host 0.0.0.0`，
# 因为 Agent 可执行代码，绑定全网会暴露远程代码执行面）。对外访问统一由
# Docker 端口映射（ports: "3080:3080"）提供，这是容器化下的安全默认值。

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY --from=build /app /app

# 数据根目录：会话、设置、预设、profile 都存这里（挂载持久化卷）。
ENV DSH_HOME=/data/dsh
EXPOSE 3080
VOLUME ["/data/dsh"]

CMD ["pnpm", "dsh", "web"]
