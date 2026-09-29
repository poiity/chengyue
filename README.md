# 澄阅 · Pixiv Light

[English](README.en.md) | 简体中文

**一个支持动图播放、收藏管理与原图批量下载的第三方 Pixiv 桌面客户端，适用于 Windows 与 macOS。**

为你推荐、关注动态、收藏按月筛选与批量管理、收藏存档、动图播放与 GIF 导出、原图批量保存为文件夹或 ZIP。基于 Electron，没有第三方运行依赖。

> 本项目是非官方的第三方工具，与 pixiv Inc. 无关，也未获其认可；「pixiv」是 pixiv Inc. 的商标，这里仅用于说明软件用途。只使用你自己的账号访问你有权查看的内容，不绕过会员、年龄或作品访问权限。

## 下载

在 [Releases](https://github.com/poiity/chengyue/releases/latest) 下载对应系统的文件：

| 系统 | 文件 | 说明 |
| --- | --- | --- |
| Windows 10 / 11（x64） | `Chengyue-v1.0-Windows-x64.zip` | 便携版，解压即用，无需安装 |
| macOS 12 及以上 · Apple 芯片（M1 及以后） | `Chengyue-v1.0-macOS-AppleSilicon.dmg` | 已在 M 系列 Mac 上测试 |
| macOS 12 及以上 · Intel 芯片 | `Chengyue-v1.0-macOS-Intel.dmg` | 未在实机测试，遇到问题欢迎反馈 |

不确定 Mac 的芯片类型：点击左上角  →「关于本机」，「芯片」一栏写着 Apple M… 即 Apple 芯片，写着 Intel 则为 Intel 芯片。

## 功能

- **为你推荐 / 当前热门**：本机 Tag 偏好 + Pixiv 推荐 + 每日热门；已收藏与本次看过的作品自动过滤；18+ 默认关闭，关闭时同时过滤 R-18 标签与 Pixiv「敏感内容」。
- **关注动态**：全部动态，或按画师分类汇总作品（从新到旧）；**关注画师**页面按分类列出画师。
- **我的收藏**：公开 / 不公开、收藏顺序、年龄、收藏标签、作品标签、**收藏时间（按月，与网页端一致）**组合筛选；右上角**收藏管理**可批量设为公开 / 不公开或取消收藏。
- **收藏存档**：在软件中浏览过的收藏会在本机记录标题、画师、标签与缩略图；作者删除或隐藏作品后仍能看到它原来是什么。
- **看图**：翻页、方向键、动图播放；下方是官方相关作品，向下滚动自动加载；爱心一键收藏 / 取消，关注画师。
- **搜索**：Tag（带日语标签联想）、画师 UID、作品 PID，均支持粘贴 Pixiv 链接。
- **下载**：原图、自定义页码（如 `1-4,9-13`）、动图保存为 GIF 或原始帧；保存为文件夹、分别 ZIP 或合并 ZIP；下载中心可取消、重试、清除记录。
- **中文 / English**：默认跟随系统显示语言，可在偏好设置中切换。
- **其他**：浅色 / 深色 / 跟随系统；关闭时询问最小化到托盘（macOS 为在程序坞中保持运行）或退出；代理与图片镜像线路（如 i.pixiv.re）；本机错误日志；会眨眼的看板娘。

## 使用

1. 安装：**Windows** 完整解压 ZIP 后运行 `PixivLight.exe`；**macOS** 打开 DMG，把「澄阅」拖进「应用程序」（首次打开见下方说明）。
2. 点击「登录 Pixiv」，在官方登录页完成登录与验证；软件会自动识别并关闭登录窗口。
3. 无法直连 Pixiv 时，使用系统代理 / VPN，或在偏好设置中填写代理地址（如 `http://127.0.0.1:7890`）。

升级时先退出旧版，再解压（Windows）或替换「应用程序」中的澄阅（macOS）即可；账号会话、设置、下载记录与收藏存档保存在用户应用数据目录（Windows 为 `%APPDATA%\PixivLight`，macOS 为 `~/Library/Application Support/PixivLight`），会被新版继续使用。

### macOS 首次打开

软件没有 Apple 开发者签名与公证，第一次打开时 macOS 会提示「无法验证开发者」或「已损坏」。任选一种方式放行（只需一次）：

- 先双击打开一次并关闭提示，然后到「系统设置 → 隐私与安全性」，在页面下方点击「仍要打开」；
- 或在「终端」中运行 `xattr -dr com.apple.quarantine /Applications/澄阅.app`。

macOS 上点击窗口关闭按钮时，可以选择退出，或关闭窗口并在后台继续运行（下载不中断）；之后点击程序坞中的图标即可恢复窗口，按 ⌘Q 真正退出。⌘, 打开偏好设置，⌘K 聚焦搜索框。

## 关于收藏时间

软件与 Pixiv 网页端一样，从 Pixiv 的按月统计读取收藏时间（`/ajax/user/{id}/illusts/bookmarks/periods`，列表参数 `bm=YYYYMM`，例如 `bm=202609`）：「收藏时间」下拉列出每个月及数量，选择后只显示该月收藏；首次进入收藏页时，软件会在后台逐月读取一次，把每部作品归到对应月份并保存在本机，之后只重新读取数量有变化的月份，卡片上显示「2026年9月 收藏」。

需要注意：

- **按月份查看收藏在 Pixiv 网页端是 Premium 会员功能**。如果账号不是 Premium，或 Pixiv 没有提供这项数据，软件会提示「Pixiv 没有提供收藏时间」，此时只能显示通过本软件新收藏的作品的日期。
- Pixiv 只提供到**月份**，不提供具体日期；通过本软件新添加的收藏会额外记录具体日期。
- 如果 Pixiv 忽略了月份参数（返回数量与该月统计明显不符），同步会自动停止，不会把作品归错月份。

## 隐私与安全

- 密码只在 Pixiv 官方登录页输入，不经过本软件的界面或进程间通信。
- 界面运行在沙箱中，只能调用白名单内的操作，主进程会校验调用来源；页面禁止外部脚本、网络请求与内嵌网页；来自 Pixiv 的文字一律转义显示，作品 ID 只接受数字。
- 读取登录信息的脚本在隔离环境中执行；禁止网页申请摄像头、通知等权限；同一时间只运行一个实例。
- 收藏、关注等写操作不会自动重试，避免重复提交；批量取消收藏与清除记录都需要确认。
- 图片镜像只接收公开图片地址，收不到 Cookie 或账号信息。
- 本机数据：账号会话、设置、下载记录、Tag 偏好、收藏日期、收藏存档、错误日志（自动隐藏 Cookie、令牌与系统用户名）。浏览历史只在内存中，退出即清空。

Pixiv 网页接口不是公开的稳定 API，网站改版后可能需要适配。

## 开发

需要 Node.js 22.12+ 与 pnpm。

```bash
pnpm install     # 只安装 Electron（开发依赖）
pnpm start       # 运行
pnpm test        # 单元测试（node --test）
pnpm run pack    # 按当前系统打包，输出到项目上一级目录：
                 #   Windows：便携版文件夹与 ZIP
                 #   macOS：澄阅.app 与 DMG（默认本机架构；pnpm run pack -- --arch x64 生成 Intel 版）
pnpm run icon    # 重新生成应用图标 build/icon.png、build/icon.icns（macOS）
```

目录结构：

```
src/                 主进程
  main.cjs           窗口、托盘 / macOS 菜单栏、登录窗口、IPC 与本机数据
  pixiv.cjs          网络请求、登录识别、作品 / 动图 / 相关作品、图片镜像
  library.cjs        收藏（含批量管理）、关注、关注分类作品
  archive.cjs        收藏存档（已删除作品的本地记录）
  recommend.cjs      本地 Tag 偏好与推荐排序
  downloads.cjs      下载队列（原图、动图、ZIP）
  zip.cjs / gif.cjs  内置 ZIP 读写与 GIF 编码
  log.cjs            错误日志（带脱敏）
  preload.cjs        页面可调用的白名单
ui/                  界面
  index.html, styles.css
  js/i18n.js, locale-en.js  界面语言（中文为源文，英文对照表）
  js/base.js         公共组件：下拉菜单、对话框、确认框
  js/gallery.js      列表页、收藏管理、下载菜单、下载中心
  js/viewer.js       看图、动图、收藏设置、关注、相关作品、存档详情
  js/settings.js     偏好设置、关闭提示
  js/app.js          搜索、导航、账号、看板娘、启动
  assets/            图标与看板娘图片
test/                单元测试
build/               应用图标（icon.png、macOS 的 icon.icns）
scripts/package.cjs  打包脚本（Windows 便携版 / macOS DMG）
scripts/icon.cjs     由品牌标志渲染应用图标
```

调试用环境变量：`PIXIV_LIGHT_TEST_DATA=<目录>` 使用独立的数据目录；`PIXIV_LIGHT_HIDDEN=1` 以离屏模式运行；`PIXIV_LIGHT_SCREENSHOT=<文件>` 启动后截图并退出（打包自检用）。

更新记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

源码以 [MIT 许可证](LICENSE) 发布。看板娘「澄澄」由作者原创设计。

实现参考：[Pixiv 搜索语法](https://www.pixiv.help/hc/en-us/articles/235646387-I-would-like-to-know-how-to-search-for-content-on-pixiv)、[PixivNow Web API 文档](https://github.com/FreeNowOrg/PixivNow/blob/master/docs/pixiv-web-api.md)、[Electron 文档](https://www.electronjs.org/docs/latest/)。
