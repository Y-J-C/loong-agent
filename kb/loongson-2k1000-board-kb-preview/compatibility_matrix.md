# 工程兼容性矩阵

本矩阵用于第四阶段工程选型。`status` 只代表当前证据下的安装/运行状态；是否适合作为项目依赖，还需要同时看依赖风险、安装成本和建议。

| 工具/组件 | status | 版本/候选版本 | source | dependency risk | install cost | recommendation | verification command |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gcc | installed/runtime | dpkg 4:8.3.0-1+nmu1；runtime 8.3.0 | dpkg-query gcc；gcc --version | low | none | 可用于 C 构建。 | `gcc --version` |
| g++ | missing | candidate 4:8.3.0-1+nmu1 | dpkg-query g++ not installed；apt-cache policy g++；g++ --version not found | medium | medium | C++ 前需补工具链评估。 | `g++ --version` |
| clang | missing | candidate 1:8.0-48.1-lnd.2 | dpkg-query clang not installed；clang --version not found | medium | medium | 非默认路径。 | `clang --version` |
| make | installed/runtime | 4.2.1-1.3；runtime 4.2.1 | dpkg-query make；make --version | low | none | 可用。 | `make --version` |
| cmake | installed/runtime | 3.13.4-1.lnd.2；runtime 3.13.4 | dpkg-query cmake；cmake --version | low | none | 可用但偏旧。 | `cmake --version` |
| python | installed/runtime | 2.7.16-1.1；runtime 2.7.16 | dpkg-query python；python --version | low | none | 仅兼容旧脚本。 | `python --version` |
| python3 | installed/runtime | 3.7.3-1.1；runtime 3.7.3 | dpkg-query python3；python3 --version | low | none | 推荐脚本 runtime。 | `python3 --version` |
| pip | missing | no PATH command；.local/bin/pip not in PATH | pip --version not found；ls ~/.local/bin shows pip outside PATH | low | no install conclusion | 使用 python3 -m pip。 | `pip --version` |
| pip3 | installed/runtime | dpkg python3-pip 18.1；runtime pip 24.0 | dpkg-query python3-pip；pip3 --version；python3 -m pip --version | low | none | 用 python3 -m pip。 | `python3 -m pip --version` |
| node | installed/runtime | 14.16.1~dfsg-1.lnd.11；runtime v14.16.1 | dpkg-query nodejs；node -v | low | none | 可运行 JS。 | `node -v` |
| npm | missing | candidate 7.5.2+ds-2.lnd.5 | dpkg-query npm not installed；npm -v not found；apt-cache depends npm large | high | high | 不可直接做 npm 项目。 | `npm -v` |
| curl | installed/runtime | 7.64.0-4+deb10u2.lnd.4；runtime 7.64.0 | dpkg-query curl；curl --version | low | none | 可用。 | `curl --version` |
| wget | installed/runtime | dpkg 1.20.1-1.1.lne.2；runtime 1.20.1 | dpkg-query wget；wget --version | low | none | 可用。 | `wget --version` |
| ssh | installed/runtime | package openssh-client 1:7.9p1...；runtime OpenSSH_7.9p1 | ssh -V；apt-cache policy openssh-client | low | none | 可用。 | `ssh -V` |
| scp | installed/runtime | package openssh-client 1:7.9p1... | which scp；dpkg -S /usr/bin/scp；scp -V usage output | low | none | 可用；-V 不支持，不视为异常。 | `scp -V` |
| rsync | missing | candidate 3.1.3-6.1.lnd.1 | dpkg-query rsync not installed；rsync --version not found | low | low-medium | 用 scp 替代，安装前评估。 | `rsync --version` |
| sqlite CLI | missing | candidate 3.27.2-3.1.lnd.1 | sqlite3 --version not found；apt-cache policy sqlite3 | low | low | CLI 缺失；Python sqlite 可用。 | `sqlite3 --version` |
| sqlite Python module | runtime | 3.27.2 | python3 -c "import sqlite3" | low | none | Python 内嵌轻量数据可用。 | `python3 -c "import sqlite3; print(sqlite3.sqlite_version)"` |
| redis | missing | candidate 5:5.0.14-1+deb10u2.lnd.5 | redis-server --version not found；apt-cache policy redis-server | medium | medium | 不默认启用服务栈。 | `redis-server --version` |
| postgresql | missing | candidate 11+200+deb10u3+nmu1 | psql --version not found；apt-cache policy postgresql | high | high | 优先外部数据库/SQLite。 | `psql --version` |
| docker | missing | no candidate | docker --version not found；apt-cache policy docker.io candidate none | high | unavailable | 不使用板上 Docker。 | `apt-cache policy docker.io` |
| podman | missing | no package match | podman --version not found；apt-cache depends podman no match | high | unavailable | 不使用板上 Podman。 | `podman --version` |
| rust / rustc | missing | candidate 1.41.1+dfsg1... | rustc --version not found；apt-cache policy rustc | medium | medium-high | 不作为默认语言栈。 | `rustc --version` |
| cargo | missing | candidate 0.43.1-3.lnd.3 | cargo --version not found；apt-cache policy cargo | high | high | Rust 构建不可用。 | `cargo --version` |
| go | missing | golang candidate 2:1.15~1.lnd.2 | go version not found；apt-cache policy golang | medium | medium-high | Go 工具链缺失。 | `go version` |
| java | missing | openjdk-11-jdk candidate 11.0.20+8-11.7.0.lnd.1 | java -version and javac -version not found | high | high | Java 开发不可用。 | `java -version` |
| ffmpeg | missing | candidate 7:4.4.2-1.lnd.3 | ffmpeg -version not found；apt-cache policy ffmpeg | medium | medium-high | 多媒体处理缺失。 | `ffmpeg -version` |
| opencv | missing | libopencv-dev candidate 3.2.0+dfsg-6.1 | pkg-config opencv/opencv4 failed；package not installed | high | high | OpenCV dev 不可用。 | `pkg-config --modversion opencv4` |
| qt | missing | qtbase5-dev candidate 5.15.2+dfsg-lnd.8 | qmake wrapper exists but qmake --version cannot exec target；package not installed | high | high | Qt dev 不可用。 | `qmake --version` |
| gtk | missing | libgtk-3-dev candidate 2:3.24.5-1.lnd.1 | pkg-config gtk+-3.0 failed；package not installed | high | high | GTK dev 不可用。 | `pkg-config --modversion gtk+-3.0` |
