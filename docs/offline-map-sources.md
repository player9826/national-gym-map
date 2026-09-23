# 全球离线地图数据

运行时仅加载安装包内的 `world.json`、`world-cities.json`、`china.json`；不请求在线地图切片，不包含道路、建筑或地址搜索服务。全球轮廓用于场馆分布概览，放大后仍是概略轮廓，不代表街道级精度。主要城市并非完整城市名录，任何有效全球经纬度均可用于场馆定位。

新增数据取自 Natural Earth 5.1.2 的 1:110,000,000 数据集，2026-09-20 下载并固定版本：

- [国家轮廓原始文件](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson)：保留全部 177 个概化轮廓，名称优先中文；仅保留名称和几何，坐标保留五位小数。原文件 SHA-256（Secure Hash Algorithm 256-bit，256 位安全散列算法）：`6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`。
- [主要城市原始文件](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_populated_places.geojson)：保留全部 243 条名称与经纬度；绘制时与现有中国城市坐标去重。原文件 SHA-256（Secure Hash Algorithm 256-bit，256 位安全散列算法）：`a86028b083182b68c7620fc6e1a8a47ee547cb9cd2fb62ccbb78bea786440899`。
- [Natural Earth 使用条款](https://www.naturalearthdata.com/about/terms-of-use/)声明数据属于公有领域，允许修改与再分发；地图中保留来源署名。

现有中国省界与中国城市不替换。仅中国省界沿用原来的坐标转换；Natural Earth 数据使用 WGS84（World Geodetic System 1984，1984 世界大地坐标系），不进行中国偏移坐标转换。底图采用墨卡托投影，极点不在可显示范围内；不加载重复世界副本，选点经度归一到 -180 至 180 度。
