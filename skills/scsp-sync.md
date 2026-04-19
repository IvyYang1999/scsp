# scsp-sync

**用途**：代码库发生变化后，同步更新 `scsp-manifest.yaml` 和 `host-snapshot.json`，检测 anchor 失效、新增扩展点、签名变更。

适用场景：
- 重构后 anchor 的物理位置变了
- 新增了模块，有新的 surface 或 anchor 可声明
- 删除了功能，需要废弃对应 anchor
- 定期维护（建议每次大版本发布前运行）

---

## 执行流程

### Phase 1 — 读取现有状态

依次读取：
1. `scsp-manifest.yaml` — 当前声明的 surfaces 和 anchors
2. `host-snapshot.json` — 上次快照的 location_hint 和 installed_capabilities
3. 运行 `git log --oneline -20` 了解近期变更方向

### Phase 2 — Anchor 存活检查

对 `host-snapshot.json` 中每个 `logic_hooks` 和 `ui_slots` 的 `location_hint`，验证其是否仍然有效：

```
对每个 location_hint（格式：文件路径:行号）：
1. 用 Read 读取该文件
2. 检查该行附近是否仍然有 anchor 对应的代码模式
3. 标记状态：✓ 有效 / ⚠ 位置漂移（文件存在但代码已移动）/ ✗ 失效（文件不存在或模式消失）
```

对 `entities` 的 `location_hint`，同样验证对应的类/模型定义是否仍然存在。

### Phase 3 — 漂移修复

对每个标记为"位置漂移"或"失效"的 anchor：

**位置漂移**（文件重命名/代码移动）：
- 用 Grep 搜索原来的代码模式，找到新位置
- 更新 `location_hint`

**失效**（代码删除或架构变更）：
- 判断是否应该废弃这个 anchor
- 如果废弃：在 manifest 中将该 anchor 加上 `deprecated_by` 和 `sunset` 字段
  ```yaml
  anchors:
    hooks:
      - id: "auth.password_login.post_verify"
        deprecated_by: "auth.login.post_verify"
        sunset: "{6个月后的日期}"
  ```
- 如果该 anchor 只是重命名：同时声明新 anchor，废弃旧 anchor
- 如果该功能真的删除了：在 manifest 中移除（但先告知用户，已安装该 anchor 的能力包会失效）

### Phase 4 — 新扩展点发现

扫描 `git diff` 或近期新增文件，寻找值得声明的新 anchor：

```bash
git diff HEAD~10..HEAD --stat
```

重点关注：
- 新的中间件或钩子函数（→ 可能是新 hook）
- 新的布局组件或配置驱动的 UI 区域（→ 可能是新 slot）
- 新的 ORM 模型或 TypeScript 接口（→ 可能是新 entity surface）

对每个发现的候选项，简短描述并询问用户是否要声明。

### Phase 5 — 签名变更检测

对已声明 hook 的函数签名，检查是否有变化：

```
对每个 logic_hook：
1. 定位到 location_hint 对应的文件
2. 提取当前的函数签名
3. 对比 snapshot 中记录的 signature_hint
4. 如有变化：更新 signature_hint 并标记警告（已安装的能力包可能受影响）
```

### Phase 6 — 重新生成 host-snapshot.json

更新 snapshot 中所有已修正的字段：
- 所有 `location_hint`（修复漂移的）
- 所有 `signature_hint`（有变化的）
- `generated_at`（当前时间）
- `base_version_hash`（运行 `git rev-parse HEAD` 获取）
- `snapshot_hash`（重新计算）

**不要修改** `installed_capabilities`，保留已安装记录。

### Phase 7 — Manifest 更新（如需）

仅在以下情况修改 `scsp-manifest.yaml`：
- 有 anchor 需要加 `deprecated_by`
- 用户确认了新的 surface 或 anchor 需要声明
- `hints.architecture` 严重过期

修改 manifest 前必须告知用户影响。

### Phase 8 — 运行验证

```bash
npx scsp validate --manifest scsp-manifest.yaml 2>&1 || true
```

如果有错误，修复。

### Phase 9 — 汇报

```
scsp-sync 完成

Anchor 检查结果：
  ✓ 有效：{N} 个
  ⚠ 位置漂移（已修复）：{列出 anchor id 和新位置}
  ✗ 失效（已废弃）：{列出 anchor id}

新发现的扩展点：
  {列出建议声明但未采纳的，供日后参考}

签名变更：
  {列出签名有变化的 hook，提示相关能力包可能需要更新}

已安装的能力包：{N} 个（请用 scsp health 验证它们是否仍然正常）
```

---

## 注意事项

- **废弃优于删除**：已有用户安装的能力包可能依赖旧 anchor，贸然删除会造成静默失效
- **不要自作主张新增大量 anchor**：新 anchor 是 manifest 作者的决策，不是自动推断的
- **签名变更是高风险信号**：hook 函数签名变了，说明已安装的能力包可能在下次 health check 时失败，主动告知用户
