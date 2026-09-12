# 桌游吧社交平台

面向桌游爱好者，提供桌游库管理、组局拼车和战绩追踪的社交化桌游吧运营平台。

## Docker Compose 快速启动

首次启动前复制环境变量文件：

```bash
cp .env.example .env
docker compose up -d
```

访问地址：

- 前端：http://localhost:28512
- 后端健康检查：http://localhost:29512/health
- API 示例：http://localhost:28512/api/overview

## 项目主要功能

- 桌游库管理与分类：录入桌游信息（名称、类型、适合人数、时长、难度、简介），上传封面图，按类型（策略/聚会/角色扮演/卡牌）分类管理，记录库存数量。
- 组局拼车与缺人招募：玩家发起组局（选择桌游、时间、人数），发布到拼车广场招募队友，其他玩家可报名加入，满员后自动锁定。
- 战绩记录与排行榜：记录每局桌游的参与者、胜负结果、时长，生成个人胜率排行榜和常用桌游统计，玩家可查看自己的桌游生涯数据。
- 包厢预约与会员储值：展示桌游吧包厢信息（容纳人数、设施），支持按时段预约，会员可充值储值，消费时享受会员折扣和积分累积。
- 活动赛事发布：门店发布桌游赛事活动（如狼人杀锦标赛、剧本杀推理赛），玩家报名参赛，系统自动分组和记录比赛成绩，颁发虚拟奖牌。

## 包厢预约与会员储值

前端顶部切换到「包厢预约」即可使用，包含四个标签页：时段预约、预约记录、包厢管理、会员储值。

- **包厢管理**：维护包厢名称、容纳人数、设施与每小时价格；有进行中预约的包厢不能删除。
- **时段预约**：选择包厢和日期后，时段表会标出已被占用的时间段；同一包厢的重叠时段会被拒绝（相邻时段可正常预约）。营业时间 10:00-23:00。
- **会员储值**：会员分普通/白银/黄金/铂金四级，折扣分别为 无折扣/9.5 折/9 折/8.5 折；充值后即可用余额支付预约，余额不足会提示差额；每消费 1 元累计 1 积分。
- **取消预约**：已支付金额全额退回会员余额，已累计的对应积分同步扣减，并生成退款流水。
- **数据持久化**：后端优先使用 MongoDB（Docker Compose 启动时自动连接）；本地开发没有 MongoDB 时自动降级为 JSON 文件存储（默认 `backend/data/booking-store.json`，可用环境变量 `DATA_FILE` 修改），刷新页面或重启服务数据都不会丢失。

主要 API：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/booking/rooms` | 包厢列表 / 新增包厢 |
| PUT/DELETE | `/api/booking/rooms/:id` | 编辑 / 删除包厢 |
| GET/POST | `/api/booking/members` | 会员列表 / 注册会员 |
| POST | `/api/booking/members/:id/recharge` | 会员充值 |
| GET/POST | `/api/booking/bookings` | 预约列表 / 创建预约（含重叠校验与余额支付） |
| POST | `/api/booking/bookings/:id/cancel` | 取消预约并退款 |
| GET | `/api/booking/transactions` | 储值/消费/退款流水 |
| GET | `/api/booking/recoveries` | 回滚失败留下的恢复记录（可按 `?status=pending` 过滤） |
| POST | `/api/booking/recoveries/:id/resolve` | 人工处理完毕后将恢复记录标记为已处理 |

失败处理约定：创建预约/取消/充值的任一步骤失败会自动回滚（余额积分恢复原样）；若回滚本身也失败，接口返回 500 且 `code` 为 `ROLLBACK_FAILED`，同时写入一条包含恢复所需全部快照的恢复记录，由管理员人工处理后标记完成。

自动化测试：在 `backend/` 下执行 `npm test`，会启动独立的测试实例（端口 29513、临时数据文件，不影响开发服务），覆盖零时长、虚构日期、时段重叠、相邻时段、折扣积分、余额不足、取消退款、重复取消、并发下单/并发取消（带 I/O 延迟的存储下验证串行化）、写入中途失败的自动回滚与回滚失败的恢复记录（故障注入存储验证）以及重启后数据保留，全部通过退出码为 0，失败时会指出被破坏的规则。

## 本地开发方式

前端：

```bash
cd frontend
npm install
npm run dev
```

后端：

```bash
cd backend
npm install
npm run dev
```

## 技术栈

| 分层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript、Element Plus、Vite |
| 后端 | Node.js + Express + TypeScript |
| 数据库 | MongoDB |
| 认证 | JWT |
| 依赖 | Mongoose、bcryptjs |

## 项目目录结构

```text
.
├── backend/              # 后端服务
├── database/             # 数据库脚本
├── frontend/             # 前端应用
├── docker-compose.yml    # 一键部署编排
├── .env.example          # 环境变量示例
└── README.md
```

## 环境变量说明

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| COMPOSE_PROJECT_NAME | Compose 项目名，避免中文目录名导致项目名为空 | lpboardgame |
| DB_NAME | 数据库名称 | app |
| DB_USER | 数据库用户 | app |
| DB_PASSWORD | 数据库密码 | app_pwd |
| DB_ROOT_PASSWORD | 数据库 root 密码 | root_pwd |
| JWT_SECRET | JWT 签名密钥 | change_me_to_a_long_random_string |
| FRONTEND_PORT | 前端宿主机端口 | 28512 |
| BACKEND_PORT | 后端宿主机端口 | 29512 |
| DB_PORT | 数据库宿主机端口 | 27017 |

## Docker 部署说明

- 使用 `docker compose up -d` 启动，不需要额外传入 `-p`。
- `docker-compose.yml` 顶层已声明 `name: lpboardgame`，并且 `.env` 包含 `COMPOSE_PROJECT_NAME=lpboardgame`，可在中文目录名下启动。
- 数据库数据保存在命名卷 `db_data` 中，不依赖当前目录名。
- 前端容器由 Nginx 托管静态资源，并把 `/api/` 反向代理到 `backend:29512`。
- 若本地端口冲突，可修改 `.env` 中的 `FRONTEND_PORT`、`BACKEND_PORT`、`DB_PORT`。

常用命令：

```bash
docker compose config --quiet
docker compose ps
docker compose down
```

## License

MIT
