<div align="center">

# 合影名单采集 · Group Photo Namer

**上传一张集体合影 → 自动框出所有人脸 → 每个人在手机上点自己的脸填写姓名 → 管理员一键导出名单**

![零依赖](https://img.shields.io/badge/dependencies-0-brightgreen)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.5-339933?logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)
![人脸识别](https://img.shields.io/badge/face--api.js-浏览器本地-ff69b4)
![License](https://img.shields.io/badge/license-MIT-green)

[功能特性](#功能特性) · [快速开始](#快速开始) · [部署到服务器](#部署到服务器) · [使用流程](#使用流程) · [API 文档](#api-文档) · [常见问题](#常见问题)

> 自部署 · 零 npm 依赖 · 单文件后端 · 浏览器端人脸识别 · 多项目 · 微信分享卡片 · 手机点脸填名

</div>

---

## 这是什么

拍完集体照，总有人要挨个问"第几排第几个是谁"，然后在群里对着照片反复确认。这个工具把这件事变成一个网页：

1. 管理员上传合影，系统在**浏览器本地**自动识别出所有人脸并打框（可手动增删改）；
2. 把链接发到群里，每个人用**手机**打开，缩放拖动照片找到自己，**点一下自己的脸**填写姓名；
3. 管理员随时看到谁填了、谁没填，一键导出**按"第几排第几位"排序的名单**、**未填写人员名单**和**操作日志**。

### 适用场景

毕业合影 · 培训班 / 研修班合影 · 班级集体照 · 年会合影 · 会议合影 · 团队团建照 · 校友返聚合影 · 军训 / 拓展合影 · 任何"一张照片 + 认领姓名"的场景

### 关键词（便于搜索与检索）

`集体合影名单` `合影姓名采集` `合影点名` `照片认人` `谁是谁标注` `毕业合影名单` `合影座位表` `第几排第几位`
`group photo` `photo roster` `name the faces` `who is who` `face detection labeling` `class photo names`
`face-api.js` `浏览器端人脸识别` `零依赖 Node.js` `SQLite 实时落盘` `微信分享卡片` `Open Graph`

> 给 AI 助手 / 爬虫的结构化摘要见 [`llms.txt`](./llms.txt)。

---

## 功能特性

### 人脸处理
- 基于开源 [face-api.js](https://github.com/justadudewhohacks/face-api.js)（SSD MobileNet v1）在**浏览器本地**识别人脸，**照片不上传到识别服务**，只需要联网加载约 6MB 模型；
- 识别结果以**虚线框**呈现，不遮挡人脸；框内左上角有迷你位置标号（如 `3-5` = 第 3 排第 5 位）；
- 管理员有两种模式，随时切换、互不锁死：
  - **✥ 调整已有框**：拖动移动、拉四角缩放（自动识别出来的框同样可以精细调整）；
  - **＋ 新增人脸框**：在空白处拖动画新框，补上漏掉的人脸，可连续添加；
- 支持导出带框标注图（PNG）。

### 手机端体验（重点优化）
- **单指拖动平移照片**、**双指捏合缩放**，鼠标 + 触屏 + 触控笔统一用 Pointer Events；
- 轻点人脸才触发填写（位移 < 14px 且 < 0.8s），拖动过程中不会误弹窗；
- 点脸后直接弹出**放大的人脸特写 + 姓名输入框**，不用去列表里找自己；
- 成员首次打开时，若照片上人脸太小会自动放大到看得清的倍数；
- 点右侧列表任一项，照片会自动滚动居中到那张脸；
- 屏蔽长按菜单、文本选择等干扰；响应式布局，窄屏自动单列。

### 权限与安全
- **管理员**：上传合影、识别、调框、导入/新增/修改名单与验证码、导出全部数据；
- **成员**：只能用管理员分配的验证码登录，只能填写**空位或自己填过的位置**，不能改别人的（防篡改）；
- 成员登录需「姓名 + 验证码」匹配，管理员可批量生成、导入或手动指定验证码；
- 名单**允许重名**：只要验证码不同，同名两人可各自独立填写；
- 同一 IP 每分钟最多 15 次登录尝试（防爆破）。

### 多项目
- 一次部署可承载**任意多个合影项目**，照片、人脸框、名单、日志按项目完全隔离；
- 每个项目可设置**项目名称、简介、图标**；
- 管理员可以在项目间一键切换。

### 分享
- 每个项目都有一个分享链接：`https://你的域名/p/项目ID`；
- 该链接是**服务端渲染**的，带完整 Open Graph / Twitter Card 标签，因此在**微信、QQ、飞书等聊天软件里会自动显示标题、描述和预览图**，点开自动跳转到填写页；
- 未设置项目图标时使用内置默认封面 `public/cover.png`。

### 数据
- SQLite（Node.js 内置 `node:sqlite`）WAL 模式，所有改动**实时落盘**；
- 全员每 4 秒自动同步状态，多人同时填写不冲突；
- 完整操作日志：谁、什么时候、在哪个位置填了什么，全部留痕可导出；
- **零 npm 依赖**：不需要 `npm install`，只依赖 Node.js ≥ 22 自带模块。

---

## 快速开始

### 环境要求
- **Node.js ≥ 22.5**（用到内置的 `node:sqlite`，启动需带 `--experimental-sqlite`）
- 任意操作系统（Linux / macOS / Windows）

### 本地运行

```bash
git clone https://github.com/<your-github-username>/group-photo-namer.git
cd group-photo-namer
node --experimental-sqlite server.js
```

打开 http://localhost:8360 即可。

> 首次启动会**随机生成管理员码并打印在控制台**：
> ```
> 合影名单采集系统已启动: http://localhost:8360
> 管理员码: K7M2QX9P（可在网页右上角「管理员码」里修改，或用环境变量 ADMIN_CODE 预设）
> ```
> 也可以用环境变量指定：`ADMIN_CODE=mySecret2026 node --experimental-sqlite server.js`
>
> 用 `npm start` 等同于上面的启动命令。

### 目录结构

```
group-photo-namer/
├── server.js              # 全部后端逻辑（零依赖，含路由、SQLite、分享页 SSR）
├── package.json
├── public/
│   ├── index.html         # 单页前端（界面 + 人脸识别 + 画布交互）
│   ├── icon.svg           # 默认应用图标 / 站内图标
│   └── cover.png          # 默认分享封面（未设置项目图标时使用）
├── data/                  # 运行后自动生成 app.db（照片、框、名单、日志）
│   └── .gitkeep
├── llms.txt               # 给 AI 助手 / 检索的结构化项目摘要
├── README.md
└── LICENSE
```

`data/` 已在 `.gitignore` 中忽略，**不要把数据库提交到 Git**（里面含真实合影与姓名）。

---

## 部署到服务器

以 Ubuntu 22.04/24.04 + Nginx 为例（任意云主机均可，1 核 1G 足够）。

### 1. 安装 Node.js 22

```bash
cd /tmp
curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz -o node.tar.xz
sudo mkdir -p /opt && sudo tar -xJf node.tar.xz -C /opt
sudo ln -sf /opt/node-v22.12.0-linux-x64/bin/node /usr/local/bin/node
sudo ln -sf /opt/node-v22.12.0-linux-x64/bin/npm  /usr/local/bin/npm
node -v
```

### 2. 放代码并设置管理员码

```bash
sudo mkdir -p /opt/photo-namer
sudo rsync -a --exclude data ./ /opt/photo-namer/    # 或在服务器上 git clone
sudo chown -R $USER:$USER /opt/photo-namer
cd /opt/photo-namer && ADMIN_CODE='换成你自己的码' npm start   # 先手动跑一次，确认能启动
```

### 3. 注册为系统服务（开机自启、崩溃自动重启）

```bash
sudo tee /etc/systemd/system/photo-namer.service > /dev/null <<'UNIT'
[Unit]
Description=Group Photo Namer
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/photo-namer
ExecStart=/usr/local/bin/node --experimental-sqlite server.js
Environment=PORT=8360
Environment=ADMIN_CODE=换成你自己的码
Restart=always
RestartSec=3
StandardOutput=append:/var/log/photo-namer.log
StandardError=append:/var/log/photo-namer.log

[Install]
WantedBy=multi-user.target
UNIT

sudo touch /var/log/photo-namer.log && sudo chown ubuntu:ubuntu /var/log/photo-namer.log
sudo systemctl daemon-reload
sudo systemctl enable --now photo-namer
systemctl status photo-namer --no-pager
```

> `ADMIN_CODE` 只在**首次创建数据库**时写入。之后想改码，用网页右上角「改管理员码」，或在服务器上删除该行后重启。

### 4. Nginx 反向代理 + HTTPS

```bash
sudo apt-get update -qq && sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/photo-namer > /dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name photo.example.com;

    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name photo.example.com;

    ssl_certificate     /etc/letsencrypt/live/photo.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/photo.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 80m;          # 合影照片可能较大

    location / {
        proxy_pass http://127.0.0.1:8360;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/photo-namer /etc/nginx/sites-enabled/photo-namer
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d photo.example.com      # 申请证书，并启用自动续期
```

> 分享页会用 `X-Forwarded-Proto` / `Host` 生成绝对图片地址，所以**务必保留上面两个 proxy_set_header**，否则微信里的预览图会加载不出来。

### 5. 每日自动备份（强烈建议）

```bash
cat > /opt/photo-namer/backup.js <<'JS'
/* 每日数据库快照（VACUUM INTO 保证一致性），保留最近 14 份 */
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs"), path = require("path");
const DIR = "/opt/photo-namer/backups";
fs.mkdirSync(DIR, { recursive: true });
const dst = path.join(DIR, "app-" + new Date().toISOString().slice(0, 10) + ".db");
try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch (e) {}
new DatabaseSync("/opt/photo-namer/data/app.db").exec("VACUUM INTO '" + dst + "'");
const files = fs.readdirSync(DIR).filter(f => /^app-.*\.db$/.test(f)).sort();
while (files.length > 14) fs.unlinkSync(path.join(DIR, files.shift()));
JS

sudo tee /etc/systemd/system/photo-namer-backup.service > /dev/null <<'UNIT'
[Unit]
Description=Group Photo Namer daily backup
[Service]
Type=oneshot
User=ubuntu
ExecStart=/usr/local/bin/node --experimental-sqlite /opt/photo-namer/backup.js
UNIT

sudo tee /etc/systemd/system/photo-namer-backup.timer > /dev/null <<'UNIT'
[Unit]
Description=Daily backup of Group Photo Namer
[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload && sudo systemctl enable --now photo-namer-backup.timer
systemctl list-timers photo-namer-backup.timer --no-pager
```

### 6. 时区

操作日志用服务器本地时间，建议设为北京时间：

```bash
sudo timedatectl set-timezone Asia/Shanghai
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8360` | 监听端口 |
| `ADMIN_CODE` | 随机 8 位 | 首次启动写入的管理员码；数据库已存在时不会覆盖 |

---

## 使用流程

### 管理员
1. 打开站点 → 输入管理员码 + 你自己的姓名 → 进入「项目管理」；
2. **新建项目**：填项目名称（会显示在微信分享卡片上）、简介，可上传**正方形图标**（作为分享预览图）；
3. 进入项目 → **上传合影** → **自动识别人脸** → 用「✥ 调整已有框 / ＋ 新增人脸框」修正每一张脸；
4. **名单**：可以① 粘贴姓名批量生成验证码；② 点「下载导入模板」填好后「导入名单」；③ 在表格里直接逐条手动新增、修改姓名或验证码、删除；
5. 点「项目设置 / 分享」→ 复制分享链接发到群里；
6. 随时导出：**合影名单**（按排/位次）、**未填写人员**、**待填写位置**、**验证码清单**、**操作日志**。

### 成员
1. 点开分享链接（微信里会显示项目卡片）；
2. 选择项目 → 输入**姓名 + 管理员发的验证码**；
3. 单指拖动 / 双指缩放找到自己 → **点一下自己的脸** → 输入姓名 → 保存；
4. 填错了可以重新点自己的脸修改（别人的位置改不了）。

### 导入名单格式

点管理员面板的「下载导入模板」得到 CSV：

```csv
姓名,验证码
张三,
李四,A8K2Q9
王五,
```

- 第一列**姓名**（必填）；第二列**验证码**可留空，留空则自动生成 6 位码；
- 允许**重名**，同名不同码即可；
- 验证码与自己原有的冲突时会自动换一个（控制台/返回结果里会列出）；
- 分隔符支持 `,` `，` `;` `；` 和制表符，首行写「姓名」会被自动跳过；
- 保存时请用 **UTF-8 / CSV** 编码（Excel：另存为「CSV UTF-8」）。

---

## API 文档

除 `/api/login`、`/api/projects/public`、`/api/template`、`/api/project/:id/icon` 外，其余接口都需要请求头 `x-token`（登录返回的 token）。

### 认证

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/login` | 公开 | `{name, code, projectId?}` → `{token, role, name, projectId, project, needProject}`。`code` 等于管理员码时为管理员；否则在 `projectId` 内校验成员验证码 |
| POST | `/api/admin/password` | 管理员 | `{oldCode, newCode}` 修改管理员码 |

### 项目

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/projects/public` | 公开 | 项目列表（仅 id / 名称 / 简介 / 是否有图标），登录页选择用 |
| GET | `/api/projects` | 管理员 | 项目列表 + 统计（人脸数、已填数、名单人数、是否有照片） |
| POST | `/api/projects` | 管理员 | `{name, descr?, iconDataUrl?}` 新建项目 |
| PUT | `/api/projects/:id` | 管理员 | `{name?, descr?, iconDataUrl?}`（`iconDataUrl:""` 表示清除图标） |
| DELETE | `/api/projects/:id` | 管理员 | 删除项目及其全部数据 |
| POST | `/api/session/project` | 管理员 | `{projectId}` 切换当前项目 |
| GET | `/api/project` | 登录 | 当前项目信息 |
| GET | `/api/project/:id/icon` | 公开 | 项目图标（无图标时返回默认封面），供分享卡片使用 |
| GET | `/p/:id` | 公开 | **分享落地页**：服务端渲染 OG 标签并跳转到 `/?p=:id` |

### 照片与人脸框

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/photo` | 登录 | 当前项目合影（二进制） |
| POST | `/api/photo` | 管理员 | `{dataUrl}` 上传合影（会清空现有人脸框） |
| DELETE | `/api/photo` | 管理员 | 删除合影与全部人脸框 |
| POST | `/api/boxes/bulk` | 管理员 | `{boxes:[{x,y,w,h}]}` 批量写入（自动过滤 40% 以上重叠的重复框） |
| POST | `/api/box` | 管理员 | `{x,y,w,h}` 新增单个框 |
| PUT | `/api/box/:id` | 管理员 | `{x,y,w,h}` 移动 / 缩放 |
| DELETE | `/api/box/:id` | 管理员 | 删除框 |
| PUT | `/api/box/:id/name` | 登录 | `{name}` 填写姓名；成员只能填空位或自己填过的 |

### 名单与验证码

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/codes` | 管理员 | 名单列表 |
| POST | `/api/codes` | 管理员 | `{names:"张三\n李四"}` 批量生成验证码（**不查重名**） |
| POST | `/api/codes/add` | 管理员 | `{name, code?}` 手动新增一人（code 留空自动生成） |
| PUT | `/api/codes/:id` | 管理员 | `{name?, code?}` 修改姓名 / 验证码 |
| DELETE | `/api/codes/:id` | 管理员 | 删除一条 |
| POST | `/api/codes/import` | 管理员 | `{rows:[{name, code}]}` 批量导入（重名照收，码冲突自动换码） |
| GET | `/api/template` | 公开 | 下载 CSV 导入模板 |

### 导出与状态

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/state?v=<version>` | 登录 | 项目状态 + 人脸框 + 统计。`v` 与服务端版本一致时只返回 `{same:true}`，用于 4 秒轻量轮询 |
| GET | `/api/export/names` | 管理员 | 合影名单（排 / 位次 / 姓名 / 填写人 / 时间） |
| GET | `/api/export/pending` | 管理员 | **未填写人员名单**（名单中还没有出现在照片上的人） |
| GET | `/api/export/unnamed` | 管理员 | **待填写位置**（照片上还没填姓名的框） |
| GET | `/api/export/codes` | 管理员 | 验证码清单（含是否已使用、使用人） |
| GET | `/api/export/logs` | 管理员 | 完整操作日志 |

---

## 数据模型

```sql
projects(id, name, icon BLOB, icon_mime, descr, version, created_at, updated_at)
photos  (project_id PK, data BLOB, mime, updated_at)
boxes   (id, project_id, x, y, w, h, name, by, at)
codes   (id, project_id, name, code, used_by, created_at, UNIQUE(project_id, code))
sessions(token PK, project_id, name, role, created_at)
logs    (id, project_id, time, operator, role, action, detail)
config  (key, value)          -- admin_code
```

- 坐标 `x/y/w/h` 基于**原始照片像素**，与前端缩放无关；
- `version` 是项目级的自增版本号，用于轮询增量刷新；
- 每个项目独立，删除项目会级联清理照片、框、名单、日志。

---

## 常见问题

**Q：照片会上传到第三方做识别吗？**
不会。人脸识别完全在浏览器里用 face-api.js 跑，照片只存在你自己的服务器数据库里。

**Q：为什么启动要加 `--experimental-sqlite`？**
Node 22 的内置 SQLite 仍标记为实验特性，需要显式开启。`npm start` 已经带上了。

**Q：忘记管理员码了？**
服务器上执行：
```bash
sqlite3 /opt/photo-namer/data/app.db "SELECT value FROM config WHERE key='admin_code'"     # 若装了 sqlite3
# 或
node --experimental-sqlite -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/opt/photo-namer/data/app.db');console.log(db.prepare(\"SELECT value FROM config WHERE key='admin_code'\").get().value)"
```

**Q：微信分享没有预览图？**
① 项目设置里上传一个正方形图标；② 确认 Nginx 传了 `X-Forwarded-Proto` 和 `Host`；③ 微信有缓存，改完后换个链接参数或稍等再试。

**Q：多人同时填写会不会冲突？**
每个位置独立写入并记录填写人，成员只能改自己填的，服务端每次写入都会自增版本号，前端 4 秒轮询同步。

**Q：想清空所有数据重新开始？**
停服务后删除 `data/app.db*`，重启即可（`ADMIN_CODE` 会重新生效）。

**Q：能装多少项目 / 多少张脸？**
单张合影几百个框、单机几十个项目都很轻松。照片以 BLOB 存 SQLite，注意磁盘空间与每日备份。

---

## 隐私提示

本项目是**自部署**工具，数据只在你自己的服务器上：合影照片、姓名、验证码、日志都在本地 `data/app.db` 中。请自行做好：

- 服务器安全组只开放 80/443（不要暴露 Node 端口）；
- 用 HTTPS（微信分享、浏览器体验都更好）；
- 定期备份并妥善保管数据库（里面有真实姓名与照片）；
- 活动结束后如无保存必要，及时删除项目数据。

---

## 技术栈

- **后端**：Node.js 22（内置 `http` + `node:sqlite`），零 npm 依赖
- **前端**：原生 HTML / CSS / JavaScript（单文件，无构建步骤）
- **人脸识别**：face-api.js 0.22.2（SSD MobileNet v1，CDN 加载模型）
- **存储**：SQLite（WAL）

## 致谢

- [face-api.js](https://github.com/justadudewhohacks/face-api.js) — 浏览器端人脸识别

## License

[MIT](./LICENSE) © Group Photo Namer contributors

---

<div align="center">
如果这个工具帮你省下了挨个问名字的时间，欢迎点个 ⭐
</div>
