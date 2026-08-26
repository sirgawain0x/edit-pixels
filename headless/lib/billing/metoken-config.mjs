import { parseAbi } from 'viem'

/**
 * Server-side CRTVAI constants and ABIs.
 *
 * Duplicated from src/config/metoken.ts so the headless Node.js modules can
 * read them without a TypeScript build step.
 */

/** CRTVAI meToken diamond address on Base. */
export const CRTVAI_DIAMOND_ADDRESS = '0xecb695544a3d2a64d579b3828f3f60f6932f4846'

/** MeToken facet — mint, sell, and curve pricing. */
export const METOKEN_DIAMOND_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function mint(uint256 amount) external',
  'function sell(uint256 amount) external',
  'function getCurrentPrice() view returns (uint256)',
  'function getMintPrice(uint256 amount) view returns (uint256)',
  'function getSellPrice(uint256 amount) view returns (uint256)',
  'function getHubId() view returns (uint256)',
  'function activeCollateralOnly() view returns (bool)',
])
