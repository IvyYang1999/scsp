# scsp-explore

**用途**：智能探索 SCSP 注册表，基于对当前代码库的真实理解，推荐最适合安装的能力包——不是关键词匹配，而是理解你的项目缺什么。

相比 `scsp explore` CLI（基于 surface 标签做简单加权排序），Skill 版本读懂代码库后给出有理由的推荐。

用法：
```
/scsp-explore
/scsp-explore "我想给用户加 2FA"
/scsp-explore --tag auth
/scsp-explore --surface User
```

---

## 执行流程

### Phase 1 — 读取项目现状

读取（存在则读）：
- `scsp-manifest.yaml` — 了解项目声明了哪些 surfaces 和 anchors
- `host-snapshot.json` — 了解已安装了哪些能力，以及当前 entity 结构

如果两者都不存在，提示运行 `/scsp-onboard`，然后继续（以"未初始化项目"模式运行，推荐范围更广）。

抽样读取 2-3 个关键文件，理解项目的核心业务域（不需要读全部）：
- 主路由文件（了解功能边界）
- 主数据模型（了解业务实体）
- README.md（了解项目用途）

### Phase 2 — 获取注册表索引

```bash
curl -sf "https://raw.githubusercontent.com/IvyYang1999/scsp/main/registry/index.json" 2>&1
```

解析 index.json 中的 capabilities 列表。

如果有本地 `registry/index.json`（在当前目录），优先使用本地版本。

### Phase 3 — 智能匹配与推荐

结合以下维度评分：

**兼容性**（最重要）：
- 能力包 `requires.surfaces` 是否是项目 surfaces 的子集
- 能力包 `requires.anchors` 是否在项目 manifest 中声明
- `compatibility_score`（注册表元数据中的历史安装成功率）

**相关性**（基于 AI 理解）：
- 用户查询意图（如果有）与能力包 intent 的语义匹配度
- 能力包解决的问题，项目中是否真的缺失
  - 例：项目有 User entity + auth domain，但 host-snapshot 中无 totp_enabled 字段 → auth-totp 高度相关
  - 例：项目没有 calendar surface → calendar-week-view 不相关

**质量信号**：
- `active_installs`（活跃安装数）
- `rollback_rate`（`reports.rollback / reports.installs`，越低越好）
- `signed: true`（有签名）

**已安装排除**：
- `host-snapshot.json` 中已存在的 capability id 不再推荐
- 与已安装能力有 `conflicts` 关系的，标注冲突而非推荐

### Phase 4 — 输出推荐结果

按推荐度从高到低列出，每条包含：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. auth-totp-v1  ·  TOTP Two-Factor Authentication
     ★★★★★ 兼容  |  94% 安装成功率  |  147 活跃安装

     推荐理由：
     你的项目有 auth domain 和 User entity，但 User 中没有 totp_secret 字段。
     这个能力包会在 auth.password_login.post_verify hook 注入 TOTP 验证，
     并向 User 添加 totp_secret / totp_enabled 两个字段（含 down migration）。

     需要的 anchor：auth.password_login.post_verify ✓（已在 manifest 中）
     跳过的组件：totp-settings-ui（settings.security slot 不在你的 manifest 里）

     安装：/scsp-install auth-totp-v1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  2. approval-workflow-v1  ·  Document Approval Workflow
     ★★★☆☆ 部分兼容  |  88% 安装成功率  |  203 活跃安装

     推荐理由：
     你有 Document entity 和 logic_domains.notifications，符合此能力包的主要需求。
     但 documents.action-bar slot 未在你的 manifest 中声明，UI 组件会被跳过，
     只有后端审批状态机会被安装。

     ⚠ 需要注意：
     你的 Notification 模型中没有 status 字段，migration 将新增此字段。

     安装：/scsp-install approval-workflow-v1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  3. perf-image-lazy-load-v1  ·  Image Lazy Loading
     ★★★★☆ 兼容  |  97% 安装成功率  |  412 活跃安装

     推荐理由：
     你的项目使用 React（检测到 react 依赖），页面中有 <img> 标签。
     此能力包无副作用，纯改进，零依赖，回滚简单。

     安装：/scsp-install perf-image-lazy-load-v1
```

**不推荐的说明**（如果查询意图有明确目标但注册表里没有）：
```
  未找到与 "{query}" 相关的能力包。

  你可以：
  1. 自己实现后用 /scsp-pack 打包分享给社区
  2. 浏览完整注册表：scsp search
```

### Phase 5 — 引导下一步

```
找到 {N} 个推荐能力包。

运行 /scsp-install <id> 安装，或 scsp info <id> 查看详细元数据。
```

---

## 注意事项

- **推荐理由要具体**：不是"这个能力包和你的项目相关"，而是"你的 User entity 缺少 totp_secret 字段，这个能力包会添加它"
- **说清楚会跳过什么**：如果某个 slot 不存在导致 UI 组件被跳过，主动说明，避免用户安装后困惑
- **排除已安装**：不要推荐已经在 installed_capabilities 里的能力包
