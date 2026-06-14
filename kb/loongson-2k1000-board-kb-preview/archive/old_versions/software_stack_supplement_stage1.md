# software_stack_supplement.md - 第一阶段补充

> 本文件不是第一阶段需求中的强制交付物，但用于澄清 pip 状态，避免报告表述不一致。

| 软件 | 命令 | 状态 | 版本/路径 | 结论 |
|---|---|---|---|---|
| pip | `which pip` | 失败 | 无 | `pip` 命令不可用 |
| pip3 | `which pip3` | 成功 | `/usr/bin/pip3` | `pip3` 命令可用 |
| python3 -m pip | `python3 -m pip --version` | 成功 | pip 24.0 from `/home/loongson/.local/lib/python3.7/site-packages/pip` | Python3 的 pip 模块可用 |
| import pip | `python3 -c "import pip; ..."` | 成功 | `24.0 /home/loongson/.local/lib/python3.7/site-packages/pip/__init__.py` | pip 安装在用户目录 |

结论：报告中应写“pip 命令不可用；pip3 和 python3 -m pip 可用，版本 24.0，位于用户目录”，不能再写“pip 完全缺失”。
