import { Body, Controller, Param, Post } from '@nestjs/common';
import { AgentRunner, ApprovalService } from 'nestjs-agentic';

@Controller('finance')
export class BankingController {
  constructor(
    private readonly runner: AgentRunner,
    private readonly approvalService: ApprovalService,
  ) {}

  @Post('transfer')
  async transfer(
    @Body()
    body: {
      sessionId: string;
      message: string;
      userId?: string;
      tenantId?: string;
      roles?: string[];
    },
  ) {
    return this.runner.run('banking-agent', {
      sessionId: body.sessionId || 'session_1',
      message: body.message,
      context: {
        userId: body.userId || 'usr_finance_mgr',
        tenantId: body.tenantId || 'acme_corp',
        roles: body.roles || ['finance_officer'],
      },
    });
  }

  @Post('approve/:approvalId')
  async approve(@Param('approvalId') approvalId: string) {
    return this.approvalService.approve(approvalId);
  }

  @Post('reject/:approvalId')
  async reject(@Param('approvalId') approvalId: string) {
    await this.approvalService.reject(approvalId);
    return { success: true, message: `Pending transfer approval ${approvalId} rejected and removed.` };
  }
}
