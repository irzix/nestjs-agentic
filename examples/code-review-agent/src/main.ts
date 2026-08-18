import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NjentAppModule } from './app.module';

/**
 * Bootstrap entry point for Njent Autonomous Code Review Agent application.
 */
async function bootstrap() {
  const logger = new Logger('NjentBootstrap');
  const app = await NestFactory.create(NjentAppModule);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`🚀 Njent Autonomous Code Review Agent is running on http://localhost:${port}`);
  logger.log(`📥 GitHub Webhook Ingress: POST http://localhost:${port}/webhooks/github`);
  logger.log(`🛡️ Human-in-the-Loop Settlement: POST http://localhost:${port}/approvals/:id/settle`);
}

bootstrap().catch((err) => {
  console.error('Fatal error bootstrapping Njent:', err);
  process.exit(1);
});
