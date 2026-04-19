# scsp-install

**用途**：在当前项目中安装一个 SCSP 能力包，完整执行六阶段安装管道。

相比 `scsp install` CLI（需要独立 ANTHROPIC_API_KEY、靠独立 API 调用理解代码库），Skill 版本直接在 Claude Code 会话中运行，天然拥有完整代码库上下文，无需额外 API key，且每一步都可以对话确认。

用法：
```
/scsp-install auth-totp-v1
/scsp-install auth-totp-v1 --registry https://raw.githubusercontent.com/.../registry
/scsp-install ./my-local-capability.scsp
/scsp-install --dry-run auth-totp-v1
```

---

## 执行前准备

读取以下文件（不存在则继续，但记录缺失）：
- `scsp-manifest.yaml` — 宿主扩展契约
- `host-snapshot.json` — 当前已安装能力和锚点位置

如果两者都不存在：提示用户先运行 `/scsp-onboard`，然后停止。

解析命令行参数：
- 第一个非 flag 参数：capability id 或本地 `.scsp` 文件路径
- `--registry <url>`：从指定注册表获取
- `--dry-run`：只走到 Phase 4，不实际写文件

---

## Phase 1 — PROBE：扫描扩展点

### 1.1 获取能力包

**本地文件**（参数以 `.scsp` 结尾或以 `./` 开头）：
- 直接 Read 该文件

**注册表 ID**：
```bash
curl -sf "https://raw.githubusercontent.com/IvyYang1999/scsp/main/registry/capabilities/{id}/{id}.scsp" 2>&1
```
或用指定的 `--registry` URL。

解析能力包：提取 frontmatter（YAML）和 sections（probes / ncv / contracts / fixtures / interfaces）。
如果解析失败，报错停止。

### 1.2 运行 Probes

对能力包 `probes:` 中的每一条，按 `check_hints` 在代码库中实际搜索：

```
对每个 probe：
  anchor_ref: "auth.password_login.post_verify"
  check_hints:
    - lang: typescript
      type: grep
      patterns: ["signIn.*callback", "post.*verify"]
      paths: ["app/api/auth", "lib/auth"]

执行：
  用 Grep 在 paths 下搜索 patterns（逐个 pattern 尝试）
  找到 → 记录 location（文件路径:行号），标记 ✓ PASSED
  找不到 → 检查 on_fail：
    abort → 记录 ✗ FAILED（致命），标记为 abort_reason
    warn  → 记录 ⚠ SKIPPED，对应 component 标记为 skip
```

**Probe 阶段结果判定**：
- 任何 `on_fail: abort` 的 probe 失败 → 停止，输出失败原因
- 只有 `on_fail: warn` 的 probe 失败 → 继续，相关 optional 组件标记为 skip

汇报：
```
[1/6] PROBE — 扫描扩展点
  ✓ auth.password_login.post_verify → app/api/auth/[...nextauth]/route.ts:47
  ✓ User (entity)                   → prisma/schema.prisma:model User
  ⚠ settings.security (slot)        → 未找到，totp-settings-ui 组件将跳过
```

---

## Phase 2 — VALIDATE：兼容性检查

依次检查（任何一项失败都停止）：

**2.1 Surface 兼容性**：
能力包 `requires.surfaces` 中的每个 surface，必须出现在 `scsp-manifest.yaml` 的 `surfaces` 中。

**2.2 Anchor 存在性**：
能力包 `requires.anchors` 中的 hooks/slots/entities，必须出现在 manifest 的 `anchors` 中。

**2.3 冲突检测**：
能力包 `conflicts:` 中列出的 id，如果出现在 `host-snapshot.json` 的 `installed_capabilities` 中，报冲突错误。

**2.4 权限检查**：
能力包每个 component 的 `permissions.surfaces_writable`，必须是 manifest `surfaces` 的子集。
`permissions.schema_migration: true` 需要 manifest 中 `allow_schema_migration: true`（若 manifest 有此字段）。

