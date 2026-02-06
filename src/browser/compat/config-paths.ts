import { homedir } from "node:os";
import { join } from "node:path";

export type PortRange = { start: number; end: number };

export const CONFIG_DIR = join(homedir(), ".microclaw");

export function resolveGatewayPort(_config?: unknown): number | undefined {
  return undefined;
}

export const DEFAULT_BROWSER_CONTROL_PORT = 12200;
export const DEFAULT_BROWSER_CDP_PORT_RANGE_START = 12210;
export const DEFAULT_BROWSER_CDP_PORT_RANGE_END = 12299;

export function deriveDefaultBrowserControlPort(_basePort?: number): number {
  return DEFAULT_BROWSER_CONTROL_PORT;
}

export function deriveDefaultBrowserCdpPortRange(_controlPort?: number): PortRange {
  return {
    start: DEFAULT_BROWSER_CDP_PORT_RANGE_START,
    end: DEFAULT_BROWSER_CDP_PORT_RANGE_END,
  };
}
