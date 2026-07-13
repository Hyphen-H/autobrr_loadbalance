# qBittorrent 智能负载均衡器

为 qBittorrent 多实例设计的智能负载均衡器，通过 webhook 接收 [autobrr](https://github.com/autobrr/autobrr) 的种子添加请求，自动分配到最优实例。

## 核心功能

- **智能负载均衡**: 根据上传/下载速度、活跃下载数智能选择最佳实例
- **Webhook 集成**: 与 autobrr 无缝集成，实时处理种子添加
- **自动重连**: 实例断开时自动重连
- **流量监控**: 支持流量限制检查（可选）
- **Telegram 通知**: 推送种子分配结果、无可用实例和实例离线/恢复事件
- **运维 Dashboard**: 查看实例速度、任务和剩余空间，管理实例与 Webhook IP 白名单
- **配置导入**: 从 Dashboard 导入新旧版本 `config.json` 并热更新 qBittorrent 实例

## 快速开始

### Docker 部署（推荐）

适用于已安装 Docker Engine、Docker Compose Plugin 和 Git 的 Linux VPS。

1. **下载项目并初始化配置**

```bash
git clone https://github.com/Hyphen-H/autobrr_loadbalance.git
cd autobrr_loadbalance
cp config.json.example config.json
```

2. **修改配置**

编辑 `config.json`，至少设置 qBittorrent 实例、随机的 `webhook_path`，并修改 Dashboard 示例密码。

3. **构建并启动服务**

```bash
chmod +x docker-start.sh
./docker-start.sh start
```

启动脚本会检查 Docker/Compose、构建镜像，并修正 `config.json` 与 `logs` 的容器写权限。也可以不使用脚本，手动运行：

```bash
docker build --pull -t qbittorrent-loadbalancer .
mkdir -p logs
docker compose up -d
```

手动启动前需确保容器内的 `appuser` 可以写入 `config.json` 和 `logs`，否则 Dashboard 无法保存配置。

4. **验证服务**

```bash
docker compose ps
docker compose logs --tail=100 qbittorrent-loadbalancer
curl http://127.0.0.1:50000/health
```

Dashboard 地址：`http://<服务器IP>:50000/dashboard`。

5. **配置 autobrr**

在 autobrr 中添加 Webhook Action：
- URL: `http://<your-server-ip>:50000<your-webhook-path>`
- Body:
```json
{
  "release_name": "{{.TorrentName}}",
  "indexer": "{{.Indexer}}",
  "download_url": "{{.TorrentUrl}}"
}
```
图示：
![PixPin_2025-07-28_08-41-20.png](https://image.dooo.ng/c/2025/07/28/6886c78fc7448.webp)

### 本地运行

```bash
pip install -r requirements.txt
cp config.json.example config.json
# 编辑 config.json
python run.py
```

## 配置说明

### 必需配置

| 参数 | 说明 | 示例 |
|------|------|------|
| `qbittorrent_instances` | qBittorrent 实例列表 | 见配置示例 |
| `webhook_path` | Webhook 访问路径（**必须随机化**） | `/webhook/secure-random-string` |

### 常用配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `webhook_port` | `50000` | Webhook 监听端口 |
| `primary_sort_key` | `upload_speed` | 负载均衡策略：`upload_speed`/`download_speed`/`upload_download_speed`/`active_downloads`/`total_downloads` |
| `max_new_tasks_per_instance` | `2` | 单实例单轮最大新任务数 |
| `connection_timeout` | `6` | 连接超时时间（秒）|
| `debug_add_stopped` | `false` | 调试模式：新种子暂停添加 |
| `webhook_ip_whitelist` | `[]` | Webhook 来源 IP/CIDR 白名单；空数组为允许全部（兼容旧版本） |

`total_downloads` 的计算方式为：活跃下载数 + 0.5 × 等待下载数。

`upload_download_speed` 的计算方式为：上传速率 × 0.6 + 下载速率 × 0.4。

### 可选配置（流量监控）

| 参数 | 说明 |
|------|------|
| `traffic_check_url` | 流量检查 API URL |
| `traffic_limit` | 流量限制（MB），超限实例会被跳过 |
| `reserved_space` | 需要保留的空闲空间（MB），低于此值的实例会被跳过 |

流量限制参数traffic_check_url和traffic_limit支持两种应用场景：
1. 配套`https://github.com/guowanghushifu/netcup-traffic-tester`使用，traffic_limit填2000000
2. 配套`https://github.com/guowanghushifu/vnstat-traffic-exporter`使用，按需配置流量

流量 API 需返回格式, in和out表示入站和出站流量，单位为MB：`{"in":1421.72,"out":11777.19,"start_date":"2025-07-19"}`

### Dashboard

```json
"dashboard": {
    "enabled": true,
    "username": "admin",
    "password": "change-this-password",
    "event_limit": 100
}
```

启动后访问 `http://<服务器IP>:50000/dashboard`，浏览器会要求输入上述用户名和密码。Dashboard 支持：

- 查看各实例连接状态、实时上传/下载速度、任务数、剩余空间、保留空间和流量
- 添加、编辑、删除 qBittorrent 实例；保存后立即连接，无需重启
- 添加或移除 Webhook IPv4、IPv6、CIDR 白名单
- 配置、启停 Telegram Bot，并发送测试通知；Token 留空可保留已保存值
- 导入 `config.json`；旧配置缺少 Dashboard、Telegram、白名单字段时会保留当前管理配置并自动补默认值

导入后 qBittorrent 实例会立即重建连接，Telegram 配置也会热加载；监听端口、Webhook 路径和 Dashboard 认证需要重启后生效。

### Telegram 通知

1. 通过 Telegram 的 `@BotFather` 创建 Bot 并取得 token。
2. 向 Bot 发送消息，再通过 Bot API 的 `getUpdates` 获取目标 `chat_id`。
3. 配置并重启服务：

```json
"telegram": {
    "enabled": true,
    "bot_token": "123456:replace-with-your-token",
    "chat_id": "123456789",
    "timeout": 10
}
```

Telegram 消息由后台队列发送，不会阻塞 Webhook 请求。

## 配置示例
请参考config.json.example

## 安全说明

⚠️ **重要**: `webhook_path` 必须设置为长且随机的字符串，这是应用安全的核心。

- ❌ 错误: `/webhook`, `/autobrr`
- ✅ 正确: `/webhook/secure-a8f9c2e1-4b3d-9876-abcd-ef0123456789`

启用 Dashboard 后务必修改示例密码，并仅在可信内网访问或通过 HTTPS 反向代理暴露。Webhook 白名单按与服务建立 TCP 连接的来源 IP 判断，不信任可伪造的 `X-Forwarded-For`；使用反向代理时应将代理出口 IP 加入白名单。

## Docker 管理命令

```bash
./docker-start.sh start     # 启动服务
./docker-start.sh stop      # 停止服务
./docker-start.sh restart   # 重启服务
./docker-start.sh logs      # 查看日志
./docker-start.sh status    # 查看状态
./docker-start.sh clean     # 清理当前Compose项目容器
```

升级到最新版本：

```bash
git pull origin main
./docker-start.sh restart
```

## API 接口

- `GET /health`: 健康检查
- `POST <webhook_path>`: 接收 autobrr 种子添加请求
- `GET /dashboard`: Dashboard（HTTP Basic 认证）
- `/api/dashboard/*`: Dashboard 管理 API（HTTP Basic 认证）

## 日志

- 日志目录: `./logs/`
- 主日志: `qbittorrent_loadbalancer.log`
- 错误日志: `qbittorrent_error.log`

## 故障排除

1. **连接失败**: 检查 qBittorrent Web UI 设置和网络连通性
2. **Webhook 无响应**: 确认 `webhook_path` 配置正确
3. **调试模式**: 设置 `debug_add_stopped: true` 暂停新种子便于调试 
