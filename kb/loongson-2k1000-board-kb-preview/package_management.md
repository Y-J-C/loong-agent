# 包管理证据链

## 证据基线

| 项目 | 结论 | 证据命令 |
| --- | --- | --- |
| 架构 | loongarch64 | dpkg --print-architecture |
| 软件源 | deb http://pkg.loongnix.cn/loongnix DaoXiangHu-stable main contrib non-free | cat /etc/apt/sources.list |
| apt policy | DaoXiangHu-stable/main contrib non-free 优先级 500；/var/lib/dpkg/status 优先级 100 | apt policy |
| sources.list.d | 空目录 | ls -al /etc/apt/sources.list.d/ |

## 判定口径

| 状态 | 含义 |
| --- | --- |
| installed | dpkg-query 或 apt-cache policy 显示已安装 |
| runtime available | which 和版本命令可运行，或模块导入测试成功 |
| apt candidate exists | 未安装，但 apt-cache policy 显示候选版本 |
| missing | dpkg-query 未安装且运行时命令 not found |
| unknown | 原始证据不足，不能做确定判断 |

## 逐包证据表

| 软件 | installed 状态 | apt candidate | 版本/候选版本 | dpkg 证据 | runtime 证据 | 依赖风险 | 安装成本 | 建议 | 验证命令 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| g++ | not installed | exists，4:8.3.0-1+nmu1 | candidate 4:8.3.0-1+nmu1 | dpkg-query: 没有找到与 g++ 相匹配的软件包 | g++ --version: not found | medium | medium，direct deps 为 cpp、gcc、g++-8、gcc-8 | C++ 编译能力缺失；进入 C++ 项目前需单独评估安装窗口。 | `g++ --version` |
| clang | not installed | exists，1:8.0-48.1-lnd.2 | candidate 1:8.0-48.1-lnd.2 | dpkg-query clang not installed | clang --version: not found | medium | medium，direct dep 为 clang-8；实际 LLVM 体量需安装前再核算。 | 非必要不作为默认编译器；优先 GCC。 | `clang --version` |
| build-essential | not installed | exists，12.6.lnd.1+nmu1 | candidate 12.6.lnd.1+nmu1 | build-essential unknown ok not-installed | 无单一运行时命令 | medium | medium，direct deps 为 libc6-dev、gcc、g++、make、dpkg-dev | 当前不具备完整 Debian C/C++ 构建元包；需要 C++/源码构建时再评估。 | `dpkg-query -W build-essential` |
| rsync | not installed | exists，3.1.3-6.1.lnd.1 | candidate 3.1.3-6.1.lnd.1 | dpkg-query: 没有找到与 rsync 相匹配的软件包 | rsync --version: not found | low | low-medium，direct deps 约 7 个，建议 openssh。 | 文件同步工具缺失；可用 scp 替代只读拉取。 | `rsync --version` |
| pip3 / python3-pip | installed | exists，18.1-5.1.lnd.1 | dpkg 18.1；runtime pip 24.0 from /home/loongson/.local/lib/python3.7/site-packages | python3-pip install ok installed 18.1-5.1.lnd.1 | which pip3 -> /usr/bin/pip3；pip3 --version 可运行；pip 不在 PATH。 | low | none，already installed | 使用 python3 -m pip，避免旧 wrapper 警告；文档中不得写 pip 全缺失。 | `python3 -m pip --version` |
| npm | not installed | exists，7.5.2+ds-2.lnd.5 | candidate 7.5.2+ds-2.lnd.5 | npm unknown ok not-installed | npm -v: not found；npx -v: not found | high | high，apt-cache depends npm 显示大量 node-* 依赖。 | Node runtime 可用但 npm 工具链不可用；不要把 Node.js 误判为完整前端环境。 | `npm -v` |
| nodejs | installed | exists，same | dpkg 14.16.1~dfsg-1.lnd.11；runtime v14.16.1 | nodejs install ok installed 14.16.1~dfsg-1.lnd.11 | which node -> /usr/bin/node；node -p process.arch -> loong64 | low | none，already installed | 可运行 Node 脚本；包管理缺 npm。 | `node -v` |
| curl | installed | exists，same | runtime curl 7.64.0 | curl install ok installed 7.64.0-4+deb10u2.lnd.4 | curl --version lists HTTP/HTTPS/SFTP 等协议 | low | none，already installed | 可作为网络访问工具。 | `curl --version` |
| wget | installed | exists，installed version；repo also has 1.20.1-1.1.lnd.2 | runtime GNU Wget 1.20.1 | wget install ok installed 1.20.1-1.1.lne.2 | wget --version 可运行 | low | none，already installed | 可作为下载/HTTP 只读探测工具。 | `wget --version` |
| openssh-client | installed | exists，installed version；repo has lnd.7 | runtime OpenSSH_7.9p1 | openssh-client install ok installed 1:7.9p1-10+deb10u2.lne.4 | ssh -V 可运行；scp 属于 openssh-client | low | none，already installed | SSH/SCP 客户端可用；scp -V 只是不支持该选项，会打印 usage。 | `ssh -V；scp -V` |
| openssh-server | installed | exists，installed version；repo has lnd.7 | package 1:7.9p1-10+deb10u2.lne.4 | openssh-server install ok installed 1:7.9p1-10+deb10u2.lne.4 | 本会话通过 SSH 连接，raw 中 SSH_CONNECTION 存在。 | low | none，already installed | 不修改服务配置；仅记录服务端已安装。 | `dpkg-query -W openssh-server` |
| sqlite3 | not installed | exists，3.27.2-3.1.lnd.1 | candidate 3.27.2-3.1.lnd.1 | dpkg-query: 没有找到与 sqlite3 相匹配的软件包 | sqlite3 --version: not found；Python sqlite3 3.27.2 模块可导入。 | low | low，direct deps 为 libc6、libreadline7、zlib1g、libsqlite3-0 | CLI 缺失；Python 内置 sqlite3 可用于轻量脚本。 | `sqlite3 --version；python3 -c "import sqlite3; print(sqlite3.sqlite_version)"` |
| redis / redis-server | not installed | exists，5:5.0.14-1+deb10u2.lnd.5 | candidate 5:5.0.14-1+deb10u2.lnd.5 | dpkg-query: 没有找到与 redis-server 相匹配的软件包 | redis-server --version: not found | medium | medium，service 包，direct deps 为 lsb-base、redis-tools。 | 不作为默认依赖；需要服务治理评估。 | `redis-server --version` |
| postgresql | not installed | exists，11+200+deb10u3+nmu1 | candidate 11+200+deb10u3+nmu1 | dpkg-query: 没有找到与 postgresql 相匹配的软件包 | psql --version: not found | high | high，meta depends postgresql-11，数据库服务栈。 | 当前不具备 PostgreSQL 环境；优先外部数据库或 SQLite。 | `psql --version` |
| docker.io | not installed | none，候选：(无) | none | dpkg-query: 没有找到与 docker.io 相匹配的软件包 | docker --version: not found | high | unavailable from current apt source | 当前源不提供 Docker；不要规划本机 Docker 方案。 | `apt-cache policy docker.io` |
| podman | not installed | no package evidence；apt-cache depends podman -> 没有发现匹配的软件包 | none | dpkg-query: 没有找到与 podman 相匹配的软件包 | podman --version: not found | high | unavailable from current apt source | 当前源不提供 Podman；容器开发不可作为板上默认路径。 | `apt-cache policy podman；podman --version` |
| rustc | not installed | exists，1.41.1+dfsg1-1~deb10u1.lnd.4+b1.1 | candidate 1.41.1+dfsg1-1~deb10u1.lnd.4+b1.1 | dpkg-query: 没有找到与 rustc 相匹配的软件包 | rustc --version: not found | medium | medium-high，deps 为 libstd-rust-dev、gcc、libc-dev、binutils，推荐 cargo。 | Rust 工具链缺失；如需使用需先评估存储和依赖。 | `rustc --version` |
| cargo | not installed | exists，0.43.1-3.lnd.3 | candidate 0.43.1-3.lnd.3 | dpkg-query: 没有找到与 cargo 相匹配的软件包 | cargo --version: not found | high | high，depends rustc、编译器、libgit/libssh/libssl 等。 | Cargo 缺失；不可直接构建 Rust 项目。 | `cargo --version` |
| go / golang | not installed | exists，2:1.15~1.lnd.2 | candidate 2:1.15~1.lnd.2 | dpkg-query: 没有找到与 golang 相匹配的软件包 | go version: not found | medium | medium-high，direct deps 为 golang-1.15、golang-doc、golang-go、golang-src。 | Go runtime/toolchain 缺失；不要写成可用。 | `go version` |
| java / openjdk-11-jdk | not installed | exists，11.0.20+8-11.7.0.lnd.1 | candidate 11.0.20+8-11.7.0.lnd.1 | dpkg-query: 没有找到与 openjdk-11-jdk 相匹配的软件包 | java -version: not found；javac -version: not found | high | high，depends JRE/JDK headless，推荐 GUI 相关开发包。 | Java 工具链缺失；不建议板上默认 Java 开发。 | `java -version；javac -version` |
| ffmpeg | not installed | exists，7:4.4.2-1.lnd.3 | candidate 7:4.4.2-1.lnd.3 | dpkg-query: 没有找到与 ffmpeg 相匹配的软件包 | ffmpeg -version: not found | medium | medium-high，direct deps 多个 libav*、SDL、swscale。 | 多媒体处理工具缺失；安装前评估空间和运行负载。 | `ffmpeg -version` |
| opencv / libopencv-dev | not installed | exists，3.2.0+dfsg-6.1 | candidate 3.2.0+dfsg-6.1 | dpkg-query: 没有找到与 libopencv-dev 相匹配的软件包 | pkg-config --modversion opencv/opencv4 failed | high | high，direct deps 大量 libopencv-* dev/runtime 包。 | OpenCV 开发环境缺失；不得标记为可用。 | `pkg-config --modversion opencv4` |
| qt / qtbase5-dev | not installed | exists，5.15.2+dfsg-lnd.8 | candidate 5.15.2+dfsg-lnd.8 | dpkg-query: 没有找到与 qtbase5-dev 相匹配的软件包 | which qmake -> /usr/bin/qmake；qmake --version fails: missing /usr/lib/qt5/bin/qmake | high | high，direct deps Qt5/Mesa/X11/qmake/dev-tools。 | Qt 开发环境不可用；qmake wrapper 存在但目标缺失。 | `qmake --version` |
| gtk / libgtk-3-dev | not installed | exists，2:3.24.5-1.lnd.1 | candidate 2:3.24.5-1.lnd.1 | dpkg-query: 没有找到与 libgtk-3-dev 相匹配的软件包 | pkg-config --modversion gtk+-3.0 failed | high | high，direct deps 大量 GTK/GLib/Pango/X11/Wayland dev 包。 | GTK 开发环境缺失；不要作为当前可用 GUI dev 方案。 | `pkg-config --modversion gtk+-3.0` |
