# 实际架构与任务入口

更新日期：2026-09-22；对应桌面 1.5.2 基础与公开只读网页模式。这里描述现有布局。

## 运行链路

网页模式通过 `src/data-service.js` 加载带完整性校验的公开快照；桌面模式保留主进程调用。`src/web-route.js` 保存详情地址，`src/web.css` 限定网页和手机样式。`scripts/build-web.cjs` 从 `shared/` 白名单生成 `dist-web/`，重新编码图片并生成内容寻址文件名；`.github/workflows/pages.yml` 独立测试和发布网站。详见 `docs/web.md`。

`electron/main.cjs` 创建桌面窗口、处理数据目录与本地资源，执行升级前备份；`electron/preload.cjs` 向界面提供受控调用；`src/App.jsx` 组织页面与弹窗，通过 `window.desktop.call` 调用主进程业务。

| 任务 | 优先检查的文件 |
| --- | --- |
| 地图、选点、标记 | `src/MapView.jsx`；涉及筛选联动再读 `src/App.jsx` |
| 统一场馆悬停浮卡 | `src/GymPreview.jsx` 管理单个浮卡、延迟、位置与主题色；`src/App.jsx` 传递已加载摘要，`src/MapView.jsx` 维护标记高亮和视口通知 |
| 官网与浏览器辅助导入 | `electron/web-import.cjs`；`src/Forms.jsx` 提供预览、产品列表及辅助窗口入口 |
| 品牌目录批量导入 | `electron/batch-import.cjs` 持久候选与确认提交；`src/BatchImport.jsx`、`src/batch-import.css` 工作台 |
| 四类器械分类与旧字段迁移 | `electron/equipment-model.cjs` 后端规范化和校验；`src/constants.js` 界面分类常量 |
| 文档单页导入 | `electron/pdf-import.cjs` 在独立工作线程解析、渲染；相关运行库及工作线程通过构建配置解包 |
| 场馆、器械页面与筛选 | `src/App.jsx`、`src/constants.js` |
| 1.5.2 共用器械搜索筛选 | `src/equipment-filtering.js` 统一匹配品牌、类型、部位、动作、系列、负重及搜索字段；`src/EquipmentFilters.jsx` 供器械库、选取窗口和场馆已关联列表使用 |
| 场馆和器械编辑、品牌、设置 | `src/Forms.jsx` |
| 自定义部位及品牌系列 | `src/EquipmentClassification.jsx` 编辑 `CUSTOM:名称` 部位；系列为器械的可空 `series`，候选由同品牌已保存器械推导；`electron/equipment-model.cjs` 校验，`electron/shared-catalog.cjs` 纳入公开资料同步 |
| 看图多选批量关联 | `src/EquipmentPicker.jsx`、`electron/business.cjs`、`electron/catalog.cjs` |
| 通用组件与样式 | `src/components.jsx`；按需查找 `src` 内样式文件 |
| 数据校验、原子保存、迁移、备份恢复 | `electron/storage.cjs` |
| 档案操作、关系、测评转换与产品读取 | `electron/catalog.cjs`、`electron/business.cjs` |
| 桌面桥接、窗口与升级 | `electron/preload.cjs`、`electron/main.cjs`、`electron/business.cjs` |
| 构建与安装器 | `package.json`、`scripts/build.cjs`、`scripts/after-pack.cjs` |

## 数据关系

- `gyms`：场馆、位置、打卡、普通标签、照片、测评摘要与原始数据；`brandIds` 指向品牌记录。
- `brands`：器械品牌，可无官网；品牌属于器械库。
- `equipment`：器械及所属品牌；`equipmentType` 为固定、有氧、自由力量、龙门架之一。固定器械使用多选 `parts`、`tags` 和可选 `loading`；自由力量使用 `freeWeightType`；其他分类不使用固定器械字段。来源和核实字段随档案保存。
- `importBatches`：独立于正式器械集合的持久候选批次；记录来源、候选状态、分类建议、错误和重复处理决定。预览不修改正式器械；确认提交时整批校验，原子保存正式记录及候选状态。
- `links`：通过 `gymId` 与 `equipmentId` 表达场馆和器械多对多关系，保存数量、状态、备注、核实日期；同一关系重复保存时更新。
- 测评通过外部 JSON（JavaScript Object Notation，JavaScript 对象表示法）导入并保留原始内容，不是独立内置测评系统。
- `linkBatch` 先整批校验再保存，防止仅部分关联成功；品牌被引用时不可直接删除。

