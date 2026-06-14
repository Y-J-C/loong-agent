# 开发环境决策表

本表用于第四阶段选型。表中的“可行”只表示当前证据下具备基础运行或构建条件；涉及完整项目、外设、远程 IDE、GUI、数据库服务等方向时，仍需执行对应验证命令后再升级结论。

| 开发方式 | 是否可行 | 约束 | 风险 | 推荐等级 | 原因/证据 | 验证命令 |
| --- | --- | --- | --- | --- | --- | --- |
| C 本地开发 | 可行 | 适合小型 C 程序、系统探测、轻量本地构建；不建议把板子当重型构建机。 | 中 | 推荐 | gcc 8.3.0、cc、make 4.2.1、cmake 3.13.4、binutils 可用；内存约 1.4GiB，根分区可用约 1.9G。 | `gcc --version`；`make --version` |
| CMake 项目 | 可行但受版本约束 | CMake 3.13.4 可用，但版本偏旧；适合简单 C/CMake 项目，现代 CMake 特性需验证。 | 中 | 谨慎推荐 | cmake --version 为 3.13.4；gcc/make/binutils 可用；g++ 缺失会限制 C++ CMake 项目。 | `cmake --version` |
| C/C++ 完整源码构建 | 受限 | g++、c++ 缺失；build-essential 未安装，仅有 apt candidate；不能默认支持 C++ 构建。 | 高 | 暂不推荐 | g++ --version 和 c++ --version 均 not found；build-essential 为 not installed，candidate exists。 | `g++ --version`；`dpkg-query -W build-essential` |
| Git 版本管理 | 可行 | 可做 clone、checkout、diff、commit 等基础操作；版本偏旧，复杂新特性需验证。 | 低-中 | 推荐 | git version 2.20.1；git package installed。 | `git --version` |
| Python 脚本与轻量服务 | 可行 | Python 3.7.3 偏旧；pip 命令不在 PATH；统一使用 python3 -m pip。 | 中 | 推荐 | python3 3.7.3 可用；python3 -m pip 为 pip 24.0；venv、sqlite3、ssl 模块可导入。 | `python3 --version`；`python3 -m pip --version` |
| Node.js 运行脚本 | 仅 runtime 可行 | node 可运行，但 npm/npx 缺失；不能作为完整前端/Node 包开发环境。 | 中-高 | 谨慎 | node v14.16.1 可用，process.arch 为 loong64；npm -v、npx -v 均 not found。 | `node -v`；`npm -v` |
| Shell 自动化 | 可行 | /bin/sh 指向 dash，不支持 sh --version；复杂脚本优先写 bash。 | 低 | 推荐 | bash 5.0.3；sh -c 可运行；/bin/sh -> dash；sh --version Illegal option 不是异常。 | `bash --version`；`sh -c "echo sh-runtime-ok"` |
| scp 文件传输 | 可行 | 适合简单上传/下载；scp -V 打印 usage 是选项不支持，不代表不可用。 | 低 | 推荐 | openssh-client installed；/usr/bin/scp exists；scp 属于 openssh-client。 | `ssh -V`；`which scp` |
| rsync 文件同步 | 不可直接使用 | rsync runtime 缺失；apt 有候选版本，但安装前需评估依赖与空间。 | 中 | 默认用 scp 替代 | rsync --version not found；rsync candidate 3.1.3-6.1.lnd.1。 | `rsync --version` |
| VS Code Remote SSH | 待验证 | 不能写成 YES；只证明 SSH 客户端/服务端相关包存在，不代表 VS Code Server 可在 LoongArch/该系统上正常部署。 | 中-高 | 待验证后再采用 | openssh-client/server installed；本会话存在 SSH_CONNECTION；但没有 VS Code Remote SSH 连接、VS Code Server 启动、扩展兼容性证据。 | `ssh loongson@<board-ip>`；连接后检查 `.vscode-server` 运行日志 |
| 交叉编译工作流 | 建议作为主路径之一，但当前未验证 | 推荐在 PC/服务器侧完成重型构建，板端负责运行验证；交叉工具链本身未在当前证据中验证。 | 中 | 第四阶段建议重点验证 | 板端架构为 loongarch64；本地可用存储/内存有限；gcc 可用但 g++/build-essential 缺失。 | `dpkg --print-architecture`；交叉编译器需另行验证 |
| 外设开发准备 | 部分可行，接口需补证据 | C/Python/Shell 可作为外设测试基础；GPIO/I2C/SPI/UART 设备节点、权限、开发头文件未在当前证据中完成覆盖。 | 中 | 可列为第四阶段验证项 | 已有 C/Python/Shell 工具链基础；暂无具体外设节点、权限和库验证。 | `ls /dev`；`ls /sys/class/gpio`；按外设补充专项命令 |
| Web 服务开发 | 部分可行 | 适合 Python 标准库或已安装依赖的轻量 HTTP 服务；Node.js 缺 npm，不适合直接做 npm 项目。 | 中 | 推荐 Python 轻服务，不推荐重框架 | Python3、ssl、curl 可用；node runtime 可用但 npm 缺失；Redis/PostgreSQL 服务缺失。 | `python3 -m http.server 8000`；`curl http://127.0.0.1:8000` |
| 数据库服务 | 受限 | Python sqlite3 模块可用；sqlite3 CLI、Redis、PostgreSQL 均缺失；不建议板上默认跑重数据库服务。 | 中-高 | 优先 SQLite/Python 内嵌或外部数据库 | Python sqlite3 3.27.2 可导入；sqlite3 CLI not found；redis-server/psql not found。 | `python3 -c "import sqlite3; print(sqlite3.sqlite_version)"`；`psql --version` |
| GUI 开发 | 不可直接使用 | Qt/GTK dev 包未安装；qmake wrapper 残留但目标缺失；不能把 Qt/GTK 写成可用。 | 高 | 不推荐作为当前默认方向 | qmake exists but qmake --version cannot exec /usr/lib/qt5/bin/qmake；pkg-config gtk+-3.0 failed。 | `qmake --version`；`pkg-config --modversion gtk+-3.0` |
| 多媒体/视觉开发 | 不可直接使用 | FFmpeg/OpenCV dev 缺失；apt 有候选版本但依赖重，安装成本高。 | 高 | 安装前专项评估 | ffmpeg -version not found；pkg-config opencv/opencv4 failed；libopencv-dev candidate exists。 | `ffmpeg -version`；`pkg-config --modversion opencv4` |
| 容器化开发 | 不可行 | Docker/Podman runtime 缺失；当前源 docker.io 无候选版本，podman 无匹配包。 | 高 | 不使用板上容器方案 | docker/podman --version not found；docker.io candidate none；podman no package match。 | `apt-cache policy docker.io`；`podman --version` |
| Rust / Go / Java 开发 | 不可直接使用 | rustc/cargo/go/java/javac runtime 均缺失；均不作为默认语言栈。 | 中-高 | 需要时单独评估 | rustc、cargo、go、java、javac 命令均 not found；apt 有部分候选版本但安装成本较高。 | `rustc --version`；`go version`；`java -version` |
