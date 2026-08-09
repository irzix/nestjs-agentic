import { Injectable } from '@nestjs/common';

export interface TransferResult {
  transactionId: string;
  fromAccount: string;
  toAccount: string;
  amount: number;
  status: 'COMPLETED' | 'FAILED';
}

@Injectable()
export class AccountService {
  async transfer(fromAccount: string, toAccount: string, amount: number, tenantId?: string): Promise<TransferResult> {
    const transactionId = `tx_${Date.now()}`;
    console.log(`[Banking Ledger] Tenant: ${tenantId || 'default'} | Executed Transfer ${transactionId}: $${amount} from ${fromAccount} to ${toAccount}`);

    return {
      transactionId,
      fromAccount,
      toAccount,
      amount,
      status: 'COMPLETED',
    };
  }
}
