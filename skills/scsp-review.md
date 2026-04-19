# scsp-review

**用途**：对传入的 `.scsp` 能力包文件进行深度代码感知审核——不只校验 schema，而是对照当前代码库验证能力包的声明是否真实、安全、可安装。

适用场景：
- 维护者审核社区提交的 capability PR
- 作者在发布前自我审查
- 安装前对某个能力包做尽职调查

用法示例：
```
/scsp-review examples/capabilities/auth-totp.scsp
/scsp-review registry/capabilities/auth-totp-v1/auth-totp-v1.scsp
/scsp-review https://github.com/.../auth-totp-v1.scsp   （从 URL 读取）
```

---

## 执行流程

### Phase 1 — 读取被审核文件

Read 指定的 `.scsp` 文件（或从 URL fetch）。

同时读取：
- `scsp-manifest.yaml`（了解宿主声明了什么）
- `host-snapshot.json`（了解当前代码库实际状态）

如果这两个文件不存在，说明当前项目尚未 SCSP 化，审核将仅做协议层校验，无法做代码库感知检查。

### Phase 2 — Schema 快速验证

运行：
```bash
npx scsp validate {文件路径} 2>&1
```

记录结果。Schema 失败不终止审核，继续后续检查并在最终报告中汇总。

### Phase 3 — 声明与代码库对照

对能力包中声明的每个 anchor，逐一验证：

**Probe 可行性检查**：
```
对每个 probe：
1. 读取 probe.check_hints 中的 patterns 和 paths
2. 用 Grep 在当前代码库中实际执行搜索
3. 判断：
   - ✓ 能找到：probe 可行
   - ⚠ 在错误位置找到：probe 路径需要调整
   - ✗ 找不到：probe 在本代码库上会失败
     → 判断是 on_fail: abort 还是 warn
     → 如果是 abort，能力包无法在本代码库安装
```

**Surface 权限检查**：
```
能力包声明的 surfaces_writable 是否都在宿主 manifest 的 surfaces 中？
能力包声明的 schema_migration: true 是否得到宿主 manifest 授权？
能力包声明的 external_deps 是否与现有依赖有版本冲突？
```

**Anchor 存在性检查**：
```
能力包 requires.anchors 中的每个 anchor id，是否都在宿主 manifest 中声明？
```

### Phase 4 — Blast Radius 真实性评估

对比能力包声明的 `blast_radius` 与实际分析：

```
声明：structural_impact: [Route, Middleware]
实际：读取 probe 定位到的文件，评估修改这些文件的真实影响范围
  - 这个中间件被多少路由依赖？
  - 修改这个 Entity 会触发哪些级联变更？
  - 是否有未声明的隐式依赖？
```

如果实际 blast_radius 明显大于声明值，标记为高风险。

### Phase 5 — NCV 充分性检查

对能力包声明的权限，检查 NCV 是否覆盖了对应的约束：

```
规则：
  surfaces_writable 包含 auth → 应有 NCV 约束"不得绕过认证检查"
  external_deps 中有网络请求库 → 应有 NCV 约束"不得向未声明域名发送请求"
  schema_migration: true → 应有 NCV 约束"down migration 不得删除非本能力包添加的字段"
  ui_areas 相关 → 应有 NCV 约束"不得注入脚本标签"或"不得访问 DOM 之外的 API"
```

如果能力包声明了敏感权限但 NCV 不完整，标记为安全风险。

### Phase 6 — Contracts 可执行性检查

对每个 contract：

```
1. 检查 contract_type 是否匹配宿主的 verify.strategy
2. 对 http 类型：检查 action.path 在当前代码库中是否存在对应路由
3. 对 ipc 类型：检查 action.channel 是否在代码库中有对应的 ipcMain.handle
4. 检查 fixtures 中的数据是否与当前 entity 字段结构兼容
5. 检查 contracts 中 $fixture.xxx 引用是否都在 fixtures 中定义
```

### Phase 7 — 签名验证

```bash
npx scsp validate {文件路径} --json 2>&1
```

检查 `signature_verified` 字段。

如果签名是 placeholder（`ed25519:...placeholder...`），标记为"发布前需替换真实签名"。
如果签名验证失败，标记为安全风险。

### Phase 8 — 生成审核报告

输出结构化报告：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SCSP Capability Review: {id} v{version}
  审核时间: {timestamp}
  宿主: {project.name} ({manifest 存在 → 完整审核 / 不存在 → 协议层审核})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【Schema 校验】
  {✓ 通过 / ✗ 失败 + 具体错误列表}

【Probe 可行性】（共 N 个）
  ✓ 可行：auth.password_login.post_verify → src/middleware/auth.ts:42
  ⚠ 路径需调整：settings.security → 建议改为 app/settings/security/page.tsx
  ✗ 无法找到：User.totp_enabled → 当前代码库无此字段，probe 将失败（on_fail: abort）

【权限与 Surface】
  ✓ surfaces_writable: [auth, User] — 均在宿主 manifest 中授权
  ✓ schema_migration: true — 宿主 manifest 允许
  ⚠ external_deps: [otplib] — 与现有 crypto 库可能存在功能重叠，建议说明选型原因

【Blast Radius 评估】
  声明：structural_impact: [Route, Middleware, DatabaseSchema], dependency_depth: 2
  实际评估：{基本准确 / 低估（实际影响了 X 个路由）/ 高估}

【NCV 充分性】
  ✓ 声明了 no-filesystem-write（与 auth 权限匹配）
  ✗ 缺少约束：能力包引入 axios，但未声明"不得向未声明域名发送请求"

【Contracts 可执行性】（共 N 个）
  ✓ valid_totp_allows_login — POST /auth/2fa/enable 路由存在，fixture 字段兼容
  ✗ contract-lockout-after-5 — 引用了 $fixture.rate_limited_user，但 fixtures 中未定义

【签名】
  {✓ 有效签名 / ⚠ placeholder，发布前需替换 / ✗ 签名验证失败}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【总结】

  阻断性问题（必须修复才能安装）：
    1. Probe `settings.security` 在本代码库找不到对应代码
    2. Contract `contract-lockout-after-5` 引用了未定义的 fixture

  警告（建议修复）：
    1. NCV 缺少对 axios 网络请求的约束
    2. external_deps 选型需要说明

  建议通过条件：修复上述 2 个阻断性问题后可安装
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 注意事项

- **区分"在本代码库不可安装"和"能力包本身有问题"**：probe 找不到可能是正常的（`on_fail: warn`），但如果所有 required anchor 都找不到，则无法安装
- **NCV 审查要结合权限声明**：不是检查 NCV 数量，是检查权限对应的约束是否存在
- **给出可操作的建议**：不只说"这里有问题"，要说"建议改为..."
