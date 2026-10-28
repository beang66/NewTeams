import { contentCampaignPack } from './contentCampaign.js'
import { ipBusinessPlanPack } from './ipBusinessPlan.js'
import { researchReportPack } from './researchReport.js'
import { webAppPack } from './webApp.js'
import type { WorkPack } from '../contract.js'

export type AnyWorkPack = WorkPack<any>

export const builtInWorkPacks: readonly AnyWorkPack[] = [
  webAppPack,
  researchReportPack,
  contentCampaignPack,
  ipBusinessPlanPack,
] as const

export function getBuiltInWorkPack(id: string): AnyWorkPack | undefined {
  return builtInWorkPacks.find((pack) => pack.manifest.id === id)
}

export { contentCampaignPack, ipBusinessPlanPack, researchReportPack, webAppPack }
