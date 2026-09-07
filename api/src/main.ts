import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { NextFunction, Request, Response } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(
    `${req.method} ${req.url} | socket=${req.socket.remoteAddress} | x-real-ip=${req.headers['x-real-ip'] ?? '-'} | x-forwarded-for=${req.headers['x-forwarded-for'] ?? '-'}`,
  );
  next();
});

  await app.listen(8080, '0.0.0.0');
}
await bootstrap();
