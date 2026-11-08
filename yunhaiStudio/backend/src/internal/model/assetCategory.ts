// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { AssetCategory, assetCategoryArk, assetCategoryCharacter, assetCategoryEnvironment, assetCategoryMaterial, assetCategoryOther, assetCategoryProp } from "./models";


export function normalizeAssetCategory(value: AssetCategory, kind: string): AssetCategory {
  switch (String(value).trim().toLowerCase()) {
    case assetCategoryCharacter:
      return assetCategoryCharacter;
    case assetCategoryEnvironment:
      return assetCategoryEnvironment;
    case assetCategoryProp:
    case "wardrobe":
    case "weapon":
    case "accessory":
      return assetCategoryProp;
    case assetCategoryMaterial:
    case "style":
      return assetCategoryMaterial;
    case assetCategoryOther:
      return assetCategoryOther;
    case assetCategoryArk:
      return assetCategoryArk;
  }
  switch (kind.trim().toLowerCase()) {
    case "entity":
      return assetCategoryCharacter;
    case "image":
    case "video":
    case "audio":
    case "model":
      return assetCategoryMaterial;
    default:
      return assetCategoryOther;
  }
}