汇报：
```
[2/6] VALIDATE — 兼容性检查
  ✓ surfaces: [entities, logic_domains, ui_areas] — 均在宿主 manifest 中
  ✓ anchors:  auth.password_login.post_verify, User — 均已声明
  ✓ 无冲突
  ✓ 权限: schema_migration 授权
```

---

## Phase 3 — DRY-RUN：生成变更

这是最需要 AI 能力的阶段。

### 3.1 读取上下文

读取 Probe 找到的所有文件（loc_hint 中的文件），理解当前代码结构。

对每个需要修改或新建的文件，先读取现有内容。

### 3.2 生成具体变更

基于：
- 能力包的 `## Intent` 描述（理解目标）
- 能力包的 `interfaces:` 声明（理解 API 契约）
- 能力包的 `components:` 列表（理解修改范围）
- Probe 找到的具体文件和行号（理解注入点）
- NCV 约束（理解禁止事项）
- 当前代码库的实际结构（已读取）

为每个 non-skipped component 生成具体变更：
- **新建文件**：生成完整文件内容
- **修改文件**：精确到行，生成 diff 或描述具体修改
- **Schema migration**：生成 SQL 或 ORM migration 文件
- **依赖**：列出 `npm install xxx` 或 `pip install xxx`

### 3.3 NCV 自检

对生成的代码，逐条检查 `ncv:` 约束：
```
ncv 条目：no-filesystem-write
  检查生成代码是否包含 fs.write / writeFile / createWriteStream
  → 通过 / 违反（critical → 终止 dry-run）
```

### 3.4 展示 Dry-Run 报告

```
[3/6] DRY-RUN — 变更预览

  新建文件：
    + src/middleware/totp.ts        (TOTP 验证中间件)
    + src/routes/auth/2fa.ts        (2FA API 路由)
    + migrations/20260419_totp.sql  (数据库迁移)

  修改文件：
    ~ src/routes/auth/login.ts      (+12 / -2 行，在 post_verify hook 点注入 TOTP 检查)
    ~ src/models/user.ts            (+3 行，添加 totp_secret 和 totp_enabled 字段)

  依赖：
    + otplib@^12.0.1

  跳过的组件：
    - totp-settings-ui (slot settings.security 未找到)

  NCV 检查：
    ✓ no-filesystem-write
    ✓ no-outbound-network
```

如果是 `--dry-run` 模式，到此停止，告知用户去掉 `--dry-run` 再运行即可安装。

---

## Phase 4 — CONFIRM：人工确认

展示每个变更文件的具体内容（新建文件全量，修改文件显示 diff）。

**对话式确认**，等待用户明确回复：

```
以上变更将被应用到您的代码库。

  Risk factors（自动评估）：
    - schema_migration: true（数据库结构变更，请确认有备份）
    - 修改了认证流程（auth surface），会影响所有登录请求

  请选择：
    [y] 应用所有变更
    [s] 跳过所有 optional 组件，只安装核心组件
    [n] 取消安装
```

用户回复 `n` 或任何取消意图 → 停止，不写任何文件。
用户回复 `s` → 将所有 optional 组件移入 skip 列表。
用户回复 `y` 或 apply → 进入 Phase 5。

**在用户确认之前，不得写入任何文件。**

---

## Phase 5 — APPLY：写入变更

按 component `depends_on` 依赖顺序依次执行（拓扑排序）。

### 5.1 写文件

对每个变更：
- **新建**：用 Write 工具写入完整内容
- **修改**：用 Edit 工具精确修改（old_string → new_string），不要整个文件重写

### 5.2 安装依赖

```bash
npm install {dep}@{version}   # 或 pip install / go get 等
```

### 5.3 运行 Schema Migration

如果有 `migrations/` 目录下的 SQL 文件，尝试：
```bash
# PostgreSQL
psql $DATABASE_URL -f migrations/20260419_totp.sql
# 或通过 ORM（如 Prisma）
npx prisma migrate dev --name totp-fields
```
如果 migration 命令失败，立即触发 Phase 5 回滚。

