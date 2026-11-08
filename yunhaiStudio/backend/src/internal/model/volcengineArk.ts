// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { ChannelInterfaceType, channelInterfaceVolcengineArkAgentPlanImage, channelInterfaceVolcengineArkAgentPlanVideo, channelInterfaceVolcengineArkImage, channelInterfaceVolcengineArkVideo } from "./models";


export function isVolcengineArkImageProtocol(protocol: ChannelInterfaceType): boolean {
  return protocol === channelInterfaceVolcengineArkImage || protocol === channelInterfaceVolcengineArkAgentPlanImage;
}

export function isVolcengineArkVideoProtocol(protocol: ChannelInterfaceType): boolean {
  return protocol === channelInterfaceVolcengineArkVideo || protocol === channelInterfaceVolcengineArkAgentPlanVideo;
}
