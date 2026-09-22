import { imageUrl } from "./data-service";

export const PARTS = [
  ["CHEST", "胸"],
  ["SHOULDER", "肩"],
  ["BACK", "背"],
  ["LEG", "腿"],
  ["ABDOMINAL", "核心"],
  ["ARM", "手臂"],
];
export const TAGS = [
  "推胸",
  "肩推",
  "近固蹬",
  "髋伸",
  "夹胸",
  "中后束",
  "远固蹬",
  "髋旋",
  "背下拉",
  "二头",
  "腿屈伸",
  "脊柱屈",
  "背后拉",
  "三头",
  "腿弯举",
  "脊柱伸",
  "小臂",
  "小腿",
];
export const EQUIPMENT_TYPES = [
  ["fixed", "固定器械"],
  ["cardio", "有氧器械"],
  ["free_weight", "自由力量"],
  ["cable_station", "龙门架"],
];
export const FREE_WEIGHT_TYPES = [
  ["dumbbell", "哑铃"],
  ["barbell", "杠铃"],
  ["smith", "史密斯"],
  ["rack", "力量架"],
];
export const PART_TAGS = {
  CHEST: ["推胸", "夹胸"],
  SHOULDER: ["肩推", "中后束"],
  BACK: ["背下拉", "背后拉"],
  LEG: ["近固蹬", "远固蹬", "髋伸", "髋旋", "腿屈伸", "腿弯举", "小腿"],
  ARM: ["二头", "三头", "小臂"],
  ABDOMINAL: ["脊柱屈", "脊柱伸"],
};
export const equipmentType = (row) =>
  row.equipmentType ||
  (row.parts?.length || row.part || row.tags?.length ? "fixed" : "");
export const equipmentSummary = (row) => {
  const type = equipmentType(row);
  const name =
    EQUIPMENT_TYPES.find(([key]) => key === type)?.[1] || "待确认分类";
  if (type === "fixed")
    return [name, partName(row.parts ?? [row.part]), row.loading]
      .filter(Boolean)
      .join(" · ");
  if (type === "free_weight")
    return [
      name,
      FREE_WEIGHT_TYPES.find(([key]) => key === row.freeWeightType)?.[1] ||
        "子类待确认",
    ].join(" · ");
  return name;
};
export const tagLabel = (tag) => tag === "肩推" ? "推肩" : tag;
export const isCustomPart = (part) => typeof part === "string" && part.startsWith("CUSTOM:") && !!part.slice(7).trim();
export const partName = (key) =>
  Array.isArray(key)
    ? key.map(partName).join(" / ")
    : isCustomPart(key) ? key.slice(7) : PARTS.find((p) => p[0] === key)?.[1] || key;
export const asset = imageUrl;
export const CITIES = [
  ["北京", 39.9042, 116.4074],
  ["上海", 31.2304, 121.4737],
  ["广州", 23.1291, 113.2644],
  ["深圳", 22.5431, 114.0579],
  ["成都", 30.5728, 104.0668],
  ["重庆", 29.563, 106.5516],
  ["杭州", 30.2741, 120.1551],
  ["南京", 32.0603, 118.7969],
  ["武汉", 30.5928, 114.3055],
  ["西安", 34.3416, 108.9398],
  ["天津", 39.0842, 117.2009],
  ["苏州", 31.2989, 120.5853],
  ["长沙", 28.2282, 112.9388],
  ["郑州", 34.7466, 113.6254],
  ["青岛", 36.0671, 120.3826],
  ["济南", 36.6512, 117.1201],
  ["沈阳", 41.8057, 123.4315],
  ["大连", 38.914, 121.6147],
  ["长春", 43.8171, 125.3235],
  ["哈尔滨", 45.8038, 126.535],
  ["石家庄", 38.0428, 114.5149],
  ["太原", 37.8706, 112.5489],
  ["呼和浩特", 40.8426, 111.7492],
  ["合肥", 31.8206, 117.2272],
  ["福州", 26.0745, 119.2965],
  ["厦门", 24.4798, 118.0894],
  ["南昌", 28.6829, 115.8582],
  ["南宁", 22.817, 108.3669],
  ["海口", 20.044, 110.1999],
  ["贵阳", 26.647, 106.6302],
  ["昆明", 25.0389, 102.7183],
  ["拉萨", 29.65, 91.14],
  ["兰州", 36.0611, 103.8343],
  ["西宁", 36.6171, 101.7782],
  ["银川", 38.4872, 106.2309],
  ["乌鲁木齐", 43.8256, 87.6168],
  ["香港", 22.3193, 114.1694],
  ["澳门", 22.1987, 113.5439],
  ["台北", 25.033, 121.5654],
  ["宁波", 29.8683, 121.544],
  ["无锡", 31.4912, 120.3119],
  ["佛山", 23.0215, 113.1214],
  ["东莞", 23.0207, 113.7518],
  ["温州", 27.9938, 120.6994],
  ["泉州", 24.8741, 118.6757],
  ["珠海", 22.271, 113.5767],
  ["三亚", 18.2528, 109.5119],
  ["洛阳", 34.6197, 112.454],
  ["烟台", 37.4638, 121.4479],
];
export const emptyGym = () => ({
  name: "",
  province: "",
  city: "",
  district: "",
  address: "",
  lat: "",
  lng: "",
  cover: "",
  photos: [],
  description: "",
  tags: [],
  visited: false,
  visitDate: "",
  score: "",
  reviewUrl: "",
  reviewSource: "",
  reviewVersion: "",
  reviewDate: "",
});
export const emptyEquipment = (brandId) => ({
  name: "",
  equipmentType: "",
  freeWeightType: "",
  brandId: brandId || "",
  part: "",
  parts: [],
  loading: "",
  tags: [],
  model: "",
  image: "",
  imageSource: "",
  productUrl: "",
  notes: "",
});
