import { Global, Module } from '@nestjs/common';
import { OrderService } from './order.service';

/**
 * Plain domain module.
 *
 * It is marked `@Global()` because `AgenticModule.forFeature()` registers tool
 * sets inside the AgenticModule context, so `OrderTools` can only resolve
 * `OrderService` if it is globally available.
 */
@Global()
@Module({
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
