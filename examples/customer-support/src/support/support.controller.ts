import { Body, Controller, Param, Post } from '@nestjs/common';
import { AgentRunner, ApprovalService } from 'nestjs-agentic';

@Controller('support')
export class SupportController {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly approvalService: ApprovalService,
  ) {}

  @Post('chat')
  async chat(@Body() body: { sessionId: string; message: string; userId?: string }) {
    return this.agentRunner.run('customer-support', {
      sessionId: body.sessionId,
      message: body.message,
      context: { userId: body.userId ?? 'user-1' },
    });
  }

  @Post('approve/:approvalId')
  async approve(@Param('approvalId') approvalId: string) {
    return this.approvalService.approve(approvalId);
  }

  @Post('reject/:approvalId')
  async reject(@Param('approvalId') approvalId: string) {
    return this.approvalService.reject(approvalId);
  }
}
