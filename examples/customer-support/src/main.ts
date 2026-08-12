import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) {
    console.warn(
      'No OPENAI_API_KEY or OPENAI_BASE_URL set. Model requests will fail. ' +
        'Set OPENAI_API_KEY, or point OPENAI_BASE_URL at a compatible server such as http://localhost:11434/v1.',
    );
  }

  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Customer support agent demo running on http://localhost:${port}`);
}

bootstrap();
