# 软件栈画像

## 基础上下文

| 项目 | 当前证据结论 | 证据命令 |
| --- | --- | --- |
| 用户 | loongson | whoami |
| 架构 | loongarch64 | uname -a；dpkg --print-architecture |
| 系统 | Loongnix-Embedded GNU/Linux 20 (DaoXiangHu) | cat /etc/os-release |
| 板卡模型 | loongson,LS2K1000_PAI_UDB_V1_5 | cat /proc/device-tree/model |
| PATH | /usr/local/bin:/usr/bin:/bin:/usr/games | echo "$PATH" |

## C/C++ 与构建工具

| 类型 | 名称 | runtime available | 版本 / not found 证据 | package 证据 | 判断说明 |
| --- | --- | --- | --- | --- | --- |
| 工具 | gcc | yes | gcc --version -> 8.3.0 | gcc install ok installed 4:8.3.0-1+nmu1 | C 编译器可用。 |
| 工具 | cc | yes | cc --version -> 8.3.0 | 由 GCC 工具链提供 | C 编译入口可用。 |
| 工具 | g++ | no | g++ --version -> not found | g++ not installed；candidate exists | C++ 编译器缺失。 |
| 工具 | c++ | no | c++ --version -> not found | 与 g++ 缺失一致 | C++ 通用入口缺失。 |
| 工具 | clang | no | clang --version -> not found | clang not installed；candidate exists | Clang 缺失。 |
| 工具 | make | yes | make --version -> 4.2.1 | make install ok installed 4.2.1-1.3 | Make 可用。 |
| 工具 | cmake | yes | cmake --version -> 3.13.4 | cmake install ok installed 3.13.4-1.lnd.2 | CMake 可用但版本偏旧。 |
| 工具 | ld / as / ar / objdump | yes | GNU Binutils for Loongnix-Embedded 2.31.1-system.20190122 | binutils 在 dpkg -l 中已安装 | 基础二进制工具可用。 |
| 工具 | pkg-config | yes | pkg-config --version -> 0.29 | runtime raw 证据 | 可用于探测已安装 dev 包。 |

## Python 栈

| 类型 | 名称 | runtime available | 版本 / not found 证据 | package 证据 | 判断说明 |
| --- | --- | --- | --- | --- | --- |
| 工具 | python | yes | Python 2.7.16；/usr/bin/python | python install ok installed 2.7.16-1.1 | Python 2 存在，已过时。 |
| 工具 | python3 | yes | Python 3.7.3；/usr/bin/python3 | python3 install ok installed 3.7.3-1.1 | Python 3 可用但版本偏旧。 |
| 工具 | pip | no | pip --version -> not found；which pip failed | ~/.local/bin/pip 存在但不在 PATH | 不能写成 pip 命令可用。 |
| 工具 | pip3 | yes | pip3 --version -> pip 24.0，并有 old script wrapper warning | python3-pip install ok installed 18.1-5.1.lnd.1 | 推荐用 python3 -m pip。 |
| 工具 | python3 -m pip | yes | pip 24.0 from /home/loongson/.local/lib/python3.7/site-packages | python3-pip installed | 实际加载用户目录 pip 24.0。 |
| 能力 | venv module | yes | import venv -> venv available | python3-venv package not installed | 模块可导入，但包状态不是 installed。 |
| 能力 | sqlite3 module | yes | sqlite3 3.27.2 | sqlite3 CLI package not installed | Python 可用，CLI 不可用。 |
| 能力 | ssl module | yes | OpenSSL 1.1.1d 10 Sep 2019 | Python runtime 证据 | TLS 能力存在。 |

## Node.js 栈

| 类型 | 名称 | runtime available | 版本 / not found 证据 | package 证据 | 判断说明 |
| --- | --- | --- | --- | --- | --- |
| 工具 | node | yes | node -v -> v14.16.1；process.arch -> loong64 | nodejs install ok installed 14.16.1~dfsg-1.lnd.11 | Node runtime 可用。 |
| 工具 | npm | no | npm -v -> not found；which npm failed | npm unknown ok not-installed；candidate exists | Node 包管理缺失。 |
| 工具 | npx | no | npx -v -> not found；which npx failed | 随 npm 工具链缺失 | 不可直接运行 npx 工作流。 |

