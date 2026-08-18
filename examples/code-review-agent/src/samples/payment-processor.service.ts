import { Injectable, Logger } from '@nestjs/common';

/**
 * Sample payment processing service demonstrating multi-domain review triggers
 * for Njent Autonomous Code Review Agent.
 */
@Injectable()
export class PaymentProcessorService {
  private readonly logger = new Logger(PaymentProcessorService.name);

  /**
   * Processes a transaction with validation and receipt emission.
   *
   * @param accountId Target customer account ID.
   * @param amount Transaction amount in cents.
   * @returns Processed transaction payload.
   */
  async processTransaction(accountId: string, amount: number): Promise<{ id: string; status: string }> {
    if (amount <= 0) {
      throw new Error('Transaction amount must be positive');
    }

    this.logger.log(`Processing payment of $${(amount / 100).toFixed(2)} for account ${accountId}`);

    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    return {
      id: transactionId,
      status: 'COMPLETED',
    };
  }
}
