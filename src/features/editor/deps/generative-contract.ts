/**
 * Cross-feature dependency contract: generative / Vertex proxy.
 */
export {
  getPublicImageUrl,
  pollTask,
  proxyFlowRun,
  proxyGetTask,
  useGenerativeAuth,
  type SignedRequestParams,
  type GenerativeTaskDetail,
} from '@/features/generative'
export {
  PIXELS_SIGNER_HEADER,
  pixelsIdentityHeaders,
  withPixelsIdentityBody,
} from '@/features/generative/pixels-api-identity'
