# 棋类游戏 Board Games

一个程序，三种棋：**五子棋、围棋、中国象棋**。Windows 桌面、Android、网页三端，规则与交互对齐。

## 一、这是什么

| 端 | 版本 | 文件 | 大小 |
|---|---|---|---|
| Windows | 1.4.1.0 | `gomoku-windows.exe` | 180,736 B |
| Android | 1.8（versionCode 9） | `gomoku.apk` | 726,465 B |
| 网页 | v1.8 | `index.html` + 三个引擎脚本 | 46 KB + 67 KB |

- **五子棋**：人机 / 双人 / AI 观战，15 路与 19 路，无禁手与严格禁手，远程联机（开房 / 加入 / 走棋码），入门教学与历史记录。
- **围棋**：人机 / 双人 / AI 观战，远程联机，数子与死子标记，内置教学。
- **中国象棋**：人机 / 双人，四档 AI 难度，悔棋、提示、认输，标准中文记谱（如「炮二平五」），对局历史与逐步复盘。三端都是单机，不接远程联机。

本仓库同时是网页端的静态托管与两个客户端的下载入口；线上托管版仍在 WorkBuddy（`https://gomoku-online-04516.app.workbuddy.host/`），GitHub Pages 是独立备份。

## 二、怎么用

**在线玩（单机）**：打开 <https://yeco2656-jpg.github.io/board-games/>。五子棋、围棋、象棋的人机与双人模式都能用；开房联机依赖服务端，Pages 上不可用。

**Windows**：下载 `gomoku-windows.exe` 双击运行。程序自编、无数字签名，SmartScreen 会拦一次，点「更多信息」→「仍要运行」。需要 .NET Framework 4.7.2（Win10/11 自带）。命令行 `--chess` 进象棋，`--go` 进围棋。

**Android**：下载 `gomoku.apk` 直接装。包名 `com.yico.gomoku`，签名未变，可覆盖安装上一版。

**历史记录位置**：桌面 `%APPDATA%\GomokuDesktop\chess-history.txt`；安卓同格式文件，可互相拷贝；网页在浏览器 localStorage。

**自建服务端（要联机才需要）**：`node tools/server.js`，默认 3000 端口；需 Node 18+。页面里的 `/api/*` 由它提供，静态托管下这些接口不可用。

## 三、仓库结构

```
index.html                 网页主页面（三页签：五子棋 / 围棋 / 象棋）
chess-engine.js            象棋规则、AI、记谱、复盘
go-engine.js               围棋规则与数子
go-ui.js                   围棋界面
gomoku-windows.exe         Windows 客户端（1.4.1.0）
gomoku.apk                 Android 客户端（1.8）
gomoku-windows-readme.txt  Windows 端使用说明（随包分发）
tools/server.js            联机与静态服务端（自建时用）
```

安装包的 SHA256：

- `gomoku-windows.exe`：`B09D34DD241911A40203BEBC2C6520EA64E3AF5DD1693EB843B1713C79543760`
- `gomoku.apk`：`357933D3D07F616145CF76598FB9BC75B1E7B885D26C266D2E41BB62046E887D`

## 四、常见问题

**双击没反应 / 被 SmartScreen 拦？** 无签名程序会提示一次，点「更多信息」→「仍要运行」。需要 .NET Framework 4.7.2。

**安卓能直接覆盖装吗？** 能。包名与签名都没变，versionCode 从 8 升到 9。

**历史记录里为什么没有刚才那局？** 只有分出胜负或判和的对局才写记录；中途关窗口、点新局重开都不算。网页刷新后未下完的局也会丢。

**网页上象棋能联机吗？** 不能，象棋三端都是单机。五子棋与围棋的联机需要 `tools/server.js`，GitHub Pages 不提供。

**Pages 打不开或很慢？** 国内 `github.io` 有时被 DNS 污染，先用手机热点试一次；仍不行就用 Release 里的客户端，或走 WorkBuddy 的线上地址。

**下载的 exe 和桌面版是同一个吗？** 是，同一份二进制，SHA256 一致。

## 五、维护

1. 改网页：直接改 `index.html` / `chess-engine.js` / `go-engine.js` / `go-ui.js`，本地 `node tools/server.js` 起服务验证。
2. 换客户端：把新的 exe / apk 覆盖根目录同名文件，同步更新上面的版本表与 SHA256。
3. 发版：`git tag vX.Y && git push origin vX.Y`，再在 GitHub Releases 里新建 Release，把 exe 与 apk 作为附件上传。
4. Pages 从 `main` 分支根目录发布，无需构建；`/api/*` 相关功能在 Pages 上不可用，属预期。
