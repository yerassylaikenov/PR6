// Decodes a viem contract error into the contract's custom-error name.
// Used by the monitor rules and the demo scripts to classify reverts
// (AccessControlUnauthorizedAccount, SelfSettlementForbidden, ...).
import { BaseError, ContractFunctionRevertedError } from "viem";

export interface DecodedRevert {
  errorName: string;
  args: readonly unknown[];
  short: string;
}

export function decodeRevert(err: unknown): DecodedRevert {
  if (err instanceof BaseError) {
    const revert = err.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null;
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason ?? "UnknownRevert";
      const args = revert.data?.args ?? [];
      return { errorName: name, args, short: revert.shortMessage };
    }
    // User rejected signature (MetaMask) — EIP-1193 code 4001.
    const anyErr = err as unknown as { code?: number };
    if (anyErr.code === 4001) {
      return {
        errorName: "UserRejectedRequest",
        args: [],
        short: "Пользователь отклонил подпись (4001)",
      };
    }
    return { errorName: "UnknownRevert", args: [], short: err.shortMessage };
  }
  return {
    errorName: "UnknownError",
    args: [],
    short: err instanceof Error ? err.message : String(err),
  };
}
