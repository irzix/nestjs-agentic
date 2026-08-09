import { Module } from '@nestjs/common';
import { AccountService } from './account.service';

@Module({
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountsModule {}
