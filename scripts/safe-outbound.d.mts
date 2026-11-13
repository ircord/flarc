export function isPublicAddress(address: string): boolean;
export function createSafeOutbound(options: {
  getEnv: () => Record<string, string | undefined>;
  lookup?: (...args: any[]) => Promise<any>;
  transport?: (...args: any[]) => any;
  timeoutMs?: number;
  maxBytes?: number;
  maxActive?: number;
}): (request: Request) => Promise<Response>;
