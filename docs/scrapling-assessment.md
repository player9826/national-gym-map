# Scrapling 接入评估（2026-09-13）

结论：可以通过独立 Python 进程接入，但本次不作为默认抓取引擎。现有实验未证明它能提高目标官网的成功率，引入成本则已实际测得。

用户提到的「scarpling、接近 8 万收藏」高度吻合 [D4Vinci/Scrapling 官方仓库](https://github.com/D4Vinci/Scrapling)。检查时仓库页面显示约 8.06 万收藏，名称实际为 Scrapling。收藏数不是可抓取任意网站的证据。

## 官方约束

- [官方项目配置](https://github.com/D4Vinci/Scrapling/blob/main/pyproject.toml)：所测版本 0.4.15，需要 Python 3.10 或更新版本。普通抓取依赖 curl_cffi，官方 fetchers 安装组合也包含 Playwright、Patchright 等浏览器相关依赖。
- [官方许可证](https://github.com/D4Vinci/Scrapling/blob/main/LICENSE)：BSD（Berkeley Software Distribution）三条款许可证，允许源码和二进制再分发，但须保留版权、条款和免责内容，不得擅用作者名称背书；各依赖仍须分别保留相应许可信息。
- [普通抓取说明](https://scrapling.readthedocs.io/en/latest/fetching/static.html)：普通 Fetcher 不负责运行网页脚本。动态页面需要另一套浏览器路径，不能因替换网络客户端便宣称解决所有页面解析或访问拒绝问题。

## 本机实测

在项目忽略目录 `.build-tools/scrapling-env` 创建隔离环境，安装 `scrapling[fetchers]==0.4.15`，未下载额外浏览器，未改动应用依赖。

环境：Windows、Python 3.11.9。该隔离目录文件总大小为 **272,479,671 字节，约 260 MiB（Mebibyte）**，不含外部 Python 基础运行时及浏览器。第一次单独启动 Python、抓取本地产品页并返回解析结果用时约 1.56 秒；这是单次探针值，不是性能基准。

四项本地实验通过：

1. Node.js 启动 Python 子进程，普通抓取返回页面内容，现有应用商品解析器得到正确中文名称、型号、品牌、图片地址。
2. 本地目录页提取两条预期产品链接。
3. 本地测试服务器返回 403 时，仍得到 403，且仅请求一次。
4. 内容由网页脚本生成的本地页面，普通抓取不产生脚本运行后的标题。

实验明确关闭浏览器指纹模拟和伪装请求头，仅请求本机测试服务器。没有用该客户端重新访问 Full Circle Padding，也没有执行验证码绕过或受保护官网测试。

可复现命令：`node .build-tools/scrapling-probe.cjs`。本机结果在 `test-results/scrapling-probe.json`；实验脚本和虚拟环境均不进入安装包或版本管理。

## 接入边界与决策

Electron 不能直接加载 Python 库，需要额外子进程协议、运行时定位、超时取消、输出大小控制及跨版本维护；安装包还需要独立打包 Python 和依赖，不能直接复制虚拟环境作为可移植运行时。

当前收益只证实「技术上可以连通」，没有证实对实际目标网站优于现有网络读取和浏览器辅助路径。因此保留实验，不默认启用、不增加用户安装负担。下一步以用户主动在正常浏览器中采集已能访问的产品页面及图片，导出本地文件交给现有导入预览流程。
