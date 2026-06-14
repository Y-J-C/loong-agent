# scripts 说明

当前 preview v0.1 未纳入正式可执行脚本。

原整理要求中提到的以下脚本尚未完成正式验收：

```text
collect_env.sh
check_software_stack.sh
check_peripherals_readonly.sh
```

为避免误导，本目录暂不伪造脚本文件。后续如补充脚本，必须满足：

1. 默认只读；
2. 每个命令标注作用和风险；
3. 不安装软件；
4. 不升级系统；
5. 不修改网络；
6. 不修改 `/boot`；
7. 不执行 fsck、fdisk、parted、mkfs、dd；
8. 不接线测试外设；
9. 可在执行前人工审阅。
