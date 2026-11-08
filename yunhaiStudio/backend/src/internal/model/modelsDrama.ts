// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { ProjectUnit } from "./modelsProject";
// 短剧自动制作域：章节（ProjectUnit kind=chapter）只承载小说原文，
// 集（DramaEpisode）是剧本、分镜和后续产物的唯一基石。
// 编排状态全部落库，由服务端调度循环推进，浏览器只读写意图。

export const dramaStatusDraft = "draft";
export const dramaStatusRunning = "running";
export const dramaStatusPaused = "paused";
export const dramaStatusCompleted = "completed";
export const dramaStageBible = "bible";
export const dramaStageProduce = "produce";
export const dramaStageDone = "done";
export const dramaEpisodeQueued = "queued";
export const dramaEpisodeScript = "script";
export const dramaEpisodePrompts = "prompts";
export const dramaEpisodeReview = "review";
export const dramaEpisodeVideo = "video";
export const dramaEpisodeRender = "render";
export const dramaEpisodeDone = "done";
export const dramaSourceNovel = "novel";
export const dramaSourceScript = "script";
export const dramaSourceStoryboard = "storyboard";
export const dramaMediaQueued = "queued";
export const dramaMediaDraft = "draft";
export const dramaMediaRunning = "running";
export const dramaMediaReady = "ready";
export const dramaMediaFailed = "failed";
export const dramaMediaStale = "stale";
export const dramaMediaSkipped = "skipped";
export const dramaJobQueued = "queued";
export const dramaJobRunning = "running";
export const dramaJobSucceeded = "succeeded";
export const dramaJobFailed = "failed";
export const dramaJobCanceled = "canceled";
export const dramaJobBible = "bible";
export const dramaJobPlan = "plan";
export const dramaJobCastImage = "cast_image";
export const dramaJobScript = "script";
export const dramaJobRender = "render";
export const dramaJobSegmentPrompt = "segment_prompt";
export const dramaJobSegmentVideo = "segment_video";

// DramaProduction 是一个项目的自动制作控制面，项目内唯一。

