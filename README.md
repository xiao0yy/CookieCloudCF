# CookieCloud for Cloudflare Workers

这是一个基于 [Cloudflare Workers](https://workers.cloudflare.com/) 版本的 [CookieCloud](https://github.com/easychen/CookieCloud) Server 端实现。

CookieCloud 是一个和自架服务器同步浏览器 Cookie 和 LocalStorage 的小工具，支持端对端加密。本项目利用 Cloudflare Workers 和 [Cloudflare KV](https://www.cloudflare.com/products/workers-kv/) 重写了其后端 API，让你能够利用 Cloudflare 强大的边缘网络，免费、快速地搭建属于自己的 CookieCloud 服务端。

## 特性

- **Serverless 架构**：无服务器部署，利用 Cloudflare Workers，完全免费（基于免费额度）。
- **完全兼容**：与官方的 CookieCloud 浏览器插件完全兼容。
- **安全可靠**：数据存储在 Cloudflare KV 中，并使用 Cloudflare Workers 原生 Web Crypto API 实现加解密，无外部依赖，安全高效。
- **轻量级**：使用 [Hono](https://hono.dev/) 框架构建。

## 部署指南

### 准备工作

1. 拥有一个 [Cloudflare](https://dash.cloudflare.com/) 账号。
2. 本地已安装 Node.js 和 npm（或 yarn/pnpm）。
3. 熟悉并已配置好 Cloudflare 的命令行工具 [Wrangler](https://developers.cloudflare.com/workers/cli-wrangler/install-update)。

### 1. 克隆并安装依赖

```bash
npm install
```

### 2. 创建 Cloudflare KV 命名空间

运行以下命令，为存储你的加密 Cookie 数据创建一个 KV 命名空间：

```bash
npx wrangler kv:namespace create COOKIE_CLOUD
```

命令执行成功后，终端会输出类似下面的配置块：

```toml
{ binding = "COOKIE_CLOUD", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 3. 配置 `wrangler.toml`

打开项目根目录下的 `wrangler.toml` 文件，将上一步生成的 `id` 填入 `[[kv_namespaces]]` 下的 `id` 字段中：

```toml
name = "cookie-cloud"
main = "src/index.js"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "COOKIE_CLOUD"
id = "替换为你的 KV ID" # 用户需要替换为真实的 KV ID
```

### 4. 部署到 Cloudflare

使用以下命令将服务发布到 Cloudflare Workers：

```bash
npm run deploy
```

部署成功后，Wrangler 会返回你的 Worker 访问地址（例如 `https://cookie-cloud.<your-subdomain>.workers.dev`）。你可以在 CookieCloud 浏览器插件的服务端地址处填入该链接。

## 本地开发与测试

你可以使用 wrangler 在本地启动开发服务器进行测试：

```bash
npm run dev
```

执行测试：

```bash
npm run test
```

## API 接口说明

- `POST /update`: 上传本地加密的字符串和 uuid。
- `GET /get/:uuid` 或 `POST /get/:uuid`: 下载加密字符串（若提供密码则返回解密后的 JSON）。

## 声明

本项目是 [easychen/CookieCloud](https://github.com/easychen/CookieCloud) 的第三方 Serverless 服务端实现。
有关浏览器插件的安装与使用，请参考官方仓库的说明。

## 许可证

本项目基于 [MIT License](LICENSE) 授权。
