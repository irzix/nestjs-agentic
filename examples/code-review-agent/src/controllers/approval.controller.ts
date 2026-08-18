import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApprovalService } from 'nestjs-agentic';

/**
 * REST controller for maintainer human-in-the-loop (HITL) settlement.
 */
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Post(':id/settle')
  @HttpCode(HttpStatus.OK)
  async settleApproval(
    @Param('id') id: string,
    @Body() body: { action: 'approve' | 'reject'; maintainerToken?: string; reason?: string },
  ) {
    const expectedSecret = process.env.MAINTAINER_APPROVAL_SECRET || 'valid-maintainer-token';
    if (!body.maintainerToken || body.maintainerToken !== expectedSecret) {
      throw new UnauthorizedException('Maintainer authentication token required to settle approvals');
    }

    const actor = { userId: 'maintainer_42', label: 'maintainer' };

    if (body.action === 'approve') {
      return this.approvalService.approve(id, { actor });
    } else {
      return this.approvalService.reject(id, { actor, reason: body.reason || 'Rejected by maintainer' });
    }
  }
}