## 存储与发布目录

- 程序目录：安装器所选位置；前端产物在 `dist/`，安装包在 `release/NationalGymMap-Setup.exe`。
- 配置：用户配置目录内的 `location.json` 保存 `dataRoot`。由使用者选择长期资料目录，不硬编码个人机器路径。
- 数据根目录：`database/data.json` 保存版本化数据；`gyms/`、`equipment/` 保存图片；`imports/` 归档导入文件；`backups/` 保存完整备份；`exports/` 保存导出；`metadata/` 保存元数据。
- 数据采用原子替换写入。迁移复制校验后才切换并保留源目录；恢复先验证、保留安全快照，失败回退；升级前备份旧数据。
- 器械模型继续使用 `schemaVersion: 1`，由 `metadata.equipmentModelVersion: 1` 标识扩展字段已迁移。首次读取旧库前，将完整数据目录（排除备份目录）复制到 `backups/equipment-model-*` 并逐文件核对哈希，之后才替换数据库。路径保存在 `metadata.equipmentMigrationBackup`；恢复旧压缩备份时另保留原始压缩文件。还原操作见 `docs/equipment.md`。
- 发布校验清单：`release/checksums.txt`。安装器替换程序文件的兼容处理由构建脚本维护。

## 验证入口

以下命令中的 npm（Node Package Manager，Node.js 包管理器）用于开发：

| 范围 | 命令 |
| --- | --- |
| 数据与业务回归 | `npm.cmd test` |
| 分类、旧字段与备份迁移 | `node --test tests/equipment-model.test.cjs tests/catalog.test.cjs tests/storage.test.cjs` |
| 前端构建 | `npm.cmd run build` |
| 完整窗口业务回归 | `node tests/desktop.cjs` |
| 1.1.0 多部位、品牌标签、批量关联 | `node tests/update-1.1.cjs` |
| 悬停浮卡清单 | `node tests/hover-preview.cjs` |
| 网页、动态内容、辅助窗口、真实品牌 | `node tests/web-import.cjs`；设置 `GYM_WEB_FIXTURES_ONLY=1` 仅运行可控网页 |
| 文档解析、扫描页、取消及确认保存 | `node tests/pdf-import.cjs` |
| 故障、真实官网、跨盘迁移 | `node tests/resilience.cjs`，需要联网和可写 E 盘 |
| 正式安装包 | `npm.cmd run dist` |

完整窗口测试可用 `GYM_INSTALLED_EXE` 指定已安装程序。测试使用隔离数据目录；已有结果见 `ACCEPTANCE.md`，本次任务应只运行与改动相称的验证。


## 公共发布与共享资料（1.4.0）

`electron/public-release.cjs` 固定默认公共仓库、软件更新和共享地址，下载仅允许指定公共 GitHub 域名并限制大小、超时及重定向。`electron/shared-catalog.cjs` 使用白名单导出、清单哈希校验、共享标识映射和三方合并，私人字段保留本地。`src/SharedCatalogSettings.jsx` 提供检查、预览、确认、导出和修改建议入口。`shared/` 保存经确认的公开数据和图片，个人完整档案不进入仓库。

全球离线底图由 `src/MapView.jsx` 加载本地 `public/world.json`、`world-cities.json` 与既有 `china.json`，不含在线切片入口；来源与精度见 `docs/offline-map-sources.md`。`src/GymListTags.jsx` 约束列表标签两行并将溢出内容引导到详情。网页列表图由 `electron/page-extraction.cjs` 按条目链接提取，`electron/web-import.cjs` 保留列表图并合并详情候选；同一图片选择组件用于单条和批量导入。
