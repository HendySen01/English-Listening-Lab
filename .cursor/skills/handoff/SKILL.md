---
name: handoff
description: >-
  Keeps a short project handoff so a new chat can resume without scanning the
  whole repository. Use when the user says 交接棒, 用交接棒, 准备换新对话,
  整理交接, or 交接棒接着干, and whenever a multi-step task should maintain
  计划书.md and 进度.md. Read AGENTS.md, the plan, the progress file, and only
  the code needed to verify state. Do not record plans as finished work, and do
  not migrate databases, call paid AI, commit, push, or deploy merely to update
  the handoff.
---

# 交接棒

把跨对话继续工作所需的事实留在项目里，而不是留在聊天记录里。计划、进度和代码状态经常不一致；交接棒先核对，再写短记录。

## 文件位置

项目根目录以当前工作区和该项目的 `AGENTS.md` 为准。`D:\Skill` 只放 Skill，不是项目根。

在项目根的 `docs` 目录使用已有文件。没有同用途文件时才新建：

- `docs/计划书.md`：要做什么，以及每项现在处于哪种状态。
- `docs/进度.md`：已经做过什么、测到了什么、还没解决什么、下一步是什么。

如果项目已经有承担这两项用途的文档，沿用原文件，不另起一套，也不覆盖设计说明、调研或其他无关文档。

## 状态词

每条事项只用这些词，不能把预期写成已完成：

- **计划中**：还没实施。
- **已实现**：代码或文件里已经有，但本轮没有重新验证。
- **已验证**：本轮用命令、测试、只读查询或实际操作确认过。
- **失败**：做过，但结果不符合要求。
- **待确认**：证据不足，或需要用户决定。

## 开始一轮工作

1. 读项目 `AGENTS.md`（若存在）、`docs/计划书.md` 和 `docs/进度.md`。
2. 只打开这一步要改或要核对的代码。不要为了恢复上下文重新扫整个仓库。
3. 用户说「交接棒接着干」时，先按进度里的下一步核对关键事实，再继续。旧文档和当前代码冲突时，以当前代码和命令结果为准，并在进度里记下差异。
4. 多步骤任务在动手前更新计划书：写明本轮范围、不允许做的事，以及哪些项仍是计划中。

## 完成一个关键步骤

更新 `docs/进度.md`，只保留能让下一次对话接着做的内容：

- 已完成的具体文件或行为。
- 实际测试结果。没跑的测试写成未验证，不要写通过。
- 未解决的问题。
- 下一步，一步即可。

进度记录本身不是授权。不要为了把状态写成已验证而去迁移数据库、调用付费 AI、Commit、Push 或部署。

## 准备换对话

用户说「用交接棒」「准备换新对话」或「整理交接」时：

1. 看 `git status --short` 和当前分支。不要提交。
2. 核对计划书里标成已验证的事项是否仍有证据。没有证据就改回已实现或待确认。
3. 更新计划书和进度。交接文字要短，不复制长聊天记录。
4. 不写入 API Key、数据库密码、完整连接 URL、令牌或个人敏感信息。

## 继续时的边界

下一轮只做进度里写明且用户本轮仍然授权的事。生产库、付费调用、部署和不可逆操作必须有当轮的明确授权；旧进度不能代替授权。