### 5.4 Build 步骤（非 web 宿主）

如果 `scsp-manifest.yaml` 的 `runtime_profile.build.command` 存在，执行之：
```bash
{build.command}
```
失败则回滚。

### 5.5 保存安装快照

向 `host-snapshot.json` 的 `installed_capabilities` 数组追加：
```json
{
  "id": "{capability.id}",
  "version": "{capability.version}",
  "installed_at": "{ISO timestamp}",
  "components_applied": ["{applied component ids}"],
  "anchors_used": ["{used anchor ids}"],
  "rollback_type": "stateless"
}
```

汇报：
```
[5/6] APPLY — 写入变更
  ✓ src/middleware/totp.ts       已创建
  ✓ src/routes/auth/2fa.ts       已创建
  ✓ src/routes/auth/login.ts     已修改
  ✓ src/models/user.ts           已修改
  ✓ migrations/20260419_totp.sql 已创建
  ✓ otplib@12.0.1                已安装
  ✓ Migration 已执行
  ✓ 快照已更新
```

---

## Phase 6 — VERIFY：验证安装

### 6.1 运行 Contracts

对能力包 `contracts:` 中每个 contract，按 `contract_type` 执行验证：

**`http`（默认）**：
```bash
# 启动开发服务器（如果没运行）
# 发送 HTTP 请求验证
curl -X POST http://localhost:3000{action.path} \
  -H "Content-Type: application/json" \
  -d '{action.body with fixtures}'
# 检查 assertions（status code、response body 字段）
```

**`function`**：
生成一个最小验证脚本，import 相关模块，调用函数，检查返回值：
```bash
node -e "
  const { verifyTotpHook } = require('./src/middleware/totp');
  const result = verifyTotpHook(fixture, '123456');
  console.assert(result.allowed === false);
  console.log('✓ contract passed');
"
```

**`ipc`**（Electron）：
提示用户：启动 app 后，在 DevTools console 执行：
```js
await window.scsp.verify('{channel}', {args})
// 期望返回：{expected}
```

**`cli`**：
```bash
{action.command} {action.args.join(' ')}
# 检查 exit_code 和 stdout
```

### 6.2 处理验证结果

| 结果 | 条件 | 行为 |
|------|------|------|
| ✓ 完全成功 | 所有 non-optional contracts 通过 | 完成安装，输出成功摘要 |
| ⚠ 部分成功 | optional contract 失败但 side_effects_isolated | 更新快照，警告用户 |
| ✗ 回滚 | 任何 non-optional contract 失败 | 执行回滚（见下方） |

### 6.3 回滚程序

如果 VERIFY 失败（或 APPLY 中途失败）：

1. 对每个已写入的文件：
   - 新建的文件 → 删除（Bash `rm`）
   - 修改的文件 → 用 Edit 恢复原内容（CONFIRM 前应已保存原始内容）
2. 运行 schema migration `down` SQL（如果有）
3. 从 `host-snapshot.json` 的 `installed_capabilities` 移除刚加入的记录
4. 报告：`✗ 安装失败，已回滚到安装前状态`

---

## 最终输出

**成功**：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ {capability.name} v{version} 安装完成

  4 个 contracts 通过 · 可用 /scsp-health 检查运行状态
  如需回滚：scsp rollback {id}（V0.2 功能）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**失败**：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✗ 安装失败：{具体失败原因}
  已回滚，代码库恢复到安装前状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 注意事项

- **Phase 4 确认之前，绝对不写任何文件**
- **Edit 优于 Write**：修改文件用 Edit 精确替换，不整体重写（方便追踪变更）
- **回滚必须完整**：如果 APPLY 或 VERIFY 失败，确保所有写入都被撤销
- **Schema migration 的回滚**：down SQL 必须在 Phase 5 开始前读取并保存，回滚时直接执行
- **不要自动重启服务**：VERIFY 的 http 合约需要服务在运行，如果服务没运行，提示用户手动启动后再运行 `/scsp-health`