export interface DramaProduction {
  projectId: string;
  userId: string;
  status: string;
  stage: string;
  settingsJson: string;
  bibleJson: string;
  budgetMicrocredits: number;
  spentMicrocredits: number;
  planCursor: number;
  planDone: boolean;
  sampleApproved: boolean;
  /** AssetsReleased 为 true 后才自动生成角色/场景参考图；手动生图模式下由用户确认资产后打开。 */
  assetsReleased: boolean;
  pauseReason: string;
  /** DraftJSON 是草稿的创建页表单（原始正文、画风 ID），只在 status=draft 时有值，开工时清空。 */
  draftJson?: string;
  revision: number;
  lastTickAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// DramaCast 是全剧设定（角色 / 场景），镜头引用它的参考图保持一致性。

export interface DramaCast {
  revision: number;
  id: string;
  projectId: string;
  kind: string;
  name: string;
  aliasesJson: string;
  role: string;
  description: string;
  appearance: string;
  imagePrompt: string;
  /** VoiceInstructions 是声线描述（音色、语速、情绪），写进视频提示词，由视频模型同步生成对白。 */
  voiceInstructions: string;
  /** VoiceProfileID 是用户为角色指定的声音（声音库条目）；VoiceSampleResourceID 是它的样本音频， // 视频模型支持参考音频时随该角色说话的剧情段一起发送。空串表示只按声线描述生成。 */
  voiceProfileId?: string;
  voiceSampleResourceId?: string;
  /** ParentID 非空表示这一行是 ParentID 角色的一套造型（妆造）：LookName 是造型名，Appearance 与参考图是这套造型的外观， // 名称、别名与声音沿用所属角色。LookFromChapter / LookToChapter 是默认适用的原著章节号（从 1 起，0 表示不限）， // 写剧本时按本集章节选默认造型，镜头可按剧情另选。 */
  parentId?: string;
  lookName?: string;
  lookFromChapter?: number;
  lookToChapter?: number;
  importance: number;
  imageResourceId?: string;
  imageStatus: string;
  imageVersion: number;
  locked: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface DramaEpisode {
  id: string;
  projectId: string;
  number: number;
  title: string;
  synopsis: string;
  hook: string;
  cliffhanger: string;
  chapterIdsJson: string;
  /** SourceFormat 是本集原文的素材类型（novel / script / storyboard），空串按小说处理。 */
  sourceFormat: string;
  stage: string;
  error: string;
  shotCount: number;
  durationMs: number;
  /** Approved 表示用户已确认本集视频提示词（逐集确认模式下的审阅关口）。 */
  approved: boolean;
  /** MediaReleased 为 true 后才为本集生成视频；手动模式下由用户确认剧本与提示词后打开。 */
  mediaReleased: boolean;
  finalResourceId?: string;
  finalStale: boolean;
  subtitleSrt: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

// DramaShot 保存镜头脚本，作为剧情段视频提示词的素材。

export interface DramaShot {
  id: string;
  projectId: string;
  episodeId: string;
  position: number;
  /** SegmentIndex/SegmentTitle 把一集切成剧情段；一段总时长不超过视频模型单次上限，一段生成一个视频。 */
  segmentIndex: number;
  segmentTitle: string;
  scene: string;
  sceneCastId?: string;
  castIdsJson: string;
  /** PropIDsJSON 是画面里出现的关键道具设定（DramaCast kind=prop）。 */
  propIdsJson: string;
  /** LookCastIDsJSON 是本镜出镜角色选用的造型行 ID 列表（DramaCast kind=character 且 ParentID 非空）； // 空表示各角色用本集默认造型或本体。取参考图时用这里的造型行外观与参考图替换角色本体。 */
  lookCastIdsJson: string;
  speaker: string;
  dialogue: string;
  action: string;
  shotSize: string;
  camera: string;
  /** Transition 是进入本镜头的转场：cut / fadeblack / fadewhite；作品统一指定时以作品设置为准。 */
  transition: string;
  durationMs: number;
  /** ImagePrompt 是本镜起幅画面描述，VideoPrompt 是镜头内的动作与运镜描述。 */
  imagePrompt: string;
  videoPrompt: string;
  sourceQuote: string;
  createdAt: string;
  updatedAt: string;
}

// DramaSegment 是视频生成单位：一段一次调用视频模型，台词、音效与镜头切换都由视频模型在一个视频里完成。
// 段由镜头的 SegmentIndex 决定，重新改编剧本时随镜头一起重建。

export interface DramaSegment {
  promptSeconds: number;
  revision: number;
  id: string;
  projectId: string;
  episodeId: string;
  segmentIndex: number;
  /** VideoPrompt 是文本模型按镜头表撰写的完整视频提示词；PromptStatus 为空表示待撰写。 */
  videoPrompt: string;
  promptStatus: string;
  promptError: string;
  /** VideoPromptOverride 是用户改写的完整视频提示词；非空时优先于模型撰写的版本。 */
  videoPromptOverride: string;
  /** VideoModelJSON 为空时使用全剧默认视频模型。 */
  videoModelJson: string;
  /** ReferenceCastIDsJSON 为空表示按镜头自动取参考图；非空是用户为本段指定的设定 ID 列表（顺序即参考图编号，可为 []）。 */
  referenceCastIdsJson: string;
  /** ReferenceImagesJSON 保存用户上传或从素材库选择的附加参考图，排在设定图之后。 */
  referenceImagesJson: string;
  /** AudioCastIDsJSON 为空时按对白自动选择；[] 表示手动关闭全部角色音色。 */
  audioCastIdsJson: string;
  /** VideoStatus 为空表示待生成；TailFrameResourceID 是本段视频最后一帧，作为下一段的参考图，保证段与段衔接。 */
  videoStatus: string;
  videoResourceId?: string;
  tailFrameResourceId?: string;
  videoSeconds: number;
  videoError: string;
  createdAt: string;
  updatedAt: string;
}

export interface DramaReferenceImage {
  resourceId: string;
  name: string;
}

// DramaTake 保存每个产物的全部版本：角色/场景参考图（cast）、剧情段视频（video）与成片（final）。

export interface DramaTake {
  id: string;
  projectId: string;
  ownerId: string;
  kind: string;
  version: number;
  resourceId: string;
  taskId: string;
  prompt: string;
  durationMs: number;
  createdAt: string;
}

// DramaJob 是调度队列中的一项工作；任务创建延迟到派发时，保证使用最新数据。

export interface DramaJob {
  id: string;
  projectId: string;
  status: string;
  kind: string;
  episodeId?: string;
  shotId?: string;
  castId?: string;
  taskId?: string;
  priority: number;
  attempt: number;
  label: string;
  payloadJson?: string;
  /** AttemptsJSON 记录每次提交过的任务（重试会清空 TaskID），用于在队列里回看历次请求。 */
  attemptsJson?: string;
  error: string;
  costMicrocredits: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function dramaEpisodeDefaultTitle(number: number): string {
  return `第 ${number} 集`;
}
