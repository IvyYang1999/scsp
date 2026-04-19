# scsp-health

**用途**：检查所有已安装能力包的健康状态——重新验证 anchor 位置是否还有效，contracts 是否还能通过，是否有能力包因为基础代码变更或协议版本升级而"静默损坏"。

用法：
```
/scsp-health
/scsp-health auth-totp-v1          (只检查指定能力包)
/scsp-health --contracts           (同时重跑 contracts，不只检查 probes)
```

---

## 执行流程

### Phase 1 — 读取安装记录

读取 `host-snapshot.json`，获取 `installed_capabilities` 列表。

如果列表为空：输出"未发现已安装的能力包"，结束。

如果指定了能力包 id，只检查该能力包。

### Phase 2 — 获取能力包文件

对每个已安装的能力包：

优先从本地缓存读取：
```bash
ls .scsp-cache/{id}.scsp 2>/dev/null
```

如果本地无缓存，从注册表获取：
```bash
curl -sf "https://raw.githubusercontent.com/IvyYang1999/scsp/main/registry/capabilities/{id}/{id}.scsp"
```

获取失败 → 标记该能力包为"无法验证（能力包文件不可达）"，继续下一个。

### Phase 3 — 协议版本兼容性检查

**这是新增的检查，在 Probe 之前运行。**

对每个能力包，执行版本握手（对应 PROTOCOL.md §20.2）：

```
EXECUTOR_VERSION = "0.1"   # 当前 skill 实现的协议版本

if 能力包有 scsp_compat 字段:
    if EXECUTOR_VERSION 不在 scsp_compat 范围内:
        → 标记为 ✗ 版本不兼容（PROTOCOL_MISMATCH）
        → 输出: "安装时协议: {scsp_protocol_version}，当前执行器: {EXECUTOR_VERSION}，包要求: {scsp_compat}"
        → 跳过该能力包的后续检查
else:
    if 安装记录中 scsp_protocol_version ≠ EXECUTOR_VERSION:
        → 标记为 ⚠ 协议版本漂移（无 scsp_compat 范围声明）
        → 输出: "安装时使用 SCSP {scsp_protocol_version}，当前执行器为 {EXECUTOR_VERSION}，建议包作者添加 scsp_compat 字段"
```

同时检查宿主 app 版本漂移（对应 §20.4）：

```
读取 host-snapshot.json 中该能力包的 host_app_version
读取当前 scsp-manifest.yaml 中的 version

if host_app_version ≠ current_manifest_version:
    → 输出 ⚠ 宿主版本变更: "安装时宿主版本 {host_app_version}，当前 {current_manifest_version}，建议重新运行 Probe 验证"
```

### Phase 4 — Probe 健康检查

对每个能力包，重新运行其 `probes:` 中的所有探针（方式同 `/scsp-install` Phase 1）。

**对比上次安装时的结果**：
- 上次通过，现在仍通过 → ✓ 健康
- 上次通过，现在失败（`on_fail: abort`）→ ✗ 损坏（高危）
- 上次通过，现在失败（`on_fail: warn`）→ ⚠ 退化（对应 optional 组件可能失效）
- 上次跳过，现在能找到 → ℹ 新扩展点可用（可以重新安装以获得完整功能）

### Phase 5 — Contract 验证（仅 `--contracts` 模式）

对每个健康（Probe 全通过）的能力包，重新运行其 `contracts:`：

按 `contract_type` 执行（方式同 `/scsp-install` Phase 6.1）。

记录：通过 / 失败 / 无法验证（服务未运行等）。

对于 `http` 类型的 contract，如果无法连接 localhost，标记为"需要服务运行时验证"而非失败。

### Phase 6 — 检测基础代码变更影响

读取 `host-snapshot.json` 的 `base_version_hash`（上次 snapshot 的 git commit）。

运行：
```bash
git rev-parse HEAD 2>/dev/null
```

如果当前 HEAD 与 `base_version_hash` 不同，检查变更是否触碰了已安装能力包的 anchor 位置：

```bash
git diff {base_version_hash} HEAD --name-only 2>/dev/null
```

对比变更文件列表与各能力包的 `location_hint` 文件，标记有重叠的能力包为"需要重新验证"。

### Phase 7 — 输出健康报告

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SCSP Health Report  —  {timestamp}
  执行器协议版本：SCSP 0.1
  已安装能力包：{N} 个
  基础代码变更：{距上次 snapshot 的 commit 数} 个 commits
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ auth-totp-v1  v1.0.0
    协议兼容：SCSP 0.1 ✓（包声明 >=0.1 <0.3）
    宿主版本：安装时 2.3.1 · 当前 2.3.1 ✓
    Probes: 3/3 通过
    安装时间: 2026-04-10T14:30:00Z

  ⚠ approval-workflow-v1  v1.0.0
    协议兼容：⚠ 无 scsp_compat 声明，安装时 SCSP 0.1 = 当前版本
    宿主版本：安装时 2.3.1 · 当前 2.4.0 ⚠（版本已变更，建议重新验证）
    Probes: 2/3 通过
    - documents.action-bar (slot): 未找到
      → 此 slot 在代码库中消失，UI 组件可能已失效
    建议：运行 /scsp-sync 更新 manifest，或重新安装以适配新结构

  ✗ calendar-week-view-v1  v1.0.0  [损坏]
    协议兼容：SCSP 0.1 ✓
    Probes: 0/1 通过
    - calendar.main-view (abort): 对应文件 app/calendar/page.tsx 不存在
    原因：calendar 模块在最近的重构中被移除
    建议：如已不需要此功能，运行 scsp uninstall calendar-week-view-v1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  汇总：1 健康 · 1 退化 · 1 损坏

  下一步：
  - approval-workflow-v1：运行 /scsp-sync 修复 anchor 位置
  - calendar-week-view-v1：确认是否需要卸载（功能已移除）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Phase 8 — 更新 Snapshot

将 `host-snapshot.json` 的以下字段更新：
- `generated_at`：当前时间
- `base_version_hash`：当前 git HEAD

**不修改** `installed_capabilities`（健康检查不改变安装记录，只反映现状）。

---

## 状态定义

| 状态 | 含义 | 建议行动 |
|------|------|---------|
| ✓ 健康 | 所有 abort probe 通过，协议版本兼容，宿主版本未变 | 无需操作 |
| ⚠ 退化 | warn probe 失败、宿主版本漂移、或缺少 scsp_compat 声明 | /scsp-sync 或重新安装 |
| ✗ 损坏 | abort probe 失败 | 排查原因，考虑卸载或重新安装 |
| ✗ 版本不兼容 | 包的 scsp_compat 不包含当前执行器版本 | 等待包作者发布兼容版本，或降级执行器 |
| ? 无法验证 | 能力包文件不可达 | 检查网络或注册表 |

---

## 注意事项

- **不要自动修复**：health check 只报告，不改代码；修复需要用户明确触发 `/scsp-install` 或 `/scsp-sync`
- **区分"能力包损坏"和"代码库变更"**：calendar 模块被移除是开发者决策，不是能力包的问题，报告要说清楚根因
- **Contract 验证是可选的**：默认只跑 probes（快），加 `--contracts` 才跑完整验证（需要服务在运行）
- **协议版本检查先于 Probe**：版本不兼容的能力包不运行 Probe，避免误报或静默损坏
