# scsp-onboard

**用途**：为当前项目初始化 SCSP，通过深度理解代码库生成高质量的 `scsp-manifest.yaml` 和 `host-snapshot.json`。

取代 `scsp init`（基于文件扫描、质量不稳定）和 `scsp snapshot`（基于正则猜测位置）。

---

## 执行流程

### Phase 1 — 运行时与框架识别

读取以下文件（存在则读）：
- `package.json` / `package-lock.json`
- `pyproject.toml` / `requirements.txt` / `setup.py`
- `go.mod`
- `Cargo.toml`
- `Gemfile`
- `pom.xml` / `build.gradle`

从中确定：
- `language`：node / python / go / ruby / java
- `frameworks`：express / nextjs / django / rails / fastapi / gin / electron / …
- `project.name` 和 `project.version`
- `runtime_profile.kind`：
  - 存在 `electron` 依赖 → `electron`
  - 存在 HTTP 框架 → `web`
  - 存在 `bin` 字段但无 HTTP 框架 → `cli`
  - 本地守护进程特征 → `service`

### Phase 2 — 代码库架构探索

用 Glob 找出关键目录，用 Read 抽样关键文件（每类读 2-3 个代表性文件，不要读全部）：

```
目录探索优先级：
1. 路由 / 控制器：src/routes, app/api, controllers, handlers, pages/api
2. 数据模型：src/models, prisma/schema.prisma, src/entities, app/models
3. 中间件 / 钩子：src/middleware, src/hooks, middleware/, plugins/
4. UI 组件：src/components, app/components, components/, src/views
5. 测试：tests/, __tests__/, spec/
```

对每个找到的目录，读 2-3 个代表性文件，形成对架构的真实理解，而非猜测。

### Phase 3 — Surface 识别

基于代码阅读，识别三类 surface：

**entities**（数据模型）：
- ORM 模型（Prisma `model X`、Django `class X(Model)`、ActiveRecord、GORM struct）
- TypeScript interface / class 中对应持久化实体的
- 命名规则：PascalCase，只收录有意义的业务实体（User、Project、Order），过滤掉工具类

**logic_domains**（业务逻辑域）：
- 识别功能域而非目录名：`auth`、`billing`、`notifications`、`search`、`analytics`
- 从路由前缀、模块名、文件夹名综合推断

**ui_areas**（UI 区域，仅 web/electron）：
- 找到布局组件（Layout、Shell、Sidebar、NavBar）中可注入的区域
- 找到设置页面、仪表盘等有"插入点"语义的区域

### Phase 4 — Anchor 识别

**hooks（逻辑注入点）**，命名规则 `{domain}.{flow}.{hook_point}`：

寻找以下模式（读实际文件确认，不要凭猜测）：
```
中间件链：
  - Express/Koa 的 use() 调用链，找 auth 相关中间件之后的空隙
  - Django signals / middleware process_request/response
  - 生命周期回调（beforeSave、afterCreate、onLogin）

事件驱动：
  - EventEmitter.on() / emit() 调用点
  - 消息队列 consumer 入口
  - Webhook 接收处理函数入口

认证流程（最常见，重点识别）：
  - 密码验证成功后、session 创建前：auth.{flow}.post_verify
  - 登录前检查点：auth.{flow}.pre_login
```

**slots（UI 插槽）**，命名规则 `{area}.{location}`：

寻找以下模式：
```
React/Vue/Svelte：
  - {children} 或 <slot> 在布局组件中的位置
  - 配置驱动的组件列表（dashboard widgets、sidebar items）

模板引擎：
  - block / yield 点
  - 可注入的 partial 位置
```

**重要原则**：
- 宁缺毋滥——只声明真正有注入价值的 anchor
- 每个 anchor 必须能在代码里找到对应的物理位置
- anchor 描述要说清楚：何时触发、接收什么参数、能做什么

### Phase 5 — 不确定项确认

将以下问题集中一次问用户（不要每发现一个就打断）：

- 不确定是否应该声明为 surface 的实体（"我看到 `Session` 和 `Token`，这两个需要对外暴露为可扩展实体吗？"）
- 不确定 hook 语义的位置（"这个 `onVerify` 函数看起来可以注入，但我不确定它是在 session 创建前还是后，能确认吗？"）
- runtime_profile.kind 如果不确定

如果代码库清晰，这一步可以直接跳过。

### Phase 6 — 生成 scsp-manifest.yaml

按以下模板生成，所有字段都用真实值填充，不留占位符：