## Shell 与常用工具

| 类型 | 名称 | runtime available | 版本 / not found 证据 | package 证据 | 判断说明 |
| --- | --- | --- | --- | --- | --- |
| 工具 | bash | yes | bash --version -> 5.0.3 | runtime raw 证据 | 可用于脚本。 |
| 工具 | sh | yes | sh -c "echo sh-runtime-ok" 成功；/bin/sh -> dash | dash 0.5.10.2-5.1 installed | sh --version 返回 Illegal option -- 是 dash 不支持该选项，不是 shell 异常。 |
| 工具 | git | yes | git version 2.20.1 | git install ok installed 1:2.20.1... | 可用但版本偏旧。 |
| 工具 | ssh | yes | OpenSSH_7.9p1 | openssh-client install ok installed | SSH 客户端可用。 |
| 工具 | scp | yes | /usr/bin/scp exists；scp -V 打印 usage | openssh-client: /usr/bin/scp | scp -V 是不支持 -V 选项，不是 scp 不可用。 |
| 工具 | rsync | no | rsync --version -> not found | rsync not installed；candidate exists | 缺失。 |
| 工具 | curl | yes | curl 7.64.0 | curl install ok installed | 可用。 |
| 工具 | wget | yes | GNU Wget 1.20.1 | wget install ok installed | 可用。 |
| 工具 | tar | yes | GNU tar 1.30 | runtime raw 证据 | 可用。 |
| 工具 | gzip | yes | gzip UNKNOWN | runtime raw 证据 | 可用，版本字符串非标准。 |
| 工具 | xz | yes | XZ Utils 5.2.4 | runtime raw 证据 | 可用。 |
| 工具 | unzip | yes | UnZip 6.00 | runtime raw 证据 | 可用。 |
| 工具 | zip | yes | Zip 3.0 | runtime raw 证据 | 可用。 |
| 工具 | file | yes | file-5.35 | runtime raw 证据 | 可用。 |
| 工具 | ldd | yes | glibc 2.28 | runtime raw 证据 | 可用。 |

## 服务 / 数据库 / 多媒体 / GUI / 容器工具

| 类型 | 名称 | runtime available | 版本 / not found 证据 | package 证据 | 判断说明 |
| --- | --- | --- | --- | --- | --- |
| 工具 | sqlite3 CLI | no | sqlite3 --version -> not found | candidate 3.27.2-3.1.lnd.1 | CLI 缺失。 |
| 工具 | redis-server | no | redis-server --version -> not found | candidate 5:5.0.14... | 缺失。 |
| 工具 | psql / PostgreSQL | no | psql --version -> not found | postgresql candidate exists | 缺失。 |
| 工具 | docker | no | docker --version -> not found | docker.io candidate none | 当前源不可用。 |
| 工具 | podman | no | podman --version -> not found | no package match | 当前源不可用。 |
| 工具 | rustc | no | rustc --version -> not found | candidate exists | 缺失。 |
| 工具 | cargo | no | cargo --version -> not found | candidate exists | 缺失。 |
| 工具 | go | no | go version -> not found | golang candidate exists | 缺失。 |
| 工具 | java / javac | no | java -version and javac -version -> not found | openjdk-11-jdk candidate exists | 缺失。 |
| 工具 | ffmpeg | no | ffmpeg -version -> not found | candidate exists | 缺失。 |
| 工具 | OpenCV dev | no | pkg-config opencv/opencv4 failed | libopencv-dev candidate exists | dev 环境缺失。 |
| 工具 | Qt dev | no usable runtime | which qmake exists, but qmake --version cannot exec /usr/lib/qt5/bin/qmake | qtbase5-dev not installed；candidate exists | qmake wrapper 残留/不完整，不可视为 Qt dev 可用。 |
| 工具 | GTK dev | no | pkg-config gtk+-3.0 failed | libgtk-3-dev candidate exists | dev 环境缺失。 |
