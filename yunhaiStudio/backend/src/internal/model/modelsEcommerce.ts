// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// EcommerceProject stores versioned ecommerce drafts and execution snapshots.
// Existing historical rows remain readable; new workflows do not rewrite them.

export interface EcommerceProject {
  id: string;
  userId: string;
  name: string;
  status: string;
  draftJson: string;
  planJson: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

// EcommerceKnowledgeSource tracks an auditable upstream knowledge source.
// Content is normalized into EcommerceKnowledgeEntry rows; no upstream code is executed.

export interface EcommerceKnowledgeSource {
  id: string;
  name: string;
  url: string;
  repository: string;
  commit: string;
  license: string;
  licenseText: string;
  version: string;
  status: string;
  lastSyncedAt: string | null;
  errorMessage: string;
  lastDuplicateCount: number;
  createdAt: string;
  updatedAt: string;
}

// EcommerceKnowledgeEntry is a small, searchable, normalized knowledge unit.
// JSON columns are deliberately stored as text so SQLite and PostgreSQL share the same contract.

export interface EcommerceKnowledgeEntry {
  id: string;
  sourceId: string;
  /** KnowledgeDomain is the auditable KB01-KB10 domain label. It is nullable in // practice so historical rows remain readable until an administrator // re-syncs or reviews them. */
  knowledgeDomain: string;
  knowledgeType: string;
  title: string;
  contentJson: string;
  category: string;
  platformsJson: string;
  languagesJson: string;
  regionsJson: string;
  applicabilityJson: string;
  exclusionsJson: string;
  relatedCasesJson: string;
  relatedQualityRulesJson: string;
  stylesJson: string;
  imageTypesJson: string;
  tagsJson: string;
  sourceUrl: string;
  sourceCommit: string;
  license: string;
  version: string;
  verifiedAt: string | null;
  validUntil: string | null;
  trustLevel: string;
  reviewStatus: string;
  dedupHash: string;
  createdAt: string;
  updatedAt: string;
}

// EcommerceCreativeRecommendation persists the exact four directions shown to a user.

export interface EcommerceCreativeRecommendation {
  id: string;
  userId: string;
  projectId: string;
  inputSignature: string;
  productCategory: string;
  platform: string;
  region: string;
  language: string;
  directionsJson: string;
  evidenceJson: string;
  selectedDirectionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface EcommercePlanTask {
  sourceDraft?: unknown;
  id: string;
  imageType: string;
  platform: string;
  language: string;
  goal: string;
  theme: string;
  composition: string;
  displayAssignment?: string;
  mainVisual: string;
  verifiedClaims: string;
  performanceAngle?: string;
  informationComponent?: string;
  copy: string;
  lighting: string;
  fidelity: string;
  prompt: string;
  manualPrompt?: boolean;
  negativePrompt: string;
  imageModel: string;
  ratio: string;
  resolution: string;
  skuId?: string;
  taskId?: string;
  referenceScreen?: EcommerceReferenceScreen | null;
}

export interface EcommerceReferenceScreen {
  sourceResourceId: string;
  screenIndex: number;
  top: number;
  bottom: number;
  content: string;
  layout: string;
  visual: string;
  sourceCopy?: string;
  resourceId?: string;
}

export interface EcommercePlan {
  inputSignature?: string;
  productSummary: string;
  confirmedFacts: string[];
  uncertainFacts: string[];
  visualStrategy: string;
  qualityChecks: string[];
  images: EcommercePlanTask[];
  previousImages?: EcommercePlanTask[];
  referenceSummary?: string;
}
