# FlowDesk Git 新人排障手册

## 当前分支没有 upstream

报错特征：

```text
fatal: The current branch feature/fd-124-priority-filter has no upstream branch
```

建议命令：

```bash
git push -u origin feature/fd-124-priority-filter
```

## Merge 冲突

报错特征：

```text
CONFLICT (content): Merge conflict in flowdesk/tickets/service.py
```

处理步骤：

1. 打开冲突文件，保留 Dev A 的 priority filter 和 Dev B 的排序逻辑。
2. 运行 `git add flowdesk/tickets/service.py`。
3. 运行 `git commit -m "merge main into FD-124 priority filter"` 完成 merge commit，避免 TUI 中打开 Vim。

禁止在未理解冲突的情况下强推。

## Remote 或权限问题

先检查：

```bash
git remote -v
```

确认 remote URL、登录身份和仓库权限。
