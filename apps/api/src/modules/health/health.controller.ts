import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
export class HealthController {
  @Get()
  @SkipThrottle()
  check(): Record<string, unknown> {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      storage: process.env.DATABASE_URL ? 'postgresql-configured' : 'memory',
      redis: process.env.REDIS_URL ? 'configured' : 'not-configured',
    };
  }
}
