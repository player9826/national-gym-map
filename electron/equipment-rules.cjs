const rules = [
  [/dumbbell|哑铃/i, "free_weight", "dumbbell"],
  [/barbell|杠铃杆/i, "free_weight", "barbell"],
  [/smith|史密斯/i, "free_weight", "smith"],
  [/\brack\b|力量架|深蹲架/i, "free_weight", "rack"],
  [/functional trainer|cable crossover|cable station|龙门架/i, "cable_station"],
  [
    /treadmill|elliptical|rowerg|bikeerg|ski erg|air bike|exercise bike|跑步机|椭圆机|划船机|健身车/i,
    "cardio",
  ],
  [
    /chest press|incline press|vertical press|推胸/i,
    "fixed",
    "",
    "CHEST",
    "推胸",
  ],
  [/pec fly|pec deck|chest fly|夹胸/i, "fixed", "", "CHEST", "夹胸"],
  [/shoulder press|肩推/i, "fixed", "", "SHOULDER", "肩推"],
  [/lateral raise|rear delt|中后束/i, "fixed", "", "SHOULDER", "中后束"],
  [/lat pull|pulldown|背下拉/i, "fixed", "", "BACK", "背下拉"],
  [/seated row|low row|high row|背后拉/i, "fixed", "", "BACK", "背后拉"],
  [/leg press|近固蹬/i, "fixed", "", "LEG", "近固蹬"],
  [/hack squat|远固蹬/i, "fixed", "", "LEG", "远固蹬"],
  [
    /hip thrust|glute drive|glute kick|hip extension|髋伸/i,
    "fixed",
    "",
    "LEG",
    "髋伸",
  ],
  [/abduct|adduct|髋旋/i, "fixed", "", "LEG", "髋旋"],
  [/leg extension|腿屈伸/i, "fixed", "", "LEG", "腿屈伸"],
  [/leg curl|腿弯举/i, "fixed", "", "LEG", "腿弯举"],
  [/bicep|preacher curl|二头/i, "fixed", "", "ARM", "二头"],
  [/tricep|三头/i, "fixed", "", "ARM", "三头"],
  [/abdominal crunch|ab crunch|脊柱屈/i, "fixed", "", "ABDOMINAL", "脊柱屈"],
  [/back extension|脊柱伸/i, "fixed", "", "ABDOMINAL", "脊柱伸"],
];
function suggest(row) {
  const text = [
    row.name,
    row.model,
    row.officialCategory,
    row.series,
    row.description,
  ]
    .filter(Boolean)
    .join(" ");
  const storage =
    /\b(?:storage|dumbbell|barbell|plate|weight|kettlebell)\s+(?:storage\s+)?rack\b|收纳架|储物架/i.test(
      row.name || "",
    );
  const rule = storage ? null : rules.find(([pattern]) => pattern.test(text));
  if (!rule)
    return {
      equipmentType: "",
      freeWeightType: "",
      parts: [],
      tags: [],
      classificationReason: "暂无可靠规则，请人工选择分类。",
    };
  return {
    equipmentType: rule[1],
    freeWeightType: rule[2] || "",
    parts: rule[3] ? [rule[3]] : [],
    tags: rule[4] ? [rule[4]] : [],
    classificationReason: "根据名称和官网描述建议，导入前请核对。",
  };
}
module.exports = { suggest };
