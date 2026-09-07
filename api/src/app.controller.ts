import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('info')
  info() {
    return {
      name: 'poc-api',
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
    };
  }
}