```yaml
scsp_manifest: "0.1"
name: "{project.name}"
version: "{project.version}"
repo: "{git remote origin URL 或 留空}"

surfaces:
  entities: [User, Project, ...]        # PascalCase，仅真实业务实体
  ui_areas: [settings_panel, nav_sidebar, ...]   # snake_case
  logic_domains: [auth, billing, ...]            # snake_case

anchors:
  hooks:
    - id: "{domain}.{flow}.{hook_point}"
      description: "{何时触发} {接收参数} {可以做什么}"
    # ... 每个都有真实代码对应
  slots:
    - id: "{area}.{location}"
      description: "{在哪个组件} {接受什么类型的组件} {注入后渲染在哪}"
    # ... 每个都有真实代码对应
  entities:
    - id: "User"
      core_fields: [id, email, created_at]   # 只列稳定的核心字段
    # ...

hints:
  architecture: "{1-2 句话描述架构：框架、ORM、数据库、主要约定}"
  conventions:
    routes: "{路由文件的路径模式，e.g. app/api/{resource}/route.ts}"
    models: "{模型文件位置，e.g. prisma/schema.prisma}"
    components: "{组件文件位置，e.g. src/components/{Name}.tsx}"
    tests: "{测试文件位置和框架，e.g. tests/{feature}.test.ts using Vitest}"

external_dependencies:
  # 只列对 SCSP 安装有影响的关键依赖（ORM、Auth 库）
  - id: "{dep-name}"
    description: "{为什么能力包安装时需要了解这个依赖}"
    version_constraint: ">={当前版本}"
    impact_scope: [entities]   # or [auth], [billing], etc.

# 仅非 web 宿主需要填写
runtime_profile:
  kind: "{web|electron|cli|service}"
  build:                    # electron/cli 需要
    command: "npm run build"
    artifact: "dist/"
  verify:
    strategy: "{http|ipc|cli|function}"
```

将文件写入项目根目录的 `scsp-manifest.yaml`。

### Phase 7 — 生成 host-snapshot.json

运行：
```bash
npx scsp snapshot
```

如果 CLI 未安装，则手动生成 `host-snapshot.json`，格式如下：

```json
{
  "scsp_host_snapshot": "0.1",
  "generated_at": "{ISO timestamp}",
  "generated_by": "scsp-onboard-skill/0.1",
  "manifest_ref": "scsp-manifest.yaml",
  "manifest_version": "{project.version}",
  "snapshot_hash": "sha256:{取manifest中entities/hooks/slots ID的哈希前16位}",
  "base_version_hash": "git:{运行 git rev-parse HEAD 获取}",
  "entities": [
    {
      "id": "User",
      "fields": ["id", "email", "created_at"],
      "location_hint": "{相对路径}:{行号}",
      "extensible": true
    }
  ],
  "ui_slots": [
    {
      "id": "{slot.id}",
      "framework": "react",
      "location_hint": "{组件文件}:{行号}",
      "mount_type": "inject"
    }
  ],
  "logic_hooks": [
    {
      "id": "{hook.id}",
      "location_hint": "{文件}:{行号}",
      "signature_hint": "{函数签名}",
      "lang": "typescript"
    }
  ],
  "installed_capabilities": []
}
```

所有 `location_hint` 必须是通过实际读取文件确认的真实位置，格式 `相对路径:行号`。

### Phase 8 — 验证

运行：
```bash
npx scsp validate --manifest scsp-manifest.yaml 2>&1 || true
```

如果有 schema 错误，修复后重新验证。

然后运行：
```bash
npx ts-node src/cli.ts validate --manifest scsp-manifest.yaml 2>&1 || true
```

### Phase 9 — 汇报与后续建议

向用户汇报：
```
✓ scsp-manifest.yaml 生成完成
  surfaces:  {N} entities, {N} logic_domains, {N} ui_areas
  anchors:   {N} hooks, {N} slots
  runtime:   {kind}

✓ host-snapshot.json 生成完成
  entities 定位: {N}/{N} 找到物理位置
  hooks 定位:    {N}/{N} 找到物理位置

下一步：
  1. 检查 scsp-manifest.yaml，确认 anchor 描述准确
  2. git add scsp-manifest.yaml host-snapshot.json
  3. 当代码库有重大重构时，运行 /scsp-sync 更新
  4. 社区贡献者可以通过 scsp install <id> 安装能力包
```

列出所有不确定、需要人工确认的地方。

---

## 注意事项

- **不要凭猜测生成 anchor**：每个 anchor 必须能在代码里找到对应位置
- **不要问不必要的问题**：读完代码再说话，大多数信息代码里都有
- **anchor 数量宁少勿多**：3-5 个高质量 anchor 优于 20 个模糊 anchor
- **hints.architecture 要有信息量**：不是"一个 web 应用"，而是"Next.js 14 App Router + Prisma + PostgreSQL，API 路由在 app/api/，认证使用 next-auth"
